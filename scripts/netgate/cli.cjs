#!/usr/bin/env node
// Fresh-install network capture gate: analyze one run directory.
//
//   npm run netgate:analyze -- <runDir> [--baseline]
//
// <runDir> holds guest.pcap (VirtualBox NIC trace), sysmon.evtx and
// docker-compose.yml (copied from the guest by run-capture.ps1 stop). Writes
// gate-report.md and gate-result.json into <runDir>. Exit 0 pass, 1 fail,
// 2 invalid capture. --baseline (no installer run) never fails; it lists every
// name so os-noise.json can be reviewed. See docs/NETWORK_GATE.md.

'use strict'

const fs = require('fs')
const path = require('path')
const { evaluate, renderReport, EXIT_CODES } = require('./compare.cjs')
const { extractPcap, extractSysmon } = require('./extract.cjs')

const REPO = path.resolve(__dirname, '..', '..')
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))

function main(argv) {
  const baseline = argv.includes('--baseline')
  const runDir = argv.find((a) => !a.startsWith('--'))
  if (!runDir) {
    console.error('usage: netgate:analyze -- <runDir> [--baseline]')
    return 2
  }
  const at = (f) => path.join(runDir, f)
  const harness = readJson(path.join(__dirname, 'harness.json'))
  const pcapFile = at('guest.pcap')
  if (!fs.existsSync(pcapFile) || fs.statSync(pcapFile).size === 0) {
    console.error(`invalid: ${pcapFile} missing or empty`)
    return 2
  }
  const sysmonFile = [at('sysmon.evtx'), at('sysmon.xml')].find((f) => fs.existsSync(f))
  const composeFile = at('docker-compose.yml')

  const result = evaluate({
    declared: readJson(path.join(REPO, 'docs', 'network-destinations.json')),
    osNoise: readJson(path.join(__dirname, 'os-noise.json')),
    harness,
    pcap: extractPcap(pcapFile, harness.guestIp),
    sysmon: sysmonFile ? extractSysmon(sysmonFile) : { procs: new Map(), dns: [], conns: [] },
    compose: fs.existsSync(composeFile) ? fs.readFileSync(composeFile, 'utf8') : null,
    baseline,
  })
  const runId = path.basename(path.resolve(runDir))
  fs.writeFileSync(at('gate-report.md'), renderReport(result, { runId }))
  fs.writeFileSync(at('gate-result.json'), JSON.stringify({ runId, ...result }, null, 2))

  console.log(`netgate ${runId}: ${result.status.toUpperCase()}`)
  for (const x of result.invalid) console.log(`  invalid: ${x}`)
  for (const f of result.failures) console.log(`  ${f.kind}: ${f.target} (${f.detail})`)
  console.log(`  report: ${at('gate-report.md')}`)
  return EXIT_CODES[result.status]
}

process.exitCode = main(process.argv.slice(2))
