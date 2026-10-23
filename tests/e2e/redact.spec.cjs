// Unit tests for log redaction (src/lib/redact.js) and the rule that every log
// channel send in main.js goes through sendLog. Requires modules / reads source
// directly, no app launch (build-config.spec pattern). Secrets are synthetic.

const { test, expect } = require('@playwright/test')
const fs = require('fs')
const path = require('path')
const { REDACTED, parseKeyLine, registerSecret, redactSecrets } = require('../../src/lib/redact')

const SECRET = 'synthetic_secret_value_0123456789abcdef'

// Lines the redactor must clean. Each one carries SECRET.
const LEAKY = [
  `Key: ${SECRET}\n`,
  `API key stored in system credential store.\nKey:   ${SECRET}\n`,
  `[build] using ${SECRET} for the bundle\n`,
]

test.describe('redactSecrets', () => {
  test('redacts the value on a Key: line', () => {
    expect(redactSecrets('Key: abc123def\n', [])).toBe(`Key: ${REDACTED}\n`)
  })

  test('redacts a known secret wherever it appears', () => {
    for (const line of LEAKY) {
      const out = redactSecrets(line, [SECRET])
      expect(out).not.toContain(SECRET)
      expect(out).toContain(REDACTED)
    }
  })

  test('control: the fixtures carry the secret before redaction', () => {
    const identity = (text) => text
    for (const line of LEAKY) expect(identity(line)).toContain(SECRET)
  })

  test('leaves text without a secret unchanged', () => {
    const text = 'API key already configured ✓\nCollecting fastapi\n'
    expect(redactSecrets(text, [SECRET])).toBe(text)
  })

  test('registerSecret feeds the default secret set; short values are ignored', () => {
    registerSecret(SECRET)
    registerSecret('abc')
    expect(redactSecrets(`x ${SECRET} y`)).toBe(`x ${REDACTED} y`)
    expect(redactSecrets('abc')).toBe('abc')
  })

  test('passes non-string payloads through', () => {
    expect(redactSecrets(undefined, [SECRET])).toBeUndefined()
  })
})

test.describe('parseKeyLine', () => {
  test('reads the value the redactor hides', () => {
    for (const line of LEAKY.slice(0, 2)) {
      expect(parseKeyLine(line)).toBe(SECRET)
      expect(redactSecrets(line, [])).not.toContain(SECRET)
    }
  })

  test('null when there is no Key: line or no text', () => {
    expect(parseKeyLine('API key already configured. No changes made.\n')).toBeNull()
    expect(parseKeyLine(undefined)).toBeNull()
  })
})

// A direct webContents.send on a log channel would skip redaction. main.js
// routes them all through sendLog; this pins that. The channel names are read
// from main.js's LOG_CHANNELS, so a new log channel is covered without an edit here.
function logChannels(source) {
  const block = source.match(/const LOG_CHANNELS = new Set\(\[([\s\S]*?)\]\)/)
  return block ? [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : []
}

function directLogSends(source) {
  const sends = new RegExp(`webContents\\.send\\(\\s*['"](${logChannels(source).join('|')})['"]`, 'g')
  return source.match(sends) || []
}

test.describe('log channel sends', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main.js'), 'utf-8')

  test('LOG_CHANNELS is found in main.js', () => {
    expect(logChannels(source)).toEqual(expect.arrayContaining(['install-log', 'update-all-log', 'ollama-pull-progress']))
  })

  test('main.js sends no log channel text outside sendLog', () => {
    expect(directLogSends(source)).toEqual([])
  })

  test('control: a direct send injected into main.js is flagged', () => {
    const injected = `${source}\nmainWindow.webContents.send('install-log', { step, text })\n`
    expect(directLogSends(injected)).toHaveLength(1)
  })
})
