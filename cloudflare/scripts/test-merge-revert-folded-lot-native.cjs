'use strict'
// E1 (round-4 review, 16 Nov 2026): after a product merge folds a duplicate's lot into the kept product's same-date lot, a Revert of a stock change
// made BEFORE the merge on that folded lot is refused (the movement still names the folded lot, which stays on the discarded product).
// Lead ruling: keep the refusal (it is the safe design: pointing the movement at the kept lot would take units and money off a lot that never
// had that receipt) but say WHY: when the lot was merged away (it carries merge_deactivated_at) the answer is the existing merged-products
// sentence (lib/stockRevert.ts MERGED_LOT_REFUSAL), not "Selected received date does not belong to this product". Same status (400), same
// stable code (revert_lot_moved), nothing written. The screen already translates by that code (frontend/src/utils/stockRevertError.ts,
// revert_err_lot_moved in both packs), so only the server's own message changes.
// Drives the REAL receive route (POST /adjust), the real merge route and the real Revert route on the node:sqlite harness.
// Run (from cloudflare/): node scripts/test-merge-revert-folded-lot-native.cjs
const assert = require('node:assert/strict')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')

const ADMIN = { id: 7, username: 'admin', name: 'Admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }
const ctx = { waitUntil() {}, passThroughOnException() {} }
const MERGED = 'This change moved stock on a received date that now belongs to another product (the products were merged), so it cannot be reverted here. Nothing was changed; correct it with a new count instead.'
const GENERIC = 'Selected received date does not belong to this product'
let passed = 0
let failed = 0
async function check(name, run) {
  try { await run(); passed++; console.log(`PASS ${name}`) } catch (error) { failed++; console.error(`FAIL ${name}\n${error.stack}`) }
}
function fixtureWrite(h, run) {
  h.raw.db.exec("BEGIN; INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
  try { run(); h.raw.db.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'; COMMIT") } catch (e) { h.raw.db.exec('ROLLBACK'); throw e }
}
const call = async (h, route, method, url, body) => {
  const app = h.load(route).default
  const init = { method, headers: { 'content-type': 'application/json' } }
  if (body) init.body = JSON.stringify(body)
  const r = await app.request('http://local' + url, init, { DB: h.raw }, ctx)
  return { status: r.status, json: await r.json().catch(() => null) }
}

// Keeper 1 owns lot 101 (key K-1, 3 Nov). Discarded 2 owns lot 201 (key D-1, 3 Nov: a DIFFERENT key, the normal same-date fold), lot 205 (key K-1, 3 Nov:
// the SAME key as the keeper's lot, base's own fold) and lot 202 (5 Nov, never merged in the controls).
function world() {
  const h = createProductsRouteHarness({ user: ADMIN })
  fixtureWrite(h, () => h.raw.db.exec(`INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1),(2,'Warehouse',1,0);
    INSERT INTO products(id,name,barcode,is_active,stock_quantity,cost_price_usd,purchase_price_usd,selling_price_usd,selling_price_khr,wholesale_price_usd) VALUES
      (1,'Twin Serum','777',1,8,2,2,10,40000,8),(2,'Twin Serum','777',1,9,2.4,2.4,10,40000,8);
    INSERT INTO product_batches(id,variant_product_id,batch_key,batch_number,lot_code,received_at,unit_cost_usd,is_active,received_quantity) VALUES
      (101,1,'K-1',1,'K-1','2026-11-03',2,1,8),(201,2,'D-1',1,'D-1','2026-11-03',2.4,1,3),(205,2,'K-1',2,'K-1','2026-11-03',2.4,1,3),(202,2,'D-2',3,'D-2','2026-11-05',2.4,1,3);
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,8),(2,1,9);
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(101,1,8),(201,1,3),(205,1,3),(202,1,3);`))
  return h
}
// A movement as the old ledger holds it: a receipt stamped with its lot (what a pre-merge receive or count wrote).
function stamp(h, productId, lotId, quantity) {
  fixtureWrite(h, () => h.raw.db.prepare("INSERT INTO inventory_movements(product_id,product_name,branch_id,branch_name,movement_type,quantity,unit_cost_usd,total_cost_usd,reason,batch_id,created_at) VALUES(?,'Twin Serum',1,'Shop','in',?,2.4,?,'receive',?,'2026-11-03 03:00:00')").run(productId, quantity, 2.4 * quantity, lotId))
  return h.raw.db.prepare('SELECT MAX(id) id FROM inventory_movements').get().id
}
let seq = 0
// The REAL receive: a dated add on the discarded product, which writes its own lot and movement.
async function receive(h, productId, receivedDate, batchLabel) {
  const r = await call(h, 'routes/inventory.ts', 'POST', '/adjust', {
    client_request_id: `e1_receive_${++seq}_abcdefgh`, productId, type: 'add', quantity: 2, reason: 'Restock', branchId: 1, supplierName: 'Acme', unitCostUsd: 2.4, batchId: 'new', receivedDate, batchLabel,
  })
  assert.equal(r.status, 200, JSON.stringify(r))
  const movement = h.raw.db.prepare("SELECT id, batch_id FROM inventory_movements WHERE product_id=? AND movement_type = 'add' ORDER BY id DESC LIMIT 1").get(productId)
  assert.ok(movement && movement.batch_id, 'the real receive stamped its lot on the movement: ' + JSON.stringify(movement))
  return movement
}
const snapshot = (h) => JSON.stringify({
  movements: h.raw.db.prepare('SELECT id,product_id,batch_id,quantity,movement_type,reason FROM inventory_movements ORDER BY id').all(),
  lotStock: h.raw.db.prepare('SELECT batch_id,branch_id,quantity FROM branch_batch_stock ORDER BY batch_id,branch_id').all(),
  branchStock: h.raw.db.prepare('SELECT product_id,branch_id,quantity FROM branch_stock ORDER BY product_id,branch_id').all(),
  lots: h.raw.db.prepare('SELECT id,variant_product_id,is_active,received_quantity,received_cost_usd,merge_deactivated_at IS NOT NULL AS marked FROM product_batches ORDER BY id').all(),
})
const revert = (h, id) => call(h, 'routes/inventory.ts', 'POST', `/movements/${id}/revert`, {})
const merge = (h) => h.request('POST', '/possible-duplicates/merge', { keepId: 1, mergeId: 2, stock: 'merge' })

async function main() {
  await check('E1: a receive on a folded same-date lot, then the merge, then Revert: 400 revert_lot_moved with the MERGED message, nothing written', async () => {
    const h = world()
    const movement = await receive(h, 2, '03/11/2026', 'R-9')
    const lot = h.raw.db.prepare('SELECT variant_product_id p, batch_key, received_at FROM product_batches WHERE id=?').get(movement.batch_id)
    assert.equal(lot.p, 2)
    const m = await merge(h)
    assert.equal(m.status, 200, JSON.stringify(m.json))
    const after = h.raw.db.prepare('SELECT variant_product_id p, is_active a, merge_deactivated_at IS NOT NULL AS marked FROM product_batches WHERE id=?').get(movement.batch_id)
    assert.deepEqual({ ...after }, { p: 2, a: 0, marked: 1 }, 'the receive lot was folded: inactive, marked, still on the discarded product')
    const before = snapshot(h)
    const r = await revert(h, movement.id)
    assert.equal(r.status, 400, JSON.stringify(r.json))
    assert.equal(r.json.code, 'revert_lot_moved')
    assert.equal(r.json.error, MERGED)
    assert.equal(snapshot(h), before, 'nothing was written')
    assert.equal(h.raw.db.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE reason LIKE '%Revert%' OR reason LIKE '%revert%'").get().n, 0)
  })

  await check('E1 (reviewer probe shape): a stamped receive on duplicate lot 201 (key D-1, same date as kept lot 101), merge, Revert: the merged message, nothing written', async () => {
    const h = world()
    const mv = stamp(h, 2, 201, 3)
    assert.equal((await merge(h)).status, 200)
    assert.equal(h.raw.db.prepare('SELECT product_id p, batch_id b FROM inventory_movements WHERE id=?').get(mv).p, 1, 'the movement now belongs to the keeper')
    const before = snapshot(h)
    const r = await revert(h, mv)
    assert.deepEqual([r.status, r.json.code, r.json.error], [400, 'revert_lot_moved', MERGED])
    assert.equal(snapshot(h), before)
  })

  await check('same-key fold (base folds this one too): still 400 revert_lot_moved, nothing written, and it names the merge', async () => {
    const h = world()
    const mv = stamp(h, 2, 205, 3)
    assert.equal((await merge(h)).status, 200)
    const before = snapshot(h)
    const r = await revert(h, mv)
    assert.deepEqual([r.status, r.json.code], [400, 'revert_lot_moved'])
    assert.equal(r.json.error, MERGED)
    assert.equal(snapshot(h), before)
  })

  await check('control: the same receive and Revert on a lot that was NOT merged still reverts (200), the lot loses its units', async () => {
    const h = world()
    const movement = await receive(h, 2, '03/11/2026', 'R-9')
    const lotBefore = h.raw.db.prepare('SELECT quantity q FROM branch_batch_stock WHERE batch_id=? AND branch_id=1').get(movement.batch_id).q
    const r = await revert(h, movement.id)
    assert.equal(r.status, 200, JSON.stringify(r.json))
    const lotAfter = h.raw.db.prepare('SELECT quantity q FROM branch_batch_stock WHERE batch_id=? AND branch_id=1').get(movement.batch_id).q
    assert.equal(lotAfter, lotBefore - 2)
  })

  await check('control: a lot of another product that no merge touched keeps the GENERIC message (the merged sentence is only for merge-marked lots)', async () => {
    const h = world()
    const mv = stamp(h, 1, 202, 3) // lot 202 belongs to product 2 and carries no merge marker
    assert.equal(h.raw.db.prepare('SELECT merge_deactivated_at m FROM product_batches WHERE id=202').get().m, null)
    const before = snapshot(h)
    const r = await revert(h, mv)
    assert.deepEqual([r.status, r.json.code, r.json.error], [400, 'revert_lot_moved', GENERIC])
    assert.equal(snapshot(h), before)
  })

  await check('control: the merged message is not shown for a merge-marked lot that is under the product being reverted', async () => {
    const h = world()
    const mv = stamp(h, 2, 201, 3)
    fixtureWrite(h, () => h.raw.db.exec('UPDATE product_batches SET merge_deactivated_at = CURRENT_TIMESTAMP WHERE id=201'))
    const r = await revert(h, mv)
    assert.notEqual(r.json && r.json.error, MERGED, 'the lot is on the movement\'s own product, so the merge is not why it would fail')
  })

  console.log(`${passed} passed, ${failed} failed`)
  if (failed) process.exit(1)
  console.log('test-merge-revert-folded-lot-native: all checks passed')
}
main().catch((error) => { console.error(error); process.exit(1) })
