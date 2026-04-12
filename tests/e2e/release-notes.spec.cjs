// Release notes panel tests — verifies the update screen shows the
// release_notes.html content in a scrollable panel.
// Requires --demo-updates so the update screen appears on boot.

const { test, expect } = require('@playwright/test')
const { launchApp } = require('./helpers.cjs')

test.describe('Release Notes Panel', () => {
  let app, window

  test.beforeEach(async () => {
    const launched = await launchApp({ extraArgs: ['--demo-updates'] })
    app = launched.app
    window = launched.window

    await window.evaluate(() => localStorage.removeItem('ember:update-count'))
    await window.reload()
    await window.waitForLoadState('domcontentloaded')
    await expect(window.locator('.screen.active')).toHaveAttribute(
      'id',
      'screen-update',
      { timeout: 10000 }
    )
  })

  test.afterEach(async () => {
    await app.close()
  })

  test('release notes panel is visible on the update screen', async () => {
    await expect(window.locator('#release-notes-panel')).toBeVisible({ timeout: 5000 })
  })

  test('release notes panel has a "What\'s new" heading', async () => {
    await expect(window.locator('.release-notes-heading')).toHaveText("What's new")
  })

  test('release notes content is loaded from release_notes.html', async () => {
    const content = window.locator('#release-notes-content')
    await expect(content).toBeVisible({ timeout: 5000 })
    // The placeholder file contains text — verify it rendered
    const text = await content.textContent()
    expect(text.trim().length).toBeGreaterThan(0)
  })

  test('release notes content area is scrollable', async () => {
    // The .release-notes-content element should have overflow-y: auto
    const overflow = await window.locator('#release-notes-content').evaluate(
      (el) => getComputedStyle(el).overflowY
    )
    expect(overflow).toBe('auto')
  })
})
