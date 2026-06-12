// XSS / injection-surface guard for the renderer.
//
// Model fields (name, desc, size) come from `ollama list` output and the curated
// catalog — machine/data-supplied strings. They must be rendered as text, never
// parsed as markup. This drives the real render path (buildModelCard, exposed as
// a demo-only test seam on window.__emberTest) with a model whose fields contain
// HTML, and asserts no elements are created from it and no inline handler fires.

const { test, expect } = require('@playwright/test')
const { launchApp } = require('./helpers.cjs')

test.describe('Renderer injection surface', () => {
  let app, window

  test.beforeEach(async () => {
    const launched = await launchApp()
    app = launched.app
    window = launched.window
    // The test seam is attached during init(), after the demo-mode check.
    await window.waitForFunction(() => !!window.__emberTest?.buildModelCard, null, { timeout: 5000 })
  })

  test.afterEach(async () => {
    await app.close()
  })

  test('model card renders dynamic fields as text, not markup', async () => {
    const result = await window.evaluate(() => {
      window.__xssFired = false
      const malicious = {
        id: 'evil',
        name: '<img src=x onerror="window.__xssFired = true">PWN',
        desc: '<b>bold</b> and <i>italic</i>',
        size: '<script>1</script>1 GB',
        installed: false,
      }
      const card = window.__emberTest.buildModelCard(malicious, {
        selected: false,
        showRecommendedBadge: false,
      })
      // Attach so an injected <img onerror> would actually execute if parsed.
      document.body.appendChild(card)
      return {
        injectedEls: card.querySelectorAll('img, b, i, script').length,
        nameText: card.querySelector('.model-card-name').textContent,
        descText: card.querySelector('.model-card-desc').textContent,
        xssFired: window.__xssFired,
      }
    })

    // No markup from the model data became real DOM.
    expect(result.injectedEls).toBe(0)
    // The literal characters survive as text.
    expect(result.nameText).toContain('<img')
    expect(result.descText).toContain('<b>')
    expect(result.xssFired).toBe(false)
  })
})
