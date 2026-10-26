// Build ember-2-ui and serve the result from the backend's ui/ folder
// (src/lib/paths.js uiTargetDir), recording the release it was built from.

const fs = require('fs')
const path = require('path')
const { run, failureReason } = require('./run')
const { TIMEOUTS } = require('./limits')
const { recordBuiltUiTag } = require('./installed')

const removeIfThere = (dir) => {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {}
}

// Put distDir in place of targetUiDir. The copy goes to <target>.new first and
// the served folder is swapped in only once that copy is complete, so a missing
// build or a failed copy leaves the served UI as it was. recordTag, when given,
// is written into the new folder before the swap. Throws on failure.
function serveUi(distDir, targetUiDir, recordTag) {
  const staging = `${targetUiDir}.new`
  const old = `${targetUiDir}.old`
  removeIfThere(staging)
  try {
    if (!fs.existsSync(path.join(distDir, 'index.html'))) throw new Error(`${distDir} has no index.html`)
    fs.cpSync(distDir, staging, { recursive: true })
    if (recordTag) recordBuiltUiTag(staging, recordTag)
  } catch (err) {
    removeIfThere(staging)
    throw err
  }
  removeIfThere(old)
  const served = fs.existsSync(targetUiDir)
  if (served) fs.renameSync(targetUiDir, old)
  try {
    fs.renameSync(staging, targetUiDir)
  } catch (err) {
    if (served) fs.renameSync(old, targetUiDir)
    removeIfThere(staging)
    throw err
  }
  removeIfThere(old)
}

// vite's own entry, run with node from the clone (the shell joins arguments
// unquoted, so the path stays relative to cwd). ember-2-ui's `npm run build`
// script is not used: it also wipes and rewrites ../ember-2/ui itself, before
// serveUi, which would leave no served UI if the build failed part way.
const VITE_BIN = path.join('node_modules', 'vite', 'bin', 'vite.js')

// Read the API key (buildEnv() resolves { env, keyOk, error }: the
// environment with the key baked into the bundle, whether it was read, and
// why not), npm ci, vite build, then serveUi, the only writer of the served
// folder. Without the key nothing is built: the bundle would fail every
// authenticated request, so the served UI is left as it was. The tag is
// recorded only when record is set (the build is the pinned release). A failed
// step's error names its cause (failureReason). exec is run(), replaceable in
// tests.
// Resolves { ok: true, recorded } or { ok: false, stage, error }.
async function buildAndServeUi({ uiDir, targetUiDir, tag, record, buildEnv, log, exec = run }) {
  const { env, keyOk, error } = await buildEnv()
  if (!keyOk) {
    return {
      ok: false,
      stage: 'ui-key',
      error: `Could not read the API key (${error}), so the UI was not rebuilt. The served UI was left as it was.`,
    }
  }

  log('Installing UI dependencies...\n')
  const ci = await exec('npm', ['ci'], { cwd: uiDir, onData: log, timeout: TIMEOUTS.npmCi })
  if (!ci.ok) return { ok: false, stage: 'ui-npm', error: `${failureReason(ci, 'npm ci')}.` }

  log('Building Ember UI...\n')
  const built = await exec('node', [VITE_BIN, 'build'], { cwd: uiDir, env, onData: log, timeout: TIMEOUTS.uiBuild })
  if (!built.ok) return { ok: false, stage: 'ui-build', error: `${failureReason(built, 'The UI build')}.` }

  const recorded = Boolean(record)
  try {
    serveUi(path.join(uiDir, 'dist'), targetUiDir, recorded ? tag : null)
  } catch (err) {
    return { ok: false, stage: 'ui-copy', error: `Failed to copy UI: ${err.message}. The served UI was left as it was.` }
  }
  return { ok: true, recorded }
}

module.exports = { serveUi, buildAndServeUi, VITE_BIN }
