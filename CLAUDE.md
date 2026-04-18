# CLAUDE.md — ember-2-installer

## Repo Identity
This is ember-2-installer — the Electron installer for Ember-2. Tab color: YELLOW.
If you are not in C:\Users\nians\OneDrive\Desktop\Ember-2\ember-2-installer, stop and check.

---

## What This Repo Is

The Ember-2 installer. Built with Electron and electron-builder. Produces a Windows NSIS installer, Mac DMG, and Linux AppImage.

The installer clones ember-2 and ember-2-ui, builds the UI, installs dependencies, sets up the vault, and configures the API key.

Key optimizations and features:
- Parallel prerequisite installs (Git, Python, Node, Ollama concurrently; Docker last)
- Parallel pip + Ollama model downloads during install
- Unified update checker — checks installer, backend, and UI versions in parallel on startup
- HTML release notes panel with scrollable "What's new" section on the update screen
- Installer self-update via electron-updater
- Developer mode — checkbox on Done/Update screens; creates demo/test vault directories, writes dev config, triggers a Matrix-style easter egg animation

---

## Current State

v0.7.3. 73 Playwright tests passing. Produces Windows NSIS installer (primary), Mac DMG, and Linux AppImage (both best-effort until tested on real hardware).

---

## Install Flow

The installer walks the user through 12 screens:

1. **Welcome** — intro screen
2. **Prerequisites** — detects and auto-installs dependencies (winget on Windows, Homebrew soft check on Mac, package manager on Linux)
3. **Install location** — user picks where to install Ember-2, with detection of existing installations
4. **Vault setup** — user picks or creates a private vault directory
5. **Model selection** — curated model cards with eval-based descriptions, disk sizes, and RAM requirements
6. **Vision model** — optional vision model toggle and selection
7. **Host configuration** — local-only or Tailscale for multi-device access
8. **Summary** — review all choices before installing
9. **Install** — writes config, creates venv, installs pip dependencies, sets API key, builds UI, starts search engine (parallel where possible)
10. **AGPL acknowledgment** — user confirms understanding of the AGPL-3.0 license
11. **Done** — starts the API, polls until healthy, shows vault storage estimate
12. **Update** — checks for backend, UI, and installer updates with HTML release notes

---

## Inter-Repo Dependencies

The installer shallow-clones (`--depth 1`) ember-2 and ember-2-ui at specific tags. Frontend must be built from the pinned ember-2-ui tag — never from an unpinned clone. Backend version must be documented in release notes. Mismatched versions will produce an installer that ships stale UI or incompatible backend.

---

## Core Rules

- Do not use axios — use native fetch
- Do not break the Windows install flow — it is the primary tested platform
- Mac and Linux support is best-effort until tested on real hardware
- Platform differences must be handled via process.platform checks — never hardcode platform assumptions
- Do not auto-release — the human decides when to release
- Do not use the word "shape" in any output — code comments, prompts, prose, or conversation. Use a more precise alternative.

---

## Vault Privacy Rule

Vault contents — including names, conversation text, and record IDs — must never appear in code, tests, commits, scripts, or docs. This rule has no exceptions. If a test requires memory data, use synthetic fixture data only.

---

## Tech Stack

- Electron 33+
- electron-builder
- electron-updater (installer self-update)
- Playwright (e2e tests)
- Node.js

---

## Test Commands
```bash
# Run e2e tests
npm run test:e2e

# Build installer
npm run build

# Run in dev mode (demo mode — see below)
npm start

# Run in dev mode with real infrastructure
npm run start:real
```

**Demo mode:** `npm start` runs in demo mode by default. Every IPC handler that touches real infrastructure (git, pip, docker, ollama, tailscale, filesystem) is replaced with a fake that returns realistic data after a short delay. This means `npm start` does not touch Ollama, the real API, or any live services. Use `npm run start:real` (or `--real` flag) to connect to real infrastructure.

## Testing Discipline

When a flaky or condition-dependent test is identified during a release cycle, it must be fixed or marked skip-with-condition before that release ships. Flaky tests do not carry forward to the next release.

---

## Working Conventions

- Small, frequent commits with clear messages
- Commit before moving to next item
- No releasing until the human says so
- If the human says PAUSE — stop and reorient
- If the human says STOP — drop the topic entirely
- Use TaskCreate and TaskUpdate to maintain a visible task list for every multi-step task. Update it as work completes.

---

## Conventional Commits (Required)

Format: `type(scope): description`. Types: feat, fix, chore, docs, refactor, test, ci. Breaking changes: append `!`. release-please reads these for changelogs and version bumps.

---

## Release Process

Full release process, gates, and sequence: run `/pre-release`

---

## Known Issues

- Mac and Linux install flows are not tested on real hardware — Windows is the only fully validated platform.
- Clean install testing on a fresh machine is a known gap due to hardware constraints.

---

## Claude Code Efficiency Rules

Use parallel subagents for any task touching 3+ independent files. Auto-run tests after code edits. Auto-reject changes to private_vault/ or .env files.

---

## Git Hooks (business hours push protection)

Blocks pushes during US Eastern business hours (9am-5pm Mon-Fri). Local hook: `hooks/pre-push`. GitHub Actions: `.github/workflows/business-hours-check.yml`.

---

## Hooks

Configured in `.claude/settings.json`, scripts in `.claude/hooks/`. Pre-edit hook rejects .env files. Post-edit hook runs `npm run test:e2e` on source file changes.
