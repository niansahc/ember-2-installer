// Hermetic integration/unit test for run() (src/exec/run.js). Requires the
// module directly (no Electron), drives real subprocesses with harmless node
// scripts, and asserts the uniform result contract. This is the seam ADR 0001
// designates for real (non-demo) coverage of the orchestration layer.
// Needs `node` on PATH (process.execPath is used directly).

const { test, expect } = require('@playwright/test')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { run, failureReason } = require('../../src/exec/run')
const { registerSecret } = require('../../src/lib/redact')

const NODE = process.execPath

test.describe('run()', () => {
  let tmp
  test.beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-run-'))
  })
  test.afterEach(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
  })

  test('resolves ok:true and captures stdout on a clean exit', async () => {
    const r = await run(NODE, ['-e', 'process.stdout.write("hello\\n")'], { shell: false })
    expect(r.ok).toBe(true)
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('hello\n')
    expect(r.error).toBeNull()
    expect(r.timedOut).toBe(false)
  })

  test('resolves ok:false with the exit code on a nonzero exit', async () => {
    const r = await run(NODE, ['-e', 'process.exit(3)'], { shell: false })
    expect(r.ok).toBe(false)
    expect(r.code).toBe(3)
    expect(r.timedOut).toBe(false)
  })

  test('honors okCodes so a nonzero code can count as success', async () => {
    const r = await run(NODE, ['-e', 'process.exit(1)'], { shell: false, okCodes: [0, 1] })
    expect(r.ok).toBe(true)
    expect(r.code).toBe(1)
  })

  test('never rejects: resolves ok:false with a string error and code:null when spawn errors', async () => {
    const r = await run('ember-no-such-binary-xyz', [], { shell: false })
    expect(r.ok).toBe(false)
    expect(r.code).toBeNull()
    expect(typeof r.error).toBe('string')
    expect(r.error).toMatch(/ENOENT|not found|spawn/i)
  })

  test('streams stdout through onData, in order, matching the captured stdout', async () => {
    const chunks = []
    const r = await run(
      NODE,
      ['-e', 'process.stdout.write("a\\n"); process.stdout.write("b\\n")'],
      { shell: false, onData: (chunk, stream) => chunks.push([stream, chunk]) },
    )
    expect(r.ok).toBe(true)
    const streamed = chunks.filter(([s]) => s === 'stdout').map(([, c]) => c).join('')
    expect(streamed).toBe(r.stdout)
    expect(r.stdout).toBe('a\nb\n')
  })

  test('times out, tree-kills the process, and never rejects', async () => {
    // A shelled node sleeper that writes a marker file 5s in. If the timeout
    // tree-kills it, the marker never appears — proving the grandchild died,
    // not just the shell.
    const marker = path.join(tmp, 'marker.txt')
    const script = path.join(tmp, 'sleeper.cjs')
    fs.writeFileSync(
      script,
      `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'x'), 5000)`,
    )
    const started = Date.now()
    const r = await run(`"${NODE}" "${script}"`, [], { shell: true, timeout: 300 })
    const elapsed = Date.now() - started

    expect(r.timedOut).toBe(true)
    expect(r.ok).toBe(false)
    expect(r.code).toBeNull()
    expect(elapsed).toBeLessThan(4000) // resolved on timeout, not after the 5s write

    // Give any surviving process time to write, then assert it was killed.
    await new Promise((res) => setTimeout(res, 1000))
    expect(fs.existsSync(marker)).toBe(false)
  })
})

test.describe('failureReason()', () => {
  const failed = (stderr) => ({ ok: false, code: 1, stderr, error: null })

  test('names the exit code and the last paragraph of stderr', () => {
    expect(failureReason(failed('Building...\n\nerror during build:\nCould not resolve "./App".\n'), 'The UI build'))
      .toBe('The UI build exited with code 1: error during build: Could not resolve "./App"')
  })

  test('git: the first fatal line, not the advice after it', () => {
    const stderr = "Cloning into 'ember-2'...\nfatal: unable to access 'https://example.invalid/x.git/': Could not resolve host\n"
      + 'fatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.\n'
    expect(failureReason(failed(stderr), 'git clone'))
      .toBe("git clone exited with code 1: fatal: unable to access 'https://example.invalid/x.git/': Could not resolve host")
  })

  test('npm: the message, without the log-file block, prefixes or stack frames', () => {
    const stderr = 'npm ERR! code EUSAGE\nnpm ERR!\nnpm ERR! The `npm ci` command can only install with an existing package-lock.json or\n'
      + 'npm ERR! npm-shrinkwrap.json with lockfileVersion >= 1.\n    at ci (npm.js:1:1)\n\n'
      + 'npm ERR! A complete log of this run can be found in:\nnpm ERR!     C:\\cache\\debug-0.log\n'
    expect(failureReason(failed(stderr), 'npm ci')).toBe('npm ci exited with code 1: The `npm ci` command can only install with an '
      + 'existing package-lock.json or npm-shrinkwrap.json with lockfileVersion >= 1')
  })

  test('no stderr gives the exit code alone', () => {
    expect(failureReason(failed(''), 'npm ci')).toBe('npm ci exited with code 1')
  })

  test('a command that could not start gives run()\'s own error', () => {
    expect(failureReason({ ok: false, code: null, stderr: '', error: 'spawn npm ENOENT' }, 'npm ci')).toBe('npm ci failed: spawn npm ENOENT')
  })

  test('a registered secret in the stderr line is redacted', () => {
    registerSecret('run-spec-secret-value')
    const text = failureReason({ ok: false, code: 1, stderr: 'bad key run-spec-secret-value\n', error: null }, 'build')
    expect(text).not.toContain('run-spec-secret-value')
  })

  test('control: an unregistered value in the stderr line is shown', () => {
    const text = failureReason({ ok: false, code: 1, stderr: 'bad key run-spec-other-value\n', error: null }, 'build')
    expect(text).toContain('run-spec-other-value')
  })
})
