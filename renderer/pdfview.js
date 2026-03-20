/**
 * pdfview.js: PDF.js rendering + coordinate transforms
 *
 * COORDINATE SYSTEM NOTE:
 *   PyMuPDF: top-left origin, y increases downward  (same as screen)
 *   PDF spec: bottom-left origin, y increases upward
 *   PDF.js viewport.convertToViewportRectangle() expects PDF spec coords.
 *   So when converting PyMuPDF rects → screen, we flip Y first.
 */

import * as pdfjsLib from '../node_modules/pdfjs-dist/build/pdf.mjs'

// Use local worker (required for CSP compliance)
pdfjsLib.GlobalWorkerOptions.workerSrc =
  new URL('../node_modules/pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href

let pdfDoc = null          // pdfjsLib.PDFDocumentProxy
let currentPageNum = 1     // 1-based
let currentScale = 1.5
let currentViewport = null // pdfjsLib.PageViewport, used by coord transforms

const canvas = document.getElementById('pdf-canvas')
const ctx = canvas.getContext('2d')

// ─── Load ────────────────────────────────────────────────────────────────────

export async function loadPdf(arrayBuffer) {
  if (pdfDoc) {
    await pdfDoc.destroy()
    pdfDoc = null
  }
  pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  currentPageNum = 1
  return pdfDoc.numPages
}

export function getPdfDoc() { return pdfDoc }
export function getCurrentPageNum() { return currentPageNum }
export function getCurrentScale() { return currentScale }
export function getCurrentViewport() { return currentViewport }

// ─── Render ──────────────────────────────────────────────────────────────────

export async function renderPage(pageNum, scale) {
  if (!pdfDoc) return null
  currentPageNum = pageNum
  currentScale = scale

  const page = await pdfDoc.getPage(pageNum)
  const viewport = page.getViewport({ scale })
  currentViewport = viewport

  const pixelRatio = window.devicePixelRatio || 1
  const cssWidth  = Math.floor(viewport.width)
  const cssHeight = Math.floor(viewport.height)
  const physWidth  = Math.floor(viewport.width  * pixelRatio)
  const physHeight = Math.floor(viewport.height * pixelRatio)

  canvas.width  = physWidth
  canvas.height = physHeight
  canvas.style.width  = cssWidth  + 'px'
  canvas.style.height = cssHeight + 'px'

  // Size #page-container and all overlay layers
  const container = document.getElementById('page-container')
  container.style.width  = cssWidth  + 'px'
  container.style.height = cssHeight + 'px'

  const redactCanvas = document.getElementById('redact-canvas')
  redactCanvas.width  = physWidth
  redactCanvas.height = physHeight
  redactCanvas.style.width  = cssWidth  + 'px'
  redactCanvas.style.height = cssHeight + 'px'

  // Clear any previous content
  ctx.clearRect(0, 0, physWidth, physHeight)

  const transform = pixelRatio !== 1
    ? [pixelRatio, 0, 0, pixelRatio, 0, 0]
    : null

  await page.render({
    canvasContext: ctx,
    viewport,
    transform,
  }).promise

  return viewport
}

// ─── Thumbnail ───────────────────────────────────────────────────────────────

export async function renderThumbnail(pageNum, thumbCanvas) {
  if (!pdfDoc) return
  const THUMB_SCALE = 0.18
  const page = await pdfDoc.getPage(pageNum)
  const viewport = page.getViewport({ scale: THUMB_SCALE })

  const pixelRatio = window.devicePixelRatio || 1
  thumbCanvas.width  = Math.floor(viewport.width  * pixelRatio)
  thumbCanvas.height = Math.floor(viewport.height * pixelRatio)
  thumbCanvas.style.width  = Math.floor(viewport.width)  + 'px'
  thumbCanvas.style.height = Math.floor(viewport.height) + 'px'

  const thumbCtx = thumbCanvas.getContext('2d')
  const transform = pixelRatio !== 1 ? [pixelRatio, 0, 0, pixelRatio, 0, 0] : null
  await page.render({ canvasContext: thumbCtx, viewport, transform }).promise
}

// ─── Coordinate transforms ────────────────────────────────────────────────────

/**
 * Convert a PyMuPDF rect [x0, y0, x1, y1] (top-left origin, y↓)
 * to screen-space CSS pixels { left, top, width, height }.
 *
 * PDF.js viewport.convertToViewportRectangle() expects PDF spec coords
 * (bottom-left origin, y↑), so we flip Y relative to the page height first.
 */
export function pdfRectToScreen(pdfRect, viewport) {
  // viewport.viewBox = [x, y, width, height] in PDF user-space points
  const pageHeight = viewport.viewBox[3]

  // PyMuPDF [x0, y0, x1, y1] (y0 = top, y1 = bottom) →
  // PDF spec [x0, y0, x1, y1] (y0 = bottom, y1 = top)
  const pdfSpecRect = [
    pdfRect[0],
    pageHeight - pdfRect[3],  // flip: PyMuPDF y1 (bottom) → PDF spec y0 (bottom)
    pdfRect[2],
    pageHeight - pdfRect[1],  // flip: PyMuPDF y0 (top)    → PDF spec y1 (top)
  ]

  // Returns [left, top, right, bottom] in viewport CSS pixels
  const v = viewport.convertToViewportRectangle(pdfSpecRect)
  return {
    left:   Math.round(Math.min(v[0], v[2])),
    top:    Math.round(Math.min(v[1], v[3])),
    width:  Math.round(Math.abs(v[2] - v[0])),
    height: Math.round(Math.abs(v[3] - v[1])),
  }
}

/**
 * Convert a screen point (CSS pixels relative to canvas top-left)
 * to PyMuPDF coordinates [x, y] (top-left origin, y↓).
 *
 * Because both PyMuPDF and screen share top-left origin (y↓),
 * this is simply dividing by scale; no Y flip needed.
 */
export function screenPointToPdf(sx, sy, viewport) {
  return [sx / viewport.scale, sy / viewport.scale]
}

/**
 * Convert a screen rect { left, top, width, height } (CSS pixels)
 * to a PyMuPDF rect [x0, y0, x1, y1].
 */
export function screenRectToPdf(left, top, width, height, viewport) {
  const [x0, y0] = screenPointToPdf(left, top, viewport)
  const [x1, y1] = screenPointToPdf(left + width, top + height, viewport)
  return [
    Math.min(x0, x1),
    Math.min(y0, y1),
    Math.max(x0, x1),
    Math.max(y0, y1),
  ]
}

/**
 * Get pointer event coordinates relative to the canvas element.
 * Always use getBoundingClientRect; offsetX/Y are broken when
 * there are overlapping sibling elements capturing pointer events.
 */
export function getCanvasCoords(event, targetEl) {
  const rect = targetEl.getBoundingClientRect()
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  }
}
