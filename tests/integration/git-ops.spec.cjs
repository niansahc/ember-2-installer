// Hermetic integration test for the git-family paths that run() now powers
// (issue #7). Seeds a real local git repo in a temp dir and drives run()
// exactly as the production handlers do — no network, no Electron, no daemon.
// Needs `git` on PATH (present on dev + CI).

const { test, expect } = require('@playwright/test')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { run } = require('../../src/exec/run')

const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'ignore' })
const commit = (cwd, msg) =>
  git(['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-m', msg], cwd)

test.describe('run() git-family paths', () => {
  let tmp
  test.beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-gitops-'))
  })
  test.afterEach(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
  })

  test('git describe returns the latest tag (the check-ember-update path)', async () => {
    const repo = path.join(tmp, 'repo')
    fs.mkdirSync(repo)
    git(['init', '--initial-branch=main'], repo)
    fs.writeFileSync(path.join(repo, 'version.json'), '{"tag":"v9.9.9"}\n')
    git(['add', '.'], repo)
    commit(repo, 'init')
    git(['tag', 'v1.2.3'], repo)

    const r = await run('git', ['describe', '--tags', '--abbrev=0'], { cwd: repo })
    expect(r.ok).toBe(true)
    expect(r.stdout.trim()).toBe('v1.2.3')
  })

  test('git describe reports ok:false when the repo has no tags', async () => {
    const untagged = path.join(tmp, 'untagged')
    fs.mkdirSync(untagged)
    git(['init', '--initial-branch=main'], untagged)
    fs.writeFileSync(path.join(untagged, 'f.txt'), 'x')
    git(['add', '.'], untagged)
    commit(untagged, 'init')

    // check-ember-update maps this to installed = null; run-ember-update (the
    // preserved divergence) maps it to the empty printed string instead.
    const r = await run('git', ['describe', '--tags', '--abbrev=0'], { cwd: untagged })
    expect(r.ok).toBe(false)
    expect(r.error).toBeNull() // it exited non-zero; it did not fail to spawn
  })

  test('git checkout -- <file> restores a locally modified file (the reset path)', async () => {
    const repo = path.join(tmp, 'repo')
    fs.mkdirSync(repo)
    git(['init', '--initial-branch=main'], repo)
    const vf = path.join(repo, 'version.json')
    fs.writeFileSync(vf, '{"tag":"v1.0.0"}\n')
    git(['add', '.'], repo)
    commit(repo, 'init')
    // Local edit — this is what blocks git pull in production before the reset.
    fs.writeFileSync(vf, '{"tag":"LOCAL-EDIT"}\n')

    const r = await run('git', ['checkout', '--', 'version.json'], { cwd: repo })
    expect(r.ok).toBe(true)
    // Assert on content, not exact bytes — core.autocrlf may rewrite line endings.
    const restored = fs.readFileSync(vf, 'utf-8')
    expect(restored).toContain('v1.0.0')
    expect(restored).not.toContain('LOCAL-EDIT')
  })
})
