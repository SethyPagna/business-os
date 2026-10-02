const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const Module=require('node:module')
const entry=path.join(__dirname,'test-stock-valuation-consumption-native.cjs')
const fixtureSource=fs.readFileSync(entry,'utf8')
const marker='(async()=>{const section=process.env.STOCK_CONSUMPTION_SECTION;'
assert.equal(fixtureSource.split(marker).length,2)
const harness=new Module(entry,module)
harness.filename=entry
harness.paths=Module._nodeModulePaths(path.dirname(entry))
assert.equal(fixtureSource.split('openDb(loadAll()).db').length,2)
harness._compile(fixtureSource.slice(0,fixtureSource.indexOf(marker)).replace('openDb(loadAll()).db','openDb(loadAll({through:215})).db')+'\nmodule.exports={soldFixture,load,call,sales,businessState};\n',entry)
const {soldFixture,load,call}=harness.exports
const migration=path.join(__dirname,'../migrations/0216_stock_consumption_epochs.sql')
const base=process.argv.includes('--base')
function insert(db,table,row,verb='INSERT') {
  const keys=Object.keys(row)
  return db.prepare(`${verb} INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(key=>row[key]))
}
function prepareOperation(f,id,source='fund-900',count=1) {
  const revision=f.db.prepare('SELECT COALESCE(MAX(revision),-1) n FROM stock_epoch_event_registry WHERE source_id=?').get(source).n
  const funding=f.db.prepare('SELECT * FROM stock_funding_latest WHERE source_id=?').get(source)
  insert(f.db,'stock_epoch_operations',{id,request_id:`request-${id}`,actor_id:71,actor_permissions:f.db.prepare('SELECT permissions FROM users WHERE id=71').get().permissions,dataset_generation:0,kind:'schema-probe',request_json:'{}',source_count:count,epoch_count:0,assignment_count:0})
  return {revision,funding}
}
function sourceEvent(f,operation,source,revision,funding,kind='adopt') {
  const id=`event-${operation}-${source}`,generation=funding?.generation??-1
  insert(f.db,'stock_epoch_operation_sources',{operation_id:operation,source_id:source,expected_revision:revision,expected_funding_generation:generation,event_id:id})
  insert(f.db,'stock_epoch_events',{id,source_id:source,revision:revision+1,kind,loss4:0,recovery4:0,expense_category:null,actor_id:71,occurred_at:'2026-10-02T03:00:00.000Z',consumed_cost4:0,consumed_recovery4:0,operation_id:operation,funding_generation:Math.max(0,generation),funding_json:JSON.stringify(funding??{})})
  return id
}
function receipt(f,event,request=`request-${event}`) {
  insert(f.db,'stock_epoch_receipts',{request_id:request,event_id:event,actor_id:71,request_digest:'schema-probe',request_json:'{}',response_json:JSON.stringify({valuation_version:5,event_id:event})})
}
function rollbackProbe(f,fn) {
  f.db.exec('BEGIN')
  try {fn()} finally {if(f.db.isTransaction)f.db.exec('ROLLBACK')}
}
function sharedBatchSources(f,recursive) {
  const batch=501,operation=`shared-batch-${recursive}`,movementBase=f.db.prepare('SELECT MAX(id) n FROM inventory_movements').get().n
  f.db.exec("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,supplier_id,payment_status,received_quantity,received_cost_usd,received_branch_id,unit_cost_usd) VALUES(501,10,'shared-epoch','SHARED','2026-10-02',1,2,77,'paid',2,20,1,10);INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(501,1,2);UPDATE branch_stock SET quantity=quantity+2 WHERE product_id=10 AND branch_id=1;UPDATE products SET stock_quantity=stock_quantity+2 WHERE id=10")
  for(const index of [1,2])insert(f.db,'inventory_movements',{id:movementBase+index,product_id:10,branch_id:1,batch_id:batch,movement_type:'add',quantity:1,free_quantity:0,total_cost_usd:index===1?7:13,reference_id:`source-${index}`,user_id:71})
  const before=f.db.prepare('SELECT COUNT(*) n FROM stock_epoch_sources').get().n
  const admitSource=(index)=>{
    const id=`shared-${index}`,gross=index===1?70000:130000
    insert(f.db,'stock_epoch_sources',{id,movement_id:movementBase+index,batch_id:batch,product_id:10,branch_id:1,supplier_id:77,quantity:'1',free_quantity:'0',gross4:gross,opening_paid4:gross,opening_debt4:0,reconciliation_proof:'Separate actual receipt basis',invoice_id:null,actor_id:71,source_json:JSON.stringify({movement:movementBase+index,gross4:gross}),source_format:5,admission_operation_id:operation})
    const event=sourceEvent(f,operation,id,-1,null,'admit')
    receipt(f,event)
  }
  rollbackProbe(f,()=>{
    prepareOperation(f,operation,'shared-1',1)
    admitSource(1)
    assert.throws(()=>insert(f.db,'stock_epoch_publications',{operation_id:operation,published_at:'now'}),/source admission incomplete/)
  })
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM stock_epoch_sources').get().n,before)
  f.db.exec('BEGIN')
  try {
    prepareOperation(f,operation,'shared-1',2)
    admitSource(1);admitSource(2)
    insert(f.db,'stock_epoch_publications',{operation_id:operation,published_at:'now'})
    f.db.exec('COMMIT')
  } catch(error) {if(f.db.isTransaction)f.db.exec('ROLLBACK');throw error}
  assert.deepEqual(f.db.prepare('SELECT id,gross4 FROM stock_epoch_sources WHERE batch_id=? ORDER BY id').all(batch).map(r=>({...r})),[{id:'shared-1',gross4:70000},{id:'shared-2',gross4:130000}])
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM stock_funding_dependencies WHERE batch_id=?').get(batch).n,2)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM stock_funding_sources WHERE batch_id=?').get(batch).n,0)
  console.log('PASS schema-only real two-receipt/one-batch source representation7+13=20 and missing-receipt publication rollback; ordinary admission route NOT exercised')
}
async function matrix(f,recursive) {
  const oldEvents=f.db.prepare('SELECT * FROM stock_valuation_event_identities ORDER BY source_id,revision').all()
  assert.deepEqual(f.db.prepare('SELECT * FROM stock_epoch_event_registry ORDER BY source_id,revision').all(),oldEvents)
  for(const table of ['stock_valuation_event_identities','stock_epoch_event_registry'])assert.throws(()=>insert(f.db,table,{event_id:'forged',source_id:'fund-900',revision:90,schema_version:4}),/unowned/)
  for(const table of ['stock_valuation_request_identities','stock_epoch_request_registry'])assert.throws(()=>insert(f.db,table,{request_id:'forged',event_id:oldEvents[0].event_id,schema_version:4}),/identity|unowned/)
  const immutable=f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name GLOB 'stock_*')").all().map(row=>row.name).filter(table=>f.db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND tbl_name=? AND name LIKE '%no_replace'").get(table))
  let protectedRows=0
  for(const table of immutable)for(const row of f.db.prepare(`SELECT * FROM ${table}`).all()) {
    const before=JSON.stringify(f.db.prepare(`SELECT * FROM ${table}`).all())
    assert.throws(()=>insert(f.db,table,row,'INSERT OR REPLACE'),/immutable|identity|changed|unowned|replace|preimage/)
    assert.equal(JSON.stringify(f.db.prepare(`SELECT * FROM ${table}`).all()),before)
    protectedRows++
  }
  const saved=f.db.prepare('SELECT * FROM stock_valuation_receipts ORDER BY request_id LIMIT 1').get()
  const replay=await call(f,load('routes/inventory.ts').default,'/valuation-experiment',JSON.parse(saved.request_json))
  assert.equal(replay.status,200,JSON.stringify(replay))
  assert.equal(JSON.stringify({...replay.data,replayed:undefined}),saved.response_json)
  rollbackProbe(f,()=>{
    const operation=`collision-${recursive}`,{revision,funding}=prepareOperation(f,operation),event=sourceEvent(f,operation,'fund-900',revision,funding)
    assert.equal(f.db.prepare('SELECT schema_version FROM stock_epoch_event_registry WHERE event_id=?').get(event).schema_version,5)
    const old=f.db.prepare('SELECT * FROM stock_valuation_events_v4 LIMIT 1').get()
    assert.throws(()=>insert(f.db,'stock_valuation_events_v4',{...old,id:event,revision:revision+1}),/identity/)
    assert.throws(()=>insert(f.db,'stock_valuation_events_v4',{...old,id:'old-cross-format',revision:revision+1}),/identity/)
    const newer=f.db.prepare('SELECT * FROM stock_epoch_events WHERE id=?').get(event)
    assert.throws(()=>insert(f.db,'stock_epoch_events',{...newer,id:old.id,revision:revision+2}),/identity|member/)
    assert.throws(()=>insert(f.db,'stock_epoch_events',{...newer,id:'gap',revision:revision+3}),/identity|member/)
    assert.throws(()=>receipt(f,event,saved.request_id),/identity/)
    assert.throws(()=>insert(f.db,'stock_epoch_publications',{operation_id:operation,published_at:'now'}),/incomplete/)
    receipt(f,event)
    const newReceipt=f.db.prepare('SELECT * FROM stock_epoch_receipts WHERE event_id=?').get(event)
    assert.throws(()=>insert(f.db,'stock_valuation_receipts_v4',{...saved,request_id:newReceipt.request_id,event_id:old.id}),'old request cannot collide with v5 request')
    insert(f.db,'stock_epoch_publications',{operation_id:operation,published_at:'now'})
    assert.throws(()=>insert(f.db,'stock_epoch_publications',{operation_id:operation,published_at:'changed'},'INSERT OR REPLACE'),/identity/)
  })
  f.db.exec('BEGIN')
  prepareOperation(f,`omitted-publication-${recursive}`)
  assert.throws(()=>f.db.exec('COMMIT'),/FOREIGN KEY/)
  f.db.exec('ROLLBACK')
  const head=f.db.prepare("SELECT * FROM stock_valuation_latest WHERE source_id='fund-900'").get(),funding=f.db.prepare("SELECT * FROM stock_funding_latest WHERE source_id='fund-900'").get()
  const records=f.db.prepare("SELECT record_key,record_json FROM stock_epoch_prefix_records WHERE source_id='fund-900' ORDER BY record_key").all()
  const verification=`verify-${recursive}`,checkpoint=`checkpoint-${recursive}`
  insert(f.db,'stock_epoch_verifications',{id:verification,source_id:'fund-900',dataset_generation:0,head_event_id:head.id,head_revision:head.revision,funding_generation:funding.generation,previous_checkpoint_id:null,protocol:1,member_count:records.length})
  const checkpointRow={id:checkpoint,verification_id:verification,source_id:'fund-900',head_event_id:head.id,head_revision:head.revision,dataset_generation:0,published_at:'now'}
  assert.throws(()=>insert(f.db,'stock_epoch_checkpoints',checkpointRow),/incomplete/)
  assert.throws(()=>insert(f.db,'stock_epoch_verified_members',{verification_id:verification,record_key:records[0].record_key,record_json:'{"digest":"trusted"}'}),/changed/)
  for(const record of records)insert(f.db,'stock_epoch_verified_members',{verification_id:verification,...record})
  insert(f.db,'stock_epoch_checkpoints',checkpointRow)
  assert.throws(()=>insert(f.db,'stock_epoch_checkpoints',checkpointRow,'INSERT OR REPLACE'),/identity/)
  rollbackProbe(f,()=>{
    const operation=`incomplete-adoption-${recursive}`,{revision,funding}=prepareOperation(f,operation),event=sourceEvent(f,operation,'fund-900',revision,funding)
    receipt(f,event)
    insert(f.db,'stock_epoch_adoptions',{source_id:'fund-900',operation_id:operation,previous_event_id:head.id,previous_revision:head.revision,funding_generation:funding.generation,dataset_generation:0,checkpoint_id:checkpoint})
    assert.throws(()=>insert(f.db,'stock_epoch_publications',{operation_id:operation,published_at:'now'}),/membership incomplete/)
    const old=f.db.prepare('SELECT * FROM stock_valuation_events_v4 LIMIT 1').get()
    assert.throws(()=>insert(f.db,'stock_valuation_events_v4',{...old,id:'old-after-adoption',revision:revision+2}),/identity/)
    const fund=f.db.prepare('SELECT * FROM stock_funding_events LIMIT 1').get()
    assert.throws(()=>insert(f.db,'stock_funding_events',{...fund,id:'fund-after-adoption',generation:funding.generation+1}),/old funding|joint/)
  })
  assert.throws(()=>f.db.exec('UPDATE stock_epoch_dataset SET generation=1'),/authenticated restore publication required/)
  const restore={id:`restore-${recursive}`,expected_generation:0,next_generation:1,actor_id:71,actor_permissions:f.db.prepare('SELECT permissions FROM users WHERE id=71').get().permissions,manifest_json:'{}',expected_members:1}
  assert.throws(()=>insert(f.db,'stock_epoch_restore_runs',{...restore,id:'stale-restore',expected_generation:1,next_generation:2}),/authority changed/)
  insert(f.db,'stock_epoch_restore_runs',restore)
  for(const table of ['users','roles','sessions','stock_valuation_context'])assert.throws(()=>insert(f.db,'stock_epoch_restore_members',{run_id:restore.id,table_name:table,row_key:'1',row_json:'{}'}),/current authority/)
  assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0)
  sharedBatchSources(f,recursive)
  console.log(`PASS schema compatibility recursive=${recursive}: ${protectedRows} populated immutable row replacements, physical registry ownership, v3/v4/v5 collisions, exact old replay, deferred publication, ${records.length} exact prefix members, incomplete adoption and restore authority refusal`)
}
async function main(){
  for(const recursive of [0,1]) {
    const f=await soldFixture()
    try {
      f.db.exec(`PRAGMA recursive_triggers=${recursive}`)
      const receipt=f.db.prepare('SELECT * FROM stock_valuation_receipts_v4 LIMIT 1').get(),before=JSON.stringify(receipt)
      if(!base) {
        const already=f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='stock_epoch_event_registry'").get()
        if(!already)f.db.exec(fs.readFileSync(migration,'utf8'))
      }
      assert.throws(()=>f.db.prepare('INSERT OR REPLACE INTO stock_valuation_receipts_v4(request_id,event_id,actor_id,request_digest,request_json,response_json) VALUES(?,?,?,?,?,?)').run(receipt.request_id,receipt.event_id,receipt.actor_id,receipt.request_digest,receipt.request_json,'{"forged":true}'),/immutable|identity|replace/)
      assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM stock_valuation_receipts_v4 WHERE request_id=?').get(receipt.request_id)),before)
      await load('lib/stockValuation.ts').checkedHistory(load('lib/db.ts').getDb({DB:f.d1}),'fund-900')
      console.log(`PASS old real receipt replacement rejected and history valid with recursive_triggers=${recursive}`)
      if(!base)await matrix(f,recursive)
    } finally {f.db.close()}
  }
}
main().catch(error=>{console.error(error);process.exitCode=1})
