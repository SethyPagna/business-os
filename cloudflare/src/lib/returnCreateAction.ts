import { assertSaleRecordBatchBounds } from './saleRecordEvents'

export type ReturnCreateStatement = { sql: string; params: Record<string, unknown> }

export const RETURN_CREATE_MAX_ITEMS = 50
export const RETURN_CREATE_MAX_REPLACEMENT_ITEMS = 50
export const RETURN_CREATE_MAX_STATEMENTS = 500
export const RETURN_CREATE_REQUEST_BYTES = 512_000

export type ReturnCreateResponse = {
  id: number
  returnNumber: string
  replacementSaleId: number | null
  replacementReceiptNumber: string | null
}

type CanonicalItem = {
  sale_item_id: number | null
  product_id: number | null
  product_name: string | null
  quantity: number
  applied_price_usd: number
  applied_price_khr: number
  cost_price_usd: number
  cost_price_khr: number
  stock_action: 'none' | 'restock' | 'damaged'
  branch_id: number | null
  batch_id: number | null
}

type CanonicalReplacementItem = {
  product_id: number
  product_name: string | null
  branch_id: number | null
  batch_id: number | null
  quantity: number
  applied_price_usd: number | null
  applied_price_khr: number | null
}

function positiveId(value: unknown): number | null {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

function finite(value: unknown, fallback = 0): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function optionalFinite(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function boundedText(value: unknown, max: number): string | null {
  const normalized = String(value ?? '').trim()
  if (!normalized) return null
  if (new TextEncoder().encode(normalized).byteLength > max) {
    throw new Error(`Text value exceeds ${max} UTF-8 bytes`)
  }
  return normalized
}

function canonicalStockAction(item: Record<string, unknown>): 'none' | 'restock' | 'damaged' {
  const explicit = String(item.stock_action ?? '').trim().toLowerCase()
  if (explicit === 'restock' || explicit === 'damaged' || explicit === 'none') return explicit
  return item.return_to_stock === false ? 'none' : 'restock'
}

function canonicalItem(value: unknown, index: number): CanonicalItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Return item ${index + 1} must be an object`)
  }
  const item = value as Record<string, unknown>
  const quantity = finite(item.quantity)
  if (!(quantity > 0)) throw new Error(`Return item ${index + 1} quantity must be greater than zero`)
  return {
    sale_item_id: positiveId(item.sale_item_id),
    product_id: positiveId(item.product_id),
    product_name: boundedText(item.product_name, 500),
    quantity,
    applied_price_usd: finite(item.applied_price_usd),
    applied_price_khr: finite(item.applied_price_khr),
    cost_price_usd: finite(item.cost_price_usd ?? item.unit_cost_usd),
    cost_price_khr: finite(item.cost_price_khr ?? item.unit_cost_khr),
    stock_action: canonicalStockAction(item),
    branch_id: positiveId(item.branch_id),
    batch_id: positiveId(item.batch_id),
  }
}

function canonicalReplacementItem(value: unknown, index: number): CanonicalReplacementItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Replacement item ${index + 1} must be an object`)
  }
  const item = value as Record<string, unknown>
  const productId = positiveId(item.product_id)
  const quantity = finite(item.quantity)
  if (!productId || !(quantity > 0)) throw new Error(`Replacement item ${index + 1} needs a product and positive quantity`)
  return {
    product_id: productId,
    product_name: boundedText(item.product_name, 500),
    branch_id: positiveId(item.branch_id),
    batch_id: positiveId(item.batch_id),
    quantity,
    applied_price_usd: optionalFinite(item.applied_price_usd),
    applied_price_khr: optionalFinite(item.applied_price_khr),
  }
}

// Only accepted client intent belongs in this digest input. Refund totals,
// generated ids/numbers, current product/contact values, and every other
// server-derived fact are deliberately excluded so an exact retry remains
// stable after mutable database state changes.
export function canonicalReturnCreateIntent(body: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(body.items) || body.items.length === 0) throw new Error('Return items required')
  if (body.items.length > RETURN_CREATE_MAX_ITEMS) throw new Error(`Return at most ${RETURN_CREATE_MAX_ITEMS} items at a time`)
  const replacements = body.replacement_items == null ? [] : body.replacement_items
  if (!Array.isArray(replacements)) throw new Error('replacement_items must be an array')
  if (replacements.length > RETURN_CREATE_MAX_REPLACEMENT_ITEMS) {
    throw new Error(`Add at most ${RETURN_CREATE_MAX_REPLACEMENT_ITEMS} replacement items at a time`)
  }
  const reason = boundedText(body.reason, 500)
  if (!reason) throw new Error('Reason is required')
  return {
    sale_id: positiveId(body.sale_id),
    return_number: boundedText(body.return_number, 120),
    receipt_number: boundedText(body.receipt_number, 120),
    customer_id: positiveId(body.customer_id),
    customer_name: boundedText(body.customer_name, 240),
    branch_id: positiveId(body.branch_id),
    reason,
    return_type: boundedText(body.return_type, 120) || 'restock',
    notes: boundedText(body.notes, 2000),
    exchange_rate: optionalFinite(body.exchange_rate),
    items: body.items.map(canonicalItem),
    replacement_items: replacements.map(canonicalReplacementItem),
    replacement_payment_method: boundedText(body.replacement_payment_method, 120) || 'Cash',
  }
}

export function projectedSaleStatusForReturnCreate(
  saleItems: Array<{ id: number; product_id: number | null; quantity: number }>,
  committedReturnLines: Array<{ sale_item_id?: number | null; product_id?: number | null; quantity: number }>,
  requestLines: Array<{ sale_item_id?: number | null; product_id?: number | null; quantity: number }>,
  statusBeforeReturn: string | null,
): string {
  const saleItemIds = new Set(saleItems.map((item) => Number(item.id)))
  const returnedByItem = new Map<number, number>()
  const fallbackByProduct = new Map<number, number>()
  const allLines = [...committedReturnLines, ...requestLines]
  let hasAny = false
  for (const line of allLines) {
    const quantity = Number(line.quantity) || 0
    if (!(quantity > 0)) continue
    hasAny = true
    const saleItemId = Number(line.sale_item_id) || 0
    if (saleItemId && saleItemIds.has(saleItemId)) {
      returnedByItem.set(saleItemId, (returnedByItem.get(saleItemId) || 0) + quantity)
      continue
    }
    const productId = Number(line.product_id) || 0
    if (productId) fallbackByProduct.set(productId, (fallbackByProduct.get(productId) || 0) + quantity)
  }
  for (const item of saleItems) {
    const productId = Number(item.product_id) || 0
    const fallback = fallbackByProduct.get(productId) || 0
    if (!(fallback > 0)) continue
    const capacity = Math.max(0, Number(item.quantity) - (returnedByItem.get(item.id) || 0))
    const allocated = Math.min(capacity, fallback)
    if (allocated > 0) returnedByItem.set(item.id, (returnedByItem.get(item.id) || 0) + allocated)
    fallbackByProduct.set(productId, fallback - allocated)
  }
  const fullyReturned = hasAny && saleItems.every((item) => (returnedByItem.get(item.id) || 0) >= Number(item.quantity))
  return fullyReturned ? 'returned' : hasAny ? 'partial_return' : (statusBeforeReturn || 'completed')
}

export function assertReturnCreateCapacity(
  saleItems: Array<{ id: number; product_id: number | null; quantity: number; product_name?: string | null }>,
  committedReturnLines: Array<{ sale_item_id?: number | null; product_id?: number | null; quantity: number }>,
  requestLines: Array<{ sale_item_id?: number | null; product_id?: number | null; quantity: number }>,
): void {
  const byId = new Map(saleItems.map((item) => [Number(item.id), item]))
  const usedByItem = new Map<number, number>()
  const fallbackByProduct = new Map<number, number>()
  for (const line of [...committedReturnLines, ...requestLines]) {
    const quantity = Number(line.quantity) || 0
    if (!(quantity > 0)) continue
    const saleItemId = Number(line.sale_item_id) || 0
    if (saleItemId) {
      const item = byId.get(saleItemId)
      if (!item) throw new Error('Sale item not found for this return')
      usedByItem.set(saleItemId, (usedByItem.get(saleItemId) || 0) + quantity)
      continue
    }
    const productId = Number(line.product_id) || 0
    if (!productId) throw new Error('Each return line needs a sale item or product')
    fallbackByProduct.set(productId, (fallbackByProduct.get(productId) || 0) + quantity)
  }
  for (const item of saleItems) {
    const used = usedByItem.get(item.id) || 0
    if (used > Number(item.quantity)) {
      throw new Error(`Cannot return ${used} of ${item.product_name || 'this item'} — only ${Math.max(0, Number(item.quantity))} sold`)
    }
    const productId = Number(item.product_id) || 0
    let fallback = fallbackByProduct.get(productId) || 0
    if (!(fallback > 0)) continue
    const remaining = Math.max(0, Number(item.quantity) - used)
    const allocated = Math.min(remaining, fallback)
    usedByItem.set(item.id, used + allocated)
    fallbackByProduct.set(productId, fallback - allocated)
  }
  const overflow = [...fallbackByProduct.entries()].find(([, quantity]) => quantity > 0)
  if (overflow) throw new Error(`Cannot return ${overflow[1]} additional unit(s) of product #${overflow[0]} — only the unreturned sold quantity is eligible`)
}

export function returnCreateGuardStatement(
  operationId: string,
  phase: 'precondition' | 'postcondition',
  predicate: string,
  params: Record<string, unknown> = {},
): ReturnCreateStatement {
  return {
    sql: `INSERT INTO return_create_guards(operation_id,phase,guard_value)
      SELECT @returnCreateOperationId,@returnCreatePhase,CASE WHEN (${predicate}) THEN 1 ELSE 0 END`,
    params: { ...params, returnCreateOperationId: operationId, returnCreatePhase: phase },
  }
}

export function returnCreateIdSql(requestParam = '@returnClientRequestId'): string {
  return `(SELECT id FROM returns WHERE client_request_id=${requestParam} AND client_request_id<>'')`
}

export function replacementSaleIdSql(requestParam = '@replacementClientRequestId'): string {
  return `(SELECT id FROM sales WHERE client_request_id=${requestParam} AND client_request_id<>'')`
}

export function assertReturnCreatePlanBounds(
  statements: ReturnCreateStatement[],
  canonicalIntent: Record<string, unknown>,
  eventBytes: number,
): void {
  if (statements.length > RETURN_CREATE_MAX_STATEMENTS) throw new Error('Return create is too large. Submit fewer items.')
  const requestBytes = new TextEncoder().encode(JSON.stringify(canonicalIntent)).byteLength
  if (requestBytes > RETURN_CREATE_REQUEST_BYTES) throw new Error('Return create is too large. Submit fewer items.')
  assertSaleRecordBatchBounds(statements.length, canonicalIntent, eventBytes)
  for (const statement of statements) {
    if (Object.keys(statement.params || {}).length > 100) throw new Error('Return create statement has too many inputs.')
  }
}
