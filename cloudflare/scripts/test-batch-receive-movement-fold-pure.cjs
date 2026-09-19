// P4-4a: POST /api/batches/receive folds its `inventory_movements` INSERT
// into receiveBatchStock's own db.batch call instead of running it as a
// second, separate awaited statement afterward.
//
// receiveBatchStock (lib/productBatches.ts) now accepts an optional
// `buildBatchStatements({ batchKey, lotCode, resolvedBatchIdSql })` callback:
// it is invoked once batchKey is known (right before the batch write), and
// whatever statements it returns are appended to the SAME db.batch call.
// `resolvedBatchIdSql` is a subquery fragment that resolves to this
// receipt's own batch id -- explicit @batchId when one was picked, else
// @productId + @batchKey -- matching the identity rule receiveBatchStock's
// own post-batch SELECT uses, so a statement can reference the not-yet-known
// batch id without a round trip to look it up first.
//
// This test drives receiveBatchStock directly (not the Hono route) with a
// movement-insert callback shaped exactly like routes/batches.ts's, for both
// a brand-new lot and an explicit top-up of an existing one, and asserts:
//   1. the movement row's batch_id resolves correctly in both cases,
//   2. the OLD orchestration (receiveBatchStock, then a separate awaited
//      INSERT) cost one more round trip than the NEW one (folded into the
//      same db.batch call) for the identical inputs.
//
// Run: node scripts/test-batch-receive-movement-fold-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const cloudflareRoot = path.join(__dirname, '..')
const MIGRATION_SQLS = loadAll()
const RECEIPT_COST = 5.1234

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

function transpile(relPath) {
  const sourcePath = path.join(cloudflareRoot, 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  return { sourcePath, outputText }
}

// Same pattern test-adjust-received-date-pure.cjs uses: patch Module._load so
// relative requires the override map doesn't name (batchCode, moneyPrecision,
// sqlBinding) resolve to their REAL files on disk, while './db' (a type-only
// import here) is stubbed.
function loadReal(relPath, requireOverrides = {}) {
  const { sourcePath, outputText } = transpile(relPath)
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
    )
  } finally {
    Module._load = originalLoad
  }
  return moduleObj.exports
}

const batchCode = loadReal('lib/batchCode.ts')
const moneyPrecision = loadReal('lib/moneyPrecision.ts')
const sqlBinding = loadReal('lib/sqlBinding.ts')
const productBatches = loadReal('lib/productBatches.ts', {
  './db': {},
  './batchCode': batchCode,
  './moneyPrecision': moneyPrecision,
  './sqlBinding': sqlBinding,
})

// Statement-execution counter, same shape as the audit round-trip test's:
// each get/run/all is one D1 round trip; a batch() call is one round trip
// regardless of how many statements it holds.
function countingDb(rawDb) {
  let statements = 0
  return {
    stats: () => ({ statements }),
    db: {
      prepare(sql) {
        const stmt = rawDb.prepare(sql)
        return {
          get: (params) => { statements += 1; return stmt.get(params) },
          all: (params) => { statements += 1; return stmt.all(params) ?? [] },
          run: (params) => {
            statements += 1
            const r = stmt.run(params)
            return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }
          },
        }
      },
      async batch(items) {
        statements += 1
        const results = await rawDb.batch(items)
        return results.map((r) => ({ changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }))
      },
    },
  }
}

function seedProduct(rawDb, { productId, branchId }) {
  rawDb.prepare('INSERT INTO products (id, name, sku, selling_price_usd, cost_price_usd) VALUES (@id, @name, @sku, 10, 5)')
    .run({ id: productId, name: 'Test Product', sku: `SKU-${productId}` })
  rawDb.prepare('INSERT INTO branches (id, name) VALUES (@id, @name)').run({ id: branchId, name: 'Main' })
  rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@productId, @branchId, 0)')
    .run({ productId, branchId })
}

// Mirrors routes/batches.ts's buildBatchStatements closure exactly (same SQL
// shape, same param names) -- the whole point of this test is that closure.
function movementStatement({ batchKey, resolvedBatchIdSql }, { productId, branchId, quantity, reason, batchId }) {
  return {
    sql: `
      INSERT INTO inventory_movements (
        product_id, product_name, branch_id, branch_name, movement_type, quantity,
        unit_cost_usd, total_cost_usd, reason, reference_id, user_id, user_name,
        created_at, batch_id
      )
      VALUES (
        @productId, @productName, @branchId, @branchName, 'add', @quantity,
        @unitCostUsd, @totalCostUsd, @reason, @referenceId, @userId, @userName,
        CURRENT_TIMESTAMP, ${resolvedBatchIdSql}
      )
    `,
    params: {
      productId, productName: 'Test Product', branchId, branchName: 'Main', quantity,
      unitCostUsd: RECEIPT_COST, totalCostUsd: Number((RECEIPT_COST * quantity).toFixed(4)), reason, referenceId: null,
      userId: 1, userName: 'tester', batchId, batchKey,
    },
  }
}

function lastMovement(rawDb) {
  return rawDb.prepare('SELECT product_id, branch_id, quantity, batch_id, reason FROM inventory_movements ORDER BY id DESC LIMIT 1').get({})
}

async function main() {
  // ---- 1. brand-new lot: resolvedBatchIdSql must resolve via @batchKey ----
  {
    const rawDb = openDb(MIGRATION_SQLS)
    seedProduct(rawDb, { productId: 1, branchId: 1 })
    const counter = countingDb(rawDb)

    const received = await productBatches.receiveBatchStock(counter.db, {
      productId: 1, branchId: 1, quantity: 8, receivedDate: '2026-03-09',
      unitCostUsd: RECEIPT_COST,
      buildBatchStatements: (ctx) => [movementStatement(ctx, {
        productId: 1, branchId: 1, quantity: 8, reason: 'test receipt', batchId: null,
      })],
    })

    check('new lot: movement row lands with the correct resolved batch_id', () => {
      const movement = lastMovement(rawDb)
      assert.equal(Number(movement.batch_id), received.batchId)
      assert.equal(Number(movement.quantity), 8)
      assert.equal(movement.reason, 'test receipt')
      const money = rawDb.prepare('SELECT unit_cost_usd,total_cost_usd FROM inventory_movements ORDER BY id DESC LIMIT 1').get({})
      assert.equal(money.unit_cost_usd,5.1234)
      assert.equal(money.total_cost_usd,40.9872)
    })
    check('new lot: folded calls = 5 (lot candidates, override baseline, cost preimage, batch, final-select)', () => {
      assert.equal(counter.stats().statements, 5, `expected 5, got ${counter.stats().statements}`)
    })
    const oldMovement = rawDb.prepare('SELECT * FROM inventory_movements ORDER BY id LIMIT 1').get({})
    const next = await productBatches.receiveBatchStock(counter.db, {
      productId:1,branchId:1,quantity:1,receivedDate:'2026-03-09',unitCostUsd:6.1234,
    })
    check('new price creates another lot without rewriting the prior four-decimal movement', () => {
      assert.notEqual(next.batchId,received.batchId)
      assert.deepEqual(rawDb.prepare('SELECT * FROM inventory_movements ORDER BY id LIMIT 1').get({}),oldMovement)
      assert.equal(rawDb.prepare('SELECT unit_cost_usd FROM product_batches WHERE id=@id').get({id:received.batchId}).unit_cost_usd,5.1234)
    })
  }

  // ---- 2. explicit top-up of an EXISTING batch: resolvedBatchIdSql must
  // resolve via @batchId, not @batchKey (a different date's batchKey would
  // otherwise miss the row entirely). ----
  {
    const rawDb = openDb(MIGRATION_SQLS)
    seedProduct(rawDb, { productId: 2, branchId: 1 })
    const counter = countingDb(rawDb)

    const first = await productBatches.receiveBatchStock(counter.db, {
      productId: 2, branchId: 1, quantity: 5, receivedDate: '2026-01-01',
      unitCostUsd: RECEIPT_COST,
    })
    const topUpCounter = countingDb(rawDb)
    const second = await productBatches.receiveBatchStock(topUpCounter.db, {
      productId: 2, branchId: 1, quantity: 3, receivedDate: '2026-03-09', batchId: first.batchId,
      unitCostUsd: RECEIPT_COST,
      buildBatchStatements: (ctx) => [movementStatement(ctx, {
        productId: 2, branchId: 1, quantity: 3, reason: 'top-up receipt', batchId: first.batchId,
      })],
    })

    check('top-up: resolves to the EXPLICITLY picked batch, not a batchKey match', () => {
      assert.equal(second.batchId, first.batchId)
      const movement = lastMovement(rawDb)
      assert.equal(Number(movement.batch_id), first.batchId)
      assert.equal(movement.reason, 'top-up receipt')
    })
  }

  // ---- 3. round-trip comparison: folded (new) vs separate-insert (old) ----
  {
    const rawDbOld = openDb(MIGRATION_SQLS)
    seedProduct(rawDbOld, { productId: 3, branchId: 1 })
    const oldCounter = countingDb(rawDbOld)
    // OLD orchestration: receiveBatchStock with no buildBatchStatements, then
    // a SEPARATE awaited INSERT after it returns -- exactly what routes/
    // batches.ts did before this fix.
    const oldReceived = await productBatches.receiveBatchStock(oldCounter.db, {
      productId: 3, branchId: 1, quantity: 4, receivedDate: '2026-03-09',
      unitCostUsd: RECEIPT_COST,
    })
    await oldCounter.db.prepare(`
      INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity, batch_id, created_at)
      VALUES (@productId, 'Test Product', @branchId, 'Main', 'add', @quantity, @batchId, CURRENT_TIMESTAMP)
    `).run({ productId: 3, branchId: 1, quantity: 4, batchId: oldReceived.batchId })
    const oldStats = oldCounter.stats()

    const rawDbNew = openDb(MIGRATION_SQLS)
    seedProduct(rawDbNew, { productId: 4, branchId: 1 })
    const newCounter = countingDb(rawDbNew)
    await productBatches.receiveBatchStock(newCounter.db, {
      productId: 4, branchId: 1, quantity: 4, receivedDate: '2026-03-09',
      unitCostUsd: RECEIPT_COST,
      buildBatchStatements: (ctx) => [movementStatement(ctx, {
        productId: 4, branchId: 1, quantity: 4, reason: null, batchId: null,
      })],
    })
    const newStats = newCounter.stats()

    check('folding the movement insert costs one fewer round trip than the old separate INSERT', () => {
      assert.equal(oldStats.statements, 6, `expected the old orchestration to cost 6, got ${oldStats.statements}`)
      assert.equal(newStats.statements, 5, `expected the new orchestration to cost 5, got ${newStats.statements}`)
      assert.equal(oldStats.statements - newStats.statements, 1)
    })
  }

  console.log(`\nOK ${passed} checks`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
