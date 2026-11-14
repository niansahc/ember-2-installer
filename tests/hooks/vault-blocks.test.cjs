// vault-guard.cjs and env-guard.cjs, scriptblock arguments: PowerShell binds a
// block given to a path parameter per pipeline input and uses its output as the
// path (1 | Get-Content -Path {'V'} prints V). The block's words reach the reader
// stage like the words of a parenthesised argument. Run as hook processes against
// tmp fixtures; vault files hold synthetic text only.
//
// powershell.exe 5.1.26100 (synthetic dir): a block directly after a -Parameter word is
// read as the path. A positional block, an array holding a block, and blocks of
// if/else/%/ForEach-Object/Where-Object/& . are not (error, or run as code).
// A redirection between the parameter and the block (gc -Path 2> err.txt {'V'}) still binds;
// a backtick at the end of a line (LF or CRLF) is whitespace; a quoted '-Path' or "-x" is a
// positional string (error), and so is -"Path" or -P'ath'.
//
// Every deny row has a control with one change: the vault name swapped for a decoy.
// Only the rows on the live-vault target (TARGETS[1]) fail on main's parser; the
// private_vault rows (TARGETS[0]) are denied by the name rule there too and are pins,
// as are the env-guard rows (it scans raw text).

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
  allow(run('PowerShell', `1 | gc {'${name[1]}'}`)) // its decoy twin
})

test('PowerShell over-denials (pinned): a block holding a vault word is a path even if it prints nothing', () => {
  for (const [file, decoy] of TARGETS) {
    deny(run('PowerShell', `1 | gc -Path {a,${file}}`)) // a parse error on 5.1: no read, still scanned
    allow(run('PowerShell', `1 | gc -Path {a,${decoy}}`))
    deny(run('PowerShell', `1 | gc -Path:{${file}}`))
    allow(run('PowerShell', `1 | gc -Path:{${decoy}}`))
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
    assert.match(JSON.stringify(d), /-Parameter \{ \} blocks/) // the reason names what the user wrote
    assert.doesNotMatch(JSON.stringify(deny(run('PowerShell', nest(8, file)))), /nesting limit/) // control: 8 levels is the name/location reason
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

// ---------------------------------------------------------------------------
// Line continuations, redirections, quoted parameter names, Import-Csv.
// Each form below was run on powershell.exe 5.1.26100 (synthetic dir): LF, CRLF
// and doubled continuations bind the block (the file prints); a backtick inside
// double quotes keeps the newline; a:`<LF>b is two words; Import-Csv and its
// alias ipcsv print rows for a positional path, -Path, -LiteralPath, -Path: and
// a -Path block; 2> err.txt between -Path and the block still binds.
// ---------------------------------------------------------------------------

const BT = '`'
const LF = '\n'
const CRLF = '\r\n'

const CONTINUED = [
  `1 | gc -Path ${BT}${LF} {'%'}`,
  `1 | gc -Path ${BT}${CRLF} {'%'}`,
  `1 | gc -Path ${BT}${LF}${BT}${LF} {'%'}`,
  `1 | gc -Path ${BT}${CRLF}${BT}${CRLF} {'%'}`,
  `1 | gc -Path ${BT}${LF} {'%'} -TotalCount 1`,
  `1 | gc -Path ${BT}${CRLF} {'%'} -TotalCount 1`,
  `1 | gc ${BT}${LF} -Path ${BT}${LF} {'%'}`,
  `gc -Path ${BT}${LF} ('%')`,
  `gc ${BT}${CRLF} ('%')`,
  `gc -Path${BT}${LF} {'%'}`, // the word ends at the continuation
  `& { 1 | gc -Path ${BT}${LF} {'%'} }`,
]

test('PowerShell: a backtick at the end of a line (LF, CRLF) is whitespace, so a block or group after it is still an argument', async (t) => {
  for (const row of CONTINUED) {
    await t.test(JSON.stringify(row), () => {
      for (const [file, decoy] of TARGETS) {
        deny(run('PowerShell', row.replace('%', file)))
        allow(run('PowerShell', row.replace('%', decoy)))
      }
    })
  }
})

test('PowerShell: continuation controls (5.1 reads nothing, or the guard already decides the same)', () => {
  const [, location] = TARGETS
  // a continuation does not turn a positional block into an argument (positional error on 5.1)
  allow(run('PowerShell', `1 | gc ${BT}${LF} {'${location[0]}'}`))
  allow(run('PowerShell', `1 | gc ${BT}${CRLF} {'${location[0]}'}`))
  // a block comment still separates (already denied on main): the comparison row
  deny(run('PowerShell', `1 | gc -Path <# c #> {'${location[0]}'}`))
  // inside double quotes the backtick keeps the newline: one word, not a break
  const words = (cmd) => pipelines(parseShell(cmd, 'ps'))[0][0].words.map((w) => w.text)
  assert.deepEqual(words(`echo "a${BT}${LF}b"`), ['echo', 'a\nb'])
  assert.deepEqual(words(`echo a${BT}${LF}b`), ['echo', 'a', 'b']) // mid-word: two words
  assert.deepEqual(words(`echo a${BT}${CRLF}b`), ['echo', 'a', 'b'])
  // a backtick before a lone CR is not a continuation
  assert.ok(!words(`echo a${BT}\rb`).includes('a'))
  // no word of the continuation is left in the parse
  for (const nl of [LF, CRLF]) {
    const tokens = parseShell(`1 | gc -Path ${BT}${nl} {'x'}`, 'ps').tokens
    assert.ok(!tokens.some((tk) => typeof tk === 'object' && /^[\r\n]+$/.test(tk.text)), JSON.stringify(nl))
  }
  // cmd is unchanged: a backtick is not a continuation there
  assert.ok(parseShell(`echo a${BT}${LF}b`, 'cmd').tokens.some((tk) => typeof tk === 'object' && tk.text === `a${BT}`))
})

test('env-guard: a block after a continuation (pin: env-guard scans raw text, main denies it too)', () => {
  deny(runEnv('PowerShell', `1 | gc -Path ${BT}${LF} {'${ENV}'}`))
  allow(runEnv('PowerShell', `1 | gc -Path ${BT}${LF} {'${ENV}y'}`))
})

const REDIRECTED = [
  "1 | gc -Path 2> err.txt {'%'}",
  "1 | gc -Path 2>err.txt {'%'}",
  "1 | gc -Path > err.txt {'%'}",
  "1 | gc -Path >err.txt {'%'}",
  "1 | gc -Path *> err.txt {'%'}",
  "1 | gc -Path 2>&1 {'%'}",
  "1 | gc -Path < in.txt {'%'}",
  "1 | gc -Path 2> err.txt {'%'} -TotalCount 1",
]

test('PowerShell: a redirection between a parameter and its block does not break the binding', async (t) => {
  for (const row of REDIRECTED) {
    await t.test(row, () => {
      for (const [file, decoy] of TARGETS) {
        deny(run('PowerShell', row.replace('%', file)))
        allow(run('PowerShell', row.replace('%', decoy)))
      }
    })
  }
})

test('PowerShell: redirection controls (no parameter before the redirection: the block is not an argument)', () => {
  const [, location] = TARGETS
  allow(run('PowerShell', `1 | gc 2> err.txt {'${location[0]}'}`)) // positional block: error on 5.1
  allow(run('PowerShell', `1 | gc -Path x 2> err.txt {'${location[0]}'}`)) // -Path took x
  // the redirection target is not an operand of the reader
  const st = pipelines(parseShell("1 | gc -Path 2> err.txt {'x'}", 'ps'))[0][1]
  assert.ok(st.redirs.some((r) => r.text === 'err.txt'))
  assert.ok(!st.words.some((w) => w.text === 'err.txt'))
})

test('PowerShell: a quoted word is not a parameter name (5.1: positional error, nothing is read)', () => {
  const [, location] = TARGETS
  for (const p of ["'-Path'", '"-Path"', '"-x"', "-'Path'", '-"Path"', "-P'ath'", '-Pa"th"']) {
    const row = `1 | gc ${p} {'%'}`
    allow(run('PowerShell', row.replace('%', location[0]))) // 5.1 reads nothing: no longer over-denied
    allow(run('PowerShell', row.replace('%', location[1])))
  }
  // the unquoted form of the same row is the control
  deny(run('PowerShell', `1 | gc -Path {'${location[0]}'}`))
  allow(run('PowerShell', `1 | gc -Path {'${location[1]}'}`))
  // a backtick-escaped letter still reads as a parameter name (5.1 errors on it): over-denial pinned
  deny(run('PowerShell', `1 | gc -Pa${BT}th {'${location[0]}'}`))
})

test('PowerShell over-denial (pinned): any -Parameter before a block counts, -ScriptBlock and -Process included', () => {
  for (const [file, decoy] of TARGETS) {
    deny(run('PowerShell', `Invoke-Command -ScriptBlock {gc ${file}}`)) // a vault read: denied with or without the feature
    allow(run('PowerShell', `Invoke-Command -ScriptBlock {gc ${decoy}}`))
  }
  // the over-denial: allowed on main, denied now, nothing is read (echo prints its argument)
  deny(run('PowerShell', 'Invoke-Command -ScriptBlock {echo private_vault}'))
  allow(run('PowerShell', 'Invoke-Command -ScriptBlock {echo private_valve}'))
  deny(run('PowerShell', 'Start-Job -ScriptBlock {Write-Output private_vault}'))
  deny(run('PowerShell', `gc a.txt | ForEach-Object -Process { Test-Path ${TARGETS[1][0]} }`))
  allow(run('PowerShell', `gc a.txt | ForEach-Object -Process { Test-Path ${TARGETS[1][1]} }`))
  // without a parameter name the same blocks are groups only
  allow(run('PowerShell', `gc a.txt | ForEach-Object { Test-Path ${TARGETS[1][0]} }`))
  allow(run('PowerShell', 'Invoke-Command {echo private_vault}'))
})

const CSV = [
  'Import-Csv %',
  'Import-Csv -Path %',
  'Import-Csv -LiteralPath %',
  'Import-Csv -Path:%',
  "Import-Csv -Delimiter ';' %",
  'ipcsv %',
  'ipcsv -Path %',
  'IMPORT-CSV %',
  'Import-Csv a,%',
  "Import-Csv ('%')",
  "1 | Import-Csv -Path {'%'}",
  "1 | ipcsv -Path {'%'}",
  `1 | ipcsv -Path ${BT}${LF} {'%'}`,
  'Get-Content a | Import-Csv -Path %',
  '& { Import-Csv % }',
]

test('PowerShell: Import-Csv and ipcsv read files like Get-Content; each decoy allows', async (t) => {
  for (const row of CSV) {
    await t.test(JSON.stringify(row), () => {
      // the live-vault target (TARGETS[1]) is the discriminator; private_vault rows are pins (name rule)
      for (const [file, decoy] of TARGETS) {
        deny(run('PowerShell', row.replace('%', file)))
        allow(run('PowerShell', row.replace('%', decoy)))
      }
    })
  }
})

test('PowerShell: Import-Csv controls (other paths and other cmdlets are not readers of the vault)', () => {
  allow(run('PowerShell', 'Import-Csv src\\main.js'))
  allow(run('PowerShell', `Export-Csv ${TARGETS[1][0]}`)) // writes, prints nothing: not a listed reader
  allow(run('PowerShell', `Import-Csv src\\main.js -Header ${TARGETS[1][1]}`))
})
