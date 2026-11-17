'use strict'
// Undo of a product merge recorded BEFORE migration 0313, with 0313 run between the merge and the undo.
// 0313 rounds a long cost (over 4 places) to 4 places. Merge undo compares a fingerprint and a graph receipt of the merged products, lots and cost
// entries with the live rows; a cost that only 0313 rounded is not later activity, so undo must complete (owner rule: money has 4 decimals, and undo
// writes it back at 4 places). Anything else must stay refused. Real routes (merge preview, finalize, apply, undo) and the real 0313 file.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
const { loadRoute, seed, post } = require('./test-product-conflict-action-groups-sqlite.cjs')

const text0313 = fs.readFileSync(path.join(__dirname, '../migrations/0313_cost_4dp_repair.sql'), 'utf8')
const user = { id: 900, username: 'reviewer' }
const stateOf = (db) => JSON.stringify({
  p: db.prepare('SELECT id, is_active a, cost_price_usd c, purchase_price_usd pu, cost_price_khr k, selling_price_usd s FROM products WHERE id IN (10000,10001) ORDER BY id').all().map((r) => ({ ...r })),
  b: db.prepare('SELECT id, variant_product_id v, is_active a, unit_cost_usd u, received_cost_usd rc FROM product_batches WHERE id IN (99001,99002) ORDER BY id').all().map((r) => ({ ...r })),
})
let counter = 0

// pre: SQL run (with the stock permit) before the merge. between: SQL run after the merge and after 0313 (when run0313).
async function world(label, { pre = null, run0313 = false, between = null } = {}) {
  const { d1, groups } = seed(1)
  groups[0].member_ids = [10000, 10001]
  if (pre) seedStockFixture(d1.db, () => d1.db.exec(pre))
  const f = { d1, ...loadRoute(d1, true) }
  counter += 1
  const preview = await post(f.app, { manifest_version: 1, resolution_version: 2, client_request_id: `merge_undo_0313_${counter}`, merge_groups: groups, remove_rows: [] })
  assert.equal(preview.status, 200, `${label}: preview ${JSON.stringify(preview.body).slice(0, 300)}`)
  const review = preview.body
  const final = await f.app.posts.get('/possible-duplicates/merge-batch/reviews/:reviewId/finalize')({ env: {}, get: () => user, req: { param: () => review.review_id, json: async () => ({
    manifest_version: 1, resolution_version: 2, review_id: review.review_id, draft_digest: review.draft_digest,
    resolutions: [{ group_key: groups[0].group_key, keeper_id: 10000, barcode: { mode: 'canonical' }, category_source_id: 10000, brand_source_id: 10000, unit_source_id: 10000 }] }) },
    json: (body, status = 200) => ({ body, status }) })
  assert.equal(final.status, 200, `${label}: finalize ${JSON.stringify(final.body).slice(0, 300)}`)
  const applied = await f.app.posts.get('/possible-duplicates/merge-batch')({ env: {}, get: () => user, executionCtx: { waitUntil() {} },
    req: { json: async () => ({ review_id: review.review_id, manifest_digest: final.body.manifest_digest, client_request_id: review.review_id }) }, json: (body, status = 200) => ({ body, status }) })
  assert.equal(applied.status, 200, `${label}: apply ${JSON.stringify(applied.body).slice(0, 300)}`)
  assert.equal(applied.body.status, 'completed', `${label}: apply ${JSON.stringify(applied.body).slice(0, 300)}`)
  const history = d1.db.prepare("SELECT id FROM action_history WHERE json_extract(undo_payload,'$.applier')='product.merge.group'").get()
  let ledger = []
  if (run0313) {
    d1.db.exec(text0313)
    ledger = d1.db.prepare('SELECT entity, row_id, col, before_value b, after_value a FROM cost_4dp_repair_0313 ORDER BY entity, row_id, col').all().map((r) => ({ ...r }))
  }
  if (between) seedStockFixture(d1.db, () => d1.db.exec(between))
  const beforeUndo = stateOf(d1.db)
  const pointer = JSON.parse(d1.db.prepare('SELECT undo_payload FROM action_history WHERE id=?').get(history.id).undo_payload)
  let outcome = null, refusal = null
  try { outcome = await f.undo.resolveUndoApplier(pointer).run(pointer, { env: {}, user, direction: 'undo', historyId: history.id, generation: 0 }) }
  catch (error) { refusal = error }
  return { f, d1, label, outcome, refusal, ledger, beforeUndo, afterUndo: stateOf(d1.db), active: d1.db.prepare('SELECT is_active a FROM products WHERE id=10001').get().a }
}

function assertUndone(w, expect) {
  assert.equal(w.refusal, null, `${w.label}: undo refused: ${w.refusal && (w.refusal.code + ' ' + w.refusal.message)}`)
  assert.equal(w.outcome.complete, true, w.label)
  assert.equal(w.active, 1, `${w.label}: the duplicate is active again`)
  const after = JSON.parse(w.afterUndo)
  for (const column of ['c', 'pu', 'k']) assert.equal(Number(after.p[0][column].toFixed(4)), after.p[0][column], `${w.label}: the keeper's restored ${column} is at 4 places`)
  for (const [key, value] of Object.entries(expect)) {
    const [table, id, column] = key.split('.')
    const row = after[table].find((r) => String(r.id) === id)
    assert.equal(row[column], value, `${w.label}: ${key} after undo (4 places)`)
  }
}
function assertRefused(w) {
  assert.ok(w.refusal, `${w.label}: undo must be refused`)
  assert.equal(w.refusal.code, 'undo_record_changed', `${w.label}: ${w.refusal.code} ${w.refusal.message}`)
  assert.equal(w.refusal.statusCode, 409, w.label)
  assert.equal(w.active, 0, `${w.label}: the duplicate stays inactive`)
  assert.equal(w.afterUndo, w.beforeUndo, `${w.label}: a refused undo writes nothing`)
}

const LONG_KHR = 'UPDATE products SET cost_price_khr = 24600.123456 WHERE id = 10001'
const LONG_LOT = 'UPDATE product_batches SET unit_cost_usd = 6.123456 WHERE id = 99002'

async function main() {
  // --- The reviewer's probe, cases A to F: every case completes. ---
  assertUndone(await world('A: 4-place costs, no 0313'), {})
  const b = await world('B: 4-place costs, 0313 between', { run0313: true })
  assert.deepEqual(b.ledger, [], 'B: 0313 changes nothing when every cost is already at 4 places')
  assertUndone(b, {})
  assertUndone(await world('C: duplicate KHR cost long, no 0313', { pre: LONG_KHR }), { 'p.10001.k': 24600.123456 })
  const d = await world('D: duplicate KHR cost long, 0313 between', { pre: LONG_KHR, run0313: true })
  assert.deepEqual(d.ledger, [{ entity: 'products', row_id: 10001, col: 'cost_price_khr', b: 24600.123456, a: 24600.1235 }], 'D: 0313 rounded exactly that cost')
  assertUndone(d, { 'p.10001.k': 24600.1235 })
  assertUndone(await world('E: duplicate lot cost long, no 0313', { pre: LONG_LOT }), { 'b.99002.u': 6.123456 })
  const fCase = await world('F: duplicate lot cost long, 0313 between', { pre: LONG_LOT, run0313: true })
  assert.deepEqual(fCase.ledger, [{ entity: 'product_batches', row_id: 99002, col: 'unit_cost_usd', b: 6.123456, a: 6.1235 }], 'F: 0313 rounded exactly that lot cost')
  assertUndone(fCase, { 'b.99002.u': 6.1235 })
  // Both long at once, and received_cost_usd as well.
  const both = await world('G: product cost, lot cost and received cost long, 0313 between', {
    pre: `${LONG_KHR}; UPDATE product_batches SET unit_cost_usd = 6.123456, received_cost_usd = 18.370368 WHERE id = 99002;`, run0313: true })
  assertUndone(both, { 'p.10001.k': 24600.1235, 'b.99002.u': 6.1235, 'b.99002.rc': 18.3704 })
  // R19 (mutant MC2, the purchase twin dropped): a USD cost AND its purchase twin rounded by 0313 (two ledger rows, two revision bumps).
  const usdPair = await world('H: duplicate cost and purchase USD long, 0313 between', {
    pre: 'UPDATE products SET cost_price_usd = 6.123456, purchase_price_usd = 6.123456 WHERE id = 10001', run0313: true })
  assert.deepEqual(usdPair.ledger.map((r) => r.col), ['cost_price_usd', 'purchase_price_usd'], 'H: 0313 rounded both USD columns')
  assertUndone(usdPair, {})

  // --- Refusals: each is refused by the current code and leaves the data alone. ---
  // A column that is not a cost changed: a long selling price that "rounded" is still later activity.
  assertRefused(await world('N1: a non-cost column rounded (selling_price_usd 7.123456 -> 7.1235)', {
    pre: 'UPDATE products SET selling_price_usd = 7.123456 WHERE id = 10001', between: 'UPDATE products SET selling_price_usd = 7.1235 WHERE id = 10001' }))
  assertRefused(await world('N1b: a non-cost column changed next to a rounded cost', { pre: LONG_KHR, run0313: true, between: "UPDATE products SET description = 'edited' WHERE id = 10001" }))
  assertRefused(await world('N1c: a lot column other than cost changed next to a rounded cost', { pre: LONG_LOT, run0313: true, between: "UPDATE product_batches SET notes = 'edited' WHERE id = 99002" }))
  // A cost changed by more than half a tick (not 0313's rounding).
  assertRefused(await world('N2: product cost moved by more than rounding (24600.123456 -> 24600.2)', { pre: LONG_KHR, between: 'UPDATE products SET cost_price_khr = 24600.2 WHERE id = 10001' }))
  assertRefused(await world('N2b: lot cost moved by more than rounding (6.123456 -> 6.2)', { pre: LONG_LOT, between: 'UPDATE product_batches SET unit_cost_usd = 6.2 WHERE id = 99002' }))
  assertRefused(await world('N2c: lot cost moved by one tick from its rounding (6.123456 -> 6.1236)', { pre: LONG_LOT, between: 'UPDATE product_batches SET unit_cost_usd = 6.1236 WHERE id = 99002' }))
  assertRefused(await world('N2d: product cost moved by one tick from its rounding after 0313 (24600.1235 -> 24600.1236)', { pre: LONG_KHR, run0313: true, between: 'UPDATE products SET cost_price_khr = 24600.1236 WHERE id = 10001' }))
  // A saved 4-place cost that now differs (by a tick, or by a long amount that rounds back to the saved value).
  assertRefused(await world('N3: saved 4-place lot cost now differs (6 -> 6.0001)', { between: 'UPDATE product_batches SET unit_cost_usd = 6.0001 WHERE id = 99002' }))
  assertRefused(await world('N3b: saved 4-place lot cost now differs by a long amount that rounds back (6 -> 6.00001)', { between: 'UPDATE product_batches SET unit_cost_usd = 6.00001 WHERE id = 99002' }))
  assertRefused(await world('N3c: saved 4-place product cost now differs (24600.1235 -> 24600.12351)', {
    pre: 'UPDATE products SET cost_price_khr = 24600.1235 WHERE id = 10001', between: 'UPDATE products SET cost_price_khr = 24600.12351 WHERE id = 10001' }))
  assertRefused(await world('N3d: saved 4-place product cost now differs (24600.1235 -> 24600.1236)', {
    pre: 'UPDATE products SET cost_price_khr = 24600.1235 WHERE id = 10001', between: 'UPDATE products SET cost_price_khr = 24600.1236 WHERE id = 10001' }))
  // NULL against a number, both ways.
  assertRefused(await world('N4: NULL -> 0 (lot cost)', { pre: 'UPDATE product_batches SET unit_cost_usd = NULL WHERE id = 99002', between: 'UPDATE product_batches SET unit_cost_usd = 0 WHERE id = 99002' }))
  assertRefused(await world('N5: 0 -> NULL (lot cost)', { pre: 'UPDATE product_batches SET unit_cost_usd = 0 WHERE id = 99002', between: 'UPDATE product_batches SET unit_cost_usd = NULL WHERE id = 99002' }))
  assertRefused(await world('N4b: NULL -> 0 (received cost)', { pre: 'UPDATE product_batches SET received_cost_usd = NULL WHERE id = 99002', between: 'UPDATE product_batches SET received_cost_usd = 0 WHERE id = 99002' }))
  assertRefused(await world('N5b: 0 -> NULL (received cost)', { pre: 'UPDATE product_batches SET received_cost_usd = 0 WHERE id = 99002', between: 'UPDATE product_batches SET received_cost_usd = NULL WHERE id = 99002' }))
  // An extra lot, next to a legitimate rounding.
  assertRefused(await world('N6: an extra lot appeared next to a rounded lot cost', { pre: LONG_LOT, run0313: true,
    between: "INSERT INTO product_batches(variant_product_id, batch_key, batch_number, unit_cost_usd, is_active) VALUES(10000, 'extra', 'extra', 1, 1)" }))
  assertRefused(await world('N6b: an extra lot appeared (no rounding at all)', { between: "INSERT INTO product_batches(variant_product_id, batch_key, batch_number, unit_cost_usd, is_active) VALUES(10000, 'extra', 'extra', 1, 1)" }))

  // --- The comparators, directly. ---
  const { mergeFingerprintDiffersOnlyByCostRounding: fp, mergeGraphStateCostRounding: graph } = d.f.undo
  const row = (cost) => ({ id: 1, name: 'x', cost_price_usd: cost, selling_price_usd: 9 })
  const print = (rows) => JSON.stringify({ products: rows, batches: [], other: [1] })
  assert.equal(fp(print([row(5.123456)]), print([row(5.1235)])), true, 'long cost against its rounding')
  assert.equal(fp(print([row(5.123456)]), print([row(5.123456)])), true, 'identical')
  assert.equal(fp(print([row(5.1235)]), print([row(5.1236)])), false, 'a saved 4-place cost that differs')
  assert.equal(fp(print([row(5.123456)]), print([row(5.1236)])), false, 'not its rounding')
  assert.equal(fp(print([row(5.123456)]), print([row(null)])), false, 'number to NULL')
  assert.equal(fp(print([row(null)]), print([row(0)])), false, 'NULL to 0')
  assert.equal(fp(print([row(0)]), print([row(null)])), false, '0 to NULL')
  // MC2: every one of the four product cost columns is accepted, not only cost_price_usd (the purchase twin and the KHR pair too).
  for (const column of ['cost_price_usd', 'cost_price_khr', 'purchase_price_usd', 'purchase_price_khr']) {
    assert.equal(fp(print([{ ...row(1), [column]: 5.123456 }]), print([{ ...row(1), [column]: 5.1235 }])), true, column + ' long against its rounding')
    assert.equal(fp(print([{ ...row(1), [column]: 5.123456 }]), print([{ ...row(1), [column]: 5.1236 }])), false, column + ' not its rounding')
  }
  assert.equal(fp(print([row(5.123456)]), print([row(5.1235), row(1)])), false, 'a row added')
  assert.equal(fp(print([row(5.123456)]), JSON.stringify({ products: [row(5.1235)], batches: [], other: [2] })), false, 'a different table')
  assert.equal(fp(print([{ ...row(5.123456), selling_price_usd: 9.123456 }]), print([{ ...row(5.1235), selling_price_usd: 9.1235 }])), false, 'a non-cost column rounded')
  assert.equal(fp(print([row(5.123456)]), JSON.stringify({ products: [{ ...row(5.1235), extra: 1 }], batches: [], other: [1] })), false, 'a column added')
  assert.equal(fp('not json', 'not json'), false)
  assert.equal(fp(print([row(-5.123456)]), print([row(-5.1235)])), true, 'half away from zero on a negative')
  assert.equal(fp(print([row(1.00015)]), print([row(1.0002)])), true, 'a decimal tie rounds up')
  // The graph receipt: [column names], rows of groups of cells [typeof, value].
  const cell = (type, value) => [type, value]
  const graphText = (cost, revision, extra = {}) => JSON.stringify({
    'products:0': [['id', 'cost_price_usd', 'name'], [[[cell('integer', 7), cell('real', cost), cell('text', 'n')]]]],
    graphRevisions: [['entity_type', 'entity_key', 'revision'], [[[cell('text', 'product'), cell('text', '7'), cell('integer', revision)]]]],
    ...extra,
  })
  // 0313 bumps the product revision once for its first UPDATE (the four cost columns) and once more for its second (cost_price_usd, purchase_price_usd):
  // a rounded USD cost carries exactly two bumps, any other count refuses (a no-op UPDATE, an A-B-A edit, a change in a table the graph does not read).
  assert.deepEqual([...graph(graphText('5.1234560000000003', 2), graphText('5.1234999999999999', 4))], [['7', 2]], 'rounded USD cost, two revision bumps')
  assert.equal(graph(graphText('5.1234560000000003', 2), graphText('5.1234999999999999', 5)), null, 'one bump more than 0313 makes')
  assert.equal(graph(graphText('5.1234560000000003', 2), graphText('5.1234999999999999', 3)), null, 'one bump fewer than 0313 makes')
  assert.equal(graph(graphText('5.1234560000000003', 2), graphText('5.1234560000000003', 4)), null, 'a revision bump with no rounding')
  assert.equal(graph(graphText('5.1234560000000003', 2), graphText('5.1234999999999999', 1)), null, 'a revision that went down')
  assert.equal(graph(graphText('5.1234560000000003', 2), graphText('5.1236000000000004', 3)), null, 'a cost that is not the rounding')
  assert.equal(graph(graphText('5.1234999999999999', 2), graphText('5.1236000000000004', 2)), null, 'a saved 4-place cost that differs')
  assert.equal(graph(graphText('5.1234560000000003', 2), graphText('5.1234999999999999', 2)), null, 'a rounded cost whose revision did not move is not what 0313 does')
  assert.equal(graph(graphText('5.1234560000000003', 2), graphText('5.1234999999999999', 2, { 'products:0': [['id', 'cost_price_usd', 'name'], [[[cell('integer', 7), cell('real', '5.1234999999999999'), cell('text', 'renamed')]]]] })), null, 'a renamed row')
  assert.equal(graph(graphText('5.1234560000000003', 2), graphText('5.1234999999999999', 2).replace('"product"', '"batch"')), null, 'a revision of another entity type')
  // S4 (mutant MI, the cell type check dropped): a saved cost cell that is text or NULL is never a number to round, and a live text cell is not a number.
  const costCell = (type, value) => JSON.stringify({
    'products:0': [['id', 'cost_price_usd'], [[[cell('integer', 7), cell(type, value)]]]],
    graphRevisions: [['entity_type', 'entity_key', 'revision'], [[[cell('text', 'product'), cell('text', '7'), cell('integer', 4)]]]] })
  const savedCell = (type, value) => costCell(type, value).replace('"integer",4', '"integer",2')
  assert.equal(graph(savedCell('text', '5.123456'), costCell('real', '5.1234999999999999')), null, 'a text saved cost cell')
  assert.equal(graph(savedCell('null', null), costCell('real', '0')), null, 'a NULL saved cost cell')
  assert.equal(graph(savedCell('real', '5.1234560000000003'), costCell('text', '5.1235')), null, 'a text live cost cell')
  assert.deepEqual([...graph(savedCell('real', '5.1234560000000003'), costCell('real', '5.1234999999999999'))], [['7', 2]], 'control: the real cell is accepted')
  assert.deepEqual([...graph(savedCell('real', '5.0000100000000003'), costCell('integer', '5'))], [['7', 2]], 'a cost rounded to a whole number reads back as an integer cell')

  // --- The single (non-group) merge receipt: the same rule on the live graph and the two product revisions. ---
  await singleReceipt()
  await predecessorGuard()
  console.log('PASS merge undo after 0313: A-F complete at 4 places; 17 refusals; comparators; single-merge receipt; predecessor row guard')
}

// costRoundedReplayState against the real graph SQL, the real 0313 and the real revision triggers.
async function singleReceipt() {
  const { d1 } = seed(1)
  seedStockFixture(d1.db, () => d1.db.exec(LONG_KHR))
  const f = { d1, ...loadRoute(d1, true) }
  const reversal = { keeperId: 10000, dupId: 10001 }
  const prepared = await f.undo.prepareAtomicMergeGraphReceipt(d1, reversal)
  const revision = (id) => (d1.db.prepare("SELECT revision FROM stock_session_revisions WHERE entity_type='product' AND entity_key=?").get(String(id))?.revision ?? 0)
  const state = () => ({ graph_state: String(d1.db.prepare(`SELECT ${prepared.graph.sql} AS s`).get(prepared.graph.params).s), keeper_revision: revision(10000), duplicate_revision: revision(10001) })
  const saved = state()
  assert.deepEqual(await f.undo.costRoundedReplayState(d1, reversal, saved, prepared.graph), saved, 'nothing changed: the saved receipt')
  d1.db.exec(text0313)
  const live = state()
  assert.notEqual(live.graph_state, saved.graph_state, '0313 rounded the duplicate cost')
  assert.ok(live.duplicate_revision > saved.duplicate_revision, '0313 updated the product row, so its revision trigger fired')
  assert.deepEqual(await f.undo.costRoundedReplayState(d1, reversal, saved, prepared.graph), live, 'rounding only: the receipt is the live one')
  assert.equal(live.duplicate_revision - saved.duplicate_revision, 1, 'a KHR-only rounding is one bump (0313 first UPDATE)')
  // The revision must have moved by exactly 0313's bumps (S1, mutant MA2): a decrease, one bump too many and one too few are all refused.
  for (const [label, wrong] of [['a revision decrease', { ...saved, duplicate_revision: live.duplicate_revision + 1 }],
    ['one bump more than 0313 made', { ...saved, duplicate_revision: saved.duplicate_revision - 1 }], ['one bump fewer than 0313 made', { ...saved, duplicate_revision: saved.duplicate_revision + 1 }]]) {
    assert.equal(await f.undo.costRoundedReplayState(d1, reversal, wrong, prepared.graph), wrong, label + ' stays refused')
  }
  // R10: a no-op UPDATE on the rounded duplicate after 0313 is one bump more than 0313 made.
  seedStockFixture(d1.db, () => d1.db.exec('UPDATE products SET name = name WHERE id = 10001'))
  assert.equal(await f.undo.costRoundedReplayState(d1, reversal, saved, prepared.graph), saved, 'a no-op UPDATE on top of the rounding stays refused')
  // A revision bump on a product whose cost was NOT rounded (the keeper) is later activity.
  const keeperBumped = { ...saved, keeper_revision: saved.keeper_revision - 1 }
  assert.deepEqual(await f.undo.costRoundedReplayState(d1, reversal, keeperBumped, prepared.graph), keeperBumped, 'an unexplained keeper revision stays refused')
  // A real edit on top of the rounding keeps the saved receipt (so the guard refuses).
  seedStockFixture(d1.db, () => d1.db.exec("UPDATE products SET description = 'edited' WHERE id = 10001"))
  assert.deepEqual(await f.undo.costRoundedReplayState(d1, reversal, saved, prepared.graph), saved, 'a non-cost edit stays refused')
}

// The row guard a multi-child group undo puts before the predecessor's timestamp restore: the live product row must equal the child's saved
// fingerprint row. A cost 0313 rounded matches; nothing else widens. Run on the real products table with the real statements.
async function predecessorGuard() {
  const { d1 } = seed(1)
  const { undo } = loadRoute(d1, true)
  const live = (id) => ({ ...d1.db.prepare('SELECT id, updated_at, cost_price_usd, cost_price_khr, purchase_price_usd, purchase_price_khr, selling_price_usd FROM products WHERE id=?').get(id) })
  const setLive = (sql) => seedStockFixture(d1.db, () => d1.db.exec(sql))
  const predecessor = { id: 7001, status: 'applied', payload_json: '{"p":1}', created_by_id: 900 }
  d1.db.prepare("INSERT INTO undo_snapshots(id, kind, status, payload_json, created_by_id) VALUES(7001, 'product.merge.group.child', 'applied', '{\"p\":1}', 900)").run()
  const holds = (savedKhr, liveKhr, column = 'cost_price_khr') => {
    setLive(`UPDATE products SET ${column} = ${liveKhr} WHERE id = 10000`)
    const keeper = { ...live(10000), [column]: savedKhr }
    const prior = JSON.stringify({ products: [live(10000)], childProducts: [], promotionRules: [] })
    const child = { id: 7002, status: 'applied', payload_json: '{}', created_by_id: 900,
      reversal: { keeperId: 10000, dupId: 10001, mergedStateFingerprint: JSON.stringify({ products: [keeper, live(10001)], childProducts: [], promotionRules: [] }) } }
    const before = undo.productMergeGroupPredecessorTimestamps(child, { ...predecessor, reversal: { keeperId: 10000, dupId: 10002, mergedStateFingerprint: prior } }).before
    for (const statement of before) {
      try { d1.prepare(statement.sql).get(statement.params) } catch { return false }
    }
    return true
  }
  assert.equal(holds(24600.123456, 24600.123456), true, 'identical')
  assert.equal(holds(24600.123456, 24600.1235), true, 'a long saved cost matches its 4-place form')
  assert.equal(holds(24600.123456, 24600.1236), false, 'not its rounding')
  assert.equal(holds(24600.1235, 24600.1236), false, 'a saved 4-place cost that now differs')
  assert.equal(holds(24600.1235, 24600.12351), false, 'a saved 4-place cost that now differs by a long amount')
  assert.equal(holds('NULL', 0), false, 'NULL to 0')
  assert.equal(holds(0, 'NULL'), false, '0 to NULL')
  assert.equal(holds(9.123456, 9.1235, 'selling_price_usd'), false, 'a non-cost column rounded')
  assert.equal(holds(5.123456, 5.1235, 'cost_price_usd'), true, 'the USD cost column too')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
