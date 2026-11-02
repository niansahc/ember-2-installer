// Shared helpers for Electron Playwright tests
// Launches the installer in demo mode

const { _electron: electron, expect } = require('@playwright/test')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const MAIN_PATH = path.join(__dirname, '..', '..', 'src', 'main.js')

// How long closeApp waits for a graceful app.close() before killing the process tree.
const CLOSE_TIMEOUT_MS = 10000

// removeProfile retries a still-locked user-data dir every 200 ms: 75 tries, about 15 s.
const PROFILE_REMOVE_RETRIES = 75

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
  try {
    await fs.promises.rm(dir, {
      recursive: true,
      force: true,
      maxRetries: PROFILE_REMOVE_RETRIES,
      retryDelay: 200,
    })
  } catch {}
}

/**
 * Kill `pid` and its child processes (renderer, GPU, utility). Synchronous so a
 * teardown can rely on it; src/exec/run.js has an async, unexported equivalent.
 * Playwright starts the app detached off Windows, so `pid` leads its own
 * process group and `-pid` reaches the children. Killing only the leader
 * orphans them, and they keep writing into the user-data dir.
 */
function killTree(pid) {
  if (!pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {}
    }
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
  const strays = [...live]
  live.clear()
  for (const [stray] of strays) killTree(stray.process().pid)
  await Promise.all(strays.map(([, strayProfile]) => removeProfile(strayProfile)))
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

// Replace shell.openExternal in the main process so nothing really opens; the
// replacement records each URL, read back with openedExternal(app).
async function stubOpenExternal(app) {
  await app.evaluate(({ shell }) => {
    globalThis.__openedExternal = []
    shell.openExternal = async (url) => { globalThis.__openedExternal.push(url) }
  })
}

const openedExternal = (app) => app.evaluate(() => globalThis.__openedExternal)

// Welcome -> prereqs -> clone -> vault -> model selection (demo mode).
async function walkToModelScreen(window) {
  await window.locator('button[data-next="screen-prereqs"]').click()
  await expect(window.locator('#btn-prereqs-next')).toBeEnabled({ timeout: 5000 })
  await window.locator('#btn-prereqs-next').click()
  await window.locator('#btn-install-ember').click()
  await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-vault', { timeout: 10000 })
  await window.locator('button[data-next="screen-model"]').click()
  await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-model')
}

// On through the default model and vision choices to host selection.
async function walkToHostScreen(window) {
  await walkToModelScreen(window)
  await window.locator('#btn-model-next').click()
  await window.locator('button[data-next="screen-host"]').click()
  await expect(window.locator('.screen.active')).toHaveAttribute('id', 'screen-host')
}

// On to the Tailscale walkthrough's Serve step (demo Tailscale is connected).
async function openServeStep(window) {
  await walkToHostScreen(window)
  await window.locator('input[name="host"][value="tailscale"]').check()
  await expect(window.locator('#ts-step-serve')).toBeVisible({ timeout: 10000 })
}

module.exports = {
  launchApp, closeApp, killTree, MAIN_PATH,
  stubOpenExternal, openedExternal, walkToModelScreen, walkToHostScreen, openServeStep,
}
