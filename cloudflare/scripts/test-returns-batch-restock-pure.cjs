// Regression test for the batch-aware restock fix in routes/returns.ts
// (POST / and PATCH /:id): a customer return whose item has a resolvable
// sale_item_id must restock into the EXACT product_batches lot that
// sale_item was sold from, not just bump the generic branch_stock
// aggregate -- and editing that return must reverse the same batch, not
// guess. Same approach as test-pending-actions-pure.cjs: transpile the
// REAL route file and lib/productBatches.ts, run them against a real
// in-memory SQLite database with the real migrations applied, and call
// the actual Hono app.request() the same way the real Worker would.
// Everything with no bearing on this fix (auth/audit/broadcast/cache/
// search/conflict-control) is stubbed to a permissive no-op; the batch
// resolution and restock/reverse logic under test is real.
//
// Run (from cloudflare/): node scripts/test-returns-batch-restock-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const rawDb = openDb(loadAll())
// Flatten node:sqlite's run() result the same way lib/db.ts's real
// D1Compat.run() does (see test-pending-actions-pure.cjs's own comment for
// why this matters) -- productBatches.ts and returns.ts both rely on
// `result.lastInsertRowid`/`result.changes` at the top level, not nested
// under `.meta`.
const db = {
  prepare(sql) {
    const stmt = rawDb.prepare(sql)
    return {
      get: (params) => stmt.get(params),
      all: (params) => stmt.all(params) ?? [],
      run: (params) => {
        const r = stmt.run(params)
        return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }
      },
    }
  },
  async batch(items) {
    const results = []
    for (const item of items) {
      const stmt = rawDb.prepare(item.sql)
      const r = stmt.run(item.params || {})
      results.push({ changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) })
    }
    return results
  },
  async transaction(fn) { return fn(this) },
}
const fakeEnv = { DB: db }

function transpile(relPath) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  return { sourcePath, outputText }
}

function loadReal(relPath, requireOverrides = {}) {
  const { sourcePath, outputText } = transpile(relPath)
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
    moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
  )
  Module._load = originalLoad
  return moduleObj.exports
}

// batchCode.ts is pure (no D1/Env dependency) -- productBatches.ts's
// receiveBatchStock now derives lot_code/batch_key through it, so it needs
// to be the real transpiled module here too, not left to fall through to
// node's own require() (which can't resolve a bare .ts file).
const batchCode = loadReal('lib/batchCode.ts')

// Real, pure -- no stubbing needed.
const productBatches = loadReal('lib/productBatches.ts', { './db': { getDb: () => db }, './batchCode': batchCode, './sqlBinding': loadReal('lib/sqlBinding.ts') })
const permissions = loadReal('lib/permissions.ts')

const FAKE_USER = { id: 1, username: 'tester', name: 'Test User', permissions: JSON.stringify({ returns: true }) }

const returnsRoute = loadReal('routes/returns.ts', {
  '../lib/db': { getDb: () => db },
  // routes/returns.ts buckets return dates in UTC+7 through the pure
  // businessDateWindow helpers; provide the real module so its date SQL resolves.
  '../lib/businessDateWindow': loadReal('lib/businessDateWindow.ts'),
  // Real, pure -- its chunking is what keeps these reads inside D1's
  // 100-bound-parameter limit, so a stub would test the stub.
  '../lib/sqlBinding': loadReal('lib/sqlBinding.ts'),
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', FAKE_USER); return next() } },
  '../lib/audit': { audit: async () => {} },
  '../lib/telegram': { sendReturnTelegramEvent: async () => false, sendTelegramEvent: async () => false, formatSaleTelegramLines: () => [] },
  '../lib/permissions': permissions,
  '../lib/conflictControl': {
    assertUpdatedAtMatch: () => {},
    getExpectedUpdatedAt: () => undefined,
    writeConflictResponse: (err) => ({ body: { error: String(err) }, status: 409 }),
    WriteConflictError: class WriteConflictError extends Error {},
  },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => {} },
  '../lib/searchMatch': { buildLikeAliasClause: () => '1=1', tokenizeSearchTermGroups: () => [], normalizeSearchText: (value) => String(value || '') },
  '../lib/productBatches': productBatches,
  // K2 (Part 410): real, pure -- the three-way stock_action + Replace
  // kernel the route now imports (test-returns-replace-damaged-pure.cjs
  // covers it in isolation; here it runs under the real route).
  '../lib/returnsStock': loadReal('lib/returnsStock.ts', { './db': { getDb: () => db }, './productBatches': productBatches, './sqlBinding': loadReal('lib/sqlBinding.ts') }),
  // Part 519 (session 0b) gave the route a datetime return-number generator;
  // the real one reads the DB for same-second collisions -- a deterministic
  // stub keeps this suite's return numbers stable.
  '../lib/receiptNumber': { uniqueBusinessDateTimeNumber: async (prefix) => `${prefix ? `${prefix}-` : ''}20260830-120000` },
  // Real money kernel -- the replacement sale derives its totals through the
  // same function routes/sales.ts uses, so it must be the real one here too.
  '../lib/saleTotals': loadReal('lib/saleTotals.ts'),
})

const app = returnsRoute.default

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

function seed() {
  rawDb.exec('DELETE FROM branch_batch_stock; DELETE FROM product_batches; DELETE FROM branch_stock; DELETE FROM products; DELETE FROM branches; DELETE FROM sale_items; DELETE FROM sale_item_batch_allocations; DELETE FROM sales; DELETE FROM returns; DELETE FROM return_items; DELETE FROM return_item_batch_allocations; DELETE FROM inventory_movements; DELETE FROM damaged_stock_lots; DELETE FROM return_replacement_items;')
  rawDb.prepare('INSERT INTO branches (id, name, is_active, is_default) VALUES (1, \'Main\', 1, 1)').run()
  rawDb.prepare("INSERT INTO products (id, name, is_active, stock_quantity) VALUES (1, 'Widget', 1, 0)").run()
  rawDb.prepare("INSERT INTO products (id, name, is_active, stock_quantity, selling_price_usd) VALUES (2, 'Different Serum', 1, 0, 10)").run()
  rawDb.prepare("INSERT INTO sales (id, branch_id) VALUES (1, 1)").run()
}

// routes/returns.ts fires several c.executionCtx.waitUntil(...) calls after
// each write (broadcast/cache-bump side effects, unrelated to the batch
// logic under test) -- Hono's Context throws "This context has no
// ExecutionContext" if none is supplied, since app.request()'s real Worker
// caller always provides one. A minimal fake that runs the callback
// immediately (no real background-task deferral needed in a synchronous
// test) is enough; passThroughOnException is provided for the same reason
// even though nothing here calls it.
const fakeExecutionCtx = { waitUntil: (p) => { p?.catch?.(() => {}) }, passThroughOnException: () => {} }

async function req(method, url, body) {
  const res = await app.request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  }, fakeEnv, fakeExecutionCtx)
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

async function main() {
  await check('return with a batch-tracked sale_item restocks into that exact batch, not just the aggregate', async () => {
    seed()
    // A prior sale drew 5 units from a specific batch (as sales.ts's own
    // lot picker would have recorded on sale_items.batch_id).
    const batch = await productBatches.receiveBatchStock(db, { productId: 1, branchId: 1, quantity: 10, lotCode: 'LOT-A' })
    await productBatches.removeStockFromBatch(db, { batchId: batch.batchId, productId: 1, branchId: 1, quantity: 5 })
    rawDb.prepare('INSERT INTO sale_items (id, sale_id, product_id, quantity, batch_id) VALUES (1, 1, 1, 5, @batchId)').run({ batchId: batch.batchId })

    const beforeBatchQty = rawDb.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = @batchId AND branch_id = 1').get({ batchId: batch.batchId }).quantity
    assert.strictEqual(beforeBatchQty, 5, 'sanity: batch should have 5 left after the sale')

    const { status, json } = await req('POST', '/', {
      sale_id: 1,
      items: [{ sale_item_id: 1, product_id: 1, quantity: 3, return_to_stock: true, applied_price_usd: 10 }],
      reason: 'Customer changed mind',
    })
    assert.strictEqual(status, 200, JSON.stringify(json))

    const afterBatchQty = rawDb.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = @batchId AND branch_id = 1').get({ batchId: batch.batchId }).quantity
    assert.strictEqual(afterBatchQty, 8, 'the 3 returned units should have gone back into the SAME batch (5 + 3), not just the aggregate')

    const aggregateQty = rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = 1').get().quantity
    assert.strictEqual(aggregateQty, 8, 'branch_stock aggregate should also reflect the restock')

    const storedBatchId = rawDb.prepare('SELECT batch_id FROM return_items WHERE return_id = @returnId').get({ returnId: json.id }).batch_id
    assert.strictEqual(storedBatchId, batch.batchId, 'the return_items row should record which batch it restocked into')
  })

  await check('return with no resolvable batch (no sale_item_id) falls back to the plain branch_stock bump', async () => {
    seed()
    const { status, json } = await req('POST', '/', {
      items: [{ product_id: 1, quantity: 4, return_to_stock: true, applied_price_usd: 10, branch_id: 1 }],
      reason: 'Manual return, no sale on file',
    })
    assert.strictEqual(status, 200, JSON.stringify(json))
    const aggregateQty = rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = 1').get().quantity
    assert.strictEqual(aggregateQty, 4)
    const storedBatchId = rawDb.prepare('SELECT batch_id FROM return_items WHERE return_id = @returnId').get({ returnId: json.id }).batch_id
    assert.strictEqual(storedBatchId, null, 'no batch could be resolved, so batch_id should stay null')
  })

  await check('editing a return reverses the SAME batch it originally restocked, not the aggregate blindly', async () => {
    seed()
    const batch = await productBatches.receiveBatchStock(db, { productId: 1, branchId: 1, quantity: 10, lotCode: 'LOT-B' })
    await productBatches.removeStockFromBatch(db, { batchId: batch.batchId, productId: 1, branchId: 1, quantity: 5 })
    rawDb.prepare('INSERT INTO sale_items (id, sale_id, product_id, quantity, batch_id) VALUES (1, 1, 1, 5, @batchId)').run({ batchId: batch.batchId })

    const created = await req('POST', '/', {
      sale_id: 1,
      items: [{ sale_item_id: 1, product_id: 1, quantity: 3, return_to_stock: true, applied_price_usd: 10 }],
      reason: 'Initial',
    })
    const returnId = created.json.id
    let batchQty = rawDb.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = @batchId').get({ batchId: batch.batchId }).quantity
    assert.strictEqual(batchQty, 8)

    // Edit down from 3 to 1 -- should reverse 3 out of the batch, then
    // restock 1 back into the same batch (net: 5 + 1 = 6).
    const edited = await req('PATCH', `/${returnId}`, {
      items: [{ sale_item_id: 1, product_id: 1, quantity: 1, return_to_stock: true, applied_price_usd: 10 }],
      reason: 'Edited down',
    })
    assert.strictEqual(edited.status, 200, JSON.stringify(edited.json))

    batchQty = rawDb.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = @batchId').get({ batchId: batch.batchId }).quantity
    assert.strictEqual(batchQty, 6, 'batch should have been reversed by 3 then re-credited by 1, landing at 6')

    const aggregateQty = rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = 1').get().quantity
    assert.strictEqual(aggregateQty, 6, 'aggregate should match the batch ledger')
  })

  await check('multi-lot return records its per-lot split and an edit reverses each EXACT lot (no phantom stock)', async () => {
    seed()
    const batchQtyOf = (b) => rawDb.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = @batchId AND branch_id = 1').get({ batchId: b.batchId }).quantity
    // A sale line drew 5 units split across TWO lots (3 from A, 2 from B) --
    // exactly what sales.ts records when FIFO spans lots: sale_items.batch_id
    // stays NULL and the split lives in sale_item_batch_allocations.
    // Distinct RECEIVED DATES make two distinct lots -- receiveBatchStock
    // derives batch_key from the date, not the lotCode arg (see its source).
    const batchA = await productBatches.receiveBatchStock(db, { productId: 1, branchId: 1, quantity: 10, receivedDate: '2026-01-05' })
    const batchB = await productBatches.receiveBatchStock(db, { productId: 1, branchId: 1, quantity: 10, receivedDate: '2026-03-20' })
    assert.notStrictEqual(batchA.batchId, batchB.batchId, 'sanity: the two receives must be distinct lots')
    await productBatches.removeStockFromBatch(db, { batchId: batchA.batchId, productId: 1, branchId: 1, quantity: 3 })
    await productBatches.removeStockFromBatch(db, { batchId: batchB.batchId, productId: 1, branchId: 1, quantity: 2 })
    rawDb.prepare('INSERT INTO sale_items (id, sale_id, product_id, quantity, batch_id) VALUES (1, 1, 1, 5, NULL)').run()
    rawDb.prepare('INSERT INTO sale_item_batch_allocations (sale_item_id, batch_id, branch_id, quantity, released_quantity) VALUES (1, @a, 1, 3, 0)').run({ a: batchA.batchId })
    rawDb.prepare('INSERT INTO sale_item_batch_allocations (sale_item_id, batch_id, branch_id, quantity, released_quantity) VALUES (1, @b, 1, 2, 0)').run({ b: batchB.batchId })
    assert.strictEqual(batchQtyOf(batchA), 7, 'sanity: A has 7 after the sale drew 3')
    assert.strictEqual(batchQtyOf(batchB), 8, 'sanity: B has 8 after the sale drew 2')

    const created = await req('POST', '/', {
      sale_id: 1,
      items: [{ sale_item_id: 1, product_id: 1, quantity: 5, return_to_stock: true, applied_price_usd: 10 }],
      reason: 'Multi-lot return',
    })
    assert.strictEqual(created.status, 200, JSON.stringify(created.json))
    assert.strictEqual(batchQtyOf(batchA), 10, 'the 3 that came from A go back into A')
    assert.strictEqual(batchQtyOf(batchB), 10, 'the 2 that came from B go back into B')

    const allocs = rawDb.prepare('SELECT batch_id, quantity FROM return_item_batch_allocations WHERE return_item_id IN (SELECT id FROM return_items WHERE return_id = @id)').all({ id: created.json.id })
    assert.strictEqual(allocs.length, 2, 'the split is recorded per lot, not collapsed to one return_items.batch_id')
    const allocMap = new Map(allocs.map((r) => [r.batch_id, r.quantity]))
    assert.strictEqual(allocMap.get(batchA.batchId), 3)
    assert.strictEqual(allocMap.get(batchB.batchId), 2)

    // Editing the return must reverse 3 out of A and 2 out of B (the recorded
    // split), then re-apply the same -- both lots land back at 10 with NO
    // phantom stock. The pre-fix code pulled all 5 out of one lot here.
    const edited = await req('PATCH', `/${created.json.id}`, {
      items: [{ sale_item_id: 1, product_id: 1, quantity: 5, return_to_stock: true, applied_price_usd: 10 }],
      reason: 'Re-saved',
    })
    assert.strictEqual(edited.status, 200, JSON.stringify(edited.json))
    assert.strictEqual(batchQtyOf(batchA), 10, 'after edit A is exactly its 3 back -- not over/under-drawn')
    assert.strictEqual(batchQtyOf(batchB), 10, 'after edit B is exactly its 2 back -- no phantom stock left behind')
    const aggregate = rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = 1').get().quantity
    assert.strictEqual(aggregate, 20, 'aggregate matches the two lots (10 + 10)')
    const reAllocs = rawDb.prepare('SELECT COUNT(*) AS n FROM return_item_batch_allocations WHERE return_item_id IN (SELECT id FROM return_items WHERE return_id = @id)').get({ id: created.json.id }).n
    assert.strictEqual(reAllocs, 2, 'the edit re-recorded the fresh split for the next edit')
  })

  await check('supplier return of a batch-tracked product deducts from the lot ledger, not just the aggregate', async () => {
    seed()
    const batch = await productBatches.receiveBatchStock(db, { productId: 1, branchId: 1, quantity: 10, receivedDate: '2026-02-10' })
    const lotQty = () => rawDb.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = @b AND branch_id = 1').get({ b: batch.batchId }).quantity
    const aggQty = () => rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = 1').get().quantity
    assert.strictEqual(lotQty(), 10, 'sanity: lot starts at 10')
    assert.strictEqual(aggQty(), 10, 'sanity: aggregate starts at 10')

    // Supplier return of 4 units -- they leave the branch via the supplier.
    const { status, json } = await req('POST', '/supplier', {
      items: [{ product_id: 1, quantity: 4, branch_id: 1, cost_price_usd: 2 }],
      branch_id: 1,
      reason: 'Defective batch returned to supplier',
      settlement: 'refund',
      supplier_name: 'Acme',
    })
    assert.strictEqual(status, 200, JSON.stringify(json))
    assert.strictEqual(aggQty(), 6, 'branch_stock drops by the 4 that left')
    assert.strictEqual(lotQty(), 6, 'the lot ledger drops in step -- not left stranded at 10 (the pre-fix drift)')
  })

  await check('K2: the three-way stock_action lands end-to-end -- none/restock/damaged in one return', async () => {
    seed()
    const { status, json } = await req('POST', '/', {
      items: [
        { product_id: 1, quantity: 1, stock_action: 'none', branch_id: 1, applied_price_usd: 10 },
        { product_id: 1, quantity: 2, stock_action: 'restock', branch_id: 1, applied_price_usd: 10 },
        { product_id: 1, quantity: 3, stock_action: 'damaged', branch_id: 1, applied_price_usd: 10 },
      ],
      reason: 'Mixed condition return',
    })
    assert.strictEqual(status, 200, JSON.stringify(json))
    // only the 'restock' units entered sellable stock
    const aggregateQty = rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = 1').get().quantity
    assert.strictEqual(aggregateQty, 2)
    const lot = rawDb.prepare('SELECT * FROM damaged_stock_lots WHERE return_id = @id').get({ id: json.id })
    assert.strictEqual(lot.quantity, 3)
    assert.strictEqual(lot.quantity_remaining, 3)
    assert.strictEqual(lot.branch_id, 1)
    const actions = rawDb.prepare('SELECT stock_action FROM return_items WHERE return_id = @id ORDER BY id').all({ id: json.id }).map((r) => r.stock_action)
    assert.deepStrictEqual(actions, ['none', 'restock', 'damaged'])
    const damageMove = rawDb.prepare("SELECT quantity FROM inventory_movements WHERE movement_type = 'damage_in' AND reference_id = @id").get({ id: json.id })
    assert.strictEqual(damageMove.quantity, 3)
  })

  await check('K2: Replace accepts a different product and creates a linked sale receipt', async () => {
    seed()
    rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (2, 1, 10)').run()
    rawDb.prepare('UPDATE products SET stock_quantity = 10 WHERE id = 2').run()
    rawDb.prepare("INSERT INTO product_batches (variant_product_id, batch_key, lot_code, received_at, is_active, batch_number) VALUES (2, 'replacement-lot', 'REPL-LOT', '2026-08-01', 1, 1)").run()
    const replacementBatchId = Number(rawDb.prepare('SELECT id FROM product_batches WHERE variant_product_id = 2').get().id)
    rawDb.prepare('INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (?, 1, 5)').run([replacementBatchId])
    const { status, json } = await req('POST', '/', {
      items: [{ product_id: 1, quantity: 2, stock_action: 'none', branch_id: 1, applied_price_usd: 10 }],
      replacement_items: [{ product_id: 2, quantity: 2, branch_id: 1, applied_price_usd: 10 }],
      reason: 'Defective, swapped on the spot',
    })
    assert.strictEqual(status, 200, JSON.stringify(json))
    const rep = rawDb.prepare('SELECT * FROM return_replacement_items WHERE return_id = @id').get({ id: json.id })
    assert.strictEqual(rep.quantity, 2)
    assert.strictEqual(rep.total_usd, 20)
    assert.strictEqual(rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 2 AND branch_id = 1').get().quantity, 8)
    const header = rawDb.prepare('SELECT settlement_mode, settlement_diff_usd, replacement_sale_id FROM returns WHERE id = @id').get({ id: json.id })
    assert.strictEqual(header.settlement_mode, 'even_exchange')
    assert.strictEqual(header.settlement_diff_usd, 0)
    assert.strictEqual(header.replacement_sale_id, json.replacementSaleId)
    assert.strictEqual(json.replacementReceiptNumber, '20260830-120000')
    const replacementSale = rawDb.prepare('SELECT receipt_number, source_return_id, payment_method FROM sales WHERE id = ?').get([json.replacementSaleId])
    assert.strictEqual(replacementSale.source_return_id, json.id)
    assert.strictEqual(replacementSale.payment_method, 'Return Exchange')
    const replacementSaleItem = rawDb.prepare('SELECT product_id, quantity FROM sale_items WHERE sale_id = ?').get([json.replacementSaleId])
    assert.strictEqual(replacementSaleItem.product_id, 2)
    assert.strictEqual(replacementSaleItem.quantity, 2)
    assert.strictEqual(rawDb.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = ? AND branch_id = 1').get([replacementBatchId]).quantity, 3)
    const replacementAllocation = rawDb.prepare('SELECT batch_id, quantity FROM sale_item_batch_allocations WHERE sale_item_id = (SELECT id FROM sale_items WHERE sale_id = ?)').get([json.replacementSaleId])
    assert.strictEqual(replacementAllocation.batch_id, replacementBatchId)
    assert.strictEqual(replacementAllocation.quantity, 2)
    const move = rawDb.prepare("SELECT quantity FROM inventory_movements WHERE movement_type = 'replacement_out' AND reference_id = @id").get({ id: json.id })
    assert.strictEqual(move.quantity, -2)
  })

  await check('an EVEN exchange records a normal sale that collected nothing, carries the auto note, and keeps its hand-picked lot', async () => {
    seed()
    // Product 2 is the replacement and its stock is lot-tracked, and the
    // operator picks the lot BY HAND (batch_id on the line) rather than
    // letting FIFO choose -- the one shape whose sale line used to end up
    // with no sale_item_batch_allocations row at all, breaking the batch
    // identity chain right where the customer could return it again.
    rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (2, 1, 10)').run()
    rawDb.prepare('UPDATE products SET stock_quantity = 10 WHERE id = 2').run()
    rawDb.prepare("INSERT INTO product_batches (variant_product_id, batch_key, lot_code, received_at, is_active, batch_number) VALUES (2, 'picked-lot', 'PICK-LOT', '2026-08-01', 1, 1)").run()
    const pickedBatchId = Number(rawDb.prepare('SELECT id FROM product_batches WHERE variant_product_id = 2').get().id)
    rawDb.prepare('INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (?, 1, 6)').run([pickedBatchId])

    const { status, json } = await req('POST', '/', {
      // One line comes back DAMAGED: the flag is what marks it, and the
      // product's own name must not be touched to say so.
      items: [{ product_id: 1, quantity: 2, stock_action: 'damaged', branch_id: 1, applied_price_usd: 10 }],
      replacement_items: [{ product_id: 2, quantity: 2, branch_id: 1, batch_id: pickedBatchId, applied_price_usd: 10 }],
      reason: 'Defective, swapped for the same value',
    })
    assert.strictEqual(status, 200, JSON.stringify(json))

    // --- the money. Goods for goods: the till took NOTHING. ---------------
    const sale = rawDb.prepare('SELECT subtotal_usd, total_usd, total_khr, amount_paid_usd, amount_paid_khr, payment_details, notes, exchange_rate, source_return_id FROM sales WHERE id = ?').get([json.replacementSaleId])
    assert.strictEqual(sale.total_usd, 20, 'the goods that left the shelf are still worth $20')
    assert.strictEqual(sale.amount_paid_usd, 0, 'but nothing was tendered for them')
    assert.strictEqual(sale.amount_paid_khr, 0)
    assert.deepStrictEqual(JSON.parse(sale.payment_details), [], 'no payment line at all -- not a $20 "Return Exchange" tender the till never saw')
    // KHR comes off the USD total at the sale rate, through the SAME kernel
    // routes/sales.ts uses -- not a separate sum of per-line KHR.
    assert.strictEqual(sale.total_khr, Math.round(20 * sale.exchange_rate))

    // --- the note that makes the row legible anywhere it turns up --------
    assert.match(sale.notes, /^Replacement for return /)
    const returnNumber = rawDb.prepare('SELECT return_number FROM returns WHERE id = @id').get({ id: json.id }).return_number
    assert.ok(sale.notes.includes(returnNumber), `note names the return (${sale.notes})`)
    assert.strictEqual(sale.source_return_id, json.id)

    // --- batch identity survives onto the sale line ----------------------
    const alloc = rawDb.prepare('SELECT batch_id, quantity, lot_code FROM sale_item_batch_allocations WHERE sale_item_id = (SELECT id FROM sale_items WHERE sale_id = ?)').get([json.replacementSaleId])
    assert.ok(alloc, 'the hand-picked lot still writes a sale_item_batch_allocations row')
    assert.strictEqual(alloc.batch_id, pickedBatchId)
    assert.strictEqual(alloc.quantity, 2)
    assert.strictEqual(alloc.lot_code, 'PICK-LOT')
    // Drawn exactly once -- the allocation row is a link, not a second draw.
    assert.strictEqual(rawDb.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = ? AND branch_id = 1').get([pickedBatchId]).quantity, 4)

    // --- damaged is a FLAG, never a rename -------------------------------
    const item = rawDb.prepare('SELECT stock_action, product_name FROM return_items WHERE return_id = @id').get({ id: json.id })
    assert.strictEqual(item.stock_action, 'damaged')
    assert.strictEqual(rawDb.prepare('SELECT name FROM products WHERE id = 1').get().name, 'Widget', 'the product name is untouched')
    assert.strictEqual(item.product_name, 'Widget', 'and the snapshot carries no "(damaged)" suffix either')

    // --- and the list read carries the flag without a second round trip --
    const list = await req('GET', '/')
    const listed = list.json.find((row) => row.id === json.id)
    assert.strictEqual(listed.damaged_item_count, 1)
  })

  await check('a PRICE-DIFFERENCE exchange collects exactly the gap the customer topped up -- no more', async () => {
    seed()
    rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (2, 1, 10)').run()
    rawDb.prepare('UPDATE products SET stock_quantity = 10 WHERE id = 2').run()
    const { status, json } = await req('POST', '/', {
      // $10 back, $25 out: the customer hands over $15 and nothing else.
      items: [{ product_id: 1, quantity: 1, stock_action: 'none', branch_id: 1, applied_price_usd: 10 }],
      replacement_items: [{ product_id: 2, quantity: 1, branch_id: 1, applied_price_usd: 25 }],
      settlement_mode: 'price_difference',
      reason: 'Upgraded to the bigger size',
    })
    assert.strictEqual(status, 200, JSON.stringify(json))
    const sale = rawDb.prepare('SELECT total_usd, amount_paid_usd, payment_details FROM sales WHERE id = ?').get([json.replacementSaleId])
    assert.strictEqual(sale.total_usd, 25, 'the goods are worth $25')
    assert.strictEqual(sale.amount_paid_usd, 15, 'but only the $15 gap was actually tendered')
    const details = JSON.parse(sale.payment_details)
    assert.strictEqual(details.length, 1)
    assert.strictEqual(details[0].amount_usd, 15)
    assert.strictEqual(details[0].method, 'Return Exchange')
  })

  await check('K2: an uneven "even exchange" is refused; price_difference stores the signed gap', async () => {
    seed()
    rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (1, 1, 10)').run()
    const uneven = await req('POST', '/', {
      items: [{ product_id: 1, quantity: 1, stock_action: 'none', branch_id: 1, applied_price_usd: 10 }],
      replacement_items: [{ product_id: 1, quantity: 2, branch_id: 1, applied_price_usd: 10 }],
      reason: 'Uneven swap attempt',
    })
    assert.strictEqual(uneven.status, 400)
    assert.strictEqual(uneven.json.code, 'uneven_exchange')
    // nothing was written by the refusal
    assert.strictEqual(rawDb.prepare('SELECT COUNT(*) AS n FROM returns').get().n, 0)
    assert.strictEqual(rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = 1').get().quantity, 10)

    const settled = await req('POST', '/', {
      items: [{ product_id: 1, quantity: 1, stock_action: 'none', branch_id: 1, applied_price_usd: 10 }],
      replacement_items: [{ product_id: 1, quantity: 2, branch_id: 1, applied_price_usd: 10 }],
      settlement_mode: 'price_difference',
      reason: 'Customer pays the gap',
    })
    assert.strictEqual(settled.status, 200, JSON.stringify(settled.json))
    const header = rawDb.prepare('SELECT settlement_mode, settlement_diff_usd FROM returns WHERE id = @id').get({ id: settled.json.id })
    assert.strictEqual(header.settlement_mode, 'price_difference')
    assert.strictEqual(header.settlement_diff_usd, 10) // positive = customer owes
  })

  await check('K2: editing a return whose damaged lot was already drawn from is blocked', async () => {
    seed()
    const created = await req('POST', '/', {
      items: [{ product_id: 1, quantity: 3, stock_action: 'damaged', branch_id: 1, applied_price_usd: 10 }],
      reason: 'Damaged on arrival',
    })
    assert.strictEqual(created.status, 200)
    // POS (11.9, next part) draws one unit from the lot
    rawDb.prepare('UPDATE damaged_stock_lots SET quantity_remaining = 2 WHERE return_id = @id').run({ id: created.json.id })
    const edited = await req('PATCH', `/${created.json.id}`, {
      items: [{ product_id: 1, quantity: 1, stock_action: 'damaged', branch_id: 1, applied_price_usd: 10 }],
      reason: 'Trying to shrink it',
    })
    assert.strictEqual(edited.status, 400)
    assert.match(edited.json.error, /already been drawn/)
    // the lot is untouched by the blocked edit
    assert.strictEqual(rawDb.prepare('SELECT quantity_remaining FROM damaged_stock_lots WHERE return_id = @id').get({ id: created.json.id }).quantity_remaining, 2)
  })

  await check('Part-77: a failure AFTER a lot restock reverses the restock -- no phantom stock, no orphan rows', async () => {
    seed()
    // A prior sale drew 5 from a lot; the return restocks 3 back into it,
    // then the replacement line (deliberately missing its branch) throws
    // INSIDE the same request, after the restock already committed as its
    // own write. The catch must reverse the restock, not just delete rows.
    const batch = await productBatches.receiveBatchStock(db, { productId: 1, branchId: 1, quantity: 10, lotCode: 'LOT-R' })
    await productBatches.removeStockFromBatch(db, { batchId: batch.batchId, productId: 1, branchId: 1, quantity: 5 })
    rawDb.prepare('INSERT INTO sale_items (id, sale_id, product_id, quantity, batch_id) VALUES (1, 1, 1, 5, @batchId)').run({ batchId: batch.batchId })

    const { status, json } = await req('POST', '/', {
      sale_id: 1,
      items: [{ sale_item_id: 1, product_id: 1, quantity: 3, return_to_stock: true, branch_id: 1, applied_price_usd: 10 }],
      // Passes every pre-check (price_difference waives the even-exchange
      // rule) and then fails INSIDE applyReplacementStock on the plain
      // branch_stock aggregate: product 2 has no stock at all, 99 requested.
      // It has to be product 2 and not product 1: product 1 IS lot-tracked
      // here, and a lot-tracked over-draw is now refused up front by the
      // lot-shortfall 409 (its own check below) -- which would never reach
      // the compensation path this check exists to prove.
      replacement_items: [{ product_id: 2, quantity: 99, branch_id: 1, applied_price_usd: 10 }],
      settlement_mode: 'price_difference',
      reason: 'Compensation probe',
    })
    assert.strictEqual(status, 500, JSON.stringify(json))

    // The restock was fully reversed: lot, aggregate and product total are
    // exactly where the sale left them.
    assert.strictEqual(rawDb.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = @batchId AND branch_id = 1').get({ batchId: batch.batchId }).quantity, 5)
    assert.strictEqual(rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = 1').get().quantity, 5)
    assert.strictEqual(rawDb.prepare('SELECT stock_quantity FROM products WHERE id = 1').get().stock_quantity, 5)
    // And nothing of the failed return survives -- incl. return_items, which
    // the old cleanup forgot entirely.
    assert.strictEqual(rawDb.prepare('SELECT COUNT(*) AS n FROM returns').get().n, 0)
    assert.strictEqual(rawDb.prepare('SELECT COUNT(*) AS n FROM return_items').get().n, 0)
    assert.strictEqual(rawDb.prepare('SELECT COUNT(*) AS n FROM return_replacement_items').get().n, 0)
    assert.strictEqual(rawDb.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE movement_type IN ('return', 'replacement_out')").get().n, 0)
  })

  await check('a replacement the LOTS cannot cover is refused 409 before any write -- aggregate and lots never diverge', async () => {
    seed()
    // branch_stock (the aggregate) and branch_batch_stock (the lots) are
    // deliberately out of step, exactly as an import or a manual aggregate
    // adjustment leaves them: the aggregate says 50, the lots account for 5.
    // allocateAcrossLots already reports the gap as `uncovered`; returns.ts
    // used to discard it, draining the aggregate by the full quantity while
    // drawing the lots by only what they held -- widening exactly that drift
    // on every exchange.
    const batch = await productBatches.receiveBatchStock(db, { productId: 1, branchId: 1, quantity: 5, lotCode: 'LOT-SHORT' })
    rawDb.prepare('UPDATE branch_stock SET quantity = 50 WHERE product_id = 1 AND branch_id = 1').run()
    rawDb.prepare('UPDATE products SET stock_quantity = 50 WHERE id = 1').run()
    rawDb.prepare('INSERT INTO sale_items (id, sale_id, product_id, quantity, batch_id) VALUES (1, 1, 1, 5, @batchId)').run({ batchId: batch.batchId })

    const { status, json } = await req('POST', '/', {
      sale_id: 1,
      items: [{ sale_item_id: 1, product_id: 1, quantity: 1, return_to_stock: false, branch_id: 1, applied_price_usd: 10 }],
      // 99 units, no explicit lot: FIFO can cover only what the lots hold.
      replacement_items: [{ product_id: 1, quantity: 99, branch_id: 1, applied_price_usd: 10 }],
      settlement_mode: 'price_difference',
      reason: 'Lot shortfall probe',
    })
    assert.strictEqual(status, 409, JSON.stringify(json))
    assert.strictEqual(json.code, 'replacement_lot_shortfall')
    // The message names the product and how far the lots actually reach, so
    // the operator can pick a lot or fix the count instead of guessing.
    assert.match(json.error, /Widget/)
    assert.match(json.error, /cover only 5/)

    // Refused before the first write: no return, no movement, and the
    // aggregate/lot drift is exactly as it was found.
    assert.strictEqual(rawDb.prepare('SELECT COUNT(*) AS n FROM returns').get().n, 0)
    assert.strictEqual(rawDb.prepare('SELECT COUNT(*) AS n FROM return_items').get().n, 0)
    assert.strictEqual(rawDb.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE movement_type IN ('return', 'replacement_out')").get().n, 0)
    assert.strictEqual(rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = 1').get().quantity, 50)
    assert.strictEqual(rawDb.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = @batchId AND branch_id = 1').get({ batchId: batch.batchId }).quantity, 5)
  })

  await check('Part-77: an even-exchange-blocked EDIT refuses before touching any stock (the gate is hoisted)', async () => {
    seed()
    // A lot-backed sale + an even-exchange return with a replacement line.
    const batch = await productBatches.receiveBatchStock(db, { productId: 1, branchId: 1, quantity: 10, lotCode: 'LOT-E' })
    await productBatches.removeStockFromBatch(db, { batchId: batch.batchId, productId: 1, branchId: 1, quantity: 5 })
    rawDb.prepare('INSERT INTO sale_items (id, sale_id, product_id, quantity, batch_id) VALUES (1, 1, 1, 5, @batchId)').run({ batchId: batch.batchId })
    const created = await req('POST', '/', {
      sale_id: 1,
      items: [{ sale_item_id: 1, product_id: 1, quantity: 2, return_to_stock: true, branch_id: 1, applied_price_usd: 10 }],
      replacement_items: [{ product_id: 1, quantity: 2, branch_id: 1, applied_price_usd: 10 }],
      reason: 'Even exchange',
    })
    assert.strictEqual(created.status, 200, JSON.stringify(created.json))

    const lotBefore = rawDb.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = @batchId AND branch_id = 1').get({ batchId: batch.batchId }).quantity
    const stockBefore = rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = 1').get().quantity
    const itemsBefore = rawDb.prepare('SELECT COUNT(*) AS n FROM return_items WHERE return_id = @id').get({ id: created.json.id }).n

    // Editing the returned side to 1 unit breaks the even exchange (the
    // replacement stays at 2 x $10). The OLD code ran the reversal and
    // re-apply loops FIRST and only then 400'd -- corrupting stock on a
    // mere validation refusal. The hoisted gate must refuse untouched.
    const edited = await req('PATCH', `/${created.json.id}`, {
      items: [{ sale_item_id: 1, product_id: 1, quantity: 1, return_to_stock: true, branch_id: 1, applied_price_usd: 10 }],
      reason: 'Shrinking the returned side',
    })
    assert.strictEqual(edited.status, 400, JSON.stringify(edited.json))
    assert.match(edited.json.error, /even exchange/)

    assert.strictEqual(rawDb.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = @batchId AND branch_id = 1').get({ batchId: batch.batchId }).quantity, lotBefore, 'the lot must be untouched by a refused edit')
    assert.strictEqual(rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = 1').get().quantity, stockBefore, 'the aggregate must be untouched by a refused edit')
    assert.strictEqual(rawDb.prepare('SELECT COUNT(*) AS n FROM return_items WHERE return_id = @id').get({ id: created.json.id }).n, itemsBefore, 'the return_items rows must survive a refused edit')
  })

  console.log(`\n${passed} check(s) passed.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
