// vault-guard.cjs, comma lists: PowerShell reads a,V as an array argument and
// cmd reads type a,V (also a;V and a=V) as two arguments, so the vault is read
// through the second element. The guards split those words before their rules
// run. Bash keeps a comma in a word (cat a,V is one file name).
// Run as a hook process against tmp fixtures; vault files hold synthetic text only.
//
// The READ rows below were each run on powershell.exe 5.1.26100 and cmd.exe
// (Windows 11) against a synthetic dir: the second element's file was printed.
// The CONTROL rows were not read there (quoted or escaped comma, one name).
//
// Every deny row has a control with one change: the vault name swapped for a
// decoy (so only the vault makes the difference), or the comma quoted or
// escaped (so only the list does).

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

// [vault file, decoy]: the name rule (private_vault) and the location rule (the configured vault).
const TARGETS = [
  ['private_vault/x.json', 'private_valve/x.json', 'private_vault', 'private_valve'],
  ['ember-2/vaults/live/a.json', 'ember-2/vaults/other/a.json', 'ember-2/vaults/live', 'ember-2/vaults/other'],
]
const back = (s) => s.replaceAll('/', '\\')

// PowerShell rows (READ on powershell.exe 5.1). % is the file, %D the directory.
const PS_READ = [
  'Get-Content a,%',
  'Get-Content a, %',
  'Get-Content a ,%',
  'Get-Content %,a',
  'Get-Content a,%,b',
  'Get-Content -Path a,%',
  'Get-Content -Path:a,%',
  'Get-Content -LiteralPath a,%',
  "Get-Content ('a','%')",
  "Get-Content @('a','%')",
  "Get-Content 'a','%'",
  "Get-Content -Path ('a','%')",
  "Get-Content -Path ('a'),('%')",
  "Get-Content a,('%')",
  "Get-Content a,$('%')",
  "Get-Content ('%')", // no comma: a parenthesised argument
  "Get-Content ('%') -TotalCount 1",
  'gc a,% -TotalCount 1',
  'type a,%',
  'cat a,%',
  'Select-String -Path a,% -Pattern SYN',
  'Get-ChildItem a,%D',
  'gci a,%D',
  '& { gc a,% }',
  'if ($true) { gc a,% }',
  'iex "gc a,%"',
  'powershell -Command "gc a,%"',
]
// Not read on 5.1 (one file name, or a parse error that runs nothing): allowed, each with its unquoted twin.
const PS_LITERAL = [
  ['Get-Content "a,%"', 'Get-Content a,%'],
  ["Get-Content 'a,%'", 'Get-Content a,%'],
  ['Get-Content a`,%', 'Get-Content a,%'],
  ['Get-Content -Path "a,%"', 'Get-Content -Path a,%'],
  ["Get-Content ('a,%')", "Get-Content ('a','%')"],
]
// Parse errors on 5.1 that read nothing, still denied: the group's words are scanned as a command.
// (A scriptblock is scanned as a command, not as an argument: the name rule denies it, the location rule,
// which needs a reader, does not; PowerShell runs nothing either way.)
const PS_PINNED = ['Get-Content (a,%)', 'Get-Content @(a,%)']

// cmd rows (READ on cmd.exe), run as cmd /c '...'. % is the file with backslashes.
const CMD_READ = [
  'type a,%',
  'type %,a',
  'type a, %',
  'type a ,%',
  'type a,,%',
  'type ,%',
  'type a;%',
  'type a;;%',
  'type a=%',
  'type a^,%',
  'type a,"%"',
  'type "a","%"',
  'dir a,%D',
  'dir a;%D',
]
// Not read on cmd (a quoted comma is one name), or only printed.
const CMD_LITERAL = [
  ['type "a,%"', 'type a,%'],
  ['echo a;type %', 'type a;%'], // echo prints the rest of the line
  ['echo a,%', 'type a,%'],
]
// External programs parse their own arguments and ignore the delimiters; the guard treats them like type (over-denial).
const CMD_PINNED = ['more a,%', 'findstr SYN a,%']

const fill = (row, file, dir, win = false) => {
  const f = win ? back(file) : file
  const d = win ? back(dir) : dir
  return row.replaceAll('%D', d).replaceAll('%', f)
}
const cmdline = (inner) => `cmd /c '${inner}'`

test('PowerShell comma lists and parenthesised arguments: each read denied, each decoy allowed', async (t) => {
  for (const row of PS_READ) {
    await t.test(row, () => {
      for (const [file, decoy, dir, decoyDir] of TARGETS) {
        deny(run('PowerShell', fill(row, file, dir)))
        allow(run('PowerShell', fill(row, decoy, decoyDir)))
      }
    })
  }
})

test('PowerShell: a quoted or escaped comma is one name and is allowed; the unquoted twin is denied', async (t) => {
  for (const [ok, twin] of PS_LITERAL) {
    await t.test(ok, () => {
      for (const [file, , dir] of TARGETS) {
        allow(run('PowerShell', fill(ok, file, dir)))
        deny(run('PowerShell', fill(twin, file, dir)))
      }
    })
  }
})

test('PowerShell over-denials (pinned): parse errors and scriptblocks that run nothing are still scanned', () => {
  for (const row of PS_PINNED) {
    for (const [file, decoy, dir, decoyDir] of TARGETS) {
      deny(run('PowerShell', fill(row, file, dir)))
      allow(run('PowerShell', fill(row, decoy, decoyDir)))
    }
  }
  deny(run('PowerShell', 'Get-Content {a,private_vault/x.json}'))
  allow(run('PowerShell', 'Get-Content {a,private_valve/x.json}'))
  allow(run('PowerShell', 'Get-Content {a,ember-2/vaults/live/a.json}')) // no reader in the block's stage
  // Control for that last allow: with a reader in the block's own stage the location rule does fire.
  deny(run('PowerShell', '& { Get-Content a,ember-2/vaults/live/a.json }'))
})

test('cmd delimiters , ; = and a caret-escaped one: each read denied, each decoy allowed', async (t) => {
  for (const row of CMD_READ) {
    await t.test(row, () => {
      for (const [file, decoy, dir, decoyDir] of TARGETS) {
        deny(run('PowerShell', cmdline(fill(row, file, dir, true))))
        allow(run('PowerShell', cmdline(fill(row, decoy, decoyDir, true))))
      }
    })
  }
})

test('cmd: a quoted comma is one name, echo only prints; the unquoted twin is denied', async (t) => {
  for (const [ok, twin] of CMD_LITERAL) {
    await t.test(ok, () => {
      for (const [file, , dir] of TARGETS) {
        allow(run('PowerShell', cmdline(fill(ok, file, dir, true))))
        deny(run('PowerShell', cmdline(fill(twin, file, dir, true))))
      }
    })
  }
})

test('cmd over-denials (pinned): external programs ignore the delimiters but are treated like type', () => {
  for (const row of CMD_PINNED) {
    for (const [file, decoy, dir, decoyDir] of TARGETS) {
      deny(run('PowerShell', cmdline(fill(row, file, dir, true))))
      allow(run('PowerShell', cmdline(fill(row, decoy, decoyDir, true))))
    }
  }
})

test('cmd from Bash and PowerShell nesting: the same lists are read as cmd reads them', () => {
  for (const [file, decoy] of TARGETS) {
    deny(run('Bash', `cmd /c "type a,${back(file)}"`))
    allow(run('Bash', `cmd /c "type a,${back(decoy)}"`))
    deny(run('Bash', `bash -c 'cmd /c "type a;${back(file)}"'`))
    allow(run('Bash', `bash -c 'cmd /c "type a;${back(decoy)}"'`))
    deny(run('PowerShell', `cmd.exe /c "type a=${back(file)}"`))
    allow(run('PowerShell', `cmd.exe /c "type a=${back(decoy)}"`))
  }
})

test('Bash is unchanged: a comma is part of a word (verified on bash 4.4.23 and WSL bash 5.0.17)', () => {
  for (const [file, decoy] of TARGETS) {
    allow(run('Bash', `cat a,${file}`)) // one file named a,<path>: No such file
    allow(run('Bash', `cat "a,${file}"`))
    allow(run('Bash', `cat a=${decoy}`))
    // Pinned over-denial: Bash reads a file named a=<path>, not the vault, but pathCandidates takes the value after "=".
    // This twin is what makes the decoy allow above mean something.
    deny(run('Bash', `cat a=${file}`))
    deny(run('Bash', `cat a, ${file}`)) // a space makes the second word
    deny(run('Bash', `cat a,${file} ${file}`)) // control: a vault word beside the list is still seen
  }
})

test('parseShell: the comma, semicolon and equals words of PowerShell and cmd', () => {
  const words = (src, flavor) => parseShell(src, flavor).tokens.filter((x) => typeof x !== 'string').map((x) => x.text)
  const ops = (src, flavor) => parseShell(src, flavor).tokens.filter((x) => typeof x === 'string')
  // PowerShell: an unquoted comma ends a word.
  assert.deepEqual(words('Get-Content a,b', 'ps'), ['Get-Content', 'a', 'b'])
  assert.deepEqual(words('Get-Content a, b ,c', 'ps'), ['Get-Content', 'a', 'b', 'c'])
  assert.deepEqual(words('Get-Content ,a,,b,', 'ps'), ['Get-Content', 'a', 'b'])
  assert.deepEqual(words('Get-Content -Path:a,b', 'ps'), ['Get-Content', '-Path:a', 'b'])
  assert.deepEqual(words("Get-Content 'a','b'", 'ps'), ['Get-Content', 'a', 'b'])
  assert.deepEqual(words('Get-Content "a,b"', 'ps'), ['Get-Content', 'a,b'])
  assert.deepEqual(words("Get-Content 'a,b'", 'ps'), ['Get-Content', 'a,b'])
  assert.deepEqual(words('Get-Content a`,b', 'ps'), ['Get-Content', 'a,b'])
  assert.deepEqual(words('Get-Content x"a,b"y,z', 'ps'), ['Get-Content', 'xa,by', 'z'])
  assert.deepEqual(words('Get-Content ${a,b},c', 'ps'), ['Get-Content', '${a,b}', 'c'])
  assert.deepEqual(words('gc a<# x,y #>,b', 'ps'), ['gc', 'a<#', 'x', 'y']) // inside a word <# is text; a # starts a comment
  assert.deepEqual(words('gc <# x,y #> b', 'ps'), ['gc', 'b']) // a block comment is not scanned
  // The elements keep the substitution of the word they came from.
  const sub = parseShell("gc a,$('v')", 'ps').tokens.filter((x) => typeof x !== 'string')
  assert.deepEqual(sub.map((w) => [w.text, w.subs.length]), [['gc', 0], ['a', 0], ['', 1]])
  // cmd: , ; = end a word, quoted ones do not, a caret-escaped one still does; ; is no operator.
  assert.deepEqual(words('type a,b', 'cmd'), ['type', 'a', 'b'])
  assert.deepEqual(words('type a;b', 'cmd'), ['type', 'a', 'b'])
  assert.deepEqual(words('type a=b', 'cmd'), ['type', 'a', 'b'])
  assert.deepEqual(words('type a^,b', 'cmd'), ['type', 'a', 'b'])
  assert.deepEqual(words('type "a,b;c=d"', 'cmd'), ['type', 'a,b;c=d'])
  assert.deepEqual(words('type a,"b"', 'cmd'), ['type', 'a', 'b'])
  assert.deepEqual(ops('type a;b', 'cmd'), [])
  assert.deepEqual(ops('type a & type b', 'cmd'), ['&'])
  // Control: PowerShell keeps ; as a separator, and Bash keeps the comma, the semicolon and the equals.
  assert.deepEqual(ops('gc a;gc b', 'ps'), [';'])
  assert.deepEqual(words('cat a,b', 'bash'), ['cat', 'a,b'])
  assert.deepEqual(words('cat a=b', 'bash'), ['cat', 'a=b'])
  assert.deepEqual(ops('cat a;cat b', 'bash'), [';'])
})

test('pipelines: a parenthesis after a word of a PowerShell stage is an argument of that stage', () => {
  const texts = (src, flavor) => pipelines(parseShell(src, flavor)).map((p) => p.map((st) => st.words.map((w) => w.text)))
  // The group is its own pipeline (scanned as a command) and is mirrored into the stage, which goes on after ")".
  assert.deepEqual(texts("Get-Content ('a','b')", 'ps'), [[['Get-Content', 'a', 'b']], [['a', 'b']]])
  assert.deepEqual(texts("Get-Content ('a') -TotalCount 1", 'ps'), [[['Get-Content', 'a', '-TotalCount', '1']], [['a']]])
  assert.deepEqual(texts("Get-Content @('a','b') | Out-Null", 'ps'), [[['Get-Content', '@', 'a', 'b'], ['Out-Null']], [['a', 'b']]])
  assert.deepEqual(texts('Get-Content (Join-Path a b) c', 'ps'), [[['Get-Content', 'Join-Path', 'a', 'b', 'c']], [['Join-Path', 'a', 'b']]])
  // Nested groups reach the stage that owns them.
  assert.deepEqual(texts('f (g (h x))', 'ps')[0], [['f', 'g', 'h', 'x']])
  // A "(" that starts a stage is a grouping of commands, as before; so are { } blocks.
  assert.deepEqual(texts('(Get-Content a)', 'ps'), [[['Get-Content', 'a']]])
  assert.deepEqual(texts('1 | % { gc a }', 'ps'), [[['1'], ['%']], [['gc', 'a']]])
  assert.deepEqual(texts('if ($x) { gc a }', 'ps'), [[['if', '$x']], [['$x']], [['gc', 'a']]])
  // A redirect target in a group stays a target, and a "(" after one is no argument.
  assert.deepEqual(texts('gc a > (b)', 'ps'), [[['gc', 'a']], [['b']]])
  // Control: Bash and cmd keep a "(" as a pipeline break.
  assert.deepEqual(texts('echo (a)', 'bash'), [[['echo']], [['a']]])
  assert.deepEqual(texts('type (a)', 'cmd'), [[['type']], [['a']]])
})

test('pipelines: argument groups nest MAX_DEPTH deep, one more throws NestingLimit (PowerShell only)', () => {
  const chain = (n, flavor) => pipelines(parseShell('f (g '.repeat(n) + 'x' + ')'.repeat(n), flavor))
  assert.equal(MAX_DEPTH, 8)
  // At the limit the outermost stage holds every word, the innermost included.
  const at = chain(MAX_DEPTH, 'ps')
  assert.deepEqual(at[0][0].words.map((w) => w.text), [...Array(MAX_DEPTH).fill(['f', 'g']).flat(), 'x'])
  // Past it the parse throws instead of dropping words from the outer stage.
  assert.throws(() => chain(MAX_DEPTH + 1, 'ps'), NestingLimit)
  assert.throws(() => chain(40, 'ps'), NestingLimit)
  // Control: Bash and cmd have no argument groups (a "(" is a pipeline break), so depth never throws.
  assert.doesNotThrow(() => chain(40, 'bash'))
  assert.doesNotThrow(() => chain(40, 'cmd'))
  // Control: siblings are not nested (the owner stack pops at each ")").
  assert.doesNotThrow(() => pipelines(parseShell('f ' + '(g x) '.repeat(40), 'ps')))
})

// gc (Write-Output (Write-Output ... 'path')): each group is an argument of the stage before it; on powershell.exe
// 5.1 this prints the file at every depth tried (8, 9, 10, 12), so every denied row below is a real read.
const nest = (n, p) => 'gc ' + '(Write-Output '.repeat(n) + `'${p}'` + ')'.repeat(n)

test('argument groups nested past the cap are denied, not skipped; at the cap they are scanned', () => {
  for (const [file, decoy] of TARGETS) {
    for (const n of [1, 5, 8]) {
      deny(run('PowerShell', nest(n, file)))
      allow(run('PowerShell', nest(n, decoy))) // control: the vault, not the nesting, makes the deny
    }
    for (const n of [9, 10, 12]) {
      const d = deny(run('PowerShell', nest(n, file)))
      assert.match(d.reason, /nesting limit \(8 levels\)/)
      assert.match(d.reason, /argument groups/)
    }
    // Pinned over-denial: the cap does not look at the path, so a decoy nested past it is denied too.
    deny(run('PowerShell', nest(9, decoy)))
    // Control: nine sibling groups are not nested; the decoy is allowed and the vault path still denied.
    const siblings = (p) => 'gc ' + `(Write-Output '${p}') `.repeat(12)
    allow(run('PowerShell', siblings(decoy)))
    deny(run('PowerShell', siblings(file)))
  }
})

test('env-guard: a nest past the cap falls back to the raw text (denies a named env file, allows the rest)', () => {
  for (const n of [8, 9, 12]) {
    deny(runEnv('PowerShell', nest(n, ENV)))
    // Control: the text with a decoy name is allowed at every depth, so the deny above is the name, and a crash
    // (which also denies) is not what the fallback returned.
    allow(runEnv('PowerShell', nest(n, '.' + 'envy')))
    allow(runEnv('PowerShell', nest(n, ENV + '.example')))
  }
})
