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
const checks = []
function check(name, fn) {
  checks.push({ name, fn })
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
check('stockSession.ts commitStockSession: products/branches/suppliers/lots share one fact query', async () => {
  const block = sliceBetween(stockSessionSource, 'export async function commitStockSession', 'for (const id of receiveIds)', 'commitStockSession lookup block')
  assert.match(
    block,
    /const facts = await sessionFacts\(env, db, receiveIds, branchIds, supplierIds, explicitBatchIds\)/,
    'independent table facts use one set-based read',
  )
  const ts = require('typescript')
  const parsed = ts.createSourceFile('stockSession.ts', stockSessionSource, ts.ScriptTarget.Latest, true)
  const functions = ['sessionFacts', 'sessionRowSql'].map(name => parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name))
  assert.ok(functions.every(Boolean))
  const compiled = ts.transpileModule(functions.map(node => node.getText(parsed)).join('\n'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const db = new (require('better-sqlite3'))(':memory:')
  try {
    db.exec(`CREATE TABLE products(id INTEGER,name TEXT); CREATE TABLE branches(id INTEGER,name TEXT);
      CREATE TABLE suppliers(id INTEGER,name TEXT); CREATE TABLE product_batches(id INTEGER,variant_product_id INTEGER);
      CREATE TABLE product_cost_entries(id INTEGER,product_id INTEGER,baseline_batch_id INTEGER);
      INSERT INTO products VALUES(10,'selected'),(20,'other'); INSERT INTO branches VALUES(1,'selected'),(2,'other');
      INSERT INTO suppliers VALUES(5,'selected'),(6,'other'); INSERT INTO product_batches VALUES(50,10),(51,20),(52,30);
      INSERT INTO product_cost_entries VALUES(1,10,40),(2,10,49);`)
    const columns = new Map(['products','branches','suppliers','product_batches'].map(table => [table,new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name))]))
    const facts = new Function('sessionColumns', compiled + ';return sessionFacts;')(async () => columns)
    let statements = 0
    const adapter = { prepare(sql) { statements++; return { all: params => db.prepare(sql).all(params) } } }
    const result = await facts({},adapter,[10],[1],[5],[51])
    assert.equal(statements,1)
    assert.deepEqual(result.products.map(row=>row.id),[10])
    assert.deepEqual(result.branches.map(row=>row.id),[1])
    assert.deepEqual(result.suppliers.map(row=>row.id),[5])
    assert.deepEqual(result.batches.map(row=>row.id),[50,51])
    assert.deepEqual(result.baselines,[{product_id:10,baseline_batch_id:49}])
    assert.deepEqual((await facts({},adapter,[],[],[],[])).batches,[])
  } finally { db.close() }
})

// Before: possibleDateBatches, productColumns, activeBranches,
// duplicateCandidates and assets were five separate sequential/conditional
// awaits. The override baseline is now a sixth independent read in the same
// Promise.all fan-out (skipped branches resolve via
// Promise.resolve() so the condition is still respected).
check('stockSession.ts commitStockSession: dateBatch/schema/branches/duplicates/assets resolve in one Promise.all', () => {
  const block = sliceBetween(stockSessionSource, 'const dateBatchLines = request.items.filter', 'const assetByPath = new Map', 'commitStockSession five-way fan-out block')
  assert.match(
    block,
    /const \[possibleDateBatches, productColumns, activeBranches, duplicateCandidates, assets, costBaselines\] = await Promise\.all\(\[/,
    'all six independent reads including override baselines must fan out together',
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

// routes/products.ts GET /stock-in-session-lines: the receipt-count lookup
// iterates chunkForBinding() -- before, each chunk was a sequential
// `for (const chunk of ...) { await ... }` round trip; after, each chunk fetch
// is fanned out with Promise.all(chunks.map(...)). The former revert-id lookup
// is gone: the line query flags a reverted line itself (REVERT-FIX F4).
check('products.ts GET /stock-in-session-lines: receipt-count chunks fan out with Promise.all', () => {
  const block = sliceBetween(productsSource, "app.get('/stock-in-session-lines'", "app.get('/stock-ledger'", 'products.ts GET /stock-in-session-lines')
  assert.doesNotMatch(block, /chunkForBinding\(movementIds\)/, 'no per-line revert lookup round trips remain')
  assert.match(
    block,
    /const chunkResults = await Promise\.all\(chunkForBinding\(batchIds\)\.map\(\(chunk\) => \{/,
    'the batch receipt-count IN-clause chunks must be fanned out with Promise.all, not a sequential for-await loop',
  )
})

;(async () => {
  for (const {name,fn} of checks) { await fn(); passed++; console.log(`PASS ${name}`) }
  console.log(`\n${passed} checks passed`)
})().catch(error => { console.error(error); process.exitCode = 1 })
