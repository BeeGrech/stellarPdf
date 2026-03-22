/**
 * Installed package smoke tests.
 * Runs against a built + installed binary (AppImage / deb / rpm).
 * Requires STELLAR_BINARY_PATH env var pointing to the electron binary.
 *
 * Used by the package-test CI workflow, not the regular source test suite.
 */
const { test, expect } = require('@playwright/test')
const { launchInstalled, openFixture } = require('./helpers/electron')

let electronApp, page

test.beforeEach(async () => {
  ;({ electronApp, page } = await launchInstalled())
})

test.afterEach(async () => {
  await electronApp.close()
})

test('app launches and shows welcome screen', async () => {
  await expect(page.locator('#welcome')).toBeVisible()
  await expect(page.locator('h2')).toHaveText('Stellar PDF')
})

test('Python backend starts without error', async () => {
  // Verify no backend error dialog is visible - catches broken Python binary
  // (e.g. non-portable venv, code 127, missing interpreter)
  await expect(page.locator('.error-dialog, [class*="error"]').filter({ hasText: 'Backend Error' })).not.toBeVisible()
  await expect(page.locator('body')).not.toContainText('PDF server exited')
  await expect(page.locator('body')).not.toContainText('Please restart the application')
})

test('Python backend responds to RPC: open PDF and return fields', async () => {
  // The only way this passes is if the backend process started, received the
  // open+get_fields RPC calls, and returned valid data. A missing or broken
  // binary (ENOENT, code 127) will leave the fill overlay empty.
  await openFixture(page)
  await page.locator('#tool-fill').click()
  await expect(page.locator('.form-field-overlay').first()).toBeVisible({ timeout: 5000 })
})

test('toolbar is rendered with expected buttons', async () => {
  await expect(page.locator('#btn-open')).toBeVisible()
  await expect(page.locator('#btn-save')).toBeVisible()
  await expect(page.locator('#tool-select')).toBeVisible()
  await expect(page.locator('#tool-fill')).toBeVisible()
  await expect(page.locator('#tool-redact')).toBeVisible()
  await expect(page.locator('#tool-text')).toBeVisible()
})

test('save and save-as buttons are disabled before opening a file', async () => {
  await expect(page.locator('#btn-save')).toBeDisabled()
  await expect(page.locator('#btn-save-as')).toBeDisabled()
})

test('zoom label shows default zoom level', async () => {
  await expect(page.locator('#zoom-label')).toHaveText('150%')
})

test('welcome open button is clickable', async () => {
  // Just verify the button exists and is enabled — don't actually open a dialog
  await expect(page.locator('#welcome-open-btn')).toBeEnabled()
})
