// Fresh-install network capture gate: raw capture -> parsed records. Shells out
// to tshark (pcap) and wevtutil (Sysmon .evtx); parsing lives in compare.cjs.

'use strict'

const fs = require('fs')
const { execFileSync } = require('child_process')
const { parseDnsTsv, parseFlowsTsv, parseNamedTsv, parseSysmonXml } = require('./compare.cjs')

const MAX_BUFFER = 1 << 30

function findTshark() {
  if (process.env.NETGATE_TSHARK) return process.env.NETGATE_TSHARK
  const winDefault = 'C:\\Program Files\\Wireshark\\tshark.exe'
  return fs.existsSync(winDefault) ? winDefault : 'tshark'
}

function tsharkFields(tshark, pcap, filter, fields) {
  const args = ['-r', pcap, '-Y', filter, '-T', 'fields',
    ...fields.flatMap((f) => ['-e', f]),
    '-E', 'separator=/t', '-E', 'occurrence=a', '-E', 'aggregator=,']
  return execFileSync(tshark, args, { encoding: 'utf8', maxBuffer: MAX_BUFFER })
}

// DNS on port 53 only (mDNS and LLMNR stay on the local segment). Flows are
// outbound TCP SYNs and outbound UDP from the guest, DNS included, so a query
// sent to a resolver other than the NAT proxy shows up as a flow.
function extractPcap(pcap, guestIp, tshark = findTshark()) {
  const dns = tsharkFields(tshark, pcap, 'dns && (udp.port == 53 || tcp.port == 53)',
    ['dns.flags.response', 'dns.qry.name', 'dns.a', 'dns.aaaa'])
  const fromGuest = `(ip.src == ${guestIp} || (ipv6 && !(ipv6.dst == ff00::/8) && !(ipv6.dst == fe80::/10)))`
  const flows = tsharkFields(tshark, pcap,
    `${fromGuest} && ((tcp.flags.syn == 1 && tcp.flags.ack == 0) || udp)`,
    ['ip.dst', 'ipv6.dst', 'ip.proto', 'ipv6.nxt', 'tcp.dstport', 'udp.dstport'])
  const sni = tsharkFields(tshark, pcap, `${fromGuest} && tls.handshake.type == 1`,
    ['ip.dst', 'ipv6.dst', 'tls.handshake.extensions_server_name'])
  const http = tsharkFields(tshark, pcap, `${fromGuest} && http.request`,
    ['ip.dst', 'ipv6.dst', 'http.host'])
  return {
    dns: parseDnsTsv(dns),
    flows: parseFlowsTsv(flows),
    sni: [...parseNamedTsv(sni), ...parseNamedTsv(http)],
  }
}

// Accepts the guest's exported .evtx (converted with the host's wevtutil) or
// an already-converted .xml.
function extractSysmon(file) {
  const xml = file.endsWith('.xml')
    ? fs.readFileSync(file, 'utf8')
    : execFileSync('wevtutil', ['qe', file, '/lf:true', '/f:xml', '/e:Events'], { encoding: 'utf8', maxBuffer: MAX_BUFFER })
  return parseSysmonXml(xml)
}

module.exports = { findTshark, extractPcap, extractSysmon }
