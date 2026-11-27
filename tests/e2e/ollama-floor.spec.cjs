// Ollama version floor on the prerequisites screen (demo mode).
const { test, expect } = require('@playwright/test')
const { launchApp, closeApp } = require('./helpers.cjs')

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

  test('below the floor: Next disabled, message and upgrade button shown', async () => {
    let window
    ;({ app, window } = await openPrereqs(['--demo-ollama-version=ollama version is 0.34.9']))
    const upgrade = window.locator('#btn-upgrade-ollama')
    await expect(upgrade).toBeVisible({ timeout: 5000 })
    await expect(upgrade).toHaveText('Upgrade Ollama')
    await expect(window.locator('#btn-prereqs-next')).toBeDisabled()
    await expect(window.locator('#prereq-ollama .prereq-version')).toHaveText(
      'Ollama 0.34.9 is older than the required 0.35.0. Versions before 0.35.0 have a known security flaw.'
    )
  })

  test('unparseable version: blocked with the unreadable message', async () => {
    let window
    ;({ app, window } = await openPrereqs(['--demo-ollama-version=garbage']))
    await expect(window.locator('#btn-upgrade-ollama')).toBeVisible({ timeout: 5000 })
    await expect(window.locator('#btn-prereqs-next')).toBeDisabled()
    await expect(window.locator('#prereq-ollama .prereq-version')).toHaveText(
      'Could not read the Ollama version. Ollama 0.35.0 or later is required.'
    )
  })

  test('upgrade click upgrades, re-checks and enables Next', async () => {
    let window
    ;({ app, window } = await openPrereqs(['--demo-ollama-version=0.34.9']))
    await window.locator('#btn-upgrade-ollama').click()
    await expect(window.locator('#btn-prereqs-next')).toBeEnabled({ timeout: 8000 })
    await expect(window.locator('#btn-upgrade-ollama')).toBeHidden()
  })
})
