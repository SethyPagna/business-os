// Local ephemeral actual workerd + D1. No routes, remote config, or deployment.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const ts=require('typescript'),Database=require('better-sqlite3')
const {Miniflare,Log,LogLevel}=require('miniflare')
const {unstable_splitSqlQuery:split}=require('wrangler')
const compile=file=>ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace("from './permissions'","from './permissions.js'")
const worker=`
import {D1Compat} from './db.js';
import * as kernel from './kernel.js';
export default {async fetch(request,env){
 const input=await request.json(),db=new D1Compat(env.DB);
 const row=await db.prepare("SELECT json_extract(value,'$.generation') generation FROM system_flags WHERE key='business_dataset_generation'").get();
 const proof={actual:{actorId:7,organizationId:4},expected:{actorId:7,organizationId:input.badOwner?null:4},datasetGeneration:row.generation,user:{id:7,organization_id:4,role_code:input.staff?'staff':'admin'}};
 let calls=0,error=null;
 const tracked={async batchOnce(statements){calls++;await db.batchOnce(input.rollback?[...statements,{sql:'INSERT INTO branches(name) VALUES(NULL)'}]:statements);if(input.lostack)throw new Error('lost acknowledgement')}};
 try{
  if(input.action==='retire') await kernel.retireTransferReceiptPage(tracked,{...proof,afterReceiptId:0,limit:20,maxStatements:input.budget??8});
  else if(input.action==='union') await kernel.unionRetiredTransferReceipts(tracked,{...proof,records:input.records,maxStatements:100});
  else await kernel.restoreRetiredTransferReceipts(tracked,{...proof,records:input.records,maintenanceToken:input.token,sourceId:input.source??'immutable-fixture',sourceDigest:'a'.repeat(64),maxStatements:100});
 }catch(e){error=e.message}
 return Response.json({error,calls});
}};
`
async function main(){
 console.log('ENGINES',JSON.stringify({node:process.version,workerd:require('workerd/package.json').version,miniflare:require('miniflare/package.json').version,wrangler:require('wrangler/package.json').version}))
 const dir=path.join(__dirname,'../migrations'),sqlite=new Database(':memory:')
 for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.sql')&&f<'0185_').sort())sqlite.exec(fs.readFileSync(path.join(dir,file),'utf8'))
 const schema=sqlite.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT IN (SELECT name FROM pragma_table_list WHERE type='shadow') ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid").all();sqlite.close()
 const mf=new Miniflare({modules:[{type:'ESModule',path:'entry.js',contents:worker},{type:'ESModule',path:'kernel.js',contents:compile('transferReceiptRetirement.ts')},...['db','permissions'].map(n=>({type:'ESModule',path:n+'.js',contents:compile(n+'.ts')}))],compatibilityDate:'2026-08-01',d1Databases:['DB'],log:new Log(LogLevel.ERROR)})
 try{
  const db=await mf.getD1Database('DB')
  for(let i=0;i<schema.length;i+=25)await db.batch(schema.slice(i,i+25).map(r=>db.prepare(r.sql)))
  for(const file of ['0185_transfer_runs.sql','0186_transfer_run_retirement.sql','0188_transfer_receipt_retirement.sql']){
   const sql=fs.readFileSync(path.join(dir,file),'utf8');assert.equal(sql.includes('\r'),false);await db.batch(split(sql).map(s=>db.prepare(s)))
  }
  const token=crypto.randomUUID()
  await db.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance',?)").bind(JSON.stringify({mode:'restore',token,backupKey:'immutable-fixture'})).run()
  await db.batch([
   db.prepare("INSERT INTO transfer_operation_receipts(id,actor_id,request_id,request_digest,request_json,response_json,provenance_version) VALUES(401,17,'legacy-key','raw legacy digest',' { raw historical text } ',NULL,0)"),
   db.prepare("INSERT INTO transfer_operation_receipts(id,actor_id,request_id,request_digest,request_json,response_json,provenance_version,operation_id,replay_state) VALUES(402,17,'modern-key','modern digest','{}',json_object('cost',3.123456),1,'operation402','applied')"),
   db.prepare("INSERT INTO transfer_operation_members(receipt_id,ordinal,source_product_id,destination_product_id,source_branch_id,destination_branch_id,quantity,untracked_quantity,source_snapshot,destination_snapshot,allocations_json) VALUES(402,0,1,2,1,2,0.7,0.7,'{\"cost\":3.123456}','{}','[]')"),
  ])
  const rows=async sql=>(await db.prepare(sql).all()).results
  const receipts=await rows('SELECT * FROM transfer_operation_receipts ORDER BY id'),members=await rows('SELECT * FROM transfer_operation_members')
  const records=[]
  for(const row of await rows('SELECT * FROM transfer_receipt_retirement_rows ORDER BY id')) records.push({receiptJson:row.snapshot_json,memberJsons:(await rows('SELECT snapshot_json FROM transfer_receipt_member_retirement_rows WHERE receipt_id='+row.id)).map(m=>m.snapshot_json)})
  async function invoke(body){const response=await mf.dispatchFetch('http://local-legacy.test/',{method:'POST',body:JSON.stringify({...body,token})});assert.equal(response.status,200,await response.clone().text());return response.json()}
  await assert.rejects(db.prepare('DELETE FROM transfer_operation_receipts WHERE id=401').run(),/exact receipt retirement/)
  for(const extra of [{staff:true},{badOwner:true},{budget:7},{rollback:true}]){
   const result=await invoke({action:'retire',...extra});assert.ok(result.error);assert.equal(result.calls,extra.rollback?1:0)
   assert.equal((await db.prepare('SELECT COUNT(*) n FROM transfer_retired_receipt_keys').first()).n,0)
  }
  const retiredAck=await invoke({action:'retire',lostack:true});assert.match(retiredAck.error,/lost acknowledgement/);assert.equal(retiredAck.calls,1)
  assert.equal((await invoke({action:'retire'})).error,null)
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM transfer_runs').first()).n,0)
  assert.deepEqual(await rows('SELECT * FROM transfer_operation_receipts ORDER BY id'),receipts)
  assert.deepEqual(await rows('SELECT * FROM transfer_operation_members'),members)
  assert.equal((await invoke({action:'union',records:[records[0]]})).error,null)
  for(const change of [{response_json:'{"changed":1}'},{provenance_version:1},{organization_id:4},{actor_id:99}]){
   const receiptJson=JSON.stringify({...JSON.parse(records[0].receiptJson),...change})
   assert.ok((await invoke({action:'union',records:[{receiptJson,memberJsons:[]}]})).error)
  }
  assert.ok((await invoke({action:'union',records:[{...records[1],memberJsons:[]}]})).error)
  const badMember=JSON.stringify({...JSON.parse(records[1].memberJsons[0]),source_snapshot:'{"cost":99}'})
  assert.ok((await invoke({action:'union',records:[{...records[1],memberJsons:[badMember]}]})).error)
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM transfer_retired_receipt_keys').first()).n,2)
  assert.deepEqual(await rows('SELECT * FROM transfer_operation_receipts ORDER BY id'),receipts)
  assert.deepEqual(await rows('SELECT * FROM transfer_operation_members'),members)
  await db.batch([db.prepare('DELETE FROM transfer_operation_members'),db.prepare('DELETE FROM transfer_operation_receipts')])
  await assert.rejects(db.prepare("INSERT INTO transfer_operation_receipts(actor_id,request_id,request_digest,request_json,provenance_version) VALUES(17,'legacy-key','different','{}',1)").run(),/permanently retired/)
  await assert.rejects(db.prepare("INSERT INTO transfer_runs(id,actor_id,request_id,request_digest,request_json,scope,dataset_generation) SELECT 'reused-run',17,'legacy-key','a','{}','branches',json_extract(value,'$.generation') FROM system_flags WHERE key='business_dataset_generation'").run(),/permanently retired/)
  await assert.rejects(db.prepare('DELETE FROM transfer_retired_receipt_keys').run(),/permanent/)
  assert.ok((await invoke({action:'restore',records,source:'replaced-fixture'})).error)
  assert.ok((await invoke({action:'restore',records:[{...records[1],memberJsons:[badMember]}]})).error)
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM transfer_operation_receipts').first()).n,0)
  assert.ok((await invoke({action:'restore',records,rollback:true})).error)
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM transfer_operation_receipts').first()).n,0)
  const lost=await invoke({action:'restore',records,lostack:true});assert.match(lost.error,/lost acknowledgement/);assert.equal(lost.calls,1)
  assert.deepEqual(await rows('SELECT * FROM transfer_operation_receipts ORDER BY id'),receipts)
  assert.deepEqual(await rows('SELECT * FROM transfer_operation_members'),members)
  assert.equal((await invoke({action:'restore',records})).error,null)
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM transfer_operation_receipts').first()).n,2)
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM transfer_receipt_lifecycle_guard').first()).n,0)
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM transfer_receipt_restore_allowance').first()).n,0)
  // A validated older replay state may coexist as evidence, without overwriting
  // the permanent key, receipt identity or allocation snapshots.
  const older={...records[1],receiptJson:JSON.stringify({...JSON.parse(records[1].receiptJson),generation:1,replay_state:'reversed'})}
  assert.equal((await invoke({action:'union',records:[older]})).error,null)
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM transfer_retired_receipt_snapshots WHERE request_id='modern-key'").first()).n,2)
  await assert.rejects(db.prepare("UPDATE transfer_operation_receipts SET generation=generation+1,replay_state='reversed' WHERE id=402").run(),/retired receipt/)
  console.log('PASS actual D1 legacy/null/zero raw evidence, no-run retirement, old subset union retains newer keys, owner/provenance/response conflicts, guarded delete, exact restore, rollback and single-attempt lost-ack')
 }finally{await mf.dispose()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
