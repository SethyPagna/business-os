import { planExactProductMergeStock } from './countedProductMerge'
import { subtractCountedQuantity, sumCountedQuantities } from './countedDamagedStock'
import { selectEffectiveReceiptCost } from './catalogCostRecompute'
import { planProductMergeCaseSnapshot, productMergeCaptureGuard } from './productMergeSnapshot'
import type { ProductMergeCaseSnapshot } from './productMergeSnapshot'

export type MergeOriginReference = { section: 'duplicateBatchRows' | 'damagedStockRows' | 'productCostRows'; index: number; id: number }
export type MergeOriginIdentity = { productId: number; branchId: number; batchId: number | null; damagedLotId: number | null; conditionTag: 'ordinary' | 'damaged' | 'expired' }
export type MergeOriginReservation = { operationId: string; receiptIds: readonly { sourceReceiptId: number; targetReceiptId: number }[]; tagIds: readonly { sourceTagId: number; targetTagId: number }[] }
export type ProductMergeOriginPlan = {
  version: 1; operationId: string; keeperId: number; loserId: number
  receiptOrigins: { original: MergeOriginReference; targetReceiptId: number; batchKey: string; batchNumber: number; valuation: { effectiveUnitCostUsd: number | null; source: 'manual' | 'receipt' | 'excluded'; manualEntry: MergeOriginReference | null } }[]
  tagOrigins: { original: MergeOriginReference; targetTagId: number; targetReceiptId: number | null }[]
  receiptClones: { id: number; metadata: Record<string, unknown> }[]
  tagClones: { id: number; metadata: Record<string, unknown> }[]
  physicalEdges: { ordinal: number; original: MergeOriginIdentity; effect: MergeOriginIdentity; quantity: number }[]
}
export class ProductMergeOriginPlanError extends Error {
  readonly code = 'merge_origin_plan_conflict'
  constructor(detail: string) { super(detail); this.name = 'ProductMergeOriginPlanError' }
}
const receiptFields = ['id','variant_product_id','batch_key','lot_code','expiry_date','received_at','is_active','notes','synthetic','created_at','updated_at','batch_number','supplier_id','supplier_name','payment_status','credit_due_date','unit_cost_usd','received_quantity','received_branch_id','received_cost_usd','received_branch_name']
const tagFields = ['id','product_id','product_name','branch_id','batch_id','return_id','quantity','quantity_remaining','reason','created_by_user_id','created_by_user_name','created_at','updated_at','condition_tag','source','unit_cost_usd','return_item_id']
const fail = (detail: string): never => { throw new ProductMergeOriginPlanError(detail) }
const id = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fail('Invalid origin or reserved identity')
const numeric = (value: unknown): number | null => value === null ? null : typeof value === 'number' && Number.isFinite(value) ? value : fail('Invalid captured cost')
const active = (value: unknown): number | null => value === null || value === 0 || value === 1 ? value : fail('Invalid captured receipt activity')
function fields(row: Record<string, unknown>, names: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(names.map(name => {
    const value = row[name]
    if (value === undefined || (value !== null && !['number','string'].includes(typeof value)) || (typeof value === 'number' && !Number.isFinite(value))) fail('Incomplete captured metadata')
    return [name, value]
  }))
}
function reservations(rows: readonly { source: number; target: number }[], sources: readonly number[], existing: readonly number[]): Map<number, number> {
  const result = new Map<number, number>(), targets = new Set(existing), sourceSet = new Set(sources)
  if (rows.length !== sources.length) fail('Missing origin reservation')
  for (const row of rows) {
    const source = id(row.source), target = id(row.target)
    if (!sourceSet.has(source) || result.has(source) || targets.has(target)) fail('Duplicate, wrong source or occupied reservation')
    result.set(source,target); targets.add(target)
  }
  return result
}
export function planProductMergeOrigins(snapshot: ProductMergeCaseSnapshot, reserved: MergeOriginReservation): ProductMergeOriginPlan {
  if (typeof reserved.operationId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(reserved.operationId)) fail('Invalid merge operation identity')
  const keeperId = id(snapshot.canonicalProduct?.id), loserId = id(snapshot.duplicateProduct?.id)
  const guard = productMergeCaptureGuard(snapshot)
  const decoded = planProductMergeCaseSnapshot(keeperId,loserId,[]).decode(new Map([['capture',[{ data: guard.params.observedCapture, oversized: 0 }]]]))
  if (JSON.stringify(decoded) !== JSON.stringify({...snapshot,reparentedByTable:[]})) fail('Captured source changed in memory')
  const exact = planExactProductMergeStock(snapshot,'merge')
  const receipts = exact.duplicateSource.receipts, tags = exact.duplicateSource.tags
  if (!Array.isArray(reserved.receiptIds) || !Array.isArray(reserved.tagIds) || reserved.receiptIds.length !== receipts.length || reserved.tagIds.length !== tags.length) fail('Missing origin reservation')
  const receiptIndex = new Map(snapshot.duplicateBatchRows.map((row,index) => [row,index]))
  const tagIndex = new Map(snapshot.damagedStockRows.map((row,index) => [row,index]))
  const costIndex = new Map(snapshot.productCostRows.map((row,index) => [row,index]))
  const keeperKeys = new Set(snapshot.canonicalBatchRows.map(row => row.batch_key))
  const receiptIds = reservations(reserved.receiptIds.map(row => ({source:row.sourceReceiptId,target:row.targetReceiptId})), receipts.map(row => id(row.original.id)), [...snapshot.canonicalBatchRows,...snapshot.duplicateBatchRows].map(row => id(row.id)))
  const tagIds = reservations(reserved.tagIds.map(row => ({source:row.sourceTagId,target:row.targetTagId})), tags.map(row => row.id), snapshot.damagedStockRows.map(row => id(row.id)))
  let maxNumber = 0
  for (const row of snapshot.canonicalBatchRows) {
    if (row.batch_number === null) continue
    const number = id(row.batch_number)
    maxNumber = Math.max(maxNumber,number)
  }
  if (!Number.isSafeInteger(maxNumber + receipts.length)) fail('Receipt number overflow')
  const costs = snapshot.productCostRows.filter(row => id(row.product_id) === loserId)
  for (const row of costs) { id(row.id); numeric(row.cost_usd); if (typeof row.baseline_batch_id !== 'number' || !Number.isSafeInteger(row.baseline_batch_id) || row.baseline_batch_id < 0) fail('Invalid manual baseline') }
  const latest = costs.length ? costs.reduce((previous,row) => id(row.id) > id(previous.id) ? row : previous) : null
  const manual = latest ? { id:id(latest.id), cost_usd:numeric(latest.cost_usd), baseline_batch_id:latest.baseline_batch_id as number } : null
  const plan: ProductMergeOriginPlan = { version:1,operationId:reserved.operationId,keeperId,loserId,receiptOrigins:[],tagOrigins:[],receiptClones:[],tagClones:[],physicalEdges:[] }
  receipts.forEach((receipt,index) => {
    const original = receipt.original, target = receiptIds.get(id(original.id))!, activity = active(original.is_active)
    if (activity !== 1 && sumCountedQuantities([...receipt.quantityByBranch.values()]) > 0) fail('Inactive receipt still holds stock; activation authority required')
    const valuation = selectEffectiveReceiptCost({id:id(original.id),is_active:activity,unit_cost_usd:numeric(original.unit_cost_usd)},manual)
    const batchKey = `merge:${reserved.operationId}:${original.id}`, batchNumber = maxNumber + index + 1
    if (keeperKeys.has(batchKey)) fail('Derived receipt key occupied')
    plan.receiptOrigins.push({ original:{section:'duplicateBatchRows',index:receiptIndex.get(original)!,id:id(original.id)}, targetReceiptId:target,batchKey,batchNumber,valuation:{effectiveUnitCostUsd:valuation.effectiveUnitCostUsd,source:valuation.source,manualEntry:valuation.manualEntryId === null ? null : {section:'productCostRows',index:costIndex.get(latest!)!,id:valuation.manualEntryId}} })
    plan.receiptClones.push({id:target,metadata:{...fields(original,receiptFields),id:target,variant_product_id:keeperId,batch_key:batchKey,batch_number:batchNumber,unit_cost_usd:valuation.effectiveUnitCostUsd,received_quantity:0,received_cost_usd:0}})
  })
  const edge = (original: MergeOriginIdentity, effect: MergeOriginIdentity, quantity: number) => plan.physicalEdges.push({ordinal:plan.physicalEdges.length,original,effect,quantity})
  const tagQuantities = new Map<string,number[]>()
  for (const tag of tags) { const key = `${tag.branchId}:${tag.batchId ?? 'null'}`; const values = tagQuantities.get(key) ?? []; values.push(tag.remaining); tagQuantities.set(key,values) }
  const tagQuantity = (branchId: number,batchId: number | null) => tagQuantities.get(`${branchId}:${batchId ?? 'null'}`) ?? []
  const receiptQuantitiesByBranch = new Map<number,number[]>()
  for (const receipt of receipts) for (const [branchId,value] of receipt.quantityByBranch) { const values = receiptQuantitiesByBranch.get(branchId) ?? []; values.push(value); receiptQuantitiesByBranch.set(branchId,values) }
  for (const receipt of receipts) for (const [branchId,physical] of receipt.quantityByBranch) {
    const source = {productId:loserId,branchId,batchId:id(receipt.original.id),damagedLotId:null,conditionTag:'ordinary' as const}
    edge(source,{...source,productId:keeperId,batchId:receiptIds.get(source.batchId)!},subtractCountedQuantity(physical,tagQuantity(branchId,source.batchId)))
  }
  for (const [branchId,physical] of exact.duplicateSource.quantityByBranch) {
    const source = {productId:loserId,branchId,batchId:null,damagedLotId:null,conditionTag:'ordinary' as const}
    const receiptQuantities = receiptQuantitiesByBranch.get(branchId) ?? []
    edge(source,{...source,productId:keeperId},subtractCountedQuantity(physical,[...receiptQuantities,...tagQuantity(branchId,null)]))
  }
  for (const tag of tags) {
    const condition = tag.original.condition_tag
    if (condition !== 'damaged' && condition !== 'expired') fail('Invalid original condition')
    const target = tagIds.get(tag.id)!, targetBatch = tag.batchId === null ? null : receiptIds.get(tag.batchId)!
    plan.tagOrigins.push({original:{section:'damagedStockRows',index:tagIndex.get(tag.original)!,id:tag.id},targetTagId:target,targetReceiptId:targetBatch})
    plan.tagClones.push({id:target,metadata:{...fields(tag.original,tagFields),id:target,product_id:keeperId,product_name:snapshot.canonicalProduct!.name,batch_id:targetBatch,return_id:null,return_item_id:null,source:null,quantity:tag.quantity,quantity_remaining:tag.remaining}})
    const source = {productId:loserId,branchId:tag.branchId,batchId:tag.batchId,damagedLotId:tag.id,conditionTag:condition as 'damaged' | 'expired'}
    edge(source,{...source,productId:keeperId,batchId:targetBatch,damagedLotId:target},tag.remaining)
  }
  if (sumCountedQuantities(plan.physicalEdges.map(row => row.quantity)) !== exact.moved) fail('Origin projection does not match stock')
  return plan
}
