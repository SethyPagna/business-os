// U-cost (owner report 2026-09-25, KIKO 3D Lip Gloss 05): a received lot whose
// remaining quantity is 0 must not take part in the catalog cost average.
// Owner ruling the same day: the average is QUANTITY-WEIGHTED by what is on
// hand, SUM(qty x cost) / SUM(qty) -- so a partial sale moves it too.
//
// Real migrated SQLite (every migration) and the real
// lib/catalogCostRecompute.ts. Fixtures tell the old rule from the new one:
//   - a sold-out lot at a different cost no longer moves the mean (old rule
//     12.25, new rule 12.50), and the breakdown lists on-hand lots first;
//   - recompute across sale / restock / transfer / delete transitions: a
//     repeated recompute is idempotent and a reversal restores the figure;
//   - the sold-out fallback (most recently RECEIVED lot, not highest id) and
//     the manual override baseline;
//   - sale line cost snapshots are never rewritten;
//   - JS breakdown (what the owner sees) == SQL statement (what is stored)
//     on 300 randomized lot sets.
//
// Run (from cloudflare/): node scripts/test-catalog-cost-on-hand-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const src = path.resolve(__dirname, '../src')

const moduleCache = new Map()
function loadTs(relative) {
  if (moduleCache.has(relative)) return moduleCache.get(relative)
  const filename = path.join(src, relative)
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
  })
  const mod = { exports: {} }
  moduleCache.set(relative, mod.exports)
  const req = (id) => (id === './db' ? {} : id.startsWith('./') ? loadTs(`lib/${id.slice(2)}.ts`) : require(id))
  new Function('module', 'exports', 'require', outputText)(mod, mod.exports, req)
  moduleCache.set(relative, mod.exports)
  return mod.exports
}
const costs = loadTs('lib/catalogCostRecompute.ts')
const { executeStockTransaction } = loadTs('lib/stockTransaction.ts')

// A lib/db.ts-shaped handle (get/all/run with @named params) over the harness.
function libDb(d1) {
  return {
    batch: items=>d1.batch(items),
    batchOnce: items=>d1.batch(items),
    prepare(sql) {
      const stmt = d1.prepare(sql)
      return {
        async get(params) { return stmt.get(params || {}) },
        async all(params) { return stmt.all(params || {}) },
        async run(params) { const r = stmt.run(params || {}); return { changes: Number(r.meta.changes), lastInsertRowid: Number(r.meta.last_row_id) } },
      }
    },
  }
}

let checks = 0
async function check(name, fn) {
  try { await fn(); checks++; console.log(`PASS ${name}`) }
  catch (error) { console.log(`FAIL ${name} - ${error.stack}`); process.exitCode = 1 }
}

function fixtureWrite(db, write) {
  assert.equal(db.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
  db.exec('BEGIN IMMEDIATE')
  let result
  try {
    const epoch=db.prepare("SELECT value FROM system_flags WHERE key='stock_schema_epoch'").get()
    if(epoch)db.exec("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
    result=write()
    db.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'")
    db.exec('COMMIT')
  } catch(error) { db.exec('ROLLBACK');throw error }
  assert.equal(db.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
  return result
}

function fresh() {
  const d1 = openDb(loadAll())
  const raw = d1.db
  const db = libDb(d1)
  const dispatch=statement=>executeStockTransaction(db,[statement],'retry')
  const recomputeJs=productId=>costs.recomputeCatalogCost({ ...db, prepare(sql) {
    return {...db.prepare(sql),async run(params) {
      const [result]=await dispatch({sql,params})
      return {changes:Number(result.meta?.changes ?? 0),lastInsertRowid:Number(result.meta?.last_row_id ?? 0)}
    }}
  } },productId)
  assert.throws(()=>raw.prepare("INSERT INTO products(name) VALUES('guard control')").run(),/stock_transaction_required/)
  const product = (storedCost = 99) => fixtureWrite(d1,()=>Number(raw.prepare(
    'INSERT INTO products(name, cost_price_usd, purchase_price_usd, cost_price_khr, is_active) VALUES (?, ?, ?, 0, 1)',
  ).run(`P${Math.random()}`, storedCost, storedCost).lastInsertRowid))
  const lot = (productId, cost, receivedAt, quantities = {}) => fixtureWrite(d1,()=>{
    const id = Number(raw.prepare(
      'INSERT INTO product_batches(variant_product_id, batch_key, is_active, unit_cost_usd, received_at) VALUES (?, ?, 1, ?, ?)',
    ).run(productId, `k${Math.random()}`, cost, receivedAt).lastInsertRowid)
    for (const [branchId, quantity] of Object.entries(quantities)) {
      raw.prepare('INSERT INTO branch_batch_stock(batch_id, branch_id, quantity) VALUES (?, ?, ?)').run(id, Number(branchId), quantity)
    }
    return id
  })
  const setQty = (lotId, branchId, quantity) => fixtureWrite(d1,()=>raw.prepare('UPDATE branch_batch_stock SET quantity = ? WHERE batch_id = ? AND branch_id = ?').run(quantity, lotId, branchId))
  const stored = (productId) => raw.prepare('SELECT cost_price_usd c, purchase_price_usd p FROM products WHERE id = ?').get(productId)
  const recomputeSql = async (productId) => {
    const statement = costs.catalogCostRecomputeStatement(productId)
    await dispatch(statement)
    return stored(productId).c
  }
  return { d1, raw, db, product, lot, setQty, stored, recomputeSql, recomputeJs }
}

async function main() {
  await check('owner case: a sold-out lot at $12.00 no longer averages with the $12.50 on hand (old rule 12.25)', async () => {
    const f = fresh()
    const id = f.product(12.25)
    const earliest = f.lot(id, 12, '2026-09-01', { 1: 0 })
    const onHand = f.lot(id, 12.5, '2026-09-10', { 1: 15 })
    assert.equal(await f.recomputeSql(id), 12.5)
    assert.notEqual(f.stored(id).c, 12.25, 'the old every-active-lot mean is gone')
    assert.equal(f.stored(id).p, 12.5, 'purchase_price_usd mirrors')

    const breakdown = await costs.getCatalogCostBreakdown(f.db, id)
    assert.equal(breakdown.result_usd, 12.5)
    assert.deepEqual(breakdown.distinct_usd, [12.5])
    assert.deepEqual(breakdown.inputs.map((row) => [row.cost_usd, row.remaining_quantity, row.excluded]),
      [[12.5, 15, null], [12, 0, 'depleted']], 'on-hand lot listed first, sold-out lot after it and tagged')
    assert.ok(onHand > earliest, 'fixture: the depleted lot is the EARLIER one, so first-by-date ordering would fail')

    const productRevision = () => f.raw.prepare("SELECT revision r FROM stock_session_revisions WHERE entity_type = 'product' AND entity_key = ?").get(String(id))?.r ?? 0
    const revisionBefore = productRevision()
    const js = await f.recomputeJs(id)
    assert.deepEqual([js.before.usd, js.after.usd, js.changed], [12.5, 12.5, false], 'JS entry point applies the same formula')
    assert.equal(productRevision(), revisionBefore, 'an unchanged recompute writes nothing (no product revision bump)')
    f.setQty(onHand, 1, 0)
    f.setQty(earliest, 1, 4)
    assert.equal(f.stored(id).c, 12, 'the 0195 triggers already followed both crossings')
    // A figure stored before 0195 (or by a trigger-less path): the JS entry
    // point still moves it, and mirrors purchase_price_usd.
    fixtureWrite(f.d1,()=>f.raw.prepare('UPDATE products SET cost_price_usd = 12.5, purchase_price_usd = 12.5 WHERE id = ?').run(id))
    const moved = await f.recomputeJs(id)
    assert.deepEqual([moved.before.usd, moved.after.usd, moved.changed], [12.5, 12, true])
    assert.equal(f.stored(id).p, 12, 'purchase_price_usd mirrors on the JS path too')
  })

  await check('transitions: sale / restock / transfer / delete, recompute is idempotent and reversible', async () => {
    const f = fresh()
    const id = f.product(0)
    const b = f.lot(id, 12.5, '2026-09-10', { 1: 15 })
    const c = f.lot(id, 13, '2026-09-20', { 1: 5 })
    assert.equal(await f.recomputeSql(id), 12.625, '(15 x 12.50 + 5 x 13.00) / 20 -- the distinct mean would say 12.75')
    f.setQty(b, 1, 3)
    assert.equal(await f.recomputeSql(id), 12.8125, 'partial sale re-weights: (3 x 12.50 + 5 x 13.00) / 8')
    f.setQty(b, 1, 0)
    assert.equal(await f.recomputeSql(id), 13, 'sale that empties lot B drops it from the mean')
    assert.equal(await f.recomputeSql(id), 13, 'double-apply: recomputing again changes nothing')
    f.setQty(b, 1, 3)
    assert.equal(await f.recomputeSql(id), 12.8125, 'reversal (void/undo/return restock) restores the earlier figure exactly')
    await executeStockTransaction(f.db,[
      { sql: 'UPDATE branch_batch_stock SET quantity = 0 WHERE batch_id = @lot AND branch_id = 1', params: { lot: c } },
      { sql: 'INSERT INTO branch_batch_stock(batch_id, branch_id, quantity) VALUES (@lot, 2, 5)', params: { lot: c } },
    ],'retry')
    assert.equal(await f.recomputeSql(id), 12.8125, 'a lot moved between branches stays on hand, same quantity')
    fixtureWrite(f.d1,()=>f.raw.prepare('DELETE FROM branch_batch_stock WHERE batch_id = ? AND branch_id = 2').run(c))
    assert.equal(await f.recomputeSql(id), 12.5, 'deleting the last positive row of lot C drops it')
  })

  await check('sold out entirely: the most recently RECEIVED lot stands in, not the old mean and not zero', async () => {
    const f = fresh()
    const id = f.product(0)
    const late = f.lot(id, 13, '2026-09-20', { 1: 1 })
    const early = f.lot(id, 11, '2026-09-01', { 1: 1 })
    assert.equal(await f.recomputeSql(id), 12)
    f.setQty(late, 1, 0)
    assert.equal(await f.recomputeSql(id), 11)
    f.setQty(early, 1, 0)
    assert.equal(await f.recomputeSql(id), 13, 'fallback orders by received_at (the later-inserted lot is the EARLIER receipt)')
    const breakdown = await costs.getCatalogCostBreakdown(f.db, id)
    assert.equal(breakdown.result_usd, 13)
    assert.deepEqual(breakdown.inputs.map((row) => [row.cost_usd, row.excluded]), [[11, 'depleted'], [13, null]])
  })

  await check('manual override baseline still wins; later on-hand lots join it, depleted ones do not', async () => {
    const f = fresh()
    const id = f.product(0)
    f.lot(id, 12, '2026-09-01', { 1: 4 })
    const plan = costs.planManualCostEntry(id, { cost_price_usd: 12, cost_price_khr: 0 }, { cost_price_usd: 10 }, { id: 1, name: 'Owner' })
    await executeStockTransaction(f.db,[plan],'retry')
    assert.equal(await f.recomputeSql(id), 10, 'override re-prices the four units of the pre-baseline lot')
    const later = f.lot(id, 14, '2026-09-22', { 1: 2 })
    assert.equal(await f.recomputeSql(id), 11.3333, '(4 x 10 + 2 x 14) / 6')
    f.setQty(later, 1, 0)
    assert.equal(await f.recomputeSql(id), 10, 'the post-override lot sold out: back to the override alone')
    assert.equal((await costs.getCatalogCostBreakdown(f.db, id)).result_usd, 10)
  })

  await check('sale line cost snapshots are never rewritten by a recompute', async () => {
    const f = fresh()
    const id = f.product(0)
    const b = f.lot(id, 12.5, '2026-09-10', { 1: 2 })
    f.lot(id, 12, '2026-09-01', { 1: 1 })
    assert.equal(await f.recomputeSql(id), 12.3333, '(2 x 12.50 + 1 x 12.00) / 3')
    f.raw.prepare('INSERT INTO sale_items(sale_id, product_id, quantity, cost_price_usd) VALUES (1, ?, 1, 12.3333)').run(id)
    f.setQty(b, 1, 0)
    assert.equal(await f.recomputeSql(id), 12)
    assert.equal(f.raw.prepare('SELECT cost_price_usd c FROM sale_items WHERE product_id = ?').get(id).c, 12.3333)
  })

  await check('parity: JS breakdown result == stored SQL result on 300 randomized lot sets', async () => {
    const f = fresh()
    let seed = 195
    const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    const pool = [0, 3, 5, 5, 7.25, 12, 12.5, 13]
    for (let i = 0; i < 300; i++) {
      const id = f.product(rand(2) ? 99 : 0)
      const lotCount = rand(5)
      for (let j = 0; j < lotCount; j++) {
        const lotId = f.lot(id, pool[rand(pool.length)], `2026-09-${String(1 + rand(28)).padStart(2, '0')}`, rand(2) ? { 1: rand(3) } : {})
        if (rand(6) === 0 && !f.raw.prepare('SELECT 1 FROM branch_batch_stock WHERE batch_id = ? AND quantity > 0').get(lotId)) {
          fixtureWrite(f.d1,()=>f.raw.prepare('UPDATE product_batches SET is_active = 0 WHERE id = ?').run(lotId))
        }
      }
      if (rand(4) === 0) {
        const plan = costs.planManualCostEntry(id, f.stored(id).c == null ? { cost_price_usd: 0, cost_price_khr: 0 } : { cost_price_usd: f.stored(id).c, cost_price_khr: 0 }, { cost_price_usd: pool[rand(pool.length)] + 0.5 }, { id: 1, name: 'O' })
        if (plan) await executeStockTransaction(f.db,[plan],'retry')
        if (rand(2)) f.lot(id, pool[rand(pool.length)], '2026-09-29', { 1: rand(2) })
      }
      const sql = await f.recomputeSql(id)
      const breakdown = await costs.getCatalogCostBreakdown(f.db, id)
      assert.equal(breakdown.result_usd, sql, `product ${id}`)
      const rows = breakdown.inputs
      const firstDepleted = rows.findIndex((row) => row.source === 'lot' && !(row.remaining_quantity > 0))
      if (firstDepleted >= 0) assert.ok(rows.slice(firstDepleted).every((row) => row.source === 'lot' && !(row.remaining_quantity > 0)), 'on-hand rows come first')
    }
  })

  console.log(`${checks} checks passed`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
