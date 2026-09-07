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
// stock was bought from; 'free_goods' (12th, OPTIONAL — N14-D) declares a
// $0.00 cost as free rather than an invented zero. Ten-column files must
// keep importing unchanged.
assert.deepEqual(UNIFIED_STOCK_HEADERS, [
  'name', 'barcode', 'shop', 'warehouse', 'date', 'action',
  'selling_price', 'wholesale_price', 'cost_price', 'batch', 'supplier', 'free_goods',
])
assert.equal(buildUnifiedStockTemplateCsv(), `﻿${UNIFIED_STOCK_HEADERS.join(',')}\r\n`)
assert.deepEqual(mapUnifiedStockHeaders(['Product Name', 'UPC', 'Shop Qty', 'Warehouse', 'Sale Date', 'Movement', 'Price USD', 'Special Price', 'Unit Cost', 'Lot Code', 'Vendor Name', 'Free']), {
  name: 'Product Name', barcode: 'UPC', shop: 'Shop Qty', warehouse: 'Warehouse', date: 'Sale Date', action: 'Movement',
  selling_price: 'Price USD', wholesale_price: 'Special Price', cost_price: 'Unit Cost', batch: 'Lot Code', supplier: 'Vendor Name', free_goods: 'Free',
})
// A ten-column file (no supplier or free_goods header) still maps cleanly —
// both just resolve to nothing.
const tenColumnMap = mapUnifiedStockHeaders(['name', 'barcode', 'shop', 'warehouse', 'date', 'action', 'selling_price', 'wholesale_price', 'cost_price', 'batch'])
assert.equal(tenColumnMap.supplier, null)
assert.equal(tenColumnMap.free_goods, null)
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
// ---- N14-D, the fourth wire: the receipt gate, mirrored ---------------------
// cloudflare/src/lib/stockActionCommit.ts refuses a stock-in that carries no
// unit cost, exactly as POST /adjust, POST /api/batches and the stock-in
// session do. This screen has to say so BEFORE the upload, or the operator
// meets the refusal only in the finished report.
const noCost = parseUnifiedStockRows([
  { name: 'A', barcode: '1', shop: '2', date: '08/27/2026', action: 'add', supplier: 'Bong Long' },
])
assert.deepEqual(noCost.issues.map((issue) => issue.code), ['receipt_gate'])
assert.equal(noCost.issues[0].gateCode, 'cost_required')
assert.equal(noCost.rows.length, 1, 'a gated row stays visible for review with its reason')

// $0.00 is the claim "these goods were free". Left undeclared, it is refused
// rather than recorded as a free receipt...
const zeroCost = parseUnifiedStockRows([
  { name: 'A', barcode: '1', warehouse: '3', date: '08/27/2026', action: 'add', cost_price: '0', supplier: 'Bong Long' },
])
assert.deepEqual(zeroCost.issues.map((issue) => issue.gateCode), ['free_goods_required'])
// ...but the free_goods column (N14-D) is exactly the control the refusal's
// own message points at, so a sheet that ticks it passes clean.
const zeroCostDeclaredFree = parseUnifiedStockRows([
  { name: 'A', barcode: '1', warehouse: '3', date: '08/27/2026', action: 'add', cost_price: '0', supplier: 'Bong Long', free_goods: 'yes' },
])
assert.equal(zeroCostDeclaredFree.issues.length, 0, 'a declared-free $0.00 receipt is not gated')
assert.equal(zeroCostDeclaredFree.rows[0].freeGoods, true)

// A CREATE row has no lot yet, so a blank supplier is certain to be refused
// server-side -- this screen can say so before the upload instead of only in
// the finished report, unlike an ordinary add whose supplier may be deferred
// to an already-attributed lot the sheet cannot see.
const createNoSupplier = parseUnifiedStockRows([
  { name: 'Brand New', barcode: '9', shop: '2', date: '08/27/2026', action: 'create', cost_price: '5' },
])
assert.deepEqual(createNoSupplier.issues.map((issue) => issue.gateCode), ['supplier_required'])
// A CREATE row's supplier cell must actually be read: before this, the gate
// call never passed supplierName at all, so an explicit CREATE with the
// supplier column FILLED was still wrongly flagged supplier_required.
const createWithSupplier = parseUnifiedStockRows([
  { name: 'Brand New', barcode: '9', shop: '2', date: '08/27/2026', action: 'create', cost_price: '5', supplier: 'Bong Long' },
])
assert.deepEqual(createWithSupplier.issues.map((issue) => issue.gateCode), [], 'a filled supplier column must clear the create-row gate')
// 'new' is the same action, mirroring the resolver's CREATE_ACTION_RE.
assert.deepEqual(
  parseUnifiedStockRows([{ name: 'Brand New', barcode: '9', shop: '2', date: '08/27/2026', action: 'new', cost_price: '5' }])
    .issues.map((issue) => issue.gateCode),
  ['supplier_required'],
)
// An ordinary add (no explicit create/new) keeps deferring the supplier half:
// it may be topping up an already-attributed lot this screen cannot see.
assert.deepEqual(
  parseUnifiedStockRows([{ name: 'A', barcode: '1', shop: '2', date: '08/27/2026', action: 'add', cost_price: '5' }])
    .issues.map((issue) => issue.gateCode),
  [],
  'a plain add defers the supplier question to the server, which can see the lot',
)

// A sale takes stock OUT and carries no receipt facts...
const saleRow = parseUnifiedStockRows([
  { name: 'A', barcode: '1', shop: '2', date: '08/27/2026', action: 'sale2' },
])
assert.equal(saleRow.issues.length, 0, 'a sale is not a receipt')

// ...and neither does a RECONCILE row, whose number is a counted total: only
// the server, holding live stock, knows whether it moves stock in at all.
// Flagging it here would refuse rows the import accepts.
const reconcileRow = parseUnifiedStockRows([
  { name: 'A', barcode: '1', shop: '2', date: '08/27/2026', action: '' },
], 'reconcile')
assert.equal(reconcileRow.issues.length, 0, 'reconcile totals are gated server-side, never guessed here')
// The same row in direct mode IS an add, and is gated.
assert.deepEqual(
  parseUnifiedStockRows([{ name: 'A', barcode: '1', shop: '2', date: '08/27/2026', action: '' }], 'direct')
    .issues.map((issue) => issue.gateCode),
  ['cost_required'],
  'a blank action in direct mode is an add, so the cost is required',
)

// One unreadable cost cell is one row needing attention, not two.
assert.deepEqual(
  parseUnifiedStockRows([{ name: 'A', barcode: '1', shop: '2', date: '08/27/2026', action: 'add', cost_price: 'nope' }])
    .issues.map((issue) => issue.code),
  ['invalid_price'],
)

console.log('PASS unified §12 stock contract: headers, optional supplier, strict parsing, conflict gating, receipt gate mirrored')
