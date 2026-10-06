// RET-A verify R2 L1 (6 Oct 2026): a fully paid sale reopened to Not Paid by
// the payment-correction route keeps its recorded payment; a return on it then
// lowers nothing (nothing is owed) and the sale lands in Partial return with
// status_before_return = Not Paid, owing $0. It is NOT credit anywhere: not in
// the report kernel's Not Paid cohort or Credit, not in the shift / Telegram
// credit (they read the kernel totals), not in the customer drill, not in the
// cashier view's paid count, not in the Sales page's own credit predicate.
//
// Driven through the REAL routes (PATCH /api/sales/:id/status, POST
// /api/returns, GET /api/sales) on workerd + D1 with every migration; the
// report figures are the real kernel functions in the same Worker.
//
// Transition table pinned here (stock delta 0 in every row of this lane):
//   Completed $20, paid $20 --reopen--> Not Paid, paid $20, owes 0
//   Not Paid, owes 0 --return $10--> Partial return (before: Not Paid),
//                                    debt lowered 0, cash $10 out, owes 0
// Positive control in the same run: a return-status sale recorded before 0234
// (cash only, nothing lowered, nothing paid) still owes its $20 and IS credit.
//
// Discriminating: on 161ba951e (reportAwaiting "no debt lowered => credit",
// its SQL twin in the customer drill and the cashier view, isCreditSale) the
// reopened sale counts as Not Paid credit: pending 1 sale, customer drill
// collected 0, cashier paid count 1 instead of 2.
// Run: node scripts/test-return-reopened-paid-sale-credit-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')

const root = path.resolve(__dirname, '..')
const front = require(path.join(root, '..', 'frontend', 'src', 'utils', 'statsFormulas.ts'))

async function kernels() {
  const bundle = await build({ stdin: { contents: `export * from './src/lib/saleItemPricing'`, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022' })
  const mod = { exports: {} }
  new Function('module', 'exports', bundle.outputFiles[0].text)(mod, mod.exports)
  return mod.exports
}

async function workerBundle() {
  return build({ stdin: { contents: `import { Hono } from 'hono'
      import sales from './src/routes/sales'
      import returns from './src/routes/returns'
      import { getSalesTotals, getCustomerSalesTotals, getSalesGroupedTotals } from './src/lib/salesAnalytics'
      import { composeShiftFigures } from './src/lib/shiftReconciliation'
      const app=new Hono()
      app.route('/api/sales',sales); app.route('/api/returns',returns)
      app.get('/k/totals',async c=>c.json(await getSalesTotals(c.env,{})))
      app.get('/k/customer',async c=>c.json(await getCustomerSalesTotals(c.env,{customerId:9})))
      app.get('/k/cashier',async c=>c.json(await getSalesGroupedTotals(c.env,{},'cashier')))
      app.get('/k/shift',async c=>{const totals=await getSalesTotals(c.env,{});return c.json(composeShiftFigures({opening:null,
        additionalCash:null,counted:null,totals,expenses:null,deliveryFees:null,courier:null}))})
      export default app;`, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
  plugins: [{ name: 'ret-a-l1-fixtures', setup(b) {
    const fixtures = {
      auth: `export const requireAuth=async(c,next)=>{c.set('user',{id:7,username:'admin',name:'Fixture Admin',role_code:'admin',permissions:JSON.stringify({all:true})});return next()}`,
      audit: 'export const audit=async()=>{};export const buildAuditStatement=()=>({sql:"SELECT 1",params:{}});export const changedFields=()=>null;export const auditChangeColumns=()=>({old_value:null,new_value:null});export const isSecretShapedAuditKey=()=>false',
      cache: `export const bumpVersion=async()=>{};export const bumpVersions=async()=>{};export const getVersionWithFallback=async()=>0;
        export const cachedJsonResponse=async(...args)=>args[args.length-1]()`,
      broadcastHub: 'export const broadcast=async()=>{}',
      telegram: `export const sendReturnTelegramEvent=async()=>{};export const sendReturnStatusTelegramEvents=async()=>{};export const sendTelegramEvent=async()=>{};
        export const sendSaleTelegramEvent=async()=>{};export const formatSaleTelegramLines=()=>[];export const formatSaleStatusTelegramLines=()=>[];
        export const telegramMoney=()=>''`,
    }
    b.onResolve({ filter: /(?:lib\/(?:auth|audit|cache|telegram)|durable-objects\/broadcastHub)$/ }, args => ({
      path: args.path.split('/').pop(), namespace: 'ret-a-fixture',
    }))
    b.onLoad({ filter: /.*/, namespace: 'ret-a-fixture' }, args => ({ contents: fixtures[args.path], loader: 'ts' }))
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
    const pool = { version: 1, pool_key: 'l1-pool', evaluation_time: '2026-09-13T00:00:00.000Z', exchange_rate: 4000, rules: [],
      lines: [{ line_key: 'l1-line', source: 'selling', product: { id: 1, selling_price_usd: 10, selling_price_khr: 40000,
        wholesale_price_usd: null, discount_enabled: false, discount_amount_usd: 0, discount_amount_khr: 0, discount_percent: 0 },
      selling_price_input_usd: null, manual: { type: 'none', value: 0 } }] }
    const allocation = { version: 1, lines: [{ line_key: 'l1-line', amount: 20 }], discount_usd: 0, membership_discount_usd: 0, tax_usd: 0 }
    const pricing = kernel.materializeCapturedPricingRow({ id: 1, product_id: 1 }, pool, { 'l1-line': 2 }, 'l1-line', allocation)
    const v1Sale = (id, status, paid, before = null) => [
      db.prepare(`INSERT INTO sales(id,receipt_number,branch_id,branch_name,exchange_rate,subtotal_usd,discount_usd,membership_discount_usd,
        tax_usd,calculated_total_usd,rounding_adjustment_usd,total_usd,amount_paid_usd,amount_paid_khr,money_precision_version,sale_status,
        status_before_return,payment_method,payment_details,cashier_id,cashier_name,customer_id,customer_name)
        VALUES(?,?,1,'Shop',4000,20,0,0,0,20,0,20,?,0,1,?,?,'Cash',?,7,'admin',9,'Dara')`).bind(id, `L1-${id}`, paid, status, before,
        paid > 0 ? JSON.stringify([{ method: 'Cash', amount_usd: paid, amount_khr: 0 }]) : null),
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
      db.prepare("INSERT INTO roles(id,code,name,permissions) VALUES(1,'admin','Admin','{\"all\":true}')"),
      db.prepare("INSERT INTO users(id,username,name,password,role_id,permissions,is_active) VALUES(7,'admin','Fixture Admin','x',1,'{\"all\":true}',1)"),
      db.prepare("INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1)"),
      db.prepare("INSERT INTO customers(id,name) VALUES(9,'Dara')"),
      db.prepare("INSERT INTO settings(key,value,updated_at) VALUES('exchange_rate','4000','seed')"),
      db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('pos_payment_methods','["Cash","ABA"]','seed')`),
      db.prepare("INSERT INTO products(id,name,is_active,stock_quantity) VALUES(1,'Widget',1,0)"),
      db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,0)'),
      db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number) VALUES(500,1,'l1-lot','L1-LOT','2026-09-01',1,1)"),
      db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(500,1,0)'),
      ...v1Sale(2, 'completed', 20),
      // Positive control: sold Not Paid, nothing paid, a $10 cash return
      // recorded before 0234 (no debt lowered): still owes its whole $20.
      ...v1Sale(3, 'partial_return', 0, 'awaiting_payment'),
      db.prepare(`INSERT INTO returns(id,return_number,sale_id,branch_id,cashier_id,return_scope,reason,total_refund_usd,total_refund_khr,
        exchange_rate,status,owed_reduction_usd,refund_currency) VALUES(30,'L1-R3',3,1,7,'customer','pre-0234',10,40000,4000,'completed',0,NULL)`),
      db.prepare('UPDATE sale_items SET returned_quantity=1 WHERE id=3'),
    ])
    const headers = { 'content-type': 'application/json' }
    const call = async (url, body, method = 'POST') => {
      const response = await mf.dispatchFetch(`http://local${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
      const text = await response.text()
      let parsed; try { parsed = JSON.parse(text) } catch { parsed = { raw: text.slice(0, 400) } }
      return { status: response.status, body: parsed }
    }
    const one = async (sql) => db.prepare(sql).first()

    // -- 1. reopen the paid sale for a payment correction --------------------
    const reopened = await call('/api/sales/2/status', { sale_status: 'awaiting_payment', client_request_id: 'l1-reopen-2',
      expected_updated_at: (await one('SELECT updated_at FROM sales WHERE id=2')).updated_at, expected_exchange_rate: 4000 }, 'PATCH')
    assert.equal(reopened.status, 200, `the payment-correction reopen was refused: ${JSON.stringify(reopened.body)}`)
    assert.deepEqual({ ...(await one('SELECT sale_status,amount_paid_usd FROM sales WHERE id=2')) },
      { sale_status: 'awaiting_payment', amount_paid_usd: 20 }, 'the reopen keeps the recorded payment')

    // -- 2. return one unit: nothing is owed, so nothing is lowered -----------
    const quote = await call('/api/returns/quote', { sale_id: 2, items: [{ sale_item_id: 2, quantity: 1 }] })
    assert.equal(quote.status, 200, JSON.stringify(quote.body))
    const { customer_return_create_version: _c, customer_return_edit_version: _e, ...expected } = quote.body
    const created = await call('/api/returns', { client_request_id: 'l1-return-2', money_precision_version: 1, sale_id: 2, reason: 'L1',
      expected_quote: expected, items: [{ sale_item_id: 2, product_id: 1, quantity: 1, stock_action: 'restock', branch_id: 1 }] })
    assert.equal(created.status, 200, JSON.stringify(created.body))
    assert.deepEqual({ ...(await one('SELECT sale_status,status_before_return FROM sales WHERE id=2')) },
      { sale_status: 'partial_return', status_before_return: 'awaiting_payment' },
      'PRECONDITION (the L1 shape): a return status with Not Paid before it')
    assert.equal((await one('SELECT owed_reduction_usd AS o FROM returns WHERE sale_id=2')).o, 0, 'PRECONDITION: the return lowered nothing')
    console.log('PASS a paid sale reopened to Not Paid and then returned lands in Partial return, owing $0, nothing lowered')

    // -- 3. every Credit and every Not Paid cohort leaves it out --------------
    const totals = (await call('/k/totals', undefined, 'GET')).body
    assert.equal(totals.pending_tx_count, 1, 'only the control sale is Not Paid (the reopened sale owes $0)')
    assert.equal(totals.pending_owed_usd, 20, 'the Credit is the control sale\'s $20 alone')
    const shift = (await call('/k/shift', undefined, 'GET')).body
    assert.equal(shift.credit_usd, 20, 'the shift (and Telegram) credit leaves the reopened sale out')
    const customer = (await call('/k/customer', undefined, 'GET')).body
    assert.equal(customer.credit_usd, 20, 'the customer drill Credit is what Dara still owes')
    assert.equal(customer.collected_usd, 20, 'the customer drill collects the reopened sale on its recorded payable basis')
    const cashier = (await call('/k/cashier', undefined, 'GET')).body
    assert.equal(cashier.length, 1)
    assert.equal(cashier[0].paid_tx_count, 1, 'the cashier view counts the reopened sale as paid (and the control as not)')
    assert.equal(cashier[0].pending_tx_count, 1)
    const listed = await call('/api/sales', undefined, 'GET')
    assert.equal(listed.status, 200, JSON.stringify(listed.body).slice(0, 300))
    const rows = Object.fromEntries(listed.body.map((row) => [Number(row.id), row]))
    assert.equal(front.isCreditSale(rows[2]), false, 'the Sales page predicate agrees: the reopened, returned sale is not credit')
    assert.equal(front.isCreditSale(rows[3]), true, 'CONTROL: the pre-0234 return-status sale that owes $20 is credit')
    assert.equal(front.saleListCreditUsd([rows[2], rows[3]]), 20, 'the Sales page fallback Credit matches the kernel')
    console.log('PASS the reopened sale owes $0 and is out of every Credit; the owing control stays in')
  } finally {
    await mf.dispose()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
