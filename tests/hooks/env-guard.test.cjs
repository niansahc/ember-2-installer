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
const { fnmatch } = require('../../.claude/hooks/hook-utils.cjs')

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
  ['Bash', { command: "echo \\' ; cat .env" }],
  ['Bash', { command: "echo 'it'\\''s' ; cat .env" }],
  ['Bash', { command: 'cat .[!z-a]nv' }],
  ['PowerShell', { command: 'Get-Content .env' }],
  ['PowerShell', { command: "Get-Content '.e*'" }],
  ['PowerShell', { command: 'Get-ChildItem -Force .env.local' }],
  // -m is boolean on git log: the next word is not a message, so its
  // --flag="..." form is scanned. Only the message flag itself may carry its
  // name outside the quotes.
  ['Bash', { command: 'git log -m --output=".env"' }],
  ['Bash', { command: "git log -m --output='.env'" }],
  // A command after a message is still scanned (controls for the ALLOW rows below).
  ['Bash', { command: 'git commit -m "x; y" ; cat .env' }],
  ['PowerShell', { command: 'git commit -m "x; y" ; Get-Content .env' }],
  ['PowerShell', { command: "git commit -m @'\nok\n'@; Get-Content .env" }],
  // A message value with text outside its quotes, or a quote left open, is scanned.
  ['Bash', { command: 'git commit -m "x".env' }],
  ['Bash', { command: 'git commit -m "x .env' }],
  ['PowerShell', { command: "git commit -m @'\nx .env" }],
  // A here-string is prose only as a git/gh message.
  ['PowerShell', { command: "Write-Output @'\n.env\n'@" }],
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
  // A reversed range is empty: [z-a] matches nothing, [z-ae] matches e.
  ['Read', { file_path: '.[z-a]nv' }, { file_path: '.[z-ae]nv' }],
  ['Glob', { pattern: '.[z-a]nv' }, { pattern: '.[z-ae]nv' }],
  ['Bash', { command: 'cat .[z-a]nv' }, { command: 'cat .[z-ae]nv' }],
  ['Bash', { command: 'cat .env.example' }, { command: 'cat .env.example*' }],
  ['Bash', { command: "jq '.*' package.json" }, { command: 'jq . .*' }],
  ['Bash', { command: 'git commit -m "feat: block .env reads"' }, { command: 'git commit -m "$(cat .env)"' }],
  ['Bash', { command: "git commit -m 'keep .env out of $(transcripts)'" }, { command: 'git commit -m "keep $(cat .env) out"' }],
  ['Bash', { command: 'gh pr create --title "guard .env" --body "denies .env.local"' }, { command: 'gh pr create --title "guard .env" --body "$(cat .env.local)"' }],
  ['Bash', { command: 'ls .github' }, { command: 'ls .env' }],
  ['PowerShell', { command: 'Get-Content .env.example' }, { command: 'Get-Content .env' }],
  ['PowerShell', { command: 'Get-ChildItem src' }, { command: 'Get-ChildItem .env.local' }],
  // A ; & or | inside a quoted message is part of it. Control: a
  // substitution in the value.
  ['Bash', { command: 'git commit -m "fix: read .env; add test"' }, { command: 'git commit -m "$(cat .env)"' }],
  ['Bash', { command: "git commit -m 'fix: read .env; add test'" }, { command: 'git commit -m "$(cat .env)"' }],
  ['Bash', { command: 'git commit -m "a | b && c & .env"' }, { command: 'git commit -m "$(cat .env)"' }],
  ['Bash', { command: 'git commit --message="read .env; test"' }, { command: 'git commit --message="$(cat .env); test"' }],
  ['Bash', { command: 'git commit --message="read .env"' }, { command: 'git commit --message="$(cat .env)"' }],
  // The command is found past VAR=value (commandStart).
  ['Bash', { command: 'FOO=1 git commit -m "read .env"' }, { command: 'FOO=1 git commit -m "$(cat .env)"' }],
  // Past the nesting limit nothing is cut and all of the command is scanned.
  // Control: one level deeper.
  [
    'Bash',
    { command: `echo ${'$('.repeat(8)}echo x${')'.repeat(8)}; git commit -m "read .env"` },
    { command: `echo ${'$('.repeat(9)}echo x${')'.repeat(9)}; git commit -m "read .env"` },
  ],
  ['Bash', { command: 'gh pr create --title "x; y" --body "reads .env | not"' }, { command: 'gh pr create --title "x; y" --body "$(cat .env)"' }],
  ['PowerShell', { command: 'git commit -m "fix: read .env; add test"' }, { command: 'git commit -m "$(Get-Content .env)"' }],
  ['PowerShell', { command: "git commit -m 'fix: read .env; add test'" }, { command: 'git commit -m "$(Get-Content .env)"' }],
  // PowerShell here-strings. Control: @"..."@ running $(...).
  ['PowerShell', { command: "git commit -m @'\nmentions .env\n'@" }, { command: 'git commit -m @"\n$(Get-Content .env)\n"@' }],
  ['PowerShell', { command: 'git commit -m @"\nmentions .env\n"@' }, { command: 'git commit -m @"\n$(Get-Content .env)\n"@' }],
  ['PowerShell', { command: "git commit -m @'\nit's .env; a | b & c\n'@" }, { command: "git commit -m @\"\nit's $(Get-Content .env)\n\"@" }],
  ['PowerShell', { command: "git commit -m @'\r\nmentions .env\r\n'@" }, { command: 'git commit -m @"\r\n$(Get-Content .env)\r\n"@' }],
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
// Heredocs (Bash). A body is dropped only when it is literal text (quoted
// delimiter) for a known inert consumer: tee to a file, git commit -F -,
// gh --body-file -, or cat inside a git/gh message value. Each row:
// [command, expected result, control with the opposite result], the control
// differing only where it matters.
// ---------------------------------------------------------------------------

const HEREDOC = [
  // Literal body for an inert consumer: allowed. Control: delimiter unquoted.
  ["git commit -m \"$(cat <<'EOF'\nfeat: block .env reads\nEOF\n)\"", 'allow', 'git commit -m "$(cat <<EOF\nfeat: block .env reads\nEOF\n)"'],
  ['git commit -m "$(cat <<"EOF"\nfeat: block .env.local reads\nEOF\n)"', 'allow', 'git commit -m "$(cat <<EOF\nfeat: block .env.local reads\nEOF\n)"'],
  ["gh pr create --title t --body \"$(cat <<'EOF'\nDenies .env and .env.* reads.\nEOF\n)\"", 'allow', 'gh pr create --title t --body "$(cat <<EOF\nDenies .env and .env.* reads.\nEOF\n)"'],
  ["git commit -F - <<'EOF'\nfeat: block .env reads\nEOF", 'allow', 'git commit -F - <<EOF\nfeat: block .env reads\nEOF'],
  ['gh pr create --title t --body-file - <<\\EOF\nDenies .env reads.\nEOF', 'allow', 'gh pr create --title t --body-file - <<EOF\nDenies .env reads.\nEOF'],
  ["tee notes.txt <<-'EOF'\n\tsee .env\n\tEOF", 'allow', 'tee notes.txt <<-EOF\n\tsee .env\n\tEOF'],
  // The rest of the command is still scanned. Control: a read after the body.
  ["tee notes.txt <<'EOF'\n.env\nEOF", 'allow', "tee notes.txt <<'EOF'\n.env\nEOF\ncat .env"],
  // Any other receiver keeps the body scanned. Control: the same literal
  // body for an inert consumer.
  ["cat <<'EOF'\nsee .env\nEOF", 'deny', "tee notes.txt <<'EOF'\nsee .env\nEOF"],
  ["python3.12 <<'EOF'\nprint(open('.env').read())\nEOF", 'deny', "tee notes.py <<'EOF'\nprint(open('.env').read())\nEOF"],
  ["sqlite3 <<'EOF'\n.shell cat .env\nEOF", 'deny', "tee notes.sql <<'EOF'\n.shell cat .env\nEOF"],
  ["bash <<'EOF'\ncat .env\nEOF", 'deny', "tee notes.sh <<'EOF'\ncat .env\nEOF"],
  ["cat <<'EOF' | xargs cat\n.env\nEOF", 'deny', "tee notes.txt <<'EOF'\n.env\nEOF"],
  ["tee notes.sh <<'EOF' | bash\ncat .env\nEOF", 'deny', "tee notes.sh <<'EOF'\ncat .env\nEOF"],
  ["tee >(bash) <<'EOF'\ncat .env\nEOF", 'deny', "tee notes.sh <<'EOF'\ncat .env\nEOF"],
  ["cat $(cat <<'EOF'\n.env\nEOF\n)", 'deny', "git commit -m \"$(cat <<'EOF'\n.env\nEOF\n)\""],
  ["cat \"$(cat <<'EOF'\n.env\nEOF\n)\"", 'deny', "git commit -m \"$(cat <<'EOF'\n.env\nEOF\n)\""],
  ["cat $(tee notes.txt <<'EOF'\n.env\nEOF\n)", 'deny', "tee notes.txt <<'EOF'\n.env\nEOF"],
  ["eval \"$(cat <<'EOF'\ncat .env\nEOF\n)\"", 'deny', "git commit -m \"$(cat <<'EOF'\ncat .env\nEOF\n)\""],
  ["git commit -m \"$(cat <<'EOF' | sed s/a/b/\n.env\nEOF\n)\"", 'deny', "git commit -m \"$(cat <<'EOF'\n.env\nEOF\n)\""],
  // Unquoted delimiter: always scanned. Control: a body with no .env name.
  ['git commit -m "$(cat <<EOF\nmentions .env\nEOF\n)"', 'deny', 'git commit -m "$(cat <<EOF\nmentions nothing\nEOF\n)"'],
  ['git commit -F - <<EOF\n$(cat .env)\nEOF', 'deny', 'git commit -F - <<EOF\n$(cat README.md)\nEOF'],
  // Not a heredoc body. Control: the same lines as a real literal heredoc.
  ["tee notes.txt \"<<'EOF'\"\n.env\nEOF", 'deny', "tee notes.txt <<'EOF'\n.env\nEOF"], // << inside quotes
  ["tee notes.txt <<'EOF'\n.env", 'deny', "tee notes.txt <<'EOF'\n.env\nEOF"], // no terminator line
  ["git commit -m \"$(cat <<'EOF'\n.env\nEOF)\"", 'deny', "git commit -m \"$(cat <<'EOF'\n.env\nEOF\n)\""], // terminator not alone on its line
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
  const command = "tee notes.txt <<'EOF'\n.env\nEOF"
  deny(runGuard('env-guard', call('PowerShell', { command }), fx))
  allow(runGuard('env-guard', call('Bash', { command }), fx))
})

// fnmatch sets follow Python 3.9+: a reversed range is empty and dropped.
test('fnmatch drops reversed ranges from a set', () => {
  assert.equal(fnmatch('e', '[z-ae]'), true)
  assert.equal(fnmatch('e', '[!z-a]'), true) // negated and empty: any character
  assert.equal(fnmatch('e', '[z-a]'), false) // empty: nothing
  assert.equal(fnmatch('e', '[a-z]'), true)
  assert.equal(fnmatch('e', '[!a-z]'), false)
  assert.equal(fnmatch('-', '[a-]'), true)
})

test('every guarded tool has deny and allow cases', () => {
  const tools = ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash', 'PowerShell']
  for (const tool of tools) {
    assert.ok(DENY.some(([t]) => t === tool), `no deny case for ${tool}`)
    assert.ok(ALLOW.some(([t]) => t === tool), `no allow case for ${tool}`)
  }
  assert.ok(ALLOW.every((row) => row.length === 3 && row[2]), 'an allow row has no deny control')
})
