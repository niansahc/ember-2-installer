// Installer navigation tests — runs in demo mode

const { test, expect } = require('@playwright/test')
const { launchApp } = require('./helpers.cjs')

test.describe('Navigation', () => {
  let app, window

  test.beforeEach(async () => {
    const launched = await launchApp()
    app = launched.app
    window = launched.window
  })

  test.afterEach(async () => {
    await app.close()
  })

  test('welcome screen renders', async () => {
    await window.waitForSelector('h1', { timeout: 5000 })
    const heading = window.locator('h1').first()
    await expect(heading).toContainText("Ember")
  })

  test('Next advances from welcome to prerequisites', async () => {
    const nextBtn = window.locator('button[data-next="screen-prereqs"]')
    await nextBtn.click()
    const active = window.locator('.screen.active')
    await expect(active).toHaveAttribute('id', 'screen-prereqs')
  })

  test('prerequisites screen shows all required items', async () => {
    const nextBtn = window.locator('button[data-next="screen-prereqs"]')
    await nextBtn.click()

    const prereqs = ['docker', 'python', 'ollama', 'git', 'node']
    for (const name of prereqs) {
      const row = window.locator(`#prereq-${name}`)
      await expect(row).toBeVisible()
    }
  })

  test('prerequisites Next button is enabled in demo mode', async () => {
    const nextBtn = window.locator('button[data-next="screen-prereqs"]')
    await nextBtn.click()

    // Wait for prereq check to complete (demo mode — all pass)
    await window.waitForTimeout(1000)
    const prereqNext = window.locator('#btn-prereqs-next')
    await expect(prereqNext).toBeEnabled({ timeout: 5000 })
  })

  test('Back button returns to previous screen', async () => {
    // Go to prereqs
    const nextBtn = window.locator('button[data-next="screen-prereqs"]')
    await nextBtn.click()

    // Wait for prereqs, then go to ember-path
    await window.waitForTimeout(1000)
    const prereqNext = window.locator('#btn-prereqs-next')
    await prereqNext.click({ timeout: 5000 })

    // Should be on ember-path screen
    const active = window.locator('.screen.active')
    await expect(active).toHaveAttribute('id', 'screen-ember-path')

    // Click Back
    const backBtn = window.locator('button[data-prev="screen-prereqs"]')
    await backBtn.click()

    // Should be back on prereqs
    const activeAfter = window.locator('.screen.active')
    await expect(activeAfter).toHaveAttribute('id', 'screen-prereqs')
  })
})
