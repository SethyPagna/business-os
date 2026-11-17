const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
// H2, single merge (product.merge v3): a merge recorded by the build in production today stores a graph receipt built from the live column list of
// product_batches (SELECT *), and a full-lot fingerprint when it wrote a kept lot. Migration 0311 adds product_batches.merge_deactivated_at, so after the
// deploy such a merge could be neither undone nor redone (undo_record_changed). Rule: a receipt saved before the deploy equals live state when the only
// difference is that column and it is NULL in every live row (explicit allow-list keyed by table); any other column, a non-NULL cell or a changed real
// value is still refused with the coded 409; 0313's cost rounding is accepted at the same time.
// Built on the production schema (migrations through 0310): the pre-0311 writers never wrote the marker, so that one assignment is stripped from the
// statements while the old build's merge runs; then migrations 0311, 0312, 0313, 0315 are applied in order and the real undo applier undoes and redoes.
const harnessBase = fs.readFileSync(path.join(__dirname, 'test-product-resolve-keep-merge-native.cjs'), 'utf8')
  .split(String.fromCharCode(13, 10)).join(String.fromCharCode(10)).split('async function main() {')[0]
if (!harnessBase.includes('const merge = (body)')) throw new Error('the harness anchors moved')
const swap = (text, from, to) => { if (text.split(from).length !== 2) throw new Error('harness anchor missing or ambiguous: ' + from); return text.replace(from, () => to) }
let prepared = harnessBase
prepared = swap(prepared, 'state.native = openDb(loadAll())', 'state.native = openDb(loadAll({ through: 310 }))')
prepared = swap(prepared, 'const st = state.native.prepare(sql)', 'const st = state.native.prepare(LEGACY(sql))')
prepared = swap(prepared, 'return state.native.batch(statements)', 'return state.native.batch(statements.map((item) => ({ ...item, sql: LEGACY(item.sql) })))')
const prelude = `
let legacyWriters = false
const LEGACY = (sql) => legacyWriters ? sql.replace(/merge_deactivated_at = (?:CURRENT_TIMESTAMP|NULL), /g, '') : sql
`
const checks = `
const DEPLOY = ['0311_product_batches_merge_deactivated_at.sql', '0312_catalog_cost_fallback_rounding.sql', '0313_cost_4dp_repair.sql', '0315_sale_return_line_batch_index.sql']
const deploy = () => { for (const file of DEPLOY) state.native.db.exec(fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8')) }
const hasMarker = () => rows("SELECT name FROM pragma_table_info('product_batches') WHERE name='merge_deactivated_at'").length === 1
const lastHistory = () => one("SELECT id, undo_payload, redo_payload FROM action_history WHERE status IN ('undoable','redoable') ORDER BY id DESC LIMIT 1")
const runHistory = async (history, direction) => {
  const current = one('SELECT id,undo_payload,redo_payload FROM action_history WHERE id=?', history.id)
  const payload = JSON.parse(direction === 'undo' ? current.undo_payload : current.redo_payload)
  const applier = undoAppliers.resolveUndoApplier(payload)
  await applier.run(payload, { env: { DB: {} }, user: ADMIN, direction, historyId: history.id, generation: payload.generation ?? 0 })
}
const setSql = (sql) => fixtureWrite(() => state.native.db.exec(sql))
const LOTS = "INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,unit_cost_usd,received_at,expiry_date,notes) VALUES(900,10,'k10',1,5,'2026-09-05','2027-01-01','keeper lot'),(901,11,'k11',1,7,'2026-09-05','2027-02-01','dup lot'); INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(900,1,3),(901,1,1)"
const LONG = "UPDATE products SET cost_price_khr = 28700.123456 WHERE id = 11; UPDATE product_batches SET unit_cost_usd = 7.123456 WHERE id = 901"
const SHORT = "UPDATE products SET cost_price_khr = 28700.1235 WHERE id = 11; UPDATE product_batches SET unit_cost_usd = 7.1235 WHERE id = 901"
// What an undo must give back: business columns only (no stamps), the marker as a flag.
const business = () => JSON.stringify([
  rows('SELECT id,is_active,name,stock_quantity,cost_price_usd,purchase_price_usd,cost_price_khr,purchase_price_khr FROM products WHERE id IN (10,11) ORDER BY id'),
  rows('SELECT id,variant_product_id,batch_key,batch_number,is_active,unit_cost_usd,expiry_date,received_at FROM product_batches ORDER BY id'),
  rows('SELECT product_id,branch_id,quantity FROM branch_stock ORDER BY product_id,branch_id'),
  rows('SELECT batch_id,branch_id,quantity FROM branch_batch_stock ORDER BY batch_id,branch_id')])
const everything = () => JSON.stringify([
  rows('SELECT * FROM products WHERE id IN (10,11) ORDER BY id'), rows('SELECT * FROM product_batches ORDER BY id'),
  rows('SELECT * FROM branch_stock ORDER BY product_id, branch_id'), rows('SELECT * FROM branch_batch_stock ORDER BY batch_id, branch_id'),
  rows('SELECT id,status,reversible,undo_payload,redo_payload FROM action_history ORDER BY id'),
  rows('SELECT id,status,payload_json FROM undo_snapshots ORDER BY id'), rows('SELECT COUNT(*) n FROM audit_logs'),
  rows('SELECT COUNT(*) n, MAX(id) m FROM inventory_movements')])
const historyStatus = (id) => one('SELECT status,reversible FROM action_history WHERE id=?', id)

// pre: SQL before the merge. The merge runs as the pre-deploy build did (no marker column, no marker writes).
async function mergedBeforeDeploy({ pre = [] } = {}) {
  fresh()
  legacyWriters = true
  try {
    for (const sql of pre) setSql(sql)
    const before = business()
    const done = await merge({ keepId: 10, mergeId: 11, keep: true, stock: 'merge' })
    assert.equal(done.status, 200, JSON.stringify(done.body))
    const history = lastHistory()
    assert.ok(history, 'the merge is undoable')
    for (const snap of rows('SELECT payload_json FROM undo_snapshots')) assert.ok(!snap.payload_json.includes('merge_deactivated_at'), 'a receipt recorded before the deploy knows no merge_deactivated_at')
    assert.ok(!hasMarker(), 'the production schema has no merge_deactivated_at')
    return { history, before, afterMerge: business() }
  } finally { legacyWriters = false }
}
const expectComplete = async (history, direction, what) => {
  try { await runHistory(history, direction) } catch (error) { assert.fail(what + ' ' + direction + ' refused: ' + (error.code || '') + ' ' + error.message) }
}

async function cycle(name, { pre, oracle }) {
  await check(name, async () => {
    const expected = oracle ? await mergedBeforeDeploy({ pre: oracle }) : null
    const { history, before, afterMerge } = await mergedBeforeDeploy({ pre })
    const want = expected || { before, afterMerge }
    deploy()
    assert.ok(hasMarker(), 'the deploy added merge_deactivated_at')
    await expectComplete(history, 'undo', name)
    assert.equal(one('SELECT is_active FROM products WHERE id=11').is_active, 1, 'the duplicate is active again')
    assert.equal(business(), want.before, 'undo gives products, lots, costs and stock back exactly')
    assert.deepEqual(historyStatus(history.id), { status: 'redoable', reversible: 1 })
    await expectComplete(history, 'redo', name)
    assert.equal(one('SELECT is_active FROM products WHERE id=11').is_active, 0, 'merged away again')
    assert.equal(business(), want.afterMerge, 'redo reproduces the merged state')
    assert.equal(one('SELECT COUNT(*) n FROM product_batches WHERE merge_deactivated_at IS NOT NULL').n, 1, 'the redo (new build) marks the lot it folds')
    await expectComplete(history, 'undo', name + ' (after the redo)')
    assert.equal(business(), want.before, 'and gives everything back exactly again')
  })
}

async function refusedAfter(name, { between, pre = [], direction = 'undo' }) {
  await check(name, async () => {
    const { history } = await mergedBeforeDeploy({ pre })
    deploy()
    setSql(between)
    const before = everything()
    const error = await runHistory(history, direction).then(() => null, (e) => e)
    assert.ok(error, direction + ' must be refused')
    assert.equal(error.statusCode, 409, error.message)
    assert.equal(error.code, 'undo_record_changed', error.message)
    assert.equal(everything(), before, 'a refused ' + direction + ' writes nothing')
  })
}

async function main() {
  await cycle('single merge recorded before the deploy: undo, redo and undo complete after 0311, 0312, 0313, 0315', { pre: [LOTS] })
  await cycle('the same with 0313 rounding a catalog cost and a lot cost at once (the added column and rounding)', { pre: [LOTS, LONG], oracle: [LOTS, SHORT] })
  await check('merge and undo BEFORE the deploy, then the deploy, then redo and undo complete (the redo receipt predates 0311)', async () => {
    const { history, before, afterMerge } = await mergedBeforeDeploy({ pre: [LOTS] })
    legacyWriters = true
    try { await expectComplete(history, 'undo', 'pre-deploy') } finally { legacyWriters = false }
    assert.equal(business(), before)
    for (const snap of rows('SELECT payload_json FROM undo_snapshots')) assert.ok(!snap.payload_json.includes('merge_deactivated_at'))
    deploy()
    await expectComplete(history, 'redo', 'post-deploy')
    assert.equal(business(), afterMerge)
    await expectComplete(history, 'undo', 'post-deploy second')
    assert.equal(business(), before)
  })
  // Negative controls: coded 409, nothing written.
  await refusedAfter('control: another new column is refused', { pre: [LOTS], between: 'ALTER TABLE product_batches ADD COLUMN probe_marker TEXT' })
  await refusedAfter('control: a non-NULL merge_deactivated_at on an in-scope lot is refused', { pre: [LOTS], between: "UPDATE product_batches SET merge_deactivated_at = '2026-11-17 00:00:00' WHERE id = 900" })
  await refusedAfter('control: a changed real value (a lot note) is refused', { pre: [LOTS], between: "UPDATE product_batches SET notes = 'edited later' WHERE id = 900" })
  await refusedAfter('control: a lot cost moved by more than rounding is refused', { pre: [LOTS], between: 'UPDATE product_batches SET unit_cost_usd = 9 WHERE id = 900' })
  await refusedAfter('control: a marked lot beside 0313 rounding is refused', { pre: [LOTS, LONG], between: "UPDATE product_batches SET merge_deactivated_at = '2026-11-17 00:00:00' WHERE id = 900" })

  // The continuation guard of a multi-step Resolve across the deploy: the previous step's receipt predates 0311.
  await check('mergeCostContinuationGuard accepts the added column only (receipt saved before the deploy), and refuses a marked lot', async () => {
    const { history } = await mergedBeforeDeploy({ pre: [LOTS] })
    const snapshot = one("SELECT id,payload_json FROM undo_snapshots WHERE kind='product.merge' ORDER BY id DESC")
    const reversal = JSON.parse(snapshot.payload_json)
    assert.ok(reversal.costReviewState, 'the single merge saved its receipt')
    assert.ok(await undoAppliers.mergeCostContinuationGuard(adapter, reversal, snapshot.id, snapshot.payload_json), 'control: before the deploy the exact guard holds')
    deploy()
    const guard = await undoAppliers.mergeCostContinuationGuard(adapter, reversal, snapshot.id, snapshot.payload_json)
    assert.ok(guard && /merge_cost_continuation_guard/.test(guard.sql), 'accepted after the deploy: the receipt differs only by the added NULL column')
    assert.ok(state.native.db.prepare(guard.sql).get(guard.params), 'the returned guard holds against the live state')
    setSql("UPDATE product_batches SET merge_deactivated_at = '2026-11-17 00:00:00' WHERE id = 900")
    const error = await undoAppliers.mergeCostContinuationGuard(adapter, reversal, snapshot.id, snapshot.payload_json).then(() => null, (e) => e)
    assert.ok(error && /cost dependencies changed/.test(error.message), 'a marked lot is a real change: ' + (error && error.message))
    assert.ok(history)
  })
  console.log(failed ? '\\n' + failed + ' check(s) failed' : '\\nall checks passed')
  process.exitCode = failed ? 1 : 0
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
`
const runner = new Module(__filename, module)
runner.filename = __filename
runner.paths = module.paths
runner._compile(prelude + prepared + checks, __filename)
