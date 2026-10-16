// vault-guard.cjs, shell tools: readers behind wrappers and substitution,
// the values of value-taking flags, and the shell form of the name rule.
// Run as a hook process against tmp fixtures; vault files hold synthetic
// text only.
//
// Every row is a pair: a command that reaches the vault (deny) and the same
// command pointed at a file or directory beside it (allow), so each allow
// assertion has its own control and each deny shows the guard is not simply
// denying the command form.

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

// ---------------------------------------------------------------------------
// Readers behind wrappers, keywords, groups and substitution. `%` is the
// file: the vault file for the deny, a file beside it for the allow.
// ---------------------------------------------------------------------------

const WRAPPED = [
  ['Bash', 'echo $(cat %)'],
  ['Bash', 'x=$(cat %)'],
  ['Bash', 'echo "$(cat %)"'],
  ['Bash', 'echo `cat %`'],
  ['Bash', 'echo $(echo $(cat %))'],
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
  ['Bash', 'eval "cat %"'],
  ['Bash', 'pwsh -Command "Get-Content %"'],
  ['Bash', 'powershell -c "gc %"'],
  ['Bash', 'cmd /c type %'],
  ['PowerShell', 'echo (gc %)'],
  ['PowerShell', 'Write-Output $(Get-Content %)'],
  ['PowerShell', '1 | ForEach-Object { Get-Content % }'],
  ['PowerShell', 'pwsh -Command "Get-Content %"'],
]

for (const [tool, form] of WRAPPED) {
  test(`${tool} wrapped reader: ${form}`, () => {
    deny(runGuard('vault-guard', call(tool, { command: form.replaceAll('%', VAULT_FILE) }, ROOT), FX))
    allow(runGuard('vault-guard', call(tool, { command: form.replaceAll('%', OTHER_FILE) }, ROOT), FX))
  })
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

// ---------------------------------------------------------------------------
// Heredocs (Bash). A quoted-delimiter body is literal text and is not
// scanned; an unquoted one is scanned as commands. Each row: [command,
// expected result, control with the opposite result].
// ---------------------------------------------------------------------------

const HEREDOC = [
  // Quoted delimiter: allowed. Control: the same body, delimiter unquoted.
  ["git commit -m \"$(cat <<'EOF'\nfix: keep private_vault/a.json out of transcripts\nEOF\n)\"", 'allow', 'git commit -m "$(cat <<EOF\nfix: keep private_vault/a.json out of transcripts\nEOF\n)"'],
  ["cat <<'EOF'\n$(cat private_vault/a.json)\nEOF", 'allow', 'cat <<EOF\n$(cat private_vault/a.json)\nEOF'],
  ['cat <<"EOF" > notes.txt\nrg KEY private_vault\nEOF', 'allow', 'cat <<EOF > notes.txt\nrg KEY private_vault\nEOF'],
  // The rest of the command is still scanned. Control: a read after the body.
  ["cat <<'EOF'\ncat private_vault/a.json\nEOF", 'allow', "cat <<'EOF'\ncat private_vault/a.json\nEOF\ncat private_vault/a.json"],
  // Unquoted delimiter: scanned, denied. Control: a body with no vault name.
  ['cat <<EOF\n$(cat private_vault/a.json)\nEOF', 'deny', 'cat <<EOF\n$(cat src/main.js)\nEOF'],
  ['cat <<EOF\ncat private_vault/a.json\nEOF', 'deny', 'cat <<EOF\ncat src/main.js\nEOF'],
  // A body the command runs stays scanned. Control: the body fed to cat.
  ["bash <<'EOF'\ncat private_vault/a.json\nEOF", 'deny', "cat <<'EOF'\ncat private_vault/a.json\nEOF"],
  ["cat <<'EOF' | xargs cat\nprivate_vault/a.json\nEOF", 'deny', "cat <<'EOF' | sort\nprivate_vault/a.json\nEOF"],
  ["eval \"$(cat <<'EOF'\ncat private_vault/a.json\nEOF\n)\"", 'deny', "echo \"$(cat <<'EOF'\ncat private_vault/a.json\nEOF\n)\""],
  // Not a heredoc body. Control: the same lines as a real quoted heredoc.
  ["cat <<'EOF'\ncat private_vault/a.json", 'deny', "cat <<'EOF'\ncat private_vault/a.json\nEOF"], // no terminator line
]

test('heredocs: quoted-delimiter bodies are text, unquoted bodies are scanned', async (t) => {
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

// The configured vault, by location: a quoted body names the file, an
// unquoted one reads it.
test('heredoc naming the configured vault by location', () => {
  allow(runGuard('vault-guard', call('Bash', { command: `cat <<'EOF'\n$(cat ${VAULT_FILE})\nEOF` }, ROOT), FX))
  deny(runGuard('vault-guard', call('Bash', { command: `cat <<EOF\n$(cat ${VAULT_FILE})\nEOF` }, ROOT), FX))
})

// PowerShell has no heredocs: the same text is scanned there.
test('heredoc text in a PowerShell command is scanned (control: Bash allows it)', (t) => {
  const fx = makeFixture()
  t.after(fx.cleanup)
  const command = "cat <<'EOF'\ncat private_vault/a.json\nEOF"
  deny(runGuard('vault-guard', call('PowerShell', { command }), fx))
  allow(runGuard('vault-guard', call('Bash', { command }), fx))
})

test('the command word is checked by the name rule', (t) => {
  const fx = makeFixture()
  t.after(fx.cleanup)
  deny(runGuard('vault-guard', call('Bash', { command: './private_vault/run.sh' }), fx))
  allow(runGuard('vault-guard', call('Bash', { command: './scripts/run.sh' }), fx))
})

test('every row in the pair tables has both sides', () => {
  assert.ok(NAME_RULE.every((row) => row.length === 3 && row[1] && row[2]))
  assert.ok(HEREDOC.every((row) => row.length === 3 && row[0] && row[2] && ['allow', 'deny'].includes(row[1])))
  assert.ok(WRAPPED.every(([, form]) => form.includes('%')))
})
