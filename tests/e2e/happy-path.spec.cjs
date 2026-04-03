// Full happy path test — runs in demo mode
// Navigates every screen from Welcome to Done in a single test

const { test, expect } = require('@playwright/test')
const { launchApp } = require('./helpers.cjs')

test.describe('Full Happy Path', () => {
  let app, window

  test.beforeEach(async () => {
    const launched = await launchApp()
    app = launched.app
    window = launched.window
  })

  test.afterEach(async () => {
    await app.close()
  })

  test('complete install flow from Welcome to Done', async () => {
    // Screen 0: Welcome
    await expect(window.locator('h1').first()).toContainText('Ember')
    await window.locator('button[data-next="screen-prereqs"]').click()

    // Screen 1: Prerequisites — all pass in demo mode
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-prereqs')
    await expect(window.locator('#btn-prereqs-next')).toBeEnabled({ timeout: 5000 })
    await window.locator('#btn-prereqs-next').click()

    // Screen 2: Install location — click Install Here to trigger clone
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-ember-path')
    await expect(window.locator('#ember-path-input')).toBeVisible()
    await window.locator('#btn-install-ember').click()

    // Screen 3: Vault — auto-navigated after clone
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-vault', { timeout: 10000 })
    await expect(window.locator('#vault-path-input')).toBeVisible()
    await window.locator('button[data-next="screen-model"]').click()

    // Screen 4: Model selection — cards should render
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-model')
    await expect(window.locator('.model-card').first()).toBeVisible({ timeout: 5000 })
    await window.locator('#btn-model-next').click()

    // Screen 5: Vision — toggle exists (checkbox is hidden behind custom slider)
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-vision')
    const visionChecked = await window.evaluate(() => document.getElementById('vision-toggle') !== null)
    expect(visionChecked).toBe(true)
    await window.locator('button[data-next="screen-host"]').click()

    // Screen 6: Host selection — default is localhost
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-host')
    await expect(window.locator('input[name="host"][value="127.0.0.1"]')).toBeChecked()
    await window.locator('#btn-host-next').click()

    // Screen 7a: Summary — fields populated
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-summary')
    await expect(window.locator('#summary-ember-path')).not.toBeEmpty()
    await expect(window.locator('#summary-model')).not.toBeEmpty()
    await window.locator('#btn-start-install').click()

    // Screen 7b: Install — progress screen
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-install')
    await expect(window.locator('#install-fun-fact')).toBeVisible()

    // Wait for install to complete → AGPL screen
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-agpl', { timeout: 30000 })

    // Screen 8: AGPL acknowledgment
    await window.locator('#btn-agpl-acknowledge').click()

    // Screen 9: Done — Open Ember should enable after health check
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-done')
    await expect(window.locator('#btn-open-ember')).toBeEnabled({ timeout: 10000 })
  })
})
