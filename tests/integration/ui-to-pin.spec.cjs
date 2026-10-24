// Hermetic integration test for uiToPin (src/exec/ui-to-pin.js): real git
// against a local bare repo in a temp dir, including the full clones an
// installer from before --depth 1 left. No network, no Electron.
// Needs `git` on PATH (present on dev + CI).

const { test, expect } = require('@playwright/test')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')
const { uiToPin } = require('../../src/exec/ui-to-pin')
const { git, gitOut, seedRepo } = require('./git-fixture.cjs')

const NOW = new Date('2026-10-24T12:00:00Z')
const release = (v, tag) => ({ files: { 'package.json': `{"version":"${v}"}\n` }, tag })

test.describe('uiToPin', () => {
  let seedDir
  let repo
  let tmp
  let uiDir
  const cloneUi = (args) => git(['clone', ...args, repo.url, uiDir])
  const head = () => gitOut(['rev-parse', 'HEAD'], uiDir)
  const shallow = () => gitOut(['rev-parse', '--is-shallow-repository'], uiDir)
  const siblings = () => fs.readdirSync(tmp).sort()
  const toPin = (opts = {}) => uiToPin({
    uiDir, targetUiDir: path.join(tmp, 'ember-2', 'ui'), tag: 'v1.1.0', url: repo.url, log: () => {}, now: NOW, ...opts,
  })

  test.beforeAll(() => {
    seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-uipin-seed-'))
    repo = seedRepo(seedDir, [release('1.0.0', 'v1.0.0'), release('1.1.0', 'v1.1.0')])
  })
  test.afterAll(() => {
    try { fs.rmSync(seedDir, { recursive: true, force: true }) } catch {}
  })
  test.beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-uipin-'))
    uiDir = path.join(tmp, 'ember-2-ui')
  })
  test.afterEach(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
  })

  test('no clone yet: cloned at the pin', async () => {
    expect(await toPin({ packaged: true })).toEqual({ ok: true, action: 'clone' })
    expect(head()).toBe(repo.ids['v1.1.0'])
  })

  test('a shallow clone below the pin is moved', async () => {
    cloneUi(['--depth', '1', '--branch', 'v1.0.0'])
    expect(await toPin({ packaged: true })).toEqual({ ok: true, action: 'update' })
    expect(head()).toBe(repo.ids['v1.1.0'])
  })

  test('packaged: a full clone is set aside under a dated name and cloned again at the pin', async () => {
    cloneUi(['--branch', 'v1.0.0'])
    const aside = `${uiDir}.old-2026-10-24`
    const r = await toPin({ packaged: true })
    expect(r).toEqual({ ok: true, action: 'clone', warning: `The previous ember-2-ui, a full git clone, was kept at ${aside}.` })
    expect(head()).toBe(repo.ids['v1.1.0'])
    expect(shallow()).toBe('true')
    expect(gitOut(['rev-parse', 'HEAD'], aside)).toBe(repo.ids['v1.0.0'])
    expect(siblings()).toEqual(['ember-2-ui', 'ember-2-ui.old-2026-10-24'])
  })

  test('unpackaged: a full clone is built as it stands, never moved or renamed', async () => {
    cloneUi(['--branch', 'v1.0.0'])
    const r = await toPin({ packaged: false })
    expect(r.ok).toBe(true)
    expect(r.action).toBe('as-is')
    expect(r.warning).toMatch(/full git clone \(a developer's working repo\), so it was built as it stands and not moved to v1\.1\.0/)
    expect(head()).toBe(repo.ids['v1.0.0'])
    expect(shallow()).toBe('false')
    expect(siblings()).toEqual(['ember-2-ui'])
  })

  test('packaged: a failed clone puts the full clone back', async () => {
    cloneUi(['--branch', 'v1.0.0'])
    const missing = pathToFileURL(path.join(tmp, 'no-such-repo.git')).href
    const r = await toPin({ packaged: true, url: missing })
    expect(r.ok).toBe(false)
    expect(r.stage).toBe('ui-clone')
    expect(r.error).toMatch(/^UI clone failed: .*The previous ember-2-ui is still in /)
    expect(head()).toBe(repo.ids['v1.0.0'])
    expect(shallow()).toBe('false')
    expect(siblings()).toEqual(['ember-2-ui'])
  })
})
