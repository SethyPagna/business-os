const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const harness = fs.readFileSync(path.join(__dirname, 'test-product-resolve-choices-native.cjs'), 'utf8').replaceAll('\r\n','\n').split('async function main() {')[0]
  .replace("const undoAppliers = load('lib/undoAppliers.ts', {", "const stockTransaction = load('lib/stockTransaction.ts')\nconst costReview = load('lib/productCostReview.ts', { './catalogCostRecompute': catalogCost })\nconst undoAppliers = load('lib/undoAppliers.ts', {\n  './stockTransaction': stockTransaction,\n  './productCostReview': costReview,")
  .replace("const products = load('routes/products.ts', {", "const productModule = load('routes/products.ts', {\n  '../lib/stockTransaction': stockTransaction,\n  '../lib/productCostReview': costReview,")
  .replace("}).default\nconst app = new Hono()", "})\nconst products = productModule.default\nconst app = new Hono()")
const checks = `
async function main() {
  const historyRoutes = load('routes/actionHistory.ts', {
    '../lib/stockTransaction': stockTransaction,
    '../lib/db': { getDb: () => adapter },
    '../lib/auth': { requireAuth: async (c, next) => { c.set('user', state.user); return next() } },
    '../lib/acquisitionCostAccess': { acquisitionCostResponses: async (_c, next) => next(), hasAcquisitionCostInput: () => false },
    '../lib/permissions': permissions,
    '../lib/undoAppliers': undoAppliers,
    '../lib/audit': noAudit,
    '../lib/actorSnapshot': actorSnapshot,
    '../lib/saleBulkUpdate': { SALE_BULK_UPDATE_KINDS: new Set() },
  }).default
  app.route('/api/action-history', historyRoutes)
  const sameOwner = { ...EDITOR, id: 3, permissions: JSON.stringify({ products: true, product_cost_edit: true }) }
  const demoted = { ...sameOwner, permissions: JSON.stringify({ products: true, 'products:edit': false, product_cost_edit: false }) }
  async function merged(choices, cost) {
    fresh()
    state.user = sameOwner
    const seen = await preview(KEEP, M1, '&groupIds=' + KEEP + ',' + M1)
    const resolve = { requestId: 'permission-' + crypto.randomUUID(), reviewedDigest: seen.body.reviewedDigest, steps: [{ mergeId: M1 }] }
    const body = { keepId: KEEP, mergeId: M1, keep: true, resolve, choices, ...(cost ? { cost_price_usd: cost === 'null' ? null : cost === 'zero' ? 0 : 4.1234 } : {}) }
    if (cost) {
      const before=dump(), response=await merge(body)
      assert.equal(response.status,400,JSON.stringify(response.body))
      assert.equal(response.body.code,'invalid_merge_cost')
      assert.equal(dump(),before)
      const keeper=one('SELECT * FROM products WHERE id=?',KEEP),discarded=one('SELECT * FROM products WHERE id=?',M1)
      await productModule.foldDuplicateProductInto({DB:{}},adapter,state.user,keeper,discarded,new Map([[1,'Main'],[2,'Second']]),'legacy permission receipt','merge',undefined,{operationId:crypto.randomUUID()},{follows:true,cost:{cost_price_usd:body.cost_price_usd}})
    } else {
      const response=await merge(body)
      assert.equal(response.status,200,JSON.stringify(response.body))
    }
    return one("SELECT * FROM action_history WHERE entity='product' AND status='undoable' ORDER BY id DESC LIMIT 1")
  }
  const replay = (history, direction, user) => {
    const current=one('SELECT * FROM action_history WHERE id=?',history.id)
    const payload = JSON.parse(current[direction + '_payload'])
    return undoAppliers.resolveUndoApplier(payload).run(payload, { env: { DB: {} }, user, direction, historyId: history.id, generation: payload.generation ?? 0 })
  }
  for (const [label, choices, cost, code] of [
    ['custom', { category: { custom: 'Face Care' } }, false, 'product_edit_permission_required'],
    ['cost', { name: { source_id: M1 } }, true, 'cost_permission_required'],
    ['unknown cost', { name: { source_id: M1 } }, 'null', 'cost_permission_required'],
    ['zero cost', { name: { source_id: M1 } }, 'zero', 'cost_permission_required'],
  ]) {
    await check(label + ': same owner demoted undo refuses before any writes', async () => {
      const history = await merged(choices, cost)
      assert.equal(history.created_by_id, demoted.id)
      const before = dump()
      await assert.rejects(replay(history, 'undo', demoted), (error) => error.code === code)
      assert.equal(dump(), before)
    })
    await check(label + ': same owner demoted redo refuses before any writes', async () => {
      const history = await merged(choices, cost)
      await replay(history, 'undo', sameOwner)
      const before = dump()
      await assert.rejects(replay(history, 'redo', demoted), (error) => error.code === code)
      assert.equal(dump(), before)
    })
    for (const direction of ['undo', 'redo']) {
      await check(label + ': real History HTTP ' + direction + ' and affordance recheck current actor', async () => {
        const history = await merged(choices, cost)
        if (direction === 'redo') await replay(history, 'undo', sameOwner)
        if (direction === 'redo') state.native.db.prepare("UPDATE action_history SET status='redoable' WHERE id=?").run(history.id)
        state.user = demoted
        const before = dump()
        const listed = await request('GET', '/api/action-history?scope=' + encodeURIComponent(history.scope))
        assert.equal(listed.status, 200, JSON.stringify(listed.body))
        const item = listed.body.items.find((entry) => entry.id === history.id)
        assert.equal(item.server_replayable, false)
        const refusal = await request('POST', '/api/action-history/' + history.id + '/' + direction, { require_applied: true })
        assert.equal(refusal.status, 403, JSON.stringify(refusal.body))
        assert.equal(refusal.body.code, code)
        assert.equal(dump(), before)
      })
    }
  }
  await check('source-only choices remain undoable and redoable for a merge-only owner', async () => {
    // The price pick stays on the survivor's own: taking another record's price needs Edit product (5 Oct 2026).
    const history = await merged({ name: { source_id: M1 }, category: { source_id: M1 }, selling_price_usd: { source_id: KEEP } })
    const mergedValues = keeperColumns()
    await replay(history, 'undo', demoted)
    await replay(history, 'redo', demoted)
    assert.deepEqual(keeperColumns(), mergedValues)
  })
  await check('legacy field choices without provenance require product edit', async () => {
    const history = await merged({ category: { custom: 'Face Care' } })
    const payload = JSON.parse(history.undo_payload)
    const saved = one('SELECT payload_json FROM undo_snapshots WHERE id=?', payload.snapshot_id)
    const reversal = JSON.parse(saved.payload_json)
    delete reversal.keeperChoice.requiresProductEdit
    state.native.db.prepare('UPDATE undo_snapshots SET payload_json=? WHERE id=?').run(JSON.stringify(reversal), payload.snapshot_id)
    const before = dump()
    await assert.rejects(replay(history, 'undo', demoted), (error) => error.code === 'product_edit_permission_required')
    assert.equal(dump(), before)
  })
  await check('History preserves stock maintenance refusal across the real replay modules', async () => {
    const history = await merged({ name: { source_id: M1 } })
    const payload = JSON.parse(history.undo_payload)
    require('./harness/seed-stock-fixture.cjs').seedStockFixture(state.native.db, () => state.native.db.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance','1')").run())
    const before = dump()
    const result = await request('POST', '/api/action-history/' + history.id + '/undo', { require_applied: true, expected_generation: payload.generation })
    assert.equal(result.status, 503, JSON.stringify(result.body))
    assert.equal(result.body.code, 'stock_schema_unavailable')
    assert.equal(result.body.action, 'reload_required')
    assert.equal(dump(), before)
    assert.equal(one("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").n, 0)
  })
  await check('combined permission snapshot keeps actor decisions and separate current phases with one root read', async () => {
    const history=await merged({category:{custom:'Face Care'}})
    const payload=JSON.parse(history.undo_payload),prepare=adapter.prepare
    let roots=0
    adapter.prepare=sql=>{if(sql.includes('SELECT payload_json FROM undo_snapshots'))roots++;return prepare.call(adapter,sql)}
    try {
      const allowed=await undoAppliers.mergeReplayPermissionEffects({DB:{}},payload,sameOwner,'undo')
      assert.equal(allowed.choicePermissionError,null)
      assert.equal(roots,1)
      const denied=await undoAppliers.mergeReplayPermissionEffects({DB:{}},payload,demoted,'undo')
      assert.equal(denied.choicePermissionError,'product_edit_permission_required')
      assert.equal(roots,2)
      const saved=one('SELECT payload_json FROM undo_snapshots WHERE id=?',payload.snapshot_id)
      const changed=JSON.parse(saved.payload_json)
      changed.dupImagesBefore=[{image_path:'/permission-phase'}]
      state.native.db.prepare('UPDATE undo_snapshots SET payload_json=? WHERE id=?').run(JSON.stringify(changed),payload.snapshot_id)
      assert.equal((await undoAppliers.mergeReplayPermissionEffects({DB:{}},payload,sameOwner,'redo')).changesProductImages,true)
      assert.equal(roots,3,'later phase reads changed effects')
      state.native.db.prepare('UPDATE undo_snapshots SET payload_json=? WHERE id=?').run('{bad',payload.snapshot_id)
      assert.equal((await undoAppliers.mergeReplayPermissionEffects({DB:{}},payload,sameOwner,'undo')).choicePermissionError,'product_edit_permission_required')
      assert.equal((await undoAppliers.mergeReplayPermissionEffects({DB:{}},{...payload,applier:'product.merge.bulk'},sameOwner,'undo')).choicePermissionError,'product_edit_permission_required')
    } finally {adapter.prepare=prepare}
  })
  process.exitCode = failed ? 1 : 0
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
`
const runner = new Module(__filename, module)
runner.filename = __filename
runner.paths = module.paths
runner._compile(harness + checks, __filename)
