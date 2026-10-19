const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { buildSync } = require('esbuild')
const { loadAll } = require('./harness/load_migrations.cjs')

const source = path.join(__dirname, '../src/lib/inventoryCheckProducts.ts')
assert.ok(fs.existsSync(source), 'the dedicated authorized Inventory product model must exist')
const code = buildSync({ entryPoints: [source], bundle: true, platform: 'node', format: 'cjs', write: false, target: 'es2022', external: ['cloudflare:*'] }).outputFiles[0].text
const loaded = { exports: {} }
new Function('require', 'module', 'exports', code)(require, loaded, loaded.exports)
const api = loaded.exports
const tierCode = buildSync({ entryPoints: [path.join(__dirname, '../src/lib/planTier.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, target: 'es2022', external: ['cloudflare:*'] }).outputFiles[0].text
const tierModule = { exports: {} }
new Function('require', 'module', 'exports', tierCode)(require, tierModule, tierModule.exports)
const admin = { id: 1, role_code: 'admin', role_permissions: { all: true } }
const lowStock = { enabled: true, mode: 'product', threshold: 10 }
let passed = 0
const check = async (name, run) => { await run(); passed++; console.log(`PASS ${name}`) }
function fixture() {
  const db = new DatabaseSync(':memory:')
  for (const sql of loadAll({ through: 242 })) db.exec(sql)
  db.exec("INSERT OR IGNORE INTO branches(id,name,is_active) VALUES(1,'Synthetic one',1),(2,'Synthetic two',1)")
  return db
}
function adapter(db) {
  return { statements: 0, calls: 0, plans: [], async batch(statements) {
    this.calls++; this.statements += statements.length
    db.exec('PRAGMA query_only=ON'); db.exec('BEGIN')
    try {
      const results = statements.map(({ sql, params = {} }) => {
        const prepared = db.prepare(sql); prepared.setAllowUnknownNamedParameters(true)
        const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`); plan.setAllowUnknownNamedParameters(true)
        this.plans.push(plan.all(params))
        return { success: true, results: prepared.all(params) }
      })
      db.exec('COMMIT'); return results
    } catch (error) { db.exec('ROLLBACK'); throw error }
    finally { db.exec('PRAGMA query_only=OFF') }
  } }
}
function product(db, id, name, quantity, extra = {}) {
  db.prepare('INSERT INTO products(id,name,stock_quantity,parent_id,is_group,brand,category) VALUES(?,?,?,?,?,?,?)').run(id, name, quantity, extra.parent_id ?? null, extra.is_group ?? 0, extra.brand ?? 'Synthetic brand', extra.category ?? 'Synthetic category')
  db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,?)').run(id, quantity)
  db.prepare('INSERT INTO product_batches(id,variant_product_id,batch_key,received_at) VALUES(?,?,?,?)').run(id, id, `fixture-${id}`, extra.received_at ?? '2026-10-19')
  db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,?)').run(id, quantity)
}
function sale(db, id, customerId, lines, createdAt = '2026-10-18T17:00:00.000Z', status = 'completed') {
  const total = lines.reduce((sum, line) => sum + line.quantity, 0)
  db.prepare('INSERT INTO sales(id,receipt_number,customer_id,customer_name,created_at,sale_status,subtotal_usd,total_usd) VALUES(?,?,?,?,?,?,?,?)')
    .run(id, `read-api-${id}`, customerId, `Synthetic buyer ${customerId}`, createdAt, status, total, total)
  for (const line of lines) db.prepare('INSERT INTO sale_items(sale_id,product_id,branch_id,quantity,total_usd,total_khr,cost_price_usd,cost_price_khr) VALUES(?,?,?,?,?,0,0,0)')
    .run(id, line.product_id, line.branch_id ?? 1, line.quantity, line.quantity)
}
async function read(db, query = {}, user = admin, options = {}) {
  const proxy = adapter(db)
  const before = db.prepare('SELECT total_changes() AS n').get().n
  const result = await api.readInventoryCheckProducts(proxy, user, query, { lowStock, ...options })
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n, before, 'the real model performs no database writes')
  assert.equal(proxy.calls, 1, 'schema validation, population, page and stats share one snapshot batch')
  assert.equal(proxy.statements, 5, 'fixed statement cost, independent of page product count')
  return { result, proxy }
}
async function main() {
  await check('four stock ledgers overlap once, unknown stays nullable and genuine zero is out', async () => {
    const db = fixture()
    product(db, 910001, 'Synthetic known', 10)
    product(db, 910002, 'Synthetic zero', 0)
    product(db, 910003, 'Synthetic unknown', 5)
    db.exec('UPDATE products SET stock_quantity=9 WHERE id=910003')
    db.prepare('INSERT INTO damaged_stock_lots(product_id,branch_id,quantity,quantity_remaining) VALUES(910001,1,3,3)').run()
    const { result, proxy } = await read(db)
    assert.equal(result.items.find(p => p.id === 910001).display_quantity, 13)
    assert.equal(result.items.find(p => p.id === 910003).display_quantity, null)
    assert.equal(result.stats.stock_quantity, null)
    assert.equal(result.stats.known_stock_quantity, 13)
    assert.equal(result.stats.unknown_stock, 1)
    assert.equal(result.stats.out_of_stock, 1)
    assert.ok(result.stockDiagnostics.find(p => p.product_id === 910003).stock_diagnostics.includes('cache_mismatch'))
    assert.ok(proxy.plans.every(plan => plan.length > 0))
    const out = await read(db, { stockState: 'out_of_stock' })
    assert.deepEqual(out.result.items.filter(p => p.checkable).map(p => p.id), [910002])
    db.close()
  })
  await check('cohort filters compose; headers are decorative, unmatched siblings are omitted and membership is atomic SQL', async () => {
    const db = fixture()
    product(db, 920000, 'Synthetic family', 0, { is_group: 1, received_at: '2026-09-01' })
    product(db, 920001, 'Synthetic child A', 4, { parent_id: 920000 })
    product(db, 920002, 'Synthetic child B', 8, { parent_id: 920000, received_at: '2026-09-01' })
    const query = { startDate: '2026-10-19', endDate: '2026-10-19', brand: 'Synthetic brand', pageSize: 1 }
    const { result } = await read(db, query)
    assert.deepEqual(result.items.map(p => p.id), [920000, 920001])
    assert.equal(result.items[0].checkable, false)
    assert.equal(result.items[0].matches_filters, false)
    assert.equal(result.stats.total_variants, 1)
    const membership = api.buildInventoryCheckProductMembershipQuery(query, [920000, 920001, 920002], api.getInventoryCheckProductsAccess(admin), lowStock)
    const stmt = db.prepare(membership.rowsSql); stmt.setAllowUnknownNamedParameters(true)
    assert.deepEqual(stmt.all(membership.params).map(p => p.id), [920001])
    db.close()
  })
  await check('hidden fields refuse inference before querying; blind reads omit values and customer identities', async () => {
    const db = fixture(); product(db, 930001, 'Synthetic public name', 6)
    const user = { id: 2, role_code: 'staff', role_permissions: JSON.stringify({ inventory: 'review', inventory_check_show_received: true }) }
    const { result } = await read(db, {}, user)
    assert.equal(Object.hasOwn(result.items[0], 'display_quantity'), false)
    assert.equal(Object.hasOwn(result.stats, 'stock_quantity'), false)
    for (const query of [{ sortBy: 'stock' }, { stockState: 'out_of_stock' }, { brand: 'secret' }, { searchFields: 'barcode' }]) {
      const proxy = adapter(db)
      await assert.rejects(() => api.readInventoryCheckProducts(proxy, user, query, { lowStock }), e => e.status === 403)
      assert.equal(proxy.calls, 0)
    }
    const names = await read(db, { query: 'Synthetic' }, user)
    assert.equal(names.result.total, 1)
    const noContacts = { id: 3, role_code: 'staff', role_permissions: JSON.stringify({ inventory: true, contacts: false }) }
    await assert.rejects(() => read(db, {}, noContacts, { rankingLimit: 5, customerRanking: 'sale_count' }), e => e.status === 403)
    db.close()
  })
  await check('global ranking precedes paging; sale-window returns, branch scope and distinct buyers use canonical eligibility', async () => {
    const db = fixture()
    product(db, 940000, 'Synthetic family', 0, { is_group: 1 })
    product(db, 940001, 'Synthetic child A', 5, { parent_id: 940000 })
    product(db, 940002, 'Synthetic child B', 5, { parent_id: 940000 })
    product(db, 940003, 'Z synthetic off-page winner', 9)
    db.exec("INSERT INTO customers(id,name) VALUES(940001,'Synthetic customer one'),(940002,'Synthetic customer two')")
    sale(db, 940001, 940001, [{ product_id: 940001, quantity: 2 }, { product_id: 940002, quantity: 3 }])
    sale(db, 940002, 940001, [{ product_id: 940003, quantity: 20 }])
    sale(db, 940003, 940002, [{ product_id: 940001, branch_id: 2, quantity: 7 }])
    sale(db, 940004, 940002, [{ product_id: 940003, quantity: 100 }], undefined, 'cancelled')
    sale(db, 940005, 940002, [{ product_id: 940003, quantity: 200 }], '2026-10-19T17:00:00.000Z')
    db.prepare("INSERT INTO returns(id,sale_id,branch_id,created_at,status,return_scope) VALUES(940001,940001,1,'2026-11-01 00:00:00','completed','customer')").run()
    db.prepare('INSERT INTO return_items(return_id,product_id,branch_id,quantity,total_usd,total_khr,cost_price_usd,cost_price_khr,return_to_stock) VALUES(940001,940002,1,1,1,0,0,0,1)').run()
    const window = { startDate: '2026-10-19', endDate: '2026-10-19', pageSize: 1 }
    const { result } = await read(db, window, admin, { rankingLimit: 5, customerRanking: 'sale_count' })
    assert.equal(result.total, 2)
    assert.equal(result.items.some(p => p.id === 940003), false, 'the best seller is outside the visible name-sorted page')
    assert.equal(result.rankings.products[0].qty_sold, 20, 'global ranking still finds the off-page best seller')
    assert.equal(result.stats.qty_sold, 31, 'return reverses its in-range sale despite the later return date')
    assert.equal(result.stats.unique_customer_count, 2, 'one buyer across variants counts once')
    assert.equal(result.rankings.customers[0].sale_count, 2, 'one sale with two variants counts once per buyer')
    const sorted = await read(db, { ...window, sortBy: 'qty_sold', sortDirection: 'desc' })
    assert.equal(sorted.result.items[0].id, 940003, 'global metric ordering happens before family pagination')
    const branch = await read(db, { ...window, branchId: 1 })
    assert.equal(branch.result.stats.qty_sold, 24)
    assert.equal(branch.result.stats.unique_customer_count, 1)
    assert.equal(branch.result.items.find(p => p.id === 940002).qty_sold, 2)
    const exact = await read(db, { createdFrom: '2026-10-18T17:00:00Z', createdTo: '2026-10-19T17:00:00Z' })
    assert.equal(exact.result.stats.qty_sold, 31, 'exact UTC bounds and received-day cohort agree at Cambodia midnight')
    db.close()
  })
  await check('selected membership never widens to the catalogue; dates and hidden received filters fail before queries', async () => {
    const db = fixture(); product(db, 950001, 'Synthetic member', 2); product(db, 950002, 'Synthetic other', 3)
    const restricted = await read(db, {}, admin, { productIds: [950001] })
    assert.deepEqual(restricted.result.items.map(p => p.id), [950001])
    assert.equal(restricted.result.stats.stock_quantity, 2)
    const empty = await read(db, {}, admin, { productIds: [] })
    assert.equal(empty.result.total, 0)
    assert.deepEqual(empty.result.items, [])
    for (const query of [{ startDate: '2026-02-30' }, { startDate: '2026-10-20', endDate: '2026-10-19' }, { createdFrom: '2026-10-19T00:00:00Z' }, { page: 1.5 }]) {
      const proxy = adapter(db)
      await assert.rejects(() => api.readInventoryCheckProducts(proxy, admin, query, { lowStock }), e => e.status === 400)
      assert.equal(proxy.calls, 0)
    }
    const blindReceived = { id: 2, role_code: 'staff', role_permissions: JSON.stringify({ inventory: true, inventory_check_show_received: false }) }
    await assert.rejects(() => read(db, { startDate: '2026-10-19' }, blindReceived), e => e.status === 403)
    await assert.rejects(() => read(db, { branchId: 999999 }), e => e.status === 400)
    db.exec('UPDATE branches SET is_active=0 WHERE id<>1')
    assert.equal((await read(db)).result.branches.length, 1, 'the sole active branch remains in the response')
    db.close()
  })
  await check('500-ID admission and complete-family overflow refuse explicitly; actual fixed plans stay measured', async () => {
    const db = fixture()
    product(db, 960000, 'Synthetic large family', 0, { is_group: 1 })
    db.exec("WITH RECURSIVE ids(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM ids WHERE n<501) INSERT INTO products(id,name,parent_id,stock_quantity) SELECT 960000+n,'Synthetic member '||n,960000,0 FROM ids")
    await assert.rejects(() => read(db, { pageSize: 1 }), e => e.code === 'inventory_check_family_page_too_large' && e.limit === 500)
    assert.throws(() => api.buildInventoryCheckProductMembershipQuery({}, Array.from({ length: 501 }, (_, i) => 960001 + i), api.getInventoryCheckProductsAccess(admin), lowStock), e => e.status === 400)
    const ids = Array.from({ length: 499 }, (_, i) => 960001 + i)
    for (const plan of ['free', 'paid']) {
      const statementLimit = tierModule.exports.PLAN_LIMITS_BY_TIER[plan].d1QueriesPerInvocation
      const { result, proxy } = await read(db, { pageSize: 1 }, admin, { productIds: ids })
      assert.equal(result.items.length, 500, '499 real members plus the actual header are complete for the restricted population')
      assert.ok(proxy.statements <= statementLimit)
      console.log(`MEASURE ${plan}: model statements=${proxy.statements}; SQL plan nodes=${proxy.plans.flat().length}; scans=${proxy.plans.flat().filter(row => /SCAN/.test(row.detail)).length}; excludes auth/settings/retries and Worker CPU`)
    }
    db.close()
  })
  console.log(`PASS ${passed} real SQLite Inventory product-read groups; statement/query plans measured, no scale certificate`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
