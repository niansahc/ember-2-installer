// The renderer's update call sites, driven through the demo seams in main.js
// (--demo-unreachable, --demo-existing-update, --demo-ui-rebuild):
//   - the boot banner and the Done screen's "Check for updates" button show an
//     update found while GitHub was unreachable (updateCheckOutcome)
//   - a failed update of an existing install shows its reason when it gave one
//     (existingUpdateFailureText)
//   - the Done screen's UI rebuild shows its refusal or warning
// update-outcome.spec covers the two helpers on their own.

const { test, expect } = require('@playwright/test')
const { launchApp, closeApp } = require('./helpers.cjs')

// From the update banner, through Update All, to the Done screen.
async function updateToDone(window) {
  await expect(window.locator('#update-available-banner')).toBeVisible({ timeout: 10000 })
  await window.locator('#btn-view-updates').click()
  await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-update', { timeout: 5000 })
  await window.locator('#btn-run-update-all').click()
  await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-done', { timeout: 40000 })
}

// To the install-location screen, then Install, which finds an existing install.
async function findExistingInstall(window) {
  await window.locator('button[data-next="screen-prereqs"]').click()
  await window.locator('#btn-prereqs-next').click({ timeout: 5000 })
  await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-ember-path', { timeout: 10000 })
  await window.locator('#btn-install-ember').click()
  await expect(window.locator('#existing-install-notice')).toBeVisible({ timeout: 5000 })
}

test.describe('update call sites', () => {
  let app

  test.afterEach(async () => {
    const closing = app
    app = undefined
    await closeApp(closing)
  })

  const launch = async (extraArgs) => {
    const launched = await launchApp({ extraArgs })
    app = launched.app
    return launched.window
  }

  test('boot: updates found while GitHub is unreachable still show the banner', async () => {
    const window = await launch(['--demo-updates', '--demo-unreachable'])
    expect((await window.evaluate(() => window.ember.checkAllUpdates())).reachable).toBe(false)
    await expect(window.locator('#update-available-banner')).toBeVisible({ timeout: 10000 })
  })

  test('Done screen: Check for updates opens the Update screen when updates were found while unreachable', async () => {
    const window = await launch(['--demo-updates', '--demo-unreachable'])
    await updateToDone(window)
    await window.locator('#btn-check-ember-update').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-update', { timeout: 10000 })
  })

  test('a refused update of an existing install shows its reason, not the connection hint', async () => {
    const window = await launch(['--demo-existing-update=refused'])
    await findExistingInstall(window)
    await window.locator('#btn-existing-update').click()
    const log = window.locator('#clone-log')
    await expect(log).toContainText('Update failed: ', { timeout: 10000 })
    await expect(log).toContainText('is a full git clone, not an installer install')
    await expect(log).not.toContainText('internet connection')
  })

  test('control: an update that failed with no reason keeps the connection hint', async () => {
    const window = await launch(['--demo-existing-update=failed'])
    await findExistingInstall(window)
    await window.locator('#btn-existing-update').click()
    await expect(window.locator('#clone-log')).toContainText('Check your internet connection', { timeout: 10000 })
  })

  test('Done screen: a refused UI rebuild shows its reason', async () => {
    const window = await launch(['--demo-updates', '--demo-ui-rebuild=refused'])
    await updateToDone(window)
    await expect(window.locator('#done-ui-note')).toBeVisible({ timeout: 10000 })
    await expect(window.locator('#done-ui-note')).toContainText('has local changes')
    await expect(window.locator('#done-status')).toHaveText('Interface build failed. The reason is below.')
  })

  test('Done screen: a UI rebuild warning is shown and the screen carries on', async () => {
    const window = await launch(['--demo-updates', '--demo-ui-rebuild=warning'])
    await updateToDone(window)
    await expect(window.locator('#done-ui-note')).toContainText('built as it stands', { timeout: 10000 })
    await expect(window.locator('#done-status')).not.toHaveText(/Interface build failed/)
  })
})
