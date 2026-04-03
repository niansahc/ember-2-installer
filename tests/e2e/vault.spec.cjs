// Vault screen tests — runs in demo mode

const { test, expect } = require('@playwright/test')
const { launchApp } = require('./helpers.cjs')

test.describe('Vault Screen', () => {
  let app, window

  test.beforeEach(async () => {
    const launched = await launchApp()
    app = launched.app
    window = launched.window
    // Navigate: Welcome → Prereqs → Install Location → clone → Vault
    await window.locator('button[data-next="screen-prereqs"]').click()
    await window.locator('#btn-prereqs-next').click({ timeout: 5000 })
    await window.locator('#btn-install-ember').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-vault', { timeout: 10000 })
  })

  test.afterEach(async () => {
    await app.close()
  })

  test('vault screen renders with path input', async () => {
    await expect(window.locator('#vault-path-input')).toBeVisible()
    await expect(window.locator('#btn-pick-vault')).toBeVisible()
  })

  test('cloud warning appears when path contains OneDrive', async () => {
    const warning = window.locator('#vault-cloud-warning')
    await expect(warning).toBeHidden()
    await window.locator('#vault-path-input').fill('C:\\Users\\test\\OneDrive\\Vault')
    // Trigger input event
    await window.locator('#vault-path-input').dispatchEvent('input')
    await expect(warning).toBeVisible()
  })

  test('cloud warning appears when path contains Dropbox', async () => {
    const warning = window.locator('#vault-cloud-warning')
    await window.locator('#vault-path-input').fill('C:\\Users\\test\\Dropbox\\Vault')
    await window.locator('#vault-path-input').dispatchEvent('input')
    await expect(warning).toBeVisible()
  })

  test('cloud warning hidden for local path', async () => {
    const warning = window.locator('#vault-cloud-warning')
    await window.locator('#vault-path-input').fill('C:\\EmberVault')
    await window.locator('#vault-path-input').dispatchEvent('input')
    await expect(warning).toBeHidden()
  })
})
