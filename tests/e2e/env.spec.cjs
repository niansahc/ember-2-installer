// Unit tests for buildEnvFile (src/lib/env.js) — the .env the wizard writes for
// ember-2. Requires the module directly, no app launch (build-config.spec
// pattern). Asserts functional invariants (the real vars, the vision branch, the
// per-platform credential-store line, path normalization), not the cosmetic
// comment separators.

const { test, expect } = require('@playwright/test')
const { buildEnvFile, uiBuildEnv } = require('../../src/lib/env')

const base = {
  vault: 'C:\\EmberVault',
  host: '127.0.0.1',
  model: 'qwen3:8b',
  vision: 'qwen3-vl:8b',
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
    const env = buildEnvFile({ ...base, vision: 'qwen3-vl:8b' })
    expect(env).toContain('EMBER_VISION_MODEL=qwen3-vl:8b\n')
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

test.describe('uiBuildEnv', () => {
  const parent = { PATH: '/usr/bin', HOME: '/home/demo' }

  test('passes the key to the UI build through the environment', () => {
    const env = uiBuildEnv(parent, 'synthetic_key_value')
    expect(env.EMBER_API_KEY).toBe('synthetic_key_value')
    expect(env.VITE_EMBER_API_KEY).toBe('synthetic_key_value')
    expect(env.VITE_EMBER_API_URL).toBe('/v1')
    expect(env.PATH).toBe('/usr/bin')
  })

  test('sets no key variables when no key was read', () => {
    const env = uiBuildEnv(parent, null)
    expect(env).not.toHaveProperty('EMBER_API_KEY')
    expect(env).not.toHaveProperty('VITE_EMBER_API_KEY')
    expect(env.VITE_EMBER_API_URL).toBe('/v1')
  })

  test('control: the same assertion fails when a key is given', () => {
    expect(uiBuildEnv(parent, 'synthetic_key_value')).toHaveProperty('EMBER_API_KEY')
  })

  test('does not modify the parent environment', () => {
    uiBuildEnv(parent, 'synthetic_key_value')
    expect(parent).toEqual({ PATH: '/usr/bin', HOME: '/home/demo' })
  })
})
