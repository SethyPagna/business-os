// Native workerd/D1, real mounted Hono route, permission kernel and SQL.
// Only session authentication is a fixture; no production calls or writes.
const assert = require('node:assert/strict')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare } = require('miniflare')

async function main() {
  const bundle = await build({
    stdin: { contents: `import { Hono } from 'hono'; import batches from './src/routes/batches';
      const app = new Hono(); app.route('/api/batches', batches); export default app;`,
      resolveDir: path.join(__dirname, '..'), loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    plugins: [{ name: 'fixture-auth', setup(b) {
      b.onResolve({ filter: /lib\/auth$/ }, () => ({ path: 'auth', namespace: 'fixture' }))
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
        export const requireAuth = async (c,next) => {
          const permissions = c.req.header('x-test-permissions');
          if (!permissions) return c.json({error:'Unauthorized'},401);
          c.set('user',{id:7,username:'fixture',permissions}); return next();
        };`, loader: 'ts' }))
    } }],
  })
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, d1Databases: ['DB'], compatibilityDate: '2026-08-01' })
  try {
    const db = await mf.getD1Database('DB')
    // Include sensitive fields and an inactive-positive legacy lot so that
    // serialization and remainder tests cannot pass on an empty fixture.
    await db.batch([
      db.prepare(`CREATE TABLE product_batches(id INTEGER PRIMARY KEY,variant_product_id INTEGER,lot_code TEXT,received_at TEXT,expiry_date TEXT,is_active INTEGER,batch_number INTEGER,notes TEXT,supplier_id INTEGER,supplier_name TEXT,updated_at TEXT,unit_cost_usd REAL,payment_status TEXT)`),
      db.prepare(`CREATE TABLE branch_batch_stock(batch_id INTEGER,branch_id INTEGER,quantity REAL)`),
      db.prepare(`INSERT INTO product_batches VALUES
        (56957,3263,'ADJ09/02/2026','2026-09-02T15:30:00.000Z',NULL,1,1,'secret-note',91,'secret-supplier','secret-update',77,'credit'),
        (56958,3263,'ZERO','2026-09-03',NULL,1,2,'secret-note',91,'secret-supplier','secret-update',77,'credit'),
        (56959,3263,'INACTIVE','2026-09-04',NULL,0,3,'secret-note',91,'secret-supplier','secret-update',77,'credit'),
        (60000,9999,'OTHER','2026-09-04',NULL,1,1,'secret-note',91,'secret-supplier','secret-update',77,'credit')`),
      db.prepare(`INSERT INTO branch_batch_stock VALUES (56957,2,3),(56958,2,0),(56959,2,4),(56957,3,8),(60000,2,90)`),
    ])
    const endpoint = '/api/batches/picker-lots?productId=3263&branchId=2'
    const request = (permissions, pathname = endpoint, method = 'GET') => mf.dispatchFetch(`http://local${pathname}`, {
      method, headers: permissions == null ? {} : { 'x-test-permissions': JSON.stringify(permissions) },
    })
    const allow = [
      { pos: true }, { sales: true }, { returns: true, products: true },
      { returns: 'review', products: true }, { all: true },
    ]
    for (const permissions of allow) {
      const res = await request(permissions)
      assert.equal(res.status, 200, JSON.stringify(permissions))
      assert.equal(res.headers.get('cache-control'), 'private, no-store')
      const body = await res.json()
      assert.deepEqual(Object.keys(body).sort(), ['batches', 'known_positive_quantity'])
      assert.equal(body.known_positive_quantity, 7)
      assert.deepEqual(body.batches.map(row => row.id), [56957, 56958])
      assert.deepEqual(body.batches.map(row => row.quantity), [3, 0])
      for (const row of body.batches) assert.deepEqual(Object.keys(row).sort(), ['batch_number','expiry_date','id','is_active','lot_code','quantity','received_at'])
      assert.equal((await request(permissions, endpoint, 'HEAD')).status, 200)
    }
    const deny = [{}, { products: true }, { contacts: true }, { inventory: true },
      { returns: 'view', products: true }, { returns: true, 'returns:add': false, products: true },
      { returns: false, 'returns:add': true, products: true }, { sales: true, 'sales:view': false }]
    for (const permissions of deny) for (const method of ['GET','HEAD']) {
      assert.equal((await request(permissions, endpoint, method)).status, 403, `${method} ${JSON.stringify(permissions)}`)
    }
    for (const method of ['GET','HEAD']) assert.equal((await request(null, endpoint, method)).status, 401)
    for (const query of ['','?productId=0&branchId=2','?productId=-1&branchId=2','?productId=1.5&branchId=2','?productId=3263&branchId=all','?productId=9007199254740992&branchId=2']) {
      assert.equal((await request({pos:true}, `/api/batches/picker-lots${query}`)).status, 400, query)
    }
    const otherBranch = await (await request({pos:true}, '/api/batches/picker-lots?productId=3263&branchId=3')).json()
    assert.equal(otherBranch.known_positive_quantity, 8)
    assert.equal(otherBranch.batches[0].quantity, 8)
    const otherProduct = await (await request({pos:true}, '/api/batches/picker-lots?productId=9999&branchId=2')).json()
    assert.deepEqual(otherProduct.batches.map(row => row.id), [60000])
    for (const pathname of ['/api/batches?productId=3263&branchId=2','/api/batches/tracked-product-ids?branchId=2','/api/batches/damaged-lots?productId=3263&branchId=2']) {
      for (const method of ['GET','HEAD']) assert.equal((await request({returns:true,products:true}, pathname, method)).status, 403)
    }
    for (const method of ['POST','PUT','PATCH','DELETE']) assert.equal((await request({returns:true}, '/api/batches/picker-lots', method)).status, 403)
    const unchanged = await db.prepare('SELECT SUM(quantity) AS quantity FROM branch_batch_stock').first()
    assert.equal(unchanged.quantity, 105)
    console.log('PASS native picker-lots: mounted route, real permission kernel, GET/HEAD role parity, exact cost-free projection, scoped D1 reads, unchanged legacy gates and stock')
  } finally { await mf.dispose() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
