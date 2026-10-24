// Build ember-2-ui and serve the result from the backend's ui/ folder
// (src/lib/paths.js uiTargetDir), recording the release it was built from.

const fs = require('fs')
const path = require('path')
const { run } = require('./run')
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

// npm ci, npm run build with the environment buildEnv() resolves ({ env,
// keyOk }: the API key baked into the bundle, and whether it was read), then
// serveUi. The tag is recorded only when record is set (the build is the
// pinned release) and the key was read: a build without the key fails every
// authenticated request, and with no record the next update check offers a
// rebuild. exec is run(), replaceable in tests.
// Resolves { ok: true, recorded } or { ok: false, stage, error }.
async function buildAndServeUi({ uiDir, targetUiDir, tag, record, buildEnv, log, exec = run }) {
  log('Installing UI dependencies...\n')
  if (!(await exec('npm', ['ci'], { cwd: uiDir, onData: log })).ok) {
    return { ok: false, stage: 'ui-npm', error: 'npm ci failed.' }
  }

  const { env, keyOk } = await buildEnv()
  log('Building Ember UI...\n')
  if (!(await exec('npm', ['run', 'build'], { cwd: uiDir, env, onData: log })).ok) {
    return { ok: false, stage: 'ui-build', error: 'UI build failed.' }
  }

  const recorded = Boolean(record && keyOk)
  try {
    serveUi(path.join(uiDir, 'dist'), targetUiDir, recorded ? tag : null)
  } catch (err) {
    return { ok: false, stage: 'ui-copy', error: `Failed to copy UI: ${err.message}. The served UI was left as it was.` }
  }
  if (record && !keyOk) {
    log(`The UI was built without the API key, so it is not recorded as built from ${tag}; the next update check offers a rebuild.\n`)
  }
  return { ok: true, recorded }
}

module.exports = { serveUi, buildAndServeUi }
