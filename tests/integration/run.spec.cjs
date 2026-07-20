// Hermetic integration/unit test for run() (src/exec/run.js). Requires the
// module directly (no Electron), drives real subprocesses with harmless node
// scripts, and asserts the uniform result contract. This is the seam ADR 0001
// designates for real (non-demo) coverage of the orchestration layer.
// Needs `node` on PATH (process.execPath is used directly).

const { test, expect } = require('@playwright/test')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { run } = require('../../src/exec/run')

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
