// Pure .env assembly. No Electron/Node-runtime deps so this module can be
// required and unit-tested in isolation (main.js can't — it boots the app).
//
// `platform` is passed in (process.platform from the caller) so the per-platform
// credential-store line is testable without stubbing the runtime.

const CRED_STORE_NAMES = {
  win32: 'Windows Credential Manager',
  darwin: 'macOS Keychain',
  linux: 'system keyring (SecretService)',
}

// Assemble the ember-2 .env contents. Returns the full file text; the caller
// writes it. The API key itself is never written here — it lives in the OS
// credential store; this only records where to find it.
function buildEnvFile({ vault, host, model, vision, platform } = {}) {
  const vaultFwd = vault.replace(/\\/g, '/')
  const lines = [
    '# Written by Ember Setup Wizard\n',
    '\n',
    '# ── Vault ─────────────────────────────────────────────────────────\n',
    `PRIVATE_VAULT_PATH=${vaultFwd}\n`,
    '\n',
    '# ── API Host ───────────────────────────────────────────────────────\n',
    `EMBER_HOST=${host}\n`,
    '\n',
    '# ── Models ─────────────────────────────────────────────────────────\n',
    `EMBER_MODEL=${model}\n`,
  ]
  if (vision) {
    lines.push(`EMBER_VISION_MODEL=${vision}\n`)
  } else {
    lines.push('# EMBER_VISION_MODEL=  (vision disabled)\n')
  }
  const credStore = CRED_STORE_NAMES[platform] || 'OS credential store'
  lines.push(
    '\n',
    '# ── API Key ────────────────────────────────────────────────────────\n',
    `# API key is stored in ${credStore} — not here.\n`,
    '# Run: python scripts/set_api_key.py\n',
  )
  return lines.join('')
}

module.exports = { buildEnvFile }
