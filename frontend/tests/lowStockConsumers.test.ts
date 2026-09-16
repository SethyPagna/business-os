// Consumer parity: every client surface that COLOURS, COUNTS or FILTERS by
// "low stock" reads the owner's setting.
//
// The rule module (tests/lowStockSettings.test.ts) proves the rule. This file
// proves the rule is the only one in the building. Before this lane each file
// below carried its own copy of the literal 10 -- `|| 10`, `?? 10`,
// `toNumber(..., 10)` -- and two of them had already drifted to a fallback of
// 0, so the same product was amber on the Products list and green in the
// modal opened from that very row. A setting threaded into some of them would
// be worse than none: the badge and the pill beside it would disagree.
//
// The behavioural half runs against the real helpers at the bottom; the
// source-shape half is what catches a NEW surface (or a revert) re-typing the
// literal, which no behavioural test can see.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_LOW_STOCK_CONFIG,
  effectiveLowStockThreshold,
  type LowStockConfig,
} from '../src/utils/lowStockSettings.ts'
import { getProductStockStatus } from '../src/components/products/helpers/productDisplayHelpers.ts'
import { filterProductsForPage } from '../src/components/products/helpers/productFilterHelpers.ts'

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')
const read = (relPath: string): string => fs.readFileSync(path.join(SRC, relPath), 'utf8')

// Every client file that decides a low-stock colour, count or filter, with the
// surface it draws. The list is a floor, not a ceiling -- adding a surface
// means adding a row here.
const LOW_STOCK_CONSUMERS: Array<[string, string]> = [
  ['components/products/helpers/productDisplayHelpers.ts', 'Products row badge + tone'],
  ['components/products/helpers/productFilterHelpers.ts', 'Products same-page stock filter'],
  ['components/products/Products.tsx', 'Products list (passes the config into both helpers)'],
  ['components/products/ProductsImageOnlyView.tsx', 'Products image grid + its details flyout'],
  ['components/products/surfaces/ProductDetailModal.tsx', 'Products detail modal'],
  ['components/inventory/ProductDetailModal.tsx', 'Inventory detail modal'],
  ['components/branches/Branches.tsx', 'Branches per-branch product cards'],
  ['components/pos/POS.tsx', 'POS grid tone + stock pills'],
  ['components/pos/ProductDetailSheet.tsx', 'POS product sheet + its variant rows'],
  ['components/dashboard/Dashboard.tsx', 'Dashboard low-stock drill panel'],
  ['components/dashboard/dashboardExport.ts', 'Dashboard low-stock export'],
]

for (const [relPath, surface] of LOW_STOCK_CONSUMERS) {
  const text = read(relPath)
  assert.ok(
    /from '(\.\.\/)+utils\/lowStockSettings\.ts'/.test(text) || /useLowStockConfig/.test(text),
    `${relPath} (${surface}) must read the shared low-stock rule`,
  )
  // The literal it replaced, in each of the three shapes it was written in.
  for (const pattern of [
    /low_stock_threshold\s*\|\|\s*10/,
    /low_stock_threshold\s*\?\?\s*10/,
    /low_stock_threshold,\s*10\)/,
  ]) {
    assert.ok(!pattern.test(text), `${relPath} (${surface}) still hardcodes the old fallback of 10`)
  }
  // ...and the two that had drifted to 0, which put the same product in two
  // different colours depending on which surface you looked at it from.
  assert.ok(
    !/low_stock_threshold\s*(\|\||\?\?)\s*0\b/.test(text),
    `${relPath} (${surface}) falls back to 0, which disagrees with every other surface`,
  )
}

// Positive control: the sweep above is capable of failing. The STOREFRONT
// keeps its own documented customer_portal_* threshold triple (the hint in
// en.json says it applies on the customer portal only), so it still carries
// exactly the shape the sweep rejects -- which both proves the instrument
// works and pins the storefront's independence as a decision.
const portal = read('components/catalog/portalCatalogDisplay.ts')
assert.ok(/low_stock_threshold.*\|\|\s*10/.test(portal), 'the storefront is expected to keep its own rule')
assert.ok(!/useLowStockConfig/.test(portal))

// -- behaviour, through the real helpers ------------------------------------
// One fixture, three answers. `stored` carries the schema default 10, which is
// what nearly every real row holds, so "the global only fills in for NULL"
// would be inert on it -- the case that decided the two-mode design.
const productMode: LowStockConfig = { enabled: true, mode: 'product', threshold: 3 }
const globalMode: LowStockConfig = { enabled: true, mode: 'global', threshold: 3 }
const alertsOff: LowStockConfig = { enabled: false, mode: 'product', threshold: 10 }

const stored = { id: 1, stock_quantity: 5, low_stock_threshold: 10, out_of_stock_threshold: 0 }
const noLimit = { id: 2, stock_quantity: 5, low_stock_threshold: null, out_of_stock_threshold: 0 }
const empty = { id: 3, stock_quantity: 0, low_stock_threshold: 10, out_of_stock_threshold: 0 }

assert.equal(getProductStockStatus(stored), 'low_stock')
assert.equal(getProductStockStatus(stored, { lowStock: DEFAULT_LOW_STOCK_CONFIG }), 'low_stock')
assert.equal(getProductStockStatus(stored, { lowStock: productMode }), 'low_stock')
assert.equal(getProductStockStatus(stored, { lowStock: globalMode }), 'in_stock')
assert.equal(getProductStockStatus(stored, { lowStock: alertsOff }), 'in_stock')
// A row with no limit of its own follows the global in BOTH modes.
assert.equal(getProductStockStatus(noLimit, { lowStock: productMode }), 'in_stock')
assert.equal(getProductStockStatus(noLimit, { lowStock: DEFAULT_LOW_STOCK_CONFIG }), 'low_stock')
// Alerts off never touches the out-of-stock tier.
assert.equal(getProductStockStatus(empty, { lowStock: alertsOff }), 'out_of_stock')

// The list filter under those same badges has to agree with them, pill by
// pill -- this is the pairing that used to be two independent literals.
const catalog = [stored, noLimit, empty]
const ids = (rows: Array<Record<string, unknown>>): unknown[] => rows.map((row) => row.id)
assert.deepEqual(ids(filterProductsForPage(catalog, { stockFilter: 'low' })), [1, 2])
assert.deepEqual(ids(filterProductsForPage(catalog, { stockFilter: 'low', lowStock: productMode })), [1])
assert.deepEqual(ids(filterProductsForPage(catalog, { stockFilter: 'low', lowStock: globalMode })), [])
assert.deepEqual(ids(filterProductsForPage(catalog, { stockFilter: 'low', lowStock: alertsOff })), [])
// 'healthy' is the complement, and must not swallow the out-of-stock row when
// the alert is off (the low threshold is -1 then, and 0 is above -1). Same
// defect, same fix, as routes/products.ts's healthy clause.
assert.deepEqual(ids(filterProductsForPage(catalog, { stockFilter: 'healthy' })), [])
assert.deepEqual(ids(filterProductsForPage(catalog, { stockFilter: 'healthy', lowStock: globalMode })), [1, 2])
assert.deepEqual(ids(filterProductsForPage(catalog, { stockFilter: 'healthy', lowStock: alertsOff })), [1, 2])
assert.deepEqual(ids(filterProductsForPage(catalog, { stockFilter: 'out', lowStock: alertsOff })), [3])

// Every badge above is decided by this one number, so it is worth stating
// plainly what each mode resolves the fixture to.
assert.equal(effectiveLowStockThreshold(DEFAULT_LOW_STOCK_CONFIG, 10), 10)
assert.equal(effectiveLowStockThreshold(productMode, 10), 10)
assert.equal(effectiveLowStockThreshold(globalMode, 10), 3)
assert.equal(effectiveLowStockThreshold(alertsOff, 10), -1)

console.log('lowStockConsumers.test.ts OK')
