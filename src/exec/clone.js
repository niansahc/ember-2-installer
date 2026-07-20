// Process-execution helpers. Unlike src/lib (pure logic), modules here do I/O
// (spawn child processes) and are exercised by hermetic integration tests.
// cloneRepo is built on the shared run() engine (issue #7).

const { run } = require('./run')

// Production backend repo. url is injectable per-call so a hermetic test can
// point at a local bare repo, but only tests pass one — the IPC handlers call
// cloneRepo() with no url, so production always clones this. Injection lives at
// the function boundary, never on the IPC payload (which the renderer controls).
const DEFAULT_BACKEND_REPO_URL = 'https://github.com/niansahc/ember-2.git'

// Run `git clone --depth <depth> <url> <targetDir>`, streaming output to onData.
// Resolves { ok, code, error? } and never rejects. run() keeps shell:true by
// default — that, plus the interpolated targetDir (a user-chosen install path),
// is the command-injection surface tracked in issue #11. Do not "fix" it here.
function cloneRepo({ url = DEFAULT_BACKEND_REPO_URL, targetDir, depth = 1, onData } = {}) {
  return run('git', ['clone', '--depth', String(depth), url, targetDir], {
    onData: (chunk) => { if (onData) onData(chunk) },
  }).then((r) => {
    if (r.error !== null) return { ok: false, error: r.error }
    if (r.ok) return { ok: true, code: r.code }
    return { ok: false, code: r.code, error: `git clone exited with code ${r.code}` }
  })
}

module.exports = { cloneRepo, DEFAULT_BACKEND_REPO_URL }
