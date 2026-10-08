const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')
const root = path.resolve(__dirname, '..')
async function main() {
  const bundle = await build({stdin:{resolveDir:root,loader:'ts',contents:`
    import { beginMaintenance, updateMaintenance, endMaintenance, getMaintenance, restoreStockAuthority } from './src/lib/maintenance.ts';
    import { executeRawStockTransaction, executeRawRestoreStockTransaction, executeStockTransaction } from './src/lib/stockTransaction.ts';
    import { D1Compat } from './src/lib/db.ts';
    import { BACKUP_TABLES, SALE_REPLAY_RESTORE_BUNDLE, restoreCloudflareBackup } from './src/lib/backup.ts';
    import { applyDatedStockCountDecisions } from './src/lib/datedStockCountDecisions.ts';
    import { guardSaleRecordReset, resetDeleteStatements } from './src/routes/system.ts';
    export default { async fetch(request,env) {
      const input=await request.json();
      let attempts=0;globalThis[Symbol.for('business-os.request-metrics.v1')]={rawD1Start(n){attempts+=n;},d1Start(n){attempts+=n;},d1Call(){}};
      try {
        if(input.mode==='tables')return Response.json(BACKUP_TABLES);
        if(input.mode==='bundle')return Response.json(SALE_REPLAY_RESTORE_BUNDLE);
        if(input.mode==='decision')return Response.json(await applyDatedStockCountDecisions(new D1Compat(env.DB),[],[],[],{
          actorId:1001,actorName:'Fixture administrator',requestId:'reset-retry-proof',
          owner:{version:1,actor_id:1001,organization_id:1,authority:'http://local.test',runtime:'cloudflare-workers'},budget:{limit:50,used:()=>attempts}
        }));
        if(input.mode==='begin')return Response.json(await beginMaintenance(env,{backupKey:input.source,startedBy:'admin'}));
        if(input.mode==='update'){await updateMaintenance(env,input.token,{phase:'inserting',rowsDone:10});return Response.json(await getMaintenance(env));}
        if(input.mode==='end')return Response.json(await endMaintenance(env,input.token,input.options));
        if(input.mode==='stock'){
          const authority=input.owned?await restoreStockAuthority(env,input.token,input.source):undefined;
          const statements=[env.DB.prepare('UPDATE branch_stock SET quantity=quantity+1 WHERE product_id=1001 RETURNING quantity')];
          if(input.rollback)statements.push(env.DB.prepare("INSERT INTO products(id,name)VALUES(1001,'collision')"));
          if(input.race)await endMaintenance(env,input.token);
          const raw=input.lost?{prepare:sql=>env.DB.prepare(sql),batch:async items=>{await env.DB.batch(items);throw Error('lost acknowledgement')}}:env.DB;
          const results=authority?await executeRawRestoreStockTransaction(raw,statements,authority):await executeRawStockTransaction(raw,statements);
          return Response.json({results,attempts});
        }
        if(input.mode==='reset'){
          const tables=input.empty?[]:['damaged_stock_lots','branch_batch_stock','branch_stock','product_batches','products'];
          const statements=resetDeleteStatements(tables);
          if(input.rollback)statements.push({sql:"SELECT json_extract('[1]','$[late_reset_failure]')"});
          return Response.json(await executeStockTransaction(new D1Compat(env.DB),guardSaleRecordReset(statements,input.actor),'once'));
        }
        if(input.mode==='restore'){
          await env.ASSETS.put(input.source,JSON.stringify(input.document));
          const state=await beginMaintenance(env,{backupKey:input.source,startedBy:'admin'});
          const restored=await restoreCloudflareBackup(env,input.source,progress=>updateMaintenance(env,state.token,progress),state.token);
          const ended=await endMaintenance(env,state.token);
          return Response.json({restored,ended});
        }
      }catch(error){return Response.json({error:error.message,code:error.code},{status:409});}
    }}
  `},plugins:[{name:'internal-reset-controls',setup(b){b.onLoad({filter:/[\\/]routes[\\/]system\.ts$/},args=>({contents:fs.readFileSync(args.path,'utf8')+'\nexport { guardSaleRecordReset, resetDeleteStatements };',loader:'ts'}))}}],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'})
  const mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-08-01',d1Databases:['DB'],r2Buckets:['ASSETS'],log:new Log(LogLevel.ERROR)})
  try {
    const db=await mf.getD1Database('DB')
    const dir=path.join(root,'migrations')
    for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.sql')&&Number(n.slice(0,4))<243).sort()){
      const statements=split(fs.readFileSync(path.join(dir,name),'utf8')).filter(sql=>!(name==='0098_user_aliases.sql'&&/^INSERT OR IGNORE INTO user_aliases/i.test(sql.trim())))
      if(statements.length)await db.batch(statements.map(sql=>db.prepare(sql)))
    }
    await db.prepare("INSERT INTO roles(id,name,code,is_system) VALUES(1001,'Fixture administrator','admin',1)").run()
    await db.batch([
      db.prepare("INSERT INTO users(id,username,name,password,role_id,is_active) VALUES(1001,'admin','Fixture administrator','hash',1001,1)"),
      db.prepare("INSERT INTO products(id,name,stock_quantity) VALUES(1001,'old legacy',7)"),
      db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key) VALUES(1001,1001,'legacy')"),
      db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1001,1,7)'),
      db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(1001,1,7)'),
      db.prepare('INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining) VALUES(1001,1001,1,1001,3,3)')
    ])
    await db.batch(split(fs.readFileSync(path.join(dir,'0243_stock_schema_epoch.sql'),'utf8')).map(sql=>db.prepare(sql)))
    await db.batch(split(fs.readFileSync(path.join(dir,'0244_dated_count_decision_receipts.sql'),'utf8')).map(sql=>db.prepare(sql)))
    await db.batch(split(fs.readFileSync(path.join(dir,'0245_dated_count_apply_receipts.sql'),'utf8')).map(sql=>db.prepare(sql)))
    await db.prepare("INSERT INTO dated_count_apply_receipts(actor_id,request_id,request_json,result_json) VALUES(1001,'reset-retry-proof','{}','{\"success\":true}')").run()
    await db.prepare(`INSERT INTO dated_count_decision_receipts(actor_id,request_id,request_json,result_json,total_rows)
      VALUES(1001,'reset-retry-proof','{}','{"resolved":[],"skipped":[],"errors":[],"productsCreated":[]}',0)`).run()
    const call=async input=>{const response=await mf.dispatchFetch('http://local.test',{method:'POST',body:JSON.stringify(input)});return {status:response.status,data:await response.json()}}
    const zero=async()=>assert.equal(await db.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").first('n'),0)
    const source='backups/cloudflare/legacy-proof.json'
    const tables=(await call({mode:'tables'})).data
    assert.ok(tables.includes('dated_count_decision_receipts'),'full backups preserve retry identity')
    assert.ok((await call({mode:'bundle'})).data.includes('dated_count_decision_receipts'),'scoped product/sales backups preserve retry identity')
    const receiptTables=['dated_count_decision_receipts','dated_count_apply_receipts']
    for(const table of receiptTables){assert.ok(tables.includes(table),'full backup includes '+table);assert.ok((await call({mode:'bundle'})).data.includes(table),'stock bundle includes '+table)}
    const applyReceiptBefore=await db.prepare("SELECT * FROM dated_count_apply_receipts WHERE request_id='reset-retry-proof'").first()
    const receiptBefore=await db.prepare("SELECT * FROM dated_count_decision_receipts WHERE request_id='reset-retry-proof'").first()
    const document={format:'business-os-cloudflare-backup',formatVersion:1,createdAt:'2026-09-20T00:00:00Z',source:'manual',runtime:'cloudflare-workers',tables:{},r2:{assets:[],copiedKeys:[]},summary:{schemaMigration:null}}
    for(const table of tables){
      const exists=await db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=?").bind(table).first()
      if(!exists)continue
      document.tables[table]={columns:(await db.prepare('PRAGMA table_info("'+table+'")').all()).results.map(r=>r.name),rows:(await db.prepare('SELECT * FROM "'+table+'"').all()).results}
    }
    for(const epoch of ['wrong','']){
      await db.prepare("UPDATE system_flags SET value=? WHERE key='stock_schema_epoch'").bind(epoch).run()
      assert.equal((await call({mode:'begin',source})).status,409);await zero()
    }
    await db.prepare("UPDATE system_flags SET value='legacy-separate-pool-v1' WHERE key='stock_schema_epoch'").run()
    await db.prepare("INSERT INTO bulk_delete_jobs(id,entity_type,status,reason,ids_json,total_count) VALUES('hold','products','pending','fixture','[]',0)").run()
    assert.equal((await call({mode:'begin',source})).status,409);await zero()
    await db.prepare("DELETE FROM bulk_delete_jobs WHERE id='hold'").run()
    // Import lease fixture uses real required columns from the current schema.
    const jobColumns=(await db.prepare('PRAGMA table_info(import_jobs)').all()).results
    const required=jobColumns.filter(r=>r.notnull&&!r.dflt_value&&r.name!=='id')
    const values=required.map(r=>r.name==='status'?'failed':r.type.includes('INT')?1001:'fixture')
    await db.prepare('INSERT INTO import_jobs(id,'+required.map(r=>r.name).join(',')+") VALUES('hold',"+values.map(()=>'?').join(',')+')').bind(...values).run()
    await db.prepare("UPDATE import_jobs SET lease_expires_at=datetime('now','+1 hour') WHERE id='hold'").run()
    assert.equal((await call({mode:'begin',source})).status,409);await zero()
    await db.prepare("DELETE FROM import_jobs WHERE id='hold'").run()
    await db.prepare("DELETE FROM bulk_delete_jobs WHERE id='hold'").run()
    const begun=await call({mode:'begin',source});assert.equal(begun.status,200,JSON.stringify(begun));const state=begun.data
    assert.equal((await call({mode:'begin',source})).status,409)
    assert.equal((await call({mode:'stock'})).status,409)
    for(const bad of [{token:'wrong',source},{token:state.token,source:'wrong'}])assert.equal((await call({mode:'stock',owned:true,...bad})).status,409)
    const own=await call({mode:'stock',owned:true,token:state.token,source});assert.equal(own.status,200);assert.equal(own.data.attempts,4);assert.equal(own.data.results[0].results[0].quantity,8)
    assert.equal((await call({mode:'stock',owned:true,token:state.token,source,rollback:true})).status,409);await zero()
    assert.equal(await db.prepare('SELECT quantity FROM branch_stock WHERE product_id=1001').first('quantity'),8)
    await db.prepare("UPDATE system_flags SET value='wrong' WHERE key='stock_schema_epoch'").run()
    assert.equal((await call({mode:'stock',owned:true,token:state.token,source})).status,409);await zero()
    await db.prepare("UPDATE system_flags SET value='legacy-separate-pool-v1' WHERE key='stock_schema_epoch'").run()
    assert.equal((await call({mode:'stock',owned:true,token:state.token,source,lost:true})).status,409);await zero()
    assert.equal(await db.prepare('SELECT quantity FROM branch_stock WHERE product_id=1001').first('quantity'),9)
    await zero()
    assert.equal((await call({mode:'update',token:state.token})).data.phase,'inserting');await zero()
    assert.equal((await call({mode:'end',token:'wrong'})).data,false)
    assert.equal((await call({mode:'end',token:state.token})).data,true)
    assert.equal((await call({mode:'update',token:state.token})).data,null)
    const racer=(await call({mode:'begin',source})).data
    assert.equal((await call({mode:'stock',owned:true,token:racer.token,source,race:true})).status,409);await zero()
    assert.equal(await db.prepare('SELECT quantity FROM branch_stock WHERE product_id=1001').first('quantity'),9)
    const replacement=(await call({mode:'begin',source})).data
    await call({mode:'update',token:racer.token})
    assert.equal((await call({mode:'end',token:racer.token})).data,false)
    assert.equal((await call({mode:'end',token:replacement.token})).data,true)
    await db.prepare("INSERT INTO system_flags(key,value)VALUES('stock_transaction_permit','legacy-separate-pool-v1')").run()
    assert.equal((await call({mode:'begin',source})).status,409)
    assert.equal(await db.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").first('n'),1)
    await db.prepare("DELETE FROM system_flags WHERE key='stock_transaction_permit'").run()
    assert.equal((await call({mode:'reset',actor:1001,rollback:true})).status,409)
    assert.deepEqual(await db.prepare("SELECT * FROM dated_count_decision_receipts WHERE request_id='reset-retry-proof'").first(),receiptBefore,'late reset failure rolls back receipt invalidation')
    assert.deepEqual(await db.prepare("SELECT * FROM dated_count_apply_receipts WHERE request_id='reset-retry-proof'").first(),applyReceiptBefore,'late reset failure rolls back APPLY invalidation')
    await zero()
    let invalidatedAt
    for(const empty of [true,false]){
      assert.equal((await call({mode:'reset',empty,actor:1002})).status,409)
      if(empty)assert.deepEqual(await db.prepare("SELECT * FROM dated_count_decision_receipts WHERE request_id='reset-retry-proof'").first(),receiptBefore,'refused actor cannot invalidate saved intent')
      if(empty)assert.deepEqual(await db.prepare("SELECT * FROM dated_count_apply_receipts WHERE request_id='reset-retry-proof'").first(),applyReceiptBefore,'refused actor cannot invalidate APPLY')
      const reset=await call({mode:'reset',empty,actor:1001});assert.equal(reset.status,200,JSON.stringify(reset))
      const receipt=await db.prepare("SELECT * FROM dated_count_decision_receipts WHERE request_id='reset-retry-proof'").first()
      assert.ok(receipt.invalidated_at,'reset preserves a tombstone instead of deleting the retry key')
      assert.equal(receipt.request_json,receiptBefore.request_json)
      assert.equal(receipt.result_json,receiptBefore.result_json)
      if(invalidatedAt)assert.equal(receipt.invalidated_at,invalidatedAt,'repeated reset preserves original invalidation')
      invalidatedAt=receipt.invalidated_at
      const applyReceipt=await db.prepare("SELECT * FROM dated_count_apply_receipts WHERE request_id='reset-retry-proof'").first()
      assert.ok(applyReceipt.invalidated_at);assert.equal(applyReceipt.request_json,applyReceiptBefore.request_json);assert.equal(applyReceipt.result_json,applyReceiptBefore.result_json)
      const replay=await call({mode:'decision'})
      assert.equal(replay.status,409);assert.equal(replay.data.code,'dated_decision_reset_conflict')
      await zero()
      assert.equal(await db.prepare("SELECT value FROM system_flags WHERE key='stock_schema_epoch'").first('value'),'legacy-separate-pool-v1')
      assert.equal(await db.prepare("SELECT COUNT(*) n FROM system_flags WHERE key LIKE '%reset_guard'").first('n'),0)
    }
    for(const table of receiptTables){
      const row=document.tables[table].rows[0]
      document.tables[table].rows.push({...row,request_id:'backup-only-proof',invalidated_at:null})
      const cols=document.tables[table].columns
      const live={...row,request_id:'live-newer-proof',invalidated_at:null}
      await db.prepare('INSERT INTO '+table+'('+cols.join(',')+') VALUES('+cols.map(()=>'?').join(',')+')').bind(...cols.map(c=>live[c]??null)).run()
    }
    document.tables.system_flags={columns:['key','value'],rows:[{key:'stock_schema_epoch',value:'forged-source-epoch'},{key:'maintenance',value:'forged-source-holder'}]}
    const restored=await call({mode:'restore',source,document});assert.equal(restored.status,200,JSON.stringify(restored));assert.equal(restored.data.ended,true);await zero()
    assert.equal(await db.prepare("SELECT value FROM system_flags WHERE key='stock_schema_epoch'").first('value'),'legacy-separate-pool-v1')
    assert.equal(await db.prepare("SELECT value FROM system_flags WHERE key='stock_schema_receipt_boundary'").first('value'),'0')
    assert.equal(await db.prepare('SELECT quantity FROM branch_stock WHERE product_id=1001').first('quantity'),7)
    assert.equal(await db.prepare('SELECT quantity_remaining FROM damaged_stock_lots WHERE id=1001').first('quantity_remaining'),3)
    const restoredReceipts=[]
    for(const table of receiptTables){
      const rows=(await db.prepare('SELECT * FROM '+table+' ORDER BY request_id').all()).results
      assert.deepEqual(rows.map(r=>r.request_id),['backup-only-proof','live-newer-proof','reset-retry-proof'])
      assert.ok(rows.every(r=>r.invalidated_at),'restore invalidates union including newer live IDs for '+table)
      assert.ok(rows.every(r=>r.request_json==='{}'),'restore preserves original request evidence')
      restoredReceipts.push(rows)
    }
    const again=await call({mode:'restore',source,document});assert.equal(again.status,200,JSON.stringify(again));await zero()
    for(let i=0;i<receiptTables.length;i++)assert.deepEqual((await db.prepare('SELECT * FROM '+receiptTables[i]+' ORDER BY request_id').all()).results,restoredReceipts[i],'repeat old restore preserves terminal identities')
    const replay=await call({mode:'decision'});assert.equal(replay.status,409);assert.equal(replay.data.code,'dated_decision_reset_conflict')
    const incomplete=structuredClone(document);delete incomplete.tables.dated_count_apply_receipts
    const refusedRestore=await call({mode:'restore',source,document:incomplete})
    assert.equal(refusedRestore.status,409);assert.match(refusedRestore.data.error,/missing dependency tables.*dated_count_apply_receipts/)
    for(let i=0;i<receiptTables.length;i++)assert.deepEqual((await db.prepare('SELECT * FROM '+receiptTables[i]+' ORDER BY request_id').all()).results,restoredReceipts[i],'invalid backup changes no receipt')
    const held=JSON.parse(await db.prepare("SELECT value FROM system_flags WHERE key='maintenance'").first('value'))
    assert.equal((await call({mode:'end',token:held.token})).data,true);await zero()
    await db.prepare("INSERT INTO dated_count_apply_receipts(actor_id,request_id,request_json,result_json) VALUES(1001,'unrelated-scope','{}','{}')").run()
    const untouched=await db.prepare("SELECT * FROM dated_count_apply_receipts WHERE request_id='unrelated-scope'").first()
    const settingsOnly={...document,tables:{settings:document.tables.settings}}
    const scoped=await call({mode:'restore',source,document:settingsOnly});assert.equal(scoped.status,200,JSON.stringify(scoped));await zero()
    assert.deepEqual(await db.prepare("SELECT * FROM dated_count_apply_receipts WHERE request_id='unrelated-scope'").first(),untouched,'unrelated settings restore leaves count identity valid')

    console.log('PASS actual0243/0244/0245 lifecycle: epoch/lease admission, ordinary refusal, owned token/source/epoch/rollback/lost ACK/clear race/metrics, reset actor/rollback/tombstone replay, live+backup receipt tombstones/repeated restore and legacy S7/D3 restore, zero permits')
  }finally{await mf.dispose()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
