// Done screen tests — runs in demo mode

const { test, expect } = require('@playwright/test')
const { launchApp } = require('./helpers.cjs')

test.describe('Done Screen', () => {
  let app, window

  test.beforeEach(async () => {
    const launched = await launchApp()
    app = launched.app
    window = launched.window
    // Navigate full flow: Welcome → Prereqs → Install → clone → Vault → Model → Vision → Host → Summary → Install → AGPL → Done
    await window.locator('button[data-next="screen-prereqs"]').click()
    await window.locator('#btn-prereqs-next').click({ timeout: 5000 })
    await window.locator('#btn-install-ember').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-vault', { timeout: 10000 })
    await window.locator('button[data-next="screen-model"]').click()
    await window.locator('#btn-model-next').click()
    await window.locator('button[data-next="screen-host"]').click()
    await window.locator('#btn-host-next').click()
    // Click Install on summary screen
    await window.locator('#btn-start-install').click()
    // Wait for install to complete and AGPL screen to appear
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-agpl', { timeout: 30000 })
    // Acknowledge AGPL
    await window.locator('#btn-agpl-acknowledge').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-done', { timeout: 15000 })
  })

  test.afterEach(async () => {
    await app.close()
  })

  test('done screen shows Open Ember button', async () => {
    await expect(window.locator('#btn-open-ember')).toBeVisible()
  })

  test('Open Ember button becomes enabled after health check', async () => {
    // Demo mode: ~7s from screen-done to btn enabled (2s alreadyRunning + 5s first poll).
    // Bumped to 20s to absorb system load variance during full-suite runs.
    await expect(window.locator('#btn-open-ember')).toBeEnabled({ timeout: 20000 })
  })

  test('done screen shows version info', async () => {
    await expect(window.locator('#ember-version-label')).toBeVisible({ timeout: 5000 })
  })

  test('Launch Services button is labelled correctly', async () => {
    const launchBtn = window.locator('#btn-launch-ember')
    await expect(launchBtn).toBeVisible()
    await expect(launchBtn).toHaveText('Launch Services')
  })

  test('Open Ember button is labelled correctly', async () => {
    await expect(window.locator('#btn-open-ember')).toHaveText('Open Ember')
  })

  test('done screen shows explanatory hint for the action buttons', async () => {
    const hint = window.locator('.done-action-hint')
    await expect(hint).toBeVisible()
    await expect(hint).toContainText('Launch Services')
    await expect(hint).toContainText('Open Ember')
    await expect(hint).toContainText('Docker')
    await expect(hint).toContainText('browser')
  })
})
