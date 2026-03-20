const { test, expect } = require('@playwright/test')
const { launchApp, openFixture } = require('./helpers/electron')

let electronApp, page

test.beforeEach(async () => {
  ;({ electronApp, page } = await launchApp())
})

test.afterEach(async () => {
  await electronApp.close()
})

test('welcome screen is shown on launch', async () => {
  await expect(page.locator('#welcome')).toBeVisible()
  await expect(page.locator('#welcome')).not.toHaveClass(/hidden/)
})

test('opens fixture PDF and renders first page', async () => {
  await openFixture(page)
  await expect(page.locator('#welcome')).toHaveClass(/hidden/)
  const label = await page.locator('#page-label').textContent()
  expect(label).toMatch(/1 \/ 2/)
})

test('toolbar buttons are enabled after open', async () => {
  await openFixture(page)
  await expect(page.locator('#btn-save')).not.toBeDisabled()
  await expect(page.locator('#btn-save-as')).not.toBeDisabled()
})

test('page navigation works', async () => {
  await openFixture(page)
  await page.click('#btn-next')
  await expect(page.locator('#page-label')).toHaveText('2 / 2')
  await page.click('#btn-prev')
  await expect(page.locator('#page-label')).toHaveText('1 / 2')
})

test('zoom in and out updates label', async () => {
  await openFixture(page)
  const initial = await page.locator('#zoom-label').textContent()
  await page.click('#btn-zoom-in')
  const zoomed = await page.locator('#zoom-label').textContent()
  expect(zoomed).not.toBe(initial)
  await page.click('#btn-zoom-out')
  expect(await page.locator('#zoom-label').textContent()).toBe(initial)
})

test('tool buttons switch active state', async () => {
  await openFixture(page)
  await page.click('#tool-redact')
  await expect(page.locator('#tool-redact')).toHaveClass(/active/)
  await expect(page.locator('#tool-select')).not.toHaveClass(/active/)
  await page.click('#tool-select')
  await expect(page.locator('#tool-select')).toHaveClass(/active/)
})
