// RET-A F11 (LH-11) through the real POST/PATCH /api/returns on workerd + D1
// with every migration: a return never trusts the client for WHERE stock goes
// back. Product and branch come from the sale line (a PATCH body naming another
// branch restocks the sale line's branch; another product on the line is
// refused), a line that is not on the sale is refused, a product sold from two
// branches must be named by its line, and a client lot is accepted only when the
// line was sold from it (return_lot_not_sold).
//
// Discriminating: on 489311c2f the foreign lot is restocked and the PATCH moves
// stock into branch 2.
// Run: node scripts/test-return-sale-line-identity-native.cjs
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
  plugins: [{ name: 'ret-a-f11-fixtures', setup(b) {
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

    // -- F11 on create: the lot must be one the line was sold from ---------------
    const foreignLot = await send('POST', '/api/returns', { client_request_id: 'f11-foreign-lot', sale_id: 1, reason: 'lot', items: [
      { sale_item_id: 1, product_id: 1, quantity: 1, stock_action: 'restock', branch_id: 1, batch_id: 602 }] })
    assert.equal(foreignLot.status, 400, JSON.stringify(foreignLot.body))
    assert.equal(foreignLot.body.code, 'return_lot_not_sold')
    assert.equal(await lot(602), 0, 'a lot the line never drew from is not restocked')
    const created = await send('POST', '/api/returns', { client_request_id: 'f11-create', sale_id: 1, reason: 'lot', items: [
      { sale_item_id: 1, product_id: 1, quantity: 1, stock_action: 'restock', branch_id: 2, batch_id: 601 }] })
    assert.equal(created.status, 200, JSON.stringify(created.body))
    assert.equal(await lot(601), 1, 'the sold lot takes the unit back')
    assert.deepEqual([await stock(1, 1), await stock(1, 2)], [1, 0], 'the sale line\'s branch, not the body\'s, gets the stock')
    console.log('PASS create restocks the sold lot at the sale line\'s branch and refuses a lot the line never drew')

    // -- F11 on edit: product, branch and line come from the sale ---------------
    const id = created.body.id
    const edit = async (key, items, extra = {}) => send('PATCH', `/api/returns/${id}`, { client_request_id: key, expected_updated_at: await updatedAt(id), items, ...extra })
    const mismatch = await edit('f11-mismatch', [{ sale_item_id: 1, product_id: 2, quantity: 1, stock_action: 'restock', branch_id: 1 }])
    assert.equal(mismatch.status, 400, JSON.stringify(mismatch.body))
    assert.equal(mismatch.body.code, 'return_line_product_mismatch')
    const notOnSale = await edit('f11-not-on-sale', [{ sale_item_id: 999, product_id: 1, quantity: 1, stock_action: 'restock', branch_id: 1 }])
    assert.equal(notOnSale.status, 400, JSON.stringify(notOnSale.body))
    const ambiguous = await edit('f11-ambiguous', [{ product_id: 1, quantity: 1, stock_action: 'restock' }])
    assert.equal(ambiguous.status, 400, JSON.stringify(ambiguous.body))
    assert.equal(ambiguous.body.code, 'return_sale_item_required', 'Serum was sold from two branches, so the line must be named')
    const editLot = await edit('f11-edit-lot', [{ sale_item_id: 1, product_id: 1, quantity: 1, stock_action: 'restock', branch_id: 1, batch_id: 602 }])
    assert.equal(editLot.status, 400, JSON.stringify(editLot.body))
    assert.equal(editLot.body.code, 'return_lot_not_sold')
    assert.deepEqual([await lot(601), await lot(602), await stock(1, 1), await stock(1, 2)], [1, 0, 1, 0], 'every refusal left stock untouched')
    const moved = await edit('f11-branch', [{ sale_item_id: 1, product_id: 1, quantity: 2, stock_action: 'restock', branch_id: 2 }], { branch_id: 2 })
    assert.equal(moved.status, 200, JSON.stringify(moved.body))
    assert.deepEqual([await stock(1, 1), await stock(1, 2)], [2, 0], 'a body naming Warehouse still restocks the sale line\'s Shop')
    assert.equal(await lot(601), 2)
    const row = await one('SELECT branch_id FROM returns WHERE id=?', id)
    assert.equal(row.branch_id, 1, 'the return stays on the sale\'s branch')
    const itemRow = await one('SELECT branch_id,product_id,sale_item_id FROM return_items WHERE return_id=?', id)
    assert.deepEqual({ ...itemRow }, { branch_id: 1, product_id: 1, sale_item_id: 1 })
    console.log('PASS edit takes product, branch and line from the sale and refuses what the sale did not sell')
  } finally {
    await mf.dispose()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
