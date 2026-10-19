import type { D1Compat } from './db'
import { STOCK_SCHEMA_EPOCH } from './stockTransaction'

const LEGACY_PHYSICAL_SCHEMA_HASH = '4f73a1a2235440be1a9054167a788b310a3d9e799aef8b5ea13bd0ffbc3ba89b'
const MAX_PRODUCT_IDS = 500
const QUANTITY_EPSILON = 0.000000001
const SCHEMA_SQL = `SELECT
  (SELECT value FROM system_flags WHERE key='stock_schema_epoch') AS epoch,
  (SELECT COUNT(*) FROM system_flags WHERE key='stock_schema_epoch') AS epoch_present,
  (SELECT COUNT(*) FROM system_flags WHERE key='maintenance') AS maintenance_present,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'stock_epoch_%_0243') AS epoch_guards,
  (SELECT json_group_array(json_object('name',name,'sql',sql)) FROM (
    SELECT name,sql FROM sqlite_master WHERE type='table'
    AND name IN ('branch_stock','branch_batch_stock','damaged_stock_lots') ORDER BY name
  )) AS physical_schema`

export class InventoryCheckStockSchemaError extends Error {
  readonly code = 'inventory_check_stock_schema_unavailable'
  readonly status = 409
  constructor() {
    super('Current stock cannot be read with this stock schema.')
    this.name = 'InventoryCheckStockSchemaError'
  }
}

export type InventoryCheckStockScope = { branchId?: number; productIds?: readonly number[] }
export type InventoryCheckStockRow = {
  product_id: number
  branch_id: number | null
  quantity: number | null
  recorded_ordinary_quantity: number | null
  recorded_lot_quantity: number | null
  recorded_damaged_quantity: number | null
  recorded_cache_quantity: number | null
  global_ordinary_quantity: number | null
  global_lot_quantity: number | null
  global_damaged_quantity: number | null
  unallocated_damaged_quantity: number | null
  consistent: boolean
  flags: string[]
}

const invalidQuantitySql = (column: string) => `(typeof(${column}) NOT IN ('integer','real') OR ABS(${column})>1.7976931348623157e308)`

export function buildInventoryCheckStockQuery(scope: InventoryCheckStockScope = {}) {
  if (scope.branchId !== undefined && (!Number.isSafeInteger(scope.branchId) || scope.branchId <= 0)
    || scope.productIds !== undefined && (!Array.isArray(scope.productIds) || scope.productIds.length > MAX_PRODUCT_IDS
      || scope.productIds.some(id => !Number.isSafeInteger(id) || id <= 0))) throw new Error('Invalid Inventory stock scope')
  const params = {
    inventoryBranchId: scope.branchId ?? null,
    inventoryProductIds: scope.productIds === undefined ? null : JSON.stringify([...new Set(scope.productIds)]),
  }
  const rowsSql = `WITH
    wanted AS (SELECT id,stock_quantity FROM products WHERE @inventoryProductIds IS NULL
      OR id IN (SELECT value FROM json_each(@inventoryProductIds))),
    ordinary AS (
      SELECT s.product_id,s.branch_id,SUM(s.quantity) AS quantity,COUNT(*) AS rows,
        SUM(CASE WHEN ${invalidQuantitySql('s.quantity')} THEN 1 ELSE 0 END) AS invalid,
        SUM(CASE WHEN s.quantity<0 THEN 1 ELSE 0 END) AS negative
      FROM branch_stock s JOIN wanted p ON p.id=s.product_id GROUP BY s.product_id,s.branch_id
    ), lots AS (
      SELECT b.variant_product_id AS product_id,s.branch_id,SUM(s.quantity) AS quantity,COUNT(*) AS rows,
        SUM(CASE WHEN ${invalidQuantitySql('s.quantity')} THEN 1 ELSE 0 END) AS invalid,
        SUM(CASE WHEN s.quantity<0 THEN 1 ELSE 0 END) AS negative
      FROM branch_batch_stock s JOIN product_batches b ON b.id=s.batch_id JOIN wanted p ON p.id=b.variant_product_id
      GROUP BY b.variant_product_id,s.branch_id
    ), damaged AS (
      SELECT s.product_id,s.branch_id,SUM(s.quantity_remaining) AS quantity,COUNT(*) AS rows,
        SUM(CASE WHEN ${invalidQuantitySql('s.quantity_remaining')} THEN 1 ELSE 0 END) AS invalid,
        SUM(CASE WHEN s.quantity_remaining<0 THEN 1 ELSE 0 END) AS negative,
        SUM(CASE WHEN (s.branch_id IS NULL OR s.branch_id<=0 OR directory.id IS NULL)
          AND (s.quantity_remaining<>0 OR ${invalidQuantitySql('s.quantity_remaining')}) THEN 1 ELSE 0 END) AS unallocated_rows
      FROM damaged_stock_lots s JOIN wanted p ON p.id=s.product_id
      LEFT JOIN branches directory ON directory.id=s.branch_id GROUP BY s.product_id,s.branch_id
    ), branch_keys AS (
      SELECT product_id,branch_id FROM ordinary UNION SELECT product_id,branch_id FROM lots
      UNION SELECT product_id,branch_id FROM damaged
    ), branch_evidence AS (
      SELECT k.product_id,k.branch_id,
        CASE WHEN o.rows IS NULL THEN 0 ELSE o.quantity END AS ordinary_quantity,
        CASE WHEN l.rows IS NULL THEN 0 ELSE l.quantity END AS lot_quantity,
        CASE WHEN d.rows IS NULL THEN 0 ELSE d.quantity END AS damaged_quantity,
        COALESCE(o.rows,0) AS ordinary_rows,
        COALESCE(o.invalid,0)+COALESCE(l.invalid,0)+COALESCE(d.invalid,0) AS invalid,
        COALESCE(o.negative,0)+COALESCE(l.negative,0)+COALESCE(d.negative,0) AS negative,
        CASE WHEN l.quantity>COALESCE(o.quantity,0)+${QUANTITY_EPSILON} THEN 1 ELSE 0 END AS lot_excess,
        CASE WHEN (k.branch_id IS NULL OR k.branch_id<=0 OR directory.id IS NULL)
          AND (COALESCE(o.quantity,0)<>0 OR COALESCE(l.quantity,0)<>0 OR COALESCE(o.invalid,0)+COALESCE(l.invalid,0)>0)
          THEN 1 ELSE 0 END AS invalid_allocation,
        COALESCE(d.unallocated_rows,0) AS unallocated_damaged_rows,
        CASE WHEN k.branch_id IS NULL OR k.branch_id<=0 OR directory.id IS NULL
          THEN CASE WHEN d.rows IS NULL THEN 0 ELSE d.quantity END ELSE 0 END AS unallocated_damaged_quantity
      FROM branch_keys k
      LEFT JOIN ordinary o ON o.product_id=k.product_id AND o.branch_id IS k.branch_id
      LEFT JOIN lots l ON l.product_id=k.product_id AND l.branch_id IS k.branch_id
      LEFT JOIN damaged d ON d.product_id=k.product_id AND d.branch_id IS k.branch_id
      LEFT JOIN branches directory ON directory.id=k.branch_id
    ), ordinary_totals AS (SELECT product_id,SUM(quantity) AS quantity,COUNT(*) AS rows FROM ordinary GROUP BY product_id),
    lot_totals AS (SELECT product_id,SUM(quantity) AS quantity,COUNT(*) AS rows FROM lots GROUP BY product_id),
    damaged_totals AS (SELECT product_id,SUM(quantity) AS quantity,COUNT(*) AS rows FROM damaged GROUP BY product_id),
    diagnostics AS (
      SELECT product_id,SUM(invalid) AS invalid,SUM(negative) AS negative,SUM(lot_excess) AS lot_excess,
        SUM(invalid_allocation) AS invalid_allocation,SUM(unallocated_damaged_rows) AS unallocated_damaged_rows,
        SUM(unallocated_damaged_quantity) AS unallocated_damaged_quantity
      FROM branch_evidence GROUP BY product_id
    ), global_stock AS (
      SELECT p.id AS product_id,p.stock_quantity AS cache_quantity,
        CASE WHEN o.rows IS NULL THEN 0 ELSE o.quantity END AS ordinary_quantity,
        CASE WHEN l.rows IS NULL THEN 0 ELSE l.quantity END AS lot_quantity,
        CASE WHEN d.rows IS NULL THEN 0 ELSE d.quantity END AS damaged_quantity,
        CASE WHEN ${invalidQuantitySql('p.stock_quantity')} OR p.stock_quantity<0 THEN 1 ELSE 0 END AS invalid_cache,
        COALESCE(a.invalid,0) AS invalid,COALESCE(a.negative,0)+(CASE WHEN p.stock_quantity<0 THEN 1 ELSE 0 END) AS negative,
        COALESCE(a.lot_excess,0) AS lot_excess,COALESCE(a.invalid_allocation,0) AS invalid_allocation,
        COALESCE(a.unallocated_damaged_rows,0) AS unallocated_damaged_rows,
        COALESCE(a.unallocated_damaged_quantity,0) AS unallocated_damaged_quantity
      FROM wanted p LEFT JOIN ordinary_totals o ON o.product_id=p.id LEFT JOIN lot_totals l ON l.product_id=p.id
      LEFT JOIN damaged_totals d ON d.product_id=p.id LEFT JOIN diagnostics a ON a.product_id=p.id
    ), scoped AS (
      SELECT g.*,@inventoryBranchId AS branch_id,
        CASE WHEN @inventoryBranchId IS NULL THEN g.ordinary_quantity ELSE CASE WHEN b.product_id IS NULL THEN 0 ELSE b.ordinary_quantity END END AS scoped_ordinary,
        CASE WHEN @inventoryBranchId IS NULL THEN g.lot_quantity ELSE CASE WHEN b.product_id IS NULL THEN 0 ELSE b.lot_quantity END END AS scoped_lot,
        CASE WHEN @inventoryBranchId IS NULL THEN g.damaged_quantity ELSE CASE WHEN b.product_id IS NULL THEN 0 ELSE b.damaged_quantity END END AS scoped_damaged,
        COALESCE(b.ordinary_rows,0) AS scoped_ordinary_rows,COALESCE(b.invalid,0) AS scoped_invalid,
        COALESCE(b.negative,0) AS scoped_negative,COALESCE(b.lot_excess,0) AS scoped_lot_excess,
        COALESCE(b.invalid_allocation,0) AS scoped_invalid_allocation,
        CASE WHEN ABS(g.cache_quantity-g.ordinary_quantity)>${QUANTITY_EPSILON} THEN 1 ELSE 0 END AS cache_mismatch
      FROM global_stock g LEFT JOIN branch_evidence b ON b.product_id=g.product_id AND b.branch_id=@inventoryBranchId
    )
    SELECT product_id,branch_id,
      CASE WHEN @inventoryBranchId IS NULL THEN
        CASE WHEN invalid+negative+invalid_cache+lot_excess+invalid_allocation+cache_mismatch=0
          THEN ordinary_quantity+damaged_quantity ELSE NULL END
      ELSE CASE WHEN scoped_invalid+scoped_negative+scoped_lot_excess+scoped_invalid_allocation+unallocated_damaged_rows=0
        AND NOT(scoped_ordinary_rows=0 AND invalid_cache+cache_mismatch+invalid_allocation>0)
        THEN scoped_ordinary+scoped_damaged ELSE NULL END END AS quantity,
      scoped_ordinary AS recorded_ordinary_quantity,scoped_lot AS recorded_lot_quantity,
      scoped_damaged AS recorded_damaged_quantity,cache_quantity AS recorded_cache_quantity,
      ordinary_quantity AS global_ordinary_quantity,lot_quantity AS global_lot_quantity,damaged_quantity AS global_damaged_quantity,
      unallocated_damaged_quantity,
      CASE WHEN invalid+negative+invalid_cache+lot_excess+invalid_allocation+cache_mismatch+unallocated_damaged_rows=0 THEN 1 ELSE 0 END AS consistent,
      invalid+invalid_cache AS invalid_quantity,negative AS negative_quantity,lot_excess AS lot_exceeds_ordinary,
      cache_mismatch,invalid_allocation,unallocated_damaged_rows AS unallocated_damaged,
      CASE WHEN @inventoryBranchId IS NOT NULL AND scoped_ordinary_rows=0
        AND invalid_cache+cache_mismatch+invalid_allocation>0 THEN 1 ELSE 0 END AS missing_branch_allocation
    FROM scoped ORDER BY product_id`
  return { rowsSql, params }
}

type SchemaRow = { epoch: string | null; epoch_present: number; epoch_guards: number; maintenance_present: number; physical_schema: string }
async function validateSchema(row: SchemaRow | undefined): Promise<void> {
  if (!row || row.maintenance_present || row.epoch_present && row.epoch !== STOCK_SCHEMA_EPOCH
    || !row.epoch_present && row.epoch_guards) throw new InventoryCheckStockSchemaError()
  let physical: Array<{ name: string; sql: string }>
  try { physical = JSON.parse(row.physical_schema) } catch { throw new InventoryCheckStockSchemaError() }
  if (!Array.isArray(physical) || physical.length !== 3 || physical.some(item => typeof item?.name !== 'string' || typeof item?.sql !== 'string')) throw new InventoryCheckStockSchemaError()
  // Without an epoch, only the frozen 0058/0074/0162 physical schema establishes the legacy separate pool.
  const canonical = physical.map(item => `${item.name}\n${item.sql.replace(/\s+/g, ' ').trim().toLowerCase()}`).join('\n')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
  if (hash !== LEGACY_PHYSICAL_SCHEMA_HASH) throw new InventoryCheckStockSchemaError()
}

export async function readInventoryCheckStock(db: Pick<D1Compat, 'batch'>, scope: InventoryCheckStockScope = {}): Promise<InventoryCheckStockRow[]> {
  const query = buildInventoryCheckStockQuery(scope)
  let result: D1Result[]
  try { result = await db.batch([{ sql: SCHEMA_SQL }, { sql: query.rowsSql, params: query.params }]) }
  catch { throw new InventoryCheckStockSchemaError() }
  if (result.length !== 2 || result.some(item => item.success !== true)) throw new InventoryCheckStockSchemaError()
  await validateSchema(result[0].results?.[0] as SchemaRow | undefined)
  return (result[1].results || []).map(value => {
    const raw = value as Record<string, unknown>
    const flags = ['invalid_quantity', 'negative_quantity', 'lot_exceeds_ordinary', 'cache_mismatch', 'invalid_allocation', 'unallocated_damaged', 'missing_branch_allocation'].filter(key => Number(raw[key]) > 0)
    const numeric = (key: string): number | null => typeof raw[key] === 'number' && Number.isFinite(raw[key]) ? raw[key] as number : null
    const quantities = ['quantity', 'recorded_ordinary_quantity', 'recorded_lot_quantity', 'recorded_damaged_quantity', 'recorded_cache_quantity', 'global_ordinary_quantity', 'global_lot_quantity', 'global_damaged_quantity', 'unallocated_damaged_quantity'] as const
    if (quantities.some(key => raw[key] != null && numeric(key) === null)) flags.push('invalid_quantity')
    return {
      product_id: Number(raw.product_id), branch_id: scope.branchId ?? null,
      ...Object.fromEntries(quantities.map(key => [key, numeric(key)])) as Record<typeof quantities[number], number | null>,
      quantity: flags.includes('invalid_quantity') && raw.quantity != null && numeric('quantity') === null ? null : numeric('quantity'),
      consistent: Number(raw.consistent) === 1 && flags.length === 0, flags: [...new Set(flags)],
    }
  })
}
