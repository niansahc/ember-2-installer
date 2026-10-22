// Which URLs the installer may hand to the default browser. Pure (no Electron
// deps) so it can be unit-tested; main.js uses it for open-url, for links and
// window.open (setWindowOpenHandler), and for navigation away from the app page.
//
// The URL is parsed, not prefix-matched, so https://github.com.evil.test and
// http://localhost.evil.test do not pass.

// Download pages, docs and app-store links the renderer opens. Keep in step with
// browserLinks.hosts in docs/network-destinations.json (added by the network-gate
// PR, #47); a test pinning the two equal follows once both have merged.
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

// The Tailscale IP fallback: http://<tailnet IP>:8000, the Ember API port.
const TAILNET_API_PORT = '8000'

// Tailscale addresses come from the CGNAT range 100.64.0.0/10 (100.64.0.0 to
// 100.127.255.255). URL parsing has already normalized the host to dotted decimal.
function isTailnetIp(host) {
  const octets = host.split('.')
  if (octets.length !== 4 || !octets.every((o) => /^\d{1,3}$/.test(o))) return false
  const [a, b] = octets.map(Number)
  return a === 100 && b >= 64 && b <= 127
}

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
  if (parsed.protocol === 'http:') {
    return LOCAL_HTTP_HOSTS.has(host) || (isTailnetIp(host) && parsed.port === TAILNET_API_PORT)
  }
  return false
}

module.exports = { ALLOWED_EXTERNAL_HOSTS, isAllowedExternalUrl }
