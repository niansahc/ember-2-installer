# Changelog

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
