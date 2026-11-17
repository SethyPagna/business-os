'use strict'
// The lines of an approval are a STORED SET (inventory_check_approvals.line_set_json, migration 0316), computed when the approval is created by the same statement that counts them and read by every
// reader of "does this line wait for approval". Before it, eleven readers re-derived the rule from the items and disagreed about a product whose received dates differ with equal totals
// (A counted 6 of 5, B counted 3 of 4): the creation and the engine counted it, the readers did not. That gave two wrong stock results (review of 17 Nov 2026):
//   High 1  a recount of such a product did not replace the older count, so both stayed pending, the older could be applied first and the newer was then refused (stock ended on the OLD count);
//   High 2  a newer count of ANOTHER product ended an approval that still held the offsetting line, with the false reason "Replaced by a newer count".
// Real submissions through the real routes over the real migrations (in-memory SQLite, no workerd). Each scenario is also replayed against a planted mutant (the old reader text) and must fail there.
// Run: node scripts/test-inventory-check-line-set-native.cjs
const assert = require('node:assert/strict')
const { createLotSetWorld } = require('./harness/lot_set_world.cjs')

const ON = { ic_simple: 'on', ic_fix_stock: 'on', ic_lot_counts: 'on', ic_wired: 'on' }
const failures = []
async function check(name, run) { try { await run(); console.log('PASS ' + name) } catch (error) { failures.push(name); console.error('FAIL ' + name, error) } }

// The reader text of the base: the item total only (it cannot see a product whose dates offset each other).
const OLD_WAITING = [
  ["AND CASE WHEN ${a}.line_set_json IS NULL THEN (${i}.baseline_quantity IS NOT NULL AND ${i}.counted_quantity IS NOT NULL AND abs(${i}.baseline_quantity-${i}.counted_quantity)>0.000000001)\n    ELSE json_extract(${a}.line_set_json,'$.\"'||${i}.product_id||'\"') IS NOT NULL END",
    "AND ${i}.baseline_quantity IS NOT NULL AND ${i}.counted_quantity IS NOT NULL AND abs(${i}.baseline_quantity-${i}.counted_quantity)>0.000000001"]]
const OLD_REJECT = [
  ["        AND CASE WHEN ${A}.line_set_json IS NULL\n          THEN NOT EXISTS(", "        AND CASE WHEN 1\n          THEN NOT EXISTS("]]
const OLD_READ = [['  if (only) return only.length ?', '  if (false as boolean) return only!.length ?']]
const MUTANTS = { 'approval day instead of count day': { 'lib/inventoryCheckList.ts': [["CASE WHEN json_extract(scope_json, '$.membership') = 'submission' THEN started_at ELSE updated_at END", 'updated_at']] }, 'engine scans every item': { 'lib/inventoryCheckApprovals.ts': OLD_READ }, 'old waiting rule (item total)': { 'lib/inventoryCheckSessions.ts': OLD_WAITING }, 'old auto-reject rule (item scan)': { 'lib/inventoryCheckSessions.ts': OLD_REJECT } }

function kit(sourceEdits) {
  const w = createLotSetWorld({ admin: true, ...(sourceEdits ? { sourceEdits } : {}) })
  const planTier = w.load('lib/planTier.ts'), sessions = w.load('lib/inventoryCheckSessions.ts'), fixStock = w.load('lib/inventoryCheckFixStock.ts')
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
  const line = (f, id, body) => { planTier.__resetPlanTierCacheForTests(); return w.call(f, 'POST', `/api/inventory-checks/sessions/${id}/approval/lines`, body) }
  const approvals = f => f.raw.prepare('SELECT * FROM inventory_check_approvals ORDER BY submitted_at, rowid').all()
  const lots = f => f.raw.prepare('SELECT batch_id,quantity FROM branch_batch_stock WHERE batch_id IN (10,11) ORDER BY batch_id').all().map(row => [row.batch_id, row.quantity])
  const dated = (a, b) => ({ productId: 1, lots: [{ batchId: 10, scope: 'lot', counted: a[0], seen: a[1] }, { batchId: 11, scope: 'lot', counted: b[0], seen: b[1] }] })
  return { w, sessions, fixStock, world, submit, decide, line, approvals, lots, dated }
}

/** High 1: a recount of an offsetting product replaces the older count; the newest count wins. */
async function high1(k) {
  const f = k.world()
  const first = await k.submit(f, 'set-h1-submit-01', [k.dated([6, 5], [3, 4])]) // A 6 of 5, B 3 of 4: the totals agree, the dates do not
  assert.equal(first.status, 201, JSON.stringify(first.body))
  const second = await k.submit(f, 'set-h1-submit-02', [k.dated([5, 5], [2, 4])]) // the recount: A 5 of 5, B 2 of 4
  assert.equal(second.status, 201, JSON.stringify(second.body))
  const rows = k.approvals(f)
  assert.equal(rows.filter(row => row.status === 'pending').length, 1, 'exactly one pending approval: the newer count replaced the older')
  const [older, newer] = rows
  assert.equal(older.status, 'rejected'); assert.equal(older.decided_by, null); assert.equal(older.decision_note, 'Replaced by a newer count')
  assert.deepEqual(JSON.parse(older.superseded_json), { 1: newer.session_id })
  assert.equal(newer.status, 'pending')
  const stale = await k.decide(f, older.session_id, { decision: 'approve', requestId: 'set-h1-approve-01' })
  assert.equal(stale.status, 409); assert.equal(stale.body.code, 'inventory_check_approval_decided'); assert.deepEqual(k.lots(f), [[10, 5], [11, 4]], 'the replaced count moved no stock')
  const done = await k.decide(f, newer.session_id, { decision: 'approve', requestId: 'set-h1-approve-02' })
  assert.equal(done.status, 200, JSON.stringify(done.body)); assert.equal(done.body.done, true)
  assert.deepEqual(k.lots(f), [[10, 5], [11, 2]], 'the newest count says A=5, B=2 and the shop ends there')
}

/** High 2: a newer count of ANOTHER product leaves the approval pending while it still holds an open offsetting line. */
async function high2(k) {
  const f = k.world()
  const first = await k.submit(f, 'set-h2-submit-01', [k.dated([6, 5], [3, 4]), { productId: 2, countedQuantity: 5, seenQuantity: 6 }])
  assert.equal(first.status, 201, JSON.stringify(first.body))
  const id = k.approvals(f)[0].session_id
  assert.equal(k.approvals(f)[0].lines, 2)
  const second = await k.submit(f, 'set-h2-submit-02', [{ productId: 2, countedQuantity: 4, seenQuantity: 6 }]) // a newer count of product 2 only
  assert.equal(second.status, 201, JSON.stringify(second.body))
  const old = k.approvals(f).find(row => row.session_id === id)
  assert.equal(old.status, 'pending', `the approval still holds the offsetting line of product 1 (got ${old.status}, "${old.decision_note}")`)
  assert.equal(old.decided_by, null); assert.equal(old.decision_note, null)
  assert.deepEqual(JSON.parse(old.superseded_json), { 2: k.approvals(f)[1].session_id }, 'only product 2 was replaced')
  const done = await k.decide(f, id, { decision: 'approve', requestId: 'set-h2-approve-01' })
  assert.equal(done.status, 200, JSON.stringify(done.body)); assert.equal(done.body.approval.status, 'approved')
  assert.deepEqual(k.lots(f), [[10, 6], [11, 3]], 'product 1 is applied date by date; product 2 stays with its newer count')
}

async function holds(k) {
  const f = k.world()
  const made = await k.submit(f, 'set-hold-submit-01', [k.dated([6, 5], [3, 4])])
  assert.equal(made.status, 201, JSON.stringify(made.body))
  const id = k.approvals(f)[0].session_id
  assert.equal(await k.sessions.productWaitsForApproval(f.db, 1, 1), true, 'the offsetting product waits (the direct Set is held)')
  assert.equal(await k.sessions.lineWaitsForApproval(f.db, id, 1), true)
  assert.equal(await k.fixStock.waitingCountHolds(f.db, { productId: 1, branchId: 1 }), true, 'Fix stock is held for it')
  assert.equal(await k.fixStock.fixStockHeldByApproval(f.db, `inventory-check-fix-${id}-1`, { productId: 1, branchId: 1 }), true)
  assert.deepEqual([...await k.sessions.pendingApprovalLines(f.db, { id: 7, organization_id: null }, [1])], [`${id}:1`])
  assert.equal(await k.sessions.productWaitsForApproval(f.db, 2, 1), false, 'a product the count did not find different does not wait')
  const rejected = await k.line(f, id, { productId: 1, action: 'reject', requestId: 'set-hold-line-0001' })
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body))
  assert.equal(await k.sessions.productWaitsForApproval(f.db, 1, 1), false, 'a rejected line no longer waits')
}

/** The engine reads only the lines of the set, by primary key (a 60-product count with 6 lines). */
async function scan(k) {
  const f = k.world()
    // A 60-product count with 6 lines: the other 54 products agree with stock and are not lines.
    k.w.seed(f, `WITH RECURSIVE n(x) AS (SELECT 100 UNION ALL SELECT x+1 FROM n WHERE x<159)
      INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,stock_quantity,is_active) SELECT x,'P'||x,'B'||x,1,0,5,1 FROM n`)
    w_seed(k, f)
    const lines = Array.from({ length: 60 }, (_, index) => ({ productId: 100 + index, countedQuantity: index < 6 ? 4 : 5, seenQuantity: 5 }))
    const made = await k.submit(f, 'set-scan-submit-01', lines)
    assert.equal(made.status, 201, JSON.stringify(made.body))
    const id = k.approvals(f)[0].session_id; assert.equal(k.approvals(f)[0].lines, 6)
    const seen = []
    const prepare = f.env.DB.prepare, batch = f.env.DB.batch
    f.env.DB.prepare = sql => { seen.push(sql); return prepare(sql) }
    f.env.DB.batch = async statements => { for (const statement of statements) seen.push(statement.sql); return batch(statements) }
    const rejected = await k.line(f, id, { productId: 100, action: 'reject', requestId: 'set-scan-line-0001' })
    assert.equal(rejected.status, 200, JSON.stringify(rejected.body))
    const approved = await k.decide(f, id, { decision: 'approve', productIds: [101], requestId: 'set-scan-approve-01' })
    assert.equal(approved.status, 200, JSON.stringify(approved.body))
    // D1Compat rewrites @name to ?N before the statement reaches the database, so the statements are matched in that form.
    const itemReads = seen.filter(sql => /FROM\s+inventory_check_items\s+i\s+WHERE\s+i\.session_id=\?\d/.test(sql) && /^\s*SELECT/i.test(sql))
    assert.ok(itemReads.length >= 2, 'the engine read the items it needs')
    for (const sql of itemReads) { assert.match(sql, /i\.product_id IN \(SELECT value FROM json_each\(\?\d+\)\)/, 'a read of the count\'s items names its lines'); assert.doesNotMatch(sql, /inventory_check_lot_lines|abs\(/, 'no per-item rule or lot probe') }
}

/** The chip day is the day the count was MADE: counted 12 Nov and approved later (the approval flips the line and rewrites the item's updated_at), it stays under 12 Nov. */
async function chipday(k) {
  const f = k.world()
  const made = await k.submit(f, 'set-day-submit-01', [{ productId: 2, countedQuantity: 5, seenQuantity: 6 }])
  assert.equal(made.status, 201, JSON.stringify(made.body))
  const id = k.approvals(f)[0].session_id
  // The count is backdated to 12 Nov (the table forbids changing a session's started_at, as it should: it is the count time; only this fixture lifts the trigger).
  f.raw.exec('DROP TRIGGER inventory_check_sessions_identity')
  f.raw.prepare("UPDATE inventory_check_sessions SET started_at='2026-11-12T03:00:00.000Z' WHERE id=?").run(id)
  f.raw.prepare("UPDATE inventory_check_items SET updated_at='2026-11-12T03:00:00.000Z' WHERE session_id=?").run(id)
  const list = k.w.load('lib/inventoryCheckList.ts')
  const dayOf = () => f.raw.prepare(list.LATEST_ITEMS_SQL).all({ organization: null, branchId: 1, limit: 100 }).find(row => row.product_id === 2)?.day
  assert.equal(dayOf(), '2026-11-12', 'before the approval')
  const done = await k.decide(f, id, { decision: 'approve', requestId: 'set-day-approve-01' })
  assert.equal(done.status, 200, JSON.stringify(done.body)); assert.equal(done.body.approval.status, 'approved')
  const flipped = f.raw.prepare('SELECT state,updated_at FROM inventory_check_items WHERE session_id=? AND product_id=2').get(id)
  assert.equal(flipped.state, 'done'); assert.notEqual(flipped.updated_at, '2026-11-12T03:00:00.000Z', 'the approval rewrote the item time')
  assert.equal(dayOf(), '2026-11-12', 'after the approval: still the count day, not the approval day')
}

const SCENARIOS = {
  high1: { run: high1, title: 'High 1: a recount of an offsetting product replaces the older count (one pending approval, the newest count wins: A=5, B=2)' },
  high2: { run: high2, title: 'High 2: a newer count of another product does not end an approval that still holds an open offsetting line' },
  scan: { run: scan, title: "the engine reads only the lines of the set, by primary key: no scan of the session's items, no lot-line probe per item" },
  chipday: { run: chipday, title: 'the chip day of a count approved later is the day it was counted (counted 12 Nov, approved after: 12 Nov)' },
  holds: { run: holds, title: 'the offsetting product waits everywhere: Set hold, Fix stock hold, the page tag; a rejected line stops waiting' },
}
// Which scenarios each planted mutant (the old reader text) must be caught by.
// (High 2 is the auto-reject's: the waiting readers alone do not end the approval.)
const CAUGHT_BY = { 'old waiting rule (item total)': ['high1', 'holds'], 'old auto-reject rule (item scan)': ['high2'], 'engine scans every item': ['scan'], 'approval day instead of count day': ['chipday'] }

async function main() {
  for (const { title, run } of Object.values(SCENARIOS)) await check(title, () => run(kit()))
  // Every scenario that the stored set fixes must FAIL against the old reader text: a green test that cannot fail proves nothing.
  for (const [mutant, edits] of Object.entries(MUTANTS)) {
    for (const name of CAUGHT_BY[mutant]) {
      const mutated = kit(edits) // built outside the try: an edit that no longer matches the source is an error, never a catch
      let caught = false
      try { await SCENARIOS[name].run(mutated) } catch { caught = true }
      await check(`mutant "${mutant}" is caught by ${name}`, () => assert.ok(caught, 'the scenario passed against the old reader'))
    }
  }

  await check('the set is recorded at creation by both writers: a lots submission and a plain submission (the plain one has no received dates)', async () => {
    const k = kit(), f = k.world()
    await k.submit(f, 'set-both-submit-01', [k.dated([6, 5], [3, 4]), { productId: 2, countedQuantity: 6, seenQuantity: 6 }])
    const [row] = k.approvals(f)
    assert.equal(row.lines, 1); assert.deepEqual(JSON.parse(row.line_set_json), { 1: 1 }, 'only the product found different is a line; the matching one is not')
    // The plain route (no lots): POST /sessions/submit-style writer is the older submission.
    const plain = await k.w.call(f, 'POST', '/api/inventory-checks/submissions', { branchId: 1, requestId: 'set-both-submit-02', lines: [{ productId: 2, countedQuantity: 5, seenQuantity: 6 }] })
    assert.equal(plain.status, 201, JSON.stringify(plain.body))
    const rows = k.approvals(f); assert.deepEqual(JSON.parse(rows[1].line_set_json), { 2: 1 })
  })

  await check('the set never changes after creation (the identity trigger), and the detail projects exactly the server\'s lines', async () => {
    const k = kit(), f = k.world()
    const made = await k.submit(f, 'set-ident-submit-01', [k.dated([6, 5], [3, 4]), { productId: 2, countedQuantity: 5, seenQuantity: 6 }])
    assert.deepEqual(made.body.approval.line_ids, [1, 2]); assert.equal(made.body.approval.lines, 2)
    assert.throws(() => f.raw.exec("UPDATE inventory_check_approvals SET line_set_json='{\"1\":1}'"), /inventory_check_approval_immutable/)
    const detail = await k.w.call(f, 'GET', `/api/inventory-checks/sessions/${made.body.session?.id ?? k.approvals(f)[0].session_id}?approvals=1`)
    assert.deepEqual(detail.body.approval?.line_ids ?? made.body.approval.line_ids, [1, 2])
  })

  await check('an approval with no recorded set (made by a Worker that does not know the column) keeps the earlier rule and is still decidable', async () => {
    const k = kit(), f = k.world()
    await k.submit(f, 'set-null-submit-01', [{ productId: 2, countedQuantity: 5, seenQuantity: 6 }])
    f.raw.exec('DROP TRIGGER inventory_check_approvals_identity; UPDATE inventory_check_approvals SET line_set_json=NULL')
    const id = k.approvals(f)[0].session_id
    assert.equal(await k.sessions.productWaitsForApproval(f.db, 2, 1), true, 'the item total still makes a plain difference wait')
    const done = await k.decide(f, id, { decision: 'approve', requestId: 'set-null-approve-01' })
    assert.equal(done.status, 200, JSON.stringify(done.body)); assert.equal(done.body.approval.status, 'approved')
    assert.equal(done.body.approval.line_ids, undefined, 'no set is projected when none is recorded')
    const again = kit(), g = again.world()
    await again.submit(g, 'set-null-submit-02', [{ productId: 2, countedQuantity: 5, seenQuantity: 6 }])
    g.raw.exec('DROP TRIGGER inventory_check_approvals_identity; UPDATE inventory_check_approvals SET line_set_json=NULL')
    const rejected = await again.line(g, again.approvals(g)[0].session_id, { productId: 2, action: 'reject', requestId: 'set-null-line-00001' })
    assert.equal(rejected.status, 200, JSON.stringify(rejected.body)); assert.equal(rejected.body.approval.status, 'rejected')
  })


  if (failures.length) { console.error(`FAILED ${failures.length}: ${failures.join(' | ')}`); process.exit(1) }
  console.log('PASS test-inventory-check-line-set-native')
}
// The branch-stock rows the 60 extra products need to be countable at branch 1.
function w_seed(k, f) {
  k.w.seed(f, `INSERT INTO branch_stock(product_id,branch_id,quantity) SELECT id,1,5 FROM products WHERE id BETWEEN 100 AND 159;
    INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,batch_number,unit_cost_usd,is_active) SELECT id,id,'K'||id,'K'||id,'2026-09-04',1,1,1 FROM products WHERE id BETWEEN 100 AND 159;
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) SELECT id,1,5 FROM products WHERE id BETWEEN 100 AND 159;`)
}
main().catch(error => { console.error(error); process.exit(1) })
