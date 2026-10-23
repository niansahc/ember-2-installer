// Fresh-install network capture gate: pure classification logic, no I/O.
// Inputs are the tshark field dumps from the VirtualBox NIC trace, the guest's
// Sysmon log as XML, the docker-compose.yml the installer cloned, and the
// declared list in docs/network-destinations.json. See docs/NETWORK_GATE.md.
//
// Output never carries command lines, paths or log text: only hostnames, IPs,
// ports, process image basenames and counts. Raw captures stay outside the repo.

'use strict'

const normName = (n) => String(n || '').trim().toLowerCase().replace(/\.$/, '')

// Exact name, or *.suffix (matches any deeper name, not the bare suffix).
function matchHost(pattern, name) {
  const p = normName(pattern)
  const n = normName(name)
  if (p.startsWith('*.')) return n.endsWith(p.slice(1))
  return p === n
}

const matchesAny = (patterns, name) => patterns.some((p) => matchHost(p, name))

const basename = (p) => String(p || '').split(/[\\/]/).pop()

function ipv4ToInt(ip) {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]
}

function inCidr(ip, cidr) {
  const [base, bits] = cidr.split('/')
  const a = ipv4ToInt(ip)
  const b = ipv4ToInt(base)
  if (a === null || b === null) return false
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0
  return ((a & mask) >>> 0) === ((b & mask) >>> 0)
}

// Multicast, broadcast, loopback, link-local and unspecified never leave the
// guest's segment, so they are counted but never classified.
function isLocalOnly(ip) {
  if (ip.includes(':')) {
    const v6 = ip.toLowerCase()
    return v6 === '::1' || v6 === '::' || v6.startsWith('ff') || /^fe[89ab]/.test(v6)
  }
  return ['224.0.0.0/4', '255.255.255.255/32', '127.0.0.0/8', '169.254.0.0/16', '0.0.0.0/32']
    .some((c) => inCidr(ip, c))
}

// Sysmon reports IPv4 answers as IPv4-mapped IPv6.
const unmapIp = (ip) => String(ip || '').trim().replace(/^::ffff:/i, '')

const splitList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean)

// tshark -T fields rows: tab-separated, multi-value fields joined with ','.
const rows = (text) => String(text || '').split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split('\t'))

// Fields: dns.qry.name, dns.a, dns.aaaa
function parseDnsTsv(text) {
  return rows(text).map(([name, a, aaaa]) => ({
    name: normName(splitList(name)[0]),
    ips: [...splitList(a), ...splitList(aaaa)],
  })).filter((r) => r.name)
}

// Fields: ip.dst, ipv6.dst, ip.proto, ipv6.nxt, tcp.dstport, udp.dstport
function parseFlowsTsv(text) {
  return rows(text).map(([ip4, ip6, proto4, proto6, tport, uport]) => {
    const proto = Number(proto4 || proto6) === 6 ? 'tcp' : 'udp'
    return { ip: ip4 || ip6, proto, port: Number(proto === 'tcp' ? tport : uport) }
  }).filter((f) => f.ip)
}

// Fields: ip.dst, ipv6.dst, server name (TLS SNI or HTTP Host)
function parseNamedTsv(text) {
  return rows(text).map(([ip4, ip6, name]) => ({
    ip: ip4 || ip6,
    name: normName(splitList(name)[0]).replace(/:\d+$/, ''),
  })).filter((r) => r.ip && r.name)
}

const decodeXml = (s) => !s.includes('&') ? s : s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, '&')

// Sysmon EID 1 (process create), 3 (network connect), 22 (DNS query), from
// `wevtutil qe /f:xml`. Only the fields the gate needs are kept; CommandLine
// is deliberately never read.
function parseSysmonXml(xml) {
  const procs = new Map()
  const dns = []
  const conns = []
  for (const m of String(xml || '').matchAll(/<Event[\s>][\s\S]*?<\/Event>/g)) {
    const ev = m[0]
    const id = Number((ev.match(/<EventID[^>]*>(\d+)<\/EventID>/) || [])[1])
    const d = {}
    for (const dm of ev.matchAll(/<Data Name='([^']+)'>([^<]*)<\/Data>/g)) d[dm[1]] = decodeXml(dm[2])
    if (id === 1) {
      procs.set(d.ProcessGuid, { image: basename(d.Image), parentGuid: d.ParentProcessGuid })
    } else if (id === 22) {
      const ips = String(d.QueryResults || '').split(';').map((x) => x.trim())
        .filter((x) => x && !x.startsWith('type:')).map(unmapIp)
      dns.push({ guid: d.ProcessGuid, image: basename(d.Image), name: normName(d.QueryName), ips })
    } else if (id === 3) {
      if (d.Initiated && d.Initiated !== 'true') continue
      conns.push({
        guid: d.ProcessGuid,
        image: basename(d.Image),
        ip: unmapIp(d.DestinationIp),
        port: Number(d.DestinationPort),
        proto: String(d.Protocol || '').toLowerCase(),
      })
    }
  }
  return { procs, dns, conns }
}

// Registry hosts each compose image pulls from. A first path component with a
// dot or port, or "localhost", names the registry; anything else is Docker Hub.
const REGISTRY_HOSTS = {
  'docker.io': ['registry-1.docker.io', 'auth.docker.io', 'production.cloudflare.docker.com'],
  'ghcr.io': ['ghcr.io', 'pkg-containers.githubusercontent.com'],
}

function composeImages(composeText) {
  const out = []
  for (const m of String(composeText || '').matchAll(/^\s*image:\s*["']?([^"'\s#]+)/gm)) {
    const image = m[1]
    const first = image.split('/')[0]
    const registry = image.includes('/') && (/[.:]/.test(first) || first === 'localhost') ? first : 'docker.io'
    out.push({ image, registry, hosts: REGISTRY_HOSTS[registry] || [registry] })
  }
  return out
}

// Sysmon ProcessGuids descended from an installer root, plus any process whose
// image is a tool the installer installs or drives (Ollama's server can be
// started outside the installer's tree, so the tree alone is not enough).
function installerMembership(procs, harness) {
  const rootRe = (harness.installerRoots || []).map((r) => new RegExp(r, 'i'))
  const toolRe = (harness.installerTools || []).map((r) => new RegExp(r, 'i'))
  const children = new Map()
  for (const [guid, p] of procs) {
    if (!children.has(p.parentGuid)) children.set(p.parentGuid, [])
    children.get(p.parentGuid).push(guid)
  }
  const tree = new Set()
  const queue = [...procs].filter(([, p]) => rootRe.some((r) => r.test(p.image))).map(([g]) => g)
  for (let i = 0; i < queue.length; i++) {
    const g = queue[i]
    if (tree.has(g)) continue
    tree.add(g)
    for (const c of children.get(g) || []) queue.push(c)
  }
  // The same (guid, image) pair recurs across thousands of Sysmon events.
  const memo = new Map()
  return (guid, image) => {
    const key = `${guid}|${image}`
    if (!memo.has(key)) memo.set(key, tree.has(guid) || toolRe.some((r) => r.test(image)))
    return memo.get(key)
  }
}

const isReverseLookup = (n) => n.endsWith('.in-addr.arpa') || n.endsWith('.ip6.arpa')

// Evaluate one capture. Returns { status: pass|fail|invalid, ... }.
// baseline: classify and list everything, but never fail (os-noise review run).
function evaluate({ declared, osNoise, harness, pcap, sysmon, compose, baseline = false }) {
  const destinations = declared.destinations || []
  const declaredHosts = destinations.map((d) => d.host)
  const noise = osNoise.hosts || []
  const inInstaller = installerMembership(sysmon.procs, harness)
  const failures = []
  const invalid = []

  // name -> { sources, processes: Map(image -> fromInstaller), ips }
  const names = new Map()
  const note = (name, source) => {
    const n = normName(name)
    if (!n) return null
    if (!names.has(n)) names.set(n, { sources: new Set(), processes: new Map(), ips: new Set() })
    names.get(n).sources.add(source)
    return names.get(n)
  }
  const ipNames = new Map()
  const mapIp = (ip, name) => {
    if (!ipNames.has(ip)) ipNames.set(ip, new Set())
    ipNames.get(ip).add(normName(name))
  }
  // A name is from the installer if any installer-set process touched it.
  const attribute = (e, guid, image) => e.processes.set(image, e.processes.get(image) || inInstaller(guid, image))

  for (const q of pcap.dns) {
    const e = note(q.name, 'dns')
    for (const ip of q.ips) { mapIp(ip, q.name); e.ips.add(ip) }
  }
  for (const s of pcap.sni) { note(s.name, 'sni').ips.add(s.ip); mapIp(s.ip, s.name) }
  for (const q of sysmon.dns) {
    const e = note(q.name, 'sysmon')
    attribute(e, q.guid, q.image)
    for (const ip of q.ips) { mapIp(ip, q.name); e.ips.add(ip) }
  }
  for (const c of sysmon.conns) {
    for (const n of ipNames.get(c.ip) || []) attribute(names.get(n), c.guid, c.image)
  }

  // Flows: anything in the NAT subnet must be a harness flow (the guest must
  // never reach other host services); anything else needs a name.
  const natSubnet = harness.natSubnet || '10.0.2.0/24'
  const flowKeys = new Set()
  let localOnly = 0
  for (const f of pcap.flows) {
    const key = `${f.proto}/${f.ip}/${f.port}`
    if (flowKeys.has(key)) continue
    flowKeys.add(key)
    if (isLocalOnly(f.ip) || f.ip === harness.natBroadcast) { localOnly++; continue }
    if (!f.ip.includes(':') && inCidr(f.ip, natSubnet)) {
      const ok = (harness.localFlows || []).some((h) => h.ip === f.ip && h.port === f.port && h.proto === f.proto)
      if (!ok) failures.push({ kind: 'unexpected-local-flow', target: key, detail: 'guest reached a NAT address that is not a harness service' })
      continue
    }
    if (!(ipNames.get(f.ip) || new Set()).size) {
      failures.push({ kind: 'direct-ip', target: key, detail: 'connection to an IP no DNS answer or SNI named' })
    }
  }

  const classified = []
  for (const [name, e] of [...names].sort(([a], [b]) => a.localeCompare(b))) {
    const procs = [...e.processes].map(([image, inst]) => ({ image, installer: inst }))
    const fromInstaller = procs.filter((p) => p.installer).map((p) => p.image)
    let cls
    if (isReverseLookup(name)) cls = 'reverse-lookup'
    else if (!name.includes('.')) cls = 'single-label'
    else if (matchesAny(declaredHosts, name)) cls = 'declared'
    else if (matchesAny(noise, name)) cls = fromInstaller.length ? 'os-noise-from-installer' : 'os-noise'
    else cls = 'undeclared'
    classified.push({ name, class: cls, sources: [...e.sources].sort(), processes: procs, ips: [...e.ips].sort() })
    if (cls === 'undeclared') {
      failures.push({ kind: 'undeclared', target: name, detail: procs.map((p) => p.image).join(', ') || 'no Sysmon attribution' })
    } else if (cls === 'os-noise-from-installer') {
      failures.push({ kind: 'os-noise-from-installer', target: name, detail: fromInstaller.join(', ') })
    }
  }

  const images = composeImages(compose)
  for (const img of images) {
    img.hostStatus = img.hosts.map((h) => ({ host: h, declared: matchesAny(declaredHosts, h) }))
    for (const hs of img.hostStatus) {
      if (!hs.declared) failures.push({ kind: 'compose-registry-undeclared', target: hs.host, detail: `image ${img.image}` })
    }
  }

  const observed = (host) => classified.some((c) => matchHost(host, c.name))
  const unseen = destinations.filter((d) => d.gateRun !== 'not-exercised' && !observed(d.host))
  const notObserved = unseen.map((d) => d.host)
  const notCaptured = destinations.filter((d) => d.gateRun === 'not-exercised').map((d) => ({ host: d.host, purpose: d.purpose }))

  if (!pcap.dns.length) invalid.push('pcap has no DNS traffic: trace was off or the guest had no network')
  if (!sysmon.procs.size && !sysmon.dns.length) invalid.push('Sysmon log is empty: process attribution is missing')
  if (!baseline) {
    if (compose === null || compose === undefined) invalid.push('docker-compose.yml was not collected from the guest')
    for (const d of unseen.filter((x) => x.gateRun === 'required')) {
      invalid.push(`required host ${d.host} never observed: the install did not complete`)
    }
  }

  let status = 'pass'
  if (baseline) status = invalid.length ? 'invalid' : 'baseline'
  else if (invalid.length) status = 'invalid'
  else if (failures.length) status = 'fail'

  return {
    status,
    baseline,
    failures: baseline ? [] : failures,
    invalid,
    names: classified,
    notObserved,
    notCaptured,
    compose: images,
    counts: { names: classified.length, flows: flowKeys.size, localOnlyFlows: localOnly, sysmonProcesses: sysmon.procs.size },
  }
}

const EXIT_CODES = { pass: 0, baseline: 0, fail: 1, invalid: 2 }

function renderReport(r, meta = {}) {
  const procList = (ps) => ps.map((p) => (p.installer ? `${p.image}*` : p.image)).join(', ')
  const out = []
  out.push(`# Network capture gate: ${r.status.toUpperCase()}`, '')
  if (meta.runId) out.push(`- Run: ${meta.runId}`)
  out.push(`- Names: ${r.counts.names}, flows: ${r.counts.flows} (local-only ${r.counts.localOnlyFlows}), Sysmon processes: ${r.counts.sysmonProcesses}`, '')
  if (r.invalid.length) {
    out.push('## Invalid capture', '', ...r.invalid.map((x) => `- ${x}`), '')
  }
  if (r.failures.length) {
    out.push('## Failures', '', '| kind | target | detail |', '|---|---|---|')
    for (const f of r.failures) out.push(`| ${f.kind} | ${f.target} | ${f.detail} |`)
    out.push('')
  }
  out.push('## Declared but not captured', '', 'Declared, but the guest run cannot exercise them (Docker is a harness shim in the guest).', '')
  out.push('| host | purpose |', '|---|---|')
  for (const n of r.notCaptured) out.push(`| ${n.host} | ${n.purpose} |`)
  out.push('', '### Compose image registries', '', '| image | registry | host | declared |', '|---|---|---|---|')
  for (const img of r.compose) {
    for (const hs of img.hostStatus) out.push(`| ${img.image} | ${img.registry} | ${hs.host} | ${hs.declared ? 'yes' : 'NO'} |`)
  }
  out.push('')
  if (r.notObserved.length) {
    out.push('## Declared, exercisable, not observed', '', ...r.notObserved.map((h) => `- ${h}`), '')
  }
  out.push('## All observed names', '', '`*` = process in the installer set', '', '| name | class | processes | IPs |', '|---|---|---|---|')
  for (const n of r.names) out.push(`| ${n.name} | ${n.class} | ${procList(n.processes)} | ${n.ips.join(', ')} |`)
  out.push('')
  return out.join('\n')
}

module.exports = {
  matchHost,
  parseDnsTsv,
  parseFlowsTsv,
  parseNamedTsv,
  parseSysmonXml,
  composeImages,
  evaluate,
  renderReport,
  EXIT_CODES,
}
