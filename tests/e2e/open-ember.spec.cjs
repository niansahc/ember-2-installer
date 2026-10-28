// The Done screen's Open Ember button with Tailscale chosen. It used to open
// http://<tailnet IP>:8000 when Serve was not set up, which open-url blocked (and
// the API, bound to 127.0.0.1, does not listen there), so the click did nothing.
// shell.openExternal is replaced in the main process and records its URLs.

const { test, expect } = require('@playwright/test')
const { launchApp, closeApp, stubOpenExternal, openedExternal, openServeStep } = require('./helpers.cjs')

// The demo get-tailscale-dns name.
const OWN_URL = 'https://ember.example.ts.net'

// Click Serve unless it is already set up, and wait for the HTTPS name.
async function setUpServe(window) {
  if (await window.locator('#ts-serve-result .ts-url-display').count() === 0) {
    await window.locator('#btn-ts-serve').click()
  }
  await expect(window.locator('#ts-serve-result .ts-url-display')).toHaveText(OWN_URL, { timeout: 10000 })
}

async function installWithTailscale(window, { setUpServe: serve }) {
  await openServeStep(window)
  if (serve) await setUpServe(window)
  await window.locator('#btn-host-next').click()
  await window.locator('#btn-start-install').click()
  await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-agpl', { timeout: 30000 })
  await window.locator('#btn-agpl-acknowledge').click()
  await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-done', { timeout: 15000 })
  await expect(window.locator('#btn-open-ember')).toBeEnabled({ timeout: 20000 })
}

test.describe('Open Ember with Tailscale', () => {
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

  test('without Serve, opens the local API', async () => {
    test.slow()
    await installWithTailscale(window, { setUpServe: false })
    await window.locator('#btn-open-ember').click()
    await expect.poll(() => openedExternal(app)).toEqual(['http://localhost:8000'])
  })

  test('with Serve, opens the tailnet HTTPS name', async () => {
    test.slow()
    await installWithTailscale(window, { setUpServe: true })
    await window.locator('#btn-open-ember').click()
    await expect.poll(() => openedExternal(app)).toEqual([OWN_URL])
  })
})

// open-url allows only the tailnet host main read from Tailscale. One launch,
// in order: main's tailnet host only goes from unknown to known (the Serve
// click). The handler opens synchronously once the IPC call resolves, so the
// recorded list is final when openUrl returns. "after Serve, the user's own
// tailnet host opens" is the positive control for both blocked cases.
const openUrl = (window, url) => window.evaluate((u) => window.ember.openUrl(u), url)

test.describe.serial('open-url and the tailnet host', () => {
  let app, window

  test.beforeAll(async () => {
    const launched = await launchApp()
    app = launched.app
    window = launched.window
    await openServeStep(window)
  })

  test.beforeEach(async () => {
    await stubOpenExternal(app)
  })

  test.afterAll(async () => {
    const closing = app
    app = undefined
    await closeApp(closing)
  })

  test('before Serve, the own tailnet host is blocked', async () => {
    await openUrl(window, OWN_URL)
    expect(await openedExternal(app)).toEqual([])
  })

  test("after Serve, the user's own tailnet host opens", async () => {
    await setUpServe(window)
    await openUrl(window, OWN_URL)
    expect(await openedExternal(app)).toEqual([OWN_URL])
  })

  test('after Serve, another tailnet host is blocked', async () => {
    await setUpServe(window)
    await openUrl(window, 'https://other.example.ts.net')
    expect(await openedExternal(app)).toEqual([])
  })
})
