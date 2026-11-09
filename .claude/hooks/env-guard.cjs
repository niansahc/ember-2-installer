// .claude/hooks/env-guard.cjs
//
// PreToolUse hook for Read|Grep|Glob|Edit|Write|Bash|PowerShell: denies
// agent tool calls that name a .env file (.env, .env.local,
// .env.production, ...) in any repo. .env.example is allowed everywhere.
//
// Why: .env holds live credentials, and anything a tool reads lands in the
// session transcript. A transcript is not a secret store. This hook refuses
// the call before it runs. It replaces reject-env-edit.sh (Edit/Write only).
//
// Threat model: this guard stops an agent from exposing a .env file by
// accident, through a read, search or listing it runs while working. It is
// a pattern check on the tool call, not a sandbox, and it does not defend
// against deliberate evasion (names built at runtime, encoded commands,
// scripts or interpreters that open files themselves).
//
// Port of ember-2 .claude/hooks/env_guard.py (#293), itself a port of
// ember-2-ui block-env-reads.cjs (#64): basename match after backslash
// normalisation, Win32 name aliases (`.env.`, `.env::$DATA`, `C:.env`),
// glob rule, brace sets, input fields per tool, ripgrep glob semantics for
// Grep, prose skip scoped to git/gh message flags.
//
// Globs. A dot-led glob is denied when it can match `.env` or some
// `.env.<x>` (`.e*`, `.en?`, `.[e]nv`, `.*`); one that cannot (`.[0]`,
// `.e[x]`) is not a .env name and is allowed.
//
// Quoting (Bash only). Bash does not expand wildcards inside quotes, so a
// quoted dot-led pattern with no literal text after the dot (`'.*'`,
// `'.[0]'`, `".*KEY"`) is passed to the program as text: jq paths and
// regexes, not file names. Such a word is allowed, except:
//   - after a flag whose value the program matches against file names
//     (find -name, rg -g/--glob, grep --include), and
//   - in a double-quoted span holding command substitution ($(...) or
//     backticks), or anywhere in a command that runs a nested shell
//     (SHELLS in hook-utils.cjs: bash -c, eval, pwsh, wsl, ...), where the
//     shell does expand it.
// PowerShell expands wildcards in quoted cmdlet arguments, so quoting
// changes nothing there.
//
// Heredocs (Bash only). A heredoc body is scanned like the rest of the
// command, unless it is literal text an inert consumer receives
// (literalHeredocs in hook-utils.cjs): a quoted delimiter (<<'EOF',
// <<"EOF", <<\EOF), and the body fed to tee, git commit -F -,
// gh --body-file -, or to cat inside a git/gh message value, as in
// git commit -m "$(cat <<'EOF' ... EOF)". Such a body is dropped before
// the scan, so a commit message may mention .env. Any other receiver (an
// interpreter, a shell, xargs, a substitution used as arguments, a pipe)
// keeps the body scanned.
//
// Messages. The value of a git/gh message flag (-m, --body, --title, ...)
// is prose, not a path, when it is quoted and runs nothing: '...', "..."
// with no command substitution ($(...), and in Bash backticks), and in
// PowerShell a here-string @'...'@, or @"..."@ with no $(...). parseShell
// finds the value, so a ; & or | inside the quotes stays part of it. The
// word after a flag must be quoted end to end; only the flag word itself
// may carry its name outside the quotes (--message="..."). The command is
// found past VAR=value, wrappers and keywords (commandStart), so
// FOO=1 git commit -m "..." counts. Such a value is dropped before the
// scan, so a commit message may mention .env. Any other message value is
// scanned.
//
// Words come from parseShell, so quote-split and escaped names (`.e"n"v`,
// `.en\v`, PowerShell `.`env`) are read as the name they make, and comments
// (`#`, PowerShell `<# #>`) are not scanned. A command nested past MAX_DEPTH
// (substitutions, shells, or PowerShell argument groups) falls back to a regex split of its raw text (unparsedWords; over-denies).
//
// Limits: a name built at runtime (a variable, base64, a script that opens
// the file, an 8.3 short name) is not caught, nor is a recursive read that
// never names the file (grep -r KEY .).
//
// Input: hook JSON on stdin. Output: a deny decision on stdout, or nothing.
// Exit code is always 0. Fail closed: an exception inside the check is a
// deny naming only this guard and the exception type (hook-utils.cjs).

'use strict'

const {
  MAX_BRACE_WORD, MAX_LIVE_BRACES, NestingLimit, SHELLS, SHELL_TOOLS, WILDCARD, bracketEnd, commandName, dropLiteralHeredocs, fnmatch, main,
  parseOrNull, pipelines, proseFlagPrefix, proseValues, toolCall,
} = require('./hook-utils.cjs')

const GUARD = 'env-guard'

// `.env`, `.env.local`, `.env.production`, ... (case-insensitive: Windows).
const ENV_NAME = /^\.env(\..+)?$/i
const EXAMPLE = '.env.example'
const BRACE = /^(.*)\{([^}]*)\}(.*)$/

function basename(p) {
  const trimmed = p.replace(/\\/g, '/').replace(/\/+$/, '')
  return trimmed.slice(trimmed.lastIndexOf('/') + 1)
}

/**
 * The names Win32 could resolve a path's last component to: the basename
 * and each colon-separated part of it (`.env::$DATA` stream syntax,
 * `C:.env` drive-relative syntax), with trailing dots and spaces dropped
 * (`.env.` opens `.env`).
 */
function canonicalNames(p) {
  const base = basename(p)
  return new Set([base, ...base.split(':')].map((part) => part.replace(/[. ]+$/, '')))
}

// A pattern whose brace sets would give more than MAX_BRACE_WORD alternatives,
// or that holds more than MAX_LIVE_BRACES {, is not expanded: {a,b} x 20 is a
// million alternatives, and a hook that runs out of time or memory does not
// block the call. It is denied with a reason naming the limit.
class BraceLimit extends Error {}

function expandBraces(pattern, count = { n: 0 }) {
  if (pattern.split('{').length - 1 > MAX_LIVE_BRACES) throw new BraceLimit()
  const brace = pattern.match(BRACE)
  if (!brace) {
    if (++count.n > MAX_BRACE_WORD) throw new BraceLimit()
    return [pattern]
  }
  const [, head, alts, tail] = brace
  return alts.split(',').flatMap((alt) => expandBraces(`${head}${alt}${tail}`, count))
}

// ---------------------------------------------------------------------------
// Can a glob match a .env name?
// ---------------------------------------------------------------------------

/**
 * A glob split into units: "*", or a one-character fnmatch pattern (a
 * literal, `?`, or a `[...]` set). An unclosed `[` is a literal.
 */
function globUnits(pattern) {
  const units = []
  let i = 0
  while (i < pattern.length) {
    if (pattern[i] === '[') {
      const end = bracketEnd(pattern, i)
      if (end >= 0) {
        units.push(pattern.slice(i, end + 1))
        i = end + 1
        continue
      }
    }
    units.push(pattern[i])
    i++
  }
  return units
}

/**
 * Add the states reached by letting a star, or a `?`, match nothing. A
 * Win32 wildcard `?` can match zero characters (cmd `type .env?` opens
 * .env), so `?` gets that reading too: it only widens what counts as
 * reaching a .env name.
 */
function closure(states, units) {
  const out = new Set(states)
  for (let state of states) {
    while (state < units.length && (units[state] === '*' || units[state] === '?')) {
      state++
      out.add(state)
    }
  }
  return out
}

/** The states after consuming one character. */
function step(states, units, ch) {
  const next = new Set()
  for (const state of states) {
    if (state >= units.length) continue
    const unit = units[state]
    if (unit === '*') next.add(state)
    else if (unit === '?' || unit === ch || (unit.length > 1 && fnmatch(ch, unit))) next.add(state + 1)
  }
  return closure(next, units)
}

/**
 * True when a lowercase glob can match `.env` or some `.env.<x>` with a
 * non-empty <x>. Runs the glob over `.env`: matched to the end, it names
 * `.env`; then over `.`: any unit left can match a non-empty <x>.
 */
function globCanNameEnv(pattern) {
  const units = globUnits(pattern)
  let states = closure(new Set([0]), units)
  for (const ch of '.env') states = step(states, units, ch)
  if (states.has(units.length)) return true
  return [...step(states, units, '.')].some((state) => state < units.length)
}

/** True when a single basename (no separators) names a .env file. */
function baseNamesEnv(base) {
  const lower = base.toLowerCase()
  const wild = WILDCARD.test(base)
  // The example file itself, by its exact name only. A glob that starts with
  // it (`.env.example*`) also reaches `.env.example.local`, so it goes
  // through the glob rule below like any other.
  if (lower === EXAMPLE) return false
  if (ENV_NAME.test(base)) return true

  // Globs. Only a pattern that starts with a literal dot can match a dotfile
  // (`*` alone does not match `.env`). `.e*`, `.en?`, `.[e]nv` and `.*` can
  // reach a .env file; `.git*` and `.[0]` cannot.
  if (wild && base.startsWith('.')) return globCanNameEnv(lower)

  // Brace sets: `.env{,.local}` / `{.env,.env.local}`.
  const alternatives = expandBraces(base)
  return alternatives.length > 1 && alternatives.some(baseNamesEnv)
}

/**
 * True when `candidate` (a path, filename, or glob) names a protected .env
 * file. With `asText`, a dot followed straight by a wildcard (`.*`, `.[0]`)
 * is text, not a file name (see Quoting above).
 */
function namesEnvFile(candidate, asText = false) {
  if (typeof candidate !== 'string') return false
  for (const name of canonicalNames(candidate)) {
    if (asText && name[0] === '.' && '*?['.includes(name[1] || ' ')) continue
    if (baseNamesEnv(name)) return true
  }
  return false
}

// Grep's `glob` is a ripgrep glob, and ripgrep differs from the dotfile rule
// above in two ways: `*` DOES match a leading dot, and a matching -g glob
// overrides .gitignore. So `glob: "*"` or `"*.local"` makes Grep print .env
// contents. A Grep glob is therefore also tested against representative
// .env names. A negated glob (`!*.py`) adds no whitelist and is left alone.
const GREP_GLOB_PROBES = ['.env', '.env.local', '.env.development', '.env.production', '.env.test']

/** True when a Grep (ripgrep) glob could select a .env file. */
function grepGlobReachesEnv(glob) {
  if (namesEnvFile(glob)) return true
  if (typeof glob !== 'string' || glob.startsWith('!')) return false
  return expandBraces(basename(glob).toLowerCase()).some((alt) =>
    GREP_GLOB_PROBES.some((probe) => fnmatch(probe, alt)),
  )
}

// Which input fields of each non-shell tool can name a file, and the check
// for each. Grep's `pattern` is a content regex, not a path.
const PATH_FIELDS = new Map([
  ['Read', { file_path: namesEnvFile }],
  ['Edit', { file_path: namesEnvFile }],
  ['Write', { file_path: namesEnvFile }],
  ['Grep', { path: namesEnvFile, glob: grepGlobReachesEnv }],
  ['Glob', { path: namesEnvFile, pattern: namesEnvFile }],
])

// ---------------------------------------------------------------------------
// Shell commands
// ---------------------------------------------------------------------------

// Quotes, separators, redirections and `=` (for --path=.env) all delimit.
// Backslashes do NOT, so Windows paths survive intact.
const TOKEN_SPLIT = /[\s"'`;|&<>(){}=,]+/
/** The names in a run of text. */
const pieces = (text) => text.split(TOKEN_SPLIT).filter(Boolean)
// Flags whose value the program matches as a glob against file names.
const GLOB_FLAGS = new Set([
  '-name', '-iname', '-path', '-ipath', '-wholename', '-iwholename',
  '-g', '--glob', '--iglob', '--include',
])

/**
 * True when a git/gh message value is quoted end to end (nothing read
 * outside quotes but, on a --message="..." word, the flag itself; no quote
 * left open) and runs no substitution: bash runs `$(cat <file>)` inside
 * double quotes, and its output would land in the commit or PR text.
 */
function isProse(w) {
  if (w.subs.length || w.open) return false
  const flag = proseFlagPrefix(w.text)
  return w.bare === '' || (flag !== '' && w.bare === flag)
}

/**
 * Add the candidate names of one parsed word to `out` as [name, quoted]: the
 * pieces of each quote part (`quoted` when, in Bash, the part is in quotes
 * and runs no substitution, so its wildcards are text), plus the pieces of
 * the whole word that no part holds (a name split by quotes is one name).
 */
function addWord(w, out) {
  const seen = new Set()
  for (const part of w.parts) {
    const quoted = part.quote !== null && !w.open && !(part.quote === '"' && w.subs.length > 0)
    for (const piece of pieces(part.text)) {
      seen.add(piece)
      out.push([piece, quoted])
    }
  }
  if (w.parts.length > 1) for (const piece of pieces(w.text)) if (!seen.has(piece)) out.push([piece, false])
  for (const sub of w.subs) addScript(sub, out)
}

function addScript(script, out) {
  for (const pipeline of pipelines(script)) {
    for (const st of pipeline) {
      const prose = proseValues(st.words.map((w) => w.text))
      st.words.forEach((w, k) => {
        if (!(prose.has(k) && isProse(w))) addWord(w, out)
      })
      for (const w of st.redirs) addWord(w, out)
      // A heredoc body is text (literal ones were dropped already); the
      // substitutions in it are inside that text.
      for (const h of st.heredocs) for (const piece of pieces(h.body)) out.push([piece, false])
    }
  }
}

/**
 * The words of a command that could not be parsed (nested past MAX_DEPTH):
 * regex-split raw text, all of it scanned. Over-denies (comments, prose).
 */
function unparsedWords(command) {
  return pieces(command).map((w) => [w, false])
}

/**
 * The command's words, each with `quoted`: true when, in a Bash command that
 * runs no nested shell, the shell passes the word's wildcards through as text.
 */
function words(command, bash) {
  const script = parseOrNull(command, bash ? 'bash' : 'ps')
  if (!script) return unparsedWords(command)
  const out = []
  try {
    addScript(script, out)
  } catch (err) {
    // Argument groups nested past MAX_DEPTH (pipelines): same fallback as an unparsable command.
    if (err instanceof NestingLimit) return unparsedWords(command)
    throw err
  }
  const nested = out.some(([w]) => SHELLS.has(commandName(w)))
  return out.map(([w, quoted]) => [w, bash && !nested && quoted])
}

/** The first word of a shell command that names a .env file, or null. */
function commandNamesEnvFile(command, bash = false) {
  if (typeof command !== 'string') return null
  let previous = ''
  for (const [word, quoted] of words(command, bash)) {
    if (namesEnvFile(word, quoted && !GLOB_FLAGS.has(previous))) return word
    previous = word
  }
  return null
}

/** The matched target when the tool call names a .env file, else null. */
function evaluate(payload) {
  try {
    return check(payload)
  } catch (err) {
    if (err instanceof BraceLimit) return BRACE_LIMIT
    throw err
  }
}

const BRACE_LIMIT = Symbol('brace limit')

function check(payload) {
  const call = toolCall(payload)
  if (!call) return null
  const { tool, input } = call
  if (SHELL_TOOLS.has(tool)) {
    const bash = tool === 'Bash'
    const command = bash && typeof input.command === 'string' ? dropLiteralHeredocs(input.command) : input.command
    return commandNamesEnvFile(command, bash)
  }
  for (const [field, namesEnv] of Object.entries(PATH_FIELDS.get(tool) || {})) {
    if (namesEnv(input[field])) return input[field]
  }
  return null
}

function reason(target) {
  if (target === BRACE_LIMIT) {
    return (
      `Blocked by project hook: a brace pattern in this call expands past the limit (` +
      `${MAX_BRACE_WORD} alternatives, ${MAX_LIVE_BRACES} braces), so it cannot be checked for ` +
      `.env names and is denied. Use a shorter pattern. See .claude/hooks/${GUARD}.cjs.`
    )
  }
  return (
    `Blocked by project hook: .env files may not be read, listed or edited ` +
    `(matched '${target}'). .env holds live credentials and anything read ` +
    `lands in the session transcript. Use .env.example for variable names, ` +
    `or ask the user to supply a value. See .claude/hooks/${GUARD}.cjs.`
  )
}

if (require.main === module) main(GUARD, evaluate, reason)

module.exports = { GUARD, reason }
