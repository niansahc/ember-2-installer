// Ollama before 0.35.0 has an unauthenticated /api/pull path traversal
// (CVE-2026-103663, fixed in 0.35.0). Single source of truth for the floor.
const OLLAMA_MIN_VERSION = '0.35.0'

const VERSION_RE = /(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/

// First x.y.z in the line, e.g. "ollama version is 0.35.0". null when absent.
function parseOllamaVersion(line) {
  if (typeof line !== 'string') return null
  const m = VERSION_RE.exec(line)
  if (!m) return null
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], prerelease: m[4] || null }
}

// Missing or unparseable counts as below the floor. A prerelease of the floor
// itself (0.35.0-rc1) is below it, per semver; a prerelease of a later version is not.
function meetsOllamaFloor(line) {
  const v = parseOllamaVersion(line)
  if (!v) return false
  const floor = parseOllamaVersion(OLLAMA_MIN_VERSION).core
  for (let i = 0; i < 3; i++) {
    if (v.core[i] !== floor[i]) return v.core[i] > floor[i]
  }
  return v.prerelease === null
}

module.exports = { OLLAMA_MIN_VERSION, parseOllamaVersion, meetsOllamaFloor }
