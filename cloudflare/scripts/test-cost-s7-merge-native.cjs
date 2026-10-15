const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const harnessBase = fs.readFileSync(path.join(__dirname, 'test-product-resolve-keep-merge-native.cjs'), 'utf8')
  .split(String.fromCharCode(13, 10)).join(String.fromCharCode(10)).split('async function main() {')[0]
if (!harnessBase.includes('const merge = (body)')) throw new Error('the harness anchors moved')
const checks = `
const keeperCost = (id = 10) => one('SELECT cost_price_usd, cost_price_khr FROM products WHERE id = ?', id)
const setCosts = (id, usd, khr) => {
  fixtureWrite(() => state.native.db.prepare('UPDATE products SET cost_price_usd = ?, cost_price_khr = ? WHERE id = ?').run(usd, khr, id))
  assert.throws(() => state.native.db.prepare('UPDATE products SET cost_price_usd=cost_price_usd WHERE id=?').run(id), /stock_transaction_required/)
}
const lastHistory = () => one("SELECT id, undo_payload, redo_payload FROM action_history WHERE status = 'undoable' ORDER BY id DESC LIMIT 1")
const runHistory = async (history, direction) => {
  const current = one('SELECT id,undo_payload,redo_payload FROM action_history WHERE id=?', history.id)
  const payload = JSON.parse(direction === 'undo' ? current.undo_payload : current.redo_payload)
  const applier = undoAppliers.resolveUndoApplier(payload)
  await applier.run(payload, { env: { DB: {} }, user: ADMIN, direction, historyId: history.id, generation: payload.generation ?? 0 })
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

  await check('current merge retains the original unknown keeper without eligible lot evidence', async () => {
    fresh()
    setCosts(10, null, null)
    assert.equal((await merge({ keepId: 10, mergeId: 11, keep: true, stock: 'merge' })).status, 200)
    assert.deepEqual(keeperCost(), { cost_price_usd: null, cost_price_khr: null })
    assert.ok(one('SELECT cost_review_key FROM products WHERE id=10').cost_review_key)
    fresh()
    setCosts(11, null, null)
    assert.equal((await merge({ keepId: 10, mergeId: 11, keep: true, stock: 'merge' })).status, 200)
    assert.deepEqual(keeperCost(), { cost_price_usd: 5, cost_price_khr: 20500 }, 'an unknown twin never lowers the keeper cost')
  })

  await check('current merge retains recorded zero without eligible lot evidence', async () => {
    fresh()
    setCosts(10, 0, 0)
    assert.equal((await merge({ keepId: 10, mergeId: 11, keep: true, stock: 'merge' })).status, 200)
    assert.deepEqual(keeperCost(), { cost_price_usd: 0, cost_price_khr: 0 })
  })

  await check('merge of two recorded 0 costs keeps a recorded 0', async () => {
    fresh()
    setCosts(10, 0, 0); setCosts(11, 0, 0)
    assert.equal((await merge({ keepId: 10, mergeId: 11, keep: true, stock: 'merge' })).status, 200)
    assert.deepEqual(keeperCost(), { cost_price_usd: 0, cost_price_khr: 0 })
  })

  await check('historical legacy fold keeps the original known-cost fill controls', async () => {
    for (const value of [null,0]) {
      fresh(); setCosts(10,value,value)
      assert.equal((await legacyMerge({keepId:10,mergeId:11,keep:true,stock:'merge'})).status,200)
      assert.deepEqual(keeperCost(),{cost_price_usd:7,cost_price_khr:28700})
    }
  })

  await check('current cost-hidden actor uses the same unknown and zero fallback without an envelope', async () => {
    for (const value of [null,0]) {
      fresh();setCosts(10,value,value);state.user=MANAGER
      const done=await merge({keepId:10,mergeId:11,keep:true,stock:'merge'})
      assert.equal(done.status,200,JSON.stringify(done.body))
      assert.deepEqual(keeperCost(),{cost_price_usd:value,cost_price_khr:value})
      assert.equal(Object.hasOwn(done.body.keeper,'cost_price_usd'),false)
    }
  })

  await check('current unknown keeper derives from received lot cost rather than loser catalog', async () => {
    fresh();setCosts(10,null,null)
    fixtureWrite(() => state.native.db.exec("INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,unit_cost_usd) VALUES(900,11,'known-receipt',1,8);INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(900,1,1),(900,2,1)"))
    assert.equal((await merge({keepId:10,mergeId:11,keep:true,stock:'merge'})).status,200)
    assert.deepEqual(keeperCost(),{cost_price_usd:8,cost_price_khr:null})
    assert.equal(one('SELECT cost_review_key FROM products WHERE id=10').cost_review_key,null)
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

  await check('current undo preserves unknown and known original keeper costs', async () => {
    fresh()
    setCosts(10, null, null)
    assert.equal((await merge({ keepId: 10, mergeId: 11, keep: true, stock: 'merge' })).status, 200)
    assert.equal(keeperCost().cost_price_usd, null)
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
    assert.equal((await legacyMerge({ keepId: 10, mergeId: 11, keep: true, stock: 'merge' })).status, 200)
    const history = lastHistory()
    const saved = one("SELECT id, payload_json FROM undo_snapshots WHERE kind = 'product.merge' ORDER BY id DESC")
    const reversal = JSON.parse(saved.payload_json)
    delete reversal.keeperPricingBefore.cost_price_usd
    delete reversal.keeperPricingBefore.cost_price_khr
    delete reversal.mergedStateFingerprint
    delete reversal.fingerprintPending
    delete reversal.keeperCatalogBefore
    delete reversal.keeperBarcodeBefore
    delete reversal.keeperParentIdBefore
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

  await check('pair authority keeps unknown while legacy identity-fill metadata stays compatible', async () => {
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
    assert.equal(filled.body.costAuthority.cost_price_usd,null)
    assert.equal(filled.body.costAuthority.cost_price_khr,null)
    assert.equal(filled.body.costAuthority.needsReview,true)
  })

  await check('Resolve authority preserves unknown independently from legacy group mean metadata', async () => {
    fresh()
    fixtureWrite(() => state.native.db.exec("INSERT INTO products (id, name, barcode, cost_price_usd, cost_price_khr, selling_price_usd, is_active) VALUES (60, 'Lip Oil', '600001', NULL, NULL, 10, 1), (61, 'Lip Oil', '600002', NULL, NULL, 10, 1), (62, 'Lip Oil', '600003', NULL, NULL, 10, 1)"))
    const unknown = await preview(60, 61, '&groupIds=60,61,62')
    assert.equal(unknown.status, 200, JSON.stringify(unknown.body))
    assert.deepEqual(unknown.body.groupCost, { cost_price_usd: null, cost_price_khr: null })
    setCosts(62, 6, null)
    const partial = await preview(60, 61, '&groupIds=60,61,62')
    assert.deepEqual(partial.body.groupCost, { cost_price_usd: 6, cost_price_khr: null })
    assert.equal(partial.body.costAuthority.cost_price_usd,null)
    assert.equal(partial.body.costAuthority.cost_price_khr,null)
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
    assert.equal(filledGroup.costAfter.cost_price_usd, null, 'a catalog-only loser does not establish an unknown keeper cost')
    assert.equal(filledGroup.costAuthority.needsReview, true)
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
