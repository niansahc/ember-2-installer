// .claude/hooks/hook-utils.cjs
//
// Helpers shared by the PreToolUse guards in this directory (env-guard.cjs,
// vault-guard.cjs), so each rule has one definition:
//
//   - projectDir(): the project root every guard anchors on.
//   - absolutePath(): one resolution of a path string an agent wrote in a
//     tool call (Git Bash, WSL, device-prefix and drive-relative forms, ~).
//   - commandName(): one "bare command name" rule.
//   - fnmatch(): Python fnmatchcase for one glob (*, ?, [...], [!...]).
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
  // path.win32.resolve resolves drive-relative C:x against `base` when it is
  // on the same drive (the only drive whose cwd the hook knows).
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

const fnmatchCache = new Map()

/** Python fnmatch.fnmatchcase: `*`, `?`, `[...]`, `[!...]`; an unclosed `[` is literal. */
function fnmatch(name, pattern) {
  let re = fnmatchCache.get(pattern)
  if (!re) {
    let out = ''
    let i = 0
    const n = pattern.length
    while (i < n) {
      const c = pattern[i++]
      if (c === '*') out += '[\\s\\S]*'
      else if (c === '?') out += '[\\s\\S]'
      else if (c === '[') {
        let j = i
        if (j < n && pattern[j] === '!') j++
        if (j < n && pattern[j] === ']') j++
        const end = pattern.indexOf(']', j)
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

/** Read stdin, run, write, exit 0. */
function main(guard, evaluate, reason) {
  const chunks = []
  process.stdin.on('data', (c) => chunks.push(c))
  process.stdin.on('end', () => {
    let result
    try {
      result = runHook(guard, Buffer.concat(chunks).toString('utf8'), evaluate, reason)
    } catch (err) {
      result = { stdout: errorDenial(guard, err), stderr: '' }
    }
    if (result.stderr) process.stderr.write(result.stderr)
    if (result.stdout) process.stdout.write(result.stdout)
    process.exitCode = 0
  })
}

module.exports = {
  IS_WIN,
  CHECKOUT_ROOT,
  projectDir,
  expandUser,
  absolutePath,
  commandName,
  fnmatch,
  denial,
  errorType,
  errorDenial,
  runHook,
  main,
}
