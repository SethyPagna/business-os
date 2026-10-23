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
  return { statements: 0, calls: 0, plans: [], sql: [], async batch(statements) {
    this.calls++; this.statements += statements.length
    this.sql.push(...statements.map(statement => statement.sql))
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
  db.prepare('INSERT INTO products(id,name,stock_quantity,parent_id,is_group,brand,category,barcode,sku) VALUES(?,?,?,?,?,?,?,?,?)').run(id, name, quantity, extra.parent_id ?? null, extra.is_group ?? 0, extra.brand ?? 'Synthetic brand', extra.category ?? 'Synthetic category', extra.barcode ?? null, extra.sku ?? null)
  db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,?)').run(id, quantity)
  db.prepare('INSERT INTO product_batches(id,variant_product_id,batch_key,received_at) VALUES(?,?,?,?)').run(id, id, `fixture-${id}`, extra.received_at ?? '2026-10-19')
  db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,?)').run(id, quantity)
}
// An extra lot for a product; the caller keeps the ordinary stock at least as large as its lots.
function lot(db, id, productId, branchId, quantity, expiry) {
  db.prepare('INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,expiry_date) VALUES(?,?,?,?,?)').run(id, productId, `fixture-lot-${id}`, '2026-10-19', expiry)
  db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,?)').run(id, branchId, quantity)
}
const keysOf = row => Object.keys(row).filter(key => key === 'barcode' || key === 'sku' || key.startsWith('__code'))
const blindViewer = permissions => ({ id: 7, role_code: 'staff', role_permissions: JSON.stringify({ inventory_checks: true, ...permissions }) })
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
  await check('received EXISTS keeps SQLite date semantics and searches only the selected variant lots', async () => {
    const db = fixture()
    const dates = ['2026-10-19', '2026-10-19T23:59:59.999Z', '2026-10-19 12:30:00',
      '2026-10-18T23:30:00-02:00', '2026-10-20T00:30:00+02:00', '2026-10-19T00:30:00+02:00',
      '2026-02-30', '2026-02-31', '2461332.5', '12:00:00', null, '', '2026/10/19', 'not-a-date']
    for (let i = 0; i < dates.length; i++) {
      product(db, 980001 + i, `Date shape ${i}`, 1)
      db.prepare('UPDATE product_batches SET received_at=? WHERE id=?').run(dates[i], 980001 + i)
    }
    for (const query of [{ startDate: '2026-10-19', endDate: '2026-10-19' }, { startDate: '2026-03-02', endDate: '2026-03-03' },
      { endDate: '2000-01-01' }, { startDate: '2026-10-19' }]) {
      const params = { receivedFrom: query.startDate ?? null, receivedTo: query.endDate ?? null }
      const expected = db.prepare(`SELECT p.id FROM products p WHERE EXISTS(SELECT 1 FROM product_batches receipt WHERE receipt.variant_product_id=p.id
        AND (@receivedFrom IS NULL OR date(receipt.received_at)>=@receivedFrom)
        AND (@receivedTo IS NULL OR date(receipt.received_at)<=@receivedTo)) ORDER BY p.id`).all(params).map(row => row.id)
      const { result } = await read(db, { ...query, pageSize: 100 })
      assert.deepEqual(result.items.filter(row => row.checkable).map(row => row.id).sort((a,b) => a-b), expected)
      assert.equal(result.stats.total_variants, expected.length)
      const membership = api.buildInventoryCheckProductMembershipQuery(query, dates.map((_, i) => 980001+i), api.getInventoryCheckProductsAccess(admin), lowStock)
      const statement = db.prepare(membership.rowsSql); statement.setAllowUnknownNamedParameters(true)
      assert.deepEqual(statement.all(membership.params).map(row => row.id).sort((a,b) => a-b), expected)
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${membership.rowsSql}`); plan.setAllowUnknownNamedParameters(true)
      assert.ok(plan.all(membership.params).some(row => /SEARCH receipt(?: EXISTS)? USING COVERING INDEX idx_product_batches_variant_expiry \(variant_product_id=\?\)/.test(row.detail)), 'actual admission SQL searches the variant-key index')
    }
    const overflow = await read(db, { startDate: '2026-03-02', endDate: '2026-03-03' })
    assert.ok(overflow.result.items.some(row => row.id === 980007) && overflow.result.items.some(row => row.id === 980008), 'SQLite-normalized overflow dates must not be lost to a raw textual day bound')
    db.close()

    const work = fixture(), size = 160, ids = []
    for (let i = 0; i < size; i++) {
      const id = 981001+i; ids.push(id); product(work, id, `Receipt work ${i}`, 1, { received_at: '2026-09-01' })
      for (let n = 1; n <= 3; n++) work.prepare('INSERT INTO product_batches(id,variant_product_id,batch_key,received_at) VALUES(?,?,?,?)').run(982000+i*3+n, id, `receipt-${id}-${n}`, '2026-09-01')
    }
    work.prepare('UPDATE product_batches SET received_at=? WHERE variant_product_id=?').run('2026-10-19', ids.at(-1))
    const membership = api.buildInventoryCheckProductMembershipQuery({ startDate: '2026-10-19', endDate: '2026-10-19' }, ids, api.getInventoryCheckProductsAccess(admin), lowStock)
    let evaluations = 0
    work.function('inventory_received_work_probe', value => { evaluations++; return value })
    const measuredSql = membership.rowsSql.replaceAll('date(receipt.received_at)', 'date(inventory_received_work_probe(receipt.received_at))')
    const execute = sql => { const statement = work.prepare(sql); statement.setAllowUnknownNamedParameters(true); return statement.all(membership.params).map(row => row.id) }
    assert.deepEqual(execute(measuredSql), [ids.at(-1)])
    const indexedWork = evaluations
    assert.ok(indexedWork > 0 && indexedWork <= size * 4 * 2, `${indexedWork} date evaluations exceed the per-variant lot bound`)
    evaluations = 0
    const scanSql = measuredSql.replace('receipt.variant_product_id=p.id', '+receipt.variant_product_id=p.id')
    assert.notEqual(scanSql, measuredSql)
    assert.deepEqual(execute(scanSql), [ids.at(-1)], 'the no-index negative control preserves rows')
    const scanPlan = work.prepare(`EXPLAIN QUERY PLAN ${scanSql}`); scanPlan.setAllowUnknownNamedParameters(true)
    assert.ok(!scanPlan.all(membership.params).some(row => /SEARCH receipt .*\(variant_product_id=\?\)/.test(row.detail)), 'negative control actually disables the variant seek')
    const uncorrelated = membership.rowsSql.replace('receipt.variant_product_id=p.id', '1=1')
    assert.equal(execute(uncorrelated).length, size, 'removing correlation admits unrelated variants and is detected')
    console.log(`MEASURE received date: ${indexedWork} residual evaluations for ${size} variants with four lots; variant-index removal preserves rows and loses its seek`)
    work.close()
  })
  await check('cost review metadata remains schema compatible, boolean, private and field authorized without added reads', async () => {
    const db = fixture()
    product(db, 900000, 'Synthetic family', 0, { is_group: 1, received_at: '2026-09-01' })
    for (let n = 1; n <= 3; n++) product(db, 900000+n, `Synthetic review ${n}`, n, { parent_id: 900000 })
    const query = { startDate: '2026-10-19' }
    const historical = await read(db, query)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('products') WHERE name='cost_review_key'").get().n, 0)
    for (const row of historical.result.items.filter(row => row.checkable)) assert.equal(row.cost_needs_review, false)
    assert.ok(historical.proxy.sql.every(sql => !sql.includes('p.cost_review_key')))
    db.exec('ALTER TABLE products ADD COLUMN cost_review_key TEXT')
    db.prepare('UPDATE products SET cost_review_key=? WHERE id=900001').run('0123456789abcdef0123456789abcdef')
    db.exec("UPDATE products SET cost_review_key='' WHERE id=900002")
    const tagged = await read(db, query, admin, { costReviewKeyAvailable: true })
    assert.deepEqual(tagged.result.items.filter(row => row.checkable).map(row => row.cost_needs_review), [true, false, false])
    assert.ok(!Object.hasOwn(tagged.result.items[0], 'cost_needs_review'), 'decorative family header never inherits a child marker')
    assert.deepEqual({ ...tagged.result, items: tagged.result.items.map(row => row.checkable ? { ...row, cost_needs_review: false } : row) }, historical.result, 'only the derived marker changes the full model output')
    assert.ok(!JSON.stringify(tagged.result).includes('cost_review_key'))
    assert.ok(!JSON.stringify(tagged.result).includes('0123456789abcdef0123456789abcdef'))
    for (const permissions of [
      { inventory_checks: true, inventory_check_show_cost: false, product_cost_view: true },
      { inventory_checks: true, inventory_check_show_cost: true, product_cost_view: false },
    ]) {
      const hidden = await read(db, {}, { id: 2, role_code: 'employee', role_permissions: JSON.stringify(permissions) }, { costReviewKeyAvailable: true })
      assert.ok(hidden.proxy.sql.every(sql => !sql.includes('p.cost_review_key')), 'hidden cost never selects the source marker')
      for (const row of hidden.result.items) for (const key of ['cost_needs_review', 'cost_review_key', 'cost_price_usd', 'cost_price_khr']) assert.ok(!Object.hasOwn(row, key), key)
    }
    const permitted = await read(db, query, { id: 2, role_code: 'employee', role_permissions: JSON.stringify({ inventory_checks: true, inventory_check_show_received: true, inventory_check_show_cost: true, product_cost_view: true }) }, { costReviewKeyAvailable: true })
    assert.equal(permitted.result.items.find(row => row.id === 900001).cost_needs_review, true)
    db.close()
  })
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
    const user = { id: 2, role_code: 'staff', role_permissions: JSON.stringify({ inventory: 'review', inventory_checks: true, inventory_check_show_received: true }) }
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
    const noContacts = { id: 3, role_code: 'staff', role_permissions: JSON.stringify({ inventory: true, inventory_checks: true, contacts: false }) }
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
    const blindReceived = { id: 2, role_code: 'staff', role_permissions: JSON.stringify({ inventory: true, inventory_checks: true, inventory_check_show_received: false }) }
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
  await check('reused filtered population evaluates computed stock once per product per main statement', async () => {
    const db = fixture(), size = 160
    db.prepare("INSERT INTO customers(id,name) VALUES(970000,'Synthetic work counter buyer')").run()
    for (let index = 0; index < size; index++) {
      const id = 970001 + index
      product(db, id, `Synthetic family ${Math.floor(index / 4)}`, 5)
      sale(db, id, 970000, [{ product_id: id, quantity: 1 }])
    }
    const options = { lowStock, rankingLimit: 10, customerRanking: 'sale_count' }
    const original = await api.readInventoryCheckProducts(adapter(db), admin, {}, options)
    let evaluations = 0
    db.function('inventory_stock_work_probe', { deterministic: true }, value => { evaluations++; return value })
    const proxy = adapter(db), actualBatch = proxy.batch.bind(proxy)
    proxy.batch = statements => actualBatch(statements.map(statement => ({ ...statement,
      sql: statement.sql.replaceAll('stock.quantity AS __quantity', 'inventory_stock_work_probe(stock.quantity) AS __quantity') })))
    const measured = await api.readInventoryCheckProducts(proxy, admin, {}, options)
    assert.deepEqual(measured, original, 'the transparent computation probe preserves every projected result')
    assert.ok(evaluations > 0, 'the actual computed quantity must pass through the probe')
    assert.ok(evaluations <= size * 4, `filtered stock repeated ${evaluations} evaluations for ${size} products`)
    assert.equal(proxy.statements, 5, 'bounded reuse does not add request statements')
    console.log(`MEASURE computed stock: ${evaluations} evaluations for ${size} products across five statements`)
    db.close()
  })
  await check('search matches a barcode or SKU substring for a viewer who sees barcodes, and names still match', async () => {
    const db = fixture()
    product(db, 990001, 'Alpha cream', 2, { barcode: '8850001112223', sku: 'SKU-AL-77' })
    product(db, 990002, 'Beta soap', 3, { barcode: '9990001110000', sku: 'SKU-BE-12' })
    product(db, 990003, 'Zeta lotion', 4)
    const visible = blindViewer({ inventory_check_show_barcode: true })
    for (const [viewer, label] of [[admin, 'admin'], [visible, 'barcode-visible employee']]) {
      for (const [query, expected] of [['8850001112223', [990001]], ['0001112', [990001]], ['sku-al', [990001]], ['SKU-BE-12', [990002]],
        ['000111', [990001, 990002]], ['beta', [990002]], ['no such text', []]]) {
        const { result } = await read(db, { query, pageSize: 100 }, viewer)
        assert.deepEqual(result.items.filter(row => row.checkable).map(row => row.id).sort(), expected, `${label}: ${query}`)
        assert.equal(result.stats.total_variants, expected.length, `${label}: ${query} summary agrees with the rows`)
      }
    }
    const { result } = await read(db, { query: '8850001112223' }, visible)
    assert.equal(result.items[0].barcode, '8850001112223', 'a visible barcode is still returned')
    assert.equal(result.items[0].sku, 'SKU-AL-77')
    assert.deepEqual(keysOf(result.items[0]).sort(), ['barcode', 'sku'], 'the matching helper columns never reach the row')
    const membership = api.buildInventoryCheckProductMembershipQuery({ query: '8850001112223' }, [990001, 990002, 990003], api.getInventoryCheckProductsAccess(admin), lowStock)
    const statement = db.prepare(membership.rowsSql); statement.setAllowUnknownNamedParameters(true)
    assert.deepEqual(statement.all(membership.params).map(row => row.id), [990001], 'a session created from a scanned list admits the product its code selects')
    db.close()
  })
  await check('a viewer who cannot see barcodes finds a product by its exact barcode or SKU only, and never receives a code', async () => {
    const db = fixture()
    product(db, 990001, 'Alpha cream', 2, { barcode: '8850001112223', sku: 'SKU-AL-77' })
    product(db, 990002, 'Beta soap', 3, { barcode: '8850001119999', sku: 'SKU-BE-12' })
    const blind = blindViewer({})
    const access = api.getInventoryCheckProductsAccess(blind)
    assert.equal(access.fields.barcode, false)
    for (const [query, expected] of [['8850001112223', [990001]], ['SKU-AL-77', [990001]], ['8850001119999', [990002]], ['Alpha', [990001]],
      ['885000', []], ['8850001', []], ['1112223', []], ['SKU-AL', []], ['AL-77', []], ['88500011122230', []]]) {
      const { result } = await read(db, { query, pageSize: 100 }, blind)
      assert.deepEqual(result.items.filter(row => row.checkable).map(row => row.id), expected, query)
      assert.equal(result.stats.total_variants, expected.length, `${query}: the summary counts the same rows`)
      for (const row of result.items) assert.deepEqual(keysOf(row), [], `${query}: no barcode, sku or helper column in row ${row.id}`)
      assert.ok(!/8850001|SKU-/.test(JSON.stringify(result)), `${query}: no code anywhere in the response`)
    }
    for (const [query, expected] of [['8850001112223', [990001]], ['885000', []], ['SKU-BE', []]]) {
      const membership = api.buildInventoryCheckProductMembershipQuery({ query }, [990001, 990002], access, lowStock)
      const statement = db.prepare(membership.rowsSql); statement.setAllowUnknownNamedParameters(true)
      assert.deepEqual(statement.all(membership.params).map(row => row.id), expected, `membership ${query}`)
    }
    await assert.rejects(() => read(db, { searchFields: 'barcode' }, blind), error => error.status === 403)
    db.close()
  })
  await check('a code typed or scanned with Khmer digits finds the same product, and name matching keeps the text as typed', async () => {
    const db = fixture()
    product(db, 990001, 'Alpha cream', 2, { barcode: '8850001112223', sku: 'SKU-77' })
    product(db, 990002, 'Beta ១២ soap', 3, { barcode: '9990001110000' })
    product(db, 990003, 'Zeta lotion', 4, { barcode: '7770001110000' })
    const visible = blindViewer({ inventory_check_show_barcode: true })
    const blind = blindViewer({})
    const ids = async (viewer, query) => (await read(db, { query, pageSize: 100 }, viewer)).result.items.filter(row => row.checkable).map(row => row.id).sort()
    const full = '៨៨៥០០០១១១២២២៣', part = '១១១២២២៣'
    for (const [viewer, label] of [[admin, 'admin'], [visible, 'barcode-visible employee']]) {
      assert.deepEqual(await ids(viewer, full), [990001], `${label}: the whole code in Khmer digits`)
      assert.deepEqual(await ids(viewer, part), [990001], `${label}: a code fragment in Khmer digits`)
      assert.deepEqual(await ids(viewer, 'sku-៧៧'), [990001], `${label}: a SKU with Khmer digits`)
    }
    assert.deepEqual(await ids(blind, full), [990001], 'a barcode-hidden viewer finds the exact code typed in Khmer digits')
    assert.deepEqual(await ids(blind, part), [], 'and a Khmer-digit fragment still finds nothing for them')
    assert.deepEqual(await ids(admin, 'Beta ១២'), [990002], 'a name containing Khmer digits matches as typed')
    assert.deepEqual(await ids(admin, 'Beta 12'), [], 'names are not folded: Latin 12 is not the Khmer ១២ in the name')
    const membership = api.buildInventoryCheckProductMembershipQuery({ query: full }, [990001, 990002, 990003], api.getInventoryCheckProductsAccess(admin), lowStock)
    const statement = db.prepare(membership.rowsSql); statement.setAllowUnknownNamedParameters(true)
    assert.deepEqual(statement.all(membership.params).map(row => row.id), [990001], 'a session created from a Khmer-digit scan admits the product its code selects')
    db.close()
  })
  await check('next expiry is the earliest dated lot holding stock in the branch scope, and only for viewers who see received dates and stock', async () => {
    const db = fixture()
    product(db, 991001, 'Expiry cream', 20)
    db.exec('UPDATE branch_batch_stock SET quantity=10 WHERE batch_id=991001')
    db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(991001,2,5)').run()
    db.exec('UPDATE products SET stock_quantity=25 WHERE id=991001')
    lot(db, 991101, 991001, 1, 4, '2027-03-01')
    lot(db, 991102, 991001, 1, 0, '2026-12-01')
    lot(db, 991103, 991001, 1, 2, '')
    lot(db, 991104, 991001, 2, 5, '2026-11-15')
    product(db, 991002, 'No expiry soap', 5)
    const expiry = async (query, viewer = admin) => {
      const { result, proxy } = await read(db, { ...query, pageSize: 100 }, viewer)
      return { byName: Object.fromEntries(result.items.filter(row => row.checkable).map(row => [row.name, row.next_expiry_date])), result, proxy }
    }
    assert.equal((await expiry({ branchId: 1 })).byName['Expiry cream'], '2027-03-01', 'branch 1: the emptied earlier lot, the branch 2 lot, the undated lot and the blank date are all ignored')
    assert.equal((await expiry({ branchId: 2 })).byName['Expiry cream'], '2026-11-15')
    assert.equal((await expiry({})).byName['Expiry cream'], '2026-11-15', 'no branch scope considers every branch')
    assert.equal((await expiry({ branchId: 1 })).byName['No expiry soap'], null, 'a product without a dated lot reports null')
    db.exec('UPDATE branch_batch_stock SET quantity=0 WHERE batch_id=991101')
    assert.equal((await expiry({ branchId: 1 })).byName['Expiry cream'], null, 'once the dated lot is empty nothing is left to expire in that branch')
    db.exec('UPDATE branch_batch_stock SET quantity=4 WHERE batch_id=991101')

    const full = blindViewer({ inventory_check_show_stock: true, inventory_check_show_received: true })
    assert.equal((await expiry({ branchId: 1 }, full)).byName['Expiry cream'], '2027-03-01', 'a non-admin viewer with both fields gets it')
    for (const [permissions, why] of [[{ inventory_check_show_stock: true }, 'received hidden'], [{ inventory_check_show_received: true }, 'stock hidden: a dated lot with stock would reveal that stock exists'], [{}, 'both hidden']]) {
      const { result, proxy } = await expiry({ branchId: 1 }, blindViewer(permissions))
      for (const row of result.items) assert.ok(!Object.hasOwn(row, 'next_expiry_date'), `${why}: row ${row.id}`)
      assert.ok(proxy.sql.every(sql => !sql.includes('next_expiry_date')), `${why}: the lot lookup is not even issued`)
    }
    const { proxy } = await expiry({ branchId: 1 })
    const plans = proxy.plans.flat().map(row => row.detail)
    assert.ok(plans.some(detail => /SEARCH pb USING (?:COVERING )?INDEX idx_product_batches_variant_expiry \(variant_product_id=\?\)/.test(detail)), 'the lot lookup seeks the variant index')
    assert.ok(plans.some(detail => /SEARCH bs USING (?:COVERING )?INDEX idx_branch_batch_stock_(?:batch_branch_unique|positive_batch_0155) \(batch_id=\?\)/.test(detail)), 'the stock lookup seeks a batch-keyed index')
    db.close()
  })
  await check('next expiry is looked up for the returned page rows only, whatever the sort, and keeps every page order', async () => {
    const db = fixture(), size = 160, pageSize = 20, lotsPer = 3
    for (let i = 0; i < size; i++) {
      const id = 992001 + i
      product(db, id, `Expiry work ${String(i).padStart(3, '0')}`, 3)
      db.exec(`UPDATE branch_batch_stock SET quantity=1 WHERE batch_id=${id}`)
      lot(db, 993000 + i * 2, id, 1, 1, `2027-0${1 + i % 9}-01`)
      lot(db, 993001 + i * 2, id, 1, 1, `2027-0${1 + (i + 3) % 9}-15`)
    }
    let evaluations = 0
    db.function('inventory_expiry_work_probe', { deterministic: true }, value => { evaluations++; return value })
    for (const query of [{}, { sortBy: 'stock', sortDirection: 'desc' }, { stockState: 'in_stock' }]) {
      const original = await read(db, { ...query, pageSize })
      evaluations = 0
      const proxy = adapter(db), actualBatch = proxy.batch.bind(proxy)
      proxy.batch = statements => actualBatch(statements.map(statement => ({ ...statement,
        sql: statement.sql.replaceAll('MIN(pb.expiry_date)', 'MIN(inventory_expiry_work_probe(pb.expiry_date))') })))
      const measured = await api.readInventoryCheckProducts(proxy, admin, { ...query, pageSize }, { lowStock })
      assert.deepEqual(measured, original.result, 'the transparent probe preserves the full result')
      assert.ok(evaluations > 0, `${JSON.stringify(query)}: the lookup must pass through the probe`)
      assert.ok(evaluations <= pageSize * lotsPer, `${JSON.stringify(query)}: ${evaluations} lot reads for a ${pageSize}-row page of ${size} products`)
      assert.equal(proxy.statements, 5, 'the lookup adds no request statement')
      assert.equal(measured.items.filter(row => row.checkable).length, pageSize)
      console.log(`MEASURE next expiry ${JSON.stringify(query)}: ${evaluations} lot reads for ${pageSize} page rows of ${size} products`)
    }
    db.close()

    const order = fixture()
    for (const [id, name, quantity] of [[994001, 'Page order e', 3], [994002, 'Page order b', 9], [994003, 'Page order d', 6], [994004, 'Page order a', 1], [994005, 'Page order c', 7]]) product(order, id, name, quantity)
    for (const [query, expected] of [[{ sortBy: 'stock', sortDirection: 'desc' }, [994002, 994005, 994003, 994001, 994004]], [{ sortBy: 'stock' }, [994004, 994001, 994003, 994005, 994002]],
      [{ sortDirection: 'desc' }, [994001, 994003, 994005, 994002, 994004]], [{}, [994004, 994002, 994005, 994003, 994001]]]) {
      const walked = []
      for (let page = 1; page <= 3; page++) walked.push(...(await read(order, { ...query, page, pageSize: 2 })).result.items.filter(row => row.checkable).map(row => row.id))
      assert.deepEqual(walked, expected, JSON.stringify(query))
    }
    order.close()
  })
  console.log(`PASS ${passed} real SQLite Inventory product-read groups; statement/query plans measured, no scale certificate`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
