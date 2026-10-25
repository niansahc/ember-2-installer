// The release pin, end to end except for real git (tests/integration covers
// that). Requires the modules directly; no app launch. Covers:
//   - releaseTag, updateAction and rowInstalled (src/lib/release-pin.js)
//   - the package.json pin rule (emberRelease against version)
//   - the release.yml gate (check-pinned-tags)
//   - source checks on src/: every clone goes to the pin, nothing pulls a
//     branch, the update checks target the pin, never gate it on a known
//     installed version or on a GitHub answer, update-existing-ember never
//     saves a refused path, run-ember-update reports a v-prefixed tag, every
//     UI build goes through uiToPin and buildAndServeUi, version.json is read
//     only through installedBackendVersion, the install flow notes its steps
//     for the backend setup record, and a fresh install sets the old one aside

const { test, expect } = require('@playwright/test')
const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')
const { releaseTag, updateAction, rowInstalled, SEMVER } = require('../../src/lib/release-pin')
const { compareVersions } = require('../../src/lib/version')

const SRC = path.resolve(__dirname, '..', '..', 'src')

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return sourceFiles(p)
    return e.name.endsWith('.js') ? [p] : []
  })
}

// Read once: several tests scan the same text.
let srcCache
const srcText = () => (srcCache ??= sourceFiles(SRC).map((f) => fs.readFileSync(f, 'utf8')).join('\n'))

// Clone calls that do not go to the pinned tag: a raw git clone (a 'git'
// argument list starting with 'clone') without --branch, or a cloneRepo call,
// awaited or not, that passes no tag (EMBER_TAG, or `tag` where a helper takes
// the pin as a parameter). The UI action string 'clone' is not a git call.
function unpinnedClones(text) {
  const rawClones = text.split(/\r?\n/).filter((l) => /'git',\s*\[\s*'clone',/.test(l) && !/'--branch'/.test(l))
  const cloneRepoCalls = [...text.matchAll(/(?<!function )\bcloneRepo\(\{[\s\S]*?\}\)/g)].map((m) => m[0])
    .filter((call) => !/\btag(: EMBER_TAG)?\s*[,}]/.test(call))
  return [...rawClones.map((l) => l.trim()), ...cloneRepoCalls]
}

// git pulls: updates move to the pinned tag (moveToTag), never pull a branch.
// `ollama pull` is a model download and is not matched.
const gitPulls = (text) => text.split(/\r?\n/)
  .filter((l) => /run\('git',\s*\['pull'/.test(l) || /'pull',\s*'origin'/.test(l))
  .map((l) => l.trim())

test.describe('releaseTag', () => {
  test('returns v<emberRelease>', () => {
    expect(releaseTag({ emberRelease: '0.18.1' })).toBe('v0.18.1')
    expect(releaseTag({ emberRelease: '1.20.3' })).toBe('v1.20.3')
  })

  test('throws on a missing or malformed pin', () => {
    for (const pin of [undefined, '', '0.18', 'v0.18.1', '0.18.1-beta', ' 0.18.1', '0.18.1 && calc', 18]) {
      expect(() => releaseTag({ emberRelease: pin }), JSON.stringify(pin)).toThrow(/emberRelease must be x\.y\.z/)
    }
    expect(() => releaseTag(undefined)).toThrow(/emberRelease/)
  })

  test('the shipped package.json pin is valid', () => {
    expect(releaseTag(require('../../package.json'))).toMatch(/^v\d+\.\d+\.\d+$/)
  })
})

// The pin rule: emberRelease is x.y.z, shares version's major.minor, and is not
// newer than version (equal in a coordinated release; older only in an
// installer-only patch).
function pinRuleViolations({ version, emberRelease }) {
  if (typeof emberRelease !== 'string' || !SEMVER.test(emberRelease)) return ['emberRelease is not x.y.z']
  const [pin, ver] = [emberRelease, version].map((v) => v.split('.').map(Number))
  const out = []
  if (pin[0] !== ver[0] || pin[1] !== ver[1]) out.push('major.minor differs from version')
  if (compareVersions(emberRelease, version) === 1) out.push('newer than version')
  return out
}

test.describe('package.json pin rule', () => {
  test('emberRelease is x.y.z, shares version\'s major.minor and is not newer', () => {
    const pkg = require('../../package.json')
    expect(pinRuleViolations(pkg)).toEqual([])
  })

  test('control: each broken pin is flagged', () => {
    expect(pinRuleViolations({ version: '0.18.2', emberRelease: '0.18.1' })).toEqual([])
    expect(pinRuleViolations({ version: '0.18.1', emberRelease: '0.18.2' })).toEqual(['newer than version'])
    expect(pinRuleViolations({ version: '0.19.0', emberRelease: '0.18.1' })).toEqual(['major.minor differs from version'])
    expect(pinRuleViolations({ version: '0.18.1', emberRelease: '0.18' })).toEqual(['emberRelease is not x.y.z'])
    expect(pinRuleViolations({ version: '0.18.1' })).toEqual(['emberRelease is not x.y.z'])
  })
})

test.describe('release gate', () => {
  test('release.yml builds nothing until both pinned tags exist', () => {
    const wf = yaml.load(fs.readFileSync(path.join(SRC, '..', '.github', 'workflows', 'release.yml'), 'utf8'))
    const gate = wf.jobs['check-pinned-tags']
    const script = gate.steps.map((s) => s.run || '').join('\n')
    expect(script).toContain("require('./package.json').emberRelease")
    expect(script).toContain('git ls-remote --exit-code --tags')
    expect(script).toMatch(/for repo in ember-2 ember-2-ui/)
    // A missing tag (ls-remote exit 2) and an unreachable repo (any other
    // failure) fail with different messages.
    expect(script).toContain('|| status=$?')
    expect(script).toContain('if [ "$status" -eq 2 ]; then')
    expect(script).toMatch(/has no such tag[\s\S]*elif \[ "\$status" -ne 0 \][\s\S]*could not reach/)
    const publishJobs = Object.keys(wf.jobs).filter((k) => k.startsWith('publish-'))
    expect(publishJobs.sort()).toEqual(['publish-linux', 'publish-mac', 'publish-windows'])
    for (const k of publishJobs) expect([].concat(wf.jobs[k].needs || []), k).toContain('check-pinned-tags')
  })
})

test.describe('updateAction (never a downgrade)', () => {
  test('pin newer than installed: update', () => {
    expect(updateAction({ installed: '0.17.4', pinned: '0.18.1' })).toBe('update')
    expect(updateAction({ installed: 'v0.9.0', pinned: 'v0.10.0' })).toBe('update')
  })

  test('installed equals the pin: current', () => {
    expect(updateAction({ installed: '0.18.1', pinned: '0.18.1' })).toBe('current')
    expect(updateAction({ installed: 'v0.18.1', pinned: '0.18.1' })).toBe('current')
  })

  test('installed newer than the pin: ahead, so it stays', () => {
    expect(updateAction({ installed: '0.19.0', pinned: '0.18.1' })).toBe('ahead')
  })

  test('installed version unknown: update to the pin', () => {
    expect(updateAction({ installed: null, pinned: '0.18.1' })).toBe('update')
    expect(updateAction({ installed: 'unknown', pinned: '0.18.1' })).toBe('update')
  })
})

test.describe('rowInstalled (update row label)', () => {
  const pinned = 'v0.18.1'

  test('a UI rebuild reads "needs rebuild"', () => {
    expect(rowInstalled({ installed: '0.18.1', action: 'rebuild', pinned })).toBe('0.18.1 (needs rebuild)')
    expect(rowInstalled({ installed: null, action: 'rebuild', pinned })).toBe('unknown (needs rebuild)')
  })

  test('a backend setup that never finished reads "needs setup"', () => {
    expect(rowInstalled({ installed: 'v0.18.1', action: 'finish', pinned })).toBe('v0.18.1 (needs setup)')
    expect(rowInstalled({ installed: null, action: 'finish', pinned })).toBe('unknown (needs setup)')
  })

  test('an equal version that still moves reads "unreleased"', () => {
    expect(rowInstalled({ installed: 'v0.18.1', action: 'update', pinned })).toBe('v0.18.1 (unreleased)')
  })

  test('every other row shows the version alone', () => {
    expect(rowInstalled({ installed: 'v0.18.0', action: 'update', pinned })).toBe('v0.18.0')
    expect(rowInstalled({ installed: 'v0.18.1', action: 'current', pinned })).toBe('v0.18.1')
    expect(rowInstalled({ installed: 'v0.19.0', action: 'ahead', pinned })).toBe('v0.19.0')
    expect(rowInstalled({ installed: null, action: 'update', pinned })).toBe('unknown')
  })
})

test.describe('source: every clone goes to the pinned tag', () => {
  test('no clone in src/ skips the pin', () => {
    expect(unpinnedClones(srcText())).toEqual([])
  })

  test('control: the scan sees the real clone calls and flags unpinned ones', () => {
    const text = srcText()
    expect((text.match(/(?<!function )\bcloneRepo\(\{/g) || []).length).toBeGreaterThanOrEqual(3)
    expect(text).toMatch(/'clone', '--depth', '1', '--branch', tag/)
    const injected = `${text}
      const ok = (await run('git', ['clone', '--depth', '1', REPO_UI_URL], { cwd })).ok
      const r = await cloneRepo({ url: REPO_UI_URL, targetDir: uiDir, onData: log })
      const later = () => cloneRepo({ targetDir, onData: log })`
    expect(unpinnedClones(injected)).toEqual([
      "const ok = (await run('git', ['clone', '--depth', '1', REPO_UI_URL], { cwd })).ok",
      'cloneRepo({ url: REPO_UI_URL, targetDir: uiDir, onData: log })',
      'cloneRepo({ targetDir, onData: log })',
    ])
  })
})

// The real (non-demo) handler body: registered at column 0, demo overrides are
// indented inside the DEMO_MODE block.
const handlerBody = (text, channel) =>
  (text.match(new RegExp(`^ipcMain\\.handle\\('${channel}'[\\s\\S]*?^\\}\\)`, 'm')) || [''])[0]

const UPDATE_CHECKS = ['check-all-updates', 'check-for-update', 'check-ember-update']

// Update checks whose backend/UI target is not the pin: they read a GitHub
// release's tag_name as the target, or never mention the pin.
function checksOffThePin(text) {
  return UPDATE_CHECKS.filter((ch) => {
    const body = handlerBody(text, ch)
    return !body || /(backendRelease|uiRelease|latest)\?*\.tag_name/.test(body) || !/EMBER_TAG/.test(body)
  })
}

test.describe('source: update checks target the pin', () => {
  const mainJs = () => fs.readFileSync(path.join(SRC, 'main.js'), 'utf8')

  test('check-all-updates, check-for-update and check-ember-update compare against the pin', () => {
    expect(checksOffThePin(mainJs())).toEqual([])
  })

  test('control: a check that reads GitHub\'s latest tag as the target is flagged', () => {
    const text = mainJs()
    const body = handlerBody(text, 'check-all-updates')
    expect(body).toMatch(/backendUpdateAction\(\{ emberPath, tag: EMBER_TAG \}\)/)
    const reverted = text.replace(body, body.replace('latest: EMBER_TAG,', 'latest: backendRelease?.tag_name || null,'))
    expect(reverted).not.toBe(text)
    expect(checksOffThePin(reverted)).toEqual(['check-all-updates'])
  })
})

// Update checks that gate the pin decision, e.g. an `installed &&` guard that
// reports no update when the installed version is unknown. The decision comes
// from src/exec/pin-action.js (pinAction and the backend and UI actions built
// on it), which moves an unknown version to the pin, so no backend or UI
// hasUpdate combines it with anything (&&); the installer row is not a pin
// decision. A check that never asks pin-action is flagged too, so the scan
// cannot pass by matching nothing.
function guardedPinChecks(text) {
  return UPDATE_CHECKS.flatMap((ch) => {
    const lines = handlerBody(text, ch).split(/\r?\n/).map((l) => l.trim())
    const asks = lines.some((l) => /pinAction\(|uiUpdateAction\(|backendUpdateAction\(/.test(l))
    const guarded = lines.filter((l) => /hasUpdate\b.*&&/.test(l) && !/installerSelfUpdate/.test(l))
    return [...(asks ? [] : [`${ch}: never asks pinAction`]), ...guarded.map((l) => `${ch}: ${l}`)]
  })
}

test.describe('source: an unknown installed version needs the pin', () => {
  const mainJs = () => fs.readFileSync(path.join(SRC, 'main.js'), 'utf8')

  test('no update check reports "no update" for an unknown installed version', () => {
    expect(guardedPinChecks(mainJs())).toEqual([])
  })

  test('control: an `installed &&` guard in check-for-update is flagged', () => {
    const text = mainJs()
    const body = handlerBody(text, 'check-for-update')
    const guarded = text.replace(body, body.replace(
      'hasUpdate: backendNeedsSetup(action),',
      'hasUpdate: !!installed && backendNeedsSetup(action),',
    ))
    expect(guarded).not.toBe(text)
    expect(guardedPinChecks(guarded)).toEqual([
      'check-for-update: hasUpdate: !!installed && backendNeedsSetup(action),',
    ])
  })
})

// check-for-update answers from the clone; the GitHub release is only its
// notes. A check that returns early, or gates hasUpdate, on the release says
// "latest version" whenever GitHub is rate limited, missing the release, or
// offline. check-ember-update reads no release at all: nothing uses one.
const releaseGatedChecks = (text) => [
  ...(/if \(!release\)|release &&|release \?/.test(handlerBody(text, 'check-for-update')) ? ['check-for-update'] : []),
  ...(/fetchRelease/.test(handlerBody(text, 'check-ember-update')) ? ['check-ember-update'] : []),
]

test.describe('source: the pin needs no GitHub answer', () => {
  const mainJs = () => fs.readFileSync(path.join(SRC, 'main.js'), 'utf8')

  test('check-for-update never gates on the release and check-ember-update never fetches one', () => {
    expect(handlerBody(mainJs(), 'check-for-update')).toMatch(/changelog: release\?\.body/)
    expect(releaseGatedChecks(mainJs())).toEqual([])
  })

  test('control: an early return on a missing release and a fetch for nothing are flagged', () => {
    const text = mainJs()
    const forUpdate = handlerBody(text, 'check-for-update')
    const ember = handlerBody(text, 'check-ember-update')
    const gated = text
      .replace(forUpdate, forUpdate.replace('  return {', '  if (!release) return { hasUpdate: false }\n  return {'))
      .replace(ember, ember.replace('  let installed', '  const releaseP = fetchRelease(REPO_BACKEND_SLUG, EMBER_TAG)\n  let installed'))
    expect(releaseGatedChecks(gated)).toEqual(['check-for-update', 'check-ember-update'])
  })
})

// update-existing-ember saving the path itself. The renderer saves it on
// success (save-ember-path), so a save in the handler can only add the case
// where the move was refused or failed.
const savesExistingPath = (text) => /saveEmberPath\(/.test(handlerBody(text, 'update-existing-ember'))

// run-ember-update tag values that are not v-prefixed (EMBER_TAG or vPrefixed).
const bareUpdateTags = (text) => [...handlerBody(text, 'run-ember-update').matchAll(/\btag: (\w+)/g)]
  .map((m) => m[1]).filter((v) => v !== 'EMBER_TAG' && v !== 'vPrefixed')

// UI builds or copies in main.js. Every UI build goes through
// buildAndServeUi (src/exec/ui-build.js), which swaps the served folder only
// after a complete copy and records the tag; tests/integration covers it.
const rawUiBuilds = (text) => text.split(/\r?\n/)
  .filter((l) => /\['run', 'build'\]|fs\.cpSync\(|recordBuiltUiTag\(/.test(l))
  .map((l) => l.trim())

// version.json reads in main.js that bypass installedBackendVersion
// (src/exec/installed.js), which reads only .version, as /api/health does.
const rawVersionReads = (text) => text.split(/\r?\n/)
  .filter((l) => /\bdata\.tag\b|JSON\.parse\(fs\.readFileSync\(versionFile/.test(l))
  .map((l) => l.trim())

// fresh-install-ember deleting the existing install itself. freshInstall
// (src/exec/fresh-install.js) replaces only an installer clone and sets it
// aside, so a failed clone can put it back.
const deletesBeforeClone = (text) => /rmSync\(/.test(handlerBody(text, 'fresh-install-ember'))

test.describe('source: install and update handlers', () => {
  const mainJs = () => fs.readFileSync(path.join(SRC, 'main.js'), 'utf8')

  test('update-existing-ember never saves the path itself', () => {
    expect(handlerBody(mainJs(), 'update-existing-ember')).toMatch(/moveBackendToPin/)
    expect(savesExistingPath(mainJs())).toBe(false)
  })

  test('control: a save before the return is flagged', () => {
    const text = mainJs()
    const body = handlerBody(text, 'update-existing-ember')
    const saving = text.replace(body, body.replace('return { ok: true, path: emberPath }', 'saveEmberPath(emberPath)\n  return { ok: true, path: emberPath }'))
    expect(saving).not.toBe(text)
    expect(savesExistingPath(saving)).toBe(true)
  })

  test('run-ember-update reports a v-prefixed tag on every path', () => {
    const text = mainJs()
    expect([...handlerBody(text, 'run-ember-update').matchAll(/\btag: /g)].length).toBe(2)
    expect(bareUpdateTags(text)).toEqual([])
  })

  test('control: the bare version.json value is flagged', () => {
    const text = mainJs()
    const bare = text.replace('tag: vPrefixed(installedBackendVersion(emberPath))', 'tag: installedBackendVersion(emberPath)')
    expect(bare).not.toBe(text)
    expect(bareUpdateTags(bare)).toEqual(['installedBackendVersion'])
  })

  test('build-ui and Update All bring ember-2-ui to the pin and build only through buildAndServeUi', () => {
    const text = mainJs()
    expect(text).toMatch(/async function runInstallStep[\s\S]*?await bringUiToPin\(/)
    expect(handlerBody(text, 'run-all-updates')).toMatch(/await bringUiToPin\(/)
    expect(text).toMatch(/record: uiBuildIsPin\(ui\.action\),\s+buildEnv: /)
    expect(rawUiBuilds(text)).toEqual([])
  })

  test('control: a UI build and copy in main.js is flagged', () => {
    const text = mainJs()
    const raw = `${text}
      const buildOk = (await run('npm', ['run', 'build'], { cwd: uiDir, env, onData: log })).ok
      fs.cpSync(path.join(uiDir, 'dist'), targetUiDir, { recursive: true })`
    expect(rawUiBuilds(raw)).toEqual([
      "const buildOk = (await run('npm', ['run', 'build'], { cwd: uiDir, env, onData: log })).ok",
      "fs.cpSync(path.join(uiDir, 'dist'), targetUiDir, { recursive: true })",
    ])
  })

  test('scan-for-ember and check-target-path read the version as the update checks do', () => {
    const text = mainJs()
    expect(handlerBody(text, 'scan-for-ember')).toMatch(/installedBackendVersion\(found\)/)
    expect(handlerBody(text, 'check-target-path')).toMatch(/installedBackendVersion\(targetDir\)/)
    expect(rawVersionReads(text)).toEqual([])
  })

  test('control: a version.json read that falls back to the tag is flagged', () => {
    const raw = `${mainJs()}
      const data = JSON.parse(fs.readFileSync(versionFile, 'utf-8'))
      return { found: true, version: data.version || data.tag || 'unknown' }`
    expect(rawVersionReads(raw)).toEqual([
      "const data = JSON.parse(fs.readFileSync(versionFile, 'utf-8'))",
      "return { found: true, version: data.version || data.tag || 'unknown' }",
    ])
  })

  test('the install flow notes its pip and docker steps for the backend setup record', () => {
    expect(handlerBody(mainJs(), 'run-install-step')).toMatch(/noteInstallStep\(emberPath, step, result\.ok\)/)
  })

  test('fresh-install-ember goes through freshInstall, never deletes the old install first', () => {
    const text = mainJs()
    expect(handlerBody(text, 'fresh-install-ember')).toMatch(/await freshInstall\(\{ dir: targetDir, url: DEFAULT_BACKEND_REPO_URL,/)
    expect(deletesBeforeClone(text)).toBe(false)
  })

  test('control: a delete before the clone is flagged', () => {
    const text = mainJs()
    const body = handlerBody(text, 'fresh-install-ember')
    const deleting = text.replace(body, body.replace(
      "const log = (text) => sendLog('clone-progress', text)",
      "const log = (text) => sendLog('clone-progress', text)\n  if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true })",
    ))
    expect(deleting).not.toBe(text)
    expect(deletesBeforeClone(deleting)).toBe(true)
  })
})

test.describe('source: updates never pull a branch', () => {
  test('no git pull in src/', () => {
    expect(gitPulls(srcText())).toEqual([])
  })

  test('control: the scan sees the real moveToTag calls and flags an injected pull', () => {
    const text = srcText()
    expect((text.match(/await moveToTag\(\{/g) || []).length).toBeGreaterThanOrEqual(2)
    expect(text).toMatch(/run\('ollama', \['pull'/)
    const injected = `${text}
      const pullOk = (await run('git', ['pull', 'origin', 'main'], { cwd: uiDir })).ok`
    expect(gitPulls(injected)).toEqual([
      "const pullOk = (await run('git', ['pull', 'origin', 'main'], { cwd: uiDir })).ok",
    ])
  })
})
