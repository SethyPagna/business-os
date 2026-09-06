import assert from 'node:assert/strict'
import {
  UNIFIED_STOCK_HEADERS,
  buildUnifiedStockTemplateCsv,
  findUnifiedStockCostBatchConflicts,
  mapUnifiedStockHeaders,
  normalizeUnifiedStockDate,
  parseUnifiedStockRows,
} from '../src/components/products/import/unifiedStockImport.ts'

// The one §12 file contract shared by Direct and Reconcile. These checks
// lived in addSaleImportMapping.test.ts while the legacy Add/Sale mapping
// still existed beside them; Part 380 removed that whole zombie module
// family (nothing outside its own tests imported it since Part 361 replaced
// the client-side flow), so the surviving contract gets its own file.
// 'supplier' (11th, OPTIONAL — migration 0062) attributes the batch a row's
// stock was bought from; ten-column files must keep importing unchanged.
assert.deepEqual(UNIFIED_STOCK_HEADERS, [
  'name', 'barcode', 'shop', 'warehouse', 'date', 'action',
  'selling_price', 'wholesale_price', 'cost_price', 'batch', 'supplier',
])
assert.equal(buildUnifiedStockTemplateCsv(), `﻿${UNIFIED_STOCK_HEADERS.join(',')}\r\n`)
assert.deepEqual(mapUnifiedStockHeaders(['Product Name', 'UPC', 'Shop Qty', 'Warehouse', 'Sale Date', 'Movement', 'Price USD', 'Special Price', 'Unit Cost', 'Lot Code', 'Vendor Name']), {
  name: 'Product Name', barcode: 'UPC', shop: 'Shop Qty', warehouse: 'Warehouse', date: 'Sale Date', action: 'Movement',
  selling_price: 'Price USD', wholesale_price: 'Special Price', cost_price: 'Unit Cost', batch: 'Lot Code', supplier: 'Vendor Name',
})
// A ten-column file (no supplier header) still maps cleanly — supplier just
// resolves to nothing.
assert.equal(mapUnifiedStockHeaders(['name', 'barcode', 'shop', 'warehouse', 'date', 'action', 'selling_price', 'wholesale_price', 'cost_price', 'batch']).supplier, null)
assert.equal(normalizeUnifiedStockDate('08/27/2026'), '2026-08-27')
assert.equal(normalizeUnifiedStockDate('2026-02-29'), null)

const unified = parseUnifiedStockRows([
  { name: 'A', barcode: '1', shop: '2', warehouse: '0', date: '08/27/2026', action: 'add', selling_price: '$12.50', wholesale_price: '10', cost_price: '5', batch: 'B1' },
  { name: 'A', barcode: '1', shop: '0', warehouse: '1', date: '2026-08-27', action: 'sale1', selling_price: '12.5', wholesale_price: '10', cost_price: '6', batch: 'B2' },
])
assert.equal(unified.issues.length, 0)
assert.equal(unified.rows[0].shop, 2)
assert.equal(unified.rows[0].sellingPrice, 12.5)
assert.equal(unified.rows[1].date, '2026-08-27')
assert.deepEqual([...findUnifiedStockCostBatchConflicts(unified.rows).keys()], [2, 3])

// N15: the review screen must group sheet rows the way the SERVER will. The
// key used the raw barcode, so a file writing one code in its GTIN-14 and
// EAN-13 forms looked like two products here -- the cost/batch confirm gate
// never fired -- while the import that followed treated them as one product
// and received it at two costs across two lots unannounced.
const foldedTwins = parseUnifiedStockRows([
  { name: 'Rose Lip Oil', barcode: '03614274226546', shop: '2', date: '08/27/2026', action: 'add', cost_price: '4', batch: 'LOT-A' },
  { name: 'Rose Lip Oil', barcode: '3614274226546', shop: '2', date: '08/27/2026', action: 'add', cost_price: '9', batch: 'LOT-B' },
])
assert.equal(foldedTwins.issues.length, 0)
assert.deepEqual([...findUnifiedStockCostBatchConflicts(foldedTwins.rows).keys()], [2, 3],
  'two spellings of one barcode are one product, so two lots at two costs must raise the gate')
// The fold stops where the rule stops: stripping '0012' would leave under
// three characters, so these two stay two products and nothing is gated.
const shortCodes = parseUnifiedStockRows([
  { name: 'Short Code Balm', barcode: '0012', shop: '1', date: '08/27/2026', action: 'add', cost_price: '3', batch: 'LOT-A' },
  { name: 'Short Code Balm', barcode: '12', shop: '1', date: '08/27/2026', action: 'add', cost_price: '8', batch: 'LOT-B' },
])
assert.equal(findUnifiedStockCostBatchConflicts(shortCodes.rows).size, 0)
const invalidUnified = parseUnifiedStockRows([{ name: '', barcode: '', shop: '-1', warehouse: '', date: '31/12/2026', selling_price: 'nope' }])
assert.deepEqual(invalidUnified.issues.map((issue) => issue.code), ['missing_identity', 'invalid_quantity', 'invalid_date', 'invalid_price'])
assert.equal(invalidUnified.rows.length, 1, 'invalid rows stay visible for review instead of disappearing')
console.log('PASS unified §12 stock contract: headers, optional supplier, strict parsing, conflict gating')
