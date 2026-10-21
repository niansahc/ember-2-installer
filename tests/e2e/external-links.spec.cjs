// External links must open in the default browser, never in an Electron window.
// shell.openExternal is replaced in the main process so nothing really opens;
// the replacement records the URLs it was given.

const { test, expect } = require('@playwright/test')
const { launchApp, closeApp, stubOpenExternal, openedExternal, walkToModelScreen } = require('./helpers.cjs')

const GUIDE_LINK = 'a[href$="docs/model_guide.md"]'
const GUIDE_URL = 'https://github.com/niansahc/ember-2/blob/main/docs/model_guide.md'

async function gotoModelScreen(window) {
  await walkToModelScreen(window)
  await expect(window.locator(GUIDE_LINK)).toBeVisible()
}

// Long enough for a new BrowserWindow to be created if one is going to be.
const WINDOW_SETTLE_MS = 1500

test.describe('External links', () => {
  let app, window

  test.beforeEach(async () => {
    const launched = await launchApp()
    app = launched.app
    window = launched.window
    await stubOpenExternal(app)
  })

  test.afterEach(async () => {
    const closing = app
    app = undefined
    await closeApp(closing)
  })

  test('a target=_blank link opens in the default browser, not an app window', async () => {
    await gotoModelScreen(window)
    await window.locator(GUIDE_LINK).click()
    await window.waitForTimeout(WINDOW_SETTLE_MS)
    expect(app.windows()).toHaveLength(1)
    expect(await openedExternal(app)).toEqual([GUIDE_URL])
  })

  test('control: with windows allowed, the same click opens an app window', async () => {
    await gotoModelScreen(window)
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.setWindowOpenHandler(() => ({ action: 'allow' }))
    })
    // Point the link at a blank page so the window that opens loads nothing remote.
    const link = await window.locator(GUIDE_LINK).elementHandle()
    await link.evaluate((a) => { a.href = 'about:blank' })
    const opened = app.waitForEvent('window')
    await link.click()
    await opened
    expect(app.windows()).toHaveLength(2)
  })

  test('window.open to a host off the allowlist opens nothing', async () => {
    await window.evaluate(() => window.open('https://evil.example.test/'))
    await window.waitForTimeout(WINDOW_SETTLE_MS)
    expect(app.windows()).toHaveLength(1)
    expect(await openedExternal(app)).toEqual([])
  })

  test('control: window.open to an allowlisted host reaches the default browser', async () => {
    await window.evaluate((url) => window.open(url), GUIDE_URL)
    await expect.poll(() => openedExternal(app)).toEqual([GUIDE_URL])
    expect(app.windows()).toHaveLength(1)
  })

  // A local file URL, so the control's navigation loads nothing remote.
  const navigateToSibling = () => window.evaluate(() => {
    const target = new URL('preload-missing.html', location.href).href
    location.href = target
    return target
  })

  test('navigating the app page away is cancelled', async () => {
    const before = window.url()
    await navigateToSibling()
    await window.waitForTimeout(WINDOW_SETTLE_MS)
    expect(window.url()).toBe(before)
    expect(await openedExternal(app)).toEqual([])
  })

  test('control: without the navigation guard the same navigation happens', async () => {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.removeAllListeners('will-navigate')
    })
    const before = window.url()
    await navigateToSibling()
    // The file does not exist, so the page lands on an error page: either way it left.
    await expect.poll(() => window.url()).not.toBe(before)
  })
})
