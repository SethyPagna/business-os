import { getDb, type D1Compat } from './db'
import type { SessionUser } from './auth'
import { getActionTier } from './permissions'
import { canEditAcquisitionCosts, canViewAcquisitionCosts } from './acquisitionCostAccess'
import { exactMoney4, quantityDecimal, subtractQuantity } from './stockDispositionBasis'
import { fundingTransition, type FundingKind, type FundingState } from './stockFundingMath'
import { feeRequestDigest, normalizeFeeRequestId } from './feeOperationReceipt'
import { ordinaryBusinessBatch } from './businessMaintenanceGuard'

export class StockFundingError extends Error {
  constructor(public code: string, public statusCode: 400 | 403 | 409 = 409) { super(code) }
}
const refuse = (code: string, status: 400 | 403 | 409 = 409): never => { throw new StockFundingError(code,status) }
const text = (value: unknown, max = 500): string => typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : refuse('invalid_proof_or_identity',400)
const id = (value: unknown): number => Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : refuse('invalid_identity',400)
type Source = { id: string; movement_id: number; batch_id: number; product_id: number; branch_id: number; supplier_id: number; quantity: string; free_quantity: string; gross4: number; opening_paid4: number; opening_debt4: number; reconciliation_proof: string; invoice_id: number | null; actor_id: number; source_json: string }
type Current = { generation: number; gross4: number; paid4: number; debt4: number; credit4: number; asset4: number; cash_in4: number; cash_out4: number; shipping4: number }
type Receipt = { actor_id: number; request_digest: string; request_json: string; response_json: string }
type Header = { id: number; supplier_id: number | null; branch_id: number | null; total_amount_usd: number; amount_paid_usd: number; outstanding_balance_usd: number; status: string; source_branch: string; legacy_id: number; source_file: string; source_row: number }
type Statement = { sql: string; params?: Record<string,unknown> }
const headerSql = `SELECT id,supplier_id,branch_id,total_amount_usd,amount_paid_usd,outstanding_balance_usd,status,source_branch,legacy_id,source_file,source_row FROM supplier_invoices`
const physicalSql = `SELECT pb.variant_product_id AS product_id,pb.supplier_id,pb.received_branch_id AS branch_id,pb.received_quantity,pb.received_cost_usd,pb.is_active AS batch_active,
 im.id AS movement_id,im.batch_id,im.product_id AS movement_product,im.branch_id AS movement_branch,im.quantity,im.free_quantity,im.total_cost_usd,im.total_cost_khr,im.movement_type,im.reference_id,
 p.is_active AS product_active,b.is_active AS branch_active,
 (SELECT COUNT(*) FROM inventory_movements x WHERE x.batch_id=pb.id AND x.movement_type IN ('add','in')) AS receipt_count
 FROM product_batches pb JOIN inventory_movements im ON im.batch_id=pb.id JOIN products p ON p.id=pb.variant_product_id JOIN suppliers supplier ON supplier.id=pb.supplier_id JOIN branches b ON b.id=pb.received_branch_id WHERE pb.id=@batch AND im.id=@movement`
async function currentActor(db: D1Compat, actor: SessionUser, cash: boolean, read = false) {
  const u = await db.prepare(`SELECT u.id,u.username,u.name,u.permissions,u.role_id,u.is_active,u.deleted_at,r.code AS role_code,r.permissions AS role_permissions FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=@actor`).get<SessionUser & { deleted_at: string | null }>({ actor:actor.id })
  if (!u || u.is_active !== 1 || u.deleted_at || getActionTier(u,'inventory',read ? 'view' : 'adjust') !== 'full' || getActionTier(u,'contacts',read ? 'view' : 'edit') !== 'full' || !canViewAcquisitionCosts(u) || (!read && !canEditAcquisitionCosts(u))) return refuse('funding_permission_denied',403)
  if (cash && getActionTier(u,'fees','add') !== 'full') return refuse('funding_cash_permission_denied',403)
  return u
}
async function receipt(db: D1Compat, request: string) {
  return db.prepare('SELECT actor_id,request_digest,request_json,response_json FROM stock_funding_receipts WHERE request_id=@request').get<Receipt>({request})
}
function replay(row: Receipt, actor: number, digest: string, requestJson: string) {
  if (row.actor_id !== actor || row.request_digest !== digest || row.request_json !== requestJson) return refuse('funding_request_intent_conflict')
  let response: Record<string,unknown>
  try { response = JSON.parse(row.response_json) } catch { return refuse('funding_receipt_corrupt') }
  const keys = ['funding_version','source_id','event_id','generation','kind','gross4','paid4','debt4','credit4','asset4','cash_in4','cash_out4','shipping4','claim_id','fee_id']
  if (!response || Array.isArray(response) || Object.keys(response).join('|') !== keys.join('|') || JSON.stringify(response) !== row.response_json || response.funding_version !== 2 || typeof response.source_id !== 'string' || typeof response.event_id !== 'string' || typeof response.kind !== 'string' || keys.slice(3,4).concat(keys.slice(5,13)).some(key => !Number.isSafeInteger(response[key]) || Number(response[key]) < 0)) return refuse('funding_receipt_corrupt')
  return { ...response,replayed:true }
}
async function checkedHeader(db: D1Compat, invoice: number) {
  const h = await db.prepare(`${headerSql} WHERE id=@invoice`).get<Header>({invoice})
  if (!h) return refuse('funding_invoice_missing')
  const opening = await db.prepare('SELECT header_json FROM stock_funding_invoice_openings WHERE invoice_id=@invoice').get<{header_json:string}>({invoice})
  if (opening && opening.header_json !== JSON.stringify(h)) return refuse('funding_invoice_preimage_changed')
  return { h,opening }
}
export async function commitStockFunding(env: { DB: D1Database; IMPORT_DB?: D1Database }, actor: SessionUser, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return refuse('invalid_request',400)
  const raw = input as Record<string,unknown>
  const allowed = ['kind','source_id','movement_id','batch_id','product_id','branch_id','supplier_id','quantity','free_quantity','gross_usd','opening_paid_usd','opening_debt_usd','reconciliation_proof','invoice_id','amount_usd','claim_id','proof','fee_id','cash_method','cash_reference','cash_recorded_at','expected_generation','client_request_id']
  if (Object.keys(raw).some(key=>!allowed.includes(key))) return refuse('unsupported_request_field',400)
  const kind = raw.kind as FundingKind
  if (!['admit','pending','accept','cancel','payment','refund','shipping'].includes(kind)) return refuse('unsupported_funding_transition',400)
  const admit = kind === 'admit', cash = kind === 'payment' || kind === 'refund', shipping = kind === 'shipping'
  const commandFields = admit ? ['movement_id','batch_id','product_id','branch_id','supplier_id','quantity','free_quantity','gross_usd','opening_paid_usd','opening_debt_usd','reconciliation_proof','invoice_id'] : ['amount_usd','claim_id','proof','fee_id','cash_method','cash_reference','cash_recorded_at']
  if (Object.keys(raw).some(key=>!['kind','source_id','expected_generation','client_request_id',...commandFields].includes(key))) return refuse('unsupported_transition_field',400)
  const request = normalizeFeeRequestId(raw.client_request_id)
  if (!request) return refuse('invalid_request_id',400)
  const sourceId = text(raw.source_id,120), proof = text(admit ? raw.reconciliation_proof : raw.proof)
  if (!Number.isSafeInteger(raw.expected_generation) || Number(raw.expected_generation) < 0) return refuse('invalid_generation',400)
  const generation = Number(raw.expected_generation)
  let amount4 = 0, opening: Omit<Source,'actor_id'|'source_json'> | null = null
  try {
    if (admit) {
      if (generation !== 0 || raw.invoice_id === undefined) return refuse('explicit_opening_linkage_required',400)
      const quantity = quantityDecimal(raw.quantity), free = quantityDecimal(raw.free_quantity,true)
      subtractQuantity(quantity,[free])
      const gross4 = exactMoney4(raw.gross_usd), paid4 = exactMoney4(raw.opening_paid_usd), debt4 = exactMoney4(raw.opening_debt_usd)
      if (paid4 + debt4 !== gross4) return refuse('opening_funding_not_conserved',400)
      opening = { id:sourceId,movement_id:id(raw.movement_id),batch_id:id(raw.batch_id),product_id:id(raw.product_id),branch_id:id(raw.branch_id),supplier_id:id(raw.supplier_id),quantity,free_quantity:free,gross4,opening_paid4:paid4,opening_debt4:debt4,reconciliation_proof:proof,invoice_id:raw.invoice_id === null ? null : id(raw.invoice_id) }
    } else if (kind !== 'accept' && kind !== 'cancel') {
      amount4 = exactMoney4(raw.amount_usd)
      if (amount4 <= 0) return refuse('invalid_amount',400)
    } else if (raw.amount_usd !== undefined) return refuse('claim_amount_is_immutable',400)
  } catch(error) { if (error instanceof StockFundingError) throw error; return refuse('unsupported_quantity_or_money_precision',400) }
  const claim = kind === 'pending' || kind === 'accept' || kind === 'cancel' ? text(raw.claim_id,120) : null
  const feeId = shipping ? id(raw.fee_id) : null
  if ((claim === null && raw.claim_id !== undefined) || (!shipping && raw.fee_id !== undefined) || (!cash && ['cash_method','cash_reference','cash_recorded_at'].some(key=>raw[key] !== undefined))) return refuse('unsupported_transition_field',400)
  const cashMethod = cash ? raw.cash_method : null, cashReference = cash ? text(raw.cash_reference,120) : null, cashAt = cash ? text(raw.cash_recorded_at,40) : null
  if (cash && (cashMethod !== 'cash' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(cashAt!) || !Number.isFinite(Date.parse(cashAt!)) || new Date(cashAt!).toISOString() !== cashAt)) return refuse('unsupported_or_invalid_cash_proof',400)
  const requestJson = JSON.stringify({ kind,sourceId,generation,opening,amount4,claim,feeId,proof,cashMethod,cashReference,cashAt })
  const digest = await feeRequestDigest(requestJson), db = getDb(env), current = await currentActor(db,actor,cash || shipping)
  const cached = await receipt(db,request)
  if (cached) return replay(cached,actor.id,digest,requestJson)
  const stored = await db.prepare('SELECT * FROM stock_funding_sources WHERE id=@source').get<Source>({source:sourceId})
  if ((admit && stored) || (!admit && !stored)) return refuse('funding_source_state_conflict')
  const source = (opening || stored)!
  const physical = await db.prepare(physicalSql).get<Record<string,unknown>>({batch:source.batch_id,movement:source.movement_id})
  if (!physical || physical.product_id !== source.product_id || physical.movement_product !== source.product_id || physical.supplier_id !== source.supplier_id || physical.branch_id !== source.branch_id || physical.movement_branch !== source.branch_id || physical.batch_active !== 1 || physical.product_active !== 1 || physical.branch_active !== 1 || physical.receipt_count !== 1 || !['add','in'].includes(String(physical.movement_type))) return refuse('funding_source_identity_or_shared_receipt')
  try {
    if (quantityDecimal(physical.quantity) !== source.quantity || quantityDecimal(physical.received_quantity) !== source.quantity || quantityDecimal(physical.free_quantity,true) !== source.free_quantity || exactMoney4(physical.total_cost_usd) !== source.gross4 || exactMoney4(physical.received_cost_usd) !== source.gross4) return refuse('funding_source_preimage_changed')
  } catch(error) { if (error instanceof StockFundingError) throw error; return refuse('unknown_or_unsupported_source_basis') }
  if (physical.total_cost_khr != null && physical.total_cost_khr !== 0) return refuse('unsupported_khr_source_funding')
  const sourceJson = JSON.stringify(physical)
  if (stored && stored.source_json !== sourceJson) return refuse('funding_source_preimage_changed')
  if (await db.prepare('SELECT id FROM stock_disposition_sources WHERE movement_id=@movement OR batch_id=@batch').get({movement:source.movement_id,batch:source.batch_id})) return refuse('funding_v1_source_already_admitted')
  const last = await db.prepare('SELECT * FROM stock_funding_latest WHERE source_id=@source').get<Current>({source:sourceId})
  if ((!admit && (!last || last.generation !== generation)) || (admit && last)) return refuse('funding_generation_conflict')
  let state: FundingState = { gross4:source.gross4,paid4:source.opening_paid4,debt4:source.opening_debt4,credit4:0,asset4:0,cashIn4:0,cashOut4:0,shipping4:0 }
  if (last) state = {gross4:last.gross4,paid4:last.paid4,debt4:last.debt4,credit4:last.credit4,asset4:last.asset4,cashIn4:last.cash_in4,cashOut4:last.cash_out4,shipping4:last.shipping4}
  if (kind === 'accept' || kind === 'cancel') {
    const c = await db.prepare('SELECT amount4 FROM stock_funding_claims WHERE id=@claim AND source_id=@source').get<{amount4:number}>({claim,source:sourceId})
    if (!c || await db.prepare("SELECT id FROM stock_funding_events WHERE claim_id=@claim AND kind IN ('accept','cancel')").get({claim})) return refuse('funding_claim_not_pending')
    amount4 = c.amount4
  }
  let next = state
  try { if (!admit) next = fundingTransition(state,kind,amount4) } catch(error) { return refuse(error instanceof Error ? error.message : 'funding_transition_conflict') }
  let header: Header | null = null, headerJson: string | null = null, invoiceOpening = false, invoiceGross = 0, invoicePaid = 0, invoiceDebt = 0
  if (source.invoice_id !== null) {
    const checked = await checkedHeader(db,source.invoice_id); header = checked.h; invoiceOpening = !checked.opening
    if (header.supplier_id !== source.supplier_id || header.branch_id !== source.branch_id) return refuse('funding_invoice_identity_mismatch')
    try { invoiceGross=exactMoney4(header.total_amount_usd); invoicePaid=exactMoney4(header.amount_paid_usd); invoiceDebt=exactMoney4(header.outstanding_balance_usd) } catch { return refuse('unsupported_invoice_money_precision') }
    if (invoiceGross !== invoicePaid + invoiceDebt) return refuse('invoice_opening_not_conserved')
    headerJson = JSON.stringify(header)
    const totals = await db.prepare('SELECT COALESCE(SUM(gross4),0) gross,COALESCE(SUM(opening_paid4),0) paid,COALESCE(SUM(opening_debt4),0) debt FROM stock_funding_sources WHERE invoice_id=@invoice').get<{gross:number;paid:number;debt:number}>({invoice:source.invoice_id})
    if (admit && (!totals || totals.gross+source.gross4>invoiceGross || totals.paid+source.opening_paid4>invoicePaid || totals.debt+source.opening_debt4>invoiceDebt)) return refuse('invoice_allocation_exceeded')
  }
  if (shipping) {
    const fee = await db.prepare(`SELECT f.amount_usd,f.amount_khr,f.branch_id,f.created_by FROM fees f WHERE f.id=@fee AND EXISTS(SELECT 1 FROM fee_operation_receipts r WHERE r.fee_id=f.id AND r.actor_id=@actor) AND EXISTS(SELECT 1 FROM audit_logs a WHERE a.entity='fee' AND a.entity_id=CAST(f.id AS TEXT) AND a.user_id=@actor AND a.action='create')`).get<{amount_usd:number;amount_khr:number;branch_id:number;created_by:number}>({fee:feeId,actor:actor.id})
    if (!fee || fee.branch_id !== source.branch_id || fee.created_by !== actor.id || fee.amount_khr !== 0 || exactMoney4(fee.amount_usd) !== amount4) return refuse('shipping_actual_fee_proof_required')
  }
  const eventId = cash ? `cash-${await feeRequestDigest(`${cashMethod}:${cashReference}`)}` : crypto.randomUUID(), nextGeneration = admit ? 0 : generation+1, at = new Date().toISOString()
  const response = { funding_version:2,source_id:sourceId,event_id:eventId,generation:nextGeneration,kind,gross4:next.gross4,paid4:next.paid4,debt4:next.debt4,credit4:next.credit4,asset4:next.asset4,cash_in4:next.cashIn4,cash_out4:next.cashOut4,shipping4:next.shipping4,claim_id:claim,fee_id:feeId }
  const responseJson = JSON.stringify(response)
  const params = {source:sourceId,movement:source.movement_id,batch:source.batch_id,product:source.product_id,branch:source.branch_id,supplier:source.supplier_id,qty:source.quantity,free:source.free_quantity,gross:source.gross4,paid:source.opening_paid4,debt:source.opening_debt4,sourceJson,sourceProof:source.reconciliation_proof,sourceActor:stored?.actor_id ?? actor.id,invoice:source.invoice_id,actor:actor.id,name:current.name,permissions:current.permissions,roleId:current.role_id,rolePermissions:current.role_permissions,roleCode:current.role_code,generation,reference:physical.reference_id,movementType:physical.movement_type,costKhr:physical.total_cost_khr,headerJson,invoiceGross,invoicePaid,invoiceDebt,invoiceStatus:header?.status,invoiceSource:header?.source_branch,invoiceLegacy:header?.legacy_id,invoiceFile:header?.source_file,invoiceRow:header?.source_row,claim,amount:amount4,proof,fee:feeId,event:eventId,nextGeneration,kind,nextPaid:next.paid4,nextDebt:next.debt4,nextCredit:next.credit4,nextAsset:next.asset4,cashIn:next.cashIn4,cashOut:next.cashOut4,shipping:next.shipping4,cashMethod,cashReference,cashAt,at,request,digest,requestJson,responseJson}
  const actorGuard = `EXISTS(SELECT 1 FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=@actor AND u.is_active=1 AND u.deleted_at IS NULL AND u.permissions IS @permissions AND u.role_id IS @roleId AND r.permissions IS @rolePermissions AND r.code IS @roleCode)`
  const physicalGuard = `EXISTS(SELECT 1 FROM product_batches pb JOIN inventory_movements im ON im.batch_id=pb.id JOIN products p ON p.id=pb.variant_product_id JOIN suppliers supplier ON supplier.id=pb.supplier_id JOIN branches b ON b.id=pb.received_branch_id WHERE pb.id=@batch AND im.id=@movement AND pb.variant_product_id=@product AND im.product_id=@product AND pb.supplier_id=@supplier AND pb.received_branch_id=@branch AND im.branch_id=@branch AND pb.received_quantity=CAST(@qty AS REAL) AND im.quantity=CAST(@qty AS REAL) AND im.free_quantity=CAST(@free AS REAL) AND pb.received_cost_usd=@gross/10000.0 AND im.total_cost_usd=@gross/10000.0 AND im.reference_id IS @reference AND im.movement_type=@movementType AND im.total_cost_khr IS @costKhr AND pb.is_active=1 AND p.is_active=1 AND b.is_active=1 AND (SELECT COUNT(*) FROM inventory_movements x WHERE x.batch_id=pb.id AND x.movement_type IN ('add','in'))=1)`
  const headerGuard = source.invoice_id === null ? '1' : `EXISTS(SELECT 1 FROM supplier_invoices WHERE id=@invoice AND supplier_id=@supplier AND branch_id=@branch AND total_amount_usd=@invoiceGross/10000.0 AND amount_paid_usd=@invoicePaid/10000.0 AND outstanding_balance_usd=@invoiceDebt/10000.0 AND status=@invoiceStatus AND source_branch=@invoiceSource AND legacy_id=@invoiceLegacy AND source_file=@invoiceFile AND source_row=@invoiceRow)`
  const capGuard = source.invoice_id === null ? '1' : `(SELECT COALESCE(SUM(gross4),0) FROM stock_funding_sources WHERE invoice_id=@invoice)<=@invoiceGross AND (SELECT COALESCE(SUM(opening_paid4),0) FROM stock_funding_sources WHERE invoice_id=@invoice)<=@invoicePaid AND (SELECT COALESCE(SUM(opening_debt4),0) FROM stock_funding_sources WHERE invoice_id=@invoice)<=@invoiceDebt`
  const sourceGuard = `EXISTS(SELECT 1 FROM stock_funding_sources WHERE id=@source AND movement_id=@movement AND batch_id=@batch AND product_id=@product AND branch_id=@branch AND supplier_id=@supplier AND quantity=@qty AND free_quantity=@free AND gross4=@gross AND opening_paid4=@paid AND opening_debt4=@debt AND reconciliation_proof=@sourceProof AND invoice_id IS @invoice AND source_json=@sourceJson AND actor_id=@sourceActor)`
  const feeGuard = shipping ? `EXISTS(SELECT 1 FROM fees f WHERE f.id=@fee AND f.amount_usd=@amount/10000.0 AND f.amount_khr=0 AND f.branch_id=@branch AND f.created_by=@actor AND EXISTS(SELECT 1 FROM fee_operation_receipts r WHERE r.fee_id=f.id AND r.actor_id=@actor) AND EXISTS(SELECT 1 FROM audit_logs a WHERE a.entity='fee' AND a.entity_id=CAST(f.id AS TEXT) AND a.user_id=@actor AND a.action='create'))` : '1'
  const pre = `${actorGuard} AND ${physicalGuard} AND ${headerGuard} AND NOT EXISTS(SELECT 1 FROM stock_disposition_sources WHERE movement_id=@movement OR batch_id=@batch) AND ${admit ? `NOT EXISTS(SELECT 1 FROM stock_funding_sources WHERE id=@source OR movement_id=@movement OR batch_id=@batch)` : `${sourceGuard} AND EXISTS(SELECT 1 FROM stock_funding_latest WHERE source_id=@source AND generation=@generation)`} AND ${feeGuard}`
  const statements: Statement[] = []
  const check = (token: string, condition: string) => {
    statements.push({sql:`INSERT INTO stock_funding_guards(token,valid) SELECT @token,CASE WHEN (${condition}) THEN 1 ELSE 0 END`,params:{...params,token}},
      {sql:`SELECT CASE WHEN EXISTS(SELECT 1 FROM stock_funding_guards WHERE token=@token AND valid=1) THEN 1 ELSE json_extract('[1]','$[funding_guard_missing]') END`,params:{token}})
  }
  check(`${request}:pre`,pre)
  if (admit) {
    if (invoiceOpening) statements.push({sql:`INSERT INTO stock_funding_invoice_openings(invoice_id,supplier_id,branch_id,gross4,paid4,debt4,header_json,proof) VALUES(@invoice,@supplier,@branch,@invoiceGross,@invoicePaid,@invoiceDebt,@headerJson,@sourceProof)`,params})
    statements.push({sql:`INSERT INTO stock_funding_sources(id,movement_id,batch_id,product_id,branch_id,supplier_id,quantity,free_quantity,gross4,opening_paid4,opening_debt4,reconciliation_proof,invoice_id,actor_id,source_json) VALUES(@source,@movement,@batch,@product,@branch,@supplier,@qty,@free,@gross,@paid,@debt,@sourceProof,@invoice,@actor,@sourceJson)`,params})
  }
  if (kind === 'pending') statements.push({sql:'INSERT INTO stock_funding_claims(id,source_id,amount4,proof) VALUES(@claim,@source,@amount,@proof)',params})
  statements.push({sql:`INSERT INTO stock_funding_events(id,source_id,generation,kind,amount4,claim_id,fee_id,gross4,paid4,debt4,credit4,asset4,cash_in4,cash_out4,shipping4,proof,cash_method,cash_reference,cash_recorded_at,actor_id,occurred_at) VALUES(@event,@source,@nextGeneration,@kind,@amount,@claim,@fee,@gross,@nextPaid,@nextDebt,@nextCredit,@nextAsset,@cashIn,@cashOut,@shipping,@proof,@cashMethod,@cashReference,@cashAt,@actor,@at)`,params},
    {sql:`INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,new_value) VALUES(@actor,@name,@kind,'stock_funding',@event,@responseJson,'stock_funding_events',@event,@responseJson)`,params},
    {sql:'INSERT INTO stock_funding_receipts(request_id,actor_id,request_digest,request_json,response_json,event_id) VALUES(@request,@actor,@digest,@requestJson,@responseJson,@event)',params})
  const eventGuard = `EXISTS(SELECT 1 FROM stock_funding_events WHERE id=@event AND source_id=@source AND generation=@nextGeneration AND kind=@kind AND amount4=@amount AND claim_id IS @claim AND fee_id IS @fee AND gross4=@gross AND paid4=@nextPaid AND debt4=@nextDebt AND credit4=@nextCredit AND asset4=@nextAsset AND cash_in4=@cashIn AND cash_out4=@cashOut AND shipping4=@shipping AND proof=@proof AND cash_method IS @cashMethod AND cash_reference IS @cashReference AND cash_recorded_at IS @cashAt AND actor_id=@actor AND occurred_at=@at)`
  const claimGuard = claim === null ? '1' : `EXISTS(SELECT 1 FROM stock_funding_claims WHERE id=@claim AND source_id=@source AND amount4=@amount${kind === 'pending' ? ' AND proof=@proof' : ''})`
  const openingGuard = source.invoice_id === null ? '1' : `EXISTS(SELECT 1 FROM stock_funding_invoice_openings WHERE invoice_id=@invoice AND supplier_id=@supplier AND branch_id=@branch AND gross4=@invoiceGross AND paid4=@invoicePaid AND debt4=@invoiceDebt AND header_json=@headerJson)`
  const terminal = `${actorGuard} AND ${physicalGuard} AND ${headerGuard} AND ${capGuard} AND ${sourceGuard} AND ${openingGuard} AND ${feeGuard} AND ${eventGuard} AND ${claimGuard} AND EXISTS(SELECT 1 FROM stock_funding_receipts WHERE request_id=@request AND actor_id=@actor AND request_digest=@digest AND request_json=@requestJson AND response_json=@responseJson AND event_id=@event) AND (SELECT COUNT(*) FROM audit_logs WHERE entity='stock_funding' AND entity_id=@event AND user_id=@actor AND user_name IS @name AND action=@kind AND details=@responseJson AND table_name='stock_funding_events' AND record_id=@event AND new_value=@responseJson)=1 AND EXISTS(SELECT 1 FROM stock_funding_latest WHERE id=@event AND generation=@nextGeneration)`
  check(`${request}:post`,terminal)
  statements.push({sql:'DELETE FROM stock_funding_guards WHERE token IN (@pre,@post)',params:{pre:`${request}:pre`,post:`${request}:post`}},
    {sql:`SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stock_funding_guards WHERE token IN (@pre,@post)) THEN 1 ELSE json_extract('[1]','$[funding_guard_cleanup]') END`,params:{pre:`${request}:pre`,post:`${request}:post`}})
  try { await ordinaryBusinessBatch(db,statements) }
  catch {
    await currentActor(db,actor,cash || shipping)
    const saved = await receipt(db,request)
    if (saved) return replay(saved,actor.id,digest,requestJson)
    return refuse('funding_atomic_conflict')
  }
  return { ...response,replayed:false }
}
export async function readStockFundingAp(env: { DB: D1Database; IMPORT_DB?: D1Database }, actor: SessionUser) {
  const db = getDb(env)
  await currentActor(db,actor,false,true)
  const invoices = await db.prepare(headerSql+' ORDER BY id').all<Header>()
  const sources = await db.prepare(`SELECT s.id,s.invoice_id,s.supplier_id,s.branch_id,s.gross4,s.opening_paid4,s.opening_debt4,e.paid4,e.debt4,e.credit4,e.asset4,e.cash_in4,e.cash_out4,e.shipping4 FROM stock_funding_sources s JOIN stock_funding_latest e ON e.source_id=s.id ORDER BY s.id`).all<Record<string,number|string|null>>()
  const rows: Record<string,unknown>[] = [], included = new Set<string>()
  let debt4=0,asset4=0
  for (const h of invoices) {
    await checkedHeader(db,h.id)
    const linked = sources.filter(s=>s.invoice_id===h.id)
    let currentDebt = exactMoney4(h.outstanding_balance_usd), currentPaid = exactMoney4(h.amount_paid_usd), credit=0,asset=0
    for (const s of linked) {
      currentDebt += Number(s.debt4)-Number(s.opening_debt4); currentPaid += Number(s.paid4)-Number(s.opening_paid4);credit+=Number(s.credit4);asset+=Number(s.asset4);included.add(String(s.id))
    }
    if (currentDebt < 0 || !Number.isSafeInteger(currentDebt) || !Number.isSafeInteger(currentPaid)) return refuse('funding_ap_projection_invalid')
    rows.push({...h,current_debt4:currentDebt,current_paid4:currentPaid,accepted_credit4:credit,refund_asset4:asset,source_ids:linked.map(s=>s.id)})
    debt4+=currentDebt;asset4+=asset
  }
  const native = sources.filter(s=>!included.has(String(s.id)))
  for (const s of native) { if(s.invoice_id !== null) return refuse('funding_linked_invoice_missing');debt4+=Number(s.debt4);asset4+=Number(s.asset4) }
  if (!Number.isSafeInteger(debt4) || !Number.isSafeInteger(asset4)) return refuse('funding_ap_projection_overflow')
  return { funding_version:2,scope:'disabled_funding_projection',invoices:rows,native_sources:native,debt4,refund_asset4:asset4 }
}
