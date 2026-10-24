// Hermetic integration test for moveToTag (src/exec/move-to-tag.js): real git
// against a local bare repo in a temp dir. No network, no Electron.
// Needs `git` on PATH (present on dev + CI).

const { test, expect } = require('@playwright/test')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { moveToTag } = require('../../src/exec/move-to-tag')
const { git, gitOut, commitAll, seedRepo } = require('./git-fixture.cjs')

// Releases v1.0.0 and v1.1.0, then unreleased work on main.
const release = (v, tag) => ({ files: { 'version.json': `{"version":"${v}"}\n`, 'app.txt': `app ${v}\n` }, tag })

test.describe('moveToTag', () => {
  // One seeded repo for the file (no test writes to it); each test clones
  // into its own temp dir.
  let seedDir
  let repo
  let tmp
  const clone = (name, args) => {
    const dir = path.join(tmp, name)
    git(['clone', ...args, repo.url, dir])
    return dir
  }
  const head = (dir) => gitOut(['rev-parse', 'HEAD'], dir)
  const move = (dir, opts = {}) => moveToTag({ cwd: dir, tag: 'v1.1.0', url: repo.url, onData: () => {}, ...opts })

  test.beforeAll(() => {
    seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-move-seed-'))
    repo = seedRepo(seedDir, [release('1.0.0', 'v1.0.0'), release('1.1.0', 'v1.1.0'), release('1.2.0-dev')])
  })
  test.afterAll(() => {
    try { fs.rmSync(seedDir, { recursive: true, force: true }) } catch {}
  })
  test.beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-move-'))
  })
  test.afterEach(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
  })

  test('a shallow clone at v1.0.0 moves to v1.1.0 and keeps untracked files', async () => {
    const dir = clone('install', ['--depth', '1', '--branch', 'v1.0.0'])
    fs.mkdirSync(path.join(dir, '.venv'))
    fs.writeFileSync(path.join(dir, '.venv', 'marker'), 'x')
    expect(await move(dir)).toEqual({ ok: true })
    expect(head(dir)).toBe(repo.ids['v1.1.0'])
    expect(fs.existsSync(path.join(dir, '.venv', 'marker'))).toBe(true)
    expect(gitOut(['rev-parse', '--is-shallow-repository'], dir)).toBe('true')
  })

  test('an installer-touched file is reset and the move succeeds', async () => {
    const dir = clone('install', ['--depth', '1', '--branch', 'v1.0.0'])
    fs.writeFileSync(path.join(dir, 'version.json'), '{"tag":"v1.0.0"}\n')
    expect(await move(dir, { resetFiles: ['version.json'] })).toEqual({ ok: true })
    expect(head(dir)).toBe(repo.ids['v1.1.0'])
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'version.json'), 'utf8')).version).toBe('1.1.0')
  })

  test('a user-modified tracked file is refused and HEAD is unchanged', async () => {
    const dir = clone('install', ['--depth', '1', '--branch', 'v1.0.0'])
    fs.writeFileSync(path.join(dir, 'app.txt'), 'my local edit\n')
    const r = await move(dir, { resetFiles: ['version.json'] })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Local changes to app\.txt/)
    expect(head(dir)).toBe(repo.ids['v1.0.0'])
    expect(fs.readFileSync(path.join(dir, 'app.txt'), 'utf8')).toBe('my local edit\n')
  })

  test('control: the same clone with a clean tree moves', async () => {
    const dir = clone('install', ['--depth', '1', '--branch', 'v1.0.0'])
    expect(await move(dir, { resetFiles: ['version.json'] })).toEqual({ ok: true })
    expect(head(dir)).toBe(repo.ids['v1.1.0'])
  })

  test('a full (non-shallow) clone is refused and HEAD is unchanged', async () => {
    const dir = clone('dev', ['--branch', 'v1.0.0'])
    expect(gitOut(['rev-parse', '--is-shallow-repository'], dir)).toBe('false')
    const r = await move(dir)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/full git clone/)
    expect(head(dir)).toBe(repo.ids['v1.0.0'])
  })

  test('control: a shallow clone of the same release moves', async () => {
    const dir = clone('install', ['--depth', '1', '--branch', 'v1.0.0'])
    expect(gitOut(['rev-parse', '--is-shallow-repository'], dir)).toBe('true')
    expect(await move(dir)).toEqual({ ok: true })
  })

  test('an old shallow clone on main moves to a tag', async () => {
    const dir = clone('old', ['--depth', '1'])
    expect(head(dir)).toBe(repo.ids.main)
    expect(await move(dir)).toEqual({ ok: true })
    expect(head(dir)).toBe(repo.ids['v1.1.0'])
  })

  test('a tag that does not exist fails and HEAD is unchanged', async () => {
    const dir = clone('install', ['--depth', '1', '--branch', 'v1.0.0'])
    const r = await move(dir, { tag: 'v9.9.9' })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/git fetch of v9\.9\.9 exited with code/)
    expect(head(dir)).toBe(repo.ids['v1.0.0'])
  })

  test('a subdirectory of a clone is refused and the enclosing clone does not move', async () => {
    const dir = clone('install', ['--depth', '1', '--branch', 'v1.0.0'])
    const sub = path.join(dir, 'ui')
    fs.mkdirSync(sub)
    const r = await move(sub)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/not a git repository/)
    expect(head(dir)).toBe(repo.ids['v1.0.0'])
  })

  test('a clone of another repository with the same tag is refused before anything is reset', async () => {
    const other = seedRepo(path.join(tmp, 'other-seed'), [release('0.1.0', 'v1.1.0')])
    const dir = path.join(tmp, 'other')
    git(['clone', '--depth', '1', '--branch', 'v1.1.0', other.url, dir])
    fs.writeFileSync(path.join(dir, 'version.json'), '{"version":"edited"}\n')
    const r = await move(dir, { resetFiles: ['version.json'] })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/is a clone of .*, not /)
    expect(head(dir)).toBe(other.ids['v1.1.0'])
    expect(fs.readFileSync(path.join(dir, 'version.json'), 'utf8')).toBe('{"version":"edited"}\n')
  })

  test('control: origin compares without case, a trailing slash or .git', async () => {
    const dir = clone('install', ['--depth', '1', '--branch', 'v1.0.0'])
    // The seed is src.git: drop the .git, change the case, add a slash.
    expect(await move(dir, { url: `${repo.url.replace(/\.git$/, '').toUpperCase()}/` })).toEqual({ ok: true })
    expect(head(dir)).toBe(repo.ids['v1.1.0'])
  })

  test('no url given is refused', async () => {
    const dir = clone('install', ['--depth', '1', '--branch', 'v1.0.0'])
    expect(await move(dir, { url: undefined })).toEqual({ ok: false, error: 'moveToTag: no repository URL given' })
    expect(head(dir)).toBe(repo.ids['v1.0.0'])
  })

  test('a tag re-pointed upstream after an earlier fetch is followed', async () => {
    // A private seed: this test moves a tag, and the shared seed stays as is.
    const own = seedRepo(path.join(tmp, 'own-seed'), [release('1.0.0', 'v1.0.0'), release('1.1.0', 'v1.1.0')])
    const dir = path.join(tmp, 'install')
    git(['clone', '--depth', '1', '--branch', 'v1.0.0', own.url, dir])
    const ownMove = () => moveToTag({ cwd: dir, tag: 'v1.1.0', url: own.url, onData: () => {} })
    expect(await ownMove()).toEqual({ ok: true })

    const work = path.join(tmp, 'own-seed', 'work')
    fs.writeFileSync(path.join(work, 'app.txt'), 'app 1.1.0, re-cut\n')
    commitAll(work, 're-cut 1.1.0')
    git(['tag', '-f', 'v1.1.0'], work)
    git(['push', '-f', 'origin', 'v1.1.0'], work)
    const recut = gitOut(['rev-parse', 'HEAD'], work)

    expect(await ownMove()).toEqual({ ok: true })
    expect(head(dir)).toBe(recut)
  })

  test('a directory that is not a git repository fails', async () => {
    const dir = path.join(tmp, 'plain')
    fs.mkdirSync(dir)
    const r = await move(dir)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/not a git repository/)
  })
})
