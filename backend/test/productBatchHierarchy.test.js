'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

let failed = 0

function runTest(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

const schema = readSource('src/db/postgresSchema.sql')
const runtime = readSource('src/postgresDatabase.js')
const batchHelpers = readSource('src/productBatches.js')
const inventoryRoute = readSource('src/routes/inventory.js')
const productsRoute = readSource('src/routes/products.js')
const salesRoute = readSource('src/routes/sales.js')
const returnsRoute = readSource('src/routes/returns.js')
const importJobs = readSource('src/services/importJobs.js')
const metrics = readSource('src/businessMetrics.js')

runTest('schema and runtime migrations create batch stock tables and allocation tables', () => {
  assert.match(schema, /Name: product_batches; Type: TABLE/i)
  assert.match(schema, /Name: branch_batch_stock; Type: TABLE/i)
  assert.match(schema, /Name: sale_item_batch_allocations; Type: TABLE/i)
  assert.match(schema, /Name: return_item_batch_allocations; Type: TABLE/i)
  assert.match(runtime, /CREATE TABLE IF NOT EXISTS product_batches/i)
  assert.match(runtime, /CREATE TABLE IF NOT EXISTS branch_batch_stock/i)
  assert.match(runtime, /ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS batch_id/i)
  assert.match(runtime, /ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS lot_code/i)
  assert.match(runtime, /ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS expiry_date/i)
})

runTest('batch helpers expose migration, FEFO allocation, and rollup primitives', () => {
  assert.match(batchHelpers, /function migrateLegacyProductToBatches/)
  assert.match(batchHelpers, /function allocateProductBatches/)
  assert.match(batchHelpers, /function increaseProductBatchStock/)
  assert.match(batchHelpers, /function restoreBatchAllocations/)
  assert.match(batchHelpers, /function cloneAllocationsToProduct/)
  assert.match(batchHelpers, /function syncProductBatchRollups/)
  assert.match(batchHelpers, /const RECEIVED_AT_ORDER_SQL =/)
  assert.match(batchHelpers, /NULLIF\(pb\.received_at, ''\)::timestamptz/)
  assert.match(batchHelpers, /ria\.reversed_at IS NULL/)
})

runTest('inventory routes use batch-aware stock mutations and movement logging', () => {
  assert.match(inventoryRoute, /allocateProductBatches/)
  assert.match(inventoryRoute, /increaseProductBatchStock/)
  assert.match(inventoryRoute, /cloneAllocationsToProduct/)
  assert.match(inventoryRoute, /listProductBatches/)
  assert.match(inventoryRoute, /batch_id,\s*lot_code,\s*expiry_date/)
  assert.match(inventoryRoute, /product\.batches\s*=\s*batchMap\.get\(product\.id\)\s*\|\|\s*\[\]/)
})

runTest('products routes expose batches and seed opening stock into batch rows', () => {
  assert.match(productsRoute, /createOrFindProductBatch/)
  assert.match(productsRoute, /seedOpeningBatch/)
  assert.match(productsRoute, /include.*batches/i)
  assert.match(productsRoute, /batches:\s*batchMap\.get\(product\.id\)\s*\|\|\s*\[\]/)
  assert.match(productsRoute, /lot_code/)
  assert.match(productsRoute, /expiry_date/)
})

runTest('sales and returns persist batch allocations for traceable stock transitions', () => {
  assert.match(salesRoute, /sale_item_batch_allocations/)
  assert.match(salesRoute, /allocateProductBatches/)
  assert.match(salesRoute, /restoreBatchAllocations/)
  assert.match(returnsRoute, /return_item_batch_allocations/)
  assert.match(returnsRoute, /getAvailableSaleAllocationRows/)
  assert.match(returnsRoute, /markReturnItemAllocationsReversed/)
  assert.match(returnsRoute, /increaseProductBatchStock/)
})

runTest('imports and metrics are wired to the batch-backed hierarchy', () => {
  assert.match(importJobs, /increaseProductBatchStock/)
  assert.match(importJobs, /normalizeLotCode/)
  assert.match(importJobs, /normalizeExpiryDate/)
  assert.match(importJobs, /lot_code/)
  assert.match(metrics, /FROM product_batches pb/i)
  assert.match(metrics, /JOIN branch_batch_stock bbs/i)
  assert.match(metrics, /migrateAllLegacyProductsToBatches/)
})

if (failed > 0) {
  process.exitCode = 1
}
