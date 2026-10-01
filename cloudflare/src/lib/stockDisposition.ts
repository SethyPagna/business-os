import { getDb, type D1Compat } from './db'
import type { SessionUser } from './auth'
import { getActionTier } from './permissions'
import { canViewAcquisitionCosts, canEditAcquisitionCosts } from './acquisitionCostAccess'
import { allocateDispositionBasis, exactMoney4, quantityDecimal, subtractQuantity } from './stockDispositionBasis'
import { STOCK_CONDITION_TAGS } from './stockCondition'
import { businessToday } from './businessDateWindow'
import { branchCanSell } from './branchRoles'
import { ordinaryBusinessBatch } from './businessMaintenanceGuard'
import { canonicalFeeCreateRequest, feeCreateAuditStatement, feeOperationReceiptStatement, feeRequestDigest, normalizeFeeRequestId, type FeeCreateIntent } from './feeOperationReceipt'

export class StockDispositionError extends Error {
  constructor(public code: string, public statusCode: 400 | 403 | 409 | 503 = 409) { super(code) }
}
type Source = { id: string; movement_id: number; batch_id: number; product_id: number; branch_id: number; supplier_id: number; quantity: string; free_quantity: string; gross4: number; opening_paid4: number; opening_debt4: number; funding_state: string }
type Allocation = { id: string; source_id: string; quantity: string; gross4: number; coverage4: number; condition_tag: string }
type Event = { generation: number; remaining_quantity: string; remaining_gross4: number; remaining_coverage4: number }
type Receipt = { actor_id: number; request_digest: string; request_json: string; response_json: string }
type Statement = { sql: string; params?: Record<string, unknown> }
const refuse = (code: string, status: 400 | 403 | 409 | 503 = 409): never => { throw new StockDispositionError(code,status) }

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) return refuse('invalid_text',400)
  return value.trim()
}
function positiveId(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) return refuse('invalid_identity',400)
  return Number(value)
}
async function currentActor(db: D1Compat, actor: SessionUser, requiresFeePermission = false) {
  const current = await db.prepare(`SELECT u.id,u.username,u.name,u.permissions,u.role_id,u.is_active,u.deleted_at,
    r.code AS role_code,r.permissions AS role_permissions FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=@actor`).get<SessionUser & { deleted_at: string | null }>({ actor: actor.id })
  if (!current || current.is_active !== 1 || current.deleted_at || getActionTier(current,'inventory','adjust') !== 'full' || !canEditAcquisitionCosts(current) || !canViewAcquisitionCosts(current)) return refuse('permission_denied',403)
  if (requiresFeePermission && getActionTier(current,'fees','add') !== 'full') return refuse('fee_permission_denied',403)
  return current
}
async function readReceipt(db: D1Compat, request: string) {
  return db.prepare('SELECT actor_id,request_digest,request_json,response_json FROM stock_disposition_receipts WHERE request_id=@request').get<Receipt>({ request })
}
function replay(row: Receipt, actor: number, digest: string, requestJson: string) {
  if (row.actor_id !== actor || row.request_digest !== digest || row.request_json !== requestJson) return refuse('request_intent_conflict')
  return { ...JSON.parse(row.response_json) as Record<string, unknown>, replayed: true }
}

export async function commitStockDisposition(env: { DB: D1Database; IMPORT_DB?: D1Database }, actor: SessionUser, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return refuse('invalid_request',400)
  const raw = input as Record<string,unknown>
  const allowed = ['kind','source_id','batch_id','product_id','branch_id','supplier_id','quantity','coverage_usd','coverage_state','condition_tag','allocation_id','reason','expense_category','extra_fee_usd','expected_generation','client_request_id']
  if (Object.keys(raw).some(key => !allowed.includes(key))) return refuse('unsupported_request_field',400)
  const kind = raw.kind
  if (kind !== 'hold' && kind !== 'dispose') return refuse('unsupported_transition',400)
  const request = normalizeFeeRequestId(raw.client_request_id)
  if (!request) return refuse('invalid_request_id',400)
  const sourceId = text(raw.source_id,120), reason = text(raw.reason,500)
  const batch = positiveId(raw.batch_id), product = positiveId(raw.product_id), branch = positiveId(raw.branch_id), supplier = positiveId(raw.supplier_id)
  if (!Number.isSafeInteger(raw.expected_generation) || Number(raw.expected_generation) < 0) return refuse('invalid_generation',400)
  let quantity: string, coverage4: number, extraFee4: number
  try {
    quantity = quantityDecimal(raw.quantity)
    coverage4 = exactMoney4(raw.coverage_usd === undefined ? 0 : raw.coverage_usd)
    extraFee4 = exactMoney4(raw.extra_fee_usd === undefined ? 0 : raw.extra_fee_usd)
  } catch { return refuse('unsupported_quantity_or_money_precision',400) }
  const coverageState = coverage4 > 0 ? 'accepted_credit' : 'none'
  if ((coverage4 > 0 && raw.coverage_state !== coverageState) || (raw.coverage_state !== undefined && raw.coverage_state !== coverageState)) return refuse('unsupported_coverage_state',400)
  const allocationId = kind === 'dispose' ? text(raw.allocation_id,120) : null
  const condition = kind === 'hold' ? text(raw.condition_tag,30) : null
  if (kind === 'hold' && !STOCK_CONDITION_TAGS.includes(condition as typeof STOCK_CONDITION_TAGS[number])) return refuse('invalid_condition_tag',400)
  if ((kind === 'dispose' && (coverage4 !== 0 || raw.condition_tag !== undefined)) || (kind === 'hold' && (raw.allocation_id !== undefined || raw.expense_category !== undefined))) return refuse('unsupported_transition_field',400)
  const category = raw.expense_category == null ? null : text(raw.expense_category,120)
  const generation = Number(raw.expected_generation)
  const requestJson = JSON.stringify({ kind, sourceId,batch,product,branch,supplier,quantity,coverage4,coverageState,extraFee4,allocationId,condition,reason,category,generation })
  const digest = await feeRequestDigest(requestJson), db = getDb(env)
  const current = await currentActor(db,actor,extraFee4 > 0)
  const existing = await readReceipt(db,request)
  if (existing) return replay(existing,actor.id,digest,requestJson)
  const source = await db.prepare('SELECT * FROM stock_disposition_sources WHERE id=@source').get<Source>({ source: sourceId })
  if (!source || source.batch_id !== batch || source.product_id !== product || source.branch_id !== branch || source.supplier_id !== supplier) return refuse('source_identity_mismatch')
  if (source.funding_state !== 'reconciled_unpaid' || source.opening_paid4 !== 0 || source.opening_debt4 !== source.gross4) return refuse('unreconciled_source_funding')
  const preimage = await db.prepare(`SELECT pb.received_quantity,pb.received_cost_usd,pb.supplier_id,pb.payment_status,pb.received_branch_id,pb.is_active,
    im.quantity AS movement_quantity,im.free_quantity,im.total_cost_usd,im.movement_type,im.reference_id,im.product_id,im.branch_id,im.batch_id,
    bbs.quantity AS batch_stock,bs.quantity AS branch_stock,b.name AS branch_name,b.is_active AS branch_active,
    p.is_active AS product_active
    FROM product_batches pb JOIN inventory_movements im ON im.id=@movement
    JOIN branch_batch_stock bbs ON bbs.batch_id=pb.id AND bbs.branch_id=@branch
    JOIN branch_stock bs ON bs.product_id=@product AND bs.branch_id=@branch
    JOIN branches b ON b.id=@branch JOIN products p ON p.id=@product WHERE pb.id=@batch AND pb.variant_product_id=@product`).get<Record<string,unknown>>({ movement: source.movement_id,branch,product,batch })
  if (!preimage || preimage.is_active !== 1 || preimage.branch_active !== 1 || preimage.product_active !== 1 || preimage.payment_status !== 'credit' || preimage.supplier_id !== supplier || preimage.received_branch_id !== branch || preimage.product_id !== product || preimage.branch_id !== branch || preimage.batch_id !== batch || !['add','in'].includes(String(preimage.movement_type))) return refuse('source_preimage_changed')
  try {
    if (quantityDecimal(preimage.received_quantity) !== source.quantity || quantityDecimal(preimage.movement_quantity) !== source.quantity || quantityDecimal(preimage.free_quantity,true) !== source.free_quantity || exactMoney4(preimage.received_cost_usd) !== source.gross4 || exactMoney4(preimage.total_cost_usd) !== source.gross4) return refuse('source_preimage_changed')
    subtractQuantity(source.quantity,[source.free_quantity])
  } catch { return refuse('source_basis_unknown_or_changed') }
  const allocations = await db.prepare('SELECT * FROM stock_disposition_allocations WHERE source_id=@source').all<Allocation>({ source: sourceId })
  const events = await db.prepare('SELECT allocation_id,generation,recognized4,remaining_quantity,remaining_gross4,remaining_coverage4 FROM stock_disposition_events WHERE source_id=@source ORDER BY generation').all<Event & { allocation_id: string; recognized4:number }>({ source: sourceId })
  if ((events.at(-1)?.generation ?? 0) !== generation) return refuse('stale_generation')
  let remainingSource: string, sellable: string, available: string, gross: number, coverage: number
  try {
    remainingSource = subtractQuantity(source.quantity,allocations.map(row => row.quantity))
    sellable = quantityDecimal(preimage.batch_stock,true)
    if (sellable !== remainingSource) return refuse('source_stock_changed')
    if (Number(preimage.branch_stock) < Number(sellable)) return refuse('source_stock_changed')
    if (kind === 'hold') {
      available = remainingSource
      gross = source.gross4 - allocations.reduce((sum,row) => sum + row.gross4,0)
      coverage = 0
    } else {
      const allocation = allocations.find(row => row.id === allocationId)
      const latest = events.filter(row => row.allocation_id === allocationId).at(-1)
      if (!allocation || !latest) return refuse('allocation_identity_mismatch')
      available = latest.remaining_quantity; gross = latest.remaining_gross4; coverage = latest.remaining_coverage4
    }
  } catch (error) { if (error instanceof StockDispositionError) throw error; return refuse('unsupported_quantity_state') }
  let basis: ReturnType<typeof allocateDispositionBasis>
  try { basis = allocateDispositionBasis(available,gross,coverage,quantity) } catch { return refuse('insufficient_or_unsupported_quantity') }
  if (kind === 'hold' && coverage4 > basis.gross4) return refuse('coverage_exceeds_source_basis',400)
  if (extraFee4 && (!branchCanSell(String(preimage.branch_name)) || getActionTier(current,'fees','add') !== 'full')) return refuse('fee_permission_or_branch_denied',403)
  const eventId = crypto.randomUUID(), allocation = allocationId || crypto.randomUUID(), occurredAt = new Date().toISOString()
  const after = kind === 'hold' ? { quantity, gross4: basis.gross4,coverage4 } : { quantity: basis.remainingQuantity,gross4: basis.remainingGross4,coverage4: basis.remainingCoverage4 }
  const response = { event_id: eventId,allocation_id: allocation,source_id: sourceId,generation: generation+1,kind,quantity,gross4: basis.gross4,coverage4: kind === 'hold' ? coverage4 : basis.coverage4,coverage_state: kind === 'hold' ? coverageState : basis.coverage4 > 0 ? 'allocated_accepted_credit' : 'none',net4: kind === 'hold' ? basis.gross4-coverage4 : basis.net4,recognized4: kind === 'dispose' ? basis.net4 : 0,remaining_quantity: after.quantity,remaining_gross4: after.gross4,remaining_coverage4: after.coverage4,extra_fee4: extraFee4 }
  const params = { source: sourceId, batch,product,branch,supplier,movement: source.movement_id,sourceQty: source.quantity,freeQty: source.free_quantity,sourceGross: source.gross4,
    generation,actor: actor.id,permissions: current.permissions,roleId: current.role_id,rolePermissions: current.role_permissions,roleCode: current.role_code,
    referenceId: preimage.reference_id,branchStock: preimage.branch_stock,sellable: Number(sellable),token: eventId }
  const statements: Statement[] = [{ sql: `INSERT INTO stock_disposition_guards(token,valid) VALUES(@token,CASE WHEN
    (SELECT COALESCE(MAX(generation),0) FROM stock_disposition_events WHERE source_id=@source)=@generation
    AND EXISTS(SELECT 1 FROM stock_disposition_sources WHERE id=@source AND movement_id=@movement AND batch_id=@batch AND product_id=@product AND branch_id=@branch AND supplier_id=@supplier AND quantity=@sourceQty AND free_quantity=@freeQty AND gross4=@sourceGross AND funding_state='reconciled_unpaid' AND opening_paid4=0 AND opening_debt4=@sourceGross)
    AND EXISTS(SELECT 1 FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=@actor AND u.is_active=1 AND u.deleted_at IS NULL AND u.permissions IS @permissions AND u.role_id IS @roleId AND r.permissions IS @rolePermissions AND r.code IS @roleCode)
    AND EXISTS(SELECT 1 FROM product_batches WHERE id=@batch AND variant_product_id=@product AND is_active=1 AND supplier_id=@supplier AND payment_status='credit' AND received_branch_id=@branch AND received_quantity=CAST(@sourceQty AS REAL) AND received_cost_usd=@sourceGross/10000.0)
    AND EXISTS(SELECT 1 FROM inventory_movements WHERE id=@movement AND product_id=@product AND batch_id=@batch AND branch_id=@branch AND quantity=CAST(@sourceQty AS REAL) AND free_quantity=CAST(@freeQty AS REAL) AND total_cost_usd=@sourceGross/10000.0 AND reference_id IS @referenceId AND movement_type IN ('add','in'))
    AND EXISTS(SELECT 1 FROM branch_batch_stock WHERE batch_id=@batch AND branch_id=@branch AND quantity=@sellable)
    AND EXISTS(SELECT 1 FROM branch_stock WHERE product_id=@product AND branch_id=@branch AND quantity=@branchStock)
    AND EXISTS(SELECT 1 FROM products WHERE id=@product AND is_active=1)
    AND EXISTS(SELECT 1 FROM branches WHERE id=@branch AND is_active=1 AND name=@branchName)
    THEN 1 ELSE 0 END)`, params: { ...params,branchName: preimage.branch_name } }]
  if (kind === 'hold') {
    statements.push({ sql: 'INSERT INTO stock_disposition_allocations(id,source_id,quantity,gross4,coverage4,condition_tag) VALUES(@id,@source,@quantity,@gross,@coverage,@condition)',params: { id: allocation,source: sourceId,quantity,gross: basis.gross4,coverage: coverage4,condition } },
      { sql: 'UPDATE branch_batch_stock SET quantity=@remaining WHERE batch_id=@batch AND branch_id=@branch',params: { remaining: Number(basis.remainingQuantity),batch,branch } },
      { sql: 'UPDATE branch_stock SET quantity=@remaining WHERE product_id=@product AND branch_id=@branch',params: { remaining: Number(subtractQuantity(preimage.branch_stock,[quantity])),product,branch } },
      { sql: 'UPDATE products SET stock_quantity=(SELECT COALESCE(SUM(quantity),0) FROM branch_stock WHERE product_id=@product) WHERE id=@product',params: { product } })
  }
  statements.push({ sql: `INSERT INTO stock_disposition_events(id,source_id,allocation_id,generation,kind,quantity,gross4,coverage4,net4,recognized4,remaining_quantity,remaining_gross4,remaining_coverage4,reason,expense_category,actor_id,occurred_at)
    VALUES(@event,@source,@allocation,@generation,@kind,@quantity,@gross4,@coverage4,@net4,@recognized4,@remainingQuantity,@remainingGross,@remainingCoverage,@reason,@category,@actor,@occurredAt)`, params: { event: eventId,source: sourceId,allocation,generation:generation+1,kind,quantity,gross4:response.gross4,coverage4:response.coverage4,net4:response.net4,recognized4:response.recognized4,remainingQuantity:after.quantity,remainingGross:after.gross4,remainingCoverage:after.coverage4,reason,category,actor:actor.id,occurredAt } })
  let feePostcondition = '', feePostconditionParams: Record<string,unknown> = {}
  if (extraFee4) {
    const feeIntent: FeeCreateIntent = { fee_money_version:1,fee_type:'other',label:'Stock disposition shipping',amount_usd:extraFee4/10000,amount_khr:0,fee_date:businessToday(),sale_id:null,branch_id:branch,delivery_contact_id:null,notes:`Stock disposition ${eventId}` }
    const feeRequest = `disposition_${eventId}`, feeJson = canonicalFeeCreateRequest(feeIntent), feeDigest = await feeRequestDigest(feeJson)
    statements.push({ sql: `INSERT INTO fees(fee_type,label,amount_usd,amount_khr,fee_date,sale_id,branch_id,delivery_contact_id,notes,created_by,created_by_name,created_at,updated_at)
      VALUES(@type,@label,@usd,0,@date,NULL,@branch,NULL,@notes,@actor,@name,@at,@at)`,params: { type:feeIntent.fee_type,label:feeIntent.label,usd:feeIntent.amount_usd,date:feeIntent.fee_date,branch,notes:feeIntent.notes,actor:actor.id,name:current.name,at:occurredAt } },
      feeOperationReceiptStatement({ receiptId:crypto.randomUUID(),actorId:actor.id,actorName:current.name,requestId:feeRequest,digest:feeDigest,requestJson:feeJson,occurredAt,intent:feeIntent,resolvedBranchId:branch }),
      { sql: 'INSERT INTO stock_disposition_fees(event_id,fee_id,amount4) SELECT @event,fee_id,@amount FROM fee_operation_receipts WHERE actor_id=@actor AND request_id=@request',params: { event:eventId,amount:extraFee4,actor:actor.id,request:feeRequest } },
      feeCreateAuditStatement({ actorId:actor.id,actorName:current.name,requestId:feeRequest,digest:feeDigest,resolvedBranchId:branch }))
    const feeResponse = JSON.stringify({ fee: { fee_type:feeIntent.fee_type,label:feeIntent.label,amount_usd:feeIntent.amount_usd,amount_khr:0,fee_date:feeIntent.fee_date,sale_id:null,branch_id:branch,delivery_contact_id:null,notes:feeIntent.notes,created_by:actor.id,created_by_name:current.name,created_at:occurredAt,updated_at:occurredAt } })
    feePostcondition = `AND EXISTS(SELECT 1 FROM stock_disposition_fees link
      JOIN fee_operation_receipts fr ON fr.fee_id=link.fee_id JOIN fees f ON f.id=link.fee_id
      WHERE link.event_id=@event AND link.amount4=@fee4 AND fr.actor_id=@actor AND fr.request_id=@feeRequest
      AND fr.request_digest=@feeDigest AND fr.request_json=@feeJson AND fr.occurred_at=@occurredAt
      AND json_extract(fr.response_json,'$.fee.id')=f.id
      AND NOT EXISTS(SELECT 1 FROM json_each(json_extract(@feeResponse,'$.fee')) expected
        WHERE json_type(fr.response_json,'$.fee.'||expected.key) IS NULL
          OR json_extract(fr.response_json,'$.fee.'||expected.key) IS NOT expected.value)
      AND (SELECT COUNT(*) FROM json_each(json_extract(fr.response_json,'$.fee')) WHERE key!='id')
        =(SELECT COUNT(*) FROM json_each(json_extract(@feeResponse,'$.fee')))
      AND f.fee_type=@feeType AND f.label IS @feeLabel AND f.amount_usd=@feeUsd AND f.amount_khr=0
      AND f.fee_date=@feeDate AND f.sale_id IS NULL AND f.branch_id=@branch AND f.delivery_contact_id IS NULL
      AND f.notes IS @feeNotes AND f.created_by=@actor AND f.created_by_name IS @actorName
      AND f.created_at=@occurredAt AND f.updated_at=@occurredAt
      AND (SELECT COUNT(*) FROM audit_logs a WHERE a.user_id=@actor AND a.user_name IS @actorName
        AND a.action='create' AND a.entity='fee' AND a.entity_id=CAST(f.id AS TEXT)
        AND a.table_name='fees' AND a.record_id=CAST(f.id AS TEXT)
        AND a.new_value=json(json_extract(fr.response_json,'$.fee'))
        AND a.details=json_object('after',json(json_extract(fr.response_json,'$.fee')),'sale_id',NULL,
          'branch_id',@branch,'client_request_id',@feeRequest,'request_digest',@feeDigest))=1)`
    feePostconditionParams = { fee4:extraFee4,feeRequest,feeDigest,feeJson,feeResponse,feeType:feeIntent.fee_type,feeLabel:feeIntent.label,feeUsd:feeIntent.amount_usd,feeDate:feeIntent.fee_date,feeNotes:feeIntent.notes }
  }
  const responseJson = JSON.stringify(response)
  statements.push({ sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,new_value) VALUES(@actor,@name,@action,'stock_disposition',@event,@details,'stock_disposition_events',@event,@details)`,params: { actor:actor.id,name:current.name,action:kind,event:eventId,details:responseJson } },
    { sql: 'INSERT INTO stock_disposition_receipts(id,actor_id,request_id,request_digest,request_json,response_json,event_id) VALUES(@id,@actor,@request,@digest,@json,@response,@event)',params: { id:crypto.randomUUID(),actor:actor.id,request,digest,json:requestJson,response:responseJson,event:eventId } },
  )
  const latestByAllocation = new Map(events.map(row=>[row.allocation_id,row]))
  latestByAllocation.delete(allocation)
  const otherLatest = [...latestByAllocation.values()]
  const allocatedGross = allocations.reduce((sum,row)=>sum+row.gross4,0)+(kind === 'hold' ? basis.gross4 : 0)
  const allocatedCoverage = allocations.reduce((sum,row)=>sum+row.coverage4,0)+(kind === 'hold' ? coverage4 : 0)
  const heldGross = otherLatest.reduce((sum,row)=>sum+row.remaining_gross4,0)+after.gross4
  const heldCoverage = otherLatest.reduce((sum,row)=>sum+row.remaining_coverage4,0)+after.coverage4
  const postToken = `post_${eventId}`
  const postParams = { ...params,...feePostconditionParams,postToken,event:eventId,allocation,kind,quantity,
    allocatedQuantity: kind === 'hold' ? quantity : allocations.find(row=>row.id===allocation)?.quantity,
    allocationGross: kind === 'hold' ? basis.gross4 : allocations.find(row=>row.id===allocation)?.gross4,
    allocationCoverage: kind === 'hold' ? coverage4 : allocations.find(row=>row.id===allocation)?.coverage4,
    condition: kind === 'hold' ? condition : allocations.find(row=>row.id===allocation)?.condition_tag,
    gross4:response.gross4,coverage4:response.coverage4,net4:response.net4,recognized4:response.recognized4,
    remainingQuantity:after.quantity,remainingGross:after.gross4,remainingCoverage:after.coverage4,reason,category,
    occurredAt,actorName:current.name,request,digest,requestJson,responseJson,
    afterSellable:kind === 'hold' ? Number(basis.remainingQuantity) : Number(sellable),
    afterBranch:kind === 'hold' ? Number(subtractQuantity(preimage.branch_stock,[quantity])) : preimage.branch_stock,
    eventCount:events.length+1,allocationCount:allocations.length+(kind === 'hold' ? 1 : 0),allocatedGross,allocatedCoverage,
    heldGross,heldCoverage,recognizedTotal:events.reduce((sum,row)=>sum+row.recognized4,0)+response.recognized4 }
  statements.push({ sql: `INSERT INTO stock_disposition_guards(token,valid) VALUES(@postToken,CASE WHEN
    EXISTS(SELECT 1 FROM stock_disposition_guards WHERE token=@token AND valid=1)
    AND EXISTS(SELECT 1 FROM stock_disposition_allocations WHERE id=@allocation AND source_id=@source
      AND quantity=@allocatedQuantity AND gross4=@allocationGross AND coverage4=@allocationCoverage AND condition_tag=@condition)
    AND EXISTS(SELECT 1 FROM stock_disposition_events WHERE id=@event AND source_id=@source AND allocation_id=@allocation
      AND generation=@generation+1 AND kind=@kind AND quantity=@quantity AND gross4=@gross4 AND coverage4=@coverage4
      AND net4=@net4 AND recognized4=@recognized4 AND remaining_quantity=@remainingQuantity
      AND remaining_gross4=@remainingGross AND remaining_coverage4=@remainingCoverage AND reason=@reason
      AND expense_category IS @category AND actor_id=@actor AND occurred_at=@occurredAt)
    AND EXISTS(SELECT 1 FROM stock_disposition_receipts WHERE actor_id=@actor AND request_id=@request
      AND request_digest=@digest AND request_json=@requestJson AND response_json=@responseJson AND event_id=@event)
    AND (SELECT COUNT(*) FROM audit_logs WHERE user_id=@actor AND user_name IS @actorName AND action=@kind
      AND entity='stock_disposition' AND entity_id=@event AND table_name='stock_disposition_events'
      AND record_id=@event AND new_value=@responseJson AND details=@responseJson)=1
    AND EXISTS(SELECT 1 FROM branch_batch_stock WHERE batch_id=@batch AND branch_id=@branch AND quantity=@afterSellable)
    AND EXISTS(SELECT 1 FROM branch_stock WHERE product_id=@product AND branch_id=@branch AND quantity=@afterBranch)
    AND EXISTS(SELECT 1 FROM products WHERE id=@product AND is_active=1
      AND stock_quantity=(SELECT COALESCE(SUM(quantity),0) FROM branch_stock WHERE product_id=@product))
    AND EXISTS(SELECT 1 FROM product_batches WHERE id=@batch AND variant_product_id=@product AND is_active=1
      AND supplier_id=@supplier AND payment_status='credit' AND received_branch_id=@branch
      AND received_quantity=CAST(@sourceQty AS REAL) AND received_cost_usd=@sourceGross/10000.0)
    AND EXISTS(SELECT 1 FROM inventory_movements WHERE id=@movement AND product_id=@product AND batch_id=@batch AND branch_id=@branch
      AND quantity=CAST(@sourceQty AS REAL) AND free_quantity=CAST(@freeQty AS REAL) AND total_cost_usd=@sourceGross/10000.0
      AND reference_id IS @referenceId AND movement_type IN ('add','in'))
    AND EXISTS(SELECT 1 FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=@actor AND u.is_active=1
      AND u.deleted_at IS NULL AND u.permissions IS @permissions AND u.role_id IS @roleId
      AND r.permissions IS @rolePermissions AND r.code IS @roleCode)
    AND (SELECT COUNT(*) FROM stock_disposition_events WHERE source_id=@source)=@eventCount
    AND (SELECT MAX(generation) FROM stock_disposition_events WHERE source_id=@source)=@generation+1
    AND (SELECT COALESCE(SUM(recognized4),0) FROM stock_disposition_events WHERE source_id=@source)=@recognizedTotal
    AND (SELECT COUNT(*) FROM stock_disposition_allocations WHERE source_id=@source)=@allocationCount
    AND (SELECT COALESCE(SUM(gross4),0) FROM stock_disposition_allocations WHERE source_id=@source)=@allocatedGross
    AND (SELECT COALESCE(SUM(coverage4),0) FROM stock_disposition_allocations WHERE source_id=@source)=@allocatedCoverage
    AND (SELECT COALESCE(SUM(e.remaining_gross4),0) FROM stock_disposition_events e WHERE e.source_id=@source
      AND e.generation=(SELECT MAX(x.generation) FROM stock_disposition_events x WHERE x.allocation_id=e.allocation_id))=@heldGross
    AND (SELECT COALESCE(SUM(e.remaining_coverage4),0) FROM stock_disposition_events e WHERE e.source_id=@source
      AND e.generation=(SELECT MAX(x.generation) FROM stock_disposition_events x WHERE x.allocation_id=e.allocation_id))=@heldCoverage
    ${feePostcondition}
    THEN 1 ELSE 0 END)`,params:postParams },
    { sql: `SELECT CASE WHEN (SELECT COUNT(*) FROM stock_disposition_guards WHERE token IN (@token,@postToken) AND valid=1)=2
      THEN 1 ELSE json_extract('[1]','$[disposition_postcondition_missing]') END`,params:{ token:eventId,postToken } },
    { sql: 'DELETE FROM stock_disposition_guards WHERE token IN (@token,@postToken)',params:{ token:eventId,postToken } },
    { sql: `SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stock_disposition_guards WHERE token IN (@token,@postToken))
      THEN 1 ELSE json_extract('[1]','$[disposition_guard_cleanup_failed]') END`,params:{ token:eventId,postToken } })
  try { await ordinaryBusinessBatch(db,statements) }
  catch {
    await currentActor(db,actor,extraFee4 > 0)
    const committed = await readReceipt(db,request)
    if (committed) return replay(committed,actor.id,digest,requestJson)
    return refuse('disposition_write_conflict')
  }
  return { ...response,replayed:false }
}

export async function stockDispositionProjection(db: D1Compat, sourceId: string) {
  const source = await db.prepare('SELECT * FROM stock_disposition_sources WHERE id=@source').get<Source>({ source:sourceId })
  if (!source) return refuse('source_not_found')
  const allocations = await db.prepare('SELECT * FROM stock_disposition_allocations WHERE source_id=@source').all<Allocation>({ source:sourceId })
  const latest = await db.prepare(`SELECT e.* FROM stock_disposition_events e WHERE e.source_id=@source AND e.generation=(SELECT MAX(x.generation) FROM stock_disposition_events x WHERE x.allocation_id=e.allocation_id)`).all<Event>({ source:sourceId })
  const totals = await db.prepare(`SELECT COALESCE(SUM(recognized4),0) AS recognized4 FROM stock_disposition_events WHERE source_id=@source`).get<{ recognized4:number }>({ source:sourceId })
  const fees = await db.prepare(`SELECT COALESCE(SUM(f.amount4),0) AS cash4 FROM stock_disposition_fees f JOIN stock_disposition_events e ON e.id=f.event_id WHERE e.source_id=@source`).get<{ cash4:number }>({ source:sourceId })
  const sellable = subtractQuantity(source.quantity,allocations.map(row=>row.quantity))
  const disposed = await db.prepare("SELECT quantity FROM stock_disposition_events WHERE source_id=@source AND kind='dispose'").all<{ quantity:string }>({ source:sourceId })
  const physical = subtractQuantity(source.quantity,disposed.map(row=>row.quantity))
  const held = subtractQuantity(physical,[sellable])
  const stock = await db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=@batch AND branch_id=@branch').get<{ quantity:number }>({ batch:source.batch_id,branch:source.branch_id })
  if (!stock || quantityDecimal(stock.quantity,true) !== sellable) return refuse('source_stock_changed')
  const acceptedCredit4 = allocations.reduce((sum,row)=>sum+row.coverage4,0)
  return { purchase_quantity:source.quantity,free_quantity:source.free_quantity,purchase_gross4:source.gross4,sellable_quantity:sellable,held_quantity:held,physical_quantity:physical,
    sellable_gross4:source.gross4-allocations.reduce((sum,row)=>sum+row.gross4,0),held_gross4:latest.reduce((sum,row)=>sum+row.remaining_gross4,0),held_net4:latest.reduce((sum,row)=>sum+row.remaining_gross4-row.remaining_coverage4,0),
    accepted_credit4:acceptedCredit4,debt4:source.opening_debt4-acceptedCredit4,recognized_loss4:totals?.recognized4 ?? 0,extra_cash_fee4:fees?.cash4 ?? 0 }
}
