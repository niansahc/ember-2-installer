// Vision model screen tests — runs in demo mode

const { test, expect } = require('@playwright/test')
const { launchApp } = require('./helpers.cjs')

test.describe('Vision Model', () => {
  let app, window

  test.beforeEach(async () => {
    const launched = await launchApp()
    app = launched.app
    window = launched.window
    // Navigate: Welcome → Prereqs → Install Location → clone → Vault → Model → Vision
    await window.locator('button[data-next="screen-prereqs"]').click()
    await window.locator('#btn-prereqs-next').click({ timeout: 5000 })
    await window.locator('#btn-install-ember').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-vault', { timeout: 10000 })
    await window.locator('button[data-next="screen-model"]').click()
    await window.locator('#btn-model-next').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-vision')
  })

  test.afterEach(async () => {
    await app.close()
  })

  test('vision toggle exists and is unchecked by default', async () => {
    // The checkbox is styled as a custom toggle — not directly visible.
    // Check its state via evaluate.
    const checked = await window.evaluate(() => document.getElementById('vision-toggle').checked)
    expect(checked).toBe(false)
  })

  test('enabling vision toggle shows vision model cards', async () => {
    const wrap = window.locator('#vision-model-wrap')
    await expect(wrap).toBeHidden()
    // Click the label to toggle (checkbox is hidden behind custom slider)
    await window.locator('label.toggle').click()
    await expect(wrap).toBeVisible()
    const cards = await window.locator('#vision-cards .model-card').count()
    expect(cards).toBeGreaterThanOrEqual(1)
  })

  test('disabling vision toggle hides vision model cards', async () => {
    await window.locator('label.toggle').click()
    await expect(window.locator('#vision-model-wrap')).toBeVisible()
    await window.locator('label.toggle').click()
    await expect(window.locator('#vision-model-wrap')).toBeHidden()
  })
})
