// Unit tests for the release pin (src/lib/release-pin.js) and a source check
// that every clone in src/ goes to the pinned tag. Requires the modules
// directly; no app launch.

const { test, expect } = require('@playwright/test')
const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')
const { releaseTag, updateAction } = require('../../src/lib/release-pin')
const { compareVersions } = require('../../src/lib/version')

const SRC = path.resolve(__dirname, '..', '..', 'src')

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return sourceFiles(p)
    return e.name.endsWith('.js') ? [p] : []
  })
}

const srcText = () => sourceFiles(SRC).map((f) => fs.readFileSync(f, 'utf8')).join('\n')

// Clone calls that do not go to the pinned tag: a raw git clone without
// --branch, or a cloneRepo call (always awaited) without the pin.
function unpinnedClones(text) {
  const rawClones = text.split(/\r?\n/).filter((l) => /'clone'/.test(l) && !/'--branch'/.test(l))
  const cloneRepoCalls = [...text.matchAll(/(?<=await )cloneRepo\(\{[\s\S]*?\}\)/g)].map((m) => m[0])
    .filter((call) => !/tag: EMBER_TAG/.test(call))
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
  if (typeof emberRelease !== 'string' || !/^\d+\.\d+\.\d+$/.test(emberRelease)) return ['emberRelease is not x.y.z']
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

test.describe('source: every clone goes to the pinned tag', () => {
  test('no clone in src/ skips the pin', () => {
    expect(unpinnedClones(srcText())).toEqual([])
  })

  test('control: the scan sees the real clone calls and flags unpinned ones', () => {
    const text = srcText()
    expect((text.match(/await cloneRepo\(\{/g) || []).length).toBeGreaterThanOrEqual(4)
    expect(text).toMatch(/'clone', '--depth', String\(depth\), '--branch'/)
    const injected = `${text}
      const ok = (await run('git', ['clone', '--depth', '1', REPO_UI_URL], { cwd })).ok
      const r = await cloneRepo({ url: REPO_UI_URL, targetDir: uiDir, onData: log })`
    expect(unpinnedClones(injected)).toEqual([
      "const ok = (await run('git', ['clone', '--depth', '1', REPO_UI_URL], { cwd })).ok",
      'cloneRepo({ url: REPO_UI_URL, targetDir: uiDir, onData: log })',
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
    expect(handlerBody(text, 'check-all-updates')).toMatch(/movesToPin\(backendInstalled\)/)
    const reverted = text.replace('const backendLatest = EMBER_TAG', 'const backendLatest = backendRelease?.tag_name || null')
    expect(reverted).not.toBe(text)
    expect(checksOffThePin(reverted)).toEqual(['check-all-updates'])
  })
})

test.describe('source: updates never pull a branch', () => {
  test('no git pull in src/', () => {
    expect(gitPulls(srcText())).toEqual([])
  })

  test('control: the scan sees the real moveToTag calls and flags an injected pull', () => {
    const text = srcText()
    expect((text.match(/await moveToTag\(\{/g) || []).length).toBeGreaterThanOrEqual(4)
    expect(text).toMatch(/run\('ollama', \['pull'/)
    const injected = `${text}
      const pullOk = (await run('git', ['pull', 'origin', 'main'], { cwd: uiDir })).ok`
    expect(gitPulls(injected)).toEqual([
      "const pullOk = (await run('git', ['pull', 'origin', 'main'], { cwd: uiDir })).ok",
    ])
  })
})
