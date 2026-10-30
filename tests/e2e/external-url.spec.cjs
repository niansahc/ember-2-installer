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

// The local API, which the renderer builds at runtime. The tailnet name is not
// here: main's open-ember handler opens it, and open-url denies it.
const TEMPLATED_URL_SAMPLES = ['http://127.0.0.1:8000']

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
      expect(isAllowedExternalUrl(url), url).toBe(true)
    }
  })

  test('denies lookalike hosts and embedded credentials', () => {
    for (const url of LOOKALIKES) expect(isAllowedExternalUrl(url), url).toBe(false)
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

// Every *.ts.net URL, the user's own name included: open-url never opens one.
const TAILNET_URLS = [
  OWN_URL,
  `${OWN_URL}/chat`,
  'https://other.example.ts.net',
  'https://ember.other.ts.net',
  'https://x.ember.example.ts.net',
  'https://example.ts.net',
]

// The tailnet rule before open-ember, kept as the positive control: it allowed
// the user's own name, which is what the denial below removes.
function oldOwnHostCheck(url) {
  return new URL(url).hostname === OWN
}

// tailnetHost values that must not allow anything: a non-tailnet domain, too few
// labels, a port, userinfo, an IP, an empty label.
const INVALID_TAILNET_HOSTS = [
  'evil.example.test', 'ts.net', 'example.ts.net', 'ember.example.ts.net:443',
  'user@ember.example.ts.net', '100.72.128.44', 'a..example.ts.net',
]

test.describe('tailnet host', () => {
  test('open-url denies every *.ts.net URL, the own host included', () => {
    for (const url of TAILNET_URLS) expect(isAllowedExternalUrl(url), url).toBe(false)
  })

  test('control: the old own-host rule allowed the own host', () => {
    expect(oldOwnHostCheck(OWN_URL)).toBe(true)
  })

  test('tailnetHostFromDnsName keeps only a <machine>.<tailnet>.ts.net name', () => {
    expect(tailnetHostFromDnsName('Ember.Example.ts.net')).toBe(OWN)
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
})
