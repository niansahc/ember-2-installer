/**
 * src/main.js
 *
 * Ember-2 Installer — Main Process
 *
 * Handles: window creation, all IPC calls from renderer, shell commands,
 * file system operations, update checks via GitHub releases API.
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const https = require('https')
const os = require('os')

// ---------------------------------------------------------------------------
// Demo mode: active when running unpackaged (npm start) WITHOUT --real flag
// ---------------------------------------------------------------------------

const IS_PACKAGED = app.isPackaged
const HAS_REAL_FLAG = process.argv.includes('--real')
const DEMO_MODE = !IS_PACKAGED && !HAS_REAL_FLAG

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

// Deferred until app is ready — getPath() is not available at require time.
let USER_DATA
let INSTALL_PATH_FILE

function initPaths() {
  USER_DATA = app.getPath('userData')
  INSTALL_PATH_FILE = path.join(USER_DATA, 'ember-install-path.txt')
}

// ---------------------------------------------------------------------------
// Repository URLs and slugs
// ---------------------------------------------------------------------------

const REPO_BACKEND_SLUG = 'niansahc/ember-2'
const REPO_UI_SLUG = 'niansahc/ember-2-ui'
const REPO_INSTALLER_SLUG = 'niansahc/ember-2-installer'
const REPO_BACKEND_URL = `https://github.com/${REPO_BACKEND_SLUG}.git`
const REPO_UI_URL = `https://github.com/${REPO_UI_SLUG}.git`

// In dev, ember-2 is a sibling folder two levels up from src/
const DEV_EMBER_PATH = path.resolve(__dirname, '..', '..', 'ember-2')

function getEmberPath() {
  if (fs.existsSync(INSTALL_PATH_FILE)) {
    return fs.readFileSync(INSTALL_PATH_FILE, 'utf-8').trim()
  }
  if (fs.existsSync(DEV_EMBER_PATH)) {
    return DEV_EMBER_PATH
  }
  return null
}

function saveEmberPath(p) {
  fs.mkdirSync(USER_DATA, { recursive: true })
  fs.writeFileSync(INSTALL_PATH_FILE, p, 'utf-8')
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 820,
    height: 700,
    resizable: true,
    center: true,
    title: 'Ember-2 Setup',
    backgroundColor: '#1a0a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  mainWindow.setMenuBarVisibility(false)
}

let autoUpdater = null

app.whenReady().then(() => {
  initPaths()
  createWindow()

  // Load electron-updater lazily — it crashes at require time in dev mode
  try {
    autoUpdater = require('electron-updater').autoUpdater
  } catch {}

  // Set up installer self-updates (only when packaged + updater available)
  if (autoUpdater) {
    autoUpdater.autoDownload = false

    autoUpdater.on('update-available', (info) => {
      if (mainWindow) {
        mainWindow.webContents.send('installer-update-available', {
          version: info.version,
          releaseNotes: info.releaseNotes || '',
        })
      }
    })

    autoUpdater.on('download-progress', (progress) => {
      if (mainWindow) {
        mainWindow.webContents.send('installer-download-progress', {
          percent: Math.round(progress.percent),
        })
      }
    })

    autoUpdater.on('update-downloaded', () => {
      if (mainWindow) {
        mainWindow.webContents.send('installer-update-downloaded')
      }
    })

    if (IS_PACKAGED) {
      autoUpdater.checkForUpdates().catch(() => {})
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ---------------------------------------------------------------------------
// Installer self-update IPC
// ---------------------------------------------------------------------------

ipcMain.handle('download-installer-update', async () => {
  if (autoUpdater) autoUpdater.downloadUpdate()
  return true
})

ipcMain.handle('install-installer-update', () => {
  if (autoUpdater) autoUpdater.quitAndInstall()
})

// ---------------------------------------------------------------------------
// IPC — Ember-2 backend update check
// ---------------------------------------------------------------------------

ipcMain.handle('check-ember-update', async () => {
  const emberPath = getEmberPath()
  if (!emberPath) return { hasUpdate: false, error: 'No ember-2 path configured' }

  // Read installed version from version.json or git tag
  let installed = null
  const vf = path.join(emberPath, 'version.json')
  if (fs.existsSync(vf)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(vf, 'utf-8'))
      installed = parsed.version || parsed.tag || null
      if (installed && !installed.startsWith('v')) installed = `v${installed}`
    } catch {}
  }

  // Fallback: try git describe
  if (!installed) {
    installed = await new Promise((resolve) => {
      const proc = spawn('git', ['describe', '--tags', '--abbrev=0'], {
        cwd: emberPath, shell: true,
      })
      let out = ''
      proc.stdout.on('data', (d) => (out += d))
      proc.on('close', (code) => resolve(code === 0 ? out.trim() : null))
      proc.on('error', () => resolve(null))
    })
  }

  // Fetch latest release
  const latest = await fetchLatestRelease()
  if (!latest || !latest.tag_name) return { hasUpdate: false, installed }

  const hasUpdate = installed && installed !== latest.tag_name
  return {
    hasUpdate,
    installed: installed || 'unknown',
    latest: latest.tag_name,
    changelog: latest.body || '',
    publishedAt: latest.published_at,
  }
})

ipcMain.handle('run-ember-update', async () => {
  const emberPath = getEmberPath()
  if (!emberPath) return { ok: false }

  // Step 0: Reset version.json — it gets modified locally and blocks git pull
  await new Promise((resolve) => {
    const proc = spawn('git', ['checkout', '--', 'version.json'], { cwd: emberPath, shell: true })
    proc.on('close', () => resolve())
    proc.on('error', () => resolve())
  })

  // Step 1: git pull origin main (explicit remote/branch avoids tracking issues)
  const pullOk = await new Promise((resolve) => {
    const proc = spawn('git', ['pull', 'origin', 'main'], { cwd: emberPath, shell: true })
    proc.stdout.on('data', (d) => {
      mainWindow.webContents.send('ember-update-log', d.toString())
    })
    proc.stderr.on('data', (d) => {
      mainWindow.webContents.send('ember-update-log', d.toString())
    })
    proc.on('close', (code) => resolve(code === 0))
    proc.on('error', () => resolve(false))
  })
  if (!pullOk) return { ok: false }

  // Step 2: pip install (in case requirements changed)
  const isWin = process.platform === 'win32'
  const pyBin = isWin
    ? path.join(emberPath, '.venv', 'Scripts', 'python.exe')
    : path.join(emberPath, '.venv', 'bin', 'python')

  const pipOk = await new Promise((resolve) => {
    const proc = spawn(pyBin, ['-m', 'pip', 'install', '-r', 'requirements.txt'], {
      cwd: emberPath, shell: true,
    })
    proc.stdout.on('data', (d) => {
      mainWindow.webContents.send('ember-update-log', d.toString())
    })
    proc.stderr.on('data', (d) => {
      mainWindow.webContents.send('ember-update-log', d.toString())
    })
    proc.on('close', (code) => resolve(code === 0))
    proc.on('error', () => resolve(false))
  })

  // Step 3: restart docker services
  const dockerOk = await new Promise((resolve) => {
    const proc = spawn('docker', ['compose', 'up', '-d', '--build'], {
      cwd: emberPath, shell: true,
    })
    proc.stdout.on('data', (d) => {
      mainWindow.webContents.send('ember-update-log', d.toString())
    })
    proc.stderr.on('data', (d) => {
      mainWindow.webContents.send('ember-update-log', d.toString())
    })
    proc.on('close', (code) => resolve(code === 0))
    proc.on('error', () => resolve(false))
  })

  // Update version.json with new tag
  const newTag = await new Promise((resolve) => {
    const proc = spawn('git', ['describe', '--tags', '--abbrev=0'], {
      cwd: emberPath, shell: true,
    })
    let out = ''
    proc.stdout.on('data', (d) => (out += d))
    proc.on('close', () => resolve(out.trim()))
    proc.on('error', () => resolve(null))
  })
  if (newTag) {
    const vf = path.join(emberPath, 'version.json')
    fs.writeFileSync(vf, JSON.stringify({ tag: newTag }, null, 2), 'utf-8')
  }

  return { ok: pullOk, pipOk, dockerOk, tag: newTag }
})

// ---------------------------------------------------------------------------
// IPC — Prerequisites
// ---------------------------------------------------------------------------

ipcMain.handle('check-prerequisites', async () => {
  const isWin = process.platform === 'win32'

  // On Mac/Linux, prefer python3; fall back to python
  let python
  if (isWin) {
    python = await probe(['python', '--version'])
  } else {
    python = await probe(['python3', '--version'])
    if (!python.ok) python = await probe(['python', '--version'])
  }

  const checks = {
    docker: await probe(['docker', '--version']),
    python,
    ollama: await probe(['ollama', '--version']),
    git: await probe(['git', '--version']),
    node: await probe(['node', '--version']),
  }

  // On Mac, check for Homebrew (soft check — not a blocker)
  if (process.platform === 'darwin') {
    checks.brew = await probe(['brew', '--version'])
  }

  return checks
})

function probe(cmd) {
  return new Promise((resolve) => {
    const [bin, ...args] = cmd
    const proc = spawn(bin, args, { shell: true })
    let out = ''
    proc.stdout.on('data', (d) => (out += d))
    proc.stderr.on('data', (d) => (out += d))
    proc.on('close', (code) => {
      resolve({ ok: code === 0, version: out.trim().split('\n')[0] })
    })
    proc.on('error', () => resolve({ ok: false, version: null }))
  })
}

// Winget package IDs for each prerequisite
const WINGET_PACKAGES = {
  git: 'Git.Git',
  python: 'Python.Python.3.12',
  node: 'OpenJS.NodeJS.LTS',
  ollama: 'Ollama.Ollama',
  docker: 'Docker.DockerDesktop',
}

ipcMain.handle('install-prerequisite', (_e, { name }) => {
  // Auto-install via winget is Windows-only
  if (process.platform !== 'win32') {
    return Promise.resolve({ ok: false, error: 'Auto-install is only available on Windows. Please install manually.' })
  }

  const packageId = WINGET_PACKAGES[name]
  if (!packageId) return Promise.resolve({ ok: false, error: `Unknown: ${name}` })

  return new Promise((resolve) => {
    const proc = spawn('winget', ['install', '--id', packageId, '--silent', '--accept-package-agreements', '--accept-source-agreements'], {
      shell: true,
    })
    proc.stdout.on('data', (d) => {
      mainWindow.webContents.send('prereq-install-progress', { name, text: d.toString() })
    })
    proc.stderr.on('data', (d) => {
      mainWindow.webContents.send('prereq-install-progress', { name, text: d.toString() })
    })
    proc.on('close', (code) => {
      // winget returns 0 on success, -1978335189 if already installed
      const ok = code === 0 || code === -1978335189
      resolve({ ok, needsRestart: name === 'docker' })
    })
    proc.on('error', (err) => resolve({ ok: false, error: err.message }))
  })
})

ipcMain.handle('check-winget', async () => {
  // winget is Windows-only
  if (process.platform !== 'win32') return { available: false }
  const result = await probe(['winget', '--version'])
  return { available: result.ok }
})

// ---------------------------------------------------------------------------
// IPC — Ember path
// ---------------------------------------------------------------------------

ipcMain.handle('get-ember-path', () => getEmberPath())

ipcMain.handle('save-ember-path', (_e, p) => {
  saveEmberPath(p)
  return true
})

ipcMain.handle('pick-ember-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select the ember-2 folder',
    properties: ['openDirectory'],
  })
  return result.canceled ? null : result.filePaths[0]
})

// ---------------------------------------------------------------------------
// IPC — Clone ember-2 repo
// ---------------------------------------------------------------------------

ipcMain.handle('clone-ember-repo', (_e, { parentDir }) => {
  return new Promise((resolve) => {
    const targetDir = path.join(parentDir, 'ember-2')
    if (fs.existsSync(targetDir)) {
      return resolve({ ok: true, path: targetDir, message: 'Already exists' })
    }
    // Create parent directory if it doesn't exist
    try {
      fs.mkdirSync(parentDir, { recursive: true })
    } catch (err) {
      return resolve({ ok: false, error: `Cannot create directory: ${err.message}` })
    }
    const proc = spawn('git', ['clone', REPO_BACKEND_URL], {
      cwd: parentDir,
      shell: true,
    })
    proc.stdout.on('data', (d) => {
      mainWindow.webContents.send('clone-progress', d.toString())
    })
    proc.stderr.on('data', (d) => {
      mainWindow.webContents.send('clone-progress', d.toString())
    })
    proc.on('close', (code) => {
      if (code === 0) {
        saveEmberPath(targetDir)
        resolve({ ok: true, path: targetDir })
      } else {
        resolve({ ok: false })
      }
    })
    proc.on('error', (err) => resolve({ ok: false, error: err.message }))
  })
})

ipcMain.handle('check-target-path', (_e, { parentDir }) => {
  const targetDir = path.join(parentDir, 'ember-2')
  if (!fs.existsSync(targetDir)) return { exists: false }
  const versionFile = path.join(targetDir, 'version.json')
  if (!fs.existsSync(versionFile)) return { exists: true, isEmber: false }
  try {
    const data = JSON.parse(fs.readFileSync(versionFile, 'utf-8'))
    return { exists: true, isEmber: true, version: data.version || data.tag || 'unknown', path: targetDir }
  } catch {
    return { exists: true, isEmber: false }
  }
})

ipcMain.handle('update-existing-ember', (_e, { emberPath }) => {
  return new Promise((resolve) => {
    const proc = spawn('git', ['pull', 'origin', 'main'], { cwd: emberPath, shell: true })
    proc.stdout.on('data', (d) => mainWindow.webContents.send('clone-progress', d.toString()))
    proc.stderr.on('data', (d) => mainWindow.webContents.send('clone-progress', d.toString()))
    proc.on('close', (code) => {
      saveEmberPath(emberPath)
      resolve({ ok: code === 0, path: emberPath })
    })
    proc.on('error', (err) => resolve({ ok: false, error: err.message }))
  })
})

ipcMain.handle('fresh-install-ember', (_e, { parentDir }) => {
  return new Promise((resolve) => {
    const targetDir = path.join(parentDir, 'ember-2')
    try {
      if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true })
    } catch (err) {
      return resolve({ ok: false, error: `Cannot remove existing directory: ${err.message}` })
    }
    const proc = spawn('git', ['clone', REPO_BACKEND_URL], {
      cwd: parentDir, shell: true,
    })
    proc.stdout.on('data', (d) => mainWindow.webContents.send('clone-progress', d.toString()))
    proc.stderr.on('data', (d) => mainWindow.webContents.send('clone-progress', d.toString()))
    proc.on('close', (code) => {
      if (code === 0) {
        saveEmberPath(targetDir)
        resolve({ ok: true, path: targetDir })
      } else {
        resolve({ ok: false })
      }
    })
    proc.on('error', (err) => resolve({ ok: false, error: err.message }))
  })
})

ipcMain.handle('get-default-install-dir', () => {
  return process.platform === 'win32' ? 'C:\\Ember-2' : path.join(os.homedir(), 'Ember-2')
})

ipcMain.handle('scan-for-ember', () => {
  // Check common locations for an existing ember-2 install
  const candidates = []
  const home = os.homedir()

  if (process.platform === 'win32') {
    candidates.push(
      'C:\\Ember-2\\ember-2',
      'D:\\Ember-2\\ember-2',
      path.join(home, 'Desktop', 'Ember-2', 'ember-2'),
      path.join(home, 'Documents', 'Ember-2', 'ember-2'),
      path.join(home, 'ember-2'),
      path.join(home, 'Desktop', 'ember-2'),
    )
  } else {
    candidates.push(
      path.join(home, 'Ember-2', 'ember-2'),
      path.join(home, 'ember-2'),
      '/opt/ember-2',
    )
  }

  // Add the sibling path (relative to installer)
  candidates.push(DEV_EMBER_PATH)

  // Add previously saved path
  if (fs.existsSync(INSTALL_PATH_FILE)) {
    const saved = fs.readFileSync(INSTALL_PATH_FILE, 'utf-8').trim()
    if (saved) candidates.push(saved)
  }

  // Check each candidate for version.json (confirms it's a real ember-2 install)
  for (const candidate of candidates) {
    try {
      const versionFile = path.join(candidate, 'version.json')
      if (fs.existsSync(versionFile)) {
        const data = JSON.parse(fs.readFileSync(versionFile, 'utf-8'))
        return {
          found: true,
          path: candidate,
          version: data.version || data.tag || 'unknown',
        }
      }
    } catch {}
  }
  return { found: false }
})

// Hardware detection
ipcMain.handle('detect-hardware', async () => {
  const totalRamGB = Math.round(os.totalmem() / (1024 ** 3))

  let gpu = 'Unknown'
  try {
    const { execSync } = require('child_process')
    if (process.platform === 'win32') {
      const out = execSync('wmic path win32_VideoController get name', { timeout: 3000 }).toString()
      const lines = out.split('\n').map((l) => l.trim()).filter((l) => l && l !== 'Name')
      gpu = lines[0] || 'Unknown'
    } else if (process.platform === 'darwin') {
      const out = execSync('system_profiler SPDisplaysDataType | grep Chipset', { timeout: 3000 }).toString()
      gpu = out.split(':')[1]?.trim() || 'Unknown'
    } else {
      const out = execSync('lspci | grep -i vga', { timeout: 3000 }).toString()
      gpu = out.split(':').pop()?.trim() || 'Unknown'
    }
  } catch {
    gpu = 'Unknown'
  }

  // Thresholds based on model memory requirements: 14B models need ~9 GB
  // VRAM/RAM so 32 GB gives comfortable headroom; 8B models need ~5 GB so
  // 12 GB is the practical floor; below that only 7B fits.
  let recommendation
  if (totalRamGB >= 32) {
    recommendation = { model: 'qwen2.5:14b', reason: `${totalRamGB} GB RAM — larger model fits comfortably` }
  } else if (totalRamGB >= 12) {
    recommendation = { model: 'qwen3:8b', reason: `${totalRamGB} GB RAM — best overall for Ember` }
  } else {
    recommendation = { model: 'mistral:7b', reason: `${totalRamGB} GB RAM — lightweight model recommended` }
  }

  return { ram: totalRamGB, gpu, recommendation }
})


// Curated model recommendations
ipcMain.handle('get-recommended-models', async () => {
  // Get installed models from Ollama
  let installed = []
  try {
    const result = await new Promise((resolve) => {
      const proc = spawn('ollama', ['list'], { shell: true })
      let out = ''
      proc.stdout.on('data', (d) => (out += d))
      proc.on('close', () => {
        const lines = out.trim().split('\n').slice(1)
        resolve(lines.map((l) => l.split(/\s+/)[0]).filter(Boolean))
      })
      proc.on('error', () => resolve([]))
    })
    installed = result
  } catch {}

  const recommended = [
    { id: 'qwen3:8b', name: 'Qwen 3 8B', desc: 'Best overall for Ember. Strongest preference expression and memory grounding. 8 GB RAM.', size: '~4.9 GB', recommended: true },
    { id: 'qwen2.5:14b', name: 'Qwen 2.5 14B', desc: 'Best self-attribution (9.0) — knows whose words are whose. Needs 16 GB RAM and is slower.', size: '~9 GB' },
    { id: 'gemma3:12b', name: 'Gemma 3 12B', desc: 'Best memory grounding among larger models. Safety-focused architecture. 12 GB RAM.', size: '~8.1 GB' },
    { id: 'phi4:14b', name: 'Phi 4 14B', desc: 'Strong reasoning but weak conversational presence. Ember sounds clinical with this model.', size: '~9.1 GB' },
    { id: 'mistral:7b', name: 'Mistral 7B', desc: 'Smallest and fastest. Only choice if you have 6-7 GB RAM. Limited but functional.', size: '~4.1 GB' },
  ]

  const visionModels = [
    { id: 'llama3.2-vision:11b', name: 'Llama 3.2 Vision 11B', desc: 'Can analyze images you share', size: '~6.4 GB', recommended: true },
    { id: 'llava:13b', name: 'LLaVA 13B', desc: 'Alternative vision model', size: '~8 GB' },
  ]

  return {
    recommended: recommended.map((m) => ({ ...m, installed: installed.includes(m.id) })),
    vision: visionModels.map((m) => ({ ...m, installed: installed.includes(m.id) })),
    installed,
  }
})

// ---------------------------------------------------------------------------
// IPC — Vault
// ---------------------------------------------------------------------------

ipcMain.handle('pick-vault-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose your Ember vault location',
    properties: ['openDirectory', 'createDirectory'],
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('create-vault', (_e, vaultPath) => {
  try {
    fs.mkdirSync(vaultPath, { recursive: true })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ---------------------------------------------------------------------------
// IPC — Ollama models
// ---------------------------------------------------------------------------

ipcMain.handle('get-ollama-models', async () => {
  return new Promise((resolve) => {
    const proc = spawn('ollama', ['list'], { shell: true })
    let out = ''
    proc.stdout.on('data', (d) => (out += d))
    proc.on('close', () => {
      const lines = out.trim().split('\n').slice(1)
      const models = lines
        .map((l) => l.split(/\s+/)[0])
        .filter(Boolean)
      resolve(models)
    })
    proc.on('error', () => resolve([]))
  })
})

ipcMain.handle('pull-ollama-model', (_e, model) => {
  return new Promise((resolve) => {
    const proc = spawn('ollama', ['pull', model], { shell: true })
    proc.stdout.on('data', (d) => {
      mainWindow.webContents.send('ollama-pull-progress', d.toString())
    })
    proc.stderr.on('data', (d) => {
      mainWindow.webContents.send('ollama-pull-progress', d.toString())
    })
    proc.on('close', (code) => resolve({ ok: code === 0 }))
    proc.on('error', (err) => resolve({ ok: false, error: err.message }))
  })
})

// ---------------------------------------------------------------------------
// IPC — Write .env
// ---------------------------------------------------------------------------

ipcMain.handle('write-env', (_e, { emberPath, vault, model, vision, host }) => {
  try {
    const vaultFwd = vault.replace(/\\/g, '/')
    const lines = [
      '# Written by Ember Setup Wizard\n',
      '\n',
      '# ── Vault ─────────────────────────────────────────────────────────\n',
      `PRIVATE_VAULT_PATH=${vaultFwd}\n`,
      '\n',
      '# ── API Host ───────────────────────────────────────────────────────\n',
      `EMBER_HOST=${host}\n`,
      '\n',
      '# ── Models ─────────────────────────────────────────────────────────\n',
      `EMBER_MODEL=${model}\n`,
    ]
    if (vision) {
      lines.push(`EMBER_VISION_MODEL=${vision}\n`)
    } else {
      lines.push('# EMBER_VISION_MODEL=  (vision disabled)\n')
    }
    const credStoreNames = {
      win32: 'Windows Credential Manager',
      darwin: 'macOS Keychain',
      linux: 'system keyring (SecretService)',
    }
    const credStore = credStoreNames[process.platform] || 'OS credential store'
    lines.push(
      '\n',
      '# ── API Key ────────────────────────────────────────────────────────\n',
      `# API key is stored in ${credStore} — not here.\n`,
      '# Run: python scripts/set_api_key.py\n',
    )
    fs.writeFileSync(path.join(emberPath, '.env'), lines.join(''), 'utf-8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ---------------------------------------------------------------------------
// IPC — Install steps (streamed)
// ---------------------------------------------------------------------------

// Each step sends progress events: install-log, install-step-done
// step: 'pip' | 'apikey' | 'docker'

ipcMain.handle('run-install-step', async (_e, { step, emberPath }) => {
  const isWin = process.platform === 'win32'
  const pyBin = isWin
    ? `"${path.join(emberPath, '.venv', 'Scripts', 'python.exe')}"`
    : path.join(emberPath, '.venv', 'bin', 'python')

  // --- API key: check first, skip if exists, run non-interactive if not ---
  if (step === 'apikey') {
    const keyExists = await new Promise((resolve) => {
      const proc = spawn(pyBin, ['scripts/set_api_key.py', '--check'], {
        cwd: emberPath, shell: true,
      })
      proc.on('close', (code) => resolve(code === 0))
      proc.on('error', () => resolve(false))
    })

    if (keyExists) {
      mainWindow.webContents.send('install-log', { step, text: 'API key already configured ✓\n' })
      mainWindow.webContents.send('install-step-done', { step, ok: true })
      return { ok: true }
    }

    // No key — generate non-interactively
    return runSpawn(pyBin, ['scripts/set_api_key.py', '--non-interactive'], emberPath, step)
  }

  // --- All other steps ---
  let cmd, args
  if (step === 'venv') {
    cmd = isWin ? 'python' : 'python3'
    args = ['-m', 'venv', '.venv']
  } else if (step === 'pip') {
    cmd = pyBin
    args = ['-m', 'pip', 'install', '-r', 'requirements.txt']
  } else if (step === 'docker') {
    // Start Docker Desktop if the daemon isn't running
    const daemonUp = await new Promise((resolve) => {
      const proc = spawn('docker', ['info'], { shell: true })
      proc.on('close', (code) => resolve(code === 0))
      proc.on('error', () => resolve(false))
    })
    if (!daemonUp) {
      mainWindow.webContents.send('install-log', { step, text: 'Docker daemon not running — starting Docker Desktop...\n' })
      if (isWin) {
        spawn('cmd', ['/c', 'start', '', 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe'], { shell: true })
      } else if (process.platform === 'darwin') {
        spawn('open', ['-a', 'Docker'], { shell: true })
      } else {
        spawn('systemctl', ['--user', 'start', 'docker-desktop'], { shell: true })
      }
      // Wait for daemon to become ready (poll every 3s, up to 60s)
      let ready = false
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 3000))
        ready = await new Promise((resolve) => {
          const proc = spawn('docker', ['info'], { shell: true })
          proc.on('close', (code) => resolve(code === 0))
          proc.on('error', () => resolve(false))
        })
        if (ready) break
        mainWindow.webContents.send('install-log', { step, text: 'Waiting for Docker daemon...\n' })
      }
      if (!ready) {
        mainWindow.webContents.send('install-log', { step, text: 'Docker daemon did not start in time. Please start Docker Desktop manually and retry.\n' })
        mainWindow.webContents.send('install-step-done', { step, ok: false })
        return { ok: false }
      }
      mainWindow.webContents.send('install-log', { step, text: 'Docker daemon ready ✓\n' })
    }
    cmd = 'docker'
    args = ['compose', 'up', '-d']
  } else if (step === 'build-ui') {
    // Clone ember-2-ui, install, build, copy to ember-2/ui/
    const uiDir = path.join(path.dirname(emberPath), 'ember-2-ui')
    const uiDistDir = path.join(uiDir, 'dist')
    const targetUiDir = path.join(emberPath, 'ui')

    // Clone if not exists
    if (!fs.existsSync(uiDir)) {
      const cloneOk = await new Promise((resolve) => {
        const proc = spawn('git', ['clone', REPO_UI_URL], {
          cwd: path.dirname(emberPath), shell: true,
        })
        proc.stdout.on('data', (d) => mainWindow.webContents.send('install-log', { step, text: d.toString() }))
        proc.stderr.on('data', (d) => mainWindow.webContents.send('install-log', { step, text: d.toString() }))
        proc.on('close', (code) => resolve(code === 0))
        proc.on('error', () => resolve(false))
      })
      if (!cloneOk) {
        mainWindow.webContents.send('install-step-done', { step, ok: false })
        return { ok: false }
      }
    }

    // npm ci
    mainWindow.webContents.send('install-log', { step, text: 'Installing UI dependencies...\n' })
    const npmOk = await new Promise((resolve) => {
      const proc = spawn('npm', ['ci'], { cwd: uiDir, shell: true })
      proc.stdout.on('data', (d) => mainWindow.webContents.send('install-log', { step, text: d.toString() }))
      proc.stderr.on('data', (d) => mainWindow.webContents.send('install-log', { step, text: d.toString() }))
      proc.on('close', (code) => resolve(code === 0))
      proc.on('error', () => resolve(false))
    })
    if (!npmOk) {
      mainWindow.webContents.send('install-step-done', { step, ok: false })
      return { ok: false }
    }

    // Retrieve API key from credential store and write UI .env so Vite can
    // bake it into the bundle.  Without this the built frontend ships with an
    // empty API key and every authenticated request to the backend fails.
    mainWindow.webContents.send('install-log', { step, text: 'Injecting API key into UI build...\n' })
    const apiKey = await new Promise((resolve) => {
      let out = ''
      const proc = spawn(pyBin, ['scripts/set_api_key.py', '--non-interactive'], {
        cwd: emberPath, shell: true,
      })
      proc.stdout.on('data', (d) => (out += d))
      proc.stderr.on('data', (d) => mainWindow.webContents.send('install-log', { step, text: d.toString() }))
      proc.on('close', () => {
        const match = out.match(/Key:\s*(.+)/)
        resolve(match ? match[1].trim() : null)
      })
      proc.on('error', () => resolve(null))
    })
    if (apiKey) {
      const uiEnvPath = path.join(uiDir, '.env')
      fs.writeFileSync(uiEnvPath, `VITE_EMBER_API_URL=/v1\nVITE_EMBER_API_KEY=${apiKey}\n`, 'utf-8')
      mainWindow.webContents.send('install-log', { step, text: 'API key written to UI .env ✓\n' })
    } else {
      mainWindow.webContents.send('install-log', { step, text: 'Warning: could not retrieve API key — UI will build without auth\n' })
    }

    // npm run build
    mainWindow.webContents.send('install-log', { step, text: 'Building Ember UI...\n' })
    const buildOk = await new Promise((resolve) => {
      const proc = spawn('npm', ['run', 'build'], { cwd: uiDir, shell: true })
      proc.stdout.on('data', (d) => mainWindow.webContents.send('install-log', { step, text: d.toString() }))
      proc.stderr.on('data', (d) => mainWindow.webContents.send('install-log', { step, text: d.toString() }))
      proc.on('close', (code) => resolve(code === 0))
      proc.on('error', () => resolve(false))
    })
    if (!buildOk) {
      mainWindow.webContents.send('install-step-done', { step, ok: false })
      return { ok: false }
    }

    // Copy dist/ to ember-2/ui/
    try {
      if (fs.existsSync(targetUiDir)) {
        fs.rmSync(targetUiDir, { recursive: true })
      }
      fs.cpSync(uiDistDir, targetUiDir, { recursive: true })
      mainWindow.webContents.send('install-log', { step, text: 'UI installed ✓\n' })
    } catch (err) {
      mainWindow.webContents.send('install-log', { step, text: `Failed to copy UI: ${err.message}\n` })
      mainWindow.webContents.send('install-step-done', { step, ok: false })
      return { ok: false }
    }

    mainWindow.webContents.send('install-step-done', { step, ok: true })
    return { ok: true }
  }

  // venv, pip, docker all set cmd/args above — run via shared helper
  if (!cmd) return { ok: false, error: `Unknown step: ${step}` }
  return runSpawn(cmd, args, emberPath, step)
})

function runSpawn(cmd, args, cwd, step) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, shell: true })

    proc.stdout.on('data', (d) => {
      mainWindow.webContents.send('install-log', { step, text: d.toString() })
    })
    proc.stderr.on('data', (d) => {
      mainWindow.webContents.send('install-log', { step, text: d.toString() })
    })
    proc.on('close', (code) => {
      const ok = code === 0
      mainWindow.webContents.send('install-step-done', { step, ok })
      resolve({ ok })
    })
    proc.on('error', (err) => {
      mainWindow.webContents.send('install-step-done', { step, ok: false })
      resolve({ ok: false, error: err.message })
    })
  })
}

// ---------------------------------------------------------------------------
// IPC — Update check
// ---------------------------------------------------------------------------

ipcMain.handle('check-for-update', async () => {
  const emberPath = getEmberPath()
  if (!emberPath) return { hasUpdate: false }

  // Read installed version
  let installed = null
  const vf = path.join(emberPath, 'version.json')
  if (fs.existsSync(vf)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(vf, 'utf-8'))
      installed = parsed.version || parsed.tag || null
      if (installed && !installed.startsWith('v')) installed = `v${installed}`
    } catch {}
  }

  // Fetch latest release from GitHub
  const latest = await fetchLatestRelease(REPO_BACKEND_SLUG)
  if (!latest) return { hasUpdate: false }

  const hasUpdate = installed && installed !== latest.tag_name
  return {
    hasUpdate,
    installedTag: installed,
    latestTag: latest.tag_name,
    changelog: latest.body || '',
    publishedAt: latest.published_at,
  }
})

function fetchLatestRelease(repo = REPO_BACKEND_SLUG) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${repo}/releases/latest`,
      headers: { 'User-Agent': 'ember-2-installer' },
    }
    https.get(options, (res) => {
      let data = ''
      res.on('data', (d) => (data += d))
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch {
          resolve(null)
        }
      })
    }).on('error', () => resolve(null))
  })
}

// ---------------------------------------------------------------------------
// IPC — Unified update checker (all three repos)
// ---------------------------------------------------------------------------

function fetchLatestReleaseWithTimeout(repo, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs)
    fetchLatestRelease(repo).then((result) => {
      clearTimeout(timer)
      resolve(result)
    }).catch(() => {
      clearTimeout(timer)
      resolve(null)
    })
  })
}

ipcMain.handle('check-all-updates', async (_e, { host }) => {
  const emberPath = getEmberPath()
  const uiDir = emberPath ? path.join(path.dirname(emberPath), 'ember-2-ui') : null

  // Run all checks in parallel with 4-second timeout each
  const [installerRelease, backendRelease, uiRelease, healthData] = await Promise.all([
    fetchLatestReleaseWithTimeout(REPO_INSTALLER_SLUG),
    fetchLatestReleaseWithTimeout(REPO_BACKEND_SLUG),
    fetchLatestReleaseWithTimeout(REPO_UI_SLUG),
    // Get backend version from running API, not version.json
    new Promise((resolve) => {
      const targetHost = host || '127.0.0.1'
      const http = require('http')
      const req = http.get(`http://${targetHost}:8000/api/health`, { timeout: 3000 }, (res) => {
        let data = ''
        res.on('data', (d) => (data += d))
        res.on('end', () => {
          try { resolve(JSON.parse(data)) } catch { resolve(null) }
        })
      })
      req.on('error', () => resolve(null))
      req.on('timeout', () => { req.destroy(); resolve(null) })
    }),
  ])

  // Installer version
  const installerInstalled = app.getVersion()
  const installerLatest = installerRelease?.tag_name?.replace(/^v/, '') || null

  // Backend version: prefer running API, fall back to version.json on disk.
  // If neither is available, we can't verify — flag as needing update.
  let backendInstalled = healthData?.version || null
  const backendApiRunning = !!healthData
  if (!backendInstalled && emberPath) {
    try {
      const vf = path.join(emberPath, 'version.json')
      if (fs.existsSync(vf)) {
        const parsed = JSON.parse(fs.readFileSync(vf, 'utf-8'))
        backendInstalled = parsed.version || parsed.tag || null
        if (backendInstalled && !backendInstalled.startsWith('v')) backendInstalled = `v${backendInstalled}`
      }
    } catch {}
  }
  const backendLatest = backendRelease?.tag_name || null

  // UI version from local package.json
  let uiInstalled = null
  if (uiDir) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(uiDir, 'package.json'), 'utf-8'))
      uiInstalled = pkg.version || null
    } catch {}
  }
  const uiLatest = uiRelease?.tag_name?.replace(/^v/, '') || null

  return {
    reachable: !!(installerRelease || backendRelease || uiRelease),
    installer: {
      hasUpdate: installerLatest && installerInstalled !== installerLatest,
      installed: installerInstalled,
      latest: installerLatest,
    },
    backend: {
      hasUpdate: backendLatest && (!backendInstalled || backendInstalled !== backendLatest),
      installed: backendInstalled || 'unknown',
      latest: backendLatest,
      apiRunning: backendApiRunning,
    },
    ui: {
      hasUpdate: uiLatest && (!uiInstalled || uiInstalled !== uiLatest),
      installed: uiInstalled || 'unknown',
      latest: uiLatest,
    },
  }
})

ipcMain.handle('run-all-updates', async (_e, { updates, host }) => {
  const emberPath = getEmberPath()
  if (!emberPath) return { ok: false, error: 'No ember-2 path configured' }

  const isWin = process.platform === 'win32'
  const pyBin = isWin
    ? `"${path.join(emberPath, '.venv', 'Scripts', 'python.exe')}"`
    : path.join(emberPath, '.venv', 'bin', 'python')
  const uiDir = path.join(path.dirname(emberPath), 'ember-2-ui')
  const log = (text) => mainWindow.webContents.send('update-all-log', text)

  // 1. Backend update
  if (updates.backend) {
    log('Updating Ember backend...\n')
    // Reset version.json before pull — it gets modified locally by the
    // installer/API and causes "Your local changes would be overwritten"
    await new Promise((resolve) => {
      const proc = spawn('git', ['checkout', '--', 'version.json'], { cwd: emberPath, shell: true })
      proc.on('close', () => resolve())
      proc.on('error', () => resolve())
    })
    const pullOk = await new Promise((resolve) => {
      const proc = spawn('git', ['pull', 'origin', 'main'], { cwd: emberPath, shell: true })
      proc.stdout.on('data', (d) => log(d.toString()))
      proc.stderr.on('data', (d) => log(d.toString()))
      proc.on('close', (code) => resolve(code === 0))
      proc.on('error', () => resolve(false))
    })
    if (!pullOk) { log('Backend update failed.\n'); return { ok: false, stage: 'backend-pull' } }

    log('Installing Python dependencies...\n')
    const pipOk = await new Promise((resolve) => {
      const proc = spawn(pyBin, ['-m', 'pip', 'install', '-r', 'requirements.txt'], {
        cwd: emberPath, shell: true,
      })
      proc.stdout.on('data', (d) => log(d.toString()))
      proc.stderr.on('data', (d) => log(d.toString()))
      proc.on('close', (code) => resolve(code === 0))
      proc.on('error', () => resolve(false))
    })
    if (!pipOk) log('Warning: pip install had issues, continuing...\n')

    // Verify the pull landed the expected version
    let pulledVersion = null
    try {
      const vf = path.join(emberPath, 'version.json')
      if (fs.existsSync(vf)) {
        const parsed = JSON.parse(fs.readFileSync(vf, 'utf-8'))
        pulledVersion = parsed.version || parsed.tag || null
        log(`Pulled version: ${pulledVersion}\n`)
      }
    } catch {}

    log('Restarting Docker services...\n')
    await new Promise((resolve) => {
      const proc = spawn('docker', ['compose', 'up', '-d', '--build'], {
        cwd: emberPath, shell: true,
      })
      proc.stdout.on('data', (d) => log(d.toString()))
      proc.stderr.on('data', (d) => log(d.toString()))
      proc.on('close', () => resolve())
      proc.on('error', () => resolve())
    })

    // Kill the old API process so the new code loads on restart
    log('Stopping old API process...\n')
    if (isWin) {
      await new Promise((resolve) => {
        const proc = spawn('taskkill', ['/F', '/FI', 'WINDOWTITLE eq start_api*'], { shell: true })
        proc.on('close', () => resolve())
        proc.on('error', () => resolve())
      })
      // Also kill any uvicorn on port 8000
      await new Promise((resolve) => {
        const proc = spawn('cmd', ['/c', 'for /f "tokens=5" %a in (\'netstat -aon ^| findstr :8000 ^| findstr LISTENING\') do taskkill /F /PID %a'], { shell: true })
        proc.on('close', () => resolve())
        proc.on('error', () => resolve())
      })
    } else {
      await new Promise((resolve) => {
        const proc = spawn('pkill', ['-f', 'uvicorn.*src.api.main'], { shell: true })
        proc.on('close', () => resolve())
        proc.on('error', () => resolve())
      })
    }

    // Wait a moment for the port to free up
    await new Promise((r) => setTimeout(r, 2000))

    // Restart the API
    log('Starting updated API...\n')
    if (isWin) {
      const apiProc = spawn('cmd', ['/c', 'start_api.bat'], {
        cwd: emberPath, shell: true, detached: true, stdio: 'ignore',
      })
      apiProc.unref()
    } else {
      const pyBinPath = path.join(emberPath, '.venv', 'bin', 'python')
      const apiProc = spawn(pyBinPath, ['-m', 'uvicorn', 'src.api.main:app', '--host', '127.0.0.1', '--port', '8000'], {
        cwd: emberPath, detached: true, stdio: 'ignore',
      })
      apiProc.unref()
    }

    // Poll health and verify version matches what was pulled
    log('Waiting for API to start...\n')
    const http = require('http')
    const targetHost = host || '127.0.0.1'
    let apiReady = false
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 3000))
      const healthOk = await new Promise((resolve) => {
        const req = http.get(`http://${targetHost}:8000/api/health`, { timeout: 3000 }, (res) => {
          let data = ''
          res.on('data', (d) => (data += d))
          res.on('end', () => {
            try {
              const health = JSON.parse(data)
              resolve(health)
            } catch { resolve(null) }
          })
        })
        req.on('error', () => resolve(null))
        req.on('timeout', () => { req.destroy(); resolve(null) })
      })
      if (healthOk) {
        const runningVersion = healthOk.version || 'unknown'
        log(`API running: ${runningVersion}\n`)
        if (pulledVersion && runningVersion !== pulledVersion && runningVersion !== `v${pulledVersion}`) {
          log(`Warning: expected ${pulledVersion} but API reports ${runningVersion}\n`)
        }
        apiReady = true
        break
      }
      log(`Waiting... (${(i + 1) * 3}s)\n`)
    }
    if (!apiReady) {
      log('Warning: API did not start within 60 seconds. You may need to start it manually.\n')
    }
    log('Backend updated ✓\n\n')
  }

  // 1b. Ensure embedding model is installed (required since v0.13.0).
  // Runs unconditionally — not gated on updates.backend — because older
  // installs may be missing nomic-embed-text and retrieval will silently
  // fail without it.
  log('Checking embedding model...\n')
  const ollamaModels = await new Promise((resolve) => {
    const proc = spawn('ollama', ['list'], { shell: true })
    let out = ''
    proc.stdout.on('data', (d) => (out += d))
    proc.on('close', () => resolve(out))
    proc.on('error', () => resolve(''))
  })
  if (!ollamaModels.includes('nomic-embed-text')) {
    log('Pulling embedding model (nomic-embed-text)...\n')
    const pullOk = await new Promise((resolve) => {
      const proc = spawn('ollama', ['pull', 'nomic-embed-text'], { shell: true })
      proc.stdout.on('data', (d) => log(d.toString()))
      proc.stderr.on('data', (d) => log(d.toString()))
      proc.on('close', (code) => resolve(code === 0))
      proc.on('error', () => resolve(false))
    })
    if (pullOk) {
      // Verify installation
      const verify = await new Promise((resolve) => {
        const proc = spawn('ollama', ['list'], { shell: true })
        let out = ''
        proc.stdout.on('data', (d) => (out += d))
        proc.on('close', () => resolve(out.includes('nomic-embed-text')))
        proc.on('error', () => resolve(false))
      })
      log(verify ? 'Embedding model installed ✓\n' : 'Warning: embedding model pull completed but not found.\n')
    } else {
      log('Warning: failed to pull embedding model. Embeddings may not work.\n')
    }
  } else {
    log('Embedding model already installed ✓\n')
  }
  log('\n')

  // 2. UI update
  if (updates.ui) {
    log('Updating Ember UI...\n')
    if (!fs.existsSync(uiDir)) {
      log('Cloning ember-2-ui...\n')
      const cloneOk = await new Promise((resolve) => {
        const proc = spawn('git', ['clone', REPO_UI_URL], {
          cwd: path.dirname(emberPath), shell: true,
        })
        proc.stdout.on('data', (d) => log(d.toString()))
        proc.stderr.on('data', (d) => log(d.toString()))
        proc.on('close', (code) => resolve(code === 0))
        proc.on('error', () => resolve(false))
      })
      if (!cloneOk) { log('UI clone failed.\n'); return { ok: false, stage: 'ui-clone' } }
    } else {
      const pullOk = await new Promise((resolve) => {
        const proc = spawn('git', ['pull', 'origin', 'main'], { cwd: uiDir, shell: true })
        proc.stdout.on('data', (d) => log(d.toString()))
        proc.stderr.on('data', (d) => log(d.toString()))
        proc.on('close', (code) => resolve(code === 0))
        proc.on('error', () => resolve(false))
      })
      if (!pullOk) { log('UI pull failed.\n'); return { ok: false, stage: 'ui-pull' } }
    }

    log('Installing UI dependencies...\n')
    const npmOk = await new Promise((resolve) => {
      const proc = spawn('npm', ['ci'], { cwd: uiDir, shell: true })
      proc.stdout.on('data', (d) => log(d.toString()))
      proc.stderr.on('data', (d) => log(d.toString()))
      proc.on('close', (code) => resolve(code === 0))
      proc.on('error', () => resolve(false))
    })
    if (!npmOk) { log('npm ci failed.\n'); return { ok: false, stage: 'ui-npm' } }

    // Inject API key before building
    log('Injecting API key...\n')
    const apiKey = await new Promise((resolve) => {
      let out = ''
      const proc = spawn(pyBin, ['scripts/set_api_key.py', '--non-interactive'], {
        cwd: emberPath, shell: true,
      })
      proc.stdout.on('data', (d) => (out += d))
      proc.on('close', () => {
        const match = out.match(/Key:\s*(.+)/)
        resolve(match ? match[1].trim() : null)
      })
      proc.on('error', () => resolve(null))
    })
    if (apiKey) {
      fs.writeFileSync(path.join(uiDir, '.env'), `VITE_EMBER_API_URL=/v1\nVITE_EMBER_API_KEY=${apiKey}\n`, 'utf-8')
    }

    log('Building UI...\n')
    const buildOk = await new Promise((resolve) => {
      const proc = spawn('npm', ['run', 'build'], { cwd: uiDir, shell: true })
      proc.stdout.on('data', (d) => log(d.toString()))
      proc.stderr.on('data', (d) => log(d.toString()))
      proc.on('close', (code) => resolve(code === 0))
      proc.on('error', () => resolve(false))
    })
    if (!buildOk) { log('UI build failed.\n'); return { ok: false, stage: 'ui-build' } }

    // Copy dist to ember-2/ui/
    const targetUiDir = path.join(emberPath, 'ui')
    try {
      if (fs.existsSync(targetUiDir)) fs.rmSync(targetUiDir, { recursive: true })
      fs.cpSync(path.join(uiDir, 'dist'), targetUiDir, { recursive: true })
      log('UI updated ✓\n\n')
    } catch (err) {
      log(`Failed to copy UI: ${err.message}\n`)
      return { ok: false, stage: 'ui-copy' }
    }
  }

  // 3. Installer update — handled separately via electron-updater (quit-and-install)
  // The renderer will trigger this after backend/UI updates complete.

  return { ok: true, needsInstallerUpdate: !!updates.installer }
})

ipcMain.handle('run-git-pull', async (_e) => {
  const emberPath = getEmberPath()
  if (!emberPath) return { ok: false }

  const log = (text) => mainWindow.webContents.send('install-log', { step: 'update', text })

  // Reset version.json before pull — modified locally, blocks git pull
  await new Promise((resolve) => {
    const proc = spawn('git', ['checkout', '--', 'version.json'], { cwd: emberPath, shell: true })
    proc.on('close', () => resolve())
    proc.on('error', () => resolve())
  })

  // Step 1: Pull ember-2
  log('Pulling ember-2...\n')
  const pullOk = await new Promise((resolve) => {
    const proc = spawn('git', ['pull', 'origin', 'main'], { cwd: emberPath, shell: true })
    proc.stdout.on('data', (d) => log(d.toString()))
    proc.stderr.on('data', (d) => log(d.toString()))
    proc.on('close', (code) => resolve(code === 0))
    proc.on('error', () => resolve(false))
  })
  if (!pullOk) return { ok: false }

  // Step 2: Pull and rebuild ember-2-ui
  const uiDir = path.join(path.dirname(emberPath), 'ember-2-ui')
  const targetUiDir = path.join(emberPath, 'ui')

  if (!fs.existsSync(uiDir)) {
    log('Cloning ember-2-ui...\n')
    const cloneOk = await new Promise((resolve) => {
      const proc = spawn('git', ['clone', REPO_UI_URL], {
        cwd: path.dirname(emberPath), shell: true,
      })
      proc.stdout.on('data', (d) => log(d.toString()))
      proc.stderr.on('data', (d) => log(d.toString()))
      proc.on('close', (code) => resolve(code === 0))
      proc.on('error', () => resolve(false))
    })
    if (!cloneOk) { log('Failed to clone ember-2-ui.\n'); return { ok: false } }
  } else {
    log('Pulling ember-2-ui...\n')
    const uiPullOk = await new Promise((resolve) => {
      const proc = spawn('git', ['pull', 'origin', 'main'], { cwd: uiDir, shell: true })
      proc.stdout.on('data', (d) => log(d.toString()))
      proc.stderr.on('data', (d) => log(d.toString()))
      proc.on('close', (code) => resolve(code === 0))
      proc.on('error', () => resolve(false))
    })
    if (!uiPullOk) { log('Failed to pull ember-2-ui.\n'); return { ok: false } }
  }

  log('Installing UI dependencies...\n')
  const npmOk = await new Promise((resolve) => {
    const proc = spawn('npm', ['ci'], { cwd: uiDir, shell: true })
    proc.stdout.on('data', (d) => log(d.toString()))
    proc.stderr.on('data', (d) => log(d.toString()))
    proc.on('close', (code) => resolve(code === 0))
    proc.on('error', () => resolve(false))
  })
  if (!npmOk) { log('npm ci failed.\n'); return { ok: false } }

  log('Building Ember UI...\n')
  const buildOk = await new Promise((resolve) => {
    const proc = spawn('npm', ['run', 'build'], { cwd: uiDir, shell: true })
    proc.stdout.on('data', (d) => log(d.toString()))
    proc.stderr.on('data', (d) => log(d.toString()))
    proc.on('close', (code) => resolve(code === 0))
    proc.on('error', () => resolve(false))
  })
  if (!buildOk) { log('UI build failed.\n'); return { ok: false } }

  try {
    if (fs.existsSync(targetUiDir)) fs.rmSync(targetUiDir, { recursive: true })
    fs.cpSync(path.join(uiDir, 'dist'), targetUiDir, { recursive: true })
    log('UI updated.\n')
  } catch (err) {
    log(`Failed to copy UI: ${err.message}\n`)
    return { ok: false }
  }

  return { ok: true }
})

// ---------------------------------------------------------------------------
// IPC — UI built check
// ---------------------------------------------------------------------------

ipcMain.handle('check-ui-built', () => {
  const emberPath = getEmberPath()
  if (!emberPath) return { ok: false }
  const indexPath = path.join(emberPath, 'ui', 'index.html')
  return { ok: fs.existsSync(indexPath) }
})

// ---------------------------------------------------------------------------
// IPC — Docker daemon check
// ---------------------------------------------------------------------------

ipcMain.handle('check-docker-daemon', () => {
  return new Promise((resolve) => {
    const proc = spawn('docker', ['info'], { shell: true })
    proc.on('close', (code) => resolve({ ok: code === 0 }))
    proc.on('error', () => resolve({ ok: false }))
  })
})

// ---------------------------------------------------------------------------
// IPC — Start API + health check
// ---------------------------------------------------------------------------

ipcMain.handle('start-api', (_e, { emberPath }) => {
  const isWin = process.platform === 'win32'
  let proc

  if (isWin) {
    // Spawn start_api.bat detached so it survives the installer closing
    proc = spawn('cmd', ['/c', 'start_api.bat'], {
      cwd: emberPath,
      shell: true,
      detached: true,
      stdio: 'ignore',
    })
  } else {
    const pyBin = path.join(emberPath, '.venv', 'bin', 'python')
    proc = spawn(pyBin, ['-m', 'uvicorn', 'src.api.main:app', '--host', '127.0.0.1', '--port', '8000'], {
      cwd: emberPath,
      detached: true,
      stdio: 'ignore',
    })
  }

  // Unref so the installer can close without killing the API
  proc.unref()
  return { ok: true }
})

ipcMain.handle('check-api-health', (_e, { host }) => {
  const targetHost = host || '127.0.0.1'
  const http = require('http')
  return new Promise((resolve) => {
    const req = http.get(`http://${targetHost}:8000/api/health`, { timeout: 3000 }, (res) => {
      resolve({ ok: res.statusCode === 200 })
    })
    req.on('error', () => resolve({ ok: false }))
    req.on('timeout', () => { req.destroy(); resolve({ ok: false }) })
  })
})

// ---------------------------------------------------------------------------
// IPC — Venv lock check
// ---------------------------------------------------------------------------

ipcMain.handle('check-venv-lock', (_e, { emberPath }) => {
  if (!emberPath) return { locked: false }

  const isWin = process.platform === 'win32'
  const pythonExe = isWin
    ? path.join(emberPath, '.venv', 'Scripts', 'python.exe')
    : path.join(emberPath, '.venv', 'bin', 'python')

  // If .venv doesn't exist yet, no lock possible
  if (!fs.existsSync(pythonExe)) return { locked: false }

  // On Windows, try to rename the file to itself — locked files throw EPERM/EBUSY
  try {
    fs.renameSync(pythonExe, pythonExe)
    return { locked: false }
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EBUSY') {
      return {
        locked: true,
        message: "Ember's API appears to be running. Please stop it before continuing:\n\n" +
          "1. Find the terminal running start_api.bat\n" +
          "2. Press Ctrl+C to stop it\n" +
          "3. Close any other terminals with (.venv) in the prompt\n" +
          "4. Then click Retry",
      }
    }
    // Some other error — don't block, let it fail naturally
    return { locked: false }
  }
})

// ---------------------------------------------------------------------------
// IPC — Misc
// ---------------------------------------------------------------------------


ipcMain.handle('launch-ember', (_e, { emberPath }) => {
  const isWin = process.platform === 'win32'
  const scriptName = isWin ? 'launch_ember.bat' : 'launch_ember.sh'
  const scriptPath = path.join(emberPath, scriptName)

  if (!fs.existsSync(scriptPath)) {
    return { ok: false, error: `Launcher script not found: ${scriptPath}` }
  }

  let proc
  if (isWin) {
    proc = spawn('cmd', ['/c', 'start', '""', scriptPath], {
      cwd: emberPath,
      shell: true,
      detached: true,
      stdio: 'ignore',
    })
  } else {
    proc = spawn('bash', [scriptPath], {
      cwd: emberPath,
      detached: true,
      stdio: 'ignore',
    })
  }

  proc.unref()
  return { ok: true }
})

ipcMain.handle('open-url', (_e, url) => {
  shell.openExternal(url)
})

ipcMain.handle('get-default-vault', () => {
  return process.platform === 'win32'
    ? 'C:\\EmberVault'
    : path.join(os.homedir(), 'EmberVault')
})

ipcMain.handle('get-default-ollama-models', () => {
  // Ollama uses ~/.ollama/models on all platforms
  const envPath = process.env.OLLAMA_MODELS
  if (envPath) return envPath
  return path.join(os.homedir(), '.ollama', 'models')
})

ipcMain.handle('set-ollama-models-path', (_e, modelsPath) => {
  if (process.platform === 'win32') {
    // Set OLLAMA_MODELS environment variable system-wide via setx
    return new Promise((resolve) => {
      const proc = spawn('setx', ['OLLAMA_MODELS', modelsPath], { shell: true })
      proc.on('close', (code) => resolve({ ok: code === 0 }))
      proc.on('error', () => resolve({ ok: false }))
    })
  }

  // Mac/Linux: write to shell profile
  const profilePath = process.platform === 'darwin'
    ? path.join(os.homedir(), '.zprofile')
    : path.join(os.homedir(), '.profile')
  const exportLine = `export OLLAMA_MODELS="${modelsPath}"`

  try {
    const existing = fs.existsSync(profilePath) ? fs.readFileSync(profilePath, 'utf-8') : ''
    if (existing.includes('OLLAMA_MODELS=')) {
      // Replace existing line
      const updated = existing.replace(/^export OLLAMA_MODELS=.*$/m, exportLine)
      fs.writeFileSync(profilePath, updated, 'utf-8')
    } else {
      fs.appendFileSync(profilePath, `\n${exportLine}\n`, 'utf-8')
    }
    return Promise.resolve({ ok: true })
  } catch (err) {
    return Promise.resolve({ ok: false, error: err.message })
  }
})

ipcMain.handle('get-platform', () => process.platform)

ipcMain.handle('restart-computer', () => {
  if (process.platform === 'win32') {
    spawn('shutdown', ['/r', '/t', '30', '/c', 'Restarting for Docker Desktop setup. Run Ember Setup again after restart.'], { shell: true })
  } else {
    // Mac/Linux: schedule a reboot in 1 minute
    spawn('sudo', ['shutdown', '-r', '+1', 'Restarting for Docker setup. Run Ember Setup again after restart.'], { shell: true })
  }
})

ipcMain.handle('get-demo-mode', () => DEMO_MODE)

// ---------------------------------------------------------------------------
// IPC — Tailscale
// ---------------------------------------------------------------------------

ipcMain.handle('check-tailscale-installed', async () => {
  return probe(['tailscale', '--version'])
})

ipcMain.handle('check-tailscale-status', async () => {
  return new Promise((resolve) => {
    const proc = spawn('tailscale', ['status', '--json'], { shell: true })
    let out = ''
    proc.stdout.on('data', (d) => (out += d))
    proc.stderr.on('data', (d) => (out += d))
    proc.on('close', (code) => {
      if (code !== 0) return resolve({ ok: false })
      try {
        const status = JSON.parse(out)
        resolve({ ok: true, hostname: status.Self?.HostName || null })
      } catch {
        resolve({ ok: true, hostname: null })
      }
    })
    proc.on('error', () => resolve({ ok: false }))
  })
})

ipcMain.handle('get-tailscale-ip', async () => {
  return new Promise((resolve) => {
    const proc = spawn('tailscale', ['ip', '-4'], { shell: true })
    let out = ''
    proc.stdout.on('data', (d) => (out += d))
    proc.on('close', (code) => {
      const ip = out.trim()
      resolve(code === 0 && ip ? { ok: true, ip } : { ok: false })
    })
    proc.on('error', () => resolve({ ok: false }))
  })
})

ipcMain.handle('run-tailscale-serve', async () => {
  // Always proxy to localhost — Tailscale handles external routing itself.
  // The API binds to 127.0.0.1 and Tailscale serve forwards traffic to it.
  return new Promise((resolve) => {
    const proc = spawn('tailscale', ['serve', '--bg', '--https=443', 'http://127.0.0.1:8000'], { shell: true })
    let out = ''
    proc.stdout.on('data', (d) => (out += d))
    proc.stderr.on('data', (d) => (out += d))
    proc.on('close', (code) => resolve({ ok: code === 0, output: out.trim() }))
    proc.on('error', (err) => resolve({ ok: false, output: err.message }))
  })
})

ipcMain.handle('get-tailscale-dns', async () => {
  return new Promise((resolve) => {
    const proc = spawn('tailscale', ['status', '--json'], { shell: true })
    let out = ''
    proc.stdout.on('data', (d) => (out += d))
    proc.on('close', (code) => {
      if (code !== 0) return resolve(null)
      try {
        const status = JSON.parse(out)
        const dns = status.Self?.DNSName
        // DNSName ends with a trailing dot, strip it
        resolve(dns ? dns.replace(/\.$/, '') : null)
      } catch {
        resolve(null)
      }
    })
    proc.on('error', () => resolve(null))
  })
})

// ---------------------------------------------------------------------------
// Demo mode overrides
//
// When running unpackaged without --real, every IPC handler that touches
// real infrastructure (git, pip, docker, ollama, tailscale, filesystem)
// is replaced with a fake that returns realistic data after a short delay.
// This allows the full UI to be exercised in e2e tests and during
// development without requiring any real tooling to be installed.
// ---------------------------------------------------------------------------

if (DEMO_MODE) {
  console.log('[DEMO MODE] Running with simulated install steps')

  // Override UI built check
  ipcMain.removeHandler('check-ui-built')
  ipcMain.handle('check-ui-built', async () => ({ ok: true }))

  // Override hardware detection
  ipcMain.removeHandler('detect-hardware')
  ipcMain.handle('detect-hardware', async () => ({
    ram: 32,
    gpu: 'NVIDIA RTX 4090 (demo)',
    recommendation: { model: 'qwen3:8b', reason: '32 GB RAM — best overall for Ember (demo)' },
  }))

  // Override prerequisites — all pass
  ipcMain.removeHandler('check-prerequisites')
  ipcMain.handle('check-prerequisites', async () => ({
    docker: { ok: true, version: 'Docker version 27.5.1 (demo)' },
    python: { ok: true, version: 'Python 3.12.0 (demo)' },
    ollama: { ok: true, version: 'ollama version 0.6.2 (demo)' },
    git: { ok: true, version: 'git version 2.47.0 (demo)' },
    node: { ok: true, version: 'v24.14.0 (demo)' },
  }))

  // Override winget check
  ipcMain.removeHandler('check-winget')
  ipcMain.handle('check-winget', async () => ({ available: true }))

  // Override prerequisite install
  ipcMain.removeHandler('install-prerequisite')
  ipcMain.handle('install-prerequisite', async (_e, { name }) => {
    await sleep(1500)
    mainWindow.webContents.send('prereq-install-progress', { name, text: `Installing ${name}... done (demo)\n` })
    return { ok: true, needsRestart: name === 'docker' }
  })

  // Override ollama models — return fake list
  ipcMain.removeHandler('get-ollama-models')
  ipcMain.handle('get-ollama-models', async () => [
    'qwen2.5:14b',
    'llama3.2:3b',
    'llama3.2-vision:11b',
    'mistral:7b',
    'nomic-embed-text:latest',
  ])

  // Override pull — simulate progress
  ipcMain.removeHandler('pull-ollama-model')
  ipcMain.handle('pull-ollama-model', async (_e, model) => {
    const msgs = [
      `pulling manifest for ${model}\n`,
      'pulling abc123... 100%\n',
      'verifying sha256 digest\n',
      `success\n`,
    ]
    for (const msg of msgs) {
      mainWindow.webContents.send('ollama-pull-progress', msg)
      await sleep(400)
    }
    return { ok: true }
  })

  // Override write-env — just pretend
  ipcMain.removeHandler('write-env')
  ipcMain.handle('write-env', async () => {
    await sleep(300)
    return { ok: true }
  })

  // Override create-vault — just pretend
  ipcMain.removeHandler('create-vault')
  ipcMain.handle('create-vault', async () => {
    await sleep(200)
    return { ok: true }
  })

  // Override install steps — simulate with delays and fake log output
  ipcMain.removeHandler('run-install-step')
  ipcMain.handle('run-install-step', async (_e, { step }) => {
    const simulations = {
      venv: {
        delay: 1500,
        logs: ['Creating virtual environment...\n', 'Done.\n'],
      },
      pip: {
        delay: 4000,
        logs: [
          'Collecting fastapi\n',
          '  Downloading fastapi-0.115.0.tar.gz\n',
          'Collecting sentence-transformers\n',
          '  Downloading sentence_transformers-3.4.1.tar.gz (200 kB)\n',
          'Collecting torch\n',
          '  Downloading torch-2.6.0 (demo, skipping real download)\n',
          'Installing collected packages: ...\n',
          'Successfully installed 42 packages\n',
        ],
      },
      apikey: {
        delay: 1000,
        logs: [
          'Generating API key...\n',
          'API key stored in Credential Manager.\n',
          'Key: ember_demo_xxxxxxxxxxxx\n',
        ],
      },
      'build-ui': {
        delay: 3000,
        logs: [
          'Cloning ember-2-ui...\n',
          'Installing UI dependencies...\n',
          'Building Ember UI...\n',
          'vite v6.4.1 building for production...\n',
          '✓ 306 modules transformed.\n',
          'UI installed ✓\n',
        ],
      },
      docker: {
        delay: 1500,
        logs: [
          'Creating ember-searxng ... done\n',
        ],
      },
    }

    const sim = simulations[step]
    if (!sim) return { ok: false }

    const perLog = sim.delay / sim.logs.length
    for (const text of sim.logs) {
      mainWindow.webContents.send('install-log', { step, text })
      await sleep(perLog)
    }
    mainWindow.webContents.send('install-step-done', { step, ok: true })
    return { ok: true }
  })

  // Override update check — no update in demo
  ipcMain.removeHandler('check-for-update')
  ipcMain.handle('check-for-update', async () => ({ hasUpdate: false }))

  // Override unified update checker — no updates in demo
  ipcMain.removeHandler('check-all-updates')
  ipcMain.handle('check-all-updates', async () => ({
    reachable: true,
    installer: { hasUpdate: false, installed: app.getVersion(), latest: app.getVersion() },
    backend: { hasUpdate: false, installed: 'v0.13.1 (demo)', latest: 'v0.13.1', apiRunning: true },
    ui: { hasUpdate: false, installed: '0.5.3 (demo)', latest: '0.5.3' },
  }))

  ipcMain.removeHandler('run-all-updates')
  ipcMain.handle('run-all-updates', async () => ({ ok: true, needsInstallerUpdate: false }))

  // Override Tailscale checks — simulate installed + connected
  ipcMain.removeHandler('check-tailscale-installed')
  ipcMain.handle('check-tailscale-installed', async () => ({
    ok: true, version: 'tailscale v1.78.1 (demo)',
  }))

  ipcMain.removeHandler('check-tailscale-status')
  ipcMain.handle('check-tailscale-status', async () => {
    await sleep(500)
    return { ok: true, hostname: 'ember-desktop' }
  })

  ipcMain.removeHandler('get-tailscale-ip')
  ipcMain.handle('get-tailscale-ip', async () => {
    await sleep(300)
    return { ok: true, ip: '100.72.128.44' }
  })

  ipcMain.removeHandler('run-tailscale-serve')
  ipcMain.handle('run-tailscale-serve', async () => {
    await sleep(1000)
    return { ok: true, output: 'Available at https://ember-desktop.exocomet-alpha.ts.net' }
  })

  ipcMain.removeHandler('get-tailscale-dns')
  ipcMain.handle('get-tailscale-dns', async () => {
    await sleep(300)
    return 'ember-desktop.exocomet-alpha.ts.net'
  })

  // Override ember-2 backend update check
  ipcMain.removeHandler('check-ember-update')
  ipcMain.handle('check-ember-update', async () => {
    await sleep(600)
    return { hasUpdate: false, installed: 'v0.9.3', latest: 'v0.9.3' }
  })

  ipcMain.removeHandler('run-ember-update')
  ipcMain.handle('run-ember-update', async () => {
    const steps = [
      'Already up to date.\n',
      'Requirements already satisfied.\n',
      'Services restarted.\n',
    ]
    for (const text of steps) {
      mainWindow.webContents.send('ember-update-log', text)
      await sleep(800)
    }
    return { ok: true, tag: 'v0.9.3' }
  })

  // Override docker daemon check
  ipcMain.removeHandler('check-docker-daemon')
  ipcMain.handle('check-docker-daemon', async () => ({ ok: true }))

  // Override venv lock check
  ipcMain.removeHandler('check-venv-lock')
  ipcMain.handle('check-venv-lock', async () => ({ locked: false }))

  // Override API start + health
  ipcMain.removeHandler('start-api')
  ipcMain.handle('start-api', async () => ({ ok: true }))
  ipcMain.removeHandler('check-api-health')
  ipcMain.handle('check-api-health', async () => {
    await sleep(2000)
    return { ok: true }
  })

  // Override clone — simulate progress
  ipcMain.removeHandler('clone-ember-repo')
  ipcMain.handle('clone-ember-repo', async (_e, { parentDir }) => {
    const msgs = [
      'Cloning into ember-2...\n',
      'Receiving objects: 100%\n',
      'Resolving deltas: 100%\n',
      'done.\n',
    ]
    for (const msg of msgs) {
      mainWindow.webContents.send('clone-progress', msg)
      await sleep(600)
    }
    return { ok: true, path: parentDir + '/ember-2' }
  })

  ipcMain.removeHandler('get-default-install-dir')
  ipcMain.handle('get-default-install-dir', () => {
    return process.platform === 'win32' ? 'C:\\Ember-2' : path.join(os.homedir(), 'Ember-2')
  })

  // Override ember scan
  ipcMain.removeHandler('scan-for-ember')
  ipcMain.handle('scan-for-ember', () => ({ found: false }))

  // Override target path check — no existing install in demo mode
  ipcMain.removeHandler('check-target-path')
  ipcMain.handle('check-target-path', () => ({ exists: false }))

  // Override update/fresh install — simulate
  ipcMain.removeHandler('update-existing-ember')
  ipcMain.handle('update-existing-ember', async (_e, { emberPath }) => {
    const msgs = ['Already up to date.\n']
    for (const msg of msgs) {
      mainWindow.webContents.send('clone-progress', msg)
      await sleep(600)
    }
    return { ok: true, path: emberPath }
  })

  ipcMain.removeHandler('fresh-install-ember')
  ipcMain.handle('fresh-install-ember', async (_e, { parentDir }) => {
    const msgs = ['Cloning into ember-2...\n', 'Receiving objects: 100%\n', 'done.\n']
    for (const msg of msgs) {
      mainWindow.webContents.send('clone-progress', msg)
      await sleep(600)
    }
    return { ok: true, path: parentDir + '/ember-2' }
  })

  // Override recommended models
  ipcMain.removeHandler('get-recommended-models')
  ipcMain.handle('get-recommended-models', async () => ({
    recommended: [
      { id: 'qwen3:8b', name: 'Qwen 3 8B', desc: 'Best overall for Ember. Strongest preference expression and memory grounding. 8 GB RAM.', size: '~4.9 GB', recommended: true, installed: true },
      { id: 'qwen2.5:14b', name: 'Qwen 2.5 14B', desc: 'Best self-attribution (9.0) — knows whose words are whose. Needs 16 GB RAM and is slower.', size: '~9 GB', installed: true },
      { id: 'gemma3:12b', name: 'Gemma 3 12B', desc: 'Best memory grounding among larger models. Safety-focused architecture. 12 GB RAM.', size: '~8.1 GB', installed: false },
      { id: 'mistral:7b', name: 'Mistral 7B', desc: 'Smallest and fastest. Only choice if you have 6-7 GB RAM. Limited but functional.', size: '~4.1 GB', installed: true },
      { id: 'deepseek-r1:8b', name: 'DeepSeek R1 8B', desc: 'Strong at analysis and code', size: '~4.9 GB', installed: false },
    ],
    vision: [
      { id: 'llama3.2-vision:11b', name: 'Llama 3.2 Vision 11B', desc: 'Can analyze images you share', size: '~6.4 GB', recommended: true, installed: true },
      { id: 'llava:13b', name: 'LLaVA 13B', desc: 'Alternative vision model', size: '~8 GB', installed: false },
    ],
    installed: ['qwen2.5:14b', 'mistral:7b', 'llama3.2-vision:11b'],
  }))
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
