const { _electron: electron } = require('@playwright/test')
const path = require('path')

const ROOT = path.resolve(__dirname, '../../..')
const FIXTURE_PDF = path.resolve(ROOT, 'tests/fixtures/test_form.pdf')

async function launchApp() {
  const electronApp = await electron.launch({ args: [ROOT] })
  const page = await electronApp.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { electronApp, page }
}

async function openFixture(page) {
  await page.evaluate(async (p) => window.__testOpenFile(p), FIXTURE_PDF)
  await page.waitForSelector('#welcome.hidden', { timeout: 10000 })
  // Wait for first page to render
  await page.waitForFunction(() => document.getElementById('page-label').textContent !== '— / —')
}

module.exports = { launchApp, openFixture, FIXTURE_PDF }
