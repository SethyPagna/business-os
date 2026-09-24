// Local ephemeral workerd/D1 only. Applies actual proposed 0185 + 0186 SQL.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')
const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib',file),'utf8'), {
  compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},
}).outputText.replace(/from '\.\/(permissions|db|importMaintenanceFence)'/g, "from './$1.js'")
const worker = `
import {D1Compat} from './db.js';
import * as store from './store.js';
export default {async fetch(request,env) {
 const {mode,generation,nextGeneration} = await request.json();
 const db=new D1Compat(env.DB);
 const current=await store.readBusinessDatasetGeneration(db);
 const owner={actual:{actorId:7,organizationId:4},expected:{actorId:7,organizationId:4},datasetGeneration:generation||current};
 const pos={...owner,runId:'native-run',revision:0,sequence:0};
 const digest='a'.repeat(64),body='{"quantity":1}';
 let error=null,calls=0;
 try {
  if(mode==='setup') {
   await db.batch(store.registerTransferRunStatements({...owner,runId:pos.runId,scope:'branches',requestId:'native-parent',digest,requestJson:body}));
   await db.batch(store.sealTransferRunChunkStatements({...pos,requestId:'native-child',digest,requestJson:body,cursorBefore:'{}',cursorAfter:'{"done":1}',final:true}));
   await store.commitTransferRunChunk(db,pos,[
    {sql:"INSERT INTO action_history(scope,entity,entity_id,label,reversible,status) VALUES('branches','stock_transfer','native-child','native',1,'undoable')"},
    {sql:"INSERT INTO transfer_operation_receipts(actor_id,request_id,request_digest,request_json,response_json,status,provenance_version,action_history_id) VALUES(7,'native-child',@digest,@body,json_object('cost',3.123456),'committed',1,last_insert_rowid())",params:{digest,body}},
   ],6);
  } else {
   const tracked={async batchOnce(statements) {
    calls++;
    const actual=mode==='rollback'?[...statements,{sql:'INSERT INTO branches(name) VALUES(NULL)'}]:statements;
    await db.batchOnce(actual);
    if(mode==='lostack') throw new Error('lost acknowledgement after commit');
   }};
   await store.retireTransferRunsForDatasetChange(tracked,{...owner,user:{id:7,organization_id:4,role_code:mode==='unauthorized'?'staff':'admin'},kind:'reset',nextGeneration,maxStatements:mode==='budget'?7:8});
  }
 }catch(e){error=e.message}
 return Response.json({error,calls,generation:await store.readBusinessDatasetGeneration(db)});
}};
`
async function main() {
 console.log('ENGINES',JSON.stringify({node:process.version,workerd:require('workerd/package.json').version,miniflare:require('miniflare/package.json').version,wrangler:require('wrangler/package.json').version}))
 const dir=path.join(__dirname,'../migrations'),sqlite=new Database(':memory:')
 // 0185/0186 are HELD (parked out of the applied chain, ops/scripts/migration/
 // held/README.md), applied explicitly below from heldDir.
 const heldDir=path.join(__dirname,'..','..','ops','scripts','migration','held')
 for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.sql')&&f<'0185_').sort()) sqlite.exec(fs.readFileSync(path.join(dir,file),'utf8'))
 const schema=sqlite.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT IN (SELECT name FROM pragma_table_list WHERE type='shadow') ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid").all()
 sqlite.close()
 const mf=new Miniflare({modules:[{type:'ESModule',path:'entry.js',contents:worker},...['db','permissions','importMaintenanceFence'].map(name=>({type:'ESModule',path:name+'.js',contents:compile(name+'.ts')})),{type:'ESModule',path:'store.js',contents:compile('transferRunStore.ts')}],compatibilityDate:'2026-08-01',d1Databases:['DB'],log:new Log(LogLevel.ERROR)})
 try {
  const db=await mf.getD1Database('DB')
  for(let i=0;i<schema.length;i+=25) await db.batch(schema.slice(i,i+25).map(r=>db.prepare(r.sql)))
  for(const file of ['0185_transfer_runs.sql','0186_transfer_run_retirement.sql']) await db.batch(split(fs.readFileSync(path.join(heldDir,file),'utf8')).map(sql=>db.prepare(sql)))
  async function invoke(input){const response=await mf.dispatchFetch('http://local-retirement.test/',{method:'POST',body:JSON.stringify(input)});assert.equal(response.status,200,await response.clone().text());return response.json()}
  const setup=await invoke({mode:'setup'});assert.equal(setup.error,null)
  const receipt=await db.prepare('SELECT * FROM transfer_operation_receipts').first()
  const run=await db.prepare('SELECT * FROM transfer_runs').first()
  const nextGeneration=crypto.randomUUID()
  for(const mode of ['unauthorized','budget','rollback']) {
   const result=await invoke({mode,nextGeneration})
   assert.ok(result.error);assert.equal(result.calls,mode==='rollback'?1:0)
   assert.equal(result.generation,setup.generation)
   assert.deepEqual(await db.prepare('SELECT * FROM transfer_runs').first(),run)
   assert.equal((await db.prepare('SELECT COUNT(*) n FROM transfer_run_retired_keys').first()).n,0)
   assert.equal((await db.prepare('SELECT COUNT(*) n FROM transfer_run_lifecycle_guard').first()).n,0)
  }
  const result=await invoke({mode:'lostack',nextGeneration})
  assert.match(result.error,/lost acknowledgement/);assert.equal(result.calls,1);assert.equal(result.generation,nextGeneration)
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM transfer_runs').first()).n,0)
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM transfer_run_chunks').first()).n,0)
  const retired=await db.prepare("SELECT snapshot_json FROM transfer_run_retired_keys WHERE request_id='native-child'").first()
  assert.deepEqual(JSON.parse(retired.snapshot_json).receipt,receipt)
  assert.deepEqual(await db.prepare('SELECT * FROM transfer_operation_receipts').first(),receipt)
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM transfer_run_lifecycle_guard').first()).n,0)
  const retry=await invoke({mode:'reset',generation:setup.generation,nextGeneration})
  assert.ok(retry.error);assert.equal(retry.calls,1);assert.equal(retry.generation,nextGeneration)
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM transfer_run_retired_keys').first()).n,2)
  const aba=await invoke({mode:'reset',nextGeneration:setup.generation})
  assert.match(aba.error,/UNIQUE|constraint/i);assert.equal(aba.generation,nextGeneration)
  const emptyGeneration=crypto.randomUUID()
  const empty=await invoke({mode:'reset',nextGeneration:emptyGeneration})
  assert.equal(empty.error,null);assert.equal(empty.generation,emptyGeneration)
  const emptyAba=await invoke({mode:'reset',nextGeneration})
  assert.match(emptyAba.error,/UNIQUE|constraint/i);assert.equal(emptyAba.generation,emptyGeneration)
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM business_dataset_generations').first()).n,3)
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM transfer_run_lifecycle_guard').first()).n,0)
  await assert.rejects(db.prepare("INSERT INTO transfer_operation_receipts(actor_id,request_id,request_digest,request_json) VALUES(7,'native-parent','a','{}')").run(),/retired/)
  await assert.rejects(db.prepare("DELETE FROM system_flags WHERE key='business_dataset_generation'").run(),/cannot be deleted/)
  console.log('PASS actual D1 lifecycle: authority/budget no-dispatch, rollback after progress, single-attempt lost-ack, stale retry, exact committed receipt snapshot, permanent parent key and generation')
  console.log('PASS actual D1 generation ABA rejection including empty-run retirement')
 }finally{await mf.dispose()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
