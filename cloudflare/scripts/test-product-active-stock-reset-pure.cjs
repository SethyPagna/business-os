const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const fixture = require('./test-product-active-stock-products-route.cjs')
const { rawDb, db, seed } = fixture
db.staging = db
const originalPrepare = db.prepare.bind(db)
db.prepare = sql => {
 const statement = originalPrepare(sql), run = statement.run
 statement.run = params => { const result = run(params); return {...result,lastInsertRowid:Number(result.meta.last_row_id),changes:result.meta.changes} }
 return statement
}
const guard = require('./harness/product_stock_guard.cjs')
let actor, backupFails = false, backupCalls = 0
function load(name, dependencies = {}) {
  const file = path.join(__dirname, '../src', name)
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', output)(mod, mod.exports, id => {
    if (Object.hasOwn(dependencies, id)) return dependencies[id]
    if (!id.startsWith('.')) return require(id)
    throw new Error(`Unmapped reset dependency ${id}`)
  })
  return mod.exports
}
const core = load('lib/coreDataInvariants.ts', {
 './db': {getDb:()=>db}, './productStockGuard':guard,
 './customTableName':load('lib/customTableName.ts'), './sqlBinding':load('lib/sqlBinding.ts'), './passwordHash':{hashPassword:async()=> 'test-hash'},
})
const backup = async()=>{backupCalls++; if(backupFails) throw new Error('fixture backup refused')}
const noop = async()=>{}
const app = load('routes/system.ts', {
 hono:require('hono'), '../lib/auth':{requireAuth:async(c,next)=>{c.set('user',actor);return next()}},
 '../lib/permissions':load('lib/permissions.ts'), '../lib/db':{getDb:()=>db}, '../lib/audit':{audit:noop},
 '../lib/dataIntegrity':{}, '../lib/productStockGuard':guard,
 '../lib/r2':{listObjects:async()=>[],deleteObject:noop,deleteObjectsBulk:async()=>({deleted:0,errors:[]})},
 '../lib/imageVariantStore':{variantKeysForUploadKeys:()=>[]}, '../lib/importRetention':{}, '../lib/media':{sanitizeMediaList:x=>x},
 '../lib/coreDataInvariants':{...core,dropAllCustomTables:async()=>[]},
 '../lib/backup':{createCloudflareBackup:backup,createSectionBackup:async(env,tables)=>{assert.ok(tables.includes('damaged_stock_lots'));await backup()}},
 '../durable-objects/broadcastHub':{broadcast:noop}, '../lib/cache':{bumpVersion:noop,bumpVersions:noop}, '../lib/errorReporting':{},
 '../lib/rateLimit':{}, '../lib/actorSnapshot':{actorSnapshot:u=>u.username}, '../lib/planTier':load('lib/planTier.ts'),
 '../lib/currentPasswordGuard':{verifyCurrentPassword:async(c,ids,password)=>({ok:password==='current-secret'}),CURRENT_PASSWORD_RATE_LIMITED_ERROR:'rate limited'},
}).default
const env={DB:db,ASSETS:{},BUSINESS_OS_ADMIN_PASSWORD:'seed-secret',CACHE:{get:async()=>null,put:noop}}
const context={waitUntil:p=>p.catch(()=>{}),passThroughOnException(){}}
const phrases={sales:'RESET SALES',products:'RESET PRODUCTS',all:'DELETE ALL DATA',factory:'FACTORY RESET'}
function setup() {
 seed('batch')
 rawDb.exec("INSERT OR IGNORE INTO roles(id,name,code,is_system,permissions) VALUES(901,'Default admin','admin',1,'{\"all\":true}'),(902,'Other admin','admin',0,'{\"all\":true}'),(903,'Manager','manager',1,'{\"all\":true}')")
 rawDb.exec('UPDATE roles SET is_system=1 WHERE id=901')
 rawDb.exec("DELETE FROM users WHERE id IN(901,902,903); INSERT INTO users(id,username,name,password,role_id,is_active,permissions) VALUES(901,'admin','Default admin','current-hash',901,1,'{}'),(902,'owner','Other admin','hash',901,1,'{}'),(903,'manager','All grants','hash',903,1,'{\"all\":true}')")
 rawDb.prepare("INSERT INTO damaged_stock_lots(product_id,product_name,branch_id,quantity,quantity_remaining,reason,condition_tag,source) VALUES(1,'Guard fixture',1,3,3,'test','damaged','return')").run()
 rawDb.prepare('UPDATE products SET stock_quantity=5 WHERE id=1').run()
 rawDb.exec("DELETE FROM inventory_movements; INSERT INTO inventory_movements(product_id,product_name,branch_id,movement_type,quantity) VALUES(1,'Historical name',1,'stock_in',5)")
 actor={id:901,username:'cached-owner',role_code:'manager',permissions:JSON.stringify({backup_restore:true})}
 backupFails=false;backupCalls=0
}
function snapshot(){return JSON.stringify(['products','branch_stock','branch_batch_stock','damaged_stock_lots','users'].map(t=>rawDb.prepare(`SELECT * FROM ${t}`).all()))}
async function post(mode,patch={}) {
 const body={mode,confirm:phrases[mode],acknowledged:true,currentPassword:'current-secret',...patch}
 const response=await app.request(mode==='factory'?'/factory-reset':'/reset-data',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)},env,context)
 return {status:response.status,json:await response.json()}
}
async function main() {
 for(const mode of ['sales','products','all','factory']) {
  for(const mutation of ['other-admin','all-grant','renamed','disabled','deleted','non-system-role','username-only']) {
   setup()
   if(mutation==='other-admin') actor.id=902
   if(mutation==='all-grant') actor.id=903
   if(mutation==='renamed') rawDb.exec("UPDATE users SET username='renamed-admin' WHERE id=901")
   if(mutation==='disabled') rawDb.exec('UPDATE users SET is_active=0 WHERE id=901')
   if(mutation==='deleted') rawDb.exec("UPDATE users SET deleted_at='2026-10-08' WHERE id=901")
   if(mutation==='non-system-role') rawDb.exec('UPDATE roles SET is_system=0 WHERE id=901')
   if(mutation==='username-only') rawDb.exec('UPDATE users SET role_id=903 WHERE id=901')
   const before=snapshot();const result=await post(mode)
   assert.equal(result.status,403,JSON.stringify(result));assert.equal(result.json.code,'reset_builtin_admin_only');assert.equal(snapshot(),before);assert.equal(backupCalls,0)
  }
  for(const patch of [{acknowledged:undefined},{acknowledged:'true'},{confirm:undefined},{confirm:phrases[mode]+' '}]) {
   setup();const before=snapshot();const result=await post(mode,patch);assert.equal(result.status,400,JSON.stringify(result));assert.equal(snapshot(),before);assert.equal(backupCalls,0)
  }
  setup();backupFails=true;let before=snapshot();let result=await post(mode);assert.equal(result.status,500,JSON.stringify(result));assert.equal(snapshot(),before)
  setup();assert.throws(()=>rawDb.prepare('DELETE FROM products WHERE id=1').run(),/product_has_stock/);rawDb.exec("UPDATE users SET username=' ADMIN ' WHERE id=901"); result=await post(mode);assert.equal(result.status,200,JSON.stringify(result));assert.equal(backupCalls,1)
  assert.equal(rawDb.prepare('SELECT COUNT(*) n FROM damaged_stock_lots').get().n,0)
  if(mode==='sales') assert.equal(rawDb.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity,0)
  else assert.equal(rawDb.prepare('SELECT COUNT(*) n FROM products').get().n,0)
  if(mode==='products') assert.equal(rawDb.prepare('SELECT product_name FROM inventory_movements').get().product_name,'Historical name')
  console.log(`PASS ${mode}: fresh default authority, repeated confirmation, backup refusal, four-ledger guarded reset`)
 }
}
if(require.main===module) main().catch(error=>{console.error(error);process.exitCode=1})
