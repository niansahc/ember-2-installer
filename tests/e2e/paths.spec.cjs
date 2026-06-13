// Unit tests for the pure path derivations (src/lib/paths.js). Requires the
// module directly, no app launch (build-config.spec pattern). Inputs and
// expected values both use path.join so the assertions are separator-agnostic
// (pass on Windows dev and Linux CI).

const { test, expect } = require('@playwright/test')
const path = require('path')
const { uiSourceDir, uiTargetDir, uiIndexFile } = require('../../src/lib/paths')

const emberPath = path.join('parent', 'ember-2')

test.describe('path derivations', () => {
  test('uiSourceDir is the sibling ember-2-ui clone dir', () => {
    expect(uiSourceDir(emberPath)).toBe(path.join('parent', 'ember-2-ui'))
  })

  test('uiTargetDir is ui/ inside the install root', () => {
    expect(uiTargetDir(emberPath)).toBe(path.join('parent', 'ember-2', 'ui'))
  })

  test('uiIndexFile is index.html under the target dir', () => {
    expect(uiIndexFile(emberPath)).toBe(path.join('parent', 'ember-2', 'ui', 'index.html'))
  })

  test('derivations work for an absolute install root', () => {
    const abs = path.join(path.sep === '\\' ? 'C:\\Ember-2' : '/opt/Ember-2', 'ember-2')
    const parent = path.dirname(abs)
    expect(uiSourceDir(abs)).toBe(path.join(parent, 'ember-2-ui'))
    expect(uiTargetDir(abs)).toBe(path.join(abs, 'ui'))
    expect(uiIndexFile(abs)).toBe(path.join(abs, 'ui', 'index.html'))
  })
})
