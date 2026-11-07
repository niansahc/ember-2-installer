// .claude/hooks/hook-utils.cjs
//
// Helpers shared by the PreToolUse guards in this directory (env-guard.cjs,
// vault-guard.cjs), so each rule has one definition:
//
//   - projectDir(): the project root every guard anchors on.
//   - absolutePath(): one resolution of a path string an agent wrote in a
//     tool call (Git Bash, WSL, device-prefix and drive-relative forms, ~).
//   - commandName(): one "bare command name" rule.
//   - fnmatch(), bracketEnd(), WILDCARD: one glob grammar (*, ?, [...],
//     [!...]) with Python fnmatchcase semantics.
//   - parseShell(), pipelines(): one quote- and escape-aware shell parser
//     (words, operators, substitutions, heredocs).
//   - SHELLS, PS_EVAL, nestedCommand(): one table of programs that run a
//     command line (PS_EVAL: iex and Invoke-Expression, followed by
//     nestedCommand but not shell words for env-guard). The 'cmd' flavor of
//     parseShell is cmd.exe: no # comments, ^ escapes, ' is not a quote.
//   - commandStart(): one rule for the command a stage runs (keywords,
//     VAR=value and wrappers skipped).
//   - proseValues(), proseFlagPrefix(): one rule for git/gh message values.
//   - parseOrNull(), cutSpans(): parse a command, tolerating the nesting
//     limit, and cut parsed spans out of its text.
//   - literalHeredocs(), dropLiteralHeredocs(): one rule for heredoc bodies
//     that no command runs.
//   - toolCall(), SHELL_TOOLS: the usable part of a payload.
//   - runHook(): stdin -> evaluate -> a deny on stdout, always exit 0, and
//     fail closed: an exception inside the check is a deny that names only
//     the guard and the exception type (its message can carry a vault path).
//
// Port of ember-2 .claude/hooks/hook_utils.py (#293-#296).

'use strict'

const os = require('os')
const path = require('path')

const IS_WIN = process.platform === 'win32'

// The checkout this file lives in (.claude/hooks/hook-utils.cjs -> root).
const CHECKOUT_ROOT = path.resolve(__dirname, '..', '..')

/** CLAUDE_PROJECT_DIR, falling back to this checkout (a manual run). */
function projectDir() {
  return process.env.CLAUDE_PROJECT_DIR || CHECKOUT_ROOT
}

/** `~` and `~/x` against the home directory; other strings unchanged. */
function expandUser(p) {
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) return os.homedir() + p.slice(1)
  return p
}

/**
 * `p` as an absolute, lexically normalised path, for every form an agent
 * might write. Relative forms resolve against `base`.
 */
function absolutePath(p, base) {
  // \\?\C:\x and \\.\C:\x, matched after backslashes become slashes.
  let s = expandUser(String(p).replace(/\\/g, '/').replace(/^\/\/[?.]\//, ''))
  if (IS_WIN) {
    // Git Bash /c/x and WSL /mnt/c/x.
    const m = s.match(/^\/(?:mnt\/)?([a-zA-Z])(?=\/|$)/)
    if (m) s = `${m[1]}:/${s.slice(m[0].length)}`
  }
  // On Windows, path.resolve resolves drive-relative C:x against `base` when
  // it is on the same drive (the only drive whose cwd the hook knows).
  // Elsewhere C:x is an ordinary relative name.
  return path.resolve(base, s)
}

/**
 * A command word reduced to a bare lowercase name, so an absolute-path or
 * Windows-suffixed utility (C:\Windows\System32\more.com, /usr/bin/cat,
 * bash.exe) matches its plain name.
 */
function commandName(word) {
  const name = String(word).replace(/\\/g, '/').split('/').pop().toLowerCase()
  return name.endsWith('.exe') || name.endsWith('.com') ? name.slice(0, -4) : name
}

// ---------------------------------------------------------------------------
// Globs
// ---------------------------------------------------------------------------

// A glob wildcard: `*`, `?`, or the start of a `[...]` set.
const WILDCARD = /[*?[]/

/**
 * The index of the `]` closing the set that opens at `pattern[i]` (a `[`),
 * or -1 when it is unclosed (then the `[` is a literal). A leading `!` and
 * a `]` right after it (or after `[`) belong to the set, as in fnmatch.
 */
function bracketEnd(pattern, i) {
  let j = i + 1
  if (pattern[j] === '!') j++
  if (pattern[j] === ']') j++
  return pattern.indexOf(']', j)
}

/**
 * A set body (the text between `[` and `]`) as a regex. A reversed range
 * (`z-a`) is empty and is dropped, as Python 3.9+ fnmatch drops it, so
 * `[z-ae]` still matches `e`. A set left empty matches nothing; a negated
 * one left empty matches any character.
 */
function setRegex(body) {
  const negate = body[0] === '!'
  const items = negate ? body.slice(1) : body
  const esc = (ch) => ('\\^-[]'.includes(ch) ? `\\${ch}` : ch)
  let out = ''
  for (let k = 0; k < items.length; ) {
    if (items[k + 1] === '-' && k + 2 < items.length) {
      if (items[k] <= items[k + 2]) out += `${esc(items[k])}-${esc(items[k + 2])}`
      k += 3
    } else {
      out += esc(items[k])
      k++
    }
  }
  if (!out) return negate ? '[\\s\\S]' : '(?!)'
  return `[${negate ? '^' : ''}${out}]`
}

const fnmatchCache = new Map()

/** Python fnmatch.fnmatchcase: `*`, `?`, `[...]`, `[!...]`; an unclosed `[` is literal. */
function fnmatch(name, pattern) {
  let re = fnmatchCache.get(pattern)
  if (!re) {
    let out = ''
    let i = 0
    while (i < pattern.length) {
      const c = pattern[i++]
      if (c === '*') out += '[\\s\\S]*'
      else if (c === '?') out += '[\\s\\S]'
      else if (c === '[') {
        const end = bracketEnd(pattern, i - 1)
        if (end < 0) {
          out += '\\['
        } else {
          out += setRegex(pattern.slice(i, end))
          i = end + 1
        }
      } else out += c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
    }
    re = new RegExp(`^${out}$`)
    fnmatchCache.set(pattern, re)
  }
  return re.test(name)
}

// ---------------------------------------------------------------------------
// Shell parsing
// ---------------------------------------------------------------------------

// Nesting deeper than this (substitutions, nested shells, heredoc bodies) is
// not followed: parsing throws NestingLimit. vault-guard denies such a
// command and says so; env-guard scans its whole text instead.
const MAX_DEPTH = 8
class NestingLimit extends Error {}

// cmd argument delimiters, besides blanks: TYPE, DIR and the other internal commands
// read `type a,V`, `type a;V` and `type a=V` as the arguments a and V.
const CMD_DELIMITERS = ',;='

// Characters that end a word and stand as operators (with `(` and `)`). In
// Bash, { and } are operators only as a word of their own (see parseShell);
// PowerShell and cmd keep them as operators.
const OPERATORS = ';<>|&{}'

/**
 * A shell command parsed for both guards: { tokens, bash, ps }, each token an
 * operator string, a word { text, bare, live, parts, subs, start, end, open },
 * or { heredoc } where
 * a heredoc operator stands. `subs` are the parsed bodies of the
 * substitutions inside the word: $(...), and in Bash `...`, <(...) and
 * >(...). `bare` is the part of `text` read outside quotes, `start`/`end`
 * the word's offsets in `command` (quotes included), and `open` true when
 * the word ends inside a quote left open.
 *
 * The one quote and escape scanner:
 *   - Bash: '...' is literal; inside "..." a backslash escapes only $ ` " \
 *     and a newline, and $(...) and `...` still run; outside quotes \x is a
 *     literal x and a backslash-newline joins lines.
 *   - PowerShell: '...' is literal; the escape character is the backtick;
 *     $(...) is a subexpression, inside "..." too. A here-string opens with
 *     @' or @" at a word start or after `=` ($x=@', @{a=@'), the rest of
 *     that line blank, and closes at '@ or "@ at the start of a line:
 *     @'...'@ is literal like '...' (a quote inside does not close it),
 *     @"..."@ is read like "...".
 *   - A literal backslash becomes `/`, so a Windows path stays a path.
 *   - A quote left open runs to the end of the command: its text is still
 *     scanned.
 *   - Bash: { and } are group operators only as a word of their own
 *     ({ cmd; }); inside a word they are text (cat {a,b}), read by expandBraces.
 *   - word.live marks each char of text: 1 where Bash may read it as syntax,
 *     0 where it is quoted, escaped or inside ${...}.
 *   - Comma lists: in PowerShell an unquoted comma ends a word, as a space does
 *     (Get-Content a,V reads both: an array argument; "a,V", 'a,V' and a`,V are
 *     one name); in cmd an unquoted , ; or = ends a word, a caret-escaped one
 *     too (type a,V and type a;V read both; ; is not a command separator in cmd).
 *     Bash keeps the comma: cat a,V is one file name.
 *   - A newline is the `;` operator; `#` at a word start begins a comment.
 *   - PowerShell: `<# ... #>` is a block comment ending at the first `#>`;
 *     unterminated, the text after `<#` is scanned as code.
 *   - word.parts lists a word's text by the quote it was read in:
 *     [{ text, quote }], quote null, ' or ".
 *
 * A heredoc (Bash) is { quoted, delimiter, body, subs, start, end,
 * terminated }: `body` is the raw text between the operator line and the
 * terminator line, `start`/`end` its offsets in `command` (`end` past the
 * terminator line), `quoted` true when the delimiter word has any quoting
 * (<<'EOF', <<"EOF", <<\EOF), and `subs` the substitutions Bash runs in an
 * unquoted body (quotes are not special there). With no terminator line the
 * body runs to the end of the command and `terminated` is false.
 */
function parseShell(command, flavor, depth = 0) {
  const s = command
  const bash = flavor === 'bash'
  const cmd = flavor === 'cmd'
  const ps = !bash && !cmd
  let i = 0

  /** The heredoc operator whose `<<` ends at s[i], or null when no delimiter word follows. */
  function heredocOperator() {
    let j = i
    const strip = s[j] === '-'
    if (strip) j++
    while (s[j] === ' ' || s[j] === '\t') j++
    let delimiter = ''
    let quoted = false
    while (j < s.length && !/[\s;&|<>()]/.test(s[j])) {
      const c = s[j]
      if (c === "'" || c === '"') {
        const end = s.indexOf(c, j + 1)
        if (end < 0) return null
        delimiter += s.slice(j + 1, end)
        quoted = true
        j = end + 1
      } else if (c === '\\') {
        delimiter += s[j + 1] || ''
        quoted = true
        j += 2
      } else {
        delimiter += c
        j++
      }
    }
    if (!delimiter) return null
    // A trailing backslash steps j past the end; keep offsets inside s.
    i = Math.min(j, s.length)
    return { quoted, strip, delimiter, body: '', subs: [], start: i, end: i, terminated: false }
  }

  /** True when only blanks stand between s[j] and the next newline: a PowerShell here-string opener. */
  function hereStringOpens(j) {
    while (s[j] === ' ' || s[j] === '\t' || s[j] === '\r') j++
    return s[j] === '\n'
  }

  /** The bodies of `heredocs`, one after another from s[i] (the line after the operator). */
  function readBodies(heredocs, level) {
    for (const h of heredocs) {
      h.start = i
      let bodyEnd = s.length
      let next = s.length
      for (let line = i; line < s.length; ) {
        const nl = s.indexOf('\n', line)
        let text = s.slice(line, nl < 0 ? s.length : nl).replace(/\r$/, '')
        if (h.strip) text = text.replace(/^\t+/, '')
        if (text === h.delimiter) {
          h.terminated = true
          bodyEnd = line
          next = nl < 0 ? s.length : nl + 1
          break
        }
        if (nl < 0) break
        line = nl + 1
      }
      h.body = s.slice(h.start, bodyEnd)
      h.end = next
      // Bash runs $(...) and `...` in an unquoted body; quotes there are text.
      for (let j = h.start; !h.quoted && j < bodyEnd; j++) {
        if (s[j] === '\\') j++
        else if ((s[j] === '$' && s[j + 1] === '(') || s[j] === '`') {
          i = s[j] === '`' ? j + 1 : j + 2
          h.subs.push(script(level + 1, s[j] === '`' ? '`' : ')', s[i] === '('))
          j = i - 1
        }
      }
      i = next
    }
  }

  // One script level: the whole command, or a substitution body ending at
  // `close` (')' or '`'). `arith`: a $(( )) body, where << is a shift.
  function script(level, close, arith) {
    if (level > MAX_DEPTH) throw new NestingLimit()
    const tokens = []
    let word = null
    let quote = null
    let parens = 0
    let pending = []
    const cur = () => (word ||= { text: '', bare: '', live: '', parts: [], subs: [], start: i })
    // Text added to the word, recorded in word.parts under the quote it was read in.
    // word.live marks each char of text: 1 when Bash may read it as expansion syntax
    // (unquoted, unescaped, outside ${...}), 0 when literal.
    const addText = (w, t, literal = false) => {
      const q = quote === null ? null : quote[quote.length - 1]
      const last = w.parts[w.parts.length - 1]
      if (last && last.quote === q) last.text += t
      else w.parts.push({ text: t, quote: q })
      w.text += t
      w.live += (q === null && !literal ? '1' : '0').repeat(t.length)
      if (quote === null) w.bare += t
    }
    const flush = () => {
      if (word) {
        word.end = i
        word.open = quote !== null
        tokens.push(word)
      }
      word = null
    }
    const append = (ch, literal = false) => {
      const w = cur()
      addText(w, ch === '\\' ? '/' : ch, literal)
    }
    const sub = (skip, end) => {
      const isArith = end === ')' && s[i + skip] === '('
      const w = cur()
      i += skip
      w.subs.push(script(level + 1, end, isArith))
    }
    // True when s[i] closes `quote`: the quote character, or for a
    // here-string its closing pair at the start of a line.
    const closes = () =>
      quote.length === 1 ? s[i] === quote : s[i] === quote[1] && s[i + 1] === '@' && s[i - 1] === '\n'
    // One character inside `quote`: the closing one ends it.
    const quoted = () => {
      if (closes()) {
        i += quote.length
        quote = null
      } else {
        append(s[i])
        i++
      }
    }
    while (i < s.length) {
      const c = s[i]
      const n = s[i + 1]
      if (quote === "'" || quote === "@'") {
        quoted()
      } else if (bash && c === '\\') {
        if (n === '\n') i += 2
        else if (n === undefined || (quote === '"' && !'$`"\\'.includes(n))) {
          append(c)
          i++
        } else {
          append(n, true)
          i += 2
        }
      } else if (ps && c === '`' && n !== undefined) {
        append(n)
        i += 2
      } else if (cmd && c === '^' && quote === null && n !== undefined) {
        // cmd escape: ^x is a literal x (e^cho runs echo). A caret-escaped , ; or =
        // is still an argument delimiter to the command (type a^,V reads both).
        if (CMD_DELIMITERS.includes(n)) flush()
        else append(n)
        i += 2
      } else if (close === '`' && c === '`') {
        flush()
        i++
        break
      } else if (c === '$' && n === '(') {
        sub(2, ')')
      } else if (bash && c === '`') {
        sub(1, '`')
      } else if (quote === '"' || quote === '@"') {
        quoted()
      } else if (ps && c === '<' && n === '#') {
        if (word === null) {
          // PowerShell block comment, only at a token start: whitespace up to
          // the first #> (no nesting; quotes inside do not matter). Unterminated
          // is a parse error that runs nothing; the rest is scanned as live
          // code, so it can only over-deny.
          const close = s.indexOf('#>', i + 2)
          i = close < 0 ? i + 2 : close + 2
        } else {
          // Inside a word (a<# b) the pair is ordinary text.
          append(c)
          i++
        }
      } else if (
        ps &&
        c === '@' &&
        (n === "'" || n === '"') &&
        (word === null || word.text.endsWith('=')) &&
        hereStringOpens(i + 2)
      ) {
        cur()
        quote = c + n
        i = s.indexOf('\n', i) + 1
      } else if (c === '"' || (c === "'" && !cmd)) {
        quote = c
        cur()
        i++
      } else if (close === ')' && c === ')' && parens === 0) {
        flush()
        i++
        break
      } else if ((ps && c === ',') || (cmd && CMD_DELIMITERS.includes(c))) {
        // A comma list (PowerShell) or an argument delimiter (cmd): the
        // elements are words of their own. Quoted ones never get here.
        flush()
        i++
      } else if (c === '\n') {
        flush()
        tokens.push(';')
        i++
        if (pending.length) readBodies(pending, level)
        pending = []
      } else if (c === ' ' || c === '\t' || c === '\r') {
        flush()
        i++
      } else if (c === '#' && word === null && !cmd) {
        const nl = s.indexOf('\n', i)
        i = nl < 0 ? s.length : nl
      } else if (c === '$' && n === '{') {
        const end = s.indexOf('}', i)
        const stop = end < 0 ? s.length : end + 1
        const w = cur()
        addText(w, s.slice(i, stop).replace(/\\/g, '/'), true)
        i = stop
      } else if (bash && (c === '<' || c === '>') && n === '(') {
        // Process substitution: a word of its own (a /dev/fd name).
        flush()
        sub(2, ')')
        flush()
      } else if (c === '(' || c === ')') {
        flush()
        tokens.push(c)
        parens += c === '(' ? 1 : -1
        i++
      } else if (bash && (c === '{' || c === '}') && !(word === null && /^[\s;&|()]?$/.test(s[i + 1] ?? ''))) {
        // Bash: a brace is group syntax only as a word of its own ({ cmd; });
        // anywhere else it is word text, and brace expansion reads it ({a,b}).
        append(c)
        i++
      } else if (OPERATORS.includes(c)) {
        flush()
        let j = i
        while (j < s.length && OPERATORS.includes(s[j])) j++
        const op = s.slice(i, j)
        i = j
        const heredoc = bash && !arith && op === '<<' ? heredocOperator() : null
        if (heredoc) {
          pending.push(heredoc)
          tokens.push({ heredoc })
        } else {
          tokens.push(op)
        }
      } else {
        append(c)
        i++
      }
    }
    flush()
    // An operator with no line after it inside this level has no body.
    return { tokens, bash, ps }
  }

  return script(depth, null, false)
}

/**
 * The pipelines of a parsed script: lists of pipe stages, each stage
 * { words, redirs, heredocs } (words and redirection targets as parsed
 * words). Pipelines end at ; && || & newline and at ( ) { } (a group runs
 * its own commands).
 *
 * PowerShell: a "(" that follows a word of the stage is an argument
 * (Get-Content ('a','V'), @('a','V')): its words stay a pipeline of their own,
 * scanned as commands, and are also words of that stage, which goes on after
 * the ")" (Get-Content ('V') -TotalCount 1). A "(" that starts a stage, and
 * { } blocks, are groups of commands only. Empty stages and pipelines are left
 * out.
 */
function pipelines(script) {
  const stage = () => ({ words: [], redirs: [], heredocs: [] })
  const out = [[stage()]]
  let pipeline = out[0]
  let st = pipeline[0]
  let redirect = false
  let afterWord = false
  const open = [] // one entry per open "(": its owner stage { pipeline, st } or null
  const owners = [] // the non-null entries of `open`
  const begin = () => {
    pipeline = [stage()]
    st = pipeline[0]
    out.push(pipeline)
  }
  for (const token of script.tokens) {
    if (typeof token !== 'string') {
      if (token.heredoc) {
        st.heredocs.push(token.heredoc)
      } else {
        if (redirect) {
          st.redirs.push(token)
        } else {
          st.words.push(token)
          // The nearest MAX_DEPTH argument groups: bounded work for deep nesting.
          for (let k = Math.max(0, owners.length - MAX_DEPTH); k < owners.length; k++) owners[k].st.words.push(token)
        }
        redirect = false
        afterWord = true
      }
    } else if (token === '|' || token === '|&') {
      st = stage()
      pipeline.push(st)
      afterWord = false
    } else if (token === '(') {
      const owner = script.ps && afterWord && !redirect ? { pipeline, st } : null
      open.push(owner)
      if (owner) owners.push(owner)
      begin()
      redirect = false
      afterWord = false
    } else if (token === ')') {
      const owner = open.pop()
      if (owner) {
        owners.pop()
        pipeline = owner.pipeline
        st = owner.st
        afterWord = true
      } else {
        begin()
        afterWord = false
      }
      redirect = false
    } else if (/[;(){}]/.test(token) || token === '&&' || token === '||' || token === '&') {
      begin()
      redirect = false
      afterWord = false
    } else if (/[<>]/.test(token)) {
      redirect = true
      afterWord = false
    }
  }
  return out
    .map((p) => p.filter((st) => st.words.length || st.redirs.length || st.heredocs.length))
    .filter((p) => p.length)
}

// ---------------------------------------------------------------------------
// Bash brace expansion
// ---------------------------------------------------------------------------

// Caps, so a hostile or accidental {1..99999999} costs nothing: words from one
// brace word, words in one command stage, and brace expressions expanded in
// one word. Past a cap the expansion is not attempted (BraceOverflow).
const MAX_BRACE_WORD = 256
const MAX_BRACE_STAGE = 1024
const MAX_BRACE_STEPS = 32
// Live { in one word. The scan for each is linear in the word, so this bounds
// the work (a word of 16384 { took 0.65 s, 65536 took 9.6 s before the cap).
const MAX_LIVE_BRACES = 256
// A Bash or PowerShell command longer than this is denied by both guards
// before it is parsed: a PreToolUse hook that times out does not block the
// call, and parse time grows faster than length (a chain of 16384 characters
// of pipes or $() takes about 0.6 s, 64 K takes 2 s).
const MAX_COMMAND_CHARS = 16384

class BraceOverflow extends Error {}

const RANGE = /^([+-]?\d+|[A-Za-z])\.\.([+-]?\d+|[A-Za-z])(?:\.\.([+-]?\d+))?$/

/** True when `body` is a {x..y[..step]} body: two integers or two letters. */
function isRange(body) {
  const m = body.match(RANGE)
  return !!m && /^[+-]?\d/.test(m[1]) === /^[+-]?\d/.test(m[2])
}

/**
 * The index of the live } closing the live { at `p`, or -1. As in Bash, a
 * depth-0 } closes only after a depth-0 comma or when the body so far is a
 * range; any other depth-0 } is text and the scan goes on ({a},b} is the
 * words "a}" and "b").
 */
function closingBrace(text, live, p) {
  let depth = 0
  let commas = 0
  for (let j = p + 1; j < text.length; j++) {
    if (live[j] !== '1') continue
    const c = text[j]
    if (c === '{') depth++
    else if (c === '}') {
      if (depth > 0) depth--
      else if (commas > 0 || (!live.slice(p + 1, j).includes('0') && isRange(text.slice(p + 1, j)))) return j
    } else if (c === ',' && depth === 0) commas++
  }
  return -1
}

/** The live top-level commas strictly between `p` and `q`. */
function topLevelCommas(text, live, p, q) {
  const cuts = []
  let depth = 0
  for (let j = p + 1; j < q; j++) {
    if (live[j] !== '1') continue
    if (text[j] === '{') depth++
    else if (text[j] === '}') depth = Math.max(0, depth - 1)
    else if (text[j] === ',' && depth === 0) cuts.push(j)
  }
  return cuts
}

/** The words of a {x..y[..step]} body (two integers or two letters), or null. Counted before generated. */
function rangeWords(body) {
  if (!isRange(body)) return null
  const [, a, b, inc] = body.match(RANGE)
  const numeric = /^[+-]?\d/.test(a)
  const step = inc === undefined ? 1 : Math.abs(Number(inc)) || 1 // step 0 is 1
  const x = numeric ? Number(a) : a.charCodeAt(0)
  const y = numeric ? Number(b) : b.charCodeAt(0)
  const count = Math.floor(Math.abs(y - x) / step) + 1
  if (count > MAX_BRACE_WORD) throw new BraceOverflow()
  const digits = (v) => v.replace(/^[+-]/, '').length
  const pad = numeric && (/^[+-]?0\d/.test(a) || /^[+-]?0\d/.test(b)) ? Math.max(digits(a), digits(b)) : 0
  const out = []
  for (let k = 0, v = x; k < count; k++, v += y >= x ? step : -step) {
    if (!numeric) out.push(String.fromCharCode(v))
    else out.push(pad ? (v < 0 ? '-' : '') + String(Math.abs(v)).padStart(pad, '0') : String(v))
  }
  return out
}

function expandFrom(text, live, steps) {
  if (steps > MAX_BRACE_STEPS) throw new BraceOverflow()
  for (let p = 0; p < text.length; p++) {
    if (live[p] !== '1' || text[p] !== '{') continue
    if (p === 0 && text[1] === '}' && live[1] === '1') continue // a leading {} is text
    const q = closingBrace(text, live, p)
    if (q < 0) continue
    const cuts = topLevelCommas(text, live, p, q)
    let parts // [replacement text, replacement live]
    if (cuts.length) {
      const bounds = [p, ...cuts, q]
      parts = bounds.slice(0, -1).map((from, k) => [text.slice(from + 1, bounds[k + 1]), live.slice(from + 1, bounds[k + 1])])
    } else {
      const seq = !live.slice(p + 1, q).includes('0') ? rangeWords(text.slice(p + 1, q)) : null
      if (!seq) continue
      parts = seq.map((v) => [v, '0'.repeat(v.length)])
    }
    const out = []
    for (const [t, l] of parts) {
      out.push(...expandFrom(text.slice(0, p) + t + text.slice(q + 1), live.slice(0, p) + l + live.slice(q + 1), steps + 1))
      if (out.length > MAX_BRACE_WORD) throw new BraceOverflow()
    }
    return out
  }
  return [text]
}

/**
 * The words Bash makes of one word by brace expansion: {a,b}, nested lists,
 * prefix and suffix, products, and {x..y[..step]} ranges; `live` is
 * word.live (1 where a char may act as syntax). A quoted, escaped or ${...}
 * brace, an unterminated one, {a} and an invalid range stay text. An empty
 * result is dropped unless the word had a literal char (Bash removes an
 * empty unquoted word). Throws BraceOverflow past the caps (words from the
 * word, expansion steps, live braces in the word).
 */
function expandBraces(text, live) {
  if (!text.includes('{')) return text ? [text] : []
  let braces = 0
  for (let j = 0; j < text.length; j++) {
    if (live[j] === '1' && text[j] === '{' && ++braces > MAX_LIVE_BRACES) throw new BraceOverflow()
  }
  const out = expandFrom(text, live, 0)
  return live.includes('0') ? out : out.filter(Boolean)
}

// ---------------------------------------------------------------------------
// Programs that run a command line
// ---------------------------------------------------------------------------

const POSIX_SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh'])
const PS_SHELLS = new Set(['pwsh', 'powershell'])
// Every program nestedCommand() follows.
const PS_EVAL = new Set(['iex', 'invoke-expression'])
// Programs that run a command line as a nested shell (PS_EVAL is separate: it
// is followed by nestedCommand but is not a shell word for env-guard).
const SHELLS = new Set([...POSIX_SHELLS, ...PS_SHELLS, 'cmd', 'eval', 'wsl'])
// wsl options that take a separate value.
const WSL_VALUE_FLAGS = new Set(['-d', '--distribution', '-u', '--user', '--cd', '--shell-type', '--distribution-id'])

/** The value words a POSIX shell option word takes: one per -o/-O in a cluster (-o x, -eo x, +O x). */
function optionValues(word) {
  return word.startsWith('--') ? 0 : (word.match(/[oO]/g) || []).length
}

/**
 * The words after a -Command flag of pwsh/powershell/iex, or null without one.
 * The flag is any prefix of -Command (-c, -com...), with the value either the
 * next words or joined by a colon (-Command:"line").
 */
function psCommandArg(args) {
  for (let i = 0; i < args.length; i++) {
    const colon = args[i].indexOf(':')
    const flag = (colon < 0 ? args[i] : args[i].slice(0, colon)).toLowerCase()
    if (flag.length >= 2 && '-command'.startsWith(flag)) {
      const value = colon < 0 ? '' : args[i].slice(colon + 1)
      return [...(value ? [value] : []), ...args.slice(i + 1)]
    }
  }
  return null
}

/**
 * The command line `runner` (a commandName) runs from `args`, as
 * { command, flavor }, or null: POSIX shells -c [options] [--|-|+] <line>
 * (option words after -c are skipped, with the values of -o/-O; a lone -
 * or + ends them like --);
 * pwsh/powershell -Command <line...> (powershell also takes bare words);
 * iex / Invoke-Expression [-Command] <line>; cmd /c|/k <line...> (flavor
 * 'cmd': no # comments, ^ escapes, ' is not a quote); eval <line...>; wsl [options] [--|-e|--exec]
 * <command...>.
 */
function nestedCommand(runner, args) {
  if (POSIX_SHELLS.has(runner)) {
    const i = args.findIndex((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a))
    if (i < 0) return null
    let k = i + 1 + optionValues(args[i])
    while (k < args.length && /^[-+]./.test(args[k]) && args[k] !== '--') k += 1 + optionValues(args[k])
    if (args[k] === '--' || args[k] === '-' || args[k] === '+') k++
    return k < args.length ? { command: args[k], flavor: 'bash' } : null
  }
  if (PS_SHELLS.has(runner)) {
    const rest = psCommandArg(args) ?? (runner === 'powershell' ? args.filter((a) => !a.startsWith('-')) : [])
    return rest.length ? { command: rest.join(' '), flavor: 'ps' } : null
  }
  if (PS_EVAL.has(runner)) {
    // iex [-Command] <string>. A computed argument ($x, (expr)) is not known here.
    const rest = psCommandArg(args) ?? args
    return rest.length ? { command: rest.join(' '), flavor: 'ps' } : null
  }
  if (runner === 'cmd') {
    const i = args.findIndex((a) => /^\/[ck]$/i.test(a))
    return i >= 0 && i + 1 < args.length ? { command: args.slice(i + 1).join(' '), flavor: 'cmd' } : null
  }
  if (runner === 'eval') return args.length ? { command: args.join(' '), flavor: 'bash' } : null
  if (runner === 'wsl') {
    for (let i = 0; i < args.length; i++) {
      const a = args[i]
      let from = -1
      if (a === '--' || a === '-e' || a === '--exec') from = i + 1
      else if (WSL_VALUE_FLAGS.has(a)) i++
      else if (!a.startsWith('-')) from = i
      if (from >= 0) return from < args.length ? { command: args.slice(from).join(' '), flavor: 'bash' } : null
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Message values and literal heredocs
// ---------------------------------------------------------------------------

// Words that can open a stage before the command it runs.
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', '!'])
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
// Wrappers that run the next word as the command, with the flags of each
// that take a separate value.
const WRAPPERS = new Map([
  ['sudo', new Set(['-u', '-g', '-C', '-D', '-h', '-p', '-U', '-r', '-t'])],
  ['env', new Set(['-u', '-C', '-S'])],
  ['time', new Set(['-f', '-o'])],
  ['nice', new Set(['-n'])],
  ['nohup', new Set()],
])

/** The index in `words` of the command the stage runs: keywords, VAR=value and wrappers skipped. */
function commandStart(words) {
  let i = 0
  while (i < words.length) {
    const word = words[i]
    if (KEYWORDS.has(word) || ASSIGNMENT.test(word)) {
      i++
      continue
    }
    const valueFlags = WRAPPERS.get(commandName(word))
    if (!valueFlags) break
    i++
    while (i < words.length && (words[i].startsWith('-') || ASSIGNMENT.test(words[i]))) {
      i += valueFlags.has(words[i]) ? 2 : 1
    }
  }
  return i
}

// git/gh flags whose value is a message: prose, not a path.
const PROSE_FLAGS = ['-m', '-am', '--message', '--body', '--title', '--notes']

/** `--message=` when `text` is the --message=<value> form of a long message flag, else ''. */
function proseFlagPrefix(text) {
  const flag = PROSE_FLAGS.find((f) => f.startsWith('--') && text.startsWith(`${f}=`))
  return flag ? `${flag}=` : ''
}

/**
 * Indexes in `words` (texts of one stage) that hold a git/gh message value:
 * the word after a message flag, or a --flag=<value> word. The command is
 * found by commandStart, so FOO=1 git and sudo git count.
 */
function proseValues(words) {
  const out = new Set()
  const start = commandStart(words)
  const runner = commandName(words[start] || '')
  if (runner !== 'git' && runner !== 'gh') return out
  for (let k = start + 1; k < words.length; k++) {
    if (PROSE_FLAGS.includes(words[k])) out.add(k + 1)
    else if (proseFlagPrefix(words[k])) out.add(k)
  }
  return out
}

/** True when `args` pass `-` (stdin) to one of `flags`, as `-F -` or `--file=-`. */
function readsStdin(args, flags) {
  return args.some((a, k) => (flags.includes(a) && args[k + 1] === '-') || flags.some((f) => a === `${f}=-`))
}

/**
 * A stage at the top of the command (its output goes to the transcript)
 * that stores the text it receives and runs none of it: tee to a file,
 * git commit -F -, gh ... --body-file - (-F -).
 */
function storesInput(st) {
  if (st.words.some((w) => w.subs.length) || st.redirs.some((w) => w.subs.length)) return false
  const words = st.words.map((w) => w.text)
  const runner = commandName(words[0] || '')
  const args = words.slice(1)
  if (runner === 'tee') return args.some((a) => a && !a.startsWith('-'))
  if (runner === 'git') return args.includes('commit') && readsStdin(args, ['-F', '--file'])
  if (runner === 'gh') return readsStdin(args, ['-F', '--body-file'])
  return false
}

/** A lone `cat` (or `cat -`) with nothing else in the stage. */
function bareCat(st) {
  return (
    st.words.length > 0 &&
    commandName(st.words[0].text) === 'cat' &&
    st.words.every((w, k) => !w.subs.length && (k === 0 || w.text === '-')) &&
    !st.redirs.length
  )
}

/**
 * The heredocs in a parsed Bash script whose body is literal text that no
 * command runs or turns into arguments: a quoted delimiter, a terminator
 * line, and a known inert receiver, alone in its pipeline:
 *   - at the top of the command: tee to a file, git commit -F -,
 *     gh --body-file - (storesInput);
 *   - in a substitution that is a git/gh message value and holds nothing
 *     but that cat: git commit -m "$(cat <<'EOF' ... EOF)".
 * Every other receiver (an interpreter, a shell, xargs, a substitution used
 * as arguments, a pipe) keeps the body scanned.
 */
function literalHeredocs(script, context = 'top', out = new Set()) {
  const list = pipelines(script)
  for (const pipeline of list) {
    for (const st of pipeline) {
      const prose = proseValues(st.words.map((w) => w.text))
      st.words.forEach((w, k) => w.subs.forEach((sub) => literalHeredocs(sub, prose.has(k) ? 'prose' : 'args', out)))
      st.redirs.forEach((w) => w.subs.forEach((sub) => literalHeredocs(sub, 'args', out)))
    }
    if (pipeline.length !== 1) continue
    const [st] = pipeline
    const inert = context === 'top' ? storesInput(st) : context === 'prose' && list.length === 1 && bareCat(st)
    if (!inert) continue
    for (const h of st.heredocs) if (h.quoted && h.terminated) out.add(h)
  }
  return out
}

/** parseShell, or null when the command nests past MAX_DEPTH. */
function parseOrNull(command, flavor) {
  try {
    return parseShell(command, flavor)
  } catch (err) {
    if (err instanceof NestingLimit) return null
    throw err
  }
}

/** `command` with each { start, end } span in `spans` replaced by `filler`. */
function cutSpans(command, spans, filler = '') {
  let out = ''
  let at = 0
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    out += command.slice(at, span.start) + filler
    at = span.end
  }
  return out + command.slice(at)
}

/**
 * A Bash command with the literal heredoc bodies (literalHeredocs) and
 * their terminator lines cut out. Too deeply nested to parse: unchanged.
 */
function dropLiteralHeredocs(command) {
  const script = parseOrNull(command, 'bash')
  return script ? cutSpans(command, literalHeredocs(script)) : command
}

// ---------------------------------------------------------------------------
// Hook I/O
// ---------------------------------------------------------------------------

/** The PreToolUse deny decision the harness reads from stdout. */
function denial(reason) {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  })
}

/** The type of a thrown value, never its message. */
function errorType(err) {
  if (err && typeof err === 'object') {
    return (err.constructor && err.constructor.name) || 'Error'
  }
  return typeof err
}

/**
 * The fail-closed deny. A crashed hook exits non-zero, which the harness
 * treats as a non-blocking error and runs the call, so a crash is an allow.
 * Only the exception type is printed; its message can carry a vault path.
 */
function errorDenial(guard, err) {
  return denial(
    `${guard} could not complete its check (${errorType(err)}); denying ` +
      `rather than allowing an unchecked call. See .claude/hooks/${guard}.cjs.`,
  )
}

/**
 * One hook run over raw stdin. Returns { stdout, stderr }; never throws.
 *
 * An unparseable payload is allowed with a note: the harness always sends
 * JSON, and denying here would block every call and lock the session out
 * of fixing the hook. A payload with no usable input is allowed by
 * `evaluate` returning null. Anything thrown inside `evaluate` or `reason`
 * is a deny.
 */
function runHook(guard, raw, evaluate, reason) {
  let payload
  try {
    payload = JSON.parse(raw)
  } catch (err) {
    return { stdout: '', stderr: `[${guard}] unparseable hook payload, allowing (${errorType(err)})\n` }
  }
  const call = toolCall(payload)
  if (call && SHELL_TOOLS.has(call.tool) && typeof call.input.command === 'string' && call.input.command.length > MAX_COMMAND_CHARS) {
    return {
      stdout: denial(
        `${guard}: this command is ${call.input.command.length} characters, over the ${MAX_COMMAND_CHARS} limit, ` +
          `so it cannot be checked in time and is denied. Split it into smaller commands or write the ` +
          `content to a file. See .claude/hooks/${guard}.cjs.`,
      ),
      stderr: '',
    }
  }
  try {
    const target = evaluate(payload)
    return { stdout: target == null ? '' : denial(reason(target)), stderr: '' }
  } catch (err) {
    return { stdout: errorDenial(guard, err), stderr: '' }
  }
}

/** Read stdin, run, write. runHook never throws, so the exit code stays 0. */
function main(guard, evaluate, reason) {
  const chunks = []
  process.stdin.on('data', (c) => chunks.push(c))
  process.stdin.on('end', () => {
    const result = runHook(guard, Buffer.concat(chunks).toString('utf8'), evaluate, reason)
    process.stderr.write(result.stderr)
    process.stdout.write(result.stdout)
  })
}

const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])

/**
 * The usable part of a hook payload: { tool, input, cwd }, or null when
 * there is no tool_input object to check. `cwd` falls back to the hook
 * process cwd.
 */
function toolCall(payload) {
  if (!payload || typeof payload !== 'object') return null
  const input = payload.tool_input
  if (!input || typeof input !== 'object') return null
  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd()
  return { tool: payload.tool_name, input, cwd }
}

module.exports = {
  WILDCARD,
  SHELL_TOOLS,
  SHELLS,
  PS_EVAL,
  MAX_DEPTH,
  NestingLimit,
  BraceOverflow,
  MAX_BRACE_STAGE,
  MAX_BRACE_STEPS,
  MAX_BRACE_WORD,
  MAX_COMMAND_CHARS,
  MAX_LIVE_BRACES,
  expandBraces,
  projectDir,
  expandUser,
  absolutePath,
  commandName,
  bracketEnd,
  fnmatch,
  parseShell,
  pipelines,
  nestedCommand,
  commandStart,
  proseValues,
  proseFlagPrefix,
  literalHeredocs,
  dropLiteralHeredocs,
  parseOrNull,
  cutSpans,
  toolCall,
  runHook,
  main,
}
