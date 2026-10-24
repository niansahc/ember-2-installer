// What the renderer shows after an update check and after a failed update of
// an existing install. Drives the real renderer functions through the
// demo-only test seam window.__emberTest.

const { test, expect } = require('@playwright/test')
const { launchApp, closeApp } = require('./helpers.cjs')

// A check-all-updates result with the given row updates and reachability.
const result = ({ reachable, installer = false, backend = false, ui = false }) => ({
  reachable,
  installer: { hasUpdate: installer },
  backend: { hasUpdate: backend },
  ui: { hasUpdate: ui },
})

test.describe('Update check outcome and failure text', () => {
  let app, window

  test.beforeAll(async () => {
    const launched = await launchApp()
    app = launched.app
    window = launched.window
    await window.waitForFunction(() => !!window.__emberTest?.updateCheckOutcome, null, { timeout: 5000 })
  })

  test.afterAll(async () => {
    const closing = app
    app = undefined
    await closeApp(closing)
  })

  const outcome = (r) => window.evaluate((u) => window.__emberTest.updateCheckOutcome(u), r)
  const failureText = (r) => window.evaluate((u) => window.__emberTest.existingUpdateFailureText(u), r)

  test('a pin update is shown even when the GitHub API was unreachable', async () => {
    expect(await outcome(result({ reachable: false, backend: true }))).toBe('updates')
    expect(await outcome(result({ reachable: false, ui: true }))).toBe('updates')
  })

  test('nothing found: up to date when GitHub answered, unreachable when it did not', async () => {
    expect(await outcome(result({ reachable: true }))).toBe('current')
    expect(await outcome(result({ reachable: false }))).toBe('unreachable')
  })

  test('a refused move does not blame the connection', async () => {
    const text = await failureText({ ok: false, error: 'C:\\x\\ember-2 is a full git clone, not an installer install' })
    expect(text).not.toMatch(/internet connection/)
    expect(text).toMatch(/See the reason above/)
  })

  test('control: a failure with no reason keeps the network hint', async () => {
    expect(await failureText({ ok: false })).toMatch(/Check your internet connection/)
  })
})
