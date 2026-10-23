// The Done screen's Open Ember button with Tailscale chosen. It used to open
// http://<tailnet IP>:8000 when Serve was not set up, which open-url blocked (and
// the API, bound to 127.0.0.1, does not listen there), so the click did nothing.
// shell.openExternal is replaced in the main process and records its URLs.

const { test, expect } = require('@playwright/test')
const { launchApp, closeApp, stubOpenExternal, openedExternal, walkToHostScreen } = require('./helpers.cjs')

async function installWithTailscale(window, { setUpServe }) {
  await walkToHostScreen(window)
  await window.locator('input[name="host"][value="tailscale"]').check()
  // Connected: the walkthrough has read the tailnet IP and offers Serve.
  await expect(window.locator('#ts-step-serve')).toBeVisible({ timeout: 10000 })
  if (setUpServe) {
    await window.locator('#btn-ts-serve').click()
    await expect(window.locator('#ts-serve-result')).toBeVisible({ timeout: 10000 })
  }
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
    await expect.poll(() => openedExternal(app)).toHaveLength(1)
    expect((await openedExternal(app))[0]).toMatch(/^https:\/\/[a-z0-9.-]+\.ts\.net$/)
  })
})
