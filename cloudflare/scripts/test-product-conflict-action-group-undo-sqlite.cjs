const assert = require('node:assert/strict')
const { loadRoute, seed, post } = require('./test-product-conflict-action-groups-sqlite.cjs')
const user = { id: 900, username: 'reviewer' }
const pause = () => new Promise((resolve) => setTimeout(resolve, 1100))

async function setup() {
  const { d1, groups } = seed(1)
  for (const id of [10002, 10003]) {
    d1.db.prepare(`INSERT INTO products(id,name,name_key,barcode,category,brand,unit,is_active,is_group,stock_quantity,
      cost_price_usd,selling_price_usd,wholesale_price_usd,updated_at)
      VALUES(?, 'Third', 'third','700000','A','One','pcs',1,0,1,4,8,7,'2026-09-08 01:00:00')`).run(id)
    d1.db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,1)').run(id)
  }
  groups[0].member_ids = [10000, 10001, 10002, 10003]
  d1.db.prepare(`INSERT INTO products(id,name,is_active,parent_id,updated_at)
    VALUES(10004,'Unmerged child',1,10001,'2026-09-01 00:00:00')`).run()
  d1.db.prepare(`INSERT INTO promotion_rules(title,product_ids,updated_at)
    VALUES('Shared member offer','[10001,10002,10003]','2026-09-01 00:00:00')`).run()
  const f = { d1, ...loadRoute(d1, true) }
  const preview = await post(f.app, { manifest_version: 1, resolution_version: 2,
    client_request_id: 'delayed_group_undo', merge_groups: groups, remove_rows: [] })
  assert.equal(preview.status, 200)
  const review = preview.body
  const final = await f.app.posts.get('/possible-duplicates/merge-batch/reviews/:reviewId/finalize')({
    env: {}, get: () => user, req: { param: () => review.review_id, json: async () => ({
      manifest_version: 1, resolution_version: 2, review_id: review.review_id, draft_digest: review.draft_digest,
      resolutions: [{ group_key: groups[0].group_key, keeper_id: 10000, barcode: { mode: 'canonical' },
        category_source_id: 10000, brand_source_id: 10000, unit_source_id: 10000 }],
    }) }, json: (body, status = 200) => ({ body, status }),
  })
  assert.equal(final.status, 200)
  const applied = await f.app.posts.get('/possible-duplicates/merge-batch')({ env: {}, get: () => user,
    executionCtx: { waitUntil() {} }, req: { json: async () => ({ review_id: review.review_id,
      manifest_digest: final.body.manifest_digest, client_request_id: review.review_id }) },
    json: (body, status = 200) => ({ body, status }),
  })
  assert.equal(applied.status, 200)
  assert.equal(applied.body.status, 'completed', JSON.stringify(applied.body))
  f.history = d1.db.prepare("SELECT id,undo_payload FROM action_history WHERE json_extract(undo_payload,'$.applier')='product.merge.group'").get()
  f.run = async (direction, generation) => {
    const pointer = JSON.parse(d1.db.prepare('SELECT undo_payload FROM action_history WHERE id=?').get(f.history.id).undo_payload)
    return f.undo.resolveUndoApplier(pointer).run(pointer, { env: {}, user, direction, historyId: f.history.id, generation })
  }
  f.state = () => JSON.stringify({ products: d1.db.prepare('SELECT * FROM products ORDER BY id').all(),
    stock: d1.db.prepare('SELECT * FROM branch_stock ORDER BY id').all(),
    snapshots: d1.db.prepare('SELECT * FROM undo_snapshots ORDER BY id').all(),
    history: d1.db.prepare('SELECT * FROM action_history ORDER BY id').all(),
    audits: d1.db.prepare('SELECT * FROM audit_logs ORDER BY id').all(),
    promotions: d1.db.prepare('SELECT * FROM promotion_rules ORDER BY id').all(),
    batches: d1.db.prepare('SELECT * FROM product_batches ORDER BY id').all(),
    batchStock: d1.db.prepare('SELECT * FROM branch_batch_stock ORDER BY id').all() })
  return f
}

async function main() {
  for (const delayed of [true, false]) {
    const f = await setup()
    const fingerprints = f.d1.db.prepare("SELECT id,json_extract(payload_json,'$.mergedStateFingerprint') fp FROM undo_snapshots WHERE kind='product.merge.group.child' ORDER BY id").all()
    if (delayed) await pause()
    for (let i = 0; i < 3; i++) {
      const result = await f.run('undo', 0)
      assert.equal(result.complete, i === 2)
      assert.equal(result.pending_children, 2 - i)
      assert.equal(f.d1.db.prepare('SELECT is_active FROM products WHERE id=?').get(10003 - i).is_active, 1)
      if (i < 2) {
        const prior = JSON.parse(f.d1.db.prepare("SELECT payload_json FROM undo_snapshots WHERE kind='product.merge.group.child' AND status='applied' ORDER BY id DESC LIMIT 1").get().payload_json)
        assert.equal(await f.undo.mergeStateFingerprint(f.db, [prior]), prior.mergedStateFingerprint,
          'restored predecessor matches the complete original fingerprint including timestamps')
      }
      if (delayed) await pause()
    }
    assert.deepEqual(f.d1.db.prepare("SELECT id,json_extract(payload_json,'$.mergedStateFingerprint') fp FROM undo_snapshots WHERE kind='product.merge.group.child' ORDER BY id").all(), fingerprints,
      'undo never rewrites or excludes fields from a saved fingerprint')
    assert.equal((await f.run('undo', 0)).processed_children, 0, 'lost terminal response retry is harmless')
    for (let i = 0; i < 3; i++) {
      assert.equal((await f.run('redo', 1)).complete, i === 2)
      if (delayed) await pause()
    }
    if (delayed) await pause()
    for (let i = 0; i < 3; i++) assert.equal((await f.run('undo', 2)).complete, i === 2)
    assert.equal(f.d1.db.prepare('SELECT SUM(quantity) q FROM branch_stock').get().q, 7)
    assert.equal(f.d1.db.prepare('SELECT parent_id FROM products WHERE id=10004').get().parent_id, 10001)
    assert.equal(f.d1.db.prepare('SELECT product_ids FROM promotion_rules').get().product_ids, '[10001,10002,10003]')
    console.log(`PASS ${delayed ? 'delayed >1s' : 'immediate'} three-child undo/redo/undo ordering and retry`)
  }
  for (const mutation of ["name='External edit'", "updated_at='2099-01-01 00:00:00'"]) {
    const f = await setup()
    await f.run('undo', 0)
    f.d1.db.prepare(`UPDATE products SET ${mutation} WHERE id=10000`).run()
    const before = f.state()
    await assert.rejects(() => f.run('undo', 0), /later stock or batch activity/)
    assert.equal(f.state(), before)
  }
  {
    const f = await setup()
    const before = f.state()
    f.controls.beforeNextWriteBatch = () => { f.controls.failNextBatch = true }
    await assert.rejects(() => f.run('undo', 0), /missing_atomic_guard/)
    assert.equal(f.state(), before, 'failed transaction rolls back timestamps, graph, receipts and audit')
    await pause()
    for (let i = 0; i < 3; i++) assert.equal((await f.run('undo', 0)).complete, i === 2)
  }
  for (const mutation of ["name='Concurrent edit'", "updated_at='2099-01-01 00:00:00'"]) {
    const f = await setup()
    let expected
    f.controls.beforeNextWriteBatch = () => {
      f.d1.db.prepare(`UPDATE products SET ${mutation} WHERE id=10000`).run()
      expected = f.state()
    }
    await assert.rejects(() => f.run('undo', 0), /changed concurrently/)
    assert.equal(f.state(), expected, 'atomic timestamp restoration cannot overwrite a racing real edit')
  }
  {
    const f = await setup()
    const child = f.d1.db.prepare("SELECT id,payload_json FROM undo_snapshots WHERE kind='product.merge.group.child' ORDER BY id DESC LIMIT 1").get()
    const reversal = JSON.parse(child.payload_json)
    reversal.keeperPricingBefore.cost_price_usd = 999
    f.d1.db.prepare('UPDATE undo_snapshots SET payload_json=? WHERE id=?').run(JSON.stringify(reversal), child.id)
    const before = f.state()
    await assert.rejects(() => f.run('undo', 0), /changed concurrently/)
    assert.equal(f.state(), before, 'post-undo exact non-time guard rejects incorrect restoration and rolls back')
  }
  console.log('PASS external field/timestamp conflict, atomic rollback and delayed retry')
}
main().catch((error) => { console.error(error); process.exit(1) })
