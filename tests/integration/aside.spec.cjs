// Hermetic integration test for replaceWithClone and asidePath
// (src/exec/aside.js): a real cloneRepo against a local bare repo in a temp
// dir. No network, no Electron. Needs `git` on PATH (present on dev + CI).

const { test, expect } = require('@playwright/test')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { asidePath, replaceWithClone } = require('../../src/exec/aside')
const { cloneRepo } = require('../../src/exec/clone')
const { gitOut, seedRepo } = require('./git-fixture.cjs')

const NOW = new Date('2026-10-24T12:00:00Z')

test.describe('replaceWithClone', () => {
  let seedDir
  let repo
  let tmp
  let dir
  const cloneTo = (tag) => () => cloneRepo({ url: repo.url, targetDir: dir, tag, onData: () => {} })
  const marker = () => path.join(dir, 'old-install.txt')
  const siblings = () => fs.readdirSync(tmp).sort()

  test.beforeAll(() => {
    seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-aside-seed-'))
    repo = seedRepo(seedDir, [{ files: { 'README.md': 'release\n' }, tag: 'v1.0.0' }])
  })
  test.afterAll(() => {
    try { fs.rmSync(seedDir, { recursive: true, force: true }) } catch {}
  })
  test.beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-aside-'))
    dir = path.join(tmp, 'ember-2')
    fs.mkdirSync(dir)
    fs.writeFileSync(marker(), 'the old install\n')
  })
  test.afterEach(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
  })

  test('a failed clone puts the old folder back as it was', async () => {
    const r = await replaceWithClone({ dir, clone: cloneTo('v9.9.9'), now: NOW })
    expect(r.ok).toBe(false)
    expect(r.aside).toBeNull()
    expect(fs.readFileSync(marker(), 'utf8')).toBe('the old install\n')
    expect(siblings()).toEqual(['ember-2'])
  })

  test('control: a successful clone replaces the old folder and removes it', async () => {
    const r = await replaceWithClone({ dir, clone: cloneTo('v1.0.0'), now: NOW })
    expect(r).toMatchObject({ ok: true, aside: null })
    expect(fs.existsSync(marker())).toBe(false)
    expect(gitOut(['rev-parse', 'HEAD'], dir)).toBe(repo.ids['v1.0.0'])
    expect(siblings()).toEqual(['ember-2'])
  })

  test('keep leaves the old folder under a dated name', async () => {
    const r = await replaceWithClone({ dir, clone: cloneTo('v1.0.0'), keep: true, now: NOW })
    expect(r).toMatchObject({ ok: true, aside: `${dir}.old-2026-10-24` })
    expect(fs.readFileSync(path.join(r.aside, 'old-install.txt'), 'utf8')).toBe('the old install\n')
    expect(siblings()).toEqual(['ember-2', 'ember-2.old-2026-10-24'])
  })

  test('with no folder there, it is a plain clone', async () => {
    fs.rmSync(dir, { recursive: true })
    expect(await replaceWithClone({ dir, clone: cloneTo('v1.0.0'), now: NOW })).toMatchObject({ ok: true, aside: null })
    expect(siblings()).toEqual(['ember-2'])
  })

  test('asidePath skips names already taken', async () => {
    expect(asidePath(dir, NOW)).toBe(`${dir}.old-2026-10-24`)
    fs.mkdirSync(`${dir}.old-2026-10-24`)
    fs.mkdirSync(`${dir}.old-2026-10-24-2`)
    expect(asidePath(dir, NOW)).toBe(`${dir}.old-2026-10-24-3`)
  })
})
