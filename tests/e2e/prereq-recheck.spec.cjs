// Prerequisite re-check race condition test
// Verifies Next is disabled immediately when Re-check is clicked,
// preventing bypass before async checks complete.

const { test, expect } = require('@playwright/test')
const { launchApp } = require('./helpers.cjs')

test.describe('Prerequisite Re-check', () => {
  let app, window

  test.beforeEach(async () => {
    const launched = await launchApp()
    app = launched.app
    window = launched.window
  })

  test.afterEach(async () => {
    await app.close()
  })

  test('Next button is disabled immediately after Re-check click', async () => {
    // Navigate to prerequisites screen
    const nextBtn = window.locator('button[data-next="screen-prereqs"]')
    await nextBtn.click()

    // Wait for initial check to complete and Next to be enabled (demo mode)
    const prereqNext = window.locator('#btn-prereqs-next')
    await expect(prereqNext).toBeEnabled({ timeout: 5000 })

    // Click Re-check synchronously and read disabled state before async resolution.
    // In demo mode the IPC resolves almost instantly, so we use evaluate to observe
    // the button state within the same microtask as the click.
    const disabledDuringRecheck = await window.evaluate(() => {
      document.getElementById('btn-recheck').click()
      return document.getElementById('btn-prereqs-next').disabled
    })
    expect(disabledDuringRecheck).toBe(true)

    // After checks complete, it should re-enable (demo mode — all pass)
    await expect(prereqNext).toBeEnabled({ timeout: 5000 })
  })
})
