// Unit tests for downloadInstallerUpdate (src/lib/installer-update.js). Requires
// the module directly, no app launch. The fake updater enforces the
// electron-updater 6.x contract the fix depends on: downloadUpdate rejects with
// "Please check update first" unless a check that found an update ran first.

const { test, expect } = require('@playwright/test')
const fs = require('fs')
const path = require('path')
const { HttpError, newError } = require('builder-util-runtime')
const {
  FAILED_MESSAGE, RELEASES_URL, UNAVAILABLE_MESSAGE, downloadInstallerUpdate, isManualPlatform,
} = require('../../src/lib/installer-update')

// The error electron-updater 6.x throws from checkForUpdates when the release has
// no latest.yml, built the way GitHubProvider builds it: a 404 HttpError (whose
// message carries the response headers, as createHttpError writes it) wrapped by newError.
const LEAK_MARKERS = ['Cannot find latest.yml', 'Headers:', 'x-github-request-id', 'HttpError']
function missingLatestYmlError() {
  const http = new HttpError(404, '404 Not Found\nHeaders: {\n  "x-github-request-id": "0000:1111:2222"\n}')
  const url = 'https://github.com/niansahc/ember-2-installer/releases/download/v9.9.9/latest.yml'
  return newError(`Cannot find latest.yml in the latest release artifacts (${url}): ${http.stack}`, 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND')
}

function leaks(value) {
  const text = JSON.stringify(value)
  return LEAK_MARKERS.filter((m) => text.includes(m))
}

function fakeUpdater({ available = true, checkError = null, downloadError = null } = {}) {
  const toError = (e) => (e instanceof Error ? e : new Error(e))
  const calls = []
  let checked = false
  return {
    calls,
    async checkForUpdates() {
      calls.push('check')
      if (checkError) throw toError(checkError)
      if (available) checked = true
      return { isUpdateAvailable: available, updateInfo: { version: '9.9.9' } }
    },
    async downloadUpdate() {
      calls.push('download')
      if (!checked) throw new Error('Please check update first')
      if (downloadError) throw toError(downloadError)
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
    expect(r).toMatchObject({ ok: false, manual: true })
    expect(updater.calls).toEqual(['check'])
  })

  test('unpackaged app (check resolves null): manual result, download never called', async () => {
    const updater = { calls: [], checkForUpdates: async () => null, downloadUpdate: async () => { updater.calls.push('download') } }
    const r = await downloadInstallerUpdate(updater, 'win32')
    expect(r.manual).toBe(true)
    expect(updater.calls).toEqual([])
  })

  test('a release without latest.yml: the unavailable message, raw error logged only', async () => {
    const logged = []
    const r = await downloadInstallerUpdate(fakeUpdater({ checkError: missingLatestYmlError() }), 'win32', {
      logError: (...args) => logged.push(args),
    })
    expect(r).toEqual({ ok: false, manual: true, message: UNAVAILABLE_MESSAGE })
    expect(leaks(r)).toEqual([])
    expect(logged).toHaveLength(1)
  })

  test('control: the fixture error carries the raw text the result must not', () => {
    const err = missingLatestYmlError()
    expect(err.code).toBe('ERR_UPDATER_CHANNEL_FILE_NOT_FOUND')
    expect(leaks({ error: err.message })).toEqual(LEAK_MARKERS)
  })

  test('any other check or download error: the failed message, raw error logged only', async () => {
    for (const [opts, raw] of [
      [{ checkError: 'net::ERR_INTERNET_DISCONNECTED' }, 'net::ERR_INTERNET_DISCONNECTED'],
      [{ downloadError: 'sha512 checksum mismatch' }, 'sha512 checksum mismatch'],
    ]) {
      const logged = []
      const r = await downloadInstallerUpdate(fakeUpdater(opts), 'win32', { logError: (...args) => logged.push(args) })
      expect(r).toEqual({ ok: false, manual: true, message: FAILED_MESSAGE })
      expect(JSON.stringify(r)).not.toContain(raw)
      expect(logged[0][1].message).toBe(raw)
    }
  })

  test('no updater (dev build): a manual result, not a silent success', async () => {
    const r = await downloadInstallerUpdate(null, 'win32', { logError: () => {} })
    expect(r).toEqual({ ok: false, manual: true, message: UNAVAILABLE_MESSAGE })
  })

  test('Linux and macOS: manual result, updater never touched', async () => {
    for (const platform of ['linux', 'darwin']) {
      const updater = fakeUpdater()
      const r = await downloadInstallerUpdate(updater, platform)
      expect(r).toMatchObject({ ok: false, manual: true })
      expect(r.message).toMatch(platform === 'linux' ? /AppImage/ : /DMG/)
      expect(updater.calls).toEqual([])
      expect(isManualPlatform(platform)).toBe(true)
    }
    expect(isManualPlatform('win32')).toBe(false)
  })

  // check-all-updates runs in main.js, which cannot be required here; this pins
  // that it offers the installer update exactly where the download is not manual.
  test('check-all-updates uses isManualPlatform for installer self-update', () => {
    const main = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main.js'), 'utf-8')
    expect(main).toMatch(/const installerSelfUpdate = !isManualPlatform\(process\.platform\)/)
  })

  // Every manual result's notice links to the Releases page; the link's URL
  // lives on the anchor in index.html, which the renderer cannot require from here.
  test('the Done-screen Releases link points at RELEASES_URL', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'index.html'), 'utf-8')
    const anchor = html.match(/<a [^>]*id="btn-open-installer-releases"[^>]*>/)
    expect(anchor).not.toBeNull()
    expect(anchor[0]).toContain(`data-url="${RELEASES_URL}"`)
  })
})
