// The client half of the one product-search ranking.
//
// The report: "the search functions of transfer, stock change, returns
// etc... seems not fully scoped properly ... it shows products not really
// matched in top to bottom ... feels like the likely result was at bottom
// in reverse".
//
// Half of that was the server (four hand-copies of the search tail, one of
// which computed no relevance at all -- see
// cloudflare/scripts/test-search-relevance-order-pure.cjs, which asserts
// the exact order the shared implementation produces). The other half was
// here: several pickers took a correctly ranked response and re-sorted it
// alphabetically before rendering, which reproduces the identical symptom
// with a perfect backend. This file guards BOTH ends of that seam:
//
//   1. the shared client ranking (utils/searchMatch.ts) is EXECUTED and
//      asserted to mirror the server's tier contract -- exact barcode,
//      then exact name, then name prefix, then everything else, with a
//      stable order inside a tier so re-renders and paging never reshuffle;
//   2. every fully-client-side picker actually calls it;
//   3. every server-backed picker that groups its rows passes
//      preserveInputOrder while a term is in the box, so grouping cannot
//      re-sort the server's answer;
//   4. no picker re-introduces a bare alphabetical sort or a reversed
//      render over search results;
//   5. the backend routes still order through the shared builder.
//
// Run: node tests/searchRelevanceContract.test.ts

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  MATCH_TIER_EXACT_BARCODE,
  MATCH_TIER_EXACT_NAME,
  MATCH_TIER_NAME_PREFIX,
  MATCH_TIER_OTHER,
  searchRelevanceTier,
  sortBySearchRelevance,
  sortExactBarcodeFirst,
} from '../src/utils/searchMatch.ts'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

// --- 1. the ranking itself, executed ------------------------------------

const SCANNED = '3348901770569'
const TWIN = `0${SCANNED}`

check('the client tiers mirror the server contract, in the same order', () => {
  assert.deepEqual(
    [MATCH_TIER_EXACT_BARCODE, MATCH_TIER_EXACT_NAME, MATCH_TIER_NAME_PREFIX, MATCH_TIER_OTHER],
    [0, 1, 2, 3],
    'the tier numbers are shared with cloudflare/src/lib/productSearchQuery.ts and must not drift',
  )
  const row = { name: 'Matte Lipstick', barcode: SCANNED }
  assert.equal(searchRelevanceTier(row, SCANNED), MATCH_TIER_EXACT_BARCODE)
  assert.equal(searchRelevanceTier(row, 'matte lipstick'), MATCH_TIER_EXACT_NAME)
  assert.equal(searchRelevanceTier(row, 'matte'), MATCH_TIER_NAME_PREFIX)
  assert.equal(searchRelevanceTier(row, 'lipstick'), MATCH_TIER_OTHER)
})

check('a scanned barcode leads, including its GTIN-14 leading-zero twin', () => {
  const rows = [
    { id: 1, name: 'Aaa Contains The Digits Somewhere', barcode: `99${SCANNED}` },
    { id: 2, name: 'Zzz Scanned Product', barcode: SCANNED },
    { id: 3, name: 'Zzz Scanned Product Twin', barcode: TWIN },
  ]
  assert.deepEqual(sortBySearchRelevance(rows, SCANNED).map((r) => r.id), [2, 3, 1],
    'the rows whose barcode IS the scanned code must lead the row that merely contains the digits')
  assert.deepEqual(sortBySearchRelevance(rows, TWIN).map((r) => r.id), [2, 3, 1],
    'scanning either form of the twin must give the same answer')
})

check('exact name beats prefix beats the rest, and A-Z alone would be wrong', () => {
  const rows = [
    { id: 1, name: 'Aaa Matte Cleanup Wipes', barcode: '111' },
    { id: 2, name: 'Matte Lipstick Refill Pack', barcode: '222' },
    { id: 3, name: 'Matte Lipstick', barcode: '333' },
  ]
  assert.deepEqual(sortBySearchRelevance(rows, 'matte lipstick').map((r) => r.id), [3, 2, 1])
  assert.deepEqual(sortBySearchRelevance(rows, 'matte').map((r) => r.id), [2, 3, 1],
    'both prefix rows outrank the mid-word decoy that sorts first alphabetically')
  // Non-vacuous: plain A-Z answers the decoy, which is the pre-fix behaviour.
  const azFirst = [...rows].sort((a, b) => a.name.localeCompare(b.name))[0]
  assert.equal(azFirst.id, 1, 'fixture is broken: A-Z would give the same answer, so this proves nothing')
})

check('order inside a tier is stable, so a re-render never reshuffles', () => {
  const rows = [
    { id: 10, name: 'Zeta Cream', barcode: '901' },
    { id: 11, name: 'Alpha Cream', barcode: '902' },
    { id: 12, name: 'Mid Cream', barcode: '903' },
  ]
  const once = sortBySearchRelevance(rows, 'cream').map((r) => r.id)
  assert.deepEqual(once, [10, 11, 12], 'equal-tier rows keep the order they arrived in (the server rank)')
  assert.deepEqual(sortBySearchRelevance(rows, 'cream').map((r) => r.id), once, 'and repeat it every time')
})

check('a query that ranks nothing leaves the caller order untouched', () => {
  const rows = [{ id: 1, name: 'B', barcode: '1' }, { id: 2, name: 'A', barcode: '2' }]
  assert.deepEqual(sortBySearchRelevance(rows, '   ').map((r) => r.id), [1, 2])
  assert.deepEqual(sortBySearchRelevance(rows, '').map((r) => r.id), [1, 2])
})

check('sortExactBarcodeFirst keeps its narrower contract on the shared implementation', () => {
  const rows = [{ name: 'Zzz', barcode: `99${SCANNED}` }, { name: 'Aaa', barcode: SCANNED }]
  assert.deepEqual(sortExactBarcodeFirst(rows, SCANNED).map((r) => r.name), ['Aaa', 'Zzz'])
  assert.deepEqual(sortExactBarcodeFirst(rows, 'zzz').map((r) => r.name), ['Zzz', 'Aaa'],
    'a non-barcode query must not reorder anything through this entry point')
  const searchMatchSource = read('../src/utils/searchMatch.ts')
  assert.match(
    searchMatchSource,
    /export function sortExactBarcodeFirst[\s\S]{0,400}?return sortBySearchRelevance\(/,
    'sortExactBarcodeFirst must delegate rather than become a second copy of the ordering',
  )
})

// --- 2. the fully client-side pickers call it ----------------------------

check('the fully client-side pickers rank their own results', () => {
  const transferModal = read('../src/components/branches/TransferModal.tsx')
  assert.match(transferModal, /sortBySearchRelevance\(/,
    'the bulk transfer picker filters an UNPAGED, unranked branch-stock read -- it must rank client-side')

  const supplierReturn = read('../src/components/returns/NewSupplierReturnModal.tsx')
  assert.match(supplierReturn, /sortBySearchRelevance\(/,
    'the supplier-return picker reads /api/inventory/summary, which takes no search term and answers name-A-Z')
  assert.match(supplierReturn, /normalizeBarcodeKey\(product\.barcode\)/,
    'a scan into the supplier-return box must be able to match a barcode at all')
  assert.match(supplierReturn, /\$\{product\.barcode \|\| ''\}/,
    'barcode must be in that picker haystack, not just in its exact-match probe')

  const catalogPage = read('../src/components/catalog/CatalogPage.tsx')
  assert.match(catalogPage, /sortBySearchRelevance\([\s\S]{0,400}?\)\s*\.slice\(0, 30\)/,
    'the recommended-products picker must RANK before it slices to 30, or the best match can be cut entirely')
})

// --- 3. grouping must not re-sort a ranked response ----------------------

check('every grouped picker preserves the server order while a term is active', () => {
  const grouping = read('../src/utils/productGrouping.ts')
  assert.match(grouping, /preserveInputOrder/,
    'buildProductGroups must offer an order-preserving mode')
  assert.match(grouping, /export function buildProductCategorySections[\s\S]{0,600}?preserveInputOrder/,
    'the Products page sectioning must offer it too')

  const cases: Array<[string, string, RegExp]> = [
    ['POS grid', '../src/components/pos/POS.tsx', /preserveInputOrder: Boolean\(debouncedProductSearch\.trim\(\)\)/],
    ['Products page', '../src/components/products/Products.tsx', /preserveInputOrder: searchTerms\.length > 0/],
    ['Branches per-branch stock', '../src/components/branches/Branches.tsx', /preserveInputOrder: Boolean\(getBranchStockQuery\(branch\.id\)\)/],
    ['Transfer bulk picker', '../src/components/branches/TransferModal.tsx', /preserveInputOrder: Boolean\(debouncedSearch\.trim\(\)\)/],
    ['storefront search', '../src/components/catalog/PublicCatalogPage.tsx', /mergePortalCatalogProducts\(data\.items, Boolean\(/],
  ]
  for (const [label, file, pattern] of cases) {
    assert.match(read(file), pattern, `${label} must not re-sort a ranked search response`)
  }
})

check('no picker re-introduces a bare alphabetical sort over search results', () => {
  // buildVisibleProductCards and collapsePortalProductGroups are the two
  // shared entry points into the grouping sort; both must take the flag
  // through rather than hard-coding A-Z for their callers.
  assert.match(
    read('../src/components/pos/posCore.ts'),
    /buildVisibleProductCards\([\s\S]{0,400}?preserveInputOrder/,
    'buildVisibleProductCards must forward the flag to buildProductGroups',
  )
  assert.match(
    read('../src/components/catalog/portalProductGrouping.ts'),
    /collapsePortalProductGroups\(products: CatalogProduct\[\], preserveInputOrder/,
    'the storefront collapse must forward the flag too',
  )
  for (const file of [
    '../src/components/branches/TransferModal.tsx',
    '../src/components/returns/NewSupplierReturnModal.tsx',
    '../src/components/inventory/FastStockInModal.tsx',
    '../src/components/products/forms/StockAdjustModal.tsx',
    '../src/components/returns/NewReturnModal.tsx',
    '../src/components/promotions/PromotionsPage.tsx',
  ]) {
    const source = read(file)
    assert.ok(!/\.reverse\(\)/.test(source), `${file} must not render a reversed result list`)
  }
})

// --- 4. the server end of the seam --------------------------------------

check('the backend picker endpoints still order through the one shared builder', () => {
  const sharedModule = read('../../cloudflare/src/lib/productSearchQuery.ts')
  assert.match(sharedModule, /export function buildProductSearchQuery/)
  assert.match(sharedModule, /export function buildFamilyRelevanceOrderSql/)
  for (const route of ['products', 'inventory', 'branches']) {
    const source = read(`../../cloudflare/src/routes/${route}.ts`)
    assert.match(source, /buildProductSearchQuery\(/,
      `${route}.ts must build its search tail through the shared helper, not a fifth hand-copy`)
    assert.match(source, /buildFamilyRelevanceOrderSql\(/,
      `${route}.ts must order through the shared relevance builder`)
    assert.ok(
      !/buildFtsMatchExpression\(|buildTrigramMatchExpression\(/.test(source),
      `${route}.ts must not re-inline the FTS/trigram clauses the shared helper owns`,
    )
  }
})

check('the search-only barcode fold never leaks into the auto-merge identity rule', () => {
  // Mirror of the same assertion on the Worker side. Both packs normalize
  // barcodes, and only ONE of them may fold leading zeros: the search fold
  // finds the GTIN-14/EAN-13 twins, the identity fold decides what
  // auto-merges, and those twin pairs are reserved for the operator.
  const identityRule = read('../src/utils/productDetailRule.ts')
  const start = identityRule.indexOf('function normalizedBarcode')
  assert.ok(start >= 0, 'the client identity rule must still have a barcode normalizer to guard')
  const body = identityRule.slice(start, identityRule.indexOf('\n}', start) + 2)
  assert.ok(
    !/\^0\+|padStart|checkDigit|check_digit/i.test(body),
    `the identity normalizer must not learn the search fold. got:\n${body}`,
  )
})

console.log(`\n${passed} checks passed`)
