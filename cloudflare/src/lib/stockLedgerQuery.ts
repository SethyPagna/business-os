// D1 (Part 415): the Stock Change ledger's query kernel -- pure SQL/param
// building over the EXISTING inventory_movements history, shared by the
// /products/stock-ledger route and driven directly (compiled, real SQL on
// real migrations) by test-stock-ledger-pure.cjs. No writes here, ever.
//
// Sign semantics MIRROR frontend movementGroups.ts's movementSign(): the
// types below net stock DOWN, everything else nets UP, quantities are
// stored as magnitudes. If a movement_type is ever added there, update
// this list in the same change -- the pure test pins the two lists equal
// by reading both sources.
export const LEDGER_OUT_TYPES = ['remove', 'sale', 'supplier_return', 'return_reversal', 'transfer_out', 'row_move_out', 'write_off'] as const

// The ledger's three action columns. 'adjustment' (dated stock-count
// corrections) and legacy 'set' rows form the Adjustment column; every
// other type falls to Stock In / Stock Out by sign. Manual modal
// 'add'/'remove' land in In/Out -- their reasons (damage/lost/wrong/...)
// are what the spec's Stock Out parenthetical lists, and 'set' has been
// rewritten into add/remove at the API since D4, so 'set' only matches
// pre-existing rows.
export const LEDGER_ADJUSTMENT_TYPES = ['adjustment', 'set'] as const

export type StockLedgerView = 'all' | 'adjustments' | 'in' | 'out'

export type StockLedgerFilters = {
  view?: StockLedgerView
  productId?: number
  branchId?: number
  startDate?: string
  endDate?: string
  search?: string
  // D2a (0084): filter by the supplier attributed to the movement's lot.
  // Only movements stamped with a batch_id can match -- unattributed rows
  // (multi-lot, legacy aggregate) are honestly excluded, never guessed in.
  supplierId?: number
}

export type StockLedgerQuery = {
  whereSql: string
  params: Record<string, unknown>
  countSql: string
  rowsSql: string
}

const OUT_LIST = LEDGER_OUT_TYPES.map((t) => `'${t}'`).join(', ')
const ADJUSTMENT_LIST = LEDGER_ADJUSTMENT_TYPES.map((t) => `'${t}'`).join(', ')

export function buildStockLedgerQuery(filters: StockLedgerFilters = {}): StockLedgerQuery {
  const where: string[] = []
  const params: Record<string, unknown> = {}
  const view: StockLedgerView = filters.view && ['all', 'adjustments', 'in', 'out'].includes(filters.view) ? filters.view : 'all'
  if (view === 'adjustments') {
    where.push(`m.movement_type IN (${ADJUSTMENT_LIST})`)
  } else if (view === 'in') {
    where.push(`m.movement_type NOT IN (${ADJUSTMENT_LIST}) AND m.movement_type NOT IN (${OUT_LIST})`)
  } else if (view === 'out') {
    where.push(`m.movement_type NOT IN (${ADJUSTMENT_LIST}) AND m.movement_type IN (${OUT_LIST})`)
  }
  const productId = Number(filters.productId) || 0
  const branchId = Number(filters.branchId) || 0
  if (productId > 0) { where.push('m.product_id = @productId'); params.productId = productId }
  if (branchId > 0) { where.push('m.branch_id = @branchId'); params.branchId = branchId }
  // Inclusive calendar-day bounds on the stored timestamp, the same shape
  // auditLogQuery.ts uses -- date(created_at) never excludes a same-day
  // row over its time component.
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(filters.startDate || '')) ? String(filters.startDate) : ''
  const endDate = /^\d{4}-\d{2}-\d{2}$/.test(String(filters.endDate || '')) ? String(filters.endDate) : ''
  if (startDate) { where.push('date(m.created_at) >= @startDate'); params.startDate = startDate }
  if (endDate) { where.push('date(m.created_at) <= @endDate'); params.endDate = endDate }
  const search = String(filters.search || '').trim().slice(0, 120)
  if (search) {
    // LIKE with ESCAPE, auditLogQuery.ts convention: user text matches
    // literally, % and _ included.
    where.push(`(m.product_name LIKE @search ESCAPE '\\' OR p.barcode LIKE @search ESCAPE '\\')`)
    params.search = `%${search.replace(/([\\%_])/g, '\\$1')}%`
  }
  const supplierId = Number(filters.supplierId) || 0
  if (supplierId > 0) {
    // Same supplier identity rule as D1b/D3: a lot matches by supplier_id
    // when attributed, else by its recorded name equalling that supplier's
    // name (name-only attribution -- D5a's match-only rule means the name
    // was a real suppliers-table match at receive time). Rows without a
    // batch_id cannot match: their lot -- and so their supplier -- was
    // never recorded, and guessing is worse than excluding.
    where.push(`(b.supplier_id = @supplierId OR (b.supplier_id IS NULL AND b.supplier_name IS NOT NULL
      AND lower(trim(b.supplier_name)) = (SELECT lower(trim(name)) FROM suppliers WHERE id = @supplierId)))`)
    params.supplierId = supplierId
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const countSql = `
    SELECT COUNT(*) AS total
    FROM inventory_movements m
    LEFT JOIN products p ON p.id = m.product_id
    LEFT JOIN product_batches b ON b.id = m.batch_id
    ${whereSql}
  `

  // after_qty: walk BACKWARD from the product's CURRENT stock (the one
  // authoritative number) through every movement NEWER than this row;
  // before_qty = after_qty - signed delta (added by the caller in JS).
  // Movements store no before/after; deriving from current stock stays
  // consistent even where pre-migration history is a snapshot with no
  // movement rows -- the oldest derived "before" then reads as the
  // baseline the recorded actions imply: the honest best available
  // number, never a fabricated one. Correlated per page row (<=100) over
  // idx_inventory_movements_product_created_pg.
  const rowsSql = `
    SELECT
      m.id, m.product_id, m.product_name, p.barcode, p.unit,
      m.branch_id, m.branch_name, m.movement_type, ABS(COALESCE(m.quantity, 0)) AS quantity,
      CASE WHEN m.movement_type IN (${OUT_LIST}) THEN -ABS(COALESCE(m.quantity, 0)) ELSE ABS(COALESCE(m.quantity, 0)) END AS signed_quantity,
      m.reason, m.user_name, m.created_at,
      m.batch_id, b.lot_code AS batch_lot_code, b.received_at AS batch_received_at,
      b.supplier_id AS batch_supplier_id, b.supplier_name AS batch_supplier_name,
      CASE WHEN m.movement_type IN (${ADJUSTMENT_LIST}) THEN 'adjustment'
           WHEN m.movement_type IN (${OUT_LIST}) THEN 'out'
           ELSE 'in' END AS ledger_bucket,
      COALESCE(p.stock_quantity, 0) - COALESCE((
        SELECT SUM(CASE WHEN mn.movement_type IN (${OUT_LIST}) THEN -ABS(COALESCE(mn.quantity, 0)) ELSE ABS(COALESCE(mn.quantity, 0)) END)
        FROM inventory_movements mn
        WHERE mn.product_id = m.product_id
          AND (mn.created_at > m.created_at OR (mn.created_at = m.created_at AND mn.id > m.id))
      ), 0) AS after_qty
    FROM inventory_movements m
    LEFT JOIN products p ON p.id = m.product_id
    LEFT JOIN product_batches b ON b.id = m.batch_id
    ${whereSql}
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT @limit OFFSET @offset
  `

  return { whereSql, params, countSql, rowsSql }
}

// before_qty derivation shared by the route and the test: one place owns
// the "before = after - signed" arithmetic.
export function attachBeforeQty<T extends { signed_quantity?: unknown; after_qty?: unknown }>(rows: T[]): Array<T & { before_qty: number }> {
  return (rows || []).map((row) => {
    const signed = Number(row.signed_quantity || 0)
    const after = Number(row.after_qty || 0)
    return { ...row, before_qty: after - signed }
  })
}
