// Hermetic integration test for serveUi and buildAndServeUi
// (src/exec/ui-build.js) in a temp dir. npm and vite are replaced by a
// stand-in exec that writes dist/ as vite build would, or by a stand-in
// ember-2-ui with its own vite.js and build script. No network, no Electron.

const { test, expect } = require('@playwright/test')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { serveUi, buildAndServeUi, VITE_BIN } = require('../../src/exec/ui-build')
const { builtUiTag } = require('../../src/exec/installed')
const { run } = require('../../src/exec/run')

test.describe('serveUi and buildAndServeUi', () => {
  let tmp
  let uiDir
  let targetUiDir
  const served = () => fs.readFileSync(path.join(targetUiDir, 'index.html'), 'utf8')
  const siblings = () => fs.readdirSync(path.dirname(targetUiDir)).sort()

  // npm and vite as the build sees them: npm ci succeeds unless told not to,
  // and vite build writes dist/index.html. Every call is kept in calls.
  let calls
  const failed = (stderr) => ({ ok: false, code: 1, stderr, error: null })
  const fakeNpm = ({ ciOk = true, buildOk = true } = {}) => async (cmd, args) => {
    calls.push([cmd, ...args].join(' '))
    if (cmd === 'npm' && args[0] === 'ci') return ciOk ? { ok: true } : failed('npm ERR! code EUSAGE\nnpm ERR!\nnpm ERR! no package-lock.json.\n')
    if (cmd !== 'node' || args[0] !== VITE_BIN || args[1] !== 'build') return { ok: false }
    if (!buildOk) return failed('Could not resolve "./App"\n    at resolve (vite.js:1:1)\n')
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
    calls = []
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

  test('without the API key nothing is built and the served UI is left as it was', async () => {
    const r = await build({ buildEnv: async () => ({ env: {}, keyOk: false, error: 'exit code 1' }) })
    expect(r).toEqual({
      ok: false,
      stage: 'ui-key',
      error: 'Could not read the API key (exit code 1), so the UI was not rebuilt. The served UI was left as it was.',
    })
    expect(calls).toEqual([])
    expect(served()).toBe('old build\n')
  })

  test('control: with the API key the build runs vite directly', async () => {
    await build()
    expect(calls).toEqual(['npm ci', `node ${VITE_BIN} build`])
    expect(served()).toBe('new build\n')
  })

  test('a build that is not the pinned release is not recorded', async () => {
    expect(await build({ record: false })).toEqual({ ok: true, recorded: false })
    expect(builtUiTag(targetUiDir)).toBeNull()
  })

  test('a failed npm ci serves nothing new and names the cause', async () => {
    expect(await build({ exec: fakeNpm({ ciOk: false }) }))
      .toEqual({ ok: false, stage: 'ui-npm', error: 'npm ci exited with code 1: no package-lock.json.' })
    expect(served()).toBe('old build\n')
  })

  test('a failed vite build serves nothing new and names the cause', async () => {
    expect(await build({ exec: fakeNpm({ buildOk: false }) }))
      .toEqual({ ok: false, stage: 'ui-build', error: 'The UI build exited with code 1: Could not resolve "./App".' })
    expect(served()).toBe('old build\n')
  })
})

// A stand-in ember-2-ui: its vite.js writes dist/index.html with the key it
// was given, and its `npm run build` script, like the real build-with-key.js,
// also writes into ../ember-2/ui itself.
test.describe('buildAndServeUi with a stand-in ember-2-ui', () => {
  let tmp
  let uiDir
  let targetUiDir
  const SCRIPT_MARK = 'written-by-build-script.txt'

  test.beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-uibuild-real-'))
    uiDir = path.join(tmp, 'ember-2-ui')
    targetUiDir = path.join(tmp, 'ember-2', 'ui')
    fs.mkdirSync(path.join(uiDir, path.dirname(VITE_BIN)), { recursive: true })
    fs.mkdirSync(path.join(uiDir, 'scripts'))
    fs.writeFileSync(path.join(uiDir, VITE_BIN), [
      "const fs = require('fs')",
      "fs.mkdirSync('dist', { recursive: true })",
      "fs.writeFileSync('dist/index.html', 'key=' + process.env.VITE_EMBER_API_KEY + '\\n')",
    ].join('\n'))
    fs.writeFileSync(path.join(uiDir, 'scripts', 'build-with-key.js'),
      `require('fs').writeFileSync(${JSON.stringify(path.join(targetUiDir, SCRIPT_MARK))}, 'x')\n`)
    fs.writeFileSync(path.join(uiDir, 'package.json'), JSON.stringify({ name: 'stand-in', scripts: { build: 'node scripts/build-with-key.js' } }))
    fs.mkdirSync(targetUiDir, { recursive: true })
    fs.writeFileSync(path.join(targetUiDir, 'index.html'), 'old build\n')
  })
  test.afterEach(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
  })

  test('the build writes only dist/, and serveUi alone writes the served folder', async () => {
    const r = await buildAndServeUi({
      uiDir,
      targetUiDir,
      tag: 'v1.1.0',
      record: true,
      buildEnv: async () => ({ env: { ...process.env, VITE_EMBER_API_KEY: 'k-test' }, keyOk: true, error: null }),
      log: () => {},
      exec: (cmd, args, opts) => (cmd === 'npm' && args[0] === 'ci' ? { ok: true } : run(cmd, args, opts)),
    })
    expect(r).toEqual({ ok: true, recorded: true })
    expect(fs.readFileSync(path.join(targetUiDir, 'index.html'), 'utf8')).toBe('key=k-test\n')
    expect(fs.existsSync(path.join(targetUiDir, SCRIPT_MARK))).toBe(false)
  })

  test('control: the package build script does write into the served folder', async () => {
    expect((await run('npm', ['run', 'build'], { cwd: uiDir })).ok).toBe(true)
    expect(fs.existsSync(path.join(targetUiDir, SCRIPT_MARK))).toBe(true)
  })
})
