/**
 * src/main.js
 *
 * Ember-2 Installer — Main Process
 *
 * Handles: window creation, all IPC calls from renderer, shell commands,
 * file system operations, update checks via GitHub releases API.
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const { autoUpdater } = require('electron-updater')
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

app.whenReady().then(() => {
  initPaths()
  createWindow()

  // Check for installer self-updates (only when packaged)
  if (IS_PACKAGED) {
    autoUpdater.autoDownload = false
    autoUpdater.checkForUpdates().catch(() => {})
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ---------------------------------------------------------------------------
// Installer self-update (electron-updater)
// ---------------------------------------------------------------------------

autoUpdater.on('update-available', (info) => {
  if (mainWindow) {
    mainWindow.webContents.send('installer-update-available', {
      version: info.version,
      releaseNotes: info.releaseNotes || '',
    })
  }
})

ipcMain.handle('download-installer-update', async () => {
  autoUpdater.downloadUpdate()
  return true
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

ipcMain.handle('install-installer-update', () => {
  autoUpdater.quitAndInstall()
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

ipcMain.handle('run-install-step', (_e, { step, emberPath }) => {
  return new Promise((resolve) => {
    let cmd, args, cwd

    if (step === 'venv') {
      cwd = emberPath
      cmd = 'python'
      args = ['-m', 'venv', '.venv']
    } else if (step === 'pip') {
      cwd = emberPath
      const isWin = process.platform === 'win32'
      cmd = isWin
        ? path.join(emberPath, '.venv', 'Scripts', 'python.exe')
        : path.join(emberPath, '.venv', 'bin', 'python')
      args = ['-m', 'pip', 'install', '-r', 'requirements.txt']
    } else if (step === 'apikey') {
      cwd = emberPath
      const isWin = process.platform === 'win32'
      cmd = isWin
        ? path.join(emberPath, '.venv', 'Scripts', 'python.exe')
        : path.join(emberPath, '.venv', 'bin', 'python')
      args = ['scripts/set_api_key.py']
    } else if (step === 'docker') {
      cwd = emberPath
      cmd = 'docker'
      args = ['compose', 'up', '-d', '--build']
    } else {
      return resolve({ ok: false, error: `Unknown step: ${step}` })
    }

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
})

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

// ---------------------------------------------------------------------------
// IPC — Check Open WebUI / UI config
// ---------------------------------------------------------------------------

ipcMain.handle('check-open-webui', async () => {
  try {
    const http = require('http')
    return new Promise((resolve) => {
      const req = http.get('http://localhost:3000', { timeout: 3000 }, (res) => {
        resolve({ running: res.statusCode < 500 })
      })
      req.on('error', () => resolve({ running: false }))
      req.on('timeout', () => { req.destroy(); resolve({ running: false }) })
    })
  } catch {
    return { running: false }
  }
})

ipcMain.handle('save-ui-choice', (_e, { choice }) => {
  const emberPath = getEmberPath()
  if (!emberPath) return { ok: false }
  const configPath = path.join(emberPath, 'config.json')
  let config = {}
  if (fs.existsSync(configPath)) {
    try { config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) } catch {}
  }
  config.ui = choice // 'ember-ui' or 'open-webui'
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  return { ok: true }
})

ipcMain.handle('get-ui-choice', () => {
  const emberPath = getEmberPath()
  if (!emberPath) return null
  const configPath = path.join(emberPath, 'config.json')
  if (!fs.existsSync(configPath)) return null
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8')).ui || null
  } catch {
    return null
  }
})

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
// IPC — Misc
// ---------------------------------------------------------------------------

ipcMain.handle('open-webui', () => {
  shell.openExternal('http://localhost:3000')
})

ipcMain.handle('open-url', (_e, url) => {
  shell.openExternal(url)
})

ipcMain.handle('get-default-vault', () => {
  return process.platform === 'win32' ? 'C:\\EmberVault' : '/data/embervault'
})

ipcMain.handle('get-platform', () => process.platform)

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
  }))

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
      docker: {
        delay: 3000,
        logs: [
          'Creating network "ember-2_default"\n',
          'Building ember-webui...\n',
          'Step 1/3 : FROM ghcr.io/open-webui/open-webui:main\n',
          'Step 2/3 : COPY webui/static/ /app/build/static/\n',
          'Step 3/3 : COPY webui/assets/images/ /app/build/assets/images/\n',
          'Creating ember-searxng ... done\n',
          'Creating ember-webui  ... done\n',
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

  // Override UI choice checks
  ipcMain.removeHandler('check-open-webui')
  ipcMain.handle('check-open-webui', async () => {
    await sleep(300)
    return { running: true }
  })

  ipcMain.removeHandler('save-ui-choice')
  ipcMain.handle('save-ui-choice', async () => ({ ok: true }))

  ipcMain.removeHandler('get-ui-choice')
  ipcMain.handle('get-ui-choice', async () => 'ember-ui')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
