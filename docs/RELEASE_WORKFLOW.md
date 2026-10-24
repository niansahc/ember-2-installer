# Release Workflow

## What the installer is (and isn't)

The installer is the Electron **setup wizard** only. Its packaged binary contains just the wizard
(`src/**`, `assets/**`, `release_notes.html`). It does **not** bundle the backend or the frontend:
at install time it clones ember-2 and ember-2-ui onto the user's machine, at the pinned release tag
(see Three-Repo Version Coordination), and builds the UI there (the `build-ui` step in `src/main.js`). So releasing the installer is just packaging the wizard —
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
user must reinstall manually. In-app self-update is wired for Windows only. On Linux (AppImage) and
macOS (unsigned DMG) the update is manual: the installer points the user to the GitHub Releases page
(see `MANUAL_PLATFORMS` in `src/lib/installer-update.js`).

## Three-Repo Version Coordination

All three repos share one version number. ember-2-installer is the source of truth for what ships
together: `emberRelease` in `package.json` names the ember-2 (backend) and ember-2-ui (frontend)
release, and the installer uses tag `v<emberRelease>` for both.

- **Fresh installs** clone both repos with `git clone --depth 1 --branch v<emberRelease>`
  (`src/exec/clone.js`).
- **Updates** move both repos to that same tag (`src/exec/move-to-tag.js`) when they need it
  (`src/exec/pin-action.js`): the tag is newer than what is installed (backend `version.json`
  `version`, UI `package.json`), the installed version is unknown, or the version equals the pin but
  HEAD is not at the tag (`main` between releases carries the last release's number). Nothing is
  downgraded, and nothing clones or pulls `main`.
- **A move is refused** for a full (non-shallow) clone such as a developer's working repo, a clone
  whose stored `origin` is another repository (read with `git config`, so a `url.<base>.insteadOf`
  rewrite does not count), and a clone with edited tracked files. The two files the installer itself
  rewrites, backend `version.json` and UI `package-lock.json`, are reset to the tag after the fetch
  succeeds, so edits to them are discarded by a move and kept by a failed one. The reason is shown on
  the screen that asked for the move.
- **A full ember-2-ui clone** (installers before `--depth 1` made them) cannot be moved. A packaged
  install renames it to `ember-2-ui.old-<date>`, keeps it, and clones the pin in its place, putting it
  back if that clone fails. Unpackaged dev mode (`npm run start:real`) builds the developer's clone as
  it stands, with a warning, and never moves or renames it (`src/exec/ui-to-pin.js`).
- **The UI is rebuilt** whenever the served build was not recorded as made from the pin, except for a
  clone ahead of the pin, which is left as it is. Each build is copied to `ui.new` and swapped in for
  `ui/` only once complete, with the tag recorded in `ui/ember-ui-build.json`
  (`src/exec/ui-build.js`). A build that failed after the move, and a build made without the API key,
  have no record, so the next check offers the rebuild.
- **The backend setup** (pip install, `docker compose up`, API restart) is recorded in
  `.venv/ember-backend-setup.json` once all three succeed and the API answers with the version on
  disk (`src/exec/backend-setup.js`); the install flow records it once its pip and docker steps
  succeed. A clone at the pin with no record shows "(needs setup)" and Update All runs the setup
  again, so an update that stopped part way is finished on the next run.
- **One clone, move, build or update runs at a time** (`src/lib/exclusive.js`); a second one is
  refused with the name of the running one. "Start fresh" renames the existing ember-2 aside and puts
  it back if the new clone fails (`src/exec/aside.js`).
- **The update screen** targets the pin for the backend and UI rows, not GitHub's latest release. A
  newer backend or UI reaches users with the installer release that pins it, and appears after the
  installer updates itself (on Linux and macOS, after the user downloads the new installer).

Who bumps `emberRelease`:

- **Coordinated release** (all three repos): once the ember-2 and ember-2-ui tags exist, set
  `emberRelease` to the new version in the installer's release-please PR before merging it. It then
  equals `version`.
- **Installer-only patch release:** leave `emberRelease` alone. It stays behind `version`, at the same
  major.minor, so the tags it names still exist.

Checks:

- `tests/e2e/release-pin.spec.cjs` fails if `emberRelease` is not x.y.z, has a different major.minor
  from `version`, or is newer than `version`. A release-please PR that bumps the minor therefore stays
  red until `emberRelease` is bumped with it.
- The `check-pinned-tags` job in `release.yml` runs before any build and fails the release if
  `v<emberRelease>` is missing from either repo (`git ls-remote --exit-code --tags`). A repo it
  cannot reach fails the job too, with its own message, so re-run it rather than checking tags.

## Automated Release (implemented)

Release is automated via GitHub Actions and stays human-gated:

1. **release-please** (`.github/workflows/release-please.yml`) maintains a release PR with the
   auto-generated changelog and version bump. Per CLAUDE.md these PRs are **never** auto-merged.
2. When the human merges the release PR, release-please creates a **published** GitHub Release
   (`draft: false` in `release-please-config.json`) at tag `vX.Y.Z`.
3. **`.github/workflows/release.yml`** fires on `release: published`. It runs the
   `check-pinned-tags` gate first (ubuntu-latest), then three build jobs (windows-latest,
   macos-latest, ubuntu-latest) that each wait for it, each `electron-builder --<platform> --publish
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

Network egress is checked outside CI by the fresh-install capture gate: the real installer on a
clean Windows 11 VirtualBox guest, compared against the declared download list
(`docs/network-destinations.json`). Procedure: `docs/NETWORK_GATE.md`. CI runs only its logic and
drift tests (`npm run test:netgate`).

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

1. Bump the version in `package.json` (normally release-please does this), and `emberRelease` too
   for a coordinated release. Confirm both `v<emberRelease>` tags exist.
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
- `emberRelease` naming a tag that does not exist: every fresh install fails at the clone. The
  `check-pinned-tags` job in `release.yml` blocks the release before anything is built.
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
