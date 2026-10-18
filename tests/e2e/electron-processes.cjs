// Finds the installer's Electron processes: those started with this
// checkout's src/main.js. Children (renderer, GPU) carry no script path and
// die with their parent, so the main processes are the ones to count.

const { spawnSync } = require('child_process')
const { MAIN_PATH } = require('./helpers.cjs')

// Forward slashes, lowercase: command lines mix both separators and Windows is case-insensitive.
const normalize = (s) => s.replace(/\\/g, '/').toLowerCase()
const MAIN_NEEDLE = normalize(MAIN_PATH)

/** `[{ pid, ppid, commandLine }]` for every process whose command line names this checkout's src/main.js. */
function listInstallerProcesses() {
  let rows
  if (process.platform === 'win32') {
    const ps =
      "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | " +
      'Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress'
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`process listing failed: ${r.stderr || r.error}`)
    const text = r.stdout.trim()
    const parsed = text ? JSON.parse(text) : []
    rows = (Array.isArray(parsed) ? parsed : [parsed]).map((p) => ({
      pid: p.ProcessId,
      ppid: p.ParentProcessId,
      commandLine: p.CommandLine || '',
    }))
  } else {
    const r = spawnSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`process listing failed: ${r.stderr || r.error}`)
    rows = r.stdout
      .split('\n')
      .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
      .filter(Boolean)
      .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), commandLine: m[3] }))
  }
  return rows.filter((p) => normalize(p.commandLine).includes(MAIN_NEEDLE))
}

/** Pids of this checkout's installer Electron main processes. */
function installerElectronPids() {
  return listInstallerProcesses().map((p) => p.pid)
}

/**
 * True when an installer process is `launchPid` or its child. Playwright's
 * app.process().pid is a cmd.exe wrapper on Windows (the Electron main
 * process is its child) and the Electron process itself elsewhere.
 */
function isInstallerLaunch(launchPid) {
  return listInstallerProcesses().some((p) => p.pid === launchPid || p.ppid === launchPid)
}

module.exports = { installerElectronPids, isInstallerLaunch, listInstallerProcesses }
