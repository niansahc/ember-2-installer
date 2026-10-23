// Which URLs the installer may hand to the default browser. Pure (no Electron
// deps) so it can be unit-tested; main.js uses it for open-url, for links and
// window.open (setWindowOpenHandler), and for navigation away from the app page.
//
// The URL is parsed, not prefix-matched, so https://github.com.evil.test and
// http://localhost.evil.test do not pass.

// Download pages, docs and app-store links the renderer opens. Must equal
// browserLinks.hosts in docs/network-destinations.json; tests/netgate/
// declared-drift.test.cjs fails when the two differ.
const ALLOWED_EXTERNAL_HOSTS = new Set([
  'github.com',
  'git-scm.com',
  'www.python.org',
  'nodejs.org',
  'ollama.com',
  'www.docker.com',
  'brew.sh',
  'tailscale.com',
  'apps.apple.com',
  'play.google.com',
])

// The local Ember UI, served by the API on this machine.
const LOCAL_HTTP_HOSTS = new Set(['localhost', '127.0.0.1'])

// The user's own Ember over Tailscale Serve: https://<machine>.<tailnet>.ts.net
const TAILNET_SUFFIX = '.ts.net'

function isAllowedExternalUrl(url) {
  if (typeof url !== 'string') return false
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.username || parsed.password) return false
  const host = parsed.hostname
  if (parsed.protocol === 'https:') {
    return ALLOWED_EXTERNAL_HOSTS.has(host) || host.endsWith(TAILNET_SUFFIX)
  }
  if (parsed.protocol === 'http:') return LOCAL_HTTP_HOSTS.has(host)
  return false
}

module.exports = { ALLOWED_EXTERNAL_HOSTS, isAllowedExternalUrl }
