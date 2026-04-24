const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn, execSync } = require('child_process')
const https = require('https')
const http = require('http')
const os = require('os')

const IS_PACKAGED = app.isPackaged
const HAS_REAL_FLAG = process.argv.includes('--real')
const DEMO_MODE = !IS_PACKAGED && !HAS_REAL_FLAG
// Opt-in: demo mode pretends updates exist so the update screen can be inspected.
const HAS_DEMO_UPDATES_FLAG = process.argv.includes('--demo-updates')

// Deferred until app is ready — getPath() is not available at require time.
let USER_DATA
let INSTALL_PATH_FILE

function initPaths() {
  USER_DATA = app.getPath('userData')
  INSTALL_PATH_FILE = path.join(USER_DATA, 'ember-install-path.txt')
}

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

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 820,
    height: 800,
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
  // Update detection is handled by checkAllUpdates() in the renderer's init().
  // electron-updater is only used for the download/install mechanism, NOT for
  // startup checks — those caused unprompted OS-level popups and error dialogs.
  if (autoUpdater) {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false

    autoUpdater.on('error', () => {})

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
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('download-installer-update', async () => {
  if (autoUpdater) autoUpdater.downloadUpdate()
  return true
})

ipcMain.handle('install-installer-update', () => {
  if (autoUpdater) autoUpdater.quitAndInstall()
})

ipcMain.handle('check-ember-update', async () => {
  const emberPath = getEmberPath()
  if (!emberPath) return { hasUpdate: false, error: 'No ember-2 path configured' }

  let installed = null
  const vf = path.join(emberPath, 'version.json')
  if (fs.existsSync(vf)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(vf, 'utf-8'))
      installed = parsed.version || parsed.tag || null
      if (installed && !installed.startsWith('v')) installed = `v${installed}`
    } catch {}
  }

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

const WINGET_PACKAGES = {
  git: 'Git.Git',
  python: 'Python.Python.3.12',
  node: 'OpenJS.NodeJS.LTS',
  ollama: 'Ollama.Ollama',
  docker: 'Docker.DockerDesktop',
}

ipcMain.handle('install-prerequisite', (_e, { name }) => {
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
  if (process.platform !== 'win32') return { available: false }
  const result = await probe(['winget', '--version'])
  return { available: result.ok }
})

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

ipcMain.handle('clone-ember-repo', (_e, { parentDir }) => {
  return new Promise((resolve) => {
    const targetDir = path.join(parentDir, 'ember-2')
    if (fs.existsSync(targetDir)) {
      return resolve({ ok: true, path: targetDir, message: 'Already exists' })
    }
    try {
      fs.mkdirSync(parentDir, { recursive: true })
    } catch (err) {
      return resolve({ ok: false, error: `Cannot create directory: ${err.message}` })
    }
    const proc = spawn('git', ['clone', '--depth', '1', REPO_BACKEND_URL], {
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
    const proc = spawn('git', ['clone', '--depth', '1', REPO_BACKEND_URL], {
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

  candidates.push(DEV_EMBER_PATH)

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

ipcMain.handle('detect-hardware', async () => {
  const totalRamGB = Math.round(os.totalmem() / (1024 ** 3))

  let gpu = 'Unknown'
  try {
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


ipcMain.handle('get-recommended-models', async () => {
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

ipcMain.handle('set-fullscreen', (_e, { enabled }) => {
  if (!mainWindow) return
  mainWindow.setFullScreen(enabled)
})

ipcMain.handle('get-release-notes', () => {
  try {
    // Look for release_notes.html in the app root (packaged: resources/app/,
    // dev: project root).
    const candidates = [
      path.join(__dirname, '..', 'release_notes.html'),
      path.join(__dirname, 'release_notes.html'),
    ]
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return { ok: true, html: fs.readFileSync(p, 'utf-8') }
      }
    }
    return { ok: false, html: '' }
  } catch {
    return { ok: false, html: '' }
  }
})

const VAULT_SUBDIRS = [
  'memory/conversation',
  'memory/journal',
  'memory/reflection',
  'memory/state',
  'memory/ingested',
  'memory/archive',
  'embeddings',
  'imports',
]

ipcMain.handle('setup-dev-mode', (_e, { emberPath, demoVault, testVault }) => {
  try {
    // 1. Create vault directory structures
    for (const vaultRoot of [demoVault, testVault]) {
      for (const sub of VAULT_SUBDIRS) {
        fs.mkdirSync(path.join(vaultRoot, sub), { recursive: true })
      }
    }

    // 2. Append dev mode vars to .env (don't overwrite — append to existing)
    const envPath = path.join(emberPath, '.env')
    const demoFwd = demoVault.replace(/\\/g, '/')
    const testFwd = testVault.replace(/\\/g, '/')
    const devBlock = [
      '\n',
      '# ── Developer Mode ─────────────────────────────────────────────\n',
      'EMBER_DEV_MODE=true\n',
      `VAULT_PATH_DEMO=${demoFwd}\n`,
      `VAULT_PATH_TEST=${testFwd}\n`,
    ].join('')

    fs.appendFileSync(envPath, devBlock, 'utf-8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})


ipcMain.handle('run-install-step', async (_e, { step, emberPath }) => {
  const isWin = process.platform === 'win32'
  const pyBin = isWin
    ? `"${path.join(emberPath, '.venv', 'Scripts', 'python.exe')}"`
    : path.join(emberPath, '.venv', 'bin', 'python')

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

  let cmd, args
  if (step === 'venv') {
    cmd = isWin ? 'python' : 'python3'
    args = ['-m', 'venv', '.venv']
  } else if (step === 'pip') {
    cmd = pyBin
    args = ['-m', 'pip', 'install', '-r', 'requirements.txt']
  } else if (step === 'docker') {
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
    const composeResult = await runSpawn('docker', ['compose', 'up', '-d'], emberPath, step)
    if (!composeResult.ok) return composeResult

    mainWindow.webContents.send('install-log', { step, text: 'Waiting for search engine to be ready...\n' })
    let healthy = false
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 3000))
      healthy = await new Promise((resolve) => {
        const proc = spawn('docker', ['compose', 'ps', '--status', 'running', '-q'], {
          cwd: emberPath, shell: true,
        })
        let out = ''
        proc.stdout.on('data', (d) => (out += d.toString()))
        proc.on('close', (code) => resolve(code === 0 && out.trim().length > 0))
        proc.on('error', () => resolve(false))
      })
      if (healthy) break
      mainWindow.webContents.send('install-log', { step, text: 'Waiting for search engine container...\n' })
    }
    if (!healthy) {
      mainWindow.webContents.send('install-log', { step, text: 'Search engine container did not become ready in time.\n' })
      mainWindow.webContents.send('install-step-done', { step, ok: false })
      return { ok: false }
    }
    mainWindow.webContents.send('install-log', { step, text: 'Search engine ready ✓\n' })
    mainWindow.webContents.send('install-step-done', { step, ok: true })
    return { ok: true }
  } else if (step === 'build-ui') {
    const uiDir = path.join(path.dirname(emberPath), 'ember-2-ui')
    const uiDistDir = path.join(uiDir, 'dist')
    const targetUiDir = path.join(emberPath, 'ui')

    if (!fs.existsSync(uiDir)) {
      const cloneOk = await new Promise((resolve) => {
        const proc = spawn('git', ['clone', '--depth', '1', REPO_UI_URL], {
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

    // Remove .env now that the key is baked into the bundle
    try { fs.unlinkSync(path.join(uiDir, '.env')) } catch {}

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

ipcMain.handle('check-for-update', async () => {
  const emberPath = getEmberPath()
  if (!emberPath) return { hasUpdate: false }

  let installed = null
  const vf = path.join(emberPath, 'version.json')
  if (fs.existsSync(vf)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(vf, 'utf-8'))
      installed = parsed.version || parsed.tag || null
      if (installed && !installed.startsWith('v')) installed = `v${installed}`
    } catch {}
  }

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

// Extract a short one-line summary from a GitHub release body — the first
// bullet wins. Used by the update screen "what's new" notes so each row
// shows something more useful than just a version bump.
function firstBullet(body) {
  if (!body) return ''
  const lines = body.split('\n')
  for (const line of lines) {
    const m = line.match(/^\s*[-*]\s+(.+?)\s*$/)
    if (m) {
      return m[1]
        .replace(/\*\*/g, '')
        .replace(/`/g, '')
        .replace(/\[(.+?)\]\(.+?\)/g, '$1')
        .slice(0, 120)
    }
  }
  for (const line of lines) {
    const t = line.trim()
    if (t && !t.startsWith('#') && !t.startsWith('---')) return t.slice(0, 120)
  }
  return ''
}

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

  const [installerRelease, backendRelease, uiRelease, healthData] = await Promise.all([
    fetchLatestReleaseWithTimeout(REPO_INSTALLER_SLUG),
    fetchLatestReleaseWithTimeout(REPO_BACKEND_SLUG),
    fetchLatestReleaseWithTimeout(REPO_UI_SLUG),
    // Get backend version from running API, not version.json
    new Promise((resolve) => {
      const targetHost = host || '127.0.0.1'
  
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
      notes: firstBullet(installerRelease?.body),
    },
    backend: {
      hasUpdate: backendLatest && (!backendInstalled || backendInstalled !== backendLatest),
      installed: backendInstalled || 'unknown',
      latest: backendLatest,
      apiRunning: backendApiRunning,
      notes: firstBullet(backendRelease?.body),
    },
    ui: {
      hasUpdate: uiLatest && (!uiInstalled || uiInstalled !== uiLatest),
      installed: uiInstalled || 'unknown',
      latest: uiLatest,
      notes: firstBullet(uiRelease?.body),
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

    let pulledVersion = null
    try {
      const vf = path.join(emberPath, 'version.json')
      if (fs.existsSync(vf)) {
        const parsed = JSON.parse(fs.readFileSync(vf, 'utf-8'))
        pulledVersion = parsed.version || parsed.tag || null
        log(`Pulled version: ${pulledVersion}\n`)
      }
    } catch {}

    // Kill the old API BEFORE docker restart so a lingering uvicorn can't win the port-8000 bind race.
    log('Stopping old API process...\n')
    if (isWin) {
      await new Promise((resolve) => {
        const proc = spawn('taskkill', ['/F', '/FI', 'WINDOWTITLE eq start_api*'], { shell: true })
        proc.on('close', () => resolve())
        proc.on('error', () => resolve())
      })
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
    await new Promise((r) => setTimeout(r, 2000))

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

    log('Waiting for API to start...\n')

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

  if (updates.ui) {
    log('Updating Ember UI...\n')
    if (!fs.existsSync(uiDir)) {
      log('Cloning ember-2-ui...\n')
      const cloneOk = await new Promise((resolve) => {
        const proc = spawn('git', ['clone', '--depth', '1', REPO_UI_URL], {
          cwd: path.dirname(emberPath), shell: true,
        })
        proc.stdout.on('data', (d) => log(d.toString()))
        proc.stderr.on('data', (d) => log(d.toString()))
        proc.on('close', (code) => resolve(code === 0))
        proc.on('error', () => resolve(false))
      })
      if (!cloneOk) { log('UI clone failed.\n'); return { ok: false, stage: 'ui-clone' } }
    } else {
      // npm install/ci may have rewritten package-lock.json; reset it so git pull doesn't refuse to merge.
      await new Promise((resolve) => {
        const proc = spawn('git', ['checkout', '--', 'package-lock.json'], { cwd: uiDir, shell: true })
        proc.on('close', () => resolve())
        proc.on('error', () => resolve())
      })
      const pullOk = await new Promise((resolve) => {
        const proc = spawn('git', ['pull', 'origin', 'main'], { cwd: uiDir, shell: true })
        proc.stdout.on('data', (d) => log(d.toString()))
        proc.stderr.on('data', (d) => log(d.toString()))
        proc.on('close', (code) => resolve(code === 0))
        proc.on('error', () => resolve(false))
      })
      if (!pullOk) {
        log(`UI pull failed in ${uiDir}. The clone is still intact — retrying the update is safe.\n`)
        return { ok: false, stage: 'ui-pull' }
      }
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

    // Remove .env now that the key is baked into the bundle
    try { fs.unlinkSync(path.join(uiDir, '.env')) } catch {}

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

  log('Pulling ember-2...\n')
  const pullOk = await new Promise((resolve) => {
    const proc = spawn('git', ['pull', 'origin', 'main'], { cwd: emberPath, shell: true })
    proc.stdout.on('data', (d) => log(d.toString()))
    proc.stderr.on('data', (d) => log(d.toString()))
    proc.on('close', (code) => resolve(code === 0))
    proc.on('error', () => resolve(false))
  })
  if (!pullOk) return { ok: false }

  const uiDir = path.join(path.dirname(emberPath), 'ember-2-ui')
  const targetUiDir = path.join(emberPath, 'ui')

  if (!fs.existsSync(uiDir)) {
    log('Cloning ember-2-ui...\n')
    const cloneOk = await new Promise((resolve) => {
      const proc = spawn('git', ['clone', '--depth', '1', REPO_UI_URL], {
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

ipcMain.handle('check-ui-built', () => {
  const emberPath = getEmberPath()
  if (!emberPath) return { ok: false }
  const indexPath = path.join(emberPath, 'ui', 'index.html')
  return { ok: fs.existsSync(indexPath) }
})

ipcMain.handle('check-docker-daemon', () => {
  return new Promise((resolve) => {
    const proc = spawn('docker', ['info'], { shell: true })
    proc.on('close', (code) => resolve({ ok: code === 0 }))
    proc.on('error', () => resolve({ ok: false }))
  })
})

ipcMain.handle('check-docker-containers', (_e, { emberPath }) => {
  // Daemon responding is not enough — search/retrieval containers must actually be running
  // before the API starts, otherwise early requests fail.
  return new Promise((resolve) => {
    if (!emberPath || !fs.existsSync(emberPath)) return resolve({ ok: false, count: 0 })
    let out = ''
    const proc = spawn('docker', ['compose', 'ps', '--status', 'running', '-q'], {
      cwd: emberPath, shell: true,
    })
    proc.stdout.on('data', (d) => (out += d.toString()))
    proc.on('close', (code) => {
      const count = out.split('\n').filter((l) => l.trim().length > 0).length
      resolve({ ok: code === 0 && count > 0, count })
    })
    proc.on('error', () => resolve({ ok: false, count: 0 }))
  })
})

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

ipcMain.handle('get-vault-storage', (_e, { host }) => {
  const targetHost = host || '127.0.0.1'
  const http = require('http')
  return new Promise((resolve) => {
    const req = http.get(`http://${targetHost}:8000/v1/vault/storage`, { timeout: 5000 }, (res) => {
      let data = ''
      res.on('data', (d) => (data += d))
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch { resolve(null) }
      })
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
  })
})

ipcMain.handle('check-venv-lock', (_e, { emberPath }) => {
  if (!emberPath) return { locked: false }

  const isWin = process.platform === 'win32'
  const pythonExe = isWin
    ? path.join(emberPath, '.venv', 'Scripts', 'python.exe')
    : path.join(emberPath, '.venv', 'bin', 'python')

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

// Windows: Task Scheduler (schtasks ONLOGON)
// macOS:   LaunchAgent plist (~/Library/LaunchAgents/)
// Linux:   systemd user service (~/.config/systemd/user/)
const STARTUP_TASK_NAME = 'EmberStartup'
const LAUNCHAGENT_LABEL = 'com.ember2.api'
const LAUNCHAGENT_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LAUNCHAGENT_LABEL}.plist`)
const SYSTEMD_UNIT_DIR = path.join(os.homedir(), '.config', 'systemd', 'user')
const SYSTEMD_UNIT_PATH = path.join(SYSTEMD_UNIT_DIR, 'ember-2.service')

ipcMain.handle('set-startup-task', async (_e, { emberPath, enabled }) => {
  const plat = process.platform

  if (plat === 'win32') {
    if (!enabled) {
      return new Promise((resolve) => {
        const proc = spawn('schtasks', ['/Delete', '/TN', STARTUP_TASK_NAME, '/F'], { shell: true })
        proc.on('close', (code) => resolve({ ok: code === 0 || code === 1 })) // 1 = task didn't exist
        proc.on('error', () => resolve({ ok: false }))
      })
    }
    // Use watchdog.py via venv Python — handles API lifecycle, crash recovery,
    // and signal-based restart/stop. Falls back to launch_ember.bat if watchdog
    // or venv is missing (pre-v0.16.0 installs).
    const venvPython = path.join(emberPath, '.venv', 'Scripts', 'python.exe')
    const watchdog = path.join(emberPath, 'scripts', 'watchdog.py')
    let taskCommand
    if (fs.existsSync(venvPython) && fs.existsSync(watchdog)) {
      taskCommand = `"${venvPython}" "${watchdog}"`
    } else {
      const fallback = path.join(emberPath, 'launch_ember.bat')
      if (!fs.existsSync(fallback)) {
        return { ok: false, error: 'Neither watchdog.py nor launch_ember.bat found' }
      }
      taskCommand = `"${fallback}"`
    }
    return new Promise((resolve) => {
      const proc = spawn('schtasks', [
        '/Create', '/TN', STARTUP_TASK_NAME, '/TR', taskCommand,
        '/SC', 'ONLOGON', '/RL', 'LIMITED', '/F',
      ], { shell: true })
      proc.on('close', (code) => resolve({ ok: code === 0 }))
      proc.on('error', () => resolve({ ok: false }))
    })
  }

  if (plat === 'darwin') {
    if (!enabled) {
      await new Promise((resolve) => {
        const proc = spawn('launchctl', ['unload', LAUNCHAGENT_PATH], { shell: true })
        proc.on('close', () => resolve())
        proc.on('error', () => resolve())
      })
      try { fs.unlinkSync(LAUNCHAGENT_PATH) } catch {}
      return { ok: true }
    }
    const venvPython = path.join(emberPath, '.venv', 'bin', 'python')
    const watchdog = path.join(emberPath, 'scripts', 'watchdog.py')
    const useWatchdog = fs.existsSync(venvPython) && fs.existsSync(watchdog)
    const scriptPath = path.join(emberPath, 'launch_ember.sh')
    if (!useWatchdog && !fs.existsSync(scriptPath)) {
      return { ok: false, error: 'Neither watchdog.py nor launch_ember.sh found' }
    }
    const progArgs = useWatchdog
      ? `<string>${venvPython}</string>\n    <string>${watchdog}</string>`
      : `<string>/bin/bash</string>\n    <string>${scriptPath}</string>`
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHAGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    ${progArgs}
  </array>
  <key>WorkingDirectory</key>
  <string>${emberPath}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${path.join(emberPath, 'ember-launch.log')}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(emberPath, 'ember-launch.log')}</string>
</dict>
</plist>`
    try {
      fs.mkdirSync(path.dirname(LAUNCHAGENT_PATH), { recursive: true })
      fs.writeFileSync(LAUNCHAGENT_PATH, plist, 'utf-8')
    } catch (err) {
      return { ok: false, error: `Failed to write plist: ${err.message}` }
    }
    return new Promise((resolve) => {
      const proc = spawn('launchctl', ['load', LAUNCHAGENT_PATH], { shell: true })
      proc.on('close', (code) => resolve({ ok: code === 0 }))
      proc.on('error', () => resolve({ ok: false }))
    })
  }

  if (plat === 'linux') {
    if (!enabled) {
      await new Promise((resolve) => {
        const proc = spawn('systemctl', ['--user', 'disable', 'ember-2.service'], { shell: true })
        proc.on('close', () => resolve())
        proc.on('error', () => resolve())
      })
      try { fs.unlinkSync(SYSTEMD_UNIT_PATH) } catch {}
      return { ok: true }
    }
    const venvPython = path.join(emberPath, '.venv', 'bin', 'python')
    const watchdog = path.join(emberPath, 'scripts', 'watchdog.py')
    const useWatchdog = fs.existsSync(venvPython) && fs.existsSync(watchdog)
    const scriptPath = path.join(emberPath, 'launch_ember.sh')
    if (!useWatchdog && !fs.existsSync(scriptPath)) {
      return { ok: false, error: 'Neither watchdog.py nor launch_ember.sh found' }
    }
    const execStart = useWatchdog
      ? `${venvPython} ${watchdog}`
      : `/bin/bash ${scriptPath}`
    const unit = `[Unit]
Description=Ember-2 API
After=network.target docker.service

[Service]
Type=simple
ExecStart=${execStart}
WorkingDirectory=${emberPath}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`
    try {
      fs.mkdirSync(SYSTEMD_UNIT_DIR, { recursive: true })
      fs.writeFileSync(SYSTEMD_UNIT_PATH, unit, 'utf-8')
    } catch (err) {
      return { ok: false, error: `Failed to write unit file: ${err.message}` }
    }
    await new Promise((resolve) => {
      const proc = spawn('systemctl', ['--user', 'daemon-reload'], { shell: true })
      proc.on('close', () => resolve())
      proc.on('error', () => resolve())
    })
    return new Promise((resolve) => {
      const proc = spawn('systemctl', ['--user', 'enable', 'ember-2.service'], { shell: true })
      proc.on('close', (code) => resolve({ ok: code === 0 }))
      proc.on('error', () => resolve({ ok: false }))
    })
  }

  return { ok: false, error: `Unsupported platform: ${plat}` }
})

ipcMain.handle('get-startup-task', () => {
  const plat = process.platform

  if (plat === 'win32') {
    return new Promise((resolve) => {
      const proc = spawn('schtasks', ['/Query', '/TN', STARTUP_TASK_NAME], { shell: true })
      proc.on('close', (code) => resolve({ enabled: code === 0 }))
      proc.on('error', () => resolve({ enabled: false }))
    })
  }

  if (plat === 'darwin') {
    return { enabled: fs.existsSync(LAUNCHAGENT_PATH) }
  }

  if (plat === 'linux') {
    return new Promise((resolve) => {
      const proc = spawn('systemctl', ['--user', 'is-enabled', 'ember-2.service'], { shell: true })
      proc.on('close', (code) => resolve({ enabled: code === 0 }))
      proc.on('error', () => resolve({ enabled: false }))
    })
  }

  return { enabled: false }
})

ipcMain.handle('open-url', (_e, url) => {
  if (typeof url !== 'string') return
  const isHttps = url.startsWith('https://')
  const isLocalhost = url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1')
  if (!isHttps && !isLocalhost) {
    console.warn(`[open-url] Blocked URL with disallowed scheme: ${url}`)
    return
  }
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
    return new Promise((resolve) => {
      const proc = spawn('setx', ['OLLAMA_MODELS', modelsPath], { shell: true })
      proc.on('close', (code) => resolve({ ok: code === 0 }))
      proc.on('error', () => resolve({ ok: false }))
    })
  }

  const profilePath = process.platform === 'darwin'
    ? path.join(os.homedir(), '.zprofile')
    : path.join(os.homedir(), '.profile')
  const exportLine = `export OLLAMA_MODELS="${modelsPath}"`

  try {
    const existing = fs.existsSync(profilePath) ? fs.readFileSync(profilePath, 'utf-8') : ''
    if (existing.includes('OLLAMA_MODELS=')) {
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
    spawn('sudo', ['shutdown', '-r', '+1', 'Restarting for Docker setup. Run Ember Setup again after restart.'], { shell: true })
  }
})

ipcMain.handle('get-demo-mode', () => DEMO_MODE)

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

// Demo mode: every IPC handler that touches real infrastructure is replaced
// with a fake that returns realistic data after a short delay, so the full
// UI can be exercised in e2e tests and during development.

if (DEMO_MODE) {
  console.log('[DEMO MODE] Running with simulated install steps')

  ipcMain.removeHandler('check-ui-built')
  ipcMain.handle('check-ui-built', async () => ({ ok: true }))

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

  ipcMain.removeHandler('check-winget')
  ipcMain.handle('check-winget', async () => ({ available: true }))

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
        delay: 2500,
        logs: [
          'Creating ember-searxng ... done\n',
          'Waiting for search engine to be ready...\n',
          'Search engine ready ✓\n',
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

  // When --demo-updates is set, pretend an install exists so init() enters
  // the update-check branch and shows the update screen on boot. Without
  // this the demo boots to Welcome instead.
  if (HAS_DEMO_UPDATES_FLAG) {
    ipcMain.removeHandler('get-ember-path')
    ipcMain.handle('get-ember-path', () => 'C:/demo/ember-2')
  }

  // Override unified update checker — no updates in demo, OR fake updates
  // for all three repos when --demo-updates is set (for demoing the screen).
  ipcMain.removeHandler('check-all-updates')
  ipcMain.handle('check-all-updates', async () => {
    if (HAS_DEMO_UPDATES_FLAG) {
      return {
        reachable: true,
        installer: {
          hasUpdate: true,
          installed: app.getVersion(),
          latest: '0.7.0',
          notes: 'Update screen learned to glow when it works.',
        },
        backend: {
          hasUpdate: true,
          installed: 'v0.13.1',
          latest: 'v0.14.0',
          apiRunning: true,
          notes: 'Faster retrieval and a steadier conversation memory.',
        },
        ui: {
          hasUpdate: true,
          installed: '0.5.3',
          latest: '0.6.0',
          notes: 'Citation popovers and a calmer empty state.',
        },
      }
    }
    return {
      reachable: true,
      installer: { hasUpdate: false, installed: app.getVersion(), latest: app.getVersion() },
      backend: { hasUpdate: false, installed: 'v0.13.1 (demo)', latest: 'v0.13.1', apiRunning: true },
      ui: { hasUpdate: false, installed: '0.5.3 (demo)', latest: '0.5.3' },
    }
  })

  ipcMain.removeHandler('run-all-updates')
  ipcMain.handle('run-all-updates', async (_e, payload) => {
    if (HAS_DEMO_UPDATES_FLAG) {
      const updates = payload?.updates || { backend: true, ui: true, installer: true }
      const log = (text) => mainWindow?.webContents.send('update-all-log', text)
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))

      if (updates.backend) {
        log('Updating Ember backend...\n')
        await wait(1500)
        log('  pulled v0.14.0\n')
        await wait(900)
      }
      if (updates.ui) {
        log('Updating Ember UI...\n')
        await wait(1500)
        log('  built dist/\n')
        await wait(900)
      }
      if (updates.installer) {
        log('Downloading installer update...\n')
        await wait(1600)
        log('  installer ready\n')
        await wait(700)
      }
      log('\nAll updates applied.\n')
      // needsInstallerUpdate=false so the celebration card has time to play
      // instead of the app quit-and-installing before we see it.
      return { ok: true, needsInstallerUpdate: false }
    }
    return { ok: true, needsInstallerUpdate: false }
  })

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

  ipcMain.removeHandler('check-docker-daemon')
  ipcMain.handle('check-docker-daemon', async () => ({ ok: true }))

  ipcMain.removeHandler('check-docker-containers')
  ipcMain.handle('check-docker-containers', async () => ({ ok: true, count: 2 }))

  ipcMain.removeHandler('check-venv-lock')
  ipcMain.handle('check-venv-lock', async () => ({ locked: false }))

  ipcMain.removeHandler('start-api')
  ipcMain.handle('start-api', async () => ({ ok: true }))
  ipcMain.removeHandler('check-api-health')
  ipcMain.handle('check-api-health', async () => {
    await sleep(2000)
    return { ok: true }
  })

  ipcMain.removeHandler('get-vault-storage')
  ipcMain.handle('get-vault-storage', async () => {
    await sleep(300)
    return {
      current_bytes: 15728640,
      current_human: '15.0 MB',
      growth_rate_bytes_per_day: 524288,
      projected_30d_bytes: 31457280,
      projected_30d_human: '30.0 MB',
      sampled_days: 14,
    }
  })

  ipcMain.removeHandler('set-startup-task')
  ipcMain.handle('set-startup-task', async () => ({ ok: true }))
  ipcMain.removeHandler('get-startup-task')
  ipcMain.handle('get-startup-task', async () => ({ enabled: false }))

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

  // Override dev mode — just pretend
  ipcMain.removeHandler('setup-dev-mode')
  ipcMain.handle('setup-dev-mode', async () => {
    await sleep(300)
    return { ok: true }
  })

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
