// Hermetic integration test for serveUi and buildAndServeUi
// (src/exec/ui-build.js) in a temp dir. npm is replaced by a stand-in exec
// that writes dist/ as `npm run build` would. No network, no Electron.

const { test, expect } = require('@playwright/test')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { serveUi, buildAndServeUi } = require('../../src/exec/ui-build')
const { builtUiTag } = require('../../src/exec/installed')

test.describe('serveUi and buildAndServeUi', () => {
  let tmp
  let uiDir
  let targetUiDir
  const served = () => fs.readFileSync(path.join(targetUiDir, 'index.html'), 'utf8')
  const siblings = () => fs.readdirSync(path.dirname(targetUiDir)).sort()

  // npm as the build sees it: ci succeeds unless told not to, and run build
  // writes dist/index.html.
  const fakeNpm = ({ ciOk = true } = {}) => async (cmd, args) => {
    if (args[0] === 'ci') return { ok: ciOk }
    fs.mkdirSync(path.join(uiDir, 'dist'), { recursive: true })
    fs.writeFileSync(path.join(uiDir, 'dist', 'index.html'), 'new build\n')
    return { ok: true }
  }
  const build = (opts = {}) => buildAndServeUi({
    uiDir,
    targetUiDir,
    tag: 'v1.1.0',
    record: true,
    buildEnv: async () => ({ env: {}, keyOk: true }),
    log: () => {},
    exec: fakeNpm(),
    ...opts,
  })

  test.beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-uibuild-'))
    uiDir = path.join(tmp, 'ember-2-ui')
    targetUiDir = path.join(tmp, 'ember-2', 'ui')
    fs.mkdirSync(uiDir)
    fs.mkdirSync(targetUiDir, { recursive: true })
    fs.writeFileSync(path.join(targetUiDir, 'index.html'), 'old build\n')
  })
  test.afterEach(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
  })

  test('serveUi with no build to copy leaves the served UI as it was', () => {
    expect(() => serveUi(path.join(uiDir, 'dist'), targetUiDir, 'v1.1.0')).toThrow(/has no index\.html/)
    expect(served()).toBe('old build\n')
    expect(builtUiTag(targetUiDir)).toBeNull()
    expect(siblings()).toEqual(['ui'])
  })

  test('control: serveUi with a build swaps it in and records the tag', () => {
    fs.mkdirSync(path.join(uiDir, 'dist'))
    fs.writeFileSync(path.join(uiDir, 'dist', 'index.html'), 'new build\n')
    serveUi(path.join(uiDir, 'dist'), targetUiDir, 'v1.1.0')
    expect(served()).toBe('new build\n')
    expect(builtUiTag(targetUiDir)).toBe('v1.1.0')
    expect(siblings()).toEqual(['ui'])
  })

  test('a build with the API key is served and recorded', async () => {
    expect(await build()).toEqual({ ok: true, recorded: true })
    expect(served()).toBe('new build\n')
    expect(builtUiTag(targetUiDir)).toBe('v1.1.0')
  })

  test('a build without the API key is served but not recorded', async () => {
    const lines = []
    const r = await build({ buildEnv: async () => ({ env: {}, keyOk: false }), log: (t) => lines.push(t) })
    expect(r).toEqual({ ok: true, recorded: false })
    expect(served()).toBe('new build\n')
    expect(builtUiTag(targetUiDir)).toBeNull()
    expect(lines.join('')).toMatch(/built without the API key, so it is not recorded as built from v1\.1\.0/)
  })

  test('a build that is not the pinned release is not recorded', async () => {
    expect(await build({ record: false })).toEqual({ ok: true, recorded: false })
    expect(builtUiTag(targetUiDir)).toBeNull()
  })

  test('a failed npm ci serves nothing new', async () => {
    expect(await build({ exec: fakeNpm({ ciOk: false }) })).toEqual({ ok: false, stage: 'ui-npm', error: 'npm ci failed.' })
    expect(served()).toBe('old build\n')
  })
})
