// Every Electron launch under tests/ must go through launchApp (tests/e2e/helpers.cjs),
// which sets EMBER_E2E_PARK_WINDOWS so no window appears on a developer's screen.
// Static scan: it opens no window.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const TESTS_DIR = path.join(__dirname, '..')
const HELPERS = 'e2e/helpers.cjs'
const SELF = 'unit/park-flag.test.cjs'

function listSources(dir, base = dir) {
  const out = {}
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) Object.assign(out, listSources(full, base))
    else if (/\.(cjs|mjs|js|ts)$/.test(entry.name)) {
      out[path.relative(base, full).split(path.sep).join('/')] = fs.readFileSync(full, 'utf8')
    }
  }
  return out
}

// Returns a list of violation strings for a map of { relative path: source }.
function findViolations(sources) {
  const found = []
  for (const [file, src] of Object.entries(sources)) {
    if (file === SELF) continue
    if (file !== HELPERS) {
      if (/_electron\b|\belectron\.launch\s*\(|\.launch\s*\(\s*\{[^}]*executablePath/.test(src)) {
        found.push(`${file}: launches Electron directly, use launchApp`)
      }
      if (/\b(spawn|spawnSync|execFile|execFileSync|exec|execSync)\s*\([^)]*(require\(\s*['"]electron['"]\s*\)|electron\.exe|node_modules[\\/]+electron)/.test(src)) {
        found.push(`${file}: spawns the electron binary directly, use launchApp`)
      }
      if (/EMBER_E2E_PARK_WINDOWS/.test(src)) {
        found.push(`${file}: sets or reads the park flag itself, only launchApp may`)
      }
    }
    if (file !== HELPERS && /\bvisible\s*:\s*true\b/.test(src) && !/process\.env\.CI\s*!==\s*'true'/.test(src)) {
      found.push(`${file}: launches a visible window without a CI-only skip`)
    }
  }
  return found
}

// The launch in helpers.cjs must pass the flag whenever the window is not explicitly visible.
function helpersViolations(src) {
  const call = src.match(/electron\.launch\s*\(\s*\{[\s\S]*?\n\s*\}\s*\)/)
  if (!call) return ['helpers.cjs: no electron.launch call found']
  if (!/EMBER_E2E_PARK_WINDOWS\s*:\s*'1'/.test(call[0])) return ['helpers.cjs: electron.launch omits EMBER_E2E_PARK_WINDOWS']
  if (!/options\.visible\s*\?\s*\{\}\s*:/.test(call[0])) return ['helpers.cjs: park flag is not conditioned only on options.visible']
  return []
}

test('no launch under tests/ bypasses launchApp or the park flag', () => {
  const sources = listSources(TESTS_DIR)
  assert.ok(sources[HELPERS], 'helpers.cjs found')
  assert.ok(Object.keys(sources).length > 20, 'scan covers the test tree')
  assert.deepEqual(findViolations(sources), [])
  assert.deepEqual(helpersViolations(sources[HELPERS]), [])
})

test('control: a direct electron.launch in a spec is caught', () => {
  const bad = { 'e2e/x.spec.cjs': "const { _electron } = require('@playwright/test')\nawait _electron.launch({ args: [] })" }
  assert.equal(findViolations(bad).length, 1)
})

test('control: a direct spawn of the electron binary is caught', () => {
  const bad = { 'e2e/x.spec.cjs': "spawn(require('electron'), ['.'])" }
  assert.equal(findViolations(bad).length, 1)
})

test('control: a spec that sets the park flag itself is caught', () => {
  const bad = { 'e2e/x.spec.cjs': "process.env.EMBER_E2E_PARK_WINDOWS = '0'" }
  assert.equal(findViolations(bad).length, 1)
})

test('control: visible:true without a CI-only skip is caught, with one it passes', () => {
  assert.equal(findViolations({ 'e2e/x.spec.cjs': 'await launchApp({ visible: true })' }).length, 1)
  const gated = "test.skip(process.env.CI !== 'true', 'x')\nawait launchApp({ visible: true })"
  assert.equal(findViolations({ 'e2e/x.spec.cjs': gated }).length, 0)
})

test('control: helpers launch without the flag is caught, the real shape passes', () => {
  const bad = "app = await electron.launch({\n  args: [],\n  env: { ...process.env },\n})"
  assert.equal(helpersViolations(bad).length, 1)
  const good = "app = await electron.launch({\n  env: { ...process.env, ...(options.visible ? {} : { EMBER_E2E_PARK_WINDOWS: '1' }) },\n})"
  assert.equal(helpersViolations(good).length, 0)
})
