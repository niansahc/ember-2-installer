// Hermetic integration test for runBackendSetup (src/exec/backend-setup.js):
// stand-in steps and a real record file in a temp dir. No git, no network,
// no Electron.

const { test, expect } = require('@playwright/test')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { runBackendSetup } = require('../../src/exec/backend-setup')
const { backendSetupTag, recordBackendSetup } = require('../../src/exec/installed')

test.describe('runBackendSetup', () => {
  let emberPath
  let ran
  let lines
  // Steps that record their order and succeed unless named in fail.
  const steps = (fail = []) => Object.fromEntries(['pip', 'docker', 'restart'].map((name) => [
    name,
    async () => {
      ran.push(name)
      return !fail.includes(name)
    },
  ]))
  const setup = (fail) => runBackendSetup({ emberPath, tag: 'v1.1.0', steps: steps(fail), log: (t) => lines.push(t) })

  test.beforeEach(() => {
    emberPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-backend-setup-'))
    fs.mkdirSync(path.join(emberPath, '.venv'))
    recordBackendSetup(emberPath, 'v1.0.0')
    ran = []
    lines = []
  })
  test.afterEach(() => {
    try { fs.rmSync(emberPath, { recursive: true, force: true }) } catch {}
  })

  test('all three steps succeed: the setup is recorded for the tag', async () => {
    expect(await setup()).toEqual({ ok: true, pipOk: true, dockerOk: true, apiOk: true })
    expect(ran).toEqual(['pip', 'docker', 'restart'])
    expect(backendSetupTag(emberPath)).toBe('v1.1.0')
  })

  for (const step of ['pip', 'docker', 'restart']) {
    test(`a failed ${step} keeps the older record, so the next check offers the setup again`, async () => {
      const r = await setup([step])
      expect(r.ok).toBe(false)
      expect(ran).toEqual(['pip', 'docker', 'restart'])
      expect(backendSetupTag(emberPath)).toBe('v1.0.0')
      expect(lines.join('')).toMatch(/The backend setup for v1\.1\.0 did not finish, so the next update check offers it again/)
    })
  }

  test('a record that cannot be written fails the setup', async () => {
    fs.rmSync(path.join(emberPath, '.venv'), { recursive: true })
    const r = await setup()
    expect(r.ok).toBe(false)
    expect(lines.join('')).toMatch(/Could not record the backend setup/)
  })
})
