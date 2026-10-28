// The Tailscale walkthrough's Serve step. Phone access needs the Serve HTTPS
// name; when Serve or the name lookup fails, the step says phone access isn't
// set up and offers Retry. It never offers http://<tailnet IP>:8000: the API
// binds 127.0.0.1, so nothing listens there. The demo handlers are replaced in
// the main process per test to drive each failure.

const { test, expect } = require('@playwright/test')
const { launchApp, closeApp, openServeStep } = require('./helpers.cjs')

const NOT_SET_UP = "Phone access isn't set up yet."
const DEMO_TAILNET_IP = '100.72.128.44'

// Replace a demo IPC handler with one that resolves `value`.
function overrideHandler(app, channel, value) {
  return app.evaluate(({ ipcMain }, { channel, value }) => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async () => value)
  }, { channel, value })
}

// The step offers no URL at all: no URL element, no http(s) text, no tailnet IP.
async function offeredUrls(window) {
  const text = await window.locator('#ts-serve-result').textContent()
  return {
    urlElements: await window.locator('#ts-serve-result .ts-url-display').count(),
    urlText: /https?:\/\//.test(text) || text.includes(DEMO_TAILNET_IP),
  }
}

async function expectNotSetUp(window) {
  await expect(window.locator('#ts-serve-result')).toHaveText(NOT_SET_UP, { timeout: 10000 })
  await expect(window.locator('#btn-ts-serve')).toHaveText('Retry')
  await expect(window.locator('#btn-ts-serve')).toBeVisible()
  await expect(window.locator('#btn-ts-serve')).toBeEnabled()
  expect(await offeredUrls(window)).toEqual({ urlElements: 0, urlText: false })
  await expect(window.locator('#ts-step-phone')).toBeHidden()
}

test.describe('Tailscale Serve step', () => {
  let app

  test.afterEach(async () => {
    const closing = app
    app = undefined
    await closeApp(closing)
  })

  test('Serve works but no HTTPS name: not set up, Retry, no IP URL', async () => {
    const launched = await launchApp()
    app = launched.app
    await openServeStep(launched.window)
    await overrideHandler(app, 'get-tailscale-dns', null)
    await launched.window.locator('#btn-ts-serve').click()
    await expectNotSetUp(launched.window)
  })

  test('Serve fails: not set up, Retry, no IP URL', async () => {
    const launched = await launchApp()
    app = launched.app
    await openServeStep(launched.window)
    await overrideHandler(app, 'run-tailscale-serve', { ok: false, error: 'serve config denied' })
    await launched.window.locator('#btn-ts-serve').click()
    await expectNotSetUp(launched.window)
  })

  test('Serve IPC rejects: not set up, Retry, no IP URL', async () => {
    const launched = await launchApp({ extraArgs: ['--demo-fail=run-tailscale-serve'] })
    app = launched.app
    await openServeStep(launched.window)
    await launched.window.locator('#btn-ts-serve').click()
    await expectNotSetUp(launched.window)
  })

  test('control: with the HTTPS name, the step offers a URL and the no-URL check fails', async () => {
    const launched = await launchApp()
    app = launched.app
    await openServeStep(launched.window)
    await launched.window.locator('#btn-ts-serve').click()
    await expect(launched.window.locator('#ts-serve-result .ts-url-display')).toHaveText('https://ember.example.ts.net', { timeout: 10000 })
    expect(await offeredUrls(launched.window)).not.toEqual({ urlElements: 0, urlText: false })
    await expect(launched.window.locator('#ts-step-phone')).toBeVisible()
  })
})
