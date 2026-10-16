// Fail closed: an error inside a guard's check is a deny with exit 0, and the
// reason names only the guard and the exception type. A crashed hook exits
// non-zero, which the harness treats as a non-blocking error and runs the
// call, so a crash would be an allow.
//
// And the other side: a payload with no usable input is not an error; it is
// allowed with exit 0. Each allow below has a deny control on the same
// channel, so the absence assertions cannot pass vacuously.

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { makeFixture, runGuard, call } = require('./helpers.cjs')
const { runHook } = require('../../.claude/hooks/hook-utils.cjs')
const envGuard = require('../../.claude/hooks/env-guard.cjs')
const vaultGuard = require('../../.claude/hooks/vault-guard.cjs')

const FAIL_REASON = /^(env-guard|vault-guard) could not complete its check \((\w+)\); denying/

test('vault-guard denies when the ember-2 .env exists but cannot be read', (t) => {
  const fx = makeFixture({ env: { dir: true } }) // a directory named .env: EISDIR
  t.after(fx.cleanup)
  const r = runGuard('vault-guard', call('Read', { file_path: path.join(fx.project, 'src', 'main.js') }), fx)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.decision, 'deny')
  const m = r.reason.match(FAIL_REASON)
  assert.ok(m, r.reason)
  assert.equal(m[1], 'vault-guard')
  assert.ok(!r.reason.includes(fx.root), 'reason carries a path')
})

test('control: the same call with a readable .env is allowed', (t) => {
  const fx = makeFixture({ env: 'PRIVATE_VAULT_PATH=vaults/live\n', dirs: ['ember-2/vaults/live'] })
  t.after(fx.cleanup)
  const r = runGuard('vault-guard', call('Read', { file_path: path.join(fx.project, 'src', 'main.js') }), fx)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, '')
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
    const fx = makeFixture({ env: 'PRIVATE_VAULT_PATH=vaults/live\n', dirs: ['ember-2/vaults/live'] })
    t.after(fx.cleanup)
    for (const raw of NO_INPUT) {
      const r = runGuard(guard, raw, fx)
      assert.equal(r.status, 0, `${raw}: ${r.stderr}`)
      assert.equal(r.stdout, '', `${raw}: ${r.stdout}`)
    }
    // Control: a usable payload on the same channel is denied.
    const target = guard === 'env-guard' ? '.env' : path.join(fx.ember2, 'vaults', 'live', 'a.json')
    const r = runGuard(guard, JSON.stringify(call('Read', { file_path: target })), fx)
    assert.equal(r.decision, 'deny')
  })
}

test('an unparseable payload notes the error type on stderr, not the payload', () => {
  const r = runGuard('env-guard', 'C:/synthetic/.env {', null)
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /unparseable hook payload, allowing \(SyntaxError\)/)
  assert.ok(!r.stderr.includes('synthetic'))
})
