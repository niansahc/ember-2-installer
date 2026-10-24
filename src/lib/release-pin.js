// The ember-2 / ember-2-ui release this installer pins. Pure (no Electron/fs
// deps) so it can be unit-tested; main.js reads package.json and passes it in.
//
// package.json "emberRelease" names one version for both repos; the installer
// clones and updates them to tag v<emberRelease>, never main. It equals the
// installer "version" in a coordinated release; an installer-only patch keeps
// the previous value, so the tags it names always exist.

const { compareVersions } = require('./version')

const SEMVER = /^\d+\.\d+\.\d+$/

// v<emberRelease>. Throws on a missing or malformed pin: the value is
// interpolated into git commands, so only a plain x.y.z is accepted.
function releaseTag(pkg) {
  const pin = pkg && pkg.emberRelease
  if (typeof pin !== 'string' || !SEMVER.test(pin)) {
    throw new Error(`package.json emberRelease must be x.y.z, got ${JSON.stringify(pin)}`)
  }
  return `v${pin}`
}

// What an update does to one install. Never a downgrade:
//   'update'  - the pin is newer than the installed version, or the installed
//               version is unknown (nothing to compare, so move to the pin)
//   'current' - installed equals the pin
//   'ahead'   - installed is newer than the pin; it stays where it is
function updateAction({ installed, pinned }) {
  const c = compareVersions(pinned, installed)
  if (c === 1 || c === null) return 'update'
  return c === 0 ? 'current' : 'ahead'
}

module.exports = { releaseTag, updateAction, SEMVER }
