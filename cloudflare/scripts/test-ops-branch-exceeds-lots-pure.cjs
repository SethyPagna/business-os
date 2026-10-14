#!/usr/bin/env node
// Fixture proof for ops/queries/branch-exceeds-lots.sql: the read-only sizing query for the
// multi-lot Revert split (MULTILOT-REVERT, R2 review F1). It runs -- after the ops guard
// canonicalises it, exactly as the ops workflow would -- against the REAL migration chain in an
// in-memory SQLite. Nothing here touches D1, a network or wrangler.
//
// Part 1, (product, branch) pairs holding stock. A pair "has lots" the way the till decides it
// (getTrackedProductIds): a lot row at THAT branch that is active or holds stock.
//   healthy tracked      lots 5+5, branch 10                 -> counted as having lots, not split
//   the split            lots 0+3, branch 10                 -> split (what a pre-fix Revert left)
//   no live lot          no lot row at all, branch 10        -> NOT split: the till sells branch_stock
//   undated beside lots  lot 5, branch 8                     -> split (3 units that sell only as "Received date not recorded")
//   float residue        lot 1, branch 1.0000000005          -> residue, not split
//   inactive empty lot   only an inactive lot at 0, branch 4 -> no live lot (the till ignores it)
//   active empty lot     an active lot at 0, branch 4        -> split (the till shows 0)
//   no branch stock      lots 5, branch_stock 0              -> not a pair at all
//   lot at the OTHER branch only                             -> no live lot at this branch
// Part 2, batch-less removals ('remove' / CSV 'out', not a Revert counter): reverted or not, on a
// product with lots or not, with a record (lot shares or the zero row) or not, and the open ones a Revert refuses:
// no record, not a dated-count row, a lot of the product created AT OR BEFORE the removal (a same-second tie counts), and a
// movement id at or below the mark migration 0250 stored in system_flags (every id counts while no mark row exists). A record-less
// removal ABOVE the mark is counted apart: it is allowed (a product merge later gave its product older lots).
// Part 3, open held (damaged) rows made by a Remove with no lot, on a product that has lot rows: counted;
// a held row on a lot, a returns-made one, a fully restored one and one on a product with no lots: not.
// Negative controls (--wrong=<name>) rewrite the canonical SQL in memory and fail loudly if the anchor is missing; each must turn
// the checks it targets RED (a count check and the no-mark check may both turn):
//   --wrong=redo-counted         the root-removal filter is dropped: a Redo counter is counted as a removal (part 2)
//   --wrong=untracked-is-split   a pair with no lot row counts as split: stock with no live lot is not a split (part 1)
//   --wrong=dead-lot-tracks      an inactive empty lot makes a pair "have lots": the till ignores such a lot (part 1)
//   --wrong=held-any-source      a returns-made held row is counted as a Remove's (part 3)
//   --wrong=refused-ignores-time a removal that predates every lot of its product counts as refused (part 2)
//   --wrong=refused-counts-dated a dated-count removal counts as refused (part 2)
//   --wrong=refused-ignores-mark a removal above the mark counts as refused (part 2)
//   --wrong=refused-reason-only  a typed dated-count reason on an ordinary removal counts as a dated count (part 2)
//   --wrong=refused-own-time-only a back-dated row is judged by its own business date, not its write-time bound (part 2)
//   --wrong=refused-strict-time  a removal written in the same second as its lot does not count as refused (part 2)
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
let failed = 0
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (err) {
    failed += 1
    console.error(`FAIL ${name}\n  ${err && err.stack ? err.stack : err}`)
  }
}

const db = new DatabaseSync(':memory:')
db.exec('PRAGMA foreign_keys = OFF;')
for (const sql of loadAll()) db.exec(sql)
db.exec(`INSERT INTO branches (id, name, is_active, is_default) VALUES (1, 'Main', 1, 1), (2, 'Store', 1, 0)`)

let nextProduct = 0
let nextLot = 100
function product(name) {
  nextProduct += 1
  db.prepare(`INSERT INTO products (id, name, barcode, is_active, stock_quantity, cost_price_usd, cost_price_khr)
    VALUES (?, ?, ?, 1, 0, 3, 12000)`).run(nextProduct, name, `B${1000 + nextProduct}`)
  return nextProduct
}
function branchStock(productId, branchId, quantity) {
  db.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?, ?, ?)').run(productId, branchId, quantity)
  db.prepare('UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?').run(quantity, productId)
}
function lot(productId, branchId, quantity, { active = 1 } = {}) {
  nextLot += 1
  db.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, unit_cost_usd, received_quantity, created_at)
    VALUES (?, ?, ?, ?, '2026-09-05', ?, 2, ?, '2026-09-01 00:00:00')`).run(nextLot, productId, `k${nextLot}`, `k${nextLot}`, active, quantity)
  db.prepare('INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (?, ?, ?)').run(nextLot, branchId, quantity)
  return nextLot
}
let lastMovement = 0
function movement(productId, branchId, type, quantity, { batchId = null, reference = null, reason = 'fixture', createdAt = '2026-09-20 10:00:00' } = {}) {
  lastMovement = Number(db.prepare(`INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity, reason, reference_id, batch_id, created_at)
    VALUES (?, 'fixture', ?, ?, ?, ?, ?, ?, ?)`).run(productId, branchId, type, quantity, reason, reference, batchId, createdAt).lastInsertRowid)
  return lastMovement
}
const reverted = (productId, id, type = 'add') => movement(productId, 1, type, 1, { reference: `revert:${id}` })

// ---- Part 1 fixture ----------------------------------------------------------------------
const pHealthy = product('healthy tracked'); const healthyLot = lot(pHealthy, 1, 5); lot(pHealthy, 1, 5); branchStock(pHealthy, 1, 10)
const pSplit = product('the split'); lot(pSplit, 1, 0); lot(pSplit, 1, 3); branchStock(pSplit, 1, 10)
const pUntracked = product('untracked aggregate'); branchStock(pUntracked, 1, 10)
const pUndated = product('undated beside a lot'); const undatedLot = lot(pUndated, 1, 5); branchStock(pUndated, 1, 8)
const pResidue = product('float residue'); lot(pResidue, 1, 1); branchStock(pResidue, 1, 1.0000000005)
const pInactive = product('inactive empty lot'); lot(pInactive, 1, 0, { active: 0 }); branchStock(pInactive, 1, 4)
const pActiveEmpty = product('active empty lot'); lot(pActiveEmpty, 1, 0); branchStock(pActiveEmpty, 1, 4)
const pNoBranch = product('lots but no branch stock'); lot(pNoBranch, 1, 5); branchStock(pNoBranch, 1, 0)
const pOther = product('lot at the other branch only'); const otherLot = lot(pOther, 2, 3); branchStock(pOther, 2, 3); branchStock(pOther, 1, 6)

// ---- Part 2 fixture ----------------------------------------------------------------------
movement(pActiveEmpty, 1, 'remove', 1, { createdAt: '2026-08-01 10:00:00' })          // open, written BEFORE the product's lot existed: drew on none (the first movement: nothing earlier bounds its write time)
const pTie = product('tie'); lot(pTie, 1, 0)                                         // no branch stock: not a pair
movement(pTie, 1, 'remove', 1, { createdAt: '2026-09-01 00:00:00' })                 // open, written in the same second as its lot (first movements: no earlier row bounds its write time): refused
const rSplit = movement(pSplit, 1, 'remove', 7); const rSplitRevert = reverted(pSplit, rSplit)   // reverted, lots, on a split pair
const rPlain = movement(pUntracked, 1, 'remove', 3); reverted(pUntracked, rPlain)         // reverted, product never had a lot
movement(pHealthy, 1, 'out', 2)                                                      // open CSV removal, lots, no shares
const rShared = movement(pUndated, 1, 'remove', 2)                                   // open, lots, WITH recorded shares
db.prepare('INSERT INTO dated_stock_count_batch_actions (movement_id, batch_id, quantity) VALUES (?, ?, -2)').run(rShared, undatedLot)
movement(pHealthy, 1, 'remove', 1, { batchId: healthyLot })                         // names one lot: not batch-less
movement(pInactive, 1, 'remove', 1)                                                  // open, the product has a (dead) lot row
const redo = reverted(pSplit, rSplitRevert, 'remove')                                  // a Redo counter: not a root removal
movement(pResidue, 1, 'remove', 1, { reason: 'Dated stock count import', createdAt: '2026-09-20 00:00:00' })   // open dated-count row (reason + midnight stamp): records its own lot effects
const pTyped = product('typed reason'); lot(pTyped, 1, 0)                            // no branch stock: not a pair
movement(pTyped, 1, 'remove', 1, { reason: 'Dated stock count import' })               // open, the dated-count text typed on an ordinary removal at 10:00: refused
const rZero = movement(pOther, 1, 'remove', 1)                                       // open, WITH the zero record (it took nothing from lots)
db.prepare('INSERT INTO dated_stock_count_batch_actions (movement_id, batch_id, quantity) VALUES (?, ?, 0)').run(rZero, otherLot)
const pBack = product('back-dated csv'); lot(pBack, 1, 0)                          // no branch stock: not a pair
movement(pBack, 1, 'out', 1, { createdAt: '2026-01-15 00:00:00' })                    // open, a CSV removal dated long before its lot, written after the movements above: refused
// The mark: every movement so far was written before removals recorded. What follows is written by recording code.
const MARK_KEY = 'multilot_revert_watermark'
const setMark = (value) => db.prepare('UPDATE system_flags SET value = ? WHERE key = ?').run(String(value), MARK_KEY)
setMark(lastMovement)
const pMerged = product('keeper that a merge gave older lots'); lot(pMerged, 1, 0)   // no branch stock: not a pair
movement(pMerged, 1, 'remove', 1)                                                    // open, no record, a lot "before" it, but ABOVE the mark: allowed

// ---- Part 3 fixture ----------------------------------------------------------------------
function held(productId, { source, batchId = null, remaining, quantity = 5 }) {
  db.prepare(`INSERT INTO damaged_stock_lots (product_id, product_name, branch_id, batch_id, quantity, quantity_remaining, condition_tag, source)
    VALUES (?, 'fixture', 1, ?, ?, ?, 'damaged', ?)`).run(productId, batchId, quantity, remaining, source)
}
held(pSplit, { source: 'remove', remaining: 3 })                          // counted: a Remove kept it, no lot, the product has lots
held(pSplit, { source: 'remove', batchId: healthyLot, remaining: 2 })     // names a lot
held(pHealthy, { source: 'return', remaining: 2 })                        // made by a return, not a Remove
held(pHealthy, { source: 'remove', remaining: 0 })                        // fully restored or disposed
held(pUntracked, { source: 'remove', remaining: 4 })                      // the product never had a lot

;(async () => {
  const guard = await load('ops/scripts/ops-sql-guard.mjs')
  const q = guard.loadQuery('branch-exceeds-lots')
  const wrong = (process.argv.find((a) => a.startsWith('--wrong=')) || '').slice('--wrong='.length)
  const MUTANTS = {
    'redo-counted': ["AND COALESCE(CAST(m.reference_id AS TEXT), '') NOT LIKE 'revert:%'", "AND COALESCE(CAST(m.reference_id AS TEXT), '') NOT LIKE 'zzz:%'"],
    'untracked-is-split': ['FROM pairs WHERE has_lots = 1 AND branch_quantity - lot_quantity > 0.000001', 'FROM pairs WHERE branch_quantity - lot_quantity > 0.000001'],
    'dead-lot-tracks': ['MAX(CASE WHEN pb.is_active = 1 OR bbs.quantity > 0 THEN 1 ELSE 0 END)', 'MAX(1)'],
    'held-any-source': ["d.source = 'remove' AND d.batch_id IS NULL", 'd.batch_id IS NULL'],
    'refused-ignores-time': [' AND lot_before = 1 AND before_mark = 1) AS removals_open_revert_refused', ' AND product_has_lots = 1 AND before_mark = 1) AS removals_open_revert_refused'],
    'refused-counts-dated': [' AND has_shares = 0 AND is_dated_count = 0 AND lot_before = 1 AND before_mark = 1', ' AND has_shares = 0 AND lot_before = 1 AND before_mark = 1'],
    'refused-ignores-mark': [' AND lot_before = 1 AND before_mark = 1) AS removals_open_revert_refused', ' AND lot_before = 1) AS removals_open_revert_refused'],
    'refused-reason-only': ["AND time(m.created_at) = '00:00:00') AS is_dated_count", ") AS is_dated_count"],
    'refused-strict-time': ['AND datetime(pb.created_at) <= MAX(', 'AND datetime(pb.created_at) < MAX('],
    'refused-own-time-only': ["MAX(datetime(m.created_at), COALESCE(pm.prior_max, ''))", 'datetime(m.created_at)'],
  }
  let sql = q.sql
  if (wrong) {
    assert.ok(MUTANTS[wrong], 'unknown control ' + wrong)
    assert.strictEqual(sql.split(MUTANTS[wrong][0]).length, 2, 'control anchor must occur exactly once: ' + MUTANTS[wrong][0])
    sql = sql.replace(MUTANTS[wrong][0], MUTANTS[wrong][1])
  }
  const run = () => db.prepare(sql).all()
  const rows = run()

  await check('the query passes the ops read-only guard, one row of counts', () => {
    assert.deepStrictEqual(q.rules, { minRows: 1, maxRows: 1, expectZero: null })
    assert.strictEqual(rows.length, 1)
    for (const [column, value] of Object.entries(rows[0])) {
      assert.match(column, /^(pairs|products|removals|held_rows)_[a-z0-9_]+$/, `only count columns: ${column}`)
      assert.ok(Number.isInteger(value) && value >= 0, `${column} is a count: ${value}`)
    }
  })

  await check('part 1: pairs with lots, the split, the float residue and stock with no live lot', () => {
    const row = rows[0]
    assert.strictEqual(row.pairs_with_branch_stock, 9, 'the pair with branch_stock 0 is not counted')
    assert.strictEqual(row.pairs_with_lots, 6, 'healthy, split, undated, residue, active-empty and the other branch lot')
    assert.strictEqual(row.pairs_with_lots_branch_exceeds_lots, 3, 'the split, the undated units beside a lot, the active empty lot')
    assert.strictEqual(row.products_with_lots_branch_exceeds_lots, 3)
    assert.strictEqual(row.pairs_with_lots_float_residue, 1, 'over by 5e-10 is noise, apart from the split')
    assert.strictEqual(row.pairs_without_live_lot, 3, 'no lot row, an inactive empty lot, or lots only at the other branch')
  })

  await check('part 2: batch-less removals, their Reverts, shares and the ones a Revert now refuses', () => {
    const row = rows[0]
    assert.strictEqual(row.removals_batchless, 12, 'split, plain, open CSV, shared, inactive-lot, before-the-lot, dated count, typed reason, zero record, back-dated CSV, tie, above-the-mark; not the named-lot one, not the Redo counter, not the Revert counters')
    assert.strictEqual(row.removals_batchless_with_shares, 2, 'the lot shares and the zero record')
    assert.strictEqual(row.removals_batchless_reverted, 2)
    assert.strictEqual(row.removals_batchless_reverted_lot_product, 1, 'the plain removal is on a product that never had a lot')
    assert.strictEqual(row.removals_batchless_reverted_on_split_pairs, 1)
    assert.strictEqual(row.removals_open_revert_refused, 5, 'the open CSV removal, the one beside an inactive lot, the back-dated CSV removal, the same-second tie and the typed dated-count text; not the shared, zero-record, dated-count, before-the-lot or above-the-mark ones')
    assert.strictEqual(row.removals_open_after_mark_lot_before, 1, 'the record-less removal above the mark, allowed because it was written by recording code')
  })

  await check('without a mark row the timestamps alone decide, as before the migration', () => {
    const kept = db.prepare('SELECT value FROM system_flags WHERE key = ?').get(MARK_KEY).value
    db.prepare('DELETE FROM system_flags WHERE key = ?').run(MARK_KEY)
    try {
      const row = run()[0]
      assert.strictEqual(row.removals_open_revert_refused, 6, 'every record-less removal after a lot counts, the above-the-mark one included')
      assert.strictEqual(row.removals_open_after_mark_lot_before, 0)
      db.prepare("INSERT INTO system_flags (key, value) VALUES (?, 'not a number')").run(MARK_KEY)
      assert.strictEqual(run()[0].removals_open_revert_refused, 6, 'an unreadable mark is no mark')
    } finally {
      db.prepare('DELETE FROM system_flags WHERE key = ?').run(MARK_KEY)
      db.prepare('INSERT INTO system_flags (key, value) VALUES (?, ?)').run(MARK_KEY, kept)
    }
    assert.strictEqual(run()[0].removals_open_revert_refused, 5)
  })

  await check('the mark key is the same literal in the migration, the Revert and the query', () => {
    const src = (rel) => require('fs').readFileSync(path.join(ROOT, rel), 'utf8')
    const revert = /const MULTILOT_WATERMARK_KEY = '([^']+)'/.exec(src('cloudflare/src/lib/stockRevert.ts'))
    assert.ok(revert, 'the Revert constant must exist')
    assert.strictEqual(revert[1], MARK_KEY)
    assert.ok(q.sql.includes("key = '" + MARK_KEY + "'"), 'the ops query reads the same key')
    assert.ok(src('cloudflare/migrations/0250_multilot_revert_watermark.sql').includes("'" + MARK_KEY + "'"), 'the migration writes it')
  })

  await check('part 3: only an open, lot-less, Remove-made held row on a product with lots is counted', () => {
    assert.strictEqual(rows[0].held_rows_open_remove_no_lot_upper_bound, 1)
  })

  await check('the dated-count reason is the same literal in the importer, the Revert and the query', () => {
    const src = (rel) => require('fs').readFileSync(path.join(ROOT, rel), 'utf8')
    const importer = /export const DATED_STOCK_COUNT_REASON = '([^']+)'/.exec(src('cloudflare/src/lib/datedStockCountImport.ts'))
    const revert = /const DATED_STOCK_COUNT_REASON = '([^']+)'/.exec(src('cloudflare/src/lib/stockRevert.ts'))
    assert.ok(importer && revert, 'both constants must exist')
    assert.strictEqual(revert[1], importer[1])
    assert.ok(q.sql.includes("= '" + importer[1] + "' AND time(m.created_at) = '00:00:00') AS is_dated_count"), 'the ops query uses the same literal and the midnight stamp')
    assert.ok(src('cloudflare/src/lib/datedStockCountApply.ts').includes('`${movement.date} 00:00:00`'), 'the dated count stamps its movements at midnight of the count day')
    assert.ok(/const DATED_STOCK_COUNT_STAMP_TIME = '00:00:00'/.test(src('cloudflare/src/lib/stockRevert.ts')), 'the Revert tests the same stamp')
  })

  await check('a Revert counter of a Revert counter does not make its root look reverted twice', () => {
    // Reverting the Redo counter must not change the root counts: still one reverted root on the split pair.
    reverted(pSplit, redo)
    const again = run()[0]
    assert.strictEqual(again.removals_batchless_reverted, 2)
    assert.strictEqual(again.removals_batchless_reverted_on_split_pairs, 1)
  })

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed) process.exit(1)
})().catch((err) => { console.error(err); process.exit(1) })
