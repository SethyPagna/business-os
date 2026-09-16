// Regression coverage for the sale 16980 / sale_item 40441 production defect:
// amending a line's quantity UP moved branch_stock and inventory_movements for
// the full new quantity but left sale_item_batch_allocations untouched, so a
// later cancel/return/complete transition (which walks ONLY the allocation
// rows to decide how much to give back to branch_batch_stock) restored fewer
// units than the aggregate ledger had taken. See lib/saleAmendments.ts's
// planLineQuantityIncrease and the AllocationShortfallError it now throws.
//
// Reuses the real Hono route and the full migrated SQLite schema exactly the
// way test-historical-sale-edit-native.cjs does -- load test-sale-create-
// atomic-pure.cjs's fixture module up to its own async IIFE boundary and
// drive the real /amendments and /status endpoints against it.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const file = path.join(__dirname, 'test-sale-create-atomic-pure.cjs')
const source = fs.readFileSync(file, 'utf8')
const boundary = source.indexOf(';(async () => {')
assert.ok(boundary > 0)
const fixtureModule = new Module(file, module)
fixtureModule.filename = file
fixtureModule.paths = module.paths
fixtureModule._compile(
  source.slice(0, boundary) + '\nmodule.exports={fixture,request,postSale,app,executionCtx,load,USER,setUser(value){currentUser=value}};',
  file,
)
const h = fixtureModule.exports

function allocationsOf(db, saleItemId) {
  return db.prepare('SELECT * FROM sale_item_batch_allocations WHERE sale_item_id=? ORDER BY id ASC').all([saleItemId])
}

const dispatchAmend = async (route, saleId, body) => {
  const response = await h.app.request(`/${saleId}/amendments`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }, { DB: route }, h.executionCtx)
  return { status: response.status, body: await response.json() }
}
// Every amendment that changes the sale's total goes through
// reviewSaleHeaderQuote's two-step handshake: the first call is refused with
// the exact quote to review, and only a second call carrying that quote back
// is committed. A caller that already knows it wants a refusal (the
// shortfall scenario) uses dispatchAmend directly instead.
const amend = async (route, saleId, body) => {
  const first = await dispatchAmend(route, saleId, body)
  if (first.status !== 409 || first.body.code !== 'sale_header_quote_conflict') return first
  return dispatchAmend(route, saleId, { ...body, expected_header_quote: first.body.header_quote })
}
const setStatus = async (route, saleId, body) => {
  const response = await h.app.request(`/${saleId}/status`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }, { DB: route }, h.executionCtx)
  return { status: response.status, body: await response.json() }
}

;(async () => {
  h.setUser({ ...h.USER, permissions: '{"all":true}' })
  // ---- Scenario 1: the FIFO lot the line already used still has enough --
  // the increase must EXTEND the existing allocation row (not fragment it
  // into a sibling row), the decrease must shrink it symmetrically, and a
  // cancel must give back to branch_batch_stock exactly what the amended
  // quantity actually held. ----
  {
    const f = h.fixture()
    const created = await h.postSale(f.route, h.request('alloc-sync-create'))
    assert.equal(created.status, 200, JSON.stringify(created.body))
    const saleId = created.body.sale.id
    const lineId = created.body.sale.items[0].id

    // The route only treats awaiting_payment as holding stock through
    // heldQuantity()/STOCK_DEDUCTED_STATUSES -- force the status the
    // production sale (16980) was actually in when it was amended, without
    // moving any stock a second time (S4-3: awaiting_payment already holds).
    f.raw.prepare("UPDATE sales SET sale_status='awaiting_payment' WHERE id=?").run([saleId])

    const before = allocationsOf(f.raw, lineId)
    assert.equal(before.length, 1, 'checkout left one allocation row on batch 500')
    assert.equal(before[0].quantity, 1)
    assert.equal(before[0].released_quantity, 0)
    assert.equal(f.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=1').get().quantity, 9)
    assert.equal(f.raw.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=500 AND branch_id=1').get().quantity, 9)

    // ---- increase 1 -> 2 ----
    const increased = await amend(f.route, saleId, {
      kind: 'line_quantity_increased', money_precision_version: 1, client_request_id: 'alloc-sync-increase',
      expected_exchange_rate: 4000, sale_item_id: lineId, quantity: 1,
      pricing_quote: { gross_usd: 19, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 19, total_khr: 76000 },
    })
    assert.equal(increased.status, 200, JSON.stringify(increased.body))
    assert.equal(increased.body.sale.items[0].quantity, 2)

    const afterIncrease = allocationsOf(f.raw, lineId)
    // THE regression check: one row, extended in place -- not a second row
    // for the same (sale_item_id, batch_id) pair. Before the fix this array
    // had length 2 (the original row untouched at quantity 1, plus a new
    // row for the added unit) -- the production symptom, generalized: any
    // reader that looks up "the" allocation for this batch by a single row
    // rather than summing finds the stale, pre-amendment quantity.
    assert.equal(afterIncrease.length, 1, 'the existing allocation row is extended, not fragmented')
    assert.equal(afterIncrease[0].id, before[0].id)
    assert.equal(afterIncrease[0].quantity, 2, 'allocation quantity follows the line to 2')
    assert.equal(afterIncrease[0].released_quantity, 0, 'the new unit is out with the sale too')
    assert.equal(f.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=1').get().quantity, 8)
    assert.equal(f.raw.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=500 AND branch_id=1').get().quantity, 8)
    const movedAfterIncrease = f.raw.prepare(
      "SELECT COALESCE(SUM(quantity),0) AS total FROM inventory_movements WHERE product_id=10 AND movement_type='sale'",
    ).get().total
    assert.equal(movedAfterIncrease, -2, 'the checkout -1 and the amendment -1 sum to the full -2 the shelf actually lost')

    // ---- decrease 2 -> 1 ----
    const decreased = await amend(f.route, saleId, {
      kind: 'line_quantity_decreased', money_precision_version: 1, client_request_id: 'alloc-sync-decrease',
      expected_exchange_rate: 4000, sale_item_id: lineId, quantity: 1,
      pricing_quote: { gross_usd: 9.5, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 9.5, total_khr: 38000 },
    })
    assert.equal(decreased.status, 200, JSON.stringify(decreased.body))
    assert.equal(decreased.body.sale.items[0].quantity, 1)

    const afterDecrease = allocationsOf(f.raw, lineId)
    assert.equal(afterDecrease.length, 1)
    assert.equal(afterDecrease[0].id, before[0].id)
    assert.equal(afterDecrease[0].quantity, 1, 'the decrease shrinks the SAME row symmetrically')
    assert.equal(afterDecrease[0].released_quantity, 0)
    assert.equal(f.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=1').get().quantity, 9)
    assert.equal(f.raw.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=500 AND branch_id=1').get().quantity, 9)

    // ---- cancel: must release EXACTLY the amended (post-decrease) quantity,
    // not the pre-amendment one and not double it. ----
    const cancelled = await setStatus(f.route, saleId, {
      client_request_id: 'alloc-sync-cancel', sale_status: 'cancelled', cancel_reason: 'mistake', expected_exchange_rate: 4000,
    })
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body))
    assert.equal(f.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=1').get().quantity, 10, 'the full 10 is back on the shelf')
    assert.equal(f.raw.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=500 AND branch_id=1').get().quantity, 10, 'and the LOT ledger agrees -- this is what production diverged on')
    const afterCancel = allocationsOf(f.raw, lineId)
    assert.equal(afterCancel.length, 1)
    assert.equal(afterCancel[0].released_quantity, 1, 'released_quantity tracks the single unit actually out at cancel time')
  }
  console.log('PASS 1 -- a covered increase extends the existing allocation row; the decrease and the cancel stay symmetric')

  // ---- Scenario 2: the batch this line already drew from is exhausted (a
  // legacy branch_stock/branch_batch_stock drift, exactly what allocateAcrossLots
  // itself calls "legacy stock the lot ledger doesn't know about") -- refuse
  // the increase outright rather than silently deducting branch_stock and
  // inventory_movements for units sale_item_batch_allocations never learns
  // about. This is the exact shape of the production defect: before the fix
  // this succeeded with status 200 and left the allocation row's quantity
  // stale while branch_stock and inventory_movements moved the full amount. ----
  {
    const f = h.fixture()
    const created = await h.postSale(f.route, h.request('alloc-shortfall-create'))
    assert.equal(created.status, 200, JSON.stringify(created.body))
    const saleId = created.body.sale.id
    const lineId = created.body.sale.items[0].id
    f.raw.prepare("UPDATE sales SET sale_status='awaiting_payment' WHERE id=?").run([saleId])
    // Simulate the batch this line's own allocation points at having no
    // available lot stock left, while branch_stock (the aggregate) still
    // shows units on hand -- the two-ledger drift this codebase already
    // tolerates for a line that was NEVER batch-tracked (see
    // allocateAcrossLots's own "uncovered" comment), but must not tolerate
    // for a line that IS already batch-tracked (existingAllocations.length>0).
    f.raw.prepare('UPDATE branch_batch_stock SET quantity=0 WHERE batch_id=500 AND branch_id=1').run()

    const before = { stock: f.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=1').get().quantity,
      allocation: allocationsOf(f.raw, lineId)[0], item: f.raw.prepare('SELECT quantity FROM sale_items WHERE id=?').get([lineId]) }

    const refused = await amend(f.route, saleId, {
      kind: 'line_quantity_increased', money_precision_version: 1, client_request_id: 'alloc-shortfall-increase',
      expected_exchange_rate: 4000, sale_item_id: lineId, quantity: 1,
      pricing_quote: { gross_usd: 19, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 19, total_khr: 76000 },
    })
    assert.equal(refused.status, 409, JSON.stringify(refused.body))
    assert.equal(refused.body.code, 'sale_amendment_allocation_shortfall')

    // Nothing half-applied: the exact same "nothing half-applies" invariant
    // PASS 13 of test-sale-amendments-pure.cjs pins for an oversell.
    assert.equal(f.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=1').get().quantity, before.stock)
    assert.equal(f.raw.prepare('SELECT quantity FROM sale_items WHERE id=?').get([lineId]).quantity, before.item.quantity)
    const stillOneRow = allocationsOf(f.raw, lineId)
    assert.equal(stillOneRow.length, 1)
    assert.deepEqual(stillOneRow[0], before.allocation)
  }
  console.log('PASS 2 -- an increase that the tracked lot cannot cover is refused outright, not half-applied')

  console.log('All sale-amendment allocation-sync checks passed.')
})()
