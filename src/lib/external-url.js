// Which URLs the installer may hand to the default browser. Pure (no Electron
// deps) so it can be unit-tested; main.js uses it for open-url, for links and
// window.open (setWindowOpenHandler), and for navigation away from the app page.
//
// The URL is parsed, not prefix-matched, so lookalike hosts such as
// github.com.evil.test and localhost.evil.test do not pass.

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

// The user's own Ember over Tailscale Serve: https://<machine>.<tailnet>.ts.net,
// each label letters, digits and inner hyphens.
const TAILNET_HOST = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.){2,}ts\.net$/

// Self.DNSName from `tailscale status --json`, trailing dot stripped. Null when
// the command failed or the output carries no DNSName.
function parseTailscaleDns(result) {
  if (!result || !result.ok) return null
  try {
    const dns = JSON.parse(result.stdout).Self?.DNSName
    return dns ? dns.replace(/\.$/, '') : null
  } catch {
    return null
  }
}

// The one tailnet host open-ember may open, lowercased. Anything else (a port,
// userinfo, an IP, an empty label, fewer labels, another domain) gives null,
// and null makes open-ember fall back to the local API.
function tailnetHostFromDnsName(dns) {
  if (typeof dns !== 'string') return null
  const name = dns.toLowerCase()
  return TAILNET_HOST.test(name) ? name : null
}

// No *.ts.net host is allowed here. The user's own Serve name is opened only by
// main's open-ember handler, which builds the URL itself.
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
    return ALLOWED_EXTERNAL_HOSTS.has(host)
  }
  if (parsed.protocol === 'http:') return LOCAL_HTTP_HOSTS.has(host)
  return false
}

module.exports = { ALLOWED_EXTERNAL_HOSTS, isAllowedExternalUrl, parseTailscaleDns, tailnetHostFromDnsName }
