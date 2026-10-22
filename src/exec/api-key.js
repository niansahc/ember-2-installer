// API key retrieval. ember-2's set_api_key.py stores the key in the OS
// credential store and prints `Key: <key>` for a person at a terminal. The
// installer reads that line from captured stdout here, and nowhere else: run()
// gets no onData hook, so the key is never streamed to a log channel.

const { run } = require('./run')
const { uiBuildEnv } = require('../lib/env')
const { parseKeyLine, registerSecret, redactSecrets } = require('../lib/redact')

const SCRIPT = 'scripts/set_api_key.py'

// The line --non-interactive prints when it generated a new key; for an existing
// key it prints "API key already configured. No changes made." instead.
const CREATED_LINE = 'API key stored in system credential store.'

// Ensure a key exists and return it, in one Python start. --non-interactive
// generates one when none is stored and prints the existing one otherwise.
// onLog receives the script's stderr, redacted.
// Resolves { ok, created, key, error }; never rejects (run() never does).
async function readApiKey({ pyBin, emberPath, onLog } = {}) {
  const r = await run(pyBin, [SCRIPT, '--non-interactive'], { cwd: emberPath })
  const key = parseKeyLine(r.stdout)
  if (key) registerSecret(key)

  const stderr = redactSecrets(r.stderr.trim())
  if (stderr && onLog) onLog(`${stderr}\n`)

  if (!r.ok || !key) {
    const reason = r.error || stderr || (r.ok ? 'no key in script output' : `exit code ${r.code}`)
    return { ok: false, created: false, key: null, error: redactSecrets(reason) }
  }
  return { ok: true, created: r.stdout.includes(CREATED_LINE), key, error: null }
}

// The environment for `npm run build` in ember-2-ui. The bundle needs the API
// key baked in, or every authenticated request to the backend fails. The key is
// read fresh for each build, so a key rotated while the installer is open is
// picked up. It reaches the build through the child's environment only; nothing
// holding it is written to disk.
async function uiBuildEnvWithKey({ pyBin, emberPath, log, parentEnv = process.env }) {
  log('Reading API key for the UI build...\n')
  const keyResult = await readApiKey({ pyBin, emberPath, onLog: log })
  if (!keyResult.ok) log('Warning: could not retrieve API key — UI will build without auth\n')
  return uiBuildEnv(parentEnv, keyResult.key)
}

module.exports = { readApiKey, uiBuildEnvWithKey }
