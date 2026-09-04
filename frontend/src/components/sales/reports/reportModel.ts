// Pure, React-free model behind the Sales > Reports section (Sep 3 2026
// redesign, lane sec-10). Everything here is unit-testable in plain node
// (tests/reportsHub.test.ts): the view registry, option persistence, the
// income statement, period/previous deltas, client-side sorting and CSV
// shaping. Money math on the server is the ONE source of truth
// (cloudflare/src/lib/salesAnalytics.ts, routes/reports.ts) -- this file
// only arranges figures it received and never re-derives revenue.

export type ReportArea = 'sales' | 'returns' | 'fees'
export type ReportViewId =
  | 'overview'
  | 'periods'
  | 'sales'
  | 'products'
  | 'customers'
  | 'cashiers'
  | 'payments'
  | 'hours'
  | 'weekdays'
  | 'branches'
  | 'couriers'
  | 'returns'
  | 'expenses'
export type ReportGroupBy = 'product' | 'customer' | 'cashier' | 'payment_method' | 'hour' | 'weekday' | 'branch' | 'courier'
export type ReportStyle = 'excel' | 'receipt'
export type ReportBasis = 'revenue' | 'gross' | 'collected'
export type ReportProfitMode = 'gross' | 'net'
export type ReportGranularity = 'day' | 'week' | 'month'
export type ReportCurrency = 'setting' | 'usd' | 'khr' | 'both'

export interface ReportOptions {
  /** Which figure leads the summary line and is the margin denominator. */
  basis: ReportBasis
  /** Gross profit (kernel) or net after expenses (Overview only). */
  profitMode: ReportProfitMode
  granularity: ReportGranularity
  /** Overview: show the previous period of equal length and the change. */
  compare: boolean
  /** Display-only currency override of the display_currency setting. */
  currency: ReportCurrency
}

export const DEFAULT_REPORT_OPTIONS: ReportOptions = {
  basis: 'revenue',
  profitMode: 'gross',
  granularity: 'day',
  compare: false,
  currency: 'setting',
}

export interface ReportViewDef {
  id: ReportViewId
  /** Which permission gates the view; 'any' = visible with any of the three. */
  area: ReportArea | 'any'
  /** Menu grouping in the single View picker. */
  group: 'summary' | 'sales' | 'other'
  labelKey: string
  fallback: string
  /** Server group key for the /grouped views. */
  groupedBy?: ReportGroupBy
  /** Time-of-day narrowing applies (timestamp-backed sales data). */
  supportsTime: boolean
  /** The control-row search narrows this view. */
  supportsSearch: boolean
  /** Status / payment-method chip-selects apply. */
  supportsSaleFilters: boolean
}

export const REPORT_VIEWS: readonly ReportViewDef[] = [
  { id: 'overview', area: 'any', group: 'summary', labelKey: 'rpt_overview', fallback: 'Overview (all)', supportsTime: true, supportsSearch: false, supportsSaleFilters: true },
  { id: 'periods', area: 'sales', group: 'summary', labelKey: 'rpt_periods', fallback: 'By period', supportsTime: true, supportsSearch: false, supportsSaleFilters: true },
  { id: 'sales', area: 'sales', group: 'sales', labelKey: 'rpt_sales_list', fallback: 'Each receipt', supportsTime: true, supportsSearch: true, supportsSaleFilters: true },
  { id: 'products', area: 'sales', group: 'sales', labelKey: 'products', fallback: 'Products', groupedBy: 'product', supportsTime: true, supportsSearch: true, supportsSaleFilters: true },
  { id: 'customers', area: 'sales', group: 'sales', labelKey: 'customers', fallback: 'Customers', groupedBy: 'customer', supportsTime: true, supportsSearch: true, supportsSaleFilters: true },
  { id: 'cashiers', area: 'sales', group: 'sales', labelKey: 'rpt_cashiers', fallback: 'Cashiers', groupedBy: 'cashier', supportsTime: true, supportsSearch: true, supportsSaleFilters: true },
  { id: 'payments', area: 'sales', group: 'sales', labelKey: 'rpt_payments', fallback: 'Payment methods', groupedBy: 'payment_method', supportsTime: true, supportsSearch: true, supportsSaleFilters: true },
  { id: 'hours', area: 'sales', group: 'sales', labelKey: 'rpt_hours', fallback: 'Hours of day', groupedBy: 'hour', supportsTime: true, supportsSearch: false, supportsSaleFilters: true },
  { id: 'weekdays', area: 'sales', group: 'sales', labelKey: 'rpt_weekdays', fallback: 'Days of week', groupedBy: 'weekday', supportsTime: true, supportsSearch: false, supportsSaleFilters: true },
  { id: 'branches', area: 'sales', group: 'sales', labelKey: 'rpt_branches', fallback: 'Branches', groupedBy: 'branch', supportsTime: true, supportsSearch: true, supportsSaleFilters: true },
  { id: 'couriers', area: 'sales', group: 'sales', labelKey: 'rpt_couriers', fallback: 'Couriers', groupedBy: 'courier', supportsTime: true, supportsSearch: true, supportsSaleFilters: true },
  { id: 'returns', area: 'returns', group: 'other', labelKey: 'returns', fallback: 'Returns', supportsTime: false, supportsSearch: true, supportsSaleFilters: false },
  { id: 'expenses', area: 'fees', group: 'other', labelKey: 'fees', fallback: 'Expenses', supportsTime: false, supportsSearch: true, supportsSaleFilters: false },
]

export interface ReportPermissions {
  sales: boolean
  returns: boolean
  fees: boolean
}

export function isReportViewId(value: unknown): value is ReportViewId {
  return typeof value === 'string' && REPORT_VIEWS.some((v) => v.id === value)
}

export function getReportView(id: ReportViewId): ReportViewDef {
  const def = REPORT_VIEWS.find((v) => v.id === id)
  if (!def) throw new Error(`unknown report view: ${id}`)
  return def
}

export function viewAllowed(def: ReportViewDef, perm: ReportPermissions): boolean {
  if (def.area === 'any') return perm.sales || perm.returns || perm.fees
  return perm[def.area]
}

export function visibleReportViews(perm: ReportPermissions): ReportViewDef[] {
  return REPORT_VIEWS.filter((v) => viewAllowed(v, perm))
}

/** The stored/last view if still allowed, else the first allowed one (null when nothing is readable). */
export function resolveReportView(stored: unknown, perm: ReportPermissions): ReportViewId | null {
  if (isReportViewId(stored) && viewAllowed(getReportView(stored), perm)) return stored
  const first = visibleReportViews(perm)[0]
  return first ? first.id : null
}

// ---- filters ---------------------------------------------------------------

export interface ReportFilters {
  startDate: string
  endDate: string
  startTime: string
  endTime: string
  branchId: string
  status: string
  paymentMethod: string
}

export const EMPTY_REPORT_FILTERS: ReportFilters = { startDate: '', endDate: '', startTime: '', endTime: '', branchId: '', status: '', paymentMethod: '' }

const CLOCK_RE = /^\d{2}:\d{2}$/

/**
 * Query parameters for one view: dates + branch always; the time window
 * only for timestamp-backed sales views (returns/expenses are date-only);
 * status / payment method only where the view understands them.
 */
export function reportQueryParams(f: ReportFilters, view: ReportViewDef): Record<string, string> {
  const q: Record<string, string> = {}
  if (f.startDate) q.startDate = f.startDate
  if (f.endDate) q.endDate = f.endDate
  if (f.branchId) q.branchId = f.branchId
  if (view.supportsTime && CLOCK_RE.test(f.startTime) && CLOCK_RE.test(f.endTime) && !(f.startTime === '00:00' && f.endTime === '23:59')) {
    q.startTime = f.startTime
    q.endTime = f.endTime
  }
  if (view.supportsSaleFilters) {
    if (f.status) q.status = f.status
    if (f.paymentMethod) q.paymentMethod = f.paymentMethod
  }
  return q
}

// ---- persistence -----------------------------------------------------------

export const REPORT_STORAGE_KEYS = {
  options: 'bos:reports:options',
  view: 'bos:reports:view',
  style: 'bos:reports:style',
} as const

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const BASES: ReportBasis[] = ['revenue', 'gross', 'collected']
const PROFIT_MODES: ReportProfitMode[] = ['gross', 'net']
const GRANULARITIES: ReportGranularity[] = ['day', 'week', 'month']
const CURRENCIES: ReportCurrency[] = ['setting', 'usd', 'khr', 'both']

function pick<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  return typeof raw === 'string' && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback
}

/** Tolerant parse: unknown / malformed values fall back field by field. */
export function normalizeReportOptions(raw: unknown): ReportOptions {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    basis: pick(o.basis, BASES, DEFAULT_REPORT_OPTIONS.basis),
    profitMode: pick(o.profitMode, PROFIT_MODES, DEFAULT_REPORT_OPTIONS.profitMode),
    granularity: pick(o.granularity, GRANULARITIES, DEFAULT_REPORT_OPTIONS.granularity),
    compare: typeof o.compare === 'boolean' ? o.compare : DEFAULT_REPORT_OPTIONS.compare,
    currency: pick(o.currency, CURRENCIES, DEFAULT_REPORT_OPTIONS.currency),
  }
}

export function normalizeReportStyle(raw: unknown): ReportStyle | null {
  return raw === 'excel' || raw === 'receipt' ? raw : null
}

/** Phones read a receipt; anything wider reads a spreadsheet. Either can be chosen on any viewport. */
export function defaultReportStyle(compact: boolean): ReportStyle {
  return compact ? 'receipt' : 'excel'
}

export function readStoredJson<T>(storage: StorageLike | null | undefined, key: string, parse: (raw: unknown) => T): T {
  try {
    const text = storage ? storage.getItem(key) : null
    return parse(text ? JSON.parse(text) : undefined)
  } catch {
    return parse(undefined)
  }
}

export function writeStoredJson(storage: StorageLike | null | undefined, key: string, value: unknown): void {
  try {
    storage?.setItem(key, JSON.stringify(value))
  } catch {
    // storage may be full or disabled; the option still applies for this session.
  }
}

// ---- numbers ---------------------------------------------------------------

export function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/** A count and its noun: "1 sale", "4 sales". English needs the singular
 *  form at exactly 1; Khmer does not inflect for number, so both keys resolve
 *  to the same word there and the call stays correct in either pack. Never
 *  append a literal "s" to a translated word. */
export type ReportNoun = readonly [oneKey: string, oneFallback: string, manyKey: string, manyFallback: string]

export const REPORT_NOUNS = {
  sale: ['sale', 'Sale', 'sales', 'Sales'],
  return: ['return', 'Return', 'returns', 'Returns'],
  expense: ['expense', 'Expense', 'fees', 'Expenses'],
  product: ['product', 'Product', 'products', 'Products'],
  customer: ['customer', 'Customer', 'customers', 'Customers'],
  cashier: ['cashier', 'Cashier', 'rpt_cashiers', 'Cashiers'],
  payment_method: ['payment_method', 'Payment method', 'rpt_payments', 'Payment methods'],
  hour: ['hour', 'Hour', 'hours', 'Hours'],
  day: ['day', 'Day', 'rpt_days', 'Days'],
  weekday: ['day', 'Day', 'rpt_days', 'Days'],
  branch: ['branch', 'Branch', 'branches', 'Branches'],
  courier: ['courier', 'Courier', 'rpt_couriers', 'Couriers'],
  delivery: ['delivery', 'Delivery', 'deliveries', 'Deliveries'],
  week: ['rpt_week', 'Week', 'rpt_weeks', 'Weeks'],
  month: ['month', 'Month', 'rpt_months', 'Months'],
} as const satisfies Record<string, ReportNoun>

export function countLabel(n: number, noun: ReportNoun, tr: (key: string, fallback: string) => string, more = false): string {
  const word = n === 1 ? tr(noun[0], noun[1]) : tr(noun[2], noun[3])
  return `${fmtInt(n)}${more ? '+' : ''} ${word.toLowerCase()}`
}

export function fmtInt(n: number): string {
  return Math.round(num(n)).toLocaleString('en-US')
}

export function fmtQty(n: number): string {
  const v = num(n)
  return Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export function fmtPct(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return '—'
  return `${p.toFixed(1)}%`
}

/** part / whole as a percentage (1 decimal); null when there is no whole. */
export function pct(part: number, whole: number): number | null {
  if (!(whole > 0)) return null
  return Math.round((part / whole) * 1000) / 10
}

export interface ReportDelta {
  abs: number
  pct: number | null
}

export function delta(cur: number, prev: number | null | undefined): ReportDelta | null {
  if (prev == null || !Number.isFinite(prev)) return null
  const abs = round2(num(cur) - prev)
  return { abs, pct: prev !== 0 ? Math.round((abs / Math.abs(prev)) * 1000) / 10 : null }
}

export function formatSignedPct(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return ''
  if (p === 0) return '0.0%'
  return `${p > 0 ? '+' : '−'}${Math.abs(p).toFixed(1)}%`
}

// ---- canonical totals (as received: cost/profit keys only for admins) ----

export interface ReportTotals {
  tx_count: number
  gross_sales_usd: number
  store_discount_usd: number
  membership_discount_usd: number
  discount_usd: number
  item_discount_usd: number
  total_discount_usd: number
  tax_usd: number
  delivery_usd: number
  store_delivery_usd: number
  delivery_actual_cost_usd: number
  delivery_actual_cost_count: number
  delivery_sale_count: number
  delivery_margin_usd: number
  /** delivery_margin_usd's profit-bearing twin: recognized fees minus recognized courier cost. */
  delivery_net_usd: number
  /** The two TERMS of delivery_net_usd -- what the bridge shows instead of a residual. */
  recognized_delivery_usd: number
  recognized_delivery_cost_usd: number
  refund_usd: number
  revenue_usd: number
  pending_revenue_usd: number
  collected_total_usd: number
  avg_order_usd: number
  // ---- the awaiting-payment cohort (S4R3-6) --------------------------------
  // Reported so the theoretical block can be built; NEVER summed into a
  // realised figure. pending_cost_usd / pending_profit_usd are admin-only and
  // therefore optional, exactly like cost_usd / profit_usd below.
  pending_tx_count: number
  pending_gross_sales_usd: number
  pending_store_discount_usd: number
  pending_membership_discount_usd: number
  pending_delivery_usd: number
  pending_delivery_cost_usd: number
  cost_usd?: number
  profit_usd?: number
  margin_pct?: number | null
  cost_missing_snapshot_lines?: number
  pending_cost_usd?: number
  pending_profit_usd?: number
}

// Every field here is copied by normalizeTotals and SUMMED by sumTotals. A
// field left out of this list silently reads 0 on every totals line -- which
// looks like "the figure vanished" rather than like an error -- so a new
// non-admin field on SalesTotals belongs in the interface above AND here.
const TOTAL_KEYS: Array<keyof ReportTotals> = [
  'tx_count', 'gross_sales_usd', 'store_discount_usd', 'membership_discount_usd', 'discount_usd', 'item_discount_usd', 'total_discount_usd', 'tax_usd', 'delivery_usd',
  'store_delivery_usd', 'delivery_actual_cost_usd', 'delivery_actual_cost_count', 'delivery_sale_count', 'delivery_margin_usd',
  'delivery_net_usd', 'recognized_delivery_usd', 'recognized_delivery_cost_usd',
  'refund_usd', 'revenue_usd', 'pending_revenue_usd', 'collected_total_usd', 'avg_order_usd',
  'pending_tx_count', 'pending_gross_sales_usd', 'pending_store_discount_usd', 'pending_membership_discount_usd',
  'pending_delivery_usd', 'pending_delivery_cost_usd',
]

/**
 * Shape a server totals object. The admin-only keys are copied ONLY when
 * the server sent them -- never assigned as 0 -- so `hasProfit` can tell
 * "hidden for this caller" from "zero".
 */
export function normalizeTotals(raw: unknown): ReportTotals | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const out = {} as ReportTotals
  for (const k of TOTAL_KEYS) (out as unknown as Record<string, number>)[k] = num(r[k])
  if (typeof r.cost_usd === 'number' || typeof r.profit_usd === 'number') {
    out.cost_usd = num(r.cost_usd)
    out.profit_usd = num(r.profit_usd)
    out.margin_pct = typeof r.margin_pct === 'number' ? r.margin_pct : pct(out.profit_usd, out.revenue_usd)
    out.cost_missing_snapshot_lines = num(r.cost_missing_snapshot_lines)
    // The unpaid cohort's COGS and profit ride the same gate: gateTotals
    // strips them for a non-admin caller alongside cost_usd / profit_usd, so
    // their presence is the same "the server sent it" signal.
    out.pending_cost_usd = num(r.pending_cost_usd)
    out.pending_profit_usd = num(r.pending_profit_usd)
  }
  return out
}

export function hasProfit(t: ReportTotals | null | undefined): t is ReportTotals & { profit_usd: number; cost_usd: number } {
  return !!t && typeof t.profit_usd === 'number'
}

export function basisValue(t: ReportTotals | null | undefined, basis: ReportBasis): number {
  if (!t) return 0
  if (basis === 'gross') return t.gross_sales_usd
  if (basis === 'collected') return t.collected_total_usd
  return t.revenue_usd
}

export const BASIS_LABELS: Record<ReportBasis, { key: string; fallback: string }> = {
  revenue: { key: 'revenue', fallback: 'Revenue' },
  gross: { key: 'gross_sales', fallback: 'Gross sales' },
  collected: { key: 'collected_total', fallback: 'Collected total' },
}

/** Sum canonical rows client-side for a totals line. Profit keys survive only when EVERY row carries them. */
export function sumTotals(rows: ReportTotals[]): ReportTotals {
  const out = {} as ReportTotals
  for (const k of TOTAL_KEYS) (out as unknown as Record<string, number>)[k] = 0
  const allProfit = rows.length > 0 && rows.every((r) => hasProfit(r))
  let cost = 0
  let profit = 0
  let missing = 0
  let pendingCost = 0
  let pendingProfit = 0
  for (const r of rows) {
    for (const k of TOTAL_KEYS) {
      if (k === 'avg_order_usd') continue
      ;(out as unknown as Record<string, number>)[k] += num(r[k])
    }
    if (allProfit) {
      cost += num(r.cost_usd)
      profit += num(r.profit_usd)
      missing += num(r.cost_missing_snapshot_lines)
      pendingCost += num(r.pending_cost_usd)
      pendingProfit += num(r.pending_profit_usd)
    }
  }
  for (const k of TOTAL_KEYS) {
    if (k.endsWith('_usd')) (out as unknown as Record<string, number>)[k] = round2((out as unknown as Record<string, number>)[k])
  }
  out.avg_order_usd = out.tx_count > 0 ? round2(out.revenue_usd / out.tx_count) : 0
  if (allProfit) {
    out.cost_usd = round2(cost)
    out.profit_usd = round2(profit)
    out.margin_pct = pct(out.profit_usd, out.revenue_usd)
    out.cost_missing_snapshot_lines = missing
    out.pending_cost_usd = round2(pendingCost)
    out.pending_profit_usd = round2(pendingProfit)
  }
  return out
}

// ---- income statement ------------------------------------------------------

export interface MoneyPair {
  usd: number
  khr: number
}

/**
 * 'memo' is a figure that is REPORTED but is not a term of the arithmetic
 * around it: it carries no +/-/= operator and never enters a total. The
 * delivery reconciliation is entirely memo lines, which is what lets a reader
 * tell at a glance which rows foot and which are informational -- the exact
 * distinction the residual "Store-paid delivery" row destroyed.
 */
export type StatementKind = 'add' | 'sub' | 'total' | 'memo'
export type StatementGroup = 'revenue' | 'collected' | 'profit' | 'delivery' | 'pending'

/**
 * A qualifier rendered beside the amount when the figure is incomplete,
 * unmeasured, or covers only part of its population. `{count}` / `{total}`
 * are substituted by the caller (tr() does not interpolate).
 */
export interface StatementNote {
  key: string
  fallback: string
  count?: number
  total?: number
}

export interface StatementLine {
  key: string
  labelKey: string
  fallback: string
  usd: number
  /** Raw KHR portion when the figure is dual-currency (expenses). */
  khr?: number
  prevUsd?: number | null
  kind: StatementKind
  group: StatementGroup
  hintKey?: string
  hintFallback?: string
  note?: StatementNote
  /**
   * The figure `profitMode` selects as the bottom line ('gross' -> gross
   * profit, 'net' -> the net result). The mode no longer decides whether the
   * expenses and net-result LINES exist -- hiding them behind an
   * off-by-default option is what made the gross-profit-to-total-profit step
   * invisible -- it only decides which total the summary leads with.
   */
  headline?: boolean
}

export interface StatementInput {
  sales: ReportTotals | null
  prevSales?: ReportTotals | null
  expenses?: MoneyPair | null
  prevExpenses?: MoneyPair | null
  profitMode: ReportProfitMode
  khrToUsd: (khr: number) => number
}

function statementFigures(t: ReportTotals): Record<string, number> {
  const netSales = round2(t.gross_sales_usd - t.store_discount_usd - t.membership_discount_usd)
  const fig: Record<string, number> = {
    total_sales: round2(t.gross_sales_usd + t.item_discount_usd),
    item_discounts: t.item_discount_usd,
    store_discounts: t.store_discount_usd,
    membership_discounts: t.membership_discount_usd,
    net_sales: netSales,
    pending_credit: t.pending_revenue_usd,
    refunds: t.refund_usd,
    revenue: t.revenue_usd,
    collected_total: t.collected_total_usd,
    // ---- delivery reconciliation (memo; owner, Sep 4 2026: "so we know the
    // actual costs vs what was received or what we paid... a detailed
    // breakdown in summary"). Four measured figures, no arithmetic role.
    delivery_charged: t.delivery_usd,
    delivery_actual_cost: t.delivery_actual_cost_usd,
    delivery_absorbed: t.store_delivery_usd,
    delivery_net: t.delivery_net_usd,
    // ---- the theoretical (awaiting-payment) block ---------------------------
    pending_gross_sales: t.pending_gross_sales_usd,
    pending_discounts: round2(t.pending_store_discount_usd + t.pending_membership_discount_usd),
    // pending_revenue_usd is ALREADY net of both discounts (the kernel's
    // netSaleExpr), so the two lines above are the bridge TO it and are never
    // subtracted from it a second time.
    pending_revenue: t.pending_revenue_usd,
    pending_delivery_collected: t.pending_delivery_usd,
    pending_delivery_paid: t.pending_delivery_cost_usd,
  }
  if (hasProfit(t)) {
    // The bridge from revenue to gross profit, written as the kernel computes
    // it (salesAnalytics.ts: `profit = revenue - netCost + deliveryNet`, and
    // `deliveryNet = recognized fees - recognized courier cost`). It used to be
    // one residual line, `revenue - cost - profit`, labelled "Store-paid
    // delivery" -- a plug that always footed while naming the wrong quantity.
    fig.revenue_carried = t.revenue_usd
    fig.cogs = t.cost_usd
    fig.delivery_collected = t.recognized_delivery_usd
    fig.delivery_paid = t.recognized_delivery_cost_usd
    fig.gross_profit = t.profit_usd
    // Each term above is round2'd independently by the server, so the chain can
    // land a cent away from profit_usd. This carries that cent EXPLICITLY
    // rather than hiding it in a labelled line; it renders only when non-zero.
    fig.profit_rounding = round2(
      t.profit_usd - (t.revenue_usd - t.cost_usd + t.recognized_delivery_usd - t.recognized_delivery_cost_usd),
    )
    fig.pending_cogs = num(t.pending_cost_usd)
    fig.pending_profit = num(t.pending_profit_usd)
    fig.pending_rounding = round2(
      num(t.pending_profit_usd)
        - (t.pending_revenue_usd - num(t.pending_cost_usd) + t.pending_delivery_usd - t.pending_delivery_cost_usd),
    )
  }
  return fig
}

/**
 * The Overview's statement (S4R3-6). Five groups; every one of them is
 * arithmetically closed on the canonical kernel figures it was given, and
 * every input of every step is on screen:
 *
 *   REVENUE    gross sales - discounts -> net sales - unpaid credit
 *              - refunds -> REVENUE
 *   COLLECTED  revenue + tax/delivery -> COLLECTED TOTAL
 *   PROFIT     revenue (carried down) - COGS + delivery collected
 *              - delivery paid to couriers -> GROSS PROFIT
 *              - operating expenses -> NET RESULT
 *   DELIVERY   charged / actually paid / waived / net -- all MEMO, no operator,
 *              never a term of anything above (owner: "actual costs vs what
 *              was received or what we paid... a detailed breakdown")
 *   PENDING    the awaiting-payment cohort, the same waterfall again, sitting
 *              BELOW the final total and never absorbed by it
 *
 * The profit bridge is unconditional once the server sent cost: it does NOT
 * depend on `profitMode`, which now only selects which figure the summary line
 * leads with. Gating the expenses and net-result lines behind an off-by-default
 * option is what made "gross profit -> total profit" invisible.
 *
 * Cost / profit lines still appear only when the server SENT cost -- their
 * absence is a permission boundary (gateTotals strips them for a non-admin),
 * not missing data, and inventing a $0.00 COGS for a caller who may not see
 * cost would be worse than omitting the block. Missing data inside a block the
 * caller CAN see is labelled instead: see `note` on the COGS and delivery
 * lines.
 */
export function buildIncomeStatement(input: StatementInput): StatementLine[] {
  const { sales, prevSales, expenses, prevExpenses, profitMode, khrToUsd } = input
  if (!sales) return []
  const cur = statementFigures(sales)
  const prev = prevSales ? statementFigures(prevSales) : null
  const line = (key: string, labelKey: string, fallback: string, kind: StatementKind, group: StatementGroup, hint?: [string, string], note?: StatementNote): StatementLine => ({
    key,
    labelKey,
    fallback,
    usd: round2(num(cur[key])),
    prevUsd: prev ? round2(num(prev[key])) : null,
    kind,
    group,
    hintKey: hint?.[0],
    hintFallback: hint?.[1],
    note,
  })
  const lines: StatementLine[] = [
    line('total_sales', 'rpt_total_sales', 'Total sales', 'add', 'revenue', ['rpt_hint_total_sales', 'Value of every non-cancelled sale before line and invoice discounts.']),
    line('item_discounts', 'rpt_item_discounts', 'Item discounts', 'sub', 'revenue'),
    line('store_discounts', 'rpt_store_discounts', 'Store discounts', 'sub', 'revenue'),
    line('membership_discounts', 'rpt_membership_discounts', 'Membership discounts', 'sub', 'revenue'),
    line('net_sales', 'rpt_net_sales', 'Net sales', 'total', 'revenue'),
    line('refunds', 'refunds', 'Refunds', 'sub', 'revenue'),
    line('revenue', 'revenue', 'Revenue', 'total', 'revenue', ['rpt_hint_revenue', 'Net sales of all non-cancelled sales minus refunds. Tax and delivery are excluded.']),
    line('collected_total', 'collected_total', 'Collected total', 'total', 'collected', ['rpt_hint_collected', 'Cash actually collected; Not Paid sales are excluded.']),
  ]
  if (hasProfit(sales)) {
    lines.push(
      line('revenue_carried', 'rpt_revenue_carried', 'Revenue (from above)', 'total', 'profit', ['rpt_hint_revenue_carried', 'The revenue line repeated, so the first input of the profit calculation is on screen beside the figures taken off it.']),
      line('cogs', 'cogs', 'Cost of goods sold', 'sub', 'profit', ['rpt_hint_cogs', 'Cost snapshots of the items sold, less the cost of goods a return put back on the sellable shelf. Lines without a snapshot count as 0 and are flagged.'], cogsNote(sales)),
      line('delivery_collected', 'rpt_delivery_collected', 'Delivery fees collected', 'add', 'profit', ['rpt_hint_delivery_collected', 'Delivery fees customers actually paid, on recognized sales. A fee the shop waived was never collected and is not here.']),
      line('delivery_paid', 'rpt_delivery_paid', 'Delivery paid to couriers', 'sub', 'profit', ['rpt_hint_delivery_paid', 'The courier money actually paid out and recorded on recognized sales. This is the real delivery cost, not a residual.'], deliveryCoverageNote(sales)),
    )
    const rounding = line('profit_rounding', 'rpt_rounding', 'Rounding', 'add', 'profit', ['rpt_hint_rounding', 'Each figure above is rounded to the cent on its own, so the chain can land a cent from the total. Shown rather than absorbed into a line.'])
    if (rounding.usd !== 0) lines.push(rounding)
    lines.push({ ...line('gross_profit', 'rpt_gross_profit', 'Total Profit', 'total', 'profit', ['rpt_hint_gross_profit', 'Revenue minus cost of goods sold, plus delivery fees charged, minus courier costs. Includes Not Paid sales.']), headline: profitMode === 'gross' })
    // Expenses and the net result are no longer gated on the profit mode --
    // only on whether the caller may read expenses at all. `expenses` is null
    // exactly when the server withheld the block.
    if (expenses) {
      const expUsd = round2(expenses.usd + num(khrToUsd(expenses.khr)))
      const prevExpUsd = prev && prevExpenses ? round2(prevExpenses.usd + num(khrToUsd(prevExpenses.khr))) : null
      lines.push({
        key: 'expenses',
        labelKey: 'rpt_operating_expenses',
        fallback: 'Operating expenses',
        usd: expUsd,
        khr: expenses.khr,
        prevUsd: prevExpUsd,
        kind: 'sub',
        group: 'profit',
        hintKey: 'rpt_hint_expenses_line',
        hintFallback: 'Recorded expenses in the date range (all types). KHR amounts are converted at the main rate for the net result.',
      })
      lines.push({
        key: 'net_result',
        labelKey: 'rpt_total_profit',
        fallback: 'Final Profit',
        usd: round2(num(cur.gross_profit) - expUsd),
        prevUsd: prev && prevExpUsd != null ? round2(num(prev.gross_profit) - prevExpUsd) : null,
        kind: 'total',
        group: 'profit',
        headline: profitMode === 'net',
        hintKey: 'rpt_hint_net_result',
        hintFallback: 'Gross profit minus every recorded expense in the range. This is the bottom line.',
      })
    }
  }
  lines.push(...deliveryReconciliationLines(sales, line))
  lines.push(...pendingLines(sales, line))
  return lines
}

type LineFactory = (key: string, labelKey: string, fallback: string, kind: StatementKind, group: StatementGroup, hint?: [string, string], note?: StatementNote) => StatementLine

/**
 * "Not available" beats a silent $0.00. A period whose sold lines carry no
 * cost snapshot reports COGS of exactly 0, which reads as free goods; the
 * count is already on the wire for precisely this.
 */
function cogsNote(t: ReportTotals): StatementNote | undefined {
  const missing = num(t.cost_missing_snapshot_lines)
  if (missing <= 0) return undefined
  if (num(t.cost_usd) === 0) return { key: 'rpt_note_cost_unavailable', fallback: 'not available — no cost recorded on {count} sold lines', count: missing }
  return { key: 'rpt_note_cost_partial', fallback: '{count} sold lines have no cost recorded', count: missing }
}

/**
 * The courier cost is NULL, not 0, when nobody recorded it -- the kernel says
 * so in as many words ("a near-empty column reads as missing data rather than
 * free delivery"). Say how much of the population the figure actually covers.
 */
function deliveryCoverageNote(t: ReportTotals): StatementNote | undefined {
  const deliveries = num(t.delivery_sale_count)
  const recorded = num(t.delivery_actual_cost_count)
  if (deliveries <= 0 || recorded >= deliveries) return undefined
  if (recorded === 0) return { key: 'rpt_note_delivery_none', fallback: 'not available — no courier cost recorded on {total} deliveries', total: deliveries }
  return { key: 'rpt_note_delivery_partial', fallback: 'recorded on {count} of {total} deliveries', count: recorded, total: deliveries }
}

/**
 * The delivery reconciliation the owner asked for in as many words: "so we
 * know the actual costs vs what was received or what we paid... a detailed
 * breakdown in summary" (Sep 4 2026). Charged / actually paid / waived / net.
 *
 * Every line is a MEMO: none of them is a term of the profit bridge above (the
 * bridge uses the recognized-only halves of delivery_net_usd; these describe
 * every delivery in the window, unpaid ones included). Rendering them without
 * an operator is what keeps the distinction readable, which is exactly what
 * the old residual row destroyed.
 */
function deliveryReconciliationLines(t: ReportTotals, line: LineFactory): StatementLine[] {
  const anyDelivery = num(t.delivery_sale_count) > 0 || t.delivery_usd !== 0 || t.store_delivery_usd !== 0 || t.delivery_actual_cost_usd !== 0
  if (!anyDelivery) return []
  return [
    line('delivery_charged', 'rpt_delivery_charged', 'Charged to customers', 'memo', 'delivery', ['rpt_hint_delivery_charged', 'Delivery fees billed to customers on every delivery in the range. A fee the shop absorbed is not counted here.']),
    line('delivery_actual_cost', 'rpt_delivery_cost', 'Actual cost', 'memo', 'delivery', ['rpt_hint_delivery_actual', 'The courier money actually paid out, recorded on the sale. Never printed on a receipt; reported here so actual cost can be compared with what was charged.'], deliveryCoverageNote(t)),
    line('delivery_absorbed', 'rpt_store_delivery', 'Store-paid delivery', 'memo', 'delivery', ['rpt_hint_delivery_absorbed', 'Delivery the shop absorbed instead of charging. Revenue given away, not cash paid out, so it is reported here and never subtracted from profit.']),
    line('delivery_net', 'rpt_delivery_net', 'Delivery contribution', 'memo', 'delivery', ['rpt_hint_delivery_net', 'Fees collected minus courier money paid out, on recognized sales. This is the delivery figure gross profit actually uses.']),
  ]
}

/**
 * The theoretical block: what the period WOULD be worth once the outstanding
 * sales are paid. Same waterfall, same bases, kept strictly apart.
 *
 * BINDING (user ruling, Sep 4 2026, carried over from the shift report where
 * unpaid credit was deliberately moved BELOW the final total and relabelled):
 * unpaid money stays out of the realised arithmetic. These lines are emitted
 * LAST so no realised total can precede them, they carry their own group, and
 * nothing above reads any of them.
 */
function pendingLines(t: ReportTotals, line: LineFactory): StatementLine[] {
  if (num(t.pending_tx_count) <= 0 && t.pending_revenue_usd === 0) return []
  return [line('pending_revenue', 'rpt_pending_credit', 'Not Paid', 'memo', 'pending', ['rpt_hint_pending', 'Included in sales, revenue, and profit, but excluded from collected cash.'])]
}

/**
 * Render order for the statement's groups. The three surfaces that render a
 * statement (Overview, and the per-row folds in By period / grouped views) all
 * read this ONE list -- they each carried their own `['revenue','collected',
 * 'profit'] as const`, so a new group appeared on none of them until all three
 * were edited. PENDING is last on purpose: the awaiting-payment block sits
 * BELOW the final realised total (user ruling, Sep 4 2026).
 */
export const STATEMENT_GROUPS: readonly StatementGroup[] = ['revenue', 'collected', 'profit', 'delivery', 'pending']

export function statementGroupLabel(group: StatementGroup, tr: (key: string, fallback: string) => string): string {
  if (group === 'revenue') return tr('revenue', 'Revenue')
  if (group === 'collected') return tr('rpt_collected_group', 'Collected')
  if (group === 'delivery') return tr('rpt_delivery_breakdown', 'Delivery: charged vs paid')
  if (group === 'pending') return tr('rpt_pending_credit', 'Not Paid')
  return tr('profit', 'Profit')
}

/**
 * Which statement groups are THEORETICAL money and must be set apart from the
 * realised figures visually, not merely by position. Read by all three
 * surfaces that render a statement, so the tint cannot end up on one of them
 * and not the others.
 *
 * Binding ruling (user, Sep 4 2026, carried over from the shift report):
 * unpaid money sits BELOW the final total, labelled as unpaid, and no realised
 * total absorbs it.
 */
export function isTheoreticalGroup(group: StatementGroup): boolean {
  return group === 'pending'
}

/**
 * StatementKind -> ReceiptSheet's line kind. A memo carries no operator, so it
 * renders as 'info' -- the receipt style's own "reported, not a term" kind.
 */
export function receiptLineKind(kind: StatementKind): 'add' | 'sub' | 'total' | 'info' {
  return kind === 'memo' ? 'info' : kind
}

/** The +/-/= glyph a statement line leads with. A memo shows none. */
export function statementOperator(kind: StatementKind): string {
  if (kind === 'sub') return '−'
  if (kind === 'add') return '+'
  if (kind === 'total') return '='
  return ''
}

/** Substitute a note's {count} / {total} -- tr() itself never interpolates. */
export function statementNoteText(note: StatementNote, tr: (key: string, fallback: string) => string): string {
  return tr(note.key, note.fallback)
    .replace('{count}', fmtInt(num(note.count)))
    .replace('{total}', fmtInt(num(note.total)))
}

// ---- summary line ----------------------------------------------------------

/** "a | b | c" -- the app's text-summary convention (no stat tiles). */
export function joinSummary(parts: Array<string | null | undefined | false>): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' | ')
}

// ---- group labels ----------------------------------------------------------

export const WEEKDAY_LABEL_KEYS: ReadonlyArray<{ key: string; fallback: string }> = [
  { key: 'rpt_sunday', fallback: 'Sunday' },
  { key: 'rpt_monday', fallback: 'Monday' },
  { key: 'rpt_tuesday', fallback: 'Tuesday' },
  { key: 'rpt_wednesday', fallback: 'Wednesday' },
  { key: 'rpt_thursday', fallback: 'Thursday' },
  { key: 'rpt_friday', fallback: 'Friday' },
  { key: 'rpt_saturday', fallback: 'Saturday' },
]

/** '13' -> '13:00–13:59' (24-hour, app-wide convention). */
export function hourRangeLabel(hh: string): string {
  const h = String(hh).padStart(2, '0').slice(0, 2)
  return /^\d{2}$/.test(h) ? `${h}:00–${h}:59` : String(hh)
}

/**
 * Monday date -> "dd/mm/yyyy – dd/mm/yyyy"; a day -> dd/mm/yyyy (both via the
 * injected fmtDate, so they follow the app-wide day-first convention).
 * 'YYYY-MM' -> 'mm/yyyy', which is left alone deliberately: a month/year
 * label has no day in it, so there is no order to invert.
 */
export function periodLabel(row: { period: string; date_from: string; date_to: string }, granularity: ReportGranularity, fmtDate: (iso: string) => string): string {
  if (granularity === 'month') {
    const m = row.period.match(/^(\d{4})-(\d{2})$/)
    return m ? `${m[2]}/${m[1]}` : row.period
  }
  if (granularity === 'week') return `${fmtDate(row.date_from)} – ${fmtDate(row.date_to)}`
  return fmtDate(row.period)
}

// ---- sorting + CSV ---------------------------------------------------------

export type SortDir = 'asc' | 'desc'

export interface SortState {
  key: string
  dir: SortDir
}

export function toggleSort(current: SortState | null, key: string, defaultDir: SortDir = 'desc'): SortState {
  if (!current || current.key !== key) return { key, dir: defaultDir }
  return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
}

/** Stable sort; numbers numerically, strings by locale, empties last. */
export function sortRows<Row>(rows: Row[], value: (row: Row) => string | number | null | undefined, dir: SortDir): Row[] {
  const sign = dir === 'asc' ? 1 : -1
  return rows
    .map((row, index) => ({ row, index, v: value(row) }))
    .sort((a, b) => {
      const av = a.v
      const bv = b.v
      const aEmpty = av == null || av === ''
      const bEmpty = bv == null || bv === ''
      if (aEmpty && bEmpty) return a.index - b.index
      if (aEmpty) return 1
      if (bEmpty) return -1
      let c: number
      if (typeof av === 'number' && typeof bv === 'number') c = av - bv
      else c = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' })
      return c !== 0 ? c * sign : a.index - b.index
    })
    .map((x) => x.row)
}

export interface CsvColumn<Row> {
  header: string
  value: (row: Row) => string | number | null | undefined
}

export function rowsToCsvObjects<Row>(columns: Array<CsvColumn<Row>>, rows: Row[]): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const out: Record<string, unknown> = {}
    for (const c of columns) out[c.header] = c.value(row) ?? ''
    return out
  })
}

/** File-name-safe stamp for exports: reports-<view>-<start>_<end>.csv */
export function reportFileName(view: string, f: { startDate: string; endDate: string }, ext: string): string {
  const range = [f.startDate || 'all', f.endDate || 'all'].join('_')
  return `${view}-report-${range}.${ext}`
}
