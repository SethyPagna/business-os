// Owner, 19-20 Oct 2026: the supplier of a product is changed only with products:supplier. The first lane
// (868/862/876) gated PUT /products/:id, the backfill route and review approval; the independent review found two more
// writers on the PRODUCTS side still open to a role holding only Edit / Manage lookups:
//
//   POST /api/products/lookups/replace type=supplier   rewrites products.supplier on every matching product
//   undo/redo of supplier.backfill                      replayed with products:edit alone
//
// The real products route over the migrated schema (harness of test-product-resolve-choices-native.cjs), as a custom
// role that holds Products Full but has the supplier switch OFF, and as the same role with it left on.
// A generic product edit has no server applier: its Undo/Redo is the client re-sending PUT /products/:id, which the
// existing gate refuses -- the last check pins that.
//
// Run (from cloudflare/scripts): node test-supplier-writers-products-native.cjs
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const harnessBase = fs.readFileSync(path.join(__dirname, 'test-product-resolve-choices-native.cjs'), 'utf8').split('async function main() {')[0]
const checks = `
async function main() {
  const asUser = (id, own) => ({ id, username: 'u' + id, name: 'u' + id, role_code: 'manager', permissions: JSON.stringify(own) })
  const NO_SUPPLIER = asUser(31, { products: true, 'products:supplier': false })
  const WITH_SUPPLIER = asUser(32, { products: true })
  const LOOKUPS_NO_SUPPLIER = asUser(33, { products: true, 'products:manage_lookups': true, 'products:supplier': false })
  const SUPPLIER_CODE = 'product_supplier_edit_required'
  const seedSuppliers = () => {
    state.native.db.exec("UPDATE products SET supplier = 'Acme Trading' WHERE id IN (" + KEEP + ", " + M1 + ")")
    state.native.db.exec("UPDATE products SET brand = 'Glowy' WHERE id = " + M2)
  }
  const supplierOf = (id) => one('SELECT supplier FROM products WHERE id = ?', id).supplier

  await check('lookups/replace type=supplier needs products:supplier: refused with the stable code and no side effect without it, applied with it', async () => {
    fresh()
    seedSuppliers()
    for (const body of [
      { type: 'supplier', from: ['Acme Trading'], to: 'Acme Co' },
      { type: 'supplier', from: ['Acme Trading'], to: null },
    ]) {
      state.user = LOOKUPS_NO_SUPPLIER
      const before = dump()
      const refused = await request('POST', '/api/products/lookups/replace', body)
      assert.equal(refused.status, 403, JSON.stringify(body) + ' ' + JSON.stringify(refused.body))
      assert.equal(refused.body.code, SUPPLIER_CODE)
      assert.equal(dump(), before, 'a refused supplier lookup change writes nothing')
      assert.equal(supplierOf(KEEP), 'Acme Trading')
    }
    state.user = WITH_SUPPLIER
    const done = await request('POST', '/api/products/lookups/replace', { type: 'supplier', from: ['Acme Trading'], to: 'Acme Co' })
    assert.equal(done.status, 200, JSON.stringify(done.body))
    assert.equal(supplierOf(KEEP), 'Acme Co')
    assert.equal(supplierOf(M1), 'Acme Co')
  })

  await check('the other lookup kinds are NOT held to the supplier switch (control: the gate is scoped to type=supplier)', async () => {
    fresh()
    seedSuppliers()
    state.user = LOOKUPS_NO_SUPPLIER
    const done = await request('POST', '/api/products/lookups/replace', { type: 'brand', from: ['Glowy'], to: 'Glow Co' })
    assert.equal(done.status, 200, JSON.stringify(done.body))
    assert.equal(one('SELECT brand FROM products WHERE id = ?', M2).brand, 'Glow Co')
    assert.equal(supplierOf(KEEP), 'Acme Trading', 'a brand change leaves suppliers alone')
  })

  await check('undo/redo of supplier.backfill needs products:supplier on top of products:edit, at the one tier function the three history gates share', async () => {
    const applier = undoAppliers.resolveUndoApplier({ applier: 'supplier.backfill', snapshot_id: 1 })
    assert.ok(applier, 'the applier is registered')
    assert.equal(undoAppliers.applierPermissionTier(WITH_SUPPLIER, applier), 'full')
    assert.equal(undoAppliers.applierPermissionTier(NO_SUPPLIER, applier), 'none', 'Edit alone no longer replays a supplier attribution')
    assert.equal(undoAppliers.applierAlsoActionDenied(NO_SUPPLIER, applier), true)
    assert.equal(undoAppliers.applierAlsoActionDenied(WITH_SUPPLIER, applier), false)
    // Control: an applier with no extra action is unchanged by the supplier switch.
    const mergeApplier = undoAppliers.resolveUndoApplier({ applier: 'product.merge', snapshot_id: 1 })
    assert.equal(undoAppliers.applierAlsoActionDenied(NO_SUPPLIER, mergeApplier), false)
    assert.equal(undoAppliers.applierPermissionTier(NO_SUPPLIER, mergeApplier), undoAppliers.applierPermissionTier(WITH_SUPPLIER, mergeApplier))
  })

  await check('the backfill route itself stays gated server-side (lane 868): refused without products:supplier, reaches the writer with it', async () => {
    fresh()
    state.native.db.exec("INSERT INTO suppliers (id, name) VALUES (5, 'Acme Trading')")
    state.user = NO_SUPPLIER
    const before = dump()
    const refused = await request('POST', '/api/products/' + KEEP + '/suppliers/backfill', { supplierId: 5 })
    assert.equal(refused.status, 403, JSON.stringify(refused.body))
    assert.equal(refused.body.code, SUPPLIER_CODE)
    assert.equal(dump(), before)
    state.user = WITH_SUPPLIER
    const allowed = await request('POST', '/api/products/' + KEEP + '/suppliers/backfill', { supplierId: 5 })
    assert.equal(allowed.status, 200, JSON.stringify(allowed.body))
  })

  await check('a generic product edit is replayed by the client as PUT /products/:id, so its Undo/Redo meets the same supplier gate', async () => {
    fresh()
    seedSuppliers()
    state.user = NO_SUPPLIER
    const stored = one('SELECT updated_at FROM products WHERE id = ?', KEEP)
    const before = dump()
    const refused = await request('PUT', '/api/products/' + KEEP, { supplier: 'Restored Supplier', expected_updated_at: stored.updated_at })
    assert.equal(refused.status, 403, JSON.stringify(refused.body))
    assert.equal(refused.body.code, SUPPLIER_CODE)
    assert.equal(dump(), before)
    assert.equal(undoAppliers.resolveUndoApplier({ entity: 'product', scope: 'product' }), null, 'no server applier replays a generic product edit')
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
