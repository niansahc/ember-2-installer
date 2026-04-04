// Docker daemon check tests — runs in demo mode

const { test, expect } = require('@playwright/test')
const { launchApp } = require('./helpers.cjs')

test.describe('Docker Daemon Check', () => {
  let app, window

  test.beforeEach(async () => {
    const launched = await launchApp()
    app = launched.app
    window = launched.window
    // Navigate to prerequisites screen
    await window.locator('button[data-next="screen-prereqs"]').click()
    await expect(window.locator('#btn-prereqs-next')).toBeEnabled({ timeout: 5000 })
  })

  test.afterEach(async () => {
    await app.close()
  })

  test('Docker daemon row is visible when Docker is installed', async () => {
    // In demo mode, Docker is installed and daemon is running
    const daemonRow = window.locator('#prereq-docker-daemon')
    await expect(daemonRow).toBeVisible()
  })

  test('Docker daemon shows running status in demo mode', async () => {
    const daemonIcon = window.locator('#prereq-docker-daemon .prereq-icon')
    await expect(daemonIcon).toHaveText('✅')
    const daemonVersion = window.locator('#prereq-docker-daemon .prereq-version')
    await expect(daemonVersion).toHaveText('Running')
  })

  test('Check again button is hidden when daemon is running', async () => {
    const recheckBtn = window.locator('#btn-docker-daemon-recheck')
    await expect(recheckBtn).toBeHidden()
  })

  test('Next button is still enabled when daemon is running', async () => {
    await expect(window.locator('#btn-prereqs-next')).toBeEnabled()
  })
})
