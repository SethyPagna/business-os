'use strict'
// Reviewed group merge, migration 0313 and the lazy live read, through the real routes and the real undo applier (SQLite).
// The graph guard compares the saved receipt exactly. Only after a guard has refused is the live graph read, to see whether 0313's cost rounding alone
// moved it. Three things are pinned here, each caught by a mutant the other tests let through:
//   1. the normal paths make NO live read: D1 calls and statements of a group undo, a group redo and an apply resume are exact (an eager read, or a
//      redo preflight that cost a round trip, goes red);
//   2. the apply path's reconcile of a committed fold whose history receipt was lost (history_pending) takes the same lazy retry, so a resume after
//      0313 completes instead of staying pending;
//   3. the retry runs once and the rounded paths stay bounded.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
const { loadRoute, seed, post } = require('./test-product-conflict-action-groups-sqlite.cjs')

const text0313 = fs.readFileSync(path.join(__dirname, '../migrations/0313_cost_4dp_repair.sql'), 'utf8')
const user = { id: 900, username: 'reviewer' }
let counter = 0

function third(db) {
  seedStockFixture(db, () => db.prepare(`INSERT INTO products
    (id,name,name_key,barcode,category,brand,unit,is_active,is_group,stock_quantity,cost_price_usd,cost_price_khr,
     selling_price_usd,selling_price_khr,wholesale_price_usd,wholesale_price_khr,updated_at)
    VALUES(10002,'Third','third','000700000','C','Three','pack',1,0,4,8,0,10,0,9,0,'2026-09-08 01:00:00')`).run())
  seedStockFixture(db, () => db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(10002,1,4)').run())
  seedStockFixture(db, () => db.prepare(`INSERT INTO product_batches
    (id,variant_product_id,batch_key,lot_code,expiry_date,received_at,is_active,notes,batch_number,supplier_id,supplier_name,
     unit_cost_usd,payment_status,credit_due_date,received_quantity,received_branch_id,received_cost_usd)
    VALUES(99003,10002,'receipt-b','LOT-C','2027-03-01','2026-09-03',1,'third receipt',1,43,'Supplier C',8,'paid',NULL,4,1,32)`).run())
  seedStockFixture(db, () => db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(99003,1,4)').run())
}

// Each prepare().get/all/run is one D1 call, each db.batch is one call of N statements (the project's own rule for the 50-per-invocation limit).
function meter(f) {
  const m = { calls: 0, statements: 0 }
  const realPrepare = f.db.prepare.bind(f.db), realBatch = f.db.batch.bind(f.db)
  f.db.prepare = (sql) => {
    const s = realPrepare(sql)
    const wrap = (k) => (p) => { m.calls += 1; m.statements += 1; return s[k](p) }
    return { get: wrap('get'), all: wrap('all'), run: wrap('run') }
  }
  f.db.batch = async (statements) => { m.calls += 1; m.statements += statements.length; return realBatch(statements) }
  return { reset: () => { m.calls = 0; m.statements = 0 }, snap: () => [m.calls, m.statements], suspend: () => { f.db.prepare = realPrepare; f.db.batch = realBatch } }
}

async function finalizeApply(f, groups, beforeApply = null) {
  counter += 1
  const preview = await post(f.app, { manifest_version: 1, resolution_version: 2, client_request_id: `retry_paths_${counter}`, merge_groups: groups, remove_rows: [] })
  assert.equal(preview.status, 200, `preview ${JSON.stringify(preview.body).slice(0, 300)}`)
  const review = preview.body
  const final = await f.app.posts.get('/possible-duplicates/merge-batch/reviews/:reviewId/finalize')({ env: {}, get: () => user, req: { param: () => review.review_id, json: async () => ({
    manifest_version: 1, resolution_version: 2, review_id: review.review_id, draft_digest: review.draft_digest,
    resolutions: [{ group_key: groups[0].group_key, keeper_id: 10000, barcode: { mode: 'canonical' }, category_source_id: 10000, brand_source_id: 10000, unit_source_id: 10000 }] }) },
    json: (body, status = 200) => ({ body, status }) })
  assert.equal(final.status, 200, `finalize ${JSON.stringify(final.body).slice(0, 300)}`)
  const restore = beforeApply ? beforeApply() : null
  let applied
  try { applied = await f.app.posts.get('/possible-duplicates/merge-batch')({ env: {}, get: () => user, executionCtx: { waitUntil() {} },
    req: { json: async () => ({ review_id: review.review_id, manifest_digest: final.body.manifest_digest, client_request_id: review.review_id }) }, json: (body, status = 200) => ({ body, status }) }) } finally { if (restore) restore() }
  return { applied, review, final }
}
const resume = (f, a) => f.app.posts.get('/possible-duplicates/merge-batch')({ env: {}, get: () => user, executionCtx: { waitUntil() {} },
  req: { json: async () => ({ review_id: a.review.review_id, manifest_digest: a.final.body.manifest_digest, client_request_id: a.review.review_id }) }, json: (body, status = 200) => ({ body, status }) })

async function step(f, d1, direction) {
  const h = d1.db.prepare("SELECT id, undo_payload, redo_payload FROM action_history WHERE json_extract(undo_payload,'$.applier')='product.merge.group'").get()
  const p = JSON.parse(direction === 'undo' ? h.undo_payload : h.redo_payload)
  const generation = Number(d1.db.prepare('SELECT reversal_generation g FROM product_conflict_action_groups').get().g)
  try { const r = await f.undo.resolveUndoApplier(p).run(p, { env: {}, user, direction, historyId: h.id, generation }); return { ok: true, complete: r.complete } }
  catch (error) { return { ok: false, error } }
}

const KHR_1 = 'UPDATE products SET cost_price_khr = 24600.123456 WHERE id = 10001'
const LOT_1 = 'UPDATE product_batches SET unit_cost_usd = 6.123456 WHERE id = 99002'

async function normalWorld(label, members, pre) {
  const { d1, groups } = seed(1)
  if (members === 3) third(d1.db)
  groups[0].member_ids = members === 3 ? [10000, 10001, 10002] : [10000, 10001]
  if (pre) seedStockFixture(d1.db, () => d1.db.exec(pre))
  const f = { d1, ...loadRoute(d1, true) }
  const a = await finalizeApply(f, groups)
  assert.equal(a.applied.body.status, 'completed', label)
  const m = meter(f)
  const out = { undo: [], redo: [] }
  for (const direction of ['undo', 'redo']) {
    for (let i = 0; i < members - 1; i += 1) {
      m.reset()
      const r = await step(f, d1, direction)
      assert.ok(r.ok, `${label}: ${direction} ${r.error && r.error.message}`)
      out[direction].push(m.snap())
      if (r.complete) break
    }
  }
  m.suspend()
  return out
}

async function interruptedWorld(label, { pre = null, run0313 = false, lostReconcile = false, between = null } = {}) {
  const { d1, groups } = seed(1)
  third(d1.db)
  groups[0].member_ids = [10000, 10001, 10002]
  if (pre) seedStockFixture(d1.db, () => d1.db.exec(pre))
  const f = { d1, ...loadRoute(d1, true) }
  const hook = lostReconcile
    // The fold commits and its history receipt is lost: the member stays history_pending until a later request reconciles it.
    ? () => { const real = f.db.batch; let lost = false
      f.db.batch = async (sts) => { if (!lost && sts.some((s) => /product_conflict_history_guard/.test(s.sql))) { lost = true; throw new Error('injected: the history receipt batch was lost') } return real(sts) }
      return () => { f.db.batch = real } }
    // A time budget that runs out right after the first fold commits.
    : () => { const realNow = Date.now, baseNow = realNow(); let committed = false; f.controls.beforeNextWriteBatch = () => { committed = true }; Date.now = () => baseNow + (committed ? 19000 : 0); return () => { Date.now = realNow } }
  const a = await finalizeApply(f, groups, hook)
  const pending = d1.db.prepare("SELECT status FROM product_conflict_action_group_members WHERE role='merged' ORDER BY product_id").all().map((r) => r.status)
  if (run0313) d1.db.exec(text0313)
  if (between) seedStockFixture(d1.db, () => d1.db.exec(between))
  const m = meter(f)
  m.reset()
  const again = await resume(f, a)
  const counts = m.snap()
  m.suspend()
  const members = d1.db.prepare("SELECT status FROM product_conflict_action_group_members WHERE role='merged' ORDER BY product_id").all().map((r) => r.status)
  return { label, d1, f, a, pending, again, counts, members, first: a.applied.body }
}

async function main() {
  // 1. Normal paths: exact D1 calls / statements (measured at 7aa09848b, the tip before this lane's redo preflight; the preflight reuses the redo's own read).
  const two = await normalWorld('2-member normal', 2, null)
  assert.deepEqual(two.undo, [[9, 53]], '2-member group undo calls/statements')
  assert.deepEqual(two.redo, [[16, 98]], '2-member group redo calls/statements')
  const twoLong = await normalWorld('2-member, long KHR, no 0313', 2, KHR_1)
  assert.deepEqual(twoLong.undo, [[9, 53]], 'a long cost with no 0313 reads nothing live (undo)')
  assert.deepEqual(twoLong.redo, [[16, 98]], 'a long cost with no 0313 reads nothing live (redo)')
  const three = await normalWorld('3-member normal', 3, null)
  assert.deepEqual(three.undo, [[9, 58], [9, 53]], '3-member group undo calls/statements')
  assert.deepEqual(three.redo, [[16, 95], [18, 108]], '3-member group redo calls/statements')

  // Apply resume after an interruption: the normal path.
  const a1 = await interruptedWorld('A1 resume after the time budget, nothing long')
  assert.equal(a1.again.status, 200, JSON.stringify(a1.again.body).slice(0, 300))
  assert.equal(a1.again.body.status, 'completed', JSON.stringify(a1.again.body).slice(0, 300))
  assert.deepEqual(a1.members, ['undo_ready', 'undo_ready'])
  assert.deepEqual(a1.counts, [32, 139], 'apply resume calls/statements (an eager live read before the fold is red)')
  const a1b = await interruptedWorld('A1b resume, a long cost but no 0313', { pre: KHR_1 })
  assert.equal(a1b.again.body.status, 'completed')
  assert.deepEqual(a1b.counts, [32, 139], 'a long cost with no 0313 reads nothing live (resume)')

  // The same resume after 0313 completes, with the one bounded retry.
  const a2 = await interruptedWorld('A2 resume after the time budget, a lot long, 0313 between', { pre: LOT_1, run0313: true })
  assert.equal(a2.again.body.status, 'completed', JSON.stringify(a2.again.body).slice(0, 300))
  assert.deepEqual(a2.members, ['undo_ready', 'undo_ready'])
  assert.ok(a2.counts[0] > 32 && a2.counts[0] <= 50, `rounded resume stays bounded: ${a2.counts}`)

  // 2. A committed fold whose history receipt was lost, then 0313, then the resume: the reconcile takes the lazy retry too.
  const control = await interruptedWorld('R0 lost receipt, nothing long, no 0313', { lostReconcile: true })
  assert.deepEqual(control.pending, ['history_pending', 'planned'], 'the first fold committed and is waiting for its receipt')
  assert.equal(control.again.body.status, 'completed', JSON.stringify(control.again.body).slice(0, 300))
  assert.deepEqual(control.members, ['undo_ready', 'undo_ready'])
  assert.deepEqual(control.counts, [42, 175], 'a lost-receipt resume with nothing rounded reads nothing live (an eager read in the reconcile is red)')
  for (const [label, pre] of [['a lot long', LOT_1], ['the duplicate KHR long', KHR_1]]) {
    const r = await interruptedWorld(`R1 lost receipt, ${label}, 0313 between`, { pre, run0313: true, lostReconcile: true })
    assert.deepEqual(r.pending, ['history_pending', 'planned'], `${label}: the first fold committed and is waiting for its receipt`)
    assert.equal(r.again.status, 200, `${label}: ${JSON.stringify(r.again.body).slice(0, 300)}`)
    assert.equal(r.again.body.status, 'completed', `${label}: the reconcile accepts 0313's rounding: ${JSON.stringify(r.again.body).slice(0, 300)}`)
    assert.deepEqual(r.members, ['undo_ready', 'undo_ready'], `${label}: both folds finalized`)
    console.log(`R1 ${label}: resume calls/statements ${r.counts} (control without 0313: ${control.counts})`)
    assert.ok(r.counts[0] <= control.counts[0] + 20, `${label}: the retry is one bounded extra read and commit, got ${r.counts} against ${control.counts}`)
  }
  // A real change since the lost receipt is still refused: the member stays pending, nothing is finalized.
  const real = await interruptedWorld('R2 lost receipt, 0313, then a real change', { pre: LOT_1, run0313: true, lostReconcile: true, between: "UPDATE products SET name = 'Changed' WHERE id = 10001" })
  assert.deepEqual(real.pending, ['history_pending', 'planned'])
  assert.notEqual(real.again.body.status, 'completed', 'a real change next to 0313 is not completed')
  assert.equal(real.members[0], 'history_pending', 'the first fold is not finalized over a real change')
  console.log('product merge 0313 retry paths: counts pinned, lost-receipt reconcile retries once')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
