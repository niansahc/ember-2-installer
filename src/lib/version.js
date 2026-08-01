// Pure version-comparison helpers. No Electron/Node-runtime deps so this module
// can be required and unit-tested in isolation (main.js can't — it boots the app).
//
// Inputs reach here from two places: a bare package/version.json string
// ("0.8.1") and a GitHub release tag_name, handed over verbatim. Tags come in
// two forms, because release-please switched to component-prefixed tags on
// 2026-04-30:
//
//   v0.8.0                     bare, and what all three repos cut again
//   ember-2-ui-v0.8.1          component-prefixed
//
// Both parse. We read the three numeric components left-to-right, ignoring an
// optional "<component>-" prefix and an optional leading "v". Anything that
// doesn't parse is treated as incomparable.

// One regex serves both readers below, so the display path and the comparison
// path can't drift apart — a tag that compares correctly also renders correctly.
// Group 1 is the version with any tag prefix removed; groups 2-4 are the
// numeric components.
//
// The component prefix has to be matched explicitly rather than skipped past:
// the repo names contain digits ("ember-2-ui"), so any rule that hunts for the
// first digit lands on the wrong one and yields "2-ui-v0.8.1".
const TAG = /^(?:[A-Za-z][\w.-]*-)?v?((\d+)\.(\d+)\.(\d+).*)$/

// Parse a version string into [major, minor, patch], or null if it doesn't match.
function parse(v) {
  if (typeof v !== 'string') return null
  const m = v.trim().match(TAG)
  return m ? [Number(m[2]), Number(m[3]), Number(m[4])] : null
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

// Strip the tag decoration for display: "ember-2-installer-v0.18.0" and
// "v0.18.0" both render as "0.18.0". Any trailing detail is kept, so a
// prerelease tag still shows its marker. Anything that doesn't match comes back
// untouched — an unexpected tag should still show something rather than blank
// the row it was headed for.
function displayVersion(v) {
  if (typeof v !== 'string') return v
  const m = v.trim().match(TAG)
  return m ? m[1] : v
}

module.exports = { compareVersions, isNewer, displayVersion }
