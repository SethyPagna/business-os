const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { Miniflare } = require('miniflare')
const { loadRoute } = require('./test-product-conflict-action-groups-native.cjs')

const user = { id: 77, username: 'native' }

function migrationStatements(source) {
  const statements = []
  let buffer = []
  let trigger = false
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.replace(/\s+--.*$/, '').trim()
    if (!line || line.startsWith('--')) continue
    if (!buffer.length) trigger = /^CREATE\s+TRIGGER\b/i.test(line)
    buffer.push(line)
    if ((trigger && /^END;$/i.test(line)) || (!trigger && /;$/.test(line))) {
      statements.push(buffer.join(' '))
      buffer = []
      trigger = false
    }
  }
  if (buffer.length) statements.push(buffer.join(' '))
  return statements
}

function reset(controls) {
  Object.assign(controls, { statements: 0, maxBindings: 0, maxCompoundTerms: 0, maxBatchStatements: 0 })
}

function assertBounds(controls, label) {
  assert.ok(controls.statements <= 700, `${label} used ${controls.statements} statements`)
  assert.ok(controls.maxBindings <= 100, `${label} used ${controls.maxBindings} bindings`)
  assert.ok(controls.maxCompoundTerms <= 5, `${label} used ${controls.maxCompoundTerms} compound terms`)
  assert.ok(controls.maxBatchStatements <= 100, `${label} batch used ${controls.maxBatchStatements} statements`)
  return { statements: controls.statements, maxBindings: controls.maxBindings,
    maxCompoundTerms: controls.maxCompoundTerms, maxBatchStatements: controls.maxBatchStatements }
}

async function main() {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}',
    compatibilityDate: '2026-08-01', d1Databases: ['DB'] })
  try {
    const native = await mf.getD1Database('DB')
    const migrationDir = path.join(__dirname, '..', 'migrations')
    for (const file of fs.readdirSync(migrationDir).filter((name) => name.endsWith('.sql')).sort()) {
      for (const sql of migrationStatements(fs.readFileSync(path.join(migrationDir, file), 'utf8'))) {
        try { await native.prepare(sql).run() }
        catch (error) {
          if (/too many terms in compound SELECT/i.test(String(error)) && /^INSERT\b/i.test(sql)) continue
          throw new Error(`${file}: ${sql.slice(0, 160)} :: ${error}`)
        }
      }
    }
    await native.batch([
      native.prepare("INSERT INTO branches(id,name,is_active) VALUES(1,'Shop',1),(2,'Warehouse',1)"),
      native.prepare(`INSERT INTO products(id,name,name_key,barcode,category,brand,unit,is_active,is_group,stock_quantity,rfid_confirmed_qty,
        cost_price_usd,cost_price_khr,selling_price_usd,selling_price_khr,wholesale_price_usd,wholesale_price_khr,updated_at)
        VALUES(5201,'Native removal','native removal','00005201','Stock','Native','pcs',1,0,5,1,4,0,8,0,7,0,'2026-09-08 01:00:00')`),
      native.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity,rfid_confirmed_qty) VALUES(5201,1,5,1),(5201,2,0,0)'),
      native.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,notes,supplier_id,supplier_name,payment_status,received_quantity,received_branch_id,received_cost_usd)
        VALUES(95201,5201,'native-active','LOT-A','2026-09-01',1,'active receipt',81,'Supplier Active','paid',5,1,20),
          (95202,5201,'native-inactive','LOT-Z','2026-08-01',0,'inactive receipt',82,'Supplier Inactive','credit',0,1,0)`),
      native.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(95201,1,5),(95202,1,0)'),
    ])
    const { app, controls, db, undo, productDelete } = loadRoute(native, true)
    const body = { manifest_version: 1, resolution_version: 2, client_request_id: 'native_remove_review_001', merge_groups: [],
      remove_rows: [{ product_id: 5201, reason: 'Independent duplicate product' }] }
    reset(controls)
    const preview = await app.posts.get('/possible-duplicates/merge-batch/preview')({
      env: {}, get: () => user, executionCtx: { waitUntil: () => {} }, req: { json: async () => body },
      json: (payload, status = 200) => ({ body: payload, status }),
    })
    assert.equal(preview.status, 200, JSON.stringify(preview.body))
    assert.equal(preview.body.counts.requested_groups, 0)
    assert.equal(preview.body.counts.requested_removals, 1)
    assert.equal(preview.body.page.removals[0].batches[0].supplier_name, 'Supplier Active')
    assert.equal(preview.body.page.removals[0].batches[1].supplier_name, 'Supplier Inactive')
    const previewBounds = assertBounds(controls, 'native remove preview')
    reset(controls)
    const finalized = await app.posts.get('/possible-duplicates/merge-batch/reviews/:reviewId/finalize')({
      env: {}, get: () => user,
      req: { param: () => preview.body.review_id, json: async () => ({
        manifest_version: 1, resolution_version: 2, review_id: preview.body.review_id,
        draft_digest: preview.body.draft_digest, resolutions: [],
      }) },
      json: (payload, status = 200) => ({ body: payload, status }),
    })
    assert.equal(finalized.status, 200, JSON.stringify(finalized.body))
    assert.equal(finalized.body.counts.ready_removals, 1)
    assert.deepEqual((await db.prepare('SELECT status,action_ordinal FROM product_remove_operations WHERE review_id=@review').all({ review: preview.body.review_id })).map((row) => ({ ...row })), [
      { status: 'ready', action_ordinal: 0 },
    ])
    const storedOperation = await db.prepare('SELECT * FROM product_remove_operations WHERE review_id=@review').get({ review: preview.body.review_id })
    const storedPlan = productDelete.parseProductRemovePlan(JSON.parse(storedOperation.plan_json))
    assert.equal(await productDelete.productRemovePlanDigest(storedPlan), storedOperation.plan_digest)
    const finalizeBounds = assertBounds(controls, 'native remove finalize')
    const applyBody = { review_id: preview.body.review_id, manifest_digest: finalized.body.manifest_digest,
      client_request_id: preview.body.review_id }
    reset(controls)
    const applied = await app.posts.get('/possible-duplicates/merge-batch')({
      env: {}, get: () => user, executionCtx: { waitUntil: () => {} }, req: { json: async () => applyBody },
      json: (payload, status = 200) => ({ body: payload, status }),
    })
    assert.equal(applied.status, 200, JSON.stringify({ body: applied.body, controls }))
    assert.equal(applied.body.status, 'completed')
    assert.equal(applied.body.continuation_required, false)
    assert.equal(applied.body.removals.length, 1)
    assert.equal(applied.body.removals[0].status, 'undo_ready')
    assert.deepEqual({ ...(await db.prepare('SELECT is_active,stock_quantity,rfid_confirmed_qty FROM products WHERE id=5201').get()) },
      { is_active: 0, stock_quantity: 0, rfid_confirmed_qty: 0 })
    assert.deepEqual((await db.prepare('SELECT branch_id,quantity,rfid_confirmed_qty FROM branch_stock WHERE product_id=5201 ORDER BY branch_id').all()).map((row) => ({ ...row })), [
      { branch_id: 1, quantity: 0, rfid_confirmed_qty: 0 }, { branch_id: 2, quantity: 0, rfid_confirmed_qty: 0 },
    ])
    assert.deepEqual((await db.prepare('SELECT id,is_active,supplier_name FROM product_batches WHERE variant_product_id=5201 ORDER BY id').all()).map((row) => ({ ...row })), [
      { id: 95201, is_active: 0, supplier_name: 'Supplier Active' }, { id: 95202, is_active: 0, supplier_name: 'Supplier Inactive' },
    ])
    assert.deepEqual({ ...(await db.prepare("SELECT movement_type,quantity,batch_id FROM inventory_movements WHERE product_id=5201 AND movement_type='write_off'").get()) },
      { movement_type: 'write_off', quantity: 5, batch_id: null })
    const history = await db.prepare("SELECT id,undo_payload FROM action_history WHERE json_extract(undo_payload,'$.applier')='product.remove'").get()
    assert.ok(history?.id > 0)
    const applyBounds = assertBounds(controls, 'native remove apply')
    const undoPayload = JSON.parse(history.undo_payload)
    const applier = undo.resolveUndoApplier(undoPayload)
    reset(controls)
    const undone = await applier.run(undoPayload, { env: {}, user, direction: 'undo', historyId: history.id, generation: 0 })
    assert.equal(undone.complete, true)
    assert.deepEqual({ ...(await db.prepare('SELECT is_active,stock_quantity,rfid_confirmed_qty FROM products WHERE id=5201').get()) },
      { is_active: 1, stock_quantity: 5, rfid_confirmed_qty: 1 })
    assert.deepEqual((await db.prepare('SELECT id,is_active,supplier_name FROM product_batches WHERE variant_product_id=5201 ORDER BY id').all()).map((row) => ({ ...row })), [
      { id: 95201, is_active: 1, supplier_name: 'Supplier Active' }, { id: 95202, is_active: 0, supplier_name: 'Supplier Inactive' },
    ])
    const undoBounds = assertBounds(controls, 'native remove undo')
    console.log('product conflict action remove native D1 passed ' + JSON.stringify({ previewBounds, finalizeBounds, applyBounds, undoBounds }))
  } finally { await mf.dispose() }
}

main().catch((error) => { console.error(error); process.exit(1) })
