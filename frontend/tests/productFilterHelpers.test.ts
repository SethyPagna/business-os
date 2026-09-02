import assert from 'node:assert/strict'
import { buildProductExportRows } from '../src/components/products/helpers/productExport.ts'
import {
  buildProductSearchTerms,
  filterProductsForPage,
  getProductBranchQuantity,
  resolveClientSearchTerms,
} from '../src/components/products/helpers/productFilterHelpers.ts'
import { parseProductSearchStockToken } from '../src/utils/searchTerms.ts'

const products = [
  {
    id: 1,
    name: 'Rose Serum',
    sku: 'RS-1',
    barcode: '1001',
    category: 'Skin',
    brand: 'Glow',
    unit: 'Bottle',
    supplier: 'Supplier A',
    created_at: '2026-05-03T00:00:00Z',
    stock_quantity: 8,
    low_stock_threshold: 5,
    out_of_stock_threshold: 0,
    branch_stock: [{ branch_id: 2, branch_name: 'Main', quantity: 8 }],
    image_gallery: ['/uploads/products/rose.png', '/uploads/products/box.png'],
    selling_price_usd: 12,
    cost_price_usd: 7,
    is_active: true,
  },
  {
    id: 2,
    name: 'Matte Lipstick',
    category: 'Makeup',
    brand: 'Bold',
    supplier: 'Supplier B',
    created_at: '2026-04-10T00:00:00Z',
    stock_quantity: 0,
    low_stock_threshold: 5,
    out_of_stock_threshold: 0,
    branch_stock: [{ branch_id: 2, branch_name: 'Main', quantity: 0 }],
  },
  {
    id: 3,
    parent_id: 1,
    name: 'Rose Serum Travel',
    category: 'Skin',
    brand: 'Glow',
    supplier: 'Supplier A',
    created_at: '2026-05-11T00:00:00Z',
    stock_quantity: 2,
    low_stock_threshold: 5,
    out_of_stock_threshold: 0,
    branch_stock: [{ branch_id: 3, branch_name: 'Mall', quantity: 2 }],
  },
]

assert.deepEqual(buildProductSearchTerms(' rose,  serum ,, GLOW '), ['rose', 'serum', 'glow'])
assert.equal(getProductBranchQuantity(products[0], 2), 8)
assert.equal(getProductBranchQuantity(products[0], 99), 0)

assert.deepEqual(
  filterProductsForPage(products, {
    searchTerms: buildProductSearchTerms('rose,serum'),
    searchMode: 'AND',
    brandFilter: '  glow  ',
    catFilter: 'Skin',
    branchFilter: 'all',
    supplierFilter: 'all',
    groupFilter: 'all',
    parentProductIds: new Set([1]),
    stockFilter: 'all',
  }).map((product) => product.id),
  [1, 3],
  'filtering applies search, brand, and category filters',
)

assert.deepEqual(
  filterProductsForPage(products, {
    branchFilter: '2',
    stockFilter: 'out',
    parentProductIds: new Set([1]),
  }).map((product) => product.id),
  [2],
  'branch out-of-stock filtering keeps only branch rows at or below threshold',
)

// groupFilter/parentProductIds are accepted but must NOT exclude rows
// client-side — see filterProductsForPage's own comment in
// productFilterHelpers.ts. The server's /api/products/search groupState
// filter already scopes "grouped"/"standalone" across the whole catalog
// before a page ever reaches this function; a client-side recheck using
// only this page's parentProductIds can't see that broader relationship
// and would incorrectly drop rows (same root cause as the POS.tsx Groups
// filter incident this mirrors, and same fix). Both values are asserted
// as true no-ops here, including standalone id 2 (not in
// parentProductIds) staying on the page as-is.
assert.deepEqual(
  filterProductsForPage(products, {
    groupFilter: 'group',
    parentProductIds: new Set([1]),
  }).map((product) => product.id),
  [1, 2, 3],
  'group filter value is a client-side no-op; the server already scoped the group filter',
)

assert.deepEqual(
  filterProductsForPage(products, {
    groupFilter: 'variant',
    parentProductIds: new Set([1]),
  }).map((product) => product.id),
  [1, 2, 3],
  'legacy variant filter value is likewise a client-side no-op',
)

const [row] = buildProductExportRows([products[0]])
assert.equal(row.Name, 'Rose Serum')
assert.equal(row.Selling_Price_USD, '12.00')
assert.equal(row.Cost_Price_USD, '7.00')
assert.equal(row.Image_Filename_1, 'rose.png')
assert.equal(row.Image_Filenames, 'rose.png|box.png')
assert.equal(row.Branch, 'Main')
assert.equal(row.Is_Group, 'No')
assert.equal(row.Active, 'Yes')

// -- branch-scoped export: a product stocked at TWO branches must export
// Stock_Quantity as the SCOPED branch's own number, not the cross-branch
// aggregate, when the export is filtered to one branch -- otherwise
// exporting "current filtered results" while branch-filtered writes every
// OTHER branch's stock into the row too (see buildProductExportRows'
// branchId comment). Also covers the 0-quantity case (Part 215's
// every-other-branch seeding): a scoped branch with a real 0 row must
// still report 0 and its own name, not fall back to "whichever branch has
// stock" the unscoped path uses.
const multiBranchProduct = {
  ...products[0],
  stock_quantity: 13,
  branch_stock: [
    { branch_id: 2, branch_name: 'Main', quantity: 8 },
    { branch_id: 5, branch_name: 'Warehouse', quantity: 5 },
    { branch_id: 9, branch_name: 'Shop', quantity: 0 },
  ],
}
const [unscopedRow] = buildProductExportRows([multiBranchProduct])
assert.equal(unscopedRow.Stock_Quantity, 13, 'no branchId -> Stock_Quantity is the full cross-branch aggregate, unchanged from before')
assert.equal(unscopedRow.Branch, 'Main', 'no branchId -> Branch falls back to the first branch carrying any stock')

const [warehouseRow] = buildProductExportRows([multiBranchProduct], { branchId: 5 })
assert.equal(warehouseRow.Stock_Quantity, 5, 'branchId=5 -> Stock_Quantity is Warehouse\'s own 5, not the 13-unit aggregate')
assert.equal(warehouseRow.Branch, 'Warehouse', 'branchId=5 -> Branch names Warehouse specifically')

const [shopRow] = buildProductExportRows([multiBranchProduct], { branchId: 9 })
assert.equal(shopRow.Stock_Quantity, 0, 'branchId=9 -> Stock_Quantity is Shop\'s real (seeded) 0, not the 13-unit aggregate')
assert.equal(shopRow.Branch, 'Shop', 'branchId=9 -> Branch still names Shop even though its quantity is 0 (a real tracked row, not an absent one)')

const [allScopeRow] = buildProductExportRows([multiBranchProduct], { branchId: 'all' })
assert.equal(allScopeRow.Stock_Quantity, 13, "branchId='all' (the page's own filter sentinel) is treated the same as no branchId at all")

// parseProductSearchStockToken (progress.md backlog item #2: searchable
// filter for "stock is 0" and similar edge cases, on top of the existing
// comma-separated search syntax). Products.tsx strips the recognized token
// out before sending `query` to the server / building client searchTerms,
// and treats it as if the "Out of stock" filter pill had been picked.
{
  const noToken = parseProductSearchStockToken('rose serum, glow')
  assert.equal(noToken.hasZeroStockToken, false, 'ordinary search text has no stock token')
  assert.equal(noToken.cleanedQuery, 'rose serum, glow', 'ordinary search text is left untouched')

  const exact = parseProductSearchStockToken('stock:0')
  assert.equal(exact.hasZeroStockToken, true, '"stock:0" alone is recognized')
  assert.equal(exact.cleanedQuery, '', 'the lone token is fully stripped, leaving an empty query')

  const withOtherTerms = parseProductSearchStockToken('rose serum, stock=0, glow')
  assert.equal(withOtherTerms.hasZeroStockToken, true, 'token recognized alongside real search terms')
  assert.equal(withOtherTerms.cleanedQuery, 'rose serum, glow', 'only the token term is removed, other terms and their order survive')

  const synonyms = ['out of stock', 'zero stock', 'STOCK : 0', '  stock=0  ']
  for (const synonym of synonyms) {
    assert.equal(parseProductSearchStockToken(synonym).hasZeroStockToken, true, `"${synonym}" is recognized as a zero-stock token (case/spacing tolerant)`)
  }

  const notAToken = parseProductSearchStockToken('stock:05, in stock, stock 0 test')
  assert.equal(notAToken.hasZeroStockToken, false, 'near-miss phrases (extra digits, extra words) are NOT treated as the token -- this is a small explicit synonym list, not a fuzzy match')
  assert.equal(notAToken.cleanedQuery, 'stock:05, in stock, stock 0 test', 'query is untouched when no term matches exactly')
}

console.log('productFilterHelpers tests passed')

// --- P2-4 Part 1b: the alias-search root cause -----------------------------
// Reported as "alias-barcode search returns zero results". Verified at route
// level: GET /api/products/search?query=<alias> returns 200 with the aliased
// row. That row was then thrown away by this page's OWN re-filter, whose
// free-text haystack is name/sku/barcode/tag_label and can never see
// barcode_aliases. resolveClientSearchTerms is the fix: the free-text pass
// stands down once the server page for THIS exact query has landed.
{
  // The real QA seed row (product 5045, primary barcode 6901000009999, alias
  // 8011003845132) -- copied field-for-field from the seeded record so this
  // reproduction cannot drift into a shape that accidentally matches.
  const aliasRow = {
    id: 5045,
    name: 'QA Seed Alias Barcode Product',
    sku: 'QASEED-ALIAS',
    barcode: '6901000009999',
    category: 'Fragrance',
    brand: 'Aveeno',
    supplier: 'Supplier A',
    stock_quantity: 3,
    low_stock_threshold: 5,
    out_of_stock_threshold: 0,
    branch_stock: [{ branch_id: 2, branch_name: 'Main', quantity: 3 }],
  }
  const ALIAS = '8011003845132'
  const terms = buildProductSearchTerms(ALIAS)

  // The bug, reproduced against the real helper: re-applying the alias as a
  // free-text term to a server-searched page empties it.
  assert.deepEqual(
    filterProductsForPage([aliasRow], { searchTerms: terms }).map((p) => p.id),
    [],
    'precondition: the free-text haystack (name/sku/barcode/tag_label) genuinely cannot see an alias -- that is the gap, not a mistake in this helper',
  )

  // The fix: once the server has answered for this exact query, the free-text
  // terms are dropped and the server-matched row survives.
  assert.deepEqual(
    resolveClientSearchTerms(terms, ALIAS, ALIAS),
    [],
    'server page for THIS query has landed -> no client free-text re-filter',
  )
  assert.deepEqual(
    filterProductsForPage([aliasRow], { searchTerms: resolveClientSearchTerms(terms, ALIAS, ALIAS) }).map((p) => p.id),
    [5045],
    'the alias-matched row the server deliberately returned is no longer dropped',
  )

  // ...and the instant-feedback behaviour it exists for is intact: while the
  // page in hand was fetched for an OLDER query, the terms still apply.
  assert.deepEqual(
    resolveClientSearchTerms(terms, 'rose', ALIAS),
    [ALIAS],
    'stale page (fetched for a different query) -> re-filter exactly as before',
  )
  assert.deepEqual(
    resolveClientSearchTerms(terms, null, ALIAS),
    [ALIAS],
    'no server response has ever landed -> re-filter exactly as before',
  )
  assert.deepEqual(
    resolveClientSearchTerms(buildProductSearchTerms('rose'), '', 'rose'),
    ['rose'],
    'an empty served query is a real value, not "never fetched" -- the pass only stands down when served EQUALS current',
  )
  assert.deepEqual(
    resolveClientSearchTerms(buildProductSearchTerms(''), '', ''),
    [],
    'the cleared-search case: served and current agree (both empty), nothing to re-filter',
  )

  // Facet filters keep re-filtering unconditionally -- only the free-text pass
  // stands down. Same server page, a category the row is not in: still dropped.
  assert.deepEqual(
    filterProductsForPage([aliasRow], {
      searchTerms: resolveClientSearchTerms(terms, ALIAS, ALIAS),
      catFilter: 'Makeup',
    }).map((p) => p.id),
    [],
    'facet filters are unaffected by resolveClientSearchTerms -- they stay instant',
  )
}
