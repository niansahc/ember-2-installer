// The API key must never render in the install log. The demo apikey step emits a
// `Key: <demo key>` line through the same sendLog path the real step's output
// would take; sendLog redacts it. The control launches with the demo-only
// --demo-raw-log seam, which turns redaction off, and shows the key would
// otherwise be visible, so the absence assertion can fail.

const { test, expect } = require('@playwright/test')
const { launchApp, closeApp } = require('./helpers.cjs')

const DEMO_KEY = 'ember_demo_xxxxxxxxxxxx'

async function runInstallToAgpl(window) {
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
  await window.locator('#btn-start-install').click()
  await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-agpl', { timeout: 30000 })
  return window.locator('#install-log').textContent()
}

test.describe('Install-log redaction', () => {
  let app

  test.afterEach(async () => {
    const closing = app
    app = undefined
    await closeApp(closing)
  })

  test('the API key does not appear in the install log', async () => {
    test.slow()
    const launched = await launchApp()
    app = launched.app
    const logText = await runInstallToAgpl(launched.window)
    expect(logText).toContain('Key: [redacted]')
    expect(logText).not.toContain(DEMO_KEY)
  })

  test('control: with redaction off the same log shows the key', async () => {
    test.slow()
    const launched = await launchApp({ extraArgs: ['--demo-raw-log'] })
    app = launched.app
    const logText = await runInstallToAgpl(launched.window)
    expect(logText).toContain(DEMO_KEY)
  })
})
