// What the renderer shows after an update check and after a failed update of
// an existing install. Drives the real renderer functions through the
// demo-only test seam window.__emberTest.

const { test, expect } = require('@playwright/test')
const { launchApp, closeApp } = require('./helpers.cjs')

// A check-all-updates result with the given row updates and reachability.
const result = ({ reachable, installer = false, backend = false, ui = false }) => ({
  reachable,
  installer: { hasUpdate: installer },
  backend: { hasUpdate: backend },
  ui: { hasUpdate: ui },
})

test.describe('Update check outcome and failure text', () => {
  let app, window

  test.beforeAll(async () => {
    const launched = await launchApp()
    app = launched.app
    window = launched.window
    await window.waitForFunction(() => !!window.__emberTest?.updateCheckOutcome, null, { timeout: 5000 })
  })

  test.afterAll(async () => {
    const closing = app
    app = undefined
    await closeApp(closing)
  })

  const outcome = (r) => window.evaluate((u) => window.__emberTest.updateCheckOutcome(u), r)
  const failureText = (r) => window.evaluate((u) => window.__emberTest.existingUpdateFailureText(u), r)

  test('a pin update is shown even when the GitHub API was unreachable', async () => {
    expect(await outcome(result({ reachable: false, backend: true }))).toBe('updates')
    expect(await outcome(result({ reachable: false, ui: true }))).toBe('updates')
  })

  test('nothing found: up to date when GitHub answered, unreachable when it did not', async () => {
    expect(await outcome(result({ reachable: true }))).toBe('current')
    expect(await outcome(result({ reachable: false }))).toBe('unreachable')
  })

  test('a refused move shows its reason and does not blame the connection', async () => {
    const text = await failureText({ ok: false, error: 'C:\\x\\ember-2 is a full git clone, not an installer install' })
    expect(text).toBe('\nUpdate failed: C:\\x\\ember-2 is a full git clone, not an installer install\n')
    expect(text).not.toMatch(/internet connection/)
  })

  test('control: a failure with no reason keeps the network hint', async () => {
    expect(await failureText({ ok: false })).toMatch(/Check your internet connection/)
  })

  const cloneText = (r, failed) => window.evaluate(([u, f]) => window.__emberTest.cloneFailureText(u, f), [r, failed])

  test('a failed clone shows its reason, then the network hint', async () => {
    expect(await cloneText({ ok: false, error: 'git clone exited with code 128' }, 'Failed to clone'))
      .toBe('\nFailed to clone: git clone exited with code 128. Check your internet connection and try again.\n')
    expect(await cloneText({ ok: false }, 'Failed')).toBe('\nFailed. Check your internet connection and try again.\n')
  })

  test('another operation still running shows that alone, with no network hint', async () => {
    const error = 'An update is still running. Wait for it to finish, then try again.'
    expect(await cloneText({ ok: false, busy: true, error }, 'Failed')).toBe(`\n${error}\n`)
  })

  const noteText = (r) => window.evaluate((u) => window.__emberTest.doneUiNoteText(u), r)

  test('Done screen note: a failed npm ci keeps the Node.js hint after its reason', async () => {
    expect(await noteText({ ok: false, stage: 'ui-npm', error: 'npm ci exited with code 1: no package-lock.json.' }))
      .toBe('npm ci exited with code 1: no package-lock.json. Check that Node.js is installed, then try again.')
  })

  test('control: other failures and warnings show their text alone', async () => {
    expect(await noteText({ ok: false, stage: 'ui-clone', error: 'UI clone failed: git clone exited with code 128.' }))
      .toBe('UI clone failed: git clone exited with code 128.')
    expect(await noteText({ ok: true, warning: 'kept at X' })).toBe('kept at X')
    expect(await noteText({ ok: true })).toBe('')
  })

  test('a refused Start fresh shows the reason alone, with no network hint', async () => {
    const error = 'C:\\x\\ember-2 is a full git clone, not an installer install. Start fresh replaces only an install the installer made, so it was left as is.'
    expect(await cloneText({ ok: false, refused: true, error }, 'Failed')).toBe(`\n${error}\n`)
  })
})
