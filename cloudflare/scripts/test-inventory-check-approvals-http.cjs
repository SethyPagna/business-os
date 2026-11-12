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
const { APPROVAL_CLAIM_HELD_SQL, APPROVAL_CLAIM_LOST } = load(path.join(__dirname, '../src/lib/stockMutationReceipt.ts'))
// The stock writer double: the Set sessions' commit, standing in for the lot-level Set writer (lib/stockLotAdjustment.ts). It enforces the line cap, refuses what the test says to refuse, and applies
// a Set WITH A VARIANCE exactly as the real writer does: the target is max(0, live + counted - seen) of the lot (or of the branch, for a branch-total line), computed here from the quantity it reads, and
// it answers with the before and after figures, the variance and the operation it recorded (the real writer's answer; the real writer itself is exercised in
// scripts/test-inventory-check-approval-lines-native.cjs and scripts/test-inventory-check-approvals-world-native.cjs).
const writer = { cap: 24, fail: new Set(), calls: [], replays: 0, afterWrite: null, beforeLine: null, operations: 0 }
cache.set(path.join(__dirname, '../src/routes/stockInCommit.ts'), { exports: { runStockInCommit: async (c, lines) => {
  assert.ok(c.get('user'), 'the approver is the acting user')
  const results = []
  for (const [index, line] of lines.entries()) {
    if (index >= writer.cap) { results.push({ ok: false, key: line.key, error: 'deferred', code: 'deferred' }); continue }
    const body = line.body, actor = c.get('user').id
    // A test holds a request here, just before its receipt is created, to let another approver act first.
    if (writer.beforeLine) await writer.beforeLine(body, actor)
    // The real writers check the claim inside the batch that writes the stock (the receipt's written mark): nothing may be awaited between this check and the write below.
    if (body.approvalClaim && !db.prepare(`SELECT ${APPROVAL_CLAIM_HELD_SQL} AS held`).get({ claimSession: body.approvalClaim.sessionId, claimKey: body.approvalClaim.key, actor }).held) {
      results.push({ ok: false, key: line.key, error: 'claim lost', code: APPROVAL_CLAIM_LOST }); continue
    }
    assert.equal(line.wire, 'adjust'); assert.match(body.client_request_id, /^[A-Za-z0-9_-]{8,120}$/); assert.ok(body.reason.length > 0 && body.reason.length < 200)
    // The stock writers' receipt: per approver and request id, the same request is replayed, a different one under the same id is refused.
    const canonical = JSON.stringify(body)
    const receipt = db.prepare('SELECT request_json,response_json FROM stock_mutation_receipts WHERE actor_id=? AND request_id=?').get(actor, body.client_request_id)
    if (receipt) {
      if (receipt.request_json !== canonical) { results.push({ ok: false, key: line.key, error: 'used for different data', code: 'idempotency_conflict' }); continue }
      writer.replays++; results.push({ ok: true, key: line.key, ...JSON.parse(receipt.response_json || '{}'), success: true, replayed: true }); continue
    }
    if (writer.fail.has(body.productId)) { results.push({ ok: false, key: line.key, error: 'Stock changed while saving.', code: 'stock_changed' }); continue }
    writer.calls.push(JSON.parse(JSON.stringify(body)))
    assert.equal(body.type, 'set'); assert.ok(body.setScope === 'lot' || body.setScope === 'branch'); assert.equal(typeof body.batchId, 'number'); assert.equal(body.quantity, undefined, 'a variance line carries no figure of its own')
    assert.ok(Number.isFinite(body.variance.counted) && Number.isFinite(body.variance.seen)); assert.ok(body.approvalClaim, 'a variance is accepted only under an approval claim')
    const lotRow = db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=? AND branch_id=?').get(body.batchId, body.branchId)
    const lotNow = lotRow?.quantity ?? 0, branchNow = db.prepare('SELECT quantity FROM branch_stock WHERE product_id=? AND branch_id=?').get(body.productId, body.branchId).quantity
    const wanted = (body.setScope === 'lot' ? lotNow : branchNow) + body.variance.counted - body.variance.seen, target = Math.max(0, wanted)
    if (Math.abs(target - Math.round(target)) > 1e-9) { results.push({ ok: false, key: line.key, error: 'not whole', code: 'inventory_check_target_not_whole' }); continue }
    const lotDelta = body.setScope === 'lot' ? target - lotNow : target - branchNow
    if (lotNow + lotDelta < 0) { results.push({ ok: false, key: line.key, error: 'The selected received date does not have enough stock.', code: 'selected_lot_unavailable' }); continue }
    const branchAfter = body.setScope === 'lot' ? Math.max(0, branchNow + lotDelta) : target
    if (lotDelta !== 0) {
      db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,?) ON CONFLICT(batch_id,branch_id) DO UPDATE SET quantity=?').run(body.batchId, body.branchId, lotNow + lotDelta, lotNow + lotDelta)
      db.prepare('UPDATE branch_stock SET quantity=? WHERE product_id=? AND branch_id=?').run(branchAfter, body.productId, body.branchId)
      db.prepare('UPDATE products SET stock_quantity=stock_quantity+? WHERE id=?').run(branchAfter - branchNow, body.productId)
    }
    const answer = { success: true, branchId: body.branchId, productId: body.productId, batchId: body.batchId, setScope: body.setScope, quantity: Math.abs(lotDelta),
      before: { lotQuantity: lotNow, branchQuantity: branchNow }, after: { lotQuantity: lotNow + lotDelta, branchQuantity: branchAfter },
      variance: { counted: body.variance.counted, seen: body.variance.seen, wanted, ...(wanted < 0 ? { clamped: true } : {}) },
      ...(lotDelta !== 0 ? { operation_id: `op-${++writer.operations}`, action_history_id: writer.operations } : {}) }
    db.prepare("INSERT INTO stock_mutation_receipts(actor_id,request_id,kind,request_json,written,response_status,response_json,completed_at) VALUES(?,?,'adjust',?,?,200,?,CURRENT_TIMESTAMP)").run(actor, body.client_request_id, canonical, lotDelta !== 0 ? 1 : 0, JSON.stringify(answer))
    results.push({ ok: true, key: line.key, ...answer })
  }
  writer.afterWrite?.()
  return results
} } })
const productsRoute = load(path.join(__dirname, '../src/routes/inventoryCheckProducts.ts')).default
const sessionsRoute = load(path.join(__dirname, '../src/routes/inventoryChecks.ts')).default
const { resetReadSwitchMemo } = load(path.join(__dirname, '../src/lib/readSwitches.ts'))
const { __resetPlanTierCacheForTests } = load(path.join(__dirname, '../src/lib/planTier.ts'))

// A Map-backed KV so every write really bumps the inventory_checks version (without a CACHE binding each bump threw and was logged, ~270 stack traces, and no bump was ever exercised).
const kv = new Map()
const CACHE = { get: async key => (kv.has(key) ? kv.get(key) : null), put: async (key, value) => { kv.set(key, String(value)) }, delete: async key => { kv.delete(key) } }
let db, failApprovalRecord = false, beforeBatch = null, beforeBatchWhen = null, planEnv = {}
// The Telegram alerts the route announces: a spy on the same global hook the Worker installs.
const alerts = []
globalThis[Symbol.for('business-os.review-alert.v1')] = { announce: async (_env, event) => { alerts.push(event) }, nameBeforeChange: async () => null }
function binding() {
  function prepare(sql) {
    return { sql, values: [], bind(...values) { return { ...this, values } }, async all() {
      return { success: true, results: db.prepare(sql).all(...this.values), meta: { changes: db.prepare('SELECT changes() AS n').get().n } }
    }, async run() { const result = db.prepare(sql).run(...this.values); return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } } } }
  }
  return { prepare, async batch(statements) {
    if (beforeBatch && statements.some(statement => /INSERT INTO inventory_check_sessions/.test(statement.sql))) { const run = beforeBatch; beforeBatch = null; run(statements) }
    // A write that commits between a decision's reads and its batch: runs once, just before the first batch holding a matching statement.
    if (beforeBatchWhen && statements.some(statement => beforeBatchWhen.test.test(statement.sql))) { const run = beforeBatchWhen.run; beforeBatchWhen = null; run() }
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
  writer.cap = 24; writer.fail = new Set(); writer.calls = []; writer.replays = 0; writer.afterWrite = null; failApprovalRecord = false; beforeBatch = null; beforeBatchWhen = null; planEnv = {}; __resetPlanTierCacheForTests(); alerts.length = 0; writer.beforeLine = null
}
const setSwitches = (simple, fix, lots) => {
  db.exec("DELETE FROM system_flags WHERE key='read_switches'")
  const switches = {}
  if (simple) switches.ic_simple = simple
  if (fix) switches.ic_fix_stock = fix
  if (lots) switches.ic_lot_counts = lots
  db.prepare("INSERT INTO system_flags(key,value) VALUES('read_switches',?)").run(JSON.stringify({ epoch: 1, set_at: '2026-11-03T00:00:00.000Z', set_by: 1, switches }))
  resetReadSwitchMemo()
}
async function send(route, method, url, body, actor = ADMIN) {
  const tasks = []
  const response = await route.request(`http://local${url}`, { method, headers: { 'Content-Type': 'application/json', ...(actor ? { Cookie: `bos_session=token-${actor}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }, { DB: binding(), CACHE, ...planEnv }, { waitUntil: task => tasks.push(task) })
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
// ONLY=<text> runs the groups whose name contains it (diagnosis only; the gate runs them all).
// FROM=<n> skips the first n groups (diagnosis only, after fixing group n).
let seenGroups = 0
const check = async (name, run) => { if (process.env.ONLY && !name.includes(process.env.ONLY)) return; if (process.env.FROM && ++seenGroups <= Number(process.env.FROM)) return; await run(); groups++; console.log(`PASS ${name}`) }
/** A pending approval for one product created behind the API's back, as data from before a rule existed (or a racing submission) would be. */
const injectPending = (sessionId, productId, { submittedAt = new Date().toISOString(), counted = 3, seen = 5, branchId = 1, organizationId = 1 } = {}) => {
  db.prepare("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at) VALUES(?,?,?,?,'','closed',0,'{\"membership\":\"submission\"}',?,?,?)").run(sessionId, organizationId, branchId, COUNTER, submittedAt, submittedAt, submittedAt)
  db.prepare("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at) VALUES(?,?,?,'{}',?,'{}','issue',?,'Count differs from stock',1,?,?)").run(sessionId, productId, branchId, seen, counted, COUNTER, submittedAt)
  db.prepare("INSERT INTO inventory_check_approvals(session_id,organization_id,branch_id,status,lines,submitted_by,submitted_at,baselines_json) VALUES(?,?,?,'pending',1,?,?,?)").run(sessionId, organizationId, branchId, COUNTER, submittedAt, JSON.stringify({ [productId]: seen }))
}
/** A stock movement of the products ledger (the real writers record one for every change); the double writer records none, so a test adds the ones it needs. */
const movement = (productId, type, { reason = 'test', secondsAfterNow = 1 } = {}) => db.prepare("INSERT INTO inventory_movements(product_id,product_name,branch_id,branch_name,movement_type,quantity,reason,user_id,created_at) VALUES(?,?,1,'One',?,1,?,?,strftime('%Y-%m-%d %H:%M:%S','now',?))")
  .run(productId, 'Product', type, reason, ADMIN, `+${secondsAfterNow} seconds`)

/** An approval claimed by ADMIN whose answer was lost: the stock write landed (the writer double keeps its receipt) but the approval never recorded it. Returns the session id. */
const strandedClaim = async (requestId, lines = [line(910002, 3, { seenQuantity: 5 })]) => {
  const made = await submit(lines, { requestId: `${requestId}-sub`.slice(0, 20).padEnd(12, '0') })
  failApprovalRecord = true
  const lost = await decide(made.body.item.id, { requestId }); failApprovalRecord = false
  assert.equal(lost.status, 503, JSON.stringify(lost.body)); assert.equal(approvalRow().applying_by, ADMIN)
  return made.body.item.id
}
/** A claim written behind the API's back (what a stalled request leaves): its key, the plan it sent and how long ago it last made progress. */
const injectClaim = (sessionId, { by = ADMIN, key = 'n1-claim-key-01', plan = {}, idleSeconds = 0 } = {}) => db.prepare("UPDATE inventory_check_approvals SET applying_request_id=?,applying_by=?,applying_at=strftime('%Y-%m-%dT%H:%M:%fZ','now',?),plan_json=? WHERE session_id=?")
  .run(key, by, `-${idleSeconds} seconds`, JSON.stringify(plan), sessionId)
const idle = seconds => db.prepare("UPDATE inventory_check_approvals SET applying_at=strftime('%Y-%m-%dT%H:%M:%fZ','now',?)").run(`-${seconds} seconds`)
/** The stock writers' receipt of one line: written = 1 when the write landed, 0 for a request that claimed the id and has not written. */
// `answer`: what the writer answered (the figures the approval records for a line whose write landed but was never recorded); by default the line went from 5 to 3.
const receipt = (actor, requestId, { written = 1, ageSeconds = 0, answer = { before: { lotQuantity: 5, branchQuantity: 5 }, after: { lotQuantity: 3, branchQuantity: 3 } } } = {}) => db.prepare("INSERT INTO stock_mutation_receipts(actor_id,request_id,kind,request_json,written,response_status,response_json,created_at) VALUES(?,?,'adjust','{}',?,?,?,strftime('%Y-%m-%d %H:%M:%S','now',?))")
  .run(actor, requestId, written, written ? 200 : null, written ? JSON.stringify(answer) : null, `-${ageSeconds} seconds`)
const deactivate = id => db.prepare('UPDATE users SET is_active=0 WHERE id=?').run(id)
const eventOf = requestId => { const event = db.prepare('SELECT before_json,after_json FROM inventory_check_events WHERE request_id=?').get(requestId); return event && { before: JSON.parse(event.before_json), after: JSON.parse(event.after_json) } }
// What a line is sent with: the received date (here the product's own, whose id is the product's), what was counted and what the counter saw.
const planOf = (productId, seen, counted) => ({ lot: productId, scope: 'branch', counted, seen })

/** A product merged into another the way a merge leaves it: its stock moved to the survivor, the product and its received dates retired. */
const mergeInto = (from, into) => {
  const quantity = ordinary(from)
  db.exec(`UPDATE branch_stock SET quantity=quantity+${quantity} WHERE product_id=${into} AND branch_id=1; UPDATE branch_stock SET quantity=0 WHERE product_id=${from} AND branch_id=1;
    UPDATE branch_batch_stock SET quantity=quantity+${quantity} WHERE batch_id=${into} AND branch_id=1; UPDATE branch_batch_stock SET quantity=0 WHERE batch_id=${from} AND branch_id=1;
    UPDATE products SET stock_quantity=stock_quantity+${quantity} WHERE id=${into}; UPDATE products SET stock_quantity=0 WHERE id=${from}; UPDATE products SET is_active=0 WHERE id=${from};
    UPDATE product_batches SET is_active=0 WHERE variant_product_id=${from}`)
}

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
    const forms = [[undefined, undefined], ['on', undefined], ['on', 'off'], ['on', 'shadow:0.05'], ['on', 'shadow'], ['on', 'ON'], ['on', { state: 'on' }]]
    for (const [index, form] of forms.entries()) {
      reset(); setSwitches(...form)
      const made = await submit([line(910002, 3)], { requestId: `off-request-${index}-1` })
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
    assert.deepEqual({ type: bodies[910002].type, setScope: bodies[910002].setScope, batchId: bodies[910002].batchId, variance: bodies[910002].variance, quantity: bodies[910002].quantity }, { type: 'set', setScope: 'branch', batchId: 910002, variance: { counted: 3, seen: 5 }, quantity: undefined }, 'a line is told what the count found, never the figure to write')
    assert.deepEqual({ setScope: bodies[910003].setScope, batchId: bodies[910003].batchId, variance: bodies[910003].variance, expected: bodies[910003].expectedBranchQuantity }, { setScope: 'branch', batchId: 910003, variance: { counted: 12, seen: 7 }, expected: undefined })
    assert.equal(bodies[910002].client_request_id, 'approve-request-01-910002'); assert.match(bodies[910003].reason, /^Inventory check approved: counted 12$/)
    const row = approvalRow()
    assert.deepEqual({ status: row.status, decided_by: row.decided_by, decided_by_name: row.decided_by_name, decision_note: row.decision_note, decision_request_id: row.decision_request_id }, { status: 'approved', decided_by: ADMIN, decided_by_name: 'admin-one', decision_note: 'Counted twice', decision_request_id: 'approve-request-01' })
    assert.match(row.decided_at, /^\d{4}-\d{2}-\d{2}T/)
    assert.deepEqual(Object.keys(JSON.parse(row.applied_json).lines).sort(), ['910002', '910003', '910004'])
    const recorded = JSON.parse(row.applied_json).lines['910003']
    assert.deepEqual({ before: recorded.before, target: recorded.target, after: recorded.after }, { before: 5, target: 10, after: 10 })
    assert.deepEqual(recorded.lots.map(lot => ({ batchId: lot.batchId, scope: lot.scope, before: lot.before, after: lot.after, counted: lot.counted, seen: lot.seen, history: Number.isSafeInteger(lot.historyId) })), [{ batchId: 910003, scope: 'branch', before: 5, after: 10, counted: 12, seen: 7, history: true }], 'what moved, and the history row that can undo it')
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
    assert.deepEqual(writer.calls.map(call => ({ type: call.type, setScope: call.setScope, variance: call.variance, quantity: call.quantity })), [{ type: 'set', setScope: 'branch', variance: { counted: 3, seen: 5 }, quantity: undefined }], 'the writer is told what the count found (3 against the 5 it saw), and computes the figure from the stock of now')
    const recorded = JSON.parse(approvalRow().applied_json).lines['910002']
    assert.deepEqual({ before: recorded.before, target: recorded.target, after: recorded.after }, { before: 4, target: 2, after: 2 }, 'the approval records the before and after the writer answered with')
    // The same sale happened between loading the page and submitting: the stock the server holds (4) differs from what the counter saw (5), so the count is a recount (N3), never measured from a stale screen.
    reset(); setSwitches('on', 'on'); moveStock(910002, 4)
    const earlier = await submit([line(910002, 3, { seenQuantity: 5 })])
    assert.equal(earlier.status, 409); assert.equal(earlier.body.code, 'inventory_check_stock_changed')
    // Counted 26 (saw 24), one removed after the count: 25, not 26. A raise is a guarded lot-level Set.
    reset(); setSwitches('on', 'on'); moveStock(910002, 24)
    const raise = await submit([line(910002, 26, { seenQuantity: 24 })]); moveStock(910002, 23)
    assert.equal((await decide(raise.body.item.id, {})).status, 200); assert.equal(ordinary(910002), 25)
    assert.deepEqual({ type: writer.calls[0].type, variance: writer.calls[0].variance, expected: writer.calls[0].expectedBranchQuantity }, { type: 'set', variance: { counted: 26, seen: 24 }, expected: undefined }, 'a raise is a guarded lot-level Set, pinned inside the writer, never by a figure the engine read')
    // A sale that takes more than the count found never goes below zero.
    reset(); setSwitches('on', 'on')
    const empty = await submit([line(910002, 0, { seenQuantity: 5 })]); moveStock(910002, 3)
    assert.equal((await decide(empty.body.item.id, {})).status, 200); assert.equal(ordinary(910002), 0, 'max(0, 3 + 0 - 5)')
    // Everything the count found has already left the shelf (a sale took the last units): the writer, asked under the claim, finds nothing to write (max(0, 0 + 3 - 5) is 0, the stock it read), and the line is
    // recorded with that: not silent (clamped, with the figure wanted) and not a write (before and after are both 0, no operation to undo).
    reset(); setSwitches('on', 'on')
    const same = await submit([line(910002, 3, { seenQuantity: 5 })]); const sameId = same.body.item.id; moveStock(910002, 0)
    const settled = await decide(sameId, {})
    assert.equal(settled.status, 200); assert.equal(settled.body.done, true); assert.equal(ordinary(910002), 0)
    const nothing = JSON.parse(approvalRow().applied_json).lines['910002']
    assert.deepEqual({ before: nothing.before, after: nothing.after, clamped: nothing.clamped, wanted: nothing.wanted, operation: nothing.lots[0].operationId }, { before: 0, after: 0, clamped: true, wanted: -2, operation: undefined })
    // A viewer who could not see stock is measured against the stock at submit (the same variance, with that figure as the baseline).
    reset(); setSwitches('on', 'on')
    const blind = await submit([line(910002, 3)], { requestId: 'blind-request-02' }, BLIND); moveStock(910002, 4)
    assert.deepEqual(JSON.parse(approvalRow().baselines_json), { 910002: 5 })
    assert.equal((await decide(blind.body.item.id, {})).status, 200); assert.equal(ordinary(910002), 2)
  })

  await check('what cannot be applied safely is refused before any write, line by line: a fractional target, a raise with no received date, no recorded baseline; the stock ledger is never read or verified', async () => {
    reset(); setSwitches('on', 'on')
    let made = await standard(); let id = made.body.item.id
    // The owner's rule: a count Sets what the count found. A drifted product cache (99) is neither verified nor refused: every line is applied from the figures of its own count and the writer's own read.
    db.exec('UPDATE products SET stock_quantity=99 WHERE id=910002')
    const all = await decide(id, {})
    assert.equal(all.status, 200, JSON.stringify(all.body)); assert.equal(all.body.applied, 3); assert.equal(all.body.remaining, 0); assert.equal(all.body.done, true); assert.equal('refused' in all.body, false)
    assert.deepEqual(writer.calls.map(call => call.productId), [910002, 910003, 910004])
    reset(); setSwitches('on', 'on')
    made = await submit([line(910002, 2.5)]); id = made.body.item.id
    let refused = await decide(id, {})
    assert.equal(refused.status, 409); assert.equal(refused.body.code, 'inventory_check_target_not_whole'); assert.deepEqual(refused.body.productIds, [910002])
    reset(); setSwitches('on', 'on')
    // A product with no stock and no live received date (its only lot was emptied and closed) cannot be raised by a lot-level Set.
    for (const sql of ['UPDATE branch_stock SET quantity=0 WHERE product_id=910004', 'UPDATE branch_batch_stock SET quantity=0 WHERE batch_id=910004', 'UPDATE products SET stock_quantity=0 WHERE id=910004', 'UPDATE product_batches SET is_active=0 WHERE variant_product_id=910004']) db.exec(sql)
    made = await submit([line(910004, 9)]); id = made.body.item.id
    refused = await decide(id, {})
    assert.equal(refused.status, 409); assert.equal(refused.body.code, 'inventory_check_no_lot'); assert.deepEqual(refused.body.productIds, [910004])
    assert.equal(writer.calls.length, 0); assert.equal(approvalRow().status, 'pending')
    // A count below the damaged units is applied like any other: damaged units are tagged stock the count never touches, and the floor holds the shortage back, told (clamped, with the figure wanted).
    reset(); setSwitches('on', 'on')
    made = await submit([line(910003, 1)])
    const low = await decide(made.body.item.id, {})
    assert.equal(low.status, 200, JSON.stringify(low.body)); assert.equal(ordinary(910003), 0, 'max(0, 5 + 1 - 7)')
    assert.equal(db.prepare('SELECT quantity_remaining AS q FROM damaged_stock_lots WHERE product_id=910003').get().q, 2, 'the damaged units are untouched')
    assert.deepEqual({ clamped: low.body.approval.applied_lines['910003'].clamped, wanted: low.body.approval.applied_lines['910003'].wanted }, { clamped: true, wanted: -1 })
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

  await check('the Count sessions list can show only counts waiting for approval (queue-first review): the filter, its total and who may use it', async () => {
    reset(); setSwitches('on', 'on')
    const waiting = await standard(), matching = await submit([line(910001, 5, { checked: true })], { requestId: 'match-request-09' }), decided = await submit([line(910005, 3)], { requestId: 'submit-request-02' })
    await decide(decided.body.item.id, { decision: 'reject', requestId: 'reject-request-01' })
    const all = await sessions('GET', '/sessions?page=1&pageSize=20')
    assert.equal(all.body.total, 3); assert.equal(all.body.approvals, true, 'the page learns this viewer is shown approvals')
    const only = await sessions('GET', '/sessions?page=1&pageSize=20&approval=pending')
    assert.equal(only.status, 200); assert.deepEqual(only.body.items.map(item => item.id), [waiting.body.item.id], 'only the count nobody decided')
    assert.equal(only.body.total, 1, 'and the total counts only those'); assert.equal(only.body.items[0].approval.status, 'pending')
    assert.equal((await sessions('GET', '/sessions?page=1&pageSize=20&approval=pending&mine=1', undefined, COUNTER)).body.items.length, 1, 'it combines with the other filters')
    assert.equal((await sessions('GET', '/sessions?page=1&pageSize=20&approval=pending&status=open')).body.items.length, 0, 'submitted counts are closed sessions')
    assert.equal((await sessions('GET', '/sessions?page=1&pageSize=20&approval=')).body.total, 3, 'an empty value is no filter')
    for (const bad of ['approved', 'all', '1', 'pending,approved']) assert.equal((await sessions('GET', `/sessions?approval=${bad}`)).status, 400, bad)
    assert.equal((await sessions('GET', '/sessions?approval=pending', undefined, BLIND)).status, 400, 'a viewer who is not shown approvals cannot ask for them')
    assert.equal('approvals' in (await sessions('GET', '/sessions?page=1&pageSize=20', undefined, BLIND)).body, false)
    void matching
    setSwitches('on', 'off')
    const off = await sessions('GET', '/sessions?page=1&pageSize=20&approval=pending')
    assert.equal(off.status, 400); assert.equal(off.body.code, 'inventory_check_invalid_filter', 'with ic_fix_stock off the filter does not exist')
    assert.equal('approvals' in (await sessions('GET', '/sessions?page=1&pageSize=20')).body, false)
  })

  await check('Fix stock is held while its count waits: a stock request that names the count is refused for exactly the lines nobody has applied or rejected', async () => {
    const { fixStockCountOf, fixStockHeldByApproval } = load(path.join(__dirname, '../src/lib/inventoryCheckFixStock.ts'))
    const { getDb } = load(path.join(__dirname, '../src/lib/db.ts'))
    assert.deepEqual(fixStockCountOf('icfix_3f9c1c2e-1111-4222-8333-444455556666_910002_a1b2c3d4e5f60718'), { sessionId: '3f9c1c2e-1111-4222-8333-444455556666', productId: 910002 })
    for (const other of ['icfix_', 'icfix_x_0_a1b2c3d4', 'icfix__910002_a1b2c3d4', 'icfix_s_910002_short', 'stockline_abcdefgh', 'icfix_s_910002_a1b2c3d4_extra', 12, null, undefined]) assert.equal(fixStockCountOf(other), null, String(other))
    reset(); setSwitches('on', 'on'); writer.cap = 1
    const made = await standard(); const id = made.body.item.id
    const held = requestProduct => fixStockHeldByApproval(getDb({ DB: binding() }), `icfix_${id}_${requestProduct}_a1b2c3d4e5f60718`)
    assert.deepEqual([await held(910002), await held(910003), await held(910004)], [true, true, true], 'every difference of a waiting count is held')
    assert.equal(await held(910001), false, 'a line that matched has nothing to fix'); assert.equal(await held(910009), false, 'nor a product that is not in the count')
    assert.equal(await fixStockHeldByApproval(getDb({ DB: binding() }), `icfix_${id.split('').reverse().join('')}_910002_a1b2c3d4e5f60718`), false, 'nor a count that does not exist')
    assert.equal(await fixStockHeldByApproval(getDb({ DB: binding() }), 'stockline_a1b2c3d4e5f60718'), false, 'a request that names no count is never held by itself: only the product-wide ask (a scoped Set) holds it')
    await decide(id, {})
    assert.deepEqual([await held(910002), await held(910003), await held(910004)], [false, true, true], 'a line already applied is released; the rest stay held')
    writer.cap = 24; await decide(id, {})
    assert.deepEqual([await held(910002), await held(910003), await held(910004)], [false, false, false], 'an approved count holds nothing')
    reset(); setSwitches('on', 'on')
    const rejected = await standard()
    await decide(rejected.body.item.id, { decision: 'reject', requestId: 'reject-request-01' })
    assert.equal(await fixStockHeldByApproval(getDb({ DB: binding() }), `icfix_${rejected.body.item.id}_910002_a1b2c3d4e5f60718`), false, 'a rejected count leaves the Issue to be fixed by hand')
    // The adjust kernel asks before it claims a receipt: for an id that names a count, and (G3) for every scoped Set whatever its id is.
    const kernel = fs.readFileSync(path.join(__dirname, '../src/routes/inventory.ts'), 'utf8')
    assert.ok(/stockMutationRequestIdMissing\(body\)\) return[^\n]*\r?\n[\s\S]{0,1800}startsWith\('icfix_'\)[\s\S]{0,900}if \(\(scopedSet \|\| namesCount\) && !underClaim\)[\s\S]{0,1600}return withStockMutationReceipt\(/.test(kernel), 'the hold sits after the id check and before the receipt claim')
  })

  await check('the approval cannot be forged around the API: its rows are immutable once decided and never deleted', async () => {
    reset(); setSwitches('on', 'on')
    const made = await standard()
    await decide(made.body.item.id, { decision: 'reject', requestId: 'reject-request-01' })
    assert.throws(() => db.exec("UPDATE inventory_check_approvals SET decision_note='edited'"), /inventory_check_approval_immutable/)
    assert.throws(() => db.exec('DELETE FROM inventory_check_approvals'), /inventory_check_approval_immutable/)
    assert.throws(() => db.exec("UPDATE inventory_check_approvals SET submitted_by=1"), /inventory_check_approval_immutable/)
  })

  await check('N3: the server does not trust the client\'s seen: a viewer who sees stock cannot claim to have seen another figure (recount), and a blind counter is measured against the stock at submit', async () => {
    const sessionCount = () => db.prepare('SELECT COUNT(*) AS n FROM inventory_check_sessions').get().n
    reset(); setSwitches('on', 'on')
    // seen 0 while stock is 5 and 6 is typed: the old build recorded a variance of +6 (stock 11).
    const lied = await submit([line(910002, 6, { seenQuantity: 0 })], { requestId: 'n3-lie-00001' })
    assert.equal(lied.status, 409, JSON.stringify(lied.body)); assert.equal(lied.body.code, 'inventory_check_stock_changed'); assert.deepEqual(lied.body.productIds, [910002])
    assert.equal(sessionCount(), 0, 'nothing is recorded'); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inventory_check_approvals').get().n, 0)
    // The same figure the counter really saw is accepted, and the figure the variance uses is the stock at submit.
    const honest = await submit([line(910002, 6, { seenQuantity: 5 })], { requestId: 'n3-honest-001' })
    assert.equal(honest.status, 201); assert.equal(approvalRow().baselines_json, '{"910002":5}')
    assert.equal((await decide(honest.body.item.id, { requestId: 'n3-approve-001' })).status, 200); assert.equal(ordinary(910002), 6, 'the true shelf')
    // A sale before the submit (stock 4): the counter still saw 5. A differing count is a recount, never an approval measured from a stale screen.
    reset(); setSwitches('on', 'on'); moveStock(910002, 4)
    const stale = await submit([line(910002, 3, { seenQuantity: 5 })], { requestId: 'n3-stale-0001' })
    assert.equal(stale.status, 409); assert.equal(stale.body.code, 'inventory_check_stock_changed'); assert.deepEqual(stale.body.productIds, [910002]); assert.equal(sessionCount(), 0)
    // A count that equals the stock of now needs no change whatever was on the screen: Done, no approval line, so nothing is applied twice.
    const equal = await submit([line(910002, 4, { seenQuantity: 5 })], { requestId: 'n3-equal-0001' })
    assert.equal(equal.status, 201); assert.equal('approval' in equal.body, false); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inventory_check_approvals').get().n, 0)
    assert.equal(db.prepare("SELECT state FROM inventory_check_items WHERE product_id=910002").get().state, 'done')
    // A viewer who sends no seen is measured against the stock at submit (the page always sends it).
    reset(); setSwitches('on', 'on')
    const bare = await submit([line(910002, 3)], { requestId: 'n3-bare-00001' })
    assert.equal(bare.status, 201); assert.equal(approvalRow().baselines_json, '{"910002":5}')
    // A blind counter cannot see stock, so what they send as seen means nothing: ignored, the stock at submit is the baseline.
    reset(); setSwitches('on', 'on')
    const blind = await submit([line(910002, 6, { seenQuantity: 0 })], { requestId: 'n3-blind-0001' }, BLIND)
    assert.equal(blind.status, 201, JSON.stringify(blind.body)); assert.equal(approvalRow().baselines_json, '{"910002":5}', 'the stock at submit, not the figure the blind client made up')
    assert.equal((await decide(blind.body.item.id, { requestId: 'n3-blind-appr1' })).status, 200); assert.equal(ordinary(910002), 6, 'the true shelf, not 11')
    // Without ic_fix_stock nothing is applied, so a stale seen changes nothing about the old behaviour.
    reset(); setSwitches('on', undefined)
    assert.equal((await submit([line(910002, 6, { seenQuantity: 0 })], { requestId: 'n3-off-000001' })).status, 201)
  })

  const approvalOf = sessionId => db.prepare('SELECT * FROM inventory_check_approvals WHERE session_id=?').get(sessionId)
  const supersededOf = sessionId => JSON.parse(approvalOf(sessionId).superseded_json)

  await check('N2 queue-first: a later count of a product that waits closes the older line as superseded in the same commit, and the newer differing count queues itself: one shortage, applied once', async () => {
    reset(); setSwitches('on', 'on')
    const first = await submit([line(910002, 3, { seenQuantity: 5 }), line(910004, 3, { seenQuantity: 5 })], { requestId: 'n2q-first-0001' })
    assert.equal(first.status, 201)
    const second = await submit([line(910002, 2, { seenQuantity: 5 })], { requestId: 'n2q-second-001' }, LEAD)
    assert.equal(second.status, 201, JSON.stringify(second.body)); assert.equal(second.body.approval.status, 'pending')
    assert.deepEqual(supersededOf(first.body.item.id), { 910002: second.body.item.id }, 'the older line is closed as superseded by the newer session')
    assert.equal(approvalOf(first.body.item.id).status, 'pending', 'its other line still waits'); assert.equal(approvalOf(second.body.item.id).status, 'pending')
    // The people who decide see it, and the products list marks only the waiting lines.
    const detail = (await sessions('GET', `/sessions/${first.body.item.id}`)).body
    assert.deepEqual(detail.approval.superseded, { 910002: second.body.item.id }); assert.equal(detail.approval.lines, 2)
    const marked = (await products('branchId=1&pageSize=12')).body.items.filter(item => item.check_pending).map(item => item.id).sort()
    assert.deepEqual(marked, [910002, 910004], 'one waiting item per product')
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory_check_items i JOIN inventory_check_approvals a ON a.session_id=i.session_id WHERE i.product_id=910002 AND a.status='pending' AND a.superseded_json NOT LIKE '%910002%'").get().n, 1)
    // The audit trail of the older count says what happened to it, to the people who may see approvals.
    const trail = (await sessions('GET', `/sessions/${first.body.item.id}/history?page=1&pageSize=50`)).body.items.find(item => item.after?.superseded_by)
    assert.equal(trail.product_id, 910002); assert.equal(trail.after.superseded_by, second.body.item.id); assert.equal(trail.after.approval, 'pending')
    // Approving the older applies only the line that still waits; the newer count is measured from the same stock and applies once.
    const olderDone = await decide(first.body.item.id, { requestId: 'n2q-approve-001' })
    assert.equal(olderDone.status, 200, JSON.stringify(olderDone.body)); assert.equal(olderDone.body.done, true); assert.equal(olderDone.body.approval.status, 'approved')
    assert.deepEqual(Object.keys(olderDone.body.approval.applied_lines), ['910004'], 'the superseded line is never applied'); assert.equal(ordinary(910004), 3); assert.equal(ordinary(910002), 5)
    assert.equal((await decide(second.body.item.id, { requestId: 'n2q-approve-002' })).status, 200); assert.equal(ordinary(910002), 2, 'saw 5, counted 2: one shortage applied once (not 5 - 2 - 2)')
    assert.deepEqual(writer.calls.map(call => call.productId), [910004, 910002])

    // A closed older approval does not hide its superseded lines either: Close records the lines that were not applied, never the ones a newer count replaced.
    reset(); setSwitches('on', 'on')
    const kept = await submit([line(910002, 3, { seenQuantity: 5 }), line(910004, 3, { seenQuantity: 5 })], { requestId: 'n2q-close-0001' })
    const newer = await submit([line(910002, 4, { seenQuantity: 5 })], { requestId: 'n2q-close-0002' }, LEAD)
    const closedOlder = await decide(kept.body.item.id, { decision: 'close', requestId: 'n2q-close-dec01' })
    assert.equal(closedOlder.status, 200, JSON.stringify(closedOlder.body)); assert.deepEqual(closedOlder.body.approval.closed, { lines: { 910004: 'inventory_check_not_applied' } }); assert.equal(closedOlder.body.approval.status, 'rejected')
    assert.equal(approvalOf(newer.body.item.id).status, 'pending')
  })

  await check('N2 queue-first: an older approval left with no line to apply is rejected in the same commit; a newer count that matches stock is Done and still closes the older line; nothing else is touched', async () => {
    reset(); setSwitches('on', 'on')
    const first = await submit([line(910002, 3, { seenQuantity: 5 })], { requestId: 'n2q-all-000001' })
    const matching = await submit([line(910002, 5, { seenQuantity: 5, checked: true })], { requestId: 'n2q-match-0001' }, LEAD)
    assert.equal(matching.status, 201, JSON.stringify(matching.body)); assert.equal('approval' in matching.body, false, 'a count that matches stock queues nothing')
    assert.equal(db.prepare('SELECT state FROM inventory_check_items WHERE session_id=?').get(matching.body.item.id).state, 'done')
    const older = approvalOf(first.body.item.id)
    assert.equal(older.status, 'rejected'); assert.equal(older.decided_by, null, 'no person decided it'); assert.equal(older.decided_by_name, null); assert.equal(older.decision_note, 'Replaced by a newer count'); assert.equal(older.decision_request_id, 'n2q-match-0001'); assert.deepEqual(JSON.parse(older.superseded_json), { 910002: matching.body.item.id })
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inventory_check_approvals').get().n, 1, 'no approval was made for the matching count')
    const late = await decide(first.body.item.id, { requestId: 'n2q-late-00001' })
    assert.equal(late.status, 409); assert.equal(late.body.code, 'inventory_check_approval_decided'); assert.equal(writer.calls.length, 0); assert.equal(ordinary(910002), 5, 'stock is untouched')
    const shown = (await sessions('GET', `/sessions/${first.body.item.id}`)).body.approval
    assert.equal(shown.status, 'rejected'); assert.deepEqual(shown.superseded, { 910002: matching.body.item.id })
    assert.equal(shown.replaced, true); assert.equal(shown.decision_note, 'Replaced by a newer count'); assert.equal('decided_by_name' in shown, false, 'the counter who submitted the newer count is not named as the decider')
    assert.equal((await products('branchId=1&pageSize=12')).body.items.some(item => item.check_pending), false, 'nothing waits any more')
    // A replay of the submission that replaced it changes nothing more.
    const events = () => db.prepare('SELECT COUNT(*) AS n FROM inventory_check_events').get().n, before = events()
    const replay = await submit([line(910002, 5, { seenQuantity: 5, checked: true })], { requestId: 'n2q-match-0001' }, LEAD)
    assert.equal(replay.status, 200, JSON.stringify(replay.body)); assert.equal(replay.body.created, false); assert.equal(events(), before)

    // A replaced line no longer waits: the product is not marked as waiting and Fix stock is not held for it, while the line of the same approval that still waits is.
    reset(); setSwitches('on', 'on')
    const pair = await submit([line(910002, 3, { seenQuantity: 5 }), line(910004, 3, { seenQuantity: 5 })], { requestId: 'n2q-partial-001' })
    assert.equal((await submit([line(910002, 5, { seenQuantity: 5, checked: true })], { requestId: 'n2q-partial-002' }, LEAD)).status, 201)
    assert.deepEqual((await products('branchId=1&pageSize=12')).body.items.filter(item => item.check_pending).map(item => item.id), [910004], 'only the line that still waits is marked')
    const { fixStockHeldByApproval } = load(path.join(__dirname, '../src/lib/inventoryCheckFixStock.ts')), { getDb } = load(path.join(__dirname, '../src/lib/db.ts'))
    const held = productId => fixStockHeldByApproval(getDb({ DB: binding() }), `icfix_${pair.body.item.id}_${productId}_a1b2c3d4e5f60718`)
    assert.deepEqual([await held(910002), await held(910004)], [false, true], 'Fix stock is held only for the line that still waits')

    // Another product, another branch's waiting line and another organization's are never touched.
    reset(); setSwitches('on', 'on')
    const other = await submit([line(910004, 3, { seenQuantity: 5 })], { requestId: 'n2q-other-0001' })
    injectPending('n2q-branch-two', 910002, { branchId: 2 }); injectPending('n2q-org-two', 910002, { organizationId: 2 })
    const recount = await submit([line(910002, 4, { seenQuantity: 5 })], { requestId: 'n2q-recount-001' }, LEAD)
    assert.equal(recount.status, 201, JSON.stringify(recount.body))
    for (const id of [other.body.item.id, 'n2q-branch-two', 'n2q-org-two']) assert.deepEqual(supersededOf(id), {}, id)
  })

  await check('N2 queue-first: a line being applied right now is never replaced: the count is refused with its reason, the same for every figure typed, and a line nobody is applying never refuses anyone', async () => {
    const sessionCount = () => db.prepare('SELECT COUNT(*) AS n FROM inventory_check_sessions').get().n
    reset(); setSwitches('on', 'on'); writer.cap = 1
    const first = await submit([line(910002, 3, { seenQuantity: 5 }), line(910004, 3, { seenQuantity: 5 })], { requestId: 'n2q-claim-0001' })
    assert.equal((await decide(first.body.item.id, { requestId: 'n2q-claim-dec01' })).status, 200) // 910002 applied; 910004 planned and being applied
    const planned = Object.keys(JSON.parse(approvalOf(first.body.item.id).plan_json))
    assert.deepEqual(planned, ['910004'])
    const sessionsBefore = sessionCount(), answers = new Set()
    for (let figure = 0; figure <= 9; figure++) {
      const refused = await submit([line(910004, figure)], { requestId: `n2q-blind-${figure}-0001` }, BLIND)
      assert.equal(refused.status, 409, `${figure}: ${JSON.stringify(refused.body)}`); assert.equal(refused.body.code, 'inventory_check_count_in_progress'); assert.deepEqual(refused.body.productIds, [910004])
      answers.add(JSON.stringify(refused.body))
    }
    assert.equal(answers.size, 1, 'the answer does not depend on the figure typed: it tells nobody what the stock holds')
    assert.equal(sessionCount(), sessionsBefore, 'nothing was recorded'); assert.deepEqual(supersededOf(first.body.item.id), {})
    // The same count of a product that is not being applied is accepted: the line already applied, another product, and a count that also names the busy one is refused whole.
    assert.equal((await submit([line(910002, 3, { seenQuantity: 3 })], { requestId: 'n2q-applied-001' }, LEAD)).status, 201, 'a line already applied no longer waits')
    assert.equal((await submit([line(910006, 3, { seenQuantity: 5 })], { requestId: 'n2q-product-001' }, LEAD)).status, 201)
    const whole = await submit([line(910004, 3, { seenQuantity: 5 }), line(910008, 3, { seenQuantity: 5 })], { requestId: 'n2q-whole-0001' }, LEAD)
    assert.equal(whole.status, 409); assert.deepEqual(whole.body.productIds, [910004]); assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory_check_items WHERE product_id=910008").get().n, 0)
    // Once the approval is finished the product can be counted again.
    assert.equal((await decide(first.body.item.id, { requestId: 'n2q-claim-dec01' })).status, 200)
    assert.equal((await submit([line(910004, 2, { seenQuantity: 3 })], { requestId: 'n2q-after-0001' }, LEAD)).status, 201)

    // A line nobody is applying: every figure is accepted, so a blind counter learns nothing from the answer either (the figures 0-9 against stock 5 were all refused but one before).
    reset(); setSwitches('on', 'on')
    const waiting = await submit([line(910002, 3, { seenQuantity: 5 })], { requestId: 'n2q-wait-00001' })
    for (let figure = 0; figure <= 9; figure++) assert.equal((await submit([line(910002, figure)], { requestId: `n2q-free-${figure}-0001` }, BLIND)).status, 201, String(figure))
    assert.deepEqual(Object.keys(supersededOf(waiting.body.item.id)), ['910002'])
    const waitingNow = db.prepare("SELECT COUNT(DISTINCT a.session_id) AS n FROM inventory_check_approvals a JOIN inventory_check_items i ON i.session_id=a.session_id WHERE a.status='pending' AND i.product_id=910002 AND json_extract(a.superseded_json,'$.\"910002\"') IS NULL").get().n
    assert.equal(waitingNow, 1, 'only the newest count of the product waits')
  })

  await check('N2 queue-first: replacing and applying never race: the refusal is judged in the commit that would replace, and an approver that read the old lines cannot claim over a replacement', async () => {
    // A claim lands between the submission's check and its commit (the guard sits in the same atomic batch, ahead of the replacement).
    reset(); setSwitches('on', 'on')
    const first = await submit([line(910002, 3, { seenQuantity: 5 })], { requestId: 'n2q-race-00001' })
    beforeBatch = () => injectClaim(first.body.item.id, { plan: { 910002: planOf(910002, 5, 3) } })
    const racing = await submit([line(910002, 2, { seenQuantity: 5 })], { requestId: 'n2q-race-00002' }, LEAD)
    assert.equal(racing.status, 409, JSON.stringify(racing.body)); assert.equal(racing.body.code, 'inventory_check_count_in_progress'); assert.deepEqual(racing.body.productIds, [910002])
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inventory_check_sessions').get().n, 1, 'the losing submission left nothing behind'); assert.deepEqual(supersededOf(first.body.item.id), {})

    // A replacement lands between an approver's read and his claim: the claim is refused (the approval row is no longer as he read it), and his repeat applies only what still waits.
    reset(); setSwitches('on', 'on')
    const older = await submit([line(910002, 3, { seenQuantity: 5 }), line(910004, 3, { seenQuantity: 5 })], { requestId: 'n2q-race-00003' })
    beforeBatchWhen = { test: /SET applying_request_id=\?/, run: () => db.prepare('UPDATE inventory_check_approvals SET superseded_json=? WHERE session_id=?').run(JSON.stringify({ 910002: 'newer-session' }), older.body.item.id) }
    const lost = await decide(older.body.item.id, { requestId: 'n2q-race-dec01' })
    assert.equal(lost.status, 409, JSON.stringify(lost.body)); assert.equal(lost.body.code, 'inventory_check_conflict'); assert.equal(writer.calls.length, 0, 'nothing was written for a line that was just replaced')
    const retried = await decide(older.body.item.id, { requestId: 'n2q-race-dec01' })
    assert.equal(retried.status, 200, JSON.stringify(retried.body)); assert.equal(retried.body.approval.status, 'approved')
    assert.equal(ordinary(910002), 5, 'the replaced line is never applied'); assert.equal(ordinary(910004), 3)
  })

  await check('N2: an approval never applies a line that a later approval or a manual correction already settled', async () => {
    reset(); setSwitches('on', 'on')
    // At approval: a line another approval of the same branch already applied after this count was submitted is refused (data from before the rule, or a race that got through).
    reset(); setSwitches('on', 'on')
    const early = await submit([line(910002, 3, { seenQuantity: 5 })], { requestId: 'n2-early-0001' })
    injectPending('n2-older-session', 910002, { submittedAt: new Date(Date.now() - 60_000).toISOString() })
    assert.equal((await decide(early.body.item.id, { requestId: 'n2-approve-003' })).status, 200); assert.equal(ordinary(910002), 3)
    writer.calls = []
    const superseded = await decide('n2-older-session', { requestId: 'n2-approve-004' })
    assert.equal(superseded.status, 409, JSON.stringify(superseded.body)); assert.equal(superseded.body.code, 'inventory_check_count_superseded'); assert.deepEqual(superseded.body.productIds, [910002])
    assert.equal(writer.calls.length, 0); assert.equal(ordinary(910002), 3, 'the shortage was not applied twice')
    assert.equal(db.prepare("SELECT status FROM inventory_check_approvals WHERE session_id='n2-older-session'").get().status, 'pending', 'still rejectable: nothing was claimed')
    assert.equal((await decide('n2-older-session', { decision: 'reject', requestId: 'n2-reject-0002' })).status, 200)

    // A manual Set (or any correction that asserts a figure) made after the count and before the approval: refused too, never stacked on top of it.
    for (const type of ['set', 'adjustment', 'remove']) {
      reset(); setSwitches('on', 'on')
      const counted = await submit([line(910002, 3, { seenQuantity: 5 })], { requestId: `n2-manual-${type}`.padEnd(14, '0') })
      moveStock(910002, 3); movement(910002, type, { reason: 'Shelf recount by hand' })
      const stacked = await decide(counted.body.item.id, { requestId: 'n2-approve-005' })
      assert.equal(stacked.status, 409, `${type}: ${JSON.stringify(stacked.body)}`); assert.equal(stacked.body.code, 'inventory_check_stock_adjusted'); assert.deepEqual(stacked.body.productIds, [910002])
      assert.equal(ordinary(910002), 3, `${type}: the manual figure stands, the count is not stacked on it (would be 1)`); assert.equal(writer.calls.length, 0)
      assert.equal((await decide(counted.body.item.id, { decision: 'reject', requestId: 'n2-reject-0003' })).status, 200, 'the count can still be rejected')
    }
    // What does not assert a figure keeps the variance model: a sale, goods received, an add, a correction BEFORE the count, another product, and this approval's own writes.
    reset(); setSwitches('on', 'on')
    movement(910002, 'set', { reason: 'before the count', secondsAfterNow: -3600 })
    const kept = await submit([line(910002, 3, { seenQuantity: 5 })], { requestId: 'n2-kept-00001' })
    movement(910002, 'sale'); movement(910002, 'add'); movement(910002, 'in'); movement(910004, 'set'); movement(910002, 'remove', { reason: 'Inventory check approved: counted 3' })
    moveStock(910002, 4)
    assert.equal((await decide(kept.body.item.id, { requestId: 'n2-approve-006' })).status, 200); assert.equal(ordinary(910002), 2, '4 + (3 - 5)')
  })

  await check('N4: a merged or retired product is refused, not recorded as done; a shortage the stock could not take is recorded as clamped, never hidden', async () => {
    // Merged before approval: the lowering line used to be planned against the retired product's empty stock, "settled" and approved while the survivor kept its stock.
    reset(); setSwitches('on', 'on')
    const made = await submit([line(910004, 3, { seenQuantity: 5 })], { requestId: 'n4-merged-0001' })
    mergeInto(910004, 910005)
    const merged = await decide(made.body.item.id, { requestId: 'n4-approve-001' })
    assert.equal(merged.status, 409, JSON.stringify(merged.body)); assert.equal(merged.body.code, 'inventory_check_product_retired'); assert.deepEqual(merged.body.productIds, [910004])
    assert.equal(ordinary(910005), 10, 'the survivor is untouched'); assert.equal(writer.calls.length, 0)
    assert.equal(approvalRow().status, 'pending'); assert.equal(approvalRow().applying_request_id, null, 'nothing was claimed')
    assert.equal(approvalRow().applied_json, '{}', 'and nothing was recorded as done')
    assert.equal((await decide(made.body.item.id, { decision: 'reject', requestId: 'n4-reject-0001' })).status, 200, 'so it can still be rejected')
    // A raise on a retired product is refused the same way, before the missing received date is looked for.
    reset(); setSwitches('on', 'on')
    const raised = await submit([line(910004, 9, { seenQuantity: 5 })], { requestId: 'n4-raised-0001' })
    mergeInto(910004, 910005)
    const raisedRefused = await decide(raised.body.item.id, { requestId: 'n4-approve-002' })
    assert.equal(raisedRefused.status, 409); assert.equal(raisedRefused.body.code, 'inventory_check_product_retired')

    // A product that is only inactive (not merged) is retired too; an active product is not.
    reset(); setSwitches('on', 'on')
    const inactive = await submit([line(910002, 3, { seenQuantity: 5 })], { requestId: 'n4-inactive-001' })
    moveStock(910002, 0); db.exec('UPDATE products SET is_active=0 WHERE id=910002') // a product holding stock cannot be deactivated, so it is emptied first
    assert.equal((await decide(inactive.body.item.id, { requestId: 'n4-approve-003' })).body.code, 'inventory_check_product_retired')
    db.exec('UPDATE products SET is_active=1 WHERE id=910002')
    assert.equal((await decide(inactive.body.item.id, { requestId: 'n4-approve-003' })).status, 200, 'active again: the same approval goes through')

    // The max(0, ...) clamp: a sale left less than the count found missing. Stock goes to 0 and the part that could not be removed is recorded on the line, in the event and in the answer.
    reset(); setSwitches('on', 'on')
    const clamped = await submit([line(910002, 0, { seenQuantity: 5 }), line(910003, 12, { seenQuantity: 7 })], { requestId: 'n4-clamped-001' }); moveStock(910002, 1)
    const done = await decide(clamped.body.item.id, { requestId: 'n4-approve-004' })
    assert.equal(done.status, 200, JSON.stringify(done.body)); assert.equal(ordinary(910002), 0)
    const stored = JSON.parse(approvalRow().applied_json).lines
    assert.deepEqual({ before: stored['910002'].before, target: stored['910002'].target, clamped: stored['910002'].clamped, wanted: stored['910002'].wanted }, { before: 1, target: 0, clamped: true, wanted: -4 })
    assert.equal(stored['910003'].clamped, undefined, 'a line the stock could take fully is not marked'); assert.equal(stored['910003'].wanted, undefined)
    assert.equal(done.body.approval.applied_lines['910002'].clamped, true); assert.equal(done.body.approval.applied_lines['910002'].wanted, -4)
    const event = db.prepare("SELECT after_json FROM inventory_check_events WHERE product_id=910002 AND request_id LIKE 'n4-approve-004-%'").get()
    assert.equal(JSON.parse(event.after_json).clamped, true); assert.equal(JSON.parse(event.after_json).wanted, -4)
    // Nothing left to remove at all (the sale took every unit): the writer finds nothing to write, and the line still says what the floor held back.
    reset(); setSwitches('on', 'on')
    const empty = await submit([line(910002, 3, { seenQuantity: 5 })], { requestId: 'n4-empty-00001' }); moveStock(910002, 0)
    assert.equal((await decide(empty.body.item.id, { requestId: 'n4-approve-005' })).status, 200)
    const settled = JSON.parse(approvalRow().applied_json).lines['910002']
    assert.deepEqual({ before: settled.before, after: settled.after, clamped: settled.clamped, wanted: settled.wanted }, { before: 0, after: 0, clamped: true, wanted: -2 })
    // A count the stock took fully (live 4, saw 5, counted 3: 2) is not marked.
    reset(); setSwitches('on', 'on')
    const plain = await submit([line(910002, 3, { seenQuantity: 5 })], { requestId: 'n4-plain-00001' }); moveStock(910002, 4)
    assert.equal((await decide(plain.body.item.id, { requestId: 'n4-approve-006' })).status, 200)
    assert.deepEqual(Object.keys(JSON.parse(approvalRow().applied_json).lines['910002']).sort(), ['after', 'at', 'before', 'lots', 'target'], 'a line the stock took fully carries no clamp mark')
  })

  await check('N1: a line that cannot be applied is refused on its own, and the answer says which; the others are applied', async () => {
    // A hand correction of line 2's product after the count (the probe): that line is refused with its reason every time, the other lines are not held back by it.
    reset(); setSwitches('on', 'on')
    const made = await submit([line(910002, 3, { seenQuantity: 5 }), line(910004, 1, { seenQuantity: 5 }), line(910005, 4, { seenQuantity: 5 })], { requestId: 'n1-line-by-line' })
    movement(910004, 'set')
    const first = await decide(made.body.item.id, { requestId: 'n1-line-approve' })
    assert.equal(first.status, 200, JSON.stringify(first.body)); assert.equal(first.body.applied, 2); assert.equal(first.body.remaining, 1); assert.equal(first.body.done, false)
    assert.deepEqual(first.body.refused, [{ productId: 910004, code: 'inventory_check_stock_adjusted' }])
    assert.deepEqual([ordinary(910002), ordinary(910004), ordinary(910005)], [3, 5, 4], 'the healthy lines landed, the refused one did not move')
    const second = await decide(made.body.item.id, { requestId: 'n1-line-approve' })
    assert.equal(second.status, 409); assert.equal(second.body.code, 'inventory_check_stock_adjusted'); assert.deepEqual(second.body.productIds, [910004])
    assert.deepEqual(second.body.refused, [{ productId: 910004, code: 'inventory_check_stock_adjusted' }])
    assert.equal(approvalRow().status, 'pending'); assert.equal(writer.calls.length, 2, 'asking again writes nothing')
    // Mixed reasons are all named, the most fundamental first.
    reset(); setSwitches('on', 'on')
    const mixed = await submit([line(910002, 3, { seenQuantity: 5 }), line(910003, 1, { seenQuantity: 7 }), line(910004, 2.5, { seenQuantity: 5 })], { requestId: 'n1-mixed-0001' })
    movement(910003, 'adjustment')
    const refusedAll = await decide(mixed.body.item.id, { requestId: 'n1-mixed-approve' })
    const again = await decide(mixed.body.item.id, { requestId: 'n1-mixed-approve' })
    assert.equal(refusedAll.status, 200, 'the line that can be applied goes first')
    assert.equal(again.status, 409); assert.deepEqual(again.body.refused.map(entry => entry.code), ['inventory_check_target_not_whole', 'inventory_check_stock_adjusted'])
    assert.equal(again.body.code, 'inventory_check_target_not_whole'); assert.deepEqual(again.body.productIds, [910004])
  })

  await check('N1: an approval whose claimer is gone is taken over by another approver: the receipts say what landed, the rest is sent under the new approver\'s own key, never the old one', async () => {
    // The claimer is deactivated after the write landed but before it was recorded: the takeover records the line from the receipt; the repeat finishes without writing again.
    reset(); setSwitches('on', 'on')
    let id = await strandedClaim('n1-approve-admin')
    assert.equal(ordinary(910002), 3); assert.equal(writer.calls.length, 1)
    deactivate(ADMIN)
    const takeover = await decide(id, { requestId: 'n1-approve-lead' }, LEAD)
    assert.equal(takeover.status, 200, JSON.stringify(takeover.body)); assert.equal(takeover.body.takeover, true); assert.equal(takeover.body.applied, 1); assert.equal(takeover.body.remaining, 0); assert.equal(takeover.body.done, false)
    assert.equal(writer.calls.length, 1, 'a takeover moves no stock')
    assert.equal(approvalRow().applying_by, LEAD); assert.equal(approvalRow().applying_request_id, 'n1-approve-lead'); assert.equal(approvalRow().takeovers, 1); assert.equal(approvalRow().plan_json, '{}')
    assert.deepEqual(Object.keys(JSON.parse(approvalRow().applied_json).lines), ['910002'], 'the landed line is recorded from its receipt')
    assert.equal(db.prepare("SELECT state FROM inventory_check_items WHERE product_id=910002").get().state, 'done')
    const audit = eventOf('n1-approve-lead-takeover')
    assert.deepEqual({ from: audit.before.claimed_by, to: audit.after.claimed_by, reason: audit.after.reason, landed: audit.after.landed }, { from: ADMIN, to: LEAD, reason: 'inactive', landed: [910002] }, 'the takeover is in the audit trail')
    const finished = await decide(id, { requestId: 'n1-approve-lead' }, LEAD)
    assert.equal(finished.status, 200); assert.equal(finished.body.done, true); assert.equal(finished.body.approval.status, 'approved')
    assert.equal(ordinary(910002), 3, 'one shortage, applied once'); assert.equal(writer.calls.length, 1)

    // A partly applied approval: the lines that did not land are sent by the new approver under HIS request id (receipts are per approver; the old key would be a second write).
    reset(); setSwitches('on', 'on'); writer.cap = 1
    const made = await submit([line(910002, 3, { seenQuantity: 5 }), line(910004, 9, { seenQuantity: 5 })], { requestId: 'n1-two-lines-01' }); id = made.body.item.id
    assert.equal((await decide(id, { requestId: 'n1-two-admin-01' })).status, 200); assert.equal(ordinary(910002), 3)
    deactivate(ADMIN)
    const step = await decide(id, { requestId: 'n1-two-lead-001' }, LEAD)
    assert.equal(step.status, 200); assert.equal(step.body.takeover, true); assert.equal(step.body.applied, 0); assert.equal(step.body.remaining, 1)
    const next = await decide(id, { requestId: 'n1-two-lead-001' }, LEAD)
    assert.equal(next.status, 200); assert.equal(next.body.applied, 1)
    assert.equal(writer.calls.length, 2); assert.match(writer.calls[1].client_request_id, /^n1-two-lead-001-910004$/, 'the new key, not n1-two-admin-01')
    assert.equal((await decide(id, { requestId: 'n1-two-lead-001' }, LEAD)).body.done, true); assert.deepEqual([ordinary(910002), ordinary(910004)], [3, 9])
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM stock_mutation_receipts WHERE actor_id=? AND request_id LIKE 'n1-two-lead-001-%'").get(LEAD).n, 1)

    // A claimer who is merely idle: the window is the plan's (Paid 5 minutes, Free 15); before it nobody else can take the approval, after it anyone can.
    for (const [tier, window] of [['paid', 300], ['free', 900]]) {
      reset(); setSwitches('on', 'on'); planEnv = { PLAN_TIER: tier }; __resetPlanTierCacheForTests()
      id = await strandedClaim('n1-idle-admin')
      idle(window - 5)
      const early = await decide(id, { requestId: 'n1-idle-lead-1' }, LEAD)
      assert.equal(early.status, 409, `${tier}: ${JSON.stringify(early.body)}`); assert.equal(early.body.code, 'inventory_check_approval_in_progress'); assert.equal(approvalRow().applying_by, ADMIN); assert.equal(approvalRow().takeovers, 0)
      assert.equal((await decide(id, { requestId: 'n1-idle-admin' })).status, 200, `${tier}: the claimer still continues his own approval`)
      reset(); setSwitches('on', 'on'); planEnv = { PLAN_TIER: tier }; __resetPlanTierCacheForTests()
      id = await strandedClaim('n1-idle-admin')
      idle(window + 5)
      const late = await decide(id, { requestId: 'n1-idle-lead-1' }, LEAD)
      assert.equal(late.status, 200, `${tier}: ${JSON.stringify(late.body)}`); assert.equal(late.body.takeover, true); assert.equal(eventOf('n1-idle-lead-1-takeover').after.reason, 'idle')
    }

    // A claimer who lost the right or must change his password is gone at once; one who is active and allowed is not.
    reset(); setSwitches('on', 'on')
    id = await strandedClaim('n1-perm-admin-1')
    db.prepare('UPDATE users SET role_id=900001 WHERE id=?').run(ADMIN)
    assert.equal((await decide(id, { requestId: 'n1-perm-lead-01' }, LEAD)).status, 200); assert.equal(eventOf('n1-perm-lead-01-takeover').after.reason, 'permission')
    reset(); setSwitches('on', 'on')
    id = await strandedClaim('n1-pass-admin-1')
    db.prepare('UPDATE users SET must_change_password=1 WHERE id=?').run(ADMIN)
    assert.equal((await decide(id, { requestId: 'n1-pass-lead-01' }, LEAD)).status, 200); assert.equal(eventOf('n1-pass-lead-01-takeover').after.reason, 'inactive')

    // A receipt that wrote nothing (a request still running, or one that crashed) says nothing and holds nobody back: the claim moves with the takeover, so that request can no longer write (R1), and the line is planned again.
    reset(); setSwitches('on', 'on')
    id = (await submit([line(910002, 3, { seenQuantity: 5 })], { requestId: 'n1-flight-sub-1' })).body.item.id
    injectClaim(id, { key: 'n1-flight-key-01', plan: { 910002: planOf(910002, 5, 3) }, idleSeconds: 20 }); receipt(ADMIN, 'n1-flight-key-01-910002', { written: 0, ageSeconds: 10 }); deactivate(ADMIN)
    const running = await decide(id, { requestId: 'n1-flight-lead-1' }, LEAD)
    assert.equal(running.status, 200, JSON.stringify(running.body)); assert.equal(running.body.takeover, true); assert.equal(running.body.applied, 0, 'it wrote nothing, so it is planned again'); assert.equal(approvalRow().applying_by, LEAD)
    assert.equal((await decide(id, { requestId: 'n1-flight-lead-1' }, LEAD)).status, 200); assert.equal(ordinary(910002), 3); assert.equal(writer.calls.length, 1)
    assert.equal(writer.calls[0].client_request_id, 'n1-flight-lead-1-910002')
  })

  await check('N1: a claimed approval that cannot be finished can be closed by any approver: no stock moves, what landed stays applied, the rest is recorded as not applied with its reason', async () => {
    // A hand correction of line 2's product after line 1 (the probe): refused every time, cannot be rejected after line 1 landed; Close ends it.
    reset(); setSwitches('on', 'on'); writer.cap = 1
    let made = await submit([line(910002, 3, { seenQuantity: 5 }), line(910004, 1, { seenQuantity: 5 })], { requestId: 'n1-close-sub-01' }); let id = made.body.item.id
    assert.equal((await decide(id, { requestId: 'n1-close-first' })).status, 200)
    movement(910004, 'set')
    const stuck = await decide(id, { requestId: 'n1-close-first' })
    assert.equal(stuck.status, 409); assert.equal(stuck.body.code, 'inventory_check_stock_adjusted')
    assert.equal((await decide(id, { decision: 'reject', requestId: 'n1-close-reject' })).status, 409, 'rejecting after a line landed is still refused')
    const tables = () => stockRows().slice(0, 5), before = tables(), writes = writer.calls.length
    const underActiveClaimer = await decide(id, { decision: 'close', requestId: 'n1-close-lead-1', note: 'A hand correction was made' }, LEAD)
    assert.equal(underActiveClaimer.status, 409); assert.equal(underActiveClaimer.body.code, 'inventory_check_approval_in_progress', 'another approver closes only once the claimer is gone'); assert.equal(approvalRow().status, 'pending')
    idle(1000)
    const closed = await decide(id, { decision: 'close', requestId: 'n1-close-lead-1', note: 'A hand correction was made' }, LEAD)
    assert.equal(closed.status, 200, JSON.stringify(closed.body)); assert.equal(closed.body.done, true); assert.equal(closed.body.approval.status, 'approved', 'something was applied')
    assert.deepEqual(closed.body.approval.closed, { lines: { 910004: 'inventory_check_stock_adjusted' } }); assert.equal(closed.body.approval.applied, 1)
    assert.deepEqual(tables(), before, 'no stock table changed')
    assert.equal(writer.calls.length, writes, 'closing writes no stock'); assert.deepEqual([ordinary(910002), ordinary(910004)], [3, 5])
    const row = approvalRow()
    assert.deepEqual({ status: row.status, by: row.decided_by, key: row.decision_request_id, note: row.decision_note, plan: row.plan_json }, { status: 'approved', by: LEAD, key: 'n1-close-lead-1', note: 'A hand correction was made', plan: '{}' })
    assert.deepEqual(Object.keys(JSON.parse(row.applied_json).lines), ['910002']); assert.equal(db.prepare("SELECT state FROM inventory_check_items WHERE product_id=910004").get().state, 'issue', 'the line not applied is still a difference')
    const audit = eventOf('n1-close-lead-1')
    assert.deepEqual({ approval: audit.after.approval, closed: audit.after.closed, applied: audit.after.applied, notApplied: audit.after.not_applied }, { approval: 'approved', closed: true, applied: 1, notApplied: { 910004: 'inventory_check_stock_adjusted' } })
    assert.equal(alerts.at(-1).kind, 'approved'); assert.equal(alerts.filter(alert => alert.kind !== 'created').length, 1)
    // Decided and idempotent: the same close again is the same answer, any other decision is refused.
    const replay = await decide(id, { decision: 'close', requestId: 'n1-close-lead-1' }, LEAD)
    assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true); assert.equal(alerts.filter(alert => alert.kind !== 'created').length, 1, 'a replay announces nothing')
    assert.equal((await decide(id, { decision: 'approve', requestId: 'n1-close-lead-1' }, LEAD)).status, 409); assert.equal((await decide(id, { decision: 'reject', requestId: 'n1-close-lead-1' }, LEAD)).status, 409)
    assert.equal((await decide(id, { decision: 'close', requestId: 'n1-close-lead-2' }, LEAD)).status, 409, 'closed once')
    // The product is free to be counted again (its count no longer waits).
    assert.equal((await submit([line(910004, 3, { seenQuantity: 5 })], { requestId: 'n1-close-recount' })).status, 201)

    // A product merged after line 1 (lowering shortage lost its lot before: no_lot / retired) closes the same way, by the approver himself.
    for (const [name, code, prepare] of [
      ['retired', 'inventory_check_product_retired', () => mergeInto(910004, 910005)],
      ['no lot', 'inventory_check_no_lot', () => { for (const sql of ['UPDATE branch_stock SET quantity=0 WHERE product_id=910004', 'UPDATE branch_batch_stock SET quantity=0 WHERE batch_id=910004', 'UPDATE products SET stock_quantity=0 WHERE id=910004', 'UPDATE product_batches SET is_active=0 WHERE variant_product_id=910004']) db.exec(sql) }],
    ]) {
      reset(); setSwitches('on', 'on'); writer.cap = 1
      made = await submit([line(910002, 3, { seenQuantity: 5 }), line(910004, 9, { seenQuantity: 5 })], { requestId: 'n1-strand-sub-01' }); id = made.body.item.id
      assert.equal((await decide(id, { requestId: 'n1-strand-first' })).status, 200)
      prepare()
      const refused = await decide(id, { requestId: 'n1-strand-first' })
      assert.equal(refused.status, 409, `${name}: ${JSON.stringify(refused.body)}`); assert.equal(refused.body.code, code)
      assert.equal((await decide(id, { decision: 'reject', requestId: 'n1-strand-reject' })).status, 409, `${name}: cannot be rejected`)
      const ended = await decide(id, { decision: 'close', requestId: 'n1-strand-close' })
      assert.equal(ended.status, 200, `${name}: ${JSON.stringify(ended.body)}`); assert.deepEqual(ended.body.approval.closed, { lines: { 910004: code } }); assert.equal(approvalRow().status, 'approved')
      assert.equal(ordinary(910002), 3); assert.equal(writer.calls.length, 1)
    }

    // The claimer is deactivated after the write landed (its receipt exists) but before it was recorded: closing RECORDS that line as applied, never as not applied.
    reset(); setSwitches('on', 'on')
    id = await strandedClaim('n1-lost-admin-1'); deactivate(ADMIN)
    const landedClose = await decide(id, { decision: 'close', requestId: 'n1-lost-close-1' }, LEAD)
    assert.equal(landedClose.status, 200, JSON.stringify(landedClose.body)); assert.equal(landedClose.body.approval.status, 'approved'); assert.deepEqual(landedClose.body.approval.closed, { lines: {} })
    assert.deepEqual(Object.keys(JSON.parse(approvalRow().applied_json).lines), ['910002']); assert.equal(ordinary(910002), 3); assert.equal(writer.calls.length, 1)
    assert.equal(db.prepare("SELECT state FROM inventory_check_items WHERE product_id=910002").get().state, 'done')

    // A claimer who is still active holds a close back from other approvers; once he is gone a receipt that wrote nothing does not: the close moves the claim, so that request can no longer write, and nothing was applied.
    reset(); setSwitches('on', 'on')
    id = (await submit([line(910002, 3, { seenQuantity: 5 })], { requestId: 'n1-fl-close-sub1' })).body.item.id
    injectClaim(id, { key: 'n1-fl-close-key1', plan: { 910002: planOf(910002, 5, 3) }, idleSeconds: 20 }); receipt(ADMIN, 'n1-fl-close-key1-910002', { written: 0, ageSeconds: 10 })
    const busy = await decide(id, { decision: 'close', requestId: 'n1-fl-close-lead' }, LEAD)
    assert.equal(busy.status, 409); assert.equal(busy.body.code, 'inventory_check_approval_in_progress'); assert.equal(approvalRow().status, 'pending')
    idle(1000)
    const idleClose = await decide(id, { decision: 'close', requestId: 'n1-fl-close-lead' }, LEAD)
    assert.equal(idleClose.status, 200, JSON.stringify(idleClose.body)); assert.equal(idleClose.body.approval.status, 'rejected', 'nothing was applied'); assert.deepEqual(idleClose.body.approval.closed, { lines: { 910002: 'inventory_check_not_applied' } })
    assert.equal(ordinary(910002), 5); assert.equal(writer.calls.length, 0); assert.equal(alerts.at(-1).kind, 'rejected'); assert.equal(alerts.at(-1).reason, 'Closed')

    // An approval nobody has touched closes too (as not applied); it needs only the right to approve, not to adjust stock, and the counter cannot.
    reset(); setSwitches('on', 'on')
    id = (await standard()).body.item.id
    const denied = await decide(id, { decision: 'close', requestId: 'n1-deny-close-1' }, COUNTER)
    assert.equal(denied.status, 403); assert.equal(denied.body.code, 'inventory_check_approve_required'); assert.equal(approvalRow().status, 'pending')
    const plain = await decide(id, { decision: 'close', requestId: 'n1-plain-close-1', note: 'No longer wanted' }, NO_ADJUST)
    assert.equal(plain.status, 200, JSON.stringify(plain.body)); assert.equal(plain.body.approval.status, 'rejected'); assert.equal(Object.keys(plain.body.approval.closed.lines).length, 3)
    assert.deepEqual(Object.values(plain.body.approval.closed.lines), ['inventory_check_not_applied', 'inventory_check_not_applied', 'inventory_check_not_applied']); assert.equal(writer.calls.length, 0)
    assert.equal(alerts.at(-1).kind, 'rejected'); assert.equal(alerts.at(-1).reason, 'No longer wanted', 'its note is the reason')
  })

  // Holds the request whose stock line id starts with the prefix just before its receipt/stock write, until released.
  const hold = prefix => {
    let entered, released
    const reached = new Promise(resolve => { entered = resolve }), go = new Promise(resolve => { released = resolve })
    writer.beforeLine = async body => { if (body.client_request_id.startsWith(prefix)) { writer.beforeLine = null; entered(); await go } }
    return { reached, release: released }
  }
  const untilDone = async (id, requestId, actor) => { let last; for (let step = 0; step < 10; step++) { last = await decide(id, { requestId }, actor); if (last.status !== 200 || last.body.done) break } return last }

  // The stock write commits only while the approval is still claimed by the writer: a close or a takeover that wins the race leaves the old write nothing to land, and the record always matches the stock.
  await check('R1 1: a close by another approver while the claimer is between its claim and its stock write: the old write lands nothing, and no stock moves under a rejected row', async () => {
    let made, id, gate, inFlight, landedMeanwhile
    reset(); setSwitches('on', 'on')
    made = await submit([line(910002, 3, { seenQuantity: 5 })], { requestId: 'r1-close-sub-01' }); id = made.body.item.id
    gate = hold('r1-close-a01'); inFlight = decide(id, { requestId: 'r1-close-a01' }); await gate.reached
    deactivate(ADMIN) // another approver may close only once the claimer is gone
    const closed = await decide(id, { decision: 'close', requestId: 'r1-close-lead01' }, LEAD)
    gate.release(); const late = await inFlight
    assert.equal(closed.status, 200, JSON.stringify(closed.body))
    assert.equal(ordinary(910002), 5, 'the old write landed nothing'); assert.equal(approvalRow().status, 'rejected'); assert.deepEqual(JSON.parse(approvalRow().closed_json), { lines: { 910002: 'inventory_check_not_applied' } })
    assert.equal(late.status, 409); assert.equal(late.body.code, 'inventory_check_claim_lost', 'the old approver is told his claim is gone'); assert.equal(writer.calls.length, 0)
  })
  await check('R1 2: an idle takeover with the old write landing last (after the new approver finished that line): the old write lands nothing', async () => {
    let made, id, gate, inFlight, landedMeanwhile
    reset(); setSwitches('on', 'on'); writer.cap = 1
    made = await submit([line(910002, 3, { seenQuantity: 5 }), line(910004, 3, { seenQuantity: 5 })], { requestId: 'r1-idle-sub-001' }); id = made.body.item.id
    assert.equal((await decide(id, { requestId: 'r1-idle-a01' })).status, 200); idle(1000)
    gate = hold('r1-idle-a01-910004'); inFlight = decide(id, { requestId: 'r1-idle-a01' }); await gate.reached
    const take = await decide(id, { requestId: 'r1-idle-b01' }, LEAD); const finished = await untilDone(id, 'r1-idle-b01', LEAD)
    gate.release(); const old = await inFlight
    assert.equal(take.status, 200, JSON.stringify(take.body)); assert.equal(take.body.takeover, true); assert.equal(finished.body.approval.status, 'approved')
    assert.equal(ordinary(910004), 3, 'one shortage, applied once'); assert.deepEqual(writer.calls.map(call => call.client_request_id), ['r1-idle-a01-910002', 'r1-idle-b01-910004'], 'the old approver late write never landed')
    assert.equal(old.status, 409); assert.equal(old.body.code, 'inventory_check_claim_lost')
  })
  await check('R1 3: the old write would land between the takeover and the new approver repeat: it lands nothing', async () => {
    let made, id, gate, inFlight, landedMeanwhile
    reset(); setSwitches('on', 'on'); writer.cap = 1
    made = await submit([line(910002, 3, { seenQuantity: 5 }), line(910004, 3, { seenQuantity: 5 })], { requestId: 'r1-between-sub1' }); id = made.body.item.id
    assert.equal((await decide(id, { requestId: 'r1-between-a01' })).status, 200); idle(1000)
    gate = hold('r1-between-a01-910004'); inFlight = decide(id, { requestId: 'r1-between-a01' }); await gate.reached
    const step = await decide(id, { requestId: 'r1-between-b01' }, LEAD)
    gate.release(); const between = await inFlight
    const rest = await untilDone(id, 'r1-between-b01', LEAD)
    assert.equal(step.status, 200); assert.equal(step.body.takeover, true); assert.equal(rest.body.approval.status, 'approved')
    assert.equal(ordinary(910004), 3, 'applied once'); assert.equal(between.body.code, 'inventory_check_claim_lost')
    assert.deepEqual(writer.calls.map(call => call.client_request_id), ['r1-between-a01-910002', 'r1-between-b01-910004'])
  })
  await check('R1 4: a takeover for a lost permission needs no idle wait, and the first request write is still refused once the claim has moved', async () => {
    let made, id, gate, inFlight, landedMeanwhile
    reset(); setSwitches('on', 'on')
    made = await submit([line(910002, 3, { seenQuantity: 5 })], { requestId: 'r1-perm-sub-001' }); id = made.body.item.id
    gate = hold('r1-perm-a01'); inFlight = decide(id, { requestId: 'r1-perm-a01' }); await gate.reached
    db.prepare('UPDATE users SET role_id=900001 WHERE id=?').run(ADMIN)
    const permTake = await decide(id, { requestId: 'r1-perm-b01' }, LEAD); const permDone = await untilDone(id, 'r1-perm-b01', LEAD)
    gate.release(); const permOld = await inFlight
    assert.equal(permTake.status, 200, JSON.stringify(permTake.body)); assert.equal(permTake.body.takeover, true); assert.equal(permDone.body.approval.status, 'approved')
    assert.equal(ordinary(910002), 3, 'applied once'); assert.deepEqual(writer.calls.map(call => call.client_request_id), ['r1-perm-b01-910002'])
    assert.equal(permOld.status, 409, 'and the old approver is refused, not told it was applied')
  })
  await check('R1 5: the write that lands first wins: a takeover that read "nothing landed" is refused when a write landed in between, and records it on the retry', async () => {
    let made, id, gate, inFlight, landedMeanwhile
    reset(); setSwitches('on', 'on'); writer.cap = 1
    made = await submit([line(910002, 3, { seenQuantity: 5 }), line(910004, 3, { seenQuantity: 5 })], { requestId: 'r1-order-sub-01' }); id = made.body.item.id
    assert.equal((await decide(id, { requestId: 'r1-order-a01' })).status, 200); idle(1000)
    landedMeanwhile = false
    beforeBatchWhen = { test: /takeovers=takeovers\+1/, run: () => { landedMeanwhile = true; moveStock(910004, 3); receipt(ADMIN, 'r1-order-a01-910004') } }
    const raced = await decide(id, { requestId: 'r1-order-b01' }, LEAD)
    assert.equal(landedMeanwhile, true, 'the interleaving happened')
    assert.equal(raced.status, 409, JSON.stringify(raced.body)); assert.equal(raced.body.code, 'inventory_check_conflict', 'the takeover that read stale receipts is refused, not committed')
    assert.equal(approvalRow().applying_by, ADMIN, 'the claim did not move'); assert.equal(approvalRow().takeovers, 0)
    const retry = await decide(id, { requestId: 'r1-order-b01' }, LEAD)
    assert.equal(retry.status, 200, JSON.stringify(retry.body)); assert.equal(retry.body.takeover, true); assert.equal(retry.body.applied, 1, 'now the landed line is recorded from its receipt')
    assert.equal((await untilDone(id, 'r1-order-b01', LEAD)).body.approval.status, 'approved'); assert.equal(ordinary(910004), 3)
  })
  await check('R1 6: the same for a close: it reads "nothing landed", a write lands, and the close is refused instead of recording the line as not applied', async () => {
    let made, id, gate, inFlight, landedMeanwhile
    reset(); setSwitches('on', 'on'); writer.cap = 1
    made = await submit([line(910002, 3, { seenQuantity: 5 }), line(910004, 3, { seenQuantity: 5 })], { requestId: 'r1-cl-order-sub1' }); id = made.body.item.id
    assert.equal((await decide(id, { requestId: 'r1-cl-order-a01' })).status, 200); idle(1000)
    landedMeanwhile = false
    beforeBatchWhen = { test: /,closed_json=/, run: () => { landedMeanwhile = true; moveStock(910004, 3); receipt(ADMIN, 'r1-cl-order-a01-910004') } }
    const racedClose = await decide(id, { decision: 'close', requestId: 'r1-cl-order-c01' }, LEAD)
    assert.equal(landedMeanwhile, true, 'the interleaving happened')
    assert.equal(racedClose.status, 409, JSON.stringify(racedClose.body)); assert.equal(approvalRow().status, 'pending')
    const closeRetry = await decide(id, { decision: 'close', requestId: 'r1-cl-order-c01' }, LEAD)
    assert.equal(closeRetry.status, 200, JSON.stringify(closeRetry.body)); assert.equal(approvalRow().status, 'approved'); assert.deepEqual(JSON.parse(approvalRow().closed_json), { lines: {} }); assert.equal(Object.keys(JSON.parse(approvalRow().applied_json).lines).length, 2)
  })
  await check('R1 7: another approver may close only once the claimer is gone; the claimer himself may always close', async () => {
    let made, id, gate, inFlight, landedMeanwhile
    reset(); setSwitches('on', 'on'); writer.cap = 1
    made = await submit([line(910002, 3, { seenQuantity: 5 }), line(910004, 3, { seenQuantity: 5 })], { requestId: 'r1-gone-sub-001' }); id = made.body.item.id
    assert.equal((await decide(id, { requestId: 'r1-gone-a01' })).status, 200)
    const refusedClose = await decide(id, { decision: 'close', requestId: 'r1-gone-close1' }, LEAD)
    assert.equal(refusedClose.status, 409, JSON.stringify(refusedClose.body)); assert.equal(refusedClose.body.code, 'inventory_check_approval_in_progress'); assert.equal(approvalRow().status, 'pending')
    idle(1000)
    assert.equal((await decide(id, { decision: 'close', requestId: 'r1-gone-close1' }, LEAD)).status, 200, 'an idle claimer no longer protects the approval')
    reset(); setSwitches('on', 'on'); writer.cap = 1
    made = await submit([line(910002, 3, { seenQuantity: 5 }), line(910004, 3, { seenQuantity: 5 })], { requestId: 'r1-own-sub-0001' }); id = made.body.item.id
    assert.equal((await decide(id, { requestId: 'r1-own-a01' })).status, 200)
    assert.equal((await decide(id, { decision: 'close', requestId: 'r1-own-close1' })).status, 200, 'the claimer closes his own approval at any time')
  })

  // The step that plans a count is the dearest request of an approval; on the Free plan the stock request that follows it in the same invocation can be left without statements, and the
  // commit then answers the line 'deferred' (untouched). Cap 0 is that answer for every line.
  await check('Budget defer: a step that recorded the plan but could not write keeps the claim and the plan and writes nothing; the repeat writes under the same key; a repeat that defers again is a refusal', async () => {
    let made, id
    reset(); setSwitches('on', 'on'); writer.cap = 0
    made = await submit([line(910002, 3, { seenQuantity: 5 }), line(910004, 3, { seenQuantity: 5 })], { requestId: 'defer-sub-0001' }); id = made.body.item.id
    const planned = await decide(id, { requestId: 'defer-a001' })
    assert.equal(planned.status, 200, JSON.stringify(planned.body)); assert.equal(planned.body.deferred, true); assert.equal(planned.body.applied, 0); assert.equal(planned.body.remaining, 2); assert.equal(planned.body.done, false)
    assert.equal(writer.calls.length, 0, 'nothing was written'); assert.equal(ordinary(910002), 5); assert.equal(ordinary(910004), 5)
    const claimed = approvalRow()
    assert.equal(claimed.status, 'pending'); assert.equal(claimed.applying_request_id, 'defer-a001', 'the claim stays'); assert.deepEqual(Object.keys(JSON.parse(claimed.plan_json)), ['910002', '910004'], 'and so does the plan')
    writer.cap = 1
    const first = await decide(id, { requestId: 'defer-a001' })
    assert.equal(first.status, 200, JSON.stringify(first.body)); assert.equal(first.body.applied, 1); assert.equal(first.body.deferred, undefined)
    const rest = await untilDone(id, 'defer-a001')
    assert.equal(rest.body.approval.status, 'approved'); assert.equal(ordinary(910002), 3); assert.equal(ordinary(910004), 3, 'each shortage applied once')
    assert.deepEqual(writer.calls.map(call => call.client_request_id), ['defer-a001-910002', 'defer-a001-910004'], 'under the key that claimed it')

    reset(); setSwitches('on', 'on'); writer.cap = 0
    made = await submit([line(910002, 3, { seenQuantity: 5 })], { requestId: 'defer-sub-0002' }); id = made.body.item.id
    assert.equal((await decide(id, { requestId: 'defer-b001' })).body.deferred, true)
    const again = await decide(id, { requestId: 'defer-b001' })
    assert.equal(again.status, 409, JSON.stringify(again.body)); assert.equal(again.body.code, 'inventory_check_stock_write_refused', 'a repeat that defers again records nothing new, so it is a refusal, not a loop')
    assert.equal(approvalRow().applying_request_id, null, 'the claim is released'); assert.equal(writer.calls.length, 0); assert.equal(ordinary(910002), 5)
  })

  // Re-review F1: a close compared the plan only through the receipts of the lines it had read in the plan. A line that joins the plan after that read (the plan was '{}' after a takeover
  // or after a refusal; the claimer plans it and writes it) landed in stock while the close recorded it as not applied. The close now commits only if the plan is the one it read.
  const lineJoinsThePlan = (key, productId) => () => {
    db.prepare('UPDATE inventory_check_approvals SET plan_json=?').run(JSON.stringify({ [productId]: planOf(productId, 5, 3) })); moveStock(productId, 3); receipt(ADMIN, `${key}-${productId}`)
  }
  await check('F1 G1: the claimer closes in a second tab while the first plans a line that had been refused and writes it: the close is refused, the retry records the line as applied', async () => {
    let made, id, raced
    reset(); setSwitches('on', 'on'); writer.cap = 1
    made = await submit([line(910002, 3, { seenQuantity: 5 }), line(910004, 3, { seenQuantity: 5 })], { requestId: 'f1-g1-sub-0001' }); id = made.body.item.id
    assert.equal((await decide(id, { requestId: 'f1-g1-a0001' })).status, 200)
    db.prepare("UPDATE inventory_check_approvals SET plan_json='{}'").run() // the second line was refused when the claimer last planned: the plan holds nothing now
    beforeBatchWhen = { test: /,closed_json=/, run: lineJoinsThePlan('f1-g1-a0001', 910004) }
    raced = await decide(id, { decision: 'close', requestId: 'f1-g1-close01' })
    assert.equal(ordinary(910004), 3, 'the interleaving happened: the claimer line landed meanwhile')
    assert.equal(raced.status, 409, JSON.stringify(raced.body)); assert.equal(raced.body.code, 'inventory_check_conflict'); assert.equal(approvalRow().status, 'pending', 'the close committed nothing')
    const retry = await decide(id, { decision: 'close', requestId: 'f1-g1-close01' })
    assert.equal(retry.status, 200, JSON.stringify(retry.body))
    const row = approvalRow()
    assert.deepEqual(Object.keys(JSON.parse(row.applied_json).lines).sort(), ['910002', '910004'], 'the record matches the stock'); assert.deepEqual(JSON.parse(row.closed_json), { lines: {} })
  })
  await check('F1 G2: another approver closes an idle claim while the claimer writes a line that had been refused: the close is refused, the retry records the line as applied', async () => {
    let made, id, raced
    reset(); setSwitches('on', 'on'); writer.cap = 1
    made = await submit([line(910002, 3, { seenQuantity: 5 }), line(910004, 3, { seenQuantity: 5 })], { requestId: 'f1-g2-sub-0001' }); id = made.body.item.id
    assert.equal((await decide(id, { requestId: 'f1-g2-a0001' })).status, 200); idle(1000)
    db.prepare("UPDATE inventory_check_approvals SET plan_json='{}'").run()
    beforeBatchWhen = { test: /,closed_json=/, run: lineJoinsThePlan('f1-g2-a0001', 910004) }
    raced = await decide(id, { decision: 'close', requestId: 'f1-g2-close01' }, LEAD)
    assert.equal(ordinary(910004), 3, 'the interleaving happened')
    assert.equal(raced.status, 409, JSON.stringify(raced.body)); assert.equal(raced.body.code, 'inventory_check_conflict'); assert.equal(approvalRow().status, 'pending')
    const retry = await decide(id, { decision: 'close', requestId: 'f1-g2-close01' }, LEAD)
    assert.equal(retry.status, 200, JSON.stringify(retry.body))
    assert.deepEqual(Object.keys(JSON.parse(approvalRow().applied_json).lines).sort(), ['910002', '910004']); assert.equal(approvalRow().decided_by, LEAD)
  })

  // The same gap on the other transitions of a claimed approval (re-review F1 asked for the whole list): the claimer's own landing writes the plan back, and the release of a claim that
  // wrote nothing clears it. Each now commits only over the plan it read, and the release only while no write of the plan has landed.
  await check('F1 landing: a landing never overwrites a plan another request of the same claimer recorded in between: it is refused, and the repeat replays what landed', async () => {
    let made, id, raced
    reset(); setSwitches('on', 'on'); writer.cap = 1
    made = await submit([line(910002, 3, { seenQuantity: 5 }), line(910004, 3, { seenQuantity: 5 })], { requestId: 'f1-land-sub-001' }); id = made.body.item.id
    const other = JSON.stringify({ 910002: planOf(910002, 5, 3), 910004: planOf(910004, 5, 2) })
    beforeBatchWhen = { test: /SET applied_json=\S+,plan_json=/, run: () => db.prepare('UPDATE inventory_check_approvals SET plan_json=?').run(other) }
    raced = await decide(id, { requestId: 'f1-land-a0001' })
    assert.equal(raced.status, 409, JSON.stringify(raced.body)); assert.equal(raced.body.code, 'inventory_check_conflict')
    assert.equal(approvalRow().plan_json, other, 'the other request plan was not overwritten'); assert.equal(approvalRow().applied_json, '{}')
    assert.equal(ordinary(910002), 3, 'the line itself had landed')
    const repeat = await decide(id, { requestId: 'f1-land-a0001' })
    assert.equal(repeat.status, 200, JSON.stringify(repeat.body)); assert.equal(repeat.body.applied, 1); assert.equal(writer.replays, 1, 'the identical write is replayed, never applied twice')
    assert.equal(ordinary(910002), 3)
  })
  await check('F1 release: a claim that wrote nothing is released only while no write of its plan has landed', async () => {
    let made, id, refused
    reset(); setSwitches('on', 'on'); writer.fail = new Set([910002])
    made = await submit([line(910002, 3, { seenQuantity: 5 })], { requestId: 'f1-rel-sub-0001' }); id = made.body.item.id
    beforeBatchWhen = { test: /applying_request_id=NULL,applying_by=NULL/, run: () => { moveStock(910002, 3); receipt(ADMIN, 'f1-rel-a0001-910002') } }
    refused = await decide(id, { requestId: 'f1-rel-a0001' })
    assert.equal(refused.status, 409, JSON.stringify(refused.body)); assert.equal(refused.body.code, 'inventory_check_stock_write_refused')
    assert.equal(approvalRow().applying_request_id, 'f1-rel-a0001', 'a write of the plan landed in the meantime: the claim stays')
    reset(); setSwitches('on', 'on'); writer.fail = new Set([910002])
    made = await submit([line(910002, 3, { seenQuantity: 5 })], { requestId: 'f1-rel-sub-0002' }); id = made.body.item.id
    assert.equal((await decide(id, { requestId: 'f1-rel-b0001' })).status, 409); assert.equal(approvalRow().applying_request_id, null, 'with no write landed the claim is released as before')
    // Another request of the same claimer recorded a different plan since: that plan may be written right now, so the release leaves the claim alone.
    reset(); setSwitches('on', 'on'); writer.fail = new Set([910002])
    made = await submit([line(910002, 3, { seenQuantity: 5 })], { requestId: 'f1-rel-sub-0003' }); id = made.body.item.id
    const replanned = JSON.stringify({ 910002: planOf(910002, 5, 2) })
    beforeBatchWhen = { test: /applying_request_id=NULL,applying_by=NULL/, run: () => db.prepare('UPDATE inventory_check_approvals SET plan_json=?').run(replanned) }
    assert.equal((await decide(id, { requestId: 'f1-rel-c0001' })).status, 409)
    assert.deepEqual({ key: approvalRow().applying_request_id, plan: approvalRow().plan_json }, { key: 'f1-rel-c0001', plan: replanned }, 'a plan recorded in between is neither cleared nor released')
  })

  // Re-review F3: a replaced count was rejected silently and in the counter's name. The system decides it now (no decider, a note that says why), every review is told, and an approval that
  // is claimed (so it could not be auto-rejected) ends the same way whether it finishes or is closed.
  const replacedAlerts = () => alerts.filter(event => event.kind === 'rejected' && event.reason === 'Replaced by a newer count')
  await check('F3: a replaced approval is decided by the system, with a note, and the review alert says so without naming the counter', async () => {
    reset(); setSwitches('on', 'on')
    const first = await submit([line(910002, 3, { seenQuantity: 5 })], { requestId: 'f3-first-00001' })
    alerts.length = 0
    const newer = await submit([line(910002, 2, { seenQuantity: 5 })], { requestId: 'f3-newer-00001' }, LEAD)
    assert.equal(newer.status, 201, JSON.stringify(newer.body))
    const older = approvalOf(first.body.item.id)
    assert.deepEqual({ status: older.status, by: older.decided_by, name: older.decided_by_name, note: older.decision_note, key: older.decision_request_id }, { status: 'rejected', by: null, name: null, note: 'Replaced by a newer count', key: 'f3-newer-00001' })
    assert.deepEqual(replacedAlerts().map(event => [event.kind, event.by ?? null, event.row.entity_id, event.row.section]), [['rejected', null, first.body.item.id, 'inventory_checks']], 'one alert, no person named')
    assert.equal(alerts.filter(event => event.kind === 'created').length, 1, 'and the newer count is announced as before')
    const shown = (await sessions('GET', `/sessions/${first.body.item.id}`)).body.approval
    assert.equal(shown.replaced, true); assert.equal('decided_by_name' in shown, false)
    const listed = (await sessions('GET', '/sessions?page=1&pageSize=10')).body.items.find(item => item.id === first.body.item.id)
    assert.equal(listed.approval.replaced, true, 'the list says so too')
    // A replay of the submission tells nobody again; a replaced count that only touches a line of a bigger approval rejects nothing and tells nobody.
    alerts.length = 0
    assert.equal((await submit([line(910002, 2, { seenQuantity: 5 })], { requestId: 'f3-newer-00001' }, LEAD)).status, 200); assert.equal(replacedAlerts().length, 0)
    reset(); setSwitches('on', 'on')
    await submit([line(910002, 3, { seenQuantity: 5 }), line(910004, 3, { seenQuantity: 5 })], { requestId: 'f3-pair-000001' }); alerts.length = 0
    assert.equal((await submit([line(910002, 2, { seenQuantity: 5 })], { requestId: 'f3-pair-000002' }, LEAD)).status, 201); assert.equal(replacedAlerts().length, 0, 'the older approval still has a line that waits')
  })
  await check('F3: a claimed approval whose every remaining line was replaced ends as replaced, whether it finishes or is closed: same row, same alert', async () => {
    const outcome = async (decision) => {
      reset(); setSwitches('on', 'on'); alerts.length = 0
      const first = await submit([line(910002, 3, { seenQuantity: 5 })], { requestId: 'f3-claim-000001' })
      injectClaim(first.body.item.id, { plan: {} }) // claimed by the approver, nothing planned or applied
      assert.equal((await submit([line(910002, 4, { seenQuantity: 5 })], { requestId: 'f3-claim-000002' }, LEAD)).status, 201)
      assert.equal(approvalOf(first.body.item.id).status, 'pending', 'a claimed approval is not rejected by the submission; it is replaced when it ends')
      alerts.length = 0
      const answer = await decide(first.body.item.id, decision === 'close' ? { decision: 'close', requestId: 'f3-end-000001' } : { requestId: 'n1-claim-key-01' })
      assert.equal(answer.status, 200, JSON.stringify(answer.body)); assert.equal(answer.body.done, true)
      const row = approvalOf(first.body.item.id)
      assert.equal(writer.calls.length, 0, 'no stock was written')
      assert.deepEqual(replacedAlerts().map(event => [event.kind, event.by ?? null, event.row.entity_id]), [['rejected', null, first.body.item.id]], decision + ': one alert, no person named')
      assert.equal(alerts.some(event => event.kind === 'approved'), false, decision + ': never announced as approved')
      assert.equal(answer.body.approval.replaced, true)
      return { status: row.status, by: row.decided_by, name: row.decided_by_name, note: row.decision_note, applied: row.applied_json, closed: row.closed_json, plan: row.plan_json }
    }
    const finished = await outcome('approve'), closed = await outcome('close')
    assert.deepEqual(finished, { status: 'rejected', by: null, name: null, note: 'Replaced by a newer count', applied: '{"lines":{}}', closed: '{"lines":{}}', plan: '{}' })
    assert.deepEqual(closed, finished, 'a close in the same situation ends exactly the same way')
    // A close that has a real line left to close is still a close by the person: rejected in his name with his note.
    reset(); setSwitches('on', 'on')
    const mixed = await submit([line(910002, 3, { seenQuantity: 5 }), line(910004, 3, { seenQuantity: 5 })], { requestId: 'f3-mixed-000001' })
    injectClaim(mixed.body.item.id, { plan: {} })
    assert.equal((await submit([line(910002, 4, { seenQuantity: 5 })], { requestId: 'f3-mixed-000002' }, LEAD)).status, 201)
    assert.equal((await decide(mixed.body.item.id, { decision: 'close', requestId: 'f3-mixed-close01', note: 'Not now' })).status, 200)
    assert.deepEqual({ by: approvalRow().decided_by, note: approvalRow().decision_note }, { by: ADMIN, note: 'Not now' })
  })

  // ---- INV S6: a count per received date is applied to ITS received date ----------------------------------------------------------------------------------------------
  /** Migration 0294 on the current database, and product 910001 holding a second received date (batch 920001, 4 units): A = batch 910001 (5), B = batch 920001 (4). */
  const withDates = () => {
    db.exec(fs.readFileSync(path.join(__dirname, '../migrations/0294_inventory_check_lot_lines.sql'), 'utf8'))
    setSwitches('on', 'on', 'on')
    db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,is_active) VALUES(920001,910001,'batch-920001','2026-10-25',1)").run()
    db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(920001,1,4)').run()
    db.exec('UPDATE branch_stock SET quantity=9 WHERE product_id=910001 AND branch_id=1; UPDATE products SET stock_quantity=9 WHERE id=910001')
  }
  const lotQty = batch => db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=? AND branch_id=1').get(batch).quantity
  const dated = (productId, lots, requestId = 'dated-request-01') => submit([{ productId, lots: lots.map(([batchId, counted, seen]) => ({ batchId, scope: 'lot', counted, seen })) }], { requestId })
  /** A sale of units from one received date, in every ledger together. */
  const sell = (batch, productId, units) => { for (const sql of [`UPDATE branch_batch_stock SET quantity=quantity-${units} WHERE batch_id=${batch} AND branch_id=1`, `UPDATE branch_stock SET quantity=quantity-${units} WHERE product_id=${productId} AND branch_id=1`, `UPDATE products SET stock_quantity=stock_quantity-${units} WHERE id=${productId}`]) db.exec(sql) }

  await check('S6: each counted received date is applied to ITS date: A=5, B=4, counted A=5, B=2, one sold from A: A=4, B=2 (first-in first-out would leave A=2, B=4)', async () => {
    reset(); withDates()
    const made = await dated(910001, [[910001, 5, 5], [920001, 2, 4]])
    assert.equal(made.status, 201, JSON.stringify(made.body)); assert.equal(made.body.approval.lines, 1)
    sell(910001, 910001, 1)
    const done = await decide(made.body.item.id, {})
    assert.equal(done.status, 200, JSON.stringify(done.body)); assert.equal(done.body.done, true); assert.equal(done.body.applied, 1)
    assert.deepEqual([lotQty(910001), lotQty(920001), ordinary(910001)], [4, 2, 6], 'B is Set from what the count found (4 -> 2); the sale from A survives; A, which matched, is never written')
    assert.deepEqual(writer.calls.map(call => ({ batchId: call.batchId, setScope: call.setScope, variance: call.variance, quantity: call.quantity })), [{ batchId: 920001, setScope: 'lot', variance: { counted: 2, seen: 4 }, quantity: undefined }])
    const line = JSON.parse(approvalRow().applied_json).lines['910001']
    assert.deepEqual({ before: line.before, after: line.after, lots: line.lots.map(lot => [lot.batchId, lot.before, lot.after]) }, { before: 8, after: 6, lots: [[920001, 4, 2]] }, 'before and after are the branch figures; the lots say which date moved')
    assert.ok(Number.isSafeInteger(line.lots[0].historyId) && typeof line.lots[0].operationId === 'string', 'the line carries what undoes it')
    assert.equal(db.prepare('SELECT state FROM inventory_check_items WHERE product_id=910001').get().state, 'done')
  })

  await check('S6: a product counted on several dates is applied date by date, one line per request on the Free plan, each repeat continuing; a lost answer applies nothing twice', async () => {
    reset(); withDates(); writer.cap = 1
    const made = await dated(910001, [[910001, 3, 5], [920001, 2, 4]]); const id = made.body.item.id
    failApprovalRecord = true
    const lost = await decide(id, {})
    assert.equal(lost.status, 503); assert.equal(lost.body.code, 'inventory_check_outcome_unknown')
    assert.deepEqual([lotQty(910001), lotQty(920001)], [3, 4], 'the first date landed; the answer was lost')
    failApprovalRecord = false
    const writes = writer.calls.length
    const first = await decide(id, {})
    assert.deepEqual({ applied: first.body.applied, remaining: first.body.remaining, done: first.body.done }, { applied: 1, remaining: 1, done: false })
    assert.equal(writer.calls.length, writes, 'the date that landed was replayed from its receipt, not applied again'); assert.equal(writer.replays, 1)
    assert.deepEqual(Object.keys(JSON.parse(approvalRow().applied_json).units), ['910001:910001'], 'what landed of a part-applied product is kept, the product is not recorded yet')
    assert.equal(db.prepare('SELECT state FROM inventory_check_items WHERE product_id=910001').get().state, 'issue', 'still a difference until every date landed')
    const waiting = (await products('branchId=1&pageSize=12')).body.items.find(item => item.id === 910001)
    assert.equal(waiting.check_pending, true, 'it still waits: a direct Set stays held')
    const second = await decide(id, {})
    assert.deepEqual({ applied: second.body.applied, remaining: second.body.remaining, done: second.body.done, status: second.body.approval.status }, { applied: 1, remaining: 0, done: true, status: 'approved' })
    assert.deepEqual([lotQty(910001), lotQty(920001), ordinary(910001)], [3, 2, 5], 'each date from its own count, once')
    const applied = JSON.parse(approvalRow().applied_json)
    assert.equal(applied.units, undefined, 'the product is recorded whole'); assert.deepEqual(applied.lines['910001'].lots.map(lot => [lot.batchId, lot.before, lot.after]), [[910001, 5, 3], [920001, 4, 2]])
    assert.deepEqual({ before: applied.lines['910001'].before, after: applied.lines['910001'].after }, { before: 9, after: 5 })
    assert.deepEqual(writer.calls.map(call => call.client_request_id), ['approve-request-01-910001-910001', 'approve-request-01-910001-920001'], 'one stock request per date, under the key that claimed the approval')
    assert.equal(db.prepare('SELECT state FROM inventory_check_items WHERE product_id=910001').get().state, 'done')
  })

  await check('S6: closing an approval keeps what landed of a part-applied product (marked partial) and records nothing as not applied for it', async () => {
    reset(); withDates(); writer.cap = 1
    const made = await dated(910001, [[910001, 3, 5], [920001, 2, 4]]); const id = made.body.item.id
    await decide(id, {})
    assert.deepEqual([lotQty(910001), lotQty(920001)], [3, 4])
    const writes = writer.calls.length
    const closed = await decide(id, { decision: 'close', requestId: 'close-request-01', note: 'Stop here' })
    assert.equal(closed.status, 200, JSON.stringify(closed.body)); assert.equal(closed.body.approval.status, 'approved'); assert.equal(writer.calls.length, writes, 'closing writes no stock')
    const line = JSON.parse(approvalRow().applied_json).lines['910001']
    assert.equal(line.partial, true); assert.deepEqual(line.lots.map(lot => [lot.batchId, lot.before, lot.after]), [[910001, 5, 3]])
    assert.deepEqual(closed.body.approval.closed, { lines: {} }); assert.deepEqual([lotQty(910001), lotQty(920001)], [3, 4])
  })

  await check('S6: a claimer who is gone after one date landed (answer lost): the takeover records that date from its receipt and the new approver applies the other under his own key', async () => {
    reset(); withDates(); writer.cap = 1
    const made = await dated(910001, [[910001, 3, 5], [920001, 2, 4]]); const id = made.body.item.id
    failApprovalRecord = true
    assert.equal((await decide(id, {})).status, 503); failApprovalRecord = false
    deactivate(ADMIN)
    const takeover = await decide(id, { requestId: 'takeover-lead-01' }, LEAD)
    assert.equal(takeover.status, 200, JSON.stringify(takeover.body)); assert.equal(takeover.body.takeover, true); assert.equal(takeover.body.applied, 1)
    const held = JSON.parse(approvalRow().applied_json).units['910001:910001']
    assert.deepEqual({ before: held.before, after: held.after, counted: held.counted, seen: held.seen }, { before: 5, after: 3, counted: 3, seen: 5 }, 'recorded from the answer the receipt holds')
    const finished = await decide(id, { requestId: 'takeover-lead-01' }, LEAD)
    assert.equal(finished.status, 200, JSON.stringify(finished.body)); assert.equal(finished.body.done, true)
    assert.deepEqual([lotQty(910001), lotQty(920001)], [3, 2], 'each date once')
    assert.equal(writer.calls.length, 2); assert.equal(writer.calls[1].client_request_id, 'takeover-lead-01-910001-920001', 'the new approver\'s own key, never the old one')
  })

  await check('S6: a branch-total line lands on the newest received date holding stock; a count with no dates (older) is the same line', async () => {
    reset(); withDates()
    const made = await submit([{ productId: 910001, lots: [{ scope: 'branch', counted: 7, seen: 9 }] }], { requestId: 'branch-total-01' })
    assert.equal(made.status, 201, JSON.stringify(made.body))
    sell(910001, 910001, 1)
    const done = await decide(made.body.item.id, {})
    assert.equal(done.status, 200, JSON.stringify(done.body))
    assert.deepEqual(writer.calls.map(call => ({ batchId: call.batchId, setScope: call.setScope, variance: call.variance })), [{ batchId: 920001, setScope: 'branch', variance: { counted: 7, seen: 9 } }], 'the newest date holding stock (920001, 25 Oct)')
    assert.deepEqual([ordinary(910001), lotQty(910001), lotQty(920001)], [6, 4, 2], 'branch 8 + (7 - 9) = 6, taken from that date')
    const legacy = await submit([line(910002, 3, { seenQuantity: 5 })], { requestId: 'legacy-count-01' })
    assert.equal((await decide(legacy.body.item.id, { requestId: 'approve-request-02' })).status, 200); assert.equal(ordinary(910002), 3)
    assert.equal(writer.calls[1].batchId, 910002); assert.equal(writer.calls[1].setScope, 'branch')
  })

  console.log(`${groups} groups passed`)
}
main().catch(error => { console.error(error); process.exit(1) })
