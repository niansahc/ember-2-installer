// What is installed on disk: the backend and UI versions as release-please
// writes them, and the tag the served UI was built from. Every read resolves
// null when the file is missing or unreadable, or the value is not a string.

const fs = require('fs')
const path = require('path')

// Written into the served UI directory (uiTargetDir) after a build is copied
// there, so the update checks know which release the served UI came from.
const BUILT_UI_FILE = 'ember-ui-build.json'

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return null
  }
}

const nonEmptyString = (v) => (typeof v === 'string' && v ? v : null)

// Backend version.json { version }. Only .version counts, as in ember-2's
// /api/health: a { tag } file written by older installers reads as unknown,
// so the update moves it to the pin and the reset restores the tracked file.
function installedBackendVersion(emberPath) {
  return nonEmptyString(readJson(path.join(emberPath, 'version.json'))?.version)
}

function installedUiVersion(uiDir) {
  return nonEmptyString(readJson(path.join(uiDir, 'package.json'))?.version)
}

// The tag the served UI was built from. null for a build from before the
// record existed, or when the served UI is missing.
function builtUiTag(targetUiDir) {
  return nonEmptyString(readJson(path.join(targetUiDir, BUILT_UI_FILE))?.tag)
}

function recordBuiltUiTag(targetUiDir, tag) {
  fs.writeFileSync(path.join(targetUiDir, BUILT_UI_FILE), `${JSON.stringify({ tag })}\n`, 'utf-8')
}

module.exports = { installedBackendVersion, installedUiVersion, builtUiTag, recordBuiltUiTag, BUILT_UI_FILE }
