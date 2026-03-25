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
let VERSION_FILE

function initPaths() {
  USER_DATA = app.getPath('userData')
  INSTALL_PATH_FILE = path.join(USER_DATA, 'ember-install-path.txt')
  VERSION_FILE = path.join(USER_DATA, 'version.json')
}

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
    title: 'Ember Setup',
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

  // Step 1: git pull
  const pullOk = await new Promise((resolve) => {
    const proc = spawn('git', ['pull'], { cwd: emberPath, shell: true })
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
  const checks = {
    docker: await probe(['docker', '--version']),
    python: await probe(['python', '--version']),
    ollama: await probe(['ollama', '--version']),
    git: await probe(['git', '--version']),
    node: await probe(['node', '--version']),
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
    const proc = spawn('git', ['clone', 'https://github.com/niansahc/ember-2.git'], {
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
    { id: 'qwen2.5:14b', name: 'Qwen 2.5 14B', desc: 'Best balance of speed and intelligence', size: '~9 GB', recommended: true },
    { id: 'llama3.1:8b', name: 'Llama 3.1 8B', desc: 'Fast and lightweight', size: '~4.7 GB' },
    { id: 'mistral:7b', name: 'Mistral 7B', desc: 'Good for general conversation', size: '~4.1 GB' },
    { id: 'qwen3:8b', name: 'Qwen 3 8B', desc: 'Newest, strong reasoning', size: '~4.9 GB' },
    { id: 'deepseek-r1:8b', name: 'DeepSeek R1 8B', desc: 'Strong at analysis and code', size: '~4.9 GB' },
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
    lines.push(
      '\n',
      '# ── API Key ────────────────────────────────────────────────────────\n',
      '# API key is stored in Windows Credential Manager — not here.\n',
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
    cmd = 'python'
    args = ['-m', 'venv', '.venv']
  } else if (step === 'pip') {
    cmd = pyBin
    args = ['-m', 'pip', 'install', '-r', 'requirements.txt']
  } else if (step === 'docker') {
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
        const proc = spawn('git', ['clone', 'https://github.com/niansahc/ember-2-ui.git'], {
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

    // npm install
    mainWindow.webContents.send('install-log', { step, text: 'Installing UI dependencies...\n' })
    const npmOk = await new Promise((resolve) => {
      const proc = spawn('npm', ['install'], { cwd: uiDir, shell: true })
      proc.stdout.on('data', (d) => mainWindow.webContents.send('install-log', { step, text: d.toString() }))
      proc.stderr.on('data', (d) => mainWindow.webContents.send('install-log', { step, text: d.toString() }))
      proc.on('close', (code) => resolve(code === 0))
      proc.on('error', () => resolve(false))
    })
    if (!npmOk) {
      mainWindow.webContents.send('install-step-done', { step, ok: false })
      return { ok: false }
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
  } else {
    return { ok: false, error: `Unknown step: ${step}` }
  }

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
  const latest = await fetchLatestRelease('niansahc/ember-2')
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

function fetchLatestRelease(repo = 'niansahc/ember-2') {
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

// (Open WebUI check and UI choice removed — Ember UI is now the only option,
//  served directly by FastAPI from the ui/ folder)

ipcMain.handle('run-git-pull', (_e) => {
  const emberPath = getEmberPath()
  if (!emberPath) return { ok: false }
  return new Promise((resolve) => {
    const proc = spawn('git', ['pull'], { cwd: emberPath, shell: true })
    proc.stdout.on('data', (d) => {
      mainWindow.webContents.send('install-log', { step: 'update', text: d.toString() })
    })
    proc.stderr.on('data', (d) => {
      mainWindow.webContents.send('install-log', { step: 'update', text: d.toString() })
    })
    proc.on('close', (code) => resolve({ ok: code === 0 }))
    proc.on('error', () => resolve({ ok: false }))
  })
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
// IPC — Misc
// ---------------------------------------------------------------------------


ipcMain.handle('open-url', (_e, url) => {
  shell.openExternal(url)
})

ipcMain.handle('get-default-vault', () => {
  return process.platform === 'win32' ? 'C:\\EmberVault' : '/data/embervault'
})

ipcMain.handle('get-default-ollama-models', () => {
  // Ollama default model storage location
  const envPath = process.env.OLLAMA_MODELS
  if (envPath) return envPath
  return process.platform === 'win32'
    ? path.join(os.homedir(), '.ollama', 'models')
    : path.join(os.homedir(), '.ollama', 'models')
})

ipcMain.handle('set-ollama-models-path', (_e, modelsPath) => {
  // Set OLLAMA_MODELS environment variable system-wide (Windows)
  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      const proc = spawn('setx', ['OLLAMA_MODELS', modelsPath], { shell: true })
      proc.on('close', (code) => resolve({ ok: code === 0 }))
      proc.on('error', () => resolve({ ok: false }))
    })
  }
  return Promise.resolve({ ok: false, error: 'Manual setup needed on this platform' })
})

ipcMain.handle('get-platform', () => process.platform)

ipcMain.handle('restart-computer', () => {
  spawn('shutdown', ['/r', '/t', '30', '/c', 'Restarting for Docker Desktop setup. Run Ember Setup again after restart.'], { shell: true })
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
      resolve(code === 0 ? out.trim() : null)
    })
    proc.on('error', () => resolve(null))
  })
})

ipcMain.handle('run-tailscale-serve', async () => {
  return new Promise((resolve) => {
    const proc = spawn('tailscale', ['serve', '--bg', 'http://localhost:3000'], { shell: true })
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
// ---------------------------------------------------------------------------

if (DEMO_MODE) {
  console.log('[DEMO MODE] Running with simulated install steps')

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
    return '100.72.128.44'
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

  // (Open WebUI overrides removed — Ember UI only)

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
  ipcMain.handle('get-default-install-dir', () => 'C:\\Ember-2')

  // Override ember scan
  ipcMain.removeHandler('scan-for-ember')
  ipcMain.handle('scan-for-ember', () => ({ found: false }))

  // Override recommended models
  ipcMain.removeHandler('get-recommended-models')
  ipcMain.handle('get-recommended-models', async () => ({
    recommended: [
      { id: 'qwen2.5:14b', name: 'Qwen 2.5 14B', desc: 'Best balance of speed and intelligence', size: '~9 GB', recommended: true, installed: true },
      { id: 'llama3.1:8b', name: 'Llama 3.1 8B', desc: 'Fast and lightweight', size: '~4.7 GB', installed: false },
      { id: 'mistral:7b', name: 'Mistral 7B', desc: 'Good for general conversation', size: '~4.1 GB', installed: true },
      { id: 'qwen3:8b', name: 'Qwen 3 8B', desc: 'Newest, strong reasoning', size: '~4.9 GB', installed: false },
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
