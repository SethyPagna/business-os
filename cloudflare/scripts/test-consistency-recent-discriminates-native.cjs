#!/usr/bin/env node
// Tier A "recent" consistency checks (ops/queries/recent-*.sql, RELIABILITY-PLAN 5.2) must catch a drift AND must read only
// the last two business days. For every check one planted defect has to turn the right column red INSIDE the window, and the
// SAME defect on data from ten days ago has to leave all five queries green (the window is the only filter). A clean world is
// green in both places, and the in-window world is not empty (a vacuous green proves nothing).
//
// Each query runs as the ops workflow runs it (the guard's canonical text, on the migrated chain in node:sqlite), and its row
// is fed through interpretD1Output with the query's own rules, so the verdict asserted is the one the public log would show.
// Windows are computed by SQLite from the wall clock, so the world is built relative to it. No network, no wrangler.
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { DatabaseSync } = require('node:sqlite')
const { loadAll } = require('./harness/load_migrations.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'recent-discriminates-'))
const TEMPLATE = path.join(SCRATCH, 'migrated.sqlite')
const PACK = ['recent-stock-ledgers', 'recent-sale-money', 'recent-returns-money', 'recent-shift-cash', 'recent-prepared-figures']
const RECENT_HOURS = 4
const OLD_HOURS = 240

let passed = 0
async function check(name, fn) {
  try { await fn(); passed += 1 } catch (err) { console.error(`FAIL ${name}\n  ${err && err.stack}`); process.exitCode = 1 }
}

function buildTemplate() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = OFF;')
  for (const sql of loadAll()) db.exec(sql)
  db.exec(`VACUUM INTO '${TEMPLATE.replace(/'/g, "''")}'`)
  db.close()
}

let counter = 0
function openWorld() {
  counter += 1
  const file = path.join(SCRATCH, `world-${counter}.sqlite`)
  fs.copyFileSync(TEMPLATE, file)
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = OFF;')
  // migration 0243 fences stock-table writes behind a permit row; the fixtures write through it, no query reads it
  db.exec("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
  return db
}

function insert(db, table, rows) {
  for (const row of [].concat(rows)) {
    const columns = Object.keys(row)
    db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((c) => `@${c}`).join(', ')})`).run(row)
  }
}

// A consistent little shop, every figure agreeing with its paired ledger, anchored `hoursAgo` hours before now. `id` offsets
// every key so a recent and an old copy can live in one database. T = the sale time; the shift runs from T-60 to T+120 minutes.
function buildShop(db, hoursAgo, id = 0) {
  const at = (minutes = 0) => db.prepare("SELECT datetime('now', ?, ?) AS t").get(`-${hoursAgo} hours`, `${minutes >= 0 ? '+' : ''}${minutes} minutes`).t
  const khDate = db.prepare("SELECT date('now', ?, '+7 hours') AS d").get(`-${hoursAgo} hours`).d
  const [p1, p2, s1, s2, r1] = [1 + id, 2 + id, 1 + id, 2 + id, 1 + id]
  db.exec("INSERT OR IGNORE INTO branches (id, name, is_default) VALUES (1, 'Store', 1)")
  insert(db, 'products', [
    { id: p1, name: `Alpha ${id}`, stock_quantity: 9, cost_price_usd: 2, purchase_price_usd: 2, is_active: 1 },
    { id: p2, name: `Beta ${id}`, stock_quantity: 4, cost_price_usd: 3, purchase_price_usd: 3, is_active: 1 },
  ])
  insert(db, 'product_batches', [
    { id: p1, variant_product_id: p1, batch_key: `k${p1}`, is_active: 1, unit_cost_usd: 2, received_at: at(-10), received_quantity: 10 },
    { id: p2, variant_product_id: p2, batch_key: `k${p2}`, is_active: 1, unit_cost_usd: 3, received_at: at(-10), received_quantity: 5 },
  ])
  insert(db, 'branch_stock', [{ product_id: p1, branch_id: 1, quantity: 9 }, { product_id: p2, branch_id: 1, quantity: 4 }])
  insert(db, 'branch_batch_stock', [{ batch_id: p1, branch_id: 1, quantity: 9, updated_at: at() }, { batch_id: p2, branch_id: 1, quantity: 4, updated_at: at() }])
  insert(db, 'inventory_movements', [
    { product_id: p1, branch_id: 1, movement_type: 'add', quantity: 10, created_at: at(-10) },
    { product_id: p1, branch_id: 1, movement_type: 'sale', quantity: -2, reference_id: s1, created_at: at() },
    { product_id: p1, branch_id: 1, movement_type: 'return', quantity: 1, reason: 'Return: unopened', reference_id: s1, created_at: at(30) },
    { product_id: p2, branch_id: 1, movement_type: 'add', quantity: 5, created_at: at(-10) },
    { product_id: p2, branch_id: 1, movement_type: 'sale', quantity: -1, reference_id: s2, created_at: at(5) },
  ])
  const v1 = (sid, total, extra) => ({ id: sid, money_precision_version: 1, subtotal_usd: total, calculated_total_usd: total, rounding_adjustment_usd: 0, total_usd: total,
    total_khr: total * 4000, exchange_rate: 4000, amount_paid_usd: total, sale_status: 'completed', branch_id: 1, cashier_id: 5, ...extra })
  insert(db, 'sales', [
    v1(s1, 10, { created_at: at(), receipt_number: `R${s1}`, return_state: 'partial' }),
    v1(s2, 5, { created_at: at(5), receipt_number: `R${s2}`, payments_version: 1 }),
  ])
  insert(db, 'sale_items', [
    { id: s1, sale_id: s1, product_id: p1, quantity: 2, total_usd: 10, applied_price_usd: 5, branch_id: 1, returned_quantity: 1 },
    { id: s2, sale_id: s2, product_id: p2, quantity: 1, total_usd: 5, applied_price_usd: 5, branch_id: 1 },
  ])
  insert(db, 'sale_item_batch_allocations', [
    { sale_item_id: s1, batch_id: p1, branch_id: 1, quantity: 2, created_at: at() },
    { sale_item_id: s2, batch_id: p2, branch_id: 1, quantity: 1, created_at: at(5) },
  ])
  insert(db, 'sale_payment_events', { event_id: `ev-${s2}`, sale_id: s2, direction: 'in', origin: 'checkout', payment_method: 'Cash', payment_details: '[]',
    amount_paid_usd: 5, exchange_rate: 4000, received_at: at(5), branch_id: 1, cashier_id: 5, created_at: at(5) })
  insert(db, 'returns', { id: r1, return_number: `RT${r1}`, sale_id: s1, cashier_id: 5, branch_id: 1, return_scope: 'customer', status: 'completed', money_precision_version: 1,
    total_refund_usd: 5, calculated_refund_usd: 5, rounding_adjustment_usd: 0, total_refund_khr: 20000, exchange_rate: 4000, refund_currency: 'USD', owed_reduction_usd: 0, created_at: at(30) })
  insert(db, 'return_items', { return_id: r1, sale_item_id: s1, product_id: p1, quantity: 1, total_usd: 5, branch_id: 1 })
  insert(db, 'fees', { fee_type: 'other', label: `Bags ${id}`, amount_usd: 2, fee_date: khDate, branch_id: 1, created_by: 5, created_at: at(40) })
  insert(db, 'shift_sessions', { id: 1 + id, shift_code: `SH${id}`, user_id: 5, branch_id: 1, business_date: khDate, opened_at: at(-60), opening_float_usd: 100,
    closed_at: at(120), closing_counted_usd: 108, closing_counted_khr: 0 })
  const money = (usd, khr = 0) => ({ usd, khr })
  insert(db, 'shift_close_figures', { shift_session_id: 1 + id, closed_at: at(120), figures_json: JSON.stringify({ v: 1, formula: 2, taken_at: at(120), window: { opened_at: at(-60), closed_at: at(120) },
    reconciliation: { opening: money(100), additional_cash: money(0), cash_sales: money(15), refunds: money(5), expenses: money(2), courier: money(0),
      expected: money(108), counted: money(108), difference: money(0), needs_review: false, review_codes: [] }, other_tenders: null, sales: null }) })
}

async function main() {
  buildTemplate()
  const guard = await import(pathToFileURL(path.join(ROOT, 'ops', 'scripts', 'ops-sql-guard.mjs')).href)
  const exporter = await import(pathToFileURL(path.join(ROOT, 'ops', 'scripts', 'ops-d1-export.mjs')).href)
  const queries = Object.fromEntries(PACK.map((name) => [name, guard.loadQuery(name)]))

  // The row of one query, and the verdict the ops export would print for it.
  const run = (db, name) => {
    const q = queries[name]
    const row = { ...db.prepare(q.sql).get() }
    const stdout = JSON.stringify([{ results: [row], success: true, meta: { rows_written: 0, changes: 0, changed_db: false } }])
    return { row, verdict: exporter.interpretD1Output(stdout, q.rules) }
  }
  const runAll = (db) => Object.fromEntries(PACK.map((name) => [name, run(db, name)]))
  const redColumns = (result) => PACK.flatMap((name) => {
    const list = queries[name].rules.expectZero
    return list.filter((col) => result[name].row[col] !== 0).map((col) => `${name}.${col}=${result[name].row[col]}`)
  })

  await check('the five Tier A queries pass the guard, state a ceiling, and name every expect-zero column they return', () => {
    for (const name of PACK) {
      const q = queries[name]
      assert.ok(q.maxRowsRead > 0 && q.maxRowsRead <= 20000, `${name}: ceiling ${q.maxRowsRead}`)
      assert.ok(Array.isArray(q.rules.expectZero) && q.rules.expectZero.length > 0, `${name}: no expect-zero list`)
      const db = openWorld()
      const row = db.prepare(q.sql).get()
      for (const col of q.rules.expectZero) assert.ok(col in row, `${name}: expect-zero names ${col}, which it does not return`)
      db.close()
    }
    assert.ok(PACK.reduce((n, name) => n + queries[name].maxRowsRead, 0) <= 40000, 'the pack ceiling is above the Tier A day allowance (RELIABILITY-PLAN 8)')
  })

  await check('a clean shop is green, and the recent one is not an empty window', () => {
    const db = openWorld()
    buildShop(db, RECENT_HOURS)
    const result = runAll(db)
    assert.deepEqual(redColumns(result), [])
    for (const name of PACK) assert.equal(result[name].verdict.ok, true, `${name}: ${result[name].verdict.problems}`)
    const row = (name) => result[name].row
    assert.deepEqual([row('recent-stock-ledgers').pairs_checked, row('recent-sale-money').sales_checked, row('recent-sale-money').lines_checked, row('recent-returns-money').returns_checked,
      row('recent-shift-cash').closes_checked, row('recent-prepared-figures').products_checked], [2, 2, 2, 1, 1, 2], 'the window reads the whole recent shop, so the green above is not vacuous')
    assert.ok(row('recent-shift-cash').events_checked >= 5 && row('recent-shift-cash').shifts_checked === 1)
    db.close()
  })

  await check('a clean shop from ten days ago is green and the window reads none of it', () => {
    const db = openWorld()
    buildShop(db, OLD_HOURS)
    const result = runAll(db)
    assert.deepEqual(redColumns(result), [])
    assert.deepEqual([result['recent-stock-ledgers'].row.pairs_checked, result['recent-sale-money'].row.sales_checked, result['recent-returns-money'].row.returns_checked,
      result['recent-shift-cash'].row.events_checked, result['recent-prepared-figures'].row.products_checked], [0, 0, 0, 0, 0])
    db.close()
  })

  // One planted defect each. `sql` is applied identically to the recent shop (must turn `red` on) and to the old shop (must stay green).
  const PLANTS = [
    { name: 'a lot quantity +1 without a movement', sql: 'UPDATE branch_batch_stock SET quantity = quantity + 1 WHERE batch_id = 1', red: ['recent-stock-ledgers.pairs_lots_exceed_branch'] },
    { name: 'branch stock +1 with no lot behind it', sql: 'UPDATE branch_stock SET quantity = quantity + 1 WHERE product_id = 1', red: ['recent-stock-ledgers.tracked_pairs_unlotted', 'recent-stock-ledgers.rollup_drift_products'] },
    { name: 'the product roll-up +1', sql: 'UPDATE products SET stock_quantity = stock_quantity + 1 WHERE id = 1', red: ['recent-stock-ledgers.rollup_drift_products'] },
    { name: 'damaged units left on an inactive product', sql: 'UPDATE products SET is_active = 0 WHERE id = 2; INSERT INTO damaged_stock_lots (product_id, branch_id, quantity, quantity_remaining) VALUES (2, 1, 1, 1)', red: ['recent-stock-ledgers.damaged_remaining_on_inactive_product'] },
    { name: 'a sale line +1 without a stock movement', sql: 'UPDATE sale_items SET quantity = quantity + 1 WHERE id = 1', red: ['recent-sale-money.parity_undeducted'] },
    { name: 'a sale movement removed (the line is undeducted)', sql: "DELETE FROM inventory_movements WHERE movement_type = 'sale' AND reference_id = 2", red: ['recent-sale-money.parity_undeducted'] },
    { name: 'a sale line total +1 (header off its lines)', sql: 'UPDATE sale_items SET total_usd = total_usd + 1 WHERE id = 1', red: ['recent-sale-money.v1_subtotal_ne_lines'] },
    { name: 'a payment event deleted', sql: 'DELETE FROM sale_payment_events WHERE sale_id = 2', red: ['recent-sale-money.payment_events_mismatch'] },
    { name: 'a paid sale short by 3 dollars', sql: 'UPDATE sales SET amount_paid_usd = 7 WHERE id = 1', red: ['recent-sale-money.completed_short'] },
    { name: 'a return refund off by 1 cent', sql: 'UPDATE returns SET total_refund_usd = 5.01 WHERE id = 1', red: ['recent-returns-money.v1_refund_equation', 'recent-returns-money.v1_refund_khr_twin'] },
    { name: 'a riel refund one hundred riel under its twin', sql: "UPDATE returns SET refund_currency = 'KHR', total_refund_khr = 19900 WHERE id = 1", red: ['recent-returns-money.v1_refund_khr_paid'] },
    { name: 'a return that took more cash out than the sale took in', sql: 'UPDATE sales SET amount_paid_usd = 3 WHERE id = 1', red: ['recent-returns-money.cash_out_over_paid'] },
    { name: 'a return that no longer tags its sale', sql: 'UPDATE sales SET return_state = NULL WHERE id = 1', red: ['recent-returns-money.return_evidence_without_tag'] },
    { name: 'a shift cash line off by 100 riel', sql: "UPDATE shift_close_figures SET figures_json = json_set(figures_json, '$.reconciliation.expected.khr', 100)", red: ['recent-shift-cash.close_expected_ne_parts_khr'] },
    { name: 'a shift cash line off by one cent', sql: "UPDATE shift_close_figures SET figures_json = json_set(figures_json, '$.reconciliation.expected.usd', 108.01)", red: ['recent-shift-cash.close_expected_ne_parts_usd'] },
    { name: 'a stored difference that is not counted minus expected', sql: "UPDATE shift_close_figures SET figures_json = json_set(figures_json, '$.reconciliation.difference.usd', 1)", red: ['recent-shift-cash.close_difference_ne_counted_usd'] },
    { name: 'a sale rung by someone with no shift', sql: 'UPDATE sales SET cashier_id = 99 WHERE id = 1', red: ['recent-shift-cash.sales_outside_shift'] },
    { name: 'a later payment taken outside every shift', sql: "UPDATE sale_payment_events SET received_at = datetime(received_at, '+3 days'), cashier_id = 5 WHERE sale_id = 2", red: ['recent-shift-cash.payment_events_outside_shift'] },
    { name: 'an expense recorded outside every shift', sql: "UPDATE fees SET created_by = 99 WHERE label = 'Bags 0'", red: ['recent-shift-cash.fees_outside_shift'] },
    { name: 'a prepared figure (the stored catalog cost) off by 1', sql: 'DROP TRIGGER IF EXISTS catalog_cost_admission_product_update_0258; UPDATE products SET cost_price_usd = 3, purchase_price_usd = 3 WHERE id = 1', red: ['recent-prepared-figures.cost_drift'] },
  ]
  const dropGuards = (db) => {
    // triggers that guard a hand edit of a prepared figure or a stock table are dropped for the plant, as the data-match tests do
    const guards = "SELECT name FROM sqlite_master WHERE type = 'trigger' AND (name LIKE 'catalog_cost_admission%' OR name LIKE 'catalog_cost_review%' OR name LIKE 'product_update_stock%' OR name LIKE '%_0242'"
      + " OR tbl_name IN ('sale_payment_events', 'shift_close_figures', 'returns', 'sales'))"
    for (const trigger of db.prepare(guards).all()) {
      db.exec(`DROP TRIGGER IF EXISTS ${trigger.name}`)
    }
  }
  const applyPlant = (db, plant) => { dropGuards(db); db.exec(plant.sql) }

  for (const plant of PLANTS) {
    await check(`RED inside the window, GREEN outside it: ${plant.name}`, () => {
      const recent = openWorld()
      buildShop(recent, RECENT_HOURS)
      applyPlant(recent, plant)
      const result = runAll(recent)
      const red = redColumns(result)
      for (const expected of plant.red) assert.ok(red.some((entry) => entry.startsWith(`${expected}=`)), `${expected} stayed 0 after "${plant.name}"; red: ${red.join(', ') || 'nothing'}`)
      const owner = plant.red[0].split('.')[0]
      assert.equal(result[owner].verdict.ok, false, `${owner}: the public verdict should be FAIL`)
      assert.ok(result[owner].verdict.problems.includes('expect-zero-failed'))
      recent.close()

      const old = openWorld()
      buildShop(old, OLD_HOURS)
      applyPlant(old, plant)
      const quiet = runAll(old)
      assert.deepEqual(redColumns(quiet), [], `"${plant.name}" on ten-day-old data tripped Tier A: the window is not the filter`)
      for (const name of PACK) assert.equal(quiet[name].verdict.ok, true)
      old.close()
    })
  }

  // The window is on the TOUCH, not on the sale's own date: a payment taken today on a ten-day-old sale must put that sale back under the
  // check. The wrong window (sales.created_at only) would miss it, and so would a payment check that only reads recent sales.
  await check('a LATE payment on an OLD sale is checked through its payment event, and the same payment made long ago is not read', () => {
    const lateEvent = (hoursAgo) => `INSERT INTO sale_payment_events (event_id, sale_id, direction, origin, payment_method, payment_details, amount_paid_usd, exchange_rate, received_at, branch_id, cashier_id, created_at)
      VALUES ('late-${hoursAgo}', 2, 'in', 'checkout', 'Cash', '[]', 3, 4000, datetime('now', '-${hoursAgo} hours'), 1, 5, datetime('now', '-${hoursAgo} hours'))`
    const db = openWorld()
    buildShop(db, OLD_HOURS)
    dropGuards(db)
    assert.equal(db.prepare(queries['recent-sale-money'].sql).get().sales_checked, 0, 'the ten-day-old sale is outside the window to begin with')
    db.exec(lateEvent(4))
    const row = db.prepare(queries['recent-sale-money'].sql).get()
    assert.equal(row.sales_checked, 1, 'the sale is back under the check through its payment event')
    assert.ok(row.payment_events_mismatch > 0, 'the payment that the header never took is red')
    // MUTANT: a window that looks at the sale's own date only (the payment-event touch switched off) misses it, so this check does discriminate
    const q = queries['recent-sale-money']
    const mutant = q.sql.replace('FROM sale_payment_events INDEXED BY idx_sale_payment_events_received WHERE received_at >= (SELECT cut FROM win)', "FROM sale_payment_events INDEXED BY idx_sale_payment_events_received WHERE received_at >= '9999'")
    assert.notEqual(mutant, q.sql)
    assert.equal(db.prepare(mutant).get().sales_checked, 0, 'the mutant never sees the late payment')
    db.close()
    const quiet = openWorld()
    buildShop(quiet, OLD_HOURS)
    dropGuards(quiet)
    quiet.exec(lateEvent(OLD_HOURS))
    assert.deepEqual(redColumns(runAll(quiet)), [], 'the same payment received ten days ago is the weekly pack\'s business')
    quiet.close()
  })

  await check('one database holding an old defect beside a clean recent shop stays green, and the same defect made recent turns red', () => {
    const db = openWorld()
    buildShop(db, OLD_HOURS, 100)
    dropGuards(db)
    db.exec('UPDATE branch_batch_stock SET quantity = quantity + 1 WHERE batch_id = 101; UPDATE sale_items SET quantity = quantity + 1 WHERE id = 101; DELETE FROM sale_payment_events WHERE sale_id = 102')
    buildShop(db, RECENT_HOURS, 0)
    assert.deepEqual(redColumns(runAll(db)), [], 'an old defect must stay with the weekly pack')
    db.exec('UPDATE branch_batch_stock SET quantity = quantity + 1 WHERE batch_id = 1')
    assert.ok(redColumns(runAll(db)).some((entry) => entry.startsWith('recent-stock-ledgers.pairs_lots_exceed_branch=')))
    db.close()
  })

  await check('MUTANT: a stock check that reads no window (every pair) is caught by the old-data plants', () => {
    const q = queries['recent-stock-ledgers']
    const mutant = q.sql.replace("created_at >= (SELECT cut FROM win)", "created_at >= '2000-01-01'")
    assert.notEqual(mutant, q.sql)
    const db = openWorld()
    buildShop(db, OLD_HOURS)
    db.exec('UPDATE branch_batch_stock SET quantity = quantity + 1 WHERE batch_id = 1')
    assert.equal(db.prepare(q.sql).get().pairs_lots_exceed_branch, 0, 'the real query ignores old data')
    assert.equal(db.prepare(mutant).get().pairs_lots_exceed_branch, 1, 'the mutant sees it, so the plant above does discriminate')
    db.close()
  })

  console.log(`test-consistency-recent-discriminates-native: ${passed} checks passed`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
