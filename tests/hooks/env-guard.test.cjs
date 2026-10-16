// env-guard.cjs: deny and allow cases for every guarded tool, run as a hook
// process. Every allow case (an absence: no decision printed) shares a tool
// with deny cases in the same table, and the coverage test below fails if a
// tool loses either side, so no allow assertion stands without a control.

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { makeFixture, runGuard, call } = require('./helpers.cjs')

const fx = makeFixture()
test.after(() => fx.cleanup())
const at = (...p) => path.join(fx.root, ...p)

const DENY = [
  ['Read', { file_path: at('.env') }],
  ['Read', { file_path: at('ember-2', '.env.local') }],
  ['Read', { file_path: '.ENV' }],
  ['Read', { file_path: '.env.' }],
  ['Read', { file_path: '.env::$DATA' }],
  ['Read', { file_path: '/c/dev/x/.env.production' }],
  ['Edit', { file_path: at('.env'), old_string: 'a', new_string: 'b' }],
  ['Write', { file_path: at('ember-2', '.env.test'), content: 'x' }],
  ['Grep', { pattern: 'KEY', path: at('.env') }],
  ['Grep', { pattern: 'KEY', glob: '*' }],
  ['Grep', { pattern: 'KEY', glob: '*.local' }],
  ['Grep', { pattern: 'KEY', glob: '.env*' }],
  ['Glob', { pattern: '**/.env*' }],
  ['Glob', { pattern: '.e*' }],
  ['Glob', { pattern: '.[e]nv' }],
  ['Glob', { pattern: '*', path: at('.env') }],
  ['Bash', { command: 'cat .env' }],
  ['Bash', { command: `cat "${at('ember-2', '.env')}"` }],
  ['Bash', { command: 'type .env' }],
  ['Bash', { command: 'Get-Content .env.local' }],
  ['Bash', { command: 'grep -h KEY .env.production' }],
  ['Bash', { command: 'grep --file=.env KEY src' }],
  ['Bash', { command: "find . -name '.env*'" }],
  ['Bash', { command: 'ls -la .e*' }],
  ['Bash', { command: 'bash -c "cat .*"' }],
  ['Bash', { command: 'git commit -m "x" && cat .env' }],
  ['PowerShell', { command: 'Get-Content .env' }],
  ['PowerShell', { command: "Get-Content '.e*'" }],
  ['PowerShell', { command: 'Get-ChildItem -Force .env.local' }],
]

const ALLOW = [
  ['Read', { file_path: at('.env.example') }],
  ['Read', { file_path: at('ember-2-installer', 'src', 'main.js') }],
  ['Edit', { file_path: at('.env.example'), old_string: 'a', new_string: 'b' }],
  ['Write', { file_path: at('README.md'), content: 'x' }],
  ['Grep', { pattern: '\\.env', path: 'src' }],
  ['Grep', { pattern: 'KEY', glob: '*.js' }],
  ['Grep', { pattern: 'KEY', glob: '!*.py' }],
  ['Grep', { pattern: 'KEY', glob: '.env.example' }],
  ['Glob', { pattern: '**/*.js' }],
  ['Glob', { pattern: '.git*' }],
  ['Glob', { pattern: '.env.example' }],
  ['Bash', { command: 'cat .env.example' }],
  ['Bash', { command: "jq '.*' package.json" }],
  ['Bash', { command: 'git commit -m "feat: block .env reads"' }],
  ['Bash', { command: 'gh pr create --title "guard .env" --body "denies .env.local"' }],
  ['Bash', { command: 'ls .github' }],
  ['PowerShell', { command: 'Get-Content .env.example' }],
  ['PowerShell', { command: 'Get-ChildItem src' }],
]

for (const [tool, input] of DENY) {
  test(`deny ${tool} ${JSON.stringify(input)}`, () => {
    const r = runGuard('env-guard', call(tool, input), fx)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.decision, 'deny')
    assert.match(r.reason, /\.env files may not be read/)
  })
}

for (const [tool, input] of ALLOW) {
  test(`allow ${tool} ${JSON.stringify(input)}`, () => {
    const r = runGuard('env-guard', call(tool, input), fx)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, '')
  })
}

test('every guarded tool has deny and allow cases', () => {
  const tools = ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash', 'PowerShell']
  for (const tool of tools) {
    assert.ok(DENY.some(([t]) => t === tool), `no deny case for ${tool}`)
    assert.ok(ALLOW.some(([t]) => t === tool), `no allow case for ${tool}`)
  }
})

test('.env.example is allowed where .env is denied (paired control)', () => {
  for (const tool of ['Read', 'Edit', 'Write']) {
    assert.equal(runGuard('env-guard', call(tool, { file_path: at('.env.example') }), fx).stdout, '')
    assert.equal(runGuard('env-guard', call(tool, { file_path: at('.env') }), fx).decision, 'deny')
  }
})
