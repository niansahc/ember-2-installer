// Update screen tests — covers the "cute additions" on screen-update:
//   - rotating ember-voice line
//   - per-row changelog notes
//   - row icon animation (in-progress / done) during Update All
//   - post-update celebration card
//   - 10th-update milestone easter egg
//
// Requires the --demo-updates flag so the demo check-all-updates handler
// returns fake updates for all three repos on boot, and run-all-updates
// emits staged log markers so row animations can be observed.

const { test, expect } = require('@playwright/test')
const { launchApp } = require('./helpers.cjs')

test.describe('Update Screen — cute additions', () => {
  let app, window

  test.beforeEach(async () => {
    const launched = await launchApp({ extraArgs: ['--demo-updates'] })
    app = launched.app
    window = launched.window

    // Clear any persisted update counter from prior runs so tests start
    // from a clean state, then reload so init() re-runs against a fresh
    // counter value.
    await window.evaluate(() => localStorage.removeItem('ember:update-count'))
    await window.reload()
    await window.waitForLoadState('domcontentloaded')

    // Under --demo-updates, init() shows the Welcome screen with an update
    // banner instead of auto-navigating.  Click "View updates" to get there.
    await expect(window.locator('#update-available-banner')).toBeVisible({ timeout: 10000 })
    await window.locator('#btn-view-updates').click()
    await expect(window.locator('.screen.active')).toHaveAttribute(
      'id',
      'screen-update',
      { timeout: 5000 }
    )
  })

  test.afterEach(async () => {
    await app.close()
  })

  test('updates show as a banner on Welcome, not as a forced screen', async () => {
    // The beforeEach already validated this flow — verify the Welcome screen
    // was the initial landing, not screen-update.  We can check by confirming
    // the banner element exists and was clicked to get here.
    // (If the app auto-navigated, the banner wouldn't exist on screen-welcome.)
    const banner = window.locator('#update-available-banner')
    // Banner should still be in the DOM (we navigated away but it's still there)
    await expect(banner).toBeAttached()
  })

  test('voice line is populated from the rotating pool', async () => {
    const voice = (await window.locator('#update-voice').textContent()) || ''
    expect(voice.trim().length).toBeGreaterThan(0)
    // Voice lines are always wrapped in double quotes
    expect(voice.trim()).toMatch(/^".+"$/)
  })

  test('all three update rows show versions and changelog notes', async () => {
    await expect(window.locator('#update-row-backend')).toBeVisible()
    await expect(window.locator('#update-row-ui')).toBeVisible()
    await expect(window.locator('#update-row-installer')).toBeVisible()

    // Versions come from the demo handler
    await expect(window.locator('#update-backend-installed')).toHaveText('v0.13.1')
    await expect(window.locator('#update-backend-latest')).toHaveText('v0.14.0')
    await expect(window.locator('#update-ui-installed')).toHaveText('0.5.3')
    await expect(window.locator('#update-ui-latest')).toHaveText('0.6.0')

    // First-bullet changelog notes come from the demo handler
    await expect(window.locator('#update-backend-note')).toContainText('Faster retrieval')
    await expect(window.locator('#update-ui-note')).toContainText('Citation popovers')
    await expect(window.locator('#update-installer-note')).toContainText('glow when it works')
  })

  test('Update All animates rows and shows the celebration card', async () => {
    // Celebration overlay starts hidden
    await expect(window.locator('#update-celebration')).toHaveClass(/hidden/)

    await window.locator('#btn-run-update-all').click()

    // Backend row should enter the animated state at some point — may
    // already be `done` by the time we check, so accept either.
    await expect(window.locator('#update-row-backend')).toHaveClass(
      /in-progress|done/,
      { timeout: 5000 }
    )

    // Celebration card appears after all staged log markers fire and
    // run-all-updates resolves — the demo run takes ~7s total.
    await expect(window.locator('#update-celebration')).not.toHaveClass(/hidden/, {
      timeout: 20000,
    })

    // Card shows the cached version and first-bullet for the preferred
    // repo (backend wins the priority in celebrationSummary).
    await expect(window.locator('#celebration-version')).toHaveText('v0.14.0')
    await expect(window.locator('#celebration-bullet')).toContainText('Faster retrieval')

    // After ~8s the card hides and the Done screen takes over.
    await expect(window.locator('#update-celebration')).toHaveClass(/hidden/, {
      timeout: 12000,
    })
    await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-done', {
      timeout: 5000,
    })
  })

  test('every visible row is marked done by the time the celebration plays', async () => {
    await window.locator('#btn-run-update-all').click()

    // Wait for celebration (confirms all stages complete)
    await expect(window.locator('#update-celebration')).not.toHaveClass(/hidden/, {
      timeout: 20000,
    })

    await expect(window.locator('#update-row-backend')).toHaveClass(/done/)
    await expect(window.locator('#update-row-ui')).toHaveClass(/done/)
    await expect(window.locator('#update-row-installer')).toHaveClass(/done/)
  })

  test('10th update fires the milestone voice line', async () => {
    // Pre-seed the counter to 9 — clicking "View updates" will bump it to
    // 10, which is the milestone trigger.
    await window.evaluate(() => localStorage.setItem('ember:update-count', '9'))
    await window.reload()
    await window.waitForLoadState('domcontentloaded')
    await expect(window.locator('#update-available-banner')).toBeVisible({ timeout: 10000 })
    await window.locator('#btn-view-updates').click()
    await expect(window.locator('.screen.active')).toHaveAttribute(
      'id',
      'screen-update',
      { timeout: 5000 }
    )

    const voice = (await window.locator('#update-voice').textContent()) || ''
    expect(voice).toContain('Tenth time')
  })
})
