// Companion for cloudflare/migrations/0195_catalog_cost_on_hand.sql (U-cost,
// owner rulings 2026-09-25: the catalog cost is the QUANTITY-WEIGHTED cost of
// the stock on hand; a 0 unit cost means "not recorded"; nothing on hand ->
// the newest received lot with a recorded cost; triggers + a one-time repair
// with a backup first and a byte-exact recovery).
//
// Real migrated SQLite (node:sqlite through harness/d1compat.cjs), the real
// lib/catalogCostRecompute.ts. Every fixture distinguishes the new rule from
// the old distinct-cost mean, and each transition is checked for double-apply
// and reversal:
//   1. The migration text IS the lib's generators (formula drift fails here),
//      LF-only, backup before any UPDATE, five triggers installed.
//   2. The repair on a pre-0195 database: backs up EVERY product, rewrites
//      only the two cost columns of stale ACTIVE rows (every other column of
//      every product byte-identical), leaves sale line snapshots alone, bumps
//      the revision and the D1 cache version.
//   3. The RECOVERY block in the migration header, executed verbatim after the
//      migration AND later trigger writes, puts every product's two cost
//      columns back byte-identical (value and storage type).
//   4. Sale, return restock, transfer and adjustment statement shapes (copied
//      from their writers) keep the weighted figure with no app code at all.
//   5. D1 work, triggers on vs off.
//   6. Parity: on 300 randomized histories (quantities, 0-cost lots, manual
//      overrides, rounding ties) the trigger-kept figure equals
//      CATALOG_COST_DERIVE_SQL and the JS breakdown -- and an UNWEIGHTED mean
//      run through the same comparison fails (the control).
//   7. Backup-restore mode stands the triggers down.
//
// Run (from cloudflare/): node scripts/test-migration-0195-on-hand-cost-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')

const src = path.resolve(__dirname, '../src')
const migrationsDir = path.resolve(__dirname, '../migrations')
const MIGRATION = '0195_catalog_cost_on_hand.sql'
const migrationText = fs.readFileSync(path.join(migrationsDir, MIGRATION), 'utf8')
const TRIGGERS = [
  'catalog_cost_on_hand_lot_delete_0195', 'catalog_cost_on_hand_lot_insert_0195',
  'catalog_cost_on_hand_stock_delete_0195', 'catalog_cost_on_hand_stock_insert_0195', 'catalog_cost_on_hand_stock_update_0195',
]

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
const money = loadTs('lib/moneyPrecision.ts')

function migrationFiles({ through } = {}) {
  return fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
    .filter((f) => through == null || Number(f.slice(0, 4)) <= through)
    .map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
}

function libDb(d1) {
  return {
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

function world(d1) {
  const raw = d1.db
  let seq = 0
  const product = (storedCost = 99) => Number(raw.prepare(
    'INSERT INTO products(name, cost_price_usd, purchase_price_usd, cost_price_khr, is_active) VALUES (?, ?, ?, 0, 1)',
  ).run(`P${++seq}`, storedCost, storedCost).lastInsertRowid)
  const lot = (productId, cost, receivedAt, quantities = {}) => {
    const id = Number(raw.prepare(
      'INSERT INTO product_batches(variant_product_id, batch_key, is_active, unit_cost_usd, received_at) VALUES (?, ?, 1, ?, ?)',
    ).run(productId, `k${++seq}`, cost, receivedAt).lastInsertRowid)
    for (const [branchId, quantity] of Object.entries(quantities)) {
      raw.prepare('INSERT INTO branch_batch_stock(batch_id, branch_id, quantity) VALUES (?, ?, ?)').run(id, Number(branchId), quantity)
    }
    return id
  }
  // A manual cost edit as routes/products.ts records it (planManualCostEntry's
  // baseline), followed by the app's own recompute.
  const manual = async (productId, cost) => {
    raw.prepare(`INSERT INTO product_cost_entries(product_id, cost_usd, source, baseline_batch_id)
      VALUES (?, ?, 'manual', (SELECT COALESCE(MAX(id), 0) FROM product_batches WHERE variant_product_id = ?))`).run(productId, cost, productId)
    await costs.recomputeCatalogCost(libDb(d1), productId)
  }
  const stored = (productId) => raw.prepare('SELECT cost_price_usd c, purchase_price_usd p, updated_at u FROM products WHERE id = ?').get(productId)
  const derived = (productId) => raw.prepare(`SELECT COALESCE(${costs.CATALOG_COST_DERIVE_SQL}, cost_price_usd) d FROM products WHERE id = ?`).get(productId).d
  const revision = (productId) => raw.prepare("SELECT revision r FROM stock_session_revisions WHERE entity_type = 'product' AND entity_key = ?").get(String(productId))?.r ?? 0
  const writes = () => Number(raw.prepare('SELECT total_changes() n').get().n)
  const run = (sql, params = {}) => d1.prepare(sql).run(params)
  return { d1, raw, product, lot, manual, stored, derived, revision, writes, run }
}
const fresh = () => world(openDb(migrationFiles({ through: 240 })))
const recoverySql = () => migrationText.split('\n-- Statements:\n')[1].split('\n-- The backup table')[0]
  .split('\n').filter((l) => l.startsWith('--   ')).map((l) => l.slice(5)).join('\n')
// Every column of every product, cost columns with their storage type.
const snapshot = (raw, { costsOnly = false, withoutCosts = false } = {}) => raw.prepare('SELECT * FROM products ORDER BY id').all().map((row) => {
  const out = {}
  for (const [key, value] of Object.entries(row)) {
    const isCost = key === 'cost_price_usd' || key === 'purchase_price_usd'
    if ((costsOnly && !isCost && key !== 'id') || (withoutCosts && isCost)) continue
    out[key] = value
  }
  if (!withoutCosts) {
    const t = raw.prepare('SELECT typeof(cost_price_usd) a, typeof(purchase_price_usd) b FROM products WHERE id = ?').get(row.id)
    out.types = `${t.a}/${t.b}`
  }
  return out
})
// Object.is per value: -0/+0 and every bit of the double count.
function assertIdentical(actual, expected, message) {
  assert.equal(actual.length, expected.length, message)
  for (let i = 0; i < expected.length; i++) {
    for (const key of Object.keys(expected[i])) {
      assert.ok(Object.is(actual[i][key], expected[i][key]), `${message}: product ${expected[i].id} ${key} ${String(actual[i][key])} vs ${String(expected[i][key])}`)
    }
  }
}

// Statement shapes copied from the writers that move on-hand lot quantity.
const SALE_DEDUCT = "UPDATE branch_batch_stock SET quantity = MAX(0, quantity - @quantity), updated_at = datetime('now') WHERE batch_id = @batch AND branch_id = @branch" // lib/productBatches.ts
const RETURN_RESTOCK = 'INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(@batch,@branch,@quantity) ON CONFLICT(batch_id,branch_id) DO UPDATE SET quantity=quantity+@quantity,updated_at=CURRENT_TIMESTAMP' // lib/returnBulkAction.ts
const TRANSFER_OUT = 'UPDATE branch_batch_stock SET quantity=quantity-@quantity,updated_at=CURRENT_TIMESTAMP WHERE batch_id=@batch AND branch_id=@branch' // lib/transferOperation.ts
const TRANSFER_IN = 'INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(@batch,@branch,@quantity) ON CONFLICT(batch_id,branch_id) DO UPDATE SET quantity=quantity+excluded.quantity,updated_at=CURRENT_TIMESTAMP' // lib/transferOperation.ts
const ADJUST_SET_ZERO = 'UPDATE branch_batch_stock SET quantity=0,updated_at=CURRENT_TIMESTAMP WHERE batch_id=@batch AND branch_id=@branch' // lib/stockLotAdjustment.ts
const ADJUST_DELETE = 'DELETE FROM branch_batch_stock WHERE batch_id=@batch AND branch_id=@branch' // lib/stockLotAdjustment.ts

async function main() {
  await check('migration text is the lib generators, LF-only, backup before any UPDATE, five triggers', async () => {
    assert.ok(!migrationText.includes('\r'), 'LF-only (wrangler splits trigger bodies on /\\sEND[;\\s]$/)')
    const squash = (s) => s.replace(/--[^\n]*\n/g, '\n').replace(/\s+/g, ' ').trim()
    const body = squash(migrationText)
    const repair = squash(costs.catalogCostRepairAllSql())
    assert.ok(body.includes(repair), 'the repair is catalogCostRepairAllSql()')
    assert.ok(body.endsWith(squash(costs.catalogCostOnHandTriggerSql())), 'the triggers are catalogCostOnHandTriggerSql()')
    assert.ok(migrationText.includes('test-migration-0195-on-hand-cost-pure.cjs'), 'the header names this file')
    const firstUpdate = body.search(/\bUPDATE\b/)
    assert.ok(body.indexOf('INSERT INTO catalog_cost_repair_0195_backup') < firstUpdate, 'the backup is written before any UPDATE')
    assert.ok(!/updated_at/.test(repair), 'the repair writes only the two cost columns')
    assert.match(repair, /^UPDATE products SET cost_price_usd = .* purchase_price_usd = .* WHERE is_active = 1 AND /)
    const f = fresh()
    assert.deepEqual(f.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'catalog_cost_on_hand_%_0195' ORDER BY name").all().map((r) => r.name), TRIGGERS)
  })

  await check('repair: backs up every product, rewrites only the two cost columns of stale active rows', async () => {
    const f = world(openDb(migrationFiles({ through: 194 })))
    // The owner's example: 2 left at 12.00, 8 left at 12.50 -> 12.40 (the
    // distinct mean it was stored under says 12.25).
    const owner = f.product(12.25); f.lot(owner, 12, '2026-09-01', { 1: 2 }); f.lot(owner, 12.5, '2026-09-10', { 1: 5, 2: 3 })
    const kiko = f.product(12.25); f.lot(kiko, 12, '2026-09-01', { 1: 0 }); f.lot(kiko, 12.5, '2026-09-10', { 1: 15 })
    const right = f.product(7); f.lot(right, 7, '2026-09-02', { 1: 2 })
    const noLots = f.product(5)
    const soldOut = f.product(12); f.lot(soldOut, 13, '2026-09-20', { 1: 0 }); f.lot(soldOut, 11, '2026-09-01', { 1: 0 })
    // 0 = "not recorded": out of both sums (an unweighted-with-zero mean says 5).
    const zeroLot = f.product(5); f.lot(zeroLot, 0, '2026-09-05', { 1: 5 }); f.lot(zeroLot, 10, '2026-09-01', { 1: 5 })
    // Every on-hand lot is 0-cost: the newest received lot WITH a cost stands in.
    const allZero = f.product(1); f.lot(allZero, 0, '2026-09-22', { 1: 3 }); f.lot(allZero, 9, '2026-09-12', { 1: 0 }); f.lot(allZero, 8, '2026-09-02', { 1: 0 })
    const removed = f.product(3); f.lot(removed, 9, '2026-09-03', { 1: 4 }) // stale but inactive: frozen history
    // Cost right, mirror stale: the repair (and every re-derive) fixes the mirror too.
    const mirror = f.product(7); f.lot(mirror, 7, '2026-09-02', { 1: 2 })
    f.raw.prepare('UPDATE products SET purchase_price_usd = 0 WHERE id = ?').run(mirror)
    f.raw.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run(removed)
    f.raw.prepare("UPDATE products SET updated_at = '2026-01-01 00:00:00'").run()
    f.raw.prepare('INSERT INTO sale_items(sale_id, product_id, quantity, cost_price_usd) VALUES (1, ?, 1, 12.25)').run(owner)
    f.raw.prepare("INSERT INTO cache_versions(namespace, version) VALUES ('products', 7)").run()
    const ids = [owner, kiko, right, noLots, soldOut, zeroLot, allZero, removed, mirror]
    const rev = Object.fromEntries(ids.map((id) => [id, f.revision(id)]))
    const before = snapshot(f.raw)
    const staleBefore = f.raw.prepare(`SELECT COUNT(*) n FROM products WHERE is_active = 1 AND EXISTS (SELECT 1 FROM (SELECT ${costs.CATALOG_COST_DERIVE_SQL} AS derived) d WHERE d.derived IS NOT NULL AND (products.cost_price_usd IS NOT d.derived OR products.purchase_price_usd IS NOT d.derived))`).get().n
    assert.equal(staleBefore, 6, 'PRE: C = the six stale ACTIVE rows (one only in the mirror column)')

    f.raw.exec(migrationText)
    assertIdentical(f.raw.prepare('SELECT product_id id, cost_price_usd, purchase_price_usd FROM catalog_cost_repair_0195_backup ORDER BY product_id').all(),
      before.map(({ id, cost_price_usd, purchase_price_usd }) => ({ id, cost_price_usd, purchase_price_usd })), 'POST: the backup holds every product\'s pre-repair figures')
    assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM catalog_cost_repair_0195_backup WHERE repaired_cost_price_usd IS NOT NULL').get().n, 6, 'POST: C rows repaired')
    assert.deepEqual([f.stored(mirror).c, f.stored(mirror).p], [7, 7], 'a stale mirror alone is repaired')
    assert.deepEqual([f.stored(owner).c, f.stored(owner).p], [12.4, 12.4], 'owner example: (2 x 12 + 8 x 12.5) / 10, mirror too')
    assert.equal(f.stored(kiko).c, 12.5, 'sold-out lot out of the average')
    assert.equal(f.stored(soldOut).c, 13, 'sold out: most recently RECEIVED lot')
    assert.equal(f.stored(zeroLot).c, 10, 'a 0-cost lot is out of numerator AND denominator')
    assert.equal(f.stored(allZero).c, 9, 'all on-hand lots 0-cost: newest received lot with a cost')
    const withoutCosts = (rows) => rows.map(({ cost_price_usd, purchase_price_usd, types, ...rest }) => rest)
    assertIdentical(snapshot(f.raw, { withoutCosts: true }), withoutCosts(before), 'every non-cost column of every product (updated_at included) is byte-identical')
    for (const id of [right, noLots, removed]) assert.equal(f.revision(id), rev[id], `product ${id}: untouched, no revision`)
    assert.equal(f.stored(removed).c, 3, 'inactive row: never repaired')
    for (const id of [owner, kiko, soldOut, zeroLot, allZero, mirror]) assert.ok(f.revision(id) > rev[id], `product ${id}: repaired row bumps the product revision`)
    assert.equal(f.raw.prepare(`SELECT COUNT(*) n FROM products WHERE is_active = 1 AND EXISTS (SELECT 1 FROM (SELECT ${costs.CATALOG_COST_DERIVE_SQL} AS derived) d WHERE d.derived IS NOT NULL AND (products.cost_price_usd IS NOT d.derived OR products.purchase_price_usd IS NOT d.derived))`).get().n, 0, 'POST: no active row stale')
    assert.equal(f.raw.prepare('SELECT cost_price_usd c FROM sale_items').get().c, 12.25, 'sale snapshot untouched')
    assert.equal(f.raw.prepare("SELECT version v FROM cache_versions WHERE namespace = 'products'").get().v, 8)
  })

  await check('recovery: migration, then trigger writes, then the RECOVERY statements -> every product\'s two cost columns byte-identical', async () => {
    const f = world(openDb(migrationFiles({ through: 194 })))
    const odd = [12.25, null, 0, 0.1 + 0.2, 1 / 3, 7, 1e-9, 123456.789012, -0, 5e-324]
    const ids = []
    for (const [i, value] of odd.entries()) {
      const id = f.product(value)
      f.raw.prepare('UPDATE products SET purchase_price_usd = ? WHERE id = ?').run(i % 2 ? value : (value == null ? 4 : value * 3), id)
      if (i % 3 !== 2) { f.lot(id, 12, '2026-09-01', { 1: 2 }); f.lot(id, 12.5, '2026-09-10', { 1: 8 }) }
      ids.push(id)
    }
    const inactive = f.product(2.5); f.lot(inactive, 4, '2026-09-01', { 1: 1 }); f.raw.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run(inactive)
    const before = snapshot(f.raw, { costsOnly: true })
    f.raw.exec(migrationText)
    assert.ok(ids.some((id) => f.stored(id).c === 12.4), 'the migration did move rows')
    // Later traffic the triggers answer to, then the recovery.
    const lotOf = f.raw.prepare('SELECT MIN(id) id FROM product_batches WHERE variant_product_id = ?').get(ids[0]).id
    f.run(SALE_DEDUCT, { quantity: 1, batch: lotOf, branch: 1 })
    assert.equal(f.stored(ids[0]).c, 12.4444, 'a later sale re-derived the row')
    f.raw.exec(recoverySql())
    assertIdentical(snapshot(f.raw, { costsOnly: true }), before, 'recovery restores the pre-0195 cost columns exactly')
    assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'catalog_cost_on_hand_%_0195'").get().n, 0, 'recovery drops the triggers')
    f.run(SALE_DEDUCT, { quantity: 1, batch: lotOf, branch: 1 })
    assertIdentical(snapshot(f.raw, { costsOnly: true }), before, 'and nothing re-derives afterwards')
  })

  await check('sale, return, transfer and adjustment keep the weighted figure with no app code; double-apply and reversal exact', async () => {
    const f = fresh()
    const id = f.product(0)
    const a = f.lot(id, 12, '2026-09-01', { 1: 2 })
    const b = f.lot(id, 12.5, '2026-09-10', { 1: 8 })
    assert.equal(f.stored(id).c, 12.4, 'receipt: (2 x 12 + 8 x 12.5) / 10')

    f.run(SALE_DEDUCT, { quantity: 1, batch: a, branch: 1 })
    assert.deepEqual([f.stored(id).c, f.stored(id).p], [12.4444, 12.4444], 'sale of one from A: (12 + 100) / 9, mirror too')
    f.run(SALE_DEDUCT, { quantity: 1, batch: a, branch: 1 })
    assert.equal(f.stored(id).c, 12.5, 'the same sale applied twice: A empty, out of the average')
    const revEmpty = f.revision(id)
    f.run(SALE_DEDUCT, { quantity: 1, batch: a, branch: 1 })
    assert.deepEqual([f.stored(id).c, f.revision(id)], [12.5, revEmpty], 'a third apply on an empty lot moves nothing, writes nothing')
    await costs.recomputeCatalogCost(libDb(f.d1), id)
    assert.deepEqual([f.stored(id).c, f.revision(id)], [12.5, revEmpty], 'the app recompute agrees and writes nothing')

    f.run(RETURN_RESTOCK, { quantity: 1, batch: a, branch: 1 })
    assert.equal(f.stored(id).c, 12.4444, 'return restock reverses the second sale exactly')

    const revBeforeTransfer = f.revision(id)
    await f.d1.batch([
      { sql: TRANSFER_OUT, params: { quantity: 3, batch: b, branch: 1 } },
      { sql: TRANSFER_IN, params: { quantity: 3, batch: b, branch: 2 } },
    ])
    assert.equal(f.stored(id).c, 12.4444, 'transfer: totals per lot unchanged, figure unchanged')
    assert.ok(f.revision(id) - revBeforeTransfer <= 2, 'transfer: at most the transient debit/credit pair of writes')

    f.run(ADJUST_SET_ZERO, { batch: b, branch: 2 })
    assert.equal(f.stored(id).c, 12.4167, 'adjust set-to-0 at branch 2: (12 + 5 x 12.5) / 6')
    f.run(ADJUST_DELETE, { batch: b, branch: 1 })
    assert.equal(f.stored(id).c, 12, 'adjust delete: only A on hand')
    f.run(ADJUST_SET_ZERO, { batch: a, branch: 1 })
    assert.equal(f.stored(id).c, 12.5, 'nothing on hand: newest RECEIVED lot (B) stands in')
    f.run(RETURN_RESTOCK, { quantity: 8, batch: b, branch: 1 })
    f.run(RETURN_RESTOCK, { quantity: 2, batch: a, branch: 1 })
    assert.equal(f.stored(id).c, 12.4, 'both restored: back to the first figure')

    const zero = f.lot(id, 0, '2026-09-20', { 1: 90 })
    assert.equal(f.stored(id).c, 12.4, 'a 0-cost (unrecorded) lot, however large, does not move the figure')
    f.run(SALE_DEDUCT, { quantity: 90, batch: zero, branch: 1 })
    assert.equal(f.stored(id).c, 12.4)

    // Product remove deactivates the row, then zeroes its lots; its undo compares
    // the row column for column, so the triggers must leave an inactive row alone.
    f.raw.prepare('UPDATE products SET is_active = 0, updated_at = ? WHERE id = ?').run('2026-01-02 00:00:00', id)
    const revRemoved = f.revision(id)
    f.run(ADJUST_SET_ZERO, { batch: a, branch: 1 }); f.run(ADJUST_SET_ZERO, { batch: b, branch: 1 })
    f.lot(id, 50, '2026-09-24', { 1: 1 })
    assert.deepEqual([f.stored(id).c, f.stored(id).u, f.revision(id)], [12.4, '2026-01-02 00:00:00', revRemoved], 'inactive product: triggers never write it')
  })

  await check('manual override keeps its baseline: the lots it re-priced count at its cost, later lots at their own', async () => {
    const f = fresh()
    const id = f.product(0)
    const a = f.lot(id, 3, '2026-09-01', { 1: 2 })
    f.lot(id, 5, '2026-09-02', { 1: 2 })
    assert.equal(f.stored(id).c, 4)
    await f.manual(id, 10)
    assert.equal(f.stored(id).c, 10, 'override: the four units on hand now cost 10')
    const c = f.lot(id, 12, '2026-09-03', { 1: 1 })
    assert.equal(f.stored(id).c, 10.4, 'later lot joins by quantity: (4 x 10 + 1 x 12) / 5')
    f.run(SALE_DEDUCT, { quantity: 2, batch: a, branch: 1 })
    assert.equal(f.stored(id).c, 10.6667, 'selling re-priced stock re-weights: (2 x 10 + 12) / 3')
    f.run(RETURN_RESTOCK, { quantity: 2, batch: a, branch: 1 })
    assert.equal(f.stored(id).c, 10.4, 'and the return reverses it')
    f.run(ADJUST_SET_ZERO, { batch: a, branch: 1 }); f.run(ADJUST_SET_ZERO, { batch: a + 1, branch: 1 })
    assert.equal(f.stored(id).c, 12, 'every re-priced unit gone: the override prices nothing')
    f.run(SALE_DEDUCT, { quantity: 1, batch: c, branch: 1 })
    assert.equal(f.stored(id).c, 12, 'sold out: newest received lot after the baseline')
    const breakdown = await costs.getCatalogCostBreakdown(libDb(f.d1), id)
    assert.equal(breakdown.result_usd, 12)
    assert.equal(breakdown.inputs.find((row) => row.source === 'manual').excluded, 'depleted')
  })

  await check('D1 work: row changes with triggers on vs off', async () => {
    const measure = (withTriggers) => {
      const f = fresh()
      if (!withTriggers) for (const name of TRIGGERS) f.raw.exec(`DROP TRIGGER ${name}`)
      const single = f.product(12)
      const s = f.lot(single, 12, '2026-09-20', { 1: 5 })
      f.lot(single, 12, '2026-09-10', { 1: 3 })
      const mixed = f.product(12)
      const a = f.lot(mixed, 10, '2026-09-20', { 1: 5 })
      f.lot(mixed, 14, '2026-09-10', { 1: 3 })
      f.run(`UPDATE products SET cost_price_usd = 12, purchase_price_usd = 12 WHERE id IN (${single}, ${mixed})`)
      f.run(`UPDATE products SET cost_price_usd = ${f.derived(mixed)}, purchase_price_usd = ${f.derived(mixed)} WHERE id = ${mixed}`)
      const out = {}
      let before = f.writes(); f.run(SALE_DEDUCT, { quantity: 2, batch: s, branch: 1 }); out.singleCostSale = f.writes() - before
      before = f.writes(); f.run(SALE_DEDUCT, { quantity: 1, batch: a, branch: 1 }); out.mixedCostSale = f.writes() - before
      f.run(RETURN_RESTOCK, { quantity: 1, batch: a, branch: 2 })
      before = f.writes()
      f.run(TRANSFER_OUT, { quantity: 2, batch: a, branch: 1 }); f.run(TRANSFER_IN, { quantity: 2, batch: a, branch: 2 })
      out.mixedCostTransfer = f.writes() - before
      before = f.writes()
      f.run(TRANSFER_OUT, { quantity: 2, batch: s, branch: 1 }); f.run(TRANSFER_IN, { quantity: 2, batch: s, branch: 2 })
      out.singleCostTransfer = f.writes() - before
      return out
    }
    const on = measure(true)
    const off = measure(false)
    assert.equal(on.singleCostSale, off.singleCostSale, 'single-cost product: a sale adds zero writes')
    assert.equal(on.singleCostTransfer, off.singleCostTransfer, 'single-cost product: a transfer adds zero writes')
    assert.ok(on.mixedCostSale > off.mixedCostSale, 'mixed-cost product: a sale writes the product')
    console.log(`  measured row changes (sqlite total_changes, triggers on/off): single-cost sale ${on.singleCostSale}/${off.singleCostSale}, single-cost transfer ${on.singleCostTransfer}/${off.singleCostTransfer}, mixed-cost sale ${on.mixedCostSale}/${off.mixedCostSale} (extra ${on.mixedCostSale - off.mixedCostSale}), mixed-cost transfer ${on.mixedCostTransfer}/${off.mixedCostTransfer} (extra ${on.mixedCostTransfer - off.mixedCostTransfer})`)
  })

  await check('parity: on 300 randomized histories the trigger-kept figure equals the formula and the JS breakdown; an unweighted mean fails', async () => {
    const f = fresh()
    const db = libDb(f.d1)
    let seed = 195
    // mulberry32: an LCG's low bits cycle too fast for `% 2` to be random.
    const rand = (n) => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) % n }
    // 0 = unrecorded; 1.0001/1.0002 and 12.3456/12.3457 make exact half-way ties.
    const pool = [0, 0, 3, 5, 7.25, 12, 12.5, 13, 1.0001, 1.0002, 12.3456, 12.3457, 7.3333]
    // The control: what an unweighted (distinct on-hand cost) mean would store.
    const unweighted = (productId) => {
      const rows = f.raw.prepare(`SELECT DISTINCT pb.unit_cost_usd c FROM product_batches pb
        WHERE pb.variant_product_id = ? AND pb.is_active = 1 AND pb.unit_cost_usd > 0
          AND EXISTS (SELECT 1 FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0)
          AND NOT EXISTS (SELECT 1 FROM product_cost_entries WHERE product_id = pb.variant_product_id)`).all(productId)
      return rows.length ? money.meanMoney4(rows.map((r) => r.c)) : null
    }
    let crossings = 0, ties = 0, zeroOnHand = 0, zeroFallback = 0, overrides = 0, controlChecked = 0, controlFailures = 0
    for (let i = 0; i < 300; i++) {
      const id = f.product(rand(2) ? 99 : 0)
      const lots = []
      for (let step = 0, steps = 2 + rand(9); step < steps; step++) {
        const op = lots.length ? rand(8) : 0
        if (op === 0) lots.push(f.lot(id, pool[rand(pool.length)], `2026-09-${String(1 + rand(28)).padStart(2, '0')}`, rand(3) ? { [1 + rand(2)]: rand(7) } : {}))
        else if (op === 7) { if (rand(3) === 0) { await f.manual(id, pool[2 + rand(pool.length - 2)]); overrides++ } }
        else {
          const lotId = lots[rand(lots.length)]
          const branch = 1 + rand(2)
          const row = f.raw.prepare('SELECT quantity q FROM branch_batch_stock WHERE batch_id = ? AND branch_id = ?').get(lotId, branch)
          if (op === 1) f.run(RETURN_RESTOCK, { quantity: 1 + rand(4), batch: lotId, branch })
          else if (op === 2 && row) f.run(SALE_DEDUCT, { quantity: 1 + rand(3), batch: lotId, branch })
          else if (op === 3 && row && row.q > 0) await f.d1.batch([
            { sql: TRANSFER_OUT, params: { quantity: row.q, batch: lotId, branch } },
            { sql: TRANSFER_IN, params: { quantity: row.q, batch: lotId, branch: 3 - branch } },
          ])
          else if (op === 4 && row) f.run(ADJUST_SET_ZERO, { batch: lotId, branch })
          else if (op === 5 && row) f.run(ADJUST_DELETE, { batch: lotId, branch })
          else if (op === 6 && row) f.run(SALE_DEDUCT, { quantity: 1, batch: lotId, branch })
          if (row && row.q > 0) crossings++
        }
      }
      const kept = f.stored(id).c
      assert.equal(kept, f.derived(id), `product ${id}: trigger-kept figure == CATALOG_COST_DERIVE_SQL`)
      const breakdown = await costs.getCatalogCostBreakdown(db, id)
      assert.equal(breakdown.result_usd, kept, `product ${id}: JS breakdown`)
      const terms = breakdown.weighted_terms
      if (terms.length) {
        const exact = money.weightedMeanMoney4(terms.map((t) => ({ amount: t.cost_usd, factor: t.quantity })), terms.reduce((s, t) => s + t.quantity, 0))
        assert.equal(kept, exact, `product ${id}: weightedMeanMoney4 of the listed terms`)
        const units = terms.reduce((s, t) => s + t.quantity * Math.round(t.cost_usd * 10000), 0)
        const q = terms.reduce((s, t) => s + t.quantity, 0)
        if ((units * 2) % q === 0 && ((units * 2) / q) % 2 === 1) ties++
      }
      if (f.raw.prepare('SELECT COUNT(*) n FROM product_batches pb JOIN branch_batch_stock bbs ON bbs.batch_id = pb.id WHERE pb.variant_product_id = ? AND pb.unit_cost_usd = 0 AND bbs.quantity > 0').get(id).n) {
        zeroOnHand++
        if (!terms.length && breakdown.inputs.some((row) => row.fallback)) zeroFallback++
      }
      const control = unweighted(id)
      if (control !== null) { controlChecked++; if (control !== kept) controlFailures++ }
    }
    assert.ok(crossings > 200, `the histories exercise real crossings (${crossings})`)
    assert.ok(ties > 0, `the histories include exact half-way ties (${ties})`)
    assert.ok(zeroOnHand > 20, `the histories hold 0-cost lots on hand (${zeroOnHand})`)
    assert.ok(zeroFallback > 0, `some hold ONLY 0-cost stock and fall back to the newest costed lot (${zeroFallback})`)
    assert.ok(overrides > 20, `the histories include manual overrides (${overrides})`)
    assert.ok(controlFailures > 20, `CONTROL: an unweighted mean disagrees with the stored figure on ${controlFailures}/${controlChecked} products`)
    console.log(`  parity: 300 histories, ${crossings} crossings, ${ties} exact ties, ${zeroOnHand} with 0-cost stock (${zeroFallback} only-0-cost fallbacks), ${overrides} overrides; control: unweighted mean wrong on ${controlFailures}/${controlChecked}`)
  })

  await check('rounding: nearest 4dp, half away from zero, as weightedMeanMoney4 -- on exact half-way ties too', async () => {
    const f = fresh()
    const db = libDb(f.d1)
    for (const [lots, expected] of [
      [[[12.3456, 1], [12.3457, 1]], 12.3457], // 12.34565: SQLite ROUND() on this engine says 12.3456
      [[[1.0001, 1], [1.0002, 1]], 1.0002],
      [[[12, 2], [12.5, 8]], 12.4],
      [[[10, 1], [10.0001, 2]], 10.0001], // 10.0000666..: down
    ]) {
      const id = f.product(0)
      for (const [cost, quantity] of lots) f.lot(id, cost, '2026-09-01', { 1: quantity })
      const exact = money.weightedMeanMoney4(lots.map(([amount, factor]) => ({ amount, factor })), lots.reduce((s, [, q]) => s + q, 0))
      assert.equal(exact, expected, 'the kernel')
      assert.equal(f.stored(id).c, expected, `trigger-kept ${lots.map(([c, q]) => `${q} x ${c}`).join(' + ')}`)
      assert.equal((await costs.getCatalogCostBreakdown(db, id)).result_usd, expected, 'JS breakdown')
      assert.equal(f.derived(id), expected, 'CATALOG_COST_DERIVE_SQL')
    }
    assert.equal(f.raw.prepare('SELECT ROUND((12.3456 + 12.3457) / 2.0, 4) r').get().r, 12.3456, 'why HALF_UP_4DP exists: ROUND() rounds the binary double')
  })

  await check('backup-restore mode stands the triggers down; sale line snapshots are never rewritten', async () => {
    const f = fresh()
    const id = f.product(0)
    const b = f.lot(id, 12.5, '2026-09-10', { 1: 2 })
    f.lot(id, 12, '2026-09-01', { 1: 1 })
    assert.equal(f.stored(id).c, 12.3333, '(2 x 12.5 + 12) / 3')
    f.raw.prepare('INSERT INTO sale_items(sale_id, product_id, quantity, cost_price_usd) VALUES (1, ?, 1, 12.3333)').run(id)
    f.raw.prepare(`INSERT INTO system_flags(key, value) VALUES ('maintenance', '{"mode":"restore"}')`).run()
    f.run(ADJUST_SET_ZERO, { batch: b, branch: 1 })
    assert.equal(f.stored(id).c, 12.3333, 'restore writes rows verbatim')
    f.raw.prepare("DELETE FROM system_flags WHERE key = 'maintenance'").run()
    f.run(RETURN_RESTOCK, { quantity: 2, batch: b, branch: 1 })
    f.run(ADJUST_SET_ZERO, { batch: b, branch: 1 })
    assert.equal(f.stored(id).c, 12)
    assert.equal(f.raw.prepare('SELECT cost_price_usd c FROM sale_items WHERE product_id = ?').get(id).c, 12.3333)
  })

  console.log(`${checks} checks passed`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
