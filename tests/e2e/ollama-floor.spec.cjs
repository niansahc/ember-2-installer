// Ollama version floor on the prerequisites screen (demo mode).
const { test, expect } = require('@playwright/test')
const { launchApp, closeApp } = require('./helpers.cjs')

// The upgrade button (winget) exists only on Windows; elsewhere the row tells the
// user to update Ollama themselves. Both branches block Next.
const WIN = process.platform === 'win32'
const MANUAL = 'Update Ollama to 0.35.0 or later from ollama.com, then click Re-check.'

async function openPrereqs(extraArgs) {
  const launched = await launchApp({ extraArgs })
  await launched.window.locator('button[data-next="screen-prereqs"]').click()
  return launched
}

test.describe('Ollama version floor', () => {
  let app

  test.afterEach(async () => {
    const closing = app
    app = undefined
    await closeApp(closing)
  })

  test('at the floor: Next enabled, no upgrade button', async () => {
    let window
    ;({ app, window } = await openPrereqs([]))
    await expect(window.locator('#btn-prereqs-next')).toBeEnabled({ timeout: 5000 })
    await expect(window.locator('#btn-upgrade-ollama')).toBeHidden()
  })

  test('below the floor: Next disabled, message shown, upgrade button on Windows only', async () => {
    let window
    ;({ app, window } = await openPrereqs(['--demo-ollama-version=ollama version is 0.34.9']))
    const version = window.locator('#prereq-ollama .prereq-version')
    await expect(version).not.toHaveText('', { timeout: 5000 })
    await expect(window.locator('#btn-prereqs-next')).toBeDisabled()
    if (WIN) {
      await expect(window.locator('#btn-upgrade-ollama')).toHaveText('Upgrade Ollama')
      await expect(window.locator('#btn-upgrade-ollama')).toBeVisible()
      await expect(version).toHaveText(
        'Ollama 0.34.9 is older than the required 0.35.0. Versions before 0.35.0 have a known security flaw.'
      )
    } else {
      await expect(window.locator('#btn-upgrade-ollama')).toBeHidden()
      await expect(version).toHaveText(MANUAL)
    }
  })

  test('unparseable version: blocked with the unreadable message', async () => {
    let window
    ;({ app, window } = await openPrereqs(['--demo-ollama-version=garbage']))
    const version = window.locator('#prereq-ollama .prereq-version')
    await expect(version).not.toHaveText('', { timeout: 5000 })
    await expect(window.locator('#btn-prereqs-next')).toBeDisabled()
    await expect(version).toHaveText(
      WIN ? 'Could not read the Ollama version. Ollama 0.35.0 or later is required.' : MANUAL
    )
  })

  test('upgrade click upgrades, re-checks and enables Next', async () => {
    test.skip(!WIN, 'the upgrade button is Windows only')
    let window
    ;({ app, window } = await openPrereqs(['--demo-ollama-version=0.34.9']))
    await window.locator('#btn-upgrade-ollama').click()
    await expect(window.locator('#btn-prereqs-next')).toBeEnabled({ timeout: 8000 })
    await expect(window.locator('#btn-upgrade-ollama')).toBeHidden()
  })
})
