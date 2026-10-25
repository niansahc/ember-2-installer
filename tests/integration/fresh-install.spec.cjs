// Hermetic integration test for freshInstall (src/exec/fresh-install.js): real
// git against a local bare repo in a temp dir. No network, no Electron. Needs
// `git` on PATH (present on dev + CI).

const { test, expect } = require('@playwright/test')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { freshInstall } = require('../../src/exec/fresh-install')
const { cloneRepo } = require('../../src/exec/clone')
const { gitOut, seedRepo } = require('./git-fixture.cjs')

const NOW = new Date('2026-10-25T12:00:00Z')

test.describe('freshInstall', () => {
  let seedDir
  let repo
  let other
  let tmp
  let dir
  const work = () => path.join(dir, 'work-in-progress.txt')
  const fresh = (url = repo.url) => freshInstall({ dir, url, tag: 'v1.1.0', onData: () => {}, now: NOW })
  const siblings = () => fs.readdirSync(tmp).sort()

  test.beforeAll(() => {
    seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-fresh-seed-'))
    repo = seedRepo(path.join(seedDir, 'ember'), [
      { files: { 'version.json': '{"version":"1.0.0"}\n' }, tag: 'v1.0.0' },
      { files: { 'version.json': '{"version":"1.1.0"}\n' }, tag: 'v1.1.0' },
    ])
    other = seedRepo(path.join(seedDir, 'other'), [{ files: { 'version.json': '{"version":"9.0.0"}\n' }, tag: 'v1.1.0' }])
  })
  test.afterAll(() => {
    try { fs.rmSync(seedDir, { recursive: true, force: true }) } catch {}
  })
  test.beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-fresh-'))
    dir = path.join(tmp, 'ember-2')
  })
  test.afterEach(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
  })

  // An installer clone of url at tag, with a file the user added.
  const installerClone = async (url, tag) => {
    expect((await cloneRepo({ url, targetDir: dir, tag, onData: () => {} })).ok).toBe(true)
    fs.writeFileSync(work(), 'unsaved\n')
  }

  test('a full clone (a developer working repo) is refused and kept', async () => {
    execFileSync('git', ['clone', '--branch', 'v1.0.0', repo.url, 'ember-2'], { cwd: tmp, stdio: 'ignore' })
    fs.writeFileSync(work(), 'unsaved\n')
    const r = await fresh()
    expect(r.ok).toBe(false)
    expect(r.refused).toBe(true)
    expect(r.error).toMatch(/is a full git clone, not an installer install\. Start fresh replaces only an install the installer made, so it was left as is\.$/)
    expect(fs.readFileSync(work(), 'utf8')).toBe('unsaved\n')
    expect(siblings()).toEqual(['ember-2'])
  })

  test('a clone of another repository is refused and kept', async () => {
    await installerClone(other.url, 'v1.1.0')
    const r = await fresh()
    expect(r.refused).toBe(true)
    expect(r.error).toMatch(/is a clone of .*, not /)
    expect(fs.existsSync(work())).toBe(true)
  })

  test('a folder that is not a clone is refused and kept', async () => {
    fs.mkdirSync(dir)
    fs.writeFileSync(work(), 'unsaved\n')
    const r = await fresh()
    expect(r.refused).toBe(true)
    expect(r.error).toMatch(/is not a git repository/)
    expect(fs.existsSync(work())).toBe(true)
  })

  test('control: an installer clone of the backend is replaced by the pin', async () => {
    await installerClone(repo.url, 'v1.0.0')
    const r = await fresh()
    expect(r).toEqual({ ok: true, code: 0, aside: null })
    expect(fs.existsSync(work())).toBe(false)
    expect(gitOut(['describe', '--tags'], dir)).toBe('v1.1.0')
    expect(siblings()).toEqual(['ember-2'])
  })

  test('with nothing there, the pin is cloned', async () => {
    expect((await fresh()).ok).toBe(true)
    expect(gitOut(['describe', '--tags'], dir)).toBe('v1.1.0')
  })
})
