// Shared helpers for Electron Playwright tests
// Launches the installer in demo mode

const { _electron: electron } = require('@playwright/test')
const path = require('path')

const MAIN_PATH = path.join(__dirname, '..', '..', 'src', 'main.js')

async function launchApp() {
  const electronPath = require('electron')
  const app = await electron.launch({
    executablePath: electronPath,
    args: [MAIN_PATH],
  })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  return { app, window }
}

module.exports = { launchApp }
