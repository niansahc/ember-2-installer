// Unit tests for isAllowedExternalUrl (src/lib/external-url.js), the one check
// for URLs handed to the default browser. Requires the module directly, no app
// launch (build-config.spec pattern).

const { test, expect } = require('@playwright/test')
const fs = require('fs')
const path = require('path')
const { ALLOWED_EXTERNAL_HOSTS, isAllowedExternalUrl } = require('../../src/lib/external-url')

// Every literal URL in the renderer, read from source so a link added there is
// checked here too. Templated URLs (`https://${dns}`) are skipped; the samples
// below stand in for them.
const RENDERER_URLS = [...new Set(['index.html', 'app.js'].flatMap((file) => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', file), 'utf-8')
  return source.match(/https?:\/\/[^"'`<>\s)]+/g) || []
}))].filter((url) => !url.includes('${'))

// The tailnet HTTPS name and the local API, which the renderer builds at runtime.
const TEMPLATED_URL_SAMPLES = ['https://ember.example.ts.net', 'http://127.0.0.1:8000']

// https or http-localhost strings that are not allowed destinations.
const LOOKALIKES = [
  'https://github.com.evil.test/x',
  'https://evil.example.test',
  'https://ts.net',
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
