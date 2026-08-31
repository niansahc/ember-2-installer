# Release Workflow

## What the installer is (and isn't)

The installer is the Electron **setup wizard** only. Its packaged binary contains just the wizard
(`src/**`, `assets/**`, `release_notes.html`). It does **not** bundle the backend or the frontend:
at install time it clones ember-2 and ember-2-ui onto the user's machine and builds the UI there
(the `build-ui` step in `src/main.js`). So releasing the installer is just packaging the wizard —
there is no frontend build at release time.

## How electron-updater Works

electron-updater checks the GitHub Releases API for a published release containing a `latest*.yml`
(per platform: `latest.yml`, `latest-mac.yml`, `latest-linux.yml`). It does NOT use git tags. A tag
without a published release is invisible to the update checker.

Three things must be present for auto-update to work:
- `latest*.yml` -- attached to the GitHub Release by electron-builder; tells the running app what
  version is available
- `app-update.yml` -- embedded inside the packaged app at build time; tells the running app which
  GitHub repo to check
- The installer binary (`.exe`, `.dmg`, `.AppImage`)

If `app-update.yml` is missing from an installed version, that version can never auto-update; the
user must reinstall manually. In-app self-update is wired for Windows; on Linux it is a manual
AppImage download and on macOS it is untested (see `download-installer-update` in `src/main.js`).

## Three-Repo Version Coordination

ember-2-installer is the source of truth for what ships together. Document the ember-2 (backend)
and ember-2-ui (frontend) versions a release expects in that release's notes.

## Automated Release (implemented)

Release is automated via GitHub Actions and stays human-gated:

1. **release-please** (`.github/workflows/release-please.yml`) maintains a release PR with the
   auto-generated changelog and version bump. Per CLAUDE.md these PRs are **never** auto-merged.
2. When the human merges the release PR, release-please creates a **published** GitHub Release
   (`draft: false` in `release-please-config.json`) at tag `vX.Y.Z`.
3. **`.github/workflows/release.yml`** fires on `release: published` and runs three jobs
   (windows-latest, macos-latest, ubuntu-latest), each `electron-builder --<platform> --publish
   always`, attaching that platform's installer plus its `latest*.yml` to the release.

Conventional commits (`feat:`, `fix:`, `chore:` ...) drive the semver bump. The workflow never cuts
a release on its own — it only reacts to the human-merged release PR.

### Signing / Gatekeeper caveats

Artifacts are currently unsigned: the Windows `.exe` triggers SmartScreen and the macOS `.dmg` is
not notarized (Gatekeeper-blocked; right-click-open to run). Code signing is tracked separately.

## CI Verification

- **`windows-build.yml`** -- builds the app (`--win --dir`) and runs the full Playwright suite on
  windows-latest (the primary platform) on every PR / push to main.
- **`linux-build.yml`** -- builds the AppImage and runs the suite on Linux via xvfb.

Both run the demo-mode suite only; real system integrations (docker, systemctl, package managers)
remain best-effort and untested on hardware.

### Linux CI defects (fixed 2026-07-29 — kept for context)

Two separate defects, both surfacing through `linux-build.yml`. Both are fixed; the reasoning is
recorded here because the first will recur if a packaging build is ever added to a verification
workflow.

**1. Linux Build failed on every push to `main` — implicit publish, no token.**

`npm run build:linux` ran `electron-builder --linux` with no `--publish` flag. electron-builder
detects CI and triggers implicit publishing, then aborts:

```
⨯ GitHub Personal Access Token is not set, neither programmatically, nor using env "GH_TOKEN"
```

The AppImage builds successfully first — packaging is fine, only the publish attempt fails. The job
exits 1 at the build step, so the e2e suite never runs on those pushes.

electron-builder skips implicit publish on `pull_request` events, which is why the same commit
passes on a PR and fails once merged. Every `push`-event Linux run has failed this way; the last
green `push` run predates the workflow.

Windows was unaffected because `windows-build.yml` builds with `--dir` (no packaging, so no publish
step).

**Fixed** by adding `--publish never` to `build:linux`. Verification builds must never publish.
`release.yml` is the only workflow that legitimately publishes, and it invokes `npx electron-builder
--<platform> --publish always` directly with `GH_TOKEN` set — it does not go through the npm
scripts, so the change does not affect releases.

`build`, `build:win`, and `build:mac` still carry no `--publish` flag. They are developer-local
scripts today and CI never calls them, so they are not currently a problem — but wiring any of them
into a CI job without `--dir` or `--publish never` reproduces this failure exactly.

**2. `edge-cases.spec.cjs` "rapid double-click on Next does not skip screens" was flaky on Linux.**

Failed on the PR run for #28 (107 passed, 1 failed); passed on the next PR run with no relevant code
change. Not reproduced on Windows.

```
Expected: "screen-prereqs"
Received: "screen-welcome"
```

The app never left the welcome screen — both clicks were swallowed. The test fires two synchronous
`btn.click()` calls via `window.evaluate()` immediately after `launchApp()`, and `launchApp` waits
only for `domcontentloaded`. The `[data-next]` handlers are bound by a plain `addEventListener` loop
in `src/renderer/app.js` (~line 75), inside a classic `<script>` at the end of `<body>`. If the
clicks land before that script executes, the button is parsed and clickable but inert, and the
assertion then polls a screen that will never change. `toHaveAttribute` retries for 5s, which cannot
recover an already-lost click.

The precise reason `domcontentloaded` was insufficient is unconfirmed — the likely mechanism is
`firstWindow()` resolving against the initial blank document, so the load-state wait returns before
the real page navigation. The applied fix does not depend on which mechanism it is.

**Fixed** in `tests/e2e/edge-cases.spec.cjs`: wait for `load`, then `waitForFunction` on a symbol
`app.js` defines (`window.showScreen`), before the `evaluate()`. That polls the live document, so it
holds regardless of which document the initial load-state wait saw. Verified with `--repeat-each=5`
(70 passed) plus the full suite (108 passed) and integration (11 passed) on Windows.

Correction to an earlier note in this file's history: the handlers involved are *not* the `guardClick`
wrappers from `c0aaecc`. `[data-next]` navigation uses an unwrapped listener; `guardClick` was not a
factor.

Per the testing discipline in CLAUDE.md, this must be fixed or marked skip-with-condition before
0.18.0 ships.

## Manual Release (fallback)

If you must release by hand:

1. Bump the version in `package.json` (normally release-please does this).
2. `npm ci`
3. `npx electron-builder --<platform> --publish always` with `GH_TOKEN` set -- or run a local build
   and upload the installer binary + `latest*.yml` to the published (non-draft) GitHub Release.
4. Verify `app-update.yml` is in the build output and `latest*.yml` is attached to the release.

## Failure Modes to Watch

- Draft release: electron-updater sees nothing; users get no update notification; no error shown
- Missing `latest*.yml`: update checker finds the release but cannot read version info; silent
  failure
- Missing `app-update.yml`: affected installed versions can never auto-update; requires manual
  reinstall
- Version not bumped: electron-updater compares versions and concludes no update available
- Publish type mismatch: electron-builder defaults to `releaseType: draft`. release-please publishes
  the release immediately (`draft: false`), so electron-builder finds `existingType=release`,
  logs `skipped publishing ... reason=existing type not compatible with publishing type`, attaches
  nothing, and **still exits 0** — the job goes green with an empty release. This is what happened
  to v0.18.0. `releaseType: release` is now pinned in `electron-builder.yml`. A green Release run is
  not sufficient evidence that assets attached; check the asset count on the release itself.

## Repairing a release whose assets did not attach

`release.yml` also accepts `workflow_dispatch`. A `release`-event re-run checks out the release tag
and therefore cannot pick up a fix landed on main afterwards, so dispatch from main instead: it
builds the version in `package.json` and uploads to the existing release for that version, with no
need to move a published tag.

Verify with `gh release view vX.Y.Z --json assets` — expect the platform installer, its `.blockmap`,
and `latest*.yml` per platform.
