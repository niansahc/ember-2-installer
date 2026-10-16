// env-guard.cjs: deny and allow cases for every guarded tool, run as a hook
// process.
//
// Every allow row carries its own deny control: the same tool with the
// smallest change that makes the call reach a .env file (a substitution
// in the prose value, a glob that widens past .env.example, ...). Each
// test asserts both, so an allow assertion cannot pass because the guard
// stopped looking.

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { makeFixture, runGuard, call, deny, allow } = require('./helpers.cjs')

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
  ['Read', { file_path: at('.env.example.local') }],
  ['Edit', { file_path: at('.env'), old_string: 'a', new_string: 'b' }],
  ['Write', { file_path: at('ember-2', '.env.test'), content: 'x' }],
  ['Grep', { pattern: 'KEY', path: at('.env') }],
  ['Grep', { pattern: 'KEY', glob: '*' }],
  ['Grep', { pattern: 'KEY', glob: '*.local' }],
  ['Grep', { pattern: 'KEY', glob: '.env*' }],
  ['Glob', { pattern: '**/.env*' }],
  ['Glob', { pattern: '.e*' }],
  ['Glob', { pattern: '.[e]nv' }],
  ['Glob', { pattern: '.env.example*' }],
  ['Glob', { pattern: '*', path: at('.env') }],
  ['Bash', { command: 'cat .env' }],
  ['Bash', { command: `cat "${at('ember-2', '.env')}"` }],
  ['Bash', { command: 'type .env' }],
  ['Bash', { command: 'Get-Content .env.local' }],
  ['Bash', { command: 'grep -h KEY .env.production' }],
  ['Bash', { command: 'grep --file=.env KEY src' }],
  ['Bash', { command: "find . -name '.env*'" }],
  ['Bash', { command: 'ls -la .e*' }],
  ['Bash', { command: 'cat .env.example*' }],
  ['Bash', { command: 'bash -c "cat .*"' }],
  ['Bash', { command: 'git commit -m "x" && cat .env' }],
  ['Bash', { command: 'gh pr create --body "$(cat .env)"' }],
  ['Bash', { command: 'git commit -m "$(cat .env)"' }],
  ['Bash', { command: 'git commit -m "`cat .env`"' }],
  ['Bash', { command: 'git commit --message="$(cat .env.local)"' }],
  ['PowerShell', { command: 'Get-Content .env' }],
  ['PowerShell', { command: "Get-Content '.e*'" }],
  ['PowerShell', { command: 'Get-ChildItem -Force .env.local' }],
]

// [tool, allowed input, deny control]
const ALLOW = [
  ['Read', { file_path: at('.env.example') }, { file_path: at('.env') }],
  ['Read', { file_path: at('ember-2-installer', 'src', 'main.js') }, { file_path: at('ember-2-installer', '.env') }],
  ['Edit', { file_path: at('.env.example'), old_string: 'a', new_string: 'b' }, { file_path: at('.env.local'), old_string: 'a', new_string: 'b' }],
  ['Write', { file_path: at('README.md'), content: 'x' }, { file_path: at('.env'), content: 'x' }],
  ['Grep', { pattern: '\\.env', path: 'src' }, { pattern: '\\.env', path: '.env' }],
  ['Grep', { pattern: 'KEY', glob: '*.js' }, { pattern: 'KEY', glob: '*.local' }],
  ['Grep', { pattern: 'KEY', glob: '!*.py' }, { pattern: 'KEY', glob: '*' }],
  ['Grep', { pattern: 'KEY', glob: '.env.example' }, { pattern: 'KEY', glob: '.env.example*' }],
  ['Glob', { pattern: '**/*.js' }, { pattern: '**/.env*' }],
  ['Glob', { pattern: '.git*' }, { pattern: '.e*' }],
  ['Glob', { pattern: '.env.example' }, { pattern: '.env.example*' }],
  ['Bash', { command: 'cat .env.example' }, { command: 'cat .env.example*' }],
  ['Bash', { command: "jq '.*' package.json" }, { command: 'jq . .*' }],
  ['Bash', { command: 'git commit -m "feat: block .env reads"' }, { command: 'git commit -m "$(cat .env)"' }],
  ['Bash', { command: "git commit -m 'keep .env out of $(transcripts)'" }, { command: 'git commit -m "keep $(cat .env) out"' }],
  ['Bash', { command: 'gh pr create --title "guard .env" --body "denies .env.local"' }, { command: 'gh pr create --title "guard .env" --body "$(cat .env.local)"' }],
  ['Bash', { command: 'ls .github' }, { command: 'ls .env' }],
  ['PowerShell', { command: 'Get-Content .env.example' }, { command: 'Get-Content .env' }],
  ['PowerShell', { command: 'Get-ChildItem src' }, { command: 'Get-ChildItem .env.local' }],
]

for (const [tool, input] of DENY) {
  test(`deny ${tool} ${JSON.stringify(input)}`, () => {
    const r = deny(runGuard('env-guard', call(tool, input), fx))
    assert.match(r.reason, /\.env files may not be read/)
  })
}

for (const [tool, input, control] of ALLOW) {
  test(`allow ${tool} ${JSON.stringify(input)} (control ${JSON.stringify(control)})`, () => {
    allow(runGuard('env-guard', call(tool, input), fx))
    deny(runGuard('env-guard', call(tool, control), fx))
  })
}

// ---------------------------------------------------------------------------
// Heredocs (Bash). A quoted-delimiter body is literal text and is not
// scanned; an unquoted one is. Each row: [command, expected result, control
// with the opposite result], the control differing only where it matters.
// ---------------------------------------------------------------------------

const HEREDOC = [
  // Quoted delimiter: allowed. Control: the same body, delimiter unquoted.
  ["git commit -m \"$(cat <<'EOF'\nfeat: block .env reads\nEOF\n)\"", 'allow', 'git commit -m "$(cat <<EOF\nfeat: block .env reads\nEOF\n)"'],
  ['git commit -m "$(cat <<"EOF"\nfeat: block .env.local reads\nEOF\n)"', 'allow', 'git commit -m "$(cat <<EOF\nfeat: block .env.local reads\nEOF\n)"'],
  ["gh pr create --title t --body \"$(cat <<'EOF'\nDenies .env and .env.* reads.\nEOF\n)\"", 'allow', 'gh pr create --title t --body "$(cat <<EOF\nDenies .env and .env.* reads.\nEOF\n)"'],
  ['cat <<\\EOF\nsee .env.local\nEOF', 'allow', 'cat <<EOF\nsee .env.local\nEOF'],
  ["cat <<-'EOF'\n\tsee .env\n\tEOF", 'allow', 'cat <<-EOF\n\tsee .env\n\tEOF'],
  // The rest of the command is still scanned. Control: a read after the body.
  ["cat <<'EOF' > notes.txt\n.env\nEOF", 'allow', "cat <<'EOF' > notes.txt\n.env\nEOF\ncat .env"],
  // Unquoted delimiter: scanned, denied. Control: a body with no .env name.
  ['cat <<EOF\nmentions .env\nEOF', 'deny', 'cat <<EOF\nmentions nothing\nEOF'],
  ['git commit -m "$(cat <<EOF\n$(cat .env)\nEOF\n)"', 'deny', 'git commit -m "$(cat <<EOF\n$(cat README.md)\nEOF\n)"'],
  // A body the command runs stays scanned. Control: the body fed to cat.
  ["bash <<'EOF'\ncat .env\nEOF", 'deny', "cat <<'EOF'\ncat .env\nEOF"],
  ["cat <<'EOF' | xargs cat\n.env\nEOF", 'deny', "cat <<'EOF' | sort\n.env\nEOF"],
  ["eval \"$(cat <<'EOF'\ncat .env\nEOF\n)\"", 'deny', "echo \"$(cat <<'EOF'\ncat .env\nEOF\n)\""],
  ["while read f; do head \"$f\"; done <<'EOF'\n.env\nEOF", 'deny', "while true; do break; done <<'EOF'\n.env\nEOF"],
  ["python3 <<'EOF'\nprint(open('.env').read())\nEOF", 'deny', "cat <<'EOF'\nprint(open('.env').read())\nEOF"],
  // Not a heredoc body. Control: the same lines as a real quoted heredoc.
  ["printf '%s' \"<<'EOF'\"\n.env\nEOF", 'deny', "printf '%s' <<'EOF'\n.env\nEOF"], // << inside quotes
  ["cat <<'EOF'\n.env", 'deny', "cat <<'EOF'\n.env\nEOF"], // no terminator line
  ["echo \"$(cat <<'EOF'\n.env\nEOF)\"", 'deny', "echo \"$(cat <<'EOF'\n.env\nEOF\n)\""], // terminator not alone on its line
]

for (const [command, expected, control] of HEREDOC) {
  test(`heredoc ${expected} ${JSON.stringify(command)} (control ${JSON.stringify(control)})`, () => {
    const [first, second] = expected === 'allow' ? [allow, deny] : [deny, allow]
    first(runGuard('env-guard', call('Bash', { command }), fx))
    second(runGuard('env-guard', call('Bash', { command: control }), fx))
  })
}

// PowerShell has no heredocs: the same text is scanned there.
test('heredoc text in a PowerShell command is scanned (control: Bash allows it)', () => {
  const command = "cat <<'EOF'\n.env\nEOF"
  deny(runGuard('env-guard', call('PowerShell', { command }), fx))
  allow(runGuard('env-guard', call('Bash', { command }), fx))
})

test('every guarded tool has deny and allow cases', () => {
  const tools = ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash', 'PowerShell']
  for (const tool of tools) {
    assert.ok(DENY.some(([t]) => t === tool), `no deny case for ${tool}`)
    assert.ok(ALLOW.some(([t]) => t === tool), `no allow case for ${tool}`)
  }
  assert.ok(ALLOW.every((row) => row.length === 3 && row[2]), 'an allow row has no deny control')
})
