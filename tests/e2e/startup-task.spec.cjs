// Startup task tests — runs in demo mode
// Verifies the startup toggle appears on the Done screen and can be toggled

const { test, expect } = require('@playwright/test')
const { launchApp } = require('./helpers.cjs')

test.describe('Startup Task', () => {
  let app, window

  test.beforeEach(async () => {
    const launched = await launchApp()
    app = launched.app
    window = launched.window
    // Navigate to Done screen via full install flow
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
  })

  test.afterEach(async () => {
    await app.close()
  })

  test('startup task toggle is visible on Done screen', async () => {
    await expect(window.locator('#startup-task-toggle')).toBeVisible({ timeout: 60000 })
  })

  test('startup task toggle is checked by default after auto-registration', async () => {
    await expect(window.locator('#startup-task-toggle')).toBeVisible({ timeout: 60000 })
    await expect(window.locator('#startup-task-toggle')).toBeChecked({ timeout: 5000 })
  })

  test('toggling startup task shows confirmation message', async () => {
    const toggle = window.locator('#startup-task-toggle')
    await expect(toggle).toBeVisible({ timeout: 60000 })
    await toggle.check()
    await expect(window.locator('#startup-task-status')).toContainText('automatically', { timeout: 5000 })
  })
})
