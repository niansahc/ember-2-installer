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
  model: 'qwen2.5:14b',
  vision: null,
  host: '127.0.0.1',
  models: [],
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

async function checkPrerequisites() {
  const checks = await window.ember.checkPrerequisites()
  let allGood = true

  for (const [name, result] of Object.entries(checks)) {
    const row = document.getElementById(`prereq-${name}`)
    const icon = row.querySelector('.prereq-icon')
    const version = row.querySelector('.prereq-version')
    const link = row.querySelector('.prereq-link')

    if (result.ok) {
      icon.textContent = '✅'
      version.textContent = result.version || 'Installed'
      link.classList.add('hidden')
    } else {
      icon.textContent = '❌'
      version.textContent = 'Not found'
      link.classList.remove('hidden')
      allGood = false
    }
  }

  document.getElementById('btn-prereqs-next').disabled = !allGood
}

// Download links open external browser
document.querySelectorAll('.prereq-link').forEach((link) => {
  link.addEventListener('click', (e) => {
    e.preventDefault()
    window.ember.openUrl(link.dataset.url)
  })
})

document.getElementById('btn-recheck').addEventListener('click', () => {
  // Reset icons to loading
  document.querySelectorAll('.prereq-icon').forEach((i) => (i.textContent = '⏳'))
  document.querySelectorAll('.prereq-version').forEach((v) => (v.textContent = ''))
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
  btn.disabled = true
  btn.textContent = 'Installing...'

  const cloneStatus = document.getElementById('clone-status')
  const cloneLog = document.getElementById('clone-log')
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
    // Auto-advance after brief pause
    setTimeout(() => showScreen('screen-vault'), 800)
  } else {
    cloneLog.textContent += '\nFailed to clone. Check your internet connection and try again.\n'
    btn.disabled = false
    btn.textContent = 'Try Again'
  }
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

  // Auto-select first vision model
  if (!state.vision && modelData.vision.length > 0) {
    state.vision = modelData.vision[0].id
  }
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

  const [status, ip] = await Promise.all([
    window.ember.checkTailscaleStatus(),
    window.ember.getTailscaleIp(),
  ])

  if (status.ok && ip) {
    icon.textContent = '✅'
    state.host = ip
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
    const url = dnsName ? `https://${dnsName}` : `http://${state.host}:3000`
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
// Screen: Install progress
// ---------------------------------------------------------------------------

document.getElementById('btn-start-install').addEventListener('click', async () => {
  // Collect final state from UI
  state.model = document.getElementById('model-select').value || 'qwen2.5:14b'

  if (document.getElementById('vision-toggle').checked) {
    state.vision = document.getElementById('vision-select').value || 'llama3.2-vision:11b'
  }

  // host is already set by the walkthrough (either 127.0.0.1 or the Tailscale IP)

  // If vault path is empty, use the placeholder value
  if (!state.vaultPath) {
    state.vaultPath = document.getElementById('vault-path-input').placeholder
  }

  // Run the installation
  await runInstall()
})

async function runInstall() {
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
    { id: 'venv',   label: 'Creating Python environment...',    run: () => runStep('venv') },
    { id: 'pip',    label: 'Installing dependencies...',        run: () => runStep('pip') },
    { id: 'apikey', label: 'Setting up API key...',             run: () => runStep('apikey'), nonFatal: true },
  ]

  if (needsModelDownload) {
    steps.push({
      id: 'model',
      label: `Downloading ${state.model}...`,
      run: () => ensureModelDownloaded(state.model, 'model-download-log', 'model-download-label'),
    })
  }

  if (needsVisionDownload) {
    steps.push({
      id: 'vision-dl',
      label: `Downloading ${state.vision}...`,
      run: () => ensureModelDownloaded(state.vision, 'vision-download-log', 'vision-download-label'),
      nonFatal: true,
    })
  }

  steps.push({ id: 'docker', label: 'Starting services...', run: runDockerStep })

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

    const ok = await step.run()

    icon.textContent = ok ? '✅' : '❌'
    label.textContent = step.label
    el.classList.remove('active')

    if (!ok && !step.nonFatal) {
      logBox.textContent += `\n⚠ Step "${step.id}" failed. Check the log above.\n`
      logBox.textContent += '\nYou can fix the issue and try again.\n'
      showRetryButton(() => {
        // Reset icons and retry
        steps.forEach((s) => {
          const stepEl = document.getElementById(`step-${s.id}`)
          stepEl.querySelector('.step-icon').textContent = '⏳'
          stepEl.querySelector('.step-label').textContent = s.label
        })
        runInstall()
      })
      return
    }
  }

  // Clean up listeners
  window.ember.removeAllListeners('install-log')
  window.ember.removeAllListeners('install-step-done')

  // All done — show done screen and load version
  showScreen('screen-done')
  loadEmberVersion()
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

// UI Choice — detect Open WebUI, save preference, open chosen UI
document.getElementById('btn-open-ember').addEventListener('click', async () => {
  const choice = document.querySelector('input[name="ui-choice"]:checked')?.value || 'ember-ui'
  await window.ember.saveUiChoice(choice)
  const host = state.host || '127.0.0.1'
  if (choice === 'open-webui') {
    // Open WebUI runs on port 3000
    window.ember.openUrl(`http://${host}:3000`)
  } else {
    // Ember UI — use localhost for dev server, or host for Tailscale
    const uiHost = host === '127.0.0.1' ? 'localhost' : host
    window.ember.openUrl(`http://${uiHost}:5173`)
  }
})

// Check for Open WebUI and load saved choice when Done screen appears
async function initUiChoice() {
  const notice = document.getElementById('ui-choice-notice')

  // Check if Open WebUI is running
  const webui = await window.ember.checkOpenWebUI()
  if (webui.running) {
    notice.textContent = "We noticed you have Open WebUI running. You can keep using it or switch to Ember's interface — your choice."
    notice.classList.remove('hidden')
  }

  // Restore saved choice
  const saved = await window.ember.getUiChoice()
  if (saved) {
    const radio = document.querySelector(`input[name="ui-choice"][value="${saved}"]`)
    if (radio) radio.checked = true
  }
}

// Ember-2 backend version check
document.getElementById('btn-check-ember-update').addEventListener('click', async () => {
  const btn = document.getElementById('btn-check-ember-update')
  const label = document.getElementById('ember-version-label')
  const info = document.getElementById('ember-update-info')
  const msg = document.getElementById('ember-update-msg')

  btn.disabled = true
  btn.textContent = 'Checking...'

  const result = await window.ember.checkEmberUpdate()

  label.textContent = result.installed || 'unknown'
  btn.disabled = false
  btn.textContent = 'Check for updates'

  if (result.hasUpdate) {
    info.classList.remove('hidden')
    msg.innerHTML = `Update available: <strong>${result.latest}</strong>${result.changelog ? '<br><br>' + result.changelog.substring(0, 200) : ''}`
    document.getElementById('btn-run-ember-update').classList.remove('hidden')
  } else {
    info.classList.remove('hidden')
    msg.textContent = 'You\'re on the latest version.'
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
  } else {
    btn.textContent = 'Failed'
    logBox.textContent += '\nUpdate failed. Try running git pull manually.\n'
    btn.disabled = false
  }
})

// Auto-check version and UI choice when Done screen appears
async function loadEmberVersion() {
  const result = await window.ember.checkEmberUpdate()
  document.getElementById('ember-version-label').textContent = result.installed || 'unknown'
  initUiChoice()
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

document.getElementById('btn-run-update').addEventListener('click', async () => {
  const btn = document.getElementById('btn-run-update')
  btn.disabled = true
  btn.textContent = 'Updating...'

  const log = document.getElementById('update-changelog')
  log.textContent = 'Running git pull...\n'

  window.ember.onInstallLog(({ step, text }) => {
    if (step === 'update') {
      log.textContent += text
      log.scrollTop = log.scrollHeight
    }
  })

  const result = await window.ember.runGitPull()
  window.ember.removeAllListeners('install-log')

  if (result.ok) {
    log.textContent += '\nUpdate complete! Restart Ember to apply changes.\n'
    btn.textContent = 'Done'
  } else {
    log.textContent += '\nUpdate failed. Try running git pull manually.\n'
    btn.textContent = 'Failed'
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
      status.textContent = `v${result.latestTag} available!`
      // Show the auto-update banner
      const banner = document.getElementById('installer-update-banner')
      const text = document.getElementById('installer-update-text')
      text.textContent = `Ember Setup ${result.latestTag} is available.`
      banner.classList.remove('hidden')
    } else {
      status.textContent = 'You have the latest version.'
    }
  } catch {
    status.textContent = 'Could not check for updates.'
  }

  btn.disabled = false
  btn.textContent = 'Check for installer updates'
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

  // Check for updates first (if already installed)
  const emberPath = await window.ember.getEmberPath()

  if (emberPath) {
    const update = await window.ember.checkForUpdate()
    if (update.hasUpdate) {
      document.getElementById('update-installed').textContent = update.installedTag
      document.getElementById('update-latest').textContent = update.latestTag
      document.getElementById('update-changelog').textContent = update.changelog || 'No changelog provided.'
      showScreen('screen-update')
      return
    }
  }

  // Normal flow — check prerequisites
  showScreen('screen-welcome')

  // Pre-load data in background
  initInstallDir()
  initVaultPath()
  checkPrerequisites()
  loadModels()
}

init()
