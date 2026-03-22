/**
 * Continuous scroll view tests.
 *
 * Verifies that the app launches in scroll mode by default, that all pages
 * are rendered as .page-block elements, that the Single Page / Continuous
 * toggle works in both directions, and that editing tools auto-switch back
 * to single-page view.
 *
 * Fixture PDF has 2 pages.
 */
const { test, expect } = require('@playwright/test')
const { launchApp, openFixture } = require('./helpers/electron')

let electronApp, page

test.beforeEach(async () => {
  ;({ electronApp, page } = await launchApp())
})

test.afterEach(async () => {
  await electronApp.close()
})

// ── Default state ─────────────────────────────────────────────────────────────

test('app launches in continuous scroll mode by default', async () => {
  await expect(page.locator('#btn-view-scroll')).toHaveText('Single Page')
  await expect(page.locator('#btn-view-scroll')).toHaveClass(/active/)
})

// ── Open in scroll mode ───────────────────────────────────────────────────────

test('opening a PDF renders all pages in scroll container', async () => {
  await openFixture(page)
  await expect(page.locator('.page-block')).toHaveCount(2, { timeout: 10000 })
  await expect(page.locator('#scroll-container')).toBeVisible()
  await expect(page.locator('#page-container')).toBeHidden()
})

test('each page block has a rendered canvas', async () => {
  await openFixture(page)
  await expect(page.locator('.page-block')).toHaveCount(2, { timeout: 10000 })
  await expect(page.locator('.page-block canvas').first()).toBeVisible()
  await expect(page.locator('.page-block canvas').last()).toBeVisible()
})

// ── Toggle: scroll → page ─────────────────────────────────────────────────────

test('clicking Single Page switches to page view', async () => {
  await openFixture(page)
  await expect(page.locator('.page-block')).toHaveCount(2, { timeout: 10000 })

  await page.click('#btn-view-scroll')

  await expect(page.locator('#btn-view-scroll')).toHaveText('Continuous')
  await expect(page.locator('#btn-view-scroll')).not.toHaveClass(/active/)
  await expect(page.locator('#page-container')).toBeVisible()
  await expect(page.locator('#scroll-container')).toBeHidden()
})

test('switching to page view preserves current page number', async () => {
  await openFixture(page)
  await expect(page.locator('.page-block')).toHaveCount(2, { timeout: 10000 })

  // Navigate to page 2 in scroll mode via next button
  await page.click('#btn-next')
  await expect(page.locator('#page-label')).toHaveText('2 / 2')

  // Switch to page view — should still be on page 2
  await page.click('#btn-view-scroll')
  await expect(page.locator('#page-label')).toHaveText('2 / 2')
})

// ── Toggle: page → scroll ─────────────────────────────────────────────────────

test('clicking Continuous from page view re-renders all pages', async () => {
  await openFixture(page)
  await expect(page.locator('.page-block')).toHaveCount(2, { timeout: 10000 })

  await page.click('#btn-view-scroll')  // -> single page
  await expect(page.locator('#scroll-container')).toBeHidden()

  await page.click('#btn-view-scroll')  // -> continuous
  await expect(page.locator('#btn-view-scroll')).toHaveText('Single Page')
  await expect(page.locator('.page-block')).toHaveCount(2, { timeout: 10000 })
})

// ── Navigation in scroll mode ─────────────────────────────────────────────────

test('next and prev buttons update page label in scroll mode', async () => {
  await openFixture(page)
  await expect(page.locator('.page-block')).toHaveCount(2, { timeout: 10000 })

  await expect(page.locator('#page-label')).toHaveText('1 / 2')
  await page.click('#btn-next')
  await expect(page.locator('#page-label')).toHaveText('2 / 2')
  await page.click('#btn-prev')
  await expect(page.locator('#page-label')).toHaveText('1 / 2')
})

test('prev is disabled on first page and next is disabled on last page in scroll mode', async () => {
  await openFixture(page)
  await expect(page.locator('.page-block')).toHaveCount(2, { timeout: 10000 })

  await expect(page.locator('#btn-prev')).toBeDisabled()
  await expect(page.locator('#btn-next')).not.toBeDisabled()

  await page.click('#btn-next')
  await expect(page.locator('#btn-next')).toBeDisabled()
  await expect(page.locator('#btn-prev')).not.toBeDisabled()
})

// ── Tool auto-switch ──────────────────────────────────────────────────────────

test('selecting Fill tool switches to single page view', async () => {
  await openFixture(page)
  await expect(page.locator('.page-block')).toHaveCount(2, { timeout: 10000 })

  await page.click('#tool-fill')

  await expect(page.locator('#page-container')).toBeVisible()
  await expect(page.locator('#btn-view-scroll')).toHaveText('Continuous')
})

test('selecting Redact tool switches to single page view', async () => {
  await openFixture(page)
  await expect(page.locator('.page-block')).toHaveCount(2, { timeout: 10000 })

  await page.click('#tool-redact')

  await expect(page.locator('#page-container')).toBeVisible()
  await expect(page.locator('#btn-view-scroll')).toHaveText('Continuous')
})

test('selecting Text tool switches to single page view', async () => {
  await openFixture(page)
  await expect(page.locator('.page-block')).toHaveCount(2, { timeout: 10000 })

  await page.click('#tool-text')

  await expect(page.locator('#page-container')).toBeVisible()
  await expect(page.locator('#btn-view-scroll')).toHaveText('Continuous')
})

// ── Zoom in scroll mode ───────────────────────────────────────────────────────

test('zoom updates label and re-renders all pages in scroll mode', async () => {
  await openFixture(page)
  await expect(page.locator('.page-block')).toHaveCount(2, { timeout: 10000 })

  const before = await page.locator('#zoom-label').textContent()
  await page.click('#btn-zoom-in')
  await expect(page.locator('#zoom-label')).not.toHaveText(before)
  await expect(page.locator('.page-block')).toHaveCount(2, { timeout: 10000 })
  await expect(page.locator('#scroll-container')).toBeVisible()
})
