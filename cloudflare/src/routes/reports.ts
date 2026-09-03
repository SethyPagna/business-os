import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { getPermissionTier, isAdminControlUser } from '../lib/permissions'
import { round2 } from '../lib/saleTotals'
import {
  getBusinessSummaryDayRows,
  getSalesTotals,
  getDeliveryContactTotals,
  getSalesGroupedTotals,
  getProductSalesRanking,
  previousPeriodFilters,
  SALES_GROUP_KEYS,
  type SalesGroupKey,
  recognizedExpr,
  awaitingExpr,
  netSaleExpr,
  customerDeliveryFeeExpr,
  saleStatusExpr,
  CUSTOMER_REFUND_JOIN,
  type SalesFilters,
} from '../lib/salesAnalytics'
import { localDateAtOrAfter, localDateAtOrBefore, localDateExpr, localTimeRangeClause } from '../lib/businessDateWindow'
import type { Env } from '../index'

// Section 5 (Sep 2, 2026 RC): the "Business summary" Excel workbook the
// Sales hub's Reports area can export -- Summary (per business day),
// Reconciliation (net revenue - expenses), and per-row Sales/Returns detail,
// all computed through lib/salesAnalytics.ts's canonical revenue kernel so
// this can never disagree with the Sales-page header or the Dashboard for
// the same range (single-source rule -- see that file's header comment).
//
// Cost/profit fields (COGS & Gross profit) are ADMIN-ONLY: the key is simply
// absent from the JSON for a non-admin caller, not blanked or hidden client-
// side -- see buildSaleReportRow/buildDaySummaryRow below, which never even
// read the cost figure into the response object unless `isAdmin` is true.
// Admin is the same isAdminControlUser() check every other admin-gated route
// in this codebase uses (reserved `admin` username, `admin` role code, or an
// explicit `permissions.all` grant) -- NOT a new permission key, matching the
// brief's "don't model a new key unless the permission editor needs one for
// a visible control" (there's no control here -- the server just omits the
// fields).
//
// Data flows through the SAME snapshot/cursor keyset-pagination contract
// routes/sales.ts's GET /export already uses (see that file's own header
// comment): page 1 freezes `snapshot_max_id`, later pages pass it back with
// `afterCreatedAt`/`afterId` so newly-created/backdated rows can't shift,
// duplicate or vanish between pages, and the Worker never holds a whole
// table in memory. The day-bucketed Summary/Reconciliation endpoint is NOT
// paginated -- it's a GROUP BY aggregate bounded by calendar-day count (even
// a decade of history is ~3,660 rows), not by table size.

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
app.use('*', requireAuth)

function canReadSales(user: SessionUser): boolean {
  return getPermissionTier(user, 'sales') !== 'none'
}
function canReadReturns(user: SessionUser): boolean {
  return getPermissionTier(user, 'returns') !== 'none'
}
function canReadFees(user: SessionUser): boolean {
  return getPermissionTier(user, 'fees') !== 'none'
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Number(raw)
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : fallback
}

function parseFilters(query: Record<string, string>): SalesFilters {
  return {
    startDate: query.startDate || null,
    endDate: query.endDate || null,
    branchId: query.branchId || null,
  }
}

// ---- Pure row/day shaping (kept standalone, no Hono/D1 types, so a test
// script can extract these functions by name and exercise them directly --
// same approach test-fees-pure.cjs uses for routes/fees.ts's helpers). ----

export interface DaySummarySourceRow {
  date: string
  tx_count: number
  gross_sales_usd: number
  store_discount_usd: number
  membership_discount_usd: number
  discount_usd: number
  tax_usd: number
  delivery_usd: number
  refund_usd: number
  revenue_usd: number
  pending_revenue_usd: number
  collected_total_usd: number
  cost_usd: number
  profit_usd: number
  cost_missing_snapshot_lines: number
}

// One Summary-sheet row. cost_usd/gross_profit_usd/margin_pct are present
// ONLY when isAdmin -- the object literal never assigns those keys at all
// for a non-admin caller (not `undefined`, not omitted-by-JSON.stringify --
// genuinely never created), so there is no path where a serialization quirk
// could leak them.
export function buildDaySummaryRow(row: DaySummarySourceRow, isAdmin: boolean): Record<string, unknown> {
  const base: Record<string, unknown> = {
    date: row.date,
    sales_count: row.tx_count,
    gross_sales_usd: row.gross_sales_usd,
    store_discount_usd: row.store_discount_usd,
    membership_discount_usd: row.membership_discount_usd,
    discount_usd: row.discount_usd,
    tax_usd: row.tax_usd,
    delivery_usd: row.delivery_usd,
    refund_usd: row.refund_usd,
    net_revenue_usd: row.revenue_usd,
    pending_revenue_usd: row.pending_revenue_usd,
    collected_total_usd: row.collected_total_usd,
  }
  if (isAdmin) {
    base.cost_usd = row.cost_usd
    base.gross_profit_usd = row.profit_usd
    base.margin_pct = row.revenue_usd > 0 ? round2((row.profit_usd / row.revenue_usd) * 100) : 0
    base.cost_missing_snapshot_lines = row.cost_missing_snapshot_lines
  }
  return base
}

export interface ReconciliationDay {
  date: string
  net_revenue_usd: number
  expenses_usd: number
  reconciliation_usd: number
}

// Reconciliation's day dimension is the UNION of every day that had sales
// revenue AND every day that had an expense -- a rent payment on a day with
// zero sales must still show up as a negative reconciliation line, not
// silently vanish because the Summary sheet (sales-only) never produced that
// date. `salesDays`/`feeDays` are plain [date, amount] maps so this has no
// dependency on the SQL shape either side was queried with.
export function mergeReconciliationDays(
  salesByDate: Map<string, number>,
  expensesByDate: Map<string, number>,
): ReconciliationDay[] {
  const dates = new Set<string>([...salesByDate.keys(), ...expensesByDate.keys()])
  return [...dates].sort().map((date) => {
    const netRevenue = round2(salesByDate.get(date) || 0)
    const expenses = round2(expensesByDate.get(date) || 0)
    return { date, net_revenue_usd: netRevenue, expenses_usd: expenses, reconciliation_usd: round2(netRevenue - expenses) }
  })
}

export interface MonthRollup {
  month: string
  net_revenue_usd: number
  expenses_usd: number
  reconciliation_usd: number
}

export function buildMonthRollups(days: ReconciliationDay[]): MonthRollup[] {
  const byMonth = new Map<string, MonthRollup>()
  for (const day of days) {
    const month = day.date.slice(0, 7)
    const acc = byMonth.get(month) || { month, net_revenue_usd: 0, expenses_usd: 0, reconciliation_usd: 0 }
    acc.net_revenue_usd = round2(acc.net_revenue_usd + day.net_revenue_usd)
    acc.expenses_usd = round2(acc.expenses_usd + day.expenses_usd)
    acc.reconciliation_usd = round2(acc.reconciliation_usd + day.reconciliation_usd)
    byMonth.set(month, acc)
  }
  return [...byMonth.values()].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
}

export function sumReconciliationTotals(days: ReconciliationDay[]): { net_revenue_usd: number; expenses_usd: number; reconciliation_usd: number } {
  return days.reduce((acc, day) => ({
    net_revenue_usd: round2(acc.net_revenue_usd + day.net_revenue_usd),
    expenses_usd: round2(acc.expenses_usd + day.expenses_usd),
    reconciliation_usd: round2(acc.reconciliation_usd + day.reconciliation_usd),
  }), { net_revenue_usd: 0, expenses_usd: 0, reconciliation_usd: 0 })
}

export interface SaleReportSourceRow {
  id: number
  receipt_number: string | null
  created_at: string
  business_date: string
  branch_name: string | null
  cashier_name: string | null
  customer_name: string | null
  customer_phone: string | null
  payment_method: string | null
  sale_status: string
  gross_sales_usd: number
  store_discount_usd: number
  membership_discount_usd: number
  tax_usd: number
  delivery_usd: number
  refund_usd: number
  net_revenue_usd: number
  pending_revenue_usd: number
  cost_usd: number | null
  cost_missing_snapshot_lines: number | null
}

// One Sales-sheet row -- cost_usd/gross_profit_usd present ONLY for admin,
// same "never assign the key" rule as buildDaySummaryRow above.
export function buildSaleReportRow(row: SaleReportSourceRow, isAdmin: boolean): Record<string, unknown> {
  const collectedTotalUsd = round2(row.net_revenue_usd + row.tax_usd + row.delivery_usd)
  const base: Record<string, unknown> = {
    receipt_number: row.receipt_number || '',
    date: row.created_at,
    business_date: row.business_date,
    branch: row.branch_name || '',
    cashier: row.cashier_name || '',
    customer: row.customer_name || '',
    customer_phone: row.customer_phone || '',
    payment_method: row.payment_method || '',
    status: row.sale_status,
    gross_sales_usd: row.gross_sales_usd,
    store_discount_usd: row.store_discount_usd,
    membership_discount_usd: row.membership_discount_usd,
    tax_usd: row.tax_usd,
    delivery_usd: row.delivery_usd,
    refund_usd: row.refund_usd,
    net_revenue_usd: row.net_revenue_usd,
    pending_revenue_usd: row.pending_revenue_usd,
    collected_total_usd: collectedTotalUsd,
  }
  if (isAdmin) {
    const costUsd = round2(num(row.cost_usd))
    base.cost_usd = costUsd
    base.gross_profit_usd = round2(row.net_revenue_usd - costUsd)
    // Transparency signal only (see getBusinessSummaryDayRows' comment) --
    // never changes cost_usd/gross_profit_usd, which stay on the exact same
    // SUM/COALESCE(...,0) basis the Dashboard/Sales-page COGS figure uses.
    base.cost_missing_snapshot_lines = num(row.cost_missing_snapshot_lines)
  }
  return base
}

export interface ReturnReportSourceRow {
  return_number: string | null
  created_at: string
  business_date: string
  receipt_number: string | null
  customer_name: string | null
  supplier_name: string | null
  reason: string | null
  return_type: string | null
  return_scope: string | null
  status: string
  total_refund_usd: number
  total_refund_khr: number
}

export function buildReturnReportRow(row: ReturnReportSourceRow): Record<string, unknown> {
  const scope = row.return_scope || 'customer'
  const status = row.status || 'completed'
  return {
    return_number: row.return_number || '',
    date: row.created_at,
    business_date: row.business_date,
    sale_receipt_number: row.receipt_number || '',
    party: row.customer_name || row.supplier_name || '',
    scope,
    type: row.return_type || '',
    reason: row.reason || '',
    status,
    refund_usd: round2(num(row.total_refund_usd)),
    refund_khr: Math.round(num(row.total_refund_khr)),
    counts_toward_revenue: scope === 'customer' && status !== 'cancelled' ? 1 : 0,
  }
}

export interface ExpenseReportSourceRow {
  id: number
  fee_date: string
  created_at: string
  fee_type: string | null
  label: string | null
  branch_name: string | null
  sale_receipt_number: string | null
  notes: string | null
  amount_usd: number
  amount_khr: number
}

export function buildExpenseReportRow(row: ExpenseReportSourceRow): Record<string, unknown> {
  return {
    date: row.fee_date,
    created_at: row.created_at,
    type: row.fee_type || 'other',
    label: row.label || '',
    branch: row.branch_name || '',
    linked_sale_receipt_number: row.sale_receipt_number || '',
    notes: row.notes || '',
    amount_usd: round2(num(row.amount_usd)),
    amount_khr: Math.round(num(row.amount_khr)),
  }
}

// ---------------------------------------------------------------------------
// GET /api/reports/business-summary?startDate&endDate&branchId
// Summary (per-day) + Reconciliation (days/months/grand totals). Bounded by
// calendar-day count, not table size -- see header comment.
// ---------------------------------------------------------------------------
app.get('/business-summary', async (c) => {
  const user = c.get('user')
  if (!canReadSales(user)) return c.json({ error: 'You do not have permission to perform this action' }, 403)
  const query = c.req.query()
  const isAdmin = isAdminControlUser(user)
  const filters = parseFilters(query)
  const db = getDb(c.env)

  const dayRows = await getBusinessSummaryDayRows(c.env, filters)
  const summary = dayRows.map((row) => buildDaySummaryRow(row, isAdmin))

  // Expenses (fees) per day -- fee_date is already a plain local calendar
  // date (see migrations/0018_fees.sql / routes/fees.ts's /report), no
  // UTC+7 shift needed the way sales.created_at requires.
  const feeWhere: string[] = ['1=1']
  const feeParams: Record<string, unknown> = {}
  if (filters.startDate) { feeWhere.push('fee_date >= @startDate'); feeParams.startDate = filters.startDate }
  if (filters.endDate) { feeWhere.push('fee_date <= @endDate'); feeParams.endDate = filters.endDate }
  if (filters.branchId) { feeWhere.push('branch_id = @branchId'); feeParams.branchId = filters.branchId }
  const feeDayRows = await db.prepare(`
    SELECT fee_date AS date, COALESCE(SUM(amount_usd), 0) AS expenses_usd
    FROM fees
    WHERE ${feeWhere.join(' AND ')}
    GROUP BY fee_date
  `).all<{ date: string; expenses_usd: number }>(feeParams)

  const salesByDate = new Map(dayRows.map((row) => [row.date, row.revenue_usd]))
  const expensesByDate = new Map((feeDayRows || []).map((row) => [String(row.date), num(row.expenses_usd)]))
  const days = mergeReconciliationDays(salesByDate, expensesByDate)
  const months = buildMonthRollups(days)
  const grand_totals = sumReconciliationTotals(days)

  return c.json({
    period: { start: filters.startDate, end: filters.endDate },
    is_admin: isAdmin,
    summary,
    reconciliation: { days, months, grand_totals },
  })
})

// ---------------------------------------------------------------------------
// GET /api/reports/business-summary/sales -- paginated per-sale detail rows
// (one row per sale, canonical columns), snapshot/cursor-paged exactly like
// routes/sales.ts's GET /export.
// ---------------------------------------------------------------------------
app.get('/business-summary/sales', async (c) => {
  const user = c.get('user')
  if (!canReadSales(user)) return c.json({ error: 'You do not have permission to perform this action' }, 403)
  const db = getDb(c.env)
  const query = c.req.query()
  const isAdmin = isAdminControlUser(user)
  const pageSize = clampInt(query.pageSize, 250, 1, 500)

  const baseWhere: string[] = ['1=1']
  const baseParams: Record<string, unknown> = {}
  if (query.startDate) { baseWhere.push(localDateAtOrAfter('s.created_at')); baseParams.startDate = query.startDate }
  if (query.endDate) { baseWhere.push(localDateAtOrBefore('s.created_at')); baseParams.endDate = query.endDate }
  if (query.branchId) { baseWhere.push('s.branch_id = @branchId'); baseParams.branchId = query.branchId }
  // Sep 3 2026 (Reports redesign): the on-screen per-sale list narrows by
  // the same status / payment method / time-of-day as every other view
  // (mirrors whereActiveSales's normalisation), takes a free-text search,
  // and can be walked newest-first (order=desc). The workbook export still
  // calls this with none of them and is unchanged.
  const statusFilter = String(query.status || '').trim().toLowerCase()
  if (statusFilter) { baseWhere.push(`${saleStatusExpr('s.')} = @status`); baseParams.status = statusFilter }
  const paymentFilter = String(query.paymentMethod || '').trim().toLowerCase()
  if (paymentFilter) { baseWhere.push("lower(trim(COALESCE(s.payment_method, ''))) = @paymentMethod"); baseParams.paymentMethod = paymentFilter }
  if (isClock(query.startTime) && isClock(query.endTime)) { baseWhere.push(localTimeRangeClause('s.created_at')); baseParams.startTime = query.startTime; baseParams.endTime = query.endTime }
  const search = String(query.q || '').trim().replace(/[%_]/g, '')
  if (search) { baseWhere.push('(s.receipt_number LIKE @q OR s.customer_name LIKE @q OR s.customer_phone LIKE @q OR s.cashier_name LIKE @q)'); baseParams.q = `%${search}%` }
  const descending = String(query.order || '').trim().toLowerCase() === 'desc'

  let snapshotMaxId = clampInt(query.snapshotMaxId, 0, 0, Number.MAX_SAFE_INTEGER)
  if (!snapshotMaxId) {
    const snapshotRow = await db.prepare(`SELECT MAX(s.id) AS max_id FROM sales s WHERE ${baseWhere.join(' AND ')}`).get<{ max_id: number | null }>(baseParams)
    snapshotMaxId = Number(snapshotRow?.max_id) || 0
  }
  if (!snapshotMaxId) {
    return c.json({ rows: [], snapshot_max_id: null, has_more: false, next_cursor: null })
  }

  const detailWhere = [...baseWhere, 's.id <= @snapshotMaxId']
  const detailParams: Record<string, unknown> = { ...baseParams, snapshotMaxId }
  const afterCreatedAt = String(query.afterCreatedAt || '').trim()
  const afterId = Number(query.afterId)
  if (afterCreatedAt && Number.isSafeInteger(afterId) && afterId > 0) {
    detailWhere.push(descending
      ? `(datetime(s.created_at) < datetime(@afterCreatedAt) OR (datetime(s.created_at) = datetime(@afterCreatedAt) AND s.id < @afterId))`
      : `(datetime(s.created_at) > datetime(@afterCreatedAt) OR (datetime(s.created_at) = datetime(@afterCreatedAt) AND s.id > @afterId))`)
    detailParams.afterCreatedAt = afterCreatedAt
    detailParams.afterId = afterId
  }

  const costSelect = isAdmin
    ? `COALESCE((SELECT SUM(si.cost_price_usd * si.quantity) FROM sale_items si WHERE si.sale_id = s.id), 0) AS cost_usd,
       COALESCE((SELECT SUM(CASE WHEN si.cost_price_usd IS NULL THEN 1 ELSE 0 END) FROM sale_items si WHERE si.sale_id = s.id), 0) AS cost_missing_snapshot_lines`
    : `NULL AS cost_usd, NULL AS cost_missing_snapshot_lines`

  const pageRows = await db.prepare(`
    SELECT s.id, s.receipt_number, s.created_at, ${localDateExpr('s.created_at')} AS business_date,
           s.branch_name, s.cashier_name, s.customer_name, s.customer_phone,
           s.payment_method, ${saleStatusExpr('s.')} AS sale_status,
           ROUND(COALESCE(s.subtotal_usd, 0), 2) AS gross_sales_usd,
           ROUND(COALESCE(s.discount_usd, 0), 2) AS store_discount_usd,
           ROUND(COALESCE(s.membership_discount_usd, 0), 2) AS membership_discount_usd,
           ROUND(CASE WHEN ${recognizedExpr('s.')} THEN COALESCE(s.tax_usd, 0) ELSE 0 END, 2) AS tax_usd,
           ROUND(CASE WHEN ${recognizedExpr('s.')} THEN ${customerDeliveryFeeExpr('s.')} ELSE 0 END, 2) AS delivery_usd,
           ROUND(CASE WHEN ${recognizedExpr('s.')} THEN COALESCE(rf.refund_usd, 0) ELSE 0 END, 2) AS refund_usd,
           ROUND(CASE WHEN ${recognizedExpr('s.')} THEN ${netSaleExpr('s.')} - COALESCE(rf.refund_usd, 0) ELSE 0 END, 2) AS net_revenue_usd,
           ROUND(CASE WHEN ${awaitingExpr('s.')} THEN ${netSaleExpr('s.')} ELSE 0 END, 2) AS pending_revenue_usd,
           ${costSelect}
    FROM sales s
    ${CUSTOMER_REFUND_JOIN}s.id
    WHERE ${detailWhere.join(' AND ')}
    ORDER BY datetime(s.created_at) ${descending ? 'DESC' : 'ASC'}, s.id ${descending ? 'DESC' : 'ASC'}
    LIMIT @pageSize
  `).all<SaleReportSourceRow & { id: number }>({ ...detailParams, pageSize: pageSize + 1 })

  const hasMore = pageRows.length > pageSize
  const sales = hasMore ? pageRows.slice(0, pageSize) : pageRows
  const lastSale = sales[sales.length - 1] || null
  const nextCursor = hasMore && lastSale ? { created_at: lastSale.created_at, id: lastSale.id } : null

  return c.json({
    rows: sales.map((row) => ({ id: row.id, ...buildSaleReportRow(row, isAdmin) })),
    snapshot_max_id: snapshotMaxId,
    has_more: hasMore,
    next_cursor: nextCursor,
  })
})

// ---------------------------------------------------------------------------
// GET /api/reports/business-summary/returns -- paginated per-return rows
// (every scope; `counts_toward_revenue` flags the ones the canonical
// definition actually subtracts from a sale's day -- customer-scope,
// non-cancelled). Same snapshot/cursor shape as the sales endpoint above.
// ---------------------------------------------------------------------------
app.get('/business-summary/returns', async (c) => {
  const user = c.get('user')
  if (!canReadReturns(user)) return c.json({ error: 'You do not have permission to perform this action' }, 403)
  const db = getDb(c.env)
  const query = c.req.query()
  const pageSize = clampInt(query.pageSize, 250, 1, 500)

  const baseWhere: string[] = ['1=1']
  const baseParams: Record<string, unknown> = {}
  if (query.startDate) { baseWhere.push(localDateAtOrAfter('r.created_at')); baseParams.startDate = query.startDate }
  if (query.endDate) { baseWhere.push(localDateAtOrBefore('r.created_at')); baseParams.endDate = query.endDate }
  if (query.branchId) { baseWhere.push('r.branch_id = @branchId'); baseParams.branchId = query.branchId }

  let snapshotMaxId = clampInt(query.snapshotMaxId, 0, 0, Number.MAX_SAFE_INTEGER)
  if (!snapshotMaxId) {
    const snapshotRow = await db.prepare(`SELECT MAX(r.id) AS max_id FROM returns r WHERE ${baseWhere.join(' AND ')}`).get<{ max_id: number | null }>(baseParams)
    snapshotMaxId = Number(snapshotRow?.max_id) || 0
  }
  if (!snapshotMaxId) {
    return c.json({ rows: [], snapshot_max_id: null, has_more: false, next_cursor: null })
  }

  const detailWhere = [...baseWhere, 'r.id <= @snapshotMaxId']
  const detailParams: Record<string, unknown> = { ...baseParams, snapshotMaxId }
  const afterCreatedAt = String(query.afterCreatedAt || '').trim()
  const afterId = Number(query.afterId)
  // order=desc walks newest-first (Reports hub lists); the workbook export keeps the ascending default.
  const descending = String(query.order || '').trim().toLowerCase() === 'desc'
  if (afterCreatedAt && Number.isSafeInteger(afterId) && afterId > 0) {
    const cmp = descending ? '<' : '>'
    detailWhere.push(`(datetime(r.created_at) ${cmp} datetime(@afterCreatedAt) OR (datetime(r.created_at) = datetime(@afterCreatedAt) AND r.id ${cmp} @afterId))`)
    detailParams.afterCreatedAt = afterCreatedAt
    detailParams.afterId = afterId
  }

  const pageRows = await db.prepare(`
    SELECT r.id, r.return_number, r.created_at, ${localDateExpr('r.created_at')} AS business_date,
           r.receipt_number, r.customer_name, r.supplier_name, r.reason, r.return_type,
           r.return_scope, COALESCE(NULLIF(r.status, ''), 'completed') AS status,
           r.total_refund_usd, r.total_refund_khr
    FROM returns r
    WHERE ${detailWhere.join(' AND ')}
    ORDER BY datetime(r.created_at) ${descending ? 'DESC' : 'ASC'}, r.id ${descending ? 'DESC' : 'ASC'}
    LIMIT @pageSize
  `).all<ReturnReportSourceRow & { id: number }>({ ...detailParams, pageSize: pageSize + 1 })

  const hasMore = pageRows.length > pageSize
  const returns = hasMore ? pageRows.slice(0, pageSize) : pageRows
  const lastReturn = returns[returns.length - 1] || null
  const nextCursor = hasMore && lastReturn ? { created_at: lastReturn.created_at, id: lastReturn.id } : null

  return c.json({
    rows: returns.map((row) => ({ id: row.id, ...buildReturnReportRow(row) })),
    snapshot_max_id: snapshotMaxId,
    has_more: hasMore,
    next_cursor: nextCursor,
  })
})

// ---------------------------------------------------------------------------
// GET /api/reports/business-summary/expenses -- paginated per-expense (fee)
// rows for the Expenses sheet. Same snapshot/cursor shape as sales/returns
// above -- NOT a reuse of GET /api/fees (that list endpoint is capped at 500
// rows and isn't cursor-paged, so it can't safely back a full-range export;
// see coordinator audit note / activeDataCompleteness.test.ts's bounded-
// preview pattern this deliberately avoids inheriting).
// fee_date is already a plain local calendar date (no UTC+7 shift needed --
// see migrations/0018_fees.sql / routes/fees.ts's own /report endpoint), so
// ordering/cursoring uses created_at (always present, monotonic) with id as
// the tiebreaker, same shape as the sales/returns cursors.
// ---------------------------------------------------------------------------
app.get('/business-summary/expenses', async (c) => {
  const user = c.get('user')
  if (!canReadFees(user)) return c.json({ error: 'You do not have permission to perform this action' }, 403)
  const db = getDb(c.env)
  const query = c.req.query()
  const pageSize = clampInt(query.pageSize, 250, 1, 500)

  const baseWhere: string[] = ['1=1']
  const baseParams: Record<string, unknown> = {}
  if (query.startDate) { baseWhere.push('f.fee_date >= @startDate'); baseParams.startDate = query.startDate }
  if (query.endDate) { baseWhere.push('f.fee_date <= @endDate'); baseParams.endDate = query.endDate }
  if (query.branchId) { baseWhere.push('f.branch_id = @branchId'); baseParams.branchId = query.branchId }

  let snapshotMaxId = clampInt(query.snapshotMaxId, 0, 0, Number.MAX_SAFE_INTEGER)
  if (!snapshotMaxId) {
    const snapshotRow = await db.prepare(`SELECT MAX(f.id) AS max_id FROM fees f WHERE ${baseWhere.join(' AND ')}`).get<{ max_id: number | null }>(baseParams)
    snapshotMaxId = Number(snapshotRow?.max_id) || 0
  }
  if (!snapshotMaxId) {
    return c.json({ rows: [], snapshot_max_id: null, has_more: false, next_cursor: null })
  }

  const detailWhere = [...baseWhere, 'f.id <= @snapshotMaxId']
  const detailParams: Record<string, unknown> = { ...baseParams, snapshotMaxId }
  const afterCreatedAt = String(query.afterCreatedAt || '').trim()
  const afterId = Number(query.afterId)
  // order=desc walks newest-first (Reports hub lists); the workbook export keeps the ascending default.
  const descending = String(query.order || '').trim().toLowerCase() === 'desc'
  if (afterCreatedAt && Number.isSafeInteger(afterId) && afterId > 0) {
    const cmp = descending ? '<' : '>'
    detailWhere.push(`(datetime(f.created_at) ${cmp} datetime(@afterCreatedAt) OR (datetime(f.created_at) = datetime(@afterCreatedAt) AND f.id ${cmp} @afterId))`)
    detailParams.afterCreatedAt = afterCreatedAt
    detailParams.afterId = afterId
  }

  const pageRows = await db.prepare(`
    SELECT f.id, f.fee_date, f.created_at, f.fee_type, f.label, b.name AS branch_name,
           s.receipt_number AS sale_receipt_number, f.notes, f.amount_usd, f.amount_khr
    FROM fees f
    LEFT JOIN branches b ON b.id = f.branch_id
    LEFT JOIN sales s ON s.id = f.sale_id
    WHERE ${detailWhere.join(' AND ')}
    ORDER BY datetime(f.created_at) ${descending ? 'DESC' : 'ASC'}, f.id ${descending ? 'DESC' : 'ASC'}
    LIMIT @pageSize
  `).all<ExpenseReportSourceRow & { id: number }>({ ...detailParams, pageSize: pageSize + 1 })

  const hasMore = pageRows.length > pageSize
  const expenses = hasMore ? pageRows.slice(0, pageSize) : pageRows
  const lastExpense = expenses[expenses.length - 1] || null
  const nextCursor = hasMore && lastExpense ? { created_at: lastExpense.created_at, id: lastExpense.id } : null

  return c.json({
    rows: expenses.map((row) => ({ id: row.id, ...buildExpenseReportRow(row) })),
    snapshot_max_id: snapshotMaxId,
    has_more: hasMore,
    next_cursor: nextCursor,
  })
})

// ---------------------------------------------------------------------------
// Reports redesign (Sep 3 2026, lane sec-10 / session 8c): overview, period
// roll-ups and grouped views for the Sales > Reports section. Pure helpers
// first (pinned by scripts/test-reports-views-pure.cjs), routes after. All
// money comes from the salesAnalytics kernel -- nothing here re-derives
// revenue; these routes only slice, roll up and GATE it.
// ---------------------------------------------------------------------------

type KernelTotals = Awaited<ReturnType<typeof getSalesTotals>>
type SummaryDayRow = Awaited<ReturnType<typeof getBusinessSummaryDayRows>>[number]

export type ReportGranularity = 'day' | 'week' | 'month'

export interface PeriodReportRow extends KernelTotals {
  period: string
  date_from: string
  date_to: string
  days: number
  cost_missing_snapshot_lines: number
}

function isClock(v: unknown): v is string {
  return typeof v === 'string' && /^\d{2}:\d{2}$/.test(v)
}

export function parseGranularity(raw: unknown): ReportGranularity {
  const v = String(raw || '').trim().toLowerCase()
  return v === 'week' || v === 'month' ? v : 'day'
}

/**
 * Full SalesFilters from a query string. parseFilters (above) only takes
 * date + branch because the workbook export has no narrower scope; the
 * on-screen views also narrow by status, payment method and time of day --
 * the SAME fields whereActiveSales understands, so every view and the
 * headline totals agree for one set of controls.
 */
export function parseViewFilters(query: Record<string, string>): SalesFilters {
  const f: SalesFilters = { ...parseFilters(query) }
  const status = String(query.status || '').trim().toLowerCase()
  if (status) f.status = status
  const paymentMethod = String(query.paymentMethod || '').trim()
  if (paymentMethod) f.paymentMethod = paymentMethod
  if (isClock(query.startTime) && isClock(query.endTime)) {
    f.startTime = query.startTime
    f.endTime = query.endTime
  }
  return f
}

/**
 * Admin-only money never leaves the server for a non-admin caller. The
 * cost / profit / margin keys are NOT assigned (a client cannot tell "0"
 * from "hidden", so absence is the contract -- same rule as
 * buildDaySummaryRow / buildSaleReportRow above).
 */
export function gateTotals<T extends Record<string, unknown>>(row: T, isAdmin: boolean): Record<string, unknown> {
  const { cost_usd, profit_usd, cost_missing_snapshot_lines, ...rest } = row as Record<string, unknown>
  if (!isAdmin) return rest
  const revenue = num(rest.revenue_usd)
  const profit = num(profit_usd)
  return {
    ...rest,
    cost_usd: round2(num(cost_usd)),
    profit_usd: round2(profit),
    cost_missing_snapshot_lines: num(cost_missing_snapshot_lines),
    margin_pct: revenue > 0 ? round2((profit / revenue) * 100) : null,
  }
}

export function gateProductRow(row: Record<string, unknown>, isAdmin: boolean): Record<string, unknown> {
  const { cost_usd, profit_usd, cost_missing_snapshot_lines, ...rest } = row
  if (!isAdmin) return rest
  const lineSales = num(rest.line_sales_usd)
  const profit = num(profit_usd)
  return {
    ...rest,
    cost_usd: round2(num(cost_usd)),
    profit_usd: round2(profit),
    cost_missing_snapshot_lines: num(cost_missing_snapshot_lines),
    margin_pct: lineSales > 0 ? round2((profit / lineSales) * 100) : null,
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Period bucket of a YYYY-MM-DD business date: the date itself, its Monday-Sunday week, or its month. */
export function periodKeyFor(date: string, granularity: ReportGranularity): { period: string; date_from: string; date_to: string } {
  if (granularity === 'day') return { period: date, date_from: date, date_to: date }
  const d = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return { period: date, date_from: date, date_to: date }
  if (granularity === 'month') {
    const from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
    const to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
    return { period: date.slice(0, 7), date_from: ymd(from), date_to: ymd(to) }
  }
  // week: Monday..Sunday, keyed by the Monday date.
  const dow = d.getUTCDay() // 0 = Sunday
  const back = dow === 0 ? 6 : dow - 1
  const monday = new Date(d.getTime() - back * DAY_MS)
  const sunday = new Date(monday.getTime() + 6 * DAY_MS)
  return { period: ymd(monday), date_from: ymd(monday), date_to: ymd(sunday) }
}

const NON_ADDITIVE = new Set(['date', 'avg_order_usd'])

/**
 * Roll canonical day rows up into day / week / month rows. Every additive
 * field is summed generically (so a field added to SalesTotals later is
 * carried automatically), money is re-rounded to cents, and avg_order_usd
 * is recomputed the way deriveTotals does (revenue / tx_count). Input order
 * does not matter; output is chronological.
 */
export function rollupPeriodRows(rows: SummaryDayRow[], granularity: ReportGranularity): PeriodReportRow[] {
  const buckets = new Map<string, Record<string, number> & { period: string; date_from: string; date_to: string; days: number }>()
  for (const row of rows) {
    const key = periodKeyFor(row.date, granularity)
    let acc = buckets.get(key.period)
    if (!acc) {
      acc = { period: key.period, date_from: key.date_from, date_to: key.date_to, days: 0 } as Record<string, number> & { period: string; date_from: string; date_to: string; days: number }
      buckets.set(key.period, acc)
    }
    acc.days += 1
    for (const [k, v] of Object.entries(row as unknown as Record<string, unknown>)) {
      if (typeof v !== 'number' || NON_ADDITIVE.has(k)) continue
      acc[k] = (acc[k] || 0) + v
    }
  }
  const out: PeriodReportRow[] = []
  for (const acc of buckets.values()) {
    const finished: Record<string, unknown> = { ...acc }
    for (const [k, v] of Object.entries(acc)) {
      if (typeof v === 'number' && k.endsWith('_usd')) finished[k] = round2(v)
    }
    const tx = num(acc.tx_count)
    finished.avg_order_usd = tx > 0 ? round2(num(acc.revenue_usd) / tx) : 0
    out.push(finished as unknown as PeriodReportRow)
  }
  return out.sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0))
}

// ---------------------------------------------------------------------------
// GET /api/reports/overview -- the "All" view: one canonical totals block
// (+ optional previous period for the Δ), payment / courier breakdowns, and
// the returns + expenses totals the income statement subtracts. Each block
// is present only when the caller may read that area.
// ---------------------------------------------------------------------------
app.get('/overview', async (c) => {
  const user = c.get('user')
  const canSales = canReadSales(user)
  const canReturns = canReadReturns(user)
  const canFees = canReadFees(user)
  if (!canSales && !canReturns && !canFees) return c.json({ error: 'You do not have permission to perform this action' }, 403)
  const db = getDb(c.env)
  const query = c.req.query()
  const f = parseViewFilters(query)
  const isAdmin = isAdminControlUser(user)
  const compare = query.compare === '1' && !!f.startDate && !!f.endDate
  const prev: SalesFilters | null = compare ? { ...f, ...previousPeriodFilters(f) } : null
  const out: Record<string, unknown> = {
    is_admin: isAdmin,
    filters: f,
    previous_range: prev ? { startDate: prev.startDate, endDate: prev.endDate } : null,
  }

  if (canSales) {
    const [totals, previous, paymentMethods, couriers] = await Promise.all([
      getSalesTotals(c.env, f),
      prev ? getSalesTotals(c.env, prev) : Promise.resolve(null),
      // The SAME grouped kernel the "Payment methods" view reads (case-
      // insensitive method key, canonical revenue / collected figures), so the
      // Overview's payments fold and that view can never disagree.
      getSalesGroupedTotals(c.env, f, 'payment_method'),
      getDeliveryContactTotals(c.env, f),
    ])
    out.sales = {
      totals: gateTotals(totals as unknown as Record<string, unknown>, isAdmin),
      previous: previous ? gateTotals(previous as unknown as Record<string, unknown>, isAdmin) : null,
      payment_methods: paymentMethods.map((r) => ({
        key: r.key,
        payment_method: r.label || r.key,
        tx_count: r.tx_count,
        revenue_usd: r.revenue_usd,
        pending_revenue_usd: r.pending_revenue_usd,
        collected_usd: r.collected_total_usd,
      })),
      couriers,
    }
  }

  // Returns / expenses are date-scoped only (no time-of-day, no status): a
  // refund or a fee has no sale status or checkout time of its own.
  const dateClauses = (col: string) => {
    const clauses: string[] = []
    const params: Record<string, unknown> = {}
    return {
      forRange: (startDate: string | null | undefined, endDate: string | null | undefined) => {
        const cl = [...clauses]
        const p: Record<string, unknown> = { ...params }
        if (startDate) { cl.push(localDateAtOrAfter(col)); p.startDate = startDate }
        if (endDate) { cl.push(localDateAtOrBefore(col)); p.endDate = endDate }
        if (f.branchId) { cl.push('branch_id = @branchId'); p.branchId = f.branchId }
        return { where: cl.length ? cl.join(' AND ') : '1=1', params: p }
      },
    }
  }

  if (canReturns) {
    const base = `COALESCE(return_scope, 'customer') = 'customer' AND COALESCE(status, 'completed') <> 'cancelled'`
    const money = `COUNT(*) AS count, ROUND(COALESCE(SUM(total_refund_usd), 0), 2) AS refund_usd, ROUND(COALESCE(SUM(total_refund_khr), 0), 0) AS refund_khr`
    const cur = dateClauses('created_at').forRange(f.startDate, f.endDate)
    const shape = (r: Record<string, unknown> | null | undefined) => ({ count: num(r?.count), refund_usd: num(r?.refund_usd), refund_khr: num(r?.refund_khr) })
    const [totals, byReason, previous] = await Promise.all([
      db.prepare(`SELECT ${money} FROM returns WHERE ${base} AND ${cur.where}`).get<Record<string, unknown>>(cur.params),
      db.prepare(`SELECT COALESCE(NULLIF(TRIM(reason), ''), '') AS reason, ${money} FROM returns WHERE ${base} AND ${cur.where} GROUP BY COALESCE(NULLIF(TRIM(reason), ''), '') ORDER BY refund_usd DESC, refund_khr DESC, count DESC LIMIT 50`).all<Record<string, unknown>>(cur.params),
      prev
        ? (() => { const p = dateClauses('created_at').forRange(prev.startDate, prev.endDate); return db.prepare(`SELECT ${money} FROM returns WHERE ${base} AND ${p.where}`).get<Record<string, unknown>>(p.params) })()
        : Promise.resolve(null),
    ])
    out.returns = {
      totals: shape(totals),
      previous: previous ? shape(previous) : null,
      by_reason: (byReason || []).map((r) => ({ reason: String(r.reason || ''), ...shape(r) })),
    }
  }

  if (canFees) {
    const money = `COUNT(*) AS count, ROUND(COALESCE(SUM(amount_usd), 0), 2) AS amount_usd, ROUND(COALESCE(SUM(amount_khr), 0), 0) AS amount_khr`
    const feeRange = (startDate: string | null | undefined, endDate: string | null | undefined) => {
      const cl: string[] = []
      const p: Record<string, unknown> = {}
      if (startDate) { cl.push('fee_date >= @startDate'); p.startDate = startDate }
      if (endDate) { cl.push('fee_date <= @endDate'); p.endDate = endDate }
      if (f.branchId) { cl.push('branch_id = @branchId'); p.branchId = f.branchId }
      return { where: cl.length ? cl.join(' AND ') : '1=1', params: p }
    }
    const cur = feeRange(f.startDate, f.endDate)
    const shape = (r: Record<string, unknown> | null | undefined) => ({ count: num(r?.count), amount_usd: num(r?.amount_usd), amount_khr: num(r?.amount_khr) })
    const [totals, byType, previous] = await Promise.all([
      db.prepare(`SELECT ${money} FROM fees WHERE ${cur.where}`).get<Record<string, unknown>>(cur.params),
      db.prepare(`SELECT COALESCE(fee_type, '') AS fee_type, ${money} FROM fees WHERE ${cur.where} GROUP BY COALESCE(fee_type, '') ORDER BY amount_usd DESC, amount_khr DESC LIMIT 50`).all<Record<string, unknown>>(cur.params),
      prev
        ? (() => { const p = feeRange(prev.startDate, prev.endDate); return db.prepare(`SELECT ${money} FROM fees WHERE ${p.where}`).get<Record<string, unknown>>(p.params) })()
        : Promise.resolve(null),
    ])
    out.expenses = {
      totals: shape(totals),
      previous: previous ? shape(previous) : null,
      by_type: (byType || []).map((r) => ({ fee_type: String(r.fee_type || ''), ...shape(r) })),
    }
  }

  return c.json(out)
})

// ---------------------------------------------------------------------------
// GET /api/reports/periods?granularity=day|week|month -- canonical totals
// per period (day rows from the kernel, rolled up here), admin-gated.
// ---------------------------------------------------------------------------
app.get('/periods', async (c) => {
  const user = c.get('user')
  if (!canReadSales(user)) return c.json({ error: 'You do not have permission to perform this action' }, 403)
  const query = c.req.query()
  const f = parseViewFilters(query)
  const granularity = parseGranularity(query.granularity)
  const isAdmin = isAdminControlUser(user)
  const dayRows = await getBusinessSummaryDayRows(c.env, f)
  const rows = rollupPeriodRows(dayRows, granularity).map((r) => gateTotals(r as unknown as Record<string, unknown>, isAdmin))
  return c.json({ granularity, is_admin: isAdmin, filters: f, rows })
})

// ---------------------------------------------------------------------------
// GET /api/reports/grouped?by=customer|cashier|payment_method|hour|weekday|
// branch|product|courier -- one canonical totals row per group, admin-gated.
// ---------------------------------------------------------------------------
app.get('/grouped', async (c) => {
  const user = c.get('user')
  if (!canReadSales(user)) return c.json({ error: 'You do not have permission to perform this action' }, 403)
  const query = c.req.query()
  const f = parseViewFilters(query)
  const by = String(query.by || '').trim().toLowerCase()
  const limit = clampInt(query.limit, 300, 1, 1000)
  const isAdmin = isAdminControlUser(user)
  let rows: unknown[]
  if (by === 'product') {
    rows = (await getProductSalesRanking(c.env, f, limit)).map((r) => gateProductRow(r as unknown as Record<string, unknown>, isAdmin))
  } else if (by === 'courier') {
    rows = await getDeliveryContactTotals(c.env, f)
  } else if ((SALES_GROUP_KEYS as readonly string[]).includes(by)) {
    rows = (await getSalesGroupedTotals(c.env, f, by as SalesGroupKey, limit)).map((r) => gateTotals(r as unknown as Record<string, unknown>, isAdmin))
  } else {
    return c.json({ error: 'by must be one of customer, cashier, payment_method, hour, weekday, branch, product, courier' }, 400)
  }
  return c.json({ by, is_admin: isAdmin, filters: f, rows })
})


export default app
