'use strict'
// Count tasks: integration paths across the feature's boundaries (ctprop, 19 Nov). Real routes over the real migrations (ctprop-world.cjs).
//   siblings  the approval panel (reject, modify, approve, a waiting count), the lot sheet Set, the batches Set, the Products page plain Set, a received-date submission: who ticks and who closes
//   perms     the Tasks action and the issue extra taken away: every route refuses at once, warm cache or not; the writers re-read the actor
//   gates     the maintenance and restore gate covers every task write
//   t2        the fields and 409 shapes the T2 spec relies on
const assert = require('node:assert/strict')
const { buildWorld } = require('./harness/count-tasks-world.cjs')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
async function check(name, fn) { try { const note = await fn(); results.push(['PASS', name, note]); console.log(`PASS ${name}${note ? ' :: ' + note : ''}`) } catch (e) { results.push(['FAIL', name]); console.log(`FAIL ${name}\n   ${String(e.message || e).replace(/\s+/g, ' ').slice(0, 900)}\n   ${String(e.stack || '').split('\n').find((l) => l.includes('integration-native')) || ''}`) } }

function kit() {
  const w = buildWorld()
  const ic = (who, m, u, b) => w.call(who, m, `/api/inventory-checks${u}`, b)
  const issue = async (products, who = 'admin', branchId = 1) => { const r = await ic(who, 'POST', '/tasks', { branchId, requestId: w.rid('iss'), productIds: products }); assert.equal(r.status, 201, JSON.stringify(r.json)); await sleep(3); return r.json.item.id }
  const board = async (who = 'admin', b = 1) => (await ic(who, 'GET', `/tasks?branchId=${b}`)).json
  const task = async (id, who = 'admin', b = 1) => (await board(who, b)).items.find((t) => t.id === id)
  const submit = async (lines, extra = {}, who = 'emp1') => { await sleep(3); const r = await ic(who, 'POST', '/submissions', { branchId: 1, requestId: w.rid('sub'), lines, ...extra }); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json }
  const lotSet = async (p, batch, quantity, expected, route = 'adjust') => { await sleep(3); return route === 'adjust'
    ? w.call('admin', 'POST', '/api/inventory/adjust', { type: 'set', setScope: 'lot', productId: p, branchId: 1, batchId: batch, quantity, expectedLotQuantity: expected, reason: 'Physical count', client_request_id: 'inventory_set_' + w.rid('a') })
    : w.call('admin', 'PATCH', `/api/batches/${batch}/branches/1`, { quantity, expectedLotQuantity: expected, reason: 'Physical count', client_request_id: 'batches_set_' + w.rid('b') }) }
  const setPerm = (key, patch) => { // the user object (what requireAuth reads per request) and the database rows (what the writers re-read)
    const u = w.app.users[key], perms = { ...JSON.parse(u.permissions), ...patch }
    u.permissions = JSON.stringify(perms); u.role_permissions = JSON.stringify(perms)
    w.raw.prepare('UPDATE roles SET permissions=? WHERE id=?').run([JSON.stringify(perms), u.id]); w.raw.prepare('UPDATE users SET permissions=? WHERE id=?').run([JSON.stringify(perms), u.id])
  }
  return { w, ic, issue, board, task, submit, lotSet, setPerm }
}

async function main() {
  await check('siblings: a Differs count ticks at once, a waiting approval included; reject, modify and approve tick and close nothing more', async () => {
    const k = kit()
    const t = await k.issue([101, 103, 130])
    const s = await k.submit([{ productId: 101, countedQuantity: 8, seenQuantity: 10 }, { productId: 103, countedQuantity: 9, seenQuantity: 10 }])
    assert.equal(s.approval.status, 'pending'); assert.equal((await k.task(t)).done, 2, 'a count waiting for approval is final (its session is closed): it ticks')
    const late = await k.issue([101, 103])
    const rj = await k.ic('admin', 'POST', `/sessions/${s.item.id}/approval/lines`, { productId: 101, action: 'reject', requestId: k.w.rid('rj') }); assert.equal(rj.status, 200, JSON.stringify(rj.json))
    const md = await k.ic('admin', 'POST', `/sessions/${s.item.id}/approval/lines`, { productId: 103, action: 'modify', counted: 7, requestId: k.w.rid('md') }); assert.equal(md.status, 200, JSON.stringify(md.json))
    const ap = await k.ic('admin', 'POST', `/sessions/${s.item.id}/approval`, { decision: 'approve', requestId: k.w.rid('ap') })
    const v = await k.task(t), vl = await k.task(late)
    assert.equal(v.done, 2); assert.equal(v.status, 'open'); assert.equal(vl.done, 0, 'decisions on a count made before the issue never tick a later task')
    return `approve of a product with no received date answered ${ap.status} ${ap.json.code || ''}; the rejected and the modified lines stayed ticked on the earlier task (owner rule: any count after the issue ticks)`
  })
  await check('siblings: approving a received-date count applies stock and ticks nothing new; the lot count itself ticked', async () => {
    const k = kit()
    const t = await k.issue([131])
    const s = await k.submit([{ productId: 131, lots: [{ batchId: 1311, scope: 'lot', counted: 2, seen: 3 }, { batchId: 1312, scope: 'lot', counted: 7, seen: 7 }] }])
    assert.deepEqual([(await k.task(t)).done, (await k.task(t)).status], [1, 'closed'], 'the received-date submission closes the one-product task')
    const late = await k.issue([131])
    const ap = await k.ic('admin', 'POST', `/sessions/${s.item.id}/approval`, { decision: 'approve', requestId: k.w.rid('ap') }); assert.equal(ap.status, 200, JSON.stringify(ap.json))
    assert.equal(k.w.row('SELECT quantity FROM branch_batch_stock WHERE batch_id=1311 AND branch_id=1').quantity, 2, 'approve applied the date')
    assert.equal((await k.task(late)).done, 0, 'the approval is not a count: the later task is not ticked'); assert.equal((await k.task(late)).status, 'open')
  })
  await check('siblings: the lot sheet Set and the batches Set close the Differs they fix and the tasks it completes; the Products page plain Set (F1, 19 Nov) does the same', async () => {
    const k = kit()
    const s = await k.submit([{ productId: 132, lots: [{ batchId: 1321, scope: 'lot', counted: 2, seen: 3 }, { batchId: 1322, scope: 'lot', counted: 6, seen: 7 }] }, { productId: 105, countedQuantity: 8, seenQuantity: 10 }])
    for (const p of [132, 105]) assert.equal((await k.ic('admin', 'POST', `/sessions/${s.item.id}/approval/lines`, { productId: p, action: 'reject', requestId: k.w.rid('rj') })).status, 200)
    const t = await k.issue([132, 105]), t132 = await k.issue([132])
    const a = await k.lotSet(132, 1321, 2, 3, 'adjust'); assert.equal(a.status, 200); assert.equal(a.json.issue_closed, false, 'one date still differs')
    const b = await k.lotSet(132, 1322, 6, 7, 'batches'); assert.equal(b.status, 200); assert.equal(b.json.issue_closed, true); assert.deepEqual(b.json.closed_tasks, [t132])
    assert.equal((await k.task(t)).done, 1)
    const plain = await k.w.call('admin', 'POST', '/api/inventory/adjust', { type: 'set', productId: 105, branchId: 1, quantity: 8, reason: 'Physical count', client_request_id: 'inventory_set_' + k.w.rid('p') })
    assert.equal(plain.status, 200, JSON.stringify(plain.json))
    const latest = k.w.row("SELECT i.state FROM inventory_check_items i JOIN inventory_check_sessions s ON s.id=i.session_id WHERE i.product_id=105 AND i.branch_id=1 AND s.status='closed' AND i.state IN ('done','issue') ORDER BY i.updated_at DESC LIMIT 1")
    const v = await k.task(t)
    assert.equal(plain.json.issue_closed, true, "a plain Set that makes the latest Differs match closes it (F1)")
    assert.deepEqual(plain.json.closed_tasks, [t], "and closes the task it completes")
    assert.equal(latest.state, "done"); assert.deepEqual([v.status, v.done, v.total], ["closed", 2, 2])
    return `plain Set: issue_closed=${JSON.stringify(plain.json.issue_closed)} closed_tasks=${JSON.stringify(plain.json.closed_tasks)}; latest count of 105 after the stock matches it: ${latest.state}; task [132,105] done ${v.done}/${v.total} status ${v.status}`
  })
  await check('removed: a task whose last uncounted product is retired stays open at done = total until a count writer touches it', async () => {
    const k = kit()
    const t = await k.issue([100, 101])
    await k.submit([{ productId: 100, countedQuantity: 10, seenQuantity: 10 }])
    k.w.raw.exec('PRAGMA foreign_keys=OFF')
    k.w.stockWrite(() => { k.w.raw.prepare('UPDATE branch_stock SET quantity=0 WHERE product_id=101').run(); k.w.raw.prepare('UPDATE products SET stock_quantity=0 WHERE id=101').run(); k.w.raw.prepare('UPDATE products SET is_active=0 WHERE id=101').run() })
    k.w.raw.exec('PRAGMA foreign_keys=ON'); await k.w.bumpProducts()
    const v = await k.task(t)
    assert.deepEqual([v.status, v.total, v.done, v.removed], ['open', 1, 1, 1], 'All counted, still open')
    const later = await k.submit([{ productId: 100, countedQuantity: 10, seenQuantity: 10 }])
    assert.deepEqual(later.closedTasks, [t], 'the next count of one of its products closes it')
    return 'contract section 1 says done = total shows "only for the instant between the last final count and the close"; after a removal it lasts until the next count writer, a submission naming it, or a hand close'
  })
  await check('hand close: a task of 4 closed by hand at 2 counted keeps 2 of 4 on the board and in its close event after the other 2 are counted', async () => {
    const k = kit()
    const t = await k.issue([100, 101, 102, 103])
    await k.submit([{ productId: 100, countedQuantity: 10, seenQuantity: 10 }, { productId: 101, countedQuantity: 10, seenQuantity: 10 }])
    const open = await k.task(t); assert.deepEqual([open.status, open.total, open.done], ['open', 4, 2])
    const closed = await k.ic('admin', 'PATCH', `/sessions/${t}`, { expectedRevision: 0, requestId: k.w.rid('c'), action: 'close' }); assert.equal(closed.status, 200, JSON.stringify(closed.json))
    const handClosed = await k.task(t); assert.deepEqual([handClosed.status, handClosed.total, handClosed.done, handClosed.removed], ['closed', 4, 2, 0], 'the board row shows what the admin saw')
    const eventFigures = () => {
      const rows = k.w.rows("SELECT after_json FROM inventory_check_events WHERE session_id=? AND action='close'", t)
      assert.equal(rows.length, 1, 'one close event')
      const after = JSON.parse(rows[0].after_json); return { total: after.total, done: after.done, removed: after.removed }
    }
    assert.deepEqual(eventFigures(), { total: 4, done: 2, removed: 0 })
    await k.submit([{ productId: 102, countedQuantity: 10, seenQuantity: 10 }, { productId: 103, countedQuantity: 10, seenQuantity: 10 }])
    const after = await k.task(t); assert.deepEqual([after.status, after.total, after.done, after.removed], ['closed', 4, 2, 0], 'counting the rest later does not move a closed task')
    assert.deepEqual(eventFigures(), { total: 4, done: 2, removed: 0 })
  })
  await check('perms: the Tasks action taken away refuses every task route at once (warm board cache); the issue extra taken away refuses issue, close, hand-back', async () => {
    const k = kit()
    const t = await k.issue([100, 101]); const t2 = await k.issue([102])
    assert.equal((await k.ic('emp2', 'POST', `/tasks/${t2}/pickup`, { requestId: k.w.rid('pk') })).status, 201)
    const warm = await k.ic('emp1', 'GET', '/tasks?branchId=1'); assert.equal(warm.status, 200)
    const pk = await k.ic('emp1', 'POST', `/tasks/${t}/pickup`, { requestId: k.w.rid('pk') }); assert.equal(pk.status, 201)
    k.setPerm('emp1', { 'inventory_checks:tasks': false })
    const seen = {}
    seen.board = (await k.ic('emp1', 'GET', '/tasks?branchId=1')).status
    seen.list = (await k.ic('emp1', 'GET', `/list?branchId=1&taskId=${t}`)).status
    seen.pickup = (await k.ic('emp1', 'POST', `/tasks/${t2}/pickup`, { requestId: k.w.rid('pk') })).json.code
    seen.submitTask = (await k.ic('emp1', 'POST', '/submissions', { branchId: 1, requestId: k.w.rid('sub'), taskId: t, lines: [{ productId: 100, countedQuantity: 10, seenQuantity: 10 }] })).json.code
    const plainSub = await k.ic('emp1', 'POST', '/submissions', { branchId: 1, requestId: k.w.rid('sub'), lines: [{ productId: 100, countedQuantity: 10, seenQuantity: 10 }] }); seen.submitNoTask = plainSub.status
    seen.releaseOwn = (await k.ic('emp1', 'POST', `/tasks/${t}/release`, { requestId: k.w.rid('rel') })).status
    assert.equal(seen.board, 403); assert.equal(seen.list, 403); assert.equal(seen.pickup, 'inventory_check_tasks_required'); assert.equal(seen.submitTask, 'inventory_check_tasks_required')
    // the issue extra: the manager may issue; then not
    const mt = (await k.ic('manager', 'POST', '/tasks', { branchId: 1, requestId: k.w.rid('iss'), productIds: [103] })).json.item.id
    assert.equal((await k.board('manager')).capabilities.issue, true)
    k.setPerm('manager', { inventory_check_issue: false })
    const b = await k.board('manager')
    seen.capIssue = b.capabilities.issue; seen.canClose = b.items.find((x) => x.id === mt).can_close; seen.canReleaseOther = b.items.find((x) => x.id === t2).can_release
    seen.issue = (await k.ic('manager', 'POST', '/tasks', { branchId: 1, requestId: k.w.rid('iss'), productIds: [104] })).json.code
    seen.close = (await k.ic('manager', 'PATCH', `/sessions/${mt}`, { expectedRevision: 0, requestId: k.w.rid('c'), action: 'close' })).json.code
    seen.releaseOther = (await k.ic('manager', 'POST', `/tasks/${t2}/release`, { requestId: k.w.rid('rel') })).json.code
    assert.equal(seen.capIssue, false); assert.equal(seen.canClose, false); assert.equal(seen.canReleaseOther, false)
    assert.equal(seen.issue, 'inventory_check_issue_required'); assert.equal(seen.close, 'inventory_check_owner_required'); assert.equal(seen.releaseOther, 'inventory_check_release_forbidden')
    // the writer re-reads the actor: the database alone says no (the request's user object still says yes)
    const u = k.w.app.users.admin; void u
    k.w.raw.prepare('UPDATE roles SET permissions=? WHERE id=90').run([JSON.stringify({ inventory_checks: true, inventory_checks_check: true, inventory_check_issue: true })])
    const mu = k.w.app.users.manager; mu.permissions = JSON.stringify({ ...JSON.parse(mu.permissions), inventory_check_issue: true }); mu.role_permissions = mu.permissions
    k.w.raw.prepare('UPDATE users SET permissions=? WHERE id=90').run([JSON.stringify({ inventory_checks: true, 'inventory_checks:check': false, inventory_checks_check: false })])
    k.w.raw.prepare('UPDATE roles SET permissions=? WHERE id=90').run([JSON.stringify({ inventory_checks: true, 'inventory_checks:check': false, inventory_checks_check: false })])
    const stale = await k.ic('manager', 'POST', '/tasks', { branchId: 1, requestId: k.w.rid('iss'), productIds: [105] })
    seen.writerReread = `${stale.status} ${stale.json.code}`
    assert.ok(stale.status === 403, 'the writer re-read the actor and refused')
    return JSON.stringify(seen)
  })
  await check('gates: the maintenance and restore gate refuses every task write and lets the reads through', async () => {
    const k = kit()
    const { isMaintenanceGatedRequest } = k.w.app.load('lib/maintenance.ts')
    const writes = [['POST', '/api/inventory-checks/tasks'], ['POST', '/api/inventory-checks/tasks/x/pickup'], ['POST', '/api/inventory-checks/tasks/x/release'], ['POST', '/api/inventory-checks/submissions'], ['PATCH', '/api/inventory-checks/sessions/x'], ['PATCH', '/api/inventory-checks/sessions/x/items/1'], ['POST', '/api/inventory-checks/sessions/x/approval'], ['POST', '/api/inventory-checks/sessions/x/approval/lines'], ['POST', '/api/inventory/adjust'], ['PATCH', '/api/batches/1/branches/1'], ['POST', '/api/action-history/1/undo']]
    for (const mode of ['restore', 'branch-cutover', 'other']) for (const [m, p] of writes) assert.equal(isMaintenanceGatedRequest(m, p, mode), true, `${mode} ${m} ${p}`)
    for (const p of ['/api/inventory-checks/tasks?branchId=1', '/api/inventory-checks/list']) assert.equal(isMaintenanceGatedRequest('GET', p, 'restore'), false)
  })
  await check('t2: the board, /list?taskId=, taskId on submissions and the 409 shapes', async () => {
    const k = kit()
    const t = await k.issue([100, 101], 'admin')
    let b = await k.board('emp1'); const row = b.items.find((x) => x.id === t)
    for (const key of ['id', 'branch_id', 'title', 'status', 'revision', 'issued_at', 'closed_at', 'total', 'done', 'removed', 'selection', 'picked_up_by', 'picked_up_at', 'mine', 'can_pickup', 'can_release', 'can_close']) assert.ok(key in row, `board row has ${key}`)
    assert.equal('issued_by' in row, false, 'an employee who did not issue it does not see issued_by'); assert.deepEqual(Object.keys(b.capabilities).sort(), ['issue', 'maxOpenTasks', 'maxProducts', 'work'])
    assert.equal(typeof b.version, 'string'); assert.equal(row.revision, 0)
    const p1 = await k.ic('emp1', 'POST', `/tasks/${t}/pickup`, { requestId: k.w.rid('pk') }); assert.equal(p1.status, 201)
    const p2 = await k.ic('emp2', 'POST', `/tasks/${t}/pickup`, { requestId: k.w.rid('pk') }); assert.equal(p2.status, 409); assert.deepEqual([p2.json.code, p2.json.pickedUpBy, p2.json.mine], ['inventory_check_task_picked_up', 'u91', false])
    const p3 = await k.ic('emp1', 'POST', `/tasks/${t}/pickup`, { requestId: k.w.rid('pk') }); assert.deepEqual([p3.status, p3.json.code, p3.json.mine], [409, 'inventory_check_task_picked_up', true])
    b = await k.board('emp1'); const mine = b.items.find((x) => x.id === t); assert.equal(mine.mine, true); assert.equal(mine.pickup_session_id, p1.json.item.id); assert.equal(mine.can_release, true); assert.equal(mine.can_pickup, false)
    const l = await k.ic('emp1', 'GET', `/list?branchId=1&taskId=${t}`); assert.equal(l.status, 200); assert.deepEqual(l.json.task, { id: t, status: 'open', total: 2 })
    const lb = await k.ic('emp1', 'GET', `/list?branchId=2&taskId=${t}`); assert.deepEqual([lb.status, lb.json.code, lb.json.parameter], [400, 'inventory_check_invalid_query', 'branchId'])
    const li = await k.ic('emp1', 'GET', `/list?branchId=1&taskId=${t}&ids=100`); assert.deepEqual([li.status, li.json.parameter], [400, 'ids'])
    const ln = await k.ic('emp1', 'GET', '/list?branchId=1&taskId=nope'); assert.deepEqual([ln.status, ln.json.code], [404, 'inventory_check_task_not_found'])
    const s1 = await k.submit([{ productId: 100, countedQuantity: 10, seenQuantity: 10 }], { taskId: t }); assert.deepEqual(s1.task, { id: t, closed: false }); assert.equal('closedTasks' in s1, false)
    const s2 = await k.submit([{ productId: 101, countedQuantity: 10, seenQuantity: 10 }], { taskId: t }); assert.deepEqual(s2.task, { id: t, closed: true }); assert.deepEqual(s2.closedTasks, [t])
    const closed = (await k.board('admin')).items.find((x) => x.id === t); assert.deepEqual([closed.status, closed.revision, closed.can_close, closed.can_pickup, closed.can_release, closed.picked_up_by], ['closed', 1, false, false, false, null])
    const pc = await k.ic('emp2', 'POST', `/tasks/${t}/pickup`, { requestId: k.w.rid('pk') }); assert.deepEqual([pc.status, pc.json.code], [409, 'inventory_check_task_closed'])
    const rl = await k.ic('emp1', 'POST', `/tasks/${t}/release`, { requestId: k.w.rid('rel') }); assert.deepEqual([rl.status, rl.json.code], [409, 'inventory_check_task_not_picked_up'])
    const t2 = await k.issue([102]); const bd = await k.ic('admin', 'GET', '/tasks?branchId=1'); assert.equal(bd.status, 200, JSON.stringify(bd.json)); const rev = bd.json.items.find((x) => x.id === t2).revision
    const stale = await k.ic('admin', 'PATCH', `/sessions/${t2}`, { expectedRevision: rev + 1, requestId: k.w.rid('c'), action: 'close' }); assert.deepEqual([stale.status, stale.json.code], [409, 'inventory_check_conflict'])
    const ok = await k.ic('admin', 'PATCH', `/sessions/${t2}`, { expectedRevision: rev, requestId: k.w.rid('c'), action: 'close' }); assert.equal(ok.status, 200)
    const reused = await k.ic('emp1', 'POST', '/submissions', { branchId: 1, requestId: s1.receipt.requestId, lines: [{ productId: 100, countedQuantity: 10, seenQuantity: 10 }] }); assert.deepEqual([reused.status, reused.json.code], [409, 'inventory_check_request_reused'])
    const wrongTask = await k.ic('emp1', 'POST', '/submissions', { branchId: 2, requestId: k.w.rid('sub'), taskId: t2, lines: [{ productId: 100, countedQuantity: 10, seenQuantity: 10 }] }); assert.deepEqual([wrongTask.status, wrongTask.json.code], [404, 'inventory_check_task_not_found'])
    const closedOk = await k.ic('emp1', 'POST', '/submissions', { branchId: 1, requestId: k.w.rid('sub'), taskId: t2, lines: [{ productId: 102, countedQuantity: 10, seenQuantity: 10 }] }); assert.equal(closedOk.status, 201); assert.deepEqual(closedOk.json.task, { id: t2, closed: false })
    for (let i = 0; i < 30; i++) await k.ic('admin', 'POST', '/tasks', { branchId: 1, requestId: k.w.rid('iss'), productIds: [103] })
    const capped = await k.ic('admin', 'POST', '/tasks', { branchId: 1, requestId: k.w.rid('iss'), productIds: [104] }); assert.deepEqual([capped.status, capped.json.code, capped.json.open, capped.json.limit], [409, 'inventory_check_task_limit', 30, 30])
    const sess = await k.ic('emp1', 'GET', '/sessions'); assert.equal((sess.json.items || []).some((x) => x.scope?.membership === 'task'), false, 'no task row under Count sessions')
    const many = await k.ic('admin', 'POST', '/tasks', { branchId: 2, requestId: k.w.rid('iss'), productIds: Array.from({ length: 301 }, (_, i) => 10000 + i) }); assert.deepEqual([many.status, many.json.code, many.json.total, many.json.limit], [400, 'inventory_check_task_too_many', 301, 300])
    const tr = await k.ic('emp1', 'GET', '/tasks'); assert.deepEqual([tr.status, tr.json.code, tr.json.parameter], [400, 'inventory_check_invalid_query', 'branchId'])
    k.w.app.setSwitch('ic_wired', undefined)
    const off = await k.ic('emp1', 'GET', '/tasks?branchId=1'); assert.equal(off.status, 404, 'ic_wired off: no Tasks')
    k.w.app.setSwitch('ic_wired', 'on')
  })
  const failed = results.filter((r) => r[0] === 'FAIL').length
  console.log(`\n${results.length - failed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(2) })
