// Input caps in both guards. A PreToolUse hook that times out or crashes does
// not block the call (Claude Code docs, "Hooks reference > Exit code output >
// Timeouts"; checked live in a scratch project: with a 1 s timeout the tool
// call ran, with "onFailure": "block" it was blocked), so no input may make a
// guard slow or crash it. Run as hook processes against tmp fixtures.
//
// Every cap has a control: the same input one step under the cap is
// checked, not denied for size.

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { makeFixture, liveVaultFixture, runGuard, call, deny, allow } = require('./helpers.cjs')
const { MAX_COMMAND_CHARS, parseShell, expandBraces, BraceOverflow } = require('../../.claude/hooks/hook-utils.cjs')

const FX = liveVaultFixture()
test.after(() => FX.cleanup())
const ROOT = { cwd: FX.root }
const vault = (tool, command) => runGuard('vault-guard', call(tool, { command }, ROOT), FX)
const envg = (tool, input) => runGuard('env-guard', call(tool, input, ROOT), FX)
const ENV = '.' + 'env'

const timed = (fn) => {
  const t = process.hrtime.bigint()
  const result = fn()
  return { result, ms: Number(process.hrtime.bigint() - t) / 1e6 }
}

test('the command length cap: 16384 characters are checked, 16385 are denied, by both guards', () => {
  assert.equal(MAX_COMMAND_CHARS, 16384)
  const fit = 'echo ' + 'a'.repeat(MAX_COMMAND_CHARS - 5)
  const over = fit + 'a'
  for (const tool of ['Bash', 'PowerShell']) {
    allow(vault(tool, fit))
    allow(envg(tool, { command: fit }))
    const v = deny(vault(tool, over))
    const e = deny(envg(tool, { command: over }))
    assert.match(v.reason, /16385 characters, over the 16384 limit/)
    assert.match(e.reason, /16385 characters, over the 16384 limit/)
  }
  // Positive control for "checked": a vault name inside a command at the limit is still denied.
  deny(vault('Bash', 'cat private_vault/x ' + 'a'.repeat(MAX_COMMAND_CHARS - 21)))
  // The cap is for commands: a long Write body is not a command.
  allow(envg('Write', { file_path: path.join(FX.project, 'notes.txt'), content: 'a'.repeat(MAX_COMMAND_CHARS * 4) }))
  allow(vault('Write', { file_path: path.join(FX.project, 'notes.txt'), content: 'a'.repeat(MAX_COMMAND_CHARS * 4) }))
})

test('env-guard: brace patterns past the cap are denied before they are expanded', () => {
  const sets = (n) => '{a,b}'.repeat(n)
  // Control: 7 sets (128 alternatives) are expanded and checked; the env name among them is found.
  allow(envg('Glob', { pattern: sets(7) }))
  const named = envg('Glob', { pattern: `{${ENV},a}` + '{,}'.repeat(6) }) // 128 alternatives, one is the env name
  assert.match(deny(named).reason, /matched/)
  // Past 256 alternatives: denied with the limit named, and fast (it was 10 s and then out of memory).
  const over = timed(() => envg('Glob', { pattern: `{${ENV},a}` + '{,}'.repeat(8) })) // 512
  assert.match(deny(over.result).reason, /past the limit \(256 alternatives/)
  assert.ok(over.ms < 1000, `${over.ms} ms`)
  const grep = timed(() => envg('Grep', { pattern: 'x', glob: sets(20) }))
  assert.match(deny(grep.result).reason, /256 alternatives/)
  assert.ok(grep.ms < 1000, `${grep.ms} ms`)
  // More than 256 braces in one pattern.
  deny(envg('Glob', { pattern: '{'.repeat(257) }))
  allow(envg('Glob', { pattern: '{'.repeat(256) }))
})

test('settings: both guards fail closed on a timeout or crash', () => {
  const failsClosed = (settings) => {
    const hooks = settings.hooks.PreToolUse.flatMap((e) => e.hooks)
    const guards = hooks.filter((h) => /(env|vault)-guard\.cjs/.test(h.command))
    return guards.length === 2 && guards.every((h) => h.onFailure === 'block' && h.timeout <= 5)
  }
  const real = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '.claude', 'settings.json'), 'utf8'))
  assert.ok(failsClosed(real))
  // Control: the check fails when one guard lacks onFailure, or its timeout is raised.
  const missing = structuredClone(real)
  delete missing.hooks.PreToolUse[0].hooks[1].onFailure
  assert.ok(!failsClosed(missing))
  const slow = structuredClone(real)
  slow.hooks.PreToolUse[0].hooks[0].timeout = 30
  assert.ok(!failsClosed(slow))
})

// Worst cases at the caps. The hook timeout is 5 s; every row must finish well inside it.
const N = MAX_COMMAND_CHARS
const WORST = {
  'one word of 16384 {': 'echo ' + '{'.repeat(N - 5),
  'nested 8000-deep braces': 'echo ' + '{'.repeat(8000) + 'a,b' + '}'.repeat(8000),
  'nested {a, lists': 'cat ' + '{a,'.repeat(3000) + 'b' + '}'.repeat(3000),
  '256 live braces, a reader': 'cat ' + '{'.repeat(128) + 'a,b' + '}'.repeat(128),
}

test('timing: worst-case brace input at the cap is cut fast, in the parser and in a guard run', () => {
  for (const [name, command] of Object.entries(WORST)) {
    assert.ok(command.length <= N, name)
    // The parser and the expander, in process.
    const parsed = timed(() => {
      const script = parseShell(command, 'bash')
      for (const token of script.tokens) {
        if (typeof token === 'string' || token.heredoc) continue
        try {
          expandBraces(token.text, token.live)
        } catch (err) {
          if (!(err instanceof BraceOverflow)) throw err
        }
      }
    })
    assert.ok(parsed.ms < 1000, `${name}: parse ${parsed.ms} ms`)
    // End to end, a cold process each, both guards.
    const v = timed(() => vault('Bash', command))
    const e = timed(() => envg('Bash', { command }))
    assert.ok(v.ms < 1000, `${name}: vault-guard ${v.ms} ms`)
    assert.ok(e.ms < 1000, `${name}: env-guard ${e.ms} ms`)
  }
  // Control: the cap is what cuts them. A reader gets the limit reason, not a parse of 10^8 steps,
  // and the same words under the live-brace cap are expanded.
  assert.match(deny(vault('Bash', 'cat ' + '{'.repeat(257))).reason, /brace expansion past the limit/)
  assert.deepEqual(expandBraces('{a,b}', '11111'), ['a', 'b'])
})

test('timing: command chains at the cap finish inside half the hook timeout', () => {
  // Pre-existing cost, linear in the number of stages (a filesystem check per path word).
  const chains = {
    'pipe chain': ['Bash', 'cat a|'.repeat(Math.floor(N / 6))],
    'bash $() chain': ['Bash', 'cat ' + '$(a) '.repeat(Math.floor((N - 4) / 5))],
    'powershell $() chain': ['PowerShell', 'cat ' + '$(a) '.repeat(Math.floor((N - 4) / 5))],
  }
  for (const [name, [tool, command]] of Object.entries(chains)) {
    assert.ok(command.length <= N, name)
    const v = timed(() => vault(tool, command))
    assert.ok(v.ms < 2500, `${name}: ${v.ms} ms`)
    allow(v.result)
  }
})
