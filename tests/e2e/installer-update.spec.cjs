// Unit tests for downloadInstallerUpdate (src/lib/installer-update.js). Requires
// the module directly, no app launch. The fake updater enforces the
// electron-updater 6.x contract the fix depends on: downloadUpdate rejects with
// "Please check update first" unless a check that found an update ran first.

const { test, expect } = require('@playwright/test')
const { RELEASES_URL, downloadInstallerUpdate } = require('../../src/lib/installer-update')

function fakeUpdater({ available = true, checkError = null, downloadError = null } = {}) {
  const calls = []
  let checked = false
  return {
    calls,
    async checkForUpdates() {
      calls.push('check')
      if (checkError) throw new Error(checkError)
      if (available) checked = true
      return { isUpdateAvailable: available, updateInfo: { version: '9.9.9' } }
    },
    async downloadUpdate() {
      calls.push('download')
      if (!checked) throw new Error('Please check update first')
      if (downloadError) throw new Error(downloadError)
      return ['Ember Setup 9.9.9.exe']
    },
  }
}

test.describe('downloadInstallerUpdate', () => {
  test('Windows: checks, then downloads, then reports ok', async () => {
    const updater = fakeUpdater()
    expect(await downloadInstallerUpdate(updater, 'win32')).toEqual({ ok: true })
    expect(updater.calls).toEqual(['check', 'download'])
  })

  test('control: downloading without the check (the old handler) is rejected by the fake', async () => {
    const updater = fakeUpdater()
    await expect(updater.downloadUpdate()).rejects.toThrow('Please check update first')
  })

  test('no update in the release metadata: manual result, download never called', async () => {
    const updater = fakeUpdater({ available: false })
    const r = await downloadInstallerUpdate(updater, 'win32')
    expect(r).toMatchObject({ ok: false, manual: true, url: RELEASES_URL })
    expect(updater.calls).toEqual(['check'])
  })

  test('unpackaged app (check resolves null): manual result, download never called', async () => {
    const updater = { calls: [], checkForUpdates: async () => null, downloadUpdate: async () => { updater.calls.push('download') } }
    const r = await downloadInstallerUpdate(updater, 'win32')
    expect(r.manual).toBe(true)
    expect(updater.calls).toEqual([])
  })

  test('a failing check or download resolves ok:false with the error', async () => {
    expect(await downloadInstallerUpdate(fakeUpdater({ checkError: 'net::ERR_INTERNET_DISCONNECTED' }), 'win32'))
      .toEqual({ ok: false, error: 'net::ERR_INTERNET_DISCONNECTED' })
    expect(await downloadInstallerUpdate(fakeUpdater({ downloadError: 'sha512 checksum mismatch' }), 'win32'))
      .toEqual({ ok: false, error: 'sha512 checksum mismatch' })
  })

  test('no updater (dev build): ok:false, not a silent success', async () => {
    const r = await downloadInstallerUpdate(null, 'win32')
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })

  test('Linux and macOS: manual result, updater never touched', async () => {
    for (const platform of ['linux', 'darwin']) {
      const updater = fakeUpdater()
      const r = await downloadInstallerUpdate(updater, platform)
      expect(r).toMatchObject({ ok: false, manual: true, url: RELEASES_URL })
      expect(r.message).toMatch(platform === 'linux' ? /AppImage/ : /DMG/)
      expect(updater.calls).toEqual([])
    }
  })
})
