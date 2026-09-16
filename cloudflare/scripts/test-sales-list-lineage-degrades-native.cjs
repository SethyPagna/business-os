// Regression coverage for Sentry BUSINESS-OS-1F: a sale_item reparented by
// migrations 0165/0168 (which moved sale_items.product_id via raw SQL
// without writing the product.merge undo_snapshots evidence
// lib/productMergeLineage.ts requires) must not 500 a read of GET
// /api/sales -- the list must render the sale and flag only the affected
// line, while a WRITE against that same sale (an amendment) still gets a
// strict 409. Built on the same real Hono route + full migrated SQLite
// schema harness as test-product-merge-lineage-native.cjs.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module')
const file = path.join(__dirname, 'test-sale-create-atomic-pure.cjs'), source = fs.readFileSync(file, 'utf8'), boundary = source.indexOf(';(async () => {')
const harness = new Module(file, module); harness.filename = file; harness.paths = module.paths
harness._compile(source.slice(0, boundary).replace('const overrides = {', "const overrides = { './db': { getDb: env => env.DB },") + '\nmodule.exports={fixture,request,postSale,app,executionCtx,load,USER,setUser(value){currentUser=value}};', file)
const h = harness.exports
;(async () => {
  h.setUser({ ...h.USER, permissions: '{"all":true}' })
  const f = h.fixture(), lineage = h.load('lib/productMergeLineage.ts')

  const created = await h.postSale(f.route, { ...h.request('lineage-list-create'), money_precision_version: 1, items: [{
    product_id: 10, quantity: 1, branch_id: 1, batch_id: 500,
    client_line_key: 'lineage-list-line', pricing_source: 'selling',
    pricing_quote: { gross_usd: 9.5, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 9.5, total_khr: 38000 },
  }] })
  assert.equal(created.status, 200, JSON.stringify(created.body))
  const saleId = created.body.id

  // Reproduce the migration 0165/0168 gap DIRECTLY: reparent the sale_item's
  // product_id to a new product with a plain UPDATE, exactly like those
  // migrations, and deliberately write NO undo_snapshots evidence (unlike
  // routes/products.ts foldDuplicateProductInto, which always does).
  f.raw.prepare("INSERT INTO products(id,name,sku,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active) VALUES(20,'Powder Keeper','POWDERK',0,9.5,38000,4,16000,1)").run()
  f.raw.prepare('UPDATE sale_items SET product_id=20 WHERE sale_id=?').run([saleId])

  const line = f.raw.prepare('SELECT * FROM sale_items WHERE sale_id=?').get([saleId])

  // Positive control: the strict resolver used by every write path still
  // refuses this exact fixture -- the divergence is real, not vacuous.
  await assert.rejects(() => lineage.resolveProductMergeLineage(f.route, saleId, [line]), lineage.ProductMergeLineageError,
    'positive control: unproven lineage still refuses under the strict resolver')

  // GET /api/sales?id=<saleId> must render the sale (200), not 500.
  const listed = await h.app.request(`/?id=${saleId}`, { method: 'GET' }, { DB: f.route }, h.executionCtx)
  assert.equal(listed.status, 200, 'a read-only list must never 500 on an unprovable merge lineage')
  const body = await listed.json()
  assert.equal(body.length, 1)
  const sale = body[0]
  assert.equal(sale.identity_review_required, true, 'the sale is flagged for review')
  assert.deepEqual(sale.pricing_identity_bindings, [], 'no binding is minted for an unprovable identity')
  assert.equal(sale.items.length, 1)
  assert.equal(sale.items[0].identity_review_required, true, 'the specific diverging line is flagged')
  assert.equal(sale.items[0].id, line.id)
  assert.equal(sale.items[0].product_id, 20, 'the live product_id is reported as-is, not hidden')

  // The write path (amendment) on the SAME sale still refuses with 409, not
  // a silent write against an unproven identity.
  const amendment = { kind: 'line_quantity_increased', quantity: 1, sale_item_id: line.id, money_precision_version: 1,
    expected_exchange_rate: 4000, client_request_id: 'lineage-list-amend',
    pricing_quote: { gross_usd: 19, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 19, total_khr: 76000 } }
  const amend = await h.app.request(`/${saleId}/amendments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(amendment) }, { DB: f.route }, h.executionCtx)
  assert.equal(amend.status, 409, JSON.stringify(await amend.json()))

  // A sale with NO divergence at all (ordinary money_precision_version=1
  // sale) must carry no review flag -- the flag is specific, not blanket.
  const clean = await h.postSale(f.route, { ...h.request('lineage-list-clean'), money_precision_version: 1, items: [{
    product_id: 10, quantity: 1, branch_id: 1, batch_id: 500,
    client_line_key: 'lineage-list-clean-line', pricing_source: 'selling',
    pricing_quote: { gross_usd: 9.5, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 9.5, total_khr: 38000 },
  }] })
  assert.equal(clean.status, 200, JSON.stringify(clean.body))
  const cleanListed = await h.app.request(`/?id=${clean.body.id}`, { method: 'GET' }, { DB: f.route }, h.executionCtx)
  const cleanBody = await cleanListed.json()
  assert.equal(cleanBody[0].identity_review_required, undefined, 'an unaffected sale carries no review flag')
  assert.equal(cleanBody[0].items[0].identity_review_required, undefined, 'an unaffected line carries no review flag')

  f.raw.db.close()
  console.log('PASS GET /api/sales renders an unprovable merge lineage as a flagged line (200), not a 500; writes still refuse (409)')
})().catch(error => { console.error(error); process.exitCode = 1 })
