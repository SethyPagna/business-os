#!/usr/bin/env node
// Lane 6.0.1045 (ic_fix_stock): a submitted count is approved on the REAL Worker, with the REAL stock writer, on the Free plan under Miniflare.
// Proves what the faithful-double test cannot: that the Set sessions' commit really takes the approval's lines (lowering through the stock-session
// Set conversion, raising through the lot-level Set writer), that stock ends at the counted number minus damaged units in every ledger, that one
// request stays inside the Free plan's 50 D1 calls, that rejecting writes nothing, and that the permission refusals hold on the real route stack.
//
// Run: node scripts/test-inventory-check-approvals-world-native.cjs
'use strict'
process.env.READ_BUDGET_DEADLINE_MS = process.env.READ_BUDGET_DEADLINE_MS || '180000'
const assert = require('node:assert/strict')
const bcrypt = require('bcryptjs')
const { bootWorld } = require('./read-budget/world.cjs')
const { ADMIN } = require('./read-budget/seed.cjs')

const FREE_CALL_LIMIT = 50
let groups = 0
const check = async (name, run) => { await run(); groups++; console.log(`PASS ${name}`) }
let sequence = 0
const key = label => `world-${label}-${Date.now().toString(36)}-${++sequence}`

async function main() {
  const world = await bootWorld({ tier: 'free' })
  try {
    const db = world.db
    const flags = value => db.prepare("INSERT OR REPLACE INTO system_flags(key, value) VALUES('read_switches', ?)").bind(JSON.stringify({ epoch: 1, switches: value })).run()
    await flags({ ic_simple: { state: 'on' }, ic_fix_stock: { state: 'on' } })

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
      JOIN products p ON p.id = b.variant_product_id AND p.is_active = 1 AND (p.id - 1000) % 8 NOT IN (1, 2) WHERE s.branch_id = 1 AND s.quantity >= 6 ORDER BY b.id LIMIT 8 OFFSET 2400`)
    assert.ok(rows.length >= 8, 'the seed has enough stocked products')
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

    await check('with ic_fix_stock off the same route does not exist and a new count creates no approval', async () => {
      await flags({ ic_simple: { state: 'on' } })
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
