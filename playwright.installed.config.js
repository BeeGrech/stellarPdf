const { defineConfig } = require('@playwright/test')

module.exports = defineConfig({
  testDir: './tests/ui',
  testMatch: '00_installed_smoke.spec.js',
  timeout: 30000,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'tests/ui/report-installed' }]],
})
