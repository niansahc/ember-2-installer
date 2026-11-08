// vault-guard.cjs, Bash brace expansion: {a,V}, V/{x,y}, nested lists, ranges,
// products, the caps, and the quoting that keeps a brace from expanding.
// Run as a hook process against tmp fixtures; vault files hold synthetic text
// only.
//
// Every deny row has a control: the same command with one change, either the
// vault name swapped for a different one (so only the vault makes the
// difference) or the brace quoted (so only the expansion does).

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { liveVaultFixture, runGuard, call, deny, allow } = require('./helpers.cjs')
const { expandBraces, parseShell, BraceOverflow } = require('../../.claude/hooks/hook-utils.cjs')

const FX = liveVaultFixture()
test.after(() => FX.cleanup())
const ROOT = { cwd: FX.root }

const run = (tool, command) => runGuard('vault-guard', call(tool, { command }, ROOT), FX)

// Words as the tokenizer gives them to expandBraces: every char live.
const expand = (word) => expandBraces(word, '1'.repeat(word.length))

// [deny, control]: private_vault by name; the control names private_valve.
const NAME = [
  ['cat {a,private_vault/x.json}', 'cat {a,private_valve/x.json}'],
  ['cat {private_vault,x}/x.json', 'cat {private_valve,x}/x.json'],
  ['cat private_vault/{x,y}.json', 'cat private_valve/{x,y}.json'],
  ['cat p{riv,x}ate_vault/x', 'cat p{riv,x}ate_valve/x'],
  ['cat private_{vault,x}/x', 'cat private_{valve,x}/x'],
  ['cat {x,{y,private_vault}}/f', 'cat {x,{y,private_valve}}/f'],
  ['cat {a,b}/{c,private_vault}/f', 'cat {a,b}/{c,private_valve}/f'],
  ['cat private_vaul{s..u}/f', 'cat private_vaul{a..c}/f'],
  ['cat {1..3}/{a,private_vault}', 'cat {1..3}/{a,private_valve}'],
  ['cat {#,private_vault/x}', 'cat {#,private_valve/x}'],
  ['cat --file={a,private_vault/x}', 'cat --file={a,private_valve/x}'],
  ['rg KEY {ember-2-installer/src,private_vault}', 'rg KEY {ember-2-installer/src,ember-2/README.md}'],
  ['grep -r KEY {ember-2-installer/src,private_vault}', 'grep -r KEY {ember-2-installer/src,ember-2/README.md}'],
  ['ls {a,private_vault}', 'ls {a,private_valve}'],
  ['find {ember-2-installer/src,private_vault} -name x', 'find {ember-2-installer/src,ember-2/README.md} -name x'],
  ['echo x > {a,private_vault/x}', 'echo x > {a,private_valve/x}'],
  ['cat < {a,private_vault/x}', 'cat < {a,private_valve/x}'],
  ['{cat,echo} private_vault/x', '{cat,echo} private_valve/x'],
  ['sudo {cat,x} private_vault/x', 'sudo {cat,x} private_valve/x'],
  ['bash -c "cat {a,private_vault/x}"', 'bash -c "cat {a,private_valve/x}"'],
  ['eval "cat {a,private_vault/x}"', 'eval "cat {a,private_valve/x}"'],
  ['echo $(cat {a,private_vault/x})', 'echo $(cat {a,private_valve/x})'],
  ['cat <(cat {a,private_vault/x})', 'cat <(cat {a,private_valve/x})'],
  ['cat <<EOF\n$(cat {a,private_vault/x})\nEOF', 'cat <<EOF\n$(cat {a,private_valve/x})\nEOF'],
  ['{ cat {a,private_vault/x}; }', '{ cat {a,private_valve/x}; }'],
  ['cd . && cat {a,private_vault/x}', 'cd . && cat {a,private_valve/x}'],
  ['echo a | xargs cat {a,private_vault/x}', 'echo a | xargs cat {a,private_valve/x}'],
  // A } before the first comma is text in Bash ({a},b} is "a}" and "b"), so the list goes on.
  ['cat {a},private_vault/x}', 'cat {a},private_valve/x}'],
  ['cat {a}b,private_vault/x}', 'cat {a}b,private_valve/x}'],
  // The words a substitution prints are brace-expanded by the shell that runs it.
  ['cat $(echo private_{vault,x}/a)', 'cat $(echo private_{valve,x}/a)'],
  ['cat $(echo {a,private_vault/x})', 'cat $(echo {a,private_valve/x})'],
  ['cat < $(echo {a,private_vault/x})', 'cat < $(echo {a,private_valve/x})'],
  ['cat "$(echo private_{vault,x}/a)"', 'cat "$(echo private_{valve,x}/a)"'],
]

// [deny, control]: the configured vault (ember-2/vaults/live), reached by location.
const LOCATION = [
  ['cat {a,ember-2/vaults/live/a.json}', 'cat {a,ember-2/README.md}'],
  ['cat ember-2/vaults/{live,x}/a.json', 'cat ember-2/vaults/{other,x}/a.json'],
  ['cat ember-2/{vaults/live,x}/a.json', 'cat ember-2/{vaults/other,x}/a.json'],
  ['cat ember-2/vaults/li{ve,x}/a.json', 'cat ember-2/vaults/li{vx,x}/a.json'],
  ['cat ember-2/vaults/{kept,{live,x}}/a.json', 'cat ember-2/vaults/{kept,{other,x}}/a.json'],
  ['cat $(echo ember-2/vaults/li{ve,x}/a.json)', 'cat $(echo ember-2/vaults/li{vx,x}/a.json)'],
  ['cat < $(echo ember-2/vaults/li{ve,}/a.json)', 'cat < $(echo ember-2/vaults/li{vx,}/a.json)'],
  ['rg KEY {ember-2-installer/src,ember-2/vaults}', 'rg KEY {ember-2-installer/src,ember-2/README.md}'],
  ['ls {src,ember-2/vaults/live}', 'ls {src,ember-2/vaults/other}'],
  ['grep -r KEY {ember-2-installer/src,ember-2}', 'grep -r KEY {ember-2-installer/src,ember-2/README.md}'],
]

// [allow, deny control]: the brace is text (quoted or escaped, or the list is
// unterminated), so Bash reads one literal name. (${...} is in its own test.)
const LITERAL = [
  ['cat "{a,private_vault/x}"', 'cat {a,private_vault/x}'],
  ["cat '{a,private_vault/x}'", 'cat {a,private_vault/x}'],
  ['cat \\{a,private_vault/x}', 'cat {a,private_vault/x}'],
  ['cat {a,private_vault/x\\}', 'cat {a,private_vault/x}'],
  ['cat {a,private_vault/x', 'cat {a,private_vault/x}'],
  ['cat $(echo "private_{vault,x}/a")', 'cat $(echo private_{vault,x}/a)'],
]

test('brace expansion: each bypass denied, each control allowed (name rule)', async (t) => {
  for (const [form, control] of NAME) {
    await t.test(form, () => {
      deny(run('Bash', form))
      allow(run('Bash', control))
    })
  }
})

test('brace expansion: each bypass denied, each control allowed (location rule)', async (t) => {
  for (const [form, control] of LOCATION) {
    await t.test(form, () => {
      deny(run('Bash', form))
      allow(run('Bash', control))
    })
  }
})

test('brace expansion: quoted, escaped and unterminated braces do not expand', async (t) => {
  for (const [ok, control] of LITERAL) {
    await t.test(ok, () => {
      allow(run('Bash', ok))
      deny(run('Bash', control))
    })
  }
})

test('brace expansion: a brace inside ${...} is not brace syntax', () => {
  allow(run('Bash', 'cat ${x:-{a,private_vault/x}}')) // the known ${x:-path} limit, as before
  deny(run('Bash', 'cat ${x:-a}/{b,private_vault/x}'))
  allow(run('Bash', 'cat ${x:-a}/{b,private_valve/x}'))
})

test('caps: over the cap a reading stage is denied with its own reason; at the cap it is checked', () => {
  const over = deny(run('Bash', 'cat f{1..257}'))
  assert.match(over.reason, /brace expansion past the limit/)
  assert.doesNotMatch(over.reason, /nesting/)
  deny(run('Bash', 'cat {1..100000}'))
  deny(run('Bash', 'ls {1..99999999999}'))
  deny(run('Bash', 'cat {a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}')) // 512 from one word
  deny(run('Bash', `cat ${Array(5).fill('{1..250}').join(' ')} {1..250}`)) // 1500 words in one stage
  allow(run('Bash', 'cat f{1..256}')) // at the cap
  allow(run('Bash', `cat ${Array(4).fill('{1..250}').join(' ')}`)) // 1000 words in one stage
  // Printers are exempt: the name rule ignores their operands.
  allow(run('Bash', 'echo {1..100000}'))
  allow(run('Bash', 'printf %s {1..99999999999}'))
  // The cap does not hide a vault name that is within it.
  deny(run('Bash', 'cat f{1..256} private_vault/x'))
  deny(run('Bash', 'echo {1..100000} > private_vault/x'))
})

// Words a stage gains by expansion count against the stage cap; its plain words do not.
test('caps: the stage cap counts words added by expansion, not plain words', () => {
  const plain = (n) => Array.from({ length: n }, (_, i) => `f${i}`).join(' ')
  allow(run('Bash', `cat ${plain(1100)}`)) // 1100 plain words: no expansion, no cap
  allow(run('Bash', `git add ${plain(1100)}`))
  deny(run('Bash', `cat ${plain(1100)} private_vault/x`)) // still scanned
  // Exactly at the cap: 4 x 256 + 6 words, 1024 added; one more word over.
  const at = Array(4).fill('{1..256}').join(' ')
  allow(run('Bash', `cat ${at} {1..5}`))
  const over = deny(run('Bash', `cat ${at} {1..6}`))
  assert.match(over.reason, /brace expansion past the limit/)
  allow(run('Bash', `echo ${at} {1..6}`)) // a last-stage printer is exempt
})

test('caps: expansion steps and live braces in one word', () => {
  allow(run('Bash', `cat ${'{5..5}'.repeat(32)}`)) // 32 steps
  const steps = deny(run('Bash', `cat ${'{5..5}'.repeat(33)}`))
  assert.match(steps.reason, /32 expansion steps/)
  assert.match(steps.reason, /256 braces in one word/)
  allow(run('Bash', `cat ${'{'.repeat(256)}`)) // 256 live braces, no list
  deny(run('Bash', `cat ${'{'.repeat(257)}`))
  allow(run('Bash', `cat "${'{'.repeat(300)}"`)) // quoted braces are not live
  allow(run('Bash', `echo ${'{'.repeat(300)}`)) // a last-stage printer is exempt
  deny(run('Bash', `echo ${'{'.repeat(300)} | xargs cat`)) // its words feed a reader
  assert.throws(() => expand('{'.repeat(257)), BraceOverflow)
  assert.equal(expand('{'.repeat(256)).length, 1)
})

test('caps: an overflowing printer stage still cannot hide a read or a redirect target', () => {
  // Its words feed the next stage.
  deny(run('Bash', 'echo {1..300} ember-2/vaults/li{ve,x}/a.json | xargs cat'))
  deny(run('Bash', 'echo {1..300} | xargs cat'))
  allow(run('Bash', 'echo {1..300} ember-2/vaults/li{ve,x}/a.json')) // control: last stage
  // The redirect target is expanded on its own, whatever the words do.
  deny(run('Bash', 'echo {1..300} > private_vault/x'))
  deny(run('Bash', 'echo {1..300} > {private_vault/x,}'))
  allow(run('Bash', 'echo {1..300} > {private_valve/x,}'))
  // A redirect target past a cap is denied, even for a printer (control: under the cap it is checked).
  deny(run('Bash', 'echo hi > {1..300}'))
  allow(run('Bash', 'echo hi > {1..250}'))
  deny(run('Bash', `echo ${Array(4).fill('{1..256}').join(' ')} > {1..250}`)) // stage cap, targets included
  allow(run('Bash', `echo ${Array(4).fill('{1..256}').join(' ')} > x`))
  // The words a substitution prints, past the cap, are not checkable by a reader.
  deny(run('Bash', 'cat $(echo {1..300})'))
  allow(run('Bash', 'echo $(echo {1..300})')) // control: the outer stage is a printer
  deny(run('Bash', 'cat $(echo {1..300} private_vault/x)'))
  // A substitution that prints 1000 words is checked; one that prints 1245 is past the stage cap.
  allow(run('Bash', `cat $(echo ${Array(4).fill('{1..250}').join(' ')})`))
  deny(run('Bash', `cat $(echo ${Array(5).fill('{1..250}').join(' ')})`))
  // PowerShell has no brace expansion: the same text is not expanded there.
  allow(run('PowerShell', 'Get-Content $(echo private_{vault,x}/a)'))
  deny(run('Bash', 'cat $(echo private_{vault,x}/a)'))
})

test('expandBraces: the words Bash makes, from real bash', () => {
  for (const [word, words] of BASH) {
    assert.deepEqual(expand(word), words, word)
  }
  // Positive control for the "stays text" rows: an expanding word must differ from its input.
  const expanding = BASH.filter(([w, o]) => o.length !== 1 || o[0] !== w)
  assert.ok(expanding.length >= 35, `only ${expanding.length} rows expand`)
  assert.ok(BASH.some(([w, o]) => o.length === 1 && o[0] === w), 'no row stays text')
})

test('expandBraces: literal chars, caps, cost', () => {
  // live '0' chars never act as syntax.
  assert.deepEqual(expandBraces('{a,b}', '01110'), ['{a,b}'])
  assert.deepEqual(expandBraces('{a,b}', '11111'), ['a', 'b'])
  assert.deepEqual(expandBraces('x{a,b}', '011111'), ['xa', 'xb'])
  // Empty results are dropped only for an all-live word.
  assert.deepEqual(expandBraces('{a,}', '1111'), ['a'])
  assert.deepEqual(expandBraces('x{a,}', '01111'), ['xa', 'x'])
  assert.throws(() => expand('{1..257}'), BraceOverflow)
  assert.throws(() => expand('{1..99999999999}'), BraceOverflow)
  assert.throws(() => expand('{a..z}{a..z}{a..z}'), BraceOverflow)
  assert.throws(() => expand('{a,b}'.repeat(9)), BraceOverflow)
  assert.throws(() => expand('{a,'.repeat(40) + 'b' + '}'.repeat(40)), BraceOverflow)
  assert.equal(expand('{1..256}').length, 256)
  assert.throws(() => expand('{1..9}{1..9}{1..9}{1..9}{1..9}{1..9}{1..9}{1..9}{1..9}{1..9}'), BraceOverflow)
})

test('parseShell: a brace is a group operator only as a word of its own, in Bash', () => {
  const words = (src, flavor) => parseShell(src, flavor).tokens.filter((x) => typeof x !== 'string').map((x) => x.text)
  const ops = (src, flavor) => parseShell(src, flavor).tokens.filter((x) => typeof x === 'string')
  assert.deepEqual(words('cat {a,b}', 'bash'), ['cat', '{a,b}'])
  assert.deepEqual(words('cat x{a,b}y', 'bash'), ['cat', 'x{a,b}y'])
  assert.deepEqual(words('cat {a,b}/f', 'bash'), ['cat', '{a,b}/f'])
  assert.deepEqual(words('echo {#,x} {a,b}#z', 'bash'), ['echo', '{#,x}', '{a,b}#z'])
  assert.deepEqual(ops('{ cat a; }', 'bash'), ['{', ';', '}'])
  assert.deepEqual(words('{ cat a; }', 'bash'), ['cat', 'a'])
  assert.deepEqual(words('{ cat a;}', 'bash'), ['cat', 'a'])
  assert.deepEqual(words('{cat a;}', 'bash'), ['{cat', 'a']) // Bash: {cat is a command name
  assert.deepEqual(words('echo }', 'bash'), ['echo'])
  assert.deepEqual(words('x=$(echo {a,b})', 'bash'), ['x='])
  // PowerShell and cmd keep braces as operators ({cat a} is a scriptblock).
  assert.deepEqual(words('& {cat a}', 'ps'), ['cat', 'a'])
  assert.deepEqual(words('echo {a,b}', 'ps'), ['echo', 'a', 'b']) // an unquoted comma ends a word in PowerShell
  // word.live: 1 where a char can act as syntax, 0 where it is quoted, escaped or in ${...}.
  const live = (src) => parseShell(src, 'bash').tokens[0].live
  assert.equal(live('{a,b}'), '11111')
  assert.equal(live('"{a}"'), '000')
  assert.equal(live("'{a}'"), '000')
  assert.equal(live('\\{a}'), '011')
  assert.equal(live('x${y:-a}z'), '1' + '0'.repeat(7) + '1')
})

test('PowerShell and cmd have no brace expansion: the text is scanned as words, not expanded (verified on powershell.exe 5.1 and cmd)', () => {
  // PowerShell: {a,V} is a parse error and {V} a scriptblock argument; neither reads V. The body is
  // scanned as a command (a comma ends a word), so both are denied: an over-denial, as for {V}.
  deny(run('PowerShell', 'Get-Content {a,private_vault/x.json}'))
  deny(run('PowerShell', 'Get-Content {private_vault/x.json}')) // body scanned as a command
  // cmd: no expansion; the comma splits the argument, so {a and V} are looked up, not V (denied
  // all the same: the delimiter makes V} a word that names the vault).
  deny(run('PowerShell', 'cmd /c "type {a,private_vault\\x.json}"'))
  deny(run('PowerShell', 'cmd /c "type {private_vault\\x.json}"'))
  // Controls: the same text with a decoy name is allowed, so the vault name, not the braces, makes the deny.
  allow(run('PowerShell', 'Get-Content {a,private_valve/x.json}'))
  allow(run('PowerShell', 'Get-Content {private_valve/x.json}'))
  allow(run('PowerShell', 'cmd /c "type {a,private_valve\\x.json}"'))
  allow(run('PowerShell', 'cmd /c "type {private_valve\\x.json}"'))
  // Bash flavor of the same text is the bypass this file closes.
  deny(run('Bash', 'cat {a,private_vault/x.json}'))
})

// [word, the words real bash 5 prints for `printf '%s\n' <word>`], unquoted.
const BASH = [
  ["{a,b}", ["a","b"]],
  ["{a}", ["{a}"]],
  ["{a,}", ["a"]],
  ["{,a}", ["a"]],
  ["{a,,b}", ["a","b"]],
  ["{,}", []],
  ["x{a,b}y", ["xay","xby"]],
  ["x{a,b}y{c,d}z", ["xaycz","xaydz","xbycz","xbydz"]],
  ["{a,{b,c}}", ["a","b","c"]],
  ["{a,b{c,d}}e", ["ae","bce","bde"]],
  ["{{a,b},c}", ["a","b","c"]],
  ["{{a,b}}", ["{a}","{b}"]],
  ["{a}{b,c}", ["{a}b","{a}c"]],
  ["{a,b}{c}", ["a{c}","b{c}"]],
  ["{1..3}", ["1","2","3"]],
  ["{3..1}", ["3","2","1"]],
  ["{-2..2}", ["-2","-1","0","1","2"]],
  ["{01..03}", ["01","02","03"]],
  ["{1..10..4}", ["1","5","9"]],
  ["{10..1..3}", ["10","7","4","1"]],
  ["{a..e}", ["a","b","c","d","e"]],
  ["{e..a}", ["e","d","c","b","a"]],
  ["{a..e..2}", ["a","c","e"]],
  ["{1..3..0}", ["1","2","3"]],
  ["{1..a}", ["{1..a}"]],
  ["{a..1}", ["{a..1}"]],
  ["{1..}", ["{1..}"]],
  ["{..3}", ["{..3}"]],
  ["{1...3}", ["{1...3}"]],
  ["{1..3,x}", ["1..3","x"]],
  ["{x,1..3}", ["x","1..3"]],
  ["p{riv,x}ate_vault/a", ["private_vault/a","pxate_vault/a"]],
  ["{a,b", ["{a,b"]],
  ["a,b}", ["a,b}"]],
  ["}{a,b}", ["}a","}b"]],
  ["{{a,b}", ["{a","{b"]],
  ["{a,b}}", ["a}","b}"]],
  ["{a..c}{1..2}", ["a1","a2","b1","b2","c1","c2"]],
  ["{-1..-3}", ["-1","-2","-3"]],
  ["{001..3}", ["001","002","003"]],
  ["{1..03}", ["01","02","03"]],
  ["{+1..3}", ["1","2","3"]],
  ["{a,b..c}", ["a","b..c"]],
  ["{1..2}{a..b}{,x}", ["1a","1ax","1b","1bx","2a","2ax","2b","2bx"]],
  ["{,,}", []],
  ["{a,{,}}", ["a"]],
  ["a{{,}}b", ["a{}b","a{}b"]],
  ["{x,y}{1..2}", ["x1","x2","y1","y2"]],
  ["{a,b}#z", ["a#z","b#z"]],
  ["{#,x}", ["#","x"]],
  ["{5..5}", ["5"]],
  ["{a..a}", ["a"]],
  // A } before the first comma is text; a leading {} is text (rows from bash 4.4 and 5.0).
  ["{a},zz/x}", ["a}","zz/x"]],
  ["{a}b,x}", ["a}b","x"]],
  ["x{a},{p,y}", ["x{a},p","x{a},y"]],
  ["{0},..}", ["0}",".."]],
  ["{a},b}c", ["a}c","bc"]],
  ["{{a},b}", ["{a}","b"]],
  ["{a{}b},c}", ["a{}b}","c"]],
  ["{},a}", ["{},a}"]],
  ["x{},a}", ["x}","xa"]],
  ["{}{},}", ["{}}","{}"]],
  ["{}", ["{}"]],
]
// Known divergence, not tabled: a body that starts with `..` and holds a stray }
// ({..a},b} stays text in bash 4.4 and 5.0; expandBraces splits it). Found by an
// exhaustive differential run (alphabet { } , a . 1, lengths 1 to 6, 60986 words
// with 5000 random longer ones, both bashes): 6 mismatches, all of this form.
