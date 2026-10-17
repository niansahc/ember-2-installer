// vault-guard.cjs, shell tools: readers behind wrappers, nested shells and
// substitution, quotes and escapes, the words a substitution prints,
// heredocs, the values of value-taking flags, the shell form of the name
// rule, and the nesting limit. Run as a hook process against tmp fixtures;
// vault files hold synthetic text only.
//
// Every row is a pair: a command that reaches the vault (deny) and the same
// command pointed at a file or directory beside it, or with the one change
// that matters (allow), so each allow assertion has its own control and each
// deny shows the guard is not simply denying the command form.

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { makeFixture, liveVaultFixture, runGuard, call, deny, allow } = require('./helpers.cjs')

const FX = liveVaultFixture()
test.after(() => FX.cleanup())
const ROOT = { cwd: FX.root } // an ancestor of <root>/ember-2/vaults/live
const PROJECT = { cwd: FX.project } // not an ancestor

const VAULT_FILE = 'ember-2/vaults/live/a.json'
const OTHER_FILE = 'ember-2/README.md'

/** Deny with `%` as the vault file, allow with `%` as a file beside it. */
function pairAtRoot(tool, form) {
  deny(runGuard('vault-guard', call(tool, { command: form.replaceAll('%', VAULT_FILE) }, ROOT), FX))
  allow(runGuard('vault-guard', call(tool, { command: form.replaceAll('%', OTHER_FILE) }, ROOT), FX))
}

// ---------------------------------------------------------------------------
// Readers behind wrappers, keywords, groups, nested shells and substitution.
// `%` is the file: the vault file for the deny, a file beside it for the
// allow.
// ---------------------------------------------------------------------------

const WRAPPED = [
  ['Bash', 'echo $(cat %)'],
  ['Bash', 'x=$(cat %)'],
  ['Bash', 'echo "$(cat %)"'],
  ['Bash', 'echo `cat %`'],
  ['Bash', 'echo $(echo $(cat %))'],
  ['Bash', 'diff <(cat %) x'],
  ['Bash', 'if true; then cat %; fi'],
  ['Bash', 'for i in 1; do cat %; done'],
  ['Bash', '{ cat %; }'],
  ['Bash', '(cat %)'],
  ['Bash', '! cat %'],
  ['Bash', 'FOO=1 cat %'],
  ['Bash', 'time cat %'],
  ['Bash', 'sudo cat %'],
  ['Bash', 'sudo -u root cat %'],
  ['Bash', 'env cat %'],
  ['Bash', 'env A=1 B=2 cat %'],
  ['Bash', 'nice -n 5 cat %'],
  ['Bash', 'nohup cat %'],
  ['Bash', '< % cat'],
  ['Bash', 'cat < %'],
  ['Bash', 'bash -c "cat %"'],
  ['Bash', "sh -c 'cat %'"],
  ['Bash', 'bash -lc "head -n 1 %"'],
  ['Bash', 'fish -c "cat %"'],
  ['Bash', 'csh -c "cat %"'],
  ['Bash', 'wsl cat %'],
  ['Bash', 'wsl -e cat %'],
  ['Bash', 'wsl -- cat %'],
  ['Bash', 'wsl -d Ubuntu --cd . cat %'],
  ['Bash', 'eval "cat %"'],
  ['Bash', 'pwsh -Command "Get-Content %"'],
  ['Bash', 'powershell -c "gc %"'],
  ['Bash', 'cmd /c type %'],
  ['PowerShell', 'echo (gc %)'],
  ['PowerShell', 'Write-Output $(Get-Content %)'],
  ['PowerShell', '1 | ForEach-Object { Get-Content % }'],
  ['PowerShell', 'pwsh -Command "Get-Content %"'],
  ['PowerShell', 'wsl cat %'],
  // Option words between -c and the command line, for every POSIX shell; a
  // lone -- or - ends them, and -o/-O take a value.
  ...['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh'].flatMap((sh) => [
    ['Bash', `${sh} -c -- 'cat %'`],
    ['Bash', `${sh} -c -x 'cat %'`],
  ]),
  ['Bash', "bash -c +x 'cat %'"],
  ['Bash', "bash -c -x -- 'cat %'"],
  ['Bash', "bash -c - 'cat %'"],
  ['Bash', "bash -xc -- 'cat %'"],
  ['Bash', "bash -c -o errexit 'cat %'"],
  ['Bash', "bash -c -eo pipefail 'cat %'"],
  ['Bash', "bash -co errexit 'cat %'"],
  ['Bash', "bash -c -O extglob -- 'cat %'"],
  ['PowerShell', "bash -c -- 'cat %'"],
]

for (const [tool, form] of WRAPPED) {
  test(`${tool} wrapped reader: ${form}`, () => pairAtRoot(tool, form))
}

// The name rule runs before the reader check, so an unknown wrapper in front
// of a private_vault path is caught too.
test('name rule catches an unknown wrapper in front of a private_vault path', (t) => {
  const fx = makeFixture()
  t.after(fx.cleanup)
  deny(runGuard('vault-guard', call('Bash', { command: 'stdbuf -o0 cat private_vault/a.json' }), fx))
  deny(runGuard('vault-guard', call('Bash', { command: 'bash -c "cat private_vault/a.json"' }), fx))
  allow(runGuard('vault-guard', call('Bash', { command: 'stdbuf -o0 cat src/main.js' }), fx))
})

// A PowerShell here-string closes only at '@ or "@ starting a line: a quote
// inside the body does not end it, so the command after it is still a command.
const HERE_STRINGS = [
  "Write-Output @'\nit's\n'@; Get-Content %",
  "Write-Output @'\nit's\n'@\nGet-Content %",
  'Write-Output @"\nsay "hi"\n"@; Get-Content %',
  'Write-Output @"\n$(Get-Content %)\n"@', // @"..."@ still runs $(...)
]

for (const form of HERE_STRINGS) {
  test(`PowerShell here-string: ${JSON.stringify(form)}`, () => pairAtRoot('PowerShell', form))
}

// ---------------------------------------------------------------------------
// Quotes and escapes: outside single quotes \x is a literal x, so an
// escaped quote opens nothing and the rest of the line is still parsed.
// ---------------------------------------------------------------------------

const ESCAPED = [
  "echo \\' $(cat %)",
  "echo \\' ; cat %",
  'echo \\" ; cat %',
  "echo it\\'s; cat %",
  "echo 'it'\\''s' ; cat %",
  'echo "say \\"hi\\"" ; cat %',
  "echo 'a\\' ; cat %", // a backslash inside single quotes is literal: the quote closes
]

for (const form of ESCAPED) {
  test(`escaped quote: ${form}`, () => pairAtRoot('Bash', form))
}

test('escapes: the plain form is denied too, and the name rule sees past an escaped quote', (t) => {
  deny(runGuard('vault-guard', call('Bash', { command: `echo "it's" ; cat ${VAULT_FILE}` }, ROOT), FX))
  const fx = makeFixture()
  t.after(fx.cleanup)
  deny(runGuard('vault-guard', call('Bash', { command: "echo 'it'\\''s' ; cat private_vault/a.json" }), fx))
  allow(runGuard('vault-guard', call('Bash', { command: "echo 'it'\\''s' ; cat src/main.js" }), fx))
})

// Bash runs nothing after an unclosed quote (syntax error), but the text is
// still one word of the command and is checked as one.
test('a quote left open makes one word to the end of the command, still checked', (t) => {
  const fx = makeFixture()
  t.after(fx.cleanup)
  deny(runGuard('vault-guard', call('Bash', { command: "cat 'private_vault/a.json" }), fx))
  allow(runGuard('vault-guard', call('Bash', { command: "cat 'src/main.js" }), fx))
})

// ---------------------------------------------------------------------------
// Substitution output: the words a substitution prints are operands of the
// word it sits in.
// ---------------------------------------------------------------------------

// `@` is the file here (printf's `%s` needs the `%`).
const PRINTED = [
  'cat $(echo @)',
  'cat $(printf %s @)',
  'cat "$(echo @)"',
  'cat `echo @`',
  'head -n 1 $(echo $(echo @))',
  'cat $(cat <<EOF\n@\nEOF\n)',
  "cat $(cat <<'EOF'\n@\nEOF\n)",
  'cat < $(echo @)',
]

for (const form of PRINTED) {
  test(`substitution output as operands: ${JSON.stringify(form)}`, () => {
    deny(runGuard('vault-guard', call('Bash', { command: form.replaceAll('@', VAULT_FILE) }, ROOT), FX))
    allow(runGuard('vault-guard', call('Bash', { command: form.replaceAll('@', OTHER_FILE) }, ROOT), FX))
  })
}

test('substitution output names the vault: name rule', (t) => {
  const fx = makeFixture()
  t.after(fx.cleanup)
  deny(runGuard('vault-guard', call('Bash', { command: 'cat $(echo private_vault/a.json)' }), fx))
  deny(runGuard('vault-guard', call('Bash', { command: 'git show $(echo HEAD:private_vault/a.json)' }), fx))
  allow(runGuard('vault-guard', call('Bash', { command: 'cat $(echo src/main.js)' }), fx))
  // A git/gh message value is prose, substitution or not.
  allow(runGuard('vault-guard', call('Bash', { command: 'git commit -m "$(echo private_vault/a.json)"' }), fx))
})

// ---------------------------------------------------------------------------
// Heredocs (Bash). A body is skipped only when it is literal text (quoted
// delimiter) for a known inert consumer: tee to a file, git commit -F -,
// gh --body-file -, or cat inside a git/gh message value. Each row:
// [command, expected result, control with the opposite result].
// ---------------------------------------------------------------------------

const HEREDOC = [
  // Literal body for an inert consumer: allowed. Control: delimiter unquoted.
  ["git commit -m \"$(cat <<'EOF'\nfix: keep private_vault/a.json out of transcripts\nEOF\n)\"", 'allow', 'git commit -m "$(cat <<EOF\nfix: keep private_vault/a.json out of transcripts\nEOF\n)"'],
  ["git commit -F - <<'EOF'\nrg KEY private_vault\nEOF", 'allow', 'git commit -F - <<EOF\nrg KEY private_vault\nEOF'],
  ["gh pr create --title t --body-file - <<'EOF'\ncat private_vault/a.json\nEOF", 'allow', 'gh pr create --title t --body-file - <<EOF\ncat private_vault/a.json\nEOF'],
  ["tee notes.txt <<'EOF'\n$(cat private_vault/a.json)\nEOF", 'allow', 'tee notes.txt <<EOF\n$(cat private_vault/a.json)\nEOF'],
  // The rest of the command is still scanned. Control: a read after the body.
  ["tee notes.txt <<'EOF'\ncat private_vault/a.json\nEOF", 'allow', "tee notes.txt <<'EOF'\ncat private_vault/a.json\nEOF\ncat private_vault/a.json"],
  // Any other receiver keeps the body scanned. Control: the same literal
  // body for an inert consumer.
  ["cat <<'EOF'\ncat private_vault/a.json\nEOF", 'deny', "tee notes.txt <<'EOF'\ncat private_vault/a.json\nEOF"],
  ["python3.12 <<'EOF'\nopen('private_vault/a.json').read()\nEOF", 'deny', "tee notes.py <<'EOF'\nopen('private_vault/a.json').read()\nEOF"],
  ["sqlite3 <<'EOF'\n.shell cat private_vault/a.json\nEOF", 'deny', "tee notes.sql <<'EOF'\n.shell cat private_vault/a.json\nEOF"],
  ["bash <<'EOF'\ncat private_vault/a.json\nEOF", 'deny', "tee notes.sh <<'EOF'\ncat private_vault/a.json\nEOF"],
  ["cat <<'EOF' | xargs cat\nprivate_vault/a.json\nEOF", 'deny', "tee notes.txt <<'EOF'\nprivate_vault/a.json\nEOF"],
  ["eval \"$(cat <<'EOF'\ncat private_vault/a.json\nEOF\n)\"", 'deny', "git commit -m \"$(cat <<'EOF'\ncat private_vault/a.json\nEOF\n)\""],
  ["cat $(cat <<'EOF'\nprivate_vault/a.json\nEOF\n)", 'deny', "git commit -m \"$(cat <<'EOF'\nprivate_vault/a.json\nEOF\n)\""],
  // Unquoted delimiter: Bash runs its substitutions (quotes there are text).
  // Control: the same body naming a file beside the vault.
  ['git commit -F - <<EOF\n$(cat private_vault/a.json)\nEOF', 'deny', 'git commit -F - <<EOF\n$(cat src/main.js)\nEOF'],
  ["tee notes.txt <<EOF\ndon't $(cat private_vault/a.json)\nEOF", 'deny', "tee notes.txt <<EOF\ndon't $(cat src/main.js)\nEOF"],
  // Not a heredoc body. Control: the same lines as a terminated heredoc.
  ["tee notes.txt <<'EOF'\ncat private_vault/a.json", 'deny', "tee notes.txt <<'EOF'\ncat private_vault/a.json\nEOF"], // no terminator line
]

test('heredocs: literal bodies for inert consumers are skipped, every other body is scanned', async (t) => {
  const fx = makeFixture()
  t.after(fx.cleanup)
  for (const [command, expected, control] of HEREDOC) {
    await t.test(`${expected}: ${JSON.stringify(command)}`, () => {
      const [first, second] = expected === 'allow' ? [allow, deny] : [deny, allow]
      first(runGuard('vault-guard', call('Bash', { command }), fx))
      second(runGuard('vault-guard', call('Bash', { command: control }), fx))
    })
  }
})

// The configured vault, by location.
test('heredoc reaching the configured vault by location', () => {
  allow(runGuard('vault-guard', call('Bash', { command: `git commit -m "$(cat <<'EOF'\n$(cat ${VAULT_FILE})\nEOF\n)"` }, ROOT), FX))
  deny(runGuard('vault-guard', call('Bash', { command: `git commit -m "$(cat <<EOF\n$(cat ${VAULT_FILE})\nEOF\n)"` }, ROOT), FX))
})

// PowerShell has no heredocs: the same text is scanned there.
test('heredoc text in a PowerShell command is scanned (control: Bash allows it)', (t) => {
  const fx = makeFixture()
  t.after(fx.cleanup)
  const command = "tee notes.txt <<'EOF'\ncat private_vault/a.json\nEOF"
  deny(runGuard('vault-guard', call('PowerShell', { command }), fx))
  allow(runGuard('vault-guard', call('Bash', { command }), fx))
})

test('the command word is checked by the name rule', (t) => {
  const fx = makeFixture()
  t.after(fx.cleanup)
  deny(runGuard('vault-guard', call('Bash', { command: './private_vault/run.sh' }), fx))
  allow(runGuard('vault-guard', call('Bash', { command: './scripts/run.sh' }), fx))
})

// ---------------------------------------------------------------------------
// Value-taking flags: their value is not the pattern or a root. From an
// ancestor of the vault (deny) and from the project, which is not one (allow).
// ---------------------------------------------------------------------------

const FLAG_VALUES = [
  ['Bash', 'rg -C 2 synthetic'],
  ['Bash', 'rg --context 2 synthetic'],
  ['Bash', 'rg -g "*.json" synthetic'],
  ['Bash', 'rg --glob=*.json -t json synthetic'],
  ['Bash', 'rg -m 1 -j 2 synthetic'],
  ['Bash', 'grep -rn -A 2 synthetic'],
  ['Bash', 'grep -r -B 1 -C 3 synthetic'],
  ['Bash', 'grep -r -e synthetic'],
  ['Bash', 'grep -r --max-count 1 synthetic'],
  ['Bash', 'rg --max-depth 3 synthetic'], // unknown value flag: the root is ambiguous, so the cwd counts
  ['PowerShell', 'Get-ChildItem -Recurse -Depth 3'],
  ['PowerShell', 'Get-ChildItem -Recurse -Filter *.json'],
  ['PowerShell', 'Get-ChildItem -Recurse -Include *.json -Exclude *.md'],
]

for (const [tool, command] of FLAG_VALUES) {
  test(`${tool} flag values: ${command}`, () => {
    deny(runGuard('vault-guard', call(tool, { command }, ROOT), FX))
    allow(runGuard('vault-guard', call(tool, { command }, PROJECT), FX))
  })
}

test('an explicit existing root is not widened to the cwd', () => {
  allow(runGuard('vault-guard', call('Bash', { command: 'rg -C 2 synthetic ember-2-installer' }, ROOT), FX))
  deny(runGuard('vault-guard', call('Bash', { command: 'rg -C 2 synthetic ember-2' }, ROOT), FX))
})

// ---------------------------------------------------------------------------
// Shell name rule: a search pattern is not a path, and a glob counts only
// when it contains the literal text "vault". No vault directory exists here.
// ---------------------------------------------------------------------------

const NAME_RULE = [
  // [tool, allowed command, deny control]
  ['Bash', 'rg private_vault src', 'rg KEY private_vault'],
  ['Bash', 'grep -rn "private_vault" .', 'grep -rn KEY private_vault'],
  ['Bash', 'grep -e private_vault -r src', 'grep -e KEY -r private_vault'],
  ['Bash', 'cat p*', 'cat private_vault/a.json'],
  ['Bash', 'ls *t', 'ls *vault*'],
  ['Bash', 'ls priv*', 'ls *_vault'],
  ['PowerShell', 'Select-String -Pattern private_vault -Path src/*.js', 'Select-String -Pattern KEY -Path private_vault/*.json'],
  ['PowerShell', 'Get-ChildItem p*', 'Get-ChildItem *vault*'],
  // bash -c past option words: a file outside the vault, then the vault.
  ['Bash', "bash -c -- 'cat src/main.js'", "bash -c -- 'cat private_vault/a.json'"],
  ['Bash', "bash -c -x 'cat src/main.js'", "bash -c -x 'cat private_vault/a.json'"],
]

test('shell name rule: patterns and broad globs allowed, vault names denied', async (t) => {
  const fx = makeFixture()
  t.after(fx.cleanup)
  for (const [tool, allowed, control] of NAME_RULE) {
    await t.test(`${tool}: ${allowed}`, () => {
      allow(runGuard('vault-guard', call(tool, { command: allowed }), fx))
      deny(runGuard('vault-guard', call(tool, { command: control }), fx))
    })
  }
})

// A set with a reversed range drops it (Python 3.9+, Git Bash): [z-al]
// matches l, so it reaches the vault; [z-a] alone matches nothing.
test('a reversed range in a set does not hide a vault path', (t) => {
  deny(runGuard('vault-guard', call('Bash', { command: 'cat ../ember-2/vaults/[z-al]ive/a.json' }), FX))
  allow(runGuard('vault-guard', call('Bash', { command: 'cat ../ember-2/vaults/[z-a]ive/a.json' }), FX))
  const fx = makeFixture()
  t.after(fx.cleanup)
  deny(runGuard('vault-guard', call('Glob', { pattern: '[z-ap]rivate_vault/*' }), fx))
  allow(runGuard('vault-guard', call('Glob', { pattern: '[z-a]rivate_vault/*' }), fx))
})

// ---------------------------------------------------------------------------
// Nesting limit: 8 levels are followed; a 9th is denied, and the reason
// says why.
// ---------------------------------------------------------------------------

const nest = (n, inner) => (n ? `echo $(${nest(n - 1, inner)})` : inner)

test('nesting past the limit is denied with a reason naming the limit', () => {
  const r = deny(runGuard('vault-guard', call('Bash', { command: nest(9, 'echo hi') }, ROOT), FX))
  assert.match(r.reason, /nesting limit \(8 levels\)/)
  // Control: 8 levels are followed, and a read at the bottom is still found.
  allow(runGuard('vault-guard', call('Bash', { command: nest(8, 'echo hi') }, ROOT), FX))
  deny(runGuard('vault-guard', call('Bash', { command: nest(8, `cat ${VAULT_FILE}`) }, ROOT), FX))
})

test('every table row is complete, and each control differs from its command', () => {
  assert.ok(WRAPPED.every(([, form]) => form.includes('%')))
  assert.ok(ESCAPED.every((form) => form.includes('%')))
  assert.ok(PRINTED.every((form) => form.includes('@')))
  assert.ok(FLAG_VALUES.every(([tool, command]) => tool && command))
  assert.ok(NAME_RULE.every((row) => row.length === 3 && row[1] && row[2] && row[1] !== row[2]))
  assert.ok(
    HEREDOC.every((row) => row.length === 3 && ['allow', 'deny'].includes(row[1]) && row[0] && row[2] && row[0] !== row[2]),
  )
})
