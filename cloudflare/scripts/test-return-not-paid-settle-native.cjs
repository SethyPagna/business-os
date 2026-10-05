// RET-A F1 (owner rule 29 Sep 2026, re-confirmed 5 Oct): a return on a Not
// Paid sale LOWERS THE DEBT, no cash leaves the drawer, and the sale stays in
// the Not Paid list, settleable for the remaining amount. Driven through the
// REAL routes (POST /api/returns, GET + PATCH /api/sales, action-history undo
// and redo) on workerd + D1 with every migration.
//
// Transition table pinned here (stock delta is 0 in every row: each status
// holds quantity - returned):
//   Not Paid $20, paid $5  --return $10-->  Not Paid, owes $5, debt lowered $10, drawer 0
//   Not Paid, owes $5      --settle $5--->  partial_return (before return: completed), owes 0
//   same settle replayed (same client_request_id) -> stored answer, paid stays $10
//   undo settlement  -> Not Paid, paid $5, status_before_return back to NULL
//   redo settlement  -> partial_return / completed again
//   Completed $20 cash --return $10--> drawer -$10; --cancel sale--> drawer 0 (LH-4)
// Plus: a settlement snapshot written before status_before_return existed
// still replays (the compare tolerates the absent field), and a different
// status still conflicts.
//
// Discriminating: on 489311c2f the return marks the sale partial_return and
// the settle is refused; with the held lane alone (no settlement change) the
// settle is refused as short by the lowered debt.
// Run: node scripts/test-return-not-paid-settle-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')

const root = path.resolve(__dirname, '..')

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
      import actionHistory from './src/routes/actionHistory'
      import { shiftRefunds } from './src/lib/shiftReconciliation'
      import { samePrecisionCompatibleState } from './src/lib/saleSettlementAction'
      const app=new Hono()
      app.route('/api/sales',sales); app.route('/api/returns',returns); app.route('/api/action-history',actionHistory)
      app.get('/drawer',async c=>c.json(await shiftRefunds(c.env,{scope_mode:'per_account',user_id:7,branch_id:1,
        opened_at:'2020-01-01T00:00:00.000Z',closed_at:null},Date.now()+60000)))
      app.post('/compat',async c=>{const b=await c.req.json();return c.json({same:samePrecisionCompatibleState(b.current,b.expected)})})
      export default app;`, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
  plugins: [{ name: 'ret-a-settle-fixtures', setup(b) {
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
    const pool = { version: 1, pool_key: 'ra-pool', evaluation_time: '2026-09-13T00:00:00.000Z', exchange_rate: 4000, rules: [],
      lines: [{ line_key: 'ra-line', source: 'selling', product: { id: 1, selling_price_usd: 10, selling_price_khr: 40000,
        wholesale_price_usd: null, discount_enabled: false, discount_amount_usd: 0, discount_amount_khr: 0, discount_percent: 0 },
      selling_price_input_usd: null, manual: { type: 'none', value: 0 } }] }
    const allocation = { version: 1, lines: [{ line_key: 'ra-line', amount: 20 }], discount_usd: 0, membership_discount_usd: 0, tax_usd: 0 }
    const pricing = kernel.materializeCapturedPricingRow({ id: 1, product_id: 1 }, pool, { 'ra-line': 2 }, 'ra-line', allocation)
    const v1Sale = (id, status, paid, method) => [
      db.prepare(`INSERT INTO sales(id,receipt_number,branch_id,branch_name,exchange_rate,subtotal_usd,discount_usd,membership_discount_usd,
        tax_usd,calculated_total_usd,rounding_adjustment_usd,total_usd,amount_paid_usd,amount_paid_khr,money_precision_version,sale_status,
        payment_method,payment_details,cashier_id,cashier_name)
        VALUES(?,?,1,'Shop',4000,20,0,0,0,20,0,20,?,0,1,?,?,?,7,'admin')`).bind(id, `RA-${id}`, paid, status, method,
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
      db.prepare("INSERT INTO settings(key,value,updated_at) VALUES('exchange_rate','4000','seed')"),
      db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('pos_payment_methods','["Cash","ABA"]','seed')`),
      db.prepare("INSERT INTO products(id,name,is_active,stock_quantity) VALUES(1,'Widget',1,0)"),
      db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,0)'),
      db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number) VALUES(500,1,'ra-lot','RA-LOT','2026-09-01',1,1)"),
      db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(500,1,0)'),
      ...v1Sale(1, 'awaiting_payment', 5, 'Cash'),
      ...v1Sale(2, 'completed', 20, 'Cash'),
    ])
    const headers = { 'content-type': 'application/json' }
    const call = async (url, body, method = 'POST') => {
      const response = await mf.dispatchFetch(`http://local${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
      const text = await response.text()
      let parsed; try { parsed = JSON.parse(text) } catch { parsed = { raw: text.slice(0, 400) } }
      return { status: response.status, body: parsed }
    }
    const one = async (sql) => db.prepare(sql).first()
    const drawer = async () => (await call('/drawer', undefined, 'GET')).body
    const returnOne = async (saleId, id) => {
      const quote = await call('/api/returns/quote', { sale_id: saleId, items: [{ sale_item_id: saleId, quantity: 1 }] })
      assert.equal(quote.status, 200, JSON.stringify(quote.body))
      const { customer_return_create_version: _c, customer_return_edit_version: _e, ...expected } = quote.body
      return call('/api/returns', { client_request_id: id, money_precision_version: 1, sale_id: saleId, reason: 'RET-A', expected_quote: expected,
        items: [{ sale_item_id: saleId, product_id: 1, quantity: 1, stock_action: 'restock', branch_id: 1 }] })
    }

    // -- 1. the return lowers the debt; the sale stays Not Paid and listed --
    const created = await returnOne(1, 'ra-return-1')
    assert.equal(created.status, 200, JSON.stringify(created.body))
    let sale = await one('SELECT sale_status,status_before_return,amount_paid_usd FROM sales WHERE id=1')
    assert.deepEqual({ ...sale }, { sale_status: 'awaiting_payment', status_before_return: null, amount_paid_usd: 5 })
    assert.deepEqual(await drawer(), { usd: 0, khr: 0 }, 'no cash left the drawer for the debt-lowering return')
    const listed = await call('/api/sales?status=awaiting_payment', undefined, 'GET')
    assert.equal(listed.status, 200, JSON.stringify(listed.body).slice(0, 300))
    const row = listed.body.find(r => Number(r.id) === 1)
    assert.ok(row, 'the Not Paid list still shows the sale after its return')
    assert.equal(row.return_owed_reduction_usd, 10, 'the list row names the debt the return lowered (the tag reads it)')
    console.log('PASS a return on a Not Paid sale lowers the debt, keeps it in the Not Paid list and takes nothing from the drawer')

    // -- 2. settle the remaining $5 ------------------------------------------
    const settleBody = async (requestId) => ({
      sale_status: 'completed', client_request_id: requestId, expected_exchange_rate: 4000,
      expected_updated_at: (await one('SELECT updated_at FROM sales WHERE id=1')).updated_at,
      // The full snapshot: the $5 already recorded stays, the remaining $5 is added.
      payment_details: [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }, { method: 'Cash', amount_usd: 5, amount_khr: 0 }],
    })
    const settleRequest = await settleBody('ra-settle-1')
    const settled = await call('/api/sales/1/status', settleRequest, 'PATCH')
    assert.equal(settled.status, 200, `settling the remaining $5 was refused: ${JSON.stringify(settled.body)}`)
    assert.equal(settled.body.sale_status, 'partial_return', 'the answer names the status actually written')
    sale = await one('SELECT sale_status,status_before_return,amount_paid_usd FROM sales WHERE id=1')
    assert.deepEqual({ ...sale }, { sale_status: 'partial_return', status_before_return: 'completed', amount_paid_usd: 10 },
      'a paid sale with a return takes its return status and remembers the paid status it reached')
    console.log('PASS the sale settles for the remaining amount and lands on its return status')

    // -- 3. the same request again is the stored answer, never a second payment
    const replayed = await call('/api/sales/1/status', settleRequest, 'PATCH')
    assert.equal(replayed.status, 200, JSON.stringify(replayed.body))
    assert.equal((await one('SELECT amount_paid_usd AS p FROM sales WHERE id=1')).p, 10, 'a replayed settlement paid twice')
    assert.equal((await one("SELECT COUNT(*) AS n FROM sale_mutation_receipts WHERE sale_id=1 AND mutation_kind='settlement'")).n, 1)
    console.log('PASS a replayed settlement is applied once')

    // -- 4. undo and redo replay on the server -------------------------------
    const history = await one("SELECT id FROM action_history WHERE status='undoable' ORDER BY id DESC LIMIT 1")
    const undone = await call(`/api/action-history/${history.id}/undo`, { require_applied: true, expected_generation: 0 })
    assert.equal(undone.status, 200, JSON.stringify(undone.body))
    sale = await one('SELECT sale_status,status_before_return,amount_paid_usd FROM sales WHERE id=1')
    assert.deepEqual({ ...sale }, { sale_status: 'awaiting_payment', status_before_return: null, amount_paid_usd: 5 },
      'undo puts the sale back to Not Paid with its earlier payment and status_before_return')
    const redone = await call(`/api/action-history/${history.id}/redo`, { require_applied: true, expected_generation: 1 })
    assert.equal(redone.status, 200, JSON.stringify(redone.body))
    sale = await one('SELECT sale_status,status_before_return,amount_paid_usd FROM sales WHERE id=1')
    assert.deepEqual({ ...sale }, { sale_status: 'partial_return', status_before_return: 'completed', amount_paid_usd: 10 })
    console.log('PASS undo and redo of that settlement restore both statuses and the payment')

    // -- 5. old snapshots (no status_before_return) still compare ------------
    const state = { money_precision_version: 1, sale_status: 'completed', status_before_return: null, amount_paid_usd: 10 }
    const { status_before_return: _drop, ...legacy } = state
    assert.equal((await call('/compat', { current: state, expected: legacy })).body.same, true,
      'a snapshot written before status_before_return was recorded still replays')
    assert.equal((await call('/compat', { current: state, expected: { ...legacy, sale_status: 'awaiting_payment' } })).body.same, false,
      'any other difference still conflicts')
    assert.equal((await call('/compat', { current: state, expected: { ...state, status_before_return: 'completed' } })).body.same, false,
      'a recorded status_before_return still has to match')
    console.log('PASS settlement replay tolerates snapshots from before status_before_return, and nothing else')

    // -- 6. a refund on a sale later cancelled leaves the drawer with it (LH-4)
    const cashReturn = await returnOne(2, 'ra-return-2')
    assert.equal(cashReturn.status, 200, JSON.stringify(cashReturn.body))
    assert.deepEqual(await drawer(), { usd: 10, khr: 0 }, 'a Completed sale refunds its return in cash')
    const cancelled = await call('/api/sales/2/status', { sale_status: 'cancelled', cancel_reason: 'mistake', client_request_id: 'ra-cancel-2',
      expected_updated_at: (await one('SELECT updated_at FROM sales WHERE id=2')).updated_at }, 'PATCH')
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body))
    assert.deepEqual(await drawer(), { usd: 0, khr: 0 }, 'the cancelled sale took its refund out of the drawer total with its tender')
    console.log('PASS a refund on a cancelled sale is not subtracted from the drawer')
  } finally {
    await mf.dispose()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
