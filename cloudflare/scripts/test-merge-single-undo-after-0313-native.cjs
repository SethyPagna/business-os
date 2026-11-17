const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
// A single (Resolve / pair) merge, then migration 0313, then undo and redo through the REAL undo applier (replayMergeCostReview), the real fold, the real
// 0313 file, the full migration chain in SQLite. The receipt of a single merge is a graph state plus the two products' revisions; 0313 rounds long costs
// to 4 places and bumps those revisions. Undo and redo must complete across exactly that, and nowhere else:
//   * the lazy retry replaces the stale exact guard (a mutant that pushed the accepted guard next to the stale one answered 409 "changed concurrently")
//   * the normal path makes no live read (pinned by D1 calls and statements: an eager read goes red)
//   * the revision may differ by exactly 0313's bumps (+1 a KHR column, +2 a USD column as well), never a range (+3 is refused)
//   * NULL against a number is never rounding, whatever the saved number
const harnessBase = fs.readFileSync(path.join(__dirname, 'test-product-resolve-keep-merge-native.cjs'), 'utf8')
  .split(String.fromCharCode(13, 10)).join(String.fromCharCode(10)).split('async function main() {')[0]
if (!harnessBase.includes('const merge = (body)')) throw new Error('the harness anchors moved')
const checks = `
const text0313 = fs.readFileSync(path.join(__dirname, '../migrations/0313_cost_4dp_repair.sql'), 'utf8')
const lastHistory = () => one("SELECT id, undo_payload, redo_payload FROM action_history WHERE status = 'undoable' ORDER BY id DESC LIMIT 1")
const runHistory = async (history, direction) => {
  const current = one('SELECT id,undo_payload,redo_payload FROM action_history WHERE id=?', history.id)
  const payload = JSON.parse(direction === 'undo' ? current.undo_payload : current.redo_payload)
  const applier = undoAppliers.resolveUndoApplier(payload)
  await applier.run(payload, { env: { DB: {} }, user: ADMIN, direction, historyId: history.id, generation: payload.generation ?? 0 })
}
const setSql = (sql) => fixtureWrite(() => state.native.db.exec(sql))
const LONG = {
  khr: 'UPDATE products SET cost_price_khr = 28700.123456 WHERE id = 11',
  usd: 'UPDATE products SET cost_price_usd = 7.123456, purchase_price_usd = 7.123456 WHERE id = 11',
  keeper: 'UPDATE products SET cost_price_usd = 5.123456789012345, cost_price_khr = 20500.12345678901 WHERE id = 10',
  lot: "INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,unit_cost_usd) VALUES(901,11,'long-lot',1,6.123456); INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(901,1,1)",
}
const everything = () => JSON.stringify([
  rows('SELECT * FROM products WHERE id IN (10,11) ORDER BY id'), rows('SELECT * FROM product_batches ORDER BY id'),
  rows('SELECT * FROM branch_stock ORDER BY product_id, branch_id'), rows('SELECT * FROM branch_batch_stock ORDER BY batch_id, branch_id'),
  rows('SELECT id,status,reversible,undo_payload,redo_payload FROM action_history ORDER BY id'),
  rows('SELECT id,status,payload_json FROM undo_snapshots ORDER BY id'), rows('SELECT COUNT(*) n FROM audit_logs'),
  rows('SELECT COUNT(*) n, MAX(id) m FROM inventory_movements')])
async function counted(fn) {
  const real = { prepare: adapter.prepare, batch: adapter.batch }
  const meter = { calls: 0, statements: 0 }
  adapter.prepare = (sql) => {
    const statement = real.prepare(sql)
    const wrap = (key) => (params) => { meter.calls += 1; meter.statements += 1; return statement[key](params) }
    return { get: wrap('get'), all: wrap('all'), run: wrap('run') }
  }
  adapter.batch = (statements) => { meter.calls += 1; meter.statements += statements.length; return real.batch(statements) }
  try { const error = await fn().then(() => null, (e) => e); return { error, ...meter } } finally { adapter.prepare = real.prepare; adapter.batch = real.batch }
}
const keeperAndDup = () => rows('SELECT id,is_active,name,cost_price_usd,purchase_price_usd,cost_price_khr FROM products WHERE id IN (10,11) ORDER BY id')
const historyStatus = (id) => one('SELECT status,reversible FROM action_history WHERE id=?', id)

// pre: SQL before the merge. run0313: the real 0313 after the merge. between: SQL after the merge (and 0313).
async function merged({ pre = [], run0313 = false, between = [] } = {}) {
  fresh()
  for (const sql of pre) setSql(sql)
  const done = await merge({ keepId: 10, mergeId: 11, keep: true, stock: 'merge' })
  assert.equal(done.status, 200, JSON.stringify(done.body))
  const history = lastHistory()
  assert.ok(history, 'the merge is undoable')
  let ledger = []
  if (run0313) { state.native.db.exec(text0313); ledger = rows('SELECT entity,row_id,col FROM cost_4dp_repair_0313 ORDER BY entity,row_id,col') }
  for (const sql of between) setSql(sql)
  return { history, ledger }
}

async function main() {
  // --- The normal path: a merge, an undo and a redo with nothing between them. Pinned: no live read happens until a guard has failed. ---
  await check('normal single undo and redo: complete, and the D1 calls and statements are the pinned ones (an eager live read is red)', async () => {
    const { history } = await merged({ pre: [LONG.khr] })
    const undo = await counted(() => runHistory(history, 'undo'))
    assert.equal(undo.error, null, String(undo.error && undo.error.message))
    assert.equal(one('SELECT is_active FROM products WHERE id=11').is_active, 1)
    const redo = await counted(() => runHistory(history, 'redo'))
    assert.equal(redo.error, null, String(redo.error && redo.error.message))
    assert.equal(one('SELECT is_active FROM products WHERE id=11').is_active, 0)
    console.log('PINS undo ' + undo.calls + '/' + undo.statements + ' redo ' + redo.calls + '/' + redo.statements)
    assert.deepEqual([undo.calls, undo.statements], PIN_UNDO, 'single undo calls/statements')
    assert.deepEqual([redo.calls, redo.statements], PIN_REDO, 'single redo calls/statements')
  })

  // --- 0313 between the merge and the undo: every shape completes (the end-to-end test the lazy retry lacked). ---
  for (const [name, pre, ledgerCols] of [
    ['the duplicate KHR cost long', [LONG.khr], ['cost_price_khr']],
    ['the duplicate cost and purchase USD long', [LONG.usd], ['cost_price_usd', 'purchase_price_usd']],
    ['the keeper cost long (the merge itself rounds it)', [LONG.keeper], null],
    ['a lot of the duplicate long', [LONG.lot], ['unit_cost_usd']],
  ]) {
    await check('single merge, 0313, then undo completes: ' + name, async () => {
      const { history, ledger } = await merged({ pre, run0313: true })
      if (ledgerCols) assert.deepEqual(ledger.map((r) => r.col), ledgerCols, 'the ledger shows what 0313 rounded')
      const before = everything()
      const undo = await counted(() => runHistory(history, 'undo'))
      assert.equal(undo.error, null, 'undo refused: ' + (undo.error && undo.error.code + ' ' + undo.error.message))
      assert.equal(one('SELECT is_active FROM products WHERE id=11').is_active, 1, 'the duplicate is active again')
      assert.notEqual(everything(), before)
      assert.deepEqual(historyStatus(history.id), { status: 'redoable', reversible: 1 })
      for (const column of ['cost_price_usd', 'purchase_price_usd', 'cost_price_khr']) {
        for (const id of [10, 11]) assert.equal(Number(one('SELECT ' + column + ' v FROM products WHERE id=?', id).v.toFixed(4)), one('SELECT ' + column + ' v FROM products WHERE id=?', id).v, column + ' of ' + id + ' is at 4 places')
      }
      // The rounded path may read the live receipt once and commit once: bounded, not a loop.
      assert.ok(undo.calls <= 30, 'undo used ' + undo.calls + ' calls')
      const redo = await counted(() => runHistory(history, 'redo'))
      assert.equal(redo.error, null, 'redo refused: ' + (redo.error && redo.error.code + ' ' + redo.error.message))
      assert.equal(one('SELECT is_active FROM products WHERE id=11').is_active, 0, 'the duplicate is merged away again')
    })
  }
  await check('single merge, undo, then 0313, then redo completes (the redo-side retry)', async () => {
    const { history } = await merged({ pre: [LONG.khr] })
    assert.equal((await counted(() => runHistory(history, 'undo'))).error, null)
    state.native.db.exec(text0313)
    const redo = await counted(() => runHistory(history, 'redo'))
    assert.equal(redo.error, null, 'redo refused: ' + (redo.error && redo.error.code + ' ' + redo.error.message))
    assert.equal(one('SELECT is_active FROM products WHERE id=11').is_active, 0)
    assert.deepEqual(historyStatus(history.id), { status: 'undoable', reversible: 1 })
  })

  // --- Refusals: a real change next to 0313's rounding is still refused, coded 409, nothing written. ---
  for (const [name, between] of [
    ['a name change', ["UPDATE products SET name = 'Changed after 0313' WHERE id = 11"]],
    ['the cost one tick from its rounding', ['UPDATE products SET cost_price_khr = 28700.1236 WHERE id = 11']],
    ['a selling price that "rounds"', ['UPDATE products SET selling_price_usd = 15.123456 WHERE id = 11']],
    ['the revision bumped once more by a no-op write', ['UPDATE products SET name = name WHERE id = 11']],
  ]) {
    await check('single merge, 0313, then ' + name + ': undo refused, nothing written', async () => {
      const { history } = await merged({ pre: [LONG.khr], run0313: true, between })
      const before = everything()
      const undo = await counted(() => runHistory(history, 'undo'))
      assert.ok(undo.error, 'undo must be refused')
      assert.equal(undo.error.statusCode, 409, undo.error.message)
      assert.equal(undo.error.code, 'undo_record_changed', undo.error.message)
      assert.equal(everything(), before, 'a refused undo writes nothing')
      assert.equal(one('SELECT is_active FROM products WHERE id=11').is_active, 0)
    })
  }

  // --- The revision rule is exact, never a range (+1 a KHR column, +2 a USD column as well). ---
  await check('costRoundedReplayState: the revision may differ by exactly 0313\\'s bumps, +3 and every other difference is refused', async () => {
    const { history } = await merged({ pre: [LONG.khr], run0313: true })
    const snapshot = one("SELECT id,payload_json FROM undo_snapshots WHERE kind='product.merge' ORDER BY id DESC")
    const reversal = JSON.parse(snapshot.payload_json)
    const receipt = reversal.costReviewState
    assert.ok(receipt && Number.isSafeInteger(receipt.duplicate_revision), 'the single merge saved its receipt')
    const schema = await undoAppliers.mergeReplayColumns(adapter)
    const graph = undoAppliers.mergeReplayGraphSql(reversal, schema)
    const liveRevision = (id) => Number(one("SELECT COALESCE((SELECT revision FROM stock_session_revisions WHERE entity_type='product' AND entity_key=?),0) r", String(id)).r)
    const accepted = await undoAppliers.costRoundedReplayState(adapter, reversal, receipt, graph)
    assert.notEqual(accepted, receipt, 'the saved receipt as it was is accepted as 0313-rounded')
    assert.equal(accepted.duplicate_revision, liveRevision(11))
    assert.equal(liveRevision(11) - receipt.duplicate_revision, 1, 'a KHR column: 0313 bumped the duplicate once')
    // The same receipt with its saved revision moved so the live difference is d: only d = 1 (0313's own bumps) is accepted.
    for (const d of [0, 2, 3, 4]) {
      const tampered = { ...receipt, duplicate_revision: liveRevision(11) - d }
      assert.equal(await undoAppliers.costRoundedReplayState(adapter, reversal, tampered, graph), tampered, 'a revision difference of ' + d + ' is refused')
    }
    const keeperOff = { ...receipt, keeper_revision: liveRevision(10) - 1 }
    assert.equal(await undoAppliers.costRoundedReplayState(adapter, reversal, keeperOff, graph), keeperOff, 'the keeper was not rounded: +1 is refused')
    assert.equal(one('SELECT is_active FROM products WHERE id=11').is_active, 0, history && 'nothing was undone by the probe')
  })
  await check('costRoundedReplayState: a USD column rounded too is +2 exactly (+3 refused, +1 refused)', async () => {
    await merged({ pre: [LONG.usd], run0313: true })
    const reversal = JSON.parse(one("SELECT payload_json FROM undo_snapshots WHERE kind='product.merge' ORDER BY id DESC").payload_json)
    const receipt = reversal.costReviewState
    const schema = await undoAppliers.mergeReplayColumns(adapter)
    const graph = undoAppliers.mergeReplayGraphSql(reversal, schema)
    const live = Number(one("SELECT COALESCE((SELECT revision FROM stock_session_revisions WHERE entity_type='product' AND entity_key='11'),0) r").r)
    assert.equal(live - receipt.duplicate_revision, 2, 'two bumps by 0313')
    assert.notEqual(await undoAppliers.costRoundedReplayState(adapter, reversal, receipt, graph), receipt, 'exactly +2 is accepted')
    for (const d of [1, 3, 4]) {
      const tampered = { ...receipt, duplicate_revision: live - d }
      assert.equal(await undoAppliers.costRoundedReplayState(adapter, reversal, tampered, graph), tampered, 'a difference of ' + d + ' is refused')
    }
  })

  // --- NULL against a number is never rounding, in every comparator this lane added. ---
  await check('NULL is never the rounding of a saved cost (comparators)', async () => {
    const forms = catalogCost
    for (const saved of [0.00004, -0.00004, 0.00001, 5.123456, 0]) {
      assert.equal(forms.isCostRoundingOf(saved, null), false, 'live NULL, saved ' + saved)
      assert.equal(forms.isCostRoundingOf(saved, undefined), false)
      assert.equal(forms.isCostRoundingOf(null, saved), false, 'saved NULL, live ' + saved)
    }
    const products = (cost) => JSON.stringify({ products: [{ id: 1, cost_price_khr: cost }], batches: [], childProducts: [], promotionRules: [] })
    assert.equal(undoAppliers.mergeFingerprintDiffersOnlyByCostRounding(products(24600.123456), products(24600.1235)), true, 'control: a rounded cost')
    for (const [saved, live] of [[0.00004, null], [-0.00004, null], [null, 0.00004], [null, 0], [0, null], [24600.123456, null]]) {
      assert.equal(undoAppliers.mergeFingerprintDiffersOnlyByCostRounding(products(saved), products(live)), false, 'fingerprint ' + saved + ' -> ' + live)
    }
    const graphState = (cell) => JSON.stringify({ products: [['id', 'cost_price_khr'], [[[['integer', 1], cell]]]] })
    assert.notEqual(undoAppliers.mergeGraphStateCostRounding(graphState(['real', 24600.123456]), graphState(['real', 24600.1235])), null, 'control: a rounded graph cell')
    for (const [saved, live] of [[['real', 0.00004], ['null', null]], [['real', -0.00004], ['null', null]], [['null', null], ['real', 0.5]], [['null', null], ['integer', 0]]]) {
      assert.equal(undoAppliers.mergeGraphStateCostRounding(graphState(saved), graphState(live)), null, 'graph ' + JSON.stringify(saved) + ' -> ' + JSON.stringify(live))
    }
  })

  console.log(failed ? '\\n' + failed + ' check(s) failed' : '\\nall checks passed')
  process.exitCode = failed ? 1 : 0
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
`
const PIN = { undo: [8, 47], redo: [13, 87] } // measured at 7aa09848b, before any of this round's changes (the harness counts a prepare as one call and one statement)
const runner = new Module(__filename, module)
runner.filename = __filename
runner.paths = module.paths
runner._compile(harnessBase + checks.replace('PIN_UNDO', JSON.stringify(PIN.undo)).replace('PIN_REDO', JSON.stringify(PIN.redo)), __filename)
