// Unit tests for the GitHub releases API response check
// (src/lib/github-release.js), which fetchRelease in src/main.js uses.
// Requires the module directly; no app launch.

const { test, expect } = require('@playwright/test')
const { releaseFromResponse } = require('../../src/lib/github-release')

test.describe('releaseFromResponse', () => {
  test('a 200 with a release body is the release', () => {
    const body = JSON.stringify({ tag_name: 'v0.18.1', body: '- notes' })
    expect(releaseFromResponse(200, body)).toEqual({ tag_name: 'v0.18.1', body: '- notes' })
  })

  test('a 404 (tag without a Release) or 403 (rate limit) JSON body is not a release', () => {
    expect(releaseFromResponse(404, JSON.stringify({ message: 'Not Found' }))).toBeNull()
    expect(releaseFromResponse(403, JSON.stringify({ message: 'API rate limit exceeded' }))).toBeNull()
  })

  test('control: the same 404 body with a 200 status would pass as a release', () => {
    // What fetchRelease did before the status check: any JSON body counted.
    expect(releaseFromResponse(200, JSON.stringify({ message: 'Not Found' }))).toEqual({ message: 'Not Found' })
  })

  test('a 200 whose body is not a JSON object is not a release', () => {
    expect(releaseFromResponse(200, 'not json')).toBeNull()
    expect(releaseFromResponse(200, 'null')).toBeNull()
    expect(releaseFromResponse(200, '"text"')).toBeNull()
  })
})
