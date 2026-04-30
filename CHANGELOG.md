# Changelog

## [0.8.1](https://github.com/niansahc/ember-2-installer/compare/ember-2-installer-v0.8.0...ember-2-installer-v0.8.1) (2026-04-30)


### Features

* add business hours push protection hook and GitHub Actions check ([e774112](https://github.com/niansahc/ember-2-installer/commit/e774112f3500519964512d7d26a8d8ac01ecb8ab))
* add CSS for hardware summary and AGPL acknowledgment card ([9145989](https://github.com/niansahc/ember-2-installer/commit/91459895f9d50ef4febb9ac2dd9962c0d8de30f3))
* add hardware detection IPC handler with GPU, RAM, model recommendation ([681e943](https://github.com/niansahc/ember-2-installer/commit/681e943547b6de816bcc10e76801412b23637f1a))
* add hardware summary box on model screen + AGPL acknowledgment screen ([869597d](https://github.com/niansahc/ember-2-installer/commit/869597dfa7b851f31553af56eab37000aa6afa96))
* add Playwright e2e test infrastructure for installer ([7bd4680](https://github.com/niansahc/ember-2-installer/commit/7bd468049ef4048f8c7dd087e0c894477de60e6d))
* expose detectHardware in preload.js ([dc7a317](https://github.com/niansahc/ember-2-installer/commit/dc7a317b991ce6499a6fb6c618c84c964e417bae))
* install retry resumes from failed step instead of restarting entire install ([b70430b](https://github.com/niansahc/ember-2-installer/commit/b70430b7320dd91adfc6d40df6c572320c6ab550))
* **installer:** add Claude Code hooks for .env protection and auto-testing ([e5d9746](https://github.com/niansahc/ember-2-installer/commit/e5d974664dce44f14cee540a86dc3995b820ba59))
* **installer:** add developer mode setup with demo and test vault configuration ([1efe6e6](https://github.com/niansahc/ember-2-installer/commit/1efe6e67b6073694d13bd6f2d573f5b45968c5e3))
* **installer:** add HTML release notes panel to update screen ([46f24bf](https://github.com/niansahc/ember-2-installer/commit/46f24bf96ae990e3b29fded44b46d34882939878))
* **installer:** add Launch Ember button to Done screen ([b10a41e](https://github.com/niansahc/ember-2-installer/commit/b10a41e36b32285e4e5db8a842d1b75c5c27a8de))
* **installer:** add Matrix easter egg on developer mode unlock ([8976baf](https://github.com/niansahc/ember-2-installer/commit/8976baf057d21eb8b9b39feb34f994d60fa8f644))
* **installer:** add startup task support for macOS and Linux ([16bba14](https://github.com/niansahc/ember-2-installer/commit/16bba14e5e4ad986e28e6c036229ccd5a25ffde1))
* **installer:** add update screen touches, rename done screen buttons, expand test coverage to 59 ([68bad7e](https://github.com/niansahc/ember-2-installer/commit/68bad7e82a0373e35832b56ebe370b64349a385b))
* **installer:** add vault storage estimate to done screen ([3758d30](https://github.com/niansahc/ember-2-installer/commit/3758d3027bc9970215adea45c2d218e4575bf085))
* **installer:** add Windows startup task for automatic Ember launch at logon ([97e3d69](https://github.com/niansahc/ember-2-installer/commit/97e3d69e991bfac3b5a3eef0a875affcc031967a))
* **installer:** auto-start Docker Desktop if daemon not running ([b00bfe3](https://github.com/niansahc/ember-2-installer/commit/b00bfe30280bc1103f35c3b91aefa4ded0cc4dcd))
* **installer:** pull nomic-embed-text embedding model in install and update flows ([73c0a19](https://github.com/niansahc/ember-2-installer/commit/73c0a19e34c422024f6b1617680af3ac386d7a97))
* **installer:** register Ember backend as startup task via Task Scheduler ([02c5cd8](https://github.com/niansahc/ember-2-installer/commit/02c5cd84c210e98953ce6dbcdcb7e9c2810206d9))
* **installer:** unified update checker for all three repos ([a712b0f](https://github.com/niansahc/ember-2-installer/commit/a712b0fdc42b8ae82000d32d6140084e09b119ce))
* Mac and Linux installer support — platform-aware prereqs, paths, and startup ([847aecd](https://github.com/niansahc/ember-2-installer/commit/847aecd2d83081ecdeb085203a3142490d4863cf))
* render release notes as markdown instead of plain text ([57b6025](https://github.com/niansahc/ember-2-installer/commit/57b602533e2792221b59407ae9328d03e2940625))
* update recommended model to qwen3:8b based on eval results ([9ef6aa3](https://github.com/niansahc/ember-2-installer/commit/9ef6aa36aec3d2eb492f6eee8f8e2f73b1199c53))
* **v0.11.0:** installer fixes — UI update path, UI verification, health check ([007ca8c](https://github.com/niansahc/ember-2-installer/commit/007ca8cf469a2c736bfcec6dc7fbf13c3ac5e935))
* wire hardware detection to model screen, AGPL acknowledge to done flow ([68da3c7](https://github.com/niansahc/ember-2-installer/commit/68da3c773e4eac33002eee58f98989630dc0daac))


### Bug Fixes

* auto-start API after install and verify health before enabling Open Ember button ([67f2bf5](https://github.com/niansahc/ember-2-installer/commit/67f2bf51e84039c7c7b5fb44b3423d21dc34fa56))
* default model to qwen3:8b, eval-based descriptions, model guide on selection screen, retry on Done ([a4d85d4](https://github.com/niansahc/ember-2-installer/commit/a4d85d4c6fe9f007bf31c27faaf00ca31291411f))
* detect existing ember-2 installation, offer update vs fresh install ([7db90ed](https://github.com/niansahc/ember-2-installer/commit/7db90ed0d02f43de56f320e1a95b230c3c5da523))
* detect venv/API lock before install steps with friendly error message ([e90c2b0](https://github.com/niansahc/ember-2-installer/commit/e90c2b02a2599acf948e6fea5c14129c9f84d701))
* git pull uses origin main explicitly — fixes 'no tracking information' error ([481ffda](https://github.com/niansahc/ember-2-installer/commit/481ffda4064117c7d48773bc4d73a2dcc1e922c7))
* **installer:** auto-restart API after update instead of telling user to restart manually ([61392b4](https://github.com/niansahc/ember-2-installer/commit/61392b4080d0773b22a336ba5b68b64458653b84))
* **installer:** backend update check falls back to version.json when API is down ([b0bc5fb](https://github.com/niansahc/ember-2-installer/commit/b0bc5fbc18d5a986fe5936e42c275627232955e7))
* **installer:** build output to C:/temp/ember-dist to avoid OneDrive sync ([5dc1477](https://github.com/niansahc/ember-2-installer/commit/5dc14773ae06e35cefa82ebd017f7de56f16dde1))
* **installer:** default install to Program Files instead of AppData ([48d79d0](https://github.com/niansahc/ember-2-installer/commit/48d79d0e24fbaceeb9b8a2d4a6da69167025fa27))
* **installer:** disable run after finish to prevent unprompted relaunch ([34404d2](https://github.com/niansahc/ember-2-installer/commit/34404d2cb00e3d259a0d0c79bf11db684cdc3b52))
* **installer:** docker readiness check, remove update popup on launch ([97bae9a](https://github.com/niansahc/ember-2-installer/commit/97bae9a641798bbde538eaecdaeaacee317d1981))
* **installer:** don't auto-select vision model without user opt-in ([dba58d1](https://github.com/niansahc/ember-2-installer/commit/dba58d1757932c0c5ae76d75990aed7db642229a))
* **installer:** harden Node.js prerequisite detection ([eca9658](https://github.com/niansahc/ember-2-installer/commit/eca9658c752d2ae94db492c63e131b15d8c2827c))
* **installer:** increase fun facts display duration from 8s to 14s ([2f0db5d](https://github.com/niansahc/ember-2-installer/commit/2f0db5ddc30d3cf6c0af2106fd71e565802da7b3))
* **installer:** increase window height and screen padding to prevent content clipping ([502474d](https://github.com/niansahc/ember-2-installer/commit/502474d65fbdd6d0e61567a1f7ae34c1b8256e2d))
* **installer:** inject API key into UI .env before Vite build ([d7e857d](https://github.com/niansahc/ember-2-installer/commit/d7e857db57380e9677660eb5df447576ce0b7f18))
* **installer:** kill and restart API after backend update, verify pulled version ([3b65bf3](https://github.com/niansahc/ember-2-installer/commit/3b65bf35d568bfe3f9e5a2e0cbf7c2101e2c2f2e))
* **installer:** prevent double API start on update and add timeout to installer download (BUG-007) ([1f824bf](https://github.com/niansahc/ember-2-installer/commit/1f824bffa6908b02c2b1536539af3d733729b490))
* **installer:** remove jarring update popup on launch ([bcceaf3](https://github.com/niansahc/ember-2-installer/commit/bcceaf369d22f2e67d2c3e326f8c35c7b82f541f))
* **installer:** revert runAfterFinish — app must launch after install ([948f663](https://github.com/niansahc/ember-2-installer/commit/948f663272ec1688684adfd8a29411e6f8aaaa39))
* **installer:** set state.emberPath on boot so dev mode and version check work ([c3e06e8](https://github.com/niansahc/ember-2-installer/commit/c3e06e86043680fcec2516e47cabf386e28e2047))
* **installer:** stop autoUpdater from firing on startup and causing popups ([275a513](https://github.com/niansahc/ember-2-installer/commit/275a51396e8838ffdeecdb8fc37659121b022257))
* **installer:** version.json git reset before pull, health check race, longer startup timeout ([cacd464](https://github.com/niansahc/ember-2-installer/commit/cacd46467777d18f46e27b2ae9895293f3745b2c))
* remove double-v prefix on update available text ([0e95b79](https://github.com/niansahc/ember-2-installer/commit/0e95b79b150a1f019394ca9ff66eefb4f0df78af))
* revert app?.isPackaged guard, document Electron 28 Playwright incompatibility ([4a032b3](https://github.com/niansahc/ember-2-installer/commit/4a032b3e5d221b04cedb01df6ea7c2067a5abef7))
* **security:** delete UI .env file after build to prevent API key persistence on disk ([df90fc0](https://github.com/niansahc/ember-2-installer/commit/df90fc05b8170f4cba13a4898f97e5339b24c264))
* **security:** HTML-escape GitHub release body before rendering ([b070a75](https://github.com/niansahc/ember-2-installer/commit/b070a75851024e6fd1100c8b7d5a481b3e2addc1))
* **security:** restrict open-url IPC handler to safe URL schemes ([861281e](https://github.com/niansahc/ember-2-installer/commit/861281ee74747b5cd6ab5d3c71ce392f96f2ca1e))
* show friendly time warning when pip step starts during install ([0832512](https://github.com/niansahc/ember-2-installer/commit/08325128d0b5d48edd3a86da9a85cadd8771b120))
* **startup:** fall back to root endpoint when /api/health is not ready ([7bf9ec8](https://github.com/niansahc/ember-2-installer/commit/7bf9ec8de87d0c032290d72b5e9bc482008d92f9))
* **startup:** pipe API startup stdio to log file and surface on timeout ([13b0964](https://github.com/niansahc/ember-2-installer/commit/13b096458b126590f52ae51d333a0b8387a52f34))
* **startup:** verify Docker containers are running before spawning API ([c3eadc8](https://github.com/niansahc/ember-2-installer/commit/c3eadc8716df6f2090c4b59dab78dec1ed2f5c36))
* **update+startup:** lockfile conflict + R1–R4 startup reliability ([5efac9e](https://github.com/niansahc/ember-2-installer/commit/5efac9e380637e75d6a29bbc2506e18532e7fdfd))
* **update:** kill old API before docker compose to avoid port 8000 bind race ([87e76ba](https://github.com/niansahc/ember-2-installer/commit/87e76badd85629943470aea7c3c5efa84f34e7cb))
* **update:** reset package-lock.json before pulling ember-2-ui ([f4f5319](https://github.com/niansahc/ember-2-installer/commit/f4f5319e73ad7160b30735d79ac890e7e4860b5f))
* use localhost for tailscale serve target instead of Tailscale IP ([d14179a](https://github.com/niansahc/ember-2-installer/commit/d14179a4c5fd1d5d13a2a88eeed4b17019414399))
* use Tailscale IP instead of localhost for tailscale serve binding ([03b8698](https://github.com/niansahc/ember-2-installer/commit/03b86988f801ca0dab1a78dd1ca4d09ef0ee0448))
* verify Docker daemon is running, not just installed ([7d9e0ad](https://github.com/niansahc/ember-2-installer/commit/7d9e0ada75446032d0bbb3145d919c5c68fa2a94))
* welcome screen test — use first() to resolve strict mode with two h1 elements ([5e18066](https://github.com/niansahc/ember-2-installer/commit/5e1806692808553c21e545b84b8171db3a9476e0))
* welcome screen update check shows Ember version not installer version ([c8df2c7](https://github.com/niansahc/ember-2-installer/commit/c8df2c7af795828dd4ad45500ba29c86d94c40c9))


### Performance Improvements

* **installer:** parallelize installs and use shallow clones ([cf332c8](https://github.com/niansahc/ember-2-installer/commit/cf332c8392ee7c9625a3204f2e170fdb3b0d984e))

## v0.8.0 — 2026-04-18

### Features
- Register Ember backend as startup task via Task Scheduler (Windows), LaunchAgent (macOS), systemd unit (Linux); auto-registers on first install with opt-out toggle on Done screen
- Vault storage estimate on Done screen — current size and 30-day projection pulled from backend `/v1/system/vault-storage`
- Business hours push protection hook — local pre-push hook + GitHub Actions check (EST/EDT-aware)

### Bug Fixes
- NSIS uninstall hook removes `EmberStartup` scheduled task (fallback path for pre-v0.16.0 installs preserved)
- Set `state.emberPath` on boot so dev mode and version check work without navigating to the ember-path screen first
- Default install path is now Program Files (user-writable check still enforced)
- `autoUpdater` no longer fires on startup — surfaces only via Welcome banner
- Build output path moved to `C:/temp/ember-dist` to avoid path length limits on Windows

### Tests
- Bumped Done screen and startup-task timeouts to absorb `loadEmberVersion` runtime now that vault storage and startup registration extend the post-AGPL pipeline
- Startup-task "unchecked by default" test replaced with "checked by default after auto-registration" to match current product behavior
- 73 Playwright e2e tests

### Maintenance
- Pinned `electron-builder` to an exact version (supply chain hygiene)
- Bumped `@playwright/test`
- Stripped ~175 noise comments across renderer/main
- Consolidated top-level imports; removed dead code
- Expanded `.gitignore`
- `.release-please-manifest.json` drift fixed — bumped from 0.6.0 to 0.8.0

---

## v0.7.3 — 2026-04-13

### Bug Fixes
- Revert `runAfterFinish: false` — app must launch after NSIS install completes

### Tests
- 73 Playwright e2e tests

---

## v0.7.2 — 2026-04-13

### Bug Fixes
- Disable NSIS "Run after finish" to prevent unprompted installer relaunch
- Docker readiness check polls container health after `docker compose up -d`
- Remove jarring installer-update-banner popup on launch — rely on subtle Welcome-screen banner

### Documentation
- Sync CLAUDE.md version (v0.7.1) and test count (73)
- Expand README with current feature list, platform table, and dev commands
- Add explicit release process and gates to CLAUDE.md

### Tests
- 73 Playwright e2e tests

---

## v0.7.1 — 2026-04-12

### Bug Fixes
- Remove jarring update popup on launch — show subtle banner on Welcome screen instead
- Add Docker readiness check before starting services (BUG-011) — polls up to 60s, clear error
- Increase API health check timeout from 60s to 120s

### Tests
- 73 Playwright e2e tests

---

## v0.7.0 — 2026-04-12

### Features
- Update screen cute touches — rotating voice lines, per-row changelog notes, row flame animations during update, 8-second post-update celebration card
- HTML release notes panel on update screen — renders release_notes.html with scrollable "What's new" section
- Developer mode setup — checkbox on Done and Update screens, creates demo/test vault directories, writes dev config to .env
- Matrix easter egg on developer mode unlock — fullscreen Ember-orange rain with hearts, kitties, gems; typed message with blinking cursor; ESC to skip
- Rename Done screen buttons — "Launch Services" and "Open Ember" with explanatory hint

### Performance
- Parallelize pip install + model downloads — run concurrently since they use independent tools
- Parallelize winget prerequisite installs — Git, Python, Node, Ollama install concurrently; Docker last
- Shallow git clones — `--depth 1` on all clone operations

### Documentation
- Installer performance audit for v0.15.0
- v0.15.0 release notes rendered as HTML

### Tests
- 72 Playwright e2e tests (up from 48)

---

## v0.6.2 — 2026-04-10

### Security
- Restrict open-url IPC handler to safe URL schemes
- Delete UI .env file after build to prevent API key persistence on disk
- HTML-escape GitHub release body before rendering

### Bug Fixes
- Prevent double API start on update and add timeout to installer download

### Maintenance
- Fix comment drift and add missing documentation comments
- Update CLAUDE.md to v0.6.1 state

---

## v0.6.1 — 2026-04-09

### Maintenance
- Version bump for coordinated release with ember-2 v0.14.1 and ember-2-ui v0.7.1
- No functional changes

---

## v0.6.0 — 2026-04-06

### Features
- Launch Ember button on Done screen — runs the platform-appropriate launcher script (Docker, SearXNG, API, browser) in one click

### Infrastructure
- Release Please and GitHub Actions for automated release PRs via conventional commits

---

## v0.5.6 — 2026-04-04

### Features
- Unified update checker — checks installer, backend, and UI versions in parallel on startup and from Done screen
- "Update All" button with progress log — updates backend (git pull + pip + docker), UI (git pull + npm ci + build), and installer (electron-updater) in correct order
- Backend version now read from running API health endpoint, not version.json on disk
- Auto-restart API after backend/UI updates complete

### Fixes
- Auto-restart API after update instead of telling user to restart manually

### Infrastructure
- GitHub API calls time out after 4 seconds — offline or unreachable GitHub skips update check gracefully

---

## v0.5.5 — 2026-04-04

### Fixes
- Docker daemon running check — prereqs now verify the daemon is up, not just that Docker is installed; shows "Check again" button if stopped
- Existing installation detection — when target path already contains ember-2, offers Update (git pull), Fresh install (remove and re-clone), or Choose different location

### Infrastructure
- Release checklist hardened — CC owns full release process end to end; nothing is "done" until publicly downloadable

---

## v0.5.1 — 2026-04-03

### Features
- Auto-start Docker Desktop if daemon not running — polls up to 60s for readiness before running docker compose

### Fixes
- Inject API key into UI .env before Vite build — fresh installs were shipping with an empty VITE_EMBER_API_KEY, breaking all authenticated API calls
- Fun facts display duration increased from 8s to 14s — users couldn't finish reading them

### Infrastructure
- Prerequisite re-check race condition fixed — Next button now disabled during async checks
- GitHub Release publishing step added to release checklist

---

## v0.12.0 — 2026-04-02

### Features
- Mac/Linux support — platform-aware prerequisite checks, default paths, and startup scripts for Mac (DMG) and Linux (AppImage)
- Gatekeeper bypass instructions on Done screen for Mac users
- Linux keyring fallback — if SecretService unavailable, falls back to local file with 600 permissions and warning
- Homebrew check on Mac — soft warning if not installed, not a blocker

### Infrastructure
- Electron upgrade 28.3.3 → 29+ — unblocks Playwright e2e tests
- Playwright e2e tests now running — 12 tests passing (was blocked on Electron 28)

### Security
- No axios dependency — native fetch used throughout; confirmed unaffected by March 2026 axios supply chain attack

### Known Gaps
- Mac and Linux installer flows not yet tested on real hardware — Windows tested and confirmed working; Mac/Linux require community verification

### Tests
12 Playwright passing (up from 0 runnable at v0.4.1 due to Electron 28 block)

## v0.4.1 — 2026-03-30

### Features
- Update path now pulls and rebuilds ember-2-ui automatically (clone if missing, pull if exists, npm install, build, copy)
- Done screen verifies UI is built before enabling Open Ember — auto-rebuilds if missing
- Install retry resumes from failed step instead of restarting entire install
- Release notes rendered as markdown instead of raw text (headings, bold, bullets, horizontal rules)
- Playwright e2e test infrastructure added (tests written, blocked on Electron 28 compatibility)

### Fixes
- Reverted `app?.isPackaged` guard that changed runtime behavior

### Known Issues
- Playwright e2e tests require Electron 29+ for `--remote-debugging-pipe` support. Current version is Electron 28.3.3. Tests written and correct, blocked on upgrade. Tracked for v0.12.0.

## v0.4.0 — 2026-03-29

### Features
- Hardware detection at setup (RAM, GPU) with automatic model recommendation
- AGPL acknowledgment screen before setup completion
- Default model changed to qwen3:8b
- Model descriptions updated with real eval data and RAM requirements
- Model Selection Guide linked from model selection screen
- Retry button on Done screen with troubleshooting hints
- git pull uses origin main explicitly
- Update check label corrected
- Double-v prefix fix

## v0.3.0 — 2026-03-27
- Venv lock detection with friendly error message
- Auto-start API after install completes
- Health check before enabling Open Ember button
- Pip time warning callout (1-2 hours, warm tone)
- Progress bar + 95 AI fun facts during install
- Tailscale serve fixed to localhost binding
- Tailscale IP displayed to user during setup
- Consistent Ember-2 branding throughout
- Auto-install prerequisites via winget
- Curated model cards with disk sizes
- Disk space summary before install
- Node.js added to prerequisites

## v0.2.1 — 2026-03-24

### Installer is now the entry point
- Users no longer need the ember-2 repo — the installer clones it for them
- "Where should I install Ember?" replaces "Where is Ember?"
- Default install location: C:\Ember-2 (Windows) or ~/Ember-2 (Mac/Linux)
- git clone runs with live progress in a log box
- Auto-detects if ember-2 is already installed at the chosen location

### Git prerequisite
- Git added to prerequisites check alongside Docker, Python, and Ollama
- Download link to git-scm.com if not found

### Fixes
- Spaces in file paths: quoted python venv paths in pip/apikey install steps
- Model download buttons disabled while downloading (prevents double-clicks)
- Re-enabled after download completes or fails

## v0.2.0 — 2026-03-24

### UI Choice on Done Screen
- Detects if Open WebUI is running at localhost:3000
- Shows notice if detected: "We noticed you have Open WebUI running..."
- Two radio options: Ember's interface (recommended) or Open WebUI
- Choice saved to config.json in the ember-2 repo root
- "Open Ember" button launches whichever interface was chosen

### Update Checks
- Backend update check targets niansahc/ember-2 releases (currently v0.9.3)
- Fixed version.json parsing: reads `.version` field (not just `.tag`)
- Adds `v` prefix to version strings for consistent comparison
- Demo mode updated to show v0.9.3

### Fixes
- `fetchLatestRelease()` now accepts a repo parameter for targeting different repos
- Version display on Done screen shows correct installed version

## v0.1.0 — 2026-03-24

Initial release — Electron installer for Ember-2.
