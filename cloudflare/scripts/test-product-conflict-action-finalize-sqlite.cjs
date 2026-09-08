const assert = require('node:assert/strict')
const { loadRoute, seed, post } = require('./test-product-conflict-action-groups-sqlite.cjs')

async function finalize(app, reviewId, body, user = { id: 900, username: 'reviewer' }, pathReviewId = reviewId) {
  return app.posts.get('/possible-duplicates/merge-batch/reviews/:reviewId/finalize')({
    env: {}, req: { json: async () => body, param: () => pathReviewId }, get: () => user,
    json: (payload, status = 200) => ({ status, body: payload }),
  })
}

function resolution(group, choices = {}) {
  const [left] = group.member_ids
  return {
    group_key: group.group_key, keeper_id: choices.keeper_id ?? left,
    barcode: choices.barcode ?? { mode: 'canonical' },
    category_source_id: choices.category_source_id ?? left,
    brand_source_id: choices.brand_source_id ?? left,
    unit_source_id: choices.unit_source_id ?? left,
  }
}

async function createReview(app, groups, requestId) {
  const response = await post(app, {
    manifest_version: 1, resolution_version: 2, client_request_id: requestId, merge_groups: groups, remove_rows: [],
  })
  assert.equal(response.status, 200)
  return response.body
}

async function main() {
  let scaleEvidence = null
  const { d1, groups } = seed(2)
  d1.db.prepare("UPDATE product_batches SET batch_key='receipt-a' WHERE id=99002").run()
  const { app, controls } = loadRoute(d1)
  const review = await createReview(app, groups, 'finalize_review_001')
  const request = {
    manifest_version: 1, resolution_version: 2, review_id: review.review_id, draft_digest: review.draft_digest,
    resolutions: [
      resolution(groups[0], {
        keeper_id: 10000, barcode: { mode: 'member', source_product_id: 10001 },
        category_source_id: 10001, brand_source_id: 10000, unit_source_id: 10001,
      }),
      resolution(groups[1]),
    ],
  }
  const response = await finalize(app, review.review_id, request)
  assert.equal(response.status, 200)
  assert.equal(response.body.status, 'finalized')
  assert.match(response.body.manifest_digest, /^sha256-[0-9a-f]{64}$/)
  assert.deepEqual(response.body.counts, {
    requested_groups: 2, canonical_groups: 2, ready_groups: 2, blocked_groups: 0, total_members: 4, merge_folds: 2,
  })
  const storedReview = d1.db.prepare('SELECT status,finalize_digest,manifest_digest,finalized_at FROM product_conflict_action_reviews WHERE id=?').get(review.review_id)
  assert.equal(storedReview.status, 'finalized')
  assert.equal(storedReview.manifest_digest, response.body.manifest_digest)
  assert.ok(storedReview.finalize_digest)
  assert.ok(storedReview.finalized_at)
  const storedGroups = d1.db.prepare('SELECT group_key,status,resolution_json,final_plan_json,operation_id FROM product_conflict_action_groups WHERE review_id=? ORDER BY ordinal').all(review.review_id)
  assert.deepEqual(storedGroups.map((row) => row.status), ['ready', 'ready'])
  const firstPlan = JSON.parse(storedGroups[0].final_plan_json)
  assert.equal(firstPlan.authority, 'reviewed_product_conflict_v2')
  assert.equal(firstPlan.keeper_id, 10000)
  assert.equal(firstPlan.selected.barcode.value, '700000')
  assert.equal(firstPlan.selected.category.value, 'B')
  assert.equal(firstPlan.selected.brand.value, 'One')
  assert.equal(firstPlan.selected.unit.value, 'box')
  assert.equal(firstPlan.projected_result.economics.cost_price_usd, 5)
  assert.equal(firstPlan.projected_result.economics.selling_price_usd, 9)
  assert.equal(firstPlan.projected_result.economics.wholesale_price_usd, 8)
  assert.deepEqual(firstPlan.projected_result.lot_dispositions.map((row) => ({
    source: row.source_batch_id, target: row.target_batch_id, collision: row.collision,
    supplier: row.supplier_name, received: row.received_at,
  })), [{ source: 99002, target: 99001, collision: 'fold', supplier: 'Supplier B', received: '2026-09-02' }])
  const members = d1.db.prepare('SELECT product_id,role,status,operation_id FROM product_conflict_action_group_members WHERE review_id=? ORDER BY product_id').all(review.review_id)
  assert.deepEqual(members.map((row) => row.role), ['keeper', 'merged', 'merged', 'keeper'])
  assert.ok(members.filter((row) => row.role === 'merged').every((row) => row.status === 'planned' && row.operation_id))
  assert.ok(members.filter((row) => row.role === 'keeper').every((row) => row.status === 'planned' && row.operation_id == null))

  const replay = await finalize(app, review.review_id, request)
  assert.equal(replay.status, 200)
  assert.equal(replay.body.manifest_digest, response.body.manifest_digest)
  const changedRequest = structuredClone(request)
  changedRequest.resolutions[0].category_source_id = 10000
  const changedReplay = await finalize(app, review.review_id, changedRequest)
  assert.equal(changedReplay.status, 409)
  assert.equal(changedReplay.body.code, 'finalized_conflict')
  d1.db.prepare("UPDATE product_conflict_action_reviews SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(review.review_id)
  assert.equal((await finalize(app, review.review_id, request)).status, 200, 'draft expiry must not erase a finalized manifest replay')
  const mismatch = await finalize(app, review.review_id, request, undefined, '123e4567-e89b-42d3-a456-426614174000')
  assert.equal(mismatch.status, 400)
  assert.equal(mismatch.body.code, 'review_id_mismatch')

  {
    const { d1: staleDb, groups: staleGroups } = seed(1)
    const { app: staleApp } = loadRoute(staleDb)
    const staleReview = await createReview(staleApp, staleGroups, 'finalize_stale_001')
    staleDb.db.prepare("UPDATE products SET brand='Concurrent',updated_at='2026-09-08 02:00:00' WHERE id=10001").run()
    const stale = await finalize(staleApp, staleReview.review_id, {
      manifest_version: 1, resolution_version: 2, review_id: staleReview.review_id, draft_digest: staleReview.draft_digest,
      resolutions: [resolution(staleGroups[0])],
    })
    assert.equal(stale.status, 409)
    assert.equal(stale.body.code, 'review_state_conflict')
    assert.equal(staleDb.db.prepare('SELECT status FROM product_conflict_action_reviews WHERE id=?').get(staleReview.review_id).status, 'draft')
    assert.equal(staleDb.db.prepare('SELECT COUNT(*) n FROM product_conflict_action_groups WHERE review_id=? AND final_plan_json IS NOT NULL').get(staleReview.review_id).n, 0)
  }

  {
    const { d1: scaleDb, groups: scaleGroups } = seed(1600)
    const { app: scaleApp, controls: scaleControls } = loadRoute(scaleDb)
    const scaleReview = await createReview(scaleApp, scaleGroups, 'finalize booking scale 001'.replaceAll(' ', '_'))
    Object.assign(scaleControls, { statements: 0, maxBindings: 0, maxCompoundTerms: 0, maxBatchStatements: 0 })
    const scale = await finalize(scaleApp, scaleReview.review_id, {
      manifest_version: 1, resolution_version: 2, review_id: scaleReview.review_id, draft_digest: scaleReview.draft_digest,
      resolutions: scaleGroups.map((group) => resolution(group)),
    })
    assert.equal(scale.status, 200)
    assert.equal(scale.body.counts.canonical_groups, 1600)
    assert.equal(scale.body.counts.merge_folds, 1600)
    assert.ok(scaleControls.statements <= 700, `finalize used ${scaleControls.statements} statements`)
    assert.ok(scaleControls.maxBindings <= 80)
    assert.ok(scaleControls.maxCompoundTerms <= 5)
    assert.ok(scaleControls.maxBatchStatements < 100, `finalize batch used ${scaleControls.maxBatchStatements} statements`)
    scaleEvidence = { statements: scaleControls.statements, maxBindings: scaleControls.maxBindings,
      maxCompoundTerms: scaleControls.maxCompoundTerms, maxBatchStatements: scaleControls.maxBatchStatements }
  }

  {
    const { d1: imageDb, groups: imageGroups } = seed(1)
    imageDb.db.prepare("INSERT INTO product_images(product_id,image_path,sort_order) VALUES(10000,'/uploads/member.jpg',0)").run()
    const { app: imageApp } = loadRoute(imageDb)
    const imageReview = await createReview(imageApp, imageGroups, 'finalize_image_001')
    const imageRequest = {
      manifest_version: 1, resolution_version: 2, review_id: imageReview.review_id, draft_digest: imageReview.draft_digest,
      resolutions: [resolution(imageGroups[0])],
    }
    const denied = await finalize(imageApp, imageReview.review_id, imageRequest, { id: 900, username: 'reviewer', noImage: true })
    assert.equal(denied.status, 403)
    assert.equal(denied.body.code, 'image_permission_required')
    assert.equal(imageDb.db.prepare('SELECT status FROM product_conflict_action_reviews WHERE id=?').get(imageReview.review_id).status, 'draft')
    assert.equal((await finalize(imageApp, imageReview.review_id, imageRequest)).status, 200)
  }

  {
    const { d1: atomicDb, groups: atomicGroups } = seed(1)
    const { app: atomicApp, controls: atomicControls } = loadRoute(atomicDb)
    const atomicReview = await createReview(atomicApp, atomicGroups, 'finalize_atomic_001')
    atomicControls.failNextBatch = true
    const atomic = await finalize(atomicApp, atomicReview.review_id, {
      manifest_version: 1, resolution_version: 2, review_id: atomicReview.review_id, draft_digest: atomicReview.draft_digest,
      resolutions: [resolution(atomicGroups[0])],
    })
    assert.equal(atomic.status, 409)
    assert.equal(atomic.body.code, 'review_state_conflict')
    assert.equal(atomicDb.db.prepare('SELECT status FROM product_conflict_action_reviews WHERE id=?').get(atomicReview.review_id).status, 'draft')
    assert.equal(atomicDb.db.prepare('SELECT COUNT(*) n FROM product_conflict_action_groups WHERE review_id=? AND final_plan_json IS NOT NULL').get(atomicReview.review_id).n, 0)
  }

  assert.ok(controls.maxBindings <= 80)
  assert.ok(controls.maxCompoundTerms <= 5)
  assert.ok(controls.statements <= 700)
  assert.ok(controls.maxBatchStatements < 100)
  console.log('product conflict action finalize sqlite: checks passed; ordinary ' + controls.statements + ' statements, '
    + controls.maxBindings + ' bindings, ' + controls.maxCompoundTerms + ' compound terms; 1600-group finalize '
    + JSON.stringify(scaleEvidence))
}

main().catch((error) => { console.error(error); process.exit(1) })
