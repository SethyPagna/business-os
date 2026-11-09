'use strict'
// INV S6 (VERIFY-INV-B N2, audit G14): a direct Set closes the Issue it fixes, server side, in the same atomic batch as the Set; issue_closed in the answer says whether it did.
// Real routes (POST /api/inventory/adjust, PATCH /api/batches/:id/branches/:branchId), the real stock writer and its Undo/Redo, over every migration.
//   - two differing dates, Set one: the Issue stays (issue_closed false), no count rows;
//   - the Set that makes every line match closes it: true, one new count, written by the same batch as the Set (a stale figure writes neither);
//   - a count waiting for approval: false and the approval untouched;
//   - double apply: the same request answers the same, one count; Undo reopens the Issue (a copy of the closed count), once; Redo closes it again; a newer count is never disturbed by an Undo.
// Run: node scripts/test-stock-set-closes-issue-native.cjs
const assert = require('node:assert/strict')
const { createLotSetWorld } = require('./harness/lot_set_world.cjs')

const w = createLotSetWorld()
const ON = { ic_lot_counts: 'on' }
const adjust = (f, body = {}) => w.call(f, 'POST', '/api/inventory/adjust', { type: 'set', setScope: 'lot', productId: 1, branchId: 1, batchId: 11, quantity: 5, expectedLotQuantity: 7, reason: 'Physical count', client_request_id: 'inventory_set_x1234567', ...body })
const patch = (f, body = {}) => w.call(f, 'PATCH', '/api/batches/11/branches/1', { quantity: 5, expectedLotQuantity: 7, reason: 'Physical count', client_request_id: 'batches_set_x1234567', ...body })
const failures = []
async function check(name, run) { try { await run(); console.log('PASS ' + name) } catch (error) { failures.push(name); console.error('FAIL ' + name, error) } }
const T0 = '2026-11-09T01:00:00.000Z'
// An old count of product 1 at branch 1 that is an Issue, decided or not: lines = [[batchId, counted, seen]] (per received date), or none (an older product-level count).
function issue(f, { session = 'issue-session-1', lines = null, counted = 8, seen = 10, at = T0, productId = 1 } = {}) {
  f.raw.exec('PRAGMA foreign_keys=OFF')
  const total = lines ? lines.reduce((sum, line) => sum + line[1], 0) : counted, base = lines ? lines.reduce((sum, line) => sum + line[2], 0) : seen
  f.raw.prepare(`INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at) VALUES(?,NULL,1,8,'','closed',0,'{}',?,?,?)`).run(session, at, at, at)
  f.raw.prepare(`INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at)
    VALUES(?,?,1,'{}',?,'{}','issue',?,'Count differs from stock',1,8,?)`).run(session, productId, base, total, at)
  for (const [batchId, lineCounted, lineSeen] of lines || []) {
    f.raw.prepare(`INSERT INTO inventory_check_lot_lines(session_id,product_id,branch_id,batch_id,scope,seen_quantity,counted_quantity,seen_source,created_at) VALUES(?,?,1,?,?,?,?,'screen',?)`)
      .run(session, productId, batchId, batchId === 0 ? 'branch' : 'lot', lineSeen, lineCounted, at)
  }
  f.raw.exec('PRAGMA foreign_keys=ON')
}
const sessions = f => f.raw.prepare('SELECT id,title,status,scope_json FROM inventory_check_sessions ORDER BY started_at,rowid').all()
const added = f => sessions(f).filter(row => JSON.parse(row.scope_json).membership === 'stock_set' || JSON.parse(row.scope_json).membership === 'stock_set_undo')
const latest = f => f.raw.prepare(`SELECT i.session_id,i.state,i.counted_quantity FROM inventory_check_sessions s JOIN inventory_check_items i ON i.session_id=s.id AND i.branch_id=s.branch_id
  WHERE s.branch_id=1 AND i.product_id=1 AND i.state IN ('done','issue') ORDER BY i.updated_at DESC, i.session_id DESC LIMIT 1`).get()
const events = f => f.raw.prepare("SELECT action,session_id,request_id FROM inventory_check_events WHERE request_id LIKE 'stock-set-%' ORDER BY id").all()
const historyOf = f => f.raw.prepare("SELECT id,undo_payload FROM action_history WHERE entity='stock_quantity_set' ORDER BY id DESC LIMIT 1").get()
const replay = (f, direction, generation) => { const row = historyOf(f); return w.lot.replayStockLotSet(f.env, w.actor, direction, row.id, generation, JSON.parse(row.undo_payload)) }
const lotQuantity = (f, batch) => f.raw.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=? AND branch_id=1').get(batch).quantity

async function main() {
  await check('two differing dates, Set one: the Issue stays, issue_closed is false and no count row is written', async () => {
    const f = w.world({ switches: ON }); issue(f, { lines: [[10, 2, 3], [11, 5, 7]] })
    const done = await adjust(f, { batchId: 10, quantity: 2, expectedLotQuantity: 3 })
    assert.equal(done.status, 200, JSON.stringify(done.body)); assert.equal(done.body.issue_closed, false)
    assert.equal(sessions(f).length, 1, 'no count row'); assert.equal(events(f).length, 0); assert.equal(latest(f).state, 'issue')
    assert.equal(lotQuantity(f, 10), 2, 'the Set itself stands')
  })

  await check('the Set that makes every line match closes it (true), writing one count with the existing create and close events', async () => {
    const f = w.world({ switches: ON }); issue(f, { lines: [[10, 2, 3], [11, 5, 7]] })
    await adjust(f, { batchId: 10, quantity: 2, expectedLotQuantity: 3, client_request_id: 'inventory_set_first01' })
    const done = await adjust(f, { quantity: 5, expectedLotQuantity: 7 })
    assert.equal(done.status, 200, JSON.stringify(done.body)); assert.equal(done.body.issue_closed, true)
    const made = added(f); assert.equal(made.length, 1); assert.equal(made[0].status, 'closed'); assert.equal(made[0].title, 'Set from Inventory')
    assert.equal(JSON.parse(made[0].scope_json).closes, 'issue-session-1'); assert.equal(JSON.parse(made[0].scope_json).operation, done.body.operation_id)
    const now = latest(f); assert.equal(now.session_id, made[0].id); assert.equal(now.state, 'done'); assert.equal(now.counted_quantity, 7, 'counted = the branch total after the Set (2 + 5)')
    assert.deepEqual(events(f).map(row => row.action), ['create', 'close'])
    assert.equal(f.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity, 7)
    assert.equal(JSON.parse(f.raw.prepare('SELECT response_json FROM stock_lot_adjustment_operations WHERE id=?').get(done.body.operation_id).response_json).issue_closed, true, 'the stored answer says so')
  })

  await check('the close is atomic with the Set: a stale figure refuses the Set and writes no count', async () => {
    const f = w.world({ switches: ON }); issue(f, { lines: [[10, 3, 3], [11, 5, 7]] })
    f.control.before = raw => { raw.exec('PRAGMA foreign_keys=OFF'); w.seed(f, 'UPDATE branch_batch_stock SET quantity=8 WHERE batch_id=11 AND branch_id=1') }
    const refused = await adjust(f)
    assert.equal(refused.status, 409, JSON.stringify(refused.body)); assert.equal(sessions(f).length, 1); assert.equal(events(f).length, 0)
    assert.equal(lotQuantity(f, 11), 8, 'and the Set did not land either')
  })

  await check('PATCH /api/batches (Manage received dates) closes the Issue the same way', async () => {
    const f = w.world({ switches: ON }); issue(f, { lines: [[10, 3, 3], [11, 5, 7]] })
    const done = await patch(f)
    assert.equal(done.status, 200, JSON.stringify(done.body)); assert.equal(done.body.issue_closed, true); assert.equal(added(f).length, 1)
  })

  await check('a count waiting for approval: false, and the approval is untouched', async () => {
    const f = w.world({ switches: ON }); w.dateCount(f, { lines: [[10, 3, 3], [11, 5, 7]] })
    const approvalBefore = JSON.stringify(f.raw.prepare('SELECT * FROM inventory_check_approvals').all())
    const done = await adjust(f)
    assert.equal(done.status, 200, JSON.stringify(done.body)); assert.equal(done.body.issue_closed, false)
    assert.equal(sessions(f).length, 1); assert.equal(JSON.stringify(f.raw.prepare('SELECT * FROM inventory_check_approvals').all()), approvalBefore)
    assert.equal(f.raw.prepare('SELECT status FROM inventory_check_approvals').get().status, 'pending')
  })

  await check('an older product-level count (no lines) closes when the branch total equals its counted figure, and not otherwise', async () => {
    const f = w.world({ switches: ON }); issue(f, { counted: 8, seen: 10 })
    const miss = await adjust(f, { quantity: 6, expectedLotQuantity: 7 }) // branch 9, counted 8
    assert.equal(miss.body.issue_closed, false); assert.equal(added(f).length, 0)
    const hit = await adjust(f, { quantity: 5, expectedLotQuantity: 6, client_request_id: 'inventory_set_second1' }) // branch 8
    assert.equal(hit.body.issue_closed, true); assert.equal(latest(f).counted_quantity, 8)
  })

  await check('a branch-total line is judged against the branch quantity', async () => {
    const f = w.world({ switches: ON }); issue(f, { lines: [[0, 8, 10]] })
    const done = await adjust(f, { setScope: 'branch', batchId: 11, quantity: 8, expectedLotQuantity: undefined, expectedBranchQuantity: 10 })
    assert.equal(done.status, 200, JSON.stringify(done.body)); assert.equal(done.body.issue_closed, true)
  })

  await check('a product whose latest count is OK, or that was never counted, closes nothing; the switch OFF closes nothing', async () => {
    const f = w.world({ switches: ON })
    assert.equal((await adjust(f)).body.issue_closed, false, 'never counted'); assert.equal(sessions(f).length, 0)
    const g = w.world({ switches: {} }); issue(g, { lines: [[10, 3, 3], [11, 5, 7]] })
    assert.equal((await adjust(g)).body.issue_closed, false, 'switch OFF'); assert.equal(sessions(g).length, 1)
    const h = w.world({ switches: ON }); issue(h, { lines: [[10, 3, 3], [11, 5, 7]] })
    h.raw.exec("UPDATE inventory_check_items SET state='done',reason=NULL")
    assert.equal((await adjust(h)).body.issue_closed, false, 'latest is OK'); assert.equal(sessions(h).length, 1)
  })

  await check('double apply: the same request answers the same and writes one count', async () => {
    const f = w.world({ switches: ON }); issue(f, { lines: [[10, 3, 3], [11, 5, 7]] })
    const first = await adjust(f), again = await adjust(f)
    assert.equal(first.body.issue_closed, true); assert.equal(again.status, 200); assert.equal(again.body.replayed, true); assert.equal(again.body.issue_closed, true)
    assert.equal(added(f).length, 1); assert.equal(events(f).length, 2); assert.equal(lotQuantity(f, 11), 5)
  })

  await check('a Set to the figure stock already has (a sale got there first) still closes the Issue when every line now matches; and does nothing when one does not', async () => {
    const f = w.world({ switches: ON }); issue(f, { lines: [[10, 3, 3], [11, 5, 7]] })
    w.seed(f, 'UPDATE branch_batch_stock SET quantity=5 WHERE batch_id=11 AND branch_id=1; UPDATE branch_stock SET quantity=8 WHERE product_id=1 AND branch_id=1; UPDATE products SET stock_quantity=8 WHERE id=1')
    const movements = f.raw.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n
    const done = await adjust(f, { quantity: 5, expectedLotQuantity: 5 })
    assert.equal(done.status, 200, JSON.stringify(done.body)); assert.equal(done.body.quantity, 0, 'nothing moved'); assert.equal(done.body.issue_closed, true)
    assert.equal(added(f).length, 1); assert.equal(latest(f).state, 'done'); assert.equal(latest(f).counted_quantity, 8)
    assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n, movements, 'no movement, no history row: nothing to undo')
    const again = await adjust(f, { quantity: 5, expectedLotQuantity: 5, client_request_id: 'inventory_set_again001' })
    assert.equal(again.body.issue_closed, false, 'the Issue is already closed'); assert.equal(added(f).length, 1)
    const g = w.world({ switches: ON }); issue(g, { lines: [[10, 3, 3], [11, 4, 7]] })
    w.seed(g, 'UPDATE branch_batch_stock SET quantity=5 WHERE batch_id=11 AND branch_id=1; UPDATE branch_stock SET quantity=8 WHERE product_id=1 AND branch_id=1; UPDATE products SET stock_quantity=8 WHERE id=1')
    const kept = await adjust(g, { quantity: 5, expectedLotQuantity: 5 })
    assert.equal(kept.body.issue_closed, false); assert.equal(sessions(g).length, 1)
  })

  await check('Undo reopens the Issue (a copy of the closed count and its lines), once; Redo closes it again', async () => {
    const f = w.world({ switches: ON }); issue(f, { lines: [[10, 3, 3], [11, 5, 7]] })
    await adjust(f)
    await replay(f, 'undo', 0)
    assert.equal(lotQuantity(f, 11), 7, 'stock is back')
    let now = latest(f); assert.equal(now.state, 'issue', 'the Issue is open again'); assert.notEqual(now.session_id, 'issue-session-1'); assert.equal(now.counted_quantity, 8)
    assert.deepEqual(f.raw.prepare('SELECT batch_id,counted_quantity,seen_quantity FROM inventory_check_lot_lines WHERE session_id=? ORDER BY batch_id').all(now.session_id).map(row => ({ ...row })),
      [{ batch_id: 10, counted_quantity: 3, seen_quantity: 3 }, { batch_id: 11, counted_quantity: 5, seen_quantity: 7 }])
    const afterUndo = sessions(f).length
    await replay(f, 'undo', 0) // already undone: a no-op
    assert.equal(sessions(f).length, afterUndo, 'undoing twice reopens once')
    await replay(f, 'redo', 1)
    assert.equal(lotQuantity(f, 11), 5); now = latest(f); assert.equal(now.state, 'done'); assert.equal(now.counted_quantity, 8)
    await replay(f, 'undo', 2)
    assert.equal(latest(f).state, 'issue', 'a second Undo reopens it again')
  })

  await check('an Undo never disturbs a newer count: if the product was counted since, the Issue is not reopened', async () => {
    const f = w.world({ switches: ON }); issue(f, { lines: [[10, 3, 3], [11, 5, 7]] })
    await adjust(f)
    f.raw.exec('PRAGMA foreign_keys=OFF')
    f.raw.exec(`INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at) VALUES('newer-count',NULL,1,8,'','closed',0,'{}','2099-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z');
      INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at) VALUES('newer-count',1,1,'{}',8,'{}','done',8,NULL,1,8,'2099-01-01T00:00:00.000Z')`)
    f.raw.exec('PRAGMA foreign_keys=ON')
    const count = sessions(f).length
    await replay(f, 'undo', 0)
    assert.equal(sessions(f).length, count, 'nothing added'); assert.equal(latest(f).session_id, 'newer-count'); assert.equal(lotQuantity(f, 11), 7, 'the Set itself is undone')
  })

  if (failures.length) { console.error(`FAILED ${failures.length}: ${failures.join('; ')}`); process.exit(1) }
  console.log('PASS test-stock-set-closes-issue-native')
}
main().catch(error => { console.error(error); process.exit(1) })
