// @ts-check
const { defineConfig } = require('@playwright/test')

module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.cjs',
  // tests/integration/ is a sibling of testDir, so it is already out of this
  // lane; testIgnore keeps the boundary intact even if testDir is widened later.
  testIgnore: '**/tests/integration/**',
  // Sized to measured flow time: the slowest 30 s-cap spec (done-screen, demo install
  // flow + health poll) ran 28.9 s of 30 s at 8 workers. slow() triples this.
  timeout: 60000,
  retries: 0,
  globalTeardown: require.resolve('./tests/e2e/global-teardown.cjs'),
  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
})
