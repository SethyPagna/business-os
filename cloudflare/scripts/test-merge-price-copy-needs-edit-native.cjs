// Owner, 5 Oct 2026: copying another product's price during a merge needs the
// product-edit permission. Merge permission alone may merge, and may keep the
// survivor's own prices, but may not move another record's selling or wholesale
// price onto it (typing a price already needed product-edit, P11).
//
// Runs the REAL routes and the REAL fold over the full migration chain, using the
// harness of test-product-resolve-choices-native.cjs (the same split trick as
// test-product-resolve-replay-permissions-native.cjs). Fixture prices:
//   #70 keeper  selling 12   wholesale 10
//   #71 lower   selling 9.5  wholesale 8
//   #72 higher  selling 14   wholesale 11
// so the default (group maximum) rule changes the keeper only when #72 joins.
//
// Run (from cloudflare/scripts): node test-merge-price-copy-needs-edit-native.cjs
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
// The harness keeps only the route's default export; the fold is exported too and is the one place every merge
// caller passes through, so expose the module as well.
const harnessBase = fs.readFileSync(path.join(__dirname, 'test-product-resolve-choices-native.cjs'), 'utf8').split('async function main() {')[0].split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))
const harness = harnessBase
  .replace("const products = load('routes/products.ts', {", "const productsModule = load('routes/products.ts', {")
  .replace("}).default\nconst app = new Hono()", "})\nconst products = productsModule.default\nconst app = new Hono()")
if (!harness.includes('productsModule.default')) throw new Error('the harness route anchors moved')
const checks = `
async function main() {
  const historyRoutes = load('routes/actionHistory.ts', {
    '../lib/db': { getDb: () => adapter },
    '../lib/auth': { requireAuth: async (c, next) => { c.set('user', state.user); return next() } },
    '../lib/acquisitionCostAccess': acquisitionCostAccess,
    '../lib/permissions': permissions,
    '../lib/undoAppliers': undoAppliers,
    '../lib/audit': noAudit,
    '../lib/actorSnapshot': actorSnapshot,
    '../lib/saleBulkUpdate': { SALE_BULK_UPDATE_KINDS: [] },
  }).default
  app.route('/api/action-history', historyRoutes)
  const NEEDS = 'product_edit_permission_required'
  const PRICES = ['selling_price_usd', 'selling_price_khr', 'wholesale_price_usd', 'wholesale_price_khr']
  const priceColumns = () => one('SELECT ' + PRICES.join(', ') + ' FROM products WHERE id = ?', KEEP)
  const pairMerge = async (mergeId, choices, requestId) => {
    const seen = await preview(KEEP, mergeId, '&groupIds=' + KEEP + ',' + mergeId)
    assert.equal(seen.status, 200, JSON.stringify(seen.body))
    const resolve = { requestId: requestId + '-' + crypto.randomUUID(), reviewedDigest: seen.body.reviewedDigest, steps: [{ mergeId }] }
    return merge({ keepId: KEEP, mergeId, keep: true, resolve, ...(choices ? { choices } : {}) })
  }
  const OWN = { name: { source_id: KEEP }, selling_price_usd: { source_id: KEEP }, wholesale_price_usd: { source_id: KEEP } }

  await check('merge-only user: the default group maximum would copy the #72 price onto the keeper -> 403, nothing written', async () => {
    fresh()
    state.user = MERGER
    const before = dump()
    const refused = await pairMerge(M2, undefined, 'default-max')
    assert.equal(refused.status, 403, JSON.stringify(refused.body))
    assert.equal(refused.body.code, NEEDS)
    assert.equal(dump(), before, 'a refusal writes nothing')
  })

  await check('merge-only user: a Resolve pick of another record price is refused, selling and wholesale alike', async () => {
    for (const [mergeId, choices] of [[M1, { selling_price_usd: { source_id: M1 } }], [M1, { wholesale_price_usd: { source_id: M1 } }], [M2, { selling_price_usd: { source_id: M2 } }]]) {
      fresh()
      state.user = MERGER
      const before = dump()
      const refused = await pairMerge(mergeId, choices, 'pick-copy')
      assert.equal(refused.status, 403, JSON.stringify([choices, refused.body]))
      assert.equal(refused.body.code, NEEDS)
      assert.equal(dump(), before)
    }
  })

  await check('merge-only user: keeping the survivor own prices is a plain merge and succeeds (prices unchanged)', async () => {
    fresh()
    state.user = MERGER
    const start = priceColumns()
    const done = await pairMerge(M1, OWN, 'own-prices')
    assert.equal(done.status, 200, JSON.stringify(done.body))
    assert.deepEqual(priceColumns(), start)
  })

  await check('merge-only user: a lower-priced record under the default rule changes no price, so no permission is needed', async () => {
    fresh()
    state.user = MERGER
    const start = priceColumns()
    const done = await pairMerge(M1, undefined, 'default-lower')
    assert.equal(done.status, 200, JSON.stringify(done.body))
    assert.deepEqual(priceColumns(), start)
  })

  await check('merge-only user: a three-product group with every price kept on the survivor merges on both steps', async () => {
    fresh()
    state.user = MERGER
    const start = priceColumns()
    const group = await reviewGroup('own-group', OWN)
    for (const mergeId of [M1, M2]) assert.equal((await merge(group.body(mergeId))).status, 200, 'step ' + mergeId)
    assert.deepEqual(priceColumns(), start)
  })

  await check('merge-only user: the same group with the default maximum is refused at the first step and nothing is written', async () => {
    fresh()
    state.user = MERGER
    const before = dump()
    const group = await reviewGroup('default-group', undefined)
    const refused = await merge(group.body(M1))
    assert.equal(refused.status, 403, JSON.stringify(refused.body))
    assert.equal(refused.body.code, NEEDS)
    assert.equal(dump(), before)
  })

  await check('a user with Edit product (and an administrator) may copy the price: 200, the price lands, the history says so', async () => {
    for (const who of [EDITOR, ADMIN]) {
      fresh()
      state.user = who
      const done = await pairMerge(M2, undefined, 'editor-copy')
      assert.equal(done.status, 200, who.username + ': ' + JSON.stringify(done.body))
      assert.equal(priceColumns().selling_price_usd, 14)
      assert.equal(priceColumns().wholesale_price_usd, 11)
      const snapshot = JSON.parse(one("SELECT payload_json FROM undo_snapshots WHERE kind = 'product.merge' ORDER BY id DESC").payload_json)
      assert.equal(snapshot.copiedPrice, true, 'the reversal records that a price was copied')
    }
  })

  await check('a merge that copied no price records no copiedPrice flag', async () => {
    fresh()
    state.user = EDITOR
    assert.equal((await pairMerge(M1, undefined, 'no-copy')).status, 200)
    const snapshot = JSON.parse(one("SELECT payload_json FROM undo_snapshots WHERE kind = 'product.merge' ORDER BY id DESC").payload_json)
    assert.equal('copiedPrice' in snapshot, false)
  })

  await check('Edit product switched off by an override is merge-only; Edit on with other actions off still copies', async () => {
    const offByOverride = { ...EDITOR, id: 5, permissions: JSON.stringify({ products: true, 'products:edit': false }) }
    const editOnly = { ...EDITOR, id: 6, permissions: JSON.stringify({ products: true, 'products:delete': false, 'products:export': false }) }
    fresh(); state.user = offByOverride
    assert.equal((await pairMerge(M2, undefined, 'override-off')).status, 403)
    fresh(); state.user = editOnly
    assert.equal((await pairMerge(M2, undefined, 'override-on')).status, 200)
  })

  await check('Partial-tier products cannot merge at all, so no price is reachable', async () => {
    fresh()
    state.user = { ...EDITOR, id: 7, permissions: JSON.stringify({ products: 'review' }) }
    const refused = await merge({ keepId: KEEP, mergeId: M2, keep: true })
    assert.equal(refused.status, 403)
  })

  await check('undo of a price-copying merge needs Edit product now; an older snapshot without the flag replays as before', async () => {
    const demoted = { ...EDITOR, permissions: JSON.stringify({ products: true, 'products:edit': false }) }
    fresh()
    state.user = EDITOR
    assert.equal((await pairMerge(M2, undefined, 'replay')).status, 200)
    const history = one("SELECT * FROM action_history WHERE entity='product' AND status='undoable' ORDER BY id DESC LIMIT 1")
    const payload = JSON.parse(history.undo_payload)
    state.user = demoted
    const before = dump()
    const refused = await request('POST', '/api/action-history/' + history.id + '/undo', { require_applied: true })
    assert.equal(refused.status, 403, JSON.stringify(refused.body))
    assert.equal(refused.body.code, NEEDS)
    assert.equal(dump(), before)
    // The same merge recorded before this rule has no flag: undo is not newly refused.
    const saved = one('SELECT payload_json FROM undo_snapshots WHERE id = ?', payload.snapshot_id)
    const reversal = JSON.parse(saved.payload_json)
    delete reversal.copiedPrice
    state.native.db.prepare('UPDATE undo_snapshots SET payload_json = ? WHERE id = ?').run(JSON.stringify(reversal), payload.snapshot_id)
    const allowed = await request('POST', '/api/action-history/' + history.id + '/undo', { require_applied: true })
    assert.equal(allowed.status, 200, JSON.stringify(allowed.body))
    assert.equal(priceColumns().selling_price_usd, 12, 'undo restored the keeper price')
  })

  // The fold is the one place every merge caller passes through (pair route, whole-catalog merge, reviewed
  // conflict groups, selected-conflict batches, redo), so the rule is also proved on it directly: a caller that
  // forgot to map the refusal can still never write the price.
  await check('the fold itself refuses a price copy for a merge-only actor and writes nothing; an editor passes', async () => {
    const call = (user, mergeId) => productsModule.foldDuplicateProductInto(
      { DB: {} }, adapter, user, { id: KEEP, name: 'Glow Serum 30ml' }, { id: mergeId, name: 'Serum Glow 30ml', image_path: null },
      new Map([[1, 'shop'], [2, 'warehouse']]), 'direct fold test', 'merge', undefined, undefined, { follows: true })
    fresh()
    const before = dump()
    await assert.rejects(call(MERGER, M2), (error) => error.code === NEEDS && error.status === 403)
    assert.equal(dump(), before, 'the refusal is raised before any statement runs')
    await call(MERGER, M1)
    assert.equal(priceColumns().selling_price_usd, 12, 'a lower-priced record moves no price, so the merge-only actor may fold it')
    fresh()
    await call(EDITOR, M2)
    assert.equal(priceColumns().selling_price_usd, 14)
    fresh()
    await assert.rejects(call(null, M2), (error) => error.code === NEEDS, 'no actor is no permission')
  })

  console.log(failed ? '\\n' + failed + ' check(s) failed' : '\\nall checks passed')
  process.exitCode = failed ? 1 : 0
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
`
const runner = new Module(__filename, module)
runner.filename = __filename
runner.paths = module.paths
runner._compile(harness + checks, __filename)
