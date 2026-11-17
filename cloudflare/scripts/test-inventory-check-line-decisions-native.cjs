'use strict'
// Per-line decisions on a waiting count (migration 0316), on the REAL routes with the REAL stock writer over every migration:
//   POST /api/inventory-checks/sessions/:id/approval/lines   reject | modify | reopen one line, no stock moves
//   POST /api/inventory-checks/sessions/:id/approval         approve gains productIds (accept some lines); remaining leaves out rejected lines; close keeps its meaning
// Oracle: reject one line of three and approve the rest (the final status is approved, the rejected line's stock never moves, the counter's own figures are never changed); a modified line is applied
// as the variance (modified - seen) on the stock of the moment, floored at 0, never as an absolute Set; every refusal is a coded 4xx; a repeat is safe; the end of the approval is told ONCE.
// Run: node scripts/test-inventory-check-line-decisions-native.cjs
const assert = require('node:assert/strict')
const { createLotSetWorld } = require('./harness/lot_set_world.cjs')

const w = createLotSetWorld({ admin: true })
const planTier = w.load('lib/planTier.ts')
const ON = { ic_simple: 'on', ic_fix_stock: 'on', ic_lot_counts: 'on', ic_wired: 'on' }
const alerts = []
globalThis[Symbol.for('business-os.review-alert.v1')] = { announce: async (_env, event) => { alerts.push(event) }, nameBeforeChange: async () => null }
const lot = (f, batch) => f.raw.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=? AND branch_id=1').get(batch)?.quantity
const failures = []
async function check(name, run) { try { alerts.length = 0; await run(); console.log('PASS ' + name) } catch (error) { failures.push(name); console.error('FAIL ' + name, error) } }
let counter = 0
const rid = () => `line-request-${String(++counter).padStart(5, '0')}`
const decide = (f, id, body) => { planTier.__resetPlanTierCacheForTests(); return w.call(f, 'POST', `/api/inventory-checks/sessions/${id}/approval`, { requestId: rid(), ...body }, body.__env || {}) }
const line = (f, id, body, env = {}) => { planTier.__resetPlanTierCacheForTests(); return w.call(f, 'POST', `/api/inventory-checks/sessions/${id}/approval/lines`, { requestId: rid(), ...body }, env) }
const decisionsOf = f => JSON.parse(f.raw.prepare('SELECT line_decisions_json AS j FROM inventory_check_approvals').get().j)
const approvalRow = f => f.raw.prepare('SELECT status,decided_by,closed_json,applying_request_id,applied_json FROM inventory_check_approvals').get()
const itemCounted = (f, productId) => ({ ...f.raw.prepare('SELECT counted_quantity AS c,baseline_quantity AS b FROM inventory_check_items WHERE product_id=?').get(productId) })
const movements = f => f.raw.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n

/** Three products on one count by the REAL submission: product 1 on two dates (A=5 counted 3, B=4 counted 4), product 2 (5, counted 3), product 3 as one plain total (5, counted 2). The only other administrator is switched off. */
async function three() {
  const f = w.world({ switches: ON })
  w.seed(f, `INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,stock_quantity,is_active) VALUES(2,'Toner','TON',2,0,5,1),(3,'Cream','CRE',2,0,5,1);
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,5),(3,1,5);
    INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,batch_number,unit_cost_usd,is_active) VALUES(20,2,'T','T','2026-09-02',1,3,1),(30,3,'C','C','2026-09-02',1,3,1);
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(20,1,5),(30,1,5);
    UPDATE branch_batch_stock SET quantity=5 WHERE batch_id=10; UPDATE branch_batch_stock SET quantity=4 WHERE batch_id=11; UPDATE branch_stock SET quantity=9 WHERE product_id=1; UPDATE products SET stock_quantity=9 WHERE id=1`)
  f.raw.exec('UPDATE users SET is_active=0 WHERE id=8')
  const made = await w.call(f, 'POST', '/api/inventory-checks/submissions', { branchId: 1, requestId: rid(), lines: [
    { productId: 1, lots: [{ batchId: 10, scope: 'lot', counted: 3, seen: 5 }, { batchId: 11, scope: 'lot', counted: 4, seen: 4 }] },
    { productId: 2, lots: [{ batchId: 20, scope: 'lot', counted: 3, seen: 5 }] },
    { productId: 3, countedQuantity: 2, seenQuantity: 5 }] })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  const id = f.raw.prepare('SELECT session_id FROM inventory_check_approvals').get().session_id
  assert.equal(f.raw.prepare('SELECT lines FROM inventory_check_approvals').get().lines, 3)
  alerts.length = 0
  return { f, id }
}
const sell = (f, batch, product, units) => w.seed(f, `UPDATE branch_batch_stock SET quantity=quantity-${units} WHERE batch_id=${batch}; UPDATE branch_stock SET quantity=quantity-${units} WHERE product_id=${product}; UPDATE products SET stock_quantity=stock_quantity-${units} WHERE id=${product}`)

async function main() {
  await check('reject one line of three, approve the rest: the final status is approved, the rejected line never moves, the counter\'s figures are never changed, the end is told once', async () => {
    const { f, id } = await three()
    const before = { p2: itemCounted(f, 2), movements: movements(f) }
    const rejected = await line(f, id, { productId: 2, action: 'reject', note: 'Recount tomorrow' })
    assert.equal(rejected.status, 200, JSON.stringify(rejected.body)); assert.equal(rejected.body.done, false); assert.equal(rejected.body.remaining, 2); assert.deepEqual(rejected.body.line, { productId: 2, action: 'reject' })
    assert.equal(rejected.body.approval.status, 'pending'); assert.deepEqual(Object.keys(rejected.body.approval.line_decisions), ['2']); assert.equal(rejected.body.approval.line_decisions[2].decision, 'reject'); assert.equal(rejected.body.approval.line_decisions[2].note, 'Recount tomorrow')
    assert.deepEqual(itemCounted(f, 2), before.p2, 'the counter\'s own figures are never changed'); assert.equal(movements(f), before.movements, 'no stock moved'); assert.equal(lot(f, 20), 5)
    assert.equal(alerts.length, 0, 'no alert per line')
    const done = await decide(f, id, { decision: 'approve' })
    assert.equal(done.status, 200, JSON.stringify(done.body)); assert.equal(done.body.done, true); assert.equal(done.body.approval.status, 'approved')
    assert.deepEqual({ A: lot(f, 10), B: lot(f, 11), toner: lot(f, 20), cream: lot(f, 30) }, { A: 3, B: 4, toner: 5, cream: 2 }, 'products 1 and 3 applied, the rejected product 2 untouched')
    assert.deepEqual(Object.keys(done.body.approval.applied_lines).sort(), ['1', '3'])
    assert.equal(alerts.length, 1, 'one alert when the approval ends'); assert.equal(alerts[0].kind, 'approved'); assert.deepEqual(alerts[0].summary, { applied: 2, rejected: 1 })
    const events = f.raw.prepare("SELECT action,product_id FROM inventory_check_events WHERE request_id LIKE 'line-request-%' AND action='observe' ORDER BY id").all()
    assert.ok(events.some(event => event.product_id === 2), 'the decision is an audit event on the product')
  })

  await check('modify 3 -> 4 with a sale between the count and the approval: the result is now + 4 - seen, never the absolute 4', async () => {
    const { f, id } = await three()
    const modified = await line(f, id, { productId: 2, action: 'modify', lots: [{ batchId: 20, counted: 4 }] })
    assert.equal(modified.status, 200, JSON.stringify(modified.body)); assert.deepEqual(modified.body.approval.line_decisions[2].lots, [{ batchId: 20, counted: 4 }]); assert.equal(modified.body.remaining, 3)
    assert.deepEqual(itemCounted(f, 2), { c: 3, b: 5 }, 'the counter\'s figure stays 3')
    sell(f, 20, 2, 1) // live 4
    const done = await decide(f, id, { decision: 'approve' })
    assert.equal(done.status, 200, JSON.stringify(done.body)); assert.equal(done.body.done, true)
    assert.equal(lot(f, 20), 3, 'live 4 + (4 - 5) = 3; an absolute Set would write 4, the counter\'s 3 would write 2')
    const movement = f.raw.prepare("SELECT reason FROM inventory_movements WHERE product_id=2").get()
    assert.match(movement.reason, /^Inventory check approved: counted 4/)
  })

  await check('a modified line is floored at 0 on live stock, and a dated line is modified by its own dates only', async () => {
    const { f, id } = await three()
    assert.equal((await line(f, id, { productId: 2, action: 'modify', lots: [{ batchId: 20, counted: 0 }] })).status, 200)
    sell(f, 20, 2, 4) // live 1; wanted 1 + 0 - 5 = -4
    assert.equal((await line(f, id, { productId: 3, action: 'reject' })).status, 200)
    const dated = await line(f, id, { productId: 1, action: 'modify', lots: [{ batchId: 10, counted: 4 }] })
    assert.equal(dated.status, 200, JSON.stringify(dated.body)); assert.deepEqual(dated.body.approval.line_decisions[1].lots, [{ batchId: 10, counted: 4 }])
    const done = await decide(f, id, { decision: 'approve' })
    assert.equal(done.status, 200, JSON.stringify(done.body)); assert.equal(done.body.done, true)
    assert.equal(lot(f, 20), 0, 'floored at 0')
    assert.deepEqual({ A: lot(f, 10), B: lot(f, 11), cream: lot(f, 30) }, { A: 4, B: 4, cream: 5 }, 'date A from its modified 4 (5 + 4 - 5), B untouched, the rejected product 3 untouched')
  })

  await check('accept some lines with productIds: only those are applied, the approval stays open, a later accept of the rest ends it; a rejected or unknown id is refused', async () => {
    const { f, id } = await three()
    assert.equal((await line(f, id, { productId: 3, action: 'reject' })).status, 200)
    const refusedRejected = await decide(f, id, { decision: 'approve', productIds: [3] })
    assert.equal(refusedRejected.status, 409); assert.equal(refusedRejected.body.code, 'inventory_check_line_rejected')
    const unknown = await decide(f, id, { decision: 'approve', productIds: [99] })
    assert.equal(unknown.status, 404); assert.equal(unknown.body.code, 'inventory_check_line_not_found')
    for (const bad of [[], [0], [1.5], ['1'], [1, 1], 'x']) { const refused = await decide(f, id, { decision: 'approve', productIds: bad }); assert.equal(refused.status, 400, JSON.stringify(bad)); assert.match(refused.body.code, /^inventory_check_(product_ids_required|invalid_id)$/) }
    assert.equal((await decide(f, id, { decision: 'reject', productIds: [1] })).status, 400, 'only an approve names lines')
    const accepted = await decide(f, id, { decision: 'approve', productIds: [2] })
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body)); assert.equal(accepted.body.done, true, 'what this request asked for is applied'); assert.equal(accepted.body.approval.status, 'pending', 'but product 1 is still open')
    assert.deepEqual({ toner: lot(f, 20), A: lot(f, 10) }, { toner: 3, A: 5 }); assert.equal(alerts.length, 0)
    const again = await decide(f, id, { decision: 'approve', productIds: [2] })
    assert.equal(again.status, 200); assert.equal(again.body.applied, 0, 'a repeat of an accept whose line is applied writes nothing'); assert.equal(lot(f, 20), 3)
    const rest = await decide(f, id, { decision: 'approve' })
    assert.equal(rest.status, 200, JSON.stringify(rest.body)); assert.equal(rest.body.approval.status, 'approved'); assert.equal(lot(f, 10), 3)
    assert.equal(alerts.length, 1); assert.deepEqual(alerts[0].summary, { applied: 2, rejected: 1 })
  })

  await check('reopen puts a rejected or modified line back; rejecting every line ends the approval as rejected by the approver (told once); the last reject after an apply ends it approved', async () => {
    const { f, id } = await three()
    assert.equal((await line(f, id, { productId: 2, action: 'reject' })).status, 200)
    const reopened = await line(f, id, { productId: 2, action: 'reopen' })
    assert.equal(reopened.status, 200, JSON.stringify(reopened.body)); assert.deepEqual(decisionsOf(f), {}); assert.equal(reopened.body.remaining, 3)
    const notDecided = await line(f, id, { productId: 2, action: 'reopen' })
    assert.equal(notDecided.status, 409); assert.equal(notDecided.body.code, 'inventory_check_line_not_decided')
    const twice = await line(f, id, { productId: 2, action: 'reject' }); assert.equal(twice.status, 200)
    assert.equal((await line(f, id, { productId: 2, action: 'reject' })).body.code, 'inventory_check_line_already_rejected')
    assert.equal((await line(f, id, { productId: 1, action: 'reject' })).status, 200)
    const last = await line(f, id, { productId: 3, action: 'reject', note: 'All wrong' })
    assert.equal(last.status, 200, JSON.stringify(last.body)); assert.equal(last.body.done, true); assert.equal(last.body.approval.status, 'rejected'); assert.equal(approvalRow(f).decided_by, 7, 'a person, not "replaced"')
    assert.equal(last.body.approval.replaced, undefined)
    assert.equal(alerts.length, 1); assert.equal(alerts[0].kind, 'rejected'); assert.equal(alerts[0].reason, 'All wrong'); assert.deepEqual(alerts[0].summary, { applied: 0, rejected: 3 })
    assert.equal((await line(f, id, { productId: 3, action: 'reopen' })).body.code, 'inventory_check_approval_decided', 'a decided approval never changes')
    assert.deepEqual({ A: lot(f, 10), toner: lot(f, 20), cream: lot(f, 30) }, { A: 5, toner: 5, cream: 5 })
    // after an apply: accept product 1, reject the other two: the last reject ends it approved
    const { f: g, id: gid } = await three()
    assert.equal((await decide(g, gid, { decision: 'approve', productIds: [1] })).body.approval.status, 'pending')
    assert.equal((await line(g, gid, { productId: 2, action: 'reject' })).status, 200)
    const end = await line(g, gid, { productId: 3, action: 'reject' })
    assert.equal(end.status, 200, JSON.stringify(end.body)); assert.equal(end.body.approval.status, 'approved'); assert.equal(end.body.done, true)
    assert.equal(alerts.length, 1); assert.equal(alerts[0].kind, 'approved'); assert.deepEqual(alerts[0].summary, { applied: 1, rejected: 2 })
  })

  await check('a line already applied, or being applied, can never be decided; a close keeps its meaning and leaves rejected lines out of what it did not apply', async () => {
    const { f, id } = await three()
    const first = await decide(f, id, { decision: 'approve', productIds: [1] })
    assert.equal(first.status, 200, JSON.stringify(first.body))
    const applied = await line(f, id, { productId: 1, action: 'reject' })
    assert.equal(applied.status, 409); assert.equal(applied.body.code, 'inventory_check_line_applied')
    assert.equal((await line(f, id, { productId: 2, action: 'reject' })).status, 200)
    f.raw.prepare("UPDATE inventory_check_approvals SET plan_json=?").run(JSON.stringify({ 3: { lot: 30, scope: 'lot', counted: 2, seen: 5 } }))
    const planned = await line(f, id, { productId: 3, action: 'modify', counted: 1 })
    assert.equal(planned.status, 409); assert.equal(planned.body.code, 'inventory_check_line_in_progress')
    f.raw.prepare("UPDATE inventory_check_approvals SET plan_json='{}'").run()
    const closed = await decide(f, id, { decision: 'close' })
    assert.equal(closed.status, 200, JSON.stringify(closed.body)); assert.equal(closed.body.approval.status, 'approved')
    assert.deepEqual(closed.body.approval.closed, { lines: { 3: 'inventory_check_not_applied' } }, 'the rejected line 2 is a decision, not a line left unapplied')
    assert.equal(alerts.length, 1); assert.equal(alerts[0].kind, 'approved')
  })

  await check('a rejected line no longer waits for approval (the Waiting filter, the row tag, the Fix stock hold); a modified line still waits; reopening makes it wait again', async () => {
    const { f, id } = await three()
    const sessions = w.load('lib/inventoryCheckSessions.ts')
    const waits = productId => sessions.lineWaitsForApproval(f.db, id, productId)
    assert.deepEqual([await waits(1), await waits(2), await waits(3)], [true, true, true])
    assert.equal((await line(f, id, { productId: 2, action: 'reject' })).status, 200)
    assert.deepEqual([await waits(1), await waits(2), await waits(3)], [true, false, true])
    assert.equal(await sessions.productWaitsForApproval(f.db, 2, 1), false); assert.equal(await sessions.productWaitsForApproval(f.db, 1, 1), true)
    assert.equal((await line(f, id, { productId: 3, action: 'modify', counted: 1 })).status, 200)
    assert.equal(await waits(3), true, 'a modified line is still waiting to be applied')
    assert.equal((await line(f, id, { productId: 2, action: 'reopen' })).status, 200)
    assert.equal(await waits(2), true)
  })

  await check('every refusal is a coded 4xx: shape, figures, note, dates, permissions, state, a repeat with other input', async () => {
    const { f, id } = await three()
    const bad = async (body, status, code) => { const r = await line(f, id, body); assert.equal(r.status, status, JSON.stringify([body, r.body])); assert.equal(r.body.code, code, JSON.stringify(body)) }
    await bad({ productId: 2, action: 'bogus' }, 400, 'inventory_check_invalid_action')
    await bad({ productId: 0, action: 'reject' }, 400, 'inventory_check_invalid_id')
    await bad({ productId: 2, action: 'reject', note: 'x'.repeat(501) }, 400, 'inventory_check_invalid_note')
    await bad({ productId: 2, action: 'reject', counted: 1 }, 400, 'inventory_check_invalid_request')
    await bad({ productId: 2, action: 'modify' }, 400, 'inventory_check_quantity_required')
    await bad({ productId: 2, action: 'modify', counted: -1 }, 400, 'inventory_check_invalid_quantity')
    await bad({ productId: 2, action: 'modify', counted: 2.5 }, 400, 'inventory_check_target_not_whole')
    await bad({ productId: 2, action: 'modify', counted: '4' }, 400, 'inventory_check_invalid_quantity')
    await bad({ productId: 3, action: 'modify', lots: [{ batchId: 30, counted: 4 }] }, 400, 'inventory_check_lots_not_allowed')
    await bad({ productId: 2, action: 'modify', counted: 4 }, 400, 'inventory_check_lots_required')
    await bad({ productId: 1, action: 'modify', counted: 4 }, 400, 'inventory_check_lots_required')
    await bad({ productId: 1, action: 'modify', lots: [{ batchId: 99, counted: 4 }] }, 400, 'inventory_check_line_date_not_counted')
    await bad({ productId: 3, action: 'modify', counted: 5 }, 409, 'inventory_check_modify_matches_seen')
    await bad({ productId: 2, action: 'modify', lots: [{ batchId: 20, counted: 5 }] }, 409, 'inventory_check_modify_matches_seen')
    await bad({ productId: 77, action: 'reject' }, 404, 'inventory_check_line_not_found')
    await bad({ action: 'reject' }, 400, 'inventory_check_invalid_id')
    const noId = await w.call(f, 'POST', `/api/inventory-checks/sessions/${id}/approval/lines`, { productId: 2, action: 'reject' }); assert.equal(noId.status, 400); assert.equal(noId.body.code, 'inventory_check_request_id_required')
    const missing = await w.call(f, 'POST', '/api/inventory-checks/sessions/nope/approval/lines', { requestId: rid(), productId: 2, action: 'reject' }); assert.equal(missing.status, 404)
    assert.equal(f.raw.prepare("SELECT COUNT(*) AS n FROM inventory_check_events WHERE action='observe' AND request_id LIKE 'line-request-%'").get().n, 3, 'only the three submission events; no refusal wrote anything')
    assert.deepEqual(decisionsOf(f), {})
    // a repeat is safe, the same id with other input is refused
    const key = rid()
    const one = await w.call(f, 'POST', `/api/inventory-checks/sessions/${id}/approval/lines`, { requestId: key, productId: 2, action: 'reject' })
    assert.equal(one.status, 200)
    const eventsAfter = f.raw.prepare('SELECT COUNT(*) AS n FROM inventory_check_events').get().n
    const replay = await w.call(f, 'POST', `/api/inventory-checks/sessions/${id}/approval/lines`, { requestId: key, productId: 2, action: 'reject' })
    assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true); assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM inventory_check_events').get().n, eventsAfter, 'a replay writes nothing')
    const reused = await w.call(f, 'POST', `/api/inventory-checks/sessions/${id}/approval/lines`, { requestId: key, productId: 3, action: 'reject' })
    assert.equal(reused.status, 409); assert.equal(reused.body.code, 'inventory_check_request_reused')
  })

  await check('permissions: reject needs approve-counts; modify also needs Inventory adjust at Full and not one\'s own count while another approver exists', async () => {
    const lacking = await three()
    lacking.f.raw.exec("UPDATE roles SET code='employee',permissions='{\"inventory_checks\":true,\"inventory_check_show_stock\":true}' WHERE id=1")
    for (const body of [{ productId: 2, action: 'reject' }, { productId: 2, action: 'modify', lots: [{ batchId: 20, counted: 4 }] }, { productId: 2, action: 'reopen' }]) {
      const refused = await line(lacking.f, lacking.id, body)
      assert.ok([403].includes(refused.status), JSON.stringify([body, refused])); assert.ok(['inventory_check_approve_required', 'inventory_check_authority_changed'].includes(refused.body.code), refused.body.code)
    }
    const noAdjust = await three()
    noAdjust.f.raw.exec("UPDATE roles SET code='employee',permissions='{\"inventory_checks\":true,\"inventory_check_show_stock\":true,\"inventory_check_approve\":true,\"inventory\":\"view\"}' WHERE id=1")
    const modify = await line(noAdjust.f, noAdjust.id, { productId: 2, action: 'modify', lots: [{ batchId: 20, counted: 4 }] })
    assert.equal(modify.status, 403, JSON.stringify(modify.body)); assert.ok(['inventory_check_adjust_required', 'inventory_check_authority_changed'].includes(modify.body.code), modify.body.code)
    const own = await three()
    own.f.raw.exec('UPDATE users SET is_active=1 WHERE id=8')
    const self = await line(own.f, own.id, { productId: 2, action: 'modify', lots: [{ batchId: 20, counted: 4 }] })
    assert.equal(self.status, 403, JSON.stringify(self.body)); assert.equal(self.body.code, 'inventory_check_self_approval')
    assert.equal((await line(own.f, own.id, { productId: 2, action: 'reject' })).status, 200, 'rejecting one\'s own count is not an approval')
    assert.deepEqual(decisionsOf(lacking.f), {}); assert.deepEqual(decisionsOf(noAdjust.f), {})
  })

  await check('a decision that lands between an approve\'s read and its claim is never ignored: the claim is refused (409) and the repeat applies the new figure', async () => {
    const { f, id } = await three()
    f.control.beforeMatch = statements => statements.some(statement => /UPDATE inventory_check_approvals SET applying_request_id/.test(statement.sql))
    f.control.before = raw => { raw.prepare("UPDATE inventory_check_approvals SET line_decisions_json=?").run(JSON.stringify({ 2: { decision: 'modify', lots: [{ batchId: 20, counted: 4 }], by: 7, at: 'x' } })) }
    const raced = await decide(f, id, { decision: 'approve' })
    assert.equal(raced.status, 409, JSON.stringify(raced.body)); assert.equal(raced.body.code, 'inventory_check_conflict')
    assert.deepEqual({ toner: lot(f, 20), A: lot(f, 10) }, { toner: 5, A: 5 }, 'nothing was applied from the figures the stale read held')
    const repeat = await decide(f, id, { decision: 'approve' })
    assert.equal(repeat.status, 200, JSON.stringify(repeat.body)); assert.equal(lot(f, 20), 4, 'the modified figure 4 (5 + 4 - 5)')
  })

  if (failures.length) { console.error(`FAILED ${failures.length}: ${failures.join(' | ')}`); process.exit(1) }
  console.log('PASS test-inventory-check-line-decisions-native')
}
main().catch(error => { console.error(error); process.exit(1) })
