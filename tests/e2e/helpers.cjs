// Shared helpers for Electron Playwright tests
// Launches the installer in demo mode

const { _electron: electron } = require('@playwright/test')
const path = require('path')

const MAIN_PATH = path.join(__dirname, '..', '..', 'src', 'main.js')

// launchApp({ extraArgs: ['--demo-updates'] }) — optional extra argv flags
// get appended after the main script path. Default behaviour (no options)
// is unchanged: boots the installer in standard demo mode.
async function launchApp(options = {}) {
  const extraArgs = options.extraArgs || []
  const electronPath = require('electron')
  const app = await electron.launch({
    executablePath: electronPath,
    args: [MAIN_PATH, ...extraArgs],
  })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  return { app, window }
}

module.exports = { launchApp }
