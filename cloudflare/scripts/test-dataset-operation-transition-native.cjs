// Actual local D1; no remote data/config. Full post-migration schema plus actual
// finalized0185/0186/0188/0190/0191 migrations, not historical seed certification.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const SQLite=require('better-sqlite3'),{build}=require('esbuild')
const {Miniflare,Log,LogLevel}=require('miniflare'),{unstable_splitSqlQuery:split}=require('wrangler')
const root=path.join(__dirname,'..')
async function main(){
 const bundle=await build({stdin:{resolveDir:root,loader:'ts',contents:`
 import * as journal from './src/lib/datasetOperationStore.ts';
 import {retireTransferReceiptPage} from './src/lib/transferReceiptRetirement.ts';
 import {D1Compat} from './src/lib/db.ts';
 export default{async fetch(request,env){const input=await request.json();let batches=0;
 const db={prepare:sql=>env.DB.prepare(sql),batch:async statements=>{batches++;
   if(input.beforeBatch)await env.DB.prepare(input.beforeBatch.sql).bind(...input.beforeBatch.params).run();
   if(Number.isInteger(input.failBoundary))statements.splice(input.failBoundary,0,env.DB.prepare('INSERT INTO branches(name)VALUES(NULL)'));
   const result=await env.DB.batch(statements);if(input.loseAck)throw new Error('lost acknowledgement');return result;}};
 try{let result;
 if(input.action==='begin')result=await journal.beginDatasetOperation(db,input.value);
 else if(input.action==='archive')result=await retireTransferReceiptPage(new D1Compat(env.DB),input.value);
 else if(input.action==='chunk')result=await journal.executeDatasetChunk(db,input.value);
 else result=await journal.transitionDatasetGeneration(db,input.value);
 return Response.json({result,batches});}catch(error){return Response.json({error:error.message,batches},{status:409})}
 }};`},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'})
 const source=new SQLite(':memory:'),dir=path.join(root,'migrations')
 for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.sql')&&f<'0185_').sort())source.exec(fs.readFileSync(path.join(dir,file),'utf8'))
 const schema=source.prepare("SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT IN(SELECT name FROM pragma_table_list WHERE type='shadow') ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid").all();source.close()
 const mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-08-01',d1Databases:['DB'],log:new Log(LogLevel.ERROR)})
 try{
  const db=await mf.getD1Database('DB')
  for(let i=0;i<schema.length;i+=25)await db.batch(schema.slice(i,i+25).map(r=>db.prepare(r.sql)))
  for(const file of ['0185_transfer_runs.sql','0186_transfer_run_retirement.sql','0188_transfer_receipt_retirement.sql','0190_dataset_operation_journal.sql','0191_dataset_operation_generation_transition.sql']){
   const sql=fs.readFileSync(path.join(dir,file),'utf8');assert.equal(sql.includes('\r'),false);await db.batch(split(sql).map(sql=>db.prepare(sql)))
  }
  await db.prepare("INSERT INTO roles(id,name,code,permissions)VALUES(1,'Admin','admin','{}')").run()
  const call=async body=>{const r=await mf.dispatchFetch('http://local.test',{method:'POST',body:JSON.stringify(body)});return {status:r.status,...await r.json()}}
  const rows=async sql=>(await db.prepare(sql).all()).results
  const generation=async()=>JSON.parse((await db.prepare("SELECT value FROM system_flags WHERE key='business_dataset_generation'").first()).value).generation
  let actorId=0
  async function setup(){
   const id=++actorId,token=crypto.randomUUID()
   await db.prepare("INSERT INTO users(id,name,username,password,role_id,permissions,is_active)VALUES(?,'Admin',?,'hash',1,'{}',1)").bind(id,'admin'+id).run()
   const maintenance=JSON.stringify({mode:'restore',token,backupKey:'sales-reset',startedAt:'2026-09-21T00:00:00Z',startedBy:'admin'+id,updatedAt:'2026-09-21T00:00:00Z',phase:'deleting'})
   await db.prepare("INSERT INTO system_flags(key,value)VALUES('maintenance',?) ON CONFLICT(key)DO UPDATE SET value=excluded.value").bind(maintenance).run()
   const owner={actorId:id,organizationId:null,requestId:'reset-'+id,kind:'reset',source:{key:'sales-reset',version:'v1',sha256:'a'.repeat(64)},request:{scope:'sales'},maintenanceToken:token,datasetGeneration:await generation(),initialPhase:'retirement'}
   const started=await call({action:'begin',value:owner});assert.equal(started.status,200,started.error)
   const op=started.result,plan={actorId:id,organizationId:null,operationId:op.id,epoch:op.epoch,sequence:0,phase:'retirement',cursor:{},nextPhase:'deleting',nextCursor:{table:'transfer_operation_members'}}
   return {owner,op,plan,maintenance}
  }
  const first=await setup()
  await db.batch([
   db.prepare("INSERT INTO transfer_operation_receipts(id,actor_id,request_id,request_digest,request_json,provenance_version)VALUES(401,17,'old-a','digest','{}',0)"),
   db.prepare("INSERT INTO transfer_operation_receipts(id,actor_id,request_id,request_digest,request_json,provenance_version)VALUES(402,17,'old-b','digest','{}',0)"),
   db.prepare("INSERT INTO transfer_operation_members(receipt_id,ordinal,source_product_id,destination_product_id,source_branch_id,destination_branch_id,quantity,untracked_quantity,source_snapshot,destination_snapshot,allocations_json)VALUES(402,0,1,2,1,2,2,2,'{\"cost\":1.2345}','{}','[]')")
  ])
  const initialGeneration=await generation(),liveReceipts=await rows('SELECT * FROM transfer_operation_receipts ORDER BY id'),liveMembers=await rows('SELECT * FROM transfer_operation_members')
  assert.equal((await call({value:first.plan})).status,409,'no archive blocks rotation')
  const identity={actorId:first.owner.actorId,organizationId:null},proof={actual:identity,expected:identity,datasetGeneration:initialGeneration,user:{id:identity.actorId,organization_id:null,role_code:'admin'},afterReceiptId:0,limit:1,maxStatements:8}
  assert.equal((await call({action:'archive',value:proof})).status,200)
  assert.equal((await call({value:first.plan})).status,409,'partial archive blocks rotation')
  assert.equal((await call({action:'archive',value:{...proof,afterReceiptId:401}})).status,200)
  const archived=await rows('SELECT * FROM transfer_retired_receipt_members')
  assert.match(archived[0].snapshot_json,/1\.2345/)
  // All ten failure injection positions, including after final guard cleanup.
  for(let failBoundary=0;failBoundary<=9;failBoundary++){
   const result=await call({value:first.plan,failBoundary});assert.equal(result.status,409);assert.equal(result.batches,1)
   assert.equal(await generation(),initialGeneration)
   assert.equal((await db.prepare('SELECT COUNT(*) n FROM dataset_operation_generation_transitions').first()).n,0)
   assert.equal((await db.prepare('SELECT COUNT(*) n FROM dataset_operation_chunks').first()).n,0)
   assert.equal((await db.prepare('SELECT COUNT(*) n FROM dataset_operation_fence').first()).n,0)
   assert.equal((await db.prepare('SELECT COUNT(*) n FROM transfer_run_lifecycle_guard').first()).n,0)
   assert.deepEqual(await rows('SELECT * FROM transfer_operation_receipts ORDER BY id'),liveReceipts)
  }
  const lost=await call({value:first.plan,loseAck:true});assert.equal(lost.status,409);assert.equal(lost.batches,1)
  const advanced=await generation();assert.notEqual(advanced,initialGeneration)
  const replay=await call({value:first.plan});assert.equal(replay.status,200,replay.error);assert.equal(replay.batches,0);assert.equal(replay.result.generation,advanced)
  assert.equal((await call({value:{...first.plan,nextPhase:'different'}})).status,409)
  assert.deepEqual(await rows('SELECT * FROM transfer_operation_receipts ORDER BY id'),liveReceipts)
  assert.deepEqual(await rows('SELECT * FROM transfer_operation_members'),liveMembers)
  assert.equal((await db.prepare('SELECT dataset_generation FROM dataset_operations WHERE id=?').bind(first.op.id).first()).dataset_generation,initialGeneration)
  await assert.rejects(db.prepare('UPDATE dataset_operation_generation_transitions SET generation_after=?').bind(initialGeneration).run())
  await assert.rejects(db.prepare('DELETE FROM dataset_operation_generation_transitions').run())
  await assert.rejects(db.prepare('INSERT OR REPLACE INTO dataset_operation_generation_transitions SELECT * FROM dataset_operation_generation_transitions').run())
  // Real next phases: delete archived live rows in bounded pages, with lost ACK.
  let sequence=1,cursor=first.plan.nextCursor
  for(const [table,key,ids] of [['transfer_operation_members','receipt_id',[402]],['transfer_operation_receipts','id',[401,402]]]){
   for(const id of ids){const nextCursor={table,id},plan={...first.plan,sequence,phase:'deleting',cursor,nextPhase:'deleting',nextCursor,final:false,effects:[{sql:`DELETE FROM ${table} WHERE ${key}=?`,params:[id],maxChangedRows:1}]}
    assert.equal((await call({action:'chunk',value:plan,loseAck:true})).status,409)
    const retried=await call({action:'chunk',value:plan});assert.equal(retried.status,200,retried.error);assert.equal(retried.batches,0)
    sequence++;cursor=nextCursor
   }
  }
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM transfer_operation_receipts').first()).n,0)
  assert.deepEqual(await rows('SELECT * FROM transfer_retired_receipt_members'),archived)
  await assert.rejects(db.prepare("INSERT INTO transfer_operation_receipts(actor_id,request_id,request_digest,request_json)VALUES(17,'old-b','new','{}')").run(),/retired/)
  assert.equal((await call({value:first.plan})).status,200,'rotation replay remains valid after paged deletes')
  assert.equal((await call({value:{...first.plan,sequence,phase:'deleting',cursor}})).status,409,'second rotation in same operation forbidden')
  // Fresh actor/owner per case. Prior operation/head never silently reused.
  for(const failure of ['owner','corrupt','principal','position']){
   const {plan,maintenance,owner}=await setup()
   const beforeBatch=failure==='owner'?{sql:"UPDATE system_flags SET value=? WHERE key='maintenance'",params:[maintenance.replace(owner.maintenanceToken,crypto.randomUUID())]}
    :failure==='corrupt'?{sql:"UPDATE system_flags SET value=? WHERE key='maintenance'",params:[JSON.stringify({mode:'restore',token:owner.maintenanceToken})]}
    :failure==='principal'?{sql:'UPDATE users SET is_active=0 WHERE id=?',params:[owner.actorId]}:undefined
   const prior=await generation(),result=await call({value:failure==='position'?{...plan,sequence:99}:plan,beforeBatch})
   assert.equal(result.status,409,failure);assert.equal(await generation(),prior)
  }
  const last=await setup(),attempts=await Promise.all([call({value:last.plan}),call({value:last.plan})])
  assert.ok(attempts.some(r=>r.status===200));assert.equal((await db.prepare('SELECT COUNT(*) n FROM dataset_operation_generation_transitions WHERE operation_id=?').bind(last.op.id).first()).n,1)
  assert.equal((await call({value:first.plan})).status,409,'superseded head/generation cannot replay old operation')
  const now=await generation()
  await assert.rejects(db.batch([
   db.prepare("INSERT INTO transfer_run_lifecycle_guard VALUES(1,'test','reset',?,?)").bind(now,initialGeneration),
   db.prepare("UPDATE system_flags SET value=json_object('generation',?) WHERE key='business_dataset_generation'").bind(initialGeneration),
   db.prepare('DELETE FROM transfer_run_lifecycle_guard')
  ]),'consumed generation cannot return')
  assert.equal(await generation(),now)
  // Actual FK rejects orphan creation before it can poison completion proof.
  await assert.rejects(db.prepare("INSERT INTO transfer_operation_members(receipt_id,ordinal,source_product_id,destination_product_id,source_branch_id,destination_branch_id,quantity,untracked_quantity,source_snapshot,destination_snapshot,allocations_json)VALUES(999999,0,1,2,1,2,1,1,'{}','{}','[]')").run())
  const pending=await setup()
  await db.prepare("INSERT INTO transfer_runs(id,actor_id,request_id,request_digest,request_json,scope,dataset_generation)VALUES('pending-run',?,'pending-request',?,'{}','branches',?)").bind(pending.owner.actorId,'b'.repeat(64),await generation()).run()
  assert.equal((await call({value:pending.plan})).status,409,'live unretired run blocks transition')
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM transfer_runs').first()).n,1)
  console.log('PASS native nonempty archive -> atomic generation transition -> paged deletes, lost ACK, ten rollback boundaries, current authority, contention, immutable evidence and generation ABA')
 }finally{await mf.dispose()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
