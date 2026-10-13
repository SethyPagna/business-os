import { assertSaleRecordBatchBounds } from './saleRecordEvents'
import { subtractDecimalSum } from './moneyPrecision'
import { canonicalCustomerReturnExpectedQuote, type CustomerReturnExpectedQuoteV1 } from './customerReturnEntitlement'

export type ReturnCreateStatement = { sql: string; params: Record<string, unknown> }

export const RETURN_CREATE_MAX_ITEMS = 50
export const RETURN_CREATE_MAX_REPLACEMENT_ITEMS = 50
export const RETURN_CREATE_MAX_STATEMENTS = 500
export const RETURN_CREATE_REQUEST_BYTES = 512_000

export class ReturnCreateBudgetError extends Error {
  readonly code = 'customer_return_over_plan_budget'
  constructor() {
    super('This return is too large for the current plan. Return fewer items or received dates, then try again.')
  }
}

export function assertReturnCreateQueryBudget(limit: number, used: number, planned: number, reserve: number): void {
  if (![limit, used, planned, reserve].every(value => Number.isSafeInteger(value) && value >= 0)
    || used + planned + reserve > limit) throw new ReturnCreateBudgetError()
}

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
  // P4-3: only meaningful when stock_action is 'damaged'. In the digest so a
  // retry of the same client_request_id with a genuinely different tag or
  // disposition is caught as a changed request, not replayed as an exact
  // repeat -- see resolveDamagedReturnChoice. The keys are PRESENT only when
  // the client sent a value, so a request without them keeps the exact
  // legacy digest bytes (an in-flight retry across the deploy still replays).
  condition_tag?: string
  damaged_disposition?: string
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

type CanonicalV1Item = {
  sale_item_id: number
  quantity: number
  stock_action: 'none' | 'restock' | 'damaged'
  branch_id: number | null
  batch_id: number | null
  condition_tag?: string
  damaged_disposition?: string
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

// P4-3 damaged-line choice: keys only when sent, see CanonicalItem.
function damagedChoiceKeys(item: Record<string, unknown>): { condition_tag?: string, damaged_disposition?: string } {
  const conditionTag = boundedText(item.condition_tag, 40)
  const disposition = boundedText(item.damaged_disposition, 40)
  return {
    ...(conditionTag ? { condition_tag: conditionTag } : {}),
    ...(disposition ? { damaged_disposition: disposition } : {}),
  }
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
    ...damagedChoiceKeys(item),
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

function canonicalV1Item(value: unknown, index: number): CanonicalV1Item {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Return item ${index + 1} must be an object`)
  }
  const item = value as Record<string, unknown>
  if (typeof item.sale_item_id !== 'number' || !Number.isSafeInteger(item.sale_item_id) || item.sale_item_id <= 0
    || typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0) {
    throw new Error(`Return item ${index + 1} needs one sale item and a positive quantity`)
  }
  const optionalId = (field: 'branch_id' | 'batch_id'): number | null => {
    const value = item[field]
    if (value == null || value === '') return null
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Return item ${index + 1} has an invalid ${field}`)
    }
    return value
  }
  return { sale_item_id: item.sale_item_id, quantity: item.quantity, stock_action: canonicalStockAction(item),
    branch_id: optionalId('branch_id'), batch_id: optionalId('batch_id'), ...damagedChoiceKeys(item) }
}

function canonicalReturnCreateIntentV1(body: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(body.items) || body.items.length === 0) throw new Error('Return items required')
  if (body.items.length > RETURN_CREATE_MAX_ITEMS) throw new Error(`Return at most ${RETURN_CREATE_MAX_ITEMS} items at a time`)
  if (body.replacement_items != null && (!Array.isArray(body.replacement_items) || body.replacement_items.length)) {
    throw new Error('Money precision v1 does not support replacement items')
  }
  if (typeof body.sale_id !== 'number' || !Number.isSafeInteger(body.sale_id) || body.sale_id <= 0) {
    throw new Error('Money precision v1 requires an original sale')
  }
  const reason = boundedText(body.reason, 500)
  if (!reason) throw new Error('Reason is required')
  const items = body.items.map(canonicalV1Item)
  const expected = canonicalCustomerReturnExpectedQuote(body.expected_quote)
  if (expected.sale_id !== body.sale_id || expected.items.length !== items.length) {
    throw new Error('The return quote does not match the requested sale items')
  }
  for (const [index, item] of items.entries()) {
    const quoted = expected.items[index]
    if (quoted.sale_item_id !== item.sale_item_id || subtractDecimalSum(quoted.quantity, [item.quantity]) !== '0') {
      throw new Error('The return quote does not match the requested sale items')
    }
  }
  return {
    money_precision_version: 1,
    sale_id: body.sale_id,
    return_number: boundedText(body.return_number, 120),
    receipt_number: boundedText(body.receipt_number, 120),
    customer_id: positiveId(body.customer_id),
    customer_name: boundedText(body.customer_name, 240),
    branch_id: positiveId(body.branch_id),
    reason,
    return_type: boundedText(body.return_type, 120) || 'restock',
    notes: boundedText(body.notes, 2000),
    items,
    expected_quote: expected satisfies CustomerReturnExpectedQuoteV1,
    replacement_items: [],
  }
}

// Only accepted client intent belongs in this digest input. Refund totals,
// generated ids/numbers, current product/contact values, and every other
// server-derived fact are deliberately excluded so an exact retry remains
// stable after mutable database state changes.
export function canonicalReturnCreateIntent(body: Record<string, unknown>): Record<string, unknown> {
  if (body.money_precision_version !== undefined) {
    if (body.money_precision_version !== 1) throw new Error('Unsupported return money precision version')
    return canonicalReturnCreateIntentV1(body)
  }
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

// Return quantities are decimal facts. Summed as JS numbers, 0.2 + 0.1 is
// 0.30000000000000004, which refused the last 0.1 of a 0.3 line ("Cannot
// return 0.30000000000000004 of ... -- only 0.3 sold") and left a fully
// returned 0.7 + 0.1 of 0.8 'partial_return'. Every quantity sum and
// comparison of the legacy (v0) capacity and status reads goes through
// moneyPrecision's exact subtractDecimalSum -- the kernel the v1 entitlement
// already uses -- and never an epsilon: a genuine excess of 1e-10 is refused.
// A value is a stored quantity (a JS number) or an exact decimal string.
type ExactQuantity = number | string

function exactDifference(left: ExactQuantity, right: ExactQuantity): string {
  try { return subtractDecimalSum(left, [right]) } catch { throw new Error('Return quantities must be plain decimal numbers') }
}
function exactSum(values: readonly ExactQuantity[]): string {
  let negated: string
  try { negated = subtractDecimalSum(0, values) } catch { throw new Error('Return quantities must be plain decimal numbers') }
  return negated === '0' ? '0' : negated.startsWith('-') ? negated.slice(1) : `-${negated}`
}
function exactPositive(value: string): boolean { return value !== '0' && !value.startsWith('-') }
function exactGreater(left: ExactQuantity, right: ExactQuantity): boolean { return exactPositive(exactDifference(left, right)) }
function exactMin(left: ExactQuantity, right: ExactQuantity): ExactQuantity { return exactGreater(left, right) ? right : left }
function exactAtLeastZero(value: string): string { return exactPositive(value) ? value : '0' }
// A stored quantity that is not a finite number (never written by the app)
// counts as zero, the way the status projection always read it.
function storedQuantity(value: unknown): number { return Number(value) || 0 }
function addPart(parts: Map<number, ExactQuantity[]>, key: number, value: ExactQuantity): void {
  const list = parts.get(key)
  if (list) list.push(value)
  else parts.set(key, [value])
}

/** Units of a sale line (or of all a product's lines: pass every sold
 *  quantity) still returnable after `returned`, exactly; never below 0. */
export function returnQuantityRemaining(sold: number | readonly number[], returned: readonly number[]): number {
  const soldTotal = typeof sold === 'number' ? exactSum([storedQuantity(sold)]) : exactSum(sold.map(storedQuantity))
  return Number(exactAtLeastZero(exactDifference(soldTotal, exactSum(returned.map(storedQuantity)))))
}

/** True when `requested` is more than `remaining`, compared as exact decimals. */
export function returnQuantityExceeds(requested: number, remaining: number): boolean {
  return exactGreater(storedQuantity(requested), storedQuantity(remaining))
}

export function projectedSaleStatusForReturnCreate(
  saleItems: Array<{ id: number; product_id: number | null; quantity: number }>,
  committedReturnLines: Array<{ sale_item_id?: number | null; product_id?: number | null; quantity: number }>,
  requestLines: Array<{ sale_item_id?: number | null; product_id?: number | null; quantity: number }>,
  statusBeforeReturn: string | null,
): string {
  const saleItemIds = new Set(saleItems.map((item) => Number(item.id)))
  const returnedByItem = new Map<number, ExactQuantity[]>()
  const fallbackByProduct = new Map<number, ExactQuantity[]>()
  const allLines = [...committedReturnLines, ...requestLines]
  let hasAny = false
  for (const line of allLines) {
    const quantity = Number(line.quantity) || 0
    if (!(quantity > 0)) continue
    hasAny = true
    const saleItemId = Number(line.sale_item_id) || 0
    if (saleItemId && saleItemIds.has(saleItemId)) {
      addPart(returnedByItem, saleItemId, quantity)
      continue
    }
    const productId = Number(line.product_id) || 0
    if (productId) addPart(fallbackByProduct, productId, quantity)
  }
  for (const item of saleItems) {
    const productId = Number(item.product_id) || 0
    const fallback = exactSum(fallbackByProduct.get(productId) || [])
    if (!exactPositive(fallback)) continue
    const returned = exactSum(returnedByItem.get(item.id) || [])
    const capacity = exactAtLeastZero(exactDifference(storedQuantity(item.quantity), returned))
    const allocated = exactMin(capacity, fallback)
    if (exactGreater(allocated, 0)) returnedByItem.set(item.id, [returned, allocated])
    fallbackByProduct.set(productId, [exactDifference(fallback, allocated)])
  }
  const fullyReturned = hasAny && saleItems.every((item) =>
    !exactGreater(storedQuantity(item.quantity), exactSum(returnedByItem.get(item.id) || [])))
  return fullyReturned ? 'returned' : hasAny ? 'partial_return' : (statusBeforeReturn || 'completed')
}

export function projectedSaleStatusForReturnCreateV1(
  saleItems: Array<{ id: number; quantity: number }>,
  committedReturnLines: Array<{ sale_item_id?: number | null; quantity: number }>,
  requestLines: Array<{ sale_item_id?: number | null; quantity: number }>,
  statusBeforeReturn: string | null,
): string {
  const saleItemIds = new Set(saleItems.map(item => Number(item.id)))
  const quantitiesByItem = new Map<number, number[]>()
  const allLines = [...committedReturnLines, ...requestLines]
  for (const line of allLines) {
    const saleItemId = Number(line.sale_item_id)
    if (!Number.isSafeInteger(saleItemId) || !saleItemIds.has(saleItemId)) {
      throw new Error('Sale item not found for this return')
    }
    const quantities = quantitiesByItem.get(saleItemId) || []
    quantities.push(line.quantity)
    quantitiesByItem.set(saleItemId, quantities)
  }
  let fullyReturned = allLines.length > 0
  for (const item of saleItems) {
    const remainder = subtractDecimalSum(item.quantity, quantitiesByItem.get(Number(item.id)) || [])
    if (remainder.startsWith('-')) throw new Error('The return quantity exceeds the captured sale quantity')
    if (remainder !== '0') fullyReturned = false
  }
  return fullyReturned ? 'returned' : allLines.length ? 'partial_return' : (statusBeforeReturn || 'completed')
}

/** What an over-capacity refusal names: the product, the units that would
 *  count as returned against it, and the units the sale sold of it. */
export type ReturnCapacityParams = { product: string; returned: number; sold: number }

/**
 * assertReturnCreateCapacity's refusal. The English sentence is unchanged;
 * `params` carries the product and counts that sentence names as data, so a
 * route can hand them to the till to restate in the operator's language
 * (POST /api/returns/bulk's return_restore_over_capacity). Null when the line
 * has neither a name nor a product to name.
 */
export class ReturnCapacityError extends Error {
  constructor(message: string, readonly params: ReturnCapacityParams | null) {
    super(message)
  }
}

// The counts are exact decimals (see exactSum above), so the sentence and the
// params carry no binary-float noise without any rounding of their own.
function capacityParams(product: string | null | undefined, productId: number, returned: string, sold: number): ReturnCapacityParams | null {
  const name = String(product ?? '').trim() || (productId ? `#${productId}` : '')
  return name ? { product: name, returned: Number(returned), sold: Math.max(0, sold) } : null
}

export function assertReturnCreateCapacity(
  saleItems: Array<{ id: number; product_id: number | null; quantity: number; product_name?: string | null }>,
  committedReturnLines: Array<{ sale_item_id?: number | null; product_id?: number | null; quantity: number }>,
  requestLines: Array<{ sale_item_id?: number | null; product_id?: number | null; quantity: number }>,
): void {
  const byId = new Map(saleItems.map((item) => [Number(item.id), item]))
  const usedByItem = new Map<number, ExactQuantity[]>()
  const fallbackByProduct = new Map<number, ExactQuantity[]>()
  for (const line of [...committedReturnLines, ...requestLines]) {
    const quantity = Number(line.quantity) || 0
    if (!(quantity > 0)) continue
    const saleItemId = Number(line.sale_item_id) || 0
    if (saleItemId) {
      const item = byId.get(saleItemId)
      if (!item) throw new Error('Sale item not found for this return')
      addPart(usedByItem, saleItemId, quantity)
      continue
    }
    const productId = Number(line.product_id) || 0
    if (!productId) throw new Error('Each return line needs a sale item or product')
    addPart(fallbackByProduct, productId, quantity)
  }
  for (const item of saleItems) {
    const sold = storedQuantity(item.quantity)
    const used = exactSum(usedByItem.get(item.id) || [])
    if (exactGreater(used, sold)) {
      throw new ReturnCapacityError(`Cannot return ${Number(used)} of ${item.product_name || 'this item'} — only ${Math.max(0, sold)} sold`,
        capacityParams(item.product_name, Number(item.product_id) || 0, used, sold))
    }
    const productId = Number(item.product_id) || 0
    const fallback = exactSum(fallbackByProduct.get(productId) || [])
    if (!exactPositive(fallback)) continue
    const allocated = exactMin(exactAtLeastZero(exactDifference(sold, used)), fallback)
    usedByItem.set(item.id, [used, allocated])
    fallbackByProduct.set(productId, [exactDifference(fallback, allocated)])
  }
  const overflow = [...fallbackByProduct.entries()]
    .map(([productId, parts]) => [productId, exactSum(parts)] as const)
    .find(([, quantity]) => exactPositive(quantity))
  if (overflow) {
    // Every sale line of this product is full by now (the allocation above
    // fills each before any quantity is left over), so what would count as
    // returned is everything the sale sold of it plus the overflow.
    const [productId, extra] = overflow
    const lines = saleItems.filter((item) => (Number(item.product_id) || 0) === productId)
    const sold = exactSum(lines.map((item) => Math.max(0, storedQuantity(item.quantity))))
    throw new ReturnCapacityError(`Cannot return ${Number(extra)} additional unit(s) of product #${productId} — only the unreturned sold quantity is eligible`,
      capacityParams(lines.find((item) => String(item.product_name ?? '').trim())?.product_name, productId, exactSum([sold, extra]), Number(sold)))
  }
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

/**
 * The number of stock movements THIS create batch wrote for the new return.
 *
 * inventory_movements.reference_id has no reference kind: a sale's
 * cancellation, line decrease, add-items Undo or grouped status writes
 * 'return' / 'damage_in' rows keyed by the SALE id, and two AUTOINCREMENT
 * sequences collide freely. Counting by reference_id alone made return id N
 * uncreatable once sale N had such a row -- and a refused insert does not
 * consume the id, so every later customer return got the same id and the
 * same refusal (AL-MONEY-REPRO.md side finding M). Product membership cannot
 * separate them (the cancelled sale and the return may share the product),
 * and the reason text is caller-supplied.
 *
 * What does separate them exactly: every row this batch inserts gets an id
 * above the table's MAX(id) read before the batch (AUTOINCREMENT never reuses
 * or goes back), and every row that already existed is at or below it. A
 * same-id row another writer commits between that read and this batch is
 * counted, so the postcondition refuses and the request is retried -- it
 * fails closed, never over-counts silently.
 */
export function returnCreateOwnMovementCountSql(returnIdSql: string, movementTypes: readonly string[], floorParam = '@movementIdFloor'): string {
  return `(SELECT COUNT(*) FROM inventory_movements WHERE reference_id=${returnIdSql} AND id>${floorParam}
      AND movement_type IN (${movementTypes.map((type) => `'${type}'`).join(',')}))`
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
