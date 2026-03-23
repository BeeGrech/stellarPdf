/**
 * Redaction tests — page 2 of the fixture has "REDACT_TARGET: secret-value-1234"
 * which should be permanently removed after applying redactions.
 *
 * REDACT_TARGET is inserted at PDF coords (50, 250) baseline on a 612×792 page.
 * Mouse coordinates are derived from the canvas bounding box so the test is
 * scale-independent: scale = canvas_css_width / PAGE_WIDTH_PTS.
 */
const { test, expect } = require('@playwright/test')
const { launchApp, openFixture, FIXTURE_PDF } = require('./helpers/electron')
const { execFileSync } = require('child_process')
const path = require('path')
const os = require('os')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '../..')
const PYTHON = path.join(ROOT, 'python/venv/bin/python3')

// Page width from generate_test_pdf.py (612pt × 792pt)
const PAGE_WIDTH_PTS = 612
// REDACT_TARGET rect in PyMuPDF coords (top-left origin, y↓)
// insert_text((50, 250), ..., fontsize=12) — baseline at y=250
const REDACT_X0 = 40   // a bit left of text start
const REDACT_Y0 = 236  // above baseline by ~1 line height
const REDACT_X1 = 510  // well past end of text line
const REDACT_Y1 = 262  // below baseline

let electronApp, page

test.beforeEach(async () => {
  ;({ electronApp, page } = await launchApp())
  page.on('dialog', dialog => dialog.type() === 'confirm' ? dialog.accept() : dialog.dismiss())
})

test.afterEach(async () => {
  await electronApp.close()
})

/**
 * Navigate to page 2 and activate the Redact tool (which auto-switches to
 * single-page view), then wait for canvas render to complete.
 * Returns the screen bounding box of #redact-canvas.
 */
async function goToPage2AndActivateRedact(pg) {
  await pg.click('#btn-next')
  await pg.waitForFunction(() =>
    document.getElementById('page-label').textContent === '2 / 2'
  )

  await pg.click('#tool-redact')
  await pg.waitForFunction(
    (p) => document.getElementById('pdf-canvas').dataset.rendered === String(p),
    2,
    { timeout: 8000 }
  )

  return pg.locator('#redact-canvas').boundingBox()
}

/**
 * Drag a redaction rectangle over the REDACT_TARGET line.
 * Coordinates are derived from the canvas bounding box width so they adapt
 * automatically to any zoom level (scale = canvas_css_width / PAGE_WIDTH_PTS).
 */
async function drawRedactBox(pg, box) {
  const scale = box.width / PAGE_WIDTH_PTS
  await pg.mouse.move(box.x + REDACT_X0 * scale, box.y + REDACT_Y0 * scale)
  await pg.mouse.down()
  await pg.mouse.move(box.x + REDACT_X1 * scale, box.y + REDACT_Y1 * scale)
  await pg.mouse.up()
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test('redact tool enables canvas drawing', async () => {
  await openFixture(page)
  await page.click('#tool-redact')
  await expect(page.locator('#tool-redact')).toHaveClass(/active/)
  // Apply button should be hidden when no pending redactions
  await expect(page.locator('#btn-apply-redact')).toHaveClass(/hidden/)
})

test('drawing a redaction box shows Apply button', async () => {
  await openFixture(page)
  const box = await goToPage2AndActivateRedact(page)
  await drawRedactBox(page, box)
  await expect(page.locator('#btn-apply-redact')).not.toHaveClass(/hidden/)
})

test('applying redaction removes target text from PDF', async () => {
  const tmp = path.join(os.tmpdir(), `stellar-redact-${Date.now()}.pdf`)
  fs.copyFileSync(FIXTURE_PDF, tmp)

  await page.evaluate(async (p) => window.__testOpenFile(p), tmp)
  await page.waitForSelector('#welcome.hidden', { state: 'attached', timeout: 10000 })

  const box = await goToPage2AndActivateRedact(page)
  await drawRedactBox(page, box)

  await page.click('#btn-apply-redact')

  // Wait for status to show Saved after apply+reload
  await page.waitForFunction(
    () => document.getElementById('status-msg').textContent === 'Saved',
    { timeout: 15000 }
  )

  // Verify the target text is gone from the saved PDF
  const out = execFileSync(PYTHON, ['-c',
    `import fitz; doc = fitz.open(r"${tmp}"); ` +
    `print("FOUND" if "secret-value-1234" in doc[1].get_text() else "REMOVED")`
  ]).toString().trim()
  expect(out).toBe('REMOVED')
  fs.unlinkSync(tmp)
})
