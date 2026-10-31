// docs/network-destinations.json vs src/: every host literal in the installer
// source and every winget package id must be accounted for in the declared
// list, so a new destination cannot ship without a declaration.

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const REPO = path.resolve(__dirname, '..', '..')
const { ALLOWED_EXTERNAL_HOSTS } = require('../../src/lib/external-url')
const declared = JSON.parse(fs.readFileSync(path.join(REPO, 'docs', 'network-destinations.json'), 'utf8'))

// Literals that are not destinations. Each needs a reason.
const NOT_DESTINATIONS = [
  { match: (h) => h === '127.0.0.1' || h === 'localhost', reason: 'loopback (local API, open-url allowlist)' },
  { match: (h) => h === 'www.apple.com', reason: 'plist DOCTYPE identifier, never fetched' },
  { match: (h) => h === 'ember-desktop' || h.endsWith('.example.ts.net'), reason: 'demo-mode fake Tailscale status' },
]

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return sourceFiles(p)
    return /\.(js|cjs|html)$/.test(e.name) ? [p] : []
  })
}

function hostLiterals(text) {
  const hosts = new Set()
  for (const m of text.matchAll(/https?:\/\/([a-zA-Z0-9.-]+)/g)) hosts.add(m[1].toLowerCase())
  for (const m of text.matchAll(/hostname:\s*'([^']+)'/g)) hosts.add(m[1].toLowerCase())
  return hosts
}

function wingetIds(mainJs) {
  const block = (mainJs.match(/const WINGET_PACKAGES = \{([\s\S]*?)\}/) || [])[1] || ''
  return [...block.matchAll(/:\s*'([^']+)'/g)].map((m) => m[1])
}

function undeclared(texts, list) {
  const known = new Set([...list.destinations.map((d) => d.host), ...list.browserLinks.hosts])
  const missingHosts = []
  for (const t of texts) {
    for (const h of hostLiterals(t)) {
      if (!known.has(h) && !NOT_DESTINATIONS.some((n) => n.match(h))) missingHosts.push(h)
    }
  }
  const pkgs = new Set(list.destinations.flatMap((d) => d.wingetPackages || []))
  const missingPkgs = texts.flatMap(wingetIds).filter((id) => !pkgs.has(id))
  return { missingHosts: [...new Set(missingHosts)].sort(), missingPkgs }
}

const srcTexts = sourceFiles(path.join(REPO, 'src')).map((f) => fs.readFileSync(f, 'utf8'))

// Hosts in one list and not the other. Empty both ways means the lists match.
function hostSetDiff(allowlist, browserHosts) {
  const a = new Set(allowlist)
  const b = new Set(browserHosts)
  return {
    onlyInAllowlist: [...a].filter((h) => !b.has(h)).sort(),
    onlyInDeclared: [...b].filter((h) => !a.has(h)).sort(),
  }
}

test('every host literal and winget id in src/ is declared', () => {
  assert.deepEqual(undeclared(srcTexts, declared), { missingHosts: [], missingPkgs: [] })
})

test('control: the scan sees real literals and catches an injected one', () => {
  const all = new Set(srcTexts.flatMap((t) => [...hostLiterals(t)]))
  assert.ok(all.has('github.com') && all.has('api.github.com'), 'scan found the known clone and update hosts')
  assert.equal(wingetIds(srcTexts.join('\n')).length, 5)
  // A tailnet name outside example.ts.net is not covered by the demo exemption.
  const injected = [...srcTexts, "const X = 'https://undeclared.example.test/x'", "const T = 'https://ember.not-a-real-tailnet.ts.net'", "const WINGET_PACKAGES = {\n  foo: 'Foo.Bar',\n}"]
  assert.deepEqual(undeclared(injected, declared), {
    missingHosts: ['ember.not-a-real-tailnet.ts.net', 'undeclared.example.test'],
    missingPkgs: ['Foo.Bar'],
  })
})

test('declared list entries are well formed', () => {
  for (const d of declared.destinations) {
    assert.ok(d.host && d.purpose && d.triggeredBy && d.process && d.source, `incomplete entry ${d.host}`)
    assert.ok(['required', 'expected', 'not-exercised'].includes(d.gateRun), `bad gateRun on ${d.host}`)
    assert.ok(d.source === 'inferred' || d.source.startsWith('code:'), `bad source on ${d.host}`)
    // code: cites files, not lines (line numbers go stale); each file must exist.
    if (d.source.startsWith('code:')) {
      for (const f of d.source.slice('code:'.length).split(',').map((x) => x.trim())) {
        assert.ok(!/:\d/.test(f) && fs.existsSync(path.join(REPO, f)), `source ${f} on ${d.host} is not an existing file`)
      }
    }
  }
  const hosts = declared.destinations.map((d) => d.host)
  assert.equal(new Set(hosts).size, hosts.length, 'duplicate host entries')
})

test('the Ollama model registry and its blob host are declared and required in the gate run', () => {
  const byHost = Object.fromEntries(declared.destinations.map((d) => [d.host, d]))
  assert.equal(byHost['registry.ollama.ai'].gateRun, 'required')
  assert.ok(declared.destinations.some((d) => d.host.endsWith('.r2.cloudflarestorage.com') && d.process === 'ollama'))
})

// The open-url allowlist and the declared browser links are the same list kept
// in two places; a host added to one must be added to the other.
test('ALLOWED_EXTERNAL_HOSTS equals browserLinks.hosts', () => {
  assert.ok(ALLOWED_EXTERNAL_HOSTS.size > 0 && declared.browserLinks.hosts.length > 0, 'both lists are populated')
  assert.equal(new Set(declared.browserLinks.hosts).size, declared.browserLinks.hosts.length, 'duplicate browserLinks hosts')
  assert.deepEqual(hostSetDiff(ALLOWED_EXTERNAL_HOSTS, declared.browserLinks.hosts), { onlyInAllowlist: [], onlyInDeclared: [] })
})

test('control: a host added to only one list is caught on either side', () => {
  const allowlist = [...ALLOWED_EXTERNAL_HOSTS, 'allow-only.example.test']
  const browserHosts = [...declared.browserLinks.hosts.filter((h) => h !== 'brew.sh'), 'declared-only.example.test']
  assert.deepEqual(hostSetDiff(allowlist, browserHosts), {
    onlyInAllowlist: ['allow-only.example.test', 'brew.sh'],
    onlyInDeclared: ['declared-only.example.test'],
  })
})

// The only ts.net name allowed is the user's own, read at runtime. A ts.net
// entry in either host list would allow it for everyone.
const tailnetEntries = (hosts) => [...hosts].filter((h) => h === 'ts.net' || h.endsWith('.ts.net')).sort()

test('no *.ts.net entry in ALLOWED_EXTERNAL_HOSTS or browserLinks.hosts', () => {
  assert.deepEqual(tailnetEntries(ALLOWED_EXTERNAL_HOSTS), [])
  assert.deepEqual(tailnetEntries(declared.browserLinks.hosts), [])
})

test('control: a ts.net entry added to either list is caught', () => {
  assert.deepEqual(tailnetEntries([...ALLOWED_EXTERNAL_HOSTS, 'ember.not-a-real-tailnet.ts.net']), ['ember.not-a-real-tailnet.ts.net'])
  assert.deepEqual(tailnetEntries([...declared.browserLinks.hosts, 'ts.net']), ['ts.net'])
})
