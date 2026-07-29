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

### Known CI failures (open as of 2026-07-29)

Two separate defects, both in `linux-build.yml`. Windows and Integration are green.

**1. Linux Build fails on every push to `main` — implicit publish, no token.**

`npm run build:linux` runs `electron-builder --linux` with no `--publish` flag. electron-builder
detects CI and triggers implicit publishing, then aborts:

```
⨯ GitHub Personal Access Token is not set, neither programmatically, nor using env "GH_TOKEN"
```

The AppImage builds successfully first — packaging is fine, only the publish attempt fails. The job
exits 1 at the build step, so the e2e suite never runs on those pushes.

electron-builder skips implicit publish on `pull_request` events, which is why the same commit
passes on a PR and fails once merged. Every `push`-event Linux run has failed this way; the last
green `push` run predates the workflow.

Windows is unaffected because `windows-build.yml` builds with `--dir` (no packaging, so no publish
step).

Fix: add `--publish never` to the `build:linux` script in `package.json`. Verification builds should
never publish — `release.yml` is the only workflow that legitimately publishes, and it passes
`--publish always` with `GH_TOKEN` set.

**2. `edge-cases.spec.cjs` "rapid double-click on Next does not skip screens" is flaky on Linux.**

Failed on the PR run for #28 (107 passed, 1 failed); passed on the next PR run with no relevant code
change. Not reproduced on Windows.

```
Expected: "screen-prereqs"
Received: "screen-welcome"
```

The app never left the welcome screen. The test calls `window.evaluate()` to fire two synchronous
`btn.click()` calls immediately after `launchApp()`, without first waiting for the button to be
actionable. On a slower Linux runner the clicks land before the renderer binds its click handlers,
so both are no-ops and the assertion polls a screen that will never change. `toHaveAttribute` retries
for 5s, which cannot help once the clicks are already lost.

Note that the handlers in question are the `guardClick` wrappers added in `c0aaecc`; whether that
commit widened the binding window is unconfirmed.

Fix: await an actionability check on `button[data-next="screen-prereqs"]` before the `evaluate()`,
so the double-click races handler binding no more than the real UI does.

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
