// Developer mode tests — verifies the dev mode toggle, expandable panel,
// and Apply button on the Done screen.  Runs in demo mode.

const { test, expect } = require('@playwright/test')
const { launchApp } = require('./helpers.cjs')

test.describe('Developer Mode', () => {
  let app, window

  test.beforeEach(async () => {
    const launched = await launchApp()
    app = launched.app
    window = launched.window
    // Navigate full flow to Done screen
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
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-done', { timeout: 5000 })
  })

  test.afterEach(async () => {
    await app.close()
  })

  test('dev mode toggle is visible and unchecked by default', async () => {
    const toggle = window.locator('#dev-mode-toggle')
    await expect(toggle).toBeVisible()
    await expect(toggle).not.toBeChecked()
  })

  test('dev mode panel is hidden by default', async () => {
    await expect(window.locator('#dev-mode-panel')).toHaveClass(/hidden/)
  })

  test('checking dev mode toggle reveals the panel with path fields', async () => {
    await window.locator('#dev-mode-toggle').check()
    await expect(window.locator('#dev-mode-panel')).not.toHaveClass(/hidden/)
    await expect(window.locator('#dev-vault-demo')).toBeVisible()
    await expect(window.locator('#dev-vault-test')).toBeVisible()
  })

  test('unchecking dev mode toggle hides the panel', async () => {
    await window.locator('#dev-mode-toggle').check()
    await expect(window.locator('#dev-mode-panel')).not.toHaveClass(/hidden/)
    await window.locator('#dev-mode-toggle').uncheck()
    await expect(window.locator('#dev-mode-panel')).toHaveClass(/hidden/)
  })

  test('path fields are pre-populated with default dev vault paths', async () => {
    await window.locator('#dev-mode-toggle').check()
    const demoVal = await window.locator('#dev-vault-demo').inputValue()
    const testVal = await window.locator('#dev-vault-test').inputValue()
    expect(demoVal).toContain('DEVEmberVault')
    expect(demoVal).toContain('demo_vault')
    expect(testVal).toContain('DEVEmberVault')
    expect(testVal).toContain('test_vault')
  })

  test('Apply button calls setup and shows confirmation', async () => {
    await window.locator('#dev-mode-toggle').check()
    await window.locator('#btn-apply-dev-mode').click()

    // In demo mode, setup-dev-mode returns ok after ~300ms
    await expect(window.locator('#dev-mode-status')).toContainText(
      'Developer mode enabled',
      { timeout: 3000 }
    )
    await expect(window.locator('#btn-apply-dev-mode')).toHaveText('Applied')
  })
})
