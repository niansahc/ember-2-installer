const { test } = require('node:test')
const assert = require('node:assert/strict')
const { OLLAMA_MIN_VERSION, parseOllamaVersion, meetsOllamaFloor, ollamaFloorRefusal } = require('../../src/lib/ollama-version')

test('the floor is 0.35.0', () => {
  assert.equal(OLLAMA_MIN_VERSION, '0.35.0')
})

// Each blocked case below has a passing control in the same file (the
// "at floor" and "above floor" tests run the same function on accepted input).
test('below the floor is blocked', () => {
  for (const v of ['0.34.9', '0.34.2', '0.17.1', '0.6.2', 'ollama version is 0.34.9', '0.35.0-rc1']) {
    assert.equal(meetsOllamaFloor(v), false, v)
  }
})

test('at the floor passes', () => {
  for (const v of ['0.35.0', 'ollama version is 0.35.0', 'ollama version is 0.35.0 (demo)']) {
    assert.equal(meetsOllamaFloor(v), true, v)
  }
})

test('above the floor passes', () => {
  for (const v of ['0.35.1', '0.40.0', '1.0.0', '10.0.0', 'ollama version is 0.36.0-rc1']) {
    assert.equal(meetsOllamaFloor(v), true, v)
  }
})

test('unparseable or missing is blocked', () => {
  for (const v of ['', 'garbage', 'ollama version is dev', '0.35', null, undefined, 35, {}]) {
    assert.equal(meetsOllamaFloor(v), false, String(v))
  }
})

test('parse reads the first x.y.z and ignores build metadata', () => {
  assert.deepEqual(parseOllamaVersion('ollama version is 0.35.0').core, [0, 35, 0])
  assert.equal(parseOllamaVersion('nothing here'), null)
})

// ollamaFloorRefusal is what pull-ollama-model returns before running `ollama pull`.
test('pull refusal: below the floor is refused', () => {
  const msg = 'Ollama 0.35.0 or later is required.'
  assert.equal(ollamaFloorRefusal({ ok: true, version: 'ollama version is 0.34.9' }), msg)
  assert.equal(ollamaFloorRefusal({ ok: true, version: '0.17.1' }), msg)
})

test('pull refusal: at or above the floor is allowed (control for the refusals)', () => {
  assert.equal(ollamaFloorRefusal({ ok: true, version: 'ollama version is 0.35.0' }), null)
  assert.equal(ollamaFloorRefusal({ ok: true, version: 'ollama version is 0.40.2' }), null)
})

test('pull refusal: unreadable, missing or failed probe is refused', () => {
  const msg = 'Ollama 0.35.0 or later is required.'
  assert.equal(ollamaFloorRefusal({ ok: true, version: 'garbage' }), msg)
  assert.equal(ollamaFloorRefusal({ ok: true, version: null }), msg)
  assert.equal(ollamaFloorRefusal({ ok: false, version: 'ollama version is 0.35.0' }), msg)
  assert.equal(ollamaFloorRefusal(undefined), msg)
})
