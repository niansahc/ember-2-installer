// docs/network-destinations.json vs src/: every host literal in the installer
// source and every winget package id must be accounted for in the declared
// list, so a new destination cannot ship without a declaration.

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const REPO = path.resolve(__dirname, '..', '..')
const declared = JSON.parse(fs.readFileSync(path.join(REPO, 'docs', 'network-destinations.json'), 'utf8'))

// Literals that are not destinations. Each needs a reason.
const NOT_DESTINATIONS = [
  { match: (h) => h === '127.0.0.1' || h === 'localhost', reason: 'loopback (local API, open-url allowlist)' },
  { match: (h) => h === 'www.apple.com', reason: 'plist DOCTYPE identifier, never fetched' },
  { match: (h) => h === 'ember-desktop' || h.endsWith('.ts.net'), reason: 'demo-mode fake Tailscale status' },
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

test('every host literal and winget id in src/ is declared', () => {
  assert.deepEqual(undeclared(srcTexts, declared), { missingHosts: [], missingPkgs: [] })
})

test('control: the scan sees real literals and catches an injected one', () => {
  const all = new Set(srcTexts.flatMap((t) => [...hostLiterals(t)]))
  assert.ok(all.has('github.com') && all.has('api.github.com'), 'scan found the known clone and update hosts')
  assert.equal(wingetIds(srcTexts.join('\n')).length, 5)
  const injected = [...srcTexts, "const X = 'https://undeclared.example.test/x'", "const WINGET_PACKAGES = {\n  foo: 'Foo.Bar',\n}"]
  assert.deepEqual(undeclared(injected, declared), { missingHosts: ['undeclared.example.test'], missingPkgs: ['Foo.Bar'] })
})

test('declared list entries are well formed', () => {
  for (const d of declared.destinations) {
    assert.ok(d.host && d.purpose && d.triggeredBy && d.process && d.source, `incomplete entry ${d.host}`)
    assert.ok(['required', 'expected', 'not-exercised'].includes(d.gateRun), `bad gateRun on ${d.host}`)
    assert.ok(d.source === 'inferred' || d.source.startsWith('code:'), `bad source on ${d.host}`)
  }
  const hosts = declared.destinations.map((d) => d.host)
  assert.equal(new Set(hosts).size, hosts.length, 'duplicate host entries')
})

test('the Ollama model registry and its blob host are declared and required in the gate run', () => {
  const byHost = Object.fromEntries(declared.destinations.map((d) => [d.host, d]))
  assert.equal(byHost['registry.ollama.ai'].gateRun, 'required')
  assert.ok(declared.destinations.some((d) => d.host.endsWith('.r2.cloudflarestorage.com') && d.process === 'ollama'))
})
