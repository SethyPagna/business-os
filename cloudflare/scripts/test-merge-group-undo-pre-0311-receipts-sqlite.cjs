'use strict'
// H2 (deploy 4 compose review): a merge recorded by the build that is in production today stores receipts built from the live column list of the
// tables it reads with SELECT * (the graph receipt of every v3 merge, the full-lot fingerprint of a merge that wrote a kept lot). Migration 0311 adds
// product_batches.merge_deactivated_at, so after the deploy the live column list differs from every saved receipt and every such merge became
// impossible to undo or redo (undo_record_changed), single and group.
// Rule: a receipt saved before the deploy equals live state when the ONLY difference is a column the deploy's migrations added (an explicit allow-list
// keyed by table: product_batches.merge_deactivated_at) and that cell is NULL in every live row; live rows are projected onto the saved column order.
// Any other column, a non-NULL allow-listed cell, or a changed real value still refuses with the coded 409. 0313's cost rounding is accepted at the same time.
//
// The world is built on the production schema (migrations through 0310) with the real routes; the pre-0311 writers (which never wrote the marker) are
// reproduced by stripping that one assignment from the statements (harness/merge-group-world.cjs); then the deploy's migrations 0311, 0312, 0313, 0315
// are applied in order and the real undo applier undoes, redoes and undoes again.
const assert = require('node:assert/strict')
const w = require('./harness/merge-group-world.cjs')

const SAME = ['2026-09-05', '2026-09-05', '2026-09-05']
const DISTINCT = ['2026-09-01', '2026-09-02', '2026-09-03']
const spec = (dates, members) => [{ qty: 1, cost: 1, date: dates[0] }, { qty: 2, cost: 2, date: dates[1] }, { qty: 3, cost: 3, date: dates[2] }].slice(0, members)
const complete = (steps) => steps.length > 0 && steps.every((s) => s.ok) && steps.at(-1).complete === true
const show = (steps) => JSON.stringify(steps.map((s) => s.ok ? s.complete : `${s.code}: ${s.message}`))
const everything = (db) => JSON.stringify({
  state: w.businessState(db),
  lots: w.rows(db, 'SELECT * FROM product_batches ORDER BY id'),
  history: w.rows(db, 'SELECT id,status,reversible,undo_payload,redo_payload FROM action_history ORDER BY id'),
  snaps: w.rows(db, 'SELECT id,status,payload_json FROM undo_snapshots ORDER BY id'),
  groups: w.rows(db, 'SELECT * FROM product_conflict_action_groups ORDER BY review_id, ordinal'),
})

// A group merged by the pre-deploy build; returns the world BEFORE the deploy's migrations.
async function merged(label, { dates = SAME, members = 3, pre = '' } = {}) {
  const { d1, ids } = w.seedWorld({ through: 310, lots: spec(dates, members), extra: pre })
  assert.equal(w.hasMarker(d1.db), false, `${label}: the production schema has no merge_deactivated_at`)
  const f = { d1, ...w.loadRoute(d1, true) }
  w.legacyWriters(d1, true)
  const before = w.businessState(d1.db)
  await w.applyGroup(d1, f, ids, label)
  const afterMerge = w.businessState(d1.db)
  assert.notEqual(afterMerge, before, `${label}: the merge changed the world`)
  for (const snap of w.rows(d1.db, 'SELECT payload_json FROM undo_snapshots')) {
    assert.ok(!snap.payload_json.includes('merge_deactivated_at'), `${label}: a receipt recorded before the deploy knows no merge_deactivated_at`)
  }
  w.legacyWriters(d1, false)
  return { d1, f, before, afterMerge, label }
}
const deploy = (world) => { w.applyDeployMigrations(world.d1); assert.equal(w.hasMarker(world.d1.db), true, `${world.label}: the deploy added merge_deactivated_at`) }

// oracle: the same group with the 4-place costs typed in from the start (0313 has nothing to round): what an undo and a redo must give back after 0313 rounded the cells.
async function cycle(world, { folds = true, oracle = world } = {}) {
  const { d1, f, label } = world
  const { before, afterMerge } = oracle
  deploy(world)
  const undo = await w.groupAll(f, d1, 'undo')
  assert.ok(complete(undo), `${label}: undo of the pre-deploy merge completes ${show(undo)}`)
  assert.equal(w.businessState(d1.db), before, `${label}: undo gives stock, lots, costs, is_active and catalog costs back exactly`)
  const redo = await w.groupAll(f, d1, 'redo')
  assert.ok(complete(redo), `${label}: redo completes ${show(redo)}`)
  assert.equal(w.businessState(d1.db, { marker: false }), afterMerge, `${label}: redo reproduces the merged state`)
  assert.equal(w.rows(d1.db, 'SELECT id FROM product_batches WHERE merge_deactivated_at IS NOT NULL').length >= 1, folds, `${label}: the redo (new build) marks the lots it folds, and only those`)
  const undo2 = await w.groupAll(f, d1, 'undo')
  assert.ok(complete(undo2), `${label}: the undo after the redo completes ${show(undo2)}`)
  assert.equal(w.businessState(d1.db), before, `${label}: and gives everything back exactly again`)
}

// A refusal leaves everything alone and is the coded 409.
async function refused(world, between, label, direction = 'undo') {
  const { d1, f } = world
  deploy(world)
  w.seedStockFixture(d1.db, () => d1.db.exec(between))
  const dump = everything(d1.db)
  const steps = await w.groupAll(f, d1, direction)
  assert.equal(steps[0].ok, false, `${label}: ${direction} must be refused, got ${show(steps)}`)
  assert.equal(steps[0].status, 409, `${label}: ${steps[0].message}`)
  assert.equal(steps[0].code, 'undo_record_changed', `${label}: code`)
  assert.equal(steps.length, 1, `${label}: refused at the first request`)
  assert.equal(everything(d1.db), dump, `${label}: a refused ${direction} writes nothing`)
}

async function main() {
  // --- The real routes, the production schema, the real deploy chain. ---
  await cycle(await merged('3 members, one received date (fold into a kept lot)'))
  await cycle(await merged('2 members, distinct dates (lots created on the keeper)', { dates: DISTINCT, members: 2 }), { folds: false })
  // 0313 rounds a long cost in the same deploy: the receipt differs by the added column AND by rounding. A KHR cost of the third member and a long lot cost.
  const LONG = 'UPDATE products SET cost_price_khr = 24600.123456 WHERE id = 10002; UPDATE product_batches SET received_cost_usd = 9.123456, unit_cost_usd = 3.123456 WHERE id = 99003'
  const SHORT = 'UPDATE products SET cost_price_khr = 24600.1235 WHERE id = 10002; UPDATE product_batches SET received_cost_usd = 9.1235, unit_cost_usd = 3.1235 WHERE id = 99003'
  await cycle(await merged('3 members, one date, 0313 rounds a catalog cost and a lot cost at the same time', { pre: LONG }), { oracle: await merged('oracle of the rounding world', { pre: SHORT }) })
  // Merge AND undo before the deploy: the redo receipt predates 0311 too. Deploy, then redo and undo complete.
  {
    const world = await merged('3 members, undone before the deploy, redone after it')
    w.legacyWriters(world.d1, true)
    const early = await w.groupAll(world.f, world.d1, 'undo')
    w.legacyWriters(world.d1, false)
    assert.ok(complete(early), `the undo before the deploy completes ${show(early)}`)
    assert.equal(w.businessState(world.d1.db), world.before)
    for (const snap of w.rows(world.d1.db, 'SELECT payload_json FROM undo_snapshots')) assert.ok(!snap.payload_json.includes('merge_deactivated_at'), 'the redo receipt predates 0311')
    deploy(world)
    const redo = await w.groupAll(world.f, world.d1, 'redo')
    assert.ok(complete(redo), `redo of a receipt saved before the deploy completes ${show(redo)}`)
    assert.equal(w.businessState(world.d1.db, { marker: false }), world.afterMerge)
    const undo = await w.groupAll(world.f, world.d1, 'undo')
    assert.ok(complete(undo), `and the undo after it completes ${show(undo)}`)
    assert.equal(w.businessState(world.d1.db), world.before)
  }
  const rounded = await merged('probe: what 0313 rounded', { pre: 'UPDATE products SET cost_price_khr = 24600.123456 WHERE id = 10002' })
  deploy(rounded)
  assert.ok(w.rows(rounded.d1.db, 'SELECT * FROM cost_4dp_repair_0313').length >= 1, '0313 rounded something in the rounding worlds')

  // --- Negative controls: every one is refused with the coded 409 and writes nothing. ---
  await refused(await merged('control: another new column'), 'ALTER TABLE product_batches ADD COLUMN probe_marker TEXT', 'a column the deploy did not add')
  await refused(await merged('control: non-NULL merge_deactivated_at'), "UPDATE product_batches SET merge_deactivated_at = '2026-11-17 00:00:00' WHERE id = 99001", 'merge_deactivated_at set on an in-scope lot')
  await refused(await merged('control: a changed real value'), "UPDATE product_batches SET notes = 'edited after the merge' WHERE id = 99001", 'a lot note changed')
  await refused(await merged('control: a changed cost'), 'UPDATE product_batches SET unit_cost_usd = 9 WHERE id = 99001', 'a lot cost moved by more than rounding')
  await refused(await merged('control: non-NULL marker next to rounding', { pre: 'UPDATE products SET cost_price_khr = 24600.123456 WHERE id = 10002' }),
    "UPDATE product_batches SET merge_deactivated_at = '2026-11-17 00:00:00' WHERE id = 99002", 'a marked lot beside a rounded cost')

  // --- The comparators, field by field (the same functions the undo and redo run). ---
  const { f } = await merged('probe comparators', { members: 2 })
  const { mergeGraphStateCostRounding, mergeFingerprintDiffersOnlyByCostRounding, mergeGraphStateAddedColumnsOnly, mergeFingerprintAddedColumnsOnly } = f.undo
  const N = ['null', null]
  const graph = (key, columns, rows) => JSON.stringify({ [key]: [columns, rows] })
  const saved = graph('casBatchMetadata:0', ['id', 'notes'], [[[['integer', 1], ['text', 'a']]], [[['integer', 2], ['text', 'b']]]])
  const live = (columns, rows, key = 'casBatchMetadata:0') => graph(key, columns, rows)
  const ok = (a, b, why) => assert.notEqual(mergeGraphStateCostRounding(a, b), null, why)
  const no = (a, b, why) => assert.equal(mergeGraphStateCostRounding(a, b), null, why)
  ok(saved, live(['id', 'notes', 'merge_deactivated_at'], [[[['integer', 1], ['text', 'a'], N]], [[['integer', 2], ['text', 'b'], N]]]), 'the added column, NULL in every row: equal')
  ok(saved, live(['id', 'merge_deactivated_at', 'notes'], [[[['integer', 1], N, ['text', 'a']]], [[['integer', 2], N, ['text', 'b']]]]), 'projected onto the saved order even when not last')
  ok(saved, saved, 'identical')
  no(saved, live(['id', 'notes', 'merge_deactivated_at'], [[[['integer', 1], ['text', 'a'], N]], [[['integer', 2], ['text', 'b'], ['text', '2026-11-17 00:00:00']]]]), 'one row marked: refused')
  no(saved, live(['id', 'notes', 'probe_marker'], [[[['integer', 1], ['text', 'a'], N]], [[['integer', 2], ['text', 'b'], N]]]), 'another column: refused')
  no(saved, live(['id', 'notes', 'merge_deactivated_at', 'probe_marker'], [[[['integer', 1], ['text', 'a'], N, N]], [[['integer', 2], ['text', 'b'], N, N]]]), 'the allowed column plus another: refused')
  no(saved, live(['id', 'merge_deactivated_at'], [[[['integer', 1], N]], [[['integer', 2], N]]]), 'a saved column missing live: refused')
  no(saved, live(['id', 'notes', 'merge_deactivated_at'], [[[['integer', 1], ['text', 'a'], N]], [[['integer', 2], ['text', 'CHANGED'], N]]]), 'a changed value: refused')
  no(saved, live(['id', 'notes', 'merge_deactivated_at'], [[[['integer', 1], ['text', 'a'], N]]]), 'a row removed: refused')
  no(graph('products:0', ['id', 'notes'], [[[['integer', 1], ['text', 'a']]]]), graph('products:0', ['id', 'notes', 'merge_deactivated_at'], [[[['integer', 1], ['text', 'a'], N]]]), 'the allow-list is keyed by table: products gains nothing')
  // 15 cells per group: 15 saved columns are one group, the 16th live column must not leave a stray group behind.
  const cols15 = Array.from({ length: 15 }, (_, i) => `c${i}`)
  const row15 = cols15.map((_, i) => ['integer', i])
  ok(graph('batches:0', cols15, [[row15]]), graph('batches:0', [...cols15, 'merge_deactivated_at'], [[row15, [N]]]), 'regrouped by 15')
  // Rounding at the same time (a real long saved, its 4-place form live).
  const costRow = (cost, extra) => [[[['integer', 1], ['real', cost], ...extra]]]
  ok(graph('casBatchMetadata:0', ['id', 'unit_cost_usd'], costRow('3.1234560000000001', [])), graph('casBatchMetadata:0', ['id', 'unit_cost_usd', 'merge_deactivated_at'], costRow('3.1235', [N])), 'the added column and 0313 rounding at once')
  no(graph('casBatchMetadata:0', ['id', 'unit_cost_usd'], costRow('3.1234560000000001', [])), graph('casBatchMetadata:0', ['id', 'unit_cost_usd', 'merge_deactivated_at'], costRow('3.1236', [N])), 'a cost one tick off the rounding beside the added column: refused')
  assert.equal(mergeGraphStateAddedColumnsOnly(saved, live(['id', 'notes', 'merge_deactivated_at'], [[[['integer', 1], ['text', 'a'], N]], [[['integer', 2], ['text', 'b'], N]]])), true, 'schema-only: the added column')
  assert.equal(mergeGraphStateAddedColumnsOnly(saved, saved), true, 'schema-only: identical')
  assert.equal(mergeGraphStateAddedColumnsOnly(graph('casBatchMetadata:0', ['id', 'unit_cost_usd'], costRow('3.1234560000000001', [])), graph('casBatchMetadata:0', ['id', 'unit_cost_usd', 'merge_deactivated_at'], costRow('3.1235', [N]))), false, 'schema-only never accepts rounding')

  const fp = (batches) => JSON.stringify({ products: [{ id: 1, cost_price_khr: 1 }], branchStock: [], batches, batchStock: [] })
  const lotRow = (extra) => ({ id: 1, variant_product_id: 10, batch_key: 'k', unit_cost_usd: 3.123456, notes: 'n', ...extra })
  assert.equal(mergeFingerprintDiffersOnlyByCostRounding(fp([lotRow({})]), fp([lotRow({ merge_deactivated_at: null })])), true, 'fingerprint: the added NULL column')
  assert.equal(mergeFingerprintAddedColumnsOnly(fp([lotRow({})]), fp([lotRow({ merge_deactivated_at: null })])), true, 'fingerprint schema-only')
  assert.equal(mergeFingerprintDiffersOnlyByCostRounding(fp([lotRow({})]), fp([lotRow({ merge_deactivated_at: '2026-11-17 00:00:00' })])), false, 'fingerprint: a marked lot')
  assert.equal(mergeFingerprintDiffersOnlyByCostRounding(fp([lotRow({})]), fp([lotRow({ probe_marker: null })])), false, 'fingerprint: another column')
  assert.equal(mergeFingerprintDiffersOnlyByCostRounding(fp([lotRow({})]), fp([lotRow({ merge_deactivated_at: null, notes: 'x' })])), false, 'fingerprint: a changed value')
  assert.equal(mergeFingerprintDiffersOnlyByCostRounding(fp([lotRow({})]), fp([lotRow({ merge_deactivated_at: null, unit_cost_usd: 3.1235 })])), true, 'fingerprint: column and rounding at once')
  assert.equal(mergeFingerprintAddedColumnsOnly(fp([lotRow({})]), fp([lotRow({ merge_deactivated_at: null, unit_cost_usd: 3.1235 })])), false, 'fingerprint schema-only never accepts rounding')
  assert.equal(mergeFingerprintDiffersOnlyByCostRounding(fp([lotRow({})]), JSON.stringify({ ...JSON.parse(fp([lotRow({})])), products: [{ id: 1, cost_price_khr: 1, merge_deactivated_at: null }] })), false, 'fingerprint: the allow-list is keyed by table')
  console.log('merge undo/redo of receipts saved before the deploy: every world completes, every control refused; comparators ok')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
