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
//   - SHELLS, nestedCommand(): one table of programs that run a command line.
//   - PROSE_FLAGS, proseValues(): one rule for git/gh message values.
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

// Characters that end a word and stand as operators (with `(` and `)`).
const OPERATORS = ';<>|&{}'

/**
 * A shell command parsed for both guards: { tokens }, each token an operator
 * string, a word { text, subs }, or { heredoc } where a heredoc operator
 * stands. `subs` are the parsed bodies of the substitutions inside the word:
 * $(...), and in Bash `...`, <(...) and >(...).
 *
 * The one quote and escape scanner:
 *   - Bash: '...' is literal; inside "..." a backslash escapes only $ ` " \
 *     and a newline, and $(...) and `...` still run; outside quotes \x is a
 *     literal x and a backslash-newline joins lines.
 *   - PowerShell: '...' is literal; the escape character is the backtick;
 *     $(...) is a subexpression, inside "..." too.
 *   - A literal backslash becomes `/`, so a Windows path stays a path.
 *   - A quote left open runs to the end of the command: its text is still
 *     scanned.
 *   - A newline is the `;` operator; `#` at a word start begins a comment.
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
    i = j
    return { quoted, strip, delimiter, body: '', subs: [], start: i, end: i, terminated: false }
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
    const cur = () => (word ||= { text: '', subs: [] })
    const flush = () => {
      if (word) tokens.push(word)
      word = null
    }
    const append = (ch) => {
      cur().text += ch === '\\' ? '/' : ch
    }
    const sub = (skip, end) => {
      const isArith = end === ')' && s[i + skip] === '('
      i += skip
      cur().subs.push(script(level + 1, end, isArith))
    }
    while (i < s.length) {
      const c = s[i]
      const n = s[i + 1]
      if (quote === "'") {
        if (c === "'") quote = null
        else append(c)
        i++
      } else if (bash && c === '\\') {
        if (n === '\n') i += 2
        else if (n === undefined || (quote === '"' && !'$`"\\'.includes(n))) {
          append(c)
          i++
        } else {
          append(n)
          i += 2
        }
      } else if (!bash && c === '`' && n !== undefined) {
        append(n)
        i += 2
      } else if (close === '`' && c === '`') {
        i++
        break
      } else if (c === '$' && n === '(') {
        sub(2, ')')
      } else if (bash && c === '`') {
        sub(1, '`')
      } else if (quote === '"') {
        if (c === '"') quote = null
        else append(c)
        i++
      } else if (c === "'" || c === '"') {
        quote = c
        cur()
        i++
      } else if (close === ')' && c === ')' && parens === 0) {
        i++
        break
      } else if (c === '\n') {
        flush()
        tokens.push(';')
        i++
        if (pending.length) readBodies(pending, level)
        pending = []
      } else if (c === ' ' || c === '\t' || c === '\r') {
        flush()
        i++
      } else if (c === '#' && word === null) {
        const nl = s.indexOf('\n', i)
        i = nl < 0 ? s.length : nl
      } else if (c === '$' && n === '{') {
        const end = s.indexOf('}', i)
        const stop = end < 0 ? s.length : end + 1
        cur().text += s.slice(i, stop).replace(/\\/g, '/')
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
    return { tokens }
  }

  return script(depth, null, false)
}

/**
 * The pipelines of a parsed script: lists of pipe stages, each stage
 * { words, redirs, heredocs } (words and redirection targets as parsed
 * words). Pipelines end at ; && || & newline and at ( ) { } (a group runs
 * its own commands). Empty stages and pipelines are left out.
 */
function pipelines(script) {
  const stage = () => ({ words: [], redirs: [], heredocs: [] })
  const out = [[stage()]]
  let redirect = false
  for (const token of script.tokens) {
    const pipeline = out[out.length - 1]
    const st = pipeline[pipeline.length - 1]
    if (typeof token !== 'string') {
      if (token.heredoc) {
        st.heredocs.push(token.heredoc)
      } else {
        ;(redirect ? st.redirs : st.words).push(token)
        redirect = false
      }
    } else if (token === '|' || token === '|&') {
      pipeline.push(stage())
    } else if (/[;(){}]/.test(token) || token === '&&' || token === '||' || token === '&') {
      out.push([stage()])
      redirect = false
    } else if (/[<>]/.test(token)) {
      redirect = true
    }
  }
  return out
    .map((p) => p.filter((st) => st.words.length || st.redirs.length || st.heredocs.length))
    .filter((p) => p.length)
}

// ---------------------------------------------------------------------------
// Programs that run a command line
// ---------------------------------------------------------------------------

const POSIX_SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh'])
const PS_SHELLS = new Set(['pwsh', 'powershell'])
// Every program nestedCommand() follows.
const SHELLS = new Set([...POSIX_SHELLS, ...PS_SHELLS, 'cmd', 'eval', 'wsl'])
// wsl options that take a separate value.
const WSL_VALUE_FLAGS = new Set(['-d', '--distribution', '-u', '--user', '--cd', '--shell-type', '--distribution-id'])

/**
 * The command line `runner` (a commandName) runs from `args`, as
 * { command, flavor }, or null: POSIX shells -c <line>; pwsh/powershell
 * -Command <line...> (powershell also takes bare words); cmd /c|/k
 * <line...>; eval <line...>; wsl [options] [--|-e|--exec] <command...>.
 */
function nestedCommand(runner, args) {
  if (POSIX_SHELLS.has(runner)) {
    const i = args.findIndex((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a))
    return i >= 0 && i + 1 < args.length ? { command: args[i + 1], flavor: 'bash' } : null
  }
  if (PS_SHELLS.has(runner)) {
    const i = args.findIndex((a) => a.length >= 2 && '-command'.startsWith(a.toLowerCase()))
    const rest = i >= 0 ? args.slice(i + 1) : runner === 'powershell' ? args.filter((a) => !a.startsWith('-')) : []
    return rest.length ? { command: rest.join(' '), flavor: 'ps' } : null
  }
  if (runner === 'cmd') {
    const i = args.findIndex((a) => /^\/[ck]$/i.test(a))
    return i >= 0 && i + 1 < args.length ? { command: args.slice(i + 1).join(' '), flavor: 'ps' } : null
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

// git/gh flags whose value is a message: prose, not a path.
const PROSE_FLAGS = ['-m', '-am', '--message', '--body', '--title', '--notes']

/** Indexes in `words` (texts, words[0] the command) that hold a git/gh message value. */
function proseValues(words) {
  const out = new Set()
  const runner = commandName(words[0] || '')
  if (runner !== 'git' && runner !== 'gh') return out
  words.forEach((w, k) => {
    if (PROSE_FLAGS.includes(w)) out.add(k + 1)
    else if (PROSE_FLAGS.some((f) => f.startsWith('--') && w.startsWith(`${f}=`))) out.add(k)
  })
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

/**
 * A Bash command with the literal heredoc bodies (literalHeredocs) and
 * their terminator lines cut out. Too deeply nested to parse: unchanged.
 */
function dropLiteralHeredocs(command) {
  let script
  try {
    script = parseShell(command, 'bash')
  } catch (err) {
    if (err instanceof NestingLimit) return command
    throw err
  }
  const cuts = [...literalHeredocs(script)].sort((a, b) => a.start - b.start)
  let out = ''
  let at = 0
  for (const h of cuts) {
    out += command.slice(at, h.start)
    at = h.end
  }
  return out + command.slice(at)
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
  PROSE_FLAGS,
  MAX_DEPTH,
  NestingLimit,
  projectDir,
  expandUser,
  absolutePath,
  commandName,
  bracketEnd,
  fnmatch,
  parseShell,
  pipelines,
  nestedCommand,
  proseValues,
  literalHeredocs,
  dropLiteralHeredocs,
  toolCall,
  runHook,
  main,
}
