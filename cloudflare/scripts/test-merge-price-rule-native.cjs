// Owner, 5 Oct 2026 (revised that evening): a merge applies the standing rule by itself and never needs a
// permission:
//   selling and wholesale price = the HIGHEST of the merged rows
//   barcode                     = identical except leading zeros -> the spelling WITHOUT them
//   cost                        = quantity-weighted mean (catalogCostRecompute; test-catalog-cost-on-hand-pure
//                                 and test-catalog-cost-recompute-native pin it)
// Only a MANUAL Resolve choice that sets a USD price different from that rule is a product edit and needs Edit
// product at full tier with the price action on (typing a price already needed Edit product, P11).
//
// Runs the REAL routes and the REAL fold over the full migration chain, using the harness of
// test-product-resolve-choices-native.cjs. Fixture prices:
//   #70 keeper  selling 12   wholesale 10
//   #71 lower   selling 9.5  wholesale 8
//   #72 higher  selling 14   wholesale 11
//
// Run (from cloudflare/scripts): node test-merge-price-rule-native.cjs
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
  const barcodeOf = (id) => one('SELECT barcode FROM products WHERE id = ?', id).barcode
  const reversalOf = () => JSON.parse(one("SELECT payload_json FROM undo_snapshots WHERE kind = 'product.merge' ORDER BY id DESC").payload_json)
  const pairMerge = async (mergeId, choices, requestId) => {
    const seen = await preview(KEEP, mergeId, '&groupIds=' + KEEP + ',' + mergeId)
    assert.equal(seen.status, 200, JSON.stringify(seen.body))
    const resolve = { requestId: requestId + '-' + crypto.randomUUID(), reviewedDigest: seen.body.reviewedDigest, steps: [{ mergeId }] }
    return merge({ keepId: KEEP, mergeId, keep: true, resolve, ...(choices ? { choices } : {}) })
  }
  const NO_PRICE = { ...EDITOR, id: 8, permissions: JSON.stringify({ products: true, 'products:price': false }) }

  // ---- THE RULE: automatic merges, no permission needed ---------------------------------
  await check('RULE: a merge-only user merges a higher-priced twin and the HIGHEST selling and wholesale price win', async () => {
    fresh()
    state.user = MERGER
    const done = await pairMerge(M2, undefined, 'auto-high')
    assert.equal(done.status, 200, JSON.stringify(done.body))
    assert.deepEqual([priceColumns().selling_price_usd, priceColumns().wholesale_price_usd], [14, 11])
    assert.equal('priceOverridden' in reversalOf(), false, 'an automatic merge is not an override')
  })

  await check('RULE: a lower-priced twin changes nothing (the keeper already holds the highest)', async () => {
    fresh()
    state.user = MERGER
    assert.equal((await pairMerge(M1, undefined, 'auto-low')).status, 200)
    assert.deepEqual([priceColumns().selling_price_usd, priceColumns().wholesale_price_usd], [12, 10])
  })

  await check('RULE: a three-product group takes the highest across all of them, on every step, for a merge-only user', async () => {
    fresh()
    state.user = MERGER
    const group = await reviewGroup('auto-group', undefined)
    for (const mergeId of [M1, M2]) assert.equal((await merge(group.body(mergeId))).status, 200, 'step ' + mergeId)
    assert.deepEqual([priceColumns().selling_price_usd, priceColumns().wholesale_price_usd], [14, 11])
  })

  await check('RULE: a tie keeps the shared price; a missing price loses to a real one in both directions', async () => {
    fresh()
    state.native.db.exec('UPDATE products SET selling_price_usd = 12, wholesale_price_usd = 10 WHERE id = ' + M2)
    state.user = MERGER
    assert.equal((await pairMerge(M2, undefined, 'tie')).status, 200)
    assert.deepEqual([priceColumns().selling_price_usd, priceColumns().wholesale_price_usd], [12, 10])
    fresh()
    state.native.db.exec('UPDATE products SET selling_price_usd = NULL, wholesale_price_usd = NULL WHERE id = ' + KEEP)
    state.user = MERGER
    assert.equal((await pairMerge(M2, undefined, 'keeper-missing')).status, 200)
    assert.deepEqual([priceColumns().selling_price_usd, priceColumns().wholesale_price_usd], [14, 11], 'the other record price fills the missing one')
    fresh()
    state.native.db.exec('UPDATE products SET selling_price_usd = NULL, wholesale_price_usd = 0 WHERE id = ' + M2)
    state.user = MERGER
    assert.equal((await pairMerge(M2, undefined, 'dup-missing')).status, 200)
    assert.deepEqual([priceColumns().selling_price_usd, priceColumns().wholesale_price_usd], [12, 10], 'a missing or zero price never lowers the keeper')
  })

  await check('RULE (barcode): identical except leading zeros -> the spelling WITHOUT them, whichever product is kept', async () => {
    const CLEAN = '8850000000070'
    fresh()
    state.native.db.exec("UPDATE products SET barcode = '0" + CLEAN + "' WHERE id = " + M1)
    state.user = MERGER
    assert.equal((await pairMerge(M1, undefined, 'zero-on-dup')).status, 200)
    assert.equal(barcodeOf(KEEP), CLEAN, 'the keeper already holds the clean spelling and keeps it')
    fresh()
    state.native.db.exec("UPDATE products SET barcode = '00" + CLEAN + "' WHERE id = " + KEEP + "; UPDATE products SET barcode = '" + CLEAN + "' WHERE id = " + M1)
    state.user = MERGER
    const done = await pairMerge(M1, undefined, 'zero-on-keeper')
    assert.equal(done.status, 200, JSON.stringify(done.body))
    assert.equal(barcodeOf(KEEP), CLEAN, 'a padded keeper converges to the clean spelling')
    fresh()
    state.native.db.exec("UPDATE products SET barcode = '00" + CLEAN + "' WHERE id = " + KEEP + "; UPDATE products SET barcode = '0" + CLEAN + "' WHERE id = " + M1)
    state.user = MERGER
    assert.equal((await pairMerge(M1, undefined, 'both-padded')).status, 200)
    assert.equal(barcodeOf(KEEP), CLEAN, 'two padded spellings converge to the clean one')
    fresh()
    state.user = MERGER
    assert.equal((await pairMerge(M1, undefined, 'different-barcode')).status, 200)
    assert.equal(barcodeOf(KEEP), CLEAN, 'a genuinely different barcode keeps the keeper own spelling')
  })

  await check('RULE (barcode): a non-numeric code is not folded', async () => {
    fresh()
    state.native.db.exec("UPDATE products SET barcode = '0AB12' WHERE id = " + KEEP + "; UPDATE products SET barcode = 'AB12' WHERE id = " + M1)
    state.user = MERGER
    assert.equal((await pairMerge(M1, undefined, 'alpha')).status, 200)
    assert.equal(barcodeOf(KEEP), '0AB12')
  })

  // ---- MANUAL OVERRIDE: only a choice different from the rule needs Edit product ----------
  await check('OVERRIDE: a Resolve choice that equals the rule is not an override (the row holding the highest, or the keeper when it is highest)', async () => {
    fresh(); state.user = MERGER
    assert.equal((await pairMerge(M2, { selling_price_usd: { source_id: M2 }, wholesale_price_usd: { source_id: M2 } }, 'pick-highest')).status, 200)
    assert.deepEqual([priceColumns().selling_price_usd, priceColumns().wholesale_price_usd], [14, 11])
    fresh(); state.user = MERGER
    assert.equal((await pairMerge(M1, { selling_price_usd: { source_id: KEEP }, wholesale_price_usd: { source_id: KEEP } }, 'keeper-highest')).status, 200)
  })

  await check('OVERRIDE: a choice below the rule is refused without Edit product, selling and wholesale alike, and writes nothing', async () => {
    for (const [mergeId, choices] of [[M2, { selling_price_usd: { source_id: KEEP } }], [M2, { wholesale_price_usd: { source_id: KEEP } }], [M1, { selling_price_usd: { source_id: M1 } }]]) {
      fresh(); state.user = MERGER
      const before = dump()
      const refused = await pairMerge(mergeId, choices, 'override')
      assert.equal(refused.status, 403, JSON.stringify([choices, refused.body]))
      assert.equal(refused.body.code, NEEDS)
      assert.equal(dump(), before)
    }
  })

  await check('OVERRIDE: the same choices succeed for Edit product and for an administrator, and the reversal records the override', async () => {
    for (const who of [EDITOR, ADMIN]) {
      fresh(); state.user = who
      const done = await pairMerge(M2, { selling_price_usd: { source_id: KEEP }, wholesale_price_usd: { source_id: KEEP } }, 'editor-override')
      assert.equal(done.status, 200, who.username + ': ' + JSON.stringify(done.body))
      assert.deepEqual([priceColumns().selling_price_usd, priceColumns().wholesale_price_usd], [12, 10])
      assert.equal(reversalOf().priceOverridden, true)
    }
  })

  await check('OVERRIDE: Edit product on but the price action off is refused; Edit off is refused; Partial tier cannot merge at all', async () => {
    fresh(); state.user = NO_PRICE
    assert.equal((await pairMerge(M2, { selling_price_usd: { source_id: KEEP } }, 'no-price')).status, 403)
    assert.equal((await pairMerge(M2, undefined, 'no-price-auto')).status, 200, 'the same user merges automatically')
    fresh(); state.user = { ...EDITOR, id: 5, permissions: JSON.stringify({ products: true, 'products:edit': false }) }
    assert.equal((await pairMerge(M2, { selling_price_usd: { source_id: KEEP } }, 'edit-off')).status, 403)
    fresh(); state.user = { ...EDITOR, id: 7, permissions: JSON.stringify({ products: 'review' }) }
    assert.equal((await merge({ keepId: KEEP, mergeId: M2, keep: true })).status, 403)
  })

  await check('OVERRIDE: undo of an override merge needs the grant; a snapshot without the flag (an automatic or older merge) replays as before', async () => {
    const demoted = { ...EDITOR, permissions: JSON.stringify({ products: true, 'products:edit': false }) }
    fresh(); state.user = EDITOR
    assert.equal((await pairMerge(M2, { selling_price_usd: { source_id: KEEP } }, 'replay')).status, 200)
    const history = one("SELECT * FROM action_history WHERE entity='product' AND status='undoable' ORDER BY id DESC LIMIT 1")
    const payload = JSON.parse(history.undo_payload)
    state.user = demoted
    const before = dump()
    const refused = await request('POST', '/api/action-history/' + history.id + '/undo', { require_applied: true })
    assert.equal(refused.status, 403, JSON.stringify(refused.body))
    assert.equal(refused.body.code, NEEDS)
    assert.equal(dump(), before)
    const saved = one('SELECT payload_json FROM undo_snapshots WHERE id = ?', payload.snapshot_id)
    const reversal = JSON.parse(saved.payload_json)
    delete reversal.priceOverridden
    state.native.db.prepare('UPDATE undo_snapshots SET payload_json = ? WHERE id = ?').run(JSON.stringify(reversal), payload.snapshot_id)
    const allowed = await request('POST', '/api/action-history/' + history.id + '/undo', { require_applied: true })
    assert.equal(allowed.status, 200, JSON.stringify(allowed.body))
    assert.equal(priceColumns().selling_price_usd, 12)
  })

  await check('the fold itself (every merge caller): automatic passes for a merge-only actor, an override of the rule is refused and writes nothing', async () => {
    const call = (user, mergeId, fields) => productsModule.foldDuplicateProductInto(
      { DB: {} }, adapter, user, { id: KEEP, name: 'Glow Serum 30ml' }, { id: mergeId, name: 'Serum Glow 30ml', image_path: null },
      new Map([[1, 'shop'], [2, 'warehouse']]), 'direct fold test', 'merge', undefined, undefined, { follows: true, ...(fields ? { fields } : {}) })
    fresh()
    const before = dump()
    await assert.rejects(call(MERGER, M2, { selling_price_usd: 12, selling_price_khr: 0 }), (error) => error.code === NEEDS && error.status === 403)
    assert.equal(dump(), before, 'the refusal is raised before any statement runs')
    await call(MERGER, M2)
    assert.equal(priceColumns().selling_price_usd, 14, 'the automatic rule needs no permission')
    fresh()
    await call(EDITOR, M2, { selling_price_usd: 12, selling_price_khr: 0 })
    assert.equal(priceColumns().selling_price_usd, 12)
    fresh()
    await assert.rejects(call(null, M2, { wholesale_price_usd: 1 }), (error) => error.code === NEEDS, 'no actor is no permission')
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
