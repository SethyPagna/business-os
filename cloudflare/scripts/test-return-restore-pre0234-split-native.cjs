// RET-A verifier P3 (6 Oct 2026): restoring a return cancelled BEFORE 0234
// (no refund currency, no debt reduction: it was recorded as cash) on a sale
// that carries a debt goes through the same refund split POST /api/returns
// records with -- it lowers what is still owed first, only the rest is cash.
// Real returns router (POST /bulk) and the real undo/redo kernel the undo
// applier calls, on workerd + D1 with every migration.
//   Not Paid $10, $4 restored  -> $4 lowers the debt, drawer pays out $0, owes $6
//   $8 paid of $10, $4 restored -> $2 lowers the debt, $2 cash, owes $0
//   Completed control           -> untouched columns, $4 cash, as before
//   undo writes the pre-restore columns back (0 / NULL); redo the same split
// Discriminating: before this fix the restore left owed_reduction_usd 0 and
// refund_currency NULL, so the drawer paid out the full $4 on a Not Paid sale.
// Run: node scripts/test-return-restore-pre0234-split-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')

const root = path.resolve(__dirname, '..')

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
      import { replayReturnBulkAction } from './src/lib/returnBulkAction'
      import { shiftRefunds } from './src/lib/shiftReconciliation'
      const app=new Hono(); app.route('/api/returns',returns)
      app.post('/test/replay', async c => {
        const body=await c.req.json()
        const user={id:7,username:'fixture',name:'Fixture',permissions:JSON.stringify({all:true})}
        try { await replayReturnBulkAction(c.env,user,body.direction,body.history_id,body.generation,body.payload); return c.json({ok:true}) }
        catch (error) { return c.json({error:String(error && error.message || error)},409) }
      })
      app.get('/drawer',async c=>{
        const refunds=await shiftRefunds(c.env,{scope_mode:'per_account',user_id:7,branch_id:1,opened_at:'2020-01-01T00:00:00.000Z',closed_at:null},Date.now()+60000)
        return c.json({usd:Math.round(refunds.usd*100)/100})
      })
      export default app;`, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
  plugins: [{ name: 'restore-split-fixtures', setup(b) {
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
      path: args.path.split('/').pop(), namespace: 'restore-fixture',
    }))
    b.onLoad({ filter: /.*/, namespace: 'restore-fixture' }, args => ({ contents: fixtures[args.path], loader: 'ts' }))
  } }],
  })
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
    await db.batch([
      "INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1)",
      "INSERT INTO products(id,name,is_active,stock_quantity) VALUES(1,'Serum',1,0),(2,'Toner',1,0)",
      'INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,0),(2,1,0)',
    ].map(sql => db.prepare(sql)))
    // A $10 sale (Serum $4 + Toner $6) with a $4 Serum return written before
    // 0234 and later cancelled: the sale went back to its pre-return status.
    const seed = async (n, { status, paidUsd }) => {
      const saleId = 10 + n, returnId = 100 + n
      await db.batch([
        db.prepare(`INSERT INTO sales(id,receipt_number,branch_id,branch_name,exchange_rate,subtotal_usd,total_usd,amount_paid_usd,amount_paid_khr,
          money_precision_version,sale_status,status_before_return,payment_method) VALUES(?,?,1,'Shop',4000,10,10,?,0,0,?,?,'Cash')`)
          .bind(saleId, `R-${saleId}`, paidUsd, status, status),
        db.prepare(`INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,applied_price_usd,applied_price_khr,total_usd,total_khr)
          VALUES(?,?,1,'Serum',1,1,4,16000,4,16000)`).bind(saleId * 10 + 1, saleId),
        db.prepare(`INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,applied_price_usd,applied_price_khr,total_usd,total_khr)
          VALUES(?,?,2,'Toner',1,1,6,24000,6,24000)`).bind(saleId * 10 + 2, saleId),
        db.prepare(`INSERT INTO returns(id,return_number,sale_id,branch_id,branch_name,cashier_id,cashier_name,return_scope,reason,return_type,
          total_refund_usd,total_refund_khr,exchange_rate,status,created_at,refund_currency,owed_reduction_usd)
          VALUES(?,?,?,1,'Shop',7,'Fixture','customer','pre-0234','refund',4,16000,4000,'cancelled',?,NULL,0)`)
          .bind(returnId, `RET-${returnId}`, saleId, new Date(Date.now() - 3600000).toISOString()),
        db.prepare(`INSERT INTO return_items(return_id,sale_item_id,product_id,product_name,quantity,applied_price_usd,total_usd,return_to_stock,stock_action,branch_id)
          VALUES(?,?,1,'Serum',1,4,4,0,'none',1)`).bind(returnId, saleId * 10 + 1),
      ])
      return { saleId, returnId }
    }
    const notPaid = await seed(1, { status: 'awaiting_payment', paidUsd: 0 })
    const partPaid = await seed(2, { status: 'awaiting_payment', paidUsd: 8 })
    const paid = await seed(3, { status: 'completed', paidUsd: 10 })

    const headers = { 'content-type': 'application/json' }
    const call = async (url, body) => {
      const response = await mf.dispatchFetch(`http://local${url}`, { method: 'POST', headers, body: JSON.stringify(body) })
      const text = await response.text()
      let parsed; try { parsed = JSON.parse(text) } catch { parsed = { raw: text.slice(0, 400) } }
      return { status: response.status, body: parsed }
    }
    const restore = async (key, id) => {
      const row = await db.prepare('SELECT status,return_type,updated_at FROM returns WHERE id=?').bind(id).first()
      const result = await call('/api/returns/bulk', { client_request_id: key, field: 'status', source: 'cancelled', target: 'completed',
        items: [{ id, expected_status: String(row.status), expected_method: String(row.return_type || 'manual'), expected_updated_at: row.updated_at ?? null }] })
      assert.equal(result.status, 200, JSON.stringify(result.body))
      return result.body
    }
    const replay = async (historyId, direction, generation) => {
      const row = await db.prepare('SELECT undo_payload,redo_payload FROM action_history WHERE id=?').bind(historyId).first()
      const result = await call('/test/replay', { direction, history_id: historyId, generation,
        payload: JSON.parse(direction === 'undo' ? row.undo_payload : row.redo_payload) })
      assert.equal(result.status, 200, JSON.stringify(result.body))
    }
    const drawer = async () => (await (await mf.dispatchFetch('http://local/drawer')).json()).usd
    const money = async (id) => ({ ...(await db.prepare('SELECT status,owed_reduction_usd AS owed,refund_currency AS currency FROM returns WHERE id=?').bind(id).first()) })
    const owes = async (id) => kernel.recordedSaleOutstandingUsd(await db.prepare(`SELECT s.*,${kernel.returnOwedReductionSql('s')} FROM sales s WHERE s.id=?`).bind(id).first())
    const saleStatus = async (id) => (await db.prepare('SELECT sale_status FROM sales WHERE id=?').bind(id).first()).sale_status

    assert.equal(await drawer(), 0, 'nothing active yet')
    const first = await restore('restore-not-paid', notPaid.returnId)
    assert.deepEqual(await money(notPaid.returnId), { status: 'completed', owed: 4, currency: 'USD' }, 'the restore lowers the debt by the whole $4')
    assert.equal(await drawer(), 0, 'the drawer pays out nothing for a Not Paid sale')
    assert.equal(await owes(notPaid.saleId), 6, 'Not Paid owes $6')
    assert.equal(await saleStatus(notPaid.saleId), 'awaiting_payment', 'still owes, so still in Not Paid')
    console.log('PASS Not Paid: a restored pre-0234 return lowers the debt; the drawer pays out nothing')

    await replay(first.actionHistoryId, 'undo', 0)
    assert.deepEqual(await money(notPaid.returnId), { status: 'cancelled', owed: 0, currency: null }, 'undo writes the pre-restore columns back')
    assert.equal(await owes(notPaid.saleId), 10)
    assert.equal(await saleStatus(notPaid.saleId), 'awaiting_payment')
    await replay(first.actionHistoryId, 'redo', 1)
    assert.deepEqual(await money(notPaid.returnId), { status: 'completed', owed: 4, currency: 'USD' }, 'redo writes the same split')
    assert.equal(await owes(notPaid.saleId), 6)
    await replay(first.actionHistoryId, 'undo', 2)
    assert.deepEqual(await money(notPaid.returnId), { status: 'cancelled', owed: 0, currency: null }, 'a second undo reverses again, exactly')
    console.log('PASS undo and redo replay the split from the snapshot, without the client')

    await restore('restore-part-paid', partPaid.returnId)
    assert.deepEqual(await money(partPaid.returnId), { status: 'completed', owed: 2, currency: 'USD' }, '$8 paid of $10: $2 lowers the debt')
    assert.equal(await drawer(), 2, 'only the other $2 is cash out of the drawer')
    assert.equal(await owes(partPaid.saleId), 0)
    assert.equal(await saleStatus(partPaid.saleId), 'partial_return', 'debt cleared: the quantity status')
    console.log('PASS part paid: debt first, the rest is cash, the sale leaves Not Paid')

    await restore('restore-paid', paid.returnId)
    assert.deepEqual(await money(paid.returnId), { status: 'completed', owed: 0, currency: null }, 'a Completed sale keeps its pre-0234 columns')
    assert.equal(await drawer(), 6, 'and its $4 is cash, as before')
    console.log('PASS Completed control: restore unchanged, the refund is cash')
  } finally {
    await mf.dispose()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
