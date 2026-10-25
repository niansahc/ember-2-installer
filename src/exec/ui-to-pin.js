// Bring the ember-2-ui clone to the pinned release (src/lib/release-pin.js)
// before a build: clone it, move it, or set an unmovable one aside.

const { cloneRepo } = require('./clone')
const { moveToTag, cloneState } = require('./move-to-tag')
const { uiUpdateAction, logStays } = require('./pin-action')
const { installedUiVersion } = require('./installed')
const { replaceWithClone } = require('./aside')

// uiToPin actions after which the UI is built and served again. 'as-is' is a
// developer's full clone, built as it stands.
const uiNeedsBuild = (action) => ['clone', 'update', 'rebuild', 'as-is'].includes(action)

// Whether a build after this action is the pinned release, and so is recorded:
// not a clone ahead of the pin, nor a developer's clone built as it stands.
const uiBuildIsPin = (action) => action !== 'ahead' && action !== 'as-is'

// Clone ember-2-ui when missing, or move it to the pin when it needs it
// (package-lock.json, which npm ci may rewrite, is reset). moveToTag cannot
// move a full clone:
//   - packaged: it is an installer clone from before --depth 1. It is renamed
//     to ember-2-ui.old-<date>, kept, and a pinned clone takes its place (put
//     back if that clone fails).
//   - unpackaged (npm run start:real): it is the developer's working repo,
//     built as it stands and never moved or renamed.
// Resolves { ok: true, action, warning? } or { ok: false, stage, error }; the
// caller builds when uiNeedsBuild(action). A warning is for the user to see.
async function uiToPin({ uiDir, targetUiDir, tag, url, log, packaged, now }) {
  const action = await uiUpdateAction({ uiDir, targetUiDir, tag })
  logStays('ember-2-ui', action, installedUiVersion(uiDir), tag, log)
  const clone = () => cloneRepo({ url, targetDir: uiDir, tag, onData: log })

  if (action === 'clone') {
    log('Cloning ember-2-ui...\n')
    const r = await clone()
    return r.ok ? { ok: true, action } : { ok: false, stage: 'ui-clone', error: `UI clone failed: ${r.error}.` }
  }
  if (action === 'rebuild') log(`The served UI was not built from ${tag}. Rebuilding it.\n`)
  if (action !== 'update') return { ok: true, action }

  if ((await cloneState(uiDir)).state === 'full') {
    if (!packaged) {
      const warning = `${uiDir} is a full git clone (a developer's working repo), so it was built as it stands and not moved to ${tag}.`
      log(`Warning: ${warning}\n`)
      return { ok: true, action: 'as-is', warning }
    }
    log(`${uiDir} is a full git clone from an older installer. Setting it aside and cloning ${tag}...\n`)
    const r = await replaceWithClone({ dir: uiDir, clone, keep: true, now })
    if (!r.ok) {
      const where = r.aside ? '' : ` The previous ember-2-ui is still in ${uiDir}.`
      return { ok: false, stage: 'ui-clone', error: `UI clone failed: ${r.error}.${where}` }
    }
    const warning = `The previous ember-2-ui, a full git clone, was kept at ${r.aside}.`
    log(`${warning}\n`)
    return { ok: true, action: 'clone', warning }
  }

  const r = await moveToTag({ cwd: uiDir, tag, url, onData: log, resetFiles: ['package-lock.json'] })
  if (!r.ok) {
    return {
      ok: false,
      stage: 'ui-move',
      error: `UI update failed: ${r.error}\nThe clone in ${uiDir} is unchanged, so retrying the update is safe.`,
    }
  }
  return { ok: true, action }
}

module.exports = { uiToPin, uiNeedsBuild, uiBuildIsPin }
