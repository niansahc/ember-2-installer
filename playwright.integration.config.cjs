// @ts-check
const { defineConfig } = require('@playwright/test')

// Hermetic --real integration lane (ADR 0001): real subprocess + temp dirs, no
// Electron, no UI, no network, no external daemon. Kept structurally separate
// from the demo e2e lane by living in tests/integration/. retries: 0 -- a retry
// would mask the flakes this lane exists to surface.
module.exports = defineConfig({
  testDir: './tests/integration',
  testMatch: '**/*.spec.cjs',
  timeout: 30000,
  retries: 0,
})
