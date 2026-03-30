// AGPL acknowledgment screen tests — runs in demo mode

const { test, expect } = require('@playwright/test')
const { launchApp } = require('./helpers.cjs')

test.describe('AGPL Screen', () => {
  let app, window

  test.beforeEach(async () => {
    const launched = await launchApp()
    app = launched.app
    window = launched.window
  })

  test.afterEach(async () => {
    await app.close()
  })

  test('AGPL screen exists in DOM', async () => {
    const agplScreen = window.locator('#screen-agpl')
    await expect(agplScreen).toBeAttached()
  })

  test('AGPL screen has acknowledge button', async () => {
    const btn = window.locator('#btn-agpl-acknowledge')
    await expect(btn).toBeAttached()
    await expect(btn).toContainText('I understand')
  })

  test('AGPL screen mentions AGPL-3.0', async () => {
    const agplCard = window.locator('.agpl-card')
    await expect(agplCard).toContainText('AGPL-3.0')
  })

  test('AGPL screen mentions CC BY-NC 4.0', async () => {
    const agplCard = window.locator('.agpl-card')
    await expect(agplCard).toContainText('CC BY-NC 4.0')
  })
})
