// Unit tests for releaseSummary (src/lib/notes.js) — the one-line summary shown
// in each update row's "notes" field. Requires the module directly, no app
// launch (build-config.spec pattern). These lock CURRENT behavior, including the
// known quirks, so the extraction is a pure refactor.

const { test, expect } = require('@playwright/test')
const { releaseSummary } = require('../../src/lib/notes')

test.describe('releaseSummary', () => {
  test('returns empty string for empty or missing body', () => {
    expect(releaseSummary('')).toBe('')
    expect(releaseSummary(null)).toBe('')
    expect(releaseSummary(undefined)).toBe('')
  })

  test('returns the first bullet, for - and * markers', () => {
    expect(releaseSummary('- first thing\n- second thing')).toBe('first thing')
    expect(releaseSummary('* starred thing')).toBe('starred thing')
    expect(releaseSummary('  -   indented and spaced  ')).toBe('indented and spaced')
  })

  test('strips bold, code, and link markup in the bullet branch', () => {
    expect(releaseSummary('- **Bold:** the rest')).toBe('Bold: the rest')
    expect(releaseSummary('- uses `fetch` now')).toBe('uses fetch now')
    expect(releaseSummary('- see [the docs](https://example.com/x)')).toBe('see the docs')
  })

  test('prefers a bullet anywhere over the heading above it', () => {
    expect(releaseSummary('# Release v1\n\nintro line\n\n- the bullet')).toBe('the bullet')
  })

  test('falls back to the first non-heading, non-rule line when there is no bullet', () => {
    expect(releaseSummary('# Title\n\nSome prose text')).toBe('Some prose text')
    expect(releaseSummary('---\n## Heading\nreal content')).toBe('real content')
  })

  // QUIRK (locked, not a fix): the fallback branch does NOT strip markdown.
  test('keeps raw markdown in the fallback branch', () => {
    expect(releaseSummary('Plain **bold** line, no bullet')).toBe('Plain **bold** line, no bullet')
  })

  test('truncates to 120 characters', () => {
    const long = '- ' + 'a'.repeat(200)
    expect(releaseSummary(long)).toHaveLength(120)
  })
})
