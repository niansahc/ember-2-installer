# Changelog

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
