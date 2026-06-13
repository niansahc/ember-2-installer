// Pure version-comparison helpers. No Electron/Node-runtime deps so this module
// can be required and unit-tested in isolation (main.js can't — it boots the app).
//
// Ember tags are simple vMAJOR.MINOR.PATCH (e.g. v0.8.1, v0.17.0). We compare
// the three numeric components left-to-right, ignoring a single leading "v" on
// either side. Anything that doesn't parse is treated as incomparable.

// Parse a version string into [major, minor, patch], or null if it doesn't match.
function parse(v) {
  if (typeof v !== 'string') return null
  const m = v.trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

// Returns -1 if a < b, 0 if equal, 1 if a > b, or null if either is unparseable.
function compareVersions(a, b) {
  const pa = parse(a)
  const pb = parse(b)
  if (!pa || !pb) return null
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1
    if (pa[i] > pb[i]) return 1
  }
  return 0
}

// True only when `latest` is strictly greater than `installed`. False for equal,
// downgrade, or anything incomparable (never throws) — callers add their own
// guard for the "installed unknown" case.
function isNewer(latest, installed) {
  return compareVersions(latest, installed) === 1
}

module.exports = { compareVersions, isNewer }
