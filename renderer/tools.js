/**
 * tools.js: tool UX state machines
 *
 * Manages:
 *   - Form fill tool: create HTML overlays, collect values for save
 *   - Redaction tool: draw rectangles, send to Python, apply permanently
 *   - Text insert tool: click-to-place textarea, confirm via Enter/blur
 */

import {
  getCurrentPageNum,
  getCurrentViewport,
  pdfRectToScreen,
  screenRectToPdf,
  screenPointToPdf,
  getCanvasCoords,
} from './pdfview.js'

// ─── Shared state ─────────────────────────────────────────────────────────────

let activeTool = 'select'

// Redaction state
const pendingRedactions = []  // { id, screenRect, pdfRect, pageIndex }

// Redaction dragging
let redactDragging = false
let redactDragStart = null    // {x, y} in CSS pixels relative to canvas

// ─── Getters ─────────────────────────────────────────────────────────────────

export function getActiveTool() { return activeTool }
export function getPendingRedactions() { return pendingRedactions }

// ─── Tool switching ───────────────────────────────────────────────────────────

export function setActiveTool(tool) {
  activeTool = tool
  document.body.dataset.tool = tool

  // Toggle pointer-events via CSS data-tool attribute (see styles.css)
  // Update toolbar button states
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.classList.toggle('active', btn.id === `tool-${tool}`)
  })

  // When leaving fill mode, clear overlays (they'll be recreated on next render)
  if (tool !== 'fill') {
    clearFormOverlays()
  }
  // When leaving redact mode, keep pending redactions visible
}

// ─── Form Fill Tool ───────────────────────────────────────────────────────────

export async function loadFormFields(pageIndex) {
  clearFormOverlays()
  const viewport = getCurrentViewport()
  if (!viewport) { console.warn('loadFormFields: no viewport'); return }

  let result
  try {
    result = await window.electronAPI.pyCall('get_fields', { page_index: pageIndex })
  } catch (e) {
    console.error('get_fields failed:', e)
    return
  }

  console.log(`get_fields page ${pageIndex}:`, result.fields.length, 'fields', result.fields)

  const overlay = document.getElementById('form-overlay')
  let created = 0

  for (const field of result.fields) {
    if (field.type === 'unknown') continue

    const pos = pdfRectToScreen(field.rect, viewport)
    console.log(`  field "${field.name}" type=${field.type} pdfRect=${JSON.stringify(field.rect)} → screen=${JSON.stringify(pos)}`)
    if (pos.width < 2 || pos.height < 2) { console.warn('  skipped (too small)'); continue }

    const wrapper = document.createElement('div')
    wrapper.className = 'form-field-overlay'
    wrapper.style.left   = pos.left   + 'px'
    wrapper.style.top    = pos.top    + 'px'
    wrapper.style.width  = pos.width  + 'px'
    wrapper.style.height = pos.height + 'px'
    wrapper.dataset.fieldName = field.name
    wrapper.dataset.fieldType = field.type

    const input = createFieldInput(field, pos)
    if (input) {
      wrapper.appendChild(input)
      overlay.appendChild(wrapper)
      created++
    }
  }

  console.log(`loadFormFields: created ${created} overlay elements`)
  document.dispatchEvent(new CustomEvent('form-fields-loaded', { detail: { count: created } }))
}

function createFieldInput(field, pos) {
  let input

  switch (field.type) {
    case 'text': {
      input = document.createElement('input')
      input.type = 'text'
      input.value = field.value || ''
      input.className = 'field-input'
      break
    }
    case 'checkbox': {
      input = document.createElement('input')
      input.type = 'checkbox'
      input.checked = field.value === 'Yes' || field.value === 'true' || field.value === true
      input.className = 'field-input'
      break
    }
    case 'radio': {
      input = document.createElement('input')
      input.type = 'radio'
      input.name = field.name
      input.value = field.option_value || ''
      // Pre-select if this option matches the group's current value
      input.checked = field.option_value && field.value === field.option_value
      input.className = 'field-input'
      break
    }
    case 'select': {
      input = document.createElement('select')
      input.className = 'field-input'
      for (const opt of (field.options || [])) {
        const o = document.createElement('option')
        o.value = opt
        o.textContent = opt
        if (opt === field.value) o.selected = true
        input.appendChild(o)
      }
      break
    }
    default:
      return null
  }

  return input
}

export function clearFormOverlays() {
  const overlay = document.getElementById('form-overlay')
  overlay.innerHTML = ''
}

export function repositionFormOverlays() {
  const viewport = getCurrentViewport()
  if (!viewport) return

  document.querySelectorAll('.form-field-overlay').forEach(wrapper => {
    // Re-read the field's PDF rect from a data attribute (we store it)
    const rect = JSON.parse(wrapper.dataset.pdfRect || 'null')
    if (!rect) return
    const pos = pdfRectToScreen(rect, viewport)
    wrapper.style.left   = pos.left   + 'px'
    wrapper.style.top    = pos.top    + 'px'
    wrapper.style.width  = pos.width  + 'px'
    wrapper.style.height = pos.height + 'px'
  })
}

export async function collectAndSaveFormFields(pageIndex) {
  const fields = []
  const seen = new Set()

  document.querySelectorAll('.form-field-overlay').forEach(wrapper => {
    const name = wrapper.dataset.fieldName
    const type = wrapper.dataset.fieldType
    const input = wrapper.querySelector('.field-input')
    if (!input) return

    let value
    if (type === 'checkbox') {
      value = input.checked ? 'Yes' : 'Off'
    } else if (type === 'radio') {
      // Only send the selected radio value per group name (once)
      if (seen.has(name)) return
      seen.add(name)
      const checked = document.querySelector(
        `.form-field-overlay[data-field-name="${name}"] input[type="radio"]:checked`
      )
      value = checked ? checked.value : 'Off'
    } else {
      value = input.value
    }

    fields.push({ name, value })
  })

  if (fields.length > 0) {
    await window.electronAPI.pyCall('fill_form', {
      page_index: pageIndex,
      fields,
    })
  }
}

// ─── Redaction Tool ───────────────────────────────────────────────────────────

export function initRedactionTool() {
  const redactCanvas = document.getElementById('redact-canvas')

  redactCanvas.addEventListener('mousedown', (e) => {
    if (activeTool !== 'redact') return
    redactDragging = true
    redactDragStart = getCanvasCoords(e, redactCanvas)
    e.preventDefault()
  })

  redactCanvas.addEventListener('mousemove', (e) => {
    if (!redactDragging || activeTool !== 'redact') return
    const pos = getCanvasCoords(e, redactCanvas)
    drawRedactOverlay(pendingRedactions, redactDragStart, pos)
  })

  redactCanvas.addEventListener('mouseup', async (e) => {
    if (!redactDragging || activeTool !== 'redact') return
    redactDragging = false

    const end = getCanvasCoords(e, redactCanvas)
    const x = Math.min(redactDragStart.x, end.x)
    const y = Math.min(redactDragStart.y, end.y)
    const w = Math.abs(end.x - redactDragStart.x)
    const h = Math.abs(end.y - redactDragStart.y)

    if (w < 4 || h < 4) {
      // Too small, ignore
      drawRedactOverlay(pendingRedactions, null, null)
      return
    }

    const viewport = getCurrentViewport()
    const pdfRect = screenRectToPdf(x, y, w, h, viewport)
    const pageIndex = getCurrentPageNum() - 1

    try {
      const result = await window.electronAPI.pyCall('add_redaction', {
        page_index: pageIndex,
        rect: pdfRect,
      })
      pendingRedactions.push({
        id: result.id,
        pageIndex,
        screenRect: { left: x, top: y, width: w, height: h },
        pdfRect,
      })
    } catch (err) {
      console.error('add_redaction failed:', err)
    }

    drawRedactOverlay(pendingRedactions, null, null)
    updateApplyButton()
  })

  redactCanvas.addEventListener('mouseleave', () => {
    if (redactDragging) {
      redactDragging = false
      drawRedactOverlay(pendingRedactions, null, null)
    }
  })
}

export function redrawPendingRedactions() {
  drawRedactOverlay(pendingRedactions, null, null)
}

function drawRedactOverlay(rects, liveStart, liveEnd) {
  const canvas = document.getElementById('redact-canvas')
  const ctx = canvas.getContext('2d')
  const pixelRatio = window.devicePixelRatio || 1

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.save()
  ctx.scale(pixelRatio, pixelRatio)

  // Draw committed pending redactions
  for (const r of rects) {
    const s = r.screenRect
    ctx.fillStyle = 'rgba(0, 0, 0, 0.88)'
    ctx.fillRect(s.left, s.top, s.width, s.height)
    ctx.strokeStyle = '#cc2222'
    ctx.lineWidth = 1.5
    ctx.strokeRect(s.left + 0.75, s.top + 0.75, s.width - 1.5, s.height - 1.5)

    // Label
    const fontSize = Math.min(12, s.height * 0.55)
    if (fontSize >= 7) {
      ctx.fillStyle = '#ff6060'
      ctx.font = `bold ${fontSize}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('REDACTED', s.left + s.width / 2, s.top + s.height / 2)
    }
  }

  // Draw live drag preview
  if (liveStart && liveEnd) {
    const x = Math.min(liveStart.x, liveEnd.x)
    const y = Math.min(liveStart.y, liveEnd.y)
    const w = Math.abs(liveEnd.x - liveStart.x)
    const h = Math.abs(liveEnd.y - liveStart.y)

    ctx.fillStyle = 'rgba(200, 30, 30, 0.3)'
    ctx.fillRect(x, y, w, h)
    ctx.strokeStyle = '#ff3333'
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 3])
    ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5)
    ctx.setLineDash([])
  }

  ctx.restore()
}

function updateApplyButton() {
  const btn = document.getElementById('btn-apply-redact')
  if (pendingRedactions.length > 0) {
    btn.classList.remove('hidden')
    btn.textContent = `Apply ${pendingRedactions.length} Redaction${pendingRedactions.length > 1 ? 's' : ''}`
  } else {
    btn.classList.add('hidden')
  }
}

export async function applyRedactions(onDone) {
  if (pendingRedactions.length === 0) return

  const confirmed = window.confirm(
    `Permanently apply ${pendingRedactions.length} redaction(s)?\n\nThis removes the underlying content and cannot be undone.`
  )
  if (!confirmed) return

  try {
    await window.electronAPI.pyCall('apply_redactions', {})
    pendingRedactions.length = 0

    const canvas = document.getElementById('redact-canvas')
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    updateApplyButton()
    if (onDone) await onDone()
  } catch (err) {
    console.error('apply_redactions failed:', err)
    alert('Failed to apply redactions: ' + err.message)
  }
}

// ─── Text Insert Tool + Visual Field Detection ────────────────────────────────

// Detected visual fields for current page (populated by loadDetectedFields)
let detectedFields = []   // { screenRect, pdfBaseline, fontsize, isUnderline }
let textInsertCallback = null

export function initTextTool(onInserted) {
  textInsertCallback = onInserted
  const pdfCanvas = document.getElementById('pdf-canvas')

  pdfCanvas.addEventListener('click', async (e) => {
    if (activeTool !== 'text') return
    const coords = getCanvasCoords(e, pdfCanvas)

    // Check if click landed inside a detected field overlay
    const hit = detectedFields.find(f => {
      const r = f.screenRect
      return coords.x >= r.left && coords.x <= r.left + r.width &&
             coords.y >= r.top  && coords.y <= r.top  + r.height
    })

    if (hit) {
      // Click inside a detected field: open textarea sized to the field
      activateDetectedField(hit)
    } else {
      // Free-form click: snap to nearest text baseline
      await placeTextInputWithSnap(coords.x, coords.y)
    }
  })
}

// Load detected visual fields for the current page and render hint overlays
export async function loadDetectedFields(pageIndex) {
  detectedFields = []
  clearDetectedFieldOverlays()

  const viewport = getCurrentViewport()
  if (!viewport) return

  let result
  try {
    result = await window.electronAPI.pyCall('detect_fields', { page_index: pageIndex })
  } catch (e) {
    console.error('detect_fields failed:', e)
    return
  }

  console.log(`detect_fields page ${pageIndex}: ${result.fields.length} candidates`)

  const overlay = document.getElementById('text-overlay')

  for (const field of result.fields) {
    const pos = pdfRectToScreen(field.rect, viewport)
    if (pos.width < 10 || pos.height < 3) continue

    // Compute baseline Y in screen coords
    const [, baselineScreenY] = [0, field.baseline_y / viewport.scale * viewport.scale]
    // baseline_y is in PyMuPDF coords (y↓), convert to screen
    const baselineScreen = field.baseline_y * viewport.scale

    const fontSizePx = field.fontsize * viewport.scale

    detectedFields.push({
      screenRect: pos,
      pdfBaseline: field.baseline_y,
      pdfRect: field.rect,
      fontsize: field.fontsize,
      fontSizePx,
      isUnderline: field.is_underline,
    })

    // Render a dashed hint overlay
    const hint = document.createElement('div')
    hint.className = field.is_underline ? 'detected-field-underline' : 'detected-field-box'
    hint.style.left   = pos.left   + 'px'
    hint.style.top    = pos.top    + 'px'
    hint.style.width  = pos.width  + 'px'
    hint.style.height = pos.height + 'px'
    hint.title = 'Click to fill'

    // Capture field data in closure; the hint div intercepts the click,
    // so we can't rely on the canvas listener below
    const fieldData = detectedFields[detectedFields.length - 1]
    hint.addEventListener('click', (e) => {
      e.stopPropagation()
      activateDetectedField(fieldData)
    })

    overlay.appendChild(hint)
  }
}

export function clearDetectedFieldOverlays() {
  const overlay = document.getElementById('text-overlay')
  // Remove hint divs but keep any active textarea
  overlay.querySelectorAll('.detected-field-box, .detected-field-underline').forEach(el => el.remove())
}

function activateDetectedField(field) {
  // Remove hints temporarily while editing
  clearDetectedFieldOverlays()

  const overlay = document.getElementById('text-overlay')
  const r = field.screenRect

  const textarea = document.createElement('textarea')
  textarea.className = 'text-insert-input text-insert-field'
  textarea.style.left   = r.left + 'px'
  textarea.style.top    = r.top  + 'px'
  textarea.style.width  = r.width + 'px'
  textarea.style.height = r.height + 'px'
  // Match the field's font size exactly
  textarea.style.fontSize = field.fontSizePx + 'px'
  textarea.style.lineHeight = '1'
  textarea.rows = 1
  textarea.spellcheck = false

  overlay.appendChild(textarea)
  textarea.focus()

  const viewport = getCurrentViewport()
  // Insert text at baseline inside the field
  const pdfX = field.pdfRect[0] + 2   // small left padding
  const pdfY = field.pdfBaseline

  async function commit() {
    const text = textarea.value.trim()
    textarea.remove()
    // Restore hints for remaining fields
    await loadDetectedFields(getCurrentPageNum() - 1)
    if (!text) return

    try {
      await window.electronAPI.pyCall('insert_text', {
        page_index: getCurrentPageNum() - 1,
        x: pdfX,
        y: pdfY,
        text,
        fontsize: field.fontsize,
        color: [0, 0, 0],
        // Clear only the text line band around the baseline, from insertion x rightward.
        // This avoids erasing label text that may sit above or at the top of the field rect.
        clear_rect: [pdfX, field.pdfBaseline - field.fontsize * 1.2, field.pdfRect[2], field.pdfBaseline + field.fontsize * 0.4],
      })
      if (textInsertCallback) await textInsertCallback()
    } catch (err) {
      console.error('insert_text failed:', err)
      alert('Failed to insert text: ' + err.message)
    }
  }

  textarea.addEventListener('blur', commit)
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { textarea.remove(); loadDetectedFields(getCurrentPageNum() - 1); e.preventDefault() }
    else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); textarea.blur() }
  })
}

async function placeTextInputWithSnap(canvasX, canvasY) {
  const viewport = getCurrentViewport()
  const pageIndex = getCurrentPageNum() - 1
  const [pdfClickX, pdfClickY] = screenPointToPdf(canvasX, canvasY, viewport)

  // Get nearest baseline + font size from Python
  let pdfBaselineY = pdfClickY
  let fontsize = 10
  try {
    const ctx = await window.electronAPI.pyCall('get_click_context', {
      page_index: pageIndex,
      x: pdfClickX,
      y: pdfClickY,
    })
    pdfBaselineY = ctx.baseline_y
    fontsize = ctx.fontsize
  } catch (e) {
    console.warn('get_click_context failed, using raw click pos')
  }

  const fontSizePx = fontsize * viewport.scale
  // Convert snapped baseline back to screen Y
  const snappedScreenY = pdfBaselineY * viewport.scale - fontSizePx

  const overlay = document.getElementById('text-overlay')
  // Remove any existing free-form textarea (not hint divs)
  overlay.querySelectorAll('textarea').forEach(el => el.remove())

  const textarea = document.createElement('textarea')
  textarea.className = 'text-insert-input'
  textarea.style.left = canvasX + 'px'
  textarea.style.top  = snappedScreenY + 'px'
  textarea.style.fontSize = fontSizePx + 'px'
  textarea.style.lineHeight = '1'
  textarea.rows = 1
  textarea.spellcheck = false

  overlay.appendChild(textarea)
  textarea.focus()

  async function commit() {
    const text = textarea.value.trim()
    textarea.remove()
    if (!text) return

    try {
      await window.electronAPI.pyCall('insert_text', {
        page_index: pageIndex,
        x: pdfClickX,
        y: pdfBaselineY,
        text,
        fontsize,
        color: [0, 0, 0],
      })
      if (textInsertCallback) await textInsertCallback()
    } catch (err) {
      console.error('insert_text failed:', err)
      alert('Failed to insert text: ' + err.message)
    }
  }

  textarea.addEventListener('blur', commit)
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { textarea.remove(); e.preventDefault() }
    else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); textarea.blur() }
  })
  textarea.addEventListener('input', () => {
    textarea.style.width = ''
    textarea.style.width = Math.max(80, textarea.scrollWidth) + 'px'
  })
}
