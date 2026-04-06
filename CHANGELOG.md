# Changelog

## v0.14.0 — 2026-04-06

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
