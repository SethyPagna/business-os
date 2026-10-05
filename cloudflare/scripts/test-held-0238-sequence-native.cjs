// RET-A verifier P4 (6 Oct 2026): the sequence the held 0238 backfill meets in
// production -- a Not Paid sale with a return written BEFORE 0234 (refund
// counted as cash, sale moved to its return status), then a return written by
// RET-A's code through the real POST /api/returns (debt lowered, sale back in
// Not Paid), THEN 0238 runs. Together the two returns clear the debt, so the
// sale must leave Not Paid for the status the create route would give it from
// its quantities: Returned when every line came back, Partial return when a
// line is still out. workerd + D1 with every chain migration, 0238 applied
// from ops/scripts/migration/held/ exactly as a release would split it.
//
// Discriminating: the first held 0238 left such a sale in Not Paid owing $0
// (it only moved a sale INTO Not Paid); a total-units mapping (sold vs back,
// not per line) reads sale C, whose Toner line is still a unit short, as
// Returned (a legacy return row naming a product not on the sale).
// Run: node scripts/test-held-0238-sequence-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')

const root = path.resolve(__dirname, '..')
const heldPath = path.join(root, '..', 'ops/scripts/migration/held/0238_return_owed_backfill.sql')

async function kernels() {
  const bundle = await build({ stdin: { contents: `export { recordedSaleOutstandingUsd } from './src/lib/saleStatusResolution'
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
      app.get('/drawer',async c=>{
        const refunds=await shiftRefunds(c.env,{scope_mode:'per_account',user_id:7,branch_id:1,opened_at:'2020-01-01T00:00:00.000Z',closed_at:null},Date.now()+60000)
        return c.json({usd:Math.round(refunds.usd*100)/100,khr:refunds.khr})
      })
      export default app;`, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
  plugins: [{ name: 'sequence-fixtures', setup(b) {
    const fixtures = {
      auth: `export const requireAuth=async(c,next)=>{c.set('user',{id:7,username:'fixture',name:'Fixture',role_code:'admin',permissions:JSON.stringify({all:true})});return next()}`,
      audit: 'export const audit=async()=>{};export const buildAuditStatement=()=>({sql:"SELECT 1",params:{}});export const changedFields=()=>null;export const auditChangeColumns=()=>({old_value:null,new_value:null});export const isSecretShapedAuditKey=()=>false',
      cache: `export const bumpVersion=async()=>{};export const bumpVersions=async()=>{};export const getVersionWithFallback=async()=>0;
        export const cachedJsonResponse=async(...args)=>args[args.length-1]()`,
      broadcastHub: 'export const broadcast=async()=>{}',
      telegram: `export const sendReturnTelegramEvent=async()=>{};export const sendReturnStatusTelegramEvents=async()=>{};export const sendTelegramEvent=async()=>{};
        export const sendSaleTelegramEvent=async()=>{};export const formatSaleTelegramLines=()=>[];export const formatSaleStatusTelegramLines=()=>[];
        export const telegramMoney=()=>''`,
    }
    b.onResolve({ filter: /(?:lib\/(?:auth|audit|cache|telegram)|durable-objects\/broadcastHub)$/ }, args => ({
      path: args.path.split('/').pop(), namespace: 'sequence-fixture',
    }))
    b.onLoad({ filter: /.*/, namespace: 'sequence-fixture' }, args => ({ contents: fixtures[args.path], loader: 'ts' }))
  } }],
  })
}

async function runFile(db, file) {
  for (const statement of split(fs.readFileSync(file, 'utf8'))) {
    try { await db.prepare(statement).run() } catch (error) { error.message = `${path.basename(file)}: ${error.message}`; throw error }
  }
}

async function main() {
  const [kernel, bundle] = await Promise.all([kernels(), workerBundle()])
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, d1Databases: ['DB'],
    compatibilityDate: '2026-08-01', log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    const dir = path.join(root, 'migrations')
    for (const name of fs.readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) {
      for (const statement of split(fs.readFileSync(path.join(dir, name), 'utf8'))) {
        if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(statement.trim())) continue
        try { await db.prepare(statement).run() } catch (error) { error.message = `${name}: ${error.message}`; throw error }
      }
    }
    const products = [[1, 'Serum'], [2, 'Toner'], [3, 'Mask']]
    await db.batch([
      "INSERT INTO settings(key,value) VALUES('pos_payment_methods','[\"Cash\",\"ABA\"]')",
      "INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1)",
      ...products.map(([id, name]) => `INSERT INTO products(id,name,is_active,stock_quantity,cost_price_usd,selling_price_usd,selling_price_khr) VALUES(${id},'${name}',1,0,1,1,4000)`),
      ...products.map(([id]) => `INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(${id},1,0)`),
    ].map(sql => db.prepare(sql)))
    // lines: [line id, product id, quantity, line total $, imported returned_quantity]
    const sale = (id, { paidUsd = 0, lines }) => db.batch([
      db.prepare(`INSERT INTO sales(id,receipt_number,branch_id,branch_name,exchange_rate,subtotal_usd,total_usd,amount_paid_usd,amount_paid_khr,
        money_precision_version,sale_status,payment_method,created_at) VALUES(?,?,1,'Shop',4000,10,10,?,0,0,'awaiting_payment','Cash','2026-09-20 03:00:00')`)
        .bind(id, `Q-${id}`, paidUsd),
      ...lines.map(([lineId, productId, quantity, totalUsd, imported = 0]) => db.prepare(`INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,
        applied_price_usd,applied_price_khr,total_usd,total_khr,cost_price_usd,returned_quantity) VALUES(?,?,?,?,?,1,?,?,?,?,1,?)`)
        .bind(lineId, id, productId, products[productId - 1][1], quantity, totalUsd / quantity, Math.round(totalUsd / quantity * 4000), totalUsd, Math.round(totalUsd * 4000), imported)),
    ])
    // What the pre-0234 create route wrote: the refund as cash (no owed reduction,
    // no currency) and the sale moved to its quantity status, Not Paid kept as
    // status_before_return.
    const pre0234Return = async (id, saleId, { lineId, productId, quantity, refundUsd, saleStatus }) => db.batch([
      db.prepare(`INSERT INTO returns(id,return_number,sale_id,branch_id,branch_name,cashier_id,cashier_name,return_scope,reason,total_refund_usd,total_refund_khr,
        exchange_rate,status,created_at,refund_currency,owed_reduction_usd) VALUES(?,?,?,1,'Shop',7,'Fixture','customer','pre-0234',?,?,4000,'completed',?,NULL,0)`)
        .bind(id, `RET-P-${id}`, saleId, refundUsd, Math.round(refundUsd * 4000), new Date(Date.now() - 3600000).toISOString()),
      db.prepare(`INSERT INTO return_items(return_id,sale_item_id,product_id,product_name,quantity,applied_price_usd,total_usd,return_to_stock,stock_action,branch_id)
        VALUES(?,?,?,'line',?,?,?,0,'none',1)`).bind(id, lineId, productId, quantity, refundUsd / quantity, refundUsd),
      db.prepare("UPDATE sales SET sale_status=?, status_before_return='awaiting_payment' WHERE id=?").bind(saleStatus, saleId),
    ])
    const headers = { 'content-type': 'application/json' }
    const post = async (body) => {
      const response = await mf.dispatchFetch('http://local/api/returns', { method: 'POST', headers, body: JSON.stringify(body) })
      const text = await response.text()
      let parsed; try { parsed = JSON.parse(text) } catch { parsed = { raw: text.slice(0, 400) } }
      return { status: response.status, body: parsed }
    }
    const drawer = async () => (await mf.dispatchFetch('http://local/drawer')).json()
    const owes = async (id) => kernel.recordedSaleOutstandingUsd(await db.prepare(`SELECT s.*,${kernel.returnOwedReductionSql('s')} FROM sales s WHERE s.id=?`).bind(id).first())
    const saleRow = (id) => db.prepare('SELECT sale_status, status_before_return FROM sales WHERE id=?').bind(id).first()

    // A: $10 Not Paid -- Serum $4 + Toner $6, one each. Serum came back before
    // 0234; Toner comes back through RET-A's route. Every line is back.
    await sale(1, { lines: [[11, 1, 1, 4], [12, 2, 1, 6]] })
    // B: $10, $3 paid -- Serum $4 + Toner $3 + Mask $3. Serum back before 0234,
    // Toner through the route; Mask is still out, and the $3 paid covers it.
    await sale(2, { paidUsd: 3, lines: [[21, 1, 1, 4], [22, 2, 1, 3], [23, 3, 1, 3]] })
    // C: $10, $3 paid -- Serum $4 (the sales import recorded it back) + Toner x2
    // $6. Two pre-0234 returns: a legacy row tied to no sale line that names a
    // product the sale never had (Mask x2, $4), and Toner x1 of 2 ($3); an edit
    // later put the sale back in Not Paid. The route refuses new returns on such
    // a history, so 0238 alone decides it: 4 units back of 3 sold, yet Toner is
    // still a unit short -- Partial return, by the route's own per-line rule.
    await sale(3, { paidUsd: 3, lines: [[31, 1, 1, 4, 1], [32, 2, 2, 6]] })
    // A's pre-0234 row is tied to no sale line either, but names Serum: the
    // route's same-product fallback counts it against the Serum line.
    await pre0234Return(901, 1, { lineId: null, productId: 1, quantity: 1, refundUsd: 4, saleStatus: 'partial_return' })
    await pre0234Return(902, 2, { lineId: 21, productId: 1, quantity: 1, refundUsd: 4, saleStatus: 'partial_return' })
    await pre0234Return(903, 3, { lineId: null, productId: 3, quantity: 2, refundUsd: 4, saleStatus: 'partial_return' })
    await pre0234Return(904, 3, { lineId: 32, productId: 2, quantity: 1, refundUsd: 3, saleStatus: 'awaiting_payment' })
    const drawerBefore = await drawer()
    assert.equal(drawerBefore.usd, 15, 'before: every pre-0234 refund was counted as cash out of the drawer')

    const routeReturn = async (n, saleId, lineId, productId, quantity) => {
      const result = await post({ client_request_id: `q-${n}`, sale_id: saleId, reason: 'sequence',
        items: [{ sale_item_id: lineId, product_id: productId, quantity, stock_action: 'restock', branch_id: 1 }] })
      assert.equal(result.status, 200, JSON.stringify(result.body))
      return db.prepare('SELECT owed_reduction_usd, total_refund_usd FROM returns WHERE client_request_id=?').bind(`q-${n}`).first()
    }
    const a = await routeReturn(1, 1, 12, 2, 1)
    const b = await routeReturn(2, 2, 22, 2, 1)
    assert.deepEqual([a.total_refund_usd, a.owed_reduction_usd], [6, 6], 'A: RET-A lowers the debt by the whole $6')
    assert.equal(b.owed_reduction_usd, 3, 'B: the $3 return lowers the $7 debt by $3')
    for (const id of [1, 2]) assert.equal((await saleRow(id)).sale_status, 'awaiting_payment', `sale ${id}: still owes before 0238, so RET-A put it back in Not Paid`)
    assert.deepEqual([await owes(1), await owes(2), await owes(3)], [4, 4, 7], 'before 0238 the pre-0234 refunds have not lowered anything yet')

    await runFile(db, heldPath)
    assert.deepEqual({ ...(await saleRow(1)) }, { sale_status: 'returned', status_before_return: 'awaiting_payment' },
      'A: debt cleared and every line back -> Returned, Not Paid kept as status_before_return')
    assert.equal(await owes(1), 0)
    assert.deepEqual({ ...(await saleRow(2)) }, { sale_status: 'partial_return', status_before_return: 'awaiting_payment' },
      'B: debt cleared with the Mask line still out -> Partial return')
    assert.equal(await owes(2), 0)
    assert.deepEqual({ ...(await saleRow(3)) }, { sale_status: 'partial_return', status_before_return: 'awaiting_payment' },
      'C: debt cleared, more units back than sold in total, but a Toner unit is still out -> Partial return (per line, not by total units)')
    assert.equal(await owes(3), 0)
    const drawerAfter = await drawer()
    assert.equal(drawerAfter.usd, 0, 'after 0238 no refund on a debt sale left the drawer: every pre-0234 dollar lowered debt')
    console.log('PASS pre-0234 return, then a RET-A return, then 0238: a cleared debt leaves Not Paid for the route\'s quantity status')

    // B, continued: the Mask line through the route (no debt left, so it is
    // cash) and the route itself names the quantity status; 0238 has nothing to do.
    const b2 = await routeReturn(4, 2, 23, 3, 1)
    assert.equal(b2.owed_reduction_usd, 0)
    assert.equal((await saleRow(2)).sale_status, 'returned', 'the route: every line back, debt cleared -> Returned')
    const snapshot = async () => JSON.stringify([(await db.prepare('SELECT id, sale_status, status_before_return FROM sales ORDER BY id').all()).results,
      (await db.prepare('SELECT id, owed_reduction_usd, refund_currency FROM returns ORDER BY id').all()).results,
      (await db.prepare('SELECT COUNT(*) AS n FROM return_owed_backfill_0238').first()).n])
    const once = await snapshot()
    await runFile(db, heldPath)
    assert.equal(await snapshot(), once, 'a second 0238 run changes no sale, no return, and records nothing')
    console.log('PASS the route and 0238 agree on the quantity status; a second run is a no-op')
  } finally {
    await mf.dispose()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
