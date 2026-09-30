#!/usr/bin/env node
// Fixture proof for ops/queries/stk-c-lot-drain-without-movement.sql: the
// read-only detection query for SCAN1 STK-C past records (stock that left the
// lot ledger with no inventory_movements row). It runs -- after the ops guard
// canonicalises it, exactly as the ops workflow would -- against the REAL
// migration chain in an in-memory SQLite.
//
// Known positives:
//   the old removeStockAcrossBatches drain, replayed with its own SQL (every
//   lot to 0, aggregate decremented by the drained units) and no movement --
//   what a mixed lot + unlotted removal left before the fix;
//   a lot at 0 whose nearest movement is 10 minutes later, at ANOTHER branch,
//   or of another product (a time-, branch- or product-blind match would
//   clear it);
//   a receipt that wrote stock and then stored the CHECK failure (400), and
//   one still unfinished long after it was claimed.
// Known negatives, each the counterexample to a plausible wrong query:
//   the same drain WITH its movement (a query flagging every lot at 0 fails);
//   a movement 119 s later, or in the other timestamp shape (an exact-time
//   match fails);
//   a partly drained lot (a mixed removal always drained every lot to 0);
//   a completed 200 receipt, an unwritten refusal, a request still in flight;
//   the REAL products-import absolute snapshot (planReconcileBranchSnapshot),
//   which zeroes or restamps a lot with no movement while a sibling written in
//   the same statement keeps stock. Drains the exclusion must not swallow:
//   two lots drained together, a drained lot beside stock received later, and
//   one beside the same product's lot at the other branch stamped at that instant.
// No network, no wrangler.
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')
const { loadAll } = require('./harness/load_migrations.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

function loadRealLib(fileName, loaded = new Map()) {
  const file = path.join(ROOT, 'cloudflare', 'src', 'lib', fileName)
  if (loaded.has(file)) return loaded.get(file).exports
  const mod = { exports: {} }
  loaded.set(file, mod)
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  }).outputText
  const requireLib = (request) => request.startsWith('./') ? loadRealLib(`${request.slice(2).replace(/\.ts$/, '')}.ts`, loaded) : require(request)
  new Function('require', 'module', 'exports', output)(requireLib, mod, mod.exports)
  return mod.exports
}
const { planReconcileBranchSnapshot } = loadRealLib('productBatches.ts')

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

// ---- fixture ---------------------------------------------------------------------
db.exec(`INSERT INTO branches (id, name, is_active, is_default) VALUES (1, 'Main', 1, 1), (2, 'Store', 1, 0)`)
let nextProduct = 0
let nextLot = 100
function product(name) {
  nextProduct += 1
  db.prepare(`INSERT INTO products (id, name, barcode, is_active, stock_quantity, cost_price_usd, cost_price_khr)
    VALUES (?, ?, ?, 1, 0, 3, 12000)`).run(nextProduct, name, `B${1000 + nextProduct}`)
  return nextProduct
}
// A lot of `qty` units at `branchId`, plus `unlotted` legacy units in
// branch_stock beside it.
function lot(productId, branchId, qty, unlotted = 0) {
  nextLot += 1
  db.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, unit_cost_usd, received_quantity)
    VALUES (?, ?, ?, ?, '2026-09-05', 1, 2, ?)`).run(nextLot, productId, `k${nextLot}`, `k${nextLot}`, qty)
  db.prepare('INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (?, ?, ?)').run(nextLot, branchId, qty)
  db.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?, ?, ?)
    ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = branch_stock.quantity + excluded.quantity`).run(productId, branchId, qty + unlotted)
  db.prepare('UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?').run(qty + unlotted, productId)
  return nextLot
}
// The pre-fix removeStockAcrossBatches drain, statement for statement (base
// c3784a2e lib/productBatches.ts): the clamped lot decrement that stamps
// updated_at, then the clamped aggregate decrements for the drained units.
// The remainder's UPSERT failed after this had committed, so no movement.
function oldDrain(productId, branchId, batchId, drained) {
  db.prepare(`UPDATE branch_batch_stock SET quantity = MAX(0, quantity - @quantity), updated_at = datetime('now')
          WHERE batch_id = @batchId AND branch_id = @branchId`).run({ batchId, branchId, quantity: drained })
  db.prepare('UPDATE branch_stock SET quantity = MAX(0, quantity - @quantity) WHERE product_id = @productId AND branch_id = @branchId')
    .run({ productId, branchId, quantity: drained })
  db.prepare('UPDATE products SET stock_quantity = MAX(0, COALESCE(stock_quantity, 0) - @quantity), updated_at = CURRENT_TIMESTAMP WHERE id = @productId')
    .run({ productId, quantity: drained })
}
function movement(productId, branchId, createdAtSql, type = 'adjustment', qty = -1) {
  db.prepare(`INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity, reason, created_at)
    VALUES (?, 'fixture', ?, ?, ?, 'fixture', ${createdAtSql})`).run(productId, branchId, type, qty)
}
// A lot at 0 whose last write is the literal timestamp given.
function zeroLotAt(productId, branchId, updatedAt) {
  const id = lot(productId, branchId, 5)
  db.prepare('UPDATE branch_batch_stock SET quantity = 0, updated_at = ? WHERE batch_id = ?').run(updatedAt, id)
  return id
}
function productsImportSnapshot(productId, branchId, quantity) {
  db.exec('BEGIN')
  for (const statement of planReconcileBranchSnapshot({ productId, branchId, quantity, receivedDate: '2026-09-28' })) {
    const prepared = db.prepare(statement.sql)
    prepared.setAllowUnknownNamedParameters(true)
    prepared.run(statement.params)
  }
  db.exec('COMMIT')
}
let nextReceipt = 0
function receipt({ written, status, response, createdAtSql = 'CURRENT_TIMESTAMP', completed = true, productId = 1, branchId = 1, quantity = 4 }) {
  nextReceipt += 1
  const request = JSON.stringify([['branchId', branchId], ['productId', productId], ['quantity', quantity], ['reason', 'count'], ['type', 'remove']])
  db.prepare(`INSERT INTO stock_mutation_receipts (actor_id, request_id, kind, request_json, written, response_status, response_json, created_at, completed_at)
    VALUES (1, ?, 'adjust', ?, ?, ?, ?, ${createdAtSql}, ${completed ? 'CURRENT_TIMESTAMP' : 'NULL'})`)
    .run(`req_fixture_${nextReceipt}`, request, written, status == null ? null : status, response == null ? null : JSON.stringify(response))
  return nextReceipt
}

// Positives.
const pMixed = product('mixed removal, pre-fix')             // 2 lotted + 3 unlotted, "remove 4"
const lotMixed = lot(pMixed, 1, 2, 3)
oldDrain(pMixed, 1, lotMixed, 2)
const pLate = product('movement ten minutes later')
const lotLate = zeroLotAt(pLate, 1, '2026-09-20 10:00:00')
movement(pLate, 1, "'2026-09-20 10:10:00'")
const pOtherBranch = product('movement at the other branch only')
const lotOtherBranch = zeroLotAt(pOtherBranch, 1, '2026-09-20 11:00:00')
movement(pOtherBranch, 2, "'2026-09-20 11:00:00'")
const pOtherProduct = product('another product moved at that moment')
const lotOtherProduct = zeroLotAt(pOtherProduct, 1, '2026-09-20 12:00:00')
movement(pMixed, 1, "'2026-09-20 12:00:00'")
const pTwoLots = product('mixed removal that drained two lots in one write')
const lotTwoFirst = zeroLotAt(pTwoLots, 1, '2026-09-23 09:00:00')
const lotTwoSecond = zeroLotAt(pTwoLots, 1, '2026-09-23 09:00:00')
const pRestocked = product('drained, then new stock received')
const lotRestockedDrain = zeroLotAt(pRestocked, 1, '2026-09-22 10:00:00')
lot(pRestocked, 1, 4)
movement(pRestocked, 1, 'CURRENT_TIMESTAMP', 'purchase', 4)
const pOtherBranchKept = product('drained while the other branch kept stock at that instant')
const lotOtherBranchKeptDrain = zeroLotAt(pOtherBranchKept, 1, '2026-09-24 10:00:00')
const lotOtherBranchKept = lot(pOtherBranchKept, 2, 4)
db.prepare("UPDATE branch_batch_stock SET updated_at = '2026-09-24 10:00:00' WHERE batch_id = ?").run(lotOtherBranchKept)
const rCheck = receipt({ written: 1, status: 400, response: { error: 'CHECK constraint failed: quantity >= 0' }, productId: pMixed, quantity: 4 })
const rStale = receipt({ written: 1, status: null, completed: false, createdAtSql: "datetime('now', '-10 minutes')", productId: pLate })

// Negatives.
const pClean = product('legitimate removal with its movement')
const lotClean = lot(pClean, 1, 4)
oldDrain(pClean, 1, lotClean, 4)
movement(pClean, 1, 'CURRENT_TIMESTAMP')
const pNear = product('movement 119 s later')
const lotNear = zeroLotAt(pNear, 1, '2026-09-21 09:00:00')
movement(pNear, 1, "'2026-09-21 09:01:59'")
const pShape = product('ISO lot stamp, plain movement stamp')
const lotShape = zeroLotAt(pShape, 1, '2026-09-21T10:00:30.000Z')
movement(pShape, 1, "'2026-09-21 10:00:00'", 'sale')
const pPartial = product('partly drained lot')
const lotPartial = lot(pPartial, 1, 5)
oldDrain(pPartial, 1, lotPartial, 2)
const rOk = receipt({ written: 1, status: 200, response: { success: true }, productId: pClean })
const rRefused = receipt({ written: 0, status: 400, response: { error: 'Only 3 available' }, productId: pClean })
const rInFlight = receipt({ written: 1, status: null, completed: false, productId: pClean })
const pImportTrim = product('import says 3 of 5: the newer lot is trimmed to 0')
const lotImportKept = lot(pImportTrim, 1, 3)
const lotImportTrimmed = lot(pImportTrim, 1, 2)
productsImportSnapshot(pImportTrim, 1, 3)
const pImportRestamp = product('import restamps a lot sold to 0 months ago')
const lotImportRestampKept = lot(pImportRestamp, 1, 3)
const lotImportRestamped = zeroLotAt(pImportRestamp, 1, '2026-06-01 10:00:00')
movement(pImportRestamp, 1, "'2026-06-01 10:00:00'", 'sale', -5)
productsImportSnapshot(pImportRestamp, 1, 3)

// ---- run -----------------------------------------------------------------------
;(async () => {
  const guard = await load('ops/scripts/ops-sql-guard.mjs')
  const q = guard.loadQuery('stk-c-lot-drain-without-movement')
  const rows = db.prepare(q.sql).all()
  const drains = new Set(rows.filter((r) => r.signal === 'orphan_drain').map((r) => Number(r.batch_id)))
  const receipts = new Set(rows.filter((r) => r.signal === 'receipt').map((r) => Number(r.receipt_id)))

  await check('the query passes the ops read-only guard with its row limits', () => {
    assert.strictEqual(q.rules.minRows, 0)
    assert.strictEqual(q.rules.maxRows, 2000)
    assert.match(q.sql, /^WITH /)
  })

  await check('KNOWN POSITIVE: the pre-fix mixed drain with no movement is found', () => {
    assert.ok(drains.has(lotMixed), JSON.stringify(rows))
    const row = rows.find((r) => r.signal === 'orphan_drain' && Number(r.batch_id) === lotMixed)
    // The signature: the lot ledger and the aggregate agree (2 drained from
    // both), the movement ledger has nothing. 3 unlotted units remain.
    assert.strictEqual(Number(row.branch_stock_now), 3)
    assert.strictEqual(Number(row.lot_stock_now), 0)
    assert.strictEqual(Number(row.product_id), pMixed)
  })

  await check('positives: a late movement, another branch, another product do not clear a drain', () => {
    assert.ok(drains.has(lotLate), 'movement ten minutes later')
    assert.ok(drains.has(lotOtherBranch), 'movement at the other branch only')
    assert.ok(drains.has(lotOtherProduct), 'another product moved at that moment')
  })

  await check('KNOWN NEGATIVE: the same drain with its movement is not flagged', () => {
    assert.ok(!drains.has(lotClean))
  })

  await check('negatives: inside the window, either timestamp shape, and a partly drained lot', () => {
    assert.ok(!drains.has(lotNear), '119 s')
    assert.ok(!drains.has(lotShape), 'ISO vs plain timestamp')
    assert.ok(!drains.has(lotPartial), 'lot still above 0')
  })

  await check('KNOWN NEGATIVE: lots the products-import snapshot zeroed or restamped are not flagged', () => {
    const lotRow = db.prepare('SELECT quantity, updated_at FROM branch_batch_stock WHERE batch_id = ?')
    const kept = lotRow.get(lotImportKept)
    assert.deepStrictEqual([kept.quantity, lotRow.get(lotImportTrimmed).quantity], [3, 0], 'the fixture is the real trim')
    assert.strictEqual(lotRow.get(lotImportTrimmed).updated_at, kept.updated_at, 'one statement stamped both lots')
    assert.strictEqual(lotRow.get(lotImportRestamped).quantity, 0)
    assert.strictEqual(lotRow.get(lotImportRestamped).updated_at, lotRow.get(lotImportRestampKept).updated_at, 'the import restamped the sold-out lot with its sibling')
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM inventory_movements WHERE product_id IN (?, ?) AND created_at > ?').get(pImportTrim, pImportRestamp, '2026-06-01 10:00:00').n, 0, 'the import wrote no movement')
    assert.ok(!drains.has(lotImportTrimmed), 'a lot the import trimmed to 0')
    assert.ok(!drains.has(lotImportRestamped), 'a lot sold to 0 that the import restamped')
  })

  await check('positives the import exclusion must keep: two lots drained together, a drain beside later or other-branch stock', () => {
    assert.ok(drains.has(lotTwoFirst) && drains.has(lotTwoSecond), 'two lots drained in one removal share a stamp, both at 0')
    assert.ok(drains.has(lotRestockedDrain), 'a lot received later holds stock under another stamp')
    assert.ok(drains.has(lotOtherBranchKeptDrain), 'a lot of the same product kept stock at the OTHER branch at that instant')
  })

  await check('receipt signal: written-then-failed and stale-unfinished only', () => {
    assert.ok(receipts.has(rCheck), 'written=1 + 400')
    assert.ok(receipts.has(rStale), 'written=1, unfinished for 10 minutes')
    assert.ok(!receipts.has(rOk), 'a completed 200')
    assert.ok(!receipts.has(rRefused), 'an unwritten refusal')
    assert.ok(!receipts.has(rInFlight), 'a request still in flight')
    const row = rows.find((r) => r.signal === 'receipt' && Number(r.receipt_id) === rCheck)
    assert.strictEqual(Number(row.product_id), pMixed)
    assert.strictEqual(Number(row.branch_id), 1)
    assert.strictEqual(row.request_type, 'remove')
    assert.strictEqual(Number(row.quantity), 4)
    assert.match(row.detail, /CHECK constraint failed/)
    assert.strictEqual(Number(row.branch_stock_now), 3)
  })

  await check('exactly the known positives, nothing else', () => {
    assert.deepStrictEqual([...drains].sort((a, b) => a - b),
      [lotMixed, lotLate, lotOtherBranch, lotOtherProduct, lotTwoFirst, lotTwoSecond, lotRestockedDrain, lotOtherBranchKeptDrain].sort((a, b) => a - b))
    assert.deepStrictEqual([...receipts].sort((a, b) => a - b), [rCheck, rStale])
  })

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed) process.exit(1)
})().catch((err) => { console.error(err); process.exit(1) })
