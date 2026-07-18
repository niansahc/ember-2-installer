// IPC-failure resilience tests — issue #12.
//
// Async click handlers that await an IPC call must not leave the button frozen
// when the IPC call *rejects*. Before the fix, a rejection short-circuited the
// handler: the button stayed disabled on its "working" label and no error was
// ever surfaced (a silent hang). The shared guardClick() wrapper re-enables the
// button, restores its label, and surfaces the error via the existing inline
// idiom on every wrapped handler.
//
// Each test forces one representative IPC channel to reject via the
// --demo-fail=<channel> seam in main.js (contextBridge methods can't be
// monkeypatched from the page) and asserts the button recovers with a visible
// error. Three sites are covered to prove the wrapper behaves consistently
// across distinct error surfaces and screens:
//   - btn-check-ember-update  (Done screen, inline #ember-update-msg)
//   - btn-launch-ember        (Done screen, inline #launch-status)
//   - btn-install-ember       (Install-location screen, #clone-log box)

const { test, expect } = require('@playwright/test')
const { launchApp } = require('./helpers.cjs')

// Drive the full install flow to the Done screen (mirrors done-screen.spec.cjs).
async function navigateToDone(window) {
  await window.locator('button[data-next="screen-prereqs"]').click()
  await window.locator('#btn-prereqs-next').click({ timeout: 5000 })
  await window.locator('#btn-install-ember').click()
  await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-vault', { timeout: 10000 })
  await window.locator('button[data-next="screen-model"]').click()
  await window.locator('#btn-model-next').click()
  await window.locator('button[data-next="screen-host"]').click()
  await window.locator('#btn-host-next').click()
  await window.locator('#btn-start-install').click()
  await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-agpl', { timeout: 30000 })
  await window.locator('#btn-agpl-acknowledge').click()
  await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-done', { timeout: 15000 })
}

// Drive to the install-location screen, where btn-install-ember lives.
async function navigateToInstallLocation(window) {
  await window.locator('button[data-next="screen-prereqs"]').click()
  await window.locator('#btn-prereqs-next').click({ timeout: 5000 })
  await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-ember-path', { timeout: 10000 })
}

test.describe('IPC failure does not hang the button', () => {
  let app

  test.afterEach(async () => {
    if (app) await app.close()
  })

  test('btn-check-ember-update recovers when checkAllUpdates rejects', async () => {
    const launched = await launchApp({ extraArgs: ['--demo-fail=check-all-updates'] })
    app = launched.app
    const window = launched.window
    await navigateToDone(window)

    const btn = window.locator('#btn-check-ember-update')
    await expect(btn).toBeEnabled({ timeout: 5000 })

    await btn.click()

    // Must not be left frozen on its working label.
    await expect(btn).toBeEnabled({ timeout: 5000 })
    await expect(btn).toHaveText('Check for updates')

    // Error surfaced via the existing inline idiom.
    await expect(window.locator('#ember-update-info')).toBeVisible()
    await expect(window.locator('#ember-update-msg')).not.toHaveText('')
  })

  test('btn-launch-ember recovers when launchEmber rejects', async () => {
    const launched = await launchApp({ extraArgs: ['--demo-fail=launch-ember'] })
    app = launched.app
    const window = launched.window
    await navigateToDone(window)

    const btn = window.locator('#btn-launch-ember')
    await expect(btn).toBeEnabled({ timeout: 5000 })

    await btn.click()

    // The button restores to its original label and re-enables.
    await expect(btn).toBeEnabled({ timeout: 5000 })
    await expect(btn).toHaveText('Launch Services')

    // Error surfaced in the inline status line.
    await expect(window.locator('#launch-status')).toBeVisible()
    await expect(window.locator('#launch-status')).not.toHaveText('')
  })

  test('btn-install-ember recovers when checkTargetPath rejects', async () => {
    const launched = await launchApp({ extraArgs: ['--demo-fail=check-target-path'] })
    app = launched.app
    const window = launched.window
    await navigateToInstallLocation(window)

    const btn = window.locator('#btn-install-ember')
    await expect(btn).toBeEnabled({ timeout: 5000 })

    await btn.click()

    // Must not hang on "Installing..." — button re-enables to its label.
    await expect(btn).toBeEnabled({ timeout: 5000 })
    await expect(btn).toHaveText('Install Here')

    // Error surfaced in the clone log box (its #clone-status container reveals).
    await expect(window.locator('#clone-status')).toBeVisible()
    await expect(window.locator('#clone-log')).not.toHaveText('')
  })
})
