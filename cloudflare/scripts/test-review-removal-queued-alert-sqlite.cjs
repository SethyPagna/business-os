// A product removal queued by the conflict-review flow announces itself once ("Review requested"), and only when a
// pending row was written by this request. The real routes/products.ts runs against a real SQLite schema (the same
// harness as test-product-conflict-action-apply-sqlite.cjs); the alert hook is replaced by a recorder, so nothing is sent.
const assert = require('node:assert/strict')
const { loadRoute, seed, post } = require('./test-product-conflict-action-groups-sqlite.cjs')

const HOOK = Symbol.for('business-os.review-alert.v1')
const announced = []
globalThis[HOOK] = { announce: async (_env, event) => { announced.push(event) }, nameBeforeChange: async () => null }

const requester = { id: 900, username: 'requester', noMerge: true, reviewDelete: true }
const fullTier = { id: 901, username: 'owner', noMerge: true }

function emptyStock(d1, ids) {
  const selected = JSON.stringify(ids)
  d1.db.prepare('UPDATE damaged_stock_lots SET quantity_remaining=0 WHERE product_id IN (SELECT value FROM json_each(?))').run(selected)
  d1.db.prepare('UPDATE branch_batch_stock SET quantity=0 WHERE batch_id IN (SELECT id FROM product_batches WHERE variant_product_id IN (SELECT value FROM json_each(?)))').run(selected)
  d1.db.prepare('UPDATE branch_stock SET quantity=0 WHERE product_id IN (SELECT value FROM json_each(?))').run(selected)
  d1.db.prepare('UPDATE products SET stock_quantity=0 WHERE id IN (SELECT value FROM json_each(?))').run(selected)
}

async function review(app, id, productIds, actor) {
  const made = await post(app, { manifest_version: 1, resolution_version: 2, client_request_id: id, merge_groups: [],
    remove_rows: productIds.map((product_id, index) => ({ product_id, reason: `Remove row ${index + 1}` })) }, actor)
  assert.equal(made.status, 200, JSON.stringify(made.body))
  const finalized = await app.posts.get('/possible-duplicates/merge-batch/reviews/:reviewId/finalize')({
    env: {}, get: () => actor,
    req: { json: async () => ({ manifest_version: 1, resolution_version: 2, review_id: made.body.review_id, draft_digest: made.body.draft_digest, resolutions: [] }),
      param: () => made.body.review_id },
    json: (body, status = 200) => ({ status, body }),
  })
  assert.equal(finalized.status, 200, JSON.stringify(finalized.body))
  const apply = () => app.posts.get('/possible-duplicates/merge-batch')({
    env: {}, get: () => actor,
    req: { json: async () => ({ review_id: made.body.review_id, manifest_digest: finalized.body.manifest_digest, client_request_id: made.body.review_id }) },
    json: (body, status = 200) => ({ status, body }),
    executionCtx: { waitUntil: () => {} },
  })
  return { apply }
}

async function main() {
  const expectedRow = (productId) => ({ section: 'products', action_type: 'delete', entity_type: 'product', entity_id: productId, payload_json: '{}', requested_by_name: 'requester' })

  {
    const { d1 } = seed(1)
    emptyStock(d1, [10000])
    const loaded = loadRoute(d1, true)
    const { apply } = await review(loaded.app, 'removal_alert_single_001', [10000], requester)
    const queued = await apply()
    assert.equal(queued.status, 200, JSON.stringify(queued.body))
    assert.equal(queued.body.status, 'approval_pending')
    assert.equal(d1.db.prepare("SELECT COUNT(*) n FROM pending_actions WHERE status='open'").get().n, 1)
    assert.deepEqual(announced, [{ kind: 'created', row: expectedRow(10000) }], 'one "created" event for the one queued removal, naming the requester by username')
    const replay = await apply()
    assert.equal(replay.status, 200)
    assert.deepEqual(replay.body.removals, [])
    assert.equal(announced.length, 1, 'a lost-response replay queues nothing and announces nothing')
    console.log('PASS conflict-review removal: one alert when queued, none on replay')
  }

  {
    announced.length = 0
    const { d1 } = seed(7)
    const ids = Array.from({ length: 13 }, (_, index) => 10000 + index)
    emptyStock(d1, ids)
    const loaded = loadRoute(d1, true)
    const { apply } = await review(loaded.app, 'removal_alert_thirteen_001', ids, requester)
    const first = await apply()
    assert.equal(first.body.removals.length, 12, JSON.stringify(first.body))
    assert.equal(announced.length, 12, 'one event per removal queued in the first pass')
    const second = await apply()
    assert.equal(second.body.removals.length, 1)
    assert.equal(announced.length, 13, 'the continuation announces only the one it queued')
    const replay = await apply()
    assert.deepEqual(replay.body.removals, [])
    assert.equal(announced.length, 13)
    assert.deepEqual(announced.map((event) => event.row.entity_id).sort((a, b) => a - b), ids, 'each product exactly once')
    assert.ok(announced.every((event) => event.kind === 'created' && event.row.requested_by_name === 'requester'))
    console.log('PASS conflict-review removals: thirteen queued across two passes, thirteen events, none repeated')
  }

  {
    announced.length = 0
    const { d1 } = seed(1)
    emptyStock(d1, [10000])
    const loaded = loadRoute(d1, true)
    const { apply } = await review(loaded.app, 'removal_alert_full_tier_001', [10000], fullTier)
    const applied = await apply()
    assert.equal(applied.status, 200, JSON.stringify(applied.body))
    assert.equal(d1.db.prepare("SELECT COUNT(*) n FROM pending_actions").get().n, 0, 'a Full-tier removal queues nothing')
    assert.equal(announced.length, 0, 'and so announces nothing')
    console.log('PASS conflict-review removal by a Full-tier user: nothing queued, nothing announced')
  }

  {
    announced.length = 0
    delete globalThis[HOOK]
    const { d1 } = seed(1)
    emptyStock(d1, [10000])
    const loaded = loadRoute(d1, true)
    const { apply } = await review(loaded.app, 'removal_alert_no_hook_001', [10000], requester)
    const queued = await apply()
    assert.equal(queued.status, 200, JSON.stringify(queued.body))
    assert.equal(queued.body.status, 'approval_pending', 'without the hook the removal is queued exactly as before')
    console.log('PASS conflict-review removal without the alert hook: unchanged')
  }

  {
    globalThis[HOOK] = { announce: async () => { throw new Error('alert machinery down') }, nameBeforeChange: async () => null }
    const { d1 } = seed(1)
    emptyStock(d1, [10000])
    const loaded = loadRoute(d1, true)
    const { apply } = await review(loaded.app, 'removal_alert_throws_001', [10000], requester)
    const queued = await apply()
    assert.equal(queued.status, 200, JSON.stringify(queued.body))
    assert.equal(queued.body.status, 'approval_pending', 'an alert that throws never fails the request that queued the removal')
    assert.equal(d1.db.prepare("SELECT COUNT(*) n FROM pending_actions WHERE status='open'").get().n, 1)
    console.log('PASS conflict-review removal with a throwing alert hook: still queued')
  }

  console.log('review removal queued alert sqlite: conflict-review flow announces once per queued removal')
}

main().catch((error) => { console.error(error); process.exit(1) })
