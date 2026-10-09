import { stockActorPredicate, stockActorParams } from './stockActorGuard'
import { parseStockConditionTag } from './stockCondition'
import { currentRequestMetrics } from './requestMetrics'
import { getPlanLimits } from './planTier'
import { CountedStockBatchPlan, countedStockFactsSql, planExactCountedTaggedChange, planExactCountedOrdinaryChange,
  subtractCountedQuantity, sumCountedQuantities, isCountedStockConflict } from './countedDamagedStock'
import { executeStockTransaction, stockTransactionStatementCount } from './stockTransaction'
import { productStockGuardError } from './productStockGuard'
import { getDb, type D1Compat } from './db'
import type { Env } from '../index'
import type { SessionUser } from './auth'
import { getActionTier } from './permissions'
import { bumpVersions } from './cache'
import { broadcast } from '../durable-objects/broadcastHub'
import { actorSnapshot } from './actorSnapshot'
import { assertSaleRecordBatchBounds, buildSaleRecordEventsInsert, sha256Hex } from './saleRecordEvents'
import { validateCustomerReturnRestorationCohortV1, validateCustomerReturnRestorationMemberV1,
  type CustomerReturnRestorationV1 } from './customerReturnEntitlement'
import { MoneyPrecisionError, subtractDecimalSum } from './moneyPrecision'
import { assertReturnCreateQueryBudget, ReturnCreateBudgetError, assertReturnCreateCapacity, ReturnCapacityError, type ReturnCapacityParams } from './returnCreateAction'
import {
  BRANCH_RETIRED_DAMAGED_CODE, BRANCH_RETIRED_DAMAGED_ERROR, BranchEffectResolver, BranchRetiredNoSuccessorError,
  branchEffectGuardPredicate, foldedLotSurvivors, readBranchDirectory,
} from './branchEffect'

export const RETURN_BULK_ACTION_KIND = 'return.fields.bulk'
export const RETURN_BULK_LIMIT = 25
const RETURN_BULK_MOVEMENT_LIMIT = 256

type Row = Record<string, unknown>
type Statement = { sql: string; params: Record<string, unknown> }
type ReturnField = 'status' | 'return_type' | 'supplier_settlement'

type BulkRequest = {
  client_request_id: string
  field: ReturnField
  source: string
  target: string
  items: Array<{
    id: number
    expected_status: string
    expected_method: string
    expected_updated_at: string | null
  }>
}

type ReturnItem = Row & {
  id: number
  return_id: number
  product_id: number | null
  product_name: string | null
  branch_id: number | null
  batch_id: number | null
  quantity: number
  cost_price_usd: number | null
  cost_price_khr: number | null
  return_to_stock: number | null
  stock_condition:string|null
  stock_action: string | null
}

type Allocation = {
  id: number
  return_item_id: number
  batch_id: number
  branch_id: number | null
  quantity: number
}

type DamagedLot = Row & {
  return_item_id:number|null
  condition_tag:string
  id: number
  return_id: number
  product_id: number
  product_name: string | null
  branch_id: number | null
  batch_id: number | null
  quantity: number
  quantity_remaining: number
}

type StockDelta = {
  productId: number
  productName: string | null
  branchId: number
  batchId: number | null
  damagedLotId: number | null
  quantity: number
  costUsd: number
  costKhr: number
  movementType: string
  // Present only when the line was recorded at a branch that has since been retired and the stock moved at its
  // active successor (branchId is then the successor; older snapshots simply lack these): the branch the stock
  // really moved at, and the label the return was made under.
  branchName?: string | null
  addressed?: string | null
}

type Member = {
  id: number
  returnNumber: string
  saleId: number | null
  saleRevision: number | null
  moneyPrecisionVersion: number
  scope: 'customer' | 'supplier'
  before: { status: string; return_type: string; supplier_settlement: string }
  after: { status: string; return_type: string; supplier_settlement: string }
  changed: boolean
  reason: 'changed' | 'source_mismatch' | 'scope_mismatch'
  updateSale: boolean
  stock: StockDelta[]
  supplierManifest?: { json: string; digest: string; items: string }
}

type SaleStatusSnapshot = { saleId: number; before: string; after: string }
type Snapshot = { version: 1; operationId: string; field: ReturnField; members: Member[]; saleStatuses?: SaleStatusSnapshot[] }

// `code` names a business refusal the client restates in the operator's
// language; without one the route answers the generic write_conflict /
// invalid_bulk_action it always has. `params` are the values that sentence
// names (the product and counts of return_restore_over_capacity), forwarded
// so the restated sentence keeps them.
export class ReturnBulkError extends Error {
  // `extra` rides next to error/code in the route's JSON (the redirect a client must confirm).
  constructor(message: string, readonly statusCode: 400 | 403 | 409 | 503 = 409, readonly code?: string, readonly params?: ReturnCapacityParams, readonly extra?: Record<string, unknown>) {
    super(message)
  }
}

function fail(message: string, status: 400 | 403 | 409 = 409, code?: string, params?: ReturnCapacityParams, extra?: Record<string, unknown>): never {
  throw new ReturnBulkError(message, status, code, params, extra)
}

function normalize(value: unknown, fallback = ''): string {
  return String(value ?? '').trim().toLowerCase() || fallback
}

function methodField(scope: unknown): Exclude<ReturnField, 'status'> {
  return normalize(scope, 'customer') === 'supplier' ? 'supplier_settlement' : 'return_type'
}

function methodValue(row: Row): string {
  return methodField(row.return_scope) === 'supplier_settlement'
    ? normalize(row.supplier_settlement, 'refund')
    : normalize(row.return_type, 'manual')
}

function parseRequest(raw: Row): BulkRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('A bulk return action is required.', 400)
  const allowed = ['client_request_id', 'field', 'source', 'target', 'items']
  if (Object.keys(raw).some((key) => !allowed.includes(key))) fail('Unsupported bulk return field.', 400)
  if (typeof raw.client_request_id !== 'string' || !/^[A-Za-z0-9_-]{8,120}$/.test(raw.client_request_id)) fail('A stable request id is required.', 400)
  const field = String(raw.field || '') as ReturnField
  if (!['status', 'return_type', 'supplier_settlement'].includes(field)) fail('Invalid return field.', 400)
  const source = normalize(raw.source)
  const target = normalize(raw.target)
  if (!source || !target || source === target || source.length > 80 || target.length > 80) fail('Choose different source and target values.', 400)
  if (field === 'status' && (![source, target].every((value) => ['completed', 'cancelled'].includes(value)))) {
    fail('Return status can only move between completed and cancelled.', 400)
  }
  if (field === 'return_type' && !['restock', 'writeoff', 'refund'].includes(target)) fail('Invalid customer return type.', 400)
  if (field === 'supplier_settlement' && !['refund', 'credit', 'replacement', 'writeoff'].includes(target)) fail('Invalid supplier settlement.', 400)
  if (!Array.isArray(raw.items) || !raw.items.length || raw.items.length > RETURN_BULK_LIMIT) fail(`Select between 1 and ${RETURN_BULK_LIMIT} returns.`, 400)
  const ids = new Set<number>()
  const items = raw.items.map((candidate) => {
    const item = candidate as Row
    const keys = Object.keys(item || {})
    const id = Number(item?.id)
    if (!item || typeof item !== 'object' || keys.some((key) => !['id', 'expected_status', 'expected_method', 'expected_updated_at'].includes(key))
      || !Number.isSafeInteger(id) || id <= 0 || ids.has(id)
      || typeof item.expected_status !== 'string' || typeof item.expected_method !== 'string'
      || !(typeof item.expected_updated_at === 'string' || item.expected_updated_at === null)) {
      fail('Unique return ids and expected states are required.', 400)
    }
    ids.add(id)
    return {
      id,
      expected_status: normalize(item.expected_status, 'completed'),
      expected_method: normalize(item.expected_method),
      expected_updated_at: item.expected_updated_at as string | null,
    }
  }).sort((left, right) => left.id - right.id)
  return { client_request_id: raw.client_request_id, field, source, target, items }
}

function guard(predicate: string, params: Row = {}): Statement {
  return { sql: `INSERT INTO return_bulk_guards(guard_value) SELECT CASE WHEN (${predicate}) THEN 1 ELSE 0 END`, params }
}

export type SupplierReturnSource = {
  itemIndex: number; productId: number; branchId: number; batchId: number | null; lotId: number | null
  condition: string; quantity: number; costUsd: number; costKhr: number
  lotIdentity: unknown[] | null
}
export type SupplierReturnManifest = { version: 1; scope: 'supplier'; sale_id: null; intent: unknown; sources: SupplierReturnSource[] }

function supplierItemsExpression(id: string): string {
  return `(SELECT json_group_array(json_array(id,product_id,branch_id,quantity,cost_price_usd,cost_price_khr,stock_condition)) FROM
    (SELECT * FROM return_items WHERE return_id=${id} ORDER BY id))`
}
function supplierManifestAuthority(): string {
  return `(@supplierManifest IS NULL OR (EXISTS(SELECT 1 FROM return_create_receipts WHERE return_id=@id
    AND sale_id IS NULL AND request_json=@supplierManifest AND request_digest=@supplierDigest)
    AND ${supplierItemsExpression('@id')}=@supplierItems
    AND NOT EXISTS(SELECT 1 FROM json_each(@supplierManifest,'$.sources') src
      WHERE json_extract(src.value,'$.lotId') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM damaged_stock_lots d
        WHERE d.id=json_extract(src.value,'$.lotId') AND d.product_id=json_extract(src.value,'$.productId')
          AND d.branch_id=json_extract(src.value,'$.branchId') AND d.batch_id IS json_extract(src.value,'$.batchId')
          AND d.condition_tag=json_extract(src.value,'$.condition')
          AND d.batch_id IS json_extract(src.value,'$.lotIdentity[0]') AND d.quantity IS json_extract(src.value,'$.lotIdentity[1]')
          AND d.condition_tag IS json_extract(src.value,'$.lotIdentity[2]') AND d.source IS json_extract(src.value,'$.lotIdentity[3]')
          AND d.return_id IS json_extract(src.value,'$.lotIdentity[4]') AND d.return_item_id IS json_extract(src.value,'$.lotIdentity[5]')
          AND d.unit_cost_usd IS json_extract(src.value,'$.lotIdentity[6]') AND d.created_at IS json_extract(src.value,'$.lotIdentity[7]')))))`
}
function supplierManifestParams(member: Member): Row {
  return { supplierManifest: member.supplierManifest?.json ?? null, supplierDigest: member.supplierManifest?.digest ?? null,
    supplierItems: member.supplierManifest?.items ?? null }
}
function supplierManifestSources(json: string, itemsJson: string): SupplierReturnSource[] {
  if (new TextEncoder().encode(json).byteLength > 512_000) fail('Supplier source history exceeds the saved request bound.',409)
  let value: SupplierReturnManifest, items: unknown[][]
  try { value=JSON.parse(json); items=JSON.parse(itemsJson) } catch { fail('Supplier source history is incomplete.',409) }
  if (!value || typeof value!=='object') fail('Supplier source history is incomplete.',409)
  const intentItems=(value.intent as {items?: Array<{product_id:number;quantity:number;stock_condition:string;damaged_lot_id:number|null;cost_price_usd:number;cost_price_khr:number}>})?.items
  if (value.version !== 1 || value.scope !== 'supplier' || value.sale_id !== null || !Array.isArray(value.sources)
    || value.sources.length > 10_000 || !Array.isArray(intentItems) || !intentItems.length || intentItems.length>50
    || !Array.isArray(items) || items.length!==intentItems.length) fail('Supplier source history is incomplete.',409)
  for (const source of value.sources) {
    if (!source || typeof source!=='object') fail('Supplier source history is incomplete.',409)
    const tag = parseStockConditionTag(source.condition === 'ordinary' ? null : source.condition)
    if (!Number.isSafeInteger(source.itemIndex) || source.itemIndex < 0 || source.itemIndex>=intentItems.length || !Number.isSafeInteger(source.productId) || source.productId <= 0
      || !Number.isSafeInteger(source.branchId) || source.branchId <= 0 || !(source.batchId === null || Number.isSafeInteger(source.batchId) && source.batchId > 0)
      || !Number.isFinite(source.quantity) || source.quantity <= 0 || !Number.isFinite(source.costUsd) || !Number.isFinite(source.costKhr)
      || !tag.ok || (source.condition === 'ordinary' ? source.lotId !== null || source.lotIdentity !== null
        : !tag.tag || !Number.isSafeInteger(source.lotId) || Number(source.lotId) <= 0 || !Array.isArray(source.lotIdentity) || source.lotIdentity.length !== 8)) {
      fail('Supplier source history is incomplete.',409)
    }
    subtractCountedQuantity(source.quantity, [])
  }
  for (const [index,item] of items.entries()) {
    const intent=intentItems[index], sources=value.sources.filter(source=>source.itemIndex===index), quantity=Number(intent?.quantity)
    if (!Array.isArray(item) || item.length!==7 || !Number.isSafeInteger(item[0]) || Number(item[0])<=0
      || index>0 && Number(items[index-1][0])>=Number(item[0]) || !intent || !Number.isFinite(quantity) || quantity<=0
      || item[1]!==Number(intent.product_id) || item[3]!==quantity || item[6]!==intent.stock_condition || !sources.length
      || item[4]!==Number(intent.cost_price_usd) || item[5]!==Number(intent.cost_price_khr)
      || subtractCountedQuantity(quantity,sources.map(source=>source.quantity))!==0
      || sources.some(source=>source.productId!==item[1] || source.branchId!==item[2] || source.condition!==item[6]
        || source.costUsd!==item[4] || source.costKhr!==item[5] || source.lotId!==intent.damaged_lot_id)) {
      fail('Supplier return members no longer match their complete saved source history.',409)
    }
  }
  return value.sources
}

function taggedReturnAuthority(): string {
  return `NOT EXISTS(SELECT 1 FROM json_each(@taggedSources) source WHERE NOT EXISTS(
    SELECT 1 FROM damaged_stock_lots d JOIN return_items ri ON ri.id=d.return_item_id
    WHERE d.id=json_extract(source.value,'$.lot') AND d.return_id=@id AND ri.return_id=d.return_id
      AND ri.id=json_extract(source.value,'$.item') AND ri.product_id=json_extract(source.value,'$.product')
      AND ri.branch_id IS json_extract(source.value,'$.recorded') AND d.branch_id=json_extract(source.value,'$.effect')
      AND d.product_id=ri.product_id AND ri.stock_condition=json_extract(source.value,'$.condition') AND d.condition_tag=ri.stock_condition
      AND ri.quantity IS json_extract(source.value,'$.itemQuantity') AND ri.batch_id IS json_extract(source.value,'$.itemBatch')
      AND COALESCE(ri.cost_price_usd,0)=json_extract(source.value,'$.costUsd') AND COALESCE(ri.cost_price_khr,0)=json_extract(source.value,'$.costKhr')
      AND d.batch_id IS json_extract(source.value,'$.batch') AND d.quantity IS json_extract(source.value,'$.quantity')
      AND (ri.branch_id IS d.branch_id OR (${branchEffectGuardPredicate("json_array(json_object('addressed',ri.branch_id,'effect',d.branch_id,'sells',0))")}))))`
}

type TaggedSource = {lot:number;item:number;product:number;recorded:number;effect:number;batch:number|null;condition:string;
  quantity:number;costUsd:number;costKhr:number;itemQuantity:number;itemBatch:number|null;fingerprint?:string}

function taggedSources(member: Member, items: ReturnItem[], lots: DamagedLot[]): TaggedSource[] {
  if(member.scope==='supplier' || member.before.status===member.after.status)return []
  const expected=lots.filter(lot=>Number(lot.return_id)===member.id)
  const deltas=member.stock.filter(delta=>delta.damagedLotId!==null)
  if(expected.length!==deltas.length || expected.some(lot=>!deltas.some(delta=>delta.damagedLotId===Number(lot.id))))fail('Tagged Return sources are incomplete.',409)
  return member.stock.filter(delta=>delta.damagedLotId!==null).map(delta=>{
    const lot=lots.find(row=>Number(row.id)===delta.damagedLotId)
    const item=items.find(row=>Number(row.id)===Number(lot?.return_item_id) && Number(row.return_id)===member.id)
    if(!lot || !item || Number(lot.product_id)!==delta.productId || Number(item.product_id)!==delta.productId
      || Number(lot.branch_id)!==delta.branchId || (lot.batch_id??null)!==delta.batchId
      || item.stock_condition!==lot.condition_tag || Math.abs(delta.quantity)!==Number(lot.quantity)
      || delta.costUsd!==Number(item.cost_price_usd||0) || delta.costKhr!==Number(item.cost_price_khr||0))fail('The original tagged Return source changed.',409)
    return {lot:Number(lot.id),item:Number(item.id),product:delta.productId,recorded:Number(item.branch_id),effect:delta.branchId,
      batch:delta.batchId,condition:String(item.stock_condition),quantity:Number(lot.quantity),costUsd:delta.costUsd,costKhr:delta.costKhr,
      itemQuantity:Number(item.quantity),itemBatch:item.batch_id??null}
  })
}

function taggedReplayWitnessSql(): string {
  return `(SELECT CASE WHEN COUNT(*)<=300 THEN json_group_array(json_object('lot',d.id,'item',ri.id,'returnId',d.return_id,
    'product',d.product_id,'recorded',ri.branch_id,'effect',d.branch_id,'batch',d.batch_id,'condition',d.condition_tag,
    'quantity',json(printf('%!.26g',d.quantity)),'itemQuantity',json(printf('%!.26g',ri.quantity)),
    'costUsd',json(printf('%!.26g',COALESCE(ri.cost_price_usd,0))),'costKhr',json(printf('%!.26g',COALESCE(ri.cost_price_khr,0))),
    'itemBatch',ri.batch_id,'itemCondition',ri.stock_condition,'fingerprint',m.stock_fingerprint)) END
    FROM damaged_stock_lots d LEFT JOIN return_items ri ON ri.id=d.return_item_id AND ri.return_id=d.return_id AND ri.product_id=d.product_id
    JOIN returns r ON r.id=d.return_id AND COALESCE(r.return_scope,'customer')='customer'
    LEFT JOIN return_bulk_members m ON m.return_id=r.id AND m.operation_id=o.id
    WHERE m.return_id IS NOT NULL OR EXISTS(SELECT 1 FROM json_each(o.request_json,'$.items') selected WHERE json_extract(selected.value,'$.id')=r.id)
    )`
}

function replayTaggedSources(operation:Row,snapshot:Snapshot):Map<number,TaggedSource[]> {
  const result=new Map<number,TaggedSource[]>()
  let original:BulkRequest
  try{original=parseRequest(JSON.parse(String(operation.request_json)))}catch{fail('The original tagged Return request is incomplete.',409)}
  if(original.field!=='status')return result
  const raw=String(operation.tagged_witness||'[]')
  if(new TextEncoder().encode(raw).byteLength>512000)fail('Tagged Return source capture exceeds its bound.',409)
  let witnesses:(TaggedSource & {returnId:number;itemCondition:string;fingerprint:string})[]
  try{witnesses=JSON.parse(raw)}catch{fail('Tagged Return source capture is incomplete.',409)}
  if(!Array.isArray(witnesses))fail('Tagged Return source capture exceeds its row bound.',409)
  if(witnesses.length){
    let receipt:{changedIds:number[];items:{id:number;changed:boolean;before:string;after:string}[]}
    try{receipt=JSON.parse(String(operation.receipt_json))}catch{fail('The original tagged Return receipt is incomplete.',409)}
    if(!receipt || !Array.isArray(receipt.changedIds) || snapshot.field!==original.field || snapshot.members.length!==original.items.length || new Set(snapshot.members.map(member=>member.id)).size!==original.items.length
      || !Array.isArray(receipt.items) || receipt.items.length!==original.items.length
      || original.items.some(item=>!snapshot.members.some(member=>member.id===item.id))
      || JSON.stringify(snapshot.members.filter(member=>member.changed).map(member=>member.id).sort((a,b)=>a-b))!==JSON.stringify([...receipt.changedIds].sort((a,b)=>a-b))
      || snapshot.members.some(member=>!receipt.items.some(item=>item.id===member.id && item.changed===member.changed && item.before===member.before.status && item.after===member.after.status)
        || member.changed && (member.before.status!==original.source || member.after.status!==original.target)))fail('Archived tagged Return members changed.',409)
  }
  for(const witness of witnesses){
    const member=snapshot.members.find(row=>row.id===witness.returnId && row.changed && row.scope==='customer')
    const delta=member?.stock.find(row=>row.damagedLotId===witness.lot)
    if(!member || !delta || !witness.item || witness.itemCondition!==witness.condition || delta.productId!==witness.product
      || delta.branchId!==witness.effect || delta.batchId!==witness.batch || Math.abs(delta.quantity)!==witness.quantity
      || delta.costUsd!==witness.costUsd || delta.costKhr!==witness.costKhr)fail('Archived tagged Return source changed.',409)
    const list=result.get(member.id)||[];list.push(witness);result.set(member.id,list)
  }
  for(const member of snapshot.members)if(member.scope==='customer' && member.stock.filter(delta=>delta.damagedLotId!==null).length!==(result.get(member.id)||[]).length)fail('Archived tagged Return sources are incomplete.',409)
  return result
}

function movementFingerprint(idSql: string): string {
  return `(SELECT CASE WHEN COUNT(*)>${RETURN_BULK_MOVEMENT_LIMIT} THEN NULL ELSE json_group_array(json_array(id,product_id,branch_id,batch_id,movement_type,quantity)) END FROM (SELECT id,product_id,branch_id,batch_id,movement_type,quantity FROM inventory_movements WHERE reference_id=${idSql} AND movement_type IN ('return','return_reversal','damage_in','damage_reversal','supplier_return','supplier_return_reversal') ORDER BY id LIMIT ${RETURN_BULK_MOVEMENT_LIMIT + 1}))`
}

function customerSourcesSql(id:string):string {
  const allocations=`(SELECT CASE WHEN COUNT(*)<=400 THEN json_group_array(json_array(id,batch_id,branch_id,json(printf('%!.26g',quantity)))) END FROM (SELECT * FROM return_item_batch_allocations WHERE return_item_id=ri.id ORDER BY id LIMIT 401))`
  const lots=`(SELECT CASE WHEN COUNT(*)<=300 THEN json_group_array(json_array(id,product_id,branch_id,batch_id,json(printf('%!.26g',quantity)),condition_tag)) END FROM (SELECT * FROM damaged_stock_lots WHERE return_item_id=ri.id AND return_id=ri.return_id ORDER BY id LIMIT 301))`
  return `(SELECT CASE WHEN COUNT(*)<=300 THEN json_group_array(json_array(ri.id,ri.product_id,ri.product_name,COALESCE(NULLIF(ri.branch_id,0),r.branch_id),ri.batch_id,
    json(printf('%!.26g',ri.quantity)),json(printf('%!.26g',COALESCE(ri.cost_price_usd,0))),json(printf('%!.26g',COALESCE(ri.cost_price_khr,0))),ri.stock_action,ri.return_to_stock,ri.stock_condition,
    ${allocations},${lots})) END FROM (SELECT * FROM return_items WHERE return_id=${id} ORDER BY id LIMIT 301) ri JOIN returns r ON r.id=ri.return_id)`
}

function customerReplayWitnessSql():string {
  return `(SELECT CASE WHEN COUNT(*)<=${RETURN_BULK_LIMIT} THEN json_group_array(json_object('id',r.id,'status',r.status,'fingerprint',m.stock_fingerprint,'sources',(''||${customerSourcesSql('r.id')}),'movements',(''||${customerMovementsSql('r.id')}),'tags',(''||${customerTagMembersSql('r.id')}))) END
    FROM returns r LEFT JOIN return_bulk_members m ON m.return_id=r.id AND m.operation_id=o.id
    WHERE COALESCE(r.return_scope,'customer')='customer' AND (m.return_id IS NOT NULL OR EXISTS(SELECT 1 FROM json_each(o.request_json,'$.items') selected WHERE json_extract(selected.value,'$.id')=r.id)))`
}

function customerTagMembersSql(id:string):string {
  return `(SELECT CASE WHEN COUNT(*)<=300 THEN json_group_array(json_array(id,return_item_id)) END FROM (SELECT id,return_item_id FROM damaged_stock_lots WHERE return_id=${id} ORDER BY id LIMIT 301))`
}

function customerMovementsSql(id:string):string {
  return `(SELECT CASE WHEN COUNT(*)<=${RETURN_BULK_MOVEMENT_LIMIT} THEN json_group_array(json_array(id,product_id,branch_id,batch_id,movement_type,
    json(printf('%!.26g',quantity)),json(printf('%!.26g',COALESCE(unit_cost_usd,0))),json(printf('%!.26g',COALESCE(unit_cost_khr,0))))) END FROM
    (SELECT * FROM inventory_movements WHERE reference_id=${id} AND movement_type IN ('return','return_reversal','damage_in','damage_reversal','supplier_return','supplier_return_reversal') ORDER BY id LIMIT ${RETURN_BULK_MOVEMENT_LIMIT+1}))`
}

type CustomerReplayAuthority={sources:string;fingerprint:string;effects:string;movements:string;tags:string}
function replayCustomerStock(operation:Row,snapshot:Snapshot):Map<number,CustomerReplayAuthority> {
  const result=new Map<number,CustomerReplayAuthority>()
  let request:BulkRequest,receipt:{items:{id:number;changed:boolean;before:string;after:string}[];changedIds:number[]},witnesses:{id:number;status:string;fingerprint:string;sources:string;movements:string;tags:string}[]
  const raw=String(operation.customer_witness)
  if(new TextEncoder().encode(raw).byteLength>512000)fail('Customer Return source capture exceeds its bound.',409)
  try{request=parseRequest(JSON.parse(String(operation.request_json)));receipt=JSON.parse(String(operation.receipt_json));witnesses=JSON.parse(raw)}catch{fail('The original customer Return authority is incomplete.',409)}
  if(request.field!=='status')return result
  if(!Array.isArray(witnesses))fail('Customer Return source capture exceeds its row bound.',409)
  if(!witnesses.length)return result
  let itemCount=0,allocationCount=0,lotCount=0
  if(!Array.isArray(receipt.items) || !Array.isArray(receipt.changedIds) || snapshot.field!==request.field
    || snapshot.members.length!==request.items.length || receipt.items.length!==request.items.length
    || new Set(snapshot.members.map(member=>member.id)).size!==request.items.length
    || new Set(receipt.items.map(member=>member.id)).size!==request.items.length
    || request.items.some(item=>!snapshot.members.some(member=>member.id===item.id))
    || JSON.stringify(snapshot.members.filter(member=>member.changed).map(member=>member.id).sort((a,b)=>a-b))!==JSON.stringify([...receipt.changedIds].sort((a,b)=>a-b)))fail('Archived customer Return members changed.',409)
  for(const witness of witnesses){
    const member=snapshot.members.find(member=>member.id===witness.id),original=receipt.items.find(item=>item.id===witness.id)
    if(!member || !original || member.scope!=='customer' || member.changed!==original.changed || !Array.isArray(member.stock)
      || member.before.status!==original.before || member.after.status!==original.after)fail('Archived customer Return member changed.',409)
    if(!member.changed){if(member.stock.length)fail('An unchanged Return has archived stock effects.',409);continue}
    let items:unknown[][]
    try{items=JSON.parse(witness.sources)}catch{fail('Customer Return source capture is incomplete.',409)}
    if(original.before!==request.source || original.after!==request.target || !Array.isArray(items)
      || witness.status!==(Number(operation.generation)%2?original.before:original.after))fail('Customer Return source or replay state changed.',409)
    itemCount+=items.length
    if(itemCount>300)fail('Customer Return source capture exceeds its item bound.',409)
    const sources:{product:number;name:unknown;recorded:number;batch:number|null;lot:number|null;quantity:number;usd:number;khr:number}[]=[]
    for(const item of items){
      const [id,product,name,recorded,batch,quantity,usd,khr,action,restock,condition,allocations,lots]=item as [number,number,string|null,number,number|null,number,number,number,string|null,number,string,unknown[][],unknown[][]]
      if(!Array.isArray(allocations) || !Array.isArray(lots))fail('Customer Return source capture is incomplete.',409)
      allocationCount+=allocations.length;lotCount+=lots.length
      if(allocationCount>400 || lotCount>300)fail('Customer Return source capture exceeds its allocation or tag bound.',409)
      if(!(quantity>0))continue
      const stockAction=normalize(action,restock===1?'restock':'none')
      if(stockAction==='none')continue
      if(!Number.isSafeInteger(product) || product<=0 || !Number.isSafeInteger(recorded) || recorded<=0)fail('Customer Return source identity changed.',409)
      const pieces=stockAction==='damaged'?lots.map(row=>({product:Number(row[1]),recorded:Number(row[2]),batch:row[3] as number|null,quantity:Number(row[4]),lot:Number(row[0]),condition:row[5]}))
        :allocations.length?allocations.map(row=>({product,recorded:Number(row[2]),batch:Number(row[1]),quantity:Number(row[3]),lot:null,condition}))
        :[{product,recorded,batch,quantity,lot:null,condition}]
      if(!pieces.length || pieces.some(piece=>!(piece.quantity>0) || piece.product!==product || stockAction!=='damaged' && piece.recorded!==recorded
        || stockAction==='damaged' && piece.condition!==condition) || subtractCountedQuantity(quantity,pieces.map(piece=>piece.quantity))!==0)fail('Customer Return source quantities or condition changed.',409)
      for(const piece of pieces)sources.push({product,name,recorded,batch:piece.batch,lot:piece.lot,quantity:piece.quantity,usd,khr})
    }
    let moves:unknown[][]
    try{moves=JSON.parse(witness.movements)}catch{fail('Customer Return committed movement witness is incomplete.',409)}
    let tags:unknown[][]
    try{tags=JSON.parse(witness.tags)}catch{fail('Customer Return tag membership is incomplete.',409)}
    if(!Array.isArray(tags) || tags.length!==sources.filter(source=>source.lot!==null).length
      || tags.some(tag=>!sources.some(source=>source.lot===tag[0])))fail('Customer Return tag membership changed.',409)
    if(!Array.isArray(moves) || moves.length<sources.length || member.stock.length!==sources.length)fail('Customer Return stock vector is incomplete.',409)
    const sign=original.after==='cancelled'?-1:1,parity=Number(operation.generation)%2?-1:1,tail=moves.slice(-sources.length),effects:{addressed:number;effect:number;sells:0}[]=[]
    for(const [index,source] of sources.entries()){
      const delta=member.stock[index],move=tail[index],quantity=sign*source.quantity,type=source.lot!==null?(quantity*parity>0?'damage_in':'damage_reversal'):statusMovementType('customer',quantity*parity)
      if(!Array.isArray(move) || move.length!==8 || move[1]!==source.product || move[4]!==type || move[5]!==quantity*parity || move[6]!==source.usd || move[7]!==source.khr
        || delta.productId!==source.product || delta.productName!==source.name || delta.branchId!==move[2] || delta.batchId!==move[3]
        || delta.damagedLotId!==source.lot || delta.quantity!==quantity || delta.costUsd!==source.usd || delta.costKhr!==source.khr
        || source.recorded===move[2] && source.batch!==move[3])fail('Customer Return stock vector no longer matches its sources and committed movement ordinal.',409)
      if(source.recorded!==move[2])effects.push({addressed:source.recorded,effect:Number(move[2]),sells:0})
    }
    result.set(member.id,{sources:witness.sources,fingerprint:witness.fingerprint,effects:JSON.stringify(effects),movements:witness.movements,tags:witness.tags})
  }
  return result
}

function supplierReplayWitnessSql(): string {
  return `(SELECT CASE WHEN COUNT(*)<=${RETURN_BULK_LIMIT} AND
    COALESCE(SUM(COALESCE(length(CAST(cr.request_json AS BLOB)),0)+COALESCE(length(CAST(m.stock_fingerprint AS BLOB)),0)),0)<=512000
    THEN json_group_array(json_object('id',json_extract(selected.value,'$.id'),'scope',r.return_scope,'status',r.status,
      'manifest',cr.request_json,'digest',cr.request_digest,'fingerprint',m.stock_fingerprint)) END
    FROM (SELECT value FROM json_each(o.request_json,'$.items') LIMIT ${RETURN_BULK_LIMIT+1}) selected
    LEFT JOIN returns r ON r.id=json_extract(selected.value,'$.id')
    LEFT JOIN return_bulk_members m ON m.operation_id=o.id AND m.return_id=r.id
    LEFT JOIN return_create_receipts cr ON cr.return_id=r.id AND EXISTS(
      SELECT 1 FROM json_each(o.receipt_json,'$.changedIds') changed WHERE changed.value=r.id))`
}

function validateSupplierReplayStock(operation: Row, snapshot: Snapshot): Map<number,string> | null {
  let request: BulkRequest, receipt: {items:Array<{id:number;changed:boolean;before:string;after:string}>;changedIds:number[]}, witnesses: Row[]
  try {request=parseRequest(JSON.parse(String(operation.request_json)));receipt=JSON.parse(String(operation.receipt_json));witnesses=JSON.parse(String(operation.supplier_witness))}
  catch {fail('The original grouped Return authority is incomplete.',409)}
  if (!Array.isArray(witnesses)) fail('The original grouped Return authority exceeds its capture bound.',409)
  const supplierExact=request.field==='status' && (witnesses.some(row=>row.manifest && JSON.parse(String(row.manifest)).scope==='supplier')
    || snapshot.members.some(member=>!!member.supplierManifest))
  if (!supplierExact) return null
  if (!Array.isArray(receipt.items) || !Array.isArray(receipt.changedIds) || request.field!==snapshot.field
    || snapshot.members.length!==request.items.length || witnesses.length!==request.items.length || receipt.items.length!==request.items.length
    || new Set(snapshot.members.map(member=>member.id)).size!==request.items.length
    || new Set(witnesses.map(row=>row.id)).size!==request.items.length
    || new Set(receipt.items.map(member=>member.id)).size!==request.items.length
    || JSON.stringify([...receipt.changedIds].sort((a,b)=>a-b))!==JSON.stringify(receipt.items.filter(item=>item.changed).map(item=>item.id).sort((a,b)=>a-b))) {
    fail('The original grouped Return members no longer match their archive.',409)
  }
  const fingerprints=new Map<number,string>(), generation=Number(operation.generation)
  if (!Number.isSafeInteger(generation) || generation<0) fail('The grouped Return generation is invalid.',409)
  for (const expected of request.items) {
    const member=snapshot.members.find(item=>item.id===expected.id), original=receipt.items.find(item=>item.id===expected.id), witness=witnesses.find(row=>row.id===expected.id)
    if (!member || !original || !witness || member.changed!==original.changed || !Array.isArray(member.stock)) fail('The original grouped Return member is missing.',409)
    if (!member.changed) {if(member.stock.length)fail('An unchanged Return has archived stock effects.',409);continue}
    if (!witness.fingerprint) fail('The committed Return movement witness is missing.',409)
    fingerprints.set(member.id,String(witness.fingerprint))
    if (witness.scope!=='supplier' || !witness.manifest || JSON.parse(String(witness.manifest)).scope!=='supplier') {
      if(member.supplierManifest)fail('Supplier source ownership changed.',409)
      continue
    }
    if (!member.supplierManifest || member.supplierManifest.json!==witness.manifest || member.supplierManifest.digest!==witness.digest
      || member.scope!=='supplier' || member.saleId!==null || member.saleRevision!==null || member.updateSale
      || original.before!==request.source || original.after!==request.target || member.before.status!==original.before || member.after.status!==original.after
      || member.before.return_type!=='supplier_return' || member.after.return_type!==member.before.return_type
      || member.before.supplier_settlement!==expected.expected_method || member.after.supplier_settlement!==member.before.supplier_settlement) {
      fail('The archived supplier operation no longer matches its original request.',409)
    }
    const sources=supplierManifestSources(String(witness.manifest),member.supplierManifest.items)
    const sign=original.before==='completed' && original.after==='cancelled'?1:original.before==='cancelled' && original.after==='completed'?-1:0
    let movementRows: unknown[][]
    try {movementRows=JSON.parse(String(witness.fingerprint))} catch {fail('The committed Return movement witness is incomplete.',409)}
    if (!sign || !Array.isArray(movementRows) || movementRows.length<sources.length || member.stock.length!==sources.length
      || witness.status!==(generation%2?original.before:original.after)) fail('The supplier stock archive is incomplete.',409)
    const latest=movementRows.slice(-sources.length)
    for (const [index,source] of sources.entries()) {
      const effect=latest[index],delta=member.stock[index],quantity=sign*source.quantity
      if (!Array.isArray(effect) || effect.length!==6 || effect[1]!==source.productId || !Number.isSafeInteger(effect[2]) || Number(effect[2])<=0
        || !(effect[3]===null || Number.isSafeInteger(effect[3]) && Number(effect[3])>0)
        || effect[4]!==statusMovementType('supplier',quantity*(generation%2?-1:1)) || effect[5]!==quantity*(generation%2?-1:1)
        || source.lotId!==null && (effect[2]!==source.branchId || effect[3]!==source.batchId)
        || !delta || delta.productId!==source.productId || delta.branchId!==effect[2] || delta.batchId!==effect[3]
        || delta.damagedLotId!==source.lotId || delta.quantity!==quantity || delta.costUsd!==source.costUsd || delta.costKhr!==source.costKhr) {
        fail('The supplier stock projection no longer matches its immutable sources and committed movements.',409)
      }
    }
  }
  return fingerprints
}

function replayCountedFactsSql(snapshot: string): string {
  const receiptIds = `(SELECT json_group_array(json_extract(delta.value,'$.batchId')) FROM json_each(${snapshot},'$.members') member,
    json_each(member.value,'$.stock') delta WHERE json_extract(delta.value,'$.productId')=context.product_id AND json_extract(delta.value,'$.branchId')=context.branch_id)`
  return `(SELECT json_group_array(json_object('branchId',context.branch_id,'facts',(${countedStockFactsSql('context.product_id', 'context.branch_id', receiptIds)})||'')) FROM (
    SELECT DISTINCT json_extract(delta.value,'$.productId') product_id,json_extract(delta.value,'$.branchId') branch_id
    FROM json_each(${snapshot},'$.members') member,json_each(member.value,'$.stock') delta) context)`
}

async function rowsForIds<T>(db: D1Compat, ids: number[], sql: (marks: string) => string): Promise<T[]> {
  if (!ids.length) return []
  if (ids.length > RETURN_BULK_LIMIT) fail('Selection exceeds the single-query bound.', 400)
  // sql-bound-params: bounded by construction -- parseRequest caps the
  // selection at 25 and this helper rechecks every derived ID list before
  // creating one positional placeholder per ID (well below D1's 100 limit).
  return db.prepare(sql(ids.map(() => '?').join(','))).all<T>(ids)
}

function valueSnapshot(row: Row): Member['before'] {
  return {
    status: normalize(row.status, 'completed'),
    return_type: normalize(row.return_type, 'manual'),
    supplier_settlement: normalize(row.supplier_settlement, 'refund'),
  }
}

function statusMovementType(scope: Member['scope'], quantity: number): string {
  if (scope === 'supplier') return quantity > 0 ? 'supplier_return_reversal' : 'supplier_return'
  return quantity > 0 ? 'return' : 'return_reversal'
}

function stockStatements(member: Member, direction: 1 | -1, user: SessionUser, stamp: string, exact: CountedStockBatchPlan): Statement[] {
  const out: Statement[] = []
  for (const delta of member.stock) {
    const quantity = delta.quantity * direction
    const params = {
      product: delta.productId,
      branch: delta.branchId,
      batch: delta.batchId,
      lot: delta.damagedLotId,
      quantity,
      stamp,
    }
    const context = exact.get(delta.productId, delta.branchId)
    if (delta.damagedLotId) {
      out.push(...planExactCountedTaggedChange(context, {lotId:delta.damagedLotId,productId:delta.productId,branchId:delta.branchId,batchId:delta.batchId},Math.abs(quantity),quantity>0?'restore':'consume'))
    } else {
      const action = quantity < 0 ? 'consume' : delta.batchId !== null && context.requiresReceiptActivation(delta.batchId) ? 'activateAndReceive' : 'receive'
      out.push(...planExactCountedOrdinaryChange(context, delta.batchId, Math.abs(quantity), action))
    }
    out.push({
      sql: `INSERT INTO inventory_movements(product_id,product_name,branch_id${delta.addressed ? ',branch_name,addressed_branch_name' : ''},movement_type,quantity,unit_cost_usd,unit_cost_khr,reason,reference_id,user_id,user_name,batch_id)
            VALUES(@product,@name,@branch${delta.addressed ? ',@branchName,@addressed' : ''},@type,@quantity,@usd,@khr,@reason,@returnId,@userId,@userName,@batch)`,
      params: {
        product: delta.productId,
        name: delta.productName,
        branch: delta.branchId,
        ...(delta.addressed ? { branchName: delta.branchName ?? null, addressed: delta.addressed } : {}),
        type: member.scope==='supplier' ? statusMovementType(member.scope, quantity) : delta.damagedLotId ? (quantity > 0 ? 'damage_in' : 'damage_reversal') : statusMovementType(member.scope, quantity),
        quantity,
        usd: delta.costUsd,
        khr: delta.costKhr,
        reason: `${direction > 0 ? 'Apply' : 'Undo'} grouped return status`,
        returnId: member.id,
        userId: user.id ?? null,
        userName: actorSnapshot(user),
        batch: delta.batchId,
      },
    })
  }
  return out
}

function memberStatements(member: Member, direction: 1 | -1, user: SessionUser, stamp: string, exact: CountedStockBatchPlan): Statement[] {
  if (!member.changed) return []
  const target = direction > 0 ? member.after : member.before
  return [
    ...stockStatements(member, direction, user, stamp, exact),
    {
      sql: `UPDATE returns SET status=@status,return_type=@return_type,supplier_settlement=@supplier_settlement,updated_at=@stamp WHERE id=@id`,
      params: { ...target, stamp, id: member.id },
    },
  ]
}

function saleStatusStatement(saleId: number, stamp: string, exactStatus?: string): Statement {
  if (exactStatus) return { sql: 'UPDATE sales SET sale_status=@status,updated_at=@stamp WHERE id=@saleId', params: { saleId, stamp, status: exactStatus } }
  return {
    sql: `UPDATE sales SET sale_status = CASE
            WHEN NOT EXISTS(SELECT 1 FROM returns r WHERE r.sale_id=@saleId AND COALESCE(r.status,'completed')!='cancelled' AND COALESCE(r.return_scope,'customer')='customer') THEN COALESCE(status_before_return,'completed')
            WHEN NOT EXISTS(
              SELECT 1 FROM sale_items si
              WHERE si.sale_id=@saleId AND COALESCE((
                SELECT SUM(ri.quantity) FROM return_items ri JOIN returns r ON r.id=ri.return_id
                WHERE r.sale_id=@saleId AND COALESCE(r.status,'completed')!='cancelled' AND COALESCE(r.return_scope,'customer')='customer'
                  AND (ri.sale_item_id=si.id OR (ri.sale_item_id IS NULL AND ri.product_id=si.product_id))
              ),0) < si.quantity
            ) THEN 'returned'
            ELSE 'partial_return' END,
          updated_at=@stamp WHERE id=@saleId`,
    params: { saleId, stamp },
  }
}

function auditStatement(user: SessionUser, operationId: string, action: string, count: number): Statement {
  const details = JSON.stringify({ kind: RETURN_BULK_ACTION_KIND, count })
  return {
    sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,new_value)
          VALUES(@userId,@userName,@action,'return',@id,@details,'returns',@id,@details)`,
    params: { userId: user.id ?? null, userName: actorSnapshot(user), action, id: operationId, details },
  }
}

function assertBounded(statements: Statement[], snapshot: Snapshot, eventsBytes = 0): void {
  try {
    assertSaleRecordBatchBounds(snapshot.members.some(member => member.stock.length > 0) ? stockTransactionStatementCount(statements.length) : statements.length, snapshot, eventsBytes)
  } catch (_) {
    fail('Selection is too large for one atomic action. Select fewer returns.', 400)
  }
}

async function saleStatusSnapshots(db: D1Compat, members: Member[]): Promise<SaleStatusSnapshot[]> {
  const overrides = members.filter((member) => member.changed && member.updateSale && member.saleId && member.scope === 'customer')
    .map((member) => ({ id: member.id, status: member.after.status }))
  const saleIds = [...new Set(members.filter((member) => member.changed && member.updateSale && member.saleId).map((member) => member.saleId!))]
  if (!saleIds.length) return []
  const effective = `(COALESCE((SELECT json_extract(o.value,'$.status') FROM json_each(@overrides) o
    WHERE CAST(json_extract(o.value,'$.id') AS INTEGER)=r.id),COALESCE(r.status,'completed')))`
  const rows = await db.prepare(`
    SELECT s.id AS saleId,COALESCE(s.sale_status,'completed') AS beforeStatus,
      CASE
        WHEN NOT EXISTS(SELECT 1 FROM returns r WHERE r.sale_id=s.id AND ${effective}!='cancelled'
          AND COALESCE(r.return_scope,'customer')='customer') THEN COALESCE(s.status_before_return,'completed')
        WHEN NOT EXISTS(
          SELECT 1 FROM sale_items si WHERE si.sale_id=s.id AND COALESCE((
            SELECT SUM(ri.quantity) FROM return_items ri JOIN returns r ON r.id=ri.return_id
            WHERE r.sale_id=s.id AND ${effective}!='cancelled' AND COALESCE(r.return_scope,'customer')='customer'
              AND (ri.sale_item_id=si.id OR (ri.sale_item_id IS NULL AND ri.product_id=si.product_id))
          ),0) < si.quantity
        ) THEN 'returned' ELSE 'partial_return' END AS afterStatus
    FROM sales s
    WHERE EXISTS(SELECT 1 FROM json_each(@saleIds) ids WHERE CAST(ids.value AS INTEGER)=s.id)
    ORDER BY s.id
  `).all<{ saleId: number; beforeStatus: string; afterStatus: string }>({
    overrides: JSON.stringify(overrides), saleIds: JSON.stringify(saleIds),
  })
  return rows.map((row) => ({ saleId: Number(row.saleId), before: String(row.beforeStatus), after: String(row.afterStatus) }))
}

function returnSaleRecordEvents(snapshot: Snapshot, generation: number, via: 'apply' | 'undo' | 'redo', user: SessionUser, stamp: string) {
  return buildSaleRecordEventsInsert((snapshot.saleStatuses || []).flatMap((status) => {
    const before = via === 'undo' ? status.after : status.before
    const after = via === 'undo' ? status.before : status.after
    if (before === after) return []
    const related = snapshot.members.filter((member) => member.changed && member.saleId === status.saleId).map((member) => member.returnNumber)
    return [{
      saleId: status.saleId, sourceKind: 'return_bulk' as const, sourceId: snapshot.operationId,
      generation, kind: 'status_changed' as const, via,
      subject: related.join(', ').slice(0, 240) || null,
      actorId: user.id, actorUsername: actorSnapshot(user), occurredAt: stamp,
      changes: [{
        field: 'sale_status' as const,
        before: { state: 'known_value' as const, value: before },
        after: { state: 'known_value' as const, value: after },
      }],
    }]
  }))
}

function permission(user: SessionUser): void {
  if (getActionTier(user, 'returns', 'bulk') !== 'full') fail('Bulk Returns access is required.', 403)
}

const ENTITLEMENT_GRAPH_MAX_BYTES = 1_500_000
function entitlementGraphExpression(): string {
  return `json_object(
    'returns',COALESCE((SELECT json_group_array(json_object(
      'id',id,'sale_id',sale_id,'status',status,'updated_at',updated_at,
      'money_precision_version',money_precision_version,'calculated_refund_usd',calculated_refund_usd,
      'rounding_adjustment_usd',rounding_adjustment_usd,'total_refund_usd',total_refund_usd,'total_refund_khr',total_refund_khr
    )) FROM (SELECT id,sale_id,status,updated_at,money_precision_version,calculated_refund_usd,
      rounding_adjustment_usd,total_refund_usd,total_refund_khr FROM returns
      WHERE COALESCE(return_scope,'customer')='customer'
        AND EXISTS(SELECT 1 FROM json_each(@entitlementSaleIds) ids WHERE CAST(ids.value AS INTEGER)=sale_id)
      ORDER BY id)),json('[]')),
    'items',COALESCE((SELECT json_group_array(json_object(
      'id',id,'return_id',return_id,'sale_item_id',sale_item_id,'product_id',product_id,'quantity',quantity,
      'total_usd',total_usd,'refund_snapshot_json',refund_snapshot_json
    )) FROM (SELECT ri.id,ri.return_id,ri.sale_item_id,ri.product_id,ri.quantity,ri.total_usd,ri.refund_snapshot_json
      FROM return_items ri JOIN returns r ON r.id=ri.return_id
      WHERE COALESCE(r.return_scope,'customer')='customer'
        AND EXISTS(SELECT 1 FROM json_each(@entitlementSaleIds) ids WHERE CAST(ids.value AS INTEGER)=r.sale_id)
      ORDER BY ri.id)),json('[]'))
  )`
}

async function v1EntitlementGuards(db: D1Compat, members: Member[], target: 'before' | 'after'): Promise<{
  guards: Statement[]; saleStatuses: SaleStatusSnapshot[]
}> {
  const changed = members.filter(member => member.changed && member.scope === 'customer'
    && member.saleId && member.before.status !== member.after.status)
  const saleIds = [...new Set(changed.map(member => member.saleId!))]
  if (!saleIds.length) return { guards: [], saleStatuses: [] }
  const entitlementSaleIds = JSON.stringify(saleIds)
  const graph = await db.prepare(`SELECT ${entitlementGraphExpression()} AS value`).get<{ value: string }>({ entitlementSaleIds })
  const authorityJson = String(graph?.value || '')
  if (!authorityJson || new TextEncoder().encode(authorityJson).byteLength > ENTITLEMENT_GRAPH_MAX_BYTES) {
    fail('The exact refund history is too large to restore safely.', 400)
  }
  const parsed = JSON.parse(authorityJson) as { returns: Row[]; items: Row[] }
  if (!Array.isArray(parsed.returns) || !Array.isArray(parsed.items) || parsed.items.length > 1_000) {
    fail('The exact refund history is too large to restore safely.', 400)
  }
  const override = new Map(changed.map(member => [member.id, member[target].status]))
  const saleLines = await db.prepare(`SELECT s.id AS sale_id,s.sale_status,s.status_before_return,
    si.id AS sale_item_id,si.product_id,si.product_name,si.quantity FROM sales s JOIN sale_items si ON si.sale_id=s.id
    WHERE EXISTS(SELECT 1 FROM json_each(@saleIds) ids WHERE CAST(ids.value AS INTEGER)=s.id)
    ORDER BY s.id,si.id`).all<Row>({ saleIds: entitlementSaleIds })
  const exactStatuses: SaleStatusSnapshot[] = []
  for (const saleId of saleIds) {
    const headers = parsed.returns.filter(row => Number(row.sale_id) === saleId)
    if (!headers.some(row => Number(row.money_precision_version) === 1)) {
      // Legacy (v0) sale: no exact-refund authority to validate, but the
      // quantity cap POST / enforces still holds. A transition that brings a
      // cancelled return back must not leave more units returned against a
      // sale line than it sold -- matched by sale_item_id, else product_id,
      // exactly as assertReturnCreateCapacity matches a new return.
      const reactivates = headers.some(row => override.has(Number(row.id))
        && override.get(Number(row.id)) !== 'cancelled' && normalize(row.status, 'completed') === 'cancelled')
      if (reactivates) {
        const activeIds = new Set(headers.filter(row =>
          (override.get(Number(row.id)) ?? normalize(row.status, 'completed')) !== 'cancelled').map(row => Number(row.id)))
        const activeLines = parsed.items.filter(item => activeIds.has(Number(item.return_id))).map(item => ({
          sale_item_id: item.sale_item_id == null ? null : Number(item.sale_item_id),
          product_id: item.product_id == null ? null : Number(item.product_id),
          quantity: Number(item.quantity),
        }))
        const soldLines = saleLines.filter(row => Number(row.sale_id) === saleId).map(row => ({
          id: Number(row.sale_item_id), product_id: row.product_id == null ? null : Number(row.product_id),
          quantity: Number(row.quantity), product_name: row.product_name == null ? null : String(row.product_name),
        }))
        try {
          assertReturnCreateCapacity(soldLines, [], activeLines)
        } catch (error) {
          fail(`Restoring this return would count more units as returned than the sale sold. ${(error as Error).message}`, 409, 'return_restore_over_capacity',
            error instanceof ReturnCapacityError ? error.params ?? undefined : undefined)
        }
      }
      continue
    }
    const materialize = (rows: Row[]) => rows.map(row => ({
      id: Number(row.id), sale_id: saleId, money_precision_version: Number(row.money_precision_version) as 1,
      calculated_refund_usd: Number(row.calculated_refund_usd), rounding_adjustment_usd: Number(row.rounding_adjustment_usd),
      total_refund_usd: Number(row.total_refund_usd), total_refund_khr: Number(row.total_refund_khr),
      items: parsed.items.filter(item => Number(item.return_id) === Number(row.id)).map(item => ({
        sale_item_id: item.sale_item_id == null ? null : Number(item.sale_item_id), quantity: Number(item.quantity),
        total_usd: Number(item.total_usd), refund_snapshot_json: item.refund_snapshot_json == null ? null : String(item.refund_snapshot_json),
      })),
    })) as CustomerReturnRestorationV1[]
    const cohort = (projected: boolean) => materialize(headers.filter(row => {
      const status = projected ? override.get(Number(row.id)) ?? normalize(row.status, 'completed') : normalize(row.status, 'completed')
      return status !== 'cancelled'
    }))
    const projected = cohort(true)
    try {
      // A transition may remove an aggregate-invalid historical cohort, but a
      // selected v1 member itself must always have intact immutable authority.
      for (const row of materialize(headers.filter(row => override.has(Number(row.id))
        && Number(row.money_precision_version) === 1))) validateCustomerReturnRestorationMemberV1(row)
      if (projected.length) {
        validateCustomerReturnRestorationCohortV1(projected)
      }
    } catch {
      fail('The exact refund entitlement changed. Review the return history before restoring it.', 409)
    }
    const activeIds = new Set(projected.map(row => row.id))
    const lines = saleLines.filter(row => Number(row.sale_id) === saleId)
    const linesById = new Map(lines.map(line => [Number(line.sale_item_id), line]))
    const returned = new Map<number, number[]>()
    for (const item of parsed.items.filter(item => activeIds.has(Number(item.return_id)))) {
      const id = Number(item.sale_item_id)
      if (!Number.isSafeInteger(id) || id <= 0) fail('The exact refund entitlement changed. Review the return history before restoring it.', 409)
      const line = linesById.get(id)
      if (!line || line.product_id !== item.product_id) fail('The exact refund entitlement changed. Review the return history before restoring it.', 409)
      const quantities = returned.get(id) || []
      quantities.push(Number(item.quantity)); returned.set(id, quantities)
    }
    if (!lines.length) fail('The exact refund entitlement changed. Review the return history before restoring it.', 409)
    let fullyReturned = projected.length > 0
    try {
      for (const line of lines) {
        const remainder = subtractDecimalSum(Number(line.quantity), returned.get(Number(line.sale_item_id)) || [])
        if (remainder.startsWith('-')) fail('The exact refund entitlement changed. Review the return history before restoring it.', 409)
        if (remainder !== '0') fullyReturned = false
      }
    } catch { fail('The exact refund entitlement changed. Review the return history before restoring it.', 409) }
    const sale = lines[0]
    exactStatuses.push({ saleId, before: normalize(sale.sale_status, 'completed'),
      after: !projected.length ? normalize(sale.status_before_return, 'completed') : fullyReturned ? 'returned' : 'partial_return' })
  }
  return { guards: [guard(`${entitlementGraphExpression()}=@entitlementAuthorityJson`, { entitlementSaleIds, entitlementAuthorityJson: authorityJson })],
    saleStatuses: exactStatuses }
}

async function buildMembers(db: D1Compat, request: BulkRequest, user: SessionUser, redirectTarget: number | null = null): Promise<{ members: Member[]; guards: Statement[]; exact: CountedStockBatchPlan }> {
  const ids = request.items.map((item) => item.id)
  const returns = await rowsForIds<Row>(db, ids, (marks) => `SELECT r.*,cr.request_json AS supplier_manifest,cr.request_digest AS supplier_digest,${supplierItemsExpression('r.id')} AS supplier_items,COALESCE(v.revision,0) AS write_revision,${movementFingerprint('r.id')} AS movement_fingerprint FROM returns r LEFT JOIN return_create_receipts cr ON cr.return_id=r.id LEFT JOIN return_write_revisions v ON v.return_id=r.id WHERE r.id IN (${marks})`)
  const matchingIds = request.items.flatMap((expected) => {
    const row = returns.find((candidate) => Number(candidate.id) === expected.id)
    if (!row) fail(`Return ${expected.id} changed. The entire group was rejected; refresh before retrying.`)
    const scope = normalize(row.return_scope, 'customer') === 'supplier' ? 'supplier' : 'customer'
    const current = request.field === 'status' ? normalize(row.status, 'completed') : normalize(row[request.field], request.field === 'supplier_settlement' ? 'refund' : 'manual')
    return (request.field === 'status' || request.field === methodField(scope)) && current === request.source ? [expected.id] : []
  })
  if (returns.some((row) => matchingIds.includes(Number(row.id)) && row.movement_fingerprint === null)) fail(`A matching return exceeds ${RETURN_BULK_MOVEMENT_LIMIT} stock movements.`, 400)
  const recordedBranch = 'COALESCE(NULLIF(ri.branch_id,0),r.branch_id)'
  const redirect = Number.isSafeInteger(redirectTarget) && Number(redirectTarget) > 0 ? String(redirectTarget) : '0'
  const stockBranch = `(CASE WHEN EXISTS(SELECT 1 FROM branches WHERE id=${recordedBranch} AND is_active=1) THEN ${recordedBranch} ELSE ${redirect} END)`
  const receiptIds = `(SELECT json_group_array(batch_id) FROM (
    SELECT a.batch_id FROM return_item_batch_allocations a JOIN selected_items s ON s.id=a.return_item_id WHERE s.product_id=ri.product_id
    UNION SELECT s.batch_id FROM selected_items s WHERE s.product_id=ri.product_id
    UNION SELECT d.batch_id FROM damaged_stock_lots d JOIN selected_items s ON s.id=d.return_item_id AND s.return_id=d.return_id WHERE s.product_id=ri.product_id
    UNION SELECT json_extract(src.value,'$.batchId') FROM return_create_receipts cr,json_each(cr.request_json,'$.sources') src
      WHERE cr.return_id=ri.return_id AND json_extract(src.value,'$.productId')=ri.product_id))`
  const items = await rowsForIds<ReturnItem & { counted_branch_id: number; counted_facts: string }>(db, matchingIds, (marks) => `WITH selected_items AS (SELECT * FROM return_items WHERE return_id IN (${marks})) SELECT ri.*,${stockBranch} counted_branch_id,
    ${countedStockFactsSql('ri.product_id', stockBranch, receiptIds)} counted_facts FROM selected_items ri JOIN returns r ON r.id=ri.return_id ORDER BY ri.id LIMIT 301`)
  if (items.length > 300) fail('Select fewer return lines (maximum 300).', 400)
  const allocations = await rowsForIds<Allocation>(db, matchingIds, (marks) => `SELECT a.* FROM return_item_batch_allocations a JOIN return_items ri ON ri.id=a.return_item_id WHERE ri.return_id IN (${marks}) ORDER BY a.id LIMIT 401`)
  if (allocations.length > 400) fail('Select fewer received-date allocations to return (maximum 400).', 400)
  const damaged = await rowsForIds<DamagedLot>(db, matchingIds, (marks) => `SELECT * FROM damaged_stock_lots WHERE return_id IN (${marks}) ORDER BY id LIMIT 301`)
  if (damaged.length > 300) fail('Select fewer damaged-stock rows.', 400)
  const trackedProducts = new Set<number>()
  if (matchingIds.length) {
    const tracked = await rowsForIds<{ id: number }>(db, matchingIds, (marks) => `SELECT DISTINCT pb.variant_product_id AS id FROM product_batches pb JOIN return_items ri ON ri.product_id=pb.variant_product_id WHERE ri.return_id IN (${marks})`)
    tracked.forEach((row) => trackedProducts.add(Number(row.id)))
  }
  const linkedSaleIds = [...new Set(returns.filter((row) => matchingIds.includes(Number(row.id))).map((row) => Number(row.sale_id)).filter((id) => id > 0))]
  const linkedSales = linkedSaleIds.length
    ? await rowsForIds<{ id: number; sale_status: string | null; status_before_return: string | null; stock_skipped: number | null; write_revision: number }>(db, linkedSaleIds, (marks) => `SELECT s.id,s.sale_status,s.status_before_return,s.stock_skipped,COALESCE(v.revision,0) AS write_revision FROM sales s LEFT JOIN sale_write_revisions v ON v.sale_id=s.id WHERE s.id IN (${marks})`)
    : []

  const members: Member[] = []
  const guards: Statement[] = []
  // A line recorded at a branch that has since been retired (Old Shop -> LC Store) moves its stock at the active
  // branch the operator confirmed (X-Branch-Redirect; branch_redirect_required until then), in the lot that exists
  // there now; the return keeps its own branch and label. While every branch is active nothing is redirected and
  // nothing below changes.
  const resolver = new BranchEffectResolver(await readBranchDirectory(db), redirectTarget)
  for (const expected of request.items) {
    const row = returns.find((candidate) => Number(candidate.id) === expected.id)
    if (!row) {
      fail(`Return ${expected.id} changed. The entire group was rejected; refresh before retrying.`)
    }
    const scope: Member['scope'] = normalize(row.return_scope, 'customer') === 'supplier' ? 'supplier' : 'customer'
    const before = valueSnapshot(row)
    const current = request.field === 'status' ? before.status : before[request.field]
    const fieldMatchesScope = request.field === 'status' || request.field === methodField(scope)
    const changed = fieldMatchesScope && current === request.source
    if (changed && (before.status !== expected.expected_status || methodValue(row) !== expected.expected_method || (row.updated_at ?? null) !== expected.expected_updated_at)) {
      fail(`Return ${expected.id} changed. The entire group was rejected; refresh before retrying.`)
    }
    const after = { ...before, ...(changed ? { [request.field]: request.target } : {}) }
    const member: Member = {
      id: expected.id,
      returnNumber: String(row.return_number || expected.id),
      saleId: Number(row.sale_id) || null,
      saleRevision: null,
      moneyPrecisionVersion: Number(row.money_precision_version) || 0,
      scope,
      before,
      after,
      changed,
      reason: changed ? 'changed' : fieldMatchesScope ? 'source_mismatch' : 'scope_mismatch',
      updateSale: false,
      stock: [],
    }
    if (changed && request.field === 'status') {
      const cancelling = before.status === 'completed' && after.status === 'cancelled'
      const restoring = before.status === 'cancelled' && after.status === 'completed'
      if (!cancelling && !restoring) fail(`Return ${expected.id} has an unsupported status transition.`, 400)
      const linkedSale = member.saleId ? linkedSales.find((sale) => Number(sale.id) === member.saleId) : null
      member.saleRevision = linkedSale ? Number(linkedSale.write_revision) || 0 : null
      // RET-B E1 (owner default D1, 5 Oct 2026): a sale recorded without stock
      // changes (stock_skipped -- every sales import since F4) never took its
      // units off the shelf, so cancelling or restoring its return cannot infer
      // which way stock should move. Refused with a code the till translates.
      if (linkedSale && Number(linkedSale.stock_skipped) === 1) fail(`Return ${expected.id} belongs to a stock-skipped sale (recorded without stock changes, such as an imported sale). Cancelling or restoring it would move stock that never moved, so nothing was changed.`, 409, 'return_stock_skipped_sale')
      const parentCancelled = normalize(linkedSale?.sale_status) === 'cancelled'
      if (linkedSale && parentCancelled) {
        fail(`Return ${expected.id} belongs to a cancelled sale. Restore the sale before changing this return status.`, 409)
      }
      if (linkedSale && !parentCancelled && ['returned', 'partial_return'].includes(normalize(linkedSale.sale_status)) && !normalize(linkedSale.status_before_return)) {
        fail(`Return ${expected.id} belongs to a historical sale whose pre-return status was not recorded. Change it individually after confirming the original sale state.`, 409)
      }
      member.updateSale = !!linkedSale && !parentCancelled
      const ownItems = items.filter((item) => item.return_id === expected.id)
      const supplierSources = scope==='supplier' && row.supplier_manifest ? supplierManifestSources(String(row.supplier_manifest),String(row.supplier_items)) : null
      if (supplierSources) {
        if (await sha256Hex(String(row.supplier_manifest)) !== row.supplier_digest) fail('Supplier source history changed.',409)
        const capturedItems=ownItems.map(item=>[item.id,item.product_id,item.branch_id,item.quantity,item.cost_price_usd,item.cost_price_khr,item.stock_condition])
        if(JSON.stringify(capturedItems)!==JSON.stringify(JSON.parse(String(row.supplier_items)))) fail('Supplier return members changed during capture.',409)
        member.supplierManifest={json:String(row.supplier_manifest),digest:String(row.supplier_digest),items:String(row.supplier_items)}
      }
      const memberStockStart = member.stock.length
      const landings = new Map<number, { effectName: string | null; label: string | null }>()
      for (const item of ownItems) {
        const quantity = Number(item.quantity) || 0
        if (!(quantity > 0)) continue
        const productId = Number(item.product_id) || 0
        const recordedBranchId = Number(item.branch_id || row.branch_id) || 0
        if (!productId || !recordedBranchId) fail(`Return ${expected.id} has a stock-moving line without a product or branch.`, 400)
        const stockAction = normalize(item.stock_action, Number(item.return_to_stock) === 1 ? 'restock' : 'none')
        if (scope === 'customer' && stockAction === 'none') continue
        let landing: ReturnType<BranchEffectResolver['effect']> = null
        try { landing = resolver.effect(recordedBranchId) } catch (error) {
          if (error instanceof BranchRetiredNoSuccessorError) fail(error.message, 409, error.code, undefined, error.redirect ? { redirect: error.redirect } : undefined)
          throw error
        }
        // The branch the stock moves at; `recordedBranchId` stays the one the rows were written under.
        const branchId = landing?.redirected ? landing.effectBranchId : recordedBranchId
        if (landing?.redirected) {
          // Held (damaged) units still at the retired branch refuse; units the cutover moved to the successor are found at the landing branch below.
          if (scope === 'customer' && stockAction === 'damaged' && !damaged.some((lot) => Number(lot.return_id) === expected.id && Number(lot.product_id) === productId && Number(lot.branch_id) === branchId)) fail(BRANCH_RETIRED_DAMAGED_ERROR, 409, BRANCH_RETIRED_DAMAGED_CODE)
          const ownLabel = Number(row.branch_id) === landing.addressedBranchId && typeof row.branch_name === 'string' && row.branch_name ? row.branch_name : null
          landings.set(branchId, { effectName: landing.effectName, label: ownLabel ?? landing.addressedName ?? landing.effectName })
        }
        if (supplierSources) {
          const sourceRows=supplierSources.filter(source=>source.itemIndex===ownItems.indexOf(item))
          if (!sourceRows.length || subtractCountedQuantity(quantity,sourceRows.map(source=>source.quantity))!==0) fail('Supplier source history has incomplete quantities.',409)
          for (const source of sourceRows) {
            if (source.productId!==productId || source.branchId!==recordedBranchId || source.condition!==item.stock_condition
              || source.costUsd!==Number(item.cost_price_usd||0) || source.costKhr!==Number(item.cost_price_khr||0)
              || source.lotId!==null && branchId!==recordedBranchId) fail('Supplier source identity changed.',409)
            if(source.lotId!==null){
              const tag=(JSON.parse(item.counted_facts).tags as unknown[][]).find(tag=>tag[0]===source.lotId)
              if(!tag || JSON.stringify([tag[1],tag[2],tag[4],tag[5],tag[6],tag[7],tag[8],tag[9]])!==JSON.stringify(source.lotIdentity)) fail('Supplier tagged source identity changed.',409)
            }
            member.stock.push({productId,productName:item.product_name,branchId,batchId:source.batchId,damagedLotId:source.lotId,
              quantity:(cancelling?1:-1)*source.quantity,costUsd:source.costUsd,costKhr:source.costKhr,movementType:''})
          }
          continue
        }
        if (scope === 'customer' && stockAction === 'damaged') {
          if(!item.stock_condition || item.stock_condition==='ordinary') fail(`Return ${expected.id} has no chosen condition attribution.`,409)
          const lots=damaged.filter(lot=>Number(lot.return_id)===expected.id && Number(lot.return_item_id)===item.id
            && Number(lot.product_id)===productId && Number(lot.branch_id)===branchId && lot.condition_tag===item.stock_condition)
          if(!lots.length) fail(`Return ${expected.id} has no exact damaged-stock provenance.`,409)
          const itemQuantity=quantity
          const lotQuantity=sumCountedQuantities(lots.map(lot=>Number(lot.quantity||0)))
          if(subtractCountedQuantity(itemQuantity,[lotQuantity])!==0) fail(`Return ${expected.id} has incomplete damaged-stock provenance.`,400)
          const costUsd=Number(item.cost_price_usd)||0,costKhr=Number(item.cost_price_khr)||0
          for (const lot of lots) {
            if (cancelling && Number(lot.quantity_remaining) !== Number(lot.quantity)) fail(`Damaged stock from return ${expected.id} has already been consumed.`, 409)
            if (restoring && Number(lot.quantity_remaining) !== 0) fail(`Damaged stock from return ${expected.id} is not fully cancelled.`, 409)
            member.stock.push({ productId, productName: item.product_name, branchId, batchId: lot.batch_id, damagedLotId: lot.id, quantity: cancelling ? -Number(lot.quantity) : Number(lot.quantity), costUsd, costKhr, movementType: '' })
          }
          continue
        }
        const ownAllocations = allocations.filter((allocation) => allocation.return_item_id === item.id)
        if (ownAllocations.length) {
          const allocated = sumCountedQuantities(ownAllocations.map(allocation => Number(allocation.quantity || 0)))
          if (subtractCountedQuantity(allocated,[quantity])!==0) fail(`Return ${expected.id} has incomplete received-date provenance.`, 400)
          for (const allocation of ownAllocations) {
            if (Number(allocation.branch_id) !== recordedBranchId) fail(`Return ${expected.id} has a lot allocation for a different branch.`, 400)
            member.stock.push({ productId, productName: item.product_name, branchId, batchId: Number(allocation.batch_id), damagedLotId: null, quantity: (scope === 'customer' ? (cancelling ? -1 : 1) : (cancelling ? 1 : -1)) * Number(allocation.quantity), costUsd: Number(item.cost_price_usd) || 0, costKhr: Number(item.cost_price_khr) || 0, movementType: '' })
          }
        } else if (item.batch_id) {
          member.stock.push({ productId, productName: item.product_name, branchId, batchId: Number(item.batch_id), damagedLotId: null, quantity: (scope === 'customer' ? (cancelling ? -1 : 1) : (cancelling ? 1 : -1)) * quantity, costUsd: Number(item.cost_price_usd) || 0, costKhr: Number(item.cost_price_khr) || 0, movementType: '' })
        } else if (trackedProducts.has(productId) && item.stock_condition !== 'ordinary') {
          fail(`Return ${expected.id} predates exact received-date tracking. Its stock cannot be changed safely in bulk; edit stock with the recorded received-date details first.`, 400)
        } else {
          member.stock.push({ productId, productName: item.product_name, branchId, batchId: null, damagedLotId: null, quantity: (scope === 'customer' ? (cancelling ? -1 : 1) : (cancelling ? 1 : -1)) * quantity, costUsd: Number(item.cost_price_usd) || 0, costKhr: Number(item.cost_price_khr) || 0, movementType: '' })
        }
      }
      for (const [landingBranchId, { effectName, label }] of landings) {
        const own = member.stock.slice(memberStockStart).filter((delta) => delta.branchId === landingBranchId)
        const folded = await foldedLotSurvivors(db, landingBranchId, own.filter((delta) => delta.batchId).map((delta) => Number(delta.batchId)))
        for (const delta of own) {
          if (delta.batchId) delta.batchId = folded.get(Number(delta.batchId)) ?? delta.batchId
          delta.branchName = effectName
          delta.addressed = label ?? effectName ?? 'retired branch'
        }
      }
    }
    if (changed) {
      guards.push(guard(`NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance') AND EXISTS(SELECT 1 FROM returns WHERE id=@id)
        AND COALESCE((SELECT revision FROM return_write_revisions WHERE return_id=@id),0)=@revision AND ${movementFingerprint('@id')}=@fingerprint
        AND ${taggedReturnAuthority()} AND ${supplierManifestAuthority()} AND (@supplierManifest IS NULL OR (${stockActorPredicate}))${member.saleRevision === null ? '' : ' AND EXISTS(SELECT 1 FROM sales WHERE id=@saleId) AND COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=@saleId),0)=@saleRevision'}`,
      { id: expected.id, revision: Number(row.write_revision)||0, fingerprint: row.movement_fingerprint, taggedSources: JSON.stringify(taggedSources(member,items,damaged)), ...supplierManifestParams(member), ...stockActorParams(user),
        ...(member.saleRevision === null ? {} : { saleId: member.saleId, saleRevision: member.saleRevision }) }))
    }
    members.push(member)
  }
  const effectGuards = resolver.guards()
  if (effectGuards.length) guards.push(guard(branchEffectGuardPredicate('@effects'), { effects: JSON.stringify(effectGuards) }))
  const keys = new Set(members.flatMap(member=>member.stock.map(delta=>`${delta.productId}:${delta.branchId}`)))
  const exact = new CountedStockBatchPlan(items.filter(item=>keys.has(`${item.product_id}:${item.counted_branch_id}`))
    .map(item=>({facts:item.counted_facts,branchId:item.counted_branch_id})), { deferPhysicalWrites: true })
  return { members, guards, exact }
}

export async function notifyReturnBulkAction(env: Env): Promise<void> {
  await Promise.allSettled([
    bumpVersions(env, ['returns','products','sales']),
    ...(['returns', 'products', 'inventory', 'sales'] as const).map((channel) => broadcast(env, channel, { action: 'update' })),
  ])
}

export async function applyReturnBulkAction(env: Env, user: SessionUser, raw: Row, redirectTarget: number | null = null): Promise<Row> {
  return (await applyReturnBulkActionOutcome(env, user, raw, redirectTarget)).receipt
}

/**
 * The receipt, and whether THIS call's own batch wrote it. `wrote` is false
 * for every replay of a request id: a sequential retry (early replay below),
 * a retry that overtook a slow original, and the original overtaken by its
 * retry (either replay path). routes/returns.ts announces a status change to
 * Telegram only when `wrote` is true, so one write is announced once even
 * when the app's own retry (Returns.tsx, same client_request_id after its
 * client timeout) races the first request (R-telegram E1, 27 Sep 2026). A
 * check made BEFORE the write cannot say this; only the batch outcome can.
 */
export type ReturnBulkOutcome = { receipt: Row; wrote: boolean }

function exactBulkRefusal(error: unknown): never {
  if (isCountedStockConflict(error)) fail('The exact stock or condition source changed. Nothing was applied; refresh before retrying.',409,'write_conflict')
  if (error instanceof MoneyPrecisionError) fail(error.message,400,'invalid_bulk_action')
  throw error
}

export async function applyReturnBulkActionOutcome(env: Env, user: SessionUser, raw: Row, redirectTarget: number | null = null): Promise<ReturnBulkOutcome> {
  try { return await applyReturnBulkActionOutcomeKernel(env,user,raw,redirectTarget) } catch(error) { return exactBulkRefusal(error) }
}

async function applyReturnBulkActionOutcomeKernel(env: Env, user: SessionUser, raw: Row, redirectTarget: number | null = null): Promise<ReturnBulkOutcome> {
  permission(user)
  const request = parseRequest(raw)
  const db = getDb(env)
  const canonical = JSON.stringify(request)
  const previous = await db.prepare('SELECT request_json,receipt_json FROM return_bulk_operations WHERE actor_id=@actor AND request_id=@request').get<Row>({ actor: user.id, request: request.client_request_id })
  if (previous) {
    if (previous.request_json !== canonical) fail('Request id was already used with different data.')
    return { receipt: JSON.parse(String(previous.receipt_json)) as Row, wrote: false }
  }
  const { members, guards, exact } = await buildMembers(db, request, user, redirectTarget)
  const entitlement = await v1EntitlementGuards(db, members, 'after')
  guards.push(...entitlement.guards)
  const operationId = crypto.randomUUID()
  const stamp = new Date().toISOString()
  const ordinarySaleStatuses = request.field === 'status' ? await saleStatusSnapshots(db, members) : []
  const exactBySale = new Map(entitlement.saleStatuses.map(status => [status.saleId, status]))
  const snapshot: Snapshot = { version: 1, operationId, field: request.field, members,
    saleStatuses: ordinarySaleStatuses.map(status => exactBySale.get(status.saleId) || status) }
  const changedIds = members.filter((member) => member.changed).map((member) => member.id)
  const unchangedIds = members.filter((member) => !member.changed).map((member) => member.id)
  const receipt = {
    operationId,
    changedIds,
    unchangedIds,
    changedCount: changedIds.length,
    unchangedCount: unchangedIds.length,
    currentReplayGeneration: 0,
    items: members.map((member) => ({
      id: member.id,
      return_number: member.returnNumber,
      before: request.field === 'status' ? member.before.status : member.before[request.field],
      after: request.field === 'status' ? member.after.status : member.after[request.field],
      changed: member.changed,
      reason: member.reason,
    })),
  }
  const statements: Statement[] = [
    ...exact.takePreimageGuards(),
    ...guards,
    { sql: 'INSERT INTO return_bulk_operations(id,actor_id,request_id,request_json,receipt_json) VALUES(@id,@actor,@request,@canonical,@receipt)', params: { id: operationId, actor: user.id, request: request.client_request_id, canonical, receipt: JSON.stringify(receipt) } },
  ]
  for (const member of members) statements.push(...memberStatements(member, 1, user, stamp, exact))
  statements.push(...exact.takeFinalPhysicalWrites())
  for (const saleId of [...new Set(members.filter((member) => member.changed && member.updateSale && member.saleId).map((member) => member.saleId!))]) {
    statements.push(saleStatusStatement(saleId, stamp, exactBySale.get(saleId)?.after))
  }
  const recordEvents = returnSaleRecordEvents(snapshot, 0, 'apply', user, stamp)
  if (recordEvents) statements.push(recordEvents.statement)
  statements.push({ sql: 'INSERT INTO undo_snapshots(kind,payload_json,created_by_id,created_by_name) VALUES(@kind,@payload,@actor,@name)', params: { kind: RETURN_BULK_ACTION_KIND, payload: JSON.stringify(snapshot), actor: user.id, name: actorSnapshot(user) } })
  statements.push({ sql: 'UPDATE return_bulk_operations SET snapshot_id=last_insert_rowid() WHERE id=@id', params: { id: operationId } })
  const historyIndex = statements.length
  statements.push({
    sql: `INSERT INTO action_history(scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_id,created_by_name)
          SELECT 'returns','return',id,@label,@reversible,@status,
            json_object('applier',@kind,'snapshot_id',snapshot_id,'operation_id',id,'generation',0,'field',@field,'source',@source,'target',@target,'changed_count',@changed,'unchanged_count',@unchanged),
            json_object('applier',@kind,'snapshot_id',snapshot_id,'operation_id',id,'generation',0,'field',@field,'source',@source,'target',@target,'changed_count',@changed,'unchanged_count',@unchanged),
            @actor,@name FROM return_bulk_operations WHERE id=@id`,
    params: { id: operationId, label: `${changedIds.length} returns: ${request.field} ${request.source} → ${request.target}; ${unchangedIds.length} unchanged`, reversible: changedIds.length ? 1 : 0, status: changedIds.length ? 'undoable' : 'recorded', kind: RETURN_BULK_ACTION_KIND, field: request.field, source: request.source, target: request.target, changed: changedIds.length, unchanged: unchangedIds.length, actor: user.id, name: actorSnapshot(user) },
  })
  statements.push({ sql: "UPDATE return_bulk_operations SET history_id=last_insert_rowid(),receipt_json=json_set(receipt_json,'$.actionHistoryId',last_insert_rowid()) WHERE id=@id", params: { id: operationId } })
  for (const member of members.filter((candidate) => candidate.changed)) {
    statements.push({ sql: `INSERT INTO return_bulk_members(operation_id,return_id,revision,sale_id,sale_revision,stock_fingerprint) VALUES(@operation,@id,COALESCE((SELECT revision FROM return_write_revisions WHERE return_id=@id),0),@saleId,CASE WHEN @saleId IS NULL THEN NULL ELSE COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=@saleId),0) END,${movementFingerprint('@id')})`, params: { operation: operationId, id: member.id, saleId: member.saleId } })
  }
  statements.push(auditStatement(user, operationId, 'return_fields_bulk', changedIds.length))
  statements.push({ sql: 'DELETE FROM return_bulk_guards', params: {} })
  assertBounded(statements, snapshot, recordEvents?.eventsBytes || 0)
  const counted=members.some(member=>member.stock.length>0)
  const planned=counted?stockTransactionStatementCount(statements.length):statements.length
  try { assertReturnCreateQueryBudget(getPlanLimits(env).d1QueriesPerInvocation,
    currentRequestMetrics()?.invocation.attemptedStatements ?? 18,planned,
      members.some(member=>!!member.supplierManifest)?Math.max(12,9+2*new Set(members.filter(member=>member.changed).map(member=>member.scope)).size):12)
  } catch(error) { if(error instanceof ReturnCreateBudgetError) fail(error.message,400,error.code);throw error }

  try {
    const results = await (counted ? executeStockTransaction(db, statements, 'once') : db.batchOnce!(statements))
    return { receipt: { ...receipt, actionHistoryId: Number(results[historyIndex].meta.last_row_id) }, wrote: true }
  } catch (error) {
    let retry: Row | undefined
    try {retry = await db.prepare('SELECT request_json,receipt_json FROM return_bulk_operations WHERE actor_id=@actor AND request_id=@request').getOnce!<Row>({ actor: user.id, request: request.client_request_id })}
    catch(readError){if(members.some(member=>!!member.supplierManifest || member.stock.some(delta=>delta.damagedLotId!==null)))throw new ReturnBulkError('The supplier return status outcome could not be confirmed. Retry the original request.',503,'supplier_return_status_outcome_unknown');throw readError}
    if (retry?.request_json === canonical) {
      const stored = JSON.parse(String(retry.receipt_json)) as Row
      // operationId is this call's own random UUID: the stored receipt carries
      // it only when THIS batch committed and the error came after the commit.
      // Any other receipt was written by a concurrent call with the same id.
      return { receipt: stored, wrote: stored.operationId === operationId }
    }
    const activeGuard = productStockGuardError(error)

    if (activeGuard) throw activeGuard

    if (/CHECK constraint failed:\s*guard_value\s*=\s*1/i.test(String(error))) fail('A return or its stock changed. Nothing in the group was applied.')
    if(members.some(member=>!!member.supplierManifest || member.stock.some(delta=>delta.damagedLotId!==null)) && !isCountedStockConflict(error))throw new ReturnBulkError('The supplier return status outcome could not be confirmed. Retry the original request.',503,'supplier_return_status_outcome_unknown')
    throw error
  }
}

export async function replayReturnBulkAction(env: Env, user: SessionUser, direction: 'undo' | 'redo', historyId: number, generation: unknown, payload: Row): Promise<void> {
  try { return await replayReturnBulkActionKernel(env,user,direction,historyId,generation,payload) } catch(error) { return exactBulkRefusal(error) }
}

async function replayReturnBulkActionKernel(env: Env, user: SessionUser, direction: 'undo' | 'redo', historyId: number, generation: unknown, payload: Row): Promise<void> {
  permission(user)
  if (!Number.isSafeInteger(generation) || Number(generation) < 0) fail('Refresh history before replaying this group.')
  const db = getDb(env)
  const operation = await db.prepare(`SELECT o.*,s.payload_json,s.kind,s.status AS snapshot_status,h.status AS replay_status,
    ${replayCountedFactsSql('s.payload_json')} counted_facts,${supplierReplayWitnessSql()} supplier_witness,${taggedReplayWitnessSql()} tagged_witness,${customerReplayWitnessSql()} customer_witness FROM return_bulk_operations o JOIN undo_snapshots s ON s.id=o.snapshot_id JOIN action_history h ON h.id=o.history_id WHERE o.history_id=?`).get<Row>([historyId])
  if (!operation || operation.kind !== RETURN_BULK_ACTION_KIND || operation.id !== payload.operation_id || operation.snapshot_id !== payload.snapshot_id) fail('This grouped Return action changed or its snapshot does not match.')
  const snapshot = JSON.parse(String(operation.payload_json)) as Snapshot
  if (snapshot.version!==1 || snapshot.operationId!==operation.id || !Array.isArray(snapshot.members) || snapshot.members.length>RETURN_BULK_LIMIT) fail('Unsupported Return bulk snapshot.')
  const tagged=replayTaggedSources(operation,snapshot)
  const customers=replayCustomerStock(operation,snapshot)
  const supplierFingerprints=validateSupplierReplayStock(operation,snapshot)
  const supplierExact=supplierFingerprints!==null
  const exactReplay=supplierExact || tagged.size>0
  const pinOperationAuthority=exactReplay || customers.size>0
  for (const member of snapshot.members) if(member.supplierManifest) {
    supplierManifestSources(member.supplierManifest.json,member.supplierManifest.items)
    if(await sha256Hex(member.supplierManifest.json)!==member.supplierManifest.digest) fail('Supplier source history changed.',409)
  }
  const confirmedStatus=direction==='undo'?'redoable':'undoable'
  const confirmedSnapshot=direction==='undo'?'reversed':'applied'
  if (Number(operation.generation)!==Number(generation)) {
    if(exactReplay && Number(operation.generation)===Number(generation)+1 && operation.replay_status===confirmedStatus && operation.snapshot_status===confirmedSnapshot)return
    fail('This grouped Return replay generation changed.')
  }
  const exact = new CountedStockBatchPlan(JSON.parse(String(operation.counted_facts || '[]')) as {facts:string;branchId:number}[], { deferPhysicalWrites: true })
  if (snapshot.version !== 1 || snapshot.operationId !== operation.id || snapshot.members.length > RETURN_BULK_LIMIT) fail('Unsupported Return bulk snapshot.')
  const expectedStatus = direction === 'undo' ? 'undoable' : 'redoable'
  const nextStatus = direction === 'undo' ? 'redoable' : 'undoable'
  const snapshotStatus = direction === 'undo' ? 'applied' : 'reversed'
  const directionSign: 1 | -1 = direction === 'undo' ? -1 : 1
  const stamp = new Date().toISOString()
  const statements: Statement[] = [...exact.takePreimageGuards(),guard(`NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance') AND EXISTS(SELECT 1 FROM return_bulk_operations o JOIN action_history h ON h.id=o.history_id JOIN undo_snapshots s ON s.id=o.snapshot_id WHERE o.id=@operation AND o.generation=@generation AND h.id=@history AND h.status=@expectedStatus AND s.kind=@kind AND s.status=@snapshotStatus AND s.payload_json=@snapshot${pinOperationAuthority?' AND o.request_json=@originalRequest AND o.receipt_json=@originalReceipt':''})`, { operation: operation.id, generation, history: historyId, expectedStatus, kind: RETURN_BULK_ACTION_KIND, snapshotStatus, snapshot: operation.payload_json,...(pinOperationAuthority?{originalRequest:operation.request_json,originalReceipt:operation.receipt_json}:{}) })]
  const replayEntitlement = await v1EntitlementGuards(db, snapshot.members, direction === 'undo' ? 'before' : 'after')
  statements.push(...replayEntitlement.guards)
  for (const member of snapshot.members.filter((candidate) => candidate.changed)) {
    const customer=customers.get(member.id)
    statements.push(guard(`EXISTS(SELECT 1 FROM returns r JOIN return_bulk_members m ON m.return_id=r.id WHERE m.operation_id=@operation AND r.id=@id AND m.revision=COALESCE((SELECT revision FROM return_write_revisions WHERE return_id=r.id),0) AND m.stock_fingerprint=${movementFingerprint('r.id')} AND (@taggedFingerprint IS NULL OR m.stock_fingerprint=@taggedFingerprint)${supplierExact?' AND m.stock_fingerprint=@capturedFingerprint':''}${customer?' AND m.stock_fingerprint=@customerFingerprint':''} AND (m.sale_id IS NULL OR (EXISTS(SELECT 1 FROM sales WHERE id=m.sale_id) AND m.sale_revision=COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=m.sale_id),0)))) AND ${taggedReturnAuthority()} AND ${supplierManifestAuthority()} AND (@supplierManifest IS NULL OR (${stockActorPredicate}))${customer?` AND ${customerSourcesSql('@id')}=@customerSources AND ${customerMovementsSql('@id')}=@customerMovements AND ${customerTagMembersSql('@id')}=@customerTags AND (${branchEffectGuardPredicate('@customerEffects')})`:''}`, { operation: operation.id, id: member.id, taggedSources: JSON.stringify(tagged.get(member.id)||[]), taggedFingerprint:tagged.get(member.id)?.[0]?.fingerprint??null, ...supplierManifestParams(member), ...stockActorParams(user),...(supplierExact?{capturedFingerprint:supplierFingerprints!.get(member.id)}:{}),...(customer?{customerSources:customer.sources,customerFingerprint:customer.fingerprint,customerEffects:customer.effects,customerMovements:customer.movements,customerTags:customer.tags}:{}) }))
  }
  for (const member of snapshot.members) statements.push(...memberStatements(member, directionSign, user, stamp, exact))
  statements.push(...exact.takeFinalPhysicalWrites())
  const replayExact = new Map(replayEntitlement.saleStatuses.map(status => [status.saleId, status]))
  for (const saleId of [...new Set(snapshot.members.filter((member) => member.changed && member.updateSale && member.saleId).map((member) => member.saleId!))]) {
    statements.push(saleStatusStatement(saleId, stamp, replayExact.get(saleId)?.after))
  }
  const nextGeneration = Number(generation) + 1
  const recordEvents = returnSaleRecordEvents(snapshot, nextGeneration, direction, user, stamp)
  if (recordEvents) statements.push(recordEvents.statement)
  for (const member of snapshot.members.filter((candidate) => candidate.changed)) statements.push({ sql: `UPDATE return_bulk_members SET revision=COALESCE((SELECT revision FROM return_write_revisions WHERE return_id=@id),0),sale_revision=CASE WHEN sale_id IS NULL THEN NULL ELSE COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_write_revisions.sale_id=return_bulk_members.sale_id),0) END,stock_fingerprint=${movementFingerprint('@id')} WHERE operation_id=@operation AND return_id=@id`, params: { operation: operation.id, id: member.id } })
  statements.push({ sql: 'UPDATE return_bulk_operations SET generation=generation+1 WHERE id=@operation', params: { operation: operation.id } })
  statements.push({ sql: 'UPDATE undo_snapshots SET status=@status,updated_at=@stamp WHERE id=@id', params: { id: operation.snapshot_id, status: direction === 'undo' ? 'reversed' : 'applied', stamp } })
  statements.push({ sql: "UPDATE action_history SET status=@status,last_error=NULL,updated_at=@stamp,undo_payload=json_set(undo_payload,'$.generation',@generation),redo_payload=json_set(redo_payload,'$.generation',@generation) WHERE id=@id", params: { id: historyId, status: nextStatus, stamp, generation: Number(generation) + 1 } })
  statements.push(auditStatement(user, String(operation.id), `action_${direction}`, snapshot.members.filter((member) => member.changed).length))
  statements.push({ sql: 'DELETE FROM return_bulk_guards', params: {} })
  assertBounded(statements, snapshot, recordEvents?.eventsBytes || 0)
  if(exactReplay){
    const groups=new Set(snapshot.members.filter(member=>member.changed).map(member=>`${member.scope}:${directionSign>0?member.after.status:member.before.status}`)).size
    // Both cache paths six each, IDs/status/history six, per-group config two, and once-only ACK confirmation one.
    try {assertReturnCreateQueryBudget(getPlanLimits(env).d1QueriesPerInvocation,currentRequestMetrics()?.invocation.attemptedStatements??18,
      stockTransactionStatementCount(statements.length),19+2*groups)}
    catch(error){if(error instanceof ReturnCreateBudgetError)fail(error.message,400,'supplier_return_replay_over_plan_budget');throw error}
  }
  try {
    await (snapshot.members.some(member => member.stock.length > 0) ? executeStockTransaction(db, statements, exactReplay?'once':'retry') : db.batch(statements))
  } catch (error) {
    if(exactReplay && !isCountedStockConflict(error) && !/CHECK constraint failed:\s*guard_value\s*=\s*1/i.test(String(error)) && !productStockGuardError(error)){
      try {
        const confirmed=await db.prepare(`SELECT o.generation,s.payload_json,s.status AS snapshot_status,h.status AS replay_status
          FROM return_bulk_operations o JOIN undo_snapshots s ON s.id=o.snapshot_id JOIN action_history h ON h.id=o.history_id
          WHERE o.id=@operation AND o.history_id=@history AND o.snapshot_id=@snapshot`).getOnce!<Row>({operation:operation.id,history:historyId,snapshot:operation.snapshot_id})
        if(Number(confirmed?.generation)===Number(generation)+1 && confirmed?.payload_json===operation.payload_json
          && confirmed?.replay_status===confirmedStatus && confirmed?.snapshot_status===confirmedSnapshot)return
      }catch(_){}
      throw new ReturnBulkError('The grouped Return replay outcome could not be confirmed. Keep the original replay and retry it.',503,supplierExact?'supplier_return_replay_outcome_unknown':'return_bulk_replay_outcome_unknown')
    }
    const activeGuard = productStockGuardError(error)

    if (activeGuard) throw activeGuard

    if (/CHECK constraint failed:\s*guard_value\s*=\s*1/i.test(String(error))) fail('A return, its stock, or this replay changed. Nothing in the group was applied.')
    throw error
  }
}
