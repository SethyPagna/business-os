// Public web overhaul, lane PRODUCTS (spec sections 0, 1 and 9): every surface in the Products
// files is solid, the field line clears 3:1 on every ground it can sit on, the helper line and the
// per-card "Click to view details" are gone, and the pager hides its range text below `sm`.
//
// Run: node tests/portalProductSurfaces.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { contrastRatio } from '../src/components/catalog/portalContrast.ts'
import {
  PRODUCT_ACTIVE_CLASS,
  PRODUCT_CHIP_CLASS,
  PRODUCT_CONTROL_CLASS,
  PRODUCT_FIELD_CLASS,
  PRODUCT_SURFACE_CLASS,
  productMetaFields,
  productStockBadge,
} from '../src/components/catalog/portalProductSurfaces.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const catalogDir = path.join(here, '..', 'src', 'components', 'catalog')
const read = (name: string) => fs.readFileSync(path.join(catalogDir, name), 'utf8').replace(/\r\n/g, '\n')

// 1. The field line. Tailwind stone-500 / neutral-500 are the first steps that reach 3:1 against the
//    ivory page (#f4f1ea), the white card and the dark ground; stone-400 / neutral-600, the draft
//    colours, do not, and this is the assertion that tells them apart.
const IVORY = '#f4f1ea'
const WHITE = '#ffffff'
const DARK_GROUND = '#0b0b0c'
const DARK_CARD = '#171717'
const STONE_400 = '#a8a29e'
const STONE_500 = '#78716c'
const NEUTRAL_500 = '#737373'
const NEUTRAL_600 = '#525252'
assert.ok(contrastRatio(STONE_500, IVORY) >= 3, 'light field line on the ivory page')
assert.ok(contrastRatio(STONE_500, WHITE) >= 3, 'light field line on a white card')
assert.ok(contrastRatio(NEUTRAL_500, DARK_GROUND) >= 3, 'dark field line on the dark ground')
assert.ok(contrastRatio(NEUTRAL_500, DARK_CARD) >= 3, 'dark field line on a dark card')
assert.ok(contrastRatio(STONE_400, IVORY) < 3, 'the draft light line fails, so the check can fail')
assert.ok(contrastRatio(NEUTRAL_600, DARK_GROUND) < 3, 'the draft dark line fails, so the check can fail')
assert.match(PRODUCT_FIELD_CLASS, /\bborder-stone-500\b/)
assert.match(PRODUCT_FIELD_CLASS, /\bdark:border-neutral-500\b/)
// Brass as small text and as a control fill: 4.5:1 with its own ink.
assert.ok(contrastRatio('#7a5c22', WHITE) >= 4.5, 'brass text on white')
assert.ok(contrastRatio(WHITE, '#7a5c22') >= 4.5, 'white ink on the active brass fill')
assert.ok(contrastRatio('#23201b', '#d6b56b') >= 4.5, 'dark ink on the dark-mode active fill')
assert.ok(contrastRatio('#d6b56b', DARK_CARD) >= 4.5, 'dark-mode brass text on a dark card')

// 2. No opacity suffix, no blur and no transparent fill on any surface in these files. Comments are
//    dropped first; they may name the old classes. Allowed by name: the modal scrim and the darkening
//    gradient over a photo (neither carries text or a control), and `to-transparent`, the far end of
//    a scroll-edge fade, which has no opacity suffix and so never matches.
const SOLID_FILES = [
  'portalProductSurfaces.ts',
  'PortalBrowseRow.tsx',
  'PortalFilterCombobox.tsx',
  'catalogPagination.tsx',
  'PortalPromoStrip.tsx',
  'PortalPromotionsBanner.tsx',
  'PortalAnnouncementStrip.tsx',
  'CatalogProductsSection.tsx',
]
const stripComments = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const OPACITY_SUFFIX = /\b(?:[a-z-]+:)*(?:bg|border|ring|outline|from|via|to|decoration|shadow)-(?:[a-z]+-\d{2,3}|white|black|\[#[0-9a-fA-F]{3,8}\])\/\d+/g
const ALLOWED = new Set(['bg-black/50', 'from-black/25'])
for (const name of SOLID_FILES) {
  const code = stripComments(read(name))
  const opacity = (code.match(OPACITY_SUFFIX) || []).filter((token) => !ALLOWED.has(token))
  assert.deepEqual(opacity, [], `${name}: opacity suffix on a surface`)
  assert.doesNotMatch(code, /backdrop-blur|backdrop-filter/, `${name}: no blur`)
  assert.doesNotMatch(code, /\bbg-transparent\b/, `${name}: no transparent fill`)
}
// The checker itself must see the old shapes it is there to catch.
for (const old of ['bg-white/95', 'dark:bg-neutral-900/80', 'border-amber-700/40', 'hover:bg-white/15', 'dark:ring-amber-400/60', 'bg-amber-50/60']) {
  assert.ok((old.match(OPACITY_SUFFIX) || []).length === 1, `the scan flags ${old}`)
}

// 3. The recipes carry their dark pair and use no opacity themselves.
for (const recipe of [PRODUCT_SURFACE_CLASS, PRODUCT_FIELD_CLASS, PRODUCT_ACTIVE_CLASS, PRODUCT_CHIP_CLASS, PRODUCT_CONTROL_CLASS]) {
  assert.match(recipe, /\bdark:/, `dark pair present in: ${recipe.slice(0, 40)}`)
}
assert.match(PRODUCT_SURFACE_CLASS, /border-stone-300 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900/)

const products = read('CatalogProductsSection.tsx')

// 4. The search field and both Filters buttons use the recipes, and the search input is not transparent.
assert.match(products, /\$\{PRODUCT_FIELD_CLASS\} \$\{search \? 'pr-12' : 'pr-3'\}/, 'the search label is the field recipe')
assert.match(products, /id="portal-product-search"/)
assert.equal((products.match(/PRODUCT_ACTIVE_CLASS : PRODUCT_CONTROL_CLASS/g) || []).length, 2, 'both Filters triggers (below and from lg) use the recipes')
assert.match(products, /title=\{copy\('filters', 'Filters'\)\}/, 'the icon-only Filters trigger has a tooltip')

// 5. Helper line gone; the promotions card is a surface; the built-in hint sentence is gone.
assert.doesNotMatch(products, /copy\('liveCatalog'|copy\('liveCatalogNoStock'|Browse our products/, 'no helper line under the tabs')
assert.doesNotMatch(products, /subtitle=/, 'SectionShell gets no subtitle')
assert.match(products, /data-portal-promotions="true" className=\{`mb-4 rounded-2xl px-3 \$\{PRODUCT_SURFACE_CLASS\}`\}/, 'the promotions card is a surface')
assert.doesNotMatch(products, /promotionsSectionHint/, 'no built-in promotions hint sentence')

// 6. Filter rows are flat (no tile inside the menu panel) and share one row component.
assert.doesNotMatch(products, /rounded-\[1\.1rem\]|rounded-\[1\.35rem\]|rounded-\[22px\]/, 'no radius above 2xl, no nested tiles')
assert.ok((products.match(/<PortalFilterRow /g) || []).length >= 3, 'category, brand and stock rows share PortalFilterRow')
assert.doesNotMatch(read('PortalBrowseRow.tsx'), /rounded-\[|ring-1 ring-slate-100/, 'the browse row is not a tile')

// 7. The pager: one centred row, the range text hidden below sm (the page / total stays).
const pagination = read('catalogPagination.tsx')
assert.match(pagination, /max-sm:\[&_\[data-pager-range\]\]:hidden/, 'range text hides below sm')
assert.match(pagination, /layout="centered"/)

// 7b. The card is a surface: picture tile, one meta line, the name, then price / heart / Add. No
//     "Click to view details", no transparent card, controls are 40px or more.
const cardAt = products.indexOf('data-product-card="true"')
const card = products.slice(cardAt, products.indexOf('</article>', cardAt))
assert.ok(cardAt > 0, 'the card is still there')
assert.match(card, /\$\{PRODUCT_SURFACE_CLASS\}/, 'the card carries the surface recipe')
assert.match(card, /rounded-2xl/)
assert.doesNotMatch(card, /overflow-hidden bg-transparent/, 'the old see-through card')
assert.doesNotMatch(card, /clickToViewDetails/, 'no per-card details link')
assert.match(card, /rounded-xl bg-stone-100/, 'the picture is a tile inside the card')
assert.match(card, /max-h-\[2lh\]/, 'the name is two lines at most')
assert.doesNotMatch(card, /line-clamp|\btruncate\b/, 'a business name is never cut with an ellipsis')
assert.match(card, /detail-scroll-text/, 'the meta line scrolls sideways instead of wrapping to a second line')
assert.match(card, /h-10 w-10 shrink-0 items-center justify-center rounded-full/, 'the heart is a 40px target')
assert.match(card, /inline-flex h-10 min-w-10 shrink-0/, 'Add is a 40px target')
assert.match(card, /translate="no"/, 'names and prices keep translate=no')
assert.doesNotMatch(card, /supplier|cost|purchase_price|custom_fields|tag_label/i, 'the card never reads cost, supplier or internal tags')
// The pill on the picture uses the shared solid recipe and keeps its three meanings.
const inStock = productStockBadge('in_stock')
const lowStock = productStockBadge('low_stock')
const outStock = productStockBadge('out_of_stock')
assert.match(inStock.pillClass, /emerald-700/)
assert.match(lowStock.pillClass, /amber-800/)
assert.match(outStock.pillClass, /rose-700/)
assert.notEqual(inStock.dotClass, outStock.dotClass)
for (const pill of [inStock, lowStock, outStock]) assert.match(pill.pillClass, /\bbg-white\b.*\bdark:bg-neutral-900\b/)
assert.ok(contrastRatio('#be123c', WHITE) >= 4.5 && contrastRatio('#92400e', WHITE) >= 4.5 && contrastRatio('#047857', WHITE) >= 4.5, 'stock ink on the white pill')
// The badge on the picture: emerald-600 with white ink is 3.77:1, so the card uses emerald-700.
assert.ok(contrastRatio('#ffffff', '#059669') < 4.5, 'emerald-600 would fail')
assert.match(products, /'bg-emerald-700 text-white/)

// 7c. The meta line: the field the group heading already says is left out; the promoted block keeps both.
const book = { category: 'Skincare', brand: 'Avene' }
const on = { showCategory: true, showBrand: true }
assert.deepEqual(productMetaFields(book, { ...on, groupField: 'brand', underGroupHeading: true }).map((f) => f.kind), ['category'], 'under a brand heading: category only')
assert.deepEqual(productMetaFields(book, { ...on, groupField: 'category', underGroupHeading: true }).map((f) => f.kind), ['brand'], 'under a category heading: brand only')
assert.deepEqual(productMetaFields(book, { ...on, groupField: 'brand', underGroupHeading: false }).map((f) => f.kind), ['category', 'brand'], 'the promoted block sits under "Promotions": both')
assert.deepEqual(productMetaFields(book, { ...on, groupField: null, underGroupHeading: true }).map((f) => f.kind), ['category', 'brand'], 'no group heading (View: all, or a search ranked by relevance): both')
assert.deepEqual(productMetaFields(book, { showCategory: true, showBrand: false, groupField: null, underGroupHeading: false }).map((f) => f.kind), ['category'], 'a merchant who hides the brand')
assert.deepEqual(productMetaFields({ category: '  ', brand: null }, { ...on, groupField: null, underGroupHeading: false }), [], 'nothing to say, no line')
assert.match(products, /underGroupHeading: index >= promotedRun/, 'the card asks per index whether it is past the promoted run')

// 8. Announcement strip: solid border, solid hover.
const announcement = read('PortalAnnouncementStrip.tsx')
assert.match(announcement, /border-b border-amber-700 bg-slate-900/)

console.log('PASS products surfaces are solid, the field line clears 3:1, the helper line is gone')
