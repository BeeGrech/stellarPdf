/**
 * Undo tests — verifies Ctrl+Z reverts the last mutation.
 */
const { test, expect } = require('@playwright/test')
const { launchApp, openFixture, FIXTURE_PDF } = require('./helpers/electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

let electronApp, page

test.beforeEach(async () => {
  ;({ electronApp, page } = await launchApp())
})

test.afterEach(async () => {
  await electronApp.close()
})

test('undo reverts form field fill', async () => {
  const tmp = path.join(os.tmpdir(), `stellar-undo-${Date.now()}.pdf`)
  fs.copyFileSync(FIXTURE_PDF, tmp)

  await page.evaluate(async (p) => window.__testOpenFile(p), tmp)
  await page.waitForSelector('#welcome.hidden', { state: 'attached', timeout: 10000 })

  // Fill a field
  await page.click('#tool-fill')
  await page.waitForSelector('.form-field-overlay[data-field-name="full_name"] input', { timeout: 8000 })
  await page.fill('.form-field-overlay[data-field-name="full_name"] input', 'Before Undo')
  await page.keyboard.press('Control+s')
  await page.waitForFunction(
    () => document.getElementById('status-msg').textContent === 'Saved',
    { timeout: 8000 }
  )

  // Undo
  await page.keyboard.press('Control+z')
  await page.waitForFunction(
    () => document.getElementById('status-msg').textContent.startsWith('Saved'),
    { timeout: 8000 }
  )

  // Verify via Python the field is now empty again
  const result = await electronApp.evaluate(async ({}, filePath) => {
    const { execFileSync } = require('child_process')
    const pythonBin = require('path').join(process.cwd(), 'python/venv/bin/python3')
    const out = execFileSync(pythonBin, ['-c', `
import fitz, json
doc = fitz.open(r"${filePath}")
fields = {w.field_name: w.field_value for w in doc[0].widgets()}
print(json.dumps(fields))
`]).toString()
    return JSON.parse(out)
  }, tmp)

  expect(result['full_name'] ?? '').toBe('')
  fs.unlinkSync(tmp)
})

test('status message shows nothing to undo when stack is empty', async () => {
  await openFixture(page)
  await page.keyboard.press('Control+z')
  await page.waitForFunction(
    () => document.getElementById('status-msg').textContent === 'Nothing to undo',
    { timeout: 5000 }
  )
})
