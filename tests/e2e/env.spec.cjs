// Unit tests for buildEnvFile (src/lib/env.js) — the .env the wizard writes for
// ember-2. Requires the module directly, no app launch (build-config.spec
// pattern). Asserts functional invariants (the real vars, the vision branch, the
// per-platform credential-store line, path normalization), not the cosmetic
// comment separators.

const { test, expect } = require('@playwright/test')
const { buildEnvFile } = require('../../src/lib/env')

const base = {
  vault: 'C:\\EmberVault',
  host: '127.0.0.1',
  model: 'qwen3:8b',
  vision: 'llama3.2-vision:11b',
  platform: 'win32',
}

test.describe('buildEnvFile', () => {
  test('writes the core vault/host/model vars', () => {
    const env = buildEnvFile(base)
    expect(env.startsWith('# Written by Ember Setup Wizard\n')).toBe(true)
    expect(env).toContain('\nEMBER_HOST=127.0.0.1\n')
    expect(env).toContain('\nEMBER_MODEL=qwen3:8b\n')
  })

  test('normalizes backslashes in the vault path to forward slashes', () => {
    const env = buildEnvFile({ ...base, vault: 'C:\\Users\\me\\EmberVault' })
    expect(env).toContain('PRIVATE_VAULT_PATH=C:/Users/me/EmberVault\n')
    expect(env).not.toContain('\\')
  })

  test('writes the vision model line when vision is set', () => {
    const env = buildEnvFile({ ...base, vision: 'llama3.2-vision:11b' })
    expect(env).toContain('EMBER_VISION_MODEL=llama3.2-vision:11b\n')
  })

  test('comments out the vision line when vision is disabled', () => {
    const env = buildEnvFile({ ...base, vision: null })
    expect(env).toContain('# EMBER_VISION_MODEL=  (vision disabled)\n')
    // no uncommented EMBER_VISION_MODEL= line
    expect(env).not.toMatch(/^EMBER_VISION_MODEL=/m)
  })

  test('names the credential store per platform', () => {
    expect(buildEnvFile({ ...base, platform: 'win32' })).toContain('Windows Credential Manager')
    expect(buildEnvFile({ ...base, platform: 'darwin' })).toContain('macOS Keychain')
    expect(buildEnvFile({ ...base, platform: 'linux' })).toContain('system keyring (SecretService)')
    expect(buildEnvFile({ ...base, platform: 'freebsd' })).toContain('OS credential store')
  })
})
