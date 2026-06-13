// Process-execution helpers. Unlike src/lib (pure logic), modules here do I/O
// (spawn child processes) and are exercised by hermetic integration tests. The
// #7 run() helper will live alongside this later.

const { spawn } = require('child_process')

// Production backend repo. url is injectable per-call so a hermetic test can
// point at a local bare repo, but only tests pass one — the IPC handlers call
// cloneRepo() with no url, so production always clones this. Injection lives at
// the function boundary, never on the IPC payload (which the renderer controls).
const DEFAULT_BACKEND_REPO_URL = 'https://github.com/niansahc/ember-2.git'

// Run `git clone --depth <depth> <url> <targetDir>`, streaming output to onData.
// Resolves { ok, code, error? } and never rejects.
function cloneRepo({ url = DEFAULT_BACKEND_REPO_URL, targetDir, depth = 1, onData } = {}) {
  return new Promise((resolve) => {
    // shell:true is preserved for parity with the original handlers. This — and
    // the interpolated targetDir (a user-chosen install path), not just url — is
    // the command-injection surface tracked in issue #11. Do not "fix" it here.
    const proc = spawn('git', ['clone', '--depth', String(depth), url, targetDir], { shell: true })
    const emit = (d) => { if (onData) onData(d.toString()) }
    proc.stdout.on('data', emit)
    proc.stderr.on('data', emit)
    proc.on('close', (code) => {
      if (code === 0) resolve({ ok: true, code })
      else resolve({ ok: false, code, error: `git clone exited with code ${code}` })
    })
    proc.on('error', (err) => resolve({ ok: false, error: err.message }))
  })
}

module.exports = { cloneRepo, DEFAULT_BACKEND_REPO_URL }
