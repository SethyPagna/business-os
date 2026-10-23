// Inventory check D1 read cost on local workerd (rows_read per statement), with the results pinned to the
// pre-change output on a mixed 1,000-product fixture: active/archived, name and parent families, two branches,
// tagged damaged lots, unknown stock (cache mismatch, lot excess), thresholds and sales with customers.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')
const root = path.resolve(__dirname, '..')
const P = 1000
const sha = text => createHash('sha256').update(text).digest('hex')

// Outputs of the pre-change implementation (22b27f61b) on this fixture; any drift in rows, order, totals,
// facets, rankings or summary changes a hash.
const GOLDEN = {
  'list:name': '180891a51a2f09532ed0c48ad96ce73bb343ac4c75c2f743ad483e56d88fb006',
  'list:all_branches': '23df5ac23c1ce6ad4b369233d9d5bd88968566a4f008755fb6fe9d7e81bad27c',
  'list:name_page3': '9e4e38b7ae278fa6bf696aecf3f7719e145310ca3f1ea0dd1dd79a1479576511',
  'list:name_desc_b2': 'a16223057586be7487090a391bbb5e509f9182fbad8e3e1f51ded1d78ec7fea6',
  'list:price': '7ecf0d3d0b09daba861527b623e9ccd535c291829dcdb5359517646de4bfebba',
  'list:cost_p2': 'cad7e08aba0810b14bc8e7c639c9e096bb698b00b034555012652a03a7a6791b',
  'list:received': 'f0d6304cc472728dfb169917775bd2f2a041a20931fdc80bba17c4e7b246be4b',
  'list:qty_sold': '064c8b9c055f182a461eecba8b52aa1af2ae40df7a0d6718e78275f72a4fd840',
  'list:search': 'a54a5575d6394947c653666dff19b6512cd6e98821b40c292adf774e8944d731',
  'list:brand': '8334074ffca72dd7fb7860fc77dc8f800d4a54083bfa9237d5c8f604fee0392f',
  'list:grouped': 'c62458da2e164ca6036a01fcec98fb2be2347377d72b2589d9736078916bd281',
  'list:dates': '61581e045b1abce7a8d3deebb6c9b238d54e0b112d03b1883cf8b42fdb58fbe7',
  'list:initial': '9808cd605bf372e6bd07c24db6277cfcee2d3576b8b49a72ba387ef2148e17dd',
  'list:stock': 'b6fe208a9e2a4ee80b21ed715a8fe6682abcc179e225832f5425ccb39a2fe667',
  'list:stock_desc': '539646f11f99daf33603f8ea95656ebcc273dc3e961acd6c65d8ef53bcd43675',
  'list:low': '211b04c079f4713a90a0f7433711d4c24ab1e10a4ce006277949854390c0510b',
  'list:out': '676dca0f46437dfe3bbffdf84dc2da30935704d66404964cefde71d1cf6f0276',
  'list:in_b2': '834349d8861fe49d2e7a57fddc6801080946675367ab09331166a78dcfc99914',
  'list:low_price': 'bc98a5cbdbe6ac4d834d0ac69274606af3b3cc641fde96a39205b9ff021ebb3d',
  'list:counter': 'e251e9946253bd7e5053d1ac7a62270bc88f8e1d9755691f4507a86928b9b4fd',
}
const STATS = { total_products: 858, total_variants: 953, stock_quantity: null, known_stock_quantity: 17241, unknown_stock: 35, in_stock: 728,
  healthy: 600, low_stock: 126, out_of_stock: 100, qty_sold: 18, unique_customer_count: 5 }

const WORKER = `
  import { getDb } from './src/lib/db'
  import { readInventoryCheckProducts } from './src/lib/inventoryCheckProducts'
  import * as stock from './src/lib/inventoryCheckStock'
  import * as sessions from './src/lib/inventoryCheckSessions'
  const lowStock = { enabled: true, mode: 'product', threshold: 5 }
  export default { async fetch(request, env) {
    const { op, actor, args = {} } = await request.json(), log = [], raw = env.DB
    const record = (sql, result) => { log.push({ rows: result.meta?.rows_read || 0, sql: sql.slice(0, 120) }); return result }
    const statement = sql => { const prepared = raw.prepare(sql); return { bind(...values) { const bound = prepared.bind(...values)
      return { inner: bound, sql, async all() { return record(sql, await bound.all()) }, async run() { return record(sql, await bound.run()) },
        async first() { const result = record(sql, await bound.all()); return result.results[0] ?? null } } } } }
    const db = getDb({ DB: { prepare: statement, async batch(items) { const results = await raw.batch(items.map(item => item.inner)); results.forEach((result, index) => record(items[index].sql, result)); return results } } })
    const principal = { id: actor.id, tokenHash: actor.tokenHash }
    let out
    try {
      if (op === 'list') {
        const user = await sessions.currentInventoryCheckActor(db, principal); log.length = 0
        out = await readInventoryCheckProducts(db, user, args.query, { lowStock, rankingLimit: 10, costReviewKeyAvailable: user.product_cost_review_key_available === 1,
          ...(args.customers ? { customerRanking: 'sale_count' } : {}), observationFilter: { organizationId: user.organization_id ?? null, viewerId: user.id, ...args.observation } })
      }
      if (op === 'stock') out = await stock.readInventoryCheckStock(db, args.scope)
      if (op === 'create') out = await sessions.createInventoryCheckSession(db, principal, args.body, lowStock)
      if (op === 'get') out = await sessions.getInventoryCheckSession(db, principal, args.id)
      if (op === 'patch') out = await sessions.patchInventoryCheckObservation(db, principal, args.id, args.productId, args.body)
      if (op === 'close') out = await sessions.patchInventoryCheckSession(db, principal, args.id, args.body)
      if (op === 'history') out = await sessions.inventoryCheckSessionHistory(db, principal, args.id, {})
    } catch (error) { out = { error: error?.code || error?.message || String(error), status: error?.status } }
    return Response.json({ out, log })
  } }`

const FIXTURE = [
  "INSERT INTO system_flags(key,value) VALUES('stock_transaction_permit','legacy-separate-pool-v1')",
  "INSERT OR IGNORE INTO branches(id,name,is_active) VALUES(1,'Shop',1),(2,'Warehouse',1),(3,'Closed',0)",
  `WITH RECURSIVE n(j) AS (SELECT 0 UNION ALL SELECT j+1 FROM n WHERE j<${P - 1}),
    shaped AS (SELECT j,1000+j AS id,(j%50=0 AND j+2<${P}) AS grp,(j%37=0 AND NOT (j%50=0 AND j+2<${P})) AS archived FROM n)
    INSERT INTO products(id,name,barcode,sku,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active,brand,category,parent_id,is_group,low_stock_threshold,out_of_stock_threshold)
    SELECT id,'Product '||(CASE WHEN j%10=1 THEN j-1 ELSE j END)||' '||(CASE (CASE WHEN j%10=1 THEN j-1 ELSE j END)%4 WHEN 0 THEN 'Serum' WHEN 1 THEN 'Cream' WHEN 2 THEN 'Powder' ELSE 'Balm' END),
      '885'||printf('%010d',id),'SKU-'||id,
      CASE WHEN grp OR archived THEN 0 ELSE (CASE WHEN j%7=0 THEN 0 WHEN j%5=0 THEN 3 ELSE 20+j%13 END)+(CASE WHEN j%3=0 THEN 4+j%4 ELSE 0 END)+(CASE WHEN j%23=0 THEN 5 ELSE 0 END) END,
      5+j%20,(5+j%20)*4000,1+(j%9)/4.0,5000,1,'Brand'||(j%12),'Cat'||(j%6),
      CASE WHEN j%50 IN (1,2) THEN 1000+j-j%50 END,grp,CASE WHEN j%9=0 THEN 25 END,CASE WHEN j%17=0 THEN 2 END FROM shaped`,
  `INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,expiry_date)
    SELECT id+500000,id,'b-'||id,'L-'||id,'2026-0'||(1+(id-1000)%9)||'-01',1,1,'2027-06-01' FROM products WHERE id BETWEEN 1000 AND ${999 + P}`,
  `WITH q AS (SELECT id,id-1000 AS j,CASE WHEN is_group=1 OR stock_quantity=0 AND (id-1000)%37=0 THEN 0 WHEN (id-1000)%7=0 THEN 0 WHEN (id-1000)%5=0 THEN 3 ELSE 20+(id-1000)%13 END AS q1
      FROM products WHERE id BETWEEN 1000 AND ${999 + P})
    INSERT INTO branch_stock(product_id,branch_id,quantity) SELECT id,1,q1 FROM q WHERE q1>0 OR j%4=0`,
  'INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) SELECT s.product_id+500000,1,s.quantity+CASE WHEN (s.product_id-1000)%29=0 THEN 2 ELSE 0 END FROM branch_stock s WHERE s.branch_id=1 AND s.quantity>0',
  `INSERT INTO branch_stock(product_id,branch_id,quantity) SELECT id,2,4+(id-1000)%4 FROM products
    WHERE id BETWEEN 1000 AND ${999 + P} AND (id-1000)%3=0 AND is_group=0 AND NOT ((id-1000)%37=0)`,
  `INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,expiry_date)
    SELECT product_id+700000,product_id,'c-'||product_id,'M-'||product_id,'2026-10-01',1,2,'2027-07-01' FROM branch_stock WHERE branch_id=2`,
  'INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) SELECT product_id+700000,2,quantity FROM branch_stock WHERE branch_id=2',
  `INSERT INTO damaged_stock_lots(product_id,branch_id,quantity,quantity_remaining,condition_tag,source)
    SELECT id,CASE WHEN (id-1000)%22=0 THEN 2 ELSE 1 END,2,2,'damaged','tag' FROM products
    WHERE id BETWEEN 1000 AND ${999 + P} AND (id-1000)%11=0 AND is_group=0 AND NOT ((id-1000)%37=0)`,
  `UPDATE products SET is_active=0 WHERE id BETWEEN 1000 AND ${999 + P} AND (id-1000)%37=0 AND is_group=0`,
  `WITH RECURSIVE n(j) AS (SELECT 1 UNION ALL SELECT j+1 FROM n WHERE j<40) INSERT INTO customers(id,name,phone) SELECT j,'Customer '||j,'0'||(10000000+j) FROM n`,
  `WITH RECURSIVE n(k) AS (SELECT 0 UNION ALL SELECT k+1 FROM n WHERE k<11)
    INSERT INTO sales(id,receipt_number,customer_id,customer_name,created_at,sale_status,subtotal_usd,total_usd)
    SELECT 900+k,'cost-'||k,CASE WHEN k%2=1 THEN 1+k%5 END,CASE WHEN k%2=1 THEN 'Customer '||(1+k%5) END,'2026-10-1'||(k%9)||' 03:00:00','completed',8,8 FROM n`,
  `INSERT INTO sale_items(sale_id,product_id,branch_id,quantity,total_usd,total_khr,cost_price_usd,cost_price_khr)
    SELECT id,1003+((id-900)*7)%300,1,1+(id-900)%2,8,32000,1.75,5000 FROM sales WHERE id BETWEEN 900 AND 911`,
  `INSERT OR REPLACE INTO roles(id,name,code,permissions) VALUES(910001,'Administrator','admin','{}'),
    (910002,'Counter','employee','{"inventory":true,"inventory_checks":true,"inventory_check_show_price":true,"inventory_check_show_barcode":true,"inventory_check_show_category":true,"inventory_check_show_brand":true,"inventory_check_show_received":true,"inventory_check_show_sales":true,"inventory_check_show_customers":true,"inventory_check_show_stock":false}')`,
  "DELETE FROM system_flags WHERE key='stock_transaction_permit'",
  "INSERT INTO users(id,username,name,password,role_id,organization_id) VALUES(910001,'cost-admin','Cost admin','unused',910001,1),(910002,'cost-counter','Cost counter','unused',910002,1)",
]

async function main() {
  const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: WORKER }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
    conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:*'], logLevel: 'error' })
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    const migrationDir = path.join(root, 'migrations'), statements = []
    for (const name of fs.readdirSync(migrationDir).filter(n => n.endsWith('.sql')).sort()) {
      for (const sql of split(fs.readFileSync(path.join(migrationDir, name), 'utf8')).filter(sql => sql.trim())) {
        if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(sql.trim())) continue
        statements.push(sql)
      }
    }
    for (let i = 0; i < statements.length; i += 100) await db.batch(statements.slice(i, i + 100).map(sql => db.prepare(sql)))
    for (const sql of FIXTURE) try { await db.prepare(sql).run() } catch (error) { throw new Error(sql.slice(0, 80) + ': ' + error.message) }
    const actors = {}
    for (const [name, id] of [['admin', 910001], ['counter', 910002]]) {
      actors[name] = { id, tokenHash: sha(`cost-token-${id}`) }
      await db.prepare("INSERT INTO user_sessions(user_id,token_hash,expires_at,last_seen_at) VALUES(?,?,'2099-01-01T00:00:00.000Z',CURRENT_TIMESTAMP)").bind(id, actors[name].tokenHash).run()
    }
    const census = (await db.prepare(`SELECT (SELECT COUNT(*) FROM products) products,(SELECT COUNT(*) FROM products WHERE is_active=0) archived,
      (SELECT COUNT(*) FROM branch_stock) ordinary,(SELECT COUNT(*) FROM branch_batch_stock) lots,(SELECT COUNT(*) FROM damaged_stock_lots) damaged,
      (SELECT COUNT(*) FROM sale_items) sold,(SELECT value FROM system_flags WHERE key='stock_schema_epoch') epoch`).all()).results[0]
    assert.deepEqual(census, { products: P, archived: 27, ordinary: 1184, lots: 1134, damaged: 87, sold: 12, epoch: 'legacy-separate-pool-v1' }, 'fixture shape')
    const call = async (op, args = {}, actor = actors.admin) => {
      const response = await mf.dispatchFetch('http://local.test/', { method: 'POST', body: JSON.stringify({ op, actor, args }) })
      assert.equal(response.status, 200)
      const body = await response.json()
      return { out: body.out, rows: body.log.reduce((sum, entry) => sum + entry.rows, 0), log: body.log }
    }
    // next_expiry_date is the one field added since the pinned output; it is asserted below, everything else must be identical.
    const pinned = (label, out) => {
      const digest = sha(JSON.stringify(out, (key, value) => key === 'next_expiry_date' ? undefined : value))
      if (process.env.PRINT_GOLDEN) console.log(`GOLDEN '${label}': '${digest}',`)
      else assert.equal(digest, GOLDEN[label], `${label} differs from the pre-change result`)
    }

    const lists = {
      name: { branchId: '1' }, all_branches: {}, name_page3: { branchId: '1', page: '3' }, name_desc_b2: { sortBy: 'name', sortDirection: 'desc', branchId: '2' },
      price: { sortBy: 'price', sortDirection: 'desc', branchId: '1' }, cost_p2: { sortBy: 'cost', branchId: '1', page: '2' }, received: { sortBy: 'received_date', sortDirection: 'desc' },
      qty_sold: { sortBy: 'qty_sold', sortDirection: 'desc', branchId: '1' }, search: { query: 'serum', branchId: '1' }, brand: { brand: 'Brand3,Brand5', category: 'Cat1', branchId: '1' },
      grouped: { groupState: 'grouped', branchId: '1' }, dates: { startDate: '2026-03-01', endDate: '2026-05-31', branchId: '1' }, initial: { initial: 'P', page: '2', pageSize: '50' },
      stock: { sortBy: 'stock', branchId: '1' }, stock_desc: { sortBy: 'stock', sortDirection: 'desc' }, low: { stockState: 'low_stock', branchId: '1' },
      out: { stockState: 'out_of_stock' }, in_b2: { stockState: 'in_stock', branchId: '2', page: '2' }, low_price: { stockState: 'low_stock', sortBy: 'price' },
    }
    const listRows = {}
    for (const [label, query] of Object.entries(lists)) {
      const result = await call('list', { query, customers: label === 'qty_sold' })
      assert.equal(result.out.error, undefined, `${label}: ${result.out.error}`)
      pinned(`list:${label}`, result.out)
      listRows[label] = result
    }
    const counter = (await call('list', { query: { branchId: '1', sortBy: 'qty_sold' } }, actors.counter)).out
    pinned('list:counter', counter)
    const expiries = label => new Set(listRows[label].out.items.filter(item => item.checkable).map(item => item.next_expiry_date))
    assert.ok(expiries('name').has('2027-06-01') && [...expiries('name')].every(value => value === null || value === '2027-06-01'), 'branch 1 rows report the branch 1 lot expiry')
    assert.ok(expiries('name_desc_b2').has('2027-07-01') && [...expiries('name_desc_b2')].every(value => value === null || value === '2027-07-01'), 'branch 2 rows report the branch 2 lot expiry')
    assert.ok(expiries('all_branches').has('2027-07-01') && expiries('all_branches').has('2027-06-01'), 'with no branch the earliest lot of any branch counts')
    assert.ok(counter.items.every(item => !Object.hasOwn(item, 'next_expiry_date')), 'a counter who cannot see stock gets no expiry (a dated lot with stock would show stock exists)')
    if (process.env.PRINT_GOLDEN) console.log('STATS', JSON.stringify(listRows.name.out.stats))
    else assert.deepEqual(listRows.name.out.stats, STATS, 'summary cards')
    console.log('PASS page rows, totals, facets, rankings and summary equal the pre-change result for every sort and filter')

    // One snapshot batch: schema probe, empty stock probe, family count, page, summary; then the issue read.
    const ranking = result => result.log[2].rows + result.log[3].rows
    const small = await call('list', { query: { branchId: '1', pageSize: '10' } }), large = await call('list', { query: { branchId: '1', pageSize: '100' } })
    const byStock = ranking(listRows.stock), byName = ranking(listRows.name)
    console.log(`MEASURE list P=${P}: name=${listRows.name.rows} stock-sort=${listRows.stock.rows}; count+page name=${byName} stock=${byStock}; page10=${ranking(small)} page100=${ranking(large)}`)
    assert.ok(byName * 2 < byStock, 'count and page statements for a name sort must not read every product\'s stock')
    assert.ok(ranking(large) - ranking(small) < 90 * 100, 'page stock grows with page size, not with the catalog')

    const one = await call('stock', { scope: { branchId: 1, productIds: [1103] } })
    console.log(`MEASURE one-product stock read rows=${one.rows}`)
    assert.ok(one.rows < 100, `one product's stock read ${one.rows} rows`)

    const ids = [1103, 1104, 1106, 1107, 1108, 1109, 1112, 1113, 1114, 1116, 1117, 1118]
    const created = await call('create', { body: { branchId: 1, requestId: 'cost-create-0001', productIds: ids, title: 'Cost' } })
    assert.equal(created.out.error, undefined, String(created.out.error))
    const sessionId = created.out.item.id, revision = created.out.item.revision
    const detail = await call('get', { id: sessionId })
    const known = detail.out.items.filter(item => item.current_quantity != null)
    const patch = (product, body, requestId) => call('patch', { id: sessionId, productId: product, body: { requestId, expectedSessionRevision: revision, ...body } })
    const first = await patch(known[0].product_id, { state: 'done', counted_quantity: known[0].current_quantity, expectedRevision: 0 }, 'cost-done-00001')
    const clear = await patch(known[0].product_id, { state: 'unstarted', expectedRevision: 1 }, 'cost-clear-0001')
    const issue = await patch(known[1].product_id, { state: 'issue', counted_quantity: 1, reason: 'Missing', expectedRevision: 0 }, 'cost-issue-0001')
    const done = await patch(known[2].product_id, { state: 'done', counted_quantity: known[2].current_quantity, expectedRevision: 0 }, 'cost-done-00002')
    const history = await call('history', { id: sessionId })
    for (const step of [first, clear, issue, done, history]) assert.equal(step.out.error, undefined, String(step.out.error))
    assert.equal(done.out.item.state, 'done')
    console.log(`MEASURE count P=${P}: create=${created.rows} get=${detail.rows} done(first)=${first.rows} clear=${clear.rows} issue=${issue.rows} done=${done.rows} history=${history.rows}`)
    assert.ok(clear.rows < 500 && issue.rows < 500, 'counting one item reads fewer than 500 rows')
    assert.ok(done.rows < 1500, 'a Done count reads its one product plus the in-transaction physical-schema guard')

    // The read memo never hides maintenance or an epoch change, and a stale write signature is refused in the transaction.
    const permitted = sql => db.batch(["INSERT INTO system_flags(key,value) VALUES('stock_transaction_permit','legacy-separate-pool-v1')", sql,
      "DELETE FROM system_flags WHERE key='stock_transaction_permit'"].map(text => db.prepare(text)))
    await permitted("INSERT INTO system_flags(key,value) VALUES('maintenance','test')")
    assert.equal((await call('stock', { scope: { productIds: [1103] } })).out.error, 'inventory_check_stock_schema_unavailable')
    await permitted("DELETE FROM system_flags WHERE key='maintenance'")
    await db.prepare("UPDATE system_flags SET value='future-v2' WHERE key='stock_schema_epoch'").run()
    assert.equal((await call('stock', { scope: { productIds: [1103] } })).out.error, 'inventory_check_stock_schema_unavailable')
    await db.prepare("UPDATE system_flags SET value='legacy-separate-pool-v1' WHERE key='stock_schema_epoch'").run()
    await db.prepare('ALTER TABLE damaged_stock_lots ADD COLUMN cost_test_marker INTEGER').run()
    const stale = await patch(known[3].product_id, { state: 'done', counted_quantity: known[3].current_quantity, expectedRevision: 0 }, 'cost-done-00003')
    assert.equal(stale.out.error, 'inventory_check_conflict', 'the in-transaction guard refuses a changed physical schema')
    const fresh = await patch(known[3].product_id, { state: 'done', counted_quantity: known[3].current_quantity, expectedRevision: 0 }, 'cost-done-00004')
    assert.equal(fresh.out.error, 'inventory_check_stock_schema_unavailable', 'a fresh structure read refuses the changed schema')
    console.log('PASS memo keeps maintenance, epoch and in-transaction physical-schema refusals')
  } finally { await mf.dispose() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
