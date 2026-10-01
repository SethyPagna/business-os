import { getDb, type D1Compat } from './db'
import type { SessionUser } from './auth'
import { currentFundingActor, planStockFunding, stockFundingPhysicalSql } from './stockFunding'
import { ordinaryBusinessBatch } from './businessMaintenanceGuard'
import { exactMoney4, quantityDecimal } from './stockDispositionBasis'
import { feeRequestDigest, normalizeFeeRequestId } from './feeOperationReceipt'
import { applyValuationCoverage, splitValuationSegment, valuationTotals, type ValuationSegment } from './stockValuationMath'

export class StockValuationError extends Error {
  constructor(public code: string,public statusCode:400|403|409=409) { super(code) }
}
const refuse=(code:string,status:400|403|409=409):never=>{throw new StockValuationError(code,status)}
const identity=(value:unknown):string=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=120?value:refuse('invalid_valuation_identity',400)
type Statement={sql:string;params?:Record<string,unknown>}
type Source={id:string;batch_id:number;movement_id:number;product_id:number;branch_id:number;quantity:string;gross4:number;source_json:string}
type Funding={id:string;source_id:string;generation:number;gross4:number;paid4:number;debt4:number;credit4:number;asset4:number;cash_in4:number;cash_out4:number;shipping4:number}
const fundingSql='SELECT id,source_id,generation,gross4,paid4,debt4,credit4,asset4,cash_in4,cash_out4,shipping4 FROM stock_funding_events'
const segmentsSql='SELECT segment_id,allocation_id,fate,quantity,gross4,coverage4,loss4,recovery4,reason FROM stock_valuation_segments WHERE event_id=@event ORDER BY segment_id'
async function replay(db:D1Compat,actor:SessionUser,request:string,digest:string,requestJson:string) {
  const saved=await db.prepare('SELECT * FROM stock_valuation_receipts WHERE request_id=@request').get<{actor_id:number;request_digest:string;request_json:string;response_json:string;event_id:string}>({request})
  if(!saved) return null
  if(saved.actor_id!==actor.id||saved.request_digest!==digest||saved.request_json!==requestJson) return refuse('valuation_request_intent_conflict')
  let response:Record<string,unknown>
  try {response=JSON.parse(saved.response_json)} catch{return refuse('valuation_receipt_corrupt')}
  const keys=['valuation_version','source_id','event_id','revision','kind','funding','segments','totals','pending4']
  if(!response||Array.isArray(response)||Object.keys(response).join('|')!==keys.join('|')||JSON.stringify(response)!==saved.response_json||response.valuation_version!==3||response.event_id!==saved.event_id) return refuse('valuation_receipt_corrupt')
  const event=await db.prepare('SELECT source_id,revision,kind FROM stock_valuation_events WHERE id=@event').get({event:saved.event_id})
  const segments=await db.prepare(segmentsSql).all<ValuationSegment>({event:saved.event_id})
  const funding=response.funding as Funding
  const actual=await db.prepare(fundingSql+' WHERE id=@id AND source_id=@source').get<Funding>({id:funding?.id,source:response.source_id})
  if(!event||response.source_id!==event.source_id||response.revision!==event.revision||response.kind!==event.kind||JSON.stringify(actual)!==JSON.stringify(funding)||JSON.stringify(segments)!==JSON.stringify(response.segments)||JSON.stringify(valuationTotals(segments,funding.gross4))!==JSON.stringify(response.totals)||!Number.isSafeInteger(response.pending4)||Number(response.pending4)<0) return refuse('valuation_receipt_corrupt')
  return {...response,replayed:true}
}

export async function commitStockValuation(env:{DB:D1Database;IMPORT_DB?:D1Database},actor:SessionUser,input:unknown) {
  if(!input||typeof input!=='object'||Array.isArray(input)) return refuse('invalid_request',400)
  const raw=input as Record<string,unknown>
  const allowed=['kind','source_id','expected_revision','expected_generation','client_request_id','funding','segment_id','child_segment_id','quantity','reason','expense_category','agreement_id','amount_usd','targets','shares','proof','cash_method','cash_reference','cash_recorded_at','fee_id']
  if(Object.keys(raw).some(key=>!allowed.includes(key))) return refuse('unsupported_valuation_field',400)
  const kind=identity(raw.kind),sourceId=identity(raw.source_id),request=normalizeFeeRequestId(raw.client_request_id)
  if(!request||!Number.isSafeInteger(raw.expected_revision)||Number(raw.expected_revision)<0||!Number.isSafeInteger(raw.expected_generation)||Number(raw.expected_generation)<0) return refuse('invalid_valuation_revision',400)
  if(!['admit','hold','dispose','repair','pending','accept','refund','payment','shipping'].includes(kind)) return refuse('unsupported_valuation_transition',400)
  const revision=Number(raw.expected_revision),generation=Number(raw.expected_generation),db=getDb(env)
  await currentFundingActor(db,actor,['refund','payment','shipping'].includes(kind))
  const requestJson=JSON.stringify(raw),digest=await feeRequestDigest(requestJson)
  const cached=await replay(db,actor,request,digest,requestJson)
  if(cached) return cached
  const at=new Date().toISOString(),event=crypto.randomUUID(),token=`${request}:valuation`,params:Record<string,unknown>={source:sourceId,actor:actor.id,event,revision,nextRevision:kind==='admit'?0:revision+1,kind,at,token,request,digest,requestJson}
  const statements:Statement[]=[],assertSql=(condition:string)=>statements.push({sql:`SELECT CASE WHEN (${condition}) THEN 1 ELSE json_extract('[1]','$[valuation_assertion_failed]') END`,params})
  const latest=await db.prepare('SELECT id,revision FROM stock_valuation_latest WHERE source_id=@source').get<{id:string;revision:number}>({source:sourceId})
  if((kind==='admit'&&(latest||revision!==0))||(kind!=='admit'&&(!latest||latest.revision!==revision))) return refuse('valuation_revision_conflict')
  let segments:ValuationSegment[]=latest?await db.prepare(segmentsSql).all<ValuationSegment>({event:latest.id}):[]
  let funding=await db.prepare(fundingSql+' WHERE source_id=@source ORDER BY generation DESC LIMIT 1').get<Funding>({source:sourceId})
  if(kind!=='admit'&&(!funding||funding.generation!==generation)) return refuse('funding_generation_conflict')
  let source=await db.prepare('SELECT * FROM stock_funding_sources WHERE id=@source').get<Source>({source:sourceId})
  const fundingKind=['admit','pending','accept','refund','payment','shipping'].includes(kind)
  let plan:Awaited<ReturnType<typeof planStockFunding>>|null=null,amount4=0,agreement:string|null=null,shares:{segment_id:string;amount4:number}[]=[],targets:{allocation_id:string;amount4:number}[]=[],pending4=0
  if(kind==='pending'||kind==='accept') {
    agreement=identity(raw.agreement_id)
    if(kind==='pending') {
      amount4=exactMoney4(raw.amount_usd)
      if(!Array.isArray(raw.targets)||!raw.targets.length||raw.targets.length>100) return refuse('explicit_agreement_targets_required',400)
      targets=raw.targets.map(value=>{
        if(!value||typeof value!=='object'||Object.keys(value).sort().join('|')!=='allocation_id|amount_usd') return refuse('invalid_agreement_target',400)
        const target=value as Record<string,unknown>
        return {allocation_id:identity(target.allocation_id),amount4:exactMoney4(target.amount_usd)}
      })
      if(new Set(targets.map(t=>t.allocation_id)).size!==targets.length||targets.reduce((n,t)=>n+t.amount4,0)!==amount4||targets.some(t=>t.amount4<=0||t.amount4>segments.filter(s=>s.allocation_id===t.allocation_id&&s.fate!=='sellable').reduce((n,s)=>n+s.gross4-s.coverage4,0))) return refuse('agreement_targets_exceed_basis')
    } else {
      const agreed=await db.prepare('SELECT amount4,targets_json FROM stock_valuation_agreements WHERE id=@agreement AND source_id=@source').get<{amount4:number;targets_json:string}>({agreement,source:sourceId})
      if(!agreed||!Array.isArray(raw.shares)||!raw.shares.length||raw.shares.length>100) return refuse('explicit_acceptance_shares_required',400)
      targets=JSON.parse(agreed.targets_json)
      shares=raw.shares.map(value=>{
        if(!value||typeof value!=='object'||Object.keys(value).sort().join('|')!=='amount_usd|segment_id') return refuse('invalid_accepted_share',400)
        const share=value as Record<string,unknown>
        return {segment_id:identity(share.segment_id),amount4:exactMoney4(share.amount_usd)}
      })
      if(new Set(shares.map(s=>s.segment_id)).size!==shares.length) return refuse('duplicate_accepted_target',400)
      const prior=await db.prepare('SELECT a.amount4,s.allocation_id FROM stock_valuation_acceptances a JOIN stock_valuation_segments s ON s.event_id=a.event_id AND s.segment_id=a.target_segment_id WHERE a.agreement_id=@agreement').all<{amount4:number;allocation_id:string}>({agreement})
      amount4=shares.reduce((n,s)=>n+s.amount4,0)
      if(amount4<=0||amount4+prior.reduce((n,s)=>n+s.amount4,0)>agreed.amount4) return refuse('agreement_acceptance_exceeded')
      for(const target of targets) {
        const accepted=shares.filter(share=>segments.find(s=>s.segment_id===share.segment_id)?.allocation_id===target.allocation_id).reduce((n,s)=>n+s.amount4,0)
        if(accepted+prior.filter(s=>s.allocation_id===target.allocation_id).reduce((n,s)=>n+s.amount4,0)>target.amount4) return refuse('agreement_target_acceptance_exceeded')
      }
      for(const share of shares) {
        const index=segments.findIndex(s=>s.segment_id===share.segment_id)
        if(index<0||!targets.some(t=>t.allocation_id===segments[index].allocation_id)) return refuse('unagreed_coverage_target')
        try{segments[index]=applyValuationCoverage(segments[index],share.amount4)}catch{return refuse('ineligible_coverage_target')}
      }
    }
  }
  if(fundingKind) {
    const fundingInput=kind==='admit'?{...(raw.funding as Record<string,unknown>),kind,source_id:sourceId,expected_generation:generation,client_request_id:`${request}-funding`}:{kind,source_id:sourceId,expected_generation:generation,client_request_id:`${request}-funding`,proof:raw.proof,...(kind==='pending'||kind==='accept'?{claim_id:agreement,...(kind==='pending'?{amount_usd:raw.amount_usd}:{})}:{amount_usd:raw.amount_usd,...(['refund','payment'].includes(kind)?{cash_method:raw.cash_method,cash_reference:raw.cash_reference,cash_recorded_at:raw.cash_recorded_at}:{}),...(kind==='shipping'?{fee_id:raw.fee_id}:{})})}
    plan=await planStockFunding(env,actor,fundingInput,kind==='accept'?{acceptedAmount4:amount4,acceptedClaimId:`${agreement}:${event}`}:{})
    if('replay' in plan) return refuse('valuation_orphan_funding_receipt')
    source=plan.source
    const r=plan.response
    funding={id:r.event_id,source_id:sourceId,generation:r.generation,gross4:r.gross4,paid4:r.paid4,debt4:r.debt4,credit4:r.credit4,asset4:r.asset4,cash_in4:r.cash_in4,cash_out4:r.cash_out4,shipping4:r.shipping4}
  }
  if(!source||!funding) return refuse('valuation_source_missing')
  if(kind==='admit') {
    if(funding.credit4!==0) return refuse('valuation_existing_credit_requires_exact_adoption')
    segments=[{segment_id:'original',allocation_id:'original',fate:'sellable',quantity:source.quantity,gross4:source.gross4,coverage4:0,loss4:0,recovery4:0,reason:''}]
  } else {
    const physical=await db.prepare(stockFundingPhysicalSql).get({batch:source.batch_id,movement:source.movement_id})
    if(JSON.stringify(physical)!==source.source_json) return refuse('valuation_source_preimage_changed')
  }
  if(['hold','dispose','repair'].includes(kind)) {
    const segmentId=identity(raw.segment_id),childId=identity(raw.child_segment_id),index=segments.findIndex(s=>s.segment_id===segmentId)
    if(index<0||segments.some(s=>s.segment_id===childId)||segments[index].fate!==(kind==='hold'?'sellable':'held')) return refuse('valuation_segment_fate_conflict')
    let split:ReturnType<typeof splitValuationSegment>
    try{split=splitValuationSegment(segments[index],quantityDecimal(raw.quantity),childId,kind==='hold'?'held':kind==='repair'?'sellable':'disposed')}catch{return refuse('valuation_quantity_conflict',400)}
    if(kind==='hold') {split.child.allocation_id=childId;split.child.reason=identity(raw.reason)}
    if(kind==='repair') split.child.reason=''
    segments.splice(index,1,...(split.remainder?[split.remainder]:[]),split.child)
  }
  segments.sort((a,b)=>a.segment_id.localeCompare(b.segment_id))
  let totals:ReturnType<typeof valuationTotals>
  try{totals=valuationTotals(segments,source.gross4)}catch{return refuse('valuation_conservation_failed')}
  const before=latest?await db.prepare(segmentsSql).all<ValuationSegment>({event:latest.id}):[]
  const previous=latest?valuationTotals(before,source.gross4):totals
  const sellableBefore=latest?previous.sellable_quantity:source.quantity,sellableAfter=totals.sellable_quantity
  Object.assign(params,{batch:source.batch_id,branch:source.branch_id,product:source.product_id,beforeQty:Number(sellableBefore),afterQty:Number(sellableAfter),delta:Number(sellableAfter)-Number(sellableBefore),generation,sourceJson:source.source_json,loss:totals.historical_loss4-previous.historical_loss4,recovery:totals.recovery4-previous.recovery4,category:raw.expense_category===undefined?null:identity(raw.expense_category),name:(await currentFundingActor(db,actor,false)).name})
  const currentActor=await db.prepare('SELECT permissions,role_id FROM users WHERE id=@actor').get<{permissions:string;role_id:number|null}>({actor:actor.id})
  const role=await db.prepare('SELECT permissions,code FROM roles WHERE id=@role').get({role:currentActor?.role_id})
  Object.assign(params,{permissions:currentActor?.permissions,role:currentActor?.role_id,rolePermissions:role?.permissions,roleCode:role?.code})
  const actorGuard='EXISTS(SELECT 1 FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=@actor AND u.is_active=1 AND u.deleted_at IS NULL AND u.permissions IS @permissions AND u.role_id IS @role AND r.permissions IS @rolePermissions AND r.code IS @roleCode)'
  assertSql(`${actorGuard} AND ${latest?'EXISTS(SELECT 1 FROM stock_valuation_latest WHERE source_id=@source AND revision=@revision)':'NOT EXISTS(SELECT 1 FROM stock_valuation_sources WHERE source_id=@source)'} AND EXISTS(SELECT 1 FROM branch_batch_stock WHERE batch_id=@batch AND branch_id=@branch AND quantity=@beforeQty)`)
  statements.push({sql:'INSERT INTO stock_valuation_guards(token,valid) VALUES(@token,1)',params})
  if(kind==='admit') {
    statements.push(...plan!.statements)
    statements.push({sql:'INSERT INTO stock_valuation_sources(source_id,opening_json) VALUES(@source,@sourceJson)',params})
  }
  statements.push({sql:'INSERT INTO stock_valuation_context(token,source_id,batch_id,branch_id,remaining_quantity,funding_allowed) VALUES(@token,@source,@batch,@branch,@afterQty,1)',params})
  if(kind!=='admit'&&plan&&!('replay' in plan)) statements.push(...plan.statements)
  if(kind==='pending') statements.push({sql:'INSERT INTO stock_valuation_agreements(id,source_id,amount4,targets_json,proof) VALUES(@agreement,@source,@amount,@targets,@proof)',params:{...params,agreement,amount:amount4,targets:JSON.stringify(targets),proof:identity(raw.proof)}})
  statements.push({sql:'INSERT INTO stock_valuation_events(id,source_id,revision,kind,loss4,recovery4,expense_category,actor_id,occurred_at) VALUES(@event,@source,@nextRevision,@kind,@loss,@recovery,@category,@actor,@at)',params})
  for(const segment of segments) statements.push({sql:'INSERT INTO stock_valuation_segments(event_id,segment_id,allocation_id,fate,quantity,gross4,coverage4,loss4,recovery4,reason) VALUES(@event,@segment_id,@allocation_id,@fate,@quantity,@gross4,@coverage4,@loss4,@recovery4,@reason)',params:{event,...segment}})
  for(const share of shares) statements.push({sql:'INSERT INTO stock_valuation_acceptances(event_id,agreement_id,target_segment_id,amount4,funding_event_id) VALUES(@event,@agreement,@segment,@amount,@funding)',params:{event,agreement,segment:share.segment_id,amount:share.amount4,funding:funding.id}})
  if(sellableAfter!==sellableBefore) statements.push({sql:'UPDATE branch_batch_stock SET quantity=@afterQty WHERE batch_id=@batch AND branch_id=@branch AND quantity=@beforeQty',params},{sql:'UPDATE branch_stock SET quantity=quantity+@delta WHERE product_id=@product AND branch_id=@branch',params},{sql:'UPDATE products SET stock_quantity=stock_quantity+@delta WHERE id=@product',params})
  const agreements=await db.prepare('SELECT a.amount4-(SELECT COALESCE(SUM(x.amount4),0) FROM stock_valuation_acceptances x WHERE x.agreement_id=a.id) pending4 FROM stock_valuation_agreements a WHERE a.source_id=@source').all<{pending4:number}>({source:sourceId})
  pending4=agreements.reduce((n,a)=>n+a.pending4,0)+(kind==='pending'?amount4:0)-(kind==='accept'?amount4:0)
  const response={valuation_version:3,source_id:sourceId,event_id:event,revision:Number(params.nextRevision),kind,funding,segments,totals,pending4},responseJson=JSON.stringify(response)
  Object.assign(params,{responseJson,segmentsJson:JSON.stringify(segments),fundingId:funding.id})
  statements.push({sql:'INSERT INTO stock_valuation_receipts(request_id,event_id,actor_id,request_digest,request_json,response_json) VALUES(@request,@event,@actor,@digest,@requestJson,@responseJson)',params},{sql:"INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,new_value) VALUES(@actor,@name,@kind,'stock_valuation',@event,@responseJson,'stock_valuation_events',@event,@responseJson)",params})
  assertSql(`${actorGuard} AND EXISTS(SELECT 1 FROM stock_valuation_context WHERE token=@token AND source_id=@source AND remaining_quantity=@afterQty) AND EXISTS(SELECT 1 FROM branch_batch_stock WHERE batch_id=@batch AND branch_id=@branch AND quantity=@afterQty) AND EXISTS(SELECT 1 FROM stock_valuation_latest WHERE id=@event AND revision=@nextRevision AND loss4=@loss AND recovery4=@recovery) AND EXISTS(SELECT 1 FROM stock_valuation_receipts WHERE request_id=@request AND event_id=@event AND actor_id=@actor AND response_json=@responseJson AND request_json=@requestJson AND request_digest=@digest) AND (SELECT COUNT(*) FROM audit_logs WHERE entity='stock_valuation' AND entity_id=@event AND details=@responseJson)=1 AND EXISTS(SELECT 1 FROM stock_funding_latest WHERE id=@fundingId)`)
  for(const segment of segments) statements.push({sql:`SELECT CASE WHEN EXISTS(SELECT 1 FROM stock_valuation_segments WHERE event_id=@event AND segment_id=@segment_id AND allocation_id=@allocation_id AND fate=@fate AND quantity=@quantity AND gross4=@gross4 AND coverage4=@coverage4 AND loss4=@loss4 AND recovery4=@recovery4 AND reason=@reason) THEN 1 ELSE json_extract('[1]','$[valuation_segment_missing]') END`,params:{event,...segment}})
  statements.push({sql:'DELETE FROM stock_valuation_context WHERE token=@token',params},{sql:'DELETE FROM stock_valuation_guards WHERE token=@token',params})
  assertSql('NOT EXISTS(SELECT 1 FROM stock_valuation_context WHERE token=@token) AND NOT EXISTS(SELECT 1 FROM stock_valuation_guards WHERE token=@token)')
  try{await ordinaryBusinessBatch(db,statements)}catch{await currentFundingActor(db,actor,['refund','payment','shipping'].includes(kind));const saved=await replay(db,actor,request,digest,requestJson);if(saved)return saved;return refuse('valuation_atomic_conflict')}
  await currentFundingActor(db,actor,['refund','payment','shipping'].includes(kind))
  return {...response,replayed:false}
}
