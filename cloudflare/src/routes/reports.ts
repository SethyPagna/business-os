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

// The business-summary endpoints that shared this file on the RC trunk are
// deliberately NOT ported here: they belong to the business-workbook lane and
// have never shipped on this line. This file carries only the reports hub's
// own /overview, /periods and /grouped views.

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
