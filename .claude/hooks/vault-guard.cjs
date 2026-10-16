// .claude/hooks/vault-guard.cjs
//
// PreToolUse hook for Read|Grep|Glob|Edit|Write|Bash|PowerShell: denies
// agent tool calls that would read, list, or edit vault content.
//
// Why: vault contents (record text, names, record IDs in file names) must
// never enter the session transcript (CLAUDE.md, Vault Privacy Rule).
//
// Port of ember-2 .claude/hooks/vault_guard.py (#294/#295) for the path
// tools and secret_dump_guard.py for the shell tools, with ember-2's fail
// closed rule (#296): an exception inside the check is a deny naming only
// this guard and the exception type, never the message (it can carry the
// vault path). See hook-utils.cjs.
//
// Which vaults:
//   - any directory named private_vault, by name, in any path form
//     (C:\x\private_vault\a, /c/x/private_vault/a, ../private_vault,
//     PRIVATE_VAULT, private_vault. -- Win32 drops the trailing dot) or as a
//     glob component that could match it (path tools: priv*, *_vault; shell
//     operands: only a glob that contains the literal text "vault");
//   - by location, when the directory exists: <installer>/private_vault,
//     <ember-2>/private_vault, and the configured vault.
//
// The configured vault is PRIVATE_VAULT_PATH: the process environment
// first, then the sibling ember-2 checkout's .env (<project>/../ember-2/.env),
// parsed and interpolated as python-dotenv does (${VAR}, ${VAR:-default};
// earlier keys, then the process environment). It is resolved the way
// ember-2's src/core/vault_path.py resolves it: stripped, ~ expanded, a
// relative value against the ember-2 project root (never the cwd), then
// realpath. The value is never printed, deny reasons included. A .env that
// exists but cannot be read, or a value with a `${` left after
// interpolation, is an error, so a deny.
//
// Path tools (Read/Edit/Write/Grep/Glob): a path field that names a vault,
// or resolves to a location at or under an existing vault, is denied.
// Resolution covers relative and ../ forms, ~, Git Bash /c/..., WSL
// /mnt/c/..., drive-relative C:x (Windows), the \\?\ device prefix, and,
// through realpath, 8.3 short names, junctions and symlinks. A search
// rooted inside a vault is denied; a search rooted above one is denied when
// it can reach it: Glob when its pattern can descend into the vault, Grep
// unless an anchored glob keeps it out.
//
// Divergence from ember-2: no .gitignore exemption. ember-2 lets Grep with
// no glob, and rg/ag in a shell, skip its gitignored in-project vault. This
// repo does not gitignore private_vault/, and a vault in the sibling
// checkout is ignored only by ripgrep's nested-repo rules, so every vault is
// treated as reachable from an ancestor.
//
// Shell tools (Bash/PowerShell). The command is split into pipelines and
// pipe stages. Command substitution ($(...), and backticks in Bash), the
// strings run by bash/sh -c, pwsh/powershell -Command, cmd /c and eval, and
// groups ( ... ) and { ... } are scanned as commands of their own. Leading
// shell keywords (if, then, do, !, ...), VAR=value words and the wrappers
// sudo, env, time, nice and nohup are skipped to find the command a stage
// runs. In Bash, the body of a quoted-delimiter heredoc (<<'EOF') is literal
// text and is dropped first, unless the command also runs a shell, eval,
// xargs, read or an interpreter (dropLiteralHeredocs in hook-utils.cjs); an
// unquoted delimiter body is scanned as commands. Then:
//   - name rule: a stage whose command word, operands, flag values (--file=x, if=x,
//     -Path:x) or redirections name a private_vault directory is denied,
//     whatever the command, except the pattern operand of a content search
//     and the message of git/gh -m/--body/--title/--notes. Commands that
//     only print or test their arguments (echo, printf, test, Test-Path,
//     Write-Output, mkdir) are checked on their redirections only;
//   - location rule: a stage that runs a known content-reading utility (cat,
//     type, Get-Content, grep, rg, findstr, Select-String, ...) or a
//     listing/counting utility (ls, dir, gci, tree, find, wc) is denied when
//     a path argument resolves, against the payload cwd and any `cd` earlier
//     in the line, to a location at or under a vault, when it lists the cwd
//     from inside one, or when it recurses from an ancestor of one. The
//     values of value-taking flags (-C 2, -g '*.json', -Depth 3) are not
//     taken for the pattern or a root; a root that does not exist adds the
//     cwd as a root, since its flag may have taken a value.
//
// A pattern check on the call, not a sandbox: a path built at runtime
// ($VAR, %VAR%), a different utility, a script, or base64 is not caught.
// Known limit: a literal path containing a wildcard character (`[`, `*`,
// `?`) gets no realpath, so a junction named `[x]` that points into the
// vault is matched only by its lexical spelling.

'use strict'

const fs = require('fs')
const path = require('path')
const {
  SHELL_TOOLS, WILDCARD, absolutePath, commandName, dropLiteralHeredocs, expandUser, fnmatch, main, projectDir,
  toolCall,
} = require('./hook-utils.cjs')

const GUARD = 'vault-guard'
const VAULT_DIR = 'private_vault'
const VAULT_KEY = 'PRIVATE_VAULT_PATH'

/** The sibling ember-2 checkout, whose .env configures the vault. */
function ember2Root() {
  return path.resolve(projectDir(), '..', 'ember-2')
}

/**
 * Path components, Win32-canonical: slash-separated, lowercased, trailing
 * dots/spaces dropped, colon parts split out.
 */
function components(p) {
  const parts = []
  for (const comp of p.replace(/\\/g, '/').split('/')) {
    for (const part of comp.split(':')) {
      const c = part.replace(/[. ]+$/, '').toLowerCase()
      if (c) parts.push(c)
    }
  }
  return parts
}

/** fnmatchcase for a glob component, equality for a literal one. */
function matches(name, pattern) {
  return WILDCARD.test(pattern) ? fnmatch(name, pattern) : name === pattern
}

function namesVaultDir(component) {
  // A literal match, or a glob component with at least one literal character
  // that can match the directory name (priv*, *_vault). Bare `*`/`**` are a
  // reach question, not naming.
  return component.replace(/^\*+|\*+$/g, '') !== '' && matches(VAULT_DIR, component)
}

/** True when `candidate` names a private_vault directory or something inside one. */
function namesVaultPath(candidate) {
  return typeof candidate === 'string' && components(candidate).some(namesVaultDir)
}

/**
 * The shell operand form of the name rule: a glob component counts only when
 * it contains the literal text "vault" (`*vault*`, `private_v*` does not), so
 * broad globs (`p*`, `*t`) of ordinary files are not taken for the vault.
 */
function operandNamesVault(candidate) {
  return components(candidate).some(
    (c) => namesVaultDir(c) && (!WILDCARD.test(c) || c.includes('vault')),
  )
}

// ---------------------------------------------------------------------------
// Vault locations
// ---------------------------------------------------------------------------

/**
 * realpath that, like Python's os.path.realpath, resolves the existing
 * prefix of a path that does not exist yet (a new file under a junction).
 */
function realpathLoose(p) {
  try {
    return fs.realpathSync.native(p)
  } catch {
    const parent = path.dirname(p)
    if (parent === p) return p
    return path.join(realpathLoose(parent), path.basename(p))
  }
}

/** Absolute forms of `p`: lexical, plus the real path when it has no wildcard. */
function resolutions(p, base) {
  const lexical = absolutePath(p, base)
  const forms = [lexical]
  if (!WILDCARD.test(lexical)) {
    const real = realpathLoose(lexical)
    if (real !== lexical) forms.push(real)
  }
  return forms
}

function pathForms(p, base) {
  return resolutions(p, base).map(components)
}

/**
 * True when `parts` (a path, or a glob split into components) can name
 * `target` or something below it; with `strict`, only something below.
 */
function covers(parts, target, strict = false) {
  for (let i = 0; i < target.length; i++) {
    if (i >= parts.length) return false
    if (parts[i] === '**') return true
    if (!matches(target[i], parts[i])) return false
  }
  return !strict || parts.length > target.length
}

// ---------------------------------------------------------------------------
// .env (python-dotenv semantics)
// ---------------------------------------------------------------------------

/** A configured value with a `${` that interpolation could not resolve. */
class UnresolvedInterpolation extends Error {}

const DOUBLE_QUOTE_ESCAPES = { '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' }
// python-dotenv variables.py _posix_variable.
const POSIX_VARIABLE = /\$\{([^}:]*)(?::-([^}]*))?\}/g

/** [key, value] bindings in file order; a key with no `=` has value null. */
function dotenvBindings(text) {
  const bindings = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, '')
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) {
      bindings.push([line.replace(/^'(.*)'$/, '$1'), null])
      continue
    }
    const key = line.slice(0, eq).trim().replace(/^'(.*)'$/, '$1')
    const rest = line.slice(eq + 1)
    // `KEY= # comment` is an empty value; `KEY=#x` keeps the `#`.
    if (/^\s+#/.test(rest)) {
      bindings.push([key, ''])
      continue
    }
    const v = rest.trimStart()
    let value
    if (v[0] === "'") {
      const m = v.match(/^'((?:\\.|[^'\\])*)'/)
      if (!m) continue // unterminated: python-dotenv skips the binding
      value = m[1].replace(/\\([\\'])/g, '$1')
    } else if (v[0] === '"') {
      const m = v.match(/^"((?:\\.|[^"\\])*)"/)
      if (!m) continue
      value = m[1].replace(/\\([\\'"abfnrtv])/g, (_, c) => DOUBLE_QUOTE_ESCAPES[c])
    } else {
      value = v.replace(/\s+#.*/, '').trimEnd()
    }
    bindings.push([key, value])
  }
  return bindings
}

/**
 * python-dotenv resolve_variables(override=True): each value's ${VAR} and
 * ${VAR:-default} from the keys resolved so far, then the process
 * environment, then the default, then "".
 */
function interpolate(bindings) {
  const values = new Map()
  for (const [key, value] of bindings) {
    if (value === null) {
      values.set(key, null)
      continue
    }
    values.set(
      key,
      value.replace(POSIX_VARIABLE, (_, name, fallback) => {
        if (values.has(name)) return values.get(name) ?? ''
        if (process.env[name] !== undefined) return process.env[name]
        return fallback ?? ''
      }),
    )
  }
  return values
}

/**
 * `key` from a dotenv file, or null. Absent file: null. Unreadable, or a
 * value still holding `${` after interpolation: throws (fail closed).
 */
function envFileValue(key, file) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return null
    throw err
  }
  const value = interpolate(dotenvBindings(text)).get(key)
  if (typeof value === 'string' && value.includes('${')) throw new UnresolvedInterpolation()
  return (value || '').trim() || null
}

/** The raw PRIVATE_VAULT_PATH value, or null. Never printed. */
function configuredVault() {
  const value = (process.env[VAULT_KEY] || '').trim()
  if (value) return value
  return envFileValue(VAULT_KEY, path.join(ember2Root(), '.env'))
}

/**
 * Existing vault directories, deduplicated, each as { forms }: the realpath
 * and the lexical spelling as components. A glob through a junction name
 * gets no realpath (it has wildcards), so only the lexical form matches it.
 */
function vaultDirs() {
  const project = projectDir()
  const root = ember2Root()
  const candidates = [
    [VAULT_DIR, project],
    [VAULT_DIR, root],
  ]
  const configured = configuredVault()
  if (configured) candidates.push([configured, root])
  const vaults = []
  const seen = new Set()
  for (const [raw, base] of candidates) {
    // vault_path.py: strip, ~, relative against the root, realpath. stat
    // follows junctions and symlinks, so a missing vault (the usual case
    // for the private_vault candidates) costs one syscall and no realpath.
    const lexicalPath = path.resolve(base, expandUser(raw.trim()))
    let stat
    try {
      stat = fs.statSync(lexicalPath, { throwIfNoEntry: false })
    } catch {
      stat = undefined
    }
    if (!stat || !stat.isDirectory()) continue
    const forms = [components(realpathLoose(lexicalPath)), components(absolutePath(raw.trim(), base))]
    const keys = [...new Set(forms.map((f) => f.join('/')))]
    if (keys.some((k) => seen.has(k))) continue
    keys.forEach((k) => seen.add(k))
    vaults.push({ forms: keys.length === 1 ? [forms[0]] : forms })
  }
  return vaults
}

/** True when `candidate` (relative to `base`) can name a location at or under a vault. */
function insideVault(candidate, base, vaults) {
  const forms = pathForms(candidate, base)
  return forms.some((f) => vaults.some((vault) => vault.forms.some((v) => covers(f, v))))
}

/** True when a directory (as pathForms components) is a strict ancestor of `vault`. */
function aboveVault(forms, vault) {
  return forms.some((f) => vault.forms.some((v) => covers(v, f, true)))
}

// ---------------------------------------------------------------------------
// Reach (Grep / Glob)
// ---------------------------------------------------------------------------

/** A glob joined to each search root, as components. */
function globForms(pattern, roots) {
  return roots.map((root) => components(absolutePath(pattern, root)))
}

/** A glob (as globForms) can match something below `vault`. */
function globReaches(forms, vault) {
  return forms.some((f) => vault.forms.some((v) => covers(f, v, true)))
}

function reachesVault(tool, input, cwd, vaults) {
  const root = typeof input.path === 'string' && input.path ? input.path : '.'
  const roots = resolutions(root, cwd)
  const rootForms = roots.map(components)
  const raw = input[tool === 'Glob' ? 'pattern' : 'glob']
  const pattern = typeof raw === 'string' && raw ? raw : null
  // Glob: the pattern against the root. Grep: ripgrep globs are relative to
  // the search root, a leading `/` included. No glob, a negated glob, or an
  // unanchored glob lets ripgrep descend every subdirectory (forms = null);
  // only an anchored whitelisting glob can keep it out.
  let forms = null
  if (tool === 'Glob') {
    forms = pattern ? globForms(pattern, roots) : []
  } else if (pattern && !pattern.startsWith('!')) {
    const parts = pattern.replace(/\\/g, '/').split('/').filter(Boolean)
    if (parts.length !== 1) forms = globForms(parts.join('/'), roots)
  }
  for (const vault of vaults) {
    if (rootForms.some((f) => vault.forms.some((v) => covers(f, v)))) return root
    if (tool === 'Glob') {
      if (globReaches(forms, vault)) return pattern
    } else if (aboveVault(rootForms, vault) && (forms === null || globReaches(forms, vault))) {
      return pattern || root
    }
  }
  return null
}

// Which input fields of each path tool can name a path.
const PATH_FIELDS = new Map([
  ['Read', ['file_path']],
  ['Edit', ['file_path']],
  ['Write', ['file_path']],
  ['Grep', ['path', 'glob']],
  ['Glob', ['path', 'pattern']],
])

// ---------------------------------------------------------------------------
// Shell commands: parsing
// ---------------------------------------------------------------------------

// Characters that split words. `(` `)` `{` `}` and `;` end a pipeline, `|`
// a stage, `<` `>` mark a redirection target.
const PUNCTUATION = '();<>|&{}'
const MAX_DEPTH = 8

/**
 * Command substitutions in `command`: { outer, bodies }. Each $(...) (and,
 * in Bash, each `...`) outside single quotes is cut out of `outer` and its
 * text returned in `bodies`, to be scanned as a command of its own.
 */
function substitutions(command, backticks) {
  let outer = ''
  const bodies = []
  let single = false
  let double = false
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (c === "'" && !double) single = !single
    else if (c === '"' && !single) double = !double
    if (!single && c === '$' && command[i + 1] === '(') {
      let depth = 1
      let j = i + 2
      for (; j < command.length && depth; j++) {
        if (command[j] === '(') depth++
        else if (command[j] === ')') depth--
      }
      bodies.push(command.slice(i + 2, depth ? j : j - 1))
      outer += ' '
      i = j - 1
    } else if (!single && backticks && c === '`') {
      const end = command.indexOf('`', i + 1)
      bodies.push(command.slice(i + 1, end < 0 ? command.length : end))
      outer += ' '
      i = end < 0 ? command.length : end
    } else {
      outer += c
    }
  }
  return { outer, bodies }
}

/**
 * The command as shell tokens: quote-aware (a `|` inside quotes is part of a
 * word; adjacent quoted and unquoted text join), runs of PUNCTUATION as
 * their own tokens, `${...}` kept inside its word, a newline as `;`, `#` at
 * a word start as a comment. Backslashes become `/` first so Windows paths
 * survive. Unbalanced quotes: null (no match; the shell will not run it).
 */
function shellTokens(command) {
  const s = command.replace(/\\/g, '/')
  const tokens = []
  let word = null
  const flush = () => {
    if (word !== null) tokens.push(word)
    word = null
  }
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\n') {
      flush()
      tokens.push(';')
    } else if (/\s/.test(c)) {
      flush()
    } else if (c === '$' && s[i + 1] === '{') {
      const end = s.indexOf('}', i)
      const stop = end < 0 ? s.length : end + 1
      word = (word || '') + s.slice(i, stop)
      i = stop - 1
    } else if (PUNCTUATION.includes(c)) {
      flush()
      let j = i
      while (j < s.length && PUNCTUATION.includes(s[j])) j++
      tokens.push(s.slice(i, j))
      i = j - 1
    } else if (c === "'" || c === '"') {
      const end = s.indexOf(c, i + 1)
      if (end < 0) return null
      word = (word || '') + s.slice(i + 1, end)
      i = end
    } else if (c === '#' && word === null) {
      const end = s.indexOf('\n', i)
      if (end < 0) break
      i = end - 1
    } else {
      word = (word || '') + c
    }
  }
  flush()
  return tokens
}

/**
 * Pipelines of pipe stages, each stage { words, redirs }: `redirs` are the
 * targets of < and > (a file the stage reads or writes). Pipelines end at
 * ; && || & and at ( ) { } (a group runs its own commands).
 */
function pipelines(command) {
  const tokens = shellTokens(command)
  if (!tokens) return []
  const newStage = () => ({ words: [], redirs: [] })
  const out = [[newStage()]]
  let redirect = false
  for (const token of tokens) {
    const pipeline = out[out.length - 1]
    const stage = pipeline[pipeline.length - 1]
    const punct = token !== '' && [...token].every((ch) => PUNCTUATION.includes(ch))
    if (!punct) {
      ;(redirect ? stage.redirs : stage.words).push(token)
      redirect = false
    } else if (token === '|' || token === '|&') {
      pipeline.push(newStage())
    } else if (/[;(){}]/.test(token) || token === '&&' || token === '||' || token === '&') {
      out.push([newStage()])
    } else if (/[<>]/.test(token)) {
      redirect = true
    }
  }
  return out
}

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

/** `words` from the command the stage runs: keywords, VAR=value and wrappers skipped. */
function unwrap(words) {
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
  return words.slice(i)
}

/**
 * A stage as { words, redirs, runner, utility, at }: `runner` is the command
 * the stage starts, `utility` the one that reads (for `xargs [flags] cmd`,
 * cmd) and `at` the index of the utility word in `words`.
 */
function analyse(stage) {
  const words = unwrap(stage.words)
  const runner = words.length ? commandName(words[0]) : ''
  let at = 0
  if (runner === 'xargs') {
    const i = words.findIndex((w, k) => k > 0 && !w.startsWith('-'))
    if (i > 0) at = i
  }
  return { words, redirs: stage.redirs, runner, utility: words.length ? commandName(words[at]) : '', at }
}

// Shells and the flag after which their argument is a command line.
const NESTED_SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh'])
const PS_SHELLS = new Set(['pwsh', 'powershell'])

/**
 * The command line a stage hands to another interpreter, as
 * { command, flavor }, or null: bash/sh -c "...", pwsh/powershell
 * -Command ..., cmd /c ..., eval ...
 */
function nestedCommand(s) {
  const args = s.words.slice(1)
  if (NESTED_SHELLS.has(s.runner)) {
    const i = args.findIndex((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a))
    return i >= 0 && i + 1 < args.length ? { command: args[i + 1], flavor: 'bash' } : null
  }
  if (PS_SHELLS.has(s.runner)) {
    const i = args.findIndex((a) => a.length >= 2 && '-command'.startsWith(a.toLowerCase()))
    const rest = i >= 0 ? args.slice(i + 1) : s.runner === 'powershell' ? args.filter((a) => !a.startsWith('-')) : []
    return rest.length ? { command: rest.join(' '), flavor: 'ps' } : null
  }
  if (s.runner === 'cmd') {
    const i = args.findIndex((a) => /^\/[ck]$/i.test(a))
    return i >= 0 && i + 1 < args.length ? { command: args.slice(i + 1).join(' '), flavor: 'ps' } : null
  }
  if (s.runner === 'eval' && args.length) return { command: args.join(' '), flavor: 'bash' }
  return null
}

// ---------------------------------------------------------------------------
// Shell commands: rules
// ---------------------------------------------------------------------------

// Whole-file dumps and content searches, lowercase (PowerShell and Windows
// executables are case-insensitive). Deliberately narrow.
const READ_UTILITIES = new Set([
  'cat', 'type', 'more', 'less', 'head', 'tail', 'xxd', 'hexdump', 'od', 'strings', 'get-content', 'gc',
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'findstr', 'select-string', 'sls',
])
// Listing and counting: their output is entry names (record IDs) or a count.
const LIST_UTILITIES = new Set(['ls', 'dir', 'gci', 'get-childitem', 'tree', 'find', 'wc'])
// Content searches: the first positional operand is a pattern, not a path.
const SEARCHES = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'findstr', 'select-string', 'sls'])
// Commands that only print or test their arguments: name rule on redirections only.
const NON_READING = new Set(['echo', 'printf', 'test', '[', '[[', 'test-path', 'write-output', 'write-host', 'mkdir'])
// git/gh message flags: their value is prose. Substitutions inside it were
// already cut out and scanned (substitutions()).
const PROSE_FLAGS = new Set(['-m', '-am', '--message', '--body', '--title', '--notes'])
const CD = new Set(['cd', 'chdir', 'pushd', 'set-location', 'sl', 'push-location'])
const ALWAYS_RECURSIVE = new Set(['rg', 'ag', 'ack'])
const GREP = new Set(['grep', 'egrep', 'fgrep'])
const LISTERS = new Set(['get-childitem', 'gci', 'ls', 'dir'])
// PowerShell accepts any unambiguous prefix of -Recurse.
const PS_RECURSE = new Set(['-r', '-re', '-rec', '-recu', '-recur', '-recurs', '-recurse', '--recursive'])
const GREP_RECURSE = /^(?:-[a-zA-Z]*[rR][a-zA-Z]*|--(?:dereference-)?recursive|--directories=recurse)$/
// cmd-style switches (/s, /i, /c:text); a path like /c/x has a second slash.
const SWITCH = /^\/[a-z]+(?::[\s\S]*)?$/i
// Flags whose value is a separate word: dropped before picking the pattern
// and the roots. The Unix search flags are case-sensitive and apply to the
// grep/rg family only; the PowerShell ones are not, and apply elsewhere.
const UNIX_SEARCHES = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack'])
const VALUE_FLAGS = new Set([
  '-A', '-B', '-C', '-m', '-g', '-t', '-T', '-j', '-e', '-f',
  '--after-context', '--before-context', '--context', '--max-count', '--glob', '--iglob',
  '--type', '--type-not', '--threads', '--regexp', '--file',
])
const PS_VALUE_FLAGS = new Set(['-depth', '-include', '-exclude', '-filter', '-pattern'])
// Flags that supply the pattern, so every positional operand is a path.
const PATTERN_FLAGS = new Set(['-e', '-f', '--regexp', '--file', '-pattern'])

const isValueFlag = (utility, t) =>
  UNIX_SEARCHES.has(utility) ? VALUE_FLAGS.has(t) : PS_VALUE_FLAGS.has(t.toLowerCase())

/**
 * The arguments of `utility` (`args`, its words after the utility word):
 * { flags, positional, valueAt } where `positional` drops flags, switches and
 * the values of value-taking flags, and `valueAt` is the set of indexes in
 * `args` that are such values.
 */
function parseArgs(utility, args) {
  const flags = []
  const positional = []
  const valueAt = new Set()
  for (let i = 0; i < args.length; i++) {
    const t = args[i]
    if (t.startsWith('-')) {
      flags.push(t)
      if (isValueFlag(utility, t) && i + 1 < args.length) valueAt.add(++i)
    } else if (!SWITCH.test(t)) {
      positional.push([t, i])
    }
  }
  return { flags, positional, valueAt }
}

/** The index in `args` of a content search's pattern operand, or -1. */
function patternIndex(utility, args) {
  if (!SEARCHES.has(utility)) return -1
  const { flags, positional } = parseArgs(utility, args)
  const explicit =
    flags.some((f) => PATTERN_FLAGS.has(f.toLowerCase()) || f.startsWith('--regexp=') || f.startsWith('--file=')) ||
    args.some((a) => /^\/[cg]:/i.test(a))
  return explicit || !positional.length ? -1 : positional[0][1]
}

/** `token`, plus the value of `--flag=value`, `if=value` and `-Param:value`. */
function pathCandidates(token) {
  const out = token.startsWith('-') ? [] : [token]
  if (token.includes('=')) out.push(token.slice(token.indexOf('=') + 1))
  if (token.startsWith('-') && token.includes(':')) out.push(token.slice(token.indexOf(':') + 1))
  return out.filter(Boolean)
}

/** True when a stage names a private_vault directory (the name rule). */
function stageNamesVault(s) {
  if (s.redirs.some(operandNamesVault)) return true
  if (NON_READING.has(s.runner)) return false
  // The command word itself: a vault file run as a program, or a heredoc
  // line that a shell or xargs takes as a file name.
  if (s.words.length && operandNamesVault(s.words[0])) return true
  const args = s.words.slice(1)
  const skip = new Set()
  if (s.runner === 'git' || s.runner === 'gh') {
    args.forEach((a, i) => {
      if (PROSE_FLAGS.has(a)) skip.add(i + 1)
      if (/^--(?:message|body|title|notes)=/.test(a)) skip.add(i)
    })
  }
  // A content search's pattern: its first positional operand, or the value
  // of -e/--regexp/-Pattern. (-f/--file names a file the search reads, so it
  // stays checked.)
  const searchArgs = s.words.slice(s.at + 1)
  const pattern = patternIndex(s.utility, searchArgs)
  if (pattern >= 0) skip.add(s.at + pattern)
  if (SEARCHES.has(s.utility)) {
    searchArgs.forEach((a, i) => {
      if (['-e', '--regexp', '-pattern'].includes(a.toLowerCase())) skip.add(s.at + i + 1)
      if (a.startsWith('--regexp=')) skip.add(s.at + i)
    })
  }
  return args.some(
    (a, i) => !skip.has(i) && (operandNamesVault(a) || pathCandidates(a).some(operandNamesVault)),
  )
}

function dirOf(p) {
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : i === 0 ? '/' : p.slice(0, i)
}

/** Add the cwd as a root when a root does not exist: a flag may have taken it as a value. */
function withCwd(roots, base) {
  const ambiguous = roots.some((r) => !WILDCARD.test(r) && !fs.existsSync(absolutePath(r, base)))
  return ambiguous && !roots.includes('.') ? [...roots, '.'] : roots
}

/** Directories a recursive search or listing in this stage walks, or null. */
function recursiveRoots(s, base) {
  const { utility } = s
  const rest = s.words.slice(s.at + 1)
  const { flags, positional } = parseArgs(utility, rest)
  const plain = positional.map(([t]) => t)
  if (ALWAYS_RECURSIVE.has(utility) || (GREP.has(utility) && flags.some((f) => GREP_RECURSE.test(f)))) {
    const pattern = patternIndex(utility, rest)
    const roots = positional.filter(([, i]) => i !== pattern).map(([t]) => t)
    return roots.length ? withCwd(roots, base) : ['.']
  }
  if (utility === 'tree') return plain.length ? plain : ['.']
  if (utility === 'find') {
    const roots = []
    for (const t of rest) {
      if (t.startsWith('-') || t.startsWith('!')) break
      roots.push(t)
    }
    return roots.length ? roots : ['.']
  }
  const switches = rest.filter((t) => SWITCH.test(t)).map((t) => t.toLowerCase())
  if (utility === 'findstr') {
    if (!switches.some((sw) => sw.split(':')[0].includes('s'))) return null
    const specs = switches.some((sw) => sw.startsWith('/c:') || sw.startsWith('/g:')) ? plain : plain.slice(1)
    return specs.length ? specs.map((sp) => dirOf(sp) || '.') : ['.']
  }
  if (LISTERS.has(utility)) {
    const recurses =
      flags.some((f) => PS_RECURSE.has(f.toLowerCase()) || (!f.startsWith('--') && f.includes('R'))) ||
      switches.includes('/s')
    if (!recurses) return null
    return plain.length ? plain.map((a) => (WILDCARD.test(a) ? dirOf(a) : a) || '.') : ['.']
  }
  return null
}

/** A listing with no path argument lists the cwd (`cd vault && ls`). */
function listsCwd(s) {
  if (!LIST_UTILITIES.has(s.utility) || s.utility === 'wc') return false // wc with no file counts stdin
  return parseArgs(s.utility, s.words.slice(s.at + 1)).positional.length === 0
}

/** A recursive stage rooted at an ancestor of a vault. */
function stageReaches(direct, base, vaults) {
  for (const s of direct) {
    const roots = recursiveRoots(s, base)
    if (!roots) continue
    for (const root of roots) {
      const forms = pathForms(root, base) // realpath once per root, not per vault
      if (vaults.some((v) => aboveVault(forms, v))) return true
    }
  }
  return false
}

/**
 * The matched command name when `command`, or a command nested in it,
 * reads, lists or names vault content, else null. `state` carries the cwd
 * (moved by `cd`) and the vault list across nested scans.
 */
function scanCommand(command, state, flavor, depth = 0) {
  if (depth > MAX_DEPTH) throw new RangeError('nesting')
  const { outer, bodies } = substitutions(command, flavor === 'bash')
  for (const body of bodies) {
    const hit = scanCommand(body, state, flavor, depth + 1)
    if (hit) return hit
  }
  for (const pipeline of pipelines(outer)) {
    const stages = pipeline.filter((s) => s.words.length || s.redirs.length).map(analyse)
    if (!stages.length) continue
    if (stages.length === 1 && CD.has(stages[0].runner)) {
      const { words } = stages[0]
      state.pendingCd.push(words.length > 1 ? words[words.length - 1] : '~')
      continue
    }
    for (const s of stages) {
      const nested = nestedCommand(s)
      const hit = nested && scanCommand(nested.command, state, nested.flavor, depth + 1)
      if (hit) return hit
    }
    const named = stages.find(stageNamesVault)
    if (named) return named.utility || named.runner || 'redirection'
    const hit = stages.find((s) => READ_UTILITIES.has(s.utility) || LIST_UTILITIES.has(s.utility))
    if (!hit) continue
    if (state.vaults === null) state.vaults = vaultDirs()
    if (!state.vaults.length) continue
    for (const target of state.pendingCd) state.base = absolutePath(target, state.base)
    state.pendingCd.length = 0
    const paths = stages.flatMap((s) => [...s.words.slice(1).flatMap(pathCandidates), ...s.redirs])
    if (paths.some((c) => insideVault(c, state.base, state.vaults))) return hit.utility
    // Stages that run their own operands; an xargs stage gets them on stdin.
    const direct = stages.filter((s) => s.at === 0 && (READ_UTILITIES.has(s.utility) || LIST_UTILITIES.has(s.utility)))
    if (direct.some(listsCwd) && insideVault('.', state.base, state.vaults)) return hit.utility
    if (stageReaches(direct, state.base, state.vaults)) return hit.utility
  }
  return null
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

/** { kind, target } when the call would touch vault content, else null. */
function evaluate(payload) {
  const call = toolCall(payload)
  if (!call) return null
  const { tool, input, cwd } = call
  if (SHELL_TOOLS.has(tool)) {
    if (typeof input.command !== 'string' || !input.command) return null
    const state = { base: cwd, pendingCd: [], vaults: null }
    // Literal heredoc bodies are dropped once, here, where the whole command
    // shows whether anything in it runs the text.
    const bash = tool === 'Bash'
    const utility = scanCommand(bash ? dropLiteralHeredocs(input.command) : input.command, state, bash ? 'bash' : 'ps')
    return utility ? { kind: 'shell', target: utility } : null
  }
  const fields = PATH_FIELDS.get(tool)
  if (!fields) return null
  for (const field of fields) {
    if (namesVaultPath(input[field])) return { kind: 'path', target: input[field] }
  }
  const vaults = vaultDirs()
  if (!vaults.length) return null
  if (tool === 'Grep' || tool === 'Glob') {
    const target = reachesVault(tool, input, cwd, vaults)
    return target ? { kind: 'path', target } : null
  }
  const p = input.file_path
  return typeof p === 'string' && p && insideVault(p, cwd, vaults) ? { kind: 'path', target: p } : null
}

function reason({ kind, target }) {
  if (kind === 'shell') {
    return (
      `Vault Privacy Rule: '${target}' against a vault path (private_vault/ or ` +
      `the configured PRIVATE_VAULT_PATH, named or reached by a recursive ` +
      `search or listing from an ancestor) would put vault content or entry ` +
      `names (record IDs) into this transcript. Inspect vault data in a ` +
      `separate terminal; existence checks (Test-Path, test -d) are allowed. ` +
      `See .claude/hooks/${GUARD}.cjs.`
    )
  }
  return (
    `Vault Privacy Rule: vault content (private_vault/ or the configured ` +
    `PRIVATE_VAULT_PATH) may not be read, listed, or edited (matched ` +
    `'${target}'). If this is a search, scope \`path\` to a subdirectory or ` +
    `anchor the pattern (e.g. src/**/*.js). See CLAUDE.md and ` +
    `.claude/hooks/${GUARD}.cjs.`
  )
}

if (require.main === module) main(GUARD, evaluate, reason)

module.exports = { GUARD, reason }
