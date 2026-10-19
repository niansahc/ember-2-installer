// Hermetic integration test for readApiKey (src/exec/api-key.js). Drives a real
// subprocess: a stand-in scripts/set_api_key.py, written as a node script and run
// with node in place of the venv python, that mimics the real script's output
// (`Key: <key>` on stdout). The key is synthetic.

const { test, expect } = require('@playwright/test')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { run } = require('../../src/exec/run')
const { readApiKey } = require('../../src/exec/api-key')

const NODE = `"${process.execPath}"`
const KEY = 'synthetic_api_key_for_tests_0123456789abc'

// keyExists: --check exit code. stderrLine: echoed on stderr by --non-interactive.
function fakeScript({ keyExists, exitCode = 0, printKey = true, stderrLine = 'keyring: using fake backend' }) {
  return `
const args = process.argv.slice(2)
if (args.includes('--check')) {
  console.log(${keyExists} ? 'API key is configured.' : 'No API key found.')
  process.exit(${keyExists} ? 0 : 1)
}
if (args.includes('--non-interactive')) {
  process.stderr.write(${JSON.stringify(stderrLine)} + ' ' + ${JSON.stringify(KEY)} + '\\n')
  console.log(${keyExists} ? 'API key already configured. No changes made.' : 'API key stored in system credential store.')
  if (${printKey}) console.log('Key: ${KEY}')
  process.exit(${exitCode})
}
`
}

test.describe('readApiKey', () => {
  let emberPath
  test.beforeEach(() => {
    emberPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-apikey-'))
    fs.mkdirSync(path.join(emberPath, 'scripts'))
  })
  test.afterEach(() => {
    try { fs.rmSync(emberPath, { recursive: true, force: true }) } catch {}
  })

  function writeScript(opts) {
    fs.writeFileSync(path.join(emberPath, 'scripts', 'set_api_key.py'), fakeScript(opts))
  }

  test('returns the key and reports a newly created one', async () => {
    writeScript({ keyExists: false })
    const r = await readApiKey({ pyBin: NODE, emberPath })
    expect(r).toEqual({ ok: true, created: true, key: KEY, error: null })
  })

  test('reports an existing key as not created', async () => {
    writeScript({ keyExists: true })
    const r = await readApiKey({ pyBin: NODE, emberPath })
    expect(r.ok).toBe(true)
    expect(r.created).toBe(false)
    expect(r.key).toBe(KEY)
  })

  test('the log sink never receives the key', async () => {
    writeScript({ keyExists: false })
    const sink = []
    const r = await readApiKey({ pyBin: NODE, emberPath, onLog: (t) => sink.push(t) })
    expect(r.ok).toBe(true)
    // stderr did reach the sink, so the sink is live; only the key is missing.
    expect(sink.join('')).toContain('keyring: using fake backend')
    expect(sink.join('')).not.toContain(KEY)
  })

  test('control: streaming the same script (the old runSpawn path) delivers the key', async () => {
    writeScript({ keyExists: false })
    const sink = []
    await run(NODE, ['scripts/set_api_key.py', '--non-interactive'], {
      cwd: emberPath,
      onData: (chunk) => sink.push(chunk),
    })
    expect(sink.join('')).toContain(KEY)
  })

  test('a failing script resolves ok:false with the key redacted from the error', async () => {
    writeScript({ keyExists: false, exitCode: 2 })
    const r = await readApiKey({ pyBin: NODE, emberPath })
    expect(r.ok).toBe(false)
    expect(r.key).toBeNull()
    expect(r.error).not.toContain(KEY)
  })

  test('output without a Key: line resolves ok:false', async () => {
    writeScript({ keyExists: false, printKey: false, stderrLine: '' })
    const r = await readApiKey({ pyBin: NODE, emberPath })
    expect(r.ok).toBe(false)
    expect(r.key).toBeNull()
  })
})
