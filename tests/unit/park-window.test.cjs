// The fail-closed check for parked e2e windows. Pure functions and a source scan:
// no Electron launch, no window.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { intersectsDisplay } = require('../../src/lib/park.js')

const display = (x, y, width, height) => ({ bounds: { x, y, width, height } })
const one = [display(0, 0, 1920, 1080)]
const two = [display(0, 0, 1920, 1080), display(1920, 0, 1920, 1080)]
const win = (x, y) => ({ x, y, width: 820, height: 800 })

test('a window parked at -32000 does not intersect any display', () => {
  assert.equal(intersectsDisplay(win(-32000, -32000), one), false)
  assert.equal(intersectsDisplay(win(-32000, -32000), two), false)
})

test('control: a centred window intersects a display', () => {
  assert.equal(intersectsDisplay(win(550, 140), one), true)
})

test('control: a window overlapping one edge or the second display intersects', () => {
  assert.equal(intersectsDisplay(win(-400, 100), one), true)
  assert.equal(intersectsDisplay(win(2500, 100), two), true)
})

test('control: a window left of a display at a negative origin is caught', () => {
  assert.equal(intersectsDisplay(win(-32000, 0), [display(-32100, 0, 1920, 1080)]), true)
})

test('a window touching only an edge does not intersect', () => {
  assert.equal(intersectsDisplay(win(-820, 0), one), false)
})

// Wiring: under the flag, reveal checks the displays before showInactive.
const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8')
const wired = (src) => {
  const i = src.indexOf('intersectsDisplay(bounds')
  const j = src.indexOf('showInactive()')
  return i !== -1 && j !== -1 && i < j && /app\.exit\(1\)/.test(src.slice(i, j))
}

test('main.js checks bounds and exits before showInactive', () => {
  assert.equal(wired(main), true)
})

test('control: a reveal that shows first, or never checks, is caught', () => {
  assert.equal(wired('mainWindow.showInactive()\nif (intersectsDisplay(bounds, d)) app.exit(1)'), false)
  assert.equal(wired('mainWindow.showInactive()'), false)
})

test('main.js logs the parked bounds', () => {
  assert.match(main, /\[park\] window bounds/)
})
