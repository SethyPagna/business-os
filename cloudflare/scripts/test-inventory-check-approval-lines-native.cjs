'use strict'
// INV S6 (G2): approving a count per received date, on the REAL routes with the REAL stock writer (lib/stockLotAdjustment.ts) over every migration.
// Each counted received date is Set from what the count found -- max(0, live + counted - seen), computed inside the writer from its own read and pinned in its own batch --
// never from a ledger read or a first-in first-out pick. Proves the discriminating case, the transition table's double-apply and reversal rows, the claim-only variance, and the
// records an approval leaves (Stock Changes movements with reason and actor, one undoable history row per line).
// Run: node scripts/test-inventory-check-approval-lines-native.cjs
const assert = require('node:assert/strict')
const { createLotSetWorld } = require('./harness/lot_set_world.cjs')

const w = createLotSetWorld({ admin: true })
const planTier = w.load('lib/planTier.ts')
const ON = { ic_simple: 'on', ic_fix_stock: 'on', ic_lot_counts: 'on' }
const SESSION = 'dated-session-1'
const approve = (f, body = {}, env = {}) => { planTier.__resetPlanTierCacheForTests(); return w.call(f, 'POST', `/api/inventory-checks/sessions/${SESSION}/approval`, { decision: 'approve', requestId: 'approve-request-01', ...body }, env) }
const lot = (f, batch) => f.raw.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=? AND branch_id=1').get(batch)?.quantity
const stock = f => ({ A: lot(f, 10), B: lot(f, 11), branch: f.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity, product: f.raw.prepare('SELECT stock_quantity AS q FROM products WHERE id=1').get().q })
/** A=5 (batch 10, the older date), B=4 (batch 11): the figures of the discriminating case. */
const dates = f => w.seed(f, 'UPDATE branch_batch_stock SET quantity=5 WHERE batch_id=10; UPDATE branch_batch_stock SET quantity=4 WHERE batch_id=11; UPDATE branch_stock SET quantity=9 WHERE product_id=1; UPDATE products SET stock_quantity=9 WHERE id=1')
const sellFromA = (f, units = 1) => w.seed(f, `UPDATE branch_batch_stock SET quantity=quantity-${units} WHERE batch_id=10; UPDATE branch_stock SET quantity=quantity-${units} WHERE product_id=1; UPDATE products SET stock_quantity=stock_quantity-${units} WHERE id=1`)
const sellFromB = (f, units = 1) => w.seed(f, `UPDATE branch_batch_stock SET quantity=quantity-${units} WHERE batch_id=11; UPDATE branch_stock SET quantity=quantity-${units} WHERE product_id=1; UPDATE products SET stock_quantity=stock_quantity-${units} WHERE id=1`)
const history = f => f.raw.prepare("SELECT id,entity,status,undo_payload,created_by_id FROM action_history WHERE entity='stock_quantity_set' ORDER BY id").all()
const movements = f => f.raw.prepare('SELECT movement_type,quantity,reason,user_id,batch_id FROM inventory_movements ORDER BY id').all().map(row => ({ ...row }))
const failures = []
async function check(name, run) { try { await run(); console.log('PASS ' + name) } catch (error) { failures.push(name); console.error('FAIL ' + name, error) } }

async function main() {
  await check('A=5, B=4, counted A=5, B=2, one sold from A: approving gives A=4, B=2 (first-in first-out would give A=2, B=4)', async () => {
    const f = w.world({ switches: ON }); dates(f)
    w.dateCount(f, { lines: [[10, 5, 5], [11, 2, 4]] })
    sellFromA(f)
    const done = await approve(f)
    assert.equal(done.status, 200, JSON.stringify(done.body)); assert.equal(done.body.done, true); assert.equal(done.body.applied, 1)
    assert.deepEqual(stock(f), { A: 4, B: 2, branch: 6, product: 6 }, 'B from 4 to 2; the sale from A survives; A, which matched, is untouched in every ledger')
    // The records: one Stock Changes movement for the date that moved, with the reason and the approver, and one undoable history row.
    const moved = movements(f)
    assert.equal(moved.length, 1); assert.deepEqual({ type: moved[0].movement_type, quantity: moved[0].quantity, user: moved[0].user_id, batch: moved[0].batch_id }, { type: 'remove', quantity: 2, user: 7, batch: 11 })
    assert.match(moved[0].reason, /^Inventory check approved: counted 2 \(Set received 2026-09-09 from 4 to 2\)$/)
    const rows = history(f)
    assert.equal(rows.length, 1); assert.equal(rows[0].status, 'undoable'); assert.equal(rows[0].created_by_id, 7)
    const payload = JSON.parse(rows[0].undo_payload)
    assert.equal(payload.applier, 'stock.quantity_set'); assert.ok(payload.operation_id, 'the server can replay the reversal without the client')
    const applied = JSON.parse(f.raw.prepare('SELECT applied_json FROM inventory_check_approvals').get().applied_json).lines['1']
    assert.deepEqual({ before: applied.before, after: applied.after, lots: applied.lots.map(entry => ({ batchId: entry.batchId, before: entry.before, after: entry.after, history: entry.historyId, operation: entry.operationId })) },
      { before: 8, after: 6, lots: [{ batchId: 11, before: 4, after: 2, history: rows[0].id, operation: payload.operation_id }] }, 'the approval records before and after and the history row of the line')
    assert.equal(f.raw.prepare("SELECT status FROM inventory_check_approvals").get().status, 'approved')
  })

  await check('double apply: the same approval request again is a replay that writes nothing; a lost answer after the stock landed is finished by the repeat without applying twice', async () => {
    const f = w.world({ switches: ON }); dates(f)
    w.dateCount(f, { lines: [[10, 3, 5], [11, 2, 4]] })
    // The record of the first date is lost (the batch that records it is refused): its stock landed.
    f.control.beforeMatch = statements => statements.some(statement => /UPDATE inventory_check_approvals SET applied_json/.test(statement.sql))
    f.control.before = () => { throw new Error('D1 unavailable') }
    const lost = await approve(f, {}, { PLAN_TIER: 'free' })
    assert.equal(lost.status, 503, JSON.stringify(lost.body)); assert.equal(lost.body.code, 'inventory_check_outcome_unknown')
    assert.deepEqual(stock(f), { A: 3, B: 4, branch: 7, product: 7 }, 'the first date landed (Free: one line per request)')
    const before = movements(f).length, histories = history(f).length
    const first = await approve(f, {}, { PLAN_TIER: 'free' })
    assert.equal(first.status, 200, JSON.stringify(first.body)); assert.deepEqual({ applied: first.body.applied, remaining: first.body.remaining, done: first.body.done }, { applied: 1, remaining: 1, done: false })
    assert.equal(movements(f).length, before, 'the date that had landed was replayed from its receipt'); assert.equal(history(f).length, histories)
    assert.deepEqual(stock(f), { A: 3, B: 4, branch: 7, product: 7 }, 'not applied twice')
    const second = await approve(f, {}, { PLAN_TIER: 'free' })
    assert.equal(second.status, 200, JSON.stringify(second.body)); assert.equal(second.body.done, true)
    assert.deepEqual(stock(f), { A: 3, B: 2, branch: 5, product: 5 }, 'each date from its own count, once')
    const after = { moved: movements(f).length, histories: history(f).length, row: f.raw.prepare('SELECT * FROM inventory_check_approvals').get() }
    const replay = await approve(f)
    assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true); assert.equal(replay.body.applied, 0)
    assert.deepEqual({ moved: movements(f).length, histories: history(f).length, row: f.raw.prepare('SELECT * FROM inventory_check_approvals').get() }, after, 'a decided approval replays without writing')
    assert.deepEqual(stock(f), { A: 3, B: 2, branch: 5, product: 5 })
  })

  await check('undo of an approval restores every line exactly, server side, once; redo reapplies; a clamped line undoes exactly too', async () => {
    const f = w.world({ switches: ON }); dates(f)
    w.dateCount(f, { lines: [[10, 3, 5], [11, 0, 4]] })
    sellFromB(f, 3) // B holds 1: counted 0 of 4 wants -3 less than it has... max(0, 1 + 0 - 4) = 0, branch floors at max(0, B + d)
    const before = stock(f)
    assert.deepEqual(before, { A: 5, B: 1, branch: 6, product: 6 })
    const done = await approve(f)
    assert.equal(done.status, 200, JSON.stringify(done.body)); assert.equal(done.body.done, true)
    assert.deepEqual(stock(f), { A: 3, B: 0, branch: 3, product: 3 }, 'A: 5 + 3 - 5 = 3; B: max(0, 1 + 0 - 4) = 0')
    const recorded = JSON.parse(f.raw.prepare('SELECT applied_json FROM inventory_check_approvals').get().applied_json).lines['1']
    assert.deepEqual({ clamped: recorded.clamped, wanted: recorded.wanted, before: recorded.before, after: recorded.after }, { clamped: true, wanted: 0, before: 6, after: 3 }, 'told: the count wanted the branch at 0 (6 + (3 - 5) + (0 - 4)), the floor of date B left 3')
    const rows = history(f)
    assert.equal(rows.length, 2)
    for (const row of rows) await w.lot.replayStockLotSet(f.env, w.actor, 'undo', row.id, 0, JSON.parse(row.undo_payload))
    assert.deepEqual(stock(f), before, 'every line restored, in every ledger')
    for (const row of rows) await w.lot.replayStockLotSet(f.env, w.actor, 'undo', row.id, 0, JSON.parse(row.undo_payload)) // already undone: a no-op, not a second reversal
    assert.deepEqual(stock(f), before, 'undoing twice reverses once')
    for (const row of rows) await w.lot.replayStockLotSet(f.env, w.actor, 'redo', row.id, 1, JSON.parse(f.raw.prepare('SELECT undo_payload FROM action_history WHERE id=?').get(row.id).undo_payload))
    assert.deepEqual(stock(f), { A: 3, B: 0, branch: 3, product: 3 }, 'redo applies the recorded change again')
  })

  await check('a single-lot product ends where the variance model puts it: count 3 of the 5 seen, a sale leaves 4: 2; count above, a raise: 26 of 24 and one gone: 25', async () => {
    const lower = w.world({ switches: ON }); w.seed(lower, 'DELETE FROM branch_batch_stock WHERE batch_id=10; DELETE FROM product_batches WHERE id=10; UPDATE branch_batch_stock SET quantity=5 WHERE batch_id=11; UPDATE branch_stock SET quantity=5 WHERE product_id=1; UPDATE products SET stock_quantity=5 WHERE id=1')
    w.dateCount(lower, { lines: [[11, 3, 5]] })
    w.seed(lower, 'UPDATE branch_batch_stock SET quantity=4 WHERE batch_id=11; UPDATE branch_stock SET quantity=4 WHERE product_id=1; UPDATE products SET stock_quantity=4 WHERE id=1')
    assert.equal((await approve(lower)).status, 200); assert.deepEqual({ B: lot(lower, 11), branch: stock(lower).branch }, { B: 2, branch: 2 })
    const raise = w.world({ switches: ON }); w.seed(raise, 'DELETE FROM branch_batch_stock WHERE batch_id=10; DELETE FROM product_batches WHERE id=10; UPDATE branch_batch_stock SET quantity=24 WHERE batch_id=11; UPDATE branch_stock SET quantity=24 WHERE product_id=1; UPDATE products SET stock_quantity=24 WHERE id=1')
    w.dateCount(raise, { lines: [[11, 26, 24]] })
    w.seed(raise, 'UPDATE branch_batch_stock SET quantity=23 WHERE batch_id=11; UPDATE branch_stock SET quantity=23 WHERE product_id=1; UPDATE products SET stock_quantity=23 WHERE id=1')
    assert.equal((await approve(raise)).status, 200); assert.deepEqual({ B: lot(raise, 11), branch: stock(raise).branch, product: stock(raise).product }, { B: 25, branch: 25, product: 25 })
    const raised = movements(raise); assert.deepEqual(raised.map(row => [row.movement_type, row.quantity]), [['adjustment', 2]], 'an upward count correction is an adjustment, not a purchase and not a loss')
  })

  await check('a branch-total line moves the difference into the newest received date holding stock, by the same variance', async () => {
    const f = w.world({ switches: ON }); dates(f)
    w.dateCount(f, { lines: [[0, 7, 9]] })
    sellFromA(f)
    assert.equal((await approve(f)).status, 200)
    assert.deepEqual(stock(f), { A: 4, B: 2, branch: 6, product: 6 }, 'branch 8 + (7 - 9) = 6, taken from the newest date holding stock (B)')
  })

  await check('the writer takes a variance only under an approval claim: no claim, a claim nobody holds, a figure beside it, a tag, or a plain Set that sneaks one in all write nothing', async () => {
    const f = w.world({ switches: ON }); dates(f)
    const before = w.snapshot(f)
    const body = { type: 'set', setScope: 'lot', productId: 1, branchId: 1, batchId: 11, variance: { counted: 0, seen: 4 }, reason: 'Inventory check approved: counted 0', client_request_id: 'variance-request-01' }
    const without = await w.call(f, 'POST', '/api/inventory/adjust', body)
    assert.equal(without.status, 400); assert.equal(without.body.code, 'invalid_variance')
    const unheld = await w.call(f, 'POST', '/api/inventory/adjust', { ...body, approvalClaim: { sessionId: SESSION, key: 'approval-key-0001' } })
    assert.equal(unheld.status, 409); assert.equal(unheld.body.code, 'inventory_check_claim_lost')
    for (const [name, extra] of [['a quantity beside it', { quantity: 0 }], ['an expected figure', { expectedLotQuantity: 4 }], ['a tag', { conditionTag: 'damaged' }], ['a bad figure', { variance: { counted: -1, seen: 4 } }],
      ['an extra key', { variance: { counted: 0, seen: 4, more: 1 } }], ['a text figure', { variance: { counted: '0', seen: 4 } }]]) {
      const refused = await w.call(f, 'POST', '/api/inventory/adjust', { ...body, approvalClaim: { sessionId: SESSION, key: 'approval-key-0001' }, client_request_id: `variance-request-${name.length}`, ...extra })
      assert.equal(refused.status, 400, name); assert.equal(refused.body.code, 'invalid_variance', name)
    }
    assert.equal(w.snapshot(f), before, 'nothing was written, not even a receipt that would hold the id')
    // the lot writer itself, called without the receipt wrapper's claim batch, refuses a variance
    const direct = await w.lot.applyStockLotSet(f.db, w.actor, 'direct-variance-01', { productId: 1, branchId: 1, batchId: 11, quantity: 0, setScope: 'lot', reason: 'x', conditionTag: null, variance: { counted: 0, seen: 4 } })
    assert.equal(direct.status, 400); assert.equal(direct.body.code, 'variance_requires_claim'); assert.equal(w.snapshot(f), before)
  })

  await check('an approval refuses a line on its own: adjusted by hand since the count, replaced by a newer count, retired; the others are applied', async () => {
    const f = w.world({ switches: ON }); dates(f)
    w.seed(f, `INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,stock_quantity,is_active) VALUES(2,'Toner','TON',2,0,5,1),(3,'Cream','CRE',2,0,5,1);
      INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,5),(3,1,5);
      INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,batch_number,unit_cost_usd,is_active) VALUES(20,2,'T','T','2026-09-02',1,3,1),(30,3,'C','C','2026-09-02',1,3,1);
      INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(20,1,5),(30,1,5);`)
    w.dateCount(f, { productId: 1, lines: [[10, 5, 5], [11, 2, 4]] })
    // one approval that holds three products: build it by hand (a submission of three products)
    f.raw.exec('PRAGMA foreign_keys=OFF')
    for (const [productId, batch] of [[2, 20], [3, 30]]) {
      f.raw.prepare("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at) VALUES(?,?,1,'{}',5,'{}','issue',3,'x',1,8,'2026-11-09T01:00:00.000Z')").run(SESSION, productId)
      f.raw.prepare("INSERT INTO inventory_check_lot_lines(session_id,product_id,branch_id,batch_id,scope,seen_quantity,counted_quantity,seen_source,created_at) VALUES(?,?,1,?,'lot',5,3,'screen','2026-11-09T01:00:00.000Z')").run(SESSION, productId, batch)
    }
    f.raw.exec('DROP TRIGGER inventory_check_approvals_identity')
    f.raw.prepare('UPDATE inventory_check_approvals SET lines=3, baselines_json=?').run(JSON.stringify({ 1: 9, 2: 5, 3: 5 }))
    f.raw.exec('PRAGMA foreign_keys=ON')
    // product 2 is corrected by hand after the count; product 3 is retired
    f.raw.prepare("INSERT INTO inventory_movements(product_id,product_name,branch_id,branch_name,movement_type,quantity,reason,user_id,created_at) VALUES(2,'Toner',1,'Shop','set',1,'manual',7,strftime('%Y-%m-%d %H:%M:%S','now','+1 seconds'))").run()
    w.seed(f, 'UPDATE branch_batch_stock SET quantity=0 WHERE batch_id=30; UPDATE branch_stock SET quantity=0 WHERE product_id=3; UPDATE products SET stock_quantity=0 WHERE id=3; UPDATE products SET is_active=0 WHERE id=3')
    const first = await approve(f)
    assert.equal(first.status, 200, JSON.stringify(first.body)); assert.equal(first.body.done, false)
    assert.deepEqual(first.body.refused, [{ productId: 3, code: 'inventory_check_product_retired' }, { productId: 2, code: 'inventory_check_stock_adjusted' }], 'each line says why; the most fundamental reason first')
    assert.deepEqual({ B: lot(f, 11), toner: f.raw.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=20').get().quantity }, { B: 2, toner: 5 }, 'the line that could be applied was; the refused ones did not move')
    const again = await approve(f)
    assert.equal(again.status, 409); assert.equal(again.body.code, 'inventory_check_product_retired'); assert.deepEqual(again.body.productIds, [3])
    // a newer count replaces the waiting line: it is refused as superseded in its own words
    f.raw.exec(`UPDATE inventory_check_approvals SET superseded_json='{"2":"newer-session"}'`)
    const closed = await approve(f, { decision: 'close', requestId: 'close-request-01' })
    assert.equal(closed.status, 200, JSON.stringify(closed.body)); assert.equal(closed.body.approval.status, 'approved')
    assert.deepEqual(closed.body.approval.closed, { lines: { 3: 'inventory_check_product_retired' } }, 'a replaced line is not a line to close')
  })

  if (failures.length) { console.error(`FAILED ${failures.length}: ${failures.join(' | ')}`); process.exit(1) }
  console.log('PASS test-inventory-check-approval-lines-native')
}
main().catch(error => { console.error(error); process.exit(1) })
