// Owner rulings 29 Sep 2026 (SCAN2 U11) through the real POST /api/returns on
// workerd + D1 with every migration: a return on a Not Paid sale restocks as
// usual, lowers what the customer owes and leaves the drawer alone; only the
// part worth more than the debt is refunded in cash, in the currency chosen.
// A Completed sale refunds in cash as before.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')

const root = path.resolve(__dirname, '..')

async function kernels() {
  const bundle = await build({ stdin: { contents: `export * from './src/lib/saleItemPricing'
      export { recordedSaleOutstandingUsd } from './src/lib/saleStatusResolution'
      export { returnOwedReductionSql } from './src/lib/returnRefundSplit'`, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022' })
  const mod = { exports: {} }
  new Function('module', 'exports', bundle.outputFiles[0].text)(mod, mod.exports)
  return mod.exports
}

async function workerBundle() {
  return build({ stdin: { contents: `import { Hono } from 'hono'; import returns from './src/routes/returns'
      import { shiftRefunds } from './src/lib/shiftReconciliation'
      const app=new Hono(); app.route('/api/returns',returns)
      app.get('/drawer',async c=>c.json(await shiftRefunds(c.env,{scope_mode:'per_account',user_id:7,branch_id:1,
        opened_at:'2020-01-01T00:00:00.000Z',closed_at:null},Date.now()+60000)))
      export default app;`, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
  plugins: [{ name: 'return-native-fixtures', setup(b) {
    const fixtures = {
      auth: `export const requireAuth=async(c,next)=>{c.set('user',{id:7,username:'fixture',name:'Fixture',permissions:JSON.stringify({returns:true})});return next()}`,
      audit: 'export const audit=async()=>{};export const changedFields=()=>null;export const auditChangeColumns=()=>({old_value:null,new_value:null});export const isSecretShapedAuditKey=()=>false',
      cache: 'export const bumpVersion=async()=>{};export const bumpVersions=async()=>{};',
      broadcastHub: 'export const broadcast=async()=>{}',
      telegram: `export const sendReturnTelegramEvent=async()=>{};export const sendReturnStatusTelegramEvents=async()=>{};export const sendTelegramEvent=async()=>{};
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
    for (const statement of split(fs.readFileSync(path.join(dir, name), 'utf8'))) {
      if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(statement.trim())) continue
      try { await db.prepare(statement).run() } catch (error) { error.message = `${name}: ${error.message}`; throw error }
    }
  }
}

async function main() {
  const [kernel, bundle] = await Promise.all([kernels(), workerBundle()])
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, d1Databases: ['DB'],
    compatibilityDate: '2026-08-01', log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    await migrate(db)
    const pool = { version: 1, pool_key: 'np-pool', evaluation_time: '2026-09-13T00:00:00.000Z', exchange_rate: 4000, rules: [],
      lines: [{ line_key: 'np-line', source: 'selling', product: { id: 1, selling_price_usd: 10, selling_price_khr: 40000,
        wholesale_price_usd: null, discount_enabled: false, discount_amount_usd: 0, discount_amount_khr: 0, discount_percent: 0 },
      selling_price_input_usd: null, manual: { type: 'none', value: 0 } }] }
    const allocation = { version: 1, lines: [{ line_key: 'np-line', amount: 20 }], discount_usd: 0, membership_discount_usd: 0, tax_usd: 0 }
    const pricing = kernel.materializeCapturedPricingRow({ id: 1, product_id: 1 }, pool, { 'np-line': 2 }, 'np-line', allocation)
    const v1Sale = (id, status, paid) => [
      db.prepare(`INSERT INTO sales(id,receipt_number,branch_id,branch_name,exchange_rate,subtotal_usd,discount_usd,membership_discount_usd,
        tax_usd,calculated_total_usd,rounding_adjustment_usd,total_usd,amount_paid_usd,amount_paid_khr,money_precision_version,sale_status)
        VALUES(?,?,1,'Shop',4000,20,0,0,0,20,0,20,?,0,1,?)`).bind(id, `NP-${id}`, paid, status),
      db.prepare(`INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,batch_id,cost_price_usd,cost_price_khr,
        total_usd,total_khr,base_price_usd,base_price_khr,applied_price_usd,applied_price_khr,product_discount_usd,product_discount_khr,
        product_discount_type,product_discount_label,manual_discount_usd,manual_discount_khr,manual_discount_type,manual_discount_value,
        price_mode,pricing_snapshot_json) VALUES(?,?,1,'Widget',2,1,500,7,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        id, id, pricing.total_usd, pricing.total_khr, pricing.base_price_usd, pricing.base_price_khr, pricing.applied_price_usd,
        pricing.applied_price_khr, pricing.product_discount_usd, pricing.product_discount_khr, pricing.product_discount_type,
        pricing.product_discount_label, pricing.manual_discount_usd, pricing.manual_discount_khr, pricing.manual_discount_type,
        pricing.manual_discount_value, pricing.price_mode, pricing.pricing_snapshot_json),
      db.prepare('INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity,released_quantity) VALUES(?,500,1,2,0)').bind(id),
    ]
    await db.batch([
      db.prepare("INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1)"),
      db.prepare("INSERT INTO products(id,name,is_active,stock_quantity) VALUES(1,'Widget',1,0)"),
      db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,0)'),
      db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number) VALUES(500,1,'np-lot','NP-LOT','2026-09-01',1,1)"),
      db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(500,1,0)'),
      ...v1Sale(1, 'awaiting_payment', 5),
      ...v1Sale(2, 'completed', 20),
      db.prepare(`INSERT INTO sales(id,receipt_number,branch_id,branch_name,exchange_rate,subtotal_usd,total_usd,amount_paid_usd,
        amount_paid_khr,money_precision_version,sale_status) VALUES(3,'NP-3',1,'Shop',4000,20,20,0,0,0,'awaiting_payment')`),
      db.prepare(`INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,total_usd,total_khr,applied_price_usd,applied_price_khr)
        VALUES(3,3,1,'Widget',2,1,20,80000,10,40000)`),
    ])
    const headers = { 'content-type': 'application/json' }
    const post = async (pathName, body) => {
      const response = await mf.dispatchFetch(`http://local/api/returns${pathName}`, { method: 'POST', headers, body: JSON.stringify(body) })
      const text = await response.text()
      return { status: response.status, body: JSON.parse(text) }
    }
    const quote = async (saleId, split = '') => {
      const result = await post(`/quote${split}`, { sale_id: saleId, items: [{ sale_item_id: saleId, quantity: 1 }] })
      assert.equal(result.status, 200, JSON.stringify(result.body))
      const { customer_return_create_version: _c, customer_return_edit_version: _e, refund_split: refundSplit, ...expected } = result.body
      return { expected, refundSplit }
    }
    const createV1 = async (saleId, id, currency) => {
      const { expected } = await quote(saleId)
      return post('', { client_request_id: id, money_precision_version: 1, sale_id: saleId, reason: 'Not Paid return', expected_quote: expected,
        ...(currency ? { refund_currency: currency } : {}),
        items: [{ sale_item_id: saleId, product_id: 1, quantity: 1, stock_action: 'restock', branch_id: 1 }] })
    }
    const sale = (id) => db.prepare(`SELECT s.*,${kernel.returnOwedReductionSql('s')} FROM sales s WHERE s.id=?`).bind(id).first()
    const owed = async (id) => kernel.recordedSaleOutstandingUsd(await sale(id))

    const first = await createV1(1, 'np-first')
    assert.equal(first.status, 200, JSON.stringify(first.body))
    assert.equal((await sale(1)).sale_status, 'awaiting_payment', 'a Not Paid sale stays Not Paid after a partial return')
    assert.equal((await db.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').first()).quantity, 1,
      'the returned unit comes back into stock as usual')
    const firstRow = await db.prepare('SELECT total_refund_usd,owed_reduction_usd,refund_currency FROM returns WHERE client_request_id=?').bind('np-first').first()
    assert.deepEqual({ ...firstRow }, { total_refund_usd: 10, owed_reduction_usd: 10, refund_currency: 'USD' })
    assert.equal(await owed(1), 5, 'the return lowered what the customer owes from $15 to $5')
    assert.deepEqual(await (await mf.dispatchFetch('http://local/drawer')).json(), { usd: 0, khr: 0 }, 'no cash left the drawer')
    console.log('PASS a return on a Not Paid sale lowers the debt and takes nothing from the drawer')

    const { refundSplit } = await quote(1, '?split=1')
    assert.deepEqual(refundSplit, { owed_reduction_usd: 5, cash_refund_usd: 5 }, 'the quote names the split before the return is recorded')
    const second = await createV1(1, 'np-second', 'KHR')
    assert.equal(second.status, 200, JSON.stringify(second.body))
    const secondRow = await db.prepare('SELECT owed_reduction_usd,refund_currency FROM returns WHERE client_request_id=?').bind('np-second').first()
    assert.deepEqual({ ...secondRow }, { owed_reduction_usd: 5, refund_currency: 'KHR' })
    assert.equal((await sale(1)).sale_status, 'returned')
    assert.equal(await owed(1), 0)
    assert.deepEqual(await (await mf.dispatchFetch('http://local/drawer')).json(), { usd: 0, khr: 20000 },
      'the $5 the customer had paid went back in riel, from the riel drawer')
    console.log('PASS the part beyond the debt is refunded in cash, in the currency chosen')

    const control = await createV1(2, 'np-control')
    assert.equal(control.status, 200, JSON.stringify(control.body))
    const controlRow = await db.prepare('SELECT owed_reduction_usd,refund_currency FROM returns WHERE client_request_id=?').bind('np-control').first()
    assert.deepEqual({ ...controlRow }, { owed_reduction_usd: 0, refund_currency: 'USD' })
    assert.equal((await sale(2)).sale_status, 'partial_return')
    assert.deepEqual(await (await mf.dispatchFetch('http://local/drawer')).json(), { usd: 10, khr: 20000 })
    console.log('PASS a Completed sale still refunds the whole return in cash')

    const legacy = await post('', { client_request_id: 'np-legacy', sale_id: 3, reason: 'Not Paid legacy return',
      items: [{ sale_item_id: 3, product_id: 1, quantity: 1, applied_price_usd: 10, applied_price_khr: 40000, stock_action: 'restock', branch_id: 1 }] })
    assert.equal(legacy.status, 200, JSON.stringify(legacy.body))
    const legacyRow = await db.prepare('SELECT owed_reduction_usd FROM returns WHERE client_request_id=?').bind('np-legacy').first()
    assert.equal(legacyRow.owed_reduction_usd, 10)
    assert.equal((await sale(3)).sale_status, 'awaiting_payment')
    assert.equal(await owed(3), 10)
    assert.deepEqual(await (await mf.dispatchFetch('http://local/drawer')).json(), { usd: 10, khr: 20000 })
    console.log('PASS a legacy Not Paid sale follows the same rule')

    const invalid = await post('', { client_request_id: 'np-invalid', sale_id: 3, reason: 'bad currency', refund_currency: 'EUR',
      items: [{ sale_item_id: 3, product_id: 1, quantity: 1, stock_action: 'none', branch_id: 1 }] })
    assert.equal(invalid.status, 400)
    await assert.rejects(db.prepare("UPDATE returns SET refund_currency='EUR' WHERE client_request_id='np-legacy'").run(), /CHECK constraint failed/)
    await assert.rejects(db.prepare("UPDATE returns SET owed_reduction_usd=11 WHERE client_request_id='np-legacy'").run(), /CHECK constraint failed/)
    console.log('PASS the currency and the split are enforced by the route and by the schema')
  } finally {
    await mf.dispose()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
