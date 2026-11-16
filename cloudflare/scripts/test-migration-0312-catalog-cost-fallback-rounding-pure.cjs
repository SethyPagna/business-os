'use strict'
// Companion for cloudflare/migrations/0312_catalog_cost_fallback_rounding.sql (cost-4dp lane).
//
// The sold-out fallback of the catalog-cost formula copied the newest lot's cost verbatim (1.00015 -> products.cost_price_usd = 1.00015).
// 0312 re-creates the six triggers with the fallback rounded to 4 places, nearest, half away from zero, like the weighted branch.
//   1. Text: migration = six drops + catalogCostReviewTriggersSql(); LF-only; no row write outside a trigger body; the 0256/0261 text stays
//      reachable as 'validated-unrounded' (recovery).
//   2. Behaviour on the migrated chain: ties and non-ties through the lot-insert trigger, control chain (before 0312) shows the leak.
//   3. Double apply: running 0312 twice leaves the same trigger text and the same stored figures.
//   4. Reversal: the recovery text restores the 0261 trigger bodies byte for byte; the leak returns (proves the pair is symmetric).
//   5. Pre-assertion aborts when a trigger is missing; the post-assertion aborts on the mutant (unrounded) text.
//   6. Parity: the JS cost breakdown shows the same rounded fallback as the SQL.
//   7. Branch 1 (on-hand weighted mean) is unchanged.
//
// Run (from cloudflare/): node scripts/test-migration-0312-catalog-cost-fallback-rounding-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')

const root = path.resolve(__dirname, '..')
const migrationsDir = path.join(root, 'migrations')
const MIGRATION = '0312_catalog_cost_fallback_rounding.sql'
const migrationText = fs.readFileSync(path.join(migrationsDir, MIGRATION), 'utf8')
const NAMES = ['catalog_cost_on_hand_stock_insert_0195', 'catalog_cost_on_hand_stock_update_0195', 'catalog_cost_on_hand_stock_delete_0195',
  'catalog_cost_on_hand_lot_insert_0195', 'catalog_cost_on_hand_lot_delete_0195', 'catalog_cost_review_lot_update_0255']

function loadTs(relative, cache = new Map()) {
  if (cache.has(relative)) return cache.get(relative)
  const mod = { exports: {} }
  cache.set(relative, mod.exports)
  const code = ts.transpileModule(fs.readFileSync(path.join(root, 'src', relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('module', 'exports', 'require', code)(mod, mod.exports, (id) => (id === './db' ? {} : id.startsWith('./') ? loadTs(`lib/${id.slice(2)}.ts`, cache) : require(id)))
  cache.set(relative, mod.exports)
  return mod.exports
}
const costs = loadTs('lib/catalogCostRecompute.ts')
const review = loadTs('lib/productCostReview.ts')
const GUARD = 'product_cost_review_update_guard_0255'

const files = (filter) => fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort().filter(filter)
const read = (f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8')
// A cost write needs the stock-transaction permit (0258 guards the cost columns); the Worker takes it per stock transaction. The test holds it
// for the whole run so the triggers' own writes are admitted; the migration under test does not insert or remove it.
const chainDb = (filter) => {
  const db = openDb(files(filter).map(read)).db
  db.exec("INSERT INTO system_flags (key, value, updated_at) SELECT 'stock_transaction_permit', value, CURRENT_TIMESTAMP FROM system_flags WHERE key = 'stock_schema_epoch'")
  return db
}
const triggerSql = (db) => Object.fromEntries([...NAMES, GUARD].map((n) => [n, db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(n).sql]))
const drops = NAMES.map((n) => `DROP TRIGGER IF EXISTS ${n};\n`).join('')
const guardDrop = `DROP TRIGGER IF EXISTS ${GUARD};\n`
const sqlOf = (db, name) => db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(name).sql

let id = 1000
// An active product holding nothing on hand whose newest lot costs `lotCost`: the sold-out fallback branch.
function soldOut(db, lotCost, { lots } = {}) {
  const pid = ++id
  db.prepare("INSERT INTO products(id, name, is_active, cost_price_usd, purchase_price_usd, name_key) VALUES (?, ?, 1, 9, 9, ?)").run(pid, `p${pid}`, `k${pid}`)
  const list = lots || [[lotCost, '2026-11-01']]
  for (const [cost, at] of list) {
    db.prepare("INSERT INTO product_batches(variant_product_id, batch_key, is_active, unit_cost_usd, received_at) VALUES (?, ?, 1, ?, ?)").run(pid, `b${id}-${at}-${cost}`, cost, at)
  }
  return pid
}
const stored = (db, pid) => { const r = db.prepare('SELECT cost_price_usd c, purchase_price_usd p FROM products WHERE id = ?').get(pid); return [r.c, r.p] }

// value -> exact 4-place result, half away from zero. Binary doubles that sit just under a decimal tie (1.00015) must still go up.
const CASES = [[1.00015, 1.0002], [1.00014, 1.0001], [1.23455, 1.2346], [1.23454, 1.2345], [0.00005, 0.0001], [0.00004, 0], [4.1666666666, 4.1667], [2.00005, 2.0001], [3.12345, 3.1235], [1.0001, 1.0001], [7, 7], [0.1, 0.1]]

async function main() {
  // ---- 1. text ---------------------------------------------------------------------------------------------------------------------------
  assert.ok(!migrationText.includes('\r'), 'LF-only (wrangler splits trigger bodies on /\\sEND[;\\s]$/)')
  assert.ok(migrationText.includes(guardDrop + review.productCostReviewConfirmationGuardSql() + drops + costs.catalogCostReviewTriggersSql()),
    'the migration carries the guard, the six drops and catalogCostReviewTriggersSql()')
  assert.ok(read('0257_product_cost_review_confirmation.sql').includes(review.productCostReviewConfirmationGuardSql({ inputPolicy: 'validated-unrounded' })),
    'recovery: the validated-unrounded guard is the 0257 text')
  assert.notEqual(review.productCostReviewConfirmationGuardSql(), review.productCostReviewConfirmationGuardSql({ inputPolicy: 'validated-unrounded' }))
  const triggerPart = migrationText.slice(migrationText.indexOf(guardDrop), migrationText.indexOf('\nSELECT CASE', migrationText.indexOf(guardDrop)))
  assert.ok(!triggerPart.includes('(SELECT pb.unit_cost_usd FROM product_batches pb'), 'no verbatim fallback in the new triggers')
  assert.notEqual(costs.catalogCostReviewTriggersSql(), costs.catalogCostReviewTriggersSql({ inputPolicy: 'validated-unrounded' }))
  assert.equal(costs.catalogCostReviewTriggersSql().replace(/CAST\(pb\.unit_cost_usd \* 10000\.0 \+ 0\.5 \+ 1e-8 AS INTEGER\) \/ 10000\.0/g, 'pb.unit_cost_usd'),
    costs.catalogCostReviewTriggersSql({ inputPolicy: 'validated-unrounded' }), 'the only difference is the fallback rounding')
  const outsideTriggers = migrationText.replace(/CREATE TRIGGER[\s\S]*?\nEND;/g, '').replace(/--[^\n]*/g, '')
  assert.ok(!/^\s*(INSERT|UPDATE|DELETE|CREATE\s+TABLE|ALTER)\b/im.test(outsideTriggers), 'no row write or table change outside trigger bodies')
  assert.equal((migrationText.replace(/--[^\n]*/g, '').match(/CREATE TRIGGER /g) || []).length, 7)

  // ---- 2. behaviour ----------------------------------------------------------------------------------------------------------------------
  const control = chainDb((f) => f < MIGRATION)
  const after = chainDb(() => true)
  for (const [lot, want] of CASES) {
    const c = soldOut(control, lot)
    const a = soldOut(after, lot)
    assert.deepEqual(stored(control, c), [lot, lot], `control: the verbatim fallback stores ${lot}`)
    assert.deepEqual(stored(after, a), [want, want], `fallback ${lot} -> ${want} in cost and mirror`)
  }
  // The newest lot decides, and the rounding applies to that lot only.
  const newest = soldOut(after, 0, { lots: [[1.00015, '2026-11-02'], [2.5, '2026-11-01']] })
  assert.deepEqual(stored(after, newest), [1.0002, 1.0002])
  // Every one of the six trigger events routes through the rounded text.
  const viaUpdate = soldOut(after, 1.5)
  after.prepare("UPDATE product_batches SET unit_cost_usd = 1.00015 WHERE variant_product_id = ?").run(viaUpdate)
  assert.deepEqual(stored(after, viaUpdate), [1.0002, 1.0002], 'lot update trigger (0255)')
  const viaDelete = soldOut(after, 9, { lots: [[1.00015, '2026-11-02'], [2.00005, '2026-11-03']] })
  assert.deepEqual(stored(after, viaDelete), [2.0001, 2.0001])
  after.prepare("DELETE FROM product_batches WHERE variant_product_id = ? AND unit_cost_usd = 2.00005").run(viaDelete)
  assert.deepEqual(stored(after, viaDelete), [1.0002, 1.0002], 'lot delete trigger')

  // ---- 7. branch 1 unchanged -------------------------------------------------------------------------------------------------------------
  const onHand = (db) => {
    const pid = soldOut(db, 0, { lots: [[1.0001, '2026-11-01'], [1.0002, '2026-11-02']] })
    db.prepare('INSERT OR IGNORE INTO branches(id, name, is_active) VALUES (1, ?, 1)').run('b1')
    for (const row of db.prepare('SELECT id FROM product_batches WHERE variant_product_id = ? ORDER BY id').all(pid)) {
      db.prepare('INSERT INTO branch_batch_stock(batch_id, branch_id, quantity) VALUES (?, 1, 1)').run(row.id)
    }
    return pid
  }
  assert.deepEqual(stored(after, onHand(after)), [1.0002, 1.0002], 'weighted mean of 1.0001 and 1.0002 is the tie 1.00015 -> 1.0002 (unchanged branch)')
  assert.deepEqual(stored(control, onHand(control)), stored(after, onHand(after)), 'branch 1 identical before and after 0312')

  // ---- guard: the review key clears on the rounded figure ------------------------------------------------------------------------------------
  const withKey = (db, pid) => {
    const guard = sqlOf(db, GUARD)
    db.exec(`DROP TRIGGER ${GUARD}`)
    db.prepare("UPDATE products SET cost_review_key = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1' WHERE id = ?").run(pid)
    db.exec(guard + ';')
  }
  const keyOf = (db, pid) => db.prepare('SELECT cost_review_key k FROM products WHERE id = ?').get(pid).k
  const g1 = soldOut(after, 1.5)
  withKey(after, g1)
  assert.equal(keyOf(after, g1), 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1')
  after.prepare('UPDATE product_batches SET unit_cost_usd = 1.00015 WHERE variant_product_id = ?').run(g1)
  assert.deepEqual(stored(after, g1), [1.0002, 1.0002])
  assert.equal(keyOf(after, g1), null, 'a recorded lot at the rounded figure clears the review key')
  const mixed = chainDb(() => true)
  mixed.exec(`DROP TRIGGER ${GUARD}; ${sqlOf(control, GUARD)};`)
  const g2 = soldOut(mixed, 1.5)
  withKey(mixed, g2)
  assert.throws(() => mixed.prepare('UPDATE product_batches SET unit_cost_usd = 1.00015 WHERE variant_product_id = ?').run(g2), /product_cost_review_write_refused/,
    'mutant: the new triggers with the old guard abort the stock write, which is why 0312 re-creates the guard')

  // ---- 3. double apply -------------------------------------------------------------------------------------------------------------------
  const twice = chainDb(() => true)
  const before = triggerSql(twice)
  twice.exec(migrationText)
  assert.deepEqual(triggerSql(twice), before, 'running 0312 again leaves the same trigger text')
  const t = soldOut(twice, 1.00015)
  assert.deepEqual(stored(twice, t), [1.0002, 1.0002])
  twice.prepare('UPDATE product_batches SET unit_cost_usd = unit_cost_usd WHERE variant_product_id = ?').run(t)
  assert.deepEqual(stored(twice, t), [1.0002, 1.0002], 'a second recompute of a rounded figure is a no-op')

  // ---- 4. reversal -----------------------------------------------------------------------------------------------------------------------
  const preTriggers = triggerSql(control)
  const reversed = chainDb(() => true)
  reversed.exec(guardDrop + review.productCostReviewConfirmationGuardSql({ inputPolicy: 'validated-unrounded' }) + drops
    + costs.catalogCostReviewTriggersSql({ inputPolicy: 'validated-unrounded' }))
  assert.deepEqual(triggerSql(reversed), preTriggers, 'recovery text restores the pre-0312 trigger bodies exactly')
  assert.deepEqual(stored(reversed, soldOut(reversed, 1.00015)), [1.00015, 1.00015], 'after the recovery the verbatim fallback is back')
  reversed.exec(migrationText)
  assert.deepEqual(stored(reversed, soldOut(reversed, 1.00015)), [1.0002, 1.0002], 're-applying 0312 after recovery rounds again')

  // ---- 5. assertions ---------------------------------------------------------------------------------------------------------------------
  const missing = chainDb((f) => f < MIGRATION)
  missing.exec('DROP TRIGGER catalog_cost_on_hand_lot_delete_0195')
  assert.throws(() => missing.exec(migrationText), /malformed JSON path|JSON/i, 'the PRE assertion aborts when a trigger is missing')
  assert.equal(missing.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name = 'catalog_cost_on_hand_stock_insert_0195'").get().n, 1, 'an aborted pre-check changes nothing')
  const mutantText = migrationText.replace(costs.catalogCostReviewTriggersSql(), costs.catalogCostReviewTriggersSql({ inputPolicy: 'validated-unrounded' }))
  assert.notEqual(mutantText, migrationText)
  assert.throws(() => chainDb((f) => f < MIGRATION).exec(mutantText), /malformed JSON path|JSON/i, 'the POST assertion aborts on a migration that keeps the verbatim fallback')

  // ---- 6. JS breakdown parity ------------------------------------------------------------------------------------------------------------
  for (const [lot, want] of CASES.filter(([v]) => v > 0)) {
    const breakdown = costs.buildCatalogCostBreakdown(1, { cost_price_usd: 9, cost_price_khr: null },
      [{ id: 1, is_active: 1, unit_cost_usd: lot, received_at: '2026-11-01', remaining_quantity: 0 }], [])
    assert.equal(breakdown.result_usd, want, `breakdown fallback ${lot} -> ${want}`)
    assert.equal(breakdown.mean_usd, want)
  }

  console.log('test-migration-0312-catalog-cost-fallback-rounding-pure: ok')
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
