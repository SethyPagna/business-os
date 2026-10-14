// Release 3, slice S7 -- product merges keep an unknown cost unknown.
// Owner rule (14 Oct 2026): "if it is none, it should also be unknown." Products are name groups of self-describing child
// rows; a merge folds one row into another and Undo is a compensating record that restores NULL exactly.
//
//   merge NULL + NULL -> NULL (base: 0)        merge NULL + 7 -> 7        merge 5 + NULL -> 5
//   Undo / redo of a merge restores the keeper's cost exactly, NULL included (base: 0)
//   the stock the fold moves is recorded with an UNKNOWN cost, not the DEFAULT 0 of an omitted column
//   previews report null for an unknown cost (base: 0)
//   the averaging formula itself is NOT changed here (Q2): a recorded 0 is still not weighed into a mean
//
// Real routes/products.ts, the real fold, identity, merge and undo code on the full migration chain, through the harness of
// test-product-resolve-keep-merge-native.cjs (everything above its main()).
//
// Run (from cloudflare/scripts): node test-cost-s7-merge-native.cjs
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const harnessBase = fs.readFileSync(path.join(__dirname, 'test-product-resolve-keep-merge-native.cjs'), 'utf8')
  .split(String.fromCharCode(13, 10)).join(String.fromCharCode(10)).split('async function main() {')[0]
if (!harnessBase.includes('const merge = (body)')) throw new Error('the harness anchors moved')
const checks = `
const keeperCost = (id = 10) => one('SELECT cost_price_usd, cost_price_khr FROM products WHERE id = ?', id)
const setCosts = (id, usd, khr) => state.native.db.prepare('UPDATE products SET cost_price_usd = ?, cost_price_khr = ? WHERE id = ?').run(usd, khr, id)
const lastHistory = () => one("SELECT id, undo_payload, redo_payload FROM action_history WHERE status = 'undoable' ORDER BY id DESC LIMIT 1")
const runHistory = async (history, direction) => {
  const payload = JSON.parse(direction === 'undo' ? history.undo_payload : history.redo_payload)
  const applier = undoAppliers.resolveUndoApplier(payload)
  await applier.run(payload, { env: { DB: {} }, user: ADMIN, direction, historyId: history.id })
}
const adjustmentCosts = () => rows("SELECT product_id, quantity, unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr FROM inventory_movements WHERE movement_type = 'adjustment' ORDER BY id")

async function main() {
  await check('merge NULL + NULL -> the keeper stays NULL (base wrote 0)', async () => {
    fresh()
    setCosts(10, null, null); setCosts(11, null, null)
    const done = await merge({ keepId: 10, mergeId: 11, keep: true, stock: 'merge' })
    assert.equal(done.status, 200, JSON.stringify(done.body))
    assert.deepEqual(keeperCost(), { cost_price_usd: null, cost_price_khr: null })
    assert.deepEqual(keeperCost(11), { cost_price_usd: null, cost_price_khr: null }, 'the merged-away row keeps its own unknown cost')
  })

  await check('merge NULL + a real cost takes the real cost, in either direction (control)', async () => {
    fresh()
    setCosts(10, null, null)
    assert.equal((await merge({ keepId: 10, mergeId: 11, keep: true, stock: 'merge' })).status, 200)
    assert.deepEqual(keeperCost(), { cost_price_usd: 7, cost_price_khr: 28700 })
    fresh()
    setCosts(11, null, null)
    assert.equal((await merge({ keepId: 10, mergeId: 11, keep: true, stock: 'merge' })).status, 200)
    assert.deepEqual(keeperCost(), { cost_price_usd: 5, cost_price_khr: 20500 }, 'an unknown twin never lowers the keeper cost')
  })

  await check('merge a recorded 0 + a real cost still uses the real cost: the averaging formula is unchanged (Q2 control)', async () => {
    fresh()
    setCosts(10, 0, 0)
    assert.equal((await merge({ keepId: 10, mergeId: 11, keep: true, stock: 'merge' })).status, 200)
    assert.deepEqual(keeperCost(), { cost_price_usd: 7, cost_price_khr: 28700 })
  })

  await check('merge of two recorded 0 costs keeps a recorded 0', async () => {
    fresh()
    setCosts(10, 0, 0); setCosts(11, 0, 0)
    assert.equal((await merge({ keepId: 10, mergeId: 11, keep: true, stock: 'merge' })).status, 200)
    assert.deepEqual(keeperCost(), { cost_price_usd: 0, cost_price_khr: 0 })
  })

  await check('undo and redo of a NULL + NULL merge restore NULL exactly (base: 0)', async () => {
    fresh()
    setCosts(10, null, null); setCosts(11, null, null)
    assert.equal((await merge({ keepId: 10, mergeId: 11, keep: true, stock: 'merge' })).status, 200)
    const history = lastHistory()
    assert.ok(history, 'the merge is undoable')
    const snapshot = JSON.parse(one("SELECT payload_json FROM undo_snapshots WHERE kind = 'product.merge' ORDER BY id DESC").payload_json)
    assert.deepEqual([snapshot.keeperPricingBefore.cost_price_usd, snapshot.keeperPricingBefore.cost_price_khr], [null, null], 'the snapshot carries the unknown cost, not 0')
    await runHistory(history, 'undo')
    assert.deepEqual(keeperCost(), { cost_price_usd: null, cost_price_khr: null })
    assert.equal(one('SELECT is_active FROM products WHERE id = 11').is_active, 1)
    await runHistory(history, 'redo')
    assert.deepEqual(keeperCost(), { cost_price_usd: null, cost_price_khr: null })
  })

  await check('undo of a NULL keeper that took a real cost puts NULL back, not 0; and a costed keeper comes back at its cost (control)', async () => {
    fresh()
    setCosts(10, null, null)
    assert.equal((await merge({ keepId: 10, mergeId: 11, keep: true, stock: 'merge' })).status, 200)
    assert.equal(keeperCost().cost_price_usd, 7)
    await runHistory(lastHistory(), 'undo')
    assert.deepEqual(keeperCost(), { cost_price_usd: null, cost_price_khr: null })
    fresh()
    setCosts(11, null, null)
    assert.equal((await merge({ keepId: 10, mergeId: 11, keep: true, stock: 'merge' })).status, 200)
    await runHistory(lastHistory(), 'undo')
    assert.deepEqual(keeperCost(), { cost_price_usd: 5, cost_price_khr: 20500 })
  })

  await check('a snapshot that recorded no cost at all (older than Sep 4 2026) leaves the keeper cost alone on undo', async () => {
    fresh()
    setCosts(10, 5, 20500)
    assert.equal((await merge({ keepId: 10, mergeId: 11, keep: true, stock: 'merge' })).status, 200)
    const history = lastHistory()
    const saved = one("SELECT id, payload_json FROM undo_snapshots WHERE kind = 'product.merge' ORDER BY id DESC")
    const reversal = JSON.parse(saved.payload_json)
    delete reversal.keeperPricingBefore.cost_price_usd
    delete reversal.keeperPricingBefore.cost_price_khr
    state.native.db.prepare('UPDATE undo_snapshots SET payload_json = ? WHERE id = ?').run(JSON.stringify(reversal), saved.id)
    setCosts(10, 6, 24600)
    await runHistory(history, 'undo')
    assert.deepEqual(keeperCost(), { cost_price_usd: 6, cost_price_khr: 24600 }, 'no recorded cost means no cost write on undo')
  })

  await check('the stock a merge moves onto the keeper is recorded with an unknown cost, not the DEFAULT 0 (base: 0 in all four columns)', async () => {
    fresh()
    assert.equal((await merge({ keepId: 10, mergeId: 11, keep: true, stock: 'merge' })).status, 200)
    const moved = adjustmentCosts()
    assert.ok(moved.length >= 2, 'one movement per branch of the merged-away product')
    for (const movement of moved) {
      assert.deepEqual([movement.unit_cost_usd, movement.unit_cost_khr, movement.total_cost_usd, movement.total_cost_khr], [null, null, null, null])
    }
  })

  await check('the stock a merge writes off is recorded with an unknown cost too', async () => {
    fresh()
    const done = await merge({ keepId: 10, mergeId: 11, keep: true, stock: 'write_off' })
    assert.equal(done.status, 200, JSON.stringify(done.body))
    const written = adjustmentCosts()
    assert.ok(written.length >= 1)
    for (const movement of written) {
      assert.equal(movement.quantity < 0, true)
      assert.deepEqual([movement.unit_cost_usd, movement.unit_cost_khr, movement.total_cost_usd, movement.total_cost_khr], [null, null, null, null])
    }
  })

  await check('the pair preview says null for an unknown cost and fills a keeper whose cost is unknown (base: 0)', async () => {
    fresh()
    setCosts(10, null, null); setCosts(11, null, null)
    const bothUnknown = await preview(10, 11)
    assert.equal(bothUnknown.status, 200, JSON.stringify(bothUnknown.body))
    assert.deepEqual(bothUnknown.body.identity.costBefore, { cost_price_usd: null, cost_price_khr: null })
    assert.deepEqual(bothUnknown.body.identity.costAfter, { cost_price_usd: null, cost_price_khr: null })
    assert.deepEqual(bothUnknown.body.identity.costFill, [])
    fresh()
    setCosts(10, null, null)
    const filled = await preview(10, 11)
    assert.deepEqual(filled.body.identity.costBefore, { cost_price_usd: null, cost_price_khr: null })
    assert.deepEqual(filled.body.identity.costAfter, { cost_price_usd: 7, cost_price_khr: 28700 })
    assert.deepEqual(filled.body.identity.costFill.map((fill) => [fill.field, fill.value]), [['cost_price_usd', 7], ['cost_price_khr', 28700]])
  })

  await check('the Resolve group cost is null when every cost in the group is unknown, the mean of the known ones otherwise (base: 0)', async () => {
    fresh()
    state.native.db.exec("INSERT INTO products (id, name, barcode, cost_price_usd, cost_price_khr, selling_price_usd, is_active) VALUES (60, 'Lip Oil', '600001', NULL, NULL, 10, 1), (61, 'Lip Oil', '600002', NULL, NULL, 10, 1), (62, 'Lip Oil', '600003', NULL, NULL, 10, 1)")
    const unknown = await preview(60, 61, '&groupIds=60,61,62')
    assert.equal(unknown.status, 200, JSON.stringify(unknown.body))
    assert.deepEqual(unknown.body.groupCost, { cost_price_usd: null, cost_price_khr: null })
    setCosts(62, 6, null)
    const partial = await preview(60, 61, '&groupIds=60,61,62')
    assert.deepEqual(partial.body.groupCost, { cost_price_usd: 6, cost_price_khr: null })
  })

  await check('the whole-catalog dry run reports null before and after for a duplicate group whose costs are unknown (base: 0)', async () => {
    fresh()
    setCosts(20, null, null); setCosts(21, null, null)
    const dry = await request('GET', '/api/products/merge-duplicates/preview')
    assert.equal(dry.status, 200, JSON.stringify(dry.body))
    const group = dry.body.groups.find((candidate) => [20, 21].includes(candidate.canonicalId))
    assert.ok(group, JSON.stringify(dry.body.groups.map((candidate) => candidate.canonicalId)))
    assert.deepEqual(group.costBefore, { cost_price_usd: null, cost_price_khr: null })
    assert.deepEqual(group.costAfter, { cost_price_usd: null, cost_price_khr: null })
    fresh()
    setCosts(20, null, null)
    const filled = await request('GET', '/api/products/merge-duplicates/preview')
    const filledGroup = filled.body.groups.find((candidate) => [20, 21].includes(candidate.canonicalId))
    assert.equal(filledGroup.costAfter.cost_price_usd, 11, 'the known cost fills the unknown one')
  })

  console.log(failed ? '\\n' + failed + ' check(s) failed' : '\\nall checks passed')
  process.exitCode = failed ? 1 : 0
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
`
const runner = new Module(__filename, module)
runner.filename = __filename
runner.paths = module.paths
runner._compile(harnessBase + checks, __filename)
