'use strict'
// cost-4dp r7. Migration 0313 rounds a long cost with HALF_UP_4DP; roundStoredCost (roundMoney4) rounds the decimal the double prints as. They differ on
// near-tie doubles (21.398249999999997 is 21.3982 by one and 21.3983 by the other, about 0.25% of division results), so every guard that asks "is the live
// cost the saved cost rounded?" must accept the live value when it equals EITHER form, and nothing else. Real merge and group routes, the real 0313 file.
//   A  comparator property: fingerprint (G1), graph receipt (G2/G3) and the predecessor row guard (G4, real SQL) over near-ties: R and H accepted, any
//      other value refused
//   B  end to end: 2- and 3-member group merges of near-tie costs, 0313 between, undo completes; control where R equals H; a real change refused
//   C  revision exactness: a no-op UPDATE, an A-B-A edit and a change in a table the graph does not read are refused (0313's own bumps only)
//   D  a 3-member group whose keeper holds a long cost_price_khr completes; resuming an interrupted group after 0313 completes; a real change conflicts
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
const { loadRoute, seed, post, loadTs } = require('./test-product-conflict-action-groups-sqlite.cjs')

const text0313 = fs.readFileSync(path.join(__dirname, '../migrations/0313_cost_4dp_repair.sql'), 'utf8')
const user = { id: 900, username: 'reviewer' }
const ccr = loadTs('lib/catalogCostRecompute.ts', { './db': {} })
const R = ccr.roundStoredCost
const mem = new DatabaseSync(':memory:')
const hStatement = mem.prepare(`SELECT ${ccr.HALF_UP_4DP('?')} AS r`)
const H = (value) => hStatement.get(value).r
const text17 = (value) => mem.prepare("SELECT printf('%!.17g', ?) AS t").get(value).t
const ulp = (x, n) => { const b = new Float64Array([x]); const u = new BigInt64Array(b.buffer); u[0] += BigInt(n); return b[0] }
let seedState = 20261117
const random = () => { seedState = (Math.imul(seedState, 1664525) + 1013904223) >>> 0; return seedState / 4294967296 }

function third(d1) {
  seedStockFixture(d1.db, () => d1.db.prepare(`INSERT INTO products
    (id,name,name_key,barcode,category,brand,unit,is_active,is_group,stock_quantity,cost_price_usd,cost_price_khr,
     selling_price_usd,selling_price_khr,wholesale_price_usd,wholesale_price_khr,updated_at)
    VALUES(10002,'Third','third','000700000','C','Three','pack',1,0,4,8,0,10,0,9,0,'2026-09-08 01:00:00')`).run())
  seedStockFixture(d1.db, () => d1.db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(10002,1,4)').run())
  seedStockFixture(d1.db, () => d1.db.prepare(`INSERT INTO product_batches
    (id,variant_product_id,batch_key,lot_code,expiry_date,received_at,is_active,notes,batch_number,supplier_id,supplier_name,
     unit_cost_usd,payment_status,credit_due_date,received_quantity,received_branch_id,received_cost_usd)
    VALUES(99003,10002,'receipt-b','LOT-C','2027-03-01','2026-09-03',1,'third receipt',1,43,'Supplier C',8,'paid',NULL,4,1,32)`).run())
  seedStockFixture(d1.db, () => d1.db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(99003,1,4)').run())
}
let counter = 0
async function finalizeApply(f, groups, beforeApply = null) {
  counter += 1
  const preview = await post(f.app, { manifest_version: 1, resolution_version: 2, client_request_id: `near_tie_${counter}`, merge_groups: groups, remove_rows: [] })
  assert.equal(preview.status, 200, 'preview ' + JSON.stringify(preview.body).slice(0, 300))
  const review = preview.body
  const final = await f.app.posts.get('/possible-duplicates/merge-batch/reviews/:reviewId/finalize')({ env: {}, get: () => user, req: { param: () => review.review_id, json: async () => ({
    manifest_version: 1, resolution_version: 2, review_id: review.review_id, draft_digest: review.draft_digest,
    resolutions: [{ group_key: groups[0].group_key, keeper_id: 10000, barcode: { mode: 'canonical' }, category_source_id: 10000, brand_source_id: 10000, unit_source_id: 10000 }] }) },
    json: (body, status = 200) => ({ body, status }) })
  assert.equal(final.status, 200, 'finalize ' + JSON.stringify(final.body).slice(0, 300))
  const restore = beforeApply ? beforeApply() : null
  const apply = () => f.app.posts.get('/possible-duplicates/merge-batch')({ env: {}, get: () => user, executionCtx: { waitUntil() {} },
    req: { json: async () => ({ review_id: review.review_id, manifest_digest: final.body.manifest_digest, client_request_id: review.review_id }) }, json: (body, status = 200) => ({ body, status }) })
  let applied
  try { applied = await apply() } finally { if (restore) restore() }
  return { applied, review, final, apply }
}
const dump = (db) => JSON.stringify({
  p: db.prepare('SELECT * FROM products WHERE id IN (10000,10001,10002) ORDER BY id').all().map((r) => ({ ...r })),
  b: db.prepare('SELECT * FROM product_batches WHERE variant_product_id IN (10000,10001,10002) ORDER BY id').all().map((r) => ({ ...r })),
  h: db.prepare('SELECT id,status,reversible,undo_payload FROM action_history ORDER BY id').all().map((r) => ({ ...r })),
  s: db.prepare('SELECT id,status,payload_json FROM undo_snapshots ORDER BY id').all().map((r) => ({ ...r })),
  r: db.prepare('SELECT * FROM stock_session_revisions ORDER BY entity_type, entity_key').all().map((r) => ({ ...r })),
})
async function undoAll(f, d1) {
  const history = d1.db.prepare("SELECT id FROM action_history WHERE json_extract(undo_payload,'$.applier')='product.merge.group'").get()
  const pointer = JSON.parse(d1.db.prepare('SELECT undo_payload FROM action_history WHERE id=?').get(history.id).undo_payload)
  for (let i = 0; i < 5; i += 1) {
    try { const r = await f.undo.resolveUndoApplier(pointer).run(pointer, { env: {}, user, direction: 'undo', historyId: history.id, generation: 0 }); if (r.complete) return { ok: true } }
    catch (error) { return { ok: false, error } }
  }
  return { ok: false, error: new Error('no completion') }
}
// pre: SQL before the merge (long costs); between: SQL after 0313 and before the undo.
async function world(members, pre, { between = null, run0313 = true } = {}) {
  const { d1, groups } = seed(1)
  if (members.length === 3) third(d1)
  groups[0].member_ids = members
  seedStockFixture(d1.db, () => d1.db.exec(pre))
  const f = { d1, ...loadRoute(d1, true) }
  const a = await finalizeApply(f, groups)
  assert.equal(a.applied.body.status, 'completed', 'apply ' + JSON.stringify(a.applied.body).slice(0, 200))
  if (run0313) d1.db.exec(text0313)
  if (between) seedStockFixture(d1.db, () => d1.db.exec(between))
  const before = dump(d1.db)
  const outcome = await undoAll(f, d1)
  return { ...outcome, d1, nothingWritten: dump(d1.db) === before }
}
const refused409 = (w, label) => {
  assert.equal(w.ok, false, label + ' must be refused')
  assert.equal(w.error.code, 'undo_record_changed', label + ': ' + w.error.code + ' ' + w.error.message)
  assert.equal(w.error.statusCode, 409, label)
  assert.equal(w.nothingWritten, true, label + ': a refused undo writes nothing')
}

async function main() {
  // ---------------- A: comparator property ----------------
  const { d1: guardDb } = seed(1)
  const guardUndo = loadRoute(guardDb, true).undo
  guardDb.db.prepare("INSERT INTO undo_snapshots(id, kind, status, payload_json, created_by_id) VALUES(7001, 'product.merge.group.child', 'applied', '{\"p\":1}', 900)").run()
  const liveRow = (id) => ({ ...guardDb.db.prepare('SELECT id, updated_at, cost_price_usd, cost_price_khr, purchase_price_usd, purchase_price_khr, selling_price_usd FROM products WHERE id=?').get(id) })
  const g4 = (saved, live) => {
    seedStockFixture(guardDb.db, () => guardDb.db.prepare('UPDATE products SET cost_price_khr = ? WHERE id = 10000').run(live))
    const keeper = { ...liveRow(10000), cost_price_khr: saved }
    const prior = JSON.stringify({ products: [liveRow(10000)], childProducts: [], promotionRules: [] })
    const child = { id: 7002, status: 'applied', payload_json: '{}', created_by_id: 900,
      reversal: { keeperId: 10000, dupId: 10001, mergedStateFingerprint: JSON.stringify({ products: [keeper, liveRow(10001)], childProducts: [], promotionRules: [] }) } }
    const before = guardUndo.productMergeGroupPredecessorTimestamps(child, { id: 7001, status: 'applied', payload_json: '{"p":1}', created_by_id: 900, reversal: { keeperId: 10000, dupId: 10002, mergedStateFingerprint: prior } }).before
    for (const statement of before) { try { guardDb.prepare(statement.sql).get(statement.params) } catch { return false } }
    return true
  }
  const g1 = (saved, live) => guardUndo.mergeFingerprintDiffersOnlyByCostRounding(
    JSON.stringify({ products: [{ id: 1, cost_price_khr: saved }], batches: [{ id: 2, unit_cost_usd: saved }] }),
    JSON.stringify({ products: [{ id: 1, cost_price_khr: live }], batches: [{ id: 2, unit_cost_usd: saved }] }))
  const graphText = (value, revision) => JSON.stringify({
    'products:0': [['id', 'cost_price_khr'], [[[['integer', 7], Number.isInteger(value) ? ['integer', value] : ['real', text17(value)]]]]],
    graphRevisions: [['entity_type', 'entity_key', 'revision'], [[[['text', 'product'], ['text', '7'], ['integer', revision]]]]] })
  const g23 = (saved, live) => guardUndo.mergeGraphStateCostRounding(graphText(saved, 2), graphText(live, 3)) !== null // KHR only: one 0313 bump
  const guards = { G1: g1, G23: g23, G4: g4 }
  const tally = { values: 0, differ: 0 }
  const accepted = { G1: 0, G23: 0, G4: 0 }
  for (let i = 0; i < 700; i += 1) {
    const tie = (Math.floor(random() * [1, 100, 1e4, 1e6][i % 4] * 1e4) + 0.5) / 1e4
    const value = i % 5 === 0 ? Math.floor(random() * 2e9) / 1e4 / [3, 7, 8, 16, 6][i % 4] : ulp(tie, Math.floor(random() * 5) - 2)
    const h = H(value), r = R(value)
    if (h === value && r === value) continue
    tally.values += 1
    if (h !== r) tally.differ += 1
    for (const [name, guard] of Object.entries(guards)) {
      for (const form of new Set([h, r])) if (form !== value) { assert.equal(guard(value, form), true, `${name}: ${value} -> ${form} (R ${r}, H ${h}) is rounding`); accepted[name] += 1 }
      for (const wrong of [Math.max(h, r) + 0.0001, Math.min(h, r) - 0.0001, value + 1e-7]) if (wrong !== h && wrong !== r && wrong !== value) assert.equal(guard(value, wrong), false, `${name}: ${value} -> ${wrong} is not rounding`)
    }
  }
  assert.ok(tally.differ >= 40, `the property must include near-ties where the rules differ (${tally.differ})`)
  console.log(`PASS A guards accept R and H and nothing else: ${JSON.stringify(tally)} accepted ${JSON.stringify(accepted)}`)

  // ---------------- B: end to end near-tie worlds ----------------
  const USD = [21.398249999999997, 0.6551499999999999, 4.343249999999999]
  const KHR = [57310.638249999996]
  for (const v of [...USD, ...KHR]) assert.notEqual(R(v), H(v), `${v} is a near-tie`)
  for (const v of USD) {
    let w = await world([10000, 10001], `UPDATE product_batches SET unit_cost_usd = ${v} WHERE id = 99002`)
    assert.equal(w.ok, true, `lot ${v}: ${w.error && w.error.message}`)
    w = await world([10000, 10001], `UPDATE products SET cost_price_usd = ${v}, purchase_price_usd = ${v} WHERE id = 10001`)
    assert.equal(w.ok, true, `product usd ${v}: ${w.error && w.error.message}`)
  }
  for (const v of KHR) { const w = await world([10000, 10001], `UPDATE products SET cost_price_khr = ${v} WHERE id = 10001`); assert.equal(w.ok, true, `khr ${v}: ${w.error && w.error.message}`) }
  { const v = USD[0]; const w = await world([10000, 10001, 10002], `UPDATE products SET cost_price_usd = ${v}, purchase_price_usd = ${v} WHERE id = 10001`); assert.equal(w.ok, true, `3-member ${v}: ${w.error && w.error.message}`) }
  { const w = await world([10000, 10001], 'UPDATE product_batches SET unit_cost_usd = 6.123456 WHERE id = 99002'); assert.equal(w.ok, true, 'control: R equals H') }
  // a value that is neither the saved figure nor either rounding is later activity
  {
    const v = USD[0]
    for (const live of [R(v) - 0.0001, H(v) + 0.0001, v + 0.00002]) {
      refused409(await world([10000, 10001], `UPDATE product_batches SET unit_cost_usd = ${v} WHERE id = 99002`, { between: `UPDATE product_batches SET unit_cost_usd = ${live} WHERE id = 99002` }), `lot cost moved to ${live}`)
    }
  }
  console.log('PASS B near-tie merge worlds (lot, product USD pair, KHR, 3-member) undo; control undoes; values outside {saved, R, H} refused')

  // ---------------- C: revision exactness ----------------
  const LONG_KHR = 'UPDATE products SET cost_price_khr = 24600.123456 WHERE id = 10001'
  refused409(await world([10000, 10001], LONG_KHR, { between: 'UPDATE products SET name = name WHERE id = 10001' }), 'R10 a no-op UPDATE on the rounded duplicate')
  refused409(await world([10000, 10001], LONG_KHR, { between: "UPDATE products SET name = 'Tmp' WHERE id = 10001; UPDATE products SET name = 'Alternate 0' WHERE id = 10001" }), 'R11 an A-B-A name edit')
  refused409(await world([10000, 10001], LONG_KHR, { between: "INSERT INTO rfid_tags(epc_id, product_id, branch_id) VALUES('E1', 10001, 1); UPDATE products SET name = name WHERE id = 10001" }), 'R12 an unread table plus a no-op UPDATE')
  refused409(await world([10000, 10001], LONG_KHR, { between: 'UPDATE products SET name = name WHERE id = 10000' }), 'R13 a no-op UPDATE on the unrounded keeper')
  { const w = await world([10000, 10001], LONG_KHR); assert.equal(w.ok, true, 'R0 control: 0313 alone') }
  { const w = await world([10000, 10001], 'UPDATE products SET cost_price_usd = 6.123456, purchase_price_usd = 6.123456 WHERE id = 10001'); assert.equal(w.ok, true, 'R19 USD pair: 0313 alone (two bumps)') }
  console.log('PASS C revision acceptance is exactly 0313: no-op UPDATE, A-B-A and unread-table worlds refused; 0313 alone (one and two bumps) undoes')

  // ---------------- D: three-member group, long keeper KHR; resume after 0313 ----------------
  {
    const { d1, groups } = seed(1)
    third(d1)
    groups[0].member_ids = [10000, 10001, 10002]
    seedStockFixture(d1.db, () => d1.db.exec('UPDATE products SET cost_price_khr = 20500.123456 WHERE id = 10000'))
    const f = { d1, ...loadRoute(d1, true) }
    const a = await finalizeApply(f, groups)
    assert.equal(a.applied.body.status, 'completed', 'the second fold meets the keeper cost the first fold rounded: ' + JSON.stringify(a.applied.body).slice(0, 200))
  }
  const interrupted = async (pre, between = null) => {
    const { d1, groups } = seed(1)
    third(d1)
    groups[0].member_ids = [10000, 10001, 10002]
    if (pre) seedStockFixture(d1.db, () => d1.db.exec(pre))
    const f = { d1, ...loadRoute(d1, true) }
    const a = await finalizeApply(f, groups, () => { const realNow = Date.now, baseNow = realNow(); let committed = false; f.controls.beforeNextWriteBatch = () => { committed = true }; Date.now = () => baseNow + (committed ? 19000 : 0); return () => { Date.now = realNow } })
    assert.equal(a.applied.body.interruption_code, 'merge_budget_reached', 'the group stops after the first fold')
    d1.db.exec(text0313)
    if (between) seedStockFixture(d1.db, () => d1.db.exec(between))
    const again = await a.apply()
    return { again, active: d1.db.prepare("SELECT group_concat(id || ':' || is_active) a FROM products WHERE id IN (10000,10001,10002)").get().a }
  }
  for (const [label, pre] of [['a folded duplicate lot', 'UPDATE product_batches SET unit_cost_usd = 6.123456 WHERE id = 99002'],
    ['a folded duplicate KHR', 'UPDATE products SET cost_price_khr = 24600.123456 WHERE id = 10001'], ['a not yet folded duplicate KHR', 'UPDATE products SET cost_price_khr = 24600.123456 WHERE id = 10002']]) {
    const r = await interrupted(pre)
    assert.equal(r.again.status, 200, `${label}: resume after 0313 ${JSON.stringify(r.again.body).slice(0, 200)}`)
    assert.equal(r.again.body.status, 'completed', label)
    assert.equal(r.active, '10000:1,10001:0,10002:0', label)
  }
  for (const [label, pre, between] of [['a folded duplicate lot moved by more than rounding', 'UPDATE product_batches SET unit_cost_usd = 6.123456 WHERE id = 99002', 'UPDATE product_batches SET unit_cost_usd = 6.2 WHERE id = 99002'],
    ['the keeper renamed', null, "UPDATE products SET name = 'Changed' WHERE id = 10000"]]) {
    const r = await interrupted(pre, between)
    assert.equal(r.again.status, 409, `${label}: a real change still conflicts`)
    assert.equal(r.active, '10000:1,10001:0,10002:1', label + ': only the first fold stays committed')
  }
  console.log('PASS D three-member long keeper KHR completes; resume after 0313 completes; a real change still conflicts')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
