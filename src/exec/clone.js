// Process-execution helpers. Unlike src/lib (pure logic), modules here do I/O
// (spawn child processes) and are exercised by hermetic integration tests.
// cloneRepo is built on the shared run() engine (issue #7).

const fs = require('fs')
const path = require('path')
const { run, failureReason } = require('./run')
const { TIMEOUTS, gitNetworkEnv } = require('./limits')

// Production backend repo, the default url. Production passes either this or
// REPO_UI_URL (src/main.js), both constants; a hermetic test passes a local
// bare repo. url is never taken from the IPC payload (which the renderer
// controls): injection lives at the function boundary only.
const DEFAULT_BACKEND_REPO_URL = 'https://github.com/niansahc/ember-2.git'

// Run `git clone --depth 1 --branch <tag> <url> <folder>` in targetDir's
// parent, streaming output to onData. tag is required: production clones the
// pinned release tag (src/lib/release-pin.js), never the default branch.
// Resolves { ok, code, error? } and never rejects; error carries the cause git
// printed (failureReason). A stalled clone is stopped (src/exec/limits.js).
//
// The parent is the working directory and only the folder name is an
// argument: run() keeps shell:true and joins arguments unquoted, so a parent
// path with a space (C:\Users\Jane Doe\...) would split. The production folder
// names, ember-2 and ember-2-ui, have none. shell:true itself is the
// command-injection surface tracked in issue #11. Do not "fix" it here.
function cloneRepo({ url = DEFAULT_BACKEND_REPO_URL, targetDir, tag, onData } = {}) {
  if (!tag) return Promise.resolve({ ok: false, error: 'cloneRepo: no release tag given' })
  const parent = path.dirname(targetDir)
  try {
    fs.mkdirSync(parent, { recursive: true })
  } catch (err) {
    return Promise.resolve({ ok: false, error: `Cannot create ${parent}: ${err.message}` })
  }
  return run('git', ['clone', '--depth', '1', '--branch', tag, url, path.basename(targetDir)], {
    cwd: parent,
    env: gitNetworkEnv(),
    timeout: TIMEOUTS.gitNetwork,
    onData: (chunk) => { if (onData) onData(chunk) },
  }).then((r) => {
    if (r.error !== null) return { ok: false, error: failureReason(r, 'git clone') }
    if (r.ok) return { ok: true, code: r.code }
    return { ok: false, code: r.code, error: failureReason(r, 'git clone') }
  })
}

module.exports = { cloneRepo, DEFAULT_BACKEND_REPO_URL }
