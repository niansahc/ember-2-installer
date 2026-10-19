// Unit tests for log redaction (src/lib/redact.js) and the rule that every log
// channel send in main.js goes through sendLog. Requires modules / reads source
// directly, no app launch (build-config.spec pattern). Secrets are synthetic.

const { test, expect } = require('@playwright/test')
const fs = require('fs')
const path = require('path')
const { REDACTED, registerSecret, redactSecrets } = require('../../src/lib/redact')

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

// A direct webContents.send on a log channel would skip redaction. main.js
// routes them all through sendLog; this pins that.
const LOG_SEND = /webContents\.send\(\s*['"](install-log|update-all-log|ember-update-log|prereq-install-progress|clone-progress|ollama-pull-progress)['"]/g

function directLogSends(source) {
  return source.match(LOG_SEND) || []
}

test.describe('log channel sends', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main.js'), 'utf-8')

  test('main.js sends no log channel text outside sendLog', () => {
    expect(directLogSends(source)).toEqual([])
  })

  test('control: a direct send injected into main.js is flagged', () => {
    const injected = `${source}\nmainWindow.webContents.send('install-log', { step, text })\n`
    expect(directLogSends(injected)).toHaveLength(1)
  })
})
