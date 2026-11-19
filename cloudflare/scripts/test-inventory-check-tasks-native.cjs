'use strict'
// Count tasks (owner, 18 Nov 2026), over the real routes and the real migrations in an in-memory SQLite (harness/inv-app.cjs).
//
// An admin issues products to count; an employee picks the task up (one person per task) and counts it on the wired list; the task closes itself in the submission that counts its last product.
// Pinned here: issue (ids and filters, the cap), the list of tasks and its cache, pickup and release (permissions, the one-person rule, the race), the task's own list (/list?taskId=), the DONE RULE
// (any count at the branch at or after the issue, wherever it was made), the auto-close in both submission writers, the manual close, the Count sessions list, and a random-world property test
// against a brute-force oracle over the raw tables. Then every named mutant is planted and must be killed by the scenario that targets it.
//
// Run: node scripts/test-inventory-check-tasks-native.cjs
const assert = require('node:assert/strict')
const path = require('node:path')
const { createInvApp, USERS, person } = require('./harness/inv-app.cjs')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const failures = []
let passed = 0
async function check(name, run) { try { await run(); passed++; console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.log(`FAIL ${name}\n     ${String(error && error.stack || error).split('\n').slice(0, 6).join('\n     ')}`) } }

const COUNTER = { inventory_checks: true, inventory_check_show_stock: true, inventory_check_show_barcode: true, inventory_check_show_brand: true, inventory_check_show_category: true }
const USERS_X = {
  ...USERS,
  issuer: person(78, 'employee', { ...COUNTER, inventory_check_issue: true }),            // may issue, not an administrator, not the creator of what admin makes
  picker2: person(80, 'employee', { ...COUNTER }),                                        // another counter
  tasksOff: person(81, 'employee', { ...COUNTER, 'inventory_checks:tasks': false }),      // counts, but tasks are switched off for the role
  noCheck: person(82, 'employee', { ...COUNTER, 'inventory_checks:check': false }),       // views only
  viewIssuer: person(84, 'employee', { inventory_checks: true, inventory_check_issue: true, 'inventory_checks:check': false, inventory_checks_check: false }), // the view and the extra, no count grant
  auditor: person(85, 'employee', { ...COUNTER, audit_log: true }),                          // counts and holds audit_log (may see staff names)
  orgTwo: person(83, 'employee', { ...COUNTER, inventory_check_issue: true }, 2),          // another organization (its rows are written straight into the tables)
}
const PRODUCTS = 12 // 100..111
// The cost of each count writer measured by the scenario budget: D1 calls and table rows changed of the writer's own request, with no task open and with a task that very write completes (observe = the close of a count session, which makes its counts final).
const PINNED_WRITER_COST = {
  lot: { none: { calls: 9, rows: 4 }, completing: { calls: 9, rows: 8 } },
  plain: { none: { calls: 12, rows: 6 }, completing: { calls: 12, rows: 10 } },
  observe: { none: { calls: 6, rows: 2 }, completing: { calls: 6, rows: 6 } },
}
const ON = ['ic_wired', 'ic_simple', 'ic_fix_stock', 'ic_lot_counts']

function build(sourceEdits = {}, { extraProducts = 0, families = 0, familyBrand = 'Q', headers = 0, lone, headerName = 'Head', summer = false } = {}) {
  const app = createInvApp({
    users: USERS_X, sourceEdits,
    mount: { '/api/products': 'routes/products.ts', '/api/inventory-checks/products': 'routes/inventoryCheckProducts.ts', '/api/inventory-checks': 'routes/inventoryChecks.ts' },
    seed(raw, seedStockFixture) {
      seedStockFixture(raw.db, () => {
        const add = (id, name, brand, group = 0) => {
          raw.prepare(`INSERT INTO products(id,name,sku,barcode,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,brand,category,is_active,is_group,created_at,updated_at)
            VALUES(?,?,?,?,?,9.5,38000,4,16000,?,?,1,?,'2026-09-01 00:00:00','2026-09-01 00:00:00')`).run([id, name, `SKU${id}`, `88500${id}`, group ? 0 : 10, brand, 'Cat', group])
          if (!group) { raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,10)').run([id]); raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,2,10)').run([id]) }
        }
        for (let id = 100; id < 100 + PRODUCTS; id++) add(id, `Item ${id}`, id % 2 ? 'A' : 'B')
        // A family: a header with two children (the header is never a countable row).
        add(200, 'Family', 'F', 1); add(201, 'Family', 'F'); add(202, 'Family', 'F')
        raw.prepare('UPDATE products SET parent_id=200 WHERE id IN (201,202)').run()
        for (let n = 0; n < extraProducts; n++) add(300 + n, `Bulk ${300 + n}`, 'Z')
        // `families` families of one header and two children each (brand Q; over 100 of them is more than one page of the list)
        // `headers` family headers with no children (brand H, ids 5000.., named `headerName`) and `lone` (5 with headers) ordinary products of the same brand (ids 4000..): the list shows each header as a row, and a header adds no id to a task
        for (let n = 0; n < headers; n++) add(5000 + n, `${headerName} ${n}`, 'H', 1)
        for (let n = 0, count = lone ?? (headers ? 5 : 0); n < count; n++) add(4000 + n, `Lone ${n}`, 'H')
        // `summer`: family headers whose children are named differently from the header (hand-made variants): 'Summer set' (600) with 'Red top' (601) and 'Blue skirt' (602), 'Summer hat' (610) with 'Straw' and 'Felt' (611, 612),
        // one ordinary 'Summer dress' (603), a childless header 'Summer bare' (620) and a header whose only child is inactive, 'Summer ghost' (630 / 631). Headers are brand S, children brand K.
        if (summer) {
          add(600, 'Summer set', 'S', 1); add(601, 'Red top', 'K'); add(602, 'Blue skirt', 'K'); add(603, 'Summer dress', 'S'); add(610, 'Summer hat', 'S', 1); add(611, 'Straw', 'K'); add(612, 'Felt', 'K')
          add(620, 'Summer bare', 'S', 1); add(630, 'Summer ghost', 'S', 1)
          raw.prepare(`INSERT INTO products(id,name,sku,barcode,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,brand,category,is_active,is_group,parent_id,created_at,updated_at)
            VALUES(631,'Ghost kid','SKU631','88500631',0,9.5,38000,4,16000,'K','Cat',0,0,630,'2026-09-01 00:00:00','2026-09-01 00:00:00')`).run()
          raw.prepare('UPDATE products SET parent_id=600 WHERE id IN (601,602)').run(); raw.prepare('UPDATE products SET parent_id=610 WHERE id IN (611,612)').run(); 
        }
        for (let n = 0; n < families; n++) { const base = 1000 + n * 3, brand = n < 120 ? 'Q' : 'R'; add(base, `Fam ${n}`, brand, 1); add(base + 1, `Fam ${n}`, brand); add(base + 2, `Fam ${n}`, brand); raw.prepare('UPDATE products SET parent_id=? WHERE id IN (?,?)').run([base, base + 1, base + 2]) }
      })
    },
  })
  for (const name of ON) app.setSwitch(name, 'on')
  app.bumpProducts = () => app.load('lib/cache.ts').bumpVersion(app.env, 'products')
  const productsVersionReady = app.bumpProducts()
  const as = (key) => app.setUser(app.users[key])
  const ids = { n: 0 }
  const rid = (tag) => `${tag}-${String(++ids.n).padStart(6, '0')}`
  const api = (method, url, body) => app.send(method, `/api/inventory-checks${url}`, body)
  const get = (url) => app.get(`/api/inventory-checks${url}`)
  const issue = async (productIds, extra = {}, who = 'admin') => { as(who); return api('POST', '/tasks', { branchId: 1, requestId: rid('issue'), productIds, ...extra }) }
  const pickup = async (task, who = 'checker') => { as(who); return api('POST', `/tasks/${task}/pickup`, { requestId: rid('pick') }) }
  const release = async (task, who = 'checker') => { as(who); return api('POST', `/tasks/${task}/release`, { requestId: rid('rel') }) }
  const count = async (lines, { task, who = 'checker', branchId = 1 } = {}) => {
    as(who)
    return api('POST', '/submissions', { branchId, requestId: rid('sub'), ...(task ? { taskId: task } : {}), lines: lines.map((line) => (typeof line === 'number' ? { productId: line, countedQuantity: 10, seenQuantity: 10 } : line)) })
  }
  const board = async (who = 'admin', branch = 1) => { await productsVersionReady; as(who); return get(`/tasks?branchId=${branch}`) }
  const close = async (task, who = 'admin') => { as(who); return api('PATCH', `/sessions/${task}`, { expectedRevision: 0, requestId: rid('close'), action: 'close' }) }
  const row = (sql, ...params) => app.raw.prepare(sql).get(params)
  const rows = (sql, ...params) => app.raw.prepare(sql).all(params)
  return { app, as, api, get, issue, pickup, release, count, board, close, row, rows, rid, again: (world) => build(sourceEdits, world) }
}
const taskOf = async (w, id, who = 'admin') => (await w.board(who)).json.items.find((item) => item.id === id)

// ---- scenarios (each takes a fresh world; a mutant world must make its scenario throw) -------------------------------------------------------------------------------------------------------

/** A task changes no chip, date, Not checked figure or overlay: an unstarted item is never a latest count. */
async function noEffect(w) {
  w.as('admin')
  const snapshot = async () => (w.app.clearCaches(), w.as('admin'), { list: (await w.get('/list?branchId=1')).json, notChecked: (await w.get('/list?branchId=1&checkState=not_checked')).json.items.map((i) => i.id),
    ok: (await w.get('/list?branchId=1&checkState=ok')).json.items.map((i) => i.id), issue: (await w.get('/list?branchId=1&checkState=issue')).json.items.map((i) => i.id),
    overlay: (await w.get('/overlay?branchId=1&ids=100,101,102,103')).json })
  const strip = (s) => JSON.stringify(s, (key, value) => (key === 'version' ? undefined : value))
  // a count first, so a chip and a day exist to be disturbed
  assert.equal((await w.count([103])).status, 201)
  const before = await snapshot()
  assert.ok(before.list.summary.days.length === 1 && before.list.summary.ok === 1)
  const made = await w.issue([100, 101, 103])
  assert.equal(made.status, 201, JSON.stringify(made.json))
  const after = await snapshot()
  assert.equal(strip(after), strip(before), 'issuing a task changes no chip, date, Not checked figure or overlay')
  assert.deepEqual(w.rows("SELECT state,baseline_quantity,baseline_json,updated_at FROM inventory_check_items WHERE session_id=? ORDER BY product_id", made.json.item.id).map((r) => ({ ...r })),
    [100, 101, 103].map(() => ({ state: 'unstarted', baseline_quantity: null, baseline_json: '{}', updated_at: null })), 'the items are unstarted with no baseline')
}

/** Issue: the session, its items and one create event in one batch, no stock snapshot; replay; refusals. */
async function issueShape(w) {
  const calls = []
  const spy = (name) => { const original = w.app.env.DB[name]; w.app.env.DB[name] = (...args) => { calls.push(name); return original.apply(w.app.env.DB, args) } }
  spy('batchOnce')
  const mark = w.app.mark()
  const made = await w.issue([100, 101, 102], { title: 'Shelf A' })
  assert.equal(made.status, 201); assert.equal(made.json.created, true)
  const task = w.row('SELECT * FROM inventory_check_sessions WHERE id=?', made.json.item.id)
  assert.equal(task.status, 'open'); assert.equal(task.title, 'Shelf A'); assert.equal(task.created_by, 71)
  assert.deepEqual(JSON.parse(task.scope_json), { membership: 'task', products: 3, selection: { kind: 'ids' } })
  assert.equal(w.rows('SELECT * FROM inventory_check_items WHERE session_id=?', task.id).length, 3)
  assert.deepEqual(w.rows('SELECT action,product_id FROM inventory_check_events WHERE session_id=?', task.id).map((r) => ({ ...r })), [{ action: 'create', product_id: null }], 'one create event')
  assert.equal(w.row('SELECT COUNT(*) AS n FROM inventory_check_approvals').n, 0); assert.equal(w.row('SELECT COUNT(*) AS n FROM inventory_check_lot_lines').n, 0)
  assert.equal(calls.filter((c) => c === 'batchOnce').length, 1, 'one atomic batch')
  assert.equal(w.app.since(mark).some((sql) => /stock_schema_epoch|(INSERT INTO|UPDATE) (branch_stock|branch_batch_stock|damaged_stock_lots)/.test(sql)), false, 'no stock snapshot is read or written (the physical-schema signature and the stock guards of the other writers are absent; eligibility reads the product row and its visibility only)')
  const replay = await w.api('POST', '/tasks', { branchId: 1, requestId: made.json.receipt.requestId, productIds: [100, 101, 102], title: 'Shelf A' })
  assert.equal(replay.status, 200); assert.equal(replay.json.created, false); assert.equal(replay.json.item.id, task.id)
  const reused = await w.api('POST', '/tasks', { branchId: 1, requestId: made.json.receipt.requestId, productIds: [100, 101], title: 'Shelf A' })
  assert.equal(reused.status, 409); assert.equal(reused.json.code, 'inventory_check_request_reused')
  const refuse = async (body, status, code) => { const r = await w.api('POST', '/tasks', { branchId: 1, requestId: w.rid('x'), ...body }); assert.equal(r.status, status, JSON.stringify(r.json)); assert.equal(r.json.code, code, JSON.stringify(r.json)); return r }
  await refuse({ productIds: [] }, 400, 'inventory_check_product_ids_required')
  await refuse({ productIds: [100, 999] }, 400, 'inventory_check_product_not_eligible')
  await refuse({ productIds: [100, 200] }, 400, 'inventory_check_product_not_eligible')
  await refuse({ productIds: [100, 100] }, 400, 'inventory_check_invalid_id')
  await refuse({}, 400, 'inventory_check_invalid_request')
  await refuse({ productIds: [100], filters: {} }, 400, 'inventory_check_invalid_request')
  await refuse({ filters: { nonsense: 'x' } }, 400, 'inventory_check_invalid_request')
  await refuse({ productIds: [100], branchId: 99 }, 409, 'inventory_check_baseline_changed')
  await refuse({ productIds: [100], title: 'x'.repeat(121) }, 400, 'inventory_check_invalid_title')
}

/** Filters: resolved by the list's own search; headers dropped; over the cap refused with the total (the same number on Free and Paid). */
async function issueFilters(w) {
  w.as('admin')
  const brandA = await w.api('POST', '/tasks', { branchId: 1, requestId: w.rid('f'), filters: { brand: 'A' } })
  assert.equal(brandA.status, 201, JSON.stringify(brandA.json))
  assert.equal(brandA.json.item.progress.total, 6); assert.deepEqual(brandA.json.item.scope.selection, { kind: 'filters', filters: { brand: 'A' } })
  const family = await w.api('POST', '/tasks', { branchId: 1, requestId: w.rid('f'), filters: { brand: 'F' } })
  assert.equal(family.status, 201, JSON.stringify(family.json)); assert.equal(family.json.item.progress.total, 2, 'the family header is dropped, its two children stay')
  assert.deepEqual(w.rows('SELECT product_id FROM inventory_check_items WHERE session_id=? ORDER BY product_id', family.json.item.id).map((r) => r.product_id), [201, 202])
  const limit = (await w.board()).json.capabilities.maxProducts
  assert.equal(limit, 300)
  for (const tier of [undefined, 'free']) {
    const env = tier ? { ...w.app.env, PLAN_TIER: tier } : undefined
    const over = await w.app.send('POST', '/api/inventory-checks/tasks', { branchId: 1, requestId: w.rid('big'), filters: { brand: 'Z' } }, env)
    assert.equal(over.status, 400, JSON.stringify(over.json)); assert.equal(over.json.code, 'inventory_check_task_too_many'); assert.equal(over.json.limit, 300); assert.equal(over.json.total, 310, 'the total is the number the filter holds, so the admin can narrow it')
    const ids = Array.from({ length: 301 }, (_, i) => 300 + i)
    const list = await w.app.send('POST', '/api/inventory-checks/tasks', { branchId: 1, requestId: w.rid('big'), productIds: ids }, env)
    assert.equal(list.status, 400); assert.equal(list.json.code, 'inventory_check_task_too_many'); assert.equal(list.json.total, 301)
  }
}

/** Permissions: each new refusal. */
async function refusals(w) {
  const task = (await w.issue([100, 101])).json.item.id
  const code = async (p, status, expected) => { const r = await p; assert.equal(r.status, status, JSON.stringify(r.json)); assert.equal(r.json.code, expected, JSON.stringify(r.json)) }
  await code(w.issue([100], {}, 'checker'), 403, 'inventory_check_issue_required')
  await code(w.issue([100], {}, 'tasksOff'), 403, 'inventory_check_issue_required')
  await code(w.issue([100], {}, 'none'), 403, 'inventory_check_issue_required')
  w.as('checker'); await code(w.api('POST', '/tasks', { branchId: 1, requestId: w.rid('x'), filters: { brand: 'A' } }), 403, 'inventory_check_issue_required')
  assert.equal((await w.issue([102], {}, 'issuer')).status, 201, 'the extra alone opens issuing')
  for (const who of ['tasksOff', 'noCheck', 'none']) {
    w.as(who)
    await code(w.get('/tasks?branchId=1'), 403, 'inventory_check_tasks_required')
    await code(w.get(`/list?branchId=1&taskId=${task}`), 403, 'inventory_check_tasks_required')
    // Without the count grant the existing writers refuse first (the write needs counting); with it and tasks off, the new code answers.
    const writeCode = who === 'tasksOff' ? 'inventory_check_tasks_required' : 'inventory_check_permission_required'
    await code(w.pickup(task, who), 403, writeCode)
    await code(w.count([100], { task, who }), 403, writeCode)
  }
  assert.equal((await w.count([100], { who: 'tasksOff' })).status, 201, 'a role with tasks switched off still counts on its own')
  assert.equal((await w.pickup(task, 'checker')).status, 201)
  await code(w.release(task, 'picker2'), 403, 'inventory_check_release_forbidden')
  await code(w.release(task, 'blind'), 403, 'inventory_check_release_forbidden')
  await code(w.close(task, 'checker'), 403, 'inventory_check_owner_required')
  assert.equal((await w.close(task, 'issuer')).status, 200, 'whoever may issue closes a task they did not make')
  await code(w.pickup(task, 'picker2'), 409, 'inventory_check_task_closed')
  await code(w.pickup('no-such-task-id', 'picker2'), 404, 'inventory_check_task_not_found')
  await code(w.release('no-such-task-id', 'admin'), 404, 'inventory_check_task_not_found')
  const open = (await w.issue([103])).json.item.id
  await code(w.release(open, 'admin'), 409, 'inventory_check_task_not_picked_up')
  // A task and a pickup hold no counts of their own.
  w.as('admin'); await code(w.api('PATCH', `/sessions/${open}/items/103`, { expectedRevision: 0, expectedSessionRevision: 0, requestId: w.rid('o'), state: 'done', counted_quantity: 10 }), 409, 'inventory_check_task_not_countable')
  await code(w.api('PATCH', `/sessions/${open}`, { expectedRevision: 0, requestId: w.rid('r'), action: 'close' }), 200)
  const closedTask = (await w.issue([104])).json.item.id
  await w.close(closedTask)
  await code(w.api('PATCH', `/sessions/${closedTask}`, { expectedRevision: 1, requestId: w.rid('r'), action: 'resume' }), 409, 'inventory_check_session_final')
}

/** The one-person rule; the answer names who has it. */
async function onePerson(w) {
  const task = (await w.issue([100, 101])).json.item.id
  const first = await w.pickup(task, 'checker')
  assert.equal(first.status, 201); assert.equal(first.json.created, true)
  const pickupRow = w.row("SELECT * FROM inventory_check_sessions WHERE id=?", first.json.item.id)
  assert.deepEqual(JSON.parse(pickupRow.scope_json), { membership: 'pickup', task }); assert.equal(pickupRow.created_by, 72); assert.equal(pickupRow.status, 'open')
  assert.equal(w.row('SELECT COUNT(*) AS n FROM inventory_check_items WHERE session_id=?', pickupRow.id).n, 0, 'a pickup has no items')
  assert.deepEqual(w.rows('SELECT action FROM inventory_check_events WHERE session_id=?', pickupRow.id).map((r) => r.action), ['create'], 'one session row and one create event')
  const second = await w.pickup(task, 'picker2')
  assert.equal(second.status, 409); assert.equal(second.json.code, 'inventory_check_task_picked_up'); assert.equal(second.json.pickedUpBy, 'u72'); assert.equal(second.json.mine, false)
  const again = await w.pickup(task, 'checker'); assert.equal(again.status, 409); assert.equal(again.json.mine, true)
  const seen = await taskOf(w, task, 'picker2')
  assert.equal(seen.picked_up_by, 'u72'); assert.equal(seen.mine, false); assert.equal(seen.can_pickup, false); assert.equal(seen.can_release, false); assert.equal('pickup_session_id' in seen, false)
  const mine = await taskOf(w, task, 'checker')
  assert.equal(mine.mine, true); assert.equal(mine.can_release, true); assert.equal(mine.pickup_session_id, pickupRow.id)
  const admin = await taskOf(w, task, 'admin'); assert.equal(admin.can_release, true, 'whoever may issue can hand it back'); assert.equal(admin.can_close, true)
  assert.equal(JSON.stringify(await board(w)).includes('"created_by"'), false, 'no account id is sent')
  // replay of the pickup
  w.as('checker')
  const replay = await w.api('POST', `/tasks/${task}/pickup`, { requestId: first.json.receipt.requestId }); assert.equal(replay.status, 200); assert.equal(replay.json.created, false)
  // hand back by the picker; the task is free again
  const released = await w.release(task, 'checker'); assert.equal(released.status, 200); assert.equal(released.json.released, true)
  assert.equal(w.row('SELECT status FROM inventory_check_sessions WHERE id=?', pickupRow.id).status, 'closed')
  assert.deepEqual(w.rows('SELECT action FROM inventory_check_events WHERE session_id=? ORDER BY id', pickupRow.id).map((r) => r.action), ['create', 'close'])
  assert.equal(w.row('SELECT status FROM inventory_check_sessions WHERE id=?', task).status, 'open', 'the task stays open')
  const relReplay = await w.api('POST', `/tasks/${task}/release`, { requestId: released.json.receipt.requestId }); assert.equal(relReplay.status, 200); assert.equal(relReplay.json.receipt.replayed, true)
  assert.equal((await w.pickup(task, 'picker2')).status, 201, 'another person can pick it up now')
  const byAdmin = await w.release(task, 'admin'); assert.equal(byAdmin.status, 200, 'an administrator hands back for the picker')
}
async function board(w) { return (await w.board()).json }

/** Two people at once: the guard sits in the batch, so a competing pickup that lands between the read and the write loses. */
async function race(w) {
  const task = (await w.issue([100, 101])).json.item.id
  const original = w.app.env.DB.batchOnce
  let injected = false
  w.app.env.DB.batchOnce = (list) => {
    if (!injected && list.some((s) => /INSERT INTO inventory_check_sessions/.test(s.sql))) {
      injected = true
      w.app.raw.prepare("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at) VALUES('rival-pickup',NULL,1,80,'','open',0,?,?,?)")
        .run([JSON.stringify({ membership: 'pickup', task }), new Date().toISOString(), new Date().toISOString()])
    }
    return original(list)
  }
  const result = await w.pickup(task, 'checker')
  w.app.env.DB.batchOnce = original
  assert.equal(injected, true)
  assert.equal(result.status, 409, JSON.stringify(result.json)); assert.equal(result.json.code, 'inventory_check_task_picked_up')
  assert.equal(w.row("SELECT COUNT(*) AS n FROM inventory_check_sessions WHERE json_extract(scope_json,'$.membership')='pickup' AND json_extract(scope_json,'$.task')=? AND status='open'", task).n, 1, 'exactly one open pickup')
}

/** /list?taskId=: only the task's products; combined filters; cached; the branch and the permission. */
async function taskList(w) {
  const task = (await w.issue([100, 101, 102])).json.item.id
  const all = await w.get('/list?branchId=1'); assert.ok(all.json.items.length > 3)
  const mark = w.app.mark()
  const list = await w.get(`/list?branchId=1&taskId=${task}`)
  assert.equal(list.status, 200, JSON.stringify(list.json)); assert.deepEqual(list.json.items.map((i) => i.id).sort(), [100, 101, 102]); assert.equal(list.json.total, 3)
  assert.deepEqual(list.json.task, { id: task, status: 'open', total: 3 }); assert.equal(list.json.overlay_ids, 300, 'the overlay window cap is still sent')
  assert.ok(w.app.since(mark).length > 0)
  const warm = w.app.mark(); await w.get(`/list?branchId=1&taskId=${task}`)
  assert.equal(w.app.since(warm).filter((sql) => /inventory_check_/.test(sql)).length, 0, "a warm task list reads no task or count row (the task's ids are cached on the version)")
  assert.equal((await w.count([100])).status, 201)
  assert.deepEqual((await w.get(`/list?branchId=1&taskId=${task}&checkState=ok`)).json.items.map((i) => i.id), [100], "a task's Checked, restricted by the task")
  assert.deepEqual((await w.get(`/list?branchId=1&taskId=${task}&checkState=not_checked`)).json.items.map((i) => i.id).sort(), [101, 102], "a task's Not checked")
  assert.deepEqual((await w.get(`/list?branchId=1&taskId=${task}&query=Item 101`)).json.items.map((i) => i.id), [101], 'a search inside a task')
  const bad = async (url, status, code) => { const r = await w.get(url); assert.equal(r.status, status, JSON.stringify(r.json)); assert.equal(r.json.code, code) }
  await bad(`/list?branchId=2&taskId=${task}`, 400, 'inventory_check_invalid_query'); await bad(`/list?taskId=${task}`, 400, 'inventory_check_invalid_query')
  await bad(`/list?branchId=1&taskId=nope`, 404, 'inventory_check_task_not_found'); await bad(`/list?branchId=1&taskId=${task}&ids=100`, 400, 'inventory_check_invalid_query')
  await bad(`/list?branchId=1&taskId=bad%20id`, 400, 'inventory_check_invalid_query')
}

/** The DONE RULE. */
async function doneRule(w) {
  const done = async (id) => (await taskOf(w, id)).done
  assert.equal((await w.count([100])).status, 201, 'a count made before the task is issued')
  await sleep(6)
  const task = (await w.issue([100, 101, 102, 103])).json.item.id
  assert.equal(await done(task), 0, 'a count made before the issue does not tick the product')
  await sleep(6)
  assert.equal((await w.count([101])).status, 201, 'a count outside the task')
  assert.equal(await done(task), 1, 'a count outside the task ticks it')
  assert.equal((await w.count([{ productId: 102, countedQuantity: 9, seenQuantity: 10 }], { task })).status, 201, 'a count that differs inside the task')
  assert.equal(await done(task), 2, 'Differs counts as done')
  assert.equal((await w.count([103], { who: 'admin', branchId: 2 })).status, 201, 'a count at another branch')
  assert.equal(await done(task), 2, 'another branch does not tick it')
  // a count in an open session is not final: it ticks nothing until the session closes
  w.as('checker')
  const session = await w.api('POST', '/sessions', { branchId: 1, requestId: w.rid('s'), productIds: [103], scope: { membership: 'visible_page' } })
  assert.equal(session.status, 201, JSON.stringify(session.json))
  const observed = await w.api('PATCH', `/sessions/${session.json.item.id}/items/103`, { expectedRevision: 0, expectedSessionRevision: 0, requestId: w.rid('o'), state: 'done', counted_quantity: 10 })
  assert.equal(observed.status, 200, JSON.stringify(observed.json))
  assert.equal(await done(task), 2, 'a count in an open session ticks nothing yet')
  assert.equal((await w.api('PATCH', `/sessions/${session.json.item.id}`, { expectedRevision: 0, requestId: w.rid('c'), action: 'close' })).status, 200)
  assert.equal(await done(task), 3, 'once the session closes its count is final and ticks the task')
  assert.equal((await taskOf(w, task)).status, 'open', 'three of four products: the task stays open')
  // the rule is "at or after the issue": a final count stamped in the very millisecond the task was issued ticks it
  const t2 = (await w.issue([104, 105])).json.item.id
  rawCount(w, { id: 'same-ms', product: 104, at: w.row('SELECT started_at FROM inventory_check_sessions WHERE id=?', t2).started_at })
  assert.equal(await done(t2), 1, 'a count at the issue time ticks the product')
  rawCount(w, { id: 'before-ms', product: 105, at: new Date(Date.parse(w.row('SELECT started_at FROM inventory_check_sessions WHERE id=?', t2).started_at) - 1).toISOString() })
  assert.equal(await done(t2), 1, 'a count one millisecond before it does not')
}
/** A FINAL count (a closed session with one done item stamped `at`), written straight into the tables. */
function rawCount(w, { id, org = null, branch = 1, product, at, state = 'done' }) {
  w.app.raw.prepare("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at) VALUES(?,?,?,71,'','closed',0,?,?,?,?)").run([id, org, branch, JSON.stringify({ membership: 'submission' }), at, at, at])
  w.app.raw.prepare("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,revision,updated_by,updated_at) VALUES(?,?,?,'{}',10,'{}',?,10,1,71,?)").run([id, product, branch, state, at])
}

/** The auto-close, in both submission writers; replay; later counts. */
async function autoClose(w, { lotWriter = true } = {}) {
  const task = (await w.issue([100, 101])).json.item.id
  const pickup = (await w.pickup(task)).json.item.id
  if (!lotWriter) w.app.setSwitch('ic_wired', undefined)
  const first = await w.count([100], { task })
  assert.equal(first.status, 201, JSON.stringify(first.json)); assert.deepEqual(first.json.task, { id: task, closed: false })
  assert.equal(w.row('SELECT status FROM inventory_check_sessions WHERE id=?', task).status, 'open')
  const counted = { productId: 101, countedQuantity: 10, seenQuantity: 10 }
  const last = await w.count([counted], { task })
  assert.equal(last.status, 201, JSON.stringify(last.json)); assert.deepEqual(last.json.task, { id: task, closed: true })
  const closed = w.row('SELECT * FROM inventory_check_sessions WHERE id=?', task)
  assert.equal(closed.status, 'closed'); assert.equal(closed.closed_at, last.json.item.started_at, 'closed in the submission that counted the last product'); assert.equal(closed.revision, 1)
  assert.equal(w.row('SELECT status FROM inventory_check_sessions WHERE id=?', pickup).status, 'closed', 'the pickup closes with it')
  assert.deepEqual(w.rows("SELECT action,session_id FROM inventory_check_events WHERE action='close' ORDER BY id").map((r) => r.session_id).sort(), [pickup, task].sort())
  assert.equal(JSON.parse(w.row("SELECT after_json FROM inventory_check_events WHERE session_id=? AND action='close'", task).after_json).auto, 1)
  const replay = await w.api('POST', '/submissions', { branchId: 1, requestId: last.json.receipt.requestId, taskId: task, lines: [counted] })
  assert.equal(replay.status, 200); assert.equal(replay.json.created, false); assert.equal(w.rows("SELECT * FROM inventory_check_events WHERE action='close'").length, 2, 'a replay closes nothing again')
  w.app.setSwitch('ic_wired', 'on')
  const view = await taskOf(w, task); assert.equal(view.status, 'closed'); assert.equal(view.done, 2); assert.equal(view.total, 2); assert.equal(view.can_close, false); assert.equal(view.can_pickup, false)
  const later = await w.count([100], { task }); assert.equal(later.status, 201, 'a count of a closed task is still recorded'); assert.equal(later.json.task.closed, false)
  assert.equal((await w.pickup(task, 'picker2')).status, 409)
  const items = w.rows('SELECT scope_json FROM inventory_check_sessions WHERE id IN (?,?)', first.json.item.id, last.json.item.id).map((r) => JSON.parse(r.scope_json))
  assert.deepEqual(items, [{ membership: 'submission', task }, { membership: 'submission', task }], 'the task is stored in the new closed session scope')
}

/** Manual close by the issue permission closes the pickup too; a submission naming a task that does not exist is refused whole. */
async function manualClose(w) {
  const task = (await w.issue([100, 101])).json.item.id
  const pickup = (await w.pickup(task)).json.item.id
  const closed = await w.close(task, 'admin'); assert.equal(closed.status, 200, JSON.stringify(closed.json))
  assert.equal(w.row('SELECT status FROM inventory_check_sessions WHERE id=?', pickup).status, 'closed')
  assert.deepEqual(w.rows('SELECT action FROM inventory_check_events WHERE session_id=? ORDER BY id', pickup).map((r) => r.action), ['create', 'close'])
  assert.equal(w.rows("SELECT * FROM inventory_check_events WHERE session_id=? AND action='close'", task).length, 1)
  const before = w.row('SELECT COUNT(*) AS n FROM inventory_check_sessions').n
  const unknown = await w.count([100], { task: 'no-such-task' }); assert.equal(unknown.status, 404); assert.equal(unknown.json.code, 'inventory_check_task_not_found')
  assert.equal(w.row('SELECT COUNT(*) AS n FROM inventory_check_sessions').n, before, 'nothing was recorded')
  w.as('admin')
  const other = (await w.api('POST', '/tasks', { branchId: 2, requestId: w.rid('i'), productIds: [100] })).json.item.id
  const wrongBranch = await w.count([100], { task: other }); assert.equal(wrongBranch.status, 404, 'a task of another branch is not found')
  const sameId = w.rid('same'); as0(w)
  const a = await w.api('POST', '/submissions', { branchId: 1, requestId: sameId, taskId: task, lines: [{ productId: 102, countedQuantity: 10, seenQuantity: 10 }] }); assert.equal(a.status, 201)
  const b = await w.api('POST', '/submissions', { branchId: 1, requestId: sameId, lines: [{ productId: 102, countedQuantity: 10, seenQuantity: 10 }] }); assert.equal(b.status, 409); assert.equal(b.json.code, 'inventory_check_request_reused', 'the task is part of the request')
  const badType = await w.api('POST', '/submissions', { branchId: 1, requestId: w.rid('t'), taskId: 5, lines: [{ productId: 102, countedQuantity: 10, seenQuantity: 10 }] }); assert.equal(badType.status, 400)
}
function as0(w) { w.as('checker') }

/** Count sessions: task rows stay out; a pickup shows as the picker's with its task's title and progress; Mine. */
async function sessionsList(w) {
  const task = (await w.issue([100, 101, 102], { title: 'Shelf A' })).json.item.id
  const pickup = (await w.pickup(task)).json.item.id
  await w.count([100], { task, who: 'checker' })
  w.as('checker')
  const mine = (await w.get('/sessions?mine=1')).json
  assert.equal(mine.items.some((s) => s.id === task), false, 'the task row is not in the list')
  const p = mine.items.find((s) => s.id === pickup); assert.ok(p, 'the pickup shows as the picker\'s session')
  assert.deepEqual(p.task, { id: task, title: 'Shelf A', status: 'open', total: 3, done: 1 }); assert.equal(p.title, 'Shelf A'); assert.equal(p.status, 'open')
  w.as('admin'); const all = (await w.get('/sessions?pageSize=100')).json
  assert.equal(all.items.some((s) => s.scope.membership === 'task'), false); assert.equal(all.total, all.items.length, 'the total does not count task rows')
  assert.equal(all.items.filter((s) => s.id === pickup).length, 1)
  w.as('picker2'); assert.equal((await w.get('/sessions?mine=1')).json.items.some((s) => s.id === pickup), false, 'not on another person\'s Mine')
}

/** The cache: a warm Tasks open reads nothing; a writer moves it; the numbers change with the count. */
async function boardCache(w) {
  await w.app.bumpProducts()
  const task = (await w.issue([100, 101])).json.item.id
  const cold = w.app.mark(); const first = await w.board(); const coldReads = w.app.since(cold).length
  assert.ok(coldReads >= 1 && first.status === 200)
  const warm = w.app.mark(); const second = await w.board(); assert.equal(w.app.since(warm).length, 0, 'an unchanged open reads nothing'); assert.deepEqual(second.json, first.json)
  const other = w.app.mark(); await w.board('checker'); assert.equal(w.app.since(other).length, 0, 'another viewer shares the entry')
  await w.count([100])
  const after = await w.board(); assert.equal(after.json.items.find((i) => i.id === task).done, 1, 'a count moves the version, so the done count is fresh')
  assert.equal(after.json.version === first.json.version, false)
  assert.equal((await w.board('admin', 2)).json.items.length, 0, 'another branch has its own board')
  assert.equal((await w.get('/tasks')).status, 400)
}

/**
 * THE COST of each route on the Free plan, as D1 calls (a round trip: one prepared statement, or one batch however many statements it holds) and table rows written (total_changes()).
 * Each ceiling is the measured figure (scripts/measure-inventory-check-tasks.cjs, 300 products: issue 9 calls / 302 rows, GET /tasks 1 call cold and 0 warm, pickup 6 / 2, release 9 / 2, a submission 9 / the same as without a task,
 * the one that completes a task +4 rows and +0 calls, close 6 / 4) with no headroom beyond what the reason says. Far under the Free 50 calls per request. Rows READ are not measured by this in-memory engine: the plans are pinned in
 * test-migration-0318-inventory-check-task-index-pure.cjs and the reads in the contract.
 */
async function budget(w) {
  let calls = 0
  for (const name of ['prepare', 'batch', 'batchOnce']) { const original = w.app.env.DB[name]; w.app.env.DB[name] = (...args) => { calls++; return original.apply(w.app.env.DB, args) } }
  const changes = () => Number(w.app.raw.db.prepare('SELECT total_changes() AS n').get().n)
  const cost = async (run) => { const c = calls, r = changes(), answer = await run(); return { calls: calls - c, rows: changes() - r, answer } }
  const ids = Array.from({ length: 70 }, (_, i) => 300 + i)
  w.as('admin')
  const issue = await cost(() => w.api('POST', '/tasks', { branchId: 1, requestId: w.rid('b'), productIds: ids.slice(0, 30) }))
  assert.equal(issue.answer.status, 201); const task = issue.answer.json.item.id
  assert.ok(issue.calls <= 10, `issue: ${issue.calls} calls (one batch, no stock snapshot; the others are the actor, the receipt, the products, the receipt after and the projection)`)
  assert.equal(issue.rows, 30 + 2, 'issue writes the session, one row per product and one event')
  w.app.clearCaches(); const cold = await cost(() => w.board()); const warm = await cost(() => w.board())
  assert.ok(cold.calls === 1, `GET /tasks cold: ${cold.calls} calls (one statement cuts the page and counts it)`); assert.equal(warm.calls, 0, 'GET /tasks warm: nothing is read'); assert.equal(cold.rows + warm.rows, 0)
  w.app.clearCaches(); const plainCold = await cost(() => w.get('/list?branchId=1&pageSize=50')); const plainWarm = await cost(() => w.get('/list?branchId=1&pageSize=50'))
  w.app.clearCaches(); const taskCold = await cost(() => w.get(`/list?branchId=1&pageSize=50&taskId=${task}`)); const taskWarm = await cost(() => w.get(`/list?branchId=1&pageSize=50&taskId=${task}`))
  assert.ok(taskCold.calls <= plainCold.calls + 2, `task list cold ${taskCold.calls} vs the plain list ${plainCold.calls}: +1 for the task's ids (+1 for the version fallback)`)
  assert.ok(taskWarm.calls <= plainWarm.calls, `task list warm ${taskWarm.calls} vs the plain list ${plainWarm.calls}: the task adds nothing`)
  const pick = await cost(() => w.pickup(task, 'checker')); assert.equal(pick.answer.status, 201); assert.ok(pick.calls <= 7, `pickup ${pick.calls} calls`); assert.equal(pick.rows, 2, 'pickup: one session row and one create event')
  const rel = await cost(() => w.release(task, 'checker')); assert.equal(rel.answer.status, 200); assert.ok(rel.calls <= 10, `release ${rel.calls} calls (the close writer)`); assert.equal(rel.rows, 2, 'release: the session update and one close event')
  await w.pickup(task, 'checker')
  const lines = (from, to) => ids.slice(from, to).map((productId) => ({ productId, countedQuantity: 10, seenQuantity: 10 }))
  const named = await cost(() => w.count(lines(0, 10), { task })); const plain = await cost(() => w.count(lines(10, 20)))
  assert.equal(named.answer.status, 201); assert.equal(plain.answer.status, 201)
  assert.equal(named.calls, plain.calls, 'naming a task adds no call to a submission (its statements ride the same batch)'); assert.equal(named.rows, plain.rows, 'and no row while the task is not complete')
  await w.count(lines(20, 29))
  const finishing = await cost(() => w.count(lines(29, 30), { task })); assert.equal(finishing.answer.json.task.closed, true)
  const base = await cost(() => w.count(lines(30, 31)))
  assert.equal(finishing.calls, base.calls, 'the submission that completes a task costs no more calls'); assert.equal(finishing.rows, base.rows + 4, 'and four more rows: the task and its pickup closed, each with a close event')
  const second = (await w.issue(ids.slice(40, 50))).json.item.id; await w.pickup(second, 'checker')
  const closing = await cost(() => w.close(second)); assert.equal(closing.answer.status, 200); assert.ok(closing.calls <= 7, `close ${closing.calls} calls`); assert.equal(closing.rows, 4, 'close: the task and its pickup, each with a close event')
  // Every count writer, with no task open and then with a task THIS write completes (counted outside the task): the calls are the same, the rows are +4 (the task and its pickup closed, each with a close event).
  const writerCost = {}
  let product = 330
  for (const writer of ['lot', 'plain', 'observe']) {
    const none = (await countBy(w, writer, product++, { around: cost })).measured
    const first = product++, last = product++
    const t = (await w.issue([first, last])).json.item.id; await w.pickup(t, 'checker')
    await sleep(3); await countBy(w, writer, first)
    const completing = await countBy(w, writer, last, { around: cost })
    assert.deepEqual(completing.answer.closedTasks, [t], `${writer}: the write closed the task`)
    writerCost[writer] = { none: { calls: none.calls, rows: none.rows }, completing: { calls: completing.measured.calls, rows: completing.measured.rows } }
  }
  // The PINNED numbers (the writer's own request, the actor and receipt reads included). With no task open and with a task this very write completes the CALLS are the same (the auto-close rides the writer's batch); the completing write
  // adds exactly four rows: the task and its pickup closed, each with a close event.
  console.log('     writer cost:', JSON.stringify(writerCost))
  assert.deepEqual(writerCost, PINNED_WRITER_COST, 'the cost of every count writer, with no task and with a task it completes')
  for (const writer of Object.keys(writerCost)) { assert.equal(writerCost[writer].completing.calls, writerCost[writer].none.calls, `${writer}: completing a task adds no D1 call`); assert.equal(writerCost[writer].completing.rows, writerCost[writer].none.rows + 4, `${writer}: and four rows`) }
  w.app.clearCaches(); w.as('checker'); const mine = await cost(() => w.get('/sessions?mine=1')); assert.ok(mine.calls <= 6, `Count sessions with a pickup: ${mine.calls} calls (the sessions list, the board and the actor reads)`)
}

// ---- round 2: the task closes itself on EVERY count writer; the cap; task rows are written only by the task writers ---------------------------------------------------------------------------
/** A task row of another organization (or by a user who may no longer issue), written straight into the tables: the shape the writers must leave alone. */
function rawTask(w, { id, org = null, branch = 1, creator = 83, products, status = 'open' }) {
  const at = new Date().toISOString()
  w.app.raw.prepare("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at) VALUES(?,?,?,?,'',?,0,?,?,?)")
    .run([id, org, branch, creator, status, JSON.stringify({ membership: 'task', products: products.length, selection: { kind: 'ids' } }), at, at])
  for (const p of products) w.app.raw.prepare("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json) VALUES(?,?,?,'{}',NULL,'{}')").run([id, p, branch])
}
/** One count of one product by the named writer: 'lot' (the wired submission), 'plain' (the older submission), 'observe' (an observation in an ordinary open session). `at` is the time the write recorded. */
async function countBy(w, writer, productId, { branchId = 1, who = 'checker', state = 'done', around = null } = {}) {
  if (writer === 'observe') {
    w.as(who)
    const made = await w.api('POST', '/sessions', { branchId, requestId: w.rid('s'), productIds: [productId], scope: { membership: 'visible_page' } })
    assert.equal(made.status, 201, JSON.stringify(made.json))
    const body = state === 'issue' ? { state: 'issue', reason: 'short', counted_quantity: 9 } : { state: 'done', counted_quantity: 10 }
    const requestId = w.rid('o')
    w.as(who)
    const seen = await w.api('PATCH', `/sessions/${made.json.item.id}/items/${productId}`, { expectedRevision: 0, expectedSessionRevision: 0, requestId, ...body })
    assert.equal(seen.status, 200, JSON.stringify(seen.json))
    const closeId = w.rid('c')
    // the close makes the count final: it is the count writer here
    const send = () => { w.as(who); return w.api('PATCH', `/sessions/${made.json.item.id}`, { expectedRevision: 0, requestId: closeId, action: 'close' }) }
    const measured = around ? await around(send) : null, r = measured ? measured.answer : await send()
    assert.equal(r.status, 200, JSON.stringify(r.json))
    return { answer: r.json, at: r.json.item.closed_at, replay: send, measured }
  }
  {
    const requestId = w.rid('sub'), line = { productId, countedQuantity: state === 'issue' ? 9 : 10, seenQuantity: 10 }
    // the older writer answers while ic_wired is OFF, a replay included (the action is part of the request's identity)
    const send = async () => { w.as(who); if (writer === 'plain') w.app.setSwitch('ic_wired', undefined); try { return await w.api('POST', '/submissions', { branchId, requestId, lines: [line] }) } finally { if (writer === 'plain') w.app.setSwitch('ic_wired', 'on') } }
    const measured = around ? await around(send) : null, r = measured ? measured.answer : await send()
    assert.equal(r.status, 201, JSON.stringify(r.json))
    return { answer: r.json, at: r.json.item.started_at, replay: send, measured }
  }
}
const status = (w, id) => w.row('SELECT status FROM inventory_check_sessions WHERE id=?', id).status
const closeEvents = (w, id) => w.rows("SELECT request_id,after_json FROM inventory_check_events WHERE session_id=? AND action='close' ORDER BY id", id)

/** A count made OUTSIDE the task by this writer completes it: the task closes with its event and its pickup closes too; the answer names it; a replay closes nothing again. */
async function outsideClose(w, writer) {
  const task = (await w.issue([100, 101])).json.item.id
  const pickup = (await w.pickup(task)).json.item.id
  await sleep(4)
  const first = await countBy(w, writer, 100)
  assert.equal('closedTasks' in first.answer, false, 'the first product leaves the task open and the answer names nothing')
  assert.equal(status(w, task), 'open'); assert.equal(status(w, pickup), 'open')
  const last = await countBy(w, writer, 101, { state: writer === 'observe' ? 'issue' : 'done' })
  assert.deepEqual(last.answer.closedTasks, [task], 'the answer names the task the write closed')
  const closed = w.row('SELECT * FROM inventory_check_sessions WHERE id=?', task)
  assert.equal(closed.status, 'closed'); assert.equal(closed.closed_at, last.at, 'closed in the write that counted the last product'); assert.equal(closed.updated_at, last.at); assert.equal(closed.revision, 1)
  const picked = w.row('SELECT * FROM inventory_check_sessions WHERE id=?', pickup)
  assert.equal(picked.status, 'closed', 'the pickup closes with it'); assert.equal(picked.closed_at, last.at); assert.equal(picked.revision, 1)
  assert.equal(closeEvents(w, task).length, 1, 'one close event on the task'); assert.equal(JSON.parse(closeEvents(w, task)[0].after_json).auto, 1)
  assert.equal(closeEvents(w, pickup).length, 1, 'one close event on the pickup'); assert.equal(JSON.parse(closeEvents(w, pickup)[0].after_json).task, task)
  const view = await taskOf(w, task); assert.equal(view.status, 'closed'); assert.equal(view.done, 2); assert.equal(view.total, 2)
  const again = await last.replay(); assert.equal(again.status, 200); assert.equal('closedTasks' in again.json, false, 'a replay closes nothing and names nothing')
  assert.equal(closeEvents(w, task).length + closeEvents(w, pickup).length, 2, 'no second close event on the task or its pickup')
  // the close event says which session closed the task (a later ruling on a count that is taken back needs it)
  assert.equal(JSON.parse(closeEvents(w, task)[0].after_json).closedBy, last.answer.item.id, 'the task close event names the session whose counts closed it')
  // F6: a LATER final count of a closed task's product closes nothing and writes no second close event into the immutable history
  await sleep(4)
  const later = await countBy(w, writer, 100)
  assert.equal('closedTasks' in later.answer, false, 'a later count names no closed task')
  assert.equal(closeEvents(w, task).length, 1, 'still one close event on the closed task'); assert.equal(closeEvents(w, pickup).length, 1, 'and one on its pickup')
}
/** A count that leaves a product undone closes nothing; another branch's task and another organization's task are never touched, however complete the count makes them look. */
async function outsideNegatives(w, writer) {
  const a = (await w.issue([100, 101, 102])).json.item.id
  const apickup = (await w.pickup(a)).json.item.id
  w.as('admin'); const other = (await w.api('POST', '/tasks', { branchId: 2, requestId: w.rid('i'), productIds: [100, 101, 102] })).json.item.id
  rawTask(w, { id: 'org2-task', org: 2, products: [100, 101, 102] })
  await sleep(4)
  await countBy(w, writer, 100); await countBy(w, writer, 101)
  assert.equal(status(w, a), 'open', 'the highest product is still undone: the task stays open'); assert.equal(status(w, apickup), 'open')
  const done = await countBy(w, writer, 102)
  assert.deepEqual(done.answer.closedTasks, [a], 'only the task of this organization and branch closes')
  assert.equal(status(w, a), 'closed'); assert.equal(status(w, apickup), 'closed')
  assert.equal(status(w, other), 'open', "another branch's task is untouched"); assert.equal(closeEvents(w, other).length, 0)
  assert.equal(status(w, 'org2-task'), 'open', "another organization's task is untouched"); assert.equal(closeEvents(w, 'org2-task').length, 0)
  assert.equal((await w.board('admin', 2)).json.items.find((t) => t.id === other).done, 0, 'a count at another branch does not tick it')
  // one write completes two tasks of the branch, and the answer names both
  const b = (await w.issue([103])).json.item.id, c = (await w.issue([103, 104])).json.item.id
  await sleep(4)
  const bothPart = await countBy(w, writer, 104); assert.equal('closedTasks' in bothPart.answer, false)
  const both = await countBy(w, writer, 103); assert.deepEqual([...both.answer.closedTasks].sort(), [b, c].sort(), 'both tasks close in one write')
  assert.equal(closeEvents(w, b).length, 1); assert.equal(closeEvents(w, c).length, 1)
}
/**
 * A count in an OPEN session is not final (it can be set back until the session closes: owner, "counts reach the server on Submit"), so it ticks no task and closes none. Closing the session makes its counts final: then it ticks,
 * and the close is a count writer that closes the tasks it completes. A count withdrawn before the close never ticks anything.
 */
async function observationNotFinal(w) {
  const task = (await w.issue([100, 101])).json.item.id
  await sleep(4)
  w.as('checker')
  const made = await w.api('POST', '/sessions', { branchId: 1, requestId: w.rid('s'), productIds: [100, 101], scope: { membership: 'visible_page' } })
  const sid = made.json.item.id
  const observe = (product, expected, body) => w.api('PATCH', `/sessions/${sid}/items/${product}`, { expectedRevision: expected, expectedSessionRevision: 0, requestId: w.rid('o'), ...body })
  const done = { state: 'done', counted_quantity: 10 }
  for (const product of [100, 101]) { const r = await observe(product, 0, done); assert.equal(r.status, 200); assert.equal('closedTasks' in r.json, false, 'an observation closes no task') }
  assert.equal((await taskOf(w, task)).done, 0, 'counts in an open session tick nothing'); assert.equal(status(w, task), 'open', 'and the task stays open though every product is counted there')
  const withdrawn = await observe(101, 1, { state: 'unstarted' }); assert.equal(withdrawn.status, 200)
  assert.equal(status(w, task), 'open'); assert.equal((await taskOf(w, task)).done, 0)
  const again = await observe(101, 2, done); assert.equal(again.status, 200)
  const closed = await w.api('PATCH', `/sessions/${sid}`, { expectedRevision: 0, requestId: w.rid('c'), action: 'close' })
  assert.equal(closed.status, 200, JSON.stringify(closed.json)); assert.deepEqual(closed.json.closedTasks, [task], 'closing the session makes its counts final and closes the task they complete')
  assert.equal(status(w, task), 'closed')
  // a session with an unstarted item makes final only what was counted
  const task2 = (await w.issue([102, 103])).json.item.id
  await sleep(4)
  w.as('checker')
  const s2 = (await w.api('POST', '/sessions', { branchId: 1, requestId: w.rid('s'), productIds: [102, 103], scope: { membership: 'visible_page' } })).json.item.id
  await w.api('PATCH', `/sessions/${s2}/items/102`, { expectedRevision: 0, expectedSessionRevision: 0, requestId: w.rid('o'), ...done })
  const partial = await w.api('PATCH', `/sessions/${s2}`, { expectedRevision: 0, requestId: w.rid('c'), action: 'close' })
  assert.equal(partial.status, 200); assert.equal('closedTasks' in partial.json, false); assert.equal((await taskOf(w, task2)).done, 1, 'the counted product ticks once its session is closed'); assert.equal(status(w, task2), 'open')
  // resuming a closed count session takes its counts out of the done count again (the task is still open, so it follows)
  const resumed = await w.api('PATCH', `/sessions/${s2}`, { expectedRevision: 1, requestId: w.rid('r'), action: 'resume' })
  assert.equal(resumed.status, 200); assert.equal((await taskOf(w, task2)).done, 0, 'a resumed session counts nothing until it closes again')
}

/** A task changes nothing the older (ic_simple) list shows: its rows, its summary and its check-state views are the same before and after issuing. */
async function olderListUnaffected(w) {
  w.as('checker')
  assert.equal((await w.count([103])).status, 201); assert.equal((await w.count([{ productId: 104, countedQuantity: 9, seenQuantity: 10 }])).status, 201)
  const open = await w.api('POST', '/sessions', { branchId: 1, requestId: w.rid('s'), productIds: [105], scope: { membership: 'visible_page' } }); assert.equal(open.status, 201)
  w.app.setSwitch('ic_wired', undefined)
  const urls = ['/api/inventory-checks/products?branchId=1', '/api/inventory-checks/products?branchId=1&checkState=in_check', '/api/inventory-checks/products?branchId=1&checkState=issue', '/api/inventory-checks/products?branchId=1&checkState=ok',
    '/api/inventory-checks/products?branchId=1&checkState=not_checked', '/api/inventory-checks/products?checkState=issue', '/api/inventory-checks/products?checkState=in_check']
  const snapshot = async () => { w.app.clearCaches(); w.as('admin'); const out = []; for (const url of urls) { const r = await w.app.get(url); assert.equal(r.status, 200, `${url}: ${JSON.stringify(r.json)}`); out.push(r.json) } return JSON.stringify(out, (key, value) => (key === 'version' ? undefined : value)) }
  const before = await snapshot()
  assert.ok(JSON.parse(before)[0].summary, 'the list carries a summary'); assert.ok(JSON.parse(before)[0].items.some((i) => i.check_status === 'in_check'), 'a product of an open session is in check')
  w.app.setSwitch('ic_wired', 'on'); w.as('admin')
  const made = await w.issue([100, 101, 103, 104, 105]); assert.equal(made.status, 201)
  w.app.setSwitch('ic_wired', undefined)
  assert.equal(await snapshot(), before, 'issuing a task changes no row, chip or view of the older list')
  w.as('admin'); const inCheck = await w.app.get('/api/inventory-checks/products?branchId=1&checkState=in_check'); assert.deepEqual(inCheck.json.items.map((i) => i.id), [105], 'only the open session puts a product in check')
}

/** The done rule is per organization: another organization's counts never tick this one's task, and this one's never tick theirs. */
async function doneRuleOrg(w) {
  const mine = (await w.issue([100, 101])).json.item.id
  rawTask(w, { id: 'org2-task', org: 2, products: [100, 101] })
  await sleep(4)
  const at = new Date().toISOString()
  // another organization's FINAL counts of the same products at the same branch, written straight into the tables
  w.app.raw.prepare("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at) VALUES('org2-count',2,1,83,'','closed',0,?,?,?,?)").run([JSON.stringify({ membership: 'submission' }), at, at, at])
  for (const p of [100, 101]) w.app.raw.prepare("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,revision,updated_by,updated_at) VALUES('org2-count',?,1,'{}',10,'{}','done',10,1,83,?)").run([p, at])
  assert.equal((await taskOf(w, mine)).done, 0, "another organization's counts do not tick this organization's task")
  // and a count of this organization, final, completes only this organization's task
  const last = await countBy(w, 'lot', 100); await countBy(w, 'lot', 101)
  assert.equal(status(w, mine), 'closed'); assert.equal(status(w, 'org2-task'), 'open', "this organization's counts do not close another's task"); assert.equal(closeEvents(w, 'org2-task').length, 0)
  assert.ok(last)
}

/** A product that can no longer be counted (deactivated with no stock, merged away, a header) leaves the task: not in `total` or `done`, counted in `removed`, and it no longer blocks the auto-close. */
async function removedProducts(w) {
  const stockWrite = (fn) => w.app.seedStockFixture(w.app.raw.db, fn)
  const retire = (id) => stockWrite(() => { w.app.raw.prepare('UPDATE branch_stock SET quantity=0 WHERE product_id=?').run([id]); w.app.raw.prepare('UPDATE products SET stock_quantity=0 WHERE id=?').run([id]); w.app.raw.prepare('UPDATE products SET is_active=0 WHERE id=?').run([id]) })
  const task = (await w.issue([100, 101, 102, 103])).json.item.id
  const view = async () => { w.app.clearCaches(); return taskOf(w, task) }
  let v = await view(); assert.deepEqual([v.total, v.done, v.removed], [4, 0, 0])
  w.app.raw.exec('PRAGMA foreign_keys=OFF')
  retire(101) // deactivated
  retire(102) // merged away: the merge moved its stock to the surviving product and retired the row
  v = await view(); assert.deepEqual([v.total, v.done, v.removed], [2, 0, 2], 'the retired products leave total and done and are counted in removed')
  await sleep(4)
  await countBy(w, 'lot', 100)
  v = await view(); assert.deepEqual([v.total, v.done, v.removed], [2, 1, 2]); assert.equal(status(w, task), 'open')
  const last = await countBy(w, 'plain', 103)
  assert.deepEqual(last.answer.closedTasks, [task], 'the products that can no longer be counted do not block the close'); assert.equal(status(w, task), 'closed')
  // a product that became a family header (a child was added under it) is uncountable too
  const t2 = (await w.issue([104, 105])).json.item.id
  w.app.raw.prepare('UPDATE products SET is_group=1 WHERE id=105').run(); w.app.raw.prepare("UPDATE products SET parent_id=105,name='Item 105',name_key=(SELECT name_key FROM products WHERE id=105) WHERE id=106").run()
  w.app.clearCaches(); const v2 = await taskOf(w, t2); assert.equal(v2.removed, 1); assert.equal(v2.total, 1)
  w.app.raw.exec('PRAGMA foreign_keys=ON')
}

/** Issue by filter over families: a page holds 100 FAMILIES with all their countable children, so the reader's total (families) is not the number of rows. 120 families of 2 children: 240 products. */
async function issueFilterFamilies(w) {
  w.as('admin')
  const made = await w.api('POST', '/tasks', { branchId: 1, requestId: w.rid('f'), filters: { brand: 'Q' } })
  assert.equal(made.status, 201, JSON.stringify(made.json)); assert.equal(made.json.item.progress.total, 240, 'every countable child of every family, not the first page of them')
  assert.equal(w.row("SELECT COUNT(*) AS n FROM inventory_check_items WHERE session_id=?", made.json.item.id).n, 240)
  const over = await w.api('POST', '/tasks', { branchId: 1, requestId: w.rid('f'), filters: { brand: 'R' } })
  assert.equal(over.status, 400, JSON.stringify(over.json)); assert.equal(over.json.code, 'inventory_check_task_too_many'); assert.equal(over.json.total, 320, 'the total is the number of countable rows (160 families of 2), not the family count'); assert.equal(over.json.limit, 300)
}

/** The countable products of a list under a query string, as the wired list shows them: every page, headers left out. */
async function listedProducts(w, query) {
  const ids = []
  w.as('admin'); w.app.clearCaches()
  for (let page = 1; page <= 10; page++) {
    const answer = (await w.get(`/list?branchId=1&${query}&pageSize=100&page=${page}`)).json
    for (const item of answer.items || []) if (!Number(item.is_group)) ids.push(Number(item.id))
    if (!(answer.items || []).length || page * 100 >= Number(answer.total || 0)) break
  }
  return [...new Set(ids)].sort((a, b) => a - b)
}
const issuedProducts = (w, id) => w.rows('SELECT product_id FROM inventory_check_items WHERE session_id=? ORDER BY product_id', id).map((r) => r.product_id)
const queryOf = (filters) => Object.entries(filters).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')

/** N1 (round 7): a text filter that matches a family through its header issues the family's countable children, exactly as the list shows them; mixed filters keep every child. */
async function issueFilterHeaderChildren(w) {
  w.as('admin')
  const cases = [
    ['query=summer', { query: 'summer' }, [601, 602, 603, 611, 612]],
    ['query=summer and brand S (the headers and the dress are brand S, the children K)', { query: 'summer', brand: 'S' }, [601, 602, 603, 611, 612]],
    ['query=set (one header, its two children)', { query: 'set' }, [601, 602]],
    ['query=red (a child itself matches: the list adds its sibling, as it always does)', { query: 'red' }, [601, 602]],
  ]
  for (const [label, filters, expected] of cases) {
    assert.deepEqual(await listedProducts(w, queryOf(filters)), expected, `${label}: the list shows these products`)
    w.as('admin'); w.app.clearCaches()
    const made = await w.api('POST', '/tasks', { branchId: 1, requestId: w.rid('hc'), filters })
    assert.equal(made.status, 201, `${label}: ${JSON.stringify(made.json)}`)
    assert.deepEqual(issuedProducts(w, made.json.item.id), expected, `${label}: the task holds what the list shows`)
  }
}

/** N2 (round 7): a filter that resolves to nothing countable answers the contract's product_not_eligible, and issues nothing. */
async function issueFilterNothing(w) {
  w.as('admin')
  for (const filters of [{ brand: 'Nope' }, { query: 'summer', brand: 'K' }, { query: 'bare' }, { query: 'ghost' }]) {
    const made = await w.api('POST', '/tasks', { branchId: 1, requestId: w.rid('none'), filters })
    assert.equal(made.status, 400, JSON.stringify(made.json)); assert.equal(made.json.code, 'inventory_check_product_not_eligible', JSON.stringify(filters))
  }
  assert.equal(w.row("SELECT COUNT(*) AS n FROM inventory_check_sessions WHERE json_extract(scope_json,'$.membership')='task'").n, 0, 'nothing was issued')
}

/** N3 (round 7): a filter with a check state or a day issues what the same list shows under it (the leaf rule never replaces the check restriction). */
async function issueFilterCheckState(w) {
  assert.equal((await w.count([100, 201])).status, 201)
  w.as('admin'); w.app.clearCaches()
  const day = (await w.get('/list?branchId=1')).json.summary.days[0].day
  const cases = [['checkState=ok', { checkState: 'ok' }, [100, 201]], ['checkState=not_checked', { checkState: 'not_checked' }, null], ['checkedOn', { checkedOn: day }, [100, 201]], ['checkState=not_checked and brand A', { checkState: 'not_checked', brand: 'A' }, null]]
  for (const [label, filters, expected] of cases) {
    const listed = await listedProducts(w, queryOf(filters))
    if (expected) assert.deepEqual(listed, expected, `${label}: the list shows these`)
    w.as('admin'); w.app.clearCaches()
    const made = await w.api('POST', '/tasks', { branchId: 1, requestId: w.rid('cs'), filters })
    assert.equal(made.status, 201, `${label}: ${JSON.stringify(made.json)}`)
    assert.deepEqual(issuedProducts(w, made.json.item.id), listed, `${label}: the task holds what the list shows under the same filter`)
    if (label === 'checkState=not_checked') assert.ok(listed.length > 5 && !listed.includes(100) && !listed.includes(201), 'Not checked leaves the counted products out')
  }
}

/** Capabilities equal enforcement: the extra without the count grant offers nothing the Worker would refuse; the board's selection follows the viewer's field grants. */
async function issueCapabilities(w) {
  const task = (await w.issue([100, 101], {}, 'admin')).json.item.id
  const pick = (await w.pickup(task, 'checker')).json.item.id
  for (const who of ['viewIssuer']) {
    w.as(who)
    const board = await w.get('/tasks?branchId=1'); assert.equal(board.status, 403, JSON.stringify(board.json)); assert.equal(board.json.code, 'inventory_check_tasks_required', 'view plus the extra, no count grant: no board offered')
    const issued = await w.api('POST', '/tasks', { branchId: 1, requestId: w.rid('i'), productIds: [100] }); assert.equal(issued.status, 403); assert.equal(issued.json.code, 'inventory_check_issue_required')
    const released = await w.api('POST', `/tasks/${task}/release`, { requestId: w.rid('r') }); assert.equal(released.status, 403); assert.equal(released.json.code, 'inventory_check_release_forbidden', "someone else's pickup needs the extra AND the count grant")
    const closed = await w.api('PATCH', `/sessions/${task}`, { expectedRevision: 0, requestId: w.rid('c'), action: 'close' }); assert.equal(closed.status, 403); assert.equal(closed.json.code, 'inventory_check_permission_required')
  }
  w.as('issuer'); const view = (await w.get('/tasks?branchId=1')).json
  assert.equal(view.capabilities.issue, true); const row = view.items.find((t) => t.id === task); assert.equal(row.can_close, true); assert.equal(row.can_release, true)
  assert.equal((await w.api('POST', `/tasks/${task}/release`, { requestId: w.rid('r') })).status, 200, 'what is offered is accepted')
  assert.ok(pick)
  // the picker releases their own pickup with what a pickup needed
  assert.equal((await w.pickup(task, 'checker')).status, 201); w.as('checker')
  assert.equal((await w.api('POST', `/tasks/${task}/release`, { requestId: w.rid('r') })).status, 200)
  // L1: the selection of a filter task, as each viewer may see it
  w.as('admin')
  const byFilter = await w.api('POST', '/tasks', { branchId: 1, requestId: w.rid('f'), filters: { brand: 'A', stockState: 'in_stock' } }); assert.equal(byFilter.status, 201, JSON.stringify(byFilter.json))
  const selectionFor = async (who) => { w.as(who); return (await w.get('/tasks?branchId=1')).json.items.find((t) => t.id === byFilter.json.item.id).selection }
  assert.deepEqual((await selectionFor('checker')).filters, { brand: 'A', stockState: 'in_stock' }, 'a viewer with the fields sees both filters')
  assert.deepEqual((await selectionFor('blind')).filters, { brand: 'A' }, 'a viewer without the stock field does not see the stock filter')
  assert.deepEqual((await selectionFor('receivedOnly')).filters, {}, 'a viewer without the brand and stock fields sees neither')
}

/**
 * Staff names (security P3-2): who ISSUED a task follows canSeeStaffIdentity, in the form of the sessions list (the key is left out): an admin, an audit_log holder and the issuer see it, no other viewer does.
 * Who PICKED a task up stays visible to every board viewer (owner: "Others see 'Picked up by ...'"), and so does the 409's pickedUpBy.
 */
async function issuedByVisibility(w) {
  const byAdmin = (await w.issue([100, 101], {}, 'admin')).json.item.id, byIssuer = (await w.issue([102, 103], {}, 'issuer')).json.item.id
  assert.equal((await w.pickup(byAdmin, 'checker')).status, 201)
  const items = async (who) => { w.as(who); return Object.fromEntries((await w.get('/tasks?branchId=1')).json.items.map((t) => [t.id, t])) }
  const other = await items('picker2')
  for (const id of [byAdmin, byIssuer]) assert.equal('issued_by' in other[id], false, 'a viewer who is neither admin, audit_log nor the issuer gets no issued_by key')
  assert.equal(other[byAdmin].picked_up_by, 'u72', 'every viewer sees who picked the task up')
  const own = await items('issuer')
  assert.equal(own[byIssuer].issued_by, 'u78', 'the issuer sees their own name'); assert.equal('issued_by' in own[byAdmin], false, "and not another issuer's")
  for (const who of ['admin', 'auditor']) { const all = await items(who); assert.equal(all[byAdmin].issued_by, 'u71', who); assert.equal(all[byIssuer].issued_by, 'u78', who) }
  w.as('picker2'); const second = await w.api('POST', `/tasks/${byAdmin}/pickup`, { requestId: w.rid('p2') })
  assert.equal(second.status, 409, JSON.stringify(second.json)); assert.equal(second.json.pickedUpBy, 'u72', "the refusal names the picker to anyone who may pick up")
}

/**
 * P3-3, F1, F2: resolving an issue filter reads the wired list page after page. The reader pages FAMILIES, and a childless header is a family, so the filter reads the list leaf-only (the check lists' own
 * restriction, which leaves headers out): a page then holds at least one product per family and the bound counts products. A filter of maxProducts (300) or fewer countable products always issues, whatever
 * headers it matches; one with more answers inventory_check_task_too_many. Each page costs 7 D1 calls and the request has 7 of its own (Free allows 50). One cold request per world.
 */
async function issueFilterBound(w0) {
  const worlds = [
    ['205 childless headers and 5 products', { headers: 205 }, 5], ['605 childless headers and 5 products', { headers: 605 }, 5], ['1005 childless headers and 5 products', { headers: 1005 }, 5],
    ['101 childless headers and 300 products (F1: 401 families)', { headers: 101, lone: 300 }, 300],
    ['99 childless headers sorted last and 300 products (F2: 399 families)', { headers: 99, lone: 300, headerName: 'Zhead' }, 300],
    ['301 products and no header (the page bound plus one)', { lone: 301 }, 301],
  ]
  for (const [label, world, products] of worlds) {
    const w = w0.again(world)
    let calls = 0
    for (const name of ['prepare', 'batch', 'batchOnce']) { const original = w.app.env.DB[name]; w.app.env.DB[name] = (...args) => { calls++; return original.apply(w.app.env.DB, args) } }
    w.as('admin'); w.app.clearCaches()
    const before = calls, made = await w.api('POST', '/tasks', { branchId: 1, requestId: w.rid('hb'), filters: { brand: 'H' } }), used = calls - before
    console.log(`     ${label}: ${used} D1 calls, ${made.status}${made.status === 400 ? ` ${made.json.code} total ${made.json.total}` : ''}`)
    assert.ok(used <= 50, `${label}: ${used} D1 calls for one cold POST /tasks (Free allows 50)`)
    // The plain list keeps showing the headers (only an issued filter reads leaf-only): a rule that dropped them from every read would pass the counts above.
    w.as('admin'); w.app.clearCaches()
    let headerRows = 0
    for (let page = 1; page <= 6 && !headerRows; page++) headerRows = ((await w.get(`/list?branchId=1&brand=H&pageSize=100&page=${page}`)).json.items || []).filter((item) => Number(item.is_group) === 1).length
    if (world.headers) assert.ok(headerRows > 0, `${label}: the plain list still shows the family headers`)
    const issued = w.row("SELECT COUNT(*) AS n FROM inventory_check_sessions WHERE json_extract(scope_json,'$.membership')='task'").n
    if (products <= 300) { assert.equal(made.status, 201, `${label}: ${JSON.stringify(made.json)}`); assert.equal(made.json.item.progress.total, products, 'within the bound the filter resolves every product'); assert.equal(issued, 1); continue }
    assert.equal(made.status, 400, JSON.stringify(made.json)); assert.equal(made.json.code, 'inventory_check_task_too_many'); assert.equal(made.json.total, products, 'the whole count, not a page bound')
    assert.equal(made.json.limit, 300); assert.equal(issued, 0, 'nothing was issued')
  }
}

/**
 * Item 7: the board sends each task's own revision, so a screen can close a task by hand (the close writer needs it as expectedRevision). It costs nothing: the board stays ONE D1 call cold and 0 warm. The cache holds the raw
 * rows and the projection is per viewer: the revision reaches every board viewer, the issuer's name only those who may see it.
 */
async function boardRevision(w) {
  const task = (await w.issue([100, 101])).json.item.id
  let calls = 0
  for (const name of ['prepare', 'batch', 'batchOnce']) { const original = w.app.env.DB[name]; w.app.env.DB[name] = (...args) => { calls++; return original.apply(w.app.env.DB, args) } }
  w.app.clearCaches(); calls = 0; await w.board('admin'); const cold = calls
  calls = 0; await w.board('admin'); const warm = calls
  console.log(`     board: ${cold} D1 calls cold, ${warm} warm (revision ${(await taskOf(w, task)).revision})`)
  assert.equal(cold, 1, 'the board is one D1 call cold'); assert.equal(warm, 0, 'and none warm')
  const view = await taskOf(w, task), stored = w.row('SELECT revision FROM inventory_check_sessions WHERE id=?', task).revision
  assert.equal(typeof view.revision, 'number'); assert.equal(view.revision, stored, "the board's revision is the session row's own")
  const worker = await taskOf(w, task, 'checker')
  assert.equal(worker.revision, stored, 'every board viewer is sent it'); assert.equal('issued_by' in worker, false, 'while the projection still happens per viewer (the issuer is not shown to this viewer)')
  assert.equal('issued_by' in view, true)
  w.as('admin')
  const stale = await w.api('PATCH', `/sessions/${task}`, { expectedRevision: view.revision + 1, requestId: w.rid('stale'), action: 'close' })
  assert.equal(stale.status, 409, JSON.stringify(stale.json)); assert.equal(stale.json.code, 'inventory_check_conflict', 'a stale revision is refused with the existing code')
  assert.equal((await taskOf(w, task)).status, 'open', 'and nothing was closed')
  const closed = await w.api('PATCH', `/sessions/${task}`, { expectedRevision: view.revision, requestId: w.rid('ok'), action: 'close' })
  assert.equal(closed.status, 200, JSON.stringify(closed.json)); assert.equal((await taskOf(w, task)).status, 'closed')
  assert.equal((await taskOf(w, task)).revision, view.revision + 1, 'the closed row shows the new revision')
}

/** F5: the wired list's page size and the products reader's clamp are one constant, so the filter loop's stop rule cannot drift from the reader. */
async function pageSizeOneSource(w) {
  const read = (file) => require('node:fs').readFileSync(path.join(__dirname, '../src', file), 'utf8')
  assert.match(read('lib/inventoryCheckList.ts'), /export const LIST_MAX_PAGE_SIZE = PRODUCT_LIST_MAX_PAGE_SIZE\b/)
  assert.match(read('routes/products.ts'), /clampInt\(query\.pageSize, 20, 1, PRODUCT_LIST_MAX_PAGE_SIZE\)/)
  assert.equal(w.app.load('lib/inventoryCheckList.ts').LIST_MAX_PAGE_SIZE, w.app.load('lib/familyPagination.ts').PRODUCT_LIST_MAX_PAGE_SIZE)
}

/**
 * The cache key of the task's countable products (E2): the board and the task list are cached by the inventory_checks version AND the products version, so a product that becomes a header (or is retired or merged) moves both
 * reads at once. NO cache is cleared here: only the products version moves, as a real product change moves it.
 */
async function cacheKeyProducts(w) {
  const task = (await w.issue([102, 103])).json.item.id
  const listTotal = async () => { w.as('checker'); return (await w.get(`/list?branchId=1&taskId=${task}`)).json.task.total }
  assert.equal(await listTotal(), 2); assert.equal((await taskOf(w, task)).total, 2)
  w.app.raw.prepare('UPDATE products SET is_group=1 WHERE id=103').run(); await w.app.bumpProducts()
  assert.equal(await listTotal(), 1, 'the task list follows a product that became a header, with no cache clear')
  const view = await taskOf(w, task); assert.deepEqual([view.total, view.done, view.removed], [1, 0, 1], 'and so does the board')
}

/**
 * E1's clean refusal: a Worker that runs before migration 0319 (or 0318 and 0319) answers 503 inventory_check_schema_unavailable from every probed route, never a raw D1 "no such index", and writes nothing.
 * The migrations are not applied here by dropping the indexes they create (the tables are the same).
 */
async function schemaMissing(w0) {
  const variants = { 'a schema without 0319': ['inventory_check_sessions_open_task', 'inventory_check_sessions_task_board'], 'a schema without 0318 and 0319': ['inventory_check_sessions_kind_task', 'inventory_check_sessions_open_task', 'inventory_check_sessions_task_board'] }
  for (const [name, drop] of Object.entries(variants)) {
    const w = w0.again({})
    const before = w.row('SELECT (SELECT COUNT(*) FROM inventory_check_sessions) AS s, (SELECT COUNT(*) FROM inventory_check_items) AS i, (SELECT COUNT(*) FROM inventory_check_events) AS e')
    for (const index of drop) w.app.raw.exec(`DROP INDEX ${index}`)
    const refused = async (label, run) => { const r = await run(); assert.equal(r.status, 503, `${name}: ${label}: ${r.status} ${JSON.stringify(r.json)}`); assert.equal(r.json.code, 'inventory_check_schema_unavailable', `${name}: ${label}`) }
    await refused('a submission', () => w.count([100]))
    await refused('issuing a task', () => w.issue([100, 101]))
    await refused('the Count sessions list', async () => { w.as('checker'); return w.get('/sessions?branchId=1') })
    await refused('a pickup', async () => { w.as('checker'); return w.api('POST', '/tasks/no-such-task/pickup', { requestId: w.rid('p') }) })
    await refused('a session detail', async () => { w.as('admin'); return w.get('/sessions/no-such-session') })
    assert.deepEqual(w.row('SELECT (SELECT COUNT(*) FROM inventory_check_sessions) AS s, (SELECT COUNT(*) FROM inventory_check_items) AS i, (SELECT COUNT(*) FROM inventory_check_events) AS e'), before, `${name}: nothing is written by a refused request`)
  }
}

/** The cap: a branch has at most maxOpenTasks open tasks; the board shows all of them. */
async function taskCap(w) {
  const cap = (await w.board()).json.capabilities.maxOpenTasks
  assert.equal(cap, 30)
  const first = []
  for (let n = 0; n < cap; n++) { const r = await w.issue([100 + (n % PRODUCTS)]); assert.equal(r.status, 201, `task ${n}: ${JSON.stringify(r.json)}`); first.push(r.json.item.id) }
  const refused = await w.issue([100])
  assert.equal(refused.status, 409, JSON.stringify(refused.json)); assert.equal(refused.json.code, 'inventory_check_task_limit'); assert.equal(refused.json.open, cap); assert.equal(refused.json.limit, cap)
  assert.equal(w.row("SELECT COUNT(*) AS n FROM inventory_check_sessions WHERE json_extract(scope_json,'$.membership')='task'").n, cap, 'a refused issue writes nothing')
  assert.equal((await w.board()).json.items.filter((t) => t.status === 'open').length, cap, 'the board shows every open task: it never hides one')
  const free = await w.app.send('POST', '/api/inventory-checks/tasks', { branchId: 1, requestId: w.rid('free'), productIds: [100] }, { ...w.app.env, PLAN_TIER: 'free' })
  assert.equal(free.status, 409); assert.equal(free.json.code, 'inventory_check_task_limit', 'the same cap on the Free plan')
  assert.equal((await w.api('POST', '/tasks', { branchId: 2, requestId: w.rid('b2'), productIds: [100] })).status, 201, 'another branch has its own cap')
  rawTask(w, { id: 'org2-a', org: 2, products: [100] }); rawTask(w, { id: 'org2-b', org: 2, products: [100] })
  assert.equal((await w.close(first[0])).status, 200)
  assert.equal((await w.issue([105])).status, 201, "closing one frees a place, and another organization's open tasks are not counted")
  assert.equal((await w.issue([106])).status, 409, 'and the place is taken again')
  // the cap is read inside the batch: a task that appears between the issue and its write still counts
  assert.equal((await w.close(first[1])).status, 200)
  const original = w.app.env.DB.batchOnce
  w.app.env.DB.batchOnce = (list) => { if (list.some((s) => /INSERT INTO inventory_check_sessions/.test(s.sql))) rawTask(w, { id: 'rival-task', creator: 71, products: [100] }); return original(list) }
  const raced = await w.issue([107]); w.app.env.DB.batchOnce = original
  assert.equal(raced.status, 409, JSON.stringify(raced.json)); assert.equal(raced.json.code, 'inventory_check_task_limit', 'two issues at once cannot both take the last place')
  assert.equal(w.row("SELECT COUNT(*) AS n FROM inventory_check_sessions WHERE organization_id IS NULL AND branch_id=1 AND status='open' AND json_extract(scope_json,'$.membership')='task'").n, cap)
}

/** Task rows are written only by the task writers: every other writer, aimed at a task or a pickup, is refused and leaves the rows as they were; a task's own item is never a count. */
async function taskRowsUntouched(w) {
  const task = (await w.issue([100, 101])).json.item.id
  const pickup = (await w.pickup(task, 'checker')).json.item.id
  rawTask(w, { id: 'orphan-task', creator: 72, products: [102, 103] }) // made by a counter who holds no issue permission now
  const ids = [task, pickup, 'orphan-task'], marks = ids.map(() => '?').join(',')
  const snap = () => JSON.stringify([w.rows(`SELECT * FROM inventory_check_sessions WHERE id IN (${marks}) ORDER BY id`, ...ids), w.rows(`SELECT * FROM inventory_check_items WHERE session_id IN (${marks}) ORDER BY session_id,product_id`, ...ids),
    w.row(`SELECT COUNT(*) AS n FROM inventory_check_events WHERE session_id IN (${marks})`, ...ids), w.row('SELECT COUNT(*) AS n FROM inventory_check_approvals')])
  const before = snap()
  const code = async (p, st, expected) => { const r = await p; assert.equal(r.status, st, JSON.stringify(r.json)); if (expected) assert.equal(r.json.code, expected, JSON.stringify(r.json)); return r }
  const observe = (id, who, body) => { w.as(who); return w.api('PATCH', `/sessions/${id}/items/${id === 'orphan-task' ? 102 : 100}`, { expectedRevision: 0, expectedSessionRevision: 0, requestId: w.rid('o'), ...body }) }
  for (const body of [{ state: 'done', counted_quantity: 10 }, { state: 'issue', counted_quantity: 9, reason: 'short' }, { state: 'unstarted' }]) {
    await code(observe(task, 'admin', body), 409, 'inventory_check_task_not_countable')
    await code(observe(task, 'issuer', body), 409, 'inventory_check_task_not_countable')
    await code(observe(task, 'checker', body), 403, 'inventory_check_owner_required')
    await code(observe(pickup, 'checker', body), 409, 'inventory_check_task_not_countable')
    await code(observe(pickup, 'admin', body), 409, 'inventory_check_task_not_countable')
    await code(observe('orphan-task', 'checker', body), 403, 'inventory_check_owner_required')
    await code(observe('orphan-task', 'admin', body), 409, 'inventory_check_task_not_countable')
  }
  // closing: only whoever may issue closes a task; the creator who no longer may does not
  await code((w.as('checker'), w.api('PATCH', '/sessions/orphan-task', { expectedRevision: 0, requestId: w.rid('c'), action: 'close' })), 403, 'inventory_check_owner_required')
  await code((w.as('picker2'), w.api('PATCH', `/sessions/${task}`, { expectedRevision: 0, requestId: w.rid('c'), action: 'close' })), 403, 'inventory_check_owner_required')
  // approvals: a task and a pickup never have one
  for (const id of [task, pickup]) for (const route of ['approval', 'approval/lines']) {
    w.as('admin'); await code(w.api('POST', `/sessions/${id}/${route}`, route === 'approval' ? { decision: 'approve', requestId: w.rid('a') } : { action: 'reject', productId: 100, requestId: w.rid('a') }), 404)
  }
  // creating a session that claims to be a task or a pickup, or to name one
  w.as('admin')
  for (const scope of [{ membership: 'task' }, { membership: 'pickup', task }, { membership: 'visible_page', task }, { task }]) await code(w.api('POST', '/sessions', { branchId: 1, requestId: w.rid('n'), productIds: [100], scope }), 400)
  // a submission naming a pickup, an ordinary session or an unknown id as its task is refused whole
  w.as('checker')
  const ordinary = (await w.api('POST', '/sessions', { branchId: 1, requestId: w.rid('s'), productIds: [104], scope: { membership: 'visible_page' } })).json.item.id
  const sessionsBefore = w.row('SELECT COUNT(*) AS n FROM inventory_check_sessions').n
  for (const named of [pickup, ordinary, 'unknown-id']) await code(w.count([104], { task: named }), 404, 'inventory_check_task_not_found')
  assert.equal(w.row('SELECT COUNT(*) AS n FROM inventory_check_sessions').n, sessionsBefore, 'nothing was recorded')
  await code(w.pickup(pickup, 'picker2'), 404, 'inventory_check_task_not_found'); await code(w.pickup(ordinary, 'picker2'), 404, 'inventory_check_task_not_found')
  assert.equal(JSON.stringify(JSON.parse(snap()).slice(0, 2)), JSON.stringify(JSON.parse(before).slice(0, 2)), 'every refused writer left the task, the pickup and their items as they were')
  // a closed task and a closed pickup are final
  assert.equal((await w.release(task, 'checker')).status, 200); assert.equal((await w.close(task, 'admin')).status, 200)
  w.as('issuer'); await code(w.api('PATCH', `/sessions/${task}`, { expectedRevision: 1, requestId: w.rid('r'), action: 'resume' }), 409, 'inventory_check_session_final')
  w.as('checker'); await code(w.api('PATCH', `/sessions/${pickup}`, { expectedRevision: 1, requestId: w.rid('r'), action: 'resume' }), 409, 'inventory_check_session_final')
  assert.equal(w.row("SELECT COUNT(*) AS n FROM inventory_check_items WHERE session_id IN (?,?,?) AND (state<>'unstarted' OR updated_at IS NOT NULL OR counted_quantity IS NOT NULL)", ...ids).n, 0, 'a task item is never a count')
}

/**
 * ONE countable rule (F3): a family header, with or without children, is never part of a task, because the wired list never shows one. By ids it is refused like any other product that cannot be counted;
 * by filter it is left out; a product that BECOMES a childless header leaves the task's total (counted in removed) and no longer blocks the close, so a task can never sit open at 1/2 on a row the list does not show.
 */
async function headerRule(w) {
  const header = (id) => w.app.raw.prepare('UPDATE products SET is_group=1 WHERE id=?').run([id])
  header(111) // a header with no children
  w.as('admin')
  const refused = await w.api('POST', '/tasks', { branchId: 1, requestId: w.rid('h'), productIds: [100, 111] })
  assert.equal(refused.status, 400, JSON.stringify(refused.json)); assert.equal(refused.json.code, 'inventory_check_product_not_eligible', 'a childless header given by ids is refused like any product that cannot be counted')
  const byFilter = await w.api('POST', '/tasks', { branchId: 1, requestId: w.rid('h'), filters: { brand: 'A' } })
  assert.equal(byFilter.status, 201, JSON.stringify(byFilter.json)); assert.equal(w.rows('SELECT product_id FROM inventory_check_items WHERE session_id=?', byFilter.json.item.id).some((r) => r.product_id === 111), false, 'issue by filter leaves the header out')
  // a product that becomes a childless header after the issue
  const task = (await w.issue([102, 103])).json.item.id
  header(103)
  w.app.clearCaches()
  const view = await taskOf(w, task); assert.deepEqual([view.total, view.done, view.removed], [1, 0, 1], 'the header leaves the total and is counted in removed')
  w.as('checker'); const listed = (await w.get(`/list?branchId=1&taskId=${task}`)).json.items.map((i) => i.id)
  assert.deepEqual(listed, [102], 'the task list shows exactly the products the task still counts')
  assert.equal((await w.get(`/list?branchId=1&taskId=${task}`)).json.task.total, view.total, 'the list and the board agree on the total after a product becomes a header')
  const last = await countBy(w, 'lot', 102)
  assert.deepEqual(last.answer.closedTasks, [task], 'the task closes on the one product it can still count (never open at 1/2 on a row the list does not show)')
}

/**
 * The other half of the countable rule (lead ruling, 19 Nov): a task counts exactly what the wired list shows, and that list reads ACTIVE products only (catalogOnly in routes/products.ts), so an inactive product is
 * never countable, even one that holds stock. Migration 0242's trigger refuses stock on an inactive product, so the world is built by dropping that trigger: the rule must not depend on it. By ids it is refused
 * (inventory_check_product_not_eligible), by filter it is left out, and a product deactivated AFTER the issue leaves the total (removed) so the task can still close.
 */
async function deactivatedWithStock(w) {
  const stockWrite = (fn) => w.app.seedStockFixture(w.app.raw.db, fn)
  stockWrite(() => { w.app.raw.exec('DROP TRIGGER product_deactivate_stock_0242'); w.app.raw.prepare('UPDATE products SET is_active=0 WHERE id=104').run() })
  assert.equal(w.row('SELECT SUM(quantity) AS q FROM branch_stock WHERE product_id=104').q > 0, true, 'the inactive product still holds stock')
  const refused = await w.issue([103, 999]); assert.equal(refused.status, 400, 'a product that does not exist is still refused')
  const byIds = await w.issue([103, 104]); assert.equal(byIds.status, 400, JSON.stringify(byIds.json)); assert.equal(byIds.json.code, 'inventory_check_product_not_eligible', 'an inactive product that holds stock is refused by ids')
  const byFilter = await w.api('POST', '/tasks', { branchId: 1, requestId: w.rid('d'), filters: { brand: 'B' } })
  assert.equal(byFilter.status, 201, JSON.stringify(byFilter.json))
  const issued = w.rows('SELECT product_id FROM inventory_check_items WHERE session_id=?', byFilter.json.item.id).map((r) => r.product_id)
  assert.equal(issued.includes(104), false, 'issue by filter leaves the inactive product out'); assert.equal(issued.includes(102), true, 'and keeps the active ones of the filter')
  // deactivated AFTER the issue (its stock stays: the trigger is gone)
  const task = (await w.issue([103, 105])).json.item.id, listTotal = async () => { w.app.clearCaches(); w.as('checker'); return (await w.get(`/list?branchId=1&taskId=${task}`)).json.task.total }
  w.app.clearCaches()
  const before = await taskOf(w, task); assert.deepEqual([before.total, before.done, before.removed], [2, 0, 0]); assert.equal(await listTotal(), 2)
  stockWrite(() => { w.app.raw.prepare('UPDATE products SET is_active=0 WHERE id=105').run() })
  w.app.clearCaches()
  const gone = await taskOf(w, task); assert.deepEqual([gone.total, gone.done, gone.removed], [1, 0, 1], 'deactivated after the issue, it leaves the total even with its stock')
  assert.equal(await listTotal(), 1, 'and the task list total')
  const last = await countBy(w, 'lot', 103)
  assert.deepEqual(last.answer.closedTasks, [task], 'the task closes on the one product it can still count'); assert.equal(status(w, task), 'closed')
}

/** F7: a request retried while its twin takes the branch's last place is a REPLAY, not a refusal. */
async function taskCapReplay(w) {
  for (let n = 0; n < 29; n++) assert.equal((await w.issue([100 + (n % PRODUCTS)])).status, 201)
  const key = w.rid('twin'), original = w.app.env.DB.batchOnce
  let fired = false
  // the twin commits first (the same batch, the same key), then this request's own batch runs and finds the branch full
  w.app.env.DB.batchOnce = async (list) => { if (!fired && list.some((s) => /INSERT INTO inventory_check_sessions/.test(s.sql))) { fired = true; await original(list) } return original(list) }
  w.as('admin'); const r = await w.api('POST', '/tasks', { branchId: 1, requestId: key, productIds: [100] }); w.app.env.DB.batchOnce = original
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.created, false, 'answered as a replay')
  assert.equal(w.rows("SELECT * FROM inventory_check_events WHERE request_id=? AND action='create'", key).length, 1, 'one task made')
  assert.equal(w.row("SELECT COUNT(*) AS n FROM inventory_check_sessions WHERE status='open' AND json_extract(scope_json,'$.membership')='task'").n, 30)
  const other = await w.issue([101]); assert.equal(other.status, 409); assert.equal(other.json.code, 'inventory_check_task_limit', 'a different request still meets the cap')
}

/** F7: the auto-close reads back only the events of ITS OWN request: another request's event with a crafted id, the same actor and time, is not read. */
async function readBackHash(w) {
  const task = (await w.issue([100, 101])).json.item.id
  const pickup = (await w.pickup(task, 'checker')).json.item.id
  const tasks = w.app.load('lib/inventoryCheckTasks.ts'), sets = w.app.load('lib/stockSetClosesIssue.ts')
  const args = { src: 'no-such-session', task: null, organization: null, branchId: 1, actorId: 71, actorName: 'admin', key: 'victim-key-0001', hash: 'real-hash', now: '2026-11-19T00:00:00.000Z' }
  const craft = (session, requestId) => w.app.raw.prepare("INSERT INTO inventory_check_events(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at) VALUES(?,NULL,71,'admin','close',?,'other-hash','{}','{}','{}',?)").run([session, requestId, args.now])
  craft(task, `${args.key}-task-closed-crafted`); craft(pickup, `${args.key}-pickup-crafted`)
  const params = tasks.autoCloseParams(args)
  for (const statement of tasks.autoCloseTaskStatements().statements) await w.app.env.DB.batch([{ sql: statement.sql, params }])
  assert.equal(status(w, task), 'open', "another request's close event does not close the task"); assert.equal(status(w, pickup), 'open', "nor the pickup")
  // the Set's answer (closed_tasks) reads the same way
  const set = { productId: 100, branchId: 1, organization: null, operation: 'op-1', generation: 0, actorId: 71, actorName: 'admin' }
  const read = sets.closedTasksSelect(set, args.now, 'no-session')
  craft(task, `stock-set-op-1-g0-task-closed-crafted`)
  const out = (await w.app.env.DB.batch([{ sql: `SELECT ${read.expr} AS tasks`, params: read.params }]))[0]
  const got = (out.results ?? out)[0].tasks
  assert.ok(got === null || got === '[]', `the Set does not name a task another request closed: ${got}`)
}

// ---- the random world -----------------------------------------------------------------------------------------------------------------------------------------------------------------------
function prng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 } }
async function randomWorld(w, seed, steps) {
  const random = prng(seed), pick = (list) => list[Math.floor(random() * list.length)]
  const model = new Map() // task id -> { status, pickupBy|null, closedAt }
  const users = ['checker', 'picker2', 'issuer']
  const afterEvery = async (what) => {
    const shown = (await w.board('admin')).json.items
    const closedShown = [...model.entries()].filter(([, t]) => t.status === 'closed').sort((a, b) => (b[1].closedOrder - a[1].closedOrder) || (a[0] < b[0] ? 1 : -1)).slice(0, 5).map(([id]) => id)
    const expectedIds = new Set([...model.entries()].filter(([, t]) => t.status === 'open').map(([id]) => id).concat(closedShown))
    assert.deepEqual(new Set(shown.map((t) => t.id)), expectedIds, `${what}: the tasks shown`)
    for (const view of shown) {
      const expected = model.get(view.id), db = w.row('SELECT * FROM inventory_check_sessions WHERE id=?', view.id)
      const productIds = w.rows('SELECT product_id FROM inventory_check_items WHERE session_id=?', view.id).map((r) => r.product_id)
      // brute force over the raw rows: a product is done when some count (done or differs) of it at the branch exists at or after the issue
      const done = productIds.filter((p) => w.rows("SELECT i.updated_at FROM inventory_check_items i WHERE i.product_id=? AND i.branch_id=? AND i.state IN ('done','issue') AND i.updated_at IS NOT NULL AND i.session_id IN (SELECT id FROM inventory_check_sessions WHERE status='closed')", p, db.branch_id).some((r) => r.updated_at >= db.started_at)).length
      assert.equal(view.total, productIds.length, `${what}: total`); assert.equal(view.done, done, `${what}: done count of ${view.id}`)
      assert.equal(view.status, expected.status, `${what}: status of ${view.id}`)
      assert.equal(view.picked_up_by, expected.pickupBy ? `u${w.app.users[expected.pickupBy].id}` : null, `${what}: pickup of ${view.id}`)
      assert.equal(w.rows("SELECT * FROM inventory_check_sessions WHERE json_extract(scope_json,'$.membership')='pickup' AND json_extract(scope_json,'$.task')=? AND status='open'", view.id).length, expected.pickupBy ? 1 : 0, `${what}: at most one open pickup`)
    }
  }
  let closedOrder = 0, outside = 0
  // The oracle: after every write that creates a count, each open task whose products ALL have a count at its branch at or after its issue is closed, and the answer names exactly those. Read from the raw rows, never from the SQL under test.
  const settle = (answer, what) => {
    const newly = []
    closedOrder++
    for (const [id, t] of model) if (t.status === 'open' && allDone(id)) { t.status = 'closed'; t.pickupBy = null; t.closedOrder = closedOrder; newly.push(id) }
    assert.deepEqual([...(answer.closedTasks ?? [])].sort(), newly.sort(), `${what}: the tasks the write closed`)
    return newly
  }
  const allDone = (id) => { const db = w.row('SELECT * FROM inventory_check_sessions WHERE id=?', id); return w.rows('SELECT product_id FROM inventory_check_items WHERE session_id=?', id).every((r) => w.rows("SELECT updated_at FROM inventory_check_items WHERE product_id=? AND branch_id=? AND state IN ('done','issue') AND updated_at IS NOT NULL AND session_id IN (SELECT id FROM inventory_check_sessions WHERE status='closed')", r.product_id, db.branch_id).some((x) => x.updated_at >= db.started_at)) }
  for (let step = 0; step < steps; step++) {
    await sleep(3)
    const open = [...model.entries()].filter(([, t]) => t.status === 'open').map(([id]) => id)
    const roll = random()
    const products = () => { const n = 1 + Math.floor(random() * 3); const set = new Set(); while (set.size < n) set.add(100 + Math.floor(random() * 6)); return [...set] }
    if (roll < 0.18 && model.size < 10) {
      const made = await w.issue(products(), {}, pick(['admin', 'issuer'])); assert.equal(made.status, 201); model.set(made.json.item.id, { status: 'open', pickupBy: null })
    } else if (roll < 0.28 && open.length) {
      const id = pick(open), who = pick(users), expected = model.get(id).pickupBy
      const r = await w.pickup(id, who)
      if (expected) assert.equal(r.status, 409); else { assert.equal(r.status, 201); model.get(id).pickupBy = who }
    } else if (roll < 0.36 && open.length) {
      const id = pick(open), t = model.get(id), who = pick([...users, 'admin'])
      const r = await w.release(id, who)
      const allowed = t.pickupBy && (who === t.pickupBy || who === 'admin' || who === 'issuer')
      if (allowed) { assert.equal(r.status, 200); t.pickupBy = null } else assert.ok(r.status === 403 || r.status === 409, `release ${r.status}`)
    } else if (roll < 0.52 && open.length) {
      const id = pick(open), lines = products(), counter = pick(users)
      const r = await w.count(lines, { task: id, who: counter }); assert.equal(r.status, 201, JSON.stringify(r.json))
      const newly = settle(r.json, `seed ${seed} step ${step}`); assert.equal(r.json.task.closed, newly.includes(id))
    } else if (roll < 0.92) {
      // a count outside every task: every writer in turn, at either branch; a count at branch 2 never ticks a task of branch 1
      const how = ['multi', 'lot', 'plain', 'observe', 'other-branch', 'withdrawn'][outside++ % 6]
      if (how === 'multi') { const r = await w.count(products().map((p) => ({ productId: p, countedQuantity: random() < 0.5 ? 10 : 9, seenQuantity: 10 })), { who: pick(users) }); assert.equal(r.status, 201, JSON.stringify(r.json)); settle(r.json, `seed ${seed} step ${step} ${how}`) }
      else if (how === 'other-branch') { const r = await w.count(products(), { who: 'admin', branchId: 2 }); assert.equal(r.status, 201, JSON.stringify(r.json)); settle(r.json, `seed ${seed} step ${step} ${how}`) }
      else if (how === 'withdrawn') {
        // a count made and set back in an open session, never closed: no task ticks and none closes
        w.as('checker'); const p = products()[0]
        const s = (await w.api('POST', '/sessions', { branchId: 1, requestId: w.rid('s'), productIds: [p], scope: { membership: 'visible_page' } })).json.item.id
        assert.equal((await w.api('PATCH', `/sessions/${s}/items/${p}`, { expectedRevision: 0, expectedSessionRevision: 0, requestId: w.rid('o'), state: 'done', counted_quantity: 10 })).status, 200)
        assert.equal((await w.api('PATCH', `/sessions/${s}/items/${p}`, { expectedRevision: 1, expectedSessionRevision: 0, requestId: w.rid('o'), state: 'unstarted' })).status, 200)
        settle({}, `seed ${seed} step ${step} ${how}`)
      } else { const { answer } = await countBy(w, how, products()[0], { who: pick(users), state: random() < 0.5 ? 'done' : 'issue' }); settle(answer, `seed ${seed} step ${step} ${how}`) }
    } else if (open.length) {
      const id = pick(open); const r = await w.close(id, pick(['admin', 'issuer'])); assert.equal(r.status, 200, JSON.stringify(r.json))
      const t = model.get(id); t.status = 'closed'; t.pickupBy = null; t.closedOrder = ++closedOrder
    }
    await afterEvery(`seed ${seed} step ${step}`)
  }
}

// ---- run -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const SCENARIOS = {
  noEffect, issueShape, issueFilters, refusals, onePerson, race, taskList, doneRule, autoClose, manualClose, sessionsList, boardCache, olderListUnaffected,
  autoCloseOlderWriter: (w) => autoClose(w, { lotWriter: false }),
  outsideCloseLot: (w) => outsideClose(w, 'lot'), outsideClosePlain: (w) => outsideClose(w, 'plain'), outsideCloseObserve: (w) => outsideClose(w, 'observe'),
  outsideNegativesLot: (w) => outsideNegatives(w, 'lot'), outsideNegativesPlain: (w) => outsideNegatives(w, 'plain'), outsideNegativesObserve: (w) => outsideNegatives(w, 'observe'),
  observationNotFinal, doneRuleOrg, removedProducts, issueFilterFamilies, issueCapabilities, taskCap, taskRowsUntouched, headerRule, deactivatedWithStock, issuedByVisibility, issueFilterBound, issueFilterHeaderChildren, issueFilterNothing, issueFilterCheckState, pageSizeOneSource, boardRevision, cacheKeyProducts, schemaMissing, taskCapReplay, readBackHash,
  random: (w) => randomWorld(w, 20261118, 50),
  randomTwo: (w) => randomWorld(w, 20261119, 90),
  budget,
}
const WORLD = { issueFilterHeaderChildren: { summer: true }, issueFilterNothing: { summer: true }, issueFilters: { extraProducts: 310 }, budget: { extraProducts: 70 }, issueFilterFamilies: { families: 280 } }

async function main() {
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    await check(`scenario ${name}`, async () => { await scenario(build({}, WORLD[name] || {})) })
  }
  await check('the history text of a Set that closes a difference says difference (old history stays as written)', () => {
    const text = require('node:fs').readFileSync(path.join(__dirname, '../src/lib/stockSetClosesIssue.ts'), 'utf8')
    assert.ok(text.includes("'Set closed the difference'") && text.includes("'Undo of a Set reopened the difference'")); assert.equal(/closed the Issue|reopened the Issue/.test(text), false)
  })

  // Mutants: each is a plausible bug, planted in the source text; the scenario that targets it must fail.
  const edit = (file, from, to) => ({ [file]: [[from, to]] })
  const MUTANTS = [
    ['the done rule ignores counts made outside the task', edit('lib/inventoryCheckTasks.ts', "json_extract(xs.scope_json,'$.restore') IS NOT 1)`", "json_extract(xs.scope_json,'$.restore') IS NOT 1 AND json_extract(xs.scope_json,'$.task') IS NOT NULL)`"), ['doneRule', 'random']],
    ['the done rule counts counts made before the issue', edit('lib/inventoryCheckTasks.ts', 'AND x.updated_at>=${since} AND', 'AND x.updated_at IS NOT NULL AND'), ['doneRule', 'random']],
    ['the auto-close is missing', edit('lib/inventoryCheckTasks.ts', "AND NOT EXISTS(SELECT 1 FROM ${I} n WHERE n.session_id=t.id AND NOT ${taskItemDoneSql('n', '@branchId', 't.started_at', '@org')} AND ${taskItemCountableSql('n')})", 'AND 1=0'), ['autoClose', 'autoCloseOlderWriter', 'random', 'randomTwo', 'outsideCloseLot', 'outsideClosePlain', 'outsideCloseObserve']],
    ['the auto-close is missing from the wired submission writer', edit('lib/inventoryCheckSessions.ts', "  statements.push(...taskPart.statements)\n  let saved: Awaited<ReturnType<typeof commit>>\n  try { saved = await commit(db, principal, actor, statements, key, hash) }\n  catch (error) {\n    if (error instanceof InventoryCheckSessionError && error.code === 'inventory_check_count_in_progress') {", "  let saved: Awaited<ReturnType<typeof commit>>\n  try { saved = await commit(db, principal, actor, statements, key, hash) }\n  catch (error) {\n    if (error instanceof InventoryCheckSessionError && error.code === 'inventory_check_count_in_progress') {"), ['outsideCloseLot', 'random']],
    ['the auto-close is missing from the older submission writer', edit('lib/inventoryCheckSessions.ts', "  statements.push(...taskPart.statements)\n  let saved: Awaited<ReturnType<typeof commit>>\n  try { saved = await commit(db, principal, actor, statements, key, hash) }\n  catch (error) {\n    // The refusal names the products", "  let saved: Awaited<ReturnType<typeof commit>>\n  try { saved = await commit(db, principal, actor, statements, key, hash) }\n  catch (error) {\n    // The refusal names the products"), ['outsideClosePlain']],
    ['the auto-close candidates ignore the branch', { 'lib/inventoryCheckTasks.ts': [["ON m.session_id=t.id AND m.product_id=w.product_id AND m.branch_id=@branchId", "ON m.session_id=t.id AND m.product_id=w.product_id"], ["AND t.branch_id=@branchId AND t.status='open'\n", "AND t.status='open'\n"]] }, ['outsideNegativesLot', 'outsideNegativesPlain', 'outsideNegativesObserve']],
    ['the auto-close candidates ignore the organization', edit('lib/inventoryCheckTasks.ts', "t.organization_id IS @org AND ${kindOf('t')}='${TASK_MEMBERSHIP}' AND t.branch_id", "${kindOf('t')}='${TASK_MEMBERSHIP}' AND t.branch_id"), ['outsideNegativesLot', 'outsideNegativesPlain', 'outsideNegativesObserve']],
    ['a task is closed with its highest product still not done', edit('lib/inventoryCheckTasks.ts', "AND NOT EXISTS(SELECT 1 FROM ${I} n WHERE n.session_id=t.id AND NOT ${taskItemDoneSql(", "AND NOT EXISTS(SELECT 1 FROM ${I} n WHERE n.session_id=t.id AND n.product_id<>(SELECT MAX(m.product_id) FROM ${I} m WHERE m.session_id=t.id) AND NOT ${taskItemDoneSql("), ['outsideNegativesLot', 'outsideNegativesPlain', 'outsideNegativesObserve', 'random']],
    ['the open-task cap is not checked', edit('lib/inventoryCheckSessions.ts', "<@maxOpenTasks`, 'inventory_check_task_limit'", "<@maxOpenTasks+1000000`, 'inventory_check_task_limit'"), ['taskCap']],
    ['the open-task cap counts the tasks of other branches', edit('lib/inventoryCheckTasks.ts', "AND s.branch_id=@branchId AND s.status='open'`\n\n/** Does this task", "AND s.status='open'`\n\n/** Does this task"), ['taskCap']],
    ['the open-task cap counts the tasks of other organizations', edit('lib/inventoryCheckTasks.ts', "WHERE s.organization_id IS @organization AND ${kindOf('s')}='${TASK_MEMBERSHIP}' AND s.branch_id=@branchId AND s.status='open'`", "WHERE ${kindOf('s')}='${TASK_MEMBERSHIP}' AND s.branch_id=@branchId AND s.status='open'`"), ['taskCap']],
    ['an observation of a task or a pickup is accepted', edit('lib/inventoryCheckSessions.ts', "  if ([TASK_MEMBERSHIP, PICKUP_MEMBERSHIP].includes(membershipOf(session))) fail(409, 'inventory_check_task_not_countable')\n", ''), ['taskRowsUntouched']],
    ['a task is closed by its creator who may no longer issue', edit('lib/inventoryCheckSessions.ts', "  if (kind === TASK_MEMBERSHIP) return canIssueInventoryCountTasks(actor)\n", ''), ['taskRowsUntouched']],
    ['a closed task or pickup is resumed', edit('lib/inventoryCheckSessions.ts', "['submission', TASK_MEMBERSHIP, PICKUP_MEMBERSHIP].includes(membershipOf(session))", "['submission'].includes(membershipOf(session))"), ['taskRowsUntouched']],
    ['a submission may name a pickup or an ordinary session as its task', edit('lib/inventoryCheckSessions.ts', "AND ${kindOf('inventory_check_sessions')}='${TASK_MEMBERSHIP}')`, 'inventory_check_task_not_found', params)", "AND 1=1)`, 'inventory_check_task_not_found', params)"), ['taskRowsUntouched']],
    ['the pickup guard is missing from the batch', edit('lib/inventoryCheckSessions.ts', "    guard(`NOT ${OPEN_PICKUP_SQL('@task', '@organization')}`, 'inventory_check_task_picked_up', params),\n", ''), ['race']],
    ['a task item is written as a count (Done, with a time): it becomes a latest count', edit('lib/inventoryCheckSessions.ts', "INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json)\n      SELECT @id,json_extract(value,'$.product_id'),@branchId,json_extract(value,'$.product'),NULL,'{}' FROM json_each(@members)`", "INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,revision,updated_by,updated_at)\n      SELECT @id,json_extract(value,'$.product_id'),@branchId,json_extract(value,'$.product'),NULL,'{}','done',0,1,@actorId,@now FROM json_each(@members)`"), ['noEffect']],
    ['the issue permission is not checked', { 'routes/inventoryChecks.ts': [["  if (!canIssueInventoryCountTasks(user)) throw new InventoryCheckSessionError(403, 'inventory_check_issue_required')\n", '']], 'lib/inventoryCheckSessions.ts': [["  if (!canIssueInventoryCountTasks(actor)) fail(403, 'inventory_check_issue_required')\n", '']] }, ['refusals']],
    ['the taskId restriction is missing on /list', edit('routes/inventoryChecks.ts', '  if (extra.task) {\n    let ids = new Set(extra.task.productIds)', '  if (extra.task && Date.now() < 0) {\n    let ids = new Set(extra.task.productIds)'), ['taskList']],
    ['task rows are listed under Count sessions', edit('lib/inventoryCheckSessions.ts', "    AND json_extract(scope_json, '$.membership') IS NOT 'task' AND (@mine=0", '    AND (@mine=0'), ['sessionsList']],
    ['the auto-close is missing from the close of a count session', edit('lib/inventoryCheckSessions.ts', "    ...(taskPart ? taskPart.statements : []),\n  ]\n  const saved = await commit(db, principal, actor, statements, key, hash)", "  ]\n  const saved = await commit(db, principal, actor, statements, key, hash)"), ['outsideCloseObserve', 'observationNotFinal']],
    ['two tasks closed by one write share a close request id', edit('lib/inventoryCheckTasks.ts', "@key||'-task-closed-'||t.id", "@key||'-task-closed-'"), ['outsideNegativesLot', 'outsideNegativesPlain', 'outsideNegativesObserve']],
    ['a count in an open session ticks a task (the count need not be final)', edit('lib/inventoryCheckTasks.ts', "AND x.state IN ('done','issue') AND xs.status='closed' AND xs.organization_id", "AND x.state IN ('done','issue') AND xs.organization_id"), ['observationNotFinal', 'doneRule']],
    ["the done rule counts another organization's counts", edit('lib/inventoryCheckTasks.ts', "AND xs.organization_id IS ${org} AND xs.branch_id=x.branch_id\n", "AND xs.branch_id=x.branch_id\n"), ['doneRuleOrg']],
    ['a product that can no longer be counted still blocks the auto-close', edit('lib/inventoryCheckTasks.ts', " AND ${taskItemCountableSql('n')})", ')'), ['removedProducts']],
    ['the board counts products that can no longer be counted in the total', edit('lib/inventoryCheckTasks.ts', "(SELECT COUNT(*) FROM ${I} t WHERE t.session_id=page.id AND ${taskItemCountableSql('t')}) AS total", "(SELECT COUNT(*) FROM ${I} t WHERE t.session_id=page.id) AS total"), ['removedProducts']],
    ['issue by filter stops when the rows reach the family count', edit('routes/inventoryChecks.ts', "if (!rows.length || page * LIST_MAX_PAGE_SIZE >= Number(answer.total ?? 0)) break", "if (!rows.length || ids.size >= Number(answer.total ?? 0)) break"), ['issueFilterFamilies']],
    ['issuing needs only the extra, not the count grant', edit('lib/inventoryCheckAccess.ts', "return access.canView && access.canCheck && hasPermission(user, 'inventory_check_issue')", "return access.canView && hasPermission(user, 'inventory_check_issue')"), ['issueCapabilities']],
    ['the board shows the filters a viewer may not use', edit('routes/inventoryChecks.ts', "!(key === 'brand' && !access.fields.brand) && !(key === 'category' && !access.fields.category) && !(key === 'stockState' && !access.fields.stock)", 'true'), ['issueCapabilities']],
    ['the candidates read closed tasks again (the open-task index and the open filter are gone)', { 'lib/inventoryCheckTasks.ts': [["FROM ${S} t INDEXED BY inventory_check_sessions_open_task WHERE ${candidate}", "FROM ${S} t WHERE ${candidate}"], ["AND t.branch_id=@branchId AND t.status='open'\n", "AND t.branch_id=@branchId\n"]] }, ['outsideCloseLot', 'outsideClosePlain', 'outsideCloseObserve']],
    ['the done rule is "after the issue", not "at or after"', edit('lib/inventoryCheckTasks.ts', 'x.updated_at>=${since}', 'x.updated_at>${since}'), ['doneRule']],
    ['the close event does not say which session closed the task', edit('lib/inventoryCheckTasks.ts', ",'auto',1,'closedBy',@src)", ",'auto',1)"), ['outsideCloseLot', 'outsideClosePlain', 'outsideCloseObserve']],
    ['a family header is countable in a task (the rule drops its is_group clause)', edit('lib/inventoryCheckTasks.ts', ' AND COALESCE(p.is_group,0)=0)`', ')`'), ['headerRule']],
    ['the old rule: a task counts an inactive product that holds stock', edit('lib/inventoryCheckTasks.ts', "export const TASK_COUNTABLE_SQL = `(${catalogProductSql('p', false)} AND", 'export const TASK_COUNTABLE_SQL = `(${stockVisibleProductSql()} AND'), ['deactivatedWithStock']],
    ['the task list totals every product of the task, not the countable ones', edit('lib/inventoryCheckTasks.ts', 'productIds: rows.filter((row) => Number(row.countable) === 1).map(', 'productIds: rows.map('), ['headerRule', 'deactivatedWithStock']],
    ['issued_by goes to every board viewer', edit('routes/inventoryChecks.ts', '...(canSeeStaffIdentity(user, row.created_by) ? { issued_by: row.issuer } : {})', 'issued_by: row.issuer'), ['issuedByVisibility']],
    ['the board does not send the task revision', edit('routes/inventoryChecks.ts', 'status: row.status, revision: row.revision, issued_at: row.started_at,', 'status: row.status, issued_at: row.started_at,'), ['boardRevision']],
    ['the filter reads the list family by family again (childless headers fill the pages)', edit('routes/inventoryChecks.ts', "  if (leafOnly) restriction = { excludeIdsJson: '[]' }\n", ''), ['issueFilterBound']],
    ['the filter reads family by family and the loop has no page bound', { 'routes/inventoryChecks.ts': [["  if (leafOnly) restriction = { excludeIdsJson: '[]' }\n", ''], ["    if (page >= maxPages) throw new InventoryCheckSessionError(400, 'inventory_check_task_too_many', { total: ids.size, limit, atLeast: true })\n", '']] }, ['issueFilterBound']],
    ['round 6: the filter never lets a family qualify through its header (the reader gets no leaf-only option)', edit('routes/inventoryChecks.ts', '...(leafOnly ? { leafOnly: true } : {}), ', ''), ['issueFilterHeaderChildren']],
    ['the reader lets a header qualify no family (the qualifying term is the plain header term)', edit('routes/products.ts', 'const header = qualifying && options.leafOnly ? HEADER_QUALIFIES_TERM : HEADER_TERM', 'const header = HEADER_TERM'), ['issueFilterHeaderChildren']],
    ['a filter that finds nothing answers the old missing-ids code', edit('routes/inventoryChecks.ts', "  if (!ids.size) throw new InventoryCheckSessionError(400, 'inventory_check_product_not_eligible')\n", ''), ['issueFilterNothing']],
    ['RV A: leaf-only applies to every list read', edit('routes/inventoryChecks.ts', 'const leafOnly = Boolean(extra.idsOnly) && restriction.restrictIdsJson === undefined && restriction.excludeIdsJson === undefined', 'const leafOnly = restriction.restrictIdsJson === undefined && restriction.excludeIdsJson === undefined'), ['issueFilterBound']],
    ['RV B: the leaf rule replaces a check-state restriction', edit('routes/inventoryChecks.ts', 'const leafOnly = Boolean(extra.idsOnly) && restriction.restrictIdsJson === undefined && restriction.excludeIdsJson === undefined', 'const leafOnly = Boolean(extra.idsOnly)'), ['issueFilterCheckState']],
    ['the page bound is one page short (no plus one)', edit('routes/inventoryChecks.ts', 'maxPages = Math.ceil(limit / LIST_MAX_PAGE_SIZE) + 1', 'maxPages = Math.ceil(limit / LIST_MAX_PAGE_SIZE)'), ['issueFilterBound']],
    ['the wired list raises its page size alone (a second source, not the reader clamp)', edit('lib/inventoryCheckList.ts', 'export const LIST_MAX_PAGE_SIZE = PRODUCT_LIST_MAX_PAGE_SIZE', 'export const LIST_MAX_PAGE_SIZE = 150'), ['pageSizeOneSource']],
    ['the task list cache ignores the products version', edit('routes/inventoryChecks.ts', "order=1`, { method: 'GET' }), c.executionCtx, `ict:${version}:${productsVersion}`", "order=1`, { method: 'GET' }), c.executionCtx, `ict:${version}`"), ['cacheKeyProducts']],
    ['the schema probe does not name the task indexes', edit('lib/inventoryCheckSessions.ts', "  'inventory_check_sessions_kind_task', 'inventory_check_sessions_open_task', 'inventory_check_sessions_task_board'])\nconst APPROVALS_SCHEMA", "  ])\nconst APPROVALS_SCHEMA"), ['schemaMissing']],
    ['issue by ids uses the older countable rule', edit('lib/inventoryCheckSessions.ts', 'AND ${TASK_COUNTABLE_SQL} ORDER BY p.id`', 'AND ${stockVisibleProductSql()} AND ${CHECKABLE_SQL} ORDER BY p.id`'), ['headerRule']],
    ['a retried issue is refused when its twin took the last place', edit('lib/inventoryCheckSessions.ts', '      if (twin) return { event: twin, replayed: true }\n', ''), ['taskCapReplay']],
    ['the task read-back ignores the request hash', edit('lib/inventoryCheckTasks.ts', "AND e.request_hash=@hash AND e.action='close' AND e.created_at=@now`\n", "AND e.action='close' AND e.created_at=@now`\n"), ['readBackHash']],
    ['the pickup read-back ignores the request hash', edit('lib/inventoryCheckTasks.ts', 'AND e.request_id<@pkTo AND e.request_hash=@hash AND', 'AND e.request_id<@pkTo AND'), ['readBackHash']],
    ['the Set answer ignores the request hash', edit('lib/stockSetClosesIssue.ts', 'AND e.request_hash=@hash AND e.action', 'AND e.action'), ['readBackHash']],
    ['a task puts products in check on the older list (the filter)', edit('lib/inventoryCheckProducts.ts', "WHERE i.product_id=${id} AND i.state='unstarted' AND s.status='open' AND ${NOT_A_TASK_SQL('s')} AND", "WHERE i.product_id=${id} AND i.state='unstarted' AND s.status='open' AND"), ['olderListUnaffected']],
    ['a task puts products in check on the older list (the page rows)', edit('lib/inventoryCheckProducts.ts', "WHERE i.product_id=pg.id AND i.state='unstarted' AND s.status='open' AND ${NOT_A_TASK_SQL('s')} AND", "WHERE i.product_id=pg.id AND i.state='unstarted' AND s.status='open' AND"), ['olderListUnaffected']],
    ['a task puts products in check on the older list (the summary)', edit('lib/inventoryCheckProducts.ts', "AND session_status='open' AND not_task)", "AND session_status='open')"), ['olderListUnaffected']],
  ]
  for (const [name, edits, targets] of MUTANTS) {
    for (const target of targets) {
      await check(`mutant killed: ${name} (by ${target})`, async () => {
        let caught = false
        try { await SCENARIOS[target](build(edits, WORLD[target] || {})) } catch (error) { caught = !/must match once/.test(String(error && error.message)) ? true : (() => { throw error })() }
        assert.equal(caught, true, `the planted mutant was not caught by ${target}`)
      })
    }
  }
  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) { console.log(failures.map((f) => `  FAILED ${f}`).join('\n')); process.exit(1) }
}
main().catch((error) => { console.error(error); process.exit(1) })
