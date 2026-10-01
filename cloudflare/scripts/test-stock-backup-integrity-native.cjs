const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const harnessPath = path.join(__dirname, 'test-stock-lifecycle-recovery-native.cjs')
const harness = fs.readFileSync(harnessPath, 'utf8').split('async function main()')[0].replace('const revision=', "const revision=process.env.STOCK_BACKUP_INTEGRITY_BASELINE&&rel==='lib/stockLifecycleRecovery.ts'?'fcd7057572e0c8bcc9d6668ffc0b7f755e9b7d18':")
const { fixture, seed, load, hold, fund, actor, command, snapshot } = new Function('require', '__dirname', harness + ';return {fixture,seed,load,hold,fund,actor,command,snapshot}')(require, __dirname)
const row = (doc, table, kind) => doc.tables[table].rows.find(item => item.kind === kind)
const receipt = (doc, table, kind) => doc.tables[table].rows.find(item => JSON.parse(item.request_json).kind === kind)
function alterResponse(doc, kind, mutate) {
  const saved = receipt(doc, 'stock_funding_receipts', kind), response = JSON.parse(saved.response_json)
  mutate(response); saved.response_json = JSON.stringify(response)
}

async function main() {
  const backup = load('lib/backup.ts'), disposition = load('lib/stockDisposition.ts'), funding = load('lib/stockFunding.ts')
  const validation=load('lib/stockLifecycleRecovery.ts').StockRecoveryGraphValidation
  if(process.env.STOCK_BACKUP_INTEGRITY_CONTROL==='funding')validation.prototype.validateFundingHistory=async()=>{}
  if(process.env.STOCK_BACKUP_INTEGRITY_CONTROL==='disposition')validation.prototype.validateDispositionHistory=async()=>{}
  const source = fixture(); seed(source)
  const held = await disposition.commitStockDisposition(source.env, actor, hold)
  await disposition.commitStockDisposition(source.env, actor, { kind:'dispose',source_id:'source-900',batch_id:500,product_id:10,branch_id:1,supplier_id:77,allocation_id:held.allocation_id,quantity:1,reason:'Dispose recovery fixture',expense_category:'broken',expected_generation:1,client_request_id:'recovery-dispose-0001' })
  await funding.commitStockFunding(source.env, actor, fund)
  await funding.commitStockFunding(source.env, actor, command('pending',0,{amount_usd:30,claim_id:'recovery-claim'}))
  await funding.commitStockFunding(source.env, actor, command('accept',1,{claim_id:'recovery-claim'}))
  const refundCommand = command('refund',2,{amount_usd:10,cash_method:'cash',cash_reference:'REC-CASH',cash_recorded_at:'2026-10-01T11:00:00.000Z'})
  await funding.commitStockFunding(source.env, actor, refundCommand)
  const saved = await backup.createCloudflareBackup(source.env), bytes = source.objects.get(saved.key).bytes
  const failures = []
  const cases = [
    ['orphan claim', d => d.tables.stock_funding_claims.rows.push({...d.tables.stock_funding_claims.rows[0],id:'orphan-restored-claim',amount4:123400})],
    ['missing extra fee link', d => d.tables.stock_disposition_fees.rows=[]],
    ['allocation acquired basis', d => d.tables.stock_disposition_allocations.rows[0].gross4+=10000],
    ['orphan allocation', d => d.tables.stock_disposition_allocations.rows.push({...d.tables.stock_disposition_allocations.rows[0],id:'orphan-restored-allocation'})],
    ['replay claim identity', d => alterResponse(d,'accept',r=>r.claim_id='nonexistent-claim')],
    ['cash reference intent', d => row(d,'stock_funding_events','refund').cash_reference='CORRUPTED-REFERENCE'],
    ['replay fee identity', d => alterResponse(d,'refund',r=>r.fee_id=999999)],
    ['cash method intent', d => row(d,'stock_funding_events','refund').cash_method='changed'],
    ['cash recorded time intent', d => row(d,'stock_funding_events','refund').cash_recorded_at='2026-10-01T10:00:00.000Z'],
    ['canonical event proof', d => row(d,'stock_funding_events','accept').proof='changed'],
    ['claim amount intent', d => d.tables.stock_funding_claims.rows[0].amount4+=1],
    ['claim proof intent', d => d.tables.stock_funding_claims.rows[0].proof='changed'],
    ['hold condition intent', d => d.tables.stock_disposition_allocations.rows[0].condition_tag='other'],
    ['hold quantity intent', d => d.tables.stock_disposition_allocations.rows[0].quantity='1.9'],
    ['dispose chronological remainder', d => row(d,'stock_disposition_events','dispose').remaining_gross4+=1],
    ['fee ownership', d => d.tables.fees.rows.find(r=>r.id===d.tables.stock_disposition_fees.rows[0].fee_id).created_by=999],
    ['fee receipt omitted', d => d.tables.fee_operation_receipts.rows=[]],
    ['fee request omitted', d => d.tables.fee_operation_receipts.rows[0].request_json='{}'],
    ['fee response changed', d => { const r=d.tables.fee_operation_receipts.rows[0],v=JSON.parse(r.response_json);v.fee.amount_usd+=1;r.response_json=JSON.stringify(v) }],
    ['fee link duplicated', d => d.tables.stock_disposition_fees.rows.push({...d.tables.stock_disposition_fees.rows[0]})],
  ]
  for (const [name, mutate] of cases) {
    const target=fixture(),doc=JSON.parse(bytes);mutate(doc)
    target.db.exec("INSERT INTO settings(key,value) VALUES('sentinel','UNCHANGED')")
    const before=snapshot(target);await target.env.ASSETS.put(saved.key,JSON.stringify(doc))
    let rejected=false
    try { await backup.restoreCloudflareBackup(target.env,saved.key) } catch(e) { rejected=/Invalid stock recovery graph/.test(e.message) }
    const unchanged=snapshot(target)===before,lease=target.db.prepare("SELECT value FROM system_flags WHERE key='maintenance'").get()
    if(!rejected||!unchanged||lease) failures.push(name)
    console.log(`${rejected&&unchanged&&!lease?'PASS':'FAIL'} preflight ${name}; unchanged=${unchanged}; lease=${lease?'retained':'released'}`)
    target.db.close()
  }
  const positive=fixture();await positive.env.ASSETS.put(saved.key,bytes)
  await backup.restoreCloudflareBackup(positive.env,saved.key)
  assert.equal(snapshot(positive),snapshot(source))
  const dbFor=f=>load('lib/db.ts').getDb(f.env)
  assert.deepEqual(await disposition.stockDispositionProjection(dbFor(positive),'source-900'),await disposition.stockDispositionProjection(dbFor(source),'source-900'))
  assert.deepEqual(await funding.readStockFundingAp(positive.env,actor),await funding.readStockFundingAp(source.env,actor))
  const beforeReplay=snapshot(positive)
  for(const action of [()=>disposition.commitStockDisposition(positive.env,actor,hold),()=>funding.commitStockFunding(positive.env,actor,fund),()=>funding.commitStockFunding(positive.env,actor,command('accept',1,{claim_id:'recovery-claim'})),()=>funding.commitStockFunding(positive.env,actor,refundCommand)])assert.equal((await action()).replayed,true)
  assert.equal(snapshot(positive),beforeReplay)
  console.log('PASS actual populated v1/v2 exact full graph, projections, accept/refund replay; valuation rows empty')
  positive.db.close()
  const secondHold={...hold,quantity:1,coverage_usd:0,coverage_state:'none',extra_fee_usd:0,expected_generation:2,client_request_id:'second-allocation-0001'}
  const second=await disposition.commitStockDisposition(source.env,actor,secondHold)
  const partialDispose={kind:'dispose',source_id:'source-900',batch_id:500,product_id:10,branch_id:1,supplier_id:77,allocation_id:second.allocation_id,quantity:0.5,reason:'Partial second allocation',expense_category:'broken',expected_generation:3,client_request_id:'partial-dispose-0001'}
  await disposition.commitStockDisposition(source.env,actor,partialDispose)
  await funding.commitStockFunding(source.env,actor,command('pending',3,{amount_usd:5,claim_id:'canceled-claim'}))
  await funding.commitStockFunding(source.env,actor,command('cancel',4,{claim_id:'canceled-claim'}))
  const feeOps=load('lib/feeOperationReceipt.ts'),intent={fee_money_version:1,fee_type:'other',label:'Native shipping',amount_usd:1.7,amount_khr:0,fee_date:load('lib/businessDateWindow.ts').businessToday(),sale_id:null,branch_id:1,delivery_contact_id:null,notes:'Native funding shipping'}
  const at=new Date().toISOString(),feeJson=feeOps.canonicalFeeCreateRequest(intent),digest=await feeOps.feeRequestDigest(feeJson),requestId='native-shipping-fee-0001'
  await load('lib/businessMaintenanceGuard.ts').ordinaryBusinessBatch(dbFor(source),[
    {sql:'INSERT INTO fees(fee_type,label,amount_usd,amount_khr,fee_date,sale_id,branch_id,delivery_contact_id,notes,created_by,created_by_name,created_at,updated_at) VALUES(@type,@label,@amount,0,@date,NULL,1,NULL,@notes,71,@name,@at,@at)',params:{type:intent.fee_type,label:intent.label,amount:intent.amount_usd,date:intent.fee_date,notes:intent.notes,name:'Recovery Writer',at}},
    feeOps.feeOperationReceiptStatement({receiptId:crypto.randomUUID(),actorId:71,actorName:'Recovery Writer',requestId,digest,requestJson:feeJson,occurredAt:at,intent,resolvedBranchId:1}),
    feeOps.feeCreateAuditStatement({actorId:71,actorName:'Recovery Writer',requestId,digest,resolvedBranchId:1}),
  ])
  const feeId=source.db.prepare('SELECT fee_id FROM fee_operation_receipts WHERE request_id=?').get(requestId).fee_id
  const shipping=command('shipping',5,{amount_usd:1.7,fee_id:feeId})
  await funding.commitStockFunding(source.env,actor,shipping)
  await funding.commitStockFunding(source.env,actor,command('pending',6,{amount_usd:2,claim_id:'second-credit'}))
  await funding.commitStockFunding(source.env,actor,command('accept',7,{claim_id:'second-credit'}))
  const secondRefund=command('refund',8,{amount_usd:2,cash_method:'cash',cash_reference:'SECOND-REFUND',cash_recorded_at:'2026-10-01T11:00:00.000Z'})
  await funding.commitStockFunding(source.env,actor,secondRefund)
  const expanded=await backup.createCloudflareBackup(source.env),expandedBytes=source.objects.get(expanded.key).bytes,restored=fixture()
  await restored.env.ASSETS.put(expanded.key,expandedBytes);await backup.restoreCloudflareBackup(restored.env,expanded.key)
  assert.equal(snapshot(restored),snapshot(source))
  assert.deepEqual(await disposition.stockDispositionProjection(dbFor(restored),'source-900'),await disposition.stockDispositionProjection(dbFor(source),'source-900'))
  assert.deepEqual(await funding.readStockFundingAp(restored.env,actor),await funding.readStockFundingAp(source.env,actor))
  const expandedBefore=snapshot(restored)
  for(const action of [()=>disposition.commitStockDisposition(restored.env,actor,secondHold),()=>disposition.commitStockDisposition(restored.env,actor,partialDispose),()=>funding.commitStockFunding(restored.env,actor,shipping),()=>funding.commitStockFunding(restored.env,actor,secondRefund)])assert.equal((await action()).replayed,true)
  assert.equal(snapshot(restored),expandedBefore)
  assert.deepEqual(restored.db.prepare('PRAGMA foreign_key_check').all(),[])
  console.log('PASS chronological multiple allocations/partial disposal/canceled claim/shipping fee/second credit/refund exact roundtrip and replay')
  restored.db.close();source.db.close()
  assert.deepEqual(failures,[],'malformed complete-shaped histories must refuse before business mutation')
}
main().catch(error=>{console.error(error);process.exitCode=1})
