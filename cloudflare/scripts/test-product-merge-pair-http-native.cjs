const assert = require('node:assert/strict')
const h = require('./test-counted-quantity-exact-native.cjs')
const { load } = require('./test-product-merge-origin-plan-native.cjs')
const { productMergeProtocolSchemaSql } = load('lib/productMergeProtocol.ts')
const endpoint = '/products/possible-duplicates/merge'
const command = { keepId: 1, mergeId: 2, stock: 'merge', client_request_id: 'pair-original-command' }
const tables = ['products', 'product_batches', 'branch_stock', 'branch_batch_stock', 'damaged_stock_lots', 'product_cost_entries',
  'inventory_movements', 'action_history', 'undo_snapshots', 'audit_logs', 'sqlite_sequence']
const state = f => Object.fromEntries(tables.map(table => [table, f.sql.prepare(`SELECT * FROM ${table}`).all()]))
async function world(worker, tier, receipt, tagged) {
  const f = await h.world(worker, tier, 'zero', sql => {
    h.seed(.1, receipt)(sql)
    sql.exec(`UPDATE products SET name='Pair twin',barcode='PAIR-1' WHERE id=1;
      INSERT INTO products(id,name,barcode,is_active,stock_quantity,cost_price_usd,cost_price_khr)
        VALUES(2,'Pair twin','PAIR-1',1,.2,2,8000);
      INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,.2);
      INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,unit_cost_usd,is_active,received_quantity,received_cost_usd)
        VALUES(2,2,'pair-original','2026-10-09',2,1,3,6);
      INSERT INTO inventory_movements(id,product_id,product_name,branch_id,batch_id,movement_type,quantity,reason)
        VALUES(99,2,'Historical original',1,${receipt ? 2 : 'NULL'},'add',.2,'Original receipt');`)
    if (receipt) sql.exec('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(2,1,.2)')
    if (tagged) sql.exec(`INSERT INTO damaged_stock_lots(id,product_id,product_name,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source)
      VALUES(1,2,'Historical original',1,${receipt ? 2 : 'NULL'},3,0,'damaged','return')`)
  })
  if (tagged) await h.loadStockSession('lib/stockTransaction.ts').executeStockTransaction(
    h.loadStockSession('lib/db.ts').getDb(f.env), [{ sql: 'UPDATE damaged_stock_lots SET quantity_remaining=.1 WHERE id=1' }], 'once')
  f.sql.exec(productMergeProtocolSchemaSql())
  return f
}
function intercept(f, run) {
  const db = f.env.DB
  let dispatches = 0
  f.env.DB = new Proxy(db, { get(target, key) {
    if (key === 'batch') return async rows => {
      const merge = rows.some(row => /INSERT INTO undo_snapshots\(id,kind,status,payload_json/.test(row.text))
      if (merge) { dispatches++; await run?.(rows, 'before') }
      const result = await target.batch(rows)
      if (merge) await run?.(rows, 'after')
      return result
    }
    return target[key]
  } })
  return () => dispatches
}
async function positive(worker, tier, receipt, tagged, lostAck) {
  const f = await world(worker, tier, receipt, tagged)
  try {
    const before = state(f), batches = intercept(f, (rows, phase) => { if (lostAck && phase === 'after') throw new Error('network acknowledgement lost') })
    const result = await f.call(endpoint, command)
    assert.equal(result.status, 200, JSON.stringify(result.json))
    assert.equal(result.json.quantityMoved, .2)
    assert.equal(result.json.keptId, 1); assert.equal(result.json.mergedId, 2)
    assert.equal(f.sql.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity, .3)
    assert.equal(f.sql.prepare('SELECT is_active FROM products WHERE id=2').get().is_active, 0)
    assert.deepEqual(f.sql.prepare('SELECT * FROM product_batches WHERE id=2').get(), before.product_batches.find(row => row.id === 2))
    assert.deepEqual(f.sql.prepare('SELECT * FROM inventory_movements WHERE id=99').get(), before.inventory_movements[0])
    assert.equal(f.sql.prepare('SELECT received_quantity FROM product_batches WHERE id=3').get().received_quantity, 0)
    if (receipt) {
      assert.equal(f.sql.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=2').get().quantity, 0)
      assert.equal(f.sql.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=3').get().quantity, .2)
    }
    if (tagged) {
      assert.equal(f.sql.prepare('SELECT quantity_remaining FROM damaged_stock_lots WHERE id=1').get().quantity_remaining, 0)
      assert.deepEqual(f.sql.prepare('SELECT product_id,batch_id,quantity,quantity_remaining FROM damaged_stock_lots WHERE id=2').get(),
        { product_id: 1, batch_id: receipt ? 3 : null, quantity: 3, quantity_remaining: .1 })
    }
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='merge_duplicate'").get().n, 1)
    const after = state(f), retry = await f.call(endpoint, command)
    assert.equal(retry.status, 200); assert.equal(retry.json.replayed, true)
    assert.equal(retry.json.operationId, result.json.operationId)
    assert.deepEqual(state(f), after); assert.equal(batches(), 1)
    const mismatch = await f.call(endpoint, { ...command, stock: null })
    assert.equal(mismatch.status, 409); assert.equal(mismatch.json.code, 'merge_request_conflict')
    assert.deepEqual(state(f), after)
    console.log(`PASS HTTP immutable pair ${tier} receipt=${receipt} tagged=${tagged} lostACK=${lostAck}, retry before inactive lookup`)
  } finally { f.sql.close() }
}
async function mergedSupplierReturn(worker, tier, receipt, tagged) {
  const f = await world(worker, tier, receipt, tagged)
  try {
    f.sql.exec(load('lib/returnBulkAction.ts').returnMergePhysicalProofSchemaSql())
    const created = await f.call('/returns/supplier', {
      branch_id: 1, reason: 'Original pair source', settlement: 'refund', supplier_name: 'Fixture supplier',
      exchange_rate: 4000, client_request_id: 'pair-supplier-create',
      items: [{ product_id: 2, branch_id: 1, quantity: .1, cost_price_usd: 2,
        stock_condition: tagged ? 'damaged' : 'ordinary', ...(tagged ? { damaged_lot_id: 1 } : {}) }],
    })
    assert.equal(created.status, 200, JSON.stringify(created.json))
    const original = () => ({
      items: f.sql.prepare('SELECT * FROM return_items ORDER BY id').all(),
      receipts: f.sql.prepare('SELECT * FROM return_create_receipts ORDER BY return_id').all(),
      allocations: f.sql.prepare('SELECT * FROM return_item_batch_allocations ORDER BY id').all(),
      receipt: f.sql.prepare('SELECT * FROM product_batches WHERE id=2').get(),
      movement: f.sql.prepare('SELECT * FROM inventory_movements WHERE id=99').get(),
    })
    const before = original()
    const merged = await f.call(endpoint, command)
    assert.equal(merged.status, 200, JSON.stringify(merged.json))
    assert.deepEqual(original(), before)
    const quantity = () => f.sql.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity
    assert.equal(quantity(), .2)
    const body = { client_request_id: 'pair-supplier-cancel', field: 'status', source: 'completed', target: 'cancelled',
      items: f.sql.prepare('SELECT id,status expected_status,supplier_settlement expected_method,updated_at expected_updated_at FROM returns WHERE id=?').all(created.json.id) }
    const cancelled = await f.call('/returns/bulk', body)
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.json))
    assert.equal(quantity(), .3)
    const afterCancel = state(f)
    assert.equal((await f.call('/returns/bulk', body)).status, 200)
    assert.deepEqual(state(f), afterCancel)
    const undo = await f.call(`/action-history/${cancelled.json.actionHistoryId}/undo`, { expected_generation: 0 })
    assert.equal(undo.status, 200, JSON.stringify(undo.json)); assert.equal(quantity(), .2)
    const redo = await f.call(`/action-history/${cancelled.json.actionHistoryId}/redo`, { expected_generation: 1 })
    assert.equal(redo.status, 200, JSON.stringify(redo.json)); assert.equal(quantity(), .3)
    assert.deepEqual(original(), before)
    assert.equal(f.sql.prepare('SELECT stock_quantity FROM products WHERE id=2').get().stock_quantity, 0)
    if (tagged) assert.deepEqual(f.sql.prepare('SELECT product_id,quantity_remaining FROM damaged_stock_lots ORDER BY id').all(),
      [{ product_id: 2, quantity_remaining: 0 }, { product_id: 1, quantity_remaining: .1 }])
    const proofs = f.sql.prepare("SELECT payload_json FROM undo_snapshots WHERE kind='return.fields.bulk.physical.v1' ORDER BY id").all().map(row => JSON.parse(row.payload_json))
    assert.deepEqual(proofs.map(proof => [proof.generation, proof.sources[0].original.productId, proof.sources[0].effect.productId]),
      [[0, 2, 1], [1, 2, 1], [2, 2, 1]])
    console.log(`PASS real pair HTTP then supplier cancel/retry/Undo/Redo ${tier} receipt=${receipt} tagged=${tagged}`)
  } finally { f.sql.close() }
}
async function mergedCustomerReturn(worker, tier, receipt, tagged) {
  const f = await world(worker, tier, receipt, tagged)
  try {
    f.sql.exec(load('lib/returnBulkAction.ts').returnMergePhysicalProofSchemaSql())
    const db = load('lib/db.ts').getDb(f.env)
    await load('lib/stockTransaction.ts').executeStockTransaction(db, [
      { sql: "INSERT INTO returns(id,return_number,return_scope,status,return_type,branch_id,updated_at) VALUES(10,'PAIR-CUSTOMER','customer','completed','refund',1,'original')" },
      ...(tagged ? [{ sql: 'UPDATE damaged_stock_lots SET return_id=10,quantity=.1,unit_cost_usd=2 WHERE id=1' }] : []),
      { sql: `INSERT INTO return_items(id,return_id,product_id,product_name,quantity,cost_price_usd,stock_action,stock_condition,return_to_stock,branch_id,batch_id)
        VALUES(10,10,2,'Historical original',.1,2,@action,@condition,1,1,@batch)`,
        params: { action: tagged ? 'damaged' : 'restock', condition: tagged ? 'damaged' : 'ordinary', batch: receipt ? 2 : null } },
      { sql: `INSERT INTO inventory_movements(product_id,product_name,branch_id,movement_type,quantity,unit_cost_usd,reference_id,user_id,batch_id)
        VALUES(2,'Historical original',1,@movement,.1,2,10,7,@batch)`, params: { movement: tagged ? 'damage_in' : 'return', batch: receipt ? 2 : null } },
    ], 'once')
    const original = () => ({
      items: f.sql.prepare('SELECT * FROM return_items ORDER BY id').all(),
      allocations: f.sql.prepare('SELECT * FROM return_item_batch_allocations ORDER BY id').all(),
      receipt: f.sql.prepare('SELECT * FROM product_batches WHERE id=2').get(),
      movement: f.sql.prepare('SELECT * FROM inventory_movements WHERE id=99').get(),
    })
    const archive = original()
    const merged = await f.call(endpoint, command)
    assert.equal(merged.status, 200, JSON.stringify(merged.json))
    assert.equal(merged.json.quantityMoved, .2)
    const quantity = () => f.sql.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity
    const body = (key, source = 'completed', target = 'cancelled') => ({ client_request_id: key, field: 'status', source, target,
      items: f.sql.prepare('SELECT id,status expected_status,return_type expected_method,updated_at expected_updated_at FROM returns WHERE id=10').all() })
    const cancel = body('pair-customer-cancel')
    const cancelled = await f.call('/returns/bulk', cancel)
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.json)); assert.equal(quantity(), .2)
    const afterCancel = state(f)
    assert.equal((await f.call('/returns/bulk', cancel)).status, 200)
    assert.deepEqual(state(f), afterCancel)
    const undo = await f.call(`/action-history/${cancelled.json.actionHistoryId}/undo`, { expected_generation: 0 })
    assert.equal(undo.status, 200, JSON.stringify(undo.json)); assert.equal(quantity(), .3)
    const redo = await f.call(`/action-history/${cancelled.json.actionHistoryId}/redo`, { expected_generation: 1 })
    assert.equal(redo.status, 200, JSON.stringify(redo.json)); assert.equal(quantity(), .2)
    const restored = await f.call('/returns/bulk', body('pair-customer-restore', 'cancelled', 'completed'))
    assert.equal(restored.status, 200, JSON.stringify(restored.json)); assert.equal(quantity(), .3)
    assert.deepEqual(original(), archive)
    assert.equal(f.sql.prepare('SELECT stock_quantity FROM products WHERE id=2').get().stock_quantity, 0)
    if (tagged) assert.deepEqual(f.sql.prepare('SELECT product_id,quantity_remaining FROM damaged_stock_lots ORDER BY id').all(),
      [{ product_id: 2, quantity_remaining: 0 }, { product_id: 1, quantity_remaining: .1 }])
    const proofs = f.sql.prepare("SELECT payload_json FROM undo_snapshots WHERE kind='return.fields.bulk.physical.v1' ORDER BY id").all().map(row => JSON.parse(row.payload_json))
    assert.deepEqual(proofs.map(proof => [proof.generation, proof.sources[0].original.productId, proof.sources[0].effect.productId]),
      [[0, 2, 1], [1, 2, 1], [2, 2, 1], [0, 2, 1]])
    console.log(`PASS real pair HTTP then customer cancel/retry/Undo/Redo/restore ${tier} receipt=${receipt} tagged=${tagged}`)
  } finally { f.sql.close() }
}
async function main() {
  const worker = await h.bundle.exports.bundleWorker()
  for (const tier of ['free', 'paid']) for (const receipt of [false, true]) for (const tagged of [false, true]) await positive(worker, tier, receipt, tagged, tagged)
  for (const fault of ['missing-key', 'missing-choice', 'identity', 'session', 'actor', 'catalog', 'late-audit']) {
    const f = await world(worker, 'free', true, true)
    try {
      if (fault === 'identity') f.sql.exec("UPDATE products SET name='Different product' WHERE id=2")
      let rival
      const batches = intercept(f, (rows, phase) => {
        if (phase !== 'before') return
        if (fault === 'session') f.sql.exec("UPDATE user_sessions SET revoked_at=CURRENT_TIMESTAMP")
        if (fault === 'actor') f.sql.exec("UPDATE users SET permissions='{}' WHERE id=7")
        if (fault === 'catalog') f.competeBeforeCommit([{ sql: "UPDATE products SET brand='Concurrent brand' WHERE id=1" }])
        if (fault === 'late-audit') f.sql.exec("CREATE TRIGGER fail_pair_audit BEFORE INSERT ON audit_logs WHEN NEW.action='merge_duplicate' BEGIN SELECT RAISE(ABORT,'merge_late_audit_failure'); END")
        rival = state(f)
      })
      const before = state(f)
      const result = await f.call(endpoint, { ...command, ...(fault === 'missing-key' ? { client_request_id: '' } : {}), ...(fault === 'missing-choice' ? { stock: null } : {}) })
      assert.equal(result.status, ['missing-key', 'missing-choice'].includes(fault) ? 400 : ['session', 'actor'].includes(fault) ? 403 : 409, JSON.stringify(result.json))
      if (fault === 'catalog') {
        const expected = structuredClone(rival); expected.products.find(row => row.id === 1).brand = 'Concurrent brand'
        assert.deepEqual(state(f), expected)
      } else assert.deepEqual(state(f), rival ?? before)
      assert.equal(batches(), ['missing-key', 'missing-choice', 'identity'].includes(fault) ? 0 : 1)
      console.log('PASS actual HTTP refusal/rollback: ' + fault)
    } finally { f.sql.close() }
  }
  for (const tier of ['free', 'paid']) for (const mode of ['empty', 'condition', 'nonadmin', 'image-denied', 'image-retry']) {
    const f = await world(worker, tier, true, false)
    try {
      const db = h.loadStockSession('lib/db.ts').getDb(f.env)
      const write = rows => h.loadStockSession('lib/stockTransaction.ts').executeStockTransaction(db, rows, 'once')
      if (mode === 'empty') await write([
        { sql: 'UPDATE branch_batch_stock SET quantity=0' }, { sql: 'UPDATE branch_stock SET quantity=0' }, { sql: 'UPDATE products SET stock_quantity=0' },
      ])
      if (mode === 'condition') await write([{ sql: "INSERT INTO damaged_stock_lots(id,product_id,product_name,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source) VALUES(1,2,'Original',1,2,1,.1,'unsupported','return')" }])
      if (mode.startsWith('image')) f.sql.exec("UPDATE products SET image_path='original-image' WHERE id=2; INSERT INTO product_images(id,product_id,image_path) VALUES(1,2,'original-image')")
      if (mode === 'nonadmin' || mode === 'image-denied') f.sql.prepare('UPDATE users SET role_id=NULL,permissions=? WHERE id=7').run(JSON.stringify({ products: true, ...(mode === 'image-denied' ? { 'products:image': false } : {}) }))
      const before = state(f), batches = intercept(f)
      const body = { ...command, ...(mode === 'empty' ? { stock: null } : {}) }
      const first = await f.call(endpoint, body)
      if (['condition', 'image-denied'].includes(mode)) {
        assert.equal(first.status, mode === 'condition' ? 409 : 403, JSON.stringify(first.json))
        assert.equal(first.json.code, mode === 'condition' ? 'merge_state_conflict' : 'image_permission_required')
        assert.deepEqual(state(f), before); assert.equal(batches(), 0)
      } else {
        assert.equal(first.status, 200, JSON.stringify(first.json))
        assert.equal(first.json.committed, true); assert.equal(first.json.historyResolved, true)
        assert.equal(first.json.undoReady, false, 'do not advertise v2 replay before its implementation')
        assert.equal(first.json.quantityMoved, mode === 'empty' ? 0 : .2)
        const after = state(f)
        if (mode === 'image-retry') f.sql.prepare('UPDATE users SET role_id=NULL,permissions=? WHERE id=7').run(JSON.stringify({ products: true, 'products:image': false }))
        const retry = await f.call(endpoint, body)
        assert.equal(retry.status, mode === 'image-retry' ? 403 : 200, JSON.stringify(retry.json))
        assert.deepEqual(state(f), after); assert.equal(batches(), 1)
      }
      console.log('PASS actual HTTP acceptance ' + tier + ': ' + mode)
    } finally { f.sql.close() }
  }
  for (const tier of ['free', 'paid']) for (const receipt of [false, true]) for (const tagged of [false, true]) await mergedSupplierReturn(worker, tier, receipt, tagged)
  for (const tier of ['free', 'paid']) for (const receipt of [false, true]) for (const tagged of [false, true]) await mergedCustomerReturn(worker, tier, receipt, tagged)
  console.log('BOUNDED ORDINARY PAIR AND SUPPLIER/CUSTOMER BULK CONSUMER HTTP; reviewed/identity/group/merge replay/create/edit/reset/schema rollout remain open')
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { world, main, mergedCustomerReturn }
