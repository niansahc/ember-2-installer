// Hermetic integration test for cloneRepo (src/exec/clone.js). Requires the
// module directly (no Electron), clones a local bare repo into a temp dir, and
// asserts the result. Exercises the real git-clone path that demo mode replaces.
// Needs `git` on PATH (present on dev + CI).

const { test, expect } = require('@playwright/test')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { cloneRepo } = require('../../src/exec/clone')

const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'ignore' })

test.describe('cloneRepo', () => {
  let tmp
  test.beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-clone-'))
  })
  test.afterEach(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
  })

  test('clones an injected local repo into the target dir and reports ok', async () => {
    // Seed a bare repo with one commit on main.
    const bare = path.join(tmp, 'src.git')
    const work = path.join(tmp, 'work')
    execFileSync('git', ['init', '--bare', '--initial-branch=main', bare], { stdio: 'ignore' })
    fs.mkdirSync(work)
    git(['init'], work)
    fs.writeFileSync(path.join(work, 'README.md'), 'hi\n')
    git(['add', '.'], work)
    git(['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-m', 'init'], work)
    git(['branch', '-M', 'main'], work)
    git(['remote', 'add', 'origin', bare], work)
    git(['push', 'origin', 'main'], work)
    // Ensure the bare repo's HEAD tracks main so the clone checks it out.
    git(['symbolic-ref', 'HEAD', 'refs/heads/main'], bare)

    const target = path.join(tmp, 'clone')
    const result = await cloneRepo({ url: bare, targetDir: target, onData: () => {} })

    expect(result.ok).toBe(true)
    expect(fs.existsSync(path.join(target, 'README.md'))).toBe(true)
  })

  test('reports a string error (not undefined) when the clone fails', async () => {
    const result = await cloneRepo({
      url: path.join(tmp, 'does-not-exist.git'),
      targetDir: path.join(tmp, 'clone'),
      onData: () => {},
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/exited with code|ENOENT|not found/i)
  })
})
