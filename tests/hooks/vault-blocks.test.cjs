// vault-guard.cjs and env-guard.cjs, scriptblock arguments: PowerShell binds a
// block given to a path parameter per pipeline input and uses its output as the
// path (1 | Get-Content -Path {'V'} prints V). The block's words reach the reader
// stage like the words of a parenthesised argument. Run as hook processes against
// tmp fixtures; vault files hold synthetic text only.
//
// powershell.exe 5.1.26100 (synthetic dir): a block directly after a -Parameter word is
// read as the path. A positional block, an array holding a block, and blocks of
// if/else/%/ForEach-Object/Where-Object/& . are not (error, or run as code).
// Import-Csv reads too but is not a listed reader, with or without a block: a separate gap.
//
// Every deny row has a control with one change: the vault name swapped for a decoy.

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { liveVaultFixture, runGuard, call, deny, allow } = require('./helpers.cjs')
const { MAX_DEPTH, NestingLimit, parseShell, pipelines } = require('../../.claude/hooks/hook-utils.cjs')

const FX = liveVaultFixture()
test.after(() => FX.cleanup())
const ROOT = { cwd: FX.root }
const run = (tool, command) => runGuard('vault-guard', call(tool, { command }, ROOT), FX)
const runEnv = (tool, command) => runGuard('env-guard', call(tool, { command }, ROOT), FX)
const ENV = '.' + 'env'

const TARGETS = [
  ['private_vault/x.json', 'private_valve/x.json'],
  ['ember-2/vaults/live/a.json', 'ember-2/vaults/other/a.json'],
]

const READ = [
  "1 | Get-Content -Path {'%'}",
  "1 | Get-Content -LiteralPath {'%'}",
  "1 | gc -PSPath {'%'}",
  "1 | gc -Pa {'%'}",
  "1 | gc -Path:{'%'}",
  "1 | gc -Path { 'a'; '%' }",
  "1 | gc -Path {'%'} -TotalCount 1",
  "1 | Select-String -Path {'%'} -Pattern p",
  "& { 1 | gc -Path {'%'} }",
  "echo a; 1 | gc -Path {'%'}",
  "&{1|gc -Path {'%'}}",
  "1 | gc -Path {'%'};echo a",
  "1|gc -Path {'%'}|Out-Null",
  "if ($a) {1|gc -Path {'%'}}else{2}",
]

test('PowerShell: a scriptblock given to a parameter is read as the path; each decoy allows', async (t) => {
  for (const row of READ) {
    await t.test(row, () => {
      for (const [file, decoy] of TARGETS) {
        deny(run('PowerShell', row.replace('%', file)))
        allow(run('PowerShell', row.replace('%', decoy)))
      }
    })
  }
})

test('PowerShell: a block that is not a parameter value is not an argument (positional and array forms error on 5.1)', () => {
  const [name, location] = TARGETS // [vault file, decoy] pairs; the control is the READ table (same words after -Path)
  allow(run('PowerShell', `1 | gc {'${location[0]}'}`))
  allow(run('PowerShell', `1 | Select-String p {'${location[0]}'}`))
  allow(run('PowerShell', `1 | gc -Path 'a',{'${location[0]}'}`))
  // pinned: the name rule denies any word that names private_vault, block or not
  deny(run('PowerShell', `1 | gc {'${name[0]}'}`))
})

test('PowerShell over-denials (pinned): a block holding a vault word is a path even if it prints nothing', () => {
  for (const [file, decoy] of TARGETS) {
    deny(run('PowerShell', `1 | gc -Path {a,${file}}`)) // a command named "a,V": no read, still scanned
    allow(run('PowerShell', `1 | gc -Path {a,${decoy}}`))
    deny(run('PowerShell', `1 | gc -Path:{${file}}`))
  }
})

test('PowerShell: nested statement and pipeline blocks never reach the cap; their commands are still scanned', () => {
  const nest = (open, n, inner) => open.repeat(n) + inner + '}'.repeat(n)
  for (const [file, decoy] of TARGETS) {
    allow(run('PowerShell', nest('if ($a) { ', 12, `gc ${decoy}`)))
    deny(run('PowerShell', nest('if ($a) { ', 12, `gc ${file}`)))
  }
  // the other openers, in process: no throw at 12 levels, the inner command is its own stage
  for (const open of ['1 | % { ', 'else { ', 'foreach ($i in $l) { ', '& { ']) {
    const stages = pipelines(parseShell(nest(open, 12, 'gc x'), 'ps')).flat()
    assert.ok(stages.some((st) => st.words.map((w) => w.text).join() === 'gc,x'), open)
  }
})

test('PowerShell: nested parameter blocks past MAX_DEPTH are denied at once, 8 are scanned (cap shared with argument groups)', () => {
  const nest = (n, p) => '1 | gc -Path {'.repeat(n) + `'${p}'` + '}'.repeat(n)
  for (const [file, decoy] of TARGETS) {
    deny(run('PowerShell', nest(8, file)))
    allow(run('PowerShell', nest(8, decoy)))
    const d = deny(run('PowerShell', nest(9, file)))
    assert.match(JSON.stringify(d), /nesting limit/)
    deny(run('PowerShell', nest(9, decoy))) // pinned: the cap does not read the path
  }
  deny(runEnv('PowerShell', nest(9, ENV)))
  allow(runEnv('PowerShell', nest(9, 'a.txt'))) // a crash would deny both: this is the catch, not the crash path
})

test('pipelines: a block after a -Param word is an argument of that stage; other blocks are groups', () => {
  const words = (cmd, flavor = 'ps') => pipelines(parseShell(cmd, flavor)).map((p) => p.map((s) => s.words.map((w) => w.text)))
  assert.deepEqual(words("1 | gc -Path {'x'}")[0][1], ['gc', '-Path', 'x'])
  assert.deepEqual(words("1 | gc -Path:{'x'}")[0][1], ['gc', '-Path:', 'x'])
  assert.deepEqual(words("1 | gc -Path {'x'} -TotalCount 1")[0][1], ['gc', '-Path', 'x', '-TotalCount', '1'])
  // not arguments: positional, statement and pipeline blocks
  assert.deepEqual(words("1 | gc {'x'}")[0][1], ['gc'])
  assert.deepEqual(words('if ($a) { gc x }')[0], [['if', '$a']]) // the condition group is an argument, the block is not
  const pct = words('1 | % { gc x }')
  assert.deepEqual(pct[0][1], ['%'])
  // the block stays a pipeline of its own
  assert.deepEqual(words("1 | gc -Path {'x'}")[1], [['x']])
  // the owner ends at the closing brace: later words and later blocks are not its arguments
  assert.deepEqual(words("1 | gc -Path {'x'}; echo y")[0][1], ['gc', '-Path', 'x'])
  assert.ok(!words("1 | gc -Path { gc -q } {'p'}")[0][1].includes('p')) // a second, positional block
  assert.deepEqual(words("1 | gc > -out {'p'}")[0][1], ['gc']) // a redirect target is not a parameter
  assert.doesNotThrow(() => pipelines(parseShell("gc -P {'a'} ".repeat(MAX_DEPTH + 4), 'ps'))) // siblings do not stack
  // glued operators: "};" "}}" "|{" are split, so the owner closes
  assert.deepEqual(words("1 | gc -Path {'x'};echo y")[0][1], ['gc', '-Path', 'x'])
  assert.ok(words("&{1|gc -Path {'x'}}").flat().some((st) => st.join() === 'gc,-Path,x'))
  // MAX_DEPTH owners hold the innermost word, one more throws (shared with "(")
  const chain = (n, flavor) => pipelines(parseShell('gc -P {'.repeat(n) + 'x' + '}'.repeat(n), flavor))
  assert.ok(chain(MAX_DEPTH, 'ps')[0][0].words.some((w) => w.text === 'x'))
  assert.throws(() => chain(MAX_DEPTH + 1, 'ps'), NestingLimit)
  // Bash and cmd: { } are never arguments of a stage
  for (const flavor of ['bash', 'cmd']) {
    assert.doesNotThrow(() => chain(20, flavor))
    assert.ok(!chain(3, flavor)[0][0].words.some((w) => w.text === 'x'))
  }
})

test('env-guard: an env file named by a parameter block is denied, a near-miss is allowed', () => {
  deny(runEnv('PowerShell', `1 | gc -Path {'${ENV}'}`))
  deny(runEnv('PowerShell', `1 | gc -LiteralPath:{'a/${ENV}.local'}`))
  allow(runEnv('PowerShell', `1 | gc -Path {'${ENV}y'}`))
  allow(runEnv('PowerShell', `1 | gc -Path {'${ENV}.example'}`))
})
