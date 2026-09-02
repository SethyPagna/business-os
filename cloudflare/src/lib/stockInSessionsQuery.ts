export const STOCK_IN_SESSION_KEY_SQL = `CASE
  WHEN m.reference_id IS NOT NULL AND CAST(m.reference_id AS TEXT) NOT LIKE 'revert:%'
    THEN 'session:' || CAST(m.reference_id AS TEXT)
  ELSE 'legacy:' || COALESCE(m.created_at, '') || ':' || COALESCE(CAST(m.user_id AS TEXT), '') || ':' ||
       COALESCE(CAST(m.branch_id AS TEXT), '') || ':' ||
       COALESCE(CAST(b.supplier_id AS TEXT), lower(trim(COALESCE(b.supplier_name, ''))))
END`

export const STOCK_IN_SESSION_FROM_SQL = `
  FROM inventory_movements m
  JOIN product_batches b ON b.id = m.batch_id
  LEFT JOIN products p ON p.id = m.product_id
  WHERE m.movement_type = 'add'
    AND NOT EXISTS (
      SELECT 1 FROM inventory_movements rx
      WHERE rx.reference_id = 'revert:' || CAST(m.id AS TEXT)
    )`

const LEGACY_SESSION_KEY = /^legacy:(\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?):([^:]*):([^:]*):(.*)$/

export type StockInSessionLocator =
  | { kind: 'reference'; referenceId: string }
  | { kind: 'legacy'; createdAt: string; userId: string; branchId: string; supplierKey: string }

export function parseStockInSessionKey(value: unknown): StockInSessionLocator | null {
  const key = String(value || '').trim()
  if (key.startsWith('session:')) {
    const referenceId = key.slice('session:'.length).trim()
    return referenceId && !referenceId.startsWith('revert:') ? { kind: 'reference', referenceId } : null
  }
  const match = LEGACY_SESSION_KEY.exec(key)
  if (!match) return null
  return { kind: 'legacy', createdAt: match[1], userId: match[2], branchId: match[3], supplierKey: match[4] }
}

function escapedLike(value: string): string {
  return `%${value.replace(/([\\%_])/g, '\\$1')}%`
}

export function buildStockInSessionListQuery(searchValue = ''): { groupedSql: string; params: Record<string, unknown> } {
  const search = String(searchValue || '').trim().slice(0, 120).toLowerCase()
  const params: Record<string, unknown> = search ? { search: escapedLike(search) } : {}
  const having = search
    ? `HAVING lower(COALESCE(MAX(b.supplier_name), '') || ' ' || COALESCE(MAX(m.branch_name), '') || ' ' ||
             COALESCE(MAX(m.user_name), '') || ' ' || COALESCE(GROUP_CONCAT(m.product_name, ' '), '') || ' ' ||
             COALESCE(GROUP_CONCAT(p.barcode, ' '), '')) LIKE @search ESCAPE '\\'`
    : ''
  return { groupedSql: `
    SELECT ${STOCK_IN_SESSION_KEY_SQL} AS session_key,
           MIN(m.created_at) AS created_at, MAX(b.received_at) AS received_at,
           MAX(m.branch_id) AS branch_id, MAX(m.branch_name) AS branch_name,
           MAX(m.user_name) AS user_name, MAX(b.supplier_id) AS supplier_id,
           MAX(b.supplier_name) AS supplier_name,
           COUNT(DISTINCT COALESCE(CAST(m.branch_id AS TEXT), '') || ':' || COALESCE(m.branch_name, '')) AS branch_state_count,
           COUNT(DISTINCT COALESCE(CAST(m.user_id AS TEXT), '') || ':' || COALESCE(m.user_name, '')) AS user_state_count,
           COUNT(DISTINCT COALESCE(CAST(b.supplier_id AS TEXT), '') || ':' || lower(trim(COALESCE(b.supplier_name, '')))) AS supplier_state_count,
           COUNT(*) AS line_count, SUM(ABS(COALESCE(m.quantity, 0))) AS quantity,
           SUM(CASE WHEN COALESCE(m.total_cost_usd, 0) > 0 THEN m.total_cost_usd ELSE 0 END) AS movement_cost_usd,
           SUM(CASE WHEN COALESCE(m.total_cost_usd, 0) > 0 THEN 0 ELSE 1 END) AS lines_without_movement_cost,
           COUNT(DISTINCT COALESCE(b.payment_status, '')) AS payment_state_count,
           MAX(b.payment_status) AS payment_status, MAX(b.credit_due_date) AS credit_due_date
    ${STOCK_IN_SESSION_FROM_SQL}
    GROUP BY session_key
    ${having}`, params }
}

// Do not filter this query by the computed session expression. That former
// shape forced D1 to evaluate the expression for the entire movement ledger
// every time a receipt was opened. The route parses the opaque key once and
// binds these indexed predicates instead.
export function stockInSessionLinesSql(locator: StockInSessionLocator): string {
  const where = locator.kind === 'reference'
    ? 'm.reference_id = @referenceId'
    : `m.created_at = @createdAt
       AND COALESCE(CAST(m.user_id AS TEXT), '') = @userId
       AND COALESCE(CAST(m.branch_id AS TEXT), '') = @branchId
       AND COALESCE(CAST(b.supplier_id AS TEXT), lower(trim(COALESCE(b.supplier_name, '')))) = @supplierKey`
  return `
    SELECT m.id, m.product_id, m.product_name, p.barcode, p.sku, p.unit, p.brand, p.category, p.tag_label,
           p.image_path, p.selling_price_usd, p.selling_price_khr, p.purchase_price_usd, p.purchase_price_khr,
           p.cost_price_usd, p.cost_price_khr,
           m.branch_id, m.branch_name, m.movement_type, ABS(COALESCE(m.quantity, 0)) AS quantity,
           m.unit_cost_usd, m.unit_cost_khr, m.total_cost_usd, m.total_cost_khr,
           m.reason, m.reference_id, m.user_name, m.created_at, m.batch_id,
           b.lot_code AS batch_lot_code, b.received_at AS batch_received_at,
           b.supplier_id AS batch_supplier_id, b.supplier_name AS batch_supplier_name,
           b.payment_status AS batch_payment_status, b.credit_due_date AS batch_credit_due_date,
           b.unit_cost_usd AS batch_unit_cost_usd, b.received_cost_usd AS batch_received_cost_usd,
           b.expiry_date AS batch_expiry_date, b.updated_at AS batch_updated_at
    FROM inventory_movements m
    JOIN product_batches b ON b.id = m.batch_id
    LEFT JOIN products p ON p.id = m.product_id
    WHERE m.movement_type = 'add' AND ${where}
    ORDER BY m.created_at ASC, m.id ASC
    LIMIT 2001`
}

export function stockInSessionLineParams(locator: StockInSessionLocator): Record<string, unknown> {
  return locator.kind === 'reference'
    ? { referenceId: locator.referenceId }
    : { createdAt: locator.createdAt, userId: locator.userId, branchId: locator.branchId, supplierKey: locator.supplierKey }
}
