const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const origin = path.join(__dirname, 'test-stock-valuation-joint-native.cjs')
let harness = fs.readFileSync(origin, 'utf8').split('async function fixtureE')[0]
harness = harness.replace("const output = ts.transpileModule(source", "if(process.env.STOCK_INTEGRITY_BASELINE && rel==='lib/stockValuation.ts') source=execFileSync('git',['show','a8bd2cffbbede20ac358661c85cba03d840714d9:cloudflare/src/lib/stockValuation.ts'],{cwd:path.join(__dirname,'../..'),encoding:'utf8'}); const output = ts.transpileModule(source")
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
(async()=>{
  const section=process.env.STOCK_INTEGRITY_SECTION
  if (!section||section==='money') await money()
  if (!section||section==='missing') await missing()
  if (!section||section==='strong') await strong()
  if (!section||section==='graph') await graph()
  if (!section||section==='race') await race()
})().catch(error=>{console.error(error);process.exitCode=1})
`
const compiled=new Module(origin,module)
compiled.filename=origin
compiled.paths=Module._nodeModulePaths(path.dirname(origin))
compiled._compile(harness+';'+cases,origin)
