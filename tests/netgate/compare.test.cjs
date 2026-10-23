// compare.cjs: gate classification over synthetic captures.
//
// Every assertion that something is absent (no failure, no direct-IP flow, no
// leaked field) is paired with a control that makes the condition occur and
// asserts the gate catches it, so a pass cannot come from the gate not looking.
// All hosts are synthetic (*.example.test, documentation IP ranges).

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  matchHost, parseDnsTsv, parseFlowsTsv, parseNamedTsv, parseSysmonXml,
  composeImages, evaluate, renderReport, EXIT_CODES,
} = require('../../scripts/netgate/compare.cjs')

const HARNESS = {
  guestIp: '10.0.2.15',
  natSubnet: '10.0.2.0/24',
  natBroadcast: '10.0.2.255',
  localFlows: [
    { ip: '10.0.2.2', port: 8888, proto: 'tcp' },
    { ip: '10.0.2.3', port: 53, proto: 'udp' },
  ],
  installerRoots: ['^Ember Setup'],
  installerTools: ['^ollama\\.exe$'],
}

const DECLARED = {
  destinations: [
    { host: 'pkg.example.test', purpose: 'packages', gateRun: 'required' },
    { host: 'cdn.example.test', purpose: 'blobs', gateRun: 'expected' },
    { host: 'registry.example.test', purpose: 'image registry', gateRun: 'not-exercised' },
  ],
}

const OS_NOISE = { hosts: ['*.os.example.test'] }
const COMPOSE = 'services:\n  search:\n    image: registry.example.test/search:1\n'

const ev = (id, data) => `<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System><EventID>${id}</EventID></System><EventData>${
  Object.entries(data).map(([k, v]) => `<Data Name='${k}'>${v}</Data>`).join('')}</EventData></Event>`

// A clean run: the installer tree (Ember Setup -> cmd -> worker) fetches the
// declared hosts; an OS service talks to an os-noise host.
function cleanRun() {
  return {
    dns: [
      { name: 'pkg.example.test', ips: ['203.0.113.10'] },
      { name: 'cdn.example.test', ips: ['203.0.113.20'] },
      { name: 'update.os.example.test', ips: ['203.0.113.30'] },
    ],
    flows: [
      { ip: '203.0.113.10', proto: 'tcp', port: 443 },
      { ip: '203.0.113.20', proto: 'tcp', port: 443 },
      { ip: '203.0.113.30', proto: 'tcp', port: 443 },
      { ip: '10.0.2.3', proto: 'udp', port: 53 },
      { ip: '10.0.2.2', proto: 'tcp', port: 8888 },
      { ip: '224.0.0.251', proto: 'udp', port: 5353 },
      { ip: '10.0.2.255', proto: 'udp', port: 137 },
    ],
    sni: [{ ip: '203.0.113.10', name: 'pkg.example.test' }],
    sysmonEvents: [
      ev(1, { ProcessGuid: '{A}', Image: 'C:\\Program Files\\Ember Setup\\Ember Setup.exe', ParentProcessGuid: '{X}' }),
      ev(1, { ProcessGuid: '{B}', Image: 'C:\\Windows\\System32\\cmd.exe', ParentProcessGuid: '{A}' }),
      ev(1, { ProcessGuid: '{C}', Image: 'C:\\tools\\worker.exe', ParentProcessGuid: '{B}', CommandLine: 'worker.exe --token NETGATE-LEAK-MARKER' }),
      ev(1, { ProcessGuid: '{S}', Image: 'C:\\Windows\\System32\\svchost.exe', ParentProcessGuid: '{X}' }),
      ev(22, { ProcessGuid: '{C}', Image: 'C:\\tools\\worker.exe', QueryName: 'pkg.example.test', QueryResults: '::ffff:203.0.113.10;' }),
      ev(22, { ProcessGuid: '{C}', Image: 'C:\\tools\\worker.exe', QueryName: 'cdn.example.test', QueryResults: 'type:  5 edge.cdn.example.test;::ffff:203.0.113.20;' }),
      ev(22, { ProcessGuid: '{S}', Image: 'C:\\Windows\\System32\\svchost.exe', QueryName: 'update.os.example.test', QueryResults: '::ffff:203.0.113.30;' }),
      ev(3, { ProcessGuid: '{C}', Image: 'C:\\tools\\worker.exe', Protocol: 'tcp', Initiated: 'true', DestinationIp: '203.0.113.10', DestinationPort: '443' }),
    ],
  }
}

function run(mut = (r) => r, opts = {}) {
  const r = mut(cleanRun())
  return evaluate({
    declared: opts.declared || DECLARED,
    osNoise: OS_NOISE,
    harness: HARNESS,
    pcap: { dns: r.dns, flows: r.flows, sni: r.sni },
    sysmon: parseSysmonXml(`<Events>${r.sysmonEvents.join('\n')}</Events>`),
    compose: 'compose' in opts ? opts.compose : COMPOSE,
    baseline: opts.baseline || false,
  })
}

const kinds = (res) => res.failures.map((f) => `${f.kind}:${f.target}`)

test('matchHost: exact and *.suffix', () => {
  assert.ok(matchHost('pkg.example.test', 'PKG.example.test.'))
  assert.ok(matchHost('*.example.test', 'a.b.example.test'))
  assert.ok(!matchHost('*.example.test', 'example.test'))
  assert.ok(!matchHost('pkg.example.test', 'xpkg.example.test'))
  assert.ok(!matchHost('*.example.test', 'example.test.evil.test'))
})

test('clean run passes with no failures', () => {
  const res = run()
  assert.equal(res.status, 'pass')
  assert.deepEqual(res.failures, [])
  assert.equal(EXIT_CODES[res.status], 0)
})

test('control: an undeclared host fails the clean run', () => {
  const res = run((r) => {
    r.dns.push({ name: 'rogue.example.test', ips: ['203.0.113.40'] })
    r.flows.push({ ip: '203.0.113.40', proto: 'tcp', port: 443 })
    r.sysmonEvents.push(ev(22, { ProcessGuid: '{C}', Image: 'C:\\tools\\worker.exe', QueryName: 'rogue.example.test', QueryResults: '::ffff:203.0.113.40;' }))
    return r
  })
  assert.equal(res.status, 'fail')
  assert.deepEqual(kinds(res), ['undeclared:rogue.example.test'])
  assert.equal(res.failures[0].detail, 'worker.exe')
  assert.equal(EXIT_CODES[res.status], 1)
})

test('control: a query with no answer and no connection still counts', () => {
  const res = run((r) => {
    r.dns.push({ name: 'unanswered.example.test', ips: [] })
    return r
  })
  assert.deepEqual(kinds(res), ['undeclared:unanswered.example.test'])
})

test('os-noise from an OS process passes; the same name from the installer tree fails', () => {
  const clean = run()
  const noise = clean.names.find((n) => n.name === 'update.os.example.test')
  assert.equal(noise.class, 'os-noise')

  const res = run((r) => {
    r.sysmonEvents.push(ev(22, { ProcessGuid: '{C}', Image: 'C:\\tools\\worker.exe', QueryName: 'update.os.example.test', QueryResults: '::ffff:203.0.113.30;' }))
    return r
  })
  assert.deepEqual(kinds(res), ['os-noise-from-installer:update.os.example.test'])
})

test('control: an installer tool outside the tree (ollama.exe) is in the installer set', () => {
  const res = run((r) => {
    r.sysmonEvents.push(ev(1, { ProcessGuid: '{O}', Image: 'C:\\Ollama\\ollama.exe', ParentProcessGuid: '{X}' }))
    r.sysmonEvents.push(ev(3, { ProcessGuid: '{O}', Image: 'C:\\Ollama\\ollama.exe', Protocol: 'tcp', Initiated: 'true', DestinationIp: '203.0.113.30', DestinationPort: '443' }))
    return r
  })
  assert.deepEqual(kinds(res), ['os-noise-from-installer:update.os.example.test'])
})

test('every public flow is named; control: a direct-IP flow fails', () => {
  assert.ok(!kinds(run()).some((k) => k.startsWith('direct-ip')))
  const res = run((r) => {
    r.flows.push({ ip: '198.51.100.7', proto: 'tcp', port: 443 })
    return r
  })
  assert.deepEqual(kinds(res), ['direct-ip:tcp/198.51.100.7/443'])
})

test('SNI names a flow that had no DNS answer', () => {
  const res = run((r) => {
    r.flows.push({ ip: '198.51.100.8', proto: 'tcp', port: 443 })
    r.sni.push({ ip: '198.51.100.8', name: 'cdn.example.test' })
    return r
  })
  assert.equal(res.status, 'pass')
  const control = run((r) => {
    r.flows.push({ ip: '198.51.100.8', proto: 'tcp', port: 443 })
    r.sni.push({ ip: '198.51.100.8', name: 'sni-only.example.test' })
    return r
  })
  assert.deepEqual(kinds(control), ['undeclared:sni-only.example.test'])
})

test('harness NAT flows pass; control: any other NAT-subnet flow fails', () => {
  assert.ok(!kinds(run()).some((k) => k.startsWith('unexpected-local-flow')))
  const res = run((r) => {
    r.flows.push({ ip: '10.0.2.2', proto: 'tcp', port: 8000 })
    return r
  })
  assert.deepEqual(kinds(res), ['unexpected-local-flow:tcp/10.0.2.2/8000'])
})

test('reverse lookups and single-label names are informational', () => {
  const res = run((r) => {
    r.dns.push({ name: '10.113.0.203.in-addr.arpa', ips: [] })
    r.dns.push({ name: 'wpad', ips: [] })
    return r
  })
  assert.equal(res.status, 'pass')
  assert.equal(res.names.find((n) => n.name === 'wpad').class, 'single-label')
})

test('compose registries declared pass; control: an undeclared registry fails', () => {
  const ok = run()
  assert.deepEqual(ok.compose[0].hostStatus, [{ host: 'registry.example.test', declared: true }])
  const res = run((r) => r, { compose: 'services:\n  x:\n    image: ghcr.io/acme/x:1\n' })
  assert.deepEqual(kinds(res), [
    'compose-registry-undeclared:ghcr.io',
    'compose-registry-undeclared:pkg-containers.githubusercontent.com',
  ])
})

test('composeImages maps Docker Hub short names to the Docker Hub hosts', () => {
  assert.deepEqual(composeImages('services:\n  s:\n    image: searxng/searxng:latest\n  t:\n    image: "redis:7"\n'), [
    { image: 'searxng/searxng:latest', registry: 'docker.io', hosts: ['registry-1.docker.io', 'auth.docker.io', 'production.cloudflare.docker.com'] },
    { image: 'redis:7', registry: 'docker.io', hosts: ['registry-1.docker.io', 'auth.docker.io', 'production.cloudflare.docker.com'] },
  ])
  assert.equal(composeImages('    image: localhost:5000/x\n')[0].registry, 'localhost:5000')
})

test('not-exercised hosts are reported as declared-but-not-captured, not failures', () => {
  const res = run()
  assert.deepEqual(res.notCaptured.map((n) => n.host), ['registry.example.test'])
  assert.match(renderReport(res), /## Declared but not captured[\s\S]*registry\.example\.test/)
})

test('invalid: a required host never observed', () => {
  const res = run((r) => {
    r.dns = r.dns.filter((q) => q.name !== 'pkg.example.test')
    r.sni = []
    r.flows = r.flows.filter((f) => f.ip !== '203.0.113.10')
    r.sysmonEvents = r.sysmonEvents.filter((e) => !e.includes('pkg.example.test') && !e.includes('203.0.113.10'))
    return r
  })
  assert.equal(res.status, 'invalid')
  assert.equal(EXIT_CODES[res.status], 2)
  assert.match(res.invalid.join('\n'), /required host pkg\.example\.test/)
})

test('invalid: empty pcap DNS, empty Sysmon, compose not collected', () => {
  assert.match(run((r) => { r.dns = []; return r }).invalid.join('\n'), /no DNS traffic/)
  assert.match(run((r) => { r.sysmonEvents = []; return r }).invalid.join('\n'), /Sysmon log is empty/)
  assert.match(run((r) => r, { compose: null }).invalid.join('\n'), /docker-compose\.yml was not collected/)
})

test('invalid outranks fail', () => {
  const res = run((r) => {
    r.dns = r.dns.filter((q) => q.name !== 'pkg.example.test')
    r.dns.push({ name: 'rogue.example.test', ips: [] })
    return r
  }, { compose: null })
  assert.equal(res.status, 'invalid')
})

test('baseline lists undeclared names but never fails', () => {
  const res = run((r) => {
    r.dns.push({ name: 'rogue.example.test', ips: [] })
    return r
  }, { baseline: true, compose: null })
  assert.equal(res.status, 'baseline')
  assert.deepEqual(res.failures, [])
  assert.equal(res.names.find((n) => n.name === 'rogue.example.test').class, 'undeclared')
})

test('report and result never carry command lines or full paths', () => {
  const res = run()
  const out = renderReport(res) + JSON.stringify(res)
  assert.ok(!out.includes('NETGATE-LEAK-MARKER'))
  assert.ok(!out.includes('C:\\tools') && !out.includes('C:\\\\tools'))
  // Control: the marker is in the input, and the same event's image did reach
  // the report, so the event was parsed and only the command line was dropped.
  assert.ok(cleanRun().sysmonEvents.join('').includes('NETGATE-LEAK-MARKER'))
  assert.match(out, /worker\.exe\*/)
})

test('parsers: tshark field rows and Sysmon XML', () => {
  assert.deepEqual(parseDnsTsv('Pkg.Example.Test.\t\t\npkg.example.test\t203.0.113.10,203.0.113.11\t2001:db8::1\n'), [
    { name: 'pkg.example.test', ips: [] },
    { name: 'pkg.example.test', ips: ['203.0.113.10', '203.0.113.11', '2001:db8::1'] },
  ])
  assert.deepEqual(parseFlowsTsv('203.0.113.10\t\t6\t\t443\t\n10.0.2.3\t\t17\t\t\t53\n'), [
    { ip: '203.0.113.10', proto: 'tcp', port: 443 },
    { ip: '10.0.2.3', proto: 'udp', port: 53 },
  ])
  assert.deepEqual(parseNamedTsv('203.0.113.10\t\tpkg.example.test:443\n'), [{ ip: '203.0.113.10', name: 'pkg.example.test' }])
  const s = parseSysmonXml(`<Events>${ev(22, { ProcessGuid: '{C}', Image: 'C:\\a&amp;b\\w.exe', QueryName: 'X.example.test', QueryResults: 'type:  5 y.example.test;::ffff:203.0.113.9;2001:db8::9;' })}${
    ev(3, { ProcessGuid: '{C}', Image: 'w.exe', Protocol: 'tcp', Initiated: 'false', DestinationIp: '203.0.113.9', DestinationPort: '1' })}</Events>`)
  assert.deepEqual(s.dns, [{ guid: '{C}', image: 'w.exe', name: 'x.example.test', ips: ['203.0.113.9', '2001:db8::9'] }])
  assert.deepEqual(s.conns, [], 'inbound connections are not destinations')
})
