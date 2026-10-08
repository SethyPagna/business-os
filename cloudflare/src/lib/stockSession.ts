import { assertProductStatusInput, productStockGuardError, productStockGuardStatement, ProductStockGuardError } from './productStockGuard'
import { getDb, type D1Compat } from './db'
import type { Env } from '../index'
import { getPlanLimits } from './planTier'
import type { SessionUser } from './auth'
import { getActionTier, isAdminControlUser } from './permissions'
import { productDiscountChanged } from './productDiscountGate'
import { hasAcquisitionCostInput } from './acquisitionCostAccess'
import { dateToBatchCode, normalizeTypedDate } from './batchCode'
import { identityBarcodeKey, barcodeIdentityMatches, isRealBarcode, normalizeLeadingZeroBarcodeForCleanup, normalizeProductGroupName } from './productDetailRule'
import { identityBarcodeMatchSql } from './productIdentity'
import { barcodeKeysMatch } from './searchMatch'
import { planReceiveBatchStock, resolveReceiptLotTarget, type ReceiptLotCandidate, type ReceiptLotTarget, type StockWriteStatement } from './productBatches'
import { appendReceiptNotes, FREE_GOODS_REASON_NOTE, stockReceiptGateCode, stockReceiptGateMessage } from './stockReceiptGate'
import { normalizeMultiValue, planInsertRow, validateProductImageGallery } from './productWrites'
import { sanitizeMediaList, sanitizeMediaPath } from './media'
import { ADMIN_MAX_IMAGES_PER_PRODUCT, MAX_IMAGES_PER_PRODUCT } from './importImageMatch'
import { buildInClause, chunkForBinding, D1_MAX_BOUND_PARAMS } from './sqlBinding'
import { bumpVersion, bumpVersions } from './cache'
import { broadcast } from '../durable-objects/broadcastHub'
import { actorSnapshot } from './actorSnapshot'
import { STOCK_REASON_MAX_LENGTH, stockReasonTooLong } from './stockReason'
import { multiplyMoney4, roundMoney4, sumMoney4 } from './moneyPrecision'
import { catalogCostRecomputeIfChangedStatement, catalogCostRecomputeStatement } from './catalogCostRecompute'
import { findConsumingBlocker, findLaterChangeBlocker } from './stockRefusalBlocker'
import { revertChainOpenSql } from './stockInSessionsQuery'
import {
  addressedMovement, branchEffectRefusal, branchRedirectGuard, branchRedirectGuardRefusal, directoryBranchEffect, isBranchRedirectGuardError, landingLotId,
  readBranchDirectory, type BranchEffect, type RedirectTarget,
} from './branchRedirectWrite'

export const STOCK_SESSION_KIND = 'stock.session'
export const STOCK_SESSION_MAX_LINES = 25
export const STOCK_SESSION_MAX_BYTES = 64 * 1024
const STOCK_SESSION_MAX_STATEMENTS = 500
const STOCK_SESSION_MAX_SNAPSHOT_BYTES = 256 * 1024
const STOCK_SESSION_MAX_GALLERY_LINKS = 75
const REQUEST_ID = /^[A-Za-z0-9_-]{8,100}$/
const LINE_ID = /^[A-Za-z0-9_-]{1,80}$/
const SCIENTIFIC_BARCODE = /^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i
const PRODUCT_FIELDS = [
  'name', 'barcode', 'category', 'categories', 'unit', 'description', 'tag_label',
  'selling_price_usd', 'selling_price_khr', 'wholesale_price_usd', 'wholesale_price_khr',
  'cost_price_usd', 'cost_price_khr', 'low_stock_threshold', 'out_of_stock_threshold',
  'image_path', 'image_gallery', 'is_active', 'supplier', 'custom_fields', 'brand', 'brands',
  'discount_enabled', 'discount_type', 'discount_percent', 'discount_amount_usd',
  'discount_amount_khr', 'discount_label', 'discount_badge_color', 'discount_starts_at',
  'discount_ends_at', 'expiry_date', 'expiry_alert_days', 'stock_quantity', 'branch_id',
] as const
const DEFAULT_FIELDS = [
  'branch_id', 'supplier_id', 'supplier_name', 'received_date', 'expiry_date', 'notes',
  'unit_cost_usd', 'payment_status', 'credit_due_date', 'brand', 'free_goods', 'reason',
] as const
const ITEM_FIELDS = [
  'line_id', 'kind', 'product_id', 'product', 'batch_id', 'branch_id', 'quantity',
  'supplier_id', 'supplier_name', 'received_date', 'expiry_date', 'notes',
  'unit_cost_usd', 'payment_status', 'credit_due_date', 'free_goods', 'reason',
] as const

type Row = Record<string, unknown>
type CommandKind = 'receive' | 'create_receive'
type CanonicalProduct = Record<string, unknown>
type CanonicalLine = {
  line_id: string
  kind: CommandKind
  product_id: number | null
  product: CanonicalProduct | null
  batch_id: number | null
  branch_id: number
  quantity: number
  supplier_id: number | null
  supplier_name: string | null
  received_date: string
  expiry_date: string | null
  notes: string | null
  // P3-L2: the operator's own reason for this line's movement, as typed.
  // Present only when given: the canonical JSON is the idempotency
  // fingerprint, so a request without one must serialize exactly as before.
  reason?: string
  unit_cost_usd: number | null
  free_goods: boolean
  payment_status: 'paid' | 'credit' | null
  credit_due_date: string | null
}
export type StockSessionRequest = {
  client_request_id: string
  mode: 'stock_in'
  items: CanonicalLine[]
}
export type StockSessionReceipt = {
  success: true
  replayed: boolean
  operationId: string
  clientRequestId: string
  actionHistoryId: number
  snapshotId: number
  memberCount: number
  createdCount: number
  receivedCount: number
  totalQuantity: number
  totalCostUsd: number
  items: Array<{
    lineId: string
    kind: CommandKind
    productId: number
    productName: string
    createdProduct: boolean
    branchId: number
    batchId: number | null
    batchNumber: number | null
    lotCode: string | null
    movementId: number | null
    quantity: number
    unitCostUsd: number | null
  }>
}

export type SessionProductDuplicateReason = 'name' | 'barcode'

export function sessionProductDuplicateReason(
  left: { name?: unknown; barcode?: unknown },
  right: { name?: unknown; barcode?: unknown },
): SessionProductDuplicateReason | null {
  const leftName = normalizeProductGroupName(left.name)
  const rightName = normalizeProductGroupName(right.name)
  if (leftName && leftName === rightName) return 'name'
  const leftBarcode = String(left.barcode ?? '').trim()
  const rightBarcode = String(right.barcode ?? '').trim()
  if (!leftBarcode || !rightBarcode || /^0+$/.test(leftBarcode) || /^0+$/.test(rightBarcode)) return null
  return barcodeKeysMatch(leftBarcode, rightBarcode) ? 'barcode' : null
}

export class StockSessionError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 403 | 404 | 409 = 409,
    readonly code = 'stock_session_rejected',
    readonly details?: Row,
  ) {
    super(message)
    this.name = 'StockSessionError'
  }

  // RET-D: the blocking record a replay refusal names (routes/actionHistory.ts reads it).
  get refusal(): unknown { return this.details?.refusal ?? null }
  // REVERT-SET: the numbers a coded refusal's sentence names (frontend utils/stockRevertError.ts).
  get params(): unknown { return this.details?.params ?? undefined }
}

// Action history must use the same permission union as the authoritative
// replay below. Missing/invalid inventory metadata is deliberately treated as
// requiring inventory adjust so every pre-zero-stock receipt remains gated by
// the legacy permission contract.
export function canReplayStockSessionPayload(user: SessionUser, payload: Record<string, unknown>): boolean {
  if (payload.requires_inventory_adjust !== 0 && getActionTier(user, 'inventory', 'adjust') !== 'full') return false
  if (Number(payload.requires_product_add) === 1 && getActionTier(user, 'products', 'add') !== 'full') return false
  if (Number(payload.requires_product_image) === 1 && getActionTier(user, 'products', 'image') !== 'full') return false
  return true
}

function stockSessionChangesProductImages(request: StockSessionRequest): boolean {
  return request.items.some((line) => line.kind === 'create_receive' && (
    Boolean(String(line.product?.image_path || '').trim())
    || ((line.product?.image_gallery as string[] | undefined) || []).length > 0
  ))
}

function fail(message: string, status: 400 | 403 | 404 | 409 = 409, code = 'stock_session_rejected', details?: Row): never {
  throw new StockSessionError(message, status, code, details)
}

function object(value: unknown, message: string): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(message, 400, 'invalid_request')
  return value as Row
}

function rejectUnknown(value: Row, allowed: readonly string[], message: string) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail(message, 400, 'unsupported_field')
}

function integer(value: unknown, field: string, nullable = false): number | null {
  if (nullable && value == null) return null
  if (typeof value !== 'number') fail(`${field} must be a JSON number.`, 400, 'invalid_request')
  const parsed = value
  if (!Number.isSafeInteger(parsed) || parsed <= 0) fail(`${field} must be a positive integer.`, 400, 'invalid_request')
  return parsed
}

function finite(value: unknown, field: string, nullable = false, maximum = 1_000_000_000): number | null {
  if (nullable && value == null) return null
  if (typeof value !== 'number') fail(`${field} must be a JSON number.`, 400, 'invalid_request')
  const parsed = value
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > maximum) fail(`${field} is out of range.`, 400, 'invalid_request')
  return parsed
}

function text(value: unknown, field: string, maximum: number, nullable = true): string | null {
  if (value == null || String(value).trim() === '') {
    if (nullable) return null
    fail(`${field} is required.`, 400, 'invalid_request')
  }
  if (typeof value !== 'string') fail(`${field} must be text.`, 400, 'invalid_request')
  const normalized = value.trim()
  if (new TextEncoder().encode(normalized).length > maximum) fail(`${field} is too long.`, 400, 'request_too_large')
  return normalized
}

function date(value: unknown, field: string, nullable = true): string | null {
  if (value == null || value === '') {
    if (nullable) return null
    fail(`${field} is required.`, 400, 'invalid_request')
  }
  // A stock-in session's dates are typed into DateEntryInput, so they are
  // read the way that field writes them: day-first.
  const normalized = normalizeTypedDate(String(value))
  if (!normalized) fail(`${field} must be a valid date (dd/mm/yyyy).`, 400, 'invalid_request')
  return normalized
}

function canonicalProduct(raw: unknown, defaults: Row, openingQuantity: number, branchId: number, maxImages: number): CanonicalProduct {
  const input = object(raw, 'create_receive requires a product object.')
  rejectUnknown(input, PRODUCT_FIELDS, 'Unsupported product field in stock session.')
  const out: CanonicalProduct = {}
  for (const field of PRODUCT_FIELDS) {
    if (!(field in input)) continue
    const value = input[field]
    if (field === 'image_gallery') {
      out.image_gallery = validateProductImageGallery(value, maxImages)
    } else if (field === 'image_path') {
      out.image_path = sanitizeMediaPath(value, '') || null
    } else if (field === 'categories' || field === 'brands') {
      if (!Array.isArray(value) && typeof value !== 'string') fail(`${field} must be text or a list.`, 400, 'invalid_request')
      out[field] = value
    } else if (field === 'custom_fields') {
      if (typeof value === 'string') {
        try { JSON.parse(value) } catch { fail('custom_fields must be valid JSON.', 400, 'invalid_request') }
        out.custom_fields = value
      } else {
        out.custom_fields = JSON.stringify(object(value, 'custom_fields must be an object.'))
      }
    } else if (field === 'branch_id') {
      out.branch_id = integer(value, 'product.branch_id')
    } else if (field === 'is_active' || field === 'discount_enabled') {
      if (typeof value !== 'boolean' && value !== 0 && value !== 1) fail(`${field} must be boolean.`, 400, 'invalid_request')
      out[field] = value === true || value === 1 ? 1 : 0
    } else if (field.includes('price') || field.includes('threshold') || field.startsWith('discount_') && field !== 'discount_type' && field !== 'discount_label' && field !== 'discount_badge_color' && field !== 'discount_starts_at' && field !== 'discount_ends_at' || field === 'expiry_alert_days' || field === 'stock_quantity') {
      out[field] = finite(value, field, false)
    } else if (field === 'expiry_date') {
      out.expiry_date = date(value, 'product.expiry_date')
    } else if (field === 'discount_starts_at' || field === 'discount_ends_at') {
      const valueText = text(value, field, 64)
      out[field] = valueText
    } else {
      out[field] = text(value, `product.${field}`, field === 'description' ? 4000 : 500)
    }
  }
  const name = text(out.name, 'product.name', 240, false) as string
  out.name = name
  const barcode = String(out.barcode ?? '').trim()
  if (SCIENTIFIC_BARCODE.test(barcode)) fail(`Barcode "${barcode}" looks like scientific notation.`, 400, 'barcode_scientific_notation')
  if (!('brand' in out) && defaults.brand != null) out.brand = defaults.brand
  if (!('supplier' in out) && defaults.supplier_name != null) out.supplier = defaults.supplier_name
  const categories = normalizeMultiValue(out.category, out.categories)
  if (categories !== undefined) out.categories = categories
  const brands = normalizeMultiValue(out.brand, out.brands)
  if (brands !== undefined) out.brands = brands
  const gallery = out.image_gallery as string[] | undefined
  if (!out.image_path && gallery?.length) out.image_path = gallery[0]
  if (!('unit' in out)) out.unit = 'pcs'
  if (!('is_active' in out)) out.is_active = 1
  if (out.branch_id != null && out.branch_id !== branchId) fail('product.branch_id must match the receiving branch.', 400, 'invalid_request')
  if (out.stock_quantity != null && out.stock_quantity !== openingQuantity) fail('product.stock_quantity must match line quantity.', 400, 'invalid_request')
  delete out.branch_id
  out.stock_quantity = 0
  return out
}

function parseRequest(rawValue: unknown, maxImages: number): StockSessionRequest {
  const encoded = new TextEncoder().encode(JSON.stringify(rawValue ?? null)).length
  if (encoded > STOCK_SESSION_MAX_BYTES) fail('Stock session payload is too large.', 400, 'request_too_large')
  const raw = object(rawValue, 'A stock session object is required.')
  rejectUnknown(raw, ['client_request_id', 'mode', 'defaults', 'items'], 'Unsupported stock session field.')
  if (typeof raw.client_request_id !== 'string' || !REQUEST_ID.test(raw.client_request_id)) {
    fail('A stable client_request_id is required.', 400, 'invalid_request')
  }
  if (raw.mode !== 'stock_in') fail('Only stock_in sessions are supported in milestone A.', 400, 'unsupported_mode')
  const defaults = raw.defaults == null ? {} : object(raw.defaults, 'defaults must be an object.')
  rejectUnknown(defaults, DEFAULT_FIELDS, 'Unsupported stock session default.')
  if (!Array.isArray(raw.items) || raw.items.length < 1 || raw.items.length > STOCK_SESSION_MAX_LINES) {
    fail(`A stock session must contain 1-${STOCK_SESSION_MAX_LINES} lines.`, 400, 'line_limit')
  }
  const seen = new Set<string>()
  const items = raw.items.map((rawLine, index): CanonicalLine => {
    const line = object(rawLine, `Line ${index + 1} must be an object.`)
    rejectUnknown(line, ITEM_FIELDS, `Line ${index + 1} has an unsupported field.`)
    if (typeof line.line_id !== 'string' || !LINE_ID.test(line.line_id) || seen.has(line.line_id)) {
      fail('Every line requires a unique stable line_id.', 400, 'invalid_line_id')
    }
    seen.add(line.line_id)
    if (line.kind !== 'receive' && line.kind !== 'create_receive') fail('Line kind must be receive or create_receive.', 400, 'unsupported_command')
    const expanded = (field: string) => field in line ? line[field] : defaults[field]
    const branchId = integer(expanded('branch_id'), 'branch_id') as number
    const quantity = finite(line.quantity, 'quantity', false) as number
    const receivedDate = date(expanded('received_date'), 'received_date', false) as string
    const payment = expanded('payment_status')
    if (payment != null && payment !== '' && payment !== 'paid' && payment !== 'credit') fail('payment_status must be paid or credit.', 400, 'invalid_request')
    const paymentStatus = payment === 'paid' || payment === 'credit' ? payment : null
    const creditDueDate = paymentStatus === 'credit' ? date(expanded('credit_due_date'), 'credit_due_date') : null
    const kind = line.kind as CommandKind
    if (quantity === 0 && kind !== 'create_receive') fail('quantity must be greater than zero for receive.', 400, 'invalid_quantity')
    const product = kind === 'create_receive' ? canonicalProduct(line.product, defaults, quantity, branchId, maxImages) : null
    const productId = kind === 'receive' ? integer(line.product_id, 'product_id') as number : null
    const batchId = line.batch_id == null ? null : integer(line.batch_id, 'batch_id') as number
    if (kind === 'create_receive' && batchId != null) fail('create_receive cannot reference an existing batch.', 400, 'invalid_request')
    if (kind === 'receive' && line.product != null) fail('receive cannot include a product object.', 400, 'invalid_request')
    if (kind === 'create_receive' && line.product_id != null) fail('create_receive cannot include product_id.', 400, 'invalid_request')
    // N14-D receipt gate. Every line of a stock-in session that actually moves
    // stock is a receipt, so it must name its supplier and carry the cost the
    // operator typed. The old parser filled a missing cost from the product's
    // stored cost_price_usd -- an invented receipt cost that looked entered --
    // and a create_receive with no cost at all recorded $0.00, i.e. free
    // goods nobody declared. A quantity-0 create_receive is catalogue work,
    // not a receipt, and is left alone. Same kernel as POST
    // /api/inventory/adjust (lib/stockReceiptGate.ts), so one wire cannot
    // accept what the other refuses.
    const supplierName = text(expanded('supplier_name'), 'supplier_name', 240)
    const notes = text(expanded('notes'), 'notes', 1000)
    // The reason is the one text field NOT measured in bytes. text() spends a
    // UTF-8 byte budget, and Khmer costs three bytes a character, so a 167-
    // character Khmer reason the input box accepted was refused here with
    // request_too_large while the three other reason wires took the same
    // string. It shares their code-unit cap instead (lib/stockReason.ts); the
    // payload as a whole still has its byte ceiling, checked above.
    const reason = text(expanded('reason'), 'reason', STOCK_SESSION_MAX_BYTES)
    if (stockReasonTooLong(reason)) fail(`reason is too long (max ${STOCK_REASON_MAX_LENGTH} characters).`, 400, 'reason_too_long')
    const unitCostUsd = finite(expanded('unit_cost_usd'), 'unit_cost_usd', true)
    const freeGoods = expanded('free_goods') === true
    // A line that names an existing batch_id defers the SUPPLIER half only.
    // An attributed lot keeps its first supplier server-side, so the picker
    // deliberately sends supplier_name: null for one -- demanding a supplier
    // here would refuse a complete receipt for naming a lot that already has
    // the answer. The batch is loaded and matched to the product further down
    // (explicitBatchMap), which is where a bad batch_id is caught. The COST
    // half is never deferred: no lot supplies that.
    const gate = stockReceiptGateCode({ isStockIn: quantity > 0, supplierName, unitCostUsd, freeGoods, lotAttributionDeferred: batchId != null })
    if (gate) fail(stockReceiptGateMessage(gate) as string, 400, gate)
    return {
      line_id: line.line_id,
      kind,
      product_id: productId,
      product,
      batch_id: batchId,
      branch_id: branchId,
      quantity,
      supplier_id: integer(expanded('supplier_id'), 'supplier_id', true),
      supplier_name: supplierName,
      received_date: receivedDate,
      expiry_date: date(expanded('expiry_date'), 'expiry_date'),
      notes: freeGoods && unitCostUsd === 0 ? appendReceiptNotes(notes, [FREE_GOODS_REASON_NOTE]) : notes,
      ...(reason ? { reason } : {}),
      unit_cost_usd: unitCostUsd,
      free_goods: freeGoods,
      payment_status: paymentStatus,
      credit_due_date: creditDueDate,
    }
  }).sort((a, b) => a.line_id.localeCompare(b.line_id))
  const canonical = { client_request_id: raw.client_request_id, mode: 'stock_in' as const, items }
  if (new TextEncoder().encode(JSON.stringify(canonical)).length > STOCK_SESSION_MAX_BYTES) {
    fail('Expanded stock session payload is too large.', 400, 'request_too_large')
  }
  return canonical
}

// Preserve the legacy parser byte-for-byte for the first idempotency lookup:
// operations committed before nearest-4 receipt money can contain a raw cost
// in request_json and must remain exactly replayable. Only a genuinely new
// operation (or a retry matching the normalized request) reaches this step.
function normalizeNewRequestMoney(request: StockSessionRequest): StockSessionRequest {
  const items = request.items.map((line): CanonicalLine => {
    let unitCostUsd = line.unit_cost_usd
    try {
      unitCostUsd = unitCostUsd == null ? null : roundMoney4(unitCostUsd)
      if (unitCostUsd != null && line.quantity > 0) multiplyMoney4(unitCostUsd, line.quantity)
    } catch {
      fail('unit_cost_usd is out of range.', 400, 'invalid_request')
    }
    const gate = stockReceiptGateCode({
      isStockIn: line.quantity > 0,
      supplierName: line.supplier_name,
      unitCostUsd,
      freeGoods: line.free_goods,
      lotAttributionDeferred: line.batch_id != null,
    })
    if (gate) fail(stockReceiptGateMessage(gate) as string, 400, gate)
    let product = line.product
    if (product) {
      product = { ...product }
      for (const field of ['cost_price_usd', 'cost_price_khr'] as const) {
        if (!(field in product)) continue
        try { product[field] = roundMoney4(product[field] as number) }
        catch { fail(`${field} is out of range.`, 400, 'invalid_request') }
      }
    }
    return {
      ...line,
      product,
      unit_cost_usd: unitCostUsd,
      notes: line.free_goods && unitCostUsd === 0
        ? appendReceiptNotes(line.notes, [FREE_GOODS_REASON_NOTE])
        : line.notes,
    }
  })
  return { ...request, items }
}

export type StockSessionQueryBudget = { statementsUsed(): number; reserveStatements: number }

const sessionColumnCache = new WeakMap<object, Promise<Map<string, Set<string>>>>()

async function sessionColumns(env: Env, db: D1Compat): Promise<Map<string, Set<string>>> {
  let pending = sessionColumnCache.get(env.DB)
  if (!pending) {
    const tables = [...new Set([...Object.values(REPLAY_TABLES).map(([table]) => table), 'branches', 'suppliers'])]
    pending = db.prepare(`SELECT t.value table_name,p.name FROM json_each(@tables) t JOIN pragma_table_info(t.value) p ORDER BY t.value,p.cid`)
      .all<Row>({ tables: JSON.stringify(tables) }).then(rows => {
        const result = new Map(tables.map(table => [table, new Set<string>()]))
        for (const row of rows) result.get(String(row.table_name))?.add(String(row.name))
        return result
      })
    sessionColumnCache.set(env.DB, pending)
    pending.catch(() => sessionColumnCache.delete(env.DB))
  }
  return pending
}

function sessionRowSql(columns: Set<string>): string {
  let sql = "json('{}')"
  const names = [...columns]
  for (let i = 0; i < names.length; i += 15) sql = `json_set(${sql},${names.slice(i,i+15).map(name => `'$.${name}',t."${name}"`).join(',')})`
  return sql
}

function sessionBudgetDb(env: Env, budget?: StockSessionQueryBudget) {
  const db = getDb(env)
  const initial = budget?.statementsUsed() ?? 0
  const reserve = budget?.reserveStatements ?? 12
  const limit = getPlanLimits(env).d1QueriesPerInvocation
  let local = 0
  let admission = false
  let tailReads = false
  const used = () => Math.max(initial + local, budget?.statementsUsed() ?? 0)
  const check = (planned: number, tail = 1) => {
    if (used() + planned + tail + reserve > limit) fail('This stock change is too large for the current plan. Use fewer products or received dates, then try again.', 409, 'stock_session_query_budget_exceeded')
  }
  const counted = Object.create(db) as D1Compat
  counted.prepare = sql => {
    const statement = db.prepare(sql)
    const execute = async <T>(fn: () => Promise<T>): Promise<T> => {
      if (admission) check(1)
      else if (tailReads) check(1, 0)
      local += 1
      return fn()
    }
    return {
      get: <T>(params?: import('./db').BindParams) => execute(() => {
        if (!statement.getOnce) throw new Error('Stock sessions require single-attempt database reads')
        return statement.getOnce<T>(params)
      }),
      all: <T>(params?: import('./db').BindParams) => execute(() => {
        if (!statement.allOnce) throw new Error('Stock sessions require single-attempt database reads')
        return statement.allOnce<T>(params)
      }),
      run: params => execute(() => statement.run(params)),
    }
  }
  return { db: counted, begin() { admission = true }, check,
    async commit(statements: StockWriteStatement[]) {
      check(statements.length)
      local += statements.length
      return db.batchOnce(statements)
    },
    finishReads() { admission = false; tailReads = true },
  }
}

async function sessionFacts(env: Env, db: D1Compat, products: number[], branches: number[], suppliers: number[], batches: number[]) {
  const columns = await sessionColumns(env, db)
  const predicates: Record<string,string> = {
    products: 't.id IN (SELECT value FROM json_each(@products))',
    branches: 't.id IN (SELECT value FROM json_each(@branches))',
    suppliers: 't.id IN (SELECT value FROM json_each(@suppliers))',
    product_batches: 't.variant_product_id IN (SELECT value FROM json_each(@products)) OR t.id IN (SELECT value FROM json_each(@batches))',
  }
  const rows = await db.prepare(Object.entries(predicates).map(([table,predicate]) =>
    `SELECT '${table}' kind,${sessionRowSql(columns.get(table) as Set<string>)} row_json,${table === 'products' ? '(SELECT baseline_batch_id FROM product_cost_entries WHERE product_id=t.id ORDER BY id DESC LIMIT 1)' : 'NULL'} baseline FROM ${table} t WHERE ${predicate}`).join(' UNION ALL '))
    .all<Row>({ products: JSON.stringify(products), branches: JSON.stringify(branches), suppliers: JSON.stringify(suppliers), batches: JSON.stringify(batches) })
  const of = (table: string) => rows.filter(row => row.kind === table).map(row => JSON.parse(String(row.row_json)) as Row)
  return { products: of('products'), branches: of('branches'), suppliers: of('suppliers'), batches: of('product_batches'),
    baselines: rows.filter(row => row.kind === 'products').map(row => ({ product_id: (JSON.parse(String(row.row_json)) as Row).id, baseline_batch_id: row.baseline })) }
}

async function rowsIn<T>(db: D1Compat, values: readonly unknown[], column: string, select: string): Promise<T[]> {
  const unique = [...new Set(values)]
  const rows: T[] = []
  for (const chunk of chunkForBinding(unique, 0)) {
    const { sql, params } = buildInClause('value', chunk)
    rows.push(...await db.prepare(`${select} WHERE ${column} IN (${sql})`).all<T>(params))
  }
  return rows
}

function decodedUploadPathCandidate(path: string): string {
  if (!path.startsWith('/uploads/')) return path
  try {
    // Compatibility for clients that previously round-tripped the exact
    // file_assets path through URL.pathname. decodeURI leaves reserved path
    // separators such as `%2F` escaped and decodes only one layer.
    return decodeURI(path)
  } catch (_) {
    return path
  }
}

async function resolveSessionImagePaths(db: D1Compat, request: StockSessionRequest): Promise<void> {
  const products = request.items.flatMap((line) => line.kind === 'create_receive' && line.product ? [line.product] : [])
  const supplied = [...new Set(products.flatMap((product) => {
    const gallery = (product.image_gallery as string[] | undefined) || []
    const primary = String(product.image_path || '')
    return primary ? [primary, ...gallery] : gallery
  }))]
  if (!supplied.length) return
  const candidates = [...new Set(supplied.flatMap((path) => [path, decodedUploadPathCandidate(path)]))]
  const assets = await rowsIn<Row>(db, candidates, 'public_path', 'SELECT id,public_path FROM file_assets')
  const assetPaths = new Set(assets.map((row) => String(row.public_path)))
  const resolved = new Map<string, string>()
  for (const path of supplied) {
    const decoded = decodedUploadPathCandidate(path)
    const publicPath = assetPaths.has(path) ? path : decoded !== path && assetPaths.has(decoded) ? decoded : ''
    if (!publicPath) fail(`Image asset ${path} does not exist.`, 409, 'missing_image_asset')
    resolved.set(path, publicPath)
  }
  for (const product of products) {
    const primary = String(product.image_path || '')
    if (primary) product.image_path = resolved.get(primary) || primary
    product.image_gallery = sanitizeMediaList(((product.image_gallery as string[] | undefined) || [])
      .map((path) => resolved.get(path) || path))
  }
}

function revisionKey(type: string, key: unknown) { return `${type}\u0001${String(key)}` }

function receivedBatchKey(receivedDate: string): string {
  const key = dateToBatchCode(receivedDate)
  if (!key) throw new Error('Canonical received date has no batch key')
  return key
}

async function readRevisions(db: D1Compat, pairs: Array<[string, string]>): Promise<Map<string, number>> {
  const unique = [...new Map(pairs.map((pair) => [revisionKey(pair[0], pair[1]), pair])).values()]
  const result = new Map<string, number>()
  for (let offset = 0; offset < unique.length; offset += 45) {
    const chunk = unique.slice(offset, offset + 45)
    const params: unknown[] = []
    const predicates = chunk.map(([type, key]) => { params.push(type, key); return '(entity_type=? AND entity_key=?)' })
    const rows = await db.prepare(`SELECT entity_type,entity_key,revision FROM stock_session_revisions WHERE ${predicates.join(' OR ')}`).all<Row>(params)
    for (const row of rows) result.set(revisionKey(String(row.entity_type), String(row.entity_key)), Number(row.revision) || 0)
  }
  return result
}

function assertion(predicate: string, params: Row = {}): StockWriteStatement {
  return { sql: `INSERT INTO stock_session_guards(guard_value) SELECT CASE WHEN (${predicate}) THEN 1 ELSE 0 END`, params }
}

// Bracket all preimage reads with the same bounded revision selection. Each
// fence is one SQLite SELECT: even rows discovered through lot/asset identity
// are resolved with their revisions in that statement. Retained revisions
// detect ABA; changing the resolved row id also changes the fence. Equal
// fences prove the preimages and the later commit guards share one state.
// Auto-receipt resolution can choose any same-date/equal-price eligible lot,
// so the fence includes every lot of each requested product, not date-key only.
async function snapshotFence(db: D1Compat, request: StockSessionRequest): Promise<string> {
  const pairs: Array<[string, string]> = []
  const targets: Array<{ product: number; branch: number; batch: number | null; key: string }> = []
  const paths = new Set<string>()
  for (const line of request.items) {
    pairs.push(['branch', String(line.branch_id)])
    if (line.supplier_id != null) pairs.push(['supplier', String(line.supplier_id)])
    if (line.product_id != null) {
      pairs.push(['product', String(line.product_id)], ['branch_stock', `${line.product_id}:${line.branch_id}`])
      if (line.batch_id != null) pairs.push(['batch', String(line.batch_id)])
      else pairs.push(['batch_identity', `${line.product_id}:${receivedBatchKey(line.received_date)}`])
      targets.push({ product: line.product_id, branch: line.branch_id, batch: line.batch_id, key: receivedBatchKey(line.received_date) })
    }
    if (line.product) {
      pairs.push(['product_catalog', 'all'])
      if (line.quantity > 0) pairs.push(['branch_catalog', 'all'])
      for (const path of (line.product.image_gallery as string[] | undefined) || []) paths.add(path)
      if (line.product.image_path) paths.add(String(line.product.image_path))
    }
  }
  // Three JSON binds regardless of line count; inputs are already capped at
  // 25 lines / 64 KiB. No scan or materialization of the whole revision ledger.
  const rows = await db.prepare(`WITH targets AS (
      SELECT json_extract(value,'$.product') product, json_extract(value,'$.branch') branch,
        json_extract(value,'$.batch') batch, json_extract(value,'$.key') batch_key
      FROM json_each(@targets)
    ), lots AS (
      SELECT pb.id,pb.variant_product_id,pb.batch_key,t.branch FROM targets t JOIN product_batches pb
      ON pb.variant_product_id=t.product AND ((t.batch IS NOT NULL AND pb.id=t.batch)
        OR t.batch IS NULL)
    ), revision_sources(groups_json) AS (
      SELECT json_object(
        'requested',json(@pairs),
        'batches',json((SELECT json_group_array(json_array('batch',CAST(id AS TEXT))) FROM lots)),
        'batchIdentities',json((SELECT json_group_array(json_array('batch_identity',CAST(variant_product_id AS TEXT)||':'||batch_key)) FROM lots)),
        'batchStock',json((SELECT json_group_array(json_array('branch_batch_stock',CAST(id AS TEXT)||':'||CAST(branch AS TEXT))) FROM lots)),
        'assets',json((SELECT json_group_array(json_array('asset',CAST(a.id AS TEXT))) FROM file_assets a JOIN json_each(@paths) p ON a.public_path=p.value))
      )
    ), wanted(entity_type,entity_key) AS (
      SELECT DISTINCT json_extract(item.value,'$[0]'),json_extract(item.value,'$[1]')
      FROM revision_sources sources
      JOIN json_each(sources.groups_json) source
      JOIN json_each(source.value) item
    ) SELECT w.entity_type,w.entity_key,COALESCE(r.revision,0) revision FROM wanted w
      LEFT JOIN stock_session_revisions r ON r.entity_type=w.entity_type AND r.entity_key=w.entity_key
      ORDER BY w.entity_type,w.entity_key`).all<Row>({ targets: JSON.stringify(targets), pairs: JSON.stringify(pairs), paths: JSON.stringify([...paths]) })
  return JSON.stringify(rows)
}

function revisionAssertion(type: string, key: string, predicate: string, params: Row, revision: number): StockWriteStatement {
  return assertion(`(${predicate}) AND COALESCE((SELECT revision FROM stock_session_revisions WHERE entity_type=@revisionType AND entity_key=@revisionKey),0)=@revision`, {
    ...params, revisionType: type, revisionKey: key, revision,
  })
}

// Consecutive CHECK guard rows share one statement without dropping predicates or crossing writes.
function packSessionAssertions(statements: StockWriteStatement[]): StockWriteStatement[] {
  // Workerd D1 permits five compound SELECT terms, unlike desktop SQLite's 500.
  const maxCompoundTerms = 5
  const prefix = 'INSERT INTO stock_session_guards(guard_value) '
  const packed: StockWriteStatement[] = []
  let selects: string[] = []
  let params: Row = {}
  let bindings = 0
  const flush = () => {
    if (selects.length) packed.push({ sql: prefix + selects.join(' UNION ALL '), params })
    selects = []; params = {}; bindings = 0
  }
  for (const statement of statements) {
    if (!statement.sql.startsWith(prefix) || Array.isArray(statement.params)) {
      flush(); packed.push(statement); continue
    }
    const count = bindCount(statement)
    if (bindings + count > D1_MAX_BOUND_PARAMS || selects.length === maxCompoundTerms) flush()
    const keyPrefix = `g${selects.length}_`
    selects.push(statement.sql.slice(prefix.length).replace(/@(\w+)/g, (_, key: string) => `@${keyPrefix}${key}`))
    for (const [key, value] of Object.entries(statement.params || {})) params[keyPrefix + key] = value
    bindings += count
  }
  flush()
  return packed
}

function bindCount(statement: StockWriteStatement): number {
  if (Array.isArray(statement.params)) return statement.params.length
  return [...statement.sql.matchAll(/@(\w+)/g)].length
}

function checkBounds(statements: StockWriteStatement[], snapshot: Row) {
  if (statements.length > STOCK_SESSION_MAX_STATEMENTS) fail('Stock session exceeds the single-commit statement bound.', 400, 'statement_limit')
  if (statements.some((statement) => bindCount(statement) > D1_MAX_BOUND_PARAMS)) fail('Stock session exceeds the per-statement bind bound.', 400, 'bind_limit')
  if (new TextEncoder().encode(JSON.stringify(snapshot)).length > STOCK_SESSION_MAX_SNAPSHOT_BYTES) fail('Stock session snapshot is too large.', 400, 'request_too_large')
}

function parseStoredReceipt(row: Row, replayed: boolean): StockSessionReceipt {
  const receipt = JSON.parse(String(row.receipt_json || '{}')) as StockSessionReceipt
  if (!receipt.success || !receipt.operationId || !Array.isArray(receipt.items)) throw new Error('Stock session receipt is incomplete')
  return { ...receipt, replayed }
}

/**
 * The landing of every line addressed to a disabled branch, by line id (the confirmed active branch,
 * X-Branch-Redirect). Throws the 409 refusal when a line needs a confirmation the request does not carry.
 */
async function sessionLandings(db: D1Compat, request: StockSessionRequest, redirectTarget: RedirectTarget): Promise<Map<string, BranchEffect>> {
  const directory = await readBranchDirectory(db)
  const landings = new Map<string, BranchEffect>()
  try {
    for (const line of request.items) {
      const effect = directoryBranchEffect(directory, line.branch_id, redirectTarget)
      if (effect.redirected) landings.set(line.line_id, effect)
    }
  } catch (error) {
    const refusal = branchEffectRefusal(error)
    if (refusal) fail(refusal.error, 409, refusal.code, refusal.redirect ? { redirect: refusal.redirect } : undefined)
    throw error
  }
  return landings
}

export async function commitStockSession(env: Env, user: SessionUser, raw: unknown, redirectTarget: RedirectTarget = null, queryBudget?: StockSessionQueryBudget): Promise<StockSessionReceipt> {
  if (hasAcquisitionCostInput(raw, user)) fail('Cost-entry permission is required to enter receipt costs.', 403, 'product_cost_edit_required')
  let request = parseRequest(raw, isAdminControlUser(user) ? ADMIN_MAX_IMAGES_PER_PRODUCT : MAX_IMAGES_PER_PRODUCT)
  const requiresInventoryAdjust = request.items.some((line) => line.quantity > 0)
  const requiresProductImage = stockSessionChangesProductImages(request)
  if (requiresInventoryAdjust) {
    const inventoryTier = getActionTier(user, 'inventory', 'adjust')
    if (inventoryTier !== 'full') fail(
      inventoryTier === 'review' ? 'Stock sessions cannot be submitted for review; a full inventory permission is required.' : 'No permission to receive stock.',
      403, inventoryTier === 'review' ? 'review_not_supported' : 'permission_denied',
    )
  }
  if (request.items.some((line) => line.kind === 'create_receive') && getActionTier(user, 'products', 'add') !== 'full') {
    fail('create_receive requires full product-add permission.', 403, 'permission_denied')
  }
  // Owner, 6 Oct 2026: a discount on a new product is a price, so it needs the price action (lib/productDiscountGate.ts).
  if (getActionTier(user, 'products', 'price') === 'none'
    && request.items.some((line) => line.kind === 'create_receive' && line.product && productDiscountChanged(null, line.product as unknown as Row))) {
    fail('A product discount needs the product price permission.', 403, 'product_price_edit_required')
  }
  if (requiresProductImage && getActionTier(user, 'products', 'image') !== 'full') {
    fail('create_receive with images requires full product-image permission.', 403, 'permission_denied')
  }
  const execution = sessionBudgetDb(env, queryBudget)
  const db = execution.db
  const submittedCanonical = JSON.stringify(request)
  const previous = await db.prepare('SELECT request_json,receipt_json FROM stock_session_operations WHERE actor_id=@actor AND request_id=@request')
    .get<Row>({ actor: user.id, request: request.client_request_id })
  if (previous?.request_json === submittedCanonical) return parseStoredReceipt(previous, true)
  // Resolve a legacy encoded alias to the stored DB identity before the
  // idempotency fingerprint, while the legacy raw money is still intact.
  // Operations committed before nearest-four normalization stored that exact
  // raw money together with the resolved asset path, so this comparison must
  // precede normalization or an otherwise exact retry would conflict.
  await resolveSessionImagePaths(db, request)
  const resolvedLegacyCanonical = JSON.stringify(request)
  if (previous?.request_json === resolvedLegacyCanonical) return parseStoredReceipt(previous, true)
  request = normalizeNewRequestMoney(request)
  const canonical = JSON.stringify(request)
  if (previous) {
    if (previous.request_json !== canonical) fail('client_request_id was already used with different data.', 409, 'idempotency_conflict')
    return parseStoredReceipt(previous, true)
  }

  execution.begin()
  for (const line of request.items) {
    if (line.kind === 'create_receive' && line.product) assertProductStatusInput(line.product)
  }

  // Validate new receipts only after exact stored retries have resolved. Older
  // committed credit operations may lack a due date; replay must stay exact.
  if (request.items.some((line) => line.quantity > 0 && line.payment_status === 'credit' && !line.credit_due_date)) {
    fail('A Not Yet Paid purchase needs its due date.', 400, 'invalid_request')
  }

  // Sep 16 2026 owner ruling / P10-5 writer 4: a create_receive line whose
  // name+barcode identifies as an EXISTING active product folds onto it
  // (real barcode wins, stored barcode loses a leading zero; cost recomputes
  // from lots same as any other receive, via the same
  // catalogCostRecomputeStatement every other receive line already gets)
  // instead of 409ing -- same rule as products.ts's foldCreateIntoExisting.
  // Resolved here, before the receive/create id lists below, and a
  // quantity>0 fold is converted straight into an ordinary 'receive' line
  // targeting the survivor's id: that gets it every existing revision
  // assertion, date-batch top-up and stock-lookup a normal receive already
  // has, instead of re-deriving that machinery for a second code path. A
  // quantity=0 fold (catalogue-only touch) has no lot to receive, so it
  // stays a create_receive line and is handled specially further down.
  const createFolds = new Map<string, { id: number; name: string; barcode: string; incomingBarcode: unknown; requestedName: unknown }>()
  {
    const createLinesForFold = request.items.filter((line) => line.kind === 'create_receive' && line.product)
    if (createLinesForFold.length) {
      const nameClause = buildInClause('name', [...new Set(createLinesForFold.map((line) => normalizeProductGroupName(line.product?.name)))])
      const candidates = await db.prepare(`SELECT id,name,barcode FROM products WHERE is_active=1 AND LOWER(TRIM(REPLACE(REPLACE(REPLACE(name,'  ',' '),'  ',' '),'  ',' '))) IN (${nameClause.sql})`).all<Row>(nameClause.params)
      for (const line of createLinesForFold) {
        const product = line.product as CanonicalProduct
        const duplicate = candidates.find((row) =>
          normalizeProductGroupName(String(row.name)) === normalizeProductGroupName(String(product.name))
          && barcodeIdentityMatches(row.barcode, product.barcode))
        if (duplicate) createFolds.set(line.line_id, {
          id: Number(duplicate.id), name: String(duplicate.name), barcode: String(duplicate.barcode ?? ''),
          incomingBarcode: product.barcode, requestedName: product.name,
        })
      }
    }
    if (createFolds.size) {
      request = {
        ...request,
        items: request.items.map((line) => {
          const fold = createFolds.get(line.line_id)
          if (!fold || line.kind !== 'create_receive' || line.quantity <= 0) return line
          return { ...line, kind: 'receive', product_id: fold.id, product: null }
        }),
      }
    }
  }

  // Quantity>0 folds already carry their survivor's id as product_id (the
  // conversion above); a quantity=0 fold still doesn't (it stayed
  // create_receive), so its survivor id is added explicitly here -- it
  // still needs the SAME active-row check, revision-pair and product
  // postimage coverage every other touched product gets, to guard the
  // barcode-cleanup UPDATE queued for it further down.
  // A line addressed to a disabled branch is received at the confirmed active branch (its lot as it exists
  // there); the stored request keeps the branch it was addressed to.
  const landings = await sessionLandings(db, request, redirectTarget)
  if (landings.size) {
    request = {
      ...request,
      items: await Promise.all(request.items.map(async (line) => {
        const landing = landings.get(line.line_id)
        if (!landing) return line
        return { ...line, branch_id: landing.effectBranchId, batch_id: line.batch_id == null ? line.batch_id : Number(await landingLotId(db, landing, line.batch_id)) }
      })),
    }
  }
  const receiveIds = request.items.flatMap((line) => line.product_id == null ? [] : [line.product_id])
    .concat([...createFolds.values()].map((fold) => fold.id))
  const branchIds = request.items.map((line) => line.branch_id)
  const supplierIds = request.items.flatMap((line) => line.supplier_id == null ? [] : [line.supplier_id])
  const explicitBatchIds = request.items.flatMap((line) => line.batch_id == null ? [] : [line.batch_id])
  const beforeFence = await snapshotFence(db, request)
  const facts = await sessionFacts(env, db, receiveIds, branchIds, supplierIds, explicitBatchIds)
  const { products, branches, suppliers } = facts
  const explicitBatches = facts.batches.filter(row => explicitBatchIds.includes(Number(row.id)))
  const receiveProducts = new Map(products.map((row) => [Number(row.id), row]))
  const branchMap = new Map(branches.map((row) => [Number(row.id), row]))
  const supplierMap = new Map(suppliers.map((row) => [Number(row.id), row]))
  const explicitBatchMap = new Map(explicitBatches.map((row) => [Number(row.id), row]))

  for (const id of receiveIds) {
    const product = receiveProducts.get(id)
    if (!product) fail(`Product ${id} was not found.`, 404, 'product_not_found')
    if (Number(product.is_active) !== 1) throw new ProductStockGuardError([id])
  }
  for (const id of branchIds) {
    const branch = branchMap.get(id)
    if (!branch || Number(branch.is_active) !== 1) fail(`Branch ${id} was not found or is inactive.`, 404, 'branch_not_found')
  }
  for (const id of supplierIds) if (!supplierMap.has(id)) fail(`Supplier ${id} was not found.`, 404, 'supplier_not_found')
  for (const line of request.items) {
    if (line.supplier_id != null) {
      const supplierName = String(supplierMap.get(line.supplier_id)?.name || '').trim()
      if (line.supplier_name && supplierName.toLowerCase() !== line.supplier_name.toLowerCase()) fail(`Supplier ${line.supplier_id} does not match supplier_name.`, 409, 'supplier_mismatch')
      line.supplier_name = supplierName
    }
    if (line.batch_id != null) {
      const batch = explicitBatchMap.get(line.batch_id)
      if (!batch || Number(batch.variant_product_id) !== line.product_id) fail(`Received stock ${line.batch_id} does not belong to product ${line.product_id}.`, 409, 'batch_mismatch')
    }
  }

  // A stock session is a single editable receipt. Repeating a product by
  // normalized name OR folded barcode is almost always an accidental second
  // Add; quantity belongs on the first line. This guard is intentionally
  // session-local and does not redefine catalog identity or merge variants.
  const seenSessionProducts: Array<{ lineId: string; name?: unknown; barcode?: unknown }> = []
  for (const line of request.items) {
    const source = line.kind === 'receive'
      ? receiveProducts.get(line.product_id as number)
      : line.product
    const candidate = { lineId: line.line_id, name: source?.name, barcode: source?.barcode }
    const duplicate = seenSessionProducts.find((seen) => sessionProductDuplicateReason(seen, candidate))
    if (duplicate) {
      fail('Duplicate: You added this item already.', 409, 'duplicate_session_item', {
        line_id: line.line_id,
        duplicate_line_id: duplicate.lineId,
        match: sessionProductDuplicateReason(duplicate, candidate),
      })
    }
    seenSessionProducts.push(candidate)
  }

  const dateBatchLines = request.items.filter((line) => line.kind === 'receive' && line.batch_id == null)
  const createLines = request.items.filter((line) => line.kind === 'create_receive')
  const stockCreateLines = createLines.filter((line) => line.quantity > 0)
  const duplicateNameClause = createLines.length
    ? buildInClause('name', [...new Set(createLines.map((line) => normalizeProductGroupName(line.product?.name)))])
    : null
  const imagePaths = [...new Set(createLines.flatMap((line) => {
    const gallery = (line.product?.image_gallery as string[] | undefined) || []
    const primary = String(line.product?.image_path || '')
    return primary ? [primary, ...gallery] : gallery
  }))]
  const galleryLinkCount = createLines.reduce((count, line) => count + (((line.product?.image_gallery as string[] | undefined) || []).length), 0)
  if (galleryLinkCount > STOCK_SESSION_MAX_GALLERY_LINKS) fail(`A stock session can link at most ${STOCK_SESSION_MAX_GALLERY_LINKS} product images.`, 400, 'child_row_limit')

  // Five independent reads -- none depends on another's result, only on the
  // request itself -- fanned into one Promise.all instead of five
  // sequential round trips (dateBatch lookup, memoized schema probe, active
  // branches, duplicate-name candidates, image asset lookup).
  const [possibleDateBatches, productColumns, activeBranches, duplicateCandidates, assets, costBaselines] = await Promise.all([
    Promise.resolve(facts.batches.filter(row => dateBatchLines.some(line => line.product_id === Number(row.variant_product_id)))),
    createLines.length ? sessionColumns(env, db).then(columns => columns.get('products') as Set<string>) : Promise.resolve(new Set<string>()),
    stockCreateLines.length ? db.prepare('SELECT id FROM branches WHERE is_active=1 ORDER BY id').all<Row>() : Promise.resolve([] as Row[]),
    duplicateNameClause
      ? db.prepare(`SELECT id,name,barcode,cost_price_usd,cost_price_khr FROM products WHERE is_active=1 AND LOWER(TRIM(REPLACE(REPLACE(REPLACE(name,'  ',' '),'  ',' '),'  ',' '))) IN (${duplicateNameClause.sql})`).all<Row>(duplicateNameClause.params)
      : Promise.resolve([] as Row[]),
    rowsIn<Row>(db, imagePaths, 'public_path', 'SELECT id,public_path FROM file_assets'),
    Promise.resolve(facts.baselines),
  ])
  const baselineByProduct = new Map(costBaselines.map(row => [Number(row.product_id), Number(row.baseline_batch_id) || 0]))
  const receiptTargets = new Map<string, ReceiptLotTarget>()
  for (const line of request.items.filter(item => item.quantity > 0)) {
    const rows = line.batch_id != null ? explicitBatches : possibleDateBatches
    const lots = rows.filter(row => row.variant_product_id === line.product_id).map(row => ({
      id: Number(row.id), batch_key: String(row.batch_key), received_at: row.received_at == null ? null : String(row.received_at),
      unit_cost_usd: row.unit_cost_usd == null ? null : Number(row.unit_cost_usd),
    } satisfies ReceiptLotCandidate))
    try {
      receiptTargets.set(line.line_id, resolveReceiptLotTarget(lots, line.received_date, line.unit_cost_usd,
        baselineByProduct.get(line.product_id as number) || 0, line.batch_id))
    } catch {
      fail('Selected received-date price or override baseline changed; choose the received date again.', 409, 'batch_cost_mismatch')
    }
  }
  const receiptBatchKey = (line: CanonicalLine) => receiptTargets.get(line.line_id)?.batchKey ?? receivedBatchKey(line.received_date)
  const dateBatchMap = new Map(possibleDateBatches.map((row) => [`${row.variant_product_id}:${row.batch_key}`, row]))
  const relevantBatches = [...explicitBatches]
  for (const line of dateBatchLines) {
    const key = `${line.product_id}:${receiptBatchKey(line)}`
    const batch = dateBatchMap.get(key)
    if (batch && !relevantBatches.some((row) => row.id === batch.id)) relevantBatches.push(batch)
  }

  // THE identity rule, as products.ts findSameProductIdentityProduct and the
  // import path already apply it: normalized name + FOLDED barcode.
  //
  // Cost left this guard on 2026-09-06. Keeping it contradicted the Sep-4
  // ruling head-on -- a second cost for one article is a merge, not a new
  // child row -- so the fast stock-in session happily minted the cost-forked
  // twin the merge tool then had to clean up. And the barcode now folds, so a
  // code retyped with a leading zero ('0123' beside '123') is one product
  // here too, instead of a second row this session creates and the Conflicts
  // tab reports the next morning.
  const identityKeys = new Set<string>()
  for (const line of createLines) {
    if (createFolds.has(line.line_id)) continue
    const product = line.product as CanonicalProduct
    const key = `${normalizeProductGroupName(product.name)}${identityBarcodeKey(product.barcode)}`
    if (identityKeys.has(key)) fail('Two create_receive lines describe the same product identity.', 409, 'duplicate_product')
    identityKeys.add(key)
  }
  if (createLines.length) {
    for (const line of createLines) {
      // Already resolved as a fold above (quantity=0: no lot to receive, so
      // it stayed a create_receive line instead of converting to 'receive')
      // -- a fresh 409 here would just refuse the very fold this line was
      // already resolved to make.
      if (createFolds.has(line.line_id)) continue
      const product = line.product as CanonicalProduct
      // The SQL above narrows to the name group; the barcode is compared
      // here through the full wildcard rule (barcodeIdentityMatches, Sep 15
      // 2026 -- a broken/empty barcode on either side never forces a new
      // row), mirroring pickSameIdentityRow. Same rule, same answer as the
      // manual product form and the CSV import.
      const duplicate = duplicateCandidates.find((row) =>
        normalizeProductGroupName(row.name) === normalizeProductGroupName(product.name)
        && barcodeIdentityMatches(row.barcode, product.barcode))
      if (duplicate) fail(`"${duplicate.name}" already exists with this barcode.`, 409, 'duplicate_product', { duplicate })
    }
  }
  const assetByPath = new Map(assets.map((row) => [String(row.public_path), row]))
  const missingAsset = imagePaths.find((path) => !assetByPath.has(path))
  if (missingAsset) fail(`Image asset ${missingAsset} does not exist.`, 409, 'missing_image_asset')

  const existingProductIds = [...new Set(receiveIds)]
  const existingBatchIds = relevantBatches.map((row) => Number(row.id))
  // Independent per-table stock lookups -- fanned into one Promise.all
  // instead of two sequential round trips.
  const [branchStocks, batchStocks] = await Promise.all([
    existingProductIds.length && branchIds.length
      ? db.prepare(`SELECT * FROM branch_stock WHERE product_id IN (${buildInClause('product', existingProductIds).sql}) AND branch_id IN (${buildInClause('branch', [...new Set(branchIds)]).sql})`)
        .all<Row>({ ...buildInClause('product', existingProductIds).params, ...buildInClause('branch', [...new Set(branchIds)]).params })
        .then((rows) => rows.filter((row) => request.items.some((line) =>
          // A quantity=0 fold line never gets converted to kind 'receive' (no
          // lot to open for it), so it still has product_id=null here -- fall
          // back to the fold target so its own branch_stock row still lands
          // in the before/after undo snapshot instead of looking unowned and
          // getting deleted by undo's "not one of this session's rows" path.
          (line.product_id ?? createFolds.get(line.line_id)?.id) === row.product_id && line.branch_id === row.branch_id)))
      : Promise.resolve([] as Row[]),
    existingBatchIds.length && branchIds.length
      ? db.prepare(`SELECT * FROM branch_batch_stock WHERE batch_id IN (${buildInClause('batch', existingBatchIds).sql}) AND branch_id IN (${buildInClause('branch', [...new Set(branchIds)]).sql})`)
        .all<Row>({ ...buildInClause('batch', existingBatchIds).params, ...buildInClause('branch', [...new Set(branchIds)]).params })
        .then((rows) => rows.filter((row) => request.items.some((line) => {
          const batch = line.batch_id != null ? explicitBatchMap.get(line.batch_id) : dateBatchMap.get(`${line.product_id}:${receiptBatchKey(line)}`)
          return batch?.id === row.batch_id && line.branch_id === row.branch_id
        })))
      : Promise.resolve([] as Row[]),
  ])
  const branchStockMap = new Map(branchStocks.map((row) => [`${row.product_id}:${row.branch_id}`, row]))
  const batchStockMap = new Map(batchStocks.map((row) => [`${row.batch_id}:${row.branch_id}`, row]))

  const revisionPairs: Array<[string, string]> = [['product_catalog', 'all']]
  if (stockCreateLines.length) revisionPairs.push(['branch_catalog', 'all'])
  for (const row of products) revisionPairs.push(['product', String(row.id)])
  for (const row of branches) revisionPairs.push(['branch', String(row.id)])
  for (const row of suppliers) revisionPairs.push(['supplier', String(row.id)])
  for (const row of assets) revisionPairs.push(['asset', String(row.id)])
  for (const row of relevantBatches) revisionPairs.push(['batch', String(row.id)])
  for (const line of request.items.filter((item) => item.kind === 'receive')) {
    const explicit = line.batch_id == null ? null : explicitBatchMap.get(line.batch_id)
    const batchKey = explicit ? String(explicit.batch_key) : receiptBatchKey(line)
    revisionPairs.push(['batch_identity', `${line.product_id}:${batchKey}`])
    revisionPairs.push(['branch_stock', `${line.product_id}:${line.branch_id}`])
    const batch = line.batch_id != null ? explicitBatchMap.get(line.batch_id) : dateBatchMap.get(`${line.product_id}:${batchKey}`)
    if (batch) revisionPairs.push(['branch_batch_stock', `${batch.id}:${line.branch_id}`])
  }
  const revisions = await readRevisions(db, revisionPairs)
  if (await snapshotFence(db, request) !== beforeFence) {
    fail('Stock session state changed while reading its snapshot. Refresh and retry.', 409, 'stale_state')
  }
  const rev = (type: string, key: unknown) => revisions.get(revisionKey(type, key)) || 0
  const operationId = crypto.randomUUID()
  const snapshot: Row = {
    version: 2,
    operationId,
    request,
    before: { products, batches: relevantBatches, branchStock: branchStocks, branchBatchStock: batchStocks, activeBranches },
    revisions: Object.fromEntries(revisions),
  }
  const statements: StockWriteStatement[] = [
    productStockGuardStatement(request.items.filter(line => line.quantity > 0 && line.product_id != null).map(line => Number(line.product_id)), 'active'),
    assertion("NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance')"),
  ]
  for (const landing of new Map([...landings.values()].map((effect) => [`${effect.addressedBranchId}>${effect.effectBranchId}`, effect])).values()) {
    statements.push(branchRedirectGuard(landing))
  }
  const receiptTotalCostUsd = sumMoney4(request.items.flatMap((line) =>
    line.unit_cost_usd == null || line.quantity <= 0 ? [] : [multiplyMoney4(line.unit_cost_usd, line.quantity)]))
  for (const row of products) statements.push(revisionAssertion('product', String(row.id), 'EXISTS(SELECT 1 FROM products WHERE id=@id AND is_active=1)', { id: row.id }, rev('product', row.id)))
  for (const row of branches) statements.push(revisionAssertion('branch', String(row.id), 'EXISTS(SELECT 1 FROM branches WHERE id=@id AND is_active=1)', { id: row.id }, rev('branch', row.id)))
  for (const row of suppliers) statements.push(revisionAssertion('supplier', String(row.id), 'EXISTS(SELECT 1 FROM suppliers WHERE id=@id)', { id: row.id }, rev('supplier', row.id)))
  for (const row of assets) statements.push(revisionAssertion('asset', String(row.id), 'EXISTS(SELECT 1 FROM file_assets WHERE id=@id AND public_path=@path)', { id: row.id, path: row.public_path }, rev('asset', row.id)))
  for (const row of relevantBatches) statements.push(revisionAssertion('batch', String(row.id), 'EXISTS(SELECT 1 FROM product_batches WHERE id=@id AND variant_product_id=@product AND batch_key=@batchKey)', { id: row.id, product: row.variant_product_id, batchKey: row.batch_key }, rev('batch', row.id)))
  for (const line of request.items.filter((item) => item.kind === 'receive')) {
    const explicit = line.batch_id == null ? null : explicitBatchMap.get(line.batch_id)
    const targetBatchKey = explicit ? String(explicit.batch_key) : receiptBatchKey(line)
    const identity = `${line.product_id}:${targetBatchKey}`
    const batch = line.batch_id != null ? explicitBatchMap.get(line.batch_id) : dateBatchMap.get(identity)
    statements.push(revisionAssertion('batch_identity', identity, batch
      ? 'EXISTS(SELECT 1 FROM product_batches WHERE id=@batch AND variant_product_id=@product AND batch_key=@batchKey)'
      : 'NOT EXISTS(SELECT 1 FROM product_batches WHERE variant_product_id=@product AND batch_key=@batchKey)',
    { batch: batch?.id ?? null, product: line.product_id, batchKey: targetBatchKey }, rev('batch_identity', identity)))
    const stockKey = `${line.product_id}:${line.branch_id}`
    const stock = branchStockMap.get(stockKey)
    statements.push(revisionAssertion('branch_stock', stockKey, stock
      ? 'EXISTS(SELECT 1 FROM branch_stock WHERE product_id=@product AND branch_id=@branch AND quantity IS @quantity)'
      : 'NOT EXISTS(SELECT 1 FROM branch_stock WHERE product_id=@product AND branch_id=@branch)',
    { product: line.product_id, branch: line.branch_id, quantity: stock?.quantity ?? null }, rev('branch_stock', stockKey)))
    if (batch) {
      const lotKey = `${batch.id}:${line.branch_id}`
      const lot = batchStockMap.get(lotKey)
      statements.push(revisionAssertion('branch_batch_stock', lotKey, lot
        ? 'EXISTS(SELECT 1 FROM branch_batch_stock WHERE batch_id=@batch AND branch_id=@branch AND quantity IS @quantity)'
        : 'NOT EXISTS(SELECT 1 FROM branch_batch_stock WHERE batch_id=@batch AND branch_id=@branch)',
      { batch: batch.id, branch: line.branch_id, quantity: lot?.quantity ?? null }, rev('branch_batch_stock', lotKey)))
    }
  }
  if (createLines.length) {
    statements.push(revisionAssertion('product_catalog', 'all', '1=1', {}, rev('product_catalog', 'all')))
    if (stockCreateLines.length) statements.push(revisionAssertion('branch_catalog', 'all', '1=1', {}, rev('branch_catalog', 'all')))
    for (const line of createLines) {
      // A fold line (createFolds above) is SUPPOSED to have an existing row
      // sharing its identity -- that is the row it just folded into -- so
      // the NOT EXISTS guard below would legitimately fail for it. Its
      // concurrency guard is the ordinary product revisionAssertion pushed
      // earlier for every id in receiveIds, which already includes it.
      if (createFolds.has(line.line_id)) continue
      const product = line.product as CanonicalProduct
      // The commit-time race guard for the JS check above, and it has to ask
      // the SAME question or it lets through exactly what that check refuses.
      // It is a SQL predicate inside the batch, so it cannot call the fold --
      // identityBarcodeMatchSql is the one SQL copy of the wildcard match,
      // pinned against the real function by
      // test-stock-session-identity-guard-pure.cjs. Cost is gone from here
      // for the same reason it left the guard above. A broken/empty incoming
      // barcode has no real-key predicate to add (it wildcard-matches every
      // row in the name group already), so the fragment is omitted entirely
      // rather than emitting an always-true clause.
      const barcodeMatch = identityBarcodeMatchSql('barcode', product.barcode)
      statements.push(assertion(`NOT EXISTS(SELECT 1 FROM products WHERE is_active=1
        ${barcodeMatch ? `AND ${barcodeMatch.sql}` : ''}
        AND LOWER(TRIM(REPLACE(REPLACE(REPLACE(name,'  ',' '),'  ',' '),'  ',' ')))=@nameKey)`, {
        ...(barcodeMatch?.params || {}), nameKey: normalizeProductGroupName(product.name),
      }))
    }
  }
  // Fold: clean the survivor's stored barcode when the incoming REAL
  // barcode differs from a padded/broken one (never overwrite an already
  // clean real code with a different spelling of the same identity), and
  // leave a 'fold' audit row for undo evidence -- guarded by the SAME
  // product revisionAssertion pushed above (the fold target is in
  // receiveIds/products either way, see the comment there). This has to run
  // AFTER the product_catalog/branch_catalog revisionAssertion above (not
  // before it, where it used to live): the UPDATE below fires the
  // stock_revision_products_update trigger, which bumps product_catalog's
  // revision -- if that ran before the assertion captured/compared it, the
  // fold would trip its OWN concurrency guard as a false stale_state on
  // every single request. Cost is NOT hand-merged here: a quantity>0 fold
  // is now an ordinary 'receive' line (see the conversion above) and gets
  // the same catalogCostRecomputeStatement every other receive line already
  // gets, further down -- lot-weighted, not a single-field average, and
  // strictly more correct than repeating that average here. A quantity=0
  // fold has no lot, so there is nothing to recompute; the barcode is the
  // only thing that can change for it.
  for (const [lineId, fold] of createFolds) {
    const line = request.items.find((item) => item.line_id === lineId)
    const incomingBarcode = fold.incomingBarcode
    if (isRealBarcode(incomingBarcode)) {
      const cleanedIncoming = normalizeLeadingZeroBarcodeForCleanup(String(incomingBarcode).trim().toLowerCase())
      const existingReal = isRealBarcode(fold.barcode)
      const existingStored = fold.barcode.trim()
      if (!existingReal || (existingStored.toLowerCase() !== cleanedIncoming
        && normalizeLeadingZeroBarcodeForCleanup(existingStored.toLowerCase()) === cleanedIncoming)) {
        statements.push({ sql: 'UPDATE products SET barcode=@barcode, updated_at=CURRENT_TIMESTAMP WHERE id=@id', params: { barcode: cleanedIncoming, id: fold.id } })
      }
    }
    statements.push({ sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id)
      VALUES(@actor,@name,'fold','product',@entityId,@details,'products',@recordId)`, params: {
      actor: user.id, name: actorSnapshot(user), entityId: String(fold.id), recordId: fold.id,
      details: JSON.stringify({ reason: 'stock_session_create_receive_fold', requestedName: fold.requestedName, incomingBarcode, operationId, quantity: line?.quantity ?? 0 }),
    } })
  }
  statements.push({ sql: 'INSERT INTO stock_session_operations(id,actor_id,request_id,mode,request_json) VALUES(@id,@actor,@request,\'stock_in\',@canonical)', params: { id: operationId, actor: user.id, request: request.client_request_id, canonical } })
  statements.push({ sql: 'INSERT INTO undo_snapshots(kind,payload_json,created_by_id,created_by_name) VALUES(@kind,@payload,@actor,@name)', params: { kind: STOCK_SESSION_KIND, payload: JSON.stringify(snapshot), actor: user.id, name: actorSnapshot(user) } })
  statements.push({ sql: 'UPDATE stock_session_operations SET snapshot_id=last_insert_rowid() WHERE id=@id', params: { id: operationId } })
  statements.push({ sql: `INSERT INTO action_history(scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_id,created_by_name)
    SELECT 'global','stock_session',id,@label,1,'undoable',json_object('applier',@kind,'snapshot_id',snapshot_id,'operation_id',id,'generation',0,'requires_product_add',@creates,'requires_product_image',@images,'requires_inventory_adjust',@adjusts,'snapshot_version',2),json_object('applier',@kind,'snapshot_id',snapshot_id,'operation_id',id,'generation',0,'requires_product_add',@creates,'requires_product_image',@images,'requires_inventory_adjust',@adjusts,'snapshot_version',2),@actor,@name
    FROM stock_session_operations WHERE id=@id`, params: { id: operationId, label: `${request.items.length} stock-in line${request.items.length === 1 ? '' : 's'}`, kind: STOCK_SESSION_KIND, actor: user.id, name: actorSnapshot(user), creates: createLines.length ? 1 : 0, images: requiresProductImage ? 1 : 0, adjusts: requiresInventoryAdjust ? 1 : 0 } })
  statements.push({ sql: 'UPDATE stock_session_operations SET history_id=last_insert_rowid() WHERE id=@id', params: { id: operationId } })

  for (const line of request.items) {
    // A quantity=0 fold (catalogue-only line whose identity turned out to
    // already exist -- see createFolds above) has no product to insert and
    // no lot to receive; it just records that this line landed on the
    // survivor, product_created=0, by the real id directly (no
    // client_request_id indirection -- that trick exists only to recover an
    // id this same batch is about to INSERT, and the survivor already has one).
    const fold = line.kind === 'create_receive' ? createFolds.get(line.line_id) : undefined
    const productRequestId = line.kind === 'create_receive' && !fold ? `stock-session:${operationId}:${line.line_id}` : null
    if (line.kind === 'create_receive' && !fold) {
      statements.push(planInsertRow('products', line.product as CanonicalProduct, productColumns, {
        name: line.product?.name, is_active: line.product?.is_active ?? 1, stock_quantity: 0, client_request_id: productRequestId,
      }))
      if (line.quantity > 0) statements.push({ sql: `INSERT OR IGNORE INTO branch_stock(product_id,branch_id,quantity)
        SELECT products.id,b.id,0 FROM products CROSS JOIN branches b WHERE products.client_request_id=@productRequestId AND b.is_active=1`, params: { productRequestId } })
      for (const [order, imagePath] of ((line.product?.image_gallery as string[] | undefined) || []).entries()) {
        statements.push({ sql: `INSERT INTO product_images(product_id,image_path,sort_order)
          SELECT id,@path,@order FROM products WHERE client_request_id=@productRequestId`, params: { path: imagePath, order, productRequestId } })
      }
    }
    if (line.quantity === 0) {
      if (fold) {
        statements.push({ sql: `INSERT INTO stock_session_members(operation_id,line_id,command_kind,product_id,product_created,branch_id,branch_name,batch_id,movement_id,quantity,unit_cost_usd)
          VALUES(@operationId,@lineId,@kind,@productId,0,@branchId,(SELECT name FROM branches WHERE id=@branchId),NULL,NULL,0,@unitCostUsd)`,
        params: { operationId, lineId: line.line_id, kind: line.kind, productId: fold.id, branchId: line.branch_id, unitCostUsd: line.unit_cost_usd } })
      } else {
        statements.push({ sql: `INSERT INTO stock_session_members(operation_id,line_id,command_kind,product_id,product_created,branch_id,branch_name,batch_id,movement_id,quantity,unit_cost_usd)
          SELECT @operationId,@lineId,@kind,id,1,@branchId,(SELECT name FROM branches WHERE id=@branchId),NULL,NULL,0,@unitCostUsd FROM products WHERE client_request_id=@productRequestId`,
        params: { operationId, lineId: line.line_id, kind: line.kind, branchId: line.branch_id, unitCostUsd: line.unit_cost_usd, productRequestId } })
      }
      continue
    }
    const plan = planReceiveBatchStock({
      productId: line.product_id, productClientRequestId: productRequestId, branchId: line.branch_id,
      quantity: line.quantity, expiryDate: line.expiry_date, receivedDate: line.received_date,
      notes: line.notes, batchId: line.batch_id, supplierId: line.supplier_id,
      supplierName: line.supplier_name, unitCostUsd: line.unit_cost_usd,
      paymentStatus: line.payment_status, creditDueDate: line.credit_due_date,
      receiptLotTarget: receiptTargets.get(line.line_id),
      receiptCostPreimage: line.unit_cost_usd == null ? undefined : (() => {
        const batch = line.kind === 'receive'
          ? line.batch_id != null
            ? explicitBatchMap.get(line.batch_id)
            : dateBatchMap.get(`${line.product_id}:${receiptBatchKey(line)}`)
          : null
        return { batchExists: Boolean(batch), receivedCostUsd: batch?.received_cost_usd == null ? null : Number(batch.received_cost_usd) }
      })(),
    })
    statements.push(...plan.statements)
    statements.push({ sql: `INSERT INTO stock_session_members(operation_id,line_id,command_kind,product_id,product_created,branch_id,branch_name,batch_id,quantity,unit_cost_usd)
      VALUES(@operationId,@lineId,@kind,${plan.productIdSql},@created,@branchId,(SELECT name FROM branches WHERE id=@branchId),${plan.batchIdSql},@quantity,@unitCostUsd)`, params: { ...plan.params, operationId, lineId: line.line_id, kind: line.kind, created: line.kind === 'create_receive' ? 1 : 0 } })
    // 'add' -- the ledger's canonical receipt type, the same string POST
    // /api/inventory/adjust and POST /api/batches write, and the one this
    // file's own redo path already emits below. This used to write the
    // session MODE ('stock_in') instead, so every session committed through
    // the Products page's "Add products" entry was invisible to the Stock-in
    // Sessions list, the shared-lot receipt counter and the Telegram stock-in
    // digest, all of which filter on 'add'. Rows already written under the
    // old string are covered by STOCK_RECEIPT_MOVEMENT_TYPES until migration
    // 0128 normalises them.
    // P3-L2: the line's own reason (as typed) is the movement reason; a line
    // without one keeps the generated session label.
    const movement: StockWriteStatement = { sql: `INSERT INTO inventory_movements(product_id,product_name,branch_id,branch_name,movement_type,quantity,unit_cost_usd,unit_cost_khr,total_cost_usd,total_cost_khr,reason,reference_id,user_id,user_name,batch_id)
      SELECT m.product_id,p.name,m.branch_id,b.name,'add',m.quantity,m.unit_cost_usd,0,CASE WHEN m.unit_cost_usd IS NULL THEN NULL ELSE @totalCostUsd END,0,@reason,o.rowid,@actor,@actorName,m.batch_id
      FROM stock_session_members m JOIN products p ON p.id=m.product_id JOIN branches b ON b.id=m.branch_id JOIN stock_session_operations o ON o.id=m.operation_id
      WHERE m.operation_id=@operationId AND m.line_id=@lineId`, params: { reason: line.reason || `Stock-in session ${operationId}`, actor: user.id, actorName: actorSnapshot(user), operationId, lineId: line.line_id, totalCostUsd: plan.params.receivedCostUsd } }
    const lineLanding = landings.get(line.line_id)
    statements.push(lineLanding ? addressedMovement(movement, lineLanding.addressedName) : movement)
    statements.push({ sql: 'UPDATE stock_session_members SET movement_id=last_insert_rowid() WHERE operation_id=@operationId AND line_id=@lineId', params: { operationId, lineId: line.line_id } })
  }
  // P10-4 (owner ruling 2026-09-16): every 'receive' line just wrote/topped a
  // lot cost -- re-derive products.cost_price_* per distinct product
  // touched, same rule as the other receipt wires. NOT 'create_receive':
  // that line's INSERT already set the new row's cost from the operator's
  // own entry, which is the catalog-cost decision for a row that never had
  // one before (same skip as routes/inventory.ts's created-sibling guard).
  // Pushed as a SQL statement INSIDE this same batch, before the
  // captureReplayState postimage capture below, not as a follow-up async
  // call -- see catalogCostRecomputeStatement's doc comment for why a write
  // after this batch commits would break undo/redo's "expected" comparison.
  for (const productId of new Set(request.items.filter((line) => line.kind === 'receive' && line.quantity > 0).map((line) => line.product_id))) {
    if (productId != null) statements.push(catalogCostRecomputeStatement(productId))
  }
  statements.push({ sql: `UPDATE stock_session_operations SET receipt_json=json_object(
      'success',json('true'),'operationId',id,'clientRequestId',request_id,'actionHistoryId',history_id,'snapshotId',snapshot_id,
      'memberCount',(SELECT COUNT(*) FROM stock_session_members WHERE operation_id=id),
      'createdCount',(SELECT COUNT(*) FROM stock_session_members WHERE operation_id=id AND product_created=1),
      'receivedCount',(SELECT COUNT(*) FROM stock_session_members WHERE operation_id=id AND command_kind='receive'),
      'totalQuantity',(SELECT COALESCE(SUM(quantity),0) FROM stock_session_members WHERE operation_id=id),
      'totalCostUsd',@totalCostUsd,
      'items',json((SELECT json_group_array(json(item)) FROM (SELECT json_object(
        'lineId',m.line_id,'kind',m.command_kind,'productId',m.product_id,'productName',p.name,
        'createdProduct',json(CASE m.product_created WHEN 1 THEN 'true' ELSE 'false' END),'branchId',m.branch_id,
        'batchId',m.batch_id,'batchNumber',pb.batch_number,'lotCode',pb.lot_code,'movementId',m.movement_id,
        'quantity',m.quantity,'unitCostUsd',m.unit_cost_usd) item
        FROM stock_session_members m JOIN products p ON p.id=m.product_id LEFT JOIN product_batches pb ON pb.id=m.batch_id
        WHERE m.operation_id=stock_session_operations.id ORDER BY m.line_id))))
    WHERE id=@id`, params: { id: operationId, totalCostUsd: receiptTotalCostUsd } })
  statements.push({ sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,new_value)
    SELECT @actor,@name,'stock_session_create','stock_session',id,receipt_json,'stock_session_operations',id,receipt_json
    FROM stock_session_operations WHERE id=@id`, params: { actor: user.id, name: actorSnapshot(user), id: operationId } })
  statements.push({ sql: 'DELETE FROM stock_session_guards', params: {} })
  const replayStateSql = await stockReplayStateSql(env, true, db)
  statements.push(...captureReplayState(operationId, replayStateSql, true))
  checkBounds(statements, snapshot)
  try {
    await execution.commit(packSessionAssertions(statements))
    execution.finishReads()
  } catch (error) {
    execution.finishReads()
    if (error instanceof StockSessionError && error.code === 'stock_session_query_budget_exceeded') throw error
    const retry = await db.prepare('SELECT request_json,receipt_json FROM stock_session_operations WHERE actor_id=@actor AND request_id=@request')
      .get<Row>({ actor: user.id, request: request.client_request_id })
    if (retry) {
      if (retry.request_json !== canonical) fail('client_request_id was already used with different data.', 409, 'idempotency_conflict')
      return parseStoredReceipt(retry, true)
    }
    const activeGuard = productStockGuardError(error)

    if (activeGuard) throw activeGuard

    if (/constraint/i.test(String(error))) fail('Product, branch, received date, stock, or asset state changed. Nothing was applied; refresh and retry.', 409, 'stale_state')
    const landing = landings.values().next().value
    if (landing && isBranchRedirectGuardError(error)) {
      const refusal = await branchRedirectGuardRefusal(db, landing.addressedBranchId, redirectTarget)
      fail(refusal.error, 409, refusal.code, refusal.redirect ? { redirect: refusal.redirect } : undefined)
    }
    throw error
  }
  const saved = await db.prepare('SELECT receipt_json FROM stock_session_operations WHERE id=@id').get<Row>({ id: operationId })
  if (!saved) throw new Error('Stock session committed without a readable receipt')
  return parseStoredReceipt(saved, false)
}

export async function notifyStockSession(env: Env, receipt: Pick<StockSessionReceipt, 'operationId'>, includeStock = false) {
  await Promise.allSettled([
    includeStock ? bumpVersions(env, ['products', 'stock']) : bumpVersion(env, 'products'),
    broadcast(env, 'products', { action: 'update' }),
    broadcast(env, 'inventory', { action: 'stock_session', id: receipt.operationId }),
  ])
}

// Postimages and retained revisions are captured by ONE statement INSIDE the
// transaction, after all receipt writes and triggers. Never infer revision
// increments, or read a postimage after the receipt has already committed.
const REPLAY_TABLES = {
  products: ['products', 'id IN (SELECT product_id FROM m)'],
  batches: ['product_batches', 'id IN (SELECT batch_id FROM m)'],
  branchStock: ['branch_stock', 'product_id IN (SELECT product_id FROM m)'],
  branchBatchStock: ['branch_batch_stock', 'batch_id IN (SELECT batch_id FROM m)'],
  images: ['product_images', 'product_id IN (SELECT product_id FROM m WHERE product_created=1)'],
  members: ['stock_session_members', 'operation_id=@id'],
  movements: ['inventory_movements', 'id IN (SELECT movement_id FROM m)'],
} as const

// Migration 0154 enforces the parent/child active-stock invariant at every
// statement boundary inside a D1 batch. Undo must remove positive lot stock
// before deactivating a newly retained lot; redo must reactivate the saved lot
// metadata before restoring that stock. Keep the remaining dependency order
// explicit as well so replay stays valid if these tables gain similar guards.
const REPLAY_MUTATION_ORDER = {
  undo: ['branchBatchStock', 'branchStock', 'batches', 'products'],
  redo: ['products', 'batches', 'branchStock', 'branchBatchStock'],
} as const

// Display-only branch labels (0236) that replay neither compares nor restores. A column that arrives
// after a postimage was captured must not change the postimage's meaning, or every older session
// refuses Undo with "stock changed" (the same trap members.branch_name hit in 0226). A label is never
// stock, so replay leaves it out of the compared state and never writes it: the retained lot below keeps
// its label through Undo and Redo (a later receipt that reuses the lot writes both id and label again).
const REPLAY_DISPLAY_ONLY_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  batches: ['received_branch_name'],
  movements: ['addressed_branch_name'],
}

// Revision families replay does NOT compare. A branch's revision (0124 trigger stock_revision_branches_update)
// moves on ANY edit of the branches row: the 0229 role/canonical_key backfill, a rename, an owner editing the
// phone number. None of those changes what Undo of a stock session writes (products, lots, branch and lot stock
// and movements, all compared on their own), so a compared 'branch' revision turned every earlier session at
// that branch into an Undo that could only fail with the generic "Stock changed". What a branch change CAN
// invalidate is the branch being switched off: replay asserts that directly (is_active) instead. Older
// snapshots carry 'branch' entries; they are filtered out of the saved state below so those sessions compare
// on the same footing as new ones. The commit path's own same-request branch guard is unchanged.
const REPLAY_UNCOMPARED_REVISION_TYPES = ['branch'] as const
const REPLAY_UNCOMPARED_REVISION_SQL = REPLAY_UNCOMPARED_REVISION_TYPES.map(type => `'${type}'`).join(',')

// The saved `expected` state without the uncompared revision families. json_each keeps array order and number
// text, so a snapshot that never had such entries compares byte-for-byte as before.
const REPLAY_EXPECTED_SQL = `(SELECT json_set(json_extract(payload_json,'$.expected'),'$.revisions',
  json((SELECT json_group_array(json(rev.value)) FROM json_each(json_extract(payload_json,'$.expected'),'$.revisions') rev
    WHERE json_extract(rev.value,'$.entity_type') NOT IN (${REPLAY_UNCOMPARED_REVISION_SQL}))))
  FROM undo_snapshots WHERE id=@snapshotId)`

async function stockReplayStateSql(env: Env, memberBranchNamesCaptured = true, db = getDb(env)): Promise<string> {
  const fields: string[] = []
  for (const [key, [table, where]] of Object.entries(REPLAY_TABLES)) {
    const displayOnly = REPLAY_DISPLAY_ONLY_COLUMNS[key] ?? []
    const columns = [...((await sessionColumns(env, db)).get(table) as Set<string>)]
      .filter(column => memberBranchNamesCaptured || key !== 'members' || column !== 'branch_name')
      .filter(column => !displayOnly.includes(column)).sort()
    // Keep each json_object below SQLite's older function-argument ceiling.
    let row = "json('{}')"
    for (let i = 0; i < columns.length; i += 40) row = `json_set(${row},${columns.slice(i, i + 40).map(c => `'$.${c}',t."${c}"`).join(',')})`
    fields.push(`'${key}',json((SELECT json_group_array(json(r)) FROM
      (SELECT ${row} r FROM ${table} t WHERE ${where} ORDER BY ${key === 'members' ? 'line_id' : 'id'} LIMIT 101)))`)
  }
  return `(WITH m AS (SELECT * FROM stock_session_members WHERE operation_id=@id),
    revision_sources(groups_json) AS (
      SELECT json_object(
        'products',json((SELECT json_group_array(json_object('entity_type','product','entity_key',CAST(product_id AS TEXT))) FROM m)),
        'batches',json((SELECT json_group_array(json_object('entity_type','batch','entity_key',CAST(batch_id AS TEXT))) FROM m WHERE batch_id IS NOT NULL)),
        'branches',json((SELECT json_group_array(json_object('entity_type','branch','entity_key',CAST(branch_id AS TEXT))) FROM m)),
        'suppliers',json((SELECT json_group_array(json_object('entity_type','supplier','entity_key',CAST(supplier_id AS TEXT))) FROM product_batches WHERE id IN (SELECT batch_id FROM m) AND supplier_id IS NOT NULL)),
        'branchStock',json((SELECT json_group_array(json_object('entity_type','branch_stock','entity_key',CAST(product_id AS TEXT)||':'||branch_id)) FROM branch_stock WHERE product_id IN (SELECT product_id FROM m))),
        'branchBatchStock',json((SELECT json_group_array(json_object('entity_type','branch_batch_stock','entity_key',CAST(batch_id AS TEXT)||':'||branch_id)) FROM branch_batch_stock WHERE batch_id IN (SELECT batch_id FROM m))),
        'batchIdentities',json((SELECT json_group_array(json_object('entity_type','batch_identity','entity_key',CAST(variant_product_id AS TEXT)||':'||batch_key)) FROM product_batches WHERE id IN (SELECT batch_id FROM m))),
        'productImages',json((SELECT json_group_array(json_object('entity_type','product_image','entity_key',CAST(id AS TEXT))) FROM product_images WHERE product_id IN (SELECT product_id FROM m WHERE product_created=1))),
        'assets',json((SELECT json_group_array(json_object('entity_type','asset','entity_key',CAST(id AS TEXT))) FROM file_assets WHERE
          public_path IN (SELECT image_path FROM product_images WHERE product_id IN (SELECT product_id FROM m WHERE product_created=1))
          OR public_path IN (SELECT image_path FROM products WHERE id IN (SELECT product_id FROM m WHERE product_created=1)))),
        'prior',json(COALESCE(CAST((SELECT json_extract(payload_json,'$.after.revisions') FROM undo_snapshots
          WHERE id=(SELECT snapshot_id FROM stock_session_operations WHERE id=@id)) AS TEXT),'[]'))
      )
    ), wanted(entity_type,entity_key) AS (
      SELECT DISTINCT json_extract(item.value,'$.entity_type'),json_extract(item.value,'$.entity_key')
      FROM revision_sources sources
      JOIN json_each(sources.groups_json) source
      JOIN json_each(source.value) item
      WHERE json_extract(item.value,'$.entity_type') NOT IN (${REPLAY_UNCOMPARED_REVISION_SQL})
    ) SELECT json_object(${fields.join(',')},
      'revisions',json((SELECT json_group_array(json_object('entity_type',entity_type,'entity_key',entity_key,'revision',revision)) FROM
        (SELECT w.entity_type,w.entity_key,COALESCE(r.revision,0) revision FROM wanted w LEFT JOIN stock_session_revisions r
         ON r.entity_type=w.entity_type AND r.entity_key=w.entity_key ORDER BY w.entity_type,w.entity_key LIMIT 501))),
      'references',json_object(
        'sales',(SELECT COUNT(*) FROM sale_items WHERE product_id IN (SELECT product_id FROM m)),
        'returns',(SELECT COUNT(*) FROM return_items WHERE product_id IN (SELECT product_id FROM m)),
        'movements',(SELECT COUNT(*) FROM inventory_movements WHERE product_id IN (SELECT product_id FROM m)),
        'lots',(SELECT COUNT(*) FROM product_batches WHERE variant_product_id IN (SELECT product_id FROM m)),
        'allocations',(SELECT COUNT(*) FROM sale_item_batch_allocations WHERE batch_id IN (SELECT batch_id FROM m)),
        'returnAllocations',(SELECT COUNT(*) FROM return_item_batch_allocations WHERE batch_id IN (SELECT batch_id FROM m)),
        'damaged',(SELECT COUNT(*) FROM damaged_stock_lots WHERE product_id IN (SELECT product_id FROM m)),
        'rfid',(SELECT COUNT(*) FROM rfid_tags WHERE product_id IN (SELECT product_id FROM m)),
        'rfidEvents',(SELECT COUNT(*) FROM rfid_events WHERE product_id IN (SELECT product_id FROM m)),
        'rfidSessionItems',(SELECT COUNT(*) FROM rfid_session_items WHERE product_id IN (SELECT product_id FROM m)),
        'replacements',(SELECT COUNT(*) FROM return_replacement_items WHERE product_id IN (SELECT product_id FROM m)),
        'transfers',(SELECT COUNT(*) FROM stock_transfers WHERE product_id IN (SELECT product_id FROM m)),
        'rowMoves',(SELECT COUNT(*) FROM stock_row_moves WHERE source_product_id IN (SELECT product_id FROM m) OR destination_product_id IN (SELECT product_id FROM m))
      )))`
}

function captureReplayState(id: string, stateSql: string, initial = false): StockWriteStatement[] {
  const field = initial ? 'after' : 'expected'
  return [
    { sql: `UPDATE undo_snapshots SET payload_json=json_set(payload_json,'$.${field}',json(${stateSql}))
      WHERE id=(SELECT snapshot_id FROM stock_session_operations WHERE id=@id)`, params: { id } },
    ...(initial ? [{ sql: `UPDATE undo_snapshots SET payload_json=json_set(payload_json,'$.expected',json_extract(payload_json,'$.after'))
      WHERE id=(SELECT snapshot_id FROM stock_session_operations WHERE id=@id)`, params: { id } }] : []),
    assertion(`EXISTS(SELECT 1 FROM undo_snapshots WHERE id=(SELECT snapshot_id FROM stock_session_operations WHERE id=@id)
      AND length(CAST(payload_json AS BLOB))<=@bytes
      AND ${Object.keys(REPLAY_TABLES).map(key => `json_array_length(payload_json,'$.${field}.${key}')<=100`).join(' AND ')}
      AND json_array_length(payload_json,'$.${field}.revisions')<=500)`, { id, bytes: STOCK_SESSION_MAX_SNAPSHOT_BYTES }),
    { sql: 'DELETE FROM stock_session_guards', params: {} },
  ]
}

// ---- REVERT-SET: what a session Undo/Redo pins, and what it moves by delta.
type ReplayKey = keyof typeof REPLAY_TABLES

// Quantities move by the session's recorded change; derived figures are
// re-derived; neither is compared. updated_at moves with every sale.
const REPLAY_UNPINNED_COLUMNS: Record<'products' | 'batches', ReadonlySet<string>> = {
  products: new Set(['id', 'stock_quantity', 'rfid_confirmed_qty', 'updated_at', 'cost_price_usd', 'cost_price_khr', 'purchase_price_usd', 'purchase_price_khr']),
  batches: new Set(['id', 'received_quantity', 'received_cost_usd', 'updated_at', 'is_active']),
}
const PRODUCT_DERIVED_COST_COLUMNS = ['cost_price_usd', 'cost_price_khr', 'purchase_price_usd', 'purchase_price_khr'] as const
// The attribution a lot the session created loses once nothing received remains on it.
const BATCH_ATTRIBUTION_COLUMNS = ['supplier_id', 'supplier_name', 'unit_cost_usd', 'payment_status', 'credit_due_date', 'received_branch_id', 'expiry_date', 'notes'] as const
// Revisions of the images and files of the products the session created. The
// product / lot / batch_identity / branch-stock / branch / supplier revisions
// move with every sale, delivery or rename (0124's batch_identity trigger fires
// on ANY lot update) and are not the session's; a lot moved to another product
// is refused by MEMBER_LOT_MOVED_SQL, and a lot the session created has its
// batch_key pinned with its other written columns.
const REPLAY_PINNED_REVISION_TYPES = ['product_image', 'asset'] as const

function sameReplayValue(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a == null && b == null
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9
  return JSON.stringify(a) === JSON.stringify(b)
}

/** The columns of a product/lot row that the session itself wrote (all of them on a row it created). */
function sessionWrittenColumns(key: 'products' | 'batches', row: Row, original: Row | undefined): string[] {
  return Object.keys(row).filter(c => !REPLAY_UNPINNED_COLUMNS[key].has(c) && (!original || !sameReplayValue(original[c], row[c])))
}

/** The part of a replay-state JSON that must be exactly as the session left it. */
function pinnedReplayState(x: string): string {
  return `json_object('images',json_extract(${x},'$.images'),'members',json_extract(${x},'$.members'),'movements',json_extract(${x},'$.movements'),
    'revisions',(SELECT json_group_array(json(rv.value)) FROM json_each(${x},'$.revisions') rv
      WHERE json_extract(rv.value,'$.entity_type') IN (${REPLAY_PINNED_REVISION_TYPES.map(t => `'${t}'`).join(',')})))`
}

// A member line reverted on its own in Stock Changes (an open revert chain):
// its units are already out, and stockRevert.ts refuses the opposite order.
const MEMBER_REVERTED_SQL = `EXISTS(SELECT 1 FROM stock_session_members sm JOIN inventory_movements mv ON mv.id=sm.movement_id
  WHERE sm.operation_id=@id AND ${revertChainOpenSql('mv')})`
// A member line with an applied edit (lib/stockInLineEdit.ts) holds more or
// less than it received; undo the edit first.
const MEMBER_EDITED_SQL = `EXISTS(SELECT 1 FROM stock_lot_adjustment_operations e JOIN stock_session_members sm
  ON sm.movement_id=json_extract(e.request_json,'$.movementId') WHERE sm.operation_id=@id AND e.state='applied'
  AND json_extract(e.request_json,'$.kind')='stock_in_line_edit')`
const MEMBER_LOT_MOVED_SQL = `EXISTS(SELECT 1 FROM stock_session_members sm JOIN product_batches b ON b.id=sm.batch_id
  WHERE sm.operation_id=@id AND b.variant_product_id<>sm.product_id)`

export async function replayStockSession(env: Env, user: SessionUser, direction: 'undo' | 'redo', historyId: number,
  generation: unknown, payload: Row, queryBudget?: StockSessionQueryBudget): Promise<void> {
  if (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 0) fail('expected_generation must be a nonnegative JSON integer.', 400)
  const execution = sessionBudgetDb(env, queryBudget)
  const db = execution.db
  const op = await db.prepare(`SELECT o.*,s.kind,s.payload_json,h.status FROM stock_session_operations o
    JOIN undo_snapshots s ON s.id=o.snapshot_id JOIN action_history h ON h.id=o.history_id WHERE o.history_id=@history`)
    .get<Row>({ history: historyId })
  if (!op || op.id !== payload.operation_id || op.snapshot_id !== payload.snapshot_id || op.kind !== STOCK_SESSION_KIND) fail('Stock session history does not match its operation.')
  const snapshot = JSON.parse(String(op.payload_json)) as Row
  const request = snapshot.request as StockSessionRequest
  if (request.items.some(line => line.quantity > 0) && getActionTier(user, 'inventory', 'adjust') !== 'full') fail('Inventory adjust permission is required.', 403)
  if (request.items.some(line => line.kind === 'create_receive') && getActionTier(user, 'products', 'add') !== 'full') fail('Product add permission is required to reverse this session.', 403)
  if (stockSessionChangesProductImages(request) && getActionTier(user, 'products', 'image') !== 'full') fail('Product image permission is required to reverse this session.', 403)
  const targetStatus = direction === 'undo' ? 'redoable' : 'undoable'
  const expectedStatus = direction === 'undo' ? 'undoable' : 'redoable'
  if (Number(op.generation) === generation + 1 && op.status === targetStatus) return
  if (Number(op.generation) !== generation || op.status !== expectedStatus || generation % 2 !== (direction === 'undo' ? 0 : 1)) fail('Stock session generation changed. Refresh history.')
  if (snapshot.version !== 2 || !snapshot.after || !snapshot.expected) fail('This older session has no authoritative postimage and cannot be safely reversed.')
  execution.begin()
  const members = await db.prepare('SELECT * FROM stock_session_members WHERE operation_id=@id ORDER BY line_id').all<Row>({ id: op.id })
  if (members.length !== request.items.length || members.length > STOCK_SESSION_MAX_LINES) fail('Stock session members are incomplete.')
  const after = snapshot.after as Record<string, Row[]>
  const before = snapshot.before as Record<string, Row[]>
  const expectedMembers = (snapshot.expected as Record<string, Row[]>).members
  if (!Array.isArray(expectedMembers) || expectedMembers.length !== members.length) fail('Stock session member postimages are incomplete.')
  const memberBranchNamesCaptured = expectedMembers.some(row => Object.prototype.hasOwnProperty.call(row, 'branch_name'))
  if (memberBranchNamesCaptured && expectedMembers.some(row => !Object.prototype.hasOwnProperty.call(row, 'branch_name'))) fail('Stock session member postimages have inconsistent branch labels.')
  // Pre-0226 postimages omit this display field; replay never rewrites member labels.
  const stateSql = await stockReplayStateSql(env, memberBranchNamesCaptured, db)
  // REVERT-SET (owner, 6 Oct 2026: "Revert should fully revert, never leaves a
  // stock effect behind"; lead: an Undo is refused only when later movements
  // took the units it needs, never by exact quantity). The session's recorded
  // change is its own postimage minus its preimage: every lot, branch-stock row,
  // product total and received figure moves by exactly that, on today's rows. A
  // sale, transfer or delivery since then no longer refuses it. What stays
  // pinned to the state the session (or its last replay) left: the columns the
  // session itself wrote on products and lots, its member and movement rows,
  // the images of products it created, and the lots' identity.
  const expectedImage = snapshot.expected as Record<string, Row[]>
  const sign = direction === 'undo' ? -1 : 1
  const num = (value: unknown) => Number(value) || 0
  const originalOf = (key: ReplayKey, row: Row) => (before[key] || []).find(r => r.id === row.id)
  const expectedOf = (key: ReplayKey, row: Row) => (expectedImage[key] || []).find(r => r.id === row.id)
  const editsTable = await db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='stock_lot_adjustment_operations'").get<{ ok: number }>()
  const memberState = await db.prepare(`SELECT ${MEMBER_REVERTED_SQL} AS reverted, ${editsTable ? MEMBER_EDITED_SQL : '0'} AS edited, ${MEMBER_LOT_MOVED_SQL} AS moved`)
    .get<{ reverted: number; edited: number; moved: number }>({ id: op.id })
  if (Number(memberState?.reverted)) fail('A line of this stock-in session was reverted on its own in Stock Changes, so the session cannot be undone or redone as a whole. Revert that Revert first, or revert the other lines one by one. Nothing was changed.', 409, 'revert_session_line_reverted')
  if (Number(memberState?.edited)) fail('A line of this stock-in session was edited after it was saved. Undo that edit first. Nothing was changed.', 409, 'revert_stock_in_line_edited')
  if (Number(memberState?.moved)) fail('A received date of this session now belongs to another product (the products were merged), so it cannot be reversed here. Nothing was changed.', 409, 'revert_lot_moved')

  // The stock rows the session moved, and by how much this replay moves them back or again.
  type StockChange = { key: 'branchStock' | 'branchBatchStock'; row: Row; original: Row | undefined; change: number }
  const stockChanges: StockChange[] = []
  // Lots first, so a shortage names the received date before the branch total.
  for (const key of ['branchBatchStock', 'branchStock'] as const) {
    for (const row of after[key] || []) {
      const original = originalOf(key, row)
      const delta = num(row.quantity) - num(original?.quantity)
      if (Math.abs(delta) < 1e-9 && original) continue
      stockChanges.push({ key, row, original, change: sign * delta })
    }
  }
  const ownLast = await db.prepare(`SELECT MAX(COALESCE((SELECT MAX(id) FROM inventory_movements WHERE reference_id = o.rowid AND movement_type IN ('add', 'remove')
      AND reason LIKE 'Stock session ' || o.id || ' %'), 0), COALESCE((SELECT MAX(movement_id) FROM stock_session_members WHERE operation_id = o.id), 0)) AS last_id
    FROM stock_session_operations o WHERE o.id = @id`).get<{ last_id: number }>({ id: op.id }).catch(() => null)
  const afterMovementId = Number(ownLast?.last_id) || 0
  // Read first for a clean, named answer; the assertions below are what enforce it.
  for (const item of stockChanges) {
    if (item.change >= 0) continue
    const lot = item.key === 'branchBatchStock'
    const current = await db.prepare(lot
      ? 'SELECT COALESCE((SELECT quantity FROM branch_batch_stock WHERE batch_id=@a AND branch_id=@b),0) AS qty, (SELECT name FROM branches WHERE id=@b) AS branch'
      : 'SELECT COALESCE((SELECT quantity FROM branch_stock WHERE product_id=@a AND branch_id=@b),0) AS qty, (SELECT name FROM branches WHERE id=@b) AS branch')
      .get<{ qty: number; branch: string | null }>({ a: lot ? item.row.batch_id : item.row.product_id, b: item.row.branch_id })
    const available = num(current?.qty)
    if (available + item.change < -1e-9) {
      const productId = lot
        ? num(members.find(m => Number(m.batch_id) === Number(item.row.batch_id))?.product_id)
        : num(item.row.product_id)
      const refusal = await findConsumingBlocker(db, { productId, branchId: num(item.row.branch_id), batchId: lot ? num(item.row.batch_id) : null, afterMovementId })
      fail(lot
        ? `Cannot ${direction}: only ${available} left under this received date at ${current?.branch || 'this branch'}, ${-item.change} needed. Nothing was changed.`
        : `Cannot ${direction}: only ${available} in stock at ${current?.branch || 'this branch'}, ${-item.change} needed. Nothing was changed.`,
      409, lot ? 'revert_insufficient_lot_stock' : 'revert_insufficient_branch_stock', {
        ...(refusal ? { refusal } : {}),
        params: lot ? { available, needed: -item.change } : { available, needed: -item.change, branch: String(current?.branch ?? '') },
      })
    }
  }

  const statements: StockWriteStatement[] = [
    assertion("NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance')"),
    assertion(`EXISTS(SELECT 1 FROM stock_session_operations o JOIN action_history h ON h.id=o.history_id
      JOIN undo_snapshots s ON s.id=o.snapshot_id WHERE o.id=@id AND o.history_id=@history AND o.generation=@generation
      AND h.status=@status AND s.payload_json=@snapshot)`, { id: op.id, history: historyId, generation, status: expectedStatus, snapshot: op.payload_json }),
    assertion(`NOT EXISTS(SELECT 1 FROM stock_session_members m WHERE m.operation_id=@id AND NOT EXISTS(SELECT 1 FROM branches b WHERE b.id=m.branch_id AND b.is_active=1))`, { id: op.id }),
    assertion(`NOT ${MEMBER_REVERTED_SQL}`, { id: op.id }),
    ...(editsTable ? [assertion(`NOT ${MEMBER_EDITED_SQL}`, { id: op.id })] : []),
    assertion(`NOT ${MEMBER_LOT_MOVED_SQL}`, { id: op.id }),
    // The session's own rows (members, receipt movements, images of the
    // products it created) and its lots' identity are exactly as it left them.
    assertion(`(WITH cur(x) AS (SELECT ${stateSql}) SELECT ${pinnedReplayState('cur.x')} FROM cur)
      = (SELECT ${pinnedReplayState("json_extract(payload_json,'$.expected')")} FROM undo_snapshots WHERE id=@snapshotId)`, { id: op.id, snapshotId: op.snapshot_id }),
  ]
  // The columns the session itself wrote on a product or lot are pinned to
  // the value it (or its last replay) left, and moved to the other side.
  const pinColumns = (table: string, key: 'products' | 'batches', row: Row, columns: string[]) => {
    const pinned = expectedOf(key, row)
    if (!pinned) return
    for (let i = 0; i < columns.length; i += 40) {
      const slice = columns.slice(i, i + 40)
      statements.push(assertion(`EXISTS(SELECT 1 FROM ${table} WHERE id=@rowId AND ${slice.map((c, j) => `"${c}" IS @p${j}`).join(' AND ')})`,
        { rowId: row.id, ...Object.fromEntries(slice.map((c, j) => [`p${j}`, pinned[c] ?? null])) }))
    }
  }
  for (const key of REPLAY_MUTATION_ORDER[direction]) {
    const [table] = REPLAY_TABLES[key]
    if (key === 'products' || key === 'batches') {
      for (const row of after[key]) {
        const original = originalOf(key, row)
        const created = !original
        if (key === 'products' && created && direction === 'redo') {
          // Redoing a create must not resurrect a row that is now a duplicate.
          // Same folded, cost-free identity as the create-time guard: a redo
          // blocked on a cost the operator has since corrected, or waved
          // through because someone retyped the barcode with a leading zero,
          // are both the same bug in opposite directions.
          const barcodeMatch = identityBarcodeMatchSql('barcode', row.barcode)
          statements.push(assertion(`NOT EXISTS(SELECT 1 FROM products WHERE id<>@product AND is_active=1
            ${barcodeMatch ? `AND ${barcodeMatch.sql}` : ''}
            AND LOWER(TRIM(REPLACE(REPLACE(REPLACE(name,'  ',' '),'  ',' '),'  ',' ')))=@nameKey)`, {
            ...(barcodeMatch?.params || {}), product: row.id, nameKey: normalizeProductGroupName(row.name),
          }))
        }
        const written = sessionWrittenColumns(key, row, original)
        pinColumns(table, key, row, written)
        const sets: string[] = []
        const params: Row = { rowId: row.id }
        // Undo restores the session's own columns on rows it found; a row it
        // created keeps them (identity, retained for its movements) -- only its
        // attribution is cleared once nothing received remains on it, below.
        const restore = direction === 'redo' ? row : original
        if (restore) written.forEach((c, i) => { sets.push(`"${c}"=@v${i}`); params[`v${i}`] = restore[c] ?? null })
        // Catalog cost columns are derived (re-derived after the loop, U-cost);
        // put back only what the session itself changed, as before.
        if (key === 'products' && original) {
          for (const c of PRODUCT_DERIVED_COST_COLUMNS) {
            if (Object.prototype.hasOwnProperty.call(row, c) && !sameReplayValue(original[c], row[c])) {
              sets.push(`"${c}"=@${c}`); params[c] = (direction === 'redo' ? row : original)[c] ?? null
            }
          }
        }
        if (key === 'products') {
          const change = sign * (num(row.stock_quantity) - num(original?.stock_quantity))
          if (change > 1e-9 && !created) statements.unshift(productStockGuardStatement([Number(row.id)], 'active'))
          if (Math.abs(change) > 1e-9) { sets.push('stock_quantity=COALESCE(stock_quantity,0)+@change'); params.change = change }
        } else {
          const rq = sign * (num(row.received_quantity) - num(original?.received_quantity))
          const rc = sign * (num(row.received_cost_usd) - num(original?.received_cost_usd))
          if (Math.abs(rq) > 1e-9) { sets.push('received_quantity=MAX(0,COALESCE(received_quantity,0)+@rq)'); params.rq = rq }
          if (Math.abs(rc) > 0.00005) { sets.push('received_cost_usd=MAX(0,ROUND(COALESCE(received_cost_usd,0)+@rc,4))'); params.rc = roundMoney4(rc) }
          // Migration 0154: activate before the redo puts stock back on the lot.
          if (direction === 'redo' && num(row.is_active) === 1) sets.push('is_active=1')
        }
        // The row's stamp comes back too when nothing else wrote the row since
        // the session (or its last replay) left it -- an exact round trip; a
        // row a sale or an edit touched in between is stamped now instead, so
        // an optimistic-concurrency token never moves backwards.
        params.expStamp = expectedOf(key, row)?.updated_at ?? null
        params.restoreStamp = (direction === 'redo' ? row : original)?.updated_at ?? null
        if (sets.length) statements.push({ sql: `UPDATE ${table} SET ${sets.join(',')},
          updated_at=CASE WHEN updated_at IS @expStamp THEN COALESCE(@restoreStamp,updated_at) ELSE CURRENT_TIMESTAMP END WHERE id=@rowId`, params })
        if (direction === 'undo' && key === 'products' && created) {
          // A product the session created goes inactive once it holds nothing;
          // one that has received other stock since stays (with that stock).
          statements.push({ sql: 'UPDATE products SET is_active=CASE WHEN COALESCE(stock_quantity,0)<=0 THEN 0 ELSE is_active END WHERE id=@rowId', params: { rowId: row.id } })
        }
        if (direction === 'undo' && key === 'batches') {
          // Retain the lot identity for immutable members/receipts and exact
          // redo, but once nothing received remains on a lot this session
          // created, remove the attribution that belonged to it alone: a later
          // same-date unknown-cost receipt can reuse the row and fill NULL
          // fields, and retaining A/credit would charge B's paid receipt to A.
          if (created) {
            const cleared = BATCH_ATTRIBUTION_COLUMNS.filter(c => Object.prototype.hasOwnProperty.call(row, c))
            if (cleared.length) statements.push({ sql: `UPDATE product_batches SET ${cleared.map(c => `"${c}"=CASE WHEN COALESCE(received_quantity,0)<=0 THEN NULL ELSE "${c}" END`).join(',')} WHERE id=@rowId`, params: { rowId: row.id } })
          }
          if (num(row.is_active) === 1 && num(original?.is_active) !== 1) {
            statements.push({ sql: `UPDATE product_batches SET is_active=0 WHERE id=@rowId AND COALESCE(received_quantity,0)<=0
              AND NOT EXISTS(SELECT 1 FROM branch_batch_stock WHERE batch_id=@rowId AND quantity>0)`, params: { rowId: row.id } })
          }
        }
      }
      continue
    }
    const lot = key === 'branchBatchStock'
    const natural = lot ? 'batch_id=@a AND branch_id=@b' : 'product_id=@a AND branch_id=@b'
    for (const item of stockChanges.filter(change => change.key === key)) {
      const keys = { a: lot ? item.row.batch_id : item.row.product_id, b: item.row.branch_id, change: item.change }
      if (item.change < 0) {
        statements.push(assertion(`COALESCE((SELECT quantity FROM ${table} WHERE ${natural}),0)+@change>=-0.000000001`, keys))
        statements.push({ sql: `UPDATE ${table} SET quantity=quantity+@change WHERE ${natural}`, params: keys })
      } else if (item.change > 0 || !item.original) {
        statements.push({ sql: `UPDATE ${table} SET quantity=quantity+@change WHERE ${natural}`, params: keys })
        // A row the session created comes back with its saved id (stable IDs for redo).
        const columns = Object.keys(item.row)
        statements.push({ sql: `INSERT INTO ${table}(${columns.map(c => `"${c}"`).join(',')}) SELECT ${columns.map((c, i) => c === 'quantity' ? '@change' : `@v${i}`).join(',')}
          WHERE NOT EXISTS(SELECT 1 FROM ${table} WHERE ${natural})`, params: { ...keys, ...Object.fromEntries(columns.map((c, i) => [`v${i}`, item.row[c]])) } })
      }
      // A row the session created and its undo emptied goes away, as before.
      if (direction === 'undo' && !item.original) {
        statements.push({ sql: `DELETE FROM ${table} WHERE ${natural} AND ABS(quantity)<0.000000001`, params: keys })
      }
    }
  }
  // U-cost (supervisor decision, 2026-09-25): the products image above carries
  // the cost the formula gave WHEN the snapshot was taken. Undo writes it back
  // after branchBatchStock (whose 0195 triggers already re-derived), so a lot
  // that sold out since would count again. Re-derive last; the replay-state
  // capture below records the result, so a later redo/undo still matches.
  for (const productId of new Set(members.map(m => Number(m.product_id)).filter(id => Number.isInteger(id) && id > 0))) {
    statements.push(catalogCostRecomputeIfChangedStatement(productId))
  }
  statements.push({ sql: `INSERT INTO inventory_movements(product_id,product_name,branch_id,branch_name,movement_type,quantity,unit_cost_usd,unit_cost_khr,total_cost_usd,total_cost_khr,reason,reference_id,user_id,user_name,batch_id)
    SELECT m.product_id,p.name,m.branch_id,b.name,@movement,m.quantity*@sign,original.unit_cost_usd,original.unit_cost_khr,
      CASE WHEN original.total_cost_usd IS NULL THEN NULL ELSE original.total_cost_usd*@sign END,
      CASE WHEN original.total_cost_khr IS NULL THEN NULL ELSE original.total_cost_khr*@sign END,
      @reason,o.rowid,@actor,@name,m.batch_id
    FROM stock_session_members m JOIN products p ON p.id=m.product_id JOIN branches b ON b.id=m.branch_id
      JOIN stock_session_operations o ON o.id=m.operation_id JOIN inventory_movements original ON original.id=m.movement_id
    WHERE m.operation_id=@id AND m.quantity>0`, params: { id: op.id, movement: direction === 'undo' ? 'remove' : 'add', sign: direction === 'undo' ? -1 : 1, reason: `Stock session ${op.id} ${direction} generation ${generation + 1}`, actor: user.id, name: actorSnapshot(user) } })
  statements.push({ sql: 'UPDATE stock_session_operations SET generation=generation+1 WHERE id=@id', params: { id: op.id } })
  statements.push({ sql: 'UPDATE undo_snapshots SET status=@status,updated_at=CURRENT_TIMESTAMP WHERE id=@snapshot', params: { status: direction === 'undo' ? 'reversed' : 'applied', snapshot: op.snapshot_id } })
  statements.push({ sql: `UPDATE action_history SET status=@status,last_error=NULL,updated_at=CURRENT_TIMESTAMP,
    undo_payload=json_set(undo_payload,'$.generation',@generation),redo_payload=json_set(redo_payload,'$.generation',@generation) WHERE id=@history`, params: { status: targetStatus, generation: generation + 1, history: historyId } })
  statements.push({ sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details)
    VALUES(@actor,@name,@action,'stock_session',@id,@details)`, params: { actor: user.id, name: actorSnapshot(user), action: `stock_session_${direction}`, id: op.id, details: JSON.stringify({ operationId: op.id, actionHistoryId: historyId, generation: generation + 1 }) } })
  statements.push(...captureReplayState(String(op.id), stateSql))
  checkBounds(statements, snapshot)
  try { await execution.commit(packSessionAssertions(statements)); execution.finishReads() } catch (error) {
    execution.finishReads()
    if (error instanceof StockSessionError && error.code === 'stock_session_query_budget_exceeded') throw error
    const saved = await db.prepare('SELECT o.generation,h.status FROM stock_session_operations o JOIN action_history h ON h.id=o.history_id WHERE o.id=@id').get<Row>({ id: op.id })
    if (saved?.generation === generation + 1 && saved.status === targetStatus) return
    const activeGuard = productStockGuardError(error)

    if (activeGuard) throw activeGuard

    if (/constraint/i.test(String(error))) {
      if (await movedByBranchCutover(db, String(op.id))) fail(BRANCH_CUTOVER_PRODUCT_MOVED_MESSAGE, 409, BRANCH_CUTOVER_PRODUCT_MOVED_CODE)
      // RET-D: name the newest stock change on one of the session's product +
      // branch pairs since the session's own rows (its receipts and every
      // undo/redo generation, all stamped with its rowid). A metadata-only
      // change has no movement; the sentence then stands on its own.
      const own = await db.prepare(`SELECT
          MAX(COALESCE((SELECT MAX(id) FROM inventory_movements WHERE reference_id = o.rowid AND movement_type IN ('add', 'remove')
              AND reason LIKE 'Stock session ' || o.id || ' %'), 0),
            COALESCE((SELECT MAX(movement_id) FROM stock_session_members WHERE operation_id = o.id), 0)) AS last_id
        FROM stock_session_operations o WHERE o.id = @id`).get<{ last_id: number }>({ id: op.id }).catch(() => null)
      const pairs = [...new Map(members.map((m) => [`${m.product_id}:${m.branch_id}`, { productId: Number(m.product_id), branchId: Number(m.branch_id) }])).values()]
      const refusal = own ? await findLaterChangeBlocker(db, { pairs, afterMovementId: Number(own.last_id) || 0 }) : null
      fail('Stock, metadata, references, or revision changed. Nothing was reversed; refresh history.', 409, 'stock_session_rejected', refusal ? { refusal } : undefined)
    }
    throw error
  }
}

// The branch consolidation merged Shop's stock into LC Store with one official transfer per product. A session
// that received or counted one of those products no longer owns the balances it wrote: Undo would take its
// quantity out of a merged total. That Undo stays refused, but with the cutover's own code (the client restates it
// in the operator's language), never the generic "Stock changed". The marker is lib/branchCutoverHistory.ts's
// UNDO_CLOSED_BRANCH_CUTOVER_MOVE, restated because this module's harnesses wire imports by name (the
// cutover test pins it equal). Read only on the refusal path: no index serves it, and it never runs for an
// Undo that succeeds.
const BRANCH_CUTOVER_MOVE_MARKER = 'undo_closed:branch_cutover_move'
export const BRANCH_CUTOVER_PRODUCT_MOVED_CODE = 'undo_closed_branch_cutover_product_moved'
// The English of the packs' undo_refused_closed_branch_cutover_product_moved key, word for word (pinned by
// scripts/test-cutover-li-pack-parity-pure.cjs). Name-free: the branch names are data, and "consolidation" is the one word for the event.
export const BRANCH_CUTOVER_PRODUCT_MOVED_MESSAGE = "Undo closed: this product's stock was moved to the active branch by the branch consolidation after this was recorded. Make a new change instead. Nothing was changed."
async function movedByBranchCutover(db: D1Compat, operationId: string): Promise<boolean> {
  const row = await db.prepare(`SELECT 1 AS moved FROM stock_session_members m
    JOIN stock_transfers st ON st.product_id = m.product_id
    JOIN transfer_operation_receipts r ON r.id = st.receipt_id
    JOIN action_history h ON h.id = r.action_history_id
    WHERE m.operation_id = @id AND h.last_error = @marker LIMIT 1`).get<Row>({ id: operationId, marker: BRANCH_CUTOVER_MOVE_MARKER })
  return Boolean(row)
}
