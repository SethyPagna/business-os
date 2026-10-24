// 6.0.970: the Inventory-check summary counted distinct buyers with a correlated subquery per cohort row
// (one scan of `buyers` per product: 2.87M rows per call on production). It is now one grouped join.
// Proves: the customer-count ordering equals an independent oracle (shared buyers, a buyer who bought a
// product in several sales, anonymous sales, cancelled sales, a product nobody bought), the unique buyer
// stat is unchanged, and the executed plans carry no correlated scan of the buyers CTE.
//
// Run: node scripts/test-inventory-check-customer-count-grouped.cjs
const assert = require('node:assert/strict')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { buildSync } = require('esbuild')
const { loadAll } = require('./harness/load_migrations.cjs')

const code = buildSync({ entryPoints: [path.join(__dirname, '../src/lib/inventoryCheckProducts.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, target: 'es2022', external: ['cloudflare:*'] }).outputFiles[0].text
const loaded = { exports: {} }
new Function('require', 'module', 'exports', code)(require, loaded, loaded.exports)
const api = loaded.exports
const admin = { id: 1, role_code: 'admin', role_permissions: { all: true } }
const lowStock = { enabled: true, mode: 'product', threshold: 10 }

const db = new DatabaseSync(':memory:')
for (const sql of loadAll({ through: 242 })) db.exec(sql)
db.exec("INSERT OR IGNORE INTO branches(id,name,is_active) VALUES(1,'Synthetic one',1)")
function product(id, name) {
  db.prepare('INSERT INTO products(id,name,stock_quantity) VALUES(?,?,5)').run(id, name)
  db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,5)').run(id)
  db.prepare('INSERT INTO product_batches(id,variant_product_id,batch_key,received_at) VALUES(?,?,?,?)').run(id, id, `k-${id}`, '2026-10-19')
  db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,5)').run(id)
}
db.exec("INSERT INTO customers(id,name) VALUES(1,'A'),(2,'B'),(3,'C'),(4,'D')")
let saleId = 0
function sale(customerId, productIds, status = 'completed') {
  saleId += 1
  db.prepare('INSERT INTO sales(id,receipt_number,customer_id,customer_name,created_at,sale_status,subtotal_usd,total_usd) VALUES(?,?,?,?,?,?,1,1)')
    .run(saleId, `cc-${saleId}`, customerId, 'x', '2026-10-19 03:00:00', status)
  for (const id of productIds) db.prepare('INSERT INTO sale_items(sale_id,product_id,branch_id,quantity,total_usd,total_khr,cost_price_usd,cost_price_khr) VALUES(?,?,1,1,1,0,0,0)').run(saleId, id)
}
// Product names sort opposite to buyer counts so name order cannot pass by accident.
product(1, 'Zed four buyers'); product(2, 'Yak two buyers'); product(3, 'Xan one buyer many sales'); product(4, 'Wen nobody'); product(5, 'Vex anonymous only'); product(6, 'Uma cancelled only')
sale(1, [1, 2]); sale(2, [1, 2]); sale(3, [1]); sale(4, [1])
sale(1, [3]); sale(1, [3]); sale(1, [3])           // one buyer, three sales -> 1
sale(null, [5]); sale(null, [5])                    // anonymous -> not a buyer
sale(2, [6], 'cancelled')                           // cancelled -> not counted

const oracle = new Map(db.prepare(`SELECT si.product_id AS id, COUNT(DISTINCT s.customer_id) AS n FROM sale_items si JOIN sales s ON s.id=si.sale_id
  WHERE COALESCE(s.sale_status,'completed')<>'cancelled' AND s.customer_id IS NOT NULL GROUP BY si.product_id`).all().map((row) => [Number(row.id), Number(row.n)]))
const names = new Map(db.prepare("SELECT id,name FROM products").all().map((row) => [Number(row.id), String(row.name)]))
const expectedDesc = [1, 2, 3, 4, 5, 6].sort((a, b) => (oracle.get(b) || 0) - (oracle.get(a) || 0) || names.get(a).localeCompare(names.get(b)))

const plans = []
const adapter = { async batch(statements) {
  db.exec('PRAGMA query_only=ON'); db.exec('BEGIN')
  try {
    return statements.map(({ sql, params = {} }) => {
      const prepared = db.prepare(sql); prepared.setAllowUnknownNamedParameters(true)
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`); plan.setAllowUnknownNamedParameters(true)
      plans.push(plan.all(params).map((row) => row.detail))
      return { success: true, results: prepared.all(params) }
    })
  } finally { db.exec('ROLLBACK'); db.exec('PRAGMA query_only=OFF') }
} }

;(async () => {
  assert.deepEqual(expectedDesc.slice(0, 3), [1, 2, 3], 'oracle sanity: 4, 2, 1 buyers')
  const read = (query) => api.readInventoryCheckProducts(adapter, admin, query, { lowStock, rankingLimit: 5, customerRanking: 'sale_count' })
  const desc = await read({ sortBy: 'customer_count', sortDirection: 'desc' })
  const ids = (result) => result.items.filter((row) => row.checkable).map((row) => row.id)
  assert.deepEqual(ids(desc).slice(0, 3), [1, 2, 3], 'most distinct buyers first')
  assert.deepEqual(ids(desc), expectedDesc.filter((id) => ids(desc).includes(id)))
  const asc = await read({ sortBy: 'customer_count', sortDirection: 'asc' })
  assert.deepEqual(ids(asc).slice(0, 3), [6, 5, 4], 'ascending starts with the zero-buyer products')
  assert.equal(desc.stats.unique_customer_count, 4, 'unique buyers across the cohort')
  assert.deepEqual(desc.rankings.customers.map((row) => [row.customer_id, row.sale_count]).sort((a, b) => a[0] - b[0]), db.prepare("SELECT s.customer_id AS c, COUNT(DISTINCT s.id) AS n FROM sales s JOIN sale_items si ON si.sale_id=s.id WHERE s.sale_status<>'cancelled' AND s.customer_id IS NOT NULL GROUP BY s.customer_id ORDER BY s.customer_id").all().map((row) => [Number(row.c), Number(row.n)]))
  assert.ok(plans.length > 0)
  assert.ok(!plans.flat().some((detail) => /CORRELATED/i.test(detail) && /buyers/i.test(detail)), 'no correlated scan of the buyers CTE')
  const source = require('node:fs').readFileSync(path.join(__dirname, '../src/lib/inventoryCheckProducts.ts'), 'utf8')
  assert.ok(!/SELECT COUNT\(DISTINCT customer_id\) FROM buyers buyer WHERE buyer\.product_id=c\.id/.test(source), 'per-row correlated count is gone')
  assert.match(source, /LEFT JOIN \(SELECT product_id,COUNT\(DISTINCT customer_id\) AS customer_count FROM buyers GROUP BY product_id\) bc ON bc\.product_id=c\.id/)
  console.log('PASS customer count ordering, unique buyers, ranking and plan')
})().catch((error) => { console.error(error); process.exitCode = 1 })
