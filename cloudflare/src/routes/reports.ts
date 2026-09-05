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
  whereActiveSales, netRefundExpr, collectedSaleExpr, deliveryActualCostExpr, RESTOCKED_RETURN_LINE,
  shiftWindowBound,
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

// Per-record readers below also back the Reports hub's visible detail tabs.

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
  const rawCreatedFrom = String(query.createdFrom || '').trim()
  const rawCreatedTo = String(query.createdTo || '').trim()
  if (!!rawCreatedFrom !== !!rawCreatedTo) throw new RangeError('createdFrom and createdTo must be provided together')
  if (rawCreatedFrom && rawCreatedTo) {
    const createdFrom = shiftWindowBound(rawCreatedFrom)
    const createdTo = shiftWindowBound(rawCreatedTo)
    if (!createdFrom || !createdTo) throw new RangeError('createdFrom and createdTo must be valid timestamps')
    if (createdFrom >= createdTo) throw new RangeError('createdTo must be after createdFrom')
    f.createdFrom = createdFrom
    f.createdTo = createdTo
  } else if (isClock(query.startTime) && isClock(query.endTime)) {
    // Backward-compatible recurring daily mask for old/direct callers. The
    // Reports UI no longer emits this shape for endpoint date-times.
    f.startTime = query.startTime
    f.endTime = query.endTime
  }
  return f
}

type ReportRecordKind = 'returns' | 'expenses'

/**
 * One cohort predicate for report totals and record pages. Exact report
 * moments always use the row's system-entry timestamp. Without exact bounds,
 * returns retain their local created-at date and expenses retain fee_date.
 */
export function reportRecordRange(kind: ReportRecordKind, alias: string, f: SalesFilters): { sql: string; params: Record<string, unknown> } {
  const clauses: string[] = []
  const params: Record<string, unknown> = {}
  const createdFrom = shiftWindowBound(f.createdFrom)
  const createdTo = shiftWindowBound(f.createdTo)
  if (createdFrom && createdTo) {
    clauses.push(`datetime(${alias}.created_at) >= @createdFrom`, `datetime(${alias}.created_at) < @createdTo`)
    params.createdFrom = createdFrom
    params.createdTo = createdTo
  } else if (kind === 'returns') {
    if (f.startDate) { clauses.push(localDateAtOrAfter(`${alias}.created_at`)); params.startDate = f.startDate }
    if (f.endDate) { clauses.push(localDateAtOrBefore(`${alias}.created_at`)); params.endDate = f.endDate }
  } else {
    if (f.startDate) { clauses.push(`${alias}.fee_date >= @startDate`); params.startDate = f.startDate }
    if (f.endDate) { clauses.push(`${alias}.fee_date <= @endDate`); params.endDate = f.endDate }
  }
  if (f.branchId) { clauses.push(`${alias}.branch_id = @branchId`); params.branchId = f.branchId }
  return { sql: clauses.length ? clauses.join(' AND ') : '1=1', params }
}

function filterError(error: unknown): string {
  return error instanceof RangeError ? error.message : 'Invalid report filters'
}

/**
 * Admin-only money never leaves the server for a non-admin caller. The
 * cost / profit / margin keys are NOT assigned (a client cannot tell "0"
 * from "hidden", so absence is the contract -- same rule as
 * buildDaySummaryRow / buildSaleReportRow above).
 */
export function gateTotals<T extends Record<string, unknown>>(row: T, isAdmin: boolean): Record<string, unknown> {
  // pending_cost_usd / pending_profit_usd (S4R3-6) are the awaiting-payment
  // cohort's COGS and profit -- the same class of admin-only money as
  // cost_usd / profit_usd, so they leave with them. The rest of the pending
  // block (unpaid gross sales, discounts, revenue, delivery) is sale-header
  // money any sales-reading caller can already see and stays in `rest`.
  // unvalued_cost_usd and returned_cost_shortfall_usd (Sep 6 2026) are COGS
  // the kernel HELD OUT of cost_usd -- the cost of receipts with no sale
  // value, and the part of a return's cost that had no counted cost to come
  // off. They are the same money as cost_usd, reported separately so the
  // repair is auditable rather than silent, so they leave by the same door.
  const {
    cost_usd, profit_usd, cost_missing_snapshot_lines, pending_cost_usd, pending_profit_usd,
    unvalued_cost_usd, returned_cost_shortfall_usd, ...rest
  } = row as Record<string, unknown>
  if (!isAdmin) return rest
  const revenue = num(rest.revenue_usd)
  const profit = num(profit_usd)
  return {
    ...rest,
    cost_usd: round2(num(cost_usd)),
    profit_usd: round2(profit),
    cost_missing_snapshot_lines: num(cost_missing_snapshot_lines),
    margin_pct: revenue > 0 ? round2((profit / revenue) * 100) : null,
    pending_cost_usd: round2(num(pending_cost_usd)),
    pending_profit_usd: round2(num(pending_profit_usd)),
    unvalued_cost_usd: round2(num(unvalued_cost_usd)),
    returned_cost_shortfall_usd: round2(num(returned_cost_shortfall_usd)),
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
  let f: SalesFilters
  try { f = parseViewFilters(query) } catch (error) { return c.json({ error: filterError(error) }, 400) }
  const isAdmin = isAdminControlUser(user)
  const compare = query.compare === '1' && !!f.startDate && !!f.endDate
  const prev: SalesFilters | null = compare ? { ...f, ...previousPeriodFilters(f) } : null
  const out: Record<string, unknown> = {
    is_admin: isAdmin,
    filters: f,
    previous_range: prev ? { startDate: prev.startDate, endDate: prev.endDate, createdFrom: prev.createdFrom, createdTo: prev.createdTo } : null,
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

  if (canReturns) {
  // RETURN-DATE ACTIVITY, not a revenue term. Every figure below is scoped
  // by the date the RETURN was created, which answers "what did the returns
  // desk do in this window". The kernel reverses a refund in the period of
  // the SALE it belongs to, so these two totals differ whenever a return
  // crosses a period boundary, and they are not interchangeable. Nothing may
  // subtract this from a revenue, profit or collected figure -- doing so
  // takes refunds off twice, on mismatched bases, and can drive a period
  // below zero. The sale-basis reversal is SalesTotals.refund_usd.
    const base = `COALESCE(return_scope, 'customer') = 'customer' AND COALESCE(status, 'completed') <> 'cancelled'`
    const money = `COUNT(*) AS count, ROUND(COALESCE(SUM(total_refund_usd), 0), 2) AS refund_usd, ROUND(COALESCE(SUM(total_refund_khr), 0), 0) AS refund_khr`
    const cur = reportRecordRange('returns', 'returns', f)
    const shape = (r: Record<string, unknown> | null | undefined) => ({ count: num(r?.count), refund_usd: num(r?.refund_usd), refund_khr: num(r?.refund_khr) })
    const [totals, byReason, previous] = await Promise.all([
      db.prepare(`SELECT ${money} FROM returns WHERE ${base} AND ${cur.sql}`).get<Record<string, unknown>>(cur.params),
      db.prepare(`SELECT COALESCE(NULLIF(TRIM(reason), ''), '') AS reason, ${money} FROM returns WHERE ${base} AND ${cur.sql} GROUP BY COALESCE(NULLIF(TRIM(reason), ''), '') ORDER BY refund_usd DESC, refund_khr DESC, count DESC LIMIT 50`).all<Record<string, unknown>>(cur.params),
      prev
        ? (() => { const p = reportRecordRange('returns', 'returns', prev); return db.prepare(`SELECT ${money} FROM returns WHERE ${base} AND ${p.sql}`).get<Record<string, unknown>>(p.params) })()
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
    const cur = reportRecordRange('expenses', 'fees', f)
    const shape = (r: Record<string, unknown> | null | undefined) => ({ count: num(r?.count), amount_usd: num(r?.amount_usd), amount_khr: num(r?.amount_khr) })
    const [totals, byType, previous] = await Promise.all([
      db.prepare(`SELECT ${money} FROM fees WHERE ${cur.sql}`).get<Record<string, unknown>>(cur.params),
      db.prepare(`SELECT COALESCE(fee_type, '') AS fee_type, ${money} FROM fees WHERE ${cur.sql} GROUP BY COALESCE(fee_type, '') ORDER BY amount_usd DESC, amount_khr DESC LIMIT 50`).all<Record<string, unknown>>(cur.params),
      prev
        ? (() => { const p = reportRecordRange('expenses', 'fees', prev); return db.prepare(`SELECT ${money} FROM fees WHERE ${p.sql}`).get<Record<string, unknown>>(p.params) })()
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
  let f: SalesFilters
  try { f = parseViewFilters(query) } catch (error) { return c.json({ error: filterError(error) }, 400) }
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
  let f: SalesFilters
  try { f = parseViewFilters(query) } catch (error) { return c.json({ error: filterError(error) }, 400) }
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


// Bounded record pages for the existing Sales/Returns/Expenses report tabs.
// Snapshot IDs exclude newly inserted/backdated records; they do not freeze
// updates to existing rows. Caller must restart paging when filters change.
for (const kind of ['sales', 'returns', 'expenses'] as const) {
  app.get(`/business-summary/${kind}`, async (c) => {
    const user = c.get('user')
    const allowed = kind === 'sales' ? canReadSales(user) : kind === 'returns' ? canReadReturns(user) : canReadFees(user)
    if (!allowed) return c.json({ error: 'Forbidden' }, 403)
    const query = c.req.query(); const db = getDb(c.env); const isAdmin = isAdminControlUser(user)
    let f: SalesFilters
    try { f = parseViewFilters(query) } catch (error) { return c.json({ error: filterError(error) }, 400) }
    const pageSize = clampInt(query.pageSize, 250, 1, 500)
    const table = kind === 'expenses' ? 'fees' : kind
    const alias = kind === 'sales' ? 's' : kind === 'returns' ? 'r' : 'f'
    const active = kind === 'sales' ? whereActiveSales('s', f) : { sql: '1=1', params: {} }
    const clauses = [active.sql]; const params: Record<string, unknown> = { ...active.params }
    if (kind !== 'sales') {
      const range = reportRecordRange(kind, alias, f)
      clauses.push(range.sql)
      Object.assign(params, range.params)
      // Match the Returns overview: customer returns only, excluding cancelled.
      if (kind === 'returns') clauses.push("COALESCE(r.return_scope, 'customer') = 'customer'", "COALESCE(r.status, 'completed') <> 'cancelled'")
    }
    if (query.q?.trim()) {
      const fields = kind === 'sales' ? ['receipt_number', 'customer_name', 'customer_phone', 'cashier_name', 'branch_name', 'payment_method']
        : kind === 'returns' ? ['return_number', 'receipt_number', 'customer_name', 'reason'] : ['label', 'notes', 'fee_type']
      clauses.push(`instr(lower(${fields.map((name) => `COALESCE(${alias}.${name}, '')`).join(" || ' ' || ")}), lower(@search)) > 0`)
      params.search = query.q.trim()
    }
    let snapshot = query.snapshotMaxId != null && query.snapshotMaxId !== '' ? clampInt(query.snapshotMaxId, 0, 0, Number.MAX_SAFE_INTEGER) : null
    if (snapshot == null) snapshot = num((await db.prepare(`SELECT MAX(${alias}.id) AS max_id FROM ${table} ${alias} WHERE ${clauses.join(' AND ')}`).get<{ max_id: number }>(params))?.max_id)
    if (!snapshot) return c.json({ rows: [], snapshot_max_id: 0, has_more: false, next_cursor: null })
    clauses.push(`${alias}.id <= @snapshot`); params.snapshot = snapshot
    const descending = query.order === 'desc'; const direction = descending ? 'DESC' : 'ASC'; const op = descending ? '<' : '>'
    const stamp = `COALESCE(datetime(${alias}.created_at), '')`
    const afterId = Number(query.afterId)
    if (Number.isSafeInteger(afterId) && afterId > 0) {
      clauses.push(`(${stamp} ${op} COALESCE(datetime(@afterCreatedAt), '') OR (${stamp} = COALESCE(datetime(@afterCreatedAt), '') AND ${alias}.id ${op} @afterId))`)
      params.afterCreatedAt = query.afterCreatedAt || ''; params.afterId = afterId
    }
    let select: string; let joins = ''
    if (kind === 'sales') {
      const recognized = recognizedExpr('s.'); const net = netSaleExpr('s.'); const refund = netRefundExpr('s.', 'rf.')
      const rawCost = `(COALESCE((SELECT SUM(si.cost_price_usd * si.quantity) FROM sale_items si WHERE si.sale_id=s.id),0)
        - COALESCE((SELECT SUM(CASE WHEN ${RESTOCKED_RETURN_LINE} THEN ri.cost_price_usd * ri.quantity ELSE 0 END)
          FROM return_items ri JOIN returns r ON r.id=ri.return_id WHERE r.sale_id=s.id
          AND COALESCE(r.status,'completed')<>'cancelled' AND COALESCE(r.return_scope,'customer')='customer'),0))`
      // A receipt floors its own cost; the loaded statement floors the SUM,
      // exactly like deriveTotals. Carry the un-floored value for that rollup.
      const cost = `MAX(0, ${rawCost})`
      const adminColumns = isAdmin ? `, CASE WHEN ${recognized} THEN ${cost} ELSE 0 END AS cost_usd,
        CASE WHEN ${recognized} THEN ${rawCost} ELSE 0 END AS cost_before_floor_usd,
        CASE WHEN ${recognized} THEN (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id=s.id AND si.cost_price_usd IS NULL) ELSE 0 END AS cost_missing_snapshot_lines,
        CASE WHEN ${recognized} THEN ${net}-${refund}-${cost}+${customerDeliveryFeeExpr('s.')}-${deliveryActualCostExpr('s.')} ELSE 0 END AS gross_profit_usd` : ''
      select = `s.id, s.created_at AS cursor_at, s.created_at AS date, ${localDateExpr('s.created_at')} AS business_date,
        s.receipt_number, s.branch_name AS branch, s.cashier_name AS cashier, s.customer_name AS customer, s.customer_phone,
        s.payment_method, ${saleStatusExpr('s.')} AS status, COALESCE(s.subtotal_usd,0) AS gross_sales_usd,
        COALESCE(s.discount_usd,0) AS store_discount_usd, COALESCE(s.membership_discount_usd,0) AS membership_discount_usd,
        COALESCE(s.tax_usd,0) AS tax_usd, ${customerDeliveryFeeExpr('s.')} AS delivery_usd,
        CASE WHEN ${recognized} THEN ${refund} ELSE 0 END AS refund_usd,
        CASE WHEN ${recognized} THEN ${net}-${refund} ELSE 0 END AS net_revenue_usd,
        CASE WHEN ${awaitingExpr('s.')} THEN ${net} ELSE 0 END AS pending_revenue_usd,
        CASE WHEN ${collectedSaleExpr('s.')} THEN ${net}+COALESCE(s.tax_usd,0)+${customerDeliveryFeeExpr('s.')}-COALESCE(rf.refund_usd,0) ELSE 0 END AS collected_total_usd ${adminColumns}`
      joins = `${CUSTOMER_REFUND_JOIN}s.id`
    } else if (kind === 'returns') {
      select = `r.id, r.created_at AS cursor_at, r.created_at AS date, ${localDateExpr('r.created_at')} AS business_date,
        r.return_number, r.receipt_number AS sale_receipt_number, r.customer_name AS party, r.return_scope AS scope,
        r.return_type AS type, r.reason, r.status, r.total_refund_usd AS refund_usd, r.total_refund_khr AS refund_khr`
    } else {
      select = `f.id, f.created_at AS cursor_at, f.created_at, f.fee_date AS date, f.fee_type AS type, f.label,
        b.name AS branch, s.receipt_number AS linked_sale_receipt_number, f.notes, f.amount_usd, f.amount_khr`
      joins = 'LEFT JOIN branches b ON b.id=f.branch_id LEFT JOIN sales s ON s.id=f.sale_id'
    }
    const rows = await db.prepare(`SELECT ${select} FROM ${table} ${alias} ${joins} WHERE ${clauses.join(' AND ')}
      ORDER BY ${stamp} ${direction}, ${alias}.id ${direction} LIMIT @limit`).all<Record<string, unknown>>({ ...params, limit: pageSize + 1 })
    const hasMore = rows.length > pageSize; const page = rows.slice(0, pageSize); const last = page[page.length - 1]
    return c.json({ rows: page.map(({ cursor_at, ...row }) => row), snapshot_max_id: snapshot, has_more: hasMore,
      next_cursor: hasMore && last ? { created_at: last.cursor_at || '', id: last.id } : null, is_admin: isAdmin })
  })
}

export default app
