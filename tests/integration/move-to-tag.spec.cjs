// Hermetic integration test for moveToTag (src/exec/move-to-tag.js): real git
// against a local bare repo in a temp dir. No network, no Electron.
// Needs `git` on PATH (present on dev + CI).

const { test, expect } = require('@playwright/test')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { pathToFileURL } = require('url')
const { moveToTag } = require('../../src/exec/move-to-tag')

const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'ignore' })
const gitOut = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const commitAll = (cwd, msg) => {
  git(['add', '.'], cwd)
  git(['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-m', msg], cwd)
}

// Releases v1.0.0 and v1.1.0, then unreleased work on main, as ember-2 has.
// The URL is file:// so --depth is honoured (a plain path makes a full clone).
function seedRepo(tmp) {
  const bare = path.join(tmp, 'src.git')
  const work = path.join(tmp, 'work')
  execFileSync('git', ['init', '--bare', '--initial-branch=main', bare], { stdio: 'ignore' })
  fs.mkdirSync(work)
  git(['init', '--initial-branch=main'], work)
  const ids = {}
  for (const [v, tag] of [['1.0.0', 'v1.0.0'], ['1.1.0', 'v1.1.0'], ['1.2.0-dev', null]]) {
    fs.writeFileSync(path.join(work, 'version.json'), `{"version":"${v}"}\n`)
    fs.writeFileSync(path.join(work, 'app.txt'), `app ${v}\n`)
    commitAll(work, `version ${v}`)
    if (tag) git(['tag', tag], work)
    ids[tag || 'main'] = gitOut(['rev-parse', 'HEAD'], work)
  }
  git(['remote', 'add', 'origin', bare], work)
  git(['push', 'origin', 'main', '--tags'], work)
  git(['symbolic-ref', 'HEAD', 'refs/heads/main'], bare)
  return { url: pathToFileURL(bare).href, ids }
}

test.describe('moveToTag', () => {
  let tmp
  let repo
  const clone = (name, args) => {
    const dir = path.join(tmp, name)
    git(['clone', ...args, repo.url, dir])
    return dir
  }
  const head = (dir) => gitOut(['rev-parse', 'HEAD'], dir)
  const move = (dir, opts = {}) => moveToTag({ cwd: dir, tag: 'v1.1.0', onData: () => {}, ...opts })

  test.beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-move-'))
    repo = seedRepo(tmp)
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

  test('a directory that is not a git repository fails', async () => {
    const dir = path.join(tmp, 'plain')
    fs.mkdirSync(dir)
    const r = await move(dir)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/not a git repository/)
  })
})
