// Controls for the leak check (global-teardown.cjs) and for closeApp: the
// finder must see a live installer process, and closeApp must make it
// disappear, including one whose graceful close never finishes. Other workers
// run their own apps, so each test follows only its own launch pid.

const fs = require('fs')
const { test, expect } = require('@playwright/test')
const { launchApp, closeApp } = require('./helpers.cjs')
const { isInstallerLaunch } = require('./electron-processes.cjs')

const expectGone = (pid) =>
  expect.poll(() => isInstallerLaunch(pid), { timeout: 10000 }).toBe(false)

test.describe('Leak check', () => {
  test('finder sees a live installer process and loses it after closeApp', async () => {
    const { app } = await launchApp()
    const pid = app.process().pid
    try {
      expect(isInstallerLaunch(pid)).toBe(true)
    } finally {
      await closeApp(app)
    }
    await expectGone(pid)
  })

  test('closeApp kills a process whose graceful close never finishes', async () => {
    const { app } = await launchApp()
    const pid = app.process().pid
    expect(isInstallerLaunch(pid)).toBe(true)
    app.close = () => new Promise(() => {})
    await closeApp(app, { timeoutMs: 500 })
    await expectGone(pid)
  })

  test('closeApp also kills an app that never reached the spec', async () => {
    // A launch that stalls in firstWindow when the test timeout aborts
    // beforeEach leaves its app registered in helpers.cjs but unreturned.
    const stray = await launchApp()
    const strayPid = stray.app.process().pid
    const { app } = await launchApp()
    expect(isInstallerLaunch(strayPid)).toBe(true)
    await closeApp(app)
    await expectGone(strayPid)
  })

  test('each launch runs in its own user-data dir, removed by closeApp', async () => {
    const first = await launchApp()
    const second = await launchApp()
    const userData = (app) => app.evaluate(({ app: a }) => a.getPath('userData'))
    const [dirA, dirB] = [await userData(first.app), await userData(second.app)]
    // Positive control: the dirs exist while the apps are live and differ.
    expect(dirA).not.toBe(dirB)
    expect(fs.existsSync(dirA)).toBe(true)
    expect(fs.existsSync(dirB)).toBe(true)
    await closeApp(first.app)
    expect(fs.existsSync(dirA)).toBe(false)
    expect(fs.existsSync(dirB)).toBe(false)
  })

  test('closeApp accepts an app that never launched', async () => {
    await closeApp(undefined)
  })
})
