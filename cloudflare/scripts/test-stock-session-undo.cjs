const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { fixture, loadStockSession, user, receiveRequest } = require('./test-stock-session-atomic.cjs')

function payload(f, receipt) {
  return JSON.parse(f.sql.prepare('SELECT undo_payload FROM action_history WHERE id=?').get(receipt.actionHistoryId).undo_payload)
}
function state(f) {
  return ['products', 'product_batches', 'branch_stock', 'branch_batch_stock', 'product_images', 'inventory_movements',
    'stock_session_operations', 'stock_session_members', 'stock_session_revisions', 'action_history', 'undo_snapshots', 'audit_logs']
    .map(t => [t, f.sql.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()])
}
function createRequest() {
  const request = receiveRequest('mixed-session-001', 3.5)
  request.items.push({ line_id: 'new-line', kind: 'create_receive', quantity: 2.5,
    product: { name: 'New cream', barcode: 'CREAM', cost_price_usd: 1.25 } })
  return request
}

async function main() {
  const api = loadStockSession()
  const replay = (f, receipt, direction, generation, actor = user) =>
    api.replayStockSession(f.env, actor, direction, receipt.actionHistoryId, generation, payload(f, receipt))
  for (const payment of ['paid', 'credit']) {
    const f = fixture()
    f.sql.exec("INSERT INTO suppliers(id,name) VALUES(1,'Supplier A'),(2,'Supplier B'); INSERT INTO branches(id,name,is_active) VALUES(2,'Warehouse',1)")
    // Execute the actual supplier-history AP aggregation, not a test-only
    // balance formula. Inactive lots are intentionally not filtered there.
    const contacts = fs.readFileSync(path.join(__dirname, '../src/routes/contacts.ts'), 'utf8')
    const supplierWhere = contacts.match(/const supplierWhere = `([\s\S]*?)`/)[1]
    const apSql = contacts.match(/const totalsRow = await db\.prepare\(`\s*(SELECT COUNT\(\*\) AS batches,[\s\S]*?WHERE \$\{supplierWhere\})\s*`\)/)[1].replace('${supplierWhere}', supplierWhere)
    const ap = id => f.sql.prepare(apSql).get({ id, name: id === 1 ? 'supplier a' : 'supplier b' })
    const aRequest = receiveRequest('supplier-a-credit', 5)
    Object.assign(aRequest.items[0], { supplier_id: 1, supplier_name: 'Supplier A', unit_cost_usd: 2, payment_status: 'credit', credit_due_date: '2026-09-30', expiry_date: '2027-01-01', notes: 'A purchase' })
    const a = await api.commitStockSession(f.env, user, aRequest)
    const aPostimage = f.sql.prepare('SELECT * FROM product_batches WHERE id=?').get(a.items[0].batchId)
    assert.equal(ap(1).credit_open_usd, 10)
    await replay(f, a, 'undo', 0)
    await replay(f, a, 'redo', 1)
    assert.deepEqual(f.sql.prepare('SELECT * FROM product_batches WHERE id=?').get(a.items[0].batchId), aPostimage, 'redo restores A exactly before reuse')
    await replay(f, a, 'undo', 2)
    const aSaved = f.sql.prepare('SELECT * FROM undo_snapshots WHERE id=?').get(a.snapshotId)
    const bRequest = receiveRequest(`supplier-b-${payment}`, 5)
    Object.assign(bRequest.items[0], { branch_id: 2, supplier_id: 2, supplier_name: 'Supplier B', unit_cost_usd: 3, payment_status: payment,
      credit_due_date: payment === 'credit' ? '2026-10-15' : null })
    const b = await api.commitStockSession(f.env, user, bRequest)
    assert.equal(b.items[0].batchId, a.items[0].batchId, 'durable lot identity is retained')
    assert.equal(ap(1).credit_open_usd, 0, 'A must not own the new B receipt payable')
    assert.equal(ap(1).cost_usd, 0)
    assert.equal(ap(2).cost_usd, 15)
    assert.equal(ap(2).credit_open_usd, payment === 'credit' ? 15 : 0)
    const bPostimage = f.sql.prepare('SELECT * FROM product_batches WHERE id=?').get(b.items[0].batchId)
    assert.deepEqual([bPostimage.supplier_id, bPostimage.supplier_name, bPostimage.unit_cost_usd, bPostimage.payment_status, bPostimage.credit_due_date, bPostimage.received_branch_id, bPostimage.expiry_date, bPostimage.notes],
      [2, 'Supplier B', 3, payment, payment === 'credit' ? '2026-10-15' : null, 2, null, null])
    const bSnapshot = JSON.parse(f.sql.prepare('SELECT payload_json FROM undo_snapshots WHERE id=?').get(b.snapshotId).payload_json)
    assert.equal(bSnapshot.before.batches[0].supplier_id, null)
    assert.equal(bSnapshot.before.batches[0].payment_status, null)
    assert.equal(bSnapshot.after.batches[0].supplier_id, 2)
    assert.equal(bSnapshot.after.batches[0].received_cost_usd, 15)
    assert.deepEqual(f.sql.prepare('SELECT * FROM undo_snapshots WHERE id=?').get(a.snapshotId), aSaved, 'new receipt must not rewrite prior saved replay')
    const beforeReplay = state(f)
    const aRetry = await api.commitStockSession(f.env, user, aRequest)
    assert.deepEqual(aRetry, { ...a, replayed: true })
    assert.deepEqual(state(f), beforeReplay, 'original immutable receipt replay never reapplies stock')
    await assert.rejects(replay(f, a, 'redo', 3), e => e.statusCode === 409)
    assert.deepEqual(state(f), beforeReplay)
    await replay(f, b, 'undo', 0)
    assert.equal(ap(2).credit_open_usd, 0)
    const undoneB = state(f)
    await assert.rejects(replay(f, a, 'redo', 3), e => e.statusCode === 409)
    assert.deepEqual(state(f), undoneB, 'A stays stale even after B returns the lot to neutral state (ABA)')
    await replay(f, b, 'redo', 1)
    assert.deepEqual(f.sql.prepare('SELECT * FROM product_batches WHERE id=?').get(b.items[0].batchId), bPostimage)
    assert.equal(ap(2).credit_open_usd, payment === 'credit' ? 15 : 0)
    assert.equal(f.sql.pragma('foreign_key_check').length, 0)
    console.log(`PASS receive after new-lot undo attributes B ${payment} correctly, AP and snapshots exact, prior redo stale through ABA`)
  }
  {
    const f = fixture()
    const r = await api.commitStockSession(f.env, user, createRequest())
    const app = loadStockSession('routes/actionHistory.ts').default
    const http = (path, method = 'GET', body, actor = user) => {
      const route = actor === user ? app : loadStockSession('routes/actionHistory.ts', actor).default
      return route.request(`http://local/${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }, f.env, { waitUntil(promise) { promise.catch(() => {}) } })
    }
    const detail = await http(`${r.actionHistoryId}/details`)
    assert.equal(detail.status, 200)
    const noCreate = { ...user, permissions: JSON.stringify({ inventory: true, products: false }) }
    const listed = await (await http('', 'GET', null, noCreate)).json()
    assert.equal(listed.items[0].server_replayable, false)
    const saved = state(f)
    assert.equal((await http(`${r.actionHistoryId}/undo`, 'POST', { expected_generation: 0, require_applied: true }, noCreate)).status, 403)
    assert.deepEqual(state(f), saved)
    assert.equal((await http('', 'POST', { entity: 'stock_session', reversible: true, undo_payload: payload(f, r), redo_payload: payload(f, r) })).status, 403)
    assert.equal((await http(`${r.actionHistoryId}`, 'PATCH', { status: 'redoable' })).status, 403)
    assert.equal((await http(`${r.actionHistoryId}/undo`, 'POST', { expected_generation: true, require_applied: true })).status, 400)
    assert.deepEqual(state(f), saved)
    assert.equal((await http(`${r.actionHistoryId}/undo`, 'POST', { expected_generation: 0, require_applied: true })).status, 200)
    const undone = state(f)
    assert.equal((await http(`${r.actionHistoryId}/undo`, 'POST', { expected_generation: 0, require_applied: true })).status, 200)
    assert.deepEqual(state(f), undone)
    assert.equal((await http(`${r.actionHistoryId}/redo`, 'POST', { expected_generation: 1, require_applied: true })).status, 200)
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action IN ('action_undo','action_redo')").get().n, 0, 'generic route must not double-write audit')
    console.log('PASS actual HTTP details/permission union/forgery/status protection/strict generation and idempotent replay')
  }
  {
    const f = fixture()
    const r = await api.commitStockSession(f.env, user, createRequest())
    const initial = f.sql.prepare('SELECT * FROM products ORDER BY id').all()
    const batchAfter = f.sql.prepare('SELECT * FROM product_batches ORDER BY id').all()
    await replay(f, r, 'undo', 0)
    assert.deepEqual(f.sql.prepare('SELECT stock_quantity,is_active FROM products ORDER BY id').all(), [
      { stock_quantity: 0, is_active: 1 }, { stock_quantity: 0, is_active: 0 },
    ])
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM action_history').get().n, 1)
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n, 4)
    const undone = state(f)
    await replay(f, r, 'undo', 0)
    assert.deepEqual(state(f), undone, 'same-generation duplicate is an immutable replay')
    // A fresh module simulates browser/isolate reload; there is no local closure.
    await loadStockSession().replayStockSession(f.env, user, 'redo', r.actionHistoryId, 1, payload(f, r))
    assert.deepEqual(f.sql.prepare('SELECT * FROM products ORDER BY id').all(), initial)
    assert.deepEqual(f.sql.prepare('SELECT * FROM product_batches ORDER BY id').all(), batchAfter)
    assert.equal(f.sql.prepare('SELECT generation FROM stock_session_operations').get().generation, 2)
    assert.equal(f.sql.prepare('SELECT SUM(quantity) n FROM inventory_movements').get().n, 6)
    assert.equal(f.sql.pragma('foreign_key_check').length, 0)
    await replay(f, r, 'undo', 2)
    await replay(f, r, 'redo', 3)
    assert.deepEqual(f.sql.prepare('SELECT * FROM products ORDER BY id').all(), initial)
    console.log('PASS mixed fractional create/receive reload undo/redo, stable IDs, movement costs and repeated cycles')
  }
  {
    const f = fixture()
    f.sql.exec("INSERT INTO suppliers(id,name) VALUES(1,'Baseline supplier')")
    const baselineRequest = receiveRequest('baseline-receipt', 4)
    Object.assign(baselineRequest.items[0], { supplier_id: 1, payment_status: 'credit', credit_due_date: '2026-09-30', notes: 'Pre-existing attribution' })
    await api.commitStockSession(f.env, user, baselineRequest)
    const baseline = f.sql.prepare('SELECT * FROM product_batches').all()
    const r = await api.commitStockSession(f.env, user, receiveRequest('next-receipt-01', 2))
    await replay(f, r, 'undo', 0)
    assert.deepEqual(f.sql.prepare('SELECT * FROM product_batches').all(), baseline)
    assert.equal(f.sql.prepare('SELECT stock_quantity FROM products').get().stock_quantity, 4)
    console.log('PASS existing receipt metadata restored exactly without losing baseline stock')
  }
  for (const [name, mutation] of [
    ['rename', "UPDATE products SET name='Changed' WHERE id=1"],
    ['stock ABA', 'UPDATE branch_stock SET quantity=quantity+1 WHERE product_id=1; UPDATE branch_stock SET quantity=quantity-1 WHERE product_id=1'],
    ['lot metadata ABA', "UPDATE product_batches SET notes='later'; UPDATE product_batches SET notes=NULL"],
    ['original movement edited', 'UPDATE inventory_movements SET quantity=quantity+1 WHERE id=1'],
    ['later sale-like stock consumption', 'UPDATE products SET stock_quantity=stock_quantity-1 WHERE id=1; UPDATE branch_stock SET quantity=quantity-1 WHERE product_id=1'],
  ]) {
    const f = fixture()
    const r = await api.commitStockSession(f.env, user, createRequest())
    f.sql.exec(mutation)
    const before = state(f)
    await assert.rejects(replay(f, r, 'undo', 0), e => e.statusCode === 409)
    assert.deepEqual(state(f), before)
    console.log(`PASS ${name} refuses whole mixed session without history/audit writes`)
  }
  {
    const f = fixture()
    const r = await api.commitStockSession(f.env, user, receiveRequest())
    f.beforeCommit(sql => sql.exec('UPDATE products SET stock_quantity=stock_quantity+1 WHERE id=1; UPDATE products SET stock_quantity=stock_quantity-1 WHERE id=1'))
    await assert.rejects(replay(f, r, 'undo', 0), e => e.statusCode === 409)
    assert.equal(f.sql.prepare('SELECT status FROM action_history').get().status, 'undoable')
    console.log('PASS race after replay reads fails commit guard')
  }
  {
    const f = fixture()
    const r = await api.commitStockSession(f.env, user, createRequest())
    const before = state(f)
    for (const permissions of [{ inventory: 'review', products: true }, { inventory: true, products: false }]) {
      await assert.rejects(replay(f, r, 'undo', 0, { ...user, permissions: JSON.stringify(permissions) }), e => e.statusCode === 403)
      assert.deepEqual(state(f), before)
    }
    for (const generation of [true, '0', -1, 0.5, null, undefined]) await assert.rejects(replay(f, r, 'undo', generation), e => e.statusCode === 400)
    f.loseNextCommitAcknowledgement()
    await replay(f, r, 'undo', 0)
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n, 4)
    f.loseNextCommitAcknowledgement()
    await replay(f, r, 'redo', 1)
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n, 6)
    console.log('PASS permission union, strict generation and undo/redo lost-ack exactly once')
  }
  for (const direction of ['undo', 'redo']) {
    const f = fixture()
    const r = await api.commitStockSession(f.env, user, createRequest())
    if (direction === 'redo') await replay(f, r, 'undo', 0)
    // Determine the plan size on a successful independent fixture, then fail
    // every statement boundary in the real batch. All prior writes roll back.
    const probe = fixture()
    const pr = await api.commitStockSession(probe.env, user, createRequest())
    if (direction === 'redo') await replay(probe, pr, 'undo', 0)
    await replay(probe, pr, direction, direction === 'undo' ? 0 : 1)
    const phases = probe.lastBatchLength()
    for (let i = 0; i < phases; i++) {
      const saved = state(f)
      f.failBatchStatement(i)
      await assert.rejects(replay(f, r, direction, direction === 'undo' ? 0 : 1), /injected replay phase/)
      assert.deepEqual(state(f), saved, `${direction} phase ${i} must be all-or-none`)
    }
    console.log(`PASS ${direction} rollback at every one of ${phases} statement boundaries`)
  }
  {
    const f = fixture()
    const request = receiveRequest('largest-session-1')
    request.items = Array.from({ length: 25 }, (_, i) => ({ line_id: `line-${i}`, kind: 'receive', product_id: 1, quantity: 1 }))
    const r = await api.commitStockSession(f.env, user, request)
    await Promise.all([replay(f, r, 'undo', 0), replay(f, r, 'undo', 0)])
    assert.equal(f.sql.prepare('SELECT stock_quantity FROM products').get().stock_quantity, 0)
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n, 50)
    await replay(f, r, 'redo', 1)
    assert.equal(f.sql.prepare('SELECT stock_quantity FROM products').get().stock_quantity, 25)
    console.log('PASS 25 repeated members undo/redo aggregate exactly; concurrent same-generation applies once')
  }
  {
    const f = fixture()
    const r = await api.commitStockSession(f.env, user, createRequest())
    await replay(f, r, 'undo', 0)
    f.sql.exec("INSERT INTO products(name,barcode,cost_price_usd,cost_price_khr,is_active) VALUES('New cream','CREAM',1.25,0,1)")
    const saved = state(f)
    await assert.rejects(replay(f, r, 'redo', 1), e => e.statusCode === 409)
    assert.deepEqual(state(f), saved)
    console.log('PASS redo cannot reactivate a new product over a later duplicate identity')
  }
  {
    const f = fixture()
    f.sql.exec("DELETE FROM branch_stock; INSERT INTO branches(id,name,is_active) VALUES(2,'Warehouse',1)")
    const r = await api.commitStockSession(f.env, user, createRequest())
    const stocks = f.sql.prepare('SELECT * FROM branch_stock ORDER BY id').all()
    await replay(f, r, 'undo', 0)
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM branch_stock').get().n, 0)
    await replay(f, r, 'redo', 1)
    assert.deepEqual(f.sql.prepare('SELECT * FROM branch_stock ORDER BY id').all(), stocks)
    console.log('PASS absent stock rows and all-branch create seeds restore exact stable IDs')
  }
}

module.exports = { payload, state, createRequest }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
