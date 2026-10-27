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

// The user's own Ember over Tailscale Serve: https://<machine>.<tailnet>.ts.net
const TAILNET_SUFFIX = '.ts.net'

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

// One DNS label: letters, digits and inner hyphens.
const DNS_LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/

// The one tailnet host open-url may allow: <machine>.<tailnet>.ts.net, as a
// plain hostname. Anything else (a port, userinfo, an IP, an empty label, fewer
// labels, another domain) gives null, and null allows no *.ts.net host at all.
function tailnetHostFromDnsName(dns) {
  if (typeof dns !== 'string') return null
  const name = dns.toLowerCase().replace(/\.$/, '')
  const labels = name.split('.')
  if (!name.endsWith(TAILNET_SUFFIX) || labels.length < 4 || !labels.every((l) => DNS_LABEL.test(l))) return null
  return name
}

// tailnetHost is the user's own Serve name as main read it from Tailscale. It
// is re-validated here, so a bad value cannot widen the list.
function isAllowedExternalUrl(url, { tailnetHost = null } = {}) {
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
    const ownTailnetHost = tailnetHostFromDnsName(tailnetHost)
    return ALLOWED_EXTERNAL_HOSTS.has(host) || (ownTailnetHost !== null && host === ownTailnetHost)
  }
  if (parsed.protocol === 'http:') return LOCAL_HTTP_HOSTS.has(host)
  return false
}

module.exports = { ALLOWED_EXTERNAL_HOSTS, isAllowedExternalUrl, parseTailscaleDns, tailnetHostFromDnsName }
