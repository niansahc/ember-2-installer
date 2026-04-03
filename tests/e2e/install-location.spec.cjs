// Install location screen tests — runs in demo mode

const { test, expect } = require('@playwright/test')
const { launchApp } = require('./helpers.cjs')

test.describe('Install Location', () => {
  let app, window

  test.beforeEach(async () => {
    const launched = await launchApp()
    app = launched.app
    window = launched.window
    // Navigate to install location screen
    await window.locator('button[data-next="screen-prereqs"]').click()
    await window.locator('#btn-prereqs-next').click({ timeout: 5000 })
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-ember-path')
  })

  test.afterEach(async () => {
    await app.close()
  })

  test('install location screen renders with path input', async () => {
    await expect(window.locator('#ember-path-input')).toBeVisible()
    await expect(window.locator('#btn-install-ember')).toBeVisible()
    await expect(window.locator('#btn-pick-ember')).toBeVisible()
  })

  test('path input has a default value', async () => {
    const value = await window.locator('#ember-path-input').inputValue()
    expect(value.length).toBeGreaterThan(0)
  })
})
