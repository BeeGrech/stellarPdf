const { defineConfig } = require('@playwright/test')
const path = require('path')

module.exports = defineConfig({
  testDir: './tests/ui',
  testIgnore: '00_installed_smoke.spec.js',
  timeout: 30000,
  retries: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'tests/ui/report' }],
    ['json', { outputFile: 'tests/ui/playwright-results.json' }],
  ],
  use: {
    trace: 'on-first-retry',
  },
})
