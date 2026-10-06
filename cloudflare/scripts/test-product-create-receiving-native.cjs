const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const src = path.resolve(__dirname, '../src')

const database = openDb(loadAll(path.resolve(__dirname, '../migrations')))
const raw = database.db
assert.equal(raw.limits.exprDepth,100)
let afterRead = null, beforeBatch = null, afterStatement = null, loseAck = false, batchCount = 0
const DB = {
  prepare(sql) {
    let values = []
    const statement = {
      sql,
      bind(...args) { values = args; return statement },
      args() { return /\?\d/.test(sql) ? [Object.fromEntries(values.map((v,i)=>[String(i+1),v]))] : values },
      async all() { const results = raw.prepare(sql).all(...statement.args()); if (afterRead) afterRead(sql, results[0] ?? null); return { results } },
      async first() { const value = raw.prepare(sql).get(...statement.args()) ?? null; if (afterRead) afterRead(sql, value); return value },
      async run() {
        const prepared = raw.prepare(sql)
        if (prepared.columns().length) return { success:true,results:prepared.all(...statement.args()),meta:{changes:0} }
        const result = prepared.run(...statement.args())
        return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
      },
    }
    return statement
  },
  async batch(statements) {
    batchCount++
    if (beforeBatch) { const hook = beforeBatch; beforeBatch = null; hook() }
    raw.exec('BEGIN IMMEDIATE')
    let results = []
    try { for (const statement of statements) { results.push(await statement.run()); if (afterStatement) afterStatement(statement.sql) } raw.exec('COMMIT') }
    catch (error) { raw.exec('ROLLBACK'); throw error }
    if (loseAck) { loseAck = false; throw new Error('D1_ERROR: connection reset after commit') }
    return results
  },
}
const env = { DB }
const real = new Set(['acquisitionCostAccess', 'productWrites', 'moneyPrecision', 'productMerge', 'productIdentity', 'productDetailRule', 'db', 'sqlBinding', 'searchMatch', 'batchCode', 'actorSnapshot', 'pendingActions', 'reviewGate', 'reviewApply', 'conflictControl', 'renameCascade', 'schemaProbe', 'receivingBranch', 'businessMaintenanceGuard', 'media', 'audit', 'permissions', 'productImagePermission', 'importImageMatch', 'productDiscountGate'])
const unavailable = name => new Proxy(function () {}, { get: (_target, property) => unavailable(`${name}.${String(property)}`), apply: () => { throw new Error(`Unexpected fixture dependency: ${name}`) }, construct: () => { throw new Error(`Unexpected fixture dependency: ${name}`) } })
const services = {
  undoAppliers: { registerMergeFold: () => {}, registerProductMergeGroupRedo: () => {}, MERGE_REPARENT_TABLES: [] },
  auth: { requireAuth: async (c, next) => { c.set('user', c.env.TEST_USER); await next() } },
  cache: { bumpVersion: async () => {}, bumpVersions: async () => {} },
  broadcastHub: { broadcast: async () => {} },
}
const cache = new Map()
function load(relative) {
  if (cache.has(relative)) return cache.get(relative)
  const mod = { exports: {} }; cache.set(relative, mod.exports)
  const filename = path.join(src, relative)
  let source = fs.readFileSync(filename, 'utf8')
  if (process.env.RECEIVING_CREATE_MUTANT === 'no-branch-guard' && relative === 'lib/productWrites.ts') source = source.replace('if (branchId != null) statements.push(receivingBranchAssertion(branchId))', '')
  if (process.env.RECEIVING_CREATE_MUTANT === 'no-review-cas' && relative === 'lib/productWrites.ts') source = source.replace('statements.push(...pendingActionApprovalStatements(approval.row, approval.reviewer))', '')
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: filename }).outputText
  const localRequire = request => {
    if (request === 'hono') return { Hono }
    const name = request.split('/').pop()
    if (relative === 'lib/acquisitionCostAccess.ts' && name === 'permissions') return load('lib/permissions.ts')
    if (services[name]) return services[name]
    if (real.has(name)) return load(`lib/${name}.ts`)
    if (request.startsWith('.')) return unavailable(request)
    return require(request)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  cache.set(relative, mod.exports); return mod.exports
}

const products=load('routes/products.ts').default
const reviews=load('routes/reviewQueue.ts').default
const admin={id:1,username:'admin',name:'Admin',role_code:'admin',tier:'full'}
const context={waitUntil:p=>Promise.resolve(p).catch(()=>{}),passThroughOnException:()=>{}}
async function request(app,method,url,body,user=admin){const response=await app.request(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},{...env,TEST_USER:user},context);const text=await response.text();let result;try{result=JSON.parse(text)}catch{result={raw:text}}return {status:response.status,body:result}}

function count(table) { return raw.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n }
function snapshot() {
 const tables=raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name != 'sqlite_stat1' ORDER BY name").all()
 return JSON.stringify(tables.map(({name})=>[name,raw.prepare(`SELECT * FROM "${name.replaceAll('"','""')}"`).all().map(row=>JSON.stringify(row)).sort()]))
}
function pass(name) { console.log(`PASS ${name}`) }
async function run(){
 raw.exec("INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Old Shop',0,0),(2,'Warehouse',1,1),(3,'Other',1,0)")
 raw.exec("INSERT INTO users(id,username,name,password,permissions) VALUES(1,'admin','Admin','fixture','{\"all\":true}'),(2,'requester','Requester','fixture','{\"products\":\"review\"}')")
 for (const url of ['/', '/variant']) for(const branch_id of [1,'2x',0,-1,1.5,[2],[],{},true]) {
  const before=snapshot(),res=await request(products,'POST',url,{name:`Inactive ${url} ${branch_id}`,branch_id,stock_quantity:5})
  assert.equal(res.status,409,JSON.stringify(res));assert.equal(res.body.code,'receiving_branch_inactive');assert.equal(snapshot(),before)
 }
 pass('actual direct and variant handlers refuse inactive/malformed destinations without writes')
 const started=new Date().toISOString().slice(0,10)
 let res=await request(products,'POST','/',{name:'Atomic direct',branch_id:2,stock_quantity:5,cost_price_usd:1.2345,client_request_id:'untrusted',id:9000,image_gallery:['https://example.invalid/a','https://example.invalid/b']})
 assert.equal(res.status,200,JSON.stringify(res));const id=res.body.id
 assert.notEqual(id,9000);assert.match(res.body.item.client_request_id,/^product-create:/);assert.notEqual(res.body.item.client_request_id,'untrusted')
 assert.deepEqual(raw.prepare('SELECT branch_id,quantity FROM branch_stock WHERE product_id=? ORDER BY branch_id').all(id).map(r=>({...r})),[{branch_id:2,quantity:5},{branch_id:3,quantity:0}])
 const lot=raw.prepare('SELECT * FROM product_batches WHERE variant_product_id=?').get(id)
 assert.equal(lot.batch_key,`initial:${id}`);assert.equal(lot.batch_number,1);assert.equal(lot.received_at.slice(0,10),started)
 assert.equal(lot.unit_cost_usd,null);assert.equal(lot.received_quantity,null);assert.equal(lot.received_cost_usd,null)
 assert.equal(raw.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=?').get(lot.id).quantity,5)
 assert.equal(raw.prepare('SELECT COUNT(*) n FROM product_images WHERE product_id=?').get(id).n,2)
 assert.equal(res.body.item.cost_price_usd,1.2345)
 pass('keyed product, all active branch rows, initial dated lot, gallery and NULL receipt money preserved')
 raw.exec('CREATE TABLE fixture_intervening(id INTEGER PRIMARY KEY)')
 afterStatement=sql=>{if(/^INSERT INTO "products"/.test(sql))raw.exec('INSERT INTO fixture_intervening VALUES(5001)')}
 res=await request(products,'POST','/variant',{name:'Keyed variant',stock_quantity:7});afterStatement=null
 assert.equal(res.status,200,JSON.stringify(res));assert.equal(raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=? AND branch_id=2').get(res.body.id).quantity,7)
 assert.equal(raw.prepare('SELECT variant_product_id FROM product_batches WHERE batch_key=?').get(`initial:${res.body.id}`).variant_product_id,res.body.id)
 pass('actual variant fallback remains bound to product key across intervening row ID')
 for(const url of ['/','/variant']) {
  let expected
  beforeBatch=()=>{raw.exec('UPDATE branches SET is_active=0 WHERE id=2');expected=snapshot()}
  res=await request(products,'POST',url,{name:`Raced ${url}`,branch_id:2,stock_quantity:8,image_gallery:['https://example.invalid/race']})
  assert.equal(res.status,409,JSON.stringify(res));assert.equal(snapshot(),expected);raw.exec('UPDATE branches SET is_active=1 WHERE id=2')
 }
 pass('batch-time retirement rolls back complete native tables for direct and variant')
 raw.exec('UPDATE branches SET is_active=0')
 for(const url of ['/','/variant']) {
  res=await request(products,'POST',url,{name:`Zero ${url}`,stock_quantity:0});assert.equal(res.status,200,JSON.stringify(res))
  assert.equal(raw.prepare('SELECT COUNT(*) n FROM branch_stock WHERE product_id=?').get(res.body.id).n,0)
  assert.equal(raw.prepare('SELECT COUNT(*) n FROM product_batches WHERE variant_product_id=?').get(res.body.id).n,1)
 }
 const zeroBefore=snapshot();res=await request(products,'POST','/',{name:'Positive no active',stock_quantity:1});assert.equal(res.status,409);assert.equal(snapshot(),zeroBefore)
 raw.exec('UPDATE branches SET is_active=1 WHERE id IN(2,3)')
 pass('zero-stock no-active catalog remains supported; positive fallback fails closed')
 const reviewUser={id:2,username:'requester',name:'Requester',permissions:JSON.stringify({products:'review'})}
 async function queue(name){const result=await request(products,'POST','/',{name,branch_id:2,stock_quantity:4},reviewUser);assert.equal(result.status,202,JSON.stringify(result));return result.body.pendingActionId}
 let pending=await queue('Queued successful');const beforeCount=count('products')
 res=await request(reviews,'POST',`/${pending}/approve`,{});assert.equal(res.status,200,JSON.stringify(res));assert.equal(count('products'),beforeCount+1)
 assert.equal(raw.prepare('SELECT status FROM pending_actions WHERE id=?').get(pending).status,'approved')
 assert.equal(raw.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity='product' AND action='create' AND entity_id=(SELECT id FROM products WHERE name='Queued successful')").get().n,1)
 res=await request(reviews,'POST',`/${pending}/approve`,{});assert.equal(res.status,409);assert.equal(count('products'),beforeCount+1)
 pass('actual queued approval commits product/lot/audit/status together; second approval preserves existing409')
 pending=await queue('Queue inactive');raw.exec('UPDATE branches SET is_active=0 WHERE id=2');let expected=snapshot()
 res=await request(reviews,'POST',`/${pending}/approve`,{});assert.equal(res.status,409,JSON.stringify(res));assert.equal(res.body.code,'receiving_branch_inactive');assert.equal(snapshot(),expected);raw.exec('UPDATE branches SET is_active=1 WHERE id=2')
 pass('queued approval refuses destination retired after queue without losing pending history')
 for(const mutation of ['payload','status']) {
  pending=await queue(`Queue raced ${mutation}`)
  beforeBatch=()=>{if(mutation==='payload')raw.prepare("UPDATE pending_actions SET payload_json=? WHERE id=?").run(JSON.stringify({name:'Changed request',stock_quantity:99}),pending);else raw.prepare("UPDATE pending_actions SET status='rejected' WHERE id=?").run(pending);expected=snapshot()}
  res=await request(reviews,'POST',`/${pending}/approve`,{});assert.equal(res.status,409,JSON.stringify(res));assert.equal(res.body.code,'product_create_review_conflict');assert.equal(snapshot(),expected)
 }
 pass('same-batch pending payload/status CAS rolls back product/stock/lot/audit')
 pending=await queue('Approval branch race');beforeBatch=()=>{raw.exec('UPDATE branches SET is_active=0 WHERE id=2');expected=snapshot()}
 res=await request(reviews,'POST',`/${pending}/approve`,{});assert.equal(res.status,409,JSON.stringify(res));assert.equal(snapshot(),expected);raw.exec('UPDATE branches SET is_active=1 WHERE id=2')
 pass('approval retirement race rolls back pending approved mark too')
 beforeBatch=()=>{raw.exec("INSERT INTO system_flags(key,value) VALUES('maintenance','{}')");expected=snapshot()}
 res=await request(products,'POST','/',{name:'Maintenance race',branch_id:2,stock_quantity:1});assert.equal(res.status,500);assert.equal(snapshot(),expected);assert.notEqual(res.body.code,'product_create_outcome_unknown');raw.exec("DELETE FROM system_flags WHERE key='maintenance'")
 pass('maintenance assertion rolls back whole batch and is not mislabeled uncertain')
 raw.exec("CREATE TRIGGER fixture_gallery_refusal BEFORE INSERT ON product_images BEGIN SELECT RAISE(ABORT,'CHECK constraint failed: fixture_gallery'); END")
 expected=snapshot();res=await request(products,'POST','/',{name:'Gallery refusal',branch_id:2,stock_quantity:2,image_gallery:['https://example.invalid/refuse']});assert.equal(res.status,500);assert.equal(snapshot(),expected);assert.notEqual(res.body.code,'product_create_outcome_unknown');raw.exec('DROP TRIGGER fixture_gallery_refusal')
 pass('deterministic gallery constraint leaves no partial product and no unknown-outcome misclassification')
 let attempts=batchCount;loseAck=true;res=await request(products,'POST','/',{name:'Lost direct ack',branch_id:2,stock_quantity:2})
 assert.equal(res.status,503,JSON.stringify(res));assert.equal(res.body.code,'product_create_outcome_unknown');assert.equal(res.body.outcome,'unknown');assert.equal(res.body.action,'refresh_before_create');assert.equal(batchCount,attempts+1);assert.equal(raw.prepare("SELECT COUNT(*) n FROM products WHERE name='Lost direct ack'").get().n,1)
 pass('actual direct postcommit lost acknowledgement is single-attempt503 with durable product, not false rollback')
 pending=await queue('Lost approval ack');attempts=batchCount;loseAck=true;res=await request(reviews,'POST',`/${pending}/approve`,{})
 assert.equal(res.status,503,JSON.stringify(res));assert.equal(batchCount,attempts+1);assert.equal(raw.prepare('SELECT status FROM pending_actions WHERE id=?').get(pending).status,'approved')
 const approvedCount=count('products');res=await request(reviews,'POST',`/${pending}/approve`,{});assert.equal(res.status,409);assert.equal(count('products'),approvedCount)
 pass('approval lost acknowledgement retains atomic approved status and prevents duplicate reapply')

 const replayBody={name:'Same key variant',branch_id:2,stock_quantity:3,client_request_id:'same-client-create-key'}
 loseAck=true;res=await request(products,'POST','/variant',replayBody);assert.equal(res.status,503)
 res=await request(products,'POST','/variant',replayBody);assert.equal(res.status,200,JSON.stringify(res))
 const variantDuplicates=raw.prepare("SELECT id,client_request_id FROM products WHERE name='Same key variant' ORDER BY id").all()
 assert.equal(variantDuplicates.length,2);assert.notEqual(variantDuplicates[0].client_request_id,variantDuplicates[1].client_request_id)
 assert.equal(raw.prepare("SELECT SUM(bs.quantity) AS n FROM branch_stock bs JOIN products p ON p.id=bs.product_id WHERE p.name='Same key variant'").get().n,6)
 pass('negative replay contract: identical variant client key after lost acknowledgement creates TWO products')
 const directReplay={name:'Same key direct',branch_id:2,stock_quantity:3,client_request_id:'same-direct-create-key'}
 loseAck=true;res=await request(products,'POST','/',directReplay);assert.equal(res.status,503)
 const directOriginal=raw.prepare("SELECT id FROM products WHERE name='Same key direct'").get().id
 res=await request(products,'POST','/',directReplay);assert.equal(res.status,200,JSON.stringify(res));assert.equal(res.body.folded_into,directOriginal)
 assert.equal(raw.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity='product' AND entity_id=? AND action='fold'").get(directOriginal).n,1)
 raw.exec('UPDATE branches SET is_active=0 WHERE id=2')
 res=await request(products,'POST','/',directReplay);assert.equal(res.status,409);assert.equal(res.body.code,'receiving_branch_inactive')
 raw.exec('UPDATE branches SET is_active=1 WHERE id=2')
 res=await request(products,'POST','/',{...directReplay,name:'Changed intent same direct key'});assert.equal(res.status,200,JSON.stringify(res));assert.notEqual(res.body.id,directOriginal)
 pass('direct repeated key performs identity fold, refuses retired destination, and accepts changed intent: NOT receipt replay')
 console.log('COMPLETE 15 native groups at SQLite expression depth100; no runtime service')
 database.close?.()
}
run().catch(error=>{console.error(error);process.exitCode=1})
