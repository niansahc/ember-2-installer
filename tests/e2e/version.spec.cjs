// Unit tests for the pure version comparator (src/lib/version.js).
//
// Requires the module directly — no app launch — the same pattern as
// build-config.spec.cjs. Guards the update-check logic against the string-
// inequality bug: `installed !== latest` reported an update for downgrades and
// for equal-but-v-prefix-mismatched pairs, and string ordering mis-ranks 0.10
// vs 0.9.

const { test, expect } = require('@playwright/test')
const { compareVersions, isNewer, displayVersion } = require('../../src/lib/version')

test.describe('compareVersions', () => {
  test('orders by major.minor.patch numerically', () => {
    expect(compareVersions('v0.9.0', 'v0.8.0')).toBe(1)
    expect(compareVersions('v0.8.0', 'v0.9.0')).toBe(-1)
    expect(compareVersions('v0.8.1', 'v0.8.1')).toBe(0)
    expect(compareVersions('v1.0.0', 'v0.9.9')).toBe(1)
  })

  test('compares numerically, not lexically (0.10 > 0.9)', () => {
    expect(compareVersions('v0.10.0', 'v0.9.0')).toBe(1)
    expect(compareVersions('v0.9.0', 'v0.10.0')).toBe(-1)
  })

  test('ignores a single leading v on either side', () => {
    expect(compareVersions('0.8.1', 'v0.8.1')).toBe(0)
    expect(compareVersions('v0.8.1', '0.8.1')).toBe(0)
  })

  test('ignores a release-please component prefix on the tag', () => {
    // release-please emitted component-prefixed tags from 2026-04-30 onward
    // (ember-2-ui-v0.8.1). The GitHub releases API hands tag_name to the
    // comparator verbatim, so an unparsed prefix silently disables the whole
    // update check. The repo names contain digits, so the prefix has to be
    // matched explicitly rather than skipped over.
    expect(compareVersions('ember-2-ui-v0.18.0', '0.8.1')).toBe(1)
    expect(compareVersions('ember-2-installer-v0.18.0', '0.8.1')).toBe(1)
    expect(compareVersions('ember-2-ui-v0.8.1', 'ember-2-ui-v0.8.1')).toBe(0)
    expect(compareVersions('ember-2-ui-v0.8.1', '0.18.0')).toBe(-1)
  })

  test('returns null when either side is unparseable or missing', () => {
    expect(compareVersions('garbage', 'v0.8.1')).toBeNull()
    expect(compareVersions('v0.8.1', null)).toBeNull()
    expect(compareVersions(undefined, undefined)).toBeNull()
    expect(compareVersions('ember-2-ui-vNEXT', 'v0.8.1')).toBeNull()
  })
})

test.describe('isNewer', () => {
  test('is true only when latest is strictly greater', () => {
    expect(isNewer('v0.9.0', 'v0.8.1')).toBe(true)
    expect(isNewer('v1.0.0', 'v0.9.9')).toBe(true)
    expect(isNewer('v0.10.0', 'v0.9.0')).toBe(true)
  })

  test('is false for equal versions, ignoring the v prefix', () => {
    expect(isNewer('v0.8.1', 'v0.8.1')).toBe(false)
    expect(isNewer('0.8.1', 'v0.8.1')).toBe(false)
    expect(isNewer('v0.8.1', '0.8.1')).toBe(false)
  })

  test('is false for a downgrade', () => {
    expect(isNewer('v0.8.0', 'v0.8.1')).toBe(false)
    expect(isNewer('v0.9.0', 'v0.10.0')).toBe(false)
  })

  test('sees an update when the latest tag carries a component prefix', () => {
    // The 0.8.1 -> 0.18.0 jump is the case that matters: an installed client
    // reads its own bare package version and compares it against a prefixed
    // tag from the releases API.
    expect(isNewer('ember-2-ui-v0.18.0', '0.8.1')).toBe(true)
    expect(isNewer('ember-2-installer-v0.18.0', '0.8.1')).toBe(true)
    expect(isNewer('ember-2-ui-v0.8.1', '0.8.1')).toBe(false)
  })

  test('is false when a version is unparseable or missing', () => {
    expect(isNewer('v0.8.1', null)).toBe(false)
    expect(isNewer(null, 'v0.8.1')).toBe(false)
    expect(isNewer('garbage', 'v0.8.1')).toBe(false)
  })
})

test.describe('displayVersion', () => {
  test('strips a component prefix', () => {
    // The update screen used to render tag_name with only /^v/ removed, so a
    // prefixed tag reached the panel whole: "ember-2-installer-v0.8.1" where
    // "0.8.1" belonged.
    expect(displayVersion('ember-2-installer-v0.18.0')).toBe('0.18.0')
    expect(displayVersion('ember-2-ui-v0.8.1')).toBe('0.8.1')
    expect(displayVersion('ember-2-v0.14.0')).toBe('0.14.0')
  })

  test('strips a leading v', () => {
    expect(displayVersion('v0.18.0')).toBe('0.18.0')
    expect(displayVersion('v1.0.0')).toBe('1.0.0')
  })

  test('leaves a bare version alone', () => {
    expect(displayVersion('0.18.0')).toBe('0.18.0')
    expect(displayVersion('0.10.2')).toBe('0.10.2')
  })

  test('keeps trailing detail so a prerelease marker survives', () => {
    expect(displayVersion('v0.18.0-rc.1')).toBe('0.18.0-rc.1')
    expect(displayVersion('ember-2-ui-v0.18.0-rc.1')).toBe('0.18.0-rc.1')
  })

  test('returns anything unparseable untouched', () => {
    // A row showing a strange tag beats a row showing nothing.
    expect(displayVersion('garbage')).toBe('garbage')
    expect(displayVersion('ember-2-ui-vNEXT')).toBe('ember-2-ui-vNEXT')
    expect(displayVersion('unknown')).toBe('unknown')
  })

  test('passes non-strings through, so the || null fallbacks still fire', () => {
    expect(displayVersion(null)).toBeNull()
    expect(displayVersion(undefined)).toBeUndefined()
  })

  test('output still compares — display and comparison share one regex', () => {
    expect(isNewer(displayVersion('ember-2-installer-v0.18.0'), '0.8.1')).toBe(true)
    expect(compareVersions(displayVersion('ember-2-ui-v0.8.1'), 'v0.8.1')).toBe(0)
  })
})
