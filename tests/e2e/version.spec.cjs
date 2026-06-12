// Unit tests for the pure version comparator (src/lib/version.js).
//
// Requires the module directly — no app launch — the same pattern as
// build-config.spec.cjs. Guards the update-check logic against the string-
// inequality bug: `installed !== latest` reported an update for downgrades and
// for equal-but-v-prefix-mismatched pairs, and string ordering mis-ranks 0.10
// vs 0.9.

const { test, expect } = require('@playwright/test')
const { compareVersions, isNewer } = require('../../src/lib/version')

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

  test('returns null when either side is unparseable or missing', () => {
    expect(compareVersions('garbage', 'v0.8.1')).toBeNull()
    expect(compareVersions('v0.8.1', null)).toBeNull()
    expect(compareVersions(undefined, undefined)).toBeNull()
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

  test('is false when a version is unparseable or missing', () => {
    expect(isNewer('v0.8.1', null)).toBe(false)
    expect(isNewer(null, 'v0.8.1')).toBe(false)
    expect(isNewer('garbage', 'v0.8.1')).toBe(false)
  })
})
