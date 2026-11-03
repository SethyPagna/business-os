#!/usr/bin/env node
// Lane 6.0.1045 (ic_fix_stock): a submitted count is approved on the REAL Worker, with the REAL stock writer, on the Free plan under Miniflare.
// Proves what the faithful-double test cannot: that the Set sessions' commit really takes the approval's lines (lowering through the stock-session
// removal, raising through the lot-level Set writer), that stock ends at the counted number minus damaged units in every ledger, that the count is applied
// as a VARIANCE (a sale after the count survives it), that a lost answer is repeated without applying twice, that one
// request stays inside the Free plan's 50 D1 calls, that rejecting writes nothing, and that the permission refusals hold on the real route stack.
//
// Run: node scripts/test-inventory-check-approvals-world-native.cjs
'use strict'
process.env.READ_BUDGET_DEADLINE_MS = process.env.READ_BUDGET_DEADLINE_MS || '180000'
const assert = require('node:assert/strict')
const bcrypt = require('bcryptjs')
const { bootWorld } = require('./read-budget/world.cjs')
const { ADMIN } = require('./read-budget/seed.cjs')
const { executeRawStockTransaction } = require('../src/lib/stockTransaction.ts')

const FREE_CALL_LIMIT = 50
let groups = 0
// ONLY=<text> runs the groups whose name contains it (diagnosis only; the gate runs them all).
const check = async (name, run) => { if (process.env.ONLY && !name.includes(process.env.ONLY)) return; await run(); groups++; console.log(`PASS ${name}`) }
let sequence = 0
const key = label => `world-${label}-${Date.now().toString(36)}-${++sequence}`

async function main() {
  const world = await bootWorld({ tier: 'free' })
  try {
    // world.restart() swaps the D1 handle, so every use goes through the world's current one.
    const db = { prepare: (...args) => world.db.prepare(...args), exec: (...args) => world.db.exec(...args) }
    // The Worker memoizes the switches for 15 s per isolate: a new document needs a fresh isolate to be seen at once.
    const flags = async value => {
      await db.prepare("INSERT OR REPLACE INTO system_flags(key, value) VALUES('read_switches', ?)").bind(JSON.stringify({ epoch: 1, set_at: '2026-11-03T00:00:00.000Z', set_by: 1, switches: value })).run()
      await world.restart()
    }
    await flags({ ic_simple: 'on', ic_fix_stock: 'on' })

    // A counter (may count, sees stock, may not approve) and a lead (may approve and adjust stock), beside the budget administrator.
    const counting = { inventory_checks: true, inventory_check_show_stock: true, inventory_check_show_barcode: true, inventory_check_show_brand: true, inventory_check_show_category: true, inventory_check_show_received: true }
    await db.prepare("INSERT INTO roles(id,name,code,permissions,is_system) VALUES(902,'Counter','employee',?,0),(903,'Lead','lead',?,0)")
      .bind(JSON.stringify(counting), JSON.stringify({ ...counting, inventory: true, inventory_check_approve: true })).run()
    for (const [id, username] of [[902, 'budget_counter'], [903, 'budget_lead']]) {
      await db.prepare("INSERT INTO users(id,username,name,password,role_id,permissions,is_active,organization_id,must_change_password) VALUES(?,?,?,?,?,'{}',1,?,0)")
        .bind(id, username, username, bcrypt.hashSync('budget-password-1', 4), id, world.orgId).run()
    }
    const cookies = { admin: world.cookie }
    for (const [name, username] of [['counter', 'budget_counter'], ['lead', 'budget_lead']]) {
      // Non-administrators sign in from an approved device only (the administrator's Device approvals page): approve one for each.
      await db.prepare("INSERT INTO trusted_devices(user_id, device_id, device_name, status, decided_at) VALUES((SELECT id FROM users WHERE username = ?), 'world-device', 'test device', 'approved', datetime('now'))").bind(username).run()
      const login = await world.send('POST', '/api/auth/login', { username, password: 'budget-password-1', organizationId: world.orgId, deviceId: 'world-device' }, { cookie: null })
      assert.equal(login.status, 200, `${username} signs in: ${login.text.slice(0, 200)}`)
      assert.ok(login.setCookie, `${username} gets a session: ${login.text.slice(0, 200)}`)
      cookies[name] = login.setCookie.split(';')[0]
    }
    const as = (who, method, url, body) => world.send(method, url, body, { cookie: cookies[who] })

    // Stocked products with a received date at branch 1 (the seed keeps every ledger consistent), away from the shapes other tests use.
    const rows = await world.all(`SELECT b.variant_product_id AS pid, b.id AS batch FROM branch_batch_stock s JOIN product_batches b ON b.id = s.batch_id
      JOIN products p ON p.id = b.variant_product_id AND p.is_active = 1 AND (p.id - 1000) % 8 NOT IN (1, 2) WHERE s.branch_id = 1 AND s.quantity >= 6 ORDER BY b.id LIMIT 12 OFFSET 2400`)
    assert.ok(rows.length >= 12, 'the seed has enough stocked products')
    const [LOW, RAISE, SAME, REJECT_A, REJECT_B] = rows.map(row => row.pid)
    const stock = async pid => ({
      ordinary: (await world.all('SELECT quantity FROM branch_stock WHERE product_id=? AND branch_id=1', pid))[0].quantity,
      damaged: (await world.all('SELECT COALESCE(SUM(quantity_remaining),0) AS q FROM damaged_stock_lots WHERE product_id=? AND branch_id=1', pid))[0].q,
      cache: (await world.all('SELECT stock_quantity AS q FROM products WHERE id=?', pid))[0].q,
      lots: (await world.all('SELECT COALESCE(SUM(s.quantity),0) AS q FROM branch_batch_stock s JOIN product_batches b ON b.id=s.batch_id WHERE b.variant_product_id=? AND s.branch_id=1', pid))[0].q,
    })
    const snapshot = async pids => { const out = {}; for (const pid of pids) out[pid] = await stock(pid); return out }

    // Two units of RAISE are broken: stock now = ordinary + damaged, and Set will exclude the damaged ones.
    const tagged = await as('admin', 'POST', '/api/inventory/adjust', { productId: RAISE, branchId: 1, quantity: 2, type: 'remove', reason: 'broken in store', conditionTag: 'damaged', client_request_id: key('damage') })
    assert.equal(tagged.status, 200, tagged.text.slice(0, 300))
    const before = await snapshot([LOW, RAISE, SAME, REJECT_A, REJECT_B])
    assert.equal(before[RAISE].damaged, 2)
    const total = pid => before[pid].ordinary + before[pid].damaged

    await check('a counter submits three counts; two differ: one pending approval, stock untouched, nothing visible to the counter beyond its own answer', async () => {
      const lines = [
        { productId: LOW, countedQuantity: total(LOW) - 2, seenQuantity: total(LOW), checked: false },
        { productId: RAISE, countedQuantity: total(RAISE) + 3, seenQuantity: total(RAISE), checked: false },
        { productId: SAME, countedQuantity: total(SAME), seenQuantity: total(SAME), checked: true },
      ]
      const made = await as('counter', 'POST', '/api/inventory-checks/submissions', { branchId: 1, requestId: key('submit'), lines })
      assert.equal(made.status, 201, made.text.slice(0, 400))
      assert.equal(made.json.approval.status, 'pending'); assert.equal(made.json.approval.lines, 2); assert.equal(made.json.approval.can_approve, false)
      world.sessionId = made.json.item.id
      assert.deepEqual(await snapshot([LOW, RAISE, SAME]), { [LOW]: before[LOW], [RAISE]: before[RAISE], [SAME]: before[SAME] }, 'a pending approval moves no stock')
    })

    await check('the counter cannot decide; a lead without the extra cannot either (server side); the refusals write nothing', async () => {
      const id = world.sessionId
      for (const decision of ['approve', 'reject']) {
        const refused = await as('counter', 'POST', `/api/inventory-checks/sessions/${id}/approval`, { decision, requestId: key('refused') })
        assert.equal(refused.status, 403, decision); assert.equal(refused.json.code, 'inventory_check_approve_required')
      }
      assert.deepEqual(await snapshot([LOW, RAISE, SAME]), { [LOW]: before[LOW], [RAISE]: before[RAISE], [SAME]: before[SAME] })
      assert.equal((await world.all("SELECT status FROM inventory_check_approvals WHERE session_id=?", id))[0].status, 'pending')
    })

    await check('approval on the Free plan: one stock line per request, each inside the plan\'s call limit, stock ends at count minus damaged units in every ledger', async () => {
      const id = world.sessionId, request = key('approve'), answers = []
      for (let step = 0; step < 6; step++) {
        const answer = await as('lead', 'POST', `/api/inventory-checks/sessions/${id}/approval`, { decision: 'approve', requestId: request })
        assert.equal(answer.status, 200, `step ${step}: ${answer.text.slice(0, 400)}`)
        assert.ok(answer.calls <= FREE_CALL_LIMIT, `step ${step} used ${answer.calls} D1 calls (limit ${FREE_CALL_LIMIT})`)
        answers.push({ applied: answer.json.applied, remaining: answer.json.remaining, done: answer.json.done, calls: answer.calls })
        if (answer.json.done) break
      }
      assert.deepEqual(answers.map(answer => [answer.applied, answer.remaining, answer.done]), [[1, 1, false], [1, 0, true]], `two lines, one per request: ${JSON.stringify(answers)}`)
      const lowAfter = await stock(LOW), raiseAfter = await stock(RAISE), sameAfter = await stock(SAME)
      assert.equal(lowAfter.ordinary, total(LOW) - 2, 'lowered to the count')
      assert.equal(raiseAfter.ordinary, total(RAISE) + 3 - 2, 'count 12 with 2 damaged sets 10: raised to the count minus damaged units')
      assert.equal(raiseAfter.damaged, 2, 'damaged units are untouched')
      assert.equal(raiseAfter.ordinary + raiseAfter.damaged, total(RAISE) + 3, 'stock now equals the count')
      assert.deepEqual(sameAfter, before[SAME], 'a matching count is never written')
      for (const [pid, after] of [[LOW, lowAfter], [RAISE, raiseAfter]]) {
        assert.equal(after.lots, after.ordinary, `lots equal branch stock for ${pid}`); assert.equal(after.cache, after.ordinary + (await world.all('SELECT COALESCE(SUM(quantity),0) AS q FROM branch_stock WHERE product_id=? AND branch_id<>1', pid))[0].q, `product cache for ${pid}`)
      }
      const approval = (await world.all('SELECT * FROM inventory_check_approvals WHERE session_id=?', id))[0]
      assert.equal(approval.status, 'approved'); assert.equal(approval.decided_by, 903); assert.equal(approval.decided_by_name, 'budget_lead')
      const lines = JSON.parse(approval.applied_json).lines
      assert.deepEqual([lines[LOW].before, lines[LOW].after, lines[RAISE].before, lines[RAISE].after], [before[LOW].ordinary, total(LOW) - 2, before[RAISE].ordinary, total(RAISE) + 1])
      const items = await world.all('SELECT product_id,state,revision,updated_by FROM inventory_check_items WHERE session_id=? ORDER BY product_id', id)
      assert.deepEqual(items.filter(item => [LOW, RAISE].includes(item.product_id)).map(item => [item.state, item.revision, item.updated_by]), [['done', 2, 903], ['done', 2, 903]])
      const movements = await world.all("SELECT product_id,movement_type,quantity FROM inventory_movements WHERE reason LIKE '%Inventory check approved%' ORDER BY id")
      assert.ok(movements.some(row => row.product_id === LOW), 'the lowering left its stock movement')
      const operations = await world.all("SELECT request_id FROM stock_lot_adjustment_operations WHERE request_id LIKE ?", `${request}-%`)
      assert.equal(operations.length, 1, 'the raise went through the lot-level Set writer (undoable Set operation)')
      const history = await as('lead', 'GET', `/api/inventory-checks/sessions/${id}/history?page=1&pageSize=50`)
      assert.equal(history.json.items.filter(item => item.after?.approval).length, 3, 'two lines and the decision are on the record')
      world.approveRequest = request
    })

    await check('repeating the finished request is the same answer and writes nothing; any other decision is refused', async () => {
      const id = world.sessionId, now = await snapshot([LOW, RAISE, SAME])
      const again = await as('lead', 'POST', `/api/inventory-checks/sessions/${id}/approval`, { decision: 'approve', requestId: world.approveRequest })
      assert.equal(again.status, 200); assert.equal(again.json.replayed, true); assert.equal(again.json.done, true)
      const other = await as('lead', 'POST', `/api/inventory-checks/sessions/${id}/approval`, { decision: 'approve', requestId: key('other') })
      assert.equal(other.status, 409); assert.equal(other.json.code, 'inventory_check_approval_decided')
      assert.deepEqual(await snapshot([LOW, RAISE, SAME]), now)
    })

    await check('reject: the lead rejects a second count, stock is exactly as before, and the record says who and when', async () => {
      const lines = [
        { productId: REJECT_A, countedQuantity: total(REJECT_A) + 5, seenQuantity: total(REJECT_A), checked: false },
        { productId: REJECT_B, countedQuantity: Math.max(0, total(REJECT_B) - 4), seenQuantity: total(REJECT_B), checked: false },
      ]
      const made = await as('counter', 'POST', '/api/inventory-checks/submissions', { branchId: 1, requestId: key('submit'), lines })
      assert.equal(made.status, 201, made.text.slice(0, 300))
      const id = made.json.item.id
      const stockBefore = await snapshot([REJECT_A, REJECT_B])
      const rejected = await as('lead', 'POST', `/api/inventory-checks/sessions/${id}/approval`, { decision: 'reject', requestId: key('reject'), note: 'Recount tomorrow' })
      assert.equal(rejected.status, 200, rejected.text.slice(0, 300)); assert.equal(rejected.json.approval.status, 'rejected'); assert.equal(rejected.json.done, true)
      assert.deepEqual(await snapshot([REJECT_A, REJECT_B]), stockBefore, 'rejecting writes no stock')
      const row = (await world.all('SELECT status,decided_by,decision_note,applied_json FROM inventory_check_approvals WHERE session_id=?', id))[0]
      assert.deepEqual({ ...row }, { status: 'rejected', decided_by: 903, decision_note: 'Recount tomorrow', applied_json: '{}' })
    })

    const approveAll = async (id, request, label) => {
      const answers = []
      for (let step = 0; step < 8; step++) {
        const answer = await as('lead', 'POST', `/api/inventory-checks/sessions/${id}/approval`, { decision: 'approve', requestId: request })
        assert.equal(answer.status, 200, `${label} step ${step}: ${answer.text.slice(0, 400)}`)
        assert.ok(answer.calls <= FREE_CALL_LIMIT, `${label} step ${step} used ${answer.calls} D1 calls (limit ${FREE_CALL_LIMIT})`)
        answers.push(answer.calls)
        if (answer.json.done) return answers
      }
      throw new Error(`${label} did not finish`)
    }
    // A sale after the count: the stock leaves through the real stock writer (so every ledger moves exactly as a sale moves them) and its movement is then labelled as a movement that is not a correction (a sale or goods out).
    // A manual Remove would not do: a person's correction after the count is refused, a sale keeps the variance.
    const sell = async pid => {
      const sold = await as('admin', 'POST', '/api/inventory/adjust', { productId: pid, branchId: 1, quantity: 1, type: 'remove', reason: 'sold after the count', client_request_id: key('sale') })
      assert.equal(sold.status, 200)
      await executeRawStockTransaction(world.db, [world.db.prepare("UPDATE inventory_movements SET movement_type='out' WHERE product_id=? AND reason='sold after the count'").bind(pid)])
    }
    const breakTwo = async pid => assert.equal((await as('admin', 'POST', '/api/inventory/adjust', { productId: pid, branchId: 1, quantity: 2, type: 'remove', reason: 'broken in store', conditionTag: 'damaged', client_request_id: key('damage') })).status, 200)

    await check('the count is applied as a VARIANCE on the real Worker: a sale after the count survives it (counted 26 over 24, one sold: 25), damaged units are never touched, a count below them is refused', async () => {
      const [VAR_RAISE, VAR_LOW, BELOW] = rows.slice(8, 11).map(row => row.pid)
      await breakTwo(VAR_LOW); await breakTwo(BELOW)
      const start = await snapshot([VAR_RAISE, VAR_LOW, BELOW]), totalOf = pid => start[pid].ordinary + start[pid].damaged
      const submit = lines => as('counter', 'POST', '/api/inventory-checks/submissions', { branchId: 1, requestId: key('submit'), lines })
      const made = await submit([
        { productId: VAR_RAISE, countedQuantity: totalOf(VAR_RAISE) + 2, seenQuantity: totalOf(VAR_RAISE), checked: false },
        { productId: VAR_LOW, countedQuantity: totalOf(VAR_LOW) - 3, seenQuantity: totalOf(VAR_LOW), checked: false }])
      assert.equal(made.status, 201, made.text.slice(0, 300))
      await sell(VAR_RAISE); await sell(VAR_LOW)
      const calls = await approveAll(made.json.item.id, key('approve'), 'variance')
      const raised = await stock(VAR_RAISE), lowered = await stock(VAR_LOW)
      assert.equal(raised.ordinary, start[VAR_RAISE].ordinary + 2 - 1, 'counted 26 over the 24 it saw, one sold meanwhile: 25, not 26')
      assert.equal(lowered.ordinary, start[VAR_LOW].ordinary - 1 - 3, 'the sale and the missing units both leave')
      assert.equal(lowered.damaged, 2, 'damaged units are never touched'); assert.equal(lowered.lots, lowered.ordinary); assert.equal(raised.lots, raised.ordinary)
      const below = await submit([{ productId: BELOW, countedQuantity: 1, seenQuantity: totalOf(BELOW), checked: false }])
      const refused = await as('lead', 'POST', `/api/inventory-checks/sessions/${below.json.item.id}/approval`, { decision: 'approve', requestId: key('below') })
      assert.equal(refused.status, 409); assert.equal(refused.json.code, 'inventory_check_count_below_damaged'); assert.deepEqual(refused.json.productIds, [BELOW])
      assert.deepEqual(await stock(BELOW), start[BELOW], 'nothing was written')
      assert.equal((await as('lead', 'POST', `/api/inventory-checks/sessions/${below.json.item.id}/approval`, { decision: 'reject', requestId: key('below-reject') })).status, 200, 'and it can still be rejected')
      console.log('  D1 calls per variance step (limit ' + FREE_CALL_LIMIT + '): ' + calls.join(', '))
    })

    await check('N2 queue-first on the real Worker: a later count of a product whose count waits replaces it (the older approval is rejected in the same commit), and a count is never stacked on a correction a person made after it', async () => {
      const pid = rows[7].pid, start = await stock(pid), total = start.ordinary + start.damaged
      const submit = (counted, who = 'counter') => as(who, 'POST', '/api/inventory-checks/submissions', { branchId: 1, requestId: key('submit'), lines: [{ productId: pid, countedQuantity: counted, seenQuantity: total, checked: false }] })
      const first = await submit(total - 2)
      assert.equal(first.status, 201, first.text.slice(0, 300))
      const second = await submit(total - 2, 'lead')
      assert.equal(second.status, 201, second.text.slice(0, 300)); assert.equal(second.json.approval.status, 'pending')
      const older = (await world.all('SELECT status,decided_by,superseded_json FROM inventory_check_approvals WHERE session_id=?', first.json.item.id))[0]
      assert.deepEqual({ ...older }, { status: 'rejected', decided_by: 903, superseded_json: JSON.stringify({ [pid]: second.json.item.id }) }, 'the older line is replaced by the newer count and, being its only line, the older approval is rejected with it')
      const decided = await as('lead', 'POST', `/api/inventory-checks/sessions/${first.json.item.id}/approval`, { decision: 'approve', requestId: key('older') })
      assert.equal(decided.status, 409); assert.equal(decided.json.code, 'inventory_check_approval_decided')
      assert.equal((await world.all("SELECT COUNT(*) AS n FROM inventory_check_approvals WHERE status='pending' AND session_id IN (?,?)", first.json.item.id, second.json.item.id))[0].n, 1, 'one waiting item for the product')
      // A person lowers the same stock by hand after the count: applying the count on top of that would take the shortage twice.
      const counted = await as('admin', 'POST', '/api/inventory/adjust', { productId: pid, branchId: 1, quantity: 2, type: 'remove', reason: 'recounted by hand', client_request_id: key('hand') })
      assert.equal(counted.status, 200, counted.text.slice(0, 300))
      const after = await stock(pid)
      const stacked = await as('admin', 'POST', `/api/inventory-checks/sessions/${second.json.item.id}/approval`, { decision: 'approve', requestId: key('stack') })
      assert.equal(stacked.status, 409, stacked.text.slice(0, 300)); assert.equal(stacked.json.code, 'inventory_check_stock_adjusted'); assert.deepEqual(stacked.json.productIds, [pid])
      assert.deepEqual(await stock(pid), after, 'nothing was written')
      assert.equal((await as('admin', 'POST', `/api/inventory-checks/sessions/${second.json.item.id}/approval`, { decision: 'reject', requestId: key('stack-reject') })).status, 200, 'it can still be rejected')
    })

    await check('a lost answer on the real stock writers (a removal, then a lot-level raise): the approval is claimed, cannot be rejected, and each repeat replays the write that landed instead of applying it twice', async () => {
      const [LOST_LOW, LOST_RAISE] = [rows[11].pid, rows[5].pid].sort((a, b) => a - b)
      const start = await snapshot([LOST_LOW, LOST_RAISE])
      const made = await as('counter', 'POST', '/api/inventory-checks/submissions', { branchId: 1, requestId: key('submit'), lines: [
        { productId: LOST_LOW, countedQuantity: start[LOST_LOW].ordinary - 2, seenQuantity: start[LOST_LOW].ordinary, checked: false },
        { productId: LOST_RAISE, countedQuantity: start[LOST_RAISE].ordinary + 2, seenQuantity: start[LOST_RAISE].ordinary, checked: false }] })
      assert.equal(made.status, 201, made.text.slice(0, 300))
      const id = made.json.item.id, request = key('approve'), url = `/api/inventory-checks/sessions/${id}/approval`
      const step = () => as('lead', 'POST', url, { decision: 'approve', requestId: request })
      const lose = async () => {
        await db.exec("CREATE TRIGGER test_lost_answer BEFORE UPDATE OF applied_json ON inventory_check_approvals WHEN NEW.applied_json <> OLD.applied_json BEGIN SELECT RAISE(ABORT,'test_lost_answer'); END")
        try { const lost = await step(); assert.equal(lost.status, 503, lost.text.slice(0, 300)); assert.equal(lost.json.code, 'inventory_check_outcome_unknown'); return lost.calls }
        finally { await db.exec('DROP TRIGGER IF EXISTS test_lost_answer') }
      }
      const receipts = async () => (await world.all('SELECT COUNT(*) AS n FROM stock_mutation_receipts WHERE request_id LIKE ?', `${request}-%`))[0].n
      const calls = [await lose()]
      assert.equal((await stock(LOST_LOW)).ordinary, start[LOST_LOW].ordinary - 2, 'the removal did land'); assert.equal(await receipts(), 1)
      const claim = (await world.all('SELECT applying_request_id,applying_by,status,applied_json FROM inventory_check_approvals WHERE session_id=?', id))[0]
      assert.deepEqual({ ...claim }, { applying_request_id: request, applying_by: 903, status: 'pending', applied_json: '{}' })
      const reject = await as('lead', 'POST', url, { decision: 'reject', requestId: key('reject') })
      assert.equal(reject.status, 409); assert.equal(reject.json.code, 'inventory_check_approval_in_progress')
      // A line being applied is never replaced by a newer count, whatever the figure (even one that matches stock): the answer names the product and tells nobody what the stock holds.
      const busy = await as('lead', 'POST', '/api/inventory-checks/submissions', { branchId: 1, requestId: key('busy'), lines: [{ productId: LOST_RAISE, countedQuantity: start[LOST_RAISE].ordinary, seenQuantity: start[LOST_RAISE].ordinary, checked: true }] })
      assert.equal(busy.status, 409, busy.text.slice(0, 300)); assert.equal(busy.json.code, 'inventory_check_count_in_progress'); assert.deepEqual(busy.json.productIds, [LOST_RAISE])
      const other = await as('admin', 'POST', url, { decision: 'approve', requestId: key('other') })
      assert.equal(other.status, 409); assert.equal(other.json.code, 'inventory_check_approval_in_progress', 'only the approver who started continues: the stock writers receipts are per approver')
      await sell(LOST_LOW)
      const replayed = await step()
      assert.equal(replayed.status, 200, replayed.text.slice(0, 300)); assert.deepEqual([replayed.json.applied, replayed.json.done], [1, false]); calls.push(replayed.calls)
      assert.equal((await stock(LOST_LOW)).ordinary, start[LOST_LOW].ordinary - 3, 'recorded from the replay: the removal was not applied again, and the sale was not undone')
      calls.push(await lose())
      assert.equal((await stock(LOST_RAISE)).ordinary, start[LOST_RAISE].ordinary + 2, 'the raise did land'); assert.equal(await receipts(), 2)
      const finished = await step()
      assert.equal(finished.status, 200, finished.text.slice(0, 300)); assert.deepEqual([finished.json.applied, finished.json.done], [1, true]); calls.push(finished.calls)
      assert.equal((await stock(LOST_RAISE)).ordinary, start[LOST_RAISE].ordinary + 2, 'the raise was not applied again')
      assert.ok(calls.every(count => count <= FREE_CALL_LIMIT), `D1 calls per step: ${calls.join(', ')}`)
      const movements = await world.all("SELECT product_id,COUNT(*) AS n FROM inventory_movements WHERE reason LIKE '%Inventory check approved%' AND product_id IN (?,?) GROUP BY product_id ORDER BY product_id", LOST_LOW, LOST_RAISE)
      assert.deepEqual(movements.map(row => row.n), [1, 1], 'exactly one movement per line')
      const row = (await world.all('SELECT status,decision_request_id,plan_json FROM inventory_check_approvals WHERE session_id=?', id))[0]
      assert.deepEqual({ ...row }, { status: 'approved', decision_request_id: request, plan_json: '{}' })
      console.log('  D1 calls per step (limit ' + FREE_CALL_LIMIT + '): ' + calls.join(', '))
    })

    await check('N1 on the real Worker: when the approver who started an approval is gone, another approver takes it over from the stock receipts and finishes it: the stock changes once, inside the Free call limit', async () => {
      const pid = rows[7].pid, start = await stock(pid), total = start.ordinary + start.damaged
      const made = await as('counter', 'POST', '/api/inventory-checks/submissions', { branchId: 1, requestId: key('submit'), lines: [{ productId: pid, countedQuantity: total - 2, seenQuantity: total, checked: false }] })
      assert.equal(made.status, 201, made.text.slice(0, 300))
      const id = made.json.item.id, url = `/api/inventory-checks/sessions/${id}/approval`, request = key('approve')
      // The lead starts it and the removal lands, but the answer is lost before the approval records it.
      await db.exec("CREATE TRIGGER test_lost_answer BEFORE UPDATE OF applied_json ON inventory_check_approvals WHEN NEW.applied_json <> OLD.applied_json BEGIN SELECT RAISE(ABORT,'test_lost_answer'); END")
      try { const lost = await as('lead', 'POST', url, { decision: 'approve', requestId: request }); assert.equal(lost.status, 503, lost.text.slice(0, 300)) } finally { await db.exec('DROP TRIGGER IF EXISTS test_lost_answer') }
      assert.equal((await stock(pid)).ordinary, start.ordinary - 2, 'the removal did land')
      const claimer = (await world.all('SELECT applying_by FROM inventory_check_approvals WHERE session_id=?', id))[0].applying_by
      await db.prepare('UPDATE users SET is_active=0 WHERE id=?').bind(claimer).run()
      try {
        const takeKey = key('take'), calls = []
        const take = await as('admin', 'POST', url, { decision: 'approve', requestId: takeKey })
        assert.equal(take.status, 200, take.text.slice(0, 300)); assert.deepEqual([take.json.takeover, take.json.applied, take.json.remaining, take.json.done], [true, 1, 0, false]); calls.push(take.calls)
        assert.equal((await stock(pid)).ordinary, start.ordinary - 2, 'a takeover moves no stock')
        const finished = await as('admin', 'POST', url, { decision: 'approve', requestId: takeKey })
        assert.equal(finished.status, 200, finished.text.slice(0, 300)); assert.deepEqual([finished.json.done, finished.json.approval.status], [true, 'approved']); calls.push(finished.calls)
        const after = await stock(pid)
        assert.equal(after.ordinary, start.ordinary - 2, 'one shortage, applied once'); assert.equal(after.lots, after.ordinary); assert.equal(after.cache, start.cache - 2)
        assert.equal((await world.all("SELECT COUNT(*) AS n FROM inventory_movements WHERE product_id=? AND reason LIKE '%Inventory check approved%'", pid))[0].n, 1, 'exactly one movement')
        const row = (await world.all('SELECT status,takeovers,applying_by FROM inventory_check_approvals WHERE session_id=?', id))[0]
        assert.deepEqual([row.status, row.takeovers, row.applying_by !== claimer], ['approved', 1, true])
        assert.ok(calls.every(count => count <= FREE_CALL_LIMIT), `D1 calls per step: ${calls.join(', ')}`)
        console.log('  D1 calls per takeover step (limit ' + FREE_CALL_LIMIT + '): ' + calls.join(', '))
      } finally { await db.prepare('UPDATE users SET is_active=1 WHERE id=?').bind(claimer).run() }
    })

    await check('R1 on the real stock writers: a line written under an approval commits only while that approval is still claimed by its writer; otherwise nothing is written, the receipt is released, and the answer says so', async () => {
      const [LOWER, RAISER] = [REJECT_A, REJECT_B]
      const start = await snapshot([LOWER, RAISER])
      const made = await as('counter', 'POST', '/api/inventory-checks/submissions', { branchId: 1, requestId: key('submit'), lines: [
        { productId: LOWER, countedQuantity: start[LOWER].ordinary - 2, seenQuantity: start[LOWER].ordinary, checked: false },
        { productId: RAISER, countedQuantity: start[RAISER].ordinary + 2, seenQuantity: start[RAISER].ordinary, checked: false }] })
      assert.equal(made.status, 201, made.text.slice(0, 300))
      const id = made.json.item.id, claimKey = key('claim')
      const batchOf = pid => world.all('SELECT b.id FROM product_batches b JOIN branch_batch_stock s ON s.batch_id=b.id AND s.branch_id=1 WHERE b.variant_product_id=? ORDER BY b.id LIMIT 1', pid).then(found => found[0].id)
      const lowering = (request, over = {}) => ({ productId: LOWER, branchId: 1, quantity: 1, type: 'remove', reason: 'Inventory check approved: counted test', client_request_id: request, approvalClaim: { sessionId: id, key: claimKey }, ...over })
      const raising = async (request, over = {}) => ({ productId: RAISER, branchId: 1, quantity: start[RAISER].ordinary + 1, type: 'set', setScope: 'branch', batchId: await batchOf(RAISER), expectedBranchQuantity: start[RAISER].ordinary,
        reason: 'Inventory check approved: counted test', client_request_id: request, approvalClaim: { sessionId: id, key: claimKey }, ...over })
      const receiptsFor = request => world.all('SELECT written FROM stock_mutation_receipts WHERE request_id=?', request)
      const refusedClean = async (answer, request, pid) => {
        assert.equal(answer.status, 409, answer.text.slice(0, 300)); assert.equal(answer.json.code, 'inventory_check_claim_lost')
        assert.deepEqual(await stock(pid), start[pid], 'nothing was written in any ledger'); assert.equal((await receiptsFor(request)).length, 0, 'the receipt this attempt made is released')
      }
      // Nobody claimed the approval yet: the claim names a key it does not hold, so neither writer writes.
      const lowerNoClaim = key('lower'), raiseNoClaim = key('raise')
      await refusedClean(await as('lead', 'POST', '/api/inventory/adjust', lowering(lowerNoClaim)), lowerNoClaim, LOWER)
      await refusedClean(await as('lead', 'POST', '/api/inventory/adjust', await raising(raiseNoClaim)), raiseNoClaim, RAISER)
      const viaCommit = key('commit')
      const committed = await as('lead', 'POST', '/api/inventory/fast-stock-in/commit', { lines: [{ key: 'one', wire: 'adjust', body: lowering(viaCommit) }] })
      assert.equal(committed.status, 200, committed.text.slice(0, 300)); assert.deepEqual([committed.json.results[0].ok, committed.json.results[0].code], [false, 'inventory_check_claim_lost'])
      assert.deepEqual(await stock(LOWER), start[LOWER]); assert.equal((await receiptsFor(viaCommit)).length, 0)
      const malformed = await as('lead', 'POST', '/api/inventory/adjust', lowering(key('bad'), { approvalClaim: { sessionId: id } }))
      assert.equal(malformed.status, 400); assert.equal(malformed.json.code, 'invalid_approval_claim')
      // The lead claims the approval (as the approval engine does) and writes under it: both writers commit, and mark the receipt in the same batch.
      await db.exec(`UPDATE inventory_check_approvals SET applying_request_id='${claimKey}',applying_by=903,applying_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),plan_json='{"${LOWER}":{"before":1,"target":0,"counted":0,"damaged":0}}' WHERE session_id='${id}'`)
      const lowerOk = key('lower'), raiseOk = key('raise')
      const lowered = await as('lead', 'POST', '/api/inventory/adjust', lowering(lowerOk))
      assert.equal(lowered.status, 200, lowered.text.slice(0, 300)); assert.equal((await stock(LOWER)).ordinary, start[LOWER].ordinary - 1); assert.deepEqual((await receiptsFor(lowerOk)).map(row => row.written), [1])
      const raised = await as('lead', 'POST', '/api/inventory/adjust', await raising(raiseOk))
      assert.equal(raised.status, 200, raised.text.slice(0, 300)); assert.equal((await stock(RAISER)).ordinary, start[RAISER].ordinary + 1); assert.deepEqual((await receiptsFor(raiseOk)).map(row => row.written), [1])
      // Another approver holds the claim now (a takeover committed first): the old claimer's next line writes nothing; and so does a request from the wrong person under the right key.
      const afterFirst = await snapshot([LOWER, RAISER])
      const wrongPerson = key('wrong')
      const intruder = await as('admin', 'POST', '/api/inventory/adjust', lowering(wrongPerson))
      assert.equal(intruder.status, 409); assert.equal(intruder.json.code, 'inventory_check_claim_lost'); assert.deepEqual(await snapshot([LOWER, RAISER]), afterFirst); assert.equal((await receiptsFor(wrongPerson)).length, 0)
      await db.exec(`UPDATE inventory_check_approvals SET applying_request_id='${key('taken')}',applying_by=1,takeovers=1,plan_json='{}' WHERE session_id='${id}'`)
      const lateLower = key('late'), lateRaise = key('late')
      for (const [request, body, pid] of [[lateLower, lowering(lateLower), LOWER], [lateRaise, await raising(lateRaise, { expectedBranchQuantity: start[RAISER].ordinary + 1, quantity: start[RAISER].ordinary + 2 }), RAISER]]) {
        const late = await as('lead', 'POST', '/api/inventory/adjust', body)
        assert.equal(late.status, 409, late.text.slice(0, 300)); assert.equal(late.json.code, 'inventory_check_claim_lost'); assert.equal((await stock(pid)).ordinary, afterFirst[pid].ordinary); assert.equal((await receiptsFor(request)).length, 0)
      }
      // A decided approval holds no claim at all.
      await db.exec(`UPDATE inventory_check_approvals SET status='approved',decided_by=903,decided_by_name='budget_lead',decided_at='2026-11-03T00:00:00.000Z',decision_request_id='world-decided' WHERE session_id='${id}'`)
      const decidedKey = key('decided')
      const afterDecided = await as('lead', 'POST', '/api/inventory/adjust', lowering(decidedKey, { approvalClaim: { sessionId: id, key: key('taken') } }))
      assert.equal(afterDecided.status, 409); assert.equal(afterDecided.json.code, 'inventory_check_claim_lost'); assert.deepEqual(await snapshot([LOWER, RAISER]), afterFirst)
      // A request that names no approval is untouched by any of this.
      const plain = await as('lead', 'POST', '/api/inventory/adjust', { productId: LOWER, branchId: 1, quantity: 1, type: 'remove', reason: 'ordinary removal', client_request_id: key('plain') })
      assert.equal(plain.status, 200, plain.text.slice(0, 300))
    })

    await check('Fix stock is held on both real stock write routes while its count waits for approval, opens no receipt, and goes through once the count is rejected', async () => {
      const pid = rows[6].pid, start = await stock(pid), total = start.ordinary + start.damaged
      const made = await as('counter', 'POST', '/api/inventory-checks/submissions', { branchId: 1, requestId: key('submit'), lines: [{ productId: pid, countedQuantity: total - 1, seenQuantity: total, checked: false }] })
      assert.equal(made.status, 201, made.text.slice(0, 300))
      const id = made.json.item.id, set = { productId: pid, type: 'set', quantity: start.ordinary - 1, reason: 'Inventory check: fix', branchId: 1 }
      const single = await as('admin', 'POST', '/api/inventory/adjust', { ...set, client_request_id: `icfix_${id}_${pid}_a1b2c3d4e5f60001` })
      assert.equal(single.status, 409, single.text.slice(0, 300)); assert.equal(single.json.code, 'inventory_check_count_pending')
      const commit = await as('admin', 'POST', '/api/inventory/fast-stock-in/commit', { lines: [{ key: 'fix', wire: 'adjust', body: { ...set, client_request_id: `icfix_${id}_${pid}_a1b2c3d4e5f60002` } }] })
      assert.equal(commit.status, 200, commit.text.slice(0, 300)); assert.deepEqual([commit.json.results[0].ok, commit.json.results[0].code], [false, 'inventory_check_count_pending'])
      assert.deepEqual(await stock(pid), start, 'nothing was written')
      assert.equal((await world.all("SELECT COUNT(*) AS n FROM stock_mutation_receipts WHERE request_id LIKE 'icfix_%'"))[0].n, 0, 'a held request opens no receipt')
      const rejected = await as('lead', 'POST', `/api/inventory-checks/sessions/${id}/approval`, { decision: 'reject', requestId: key('reject') })
      assert.equal(rejected.status, 200, rejected.text.slice(0, 300))
      const released = await as('admin', 'POST', '/api/inventory/adjust', { ...set, client_request_id: `icfix_${id}_${pid}_a1b2c3d4e5f60003` })
      assert.equal(released.status, 200, released.text.slice(0, 300)); assert.equal((await stock(pid)).ordinary, start.ordinary - 1, 'the Set Fix stock opened goes through once the count is decided')
    })

    await check('with ic_fix_stock off the same route does not exist and a new count creates no approval', async () => {
      await flags({ ic_simple: 'on' })
      const gone = await as('lead', 'POST', `/api/inventory-checks/sessions/${world.sessionId}/approval`, { decision: 'approve', requestId: key('off') })
      assert.equal(gone.status, 404); assert.equal(gone.json.code, 'inventory_check_not_available')
      const made = await as('counter', 'POST', '/api/inventory-checks/submissions', { branchId: 1, requestId: key('submit'), lines: [{ productId: SAME, countedQuantity: total(SAME) + 1, seenQuantity: total(SAME), checked: false }] })
      assert.equal(made.status, 201); assert.equal('approval' in made.json, false)
      assert.equal((await world.all('SELECT COUNT(*) AS n FROM inventory_check_approvals WHERE session_id=?', made.json.item.id))[0].n, 0)
    })

    console.log(`${groups} groups passed`)
  } finally { await world.dispose() }
}
main().catch(error => { console.error(error); process.exit(1) })
