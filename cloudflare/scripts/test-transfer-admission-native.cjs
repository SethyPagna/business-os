// Local executable admission prototype; synthetic stock effects, not route certification.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),Database=require('better-sqlite3')
const {Miniflare,Log,LogLevel}=require('miniflare'),{unstable_splitSqlQuery:split}=require('wrangler')
const compile=file=>ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib',file+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replaceAll("from './permissions'","from './permissions.js'")
const worker=`
import {D1Compat} from './db.js';import * as admission from './admission.js';import * as retirement from './retirement.js';import * as runs from './runs.js';import * as maintenance from './maintenance.js';
export default {async fetch(request,env){
 const i=await request.json(),user=i.user??7;let calls=0,error=null,result=null;
 const raw={prepare(sql){return env.DB.prepare(sql)},async batch(statements){calls++;
  if(i.before==='maintenance')await env.DB.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance',json_object('mode','restore','token','racing','backupKey','fixture'))").run();
  if(i.before==='permission')await env.DB.prepare("UPDATE users SET permissions=json_object('branches',json('false')) WHERE id=7").run();
  const answer=await env.DB.batch(i.rollback?[...statements,env.DB.prepare('INSERT INTO branches(name) VALUES(NULL)')]:statements);
  if(i.lostack)throw new Error('lost acknowledgement');return answer;
 }};
 const db=new D1Compat(raw),principal={actorId:user,organizationId:4};
 if(i.readRace){
  const prepare=db.prepare.bind(db);let fired=false;
  db.prepare=sql=>{const statement=prepare(sql),get=statement.get.bind(statement);
   statement.get=async params=>{
    if(!fired&&sql.includes(i.readRace==='final'?'FROM transfer_history_bindings b JOIN':'FROM transfer_owner_admissions o')){
     fired=true;const raceDb=new D1Compat(env.DB),admin={actorId:8,organizationId:4};
     await retirement.retireTransferReceiptPage(raceDb,{actual:admin,expected:admin,datasetGeneration:await runs.readBusinessDatasetGeneration(raceDb),user:{id:8,organization_id:4,role_code:'admin'},afterReceiptId:6000,limit:1,maxStatements:8});
    }
    return get(params);
   };return statement;
  };
 }
 try{
  if(i.action==='read')result=await admission.readAdmittedTransferResponse(db,{...principal,requestId:i.key});
  else if(i.action==='retire'){
   const generation=await runs.readBusinessDatasetGeneration(db);await retirement.retireTransferReceiptPage(db,{actual:principal,expected:principal,datasetGeneration:generation,user:{id:user,organization_id:4,role_code:'admin'},afterReceiptId:i.after,limit:1,maxStatements:8});
  }else if(i.action==='rotate'){
   const generation=await runs.readBusinessDatasetGeneration(db);await runs.retireTransferRunsForDatasetChange(db,{actual:principal,expected:principal,datasetGeneration:generation,user:{id:user,organization_id:4,role_code:'admin'},kind:'restore',nextGeneration:i.next,maxStatements:8});
  }else if(i.action==='restore'){
   const generation=await runs.readBusinessDatasetGeneration(db);await retirement.restoreRetiredTransferReceipts(db,{actual:principal,expected:principal,datasetGeneration:generation,user:{id:user,organization_id:4,role_code:'admin'},records:i.records,maintenanceToken:i.token,sourceId:'fixture',sourceDigest:'a'.repeat(64),maxStatements:50});
  }else if(i.action==='bind')await admission.bindRestoredTransferHistory(db,{...principal,operationId:i.op,maintenanceToken:i.token,sourceId:'fixture',maxStatements:20});
  else if(i.action==='begin')result=await maintenance.beginMaintenance(env,{backupKey:'fixture',startedBy:'native'});
  else if(i.action==='end')result=await maintenance.endMaintenance(env,i.token);
  else if(i.action==='new'){
   const payload=JSON.stringify({applier:'stock.transfer',operation_id:'new-op',generation:0,permission:'branches'});
   await admission.commitAdmittedTransfer(db,{...principal,operationId:'new-op',requestId:'new-key',scope:'branches',maxStatements:30,effects:[
    {sql:"INSERT INTO action_history(id,scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_id) VALUES(6001,'branches','stock_transfer','new-op','new',1,'undoable',@payload,@payload,7)",params:{payload}},
    {sql:"INSERT INTO transfer_operation_receipts(id,actor_id,request_id,request_digest,request_json,status,operation_id,provenance_version,action_history_id,replay_state) VALUES(6001,7,'new-key','digest','{}','planning','new-op',1,6001,'applied')"},
    {sql:"INSERT INTO transfer_operation_members(receipt_id,ordinal,source_product_id,destination_product_id,source_branch_id,destination_branch_id,quantity,untracked_quantity,source_snapshot,destination_snapshot,allocations_json) VALUES(6001,0,1,1,1,2,1,1,'{}','{}','[]')"},
    {sql:"UPDATE transfer_operation_receipts SET status='committed',response_json=json_object('cost',3.123456) WHERE id=6001"},
   ]});result='new';
  }else result=await admission.executeBoundTransferHistory(db,{...principal,operationId:i.op??'op1',direction:i.direction??'undo',expectedGeneration:i.generation??0,maxStatements:20,effects:[{sql:'UPDATE native_stock SET quantity=quantity+@delta',params:{delta:(i.direction??'undo')==='undo'?1:-1}}]});
 }catch(e){error=e.message}
 return Response.json({calls,error,result});
}};
`
async function main(){
 console.log('ENGINES',JSON.stringify({node:process.version,workerd:require('workerd/package.json').version,miniflare:require('miniflare/package.json').version}))
 const dir=path.join(__dirname,'../migrations'),sqlite=new Database(':memory:')
 for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.sql')&&f<'0185_').sort())sqlite.exec(fs.readFileSync(path.join(dir,file),'utf8'))
 const schema=sqlite.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT IN (SELECT name FROM pragma_table_list WHERE type='shadow') ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid").all();sqlite.close()
 const mf=new Miniflare({modules:[{type:'ESModule',path:'entry.js',contents:worker},...Object.entries({db:'db',permissions:'permissions',admission:'transferAdmission',retirement:'transferReceiptRetirement',runs:'transferRunStore',maintenance:'maintenance'}).map(([name,file])=>({type:'ESModule',path:name+'.js',contents:compile(file)}))],compatibilityDate:'2026-08-01',d1Databases:['DB'],log:new Log(LogLevel.ERROR)})
 try{
  const db=await mf.getD1Database('DB')
  for(let n=0;n<schema.length;n+=25)await db.batch(schema.slice(n,n+25).map(r=>db.prepare(r.sql)))
  for(const file of ['0185_transfer_runs.sql','0186_transfer_run_retirement.sql','0188_transfer_receipt_retirement.sql'])await db.batch(split(fs.readFileSync(path.join(dir,file),'utf8')).map(s=>db.prepare(s)))
  const token=crypto.randomUUID()
  await db.batch([
   db.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance',json_object('mode','restore','token',?,'backupKey','fixture'))").bind(token),
   db.prepare("INSERT INTO roles(id,name,code) VALUES(1,'Staff','staff'),(2,'Admin','admin')"),
   db.prepare("INSERT INTO users(id,username,name,password,role_id,organization_id,permissions) VALUES(7,'employee','Employee','x',1,4,'{\"branches\":true}'),(8,'administrator','Admin','x',2,4,'{}'),(9,'auditor','Auditor','x',1,4,'{\"branches\":true,\"audit_log\":true}')"),
   db.prepare('CREATE TABLE native_stock(quantity REAL,cost REAL)'),db.prepare('INSERT INTO native_stock VALUES(20,3.123456)'),
  ])
  const count=500
  await db.batch([
   db.prepare(`WITH RECURSIVE n(x) AS(VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<${count}) INSERT INTO action_history(id,scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_id)
    SELECT x,'branches','stock_transfer','op'||x,'legacy',1,'undoable',json_object('applier','stock.transfer','operation_id','op'||x,'generation',0,'permission','branches'),json_object('applier','stock.transfer','operation_id','op'||x,'generation',0,'permission','branches'),7 FROM n`),
   db.prepare(`INSERT INTO transfer_operation_receipts(id,actor_id,request_id,request_digest,request_json,response_json,operation_id,provenance_version,action_history_id,replay_state) SELECT id,7,'key'||id,'digest','{}',json_object('cost',3.123456),'op'||id,1,id,'applied' FROM action_history`),
   db.prepare("INSERT INTO transfer_operation_members(receipt_id,ordinal,source_product_id,destination_product_id,source_branch_id,destination_branch_id,quantity,untracked_quantity,source_snapshot,destination_snapshot,allocations_json) SELECT id,0,1,1,1,2,1,1,'{}','{}','[]' FROM transfer_operation_receipts"),
   db.prepare("INSERT INTO transfer_operation_receipts(actor_id,request_id,request_digest,request_json,provenance_version) VALUES(7,'old-v0','raw','{}',0),(7,'incomplete','raw','{}',1)"),
  ])
  const migration=fs.readFileSync(path.join(dir,'0189_transfer_admission.sql'),'utf8');assert.equal(migration.includes('\r'),false)
  await db.prepare("DELETE FROM system_flags WHERE key='maintenance'").run()
  await assert.rejects(db.batch(split(migration).map(s=>db.prepare(s))),/NOT NULL/)
  await db.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance',json_object('mode','restore','token',?,'backupKey','fixture'))").bind(token).run()
  // An already-admitted legacy atomic undo wins before installation: capture
  // its complete new head, not a stale preflight SELECT made earlier.
  await db.batch([db.prepare("UPDATE transfer_operation_receipts SET generation=1,replay_state='reversed' WHERE id=499"),
   db.prepare("UPDATE action_history SET status='redoable',undo_payload=json_set(undo_payload,'$.generation',1),redo_payload=json_set(redo_payload,'$.generation',1) WHERE id=499")])
  const start=Date.now(),capture=await db.batch(split(migration).map(s=>db.prepare(s)))
  console.log('CAPTURE',JSON.stringify({receipts:count+2,members:count,statements:capture.length,elapsedMs:Date.now()-start,rowsRead:capture.reduce((n,r)=>n+(r.meta.rows_read||0),0),rowsWritten:capture.reduce((n,r)=>n+(r.meta.rows_written||0),0)}))
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM transfer_history_bindings').first()).n,count)
  assert.equal((await db.prepare("SELECT generation FROM transfer_execution_heads WHERE binding_id='install:op499'").first()).generation,1)
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM transfer_install_dispositions WHERE disposition='unverifiable_exact_bundle'").first()).n,1)
  await assert.rejects(db.prepare("UPDATE transfer_operation_receipts SET generation=1,replay_state='reversed' WHERE id=1").run(),/maintenance|private replay/)
  async function invoke(body){const response=await mf.dispatchFetch('http://local-admission.test/',{method:'POST',body:JSON.stringify(body)});assert.equal(response.status,200,await response.clone().text());return response.json()}
  assert.equal((await invoke({action:'end',token})).result,true)
  const stock=()=>db.prepare('SELECT * FROM native_stock').first()
  assert.ok((await invoke({rollback:true})).error);assert.equal((await stock()).quantity,20)
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM transfer_execution_guard').first()).n,0)
  assert.ok((await invoke({before:'maintenance'})).error);assert.equal((await stock()).quantity,20)
  await db.prepare("DELETE FROM system_flags WHERE key='maintenance'").run()
  assert.ok((await invoke({before:'permission'})).error);assert.equal((await stock()).quantity,20)
  await db.prepare("UPDATE users SET permissions='{\"branches\":true}' WHERE id=7").run()
  const lost=await invoke({lostack:true});assert.match(lost.error,/lost acknowledgement/);assert.equal(lost.calls,1);assert.equal((await stock()).quantity,21)
  assert.equal((await invoke({})).result,'already-applied');assert.equal((await stock()).quantity,21)
  await db.prepare("UPDATE users SET permissions='{\"branches\":false}' WHERE id=7").run()
  assert.ok((await invoke({})).error)
  await db.prepare("UPDATE users SET permissions='{\"branches\":true}' WHERE id=7").run()
  assert.equal((await invoke({direction:'redo',generation:1})).result,'committed');assert.equal((await stock()).quantity,20)
  // Exact delete/reinsert of the principal cannot revive the former self grant.
  const principal=await db.prepare('SELECT * FROM users WHERE id=7').first(),columns=Object.keys(principal)
  await db.batch([db.prepare('DELETE FROM users WHERE id=7'),db.prepare(`INSERT INTO users(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).bind(...columns.map(k=>principal[k]))])
  assert.ok((await invoke({generation:2})).error)
  assert.equal((await invoke({user:8,generation:2})).result,'committed')
  assert.equal((await invoke({action:'new'})).result,'new')
  assert.equal((await invoke({action:'read',key:'new-key'})).result.cost,3.123456)
  assert.ok((await invoke({action:'read',key:'key1'})).error)
  const racedRead=await invoke({action:'read',key:'new-key',readRace:process.env.ADMISSION_RACE_STAGE??'owner'})
  assert.ok(racedRead.error,'retirement between initial lookup and final response admission must deny disclosure')
  assert.equal(racedRead.result,null)
  assert.ok((await invoke({action:'read',key:'new-key'})).error)
  assert.equal((await invoke({op:'new-op'})).result,'committed')
  assert.ok((await invoke({action:'read',key:'new-key'})).error)
  // Restore an exact retired bundle under a new dataset. No restored self grant.
  const begun=await invoke({action:'begin',user:8});assert.equal(begun.error,null);const restoreToken=begun.result.token
  await assert.rejects(db.prepare("UPDATE transfer_operation_receipts SET generation=2,replay_state='applied' WHERE id=6001").run(),/maintenance|private replay|exact authorized/)
  await db.prepare("INSERT INTO transfer_operation_members(receipt_id,ordinal,source_product_id,destination_product_id,source_branch_id,destination_branch_id,quantity,untracked_quantity,source_snapshot,destination_snapshot,allocations_json) SELECT receipt_id,1,source_product_id,destination_product_id,source_branch_id,destination_branch_id,quantity,untracked_quantity,source_snapshot,destination_snapshot,allocations_json FROM transfer_operation_members WHERE receipt_id=3 AND ordinal=0").run()
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM transfer_binding_invalidations WHERE binding_id='install:op3' AND scope='bundle'").first()).n,1)
  await db.batch([db.prepare("UPDATE action_history SET entity_id='changed' WHERE id=5"),db.prepare("UPDATE action_history SET entity_id='op5' WHERE id=5")])
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM transfer_binding_invalidations WHERE binding_id='install:op5' AND scope='bundle'").first()).n,1)
  assert.equal((await invoke({action:'retire',user:8,after:1})).error,null)
  const receipt=await db.prepare('SELECT snapshot_json FROM transfer_receipt_retirement_rows WHERE id=2').first()
  const memberRows=(await db.prepare('SELECT snapshot_json FROM transfer_receipt_member_retirement_rows WHERE receipt_id=2').all()).results
  const records=[{receiptJson:receipt.snapshot_json,memberJsons:memberRows.map(m=>m.snapshot_json)}]
  await db.batch([db.prepare('DELETE FROM transfer_operation_members WHERE receipt_id=2'),db.prepare('DELETE FROM transfer_operation_receipts WHERE id=2')])
  assert.equal((await invoke({action:'restore',user:8,token:restoreToken,records})).error,null)
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM transfer_binding_invalidations WHERE binding_id='install:op2' AND scope='bundle'").first()).n,1)
  assert.ok((await invoke({action:'bind',user:8,token:restoreToken,op:'op2'})).error,'unrotated restore cannot replace baseline')
  assert.equal((await invoke({action:'rotate',user:8,next:crypto.randomUUID()})).error,null)
  assert.equal((await invoke({action:'bind',user:8,token:restoreToken,op:'op2'})).error,null)
  assert.equal((await invoke({action:'end',token:restoreToken})).result,true)
  assert.ok((await invoke({op:'op2'})).error)
  assert.equal((await invoke({op:'op2',user:8})).result,'committed')
  assert.ok((await invoke({op:'op2'})).error,'noop must not grant former numeric owner access')
  assert.equal((await invoke({op:'op2',user:9,direction:'redo',generation:1})).result,'committed')
  assert.ok((await invoke({action:'read',key:'key2'})).error)
  assert.equal((await stock()).cost,3.123456)
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM transfer_execution_guard').first()).n,0)
  const race=await Promise.all([invoke({action:'begin'}),invoke({action:'begin'})]);assert.equal(race.filter(r=>r.error===null).length,1)
  const winner=race.find(r=>r.error===null).result.token
  assert.equal((await invoke({action:'end',token:'wrong'})).result,false)
  assert.equal((await invoke({action:'end',token:winner})).result,true)
  console.log('PASS native installation/head race fencing, legacy self undo/redo, rollback/lostACK/noop authority, principal reuse, new-only retry ownership, retirement, restored cross-user-only execution and maintenance CAS')
 }finally{await mf.dispose()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
