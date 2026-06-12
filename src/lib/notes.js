// Pure release-notes helpers. No Electron/Node-runtime deps so this module can
// be required and unit-tested in isolation (main.js can't — it boots the app).

// Extract a short one-line summary from a GitHub release body — the first bullet
// wins. Used by check-all-updates for the update screen "what's new" notes so
// each row shows something more useful than just a version bump.
//
// Note: markdown is stripped only in the bullet branch; the fallback line is
// returned as-is. Behavior preserved from the original firstBullet — see
// tests/e2e/notes.spec.cjs, which locks these cases.
function releaseSummary(body) {
  if (!body) return ''
  const lines = body.split('\n')
  for (const line of lines) {
    const m = line.match(/^\s*[-*]\s+(.+?)\s*$/)
    if (m) {
      return m[1]
        .replace(/\*\*/g, '')
        .replace(/`/g, '')
        .replace(/\[(.+?)\]\(.+?\)/g, '$1')
        .slice(0, 120)
    }
  }
  for (const line of lines) {
    const t = line.trim()
    if (t && !t.startsWith('#') && !t.startsWith('---')) return t.slice(0, 120)
  }
  return ''
}

module.exports = { releaseSummary }
