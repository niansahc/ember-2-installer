// Where an install stands against the pinned release (src/lib/release-pin.js).
// The update checks and the updates both decide from here, so a row that
// offers an update and the update that applies it always agree.

const fs = require('fs')
const { run } = require('./run')
const { updateAction } = require('../lib/release-pin')
const { installedUiVersion, builtUiTag } = require('./installed')

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
// (the clone is at the pin but the served UI was not built from it: a build
// that failed after the move, or one from before the record existed).
async function uiUpdateAction({ uiDir, targetUiDir, tag }) {
  if (!fs.existsSync(uiDir)) return 'clone'
  const action = await pinAction({ cwd: uiDir, installed: installedUiVersion(uiDir), tag })
  return action === 'current' && builtUiTag(targetUiDir) !== tag ? 'rebuild' : action
}

module.exports = { pinAction, uiUpdateAction }
