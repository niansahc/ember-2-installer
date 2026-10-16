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
//     glob component that could match it (priv*, *_vault);
//   - by location, when the directory exists: <installer>/private_vault,
//     <ember-2>/private_vault, and the configured vault.
//
// The configured vault is PRIVATE_VAULT_PATH: the process environment
// first, then the sibling ember-2 checkout's .env (<project>/../ember-2/.env).
// It is resolved the way ember-2's src/core/vault_path.py resolves it:
// stripped, ~ expanded, a relative value against the ember-2 project root
// (never the cwd), then realpath. The value is never printed, deny reasons
// included. A .env that exists but cannot be read is an error, so a deny.
//
// Path tools (Read/Edit/Write/Grep/Glob): a path field that names a vault,
// or resolves to a location at or under an existing vault, is denied.
// Resolution covers relative and ../ forms, ~, Git Bash /c/..., WSL
// /mnt/c/..., drive-relative C:x, the \\?\ device prefix, and, through
// realpath, 8.3 short names, junctions and symlinks. A search rooted inside
// a vault is denied; a search rooted above one is denied when it can reach
// it: Glob when its pattern can descend into the vault, Grep unless an
// anchored glob keeps it out.
//
// Divergence from ember-2: no .gitignore exemption. ember-2 lets Grep with
// no glob, and rg/ag in a shell, skip its gitignored in-project vault. This
// repo does not gitignore private_vault/, and a vault in the sibling
// checkout is ignored only by ripgrep's nested-repo rules, so every vault is
// treated as reachable from an ancestor.
//
// Shell tools (Bash/PowerShell): denies a pipeline that runs a known
// content-reading utility (cat, type, Get-Content, grep, rg, findstr,
// Select-String, ...) or a listing/counting utility (ls, dir, gci, tree,
// find, wc) and names a vault path (operands and flag values: --file=x,
// if=x, -Path:x, -f/x), resolves one against the payload cwd and any `cd`
// earlier in the line, lists the cwd from inside one, or recurses from an
// ancestor of one. Existence checks (Test-Path, test -d) and commands that
// merely name a vault (echo, mkdir) are left alone.
//
// A pattern check on the call, not a sandbox: a path built at runtime
// ($VAR, %VAR%), a different utility, a script, or base64 is not caught.

'use strict'

const fs = require('fs')
const path = require('path')
const {
  SHELL_TOOLS, WILDCARD, absolutePath, commandName, expandUser, fnmatch, main, projectDir, toolCall,
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

/** `key` from a dotenv file, or null. Absent file: null. Unreadable: throws. */
function envFileValue(key, file) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return null
    throw err
  }
  let value = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, '')
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0 || line.slice(0, eq).trim() !== key) continue
    let v = line.slice(eq + 1).trim()
    const quote = v[0]
    if (quote === '"' || quote === "'") {
      const end = v.indexOf(quote, 1)
      v = end > 0 ? v.slice(1, end) : v.slice(1)
      if (quote === '"') v = v.replace(/\\(["\\])/g, '$1')
    } else {
      const hash = v.search(/\s#/)
      if (hash >= 0) v = v.slice(0, hash)
    }
    value = v.trim() || null // last occurrence wins, as in python-dotenv
  }
  return value
}

/** The raw PRIVATE_VAULT_PATH value, or null. Never printed. */
function configuredVault() {
  const value = (process.env[VAULT_KEY] || '').trim()
  if (value) return value
  return envFileValue(VAULT_KEY, path.join(ember2Root(), '.env'))
}

/**
 * Existing vault directories, deduplicated: { path, forms } where `forms` are
 * the realpath and the lexical spelling as components. A glob through a
 * junction name gets no realpath (it has wildcards), so only the lexical
 * form matches it.
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
    const real = realpathLoose(lexicalPath)
    const forms = [components(real), components(absolutePath(raw.trim(), base))]
    const keys = [...new Set(forms.map((f) => f.join('/')))]
    if (keys.some((k) => seen.has(k))) continue
    keys.forEach((k) => seen.add(k))
    vaults.push({ path: real, forms: keys.length === 1 ? [forms[0]] : forms })
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
// Shell commands
// ---------------------------------------------------------------------------

// Whole-file dumps and content searches, lowercase (PowerShell and Windows
// executables are case-insensitive). Deliberately narrow.
const READ_UTILITIES = new Set([
  'cat', 'type', 'more', 'less', 'head', 'tail', 'xxd', 'hexdump', 'od', 'strings', 'get-content', 'gc',
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'findstr', 'select-string', 'sls',
])
// Listing and counting: their output is entry names (record IDs) or a count.
const LIST_UTILITIES = new Set(['ls', 'dir', 'gci', 'get-childitem', 'tree', 'find', 'wc'])
const PUNCTUATION = '();<>|&'
const CD = new Set(['cd', 'chdir', 'pushd', 'set-location', 'sl', 'push-location'])
const ALWAYS_RECURSIVE = new Set(['rg', 'ag', 'ack'])
const GREP = new Set(['grep', 'egrep', 'fgrep'])
const LISTERS = new Set(['get-childitem', 'gci', 'ls', 'dir'])
// PowerShell accepts any unambiguous prefix of -Recurse.
const PS_RECURSE = new Set(['-r', '-re', '-rec', '-recu', '-recur', '-recurs', '-recurse', '--recursive'])
const GREP_RECURSE = /^(?:-[a-zA-Z]*[rR][a-zA-Z]*|--(?:dereference-)?recursive|--directories=recurse)$/
// cmd-style switches (/s, /i, /c:text); a path like /c/x has a second slash.
const SWITCH = /^\/[a-z]+(?::[\s\S]*)?$/i
const PATTERN_FLAGS = new Set(['-e', '-f', '--regexp', '--file'])

/**
 * The command as shell tokens: quote-aware (a `|` inside quotes is part of a
 * word; adjacent quoted and unquoted text join), runs of `();<>|&` as their
 * own tokens, a newline as `;`, `#` at a word start as a comment.
 * Backslashes become `/` first so Windows paths survive. Unbalanced quotes:
 * null (no match), as ember-2's shlex path does.
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

/** Pipelines (separated by ; && || & or newline) of pipe stages of tokens. */
function pipelines(command) {
  const tokens = shellTokens(command)
  if (!tokens) return []
  const out = [[[]]]
  for (const token of tokens) {
    const last = out[out.length - 1]
    if (token === '|') last.push([])
    else if (token === '||' || token === '&&' || token === '&' || token.includes(';')) out.push([[]])
    else if (![...token].every((ch) => PUNCTUATION.includes(ch)) || token === '') last[last.length - 1].push(token)
  }
  return out
}

/** The stage's command name; for `xargs [flags] cmd`, the command xargs runs. */
function utilityOf(tokens) {
  const name = commandName(tokens[0])
  if (name === 'xargs') {
    const run = tokens.slice(1).find((t) => !t.startsWith('-'))
    return run === undefined ? name : commandName(run)
  }
  return name
}

/** Positional arguments: not flags, not cmd-style switches. */
function operands(tokens) {
  return tokens.slice(1).filter((t) => !t.startsWith('-') && !SWITCH.test(t))
}

/** `token`, plus the value of `--flag=value`, `if=value` and `-Param:value`. */
function pathCandidates(token) {
  const out = token.startsWith('-') ? [] : [token]
  if (token.includes('=')) out.push(token.slice(token.indexOf('=') + 1))
  if (token.startsWith('-') && token.includes(':')) out.push(token.slice(token.indexOf(':') + 1))
  return out.filter(Boolean)
}

function dirOf(p) {
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : i === 0 ? '/' : p.slice(0, i)
}

/** Directories a recursive search or listing in this stage walks, or null. */
function recursiveRoots(tokens, utility) {
  const rest = tokens.slice(1)
  const flags = rest.filter((t) => t.startsWith('-'))
  const args = rest.filter((t) => !t.startsWith('-'))
  const plain = operands(tokens)
  if (ALWAYS_RECURSIVE.has(utility) || (GREP.has(utility) && flags.some((f) => GREP_RECURSE.test(f)))) {
    const explicitPattern = flags.some(
      (f) => PATTERN_FLAGS.has(f) || f.startsWith('--regexp=') || f.startsWith('--file='),
    )
    const roots = explicitPattern ? args : args.slice(1)
    return roots.length ? roots : ['.']
  }
  if (utility === 'tree') return plain.length ? plain : ['.']
  if (utility === 'find') {
    const roots = []
    for (const t of rest) {
      if (t.startsWith('-') || t.startsWith('(') || t.startsWith('!')) break
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
function listsCwd(tokens, utility) {
  if (!LIST_UTILITIES.has(utility) || utility === 'wc') return false // wc with no file counts stdin
  return operands(tokens).length === 0
}

/** A recursive stage rooted at an ancestor of a vault. */
function stageReaches(direct, base, vaults) {
  for (const [tokens, utility] of direct) {
    const roots = recursiveRoots(tokens, utility)
    if (!roots) continue
    for (const root of roots) {
      const forms = pathForms(root, base) // realpath once per root, not per vault
      if (vaults.some((v) => aboveVault(forms, v))) return true
    }
  }
  return false
}

/**
 * The matched utility when a pipeline runs a content-reading, listing or
 * counting utility against a vault path, else null.
 */
function commandReadsVault(command, cwd) {
  let base = cwd
  const pendingCd = []
  let vaults = null
  for (const pipeline of pipelines(command)) {
    const stages = pipeline.filter((tokens) => tokens.length)
    if (!stages.length) continue
    const utilities = stages.map(utilityOf)
    if (stages.length === 1 && CD.has(utilities[0])) {
      pendingCd.push(stages[0].length > 1 ? stages[0][stages[0].length - 1] : '~')
      continue
    }
    const hit = utilities.find((u) => READ_UTILITIES.has(u) || LIST_UTILITIES.has(u))
    if (!hit) continue
    const args = stages.flatMap((tokens) => tokens.slice(1))
    const paths = args.flatMap(pathCandidates)
    const flags = args.filter((t) => t.startsWith('-'))
    if ([...paths, ...flags].some(namesVaultPath)) return hit
    if (vaults === null) vaults = vaultDirs()
    if (!vaults.length) continue
    for (const target of pendingCd) base = absolutePath(target, base)
    pendingCd.length = 0
    if (paths.some((c) => insideVault(c, base, vaults))) return hit
    // Stages that run their own operands; an xargs stage gets them on stdin.
    const direct = stages.map((tokens, i) => [tokens, utilities[i]]).filter(([tokens, u]) => commandName(tokens[0]) === u)
    if (direct.some(([tokens, u]) => listsCwd(tokens, u)) && insideVault('.', base, vaults)) return hit
    if (stageReaches(direct, base, vaults)) return hit
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
    const utility = commandReadsVault(input.command, cwd)
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
