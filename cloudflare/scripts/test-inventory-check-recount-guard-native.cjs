'use strict'
// A recount is refused while the line it would replace is being applied (review of 17 Nov 2026, Medium 3).
//
// An approval that applies a product with several differing received dates plans each date under its own key ("<product id>:<batch id>"), not under the product id. The guard of a recount
// (BEING_APPLIED_SQL in lib/inventoryCheckSessions.ts) asked only for the key "<product id>", so it never saw such a line: the recount answered 201, replaced the line, and the older approval
// then ended "Replaced by a newer count" with an empty closed record although one of its dates had already landed in stock. The guard now matches every key form of the product, in the plan
// AND in the units already landed and not yet folded into a line (applied_json.units), so a half-applied product can never be replaced; the approver finishes it or closes it (recorded as partial).
//
// Real submissions and approvals through the real routes over the real migrations (in-memory SQLite). Each scenario is replayed against the planted old guard and must fail there.
// Run: node scripts/test-inventory-check-recount-guard-native.cjs
const assert = require('node:assert/strict')
const { createLotSetWorld } = require('./harness/lot_set_world.cjs')

const ON = { ic_simple: 'on', ic_fix_stock: 'on', ic_lot_counts: 'on', ic_wired: 'on' }
const failures = []
async function check(name, run) { try { await run(); console.log('PASS ' + name) } catch (error) { failures.push(name); console.error('FAIL ' + name, error) } }

// The guard as it was in round 2 (the plan key "<product id>" only) and a guard that matches every key form of the plan but ignores the dates already landed.
const GUARD = "    AND (EXISTS(SELECT 1 FROM json_each(a.plan_json) k WHERE ${keyOfProductSql('k.key', 'i.product_id')})\n      OR EXISTS(SELECT 1 FROM json_each(a.applied_json,'$.units') k WHERE ${keyOfProductSql('k.key', 'i.product_id')}))`"
const MUTANTS = {
  'plan key "<product id>" only (round 2)': { 'lib/inventoryCheckSessions.ts': [[GUARD, "    AND json_extract(a.plan_json,'$.\"'||i.product_id||'\"') IS NOT NULL`"]] },
  'landed dates ignored': { 'lib/inventoryCheckSessions.ts': [[GUARD, "    AND EXISTS(SELECT 1 FROM json_each(a.plan_json) k WHERE ${keyOfProductSql('k.key', 'i.product_id')})`"]] },
}
// Which scenarios each planted mutant must be caught by.
const CAUGHT_BY = { 'plan key "<product id>" only (round 2)': ['refused', 'heldHolds', 'closedRecord'], 'landed dates ignored': ['heldHolds'] }

function kit(sourceEdits) {
  const w = createLotSetWorld({ admin: true, ...(sourceEdits ? { sourceEdits } : {}) })
  const planTier = w.load('lib/planTier.ts')
  const world = () => {
    const f = w.world({ switches: ON })
    w.seed(f, "UPDATE branch_batch_stock SET quantity=5 WHERE batch_id=10; UPDATE branch_batch_stock SET quantity=4 WHERE batch_id=11; UPDATE branch_stock SET quantity=9 WHERE product_id=1; UPDATE products SET stock_quantity=9 WHERE id=1;" +
      "INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,stock_quantity,is_active) VALUES(2,'Toner','TON',1,0,6,1);" +
      "INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,6);" +
      "INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,batch_number,unit_cost_usd,is_active) VALUES(20,2,'T1','T1','2026-09-03',1,1,1);" +
      "INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(20,1,6);")
    f.raw.exec('UPDATE users SET is_active=0 WHERE id=8') // the sole approver may decide the count he submitted
    return f
  }
  const submit = (f, requestId, lines) => { planTier.__resetPlanTierCacheForTests(); return w.call(f, 'POST', '/api/inventory-checks/submissions', { branchId: 1, requestId, lines }) }
  const decide = (f, id, body) => { planTier.__resetPlanTierCacheForTests(); return w.call(f, 'POST', `/api/inventory-checks/sessions/${id}/approval`, body) }
  const approvals = f => f.raw.prepare('SELECT * FROM inventory_check_approvals ORDER BY submitted_at, rowid').all()
  const lots = f => f.raw.prepare('SELECT batch_id,quantity FROM branch_batch_stock WHERE batch_id IN (10,11) ORDER BY batch_id').all().map(row => [row.batch_id, row.quantity])
  return { w, world, submit, decide, approvals, lots }
}

// Product 1: A (batch 10) counted 6 of 5, B (batch 11) counted 2 of 4: two differing dates, so the engine plans "1:10" and "1:11".
const TWO_DATES = { productId: 1, lots: [{ batchId: 10, scope: 'lot', counted: 6, seen: 5 }, { batchId: 11, scope: 'lot', counted: 2, seen: 4 }] }
const RECOUNT = { productId: 1, lots: [{ batchId: 10, scope: 'lot', counted: 4, seen: 5 }, { batchId: 11, scope: 'lot', counted: 2, seen: 2 }] }
/** Approves with the write of the FIRST date lost (it never reaches the database): the second date lands, the approval stays claimed, its plan holds the first. */
async function halfApplied(k, f, tag) {
  const made = await k.submit(f, `rg-submit-${tag}`, [TWO_DATES])
  assert.equal(made.status, 201, JSON.stringify(made.body))
  const id = k.approvals(f)[0].session_id
  let fired = 0
  f.control.before = () => { fired++; throw new Error('simulated: the stock write never reached the database') }
  f.control.beforeMatch = statements => statements.some(s => typeof s.sql === 'string' && /branch_batch_stock/.test(s.sql) && /^\s*(UPDATE|INSERT)/i.test(s.sql))
  const first = await k.decide(f, id, { decision: 'approve', requestId: `rg-approve-${tag}` }).catch(error => ({ status: 'threw', body: { code: error.message } }))
  f.control.before = null
  assert.equal(fired, 1, 'the simulated loss fired once')
  const row = k.approvals(f)[0]
  assert.ok(row.applying_request_id, `the approval is still claimed (approve answered ${first.status} ${first.body.code || ''})`)
  assert.deepEqual(Object.keys(JSON.parse(row.plan_json)), ['1:10'], 'the plan holds the date that did not land, under its dated key')
  assert.deepEqual(Object.keys(JSON.parse(row.applied_json).units ?? {}), ['1:11'], 'the date that landed is held, not yet a line')
  assert.deepEqual(k.lots(f), [[10, 5], [11, 2]], 'date B landed, date A did not')
  return { id, row }
}

/** Medium 3: a recount of a product with a half-applied dated line is refused, whichever key form its plan carries. */
async function refused(k) {
  const f = k.world()
  const { id } = await halfApplied(k, f, 'one')
  const recount = await k.submit(f, 'rg-recount-0001', [RECOUNT])
  assert.equal(recount.status, 409, JSON.stringify(recount.body)); assert.equal(recount.body.code, 'inventory_check_count_in_progress')
  assert.deepEqual(recount.body.productIds, [1], 'the answer names the product that is being applied')
  const rows = k.approvals(f)
  assert.equal(rows.length, 1, 'the refused recount recorded nothing'); assert.equal(rows[0].status, 'pending'); assert.equal(rows[0].superseded_json, '{}')
  assert.equal(rows[0].session_id, id)
}

/** The units already landed hold the product even when the plan is empty (a takeover clears the plan before the new claimer plans again). */
async function heldHolds(k) {
  const f = k.world()
  await halfApplied(k, f, 'two')
  f.raw.exec("UPDATE inventory_check_approvals SET plan_json='{}'")
  const recount = await k.submit(f, 'rg-recount-0002', [RECOUNT])
  assert.equal(recount.status, 409, JSON.stringify(recount.body)); assert.equal(recount.body.code, 'inventory_check_count_in_progress')
  assert.equal(k.approvals(f)[0].superseded_json, '{}')
}

/** Controls: a plain-total line planned under its bare product key is still refused, and an approval whose write never landed is released, so a recount replaces it. */
async function controls(k) {
  const f = k.world()
  const made = await k.submit(f, 'rg-submit-0003', [{ productId: 2, countedQuantity: 5, seenQuantity: 6 }])
  assert.equal(made.status, 201, JSON.stringify(made.body))
  const id = k.approvals(f)[0].session_id
  f.raw.prepare("UPDATE inventory_check_approvals SET applying_request_id='rg-claim-0001',applying_by=7,applying_at=?,plan_json=? WHERE session_id=?")
    .run(new Date().toISOString(), JSON.stringify({ 2: { lot: 20, scope: 'branch', counted: 5, seen: 6 } }), id)
  const refusedRecount = await k.submit(f, 'rg-recount-0003', [{ productId: 2, countedQuantity: 4, seenQuantity: 6 }])
  assert.equal(refusedRecount.status, 409, JSON.stringify(refusedRecount.body)); assert.equal(refusedRecount.body.code, 'inventory_check_count_in_progress')
  // Another product of the same approval's branch is not held by it.
  const other = await k.submit(f, 'rg-recount-0004', [{ productId: 1, lots: [{ batchId: 10, scope: 'lot', counted: 5, seen: 5 }, { batchId: 11, scope: 'lot', counted: 4, seen: 4 }] }])
  assert.equal(other.status, 201, JSON.stringify(other.body))
  // Released (nothing landed): the claim is gone and a recount replaces the approval. Product 2 (one plain line, key '2'): its only write is lost.
  const g = k.world()
  await k.submit(g, 'rg-submit-0005', [{ productId: 2, countedQuantity: 5, seenQuantity: 6 }])
  const gid = k.approvals(g)[0].session_id
  g.control.before = () => { throw new Error('simulated: the stock write never reached the database') }
  g.control.beforeMatch = statements => statements.some(s => typeof s.sql === 'string' && /branch_batch_stock/.test(s.sql) && /^\s*(UPDATE|INSERT)/i.test(s.sql))
  await k.decide(g, gid, { decision: 'approve', requestId: 'rg-approve-0005' }).catch(() => undefined)
  g.control.before = null
  const released = k.approvals(g)[0]
  assert.equal(released.applying_request_id, null, 'nothing landed: the claim was released'); assert.equal(released.applied_json, '{}')
  const recount = await k.submit(g, 'rg-recount-0005', [{ productId: 2, countedQuantity: 4, seenQuantity: 6 }])
  assert.equal(recount.status, 201, JSON.stringify(recount.body))
  assert.equal(k.approvals(g)[0].status, 'rejected'); assert.equal(k.approvals(g)[0].decision_note, 'Replaced by a newer count')
}

/** The record agrees with the stock: a half-applied approval, closed by the approver after the refused recount, records the date that landed as partial and moves no more stock. */
async function closedRecord(k) {
  const f = k.world()
  const { id } = await halfApplied(k, f, 'three')
  const recount = await k.submit(f, 'rg-recount-0006', [RECOUNT])
  assert.equal(recount.status, 409)
  const closed = await k.decide(f, id, { decision: 'close', requestId: 'rg-close-0001' })
  assert.equal(closed.status, 200, JSON.stringify(closed.body))
  const row = k.approvals(f)[0]
  assert.equal(row.status, 'approved', 'a date landed, so it ended approved, never "Replaced"'); assert.notEqual(row.decision_note, 'Replaced by a newer count')
  const applied = JSON.parse(row.applied_json)
  assert.deepEqual(Object.keys(applied.lines), ['1'], 'the applied line is recorded'); assert.equal(applied.lines['1'].partial, true, 'marked partial')
  assert.deepEqual(applied.lines['1'].lots.map(lot => [lot.batchId, lot.after]), [[11, 2]], 'with the date that landed')
  assert.deepEqual(k.lots(f), [[10, 5], [11, 2]], 'stock is what the record says')
  // Now the recount can be made, and it is measured from the stock that is there.
  const again = await k.submit(f, 'rg-recount-0007', [{ productId: 1, lots: [{ batchId: 10, scope: 'lot', counted: 4, seen: 5 }, { batchId: 11, scope: 'lot', counted: 2, seen: 2 }] }])
  assert.equal(again.status, 201, JSON.stringify(again.body))
}

const SCENARIOS = {
  refused: { run: refused, title: 'a recount of a product whose dated line is half applied (plan key "1:10") is refused with count_in_progress and replaces nothing' },
  heldHolds: { run: heldHolds, title: 'a product with a date already landed (applied_json.units) is held even when the plan is empty' },
  controls: { run: controls, title: 'controls: a bare product key is still held, another product is not, and an approval whose writes never landed is released and replaced' },
  closedRecord: { run: closedRecord, title: 'the closed record of a half-applied approval agrees with the stock it wrote (approved, the landed date recorded as partial), never "Replaced" with no lines' },
}

async function main() {
  for (const { title, run } of Object.values(SCENARIOS)) await check(title, () => run(kit()))
  // Every scenario the guard fixes must FAIL against the old guard text: a green test that cannot fail proves nothing.
  for (const [mutant, edits] of Object.entries(MUTANTS)) {
    for (const name of CAUGHT_BY[mutant]) {
      const mutated = kit(edits) // built outside the try: an edit that no longer matches the source is an error, never a catch
      let caught = false
      try { await SCENARIOS[name].run(mutated) } catch { caught = true }
      await check(`mutant "${mutant}" is caught by ${name}`, () => assert.ok(caught, 'the scenario passed against the old guard'))
    }
  }
  if (failures.length) { console.error(`FAILED ${failures.length}: ${failures.join(' | ')}`); process.exit(1) }
  console.log('PASS test-inventory-check-recount-guard-native')
}
main().catch(error => { console.error(error); process.exit(1) })
