// Edge case tests — runs in demo mode
// Tests unusual interactions, state persistence, and boundary conditions

const { test, expect } = require('@playwright/test')
const { launchApp } = require('./helpers.cjs')

test.describe('Edge Cases', () => {
  let app, window

  test.beforeEach(async () => {
    const launched = await launchApp()
    app = launched.app
    window = launched.window
  })

  test.afterEach(async () => {
    await app.close()
  })

  // --- Navigation edge cases ---

  test('Install Here does nothing with empty path', async () => {
    await window.locator('button[data-next="screen-prereqs"]').click()
    await window.locator('#btn-prereqs-next').click({ timeout: 5000 })
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-ember-path')

    // Clear path input and click Install Here
    await window.locator('#ember-path-input').fill('')
    await window.locator('#btn-install-ember').click()

    // Should still be on the same screen — not navigated
    await window.waitForTimeout(500)
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-ember-path')
  })

  test('rapid double-click on Next does not skip screens', async () => {
    // Use evaluate to click twice synchronously before any screen transition
    await window.evaluate(() => {
      const btn = document.querySelector('button[data-next="screen-prereqs"]')
      btn.click()
      btn.click()
    })
    await window.waitForTimeout(500)
    // Should be on prereqs, not past it
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-prereqs')
  })

  test('Back then Forward preserves prerequisite state', async () => {
    // Go to prereqs, wait for checks
    await window.locator('button[data-next="screen-prereqs"]').click()
    await expect(window.locator('#btn-prereqs-next')).toBeEnabled({ timeout: 5000 })

    // Go forward to install location
    await window.locator('#btn-prereqs-next').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-ember-path')

    // Go back to prereqs
    await window.locator('button[data-prev="screen-prereqs"]').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-prereqs')

    // Next button should still be enabled (prereqs still pass)
    await expect(window.locator('#btn-prereqs-next')).toBeEnabled()
  })

  test('navigating back from vault to install location and forward again works', async () => {
    await window.locator('button[data-next="screen-prereqs"]').click()
    await window.locator('#btn-prereqs-next').click({ timeout: 5000 })
    await window.locator('#btn-install-ember').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-vault', { timeout: 10000 })

    // Back to install location
    await window.locator('button[data-prev="screen-ember-path"]').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-ember-path')

    // Install Here button should show "Installed ✓" (already cloned)
    const btnText = await window.locator('#btn-install-ember').textContent()
    expect(btnText).toContain('Installed')
  })

  // --- Vault cloud warning edge cases ---

  test('cloud warning triggers for iCloud path', async () => {
    await window.locator('button[data-next="screen-prereqs"]').click()
    await window.locator('#btn-prereqs-next').click({ timeout: 5000 })
    await window.locator('#btn-install-ember').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-vault', { timeout: 10000 })

    await window.locator('#vault-path-input').fill('/Users/test/Library/Mobile Documents/iCloud~com~vault')
    await window.locator('#vault-path-input').dispatchEvent('input')
    await expect(window.locator('#vault-cloud-warning')).toBeVisible()
  })

  test('cloud warning triggers for Google Drive path', async () => {
    await window.locator('button[data-next="screen-prereqs"]').click()
    await window.locator('#btn-prereqs-next').click({ timeout: 5000 })
    await window.locator('#btn-install-ember').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-vault', { timeout: 10000 })

    await window.locator('#vault-path-input').fill('G:\\My Drive\\Google Drive\\EmberVault')
    await window.locator('#vault-path-input').dispatchEvent('input')
    await expect(window.locator('#vault-cloud-warning')).toBeVisible()
  })

  test('cloud warning clears when switching from cloud to local path', async () => {
    await window.locator('button[data-next="screen-prereqs"]').click()
    await window.locator('#btn-prereqs-next').click({ timeout: 5000 })
    await window.locator('#btn-install-ember').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-vault', { timeout: 10000 })

    // Set cloud path
    await window.locator('#vault-path-input').fill('C:\\Users\\test\\Dropbox\\Vault')
    await window.locator('#vault-path-input').dispatchEvent('input')
    await expect(window.locator('#vault-cloud-warning')).toBeVisible()

    // Change to local path
    await window.locator('#vault-path-input').fill('C:\\EmberVault')
    await window.locator('#vault-path-input').dispatchEvent('input')
    await expect(window.locator('#vault-cloud-warning')).toBeHidden()
  })

  // --- Model selection edge cases ---

  test('selecting a model updates the space hint', async () => {
    await window.locator('button[data-next="screen-prereqs"]').click()
    await window.locator('#btn-prereqs-next').click({ timeout: 5000 })
    await window.locator('#btn-install-ember').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-vault', { timeout: 10000 })
    await window.locator('button[data-next="screen-model"]').click()
    await expect(window.locator('.model-card').first()).toBeVisible({ timeout: 5000 })

    // Click a non-default card
    await window.locator('.model-card').nth(1).click()
    const hint = await window.locator('#model-space-hint').textContent()
    expect(hint.length).toBeGreaterThan(0)
  })

  test('model selection persists through back and forward navigation', async () => {
    await window.locator('button[data-next="screen-prereqs"]').click()
    await window.locator('#btn-prereqs-next').click({ timeout: 5000 })
    await window.locator('#btn-install-ember').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-vault', { timeout: 10000 })
    await window.locator('button[data-next="screen-model"]').click()
    await expect(window.locator('.model-card').first()).toBeVisible({ timeout: 5000 })

    // Select second card
    await window.locator('.model-card').nth(1).click()
    await expect(window.locator('.model-card').nth(1)).toHaveClass(/selected/)

    // Go to vision and back
    await window.locator('#btn-model-next').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-vision')
    await window.locator('button[data-prev="screen-model"]').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-model')

    // Second card should still be selected
    await expect(window.locator('.model-card').nth(1)).toHaveClass(/selected/)
  })

  // --- Summary screen edge cases ---

  test('summary reflects selected model and paths', async () => {
    await window.locator('button[data-next="screen-prereqs"]').click()
    await window.locator('#btn-prereqs-next').click({ timeout: 5000 })
    await window.locator('#btn-install-ember').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-vault', { timeout: 10000 })
    await window.locator('button[data-next="screen-model"]').click()
    await window.locator('#btn-model-next').click()
    await window.locator('button[data-next="screen-host"]').click()
    await window.locator('#btn-host-next').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-summary')

    // Paths should not say "Not set"
    const emberPath = await window.locator('#summary-ember-path').textContent()
    expect(emberPath).not.toBe('Not set')

    const vaultPath = await window.locator('#summary-vault-path').textContent()
    expect(vaultPath).not.toBe('Not set')

    // Model should be populated
    const model = await window.locator('#summary-model').textContent()
    expect(model.length).toBeGreaterThan(0)

    // Total size should be populated
    const total = await window.locator('#summary-total-size').textContent()
    expect(total).toMatch(/GB/)
  })

  test('summary shows vision row when vision is enabled', async () => {
    await window.locator('button[data-next="screen-prereqs"]').click()
    await window.locator('#btn-prereqs-next').click({ timeout: 5000 })
    await window.locator('#btn-install-ember').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-vault', { timeout: 10000 })
    await window.locator('button[data-next="screen-model"]').click()
    await window.locator('#btn-model-next').click()

    // Enable vision and select a card
    await window.locator('label.toggle').click()
    await expect(window.locator('#vision-model-wrap')).toBeVisible()
    await window.locator('#vision-cards .model-card').first().click()

    await window.locator('button[data-next="screen-host"]').click()
    await window.locator('#btn-host-next').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-summary')

    // Vision row should be visible
    await expect(window.locator('#summary-vision-row')).toBeVisible()
    const vision = await window.locator('#summary-vision').textContent()
    expect(vision.length).toBeGreaterThan(0)
  })

  test('summary hides vision row when vision is explicitly toggled off', async () => {
    await window.locator('button[data-next="screen-prereqs"]').click()
    await window.locator('#btn-prereqs-next').click({ timeout: 5000 })
    await window.locator('#btn-install-ember').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-vault', { timeout: 10000 })
    await window.locator('button[data-next="screen-model"]').click()
    await window.locator('#btn-model-next').click()

    // Enable then disable vision to explicitly set state.vision = null
    await window.locator('label.toggle').click()
    await window.locator('label.toggle').click()

    await window.locator('button[data-next="screen-host"]').click()
    await window.locator('#btn-host-next').click()
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-summary')

    await expect(window.locator('#summary-vision-row')).toBeHidden()
  })

  // --- Prereq re-check edge cases ---

  test('multiple rapid re-checks do not break state', async () => {
    await window.locator('button[data-next="screen-prereqs"]').click()
    await expect(window.locator('#btn-prereqs-next')).toBeEnabled({ timeout: 5000 })

    // Click re-check three times rapidly
    const recheck = window.locator('#btn-recheck')
    await recheck.click()
    await recheck.click()
    await recheck.click()

    // Should eventually settle with Next enabled (demo mode — all pass)
    await expect(window.locator('#btn-prereqs-next')).toBeEnabled({ timeout: 10000 })

    // All icons should be ✅
    const icons = await window.locator('.prereq-icon').allTextContents()
    const required = icons.slice(0, 5) // first 5 are required prereqs
    for (const icon of required) {
      expect(icon).toBe('✅')
    }
  })

  // --- Install button state ---

  test('Install Here button disables during clone', async () => {
    await window.locator('button[data-next="screen-prereqs"]').click()
    await window.locator('#btn-prereqs-next').click({ timeout: 5000 })

    // Click Install Here and immediately check disabled state
    const disabled = await window.evaluate(() => {
      document.getElementById('btn-install-ember').click()
      return document.getElementById('btn-install-ember').disabled
    })
    expect(disabled).toBe(true)
  })
})
