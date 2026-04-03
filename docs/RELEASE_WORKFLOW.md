# Release Workflow

## How electron-updater Works

electron-updater checks GitHub Releases API for a published release containing latest.yml. It does NOT use git tags. A tag without a published release is invisible to the update checker.

Three files must be present for auto-update to work:
- latest.yml -- attached to the GitHub Release by electron-builder; tells the running app what version is available
- app-update.yml -- embedded inside the packaged app at build time; tells the running app which GitHub repo to check
- The installer binary (.exe, .dmg, .AppImage)

If app-update.yml is missing from an installed version, that version can never auto-update. The user must reinstall manually.

## Three-Repo Version Coordination

ember-2-installer is the source of truth for what ships together. Each release of the installer must pin specific versions of:
- ember-2 (backend) -- the git tag or commit included
- ember-2-ui (frontend) -- the git tag or commit built and bundled

Document these versions in the release notes for every release.

## Frontend Build Requirement

The frontend (ember-2-ui) must be freshly built from the correct tagged source before packaging. electron-updater cannot build on the user's machine. Users do not have Node.js or dev dependencies installed. The built dist is bundled into the installer binary.

Never package a stale frontend dist. Always build from the pinned ember-2-ui version as part of the release process.

## Current Manual Release Process (pre-automation)

Until GitHub Actions CI is in place, the manual release process is:

1. Bump version in package.json
2. git pull the pinned ember-2-ui tag
3. cd ember-2-ui && npm ci && npm run build
4. Copy dist output to installer's expected location
5. Run electron-builder
6. Verify app-update.yml is present in build output
7. Verify latest.yml was attached to the GitHub Release
8. Publish the GitHub Release (not draft)
9. Verify the release is visible at https://github.com/niansahc/ember-2-installer/releases

## Planned: GitHub Actions Automation (v0.14.0)

The target workflow:
- Release Please maintains a release PR with auto-generated changelog and version bump
- Merging the release PR creates a tag and a GitHub Release
- A GitHub Actions workflow triggered on release publication:
  1. Clones ember-2-ui at the pinned tag
  2. Runs npm ci and npm run build
  3. Downloads the pinned ember-2 backend release artifact
  4. Runs electron-builder --publish always
  5. Attaches all artifacts to the GitHub Release automatically
- Conventional commits (feat:, fix:, chore:) drive automatic semver bumping

Until this is in place, the manual checklist above applies to every release.

## Failure Modes to Watch

- Draft release: electron-updater sees nothing; users get no update notification; no error shown
- Missing latest.yml: update checker finds the release but cannot read version info; silent failure
- Missing app-update.yml: affected installed versions can never auto-update; requires manual reinstall
- Stale frontend: backend updates, frontend does not; silent API incompatibilities
- Version not bumped: electron-updater compares versions and concludes no update available
