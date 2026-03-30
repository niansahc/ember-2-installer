# Installer E2E Tests

## Status: Infrastructure only (not yet runnable)

Playwright Electron tests require `--remote-debugging-pipe` support,
which was added in Electron 29. The installer currently uses Electron
28.3.3. Until we upgrade to Electron 29+, these tests cannot launch
the app.

The test files are written and correct. Once the Electron version is
bumped, they should pass without changes.

## To run (after Electron upgrade)

```
npm run test:e2e
```

## Blocked by

- Electron 28.3.3 does not support `--remote-debugging-pipe`
- Playwright 1.58+ requires this flag for `_electron.launch()`
- Upgrade path: bump `electron` in package.json to `^29.0.0` or later
- Risk: electron-builder compatibility, autoUpdater changes, potential
  breaking changes in Electron 29

## Test files

- `navigation.spec.cjs` — screen flow, Next/Back buttons, prereq rendering
- `agpl.spec.cjs` — AGPL screen content and acknowledge button
- `hardware.spec.cjs` — hardware summary rendering on model screen
