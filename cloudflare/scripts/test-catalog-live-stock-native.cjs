// Actual mounted product read routes + family pagination + native D1. Only
// authentication is a fixture; no cache, filter, stock or SQL implementation mocks.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare } = require('miniflare')

async function main() {
  const root = path.join(__dirname, '..')
  const bundle = await build({
    stdin: { contents: `import {Hono} from 'hono'; import products from './src/routes/products';
      const app=new Hono();app.route('/api/products',products);export default app;`, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    plugins: [{ name: 'fixture-auth', setup(b) {
      b.onResolve({ filter: /lib\/auth$/ }, () => ({ path: 'auth', namespace: 'fixture' }))
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const requireAuth=async(c,next)=>{
        c.set('user',{id:7,username:'fixture',permissions:JSON.stringify({all:true})});return next();};`, loader: 'ts' }))
    } }],
  })
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-08-01', d1Databases: ['DB'], kvNamespaces: ['CACHE'] })
  try {
    const db = await mf.getD1Database('DB')
    const schema = fs.readFileSync(path.join(root, 'migrations/0001_init.sql'), 'utf8')
    const tables = ['products', 'branches', 'branch_stock', 'product_images', 'product_batches', 'branch_batch_stock', 'settings']
    for (const table of tables) {
      const sql = schema.match(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\n\\);`))?.[0]
      assert.ok(sql, table)
      await db.prepare(sql).run()
    }
    await db.batch([
      db.prepare('ALTER TABLE products ADD COLUMN name_key TEXT'),
      db.prepare('ALTER TABLE products ADD COLUMN wholesale_price_usd REAL DEFAULT 0'),
      db.prepare('ALTER TABLE products ADD COLUMN wholesale_price_khr REAL DEFAULT 0'),
      db.prepare('ALTER TABLE products ADD COLUMN auto_merged_count INTEGER DEFAULT 0'),
      db.prepare('CREATE INDEX idx_products_name_key_pg ON products(name_key)'),
      db.prepare('CREATE UNIQUE INDEX idx_branch_stock_product_branch_unique ON branch_stock(product_id,branch_id)'),
      db.prepare('CREATE TABLE promotion_rules(id INTEGER PRIMARY KEY,is_active INTEGER)'),
      db.prepare("INSERT INTO branches(id,name,is_active,is_default) VALUES(2,'Shop',1,1),(3,'Warehouse',1,0),(4,'Inactive',0,0)"),
    ])
    // Stale high, stale low, near threshold, inactive-branch and missing-ledger fixtures.
    const fixtures = [
      [1, 8, 0, 0, 0], [2, 0, 3, 0, 0], [3, 100, 4, 0, 0],
      [4, 0, 12, 0, 0], [5, 0, 0, 0, 6], [6, 90, 2, 8, 0], [7, 8, null, null, null],
    ]
    for (const [id, cached, shop, warehouse, inactive] of fixtures) {
      await db.prepare('INSERT INTO products(id,name,name_key,stock_quantity,low_stock_threshold) VALUES(?,?,?,?,5)')
        .bind(id, `Item ${id}`, `item ${id}`, cached).run()
      for (const [branch, qty] of [[2,shop],[3,warehouse],[4,inactive]]) if (qty != null) {
        await db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)').bind(id,branch,qty).run()
      }
    }
    let reads = 0
    async function read(endpoint, query = '') {
      const response = await mf.dispatchFetch(`http://local/api/products/${endpoint}?pageSize=100&metadata=0&nonce=${++reads}&${query}`)
      const body = await response.json()
      assert.equal(response.status, 200, JSON.stringify(body))
      return body
    }
    const cases = [
      ['out', [1,7], [1,5,7]], ['in_stock', [2,3,4,5,6], [2,3,4,6]],
      ['positive', [2,3,4,5,6], [2,3,4,6]], ['low', [2,3], [2,3,6]], ['healthy', [4,5,6], [4]],
    ]
    for (const endpoint of ['search','bootstrap']) for (const [state, all, shop] of cases) {
      for (const [branchQuery, expected] of [['',all],['&branchId=2',shop]]) {
        const result = await read(endpoint, `stockState=${state}${branchQuery}`)
        assert.deepEqual(result.items.map(row=>row.id).sort((a,b)=>a-b), expected, `${endpoint} ${state} ${branchQuery}`)
        assert.equal(result.total, expected.length)
      }
    }
    for (const endpoint of ['search','bootstrap']) {
      const result = await read(endpoint, 'ids=1,2,5,6,7')
      const totals = Object.fromEntries(result.items.map(row=>[row.id,row.stock_quantity]))
      assert.deepEqual(totals, {1:0,2:3,5:6,6:10,7:0})
      assert.deepEqual(result.items.find(row=>row.id===5).branch_stock.map(row=>row.branch_id), [2,3], 'display choices remain active-only while total remains all-branch')
      const scoped = await read(endpoint, 'ids=6&branchId=2')
      assert.equal(scoped.items[0].stock_quantity, 10, 'response total remains all-branch even with scoped filter')
    }
    // The all-branch predicate must use a product-key lookup, not scan the
    // entire lot/stock ledger per product or multiply pagination rows.
    const source = fs.readFileSync(path.join(root,'src/routes/products.ts'),'utf8')
    const expression = source.match(/'\(SELECT COALESCE\(SUM\(catalog_bs\.quantity\)[^\n]+?\)'/)?.[0].slice(1,-1)
    assert.ok(expression)
    const plan = await db.prepare(`EXPLAIN QUERY PLAN SELECT p.id FROM products p WHERE ${expression}>0`).all()
    assert.ok(plan.results.some(row=>/SEARCH catalog_bs USING INDEX idx_branch_stock_product_branch_unique \(product_id=\?\)/.test(row.detail)), JSON.stringify(plan.results))
    const cached = await db.prepare('SELECT stock_quantity FROM products WHERE id=1').first()
    assert.equal(cached.stock_quantity,8,'read correction never mutates persisted cache')
    console.log('PASS native catalog stock: actual search/bootstrap/by-ID, scoped/unscoped thresholds, stale high/low cache, inactive branch semantics, indexed plan and no writes')
  } finally { await mf.dispose() }
}
main().catch(error=>{console.error(error);process.exitCode=1})
