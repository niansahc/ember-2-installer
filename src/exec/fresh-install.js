// "Start fresh" on the install-location screen: replace an existing ember-2
// install with a new clone of the pinned release.

const fs = require('fs')
const { cloneRepo } = require('./clone')
const { checkInstallerClone } = require('./move-to-tag')
const { replaceWithClone } = require('./aside')

// Clone tag of url into dir, in place of what is there. An existing dir is
// replaced only when it is an installer clone of url (checkInstallerClone):
// the path comes from the renderer, and a developer's working repo or an
// unrelated folder there is refused and left as is. The old install is set
// aside until the new clone is in place (replaceWithClone). Resolves
// replaceWithClone's { ok, error?, aside }, plus refused: true on a refusal.
async function freshInstall({ dir, url, tag, onData, now }) {
  if (fs.existsSync(dir)) {
    const check = await checkInstallerClone({ cwd: dir, url })
    if (!check.ok) {
      const error = `${check.error}. Start fresh replaces only an install the installer made, so it was left as is.`
      return { ok: false, refused: true, error, aside: null }
    }
  }
  return replaceWithClone({ dir, now, clone: () => cloneRepo({ url, targetDir: dir, tag, onData }) })
}

module.exports = { freshInstall }
