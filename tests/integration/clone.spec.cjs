// Hermetic integration test for cloneRepo (src/exec/clone.js). Requires the
// module directly (no Electron), clones a local bare repo into a temp dir, and
// asserts the result. Exercises the real git-clone path that demo mode replaces.
// Needs `git` on PATH (present on dev + CI).

const { test, expect } = require('@playwright/test')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { pathToFileURL } = require('url')
const { cloneRepo } = require('../../src/exec/clone')

const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'ignore' })
const gitOut = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const commit = (cwd, msg) =>
  git(['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-m', msg], cwd)

// A bare repo whose main is one commit ahead of tag v1.0.0, as ember-2 is
// between releases. Returns a file:// URL for it (git ignores --depth on a plain
// local path, so the clone would not be shallow as a real one is) and both
// commit ids.
function seedRepo(tmp) {
  const bare = path.join(tmp, 'src.git')
  const work = path.join(tmp, 'work')
  execFileSync('git', ['init', '--bare', '--initial-branch=main', bare], { stdio: 'ignore' })
  fs.mkdirSync(work)
  git(['init', '--initial-branch=main'], work)
  fs.writeFileSync(path.join(work, 'README.md'), 'release\n')
  git(['add', '.'], work)
  commit(work, 'release 1.0.0')
  git(['tag', 'v1.0.0'], work)
  const tagged = gitOut(['rev-parse', 'HEAD'], work)
  fs.writeFileSync(path.join(work, 'README.md'), 'unreleased\n')
  git(['add', '.'], work)
  commit(work, 'unreleased work on main')
  const mainHead = gitOut(['rev-parse', 'HEAD'], work)
  git(['remote', 'add', 'origin', bare], work)
  git(['push', 'origin', 'main', '--tags'], work)
  git(['symbolic-ref', 'HEAD', 'refs/heads/main'], bare)
  return { bare: pathToFileURL(bare).href, tagged, mainHead }
}

test.describe('cloneRepo', () => {
  let tmp
  test.beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-clone-'))
  })
  test.afterEach(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
  })

  test('clones the given tag, not main, and reports ok', async () => {
    const { bare, tagged, mainHead } = seedRepo(tmp)
    const target = path.join(tmp, 'clone')
    const result = await cloneRepo({ url: bare, targetDir: target, tag: 'v1.0.0', onData: () => {} })

    expect(result.ok).toBe(true)
    expect(gitOut(['rev-parse', 'HEAD'], target)).toBe(tagged)
    expect(gitOut(['rev-parse', 'HEAD'], target)).not.toBe(mainHead)
    expect(fs.readFileSync(path.join(target, 'README.md'), 'utf8').trim()).toBe('release')
    expect(gitOut(['rev-parse', '--is-shallow-repository'], target)).toBe('true')
  })

  test('control: the same repo cloned without a tag lands on main\'s newer commit', () => {
    const { bare, mainHead } = seedRepo(tmp)
    const target = path.join(tmp, 'clone-default')
    git(['clone', '--depth', '1', bare, target])
    expect(gitOut(['rev-parse', 'HEAD'], target)).toBe(mainHead)
  })

  test('refuses to clone without a tag and creates nothing', async () => {
    const { bare } = seedRepo(tmp)
    const target = path.join(tmp, 'clone')
    const result = await cloneRepo({ url: bare, targetDir: target, onData: () => {} })
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
    const { bare } = seedRepo(tmp)
    const result = await cloneRepo({ url: bare, targetDir: path.join(tmp, 'clone'), tag: 'v9.9.9', onData: () => {} })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/exited with code/)
  })
})
