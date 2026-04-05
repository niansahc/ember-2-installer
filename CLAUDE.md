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

## Testing Discipline

When a flaky or condition-dependent test is identified during a release cycle, it must be fixed or marked skip-with-condition before that release ships. Flaky tests do not carry forward to the next release.

---

## Working Conventions

- Small, frequent commits with clear messages
- Commit before moving to next item
- No releasing until the human says so
- If the human says PAUSE — stop and reorient
- If the human says STOP — drop the topic entirely

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

## Release Checklist

**Critical principle: CC runs the full release process. Nothing is "done" until it is publicly downloadable. Never assume the human is cutting the release unless they explicitly say so.**

A release is not complete at commit. A release is not complete at tag. A release is complete when:
- The GitHub Release is published (not draft)
- Artifacts are attached (installer .exe / source)
- latest.yml is present in release assets (installer only)
- The release is visible and downloadable at the GitHub Releases URL
- CC has verified the above and reported the URL

### Pre-release (run before every release)

**ember-2 (backend):**
- [ ] All tests passing: pytest tests/
- [ ] Retrieval eval passing: python tools/eval_retrieval.py -- no regression
- [ ] Conversation eval run: python tools/eval_conversations.py -- document results
- [ ] CHANGELOG.md updated
- [ ] version.json bumped
- [ ] All changes committed and pushed to main: git push origin main
- [ ] Constitution, nature, and Lodestone layers reviewed for coherence
- [ ] Research review: any watch items ready to graduate to roadmap?

**ember-2-ui (frontend):**
- [ ] All Playwright tests passing: npm run test:e2e
- [ ] CHANGELOG.md updated
- [ ] package.json version bumped
- [ ] All changes committed and pushed to main: git push origin main
- [ ] UI rebuilt from correct source: npm ci && npm run build

**ember-2-installer (installer):**
- [ ] All Playwright tests passing
- [ ] CHANGELOG.md updated (release-please handles this via conventional commits)
- [ ] package.json version bumped (release-please handles this via conventional commits)
- [ ] All changes committed and pushed to main: git push origin main
- [ ] Frontend freshly built from pinned ember-2-ui tag before packaging
- [ ] Backend version pinned and documented in release notes
- [ ] Installer built: npm run dist
- [ ] app-update.yml present in dist/win-unpacked/resources/ -- verify before publishing
- [ ] latest.yml will be attached to release by electron-builder -- verify after publishing

### Release (CC runs this, not the human)

- [ ] Git tag created: git tag vX.X.X
- [ ] Tag pushed: git push origin vX.X.X
- [ ] GitHub Release created (NOT draft): gh release create vX.X.X --title "vX.X.X" --notes "..." --latest
- [ ] Artifacts attached to release (installer .exe for yellow, source zip for green)
- [ ] Release verified as published and visible: gh release view vX.X.X
- [ ] Release URL reported to human: https://github.com/niansahc/ember-2-installer/releases/tag/vX.X.X

### Post-release verification (CC runs this)

- [ ] Confirm release appears at https://github.com/niansahc/ember-2-installer/releases
- [ ] Confirm latest.yml is present in release assets (installer only)
- [ ] Confirm version matches package.json / version.json
- [ ] Report to human: "Release vX.X.X is live at [URL]. Users can download/update now."

### Patch releases

Patch releases follow the same checklist. There are no shortcuts for patches. A patch that is committed but not published is not a patch -- it is unpublished work. Every patch must complete the full release process before being called done.

---

## Repo Color
YELLOW — ember-2-installer (Electron installer)
