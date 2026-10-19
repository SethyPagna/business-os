const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const { transformSync } = require('esbuild')
const { loadAll } = require('./harness/load_migrations.cjs')
const cache = new Map()
function load(file) {
  if (cache.has(file)) return cache.get(file).exports
  const module = { exports: {} }; cache.set(file, module)
  const source = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code
  new Function('require', 'module', 'exports', source)(id => id.startsWith('.') ? load(path.resolve(path.dirname(file), id.endsWith('.ts') ? id : `${id}.ts`)) : require(id), module, module.exports)
  return module.exports
}
const route = load(path.join(__dirname, '../src/routes/inventoryCheckProducts.ts')).default
let db, readHook, statements
function binding() {
  function prepare(sql) {
    return { sql, values: [], bind(...values) { assert.ok(values.length <= 100); return { ...this, values } }, async all() {
      statements++
      const results = db.prepare(sql).all(...this.values)
      if (readHook && sql.includes('AS reason_facets')) { const hook = readHook; readHook = null; hook() }
      return { success: true, results, meta: { changes: db.prepare('SELECT changes() AS n').get().n } }
    }, async run() { statements++; const result = db.prepare(sql).run(...this.values); return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } } } }
  }
  return { prepare, async batch(queries) {
    db.exec('BEGIN')
    try { const result = []; for (const query of queries) result.push(await query.all()); db.exec('COMMIT'); return result }
    catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error }
  } }
}
function reset() {
  db?.close(); db = new DatabaseSync(':memory:')
  for (const sql of loadAll({ through: 242 })) db.exec(sql)
  db.exec(fs.readFileSync(path.join(__dirname, '../migrations/0259_inventory_check_sessions.sql'), 'utf8'))
  const permissions = { inventory: false, inventory_checks: true, inventory_check_show_stock: false, inventory_check_show_price: false,
    inventory_check_show_cost: false, inventory_check_show_brand: true, inventory_check_show_category: true, inventory_check_show_sales: true,
    inventory_check_show_customers: true, inventory_check_show_received: true, contacts: false }
  db.prepare('INSERT INTO roles(id,name,code,permissions) VALUES(900001,?,?,?)').run('Check Employee', 'employee', JSON.stringify(permissions))
  db.exec(`INSERT INTO roles(id,name,code,permissions) VALUES(900002,'Administrator','admin','{}');
    INSERT INTO users(id,username,name,password,role_id,organization_id) VALUES
    (900001,'employee-one','Employee One','unused',900001,1),(900002,'employee-two','Employee Two','unused',900001,1),
    (900003,'admin-one','Admin One','unused',900002,1),(900004,'foreign-one','Foreign One','unused',900002,2);
    INSERT OR IGNORE INTO branches(id,name,is_active) VALUES(1,'One',1),(2,'Two',1);
    INSERT INTO customers(id,name) VALUES(900001,'Customer One'),(900002,'Customer Two');`)
  for (const actor of [900001,900002,900003,900004]) db.prepare("INSERT INTO user_sessions(user_id,token_hash,expires_at,last_seen_at) VALUES(?,?,'2099-01-01T00:00:00.000Z',CURRENT_TIMESTAMP)").run(actor, createHash('sha256').update(`token-${actor}`).digest('hex'))
  for (let n = 1; n <= 22; n++) {
    const id = 910000+n
    db.prepare('INSERT INTO products(id,name,stock_quantity,brand,brands,category,selling_price_usd,cost_price_usd) VALUES(?,?,5,?,?,?,?,?)').run(id, `Product ${String(n).padStart(2,'0')}`, `Brand ${n}`, `Brand ${n}||Shared`, 'Category', 91, 73)
    db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,5)').run(id)
    db.prepare('INSERT INTO product_batches(id,variant_product_id,batch_key,received_at) VALUES(?,?,?,?)').run(id,id,`batch-${id}`,n===22?'2026-10-18':'2026-10-19')
    db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,5)').run(id)
    const quantity = n === 22 ? 30 : 1
    db.prepare("INSERT INTO sales(id,receipt_number,customer_id,customer_name,created_at,sale_status,subtotal_usd,total_usd) VALUES(?,?,900001,'Customer One','2026-10-19T00:00:00.000Z','completed',?,?)").run(id,`receipt-${id}`,quantity,quantity)
    db.prepare('INSERT INTO sale_items(sale_id,product_id,branch_id,quantity,total_usd,total_khr,cost_price_usd,cost_price_khr) VALUES(?,?,1,?,?,0,0,0)').run(id,id,quantity,quantity)
  }
  session('session-own',1,900001,1,'Own count')
  session('session-other',1,900002,2,'Other branch count')
  session('session-foreign',2,900004,1,'Foreign secret')
  for(let n=1;n<=22;n++) item('session-own',910000+n,1,n===2?'done':n===3?'unstarted':'issue',n===3?null:0,n===2||n===3?null:`Reason ${n}`)
  item('session-other',910001,2,'issue',42,'Other issue')
  item('session-foreign',910001,1,'issue',99,'Foreign issue')
  statements=0; readHook=null
}
function session(id,org,actor,branch,title) {
  db.prepare("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,scope_json,started_at,updated_at) VALUES(?,?,?,?,?,'{}','2026-10-19','2026-10-19')").run(id,org,branch,actor,title)
}
function item(id,product,branch,state,count,reason) {
  db.prepare("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason) VALUES(?,?,?,'{}',5,'{}',?,?,?)").run(id,product,branch,state,count,reason)
}
async function request(query='', actor=900001) {
  const tasks=[]
  const response=await route.request(`http://local/${query?`?${query}`:''}`,{headers:actor?{Cookie:`bos_session=token-${actor}`} : {}},{DB:binding()},{waitUntil:task=>tasks.push(task)})
  await Promise.allSettled(tasks)
  return {status:response.status,body:await response.json(),cache:response.headers.get('cache-control')}
}
const physical = () => ['products','product_batches','branch_stock','branch_batch_stock','damaged_stock_lots','sales','sale_items','returns','return_items','inventory_movements','inventory_check_events'].map(table=>db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())
let groups=0
async function check(name,run) { await run(); groups++; console.log(`PASS ${name}`) }
async function main() {
  await check('actual cookie auth, dedicated Employee checks access and no-store without legacy stock authority',async()=>{
    reset(); const missing=await request('',0); assert.equal(missing.status,401); assert.match(missing.cache,/no-store/)
    const before=physical(), result=await request('branchId=1&pageSize=1')
    assert.equal(result.status,200); assert.match(result.cache,/no-store/); assert.equal(result.body.stats.total_variants,22)
    for(const key of ['quantity','display_quantity','selling_price_usd','cost_price_usd','damaged_quantity']) assert.ok(!(key in result.body.items[0]))
    assert.ok(!('stock_quantity' in result.body.stats)); assert.equal(result.body.stats.unique_customer_count,1)
    assert.deepEqual(physical(),before)
    console.log(`MEASURE authenticated list: attempted statements=${statements}; includes missing-cookie request, auth/current actor/settings/model/issues; no production or retry certificate`)
  })
  await check('all-session current issues filter before global statistics/ranking/page and expose branch/session resume identities',async()=>{
    reset(); const result=await request('state=issue&branchId=1&pageSize=1')
    assert.equal(result.status,200); assert.equal(result.body.items.length,1); assert.equal(result.body.stats.total_variants,20)
    assert.equal(result.body.stats.qty_sold,49); assert.equal(result.body.rankings.products[0].name,'Product 22')
    assert.equal(result.body.issues.length,1); assert.equal(result.body.issues[0].session_id,'session-own'); assert.equal(result.body.issues[0].branch_id,1)
    assert.equal(result.body.issues[0].counted_quantity,0); assert.equal(result.body.facets.brands.length,21)
    assert.ok(result.body.facets.brands.includes('Brand 22')); assert.ok(result.body.facets.reasons.includes('Reason 22'))
    db.exec("UPDATE products SET brands='Shared' WHERE id=910022")
    assert.ok((await request('state=issue&pageSize=1')).body.facets.brands.includes('Brand 22'))
    const all=await request('state=issue&pageSize=1'); assert.equal(all.body.issues.length,2)
    assert.ok(!('counted_quantity' in all.body.issues.find(row=>row.session_id==='session-other')))
    assert.ok(!JSON.stringify(all.body).includes('Foreign issue'))
    const admin=await request('state=issue&pageSize=1',900003); assert.equal(admin.body.issues.find(row=>row.session_id==='session-other').counted_quantity,42)
  })
  await check('reason/date/brand filters compose across the full cohort and customer identities require Contacts View opt-in',async()=>{
    reset(); let result=await request('state=issue&reason=Reason%2022&brand=Shared&startDate=2026-10-18&endDate=2026-10-19')
    assert.equal(result.status,200); assert.equal(result.body.stats.total_variants,1); assert.equal(result.body.stats.qty_sold,30)
    assert.equal(result.body.items[0].id,910022)
    assert.equal((await request('customerRanking=1')).status,403)
    result=await request('customerRanking=1',900003); assert.equal(result.status,200); assert.equal(result.body.rankings.customers[0].customer_id,900001)
  })
  await check('selected frozen membership, branch identity, org boundaries and closed-session current observations remain honest',async()=>{
    reset(); assert.equal((await request('state=done')).status,400); assert.equal((await request('state=unstarted')).status,400)
    assert.equal((await request('sessionId=session-own&branchId=2')).status,400)
    assert.equal((await request('sessionId=session-own&branch_id=2')).status,400)
    assert.equal((await request('sessionId=session-foreign')).status,404)
    let result=await request('sessionId=session-own&state=unstarted'); assert.equal(result.status,200); assert.equal(result.body.stats.total_variants,1); assert.equal(result.body.items[0].id,910003)
    result=await request('sessionId=session-own&state=done'); assert.equal(result.body.items[0].id,910002)
    db.exec("UPDATE inventory_check_sessions SET status='closed',revision=1,closed_at='2026-10-19' WHERE id='session-own'")
    result=await request('state=issue&branchId=1'); assert.equal(result.status,200); assert.equal(result.body.stats.total_variants,20)
    db.exec("UPDATE inventory_check_items SET state='done',reason=NULL WHERE session_id='session-own' AND product_id=910001")
    result=await request('state=issue&branchId=1'); assert.equal(result.body.stats.total_variants,19)
  })
  await check('unknown/duplicate/adversarial queries refuse; hidden values cannot filter or sort; late permission changes discard results',async()=>{
    reset()
    for(const query of ['unknown=x','startTime=12:00','endTime=12:00','state=bad','customerRanking=sale_count','page=1&page=2','sessionId=%27%20OR%201=1','reason='+encodeURIComponent('x'.repeat(501))]) assert.equal((await request(query)).status,400,query)
    for(const query of ['sortBy=price','sortBy=cost','stockState=out_of_stock']) assert.equal((await request(query)).status,403,query)
    const injected=await request('state=issue&reason='+encodeURIComponent("' OR 1=1 --")); assert.equal(injected.status,200); assert.equal(injected.body.stats.total_variants,0)
    readHook=()=>db.exec("UPDATE users SET permissions='{\"inventory_check_show_brand\":false}' WHERE id=900001")
    assert.equal((await request()).status,403)
    db.exec("UPDATE users SET permissions=NULL WHERE id=900001")
    readHook=()=>db.exec("UPDATE users SET permissions='{\"inventory_checks\":false}' WHERE id=900001")
    assert.equal((await request()).status,403)
    db.exec("UPDATE users SET permissions=NULL WHERE id=900001")
    readHook=()=>db.exec("UPDATE user_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=900001")
    assert.equal((await request()).status,403)
  })
  await check('bounded global facets signal overflow and current-page issue overflow refuses without truncating',async()=>{
    reset()
    for(let n=1;n<=202;n++) { const id=`many-${n}`; session(id,1,900002,1,`More ${n}`); item(id,910001,1,'issue',n,`Extra ${n}`) }
    let result=await request('state=issue&pageSize=1'); assert.equal(result.status,200); assert.equal(result.body.facets.reasons.length,200); assert.equal(result.body.facetsLimited.reasons,true)
    for(let n=203;n<=501;n++) { const id=`many-${n}`; session(id,1,900002,1,`More ${n}`); item(id,910001,1,'issue',n,`Extra ${n}`) }
    result=await request('state=issue&pageSize=1'); assert.equal(result.status,413)
  })
  db.close(); console.log(`PASS ${groups} actual SQLite/Hono authenticated Inventory product HTTP groups`)
}
main().catch(error=>{ console.error(error); process.exitCode=1 })
