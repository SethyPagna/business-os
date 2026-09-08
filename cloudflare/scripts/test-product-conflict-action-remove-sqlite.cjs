const assert = require('node:assert/strict')
const { loadRoute, loadTs, seed } = require('./test-product-conflict-action-groups-sqlite.cjs')

function reset(controls) {
  Object.assign(controls, { statements: 0, maxBindings: 0, maxCompoundTerms: 0, maxBatchStatements: 0,
    writeBatches: 0, beforeNextWriteBatch: null, beforeWriteBatch: null })
}

async function remove(app, productId, body, user = { id: 900, username: 'owner' }) {
  return app.deletes.get('/:id')({
    env: {}, get: () => user,
    req: { param: () => String(productId), json: async () => body },
    json: (payload, status = 200) => ({ status, body: payload }),
    executionCtx: { waitUntil: () => {} },
  })
}

function setup() {
  const { d1 } = seed(1)
  d1.db.prepare(`INSERT INTO users(id,username,name,password,permissions,is_active)
    VALUES(902,'requester','Requester','x','{}',1),(903,'reviewer','Reviewer','x','{}',1)`).run()
  d1.db.prepare('UPDATE products SET rfid_confirmed_qty=1 WHERE id=10000').run()
  d1.db.prepare('UPDATE branch_stock SET rfid_confirmed_qty=1 WHERE product_id=10000 AND branch_id=1').run()
  d1.db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity,rfid_confirmed_qty) VALUES(10000,2,0,0)').run()
  d1.db.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,is_active,notes,supplier_id,supplier_name)
    VALUES(99004,10000,'old-inactive','2026-08-01',0,'preserve inactive',55,'Old Supplier')`).run()
  d1.db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(99004,1,0)').run()
  const loaded = loadRoute(d1, true)
  reset(loaded.controls)
  return { d1, ...loaded }
}

function loadReviewApply(fixture) {
  return loadTs('lib/reviewApply.ts', {
    './db': { getDb: () => fixture.db }, './audit': { audit: async () => {} },
    '../durable-objects/broadcastHub': { broadcast: async () => {} }, './cache': { bumpVersion: async () => {} },
    './productWrites': {}, './branchWrites': {}, './canonicalBranchIdentity': {}, './permissions': fixture.permissions,
    './productImagePermission': {}, './auth': {}, './pendingActions': {}, '../index': {}, './productDelete': fixture.productDelete,
  })
}

function productGraph(d1) {
  return {
    product: { ...d1.db.prepare('SELECT * FROM products WHERE id=10000').get() },
    stock: d1.db.prepare('SELECT * FROM branch_stock WHERE product_id=10000 ORDER BY id').all().map((row) => ({ ...row })),
    batches: d1.db.prepare('SELECT * FROM product_batches WHERE variant_product_id=10000 ORDER BY id').all().map((row) => ({ ...row })),
    batchStock: d1.db.prepare(`SELECT bbs.* FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id=bbs.batch_id
      WHERE pb.variant_product_id=10000 ORDER BY bbs.id`).all().map((row) => ({ ...row })),
  }
}

async function main() {
  {
    const fixture = setup()
    const sourceGraph = productGraph(fixture.d1)
    const body = { reason: 'Independent duplicate', expectedUpdatedAt: '2026-09-08 01:00:00', client_request_id: 'direct_remove_10000' }
    const first = await remove(fixture.app, 10000, body)
    assert.equal(first.status, 200, JSON.stringify(first.body))
    assert.equal(first.body.status, 'undo_ready')
    assert.ok(first.body.action_history_id > 0)
    assert.deepEqual({ ...fixture.d1.db.prepare('SELECT is_active,stock_quantity,rfid_confirmed_qty FROM products WHERE id=10000').get() },
      { is_active: 0, stock_quantity: 0, rfid_confirmed_qty: 0 })
    assert.deepEqual(fixture.d1.db.prepare('SELECT branch_id,quantity,rfid_confirmed_qty FROM branch_stock WHERE product_id=10000 ORDER BY branch_id').all().map((row) => ({ ...row })), [
      { branch_id: 1, quantity: 0, rfid_confirmed_qty: 0 }, { branch_id: 2, quantity: 0, rfid_confirmed_qty: 0 },
    ])
    assert.deepEqual(fixture.d1.db.prepare('SELECT id,is_active,supplier_name FROM product_batches WHERE variant_product_id=10000 ORDER BY id').all().map((row) => ({ ...row })), [
      { id: 99001, is_active: 0, supplier_name: 'Supplier A' }, { id: 99004, is_active: 0, supplier_name: 'Old Supplier' },
    ])
    assert.deepEqual(fixture.d1.db.prepare("SELECT movement_type,quantity,batch_id FROM inventory_movements WHERE product_id=10000 AND movement_type='write_off'").all().map((row) => ({ ...row })), [
      { movement_type: 'write_off', quantity: 2, batch_id: null },
    ])
    assert.equal(fixture.d1.db.prepare("SELECT COUNT(*) n FROM action_history WHERE json_extract(undo_payload,'$.applier')='product.remove'").get().n, 1)
    assert.equal(fixture.d1.db.prepare("SELECT COUNT(*) n FROM undo_snapshots WHERE kind='product.remove'").get().n, 1)
    assert.equal(fixture.d1.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='delete' AND entity='product'").get().n, 1)
    const beforeReplay = {
      movement: fixture.d1.db.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n,
      history: fixture.d1.db.prepare('SELECT COUNT(*) n FROM action_history').get().n,
      audit: fixture.d1.db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n,
    }
    const replay = await remove(fixture.app, 10000, body)
    assert.equal(replay.status, 200)
    assert.equal(replay.body.replayed, true)
    assert.deepEqual({
      movement: fixture.d1.db.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n,
      history: fixture.d1.db.prepare('SELECT COUNT(*) n FROM action_history').get().n,
      audit: fixture.d1.db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n,
    }, beforeReplay)
    const conflict = await remove(fixture.app, 10000, { ...body, reason: 'Changed intent' })
    assert.equal(conflict.status, 409); assert.equal(conflict.body.code, 'idempotency_conflict')
    const history = fixture.d1.db.prepare("SELECT id,undo_payload FROM action_history WHERE json_extract(undo_payload,'$.applier')='product.remove'").get()
    const undoPayload = JSON.parse(history.undo_payload)
    const applier = fixture.undo.resolveUndoApplier(undoPayload)
    const undone = await applier.run(undoPayload, { env: {}, user: { id: 900, username: 'owner' }, direction: 'undo', historyId: history.id, generation: 0 })
    assert.equal(undone.complete, true)
    assert.deepEqual(productGraph(fixture.d1), sourceGraph, 'Undo restores the same product, stock and receipt ids with every saved value')
    assert.deepEqual({ ...fixture.d1.db.prepare('SELECT status,generation FROM product_remove_operations WHERE operation_id=?').get(first.body.operation_id) },
      { status: 'reversed', generation: 1 })
    const lostUndoResponse = await applier.run(undoPayload, { env: {}, user: { id: 900, username: 'owner' }, direction: 'undo', historyId: history.id, generation: 0 })
    assert.equal(lostUndoResponse.processed_children, 0)
    const redoPayload = JSON.parse(fixture.d1.db.prepare('SELECT redo_payload FROM action_history WHERE id=?').get(history.id).redo_payload)
    const redone = await applier.run(redoPayload, { env: {}, user: { id: 900, username: 'owner' }, direction: 'redo', historyId: history.id, generation: 1 })
    assert.equal(redone.complete, true)
    assert.deepEqual({ ...fixture.d1.db.prepare('SELECT is_active,stock_quantity,rfid_confirmed_qty FROM products WHERE id=10000').get() },
      { is_active: 0, stock_quantity: 0, rfid_confirmed_qty: 0 })
    assert.deepEqual({ ...fixture.d1.db.prepare('SELECT status,generation FROM product_remove_operations WHERE operation_id=?').get(first.body.operation_id) },
      { status: 'undo_ready', generation: 2 })
    assert.ok(fixture.controls.statements <= 80)
    assert.ok(fixture.controls.maxBindings <= 100)
    assert.ok(fixture.controls.maxCompoundTerms <= 5)
    assert.ok(fixture.controls.maxBatchStatements <= 100)
  }

  for (const denial of ['reviewer', 'requester', 'stale']) {
    const fixture = setup()
    const queued = await remove(fixture.app, 10000, { reason: `Approval ${denial}`, client_request_id: `approval_${denial}` },
      { id: 902, username: 'requester', reviewDelete: true })
    assert.equal(queued.status, 202)
    const pending = { ...fixture.d1.db.prepare("SELECT * FROM pending_actions WHERE status='open'").get() }
    const reviewApply = loadReviewApply(fixture)
    const reviewer = { id: 903, username: 'reviewer', name: 'Reviewer', organization_id: null, role_id: null,
      permissions: '{}', is_active: 1, ...(denial === 'reviewer' ? { noDelete: true } : {}) }
    if (denial === 'requester') fixture.d1.db.prepare('UPDATE users SET is_active=0 WHERE id=902').run()
    if (denial === 'stale') fixture.d1.db.prepare("UPDATE product_batches SET supplier_name='Changed after review' WHERE id=99001").run()
    await assert.rejects(
      () => reviewApply.applyApprovedPendingAction({}, pending, { id: 903, name: 'Reviewer' }, reviewer),
      denial === 'stale' ? /changed after review/i : /permission/i,
    )
    assert.equal(fixture.d1.db.prepare('SELECT is_active FROM products WHERE id=10000').get().is_active, 1)
    assert.equal(fixture.d1.db.prepare('SELECT status FROM pending_actions WHERE id=?').get(pending.id).status, 'open')
    assert.equal(fixture.d1.db.prepare('SELECT status FROM product_remove_operations WHERE pending_action_id=?').get(pending.id).status,
      'approval_pending')
    assert.equal(fixture.d1.db.prepare('SELECT COUNT(*) n FROM action_history').get().n, 0)
  }

  {
    const fixture = setup()
    const denied = await remove(fixture.app, 10000, { reason: 'No permission', client_request_id: 'direct_remove_denied' },
      { id: 901, username: 'denied', noDelete: true })
    assert.equal(denied.status, 403)
    assert.equal(fixture.d1.db.prepare('SELECT COUNT(*) n FROM product_remove_operations').get().n, 0)
    const queued = await remove(fixture.app, 10000, { reason: 'Needs review', client_request_id: 'direct_remove_review' },
      { id: 902, username: 'requester', reviewDelete: true })
    assert.equal(queued.status, 202, JSON.stringify(queued.body))
    assert.equal(queued.body.status, 'approval_pending')
    assert.equal(fixture.d1.db.prepare('SELECT is_active FROM products WHERE id=10000').get().is_active, 1)
    assert.equal(fixture.d1.db.prepare("SELECT COUNT(*) n FROM pending_actions WHERE status='open'").get().n, 1)
    assert.equal(fixture.d1.db.prepare("SELECT COUNT(*) n FROM action_history").get().n, 0)
    assert.equal(fixture.d1.db.prepare("SELECT COUNT(*) n FROM audit_logs").get().n, 0)
    const pending = { ...fixture.d1.db.prepare('SELECT * FROM pending_actions WHERE status=\'open\'').get() }
    reset(fixture.controls)
    const reviewApply = loadReviewApply(fixture)
    const reviewer = { id: 903, username: 'reviewer', name: 'Reviewer', organization_id: null, role_id: null,
      permissions: '{}', is_active: 1 }
    const approved = await reviewApply.applyApprovedPendingAction({}, pending, { id: 903, name: 'Reviewer' }, reviewer)
    assert.equal(approved.pendingActionMarkedAtomically, true)
    assert.deepEqual({ ...fixture.d1.db.prepare('SELECT status,reviewed_by FROM pending_actions WHERE id=?').get(pending.id) },
      { status: 'approved', reviewed_by: 903 })
    assert.deepEqual({ ...fixture.d1.db.prepare('SELECT status,generation FROM product_remove_operations WHERE pending_action_id=?').get(pending.id) },
      { status: 'undo_ready', generation: 0 })
    assert.equal(fixture.d1.db.prepare('SELECT is_active FROM products WHERE id=10000').get().is_active, 0)
    assert.equal(fixture.d1.db.prepare('SELECT COUNT(*) n FROM action_history').get().n, 1)
    assert.ok(fixture.controls.maxBatchStatements <= 100)
  }

  {
    const fixture = setup()
    fixture.controls.beforeNextWriteBatch = () => {
      fixture.d1.db.prepare("UPDATE product_batches SET supplier_name='Concurrent supplier' WHERE id=99001").run()
    }
    const stale = await remove(fixture.app, 10000, { reason: 'Race', client_request_id: 'direct_remove_race' })
    assert.equal(stale.status, 409, JSON.stringify(stale.body))
    assert.equal(stale.body.code, 'review_state_conflict')
    assert.equal(fixture.d1.db.prepare('SELECT is_active FROM products WHERE id=10000').get().is_active, 1)
    assert.equal(fixture.d1.db.prepare('SELECT COUNT(*) n FROM product_remove_operations').get().n, 0)
    assert.equal(fixture.d1.db.prepare('SELECT COUNT(*) n FROM action_history').get().n, 0)
    assert.equal(fixture.d1.db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n, 0)
  }

  console.log('product conflict action direct remove sqlite: atomic graph, permission, idempotency, race checks passed')
}

main().catch((error) => { console.error(error); process.exit(1) })
