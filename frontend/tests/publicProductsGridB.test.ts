// Lane 6.0.865 (design review B1-B10): the public products grid.
//
// Run: node tests/publicProductsGridB.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

// catalogUi is TSX, which Node cannot import directly; bundle it for the test.
const bundled = buildSync({
  entryPoints: [fileURLToPath(new URL('../src/components/catalog/catalogUi.tsx', import.meta.url))],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'],
}).outputFiles[0].text
const uiModule = { exports: {} as Record<string, unknown> }
new Function('require', 'module', 'exports', bundled)(() => ({}), uiModule, uiModule.exports)
const microLabelProps = uiModule.exports.microLabelProps as (text: unknown, className?: string, latin?: string) => { lang?: string; className: string }

const here = (relative: string): string =>
  readFileSync(new URL(`../src/components/catalog/${relative}`, import.meta.url), 'utf8').replace(/\r\n?/g, '\n')

const FILES = [
  'CatalogProductsSection.tsx',
  'PortalBrowseRow.tsx',
  'PortalFilterCombobox.tsx',
  'catalogUi.tsx',
  'PortalPromoStrip.tsx',
  'PortalPromotionsBanner.tsx',
]
const products = here('CatalogProductsSection.tsx')
const banner = here('PortalPromotionsBanner.tsx')

let failed = 0
function check(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

check('B2: a 44px clear button empties the search and returns focus to the field', () => {
  const button = /<button\s+type="button"\s+data-search-clear="true"[\s\S]*?<\/button>/.exec(products)
  assert.ok(button, 'the clear button must exist')
  assert.match(button[0], /w-11\b/, 'a 44px wide target')
  assert.match(button[0], /setSearch\(''\)/, 'it empties the search')
  assert.match(button[0], /searchInputRef\.current\?\.focus\(\)/, 'and keeps the shopper typing')
  assert.match(button[0], /aria-label=\{copy\('clearSearch'/, 'with a translated name')
  assert.match(products, /\{search \? \(\s*<button\s+type="button"\s+data-search-clear/, 'shown only while there is a term')
})

check('B2: the placeholder is the concise Khmer phrase and the focus ring is brass, not blue', () => {
  assert.match(products, /copy\('searchProductsShort', 'Search products', 'ស្វែងរកផលិតផល'\)/)
  assert.match(products, /placeholder=\{searchLabel\}/)
  assert.match(products, /focus-within:border-amber-700 focus-within:ring-2 focus-within:ring-amber-300/)
  assert.match(products, /focus-visible:!outline-none/, 'the global sky outline is not drawn around the bare input')
})

check('B3: the subtitle promises availability only while stock status is shown', () => {
  const subtitle = /subtitle=\{([\s\S]*?)\}\n\s*>/.exec(products)
  assert.ok(subtitle, 'SectionShell subtitle')
  assert.match(subtitle[1], /shouldShowStockStatus\(previewConfig\)\s*\? copy\('liveCatalog'/)
  assert.match(subtitle[1], /: copy\('liveCatalogNoStock', 'Browse our products\.'/)
  assert.doesNotMatch('Browse our products.', /availability/i)
})

check('B5: Khmer micro-labels are at least 12px with no case or tracking; Latin keeps its style', () => {
  const khmer = microLabelProps('ម៉ាក', 'x')
  assert.equal(khmer.lang, 'km')
  assert.match(khmer.className, /\btext-xs\b/)
  assert.match(khmer.className, /\bnormal-case\b/)
  assert.match(khmer.className, /\btracking-normal\b/)
  assert.doesNotMatch(khmer.className, /uppercase|text-\[1[01]px\]|tracking-wide/)
  const latin = microLabelProps('Brand')
  assert.equal(latin.lang, undefined)
  assert.match(latin.className, /text-\[10px\] uppercase tracking-wide/)
  // No micro-label in these files is hard-wired uppercase any more.
  for (const file of ['CatalogProductsSection.tsx', 'PortalBrowseRow.tsx', 'PortalPromotionsBanner.tsx']) {
    assert.doesNotMatch(here(file), /className="[^"]*\buppercase\b/, `${file}: uppercase must come from microLabelProps`)
  }
})

check('B6: the empty state names the search term and offers Clear search / Clear filters', () => {
  const empty = /data-portal-empty="true"[\s\S]*?\n        <\/div>/.exec(products)
  assert.ok(empty, 'the empty block')
  assert.match(empty[0], /copy\('noProductsForSearch'[\s\S]*?\{ term: searchTerm \}/)
  assert.match(empty[0], /data-empty-clear-search[\s\S]*?setSearch\(''\)/)
  assert.match(empty[0], /data-empty-clear-filters[\s\S]*?onClick=\{clearPortalFilters\}/)
  assert.match(empty[0], /portalActiveFilterCount > 0/, 'Clear filters only when filters are on')
})

check('B7: the inline error offers Retry through an onRetry prop', () => {
  assert.match(products, /onRetry\?: \(\) => void/)
  const error = /\{portalError \? \([\s\S]*?\) : null\}/.exec(products)
  assert.ok(error, 'the error block')
  assert.match(error[0], /\{onRetry \? \(/, 'Retry renders only when a retry function is supplied')
  assert.match(error[0], /onClick=\{onRetry\}/)
  assert.match(error[0], /copy\('retry'/)
})

check('B1: one collapsible promotions area holds the strip, the banner slot and at most two cards', () => {
  assert.equal((products.match(/<PortalPromoStrip\b/g) || []).length, 1)
  const area = /data-portal-promotions="true"[\s\S]*?<\/section>/.exec(products)
  assert.ok(area, 'the single area')
  assert.match(area[0], /aria-expanded=\{promotionsOpen\}/, 'collapsible')
  assert.match(area[0], /min-h-11/, 'a 44px toggle')
  for (const piece of ['<PortalPromoStrip', '{promotionsBanner}', 'promotionCards.map', 'promotionExtras.map']) assert.ok(area[0].includes(piece), `${piece} lives inside the area`)
  assert.match(products, /const MAX_PROMOTION_CARDS = 2/)
  assert.match(products, /const promotionCards = visiblePromotionItems\.slice\(0, MAX_PROMOTION_CARDS\)/)
  assert.match(products, /const promotionExtras = visiblePromotionItems\.slice\(MAX_PROMOTION_CARDS\)/)
  assert.doesNotMatch(products, /from-rose-600 via-rose-500 to-orange-500/, 'the rose card panel is gone')
  assert.match(banner, /const MAX_PROMOTION_CARDS = 2/)
  assert.doesNotMatch(banner, /promotions\.slice\(0, MAX_PROMOTION_CARDS\)/, 'no promotion is dropped')
})

check('B1: three promotions -> two full cards, the third stays reachable as a chip', () => {
  // Section: the first two items are cards, every later one is a chip carrying its title and link.
  assert.doesNotMatch(products, /filter\(\(item\) => item\?\.title[^\n]*\.slice\(0, MAX_PROMOTION_CARDS\)/, 'the filter no longer discards extras')
  const extras = /data-portal-promotion-extras="true"[\s\S]*?<\/ul>/.exec(products)
  assert.ok(extras, 'the extras row exists')
  assert.match(extras[0], /promotionExtras\.map/)
  assert.match(extras[0], /\{text\}/, 'the chip prints the promotion title')
  assert.match(extras[0], /min-h-11/, '44px chips')
  assert.match(extras[0], /openProductById/, 'chips keep the card link behaviour')
  assert.match(extras[0], /href=\{href\}/)
  // Banner: index >= 2 renders a compact chip, not nothing.
  const chip = /if \(index >= MAX_PROMOTION_CARDS\) \{[\s\S]*?data-promotion-chip="true"[\s\S]*?\{promo\.title\}/.exec(banner)
  assert.ok(chip, 'banner chip for promotion #3 onward prints its title')
  assert.match(chip[0], /handleActivate\(promo\)/, 'and still activates')
})

check('B4 reverted (owner P11-5): the per-card details link stays, compact, 44px, brass, translated', () => {
  assert.match(products, /copy\('clickToViewDetails', 'Click to view details', '[^']+'\)/)
  assert.match(products, /min-h-11 items-center text-left text-xs font-medium text-amber-800/)
})

check('B8: labels wrap instead of truncating', () => {
  assert.doesNotMatch(here('PortalBrowseRow.tsx'), /\btruncate\b/)
  assert.doesNotMatch(products, /className="block truncate"/)
  assert.doesNotMatch(here('PortalFilterCombobox.tsx'), /<span className="truncate">/)
})

check('B9: the promotions toggle uses a Check icon on brass, not a raw tick on rose', () => {
  assert.doesNotMatch(products, /'✓'/)
  assert.match(products, /\{promoFacet \? <CheckCircle2 /)
  assert.doesNotMatch(products, /bg-rose-600 text-white ring-rose-600/)
  assert.match(products, /bg-amber-700 text-white ring-amber-700/)
})

check('B10: promotion titles wrap and are never clamped', () => {
  assert.doesNotMatch(banner, /line-clamp/)
  assert.match(banner, /break-words text-sm font-semibold leading-snug text-white/)
})

check('brass: no blue, sky, cyan, indigo or violet accent classes remain in the grid files', () => {
  for (const file of FILES) {
    const source = here(file)
    const hits = source.match(/\b(?:[a-z-]+:)*(?:text|bg|border|ring|from|via|to|outline|fill|stroke)-(?:blue|sky|cyan|indigo|violet|fuchsia)-\d+/g) || []
    assert.deepEqual(hits, [], `${file} still paints a non-brass accent`)
    assert.doesNotMatch(source, /text-blue-|bg-blue-/, `${file}`)
  }
})

check('stock semantics keep rose / amber / emerald', () => {
  const ui = here('catalogUi.tsx')
  assert.match(ui, /out_of_stock'\) return 'text-rose-700/)
  assert.match(ui, /low_stock'\) return 'text-amber-700/)
  assert.match(ui, /return 'text-emerald-700/)
})

if (failed) {
  console.error(`${failed} check(s) failed`)
  process.exit(1)
}
console.log('publicProductsGridB tests passed')
