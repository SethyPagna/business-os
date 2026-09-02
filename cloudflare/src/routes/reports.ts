import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { getPermissionTier, isAdminControlUser } from '../lib/permissions'
import { round2 } from '../lib/saleTotals'
import {
  getBusinessSummaryDayRows,
  recognizedExpr,
  awaitingExpr,
  netSaleExpr,
  customerDeliveryFeeExpr,
  saleStatusExpr,
  CUSTOMER_REFUND_JOIN,
  type SalesFilters,
} from '../lib/salesAnalytics'
import { localDateAtOrAfter, localDateAtOrBefore, localDateExpr } from '../lib/businessDateWindow'
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
    detailWhere.push(`(datetime(s.created_at) > datetime(@afterCreatedAt) OR (datetime(s.created_at) = datetime(@afterCreatedAt) AND s.id > @afterId))`)
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
    ORDER BY datetime(s.created_at) ASC, s.id ASC
    LIMIT @pageSize
  `).all<SaleReportSourceRow & { id: number }>({ ...detailParams, pageSize: pageSize + 1 })

  const hasMore = pageRows.length > pageSize
  const sales = hasMore ? pageRows.slice(0, pageSize) : pageRows
  const lastSale = sales[sales.length - 1] || null
  const nextCursor = hasMore && lastSale ? { created_at: lastSale.created_at, id: lastSale.id } : null

  return c.json({
    rows: sales.map((row) => buildSaleReportRow(row, isAdmin)),
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
  if (afterCreatedAt && Number.isSafeInteger(afterId) && afterId > 0) {
    detailWhere.push(`(datetime(r.created_at) > datetime(@afterCreatedAt) OR (datetime(r.created_at) = datetime(@afterCreatedAt) AND r.id > @afterId))`)
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
    ORDER BY datetime(r.created_at) ASC, r.id ASC
    LIMIT @pageSize
  `).all<ReturnReportSourceRow & { id: number }>({ ...detailParams, pageSize: pageSize + 1 })

  const hasMore = pageRows.length > pageSize
  const returns = hasMore ? pageRows.slice(0, pageSize) : pageRows
  const lastReturn = returns[returns.length - 1] || null
  const nextCursor = hasMore && lastReturn ? { created_at: lastReturn.created_at, id: lastReturn.id } : null

  return c.json({
    rows: returns.map((row) => buildReturnReportRow(row)),
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
  if (afterCreatedAt && Number.isSafeInteger(afterId) && afterId > 0) {
    detailWhere.push(`(datetime(f.created_at) > datetime(@afterCreatedAt) OR (datetime(f.created_at) = datetime(@afterCreatedAt) AND f.id > @afterId))`)
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
    ORDER BY datetime(f.created_at) ASC, f.id ASC
    LIMIT @pageSize
  `).all<ExpenseReportSourceRow & { id: number }>({ ...detailParams, pageSize: pageSize + 1 })

  const hasMore = pageRows.length > pageSize
  const expenses = hasMore ? pageRows.slice(0, pageSize) : pageRows
  const lastExpense = expenses[expenses.length - 1] || null
  const nextCursor = hasMore && lastExpense ? { created_at: lastExpense.created_at, id: lastExpense.id } : null

  return c.json({
    rows: expenses.map((row) => buildExpenseReportRow(row)),
    snapshot_max_id: snapshotMaxId,
    has_more: hasMore,
    next_cursor: nextCursor,
  })
})

export default app
