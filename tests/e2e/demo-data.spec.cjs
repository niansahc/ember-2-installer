// Demo fake data must not carry anything that could be a real tailnet. Every
// *.ts.net name in the source must sit under the reserved example label
// (<host>.example.ts.net). Reads source directly, no app launch.

const { test, expect } = require('@playwright/test')
const fs = require('fs')
const path = require('path')

const SRC = path.join(__dirname, '..', '..', 'src')
const TS_NET_NAME = /\b[a-z0-9][a-z0-9.-]*\.ts\.net\b/gi
const SYNTHETIC = /(^|\.)example\.ts\.net$/i

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return sourceFiles(p)
    return /\.(js|html)$/.test(e.name) ? [p] : []
  })
}

function nonSyntheticTailnetNames(text) {
  return (text.match(TS_NET_NAME) || []).filter((name) => !SYNTHETIC.test(name))
}

test.describe('demo data', () => {
  test('every *.ts.net name in src is under example.ts.net', () => {
    const found = sourceFiles(SRC).flatMap((f) =>
      nonSyntheticTailnetNames(fs.readFileSync(f, 'utf-8')).map((n) => `${path.relative(SRC, f)}: ${n}`))
    expect(found).toEqual([])
  })

  test('the source does carry the synthetic demo name', () => {
    const main = fs.readFileSync(path.join(SRC, 'main.js'), 'utf-8')
    expect(main).toContain('ember.example.ts.net')
  })

  test('control: a generated-style tailnet name is flagged', () => {
    expect(nonSyntheticTailnetNames("return 'ember-desktop.not-a-real-tailnet.ts.net'")).toEqual(['ember-desktop.not-a-real-tailnet.ts.net'])
  })
})
