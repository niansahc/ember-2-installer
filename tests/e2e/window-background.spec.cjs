// No white flash: every window has the dark background, and e2e windows stay hidden.
const { test, expect } = require('@playwright/test')
const { launchApp, closeApp } = require('./helpers.cjs')

const windowState = (app) =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({ bg: w.getBackgroundColor(), visible: w.isVisible() }))
  )

// '#1a0a2e', '#1A0A2E' and '#1A0A2EFF' all name the same colour.
const rgb = (hex) => hex.trim().toLowerCase().slice(0, 7)

test.describe('window background', () => {
  let app

  test.afterEach(async () => {
    const closing = app
    app = undefined
    await closeApp(closing)
  })

  test('every window carries the --bg colour and html paints it', async () => {
    let window
    ;({ app, window } = await launchApp())
    const css = await window.evaluate(() => ({
      token: getComputedStyle(document.documentElement).getPropertyValue('--bg'),
      html: getComputedStyle(document.documentElement).backgroundColor,
    }))
    const states = await windowState(app)
    expect(states.length).toBeGreaterThan(0)
    for (const s of states) expect(rgb(s.bg)).toBe(rgb(css.token))
    expect(css.html).toBe('rgb(26, 10, 46)')
  })

  test('under the test flag no window is visible', async () => {
    ;({ app } = await launchApp())
    const states = await windowState(app)
    expect(states.length).toBeGreaterThan(0)
    for (const s of states) expect(s.visible).toBe(false)
  })

  // Control for the test above: without the flag the same window does show, so
  // "not visible" there can fail. Runs only in CI (Linux xvfb), so no window ever
  // appears on a developer machine.
  test('control: without the flag the window becomes visible', async () => {
    test.skip(process.env.CI !== 'true', 'shows a real window; CI (xvfb) only')
    ;({ app } = await launchApp({ visible: true }))
    await expect
      .poll(async () => (await windowState(app)).every((s) => s.visible), { timeout: 10000 })
      .toBe(true)
  })
})
