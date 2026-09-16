// p6/efficiency-3 step 2: pins the sequential-D1-round-trip reductions made
// to lib/stockSession.ts's commitStockSession() and to routes/products.ts's
// GET /stock-in-session-lines (the receipt detail read). Source-pin style,
// like test-worker-perf-2-round-trips-pure.cjs -- this asserts the SHAPE of
// the fix in the committed source (Promise.all fan-out instead of
// sequential awaited reads), not runtime timing, which is not measurable
// from a pure Node process against no live D1.
//
// Run (from cloudflare/): node scripts/test-stockin-session-batch-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')
const stockSessionSource = fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'stockSession.ts'), 'utf8')
const productsSource = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'products.ts'), 'utf8')

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

function sliceBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker)
  assert.ok(start >= 0, `${label}: start marker not found`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.ok(end > start, `${label}: end marker not found after start`)
  return source.slice(start, end)
}

// Before: products, branches, suppliers, explicitBatches resolved via four
// sequential `await rowsIn(...)` calls -- four different tables, no data
// dependency on each other. After: one Promise.all fan-out.
check('stockSession.ts commitStockSession: products/branches/suppliers/explicitBatches resolve in one Promise.all', () => {
  const block = sliceBetween(stockSessionSource, 'export async function commitStockSession', 'for (const id of receiveIds)', 'commitStockSession lookup block')
  assert.match(
    block,
    /const \[products, branches, suppliers, explicitBatches\] = await Promise\.all\(\[/,
    'the four independent id-list lookups must be fanned out together, not four sequential awaits',
  )
})

// Before: possibleDateBatches, productColumns, activeBranches,
// duplicateCandidates and assets were five separate sequential/conditional
// awaits. After: one Promise.all fan-out (skipped branches resolve via
// Promise.resolve() so the condition is still respected).
check('stockSession.ts commitStockSession: dateBatch/schema/branches/duplicates/assets resolve in one Promise.all', () => {
  const block = sliceBetween(stockSessionSource, 'const dateBatchLines = request.items.filter', 'const assetByPath = new Map', 'commitStockSession five-way fan-out block')
  assert.match(
    block,
    /const \[possibleDateBatches, productColumns, activeBranches, duplicateCandidates, assets\] = await Promise\.all\(\[/,
    'the five independent reads must be fanned out together, not five sequential/conditional awaits',
  )
})

// Before: branchStocks then batchStocks, two sequential conditional awaits.
// After: one Promise.all fan-out.
check('stockSession.ts commitStockSession: branchStocks/batchStocks resolve in one Promise.all', () => {
  const block = sliceBetween(stockSessionSource, 'const existingProductIds = [...new Set(receiveIds)]', 'const revisionPairs:', 'commitStockSession branch/batch stock block')
  assert.match(
    block,
    /const \[branchStocks, batchStocks\] = await Promise\.all\(\[/,
    'branchStocks and batchStocks must be fanned out together, not two sequential awaits',
  )
})

// routes/products.ts GET /stock-in-session-lines: the revert-lookup and the
// receipt-count lookup each iterate chunkForBinding() -- before, each chunk
// was a sequential `for (const chunk of ...) { await ... }` round trip;
// after, each chunk fetch is fanned out with Promise.all(chunks.map(...)).
check('products.ts GET /stock-in-session-lines: revert-id chunks fan out with Promise.all', () => {
  const block = sliceBetween(productsSource, "app.get('/stock-in-session-lines'", "app.get('/stock-ledger'", 'products.ts GET /stock-in-session-lines')
  assert.match(
    block,
    /const chunkResults = await Promise\.all\(chunkForBinding\(movementIds\)\.map\(\(chunk\) => \{/,
    'the revert-id IN-clause chunks must be fanned out with Promise.all, not a sequential for-await loop',
  )
  assert.match(
    block,
    /const chunkResults = await Promise\.all\(chunkForBinding\(batchIds\)\.map\(\(chunk\) => \{/,
    'the batch receipt-count IN-clause chunks must be fanned out with Promise.all, not a sequential for-await loop',
  )
})

console.log(`\n${passed} checks passed`)
