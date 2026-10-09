import type { BindParams, getDb } from './db'
import type { ProductMergeSourceExtent } from './productMerge'

type ProductMergeDb = ReturnType<typeof getDb>

export type ProductMergeReparentTable = Readonly<{ table: string; column: string }>

export type ProductMergeBatchRow = {
  id: number
  batch_key: string
  batch_number: number | null
  [field: string]: unknown
}

export type ProductMergeBatchStockRow = Record<string, unknown> & { id: number; batch_id: number; branch_id: number; quantity: number }

export type ProductMergeStockRow = {
  branch_id: number
  quantity: number
  rfid_confirmed_qty?: number | null
}

export type ProductMergeImageRow = {
  image_path: string
  sort_order?: number | null
}

export type ProductMergeProductRow = Record<string, unknown> & {
  id: number
  name: string | null
  barcode: string | null
  image_path?: string | null
  is_active: number
  updated_at: string | null
}

export type ProductMergeCaseSnapshot = {
  canonicalBatchRows: ProductMergeBatchRow[]
  canonicalBatchStockRows: ProductMergeBatchStockRow[]
  duplicateBatchStockRows: ProductMergeBatchStockRow[]
  damagedStockRows: Array<Record<string, unknown>>
  productCostRows: Array<Record<string, unknown>>
  duplicateStockRows: ProductMergeStockRow[]
  canonicalStockBefore: ProductMergeStockRow[]
  canonicalProduct: ProductMergeProductRow | undefined
  duplicateProduct: ProductMergeProductRow | undefined
  duplicateBatchRows: ProductMergeBatchRow[]
  duplicateImageRows: ProductMergeImageRow[]
  canonicalImageRows: ProductMergeImageRow[]
  reparentedByTable: Array<{ table: string; column: string; ids: number[] }>
  promotionRuleRows: Array<{ id: number; product_ids: string | null }>
  childProductRows: Array<{ id: number; parent_id: number | null; updated_at: string | null }>
}

// What the fold read about the discarded product, as the extent its write batch
// re-asserts (productMergeSourceUnmovedAssertion). Lot stock is included only
// when every lot row carries it (the shared case read does; a leading-zero
// approved plan builds its own rows).
export function productMergeSourceExtent(snapshot: ProductMergeCaseSnapshot): ProductMergeSourceExtent {
  const number = (value: unknown) => Number(value) || 0
  const lotsKnown = snapshot.duplicateBatchRows.every((row) => row.lot_quantity != null && row.lot_stock_rows != null)
  return {
    shelfRows: snapshot.duplicateStockRows.length,
    shelfQuantity: snapshot.duplicateStockRows.reduce((sum, row) => sum + number(row.quantity), 0),
    lotRows: snapshot.duplicateBatchRows.length,
    movements: snapshot.reparentedByTable.find((entry) => entry.table === 'inventory_movements')?.ids.length ?? 0,
    ...(lotsKnown ? {
      lotStockRows: snapshot.duplicateBatchRows.reduce((sum, row) => sum + number(row.lot_stock_rows), 0),
      lotQuantity: snapshot.duplicateBatchRows.reduce((sum, row) => sum + number(row.lot_quantity), 0),
    } : {}),
  }
}

export type ProductMergeLotSnapshot = {
  duplicateStockRows: ProductMergeStockRow[]
  keeperStockBefore: ProductMergeStockRow[]
  saleAllocationIds: number[]
  returnAllocationIds: number[]
}

type KeyedRead = { key: string; sql: string; params?: BindParams }
export type ProductMergeReadPlan<T> = {
  reads: KeyedRead[]
  decode: (rows: Map<string, Array<Record<string, unknown>>>) => T
}

export const PRODUCT_MERGE_READ_BATCH_MAX_STATEMENTS = 80

export class ProductMergeReadBatchLimitError extends Error {
  readonly code = 'merge_read_batch_statement_limit'

  constructor(readonly statementCount: number, readonly maxStatements: number) {
    super(`merge_read_batch_statement_limit: dependent read batch requires ${statementCount} statements; limit is ${maxStatements}.`)
    this.name = 'ProductMergeReadBatchLimitError'
  }
}

function resultRows(result: D1Result | undefined): Array<Record<string, unknown>> {
  return Array.isArray(result?.results) ? result.results as Array<Record<string, unknown>> : []
}

// One D1 binding call for a set of mutually independent reads. Each statement
// retains its own parameter object, so callers can keep using the named-param
// adapter without sharing or renaming bindings across statements.
export async function runProductMergeReadBatch(
  db: ProductMergeDb,
  reads: readonly KeyedRead[],
): Promise<Map<string, Array<Record<string, unknown>>>> {
  if (!reads.length) return new Map()
  if (new Set(reads.map((read) => read.key)).size !== reads.length) {
    throw new Error('Product merge read batch contains a duplicate result key.')
  }
  const results = await db.batch(reads.map(({ sql, params }) => ({ sql, params })))
  if (results.length !== reads.length) throw new Error('Product merge read batch returned an incomplete result set.')
  return new Map(reads.map((read, index) => [read.key, resultRows(results[index])]))
}

const PRODUCT_COLUMNS = [
  'id', 'name', 'sku', 'barcode', 'category',
  'unit', 'description', 'selling_price_usd', 'selling_price_khr', 'purchase_price_usd',
  'purchase_price_khr', 'cost_price_usd', 'cost_price_khr', 'stock_quantity', 'rfid_confirmed_qty',
  'low_stock_threshold', 'out_of_stock_threshold', 'image_path', 'is_active', 'supplier',
  'custom_fields', 'parent_id', 'created_at', 'updated_at', 'brand',
  'client_request_id', 'special_price_usd', 'special_price_khr', 'is_group', 'discount_enabled',
  'discount_type', 'discount_percent', 'discount_amount_usd', 'discount_amount_khr', 'discount_label',
  'discount_badge_color', 'discount_starts_at', 'discount_ends_at', 'expiry_date', 'expiry_alert_days',
  'name_key', 'is_grouped_cached', 'categories', 'brands', 'name_normalized',
  'unit_normalized', 'brand_compact', 'tag_label', 'auto_merged_count', 'wholesale_price_usd',
  'wholesale_price_khr',
]

const MERGE_CAPTURE_MAX_ROWS = 10_000
const MERGE_CAPTURE_MAX_BYTES = 512 * 1_024
const BATCH_COLUMNS = ['id', 'variant_product_id', 'batch_key', 'lot_code', 'expiry_date', 'received_at',
  'is_active', 'notes', 'synthetic', 'created_at', 'updated_at', 'batch_number', 'supplier_id', 'supplier_name',
  'payment_status', 'credit_due_date', 'unit_cost_usd', 'received_quantity', 'received_branch_id',
  'received_cost_usd', 'received_branch_name']
const BATCH_STOCK_COLUMNS = ['id', 'batch_id', 'branch_id', 'quantity', 'created_at', 'updated_at']
const PRODUCT_COST_COLUMNS = ['id', 'product_id', 'cost_usd', 'cost_khr', 'source', 'user_id', 'user_name',
  'baseline_batch_id', 'created_at', 'previous_cost_usd']
const DAMAGED_STOCK_COLUMNS = ['id', 'product_id', 'product_name', 'branch_id', 'batch_id', 'return_id',
  'quantity', 'quantity_remaining', 'reason', 'created_by_user_id', 'created_by_user_name', 'created_at',
  'updated_at', 'condition_tag', 'source', 'unit_cost_usd', 'return_item_id']
type CaptureSection = { key: string; columns: string[]; sql: string }
const captureProofs = new WeakMap<ProductMergeCaseSnapshot, { read: KeyedRead; observed: string }>()

export function productMergeCaptureGuard(snapshot: ProductMergeCaseSnapshot): { sql: string; params: Record<string, unknown> } {
  const proof = captureProofs.get(snapshot)
  if (!proof) throw new Error('merge_snapshot_incomplete')
  return {
    sql: `WITH current_capture AS (${proof.read.sql}) SELECT CASE WHEN
      (SELECT data FROM current_capture)=@observedCapture AND (SELECT oversized FROM current_capture)=0
      THEN 1 ELSE json_extract('[1]','$[merge_conflict_retry]') END AS merge_source_guard`,
    params: { ...proof.read.params, observedCapture: proof.observed },
  }
}

function captureRead(sections: readonly CaptureSection[], keeperId: number, duplicateId: number): KeyedRead {
  const cell = (column: string) => `CASE WHEN typeof(${column})='real'
    THEN json_array('real',printf('%!.26g',${column})) ELSE ${column} END`
  const fields = sections.map(({ key, columns, sql }) => `'${key}',(SELECT json_group_array(json_array(${columns.map(cell).join(',')}))
    FROM (${sql} LIMIT ${MERGE_CAPTURE_MAX_ROWS + 1}))`)
  return {
    key: 'capture',
    sql: `WITH captured AS MATERIALIZED (SELECT json_object(${fields.join(',')}) AS data)
      SELECT CASE WHEN length(CAST(data AS BLOB))<=${MERGE_CAPTURE_MAX_BYTES} THEN data ELSE NULL END AS data,
        length(CAST(data AS BLOB))>${MERGE_CAPTURE_MAX_BYTES} AS oversized FROM captured`,
    params: { keeperId, duplicateId },
  }
}

function decodeCapture(rows: Map<string, Array<Record<string, unknown>>>, sections: readonly CaptureSection[]): Map<string, Array<Record<string, unknown>>> {
  const envelope = rows.get('capture')
  if (envelope?.length !== 1) throw new Error('merge_snapshot_incomplete')
  if (Number(envelope[0].oversized) === 1) throw new Error('merge_case_snapshot_limit')
  const raw = envelope[0].data
  if (typeof raw !== 'string') throw new Error('merge_snapshot_incomplete')
  if (new TextEncoder().encode(raw).byteLength > MERGE_CAPTURE_MAX_BYTES) throw new Error('merge_case_snapshot_limit')
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new Error('merge_snapshot_incomplete') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || Object.keys(parsed).length !== sections.length) throw new Error('merge_snapshot_incomplete')
  const data = parsed as Record<string, unknown>
  const decodeCell = (cell: unknown): string | number | null => {
    if (cell === null || typeof cell === 'string') return cell
    if (typeof cell === 'number' && Number.isFinite(cell)) return cell
    if (Array.isArray(cell) && cell.length === 2 && cell[0] === 'real' && typeof cell[1] === 'string'
      && /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(cell[1]) && Number.isFinite(Number(cell[1]))) return Number(cell[1])
    throw new Error('merge_snapshot_incomplete')
  }
  return new Map(sections.map(({ key, columns }) => {
    const values = data[key]
    if (!Array.isArray(values)) throw new Error('merge_snapshot_incomplete')
    if (values.length > MERGE_CAPTURE_MAX_ROWS) throw new Error('merge_case_snapshot_limit')
    return [key, values.map(value => {
      if (!Array.isArray(value) || value.length !== columns.length) {
        throw new Error('merge_snapshot_incomplete')
      }
      return Object.fromEntries(columns.map((column, index) => [column, decodeCell(value[index])]))
    })]
  }))
}

// Capture one fold's complete preimage in one consistent D1 read transaction.
// This is deliberately per case: a later fold in the same identity cluster must
// see the keeper state written by the previous fold.
export async function readProductMergeCaseSnapshot(
  db: ProductMergeDb,
  keeperId: number,
  duplicateId: number,
  reparentTables: readonly ProductMergeReparentTable[],
): Promise<ProductMergeCaseSnapshot> {
  const plan = planProductMergeCaseSnapshot(keeperId, duplicateId, reparentTables)
  return plan.decode(await runProductMergeReadBatch(db, plan.reads))
}

// Planning is pure: bulk preview can pool independent cases without copying
// their SQL or changing the single-case callers' consistent read transaction.
export function planProductMergeCaseSnapshot(
  keeperId: number,
  duplicateId: number,
  reparentTables: readonly ProductMergeReparentTable[],
): ProductMergeReadPlan<ProductMergeCaseSnapshot> {
  if (reparentTables.some(({ table, column }) => !/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(column))) {
    throw new Error('merge_snapshot_invalid_table')
  }
  const productColumns = PRODUCT_COLUMNS
  const stockColumns = ['branch_id', 'quantity', 'rfid_confirmed_qty']
  const sections: CaptureSection[] = [
    { key: 'canonicalBatches', columns: BATCH_COLUMNS, sql: `SELECT ${BATCH_COLUMNS.join(',')} FROM product_batches WHERE variant_product_id=@keeperId ORDER BY id` },
    { key: 'canonicalBatchStock', columns: BATCH_STOCK_COLUMNS, sql: `SELECT ${BATCH_STOCK_COLUMNS.map(column => `bbs.${column}`).join(',')} FROM branch_batch_stock bbs
      JOIN product_batches pb ON pb.id=bbs.batch_id WHERE pb.variant_product_id=@keeperId ORDER BY bbs.id` },
    { key: 'duplicateBatchStock', columns: BATCH_STOCK_COLUMNS, sql: `SELECT ${BATCH_STOCK_COLUMNS.map(column => `bbs.${column}`).join(',')} FROM branch_batch_stock bbs
      JOIN product_batches pb ON pb.id=bbs.batch_id WHERE pb.variant_product_id=@duplicateId ORDER BY bbs.id` },
    { key: 'duplicateStock', columns: stockColumns, sql: 'SELECT branch_id,quantity,rfid_confirmed_qty FROM branch_stock WHERE product_id=@duplicateId ORDER BY branch_id' },
    { key: 'canonicalStock', columns: stockColumns, sql: 'SELECT branch_id,quantity,rfid_confirmed_qty FROM branch_stock WHERE product_id=@keeperId ORDER BY branch_id' },
    {
      key: 'canonicalProduct', columns: productColumns,
      sql: `SELECT ${productColumns.join(',')} FROM products WHERE id=@keeperId`,
    },
    {
      key: 'duplicateProduct', columns: productColumns,
      sql: `SELECT ${productColumns.join(',')} FROM products WHERE id=@duplicateId`,
    },
    {
      key: 'duplicateBatches', columns: [...BATCH_COLUMNS, 'lot_quantity', 'lot_stock_rows'],
      // The two lot_* columns let the fold assert in its write batch that nothing moved on these lots since this read.
      sql: `SELECT ${BATCH_COLUMNS.join(',')},
        (SELECT COALESCE(SUM(quantity), 0) FROM branch_batch_stock WHERE batch_id = product_batches.id) AS lot_quantity,
        (SELECT COUNT(*) FROM branch_batch_stock WHERE batch_id = product_batches.id) AS lot_stock_rows
        FROM product_batches WHERE variant_product_id=@duplicateId ORDER BY id`,
    },
    { key: 'productCosts', columns: PRODUCT_COST_COLUMNS, sql: `SELECT ${PRODUCT_COST_COLUMNS.join(',')}
      FROM product_cost_entries WHERE product_id IN (@keeperId,@duplicateId) ORDER BY id` },
    { key: 'damagedStock', columns: DAMAGED_STOCK_COLUMNS, sql: `SELECT ${DAMAGED_STOCK_COLUMNS.join(',')}
      FROM damaged_stock_lots WHERE product_id IN (@keeperId,@duplicateId) ORDER BY id` },
    { key: 'duplicateImages', columns: ['image_path', 'sort_order'], sql: 'SELECT image_path,sort_order FROM product_images WHERE product_id=@duplicateId ORDER BY sort_order,id' },
    { key: 'canonicalImages', columns: ['image_path'], sql: 'SELECT image_path FROM product_images WHERE product_id=@keeperId ORDER BY id' },
    ...reparentTables.map(({ table, column }, index) => ({
      key: `reparent:${index}`, columns: ['id'],
      // table/column are compile-time constants supplied from
      // MERGE_REPARENT_TABLES, never request data.
      sql: `SELECT id FROM ${table} WHERE ${column}=@duplicateId ORDER BY id`,
    })),
    { key: 'promotionRules', columns: ['id', 'product_ids'], sql: 'SELECT id,product_ids FROM promotion_rules ORDER BY id' },
    { key: 'childProducts', columns: ['id', 'parent_id', 'updated_at'], sql: 'SELECT id,parent_id,updated_at FROM products WHERE parent_id=@duplicateId ORDER BY id' },
  ]
  const reads = [captureRead(sections, keeperId, duplicateId)]
  const decode: ProductMergeReadPlan<ProductMergeCaseSnapshot>['decode'] = (captured) => {
    const rows = decodeCapture(captured, sections)
    const asRows = <T>(key: string): T[] => (rows.get(key) || []) as T[]
    const reparentedByTable = reparentTables.map(({ table, column }, index) => ({
      table,
      column,
      ids: asRows<{ id: number }>(`reparent:${index}`).map((row) => Number(row.id)),
    })).filter((entry) => entry.ids.length > 0)

    const snapshot: ProductMergeCaseSnapshot = {
      canonicalBatchRows: asRows<ProductMergeBatchRow>('canonicalBatches'),
      canonicalBatchStockRows: asRows<ProductMergeBatchStockRow>('canonicalBatchStock'),
      duplicateBatchStockRows: asRows<ProductMergeBatchStockRow>('duplicateBatchStock'),
      damagedStockRows: asRows<Record<string, unknown>>('damagedStock'),
      productCostRows: asRows<Record<string, unknown>>('productCosts'),
      duplicateStockRows: asRows<ProductMergeStockRow>('duplicateStock'),
      canonicalStockBefore: asRows<ProductMergeStockRow>('canonicalStock'),
      canonicalProduct: asRows<ProductMergeProductRow>('canonicalProduct')[0],
      duplicateProduct: asRows<ProductMergeProductRow>('duplicateProduct')[0],
      duplicateBatchRows: asRows<ProductMergeBatchRow>('duplicateBatches'),
      duplicateImageRows: asRows<ProductMergeImageRow>('duplicateImages'),
      canonicalImageRows: asRows<ProductMergeImageRow>('canonicalImages'),
      reparentedByTable,
      promotionRuleRows: asRows<{ id: number; product_ids: string | null }>('promotionRules'),
      childProductRows: asRows<{ id: number; parent_id: number | null; updated_at: string | null }>('childProducts'),
    }
    captureProofs.set(snapshot, { read: reads[0], observed: captured.get('capture')![0].data as string })
    return snapshot
  }
  return { reads, decode }
}

// Lot preimages depend on the first snapshot's batch-key comparison, so they
// form a second read phase. All required lot/allocation reads within that phase
// remain independent and share one D1 call. A case with only repointed lots (or
// no lots) does not issue this second call at all.
export async function readProductMergeDependentLotSnapshots(
  db: ProductMergeDb,
  snapshot: ProductMergeCaseSnapshot,
  stockDisposition: 'merge' | 'write_off',
  maxStatements = PRODUCT_MERGE_READ_BATCH_MAX_STATEMENTS,
): Promise<Map<number, ProductMergeLotSnapshot>> {
  const plan = planProductMergeDependentLotSnapshots(snapshot, stockDisposition, maxStatements)
  return plan.decode(await runProductMergeReadBatch(db, plan.reads))
}

export function planProductMergeDependentLotSnapshots(
  snapshot: ProductMergeCaseSnapshot,
  stockDisposition: 'merge' | 'write_off',
  maxStatements = PRODUCT_MERGE_READ_BATCH_MAX_STATEMENTS,
): ProductMergeReadPlan<Map<number, ProductMergeLotSnapshot>> {
  const keeperBatchIdByKey = new Map(snapshot.canonicalBatchRows.map((row) => [row.batch_key, Number(row.id)]))
  const reads: KeyedRead[] = []
  const requested: Array<{ duplicateBatchId: number; keeperBatchId: number | null }> = []
  for (const batch of snapshot.duplicateBatchRows) {
    const duplicateBatchId = Number(batch.id)
    const keeperBatchId = stockDisposition === 'merge' ? keeperBatchIdByKey.get(batch.batch_key) ?? null : null
    if (stockDisposition === 'merge' && keeperBatchId == null) continue
    requested.push({ duplicateBatchId, keeperBatchId })
    reads.push({
      key: `dupStock:${duplicateBatchId}`,
      sql: 'SELECT branch_id, quantity FROM branch_batch_stock WHERE batch_id = @id',
      params: { id: duplicateBatchId },
    })
    if (keeperBatchId != null) {
      reads.push(
        { key: `keeperStock:${duplicateBatchId}`, sql: 'SELECT branch_id, quantity FROM branch_batch_stock WHERE batch_id = @id', params: { id: keeperBatchId } },
        { key: `saleAllocations:${duplicateBatchId}`, sql: 'SELECT id FROM sale_item_batch_allocations WHERE batch_id = @id', params: { id: duplicateBatchId } },
        { key: `returnAllocations:${duplicateBatchId}`, sql: 'SELECT id FROM return_item_batch_allocations WHERE batch_id = @id', params: { id: duplicateBatchId } },
      )
    }
  }
  if (reads.length && (!Number.isSafeInteger(maxStatements) || maxStatements <= 0 || reads.length > maxStatements)) {
    throw new ProductMergeReadBatchLimitError(reads.length, maxStatements)
  }
  const decode: ProductMergeReadPlan<Map<number, ProductMergeLotSnapshot>>['decode'] = (rows) => {
    const result = new Map<number, ProductMergeLotSnapshot>()
    for (const { duplicateBatchId, keeperBatchId } of requested) {
      result.set(duplicateBatchId, {
        duplicateStockRows: (rows.get(`dupStock:${duplicateBatchId}`) || []) as ProductMergeStockRow[],
        keeperStockBefore: keeperBatchId == null ? [] : (rows.get(`keeperStock:${duplicateBatchId}`) || []) as ProductMergeStockRow[],
        saleAllocationIds: keeperBatchId == null ? [] : (rows.get(`saleAllocations:${duplicateBatchId}`) || []).map((row) => Number(row.id)),
        returnAllocationIds: keeperBatchId == null ? [] : (rows.get(`returnAllocations:${duplicateBatchId}`) || []).map((row) => Number(row.id)),
      })
    }
    return result
  }
  return { reads, decode }
}
