// Owner standing rule (13 Oct 2026): historical (imported old-system) sales never accrue loyalty points. A sale with
// loyalty_accrual = 0 earned nothing, so a RETURN of it must not subtract points it never earned. Balances are derived
// by summing ledgers, so the rule has to hold at every reader of the returns term, and they must agree with each
// other: the customer membership balance (routes/contacts.ts), the loyalty notification (routes/notifications.ts) and
// the checkout redemption check (lib/saleCustomerAssignmentGuard.ts rawPointsSql), all driven here through the real
// Worker, auth and native D1 on the real migrations.
//
//   node test-loyalty-nonaccruing-return-native.cjs                     the working tree
//   LOYALTY_SCOPE_BASELINE=<root of a checkout> node ...               the same cases against another source tree
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { createHash } = require('node:crypto'), { build } = require('esbuild'), { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')
const root = process.env.LOYALTY_SCOPE_BASELINE || path.resolve(__dirname, '..')
const script = `
import worker from './src/index.ts';
let active=[],wrapped;
const note=(sql,r)=>active.push({sql,rows:r.results?.length||0,meta:r.meta});
function statement(sql,s){return {inner:s,sql,bind(...v){return statement(sql,s.bind(...v))},async all(){const r=await s.all();note(sql,r);return r},async run(){const r=await s.run();note(sql,r);return r},async first(c){const r=await this.all();return c?r.results[0]?.[c]??null:r.results[0]??null}}}
export default {async fetch(request,env,ctx){
const input=await request.json();
if(input.op==='seed'){for(const s of input.statements){try{await env.DB.prepare(s.sql).bind(...(s.params||[])).run()}catch(e){return Response.json({error:String(e),sql:s.sql})}}return Response.json({ok:true})}
if(input.op==='read')return Response.json((await env.DB.prepare(input.sql).all()).results);
if(!wrapped)wrapped={prepare:sql=>statement(sql,env.DB.prepare(sql)),async batch(items){const r=await env.DB.batch(items.map(x=>x.inner));r.forEach((v,i)=>note(items[i].sql,v));return r}};
active=[];const pending=[],started=Date.now();const saved=globalThis.caches;globalThis.caches=undefined;
const headers={cookie:'bos_session='+input.token,origin:'https://admin.scope.example','content-type':'application/json'};
const response=await worker.fetch(new Request('https://admin.scope.example'+input.path,{method:input.body?'POST':'GET',headers,...(input.body?{body:JSON.stringify(input.body)}:{})}),{...env,DB:wrapped},{waitUntil(p){pending.push(p)},passThroughOnException(){}});
await Promise.allSettled(pending);globalThis.caches=saved;return Response.json({status:response.status,body:await response.text().then(text=>{try{return JSON.parse(text)}catch{return text}}),log:active,wallMs:Date.now()-started});
}};`
const failures = []
async function check(name, fn) {
  try { await fn(); console.log('PASS ' + name) } catch (error) { failures.push(name); console.log('FAIL ' + name + ' :: ' + String(error.message || error).split('\n').slice(0, 4).join(' | ')) }
}
async function main() {
  const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: script }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', external: ['node:*', 'cloudflare:workers'], logLevel: 'silent' })
  for (const tier of ['free', 'paid']) {
    const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'], port: 0, d1Databases: ['DB'], kvNamespaces: ['CACHE'], bindings: { PLAN_TIER: tier, BUSINESS_OS_ADMIN_URL: 'https://admin.scope.example' }, log: new Log(LogLevel.ERROR) })
    const call = async input => (await mf.dispatchFetch('http://local/', { method: 'POST', body: JSON.stringify(input) })).json()
    const seed = async statements => { const r = await call({ op: 'seed', statements }); assert.equal(r.ok, true, JSON.stringify(r)) }
    try {
      const migrations = []
      for (const name of fs.readdirSync(path.join(root, 'migrations')).filter(n => n.endsWith('.sql')).sort()) for (const sql of split(fs.readFileSync(path.join(root, 'migrations', name), 'utf8'))) {
        if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(sql.trim())) continue
        migrations.push({ sql })
      }
      for (let i = 0; i < migrations.length; i += 50) await seed(migrations.slice(i, i + 50))
      const token = 'synthetic-nonaccruing-session', hash = createHash('sha256').update(token).digest('hex')
      await seed([
        { sql: "INSERT OR IGNORE INTO roles(code,name,permissions) VALUES('admin','Administrator','{\"all\":true}')" },
        { sql: "INSERT INTO users(id,username,name,password,role_id,permissions,is_active) SELECT 71,'synthetic-scope','Scope admin','fixture',id,'{\"all\":true}',1 FROM roles WHERE code='admin' LIMIT 1" },
        { sql: 'INSERT INTO user_sessions(user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(71,?,?,?,?)', params: [hash, new Date(Date.now() - 3600000).toISOString(), new Date(Date.now() + 86400000).toISOString(), new Date().toISOString()] },
        ...Object.entries({ loyalty_points_enabled: 'true', customer_portal_points_basis: 'usd', customer_portal_points_per_usd: '1.5', notifications_loyalty_threshold: '14', customer_portal_redeem_points: '100', exchange_rate: '4000' })
          .map(([key, value]) => ({ sql: 'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', params: [key, value] })),
        { sql: "INSERT INTO customers(id,name,membership_number) VALUES(9902,'Synthetic nonaccruing witness','LC-9902')" },
        // S1 earns 10 x 1.5 = 15. S2 is a migrated old-system receipt (loyalty_accrual = 0): it earns nothing.
        { sql: "INSERT INTO sales(id,receipt_number,customer_id,total_usd,total_khr,sale_status,loyalty_accrual) VALUES(7001,'NA-EARNED',9902,10,40000,'completed',1),(7002,'NA-HISTORICAL',9902,90,360000,'completed',0)" },
        { sql: "INSERT INTO branches(id,name,role,is_default,is_active) VALUES(1,'Synthetic shop','shop',1,1)" },
        { sql: "INSERT INTO products(id,name,sku,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active) VALUES(10,'Powder','NA-PRODUCT',10,9.5,38000,4,16000,1)" },
        { sql: 'INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(10,1,10)' },
        { sql: "INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,expiry_date,received_at,is_active,batch_number) VALUES(500,10,'na-lot','NA-LOT','2027-06-01','2026-09-01',1,1)" },
        { sql: 'INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(500,1,10)' },
      ])
      const request = async (path, body) => {
        const r = await call({ path, token, body })
        assert.ok(r.log.length <= (tier === 'free' ? 50 : 1000), JSON.stringify({ tier, path, queries: r.log.length, status: r.status }))
        return r
      }
      const membership = async () => { const r = await request('/api/customers/membership/LC-9902'); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.points.balance }
      const notification = async () => {
        const r = await request('/api/notifications/summary'); assert.equal(r.status, 200, JSON.stringify(r.body))
        const section = (r.body.sections || []).find(x => x.id === 'loyalty')
        return section ? (section.items.find(x => x.id === 'loyalty-9902') || {}).meta ?? null : null
      }
      const returnRow = (number, saleId, usd, khr) => ({ sql: 'INSERT INTO returns(return_number,customer_id,sale_id,return_scope,status,total_refund_usd,total_refund_khr) VALUES(?,9902,?,?,?,?,?)', params: [number, saleId, 'customer', 'completed', usd, khr] })

      // A. R1 refunds 20 USD of the HISTORICAL sale. It must subtract nothing.
      await seed([returnRow('NA-RET-HISTORICAL', 7002, 20, 80000)])
      await check(`[${tier}] A1 membership balance ignores the return of a non-accruing sale (15, not 0)`, async () => assert.equal(await membership(), 15))
      await check(`[${tier}] A2 loyalty notification reads the same 15 points (threshold 14)`, async () => assert.equal(await notification(), '15 points'))

      // B. Controls: a return of the ACCRUING sale, and a return linked to no sale, still subtract.
      await seed([returnRow('NA-RET-EARNED', 7001, 2, 8000)])
      await check(`[${tier}] B1 control: a return of an accruing sale still subtracts (15 - 3 = 12)`, async () => assert.equal(await membership(), 12))
      await check(`[${tier}] B2 control: below the threshold the notification is gone`, async () => assert.equal(await notification(), null))
      await seed([returnRow('NA-RET-UNLINKED', null, 1, 4000)])
      await check(`[${tier}] B3 control: a return linked to no sale keeps its existing deduction (12 - 1.5 = 10.5)`, async () => assert.equal(await membership(), 10.5))

      // C. The rule is read at the time of the question, not stored: opt the historical sale INTO accrual and its return counts.
      await seed([{ sql: 'UPDATE sales SET loyalty_accrual = 1 WHERE id = 7002' }])
      await check(`[${tier}] C1 once the sale accrues, its return subtracts (15 + 135 - 3 - 30 - 1.5 = 115.5)`, async () => assert.equal(await membership(), 115.5))
      await seed([{ sql: 'UPDATE sales SET loyalty_accrual = 0 WHERE id = 7002' }])
      await check(`[${tier}] C2 and flipping it back restores 10.5`, async () => assert.equal(await membership(), 10.5))

      // D. Checkout re-validates with the SAME rule (lib/saleCustomerAssignmentGuard.ts): the balance the till showed is the balance it spends.
      const checkout = { offline_owner: { version: 1, actor_id: 71, organization_id: null, authority: 'https://admin.scope.example', runtime: 'cloudflare-workers' }, branch_id: 1, money_precision_version: 1, items: [{ product_id: 10, quantity: 1, branch_id: 1, batch_id: 500, applied_price_usd: 9.5, client_line_key: 'na-line', pricing_source: 'selling', pricing_quote: { gross_usd: 9.5, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 9.5, total_khr: 38000 } }], exchange_rate: 4000, payment_method: 'Cash', payment_currency: 'USD', amount_paid_usd: 9.4, customer_id: 9902, membership_points_redeemed: 10, membership_discount_usd: 0.1, loyalty_accrual: false, client_request_id: 'na-redeem' }
      await check(`[${tier}] D1 checkout refuses one point more than the balance (11 > 10.5)`, async () => {
        const over = await request('/api/sales', { ...checkout, membership_points_redeemed: 11, membership_discount_usd: 0.11, amount_paid_usd: 9.39, client_request_id: 'na-excess' })
        assert.equal(over.status, 409, JSON.stringify(over.body)); assert.equal(over.body.code, 'loyalty_redemption_conflict')
        assert.equal((await call({ op: 'read', sql: "SELECT COUNT(*) n FROM sales WHERE client_request_id='na-excess'" }))[0].n, 0)
      })
      await check(`[${tier}] D2 checkout accepts redeeming 10 points (balance 10.5): the return of the historical sale took none`, async () => {
        const ok = await request('/api/sales', checkout)
        assert.equal(ok.status, 200, JSON.stringify(ok.body))
        assert.equal(await membership(), 0.5)
      })
    } finally { await mf.dispose() }
  }
  if (failures.length) { console.log('FAILED ' + failures.length + ': ' + failures.join('; ')); process.exitCode = 1 } else console.log('PASS loyalty non-accruing return: every reader of the returns term agrees')
}
main().catch(e => { console.error(e); process.exitCode = 1 })
