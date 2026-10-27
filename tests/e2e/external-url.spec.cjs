// Unit tests for isAllowedExternalUrl (src/lib/external-url.js), the one check
// for URLs handed to the default browser. Requires the module directly, no app
// launch (build-config.spec pattern).

const { test, expect } = require('@playwright/test')
const fs = require('fs')
const path = require('path')
const {
  ALLOWED_EXTERNAL_HOSTS, isAllowedExternalUrl, parseTailscaleDns, tailnetHostFromDnsName,
} = require('../../src/lib/external-url')

// The user's own Serve name (synthetic, as in the demo handler).
const OWN = 'ember.example.ts.net'
const OWN_URL = `https://${OWN}`

// Every literal URL in the renderer, read from source so a link added there is
// checked here too. Templated URLs (`https://${dns}`) are skipped; the samples
// below stand in for them.
const RENDERER_URLS = [...new Set(['index.html', 'app.js'].flatMap((file) => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', file), 'utf-8')
  return source.match(/https?:\/\/[^"'`<>\s)]+/g) || []
}))].filter((url) => !url.includes('${'))

// The tailnet HTTPS name and the local API, which the renderer builds at runtime.
// The tailnet name is allowed only once main has read it (tailnetHost).
const TEMPLATED_URL_SAMPLES = [OWN_URL, 'http://127.0.0.1:8000']

// https or http-localhost strings that are not allowed destinations.
const LOOKALIKES = [
  'https://github.com.evil.test/x',
  'https://evil.example.test',
  'https://ts.net',
  'https://ember.example.ts.net.evil.test',
  'https://user:pw@github.com/',
  'http://localhost.evil.test',
  'http://127.0.0.1.evil.test',
]

// Not https or local http at all.
const OTHER_SCHEMES = [
  'http://github.com',
  'javascript:alert(1)',
  'file:///C:/Windows/System32/calc.exe',
  'ms-settings:',
]

// The open-url check before this module existed, kept to prove the lookalike
// fixtures exercise the narrowing.
function oldOpenUrlCheck(url) {
  if (typeof url !== 'string') return false
  return url.startsWith('https://') || url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1')
}

test.describe('isAllowedExternalUrl', () => {
  test('allows every URL the renderer opens', () => {
    // Guards the scan itself: a regex that found nothing would pass vacuously.
    expect(RENDERER_URLS.length).toBeGreaterThan(10)
    for (const url of [...RENDERER_URLS, ...TEMPLATED_URL_SAMPLES]) {
      expect(isAllowedExternalUrl(url, { tailnetHost: OWN }), url).toBe(true)
    }
  })

  test('denies lookalike hosts and embedded credentials', () => {
    for (const url of LOOKALIKES) expect(isAllowedExternalUrl(url, { tailnetHost: OWN }), url).toBe(false)
  })

  test('control: the old prefix check allowed every lookalike', () => {
    for (const url of LOOKALIKES) expect(oldOpenUrlCheck(url), url).toBe(true)
  })

  test('denies other schemes, malformed input and non-strings', () => {
    for (const url of [...OTHER_SCHEMES, 'not a url', '', null, undefined, 42, {}]) {
      expect(isAllowedExternalUrl(url), String(url)).toBe(false)
    }
  })

  test('denies a bare tailnet IP (the API binds 127.0.0.1, nothing listens there)', () => {
    expect(isAllowedExternalUrl('http://100.72.128.44:8000')).toBe(false)
  })

  test('every allowlisted host is reachable over https only', () => {
    for (const host of ALLOWED_EXTERNAL_HOSTS) {
      expect(isAllowedExternalUrl(`https://${host}/`), host).toBe(true)
      expect(isAllowedExternalUrl(`http://${host}/`), host).toBe(false)
    }
  })
})

// Other tailnet names: a sibling machine, another tailnet, a subdomain of the
// user's own name, and the ts.net apex names.
const OTHER_TAILNET_URLS = [
  'https://other.example.ts.net',
  'https://ember.other.ts.net',
  'https://x.ember.example.ts.net',
  'https://example.ts.net',
  'https://ts.net',
]

// The tailnet rule before it was narrowed to the user's own host, kept to prove
// the fixtures above exercise the narrowing.
function oldTailnetCheck(url) {
  return new URL(url).hostname.endsWith('.ts.net')
}

// tailnetHost values that must not allow anything: a non-tailnet domain, too few
// labels, a port, userinfo, an IP.
const INVALID_TAILNET_HOSTS = [
  'evil.example.test', 'ts.net', 'example.ts.net', 'ember.example.ts.net:443',
  'user@ember.example.ts.net', '100.72.128.44', 'a..example.ts.net',
]

test.describe('tailnet host', () => {
  test("allows the user's own host", () => {
    for (const url of [OWN_URL, `${OWN_URL}/chat`, 'https://EMBER.Example.ts.net']) {
      expect(isAllowedExternalUrl(url, { tailnetHost: OWN }), url).toBe(true)
    }
    // The raw DNSName form, mixed case with the trailing dot.
    expect(isAllowedExternalUrl(OWN_URL, { tailnetHost: 'Ember.Example.ts.net.' })).toBe(true)
  })

  test('denies every other *.ts.net host when the own host is known', () => {
    for (const url of OTHER_TAILNET_URLS) expect(isAllowedExternalUrl(url, { tailnetHost: OWN }), url).toBe(false)
  })

  test('control: the old suffix rule allowed the other tailnet hosts, and the own host still passes', () => {
    for (const url of OTHER_TAILNET_URLS.filter((u) => u !== 'https://ts.net')) {
      expect(oldTailnetCheck(url), url).toBe(true)
    }
    expect(isAllowedExternalUrl(OWN_URL, { tailnetHost: OWN })).toBe(true)
  })

  test('an unknown own host denies every *.ts.net host', () => {
    for (const url of [OWN_URL, ...OTHER_TAILNET_URLS]) {
      expect(isAllowedExternalUrl(url), url).toBe(false)
      for (const options of [{}, { tailnetHost: null }, { tailnetHost: '' }]) {
        expect(isAllowedExternalUrl(url, options), `${url} ${JSON.stringify(options)}`).toBe(false)
      }
    }
  })

  test('control: the same URL is allowed once the own host is known', () => {
    expect(isAllowedExternalUrl(OWN_URL, { tailnetHost: OWN })).toBe(true)
  })

  test('an invalid tailnetHost allows nothing it names', () => {
    for (const tailnetHost of INVALID_TAILNET_HOSTS) {
      expect(isAllowedExternalUrl(OWN_URL, { tailnetHost }), tailnetHost).toBe(false)
      expect(isAllowedExternalUrl(`https://${tailnetHost}`, { tailnetHost }), tailnetHost).toBe(false)
    }
  })

  test('control: a valid tailnetHost passed the same way allows its URL', () => {
    expect(isAllowedExternalUrl(OWN_URL, { tailnetHost: OWN })).toBe(true)
    expect(isAllowedExternalUrl(`${OWN_URL}:443`, { tailnetHost: OWN })).toBe(true)
  })

  test('the own host is https only', () => {
    expect(isAllowedExternalUrl(`http://${OWN}`, { tailnetHost: OWN })).toBe(false)
  })

  test('tailnetHostFromDnsName keeps only a <machine>.<tailnet>.ts.net name', () => {
    expect(tailnetHostFromDnsName('Ember.Example.ts.net.')).toBe(OWN)
    for (const dns of [null, undefined, '', 42, ...INVALID_TAILNET_HOSTS]) {
      expect(tailnetHostFromDnsName(dns), String(dns)).toBeNull()
    }
  })

  test('parseTailscaleDns reads Self.DNSName and is null on any failure', () => {
    expect(parseTailscaleDns({ ok: true, stdout: '{"Self":{"DNSName":"ember.example.ts.net."}}' })).toBe(OWN)
    for (const result of [
      null,
      { ok: false, stdout: '{"Self":{"DNSName":"ember.example.ts.net."}}' },
      { ok: true, stdout: 'not json' },
      { ok: true, stdout: '{}' },
      { ok: true, stdout: '{"Self":{}}' },
    ]) {
      expect(parseTailscaleDns(result), JSON.stringify(result)).toBeNull()
    }
  })

  test('allowlisted hosts are unaffected by the tailnet host', () => {
    for (const host of ALLOWED_EXTERNAL_HOSTS) {
      expect(isAllowedExternalUrl(`https://${host}/`, { tailnetHost: OWN }), host).toBe(true)
      expect(isAllowedExternalUrl(`https://${host}/`), host).toBe(true)
    }
  })
})
