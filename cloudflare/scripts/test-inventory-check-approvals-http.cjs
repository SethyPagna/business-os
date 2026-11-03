'use strict'
// Count approvals (lane 6.0.1045, ic_fix_stock): a submitted count that differs from stock waits for an administrator; approving applies the VARIANCE the
// count found (counted minus the stock the counter saw) to the stock of the moment, never an absolute figure; rejecting changes nothing. Applying is claimed
// before any stock is written, so a lost answer is repeated exactly and an approval that may have moved stock can no longer be rejected. Real routes, real cookie auth, the real stored switch rows, real SQLite; the stock writer
// (the Set sessions' commit) is replaced by a faithful double so the approval's own rules are what is under test (the real writer is exercised in
// scripts/read-budget/test-inventory-check-approvals-world.cjs on the real Worker).
//
// Run: node scripts/test-inventory-check-approvals-http.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const { transformSync } = require('esbuild')
const { loadAll } = require('./harness/load_migrations.cjs')

const cache = new Map()
function load(file) {
  if (cache.has(file)) return cache.get(file).exports
  const module = { exports: {} }; cache.set(file, module)
  // A dynamic import() is not resolved by this loader: it becomes the same require the static imports use.
  const source = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code.replace(/\bimport\(([^)]+)\)/g, 'Promise.resolve().then(() => require($1))')
  new Function('require', 'module', 'exports', source)(id => id.startsWith('.') ? load(path.resolve(path.dirname(file), id.endsWith('.ts') ? id : `${id}.ts`)) : require(id), module, module.exports)
  return module.exports
}
// The stock writer double: the Set sessions' commit. It enforces the line cap, refuses what the test says to refuse, and applies a Set to the tables the stock reader reads.
const writer = { cap: 24, fail: new Set(), calls: [], replays: 0, afterWrite: null }
cache.set(path.join(__dirname, '../src/routes/stockInCommit.ts'), { exports: { runStockInCommit: async (c, lines) => {
  assert.ok(c.get('user'), 'the approver is the acting user')
  const results = []
  for (const [index, line] of lines.entries()) {
    if (index >= writer.cap) { results.push({ ok: false, key: line.key, error: 'deferred', code: 'deferred' }); continue }
    const body = line.body, actor = c.get('user').id
    assert.equal(line.wire, 'adjust'); assert.match(body.client_request_id, /^[A-Za-z0-9_-]{8,120}$/); assert.ok(body.reason.length > 0 && body.reason.length < 200)
    // The stock writers' receipt: per approver and request id, the same request is replayed, a different one under the same id is refused.
    const canonical = JSON.stringify(body)
    const receipt = db.prepare('SELECT request_json FROM stock_mutation_receipts WHERE actor_id=? AND request_id=?').get(actor, body.client_request_id)
    if (receipt) {
      if (receipt.request_json !== canonical) { results.push({ ok: false, key: line.key, error: 'used for different data', code: 'idempotency_conflict' }); continue }
      writer.replays++; results.push({ ok: true, key: line.key, success: true, replayed: true }); continue
    }
    if (writer.fail.has(body.productId)) { results.push({ ok: false, key: line.key, error: 'Stock changed while saving.', code: 'stock_changed' }); continue }
    writer.calls.push(JSON.parse(JSON.stringify(body)))
    const ordinary = db.prepare('SELECT quantity FROM branch_stock WHERE product_id=? AND branch_id=?').get(body.productId, body.branchId).quantity
    let delta
    if (body.type === 'remove') {
      assert.equal(body.setScope, undefined); assert.ok(body.quantity > 0)
      if (body.quantity > ordinary) { results.push({ ok: false, key: line.key, error: 'Insufficient stock', code: 'insufficient_stock' }); continue }
      delta = -body.quantity
    } else {
      assert.equal(body.type, 'set'); assert.equal(body.setScope, 'branch', 'raising uses the lot-level Set writer'); assert.equal(typeof body.batchId, 'number')
      if (body.expectedBranchQuantity !== ordinary) { results.push({ ok: false, key: line.key, error: 'Stock changed since this received date was loaded.', code: 'stock_conflict' }); continue }
      delta = body.quantity - ordinary; assert.ok(delta > 0)
    }
    const lot = body.type === 'set' ? body.batchId : db.prepare('SELECT batch_id FROM branch_batch_stock WHERE batch_id IN (SELECT id FROM product_batches WHERE variant_product_id=?) AND branch_id=? AND quantity>0 ORDER BY batch_id').get(body.productId, body.branchId).batch_id
    db.prepare('UPDATE branch_stock SET quantity=quantity+? WHERE product_id=? AND branch_id=?').run(delta, body.productId, body.branchId)
    if (delta > 0) db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,?) ON CONFLICT(batch_id,branch_id) DO UPDATE SET quantity=quantity+?').run(lot, body.branchId, delta, delta)
    else db.prepare('UPDATE branch_batch_stock SET quantity=quantity+? WHERE batch_id=? AND branch_id=?').run(delta, lot, body.branchId)
    db.prepare('UPDATE products SET stock_quantity=stock_quantity+? WHERE id=?').run(delta, body.productId)
    db.prepare("INSERT INTO stock_mutation_receipts(actor_id,request_id,kind,request_json,written,response_status,response_json,completed_at) VALUES(?,?,'adjust',?,1,200,'{}',CURRENT_TIMESTAMP)").run(actor, body.client_request_id, canonical)
    results.push({ ok: true, key: line.key, success: true })
  }
  writer.afterWrite?.()
  return results
} } })
const productsRoute = load(path.join(__dirname, '../src/routes/inventoryCheckProducts.ts')).default
const sessionsRoute = load(path.join(__dirname, '../src/routes/inventoryChecks.ts')).default

let db, failApprovalRecord = false
function binding() {
  function prepare(sql) {
    return { sql, values: [], bind(...values) { return { ...this, values } }, async all() {
      return { success: true, results: db.prepare(sql).all(...this.values), meta: { changes: db.prepare('SELECT changes() AS n').get().n } }
    }, async run() { const result = db.prepare(sql).run(...this.values); return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } } } }
  }
  return { prepare, async batch(statements) {
    if (failApprovalRecord && statements.some(statement => /UPDATE inventory_check_approvals SET (applied_json|status)/.test(statement.sql))) throw new Error('D1 unavailable')
    db.exec('BEGIN')
    try { const result = []; for (const statement of statements) result.push(await statement.all()); db.exec('COMMIT'); return result }
    catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error }
  } }
}
const ADMIN = 900003, COUNTER = 900001, BLIND = 900002, FOREIGN = 900004, LEAD = 900006, NO_ADJUST = 900007, NO_STOCK = 900008
function reset() {
  db?.close(); db = new DatabaseSync(':memory:')
  for (const sql of loadAll({ through: 242 })) db.exec(sql)
  for (const file of ['0259_inventory_check_sessions.sql', '0285_inventory_check_items_latest.sql', '0286_inventory_check_approvals.sql']) db.exec(fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8'))
  const full = { inventory_checks: true, inventory_check_show_stock: true, inventory_check_show_barcode: true, inventory_check_show_brand: true, inventory_check_show_category: true, inventory_check_show_received: true }
  db.prepare('INSERT INTO roles(id,name,code,permissions) VALUES(900001,?,?,?),(900002,?,?,?),(900006,?,?,?),(900007,?,?,?),(900008,?,?,?)').run('Counter', 'employee', JSON.stringify(full),
    'Blind', 'blind', JSON.stringify({ inventory_checks: true, inventory_check_show_brand: true }),
    'Lead', 'lead', JSON.stringify({ ...full, inventory: true, inventory_check_approve: true }),
    'NoAdjust', 'noadjust', JSON.stringify({ ...full, inventory_check_approve: true }),
    'NoStock', 'nostock', JSON.stringify({ inventory_checks: true, inventory: true, inventory_check_approve: true }))
  db.exec(`INSERT INTO roles(id,name,code,permissions) VALUES(900003,'Administrator','admin','{}');
    INSERT INTO users(id,username,name,password,role_id,organization_id) VALUES(900001,'counter-one','Counter One','unused',900001,1),(900002,'blind-one','Blind One','unused',900002,1),
      (900003,'admin-one','Admin One','unused',900003,1),(900004,'foreign-one','Foreign One','unused',900003,2),(900006,'lead-one','Lead One','unused',900006,1),
      (900007,'noadjust-one','No Adjust','unused',900007,1),(900008,'nostock-one','No Stock','unused',900008,1);
    INSERT OR IGNORE INTO branches(id,name,is_active) VALUES(1,'One',1),(2,'Two',1)`)
  for (const actor of [ADMIN, COUNTER, BLIND, FOREIGN, LEAD, NO_ADJUST, NO_STOCK]) db.prepare("INSERT INTO user_sessions(user_id,token_hash,expires_at,last_seen_at) VALUES(?,?,'2099-01-01T00:00:00.000Z',CURRENT_TIMESTAMP)")
    .run(actor, createHash('sha256').update(`token-${actor}`).digest('hex'))
  for (let n = 1; n <= 12; n++) {
    const id = 910000 + n
    db.prepare('INSERT INTO products(id,name,stock_quantity,brand,brands,category,barcode) VALUES(?,?,5,?,?,?,?)').run(id, `Product ${String(n).padStart(2, '0')}`, `Brand ${n % 3}`, `Brand ${n % 3}`, 'Category', `88500000${id}`)
    db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,5)').run(id)
    db.prepare('INSERT INTO product_batches(id,variant_product_id,batch_key,received_at) VALUES(?,?,?,?)').run(id, id, `batch-${id}`, '2026-10-19')
    db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,5)').run(id)
  }
  // 910003 carries two damaged units: its stock now is 5 ordinary + 2 damaged = 7 (damaged units are not part of Set).
  db.prepare("INSERT INTO damaged_stock_lots(product_id,branch_id,quantity_remaining) VALUES(910003,1,2)").run()
  writer.cap = 24; writer.fail = new Set(); writer.calls = []; writer.replays = 0; writer.afterWrite = null; failApprovalRecord = false
}
const setSwitches = (simple, fix) => {
  db.exec("DELETE FROM system_flags WHERE key='read_switches'")
  const switches = {}
  if (simple) switches.ic_simple = { state: simple }
  if (fix) switches.ic_fix_stock = { state: fix }
  db.prepare("INSERT INTO system_flags(key,value) VALUES('read_switches',?)").run(JSON.stringify({ epoch: 1, switches }))
}
async function send(route, method, url, body, actor = ADMIN) {
  const tasks = []
  const response = await route.request(`http://local${url}`, { method, headers: { 'Content-Type': 'application/json', ...(actor ? { Cookie: `bos_session=token-${actor}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }, { DB: binding() }, { waitUntil: task => tasks.push(task) })
  await Promise.allSettled(tasks)
  return { status: response.status, body: await response.json() }
}
const products = (query = '', actor = ADMIN) => send(productsRoute, 'GET', `/${query ? `?${query}` : ''}`, undefined, actor)
const sessions = (method, url, body, actor = ADMIN) => send(sessionsRoute, method, url, body, actor)
const submit = (lines, over = {}, actor = COUNTER) => sessions('POST', '/submissions', { branchId: 1, requestId: 'submit-request-01', lines, ...over }, actor)
const decide = (id, body, actor = ADMIN) => sessions('POST', `/sessions/${id}/approval`, { requestId: 'approve-request-01', decision: 'approve', ...body }, actor)
const stockRows = () => ['products', 'product_batches', 'branch_stock', 'branch_batch_stock', 'damaged_stock_lots', 'inventory_movements', 'audit_logs'].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row => ({ ...row })))
const approvalRow = () => ({ ...db.prepare('SELECT * FROM inventory_check_approvals').get() })
const ordinary = id => db.prepare('SELECT quantity FROM branch_stock WHERE product_id=? AND branch_id=1').get(id).quantity
/** Stock moves outside the count (a sale or a correction): every ledger together, as the real writers keep them. */
const moveStock = (id, quantity) => { for (const sql of [`UPDATE branch_stock SET quantity=${quantity} WHERE product_id=${id} AND branch_id=1`, `UPDATE branch_batch_stock SET quantity=${quantity} WHERE batch_id=${id} AND branch_id=1`, `UPDATE products SET stock_quantity=${quantity} WHERE id=${id}`]) db.exec(sql) }
const line = (productId, countedQuantity, extra = {}) => ({ productId, countedQuantity, ...extra })
let groups = 0
const check = async (name, run) => { await run(); groups++; console.log(`PASS ${name}`) }
/** Count of 910002 -> 3 (lower by 2), 910003 -> 12 with 2 damaged (raise: Set 10), 910004 -> 9 (raise by 4); 910001 matches. */
const standard = () => submit([line(910001, 5, { checked: true }), line(910002, 3), line(910003, 12), line(910004, 9)])

async function main() {
  // First, while this process has not yet seen the table: only a positive probe is remembered, a miss is asked again.
  await check('ic_fix_stock ON while migration 0286 is not applied answers exactly like OFF, never 503: counts are recorded without an approval, nothing is tagged, the decision route does not exist', async () => {
    reset(); setSwitches('on', 'on'); db.exec('DROP TABLE inventory_check_approvals')
    const made = await submit([line(910002, 3)])
    assert.equal(made.status, 201, JSON.stringify(made.body)); assert.equal('approval' in made.body, false)
    const id = made.body.item.id
    const detail = await sessions('GET', `/sessions/${id}`)
    assert.equal(detail.status, 200); assert.equal('approval' in detail.body, false)
    const listed = await sessions('GET', '/sessions?page=1&pageSize=20')
    assert.equal(listed.status, 200); assert.equal(listed.body.items.some(item => 'approval' in item), false)
    const rows = await products('branchId=1&pageSize=12')
    assert.equal(rows.status, 200); assert.equal('capabilities' in rows.body, false); assert.equal(rows.body.items.some(item => 'check_pending' in item), false)
    const gone = await decide(id, {})
    assert.equal(gone.status, 404); assert.equal(gone.body.code, 'inventory_check_not_available')
    reset(); setSwitches('on', 'on')
    const applied = await submit([line(910002, 3)])
    assert.equal(applied.body.approval.status, 'pending', 'once the migration is applied the same switch takes effect without a restart')
  })

  await check('OFF (ic_fix_stock not on): no approval is created, none is shown, and the decision route does not exist', async () => {
    for (const form of [[undefined, undefined], ['on', undefined], ['on', 'off'], ['on', 'shadow']]) {
      reset(); setSwitches(...form)
      const made = await submit([line(910002, 3)], { requestId: `off-request-${form.join('')}-1`.slice(0, 40) })
      if (form[0] !== 'on') { assert.equal(made.status, 404); continue }
      assert.equal(made.status, 201); assert.equal('approval' in made.body, false)
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inventory_check_approvals').get().n, 0)
      const id = made.body.item.id
      assert.equal('approval' in (await sessions('GET', `/sessions/${id}`)).body, false)
      assert.equal((await sessions('GET', '/sessions?page=1&pageSize=20')).body.items.some(item => 'approval' in item), false)
      const gone = await decide(id, {})
      assert.equal(gone.status, 404); assert.equal(gone.body.code, 'inventory_check_not_available')
      const listed = (await products('branchId=1&pageSize=12')).body
      assert.equal('capabilities' in listed, false); assert.equal(listed.items.some(item => 'check_pending' in item), false)
    }
  })

  await check('ON: only a count that differs creates ONE pending approval, in the same commit; stock is untouched and the list says pending', async () => {
    reset(); setSwitches('on', 'on')
    const stock = stockRows()
    const matching = await submit([line(910001, 5), line(910003, 7)], { requestId: 'match-request-01' })
    assert.equal(matching.status, 201); assert.equal('approval' in matching.body, false, 'matching counts need no approval')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inventory_check_approvals').get().n, 0)
    const made = await standard()
    assert.equal(made.status, 201, JSON.stringify(made.body))
    assert.deepEqual({ status: made.body.approval.status, lines: made.body.approval.lines, applied: made.body.approval.applied, can_approve: made.body.approval.can_approve }, { status: 'pending', lines: 3, applied: 0, can_approve: false })
    const row = approvalRow()
    assert.deepEqual({ session_id: row.session_id, organization_id: row.organization_id, branch_id: row.branch_id, status: row.status, lines: row.lines, submitted_by: row.submitted_by, applied_json: row.applied_json },
      { session_id: made.body.item.id, organization_id: 1, branch_id: 1, status: 'pending', lines: 3, submitted_by: COUNTER, applied_json: '{}' })
    assert.deepEqual(stockRows(), stock, 'a pending approval moves no stock')
    const replay = await standard()
    assert.equal(replay.status, 200); assert.equal(replay.body.created, false); assert.equal(replay.body.approval.status, 'pending')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inventory_check_approvals').get().n, 1, 'a replay creates no second approval')
    const rows = (await products('branchId=1&pageSize=12')).body
    const byId = id => rows.items.find(item => item.id === id)
    assert.equal(byId(910002).check_pending, true); assert.equal(byId(910003).check_pending, true); assert.equal(byId(910004).check_pending, true)
    assert.equal('check_pending' in byId(910001), false, 'the matching line is not waiting for anything')
    assert.deepEqual(rows.capabilities, { fixStock: true, approveCounts: true })
    // The feature flag is for anyone who sees stock; whether they can act on it is the page's own rights check and the stock writer's. Approving also needs Adjust at Full.
    assert.deepEqual((await products('branchId=1&pageSize=12', NO_ADJUST)).body.capabilities, { fixStock: true, approveCounts: false })
    assert.deepEqual((await products('branchId=1&pageSize=12', COUNTER)).body.capabilities, { fixStock: true, approveCounts: false })
    assert.deepEqual((await products('branchId=1&pageSize=12', LEAD)).body.capabilities, { fixStock: true, approveCounts: true })
    const listed = (await sessions('GET', '/sessions?page=1&pageSize=20')).body.items.find(item => item.id === made.body.item.id)
    assert.equal(listed.approval.status, 'pending'); assert.equal(listed.approval.lines, 3)
    const detail = (await sessions('GET', `/sessions/${made.body.item.id}`)).body
    assert.equal(detail.approval.status, 'pending'); assert.deepEqual(detail.approval.applied_lines, {})
  })

  await check('who sees an approval: only a viewer who may see stock; a blind counter\'s differing count is still reviewed but invisible to them; another organization sees nothing', async () => {
    reset(); setSwitches('on', 'on')
    const made = await submit([line(910002, 99)], { requestId: 'blind-request-01' }, BLIND)
    assert.equal(made.status, 201); assert.equal('approval' in made.body, false); assert.equal(JSON.stringify(made.body).includes('approval'), false)
    assert.equal(db.prepare("SELECT lines FROM inventory_check_approvals WHERE status='pending'").get().lines, 1, 'the typed 99 against stock 5 is on the books for the administrator')
    assert.equal('approval' in (await sessions('GET', `/sessions/${made.body.item.id}`, undefined, BLIND)).body, false)
    assert.equal((await sessions('GET', '/sessions?page=1&pageSize=20', undefined, BLIND)).body.items.some(item => 'approval' in item), false)
    const blindProducts = (await products('branchId=1&pageSize=12', BLIND)).body
    assert.equal('capabilities' in blindProducts, false); assert.equal(blindProducts.items.some(item => 'check_pending' in item), false)
    assert.equal((await sessions('GET', `/sessions/${made.body.item.id}`, undefined, ADMIN)).body.approval.status, 'pending')
    assert.equal((await sessions('GET', `/sessions/${made.body.item.id}`, undefined, FOREIGN)).status, 404)
    assert.equal((await sessions('GET', '/sessions?page=1&pageSize=20', undefined, FOREIGN)).body.items.length, 0)
    const history = (await sessions('GET', `/sessions/${made.body.item.id}/history?page=1&pageSize=20`, undefined, BLIND)).body
    assert.equal(JSON.stringify(history).includes('approval'), false)
  })

  await check('an approval row of another organization is never shown, even beside a session of the viewer\'s own (every read filters on the organization itself)', async () => {
    reset(); setSwitches('on', 'on')
    const made = await submit([line(910002, 99)])
    const id = made.body.item.id
    db.exec('DROP TRIGGER inventory_check_approvals_identity'); db.prepare('UPDATE inventory_check_approvals SET organization_id=2').run()
    assert.equal('approval' in (await sessions('GET', `/sessions/${id}`, undefined, ADMIN)).body, false, 'detail')
    assert.equal((await sessions('GET', '/sessions?page=1&pageSize=20', undefined, ADMIN)).body.items.some(item => 'approval' in item), false, 'list')
    const rows = await products('branchId=1&pageSize=12', ADMIN)
    assert.equal(rows.body.items.some(item => item.check_pending === true), false, 'pending tags')
    const refused = await decide(id, {}, ADMIN)
    assert.equal(refused.status, 404, 'decision'); assert.equal(db.prepare('SELECT status FROM inventory_check_approvals').get().status, 'pending')
  })

  await check('who may decide: the extra, the stock field and Adjust at Full are all required, in the right organization; refusals change nothing', async () => {
    reset(); setSwitches('on', 'on')
    const made = await standard(); const id = made.body.item.id
    const stock = stockRows(), approval = approvalRow()
    for (const [name, actor, status, code] of [['the counter', COUNTER, 403, 'inventory_check_approve_required'], ['a blind approver', NO_STOCK, 403, 'inventory_check_approve_required'],
      ['an approver without Adjust', NO_ADJUST, 403, 'inventory_check_adjust_required'], ['another organization', FOREIGN, 404, 'inventory_check_session_not_found'], ['signed out', 0, 401, 'invalid_session'],
      ['the blind counter', BLIND, 403, 'inventory_check_approve_required']]) {
      const response = await decide(id, {}, actor)
      assert.equal(response.status, status, name); assert.equal(response.body.code, code, name)
      // Rejecting writes no stock, so Adjust is not needed for it; every other requirement is.
      if (actor !== NO_ADJUST) assert.equal((await decide(id, { decision: 'reject', requestId: 'reject-request-01' }, actor)).status, status, `${name} (reject)`)
    }
    assert.equal(writer.calls.length, 0); assert.deepEqual(stockRows(), stock); assert.deepEqual(approvalRow(), approval)
    const other = await submit([line(910001, 5)], { requestId: 'match-request-02' })
    const none = await decide(other.body.item.id, {})
    assert.equal(none.status, 404); assert.equal(none.body.code, 'inventory_check_approval_not_found')
    const crafted = [['no decision', { decision: undefined }], ['other decision', { decision: 'maybe' }], ['no request id', { requestId: 'short' }], ['note not text', { note: 5 }],
      ['long note', { note: 'x'.repeat(501) }]]
    for (const [name, over] of crafted) assert.equal((await decide(id, over)).status, 400, name)
    assert.equal((await sessions('POST', `/sessions/${id}/approval`, 'nope')).status, 400)
    assert.deepEqual(approvalRow(), approval); assert.equal(writer.calls.length, 0)
  })

  await check('approve: stock becomes the count minus damaged units (count 12 with 2 damaged sets 10), line by line on the Free plan, each repeat of the same request continuing it', async () => {
    reset(); setSwitches('on', 'on'); writer.cap = 1
    const made = await standard(); const id = made.body.item.id
    const first = await decide(id, {})
    assert.equal(first.status, 200, JSON.stringify(first.body))
    assert.deepEqual({ applied: first.body.applied, remaining: first.body.remaining, done: first.body.done, status: first.body.approval.status }, { applied: 1, remaining: 2, done: false, status: 'pending' })
    assert.deepEqual(writer.calls.map(call => call.productId), [910002], 'one line per request on the Free plan, in product order')
    assert.equal(ordinary(910002), 3); assert.equal(ordinary(910003), 5, 'the next line has not been touched')
    assert.equal(db.prepare('SELECT state FROM inventory_check_items WHERE product_id=910002').get().state, 'done', 'the applied line is resolved')
    assert.equal(db.prepare('SELECT state FROM inventory_check_items WHERE product_id=910003').get().state, 'issue')
    const midway = (await products('branchId=1&pageSize=12')).body.items
    assert.equal(midway.find(item => item.id === 910003).check_pending, true, 'still pending while lines wait')
    assert.equal('check_pending' in midway.find(item => item.id === 910002), false, 'a line already applied no longer waits for anything')
    assert.deepEqual({ applying: first.body.approval.applying, request: first.body.approval.applying_request_id }, { applying: true, request: 'approve-request-01' }, 'the approver who started it is told which request continues it')
    assert.equal((await sessions('GET', `/sessions/${id}`, undefined, LEAD)).body.approval.applying_request_id, undefined, 'and nobody else is')
    const second = await decide(id, {})
    assert.deepEqual({ applied: second.body.applied, remaining: second.body.remaining, done: second.body.done }, { applied: 1, remaining: 1, done: false })
    assert.equal(ordinary(910003), 10, 'count 12 minus 2 damaged = Set 10')
    const third = await decide(id, { note: 'Counted twice' })
    assert.deepEqual({ applied: third.body.applied, remaining: third.body.remaining, done: third.body.done, status: third.body.approval.status }, { applied: 1, remaining: 0, done: true, status: 'approved' })
    assert.equal(ordinary(910004), 9)
    assert.equal(ordinary(910001), 5, 'a matching count is never written')
    assert.equal(writer.calls.length, 3)
    const bodies = Object.fromEntries(writer.calls.map(call => [call.productId, call]))
    assert.deepEqual({ type: bodies[910002].type, quantity: bodies[910002].quantity, setScope: bodies[910002].setScope }, { type: 'remove', quantity: 2, setScope: undefined })
    assert.deepEqual({ quantity: bodies[910003].quantity, setScope: bodies[910003].setScope, batchId: bodies[910003].batchId, expected: bodies[910003].expectedBranchQuantity }, { quantity: 10, setScope: 'branch', batchId: 910003, expected: 5 })
    assert.equal(bodies[910002].client_request_id, 'approve-request-01-910002'); assert.match(bodies[910003].reason, /counted 12, 2 damaged/)
    const row = approvalRow()
    assert.deepEqual({ status: row.status, decided_by: row.decided_by, decided_by_name: row.decided_by_name, decision_note: row.decision_note, decision_request_id: row.decision_request_id }, { status: 'approved', decided_by: ADMIN, decided_by_name: 'admin-one', decision_note: 'Counted twice', decision_request_id: 'approve-request-01' })
    assert.match(row.decided_at, /^\d{4}-\d{2}-\d{2}T/)
    assert.deepEqual(Object.keys(JSON.parse(row.applied_json).lines).sort(), ['910002', '910003', '910004'])
    assert.deepEqual(JSON.parse(row.applied_json).lines['910003'], { before: 5, target: 10, after: 10, at: JSON.parse(row.applied_json).lines['910003'].at })
    const items = db.prepare('SELECT product_id,state,counted_quantity,reason,revision,updated_by FROM inventory_check_items ORDER BY product_id').all().map(item => ({ ...item }))
    assert.deepEqual(items, [
      { product_id: 910001, state: 'done', counted_quantity: 5, reason: null, revision: 1, updated_by: COUNTER },
      { product_id: 910002, state: 'done', counted_quantity: 3, reason: null, revision: 2, updated_by: ADMIN },
      { product_id: 910003, state: 'done', counted_quantity: 12, reason: null, revision: 2, updated_by: ADMIN },
      { product_id: 910004, state: 'done', counted_quantity: 9, reason: null, revision: 2, updated_by: ADMIN }])
    const rows = (await products('branchId=1&pageSize=12')).body.items
    assert.ok([910002, 910003, 910004].every(pid => rows.find(item => item.id === pid).check_status === 'ok' && !('check_pending' in rows.find(item => item.id === pid))))
    const history = (await sessions('GET', `/sessions/${id}/history?page=1&pageSize=50`)).body
    const approved = history.items.filter(item => item.after?.approval)
    assert.equal(approved.length, 4, 'three applied lines and the decision')
    const decision = approved.find(item => item.product_id === null)
    assert.deepEqual({ before: decision.before.approval, after: decision.after.approval, actor: decision.actor_id }, { before: 'pending', after: 'approved', actor: ADMIN })
    const applied = approved.find(item => item.product_id === 910003)
    assert.deepEqual({ before: applied.before.state, after: applied.after.state, from: applied.after.stock_before, to: applied.after.stock_after, counted: applied.after.counted_quantity }, { before: 'issue', after: 'done', from: 5, to: 10, counted: 12 })
    const detail = (await sessions('GET', `/sessions/${id}`)).body
    assert.equal(detail.approval.status, 'approved'); assert.equal(detail.approval.decided_by_name, 'admin-one'); assert.equal(detail.approval.applied, 3)
    assert.equal((await sessions('GET', `/sessions/${id}/history?page=1&pageSize=50`, undefined, BLIND)).body.items.some(item => item.after?.approval), false)
  })

  await check('approve on a plan that takes every line at once finishes in one request; a person with the extra (not an administrator) can do it', async () => {
    reset(); setSwitches('on', 'on')
    const made = await standard()
    const done = await decide(made.body.item.id, {}, LEAD)
    assert.deepEqual({ applied: done.body.applied, remaining: done.body.remaining, done: done.body.done, status: done.body.approval.status }, { applied: 3, remaining: 0, done: true, status: 'approved' })
    assert.deepEqual([ordinary(910002), ordinary(910003), ordinary(910004)], [3, 10, 9])
    assert.equal(approvalRow().decided_by, LEAD)
  })

  await check('a decision is final and idempotent: the same request again is the same answer with no write; any other decision or request is refused', async () => {
    reset(); setSwitches('on', 'on')
    const made = await standard(); const id = made.body.item.id
    await decide(id, {})
    const stock = stockRows(), approval = approvalRow(), writes = writer.calls.length, events = db.prepare('SELECT COUNT(*) AS n FROM inventory_check_events').get().n
    const replay = await decide(id, {})
    assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true); assert.equal(replay.body.done, true); assert.equal(replay.body.applied, 0)
    assert.equal((await decide(id, { requestId: 'approve-request-02' })).status, 409)
    assert.equal((await decide(id, { requestId: 'approve-request-02' })).body.code, 'inventory_check_approval_decided')
    const reject = await decide(id, { decision: 'reject' })
    assert.equal(reject.status, 409, 'the same request id cannot turn an approval into a rejection')
    assert.equal((await decide(id, { decision: 'reject', requestId: 'reject-request-01' })).body.code, 'inventory_check_approval_decided')
    assert.deepEqual(stockRows(), stock); assert.deepEqual(approvalRow(), approval); assert.equal(writer.calls.length, writes)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inventory_check_events').get().n, events)
    assert.throws(() => db.exec("UPDATE inventory_check_approvals SET status='rejected'"), /inventory_check_approval_immutable/)
  })

  await check('reject: nothing changes but the decision; it records who, when and why, and is final', async () => {
    reset(); setSwitches('on', 'on')
    const made = await standard(); const id = made.body.item.id
    const stock = stockRows(), items = db.prepare('SELECT * FROM inventory_check_items ORDER BY product_id').all().map(row => ({ ...row }))
    const rejected = await decide(id, { decision: 'reject', requestId: 'reject-request-01', note: '  Recount first  ' }, LEAD)
    assert.equal(rejected.status, 200, JSON.stringify(rejected.body)); assert.equal(rejected.body.approval.status, 'rejected'); assert.equal(rejected.body.done, true)
    assert.deepEqual(stockRows(), stock, 'rejecting writes no stock'); assert.equal(writer.calls.length, 0, 'the stock writer is never reached')
    assert.deepEqual(db.prepare('SELECT * FROM inventory_check_items ORDER BY product_id').all().map(row => ({ ...row })), items, 'the counts and their notes stay as submitted')
    const row = approvalRow()
    assert.deepEqual({ status: row.status, decided_by: row.decided_by, decided_by_name: row.decided_by_name, decision_note: row.decision_note, decision_request_id: row.decision_request_id, applied_json: row.applied_json },
      { status: 'rejected', decided_by: LEAD, decided_by_name: 'lead-one', decision_note: 'Recount first', decision_request_id: 'reject-request-01', applied_json: '{}' })
    assert.match(row.decided_at, /^\d{4}-\d{2}-\d{2}T/)
    const replay = await decide(id, { decision: 'reject', requestId: 'reject-request-01' }, LEAD)
    assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true)
    assert.equal((await decide(id, { decision: 'approve', requestId: 'approve-request-09' })).status, 409, 'a rejected count cannot be approved later')
    const history = (await sessions('GET', `/sessions/${id}/history?page=1&pageSize=50`)).body.items.find(item => item.after?.approval === 'rejected')
    assert.equal(history.actor_id, LEAD); assert.equal(history.before.approval, 'pending')
    const rows = (await products('branchId=1&pageSize=12')).body.items
    assert.equal(rows.find(item => item.id === 910002).check_status, 'issue'); assert.equal('check_pending' in rows.find(item => item.id === 910002), false)
  })

  await check('a rejection after some lines were applied is refused: it would leave stock half changed with no record', async () => {
    reset(); setSwitches('on', 'on'); writer.cap = 1
    const made = await standard(); const id = made.body.item.id
    await decide(id, {})
    const before = approvalRow()
    const rejected = await decide(id, { decision: 'reject', requestId: 'reject-request-01' })
    assert.equal(rejected.status, 409); assert.equal(rejected.body.code, 'inventory_check_approval_partly_applied')
    assert.deepEqual(approvalRow(), before)
  })

  await check('the count is applied as a VARIANCE: what the counter saw is the baseline, so a sale after the count survives it (saw 5, sale leaves 4, counted 3 gives 2, not 3)', async () => {
    reset(); setSwitches('on', 'on')
    const made = await submit([line(910002, 3, { seenQuantity: 5 })]); const id = made.body.item.id
    assert.deepEqual(JSON.parse(approvalRow().baselines_json), { 910002: 5 }, 'what the counter saw is recorded at submit')
    moveStock(910002, 4)
    const done = await decide(id, {})
    assert.equal(done.status, 200, JSON.stringify(done.body)); assert.equal(done.body.done, true)
    assert.equal(ordinary(910002), 2, 'live 4 + (counted 3 - saw 5) = 2')
    assert.deepEqual(writer.calls.map(call => ({ type: call.type, quantity: call.quantity })), [{ type: 'remove', quantity: 2 }], 'the variance the count found (3 against the 5 it saw) is removed from the stock of now')
    assert.deepEqual(JSON.parse(approvalRow().applied_json).lines['910002'], { before: 4, target: 2, after: 2, at: JSON.parse(approvalRow().applied_json).lines['910002'].at })
    // The same sale happened between loading the page and submitting: the server's own baseline (4) differs from what the counter saw (5); the count is still measured against what was seen.
    reset(); setSwitches('on', 'on'); moveStock(910002, 4)
    const earlier = await submit([line(910002, 3, { seenQuantity: 5 })])
    assert.equal((await decide(earlier.body.item.id, {})).status, 200); assert.equal(ordinary(910002), 2)
    // Counted 26 (saw 24), one removed after the count: 25, not 26. A raise is a guarded lot-level Set.
    reset(); setSwitches('on', 'on'); moveStock(910002, 24)
    const raise = await submit([line(910002, 26, { seenQuantity: 24 })]); moveStock(910002, 23)
    assert.equal((await decide(raise.body.item.id, {})).status, 200); assert.equal(ordinary(910002), 25)
    assert.deepEqual({ type: writer.calls[0].type, quantity: writer.calls[0].quantity, expected: writer.calls[0].expectedBranchQuantity }, { type: 'set', quantity: 25, expected: 23 })
    // A sale that takes more than the count found never goes below zero.
    reset(); setSwitches('on', 'on')
    const empty = await submit([line(910002, 0, { seenQuantity: 5 })]); moveStock(910002, 3)
    assert.equal((await decide(empty.body.item.id, {})).status, 200); assert.equal(ordinary(910002), 0, 'max(0, 3 + 0 - 5)')
    // What the counter saw equals the count: nothing was found, so nothing is written, even though the stock at submit was a different figure.
    reset(); setSwitches('on', 'on'); moveStock(910002, 4)
    const same = await submit([line(910002, 5, { seenQuantity: 5 })]); const sameId = same.body.item.id
    const settled = await decide(sameId, {})
    assert.equal(settled.status, 200); assert.equal(settled.body.done, true); assert.equal(writer.calls.length, 0); assert.equal(ordinary(910002), 4)
    assert.equal(JSON.parse(approvalRow().applied_json).lines['910002'].settled, true); assert.equal(approvalRow().applying_request_id, null, 'nothing was written, so nothing was claimed')
    // A viewer who could not see stock is measured against the stock at submit (the same variance, with that figure as the baseline).
    reset(); setSwitches('on', 'on')
    const blind = await submit([line(910002, 3)], { requestId: 'blind-request-02' }, BLIND); moveStock(910002, 4)
    assert.deepEqual(JSON.parse(approvalRow().baselines_json), { 910002: 5 })
    assert.equal((await decide(blind.body.item.id, {})).status, 200); assert.equal(ordinary(910002), 2)
  })

  await check('what cannot be applied safely is refused before any write: inconsistent stock, a fractional target, a raise with no received date', async () => {
    reset(); setSwitches('on', 'on')
    let made = await standard(); let id = made.body.item.id
    db.exec('UPDATE products SET stock_quantity=99 WHERE id=910002')
    let refused = await decide(id, {})
    assert.equal(refused.status, 409); assert.equal(refused.body.code, 'inventory_check_stock_inconsistent'); assert.deepEqual(refused.body.productIds, [910002])
    assert.equal(writer.calls.length, 0, 'not even the healthy lines were written')
    reset(); setSwitches('on', 'on')
    made = await submit([line(910002, 2.5)]); id = made.body.item.id
    refused = await decide(id, {})
    assert.equal(refused.status, 409); assert.equal(refused.body.code, 'inventory_check_target_not_whole'); assert.deepEqual(refused.body.productIds, [910002])
    reset(); setSwitches('on', 'on')
    // A product with no stock and no live received date (its only lot was emptied and closed) cannot be raised by a lot-level Set.
    for (const sql of ['UPDATE branch_stock SET quantity=0 WHERE product_id=910004', 'UPDATE branch_batch_stock SET quantity=0 WHERE batch_id=910004', 'UPDATE products SET stock_quantity=0 WHERE id=910004', 'UPDATE product_batches SET is_active=0 WHERE variant_product_id=910004']) db.exec(sql)
    made = await submit([line(910004, 9)]); id = made.body.item.id
    refused = await decide(id, {})
    assert.equal(refused.status, 409); assert.equal(refused.body.code, 'inventory_check_no_lot'); assert.deepEqual(refused.body.productIds, [910004])
    assert.equal(writer.calls.length, 0); assert.equal(approvalRow().status, 'pending')
    // A count below the damaged units cannot be true (they are on the shelf too): refused clearly, nothing written.
    reset(); setSwitches('on', 'on')
    made = await submit([line(910003, 1)])
    const low = await decide(made.body.item.id, {})
    assert.equal(low.status, 409); assert.equal(low.body.code, 'inventory_check_count_below_damaged'); assert.deepEqual(low.body.productIds, [910003])
    assert.equal(writer.calls.length, 0); assert.equal(ordinary(910003), 5); assert.equal(approvalRow().status, 'pending'); assert.equal(approvalRow().applying_request_id, null)
    // An approval with no recorded baseline for a line (a row from before baselines were kept) is refused for that line, not guessed.
    reset(); setSwitches('on', 'on')
    made = await submit([line(910002, 3)])
    db.exec("DROP TRIGGER inventory_check_approvals_identity"); db.exec("UPDATE inventory_check_approvals SET baselines_json='{}'")
    const unseen = await decide(made.body.item.id, {})
    assert.equal(unseen.status, 409); assert.equal(unseen.body.code, 'inventory_check_baseline_missing'); assert.deepEqual(unseen.body.productIds, [910002])
    assert.equal(writer.calls.length, 0)
  })

  await check('a refused or failed stock line records nothing for it, keeps the lines that landed, and a repeat finishes the rest', async () => {
    reset(); setSwitches('on', 'on'); writer.fail = new Set([910003])
    const made = await standard(); const id = made.body.item.id
    const partial = await decide(id, {})
    assert.equal(partial.status, 200); assert.equal(partial.body.done, false); assert.equal(partial.body.applied, 2)
    assert.deepEqual(partial.body.failed.map(entry => ({ productId: entry.productId, code: entry.code })), [{ productId: 910003, code: 'stock_changed' }])
    assert.deepEqual(Object.keys(JSON.parse(approvalRow().applied_json).lines).sort(), ['910002', '910004'])
    assert.equal(db.prepare('SELECT state FROM inventory_check_items WHERE product_id=910003').get().state, 'issue')
    assert.equal(approvalRow().status, 'pending')
    writer.fail = new Set([910003]); writer.calls = []
    const stuck = await decide(id, {})
    assert.equal(stuck.status, 409); assert.equal(stuck.body.code, 'inventory_check_stock_write_refused'); assert.equal(stuck.body.failed[0].productId, 910003)
    writer.fail = new Set(); writer.calls = []
    const rest = await decide(id, {})
    assert.deepEqual({ applied: rest.body.applied, done: rest.body.done }, { applied: 1, done: true })
    assert.deepEqual(writer.calls.map(call => call.productId), [910003], 'only the unfinished line is written again')
  })

  await check('P2: a lost answer after the stock landed: the approval is claimed, so it cannot be rejected, and the repeat finishes it without writing twice', async () => {
    reset(); setSwitches('on', 'on')
    const made = await standard(); const id = made.body.item.id
    failApprovalRecord = true
    const lost = await decide(id, {})
    assert.equal(lost.status, 503); assert.equal(lost.body.code, 'inventory_check_outcome_unknown')
    assert.deepEqual([ordinary(910002), ordinary(910003), ordinary(910004)], [3, 10, 9], 'the stock did land')
    const claimed = approvalRow()
    assert.deepEqual({ status: claimed.status, applied: claimed.applied_json, by: claimed.applying_by, request: claimed.applying_request_id }, { status: 'pending', applied: '{}', by: ADMIN, request: 'approve-request-01' }, 'claimed before the first write')
    assert.deepEqual(Object.keys(JSON.parse(claimed.plan_json)).sort(), ['910002', '910003', '910004'], 'with the exact figures each line was sent with')
    failApprovalRecord = false
    const reject = await decide(id, { decision: 'reject', requestId: 'reject-request-01' })
    assert.equal(reject.status, 409); assert.equal(reject.body.code, 'inventory_check_approval_in_progress'); assert.equal(approvalRow().status, 'pending', 'never rejected with stock already moved')
    assert.throws(() => db.exec("UPDATE inventory_check_approvals SET status='rejected',decided_by=1,decided_at='x',decision_request_id='x'"), /inventory_check_approval_immutable/, 'and not by a direct write either')
    const other = await decide(id, { requestId: 'approve-request-77' }, LEAD)
    assert.equal(other.status, 409); assert.equal(other.body.code, 'inventory_check_approval_in_progress', 'another approver cannot continue: the stock writers\' receipts are per approver')
    moveStock(910002, 2) // a sale after the lost answer: the repeat must not apply the count a second time, nor undo the sale
    const writes = writer.calls.length
    const repaired = await decide(id, {})
    assert.equal(repaired.status, 200, JSON.stringify(repaired.body)); assert.equal(repaired.body.done, true); assert.equal(repaired.body.approval.status, 'approved')
    assert.equal(writer.calls.length, writes, 'nothing was applied again'); assert.equal(writer.replays, 3, 'every line was replayed from its receipt')
    assert.deepEqual([ordinary(910002), ordinary(910003), ordinary(910004)], [2, 10, 9])
    assert.deepEqual(Object.values(JSON.parse(approvalRow().applied_json).lines).map(entry => entry.settled), [undefined, undefined, undefined], 'recorded from the plan that was sent')
    assert.equal(JSON.parse(approvalRow().applied_json).lines['910002'].before, 5, 'the figures the line was sent with, not the live ones')
    assert.equal(approvalRow().plan_json, '{}')
    // Continuing under another request id uses the claimed one.
    reset(); setSwitches('on', 'on')
    const again = await standard(); failApprovalRecord = true
    assert.equal((await decide(again.body.item.id, {})).status, 503); failApprovalRecord = false
    const continued = await decide(again.body.item.id, { requestId: 'approve-request-02' })
    assert.equal(continued.status, 200, JSON.stringify(continued.body)); assert.equal(continued.body.done, true)
    assert.equal(approvalRow().decision_request_id, 'approve-request-01', 'the claimed id decided it'); assert.equal(writer.calls.length, 3)
  })

  await check('a claim made for a request whose lines were all refused cleanly is released (nothing was written): the approval can be rejected again and is planned afresh', async () => {
    reset(); setSwitches('on', 'on'); writer.fail = new Set([910002, 910003, 910004])
    const made = await standard(); const id = made.body.item.id
    const refused = await decide(id, {})
    assert.equal(refused.status, 409); assert.equal(refused.body.code, 'inventory_check_stock_write_refused')
    assert.deepEqual({ request: approvalRow().applying_request_id, by: approvalRow().applying_by, plan: approvalRow().plan_json }, { request: null, by: null, plan: '{}' })
    writer.fail = new Set(); moveStock(910002, 4)
    const done = await decide(id, { requestId: 'approve-request-02' })
    assert.equal(done.status, 200); assert.equal(ordinary(910002), 2, 'planned again from the stock of now: 4 + 3 - 5')
    reset(); setSwitches('on', 'on'); writer.fail = new Set([910002, 910003, 910004])
    const rejectable = await standard()
    await decide(rejectable.body.item.id, {})
    assert.equal((await decide(rejectable.body.item.id, { decision: 'reject', requestId: 'reject-request-01' })).status, 200)
  })

  await check('a raise tops up a received date that holds this branch\'s stock, not merely the newest one', async () => {
    reset(); setSwitches('on', 'on')
    db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,received_at) VALUES(920001,910004,'batch-elsewhere','2026-10-25')").run()
    db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(910004,2,3)').run()
    db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(920001,2,3)').run()
    db.prepare('UPDATE products SET stock_quantity=8 WHERE id=910004').run()
    const made = await submit([line(910004, 9)])
    assert.equal((await decide(made.body.item.id, {})).status, 200)
    assert.equal(writer.calls[0].batchId, 910004, 'the newest lot (920001) has nothing at branch 1')
    assert.equal(ordinary(910004), 9)
  })

  await check('nobody approves their own count unless they are the only approver: refused on the server before any write; rejecting one\'s own count stays allowed', async () => {
    reset(); setSwitches('on', 'on')
    const made = await submit([line(910002, 3), line(910003, 12)], { requestId: 'lead-request-01' }, LEAD)
    const id = made.body.item.id, before = stockRows()
    const own = await decide(id, {}, LEAD)
    assert.equal(own.status, 403); assert.equal(own.body.code, 'inventory_check_self_approval')
    assert.deepEqual(stockRows(), before); assert.equal(approvalRow().status, 'pending'); assert.equal(writer.calls.length, 0)
    const other = await decide(id, {}, ADMIN)
    assert.equal(other.status, 200); assert.equal(other.body.done, true, 'another person may approve it')
    reset(); setSwitches('on', 'on')
    const adminMade = await submit([line(910002, 3)], { requestId: 'admin-request-01' }, ADMIN)
    const adminOwn = await decide(adminMade.body.item.id, {}, ADMIN)
    assert.equal(adminOwn.status, 403, 'an administrator is included'); assert.equal(adminOwn.body.code, 'inventory_check_self_approval')
    assert.equal(writer.calls.length, 0)
    const withdrawn = await decide(adminMade.body.item.id, { decision: 'reject', requestId: 'reject-request-01' }, ADMIN)
    assert.equal(withdrawn.status, 200); assert.equal(withdrawn.body.approval.status, 'rejected')
    reset(); setSwitches('on', 'on')
    db.prepare('UPDATE users SET is_active=0 WHERE id=?').run(ADMIN)
    const solo = await submit([line(910002, 3)], { requestId: 'solo-request-01' }, LEAD)
    const soloOwn = await decide(solo.body.item.id, {}, LEAD)
    assert.equal(soloOwn.status, 200); assert.equal(soloOwn.body.done, true, 'the only approver (others lack the extra, the stock field or Adjust, or are in another organization) is not locked out')
  })

  await check('two approvers racing: only the state each one read can be written, the other is told to reload', async () => {
    reset(); setSwitches('on', 'on'); writer.cap = 1
    const made = await standard(); const id = made.body.item.id
    writer.afterWrite = () => { writer.afterWrite = null; db.prepare("UPDATE inventory_check_approvals SET applied_json='{\"lines\":{\"910002\":{\"before\":5,\"target\":3,\"after\":3,\"at\":\"x\"}}}'").run() }
    const raced = await decide(id, {}, ADMIN)
    assert.equal(raced.status, 409); assert.equal(raced.body.code, 'inventory_check_conflict')
  })

  await check('the approval cannot be forged around the API: its rows are immutable once decided and never deleted', async () => {
    reset(); setSwitches('on', 'on')
    const made = await standard()
    await decide(made.body.item.id, { decision: 'reject', requestId: 'reject-request-01' })
    assert.throws(() => db.exec("UPDATE inventory_check_approvals SET decision_note='edited'"), /inventory_check_approval_immutable/)
    assert.throws(() => db.exec('DELETE FROM inventory_check_approvals'), /inventory_check_approval_immutable/)
    assert.throws(() => db.exec("UPDATE inventory_check_approvals SET submitted_by=1"), /inventory_check_approval_immutable/)
  })

  console.log(`${groups} groups passed`)
}
main().catch(error => { console.error(error); process.exit(1) })
