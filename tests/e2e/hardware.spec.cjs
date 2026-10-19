// Hardware detection tests — runs in demo mode

const { test, expect } = require('@playwright/test')
const { launchApp, closeApp } = require('./helpers.cjs')

test.describe('Hardware Detection', () => {
  let app, window

  test.beforeEach(async () => {
    const launched = await launchApp()
    app = launched.app
    window = launched.window
  })

  test.afterEach(async () => {
    const closing = app
    app = undefined
    await closeApp(closing)
  })

  test('hardware summary exists on model screen', async () => {
    const summary = window.locator('#hardware-summary')
    await expect(summary).toBeAttached()
  })

  test('hardware summary shows RAM', async () => {
    const ram = window.locator('#hw-ram')
    await expect(ram).toBeAttached()
  })

  test('hardware summary shows recommendation', async () => {
    const rec = window.locator('#hw-recommendation')
    await expect(rec).toBeAttached()
  })
})
