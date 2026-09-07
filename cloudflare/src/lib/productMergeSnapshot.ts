import type { BindParams, getDb } from './db'

type ProductMergeDb = ReturnType<typeof getDb>

export type ProductMergeReparentTable = Readonly<{ table: string; column: string }>

export type ProductMergeBatchRow = {
  id: number
  batch_key: string
  batch_number: number | null
}

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
  duplicateStockRows: ProductMergeStockRow[]
  canonicalStockBefore: ProductMergeStockRow[]
  canonicalProduct: ProductMergeProductRow | undefined
  duplicateProduct: ProductMergeProductRow | undefined
  duplicateBatchRows: ProductMergeBatchRow[]
  duplicateImageRows: ProductMergeImageRow[]
  canonicalImageRows: ProductMergeImageRow[]
  reparentedByTable: Array<{ table: string; column: string; ids: number[] }>
  promotionRuleRows: Array<{ id: number; product_ids: string | null }>
  childProductRows: Array<{ id: number }>
}

export type ProductMergeLotSnapshot = {
  duplicateStockRows: ProductMergeStockRow[]
  keeperStockBefore: ProductMergeStockRow[]
  saleAllocationIds: number[]
  returnAllocationIds: number[]
}

type KeyedRead = { key: string; sql: string; params?: BindParams }

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

const PRODUCT_MONEY_COLUMNS = `selling_price_usd, selling_price_khr,
  wholesale_price_usd, wholesale_price_khr, cost_price_usd, cost_price_khr`

// Capture one fold's complete preimage in one consistent D1 read transaction.
// This is deliberately per case: a later fold in the same identity cluster must
// see the keeper state written by the previous fold.
export async function readProductMergeCaseSnapshot(
  db: ProductMergeDb,
  keeperId: number,
  duplicateId: number,
  reparentTables: readonly ProductMergeReparentTable[],
): Promise<ProductMergeCaseSnapshot> {
  const reads: KeyedRead[] = [
    { key: 'canonicalBatches', sql: 'SELECT id, batch_key, batch_number FROM product_batches WHERE variant_product_id = @id', params: { id: keeperId } },
    { key: 'duplicateStock', sql: 'SELECT branch_id, quantity, rfid_confirmed_qty FROM branch_stock WHERE product_id = @id', params: { id: duplicateId } },
    { key: 'canonicalStock', sql: 'SELECT branch_id, quantity FROM branch_stock WHERE product_id = @id', params: { id: keeperId } },
    {
      key: 'canonicalProduct',
      sql: `SELECT id, name, barcode, image_path, is_active, updated_at, ${PRODUCT_MONEY_COLUMNS}
            FROM products WHERE id = @id`,
      params: { id: keeperId },
    },
    {
      key: 'duplicateProduct',
      sql: `SELECT id, name, barcode, image_path, is_active, updated_at, ${PRODUCT_MONEY_COLUMNS}
            FROM products WHERE id = @id`,
      params: { id: duplicateId },
    },
    { key: 'duplicateBatches', sql: 'SELECT id, batch_key, batch_number FROM product_batches WHERE variant_product_id = @id', params: { id: duplicateId } },
    { key: 'duplicateImages', sql: 'SELECT image_path, sort_order FROM product_images WHERE product_id = @id ORDER BY sort_order ASC, id ASC', params: { id: duplicateId } },
    { key: 'canonicalImages', sql: 'SELECT image_path FROM product_images WHERE product_id = @id', params: { id: keeperId } },
    ...reparentTables.map(({ table, column }, index) => ({
      key: `reparent:${index}`,
      // table/column are compile-time constants supplied from
      // MERGE_REPARENT_TABLES, never request data.
      sql: `SELECT id FROM ${table} WHERE ${column} = @id`,
      params: { id: duplicateId },
    })),
    { key: 'promotionRules', sql: 'SELECT id, product_ids FROM promotion_rules' },
    { key: 'childProducts', sql: 'SELECT id FROM products WHERE parent_id = @id', params: { id: duplicateId } },
  ]
  const rows = await runProductMergeReadBatch(db, reads)
  const asRows = <T>(key: string): T[] => (rows.get(key) || []) as T[]
  const reparentedByTable = reparentTables.map(({ table, column }, index) => ({
    table,
    column,
    ids: asRows<{ id: number }>(`reparent:${index}`).map((row) => Number(row.id)),
  })).filter((entry) => entry.ids.length > 0)

  return {
    canonicalBatchRows: asRows<ProductMergeBatchRow>('canonicalBatches'),
    duplicateStockRows: asRows<ProductMergeStockRow>('duplicateStock'),
    canonicalStockBefore: asRows<ProductMergeStockRow>('canonicalStock'),
    canonicalProduct: asRows<ProductMergeProductRow>('canonicalProduct')[0],
    duplicateProduct: asRows<ProductMergeProductRow>('duplicateProduct')[0],
    duplicateBatchRows: asRows<ProductMergeBatchRow>('duplicateBatches'),
    duplicateImageRows: asRows<ProductMergeImageRow>('duplicateImages'),
    canonicalImageRows: asRows<ProductMergeImageRow>('canonicalImages'),
    reparentedByTable,
    promotionRuleRows: asRows<{ id: number; product_ids: string | null }>('promotionRules'),
    childProductRows: asRows<{ id: number }>('childProducts'),
  }
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
  if (!reads.length) return new Map()
  if (!Number.isSafeInteger(maxStatements) || maxStatements <= 0 || reads.length > maxStatements) {
    throw new ProductMergeReadBatchLimitError(reads.length, maxStatements)
  }
  const rows = await runProductMergeReadBatch(db, reads)
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
