// Hermetic integration test for the pin decision (src/exec/pin-action.js): real
// git against a local bare repo in a temp dir. No network, no Electron.
// Needs `git` on PATH (present on dev + CI).

const { test, expect } = require('@playwright/test')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pinAction, uiUpdateAction } = require('../../src/exec/pin-action')
const { recordBuiltUiTag } = require('../../src/exec/installed')
const { git, seedRepo } = require('./git-fixture.cjs')

// v1.1.0, then unreleased work on main that still carries 1.1.0, as
// release-please leaves main between releases.
const step = (v, tag) => ({ files: { 'package.json': `{"version":"${v}"}\n`, 'app.txt': `app ${tag || 'main'}\n` }, tag })

test.describe('pinAction and uiUpdateAction', () => {
  let seedDir
  let repo
  let tmp
  const clone = (name, args) => {
    const dir = path.join(tmp, name)
    git(['clone', ...args, repo.url, dir])
    return dir
  }

  test.beforeAll(() => {
    seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-pin-seed-'))
    repo = seedRepo(seedDir, [step('1.0.0', 'v1.0.0'), step('1.1.0', 'v1.1.0'), step('1.1.0')])
  })
  test.afterAll(() => {
    try { fs.rmSync(seedDir, { recursive: true, force: true }) } catch {}
  })
  test.beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-pin-'))
  })
  test.afterEach(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
  })

  test('a clone at the pin tag is current', async () => {
    const dir = clone('at-tag', ['--depth', '1', '--branch', 'v1.1.0'])
    expect(await pinAction({ cwd: dir, installed: '1.1.0', tag: 'v1.1.0' })).toBe('current')
  })

  test('a clone of main with the same version number needs the move', async () => {
    const dir = clone('main', ['--depth', '1'])
    expect(await pinAction({ cwd: dir, installed: '1.1.0', tag: 'v1.1.0' })).toBe('update')
  })

  test('older and unknown versions need the move; a newer one stays (never a downgrade)', async () => {
    const dir = clone('old', ['--depth', '1', '--branch', 'v1.0.0'])
    expect(await pinAction({ cwd: dir, installed: '1.0.0', tag: 'v1.1.0' })).toBe('update')
    expect(await pinAction({ cwd: dir, installed: null, tag: 'v1.1.0' })).toBe('update')
    expect(await pinAction({ cwd: dir, installed: '1.2.0', tag: 'v1.1.0' })).toBe('ahead')
  })

  test('without a clone to look at, the versions decide', async () => {
    expect(await pinAction({ cwd: null, installed: '1.1.0', tag: 'v1.1.0' })).toBe('current')
    expect(await pinAction({ cwd: null, installed: '1.0.0', tag: 'v1.1.0' })).toBe('update')
  })

  test('UI: no clone yet is a clone', async () => {
    const uiDir = path.join(tmp, 'ember-2-ui')
    expect(await uiUpdateAction({ uiDir, targetUiDir: path.join(tmp, 'ui'), tag: 'v1.1.0' })).toBe('clone')
  })

  test('UI: a clone at the pin whose served build was recorded from it is current', async () => {
    const uiDir = clone('ember-2-ui', ['--depth', '1', '--branch', 'v1.1.0'])
    const targetUiDir = path.join(tmp, 'ui')
    fs.mkdirSync(targetUiDir)
    recordBuiltUiTag(targetUiDir, 'v1.1.0')
    expect(await uiUpdateAction({ uiDir, targetUiDir, tag: 'v1.1.0' })).toBe('current')
  })

  test('control: the same clone with no record, or an older one, needs a rebuild', async () => {
    const uiDir = clone('ember-2-ui', ['--depth', '1', '--branch', 'v1.1.0'])
    const targetUiDir = path.join(tmp, 'ui')
    fs.mkdirSync(targetUiDir)
    expect(await uiUpdateAction({ uiDir, targetUiDir, tag: 'v1.1.0' })).toBe('rebuild')
    recordBuiltUiTag(targetUiDir, 'v1.0.0')
    expect(await uiUpdateAction({ uiDir, targetUiDir, tag: 'v1.1.0' })).toBe('rebuild')
  })

  test('UI: a clone of main with the pin version needs the move, whatever the record says', async () => {
    const uiDir = clone('ember-2-ui', ['--depth', '1'])
    const targetUiDir = path.join(tmp, 'ui')
    fs.mkdirSync(targetUiDir)
    recordBuiltUiTag(targetUiDir, 'v1.1.0')
    expect(await uiUpdateAction({ uiDir, targetUiDir, tag: 'v1.1.0' })).toBe('update')
  })
})
