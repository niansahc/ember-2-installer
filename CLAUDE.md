# CLAUDE.md — ember-2-installer

## Repo Identity
This is ember-2-installer — the Electron installer for Ember-2. Tab color: YELLOW.
If you are not in C:\Users\nians\OneDrive\Desktop\Ember-2\ember-2-installer, stop and check.

---

## What This Repo Is

The Ember-2 installer. Built with Electron and electron-builder. Produces a Windows NSIS installer, Mac DMG, and Linux AppImage.

The installer clones ember-2 and ember-2-ui, builds the UI, installs dependencies, sets up the vault, and configures the API key.

---

## Core Rules

- Do not use axios — use native fetch
- Do not break the Windows install flow — it is the primary tested platform
- Mac and Linux support is best-effort until tested on real hardware
- Platform differences must be handled via process.platform checks — never hardcode platform assumptions
- Do not auto-release — the human decides when to release

---

## Tech Stack

- Electron 29+
- electron-builder
- Playwright (e2e tests)
- Node.js

---

## Test Commands
```bash
# Run e2e tests
npm run test:e2e

# Build installer
npm run build

# Run in dev mode
npm start
```

---

## Working Conventions

- Small, frequent commits with clear messages
- Commit before moving to next item
- No releasing until the human says so
- If the human says PAUSE — stop and reorient
- If the human says STOP — drop the topic entirely

---

## Platform Notes

- Windows: primary platform, fully tested
- Mac: DMG target, Gatekeeper bypass documented, not yet tested on real hardware
- Linux: AppImage target, keyring fallback implemented, not yet tested on real hardware

---

## Release Checklist

- [ ] Installer builds cleanly
- [ ] Install flow tested end-to-end on Windows
- [ ] No uncommitted changes
- [ ] CHANGELOG.md updated
- [ ] version bumped in package.json
- [ ] Git tag created

---

## Repo Color
YELLOW — ember-2-installer (Electron installer)
