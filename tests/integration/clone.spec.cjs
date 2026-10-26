// Hermetic integration test for cloneRepo (src/exec/clone.js). Requires the
// module directly (no Electron), clones a local bare repo into a temp dir, and
// asserts the result. Exercises the real git-clone path that demo mode replaces.
// Needs `git` on PATH (present on dev + CI).

const { test, expect } = require('@playwright/test')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { cloneRepo } = require('../../src/exec/clone')
const { run } = require('../../src/exec/run')
const { git, gitOut, seedRepo } = require('./git-fixture.cjs')

test.describe('cloneRepo', () => {
  // One seeded repo (main one commit ahead of tag v1.0.0) for the file; each
  // test clones into its own temp dir.
  let seedDir
  let repo
  let tmp
  test.beforeAll(() => {
    seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-clone-seed-'))
    repo = seedRepo(seedDir, [
      { files: { 'README.md': 'release\n' }, tag: 'v1.0.0' },
      { files: { 'README.md': 'unreleased\n' } },
    ])
  })
  test.afterAll(() => {
    try { fs.rmSync(seedDir, { recursive: true, force: true }) } catch {}
  })
  test.beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-clone-'))
  })
  test.afterEach(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
  })

  test('clones the given tag, not main, and reports ok', async () => {
    const target = path.join(tmp, 'clone')
    const result = await cloneRepo({ url: repo.url, targetDir: target, tag: 'v1.0.0', onData: () => {} })

    expect(result.ok).toBe(true)
    expect(gitOut(['rev-parse', 'HEAD'], target)).toBe(repo.ids['v1.0.0'])
    expect(gitOut(['rev-parse', 'HEAD'], target)).not.toBe(repo.ids.main)
    expect(fs.readFileSync(path.join(target, 'README.md'), 'utf8').trim()).toBe('release')
    expect(gitOut(['rev-parse', '--is-shallow-repository'], target)).toBe('true')
  })

  test('clones under a parent path with a space (C:\\Users\\Jane Doe\\...)', async () => {
    const target = path.join(tmp, 'Jane Doe', 'Ember-2', 'ember-2-ui')
    const result = await cloneRepo({ url: repo.url, targetDir: target, tag: 'v1.0.0', onData: () => {} })
    expect(result).toEqual({ ok: true, code: 0 })
    expect(gitOut(['rev-parse', 'HEAD'], target)).toBe(repo.ids['v1.0.0'])
  })

  test('control: the full path as a git argument splits on the space and fails', async () => {
    // run() joins arguments unquoted under shell:true, which is why cloneRepo
    // passes only the folder name.
    const target = path.join(tmp, 'Jane Doe', 'ember-2-ui')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const r = await run('git', ['clone', '--depth', '1', '--branch', 'v1.0.0', repo.url, target])
    expect(r.ok).toBe(false)
    expect(fs.existsSync(target)).toBe(false)
  })

  test('control: the same repo cloned without a tag lands on main\'s newer commit', () => {
    const target = path.join(tmp, 'clone-default')
    git(['clone', '--depth', '1', repo.url, target])
    expect(gitOut(['rev-parse', 'HEAD'], target)).toBe(repo.ids.main)
  })

  test('refuses to clone without a tag and creates nothing', async () => {
    const target = path.join(tmp, 'clone')
    const result = await cloneRepo({ url: repo.url, targetDir: target, onData: () => {} })
    expect(result).toEqual({ ok: false, error: 'cloneRepo: no release tag given' })
    expect(fs.existsSync(target)).toBe(false)
  })

  test('reports a string error (not undefined) when the clone fails', async () => {
    const result = await cloneRepo({
      url: path.join(tmp, 'does-not-exist.git'),
      targetDir: path.join(tmp, 'clone'),
      tag: 'v1.0.0',
      onData: () => {},
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/exited with code|ENOENT|not found/i)
  })

  test('reports an error when the tag does not exist', async () => {
    const result = await cloneRepo({ url: repo.url, targetDir: path.join(tmp, 'clone'), tag: 'v9.9.9', onData: () => {} })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/exited with code/)
  })
})
