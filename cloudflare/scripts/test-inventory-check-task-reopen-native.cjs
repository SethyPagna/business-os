'use strict'
// Count tasks, the REOPEN rule (owner, 19 Nov 2026: a task's state always follows the counts in effect), over the real routes and migrations in an in-memory SQLite (harness/count-tasks-world.cjs).
// A closed task that the auto-close closed reopens, in the batch of the write that took a count back, when a product it rested on stopped being done for it: the resume of a closed count session, and the Undo
// of a Set that closed a difference (which takes the Set's own count back; the Redo restores it at its original time and closes the tasks again). Edges E1-E19 of the design (DESIGN-task-reopen) run through
// the real writers (PATCH /sessions/:id, the lot Set, /api/action-history undo and redo); then every plant M1-M16 is applied to the source and must turn a scenario red.
//
// Run: node scripts/test-inventory-check-task-reopen-native.cjs
const assert = require('node:assert/strict')
const { buildWorld } = require('./harness/count-tasks-world.cjs')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const T = 'lib/inventoryCheckTasks.ts'
const failures = []
let passed = 0
async function check(name, run) { try { await run(); passed++; console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.log(`FAIL ${name}\n     ${String(error && error.stack || error).split('\n').slice(0, 4).join('\n     ')}`) } }

function kit(sourceEdits = {}) {
  const w = buildWorld(sourceEdits)
  const ic = (who, method, url, body) => w.call(who, method, `/api/inventory-checks${url}`, body)
  const kitObj = {
    w, ic,
    issue: async (products, branchId = 1, who = 'admin') => { await sleep(4); const r = await ic(who, 'POST', '/tasks', { branchId, requestId: w.rid('iss'), productIds: products }); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.item.id },
    /** A count session of `products` at branch 1 counted Done at 10 and closed: returns { id, closed (the close answer) }. Pass `leave` to leave some products unstarted. */
    count: async (products, { who = 'emp1', leave = [], close = true } = {}) => {
      await sleep(4)
      const made = await ic(who, 'POST', '/sessions', { branchId: 1, requestId: w.rid('s'), productIds: products, scope: { membership: 'visible_page' } }); assert.equal(made.status, 201, JSON.stringify(made.json))
      const id = made.json.item.id
      for (const p of products.filter((x) => !leave.includes(x))) { const r = await ic(who, 'PATCH', `/sessions/${id}/items/${p}`, { expectedRevision: 0, expectedSessionRevision: 0, requestId: w.rid('o'), state: 'done', counted_quantity: 10 }); assert.equal(r.status, 200, JSON.stringify(r.json)) }
      if (!close) return { id }
      const closed = await ic(who, 'PATCH', `/sessions/${id}`, { expectedRevision: 0, requestId: w.rid('c'), action: 'close' }); assert.equal(closed.status, 200, JSON.stringify(closed.json))
      return { id, closed: closed.json }
    },
    resume: async (id, expectedRevision = 1, who = 'emp1', requestId = w.rid('r')) => { await sleep(4); return ic(who, 'PATCH', `/sessions/${id}`, { expectedRevision, requestId, action: 'resume' }) },
    close: async (id, expectedRevision, who = 'emp1') => { await sleep(4); return ic(who, 'PATCH', `/sessions/${id}`, { expectedRevision, requestId: w.rid('c'), action: 'close' }) },
    board: async (who = 'admin', branch = 1) => (await ic(who, 'GET', `/tasks?branchId=${branch}`)).json,
    task: async (id, who = 'admin') => (await kitObj.board(who)).items.find((item) => item.id === id),
    status: (id) => w.row('SELECT status,revision,closed_at FROM inventory_check_sessions WHERE id=?', id),
    events: (id) => w.rows("SELECT action,request_id,actor_id,before_json,after_json FROM inventory_check_events WHERE session_id=? ORDER BY id", id),
    reopens: (id) => w.rows("SELECT * FROM inventory_check_events WHERE session_id=? AND action='resume' AND request_id LIKE '%-task-reopened-%'", id),
    deactivate: async (product) => { w.raw.exec('PRAGMA foreign_keys=OFF'); w.stockWrite(() => { w.raw.prepare('UPDATE branch_stock SET quantity=0 WHERE product_id=?').run([product]); w.raw.prepare('UPDATE products SET stock_quantity=0 WHERE id=?').run([product]); w.raw.prepare('UPDATE products SET is_active=0 WHERE id=?').run([product]) }); w.raw.exec('PRAGMA foreign_keys=ON'); await w.bumpProducts() },
    activate: async (product) => { w.stockWrite(() => { w.raw.prepare('UPDATE products SET is_active=1 WHERE id=?').run([product]) }); await w.bumpProducts() },
    // a Differs count of a received-date product, its approval rejected, so the lot Set below can close it
    differs: async (product = 130) => {
      await sleep(4)
      const s = await ic('emp1', 'POST', '/submissions', { branchId: 1, requestId: w.rid('sub'), lines: [{ productId: product, lots: [{ batchId: product * 10 + 1, scope: 'lot', counted: 2, seen: 3 }, { batchId: product * 10 + 2, scope: 'lot', counted: 7, seen: 7 }] }] })
      assert.equal(s.status, 201, JSON.stringify(s.json))
      const rj = await ic('admin', 'POST', `/sessions/${s.json.item.id}/approval/lines`, { productId: product, action: 'reject', requestId: w.rid('rj') }); assert.equal(rj.status, 200, JSON.stringify(rj.json))
      return s.json.item.id
    },
    lotSet: async (product = 130) => { await sleep(4); return w.call('admin', 'POST', '/api/inventory/adjust', { type: 'set', setScope: 'lot', productId: product, branchId: 1, batchId: product * 10 + 1, quantity: 2, expectedLotQuantity: 3, reason: 'Physical count', client_request_id: 'inventory_set_' + w.rid('a') }) },
    undo: async (hid) => { await sleep(4); return w.call('admin', 'POST', `/api/action-history/${hid}/undo`, {}) },
    redo: async (hid) => { await sleep(4); return w.call('admin', 'POST', `/api/action-history/${hid}/redo`, {}) },
  }
  return kitObj
}
const sameSet = (a, b) => assert.deepEqual([...a].sort(), [...b].sort())

// ---- the edges -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** E1 + E14 + M10 + M16: two tasks rest on the same count; the resume reopens both in its own batch, with the exact events, the answer and the board field. */
async function twoTasksOneCount(k) {
  const t1 = await k.issue([100, 101, 102]), t2 = await k.issue([101, 102]), tOther = await k.issue([105])
  const x = await k.count([100, 101, 102])
  sameSet(x.closed.closedTasks, [t1, t2])
  assert.equal(k.status(t1).status, 'closed')
  const before = { t1: k.status(t1).revision, t2: k.status(t2).revision }
  const r = await k.resume(x.id)
  assert.equal(r.status, 200, JSON.stringify(r.json)); sameSet(r.json.reopenedTasks || [], [t1, t2])
  for (const [id, rev] of [[t1, before.t1], [t2, before.t2]]) {
    const row = k.status(id); assert.deepEqual([row.status, row.closed_at, row.revision], ['open', null, rev + 1])
    const events = k.reopens(id); assert.equal(events.length, 1, 'exactly one reopen event per reopened task')
    assert.equal(events[0].request_id.endsWith(`-task-reopened-${id}`), true)
    assert.deepEqual(JSON.parse(events[0].after_json), { status: 'open', revision: rev + 1, reopened: 1, cause: 'resumed', by: x.id })
    assert.deepEqual(JSON.parse(events[0].before_json), { status: 'closed', revision: rev })
  }
  assert.equal(k.reopens(tOther).length, 0); assert.equal(k.status(tOther).status, 'open')
  // the board (E14): the reopened tasks say why and who (the admin sees staff identity); an untouched open task says nothing
  const board = await k.board(), shown = (id) => board.items.find((item) => item.id === id)
  for (const id of [t1, t2]) { assert.equal(shown(id).status, 'open'); assert.equal(shown(id).reopened.reason, 'count_reopened'); assert.equal(typeof shown(id).reopened.at, 'string'); assert.equal(shown(id).reopened.by, 'u91', 'by is the username of whoever took the count back, never a session id') }
  assert.equal('reopened' in shown(tOther), false)
  // a viewer who may not see staff identity sees the reopen without a name
  const plain = (await k.board('emp2')).items.find((item) => item.id === t1); assert.equal(plain.reopened.reason, 'count_reopened'); assert.equal('by' in plain.reopened, false)
  // it closes again (the same session closed again), and the closed row carries no reopen
  const again = await k.close(x.id, 2); assert.equal(again.status, 200); sameSet(again.json.closedTasks || [], [t1, t2])
  assert.equal('reopened' in (await k.task(t1)), false)
  // a replay of the resume answers without naming anything and writes nothing
  const replay = await k.resume(x.id, 1, 'emp1', r.json.receipt.requestId); assert.equal(replay.status, 200); assert.equal('reopenedTasks' in replay.json, false)
  assert.equal(k.reopens(t1).length, 1)
}

/** E2a + M1: another count in effect, made LATER than the taken-back one: the task stays closed (the product is skipped whole). */
async function laterCountStays(k) {
  const t = await k.issue([100]); const x = await k.count([100]); assert.deepEqual(x.closed.closedTasks, [t])
  const y = await k.count([100]); assert.equal(y.closed.closedTasks, undefined)
  const r = await k.resume(x.id); assert.equal(r.status, 200); assert.equal('reopenedTasks' in r.json, false); assert.equal(k.status(t).status, 'closed'); assert.equal(k.reopens(t).length, 0)
}
/** E2b + M3: another count made EARLIER than the taken-back one but after the issue: the task stays closed. */
async function earlierCountStays(k) {
  const t = await k.issue([100]); const y = await k.count([100]); assert.deepEqual(y.closed.closedTasks, [t])
  const x = await k.count([100])
  const r = await k.resume(x.id); assert.equal(r.status, 200); assert.equal('reopenedTasks' in r.json, false); assert.equal(k.status(t).status, 'closed')
}
/** E3 + M2: the taken-back count was made BEFORE the task was issued: it never ticked the task, so the task stays closed. */
async function countBeforeIssue(k) {
  const x = await k.count([100]); const t = await k.issue([100, 101])
  await k.deactivate(100) // 100 can no longer be counted: the task closes on 101 alone
  const y = await k.count([101]); assert.deepEqual(y.closed.closedTasks, [t])
  await k.activate(100)
  const r = await k.resume(x.id); assert.equal(r.status, 200); assert.equal('reopenedTasks' in r.json, false, 'x was made before the task: the task did not rest on it'); assert.equal(k.status(t).status, 'closed')
}
/** E10 + M4: a task closed by hand never reopens. */
async function handClosedStays(k) {
  const t = await k.issue([100, 101]); const x = await k.count([100])
  const c = await k.ic('admin', 'PATCH', `/sessions/${t}`, { expectedRevision: 0, requestId: k.w.rid('hand'), action: 'close' }); assert.equal(c.status, 200, JSON.stringify(c.json))
  const r = await k.resume(x.id); assert.equal('reopenedTasks' in r.json, false); assert.equal(k.status(t).status, 'closed'); assert.equal(k.reopens(t).length, 0)
}
/** E11 + M5: a product that can no longer be counted does not hold the task closed-or-open: the task stays closed. */
async function notCountableStays(k) {
  const t = await k.issue([100, 101]); const y = await k.count([100]); const x = await k.count([101]); assert.deepEqual(x.closed.closedTasks, [t])
  await k.deactivate(101)
  const r = await k.resume(x.id); assert.equal('reopenedTasks' in r.json, false); assert.equal(k.status(t).status, 'closed')
}
/** E12 + E13 + M6 + M7: the sequences option A (closed_at) and option B (what the close recorded) miss. */
async function optionsAandBMiss(k) {
  const t = await k.issue([100]); const y = await k.count([100]); assert.deepEqual(y.closed.closedTasks, [t])
  const x = await k.count([100])
  const ry = await k.resume(y.id); assert.equal('reopenedTasks' in ry.json, false, 'x is in effect, so the task stays closed'); assert.equal(k.status(t).status, 'closed')
  const rx = await k.resume(x.id); assert.deepEqual(rx.json.reopenedTasks, [t], 'x was the last count in effect: the task reopens although its close names y and was made before x closed'); assert.equal(k.status(t).status, 'open')
}
/** E5 + E9: resume, change the lines, close again; a count in another session in between. */
async function resumeThenCloseAgain(k) {
  const t = await k.issue([100, 101]); const x = await k.count([100, 101]); assert.deepEqual(x.closed.closedTasks, [t])
  const r1 = await k.resume(x.id); assert.deepEqual(r1.json.reopenedTasks, [t])
  const back = await k.ic('emp1', 'PATCH', `/sessions/${x.id}/items/101`, { expectedRevision: 1, expectedSessionRevision: 2, requestId: k.w.rid('o'), state: 'unstarted' }); assert.equal(back.status, 200, JSON.stringify(back.json))
  const c1 = await k.close(x.id, 2); assert.equal(c1.json.closedTasks, undefined); assert.equal(k.status(t).status, 'open', 'one product is not counted any more')
  const r2 = await k.resume(x.id, 3); assert.equal('reopenedTasks' in r2.json, false, 'an open task reopens nothing')
  // E9: another session counts 101 while x is open (not final): the task stays open; x then counts 101 and closes: the task closes
  const y = await k.count([101]); assert.equal(y.closed.closedTasks, undefined, 'x is not final, so 100 is not done')
  const o = await k.ic('emp1', 'PATCH', `/sessions/${x.id}/items/101`, { expectedRevision: 2, expectedSessionRevision: 4, requestId: k.w.rid('o'), state: 'done', counted_quantity: 10 }); assert.equal(o.status, 200, JSON.stringify(o.json))
  const c2 = await k.close(x.id, 4); assert.deepEqual(c2.json.closedTasks, [t]); assert.equal(k.status(t).status, 'closed')
}
/** E6 + M11: another branch and another organization are never touched. */
async function otherBranchAndOrg(k) {
  const t = await k.issue([100]), t2 = await k.issue([100], 2)
  const org2 = 'org2-task'
  k.w.raw.prepare(`INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at) VALUES(?,2,1,71,'Other org','closed',1,'{"membership":"task","products":1}','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','2026-01-02T00:00:00.000Z')`).run([org2])
  k.w.raw.prepare(`INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at) VALUES(?,100,1,'{}',NULL,'{}','unstarted',NULL,NULL,0,NULL,NULL)`).run([org2])
  k.w.raw.prepare(`INSERT INTO inventory_check_events(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at) VALUES(?,NULL,71,'a','close','org2-close','h','{}','{"status":"closed","revision":1,"auto":1,"closedBy":"z"}','{}','2026-01-02T00:00:00.000Z')`).run([org2])
  const x = await k.count([100]); assert.deepEqual(x.closed.closedTasks, [t]); assert.equal(k.status(t2).status, 'open', 'another branch is not ticked')
  const r = await k.resume(x.id); assert.deepEqual(r.json.reopenedTasks, [t])
  assert.equal(k.events(org2).length, 1, 'no event on the other organization task'); assert.equal(k.status(org2).status, 'closed'); assert.equal(k.reopens(t2).length, 0)
}
/** E7 + M12 + M15: a reopen is never refused for the cap, and the board shows every open task. */
async function overTheCap(k) {
  const t = await k.issue([100]); const x = await k.count([100]); assert.deepEqual(x.closed.closedTasks, [t])
  for (let n = 0; n < 30; n++) await k.issue([101])
  const r = await k.resume(x.id); assert.deepEqual(r.json.reopenedTasks, [t], 'a take-back is never refused, not even over maxOpenTasks')
  const board = await k.board(); assert.equal(board.items.filter((item) => item.status === 'open').length, 31, 'the board lists every open task')
  const next = await k.ic('admin', 'POST', '/tasks', { branchId: 1, requestId: k.w.rid('iss'), productIds: [102] })
  assert.equal(next.status, 409); assert.equal(next.json.code, 'inventory_check_task_limit'); assert.equal(next.json.open, 31)
}
/** F3 + M21: two issues race for the LAST open-task slot: exactly one wins and the other is refused with the cap refusal (the cap is read inside the issue's own batch, so the interleaving cannot slip two through). Then a take-back at the cap is still never refused. */
async function lastSlotRace(k) {
  const t = await k.issue([100]); const x = await k.count([100]); assert.deepEqual(x.closed.closedTasks, [t])
  for (let n = 0; n < 29; n++) await k.issue([101]) // 29 open: one slot left
  const open = () => k.w.row("SELECT COUNT(*) AS n FROM inventory_check_sessions WHERE organization_id IS NULL AND branch_id=1 AND status='open' AND json_extract(scope_json,'$.membership')='task'").n
  assert.equal(open(), 29)
  const body = (p) => ({ branchId: 1, requestId: k.w.rid('race'), title: 'race', productIds: [p] })
  const db = k.w.app.env.DB, ob = db.batch, oo = db.batchOnce
  let fired = false, second = null
  const hook = (orig) => async (list) => { if (!fired && list.some((s) => /INSERT INTO inventory_check_sessions/.test(String(s.sql)))) { fired = true; second = await k.w.app.send('POST', '/api/inventory-checks/tasks', body(103)) } return orig(list) }
  k.w.as('admin'); db.batch = hook(ob); db.batchOnce = hook(oo)
  let first; try { first = await k.w.app.send('POST', '/api/inventory-checks/tasks', body(102)) } finally { db.batch = ob; db.batchOnce = oo }
  assert.equal(fired, true, 'the interleaving happened')
  const answers = [first, second].map((a) => [a.status, a.json && a.json.code])
  assert.equal(answers.filter(([status]) => status === 201).length, 1, 'exactly one issue wins the last slot: ' + JSON.stringify(answers))
  assert.deepEqual(answers.filter(([status]) => status !== 201), [[409, 'inventory_check_task_limit']], 'the other gets the cap refusal')
  assert.equal(open(), 30, 'the branch holds exactly the cap, never one more')
  const r = await k.resume(x.id); assert.deepEqual(r.json.reopenedTasks, [t], 'a take-back is never refused by the cap'); assert.equal(open(), 31)
}
/** E8: the pickup stays closed. */
async function pickupStaysClosed(k) {
  const t = await k.issue([100]); const pk = await k.ic('emp2', 'POST', `/tasks/${t}/pickup`, { requestId: k.w.rid('pk') }); assert.equal(pk.status, 201, JSON.stringify(pk.json))
  const x = await k.count([100]); assert.deepEqual(x.closed.closedTasks, [t])
  const open = () => k.w.row("SELECT COUNT(*) AS n FROM inventory_check_sessions WHERE json_extract(scope_json,'$.membership')='pickup' AND status='open'").n
  assert.equal(open(), 0)
  const r = await k.resume(x.id); assert.deepEqual(r.json.reopenedTasks, [t]); assert.equal(open(), 0, 'a pickup is never reopened')
  const v = await k.task(t); assert.equal(v.can_pickup, true); assert.equal(v.picked_up_by, null)
}
/** E15 + E16: the two things the design could not do (immutable columns), so the reopen does not depend on them. */
async function immutables(k) {
  const x = await k.count([100])
  assert.throws(() => k.w.raw.prepare(`UPDATE inventory_check_sessions SET scope_json=json_set(scope_json,'$.undone',1) WHERE id=?`).run([x.id]), /inventory_check_baseline_immutable/)
  assert.throws(() => k.w.raw.prepare(`INSERT INTO inventory_check_events(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at) VALUES(?,NULL,1,'a','task_reopened','zz','h','{}','{}','{}','2026-01-01')`).run([x.id]), /CHECK/)
}

// ---- the Set: Undo takes its count back, Redo restores it ---------------------------------------------------------------------------------------------------------------------------------------
async function setWorld(k, { tasks = [[130]] } = {}) {
  await k.differs(130)
  const ids = []; for (const products of tasks) ids.push(await k.issue(products))
  const s = await k.lotSet(130); assert.equal(s.status, 200, JSON.stringify(s.json)); assert.equal(s.json.issue_closed, true)
  return { ids, set: s.json }
}
const setItem = (k, op) => k.w.row(`SELECT i.state,i.counted_quantity,i.baseline_quantity,i.updated_at,i.revision FROM inventory_check_items i JOIN inventory_check_sessions s ON s.id=i.session_id WHERE json_extract(s.scope_json,'$.membership')='stock_set' AND json_extract(s.scope_json,'$.operation')=?`, op)

/** E17 + E4b + M8 + M9 + M14 + M13(E18 below): Undo takes the Set count back and reopens the task; the Issue is open again; Redo restores the count at its original time and closes the task again, not a later one. */
async function setUndoRedo(k) {
  const { ids: [t], set } = await setWorld(k); assert.deepEqual(set.closed_tasks, [t])
  const original = setItem(k, set.operation_id); assert.equal(original.state, 'done')
  const u = await k.undo(set.action_history_id); assert.equal(u.status, 200, JSON.stringify(u.json))
  const taken = setItem(k, set.operation_id); assert.deepEqual([taken.state, taken.counted_quantity, taken.baseline_quantity, taken.updated_at], ['unstarted', null, original.baseline_quantity, original.updated_at], 'the figure stays, the time stays')
  assert.equal(k.status(t).status, 'open'); const ev = k.reopens(t); assert.equal(ev.length, 1); assert.equal(JSON.parse(ev[0].after_json).cause, 'set_undone')
  assert.equal(k.w.row("SELECT COUNT(*) AS n FROM inventory_check_sessions WHERE json_extract(scope_json,'$.membership')='stock_set_undo'").n, 1, 'the Issue is open again: its copy was written (the Issue side read the latest count before it was taken back)')
  const board = (await k.task(t)); assert.equal(board.reopened.reason, 'set_undone'); assert.equal(board.reopened.by, 'u71')
  const late = await k.issue([130])
  const d = await k.redo(set.action_history_id); assert.equal(d.status, 200, JSON.stringify(d.json))
  const back = setItem(k, set.operation_id); assert.deepEqual([back.state, back.counted_quantity, back.updated_at], ['done', original.baseline_quantity, original.updated_at], 'restored at its ORIGINAL time')
  assert.equal(k.status(t).status, 'closed', 'the Redo closes the task again'); assert.equal(k.status(late).status, 'open', 'the restored count is older than the later task: it ticks nothing')
  const close = k.events(t).filter((e) => e.action === 'close').pop(); assert.equal(JSON.parse(close.after_json).auto, 1)
}
/** E4: a task closed by hand while the Set is undone: the Redo closes nothing, and the next Undo reopens nothing. */
async function setHandClose(k) {
  const { ids: [t], set } = await setWorld(k)
  assert.equal((await k.undo(set.action_history_id)).status, 200); assert.equal(k.status(t).status, 'open')
  const hand = await k.ic('admin', 'PATCH', `/sessions/${t}`, { expectedRevision: 2, requestId: k.w.rid('hand'), action: 'close' }); assert.equal(hand.status, 200, JSON.stringify(hand.json))
  assert.equal((await k.redo(set.action_history_id)).status, 200)
  assert.equal(setItem(k, set.operation_id).state, 'done')
  assert.equal((await k.undo(set.action_history_id)).status, 200); assert.equal(k.status(t).status, 'closed', 'a task closed by hand never reopens'); assert.equal(k.reopens(t).length, 1, 'only the first Undo reopened it')
}
/** E18 + M13: a newer count in an OPEN session is not final: the Set count is still taken back and the task reopens. */
async function setUndoOpenSession(k) {
  const { ids: [t], set } = await setWorld(k)
  await sleep(4)
  const made = await k.ic('admin', 'POST', '/sessions', { branchId: 1, requestId: k.w.rid('s'), productIds: [130], scope: { membership: 'visible_page' } }); assert.equal(made.status, 201, JSON.stringify(made.json))
  const o = await k.ic('admin', 'PATCH', `/sessions/${made.json.item.id}/items/130`, { expectedRevision: 0, expectedSessionRevision: 0, requestId: k.w.rid('o'), state: 'issue', counted_quantity: 5, reason: 'recount' }); assert.equal(o.status, 200, JSON.stringify(o.json))
  const u = await k.undo(set.action_history_id); assert.equal(u.status, 200, JSON.stringify(u.json))
  assert.equal(setItem(k, set.operation_id).state, 'unstarted'); assert.equal(k.status(t).status, 'open', 'an open session count is not final: the task reopens')
  assert.equal(k.w.row("SELECT COUNT(*) AS n FROM inventory_check_sessions WHERE json_extract(scope_json,'$.membership')='stock_set_undo'").n, 0, 'the newer count stands: no copy of the Issue')
}
/** E19: resuming a session the done rule never counts (the Issue copy an Undo wrote) reopens nothing. */
async function undoSessionResume(k) {
  const { ids: [t], set } = await setWorld(k)
  assert.equal((await k.undo(set.action_history_id)).status, 200)
  const copy = k.w.row("SELECT id FROM inventory_check_sessions WHERE json_extract(scope_json,'$.membership')='stock_set_undo'").id
  const before = k.reopens(t).length
  const r = await k.resume(copy, 0); assert.equal('reopenedTasks' in r.json, false); assert.equal(k.reopens(t).length, before)
}

/** r8aSeed1BetweenUndoRedo (M20): seed 1 of the property test, shrunk (19 Nov): a Set closes the difference and the task; Undo (count taken back, task reopens); ANOTHER date of the product is Set (the Issue's lines no longer all match, so the Redo cannot close the Issue again); Redo (the count is restored in effect, the task closes); the second Undo takes the count back again and reopens the task.
 *  In effect at each step for the product: Set count (1), none after the Undo (2), none after the other date's Set (3: it closes no difference), the Set count again after the Redo (4), none after the second Undo (5). The Redo must not rewrite the Set's stored issue_closed. */
async function r8aSeed1BetweenUndoRedo(k) {
  const { ids: [t], set } = await setWorld(k); assert.deepEqual(set.closed_tasks, [t])
  assert.equal((await k.undo(set.action_history_id)).status, 200); assert.equal(k.status(t).status, 'open')
  await sleep(4)
  const other = await k.w.call('admin', 'POST', '/api/inventory/adjust', { type: 'set', setScope: 'lot', productId: 130, branchId: 1, batchId: 1302, quantity: 6, expectedLotQuantity: 7, reason: 'Physical count', client_request_id: 'inventory_set_' + k.w.rid('o') })
  assert.equal(other.status, 200, JSON.stringify(other.json)); assert.equal(other.json.issue_closed, false, 'the other date closes no difference: the first date is still off')
  const d = await k.redo(set.action_history_id); assert.equal(d.status, 200, JSON.stringify(d.json))
  assert.equal(setItem(k, set.operation_id).state, 'done', 'the Redo restored the count'); assert.equal(k.status(t).status, 'closed')
  const u = await k.undo(set.action_history_id); assert.equal(u.status, 200, JSON.stringify(u.json))
  assert.equal(setItem(k, set.operation_id).state, 'unstarted', 'the second Undo takes the restored count back'); assert.equal(k.status(t).status, 'open', 'and the task reopens'); assert.equal(k.reopens(t).length, 2)
}

// ---- the PLAIN Set (Products page, Stock-session line: type "set", no setScope) is a final count too, and its Revert is its Undo ---------------------------------------------------------------------------------
const lastMovement = (k) => k.w.row('SELECT MAX(id) AS id FROM inventory_movements').id
/** F1 + M17-M19: a plain Set that makes the latest Differs match closes it and the task it completes; its Revert takes the count back (the task reopens) and the Revert of the Revert restores it. */
async function plainSetCycle(k) {
  await sleep(4)
  const earlier = await k.w.call('admin', 'POST', '/api/inventory/adjust', { productId: 110, branchId: 1, quantity: 1, type: 'remove', reason: 'damaged', client_request_id: 'inventory_remove_' + k.w.rid('e') }); assert.equal(earlier.status, 200, JSON.stringify(earlier.json)) // an earlier movement: the Set's count is keyed by ITS movement, not the oldest
  await sleep(4)
  const s0 = await k.ic('emp1', 'POST', '/submissions', { branchId: 1, requestId: k.w.rid('sub'), lines: [{ productId: 105, countedQuantity: 8, seenQuantity: 10 }] }); assert.equal(s0.status, 201, JSON.stringify(s0.json))
  const rj = await k.ic('admin', 'POST', `/sessions/${s0.json.item.id}/approval/lines`, { productId: 105, action: 'reject', requestId: k.w.rid('rj') }); assert.equal(rj.status, 200, JSON.stringify(rj.json))
  const t = await k.issue([105]), late = await k.issue([106])
  await sleep(4)
  const set = await k.w.call('admin', 'POST', '/api/inventory/adjust', { type: 'set', productId: 105, branchId: 1, quantity: 8, reason: 'Physical count', client_request_id: 'inventory_set_' + k.w.rid('p') })
  assert.equal(set.status, 200, JSON.stringify(set.json)); assert.equal(set.json.issue_closed, true, 'the plain Set closed the difference'); assert.deepEqual(set.json.closed_tasks, [t])
  assert.equal(k.status(t).status, 'closed')
  const mv = lastMovement(k)
  const undo = await k.w.call('admin', 'POST', `/api/inventory/movements/${mv}/revert`, {}); assert.equal(undo.status, 200, JSON.stringify(undo.json))
  assert.equal(k.status(t).status, 'open', 'the Revert took the Set count back: the task reopens'); assert.equal(JSON.parse(k.reopens(t)[0].after_json).cause, 'set_undone')
  assert.equal((await k.task(t)).reopened.reason, 'set_undone')
  const issue = await k.issue([105]); const mv2 = lastMovement(k)
  const redo = await k.w.call('admin', 'POST', `/api/inventory/movements/${mv2}/revert`, {}); assert.equal(redo.status, 200, JSON.stringify(redo.json))
  assert.equal(k.status(t).status, 'closed', 'the Revert of the Revert closes the task again'); assert.equal(k.status(issue).status, 'open', 'at the original time: a task issued after the Set is not ticked'); assert.equal(k.status(late).status, 'open')
  // a plain Set that changes no difference closes nothing and its Revert reopens nothing
  const plain = await k.w.call('admin', 'POST', '/api/inventory/adjust', { type: 'set', productId: 107, branchId: 1, quantity: 7, reason: 'Physical count', client_request_id: 'inventory_set_' + k.w.rid('p') })
  assert.equal(plain.status, 200, JSON.stringify(plain.json)); assert.equal(plain.json.issue_closed, false)
}

const opAnswer = (k, op) => JSON.parse(k.w.row('SELECT response_json FROM stock_lot_adjustment_operations WHERE id=?', op).response_json)
const lotQty = (k, batch) => k.w.row('SELECT quantity FROM branch_batch_stock WHERE batch_id=? AND branch_id=1', batch).quantity
/** The same mechanism with a newer count instead of the other date: Set A, Undo A, a count C (closes the task), Redo A (its Issue side cannot land), resume C (the restored Set count keeps the task closed), Undo A (takes it back, the task reopens). Plant M20. */
async function r8aRedoAfterNewerCount(k) {
  const { ids: [t], set } = await setWorld(k)
  assert.equal((await k.undo(set.action_history_id)).status, 200); assert.equal(k.status(t).status, 'open')
  const c = await k.count([130]); assert.deepEqual(c.closed.closedTasks, [t])
  assert.equal((await k.redo(set.action_history_id)).status, 200)
  const r = await k.resume(c.id); assert.equal(r.status, 200); assert.equal(k.status(t).status, 'closed', 'the restored Set count is in effect')
  assert.equal((await k.undo(set.action_history_id)).status, 200)
  assert.equal(setItem(k, set.operation_id).state, 'unstarted', 'the Undo takes the Set count back'); assert.equal(k.status(t).status, 'open')
}
/** C3 / ruling 2 + M22: an admin of ANOTHER organization undoes this organization's Set through action history: the count side and the reopen run at the Set session's organization, so the org-1 task reopens. */
async function r8aCrossOrgUndo(k) {
  const { ids: [t], set } = await setWorld(k)
  const u = await k.w.call('adminB', 'POST', '/api/action-history/' + set.action_history_id + '/undo', {})
  assert.equal(u.status, 200, JSON.stringify(u.json))
  assert.equal(setItem(k, set.operation_id).state, 'unstarted'); assert.equal(k.status(t).status, 'open', 'the reopen runs at the Set session organization: the count side never un-ticks without reopening')
}
/** M23: a replay of a plain Set (the remove path completes its receipt in the batch) answers issue_closed and closed_tasks again. */
async function r8aPlainSetReplay(k) {
  await sleep(4)
  const s0 = await k.ic('emp1', 'POST', '/submissions', { branchId: 1, requestId: k.w.rid('sub'), lines: [{ productId: 108, countedQuantity: 8, seenQuantity: 10 }] }); assert.equal(s0.status, 201, JSON.stringify(s0.json))
  const rj = await k.ic('admin', 'POST', '/sessions/' + s0.json.item.id + '/approval/lines', { productId: 108, action: 'reject', requestId: k.w.rid('rj') }); assert.equal(rj.status, 200, JSON.stringify(rj.json))
  const t = await k.issue([108]); await sleep(4)
  const body = { type: 'set', productId: 108, branchId: 1, quantity: 8, reason: 'Physical count', client_request_id: 'inventory_set_' + k.w.rid('p') }
  const first = await k.w.call('admin', 'POST', '/api/inventory/adjust', body); assert.equal(first.status, 200, JSON.stringify(first.json))
  assert.equal(first.json.issue_closed, true); assert.deepEqual(first.json.closed_tasks, [t])
  const again = await k.w.call('admin', 'POST', '/api/inventory/adjust', body)
  assert.equal(again.status, 200); assert.equal(again.json.issue_closed, true, 'a replay answers the same'); assert.deepEqual(again.json.closed_tasks, [t])
}

const SCENARIOS = { r8aRedoAfterNewerCount, r8aCrossOrgUndo, r8aPlainSetReplay, plainSetCycle, twoTasksOneCount, laterCountStays, earlierCountStays, countBeforeIssue, handClosedStays, notCountableStays, optionsAandBMiss, resumeThenCloseAgain, otherBranchAndOrg, overTheCap, lastSlotRace, pickupStaysClosed, immutables, setUndoRedo, r8aSeed1BetweenUndoRedo, setHandClose, setUndoOpenSession, undoSessionResume }

// ---- the plants: each must turn the named scenario red ------------------------------------------------------------------------------------------------------------------------------------------
const PLAN = "LIMIT -1) r\n    WHERE ${taskItemCountableSql('r')}`"
const CAP_GUARD = "    guard(`(${OPEN_TASK_COUNT_SQL})<@maxOpenTasks`, 'inventory_check_task_limit', { ...params, maxOpenTasks: issue.maxOpenTasks }),\n"
const MUTANTS = [
  ['M21 the cap is read outside the issue batch (a race slips two through)', { 'lib/inventoryCheckSessions.ts': [[
    "  const statements: Statement[] = [\n    guard('EXISTS(SELECT 1 FROM branches WHERE id=@branchId AND is_active=1)', 'inventory_check_baseline_changed', params),\n" + CAP_GUARD,
    "  { const pre = await db.prepare(`SELECT (${OPEN_TASK_COUNT_SQL}) AS n`).get<{ n: number }>({ organization: actor.organization_id, branchId }); if (Number(pre?.n ?? 0) >= issue.maxOpenTasks) fail(409, 'inventory_check_task_limit', { open: Number(pre?.n ?? 0), limit: issue.maxOpenTasks }) }\n" +
    "  const statements: Statement[] = [\n    guard('EXISTS(SELECT 1 FROM branches WHERE id=@branchId AND is_active=1)', 'inventory_check_baseline_changed', params),\n"]] }, 'lastSlotRace'],
  ['M20 the Set count side is gated on the stored issue_closed (a Redo that could not close rewrote it to false)', { 'lib/stockLotAdjustment.ts': [["if (origin || (JSON.parse(row.response_json || '{}') as { issue_closed?: unknown }).issue_closed === true) {", "if ((JSON.parse(row.response_json || '{}') as { issue_closed?: unknown }).issue_closed === true) {"]] }, 'r8aSeed1BetweenUndoRedo'],
  ['M20b the same plant, killed by the newer-count route too', { 'lib/stockLotAdjustment.ts': [["if (origin || (JSON.parse(row.response_json || '{}') as { issue_closed?: unknown }).issue_closed === true) {", "if ((JSON.parse(row.response_json || '{}') as { issue_closed?: unknown }).issue_closed === true) {"]] }, 'r8aRedoAfterNewerCount'],
  ['M22 the Set Undo/Redo count side uses the UNDOER organization and the operation branch (ruling 2 reverted)', { 'lib/stockLotAdjustment.ts': [['const closing = { productId: before.productId, branchId: origin ? Number(origin.branch) : before.branchId, organization: origin ? origin.org ?? null : user.organization_id ?? null, operation: row.id', 'const closing = { productId: before.productId, branchId: before.branchId, organization: user.organization_id ?? null, operation: row.id']] }, 'r8aCrossOrgUndo'],
  ['M23 the plain Set remove path drops its trailing receipt update (a replay loses issue_closed)', { 'routes/inventory.ts': [[']), atomicMark, { status: 200, body: adjustResponseBody() }, setCount?.trailing)', ']), atomicMark, { status: 200, body: adjustResponseBody() })']] }, 'r8aPlainSetReplay'],
  ['M24 the plain Set keys its count to the OLDEST movement', { 'lib/stockSetClosesIssue.ts': [["('m'||(SELECT MAX(id) FROM inventory_movements))", "('m'||(SELECT MIN(id) FROM inventory_movements))"]] }, 'plainSetCycle'],
  ['M17 a plain Set closes no difference and no task', { 'routes/inventory.ts': [["const plainCount = type === 'set' && await (await import('../lib/readSwitches')).readSwitch(c.env, 'ic_lot_counts')", 'const plainCount = false']] }, 'plainSetCycle'],
  ['M18 the Revert of a plain Set takes no count back', { 'lib/stockSetClosesIssue.ts': [['    const issue = reopenIssueStatements(closing, now), count = takeBackSetCountStatements(closing, origin, now)\n    return { statements: [...issue, ...count.statements], changedAt: issue.length + 1 }', '    const issue = reopenIssueStatements(closing, now)\n    return { statements: [...issue], changedAt: issue.length + 1 }']] }, 'plainSetCycle'],
  ['M19 the Revert of the Revert restores no count', { 'lib/stockSetClosesIssue.ts': [['  return { statements: [...issue, ...count.statements], changedAt: issue.length + 1 }\n}', '  return { statements: [...issue], changedAt: issue.length + 1 }\n}']] }, 'plainSetCycle'],
  ['M1 drop the skip of products another count still covers', { [T]: [["FROM (${takenSql(src)}) k WHERE NOT ${taskItemDoneSql('k', '@branchId', 'k.at', '@org')}`", 'FROM (${takenSql(src)}) k`']] }, 'laterCountStays'],
  ['M2 drop c.started_at<=g.at', { [T]: [['c.started_at<=g.at AND (g.l IS NULL OR c.started_at>g.l)', '(g.l IS NULL OR c.started_at>g.l)']] }, 'countBeforeIssue'],
  ['M3 drop (g.l IS NULL OR c.started_at>g.l)', { [T]: [['c.started_at<=g.at AND (g.l IS NULL OR c.started_at>g.l)', 'c.started_at<=g.at']] }, 'earlierCountStays'],
  ['M4 drop autoClosedSql', { [T]: [["CROSS JOIN ${S} t ON t.id=r.id WHERE ${autoClosedSql('t')}`", 'CROSS JOIN ${S} t ON t.id=r.id`']] }, 'handClosedStays'],
  ['M5 drop taskItemCountableSql after the window', { [T]: [[PLAN, 'LIMIT -1) r`']] }, 'notCountableStays'],
  ['M6 option A: closed at or after the taken-back session close', { [T]: [['c.started_at<=g.at AND (g.l IS NULL OR c.started_at>g.l)', 'c.closed_at>=(SELECT closed_at FROM inventory_check_sessions WHERE id=@src)']] }, 'optionsAandBMiss'],
  ['M7 option B: tasks whose close names the session', { [T]: [['c.started_at<=g.at AND (g.l IS NULL OR c.started_at>g.l)', "(SELECT json_extract(e.after_json,'$.closedBy') FROM inventory_check_events e WHERE e.session_id=c.id AND e.action='close' ORDER BY e.id DESC LIMIT 1)=@src"]] }, 'optionsAandBMiss'],
  ['M8 the Undo takes the count back BEFORE the Issue side', { 'lib/stockLotAdjustment.ts': [['[...reopenIssueStatements(closing, now), ...takeBackSetCountStatements(closing, where, now).statements]', '[...takeBackSetCountStatements(closing, where, now).statements, ...reopenIssueStatements(closing, now)]']] }, 'setUndoRedo'],
  ['M9 the Redo stamps the restored count with the Redo time', { 'lib/stockSetClosesIssue.ts': [["SET state='done',counted_quantity=baseline_quantity,revision=revision+1 WHERE", "SET state='done',counted_quantity=baseline_quantity,revision=revision+1,updated_at=@now WHERE"]] }, 'setUndoRedo'],
  ['M10 the reopen runs before the resume UPDATE', { 'lib/inventoryCheckSessions.ts': [["const statements: Statement[] = [sessionGuard(actor, session, expected, action === 'close' ? 'open' : 'closed'),", "const statements: Statement[] = [sessionGuard(actor, session, expected, action === 'close' ? 'open' : 'closed'), ...(reopening ? reopening.statements : []),"], ["    // LAST: after the UPDATE that makes the session's counts not final.\n    ...(reopening ? reopening.statements : []),\n", '']] }, 'twoTasksOneCount'],
  ['M11 drop the organization fence of the candidates', { [T]: [["WHERE c.organization_id IS @org AND ${kindOf('c')}='${TASK_MEMBERSHIP}' AND c.branch_id", "WHERE ${kindOf('c')}='${TASK_MEMBERSHIP}' AND c.branch_id"]] }, 'otherBranchAndOrg'],
  ['M12 a cap guard in the reopen', { [T]: [["WHERE ${autoClosedSql('t')}`", "WHERE ${autoClosedSql('t')} AND (SELECT COUNT(*) FROM inventory_check_sessions o WHERE o.organization_id IS @org AND json_extract(o.scope_json,'$.membership')='task' AND o.branch_id=@branchId AND o.status='open')<30`"]] }, 'overTheCap'],
  ['M13 an open session count counts as final', { [T]: [["${x}.state IN ('done','issue') AND ${xs}.status='closed' AND ${xs}.organization_id", "${x}.state IN ('done','issue') AND ${xs}.organization_id"]] }, 'setUndoOpenSession'],
  ['M14 the Redo runs no auto-close', { 'lib/stockSetClosesIssue.ts': [['    ...auto.statements.map(({ sql }) => ({ sql, params })),\n', '']] }, 'setUndoRedo'],
  ['M15 the board keeps LIMIT of the open list', { [T]: [['ORDER BY s.started_at DESC, s.id DESC),', 'ORDER BY s.started_at DESC, s.id DESC LIMIT 30),']] }, 'overTheCap'],
  ['M16 the resume answer drops reopenedTasks', { 'lib/inventoryCheckSessions.ts': [['...(reopenedTasks.length ? { reopenedTasks } : {}) }', '}']] }, 'twoTasksOneCount'],
]

async function main() {
  for (const [name, run] of Object.entries(SCENARIOS)) await check(name, () => run(kit()))
  const killed = []
  for (const [name, edits, scenario] of MUTANTS) {
    let red = false, why = ''
    try { await SCENARIOS[scenario](kit(edits)) } catch (error) { red = true; why = String(error && error.message || error).split('\n')[0].slice(0, 110) }
    if (red) { killed.push(name); passed++; console.log(`KILLED ${name} by ${scenario}: ${why}`) } else { failures.push(`mutant survived: ${name}`); console.log(`SURVIVED ${name} (scenario ${scenario} stayed green)`) }
  }
  console.log(`\n${passed} passed, ${failures.length} failed; ${killed.length}/${MUTANTS.length} plants killed`)
  if (failures.length) { console.log(failures.join('\n')); process.exit(1) }
}
main().catch((error) => { console.error(error); process.exit(1) })
