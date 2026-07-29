# CLAUDE.md — ember-2-installer

## Repo Identity
This is ember-2-installer — the Electron installer for Ember-2. Tab color: YELLOW.
If you are not in C:\Users\nians\OneDrive\Desktop\Ember-2\ember-2-installer, stop and check.

---

## Response brevity

Reports and status updates: facts, numbers, hashes. No narrative.

No preamble. No "I'll now..." or "Let me..."
No postamble. No "Let me know if..." or "Want me to..."
No apology unless a real error occurred.
No restatement of the request before answering it.

Grill answers: number only unless clarification needed.

Report format: what changed, the identifier (commit/PR/branch), verification result. One line per fact when possible. Prose only when explanation genuinely aids understanding.

Do not narrate what you are about to do. Do it and report the result.

Exceptions: real diagnoses, real trade-off explanations, and grill findings where the model of the world matters. Verbosity there is signal.

---

## What This Repo Is

The Ember-2 installer. Built with Electron and electron-builder. Produces a Windows NSIS installer (built and verified). Mac DMG and Linux AppImage targets are configured in electron-builder but have not been built or verified on real hardware.

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

Shipped release: v0.8.1. **0.18.0 is staged but not cut** — release-please PR #5 ("chore(main): release ember-2-installer 0.18.0") is open and holds the generated changelog and version bump; `package.json` is still 0.8.1. The version jump is deliberate: it aligns the installer with the ember-2 backend so all three repos share one number. Update-panel copy for 0.18.0 is already written (`release_notes.html`, commit `c1e9683`).

108 e2e + 11 integration Playwright tests. Builds and ships the Windows NSIS installer (primary, verified). The Linux AppImage now builds in CI; Mac DMG is configured but not built or verified. Neither Mac nor Linux is verified on real hardware.

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

**No Claude attribution.** Never add `Co-Authored-By: Claude` or any Claude attribution to commit messages or PR bodies. Attribution is acknowledged in `docs/BUILDING_EMBER.md`, nowhere else.

---

## Release Process

Full release process, gates, and sequence: run `/pre-release`

Release-please PRs (title format: "chore(main): release X.Y.Z") must NEVER have auto-merge enabled. These PRs require explicit human approval and manual merge only. The human decides when a release is cut. All other PR types (feat, fix, docs, test, chore non-release) may use auto-merge as normal.

---

## Known Issues

- Mac and Linux install flows are not tested on real hardware — Windows is the only fully validated platform.
- Clean install testing on a fresh machine is a known gap due to hardware constraints.
- **Linux Build fails on every push to `main`** — `build:linux` has no `--publish` flag, so electron-builder's CI implicit publish fires and aborts on a missing `GH_TOKEN`. The AppImage itself builds fine. PR runs pass because electron-builder skips publish on `pull_request` events. Fix: add `--publish never` to `build:linux`. Details in `docs/RELEASE_WORKFLOW.md`.
- **Flaky Linux e2e** — `edge-cases.spec.cjs` "rapid double-click on Next does not skip screens" intermittently fails on Linux CI (stays on `screen-welcome`); the synchronous `evaluate()` clicks can land before the renderer binds handlers. Must be fixed or skip-with-condition before 0.18.0 ships. Details in `docs/RELEASE_WORKFLOW.md`.

---

## Claude Code Efficiency Rules

Use parallel subagents for any task touching 3+ independent files. Auto-run tests after code edits. Auto-reject changes to private_vault/ or .env files.

---

## Git Hooks (business hours push protection)

Blocks pushes during US Eastern business hours (9am-5pm Mon-Fri). Local hook: `hooks/pre-push`. GitHub Actions: `.github/workflows/business-hours-check.yml`.

---

## Hooks

Configured in `.claude/settings.json`, scripts in `.claude/hooks/`. Pre-edit hook rejects .env files. Post-edit hook runs `npm run test:e2e` on source file changes.
