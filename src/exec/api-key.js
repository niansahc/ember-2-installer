// API key retrieval. ember-2's set_api_key.py stores the key in the OS
// credential store and prints `Key: <key>` for a person at a terminal. The
// installer reads that line from captured stdout here, and nowhere else: run()
// gets no onData hook, so the key is never streamed to a log channel.

const { run } = require('./run')
const { registerSecret, redactSecrets } = require('../lib/redact')

const SCRIPT = 'scripts/set_api_key.py'

// Ensure a key exists and return it. --non-interactive generates one when none
// is stored and prints the existing one otherwise; --check runs first only to
// tell the two apart. onLog receives the script's stderr, redacted.
// Resolves { ok, created, key, error }; never rejects (run() never does).
async function readApiKey({ pyBin, emberPath, onLog } = {}) {
  const existed = (await run(pyBin, [SCRIPT, '--check'], { cwd: emberPath })).ok
  const r = await run(pyBin, [SCRIPT, '--non-interactive'], { cwd: emberPath })
  const match = r.error === null ? r.stdout.match(/Key:[ \t]*(\S+)/) : null
  const key = match ? match[1] : null
  if (key) registerSecret(key)

  const stderr = redactSecrets(r.stderr.trim())
  if (stderr && onLog) onLog(`${stderr}\n`)

  if (!r.ok || !key) {
    const reason = r.error || stderr || (r.ok ? 'no key in script output' : `exit code ${r.code}`)
    return { ok: false, created: false, key: null, error: redactSecrets(reason) }
  }
  return { ok: true, created: !existed, key, error: null }
}

module.exports = { readApiKey }
