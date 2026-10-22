// Loyalty off must cost nothing: no ledger read, no loyalty cache-version read, no balance computation.
// Loyalty on keeps the notice; switching on never awards history. Both switch surfaces write one key.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { createHash } = require('node:crypto'), { build } = require('esbuild'), { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')
const root = process.env.LOYALTY_OFF_BASELINE || path.resolve(__dirname, '..')
const script = `
import worker from './src/index.ts';
import { executeRawStockTransaction } from './src/lib/stockTransaction.ts';
let active=[],wrapped;
const note=(sql,params,r)=>active.push({sql,params,rows:r.results?.length||0});
function statement(sql,s,params=[]){return {inner:s,sql,bind(...v){return statement(sql,s.bind(...v),v)},async all(){const r=await s.all();note(sql,params,r);return r},async run(){const r=await s.run();note(sql,params,r);return r},async first(c){const r=await this.all();return c?r.results[0]?.[c]??null:r.results[0]??null}}}
export default {async fetch(request,env,ctx){
const input=await request.json();
if(input.op==='seed'){for(const s of input.statements){try{await env.DB.prepare(s.sql).bind(...(s.params||[])).run()}catch(e){return Response.json({error:String(e),sql:s.sql})}}return Response.json({ok:true})}
if(input.op==='seedStock'){try{await executeRawStockTransaction(env.DB,input.statements.map(s=>env.DB.prepare(s.sql).bind(...(s.params||[]))));return Response.json({ok:true})}catch(error){return Response.json({error:String(error)})}}
if(input.op==='read')return Response.json((await env.DB.prepare(input.sql).all()).results);
if(!wrapped)wrapped={prepare:sql=>statement(sql,env.DB.prepare(sql)),async batch(items){const r=await env.DB.batch(items.map(x=>x.inner));r.forEach((v,i)=>note(items[i].sql,[],v));return r}};
active=[];const pending=[];const saved=globalThis.caches;globalThis.caches={default:{match:async()=>undefined,put:async()=>{},delete:async()=>false}};
const headers={cookie:'bos_session='+input.token,origin:'https://admin.scope.example','content-type':'application/json'};
const response=await worker.fetch(new Request('https://admin.scope.example'+input.path,{method:input.method||(input.body?'POST':'GET'),headers,...(input.body?{body:JSON.stringify(input.body)}:{})}),{...env,DB:wrapped,BROADCAST_HUB:{idFromName:n=>n,get:()=>({fetch:async()=>Response.json({recipients:0})})}},{waitUntil(p){pending.push(p)},passThroughOnException(){}});
await Promise.allSettled(pending);globalThis.caches=saved;return Response.json({status:response.status,body:await response.text().then(text=>{try{return JSON.parse(text)}catch{return text}}),log:active});
}};`
const isLedger = entry => /loyalty-ledger|loyalty_accrual|loyalty_point_adjustments/i.test(entry.sql)
const readsVersion = (entry, names) => /cache_versions/i.test(entry.sql) && entry.params.some(p => names.includes(p))
const customerRows = body => Array.isArray(body) ? body : body.items || body.rows || body.data

async function main() {
  // The switch surfaces: one key, written by the Loyalty page and by admin Settings; administrator-only on the Worker.
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8')
  const page = read('frontend', 'src', 'components', 'loyalty-points', 'LoyaltyPointsPage.tsx')
  const settingsUi = read('frontend', 'src', 'components', 'utils-settings', 'Settings.tsx')
  assert.match(page, /loyalty_points_enabled: form\.loyalty_points_enabled \? 'true' : 'false'/, 'Loyalty page saves the shared key')
  assert.match(settingsUi, /setValue\('loyalty_points_enabled', event\.target\.checked \? 'true' : 'false'\)/, 'admin Settings saves the shared key')
  assert.match(settingsUi, /\{isAdmin \? \(\s*<label[^>]*>\s*<div className="pr-3">\s*<div[^>]*>\{t\('loyalty_points_enabled'\)\}/, 'Settings toggle is rendered for administrators only')
  const keys = await build({ entryPoints: [path.join(root, 'src', 'lib', 'settingsAdminKeys.ts')], bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent' })
  const adminKeys = { exports: {} }
  new Function('module', 'exports', keys.outputFiles[0].text)(adminKeys, adminKeys.exports)
  assert.equal(adminKeys.exports.isAdminOnlySettingKey('loyalty_points_enabled'), true, 'only an administrator may change the loyalty switch')
  assert.equal(adminKeys.exports.firstChangedAdminOnlySettingKey(['loyalty_points_enabled'], { loyalty_points_enabled: 'false' }, () => 'false'), null, 'resending the stored value stays a no-op for a non-admin save')

  const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: script }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', external: ['node:*', 'cloudflare:workers'], logLevel: 'silent' })
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'], port: 0, d1Databases: ['DB'], kvNamespaces: ['CACHE'], bindings: { PLAN_TIER: 'free', BUSINESS_OS_ADMIN_URL: 'https://admin.scope.example' }, log: new Log(LogLevel.ERROR) })
  const call = async input => {
    const response = await mf.dispatchFetch('http://local/', { method: 'POST', body: JSON.stringify(input) })
    const text = await response.text()
    try { return JSON.parse(text) } catch { throw new Error(input.op + ': ' + text) }
  }
  const seed = async statements => { const r = await call({ op: 'seed', statements }); assert.equal(r.ok, true, JSON.stringify(r)) }
  try {
    const files = fs.readdirSync(path.join(root, 'migrations')).filter(n => n.endsWith('.sql')).sort()
    const list = []
    for (const name of files) {
      for (const sql of split(fs.readFileSync(path.join(root, 'migrations', name), 'utf8'))) {
        list.push({ sql })
      }
    }
    for (let i = 0; i < list.length; i += 50) await seed(list.slice(i, i + 50))
    const token = 'synthetic-off-cost-session'
    const hash = createHash('sha256').update(token).digest('hex')
    const permissions = JSON.stringify({ all: true })
    await seed([
      { sql: "INSERT OR IGNORE INTO roles(code,name,permissions) VALUES('admin','Administrator',?)", params: [permissions] },
      { sql: "INSERT INTO users(id,username,name,password,role_id,permissions,is_active) SELECT 71,'synthetic-off','Off admin','fixture',id,?,1 FROM roles WHERE code='admin' LIMIT 1", params: [permissions] },
      { sql: 'INSERT INTO user_sessions(user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(71,?,?,?,?)', params: [hash, new Date(Date.now() - 3600000).toISOString(), new Date(Date.now() + 86400000).toISOString(), new Date().toISOString()] },
      ...Object.entries({ customer_portal_points_basis: 'usd', customer_portal_points_per_usd: '1.5', notifications_loyalty_threshold: '1', customer_portal_redeem_points: '100', exchange_rate: '4000' })
        .map(([key, value]) => ({ sql: 'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', params: [key, value] })),
      { sql: "INSERT INTO customers(id,name,membership_number) VALUES(9901,'Synthetic off witness','LC-9901')" },
      { sql: "INSERT INTO branches(id,name,role,is_default,is_active) VALUES(1,'Synthetic shop','shop',1,1)" },
    ])
    const stock = await call({ op: 'seedStock', statements: [
      { sql: "INSERT INTO products(id,name,sku,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active) VALUES(10,'Powder','OFF-PRODUCT',10,9.5,38000,4,16000,1)" },
      { sql: 'INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(10,1,10)' },
      { sql: "INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,expiry_date,received_at,is_active,batch_number) VALUES(500,10,'off-lot','OFF-LOT','2027-06-01','2026-09-01',1,1)" },
      { sql: 'INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(500,1,10)' },
    ] })
    assert.equal(stock.ok, true, JSON.stringify(stock))
    const request = (p, body, method) => call({ path: p, token, body, method })
    const checkout = id => ({
      offline_owner: { version: 1, actor_id: 71, organization_id: null, authority: 'https://admin.scope.example', runtime: 'cloudflare-workers' },
      branch_id: 1, money_precision_version: 1,
      items: [{ product_id: 10, quantity: 1, branch_id: 1, batch_id: 500, applied_price_usd: 9.5, client_line_key: 'off-line', pricing_source: 'selling', pricing_quote: { gross_usd: 9.5, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 9.5, total_khr: 38000 } }],
      exchange_rate: 4000, payment_method: 'Cash', payment_currency: 'USD', amount_paid_usd: 9.5, customer_id: 9901,
      membership_points_redeemed: 0, membership_discount_usd: 0, loyalty_accrual: true, client_request_id: id,
    })
    const setting = async () => (await call({ op: 'read', sql: "SELECT value FROM settings WHERE key='loyalty_points_enabled'" }))[0]?.value
    assert.equal(await setting(), 'false', 'production default is off')

    // OFF: a sale, then the notifications read and the customer list.
    const sale = await request('/api/sales', checkout('off-cost-sale'))
    assert.equal(sale.status, 200, JSON.stringify(sale.body))
    assert.equal((await call({ op: 'read', sql: "SELECT loyalty_accrual a FROM sales WHERE client_request_id='off-cost-sale'" }))[0].a, 0, 'a sale made while off never accrues')
    const offNote = await request('/api/notifications/summary')
    assert.equal(offNote.status, 200, JSON.stringify(offNote.body))
    assert.equal(offNote.body.sections.find(s => s.id === 'loyalty'), undefined, 'no loyalty notice while off')
    assert.deepEqual(offNote.log.filter(isLedger).map(e => e.sql.slice(0, 80)), [], 'no ledger statement while off')
    assert.deepEqual(offNote.log.filter(e => readsVersion(e, ['sales', 'returns', 'customers'])).map(e => e.params), [], 'the notice is not keyed on sales/returns/customers while off')
    assert.deepEqual(offNote.log.filter(e => /customer_portal_points_basis/.test(e.sql)).map(e => e.sql.slice(0, 60)), [], 'no loyalty config read while off')
    const offRows = offNote.log.reduce((n, e) => n + e.rows, 0)
    const offList = await request('/api/customers?search=LC-9901')
    assert.equal(offList.status, 200, JSON.stringify(offList.body))
    assert.deepEqual(offList.log.filter(isLedger).map(e => e.sql.slice(0, 80)), [], 'the customer list reads no ledger while off')
    const offRow = customerRows(offList.body).find(r => r.id === 9901)
    assert.ok(offRow.membership_number === 'LC-9901' && Number(offRow.points_balance || 0) === 0, 'membership id stays, balance is zero')

    // Turning on awards nothing for the sale made while off, and the change is audited before/after.
    const toggled = await request('/api/settings', { loyalty_points_enabled: 'true' })
    assert.equal(toggled.status, 200, JSON.stringify(toggled.body))
    assert.equal(await setting(), 'true')
    const trail = JSON.stringify((await call({ op: 'read', sql: "SELECT old_value,new_value,details FROM audit_logs WHERE entity='settings' ORDER BY id DESC LIMIT 1" }))[0])
    assert.match(trail, /loyalty_points_enabled/)
    assert.match(trail, /false/)
    assert.match(trail, /true/, 'audit holds before and after')
    const onNote = await request('/api/notifications/summary')
    assert.equal(onNote.status, 200, JSON.stringify(onNote.body))
    assert.equal(onNote.body.sections.find(s => s.id === 'loyalty'), undefined, 'turning on does not retro-accrue the off-born sale')
    assert.ok(onNote.log.some(isLedger), 'positive control: on walks the ledger')
    const onList = await request('/api/customers?search=LC-9901')
    assert.equal(Number(customerRows(onList.body).find(r => r.id === 9901).points_balance), 0, 'history stays at zero after enabling')
    assert.ok(onList.log.some(isLedger), 'positive control: the on-state list reads the ledger')

    // ON: a new sale earns and the notice names the customer.
    const earned = await request('/api/sales', checkout('on-cost-sale'))
    assert.equal(earned.status, 200, JSON.stringify(earned.body))
    const note = await request('/api/notifications/summary')
    const section = note.body.sections.find(s => s.id === 'loyalty')
    assert.ok(section && section.items.some(i => i.id === 'loyalty-9901' && i.meta === '14.25 points'), 'notice correct while on: ' + JSON.stringify(section))
    console.log('PASS loyalty off cost: off notice read ' + offRows + ' rows and no ledger statement; on notice correct; enabling awards no history; one administrator-only audited key')
  } finally { await mf.dispose() }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
