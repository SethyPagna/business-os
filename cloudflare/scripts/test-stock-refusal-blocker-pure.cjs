// RET-D (owner, 5 Oct 2026): "Stock-in session edits: lowering or raising a
// line's quantity adjusts stock to the new quantity WITHOUT booking a
// loss/write-off", and "when Revert is not allowed, say concisely WHY and
// WHERE (destination), with an in-built link" (TRANSITION-MATRIX-AUDIT.md 2.4).
//
// Real-SQLite harness (every migration applied; the REAL routes and libs
// transpiled and mounted in Hono), the one test-stock-in-line-edit-pure.cjs
// uses. Each transition is asserted on BOTH stock ledgers -- branch_stock /
// products.stock_quantity and the lot (branch_batch_stock + received figures)
// -- plus the loss figure, the double-apply and the reversal. Every refusal
// must name the record that blocked it (reason / blocker / destination) and
// change nothing.
//
// Run (from cloudflare/): node scripts/test-stock-refusal-blocker-pure.cjs
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const { Hono } = require('hono')
const { fixture, user } = require('./test-stock-session-atomic.cjs')

const root = path.join(__dirname, '..')

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
        requireAuth: async (c, next) => { c.set('user', user); await next() },
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
const blockerLib = load('lib/stockRefusalBlocker.ts')

function fresh() {
  load('lib/stockMutationReceipt.ts').resetStockMutationReceiptSchemaProbe()
  load('lib/stockInLineEdit.ts').resetStockInLineEditSchemaProbe()
  const f = fixture()
  f.sql.prepare("INSERT INTO branches(id, name, is_default, is_active) VALUES(2, 'Warehouse', 0, 1)").run()
  return f
}

async function send(f, method, url, body) {
  const res = await app.request(url, {
    method, headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, f.env, { waitUntil(promise) { Promise.resolve(promise).catch(() => {}) } })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

async function receive(f, requestId, quantity, cost = 2) {
  const res = await send(f, 'POST', '/api/inventory/sessions', {
    client_request_id: requestId, mode: 'stock_in',
    defaults: { supplier_name: 'Fixture Supplier', branch_id: 1, received_date: '2026-09-05' },
    items: [{ line_id: 'line-001', kind: 'receive', product_id: 1, quantity, unit_cost_usd: cost }],
  })
  assert.equal(res.status, 200, JSON.stringify(res.json))
  const movementId = f.sql.prepare('SELECT movement_id id FROM stock_session_members WHERE operation_id=?').get(res.json.operationId).id
  return { movementId, historyId: res.json.actionHistoryId, batchId: res.json.items[0].batchId }
}

function sessionLines(f, movementId) {
  const ref = f.sql.prepare('SELECT reference_id FROM inventory_movements WHERE id=?').get(movementId).reference_id
  const locator = sessionsQuery.parseStockInSessionKey(`session:${ref}`)
  return f.sql.prepare(sessionsQuery.stockInSessionLinesSql(locator)).all(sessionsQuery.stockInSessionLineParams(locator))
}
const lineRevision = (f, movementId) => sessionLines(f, movementId).find((row) => row.id === movementId)?.batch_revision ?? 0
let counter = 0
const edit = (f, movementId, body) => send(f, 'POST', `/api/inventory/stock-in-lines/${movementId}/edit`,
  { client_request_id: body.client_request_id || `blocker-edit-${++counter}`, expected_batch_revision: lineRevision(f, movementId), ...body })

// Both ledgers at branch 1, the lot across every branch, and the loss figure.
function ledgers(f, batchId) {
  const one = (sql, ...args) => f.sql.prepare(sql).get(...args)
  return {
    branch: one('SELECT COALESCE(quantity,0) q FROM branch_stock WHERE product_id=1 AND branch_id=1')?.q ?? 0,
    product: one('SELECT stock_quantity q FROM products WHERE id=1').q,
    lotsAtBranch: one('SELECT COALESCE(SUM(bbs.quantity),0) q FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id=bbs.batch_id WHERE pb.variant_product_id=1 AND bbs.branch_id=1').q,
    lotEverywhere: one('SELECT COALESCE(SUM(quantity),0) q FROM branch_batch_stock WHERE batch_id=?', batchId).q,
    received: one('SELECT received_quantity q FROM product_batches WHERE id=?', batchId).q,
    receivedCost: one('SELECT received_cost_usd q FROM product_batches WHERE id=?', batchId).q,
    lots: one('SELECT COUNT(*) n FROM product_batches WHERE variant_product_id=1').n,
  }
}
function loss(f) {
  return losses.summarizeRemovalLosses(f.sql.prepare(`SELECT ${losses.REMOVAL_LOSS_SELECT} ${losses.REMOVAL_LOSS_FROM} WHERE ${losses.removalLossMovementWhere('m')}`).all())
}
function snapshot(f) {
  return JSON.stringify(['products', 'product_batches', 'branch_stock', 'branch_batch_stock', 'inventory_movements',
    'stock_lot_adjustment_operations', 'action_history'].map((table) => f.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()))
}

// A sale's stock effect as the POS lands it: a 'sale' movement on the lot
// (reference = the sales row) and lot, branch and product decremented together.
function sell(f, batchId, quantity, receipt) {
  const sale = Number(f.sql.prepare("INSERT INTO sales(receipt_number, branch_id, sale_status, total_usd) VALUES(?, 1, 'completed', 0)").run(receipt).lastInsertRowid)
  f.sql.prepare("INSERT INTO sale_items(sale_id, product_id, quantity) VALUES(?, 1, ?)").run(sale, quantity)
  const movement = Number(f.sql.prepare(`INSERT INTO inventory_movements(product_id,product_name,branch_id,branch_name,movement_type,quantity,reference_id,batch_id)
    VALUES(1,'Serum',1,'Shop','sale',?,?,?)`).run(quantity, sale, batchId).lastInsertRowid)
  f.sql.prepare('UPDATE branch_batch_stock SET quantity=quantity-? WHERE batch_id=? AND branch_id=1').run(quantity, batchId)
  f.sql.prepare('UPDATE branch_stock SET quantity=quantity-? WHERE product_id=1 AND branch_id=1').run(quantity)
  f.sql.prepare('UPDATE products SET stock_quantity=stock_quantity-? WHERE id=1').run(quantity)
  return { sale, movement }
}
// A transfer of lot units from Shop to Warehouse (the lot keeps its identity).
function transfer(f, batchId, quantity) {
  const out = Number(f.sql.prepare(`INSERT INTO inventory_movements(product_id,product_name,branch_id,branch_name,movement_type,quantity,reference_id,batch_id)
    VALUES(1,'Serum',1,'Shop','transfer_out',?, 'transfer:t-1', ?)`).run(quantity, batchId).lastInsertRowid)
  f.sql.prepare(`INSERT INTO inventory_movements(product_id,product_name,branch_id,branch_name,movement_type,quantity,reference_id,batch_id)
    VALUES(1,'Serum',2,'Warehouse','transfer_in',?, 'transfer:t-1', ?)`).run(quantity, batchId)
  f.sql.prepare('UPDATE branch_batch_stock SET quantity=quantity-? WHERE batch_id=? AND branch_id=1').run(quantity, batchId)
  f.sql.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,2,?)').run(batchId, quantity)
  f.sql.prepare('UPDATE branch_stock SET quantity=quantity-? WHERE product_id=1 AND branch_id=1').run(quantity)
  f.sql.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,2,?)').run(quantity)
  return out
}

const failures = []
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.error(`FAIL ${name}\n`, error) }
}

async function main() {
  await check('pure: the blocker kind follows the record family, not the movement type alone', () => {
    const kind = blockerLib.stockBlockerKind
    assert.equal(kind({ movement_type: 'sale', reference_kind: 'sale' }), 'sale')
    assert.equal(kind({ movement_type: 'damage_out', reference_kind: 'sale' }), 'sale')
    assert.equal(kind({ movement_type: 'replacement_out', reference_kind: 'return' }), 'return')
    assert.equal(kind({ movement_type: 'transfer_out', reference_kind: null }), 'transfer')
    assert.equal(kind({ movement_type: 'remove', reference_id: 'stock-in-edit:9:op:0' }), 'stock_in_edit')
    assert.equal(kind({ movement_type: 'remove', reference_id: null }), 'stock_change')
  })

  await check('decrease within what is left: lot and received figures corrected, both ledgers agree, NO loss; replay is not applied twice', async () => {
    const f = fresh()
    const { movementId, batchId } = await receive(f, 'blocker-dec-001', 10)
    sell(f, batchId, 4, '20261004-091200')
    const body = { client_request_id: 'blocker-dec-edit-1', quantity: 6, expected_quantity: 10, expected_batch_id: batchId, expected_batch_revision: lineRevision(f, movementId) }
    const res = await edit(f, movementId, body)
    assert.equal(res.status, 200, JSON.stringify(res.json))
    // 10 received, 4 sold, corrected to 6: 2 left, all on the same lot.
    assert.deepEqual(ledgers(f, batchId), { branch: 2, product: 2, lotsAtBranch: 2, lotEverywhere: 2, received: 6, receivedCost: 12, lots: 1 })
    assert.deepEqual(loss(f), { removal_loss_usd: 0, removal_loss_qty: 0, removal_loss_unvalued_rows: 0 }, 'a receipt correction is never a loss')
    // Conservation on the lot: received - standing outflows = what the lot holds.
    assert.equal(ledgers(f, batchId).received - 4, ledgers(f, batchId).lotEverywhere)
    const again = await edit(f, movementId, body)
    assert.equal(again.status, 200); assert.equal(again.json.replayed, true)
    assert.deepEqual(ledgers(f, batchId), { branch: 2, product: 2, lotsAtBranch: 2, lotEverywhere: 2, received: 6, receivedCost: 12, lots: 1 })
  })

  await check('increase adds to the SAME lot (no new received date), received figures follow', async () => {
    const f = fresh()
    const { movementId, batchId } = await receive(f, 'blocker-inc-001', 10)
    const res = await edit(f, movementId, { quantity: 13, expected_quantity: 10, expected_batch_id: batchId })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.deepEqual(ledgers(f, batchId), { branch: 13, product: 13, lotsAtBranch: 13, lotEverywhere: 13, received: 13, receivedCost: 26, lots: 1 })
    assert.equal(sessionLines(f, movementId)[0].batch_id, batchId)
    assert.equal(loss(f).removal_loss_qty, 0)
  })

  await check('lowering below what a sale already used: refused, names the SALE and its receipt, links to its stock record, changes nothing', async () => {
    const f = fresh()
    const { movementId, batchId } = await receive(f, 'blocker-sold-001', 10)
    sell(f, batchId, 2, '20261003-080000')
    const latest = sell(f, batchId, 4, '20261004-091200')
    const before = snapshot(f)
    const refused = await edit(f, movementId, { quantity: 3, expected_quantity: 10, expected_batch_id: batchId })
    assert.equal(refused.status, 409, JSON.stringify(refused.json))
    assert.equal(refused.json.code, 'below_consumed'); assert.equal(refused.json.minimum, 6)
    assert.equal(refused.json.reason, 'consumed')
    assert.equal(refused.json.blocker.kind, 'sale')
    assert.equal(refused.json.blocker.label, '20261004-091200', 'the most recent consumer, by its receipt number')
    assert.equal(refused.json.blocker.movement_id, latest.movement)
    assert.equal(refused.json.blocker.qty, 4)
    assert.equal(refused.json.blocker.count, 2); assert.equal(refused.json.blocker.total_qty, 6)
    assert.equal(refused.json.blocker.branch, 'Shop')
    assert.deepEqual(refused.json.destination, { kind: 'movement', movement_id: latest.movement })
    assert.equal(snapshot(f), before, 'a refusal writes nothing')
  })

  await check('a cancelled sale is never named; the transfer that moved the units is', async () => {
    const f = fresh()
    const { movementId, batchId } = await receive(f, 'blocker-xfer-001', 10)
    const sold = sell(f, batchId, 3, '20261004-100000')
    // Cancelled: the restock put the units back on the same lot.
    f.sql.prepare("UPDATE sales SET sale_status='cancelled' WHERE id=?").run(sold.sale)
    f.sql.prepare(`INSERT INTO inventory_movements(product_id,branch_id,movement_type,quantity,reference_id,batch_id) VALUES(1,1,'return',3,?,?)`).run(sold.sale, batchId)
    f.sql.prepare('UPDATE branch_batch_stock SET quantity=quantity+3 WHERE batch_id=? AND branch_id=1').run(batchId)
    f.sql.prepare('UPDATE branch_stock SET quantity=quantity+3 WHERE product_id=1 AND branch_id=1').run()
    f.sql.prepare('UPDATE products SET stock_quantity=stock_quantity+3 WHERE id=1').run()
    const out = transfer(f, batchId, 7)
    const refused = await edit(f, movementId, { quantity: 1, expected_quantity: 10, expected_batch_id: batchId })
    assert.equal(refused.status, 409); assert.equal(refused.json.code, 'below_consumed'); assert.equal(refused.json.minimum, 7)
    assert.equal(refused.json.blocker.kind, 'transfer')
    assert.equal(refused.json.blocker.movement_id, out)
    assert.equal(refused.json.blocker.count, 1, 'the cancelled sale is not counted')
  })

  await check('ledger Revert of a consumed receipt line: refused with the sale named', async () => {
    const f = fresh()
    const { movementId, batchId } = await receive(f, 'blocker-revert-01', 10)
    const sold = sell(f, batchId, 8, '20261004-120000')
    const before = snapshot(f)
    const refused = await send(f, 'POST', `/api/inventory/movements/${movementId}/revert`, {})
    assert.equal(refused.status, 400, JSON.stringify(refused.json))
    assert.match(refused.json.code, /^revert_insufficient_(lot|branch)_stock$/)
    assert.equal(refused.json.reason, 'consumed')
    assert.equal(refused.json.blocker.kind, 'sale'); assert.equal(refused.json.blocker.label, '20261004-120000')
    assert.deepEqual(refused.json.destination, { kind: 'movement', movement_id: sold.movement })
    assert.deepEqual(refused.json.params, { available: 2, needed: 10, ...(refused.json.code === 'revert_insufficient_branch_stock' ? { branch: 'Shop' } : {}) })
    assert.equal(snapshot(f), before)
  })

  await check('Undo of a line edit after a sale: refused, names the sale; with no blocker the reversal is exact', async () => {
    const f = fresh()
    const { movementId, batchId } = await receive(f, 'blocker-undo-001', 10)
    const res = await edit(f, movementId, { quantity: 12, expected_quantity: 10, expected_batch_id: batchId })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    const history = f.sql.prepare('SELECT history_id id FROM stock_lot_adjustment_operations WHERE id=?').get(res.json.operation_id).id
    // REVERT-SET: the undo takes back exactly the +2, so only a sale that took
    // those units refuses it (12 - 11 = 1 left, 2 needed).
    const sold = sell(f, batchId, 11, '20261004-130000')
    const before = snapshot(f)
    const refused = await send(f, 'POST', `/api/action-history/${history}/undo`, { expected_generation: 0, require_applied: true })
    assert.equal(refused.status, 409, JSON.stringify(refused.json))
    assert.equal(refused.json.reason, 'consumed')
    assert.deepEqual([refused.json.code, refused.json.params], ['revert_insufficient_lot_stock', { available: 1, needed: 2 }])
    assert.equal(refused.json.blocker.kind, 'sale'); assert.equal(refused.json.blocker.movement_id, sold.movement)
    assert.deepEqual(refused.json.destination, { kind: 'movement', movement_id: sold.movement })
    // History records the attempt's error; stock and lots are untouched.
    const stockOnly = (s) => JSON.parse(s).filter((_, i) => i !== 6)
    assert.deepEqual(stockOnly(snapshot(f)), stockOnly(before))
    // Reversal path still exact once the sale is out of the way (cancelled + restocked).
    f.sql.prepare('UPDATE branch_batch_stock SET quantity=quantity+11 WHERE batch_id=? AND branch_id=1').run(batchId)
    f.sql.prepare('UPDATE branch_stock SET quantity=quantity+11 WHERE product_id=1 AND branch_id=1').run()
    f.sql.prepare('UPDATE products SET stock_quantity=stock_quantity+11 WHERE id=1').run()
    const undone = await send(f, 'POST', `/api/action-history/${history}/undo`, { expected_generation: 0, require_applied: true })
    assert.equal(undone.status, 200, JSON.stringify(undone.json))
    assert.deepEqual(ledgers(f, batchId), { branch: 10, product: 10, lotsAtBranch: 10, lotEverywhere: 10, received: 10, receivedCost: 20, lots: 1 })
    const twice = await send(f, 'POST', `/api/action-history/${history}/undo`, { expected_generation: 0, require_applied: true })
    assert.equal(twice.status, 200, 'a repeated undo of the same generation is a no-op')
    assert.deepEqual(ledgers(f, batchId), { branch: 10, product: 10, lotsAtBranch: 10, lotEverywhere: 10, received: 10, receivedCost: 20, lots: 1 })
  })

  await check('Undo of a stock-in session after a sale: refused, names the sale; nothing reversed', async () => {
    const f = fresh()
    const { historyId, batchId } = await receive(f, 'blocker-sess-001', 10)
    const sold = sell(f, batchId, 2, '20261004-140000')
    // Discriminating precondition: the sale's id EQUALS the session's rowid
    // (separate sequences collide), so a blocker search that treated "the
    // session's own rows" as reference_id = rowid would skip this sale.
    assert.equal(sold.sale, f.sql.prepare('SELECT rowid FROM stock_session_operations').get().rowid)
    const ledger = ledgers(f, batchId)
    const refused = await send(f, 'POST', `/api/action-history/${historyId}/undo`, { expected_generation: 0, require_applied: true })
    assert.equal(refused.status, 409, JSON.stringify(refused.json))
    assert.equal(refused.json.code, 'stock_session_rejected')
    assert.equal(refused.json.blocker.kind, 'sale'); assert.equal(refused.json.blocker.label, '20261004-140000')
    assert.deepEqual(refused.json.destination, { kind: 'movement', movement_id: sold.movement })
    assert.deepEqual(ledgers(f, batchId), ledger)
  })

  await check('Undo of a stock session Set after a sale: refused, names the sale', async () => {
    const f = fresh()
    const { batchId } = await receive(f, 'blocker-set-0001', 10)
    // REVERT-SET: a Set's Undo inverts its recorded delta, so it is refused
    // only when a later sale took units the inverse needs. Set 10 -> 12 (+2),
    // sell 11 -> 1 left: the Undo needs -2 and only 1 is there.
    const set = await send(f, 'POST', '/api/inventory/adjust', { type: 'set', setScope: 'lot', productId: 1, branchId: 1, batchId, quantity: 12, reason: 'Physical count', client_request_id: 'blocker-set-req-1' })
    assert.equal(set.status, 200, JSON.stringify(set.json))
    const sold = sell(f, batchId, 11, '20261004-150000')
    const ledger = ledgers(f, batchId)
    const refused = await send(f, 'POST', `/api/action-history/${set.json.action_history_id}/undo`, { expected_generation: 0, require_applied: true })
    assert.equal(refused.status, 409, JSON.stringify(refused.json))
    assert.equal(refused.json.reason, 'consumed')
    assert.equal(refused.json.blocker.kind, 'sale'); assert.equal(refused.json.blocker.label, '20261004-150000')
    assert.deepEqual(refused.json.destination, { kind: 'movement', movement_id: sold.movement })
    assert.deepEqual(ledgers(f, batchId), ledger)
  })

  await check('Undo of a lowering Set after a sale: the delta comes back, the sale stays (10 -> 6, sell 2, undo -> 8)', async () => {
    const f = fresh()
    const { batchId } = await receive(f, 'blocker-set-0003', 10)
    const set = await send(f, 'POST', '/api/inventory/adjust', { type: 'set', setScope: 'lot', productId: 1, branchId: 1, batchId, quantity: 6, reason: 'Physical count', client_request_id: 'blocker-set-req-3' })
    assert.equal(set.status, 200, JSON.stringify(set.json))
    sell(f, batchId, 2, '20261004-151000')
    const undone = await send(f, 'POST', `/api/action-history/${set.json.action_history_id}/undo`, { expected_generation: 0, require_applied: true })
    assert.equal(undone.status, 200, JSON.stringify(undone.json))
    const after = ledgers(f, batchId)
    assert.deepEqual([after.branch, after.product, after.lotsAtBranch, after.lotEverywhere], [8, 8, 8, 8], JSON.stringify(after))
  })

  await check('a refusal with no foreign movement names nothing -- never the action\'s own Revert row', async () => {
    const f = fresh()
    const { batchId } = await receive(f, 'blocker-set-0002', 10)
    const set = await send(f, 'POST', '/api/inventory/adjust', { type: 'set', setScope: 'lot', productId: 1, branchId: 1, batchId, quantity: 6, reason: 'Physical count', client_request_id: 'blocker-set-req-2' })
    assert.equal(set.status, 200, JSON.stringify(set.json))
    const undone = await send(f, 'POST', `/api/action-history/${set.json.action_history_id}/undo`, { expected_generation: 0, require_applied: true })
    assert.equal(undone.status, 200, JSON.stringify(undone.json))
    // Drift with no movement, deep enough that the redo's -4 cannot apply
    // (REVERT-SET: replay is by delta, so a 1-unit drift no longer refuses).
    f.sql.prepare('UPDATE branch_batch_stock SET quantity=quantity-7 WHERE batch_id=? AND branch_id=1').run(batchId)
    f.sql.prepare('UPDATE branch_stock SET quantity=quantity-7 WHERE product_id=1 AND branch_id=1').run()
    f.sql.prepare('UPDATE products SET stock_quantity=stock_quantity-7 WHERE id=1').run()
    const refused = await send(f, 'POST', `/api/action-history/${set.json.action_history_id}/redo`, { expected_generation: 1, require_applied: true })
    assert.equal(refused.status, 409, JSON.stringify(refused.json))
    assert.equal(refused.json.blocker, undefined, 'the undo\'s own revert:<id> row is not a blocker')
    assert.deepEqual([refused.json.code, refused.json.params], ['revert_insufficient_lot_stock', { available: 3, needed: 4 }])
  })

  if (failures.length) { console.error(`\n${failures.length} check(s) failed: ${failures.join('; ')}`); process.exit(1) }
  console.log('\nAll stock refusal blocker checks passed.')
}

main().catch((error) => { console.error(error); process.exit(1) })
