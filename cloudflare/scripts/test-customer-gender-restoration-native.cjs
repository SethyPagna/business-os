// Actual Hono Contacts + history routes and restoration/undo modules, full
// migration SQLite database and actual transactional d1compat.batch. All data
// is synthetic; approval is replaced only inside this isolated test process.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('node:module')
const { Hono } = require('hono')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const SRC = path.join(__dirname, '../src')
function inert() { return new Proxy(function () {}, { get: () => inert(), apply: () => undefined }) }
function load(file, overrides = {}) {
  const full = path.join(SRC, file)
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const original = Module._load
  Module._load = (request, parent, isMain) => Object.hasOwn(overrides, request) ? overrides[request] : request.startsWith('.') ? inert() : original(request, parent, isMain)
  const mod = { exports: {} }
  try { new Function('require','module','exports','__filename','__dirname',code)(require,mod,mod.exports,full,path.dirname(full)) } finally { Module._load = original }
  return mod.exports
}
const permissions = load('lib/permissions.ts')
const actor = load('lib/actorSnapshot.ts')
const ADMIN = { id: 7, username: 'admin', name: 'Fixture Admin', permissions: '{}' }
const OTHER = { ...ADMIN, id: 8 }
async function fixture() {
  const native = openDb(loadAll()); const raw = native.db
  raw.exec(`INSERT INTO customers(id,name,phone,phone_normalized,membership_number,gender,address,notes,email,is_anonymous,updated_at)
    VALUES(1,'Alpha','012345678','012345678','A1',NULL,'[{"phone":"012345678","address":"House Alpha Unique"}]','Keep notes','alpha@example.invalid',0,'2026-01-01'),
      (2,'Beta','012345679','012345679','B2','','[{"phone":"012345679","address":"House Beta Unique"}]','Keep beta','beta@example.invalid',0,'2026-01-01'),
      (3,'General',NULL,NULL,NULL,NULL,NULL,'Keep General',NULL,1,'2026-01-01'),
      (4,'Untouched','012345680','012345680','C4',NULL,NULL,'Keep all',NULL,0,'2026-01-01')`)
  raw.exec(`INSERT INTO sales(id,receipt_number,customer_id,customer_name,customer_phone,total_usd,amount_paid_usd,membership_points_redeemed)
    VALUES(101,'fixture-sale',1,'Alpha','012345678',12,4,3);
    INSERT INTO loyalty_point_adjustments(id,customer_id,points,note) VALUES(101,1,100,'Keep points')`)
  let hook = null; let fault = false; let lost = false; let user = ADMIN
  const db = {
    prepare: sql => native.prepare(sql),
    async batch(statements) {
      if (hook) { const run = hook; hook = null; await run() }
      let chosen = statements
      if (fault) { fault = false; chosen = [...statements.slice(0,-1),{sql:'INSERT INTO no_such_table VALUES(1)',params:{}},statements.at(-1)] }
      const result = await native.batch(chosen)
      if (lost) { lost = false; throw Error('Synthetic lost response after commit') }
      return result
    },
  }
  const restoration = load('lib/customerGenderRestoration.ts', {
    './db': { getDb: () => db }, './permissions': permissions, './actorSnapshot': actor,
    './cache': { bumpVersion: async () => {} }, '../durable-objects/broadcastHub': { broadcast: async () => {} },
  })
  const appliers = load('lib/undoAppliers.ts', {
    './customerGenderRestoration': restoration, './permissions': permissions, './actorSnapshot': actor,
    './db': { getDb: () => db },
  })
  const common = {
    '../lib/db': { getDb: () => db }, '../lib/permissions': permissions, '../lib/actorSnapshot': actor,
    '../lib/customerGenderRestoration': restoration,
    '../lib/auth': { requireAuth: async (c,next) => { if (!user) return c.json({error:'Unauthorized'},401); c.set('user',user); return next() } },
    '../lib/undoAppliers': appliers,
    '../lib/saleBulkUpdate': { SALE_BULK_UPDATE_KINDS: new Set() },
  }
  const contacts = load('routes/contacts.ts', common).default
  const history = load('routes/actionHistory.ts', common).default
  const app = new Hono(); app.route('/api', contacts); app.route('/api/action-history', history)
  const beforeFields = ['name','phone','phone_normalized','membership_number','is_anonymous','address','updated_at','gender']
  const body = { version:1,campaign_id:'fixture-gender-campaign',chunk_index:0,rows:[1,2].map(id => {
    const row = raw.prepare('SELECT * FROM customers WHERE id=?').get(id)
    return { id,to_gender:id===1?'female':'male',before:Object.fromEntries(beforeFields.map(f=>[f,row[f]])),match:{kind:'unique_phone',key:row.phone} }
  }) }
  const manifest = { ...body, chunk_digest: await restoration.genderManifestDigest(body) }
  Object.assign(restoration.APPROVED_GENDER_RESTORATION,{campaign_id:body.campaign_id,total_count:2,chunk_digests:[manifest.chunk_digest]})
  const request = async (method,url,body) => {
    const res = await app.request(url,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})},{},{waitUntil:()=>{}})
    const text=await res.text()
    try { return {status:res.status,body:JSON.parse(text)} } catch { throw Error(`${method} ${url} status${res.status}: ${text}`) }
  }
  const state = () => JSON.stringify(raw.prepare('SELECT * FROM customers ORDER BY id').all())
  const counts = () => [raw.prepare('SELECT COUNT(*) n FROM undo_snapshots').get().n,raw.prepare('SELECT COUNT(*) n FROM action_history').get().n,raw.prepare('SELECT COUNT(*) n FROM audit_logs').get().n]
  const related = () => JSON.stringify({sales:raw.prepare('SELECT * FROM sales ORDER BY id').all(),points:raw.prepare('SELECT * FROM loyalty_point_adjustments ORDER BY id').all()})
  return {native,raw,db,restoration,manifest,request,state,counts,related,setUser:u=>{user=u},hook:fn=>{hook=fn},fault:()=>{fault=true},lost:()=>{lost=true}}
}
const endpoint = '/api/customers/gender-restoration/'
async function main() {
  const f = await fixture(); const original = f.state(); const relatedBefore = f.related()
  assert.equal((await f.request('POST',endpoint+'preview',f.manifest)).body.status,'ready')
  const applied = await f.request('POST',endpoint+'apply',f.manifest)
  assert.equal(applied.status,200,JSON.stringify(applied)); assert.equal(applied.body.status,'applied')
  const before=JSON.parse(original), after=JSON.parse(f.state())
  assert.deepEqual(after,before.map(row=>({...row,gender:row.id===1?'female':row.id===2?'male':row.gender})), 'all columns except selected gender exactly invariant')
  assert.deepEqual(f.counts(),[1,1,1])
  const retry=await f.request('POST',endpoint+'apply',f.manifest)
  assert.equal(retry.body.history_id,applied.body.history_id); assert.equal(retry.body.replayed,true); assert.deepEqual(f.counts(),[1,1,1])
  const status=await f.request('GET',endpoint+'status?campaign_id=fixture-gender-campaign')
  assert.equal(status.body.receipts.length,1); assert.ok(!JSON.stringify(status.body).includes('Alpha'))
  const historyId=applied.body.history_id
  const undo=await f.request('POST',`/api/action-history/${historyId}/undo`,{require_applied:true,expected_generation:0})
  assert.equal(undo.status,200,JSON.stringify(undo)); assert.equal(f.state(),original); assert.equal(undo.body.generation,1)
  const repeatUndo=await f.request('POST',`/api/action-history/${historyId}/undo`,{require_applied:true,expected_generation:0})
  assert.equal(repeatUndo.status,200); assert.deepEqual(f.counts(),[1,1,2])
  const undoneApply=await f.request('POST',endpoint+'apply',f.manifest)
  assert.equal(undoneApply.body.status,'reversed'); assert.equal(f.state(),original)
  const redo=await f.request('POST',`/api/action-history/${historyId}/redo`,{require_applied:true,expected_generation:1})
  assert.equal(redo.status,200,JSON.stringify(redo)); assert.equal(redo.body.generation,2)
  assert.equal((await f.request('POST',`/api/action-history/${historyId}/undo`,{expected_generation:0})).status,409)
  assert.equal((await f.request('POST',`/api/action-history/${historyId}/undo`,{})).status,400)
  f.setUser(OTHER)
  assert.equal((await f.request('POST',endpoint+'apply',f.manifest)).status,404)
  assert.equal((await f.request('POST',`/api/action-history/${historyId}/undo`,{expected_generation:2})).status,404)
  f.setUser(ADMIN)
  const forged={scope:'contacts',entity:'customer',label:'Forged',undo_payload:{applier:'customer.gender_restore',operation_id:'x',snapshot_id:1},redo_payload:{applier:'customer.gender_restore'}}
  assert.equal((await f.request('POST','/api/action-history',forged)).status,403)
  assert.equal((await f.request('PATCH',`/api/action-history/${historyId}`,{status:'redoable'})).status,403)
  assert.equal(f.related(),relatedBefore,'sale amounts, unpaid credit, customer snapshots and loyalty events unchanged through apply/undo/redo')
  console.log('PASS real routes: gender-only full-column invariance, idempotency, status, undo/redo generation, ownership, history forgery')

  for (const user of [null,{id:9,username:'staff',permissions:'{"contacts":true}'},{id:9,username:'review',permissions:'{"contacts":"review"}'},{id:9,username:'none',permissions:'{}'}]) {
    const t=await fixture();t.setUser(user);const state=t.state()
    assert.ok([401,403].includes((await t.request('POST',endpoint+'apply',t.manifest)).status));assert.equal(t.state(),state);assert.deepEqual(t.counts(),[0,0,0])
  }
  for (const field of ['name','phone','phone_normalized','membership_number','address','updated_at','gender','is_anonymous']) {
    const t=await fixture();const state=t.state()
    t.hook(()=>t.raw.prepare(`UPDATE customers SET ${field}=? WHERE id=1`).run(field==='is_anonymous'?1:'concurrent'))
    const result=await t.request('POST',endpoint+'apply',t.manifest)
    assert.equal(result.status,409,`${field}: ${JSON.stringify(result)}`);assert.deepEqual(t.counts(),[0,0,0]);
    assert.equal(t.raw.prepare('SELECT gender FROM customers WHERE id=2').get().gender,'')
  }
  for (const mutate of [
    raw=>raw.prepare("INSERT INTO customers(id,name,phone,is_anonymous) VALUES(5,'New match','012345678',0)").run(),
    raw=>raw.prepare("UPDATE customers SET address='[{\"phone\":\"012345678\"}]' WHERE id=4").run(),
    raw=>raw.prepare('DELETE FROM customers WHERE id=1').run(),
  ]) {
    const t=await fixture();t.hook(()=>mutate(t.raw));assert.equal((await t.request('POST',endpoint+'apply',t.manifest)).status,409);assert.deepEqual(t.counts(),[0,0,0])
  }
  const failure=await fixture();const pre=failure.state();failure.fault()
  assert.equal((await failure.request('POST',endpoint+'apply',failure.manifest)).status,500)
  assert.equal(failure.state(),pre);assert.deepEqual(failure.counts(),[0,0,0])
  const uncertain=await fixture();uncertain.lost()
  const recovered=await uncertain.request('POST',endpoint+'apply',uncertain.manifest)
  assert.equal(recovered.status,200);assert.equal(recovered.body.replayed,true);assert.deepEqual(uncertain.counts(),[1,1,1])
  const concurrent=await fixture();let competing
  concurrent.hook(async()=>{competing=await concurrent.request('POST',endpoint+'apply',concurrent.manifest)})
  const winner=await concurrent.request('POST',endpoint+'apply',concurrent.manifest)
  assert.equal(competing.status,200);assert.equal(winner.status,200);assert.equal(winner.body.history_id,competing.body.history_id);assert.deepEqual(concurrent.counts(),[1,1,1])
  const changed=await fixture();const first=await changed.request('POST',endpoint+'apply',changed.manifest)
  changed.raw.prepare("UPDATE customers SET gender='other' WHERE id=1").run()
  const current=changed.state()
  assert.equal((await changed.request('POST',`/api/action-history/${first.body.history_id}/undo`,{expected_generation:0})).status,409)
  assert.equal(changed.state(),current);assert.deepEqual(changed.counts(),[1,1,1])
  console.log('PASS actual atomic rollback: every identity field, new/secondary duplicate, deletion, injected failure, lost response, concurrent duplicate, later user edit')
  const invalid=await fixture()
  for (const manifest of [{...invalid.manifest,extra:true},{...invalid.manifest,chunk_index:999},{...invalid.manifest,rows:[...invalid.manifest.rows,invalid.manifest.rows[0]]},{...invalid.manifest,rows:invalid.manifest.rows.map((r,i)=>i? r:{...r,to_gender:'other'})}]) {
    assert.ok([400,409].includes((await invalid.request('POST',endpoint+'apply',manifest)).status));assert.deepEqual(invalid.counts(),[0,0,0])
  }
  const general=structuredClone(invalid.manifest);general.rows[0].before.name='General'
  assert.equal((await invalid.request('POST',endpoint+'apply',general)).status,400)
  console.log('PASS manifest allowlist, invalid shape/IDs/genders and General hard exclusion')
  for (const kind of ['name_phone','name_address']) {
    const t=await fixture();const original=t.state()
    t.manifest.rows[0].match={kind,key:kind==='name_phone'?'012345678':'house alpha unique'}
    const {chunk_digest,...body}=t.manifest;t.manifest.chunk_digest=await t.restoration.genderManifestDigest(body)
    t.restoration.APPROVED_GENDER_RESTORATION.chunk_digests=[t.manifest.chunk_digest]
    assert.equal((await t.request('POST',endpoint+'preview',t.manifest)).status,200)
    t.hook(()=>t.raw.prepare('UPDATE customers SET name=?,phone=?,address=? WHERE id=4').run('Alpha',kind==='name_phone'?'012345678':'012345680',kind==='name_address'?'[{"address":"House Alpha Unique"}]':null))
    assert.equal((await t.request('POST',endpoint+'apply',t.manifest)).status,409)
    assert.deepEqual(t.counts(),[0,0,0])
  }
  console.log('PASS composite name-phone/address evidence and in-transaction duplicate guards')
}
module.exports={load,fixture}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1})
