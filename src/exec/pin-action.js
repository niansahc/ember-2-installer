// Where an install stands against the pinned release (src/lib/release-pin.js).
// Each update check decides a row from here, from the same files on disk the
// update reads, so the row and the update agree.

const fs = require('fs')
const { run } = require('./run')
const { updateAction } = require('../lib/release-pin')
const { installedBackendVersion, installedUiVersion, builtUiTag, backendSetupTag } = require('./installed')

// updateAction ('update', 'current' or 'ahead'; never a downgrade), plus where
// HEAD is. main between releases carries the last release's version number,
// so an equal version is current only when HEAD is at the pin tag. Without a
// clone to look at (cwd null), the versions decide.
async function pinAction({ cwd, installed, tag }) {
  const action = updateAction({ installed, pinned: tag })
  if (action !== 'current' || !cwd) return action
  const tags = await run('git', ['tag', '--points-at', 'HEAD'], { cwd })
  const atTag = tags.ok && tags.stdout.split(/\r?\n/).some((t) => t.trim() === tag)
  return atTag ? 'current' : 'update'
}

// The UI also has a served build. Adds 'clone' (no clone yet) and 'rebuild'
// (the clone is at the pin but the served UI was not recorded as built from
// it: a build that failed after the move, or one from before the record
// existed). A clone ahead of the pin is never rebuilt.
async function uiUpdateAction({ uiDir, targetUiDir, tag }) {
  if (!fs.existsSync(uiDir)) return 'clone'
  const action = await pinAction({ cwd: uiDir, installed: installedUiVersion(uiDir), tag })
  return action === 'current' && builtUiTag(targetUiDir) !== tag ? 'rebuild' : action
}

// The backend also has its setup: pip, docker and an API restart after the
// source changes. Adds 'finish' (the clone is at the pin but no setup for it
// was recorded as complete: an update that stopped part way, a step that
// failed, or an install from before the record existed). The installed
// version is read from version.json, as the update reads it.
async function backendUpdateAction({ emberPath, tag }) {
  const action = await pinAction({ cwd: emberPath, installed: installedBackendVersion(emberPath), tag })
  return action === 'current' && backendSetupTag(emberPath) !== tag ? 'finish' : action
}

// Log why an install does not move to the pin.
function logStays(name, action, installed, tag, log) {
  if (action === 'current') log(`${name} is already at ${tag}, the release this installer pins.\n`)
  if (action === 'ahead') log(`${name} is at ${installed}, newer than ${tag} (the release this installer pins). Leaving it as is.\n`)
}

module.exports = { pinAction, uiUpdateAction, backendUpdateAction, logStays }
