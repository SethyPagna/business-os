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
// Swapped for one request at a time by reqAs() so a permission-shaped probe
// runs through the REAL lib/permissions tier resolution, not a stub of it.
let activeUser = FAKE_USER

const returnsRoute = loadReal('routes/returns.ts', {
  '../lib/db': { getDb: () => db },
  // routes/returns.ts buckets return dates in UTC+7 through the pure
  // businessDateWindow helpers; provide the real module so its date SQL resolves.
  '../lib/businessDateWindow': loadReal('lib/businessDateWindow.ts'),
  // Real, pure -- its chunking is what keeps these reads inside D1's
  // 100-bound-parameter limit, so a stub would test the stub.
  '../lib/sqlBinding': loadReal('lib/sqlBinding.ts'),
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', activeUser); return next() } },
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

async function reqAs(user, method, url, body) {
  activeUser = user
  try {
    return await req(method, url, body)
  } finally {
    activeUser = FAKE_USER
  }
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
    const header = rawDb.prepare('SELECT settlement_mode, settlement_diff_usd, replacement_sale_id, total_refund_usd FROM returns WHERE id = @id').get({ id: json.id })
    assert.strictEqual(header.settlement_mode, null, 'a same-value swap is still just a return plus a sale')
    assert.strictEqual(header.settlement_diff_usd, 0)
    assert.strictEqual(header.total_refund_usd, 20, 'the return refunds its own lines, whatever the replacement costs')
    assert.strictEqual(header.replacement_sale_id, json.replacementSaleId)
    assert.strictEqual(json.replacementReceiptNumber, '20260830-120000')
    const replacementSale = rawDb.prepare('SELECT receipt_number, source_return_id, payment_method, total_usd, amount_paid_usd FROM sales WHERE id = ?').get([json.replacementSaleId])
    assert.strictEqual(replacementSale.source_return_id, json.id)
    assert.strictEqual(replacementSale.payment_method, 'Cash')
    assert.strictEqual(replacementSale.total_usd, 20)
    assert.strictEqual(replacementSale.amount_paid_usd, 20)
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

  await check('a same-value replacement records a normal sale, carries the auto note, and keeps its hand-picked lot', async () => {
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

    // --- the money. Two records, neither netted against the other. -------
    // Same value on both sides, but they are still a $20 refund and a $20
    // sale, not a "goods for goods, the till took nothing" special case:
    // that framing is exactly what made a same-value swap read differently
    // from an unequal one.
    const sale = rawDb.prepare('SELECT subtotal_usd, total_usd, total_khr, amount_paid_usd, amount_paid_khr, payment_details, notes, exchange_rate, source_return_id FROM sales WHERE id = ?').get([json.replacementSaleId])
    assert.strictEqual(sale.total_usd, 20, 'the goods that left the shelf are worth $20')
    assert.strictEqual(sale.amount_paid_usd, 20, 'and the sale is settled in full, like any other sale')
    assert.strictEqual(rawDb.prepare('SELECT total_refund_usd FROM returns WHERE id = @id').get({ id: json.id }).total_refund_usd, 20, 'the refund is the returned line, untouched by the sale')
    const paymentLines = JSON.parse(sale.payment_details)
    assert.strictEqual(paymentLines.length, 1)
    assert.strictEqual(paymentLines[0].amount_usd, 20)
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

    // --- the customer copy cannot leak the internal choice ---------------
    // The receipt is built from the replacement SALE row and its sale_items.
    // Neither table has anywhere to put a stock_action, and the auto note is
    // the only free text on the row -- so there is no field to strip and no
    // CSS rule to trust: the restock/damaged choice physically cannot reach
    // what the customer is handed.
    const saleColumns = rawDb.prepare('PRAGMA table_info("sales")').all().map((c) => c.name)
    const saleItemColumns = rawDb.prepare('PRAGMA table_info("sale_items")').all().map((c) => c.name)
    for (const column of [...saleColumns, ...saleItemColumns]) {
      assert.ok(!/stock_action/i.test(column), `receipt-bearing tables must carry no "${column}" -- the choice has nowhere to land`)
    }
    // sale_items.damaged_lot_id (0075) is a DIFFERENT feature -- POS selling
    // marked-down damaged stock -- and a return's hand-out is never that, so
    // the replacement line must leave it null rather than borrowing it to
    // carry this return's damaged flag onto the sale.
    const replacementItem = rawDb.prepare('SELECT damaged_lot_id FROM sale_items WHERE sale_id = ?').get([json.replacementSaleId])
    assert.strictEqual(replacementItem.damaged_lot_id, null)
    assert.doesNotMatch(sale.notes, /damaged|restock/i, 'the auto note must not spell the internal choice onto the receipt')

    // --- and the list read carries the flag without a second round trip --
    const list = await req('GET', '/')
    const listed = list.json.find((row) => row.id === json.id)
    assert.strictEqual(listed.damaged_item_count, 1)
  })

  await check('a replacement is an ORDINARY sale: full tender, real payment method, its own receipt', async () => {
    seed()
    rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (2, 1, 10)').run()
    rawDb.prepare('UPDATE products SET stock_quantity = 10 WHERE id = 2').run()
    const { status, json } = await req('POST', '/', {
      // $10 comes back as a refund and $25 goes out as a sale. Two separate
      // movements of money -- the old model collected only the $15 gap and
      // made the operator declare who owed it.
      items: [{ product_id: 1, quantity: 1, stock_action: 'none', branch_id: 1, applied_price_usd: 10 }],
      replacement_items: [{ product_id: 2, quantity: 1, branch_id: 1, applied_price_usd: 25 }],
      replacement_payment_method: 'ABA Bank',
      reason: 'Upgraded to the bigger size',
    })
    assert.strictEqual(status, 200, JSON.stringify(json))
    const sale = rawDb.prepare('SELECT receipt_number, total_usd, amount_paid_usd, payment_method, payment_details, loyalty_accrual, source_return_id FROM sales WHERE id = ?').get([json.replacementSaleId])
    assert.strictEqual(sale.total_usd, 25)
    assert.strictEqual(sale.amount_paid_usd, 25, 'the customer pays for the sale in full, like any other sale')
    assert.strictEqual(sale.payment_method, 'ABA Bank', 'a real tender, not a "Return Exchange" placeholder')
    assert.strictEqual(sale.loyalty_accrual, 1, 'and it earns loyalty exactly as any other sale does')
    const details = JSON.parse(sale.payment_details)
    assert.strictEqual(details.length, 1)
    assert.strictEqual(details[0].amount_usd, 25)
    assert.strictEqual(details[0].method, 'ABA Bank')
    // its OWN receipt number, minted through the shared generator
    assert.ok(sale.receipt_number && sale.receipt_number !== json.returnNumber)
    assert.strictEqual(json.replacementReceiptNumber, sale.receipt_number)
    // the two records are linked both ways and neither nets against the other
    assert.strictEqual(sale.source_return_id, json.id)
    const header = rawDb.prepare('SELECT replacement_sale_id, total_refund_usd, settlement_mode, settlement_diff_usd FROM returns WHERE id = @id').get({ id: json.id })
    assert.strictEqual(header.replacement_sale_id, json.replacementSaleId)
    assert.strictEqual(header.total_refund_usd, 10, 'the refund is the returned line alone -- nothing is netted off it')
    assert.strictEqual(header.settlement_mode, null, 'nothing writes a settlement mode any more')
    assert.strictEqual(header.settlement_diff_usd, 0)
    // a default is offered when the client names no method
    const plain = await req('POST', '/', {
      items: [{ product_id: 1, quantity: 1, stock_action: 'none', branch_id: 1, applied_price_usd: 10 }],
      replacement_items: [{ product_id: 2, quantity: 1, branch_id: 1, applied_price_usd: 25 }],
      reason: 'No method named',
    })
    assert.strictEqual(plain.status, 200, JSON.stringify(plain.json))
    assert.strictEqual(rawDb.prepare('SELECT payment_method FROM sales WHERE id = ?').get([plain.json.replacementSaleId]).payment_method, 'Cash')
  })

  await check('an "uneven" swap is just a return plus a sale now -- accepted, with both totals intact', async () => {
    seed()
    rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (1, 1, 10)').run()
    // $10 back, $20 out. The old model refused this outright (400
    // uneven_exchange) unless a Full-Access user ticked "settle the price
    // difference". It is now the ordinary case.
    const { status, json } = await req('POST', '/', {
      items: [{ product_id: 1, quantity: 1, stock_action: 'none', branch_id: 1, applied_price_usd: 10 }],
      replacement_items: [{ product_id: 1, quantity: 2, branch_id: 1, applied_price_usd: 10 }],
      reason: 'Two small ones instead of the big one',
    })
    assert.strictEqual(status, 200, JSON.stringify(json))
    assert.strictEqual(rawDb.prepare('SELECT total_refund_usd FROM returns WHERE id = @id').get({ id: json.id }).total_refund_usd, 10)
    assert.strictEqual(rawDb.prepare('SELECT total_usd, amount_paid_usd FROM sales WHERE id = ?').get([json.replacementSaleId]).total_usd, 20)
    // and the 2 handed out really left the shelf
    assert.strictEqual(rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = 1').get().quantity, 8)
  })

  await check('the refund is the ORIGINAL sale line price, whatever the client posts', async () => {
    seed()
    // The sale charged $7.50. The payload claims $99.
    rawDb.prepare('INSERT INTO sale_items (id, sale_id, product_id, quantity, applied_price_usd, applied_price_khr) VALUES (1, 1, 1, 2, 7.5, 30000)').run()
    const { status, json } = await req('POST', '/', {
      sale_id: 1,
      items: [{ sale_item_id: 1, product_id: 1, quantity: 2, stock_action: 'none', branch_id: 1, applied_price_usd: 99, applied_price_khr: 400000 }],
      total_refund_usd: 198,
      total_refund_khr: 800000,
      reason: 'Price-authority probe',
    })
    assert.strictEqual(status, 200, JSON.stringify(json))
    const header = rawDb.prepare('SELECT total_refund_usd, total_refund_khr FROM returns WHERE id = @id').get({ id: json.id })
    assert.strictEqual(header.total_refund_usd, 15, '2 x $7.50 from the sale line, not 2 x $99 from the payload')
    assert.strictEqual(header.total_refund_khr, 60000)
    const line = rawDb.prepare('SELECT applied_price_usd, total_usd FROM return_items WHERE return_id = @id').get({ id: json.id })
    assert.strictEqual(line.applied_price_usd, 7.5)
    assert.strictEqual(line.total_usd, 15)
  })

  await check('a lot-tracked line the sale cannot place is REFUSED until the operator names a lot', async () => {
    seed()
    // The product HAS lots, but this sale line predates lot tracking: no
    // batch_id and no allocations. The old code silently bumped the branch
    // aggregate, leaving the lot ledger and the aggregate drifting apart.
    const batch = await productBatches.receiveBatchStock(db, { productId: 1, branchId: 1, quantity: 4, lotCode: 'LOT-DEST' })
    rawDb.prepare('INSERT INTO sale_items (id, sale_id, product_id, quantity, applied_price_usd, batch_id) VALUES (1, 1, 1, 3, 10, NULL)').run()

    const refused = await req('POST', '/', {
      sale_id: 1,
      items: [{ sale_item_id: 1, product_id: 1, quantity: 3, return_to_stock: true, branch_id: 1, applied_price_usd: 10 }],
      reason: 'Legacy line, lot unknown',
    })
    assert.strictEqual(refused.status, 400, JSON.stringify(refused.json))
    assert.strictEqual(refused.json.code, 'return_lot_required')
    assert.match(refused.json.error, /Widget/)
    // refused BEFORE any write -- no return, no stock movement
    assert.strictEqual(rawDb.prepare('SELECT COUNT(*) AS n FROM returns').get().n, 0)
    assert.strictEqual(rawDb.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = @batchId AND branch_id = 1').get({ batchId: batch.batchId }).quantity, 4)

    // Naming the lot lets it through, and the units land in THAT lot.
    const named = await req('POST', '/', {
      sale_id: 1,
      items: [{ sale_item_id: 1, product_id: 1, quantity: 3, return_to_stock: true, branch_id: 1, applied_price_usd: 10, batch_id: batch.batchId }],
      reason: 'Legacy line, lot named',
    })
    assert.strictEqual(named.status, 200, JSON.stringify(named.json))
    assert.strictEqual(rawDb.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = @batchId AND branch_id = 1').get({ batchId: batch.batchId }).quantity, 7)
    assert.strictEqual(rawDb.prepare('SELECT batch_id FROM return_items WHERE return_id = @id').get({ id: named.json.id }).batch_id, batch.batchId)
  })

  await check('the plain-return path needs no permission beyond returns:add', async () => {
    seed()
    rawDb.prepare("INSERT INTO sale_items (id, sale_id, product_id, quantity, applied_price_usd) VALUES (1, 1, 1, 1, 12)").run()
    // The only per-action gate on this path is 'returns:add'. Switched off,
    // the plain return is refused; on (the suite's default user), it goes
    // through -- with no second tier to clear, as the retired
    // 'returns:settle_difference' used to be for anything with a value gap.
    const withoutAdd = { ...FAKE_USER, permissions: JSON.stringify({ returns: { tier: 'full', actions: { add: 'none' } } }) }
    const denied = await reqAs(withoutAdd, 'POST', '/', {
      sale_id: 1,
      items: [{ sale_item_id: 1, product_id: 1, quantity: 1, stock_action: 'none', branch_id: 1, applied_price_usd: 12 }],
      reason: 'Permission probe',
    })
    assert.strictEqual(denied.status, 403, JSON.stringify(denied.json))
    assert.strictEqual(rawDb.prepare('SELECT COUNT(*) AS n FROM returns').get().n, 0)

    const allowed = await req('POST', '/', {
      sale_id: 1,
      items: [{ sale_item_id: 1, product_id: 1, quantity: 1, stock_action: 'none', branch_id: 1, applied_price_usd: 12 }],
      reason: 'Permission probe',
    })
    assert.strictEqual(allowed.status, 200, JSON.stringify(allowed.json))
    assert.strictEqual(rawDb.prepare('SELECT total_refund_usd FROM returns WHERE id = @id').get({ id: allowed.json.id }).total_refund_usd, 12)
  })

  await check('a return recorded under the OLD exchange model still reads back correctly', async () => {
    seed()
    // A fixture written the way production rows from before this change look:
    // settlement_mode/settlement_diff_* populated, a linked replacement sale
    // whose amount_paid is only the gap the customer topped up.
    rawDb.prepare("INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, applied_price_usd, applied_price_khr) VALUES (1, 1, 1, 'Widget', 1, 10, 41000)").run()
    rawDb.prepare(`INSERT INTO sales (id, receipt_number, branch_id, source_return_id, total_usd, amount_paid_usd, payment_method, loyalty_accrual)
                   VALUES (900, 'OLD-REP-1', 1, 800, 25, 15, 'Return Exchange', 0)`).run()
    rawDb.prepare(`INSERT INTO returns (id, return_number, sale_id, branch_id, return_scope, reason, status,
                     total_refund_usd, total_refund_khr, replacement_sale_id, settlement_mode, settlement_diff_usd, settlement_diff_khr)
                   VALUES (800, 'RET-OLD-1', 1, 1, 'customer', 'Upgraded', 'completed', 10, 41000, 900, 'price_difference', 15, 61500)`).run()
    rawDb.prepare("INSERT INTO return_items (return_id, sale_item_id, product_id, product_name, quantity, applied_price_usd, total_usd, return_to_stock, stock_action, branch_id) VALUES (800, 1, 1, 'Widget', 1, 10, 10, 0, 'none', 1)").run()
    rawDb.prepare("INSERT INTO return_replacement_items (return_id, product_id, product_name, branch_id, quantity, applied_price_usd, total_usd) VALUES (800, 2, 'Different Serum', 1, 1, 25, 25)").run()

    const detail = await req('GET', '/800')
    assert.strictEqual(detail.status, 200, JSON.stringify(detail.json))
    // Every field ReturnDetailModal renders for a historical row survives the
    // model change -- the columns are read-only history, not deleted.
    assert.strictEqual(detail.json.settlement_mode, 'price_difference')
    assert.strictEqual(detail.json.settlement_diff_usd, 15)
    assert.strictEqual(detail.json.total_refund_usd, 10)
    assert.strictEqual(detail.json.replacement_sale_id, 900)
    assert.strictEqual(detail.json.replacement_receipt_number, 'OLD-REP-1')
    assert.strictEqual(detail.json.replacement_items.length, 1)
    assert.strictEqual(detail.json.replacement_items[0].total_usd, 25)
    // and the list read agrees with the detail read
    const listed = (await req('GET', '/')).json.find((row) => row.id === 800)
    assert.strictEqual(listed.settlement_mode, 'price_difference')
    assert.strictEqual(listed.replacement_receipt_number, 'OLD-REP-1')

    // Editing that old return leaves its recorded settlement exactly as found
    // -- nothing rewrites history, and nothing refuses the edit over a gap
    // that no longer means anything.
    const edited = await req('PATCH', '/800', {
      items: [{ sale_item_id: 1, product_id: 1, quantity: 1, stock_action: 'none', branch_id: 1, applied_price_usd: 10 }],
      reason: 'Reason corrected',
    })
    assert.strictEqual(edited.status, 200, JSON.stringify(edited.json))
    const after = rawDb.prepare('SELECT settlement_mode, settlement_diff_usd, settlement_diff_khr FROM returns WHERE id = 800').get()
    assert.strictEqual(after.settlement_mode, 'price_difference')
    assert.strictEqual(after.settlement_diff_usd, 15)
    assert.strictEqual(after.settlement_diff_khr, 61500)
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
      // Passes every pre-check and then fails INSIDE applyReplacementStock
      // on the plain branch_stock aggregate: product 2 has no stock at all,
      // 99 requested.
      // It has to be product 2 and not product 1: product 1 IS lot-tracked
      // here, and a lot-tracked over-draw is now refused up front by the
      // lot-shortfall 409 (its own check below) -- which would never reach
      // the compensation path this check exists to prove.
      replacement_items: [{ product_id: 2, quantity: 99, branch_id: 1, applied_price_usd: 10 }],
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

  await check('Part-77: a lot-blocked EDIT refuses before touching any stock (the gate is still hoisted)', async () => {
    seed()
    // A lot-backed sale and a return that restocked into that lot.
    const batch = await productBatches.receiveBatchStock(db, { productId: 1, branchId: 1, quantity: 10, lotCode: 'LOT-E' })
    await productBatches.removeStockFromBatch(db, { batchId: batch.batchId, productId: 1, branchId: 1, quantity: 5 })
    rawDb.prepare('INSERT INTO sale_items (id, sale_id, product_id, quantity, batch_id) VALUES (1, 1, 1, 5, @batchId)').run({ batchId: batch.batchId })
    const created = await req('POST', '/', {
      sale_id: 1,
      items: [{ sale_item_id: 1, product_id: 1, quantity: 2, return_to_stock: true, branch_id: 1, applied_price_usd: 10 }],
      replacement_items: [{ product_id: 1, quantity: 2, branch_id: 1, applied_price_usd: 10 }],
      reason: 'Swapped for two more',
    })
    assert.strictEqual(created.status, 200, JSON.stringify(created.json))

    const lotBefore = rawDb.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = @batchId AND branch_id = 1').get({ batchId: batch.batchId }).quantity
    const stockBefore = rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = 1').get().quantity
    const itemsBefore = rawDb.prepare('SELECT COUNT(*) AS n FROM return_items WHERE return_id = @id').get({ id: created.json.id }).n

    // The settlement gate that used to occupy this slot is gone, and the
    // lot-required gate now stands in it: an edited line that drops its
    // sale_item_id has no lot the sale can name and none the operator gave.
    // The OLD code ran the reversal and re-apply loops FIRST and only then
    // 400'd -- corrupting stock on a mere validation refusal. Refusing
    // untouched is the invariant, whatever the reason for the refusal.
    const edited = await req('PATCH', `/${created.json.id}`, {
      items: [{ product_id: 1, quantity: 1, return_to_stock: true, branch_id: 1, applied_price_usd: 10 }],
      reason: 'Shrinking the returned side',
    })
    assert.strictEqual(edited.status, 400, JSON.stringify(edited.json))
    assert.strictEqual(edited.json.code, 'return_lot_required')

    assert.strictEqual(rawDb.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = @batchId AND branch_id = 1').get({ batchId: batch.batchId }).quantity, lotBefore, 'the lot must be untouched by a refused edit')
    assert.strictEqual(rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = 1').get().quantity, stockBefore, 'the aggregate must be untouched by a refused edit')
    assert.strictEqual(rawDb.prepare('SELECT COUNT(*) AS n FROM return_items WHERE return_id = @id').get({ id: created.json.id }).n, itemsBefore, 'the return_items rows must survive a refused edit')

    // Naming the lot lets the same edit through, and it lands in THAT lot.
    const accepted = await req('PATCH', `/${created.json.id}`, {
      items: [{ product_id: 1, quantity: 1, return_to_stock: true, branch_id: 1, applied_price_usd: 10, batch_id: batch.batchId }],
      reason: 'Shrinking the returned side',
    })
    assert.strictEqual(accepted.status, 200, JSON.stringify(accepted.json))
    assert.strictEqual(rawDb.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = @batchId AND branch_id = 1').get({ batchId: batch.batchId }).quantity, lotBefore - 1, 'the edit reversed 2 and re-applied 1 into the same lot')
  })

  console.log(`\n${passed} check(s) passed.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
