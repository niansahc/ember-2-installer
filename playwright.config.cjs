// @ts-check
const { defineConfig } = require('@playwright/test')

module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.cjs',
  // tests/integration/ is a sibling of testDir, so it is already out of this
  // lane; testIgnore keeps the boundary intact even if testDir is widened later.
  testIgnore: '**/tests/integration/**',
  timeout: 30000,
  retries: 0,
  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
})
