// Fail closed: an error inside a guard's check is a deny with exit 0, and the
// reason names only the guard and the exception type. A crashed hook exits
// non-zero, which the harness treats as a non-blocking error and runs the
// call, so a crash would be an allow.
//
// And the other side: a payload with no usable input, or one that is not
// JSON, is not an error; it is allowed with exit 0. Each allow below has a
// deny control on the same channel, so the absence assertions cannot pass
// vacuously.

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { makeFixture, liveVaultFixture, runGuard, call, deny, allow } = require('./helpers.cjs')
const { runHook } = require('../../.claude/hooks/hook-utils.cjs')
const envGuard = require('../../.claude/hooks/env-guard.cjs')
const vaultGuard = require('../../.claude/hooks/vault-guard.cjs')

const FAIL_REASON = /^(env-guard|vault-guard) could not complete its check \((\w+)\); denying/

test('vault-guard denies when the ember-2 .env exists but cannot be read', (t) => {
  const fx = makeFixture({ env: { dir: true } }) // a directory named .env: EISDIR
  t.after(fx.cleanup)
  const r = deny(runGuard('vault-guard', call('Read', { file_path: path.join(fx.project, 'src', 'main.js') }), fx))
  const m = r.reason.match(FAIL_REASON)
  assert.ok(m, r.reason)
  assert.equal(m[1], 'vault-guard')
  assert.ok(!r.reason.includes(fx.root), 'reason carries a path')
})

test('control: the same call with a readable .env is allowed', (t) => {
  const fx = liveVaultFixture()
  t.after(fx.cleanup)
  allow(runGuard('vault-guard', call('Read', { file_path: path.join(fx.project, 'src', 'main.js') }), fx))
})

// A `${` left after interpolation means the guard cannot know which
// directory the app will use, so every call is denied until it is fixed.
for (const [name, value] of [
  ['unclosed', 'PRIVATE_VAULT_PATH=${ROOT/vaults/live\n'],
  ['unsupported form', 'PRIVATE_VAULT_PATH=${ROOT:x}/vaults/live\n'],
]) {
  test(`vault-guard denies an unresolved interpolation (${name})`, (t) => {
    const fx = makeFixture({ env: `ROOT=vaults\n${value}`, dirs: ['ember-2/vaults/live'] })
    t.after(fx.cleanup)
    const r = deny(runGuard('vault-guard', call('Read', { file_path: path.join(fx.project, 'src', 'main.js') }), fx))
    assert.match(r.reason, FAIL_REASON)
    assert.ok(r.reason.includes('(UnresolvedInterpolation)'), r.reason)
    assert.ok(!r.reason.includes('ROOT') && !r.reason.includes(fx.root), 'reason carries the value')
  })
}

test('control: the same value with the interpolation closed allows the call', (t) => {
  const fx = makeFixture({ env: 'ROOT=vaults\nPRIVATE_VAULT_PATH=${ROOT}/live\n', dirs: ['ember-2/vaults/live'] })
  t.after(fx.cleanup)
  allow(runGuard('vault-guard', call('Read', { file_path: path.join(fx.project, 'src', 'main.js') }), fx))
  deny(runGuard('vault-guard', call('Read', { file_path: path.join(fx.ember2, 'vaults', 'live', 'a.json') }), fx))
})

// A configured vault whose location cannot be checked (stat fails with
// anything but "not there") is an error, not "no vault".
test('vault-guard denies when the configured vault location cannot be checked', (t) => {
  const fx = makeFixture({ env: 'PRIVATE_VAULT_PATH=vaults/live\0\n', dirs: ['ember-2/vaults/live'] })
  t.after(fx.cleanup)
  const r = deny(runGuard('vault-guard', call('Read', { file_path: path.join(fx.project, 'src', 'main.js') }), fx))
  assert.match(r.reason, FAIL_REASON)
  assert.ok(!r.reason.includes('vaults') && !r.reason.includes(fx.root), 'reason carries the value')
})

test('control: a configured vault that is simply not there allows the call', (t) => {
  const fx = makeFixture({ env: 'PRIVATE_VAULT_PATH=vaults/gone\n', dirs: ['ember-2/vaults/live'] })
  t.after(fx.cleanup)
  allow(runGuard('vault-guard', call('Read', { file_path: path.join(fx.project, 'src', 'main.js') }), fx))
})

for (const guard of [envGuard, vaultGuard]) {
  test(`${guard.GUARD}: an exception in the check is a deny naming only guard and type`, () => {
    const secret = path.join('C:', 'synthetic', 'secret-vault-location')
    const thrown = new TypeError(`cannot read ${secret}`)
    const r = runHook(guard.GUARD, JSON.stringify(call('Read', { file_path: 'x' })), () => { throw thrown }, guard.reason)
    const out = JSON.parse(r.stdout).hookSpecificOutput
    assert.equal(out.permissionDecision, 'deny')
    assert.match(out.permissionDecisionReason, FAIL_REASON)
    assert.ok(out.permissionDecisionReason.startsWith(`${guard.GUARD} `))
    assert.ok(out.permissionDecisionReason.includes('(TypeError)'))
    assert.ok(!r.stdout.includes(secret) && !r.stderr.includes(secret), 'exception message leaked')
    // Positive control: the message does carry the secret, so printing it would leak.
    assert.ok(String(thrown).includes(secret))
  })

  test(`${guard.GUARD}: an exception in the reason is a deny too`, () => {
    const r = runHook(guard.GUARD, '{}', () => 'target', () => { throw new RangeError('x') })
    assert.match(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason, /\(RangeError\)/)
  })
}

test('a thrown non-Error value is named by its type', () => {
  const r = runHook('env-guard', '{}', () => { throw 'C:/synthetic/path' }, envGuard.reason)
  const reason = JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason
  assert.match(reason, /\(string\)/)
  assert.ok(!reason.includes('synthetic'))
})

// ---------------------------------------------------------------------------
// No usable input: allow, exit 0.
// ---------------------------------------------------------------------------

const NO_INPUT = [
  '',
  'not json',
  'null',
  '[]',
  '{}',
  '{"tool_name":"Read"}',
  '{"tool_name":"Read","tool_input":null}',
  '{"tool_name":"Read","tool_input":{}}',
  '{"tool_name":"Read","tool_input":{"file_path":42}}',
  '{"tool_name":"Bash","tool_input":{}}',
  '{"tool_name":"Bash","tool_input":{"command":""}}',
  '{"tool_name":"WebFetch","tool_input":{"url":"https://example.com/.env"}}',
  '{"tool_input":{"file_path":".env"}}',
]

for (const guard of ['env-guard', 'vault-guard']) {
  test(`${guard}: payloads with no usable input are allowed with exit 0`, (t) => {
    const fx = liveVaultFixture()
    t.after(fx.cleanup)
    for (const raw of NO_INPUT) {
      const r = runGuard(guard, raw, fx)
      assert.equal(r.status, 0, `${raw}: ${r.stderr}`)
      assert.equal(r.stdout, '', `${raw}: ${r.stdout}`)
    }
    // Control: a usable payload on the same channel is denied.
    const target = guard === 'env-guard' ? '.env' : path.join(fx.ember2, 'vaults', 'live', 'a.json')
    deny(runGuard(guard, JSON.stringify(call('Read', { file_path: target })), fx))
  })
}

test('an unparseable payload notes the error type on stderr, not the payload', (t) => {
  const fx = makeFixture()
  t.after(fx.cleanup)
  const r = allow(runGuard('env-guard', 'C:/synthetic/.env {', fx))
  assert.match(r.stderr, /unparseable hook payload, allowing \(SyntaxError\)/)
  assert.ok(!r.stderr.includes('synthetic'))
  // Control: the same text as a parsed payload is denied.
  deny(runGuard('env-guard', call('Read', { file_path: 'C:/synthetic/.env' }), fx))
})

test('runGuard refuses to run without a fixture', () => {
  assert.throws(() => runGuard('vault-guard', call('Read', { file_path: 'x' }), null), /needs a fixture/)
})
