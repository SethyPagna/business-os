// LH-2b (RET-B handoff 7865b7d2, 5 Oct 2026) through the real POST/PATCH
// /api/returns on workerd + D1 with every migration. sale_items.returned_quantity
// is written only by the sales import: a return-status row restocks those units
// at import and records no return_items. A new return must count them as
// already returned, or the same units are restocked a second time.
//
// Discriminating: before this change a 2-unit return on a line sold 3 with 2
// imported-returned was accepted (by sale item and by product) and restocked
// 2 more units; an edit could grow a 1-unit return to 2 the same way.
// Run: node scripts/test-return-imported-returned-capacity-native.cjs
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
  plugins: [{ name: 'ret-a-lh2b-fixtures', setup(b) {
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
    // Sale 1 was imported: 3 Toner sold, 2 came back at import (restocked then,
    // no return_items). Line 2 = 2 Cream, nothing returned -- the control.
    await db.batch([
      "INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1)",
      "INSERT INTO products(id,name,is_active,stock_quantity,cost_price_usd,selling_price_usd) VALUES(2,'Toner',1,2,1,5)",
      "INSERT INTO products(id,name,is_active,stock_quantity,cost_price_usd,selling_price_usd) VALUES(3,'Cream',1,0,1,7)",
      'INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,2)',
      'INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(3,1,0)',
      `INSERT INTO sales(id,receipt_number,branch_id,branch_name,exchange_rate,subtotal_usd,total_usd,sale_status,amount_paid_usd)
        VALUES(1,'IMP-1',1,'Shop',4000,29,29,'partial_return',29)`,
      `INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,applied_price_usd,total_usd,cost_price_usd,returned_quantity)
        VALUES(1,1,2,'Toner',3,1,5,15,1,2)`,
      `INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,applied_price_usd,total_usd,cost_price_usd,returned_quantity)
        VALUES(2,1,3,'Cream',2,1,7,14,1,0)`,
    ].map(sql => db.prepare(sql)))

    const headers = { 'content-type': 'application/json' }
    const send = async (method, url, body) => {
      const response = await mf.dispatchFetch(`http://local${url}`, { method, headers, body: JSON.stringify(body) })
      const text = await response.text()
      let parsed; try { parsed = JSON.parse(text) } catch { parsed = { raw: text.slice(0, 300) } }
      return { status: response.status, body: parsed }
    }
    const one = async (sql, ...binds) => db.prepare(sql).bind(...binds).first()
    const stock = async (product) => Number((await one('SELECT quantity q FROM branch_stock WHERE product_id=? AND branch_id=1', product)).q)
    const footprint = async () => JSON.stringify(await db.prepare(`SELECT (SELECT COUNT(*) FROM returns) r,
      (SELECT COUNT(*) FROM return_items) ri, (SELECT COALESCE(SUM(quantity),0) FROM branch_stock) bs`).first())
    const toner = (quantity, extra = {}) => ({ product_id: 2, quantity, applied_price_usd: 5, stock_action: 'restock', ...extra })

    // -- create: only 1 Toner is still returnable ---------------------------------
    const fixed = await footprint()
    for (const [label, line] of [['by sale item', toner(2, { sale_item_id: 1 })], ['by product', toner(2)]]) {
      const over = await send('POST', '/api/returns', { client_request_id: `lh2b-over-${label}`, sale_id: 1, reason: 'back again', items: [line] })
      assert.equal(over.status, 400, `${label}: ${JSON.stringify(over.body)}`)
      assert.match(String(over.body.error), /only 1 remaining|more than/i, `${label}: ${over.body.error}`)
    }
    assert.equal(await footprint(), fixed, 'a refused over-return writes nothing')
    const one1 = await send('POST', '/api/returns', { client_request_id: 'lh2b-one', sale_id: 1, reason: 'back again', items: [toner(1, { sale_item_id: 1 })] })
    assert.ok(one1.status >= 200 && one1.status < 300, JSON.stringify(one1.body))
    assert.equal(await stock(2), 3, 'the one unit not yet back is restocked once (2 imported + 1)')
    const again = await send('POST', '/api/returns', { client_request_id: 'lh2b-again', sale_id: 1, reason: 'back again', items: [toner(1)] })
    assert.equal(again.status, 400, JSON.stringify(again.body))
    assert.equal(await stock(2), 3, 'no unit is restocked twice')
    // Control: a line with nothing imported-returned is fully returnable.
    const cream = await send('POST', '/api/returns', { client_request_id: 'lh2b-cream', sale_id: 1, reason: 'control',
      items: [{ product_id: 3, sale_item_id: 2, quantity: 2, applied_price_usd: 7, stock_action: 'restock' }] })
    assert.ok(cream.status >= 200 && cream.status < 300, JSON.stringify(cream.body))
    assert.equal(await stock(3), 2)
    assert.equal((await one('SELECT sale_status s FROM sales WHERE id=1')).s, 'returned',
      'every unit is back (2 at import + 1 Toner, 2 Cream), so the sale reads Returned, not Partial')
    console.log('PASS create counts the units the sales import already brought back: 1 of 3 returnable, never restocked twice')

    // -- edit: the 1-unit return cannot grow past what is left ------------------
    const row = await one("SELECT id, updated_at FROM returns WHERE client_request_id='lh2b-one'")
    const grow = await send('PATCH', `/api/returns/${row.id}`, { client_request_id: 'lh2b-grow', expected_updated_at: row.updated_at,
      reason: 'back again', items: [toner(2, { sale_item_id: 1 })] })
    assert.equal(grow.status, 400, JSON.stringify(grow.body))
    assert.equal(Number((await one('SELECT quantity q FROM return_items WHERE return_id=?', row.id)).q), 1, 'the return keeps 1 unit')
    assert.equal(await stock(2), 3, 'the refused edit restocked nothing')
    console.log('PASS edit counts the imported returns too: a 1-unit return cannot grow to 2')
  } finally {
    await mf.dispose()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
