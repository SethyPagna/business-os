#!/usr/bin/env node
// Fixture checks for ops/queries/forensics-l8-retry-double-writes.sql (SCAN1
// F2 / F5 past records). The query runs -- after the read-only guard
// canonicalises it, exactly as the ops workflow would -- against the REAL
// migration chain in an in-memory SQLite, seeded with known twins and with
// the near-misses a plausible wrong query would also list:
//   * a different actor, different contents, a different lot, a different
//     branch, a gap past the window, a Redo reason, a different sheet session,
//     a dated stock-count row -- none of them is a retry twin;
//   * ISO 'T...Z' timestamps and a pair that straddles midnight -- both ARE
//     twins, and a text-only time comparison misses them;
//   * a twin already cancelled / voided / reverted is listed as class c, and so
//     is a stock twin the Inventory page's Undo reversed ('Undo: <reason>',
//     no id link); an Undo at another branch, of another quantity, in the
//     same direction or before the pair, and a plain opposite movement, are not
//     compensation.
// No network, no wrangler.
'use strict'

const assert = require('assert')
const path = require('path')
const { pathToFileURL } = require('url')
const { DatabaseSync } = require('node:sqlite')
const { loadAll } = require('./harness/load_migrations.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

let passed = 0
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (err) {
    console.error(`FAIL ${name}\n  ${err && err.message}`)
    process.exitCode = 1
  }
}

function openSchema() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = OFF;')
  for (const sql of loadAll()) db.exec(sql)
  return db
}

function seed(db) {
  const ret = db.prepare(`INSERT INTO returns (id, return_number, sale_id, cashier_id, branch_id, return_scope, supplier_id,
    total_refund_usd, supplier_compensation_usd, status, client_request_id, created_at)
    VALUES (@id, @num, @sale, @cashier, @branch, @scope, @supplier, @refund, @comp, @status, @crid, @at)`)
  const line = db.prepare(`INSERT INTO return_items (return_id, sale_item_id, product_id, batch_id, quantity)
    VALUES (@ret, @saleItem, @product, @batch, @qty)`)
  const customer = (id, sale, cashier, at, lines, extra = {}) => {
    ret.run({ id, num: `RET-${id}`, sale, cashier, branch: 1, scope: 'customer', supplier: null, refund: 4.5, comp: 0,
      status: 'completed', crid: `return_${id}`, at, ...extra })
    for (const [saleItem, product, qty] of lines) line.run({ ret: id, saleItem, product, batch: null, qty })
  }
  const supplier = (id, supplierId, branch, at, lines, comp = 6) => {
    ret.run({ id, num: `SRET-${id}`, sale: null, cashier: 7, branch, scope: 'supplier', supplier: supplierId, refund: 0, comp,
      status: 'completed', crid: `supplier_return_${id}`, at })
    for (const [product, batch, qty] of lines) line.run({ ret: id, saleItem: null, product, batch, qty })
  }
  // Customer returns.
  customer(1, 100, 7, '2026-09-20 03:00:00', [[500, 10, 1]])
  customer(2, 100, 7, '2026-09-20 03:00:25', [[500, 10, 1]])            // twin of 1 (a)
  customer(3, 100, 7, '2026-09-20 03:01:10', [[501, 11, 1]])            // other line: not a twin
  customer(4, 101, 7, '2026-09-20 05:00:00', [[502, 12, 2]])
  customer(5, 101, 7, '2026-09-20 05:10:00', [[502, 12, 2]])            // 10 min later: not a twin
  customer(6, 102, 7, '2026-09-20 06:00:00', [[503, 13, 1]])
  customer(7, 102, 8, '2026-09-20 06:00:10', [[503, 13, 1]])            // another cashier: not a twin
  customer(8, 103, 7, '2026-09-21T07:00:00.000Z', [[504, 14, 1]])
  customer(9, 103, 7, '2026-09-21T07:01:30.000Z', [[504, 14, 1]])       // ISO twin, 90 s (b)
  customer(10, 104, 7, '2026-09-21 08:00:00', [[505, 15, 1]])
  customer(11, 104, 7, '2026-09-21 08:00:20', [[505, 15, 1]], { status: 'cancelled' }) // compensated (c)
  customer(12, 105, 7, '2026-09-22 23:59:50', [[506, 16, 1], [507, 17, 2]])
  customer(13, 105, 7, '2026-09-23 00:00:20', [[507, 17, 2], [506, 16, 1]]) // midnight twin, lines reordered (a)
  // Supplier returns.
  supplier(20, 50, 1, '2026-09-20 08:00:00', [[20, 900, 3]])
  supplier(21, 50, 1, '2026-09-20 08:00:40', [[20, 900, 3]])            // twin of 20 (a)
  supplier(22, 50, 2, '2026-09-20 08:00:50', [[20, 900, 3]])            // other branch: not a twin
  supplier(23, 51, 1, '2026-09-20 09:00:00', [[21, 901, 2]])
  supplier(24, 51, 1, '2026-09-20 09:00:30', [[21, 902, 2]])            // other lot: not a twin
  supplier(25, 52, 1, '2026-09-20 09:30:00', [[22, 903, 1]], 2)
  supplier(26, 52, 1, '2026-09-20 09:30:10', [[22, 903, 1]], 3)         // other compensation: not a twin
  // Loyalty awards.
  const points = db.prepare(`INSERT INTO loyalty_point_adjustments (id, customer_id, points, note, created_by_id, created_at, voided_at)
    VALUES (@id, @customer, @points, @note, @by, @at, @voided)`)
  const award = (id, customerId, pts, note, by, at, voided = null) => points.run({ id, customer: customerId, points: pts, note, by, at, voided })
  award(1, 5, 25, 'Birthday', 1, '2026-09-20 09:00:00')
  award(2, 5, 25, 'Birthday', 1, '2026-09-20 09:00:15')                  // twin of 1 (a)
  award(3, 5, 50, 'Birthday', 1, '2026-09-20 09:00:45')                  // other points: not a twin
  award(4, 6, 10, 'Promo', 1, '2026-09-20 09:10:00')
  award(5, 6, 10, 'Promo', 2, '2026-09-20 09:10:05')                     // other admin: not a twin
  award(6, 7, 10, null, 1, '2026-09-20 09:20:00')
  award(7, 7, 10, null, 1, '2026-09-20 09:20:20', '2026-09-20 10:00:00') // voided (c)
  award(8, 8, 10, 'Promo', 1, '2026-09-20 09:30:00')
  award(9, 8, 10, 'Promo', 1, '2026-09-20 09:33:00')                     // 3 min later: not a twin
  // Stock movements.
  const mv = db.prepare(`INSERT INTO inventory_movements (id, product_id, branch_id, movement_type, quantity, reason, reference_id, user_id, batch_id, created_at)
    VALUES (@id, @product, @branch, @type, @qty, @reason, @ref, @user, @batch, @at)`)
  const move = (id, product, type, qty, reason, ref, at, extra = {}) => mv.run({ id, product, branch: 1, type, qty, reason, ref, user: 1, batch: 1000, at, ...extra })
  move(1, 30, 'add', 24, 'Restock', '1727400000000', '2026-09-20 10:00:00')
  move(2, 30, 'add', 24, 'Restock', '1727400000000', '2026-09-20 10:00:20')   // same sheet session (a)
  move(3, 30, 'add', 24, 'Restock', '1727400099999', '2026-09-20 10:00:50')   // another sheet: not a twin
  move(4, 31, 'remove', 3, 'Damaged', null, '2026-09-20 11:00:00')
  move(5, 31, 'remove', 3, 'Damaged', null, '2026-09-20 11:01:30')            // outflow, 90 s (b)
  move(6, 32, 'remove', 2, 'Expired', null, '2026-09-20 12:00:00')
  move(7, 32, 'remove', 2, 'Expired', null, '2026-09-20 12:00:30')            // outflow, 30 s (a)
  move(8, 33, 'add', 5, 'Restock', '1727400011111', '2026-09-20 13:00:00')
  move(9, 33, 'add', 5, 'Redo: Restock', '1727400011111', '2026-09-20 13:00:20') // a Redo: not a twin
  move(10, 34, 'add', 5, 'Restock', null, '2026-09-20 14:00:00')
  move(11, 34, 'add', 5, 'Restock', null, '2026-09-20 14:00:20')              // stock-in with no session (b)
  move(12, 35, 'remove', 1, 'Broken', null, '2026-09-20 15:00:00')
  move(13, 35, 'remove', 1, 'Broken', null, '2026-09-20 15:00:10')            // reverted below (c)
  move(14, 35, 'add', 1, 'Revert', 'revert:13', '2026-09-20 15:05:00')
  move(15, 36, 'adjustment', 4, 'Dated stock count import', null, '2026-09-20 16:00:00')
  move(16, 36, 'adjustment', 4, 'Dated stock count import', null, '2026-09-20 16:00:00') // count rows: never listed
  move(17, 37, 'remove', 2, 'Sold off-till', null, '2026-09-20 17:00:00')
  move(18, 37, 'remove', 2, 'Sold off-till', null, '2026-09-20 17:00:20', { branch: 2 }) // other branch: not a twin
  move(19, 38, 'remove', 2, 'Theft', null, '2026-09-20 18:00:00')
  move(20, 38, 'remove', 2, 'Theft', null, '2026-09-20 18:00:20', { user: 2 })   // other user: not a twin
  move(21, 39, 'remove', 2, 'Damaged', null, '2026-09-20 19:00:00')
  move(22, 39, 'remove', 2, 'Damaged', null, '2026-09-20 19:00:20')
  move(23, 39, 'adjustment', 2, 'Undo: Damaged', null, '2026-09-20 19:02:00')
  move(24, 40, 'add', 6, 'Restock', '1727400022222', '2026-09-20 20:00:00')
  move(25, 40, 'add', 6, 'Restock', '1727400022222', '2026-09-20 20:00:15')
  move(26, 40, 'remove', 6, 'Undo: Restock', '1727400022222', '2026-09-20 20:03:00')
  move(27, 41, 'remove', 2, 'Expired', null, '2026-09-20 21:00:00')
  move(28, 41, 'remove', 2, 'Expired', null, '2026-09-20 21:00:20')
  move(29, 41, 'add', 2, 'Undo: Expired', null, '2026-09-20 21:02:00', { branch: 2 })
  move(30, 42, 'remove', 2, 'Lost', null, '2026-09-20 21:30:00')
  move(31, 42, 'remove', 2, 'Lost', null, '2026-09-20 21:30:20')
  move(32, 42, 'add', 1, 'Undo: Lost', null, '2026-09-20 21:32:00')
  move(33, 43, 'remove', 2, 'Sold off-till', null, '2026-09-20 22:00:00')
  move(34, 43, 'remove', 2, 'Sold off-till', null, '2026-09-20 22:00:20')
  move(35, 43, 'remove', 2, 'Undo: Restock', null, '2026-09-20 22:02:00')
  move(36, 44, 'add', 2, 'Undo: Broken', null, '2026-09-20 22:59:00')
  move(37, 44, 'remove', 2, 'Broken', null, '2026-09-20 23:00:00')
  move(38, 44, 'remove', 2, 'Broken', null, '2026-09-20 23:00:20')
  move(39, 45, 'remove', 2, 'Spoiled', null, '2026-09-20 23:30:00')
  move(40, 45, 'remove', 2, 'Spoiled', null, '2026-09-20 23:30:20')
  move(41, 45, 'add', 2, 'Restock', null, '2026-09-20 23:32:00')
  move(42, 46, 'add', 3, 'Restock (Free goods (no cost))', '1727400033333', '2026-09-21 09:00:00')
  move(43, 46, 'add', 3, 'Restock (Free goods (no cost))', '1727400033333', '2026-09-21 09:00:20')
  move(44, 46, 'remove', 3, 'Undo: Restock', '1727400033333', '2026-09-21 09:05:00')
  move(45, 47, 'remove', 2, 'Miscount', null, '2026-09-21 10:00:00', { batch: null })
  move(46, 47, 'remove', 2, 'Miscount', null, '2026-09-21 10:00:20', { batch: null })
  move(47, 47, 'add', 2, 'Undo: Miscount', null, '2026-09-21 10:04:00', { batch: 1001 })
}

const EXPECTED = [
  ['customer_return', 1, 2, 'a'],
  ['customer_return', 8, 9, 'b'],
  ['customer_return', 10, 11, 'c'],
  ['customer_return', 12, 13, 'a'],
  ['supplier_return', 20, 21, 'a'],
  ['loyalty_award', 1, 2, 'a'],
  ['loyalty_award', 6, 7, 'c'],
  ['stock_adjust', 1, 2, 'a'],
  ['stock_adjust', 4, 5, 'b'],
  ['stock_adjust', 6, 7, 'a'],
  ['stock_adjust', 10, 11, 'b'],
  ['stock_adjust', 12, 13, 'c'],
  ['stock_adjust', 21, 22, 'c'],
  ['stock_adjust', 24, 25, 'c'],
  ['stock_adjust', 42, 43, 'c'],
  ['stock_adjust', 45, 46, 'c'],
  ['stock_adjust', 27, 28, 'a'],
  ['stock_adjust', 30, 31, 'a'],
  ['stock_adjust', 33, 34, 'a'],
  ['stock_adjust', 37, 38, 'a'],
  ['stock_adjust', 39, 40, 'a'],
]

async function main() {
  const guard = await load('ops/scripts/ops-sql-guard.mjs')
  const q = guard.loadQuery('forensics-l8-retry-double-writes')

  await check('the query passes the read-only guard with its directives', () => {
    assert.deepStrictEqual(q.rules, { minRows: 0, maxRows: 2000, expectZero: null })
  })

  const db = openSchema()
  seed(db)
  const rows = db.prepare(q.sql).all().map((r) => ({ ...r }))
  const key = (kind, first, second) => `${kind}:${first}:${second}`
  const byKey = new Map(rows.map((r) => [key(r.kind, r.first_id, r.second_id), r]))

  await check('exactly the known twins are listed, each with its class', () => {
    const got = rows.map((r) => [r.kind, r.first_id, r.second_id, r.suggested_class])
      .sort((x, y) => String(x).localeCompare(String(y)))
    const want = [...EXPECTED].sort((x, y) => String(x).localeCompare(String(y)))
    assert.deepStrictEqual(got, want)
  })

  await check('ISO timestamps and a pair across midnight are measured by real time', () => {
    assert.strictEqual(byKey.get(key('customer_return', 8, 9)).gap_seconds, 90)
    assert.strictEqual(byKey.get(key('customer_return', 12, 13)).gap_seconds, 30)
    assert.strictEqual(byKey.get(key('customer_return', 12, 13)).first_at, '2026-09-22 23:59:50')
  })

  await check('the evidence columns describe the pair', () => {
    const ret = byKey.get(key('customer_return', 1, 2))
    assert.strictEqual(ret.subject_id, 100)
    assert.strictEqual(ret.actor_id, 7)
    assert.strictEqual(ret.amount, 4.5)
    assert.strictEqual(ret.signature, '500:10x1')
    assert.strictEqual(ret.request_ids_differ, 1)
    assert.strictEqual(ret.both_active, 1)
    const sup = byKey.get(key('supplier_return', 20, 21))
    assert.strictEqual(sup.subject_id, 50)
    assert.strictEqual(sup.signature, '20:900x3')
    assert.strictEqual(sup.amount, 6)
    const pts = byKey.get(key('loyalty_award', 1, 2))
    assert.strictEqual(pts.subject_id, 5)
    assert.strictEqual(pts.amount, 25)
    assert.strictEqual(pts.signature, 'points=25')
    const add = byKey.get(key('stock_adjust', 1, 2))
    assert.strictEqual(add.same_reference, 1)
    assert.strictEqual(add.amount, 24)
    assert.strictEqual(add.signature, 'addx24')
    const out = byKey.get(key('stock_adjust', 6, 7))
    assert.strictEqual(out.same_reference, null)
    assert.strictEqual(out.amount, -2)
    assert.strictEqual(byKey.get(key('stock_adjust', 12, 13)).both_active, 0)
  })

  await check("an Inventory Undo ('Undo: <reason>', opposite direction, same product, branch and quantity) compensates a stock twin", () => {
    assert.strictEqual(byKey.get(key('stock_adjust', 21, 22)).both_active, 0, 'a removal undone by a lot correction')
    assert.strictEqual(byKey.get(key('stock_adjust', 24, 25)).both_active, 0, 'a stock-in undone by a removal')
    assert.strictEqual(byKey.get(key('stock_adjust', 42, 43)).both_active, 0, 'the Undo reason lacks the receipt note the stock-in stored')
    assert.strictEqual(byKey.get(key('stock_adjust', 45, 46)).both_active, 0, 'a removal spread over several lots (no batch) undone into one lot')
    for (const [first, second, why] of [[27, 28, 'an Undo at another branch'], [30, 31, 'an Undo of another quantity'],
      [33, 34, 'an Undo in the same direction'], [37, 38, 'an Undo before the pair'], [39, 40, 'a plain opposite movement']]) {
      assert.strictEqual(byKey.get(key('stock_adjust', first, second)).both_active, 1, why)
    }
  })

  await check('an empty ledger lists nothing (min-rows 0 lets the job pass)', () => {
    assert.deepStrictEqual(openSchema().prepare(q.sql).all(), [])
  })

  if (process.exitCode) console.error(`test-ops-l8-retry-double-writes-pure: FAILED (${passed} passed)`)
  else console.log(`test-ops-l8-retry-double-writes-pure: ${passed} checks passed`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
