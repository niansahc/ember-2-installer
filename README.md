# ember-2-installer

The Electron-based installer and setup wizard for [Ember-2](https://github.com/niansahc/ember-2) — handles prerequisites, cloning, configuration, and first launch on Windows, Mac, and Linux.

## Features

- **Prerequisite auto-install** — Git, Python, Node, Ollama, Docker detected and installed via winget (Windows), Homebrew (Mac), or system package manager (Linux)
- **Parallel prerequisite installs** — Git, Python, Node, and Ollama install concurrently; Docker last
- **Model selection** — curated model cards with eval-based descriptions, disk sizes, and RAM requirements; hardware detection recommends a default
- **Parallel pip + model downloads** — pip install and Ollama model pulls run concurrently
- **Shallow clones** — `--depth 1` on all git clone operations
- **Vault setup** — user picks or creates a private vault directory
- **API key configuration** — stored in OS credential store (Windows Credential Manager, macOS Keychain, Linux SecretService with file fallback)
- **Unified update checker** — checks installer, backend, and UI versions in parallel on startup
- **HTML release notes panel** — scrollable "What's new" section rendered from release notes on the update screen
- **Developer mode** — checkbox on Done and Update screens; creates demo/test vault directories and writes dev config
- **Matrix easter egg** — fullscreen Ember-orange rain with hearts, kitties, and gems on developer mode unlock
- **Auto-start and health check** — starts the API after install/update and polls until healthy

## Platforms

| Platform | Target | Status |
|----------|--------|--------|
| Windows | NSIS installer | Fully tested |
| Mac | DMG | Best-effort (not tested on real hardware) |
| Linux | AppImage | Best-effort (not tested on real hardware) |

## Development

```bash
npm start          # Dev mode (demo — no real infrastructure)
npm run start:real # Dev mode with real infrastructure
npm run test:e2e   # Run Playwright e2e tests (73 tests)
npm run build      # Build installer
```

## The full project

Everything you need is at: https://github.com/niansahc/ember-2
