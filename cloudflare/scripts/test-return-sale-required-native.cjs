// RET-A F6 (owner decision 5 Oct 2026, LH-10) through the real POST/PATCH
// /api/returns on workerd + D1 with every migration: every customer return is
// linked to a sale. A return without sale_id is refused with return_sale_required
// and writes nothing; the items of an old manual return can no longer be changed
// (manual_return_items_locked). Supplier returns are a separate route.
//
// Discriminating: on 489311c2f the manual return is recorded (50 units, $100 each).
// Run: node scripts/test-return-sale-required-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')

const root = path.resolve(__dirname, '..')

async function workerBundle() {
  return build({ stdin: { contents: `import { Hono } from 'hono'
      import returns from './src/routes/returns'
      const app=new Hono(); app.route('/api/returns',returns)
      export default app;`, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
  plugins: [{ name: 'ret-a-f6-fixtures', setup(b) {
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
  const bundle = await workerBundle()
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, d1Databases: ['DB'],
    compatibilityDate: '2026-08-01', log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    await migrate(db)
    // Sale 1 (Shop): line 1 = 3 Serum from lot 601; line 2 = 1 Toner, no lot;
    // line 3 = 1 Serum sold from Warehouse. Lot 602 is Serum the sale never drew.
    await db.batch([
      "INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1)",
      "INSERT INTO branches(id,name,is_active,is_default) VALUES(2,'Warehouse',1,0)",
      "INSERT INTO branches(id,name,is_active,is_default) VALUES(3,'Old Kiosk',0,0)",
      'INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,3,0)',
      "INSERT INTO products(id,name,is_active,stock_quantity,cost_price_usd,selling_price_usd) VALUES(1,'Serum',1,0,2,10)",
      "INSERT INTO products(id,name,is_active,stock_quantity,cost_price_usd,selling_price_usd) VALUES(2,'Toner',1,0,1,5)",
      'INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,0)',
      'INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,2,0)',
      'INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,0)',
      "INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,received_quantity) VALUES(601,1,'L601','L601','2026-09-01',1,3)",
      "INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,received_quantity) VALUES(602,1,'L602','L602','2026-09-02',1,5)",
      'INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(601,1,0)',
      'INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(602,1,0)',
      `INSERT INTO sales(id,receipt_number,branch_id,branch_name,exchange_rate,subtotal_usd,total_usd,sale_status,amount_paid_usd)
        VALUES(1,'S-1',1,'Shop',4000,45,45,'completed',45)`,
      `INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,applied_price_usd,total_usd,cost_price_usd,batch_id)
        VALUES(1,1,1,'Serum',3,1,10,30,2,601)`,
      `INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,applied_price_usd,total_usd,cost_price_usd,batch_id)
        VALUES(2,1,2,'Toner',1,1,5,5,1,NULL)`,
      `INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,applied_price_usd,total_usd,cost_price_usd,batch_id)
        VALUES(3,1,1,'Serum',1,2,10,10,2,NULL)`,
      'INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity,released_quantity) VALUES(1,601,1,3,0)',
      // A manual return recorded before F6 (no sale).
      `INSERT INTO returns(id,return_number,sale_id,branch_id,branch_name,return_scope,reason,total_refund_usd,total_refund_khr,exchange_rate,status)
        VALUES(90,'RET-OLD',NULL,1,'Shop','customer','old manual',10,40000,4000,'completed')`,
      `INSERT INTO return_items(id,return_id,product_id,product_name,quantity,applied_price_usd,applied_price_khr,total_usd,total_khr,return_to_stock,stock_action,branch_id)
        VALUES(90,90,2,'Toner',1,10,40000,10,40000,0,'none',1)`,
    ].map(sql => db.prepare(sql)))

    const headers = { 'content-type': 'application/json' }
    const send = async (method, url, body) => {
      const response = await mf.dispatchFetch(`http://local${url}`, { method, headers, body: JSON.stringify(body) })
      const text = await response.text()
      let parsed; try { parsed = JSON.parse(text) } catch { parsed = { raw: text.slice(0, 300) } }
      return { status: response.status, body: parsed }
    }
    const one = async (sql, ...binds) => db.prepare(sql).bind(...binds).first()
    const count = async () => Number((await one('SELECT COUNT(*) n FROM returns')).n)
    const stock = async (product, branch) => Number((await one('SELECT quantity q FROM branch_stock WHERE product_id=? AND branch_id=?', product, branch)).q)
    const lot = async (batch) => Number((await one('SELECT quantity q FROM branch_batch_stock WHERE batch_id=? AND branch_id=1', batch)).q)
    const updatedAt = async (id) => (await one('SELECT updated_at FROM returns WHERE id=?', id)).updated_at

    // -- F6: no sale, no return ---------------------------------------------------
    const before = await count()
    const manual = await send('POST', '/api/returns', { client_request_id: 'f6-manual', reason: 'walk-in', items: [
      { product_id: 2, quantity: 50, applied_price_usd: 100, applied_price_khr: 400000, stock_action: 'restock', branch_id: 1 }] })
    assert.equal(manual.status, 400, JSON.stringify(manual.body))
    assert.equal(manual.body.code, 'return_sale_required')
    assert.equal(await count(), before, 'nothing was written')
    assert.equal(await stock(2, 1), 0, 'no stock came back for an unlinked return')
    const manualEdit = await send('PATCH', '/api/returns/90', { client_request_id: 'f6-old-edit', expected_updated_at: await updatedAt(90),
      items: [{ product_id: 2, quantity: 40, applied_price_usd: 100, applied_price_khr: 400000, stock_action: 'restock', branch_id: 1 }] })
    assert.equal(manualEdit.status, 400, JSON.stringify(manualEdit.body))
    assert.equal(manualEdit.body.code, 'manual_return_items_locked')
    assert.equal(Number((await one('SELECT quantity q FROM return_items WHERE return_id=90')).q), 1, 'the old manual return is unchanged')
    console.log('PASS a return without a sale is refused and an old manual return\'s items cannot be changed')

    // -- N1 (loophole review 6 Oct): every create shape refuses, nothing written --
    const footprint = async () => JSON.stringify(await db.prepare(`SELECT
      (SELECT COUNT(*) FROM returns) r, (SELECT COUNT(*) FROM return_items) ri,
      (SELECT COALESCE(SUM(quantity),0) FROM branch_stock) bs,
      (SELECT COALESCE(SUM(quantity),0) FROM branch_batch_stock) bbs`).first())
    const fixed = await footprint()
    const abuse = { reason: 'walk-in', branch_id: 3, items: [
      { product_id: 2, quantity: 100, applied_price_usd: 50, applied_price_khr: 200000, stock_action: 'restock', branch_id: 3 }] }
    for (const [label, saleId] of [['absent', undefined], ['zero', 0], ['negative', -5], ['fraction', 1.5], ['text', 'abc'], ['null', null]]) {
      const refused = await send('POST', '/api/returns', { ...abuse, client_request_id: `n1-v0-${label}`, sale_id: saleId })
      assert.equal(refused.status, 400, `${label}: ${JSON.stringify(refused.body)}`)
      assert.equal(refused.body.code, 'return_sale_required', label)
      const refusedV1 = await send('POST', '/api/returns', { client_request_id: `n1-v1-${label}`, money_precision_version: 1, sale_id: saleId,
        reason: 'walk-in', items: [{ sale_item_id: 2, quantity: 1, stock_action: 'restock' }],
        expected_quote: { sale_id: saleId, items: [{ sale_item_id: 2, quantity: 1 }] } })
      assert.equal(refusedV1.status, 400, `v1 ${label}: ${JSON.stringify(refusedV1.body)}`)
      assert.equal(refusedV1.body.code, 'return_sale_required', `v1 ${label}`)
    }
    const ghost = await send('POST', '/api/returns', { ...abuse, client_request_id: 'n1-ghost', sale_id: 999 })
    assert.equal(ghost.status, 400, JSON.stringify(ghost.body))
    assert.equal(ghost.body.code, 'return_sale_not_found')
    assert.equal(await footprint(), fixed, 'no return, line or stock row was written by any refused shape')
    console.log('PASS N1: absent, zero, negative, fractional, text, null and unknown sale ids are refused (v0 and v1) with a code and write nothing')

    // The same abusive body WITH a valid sale: the sale decides branch and price.
    const linked = await send('POST', '/api/returns', { ...abuse, client_request_id: 'n1-linked', sale_id: 1,
      items: [{ ...abuse.items[0], sale_item_id: 2, quantity: 1 }] })
    assert.ok(linked.status >= 200 && linked.status < 300, JSON.stringify(linked.body))
    const row = await one("SELECT id,branch_id,total_refund_usd FROM returns WHERE client_request_id='n1-linked'")
    assert.equal(Number(row.branch_id), 1, 'the return belongs to the sale\'s branch, not the body\'s inactive branch')
    assert.equal(Number(row.total_refund_usd), 5, 'the refund is the sale line\'s price ($5), not the posted $50')
    assert.equal(await stock(2, 1), 1, 'the unit went back to the branch it was sold from')
    assert.equal(await stock(2, 3), 0, 'nothing landed in the inactive branch the body named')
    console.log('PASS N1: with a valid sale the same body records 1 unit at $5 into the sale\'s branch')

  } finally {
    await mf.dispose()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
