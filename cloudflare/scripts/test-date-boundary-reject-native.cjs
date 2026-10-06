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
const real = new Set(['acquisitionCostAccess', 'productWrites', 'moneyPrecision', 'productMerge', 'productIdentity', 'productDetailRule', 'db', 'sqlBinding', 'searchMatch', 'batchCode', 'businessDateWindow', 'actorSnapshot', 'pendingActions', 'reviewGate', 'reviewApply', 'conflictControl', 'renameCascade', 'schemaProbe', 'receivingBranch', 'businessMaintenanceGuard', 'media', 'audit', 'permissions', 'productImagePermission', 'importImageMatch'])
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
const admin={id:1,username:'admin',name:'Admin',role_code:'admin',tier:'full'}
const context={waitUntil:p=>Promise.resolve(p).catch(()=>{}),passThroughOnException:()=>{}}
async function request(app,method,url,body,user=admin){const response=await app.request(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},{...env,TEST_USER:user},context);const text=await response.text();let result;try{result=JSON.parse(text)}catch{result={raw:text}}return {status:response.status,body:result}}

function count(table){return raw.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n}
function pass(name){console.log(`PASS ${name}`)}
function row(id){return raw.prepare('SELECT expiry_date,discount_starts_at,discount_ends_at FROM products WHERE id=?').get(id)}
async function run(){
 raw.exec("INSERT INTO branches(id,name,is_active,is_default) VALUES(2,'Warehouse',1,1)")
 raw.exec("INSERT INTO users(id,username,name,password,permissions) VALUES(1,'admin','Admin','fixture','{\"all\":true}')")
 for (const url of ['/','/variant']) {
  // A real, slash-typed day is stored as ISO -- day-first, so 25/12 can only be the 25th of December.
  let res=await request(products,'POST',url,{name:'Dated '+url,expiry_date:'25/12/2026'})
  assert.equal(res.status,200,JSON.stringify(res));assert.equal(row(res.body.id).expiry_date,'2026-12-25')
  // Ambiguous 03/04 is read day-first: 3 April, not 4 March.
  res=await request(products,'POST',url,{name:'Ambiguous '+url,expiry_date:'03/04/2026'})
  assert.equal(res.status,200,JSON.stringify(res));assert.equal(row(res.body.id).expiry_date,'2026-04-03')
  // Blank means no date.
  res=await request(products,'POST',url,{name:'Blank '+url,expiry_date:'  '})
  assert.equal(res.status,200,JSON.stringify(res));assert.equal(row(res.body.id).expiry_date,null)
  // An unreadable value is refused with the stable code and the field name, and nothing is written.
  for (const field of ['expiry_date','discount_starts_at','discount_ends_at']) for (const bad of ['13/13/2026','2026-02-30','31/04/2026','tomorrow','2029','12/25/2026']) {
   const before=count('products')
   res=await request(products,'POST',url,{name:'Bad '+field+bad+url,[field]:bad})
   assert.equal(res.status,400,field+' '+bad+' '+JSON.stringify(res));assert.equal(res.body.code,'invalid_date');assert.equal(res.body.field,field);assert.equal(count('products'),before)
  }
 }
 pass('POST / and /variant store dd/mm/yyyy as ISO day-first and refuse unreadable dates with invalid_date, writing nothing')
 const res=await request(products,'POST','/',{name:'Window',discount_starts_at:'01/10/2026',discount_ends_at:'31/10/2026'})
 assert.equal(res.status,200,JSON.stringify(res));assert.deepEqual({...row(res.body.id)},{expiry_date:null,discount_starts_at:'2026-10-01',discount_ends_at:'2026-10-31'})
 pass('discount window typed day-first')
 const { normalizeProductDateFields } = load('lib/productWrites.ts')
 // PUT contract: the product form re-sends every field, so a legacy value the row already holds stays editable...
 let b={expiry_date:'2029'};assert.equal(normalizeProductDateFields(b,{expiry_date:'2029'}),null);assert.equal(b.expiry_date,'2029')
 // ...but only that exact value: changing it to other garbage is refused, and a stored legacy value does not excuse a different field.
 assert.equal(normalizeProductDateFields({expiry_date:'2030'},{expiry_date:'2029'}),'expiry_date')
 assert.equal(normalizeProductDateFields({discount_ends_at:'2029'},{expiry_date:'2029'}),'discount_ends_at')
 b={expiry_date:'05/01/2027'};assert.equal(normalizeProductDateFields(b,{expiry_date:'2029'}),null);assert.equal(b.expiry_date,'2027-01-05')
 b={expiry_date:'2026-10-05T18:30:00.000Z'};assert.equal(normalizeProductDateFields(b,null),null);assert.equal(b.expiry_date,'2026-10-05T18:30:00.000Z','a stored instant keeps its time of day')
 pass('edit contract: unchanged legacy text stays editable, changed garbage is refused, instants keep their time')
}
run().then(()=>console.log('COMPLETE'),e=>{console.error(e);process.exit(1)})
