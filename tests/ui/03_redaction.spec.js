/**
 * Redaction tests — page 2 of the fixture has "REDACT_TARGET: secret-value-1234"
 * which should be permanently removed after applying redactions.
 */
const { test, expect } = require('@playwright/test')
const { launchApp, openFixture, FIXTURE_PDF } = require('./helpers/electron')
const { execFileSync } = require('child_process')
const path = require('path')
const os = require('os')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '../..')
const PYTHON = path.join(ROOT, 'python/venv/bin/python3')

let electronApp, page

test.beforeEach(async () => {
  ;({ electronApp, page } = await launchApp())
  page.on('dialog', dialog => dialog.type() === 'confirm' ? dialog.accept() : dialog.dismiss())
})

test.afterEach(async () => {
  await electronApp.close()
})

test('redact tool enables canvas drawing', async () => {
  await openFixture(page)
  await page.click('#tool-redact')
  await expect(page.locator('#tool-redact')).toHaveClass(/active/)
  // Apply button should be hidden when no pending redactions
  await expect(page.locator('#btn-apply-redact')).toHaveClass(/hidden/)
})

test('drawing a redaction box shows Apply button', async () => {
  await openFixture(page)

  // Navigate to page 2 where the redaction target is
  await page.click('#btn-next')
  await page.waitForFunction(() =>
    document.getElementById('page-label').textContent === '2 / 2'
  )

  await page.click('#tool-redact')

  const canvas = page.locator('#redact-canvas')
  const box = await canvas.boundingBox()

  // Draw a box roughly over the REDACT_TARGET text (upper portion of page)
  await page.mouse.move(box.x + 30, box.y + 150)
  await page.mouse.down()
  await page.mouse.move(box.x + 400, box.y + 175)
  await page.mouse.up()

  await expect(page.locator('#btn-apply-redact')).not.toHaveClass(/hidden/)
})

test('applying redaction removes target text from PDF', async () => {
  const tmp = path.join(os.tmpdir(), `stellar-redact-${Date.now()}.pdf`)
  fs.copyFileSync(FIXTURE_PDF, tmp)

  await page.evaluate(async (p) => window.__testOpenFile(p), tmp)
  await page.waitForSelector('#welcome.hidden', { state: 'attached', timeout: 10000 })

  await page.click('#btn-next')
  await page.waitForFunction(() =>
    document.getElementById('page-label').textContent === '2 / 2'
  )

  await page.click('#tool-redact')

  const canvas = page.locator('#redact-canvas')
  const box = await canvas.boundingBox()

  await page.mouse.move(box.x + 20, box.y + 330)
  await page.mouse.down()
  await page.mouse.move(box.x + 500, box.y + 395)
  await page.mouse.up()

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
