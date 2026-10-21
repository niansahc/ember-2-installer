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

// The renderer's Done-screen notice links to RELEASES_URL for every manual result.
function manualResult(message) {
  return { ok: false, manual: true, message }
}

function isManualPlatform(platform) {
  return Object.hasOwn(MANUAL_PLATFORMS, platform)
}

// Resolves { ok: true } once the update is downloaded (electron-updater then
// emits update-downloaded), a manual result, or { ok: false, error }. Never rejects.
async function downloadInstallerUpdate(updater, platform) {
  if (isManualPlatform(platform)) return manualResult(MANUAL_PLATFORMS[platform])
  if (!updater) return { ok: false, error: 'The installer updater is not available in this build.' }
  try {
    // null when the app is not packaged: electron-updater skips the check.
    const result = await updater.checkForUpdates()
    if (!result || !result.isUpdateAvailable) return manualResult(UNAVAILABLE_MESSAGE)
    await updater.downloadUpdate()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err) }
  }
}

module.exports = { RELEASES_URL, downloadInstallerUpdate, isManualPlatform, manualResult }
