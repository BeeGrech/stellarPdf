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

/**
 * Launch an installed binary (AppImage extracted, deb, or rpm).
 * Set STELLAR_BINARY_PATH to the electron binary path before calling.
 */
async function launchInstalled() {
  const binaryPath = process.env.STELLAR_BINARY_PATH
  if (!binaryPath) throw new Error('STELLAR_BINARY_PATH not set')
  const electronApp = await electron.launch({
    executablePath: binaryPath,
    args: ['--no-sandbox', '--disable-gpu'],
  })
  const page = await electronApp.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { electronApp, page }
}

async function openFixture(page) {
  await page.evaluate(async (p) => window.__testOpenFile(p), FIXTURE_PDF)
  await page.waitForSelector('#welcome.hidden', { timeout: 10000 })
  await page.waitForFunction(() => document.getElementById('page-label').textContent !== '— / —')
}

module.exports = { launchApp, launchInstalled, openFixture, FIXTURE_PDF }
