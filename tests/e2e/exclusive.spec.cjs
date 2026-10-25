// One mutating operation at a time: createExclusive (src/lib/exclusive.js),
// and a source check that every IPC handler that clones, moves, builds or
// restarts an install goes through it. Requires the modules directly; no app
// launch.

const { test, expect } = require('@playwright/test')
const fs = require('fs')
const path = require('path')
const { createExclusive } = require('../../src/lib/exclusive')

// A task that stays running until release() is called.
function held() {
  let release
  const done = new Promise((r) => { release = r })
  return { release, task: async () => { await done; return { ok: true } } }
}

test.describe('createExclusive', () => {
  test('a second call while one runs is refused, and its work never runs', async () => {
    const exclusive = createExclusive()
    const first = held()
    const running = exclusive('An update', first.task)
    const busy = []
    let ran = false
    const second = await exclusive('A fresh install', async () => { ran = true }, (e) => busy.push(e))
    expect(second).toEqual({ ok: false, busy: true, error: 'An update is still running. Wait for it to finish, then try again.' })
    expect(busy).toEqual([second.error])
    expect(ran).toBe(false)
    first.release()
    expect(await running).toEqual({ ok: true })
  })

  test('control: calls one after another both run', async () => {
    const exclusive = createExclusive()
    let runs = 0
    await exclusive('An update', async () => { runs++ })
    await exclusive('A fresh install', async () => { runs++ })
    expect(runs).toBe(2)
  })

  test('a call that throws releases the lock', async () => {
    const exclusive = createExclusive()
    await expect(exclusive('An update', async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(await exclusive('An update', async () => ({ ok: true }))).toEqual({ ok: true })
  })
})

// The IPC handlers that change an install. run-install-step locks its build-ui
// step only; the other install steps run in parallel by design.
const MUTATING = ['clone-ember-repo', 'update-existing-ember', 'fresh-install-ember', 'run-all-updates']

// Mutating handlers registered (column 0, the real handlers) without locked().
const unlockedHandlers = (text) => MUTATING.filter((ch) => !new RegExp(`^ipcMain\\.handle\\('${ch}', locked\\(`, 'm').test(text))

test.describe('source: mutating handlers run one at a time', () => {
  const mainJs = () => fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main.js'), 'utf8')

  test('every handler that changes an install is locked, and so is the build-ui step', () => {
    const text = mainJs()
    expect(unlockedHandlers(text)).toEqual([])
    expect(text).toMatch(/step === 'build-ui'\s+\? await exclusive\('The interface build'/)
  })

  test('control: a handler registered without the lock is flagged', () => {
    const text = mainJs()
    const unlocked = text.replace(/^ipcMain\.handle\('fresh-install-ember', locked\('[^']+', /m, "ipcMain.handle('fresh-install-ember', ")
    expect(unlocked).not.toBe(text)
    expect(unlockedHandlers(unlocked)).toEqual(['fresh-install-ember'])
  })
})
