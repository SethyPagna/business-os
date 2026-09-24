// N6 (owner, 23 Sep 2026): "Stock-in sessions editable (today only add or
// delete)." Companion for lib/stockInLineEdit.ts, the ONE writer behind
// POST /api/inventory/stock-in-lines/:movementId/edit, and for the line fold
// in lib/stockInSessionsQuery.ts that every Stock-in Sessions reader uses.
//
// Real-SQLite harness (every migration applied, the REAL route and lib files
// transpiled, mounted in Hono and driven over HTTP) -- the same one
// test-stock-lot-adjustment-pure.cjs uses. The line is created by the REAL
// stock-session writer (POST /api/inventory/sessions), so the root receipt is
// byte-for-byte what production writes. Every stock number, lot figure, loss
// figure and session-list figure is asserted at each step, including the
// double-apply (replay) and the reversal (undo/redo) of each transition.
//
// Run (from cloudflare/): node scripts/test-stock-in-line-edit-pure.cjs
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const { Hono } = require('hono')
const { fixture, user } = require('./test-stock-session-atomic.cjs')

const root = process.env.STOCK_IN_EDIT_TEST_ROOT || path.join(__dirname, '..')

function loadModules() {
  const cache = new Map()
  const load = (relativeFile) => {
    const normalized = relativeFile.replaceAll('\\', '/')
    if (cache.has(normalized)) return cache.get(normalized).exports
    const file = path.join(root, 'src', normalized)
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
    }).outputText
    const mod = { exports: {} }
    cache.set(normalized, mod)
    const req = (name) => {
      if (name === '../lib/auth' || name === './auth') return {
        requireAuth: async (c, next) => { c.set('user', c.req.header('x-test-user') ? JSON.parse(c.req.header('x-test-user')) : user); await next() },
      }
      if (name === './cache' || name === '../lib/cache') return { bumpVersion: async () => {}, getVersion: async () => 0, cacheKey: (...a) => a.join(':'), cachedJson: async (c, k, t, fn) => c.json(await fn()) }
      if (name === '../durable-objects/broadcastHub') return { broadcast: async () => {} }
      if (name === './telegram' || name === '../lib/telegram') return { sendTelegramEvent: async () => {}, formatStockChangeTelegramLines: () => [], formatTransferTelegramLines: () => [] }
      if (name.startsWith('./')) return load(path.posix.join(path.posix.dirname(normalized), `${name.slice(2)}.ts`))
      if (name.startsWith('../')) return load(path.posix.join(path.posix.dirname(normalized), `${name}.ts`))
      return require(name)
    }
    new Function('require', 'module', 'exports', output)(req, mod, mod.exports)
    return mod.exports
  }
  return load
}

const load = loadModules()
const app = new Hono()
app.route('/api/inventory', load('routes/inventory.ts').default)
app.route('/api/action-history', load('routes/actionHistory.ts').default)
const losses = load('lib/removalLosses.ts')
const sessionsQuery = load('lib/stockInSessionsQuery.ts')

function fresh() {
  load('lib/stockMutationReceipt.ts').resetStockMutationReceiptSchemaProbe()
  load('lib/stockInLineEdit.ts').resetStockInLineEditSchemaProbe()
  return fixture()
}

function call(f, method, url, body, headers = {}) {
  return app.request(url, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, f.env, { waitUntil(promise) { Promise.resolve(promise).catch(() => {}) } })
}
async function send(f, method, url, body, headers) {
  const res = await call(f, method, url, body, headers)
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

// One stock-in session line through the REAL session writer.
async function receive(f, { requestId, quantity, cost = 2, date = '2026-09-05', supplier = 'Fixture Supplier' }) {
  const res = await send(f, 'POST', '/api/inventory/sessions', {
    client_request_id: requestId, mode: 'stock_in',
    defaults: { supplier_name: supplier, branch_id: 1, received_date: date },
    items: [{ line_id: 'line-001', kind: 'receive', product_id: 1, quantity, unit_cost_usd: cost }],
  })
  assert.equal(res.status, 200, JSON.stringify(res.json))
  const movementId = f.sql.prepare("SELECT movement_id id FROM stock_session_members WHERE operation_id=?").get(res.json.operationId).id
  return { movementId, historyId: res.json.actionHistoryId, batchId: res.json.items[0].batchId }
}

let requestCounter = 0
const edit = (f, movementId, body, headers) => send(f, 'POST', `/api/inventory/stock-in-lines/${movementId}/edit`,
  { client_request_id: body.client_request_id || `edit-request-${++requestCounter}`, expected_batch_revision: lineRevision(f, movementId), ...body }, headers)

// Existing transition fixtures open a fresh review for each edit. Tests of
// stale requests and retries pass the captured revision explicitly instead.
function lineRevision(f, movementId) {
  if (!f.sql.prepare('SELECT id FROM inventory_movements WHERE id=?').get(movementId)) return 0
  return sessionLines(f, movementId).find((row) => row.id === movementId)?.batch_revision ?? 0
}

function lot(f, id) {
  const row = f.sql.prepare('SELECT * FROM product_batches WHERE id=?').get(id)
  const stock = f.sql.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=? AND branch_id=1').get(id)
  return { ...row, stock: stock ? stock.quantity : 0 }
}
function totals(f) {
  return {
    branch: f.sql.prepare('SELECT quantity q FROM branch_stock WHERE product_id=1 AND branch_id=1').get().q,
    product: f.sql.prepare('SELECT stock_quantity q FROM products WHERE id=1').get().q,
    lots: f.sql.prepare('SELECT COALESCE(SUM(quantity),0) q FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id=bbs.batch_id WHERE pb.variant_product_id=1 AND bbs.branch_id=1').get().q,
  }
}
function writeSnapshot(f) {
  return JSON.stringify(['products', 'product_batches', 'branch_stock', 'branch_batch_stock', 'inventory_movements',
    'stock_session_revisions', 'stock_lot_adjustment_operations', 'action_history', 'audit_logs'].map((table) =>
    f.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()))
}
function loss(f) {
  const rows = f.sql.prepare(`SELECT ${losses.REMOVAL_LOSS_SELECT} ${losses.REMOVAL_LOSS_FROM} WHERE ${losses.removalLossMovementWhere('m')}`).all()
  return losses.summarizeRemovalLosses(rows)
}
function sessionList(f) {
  const { groupedSql, params } = sessionsQuery.buildStockInSessionListQuery('')
  return f.sql.prepare(`SELECT * FROM (${groupedSql}) ORDER BY created_at`).all(params)
}
function sessionLines(f, movementId) {
  const ref = f.sql.prepare('SELECT reference_id FROM inventory_movements WHERE id=?').get(movementId).reference_id
  const locator = sessionsQuery.parseStockInSessionKey(`session:${ref}`)
  return f.sql.prepare(sessionsQuery.stockInSessionLinesSql(locator)).all(sessionsQuery.stockInSessionLineParams(locator))
}
const editRows = (f, movementId) => f.sql.prepare("SELECT movement_type,quantity,total_cost_usd,batch_id,reference_id FROM inventory_movements WHERE reference_id LIKE ? ORDER BY id").all(`stock-in-edit:${movementId}:%`)
const historyOf = (f, operationId) => f.sql.prepare('SELECT h.id,h.status,h.undo_payload FROM stock_lot_adjustment_operations o JOIN action_history h ON h.id=o.history_id WHERE o.id=?').get(operationId)
const undo = (f, id, generation) => send(f, 'POST', `/api/action-history/${id}/undo`, { expected_generation: generation, require_applied: true })
const redo = (f, id, generation) => send(f, 'POST', `/api/action-history/${id}/redo`, { expected_generation: generation, require_applied: true })
// "Sell" units out of a lot the way a sale's stock effect lands: lot, branch and product together.
function sell(f, batchId, quantity) {
  f.sql.prepare('UPDATE branch_batch_stock SET quantity=quantity-? WHERE batch_id=? AND branch_id=1').run(quantity, batchId)
  f.sql.prepare('UPDATE branch_stock SET quantity=quantity-? WHERE product_id=1 AND branch_id=1').run(quantity)
  f.sql.prepare('UPDATE products SET stock_quantity=stock_quantity-? WHERE id=1').run(quantity)
}

const failures = []
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.error(`FAIL ${name}\n`, error) }
}

async function main() {
  await check('metadata-only edits invalidate the reviewed lot revision without changing quantity or batch id', async () => {
    const f = fresh()
    const { movementId, batchId } = await receive(f, { requestId: 'revision-metadata-01', quantity: 10 })
    const revision = f.sql.prepare("SELECT revision FROM stock_session_revisions WHERE entity_type='batch' AND entity_key=?").get(String(batchId)).revision
    f.sql.prepare("UPDATE product_batches SET supplier_name='Changed supplier' WHERE id=?").run(batchId)
    const result = await edit(f, movementId, { quantity: 12, expected_quantity: 10, expected_batch_id: batchId, expected_batch_revision: revision })
    assert.equal(result.status, 409, JSON.stringify(result.json))
    assert.equal(result.json.code, 'stale_line')
    assert.deepEqual(totals(f), { branch: 10, product: 10, lots: 10 })
    assert.equal(editRows(f, movementId).length, 0)
  })

  await check('cost/date/payment/expiry edits and ABA preserve quantity but invalidate the review and write nothing', async () => {
    for (const change of [
      "unit_cost_usd=3", "received_at='2026-09-04'", "payment_status='credit',credit_due_date='2026-10-01'", "expiry_date='2027-01-01'",
      "supplier_name='Temporary supplier'",
    ]) {
      const f = fresh()
      const { movementId, batchId } = await receive(f, { requestId: 'revision-fields-001', quantity: 10 })
      const line = sessionLines(f, movementId)[0]
      assert.equal(line.batch_revision, lineRevision(f, movementId), 'the same line SELECT exposes the lot revision')
      const body = { quantity: 12, expected_quantity: 10, expected_batch_id: batchId, expected_batch_revision: line.batch_revision }
      f.sql.prepare(`UPDATE product_batches SET ${change} WHERE id=?`).run(batchId)
      if (change.startsWith('supplier_name')) f.sql.prepare("UPDATE product_batches SET supplier_name='Fixture Supplier' WHERE id=?").run(batchId)
      assert.ok(lineRevision(f, movementId) > line.batch_revision, 'including change then restore with the same timestamp')
      const before = writeSnapshot(f)
      const response = await edit(f, movementId, body)
      assert.equal(response.status, 409, `${change}: ${JSON.stringify(response.json)}`)
      assert.equal(response.json.code, 'stale_line')
      assert.equal(writeSnapshot(f), before)
    }
  })

  await check('a metadata race immediately before ordinaryBusinessBatch fails the retained revision guard atomically', async () => {
    const f = fresh()
    const { movementId, batchId } = await receive(f, { requestId: 'revision-race-0001', quantity: 10 })
    const revision = lineRevision(f, movementId)
    let raced
    f.beforeCommit((sql) => {
      // Payment was not in the old lot-state guard, so this discriminates the
      // retained revision from merely rechecking the existing field snapshot.
      sql.prepare("UPDATE product_batches SET payment_status='credit',credit_due_date='2026-10-01' WHERE id=?").run(batchId)
      raced = writeSnapshot(f)
    })
    const response = await edit(f, movementId, { quantity: 12, expected_quantity: 10, expected_batch_id: batchId, expected_batch_revision: revision })
    assert.equal(response.status, 409, JSON.stringify(response.json))
    assert.equal(response.json.code, 'stale_state')
    assert.equal(writeSnapshot(f), raced, 'only the external change remains, never a partial edit/history/receipt')
  })

  await check('strict revision parsing refuses omitted/coerced/unsafe versions and supports initial revision zero', async () => {
    const f = fresh()
    const { movementId, batchId } = await receive(f, { requestId: 'revision-parse-001', quantity: 10 })
    const before = writeSnapshot(f)
    for (const value of [undefined, null, '', '1', -1, 1.5, Number.MAX_SAFE_INTEGER + 1, true, NaN, Infinity]) {
      const response = await send(f, 'POST', `/api/inventory/stock-in-lines/${movementId}/edit`, {
        client_request_id: 'revision-invalid-001', quantity: 12, expected_batch_revision: value,
      })
      assert.equal(response.status, 400, String(value))
      assert.equal(response.json.code, 'invalid_batch_revision', String(value))
      assert.equal(writeSnapshot(f), before)
    }
    f.sql.prepare("DELETE FROM stock_session_revisions WHERE entity_type='batch' AND entity_key=?").run(String(batchId))
    assert.equal(lineRevision(f, movementId), 0)
    const valid = await edit(f, movementId, { quantity: 12, expected_batch_revision: 0 })
    assert.equal(valid.status, 200, JSON.stringify(valid.json))
  })

  await check('a lost acknowledgement replays with its old revision, but a changed revision/body under that id is refused', async () => {
    const f = fresh()
    const { movementId, batchId } = await receive(f, { requestId: 'revision-replay-01', quantity: 10 })
    const body = { client_request_id: 'revision-edit-replay-01', quantity: 12, expected_quantity: 10, expected_batch_id: batchId, expected_batch_revision: lineRevision(f, movementId) }
    f.loseNextCommitAcknowledgement()
    const first = await edit(f, movementId, body)
    assert.equal(first.status, 200, JSON.stringify(first.json))
    assert.equal(first.json.replayed, true)
    assert.ok(lineRevision(f, movementId) > body.expected_batch_revision)
    const snapshot = writeSnapshot(f)
    const retry = await edit(f, movementId, body)
    assert.equal(retry.status, 200)
    assert.equal(retry.json.replayed, true)
    assert.equal(writeSnapshot(f), snapshot)
    const changed = await edit(f, movementId, { ...body, expected_batch_revision: lineRevision(f, movementId) })
    assert.equal(changed.status, 409)
    assert.equal(changed.json.code, 'idempotency_conflict')
    assert.equal(writeSnapshot(f), snapshot)
    const receipt = f.sql.prepare('SELECT request_json,request_digest FROM stock_lot_adjustment_operations WHERE request_id=?').get(body.client_request_id)
    assert.equal(JSON.parse(receipt.request_json).expectedBatchRevision, body.expected_batch_revision)
    assert.equal(receipt.request_digest, require('node:crypto').createHash('sha256').update(receipt.request_json).digest('hex'))
    // The next actual operation uses the fresh revision, including removal.
    const removed = await edit(f, movementId, { quantity: 0, expected_quantity: 12, expected_batch_id: batchId, expected_batch_revision: lineRevision(f, movementId) })
    assert.equal(removed.status, 200, JSON.stringify(removed.json))
    assert.deepEqual(totals(f), { branch: 0, product: 0, lots: 0 })
  })

  await check('quantity parser accepts decimal and upper-bound values and rejects out-of-range or non-numeric values', async () => {
    const parse = load('lib/stockInLineEdit.ts').parseStockInLineEditRequest
    for (const quantity of [0, 1.25, 1_000_000_000]) assert.equal(parse(1, { quantity, expected_batch_revision: 0 }).quantity, quantity)
    for (const quantity of [-1, 1_000_000_001, NaN, Infinity, '', '1']) assert.throws(() => parse(1, { quantity, expected_batch_revision: 0 }), /Quantity/)
  })

  await check('increase: lot, branch, product and lot cost move by exactly +d; the movement is a receipt; replay does not double-apply; undo and redo are exact', async () => {
    const f = fresh()
    const { movementId, batchId } = await receive(f, { requestId: 'session-inc-0001', quantity: 10 })
    assert.deepEqual(totals(f), { branch: 10, product: 10, lots: 10 })
    const body = { client_request_id: 'edit-inc-000001', quantity: 12, expected_quantity: 10, expected_batch_id: batchId, expected_batch_revision: lineRevision(f, movementId) }
    const res = await edit(f, movementId, body)
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.deepEqual(totals(f), { branch: 12, product: 12, lots: 12 })
    let a = lot(f, batchId)
    assert.equal(a.stock, 12); assert.equal(a.received_quantity, 12); assert.equal(a.received_cost_usd, 24)
    assert.deepEqual(editRows(f, movementId).map((r) => [r.movement_type, r.quantity, r.total_cost_usd, r.batch_id]), [['add', 2, 4, batchId]])
    // Double-apply: the same request id and body is answered from the stored operation.
    const again = await edit(f, movementId, body)
    assert.equal(again.status, 200); assert.equal(again.json.replayed, true)
    assert.deepEqual(totals(f), { branch: 12, product: 12, lots: 12 })
    assert.equal(editRows(f, movementId).length, 1)
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM stock_lot_adjustment_operations').get().n, 1)
    // The same id with a different body is refused, and nothing moves.
    const conflict = await edit(f, movementId, { ...body, quantity: 13 })
    assert.equal(conflict.status, 409); assert.equal(conflict.json.code, 'idempotency_conflict')
    assert.deepEqual(totals(f), { branch: 12, product: 12, lots: 12 })
    // The session list and the session lines read the line's CURRENT state.
    const [session] = sessionList(f)
    assert.equal(session.quantity, 12); assert.equal(session.movement_cost_usd, 24); assert.equal(session.line_count, 1)
    const [line] = sessionLines(f, movementId)
    assert.equal(line.quantity, 12); assert.equal(line.total_cost_usd, 24); assert.equal(line.batch_id, batchId); assert.equal(line.edit_count, 1)
    assert.equal(loss(f).removal_loss_qty, 0)
    // Undo, then undo again (idempotent), then redo.
    const history = historyOf(f, res.json.operation_id)
    assert.equal((await undo(f, history.id, 0)).status, 200)
    assert.deepEqual(totals(f), { branch: 10, product: 10, lots: 10 })
    a = lot(f, batchId)
    assert.equal(a.received_quantity, 10); assert.equal(a.received_cost_usd, 20)
    assert.equal((await undo(f, history.id, 0)).status, 200, 'a repeated undo of the same generation is a no-op')
    assert.deepEqual(totals(f), { branch: 10, product: 10, lots: 10 })
    assert.equal(sessionLines(f, movementId)[0].quantity, 10)
    assert.equal(sessionLines(f, movementId)[0].total_cost_usd, 20)
    assert.equal(loss(f).removal_loss_qty, 0, 'the undo of an increase is not a loss')
    assert.equal((await redo(f, history.id, 1)).status, 200)
    assert.deepEqual(totals(f), { branch: 12, product: 12, lots: 12 })
    assert.equal(lot(f, batchId).received_cost_usd, 24)
    assert.equal(sessionLines(f, movementId)[0].quantity, 12)
  })

  await check('decrease: a correction with a NEGATIVE remove row, not a loss (session-undo precedent); undo restores exactly', async () => {
    const f = fresh()
    const { movementId, batchId } = await receive(f, { requestId: 'session-dec-0001', quantity: 10 })
    const res = await edit(f, movementId, { quantity: 7, expected_quantity: 10, expected_batch_id: batchId })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.deepEqual(totals(f), { branch: 7, product: 7, lots: 7 })
    const a = lot(f, batchId)
    assert.equal(a.received_quantity, 7); assert.equal(a.received_cost_usd, 14)
    assert.deepEqual(editRows(f, movementId).map((r) => [r.movement_type, r.quantity, r.total_cost_usd]), [['remove', -3, -6]])
    assert.deepEqual(loss(f), { removal_loss_usd: 0, removal_loss_qty: 0, removal_loss_unvalued_rows: 0 })
    assert.equal(sessionList(f)[0].quantity, 7); assert.equal(sessionList(f)[0].movement_cost_usd, 14)
    const history = historyOf(f, res.json.operation_id)
    assert.equal((await undo(f, history.id, 0)).status, 200)
    assert.deepEqual(totals(f), { branch: 10, product: 10, lots: 10 })
    assert.equal(lot(f, batchId).received_cost_usd, 20)
    assert.deepEqual(loss(f).removal_loss_qty, 0)
  })

  await check('decrease below what was already sold is refused with the lowest allowed quantity; nothing moves', async () => {
    const f = fresh()
    const { movementId, batchId } = await receive(f, { requestId: 'session-sold-001', quantity: 10 })
    sell(f, batchId, 6)
    const refused = await edit(f, movementId, { quantity: 3 })
    assert.equal(refused.status, 409); assert.equal(refused.json.code, 'below_consumed'); assert.equal(refused.json.minimum, 6)
    assert.match(refused.json.error, /already sold or moved out/)
    assert.deepEqual(totals(f), { branch: 4, product: 4, lots: 4 })
    assert.equal(lot(f, batchId).received_quantity, 10)
    assert.equal(editRows(f, movementId).length, 0)
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM stock_lot_adjustment_operations').get().n, 0)
    const allowed = await edit(f, movementId, { quantity: 6 })
    assert.equal(allowed.status, 200, JSON.stringify(allowed.json))
    assert.deepEqual(totals(f), { branch: 0, product: 0, lots: 0 })
    assert.equal(lot(f, batchId).received_quantity, 6)
  })

  await check('cost change: the lot cost and the catalog cost follow, the line total moves by a quantity row plus a cost-correction row; undo restores both', async () => {
    const f = fresh()
    const { movementId, batchId } = await receive(f, { requestId: 'session-cost-001', quantity: 10 })
    assert.equal(f.sql.prepare('SELECT cost_price_usd c FROM products WHERE id=1').get().c, 2)
    const res = await edit(f, movementId, { quantity: 12, unit_cost_usd: 3, expected_quantity: 10, expected_batch_id: batchId })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    const a = lot(f, batchId)
    assert.equal(a.unit_cost_usd, 3); assert.equal(a.received_quantity, 12); assert.equal(a.received_cost_usd, 36)
    assert.equal(f.sql.prepare('SELECT cost_price_usd c FROM products WHERE id=1').get().c, 3)
    assert.deepEqual(editRows(f, movementId).map((r) => [r.movement_type, r.quantity, r.total_cost_usd]), [['add', 2, 6], ['adjustment', 0, 10]])
    const [line] = sessionLines(f, movementId)
    assert.equal(line.total_cost_usd, 36); assert.equal(line.unit_cost_usd, 3)
    assert.equal(loss(f).removal_loss_qty, 0)
    const history = historyOf(f, res.json.operation_id)
    assert.equal((await undo(f, history.id, 0)).status, 200)
    const back = lot(f, batchId)
    assert.equal(back.unit_cost_usd, 2); assert.equal(back.received_cost_usd, 20); assert.equal(back.received_quantity, 10)
    assert.equal(f.sql.prepare('SELECT cost_price_usd c FROM products WHERE id=1').get().c, 2)
    assert.equal(sessionLines(f, movementId)[0].total_cost_usd, 20)
    assert.deepEqual(totals(f), { branch: 10, product: 10, lots: 10 })
  })

  await check('a cost or supplier change on a received date shared with another receipt is refused', async () => {
    const f = fresh()
    const first = await receive(f, { requestId: 'session-share-01', quantity: 10 })
    const second = await receive(f, { requestId: 'session-share-02', quantity: 5 })
    assert.equal(first.batchId, second.batchId, 'same date and cost share one lot')
    const cost = await edit(f, first.movementId, { quantity: 10, unit_cost_usd: 3 })
    assert.equal(cost.status, 409); assert.equal(cost.json.code, 'shared_lot')
    const supplier = await edit(f, first.movementId, { quantity: 10, supplier_name: 'Someone else' })
    assert.equal(supplier.status, 409); assert.equal(supplier.json.code, 'shared_lot')
    assert.equal(lot(f, first.batchId).unit_cost_usd, 2)
    assert.equal(lot(f, first.batchId).supplier_name, 'Fixture Supplier')
  })

  await check('received date, lot held by this line alone: changed in place on the same lot (sold units stay attributed)', async () => {
    const f = fresh()
    const { movementId, batchId } = await receive(f, { requestId: 'session-date-001', quantity: 10 })
    sell(f, batchId, 4)
    const res = await edit(f, movementId, { quantity: 10, received_date: '2026-09-03', supplier_name: 'Corrected Supplier' })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    const a = lot(f, batchId)
    assert.equal(a.received_at, '2026-09-03'); assert.equal(a.supplier_name, 'Corrected Supplier'); assert.equal(a.stock, 6)
    assert.equal(sessionLines(f, movementId)[0].batch_received_at, '2026-09-03')
    assert.equal(editRows(f, movementId).length, 0, 'no stock moved, so no movement row')
    const audit = f.sql.prepare("SELECT old_value,new_value FROM audit_logs WHERE action='stock_in_line_edit'").get()
    assert.equal(JSON.parse(audit.old_value).received_date, '2026-09-05'); assert.equal(JSON.parse(audit.new_value).received_date, '2026-09-03')
    const history = historyOf(f, res.json.operation_id)
    assert.equal((await undo(f, history.id, 0)).status, 200)
    assert.equal(lot(f, batchId).received_at, '2026-09-05'); assert.equal(lot(f, batchId).supplier_name, 'Fixture Supplier')
  })

  await check('received date, lot shared with another receipt: the line MOVES to the lot of the new date; undo/redo move it back and forth exactly', async () => {
    const f = fresh()
    const first = await receive(f, { requestId: 'session-move-01', quantity: 10 })
    const second = await receive(f, { requestId: 'session-move-02', quantity: 5 })
    const A = first.batchId
    const res = await edit(f, first.movementId, { quantity: 10, received_date: '2026-09-07', expected_quantity: 10, expected_batch_id: A })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    const T = f.sql.prepare("SELECT id FROM product_batches WHERE variant_product_id=1 AND received_at='2026-09-07'").get().id
    assert.notEqual(T, A)
    assert.deepEqual(totals(f), { branch: 15, product: 15, lots: 15 })
    let a = lot(f, A); let t = lot(f, T)
    assert.deepEqual([a.stock, a.received_quantity, a.received_cost_usd], [5, 5, 10])
    assert.deepEqual([t.stock, t.received_quantity, t.received_cost_usd, t.unit_cost_usd, t.supplier_name, t.is_active], [10, 10, 20, 2, 'Fixture Supplier', 1])
    assert.deepEqual(editRows(f, first.movementId).map((r) => [r.movement_type, r.quantity, r.batch_id]), [['remove', -10, A], ['add', 10, T]])
    assert.equal(loss(f).removal_loss_qty, 0)
    const lines = sessionLines(f, first.movementId)
    assert.equal(lines[0].batch_id, T); assert.equal(lines[0].quantity, 10); assert.equal(lines[0].batch_received_at, '2026-09-07')
    assert.equal(sessionLines(f, second.movementId)[0].batch_id, A, 'the other receipt stays on its lot')
    assert.equal(sessionList(f).length, 2, 'an edit row never becomes a session of its own')
    const history = historyOf(f, res.json.operation_id)
    assert.equal((await undo(f, history.id, 0)).status, 200)
    a = lot(f, A); t = lot(f, T)
    assert.deepEqual([a.stock, a.received_quantity, a.received_cost_usd], [15, 15, 30])
    assert.deepEqual([t.stock, t.received_quantity, t.is_active], [0, 0, 0])
    assert.equal(sessionLines(f, first.movementId)[0].batch_id, A)
    assert.deepEqual(totals(f), { branch: 15, product: 15, lots: 15 })
    assert.equal((await redo(f, history.id, 1)).status, 200)
    assert.equal(lot(f, T).stock, 10); assert.equal(lot(f, A).stock, 5)
    assert.equal(sessionLines(f, first.movementId)[0].batch_id, T)
  })

  await check('a move is refused when some of the line was already sold out of the shared lot', async () => {
    const f = fresh()
    const first = await receive(f, { requestId: 'session-mvsold-1', quantity: 10 })
    await receive(f, { requestId: 'session-mvsold-2', quantity: 5 })
    sell(f, first.batchId, 6)
    const res = await edit(f, first.movementId, { quantity: 10, received_date: '2026-09-07' })
    assert.equal(res.status, 409); assert.equal(res.json.code, 'move_consumed')
    assert.deepEqual(totals(f), { branch: 9, product: 9, lots: 9 })
  })

  await check('audit: one row with the before and after of the line, on the product (the Records float), and one per undo', async () => {
    const f = fresh()
    const { movementId } = await receive(f, { requestId: 'session-audit-01', quantity: 10 })
    const res = await edit(f, movementId, { quantity: 8, reason: 'Typo on the invoice' })
    assert.equal(res.status, 200)
    const row = f.sql.prepare("SELECT * FROM audit_logs WHERE action='stock_in_line_edit'").get()
    assert.equal(row.entity, 'product'); assert.equal(row.entity_id, '1')
    assert.deepEqual(JSON.parse(row.old_value), { quantity: 10, unit_cost_usd: 2, received_date: '2026-09-05', supplier_name: 'Fixture Supplier' })
    assert.deepEqual(JSON.parse(row.new_value), { quantity: 8, unit_cost_usd: 2, received_date: '2026-09-05', supplier_name: 'Fixture Supplier' })
    assert.equal(JSON.parse(row.details).reason, 'Typo on the invoice')
    await undo(f, historyOf(f, res.json.operation_id).id, 0)
    const undone = f.sql.prepare("SELECT * FROM audit_logs WHERE action='action_undo' AND entity='product'").get()
    assert.equal(JSON.parse(undone.old_value).quantity, 8); assert.equal(JSON.parse(undone.new_value).quantity, 10)
  })

  await check('permissions: no inventory adjust -> 403; a cost without cost-entry permission -> 403; nothing moves', async () => {
    const f = fresh()
    const { movementId } = await receive(f, { requestId: 'session-perm-001', quantity: 10 })
    const viewer = { ...user, id: 8, permissions: JSON.stringify({ products: true }) }
    const denied = await edit(f, movementId, { quantity: 12 }, { 'x-test-user': JSON.stringify(viewer) })
    assert.equal(denied.status, 403)
    const stockOnly = { ...user, id: 9, permissions: JSON.stringify({ inventory: true }) }
    const noCost = await edit(f, movementId, { quantity: 10, unit_cost_usd: 5 }, { 'x-test-user': JSON.stringify(stockOnly) })
    assert.equal(noCost.status, 403); assert.equal(noCost.json.code, 'product_cost_edit_required')
    assert.deepEqual(totals(f), { branch: 10, product: 10, lots: 10 })
    const qtyOnly = await edit(f, movementId, { quantity: 11 }, { 'x-test-user': JSON.stringify(stockOnly) })
    assert.equal(qtyOnly.status, 200, 'a quantity change needs only the stock-in permission')
  })

  await check('receipt gate: an edit cannot clear the supplier or declare an undeclared $0.00 cost', async () => {
    const f = fresh()
    const { movementId, batchId } = await receive(f, { requestId: 'session-gate-001', quantity: 10 })
    const cleared = await edit(f, movementId, { quantity: 10, supplier_name: '' })
    assert.equal(cleared.status, 400); assert.equal(cleared.json.code, 'supplier_required')
    const free = await edit(f, movementId, { quantity: 10, unit_cost_usd: 0 })
    assert.equal(free.status, 400); assert.equal(free.json.code, 'free_goods_required')
    assert.equal(lot(f, batchId).unit_cost_usd, 2); assert.equal(lot(f, batchId).supplier_name, 'Fixture Supplier')
    const declared = await edit(f, movementId, { quantity: 10, unit_cost_usd: 0, free_goods: true })
    assert.equal(declared.status, 200, JSON.stringify(declared.json))
    assert.equal(lot(f, batchId).received_cost_usd, 0)
  })

  await check('neighbours: the ledger revert refuses an edited line and an edit row; a session undo after an edit is refused; a stale line is refused', async () => {
    const f = fresh()
    const { movementId, historyId, batchId } = await receive(f, { requestId: 'session-neigh-01', quantity: 10 })
    const res = await edit(f, movementId, { quantity: 12 })
    assert.equal(res.status, 200)
    const rootRevert = await send(f, 'POST', `/api/inventory/movements/${movementId}/revert`, {})
    assert.equal(rootRevert.status, 409)
    const editRowId = f.sql.prepare("SELECT id FROM inventory_movements WHERE reference_id LIKE 'stock-in-edit:%'").get().id
    const rowRevert = await send(f, 'POST', `/api/inventory/movements/${editRowId}/revert`, {})
    assert.equal(rowRevert.status, 409)
    const sessionUndo = await undo(f, historyId, 0)
    assert.notEqual(sessionUndo.status, 200, 'a session undo would reverse the ORIGINAL receipt; its state guard refuses')
    assert.deepEqual(totals(f), { branch: 12, product: 12, lots: 12 })
    const stale = await edit(f, movementId, { quantity: 9, expected_quantity: 10, expected_batch_id: batchId })
    assert.equal(stale.status, 409); assert.equal(stale.json.code, 'stale_line')
    // Quantity 0 is how an edited line is removed: a correction, not a loss.
    const zero = await edit(f, movementId, { quantity: 0, expected_quantity: 12, expected_batch_id: batchId })
    assert.equal(zero.status, 200)
    assert.deepEqual(totals(f), { branch: 0, product: 0, lots: 0 })
    assert.equal(loss(f).removal_loss_qty, 0)
  })

  if (failures.length) {
    console.error(`\n${failures.length} failing: ${failures.join('; ')}`)
    process.exit(1)
  }
  console.log('\nAll stock-in line edit checks passed.')
}

main().catch((error) => { console.error(error); process.exit(1) })
