// Shared helpers for Electron Playwright tests
// Launches the installer in demo mode

const { _electron: electron } = require('@playwright/test')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const MAIN_PATH = path.join(__dirname, '..', '..', 'src', 'main.js')

// How long closeApp waits for a graceful app.close() before killing the process tree.
const CLOSE_TIMEOUT_MS = 10000

// How long removeProfile keeps retrying a user-data dir that is still locked.
const PROFILE_REMOVE_TIMEOUT_MS = 15000

// Apps launchApp started that nothing has closed yet, mapped to the private
// user-data dir each one runs in. A worker runs one test at
// a time, so when afterEach calls closeApp, any app still here besides its own
// never reached the spec (a launch stalled in firstWindow when the test
// timeout aborted beforeEach) and would leak.
const live = new Map()

/**
 * Remove a launch's user-data dir. A killed tree can keep files open for a few
 * seconds on Windows (EBUSY), so retry until the dir is gone or the budget ends.
 */
async function removeProfile(dir) {
  if (!dir) return
  const deadline = Date.now() + PROFILE_REMOVE_TIMEOUT_MS
  for (;;) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {}
    if (!fs.existsSync(dir) || Date.now() > deadline) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

/** Kill `pid` and its child processes (renderer, GPU, utility). */
function killTree(pid) {
  if (!pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {}
  }
}

// closeApp(app, { timeoutMs }) — close an app launchApp returned. A graceful
// close that errors or does not finish inside timeoutMs is followed by a kill
// of the process tree, so a failed or stalled test leaves no Electron process
// behind. Safe on undefined (a launch that never returned an app). Also kills
// any other app launchApp started in this worker that is still open (see `live`).
async function closeApp(app, options = {}) {
  const profile = live.get(app)
  live.delete(app)
  for (const [stray, strayProfile] of live) {
    live.delete(stray)
    killTree(stray.process().pid)
    await removeProfile(strayProfile)
  }
  if (!app) return
  const timeoutMs = options.timeoutMs ?? CLOSE_TIMEOUT_MS
  const pid = app.process().pid
  let timer
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs)
  })
  try {
    const outcome = await Promise.race([app.close().then(() => 'closed'), timedOut])
    if (outcome === 'timeout') killTree(pid)
  } catch {
    killTree(pid)
  } finally {
    clearTimeout(timer)
    await removeProfile(profile)
  }
}

// launchApp({ extraArgs: ['--demo-updates'] }) — optional extra argv flags
// get appended after the main script path. Default behaviour (no options)
// boots the installer in standard demo mode.
// Every launch gets its own --user-data-dir under the OS temp dir, so launches
// (8 workers at once) never share a Chromium profile or cache with each other
// or with the installed app; closeApp removes it. Nothing a spec relies on
// persists across launches (update-screen and release-notes set their
// localStorage counter explicitly).
// A failure after the process started (no first window, no DOM) kills it
// before rethrowing; a failure inside electron.launch is already killed by
// Playwright. A stall here that the test timeout aborts is swept by the next
// closeApp (afterEach).
async function launchApp(options = {}) {
  const extraArgs = options.extraArgs || []
  const electronPath = require('electron')
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-e2e-profile-'))
  let app
  try {
    app = await electron.launch({
      executablePath: electronPath,
      args: [`--user-data-dir=${profile}`, MAIN_PATH, ...extraArgs],
    })
  } catch (err) {
    await removeProfile(profile)
    throw err
  }
  live.set(app, profile)
  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    return { app, window }
  } catch (err) {
    await closeApp(app, { timeoutMs: 1000 })
    throw err
  }
}

module.exports = { launchApp, closeApp, killTree, MAIN_PATH }
