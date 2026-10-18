// Controls for the leak check (global-teardown.cjs) and for closeApp: the
// finder must see a live installer process, and closeApp must make it
// disappear, including one whose graceful close never finishes. Other workers
// run their own apps, so each test follows only its own launch pid.

const { test, expect } = require('@playwright/test')
const { launchApp, closeApp } = require('./helpers.cjs')
const { isInstallerLaunch } = require('./electron-processes.cjs')

test.describe('Leak check', () => {
  test('finder sees a live installer process and loses it after closeApp', async () => {
    const { app } = await launchApp()
    const pid = app.process().pid
    try {
      expect(isInstallerLaunch(pid)).toBe(true)
    } finally {
      await closeApp(app)
    }
    await expect.poll(() => isInstallerLaunch(pid), { timeout: 10000 }).toBe(false)
  })

  test('closeApp kills a process whose graceful close never finishes', async () => {
    const { app } = await launchApp()
    const pid = app.process().pid
    expect(isInstallerLaunch(pid)).toBe(true)
    app.close = () => new Promise(() => {})
    await closeApp(app, { timeoutMs: 500 })
    await expect.poll(() => isInstallerLaunch(pid), { timeout: 10000 }).toBe(false)
  })

  test('closeApp also kills an app that never reached the spec', async () => {
    // A launch that stalls in firstWindow when the test timeout aborts
    // beforeEach leaves its app registered in helpers.cjs but unreturned.
    const stray = await launchApp()
    const strayPid = stray.app.process().pid
    const { app } = await launchApp()
    expect(isInstallerLaunch(strayPid)).toBe(true)
    await closeApp(app)
    await expect.poll(() => isInstallerLaunch(strayPid), { timeout: 10000 }).toBe(false)
  })

  test('closeApp accepts an app that never launched', async () => {
    await closeApp(undefined)
  })
})
