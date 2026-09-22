// A product NAME on the storefront is never cut; every other truncated
// storefront value must be readable in full.
//
// Two rules, and the first one wins where they meet. A name SCROLLS: the
// owner's ruling is absolute -- "product names are using elipses when too
// long, remember we don't do that. we do scroll left and right" -- so the
// cart and wishlist drawer rows render the name through the app-wide
// `.detail-scroll-text` box and carry no ellipsis to reveal. Anything else
// that truncates is never a DEAD END: it reveals on hover and on tap through
// the shared TruncatedText component.
//
// This file used to pin the opposite for those two rows: they were the two
// per-record values on the storefront, so they were given the reveal (a
// customer with two similar variants in the list saw "Samsung Galaxy Buds
// Pro 2 Wire..." twice and could not tell them apart). The reveal fixed the
// dead end but kept the ellipsis, which the rule above does not allow on a
// name; the rows scroll now, and the reveal contract below still governs the
// storefront values that are not names.
//
// What is deliberately NOT a dead end, checked one by one rather than by rule:
//
//   * CatalogProductsSection's four filter labels are fixed copy() strings --
//     "Category", "Brand", "Branch", "Stock status" -- that only clip in a
//     language pack where they run long, and the menu beneath spells each out.
//   * CatalogPreviewSurface's shop name is `sm:truncate`: below sm it wraps
//     and is fully readable, which is the phone case.
//   * Its business name eyebrow and tagline are the shop's own branding at the
//     top of every page, repeated in the About section, and the tagline is
//     `hidden sm:block` so it appears only where there is room for it.
//
// Discriminating: at 4e58891f the scan below returns the two cart/wishlist
// name rows, and TruncatedText is imported by neither storefront file.
//
// Run: node tests/storefrontTruncationReveal.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

function read(relative: string): string {
  return fs.readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
}

// ---------------------------------------------------------------------------
// The instrument
// ---------------------------------------------------------------------------

// A dead end is a element that truncates unconditionally AND prints a single
// dynamic expression. JSX is written across several lines, so the source is
// flattened first; comments go so prose about truncation is not a finding.
export function findDeadEndTruncations(source: string): string[] {
  const flat = source
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\s+/g, ' ')
  const found: string[] = []
  for (const match of flat.matchAll(/className="([^"]*\btruncate\b[^"]*)"([^>]*)>\s*\{([^}]+)\}/g)) {
    const classes = match[1]
    const expression = match[3].trim()
    // `sm:truncate` alone wraps below sm, where the screen is narrowest -- the
    // text is reachable there, so it is not a dead end.
    if (!/(?:^|\s)truncate(?:\s|$)/.test(classes)) continue
    // A fixed label from the language pack is not per-record data.
    if (/^copy\(/.test(expression)) continue
    found.push(`${expression} -- className="${classes}"`)
  }
  return found
}

runTest('the scan separates a per-record dead end from chrome that is not one', () => {
  const fixture = [
    '<div className="truncate text-sm">{item.name}</div>',                    // dead end
    '<div className="block truncate">{copy(\'category\', \'Category\')}</div>', // fixed label
    '<div className="sm:truncate text-lg">{shop.title}</div>',                 // wraps below sm
    '<div className="text-sm">{item.name}</div>',                              // not truncated
    '<div className="truncate">',
    '  {product.description}',
    '</div>',                                                                  // dead end, across lines
  ].join('\n')
  assert.deepEqual(findDeadEndTruncations(fixture), [
    'item.name -- className="truncate text-sm"',
    'product.description -- className="truncate"',
  ])
})

// ---------------------------------------------------------------------------
// The storefront
// ---------------------------------------------------------------------------

const STOREFRONT_SOURCES = [
  '../src/components/catalog/PublicCatalogPage.tsx',
  '../src/components/catalog/CatalogPreviewSurface.tsx',
  '../src/components/catalog/CatalogProductsSection.tsx',
  '../src/components/catalog/ProductDetailFlyout.tsx',
]

// Two truncations the scan finds that are NOT per-record data and are left as
// they are, listed by expression so a third cannot join them unnoticed. Both
// are the shop's own branding in the header, configured by the shop owner and
// repeated in full inside the About section; the tagline is additionally
// `hidden sm:block`, so it never appears on the narrow screen where it would
// clip worst. They are named here rather than skipped by a rule because
// "branding" is a judgement, and the next reader should get to disagree with
// it. Revisit if a shop ever reports a clipped tagline.
const BRANDING_EXCEPTIONS = ['displayConfig.businessName', 'displayConfig.businessTagline']

runTest('no storefront surface truncates a per-record value with no way back', () => {
  const deadEnds = STOREFRONT_SOURCES.flatMap((relative) => findDeadEndTruncations(read(relative)).map((hit) => `${relative.split('/').pop()}: ${hit}`))
  const excepted = deadEnds.filter((hit) => BRANDING_EXCEPTIONS.some((expression) => hit.includes(`: ${expression} --`)))
  assert.equal(excepted.length, BRANDING_EXCEPTIONS.length, 'every named exception must still exist -- a stale one hides the next real dead end')
  assert.deepEqual(
    deadEnds.filter((hit) => !excepted.includes(hit)),
    [],
    'an ellipsis on a product name must open the full text on hover and on tap',
  )
})

runTest('the cart and the wishlist scroll the name instead of cutting it', () => {
  const publicPage = read('../src/components/catalog/PublicCatalogPage.tsx')
  // The scroller is the app-wide one in styles/main.css, not a second
  // implementation, and it is applied through `getKhmerTextProps` so a Khmer
  // name gets `khmer-text` -- the portal does not set the admin app's
  // `body.lang-km`, so the Khmer line box has to be bought off the value.
  const scrollers = publicPage.match(/<div \{\.\.\.getKhmerTextProps\(item\.name, 'detail-scroll-text[^']*'\)\}>\{item\.name\}<\/div>/g) || []
  assert.equal(scrollers.length, 2, 'both the cart panel row and the wishlist panel row scroll the name')
  assert.match(publicPage, /import \{ getKhmerTextProps \} from '\.\.\/\.\.\/utils\/scriptTypography\.ts'/, 'the shared Khmer helper, not a local script test')
  assert.doesNotMatch(publicPage, /TruncatedText/, 'a name must not be handed to the truncating component at all')
  // The row must keep its own layout: the name still shares the line with the
  // quantity stepper and the remove button, so it stays inside the flex child
  // that can shrink. A scroller that is not inside `min-w-0` would widen the
  // row instead of scrolling inside it.
  assert.equal((publicPage.match(/<div className="min-w-0 flex-1">\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<div \{\.\.\.getKhmerTextProps\(item\.name/g) || []).length, 2,
    'the name must stay inside the shrinking column of the row')
  // NEGATIVE CONTROL: the shape above is specific enough to fail if the name
  // goes back to being clipped, or leaks out of the shrinking column.
  assert.equal((`<div className="min-w-0 flex-1">
                    <TruncatedText text={item.name} className="text-sm" />`.match(/<div \{\.\.\.getKhmerTextProps\(item\.name, 'detail-scroll-text[^']*'\)\}>/g) || []).length, 0,
    'the check must not pass on the markup it replaced')
})

runTest('the reveal is usable by touch, not hover alone', () => {
  // The storefront's NAMES no longer use this component (they scroll), but
  // the reveal contract still governs every storefront value that truncates
  // and every surface that still hands text to TruncatedText, so it stays
  // pinned here rather than being deleted with the two rows.
  //
  // The component delegates its float and input handling to the one shared
  // controller. Lock the complete connection down: click, hover, keyboard,
  // and the long-press gesture available on touch screens. This replaces the
  // retired component-local createPortal/onClick implementation.
  const component = read('../src/components/shared/TruncatedText.tsx')
  const controller = read('../src/components/shared/textAffordances.ts')
  assert.match(component, /ensureTextAffordances\(\)/, 'the storefront wrapper mounts the delegated controller')
  assert.ok(component.includes('[REVEAL_ATTR]: text'), 'the storefront wrapper opts its full text into the controller')
  assert.match(component, /title=\{clipped \? text : undefined\}/, 'a value that fits does not gain a redundant reveal')
  assert.match(component, /tabIndex=\{clipped \? 0 : undefined\}/, 'the keyboard reaches only a clipped value')
  assert.match(controller, /document\.addEventListener\('click'[\s\S]*?apply\(\{ type: 'click'/, 'click opens through the controller')
  assert.match(controller, /document\.addEventListener\('mouseover'[\s\S]*?type: 'hover-in'/, 'hover opens through the controller')
  assert.match(controller, /document\.addEventListener\('touchstart'[\s\S]*?press\.onTouchStart/, 'touch arms the shared long-press reveal')
  assert.match(controller, /onLongPress:[\s\S]*?kind: pressKind/, 'a touch hold preserves reveal rather than hardcoding copy')
  assert.match(controller, /event\.key !== 'Enter' && event\.key !== ' '/, 'Enter and Space activate the reveal')
  assert.match(controller, /document\.body\.appendChild\(host\)/, 'the shared float escapes the overlay that clipped the text')
  assert.doesNotMatch(component, /createPortal\(/, 'the storefront wrapper must not recreate a second tooltip implementation')
})

if (failed > 0) {
  console.error(`\n${failed} storefront truncation check(s) failed`)
  process.exit(1)
}
console.log('\nAll storefront truncation checks passed')
