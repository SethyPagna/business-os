// RET-A F3 (LH-3): returns and cancels restock into the lots a multi-lot sale
// line has NOT already had back. released_quantity counts only what the sale's
// own transitions gave back, so every planner also nets out what ACTIVE
// returns restocked into each lot (return_item_batch_allocations).
//
// Real routes (POST/PATCH /api/returns, POST /api/returns/bulk, PATCH
// /api/sales/:id/status, POST /api/sales/bulk-status) on workerd + D1 with
// every migration. Each sale sells 5 of one product: 3 from lot X (drawn
// first), 2 from lot Y. Lots start empty, so a lot's stock is exactly what
// came back into it.
//
// Transition table pinned here (per lot, after each step):
//   return 2            -> Y +2                      (X 0, Y 2)
//   return 3 more       -> X +3   (base: Y +2, X +1) (X 3, Y 2)
//   same request again  -> stored answer, nothing moves
//   cancel that return  -> X -3                      (X 0, Y 2)
//   return 3 again      -> X +3   (the cancelled return freed X)
//   --- second sale ---
//   return 2            -> Y +2
//   cancel the sale     -> X +3   (base: Y +2, X +1) (X 3, Y 2)
//   un-cancel           -> X -3   (takes back exactly what the cancel gave)
//   --- third sale, bulk-status cancel -> X +3 (base: Y +2, X +1)
//   --- fourth sale (v0 edit) ---
//   return 2 -> Y +2; return 1 -> X +1 (base: Y +1)
//   edit the second to 3 -> its 1 comes out of X, 3 go back into X (base: Y +2, X +1;
//   counting the edited return against itself: X +2 and 1 into a new lot)
// Run: node scripts/test-return-lot-drift-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')

const root = path.resolve(__dirname, '..')

async function workerBundle() {
  return build({ stdin: { contents: `import { Hono } from 'hono'
      import sales from './src/routes/sales'
      import returns from './src/routes/returns'
      const app=new Hono()
      app.route('/api/sales',sales); app.route('/api/returns',returns)
      export default app;`, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
  plugins: [{ name: 'ret-a-lot-fixtures', setup(b) {
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
    // Sale n (1..4) sells 5 of product 1 on line n: 3 from lot X = 500+2n-1, then 2 from lot Y = 500+2n.
    const seed = [
      "INSERT INTO roles(id,code,name,permissions) VALUES(1,'admin','Admin','{\"all\":true}')",
      "INSERT INTO users(id,username,name,password,role_id,permissions,is_active) VALUES(7,'admin','Fixture Admin','x',1,'{\"all\":true}',1)",
      "INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1)",
      "INSERT INTO products(id,name,is_active,stock_quantity,cost_price_usd,selling_price_usd) VALUES(1,'Serum',1,0,2,10)",
      'INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,0)',
    ]
    for (let n = 1; n <= 4; n += 1) {
      const x = 500 + 2 * n - 1, y = 500 + 2 * n
      for (const lot of [x, y]) {
        seed.push(`INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,received_quantity)
          VALUES(${lot},1,'L${lot}','L${lot}','2026-09-0${n}',1,5)`)
        seed.push(`INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(${lot},1,0)`)
      }
      seed.push(`INSERT INTO sales(id,receipt_number,branch_id,branch_name,exchange_rate,subtotal_usd,total_usd,sale_status,amount_paid_usd)
        VALUES(${n},'S-${n}',1,'Shop',4000,50,50,'completed',50)`)
      seed.push(`INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,applied_price_usd,total_usd,cost_price_usd,batch_id)
        VALUES(${n},${n},1,'Serum',5,1,10,50,2,NULL)`)
      seed.push(`INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity,released_quantity) VALUES(${n},${x},1,3,0)`)
      seed.push(`INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity,released_quantity) VALUES(${n},${y},1,2,0)`)
    }
    await db.batch(seed.map(sql => db.prepare(sql)))

    const headers = { 'content-type': 'application/json' }
    const send = async (method, url, body) => {
      const response = await mf.dispatchFetch(`http://local${url}`, { method, headers, body: JSON.stringify(body) })
      const text = await response.text()
      let parsed; try { parsed = JSON.parse(text) } catch { parsed = { raw: text.slice(0, 300) } }
      return { status: response.status, body: parsed }
    }
    const ok = (result, what) => { assert.equal(result.status, 200, `${what}: ${JSON.stringify(result.body)}`); return result.body }
    const lots = async (n) => {
      const x = 500 + 2 * n - 1, y = 500 + 2 * n
      const q = async (lot) => Number((await db.prepare('SELECT quantity q FROM branch_batch_stock WHERE batch_id=? AND branch_id=1').bind(lot).first()).q)
      return { X: await q(x), Y: await q(y) }
    }
    const line = (n, quantity) => [{ sale_item_id: n, product_id: 1, quantity, stock_action: 'restock', branch_id: 1 }]
    const createReturn = (n, key, quantity) => send('POST', '/api/returns', { client_request_id: key, sale_id: n, reason: 'RET-A F3', items: line(n, quantity) })
    const updatedAt = async (table, id) => (await db.prepare(`SELECT updated_at FROM ${table} WHERE id=?`).bind(id).first()).updated_at
    const saleStatus = async (n, target, key, extra = {}) => send('PATCH', `/api/sales/${n}/status`, {
      sale_status: target, client_request_id: key, expected_updated_at: await updatedAt('sales', n), ...extra })

    // -- sale 1: return then return, replay, cancel a return, return again -----
    const r1 = ok(await createReturn(1, 'f3-s1-r1', 2), 'first return')
    assert.deepEqual(await lots(1), { X: 0, Y: 2 }, 'the first return goes back into the last-drawn lot')
    const r2Body = { client_request_id: 'f3-s1-r2', sale_id: 1, reason: 'RET-A F3', items: line(1, 3) }
    const r2 = ok(await send('POST', '/api/returns', r2Body), 'second return')
    assert.deepEqual(await lots(1), { X: 3, Y: 2 }, 'the second return fills only the lot still out (base: Y 4, X 1)')
    ok(await send('POST', '/api/returns', r2Body), 'replayed second return')
    assert.deepEqual(await lots(1), { X: 3, Y: 2 }, 'a replayed return moves nothing')
    const r2Row = await db.prepare('SELECT status,return_type,updated_at FROM returns WHERE id=?').bind(r2.id).first()
    ok(await send('POST', '/api/returns/bulk', { client_request_id: 'f3-s1-cancel-r2', field: 'status', source: 'completed', target: 'cancelled',
      items: [{ id: r2.id, expected_status: String(r2Row.status || 'completed'), expected_method: String(r2Row.return_type || 'restock'), expected_updated_at: r2Row.updated_at }] }),
    'cancel the second return')
    assert.deepEqual(await lots(1), { X: 0, Y: 2 }, 'cancelling a return takes its units back out of exactly its lot')
    ok(await createReturn(1, 'f3-s1-r3', 3), 'third return')
    assert.deepEqual(await lots(1), { X: 3, Y: 2 }, 'a cancelled return frees its lot for the next return')
    assert.ok(r1.id > 0)
    console.log('PASS successive returns of a multi-lot line restock each lot once; a replay moves nothing; a cancelled return frees its lot')

    // -- sale 2: return then cancel the sale, then un-cancel -------------------
    ok(await createReturn(2, 'f3-s2-r1', 2), 'sale 2 return')
    assert.deepEqual(await lots(2), { X: 0, Y: 2 })
    ok(await saleStatus(2, 'cancelled', 'f3-s2-cancel', { cancel_reason: 'mistake' }), 'cancel sale 2')
    assert.deepEqual(await lots(2), { X: 3, Y: 2 }, 'the cancel restores only the units still out of each lot (base: Y 4, X 1)')
    const released = await db.prepare('SELECT batch_id,released_quantity r FROM sale_item_batch_allocations WHERE sale_item_id=2 ORDER BY id').all()
    assert.deepEqual(released.results.map(row => [row.batch_id, row.r]), [[503, 3], [504, 0]], 'released_quantity records what the cancel gave back, per lot')
    const status2 = (await db.prepare('SELECT status_before_cancel s FROM sales WHERE id=2').first()).s
    ok(await saleStatus(2, status2, 'f3-s2-uncancel'), 'un-cancel sale 2')
    assert.deepEqual(await lots(2), { X: 0, Y: 2 }, 'un-cancel takes back exactly what the cancel gave')
    console.log('PASS cancel after a return restores the untouched lot; un-cancel reverses it exactly')

    // -- sale 3: return then bulk-status cancel ---------------------------------
    ok(await createReturn(3, 'f3-s3-r1', 2), 'sale 3 return')
    const s3 = await db.prepare('SELECT id,sale_status expected_status,updated_at expected_updated_at FROM sales WHERE id=3').first()
    ok(await send('POST', '/api/sales/bulk-status', { client_request_id: 'f3-s3-bulk-cancel', target_status: 'cancelled', cancel_reason: 'mistake', items: [{ ...s3 }] }),
      'bulk cancel sale 3')
    assert.deepEqual(await lots(3), { X: 3, Y: 2 }, 'the bulk cancel uses the same per-lot rule (base: Y 4, X 1)')
    console.log('PASS a bulk-status cancel after a return restores the untouched lot')

    // -- sale 4: a v0 edit re-plans net of the other returns, not of itself ----
    ok(await createReturn(4, 'f3-s4-r1', 2), 'sale 4 first return')
    const r42 = ok(await createReturn(4, 'f3-s4-r2', 1), 'sale 4 second return')
    assert.deepEqual(await lots(4), { X: 1, Y: 2 }, 'the second return goes to the lot still out (base: Y 3, X 0)')
    ok(await send('PATCH', `/api/returns/${r42.id}`, { client_request_id: 'f3-s4-edit', expected_updated_at: await updatedAt('returns', r42.id), items: line(4, 3) }),
      'edit the second return to 3')
    assert.deepEqual(await lots(4), { X: 3, Y: 2 }, 'the edit reverses its own lot and re-plans net of the other return only (base: Y 4, X 1)')
    console.log('PASS a return edit re-plans its lots net of the other active returns')

    const branch = Number((await db.prepare('SELECT quantity q FROM branch_stock WHERE product_id=1 AND branch_id=1').first()).q)
    const lotSum = Number((await db.prepare('SELECT SUM(quantity) q FROM branch_batch_stock WHERE branch_id=1').first()).q)
    assert.equal(lotSum, branch, 'the lots add up to the branch total')
    console.log('PASS both ledgers agree at the end')
  } finally {
    await mf.dispose()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
