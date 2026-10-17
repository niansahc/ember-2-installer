// The test:hooks script names its files one by one (a glob argument to
// node --test needs Node 21+). This keeps the list and the directory in step:
// a test file added here but not to package.json would never run.

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const listed = (script) => script.split(/\s+/).filter((arg) => arg.endsWith('.test.cjs')).map((arg) => path.basename(arg))

test('npm run test:hooks lists every tests/hooks/*.test.cjs file', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8'))
  const onDisk = fs.readdirSync(__dirname).filter((name) => name.endsWith('.test.cjs')).sort()
  assert.deepEqual(listed(pkg.scripts['test:hooks']).sort(), onDisk)
})

test('control: a file missing from the list is caught', () => {
  const script = 'node --test tests/hooks/a.test.cjs'
  assert.notDeepEqual(listed(script).sort(), ['a.test.cjs', 'b.test.cjs'])
})
