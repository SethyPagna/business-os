// Native workerd/Miniflare D1 boundary for customer-return v1 CREATE.
// Mounts the real Hono route and permission/db kernels against the complete
// migrated schema. Only authentication and external notifications are fixtures.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')

const root = path.resolve(__dirname, '..')

async function pricingKernel() {
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
        telegram: `export const sendReturnTelegramEvent=async()=>{};export const sendTelegramEvent=async()=>{};
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
      // The fixture has no users while migrations run, so 0098's alias seed is
      // observably a no-op. Miniflare's test D1 has a lower compound-SELECT
      // term cap than the deployed migration runner; install its schema/indexes
      // but omit only that empty-data seed statement.
      if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(statement.trim())) continue
      try { await db.prepare(statement).run() } catch (error) {
        error.message = `${name}: ${error.message}`
        throw error
      }
    }
  }
}

async function main(grants = {}) {
  const [kernel, bundle] = await Promise.all([pricingKernel(), workerBundle()])
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, d1Databases: ['DB'],
    compatibilityDate: '2026-08-01', log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    await migrate(db)
    const pool = { version: 1, pool_key: 'native-return-pool', evaluation_time: '2026-09-13T00:00:00.000Z',
      exchange_rate: 4000, rules: [], lines: [{ line_key: 'native-return-line', source: 'selling',
        product: { id: 1, selling_price_usd: 10, selling_price_khr: 40000, wholesale_price_usd: null,
          discount_enabled: false, discount_amount_usd: 0, discount_amount_khr: 0, discount_percent: 0 },
        selling_price_input_usd: null, manual: { type: 'none', value: 0 } }] }
    const allocation = { version: 1, lines: [{ line_key: 'native-return-line', amount: 10 }],
      discount_usd: 1, membership_discount_usd: 0, tax_usd: 0.5 }
    const pricing = kernel.materializeCapturedPricingRow({ id: 1, product_id: 1 }, pool,
      { 'native-return-line': 1 }, 'native-return-line', allocation)
    await db.batch([
      db.prepare("INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1)"),
      db.prepare("INSERT INTO products(id,name,is_active,stock_quantity) VALUES(1,'Native Widget',1,0)"),
      db.prepare("INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,0)"),
      db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number) VALUES(500,1,'native-lot','NATIVE-LOT','2026-09-01',1,1)"),
      db.prepare("INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(500,1,0)"),
      db.prepare(`INSERT INTO sales(id,receipt_number,branch_id,branch_name,exchange_rate,subtotal_usd,discount_usd,
        membership_discount_usd,tax_usd,calculated_total_usd,rounding_adjustment_usd,total_usd,money_precision_version,sale_status)
        VALUES(1,'NATIVE-SALE',1,'Shop',4000,10,1,0,.5,9.5,0,9.5,1,'completed')`),
      db.prepare(`INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,batch_id,cost_price_usd,cost_price_khr,
        total_usd,total_khr,base_price_usd,base_price_khr,applied_price_usd,applied_price_khr,
        product_discount_usd,product_discount_khr,product_discount_type,product_discount_label,
        manual_discount_usd,manual_discount_khr,manual_discount_type,manual_discount_value,price_mode,pricing_snapshot_json)
        VALUES(1,1,1,'Native Widget',1,1,500,7,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
          pricing.total_usd, pricing.total_khr, pricing.base_price_usd, pricing.base_price_khr,
          pricing.applied_price_usd, pricing.applied_price_khr, pricing.product_discount_usd, pricing.product_discount_khr,
          pricing.product_discount_type, pricing.product_discount_label, pricing.manual_discount_usd, pricing.manual_discount_khr,
          pricing.manual_discount_type, pricing.manual_discount_value, pricing.price_mode, pricing.pricing_snapshot_json),
      db.prepare("INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity,released_quantity) VALUES(1,500,1,1,0)"),
    ])

    const headers = { 'content-type': 'application/json', 'x-test-permissions': JSON.stringify({ returns: true, ...grants }) }
    const fetchJson = async (pathName, body) => {
      const response = await mf.dispatchFetch(`http://local/api/returns${pathName}`, { method: 'POST', headers, body: JSON.stringify(body) })
      const text = await response.text()
      let parsed
      try { parsed = JSON.parse(text) } catch { throw new Error(`${pathName} returned ${response.status}: ${text}`) }
      return { response, body: parsed }
    }
    const quoteResult = await fetchJson('/quote', { sale_id: 1, items: [{ sale_item_id: 1, quantity: 1 }] })
    assert.equal(quoteResult.response.status, 200, JSON.stringify(quoteResult.body))
    const { customer_return_create_version: _create, customer_return_edit_version: _edit, ...expectedQuote } = quoteResult.body
    const request = { client_request_id: 'native-v1-return', money_precision_version: 1, sale_id: 1,
      reason: 'Native D1 exact return', expected_quote: expectedQuote,
      items: [{ sale_item_id: 1, product_id: 1, quantity: 1, stock_action: 'restock', branch_id: 1 }] }
    if (!grants.product_cost_edit && !grants.all) {
      const forbiddenOverride = await fetchJson('', { ...request, items: [{ ...request.items[0], cost_price_usd: 999, cost_price_khr: 3996000 }] })
      assert.equal(forbiddenOverride.response.status, 403)
      assert.equal(forbiddenOverride.body.code, 'product_cost_edit_required')
      assert.equal((await db.prepare('SELECT COUNT(*) n FROM returns').first()).n, 0)
    }

    await db.prepare(`CREATE TRIGGER fail_native_return_movement BEFORE INSERT ON inventory_movements
      WHEN NEW.movement_type='return' BEGIN SELECT RAISE(ABORT,'native return movement failure'); END`).run()
    const failed = await fetchJson('', request)
    assert.notEqual(failed.response.status, 200)
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM returns').first()).n, 0)
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM return_create_receipts').first()).n, 0)
    assert.equal((await db.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').first()).quantity, 0)
    assert.equal((await db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=500 AND branch_id=1').first()).quantity, 0)
    await db.prepare('DROP TRIGGER fail_native_return_movement').run()

    // Treat the first successful response as a lost acknowledgement: verify
    // the exact frozen retry resolves from the immutable receipt without a
    // second return, movement, or stock change.
    const lostAcknowledgement = await mf.dispatchFetch('http://local/api/returns', {
      method: 'POST', headers, body: JSON.stringify(request),
    })
    assert.equal(lostAcknowledgement.status, 200)
    const retried = await fetchJson('', request)
    assert.equal(retried.response.status, 200, JSON.stringify(retried.body))
    if (!grants.all) assert.equal(JSON.stringify(retried.body).includes('cost_price_usd'), false)
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM returns').first()).n, 1)
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM return_create_receipts').first()).n, 1)
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE movement_type='return'").first()).n, 1)
    assert.equal((await db.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').first()).quantity, 1)
    assert.equal((await db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=500 AND branch_id=1').first()).quantity, 1)
    const item = await db.prepare('SELECT total_usd,total_khr,cost_price_usd,cost_price_khr,refund_snapshot_json FROM return_items').first()
    assert.deepEqual({ total_usd: item.total_usd, total_khr: item.total_khr,
      cost_price_usd: item.cost_price_usd, cost_price_khr: item.cost_price_khr },
    { total_usd: 9.5, total_khr: 38000, cost_price_usd: 7, cost_price_khr: null })
    assert.equal(JSON.parse(item.refund_snapshot_json).net_entitlement_usd, 9.5)
    console.log('PASS native workerd/D1 customer-return v1: 0158/0159/0160 schema, atomic failure rollback, exact snapshot, lost-ack retry and no double stock')
  } finally {
    await mf.dispose()
  }
}

;(async () => {
  await Promise.all([{}, { product_cost_edit: true }, { all: true }].map(async grants => {
    await main(grants)
    console.log('PASS ordinary omitted costs with grants:', JSON.stringify(grants))
  }))
})().catch(error => { console.error(error); process.exitCode = 1 })
