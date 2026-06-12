// Regression guard: runInstall must bind the install-log listener idempotently.
//
// onInstallLog was registered per runInstall() call but removed only on success.
// A failed install left the listener attached; re-entering runInstall stacked a
// second one, so every subsequent log line was written twice. Retry can't be used
// to remove it because retry runs after runInstall returns and reuses the listener.
//
// Demo never fails, so we simulate the leftover via the demo-only test seam
// (window.__emberTest.addRawInstallLogListener) and assert a known demo log line
// appears exactly once after a normal install.

const { test, expect } = require('@playwright/test')
const { launchApp } = require('./helpers.cjs')

test.describe('Install-log listener', () => {
  let app, window

  test.beforeEach(async () => {
    const launched = await launchApp()
    app = launched.app
    window = launched.window
    await window.waitForFunction(
      () => !!window.__emberTest?.addRawInstallLogListener,
      null,
      { timeout: 5000 },
    )
  })

  test.afterEach(async () => {
    await app.close()
  })

  test('does not duplicate log output when a prior listener is present', async () => {
    test.slow()
    // Navigate Welcome → Summary.
    await window.locator('button[data-next="screen-prereqs"]').click()
    await expect(window.locator('#btn-prereqs-next')).toBeEnabled({ timeout: 5000 })
    await window.locator('#btn-prereqs-next').click()
    await window.locator('#btn-install-ember').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-vault', { timeout: 10000 })
    await window.locator('button[data-next="screen-model"]').click()
    await window.locator('#btn-model-next').click()
    await window.locator('button[data-next="screen-host"]').click()
    await window.locator('#btn-host-next').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-summary')

    // Simulate a leftover install-log listener from a prior failed run, BEFORE
    // runInstall registers its own. With the leak, install now has 2 listeners.
    await window.evaluate(() => window.__emberTest.addRawInstallLogListener())

    // Run the install to completion.
    await window.locator('#btn-start-install').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-agpl', { timeout: 30000 })

    // The demo venv step emits this line exactly once. If runInstall stacked a
    // second listener, it appears twice.
    const logText = await window.locator('#install-log').textContent()
    const occurrences = (logText.match(/Creating virtual environment/g) || []).length
    expect(occurrences).toBe(1)
  })
})
