'use strict'
// Count tasks, round 8b (P2.3 to P2.7): the board's cache, over the real routes and migrations in an in-memory SQLite (harness/count-tasks-world.cjs). Each scenario serves a STALE figure if the change is wrong.
//   P2.3  an observation does not move the board: the next GET /tasks is warm (the board SELECT does not run again).
//   P2.4  a submission at branch 1 does not move the board of branch 2 (warm), and does move branch 1 (cold, the new figure at once).
//   P2.5  one open reads the versions ONCE: two KV reads (the branch board and products), and the answer's version is the key's.
//   P2.3  the take-backs move the board at once: the resume of a count session that closed a task, a Set's Undo, a plain Revert (the board shows the reopened task on the very next read, from a warm entry).
//   P2.6  the list of one task does not re-read after a count at its branch (its page query does not run again); a task list filtered by check state still does; its status beside the page is live.
//   P2.1  a CLOSED task shows the figures it closed with, from its close event, even when the products it held are deactivated afterwards; a task closed before the figures were recorded falls back to the live walk.
// Run: node scripts/test-inventory-check-tasks-cost-native.cjs
const assert = require('node:assert/strict')
const { buildWorld } = require('./harness/count-tasks-world.cjs')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const failures = []
let passed = 0
async function check(name, run) { try { await run(); passed++; console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.log(`FAIL ${name}\n     ${String(error && error.stack || error).split('\n').slice(0, 6).join('\n     ')}`) } }

function kit() {
  const w = buildWorld()
  const ic = (who, method, url, body) => w.call(who, method, `/api/inventory-checks${url}`, body)
  let kvReads = 0
  const get = w.app.env.CACHE.get; w.app.env.CACHE.get = async (key) => { kvReads++; return get(key) }
  const boardRuns = () => w.app.statements.filter((s) => s.includes('WITH open_t AS')).length
  const pageRuns = () => w.app.counters.pageQueries
  const k = {
    w, ic, boardRuns, pageRuns, kvReads: () => kvReads,
    issue: async (products, branchId = 1, who = 'admin') => { await sleep(4); const r = await ic(who, 'POST', '/tasks', { branchId, requestId: w.rid('iss'), productIds: products }); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.item.id },
    board: async (who = 'admin', branch = 1) => (await ic(who, 'GET', `/tasks?branchId=${branch}`)).json,
    task: async (id, who = 'admin', branch = 1) => (await k.board(who, branch)).items.find((item) => item.id === id),
    list: async (id, query = '', who = 'emp1') => ic(who, 'GET', `/list?branchId=1&taskId=${id}${query}`),
    /** A count session of `products` at branch 1 counted Done and closed. */
    count: async (products, who = 'emp1') => {
      await sleep(4)
      const made = await ic(who, 'POST', '/sessions', { branchId: 1, requestId: w.rid('s'), productIds: products, scope: { membership: 'visible_page' } }); assert.equal(made.status, 201, JSON.stringify(made.json))
      const id = made.json.item.id
      for (const p of products) { const r = await ic(who, 'PATCH', `/sessions/${id}/items/${p}`, { expectedRevision: 0, expectedSessionRevision: 0, requestId: w.rid('o'), state: 'done', countedQuantity: 10 }); assert.equal(r.status, 200, JSON.stringify(r.json)) }
      const closed = await ic(who, 'PATCH', `/sessions/${id}`, { expectedRevision: 0, requestId: w.rid('c'), action: 'close' }); assert.equal(closed.status, 200, JSON.stringify(closed.json))
      return { id, closed: closed.json }
    },
    resume: async (id, who = 'emp1') => { await sleep(4); return ic(who, 'PATCH', `/sessions/${id}`, { expectedRevision: 1, requestId: w.rid('r'), action: 'resume' }) },
    submit: async (product, branchId = 1, who = 'emp1') => { await sleep(4); return ic(who, 'POST', '/submissions', { branchId, requestId: w.rid('sub'), lines: [{ productId: product, countedQuantity: 10, seenQuantity: 10 }] }) },
    differs: async (product = 130) => {
      await sleep(4)
      const s = await ic('emp1', 'POST', '/submissions', { branchId: 1, requestId: w.rid('sub'), lines: [{ productId: product, lots: [{ batchId: product * 10 + 1, scope: 'lot', counted: 2, seen: 3 }, { batchId: product * 10 + 2, scope: 'lot', counted: 7, seen: 7 }] }] })
      assert.equal(s.status, 201, JSON.stringify(s.json))
      const rj = await ic('admin', 'POST', `/sessions/${s.json.item.id}/approval/lines`, { productId: product, action: 'reject', requestId: w.rid('rj') }); assert.equal(rj.status, 200, JSON.stringify(rj.json))
    },
    lotSet: async (product = 130) => { await sleep(4); return w.call('admin', 'POST', '/api/inventory/adjust', { type: 'set', setScope: 'lot', productId: product, branchId: 1, batchId: product * 10 + 1, quantity: 2, expectedLotQuantity: 3, reason: 'Physical count', client_request_id: 'inventory_set_' + w.rid('a') }) },
    undo: async (hid) => { await sleep(4); return w.call('admin', 'POST', `/api/action-history/${hid}/undo`, {}) },
    status: (id) => w.row('SELECT status FROM inventory_check_sessions WHERE id=?', id).status,
  }
  return k
}

async function main() {
  await check('P2.3: an observation moves no board; a warm GET /tasks does not run the board SELECT, and P2.5 reads the two versions once (two KV reads) and answers the key\'s version', async () => {
    const k = kit(), t = await k.issue([100, 101, 102])
    const first = await k.board(), runs = k.boardRuns()
    assert.equal(first.items.find((i) => i.id === t).total, 3)
    const kv0 = k.kvReads(); const again = await k.board()
    assert.equal(k.boardRuns(), runs, 'warm')
    assert.equal(k.kvReads() - kv0, 2, 'one open reads the branch board version and products, once each (before: inventory_checks twice and products)')
    assert.equal(again.version, first.version, 'the answer carries the version of the key')
    assert.match(again.version, /^k2?:/, 'a cache version token, from the namespace the key holds')
    const made = await k.ic('emp1', 'POST', '/sessions', { branchId: 1, requestId: k.w.rid('s'), productIds: [100, 101], scope: { membership: 'visible_page' } }); assert.equal(made.status, 201)
    const o = await k.ic('emp1', 'PATCH', `/sessions/${made.json.item.id}/items/100`, { expectedRevision: 0, expectedSessionRevision: 0, requestId: k.w.rid('o'), state: 'done', countedQuantity: 10 }); assert.equal(o.status, 200, JSON.stringify(o.json))
    const after = await k.board()
    assert.equal(k.boardRuns(), runs, 'an observation (an open session count is not final) did not move the board: still warm')
    assert.equal(after.version, first.version)
  })

  await check('P2.4: a submission at branch 1 moves branch 1 (cold, the new figure at once) and leaves branch 2 warm', async () => {
    const k = kit(), t1 = await k.issue([100, 101], 1), t2 = await k.issue([100, 101], 2)
    await k.board('admin', 1); await k.board('admin', 2)
    const runs = k.boardRuns()
    const s = await k.submit(100, 1); assert.equal(s.status, 201, JSON.stringify(s.json))
    await k.board('admin', 2); assert.equal(k.boardRuns(), runs, 'branch 2 stays warm')
    const one = (await k.board('admin', 1)).items.find((i) => i.id === t1)
    assert.equal(k.boardRuns(), runs + 1, 'branch 1 recomputed')
    assert.equal(one.done, 1, 'and shows the count at once')
    assert.equal((await k.board('admin', 2)).items.find((i) => i.id === t2).done, 0)
  })

  await check('P2.3: the resume of a count session that closed a task moves the board at once (a warm entry is not served): the task shows open and reopened', async () => {
    const k = kit(), t = await k.issue([100, 101]), { id } = await k.count([100, 101])
    assert.equal(k.status(t), 'closed'); assert.equal((await k.task(t)).status, 'closed'); await k.board()
    const r = await k.resume(id); assert.equal(r.status, 200, JSON.stringify(r.json))
    const shown = await k.task(t); assert.equal(shown.status, 'open'); assert.ok(shown.reopened, 'the reopened field shows at once'); assert.equal(shown.reopened.reason, 'count_reopened')
  })

  await check('P2.3: a Set Undo that reopens a task moves the board of the Set\'s branch at once', async () => {
    const k = kit(); await k.differs(130)
    const t = await k.issue([130]); const s = await k.lotSet(130); assert.equal(s.status, 200, JSON.stringify(s.json)); assert.deepEqual(s.json.closed_tasks, [t])
    assert.equal((await k.task(t)).status, 'closed')
    const u = await k.undo(s.json.action_history_id); assert.equal(u.status, 200, JSON.stringify(u.json))
    const shown = await k.task(t); assert.equal(shown.status, 'open'); assert.equal(shown.reopened.reason, 'set_undone')
  })

  await check('P2.3: a Set that closes the last difference of a task moves the board of its branch (the task shows closed on the next read)', async () => {
    const k = kit(); await k.differs(130)
    const t = await k.issue([130]); assert.equal((await k.task(t)).status, 'open')
    const s = await k.lotSet(130); assert.equal(s.status, 200)
    assert.equal((await k.task(t)).status, 'closed')
  })

  await check('P2.6: the list of one task is not re-read after a count at its branch; the task\'s status beside the page is live; a check-state list still re-reads', async () => {
    const k = kit(), t = await k.issue([100, 101, 102])
    const a = await k.list(t); assert.equal(a.status, 200, JSON.stringify(a.json)); const p0 = k.pageRuns()
    const b = await k.list(t); assert.equal(k.pageRuns(), p0, 'warm')
    const s = await k.submit(100, 1); assert.equal(s.status, 201, JSON.stringify(s.json))
    const c = await k.list(t); assert.equal(c.status, 200)
    assert.equal(k.pageRuns(), p0, 'a count at the task\'s branch does not re-read its page (its id set does not depend on counts)')
    assert.deepEqual(c.json.items.map((i) => i.id), b.json.items.map((i) => i.id))
    const q = await k.list(t, '&checkState=not_checked'); assert.equal(q.status, 200, JSON.stringify(q.json)); const p1 = k.pageRuns()
    await k.submit(101, 1)
    const q2 = await k.list(t, '&checkState=not_checked'); assert.equal(q2.status, 200)
    assert.ok(k.pageRuns() > p1, 'the check-state list keeps its count version: it re-reads after a count')
    assert.equal(q2.json.items.some((i) => i.id === 101), false, 'and does not show the counted product')
    const { id } = await k.count([102]); assert.ok(id)
    assert.equal((await k.list(t)).json.task.status, 'closed', 'the status beside the page is live (the task closed by the last count)')
    await k.resume(id)
    assert.equal((await k.list(t)).json.task.status, 'open', 'and open again after the resume')
  })

  await check('P2.1: a closed task shows the figures of its close event even after a product leaves the total; a legacy close event with no figures falls back to the live walk', async () => {
    const k = kit(), t = await k.issue([100, 101, 102]), { id } = await k.count([100, 101, 102])
    assert.equal(k.status(t), 'closed')
    const event = JSON.parse(k.w.row("SELECT after_json FROM inventory_check_events WHERE session_id=? AND action='close' ORDER BY id DESC LIMIT 1", t).after_json)
    assert.deepEqual([event.total, event.done, event.removed], [3, 3, 0], 'the auto-close recorded its figures')
    const before = await k.task(t); assert.deepEqual([before.total, before.done, before.removed], [3, 3, 0])
    k.w.raw.exec('PRAGMA foreign_keys=OFF'); k.w.stockWrite(() => { k.w.raw.prepare('UPDATE branch_stock SET quantity=0 WHERE product_id=?').run([102]); k.w.raw.prepare('UPDATE products SET stock_quantity=0 WHERE id=?').run([102]); k.w.raw.prepare('UPDATE products SET is_active=0 WHERE id=?').run([102]) }); k.w.raw.exec('PRAGMA foreign_keys=ON'); await k.w.bumpProducts()
    const frozen = await k.task(t); assert.deepEqual([frozen.total, frozen.done, frozen.removed], [3, 3, 0], 'a closed task keeps the figures it closed with (contract 3.1)')
    // a task closed BEFORE the figures were recorded: a close event with no figures (raw rows; the events are immutable, so it is built, not edited)
    const at = new Date().toISOString(), org = k.w.row('SELECT organization_id AS o FROM inventory_check_sessions WHERE id=?', t).o
    k.w.raw.prepare("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at) VALUES('legacy-task',?,1,71,'','closed',1,?,?,?,?)").run([org, JSON.stringify({ membership: 'task', products: 3, selection: { kind: 'ids' } }), at, at, at])
    for (const p of [100, 101, 102]) k.w.raw.prepare("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json) VALUES('legacy-task',?,1,'{}',NULL,'{}')").run([p])
    k.w.raw.prepare("INSERT INTO inventory_check_events(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at) VALUES('legacy-task',NULL,71,'u71','close','legacy-close','h','{}','{\"status\":\"closed\",\"revision\":1}','{}',?)").run([at]); await k.w.bumpProducts()
    const legacy = await k.task('legacy-task'); assert.deepEqual([legacy.total, legacy.done, legacy.removed], [2, 0, 1], 'no figures in the event: the live walk, as before (102 left the total)')
    assert.ok(id)
  })

  await check('P2.1: closing a task by hand records the figures the admin saw (done by the done rule), and the board shows them', async () => {
    const k = kit(), t = await k.issue([100, 101, 102]); await k.submit(100, 1)
    const row = k.w.row('SELECT revision FROM inventory_check_sessions WHERE id=?', t)
    const c = await k.ic('admin', 'PATCH', `/sessions/${t}`, { expectedRevision: row.revision, requestId: k.w.rid('c'), action: 'close' }); assert.equal(c.status, 200, JSON.stringify(c.json))
    const event = JSON.parse(k.w.row("SELECT after_json FROM inventory_check_events WHERE session_id=? AND action='close' ORDER BY id DESC LIMIT 1", t).after_json)
    assert.deepEqual([event.total, event.done, event.removed, event.status], [3, 1, 0, 'closed'])
    const shown = await k.task(t); assert.deepEqual([shown.status, shown.total, shown.done, shown.removed], ['closed', 3, 1, 0])
  })

  if (failures.length) { console.error(`${failures.length} FAILED: ${failures.join(' | ')}`); process.exit(1) }
  console.log(`${passed} checks passed`)
}
main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1) })
