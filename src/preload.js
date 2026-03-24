/**
 * src/preload.js
 *
 * Exposes a safe, typed API to the renderer via contextBridge.
 * No raw Node/Electron APIs are exposed — only explicit named methods.
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('ember', {
  // Prerequisites
  checkPrerequisites: () => ipcRenderer.invoke('check-prerequisites'),

  // Ember repo path
  getEmberPath: () => ipcRenderer.invoke('get-ember-path'),
  saveEmberPath: (p) => ipcRenderer.invoke('save-ember-path', p),
  pickEmberFolder: () => ipcRenderer.invoke('pick-ember-folder'),
  cloneEmberRepo: (parentDir) => ipcRenderer.invoke('clone-ember-repo', { parentDir }),
  getDefaultInstallDir: () => ipcRenderer.invoke('get-default-install-dir'),
  onCloneProgress: (fn) => ipcRenderer.on('clone-progress', (_e, text) => fn(text)),

  // Vault
  pickVaultFolder: () => ipcRenderer.invoke('pick-vault-folder'),
  createVault: (p) => ipcRenderer.invoke('create-vault', p),
  getDefaultVault: () => ipcRenderer.invoke('get-default-vault'),

  // Ollama models
  getOllamaModels: () => ipcRenderer.invoke('get-ollama-models'),
  pullOllamaModel: (model) => ipcRenderer.invoke('pull-ollama-model', model),

  // Config
  writeEnv: (config) => ipcRenderer.invoke('write-env', config),

  // Install steps
  runInstallStep: (step, emberPath) =>
    ipcRenderer.invoke('run-install-step', { step, emberPath }),

  // Updates
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),
  runGitPull: () => ipcRenderer.invoke('run-git-pull'),

  // Misc
  openWebUI: () => ipcRenderer.invoke('open-webui'),
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
  getPlatform: () => ipcRenderer.invoke('get-platform'),

  // Event listeners (streaming)
  onInstallLog: (fn) => ipcRenderer.on('install-log', (_e, data) => fn(data)),
  onInstallStepDone: (fn) => ipcRenderer.on('install-step-done', (_e, data) => fn(data)),
  onOllamaPullProgress: (fn) =>
    ipcRenderer.on('ollama-pull-progress', (_e, text) => fn(text)),

  // Tailscale
  checkTailscaleInstalled: () => ipcRenderer.invoke('check-tailscale-installed'),
  checkTailscaleStatus: () => ipcRenderer.invoke('check-tailscale-status'),
  getTailscaleIp: () => ipcRenderer.invoke('get-tailscale-ip'),
  runTailscaleServe: () => ipcRenderer.invoke('run-tailscale-serve'),
  getTailscaleDns: () => ipcRenderer.invoke('get-tailscale-dns'),

  // Installer self-update
  onInstallerUpdateAvailable: (fn) =>
    ipcRenderer.on('installer-update-available', (_e, data) => fn(data)),
  onInstallerDownloadProgress: (fn) =>
    ipcRenderer.on('installer-download-progress', (_e, data) => fn(data)),
  onInstallerUpdateDownloaded: (fn) =>
    ipcRenderer.on('installer-update-downloaded', (_e) => fn()),
  downloadInstallerUpdate: () => ipcRenderer.invoke('download-installer-update'),
  installInstallerUpdate: () => ipcRenderer.invoke('install-installer-update'),

  // Ember-2 backend update
  checkEmberUpdate: () => ipcRenderer.invoke('check-ember-update'),
  runEmberUpdate: () => ipcRenderer.invoke('run-ember-update'),
  onEmberUpdateLog: (fn) =>
    ipcRenderer.on('ember-update-log', (_e, text) => fn(text)),

  // UI choice
  checkOpenWebUI: () => ipcRenderer.invoke('check-open-webui'),
  saveUiChoice: (choice) => ipcRenderer.invoke('save-ui-choice', { choice }),
  getUiChoice: () => ipcRenderer.invoke('get-ui-choice'),

  // Demo mode
  getDemoMode: () => ipcRenderer.invoke('get-demo-mode'),

  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
})
