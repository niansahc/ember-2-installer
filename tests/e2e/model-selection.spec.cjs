// Model selection screen tests — runs in demo mode

const { test, expect } = require('@playwright/test')
const { launchApp } = require('./helpers.cjs')

test.describe('Model Selection', () => {
  let app, window

  test.beforeEach(async () => {
    const launched = await launchApp()
    app = launched.app
    window = launched.window
    // Navigate: Welcome → Prereqs → Install Location → clone → Vault → Model
    await window.locator('button[data-next="screen-prereqs"]').click()
    await window.locator('#btn-prereqs-next').click({ timeout: 5000 })
    await window.locator('#btn-install-ember').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-vault', { timeout: 10000 })
    await window.locator('button[data-next="screen-model"]').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-model')
  })

  test.afterEach(async () => {
    await app.close()
  })

  test('model cards render', async () => {
    await expect(window.locator('.model-card').first()).toBeVisible({ timeout: 5000 })
    const count = await window.locator('.model-card').count()
    expect(count).toBeGreaterThanOrEqual(3)
  })

  test('one model card is selected by default', async () => {
    await expect(window.locator('.model-card').first()).toBeVisible({ timeout: 5000 })
    const selected = await window.locator('.model-card.selected').count()
    expect(selected).toBe(1)
  })

  test('clicking a different card selects it', async () => {
    await expect(window.locator('.model-card').first()).toBeVisible({ timeout: 5000 })
    const cards = window.locator('.model-card')
    // Click the second card
    await cards.nth(1).click()
    await expect(cards.nth(1)).toHaveClass(/selected/)
    // Only one should be selected
    const selected = await window.locator('.model-card.selected').count()
    expect(selected).toBe(1)
  })

  test('hardware summary shows RAM and GPU', async () => {
    await expect(window.locator('#hw-ram')).toContainText('32', { timeout: 5000 })
    await expect(window.locator('#hw-gpu')).toContainText('RTX 4090')
  })
})
