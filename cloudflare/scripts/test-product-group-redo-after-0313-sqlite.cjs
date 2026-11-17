'use strict'
// Redo of a reviewed GROUP merge after migration 0313 (real routes, real undo applier, the real 0313 file).
// A group redo commits one child per request. The graph guard accepts 0313's cost rounding, so a source compare that stayed exact stopped the redo
// half-way (the children before the rounded member committed, the rounded member's child was refused): Undo refused (completion guard), Apply
// refused (review_reversed), a plain Error answered as HTTP 500 with a raw code. The rule now: a group redo either ends fully redone (status
// complete, data equal to the oracle world that never met 0313) or is refused BEFORE the first child commits, with nothing written, the history
// still redoable and a coded 409 (undo_record_changed). Never partial.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
const { loadRoute, seed, post } = require('./test-product-conflict-action-groups-sqlite.cjs')

const text0313 = fs.readFileSync(path.join(__dirname, '../migrations/0313_cost_4dp_repair.sql'), 'utf8')
const user = { id: 900, username: 'reviewer' }
const IDS = '10000,10001,10002'
const rows = (db, sql) => db.prepare(sql).all().map((r) => ({ ...r }))
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

// Everything a refused redo must leave alone.
const fullDump = (db) => JSON.stringify({
  products: rows(db, `SELECT * FROM products WHERE id IN (${IDS}) ORDER BY id`),
  lots: rows(db, 'SELECT * FROM product_batches ORDER BY id'),
  bs: rows(db, 'SELECT * FROM branch_stock ORDER BY product_id, branch_id'),
  bbs: rows(db, 'SELECT * FROM branch_batch_stock ORDER BY batch_id, branch_id'),
  mv: rows(db, 'SELECT COUNT(*) n, MAX(id) m FROM inventory_movements'),
  hist: rows(db, 'SELECT id, status, reversible, undo_payload, redo_payload FROM action_history ORDER BY id'),
  snaps: rows(db, 'SELECT id, kind, status, payload_json FROM undo_snapshots ORDER BY id'),
  groups: rows(db, 'SELECT * FROM product_conflict_action_groups ORDER BY review_id, ordinal'),
  members: rows(db, 'SELECT * FROM product_conflict_action_group_members ORDER BY review_id, group_ordinal, product_id'),
  audits: rows(db, 'SELECT COUNT(*) n FROM audit_logs'),
})
// The business state a finished redo is compared on (no timestamps, no receipts).
const businessState = (db) => JSON.stringify({
  products: rows(db, `SELECT id,is_active,parent_id,stock_quantity,cost_price_usd,purchase_price_usd,cost_price_khr,purchase_price_khr,selling_price_usd,wholesale_price_usd
    FROM products WHERE id IN (${IDS}) ORDER BY id`),
  lots: rows(db, 'SELECT id,variant_product_id,is_active,unit_cost_usd,received_cost_usd FROM product_batches ORDER BY id'),
  bs: rows(db, 'SELECT product_id,branch_id,quantity FROM branch_stock ORDER BY product_id, branch_id'),
  bbs: rows(db, 'SELECT batch_id,branch_id,quantity FROM branch_batch_stock ORDER BY batch_id, branch_id'),
  members: rows(db, 'SELECT product_id,status FROM product_conflict_action_group_members ORDER BY product_id'),
  group: rows(db, 'SELECT status,reversal_generation FROM product_conflict_action_groups'),
  hist: rows(db, "SELECT status,reversible FROM action_history WHERE json_extract(undo_payload,'$.applier')='product.merge.group'"),
})

async function step(f, d1, direction) {
  const h = d1.db.prepare("SELECT id, undo_payload, redo_payload FROM action_history WHERE json_extract(undo_payload,'$.applier')='product.merge.group'").get()
  const p = JSON.parse(direction === 'undo' ? h.undo_payload : h.redo_payload)
  const generation = Number(d1.db.prepare('SELECT reversal_generation g FROM product_conflict_action_groups').get().g)
  try {
    const out = await f.undo.resolveUndoApplier(p).run(p, { env: {}, user, direction, historyId: h.id, generation })
    return { ok: true, complete: out.complete }
  } catch (error) { return { ok: false, error } }
}
async function stepAll(f, d1, direction) {
  const steps = []
  for (let i = 0; i < 6; i += 1) {
    const r = await step(f, d1, direction)
    steps.push(r)
    if (!r.ok || r.complete) break
  }
  return steps
}

async function applyGroup(d1, f, groups) {
  counter += 1
  const preview = await post(f.app, { manifest_version: 1, resolution_version: 2, client_request_id: `group_redo_0313_${counter}`, merge_groups: groups, remove_rows: [] })
  assert.equal(preview.status, 200, `preview ${JSON.stringify(preview.body).slice(0, 300)}`)
  const review = preview.body
  const final = await f.app.posts.get('/possible-duplicates/merge-batch/reviews/:reviewId/finalize')({ env: {}, get: () => user, req: { param: () => review.review_id, json: async () => ({
    manifest_version: 1, resolution_version: 2, review_id: review.review_id, draft_digest: review.draft_digest,
    resolutions: [{ group_key: groups[0].group_key, keeper_id: 10000, barcode: { mode: 'canonical' }, category_source_id: 10000, brand_source_id: 10000, unit_source_id: 10000 }] }) },
    json: (body, status = 200) => ({ body, status }) })
  assert.equal(final.status, 200, `finalize ${JSON.stringify(final.body).slice(0, 300)}`)
  const applied = await f.app.posts.get('/possible-duplicates/merge-batch')({ env: {}, get: () => user, executionCtx: { waitUntil() {} },
    req: { json: async () => ({ review_id: review.review_id, manifest_digest: final.body.manifest_digest, client_request_id: review.review_id }) }, json: (body, status = 200) => ({ body, status }) })
  assert.equal(applied.body.status, 'completed', `apply ${JSON.stringify(applied.body).slice(0, 300)}`)
}

// pre: SQL before the merge. run0313: the real 0313 after the merge (before undo). afterUndo0313: after the undo (before the redo).
// between: SQL after the undo (and 0313). members: 2 or 3. Returns the redo's steps and what each state looks like.
async function world(label, { members = 3, pre = null, run0313 = false, afterUndo0313 = false, between = null } = {}) {
  const { d1, groups } = seed(1)
  if (members === 3) third(d1.db)
  groups[0].member_ids = members === 3 ? [10000, 10001, 10002] : [10000, 10001]
  if (pre) seedStockFixture(d1.db, () => d1.db.exec(pre))
  const f = { d1, ...loadRoute(d1, true) }
  await applyGroup(d1, f, groups)
  if (run0313) d1.db.exec(text0313)
  const undone = await stepAll(f, d1, 'undo')
  assert.ok(undone.every((s) => s.ok) && undone.at(-1).complete, `${label}: the undo of the whole group completes ${JSON.stringify(undone.map((s) => s.ok ? s.complete : s.error.message))}`)
  if (afterUndo0313) d1.db.exec(text0313)
  if (between) seedStockFixture(d1.db, () => d1.db.exec(between))
  const beforeRedo = fullDump(d1.db)
  const redo = await stepAll(f, d1, 'redo')
  return { label, d1, f, redo, beforeRedo, afterRedo: fullDump(d1.db), state: businessState(d1.db) }
}

const memberStatuses = (d1) => rows(d1.db, "SELECT status FROM product_conflict_action_group_members WHERE role='merged' ORDER BY product_id").map((r) => r.status)
const groupStatus = (d1) => d1.db.prepare('SELECT status FROM product_conflict_action_groups').get().status
const historyRow = (d1) => d1.db.prepare("SELECT status,reversible FROM action_history WHERE json_extract(undo_payload,'$.applier')='product.merge.group'").get()

// NEVER PARTIAL: the world is either fully redone or exactly where the undo left it.
function assertNeverPartial(w) {
  const merged = memberStatuses(w.d1)
  const group = groupStatus(w.d1)
  const failed = w.redo.find((s) => !s.ok)
  if (!failed) {
    assert.equal(w.redo.at(-1).complete, true, `${w.label}: redo reports complete`)
    assert.ok(merged.every((s) => s === 'undo_ready'), `${w.label}: every merged member is redone ${merged}`)
    assert.equal(group, 'completed', `${w.label}: group status`)
    assert.equal(historyRow(w.d1).status, 'undoable', `${w.label}: history is undoable again`)
  } else {
    assert.ok(merged.every((s) => s === 'reversed') && group === 'reversed', `${w.label}: PARTIAL redo: members ${merged}, group ${group}, steps ${w.redo.map((s) => s.ok ? 'ok' : s.error.message).join(' | ')}`)
    assert.equal(w.redo.length, 1, `${w.label}: refused at the first request`)
    assert.equal(w.afterRedo, w.beforeRedo, `${w.label}: a refused redo writes nothing`)
    assert.equal(historyRow(w.d1).status, 'redoable', `${w.label}: the history is still redoable`)
    // A coded 409 the client already translates, not a plain Error (HTTP 500) and not a raw machine code as the sentence.
    assert.equal(failed.error.statusCode, 409, `${w.label}: ${failed.error.message}`)
    assert.equal(failed.error.code, 'undo_record_changed', `${w.label}: code`)
    assert.ok(!/^merge_[a-z_]+$/.test(failed.error.message) && /\s/.test(failed.error.message), `${w.label}: an operator sentence, got "${failed.error.message}"`)
  }
}
const redone = (w) => { assertNeverPartial(w); assert.ok(!w.redo.some((s) => !s.ok), `${w.label}: must complete, got ${w.redo.map((s) => s.ok ? 'ok' : s.error.message)}`); return w }
const refused = (w) => { assertNeverPartial(w); assert.ok(w.redo.some((s) => !s.ok), `${w.label}: must be refused`); return w }

const KHR_2 = 'UPDATE products SET cost_price_khr = 24600.123456 WHERE id = 10002'
const KHR_1 = 'UPDATE products SET cost_price_khr = 24600.123456 WHERE id = 10001'

async function main() {
  // The oracle: the same group with the 4-place cost typed in from the start (0313 has nothing to round), merged, undone, redone.
  const oracle3 = await world('oracle 3-member', { pre: 'UPDATE products SET cost_price_khr = 24600.1235 WHERE id = 10002' })
  redone(oracle3)
  const oracle1 = await world('oracle 3-member, first child', { pre: 'UPDATE products SET cost_price_khr = 24600.1235 WHERE id = 10001' })
  redone(oracle1)
  const oracle2 = await world('oracle 2-member', { members: 2, pre: 'UPDATE products SET cost_price_khr = 24600.1235 WHERE id = 10001' })
  redone(oracle2)

  // The reviewer's worlds. Z4: the long member is the SECOND child (fold position 2); merge and undo before the deploy, 0313, then redo.
  const z4 = redone(await world('Z4 3-member, 10002 KHR long (fold position 2), 0313 between undo and redo', { pre: KHR_2, afterUndo0313: true }))
  assert.equal(z4.state, oracle3.state, 'Z4: data equals the oracle')
  assert.equal(z4.redo.length, 2, 'Z4: a three-member redo is two requests')
  // Z5: the long member is the first child.
  const z5 = redone(await world('Z5 3-member, 10001 KHR long (first child), 0313 between undo and redo', { pre: KHR_1, afterUndo0313: true }))
  assert.equal(z5.state, oracle1.state, 'Z5: data equals the oracle')
  // Z6: a lot only (no product row changes).
  redone(await world('Z6 3-member, 10002 lot long, 0313 between undo and redo', { pre: 'UPDATE product_batches SET unit_cost_usd = 8.123456 WHERE id = 99003', afterUndo0313: true }))
  // Z7: 0313 between merge and undo, a USD cost pair on 10002 (0313's recompute then re-derives it from the lot: more than rounding).
  const z7 = refused(await world('Z7 3-member, 10002 USD pair long, 0313 between merge and undo', { pre: 'UPDATE products SET cost_price_usd = 8.123456, purchase_price_usd = 8.123456 WHERE id = 10002', run0313: true }))
  assert.equal(z7.redo.length, 1, 'Z7: refused before any child commits')

  // Two members (one child) and three members with the long member at each fold position, and both long.
  const two = redone(await world('2-member, 10001 KHR long, 0313 between undo and redo', { members: 2, pre: KHR_1, afterUndo0313: true }))
  assert.equal(two.state, oracle2.state, '2-member: data equals the oracle')
  redone(await world('2-member, 10001 KHR long, 0313 between merge and undo', { members: 2, pre: KHR_1, run0313: true }))
  refused(await world('2-member, USD pair long', { members: 2, pre: 'UPDATE products SET cost_price_usd = 6.123456, purchase_price_usd = 6.123456 WHERE id = 10001', afterUndo0313: true }))
  redone(await world('3-member, both KHR long', { pre: `${KHR_1}; ${KHR_2}`, afterUndo0313: true }))
  redone(await world('3-member, 10002 KHR long, 0313 between merge and undo', { pre: KHR_2, run0313: true }))

  // A real change next to a rounded cost is still a refusal, and still before the first child commits.
  refused(await world('3-member, 10002 KHR long + its selling price changed after the undo', { pre: KHR_2, afterUndo0313: true, between: 'UPDATE products SET selling_price_usd = 11 WHERE id = 10002' }))
  refused(await world('3-member, 10002 KHR long + its cost moved by one tick from the rounding', { pre: KHR_2, afterUndo0313: true, between: 'UPDATE products SET cost_price_khr = 24600.1236 WHERE id = 10002' }))
  refused(await world('3-member, 10002 cost changed by more than rounding after the undo (no 0313)', { between: 'UPDATE products SET cost_price_usd = 9 WHERE id = 10002' }))
  refused(await world('3-member, 10002 selling price changed after the undo (no 0313)', { between: 'UPDATE products SET selling_price_usd = 11 WHERE id = 10002' }))
  // NULL is never the rounding of a saved cost, however small: 0.00004 does not become NULL, a saved NULL never meets a number.
  refused(await world('3-member, saved tiny cost 0.00004 on 10002 is NULL now', { pre: 'UPDATE products SET cost_price_khr = 0.00004 WHERE id = 10002', between: 'UPDATE products SET cost_price_khr = NULL WHERE id = 10002' }))

  // The compare itself, field by field (the same function the fold and the preflight use).
  const { f: probe } = await world('probe', { members: 2 })
  const { reviewedRedoMoneyMatches, productConflictOriginalMemberMatches } = probe.routes
  const plan = (money) => ({ members: [{ id: 5, updated_at: null, money }] })
  const row = (extra) => ({ id: 5, cost_price_usd: 1, cost_price_khr: 0, selling_price_usd: 2, selling_price_khr: 0, wholesale_price_usd: 0, wholesale_price_khr: 0, ...extra })
  const saved = { cost_price_usd: 1, cost_price_khr: 24600.123456, selling_price_usd: 2, selling_price_khr: 0, wholesale_price_usd: 0, wholesale_price_khr: 0 }
  assert.equal(reviewedRedoMoneyMatches(plan(saved), row({ cost_price_khr: 24600.123456 })), true, 'exact')
  assert.equal(reviewedRedoMoneyMatches(plan(saved), row({ cost_price_khr: 24600.1235 })), true, 'a cost stored to 4 places')
  assert.equal(reviewedRedoMoneyMatches(plan(saved), row({ cost_price_khr: 24600.1236 })), false, 'one tick off the rounding')
  assert.equal(reviewedRedoMoneyMatches(plan({ ...saved, cost_price_khr: 24600.1235 }), row({ cost_price_khr: 24600.12351 })), false, 'a saved 4-place cost that now differs')
  assert.equal(reviewedRedoMoneyMatches(plan({ ...saved, selling_price_usd: 9.123456 }), row({ cost_price_khr: 24600.123456, selling_price_usd: 9.1235 })), false, 'a price stays exact')
  assert.equal(reviewedRedoMoneyMatches(plan({ ...saved, cost_price_khr: 0.00004 }), row({ cost_price_khr: null })), false, 'a tiny saved cost is not NULL')
  assert.equal(reviewedRedoMoneyMatches(plan({ ...saved, cost_price_khr: -0.00004 }), row({ cost_price_khr: null })), false, 'a tiny negative saved cost is not NULL')
  assert.equal(reviewedRedoMoneyMatches(plan({ ...saved, cost_price_khr: null }), row({ cost_price_khr: 0.5 })), false, 'a saved NULL is not a number')
  assert.equal(reviewedRedoMoneyMatches(plan({ ...saved, cost_price_usd: 0.00004 }), row({ cost_price_khr: 24600.123456, cost_price_usd: null })), false, 'USD too')
  const detail = (money) => ({ members: [{ id: 5, updated_at: null, name: 'n', barcode: null, category: null, categories: null, brand: null, brands: null, brand_compact: null,
    unit: null, unit_normalized: null, image_path: null, ...money }] })
  const live = (extra) => ({ id: 5, name: 'n', barcode: null, category: null, categories: null, brand: null, brands: null, brand_compact: null, unit: null, unit_normalized: null,
    image_path: null, updated_at: null, is_active: 1, is_group: 0, ...saved, ...extra })
  assert.equal(productConflictOriginalMemberMatches(detail(saved), 5, live({ cost_price_khr: 24600.1235 })), true, 'apply compare: rounding')
  assert.equal(productConflictOriginalMemberMatches(detail({ ...saved, cost_price_khr: 0.00004 }), 5, live({ cost_price_khr: null })), false, 'apply compare: 0.00004 is not NULL')
  assert.equal(productConflictOriginalMemberMatches(detail({ ...saved, cost_price_khr: -0.00004 }), 5, live({ cost_price_khr: null })), false, 'apply compare: -0.00004 is not NULL')
  assert.equal(productConflictOriginalMemberMatches(detail({ ...saved, cost_price_usd: 0.00004 }), 5, live({ cost_price_usd: null })), false, 'apply compare: USD')
  console.log('product group redo after 0313: all worlds redone or refused clean, none partial; compares ok')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
