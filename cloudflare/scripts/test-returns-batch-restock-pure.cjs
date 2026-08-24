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
const productBatches = loadReal('lib/productBatches.ts', { './db': { getDb: () => db }, './batchCode': batchCode })
const permissions = loadReal('lib/permissions.ts')

const FAKE_USER = { id: 1, username: 'tester', name: 'Test User', permissions: JSON.stringify({ returns: true }) }

const returnsRoute = loadReal('routes/returns.ts', {
  '../lib/db': { getDb: () => db },
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
  '../lib/searchMatch': { buildLikeAliasClause: () => '1=1', tokenizeSearchTermGroups: () => [] },
  '../lib/productBatches': productBatches,
})

const app = returnsRoute.default

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

function seed() {
  rawDb.exec('DELETE FROM branch_batch_stock; DELETE FROM product_batches; DELETE FROM branch_stock; DELETE FROM products; DELETE FROM branches; DELETE FROM sale_items; DELETE FROM sales; DELETE FROM returns; DELETE FROM return_items; DELETE FROM inventory_movements;')
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

  console.log(`\n${passed} check(s) passed.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
