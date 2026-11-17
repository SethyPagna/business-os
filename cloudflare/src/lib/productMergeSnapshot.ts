import type { BindParams, getDb } from './db'
import type { ProductMergeSourceExtent } from './productMerge'
import { isMergeableLot, matchDuplicateLots } from './productMergeLots'

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
  /** Single-lot sale lines and return lines that name this lot in their own batch_id (no allocation rows). */
  saleItemIds: number[]
  returnItemIds: number[]
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

const PRODUCT_MONEY_COLUMNS = `selling_price_usd, selling_price_khr,
  wholesale_price_usd, wholesale_price_khr, cost_price_usd, cost_price_khr, purchase_price_usd, purchase_price_khr`

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
  const reads: KeyedRead[] = [
    { key: 'canonicalBatches', sql: 'SELECT * FROM product_batches WHERE variant_product_id = @id ORDER BY id', params: { id: keeperId } },
    { key: 'canonicalBatchStock', sql: `SELECT bbs.* FROM branch_batch_stock bbs
      JOIN product_batches pb ON pb.id=bbs.batch_id WHERE pb.variant_product_id=@id ORDER BY bbs.id`, params: { id: keeperId } },
    { key: 'duplicateStock', sql: 'SELECT branch_id, quantity, rfid_confirmed_qty FROM branch_stock WHERE product_id = @id', params: { id: duplicateId } },
    { key: 'canonicalStock', sql: 'SELECT branch_id, quantity, rfid_confirmed_qty FROM branch_stock WHERE product_id = @id', params: { id: keeperId } },
    {
      key: 'canonicalProduct',
      sql: `SELECT id, name, barcode, image_path, is_active, updated_at, cost_review_key, ${PRODUCT_MONEY_COLUMNS}
            FROM products WHERE id = @id`,
      params: { id: keeperId },
    },
    {
      key: 'duplicateProduct',
      sql: `SELECT id, name, barcode, image_path, is_active, updated_at, cost_review_key, ${PRODUCT_MONEY_COLUMNS}
            FROM products WHERE id = @id`,
      params: { id: duplicateId },
    },
    {
      key: 'duplicateBatches',
      // The two lot_* columns let the fold assert in its write batch that nothing moved on these lots since this read.
      // received_at, expiry_date and unit_cost_usd are what the date match and the folded lot's cost and expiry read.
      // EVERY lot of the discarded product, as base reads it: an active one is folded or created on the keeper, an already-inactive one is
      // re-pointed onto the keeper untouched (lead ruling 16 Nov 2026, B2: its sale lines move to the keeper, so the lot must follow or a later
      // return of that line is refused as 'owned by another product').
      sql: `SELECT id, batch_key, batch_number, received_at, expiry_date, unit_cost_usd, is_active,
        (SELECT COALESCE(SUM(quantity), 0) FROM branch_batch_stock WHERE batch_id = product_batches.id) AS lot_quantity,
        (SELECT COUNT(*) FROM branch_batch_stock WHERE batch_id = product_batches.id) AS lot_stock_rows
        FROM product_batches WHERE variant_product_id = @id`,
      params: { id: duplicateId },
    },
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
  const decode: ProductMergeReadPlan<ProductMergeCaseSnapshot>['decode'] = (rows) => {
    const asRows = <T>(key: string): T[] => (rows.get(key) || []) as T[]
    const reparentedByTable = reparentTables.map(({ table, column }, index) => ({
      table,
      column,
      ids: asRows<{ id: number }>(`reparent:${index}`).map((row) => Number(row.id)),
    })).filter((entry) => entry.ids.length > 0)

    return {
      canonicalBatchRows: asRows<ProductMergeBatchRow>('canonicalBatches'),
      canonicalBatchStockRows: asRows<ProductMergeBatchStockRow>('canonicalBatchStock'),
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
  return { reads, decode }
}

// Lot preimages depend on the first snapshot's received-date match (productMergeLots.ts), so they
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
  const lotMatches = matchDuplicateLots(snapshot.canonicalBatchRows, snapshot.duplicateBatchRows)
  const reads: KeyedRead[] = []
  const requested: Array<{ duplicateBatchId: number; keeperBatchId: number | null }> = []
  for (const batch of snapshot.duplicateBatchRows) {
    const duplicateBatchId = Number(batch.id)
    // Only an ACTIVE discarded lot is folded or written off; an inactive one is re-pointed or left as it was (productMergeLots.ts).
    if (!isMergeableLot(batch)) continue
    const keeperBatchId = stockDisposition === 'merge' ? lotMatches.get(duplicateBatchId) ?? null : null
    if (stockDisposition === 'merge' && keeperBatchId == null) continue
    requested.push({ duplicateBatchId, keeperBatchId })
  }
  // SET reads, not per-lot reads: one JSON id list per read, grouped by batch_id in JS, so the read count is the same for 1 lot and for 1000
  // (it was 4 per folded lot, which refused any merge above 19 lots against the 80-statement bound).
  const lotIds = [...new Set(requested.flatMap(({ duplicateBatchId, keeperBatchId }) => (keeperBatchId == null ? [duplicateBatchId] : [duplicateBatchId, keeperBatchId])))]
  const foldedIds = [...new Set(requested.filter((lot) => lot.keeperBatchId != null).map((lot) => lot.duplicateBatchId))]
  if (lotIds.length) {
    reads.push({
      key: 'lotStock',
      sql: 'SELECT batch_id, branch_id, quantity FROM branch_batch_stock WHERE batch_id IN (SELECT value FROM json_each(@ids)) ORDER BY id',
      params: { ids: JSON.stringify(lotIds) },
    })
  }
  if (foldedIds.length) {
    // A single-lot line names its lot in sale_items.batch_id / return_items.batch_id and writes no allocation row: the fold follows it too.
    // Each table's allocation read carries its line read as one more UNION ALL term.
    // The line reads select by batch_id alone (exact, whatever product a line names): idx_sale_items_batch_id_partial and idx_return_items_batch_id_partial (migration 0315) make them seeks.
    const ids = JSON.stringify(foldedIds)
    reads.push(
      { key: 'saleAllocations', sql: "SELECT 'allocation' AS kind, batch_id, id FROM sale_item_batch_allocations WHERE batch_id IN (SELECT value FROM json_each(@ids)) UNION ALL SELECT 'line' AS kind, batch_id, id FROM sale_items WHERE batch_id IN (SELECT value FROM json_each(@ids)) ORDER BY kind, id", params: { ids } },
      { key: 'returnAllocations', sql: "SELECT 'allocation' AS kind, batch_id, id FROM return_item_batch_allocations WHERE batch_id IN (SELECT value FROM json_each(@ids)) UNION ALL SELECT 'line' AS kind, batch_id, id FROM return_items WHERE batch_id IN (SELECT value FROM json_each(@ids)) ORDER BY kind, id", params: { ids } },
    )
  }
  if (reads.length && (!Number.isSafeInteger(maxStatements) || maxStatements <= 0 || reads.length > maxStatements)) {
    throw new ProductMergeReadBatchLimitError(reads.length, maxStatements)
  }
  const decode: ProductMergeReadPlan<Map<number, ProductMergeLotSnapshot>>['decode'] = (rows) => {
    const byBatch = (key: string): Map<number, Array<Record<string, unknown>>> => {
      const grouped = new Map<number, Array<Record<string, unknown>>>()
      for (const row of rows.get(key) || []) {
        const id = Number(row.batch_id)
        const list = grouped.get(id)
        if (list) list.push(row)
        else grouped.set(id, [row])
      }
      return grouped
    }
    const stock = byBatch('lotStock')
    const sale = byBatch('saleAllocations')
    const returns = byBatch('returnAllocations')
    const ofKind = (grouped: Map<number, Array<Record<string, unknown>>>, id: number, kind: string) => (grouped.get(id) || []).filter((row) => row.kind === kind).map((row) => Number(row.id))
    const stockOf = (id: number) => (stock.get(id) || []).map(({ branch_id, quantity }) => ({ branch_id, quantity })) as ProductMergeStockRow[]
    const result = new Map<number, ProductMergeLotSnapshot>()
    for (const { duplicateBatchId, keeperBatchId } of requested) {
      result.set(duplicateBatchId, {
        duplicateStockRows: stockOf(duplicateBatchId),
        keeperStockBefore: keeperBatchId == null ? [] : stockOf(keeperBatchId),
        saleAllocationIds: keeperBatchId == null ? [] : ofKind(sale, duplicateBatchId, 'allocation'),
        returnAllocationIds: keeperBatchId == null ? [] : ofKind(returns, duplicateBatchId, 'allocation'),
        saleItemIds: keeperBatchId == null ? [] : ofKind(sale, duplicateBatchId, 'line'),
        returnItemIds: keeperBatchId == null ? [] : ofKind(returns, duplicateBatchId, 'line'),
      })
    }
    return result
  }
  return { reads, decode }
}
