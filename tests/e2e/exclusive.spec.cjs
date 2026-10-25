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

// run( and exec( calls in text that set no timeout. Comment lines are left
// out (they mention run() by name); a call's arguments run to its closing
// parenthesis.
function untimedRuns(text) {
  const code = text.replace(/^\s*\/\/.*$/gm, '')
  const found = []
  const re = /\b(run|exec)\(/g
  let m
  while ((m = re.exec(code))) {
    if (/function\s+$/.test(code.slice(Math.max(0, m.index - 10), m.index))) continue
    let depth = 0
    let i = m.index + m[0].length - 1
    for (; i < code.length; i++) {
      if (code[i] === '(') depth++
      else if (code[i] === ')' && --depth === 0) break
    }
    const call = code.slice(m.index, i + 1)
    if (!/\btimeout\b/.test(call)) found.push(call.split(/\r?\n/)[0].trim())
  }
  return found
}

// The modules whose commands run under the lock, and the parts of main.js
// that do (the backend setup steps and Update All).
const SRC = path.join(__dirname, '..', '..', 'src')
const LOCKED_MODULES = ['clone', 'move-to-tag', 'pin-action', 'api-key', 'ui-build'].map((m) => path.join(SRC, 'exec', `${m}.js`))
const between = (text, start) => {
  const i = text.indexOf(start)
  const end = text.slice(i).search(/\r?\n\}\)?\)?\r?\n/)
  return text.slice(i, i + end)
}
function lockedCode() {
  const main = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8')
  return [
    ...LOCKED_MODULES.map((f) => fs.readFileSync(f, 'utf8')),
    between(main, 'function backendSetupSteps('),
    between(main, "ipcMain.handle('run-all-updates', locked("),
  ].join('\n')
}

test.describe('source: commands run under the lock have time limits', () => {
  test('every run and exec call under the lock sets a timeout', () => {
    const code = lockedCode()
    expect(code).toMatch(/ollama', \['pull'/)
    expect(code).toMatch(/'docker', \['compose', 'up'/)
    expect(untimedRuns(code)).toEqual([])
  })

  test('control: a call without a timeout is flagged', () => {
    const code = lockedCode().replace("['pull', 'nomic-embed-text'], { onData: log, timeout: TIMEOUTS.ollamaPull }", "['pull', 'nomic-embed-text'], { onData: log }")
    expect(code).not.toBe(lockedCode())
    expect(untimedRuns(code)).toEqual(["run('ollama', ['pull', 'nomic-embed-text'], { onData: log })"])
  })

  test('git clone and fetch carry git\'s stall limit', () => {
    const read = (m) => fs.readFileSync(path.join(SRC, 'exec', m), 'utf8')
    expect(read('clone.js')).toMatch(/run\('git', \['clone',[^\n]*\], \{\s+cwd: parent,\s+env: gitNetworkEnv\(\),/)
    expect(read('move-to-tag.js')).toMatch(/git\(\['fetch',[^\n]*\], \{\s+onData, env: gitNetworkEnv\(\),/)
  })
})
