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

  // From the update banner to the Update screen, then Update All.
  async function runUpdateAll(window) {
    await expect(window.locator('#update-available-banner')).toBeVisible({ timeout: 10000 })
    await window.locator('#btn-view-updates').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-update', { timeout: 5000 })
    await window.locator('#btn-run-update-all').click()
  }

  test('Update All with an unfinished backend setup leaves the backend row not done and says so', async () => {
    const window = await launch(['--demo-updates', '--demo-update-all=setup-unfinished'])
    await runUpdateAll(window)
    const log = window.locator('#update-all-log')
    await expect(log).toContainText('The backend setup did not finish. The next update check offers it again.', { timeout: 20000 })
    await expect(window.locator('#update-row-backend')).not.toHaveClass(/\bdone\b/)
    await expect(window.locator('#update-backend-note')).toHaveText('The setup did not finish. The next update check offers it again.')
    await expect(window.locator('#update-row-ui')).toHaveClass(/\bdone\b/)
    await expect(window.locator('#btn-run-update-all')).toHaveText('Try Again')
    await expect(window.locator('#update-celebration')).toBeHidden()
    await expect(log).not.toContainText('All updates applied')
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-update')
  })

  test('control: a finished backend setup marks the backend row done', async () => {
    const window = await launch(['--demo-updates'])
    await runUpdateAll(window)
    await expect(window.locator('#update-celebration')).toBeVisible({ timeout: 20000 })
    await expect(window.locator('#update-row-backend')).toHaveClass(/\bdone\b/)
    await expect(window.locator('#update-all-log')).not.toContainText('did not finish')
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

  test('a new path typed after the check withdraws the existing-install offer', async () => {
    const window = await launch(['--demo-existing-update=refused'])
    await findExistingInstall(window)
    await window.locator('#ember-path-input').fill('D:\\elsewhere')
    await expect(window.locator('#existing-install-notice')).toBeHidden()
    await expect(window.locator('#btn-install-ember')).toBeEnabled()
  })

  test('control: the offer stays while the path is unchanged', async () => {
    const window = await launch(['--demo-existing-update=refused'])
    await findExistingInstall(window)
    await window.locator('#existing-install-text').click()
    await expect(window.locator('#existing-install-notice')).toBeVisible()
    await expect(window.locator('#btn-install-ember')).toBeDisabled()
  })

  test('a folder picked with Browse after the check withdraws the offer', async () => {
    const window = await launch(['--demo-existing-update=refused'])
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ['D:\\picked'] })
    })
    await findExistingInstall(window)
    await window.locator('#btn-pick-ember').click()
    await expect(window.locator('#ember-path-input')).toHaveValue('D:\\picked')
    await expect(window.locator('#existing-install-notice')).toBeHidden()
  })

  // Start fresh's first log line names the folder it was sent.
  const startFresh = async (window) => {
    await window.locator('#btn-existing-fresh').click()
    await expect(window.locator('#clone-log')).toContainText('Cloning into ', { timeout: 10000 })
    return window.locator('#clone-log').textContent()
  }

  test('Start fresh acts on the checked path, not a value put in the input later', async () => {
    const window = await launch(['--demo-existing-update=refused'])
    await findExistingInstall(window)
    const checked = await window.locator('#ember-path-input').inputValue()
    // A value set without an input event, which nothing withdraws.
    await window.evaluate(() => { document.getElementById('ember-path-input').value = 'D:\\elsewhere' })
    const log = await startFresh(window)
    expect(log).toContain(`Cloning into ${checked}/ember-2`)
    expect(log).not.toContain('elsewhere')
  })

  test('control: once the new path is checked, Start fresh acts on it', async () => {
    const window = await launch(['--demo-existing-update=refused'])
    await findExistingInstall(window)
    await window.locator('#ember-path-input').fill('D:\\elsewhere')
    await window.locator('#btn-install-ember').click()
    await expect(window.locator('#existing-install-notice')).toBeVisible({ timeout: 5000 })
    expect(await startFresh(window)).toContain('Cloning into D:\\elsewhere/ember-2')
  })

  test('Done screen: a refused UI rebuild shows its reason', async () => {
    const window = await launch(['--demo-updates', '--demo-ui-rebuild=refused'])
    await updateToDone(window)
    await expect(window.locator('#done-ui-note')).toBeVisible({ timeout: 10000 })
    await expect(window.locator('#done-ui-note')).toContainText('has local changes')
    await expect(window.locator('#done-ui-note')).not.toContainText('Node.js')
    await expect(window.locator('#done-status')).toHaveText('Interface build failed. The reason is below.')
  })

  // From the Done screen, Check for updates and Update All, back to Done.
  async function doneToDoneAgain(window) {
    await window.locator('#btn-check-ember-update').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-update', { timeout: 10000 })
    await window.locator('#btn-run-update-all').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-done', { timeout: 40000 })
    await expect(window.locator('#done-status')).not.toHaveText(/Checking Ember interface|Rebuilding/, { timeout: 10000 })
  }

  test('Done screen: a refusal note is cleared once a later visit finds the UI', async () => {
    const window = await launch(['--demo-updates', '--demo-ui-rebuild=refused-once'])
    await updateToDone(window)
    await expect(window.locator('#done-ui-note')).toContainText('has local changes', { timeout: 10000 })
    await doneToDoneAgain(window)
    await expect(window.locator('#done-ui-note')).toBeHidden()
    await expect(window.locator('#done-ui-note')).toHaveText('')
  })

  test('control: the note is shown again while the UI is still missing', async () => {
    const window = await launch(['--demo-updates', '--demo-ui-rebuild=refused'])
    await updateToDone(window)
    await expect(window.locator('#done-ui-note')).toContainText('has local changes', { timeout: 10000 })
    await doneToDoneAgain(window)
    await expect(window.locator('#done-ui-note')).toBeVisible()
  })

  test('Done screen: a failed npm ci shows its reason and the Node.js hint', async () => {
    const window = await launch(['--demo-updates', '--demo-ui-rebuild=npm'])
    await updateToDone(window)
    await expect(window.locator('#done-ui-note'))
      .toHaveText('npm ci failed: spawn npm ENOENT (demo). Check that Node.js is installed, then try again.', { timeout: 10000 })
    await expect(window.locator('#done-status')).toHaveText('Interface build failed. The reason is below.')
  })

  test('Done screen: a UI rebuild warning is shown and the screen carries on', async () => {
    const window = await launch(['--demo-updates', '--demo-ui-rebuild=warning'])
    await updateToDone(window)
    await expect(window.locator('#done-ui-note')).toContainText('built as it stands', { timeout: 10000 })
    await expect(window.locator('#done-status')).not.toHaveText(/Interface build failed/)
  })
})
