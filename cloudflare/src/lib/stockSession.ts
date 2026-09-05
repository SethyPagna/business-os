import { getDb, type D1Compat } from './db'
import type { Env } from '../index'
import type { SessionUser } from './auth'
import { getActionTier, isAdminControlUser } from './permissions'
import { dateToBatchCode, normalizeToIsoDate } from './batchCode'
import { normalizeProductGroupName } from './productDetailRule'
import { planReceiveBatchStock, type StockWriteStatement } from './productBatches'
import { normalizeMultiValue, planInsertRow, tableColumns, validateProductImageGallery } from './productWrites'
import { sanitizeMediaPath } from './media'
import { ADMIN_MAX_IMAGES_PER_PRODUCT, MAX_IMAGES_PER_PRODUCT } from './importImageMatch'
import { buildInClause, chunkForBinding, D1_MAX_BOUND_PARAMS } from './sqlBinding'
import { bumpVersion } from './cache'
import { broadcast } from '../durable-objects/broadcastHub'

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
  'unit_cost_usd', 'payment_status', 'credit_due_date', 'brand',
] as const
const ITEM_FIELDS = [
  'line_id', 'kind', 'product_id', 'product', 'batch_id', 'branch_id', 'quantity',
  'supplier_id', 'supplier_name', 'received_date', 'expiry_date', 'notes',
  'unit_cost_usd', 'payment_status', 'credit_due_date',
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
  unit_cost_usd: number | null
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
}

// Action history must use the same permission union as the authoritative
// replay below. Missing/invalid inventory metadata is deliberately treated as
// requiring inventory adjust so every pre-zero-stock receipt remains gated by
// the legacy permission contract.
export function canReplayStockSessionPayload(user: SessionUser, payload: Record<string, unknown>): boolean {
  if (payload.requires_inventory_adjust !== 0 && getActionTier(user, 'inventory', 'adjust') !== 'full') return false
  if (Number(payload.requires_product_add) === 1 && getActionTier(user, 'products', 'add') !== 'full') return false
  return true
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
  const normalized = normalizeToIsoDate(String(value))
  if (!normalized) fail(`${field} must be a valid date.`, 400, 'invalid_request')
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
    return {
      line_id: line.line_id,
      kind,
      product_id: productId,
      product,
      batch_id: batchId,
      branch_id: branchId,
      quantity,
      supplier_id: integer(expanded('supplier_id'), 'supplier_id', true),
      supplier_name: text(expanded('supplier_name'), 'supplier_name', 240),
      received_date: receivedDate,
      expiry_date: date(expanded('expiry_date'), 'expiry_date'),
      notes: text(expanded('notes'), 'notes', 1000),
      unit_cost_usd: finite(expanded('unit_cost_usd') ?? product?.cost_price_usd, 'unit_cost_usd', true),
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

async function rowsIn<T>(db: D1Compat, values: readonly unknown[], column: string, select: string): Promise<T[]> {
  const unique = [...new Set(values)]
  const rows: T[] = []
  for (const chunk of chunkForBinding(unique, 0)) {
    const { sql, params } = buildInClause('value', chunk)
    rows.push(...await db.prepare(`${select} WHERE ${column} IN (${sql})`).all<T>(params))
  }
  return rows
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
        OR (t.batch IS NULL AND pb.batch_key=t.batch_key))
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

export async function commitStockSession(env: Env, user: SessionUser, raw: unknown): Promise<StockSessionReceipt> {
  const request = parseRequest(raw, isAdminControlUser(user) ? ADMIN_MAX_IMAGES_PER_PRODUCT : MAX_IMAGES_PER_PRODUCT)
  const requiresInventoryAdjust = request.items.some((line) => line.quantity > 0)
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
  const db = getDb(env)
  const canonical = JSON.stringify(request)
  const previous = await db.prepare('SELECT request_json,receipt_json FROM stock_session_operations WHERE actor_id=@actor AND request_id=@request')
    .get<Row>({ actor: user.id, request: request.client_request_id })
  if (previous) {
    if (previous.request_json !== canonical) fail('client_request_id was already used with different data.', 409, 'idempotency_conflict')
    return parseStoredReceipt(previous, true)
  }

  const receiveIds = request.items.flatMap((line) => line.product_id == null ? [] : [line.product_id])
  const branchIds = request.items.map((line) => line.branch_id)
  const supplierIds = request.items.flatMap((line) => line.supplier_id == null ? [] : [line.supplier_id])
  const explicitBatchIds = request.items.flatMap((line) => line.batch_id == null ? [] : [line.batch_id])
  const beforeFence = await snapshotFence(db, request)
  const products = await rowsIn<Row>(db, receiveIds, 'id', 'SELECT * FROM products')
  const branches = await rowsIn<Row>(db, branchIds, 'id', 'SELECT * FROM branches')
  const suppliers = await rowsIn<Row>(db, supplierIds, 'id', 'SELECT * FROM suppliers')
  const explicitBatches = await rowsIn<Row>(db, explicitBatchIds, 'id', 'SELECT * FROM product_batches')
  const receiveProducts = new Map(products.map((row) => [Number(row.id), row]))
  const branchMap = new Map(branches.map((row) => [Number(row.id), row]))
  const supplierMap = new Map(suppliers.map((row) => [Number(row.id), row]))
  const explicitBatchMap = new Map(explicitBatches.map((row) => [Number(row.id), row]))

  for (const id of receiveIds) {
    const product = receiveProducts.get(id)
    if (!product || Number(product.is_active) !== 1) fail(`Product ${id} was not found or is inactive.`, 404, 'product_not_found')
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
      if (!batch || Number(batch.variant_product_id) !== line.product_id) fail(`Batch ${line.batch_id} does not belong to product ${line.product_id}.`, 409, 'batch_mismatch')
    }
  }

  const dateBatchLines = request.items.filter((line) => line.kind === 'receive' && line.batch_id == null)
  const possibleDateBatches = await rowsIn<Row>(db, dateBatchLines.map((line) => line.product_id as number), 'variant_product_id', 'SELECT * FROM product_batches')
  const dateBatchMap = new Map(possibleDateBatches.map((row) => [`${row.variant_product_id}:${row.batch_key}`, row]))
  const relevantBatches = [...explicitBatches]
  for (const line of dateBatchLines) {
    const key = `${line.product_id}:${receivedBatchKey(line.received_date)}`
    const batch = dateBatchMap.get(key)
    if (batch && !relevantBatches.some((row) => row.id === batch.id)) relevantBatches.push(batch)
  }

  const productColumns = request.items.some((line) => line.kind === 'create_receive') ? await tableColumns(env, 'products') : new Set<string>()
  const createLines = request.items.filter((line) => line.kind === 'create_receive')
  const stockCreateLines = createLines.filter((line) => line.quantity > 0)
  const activeBranches = stockCreateLines.length ? await db.prepare('SELECT id FROM branches WHERE is_active=1 ORDER BY id').all<Row>() : []
  const identityKeys = new Set<string>()
  for (const line of createLines) {
    const product = line.product as CanonicalProduct
    const key = `${normalizeProductGroupName(product.name)}\u0001${String(product.barcode || '').trim().toLowerCase()}\u0001${Math.round((Number(product.cost_price_usd) || 0) * 100)}\u0001${Math.round((Number(product.cost_price_khr) || 0) * 100)}`
    if (identityKeys.has(key)) fail('Two create_receive lines describe the same product identity.', 409, 'duplicate_product')
    identityKeys.add(key)
  }
  let duplicateCandidates: Row[] = []
  if (createLines.length) {
    const names = [...new Set(createLines.map((line) => normalizeProductGroupName(line.product?.name)))]
    const { sql, params } = buildInClause('name', names)
    duplicateCandidates = await db.prepare(`SELECT id,name,barcode,cost_price_usd,cost_price_khr FROM products WHERE is_active=1 AND LOWER(TRIM(REPLACE(REPLACE(REPLACE(name,'  ',' '),'  ',' '),'  ',' '))) IN (${sql})`).all<Row>(params)
    for (const line of createLines) {
      const product = line.product as CanonicalProduct
      const duplicate = duplicateCandidates.find((row) =>
        normalizeProductGroupName(row.name) === normalizeProductGroupName(product.name)
        && String(row.barcode || '').trim().toLowerCase() === String(product.barcode || '').trim().toLowerCase()
        && Math.round((Number(row.cost_price_usd) || 0) * 100) === Math.round((Number(product.cost_price_usd) || 0) * 100)
        && Math.round((Number(row.cost_price_khr) || 0) * 100) === Math.round((Number(product.cost_price_khr) || 0) * 100))
      if (duplicate) fail(`"${duplicate.name}" already exists with this barcode and cost.`, 409, 'duplicate_product', { duplicate })
    }
  }

  const imagePaths = [...new Set(createLines.flatMap((line) => {
    const gallery = (line.product?.image_gallery as string[] | undefined) || []
    const primary = String(line.product?.image_path || '')
    return primary ? [primary, ...gallery] : gallery
  }))]
  const galleryLinkCount = createLines.reduce((count, line) => count + (((line.product?.image_gallery as string[] | undefined) || []).length), 0)
  if (galleryLinkCount > STOCK_SESSION_MAX_GALLERY_LINKS) fail(`A stock session can link at most ${STOCK_SESSION_MAX_GALLERY_LINKS} product images.`, 400, 'child_row_limit')
  const assets = await rowsIn<Row>(db, imagePaths, 'public_path', 'SELECT id,public_path FROM file_assets')
  const assetByPath = new Map(assets.map((row) => [String(row.public_path), row]))
  const missingAsset = imagePaths.find((path) => !assetByPath.has(path))
  if (missingAsset) fail(`Image asset ${missingAsset} does not exist.`, 409, 'missing_image_asset')

  const existingProductIds = [...new Set(receiveIds)]
  const existingBatchIds = relevantBatches.map((row) => Number(row.id))
  const branchStocks = existingProductIds.length && branchIds.length
    ? await db.prepare(`SELECT * FROM branch_stock WHERE product_id IN (${buildInClause('product', existingProductIds).sql}) AND branch_id IN (${buildInClause('branch', [...new Set(branchIds)]).sql})`)
      .all<Row>({ ...buildInClause('product', existingProductIds).params, ...buildInClause('branch', [...new Set(branchIds)]).params })
      .then((rows) => rows.filter((row) => request.items.some((line) => line.product_id === row.product_id && line.branch_id === row.branch_id)))
    : []
  const batchStocks = existingBatchIds.length && branchIds.length
    ? await db.prepare(`SELECT * FROM branch_batch_stock WHERE batch_id IN (${buildInClause('batch', existingBatchIds).sql}) AND branch_id IN (${buildInClause('branch', [...new Set(branchIds)]).sql})`)
      .all<Row>({ ...buildInClause('batch', existingBatchIds).params, ...buildInClause('branch', [...new Set(branchIds)]).params })
      .then((rows) => rows.filter((row) => request.items.some((line) => {
        const batch = line.batch_id != null ? explicitBatchMap.get(line.batch_id) : dateBatchMap.get(`${line.product_id}:${receivedBatchKey(line.received_date)}`)
        return batch?.id === row.batch_id && line.branch_id === row.branch_id
      })))
    : []
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
    const batchKey = explicit ? String(explicit.batch_key) : receivedBatchKey(line.received_date)
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
  const stamp = new Date().toISOString()
  const snapshot: Row = {
    version: 2,
    operationId,
    request,
    before: { products, batches: relevantBatches, branchStock: branchStocks, branchBatchStock: batchStocks, activeBranches },
    revisions: Object.fromEntries(revisions),
  }
  const statements: StockWriteStatement[] = [
    assertion("NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')"),
  ]
  for (const row of products) statements.push(revisionAssertion('product', String(row.id), 'EXISTS(SELECT 1 FROM products WHERE id=@id AND is_active=1)', { id: row.id }, rev('product', row.id)))
  for (const row of branches) statements.push(revisionAssertion('branch', String(row.id), 'EXISTS(SELECT 1 FROM branches WHERE id=@id AND is_active=1)', { id: row.id }, rev('branch', row.id)))
  for (const row of suppliers) statements.push(revisionAssertion('supplier', String(row.id), 'EXISTS(SELECT 1 FROM suppliers WHERE id=@id)', { id: row.id }, rev('supplier', row.id)))
  for (const row of assets) statements.push(revisionAssertion('asset', String(row.id), 'EXISTS(SELECT 1 FROM file_assets WHERE id=@id AND public_path=@path)', { id: row.id, path: row.public_path }, rev('asset', row.id)))
  for (const row of relevantBatches) statements.push(revisionAssertion('batch', String(row.id), 'EXISTS(SELECT 1 FROM product_batches WHERE id=@id AND variant_product_id=@product AND batch_key=@batchKey)', { id: row.id, product: row.variant_product_id, batchKey: row.batch_key }, rev('batch', row.id)))
  for (const line of request.items.filter((item) => item.kind === 'receive')) {
    const explicit = line.batch_id == null ? null : explicitBatchMap.get(line.batch_id)
    const targetBatchKey = explicit ? String(explicit.batch_key) : receivedBatchKey(line.received_date)
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
      const product = line.product as CanonicalProduct
      statements.push(assertion(`NOT EXISTS(SELECT 1 FROM products WHERE is_active=1
        AND LOWER(TRIM(COALESCE(barcode,'')))=LOWER(@barcode)
        AND LOWER(TRIM(REPLACE(REPLACE(REPLACE(name,'  ',' '),'  ',' '),'  ',' ')))=@nameKey
        AND ROUND(COALESCE(cost_price_usd,0)*100)=@costUsd
        AND ROUND(COALESCE(cost_price_khr,0)*100)=@costKhr)`, {
        barcode: String(product.barcode || '').trim(), nameKey: normalizeProductGroupName(product.name),
        costUsd: Math.round((Number(product.cost_price_usd) || 0) * 100),
        costKhr: Math.round((Number(product.cost_price_khr) || 0) * 100),
      }))
    }
  }
  statements.push({ sql: 'INSERT INTO stock_session_operations(id,actor_id,request_id,mode,request_json) VALUES(@id,@actor,@request,\'stock_in\',@canonical)', params: { id: operationId, actor: user.id, request: request.client_request_id, canonical } })
  statements.push({ sql: 'INSERT INTO undo_snapshots(kind,payload_json,created_by_id,created_by_name) VALUES(@kind,@payload,@actor,@name)', params: { kind: STOCK_SESSION_KIND, payload: JSON.stringify(snapshot), actor: user.id, name: user.name } })
  statements.push({ sql: 'UPDATE stock_session_operations SET snapshot_id=last_insert_rowid() WHERE id=@id', params: { id: operationId } })
  statements.push({ sql: `INSERT INTO action_history(scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_id,created_by_name)
    SELECT 'global','stock_session',id,@label,1,'undoable',json_object('applier',@kind,'snapshot_id',snapshot_id,'operation_id',id,'generation',0,'requires_product_add',@creates,'requires_inventory_adjust',@adjusts,'snapshot_version',2),json_object('applier',@kind,'snapshot_id',snapshot_id,'operation_id',id,'generation',0,'requires_product_add',@creates,'requires_inventory_adjust',@adjusts,'snapshot_version',2),@actor,@name
    FROM stock_session_operations WHERE id=@id`, params: { id: operationId, label: `${request.items.length} stock-in line${request.items.length === 1 ? '' : 's'}`, kind: STOCK_SESSION_KIND, actor: user.id, name: user.name, creates: createLines.length ? 1 : 0, adjusts: requiresInventoryAdjust ? 1 : 0 } })
  statements.push({ sql: 'UPDATE stock_session_operations SET history_id=last_insert_rowid() WHERE id=@id', params: { id: operationId } })

  for (const line of request.items) {
    const productRequestId = line.kind === 'create_receive' ? `stock-session:${operationId}:${line.line_id}` : null
    if (line.kind === 'create_receive') {
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
      statements.push({ sql: `INSERT INTO stock_session_members(operation_id,line_id,command_kind,product_id,product_created,branch_id,batch_id,movement_id,quantity,unit_cost_usd)
        SELECT @operationId,@lineId,@kind,id,1,@branchId,NULL,NULL,0,@unitCostUsd FROM products WHERE client_request_id=@productRequestId`,
      params: { operationId, lineId: line.line_id, kind: line.kind, branchId: line.branch_id, unitCostUsd: line.unit_cost_usd, productRequestId } })
      continue
    }
    const plan = planReceiveBatchStock({
      productId: line.product_id, productClientRequestId: productRequestId, branchId: line.branch_id,
      quantity: line.quantity, expiryDate: line.expiry_date, receivedDate: line.received_date,
      notes: line.notes, batchId: line.batch_id, supplierId: line.supplier_id,
      supplierName: line.supplier_name, unitCostUsd: line.unit_cost_usd,
      paymentStatus: line.payment_status, creditDueDate: line.credit_due_date,
    })
    statements.push(...plan.statements)
    statements.push({ sql: `INSERT INTO stock_session_members(operation_id,line_id,command_kind,product_id,product_created,branch_id,batch_id,quantity,unit_cost_usd)
      VALUES(@operationId,@lineId,@kind,${plan.productIdSql},@created,@branchId,${plan.batchIdSql},@quantity,@unitCostUsd)`, params: { ...plan.params, operationId, lineId: line.line_id, kind: line.kind, created: line.kind === 'create_receive' ? 1 : 0 } })
    // 'add' -- the ledger's canonical receipt type, the same string POST
    // /api/inventory/adjust and POST /api/batches write, and the one this
    // file's own redo path already emits below. This used to write the
    // session MODE ('stock_in') instead, so every session committed through
    // the Products page's "Add products" entry was invisible to the Stock-in
    // Sessions list, the shared-lot receipt counter and the Telegram stock-in
    // digest, all of which filter on 'add'. Rows already written under the
    // old string are covered by STOCK_RECEIPT_MOVEMENT_TYPES until migration
    // 0128 normalises them.
    statements.push({ sql: `INSERT INTO inventory_movements(product_id,product_name,branch_id,branch_name,movement_type,quantity,unit_cost_usd,unit_cost_khr,total_cost_usd,total_cost_khr,reason,reference_id,user_id,user_name,batch_id)
      SELECT m.product_id,p.name,m.branch_id,b.name,'add',m.quantity,COALESCE(m.unit_cost_usd,0),0,COALESCE(m.unit_cost_usd,0)*m.quantity,0,@reason,o.rowid,@actor,@actorName,m.batch_id
      FROM stock_session_members m JOIN products p ON p.id=m.product_id JOIN branches b ON b.id=m.branch_id JOIN stock_session_operations o ON o.id=m.operation_id
      WHERE m.operation_id=@operationId AND m.line_id=@lineId`, params: { reason: `Stock-in session ${operationId}`, actor: user.id, actorName: user.name, operationId, lineId: line.line_id } })
    statements.push({ sql: 'UPDATE stock_session_members SET movement_id=last_insert_rowid() WHERE operation_id=@operationId AND line_id=@lineId', params: { operationId, lineId: line.line_id } })
  }
  statements.push({ sql: `UPDATE stock_session_operations SET receipt_json=json_object(
      'success',json('true'),'operationId',id,'clientRequestId',request_id,'actionHistoryId',history_id,'snapshotId',snapshot_id,
      'memberCount',(SELECT COUNT(*) FROM stock_session_members WHERE operation_id=id),
      'createdCount',(SELECT COUNT(*) FROM stock_session_members WHERE operation_id=id AND product_created=1),
      'receivedCount',(SELECT COUNT(*) FROM stock_session_members WHERE operation_id=id AND command_kind='receive'),
      'totalQuantity',(SELECT COALESCE(SUM(quantity),0) FROM stock_session_members WHERE operation_id=id),
      'totalCostUsd',(SELECT COALESCE(SUM(quantity*COALESCE(unit_cost_usd,0)),0) FROM stock_session_members WHERE operation_id=id),
      'items',json((SELECT json_group_array(json(item)) FROM (SELECT json_object(
        'lineId',m.line_id,'kind',m.command_kind,'productId',m.product_id,'productName',p.name,
        'createdProduct',json(CASE m.product_created WHEN 1 THEN 'true' ELSE 'false' END),'branchId',m.branch_id,
        'batchId',m.batch_id,'batchNumber',pb.batch_number,'lotCode',pb.lot_code,'movementId',m.movement_id,
        'quantity',m.quantity,'unitCostUsd',m.unit_cost_usd) item
        FROM stock_session_members m JOIN products p ON p.id=m.product_id LEFT JOIN product_batches pb ON pb.id=m.batch_id
        WHERE m.operation_id=stock_session_operations.id ORDER BY m.line_id))))
    WHERE id=@id`, params: { id: operationId } })
  statements.push({ sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,new_value)
    SELECT @actor,@name,'stock_session_create','stock_session',id,receipt_json,'stock_session_operations',id,receipt_json
    FROM stock_session_operations WHERE id=@id`, params: { actor: user.id, name: user.name, id: operationId } })
  statements.push({ sql: 'DELETE FROM stock_session_guards', params: {} })
  const replayStateSql = await stockReplayStateSql(env)
  statements.push(...captureReplayState(operationId, replayStateSql, true))
  checkBounds(statements, snapshot)
  try {
    await db.batch(statements)
  } catch (error) {
    const retry = await db.prepare('SELECT request_json,receipt_json FROM stock_session_operations WHERE actor_id=@actor AND request_id=@request')
      .get<Row>({ actor: user.id, request: request.client_request_id })
    if (retry) {
      if (retry.request_json !== canonical) fail('client_request_id was already used with different data.', 409, 'idempotency_conflict')
      return parseStoredReceipt(retry, true)
    }
    if (/constraint/i.test(String(error))) fail('Product, branch, batch, stock, or asset state changed. Nothing was applied; refresh and retry.', 409, 'stale_state')
    throw error
  }
  const saved = await db.prepare('SELECT receipt_json FROM stock_session_operations WHERE id=@id').get<Row>({ id: operationId })
  if (!saved) throw new Error('Stock session committed without a readable receipt')
  return parseStoredReceipt(saved, false)
}

export async function notifyStockSession(env: Env, receipt: Pick<StockSessionReceipt, 'operationId'>) {
  await Promise.allSettled([
    bumpVersion(env, 'products'),
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

async function stockReplayStateSql(env: Env): Promise<string> {
  const fields: string[] = []
  for (const [key, [table, where]] of Object.entries(REPLAY_TABLES)) {
    const columns = [...await tableColumns(env, table)].sort()
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

export async function replayStockSession(env: Env, user: SessionUser, direction: 'undo' | 'redo', historyId: number,
  generation: unknown, payload: Row): Promise<void> {
  if (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 0) fail('expected_generation must be a nonnegative JSON integer.', 400)
  const db = getDb(env)
  const op = await db.prepare(`SELECT o.*,s.kind,s.payload_json,h.status FROM stock_session_operations o
    JOIN undo_snapshots s ON s.id=o.snapshot_id JOIN action_history h ON h.id=o.history_id WHERE o.history_id=@history`)
    .get<Row>({ history: historyId })
  if (!op || op.id !== payload.operation_id || op.snapshot_id !== payload.snapshot_id || op.kind !== STOCK_SESSION_KIND) fail('Stock session history does not match its operation.')
  const snapshot = JSON.parse(String(op.payload_json)) as Row
  const request = snapshot.request as StockSessionRequest
  if (request.items.some(line => line.quantity > 0) && getActionTier(user, 'inventory', 'adjust') !== 'full') fail('Inventory adjust permission is required.', 403)
  if (request.items.some(line => line.kind === 'create_receive') && getActionTier(user, 'products', 'add') !== 'full') fail('Product add permission is required to reverse this session.', 403)
  const targetStatus = direction === 'undo' ? 'redoable' : 'undoable'
  const expectedStatus = direction === 'undo' ? 'undoable' : 'redoable'
  if (Number(op.generation) === generation + 1 && op.status === targetStatus) return
  if (Number(op.generation) !== generation || op.status !== expectedStatus || generation % 2 !== (direction === 'undo' ? 0 : 1)) fail('Stock session generation changed. Refresh history.')
  if (snapshot.version !== 2 || !snapshot.after || !snapshot.expected) fail('This older session has no authoritative postimage and cannot be safely reversed.')
  const members = await db.prepare('SELECT * FROM stock_session_members WHERE operation_id=@id ORDER BY line_id').all<Row>({ id: op.id })
  if (members.length !== request.items.length || members.length > STOCK_SESSION_MAX_LINES) fail('Stock session members are incomplete.')
  const after = snapshot.after as Record<string, Row[]>
  const before = snapshot.before as Record<string, Row[]>
  const stateSql = await stockReplayStateSql(env)
  const statements: StockWriteStatement[] = [
    assertion("NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')"),
    assertion(`EXISTS(SELECT 1 FROM stock_session_operations o JOIN action_history h ON h.id=o.history_id
      JOIN undo_snapshots s ON s.id=o.snapshot_id WHERE o.id=@id AND o.history_id=@history AND o.generation=@generation
      AND h.status=@status AND s.payload_json=@snapshot)`, { id: op.id, history: historyId, generation, status: expectedStatus, snapshot: op.payload_json }),
    assertion(`${stateSql}=(SELECT json_extract(payload_json,'$.expected') FROM undo_snapshots WHERE id=@snapshotId)`, { id: op.id, snapshotId: op.snapshot_id }),
  ]
  for (const [key, [table]] of Object.entries(REPLAY_TABLES)) {
    if (key === 'images' || key === 'members' || key === 'movements') continue // Original links/ledger rows are immutable during replay.
    for (const row of after[key]) {
      const original = (before[key] || []).find(r => r.id === row.id)
      const created = members.some(m => m.product_created === 1 && m.product_id === (key === 'products' ? row.id : row.product_id))
      if (key === 'products' && created && direction === 'redo') {
        statements.push(assertion(`NOT EXISTS(SELECT 1 FROM products WHERE id<>@product AND is_active=1
          AND LOWER(TRIM(COALESCE(barcode,'')))=LOWER(@barcode)
          AND LOWER(TRIM(REPLACE(REPLACE(REPLACE(name,'  ',' '),'  ',' '),'  ',' ')))=@nameKey
          AND ROUND(COALESCE(cost_price_usd,0)*100)=@costUsd AND ROUND(COALESCE(cost_price_khr,0)*100)=@costKhr)`, {
          product: row.id, barcode: String(row.barcode || '').trim(), nameKey: normalizeProductGroupName(row.name),
          costUsd: Math.round((Number(row.cost_price_usd) || 0) * 100), costKhr: Math.round((Number(row.cost_price_khr) || 0) * 100),
        }))
      }
      if (key === 'branchStock' && !created && !members.some(m => m.product_id === row.product_id && m.branch_id === row.branch_id)) continue
      if (key === 'branchBatchStock' && !members.some(m => m.batch_id === row.batch_id && m.branch_id === row.branch_id)) continue
      let target: Row | null = direction === 'redo' ? row : original || null
      if (key === 'products') target = direction === 'redo' ? { stock_quantity: row.stock_quantity, is_active: row.is_active, updated_at: row.updated_at }
        : original ? { stock_quantity: original.stock_quantity, updated_at: original.updated_at }
          : { stock_quantity: 0, is_active: 0 }
      if (key === 'batches' && !target) {
        // Retain the lot identity for immutable members/receipts and exact
        // redo, but remove attribution belonging solely to this undone
        // receipt. A later same-date receipt reuses the row and fills NULL
        // first-attribution fields; retaining A/credit would charge B's paid
        // receipt to A. The saved after postimage still restores A on redo,
        // unless reuse has advanced the retained revision guard.
        target = {
          is_active: 0, received_quantity: 0, received_cost_usd: 0,
          supplier_id: null, supplier_name: null, unit_cost_usd: null,
          payment_status: null, credit_due_date: null, received_branch_id: null,
          expiry_date: null, notes: null,
        }
      }
      if (!target) statements.push({ sql: `DELETE FROM ${table} WHERE id=@rowId`, params: { rowId: row.id } })
      else if ((key === 'branchStock' || key === 'branchBatchStock') && direction === 'redo' && !original) {
        const columns = Object.keys(row)
        statements.push({ sql: `INSERT INTO ${table}(${columns.map(c => `"${c}"`).join(',')}) VALUES(${columns.map((_, i) => `@v${i}`).join(',')})`, params: Object.fromEntries(columns.map((c, i) => [`v${i}`, row[c]])) })
      } else {
        const columns = Object.keys(target).filter(c => c !== 'id')
        statements.push({ sql: `UPDATE ${table} SET ${columns.map((c, i) => `"${c}"=@v${i}`).join(',')} WHERE id=@rowId`, params: { rowId: row.id, ...Object.fromEntries(columns.map((c, i) => [`v${i}`, target![c]])) } })
      }
    }
  }
  statements.push({ sql: `INSERT INTO inventory_movements(product_id,product_name,branch_id,branch_name,movement_type,quantity,unit_cost_usd,unit_cost_khr,total_cost_usd,total_cost_khr,reason,reference_id,user_id,user_name,batch_id)
    SELECT m.product_id,p.name,m.branch_id,b.name,@movement,m.quantity*@sign,COALESCE(m.unit_cost_usd,0),0,m.quantity*COALESCE(m.unit_cost_usd,0)*@sign,0,@reason,o.rowid,@actor,@name,m.batch_id
    FROM stock_session_members m JOIN products p ON p.id=m.product_id JOIN branches b ON b.id=m.branch_id JOIN stock_session_operations o ON o.id=m.operation_id
    WHERE m.operation_id=@id AND m.quantity>0`, params: { id: op.id, movement: direction === 'undo' ? 'remove' : 'add', sign: direction === 'undo' ? -1 : 1, reason: `Stock session ${op.id} ${direction} generation ${generation + 1}`, actor: user.id, name: user.name } })
  statements.push({ sql: 'UPDATE stock_session_operations SET generation=generation+1 WHERE id=@id', params: { id: op.id } })
  statements.push({ sql: 'UPDATE undo_snapshots SET status=@status,updated_at=CURRENT_TIMESTAMP WHERE id=@snapshot', params: { status: direction === 'undo' ? 'reversed' : 'applied', snapshot: op.snapshot_id } })
  statements.push({ sql: `UPDATE action_history SET status=@status,last_error=NULL,updated_at=CURRENT_TIMESTAMP,
    undo_payload=json_set(undo_payload,'$.generation',@generation),redo_payload=json_set(redo_payload,'$.generation',@generation) WHERE id=@history`, params: { status: targetStatus, generation: generation + 1, history: historyId } })
  statements.push({ sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details)
    VALUES(@actor,@name,@action,'stock_session',@id,@details)`, params: { actor: user.id, name: user.name, action: `stock_session_${direction}`, id: op.id, details: JSON.stringify({ operationId: op.id, actionHistoryId: historyId, generation: generation + 1 }) } })
  statements.push(...captureReplayState(String(op.id), stateSql))
  checkBounds(statements, snapshot)
  try { await db.batch(statements) } catch (error) {
    const saved = await db.prepare('SELECT o.generation,h.status FROM stock_session_operations o JOIN action_history h ON h.id=o.history_id WHERE o.id=@id').get<Row>({ id: op.id })
    if (saved?.generation === generation + 1 && saved.status === targetStatus) return
    if (/constraint/i.test(String(error))) fail('Stock, metadata, references, or revision changed. Nothing was reversed; refresh history.')
    throw error
  }
}
