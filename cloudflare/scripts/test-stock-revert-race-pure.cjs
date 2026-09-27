// H-stock 2 (2026-09-27): a stock-ledger revert must apply exactly once even
// when two requests race (double tap, two tabs, a retried POST).
//
// Drives two REAL applyMovementRevert calls concurrently (Promise.all) on the
// real migration chain. Both pass the early "already reverted?" read; only the
// in-batch guard can stop the second. Discriminating: on the pre-fix code the
// removal-of-3 case ends at 13 with two counter-movements, and the lot case
// commits its lot decrement in a separate batch before the counter-movement.
//
// Run (from cloudflare/): node scripts/test-stock-revert-race-pure.cjs
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
const { applyMovementRevert } = loadReal(path.join(SRC, 'lib', 'stockRevert.ts'))

function freshDb() {
  const rawDb = openDb(loadAll())
  let beforeBatch = null
  const db = {
    prepare(sql) {
      const stmt = rawDb.prepare(sql)
      return {
        // Real D1 reads are network round trips; yielding here lets two
        // concurrent requests interleave exactly as they would in a Worker.
        get: async (params) => { await new Promise((r) => setImmediate(r)); return stmt.get(params) },
        all: async (params) => { await new Promise((r) => setImmediate(r)); return stmt.all(params) ?? [] },
        run: async (params) => { const r = stmt.run(params); return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) } },
      }
    },
    async batch(items) {
      await new Promise((r) => setImmediate(r))
      if (beforeBatch) { const hook = beforeBatch; beforeBatch = null; hook(rawDb) }
      return rawDb.batch(items)
    },
    async transaction(fn) { return fn(this) },
  }
  rawDb.prepare("INSERT INTO branches (id, name, is_active, is_default) VALUES (1, 'Shop', 1, 1)").run()
  return { rawDb, db, setBeforeBatch(fn) { beforeBatch = fn } }
}

function seed(rawDb, { stock, lot }) {
  rawDb.prepare("INSERT INTO products (id, name, is_active, stock_quantity) VALUES (1, 'Widget', 1, @stock)").run({ stock })
  rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (1, 1, @stock)').run({ stock })
  if (lot) {
    rawDb.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, batch_number, received_quantity)
      VALUES (1, 1, '08012026', '08012026', '2026-08-01', 1, 1, 10)`).run()
    rawDb.prepare('INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (1, 1, @stock)').run({ stock })
  }
}

function state(rawDb, id) {
  return {
    branch: rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = 1').get().quantity,
    product: rawDb.prepare('SELECT stock_quantity FROM products WHERE id = 1').get().stock_quantity,
    lot: rawDb.prepare('SELECT COALESCE(SUM(quantity), 0) AS q FROM branch_batch_stock').get().q,
    counters: rawDb.prepare('SELECT COUNT(*) AS n FROM inventory_movements WHERE reference_id = @ref').get({ ref: `revert:${id}` }).n,
  }
}

const actor = { userId: 1, userName: 'Admin' }
let passed = 0
let failed = 0
async function test(name, fn) {
  try { await fn(); console.log(`PASS ${name}`); passed += 1 } catch (err) { console.log(`FAIL ${name}`); console.log(err.stack || err); failed += 1 }
}

async function main() {
  const cases = [
    // remove 3 took 10 -> 7; reverting adds 3 back.
    { name: 'removal of 3, no lots', lot: false, stock: 7, type: 'remove', batchId: null, expect: { branch: 10, product: 10, lot: 0 } },
    { name: 'removal of 3 from a named lot', lot: true, stock: 7, type: 'remove', batchId: 1, expect: { branch: 10, product: 10, lot: 10 } },
    // add 3 took 7 -> 10; reverting removes 3.
    { name: 'addition of 3, no lots', lot: false, stock: 10, type: 'add', batchId: null, expect: { branch: 7, product: 7, lot: 0 } },
    { name: 'addition of 3 onto a named lot', lot: true, stock: 10, type: 'add', batchId: 1, expect: { branch: 7, product: 7, lot: 7 } },
    { name: 'addition of 3, lot drained FIFO (no lot stamp)', lot: true, stock: 10, type: 'add', batchId: null, expect: { branch: 7, product: 7, lot: 7 } },
  ]
  for (const c of cases) {
    await test(`two concurrent reverts of a ${c.name}: exactly one applies`, async () => {
      const { rawDb, db } = freshDb()
      seed(rawDb, c)
      rawDb.prepare(`INSERT INTO inventory_movements (id, product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, batch_id)
        VALUES (50, 1, 'Widget', 1, 'Shop', @type, 3, 'miscount', @batchId)`).run({ type: c.type, batchId: c.batchId })
      const mv = rawDb.prepare('SELECT * FROM inventory_movements WHERE id = 50').get()
      const [a, b] = await Promise.all([applyMovementRevert(db, mv, actor), applyMovementRevert(db, mv, actor)])
      const s = state(rawDb, 50)
      assert.strictEqual([a, b].filter((r) => r.ok).length, 1, `exactly one ok: ${JSON.stringify([a, b])} ${JSON.stringify(s)}`)
      const loser = a.ok ? b : a
      assert.strictEqual(loser.status, 409)
      assert.strictEqual(loser.code, 'already_reverted')
      assert.deepStrictEqual({ branch: s.branch, product: s.product, lot: s.lot }, c.expect)
      assert.strictEqual(s.counters, 1)
      // A later retry (reply lost) is refused the same way, nothing moves.
      const retry = await applyMovementRevert(db, mv, actor)
      assert.strictEqual(retry.code, 'already_reverted')
      assert.deepStrictEqual(state(rawDb, 50), s)
    })
  }

  await test('the revert of the revert still applies once (reversal of the reversal)', async () => {
    const { rawDb, db } = freshDb()
    seed(rawDb, { stock: 7, lot: false })
    rawDb.prepare(`INSERT INTO inventory_movements (id, product_id, product_name, branch_id, branch_name, movement_type, quantity, reason)
      VALUES (50, 1, 'Widget', 1, 'Shop', 'remove', 3, 'miscount')`).run()
    assert.ok((await applyMovementRevert(db, rawDb.prepare('SELECT * FROM inventory_movements WHERE id = 50').get(), actor)).ok)
    const counter = rawDb.prepare("SELECT * FROM inventory_movements WHERE reference_id = 'revert:50'").get()
    const [a, b] = await Promise.all([applyMovementRevert(db, counter, actor), applyMovementRevert(db, counter, actor)])
    assert.strictEqual([a, b].filter((r) => r.ok).length, 1)
    assert.strictEqual(state(rawDb, counter.id).branch, 7, 'back to the original 7, not 4')
  })

  await test('a sale that takes the lot between check and write rolls the whole revert back (stock_changed)', async () => {
    const { rawDb, db, setBeforeBatch } = freshDb()
    seed(rawDb, { stock: 10, lot: true })
    rawDb.prepare(`INSERT INTO inventory_movements (id, product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, batch_id)
      VALUES (50, 1, 'Widget', 1, 'Shop', 'add', 3, 'miscount', 1)`).run()
    setBeforeBatch((raw) => {
      raw.prepare('UPDATE branch_batch_stock SET quantity = 1 WHERE batch_id = 1').run()
      raw.prepare('UPDATE branch_stock SET quantity = 1 WHERE product_id = 1').run()
      raw.prepare('UPDATE products SET stock_quantity = 1 WHERE id = 1').run()
    })
    const res = await applyMovementRevert(db, rawDb.prepare('SELECT * FROM inventory_movements WHERE id = 50').get(), actor)
    assert.strictEqual(res.ok, false)
    assert.strictEqual(res.code, 'stock_changed')
    assert.deepStrictEqual(state(rawDb, 50), { branch: 1, product: 1, lot: 1, counters: 0 }, 'nothing written, no counter-movement')
    assert.strictEqual(rawDb.prepare('SELECT COUNT(*) AS n FROM stock_session_guards').get().n, 0)
  })

  // FX-stock F3 (R-stock+returns): a dated stock count re-apply supersedes
  // its own prior movement -- reverses its effect and DELETES the row -- in
  // one batch. A revert that read that row just before must not then
  // compensate a movement that no longer exists (the refuter's G02: branch
  // 0 where the count says 5, and a revert:<id> row pointing at nothing).
  for (const c of [
    { name: 'an addition of 3 onto a named lot', stock: 10, type: 'add', delta: -3 },
    { name: 'a removal of 3 from a named lot', stock: 7, type: 'remove', delta: 3 },
  ]) {
    await test(`${c.name} superseded (deleted) between the revert's read and its write: refused, nothing written`, async () => {
      const { rawDb, db, setBeforeBatch } = freshDb()
      seed(rawDb, { stock: c.stock, lot: true })
      rawDb.prepare(`INSERT INTO inventory_movements (id, product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, batch_id)
        VALUES (50, 1, 'Widget', 1, 'Shop', @type, 3, 'Dated stock count import', 1)`).run({ type: c.type })
      const mv = rawDb.prepare('SELECT * FROM inventory_movements WHERE id = 50').get()
      setBeforeBatch((raw) => {
        // The re-apply's own batch: the row's effect reversed on both
        // ledgers, the row deleted (datedStockCountApply.ts).
        raw.prepare('UPDATE branch_batch_stock SET quantity = quantity + @d WHERE batch_id = 1').run({ d: c.delta })
        raw.prepare('UPDATE branch_stock SET quantity = quantity + @d WHERE product_id = 1').run({ d: c.delta })
        raw.prepare('UPDATE products SET stock_quantity = quantity FROM branch_stock WHERE branch_stock.product_id = products.id').run()
        raw.prepare('DELETE FROM inventory_movements WHERE id = 50').run()
      })
      const before = c.stock + c.delta
      const res = await applyMovementRevert(db, mv, actor)
      assert.strictEqual(res.ok, false, `the revert of a deleted row must not apply: ${JSON.stringify(res)} ${JSON.stringify(state(rawDb, 50))}`)
      assert.strictEqual(res.status, 409)
      assert.strictEqual(res.code, 'stock_changed')
      assert.deepStrictEqual(state(rawDb, 50), { branch: before, product: before, lot: before, counters: 0 }, 'nothing written, no counter-movement')
      assert.strictEqual(rawDb.prepare('SELECT COUNT(*) AS n FROM stock_session_guards').get().n, 0)
    })
  }

  console.log(`\n${passed} PASS, ${failed} FAIL`)
  process.exitCode = failed ? 1 : 0
}

main()
