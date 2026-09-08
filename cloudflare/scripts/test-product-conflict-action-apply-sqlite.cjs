const assert = require('node:assert/strict')
const { loadRoute, seed, post } = require('./test-product-conflict-action-groups-sqlite.cjs')

const user = { id: 900, username: 'reviewer' }

async function finalize(app, review, groups, choices = {}) {
  const resolutions = groups.map((group) => ({
    group_key: group.group_key,
    keeper_id: choices.keeper_id ?? group.member_ids[0],
    barcode: choices.barcode ?? { mode: 'canonical' },
    category_source_id: choices.category_source_id ?? group.member_ids[0],
    brand_source_id: choices.brand_source_id ?? group.member_ids[0],
    unit_source_id: choices.unit_source_id ?? group.member_ids[0],
  }))
  return app.posts.get('/possible-duplicates/merge-batch/reviews/:reviewId/finalize')({
    env: {}, get: () => user,
    req: { json: async () => ({ manifest_version: 1, resolution_version: 2, review_id: review.review_id,
      draft_digest: review.draft_digest, resolutions }), param: () => review.review_id },
    json: (body, status = 200) => ({ status, body }),
  })
}

async function apply(app, review, digest, actor = user) {
  return app.posts.get('/possible-duplicates/merge-batch')({
    env: {}, get: () => actor,
    req: { json: async () => ({ review_id: review.review_id, manifest_digest: digest, client_request_id: review.review_id }) },
    json: (body, status = 200) => ({ status, body }),
    executionCtx: { waitUntil: () => {} },
  })
}

async function prepareThreeMemberReview() {
  const { d1, groups } = seed(1)
  d1.db.prepare(`INSERT INTO products
    (id,name,name_key,barcode,category,brand,unit,is_active,is_group,stock_quantity,cost_price_usd,cost_price_khr,
     selling_price_usd,selling_price_khr,wholesale_price_usd,wholesale_price_khr,updated_at)
    VALUES(10002,'Third','third','000700000','C','Three','pack',1,0,4,8,0,10,0,9,0,'2026-09-08 01:00:00')`).run()
  d1.db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(10002,1,4)').run()
  d1.db.prepare(`INSERT INTO product_batches
    (id,variant_product_id,batch_key,lot_code,expiry_date,received_at,is_active,notes,batch_number,supplier_id,supplier_name,
     unit_cost_usd,payment_status,credit_due_date,received_quantity,received_branch_id,received_cost_usd)
    VALUES(99003,10002,'receipt-a','LOT-C','2027-03-01','2026-09-03',1,'third receipt',1,43,'Supplier C',8,'paid',NULL,4,1,32)`).run()
  d1.db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(99003,1,4)').run()
  groups[0].member_ids = [10000, 10001, 10002]
  const loaded = loadRoute(d1, true)
  const review = await post(loaded.app, {
    manifest_version: 1, resolution_version: 2, client_request_id: 'apply_three_member_001', merge_groups: groups, remove_rows: [],
  })
  assert.equal(review.status, 200)
  const finalized = await finalize(loaded.app, review.body, groups, {
    keeper_id: 10000, barcode: { mode: 'member', source_product_id: 10001 },
    category_source_id: 10002, brand_source_id: 10001, unit_source_id: 10002,
  })
  assert.equal(finalized.status, 200)
  return { d1, groups, ...loaded, review: review.body, finalized: finalized.body }
}

function catalogState(d1) {
  return {
    products: d1.db.prepare(`SELECT id,name,barcode,category,categories,brand,brands,unit,unit_normalized,brand_compact,
      is_active,stock_quantity,cost_price_usd,selling_price_usd,wholesale_price_usd,image_path,parent_id
      FROM products WHERE id IN (10000,10001,10002) ORDER BY id`).all(),
    stock: d1.db.prepare('SELECT product_id,branch_id,quantity,rfid_confirmed_qty FROM branch_stock WHERE product_id IN (10000,10001,10002) ORDER BY product_id,branch_id').all(),
    batches: d1.db.prepare(`SELECT id,variant_product_id,batch_key,lot_code,supplier_id,supplier_name,received_at,expiry_date,is_active
      FROM product_batches WHERE id IN (99001,99002,99003) ORDER BY id`).all(),
    batchStock: d1.db.prepare('SELECT batch_id,branch_id,quantity FROM branch_batch_stock WHERE batch_id IN (99001,99002,99003) ORDER BY batch_id,branch_id').all(),
  }
}

async function main() {
  {
    const fixture = await prepareThreeMemberReview()
    const before = catalogState(fixture.d1)
    const first = await apply(fixture.app, fixture.review, fixture.finalized.manifest_digest)
    assert.equal(first.status, 200, JSON.stringify(first.body))
    assert.equal(first.body.continuation_required, true)
    assert.equal(first.body.groups.length, 1)
    assert.equal(first.body.groups[0].processed_folds, 1)
    assert.equal(first.body.counts.committed_folds, 1)
    assert.equal(first.body.counts.pending_folds, 1)
    const prefixHistory = fixture.d1.db.prepare("SELECT id,undo_payload FROM action_history WHERE json_extract(undo_payload,'$.applier')='product.merge.group'").get()
    const prefixPayload = JSON.parse(prefixHistory.undo_payload)
    const prefixApplier = fixture.undo.resolveUndoApplier(prefixPayload)
    const prefixUndo = await prefixApplier.run(prefixPayload, { env: {}, user, direction: 'undo', historyId: prefixHistory.id, generation: 0 })
    assert.equal(prefixUndo.complete, true, 'the one-child committed prefix reverses as one safe child transaction')
    const reversedApply = await apply(fixture.app, fixture.review, fixture.finalized.manifest_digest)
    assert.equal(reversedApply.status, 409)
    assert.equal(reversedApply.body.code, 'review_reversed')
    const prefixRedoPayload = JSON.parse(fixture.d1.db.prepare('SELECT redo_payload FROM action_history WHERE id=?').get(prefixHistory.id).redo_payload)
    const prefixRedo = await prefixApplier.run(prefixRedoPayload, { env: {}, user, direction: 'redo', historyId: prefixHistory.id, generation: 1 })
    assert.equal(prefixRedo.complete, true)
    assert.equal(fixture.d1.db.prepare('SELECT status FROM product_conflict_action_groups WHERE review_id=?').get(fixture.review.review_id).status, 'partial',
      'redo of a partial prefix restores partial so the untouched member can continue')
    const second = await apply(fixture.app, fixture.review, fixture.finalized.manifest_digest)
    assert.equal(second.status, 200)
    assert.equal(second.body.status, 'completed')
    assert.equal(second.body.continuation_required, false)
    assert.equal(second.body.counts.committed_folds, 2)
    assert.equal(second.body.counts.pending_folds, 0)

    const keeper = { ...fixture.d1.db.prepare(`SELECT barcode,category,brand,unit,cost_price_usd,selling_price_usd,
      wholesale_price_usd,stock_quantity FROM products WHERE id=10000`).get() }
    assert.deepEqual(keeper, { barcode: '700000', category: 'C', brand: 'Two', unit: 'pack',
      cost_price_usd: 6, selling_price_usd: 10, wholesale_price_usd: 9, stock_quantity: 9 })
    assert.deepEqual(fixture.d1.db.prepare('SELECT id,is_active FROM products WHERE id IN (10001,10002) ORDER BY id').all().map((row) => ({ ...row })), [
      { id: 10001, is_active: 0 }, { id: 10002, is_active: 0 },
    ])
    assert.equal(fixture.d1.db.prepare(`SELECT SUM(bbs.quantity) quantity FROM branch_batch_stock bbs
      JOIN product_batches pb ON pb.id=bbs.batch_id WHERE pb.variant_product_id=10000 AND pb.is_active=1 AND bbs.branch_id=1`).get().quantity, 9)
    assert.deepEqual(fixture.d1.db.prepare(`SELECT id,variant_product_id,supplier_name,received_at,is_active FROM product_batches
      WHERE id IN (99002,99003) ORDER BY id`).all().map((row) => ({ ...row })), [
      { id: 99002, variant_product_id: 10000, supplier_name: 'Supplier B', received_at: '2026-09-02', is_active: 1 },
      { id: 99003, variant_product_id: 10002, supplier_name: 'Supplier C', received_at: '2026-09-03', is_active: 0 },
    ])
    assert.equal(fixture.d1.db.prepare("SELECT COUNT(*) n FROM action_history WHERE json_extract(undo_payload,'$.applier')='product.merge.group'").get().n, 1)
    assert.equal(fixture.d1.db.prepare("SELECT COUNT(*) n FROM undo_snapshots WHERE kind='product.merge.group.child' AND status='applied'").get().n, 2)
    assert.equal(fixture.d1.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='merge_duplicate'").get().n, 2)

    const history = fixture.d1.db.prepare("SELECT id,undo_payload FROM action_history WHERE json_extract(undo_payload,'$.applier')='product.merge.group'").get()
    const payload = JSON.parse(history.undo_payload)
    const applier = fixture.undo.resolveUndoApplier(payload)
    const undoOne = await applier.run(payload, { env: {}, user, direction: 'undo', historyId: history.id, generation: 2 })
    assert.equal(undoOne.continuation_required, true)
    const undoTwo = await applier.run(payload, { env: {}, user, direction: 'undo', historyId: history.id, generation: 2 })
    assert.equal(undoTwo.complete, true)
    assert.deepEqual(catalogState(fixture.d1), before, 'two-child Undo restores exact catalog, stock and lot provenance')
    const redoPayload = JSON.parse(fixture.d1.db.prepare('SELECT redo_payload FROM action_history WHERE id=?').get(history.id).redo_payload)
    const redoOne = await applier.run(redoPayload, { env: {}, user, direction: 'redo', historyId: history.id, generation: 3 })
    assert.equal(redoOne.continuation_required, true)
    const redoTwo = await applier.run(redoPayload, { env: {}, user, direction: 'redo', historyId: history.id, generation: 3 })
    assert.equal(redoTwo.complete, true)
    assert.equal(fixture.d1.db.prepare('SELECT is_active FROM products WHERE id=10002').get().is_active, 0)
    const replay = await apply(fixture.app, fixture.review, fixture.finalized.manifest_digest)
    assert.equal(replay.status, 200)
    assert.equal(replay.body.groups.length, 0)
    assert.equal(replay.body.continuation_required, false)
    assert.ok(fixture.controls.statements <= 700)
    assert.ok(fixture.controls.maxBindings <= 100)
    assert.ok(fixture.controls.maxCompoundTerms <= 5)
  }

  {
    const fixture = await prepareThreeMemberReview()
    const before = catalogState(fixture.d1)
    const beforeHistory = fixture.d1.db.prepare('SELECT COUNT(*) n FROM action_history').get().n
    const beforeAudit = fixture.d1.db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n
    fixture.controls.beforeNextWriteBatch = () => {
      fixture.d1.db.prepare("UPDATE products SET brand='Concurrent',updated_at='2026-09-08 12:34:56' WHERE id=10001").run()
    }
    const stale = await apply(fixture.app, fixture.review, fixture.finalized.manifest_digest)
    assert.equal(stale.status, 409)
    assert.equal(stale.body.code, 'merge_state_conflict')
    const after = catalogState(fixture.d1)
    assert.equal(after.products.find((row) => row.id === 10001).brand, 'Concurrent')
    after.products.find((row) => row.id === 10001).brand = before.products.find((row) => row.id === 10001).brand
    assert.deepEqual(after, before, 'the simulated concurrent edit is the only mutation')
    assert.equal(fixture.d1.db.prepare('SELECT COUNT(*) n FROM action_history').get().n, beforeHistory)
    assert.equal(fixture.d1.db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n, beforeAudit)
    assert.equal(fixture.d1.db.prepare("SELECT COUNT(*) n FROM product_conflict_action_group_members WHERE status!='planned'").get().n, 0)
  }

  console.log('product conflict action apply sqlite: N=3 apply, receipt, stale CAS, exact Undo/Redo checks passed')
}

main().catch((error) => { console.error(error); process.exit(1) })
