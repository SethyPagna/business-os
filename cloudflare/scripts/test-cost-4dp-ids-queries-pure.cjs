'use strict'
// Companion for ops/queries/cost-4dp-ids-20261116.sql and cost-4dp-counts-20261116.sql (cost stored with more than 4 decimals).
//
// 1. Both files pass the Ops read-only guard (one SELECT) and run on the full migrated chain.
// 2. Each returns exact, hand-computed rows on a fixture covering every case it distinguishes: a long cost on each of the four product
//    columns, a clean 4-place cost, a text cost, float noise on a clean value, lots and manual entries over 4 places, stock held in the
//    product column versus branch_stock only, active versus inactive.
// 3. A mutant per query (a changed predicate, a dropped column filter) changes the result.
// 4. No personal column is selected (static token ban plus sentinels in every personal column), and no query writes.
//
// Run (from cloudflare/): node scripts/test-cost-4dp-ids-queries-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.resolve(__dirname, '../..')
const IDS = 'cost-4dp-ids-20261116'
const COUNTS = 'cost-4dp-counts-20261116'

async function main() {
  const guard = await import(pathToFileURL(path.join(root, 'ops/scripts/ops-sql-guard.mjs')))
  const q = {}
  for (const name of [IDS, COUNTS]) {
    const raw = fs.readFileSync(path.join(root, 'ops/queries', name + '.sql'), 'utf8')
    assert.ok(!raw.includes('\r'), `${name}: LF only`)
    const { sql } = guard.guardSql(raw)
    const loaded = guard.loadQuery(name)
    assert.equal(loaded.sql, sql)
    assert.ok(loaded.maxRowsRead > 0, `${name}: states a read ceiling`)
    q[name] = { raw, sql, loaded }
    const BANNED = ['phone', 'email', 'address', 'customer_name', 'customer_id', 'user_name', 'username', 'password', 'notes', 'barcode', 'sku', 'product_name', 'supplier', 'supplier_name', 'contact', 'brand', 'branch_name', 'lot_code', 'batch_key']
    const code = sql.replace(/'(?:[^']|'')*'/g, "''")
    for (const word of BANNED) assert.ok(!new RegExp(`\\b${word}\\b`, 'i').test(code), `${name}: mentions ${word}`)
    assert.ok(!/(?<![A-Za-z_.])(?:\w+\.)?name(?![A-Za-z_])/i.test(code), `${name}: bare name column`)
    // No helper table of an applied migration (it may be dropped in production): only live tables.
    assert.ok(!/_0\d{3}\b/.test(code), `${name}: reads a migration helper table`)
  }
  assert.equal(q[IDS].loaded.rules.minRows, 0)
  assert.equal(q[COUNTS].loaded.rules.minRows, 1)
  assert.equal(q[COUNTS].loaded.rules.maxRows, 1)

  const world = openDb(loadAll())
  const db = world.db
  const ex = (sql, ...a) => db.prepare(sql).run(...a)
  for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all()) db.exec(`DROP TRIGGER "${t.name}"`)
  db.exec('PRAGMA ignore_check_constraints = ON; DELETE FROM settings; DELETE FROM branches; DELETE FROM audit_logs; DELETE FROM product_batches; DELETE FROM product_cost_entries; DELETE FROM products;')
  ex("INSERT INTO branches(id, name, is_active) VALUES (1, 'BRANCH-SECRET-1', 1)")

  // id, active, stock, cost_usd, purchase_usd, cost_khr, purchase_khr, review key
  const P = [
    [1, 1, 5, 1.00015, 1.00015, 4100, 4100, null],                   // long cost and mirror, lots and entry over 4 places, in stock
    [2, 0, 0, 1.2333333333333334, 1.2333, null, null, 'K-1'],        // inactive, only the cost is long, no lots
    [3, 1, 0, 1.5, 2.00005, 6000, 6000, null],                       // clean cost, long mirror, stock held only in branch_stock
    [4, 1, 3, 1.2345, 1.2345, 4100.5, 4100.5, null],                 // clean: 4 places
    [5, 1, 1, 'abc', null, null, null, null],                        // text cost is not numeric: not returned
    [6, 1, 0, 2, 2, 4100.12345, 4100.1234, null],                    // long khr cost only
    [7, 1, 0, 1.0001, 1.0001, 4100, 4100.00001, null],               // long khr mirror only
    [8, 1, 2, 4.1667, 4.1667, 17000, 17000, null],                   // float noise on a clean value is not flagged
    [9, 1, 0, null, null, null, null, null],                         // no cost
  ]
  for (const p of P) {
    ex(`INSERT INTO products(id, name, is_active, stock_quantity, cost_price_usd, purchase_price_usd, cost_price_khr, purchase_price_khr,
        cost_review_key, name_key, updated_at, supplier, barcode, sku) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUPPLIER-SECRET', 'BARCODE-SECRET', 'SKU-SECRET')`,
    p[0], `NAME-SECRET-${p[0]}`, p[1], p[2], p[3], p[4], p[5], p[6], p[7], `k-${p[0]}`, `2026-11-0${p[0]}T00:00:00Z`)
  }
  ex('INSERT INTO branch_stock(product_id, branch_id, quantity) VALUES (3, 1, 4), (1, 1, 5), (9, 1, 0)')
  // lot id, product, active, unit cost, received cost
  const B = [[1, 1, 1, 1.00015, 1.00015], [2, 1, 1, 1, 1], [3, 1, 0, 2.5, 2.123456], [4, 3, 1, 1.5, 1.5], [5, 4, 1, 0, null], [6, 8, 1, 4.1667, 4.1667]]
  for (const b of B) {
    ex(`INSERT INTO product_batches(id, variant_product_id, batch_key, is_active, unit_cost_usd, received_cost_usd, lot_code, supplier_name, notes)
        VALUES (?, ?, ?, ?, ?, ?, 'LOT-SECRET', 'SUPPLIER-SECRET', 'NOTE-SECRET')`, b[0], b[1], `BATCHKEY-SECRET-${b[0]}`, b[2], b[3], b[4])
  }
  // entry id, product, cost usd, cost khr, previous
  const E = [[1, 1, 1.2333333, 5000.55555, 1.1], [2, 1, 1.25, 5000, 1.2333333], [3, 3, 2.00005, null, null], [4, 8, 4.1667, 17000, 4.1666]]
  for (const e of E) {
    ex(`INSERT INTO product_cost_entries(id, product_id, cost_usd, cost_khr, source, user_id, user_name, baseline_batch_id, created_at, previous_cost_usd)
        VALUES (?, ?, ?, ?, 'manual', 1, 'USER-SECRET', 0, '2026-11-01T00:00:00Z', ?)`, e[0], e[1], e[2], e[3], e[4])
  }
  // audit rows: product 1 has an older and a newer cost row; product 2 a merge-style row on its own id; product 3 only an unrelated action.
  const A = [
    [1, 'cost_override', 'product', '1', null, '{"cost_price_usd":1.5}'],
    [2, 'update', 'product', '1', '{"cost_price_usd":1.5}', '{"cost_price_usd":1.00015}'],
    [3, 'update', 'product', '1', '{"name":"x"}', '{"name":"y"}'],
    [4, 'catalog_cost_recompute_backfill', 'product', '2', 'not json', null],
    [5, 'update', 'product', '3', '{"selling_price_usd":1}', '{"selling_price_usd":2}'],
    [6, 'cost_override', 'product', '11', null, '{"cost_price_usd":9}'],
  ]
  for (const a of A) {
    ex(`INSERT INTO audit_logs(id, user_name, action, entity, entity_id, old_value, new_value, created_at, details)
        VALUES (?, 'USER-SECRET', ?, ?, ?, ?, ?, '2026-11-02T00:00:0${a[0]}Z', 'DETAILS-SECRET')`, a[0], a[1], a[2], a[3], a[4], a[5])
  }

  const run = (sql) => db.prepare(sql).all().map((r) => ({ ...r }))
  const changesBefore = db.prepare('SELECT total_changes() AS n').get().n

  // ---- the id query --------------------------------------------------------------------------------------------------------------------------
  const rows = run(q[IDS].sql)
  assert.deepEqual(rows.map((r) => r.id), [1, 2, 3, 6, 7], 'exactly the products with a long value in one of the four columns, in id order')
  const by = Object.fromEntries(rows.map((r) => [r.id, r]))

  assert.deepEqual(by[1], {
    id: 1, is_active: 1, stock_quantity: 5, branch_stock_units: 5, holds_stock: 1,
    cost_usd: 1.00015, purchase_usd: 1.00015, cost_khr: 4100, purchase_khr: 4100,
    cost_usd_over_4dp: 1, purchase_usd_over_4dp: 1, cost_khr_over_4dp: 0, purchase_khr_over_4dp: 0,
    in_review: 0, updated_at: '2026-11-01T00:00:00Z',
    lots: 3, active_costed_lots: 2, lots_over_4dp: 2, lot_costs_over_4dp: '3:2.5:2.123456 1:1.00015:1.00015',
    manual_entries: 2, entries_over_4dp: 1, last_manual_cost: 1.25,
    last_cost_audit_id: 2, last_cost_audit_action: 'update', last_cost_audit_at: '2026-11-02T00:00:02Z',
    audit_new_cost: 1.00015, audit_old_cost: 1.5,
  })
  assert.deepEqual(by[2], {
    id: 2, is_active: 0, stock_quantity: 0, branch_stock_units: null, holds_stock: 0,
    cost_usd: 1.2333333333333334, purchase_usd: 1.2333, cost_khr: null, purchase_khr: null,
    cost_usd_over_4dp: 1, purchase_usd_over_4dp: 0, cost_khr_over_4dp: 0, purchase_khr_over_4dp: 0,
    in_review: 1, updated_at: '2026-11-02T00:00:00Z',
    lots: 0, active_costed_lots: 0, lots_over_4dp: 0, lot_costs_over_4dp: null,
    manual_entries: 0, entries_over_4dp: 0, last_manual_cost: null,
    last_cost_audit_id: 4, last_cost_audit_action: 'catalog_cost_recompute_backfill', last_cost_audit_at: '2026-11-02T00:00:04Z',
    audit_new_cost: null, audit_old_cost: null,
  })
  assert.deepEqual(by[3], {
    id: 3, is_active: 1, stock_quantity: 0, branch_stock_units: 4, holds_stock: 1,
    cost_usd: 1.5, purchase_usd: 2.00005, cost_khr: 6000, purchase_khr: 6000,
    cost_usd_over_4dp: 0, purchase_usd_over_4dp: 1, cost_khr_over_4dp: 0, purchase_khr_over_4dp: 0,
    in_review: 0, updated_at: '2026-11-03T00:00:00Z',
    lots: 1, active_costed_lots: 1, lots_over_4dp: 0, lot_costs_over_4dp: null,
    manual_entries: 1, entries_over_4dp: 1, last_manual_cost: 2.00005,
    last_cost_audit_id: null, last_cost_audit_action: null, last_cost_audit_at: null, audit_new_cost: null, audit_old_cost: null,
  })
  assert.equal(by[6].cost_khr_over_4dp, 1)
  assert.equal(by[6].cost_usd_over_4dp, 0)
  assert.equal(by[6].purchase_khr_over_4dp, 0, '4100.1234 is a clean 4-place value')
  assert.equal(by[7].purchase_khr_over_4dp, 1)
  assert.equal(by[7].cost_khr_over_4dp, 0)
  for (const id of [4, 5, 8, 9]) assert.ok(!(id in by), `product ${id} is clean and must not be returned`)

  // ---- the counts query ----------------------------------------------------------------------------------------------------------------------
  const counts = run(q[COUNTS].sql)
  assert.equal(counts.length, 1)
  assert.deepEqual(counts[0], {
    products_total: 9, products_cost_usd_over_4dp: 2, products_purchase_usd_over_4dp: 2, products_cost_khr_over_4dp: 1, products_purchase_khr_over_4dp: 1,
    lots_total: 6, lots_unit_cost_over_4dp: 1, lots_received_cost_over_4dp: 2, active_lots_unit_cost_over_4dp: 1,
    cost_entries_total: 4, cost_entries_over_4dp: 2, cost_entries_khr_over_4dp: 1, cost_entries_previous_over_4dp: 1,
  })

  // ---- no write, no personal data --------------------------------------------------------------------------------------------------------------
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n, changesBefore, 'the queries write nothing')
  const dump = JSON.stringify([rows, counts])
  for (const s of ['SECRET']) assert.ok(!dump.includes(s), 'no sentinel personal value reaches a result')

  // ---- mutants: each changes the result ------------------------------------------------------------------------------------------------------
  const mutate = (name, from, to) => {
    assert.ok(q[name].sql.includes(from), `mutant anchor present: ${from}`)
    return run(q[name].sql.split(from).join(to))
  }
  assert.notDeepEqual(mutate(IDS, '> 0.000001', '> 0.5').map((r) => r.id), [1, 2, 3, 6, 7], 'threshold mutant (ids)')
  assert.notDeepEqual(mutate(IDS, "typeof(cost_price_usd) IN ('integer', 'real') AND ABS(cost_price_usd", "typeof(cost_price_usd) IN ('integer', 'real') AND 0 AND ABS(cost_price_usd").map((r) => r.id), [1, 2, 3, 6, 7], 'dropping the cost column (ids)')
  assert.notDeepEqual(mutate(IDS, "OR (typeof(purchase_price_khr)", "OR (0 AND typeof(purchase_price_khr)").map((r) => r.id), [1, 2, 3, 6, 7], 'dropping the khr mirror (ids)')
  assert.notDeepEqual(mutate(IDS, 'AND b.is_active = 1 AND b.unit_cost_usd > 0', 'AND b.unit_cost_usd > 0').find((r) => r.id === 1).active_costed_lots, 2, 'active-lot mutant')
  assert.notDeepEqual(mutate(IDS, 'ORDER BY b.id DESC LIMIT 6', 'ORDER BY b.id ASC LIMIT 6').find((r) => r.id === 1).lot_costs_over_4dp, by[1].lot_costs_over_4dp, 'lot order mutant')
  assert.notDeepEqual(mutate(COUNTS, '> 0.000001', '> 0.5')[0], counts[0], 'threshold mutant (counts)')
  assert.notEqual(mutate(COUNTS, 'WHEN typeof(received_cost_usd)', 'WHEN 0 AND typeof(received_cost_usd)')[0].lots_received_cost_over_4dp, 2, 'lot column mutant (counts)')
  assert.notEqual(mutate(COUNTS, 'WHEN typeof(cost_usd)', 'WHEN 0 AND typeof(cost_usd)')[0].cost_entries_over_4dp, 2, 'cost-entry mutant (counts)')

  console.log('test-cost-4dp-ids-queries-pure: ok')
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
