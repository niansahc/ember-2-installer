// vault-guard.cjs: the name rule, the configured vault (relative, absolute,
// ~, interpolated, through a junction or symlink, process environment),
// reach from an ancestor, and shell readers and listers. Run as a hook
// process against tmp fixtures; vault files hold synthetic text only.
// Wrappers, substitution, flag values and the shell name rule are in
// vault-shell.test.cjs.
//
// Every allow row carries its own deny control (the same tool, pointed at
// the vault, in the same fixture), and every other allow assertion sits in a
// test that also makes the deny happen. A table row without a control fails
// the coverage test.

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { makeFixture, liveVaultFixture, runGuard, call, deny, allow } = require('./helpers.cjs')

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
    ['allow', 'Read', { file_path: path.join(fx.project, 'src', 'main.js') }, { file_path: pv }],
    ['allow', 'Glob', { pattern: '**/*.js' }, { pattern: 'priv*/**' }],
    ['allow', 'Bash', { command: 'echo private_vault' }, { command: 'cat private_vault/a.json' }],
    ['allow', 'Bash', { command: 'echo hi > out.txt' }, { command: 'echo hi > private_vault/a.json' }],
    // Unbalanced quote: the rest of the line is one quoted word, still checked.
    ['allow', 'Bash', { command: 'git commit -m "x' }, { command: 'git commit -m "x" && cat private_vault/a.json' }],
    ['deny', 'Bash', { command: 'cat "private_vault/a.json' }],
    ['allow', 'Bash', { command: 'git commit -m "guard private_vault reads"' }, { command: 'git show HEAD:private_vault/a.json' }],
    ['allow', 'PowerShell', { command: 'Test-Path private_vault' }, { command: 'Get-Content private_vault/a.json' }],
  ]
  for (const [want, tool, input, control] of cases) {
    await t.test(`${want} ${tool} ${JSON.stringify(input)}`, () => {
      const r = runGuard('vault-guard', call(tool, input), fx)
      if (want === 'deny') {
        deny(r)
        assert.match(r.reason, /Vault Privacy Rule/)
      } else {
        allow(r)
        deny(runGuard('vault-guard', call(tool, control), fx))
      }
    })
  }
  assert.ok(cases.every(([w, , , c]) => w === 'deny' || c), 'an allow row has no deny control')
})

// ---------------------------------------------------------------------------
// Configured vault, relative value: resolved against the ember-2 root.
// ---------------------------------------------------------------------------

const REL = liveVaultFixture()
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
  // [allow, tool, allowed input, deny control]
  ['allow', 'Read', { file_path: path.join(REL.ember2, 'README.md') }, { file_path: VA }],
  ['allow', 'Edit', { file_path: path.join(REL.project, 'src', 'main.js'), old_string: 'a', new_string: 'b' }, { file_path: VA, old_string: 'a', new_string: 'b' }],
  ['allow', 'Write', { file_path: path.join(REL.ember2, 'vaults', 'new.json'), content: 'x' }, { file_path: path.join(V, 'new.json'), content: 'x' }],
  ['allow', 'Grep', { pattern: 'x' }, { pattern: 'x', path: REL.root }], // project root is not an ancestor
  ['allow', 'Grep', { pattern: 'x', path: REL.root, glob: 'ember-2-installer/**/*.js' }, { pattern: 'x', path: REL.root, glob: 'ember-2/**/*.json' }],
  ['allow', 'Glob', { pattern: '**/*.js' }, { pattern: '**/*.json', path: REL.root }],
  ['allow', 'Glob', { pattern: 'ember-2-installer/**', path: REL.root }, { pattern: 'ember-2/**', path: REL.root }],
  ['allow', 'Bash', { command: `cat "${path.join(REL.ember2, 'README.md')}"` }, { command: `cat "${VA}"` }],
  ['allow', 'Bash', { command: `ls "${REL.root}"` }, { command: `ls -R "${REL.root}"` }], // non-recursive ancestor listing
  ['allow', 'Bash', { command: `test -d "${V}" && echo yes` }, { command: `test -d "${V}" && cat "${VA}"` }],
  ['allow', 'Bash', { command: 'grep -r synthetic src' }, { command: `grep -r synthetic "${REL.root}"` }],
  ['allow', 'PowerShell', { command: `Test-Path "${V}"` }, { command: `Get-ChildItem "${V}"` }],
  ['allow', 'PowerShell', { command: 'Get-Content src\\main.js' }, { command: `Get-Content "${VA}"` }],
]

for (const [want, tool, input, control] of CONFIGURED) {
  test(`configured relative: ${want} ${tool} ${JSON.stringify(input)}`, () => {
    const r = runGuard('vault-guard', call(tool, input), REL)
    if (want === 'deny') return void deny(r)
    allow(r)
    deny(runGuard('vault-guard', call(tool, control), REL))
  })
}

test('every guarded tool has configured deny and allow cases, each allow with a control', () => {
  for (const tool of ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash', 'PowerShell']) {
    assert.ok(CONFIGURED.some(([w, t]) => w === 'deny' && t === tool), `no deny case for ${tool}`)
    assert.ok(CONFIGURED.some(([w, t]) => w === 'allow' && t === tool), `no allow case for ${tool}`)
  }
  assert.ok(CONFIGURED.every(([w, , , c]) => w === 'deny' || c), 'an allow row has no deny control')
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

// python-dotenv interpolation as ember-2's load_dotenv(env_file) does it
// (override=False): ${VAR} and ${VAR:-default}, the process environment
// first, then earlier keys. Each case denies the vault file the
// interpolated value names and allows a file beside it.
const INTERPOLATED = [
  ['earlier key', (fx) => `ROOT=${fwd(fx.ember2)}\nPRIVATE_VAULT_PATH=\${ROOT}/vaults/live\n`, {}],
  ['default for an unset name', (fx) => `PRIVATE_VAULT_PATH=\${GUARD_TEST_UNSET:-${fwd(fx.ember2)}}/vaults/live\n`, {}],
  ['process environment', () => 'PRIVATE_VAULT_PATH="${GUARD_TEST_ROOT}/vaults/live"\n', (fx) => ({ GUARD_TEST_ROOT: fx.ember2 })],
  ['single-quoted value (python-dotenv interpolates it too)', (fx) => `ROOT=${fwd(fx.ember2)}\nPRIVATE_VAULT_PATH='\${ROOT}/vaults/live'\n`, {}],
  ['relative after interpolation', () => 'SUB=vaults\nPRIVATE_VAULT_PATH=${SUB}/live\n', {}],
]

for (const [name, envText, extraEnv] of INTERPOLATED) {
  test(`interpolated configured value: ${name}`, (t) => {
    const fx = makeFixture({ dirs: ['ember-2/vaults/live'] })
    t.after(fx.cleanup)
    fs.writeFileSync(path.join(fx.ember2, '.env'), envText(fx))
    const extra = typeof extraEnv === 'function' ? extraEnv(fx) : extraEnv
    deny(runGuard('vault-guard', call('Read', { file_path: path.join(fx.ember2, 'vaults', 'live', 'a.json') }), fx, extra))
    allow(runGuard('vault-guard', call('Read', { file_path: path.join(fx.ember2, 'README.md') }), fx, extra))
  })
}

// The two values differ: the .env says <ember-2>, the process says <home>.
// ember-2 resolves to <home>/vaults/live, so that is the vault.
test('interpolation: the process environment wins over an earlier key', (t) => {
  const fx = makeFixture({ dirs: ['ember-2/vaults/live', 'home/vaults/live'] })
  t.after(fx.cleanup)
  fs.writeFileSync(path.join(fx.ember2, '.env'), `GUARD_TEST_ROOT=${fwd(fx.ember2)}\nPRIVATE_VAULT_PATH=\${GUARD_TEST_ROOT}/vaults/live\n`)
  const fromEnv = path.join(fx.home, 'vaults', 'live', 'a.json')
  const fromFile = path.join(fx.ember2, 'vaults', 'live', 'a.json')
  const extra = { GUARD_TEST_ROOT: fx.home }
  deny(runGuard('vault-guard', call('Read', { file_path: fromEnv }), fx, extra))
  allow(runGuard('vault-guard', call('Read', { file_path: fromFile }), fx, extra))
  // Control: without the process value, the earlier key names the vault.
  deny(runGuard('vault-guard', call('Read', { file_path: fromFile }), fx))
  allow(runGuard('vault-guard', call('Read', { file_path: fromEnv }), fx))
})

test('a junction alias configured beside the vault it points to keeps its own spelling', (t) => {
  const fx = makeFixture({ env: 'PRIVATE_VAULT_PATH=alias\n', dirs: ['ember-2/private_vault'] })
  t.after(fx.cleanup)
  try {
    fs.symlinkSync(path.join(fx.ember2, 'private_vault'), path.join(fx.ember2, 'alias'), 'junction')
  } catch (err) {
    t.skip(`cannot create a junction or symlink here (${err.code})`)
    return
  }
  // A wildcard path gets no realpath, so only the alias spelling matches it.
  deny(runGuard('vault-guard', call('Bash', { command: 'cat ../ember-2/alias/*.json' }), fx))
  deny(runGuard('vault-guard', call('Bash', { command: 'cat ../ember-2/al*/a.json' }), fx))
  deny(runGuard('vault-guard', call('Glob', { pattern: '../ember-2/alias/*' }), fx))
  deny(runGuard('vault-guard', call('Glob', { pattern: '../ember-2/al*/*' }), fx))
  allow(runGuard('vault-guard', call('Bash', { command: 'cat ../ember-2/*.md' }), fx))
  allow(runGuard('vault-guard', call('Glob', { pattern: '../ember-2/*.md' }), fx))
})

test('search advice appears only in Grep and Glob deny reasons', () => {
  const read = deny(runGuard('vault-guard', call('Read', { file_path: VA }), REL))
  const grep = deny(runGuard('vault-guard', call('Grep', { pattern: 'x', path: V }), REL))
  assert.doesNotMatch(read.reason, /If this is a search/)
  assert.match(grep.reason, /If this is a search/)
})

test('a vault reached through a junction or symlink', (t) => {
  const fx = liveVaultFixture()
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
