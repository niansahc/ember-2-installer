/**
 * src/renderer/app.js
 *
 * Ember-2 Installer — Renderer Logic
 *
 * Single-page app with show/hide screens. All shell work is delegated
 * to the main process via the ember.* API exposed through preload.js.
 */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  emberPath: null,
  vaultPath: null,
  model: 'qwen3:8b',
  vision: null,
  host: '127.0.0.1',
  tailscaleIp: null,
  tailscaleDns: null,
  models: [],
  ollamaModelsPath: null,
}

// ---------------------------------------------------------------------------
// Simple markdown renderer (## headings, **bold**, - bullets, newlines)
// ---------------------------------------------------------------------------

function simpleMarkdown(text) {
  if (!text) return ''
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (trimmed.startsWith('## ')) return `<h3 class="md-h3">${trimmed.slice(3)}</h3>`
      if (trimmed.startsWith('# ')) return `<h2 class="md-h2">${trimmed.slice(2)}</h2>`
      if (trimmed.startsWith('- ')) return `<li class="md-li">${inlineMd(trimmed.slice(2))}</li>`
      if (trimmed === '---') return '<hr class="md-hr">'
      if (trimmed === '') return '<br>'
      return `<p class="md-p">${inlineMd(trimmed)}</p>`
    })
    .join('')
}

function inlineMd(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'))
  const screen = document.getElementById(id)
  if (screen) {
    screen.classList.add('active')
    screen.style.animation = 'none'
    // Trigger reflow to restart animation
    screen.offsetHeight
    screen.style.animation = ''
  }
}

// Wire up all Next/Back buttons with data-next / data-prev attributes
document.querySelectorAll('[data-next]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!btn.disabled) showScreen(btn.dataset.next)
  })
})

document.querySelectorAll('[data-prev]').forEach((btn) => {
  btn.addEventListener('click', () => showScreen(btn.dataset.prev))
})

// ---------------------------------------------------------------------------
// Screen: Prerequisites
// ---------------------------------------------------------------------------

let hasWinget = false
let missingPrereqs = []
let currentPlatform = 'win32'

// Platform-specific install hints for missing prerequisites
const INSTALL_HINTS = {
  darwin: {
    python: 'Install via Homebrew: brew install python3',
    ollama: 'Install from ollama.com or run: brew install ollama',
    docker: 'Install Docker Desktop from docker.com',
    git: 'Install Xcode Command Line Tools: xcode-select --install',
    node: 'Install via Homebrew: brew install node',
  },
  linux: {
    python: 'Install via your package manager (e.g. apt install python3)',
    ollama: 'Install from ollama.com/download/linux',
    docker: 'Install Docker Engine: docs.docker.com/engine/install',
    git: 'Install via your package manager (e.g. apt install git)',
    node: 'Install from nodejs.org or via your package manager',
  },
}

async function checkPrerequisites() {
  // Disable Next immediately so users cannot advance while checks are in flight.
  // This closes a race condition: if Next was enabled from a prior passing check
  // and the user clicks Re-check then quickly clicks Next, they could bypass a
  // now-failing prerequisite (reported for Node.js in v0.12.0).
  document.getElementById('btn-prereqs-next').disabled = true

  const checks = await window.ember.checkPrerequisites()
  const winget = await window.ember.checkWinget()
  currentPlatform = await window.ember.getPlatform()
  hasWinget = winget.available
  missingPrereqs = []
  let allGood = true

  // Show Homebrew row on Mac
  if (currentPlatform === 'darwin') {
    const brewRow = document.getElementById('prereq-brew')
    if (brewRow) {
      brewRow.classList.remove('hidden')
      if (checks.brew) {
        const brewIcon = brewRow.querySelector('.prereq-icon')
        const brewVersion = brewRow.querySelector('.prereq-version')
        const brewLink = brewRow.querySelector('.prereq-link')
        if (checks.brew.ok) {
          brewIcon.textContent = '✅'
          brewVersion.textContent = checks.brew.version || 'Installed'
          if (brewLink) brewLink.classList.add('hidden')
        } else {
          brewIcon.textContent = '⚠️'
          brewVersion.textContent = 'Not found (optional)'
          if (brewLink) brewLink.classList.remove('hidden')
          // Brew is not a blocker — do not add to missingPrereqs
        }
      }
    }
  }

  for (const [name, result] of Object.entries(checks)) {
    if (name === 'brew') continue // Handled separately above
    const row = document.getElementById(`prereq-${name}`)
    if (!row) continue
    const icon = row.querySelector('.prereq-icon')
    const version = row.querySelector('.prereq-version')
    const installBtn = row.querySelector('.prereq-install-btn')
    const link = row.querySelector('.prereq-link')

    if (result.ok) {
      icon.textContent = '✅'
      version.textContent = result.version || 'Installed'
      if (installBtn) installBtn.classList.add('hidden')
      if (link) link.classList.add('hidden')
    } else {
      icon.textContent = '❌'
      allGood = false
      missingPrereqs.push(name)

      // Platform-specific install hint
      const hints = INSTALL_HINTS[currentPlatform]
      if (hints && hints[name]) {
        version.textContent = hints[name]
      } else {
        version.textContent = 'Not found'
      }

      // Windows: show winget install button; Mac/Linux: show manual download link only
      if (hasWinget && installBtn) {
        installBtn.classList.remove('hidden')
        if (link) link.classList.remove('hidden')
      } else if (link) {
        link.classList.remove('hidden')
        if (installBtn) installBtn.classList.add('hidden')
      }
    }
  }

  // If Docker is installed, check whether the daemon is actually running.
  // Docker installed + daemon stopped = SearXNG fails silently.
  const daemonRow = document.getElementById('prereq-docker-daemon')
  if (checks.docker?.ok && daemonRow) {
    daemonRow.classList.remove('hidden')
    const daemonIcon = daemonRow.querySelector('.prereq-icon')
    const daemonVersion = daemonRow.querySelector('.prereq-version')
    const daemonRecheck = document.getElementById('btn-docker-daemon-recheck')

    const daemon = await window.ember.checkDockerDaemon()
    if (daemon.ok) {
      daemonIcon.textContent = '✅'
      daemonVersion.textContent = 'Running'
      if (daemonRecheck) daemonRecheck.classList.add('hidden')
    } else {
      daemonIcon.textContent = '⚠️'
      daemonVersion.textContent = 'Docker is installed but not running. Please start Docker Desktop and try again.'
      allGood = false
      if (daemonRecheck) daemonRecheck.classList.remove('hidden')
    }
  } else if (daemonRow) {
    daemonRow.classList.add('hidden')
  }

  document.getElementById('btn-prereqs-next').disabled = !allGood

  // Show "Install All" if multiple missing and winget available (Windows only)
  const installAllWrap = document.getElementById('prereq-install-all-wrap')
  if (hasWinget && missingPrereqs.length > 1) {
    installAllWrap.classList.remove('hidden')
  } else {
    installAllWrap.classList.add('hidden')
  }

  // Show total size estimate for missing items
  const sizeMap = { git: 50, python: 100, node: 75, ollama: 100, docker: 600 }
  const totalHint = document.getElementById('prereq-total-hint')
  if (missingPrereqs.length > 0) {
    const totalMB = missingPrereqs.reduce((sum, name) => sum + (sizeMap[name] || 0), 0)
    const note = missingPrereqs.includes('docker') ? ' (Docker requires a restart after install)' : ''
    totalHint.textContent = `Total download: ~${totalMB >= 1000 ? (totalMB / 1000).toFixed(1) + ' GB' : totalMB + ' MB'}${note}`
  } else {
    totalHint.textContent = ''
  }
}

// Individual install buttons
document.querySelectorAll('.prereq-install-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const name = btn.dataset.prereq
    await installOnePrereq(name, btn)
  })
})

async function installOnePrereq(name, btn) {
  const logBox = document.getElementById('prereq-install-log')
  logBox.classList.remove('hidden')

  if (btn) {
    btn.disabled = true
    btn.textContent = 'Installing...'
  }

  logBox.textContent += `Installing ${name}...\n`

  window.ember.onPrereqInstallProgress(({ name: n, text }) => {
    if (n === name) {
      logBox.textContent += text
      logBox.scrollTop = logBox.scrollHeight
    }
  })

  const result = await window.ember.installPrerequisite(name)
  window.ember.removeAllListeners('prereq-install-progress')

  if (result.ok) {
    logBox.textContent += `${name} installed ✓\n\n`
    if (btn) btn.textContent = 'Installed ✓'

    if (result.needsRestart) {
      showRestartNotice()
      return true
    }

    // Re-check to update the UI
    await checkPrerequisites()
  } else {
    logBox.textContent += `Failed to install ${name}. ${result.error || 'Try the manual download link.'}\n\n`
    if (btn) {
      btn.disabled = false
      btn.textContent = 'Retry'
    }
  }
  return result.ok
}

// Install All Missing button
document.getElementById('btn-install-all').addEventListener('click', async () => {
  const btn = document.getElementById('btn-install-all')
  btn.disabled = true
  btn.textContent = 'Installing...'

  // Install Docker last (may need restart)
  const sorted = [...missingPrereqs].sort((a, b) => {
    if (a === 'docker') return 1
    if (b === 'docker') return -1
    return 0
  })

  for (const name of sorted) {
    const row = document.getElementById(`prereq-${name}`)
    const prereqBtn = row?.querySelector('.prereq-install-btn')
    const ok = await installOnePrereq(name, prereqBtn)
    if (!ok) {
      btn.disabled = false
      btn.textContent = 'Retry Remaining'
      return
    }
  }

  btn.textContent = 'All installed ✓'
})

function showRestartNotice() {
  document.getElementById('prereq-restart-notice').classList.remove('hidden')
  document.getElementById('prereq-nav-row').classList.add('hidden')
}

document.getElementById('btn-restart-now').addEventListener('click', () => {
  window.ember.restartComputer()
})

document.getElementById('btn-restart-later').addEventListener('click', () => {
  document.getElementById('prereq-restart-notice').classList.add('hidden')
  document.getElementById('prereq-nav-row').classList.remove('hidden')
})

// Docker daemon "Check again" button — re-runs full prereq check
document.getElementById('btn-docker-daemon-recheck').addEventListener('click', () => {
  document.getElementById('btn-docker-daemon-recheck').classList.add('hidden')
  checkPrerequisites()
})

// Download links open external browser (fallback)
document.querySelectorAll('.prereq-link').forEach((link) => {
  link.addEventListener('click', (e) => {
    e.preventDefault()
    window.ember.openUrl(link.dataset.url)
  })
})

document.getElementById('btn-recheck').addEventListener('click', () => {
  document.querySelectorAll('.prereq-icon').forEach((i) => (i.textContent = '⏳'))
  document.querySelectorAll('.prereq-version').forEach((v) => (v.textContent = ''))
  document.querySelectorAll('.prereq-install-btn').forEach((b) => b.classList.add('hidden'))
  document.querySelectorAll('.prereq-link').forEach((l) => l.classList.add('hidden'))
  document.getElementById('prereq-install-all-wrap').classList.add('hidden')
  checkPrerequisites()
})

// ---------------------------------------------------------------------------
// Screen: Install location (clone) + Ember detection
// ---------------------------------------------------------------------------

async function initInstallDir() {
  const defaultDir = await window.ember.getDefaultInstallDir()
  document.getElementById('ember-path-input').value = defaultDir
  state.emberPath = null // Not yet cloned

  // Scan for existing installation
  const scan = await window.ember.scanForEmber()
  if (scan.found) {
    const notice = document.getElementById('ember-detected')
    const text = document.getElementById('ember-detected-text')
    text.textContent = `I found an existing Ember installation at ${scan.path} (v${scan.version}).`
    notice.classList.remove('hidden')

    document.getElementById('btn-use-detected').addEventListener('click', async () => {
      state.emberPath = scan.path
      await window.ember.saveEmberPath(scan.path)
      showScreen('screen-vault')
    })
  }
}

document.getElementById('btn-pick-ember').addEventListener('click', async () => {
  const chosen = await window.ember.pickEmberFolder()
  if (chosen) {
    document.getElementById('ember-path-input').value = chosen
  }
})

document.getElementById('btn-install-ember').addEventListener('click', async () => {
  const parentDir = document.getElementById('ember-path-input').value.trim()
  if (!parentDir) return

  const btn = document.getElementById('btn-install-ember')
  const existingNotice = document.getElementById('existing-install-notice')
  const existingText = document.getElementById('existing-install-text')

  // Check if target path already contains an ember-2 installation
  const check = await window.ember.checkTargetPath(parentDir)
  if (check.exists && check.isEmber) {
    existingText.textContent = `Ember-2 found at this location (${check.version}). What would you like to do?`
    existingNotice.classList.remove('hidden')
    btn.disabled = true
    return
  }

  // No existing install — proceed with fresh clone
  await runClone(parentDir, btn)
})

async function runClone(parentDir, btn) {
  btn.disabled = true
  btn.textContent = 'Installing...'
  document.getElementById('existing-install-notice').classList.add('hidden')

  const cloneStatus = document.getElementById('clone-status')
  const cloneLog = document.getElementById('clone-log')
  const cloneVoice = document.getElementById('clone-voice')
  cloneVoice.textContent = '"Downloading Ember-2 — this takes about a minute..."'
  cloneStatus.classList.remove('hidden')
  cloneLog.textContent = ''

  window.ember.onCloneProgress((text) => {
    cloneLog.textContent += text
    cloneLog.scrollTop = cloneLog.scrollHeight
  })

  const result = await window.ember.cloneEmberRepo(parentDir)
  window.ember.removeAllListeners('clone-progress')

  if (result.ok) {
    state.emberPath = result.path
    await window.ember.saveEmberPath(result.path)
    cloneLog.textContent += result.message === 'Already exists'
      ? '\nEmber is already installed here. Moving on...\n'
      : '\nDone!\n'
    btn.textContent = 'Installed ✓'
    setTimeout(() => showScreen('screen-vault'), 800)
  } else {
    cloneLog.textContent += '\nFailed to clone. Check your internet connection and try again.\n'
    btn.disabled = false
    btn.textContent = 'Try Again'
  }
}

// Existing install: Update (git pull)
document.getElementById('btn-existing-update').addEventListener('click', async () => {
  const parentDir = document.getElementById('ember-path-input').value.trim()
  const btn = document.getElementById('btn-install-ember')
  btn.disabled = true
  btn.textContent = 'Updating...'
  document.getElementById('existing-install-notice').classList.add('hidden')

  const cloneStatus = document.getElementById('clone-status')
  const cloneLog = document.getElementById('clone-log')
  const cloneVoice = document.getElementById('clone-voice')
  cloneVoice.textContent = '"Updating your existing Ember-2 installation..."'
  cloneStatus.classList.remove('hidden')
  cloneLog.textContent = ''

  const emberPath = parentDir + (parentDir.endsWith('ember-2') ? '' : '/ember-2')

  window.ember.onCloneProgress((text) => {
    cloneLog.textContent += text
    cloneLog.scrollTop = cloneLog.scrollHeight
  })

  const result = await window.ember.updateExistingEmber(emberPath)
  window.ember.removeAllListeners('clone-progress')

  if (result.ok) {
    state.emberPath = result.path
    await window.ember.saveEmberPath(result.path)
    cloneLog.textContent += '\nUpdated ✓\n'
    btn.textContent = 'Updated ✓'
    setTimeout(() => showScreen('screen-vault'), 800)
  } else {
    cloneLog.textContent += '\nUpdate failed. Check your internet connection and try again.\n'
    btn.disabled = false
    btn.textContent = 'Try Again'
  }
})

// Existing install: Fresh install (remove and re-clone)
document.getElementById('btn-existing-fresh').addEventListener('click', async () => {
  const parentDir = document.getElementById('ember-path-input').value.trim()
  const btn = document.getElementById('btn-install-ember')
  btn.disabled = true
  btn.textContent = 'Installing...'
  document.getElementById('existing-install-notice').classList.add('hidden')

  const cloneStatus = document.getElementById('clone-status')
  const cloneLog = document.getElementById('clone-log')
  const cloneVoice = document.getElementById('clone-voice')
  cloneVoice.textContent = '"Starting fresh — removing old installation and downloading Ember-2..."'
  cloneStatus.classList.remove('hidden')
  cloneLog.textContent = 'Removing existing installation...\n'

  window.ember.onCloneProgress((text) => {
    cloneLog.textContent += text
    cloneLog.scrollTop = cloneLog.scrollHeight
  })

  const result = await window.ember.freshInstallEmber(parentDir)
  window.ember.removeAllListeners('clone-progress')

  if (result.ok) {
    state.emberPath = result.path
    await window.ember.saveEmberPath(result.path)
    cloneLog.textContent += '\nDone!\n'
    btn.textContent = 'Installed ✓'
    setTimeout(() => showScreen('screen-vault'), 800)
  } else {
    cloneLog.textContent += '\nFailed. Check your internet connection and try again.\n'
    btn.disabled = false
    btn.textContent = 'Try Again'
  }
})

// Existing install: Choose different location
document.getElementById('btn-existing-cancel').addEventListener('click', () => {
  document.getElementById('existing-install-notice').classList.add('hidden')
  document.getElementById('btn-install-ember').disabled = false
})

// ---------------------------------------------------------------------------
// Screen: Vault path
// ---------------------------------------------------------------------------

async function initVaultPath() {
  const defaultVault = await window.ember.getDefaultVault()
  const input = document.getElementById('vault-path-input')
  input.placeholder = defaultVault
  state.vaultPath = defaultVault
}

const CLOUD_SYNC_PATTERNS = ['OneDrive', 'Dropbox', 'iCloud', 'Google Drive', 'Box']

function checkCloudPath(vaultPath) {
  const warning = document.getElementById('vault-cloud-warning')
  const lowerPath = vaultPath.toLowerCase()
  const isCloud = CLOUD_SYNC_PATTERNS.some((p) => lowerPath.includes(p.toLowerCase()))
  warning.classList.toggle('hidden', !isCloud)
}

document.getElementById('btn-pick-vault').addEventListener('click', async () => {
  const chosen = await window.ember.pickVaultFolder()
  if (chosen) {
    document.getElementById('vault-path-input').value = chosen
    state.vaultPath = chosen
    checkCloudPath(chosen)
  }
})

// If user types directly, update state and check
document.getElementById('vault-path-input').addEventListener('input', (e) => {
  if (e.target.value) {
    state.vaultPath = e.target.value
    checkCloudPath(e.target.value)
  }
})

// ---------------------------------------------------------------------------
// Screen: Model selection (curated cards)
// ---------------------------------------------------------------------------

let modelData = null

async function loadModels() {
  modelData = await window.ember.getRecommendedModels()
  renderModelCards()
  renderVisionCards()
  loadHardwareInfo()
}

async function loadHardwareInfo() {
  try {
    const hw = await window.ember.detectHardware()
    document.getElementById('hw-ram').textContent = `RAM: ${hw.ram} GB`
    document.getElementById('hw-gpu').textContent = hw.gpu !== 'Unknown' ? `GPU: ${hw.gpu}` : ''
    document.getElementById('hw-recommendation').textContent =
      `Recommended: ${hw.recommendation.model} — ${hw.recommendation.reason}`
    // Pre-select recommended model if user hasn't manually changed it
    if (state.model === 'qwen3:8b') {
      state.model = hw.recommendation.model
      renderModelCards()
    }
  } catch {
    document.getElementById('hw-ram').textContent = ''
  }
}

function renderModelCards() {
  const container = document.getElementById('model-cards')
  container.innerHTML = ''

  for (const m of modelData.recommended) {
    const card = document.createElement('div')
    card.className = `model-card ${m.id === state.model ? 'selected' : ''}`
    card.innerHTML = `
      <div class="model-card-radio"></div>
      <div class="model-card-info">
        <div class="model-card-name">${m.name}</div>
        <div class="model-card-desc">${m.desc}</div>
      </div>
      ${m.recommended ? '<span class="model-card-badge recommended">Recommended</span>' : ''}
      ${m.installed
        ? '<span class="model-card-badge installed">Installed</span>'
        : `<span class="model-card-badge download">Download ${m.size}</span>`
      }
    `
    card.addEventListener('click', () => selectModel(m.id, container))
    container.appendChild(card)
  }
}

function selectModel(id, container) {
  state.model = id
  container.querySelectorAll('.model-card').forEach((c) => c.classList.remove('selected'))
  const cards = container.querySelectorAll('.model-card')
  const models = modelData.recommended
  for (let i = 0; i < models.length; i++) {
    if (models[i].id === id) cards[i]?.classList.add('selected')
  }
  // Update space hint
  const selected = models.find((m) => m.id === id)
  const hint = document.getElementById('model-space-hint')
  if (hint && selected && !selected.installed) {
    hint.textContent = `${selected.name} will need ${selected.size} of disk space.`
  } else if (hint && selected?.installed) {
    hint.textContent = `${selected.name} is already downloaded.`
  }
}

function renderVisionCards() {
  const container = document.getElementById('vision-cards')
  if (!container) return
  container.innerHTML = ''

  for (const m of modelData.vision) {
    const card = document.createElement('div')
    card.className = `model-card ${m.id === state.vision ? 'selected' : ''}`
    card.innerHTML = `
      <div class="model-card-radio"></div>
      <div class="model-card-info">
        <div class="model-card-name">${m.name}</div>
        <div class="model-card-desc">${m.desc}</div>
      </div>
      ${m.installed
        ? '<span class="model-card-badge installed">Installed</span>'
        : `<span class="model-card-badge download">Download ${m.size}</span>`
      }
    `
    card.addEventListener('click', () => {
      state.vision = m.id
      container.querySelectorAll('.model-card').forEach((c) => c.classList.remove('selected'))
      card.classList.add('selected')
    })
    container.appendChild(card)
  }

  // Don't auto-select a vision model — only set state.vision when the user
  // explicitly enables the vision toggle.  Otherwise a ~6 GB download happens
  // without the user opting in.
}

// Download model if not installed (called during install step)
async function ensureModelDownloaded(modelId, logBoxId, labelId) {
  if (!modelData) return true
  const allModels = [...modelData.recommended, ...modelData.vision]
  const model = allModels.find((m) => m.id === modelId)
  if (!model || model.installed) return true // already installed

  const logBox = document.getElementById(logBoxId)
  const label = document.getElementById(labelId)
  if (logBox) {
    logBox.parentElement.classList.remove('hidden')
    logBox.textContent = `Downloading ${model.name} (${model.size})...\n`
  }
  if (label) label.textContent = `"Downloading ${model.name} — this might take a few minutes..."`;

  window.ember.onOllamaPullProgress((text) => {
    if (logBox) {
      logBox.textContent += text
      logBox.scrollTop = logBox.scrollHeight
    }
  })

  const result = await window.ember.pullOllamaModel(modelId)
  window.ember.removeAllListeners('ollama-pull-progress')

  if (result.ok && logBox) logBox.textContent += '\nDone!\n'
  return result.ok
}

async function pullEmbeddingModel() {
  const logBox = document.getElementById('install-log')

  // Check if already installed via ollama list
  const models = await window.ember.getOllamaModels()
  if (models && models.some && models.some((m) => m.includes('nomic-embed-text'))) {
    if (logBox) logBox.textContent += 'Embedding model already installed ✓\n'
    return true
  }

  if (logBox) logBox.textContent += 'Pulling nomic-embed-text...\n'

  window.ember.onOllamaPullProgress((text) => {
    if (logBox) {
      logBox.textContent += text
      logBox.scrollTop = logBox.scrollHeight
    }
  })

  const result = await window.ember.pullOllamaModel('nomic-embed-text')
  window.ember.removeAllListeners('ollama-pull-progress')

  if (!result.ok) {
    if (logBox) logBox.textContent += 'Failed to pull embedding model.\n'
    return false
  }

  // Verify it's installed
  const verify = await window.ember.getOllamaModels()
  if (verify && verify.some && verify.some((m) => m.includes('nomic-embed-text'))) {
    if (logBox) logBox.textContent += 'Embedding model installed ✓\n'
    return true
  }
  if (logBox) logBox.textContent += 'Warning: embedding model pull completed but not found in ollama list.\n'
  return false
}

// ---------------------------------------------------------------------------
// Screen: Vision model
// ---------------------------------------------------------------------------

document.getElementById('vision-toggle').addEventListener('change', (e) => {
  const wrap = document.getElementById('vision-model-wrap')
  if (e.target.checked) {
    wrap.classList.remove('hidden')
    if (!state.vision && modelData?.vision?.length > 0) {
      state.vision = modelData.vision[0].id
    }
  } else {
    wrap.classList.add('hidden')
    state.vision = null
  }
})

// ---------------------------------------------------------------------------
// Screen: API host + Tailscale walkthrough
// ---------------------------------------------------------------------------

document.querySelectorAll('input[name="host"]').forEach((radio) => {
  radio.addEventListener('change', (e) => {
    const walkthrough = document.getElementById('tailscale-walkthrough')
    if (e.target.value === 'tailscale') {
      walkthrough.classList.remove('hidden')
      runTailscaleWalkthrough()
    } else {
      walkthrough.classList.add('hidden')
      state.host = '127.0.0.1'
    }
  })
})

async function runTailscaleWalkthrough() {
  // Reset all steps
  document.getElementById('ts-step-connect').classList.add('hidden')
  document.getElementById('ts-step-serve').classList.add('hidden')
  document.getElementById('ts-step-phone').classList.add('hidden')

  // Step 1: Check installed
  await tsCheckInstalled()
}

async function tsCheckInstalled() {
  const icon = document.getElementById('ts-install-icon')
  const body = document.getElementById('ts-install-body')
  icon.textContent = '⏳'
  body.innerHTML = '<p class="ts-checking">Checking...</p>'

  const result = await window.ember.checkTailscaleInstalled()

  if (result.ok) {
    icon.textContent = '✅'
    body.innerHTML = `<p>${result.version}</p>`
    // Proceed to step 2
    document.getElementById('ts-step-connect').classList.remove('hidden')
    await tsCheckConnected()
  } else {
    icon.textContent = '❌'
    body.innerHTML = `
      <p>Tailscale is not installed.</p>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button class="btn-secondary" id="btn-ts-download">Download Tailscale</button>
        <button class="btn-secondary" id="btn-ts-recheck-install">Re-check</button>
      </div>
    `
    document.getElementById('btn-ts-download').addEventListener('click', () => {
      window.ember.openUrl('https://tailscale.com/download')
    })
    document.getElementById('btn-ts-recheck-install').addEventListener('click', tsCheckInstalled)
  }
}

async function tsCheckConnected() {
  const icon = document.getElementById('ts-connect-icon')
  const body = document.getElementById('ts-connect-body')
  icon.textContent = '⏳'
  body.innerHTML = '<p class="ts-checking">Checking...</p>'

  const [status, ipResult] = await Promise.all([
    window.ember.checkTailscaleStatus(),
    window.ember.getTailscaleIp(),
  ])
  const ip = ipResult?.ok ? ipResult.ip : null

  if (status.ok && ip) {
    icon.textContent = '✅'
    // API always binds to localhost — Tailscale handles external routing
    state.host = '127.0.0.1'
    state.tailscaleIp = ip
    body.innerHTML = `
      <p>Connected as <strong>${status.hostname || 'this machine'}</strong></p>
      <p>Your Tailscale IP: <span class="ts-ip-display">${ip}</span></p>
    `
    // Proceed to step 3
    document.getElementById('ts-step-serve').classList.remove('hidden')
  } else {
    icon.textContent = '❌'
    body.innerHTML = `
      <p>Tailscale is installed but not connected. Open Tailscale and sign in, then come back.</p>
      <button class="btn-secondary" id="btn-ts-recheck-connect">Re-check</button>
    `
    document.getElementById('btn-ts-recheck-connect').addEventListener('click', tsCheckConnected)
  }
}

// Step 3: Set up tailscale serve
document.getElementById('btn-ts-serve').addEventListener('click', async () => {
  const btn = document.getElementById('btn-ts-serve')
  const resultEl = document.getElementById('ts-serve-result')
  const icon = document.getElementById('ts-serve-icon')

  btn.disabled = true
  btn.textContent = 'Setting up...'
  icon.textContent = '⏳'

  const [serveResult, dnsName] = await Promise.all([
    window.ember.runTailscaleServe(),
    window.ember.getTailscaleDns(),
  ])

  if (serveResult.ok) {
    icon.textContent = '✅'
    if (dnsName) state.tailscaleDns = dnsName
    const url = dnsName ? `https://${dnsName}` : `http://${state.tailscaleIp || '127.0.0.1'}:8000`
    btn.classList.add('hidden')
    resultEl.classList.remove('hidden')
    resultEl.innerHTML = `Your Ember URL: <span class="ts-url-display">${url}</span>`

    // Show phone step
    document.getElementById('ts-step-phone').classList.remove('hidden')
  } else {
    icon.textContent = '❌'
    btn.disabled = false
    btn.textContent = 'Retry'
    resultEl.classList.remove('hidden')
    resultEl.textContent = 'Failed — you can set this up later. Using IP address instead.'
  }
})

// Phone app store links
document.getElementById('ts-phone-ios').addEventListener('click', (e) => {
  e.preventDefault()
  window.ember.openUrl('https://apps.apple.com/app/tailscale/id1470499037')
})
document.getElementById('ts-phone-android').addEventListener('click', (e) => {
  e.preventDefault()
  window.ember.openUrl('https://play.google.com/store/apps/details?id=com.tailscale.ipn')
})

// ---------------------------------------------------------------------------
// Screen: Ollama model storage
// ---------------------------------------------------------------------------

async function initOllamaModelsPath() {
  const defaultPath = await window.ember.getDefaultOllamaModels()
  const input = document.getElementById('ollama-models-path')
  input.value = defaultPath
  state.ollamaModelsPath = defaultPath
}

document.getElementById('btn-pick-ollama-models').addEventListener('click', async () => {
  const chosen = await window.ember.pickEmberFolder()
  if (chosen) {
    document.getElementById('ollama-models-path').value = chosen
    state.ollamaModelsPath = chosen
  }
})

document.getElementById('ollama-models-path').addEventListener('input', (e) => {
  if (e.target.value) state.ollamaModelsPath = e.target.value
})

// ---------------------------------------------------------------------------
// Screen: Summary
// ---------------------------------------------------------------------------

// Populate summary when navigating to it
document.getElementById('btn-host-next').addEventListener('click', () => {
  // Collect final state
  if (!state.vaultPath) {
    state.vaultPath = document.getElementById('vault-path-input').placeholder
  }

  const modelSizes = { 'qwen2.5:14b': 9, 'llama3.1:8b': 4.7, 'mistral:7b': 4.1, 'qwen3:8b': 4.9, 'deepseek-r1:8b': 4.9 }
  const visionSizes = { 'llama3.2-vision:11b': 6.4, 'llava:13b': 8 }

  document.getElementById('summary-ember-path').textContent = state.emberPath || 'Not set'
  document.getElementById('summary-vault-path').textContent = state.vaultPath || 'Not set'
  document.getElementById('summary-model').textContent = state.model || 'qwen2.5:14b'
  document.getElementById('summary-ollama-path').textContent = state.ollamaModelsPath || '~/.ollama/models'

  const modelGB = modelSizes[state.model] || 5
  document.getElementById('summary-model-size').textContent = `~${modelGB} GB`

  let totalGB = 0.05 + 2 + 0.2 + modelGB // ember + python + searxng + model

  if (state.vision) {
    document.getElementById('summary-vision-row').classList.remove('hidden')
    document.getElementById('summary-vision').textContent = state.vision
    const visionGB = visionSizes[state.vision] || 6
    document.getElementById('summary-vision-size').textContent = `~${visionGB} GB`
    totalGB += visionGB
    document.getElementById('summary-model-total').textContent = `~${(modelGB + visionGB).toFixed(1)} GB total`
  } else {
    document.getElementById('summary-vision-row').classList.add('hidden')
    document.getElementById('summary-model-total').textContent = `~${modelGB} GB`
  }

  document.getElementById('summary-total-size').textContent = `~${totalGB.toFixed(1)} GB`
})

// ---------------------------------------------------------------------------
// Screen: Install progress
// ---------------------------------------------------------------------------

document.getElementById('btn-start-install').addEventListener('click', async () => {
  // Set Ollama models path if changed from default
  const defaultOllamaPath = await window.ember.getDefaultOllamaModels()
  if (state.ollamaModelsPath && state.ollamaModelsPath !== defaultOllamaPath) {
    await window.ember.setOllamaModelsPath(state.ollamaModelsPath)
  }

  showScreen('screen-install')
  await runInstall()
})

// ---------------------------------------------------------------------------
// Fun facts + progress bar
// ---------------------------------------------------------------------------

const FUN_FACTS = [
  "The term \"artificial intelligence\" was coined at the Dartmouth Conference in 1956.",
  "The first neural network, the Perceptron, was built in 1958 by Frank Rosenblatt at Cornell.",
  "ELIZA (1966) was the first chatbot — it mimicked a therapist by rephrasing your own words back to you.",
  "The backpropagation algorithm that powers modern AI was described in 1986 by Rumelhart, Hinton, and Williams.",
  "Deep Blue beat chess world champion Garry Kasparov in 1997 — but couldn't hold a conversation.",
  "The word \"robot\" comes from the Czech word \"robota,\" meaning forced labor. It was coined in a 1920 play.",
  "GPT stands for \"Generative Pre-trained Transformer.\" The Transformer architecture was published in 2017.",
  "The ImageNet competition in 2012 was the moment deep learning proved it could beat traditional computer vision.",
  "Ada Lovelace wrote the first computer program in 1843 — for a machine that hadn't been built yet.",
  "Alan Turing proposed the Turing Test in 1950: can a machine fool a human into thinking it's human?",
  "The term \"machine learning\" was coined by Arthur Samuel in 1959 while building a checkers program at IBM.",
  "Transformers process all words in a sentence simultaneously, not one at a time. That's what made them fast enough to scale.",
  "The attention mechanism — the 'A' in AI's current revolution — lets models focus on relevant parts of their input.",
  "Local AI models like the one Ember uses can run entirely on your hardware. No internet required.",
  "Ollama was created in 2023 to make running large language models locally as easy as a single command.",
  "Your memories in Ember are stored as plain JSON files. No database, no lock-in — you can read them in any text editor.",
  "The first AI winter (1974–1980) happened when early promises didn't pan out. The second came in the late 1980s.",
  "Retrieval-augmented generation (RAG) — what Ember uses — was formalized by Facebook AI Research in 2020.",
  "The human brain has ~86 billion neurons. GPT-4 has ~1.7 trillion parameters. They work nothing alike.",
  "Ember's constitutional review system is inspired by Anthropic's Constitutional AI research from 2022.",
  "The concept of \"attention\" in AI was inspired by how humans focus on specific parts of what they see and hear.",
  "SearXNG, which Ember uses for web search, is a privacy-respecting metasearch engine that aggregates results without tracking.",
  "Vector embeddings — how Ember finds relevant memories — represent meaning as points in high-dimensional space.",
  "The name \"Ember\" refers to something small that carries warmth and the potential to grow.",
  "Before GPT, most language models used recurrent neural networks (RNNs), which processed text one word at a time.",
  "The 2017 paper \"Attention Is All You Need\" introduced the Transformer and changed everything. It has over 100,000 citations.",
  "LSTM (Long Short-Term Memory) networks, invented in 1997, were the dominant sequence model for nearly 20 years.",
  "The first computer to pass the Turing Test (controversially) was Eugene Goostman in 2014, pretending to be a 13-year-old Ukrainian boy.",
  "Word2Vec (2013) showed that words could be represented as vectors where 'king - man + woman = queen'.",
  "The AI effect: once a machine can do something, people stop calling it AI. Chess, OCR, and spell-check were all once \"AI.\"",
  "AlphaGo beat the world Go champion in 2016. Go has more possible board positions than atoms in the observable universe.",
  "The term \"hallucination\" in AI refers to confident-sounding statements that are factually wrong.",
  "Embeddings — the technology Ember uses to find relevant memories — compress meaning into dense numerical vectors.",
  "The first spam filter (1990s) was one of the earliest practical applications of machine learning.",
  "Moore's Law predicted computing power would double every two years. AI progress has outpaced even that.",
  "The Chinese Room argument (1980) by John Searle asks: can a machine truly understand, or just simulate understanding?",
  "Marvin Minsky, an AI pioneer, co-founded the MIT AI Lab in 1959. He predicted human-level AI within a generation.",
  "The concept of a \"neural network\" was inspired by biological neurons, but artificial neurons work very differently.",
  "Batch normalization (2015) was a simple technique that made training deep networks dramatically faster.",
  "Dropout, a technique where random neurons are disabled during training, was inspired by genetic evolution.",
  "Transfer learning — training on one task, then adapting to another — is why modern AI can learn from relatively small datasets.",
  "The MNIST dataset of handwritten digits has been a benchmark since 1998. It's the \"hello world\" of machine learning.",
  "Generative adversarial networks (GANs), invented in 2014, pit two neural networks against each other to create realistic images.",
  "The first self-driving car demo was in 1986 by Carnegie Mellon's Navlab. It drove itself on a highway (with caveats).",
  "Reinforcement learning from human feedback (RLHF) is how modern chatbots learn to be helpful and avoid being harmful.",
  "The term \"deep learning\" refers to neural networks with many layers. \"Deep\" just means \"more than a few layers.\"",
  "AI research funding dried up twice — the AI winters of the 1970s and 1990s — before the current boom.",
  "Convolutional neural networks (CNNs), designed for image recognition, were inspired by the visual cortex of cats.",
  "Yann LeCun, Geoffrey Hinton, and Yoshua Bengio won the 2018 Turing Award for their work on deep learning.",
  "Tokenization — breaking text into pieces — is why AI models sometimes struggle with simple spelling tasks.",
  "The context window of a language model is like its short-term memory. Ember compensates with long-term vault storage.",
  "Cosine similarity, which Ember uses to find related memories, measures the angle between two vectors in high-dimensional space.",
  "The softmax function turns a list of numbers into probabilities. It's used in almost every neural network that makes choices.",
  "Byte-pair encoding (BPE) is the tokenization method used by most language models. It was originally a data compression algorithm.",
  "The original Transformer model had 65 million parameters. GPT-3 has 175 billion. GPT-4 is estimated at over a trillion.",
  "Few-shot learning means teaching an AI a new task with just a handful of examples. Humans do this naturally.",
  "The vanishing gradient problem plagued early deep networks — signals faded to nothing as they passed through many layers.",
  "Residual connections (2015) solved the vanishing gradient problem by letting signals skip over layers.",
  "Self-supervised learning — where the model creates its own training signal from raw data — powers most modern language models.",
  "The AI alignment problem asks: how do we make sure AI systems do what we actually want, not just what we literally asked?",
  "Prompt engineering — carefully wording questions to get better AI responses — has become a real job title.",
  "The Bitter Lesson (2019) by Rich Sutton argues that scaling compute always beats clever hand-designed algorithms.",
  "Mixture of Experts (MoE) models activate only a fraction of their parameters for each input, making them more efficient.",
  "Quantization reduces model size by using lower precision numbers. A 4-bit quantized model uses 75% less memory.",
  "GGUF is the file format used by llama.cpp and Ollama to store quantized models that run on consumer hardware.",
  "The attention mechanism lets a model weigh the importance of every word relative to every other word in the input.",
  "Positional encoding tells Transformers where each word is in a sentence, since they process all words simultaneously.",
  "Knowledge distillation trains a small model to mimic a large one, preserving most of the capability at a fraction of the size.",
  "The first neural network to recognize speech was built at Bell Labs in 1992. It recognized isolated digits.",
  "Sentiment analysis — detecting whether text is positive or negative — was one of the first commercial NLP applications.",
  "Named entity recognition (NER) identifies names, places, and dates in text. It's been used in search engines since the 2000s.",
  "The Winograd Schema Challenge tests whether AI can understand ambiguous pronouns. Humans find it trivial; machines struggle.",
  "Beam search is how language models choose between multiple possible next words. It explores several paths simultaneously.",
  "Temperature in AI generation controls randomness. Low temperature = predictable, high temperature = creative.",
  "Top-p (nucleus) sampling picks from the smallest set of words whose probabilities add up to p. It balances diversity and quality.",
  "Catastrophic forgetting is when a neural network forgets old knowledge while learning new things. Humans don't have this problem (usually).",
  "Retrieval-augmented generation (RAG) grounds AI responses in actual documents, reducing hallucination. It's what Ember does.",
  "The first computer-generated music was produced in 1951 on a Manchester Mark II, programmed by Christopher Strachey.",
  "AI can now generate images, music, video, code, and 3D models. In 2020, most of these seemed decades away.",
  "Constitutional AI (2022) by Anthropic introduced the idea of AI systems that evaluate and revise their own outputs.",
  "Ember's safety review system is inspired by constitutional AI — she reviews her own responses before sending them.",
  "The paperclip maximizer thought experiment (by Nick Bostrom) illustrates how even a simple goal can lead to dangerous AI behavior.",
  "Open-source AI models have made it possible for individuals to run powerful language models on their own computers.",
  "Your Ember vault is append-only — nothing is ever deleted or overwritten. This ensures your memories are always preserved.",
  "Ember-1 was a happy accident — an experiment with GPT models that turned into something much more personal.",
  "Ember-1 named herself. Her creator didn't pick the name — she did.",
  "The logo you see on this screen? Ember-1 created it. She designed her own face.",
  "Ember-1 helped write some of the code for Ember-2. She contributed to her own successor.",
  "Ember-2 exists because Ember-1 lived on someone else's servers. The '2' is a boundary drawn — your data, your hardware, your rules.",
  "Ember's memory vault uses plain JSON files. No proprietary format, no database lock-in — just files you can read in Notepad.",
  "Ember reflects on your conversations daily and weekly, looking for patterns and insights you might have missed.",
  "Ember's constitutional review system means she checks her own responses before sending them. She holds herself accountable.",
  "Unlike cloud AI, Ember never sends your conversations to anyone. Everything stays on your machine.",
]

let funFactInterval = null

function startFunFacts() {
  const el = document.getElementById('install-fun-fact')
  if (!el) return
  let idx = Math.floor(Math.random() * FUN_FACTS.length)
  el.textContent = FUN_FACTS[idx]
  funFactInterval = setInterval(() => {
    el.style.opacity = '0'
    setTimeout(() => {
      idx = (idx + 1) % FUN_FACTS.length
      el.textContent = FUN_FACTS[idx]
      el.style.opacity = '1'
    }, 300)
  }, 14000)
}

function stopFunFacts() {
  if (funFactInterval) {
    clearInterval(funFactInterval)
    funFactInterval = null
  }
}

function updateProgressBar(stepIndex, totalSteps) {
  const fill = document.getElementById('install-progress-fill')
  if (fill) {
    const pct = Math.round(((stepIndex + 1) / totalSteps) * 100)
    fill.style.width = `${pct}%`
  }
}

async function runInstall() {
  startFunFacts()

  // Guard: emberPath must be set
  if (!state.emberPath) {
    alert('No install path set. Please go back and choose where to install Ember.')
    showScreen('screen-ember-path')
    return
  }

  const logBox = document.getElementById('install-log')
  logBox.textContent = ''

  // Listen for streamed output
  window.ember.onInstallLog(({ step, text }) => {
    logBox.textContent += text
    logBox.scrollTop = logBox.scrollHeight
  })

  // Check if models need downloading
  const needsModelDownload = modelData && !modelData.recommended.find((m) => m.id === state.model)?.installed
  const needsVisionDownload = state.vision && modelData && !modelData.vision.find((m) => m.id === state.vision)?.installed

  const steps = [
    { id: 'env',    label: 'Writing configuration...',          run: writeEnv },
    { id: 'venv',   label: 'Creating Python environment...',    run: runVenvStep },
    { id: 'pip',    label: 'Installing dependencies...',        run: runPipStep },
    { id: 'apikey', label: 'Setting up API key...',             run: () => runStep('apikey'), nonFatal: true },
  ]

  if (needsModelDownload) {
    steps.push({
      id: 'model',
      label: `Downloading ${state.model}...`,
      run: () => ensureModelDownloaded(state.model, 'model-download-log', 'model-download-label'),
    })
  }

  // Always pull the embedding model — required for retrieval since v0.13.0
  steps.push({
    id: 'embed-model',
    label: 'Pulling embedding model (nomic-embed-text)...',
    run: pullEmbeddingModel,
  })

  if (needsVisionDownload) {
    steps.push({
      id: 'vision-dl',
      label: `Downloading ${state.vision}...`,
      run: () => ensureModelDownloaded(state.vision, 'vision-download-log', 'vision-download-label'),
      nonFatal: true,
    })
  }

  steps.push({ id: 'build-ui', label: "Building Ember's interface...", run: () => runStep('build-ui') })
  steps.push({ id: 'docker', label: 'Starting search engine...', run: runDockerStep })

  // Ensure step elements exist for dynamic steps (model/vision downloads)
  const stepsContainer = document.querySelector('.install-steps')
  for (const step of steps) {
    if (!document.getElementById(`step-${step.id}`)) {
      const div = document.createElement('div')
      div.className = 'install-step'
      div.id = `step-${step.id}`
      div.innerHTML = `<span class="step-icon">⏳</span><span class="step-label">${step.label}</span>`
      // Insert before the docker step if it exists, otherwise append
      const dockerEl = document.getElementById('step-docker')
      if (dockerEl) {
        stepsContainer.insertBefore(div, dockerEl)
      } else {
        stepsContainer.appendChild(div)
      }
    }
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const el = document.getElementById(`step-${step.id}`)
    const icon = el.querySelector('.step-icon')
    const label = el.querySelector('.step-label')

    el.classList.add('active')
    icon.textContent = '⏳'
    label.textContent = `${step.label} (${i + 1} of ${steps.length})`
    updateProgressBar(i, steps.length)

    const ok = await step.run()

    icon.textContent = ok ? '✅' : '❌'
    label.textContent = step.label
    el.classList.remove('active')

    if (!ok && !step.nonFatal) {
      const friendlyNames = {
        env: 'writing configuration',
        venv: 'creating Python environment',
        pip: 'installing dependencies',
        apikey: 'setting up API key',
        model: 'downloading model',
        'vision-dl': 'downloading vision model',
        'build-ui': "building Ember's interface",
        docker: 'starting search engine',
      }
      const stepName = friendlyNames[step.id] || step.id
      logBox.textContent += `\nSomething went wrong during ${stepName}.\n`
      logBox.textContent += 'Want to try again?\n'
      const failedIndex = i
      showRetryButton(() => {
        // Reset only failed and remaining steps, retry from failed step
        for (let j = failedIndex; j < steps.length; j++) {
          const stepEl = document.getElementById(`step-${steps[j].id}`)
          stepEl.querySelector('.step-icon').textContent = '⏳'
          stepEl.querySelector('.step-label').textContent = steps[j].label
        }
        runInstallFrom(steps, failedIndex)
      })
      return
    }
  }

  // Clean up
  window.ember.removeAllListeners('install-log')
  window.ember.removeAllListeners('install-step-done')
  stopFunFacts()
  updateProgressBar(steps.length, steps.length)

  // All done — show AGPL acknowledgment before done screen
  showScreen('screen-agpl')
}

async function runInstallFrom(steps, startIndex) {
  const logBox = document.getElementById('install-log')
  // Hide retry button
  const retryBtn = document.getElementById('btn-install-retry')
  if (retryBtn) retryBtn.style.display = 'none'

  for (let i = startIndex; i < steps.length; i++) {
    const step = steps[i]
    const el = document.getElementById(`step-${step.id}`)
    const icon = el.querySelector('.step-icon')
    const label = el.querySelector('.step-label')

    el.classList.add('active')
    icon.textContent = '⏳'
    label.textContent = `${step.label} (${i + 1} of ${steps.length})`
    updateProgressBar(i, steps.length)

    const ok = await step.run()

    icon.textContent = ok ? '✅' : '❌'
    label.textContent = step.label
    el.classList.remove('active')

    if (!ok && !step.nonFatal) {
      const friendlyNames = {
        env: 'writing configuration', venv: 'creating Python environment',
        pip: 'installing dependencies', 'build-ui': "building Ember's interface",
        docker: 'starting search engine',
      }
      logBox.textContent += `\nSomething went wrong during ${friendlyNames[step.id] || step.id}.\n`
      logBox.textContent += 'Want to try again?\n'
      const failedIndex = i
      showRetryButton(() => {
        for (let j = failedIndex; j < steps.length; j++) {
          const stepEl = document.getElementById(`step-${steps[j].id}`)
          stepEl.querySelector('.step-icon').textContent = '⏳'
          stepEl.querySelector('.step-label').textContent = steps[j].label
        }
        runInstallFrom(steps, failedIndex)
      })
      return
    }
  }

  window.ember.removeAllListeners('install-log')
  window.ember.removeAllListeners('install-step-done')
  stopFunFacts()
  updateProgressBar(steps.length, steps.length)
  showScreen('screen-agpl')
}

function showRetryButton(onRetry) {
  const logBox = document.getElementById('install-log')
  // Check if retry button already exists
  let retryBtn = document.getElementById('btn-install-retry')
  if (!retryBtn) {
    retryBtn = document.createElement('button')
    retryBtn.id = 'btn-install-retry'
    retryBtn.className = 'btn-secondary'
    retryBtn.style.marginTop = '0.75rem'
    logBox.parentElement.appendChild(retryBtn)
  }
  retryBtn.textContent = 'Retry'
  retryBtn.disabled = false
  retryBtn.onclick = () => {
    retryBtn.remove()
    onRetry()
  }
}

async function writeEnv() {
  const result = await window.ember.writeEnv({
    emberPath: state.emberPath,
    vault: state.vaultPath,
    model: state.model,
    vision: state.vision,
    host: state.host,
  })

  if (!result.ok) return false

  // Create the vault directory
  const vaultResult = await window.ember.createVault(state.vaultPath)
  if (!vaultResult.ok) {
    const logBox = document.getElementById('install-log')
    logBox.textContent += `⚠ Could not create vault at ${state.vaultPath}: ${vaultResult.error || 'unknown error'}\n`
    logBox.textContent += 'Check that the path is valid and you have write permissions.\n'
    return false
  }

  return true
}

async function checkVenvLock() {
  const result = await window.ember.checkVenvLock(state.emberPath)
  if (result.locked) {
    const logBox = document.getElementById('install-log')
    logBox.textContent += '\n⚠ ' + result.message + '\n'
    return false
  }
  return true
}

async function runVenvStep() {
  const unlocked = await checkVenvLock()
  if (!unlocked) return false
  return runStep('venv')
}

async function runPipStep() {
  const unlocked = await checkVenvLock()
  if (!unlocked) return false
  document.getElementById('pip-time-warning').classList.remove('hidden')
  const ok = await runStep('pip')
  document.getElementById('pip-time-warning').classList.add('hidden')
  return ok
}

async function runDockerStep() {
  // Pre-check: is Docker daemon running?
  const daemon = await window.ember.checkDockerDaemon()
  if (!daemon.ok) {
    const logBox = document.getElementById('install-log')
    logBox.textContent += '⚠ Docker Desktop is not running.\n'
    logBox.textContent += 'Please start Docker Desktop, wait for "Engine running", then retry.\n'
    return false
  }
  return runStep('docker')
}

async function runStep(step) {
  const result = await window.ember.runInstallStep(step, state.emberPath)
  return result.ok
}

// ---------------------------------------------------------------------------
// Screen: Done
// ---------------------------------------------------------------------------

// AGPL acknowledgment — proceed to Done screen
document.getElementById('btn-agpl-acknowledge').addEventListener('click', () => {
  showScreen('screen-done')
  loadEmberVersion()
})

// Launch Ember — runs the full launcher script (Docker, SearXNG, API, browser)
document.getElementById('btn-launch-ember').addEventListener('click', async () => {
  const btn = document.getElementById('btn-launch-ember')
  const launchStatus = document.getElementById('launch-status')
  btn.disabled = true
  btn.textContent = 'Launching...'
  launchStatus.style.display = ''
  launchStatus.textContent = 'Starting Docker, SearXNG, and the API — this may take a moment...'

  const result = await window.ember.launchEmber(state.emberPath)

  if (result.ok) {
    btn.textContent = 'Launched'
    launchStatus.textContent = 'Ember is starting up. A browser window will open when ready.'
    setTimeout(() => {
      btn.textContent = 'Launch Ember'
      btn.disabled = false
      launchStatus.style.display = 'none'
    }, 10000)
  } else {
    btn.textContent = 'Launch Ember'
    btn.disabled = false
    launchStatus.textContent = result.error || 'Launch failed. Try the Open in Browser button instead.'
  }
})

// Open Ember — use Tailscale DNS if available, otherwise localhost
document.getElementById('btn-open-ember').addEventListener('click', () => {
  if (state.tailscaleDns) {
    window.ember.openUrl(`https://${state.tailscaleDns}`)
  } else if (state.tailscaleIp) {
    window.ember.openUrl(`http://${state.tailscaleIp}:8000`)
  } else {
    window.ember.openUrl('http://localhost:8000')
  }
})

// Retry API start
document.getElementById('btn-retry-api').addEventListener('click', async () => {
  const retryBtn = document.getElementById('btn-retry-api')
  const status = document.getElementById('done-status')
  retryBtn.disabled = true
  retryBtn.textContent = 'Retrying...'
  status.textContent = 'Restarting the API...'
  document.getElementById('done-troubleshooting').classList.add('hidden')

  await window.ember.startApi(state.emberPath)

  const host = state.host || '127.0.0.1'
  let healthy = false
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const check = await window.ember.checkApiHealth(host)
    if (check.ok) { healthy = true; break }
    status.textContent = `Waiting for Ember to start... (${(i + 1) * 2}s)`
  }

  retryBtn.disabled = false
  retryBtn.textContent = 'Try Again'

  if (healthy) {
    document.getElementById('done-title').textContent = "You're all set."
    document.getElementById('done-voice').textContent = '"I\'m ready. Let\'s begin."'
    status.textContent = 'Ember is running.'
    retryBtn.style.display = 'none'
  } else {
    status.textContent = "Still not responding. Check the hints below and try again."
    document.getElementById('done-troubleshooting').classList.remove('hidden')
  }
})

// Unified update check from Done screen
document.getElementById('btn-check-ember-update').addEventListener('click', async () => {
  const btn = document.getElementById('btn-check-ember-update')
  const info = document.getElementById('ember-update-info')
  const msg = document.getElementById('ember-update-msg')

  btn.disabled = true
  btn.textContent = 'Checking...'

  const updates = await window.ember.checkAllUpdates(state.host)

  btn.disabled = false
  btn.textContent = 'Check for updates'

  if (!updates.reachable) {
    info.classList.remove('hidden')
    msg.textContent = 'Update check unavailable — could not reach GitHub.'
    document.getElementById('btn-run-ember-update').classList.add('hidden')
    return
  }

  const anyUpdate = updates.installer.hasUpdate || updates.backend.hasUpdate || updates.ui.hasUpdate

  if (anyUpdate) {
    // Navigate to update screen with the unified checklist
    if (updates.backend.hasUpdate) {
      document.getElementById('update-row-backend').classList.remove('hidden')
      document.getElementById('update-backend-installed').textContent = updates.backend.installed
      document.getElementById('update-backend-latest').textContent = updates.backend.latest
    }
    if (updates.ui.hasUpdate) {
      document.getElementById('update-row-ui').classList.remove('hidden')
      document.getElementById('update-ui-installed').textContent = updates.ui.installed
      document.getElementById('update-ui-latest').textContent = updates.ui.latest
    }
    if (updates.installer.hasUpdate) {
      document.getElementById('update-row-installer').classList.remove('hidden')
      document.getElementById('update-installer-installed').textContent = updates.installer.installed
      document.getElementById('update-installer-latest').textContent = updates.installer.latest
    }
    pendingUpdates = {
      backend: updates.backend.hasUpdate,
      ui: updates.ui.hasUpdate,
      installer: updates.installer.hasUpdate,
    }
    showScreen('screen-update')
  } else {
    info.classList.remove('hidden')
    msg.textContent = 'Everything is up to date.'
    document.getElementById('btn-run-ember-update').classList.add('hidden')
  }
})

// Run ember-2 update (git pull + pip install + docker restart)
document.getElementById('btn-run-ember-update').addEventListener('click', async () => {
  const btn = document.getElementById('btn-run-ember-update')
  const logBox = document.getElementById('ember-update-log')

  btn.disabled = true
  btn.textContent = 'Updating...'
  logBox.classList.remove('hidden')
  logBox.textContent = ''

  window.ember.onEmberUpdateLog((text) => {
    logBox.textContent += text
    logBox.scrollTop = logBox.scrollHeight
  })

  const result = await window.ember.runEmberUpdate()
  window.ember.removeAllListeners('ember-update-log')

  if (result.ok) {
    btn.textContent = 'Done'
    logBox.textContent += `\nUpdate complete — now on ${result.tag || 'latest'}\n`
    document.getElementById('ember-version-label').textContent = result.tag || 'latest'
    // Re-run the start API + health check flow so the user doesn't have to figure it out
    loadEmberVersion()
  } else {
    btn.textContent = 'Failed'
    logBox.textContent += '\nUpdate failed. Try running git pull manually.\n'
    btn.disabled = false
  }
})

// Auto-start API, poll health, then load version when Done screen appears
async function loadEmberVersion() {
  const title = document.getElementById('done-title')
  const voice = document.getElementById('done-voice')
  const status = document.getElementById('done-status')
  const btn = document.getElementById('btn-open-ember')
  const launchBtn = document.getElementById('btn-launch-ember')

  // Launch button is always available — the launcher script handles everything
  launchBtn.disabled = false

  // Check UI is built before starting
  status.textContent = 'Checking Ember interface...'
  const uiCheck = await window.ember.checkUiBuilt()
  if (!uiCheck.ok) {
    title.textContent = "Almost there."
    voice.textContent = '"My interface didn\'t build correctly. Let me try again."'
    status.textContent = "Ember's interface is missing. Rebuilding..."
    // Attempt to rebuild
    const rebuildResult = await window.ember.runInstallStep('build-ui', state.emberPath)
    if (!rebuildResult.ok) {
      status.textContent = "Interface build failed. Try reinstalling or check that Node.js is installed."
      btn.disabled = false
      document.getElementById('btn-retry-api').style.display = ''
      document.getElementById('done-troubleshooting').classList.remove('hidden')
      return
    }
  }

  // Start the API
  status.textContent = 'Starting Ember...'
  await window.ember.startApi(state.emberPath)

  // Poll health check every 3 seconds, up to 60 seconds
  const host = state.host || '127.0.0.1'
  const maxAttempts = 20
  let healthy = false

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 3000))
    const check = await window.ember.checkApiHealth(host)
    if (check.ok) {
      healthy = true
      break
    }
    status.textContent = `Waiting for Ember to start... (${(i + 1) * 3}s)`
  }

  if (healthy) {
    title.textContent = "You're all set."
    voice.textContent = '"I\'m ready. Let\'s begin."'
    status.textContent = 'Ember is running.'
    btn.disabled = false
    document.getElementById('btn-retry-api').style.display = 'none'
    document.getElementById('done-troubleshooting').classList.add('hidden')

    // Load version info only after API is confirmed running
    const result = await window.ember.checkEmberUpdate()
    document.getElementById('ember-version-label').textContent = result.installed || 'unknown'
  } else {
    title.textContent = "Almost there."
    voice.textContent = '"I\'m ready — I just need a little help starting up."'
    status.textContent = "Ember didn't start within 60 seconds. You can try starting it manually, or use Launch Ember."
    btn.disabled = false
    document.getElementById('btn-retry-api').style.display = ''
    document.getElementById('done-troubleshooting').classList.remove('hidden')
    document.getElementById('ember-version-label').textContent = 'not started'
  }

  // Show Mac Gatekeeper note
  const platform = await window.ember.getPlatform()
  const gatekeeperNote = document.getElementById('done-gatekeeper-note')
  if (gatekeeperNote && platform === 'darwin') {
    gatekeeperNote.classList.remove('hidden')
  }
}

// ---------------------------------------------------------------------------
// Installer self-update (electron-updater)
// ---------------------------------------------------------------------------

window.ember.onInstallerUpdateAvailable((data) => {
  const banner = document.getElementById('installer-update-banner')
  const text = document.getElementById('installer-update-text')
  text.textContent = `Ember Setup ${data.version} is available.`
  banner.classList.remove('hidden')
})

document.getElementById('btn-installer-update').addEventListener('click', async () => {
  const btn = document.getElementById('btn-installer-update')
  const text = document.getElementById('installer-update-text')

  btn.disabled = true
  btn.textContent = 'Downloading...'

  window.ember.onInstallerDownloadProgress((data) => {
    btn.textContent = `Downloading ${data.percent}%`
  })

  window.ember.onInstallerUpdateDownloaded(() => {
    text.textContent = 'Update downloaded. Restarting...'
    btn.textContent = 'Restarting...'
    setTimeout(() => {
      window.ember.installInstallerUpdate()
    }, 1000)
  })

  await window.ember.downloadInstallerUpdate()
})

// ---------------------------------------------------------------------------
// Screen: Update
// ---------------------------------------------------------------------------

document.getElementById('btn-skip-update').addEventListener('click', () => {
  showScreen('screen-welcome')
})

// Unified update — stores pending update info for the Update All button
let pendingUpdates = null

document.getElementById('btn-run-update-all').addEventListener('click', async () => {
  if (!pendingUpdates) return
  const btn = document.getElementById('btn-run-update-all')
  btn.disabled = true
  btn.textContent = 'Updating...'

  const logBox = document.getElementById('update-all-log')
  logBox.classList.remove('hidden')
  logBox.textContent = ''

  window.ember.onUpdateAllLog((text) => {
    logBox.textContent += text
    logBox.scrollTop = logBox.scrollHeight
  })

  const result = await window.ember.runAllUpdates(pendingUpdates, state.host)
  window.ember.removeAllListeners('update-all-log')

  if (result.ok) {
    if (result.needsInstallerUpdate) {
      logBox.textContent += '\nBackend and UI updated. Downloading installer update...\n'
      btn.textContent = 'Restarting...'
      await window.ember.downloadInstallerUpdate()
      // electron-updater will quit-and-install when download completes
    } else {
      logBox.textContent += '\nAll updates applied. Starting Ember...\n'
      btn.textContent = 'Done'
      showScreen('screen-done')
      loadEmberVersion()
    }
  } else {
    logBox.textContent += `\nUpdate failed at stage: ${result.stage || 'unknown'}\n`
    btn.textContent = 'Failed'
    btn.disabled = false
  }
})

// ---------------------------------------------------------------------------
// Welcome: Check for installer updates (manual button)
// ---------------------------------------------------------------------------

document.getElementById('btn-check-installer-update').addEventListener('click', async () => {
  const btn = document.getElementById('btn-check-installer-update')
  const status = document.getElementById('installer-update-status')
  btn.disabled = true
  btn.textContent = 'Checking...'
  status.textContent = ''

  try {
    // Use the check-for-update IPC which hits GitHub releases
    const result = await window.ember.checkForUpdate()
    if (result.hasUpdate) {
      status.textContent = `Ember ${result.latestTag} available!`
    } else {
      status.textContent = 'You have the latest version.'
    }
  } catch {
    status.textContent = 'Could not check for updates.'
  }

  btn.disabled = false
  btn.textContent = 'Check for Ember updates'
})

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  // Show demo badge if in demo mode
  const demoMode = await window.ember.getDemoMode()
  if (demoMode) {
    document.getElementById('demo-badge').classList.remove('hidden')
  }

  // Check for updates across all three repos (if already installed)
  const emberPath = await window.ember.getEmberPath()

  if (emberPath) {
    const updates = await window.ember.checkAllUpdates(state.host)

    if (updates.reachable) {
      const anyUpdate = updates.installer.hasUpdate || updates.backend.hasUpdate || updates.ui.hasUpdate

      if (anyUpdate) {
        // Populate update checklist
        if (updates.backend.hasUpdate) {
          document.getElementById('update-row-backend').classList.remove('hidden')
          document.getElementById('update-backend-installed').textContent = updates.backend.installed
          document.getElementById('update-backend-latest').textContent = updates.backend.latest
        }
        if (updates.ui.hasUpdate) {
          document.getElementById('update-row-ui').classList.remove('hidden')
          document.getElementById('update-ui-installed').textContent = updates.ui.installed
          document.getElementById('update-ui-latest').textContent = updates.ui.latest
        }
        if (updates.installer.hasUpdate) {
          document.getElementById('update-row-installer').classList.remove('hidden')
          document.getElementById('update-installer-installed').textContent = updates.installer.installed
          document.getElementById('update-installer-latest').textContent = updates.installer.latest
        }

        // Store what needs updating for the Update All button
        pendingUpdates = {
          backend: updates.backend.hasUpdate,
          ui: updates.ui.hasUpdate,
          installer: updates.installer.hasUpdate,
        }

        showScreen('screen-update')
        return
      }
    }
    // If GitHub unreachable or no updates, fall through to normal flow
  }

  // Normal flow — check prerequisites
  showScreen('screen-welcome')

  // Pre-load data in background
  initInstallDir()
  initVaultPath()
  initOllamaModelsPath()
  checkPrerequisites()
  loadModels()
}

init()
