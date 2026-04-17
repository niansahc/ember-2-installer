// No raw Node/Electron APIs are exposed — only explicit named methods.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('ember', {
  checkPrerequisites: () => ipcRenderer.invoke('check-prerequisites'),

  installPrerequisite: (name) => ipcRenderer.invoke('install-prerequisite', { name }),
  checkWinget: () => ipcRenderer.invoke('check-winget'),
  onPrereqInstallProgress: (fn) =>
    ipcRenderer.on('prereq-install-progress', (_e, data) => fn(data)),

  getEmberPath: () => ipcRenderer.invoke('get-ember-path'),
  saveEmberPath: (p) => ipcRenderer.invoke('save-ember-path', p),
  pickEmberFolder: () => ipcRenderer.invoke('pick-ember-folder'),
  cloneEmberRepo: (parentDir) => ipcRenderer.invoke('clone-ember-repo', { parentDir }),
  checkTargetPath: (parentDir) => ipcRenderer.invoke('check-target-path', { parentDir }),
  updateExistingEmber: (emberPath) => ipcRenderer.invoke('update-existing-ember', { emberPath }),
  freshInstallEmber: (parentDir) => ipcRenderer.invoke('fresh-install-ember', { parentDir }),
  getDefaultInstallDir: () => ipcRenderer.invoke('get-default-install-dir'),
  scanForEmber: () => ipcRenderer.invoke('scan-for-ember'),
  getRecommendedModels: () => ipcRenderer.invoke('get-recommended-models'),
  detectHardware: () => ipcRenderer.invoke('detect-hardware'),
  onCloneProgress: (fn) => ipcRenderer.on('clone-progress', (_e, text) => fn(text)),

  pickVaultFolder: () => ipcRenderer.invoke('pick-vault-folder'),
  createVault: (p) => ipcRenderer.invoke('create-vault', p),
  getDefaultVault: () => ipcRenderer.invoke('get-default-vault'),

  getOllamaModels: () => ipcRenderer.invoke('get-ollama-models'),
  getDefaultOllamaModels: () => ipcRenderer.invoke('get-default-ollama-models'),
  setOllamaModelsPath: (p) => ipcRenderer.invoke('set-ollama-models-path', p),
  pullOllamaModel: (model) => ipcRenderer.invoke('pull-ollama-model', model),

  writeEnv: (config) => ipcRenderer.invoke('write-env', config),

  runInstallStep: (step, emberPath) =>
    ipcRenderer.invoke('run-install-step', { step, emberPath }),

  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),
  runGitPull: () => ipcRenderer.invoke('run-git-pull'),
  checkAllUpdates: (host) => ipcRenderer.invoke('check-all-updates', { host }),
  runAllUpdates: (updates, host) => ipcRenderer.invoke('run-all-updates', { updates, host }),
  onUpdateAllLog: (fn) => ipcRenderer.on('update-all-log', (_e, text) => fn(text)),

  openUrl: (url) => ipcRenderer.invoke('open-url', url),
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  restartComputer: () => ipcRenderer.invoke('restart-computer'),

  onInstallLog: (fn) => ipcRenderer.on('install-log', (_e, data) => fn(data)),
  onInstallStepDone: (fn) => ipcRenderer.on('install-step-done', (_e, data) => fn(data)),
  onOllamaPullProgress: (fn) =>
    ipcRenderer.on('ollama-pull-progress', (_e, text) => fn(text)),

  checkTailscaleInstalled: () => ipcRenderer.invoke('check-tailscale-installed'),
  checkTailscaleStatus: () => ipcRenderer.invoke('check-tailscale-status'),
  getTailscaleIp: () => ipcRenderer.invoke('get-tailscale-ip'),
  runTailscaleServe: () => ipcRenderer.invoke('run-tailscale-serve'),
  getTailscaleDns: () => ipcRenderer.invoke('get-tailscale-dns'),

  onInstallerUpdateAvailable: (fn) =>
    ipcRenderer.on('installer-update-available', (_e, data) => fn(data)),
  onInstallerDownloadProgress: (fn) =>
    ipcRenderer.on('installer-download-progress', (_e, data) => fn(data)),
  onInstallerUpdateDownloaded: (fn) =>
    ipcRenderer.on('installer-update-downloaded', (_e) => fn()),
  downloadInstallerUpdate: () => ipcRenderer.invoke('download-installer-update'),
  installInstallerUpdate: () => ipcRenderer.invoke('install-installer-update'),

  checkEmberUpdate: () => ipcRenderer.invoke('check-ember-update'),
  runEmberUpdate: () => ipcRenderer.invoke('run-ember-update'),
  onEmberUpdateLog: (fn) =>
    ipcRenderer.on('ember-update-log', (_e, text) => fn(text)),

  checkDockerDaemon: () => ipcRenderer.invoke('check-docker-daemon'),

  startApi: (emberPath) => ipcRenderer.invoke('start-api', { emberPath }),
  checkApiHealth: (host) => ipcRenderer.invoke('check-api-health', { host }),
  getVaultStorage: (host) => ipcRenderer.invoke('get-vault-storage', { host }),

  launchEmber: (emberPath) => ipcRenderer.invoke('launch-ember', { emberPath }),
  setStartupTask: (emberPath, enabled) => ipcRenderer.invoke('set-startup-task', { emberPath, enabled }),
  getStartupTask: () => ipcRenderer.invoke('get-startup-task'),

  setFullscreen: (enabled) => ipcRenderer.invoke('set-fullscreen', { enabled }),

  getReleaseNotes: () => ipcRenderer.invoke('get-release-notes'),

  setupDevMode: (emberPath, demoVault, testVault) =>
    ipcRenderer.invoke('setup-dev-mode', { emberPath, demoVault, testVault }),

  checkUiBuilt: () => ipcRenderer.invoke('check-ui-built'),

  checkVenvLock: (emberPath) => ipcRenderer.invoke('check-venv-lock', { emberPath }),

  getDemoMode: () => ipcRenderer.invoke('get-demo-mode'),

  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
})
