// NOTIF-V2: a return EXCHANGE hands the customer a replacement SALE, so the units it takes can carry a family into
// low / out of stock and must record exactly one stock_alert_events row (owner rule: a sale moves stock). A plain return
// that only restocks records none, and a replacement that leaves the family healthy records none.
//
// Native workerd/Miniflare D1 over the full migrated schema and the real Hono returns route; only authentication and
// the external notifications are fixtures (the same harness shape as test-customer-return-create-d1-native.cjs).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')

const root = path.resolve(__dirname, '..')

async function unusedPricingKernel() {
  const bundle = await build({ stdin: { contents: "export * from './src/lib/saleItemPricing'", resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022' })
  const mod = { exports: {} }
  new Function('module', 'exports', bundle.outputFiles[0].text)(mod, mod.exports)
  return mod.exports
}

async function workerBundle() {
  return build({ stdin: { contents: `import { Hono } from 'hono'; import returns from './src/routes/returns';
      const app=new Hono(); app.route('/api/returns',returns); export default app;`, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
    plugins: [{ name: 'return-native-fixtures', setup(b) {
      const fixtures = {
        auth: `export const requireAuth=async(c,next)=>{const raw=c.req.header('x-test-permissions');
          if(!raw)return c.json({error:'Unauthorized'},401);c.set('user',{id:7,username:'fixture',name:'Fixture',permissions:raw});return next()}`,
        audit: 'export const audit=async()=>{};export const changedFields=()=>null;export const auditChangeColumns=()=>({old_value:null,new_value:null});export const isSecretShapedAuditKey=()=>false',
        cache: 'export const bumpVersion=async()=>{};export const bumpVersions=async()=>{};',
        broadcastHub: 'export const broadcast=async()=>{}',
        telegram: `export const sendReturnTelegramEvent=async()=>{};export const sendReturnStatusTelegramEvents=async()=>{};export const sendTelegramEvent=async()=>{};export const sendPendingStockAlerts=async()=>0;
          export const formatSaleTelegramLines=()=>[];export const formatSaleStatusTelegramLines=()=>[]`,
      }
      b.onResolve({ filter: /(?:lib\/(?:auth|audit|cache|telegram)|durable-objects\/broadcastHub)$/ }, args => ({
        path: args.path.split('/').pop(), namespace: 'return-fixture',
      }))
      b.onLoad({ filter: /.*/, namespace: 'return-fixture' }, args => ({ contents: fixtures[args.path], loader: 'ts' }))
    } }],
  })
}

async function migrate(db) {
  const dir = path.join(root, 'migrations')
  for (const name of fs.readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) {
    const statements = split(fs.readFileSync(path.join(dir, name), 'utf8'))
    for (const statement of statements) {
      // Same exemption as the sibling native tests: 0098's empty alias seed exceeds this fixture's compound-SELECT cap.
      if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(statement.trim())) continue
      try { await db.prepare(statement).run() } catch (error) {
        error.message = `${name}: ${error.message}`
        throw error
      }
    }
  }
}

async function main() {
  const bundle = await workerBundle()
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, d1Databases: ['DB'],
    compatibilityDate: '2026-08-01', log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    await migrate(db)
    await db.batch([
      db.prepare("INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1)"),
      // Product 1 is the one returned (restocked). Product 2 is a replacement with 7 on hand and a low threshold of 5;
      // product 3 is a replacement with plenty of stock.
      db.prepare("INSERT INTO products(id,name,is_active,stock_quantity,low_stock_threshold,out_of_stock_threshold) VALUES(1,'Native Widget',1,0,5,0)"),
      db.prepare("INSERT INTO products(id,name,is_active,stock_quantity,low_stock_threshold,out_of_stock_threshold,selling_price_usd,selling_price_khr) VALUES(2,'Swap Balm',1,7,5,0,5,20000)"),
      db.prepare("INSERT INTO products(id,name,is_active,stock_quantity,low_stock_threshold,out_of_stock_threshold,selling_price_usd,selling_price_khr) VALUES(3,'Plenty Soap',1,60,5,0,2,8000)"),
      db.prepare("INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,0)"),
      db.prepare("INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,7)"),
      db.prepare("INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(3,1,60)"),
      db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number) VALUES(500,1,'native-lot','NATIVE-LOT','2026-09-01',1,1)"),
      db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number) VALUES(502,2,'swap-lot','SWAP-LOT','2026-09-01',1,1)"),
      db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number) VALUES(503,3,'soap-lot','SOAP-LOT','2026-09-01',1,1)"),
      db.prepare("INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(500,1,0)"),
      db.prepare("INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(502,1,7)"),
      db.prepare("INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(503,1,60)"),
      db.prepare(`INSERT INTO sales(id,receipt_number,branch_id,branch_name,exchange_rate,subtotal_usd,total_usd,money_precision_version,sale_status)
        VALUES(1,'NATIVE-SALE',1,'Shop',4000,30,30,0,'completed')`),
      db.prepare(`INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,batch_id,cost_price_usd,total_usd,applied_price_usd,applied_price_khr)
        VALUES(1,1,1,'Native Widget',3,1,500,7,30,10,40000)`),
      db.prepare("INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity,released_quantity) VALUES(1,500,1,1,0)"),
    ])
    const headers = { 'content-type': 'application/json', 'x-test-permissions': JSON.stringify({ all: true }) }
    const fetchJson = async (pathName, body) => {
      const response = await mf.dispatchFetch(`http://local/api/returns${pathName}`, { method: 'POST', headers, body: JSON.stringify(body) })
      const text = await response.text()
      let parsed
      try { parsed = JSON.parse(text) } catch { throw new Error(`${pathName} returned ${response.status}: ${text}`) }
      return { response, body: parsed }
    }
    const events = async () => (await db.prepare('SELECT alert_state, quantity_after, product_name, sale_id FROM stock_alert_events ORDER BY id').all()).results
    const stock = async (productId) => Number((await db.prepare('SELECT stock_quantity AS n FROM products WHERE id = ?').bind(productId).first()).n)
    // Money-precision v1 refuses replacement items, so an exchange is a legacy-body return on a pre-v1 sale.
    const returnBody = async (key, replacement) => ({
      sale_id: 1, reason: 'Native exchange', client_request_id: key,
      items: [{ sale_item_id: 1, product_id: 1, quantity: 1, stock_action: 'restock', branch_id: 1, applied_price_usd: 10, applied_price_khr: 40000 }],
      ...(replacement ? { replacement_items: replacement } : {}),
    })

    // 1. a replacement that leaves its family healthy (60 -> 58) records nothing.
    const healthy = await fetchJson('', await returnBody('exchange-healthy', [{ product_id: 3, quantity: 2, branch_id: 1, batch_id: 503 }]))
    assert.equal(healthy.response.status, 200, JSON.stringify(healthy.body))
    assert.equal(await stock(3), 58, 'the replacement really left the shelf')
    assert.deepEqual(await events(), [], 'a replacement that keeps the family healthy records no crossing')

    // 2. a replacement that takes Swap Balm 7 -> 4 (<= its threshold of 5) records exactly ONE low crossing,
    //    naming the replacement sale.
    const crossingBody = await returnBody('exchange-crossing', [{ product_id: 2, quantity: 3, branch_id: 1, batch_id: 502 }])
    const crossing = await fetchJson('', crossingBody)
    assert.equal(crossing.response.status, 200, JSON.stringify(crossing.body))
    assert.equal(await stock(2), 4)
    const written = await events()
    assert.equal(written.length, 1, JSON.stringify(written))
    assert.deepEqual([written[0].alert_state, written[0].quantity_after, written[0].product_name], ['low', 4, 'Swap Balm'])
    const replacementSale = await db.prepare("SELECT id FROM sales WHERE client_request_id LIKE 'return-replacement:%' ORDER BY id DESC LIMIT 1").first()
    assert.equal(written[0].sale_id, replacementSale.id, 'the event names the replacement sale, not the original')

    // 3. the exact retry (a lost acknowledgement) answers from the receipt: no second crossing, no second take.
    const retry = await fetchJson('', crossingBody)
    assert.equal(retry.response.status, 200, JSON.stringify(retry.body))
    assert.equal((await events()).length, 1, 'a retry never records a second crossing')
    assert.equal(await stock(2), 4, 'nor takes the stock twice')

    // 4. a plain return (restock only, no replacement) records no crossing, even though it moves stock.
    const plain = await fetchJson('', await returnBody('plain-return'))
    assert.equal(plain.response.status, 200, JSON.stringify(plain.body))
    assert.equal((await events()).length, 1, 'a plain restock return records no crossing')

    console.log('PASS native return exchange: a replacement that crosses records exactly one event on the replacement sale; healthy, retried and plain returns record none')
  } finally {
    await mf.dispose()
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
