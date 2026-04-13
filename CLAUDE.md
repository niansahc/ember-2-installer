# CLAUDE.md — ember-2-installer

## Repo Identity
This is ember-2-installer — the Electron installer for Ember-2. Tab color: YELLOW.
If you are not in C:\Users\nians\OneDrive\Desktop\Ember-2\ember-2-installer, stop and check.

---

## What This Repo Is

The Ember-2 installer. Built with Electron and electron-builder. Produces a Windows NSIS installer, Mac DMG, and Linux AppImage.

The installer clones ember-2 and ember-2-ui, builds the UI, installs dependencies, sets up the vault, and configures the API key.

---

## Current State

v0.7.3. 73 Playwright tests passing. Produces Windows NSIS installer (primary), Mac DMG, and Linux AppImage (both best-effort until tested on real hardware).

---

## Install Flow

The installer runs a multi-step sequence:

1. **Prerequisite detection and auto-install** — winget on Windows, Homebrew soft check on Mac, package manager on Linux
2. **Model selection** — curated model cards with eval-based descriptions, disk sizes, and RAM requirements
3. **Vault setup** — user picks or creates a private vault directory
4. **API key configuration** — stored in OS credential store
5. **Clone ember-2 and ember-2-ui** — at pinned version tags
6. **Build UI** — `npm ci && npm run build` from the ember-2-ui source
7. **Copy build into ember-2** — built `dist/` copied to `ember-2/ui/`
8. **API health check polling** — Done screen starts the API and polls until healthy

---

## Inter-Repo Dependencies

The installer clones ember-2 and ember-2-ui at specific tags. Frontend must be built from the pinned ember-2-ui tag — never from an unpinned clone. Backend version must be documented in release notes. Mismatched versions will produce an installer that ships stale UI or incompatible backend.

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
- Use TodoWrite and TodoRead tools to maintain a visible task list for every multi-step task. Update it as work completes.

---

## Conventional Commits (Required)

All three Ember-2 repos use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) and release-please for automated release PRs.

**Format:** `type(scope): description`

**Types:**
- `feat` — new feature (bumps minor)
- `fix` — bug fix (bumps patch)
- `chore` — maintenance, version bumps, config changes
- `docs` — documentation only
- `refactor` — code change that neither fixes a bug nor adds a feature
- `test` — adding or updating tests
- `ci` — CI/CD changes

**Breaking changes:** append `!` after the type — e.g., `feat!: redesign install flow`. This bumps major (or minor while pre-1.0).

**Scope** is optional but encouraged — e.g., `feat(installer): ...`, `fix(updater): ...`

**Examples:**
```
feat(installer): add nomic-embed-text to model pull flow
fix(installer): kill and restart API after backend update
chore: bump version to v0.5.9
docs: add conventional commit guide to CLAUDE.md
```

release-please reads these commit messages to auto-generate changelogs and determine version bumps. The release PR is created automatically but requires human approval before merging.

---

## Platform Notes

- Windows: primary platform, fully tested
- Mac: DMG target, Gatekeeper bypass documented, not yet tested on real hardware
- Linux: AppImage target, keyring fallback implemented, not yet tested on real hardware

---

## Release Process

### Gates — mandatory before any release or patch is cut

**Documentation gate (all three repos):**
- [ ] CLAUDE.md version and test count current
- [ ] TDD updated to reflect what shipped (G only)
- [ ] README reflects current features
- [ ] CHANGELOG.md current (release-please handles via commits)

**Quality gate:**
- [ ] All tests passing
- [ ] Retrieval eval passing with no regression (G only)
- [ ] No flaky tests carried forward

**Coordination gate:**
- [ ] All three repos confirm docs and tests green
- [ ] Human approves before any tag is created
- [ ] GitHub Release not created until human says go

### Sequence

1. G, M, Y each complete documentation and quality gates
2. Each reports green to manager
3. Manager confirms all three green and gets human approval
4. G coordinates the release — tags all three repos, creates GitHub Releases
5. Y attaches installer artifacts (.exe, latest.yml)
6. G verifies all three releases are publicly visible
7. G reports release URLs — release is not done until this step

### Y independent releases

Y may cut an installer-only release when:
- Changes are installer-specific only (no backend or UI updates)
- Human explicitly approves
- Y completes documentation and quality gates independently
- Y tags, creates GitHub Release, attaches artifacts, and reports URL

Y does NOT cut independent releases when backend or UI changes are involved — coordinate with G.

### release-please

All three repos use release-please for automated release PRs.
Conventional commits are required. Release PRs require human approval before merging.

---

## Known Issues

- Mac and Linux install flows are not tested on real hardware — Windows is the only fully validated platform.
- Clean install testing on a fresh machine is a known gap due to hardware constraints.

---

## Repo Color
YELLOW — ember-2-installer (Electron installer)

---

## Claude Code Efficiency Rules

**Parallel subagents — use them.**
Any task touching 3+ independent files or with clearly separable subtasks must use parallel subagents. Do not work sequentially when work can be fanned out. Spawn subagents, merge results.

**Hooks — always active:**
- Auto-run tests after any code edit (pytest for G, npm run test:e2e for M and Y)
- Auto-reject any changes to private_vault/ or .env files

**Scheduled tasks:**
- Weekly dependency audit — flag outdated or vulnerable packages in requirements.txt / package.json
- Pre-release cross-repo consistency check — verify UI matches backend API responses before any release

**Session naming:**
- Always name sessions descriptively, e.g. `claude -n "vault-citation-backend"`
- Enables resumption with full context.

---

## Hooks

Configured in `.claude/settings.json`. Hook scripts live in `.claude/hooks/`.

**Pre-edit: reject .env files** (`reject-env-edit.sh`)
- Fires on `PreToolUse` for Edit and Write tools
- Checks `tool_input.file_path` — blocks with exit code 2 if the target is a `.env` file
- Prevents accidental credential exposure

**Post-edit: auto-run tests** (`run-tests.sh`)
- Fires on `PostToolUse` for Edit and Write tools
- Only runs `npm run test:e2e` when the edited file is in `src/` or `tests/` (`.js`, `.html`, `.css`, `.cjs`)
- Skips for non-source files (CLAUDE.md, package.json, etc.)
- 300-second timeout to accommodate the full Playwright suite
