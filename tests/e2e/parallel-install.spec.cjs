// Parallel install tests — verifies that pip + model downloads run
// concurrently in the install step loop.  Runs in standard demo mode.

const { test, expect } = require('@playwright/test')
const { launchApp } = require('./helpers.cjs')

test.describe('Parallel Install Steps', () => {
  let app, window

  test.beforeEach(async () => {
    const launched = await launchApp()
    app = launched.app
    window = launched.window

    // Navigate to install screen: Welcome → Prereqs → Install Location → Vault → Model → Vision → Host → Summary → Install
    await window.locator('button[data-next="screen-prereqs"]').click()
    await expect(window.locator('#btn-prereqs-next')).toBeEnabled({ timeout: 5000 })
    await window.locator('#btn-prereqs-next').click()
    await window.locator('#btn-install-ember').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-vault', { timeout: 10000 })
    await window.locator('button[data-next="screen-model"]').click()
    await window.locator('#btn-model-next').click()
    await window.locator('button[data-next="screen-host"]').click()
    await window.locator('#btn-host-next').click()
    await window.locator('#btn-start-install').click()

    // Should now be on install screen
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-install')
  })

  test.afterEach(async () => {
    await app.close()
  })

  test('pip and embed-model steps are active at the same time during the parallel group', async () => {
    // Wait for the parallel group to start — venv must finish first (~1.5s in demo)
    // then pip and embed-model should both be active simultaneously.
    await expect(window.locator('#step-pip.active')).toBeVisible({ timeout: 8000 })

    // embed-model should also be active at the same time (parallel group)
    await expect(window.locator('#step-embed-model.active')).toBeVisible({ timeout: 2000 })
  })

  test('all install steps complete with checkmarks', async () => {
    // Wait for install to complete → AGPL screen
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-agpl', { timeout: 30000 })

    // Navigate back to check step icons — actually, we can check before AGPL
    // that all steps got checkmarks. Since AGPL appeared, install succeeded.
    // The step icons should all be ✅ (checked from the install screen DOM which
    // is still in memory even though screen-agpl is active).
    const stepIcons = await window.locator('.install-step .step-icon').allTextContents()
    const allDone = stepIcons.every((icon) => icon === '✅')
    expect(allDone).toBe(true)
  })
})
