// A truncated product name on the storefront must be readable in full.
//
// The standing rule is that ellipsis-truncated text is never a dead end: it
// reveals on hover and on tap, through the shared TruncatedText component.
// The storefront had two places that broke it, and they are the two where the
// text is a per-record value rather than chrome -- the product NAME in the
// cart panel and in the wishlist panel (PublicCatalogPage). A customer with
// two similar variants in the list saw "Samsung Galaxy Buds Pro 2 Wire..."
// twice and had no way to tell them apart before sending the list to the shop.
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

runTest('the cart and the wishlist both reveal the name through the shared component', () => {
  const publicPage = read('../src/components/catalog/PublicCatalogPage.tsx')
  assert.match(publicPage, /import TruncatedText from '\.\.\/shared\/TruncatedText\.tsx'/, 'the shared component, not a local tooltip')
  const uses = publicPage.match(/<TruncatedText text=\{item\.name\}/g) || []
  assert.equal(uses.length, 2, 'both the cart panel row and the wishlist panel row')
  // The row must keep its own layout: the name still shares the line with the
  // quantity stepper and the remove button, so it stays a flex child that can
  // shrink. TruncatedText renders `block truncate` itself.
  assert.equal((publicPage.match(/<div className="min-w-0 flex-1">\s*<TruncatedText text=\{item\.name\}/g) || []).length, 2,
    'the name must stay inside the shrinking column of the row')
})

runTest('the reveal is usable by touch, not hover alone', () => {
  // The whole point on a phone: there is no hover on a touch screen, and the
  // cart panel is a phone surface first.
  const component = read('../src/components/shared/TruncatedText.tsx')
  assert.match(component, /onClick=\{overflowing \?/, 'tap opens it')
  assert.match(component, /onMouseEnter=\{overflowing \?/, 'hover opens it on a pointer')
  assert.match(component, /onFocus=\{overflowing \?/, 'and the keyboard reaches it')
  assert.match(component, /setOverflowing\(el\.scrollWidth > el\.clientWidth \+ 1\)/, 'and none of that appears when the text already fits')
  assert.match(component, /createPortal\(/, 'the panel escapes the overlay that clipped the text')
})

if (failed > 0) {
  console.error(`\n${failed} storefront truncation check(s) failed`)
  process.exit(1)
}
console.log('\nAll storefront truncation checks passed')
