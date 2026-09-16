const assert = require('node:assert/strict')
const { loadRoute, loadTs, seed, post } = require('./test-product-conflict-action-groups-sqlite.cjs')

const user = { id: 900, username: 'reviewer' }

function loadReviewApply(fixture) {
  return loadTs('lib/reviewApply.ts', {
    './db': { getDb: () => fixture.db }, './audit': { audit: async () => {} },
    '../durable-objects/broadcastHub': { broadcast: async () => {} }, './cache': { bumpVersion: async () => {} },
    './productWrites': {}, './branchWrites': {}, './canonicalBranchIdentity': {}, './permissions': fixture.permissions,
    './productImagePermission': {}, './auth': {}, './pendingActions': {}, '../index': {}, './productDelete': fixture.productDelete,
  })
}

async function finalize(app, review, groups, choices = {}, actor = user) {
  const resolutions = groups.map((group) => ({
    group_key: group.group_key,
    keeper_id: choices.keeper_id ?? group.member_ids[0],
    barcode: choices.barcode ?? { mode: 'canonical' },
    category_source_id: choices.category_source_id ?? group.member_ids[0],
    brand_source_id: choices.brand_source_id ?? group.member_ids[0],
    unit_source_id: choices.unit_source_id ?? group.member_ids[0],
  }))
  return app.posts.get('/possible-duplicates/merge-batch/reviews/:reviewId/finalize')({
    env: {}, get: () => actor,
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

async function prepareThreeMemberReview(parentChain = false) {
  const { d1, groups } = seed(1)
  d1.db.prepare(`INSERT INTO products
    (id,name,name_key,barcode,category,brand,unit,is_active,is_group,stock_quantity,cost_price_usd,cost_price_khr,
     selling_price_usd,selling_price_khr,wholesale_price_usd,wholesale_price_khr,updated_at)
    VALUES(10002,'Third','third','000700000','C','Three','pack',1,0,4,8,0,10,0,9,0,'2026-09-08 01:00:00')`).run()
  d1.db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(10002,1,4)').run()
  d1.db.prepare(`INSERT INTO product_batches
    (id,variant_product_id,batch_key,lot_code,expiry_date,received_at,is_active,notes,batch_number,supplier_id,supplier_name,
     unit_cost_usd,payment_status,credit_due_date,received_quantity,received_branch_id,received_cost_usd)
    VALUES(99003,10002,'receipt-b','LOT-C','2027-03-01','2026-09-03',1,'third receipt',1,43,'Supplier C',8,'paid',NULL,4,1,32)`).run()
  d1.db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(99003,1,4)').run()
  groups[0].member_ids = [10000, 10001, 10002]
  if(parentChain) {
    d1.db.exec(`INSERT INTO products(id,name,name_key,barcode,category,brand,unit,is_active,is_group,stock_quantity,cost_price_usd,
      selling_price_usd,wholesale_price_usd,updated_at,parent_id)
      VALUES(10003,'Fourth','fourth','000700000','D','Four','pack',1,0,1,8,10,9,'2026-09-08 01:00:00',10002);
      UPDATE products SET parent_id=10001 WHERE id=10002;
      UPDATE products SET parent_id=10000 WHERE id=10001;
      INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(10003,1,1);
      INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,is_active,unit_cost_usd,received_quantity,received_cost_usd)
      VALUES(99004,10003,'fourth-lot','2026-09-04',1,8,1,8);
      INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(99004,1,1);`)
    if(parentChain==='shared') d1.db.exec('UPDATE products SET parent_id=10001 WHERE id=10003')
    d1.db.exec(`INSERT INTO sales(id,branch_id) VALUES(17000,1);
      INSERT INTO sale_items(id,sale_id,product_id,quantity,branch_id) VALUES(17001,17000,10002,1,1);
      INSERT INTO sale_item_batch_allocations(id,sale_item_id,batch_id,branch_id,quantity,lot_code,expiry_date)
      VALUES(17002,17001,99003,1,1,'LOT-C','2027-03-01');`)
    groups[0].member_ids.push(10003)
  }
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
  const storedPlan = JSON.parse(d1.db.prepare('SELECT final_plan_json FROM product_conflict_action_groups WHERE review_id=?').get(review.body.review_id).final_plan_json)
  assert.deepEqual(storedPlan.projected_result.lot_dispositions.slice(0,2).map((row) => ({ source: row.source_batch_id,
    target: row.target_batch_id, collision: row.collision, supplier: row.supplier_name, received: row.received_at })), [
    { source: 99002, target: 99002, collision: 'reparent', supplier: 'Supplier B', received: '2026-09-02' },
    { source: 99003, target: 99002, collision: 'fold', supplier: 'Supplier C', received: '2026-09-03' },
  ])
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
  const chainState = (d1) => ({
    products:d1.db.prepare('SELECT id,name,barcode,parent_id,is_active,stock_quantity,cost_price_usd FROM products WHERE id BETWEEN 10000 AND 10003 ORDER BY id').all(),
    lots:d1.db.prepare('SELECT id,variant_product_id,is_active,received_at,unit_cost_usd,received_quantity,received_cost_usd FROM product_batches WHERE id BETWEEN 99001 AND 99004 ORDER BY id').all(),
    stock:d1.db.prepare('SELECT product_id,branch_id,quantity FROM branch_stock WHERE product_id BETWEEN 10000 AND 10003 ORDER BY product_id,branch_id').all(),
    lotStock:d1.db.prepare('SELECT batch_id,branch_id,quantity FROM branch_batch_stock WHERE batch_id BETWEEN 99001 AND 99004 ORDER BY batch_id,branch_id').all(),
    allocations:d1.db.prepare('SELECT * FROM sale_item_batch_allocations ORDER BY id').all(),
  })
  const interruptChain = async (fixture) => {
    const realNow=Date.now,baseNow=realNow();let wrote=false
    fixture.controls.beforeNextWriteBatch=()=>{wrote=true}
    Date.now=()=>baseNow+(wrote?19000:0)
    let result
    try { result=await apply(fixture.app,fixture.review,fixture.finalized.manifest_digest) } finally {Date.now=realNow}
    assert.equal(result.body.counts.committed_folds,1,JSON.stringify(result.body))
    assert.equal(result.body.interruption_code,'merge_budget_reached')
  }
  {
    const fixture=await prepareThreeMemberReview(true),before=chainState(fixture.d1)
    await interruptChain(fixture)
    assert.equal(fixture.d1.db.prepare('SELECT parent_id FROM products WHERE id=10002').get().parent_id,10000)
    const completed=await apply(fixture.app,fixture.review,fixture.finalized.manifest_digest)
    assert.equal(completed.body.status,'completed',JSON.stringify(completed.body))
    assert.equal(completed.body.counts.committed_folds,3)
    const merged=chainState(fixture.d1)
    const history=fixture.d1.db.prepare("SELECT id,undo_payload FROM action_history WHERE json_extract(undo_payload,'$.applier')='product.merge.group'").get()
    const undoPayload=JSON.parse(history.undo_payload),applier=fixture.undo.resolveUndoApplier(undoPayload)
    for(let child=0;child<3;child++) {
      const undo=await applier.run(undoPayload,{env:{},user,direction:'undo',historyId:history.id,generation:0})
      assert.equal(undo.complete,child===2)
    }
    assert.deepEqual(chainState(fixture.d1),before,'all four member parents, stock, receipt dates/costs/allocations restore')
    const redoPayload=JSON.parse(fixture.d1.db.prepare('SELECT redo_payload FROM action_history WHERE id=?').get(history.id).redo_payload)
    for(let child=0;child<3;child++) {
      const redo=await applier.run(redoPayload,{env:{},user,direction:'redo',historyId:history.id,generation:1})
      assert.equal(redo.complete,child===2)
    }
    assert.deepEqual(chainState(fixture.d1),merged,'redo retains exact merge result')
  }
  for(const [label,mutation] of [
    ['parent',"UPDATE products SET parent_id=99999 WHERE id=10002"],
    ['name',"UPDATE products SET name='Outside edit' WHERE id=10002"],
    ['barcode',"UPDATE products SET barcode='outside' WHERE id=10002"],
    ['stock',"UPDATE branch_stock SET quantity=99 WHERE product_id=10002"],
    ['received date',"UPDATE product_batches SET received_at='2026-09-10' WHERE id=99003"],
    ['foreign operation certificate',"UPDATE undo_snapshots SET payload_json=json_set(payload_json,'$.operationId','foreign-operation') WHERE kind='product.merge.group.child'"],
  ]) {
    const fixture=await prepareThreeMemberReview(true);await interruptChain(fixture)
    fixture.d1.db.exec(mutation)
    const before=chainState(fixture.d1)
    const result=await apply(fixture.app,fixture.review,fixture.finalized.manifest_digest)
    assert.equal(result.status,409,label+JSON.stringify(result.body))
    assert.deepEqual(chainState(fixture.d1),before,label+' external edit is not certified as our prior effect')
  }
  {
    const fixture=await prepareThreeMemberReview('shared')
    const completed=await apply(fixture.app,fixture.review,fixture.finalized.manifest_digest)
    assert.equal(completed.body.status,'completed',JSON.stringify(completed.body))
    assert.equal(completed.body.counts.committed_folds,3,'third fold accepts a certified effect from the first, not just the immediately previous member')
  }
  {
    const fixture=await prepareThreeMemberReview(true);await interruptChain(fixture)
    const history=fixture.d1.db.prepare("SELECT id,undo_payload FROM action_history WHERE json_extract(undo_payload,'$.applier')='product.merge.group'").get()
    const payload=JSON.parse(history.undo_payload),applier=fixture.undo.resolveUndoApplier(payload)
    assert.equal((await applier.run(payload,{env:{},user,direction:'undo',historyId:history.id,generation:0})).complete,true)
    const redoPayload=JSON.parse(fixture.d1.db.prepare('SELECT redo_payload FROM action_history WHERE id=?').get(history.id).redo_payload)
    assert.equal((await applier.run(redoPayload,{env:{},user,direction:'redo',historyId:history.id,generation:1})).complete,true)
    const resumed=await apply(fixture.app,fixture.review,fixture.finalized.manifest_digest)
    assert.equal(resumed.body.status,'completed',JSON.stringify(resumed.body))
    assert.equal(resumed.body.counts.committed_folds,3,'parent effect certificate is refreshed in the current generation after prefix redo')
  }
  {
    const fixture=await prepareThreeMemberReview(true);await interruptChain(fixture)
    const before=chainState(fixture.d1)
    fixture.controls.beforeNextWriteBatch=()=>fixture.d1.db.exec("UPDATE products SET parent_id=99999 WHERE id=10002")
    const race=await apply(fixture.app,fixture.review,fixture.finalized.manifest_digest)
    assert.equal(race.status,409,JSON.stringify(race.body))
    const after=chainState(fixture.d1);after.products.find(row=>row.id===10002).parent_id=before.products.find(row=>row.id===10002).parent_id
    assert.deepEqual(after,before,'external parent race after read cannot slip through CAS')
  }
  {
    const fixture=await prepareThreeMemberReview(true);await interruptChain(fixture)
    const before=chainState(fixture.d1)
    fixture.d1.db.exec(`CREATE TRIGGER reject_chain_fold BEFORE INSERT ON audit_logs WHEN NEW.action='merge_duplicate' AND NEW.entity_id='10002'
      BEGIN SELECT RAISE(ABORT,'D1 DB is overloaded: injected chain fold'); END;`)
    const failed=await apply(fixture.app,fixture.review,fixture.finalized.manifest_digest)
    assert.equal(failed.status,500,JSON.stringify(failed.body));assert.deepEqual(chainState(fixture.d1),before)
    fixture.d1.db.exec('DROP TRIGGER reject_chain_fold')
    const retried=await apply(fixture.app,fixture.review,fixture.finalized.manifest_digest)
    assert.equal(retried.body.status,'completed',JSON.stringify(retried.body))
  }
  {
    const fixture = await prepareThreeMemberReview()
    const applied = await apply(fixture.app, fixture.review, fixture.finalized.manifest_digest)
    assert.equal(applied.status, 200, JSON.stringify(applied.body))
    assert.equal(applied.body.status, 'completed')
    assert.equal(applied.body.groups.length, 1)
    assert.equal(applied.body.groups[0].processed_folds, 2)
    assert.deepEqual(applied.body.groups[0].merged_ids, [10001, 10002])
    assert.deepEqual(fixture.d1.db.prepare(`SELECT id,variant_product_id,is_active FROM product_batches
      WHERE id IN (99002,99003) ORDER BY id`).all().map((row) => ({ ...row })), [
      { id: 99002, variant_product_id: 10000, is_active: 1 },
      { id: 99003, variant_product_id: 10002, is_active: 0 },
    ])
    assert.ok(fixture.controls.statements <= 700)
  }

  {
    const { d1, groups } = seed(3)
    const loaded = loadRoute(d1, true)
    const review = await post(loaded.app, {
      manifest_version: 1, resolution_version: 2, client_request_id: 'apply_three_groups_001', merge_groups: groups, remove_rows: [],
    })
    assert.equal(review.status, 200)
    const finalized = await finalize(loaded.app, review.body, groups)
    assert.equal(finalized.status, 200, JSON.stringify(finalized.body))
    const applied = await apply(loaded.app, review.body, finalized.body.manifest_digest)
    assert.equal(applied.status, 200, JSON.stringify(applied.body))
    assert.equal(applied.body.status, 'completed')
    assert.equal(applied.body.continuation_required, false)
    assert.equal(applied.body.groups.length, 3)
    assert.deepEqual(applied.body.groups.map((group) => group.group_key), groups.map((group) => group.group_key))
    assert.equal(applied.body.groups.reduce((sum, group) => sum + group.processed_folds, 0), 3)
    assert.equal(d1.db.prepare("SELECT COUNT(*) n FROM action_history WHERE json_extract(undo_payload,'$.applier')='product.merge.group'").get().n, 3)
    assert.ok(loaded.controls.statements <= 700)
  }

  {
    const { d1, groups } = seed(3)
    const loaded = loadRoute(d1, true)
    const review = await post(loaded.app, {
      manifest_version: 1, resolution_version: 2, client_request_id: 'apply_second_fold_race_001', merge_groups: groups, remove_rows: [],
    })
    const finalized = await finalize(loaded.app, review.body, groups)
    let injected = false
    loaded.controls.beforeWriteBatch = (statements) => {
      if (!injected && statements.some((statement) => Number(statement.params?.member) === 10002)) {
        d1.db.prepare('UPDATE branch_stock SET quantity=30 WHERE product_id=10002 AND branch_id=1').run()
        injected = true
      }
    }
    const applied = await apply(loaded.app, review.body, finalized.body.manifest_digest)
    assert.equal(applied.status, 200, JSON.stringify(applied.body))
    assert.equal(applied.body.interruption_code, 'merge_state_conflict')
    assert.equal(applied.body.continuation_required, true)
    assert.equal(applied.body.groups.length, 1)
    assert.equal(applied.body.groups[0].group_key, groups[0].group_key)
    assert.equal(d1.db.prepare('SELECT is_active FROM products WHERE id=10000').get().is_active, 0)
    assert.equal(d1.db.prepare('SELECT is_active FROM products WHERE id=10002').get().is_active, 1)
    assert.equal(d1.db.prepare('SELECT quantity FROM branch_stock WHERE product_id=10002 AND branch_id=1').get().quantity, 30)
    assert.equal(d1.db.prepare("SELECT COUNT(*) n FROM action_history WHERE json_extract(undo_payload,'$.applier')='product.merge.group'").get().n, 1)
    assert.equal(d1.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='merge_duplicate'").get().n, 1)
  }

  for (const [label, mutate, verify] of [
    ['second-fold keeper lot quantity',
      (db) => db.prepare('UPDATE branch_batch_stock SET quantity=20 WHERE batch_id=99002 AND branch_id=1').run(),
      (db) => assert.equal(db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=99002 AND branch_id=1').get().quantity, 20)],
    ['second-fold keeper lot key',
      (db) => db.prepare("UPDATE product_batches SET batch_key='concurrent-key' WHERE id=99002").run(),
      (db) => assert.equal(db.prepare('SELECT batch_key FROM product_batches WHERE id=99002').get().batch_key, 'concurrent-key')],
  ]) {
    const fixture = await prepareThreeMemberReview()
    let injected = false
    fixture.controls.beforeWriteBatch = (statements) => {
      if (!injected && statements.some((statement) => Number(statement.params?.member) === 10002)) {
        mutate(fixture.d1.db)
        injected = true
      }
    }
    const applied = await apply(fixture.app, fixture.review, fixture.finalized.manifest_digest)
    assert.equal(applied.status, 200, label)
    assert.equal(applied.body.interruption_code, 'merge_state_conflict', label)
    assert.equal(applied.body.counts.committed_folds, 1, label)
    assert.equal(fixture.d1.db.prepare('SELECT is_active FROM products WHERE id=10002').get().is_active, 1, label)
    verify(fixture.d1.db)
    assert.equal(fixture.d1.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='merge_duplicate'").get().n, 1, label)
  }

  {
    const fixture = await prepareThreeMemberReview()
    const before = catalogState(fixture.d1)
    const realNow = Date.now
    const baseNow = realNow()
    let firstFoldCommitted = false
    fixture.controls.beforeNextWriteBatch = () => { firstFoldCommitted = true }
    Date.now = () => baseNow + (firstFoldCommitted ? 19_000 : 0)
    let first
    try { first = await apply(fixture.app, fixture.review, fixture.finalized.manifest_digest) }
    finally { Date.now = realNow }
    assert.equal(first.status, 200, JSON.stringify(first.body))
    assert.equal(first.body.continuation_required, true)
    assert.equal(first.body.interruption_code, 'merge_budget_reached')
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
    const applyDuringUndo = await apply(fixture.app, fixture.review, fixture.finalized.manifest_digest)
    assert.equal(applyDuringUndo.status, 409)
    assert.equal(applyDuringUndo.body.code, 'review_reversed',
      'a completed review must not use its success fast path after the first child Undo')
    const undoTwo = await applier.run(payload, { env: {}, user, direction: 'undo', historyId: history.id, generation: 2 })
    assert.equal(undoTwo.complete, true)
    assert.deepEqual(catalogState(fixture.d1), before, 'two-child Undo restores exact catalog, stock and lot provenance')
    const applyAfterUndo = await apply(fixture.app, fixture.review, fixture.finalized.manifest_digest)
    assert.equal(applyAfterUndo.status, 409)
    assert.equal(applyAfterUndo.body.code, 'review_reversed')
    const redoPayload = JSON.parse(fixture.d1.db.prepare('SELECT redo_payload FROM action_history WHERE id=?').get(history.id).redo_payload)
    const redoOne = await applier.run(redoPayload, { env: {}, user, direction: 'redo', historyId: history.id, generation: 3 })
    assert.equal(redoOne.continuation_required, true)
    const applyDuringRedo = await apply(fixture.app, fixture.review, fixture.finalized.manifest_digest)
    assert.equal(applyDuringRedo.status, 409)
    assert.equal(applyDuringRedo.body.code, 'review_reversed')
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

  {
    const races = [
      ['keeper branch quantity', (db) => db.prepare('UPDATE branch_stock SET quantity=20 WHERE product_id=10000 AND branch_id=1').run()],
      ['keeper RFID quantity', (db) => db.prepare('UPDATE branch_stock SET rfid_confirmed_qty=2 WHERE product_id=10000 AND branch_id=1').run()],
      ['branch quantity', (db) => db.prepare('UPDATE branch_stock SET quantity=30 WHERE product_id=10001 AND branch_id=1').run()],
      ['member RFID quantity', (db) => db.prepare('UPDATE branch_stock SET rfid_confirmed_qty=2 WHERE product_id=10001 AND branch_id=1').run()],
      ['lot quantity', (db) => db.prepare('UPDATE branch_batch_stock SET quantity=30 WHERE batch_id=99002 AND branch_id=1').run()],
      ['added lot', (db) => db.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,is_active)
        VALUES(99004,10001,'concurrent-lot','2026-09-08',1)`).run()],
      ['removed lot', (db) => {
        db.prepare('DELETE FROM branch_batch_stock WHERE batch_id=99002').run()
        db.prepare('DELETE FROM product_batches WHERE id=99002').run()
      }],
      ['supplier', (db) => db.prepare("UPDATE product_batches SET supplier_name='Concurrent supplier' WHERE id=99002").run()],
      ['received date', (db) => db.prepare("UPDATE product_batches SET received_at='2026-09-09' WHERE id=99002").run()],
    ]
    for (const [label, mutate] of races) {
      const fixture = await prepareThreeMemberReview()
      fixture.controls.beforeNextWriteBatch = () => mutate(fixture.d1.db)
      const stale = await apply(fixture.app, fixture.review, fixture.finalized.manifest_digest)
      assert.equal(stale.status, 409, label)
      assert.equal(stale.body.code, 'merge_state_conflict', label)
      assert.equal(fixture.d1.db.prepare('SELECT is_active FROM products WHERE id=10001').get().is_active, 1, label)
      assert.equal(fixture.d1.db.prepare('SELECT COUNT(*) n FROM action_history').get().n, 0, label)
      assert.equal(fixture.d1.db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n, 0, label)
    }
  }

  {
    const { d1 } = seed(1)
    const loaded = loadRoute(d1, true)
    const review = await post(loaded.app, {
      manifest_version: 1, resolution_version: 2, client_request_id: 'remove_only_review_001', merge_groups: [],
      remove_rows: [{ product_id: 10000, reason: 'Independent duplicate row' }],
    }, { ...user, noMerge: true })
    assert.equal(review.status, 200, JSON.stringify(review.body))
    assert.equal(review.body.counts.requested_groups, 0)
    assert.equal(review.body.counts.requested_removals, 1)
    assert.equal(review.body.page.removals[0].batches[0].supplier_name, 'Supplier A')
    const finalized = await finalize(loaded.app, review.body, [])
    assert.equal(finalized.status, 200, JSON.stringify(finalized.body))
    assert.equal(finalized.body.counts.ready_removals, 1)
    const applied = await apply(loaded.app, review.body, finalized.body.manifest_digest, { ...user, noMerge: true })
    assert.equal(applied.status, 200, JSON.stringify(applied.body))
    assert.equal(applied.body.status, 'completed')
    assert.equal(applied.body.continuation_required, false)
    assert.equal(applied.body.removals[0].status, 'undo_ready')
    assert.equal(applied.body.removals[0].undo_availability, 'ready')
    assert.equal(d1.db.prepare('SELECT is_active FROM products WHERE id=10000').get().is_active, 0)
    assert.equal(d1.db.prepare('SELECT is_active FROM product_batches WHERE id=99001').get().is_active, 0)
    assert.deepEqual({ ...d1.db.prepare("SELECT movement_type,quantity FROM inventory_movements WHERE product_id=10000 AND movement_type='write_off'").get() },
      { movement_type: 'write_off', quantity: 2 })
    const history = d1.db.prepare("SELECT id,undo_payload FROM action_history WHERE json_extract(undo_payload,'$.applier')='product.remove'").get()
    const payload = JSON.parse(history.undo_payload)
    const applier = loaded.undo.resolveUndoApplier(payload)
    const undone = await applier.run(payload, { env: {}, user, direction: 'undo', historyId: history.id, generation: 0 })
    assert.equal(undone.complete, true)
    assert.equal(d1.db.prepare('SELECT is_active FROM products WHERE id=10000').get().is_active, 1)
    const blockedApply = await apply(loaded.app, review.body, finalized.body.manifest_digest)
    assert.equal(blockedApply.status, 409)
    assert.equal(blockedApply.body.code, 'review_reversed')
    const redoPayload = JSON.parse(d1.db.prepare('SELECT redo_payload FROM action_history WHERE id=?').get(history.id).redo_payload)
    await applier.run(redoPayload, { env: {}, user, direction: 'redo', historyId: history.id, generation: 1 })
    const replay = await apply(loaded.app, review.body, finalized.body.manifest_digest)
    assert.equal(replay.status, 200)
    assert.equal(replay.body.continuation_required, false)
  }

  {
    const { d1 } = seed(1)
    d1.db.prepare(`INSERT INTO users(id,username,name,password,permissions,is_active)
      VALUES(900,'requester','Requester','x','{}',1),(903,'approver','Approver','x','{}',1)`).run()
    const loaded = loadRoute(d1, true)
    const reviewer = { ...user, noMerge: true, reviewDelete: true }
    const review = await post(loaded.app, {
      manifest_version: 1, resolution_version: 2, client_request_id: 'remove_review_tier_001', merge_groups: [],
      remove_rows: [{ product_id: 10000, reason: 'Needs full delete review' }],
    }, reviewer)
    assert.equal(review.status, 200)
    const finalized = await finalize(loaded.app, review.body, [], {}, reviewer)
    assert.equal(finalized.status, 200, JSON.stringify(finalized.body))
    const queued = await apply(loaded.app, review.body, finalized.body.manifest_digest, reviewer)
    assert.equal(queued.status, 200, JSON.stringify(queued.body))
    assert.equal(queued.body.status, 'approval_pending')
    assert.equal(queued.body.approval_required, true)
    assert.equal(queued.body.continuation_required, false)
    assert.equal(queued.body.removals[0].status, 'approval_pending')
    assert.ok(queued.body.removals[0].pending_action_id > 0)
    assert.equal(d1.db.prepare('SELECT is_active FROM products WHERE id=10000').get().is_active, 1)
    assert.equal(d1.db.prepare("SELECT COUNT(*) n FROM pending_actions WHERE status='open'").get().n, 1)
    assert.equal(d1.db.prepare('SELECT COUNT(*) n FROM action_history').get().n, 0)
    const queuedReplay = await apply(loaded.app, review.body, finalized.body.manifest_digest, reviewer)
    assert.equal(queuedReplay.status, 200, JSON.stringify(queuedReplay.body))
    assert.equal(queuedReplay.body.status, 'approval_pending')
    assert.equal(queuedReplay.body.approval_required, true)
    assert.equal(queuedReplay.body.continuation_required, false)
    assert.deepEqual(queuedReplay.body.removals, [])
    assert.equal(d1.db.prepare("SELECT COUNT(*) n FROM pending_actions WHERE status='open'").get().n, 1,
      'lost-response replay does not duplicate a queued removal')
    const pending = { ...d1.db.prepare("SELECT * FROM pending_actions WHERE status='open'").get() }
    const approval = loadReviewApply(loaded)
    const approver = { id: 903, username: 'approver', name: 'Approver', organization_id: null, role_id: null,
      permissions: '{}', is_active: 1 }
    const approved = await approval.applyApprovedPendingAction({}, pending, { id: 903, name: 'Approver' }, approver)
    assert.equal(approved.pendingActionMarkedAtomically, true)
    assert.equal(d1.db.prepare('SELECT status FROM pending_actions WHERE id=?').get(pending.id).status, 'approved')
    assert.equal(d1.db.prepare('SELECT status FROM product_remove_operations WHERE pending_action_id=?').get(pending.id).status, 'undo_ready')
    assert.equal(d1.db.prepare('SELECT status FROM product_conflict_action_reviews WHERE id=?').get(review.body.review_id).status, 'completed')
    assert.equal(d1.db.prepare('SELECT is_active FROM products WHERE id=10000').get().is_active, 0)
  }

  {
    const { d1 } = seed(7)
    const loaded = loadRoute(d1, true)
    const removeRows = Array.from({ length: 13 }, (_, index) => ({ product_id: 10000 + index, reason: `Remove row ${index + 1}` }))
    const review = await post(loaded.app, { manifest_version: 1, resolution_version: 2,
      client_request_id: 'remove_thirteen_001', merge_groups: [], remove_rows: removeRows })
    assert.equal(review.status, 200)
    const finalized = await finalize(loaded.app, review.body, [])
    assert.equal(finalized.status, 200)
    const first = await apply(loaded.app, review.body, finalized.body.manifest_digest)
    assert.equal(first.status, 200, JSON.stringify(first.body))
    assert.equal(first.body.removals.length, 12)
    assert.equal(first.body.continuation_required, true)
    assert.equal(first.body.counts.pending_removals, 1)
    const second = await apply(loaded.app, review.body, finalized.body.manifest_digest)
    assert.equal(second.status, 200)
    assert.equal(second.body.removals.length, 1)
    assert.equal(second.body.continuation_required, false)
    assert.equal(second.body.counts.completed_removals, 13)
    assert.ok(loaded.controls.statements <= 700)
    assert.ok(loaded.controls.maxBatchStatements <= 100)
  }

  {
    const { d1 } = seed(7)
    const loaded = loadRoute(d1, true)
    const reviewer = { ...user, noMerge: true, reviewDelete: true }
    const removeRows = Array.from({ length: 13 }, (_, index) => ({ product_id: 10000 + index, reason: `Review row ${index + 1}` }))
    const review = await post(loaded.app, { manifest_version: 1, resolution_version: 2,
      client_request_id: 'remove_thirteen_review_tier_001', merge_groups: [], remove_rows: removeRows }, reviewer)
    assert.equal(review.status, 200)
    const finalized = await finalize(loaded.app, review.body, [], {}, reviewer)
    assert.equal(finalized.status, 200)
    const first = await apply(loaded.app, review.body, finalized.body.manifest_digest, reviewer)
    assert.equal(first.status, 200, JSON.stringify(first.body))
    assert.equal(first.body.removals.length, 12)
    assert.equal(first.body.status, 'approval_pending')
    assert.equal(first.body.approval_required, true)
    assert.equal(first.body.continuation_required, true)
    assert.equal(first.body.counts.pending_removals, 1)
    assert.equal(first.body.counts.approval_pending_removals, 12)
    const second = await apply(loaded.app, review.body, finalized.body.manifest_digest, reviewer)
    assert.equal(second.status, 200, JSON.stringify(second.body))
    assert.equal(second.body.removals.length, 1)
    assert.equal(second.body.continuation_required, false)
    assert.equal(second.body.counts.approval_pending_removals, 13)
    const replay = await apply(loaded.app, review.body, finalized.body.manifest_digest, reviewer)
    assert.equal(replay.status, 200, JSON.stringify(replay.body))
    assert.deepEqual(replay.body.removals, [])
    assert.equal(replay.body.approval_required, true)
    assert.equal(d1.db.prepare("SELECT COUNT(*) n FROM pending_actions WHERE status='open'").get().n, 13)
  }

  {
    const { d1, groups } = seed(2)
    const loaded = loadRoute(d1, true)
    const review = await post(loaded.app, { manifest_version: 1, resolution_version: 2,
      client_request_id: 'mixed_group_remove_001', merge_groups: [groups[0]],
      remove_rows: [{ product_id: 10002, reason: 'Remove independent row' }] })
    assert.equal(review.status, 200)
    const finalized = await finalize(loaded.app, review.body, [groups[0]])
    assert.equal(finalized.status, 200)
    const applied = await apply(loaded.app, review.body, finalized.body.manifest_digest)
    assert.equal(applied.status, 200, JSON.stringify(applied.body))
    assert.equal(applied.body.groups[0].processed_folds, 1)
    assert.equal(applied.body.removals[0].product_id, 10002)
    assert.equal(applied.body.status, 'completed')
    assert.equal(applied.body.counts.canonical_groups, 1)
    assert.equal(applied.body.counts.removal_actions, 1)
  }

  console.log('product conflict action apply sqlite: bounded multi-fold/group apply, receipt CAS, exact Undo/Redo checks passed')
}

main().catch((error) => { console.error(error); process.exit(1) })
