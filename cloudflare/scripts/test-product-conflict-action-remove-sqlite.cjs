const assert = require('node:assert/strict')
const { loadRoute, seed } = require('./test-product-conflict-action-groups-sqlite.cjs')

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

async function main() {
  {
    const fixture = setup()
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
    assert.ok(fixture.controls.statements <= 80)
    assert.ok(fixture.controls.maxBindings <= 100)
    assert.ok(fixture.controls.maxCompoundTerms <= 5)
    assert.ok(fixture.controls.maxBatchStatements <= 100)
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
