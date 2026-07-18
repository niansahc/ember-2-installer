# Installer E2E Tests

## Status: Running

The suite runs against the packaged Electron app via Playwright's
`_electron.launch()`. The installer is on Electron 33, which supports the
`--remote-debugging-pipe` transport Playwright requires, so the tests launch
and drive the app directly.

## To run

```
npm run test:e2e
```

Tests run in demo mode by default — every IPC handler that would touch real
infrastructure (git, pip, docker, ollama, tailscale, filesystem) is replaced
with a fake returning realistic data. No live services are contacted.

## Test files

The `tests/e2e/` directory holds the Playwright specs (`*.spec.cjs`) covering
screen navigation, prerequisite detection, install location, vault setup,
model and vision selection, the AGPL screen, the install/done/update screens,
release notes rendering, dev mode, XSS/leak guards, and build config. Run the
command above for the full, current inventory and pass count.
