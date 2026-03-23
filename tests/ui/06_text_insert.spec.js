/**
 * Text insertion tool tests.
 *
 * The fixture PDF has blank space on page 2 below y=300 (PDF coords).
 * We click in that blank area and verify text is persisted to the PDF.
 *
 * Page dimensions (from generate_test_pdf.py): 612×792 pts.
 * INSERT_X/Y are the click point in PDF coords.
 *
 * NOTE: In text mode #text-overlay sits above #pdf-canvas with pointer-events:auto,
 * so Playwright's click({ force:true }) is required to dispatch the event directly
 * to #pdf-canvas, bypassing hit-test order.  This is intentional for automation —
 * the detected-field hint elements work normally for interactive use.
 */
const { test, expect } = require('@playwright/test')
const { launchApp, openFixture, FIXTURE_PDF } = require('./helpers/electron')
const { execFileSync } = require('child_process')
const path = require('path')
const os = require('os')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '../..')
const PYTHON = path.join(ROOT, 'python/venv/bin/python3')

// Page width in points (used to derive scale from canvas CSS width)
const PAGE_WIDTH_PTS = 612
// Blank insertion point on page 2 in PDF coords (below all content at y≈300)
const INSERT_X = 100
const INSERT_Y = 420

const INSERT_TEXT = 'TEXT_INSERT_TEST_12345'

let electronApp, page

test.beforeEach(async () => {
  ;({ electronApp, page } = await launchApp())
})

test.afterEach(async () => {
  await electronApp.close()
})

/**
 * Navigate to page 2 in scroll mode, activate the text tool (auto-exits to
 * page view), wait for canvas render, and optionally for detected-field hints.
 * Returns the canvas bounding box.
 */
async function goToPage2AndActivateTextTool(pg) {
  await pg.click('#btn-next')
  await pg.waitForFunction(() =>
    document.getElementById('page-label').textContent === '2 / 2'
  )

  await pg.click('#tool-text')
  await pg.waitForFunction(
    (p) => document.getElementById('pdf-canvas').dataset.rendered === String(p),
    2,
    { timeout: 8000 }
  )

  // Wait for detected-field hints to appear (detect_fields RPC is async)
  await pg.waitForSelector('#text-overlay .detected-field-box, #text-overlay .detected-field-underline',
    { timeout: 8000 })

  return pg.locator('#pdf-canvas').boundingBox()
}

/**
 * Click at (pdfX, pdfY) on the PDF canvas.
 *
 * In text mode #text-overlay sits above #pdf-canvas with pointer-events:auto,
 * so browser hit-testing sends clicks to the overlay, not the canvas.
 * Dispatching the MouseEvent from inside the page context via evaluate()
 * fires it directly on the canvas element, which is how the click handler
 * (pdfCanvas.addEventListener('click', ...)) receives it.
 */
async function clickCanvas(pg, box, pdfX, pdfY) {
  const scale = box.width / PAGE_WIDTH_PTS
  await pg.evaluate(({ cx, cy }) => {
    const canvas = document.getElementById('pdf-canvas')
    const rect = canvas.getBoundingClientRect()
    canvas.dispatchEvent(new MouseEvent('click', {
      bubbles: true, cancelable: true, view: window,
      clientX: rect.left + cx,
      clientY: rect.top  + cy,
    }))
  }, { cx: pdfX * scale, cy: pdfY * scale })
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test('text tool button becomes active on click', async () => {
  await openFixture(page)
  await page.click('#tool-text')
  await expect(page.locator('#tool-text')).toHaveClass(/active/)
})

test('clicking page in text mode places a textarea', async () => {
  await openFixture(page)
  const box = await goToPage2AndActivateTextTool(page)
  await clickCanvas(page, box, INSERT_X, INSERT_Y)
  await expect(page.locator('#text-overlay textarea')).toBeVisible({ timeout: 5000 })
})

test('pressing Escape removes the textarea without inserting', async () => {
  await openFixture(page)
  const box = await goToPage2AndActivateTextTool(page)
  await clickCanvas(page, box, INSERT_X, INSERT_Y)
  await expect(page.locator('#text-overlay textarea')).toBeVisible({ timeout: 5000 })

  await page.keyboard.press('Escape')
  await expect(page.locator('#text-overlay textarea')).toHaveCount(0)
})

test('inserted text is saved to PDF and readable via PyMuPDF', async () => {
  const tmp = path.join(os.tmpdir(), `stellar-textinsert-${Date.now()}.pdf`)
  fs.copyFileSync(FIXTURE_PDF, tmp)

  await page.evaluate(async (p) => window.__testOpenFile(p), tmp)
  await page.waitForSelector('#welcome.hidden', { state: 'attached', timeout: 10000 })

  const box = await goToPage2AndActivateTextTool(page)
  await clickCanvas(page, box, INSERT_X, INSERT_Y)
  await expect(page.locator('#text-overlay textarea')).toBeVisible({ timeout: 5000 })

  await page.keyboard.type(INSERT_TEXT)
  await page.keyboard.press('Enter')

  // reloadAfterMutation saves and re-renders; wait for Saved status
  await page.waitForFunction(
    () => document.getElementById('status-msg').textContent === 'Saved',
    { timeout: 15000 }
  )

  // Verify the text appears in the saved PDF via PyMuPDF
  const out = execFileSync(PYTHON, ['-c',
    `import fitz; doc = fitz.open(r"${tmp}"); ` +
    `print("FOUND" if "${INSERT_TEXT}" in doc[1].get_text() else "MISSING")`
  ]).toString().trim()
  expect(out).toBe('FOUND')
  fs.unlinkSync(tmp)
})
