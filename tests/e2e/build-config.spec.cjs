// Build-configuration contract tests.
//
// These guard the cross-platform build invariants for the Ember Setup installer:
//   - Windows output stays at C:/temp/ember-dist (load-bearing: avoids OneDrive
//     sync churn and Windows MAX_PATH limits on the deep node_modules tree).
//   - The Linux build directs its output elsewhere and ships the metadata an
//     AppImage / .desktop entry needs.
//
// They read the real config files (package.json, electron-builder.yml) so a
// regression in the build wiring fails the suite on any platform, including the
// Linux CI job that has no way to run a full build to completion quickly.

const { test, expect } = require('@playwright/test')
const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')

const repoRoot = path.resolve(__dirname, '..', '..')

function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
}

function readBuilderConfig() {
  return yaml.load(fs.readFileSync(path.join(repoRoot, 'electron-builder.yml'), 'utf8'))
}

function workflowPath(name) {
  return path.join(repoRoot, '.github', 'workflows', name)
}

function readWorkflowRaw(name) {
  return fs.readFileSync(workflowPath(name), 'utf8')
}

test('build:linux directs output away from the Windows output dir', () => {
  const pkg = readPackageJson()
  const script = pkg.scripts['build:linux']
  expect(script).toBeTruthy()
  // Linux must not inherit the Windows C:/temp path; it overrides output to dist-linux.
  expect(script).toContain('-c.directories.output=dist-linux')
  expect(script).not.toContain('C:/temp')
})

test('Linux build ships AppImage target with desktop-entry metadata', () => {
  const cfg = readBuilderConfig()
  expect(cfg.linux).toBeTruthy()
  expect(cfg.linux.target).toBe('AppImage')
  // category + maintainer populate the AppImage's .desktop entry; electron-builder
  // warns and produces a less-integrated artifact without them.
  expect(cfg.linux.category).toBeTruthy()
  expect(cfg.linux.maintainer).toBeTruthy()
})

test('release_notes.html is bundled (files allowlist includes it)', () => {
  // get-release-notes (src/main.js) reads release_notes.html from the app root,
  // but the `files` allowlist is opt-in: anything not matched is left out of the
  // asar. release_notes.html lives at the repo root (neither src/** nor assets/**),
  // so it must be listed explicitly or the "What's new" panel renders empty in
  // every packaged build. This guards that regression — it can't be caught by the
  // demo suite, which reads the repo-root file directly.
  const cfg = readBuilderConfig()
  expect(cfg.files).toContain('release_notes.html')
})

test('Windows CI builds the app and runs the e2e suite on windows-latest', () => {
  // Windows is the primary platform but was only ever built/tested on the dev's
  // machine. This job is the automated verification surface for it.
  const wf = yaml.load(readWorkflowRaw('windows-build.yml'))
  const job = wf.jobs['windows-build']
  expect(job).toBeTruthy()
  expect(job['runs-on']).toBe('windows-latest')
  const runs = job.steps.map((s) => s.run || '').join('\n')
  expect(runs).toContain('--win')
  expect(runs).toContain('npm run test:e2e')
})

test('Windows build output dir stays at C:/temp/ember-dist (no regression)', () => {
  // Load-bearing: this path keeps build output off OneDrive (sync churn) and
  // under the Windows MAX_PATH limit for electron-builder's deep node_modules
  // tree. Linux overrides output via the build:linux script, never by changing
  // this line. If this fails, the Windows build is at risk — do not "fix" it by
  // editing the test.
  const cfg = readBuilderConfig()
  expect(cfg.directories.output).toBe('C:/temp/ember-dist')
})
