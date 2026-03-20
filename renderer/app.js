/**
 * app.js: main orchestrator
 *
 * Handles: toolbar events, file open/save, page navigation, zoom, thumbnails.
 * Imports pdfview.js for rendering and tools.js for tool UX.
 */

import {
  loadPdf,
  renderPage,
  renderThumbnail,
  getCurrentPageNum,
  getCurrentScale,
} from './pdfview.js'

import {
  setActiveTool,
  getActiveTool,
  loadFormFields,
  collectAndSaveFormFields,
  clearFormOverlays,
  initRedactionTool,
  initTextTool,
  loadDetectedFields,
  clearDetectedFieldOverlays,
  applyRedactions,
  redrawPendingRedactions,
} from './tools.js'

// ─── App state ────────────────────────────────────────────────────────────────

let currentFilePath = null
let pageCount = 0
let currentPage = 1
let scale = 1.5
let hasUnsaved = false

const ZOOM_STEPS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0]
let zoomIndex = 4  // default 1.5

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const btnOpen       = document.getElementById('btn-open')
const btnSave       = document.getElementById('btn-save')
const btnSaveAs     = document.getElementById('btn-save-as')
const btnApplyRedact= document.getElementById('btn-apply-redact')
const btnPrev       = document.getElementById('btn-prev')
const btnNext       = document.getElementById('btn-next')
const btnZoomIn     = document.getElementById('btn-zoom-in')
const btnZoomOut    = document.getElementById('btn-zoom-out')
const zoomLabel     = document.getElementById('zoom-label')
const pageLabel     = document.getElementById('page-label')
const statusMsg     = document.getElementById('status-msg')
const welcome       = document.getElementById('welcome')
const thumbnailList = document.getElementById('thumbnail-list')

// ─── Status helpers ───────────────────────────────────────────────────────────

function setStatus(msg) {
  statusMsg.textContent = msg
}

function markUnsaved() {
  if (!hasUnsaved) {
    hasUnsaved = true
    updateTitle()
  }
}

function markSaved() {
  hasUnsaved = false
  updateTitle()
}

function updateTitle() {
  if (!currentFilePath) return
  const name = currentFilePath.split('/').pop()
  window.electronAPI.setTitle(`${hasUnsaved ? '● ' : ''}${name} - PDF Editor`)
}

// ─── Page label / nav ─────────────────────────────────────────────────────────

function updatePageLabel() {
  pageLabel.textContent = `${currentPage} / ${pageCount}`
  btnPrev.disabled = currentPage <= 1
  btnNext.disabled = currentPage >= pageCount
}

// ─── File operations ──────────────────────────────────────────────────────────

async function openFile(filePath) {
  setStatus('Opening…')
  try {
    // 1. Tell Python to open (it owns the mutable doc)
    const info = await window.electronAPI.pyCall('open', { path: filePath })
    currentFilePath = filePath
    pageCount = info.page_count

    // 2. Read bytes for PDF.js (read-only rendering)
    const bytes = await window.electronAPI.readFile(filePath)

    // 3. Load into PDF.js
    await loadPdf(bytes.buffer)

    // 4. Show UI
    welcome.classList.add('hidden')
    btnSave.disabled = false
    btnSaveAs.disabled = false
    currentPage = 1
    hasUnsaved = false
    updateTitle()
    updatePageLabel()

    // 5. Render first page
    await doRenderPage(1)

    // 6. Render thumbnails (async, non-blocking)
    renderAllThumbnails()

    setStatus(`Opened: ${pageCount} page${pageCount !== 1 ? 's' : ''}`)
  } catch (err) {
    console.error('openFile failed:', err)
    setStatus('Failed to open file')
    alert('Could not open PDF:\n' + err.message)
  }
}

async function doRenderPage(pageNum) {
  clearFormOverlays()

  const viewport = await renderPage(pageNum, scale)
  if (!viewport) return

  currentPage = pageNum
  updatePageLabel()
  updateActiveThumbnail()
  redrawPendingRedactions()

  // Reload tool overlays for new page
  if (getActiveTool() === 'fill') {
    await loadFormFields(pageNum - 1)
  } else if (getActiveTool() === 'text') {
    await loadDetectedFields(pageNum - 1)
  }
}

// After a write operation (redaction / text insert), the Python doc is mutated.
// Save → re-read file bytes → re-load into PDF.js → re-render.
async function reloadAfterMutation() {
  setStatus('Saving…')
  try {
    await window.electronAPI.pyCall('save', { path: currentFilePath })
    const bytes = await window.electronAPI.readFile(currentFilePath)
    await loadPdf(bytes.buffer)
    await doRenderPage(currentPage)
    markSaved()
    setStatus('Saved')
  } catch (err) {
    console.error('reloadAfterMutation failed:', err)
    setStatus('Save failed')
    alert('Save failed: ' + err.message)
  }
}

async function saveFile() {
  if (!currentFilePath) return saveFileAs()
  setStatus('Saving…')
  try {
    await collectAndSaveFormFields(currentPage - 1)
    await window.electronAPI.pyCall('save', { path: currentFilePath })
    markSaved()
    setStatus('Saved')
  } catch (err) {
    console.error('save failed:', err)
    setStatus('Save failed')
    alert('Save failed: ' + err.message)
  }
}

async function saveFileAs() {
  const savePath = await window.electronAPI.saveFileDialog(currentFilePath)
  if (!savePath) return
  setStatus('Saving…')
  try {
    await collectAndSaveFormFields(currentPage - 1)
    await window.electronAPI.pyCall('save', { path: savePath })
    currentFilePath = savePath
    markSaved()
    setStatus('Saved as ' + savePath.split('/').pop())
  } catch (err) {
    console.error('saveAs failed:', err)
    setStatus('Save failed')
    alert('Save failed: ' + err.message)
  }
}

// ─── Thumbnails ───────────────────────────────────────────────────────────────

async function renderAllThumbnails() {
  thumbnailList.innerHTML = ''
  for (let i = 1; i <= pageCount; i++) {
    const item = document.createElement('div')
    item.className = 'thumb-item'
    item.dataset.page = i
    if (i === currentPage) item.classList.add('active')

    const thumbCanvas = document.createElement('canvas')
    const label = document.createElement('span')
    label.textContent = i

    item.appendChild(thumbCanvas)
    item.appendChild(label)
    thumbnailList.appendChild(item)

    item.addEventListener('click', async () => {
      if (i === currentPage) return
      await doRenderPage(i)
    })

    // Render async with small delay to avoid blocking
    setTimeout(() => renderThumbnail(i, thumbCanvas), i * 30)
  }
}

function updateActiveThumbnail() {
  document.querySelectorAll('.thumb-item').forEach(item => {
    item.classList.toggle('active', parseInt(item.dataset.page) === currentPage)
  })
  // Scroll active thumbnail into view
  const active = thumbnailList.querySelector('.thumb-item.active')
  if (active) active.scrollIntoView({ block: 'nearest' })
}

// ─── Toolbar event wiring ─────────────────────────────────────────────────────

btnOpen.addEventListener('click', async () => {
  const filePath = await window.electronAPI.openFileDialog()
  if (filePath) await openFile(filePath)
})

document.getElementById('welcome-open-btn').addEventListener('click', async () => {
  const filePath = await window.electronAPI.openFileDialog()
  if (filePath) await openFile(filePath)
})

btnSave.addEventListener('click', () => saveFile())
btnSaveAs.addEventListener('click', () => saveFileAs())

btnApplyRedact.addEventListener('click', () => {
  applyRedactions(async () => {
    await reloadAfterMutation()
  })
})

btnPrev.addEventListener('click', async () => {
  if (currentPage > 1) await doRenderPage(currentPage - 1)
})

btnNext.addEventListener('click', async () => {
  if (currentPage < pageCount) await doRenderPage(currentPage + 1)
})

btnZoomIn.addEventListener('click', async () => {
  if (zoomIndex < ZOOM_STEPS.length - 1) {
    zoomIndex++
    scale = ZOOM_STEPS[zoomIndex]
    zoomLabel.textContent = Math.round(scale * 100) + '%'
    await doRenderPage(currentPage)
  }
})

btnZoomOut.addEventListener('click', async () => {
  if (zoomIndex > 0) {
    zoomIndex--
    scale = ZOOM_STEPS[zoomIndex]
    zoomLabel.textContent = Math.round(scale * 100) + '%'
    await doRenderPage(currentPage)
  }
})

// Tool buttons
document.getElementById('tool-select').addEventListener('click', () => setActiveTool('select'))
document.getElementById('tool-fill').addEventListener('click', async () => {
  setActiveTool('fill')
  if (currentFilePath) await loadFormFields(currentPage - 1)
})
document.getElementById('tool-redact').addEventListener('click', () => setActiveTool('redact'))
document.getElementById('tool-text').addEventListener('click', async () => {
  setActiveTool('text')
  if (currentFilePath) await loadDetectedFields(currentPage - 1)
})

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────

document.addEventListener('keydown', async (e) => {
  if (e.ctrlKey && e.key === 'o') { e.preventDefault(); btnOpen.click() }
  if (e.ctrlKey && e.shiftKey && e.key === 'S') { e.preventDefault(); saveFileAs() }
  if (e.ctrlKey && !e.shiftKey && e.key === 's') { e.preventDefault(); saveFile() }
  if (e.ctrlKey && e.key === 'z' && currentFilePath) {
    e.preventDefault()
    const result = await window.electronAPI.pyCall('undo', {})
    if (result.ok) {
      await reloadAfterMutation()
      setStatus(result.remaining > 0 ? `Undo — ${result.remaining} more available` : 'Undo — no more history')
    } else {
      setStatus('Nothing to undo')
    }
  }
  if (e.key === 'ArrowLeft'  && currentPage > 1)         { await doRenderPage(currentPage - 1) }
  if (e.key === 'ArrowRight' && currentPage < pageCount) { await doRenderPage(currentPage + 1) }
  if (e.key === '+' || e.key === '=') { btnZoomIn.click() }
  if (e.key === '-') { btnZoomOut.click() }
})

// Form fields loaded feedback
document.addEventListener('form-fields-loaded', async (e) => {
  const n = e.detail.count
  if (n === 0) {
    setStatus('No form fields found on this page; running diagnosis…')
    try {
      const diag = await window.electronAPI.pyCall('diagnose', {})
      console.log('DIAGNOSIS:', JSON.stringify(diag, null, 2))
      const totalWidgets = diag.pages.reduce((sum, p) => sum + p.widget_count, 0)
      if (diag.xfa) {
        setStatus('PDF uses XFA forms (Adobe LiveCycle); not supported by AcroForm reader')
      } else if (!diag.acroform) {
        setStatus('PDF has no AcroForm dictionary; no fillable form fields detected')
      } else if (totalWidgets === 0) {
        setStatus('AcroForm found but 0 widgets detected; PDF may use unsupported form encoding')
      } else {
        const onOtherPages = diag.pages
          .filter(p => p.page !== currentPage - 1 && p.widget_count > 0)
          .map(p => `page ${p.page + 1} (${p.widget_count} fields)`)
        if (onOtherPages.length) {
          setStatus(`No fields on this page. Fields found on: ${onOtherPages.join(', ')}`)
        } else {
          setStatus(`Fields detected (${totalWidgets} total) but none visible; check DevTools console`)
        }
      }
    } catch (err) {
      setStatus('No form fields found on this page')
    }
  } else {
    setStatus(`${n} form field${n !== 1 ? 's' : ''}; click to fill`)
  }
})

// ─── Donate modal ─────────────────────────────────────────────────────────────

const ETH_ADDR = '0x80D870e56AAF468545471f7Ac92AEbc493FBF6B1'
const BTC_ADDR = '1N19qKsCEQW4afSbAbM6vtVUZvWZDgRWXF'
const XMR_ADDR = '49xjr7jRLswMrJ47SnvQsR8xvKM13gv1BiWxJM8JtxQhEfhwM64hXJFin5DvsUAp2QQ3dGzZFoCoa8HYe1oiJS1BBDQPP7C'
const KOFI_URL = 'https://ko-fi.com/rom12two'

const donateModal = document.getElementById('donate-modal')
let selectedEthAmount = 0.01
let qrRendered = { eth: false, btc: false, xmr: false }

function openDonateModal(startCoin = 'eth') {
  donateModal.classList.remove('hidden')
  switchCoin(startCoin)
}

function closeDonateModal() {
  donateModal.classList.add('hidden')
}

function setModalStatus(msg, color = '#4caf50') {
  const el = document.getElementById('modal-copy-status')
  el.style.color = color
  el.textContent = msg
  setTimeout(() => { el.textContent = '' }, 2500)
}

function switchCoin(coin) {
  document.querySelectorAll('.coin-tab').forEach(t => t.classList.toggle('active', t.dataset.coin === coin))
  document.querySelectorAll('.coin-panel').forEach(p => p.classList.add('hidden'))
  document.getElementById(`panel-${coin}`).classList.remove('hidden')

  // Render QR codes lazily: generate in main process, display as img
  async function renderQR(imgId, text) {
    const dataUrl = await window.electronAPI.generateQR(text)
    document.getElementById(imgId).src = dataUrl
  }

  if (coin === 'eth' && !qrRendered.eth) {
    renderQR('qr-eth', `ethereum:${ETH_ADDR}`)
    qrRendered.eth = true
  } else if (coin === 'btc' && !qrRendered.btc) {
    renderQR('qr-btc', `bitcoin:${BTC_ADDR}`)
    qrRendered.btc = true
  } else if (coin === 'xmr' && !qrRendered.xmr) {
    renderQR('qr-xmr', `monero:${XMR_ADDR}`)
    qrRendered.xmr = true
  }
}

// Coin tab switching
document.querySelectorAll('.coin-tab').forEach(tab => {
  tab.addEventListener('click', () => switchCoin(tab.dataset.coin))
})

// Amount picker
document.querySelectorAll('.amount-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.amount-btn').forEach(b => b.classList.remove('selected'))
    btn.classList.add('selected')
    selectedEthAmount = parseFloat(btn.dataset.eth)
    document.getElementById('eth-custom').value = ''
  })
})

document.getElementById('eth-custom').addEventListener('input', (e) => {
  const val = parseFloat(e.target.value)
  if (val > 0) {
    selectedEthAmount = val
    document.querySelectorAll('.amount-btn').forEach(b => b.classList.remove('selected'))
  }
})

// MetaMask button: opens ethereum: URI in system browser where MetaMask extension lives
document.getElementById('btn-metamask').addEventListener('click', () => {
  const weiHex = '0x' + Math.floor(selectedEthAmount * 1e18).toString(16)
  const uri = `ethereum:${ETH_ADDR}?value=${weiHex}`
  window.electronAPI.openExternal(uri)
  setModalStatus(`Opening MetaMask for ${selectedEthAmount} ETH...`)
})

// Ko-fi button: open in-app browser window
document.getElementById('btn-kofi-open').addEventListener('click', () => {
  window.electronAPI.openBrowser(KOFI_URL, 'Ko-fi: Support PDF Editor')
})

// Copy buttons inside modal
document.querySelectorAll('.copy-btn[data-copy]').forEach(btn => {
  btn.addEventListener('click', () => {
    const text = document.getElementById(btn.dataset.copy).textContent
    navigator.clipboard.writeText(text).then(() => setModalStatus('Address copied!'))
  })
})

// Close modal
document.getElementById('donate-modal-close').addEventListener('click', closeDonateModal)
donateModal.addEventListener('click', (e) => { if (e.target === donateModal) closeDonateModal() })
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !donateModal.classList.contains('hidden')) closeDonateModal() })

// Toolbar donate buttons: open modal to right coin panel, copy still works on small buttons
document.querySelectorAll('.donate-btn[data-address]').forEach(btn => {
  btn.addEventListener('click', () => {
    const coin = btn.classList.contains('btc') ? 'btc' : btn.classList.contains('xmr') ? 'xmr' : 'eth'
    openDonateModal(coin)
  })
})

// Ko-fi toolbar button opens modal
document.querySelector('.donate-btn.kofi').addEventListener('click', (e) => {
  e.preventDefault()
  openDonateModal('kofi')
})

// ─── Test hook (Playwright) ───────────────────────────────────────────────────
// Exposed only so UI tests can open a PDF without triggering the file dialog.
window.__testOpenFile = openFile

// ─── Init ─────────────────────────────────────────────────────────────────────

setActiveTool('select')
document.body.dataset.tool = 'select'

initRedactionTool()
initTextTool(async () => {
  await reloadAfterMutation()
})
