// Installer self-update download, driven through an injected electron-updater
// instance so the orchestration can be unit-tested without Electron.
//
// Detection stays with the api.github.com check (check-all-updates). This only
// downloads. electron-updater refuses to download until its own check has run
// ("Please check update first"), so the check runs here, on the user's click,
// never at startup (startup checks caused unprompted OS dialogs, commit 275a513).

const RELEASES_URL = 'https://github.com/niansahc/ember-2-installer/releases/latest'

// Platforms where the installer is updated by hand.
const MANUAL_PLATFORMS = {
  // AppImage self-replacement is untested on real Linux hardware.
  linux: 'On Linux, download the latest AppImage from the GitHub Releases page.',
  // The DMG is unsigned, and macOS will not apply an unsigned update.
  darwin: 'On macOS, download the latest DMG from the GitHub Releases page.',
}

// The release has no update metadata (latest.yml), or it is not newer than this build.
const UNAVAILABLE_MESSAGE = 'The automatic installer update is not available for this release. Download the latest installer from the GitHub Releases page.'

// Any other updater failure. The error itself goes to logError in the main
// process: electron-updater messages carry stacks and HTTP response headers.
const FAILED_MESSAGE = 'The automatic installer update failed. Download the latest installer from the GitHub Releases page.'

// electron-updater error codes for a release without usable update metadata.
const UNAVAILABLE_CODES = new Set(['ERR_UPDATER_CHANNEL_FILE_NOT_FOUND', 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND'])

// The renderer's Done-screen notice links to RELEASES_URL for every manual result.
function manualResult(message) {
  return { ok: false, manual: true, message }
}

function isManualPlatform(platform) {
  return Object.hasOwn(MANUAL_PLATFORMS, platform)
}

// Resolves { ok: true } once the update is downloaded (electron-updater then
// emits update-downloaded), or a manual result. Never rejects, and never
// returns an updater error: those go to logError only.
async function downloadInstallerUpdate(updater, platform, { logError = console.error } = {}) {
  if (isManualPlatform(platform)) return manualResult(MANUAL_PLATFORMS[platform])
  if (!updater) {
    logError('[installer-update] electron-updater is not available in this build')
    return manualResult(UNAVAILABLE_MESSAGE)
  }
  try {
    // null when the app is not packaged: electron-updater skips the check.
    const result = await updater.checkForUpdates()
    if (!result || !result.isUpdateAvailable) return manualResult(UNAVAILABLE_MESSAGE)
    await updater.downloadUpdate()
    return { ok: true }
  } catch (err) {
    logError('[installer-update]', err)
    return manualResult(UNAVAILABLE_CODES.has(err && err.code) ? UNAVAILABLE_MESSAGE : FAILED_MESSAGE)
  }
}

module.exports = { FAILED_MESSAGE, RELEASES_URL, UNAVAILABLE_MESSAGE, downloadInstallerUpdate, isManualPlatform, manualResult }
