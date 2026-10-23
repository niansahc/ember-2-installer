// Secret redaction for text that leaves the main process (renderer log channels,
// the API startup-log tail). Pure apart from the registered-secret set, so it can
// be required and unit-tested without Electron.
//
// Two layers: any `Key: <value>` line (the format set_api_key.py prints) is
// redacted by pattern, and any value passed to registerSecret is redacted
// wherever it appears. Neither layer can see a secret split across two streamed
// chunks, so this is a backstop: callers that handle the key must not stream it.

const REDACTED = '[redacted]'
const KEY_LINE = /\b(Key:[ \t]*)(\S+)/g

// Shorter values would redact ordinary words; a real API key is 43 characters.
const MIN_SECRET_LENGTH = 8

const registered = new Set()

function registerSecret(value) {
  if (typeof value === 'string' && value.length >= MIN_SECRET_LENGTH) registered.add(value)
}

// The value on the first `Key: <value>` line, or null. Reads KEY_LINE, so the
// parser and the redactor cannot disagree on the format.
function parseKeyLine(text) {
  const match = typeof text === 'string' ? text.match(new RegExp(KEY_LINE.source)) : null
  return match ? match[2] : null
}

function redactSecrets(text, secrets = registered) {
  if (typeof text !== 'string') return text
  let out = text.replace(KEY_LINE, `$1${REDACTED}`)
  for (const secret of secrets) {
    if (out.includes(secret)) out = out.split(secret).join(REDACTED)
  }
  return out
}

module.exports = { REDACTED, parseKeyLine, registerSecret, redactSecrets }
