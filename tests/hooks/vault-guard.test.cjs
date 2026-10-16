// vault-guard.cjs: the name rule, the configured vault (relative, absolute,
// ~, through a junction or symlink, process environment), reach from an
// ancestor, and shell readers and listers. Run as a hook process against tmp
// fixtures; vault files hold synthetic text only.
//
// Every allow case (an absence) is paired with a deny control: the same
// tool against the vault in the same fixture, or the same call with the
// vault configured. The coverage tests fail if a tool loses either side.

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { makeFixture, runGuard, call } = require('./helpers.cjs')

const deny = (r) => {
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.decision, 'deny', `expected deny, got ${r.stdout || 'no decision'}`)
  return r
}
const allow = (r) => {
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, '', `expected allow, got ${r.reason}`)
  return r
}

// ---------------------------------------------------------------------------
// Name rule: no vault directory and no configuration needed.
// ---------------------------------------------------------------------------

test('name rule', async (t) => {
  const fx = makeFixture()
  t.after(fx.cleanup)
  const pv = path.join(fx.root, 'x', 'private_vault', 'a.json')
  const cases = [
    ['deny', 'Read', { file_path: pv }],
    ['deny', 'Read', { file_path: '/c/x/PRIVATE_VAULT/a.json' }],
    ['deny', 'Edit', { file_path: 'private_vault./a.json', old_string: 'a', new_string: 'b' }],
    ['deny', 'Write', { file_path: '../private_vault/new.json', content: 'x' }],
    ['deny', 'Grep', { pattern: 'x', path: 'C:private_vault' }],
    ['deny', 'Glob', { pattern: 'priv*/**' }],
    ['deny', 'Glob', { pattern: '*_vault/*.json' }],
    ['deny', 'Bash', { command: 'cat private_vault/a.json' }],
    ['deny', 'Bash', { command: 'grep --file=private_vault/a.json x' }],
    ['deny', 'PowerShell', { command: 'Get-ChildItem .\\private_vault' }],
    ['allow', 'Read', { file_path: path.join(fx.project, 'src', 'main.js') }],
    ['allow', 'Glob', { pattern: '**/*.js' }],
    ['allow', 'Bash', { command: 'echo private_vault' }],
    ['allow', 'Bash', { command: 'git commit -m "x' }], // unbalanced quote: no tokens
    ['allow', 'PowerShell', { command: 'Test-Path private_vault' }],
  ]
  for (const [want, tool, input] of cases) {
    await t.test(`${want} ${tool} ${JSON.stringify(input)}`, () => {
      const r = runGuard('vault-guard', call(tool, input), fx)
      if (want === 'deny') {
        deny(r)
        assert.match(r.reason, /Vault Privacy Rule/)
      } else allow(r)
    })
  }
})

// ---------------------------------------------------------------------------
// Configured vault, relative value: resolved against the ember-2 root.
// ---------------------------------------------------------------------------

const REL = makeFixture({ env: 'PRIVATE_VAULT_PATH=vaults/live\n', dirs: ['ember-2/vaults/live'] })
test.after(() => REL.cleanup())
const V = path.join(REL.ember2, 'vaults', 'live')
const VA = path.join(V, 'a.json')
const fwd = (p) => p.replace(/\\/g, '/')

const CONFIGURED = [
  ['deny', 'Read', { file_path: VA }],
  ['deny', 'Read', { file_path: fwd(VA) }],
  ['deny', 'Read', { file_path: '../ember-2/vaults/live/a.json' }], // against cwd = project
  ['deny', 'Read', { file_path: V }],
  ['deny', 'Edit', { file_path: VA, old_string: 'a', new_string: 'b' }],
  ['deny', 'Write', { file_path: path.join(V, 'new.json'), content: 'x' }],
  ['deny', 'Grep', { pattern: 'x', path: V }],
  ['deny', 'Grep', { pattern: 'x', path: REL.root }], // ancestor, no glob
  ['deny', 'Grep', { pattern: 'x', path: REL.root, glob: '*.json' }], // unanchored
  ['deny', 'Grep', { pattern: 'x', path: REL.root, glob: 'ember-2/**/*.json' }],
  ['deny', 'Glob', { pattern: '**/*.json', path: REL.root }],
  ['deny', 'Glob', { pattern: `${fwd(REL.ember2)}/*/live/*` }],
  ['deny', 'Glob', { pattern: '*', path: V }],
  ['deny', 'Bash', { command: `cat "${VA}"` }],
  ['deny', 'Bash', { command: `cat ${fwd(VA)}` }],
  ['deny', 'Bash', { command: `type "${VA}"` }],
  ['deny', 'Bash', { command: `Get-Content "${VA}"` }],
  ['deny', 'Bash', { command: `grep -f "${VA}" src` }],
  ['deny', 'Bash', { command: `grep --file="${VA}" src` }],
  ['deny', 'Bash', { command: `ls "${V}"` }],
  ['deny', 'Bash', { command: `dir "${V}"` }],
  ['deny', 'Bash', { command: `cd "${V}" && ls` }],
  ['deny', 'Bash', { command: `grep -r synthetic "${REL.root}"` }],
  ['deny', 'Bash', { command: `rg synthetic "${REL.ember2}"` }],
  ['deny', 'Bash', { command: `find "${REL.root}" -name "*.json"` }],
  ['deny', 'Bash', { command: `echo "${VA}" | xargs cat` }],
  ['deny', 'PowerShell', { command: `Get-ChildItem "${V}"` }],
  ['deny', 'PowerShell', { command: `Get-Content -Path:"${VA}"` }],
  ['deny', 'PowerShell', { command: `Get-ChildItem -Rec "${REL.root}"` }],
  ['allow', 'Read', { file_path: path.join(REL.ember2, 'README.md') }],
  ['allow', 'Edit', { file_path: path.join(REL.project, 'src', 'main.js'), old_string: 'a', new_string: 'b' }],
  ['allow', 'Write', { file_path: path.join(REL.ember2, 'vaults', 'new.json'), content: 'x' }],
  ['allow', 'Grep', { pattern: 'x' }], // rooted at the project, not an ancestor
  ['allow', 'Grep', { pattern: 'x', path: REL.root, glob: 'ember-2-installer/**/*.js' }],
  ['allow', 'Glob', { pattern: '**/*.js' }],
  ['allow', 'Glob', { pattern: 'ember-2-installer/**', path: REL.root }],
  ['allow', 'Bash', { command: `cat "${path.join(REL.ember2, 'README.md')}"` }],
  ['allow', 'Bash', { command: `ls "${REL.root}"` }], // non-recursive ancestor listing
  ['allow', 'Bash', { command: `test -d "${V}" && echo yes` }],
  ['allow', 'Bash', { command: 'grep -r synthetic src' }],
  ['allow', 'PowerShell', { command: `Test-Path "${V}"` }],
  ['allow', 'PowerShell', { command: 'Get-Content src\\main.js' }],
]

for (const [want, tool, input] of CONFIGURED) {
  test(`configured relative: ${want} ${tool} ${JSON.stringify(input)}`, () => {
    const r = runGuard('vault-guard', call(tool, input), REL)
    want === 'deny' ? deny(r) : allow(r)
  })
}

test('every guarded tool has configured deny and allow cases', () => {
  for (const tool of ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash', 'PowerShell']) {
    assert.ok(CONFIGURED.some(([w, t]) => w === 'deny' && t === tool), `no deny case for ${tool}`)
    assert.ok(CONFIGURED.some(([w, t]) => w === 'allow' && t === tool), `no allow case for ${tool}`)
  }
})

test('a relative path resolves against the payload cwd, not the hook process cwd', () => {
  deny(runGuard('vault-guard', call('Read', { file_path: 'vaults/live/a.json' }, { cwd: REL.ember2 }), REL))
  allow(runGuard('vault-guard', call('Read', { file_path: 'vaults/live/a.json' }, { cwd: REL.project }), REL))
})

test('a relative value resolves against the ember-2 root, not the installer', () => {
  // The same relative directory under the installer is not the vault.
  fs.mkdirSync(path.join(REL.project, 'vaults', 'live'), { recursive: true })
  allow(runGuard('vault-guard', call('Read', { file_path: path.join(REL.project, 'vaults', 'live', 'a.json') }), REL))
  deny(runGuard('vault-guard', call('Read', { file_path: VA }), REL))
})

test('cd earlier in the command line moves the base for later stages', () => {
  deny(runGuard('vault-guard', call('Bash', { command: `cd "${REL.ember2}"; cat vaults/live/a.json` }), REL))
  allow(runGuard('vault-guard', call('Bash', { command: `cd "${REL.project}"; cat vaults/live/a.json` }), REL))
})

// ---------------------------------------------------------------------------
// Other configured forms.
// ---------------------------------------------------------------------------

test('configured absolute value', (t) => {
  const fx = makeFixture({ dirs: ['abs-vault'] })
  t.after(fx.cleanup)
  const vault = path.join(fx.root, 'abs-vault')
  fs.writeFileSync(path.join(fx.ember2, '.env'), `# synthetic\nexport PRIVATE_VAULT_PATH="${fwd(vault)}" # comment\n`)
  deny(runGuard('vault-guard', call('Read', { file_path: path.join(vault, 'a.json') }), fx))
  deny(runGuard('vault-guard', call('Bash', { command: `Get-Content "${path.join(vault, 'a.json')}"` }), fx))
  allow(runGuard('vault-guard', call('Read', { file_path: path.join(fx.ember2, 'README.md') }), fx))
})

test('configured ~ value expands against the home directory', (t) => {
  const fx = makeFixture({ env: 'PRIVATE_VAULT_PATH=~/hv\n', dirs: ['home/hv'] })
  t.after(fx.cleanup)
  deny(runGuard('vault-guard', call('Read', { file_path: path.join(fx.home, 'hv', 'a.json') }), fx))
  deny(runGuard('vault-guard', call('Read', { file_path: '~/hv/a.json' }), fx))
  allow(runGuard('vault-guard', call('Read', { file_path: '~/other/a.json' }), fx))
})

test('process environment wins over the .env file', (t) => {
  const fx = makeFixture({ env: 'PRIVATE_VAULT_PATH=vaults/live\n', dirs: ['ember-2/vaults/live', 'env-vault'] })
  t.after(fx.cleanup)
  const fromEnv = path.join(fx.root, 'env-vault', 'a.json')
  const fromFile = path.join(fx.ember2, 'vaults', 'live', 'a.json')
  const extra = { PRIVATE_VAULT_PATH: path.join(fx.root, 'env-vault') }
  deny(runGuard('vault-guard', call('Read', { file_path: fromEnv }), fx, extra))
  allow(runGuard('vault-guard', call('Read', { file_path: fromFile }), fx, extra))
  deny(runGuard('vault-guard', call('Read', { file_path: fromFile }), fx))
})

test('a vault reached through a junction or symlink', (t) => {
  const fx = makeFixture({ env: 'PRIVATE_VAULT_PATH=vaults/live\n', dirs: ['ember-2/vaults/live'] })
  t.after(fx.cleanup)
  const link = path.join(fx.root, 'link')
  try {
    fs.symlinkSync(path.join(fx.ember2, 'vaults', 'live'), link, 'junction')
  } catch (err) {
    t.skip(`cannot create a junction or symlink here (${err.code})`)
    return
  }
  deny(runGuard('vault-guard', call('Read', { file_path: path.join(link, 'a.json') }), fx))
  deny(runGuard('vault-guard', call('Write', { file_path: path.join(link, 'new.json'), content: 'x' }), fx))
  deny(runGuard('vault-guard', call('Bash', { command: `cat "${path.join(link, 'a.json')}"` }), fx))
})

test('location rules are off without configuration or without the directory', (t) => {
  // Control for the absences: the same reads deny once the vault exists and is configured.
  const none = makeFixture({ dirs: ['ember-2/vaults/live'] })
  const missing = makeFixture({ env: 'PRIVATE_VAULT_PATH=vaults/gone\n', dirs: ['ember-2/vaults/live'] })
  t.after(() => { none.cleanup(); missing.cleanup() })
  for (const fx of [none, missing]) {
    const target = path.join(fx.ember2, 'vaults', 'live', 'a.json')
    allow(runGuard('vault-guard', call('Read', { file_path: target }), fx))
    allow(runGuard('vault-guard', call('Bash', { command: `cat "${target}"` }), fx))
  }
  fs.writeFileSync(path.join(none.ember2, '.env'), 'PRIVATE_VAULT_PATH=vaults/live\n')
  const target = path.join(none.ember2, 'vaults', 'live', 'a.json')
  deny(runGuard('vault-guard', call('Read', { file_path: target }), none))
  deny(runGuard('vault-guard', call('Bash', { command: `cat "${target}"` }), none))
})

test('an in-repo private_vault directory is guarded by location from inside it', (t) => {
  const fx = makeFixture({ dirs: ['ember-2-installer/private_vault'] })
  t.after(fx.cleanup)
  const inside = path.join(fx.project, 'private_vault')
  deny(runGuard('vault-guard', call('Bash', { command: 'ls' }, { cwd: inside }), fx))
  deny(runGuard('vault-guard', call('Read', { file_path: 'a.json' }, { cwd: inside }), fx))
  allow(runGuard('vault-guard', call('Bash', { command: 'ls' }, { cwd: fx.project }), fx))
})

// ---------------------------------------------------------------------------
// The configured value never appears in a deny the agent did not spell out.
// ---------------------------------------------------------------------------

const leaks = (text, fixture) =>
  [fixture.root, fwd(fixture.root), 'vaults/live', 'vaults\\live'].some((s) => text.includes(s))

test('deny reasons do not carry the configured vault path', () => {
  const calls = [
    call('Grep', { pattern: 'x', path: '..' }), // ancestor reach: target is '..'
    call('Glob', { pattern: '../**/*.json' }),
    call('Bash', { command: `grep -r synthetic ..` }),
    call('Bash', { command: 'cd ../ember-2 && cat vaults/live/a.json' }),
  ]
  for (const c of calls) {
    const r = deny(runGuard('vault-guard', c, REL))
    assert.ok(!leaks(r.stdout + r.stderr, REL), `leaked in ${r.stdout}`)
  }
})

test('leak check positive control: a reason quoting the path is caught', () => {
  const r = deny(runGuard('vault-guard', call('Read', { file_path: VA }), REL))
  assert.ok(leaks(r.reason, REL))
})
