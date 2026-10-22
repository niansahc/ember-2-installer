// Update All with an installer update. --demo-updates offers updates for all
// three repos; --demo-installer-update makes Update All go on to download the
// installer update through the demo download-installer-update fake (progress,
// then update-downloaded). =manual makes that fake return a manual result, and
// --demo-fail=download-installer-update makes the IPC reject.

const { test, expect } = require('@playwright/test')
const { launchApp, closeApp, stubOpenExternal, openedExternal } = require('./helpers.cjs')
const { RELEASES_URL } = require('../../src/lib/installer-update')

async function launchOnUpdateScreen(extraArgs) {
  const launched = await launchApp({ extraArgs: ['--demo-updates', ...extraArgs] })
  const { window } = launched
  await expect(window.locator('#update-available-banner')).toBeVisible({ timeout: 10000 })
  await window.locator('#btn-view-updates').click()
  await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-update', { timeout: 5000 })
  return launched
}

test.describe('Installer update in Update All', () => {
  let app

  test.afterEach(async () => {
    const closing = app
    app = undefined
    await closeApp(closing)
  })

  test('downloads the installer update and restarts', async () => {
    test.slow()
    const launched = await launchOnUpdateScreen(['--demo-installer-update'])
    app = launched.app
    const { window } = launched
    await window.locator('#btn-run-update-all').click()
    await expect(window.locator('#update-all-log')).toContainText('Installer update downloaded. Restarting...', { timeout: 60000 })
    await expect(window.locator('#btn-run-update-all')).toHaveText('Restarting...')
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-update')
  })

  test('a failed download lands on Done with a notice and the Releases link', async () => {
    test.slow()
    const launched = await launchOnUpdateScreen(['--demo-installer-update', '--demo-fail=download-installer-update'])
    app = launched.app
    const { window } = launched
    await window.locator('#btn-run-update-all').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-done', { timeout: 60000 })
    await expect(window.locator('#done-installer-update-note')).toBeVisible()
    await expect(window.locator('#done-installer-update-text')).toContainText('The installer update failed')
    await expect(window.locator('#btn-open-installer-releases')).toBeVisible()
    // The rejection's own text ("[demo-fail] ... rejected on purpose") stays out
    // of the notice and the log. --demo-fail is the control: it does reject.
    await expect(window.locator('#done-installer-update-text')).not.toContainText('demo-fail')
    await expect(window.locator('#update-all-log')).not.toContainText('demo-fail')
  })

  test('a manual result shows its message and opens the Releases page on click', async () => {
    test.slow()
    const launched = await launchOnUpdateScreen(['--demo-installer-update=manual'])
    app = launched.app
    const { window } = launched
    await stubOpenExternal(app)
    await window.locator('#btn-run-update-all').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-done', { timeout: 60000 })
    await expect(window.locator('#done-installer-update-text')).toContainText('download the latest installer from the GitHub Releases page')
    await window.locator('#btn-open-installer-releases').click()
    await expect.poll(() => openedExternal(app)).toEqual([RELEASES_URL])
  })

  test('without an installer update, Done shows no installer notice', async () => {
    test.slow()
    const launched = await launchOnUpdateScreen([])
    app = launched.app
    const { window } = launched
    await window.locator('#btn-run-update-all').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-done', { timeout: 60000 })
    await expect(window.locator('#done-installer-update-note')).toBeHidden()
  })
})
