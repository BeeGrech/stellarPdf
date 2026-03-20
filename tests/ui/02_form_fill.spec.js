/**
 * Form fill tests — uses AcroForm fields on page 1 of the fixture PDF.
 * After filling and saving, the test re-opens the PDF via PyMuPDF
 * and verifies the values were persisted.
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

test('fill tool loads form fields on page 1', async () => {
  await openFixture(page)
  await page.click('#tool-fill')
  // Wait for overlay inputs to appear
  await page.waitForSelector('.form-field-overlay', { timeout: 8000 })
  const fields = await page.locator('.form-field-overlay').count()
  expect(fields).toBeGreaterThan(0)
})

test('text field overlay accepts input', async () => {
  await openFixture(page)
  await page.click('#tool-fill')
  await page.waitForSelector('.form-field-overlay[data-field-name="full_name"] input', { timeout: 8000 })
  await page.fill('.form-field-overlay[data-field-name="full_name"] input', 'Jane Doe')
  const val = await page.inputValue('.form-field-overlay[data-field-name="full_name"] input')
  expect(val).toBe('Jane Doe')
})

test('save persists form field value to PDF', async () => {
  // Copy fixture to a temp file so we don't mutate the committed fixture
  const tmp = path.join(os.tmpdir(), `stellar-test-${Date.now()}.pdf`)
  fs.copyFileSync(FIXTURE_PDF, tmp)

  await page.evaluate(async (p) => window.__testOpenFile(p), tmp)
  await page.waitForSelector('#welcome.hidden', { state: 'attached', timeout: 10000 })

  await page.click('#tool-fill')
  await page.waitForSelector('.form-field-overlay[data-field-name="full_name"] input', { timeout: 8000 })
  await page.fill('.form-field-overlay[data-field-name="full_name"] input', 'Test User')

  await page.keyboard.press('Control+s')
  await page.waitForFunction(
    () => document.getElementById('status-msg').textContent === 'Saved',
    { timeout: 8000 }
  )

  // Verify via Python directly from the test process
  const out = execFileSync(PYTHON, ['-c',
    `import fitz, json; doc = fitz.open(r"${tmp}"); ` +
    `print(json.dumps({w.field_name: w.field_value for w in doc[0].widgets()}))`
  ]).toString()
  const fields = JSON.parse(out)
  expect(fields['full_name']).toBe('Test User')
  fs.unlinkSync(tmp)
})
