// No white flash: every window has the dark background, and e2e windows are parked offscreen.
const { test, expect } = require('@playwright/test')
const { launchApp, closeApp } = require('./helpers.cjs')

const windowState = (app) =>
  app.evaluate(({ BrowserWindow, screen }) =>
    BrowserWindow.getAllWindows().map((w) => {
      const b = w.getBounds()
      const onScreen = screen
        .getAllDisplays()
        .some((d) => b.x < d.bounds.x + d.bounds.width && b.x + b.width > d.bounds.x && b.y < d.bounds.y + d.bounds.height && b.y + b.height > d.bounds.y)
      return { bg: w.getBackgroundColor(), visible: w.isVisible(), focused: w.isFocused(), onScreen }
    })
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

  test('under the test flag windows are parked offscreen and not focused', async () => {
    ;({ app } = await launchApp())
    // Shown to Chromium (a hidden page stalls requestAnimationFrame) but outside every display.
    await expect.poll(async () => (await windowState(app)).every((s) => s.visible)).toBe(true)
    const states = await windowState(app)
    expect(states.length).toBeGreaterThan(0)
    for (const s of states) {
      expect(s.onScreen).toBe(false)
      expect(s.focused).toBe(false)
    }
  })

  // Control for the test above: without the flag the window lands on a display,
  // so "onScreen: false" there can fail. Runs only when CI=true (Linux xvfb), so
  // no window appears on a developer machine.
  test('control: without the flag the window is on a display', async () => {
    test.skip(process.env.CI !== 'true', 'shows a real window; CI (xvfb) only')
    ;({ app } = await launchApp({ visible: true }))
    await expect
      .poll(async () => (await windowState(app)).every((s) => s.visible && s.onScreen), { timeout: 10000 })
      .toBe(true)
  })
})
