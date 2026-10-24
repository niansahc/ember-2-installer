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

  test('a reset file edited before a failed fetch is left as it was', async () => {
    const dir = clone('install', ['--depth', '1', '--branch', 'v1.0.0'])
    fs.writeFileSync(path.join(dir, 'version.json'), '{"tag":"v1.0.0"}\n')
    const r = await move(dir, { tag: 'v9.9.9', resetFiles: ['version.json'] })
    expect(r.ok).toBe(false)
    expect(head(dir)).toBe(repo.ids['v1.0.0'])
    expect(fs.readFileSync(path.join(dir, 'version.json'), 'utf8')).toBe('{"tag":"v1.0.0"}\n')
  })

  test('control: the same edit is reset when the fetch succeeds', async () => {
    const dir = clone('install', ['--depth', '1', '--branch', 'v1.0.0'])
    fs.writeFileSync(path.join(dir, 'version.json'), '{"tag":"v1.0.0"}\n')
    expect(await move(dir, { resetFiles: ['version.json'] })).toEqual({ ok: true })
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'version.json'), 'utf8'))).toEqual({ version: '1.1.0' })
  })

  // A url.<base>.insteadOf rewrite, set through the environment for one call
  // only: the seed's file:// URL is rewritten to its plain path, which still
  // fetches, and git remote get-url reports the plain path.
  const withRewrite = async (fn) => {
    const env = {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: `url.${path.join(seedDir, 'src.git')}.insteadOf`,
      GIT_CONFIG_VALUE_0: repo.url,
    }
    const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]))
    Object.assign(process.env, env)
    try {
      return await fn()
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  }

  test('an insteadOf rewrite of the origin URL does not refuse the move', async () => {
    const dir = clone('install', ['--depth', '1', '--branch', 'v1.0.0'])
    expect(await withRewrite(() => move(dir))).toEqual({ ok: true })
    expect(head(dir)).toBe(repo.ids['v1.1.0'])
  })

  test('control: under the rewrite, git remote get-url reports another URL', async () => {
    const dir = clone('install', ['--depth', '1', '--branch', 'v1.0.0'])
    const rewritten = await withRewrite(() => gitOut(['remote', 'get-url', 'origin'], dir))
    expect(rewritten).toBe(path.join(seedDir, 'src.git'))
  })

  const CREDENTIALED = 'https://someone:synthetic-token-123@example.invalid/x/src.git'

  test('the refusal never shows credentials stored in the origin URL', async () => {
    const dir = clone('install', ['--depth', '1', '--branch', 'v1.0.0'])
    git(['remote', 'set-url', 'origin', CREDENTIALED], dir)
    const r = await move(dir)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('is a clone of https://example.invalid/x/src.git, not ')
    expect(r.error).not.toContain('synthetic-token-123')
  })

  test('control: the stored origin URL does carry the credentials', async () => {
    const dir = clone('install', ['--depth', '1', '--branch', 'v1.0.0'])
    git(['remote', 'set-url', 'origin', CREDENTIALED], dir)
    expect(gitOut(['config', '--get', 'remote.origin.url'], dir)).toBe(CREDENTIALED)
  })

  test('a directory that is not a git repository fails', async () => {
    const dir = path.join(tmp, 'plain')
    fs.mkdirSync(dir)
    const r = await move(dir)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/not a git repository/)
  })
})
