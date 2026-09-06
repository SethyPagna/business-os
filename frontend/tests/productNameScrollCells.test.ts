// N36 -- "for product names, make it horizontal scroll instead of pushing
// rows... make sure it is smooth ios pwa and android pwa, responsive etc...
// clean no need show the scroll bar... just built in." (owner, Sep 6 2026)
//
// Three properties, all of which have failed in this repo before and none of
// which a screenshot would catch:
//
//   1. The class exists once, in styles/main.css, and declares every part of
//      "scrolls, cleanly, on a phone": overflow-x, nowrap, hidden scrollbar in
//      both engines, native momentum, no overscroll chaining.
//   2. It does NOT pin touch-action. A name cell sits inside a vertically
//      scrolling list; `touch-action: pan-x` (which the neighbouring
//      .compact-action-row does use, correctly, for a horizontal toolbar)
//      would make a vertical swipe that happens to start on a product name do
//      nothing at all. This is the "smooth ios pwa and android pwa" half and
//      it is invisible on a desktop mouse.
//   3. EVERY product-name cell uses that one class -- the Products desktop
//      row and mobile card, both group titles, Inventory / Branches >
//      Products desktop and mobile rows, and the image-only view -- and none
//      of those files carries scroll CSS of its own.
//
// Run: node tests/productNameScrollCells.test.ts

import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (rel: string) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8')
const css = read('styles/main.css')

let failures = 0
function runTest(name: string, fn: () => void) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failures++
    console.error(`FAIL ${name}`)
    console.error(String((error as Error).message))
  }
}

function block(source: string, selector: string): string {
  const at = source.indexOf(`\n${selector} {`)
  assert.ok(at > 0, `no CSS rule for selector: ${selector}`)
  const open = source.indexOf('{', at)
  const close = source.indexOf('}', open)
  return source.slice(open + 1, close)
}

// The class string that OWNS a marker: the nearest class-carrying opener
// before it. Two shapes exist in these files -- a plain className="..." and
// the Khmer-aware getKhmerTextProps(name, '...' | `...`) -- and the nearest of
// the two wins. Markers are chosen so that opener is the name cell itself.
const OPENERS = [
  { lead: 'className="', close: '"' },
  { lead: "getKhmerTextProps(productName, '", close: "'" },
  { lead: 'getKhmerTextProps(productName, `', close: '`' },
]

function classNear(source: string, marker: string): string {
  const at = source.indexOf(marker)
  assert.ok(at > 0, `marker not found: ${marker}`)
  let best = { start: -1, close: '"' }
  for (const opener of OPENERS) {
    const found = source.lastIndexOf(opener.lead, at)
    if (found > -1 && found + opener.lead.length > best.start) {
      best = { start: found + opener.lead.length, close: opener.close }
    }
  }
  assert.ok(best.start > 0, `no class string before marker: ${marker}`)
  const end = source.indexOf(best.close, best.start)
  assert.ok(end > best.start, `unterminated class string before marker: ${marker}`)
  return source.slice(best.start, end)
}

// ---------------------------------------------------------------------------
// 1. The shared class
// ---------------------------------------------------------------------------

runTest('.scroll-x-clean scrolls horizontally with no visible scrollbar', () => {
  const rule = block(css, '.scroll-x-clean')
  assert.match(rule, /overflow-x:\s*auto/, 'must scroll horizontally')
  assert.match(rule, /white-space:\s*nowrap/, 'the name must stay on one line')
  assert.match(rule, /min-width:\s*0/, 'must be able to shrink inside a flex/table cell')
  assert.match(rule, /text-overflow:\s*clip/, 'a scrolling name must not also grow an ellipsis')
  assert.match(rule, /scrollbar-width:\s*none/, 'Firefox/standards scrollbar hidden')
  assert.match(rule, /-webkit-overflow-scrolling:\s*touch/, 'iOS momentum scrolling')
  assert.match(rule, /overscroll-behavior-inline:\s*contain/, 'a horizontal fling must not chain out to the page')
  const bar = block(css, '.scroll-x-clean::-webkit-scrollbar')
  assert.match(bar, /display:\s*none/, 'WebKit/Blink scrollbar hidden -- this is the iOS and Android PWA case')
})

runTest('.scroll-x-clean does NOT pin touch-action, so vertical list scrolling survives', () => {
  const rule = block(css, '.scroll-x-clean')
  assert.doesNotMatch(rule, /touch-action/, 'pinning the axis would break a vertical swipe that starts on a product name')
  // Positive control: the class this one is modelled on DOES pin it, so the
  // assertion above is checking a real distinction and not a typo.
  assert.match(block(css, '.compact-action-row'), /touch-action:\s*pan-x/, 'positive control: the horizontal toolbar class still pins pan-x')
})

runTest('Khmer names keep their ink inside the scrolling box', () => {
  // overflow-y: hidden cannot take an overflow-clip-margin, so without a line
  // -height floor every coeng subscript would be sheared off.
  assert.match(css, /body\.lang-km \.scroll-x-clean[\s\S]{0,80}line-height:\s*var\(--km-line-height/, 'the km line-height floor must be restated for the scrolling cell')
})

// ---------------------------------------------------------------------------
// 2. Every product-name cell uses it -- sibling parity
// ---------------------------------------------------------------------------

const NAME_CELLS: Array<[string, string, string]> = [
  ['Products desktop table row', 'components/products/Products.tsx', '${indented ? \'font-medium\' : \'font-semibold\'}'],
  ['Products mobile card', 'components/products/Products.tsx', 'text-sm font-semibold text-gray-900 dark:text-white'],
  ['Products group title (desktop)', 'components/products/surfaces/ProductsListSurface.tsx', 'text-left text-sm font-semibold text-slate-700'],
  ['Products group title (mobile)', 'components/products/surfaces/ProductsListSurface.tsx', 'text-left text-sm font-semibold text-slate-800'],
  ['Inventory / Branches > Products desktop row', 'components/inventory/InventoryProductsSurface.tsx', 'font-medium text-slate-800 dark:text-slate-100'],
  ['Inventory / Branches > Products mobile row', 'components/inventory/InventoryProductsSurface.tsx', '{product.name || \'—\'}</span><strong>'],
  ['Products image-only view', 'components/products/ProductsImageOnlyView.tsx', 'text-sm font-medium text-gray-800 dark:text-gray-100'],
]

runTest('every product-name cell carries the one shared class', () => {
  for (const [label, file, marker] of NAME_CELLS) {
    const owner = classNear(read(file), marker)
    assert.ok(owner.includes('scroll-x-clean'), `${label}: name cell classes are "${owner}"`)
  }
})

runTest('no product-name cell still wraps or ellipsises instead of scrolling', () => {
  for (const [label, file, marker] of NAME_CELLS) {
    const owner = classNear(read(file), marker)
    assert.doesNotMatch(owner, /\bbreak-words\b/, `${label}: still wraps to a second row`)
    assert.doesNotMatch(owner, /\btruncate\b/, `${label}: still ends in an unreadable ellipsis`)
    assert.doesNotMatch(owner, /\bline-clamp-/, `${label}: still clamps to N lines`)
  }
})

runTest('the scroll behaviour lives in ONE place, not per file', () => {
  for (const [, file] of NAME_CELLS) {
    const source = read(file)
    assert.doesNotMatch(source, /overflow-x-auto[^"'`\s]*\s+[^"'`]*whitespace-nowrap[^"'`]*scrollbar/, `${file}: hand-rolled scroll classes`)
    assert.doesNotMatch(source, /\[-webkit-overflow-scrolling/, `${file}: per-file momentum-scroll arbitrary value`)
    assert.doesNotMatch(source, /::-webkit-scrollbar/, `${file}: per-file scrollbar CSS`)
  }
  assert.equal((css.match(/^\.scroll-x-clean \{/gm) || []).length, 1, '.scroll-x-clean must be declared exactly once')
})

// ---------------------------------------------------------------------------
// 3. The row must not have lost anything else
// ---------------------------------------------------------------------------

runTest('the name cells keep their existing behaviour and handlers', () => {
  const products = read('components/products/Products.tsx')
  // Tap-to-open: the row-level long-press/click handlers that open the detail
  // sheet are untouched by a class-only change, and both rows still bind them.
  assert.ok((products.match(/createLongPressHandlers\(rowLongPressState, \{/g) || []).length >= 2, 'both product rows keep their long-press/tap handlers')
  assert.match(products, /onClick: \(\) => \{ if \(!dupInfo\) setDetailProduct\(p\) \}/, 'tap-to-open detail is preserved')
  // Khmer name detection still wraps the name, so the shared class composes
  // with the Khmer text class rather than replacing it.
  assert.equal(
    (products.match(/getKhmerTextProps\(productName, ['`]scroll-x-clean/g) || []).length,
    2,
    'both product-name cells still route their class through getKhmerTextProps',
  )
})

if (failures) {
  console.error(`${failures} failing check(s)`)
  process.exit(1)
}
console.log('PASS productNameScrollCells')
