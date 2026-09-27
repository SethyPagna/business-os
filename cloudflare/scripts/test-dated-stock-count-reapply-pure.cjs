// H-stock 1 (2026-09-27): re-applying a dated stock count must land exactly
// on the counted quantity, and the apply must be all-or-nothing.
//
// End to end through the REAL buildDatedStockCountPlan (what POST
// /inventory/dated-stock-count/apply calls) and applyDatedStockCountPlan,
// transpiled, on the real migration chain. Discriminating: the pre-fix apply
// deleted the prior run's movements without reversing them, so every "stays
// 10" case below read 13, and a failure injected at the last statement left
// the lot and aggregate writes already committed.
//
// Run (from cloudflare/): node scripts/test-dated-stock-count-reapply-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')
const cache = new Map()
function loadReal(abs) {
  if (cache.has(abs)) return cache.get(abs).exports
  const source = fs.readFileSync(abs, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: abs,
  })
  const mod = new Module(abs, module)
  mod.filename = abs
  mod.paths = Module._nodeModulePaths(path.dirname(abs))
  cache.set(abs, mod)
  const parentRequire = mod.require.bind(mod)
  mod.require = (id) => {
    if (id.startsWith('.')) {
      let target = path.resolve(path.dirname(abs), id)
      if (!target.endsWith('.ts')) target += '.ts'
      if (fs.existsSync(target)) return loadReal(target)
    }
    return parentRequire(id)
  }
  mod._compile(outputText, abs)
  return mod.exports
}
const lib = (name) => loadReal(path.join(SRC, 'lib', `${name}.ts`))
const { buildDatedStockCountPlan } = lib('datedStockCountRoute')
const { applyDatedStockCountPlan, DatedStockCountConflictError } = lib('datedStockCountApply')
const { applyMovementRevert } = lib('stockRevert')

function freshDb() {
  const rawDb = openDb(loadAll())
  const db = {
    prepare(sql) {
      const stmt = rawDb.prepare(sql)
      return {
        get: (params) => stmt.get(params),
        all: (params) => stmt.all(params) ?? [],
        run: (params) => { const r = stmt.run(params); return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) } },
      }
    },
    async batch(items) { return rawDb.batch(items) },
    async batchOnce(items) { return rawDb.batch(items) },
    async transaction(fn) { return fn(this) },
  }
  rawDb.prepare("INSERT INTO branches (id, name, is_active, is_default) VALUES (1, 'Shop', 1, 1)").run()
  rawDb.prepare("INSERT INTO branches (id, name, is_active, is_default) VALUES (2, 'Warehouse', 1, 0)").run()
  return { rawDb, db }
}

function seed(rawDb, { stock, lot }) {
  rawDb.prepare('INSERT INTO products (id, name, is_active, stock_quantity) VALUES (1, \'Widget\', 1, @stock)').run({ stock })
  rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (1, 1, @stock)').run({ stock })
  if (lot) {
    rawDb.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, batch_number, received_quantity)
      VALUES (1, 1, '08012026', '08012026', '2026-08-01', 1, 1, @stock)`).run({ stock })
    rawDb.prepare('INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (1, 1, @stock)').run({ stock })
  }
}

function snapshot(rawDb) {
  return {
    branch: rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = 1').get()?.quantity ?? 0,
    product: rawDb.prepare('SELECT stock_quantity FROM products WHERE id = 1').get().stock_quantity,
    lots: rawDb.prepare('SELECT COALESCE(SUM(quantity), 0) AS q FROM branch_batch_stock').get().q,
    received: rawDb.prepare('SELECT COALESCE(SUM(received_quantity), 0) AS q FROM product_batches').get().q,
    movements: rawDb.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE reason = 'Dated stock count import'").get().n,
    actions: rawDb.prepare('SELECT COUNT(*) AS n FROM dated_stock_count_batch_actions').get().n,
  }
}

async function applyEntries(db, entries) {
  const built = await buildDatedStockCountPlan(db, entries)
  if ('error' in built) throw new Error(built.error)
  return applyDatedStockCountPlan(db, built.plan)
}

let passed = 0
let failed = 0
async function test(name, fn) {
  try { await fn(); console.log(`PASS ${name}`); passed += 1 } catch (err) { console.log(`FAIL ${name}`); console.log(err.stack || err); failed += 1 }
}

const COUNT_10 = [{ date: '2026-08-16', productId: 1, branchId: 1, count: 10 }]

async function main() {
  for (const lot of [false, true]) {
    const label = lot ? 'lot-tracked' : 'no lots'
    await test(`${label}: stock 7, count 10 applied twice lands on 10 (was 13)`, async () => {
      const { rawDb, db } = freshDb()
      seed(rawDb, { stock: 7, lot })
      await applyEntries(db, COUNT_10)
      const first = snapshot(rawDb)
      assert.strictEqual(first.branch, 10)
      await applyEntries(db, COUNT_10)
      const second = snapshot(rawDb)
      assert.deepStrictEqual({ branch: second.branch, product: second.product }, { branch: 10, product: 10 })
      assert.strictEqual(second.movements, 1, 'the superseded movement is replaced, not duplicated')
      if (lot) {
        assert.strictEqual(second.lots, 10, 'lots equal the branch total')
        assert.strictEqual(second.received, first.received, 'the lot received figure is not inflated by a re-apply')
        assert.strictEqual(second.actions, first.actions, 'provenance replaced, not duplicated')
      }
      // Third time for good measure: idempotent, not merely two-step lucky.
      await applyEntries(db, COUNT_10)
      assert.strictEqual(snapshot(rawDb).branch, 10)
    })

    await test(`${label}: a corrected re-upload (10 -> 8, plus a later date 12) lands on the new counts`, async () => {
      const { rawDb, db } = freshDb()
      seed(rawDb, { stock: 7, lot })
      await applyEntries(db, COUNT_10)
      await applyEntries(db, [
        { date: '2026-08-16', productId: 1, branchId: 1, count: 8 },
        { date: '2026-08-20', productId: 1, branchId: 1, count: 12 },
      ])
      const s = snapshot(rawDb)
      assert.deepStrictEqual({ branch: s.branch, product: s.product }, { branch: 12, product: 12 })
      if (lot) assert.strictEqual(s.lots, 12)
      await applyEntries(db, [{ date: '2026-08-16', productId: 1, branchId: 1, count: 8 }])
      // A count is absolute: the file's only (latest) count is 8, so the
      // stock is 8. Only the 08-16 movement is replaced; the 08-20 one stays
      // in the ledger. Pre-fix: 12 + (8 - 11) without the -1 reversal = 9.
      assert.strictEqual(snapshot(rawDb).branch, 8)
      assert.strictEqual(snapshot(rawDb).movements, 2)
    })

    await test(`${label}: re-applying after a sale still lands on the count (a count is absolute), not count + prior effect`, async () => {
      const { rawDb, db } = freshDb()
      seed(rawDb, { stock: 7, lot })
      await applyEntries(db, COUNT_10)
      // A sale of 2 after the count (direct write, same shape as a till deduction).
      rawDb.prepare('UPDATE branch_stock SET quantity = quantity - 2 WHERE product_id = 1 AND branch_id = 1').run()
      rawDb.prepare('UPDATE products SET stock_quantity = stock_quantity - 2 WHERE id = 1').run()
      if (lot) rawDb.prepare('UPDATE branch_batch_stock SET quantity = quantity - 2 WHERE batch_id = 1').run()
      await applyEntries(db, COUNT_10)
      const s = snapshot(rawDb)
      // Pre-fix: 8 + 5 without reversing the prior +3 = 13.
      assert.deepStrictEqual({ branch: s.branch, product: s.product }, { branch: 10, product: 10 })
      if (lot) assert.strictEqual(s.lots, 10)
    })

    await test(`${label}: a failure at the last statement leaves stock, lots and history unchanged`, async () => {
      const { rawDb, db } = freshDb()
      seed(rawDb, { stock: 7, lot })
      await applyEntries(db, COUNT_10)
      const before = snapshot(rawDb)
      const ids = rawDb.prepare('SELECT id FROM inventory_movements ORDER BY id').all().map((r) => r.id)
      // Every apply ends by writing its new movement row; make that throw.
      rawDb.prepare(`CREATE TRIGGER fail_movement_insert BEFORE INSERT ON inventory_movements
        BEGIN SELECT RAISE(ABORT, 'injected failure'); END`).run()
      await assert.rejects(() => applyEntries(db, [{ date: '2026-08-16', productId: 1, branchId: 1, count: 4 }]), /injected failure/)
      assert.deepStrictEqual(snapshot(rawDb), before, 'nothing half-applied')
      assert.deepStrictEqual(rawDb.prepare('SELECT id FROM inventory_movements ORDER BY id').all().map((r) => r.id), ids,
        'the superseded movement was not deleted without its replacement')
    })

    await test(`${label}: the same plan applied twice (double submit) applies once, the second is refused`, async () => {
      const { rawDb, db } = freshDb()
      seed(rawDb, { stock: 7, lot })
      await applyEntries(db, COUNT_10)
      const built = await buildDatedStockCountPlan(db, COUNT_10)
      await applyDatedStockCountPlan(db, built.plan)
      const after = snapshot(rawDb)
      await assert.rejects(() => applyDatedStockCountPlan(db, built.plan), (err) => err instanceof DatedStockCountConflictError)
      assert.deepStrictEqual(snapshot(rawDb), after)
      assert.strictEqual(after.branch, 10)
    })
  }

  await test('first apply of a stale plan (another apply landed first) is refused, nothing written', async () => {
    const { rawDb, db } = freshDb()
    seed(rawDb, { stock: 7, lot: false })
    const a = await buildDatedStockCountPlan(db, COUNT_10)
    const b = await buildDatedStockCountPlan(db, COUNT_10)
    await applyDatedStockCountPlan(db, a.plan)
    await assert.rejects(() => applyDatedStockCountPlan(db, b.plan), (err) => err instanceof DatedStockCountConflictError)
    assert.strictEqual(snapshot(rawDb).branch, 10, 'pre-fix: 13')
  })

  await test('a prior movement reverted from the ledger is neither reversed again nor deleted', async () => {
    const { rawDb, db } = freshDb()
    seed(rawDb, { stock: 7, lot: false })
    await applyEntries(db, COUNT_10)
    const mv = rawDb.prepare("SELECT * FROM inventory_movements WHERE reason = 'Dated stock count import'").get()
    const reverted = await applyMovementRevert(db, mv, { userId: 1, userName: 'Admin' })
    assert.ok(reverted.ok)
    assert.strictEqual(snapshot(rawDb).branch, 7)
    await applyEntries(db, COUNT_10)
    assert.strictEqual(snapshot(rawDb).branch, 10)
    assert.ok(rawDb.prepare('SELECT id FROM inventory_movements WHERE id = @id').get({ id: mv.id }), 'reverted original kept with its counter-movement')
    await applyEntries(db, COUNT_10)
    assert.strictEqual(snapshot(rawDb).branch, 10)
  })

  console.log(`\n${passed} PASS, ${failed} FAIL`)
  process.exitCode = failed ? 1 : 0
}

main()
