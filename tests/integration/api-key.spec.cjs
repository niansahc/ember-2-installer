// Hermetic integration test for readApiKey and uiBuildEnvWithKey
// (src/exec/api-key.js). Drives a real subprocess: a stand-in
// scripts/set_api_key.py, written as a node script and run with node in place of
// the venv python, that mimics the real script's output (`Key: <key>` on stdout)
// and appends a line to starts.log on every start. Keys are synthetic.

const { test, expect } = require('@playwright/test')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { run } = require('../../src/exec/run')
const { readApiKey, uiBuildEnvWithKey } = require('../../src/exec/api-key')

const NODE = `"${process.execPath}"`
const KEY = 'synthetic_api_key_for_tests_0123456789abc'
const ROTATED_KEY = 'synthetic_rotated_key_for_tests_9876543210'

// keyExists: which status line --non-interactive prints (the real script's two).
// stderrLine: echoed on stderr by --non-interactive. The stored key is read from
// stored-key.txt when present, so a test can rotate it between runs.
function fakeScript({ keyExists, exitCode = 0, printKey = true, stderrLine = 'keyring: using fake backend' }) {
  return `
const fs = require('fs')
fs.appendFileSync('starts.log', 'start\\n')
const key = fs.existsSync('stored-key.txt') ? fs.readFileSync('stored-key.txt', 'utf-8').trim() : ${JSON.stringify(KEY)}
if (process.argv.includes('--non-interactive')) {
  process.stderr.write(${JSON.stringify(stderrLine)} + ' ' + key + '\\n')
  console.log(${keyExists} ? 'API key already configured. No changes made.' : 'API key stored in system credential store.')
  if (${printKey}) console.log('Key: ' + key)
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

  function starts() {
    const log = path.join(emberPath, 'starts.log')
    return fs.existsSync(log) ? fs.readFileSync(log, 'utf-8').trim().split('\n').length : 0
  }

  test('returns the key and reports a newly created one, in one Python start', async () => {
    writeScript({ keyExists: false })
    const r = await readApiKey({ pyBin: NODE, emberPath })
    expect(r).toEqual({ ok: true, created: true, key: KEY, error: null })
    expect(starts()).toBe(1)
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

test.describe('uiBuildEnvWithKey', () => {
  let emberPath
  test.beforeEach(() => {
    emberPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-uibuild-'))
    fs.mkdirSync(path.join(emberPath, 'scripts'))
    fs.writeFileSync(path.join(emberPath, 'scripts', 'set_api_key.py'), fakeScript({ keyExists: false }))
  })
  test.afterEach(() => {
    try { fs.rmSync(emberPath, { recursive: true, force: true }) } catch {}
  })

  const opts = () => ({ pyBin: NODE, emberPath, log: () => {}, parentEnv: { PATH: '/usr/bin' } })

  const builtKey = async () => {
    const { env } = await uiBuildEnvWithKey(opts())
    return env.EMBER_API_KEY
  }

  test('reads the key fresh for each build: a rotated key reaches the next build', async () => {
    expect(await builtKey()).toBe(KEY)
    fs.writeFileSync(path.join(emberPath, 'stored-key.txt'), ROTATED_KEY)
    expect(await builtKey()).toBe(ROTATED_KEY)
  })

  test('fresh install (apikey step, then build-ui) starts Python twice', async () => {
    await readApiKey({ pyBin: NODE, emberPath })
    await uiBuildEnvWithKey(opts())
    expect(fs.readFileSync(path.join(emberPath, 'starts.log'), 'utf-8').trim().split('\n')).toHaveLength(2)
  })

  test('the build log never receives the key', async () => {
    const sink = []
    const { env } = await uiBuildEnvWithKey({ ...opts(), log: (t) => sink.push(t) })
    expect(env.EMBER_API_KEY).toBe(KEY)
    expect(sink.join('')).toContain('Reading API key for the UI build')
    expect(sink.join('')).not.toContain(KEY)
  })

  test('keyOk is false when the key cannot be read, and the build gets no key', async () => {
    fs.writeFileSync(path.join(emberPath, 'scripts', 'set_api_key.py'), fakeScript({ keyExists: false, exitCode: 1, printKey: false }))
    const { env, keyOk, error } = await uiBuildEnvWithKey(opts())
    expect(keyOk).toBe(false)
    expect(error).toBeTruthy()
    expect(env.EMBER_API_KEY).toBeUndefined()
  })

  test('control: keyOk is true when the key is read, with no error', async () => {
    const r = await uiBuildEnvWithKey(opts())
    expect(r.keyOk).toBe(true)
    expect(r.error).toBeNull()
  })
})
