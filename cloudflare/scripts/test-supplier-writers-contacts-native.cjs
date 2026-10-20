// Owner, 19-20 Oct 2026: the supplier of a product is changed only with products:supplier. A supplier CONTACT edit is
// guarded by Contacts alone, but three of its effects rewrite products:
//
//   PUT  /api/suppliers/:id with __rename_cascade=carry   relabels products.supplier (UPDATE products SET supplier)
//   POST /api/suppliers/merge                             repoints the merged suppliers' products and lots
//   PUT  rename onto an existing name                      folds into that supplier, the same repoint
//
// Conservative ruling (flagged to the owner): a role without products:supplier is refused ONLY when a product or lot
// actually uses the supplier; housekeeping on a supplier nothing uses, and "rename only this contact" (record_only,
// which leaves products untouched), stay open. The real contacts route over the migrated schema, as a custom role
// that holds Contacts + Products Full with the supplier switch off, and as the same role with it on.
//
// Run (from cloudflare/scripts): node test-supplier-writers-contacts-native.cjs
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const source = fs.readFileSync(path.join(__dirname, 'test-contact-merge-n-records-native.cjs'), 'utf8')
const harnessBase = source.split('// Three customers the system detects as one person')[0]
// The edit route reads the sales-source marker through lib/contactSalesSource; the base harness leaves it inert.
const ANCHOR = "'../lib/anonymousCustomer': load('lib/anonymousCustomer.ts'),"
const EXTRA = [
  "'../lib/contactSalesSource': load('lib/contactSalesSource.ts', { './permissions': permissions }),",
  "'../lib/productSupplierGate': load('lib/productSupplierGate.ts'),",
].map((line) => '\n  ' + line).join('')
const harnessReal = harnessBase.replace(ANCHOR, ANCHOR + EXTRA)
if (harnessReal === harnessBase) throw new Error('the contacts override anchor moved')
if (!harnessBase.includes('async function post(') || !harnessBase.includes('function fresh(')) throw new Error('the contact harness anchors moved')
const checks = `
const asUser = (id, own) => ({ id, username: 'u' + id, name: 'u' + id, role_code: 'manager', permissions: JSON.stringify({ contacts: true, contacts_suppliers: true, products: true, ...own }) })
const NO_SUPPLIER = asUser(41, { 'products:supplier': false })
const WITH_SUPPLIER = asUser(42, {})
const SUPPLIER_CODE = 'product_supplier_edit_required'
async function put(url, body) {
  planTier.__resetPlanTierCacheForTests()
  const res = await app.request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, {}, { waitUntil: () => {} })
  const text = await res.text()
  try { return { status: res.status, body: JSON.parse(text) } } catch { throw new Error('PUT ' + url + ' ' + res.status + ': ' + text) }
}
const seedWith = (secondPhone) => "INSERT INTO suppliers(id,name,phone,updated_at) VALUES (11,'Lotus Trading','012 666 666','2026-09-01 10:00:00'),(12,'Lotus Trading Co','" + secondPhone + "','2026-09-02 10:00:00'),(13,'Unused Supplier','012 999 999','2026-09-03 10:00:00'),(14,'Lot Only Supplier','012 888 888','2026-09-04 10:00:00');" +
  "INSERT INTO products(id,name,supplier) VALUES (101,'Rice','Lotus Trading'),(102,'Oil','Lotus Trading Co'),(103,'Salt','Other Supplier');" +
  "INSERT INTO product_batches(id,variant_product_id,batch_key,supplier_id,supplier_name) VALUES (201,102,'b1',12,'Lotus Trading Co'),(204,103,'b4',14,'Lot Only Supplier');"
const SEED = seedWith('012 666 667')
const SEED_SHARED_PHONE = seedWith('012 666 666')
const supplierText = (raw) => rows(raw, 'SELECT id, supplier FROM products ORDER BY id')
const snapshotOf = (raw) => dump(raw, ['suppliers', 'products', 'product_batches', 'audit_logs'])

async function main() {
  await check('rename WITH carry relabels products: refused without products:supplier (no side effect), applied with it', async () => {
    const raw = fresh(SEED)
    state.user = NO_SUPPLIER
    const before = snapshotOf(raw)
    const refused = await put('/api/suppliers/11', { name: 'Lotus Trading Ltd', __rename_cascade: 'carry' })
    assert.equal(refused.status, 403, JSON.stringify(refused.body))
    assert.equal(refused.body.code, SUPPLIER_CODE)
    assert.equal(snapshotOf(raw), before, 'a refused rename writes nothing, not even the contact row')
    state.user = WITH_SUPPLIER
    const done = await put('/api/suppliers/11', { name: 'Lotus Trading Ltd', __rename_cascade: 'carry' })
    assert.equal(done.status, 200, JSON.stringify(done.body))
    assert.equal(supplierText(raw)[0].supplier, 'Lotus Trading Ltd')
  })

  await check('rename WITHOUT carry (record only) and a rename of a supplier no product uses stay open to the same role', async () => {
    const raw = fresh(SEED)
    state.user = NO_SUPPLIER
    const recordOnly = await put('/api/suppliers/11', { name: 'Lotus Trading Ltd', __rename_cascade: 'record_only' })
    assert.equal(recordOnly.status, 200, JSON.stringify(recordOnly.body))
    assert.equal(supplierText(raw)[0].supplier, 'Lotus Trading', 'record-only leaves products as they were')
    const unused = await put('/api/suppliers/13', { name: 'Unused Supplier Renamed', __rename_cascade: 'carry' })
    assert.equal(unused.status, 200, JSON.stringify(unused.body))
    assert.equal(one(raw, 'SELECT name FROM suppliers WHERE id = 13').name, 'Unused Supplier Renamed')
  })

  await check('a rename onto an existing supplier folds into it (repointing products): refused without products:supplier, folded with it', async () => {
    const raw = fresh(SEED)
    state.user = NO_SUPPLIER
    const before = snapshotOf(raw)
    const refused = await put('/api/suppliers/11', { name: 'Lotus Trading Co', __rename_cascade: 'record_only' })
    assert.equal(refused.status, 403, JSON.stringify(refused.body))
    assert.equal(refused.body.code, SUPPLIER_CODE)
    assert.equal(snapshotOf(raw), before)
    state.user = WITH_SUPPLIER
    const done = await put('/api/suppliers/11', { name: 'Lotus Trading Co', __rename_cascade: 'record_only' })
    assert.equal(done.status, 200, JSON.stringify(done.body))
    assert.equal(supplierText(raw)[0].supplier, 'Lotus Trading Co')
  })

  await check('POST /merge repoints products and lots: refused without products:supplier, merged with it', async () => {
    const raw = fresh(SEED_SHARED_PHONE)
    state.user = NO_SUPPLIER
    const before = snapshotOf(raw)
    const body = () => ({ keepId: 11, mergeIds: [12], client_request_id: 'sw-merge', expected: expectedFor(raw, 'suppliers', [11, 12]) })
    const refused = await post('/api/suppliers/merge', body())
    assert.equal(refused.status, 403, JSON.stringify(refused.body))
    assert.equal(refused.body.code, SUPPLIER_CODE)
    assert.equal(snapshotOf(raw), before, 'a refused merge writes nothing')
    state.user = WITH_SUPPLIER
    const done = await post('/api/suppliers/merge', body())
    assert.equal(done.status, 200, JSON.stringify(done.body))
    assert.deepEqual(supplierText(raw).map((r) => r.supplier), ['Lotus Trading', 'Lotus Trading', 'Other Supplier'])
  })

  await check('a merge of suppliers no product or lot uses needs only Contacts', async () => {
    const raw = fresh("INSERT INTO suppliers(id,name,phone,updated_at) VALUES (21,'Idle One','012 555 555','2026-09-01 10:00:00'),(22,'Idle Two','012 555 555','2026-09-02 10:00:00');")
    state.user = NO_SUPPLIER
    const done = await post('/api/suppliers/merge', { keepId: 21, mergeIds: [22], client_request_id: 'sw-idle', expected: expectedFor(raw, 'suppliers', [21, 22]) })
    assert.equal(done.status, 200, JSON.stringify(done.body))
  })

  console.log(failed ? '\\n' + failed + ' check(s) failed' : '\\nall checks passed')
  process.exitCode = failed ? 1 : 0
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
`
const runner = new Module(__filename, module)
runner.filename = __filename
runner.paths = module.paths
runner._compile(harnessReal + checks, __filename)
