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
  // The two INVOICE-level discounts. Unchanged meaning.
  discount_usd: number
  // The per-LINE discount, which gross_sales_usd has already had taken out
  // of it -- so without this field the money is invisible on every report.
  item_discount_usd: number
  // Lines + store + membership: the owner’s "total discount".
  total_discount_usd: number
  tax_usd: number
  delivery_usd: number
  store_delivery_usd: number
  delivery_actual_cost_usd: number
  delivery_actual_cost_count: number
  delivery_sale_count: number
  delivery_margin_usd: number
  refund_usd: number
  revenue_usd: number
  pending_revenue_usd: number
  collected_total_usd: number
  avg_order_usd: number
  cost_usd?: number
  profit_usd?: number
  margin_pct?: number | null
  cost_missing_snapshot_lines?: number
}

const TOTAL_KEYS: Array<keyof ReportTotals> = [
  'tx_count', 'gross_sales_usd', 'store_discount_usd', 'membership_discount_usd', 'discount_usd',
  'item_discount_usd', 'total_discount_usd', 'tax_usd', 'delivery_usd',
  'store_delivery_usd', 'delivery_actual_cost_usd', 'delivery_actual_cost_count', 'delivery_sale_count', 'delivery_margin_usd',
  'refund_usd', 'revenue_usd', 'pending_revenue_usd', 'collected_total_usd', 'avg_order_usd',
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
  for (const r of rows) {
    for (const k of TOTAL_KEYS) {
      if (k === 'avg_order_usd') continue
      ;(out as unknown as Record<string, number>)[k] += num(r[k])
    }
    if (allProfit) {
      cost += num(r.cost_usd)
      profit += num(r.profit_usd)
      missing += num(r.cost_missing_snapshot_lines)
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
  }
  return out
}

// ---- income statement ------------------------------------------------------

export interface MoneyPair {
  usd: number
  khr: number
}

export type StatementKind = 'add' | 'sub' | 'total'
export type StatementGroup = 'revenue' | 'collected' | 'profit'

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
    // What the goods were listed at before ANY discount. gross_sales_usd is
    // the sum of subtotals and a subtotal is already net of its lines’ own
    // discounts, so the line discount has to be added back to get here.
    list_price: round2(t.gross_sales_usd + t.item_discount_usd),
    item_discounts: t.item_discount_usd,
    gross_sales: t.gross_sales_usd,
    store_discounts: t.store_discount_usd,
    membership_discounts: t.membership_discount_usd,
    total_discounts: t.total_discount_usd,
    net_sales: netSales,
    pending_credit: t.pending_revenue_usd,
    refunds: t.refund_usd,
    revenue: t.revenue_usd,
    tax_delivery_collected: round2(t.collected_total_usd - t.revenue_usd),
    collected_total: t.collected_total_usd,
  }
  if (hasProfit(t)) {
    fig.cogs = t.cost_usd
    fig.store_delivery = round2(t.revenue_usd - t.cost_usd - t.profit_usd)
    fig.gross_profit = t.profit_usd
  }
  return fig
}

/**
 * The Overview's statement. Three groups, each arithmetically closed on the
 * canonical kernel figures it was given: Gross sales -> discounts -> net
 * sales -> unpaid credit -> refunds -> REVENUE; revenue + tax/delivery ->
 * COLLECTED; revenue - COGS - store-paid delivery -> GROSS PROFIT
 * (- expenses -> NET RESULT when the profit mode is "net" and the caller
 * may read expenses). Profit lines appear only when the server sent cost.
 */
export function buildIncomeStatement(input: StatementInput): StatementLine[] {
  const { sales, prevSales, expenses, prevExpenses, profitMode, khrToUsd } = input
  if (!sales) return []
  const cur = statementFigures(sales)
  const prev = prevSales ? statementFigures(prevSales) : null
  const line = (key: string, labelKey: string, fallback: string, kind: StatementKind, group: StatementGroup, hint?: [string, string]): StatementLine => ({
    key,
    labelKey,
    fallback,
    usd: round2(num(cur[key])),
    prevUsd: prev ? round2(num(prev[key])) : null,
    kind,
    group,
    hintKey: hint?.[0],
    hintFallback: hint?.[1],
  })
  const lines: StatementLine[] = [
    line('list_price', 'rpt_list_price', 'Goods at list price', 'add', 'revenue', ['rpt_hint_list_price', 'What the items sold were priced at before any discount.']),
    line('item_discounts', 'rpt_item_discounts', 'Product discounts', 'sub', 'revenue', ['rpt_hint_item_discounts', 'Discounts given on individual lines. Already taken out of the subtotals, so it never appeared on a report before.']),
    line('gross_sales', 'gross_sales', 'Gross sales', 'total', 'revenue', ['rpt_hint_gross_sales', 'Item subtotals of every non-cancelled sale: list price less the product discounts, before the invoice-level ones.']),
    line('store_discounts', 'rpt_store_discounts', 'Store discounts', 'sub', 'revenue'),
    line('membership_discounts', 'rpt_membership_discounts', 'Membership discounts', 'sub', 'revenue'),
    line('net_sales', 'rpt_net_sales', 'Net sales', 'total', 'revenue'),
    line('pending_credit', 'rpt_pending_credit', 'Unpaid credit', 'sub', 'revenue', ['rpt_hint_pending', 'Sales awaiting payment. Counted as revenue once paid.']),
    line('refunds', 'refunds', 'Refunds', 'sub', 'revenue'),
    line('revenue', 'revenue', 'Revenue', 'total', 'revenue', ['rpt_hint_revenue', 'Net sales of recognized sales minus customer refunds. Tax and delivery are excluded.']),
    line('tax_delivery_collected', 'rpt_tax_delivery_collected', 'Tax + delivery collected', 'add', 'collected'),
    line('collected_total', 'collected_total', 'Collected total', 'total', 'collected', ['rpt_hint_collected', 'Revenue plus tax and customer-paid delivery: the money that actually changed hands.']),
  ]
  if (hasProfit(sales)) {
    lines.push(
      line('cogs', 'cogs', 'Cost of goods', 'sub', 'profit', ['rpt_hint_cogs', 'Cost snapshots of the items sold. Lines without a snapshot count as 0 and are flagged.']),
      line('store_delivery', 'rpt_store_delivery', 'Store-paid delivery', 'sub', 'profit'),
      line('gross_profit', 'rpt_gross_profit', 'Gross profit', 'total', 'profit', ['rpt_hint_gross_profit', 'Revenue minus cost of goods and store-paid delivery.']),
    )
    if (profitMode === 'net' && expenses) {
      const expUsd = round2(expenses.usd + num(khrToUsd(expenses.khr)))
      const prevExpUsd = prev && prevExpenses ? round2(prevExpenses.usd + num(khrToUsd(prevExpenses.khr))) : null
      lines.push({
        key: 'expenses',
        labelKey: 'fees',
        fallback: 'Expenses',
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
        labelKey: 'rpt_net_result',
        fallback: 'Net result',
        usd: round2(num(cur.gross_profit) - expUsd),
        prevUsd: prev && prevExpUsd != null ? round2(num(prev.gross_profit) - prevExpUsd) : null,
        kind: 'total',
        group: 'profit',
      })
    }
  }
  return lines
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
