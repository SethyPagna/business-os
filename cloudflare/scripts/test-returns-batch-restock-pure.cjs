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
  // Real, pure -- its chunking is what keeps these reads inside D1's
  // 100-bound-parameter limit, so a stub would test the stub.
  '../lib/sqlBinding': loadReal('lib/sqlBinding.ts'),
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', FAKE_USER); return next() } },
  '../lib/audit': { audit: async () => {} },
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

  await check('K2: Replace hands out same-name stock -- even exchange records lines and drains stock', async () => {
    seed()
    rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (1, 1, 10)').run()
    rawDb.prepare('UPDATE products SET stock_quantity = 10, selling_price_usd = 10 WHERE id = 1').run()
    const { status, json } = await req('POST', '/', {
      items: [{ product_id: 1, quantity: 2, stock_action: 'none', branch_id: 1, applied_price_usd: 10 }],
      replacement_items: [{ product_id: 1, quantity: 2, branch_id: 1, applied_price_usd: 10 }],
      reason: 'Defective, swapped on the spot',
    })
    assert.strictEqual(status, 200, JSON.stringify(json))
    const rep = rawDb.prepare('SELECT * FROM return_replacement_items WHERE return_id = @id').get({ id: json.id })
    assert.strictEqual(rep.quantity, 2)
    assert.strictEqual(rep.total_usd, 20)
    assert.strictEqual(rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = 1').get().quantity, 8)
    const header = rawDb.prepare('SELECT settlement_mode, settlement_diff_usd FROM returns WHERE id = @id').get({ id: json.id })
    assert.strictEqual(header.settlement_mode, 'even_exchange')
    assert.strictEqual(header.settlement_diff_usd, 0)
    const move = rawDb.prepare("SELECT quantity FROM inventory_movements WHERE movement_type = 'replacement_out' AND reference_id = @id").get({ id: json.id })
    assert.strictEqual(move.quantity, -2)
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

  console.log(`\n${passed} check(s) passed.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
