// Sep 23 2026 (owner: the receipt splits / cuts at the bottom). The print
// document is a separate document with only the fonts it declares, and it
// declared none: its Khmer text fell back to a taller system font, so a
// receipt the app measured at 208.7mm printed 224.2mm long (its QR row spilled
// onto a second page) and the 80x50 card lost its bottom 3.7mm. The receipt's
// print document now carries the app's own @font-face rules, with URLs made
// absolute so a popup and a hidden frame resolve them the same way.
import assert from 'node:assert/strict'

let failed = 0
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

class FakeFontFaceRule { cssText: string; constructor(cssText: string) { this.cssText = cssText } }
class FakeStyleRule { cssText: string; constructor(cssText: string) { this.cssText = cssText } }

const globals = globalThis as Record<string, unknown>
globals.CSSFontFaceRule = FakeFontFaceRule
globals.document = {
  baseURI: 'https://pos.example/sales/today',
  styleSheets: [
    {
      // The built stylesheet: a path-absolute URL and one relative to the sheet.
      href: 'https://pos.example/assets/index-abc.css',
      cssRules: [
        new FakeStyleRule('.receipt { color: red; }'),
        new FakeFontFaceRule('@font-face { font-family: "Noto Sans Khmer"; font-weight: 400; src: url("/assets/khmer-400.woff2") format("woff2"), url(khmer-400.woff) format("woff"); }'),
      ],
    },
    // A <style> tag (the dev server injects CSS this way) has no href: its
    // URLs are relative to the document.
    { href: null, cssRules: [new FakeFontFaceRule("@font-face { font-family: \"Noto Sans Khmer\"; font-weight: 600; src: url('/node_modules/khmer-600.woff2'); }")] },
    // Another origin's sheet cannot be read, and is not the app's to copy.
    { href: 'https://cdn.example/other.css', get cssRules(): never { throw new Error('SecurityError') } },
    { href: 'https://pos.example/assets/inline.css', cssRules: [new FakeFontFaceRule('@font-face { font-family: X; src: url(data:font/woff2;base64,AAAA) format("woff2"); }')] },
  ],
}

const { appFontFaceCss } = await import('../src/utils/printSurface.ts')
const { buildPrintablePreviewDocument } = await import('../src/utils/printReceipt.ts')

await check('the print document gets every @font-face rule the app has, and nothing else', () => {
  const css = appFontFaceCss()
  assert.equal((css.match(/@font-face/g) || []).length, 3, 'one rule per readable face; the cross-origin sheet is skipped')
  assert.doesNotMatch(css, /color: red/, 'ordinary style rules stay out of the print document')
})

await check('font URLs are absolute, resolved the way the stylesheet resolved them', () => {
  const css = appFontFaceCss()
  assert.match(css, /url\("https:\/\/pos\.example\/assets\/khmer-400\.woff2"\) format\("woff2"\)/,
    'a path-absolute URL resolves on the app origin, not on about:blank')
  assert.match(css, /url\("https:\/\/pos\.example\/assets\/khmer-400\.woff"\) format\("woff"\)/,
    'an unquoted relative URL resolves against the stylesheet it came from')
  assert.match(css, /url\("https:\/\/pos\.example\/node_modules\/khmer-600\.woff2"\)/,
    'a <style> tag resolves against the document')
  assert.match(css, /url\("data:font\/woff2;base64,AAAA"\)/, 'a data: URL is kept as it is')
})

await check('the receipt print document embeds those rules', () => {
  const html = buildPrintablePreviewDocument({
    markup: '<section>ITEM-1|TOTAL</section>',
    widthMm: 72,
    pageHeightMm: 202.67,
    continuousRoll: false,
    singleSheet: false,
    pageSizeMode: 'driver-forms',
  })
  const head = html.slice(0, html.indexOf('</head>'))
  assert.match(head, /@font-face \{ font-family: "Noto Sans Khmer"; font-weight: 400; src: url\("https:\/\/pos\.example\/assets\/khmer-400\.woff2"\)/,
    'the Khmer face the receipt was measured with is declared in the document that prints it')
})

await check('without a DOM there is nothing to copy, and nothing throws', () => {
  delete globals.document
  try {
    assert.equal(appFontFaceCss(), '')
  } finally {
    globals.document = { baseURI: 'https://pos.example/', styleSheets: [] }
  }
})

if (failed > 0) {
  process.exitCode = 1
}
