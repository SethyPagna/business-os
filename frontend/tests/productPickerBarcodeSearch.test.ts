// Pins the fix for a live production bug reported 2026-09-03: in the Change
// stock flow's product picker (Products page -> Stock change -> Adjust, Khmer
// title "ជ្រើសរើសទំនិញដើម្បីកែស្តុក"), typing or scanning the barcode
// 3348901770569 did not narrow the list -- it kept listing unrelated products
// ("Abercrombie Authantic 10ml", 085715166012).
//
// Root cause was NOT the matcher: StockAdjustModal called
// searchProducts({ search: ... }), and /api/products/search reads its
// free-text term from `query` (`q` as a legacy alias) and silently ignores
// anything else -- answering 200 with the ENTIRE catalog rather than
// erroring. Verified live against a production snapshot on a private local
// D1: ?search=3348901770569 -> total 10212 in plain catalog order (Abercrombie
// first, exactly the reported screenshot); ?query=3348901770569 -> total 3.
//
// Two halves are pinned here:
//   1. the barcode identity rule itself (behavioral), including the GTIN-14
//      leading-zero twin this catalog carries ~3000 of;
//   2. the source shape (mechanical): every product-picker surface reaches
//      the catalog endpoint through the ONE transport that canonicalizes the
//      term key, and none of them spells it with a synonym again.
//
// Run: node tests/productPickerBarcodeSearch.test.ts

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  MIN_REAL_BARCODE_LENGTH,
  barcodeKeysMatch,
  matchesSearchTermGroups,
  normalizeBarcodeKey,
  searchTermBarcodeKey,
  sortExactBarcodeFirst,
} from '../src/utils/searchMatch.ts'

// --- 1. the barcode identity rule ---------------------------------------

const SCANNED = '3348901770569'          // what the scanner emits (EAN-13)
const TWIN = '03348901770569'            // the same product stored as GTIN-14
const OTHER = '085715166012'             // Abercrombie Authantic 10ml, the row
                                         // the broken picker showed instead

assert.equal(normalizeBarcodeKey(SCANNED), SCANNED, 'a bare EAN-13 is its own key')
assert.equal(
  normalizeBarcodeKey(TWIN),
  SCANNED,
  'a GTIN-14 stored with a leading zero must fold onto the bare EAN-13',
)
assert.ok(barcodeKeysMatch(SCANNED, TWIN), 'the scanned code and its zero-padded twin are one barcode')
assert.ok(barcodeKeysMatch(TWIN, SCANNED), 'the fold is symmetric')
assert.ok(!barcodeKeysMatch(SCANNED, OTHER), 'an unrelated barcode must not match')

// Separators a person may type or a label may print.
assert.ok(barcodeKeysMatch('3348901770569', '3348-9017-70569'), 'hyphens are ignored')
assert.ok(barcodeKeysMatch('3348901770569', ' 03348901770569 '), 'surrounding space is ignored')

// Placeholders are NOT identities: 238 production rows share the literal
// barcode "0". Collapsing those onto each other would be worse than missing.
assert.equal(normalizeBarcodeKey('0'), '', 'the "0" placeholder is not a real barcode')
assert.equal(normalizeBarcodeKey('0000'), '', 'an all-zero code is not a real barcode')
assert.equal(normalizeBarcodeKey('012'), '', `codes under ${MIN_REAL_BARCODE_LENGTH} chars are not real barcodes`)
assert.equal(normalizeBarcodeKey(''), '', 'blank is not a barcode')
assert.equal(normalizeBarcodeKey(null), '', 'null is not a barcode')
assert.ok(!barcodeKeysMatch('0', '0'), 'two placeholders are not "the same product"')

// A search box holds a barcode only when the whole text is one code -- a
// multi-word query stays an ordinary name/code search.
assert.equal(searchTermBarcodeKey(SCANNED), SCANNED)
assert.equal(searchTermBarcodeKey(`  ${TWIN}  `), SCANNED)
assert.equal(searchTermBarcodeKey('dior 3348901770569'), '', 'a two-word query is not a barcode lookup')
assert.equal(searchTermBarcodeKey('3348901770569, 085715166012'), '', 'a comma group is not a barcode lookup')

// --- 2. the client-side haystack still finds both twins -----------------
// Every picker that re-filters an already-fetched page client-side does it
// through matchesSearchTermGroups over [name, sku, barcode]. That pass must
// not throw away a row the server matched.

const scannedProduct = { name: 'Dior Backstage Highlighter New 002', sku: null, barcode: SCANNED }
const twinProduct = { name: 'Dior Backstage Highlighter New 002', sku: null, barcode: TWIN }
const unrelated = { name: 'Abercrombie Authantic 10ml', sku: null, barcode: OTHER }

const hay = (p: { name: string; sku: string | null; barcode: string }) => [p.name, p.sku, p.barcode]
assert.ok(matchesSearchTermGroups(hay(scannedProduct), [SCANNED], 'AND'), 'exact barcode row matches')
assert.ok(matchesSearchTermGroups(hay(twinProduct), [SCANNED], 'AND'), 'zero-padded twin matches the scanned code')
assert.ok(
  !matchesSearchTermGroups(hay(unrelated), [SCANNED], 'AND'),
  'an unrelated product must NOT match the scanned barcode -- this is the reported bug',
)

// --- 3. exact barcode hits lead -----------------------------------------
// Ordering only. No picker auto-selects or auto-adds on an exact hit: a scan
// fills the search box, the list narrows, the operator chooses the row.

// "Exact" means barcode IDENTITY, folding included -- the GTIN-14 twin is
// the same barcode, so both twins lead and only rows that merely contain the
// digits are demoted. Same definition as the server's rank expression
// (buildExactBarcodeRankSql), which likewise scores both twins 0; keeping
// the two definitions identical is the whole point of the shared helper.
const ranked = sortExactBarcodeFirst([twinProduct, unrelated, scannedProduct], SCANNED)
assert.deepEqual(
  ranked.map((r) => r.barcode),
  [TWIN, SCANNED, OTHER],
  'both barcode-identity rows lead, in the server order they arrived in; the substring row is demoted',
)
assert.deepEqual(
  sortExactBarcodeFirst([twinProduct, unrelated], 'dior').map((r) => r.barcode),
  [TWIN, OTHER],
  'a non-barcode query leaves the server ordering untouched',
)

// --- 4. source shape: one canonical term key for every picker ------------

const transport = readFileSync(new URL('../src/api/productReadTransport.ts', import.meta.url), 'utf8')
assert.match(
  transport,
  /const SEARCH_TERM_ALIASES = \[[^\]]*'query'[^\]]*'q'[^\]]*'search'/,
  'the transport must canonicalize every free-text alias onto the endpoint\'s `query` key',
)
assert.match(
  transport,
  /export function searchProducts[\s\S]{0,200}canonicalizeSearchTerm\(params\)/,
  'searchProducts must canonicalize the term before building the query string',
)
assert.match(
  transport,
  /export function getProductBootstrap[\s\S]{0,300}canonicalizeSearchTerm\(params\)/,
  '/bootstrap runs the same server-side term parsing and needs the same canonicalization',
)

// Every product-picker surface, listed explicitly so a new one cannot be
// added without appearing here. Each must reach the catalog through
// searchProducts()/getProductBootstrap() (the canonicalizing transport) or,
// for TransferModal, through the branch-stock endpoint with `query=`.
const PICKER_SURFACES: Array<[string, string]> = [
  ['StockAdjustModal (Change stock)', '../src/components/products/forms/StockAdjustModal.tsx'],
  ['FastStockInModal (receive)', '../src/components/inventory/FastStockInModal.tsx'],
  ['Promotions rule picker', '../src/components/promotions/PromotionsPage.tsx'],
  ['NewReturnModal replacement lookup', '../src/components/returns/NewReturnModal.tsx'],
  ['Products page', '../src/components/products/Products.tsx'],
  ['Products image-only view', '../src/components/products/ProductsImageOnlyView.tsx'],
]

for (const [label, relPath] of PICKER_SURFACES) {
  const source = readFileSync(new URL(relPath, import.meta.url), 'utf8')
  assert.ok(
    /searchProducts\s*\(/.test(source) || /searchProducts\s*:/.test(source),
    `${label} should reach the catalog through the shared searchProducts transport`,
  )
  // The exact regression: a picker spelling the term with a key the server
  // does not read gets the whole unfiltered catalog back with a 200.
  assert.ok(
    !/searchProducts\(\{\s*search:/.test(source),
    `${label} must not send the free-text term as \`search:\` -- the endpoint reads \`query\``,
  )
}

const transferModal = readFileSync(new URL('../src/components/branches/TransferModal.tsx', import.meta.url), 'utf8')
assert.match(
  transferModal,
  /\{ query: debouncedSearch\.trim\(\) \}/,
  'TransferModal must send its picker term to the branch-stock endpoint as `query`',
)
assert.match(
  transferModal,
  /fuzzyTextMatches\(\[product\.name, product\.sku, product\.barcode\]/,
  'TransferModal\'s client re-filter must keep barcode in the haystack',
)

const posPage = readFileSync(new URL('../src/components/pos/POS.tsx', import.meta.url), 'utf8')
assert.match(
  posPage,
  /const hay = \[p\.name, p\.sku, p\.barcode/,
  'POS\'s client re-filter must keep barcode in the haystack',
)

const productFilterHelpers = readFileSync(
  new URL('../src/components/products/helpers/productFilterHelpers.ts', import.meta.url),
  'utf8',
)
assert.match(
  productFilterHelpers,
  /product\?\.name, product\?\.sku, product\?\.barcode/,
  'the Products page client re-filter must keep barcode in the haystack',
)

// A scan must never pick a product on its own -- it fills the search box and
// the person chooses (standing project rule).
const stockAdjustModal = readFileSync(
  new URL('../src/components/products/forms/StockAdjustModal.tsx', import.meta.url),
  'utf8',
)
assert.match(
  stockAdjustModal,
  /const handleProductScan[\s\S]{0,400}setSearch\(barcode\)/,
  'a scan in the Change-stock picker must only fill the search box',
)
assert.ok(
  !/setSelectedProduct\([^)]*results\[0\]/.test(stockAdjustModal),
  'the Change-stock picker must never auto-select the first/only result',
)

// --- 5. a by-id lookup never resolves by position ------------------------
// Second live bug, reported 2026-09-03 on an iPhone against production code:
// opening Adjust Stock on "Dior Backstage Highlighter New 002" (id 7231)
// loaded and would have written against "Abercrombie Authantic 10ml" (id 1).
// /api/products/search never read the `ids` parameter this transport has
// always sent, so a by-id lookup answered with page 1 of the whole catalog in
// name order and every consumer that took items[0] bound itself to the
// catalog's first row. The endpoint now filters; these locks keep the client
// half honest, because StockAdjustModal builds its per-branch stock map -- and
// therefore its remove-availability guard -- out of the FETCHED row.

assert.match(
  transport,
  /ids: uniqueIds\.join\(','\)/,
  'the by-id lookup must send the ids it wants',
)
assert.match(
  transport,
  /restrictPayloadToIds\(payload, uniqueIds\)/,
  'and must drop any row it did not ask for, so a stale or older response cannot substitute a product',
)
assert.match(
  transport,
  /products:byIds:v2:/,
  'the by-id cache key is versioned past the entries written while the endpoint ignored `ids`',
)

const BY_ID_CONSUMERS: Array<[string, string, RegExp]> = [
  [
    'StockAdjustModal refresh of the picked product',
    '../src/components/products/forms/StockAdjustModal.tsx',
    /\.find\(\(row\) => Number\(row\?\.id\) === Number\(id\)\)/,
  ],
  [
    'Products fetchProductsByIds (post-save, undo/redo, created-row confirm)',
    '../src/components/products/Products.tsx',
    /wanted\.has\(Number\(\(row as \{ id\?: unknown \}\)\?\.id\)\)/,
  ],
  [
    'Inventory movement product detail',
    '../src/components/inventory/Inventory.tsx',
    /\.find\(\(row: \{ id\?: unknown \}\) => Number\(row\?\.id\) === productId\)/,
  ],
]

for (const [label, relPath, shape] of BY_ID_CONSUMERS) {
  const source = readFileSync(new URL(relPath, import.meta.url), 'utf8')
  assert.match(source, shape, `${label} must resolve the fetched row by id, not by position`)
}

const stockAdjustSource = readFileSync(
  new URL('../src/components/products/forms/StockAdjustModal.tsx', import.meta.url),
  'utf8',
)
assert.ok(
  !/selectProduct\(\(rows\[0\]/.test(stockAdjustSource),
  'the Change-stock refresh must never call selectProduct with items[0]',
)
// The guard this protects: the availability check reads the SELECTED row's
// per-branch stock, so binding the form to the wrong row silently validated a
// removal against a different product's quantity.
assert.match(
  stockAdjustSource,
  /branchStockById/,
  'the availability guard still derives from the selected product\'s branch stock',
)

const lookupSnapshots = readFileSync(
  new URL('../src/components/products/lookups/productLookupSnapshots.ts', import.meta.url),
  'utf8',
)
assert.match(
  lookupSnapshots,
  /const latest = latestMap\.get\(productId\)/,
  'the lookup rename-undo must stay keyed on the snapshot id (fail-closed: it restored nothing, never the wrong product)',
)

console.log('PASS productPickerBarcodeSearch')
