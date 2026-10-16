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
//   - dropLiteralHeredocs(): one rule for quoted-delimiter heredoc bodies
//     in a Bash command (literal text, not scanned).
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
          let body = pattern.slice(i, end).replace(/\\/g, '\\\\')
          if (body.startsWith('!')) body = '^' + body.slice(1)
          else if (body.startsWith('^')) body = '\\' + body
          out += `[${body}]`
          i = end + 1
        }
      } else out += c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
    }
    try {
      re = new RegExp(`^${out}$`)
    } catch {
      // A reversed range: Python's fnmatch matches nothing for it.
      re = /(?!)/
    }
    fnmatchCache.set(pattern, re)
  }
  return re.test(name)
}

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

// ---------------------------------------------------------------------------
// Heredocs (Bash)
// ---------------------------------------------------------------------------

// Commands that run text handed to them (on stdin, or as arguments read from
// it) as code or as file names. When one appears outside the heredoc bodies,
// a quoted-delimiter body may be run after all (`bash <<'EOF'`, `cat <<'EOF'
// | xargs cat`, `eval "$(cat <<'EOF' ...)"`), so it stays scanned.
const RUNS_TEXT = new Set([
  'bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh', 'pwsh', 'powershell', 'cmd', 'wsl',
  'eval', 'source', 'exec', 'xargs', 'parallel', 'read', 'mapfile', 'readarray',
  'python', 'python3', 'py', 'node', 'deno', 'bun', 'perl', 'ruby', 'php',
  'awk', 'gawk', 'mawk', 'nawk', 'sed', 'osascript',
])
// `.` as a command (`. ./script`), not as an argument (`git add .`).
const DOT_COMMAND = /(?:^|[;&|({\n`]|\$\()\s*\.\s/

/**
 * The heredoc operator at s[i] (`<<`, `<<-`), as { delimiter, quoted, strip,
 * end }, or null when no delimiter word follows. Any quoting in the word
 * (`'EOF'`, `"EOF"`, `\EOF`, `E"O"F`) makes the body literal.
 */
function heredocOperator(s, i) {
  let j = i + 2
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
  return delimiter ? { delimiter, quoted, strip, end: j } : null
}

/** The index just past the terminator line of a body starting at `pos`, or -1. */
function heredocEnd(s, pos, op) {
  for (let start = pos; ; ) {
    const nl = s.indexOf('\n', start)
    let line = s.slice(start, nl < 0 ? s.length : nl).replace(/\r$/, '')
    if (op.strip) line = line.replace(/^\t+/, '')
    if (line === op.delimiter) return nl < 0 ? s.length : nl + 1
    if (nl < 0) return -1
    start = nl + 1
  }
}

/**
 * A Bash command with the bodies of quoted-delimiter heredocs (<<'EOF',
 * <<"EOF", <<\EOF) and their terminator lines removed: Bash expands nothing
 * in them, so they are text, not commands or file names. An unquoted
 * delimiter body is kept (Bash expands $(...) and backticks in it). The
 * command comes back unchanged when a body has no terminator line, or when
 * the rest of the command runs text it is handed (RUNS_TEXT).
 */
function dropLiteralHeredocs(command) {
  const s = command
  let out = ''
  let copied = 0
  // One frame per $( ... ) level: its quote state and open ( count.
  const frames = [{ quote: null, depth: 0 }]
  let pending = []
  for (let i = 0; i < s.length; i++) {
    const f = frames[frames.length - 1]
    const c = s[i]
    if (f.quote === "'") {
      if (c === "'") f.quote = null
    } else if (c === '\\') {
      i++
    } else if (c === '$' && s[i + 1] === '(') {
      frames.push({ quote: null, depth: 0 })
      i++
    } else if (f.quote === '"') {
      if (c === '"') f.quote = null
    } else if (c === "'" || c === '"') {
      f.quote = c
    } else if (c === '(') {
      f.depth++
    } else if (c === ')') {
      if (f.depth) f.depth--
      else if (frames.length > 1) frames.pop()
    } else if (c === '#' && (i === 0 || /[\s;&|()]/.test(s[i - 1]))) {
      const nl = s.indexOf('\n', i)
      if (nl < 0) break
      i = nl - 1
    } else if (c === '<' && s[i + 1] === '<' && s[i + 2] !== '<' && s[i - 1] !== '<') {
      const op = heredocOperator(s, i)
      if (op) {
        pending.push(op)
        i = op.end - 1
      }
    } else if (c === '\n' && pending.length) {
      // The bodies start on the next line, one after another.
      let pos = i + 1
      for (const op of pending) {
        const next = heredocEnd(s, pos, op)
        if (next < 0) return command
        if (op.quoted) {
          out += s.slice(copied, pos)
          copied = next
        }
        pos = next
      }
      pending = []
      i = pos - 1
    }
  }
  if (!copied) return command
  out += s.slice(copied)
  const words = out.split(/[\s"'`;|&<>(){}=,$]+/).filter(Boolean)
  return words.some((w) => RUNS_TEXT.has(commandName(w))) || DOT_COMMAND.test(out) ? command : out
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
  projectDir,
  expandUser,
  absolutePath,
  commandName,
  dropLiteralHeredocs,
  bracketEnd,
  fnmatch,
  toolCall,
  runHook,
  main,
}
