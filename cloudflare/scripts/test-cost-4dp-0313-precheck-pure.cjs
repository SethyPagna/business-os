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
  // Every trigger is dropped so the fixture can be written directly; their SQL is kept so section 3c can put them back and run with triggers live.
  const triggerSql = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger'").all().map((t) => t.sql)
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
  assert.ok(base.max_product_rederive_change > 0.00004 && base.max_product_rederive_change <= 0.00005 + 1e-9, 'the re-derive moves products 1 and 3 by about half a tick')
  assert.deepEqual({ ...base, max_lot_or_entry_change: 0, max_product_rederive_change: 0 }, {
    products_to_round: 5, lots_to_round: 3, entries_to_round: 3, inactive_lots_holding_stock: 1, active_products_to_rederive: 2,
    products_cap: 500, products_cap_ok: 1, lots_cap: 5000, lots_cap_ok: 1, entries_cap: 5000, entries_cap_ok: 1,
    products_value_out_of_range: 0, lots_value_out_of_range: 0, entries_value_out_of_range: 0,
    max_lot_or_entry_change: 0, change_cap_ok: 1, blocking_flags: 0, epoch_ok: 1, pre_holds: 0,
    // round 4: products 1 and 3 drift today and are in the re-derive set (0313 fixes them), nothing outside it drifts, no cutover, no positive-to-zero value
    post_active_cost_drift_now: 2, post_drift_after_apply: 0, active_branch_cutovers: 0, max_product_rederive_change: 0, positive_cost_rounds_to_zero: 0, apply_holds: 0,
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

  // ---- 3b. round 4: apply_holds predicts the WHOLE file (PRE and POST), each scenario against a real run of 0313 -------------------------------
  const objectsOf = () => JSON.stringify(db.prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all())
  const stateOf = () => JSON.stringify([db.prepare('SELECT * FROM products ORDER BY id').all(), db.prepare('SELECT * FROM product_batches ORDER BY id').all(), db.prepare('SELECT * FROM product_cost_entries ORDER BY id').all(), db.prepare('SELECT * FROM system_flags ORDER BY key').all(), objectsOf()])
  const fullRun = () => { try { db.exec(migration); return null } catch (e) { const m = /cost_4dp_0313_[a-z0-9_]+/.exec(String(e.message)); assert.ok(m, 'the file aborted with a named check: ' + e.message); return m[0] } }
  const whole = (name, mutate, check) => {
    db.exec('SAVEPOINT whole')
    try { mutate(); const row = run(); const before = stateOf(); const outcome = fullRun(); check(row, outcome, outcome === null ? null : stateOf() === before, name) } finally { db.exec('ROLLBACK TO whole; RELEASE whole') }
  }
  const applied = (row, outcome, name) => { assert.equal(row.apply_holds, 1, name + ': the precheck says apply'); assert.equal(outcome, null, name + ': 0313 applies') }
  whole('cleared fixture', clean, applied)
  // exact 4-place values at or above 2^20 are NOT long: the census form read them as long, the file could not change them and aborted at POST.
  const censusSaysLong = (x) => db.prepare('SELECT ABS(? * 10000 - ROUND(? * 10000)) > 0.000001 AS v').get(x, x).v === 1
  for (const x of [1500000.0002, 8388608.1234, 12345678.1234]) {
    assert.equal(censusSaysLong(x), true, `fixture check: the old predicate reports ${x} as long (the reviewer's case)`)
    whole('large KHR ' + x, () => { clean(); ex('UPDATE products SET cost_price_khr = ?, purchase_price_khr = ? WHERE id = 8', x, x) }, (row, outcome, _n, name) => {
      assert.equal(row.products_to_round, 5, name + ': not counted as long (same five products as the fixture)')
      applied(row, outcome, name)
    })
  }
  whole('large KHR on an entry', () => { clean(); ex('UPDATE product_cost_entries SET cost_khr = 8388608.1234 WHERE id = 4') }, (row, outcome, _n, name) => {
    assert.equal(row.entries_to_round, 3, name); applied(row, outcome, name)
  })
  // a long value that IS over 4 places at that magnitude is rounded and the file applies
  whole('long KHR at magnitude', () => { clean(); ex('UPDATE products SET cost_price_khr = 8388608.12345, purchase_price_khr = 8388608.12345 WHERE id = 8') }, (row, outcome, _n, name) => {
    assert.equal(row.products_to_round, 6, name); applied(row, outcome, name)
  })
  // drift outside the re-derive set: reported, apply_holds = 0, and 0313 aborts at POST (the PRE passes)
  whole('drift elsewhere', () => { clean(); ex('UPDATE products SET cost_price_usd = 9, purchase_price_usd = 9 WHERE id = 8') }, (row, outcome, _n, name) => {
    assert.equal(row.post_active_cost_drift_now, 3, name + ': products 1 and 3 (fixed by 0313) and product 8')
    assert.equal(row.post_drift_after_apply, 1, name + ': only product 8 would still drift after 0313'); assert.equal(row.pre_holds, 1, name)
    assert.equal(row.apply_holds, 0, name); assert.equal(outcome, 'cost_4dp_0313_post_active_cost_drift', name)
  })
  // a long own cost on a product outside the set drifts unless its rounded cost equals the formula: 4.16665 rounds to 4.1667 = lot 6's cost
  whole('long cost that rounds onto the formula', () => { clean(); ex('UPDATE products SET cost_price_usd = 4.16667, purchase_price_usd = 4.16667 WHERE id = 8') }, (row, outcome, _n, name) => {
    assert.equal(row.post_active_cost_drift_now, 3, name); assert.equal(row.post_drift_after_apply, 0, name); applied(row, outcome, name)
  })
  // an active branch cutover: refused at PRE, nothing written
  whole('active cutover', () => {
    clean()
    ex(`INSERT INTO branch_cutovers(operation_id, begin_request_id, actor_id, organization_id, control_incarnation, maintenance_token, source_branch_id, target_branch_id, intent_json, intent_digest,
        source_preimage_json, target_preimage_json, maintenance_flag_json, phase, capture_digest, snapshot_digest, verification_digest, created_at, updated_at)
        VALUES ('00000000-0000-0000-0000-000000000001', 'begin-request-1', 1, 'org', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 1, 2, '{}', ?, '{"id":1}', '{"id":2}', '{}', 'moving', ?, ?, ?, 'now', 'now')`,
    '0'.repeat(64), '0'.repeat(64), '0'.repeat(64), '0'.repeat(64))
  }, (row, outcome, untouched, name) => {
    assert.equal(row.active_branch_cutovers, 1, name); assert.equal(row.pre_holds, 0, name); assert.equal(row.apply_holds, 0, name)
    assert.equal(outcome, 'cost_4dp_0313_pre_branch_cutover_active', name); assert.equal(untouched, true, name + ': refused before any write')
  })
  whole('completed cutover is not active', () => {
    clean()
    ex(`INSERT INTO branch_cutovers(operation_id, begin_request_id, actor_id, organization_id, control_incarnation, maintenance_token, source_branch_id, target_branch_id, intent_json, intent_digest,
        source_preimage_json, target_preimage_json, maintenance_flag_json, phase, capture_digest, snapshot_digest, verification_digest, created_at, updated_at, manifest_json, manifest_digest, terminal_json)
        VALUES ('00000000-0000-0000-0000-000000000001', 'begin-request-1', 1, 'org', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 1, 2, '{}', ?, '{"id":1}', '{"id":2}', '{}', 'completed', ?, ?, ?, 'now', 'now', '{}', ?, '{}')`,
    '0'.repeat(64), '0'.repeat(64), '0'.repeat(64), '0'.repeat(64), '0'.repeat(64))
  }, (row, outcome, _n, name) => { assert.equal(row.active_branch_cutovers, 0, name); applied(row, outcome, name) })
  // a tiny positive cost that would round to 0 needs an owner decision: refused at PRE, nothing written (the reviewer's probe: 0.4546 became 5)
  for (const [label, sqlText] of [['lot unit cost', 'UPDATE product_batches SET unit_cost_usd = 0.00004 WHERE id = 1'], ['lot received cost', 'UPDATE product_batches SET received_cost_usd = 0.00004 WHERE id = 1'],
    ['entry cost', 'UPDATE product_cost_entries SET cost_usd = 0.00004 WHERE id = 1'], ['entry cost in riel', 'UPDATE product_cost_entries SET cost_khr = 0.00004 WHERE id = 1'], ['product cost', 'UPDATE products SET cost_price_usd = 0.00004 WHERE id = 6']]) {
    whole('positive rounds to zero: ' + label, () => { clean(); ex(sqlText) }, (row, outcome, untouched, name) => {
      assert.equal(row.positive_cost_rounds_to_zero, 1, name); assert.equal(row.pre_holds, 0, name); assert.equal(row.apply_holds, 0, name)
      assert.equal(outcome, 'cost_4dp_0313_pre_positive_cost_rounds_to_zero', name); assert.equal(untouched, true, name + ': refused before any write')
    })
  }
  // the change cap (round 5, mutant X4): the rounding factor 10000.0000000000036 pushes a value just under a tie, at a magnitude near 1e8, over the half tick: the
  // change is 0.0000500381 here. Every PRE passes (the value is under 1e9), so only apply_holds sees it, and 0313 aborts at its POST.
  const OVER_CAP = 99999999.00004996
  for (const [label, sqlText] of [['lot', 'UPDATE product_batches SET unit_cost_usd = ? WHERE id = 7'], ['entry', 'UPDATE product_cost_entries SET cost_usd = ? WHERE id = 4']]) {
    whole('change over half a tick: ' + label, () => { clean(); ex(sqlText, OVER_CAP) }, (row, outcome, _n, name) => {
      assert.ok(row.max_lot_or_entry_change > 0.00005 + 1e-9, name + ': the change is over the cap'); assert.equal(row.change_cap_ok, 0, name)
      assert.equal(row.pre_holds, 1, name + ': the PRE checks pass'); assert.equal(row.apply_holds, 0, name + ': but 0313 would not apply')
      assert.equal(outcome, 'cost_4dp_0313_post_change_over_half_tick', name)
    })
  }
  whole('0.00005 rounds to 0.0001, not zero', () => { clean(); ex('UPDATE product_batches SET unit_cost_usd = 0.00005, received_cost_usd = 0.00005 WHERE id = 7') }, (row, outcome, _n, name) => {
    assert.equal(row.positive_cost_rounds_to_zero, 0, name); applied(row, outcome, name)
  })

  // ---- 3c. as on production: every trigger live and the stock_schema_epoch row present ---------------------------------------------------------
  // The scenarios above run with every trigger dropped (and, for most, no epoch row), which production never is. Here the real triggers are back.
  // The one divergence found with triggers live: with NO stock_schema_epoch row the precheck says epoch_ok = 1 / apply_holds = 1 but 0313 aborts at
  // raise:stock_transaction_required (its permit insert selects the epoch row). Production always has the row (stock_schema_epoch:23 in the
  // system-flag keys export, epoch_ok = 1 in the precheck), so that case cannot happen there; it is pinned below only so nobody reads it as a bug.
  // the fixture is changed first (triggers would refuse a direct write), then the real triggers are put back
  const liveTriggers = (mutate) => () => { clean(); mutate(); for (const s of triggerSql) db.exec(s); assert.ok(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger'").get().n >= 10, 'the real triggers are live') }
  whole('triggers live, epoch present', liveTriggers(() => assert.equal(db.prepare("SELECT value FROM system_flags WHERE key = 'stock_schema_epoch'").get().value, 'legacy-separate-pool-v1')), (row, outcome, _n, name) => {
    assert.equal(row.epoch_ok, 1, name); assert.equal(row.products_to_round, 5, name); applied(row, outcome, name)
  })
  whole('triggers live, drift elsewhere', liveTriggers(() => ex('UPDATE products SET cost_price_usd = 9, purchase_price_usd = 9 WHERE id = 8')), (row, outcome, _n, name) => {
    assert.equal(row.apply_holds, 0, name); assert.equal(outcome, 'cost_4dp_0313_post_active_cost_drift', name)
  })
  db.exec('SAVEPOINT noepoch')
  try {
    liveTriggers(() => ex("DELETE FROM system_flags WHERE key = 'stock_schema_epoch'"))()
    const row = run()
    assert.equal(row.epoch_ok, 1, 'no epoch row (cannot happen on production)'); assert.equal(row.apply_holds, 1, 'the precheck cannot see a missing row')
    assert.throws(() => db.exec(migration), /stock_transaction_required/, '0313 aborts when the epoch row is missing and triggers are live')
  } finally { db.exec('ROLLBACK TO noepoch; RELEASE noepoch') }

  // ---- 4. no personal data ---------------------------------------------------------------------------------------------------------------------
  assert.ok(!JSON.stringify(base).includes('SECRET'), 'no sentinel personal value reaches the result')

  // ---- 5. mutants: each changes the result -----------------------------------------------------------------------------------------------------
  const mutate = (from, to) => { assert.ok(sql.includes(from), `mutant anchor present: ${from}`); return run(sql.split(from).join(to)) }
  assert.equal(mutate('pb.is_active IS NOT 1 AND EXISTS', '1 AND EXISTS').inactive_lots_holding_stock, 2, 'dropping the inactive filter also counts active lot 1')
  assert.equal(mutate('WHERE p.is_active = 1 AND (', 'WHERE (').active_products_to_rederive, 3, 'dropping the active filter adds inactive product 2')
  assert.equal(mutate('<= 500 THEN 1 ELSE 0 END AS products_cap_ok', '<= 4 THEN 1 ELSE 0 END AS products_cap_ok').products_cap_ok, 0, 'cap mutant')
  assert.equal(mutate('<= 0.00005 + 1e-9', '<= 0.00004').change_cap_ok, 0, 'change cap mutant')
  assert.equal(mutate('ABS(pb.unit_cost_usd) >= 1000000000', 'ABS(pb.unit_cost_usd) >= 1').lots_value_out_of_range, 2, 'range threshold mutant (unit cost of lots 1 and 7)')
  // mutant X4: apply_holds without its change-cap clause says apply on the over-cap world (the real one is asserted to be 0 above)
  scenario('X4 over-cap world', () => { clean(); ex('UPDATE product_batches SET unit_cost_usd = ? WHERE id = 7', 99999999.00004996) }, () => {
    const tail = 'AND post_drift_after_apply = 0 AND max_lot_or_entry_change <= 0.00005 + 1e-9'
    assert.equal(run().apply_holds, 0, 'the shipped apply_holds refuses it')
    assert.equal(mutate(tail, 'AND post_drift_after_apply = 0').apply_holds, 1, 'mutant X4 (change cap dropped from apply_holds) would say apply')
  })
  scenario('quantity filter', clean, () => {
    assert.equal(mutate('bbs.quantity > 0', '1').inactive_lots_holding_stock, 1, 'dropping the quantity filter counts the zero-quantity row of lot 3')
  })

  console.log('test-cost-4dp-0313-precheck-pure: ok')
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
