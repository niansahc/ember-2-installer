// Hermetic integration test for the on-disk version reads (src/exec/installed.js):
// real files in a temp dir. No git, no network, no Electron.

const { test, expect } = require('@playwright/test')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  installedBackendVersion, installedUiVersion, builtUiTag, recordBuiltUiTag, BUILT_UI_FILE,
} = require('../../src/exec/installed')

test.describe('installed versions', () => {
  let tmp
  const write = (name, text) => fs.writeFileSync(path.join(tmp, name), text)

  test.beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-installed-'))
  })
  test.afterEach(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
  })

  test('backend: version.json { version } is the installed version', () => {
    write('version.json', '{"version":"0.18.1"}\n')
    expect(installedBackendVersion(tmp)).toBe('0.18.1')
  })

  test('backend: a { tag } file from an older installer reads as unknown, as /api/health does', () => {
    write('version.json', '{"tag":"v0.18.1"}\n')
    expect(installedBackendVersion(tmp)).toBeNull()
  })

  test('control: the same file with a version as well reads that version', () => {
    write('version.json', '{"tag":"v0.18.1","version":"0.17.0"}\n')
    expect(installedBackendVersion(tmp)).toBe('0.17.0')
  })

  test('backend: a version that is not a string, or no file, reads as unknown', () => {
    write('version.json', '{"version":18}\n')
    expect(installedBackendVersion(tmp)).toBeNull()
    write('version.json', 'not json')
    expect(installedBackendVersion(tmp)).toBeNull()
    expect(installedBackendVersion(path.join(tmp, 'missing'))).toBeNull()
  })

  test('UI: package.json version, and unknown when it is not a string', () => {
    write('package.json', '{"version":"0.18.1"}\n')
    expect(installedUiVersion(tmp)).toBe('0.18.1')
    write('package.json', '{"version":18}\n')
    expect(installedUiVersion(tmp)).toBeNull()
  })

  test('built UI tag: recorded, then read back; unknown before any record', () => {
    expect(builtUiTag(tmp)).toBeNull()
    recordBuiltUiTag(tmp, 'v0.18.1')
    expect(builtUiTag(tmp)).toBe('v0.18.1')
    expect(JSON.parse(fs.readFileSync(path.join(tmp, BUILT_UI_FILE), 'utf8'))).toEqual({ tag: 'v0.18.1' })
  })
})
