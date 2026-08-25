import assert from 'node:assert/strict'
import {
  buildBranchNameByIdMap,
  buildNameLookupMap,
  buildProductBranchSummaryLabel,
  buildProductBrandOptions,
  buildProductRowDisplayState,
  getProductStockStatus,
} from '../src/components/products/helpers/productDisplayHelpers.ts'

assert.deepEqual(
  buildNameLookupMap([{ name: 'Skin Care', id: 1 }, { name: 'Makeup', id: 2 }]),
  {
    'Skin Care': { name: 'Skin Care', id: 1 },
    Makeup: { name: 'Makeup', id: 2 },
  },
  'name lookup preserves existing map shape',
)

assert.deepEqual(
  [...buildBranchNameByIdMap([{ id: 2, name: 'Main' }, { id: '3', name: 'Mall' }]).entries()],
  [['2', 'Main'], ['3', 'Mall']],
  'branch map uses string ids',
)

assert.deepEqual(
  buildProductBrandOptions(['  Cera  ', '', 'Acme'], '["Zeta","Acme","  Beta  "]'),
  ['Acme', 'Beta', 'Cera', 'Zeta'],
  'brand options merge product metadata and settings with trimming and dedupe',
)

assert.deepEqual(
  buildProductBrandOptions(['A'], '{bad json'),
  ['A'],
  'brand option parsing ignores malformed settings json',
)

assert.equal(
  buildProductBranchSummaryLabel({
    branch_stock: [
      { branch_id: 1, quantity: 0 },
      { branch_id: 2, quantity: 3 },
      { branch_id: 3, branch_name: 'Mall', quantity: 7 },
      { branch_id: 4, quantity: 2 },
    ],
  }, new Map([['2', 'Main'], ['4', 'Outlet']])),
  'Mall: 7, Main: 3 +1',
  'branch summary sorts positive stock and adds overflow count',
)

assert.equal(
  buildProductBranchSummaryLabel({ branch_stock: [] }),
  '0',
  'branch summary with no tracked branch rows at all falls back to a bare 0 (missing data, not zero stock)',
)

// Branch-aware zero-stock display (explicit ask, this session): a product
// with no stock anywhere must name every branch, not collapse to a bare
// "0" that hides which branches were even checked. This REPLACES a prior
// test that asserted the opposite (bare "0" for an all-zero product) --
// that was the exact behavior this request asked to reverse.
assert.equal(
  buildProductBranchSummaryLabel({
    branch_stock: [
      { branch_id: 1, quantity: 0 },
      { branch_id: 2, quantity: 0 },
    ],
  }, new Map([['1', 'Warehouse'], ['2', 'Shop']])),
  'Warehouse: 0, Shop: 0',
  'an all-zero product names every branch instead of collapsing to a bare 0',
)

assert.equal(
  buildProductBranchSummaryLabel({ branch_stock: [{ branch_id: 1, quantity: 0 }] }),
  '1: 0',
  'a single all-zero branch with no name lookup falls back to its branch id',
)

const product = { stock_quantity: 8, low_stock_threshold: 10, out_of_stock_threshold: 0 }
assert.equal(getProductStockStatus(product), 'low_stock')
assert.equal(getProductStockStatus({ ...product, stock_quantity: 0 }), 'out_of_stock')
assert.equal(getProductStockStatus({ ...product, stock_quantity: 11 }), 'in_stock')
assert.equal(
  getProductStockStatus(product, { branchFilter: 12, getBranchQty: () => 0 }),
  'out_of_stock',
  'branch filtered stock status uses branch quantity callback',
)

const rowState = buildProductRowDisplayState({
  id: 1,
  brand: 'Acme',
  category: 'Skin',
  stock_quantity: 8,
  selling_price_usd: 20,
  cost_price_usd: 12,
  cost_price_khr: 48000,
  discount_enabled: true,
  discount_type: 'percent',
  discount_percent: 25,
  low_stock_threshold: 10,
  out_of_stock_threshold: 0,
}, {
  branchFilter: 'all',
  branchNameById: new Map([['2', 'Mall']]),
  catMap: { Skin: { color: '#123456' } },
  exchangeRate: 4000,
  getBranchSummaryLabel: () => 'Mall: 8',
  getBrandColor: () => '#abcdef',
  t: (key) => ({ low_stock_short: 'Low' }[key] || key),
})

assert.equal(rowState.costUsd, 12)
assert.equal(rowState.costKhr, 48000)
assert.equal(rowState.marginUsd, 8)
assert.equal(rowState.marginPct, 40)
assert.equal(rowState.qty, 8)
assert.equal(rowState.stockStatus, 'low_stock')
assert.equal(rowState.mobileStatusLabel, 'Low')
assert.equal(rowState.mobileStatusClass, 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300')
assert.equal(rowState.branchSummaryLabel, 'Mall: 8')
assert.deepEqual(rowState.compactMeta, [
  { key: 'brand', label: 'Acme', color: '#abcdef' },
  { key: 'category', label: 'Skin', color: '#123456' },
])

// Barcode joins brand/category on the desktop row's name-cell tag line
// (Products.tsx's renderDesktopProductRow) rather than staying only in the
// separate Details-column pill list -- and it comes FIRST. It is the field
// people scan for when identifying a row; brand and category are broad
// groupings they have usually already filtered by, so leading with those
// buried the one value unique to the product. Order is asserted, not just
// membership, because the order IS the requirement here.
const rowStateWithBarcode = buildProductRowDisplayState({
  id: 2,
  brand: 'Acme',
  category: 'Skin',
  barcode: '0123456789012',
  stock_quantity: 8,
}, {
  catMap: { Skin: { color: '#123456' } },
  getBrandColor: () => '#abcdef',
})
assert.deepEqual(rowStateWithBarcode.compactMeta, [
  { key: 'barcode', label: '0123456789012', className: 'bg-sky-50 font-mono text-sky-700 dark:bg-sky-900/30 dark:text-sky-200' },
  { key: 'brand', label: 'Acme', color: '#abcdef' },
  { key: 'category', label: 'Skin', color: '#123456' },
])
assert.equal(rowStateWithBarcode.compactMeta[0].key, 'barcode', 'barcode must lead the meta line')

// A product with no barcode still renders brand/category cleanly -- the
// filter(Boolean) must not leave a hole where the barcode would have been.
const rowStateNoBarcode = buildProductRowDisplayState({
  id: 3,
  brand: 'Acme',
  category: 'Skin',
  stock_quantity: 8,
}, {
  catMap: { Skin: { color: '#123456' } },
  getBrandColor: () => '#abcdef',
})
assert.deepEqual(rowStateNoBarcode.compactMeta, [
  { key: 'brand', label: 'Acme', color: '#abcdef' },
  { key: 'category', label: 'Skin', color: '#123456' },
])
assert.equal(rowState.promotion.active, true)
assert.equal(rowState.promotion.applied_price_usd, 15)

console.log('productDisplayHelpers tests passed')
