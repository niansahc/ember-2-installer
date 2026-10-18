// .claude/hooks/vault-guard.cjs
//
// PreToolUse hook for Read|Grep|Glob|Edit|Write|Bash|PowerShell: denies
// agent tool calls that would read, list, or edit vault content.
//
// Why: vault contents (record text, names, record IDs in file names) must
// never enter the session transcript (CLAUDE.md, Vault Privacy Rule).
//
// Threat model: this guard stops an agent from exposing vault content by
// accident, through a read, search or listing it runs while working. It is
// a pattern check on the tool call, not a sandbox, and it does not defend
// against deliberate evasion (paths built at runtime, encoded commands,
// scripts or interpreters that open files themselves).
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
// parsed and interpolated as ember-2's load_dotenv(env_file) does
// (python-dotenv, override=False): ${VAR} and ${VAR:-default} take the
// process environment first, then earlier keys in the file, then the
// default. It is resolved the way ember-2's src/core/vault_path.py resolves
// it: stripped, ~ expanded, a relative value against the ember-2 project
// root (never the cwd), then realpath. The value is never printed, deny
// reasons included. A .env that exists but cannot be read, a value with a
// `${` left after interpolation, or a vault location that cannot be checked
// (a stat error other than "not there") is an error, so a deny.
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
// Shell tools (Bash/PowerShell). The command is parsed by parseShell
// (hook-utils.cjs: quotes, escapes, substitutions, heredocs) into
// pipelines and pipe stages. Command substitution ($(...), and in Bash
// backticks and <(...) >(...)), the command lines run by the programs in
// SHELLS (bash/sh/zsh/fish/csh -c, pwsh -Command, cmd /c, eval, wsl), and
// groups ( ... ) and { ... } are scanned as commands of their own. A
// heredoc body is scanned as commands too, unless it is literal text an
// inert consumer receives (literalHeredocs in hook-utils.cjs: a quoted
// delimiter, fed to tee, git commit -F -, gh --body-file -, or to cat in a
// git/gh message value); Bash runs the substitutions in an unquoted body, so
// they are always scanned. Leading shell keywords (if, then, do, !, ...),
// VAR=value words and the wrappers sudo, env, time, nice and nohup are
// skipped to find the command a stage runs. The words a substitution
// prints (its own words and heredoc text) count as operands of the word it
// sits in: cat $(echo private_vault/a.json) names the vault. Then:
//   - name rule: a stage whose command word, operands, flag values
//     (--file=x, if=x, -Path:x) or redirections name a private_vault
//     directory is denied, whatever the command, except the pattern operand
//     of a content search and the message of git/gh -m/--body/--title/
//     --notes. Commands that only print or test their arguments (echo,
//     printf, test, Test-Path, Write-Output, mkdir) are checked on their
//     redirections only;
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
// Nesting limit: substitutions, nested shells and heredoc bodies are
// followed MAX_DEPTH (8) levels deep. A command nested deeper is denied
// with a reason that names the nesting limit.
//
// Known limits: a path built at runtime ($VAR, %VAR%), a different utility,
// a script, or base64 is not caught. A literal path containing a wildcard
// character (`[`, `*`, `?`) gets no realpath, so a junction named `[x]`
// that points into the vault is matched only by its lexical spelling.

'use strict'

const fs = require('fs')
const path = require('path')
const {
  MAX_DEPTH, NestingLimit, SHELL_TOOLS, WILDCARD, absolutePath, commandName, commandStart, expandUser, fnmatch,
  literalHeredocs, main, nestedCommand, parseShell, pipelines, projectDir, proseValues, toolCall,
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
 * python-dotenv resolve_variables(override=False), the mode ember-2's
 * load_dotenv(env_file) uses: each value's ${VAR} and ${VAR:-default} from
 * the process environment, then the keys resolved so far, then the
 * default, then "".
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
        if (process.env[name] !== undefined) return process.env[name]
        if (values.has(name)) return values.get(name) ?? ''
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
 * Existing vault directories, each as { forms, keys }: `forms` the
 * spellings that name it as components (the realpath and every lexical
 * spelling a candidate gave), `keys` the same joined, for deduplication. A
 * candidate that is another spelling of a vault already listed (a junction
 * alias of it) adds its forms to that entry: a glob through the alias name
 * gets no realpath (it has wildcards), so only the alias spelling can
 * match it.
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
  for (const [raw, base] of candidates) {
    // vault_path.py: strip, ~, relative against the root, realpath. stat
    // follows junctions and symlinks, so a missing vault (the usual case
    // for the private_vault candidates) costs one syscall and no realpath.
    const lexicalPath = path.resolve(base, expandUser(raw.trim()))
    let stat
    try {
      stat = fs.statSync(lexicalPath, { throwIfNoEntry: false })
    } catch (err) {
      // Only "not there" means no vault; any other error is a deny.
      if (!err || (err.code !== 'ENOENT' && err.code !== 'ENOTDIR')) throw err
    }
    if (!stat || !stat.isDirectory()) continue
    const forms = [components(realpathLoose(lexicalPath)), components(absolutePath(raw.trim(), base))]
    const keys = forms.map((f) => f.join('/'))
    let vault = vaults.find((v) => keys.some((k) => v.keys.has(k)))
    if (!vault) {
      vault = { forms: [], keys: new Set() }
      vaults.push(vault)
    }
    forms.forEach((f, k) => {
      if (vault.keys.has(keys[k])) return
      vault.keys.add(keys[k])
      vault.forms.push(f)
    })
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
// Shell commands: stages
// ---------------------------------------------------------------------------

/** Heredoc text as words: a body is text, so only blanks and punctuation split it. */
function bodyWords(text) {
  return text.replace(/\\/g, '/').split(/[\s'"`;|&<>(){}]+/).filter(Boolean)
}

/**
 * The words a substitution can print, and so add to the word it sits in:
 * every word in it, in the substitutions nested in it, and in its heredoc
 * bodies.
 */
function outputWords(script, level) {
  if (level > MAX_DEPTH) throw new NestingLimit()
  const out = []
  for (const token of script.tokens) {
    if (typeof token === 'string') continue
    if (token.heredoc) {
      out.push(...bodyWords(token.heredoc.body))
      continue
    }
    if (token.text) out.push(token.text)
    for (const sub of token.subs) out.push(...outputWords(sub, level + 1))
  }
  return out
}

/**
 * A parsed stage as { words, output, prose, redirs, heredocs, runner,
 * utility, at }: `words` the texts from the command the stage runs,
 * `output[k]` the words the substitutions in words[k] print (none for a
 * git/gh message value), `prose` the indexes of message values, `redirs`
 * the redirection targets with their substitutions' words, `runner` the
 * command, `utility` the one that reads (for `xargs [flags] cmd`, cmd) and
 * `at` the index of the utility word in `words`.
 */
function analyse(stage, level) {
  const start = commandStart(stage.words.map((w) => w.text))
  const parsed = stage.words.slice(start)
  const words = parsed.map((w) => w.text)
  const runner = words.length ? commandName(words[0]) : ''
  let at = 0
  if (runner === 'xargs') {
    const i = words.findIndex((w, k) => k > 0 && !w.startsWith('-'))
    if (i > 0) at = i
  }
  const prose = proseValues(words)
  const printed = (w) => w.subs.flatMap((sub) => outputWords(sub, level + 1))
  return {
    words,
    output: parsed.map((w, k) => (prose.has(k) ? [] : printed(w))),
    prose,
    redirs: stage.redirs.flatMap((w) => [w.text, ...printed(w)]).filter(Boolean),
    heredocs: stage.heredocs,
    runner,
    utility: words.length ? commandName(words[at]) : '',
    at,
  }
}

// ---------------------------------------------------------------------------
// Shell commands: rules
// ---------------------------------------------------------------------------

// Content searches: the first positional operand is a pattern, not a path.
// The Unix ones take the case-sensitive value flags below.
const UNIX_SEARCHES = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack'])
const SEARCHES = new Set([...UNIX_SEARCHES, 'findstr', 'select-string', 'sls'])
// Whole-file dumps and content searches, lowercase (PowerShell and Windows
// executables are case-insensitive). Deliberately narrow.
const READ_UTILITIES = new Set([
  'cat', 'type', 'more', 'less', 'head', 'tail', 'xxd', 'hexdump', 'od', 'strings', 'get-content', 'gc',
  ...SEARCHES,
])
// Listing and counting: their output is entry names (record IDs) or a count.
const LIST_UTILITIES = new Set(['ls', 'dir', 'gci', 'get-childitem', 'tree', 'find', 'wc'])
// Commands that only print or test their arguments: name rule on redirections only.
const NON_READING = new Set(['echo', 'printf', 'test', '[', '[[', 'test-path', 'write-output', 'write-host', 'mkdir'])
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
// and the roots. The Unix search flags are case-sensitive and apply to
// UNIX_SEARCHES only; the PowerShell ones are not, and apply elsewhere.
const VALUE_FLAGS = new Set([
  '-A', '-B', '-C', '-m', '-g', '-t', '-T', '-j', '-e', '-f',
  '--after-context', '--before-context', '--context', '--max-count', '--glob', '--iglob',
  '--type', '--type-not', '--threads', '--regexp', '--file',
])
const PS_VALUE_FLAGS = new Set(['-depth', '-include', '-exclude', '-filter', '-pattern'])
// Flags that supply the pattern, so every positional operand is a path.
const PATTERN_FLAGS = new Set(['-e', '-f', '--regexp', '--file', '-pattern'])
// Of those, the ones whose value is the pattern itself (not a file to read).
const PATTERN_VALUE_FLAGS = new Set(['-e', '--regexp', '-pattern'])

const isValueFlag = (utility, t) =>
  UNIX_SEARCHES.has(utility) ? VALUE_FLAGS.has(t) : PS_VALUE_FLAGS.has(t.toLowerCase())

/**
 * The arguments of `utility` (`args`, its words after the utility word):
 * { flags, positional } where `positional` ([word, index in args]) drops
 * flags, switches and the values of value-taking flags.
 */
function parseArgs(utility, args) {
  const flags = []
  const positional = []
  for (let i = 0; i < args.length; i++) {
    const t = args[i]
    if (t.startsWith('-')) {
      flags.push(t)
      if (isValueFlag(utility, t)) i++
    } else if (!SWITCH.test(t)) {
      positional.push([t, i])
    }
  }
  return { flags, positional }
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

const namesVaultOperand = (w) => operandNamesVault(w) || pathCandidates(w).some(operandNamesVault)

/** True when a stage names a private_vault directory (the name rule). */
function stageNamesVault(s) {
  if (s.redirs.some(operandNamesVault)) return true
  if (NON_READING.has(s.runner)) return false
  // The command word itself: a vault file run as a program, or a heredoc
  // line that a shell or xargs takes as a file name.
  if (s.words.length && operandNamesVault(s.words[0])) return true
  // Indexes in s.words not checked: git/gh message values, and a content
  // search's pattern (its first positional operand, or the value of
  // -e/--regexp/-Pattern; -f/--file names a file the search reads, so it
  // stays checked).
  const skip = new Set(s.prose)
  const searchArgs = s.words.slice(s.at + 1)
  const pattern = patternIndex(s.utility, searchArgs)
  if (pattern >= 0) skip.add(s.at + 1 + pattern)
  if (SEARCHES.has(s.utility)) {
    searchArgs.forEach((a, i) => {
      if (PATTERN_VALUE_FLAGS.has(a.toLowerCase())) skip.add(s.at + 2 + i)
      if (a.startsWith('--regexp=')) skip.add(s.at + 1 + i)
    })
  }
  return s.words.some((a, k) => k > 0 && !skip.has(k) && [a, ...s.output[k]].some(namesVaultOperand))
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
 * The matched command name when `command` (Bash or PowerShell text), or a
 * command nested in it, reads, lists or names vault content, else null.
 * `state` carries the cwd (moved by `cd`) and the vault list across nested
 * scans. Throws NestingLimit past MAX_DEPTH levels.
 */
function scanCommand(command, state, flavor, level) {
  const script = parseShell(command, flavor, level)
  const literal = flavor === 'bash' ? literalHeredocs(script) : new Set()
  return scanScript(script, state, literal, level)
}

function scanScript(script, state, literal, level) {
  if (level > MAX_DEPTH) throw new NestingLimit()
  // Substitutions run first, as commands of their own.
  for (const token of script.tokens) {
    if (typeof token === 'string' || token.heredoc) continue
    for (const sub of token.subs) {
      const hit = scanScript(sub, state, literal, level + 1)
      if (hit) return hit
    }
  }
  for (const pipeline of pipelines(script)) {
    const stages = pipeline.map((st) => analyse(st, level))
    // Heredocs: the substitutions Bash runs in an unquoted body, and every
    // body that is not literal text for an inert consumer, as commands.
    for (const h of stages.flatMap((s) => s.heredocs)) {
      for (const sub of h.subs) {
        const hit = scanScript(sub, state, literal, level + 1)
        if (hit) return hit
      }
      const hit = !literal.has(h) && scanCommand(h.body, state, 'bash', level + 1)
      if (hit) return hit
    }
    if (stages.length === 1 && CD.has(stages[0].runner)) {
      const { words } = stages[0]
      state.pendingCd.push(words.length > 1 ? words[words.length - 1] : '~')
      continue
    }
    for (const s of stages) {
      const nested = nestedCommand(s.runner, s.words.slice(1))
      const hit = nested && scanCommand(nested.command, state, nested.flavor, level + 1)
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
    const paths = stages.flatMap((s) => [
      ...s.words.slice(1).flatMap(pathCandidates),
      ...s.output.slice(1).flat().flatMap(pathCandidates),
      ...s.redirs,
    ])
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

/** { kind, target, tool } when the call would touch vault content, else null. */
function evaluate(payload) {
  const call = toolCall(payload)
  if (!call) return null
  const { tool, input, cwd } = call
  if (SHELL_TOOLS.has(tool)) {
    if (typeof input.command !== 'string' || !input.command) return null
    const state = { base: cwd, pendingCd: [], vaults: null }
    try {
      const utility = scanCommand(input.command, state, tool === 'Bash' ? 'bash' : 'ps', 0)
      return utility ? { kind: 'shell', target: utility, tool } : null
    } catch (err) {
      if (err instanceof NestingLimit) return { kind: 'nesting', target: null, tool }
      throw err
    }
  }
  const fields = PATH_FIELDS.get(tool)
  if (!fields) return null
  for (const field of fields) {
    if (namesVaultPath(input[field])) return { kind: 'path', target: input[field], tool }
  }
  const vaults = vaultDirs()
  if (!vaults.length) return null
  if (tool === 'Grep' || tool === 'Glob') {
    const target = reachesVault(tool, input, cwd, vaults)
    return target ? { kind: 'path', target, tool } : null
  }
  const p = input.file_path
  return typeof p === 'string' && p && insideVault(p, cwd, vaults) ? { kind: 'path', target: p, tool } : null
}

function reason({ kind, target, tool }) {
  if (kind === 'nesting') {
    return (
      `Vault Privacy Rule: this command nests substitutions, shells or heredocs ` +
      `past the nesting limit (${MAX_DEPTH} levels), so it cannot be checked for ` +
      `vault reads and is denied. Split it into simpler commands. See ` +
      `.claude/hooks/${GUARD}.cjs.`
    )
  }
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
  const advice =
    tool === 'Grep' || tool === 'Glob'
      ? ` If this is a search, scope \`path\` to a subdirectory or anchor the pattern (e.g. src/**/*.js).`
      : ''
  return (
    `Vault Privacy Rule: vault content (private_vault/ or the configured ` +
    `PRIVATE_VAULT_PATH) may not be read, listed, or edited (matched ` +
    `'${target}').${advice} See CLAUDE.md and .claude/hooks/${GUARD}.cjs.`
  )
}

if (require.main === module) main(GUARD, evaluate, reason)

module.exports = { GUARD, reason }
