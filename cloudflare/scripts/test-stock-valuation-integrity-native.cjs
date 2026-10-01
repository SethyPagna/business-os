const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const origin = path.join(__dirname, 'test-stock-valuation-joint-native.cjs')
const original = fs.readFileSync(origin, 'utf8')
const controlLoader = String.raw`
  if(process.env.STOCK_INTEGRITY_BASELINE && rel==='lib/stockValuation.ts') source=execFileSync('git',['show','a8bd2cffbbede20ac358661c85cba03d840714d9:cloudflare/src/lib/stockValuation.ts'],{cwd:path.join(__dirname,'../..'),encoding:'utf8'});
  if(process.env.STOCK_INTEGRITY_GLOBAL_ONLY_CONTROL && rel==='lib/stockValuationHistory.ts') {
    const start=source.indexOf('export async function validateValuationHistory');
    const end=source.indexOf('export function assertValuationHistoryCapacity',start);
    source=source.slice(0,start)+"export async function validateValuationHistory(db:D1Compat,source:string,rules:HistoryRules){const funding=await db.prepare('SELECT credit4 FROM stock_funding_latest WHERE source_id=@source').get({source});if(funding){const coverage=await db.prepare('SELECT SUM(s.coverage4) amount FROM stock_valuation_segments s JOIN stock_valuation_latest e ON e.id=s.event_id WHERE e.source_id=@source').get({source});requireHistory(coverage?.amount===funding.credit4)}return {guards:[],rowCount:0,eventCount:0}}"+source.slice(end);
  }
  if(process.env.STOCK_INTEGRITY_ACCEPT_TOTAL_ONLY_CONTROL && rel==='lib/stockValuationHistory.ts') {
    source=source.replace("sameFields(actual, { event_id: event.id, agreement_id: raw.agreement_id, target_segment_id: share.segment_id, amount4: share.amount4, funding_event_id: funding!.id });", "requireHistory(acceptedRows.reduce((sum,row)=>sum+row.amount4,0)===shares.reduce((sum,row)=>sum+row.amount4,0));");
  }
  const output = ts.transpileModule(source`
let harness = (process.env.STOCK_INTEGRITY_SECTION==='original' ? original : original.split('async function fixtureE')[0]).replace('const output = ts.transpileModule(source',controlLoader)
const cases = String.raw`
async function established() {
  const f=fixture({}, {quantity:4,free:1,cost:100,gross4:1000000})
  await ok(f,admission()); await ok(f,hold(0,0)); await ok(f,pending(1,0))
  const accepted=accept(2,1,[{segment_id:'affected',amount_usd:30}])
  await ok(f,accepted)
  return {f,accepted}
}
async function money() {
  const statuses=[]
  for (const value of [true,null,{},[],-1,0.00001,'Infinity',undefined]) {
    const f=fixture({}, {quantity:4,free:1,cost:100,gross4:1000000})
    await ok(f,admission()); await ok(f,hold(0,0))
    const before=snapshot(f), batches=f.batchSizes.length
    const input=pending(1,0); input.amount_usd=value
    const response=await post(f,input)
    console.log('malformed pending',JSON.stringify(value),JSON.stringify(response))
    statuses.push(response.status)
    assert.equal(snapshot(f),before); assert.equal(f.batchSizes.length,batches)
    f.db.close()
  }
  assert.deepEqual(statuses,Array(8).fill(400))
  console.log('PASS eight malformed pending amounts typed400 without effects')
}
async function missing() {
  const {f,accepted}=await established()
  f.db.exec('DROP TRIGGER stock_valuation_acceptances_no_delete; DELETE FROM stock_valuation_acceptances')
  const before=snapshot(f), batches=f.batchSizes.length
  const response=await post(f,accepted)
  console.log('synthetic immutable-trigger-drop missing acceptance replay',JSON.stringify(response))
  assert.equal(response.status,409); assert.equal(snapshot(f),before); assert.equal(f.batchSizes.length,batches)
  f.db.close()
  console.log('PASS synthetic missing acceptance replay refuses before effects')
}
async function strong() {
  const {f}=await established()
  f.db.exec('DROP TRIGGER stock_valuation_acceptances_no_delete; DELETE FROM stock_valuation_acceptances')
  const before=snapshot(f), batches=f.batchSizes.length
  const next=await post(f,body('hold',3,2,{segment_id:'original',child_segment_id:'second-held',quantity:1,reason:'broken'}))
  const repeated=await post(f,accept(4,2,[{segment_id:'affected',amount_usd:20}]))
  const actual=f.db.prepare("SELECT credit4 FROM stock_funding_latest WHERE source_id='fund-900'").get().credit4
  const promised=f.db.prepare('SELECT amount4 FROM stock_valuation_agreements').get().amount4
  console.log('synthetic missing acceptance 50-versus30',JSON.stringify({next,repeated,actual,promised}))
  assert.ok(actual<=promised,'credited50 exceeds promised30 after omitted acceptance')
  assert.equal(next.status,409); assert.equal(repeated.status,409)
  assert.equal(snapshot(f),before); assert.equal(f.batchSizes.length,batches); f.db.close()
  console.log('PASS synthetic omitted acceptance cannot credit50 against promise30')
}
function syntheticUpdate(f,table,sql) {
  f.db.exec('DROP TRIGGER '+table+'_no_update; '+sql)
}
async function graph() {
  const faults=[
    ['accept amount',f=>syntheticUpdate(f,'stock_valuation_acceptances','UPDATE stock_valuation_acceptances SET amount4=290000')],
    ['accept target',f=>syntheticUpdate(f,'stock_valuation_acceptances',"UPDATE stock_valuation_acceptances SET target_segment_id='original'")],
    ['accept funding owner',f=>syntheticUpdate(f,'stock_valuation_acceptances',"UPDATE stock_valuation_acceptances SET funding_event_id=(SELECT id FROM stock_funding_events WHERE kind='pending')")],
    ['orphan accept on hold',f=>f.db.exec("INSERT INTO stock_valuation_acceptances SELECT e.id,'agreement-main','affected',10000,f.id FROM stock_valuation_events e,stock_funding_events f WHERE e.kind='hold' AND f.kind='accept'")],
    ['agreement targets',f=>syntheticUpdate(f,'stock_valuation_agreements',"UPDATE stock_valuation_agreements SET targets_json='[{\"allocation_id\":\"original\",\"amount4\":300000}]'")],
    ['agreement amount',f=>syntheticUpdate(f,'stock_valuation_agreements','UPDATE stock_valuation_agreements SET amount4=400000')],
    ['agreement proof',f=>syntheticUpdate(f,'stock_valuation_agreements',"UPDATE stock_valuation_agreements SET proof='Synthetic changed promise'")],
    ['orphan agreement',f=>f.db.exec("INSERT INTO stock_valuation_agreements VALUES('ghost-agreement','fund-900',10000,'[{\"allocation_id\":\"affected\",\"amount4\":10000}]','Synthetic orphan')")],
    ['funding pending claim amount',f=>syntheticUpdate(f,'stock_funding_claims',"UPDATE stock_funding_claims SET amount4=290000 WHERE id='agreement-main'")],
    ['funding accepted child claim amount',f=>syntheticUpdate(f,'stock_funding_claims',"UPDATE stock_funding_claims SET amount4=290000 WHERE id!='agreement-main'")],
    ['funding accepted child claim proof',f=>syntheticUpdate(f,'stock_funding_claims',"UPDATE stock_funding_claims SET proof='Synthetic changed acceptance' WHERE id!='agreement-main'")],
    ['orphan funding claim',f=>f.db.exec("INSERT INTO stock_funding_claims VALUES('ghost-claim','fund-900',10000,'Synthetic orphan')")],
    ['historical pending funding amount',f=>syntheticUpdate(f,'stock_funding_events',"UPDATE stock_funding_events SET amount4=290000 WHERE kind='pending'")],
    ['funding acceptance claim ancestry',f=>syntheticUpdate(f,'stock_funding_events',"UPDATE stock_funding_events SET claim_id='agreement-main' WHERE kind='accept'")],
    ['missing funding receipt',f=>f.db.exec("DROP TRIGGER stock_funding_receipts_no_delete; DELETE FROM stock_funding_receipts WHERE event_id=(SELECT id FROM stock_funding_events WHERE kind='pending')")],
    ['missing historical valuation receipt',f=>f.db.exec("DROP TRIGGER stock_valuation_receipts_no_delete; DELETE FROM stock_valuation_receipts WHERE event_id=(SELECT id FROM stock_valuation_events WHERE kind='pending')")],
    ['historical segment fate reason',f=>syntheticUpdate(f,'stock_valuation_segments',"UPDATE stock_valuation_segments SET reason='Synthetic historical reason' WHERE event_id=(SELECT id FROM stock_valuation_events WHERE kind='hold') AND segment_id='affected'")],
    ['missing historical segment',f=>f.db.exec("DROP TRIGGER stock_valuation_segments_no_delete; DELETE FROM stock_valuation_segments WHERE event_id=(SELECT id FROM stock_valuation_events WHERE kind='hold') AND segment_id='affected'")],
    ['valuation opening source',f=>syntheticUpdate(f,'stock_valuation_sources',"UPDATE stock_valuation_sources SET opening_json='{}'")],
    ['source opening facts',f=>syntheticUpdate(f,'stock_funding_sources','UPDATE stock_funding_sources SET opening_paid4=700000,opening_debt4=300000')],
    ['source reconciliation proof',f=>syntheticUpdate(f,'stock_funding_sources',"UPDATE stock_funding_sources SET reconciliation_proof='Synthetic changed opening'")],
    ['missing historical audit',f=>f.db.exec("DELETE FROM audit_logs WHERE entity='stock_valuation' AND entity_id=(SELECT id FROM stock_valuation_events WHERE kind='pending')")],
    ['historical receipt pending balance',async f=>{
      f.db.exec('DROP TRIGGER stock_valuation_receipts_no_update')
      const row=f.db.prepare("SELECT * FROM stock_valuation_receipts WHERE event_id=(SELECT id FROM stock_valuation_events WHERE kind='pending')").get()
      const value=JSON.parse(row.response_json); value.pending4=0; const encoded=JSON.stringify(value)
      f.db.prepare('UPDATE stock_valuation_receipts SET response_json=? WHERE event_id=?').run(encoded,row.event_id)
      f.db.prepare("UPDATE audit_logs SET details=?,new_value=? WHERE entity='stock_valuation' AND entity_id=?").run(encoded,encoded,row.event_id)
    }],
    ['historical canonical intent',async f=>{
      f.db.exec('DROP TRIGGER stock_valuation_receipts_no_update')
      const row=f.db.prepare("SELECT * FROM stock_valuation_receipts WHERE event_id=(SELECT id FROM stock_valuation_events WHERE kind='pending')").get()
      const value=JSON.parse(row.request_json); value.amount_usd=20; value.targets[0].amount_usd=20; const encoded=JSON.stringify(value)
      f.db.prepare('UPDATE stock_valuation_receipts SET request_json=?,request_digest=? WHERE event_id=?').run(encoded,await load('lib/feeOperationReceipt.ts').feeRequestDigest(encoded),row.event_id)
    }],
    ['historical normalized funding intent',async f=>{
      f.db.exec('DROP TRIGGER stock_funding_receipts_no_update')
      const row=f.db.prepare("SELECT * FROM stock_funding_receipts WHERE event_id=(SELECT id FROM stock_funding_events WHERE kind='pending')").get()
      const value=JSON.parse(row.request_json); value.claim='ghost-claim'; const encoded=JSON.stringify(value)
      f.db.prepare('UPDATE stock_funding_receipts SET request_json=?,request_digest=? WHERE event_id=?').run(encoded,await load('lib/feeOperationReceipt.ts').feeRequestDigest(encoded),row.event_id)
    }],
  ]
  const failures=[]
  for(const [name,mutate] of faults) {
    const {f,accepted}=await established(); await mutate(f)
    const before=snapshot(f),batches=f.batchSizes.length
    const replayed=await post(f,accepted)
    const transition=await post(f,body('hold',3,2,{segment_id:'original',child_segment_id:'second-held',quantity:1,reason:'broken'}))
    console.log('synthetic immutable-trigger-drop graph',name,JSON.stringify({replay:replayed.status,transition:transition.status}))
    if(replayed.status!==409||transition.status!==409||snapshot(f)!==before||f.batchSizes.length!==batches) failures.push({name,replay:replayed.status,transition:transition.status})
    f.db.close()
  }
  assert.deepEqual(failures,[])
  console.log('PASS synthetic source/event/target/agreement/claim/receipt historical graph faults '+faults.length+' replay and transition pairs without effects')
}
async function race() {
  const {f}=await established()
  f.hooks.beforeBatch=db=>db.exec('DROP TRIGGER stock_valuation_acceptances_no_delete; DELETE FROM stock_valuation_acceptances')
  const counts=f.db.prepare('SELECT COUNT(*) n FROM stock_valuation_events').get().n
  const response=await post(f,body('hold',3,2,{segment_id:'original',child_segment_id:'second-held',quantity:1,reason:'broken'}))
  assert.equal(response.status,409)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM stock_valuation_events').get().n,counts)
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM stock_valuation_segments WHERE segment_id='second-held'").get().n,0)
  assert.equal(f.db.prepare('SELECT credit4 FROM stock_funding_latest').get().credit4,300000)
  f.db.close(); console.log('PASS synthetic graph race before single atomic batch refuses command effects')
}
async function balanced() {
  const f=fixture({}, {quantity:4,free:1,cost:100,gross4:1000000})
  await ok(f,admission()); await ok(f,hold(0,0))
  await ok(f,body('hold',1,0,{segment_id:'original',child_segment_id:'second-held',quantity:1,reason:'broken'}))
  await ok(f,body('pending',2,0,{agreement_id:'agreement-main',amount_usd:30,targets:[{allocation_id:'affected',amount_usd:20},{allocation_id:'second-held',amount_usd:10}],proof:'Unequal exact target promises'}))
  const accepted=accept(3,1,[{segment_id:'affected',amount_usd:20},{segment_id:'second-held',amount_usd:10}])
  await ok(f,accepted)
  syntheticUpdate(f,'stock_valuation_acceptances',"UPDATE stock_valuation_acceptances SET amount4=CASE target_segment_id WHEN 'affected' THEN 100000 ELSE 200000 END")
  assert.equal(f.db.prepare('SELECT SUM(amount4) n FROM stock_valuation_acceptances').get().n,300000)
  const before=snapshot(f),batches=f.batchSizes.length
  const replayed=await post(f,accepted)
  const next=await post(f,body('repair',4,2,{segment_id:'affected',child_segment_id:'repaired',quantity:1}))
  console.log('synthetic balanced wrong shares preserve total30',JSON.stringify({replay:replayed.status,transition:next.status}))
  assert.equal(replayed.status,409); assert.equal(next.status,409)
  assert.equal(snapshot(f),before); assert.equal(f.batchSizes.length,batches)
  f.db.close(); console.log('PASS unequal target acceptance ownership cannot hide behind equal global sum')
}
async function capacity() {
  const f=fixture({}, {quantity:4,free:1,cost:100,gross4:1000000})
  await ok(f,admission())
  let segment='original',final
  for(let revision=0;revision<31;revision++) {
    const kind=revision%2===0?'hold':'repair'
    const child='bounded-'+revision
    final=body(kind,revision,0,{segment_id:segment,child_segment_id:child,quantity:4,...(kind==='hold'?{reason:'broken'}:{})})
    if(revision===30) {
      f.hooks.afterBatchThrow=true
      const batches=f.batchSizes.length
      const response=await post(f,final)
      assert.equal(response.status,200); assert.equal(response.data.replayed,true)
      assert.equal(f.batchSizes.length,batches+1)
    } else await ok(f,final)
    segment=child
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM stock_valuation_events').get().n,32)
  const before=snapshot(f),batches=f.batchSizes.length
  const replayed=await post(f,final); assert.equal(replayed.status,200); assert.equal(replayed.data.replayed,true)
  const refused=await post(f,body('repair',31,0,{segment_id:segment,child_segment_id:'overflow',quantity:4}))
  assert.equal(refused.status,409); assert.equal(refused.data.code,'valuation_history_limit')
  assert.equal(snapshot(f),before); assert.equal(f.batchSizes.length,batches)
  assert.ok(Math.max(...f.batchSizes)<=400); assert.ok(f.maxBindings()<=100)
  console.log('PASS bounded32 event native ledger final lost-response replay once and33rd refused',JSON.stringify({events:32,maxStatements:Math.max(...f.batchSizes),maxBindings:f.maxBindings(),exprDepth:f.db.limits.exprDepth}))
  f.db.close()
  const rows=fixture({}, {quantity:4,free:1,cost:100,gross4:1000000}); await ok(rows,admission())
  let count=0,last
  while(count<31) {
    const before=snapshot(rows),batches=rows.batchSizes.length
    const command=body('hold',count,0,{segment_id:'original',child_segment_id:'small-'+count,quantity:0.01,reason:'broken'})
    const response=await post(rows,command)
    if(response.status===409) {
      assert.equal(response.data.code,'valuation_history_limit')
      assert.equal(snapshot(rows),before); assert.equal(rows.batchSizes.length,batches)
      break
    }
    assert.equal(response.status,200); count++; last=command
  }
  assert.equal(count,18)
  assert.equal((await post(rows,last)).status,200)
  const admittedRows=['stock_funding_sources','stock_valuation_sources','stock_valuation_events','stock_valuation_segments','stock_valuation_agreements','stock_valuation_acceptances','stock_valuation_receipts','stock_funding_events','stock_funding_claims','stock_funding_receipts','audit_logs'].reduce((sum,table)=>sum+rows.db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0)
  assert.equal(admittedRows,252); assert.ok(Math.max(...rows.batchSizes)<=400); assert.ok(rows.maxBindings()<=100)
  console.log('PASS bounded256 rows native ledger refuses projected275 before writes and permits last replay',JSON.stringify({events:count+1,rows:admittedRows,maxStatements:Math.max(...rows.batchSizes),maxBindings:rows.maxBindings(),exprDepth:rows.db.limits.exprDepth}))
  rows.db.close()
  const limit=load('lib/stockValuationHistory.ts').assertValuationHistoryCapacity
  assert.throws(()=>limit({rowCount:0,eventCount:0},'hold',1,0,401),/valuation_history_limit/)
  assert.doesNotThrow(()=>limit({rowCount:0,eventCount:0},'hold',1,0,400))
  console.log('PASS exact400 statement capacity boundary')
}
(async()=>{
  const section=process.env.STOCK_INTEGRITY_SECTION
  if (!section||section==='money') await money()
  if (!section||section==='missing') await missing()
  if (!section||section==='strong') await strong()
  if (!section||section==='graph') await graph()
  if (!section||section==='race') await race()
  if (!section||section==='balanced') await balanced()
  if (!section||section==='capacity') await capacity()
})().catch(error=>{console.error(error);process.exitCode=1})
`
const compiled=new Module(origin,module)
compiled.filename=origin
compiled.paths=Module._nodeModulePaths(path.dirname(origin))
compiled._compile(process.env.STOCK_INTEGRITY_SECTION==='original' ? harness : harness+';'+cases,origin)
