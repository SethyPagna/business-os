const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')
function load(name, dependencies={}) {
  const m={exports:{}}
  new Function('module','exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib',name+'.ts'),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText)(m,m.exports,key=>{assert.ok(key in dependencies);return dependencies[key]})
  return m.exports
}
const store=load('transferRunStore',{'./permissions':load('permissions')})
const db=new Database(':memory:')
db.pragma('foreign_keys=ON')
const dir=path.join(__dirname,'../migrations')
for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.sql')&&f<'0186_').sort()) db.exec(fs.readFileSync(path.join(dir,file),'utf8'))
db.exec("INSERT INTO products(id,name,cost_price_usd) VALUES(900001,'unchanged',3.123456)")
// Legacy pre-generation run stays frozen, never reassigned to a new generation.
db.exec("INSERT INTO transfer_runs(id,actor_id,organization_id,request_id,request_digest,request_json,scope) VALUES('legacy',7,4,'legacy-parent','old','{}','branches')")
const sql=fs.readFileSync(path.join(dir,'0186_transfer_run_retirement.sql'),'utf8')
assert.equal(sql.includes('\r'),false)
db.exec(sql)
assert.equal(db.prepare("SELECT dataset_generation FROM transfer_runs WHERE id='legacy'").get().dataset_generation,'')
const execute=statements=>db.transaction(()=>{for(const s of statements)db.prepare(s.sql).run(s.params||{})})()
const adapter={prepare(sql){return{async get(params){return db.prepare(sql).get(params||{})}}},async batchOnce(statements){execute(statements)}}
const request=(requestId)=>({requestId,requestJson:'{"quantity":0.7}',digest:'a'.repeat(64)})
async function main(){
 const initial=await store.readBusinessDatasetGeneration(adapter)
 const proof={actual:{actorId:7,organizationId:4},expected:{actorId:7,organizationId:4},datasetGeneration:initial}
 const user={id:7,organization_id:4,role_code:'admin',permissions:null,role_permissions:null}
 const target=crypto.randomUUID()
 execute(store.registerTransferRunStatements({...proof,runId:'current',scope:'branches',...request('current-parent')}))
 execute(store.sealTransferRunChunkStatements({...proof,runId:'current',revision:0,sequence:0,...request('current-child'),cursorBefore:'{}',cursorAfter:'{"done":1}',final:true}))
 const before=db.prepare('SELECT * FROM transfer_runs ORDER BY id').all()
 const input={...proof,user,kind:'reset',nextGeneration:target,maxStatements:8}
 await assert.rejects(store.retireTransferRunsForDatasetChange(adapter,{...input,user:{...user,role_code:'staff'}}),/authority/)
 await assert.rejects(store.retireTransferRunsForDatasetChange(adapter,{...input,expected:{actorId:7,organizationId:null}}),/organization/)
 await assert.rejects(store.retireTransferRunsForDatasetChange({...adapter,async batchOnce(statements){execute([...statements,{sql:'INSERT INTO branches(name) VALUES(NULL)'}])}},input),/NOT NULL/)
 assert.deepEqual(db.prepare('SELECT * FROM transfer_runs ORDER BY id').all(),before)
 assert.equal(await store.readBusinessDatasetGeneration(adapter),initial)
 assert.equal(db.prepare('SELECT COUNT(*) n FROM transfer_run_retired_keys').get().n,0)
 assert.equal(db.prepare('SELECT COUNT(*) n FROM transfer_run_lifecycle_guard').get().n,0)
 await store.retireTransferRunsForDatasetChange(adapter,input)
 assert.equal(await store.readBusinessDatasetGeneration(adapter),target)
 assert.equal(db.prepare('SELECT COUNT(*) n FROM transfer_runs').get().n,0)
 assert.equal(db.prepare('SELECT COUNT(*) n FROM transfer_run_chunks').get().n,0)
 const retired=db.prepare('SELECT * FROM transfer_run_retired_keys ORDER BY request_id').all()
 assert.equal(retired.length,3)
 assert.equal(retired.find(r=>r.request_id==='legacy-parent').dataset_generation,'')
 assert.deepEqual(JSON.parse(retired.find(r=>r.request_id==='current-parent').snapshot_json),before.find(r=>r.id==='current'))
 assert.equal(db.prepare('SELECT COUNT(*) n FROM transfer_run_lifecycle_guard').get().n,0)
 console.log('PASS authorized atomic retirement/generation, exact snapshots, legacy freeze, rollback and authority fences')
 const current={...proof,datasetGeneration:target}
 assert.throws(()=>execute(store.registerTransferRunStatements({...current,runId:'reused',scope:'branches',...request('current-parent')})),/retired/)
 assert.throws(()=>execute(store.registerTransferRunStatements({...proof,runId:'stale',scope:'branches',...request('new-stale-key')})),/generation/)
 assert.throws(()=>db.exec("DELETE FROM transfer_run_retired_keys"),/permanent/)
 assert.throws(()=>db.exec("UPDATE transfer_run_retired_keys SET request_digest='changed'"),/immutable/)
 assert.throws(()=>db.prepare("UPDATE system_flags SET value=? WHERE key='business_dataset_generation'").run(JSON.stringify({generation:crypto.randomUUID()})),/retirement/)
 assert.throws(()=>db.exec("DELETE FROM system_flags WHERE key='business_dataset_generation'"),/cannot be deleted/)
 assert.throws(()=>db.exec("INSERT OR REPLACE INTO system_flags(key,value) VALUES('business_dataset_generation','{}')"),/initialized/)
 assert.throws(()=>db.exec("INSERT INTO transfer_operation_receipts(actor_id,request_id,request_digest,request_json,status,provenance_version) VALUES(7,'current-child','a','{}','planning',1)"),/retired/)
 console.log('PASS reused numeric owner cannot reclaim retired key, stale generation rejected, internal flag and identities immutable')
 const row=retired.find(r=>r.request_id==='current-child')
 const key={actorId:row.actor_id,organizationId:row.organization_id,requestId:row.request_id,runId:row.run_id,sequence:row.sequence,datasetGeneration:row.dataset_generation,digest:row.request_digest,requestJson:row.request_json,snapshotJson:row.snapshot_json}
 const union={...current,user,keys:[key],maxStatements:6}
 await store.unionRetiredTransferKeys(adapter,union)
 assert.deepEqual(db.prepare('SELECT * FROM transfer_run_retired_keys ORDER BY request_id').all(),retired)
 await assert.rejects(store.unionRetiredTransferKeys(adapter,{...union,keys:[{...key,digest:'b'.repeat(64)}]}),/NOT NULL/)
 await assert.rejects(store.unionRetiredTransferKeys(adapter,{...union,keys:[{...key,organizationId:null}]}),/NOT NULL/)
 db.exec("INSERT INTO transfer_operation_receipts(actor_id,request_id,request_digest,request_json,provenance_version) VALUES(7,'existing-receipt','other','{}',1)")
 await assert.rejects(store.unionRetiredTransferKeys(adapter,{...union,keys:[{...key,requestId:'existing-receipt'}]}),/NOT NULL/)
 assert.deepEqual(db.prepare('SELECT * FROM transfer_run_retired_keys ORDER BY request_id').all(),retired)
 assert.equal(db.prepare('SELECT COUNT(*) n FROM transfer_run_lifecycle_guard').get().n,0)
 assert.equal(db.prepare('SELECT cost_price_usd c FROM products WHERE id=900001').get().c,3.123456)
 // Settings write/read and sync replay use settings, never this internal flag.
 db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('business_dataset_generation','spoofed')
 assert.equal(await store.readBusinessDatasetGeneration(adapter),target)
 const settings=fs.readFileSync(path.join(__dirname,'../src/routes/settings.ts'),'utf8')
 assert.ok(!settings.includes('system_flags'))
 const sync=fs.readFileSync(path.join(__dirname,'../src/routes/sync.ts'),'utf8')
 assert.match(sync,/'settings.update': \{ method: 'POST', path: '\/api\/settings' \}/)
 assert.ok(!sync.includes('system_flags'))
 console.log('PASS reservation union idempotent, digest/org collision fail-closed, flag isolated from settings/sync, precision unchanged')
 db.close()
}
main().catch(e=>{console.error(e);process.exitCode=1})
