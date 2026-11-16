'use strict'
// Companion for ops/queries/stock-state-census-*-20261116.sql (stock-state design Phase 0, census C1-C13).
//
// 1. Every census file passes the Ops read-only guard (one SELECT) and runs on the full migrated chain.
// 2. Each query returns exact, hand-computed counts on a fixture that covers every case it distinguishes
//    (fractional / text / NULL quantities, 4dp costs, headers and children, inactive-but-stocked products, lots per pair,
//    the three low-stock settings in product / global / off modes, window edges of the write baseline, stat tables).
// 3. A mutant per query (a changed predicate) changes the result on at least one scenario.
// 4. No query selects a name, phone or other personal column: a static token ban plus sentinel values in every personal column
//    that must never reach a result.
// 5. No query writes (total_changes unchanged).
//
// Run (from cloudflare/): node scripts/test-stock-state-census-queries-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.resolve(__dirname, '../..')
const SUFFIX = '-20261116'
const NAMES = ['exactness', 'shape', 'lots-per-pair', 'flags', 'low-stock-settings', 'stats-migrations', 'write-baseline']
const fileOf = (n) => `stock-state-census-${n}${SUFFIX}`

const squash = (s) => s.replace(/\s+/g, ' ').trim()

async function main() {
  const guard = await import(pathToFileURL(path.join(root, 'ops/scripts/ops-sql-guard.mjs')))
  const files = fs.readdirSync(path.join(root, 'ops/queries')).filter((f) => f.startsWith('stock-state-census-') && f.endsWith('.sql')).sort()
  assert.deepEqual(files, NAMES.map((n) => fileOf(n) + '.sql').sort(), 'the census file set is exactly the listed queries')

  const q = {}
  for (const n of NAMES) {
    const raw = fs.readFileSync(path.join(root, 'ops/queries', fileOf(n) + '.sql'), 'utf8')
    assert.ok(!raw.includes('\r'), `${n}: LF only`)
    const { sql, rules } = guard.guardSql(raw)
    assert.ok(guard.loadQuery(fileOf(n)).maxRowsRead > 0, `${n}: states a read ceiling`)
    q[n] = { raw, sql, rules, name: fileOf(n) }
    // The runner path (listQueries / loadQuery) accepts it too.
    assert.equal(guard.loadQuery(fileOf(n)).sql, sql)
  }

  // ---- static personal-data ban --------------------------------------------------------------------------------------
  const BANNED = ['phone', 'email', 'address', 'customer_name', 'customer_id', 'user_name', 'username', 'password', 'notes', 'barcode', 'sku', 'product_name', 'supplier', 'contact', 'brand', 'branch_name']
  for (const n of NAMES) {
    const code = q[n].sql.replace(/'(?:[^']|'')*'/g, "''")
    for (const word of BANNED) assert.ok(!new RegExp(`\\b${word}\\b`, 'i').test(code), `${n}: mentions ${word}`)
    // A bare "name" column is only the migration file name; name_key is used inside aggregates, never selected as an output.
    const bareName = /(?<![A-Za-z_.])(?:\w+\.)?name(?![A-Za-z_])/i.test(code)
    assert.equal(bareName, n === 'stats-migrations', `${n}: bare name column use`)
  }

  // ---- fixture -------------------------------------------------------------------------------------------------------
  const world = openDb(loadAll())
  const db = world.db
  const q0 = (n) => db.prepare(q[n].sql).all().map((r) => ({ ...r }))
  const one = (n) => { const rows = q0(n); assert.equal(rows.length, 1, `${n}: one row`); return rows[0] }
  const ex = (sql, ...a) => db.prepare(sql).run(...a)

  // A fixture owns every row: no trigger (name_key, cost, positive-lot, inactive-stock guards) may rewrite it.
  for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all()) db.exec(`DROP TRIGGER "${t.name}"`)
  db.exec('PRAGMA ignore_check_constraints = ON; DELETE FROM settings; DELETE FROM branches;')
  db.exec("CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)")

  ex("INSERT INTO branches(id, name, is_active) VALUES (1, 'BRANCH-SECRET-1', 1), (2, 'BRANCH-SECRET-2', 0)")
  // id, active, is_group, parent_id, stock, low, out, cost_usd, cost_khr, name_key
  const P = [
    [1, 1, 0, 0, 5, 10, 0, 1.5, 6000, 'sk-a'],
    [2, 1, 0, 0, 0, 10, 0, 1.23456, null, 'sk-b'],
    [3, 1, 0, 0, 2.5, 3.5, -1, 1, 4100.12345, 'sk-c'],
    [4, 1, 0, 0, null, null, null, null, null, 'sk-d'],
    [5, 1, 0, 0, 50, 10, 0, 2, 8000.5, 'sk-e'],
    [6, 1, 1, 0, -1, 10, 0, null, null, 'sk-h'],
    [7, 1, 0, 6, 20, 10, 0.5, 1, 4000, 'sk-h1'],
    [8, 0, 0, 0, 0, 10, 0, 0, 0, 'sk-i'],
    [9, 0, 0, 0, 0, -1, 0, 0, 0, 'sk-j'],
    [10, 0, 0, 0, 0, 10, 0, 0, 0, 'sk-k'],
    [11, 0, 0, 0, 0, 10, 0, 0, 0, 'sk-l'],
    [12, 0, 0, 0, 7, 10, 0, 1, 4000, 'sk-m'],
    [13, 1, 0, 0, 100, 10, 0, 1, 4000, ''],
    [14, 1, 0, 0, 100, 'abc', 0, 1, 4000, 'sk-o'],
    [15, 1, 1, 0, 3, 10, 0, 1, 4000, 'sk-p'],
    [16, 1, 0, 0, 'x', 10, 0, null, 'n/a', 'sk-q'],
    [17, 1, 0, 0, 1000000, 10, 0, 1e10, null, 'sk-r'],
    [18, 1, 1, 0, 50, 10, 0, null, null, 'sk-s'],
    [19, 1, 0, 18, 1, 10, 0, null, null, 'sk-s1'],
  ]
  for (const p of P) {
    ex(`INSERT INTO products(id, name, is_active, is_group, parent_id, stock_quantity, low_stock_threshold, out_of_stock_threshold,
        cost_price_usd, cost_price_khr, name_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, p[0], `NAME-SECRET-${p[0]}`, ...p.slice(1))
  }
  ex("INSERT INTO branch_stock(product_id, branch_id, quantity) VALUES (1,1,5),(1,2,-1),(3,1,2.5),(5,1,'x'),(7,1,NULL),(9,1,4)")
  // lots: batch id, variant, active
  const B = [[1, 1, 1], [2, 1, 1], [3, 10, 1], [4, 5, 0], [5, 5, 1], [6, 13, 1], [7, 13, 1], [8, 13, 1], [9, 13, 1], [10, 13, 1], [11, 13, 1],
    [12, 12, 1], [13, 12, 1], [14, 12, 1], [15, 1, 1]]
  for (const b of B) ex('INSERT INTO product_batches(id, variant_product_id, batch_key, is_active) VALUES (?, ?, ?, ?)', b[0], b[1], `BATCHKEY-SECRET-${b[0]}`, b[2])
  const L = [[1, 1, 2], [1, 2, 4], [2, 1, 3], [3, 1, 2], [3, 2, 1.5], [4, 1, 1], [5, 2, 0], [5, 1, -2], [99, 1, 7],
    [6, 1, 1], [7, 1, 1], [8, 1, 1], [9, 1, 1], [10, 1, 1], [11, 1, 1], [12, 1, 1], [13, 1, 1], [14, 1, 1], [15, 1, null]]
  for (const l of L) ex('INSERT INTO branch_batch_stock(batch_id, branch_id, quantity) VALUES (?, ?, ?)', ...l)
  ex('INSERT INTO damaged_stock_lots(product_id, quantity_remaining) VALUES (11, 1), (8, 0)')

  const base = {
    exactness: {
      products_total: 19, stock_null: 1, stock_non_numeric: 1, stock_fractional: 1, stock_negative: 1, cost_non_numeric: 1,
      cost_usd_over_4dp: 1, cost_khr_over_4dp: 1, value_usd_over_9e14: 1, value_khr_over_9e14: 0, inexact_products: 4,
      low_thr_null: 1, low_thr_integer: 0, low_thr_real: 17, low_thr_other_type: 1, low_thr_negative: 1, low_thr_fractional: 1,
      out_thr_null: 1, out_thr_integer: 0, out_thr_real: 18, out_thr_other_type: 0, out_thr_negative: 1, out_thr_fractional: 1,
      max_product_id: 19, max_stock_quantity: 1000000, min_stock_quantity: -1, max_cost_usd: 1e10, max_cost_khr: 8000.5,
      max_row_value_usd: 1e16, max_row_value_khr: 400025,
      branch_stock_rows: 6, branch_stock_null_or_non_numeric: 2, branch_stock_fractional: 1, branch_stock_negative: 1,
      max_branch_id: 2, max_branch_stock_quantity: 5,
      lot_stock_rows: 19, lot_stock_null_or_non_numeric: 1, lot_stock_fractional: 1, lot_stock_negative: 1, max_lot_quantity: 7,
    },
    shape: {
      products_total: 19, products_active: 14, products_inactive: 5, products_visible: 18, visible_inactive: 4,
      headers_total: 3, headers_visible: 3, children_visible: 2, families_visible: 16, families_header_only: 1, largest_family_rows: 2,
      branches_total: 2, branches_active: 1, branch_stock_rows: 6, active_products_without_branch_row: 10,
      visible_x_branches_upper_bound: 36, max_product_id: 19, max_branch_id: 2,
    },
    flags: {
      cfg_enabled: 1, cfg_mode: 'product', cfg_threshold: 10, rows_healthy: 6, rows_low: 6, rows_out: 6, child_low: 6, child_out: 6,
      families: 16, fam_healthy: 5, fam_low: 6, fam_out: 5, low_by_own_threshold: 6, low_by_global: 0, flip_if_global_5: 2, flip_if_global_20: 2,
    },
    'stats-migrations': {
      stat_tables: 0, has_stat1: 0, stock_state_objects: 0, migrations_applied: 7, max_migration_id: 7,
      tail_1: '0309_g.sql', tail_2: '0310_f.sql', tail_3: '0307_e.sql', tail_4: '0306_d.sql', tail_5: '0305_c.sql', max_name_prefix: '0310',
    },
  }
  const before = () => db.prepare('SELECT total_changes() AS c').get().c

  const changes0 = before()
  const results = {}
  const sentinelFree = (n, rows) => {
    if (n === 'stats-migrations') return
    const text = JSON.stringify(rows)
    for (const s of ['SECRET', 'sk-', 'CUSTOMER', 'PHONE']) assert.ok(!text.includes(s), `${n}: result leaks ${s}`)
  }
  const check = (n, expected, rows) => {
    const got = rows[0]
    for (const [k, v] of Object.entries(expected)) assert.equal(got[k], v, `${n}.${k}`)
  }

  // ---- exactness / shape ---------------------------------------------------------------------------------------------
  check('exactness', base.exactness, q0('exactness'))
  check('shape', base.shape, q0('shape'))

  // ---- lots per pair -------------------------------------------------------------------------------------------------
  const lots = q0('lots-per-pair')
  assert.deepEqual(lots.map((r) => r.branch_id), [-1, 1, 2])
  const [lAll, l1, l2] = lots
  assert.deepEqual({ ...lAll }, { branch_id: -1, pairs: 7, stocked_lots: 15, max_lots_per_pair: 6, pairs_1: 4, pairs_2: 1, pairs_3_5: 1, pairs_6_up: 1,
    distinct_products: 5, pairs_on_inactive_lot: 1, orphan_positive_lots: 1 })
  assert.deepEqual({ ...l1 }, { branch_id: 1, pairs: 5, stocked_lots: 13, max_lots_per_pair: 6, pairs_1: 2, pairs_2: 1, pairs_3_5: 1, pairs_6_up: 1,
    distinct_products: 5, pairs_on_inactive_lot: 1, orphan_positive_lots: 0 })
  assert.deepEqual({ ...l2 }, { branch_id: 2, pairs: 2, stocked_lots: 2, max_lots_per_pair: 1, pairs_1: 2, pairs_2: 0, pairs_3_5: 0, pairs_6_up: 0,
    distinct_products: 2, pairs_on_inactive_lot: 0, orphan_positive_lots: 0 })

  // ---- flags: four settings scenarios --------------------------------------------------------------------------------
  const setCfg = (enabled, mode, thr) => {
    ex("DELETE FROM settings WHERE key LIKE 'low_stock%'")
    const put = (k, v) => v === null || ex('INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)', k, v, '2026-11-01 00:00:00')
    put('low_stock_alert_enabled', enabled); put('low_stock_threshold_mode', mode); put('low_stock_threshold_default', thr)
  }
  const flagScenarios = {}
  setCfg(null, null, null); flagScenarios.absent = one('flags'); check('flags', base.flags, [flagScenarios.absent])
  setCfg('1', 'product', '5.5'); flagScenarios.badThreshold = one('flags'); assert.deepEqual(flagScenarios.badThreshold, flagScenarios.absent)
  setCfg('', 'product', '1000001'); flagScenarios.bigThreshold = one('flags'); assert.deepEqual(flagScenarios.bigThreshold, flagScenarios.absent)
  setCfg('1', ' GLOBAL ', ' 5 '); flagScenarios.global = one('flags')
  check('flags', { cfg_enabled: 1, cfg_mode: 'global', cfg_threshold: 5, rows_healthy: 8, rows_low: 4, rows_out: 6, child_low: 4, child_out: 6,
    families: 16, fam_healthy: 7, fam_low: 4, fam_out: 5, low_by_own_threshold: 0, low_by_global: 4, flip_if_global_5: 0, flip_if_global_20: 2 }, [flagScenarios.global])
  setCfg(' No', 'product', '10'); flagScenarios.off = one('flags')
  check('flags', { cfg_enabled: 0, cfg_mode: 'product', cfg_threshold: 10, rows_healthy: 12, rows_low: 0, rows_out: 6, child_low: 0, child_out: 6,
    families: 16, fam_healthy: 11, fam_low: 0, fam_out: 5, low_by_own_threshold: 0, low_by_global: 0, flip_if_global_5: 4, flip_if_global_20: 6 }, [flagScenarios.off])
  setCfg(null, null, null)

  // ---- low-stock settings footprint ----------------------------------------------------------------------------------
  const settingsMutScenario = () => one('low-stock-settings')
  const loadSettingsFixture = () => {
    ex("DELETE FROM settings"); ex("DELETE FROM audit_logs")
    for (const [k, v, t] of [['low_stock_alert_enabled', 'off ', '2026-11-02 01:00:00'], ['low_stock_threshold_mode', 'global', '2026-11-03 02:00:00'],
      ['low_stock_threshold_default', '7.5', '2026-11-04 03:00:00'], ['low_stock_alias_x', '1', '2026-11-05 00:00:00'],
      ['LowStockLegacy', '2', '2026-11-05 00:00:00'], ['other', '1', '2026-11-05 00:00:00']]) {
      ex('INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)', k, v, t)
    }
    const audit = (entity, details, mod) => ex("INSERT INTO audit_logs(action, entity, details, created_at) VALUES ('update', ?, ?, datetime('now', ?))", entity, details, mod)
    audit('settings', '{"keys":["low_stock_threshold_default"]}', '-1 days')
    audit('settings', '{"keys":["currency"]}', '-2 days')
    audit('settings', '{"keys":["low_stock_alert_enabled"]}', '-20 days')
    audit('product', '{"keys":["low_stock_threshold"]}', '-1 days')
    }
  loadSettingsFixture()
  const newest = db.prepare("SELECT created_at AS c FROM audit_logs WHERE entity = 'settings' AND details LIKE '%default%'").get().c
  const st = settingsMutScenario()
  assert.deepEqual({ ...st }, {
    raw_enabled: 'off ', enabled_updated_at: '2026-11-02 01:00:00', raw_mode: 'global', mode_updated_at: '2026-11-03 02:00:00',
    raw_threshold: '7.5', threshold_updated_at: '2026-11-04 03:00:00', extra_lowstock_keys: 2, keys_with_odd_value: 2, settings_rows: 6,
    audit_settings_14d: 2, audit_lowstock_14d: 1, audit_lowstock_last: newest,
  })

  // ---- stats and migrations -----------------------------------------------------------------------------------------
  for (const n of ['0300_a.sql', '0301_b.sql', '0305_c.sql', '0306_d.sql', '0307_e.sql', '0310_f.sql', '0309_g.sql']) ex('INSERT INTO d1_migrations(name) VALUES (?)', n)
  const statsBase = one('stats-migrations'); check('stats-migrations', base['stats-migrations'], [statsBase])
  db.exec('CREATE TABLE stock_state(id INTEGER PRIMARY KEY); CREATE INDEX idx_stock_state_x ON stock_state(id);')
  const statsObjects = one('stats-migrations'); assert.equal(statsObjects.stock_state_objects, 2)
  db.exec('ANALYZE')
  const statsAnalyzed = one('stats-migrations'); assert.equal(statsAnalyzed.stat_tables, 1); assert.equal(statsAnalyzed.has_stat1, 1)
  db.exec('DROP TABLE stock_state')

  // ---- write baseline ------------------------------------------------------------------------------------------------
  db.exec('DELETE FROM audit_logs; DELETE FROM action_history; DELETE FROM sales; DELETE FROM returns; DELETE FROM inventory_movements;')
  const ts = (k, h) => `datetime(date('now', '+7 hours', '-${k} days'), '-7 hours', '+${h} hours')`
  const sale = (id, k, h, lines) => {
    db.exec(`INSERT INTO sales(id, created_at) VALUES (${id}, ${ts(k, h)})`)
    for (let i = 0; i < lines; i++) db.exec(`INSERT INTO sale_items(sale_id) VALUES (${id})`)
  }
  sale(1, 0, 3, 3); sale(2, 0, 4, 1); sale(3, 1, 5, 2); sale(4, 13, 0, 0); sale(5, 14, 5, 1)
  db.exec(`INSERT INTO returns(created_at) VALUES (${ts(0, 6)}), (${ts(3, 6)}), (${ts(3, 7)})`)
  const mv = (k, h, type, product, branch) => db.exec(`INSERT INTO inventory_movements(product_id, branch_id, movement_type, created_at)
    VALUES (${product}, ${branch}, ${type === null ? 'NULL' : `'${type}'`}, ${ts(k, h)})`)
  mv(0, 1, 'sale', 1, 1); mv(0, 2, 'sale', 1, 1); mv(0, 3, 'sale', 2, 1); mv(0, 4, 'stock_in', 1, 2)
  mv(2, 5, null, 3, 'NULL'); mv(2, 6, null, 'NULL', 'NULL')
  const loadBaselineAudit = () => { for (const [k, h] of [[0, 1], [0, 2], [5, 23], [14, 3]]) db.exec(`INSERT INTO audit_logs(action, entity, created_at) VALUES ('create', 'sale', ${ts(k, h)})`) }
  loadBaselineAudit()
  db.exec(`INSERT INTO action_history(label, created_at) VALUES ('a', ${ts(1, 1)}), ('b', ${ts(1, 2)}), ('c', ${ts(1, 3)}), ('d', ${ts(14, 3)})`)

  const wb = q0('write-baseline')
  assert.equal(wb.length, 14)
  const dayOf = (k) => db.prepare(`SELECT date('now', '+7 hours', '-${k} days') AS d`).get().d
  assert.deepEqual(wb.map((r) => r.day), Array.from({ length: 14 }, (_, i) => dayOf(13 - i)))
  const byK = (k) => wb[13 - k]
  const proj = (r) => ({ s: r.sales_rows, l: r.sale_lines, r: r.returns_rows, m: r.movement_rows, p: r.movement_products, pr: r.movement_pairs, a: r.audit_rows, h: r.history_rows })
  assert.deepEqual(proj(byK(0)), { s: 2, l: 4, r: 1, m: 4, p: 2, pr: 3, a: 2, h: 0 })
  assert.equal(byK(0).movement_types.split(',').sort().join(','), 'sale:3,stock_in:1')
  assert.deepEqual(proj(byK(1)), { s: 1, l: 2, r: 0, m: 0, p: 0, pr: 0, a: 0, h: 3 })
  assert.equal(byK(1).movement_types, null)
  assert.deepEqual(proj(byK(2)), { s: 0, l: 0, r: 0, m: 2, p: 1, pr: 1, a: 0, h: 0 })
  assert.equal(byK(2).movement_types, ':2')
  assert.deepEqual(proj(byK(3)), { s: 0, l: 0, r: 2, m: 0, p: 0, pr: 0, a: 0, h: 0 })
  assert.deepEqual(proj(byK(5)), { s: 0, l: 0, r: 0, m: 0, p: 0, pr: 0, a: 1, h: 0 })
  assert.deepEqual(proj(byK(13)), { s: 1, l: 0, r: 0, m: 0, p: 0, pr: 0, a: 0, h: 0 })
  for (const k of [4, 6, 7, 8, 9, 10, 11, 12]) assert.deepEqual(proj(byK(k)), { s: 0, l: 0, r: 0, m: 0, p: 0, pr: 0, a: 0, h: 0 }, `empty day ${k}`)
  assert.equal(wb.reduce((n, r) => n + r.sales_rows, 0), 4, 'the sale 14 days back is outside the window')

  // ---- no personal data, no writes ------------------------------------------------------------------------------------
  // Put sentinels in the remaining personal columns, then every query result must still be free of them.
  db.exec("UPDATE sales SET customer_name = 'CUSTOMER-SECRET', customer_phone = 'PHONE-SECRET'")
  const all = {}
  setCfg(null, null, null)
  for (const n of NAMES) { all[n] = q0(n); sentinelFree(n, all[n]) }
  // Every statement above only read: the only writes are the fixture's own.
  const statementsBefore = before()
  for (const n of NAMES) q0(n)
  assert.equal(before(), statementsBefore, 'the census queries wrote nothing')
  void changes0

  // ---- mutants ------------------------------------------------------------------------------------------------------
  db.exec('DELETE FROM audit_logs; DELETE FROM settings;')
  loadSettingsFixture()
  // Each mutant rewrites one predicate of the canonical SQL; it must change the result on at least one scenario.
  const run = (sql) => db.prepare(sql).all().map((r) => ({ ...r }))
  const scenarios = {
    base: () => setCfg(null, null, null),
    global: () => setCfg('1', ' GLOBAL ', ' 5 '),
    off: () => setCfg(' No', 'product', '10'),
  }
  const mutants = [
    ['exactness', "0.000001", '1', true],
    ['exactness', 'tq IN (\'integer\', \'real\') AND q <> CAST(q AS INTEGER)', "tq IN ('integer', 'real') AND q < CAST(q AS INTEGER)", false],
    ['exactness', 'quantity <> CAST(quantity AS INTEGER)', 'quantity < CAST(quantity AS INTEGER)', true],
    ['exactness', '900000000000000', '9000000000000000000', true],
    ['exactness', "tq NOT IN ('integer', 'real', 'null')", "tq NOT IN ('integer', 'real')", false],
    ['exactness', "tl = 'real'", "tl = 'integer'", false],
    ['exactness', 'tq IN (\'integer\', \'real\') AND q < 0', "tq IN ('integer', 'real') AND q < -100", false],
    ['shape', 'WHEN p.is_active = 1 THEN 1', 'WHEN p.is_active = 2 THEN 1', false],
    ['shape', 'bbs.quantity <> 0', 'bbs.quantity > 100', false],
    ['shape', 'dl.quantity_remaining <> 0', 'dl.quantity_remaining > 100', false],
    ['shape', 'bs.quantity <> 0', 'bs.quantity > 100', false],
    ['shape', 'SUM(CASE WHEN hdr = 0 THEN 1 ELSE 0 END) AS nh', 'SUM(1) AS nh', false],
    ['shape', 'COALESCE(NULLIF(COALESCE(parent.name_key, p.name_key), \'\'), \'id:\' || COALESCE(parent.id, p.id))', 'COALESCE(NULLIF(p.name_key, \'\'), \'id:\' || p.id)', false],
    ['shape', 'COALESCE(p.parent_id, 0) > 0', 'COALESCE(p.parent_id, 0) > 100', false],
    ['lots-per-pair', 'WHERE bbs.quantity > 0', 'WHERE bbs.quantity > 1', false],
    ['lots-per-pair', 'n BETWEEN 3 AND 5', 'n BETWEEN 4 AND 5', true],
    ['lots-per-pair', 'n >= 6', 'n >= 7', true],
    ['lots-per-pair', 'WHEN pb.is_active = 1 THEN 1', 'WHEN pb.is_active = 0 THEN 1', false],
    ['lots-per-pair', 'NOT EXISTS (SELECT 1 FROM product_batches x WHERE x.id = bbs.batch_id)', 'EXISTS (SELECT 1 FROM product_batches x WHERE x.id = bbs.batch_id)', false],
    ['flags', 'base.q <= base.ou', 'base.q < base.ou', true],
    ['flags', 'ELSE COALESCE(base.lo, cfg.threshold) END', 'ELSE cfg.threshold END', false],
    ['flags', 'WHEN cfg.enabled = 0 THEN -1', 'WHEN cfg.enabled = 0 THEN 1000000', false],
    ["flags", "WHEN cfg.mode = 'global' THEN cfg.threshold", "WHEN cfg.mode = 'globalx' THEN cfg.threshold", false],
    ['flags', 'SUM(CASE WHEN hdr = 0 AND s = 0 THEN 1 ELSE 0 END)', 'SUM(CASE WHEN s = 0 THEN 1 ELSE 0 END)', true],
    ['flags', "NOT GLOB '*[^0-9]*'", "NOT GLOB '*[^0-4]*'", false],
    ['flags', "IN ('0', 'false', 'off', 'no')", "IN ('0', 'false', 'off')", false],
    ['flags', "= 'global'\n", "= 'globa'\n", false],
    ['low-stock-settings', "'-14 days'", "'-30 days'", false],
    ['low-stock-settings', "details LIKE '%low_stock%'", "details LIKE '%currency%'", true],
    ['low-stock-settings', "entity = 'settings'", "entity = 'product'", false],
    ['low-stock-settings', 'value <> trim(value)', 'value <> value', false],
    ['low-stock-settings', "NOT IN ('low_stock_alert_enabled', 'low_stock_threshold_mode',", "NOT IN ('low_stock_alert_enabled',", false],
    ['low-stock-settings', "trim(value) GLOB '*[^0-9]*'", "trim(value) GLOB '*[^0-9.]*'", false],
    ['stats-migrations', 'OFFSET 2', 'OFFSET 1', false],
    ['stats-migrations', 'ORDER BY id DESC', 'ORDER BY id ASC', true],
    ['stats-migrations', "LIKE 'sqlite_stat%'", "LIKE 'sqlite_xtat%'", false],
    ['stats-migrations', "name LIKE 'stock_state%'", "name LIKE 'stock_xtate%'", false],
    ['stats-migrations', 'MAX(substr(name, 1, 4))', 'MIN(substr(name, 1, 4))', false],
    ['write-baseline', "'-13 days'", "'-12 days'", true],
    ['write-baseline', '+7 hours', '+8 hours', true],
    ['write-baseline', 'product_id * 1000000 + COALESCE(branch_id, 0)', 'product_id', false],
    ['write-baseline', 'si.sale_id = s.id', 'si.sale_id = s.id + 1000', false],
    ['write-baseline', "COALESCE(movement_type, '')", 'movement_type', false],
    ['write-baseline', 'created_at >= (SELECT cut FROM win)', 'created_at > (SELECT cut FROM win)', true],
  ]
  let applied = 0
  for (const [n, from, to, all2] of mutants) {
    const f = squash(from.replace(/\n/g, ' '))
    const t = squash(to.replace(/\n/g, ' '))
    assert.ok(q[n].sql.includes(f), `${n}: mutant anchor not in canonical SQL: ${f}`)
    const mutated = all2 ? q[n].sql.split(f).join(t) : q[n].sql.replace(f, t)
    assert.notEqual(mutated, q[n].sql)
    let differs = false
    if (n === 'low-stock-settings') loadSettingsFixture()
    if (n === 'stats-migrations') db.exec('CREATE TABLE IF NOT EXISTS stock_state(id INTEGER PRIMARY KEY)')
    if (n === 'write-baseline') { db.exec('DELETE FROM audit_logs'); loadBaselineAudit() }
    const useScenarios = n === 'flags' ? Object.keys(scenarios) : ['base']
    // Real fixtures are restored after each scenario: setCfg only touches low_stock% rows, the footprint fixture is separate.
    for (const s of useScenarios) {
      if (n === 'flags') scenarios[s]()
      const a = JSON.stringify(run(q[n].sql)); let b
      try { b = JSON.stringify(run(mutated)) } catch (e) { b = 'ERR' }
      if (a !== b) differs = true
    }
    if (n === 'flags') setCfg(null, null, null)
    db.exec('DROP TABLE IF EXISTS stock_state')
    assert.ok(differs, `${n}: mutant survived: ${f} -> ${t}`)
    applied += 1
  }
  for (const n of NAMES) assert.ok(mutants.some((m) => m[0] === n), `${n}: has a mutant`)

  db.close()
  console.log(`PASS stock-state census queries: ${NAMES.length} files guarded, exact fixture counts, ${applied} mutants killed, no personal data, no writes`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
