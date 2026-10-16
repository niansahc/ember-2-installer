// Shared fixtures for the .claude/hooks guard tests.
//
// Every fixture lives under a fresh os.tmpdir() directory laid out like the
// real checkouts: <root>/ember-2-installer (CLAUDE_PROJECT_DIR) beside
// <root>/ember-2 (whose .env configures the vault), plus <root>/home (HOME
// and USERPROFILE, for ~ forms). The real .env and the real vault are never
// read: hooks run with CLAUDE_PROJECT_DIR pointed at the fixture and
// PRIVATE_VAULT_PATH removed from their environment. Vault files hold
// synthetic text only.

'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const HOOKS = path.resolve(__dirname, '..', '..', '.claude', 'hooks')

/**
 * A tmp layout. `env`: text of <root>/ember-2/.env (omitted: no .env;
 * `{ dir: true }`: a directory named .env). `dirs`: directories to create,
 * relative to root, each with a synthetic a.json.
 */
function makeFixture({ env, dirs = [] } = {}) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-')))
  const project = path.join(root, 'ember-2-installer')
  const ember2 = path.join(root, 'ember-2')
  const home = path.join(root, 'home')
  for (const d of [project, ember2, home, path.join(project, 'src')]) fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(project, 'src', 'main.js'), '// synthetic\n')
  fs.writeFileSync(path.join(ember2, 'README.md'), 'synthetic\n')
  for (const d of dirs) {
    fs.mkdirSync(path.join(root, d), { recursive: true })
    fs.writeFileSync(path.join(root, d, 'a.json'), '{"text":"synthetic"}\n')
  }
  if (env && typeof env === 'object' && env.dir) fs.mkdirSync(path.join(ember2, '.env'))
  else if (typeof env === 'string') fs.writeFileSync(path.join(ember2, '.env'), env)
  return { root, project, ember2, home, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) }
}

/** The environment a hook process gets: the fixture, never the real config. */
function hookEnv(fixture, extra = {}) {
  const env = { ...process.env }
  delete env.PRIVATE_VAULT_PATH
  delete env.CLAUDE_PROJECT_DIR
  if (fixture) {
    env.CLAUDE_PROJECT_DIR = fixture.project
    env.HOME = fixture.home
    env.USERPROFILE = fixture.home
  }
  return { ...env, ...extra }
}

/**
 * Run a guard as the harness does: payload on stdin. `payload` is an object
 * (JSON-encoded, with `cwd` defaulting to the fixture project) or a raw
 * string. Returns { status, stdout, stderr, decision, reason }.
 */
function runGuard(guard, payload, fixture, extraEnv = {}) {
  let input = payload
  if (typeof payload !== 'string') {
    input = JSON.stringify({ cwd: fixture ? fixture.project : process.cwd(), ...payload })
  }
  const result = spawnSync(process.execPath, [path.join(HOOKS, `${guard}.cjs`)], {
    input,
    env: hookEnv(fixture, extraEnv),
    encoding: 'utf8',
    cwd: fixture ? fixture.project : undefined,
  })
  let decision = null
  let reason = null
  if (result.stdout) {
    const out = JSON.parse(result.stdout).hookSpecificOutput
    decision = out.permissionDecision
    reason = out.permissionDecisionReason
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, decision, reason }
}

/** A tool payload. */
function call(tool, input, extra = {}) {
  return { tool_name: tool, tool_input: input, ...extra }
}

module.exports = { HOOKS, makeFixture, hookEnv, runGuard, call }
