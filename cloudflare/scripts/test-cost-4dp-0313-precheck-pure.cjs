'use strict'
// Companion for ops/queries/cost-4dp-0313-precheck-20261117.sql: the read-only production pre-check for migration 0313_cost_4dp_repair.sql.
//
// 1. The file passes the Ops read-only guard (one SELECT), is LF-only, states a read ceiling, selects no personal column and reads no helper table.
// 2. On a fixture that includes one violating lot (an inactive lot with branch stock whose cost is over 4 decimals) it returns exact, hand-computed
//    numbers, and writes nothing (total_changes unchanged).
// 3. It agrees with the migration itself: on every scenario the query says pre_holds = 0, the PRE block of 0313 (the text before its first CREATE TABLE)
//    aborts, naming the check; when the query says pre_holds = 1 the PRE block runs clean. Scenarios: the violating lot, a clean fixture, a
//    maintenance flag, a foreign stock epoch, a value of 1e9 or more in a product, a lot and a cost entry, and each cap exceeded.
// 4. Mutants of the query (a dropped inactive filter, a dropped quantity filter, a dropped active filter, a changed cap) change the result.
//
// Run (from cloudflare/): node scripts/test-cost-4dp-0313-precheck-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.resolve(__dirname, '../..')
const NAME = 'cost-4dp-0313-precheck-20261117'

async function main() {
  const guard = await import(pathToFileURL(path.join(root, 'ops/scripts/ops-sql-guard.mjs')))
  const raw = fs.readFileSync(path.join(root, 'ops/queries', NAME + '.sql'), 'utf8')
  assert.ok(!raw.includes('\r'), 'LF only')
  const { sql } = guard.guardSql(raw)
  const loaded = guard.loadQuery(NAME)
  assert.equal(loaded.sql, sql)
  assert.ok(loaded.maxRowsRead > 0, 'states a read ceiling')
  assert.equal(loaded.rules.minRows, 1)
  assert.equal(loaded.rules.maxRows, 1)
  const BANNED = ['phone', 'email', 'address', 'customer_name', 'customer_id', 'user_name', 'username', 'password', 'notes', 'barcode', 'sku', 'product_name', 'supplier', 'supplier_name', 'contact', 'brand', 'branch_name', 'lot_code', 'batch_key']
  const code = sql.replace(/'(?:[^']|'')*'/g, "''")
  for (const word of BANNED) assert.ok(!new RegExp(`\\b${word}\\b`, 'i').test(code), `mentions ${word}`)
  assert.ok(!/(?<![A-Za-z_.])(?:\w+\.)?name(?![A-Za-z_])/i.test(code), 'bare name column')
  assert.ok(!/_0\d{3}\b/.test(code), 'reads a migration helper table')
  assert.equal((code.match(/;/g) || []).length, 0, 'one statement')
  assert.ok(!/\b(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|PRAGMA|ANALYZE|VACUUM)\b/i.test(code), 'no write or pragma keyword')

  const migration = fs.readFileSync(path.join(root, 'cloudflare/migrations/0313_cost_4dp_repair.sql'), 'utf8')
  const pre = migration.slice(0, migration.indexOf('CREATE TABLE IF NOT EXISTS cost_4dp_repair_0313'))
  assert.ok(pre.includes('cost_4dp_0313_pre_inactive_lot_holds_stock') && !pre.replace(/^--.*$/gm, '').includes('INSERT INTO'), 'the PRE block is the part before the first CREATE TABLE')

  const db = openDb(loadAll()).db
  const ex = (text, ...a) => db.prepare(text).run(...a)
  for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all()) db.exec(`DROP TRIGGER "${t.name}"`)
  db.exec('PRAGMA ignore_check_constraints = ON; DELETE FROM settings; DELETE FROM branches; DELETE FROM audit_logs; DELETE FROM product_batches; DELETE FROM product_cost_entries; DELETE FROM products;')
  db.exec("DELETE FROM system_flags WHERE key IN ('maintenance', 'stock_transaction_permit', 'stock_schema_epoch')")
  ex("INSERT INTO branches(id, name, is_active) VALUES (1, 'BRANCH-SECRET-1', 1)")

  // id, active, stock, cost_usd, purchase_usd, cost_khr, purchase_khr
  const P = [
    [1, 1, 5, 1.00015, 1.00015, 4100, 4100], [2, 0, 0, 1.2333333333333334, 1.2333, null, null], [3, 1, 0, 1.5, 2.00005, 6000, 6000],
    [4, 1, 3, 1.2345, 1.2345, 4100.5, 4100.5], [5, 1, 1, 'abc', null, null, null], [6, 1, 0, 2, 2, 4100.12345, 4100.1234],
    [7, 1, 0, 1.0001, 1.0001, 4100, 4100.00001], [8, 1, 2, 4.1667, 4.1667, 17000, 17000], [9, 1, 0, null, null, null, null],
  ]
  for (const p of P) {
    ex(`INSERT INTO products(id, name, is_active, stock_quantity, cost_price_usd, purchase_price_usd, cost_price_khr, purchase_price_khr, name_key, supplier, barcode, sku)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUPPLIER-SECRET', 'BARCODE-SECRET', 'SKU-SECRET')`, p[0], `NAME-SECRET-${p[0]}`, p[1], p[2], p[3], p[4], p[5], p[6], `k-${p[0]}`)
  }
  // lot id, product, active, unit cost, received cost
  const B = [
    [1, 1, 1, 1.00015, 1.00015],   // in scope, active, holds stock: fine
    [2, 1, 1, 1, 1],               // clean
    [3, 1, 0, 2.5, 2.123456],      // in scope, INACTIVE, holds stock: the violation
    [4, 3, 1, 1.5, 1.5],           // clean
    [5, 4, 1, 0, null],            // clean
    [6, 8, 1, 4.1667, 4.1667],     // clean
    [7, 2, 1, 3.33333, 3.3333],    // in scope, active lot of an INACTIVE product, no stock: counts as a lot, not a re-derive
    [8, 3, 0, 1.5, 1.5],           // clean, inactive, holds stock: not in scope, not a violation
  ]
  for (const b of B) {
    ex(`INSERT INTO product_batches(id, variant_product_id, batch_key, is_active, unit_cost_usd, received_cost_usd, lot_code, supplier_name, notes)
        VALUES (?, ?, ?, ?, ?, ?, 'LOT-SECRET', 'SUPPLIER-SECRET', 'NOTE-SECRET')`, b[0], b[1], `BATCHKEY-SECRET-${b[0]}`, b[2], b[3], b[4])
  }
  for (const [lot, qty] of [[1, 5], [3, 2], [8, 2], [2, 0]]) ex('INSERT INTO branch_batch_stock(batch_id, branch_id, quantity) VALUES (?, 1, ?)', lot, qty)
  // entry id, product, cost usd, cost khr, previous
  const E = [[1, 1, 1.2333333, 5000.55555, 1.1], [2, 1, 1.25, 5000, 1.2333333], [3, 3, 2.00005, null, null], [4, 8, 4.1667, 17000, 4.1666]]
  for (const e of E) {
    ex(`INSERT INTO product_cost_entries(id, product_id, cost_usd, cost_khr, source, user_id, user_name, baseline_batch_id, created_at, previous_cost_usd)
        VALUES (?, ?, ?, ?, 'manual', 1, 'USER-SECRET', 0, '2026-11-01T00:00:00Z', ?)`, e[0], e[1], e[2], e[3], e[4])
  }
  ex("INSERT INTO system_flags(key, value) VALUES ('stock_schema_epoch', 'legacy-separate-pool-v1')")

  const total = () => db.prepare('SELECT total_changes() AS n').get().n
  const run = (text = sql) => { const before = total(); const rows = db.prepare(text).all().map((r) => ({ ...r })); assert.equal(total(), before, 'the query writes nothing'); assert.equal(rows.length, 1); return rows[0] }
  // The PRE block of 0313 on the same data: null when it passes, else the name of the check that aborts.
  const migrationPre = () => {
    try { db.exec(pre); return null } catch (e) { const m = /cost_4dp_0313_[a-z0-9_]+/.exec(String(e.message)); assert.ok(m, 'PRE aborted with a named check: ' + e.message); return m[0] }
  }
  const scenario = (name, mutate, check) => {
    db.exec('SAVEPOINT scenario')
    try { mutate(); check(run(), migrationPre(), name) } finally { db.exec('ROLLBACK TO scenario; RELEASE scenario') }
  }
  const OK = { products_cap_ok: 1, lots_cap_ok: 1, entries_cap_ok: 1 }

  // ---- 1. the fixture with one violating lot ---------------------------------------------------------------------------------------------------
  const base = run()
  assert.equal(base.max_lot_or_entry_change > 0.00004 && base.max_lot_or_entry_change <= 0.00005 + 1e-9, true, 'ties 1.00015, 2.00005 and 5000.55555 each move by half a tick')
  assert.deepEqual({ ...base, max_lot_or_entry_change: 0 }, {
    products_to_round: 5, lots_to_round: 3, entries_to_round: 3, inactive_lots_holding_stock: 1, active_products_to_rederive: 2,
    products_cap: 500, products_cap_ok: 1, lots_cap: 5000, lots_cap_ok: 1, entries_cap: 5000, entries_cap_ok: 1,
    products_value_out_of_range: 0, lots_value_out_of_range: 0, entries_value_out_of_range: 0,
    max_lot_or_entry_change: 0, change_cap_ok: 1, blocking_flags: 0, epoch_ok: 1, pre_holds: 0,
  }, 'exact numbers on the fixture: products 1,2,3,6,7; lots 1,3,7; entries 1,2,3; lot 3 violates; products 1 and 3 re-derive (2 is inactive)')
  assert.equal(migrationPre(), 'cost_4dp_0313_pre_inactive_lot_holds_stock', '0313 itself refuses this database for the same reason')

  // ---- 2. the same database once the violating lot no longer holds stock -----------------------------------------------------------------------
  scenario('violation cleared', () => ex('UPDATE branch_batch_stock SET quantity = 0 WHERE batch_id = 3'), (r, pre, name) => {
    assert.equal(r.inactive_lots_holding_stock, 0, name)
    assert.equal(r.pre_holds, 1, name)
    assert.equal(pre, null, name + ': the PRE block of 0313 passes')
    assert.equal(r.lots_to_round, 3, name + ': the lot is still rounded, only the hold is gone')
  })
  // an active in-scope lot that holds stock never violates; deactivating an in-scope lot with stock does
  scenario('lot 1 deactivated', () => { ex('UPDATE branch_batch_stock SET quantity = 0 WHERE batch_id = 3'); ex('UPDATE product_batches SET is_active = 0 WHERE id = 1') }, (r, pre, name) => {
    assert.equal(r.inactive_lots_holding_stock, 1, name); assert.equal(r.pre_holds, 0, name); assert.equal(pre, 'cost_4dp_0313_pre_inactive_lot_holds_stock', name)
  })

  // ---- 3. every other PRE condition, each against the migration's own check --------------------------------------------------------------------
  const clean = () => ex('UPDATE branch_batch_stock SET quantity = 0 WHERE batch_id = 3')
  scenario('maintenance flag', () => { clean(); ex("INSERT INTO system_flags(key, value) VALUES ('maintenance', '{}')") }, (r, pre, name) => {
    assert.equal(r.blocking_flags, 1, name); assert.equal(r.pre_holds, 0, name); assert.equal(pre, 'cost_4dp_0313_pre_state', name) })
  scenario('permit flag', () => { clean(); ex("INSERT INTO system_flags(key, value) VALUES ('stock_transaction_permit', 'x')") }, (r, pre, name) => {
    assert.equal(r.blocking_flags, 1, name); assert.equal(r.pre_holds, 0, name); assert.equal(pre, 'cost_4dp_0313_pre_state', name) })
  scenario('foreign epoch', () => { clean(); ex("UPDATE system_flags SET value = 'other' WHERE key = 'stock_schema_epoch'") }, (r, pre, name) => {
    assert.equal(r.epoch_ok, 0, name); assert.equal(r.pre_holds, 0, name); assert.equal(pre, 'cost_4dp_0313_pre_state', name) })
  scenario('no epoch row is fine', () => { clean(); ex("DELETE FROM system_flags WHERE key = 'stock_schema_epoch'") }, (r, pre, name) => {
    assert.equal(r.epoch_ok, 1, name); assert.equal(r.pre_holds, 1, name); assert.equal(pre, null, name) })
  scenario('product value out of range', () => { clean(); ex('UPDATE products SET cost_price_usd = 1234567890.12345 WHERE id = 6') }, (r, pre, name) => {
    assert.equal(r.products_value_out_of_range, 1, name); assert.equal(r.pre_holds, 0, name); assert.equal(pre, 'cost_4dp_0313_pre_products_value_out_of_range', name) })
  scenario('lot value out of range', () => { clean(); ex('UPDATE product_batches SET unit_cost_usd = 1234567890.12345 WHERE id = 7') }, (r, pre, name) => {
    assert.equal(r.lots_value_out_of_range, 1, name); assert.equal(r.pre_holds, 0, name); assert.equal(pre, 'cost_4dp_0313_pre_product_batches_value_out_of_range', name) })
  scenario('entry value out of range', () => { clean(); ex('UPDATE product_cost_entries SET cost_khr = 1234567890.12345 WHERE id = 1') }, (r, pre, name) => {
    assert.equal(r.entries_value_out_of_range, 1, name); assert.equal(r.pre_holds, 0, name); assert.equal(pre, 'cost_4dp_0313_pre_product_cost_entries_value_out_of_range', name) })
  scenario('a long value below 1e9 is in range', () => { clean(); ex('UPDATE products SET cost_price_usd = 999999999.12345 WHERE id = 6') }, (r, pre, name) => {
    assert.equal(r.products_value_out_of_range, 0, name); assert.equal(r.pre_holds, 1, name); assert.equal(pre, null, name) })
  scenario('products over the cap', () => {
    clean()
    ex('WITH RECURSIVE n(i) AS (SELECT 100 UNION ALL SELECT i + 1 FROM n WHERE i < 599) INSERT INTO products(id, name, is_active, stock_quantity, cost_price_usd, name_key) SELECT i, \'p\', 1, 0, 1.00015, \'kk-\' || i FROM n')
  }, (r, pre, name) => {
    assert.equal(r.products_to_round, 505, name); assert.equal(r.products_cap_ok, 0, name); assert.equal(r.pre_holds, 0, name); assert.equal(pre, 'cost_4dp_0313_pre_products_scope_over_500', name) })
  scenario('products exactly at the cap', () => {
    clean()
    ex('WITH RECURSIVE n(i) AS (SELECT 100 UNION ALL SELECT i + 1 FROM n WHERE i < 594) INSERT INTO products(id, name, is_active, stock_quantity, cost_price_usd, name_key) SELECT i, \'p\', 1, 0, 1.00015, \'kk-\' || i FROM n')
  }, (r, pre, name) => {
    assert.equal(r.products_to_round, 500, name); assert.equal(r.products_cap_ok, 1, name); assert.equal(r.pre_holds, 1, name); assert.equal(pre, null, name) })
  scenario('lots over the cap', () => {
    clean()
    ex('WITH RECURSIVE n(i) AS (SELECT 100 UNION ALL SELECT i + 1 FROM n WHERE i < 5099) INSERT INTO product_batches(id, variant_product_id, batch_key, is_active, unit_cost_usd, received_cost_usd) SELECT i, 4, \'bk-\' || i, 1, 1.00015, 1 FROM n')
  }, (r, pre, name) => {
    assert.equal(r.lots_to_round, 5003, name); assert.equal(r.lots_cap_ok, 0, name); assert.equal(r.pre_holds, 0, name); assert.equal(pre, 'cost_4dp_0313_pre_product_batches_scope_over_5000', name) })
  scenario('entries over the cap', () => {
    clean()
    ex('WITH RECURSIVE n(i) AS (SELECT 100 UNION ALL SELECT i + 1 FROM n WHERE i < 5099) INSERT INTO product_cost_entries(id, product_id, cost_usd, source, user_id, baseline_batch_id, created_at) SELECT i, 4, 1.00015, \'manual\', 1, 0, \'2026-11-01T00:00:00Z\' FROM n')
  }, (r, pre, name) => {
    assert.equal(r.entries_to_round, 5003, name); assert.equal(r.entries_cap_ok, 0, name); assert.equal(r.pre_holds, 0, name); assert.equal(pre, 'cost_4dp_0313_pre_product_cost_entries_scope_over_5000', name) })
  scenario('an empty scope passes', () => {
    clean()
    ex('UPDATE products SET cost_price_usd = 1, purchase_price_usd = 1, cost_price_khr = 4100, purchase_price_khr = 4100')
    ex('UPDATE product_batches SET unit_cost_usd = 1, received_cost_usd = 1')
    ex('UPDATE product_cost_entries SET cost_usd = 1, cost_khr = 4100, previous_cost_usd = 1')
  }, (r, pre, name) => {
    assert.deepEqual([r.products_to_round, r.lots_to_round, r.entries_to_round, r.active_products_to_rederive, r.max_lot_or_entry_change, r.pre_holds], [0, 0, 0, 0, 0, 1], name); assert.equal(pre, null, name) })

  // ---- 4. no personal data ---------------------------------------------------------------------------------------------------------------------
  assert.ok(!JSON.stringify(base).includes('SECRET'), 'no sentinel personal value reaches the result')

  // ---- 5. mutants: each changes the result -----------------------------------------------------------------------------------------------------
  const mutate = (from, to) => { assert.ok(sql.includes(from), `mutant anchor present: ${from}`); return run(sql.split(from).join(to)) }
  assert.equal(mutate('pb.is_active IS NOT 1 AND EXISTS', '1 AND EXISTS').inactive_lots_holding_stock, 2, 'dropping the inactive filter also counts active lot 1')
  assert.equal(mutate('WHERE p.is_active = 1 AND (', 'WHERE (').active_products_to_rederive, 3, 'dropping the active filter adds inactive product 2')
  assert.equal(mutate('<= 500 THEN 1 ELSE 0 END AS products_cap_ok', '<= 4 THEN 1 ELSE 0 END AS products_cap_ok').products_cap_ok, 0, 'cap mutant')
  assert.equal(mutate('<= 0.00005 + 1e-9', '<= 0.00004').change_cap_ok, 0, 'change cap mutant')
  assert.equal(mutate('ABS(pb.unit_cost_usd) >= 1000000000', 'ABS(pb.unit_cost_usd) >= 1').lots_value_out_of_range, 2, 'range threshold mutant (unit cost of lots 1 and 7)')
  scenario('quantity filter', clean, () => {
    assert.equal(mutate('bbs.quantity > 0', '1').inactive_lots_holding_stock, 1, 'dropping the quantity filter counts the zero-quantity row of lot 3')
  })

  console.log('test-cost-4dp-0313-precheck-pure: ok')
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
