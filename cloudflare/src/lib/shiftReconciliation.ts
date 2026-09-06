/**
 * shiftReconciliation -- the ONE definition of what should be in the drawer.
 *
 * Before this module there were two answers to "is the till short?" and they
 * did not agree:
 *
 *   * the app (frontend/src/api/shiftTransport.ts) said
 *     `counted - opening float`, which calls a normal trading day a large
 *     surplus and is not a shortage figure at all; and
 *   * the Telegram shift report said `opening + cash tender - expenses`, in a
 *     private formula inside lib/telegram.ts that suppressed itself to a dash
 *     whenever the window contained a refund or a delivery, because it could
 *     not account for either.
 *
 * Both are replaced by one function, used by the close routes, the
 * current/history reads and the Telegram report, per currency and never
 * cross-converted (the drawer holds dollars and riel side by side; folding
 * them would invent an exchange rate):
 *
 *     expected   = opening float
 *                + cash tenders of sales rung in the shift
 *                - cash refunds issued during the shift
 *                - expenses recorded in the shift window
 *                - courier payouts paid in the window
 *     difference = counted - expected
 *
 * Owner rulings encoded here (Sep 6 2026), each one a decision rather than a
 * fact the schema could supply:
 *
 *   * REFUNDS are subtracted. There is no refund-tender column anywhere in the
 *     schema -- `returns` carries total_refund_usd/khr and nothing about how
 *     the money went back -- so a refund issued in the window is treated as
 *     cash out of this drawer.
 *   * COURIER payouts are subtracted, for the same reason: what a courier was
 *     actually paid (sales.delivery_actual_cost_usd/khr, migration 0068) is a
 *     payout with no tender column. The double-count guard is NOT re-invented
 *     here -- salesAnalytics.deliveryActualCostExpr already zeroes the sale's
 *     courier cost when a `fees` row of type 'delivery' exists for it, and
 *     that same guard is applied to the riel column, so a payout that was ALSO
 *     entered as an expense is subtracted exactly once.
 *   * NULL-BRANCH EXPENSES count as this shift's cash. A fee recorded with no
 *     branch was still paid out of the one drawer that was open.
 *
 * Cash recognition comes from the payment method's KIND
 * (lib/paymentMethodRegistry.ts), never from a literal method name -- see the
 * long note there on why renaming "Cash" used to empty the drawer silently.
 *
 * Everything above `loadShiftReconciliation` is pure so
 * scripts/test-shift-reconciliation-pure.cjs can execute the arithmetic
 * instead of pattern-matching a route.
 */
import { getDb } from './db'
import { resolveStoredNativeSaleChange } from './nativeSaleChange'
import { deliveryActualCostExpr, shiftWindowWhere, type SalesFilters } from './salesAnalytics'
import {
  hasConfiguredCashMethod, isCashPaymentMethod, parseConfiguredMethods, parsePaymentMethodKinds,
  PAYMENT_METHOD_KINDS_SETTING, type PaymentMethodKindMap,
} from './paymentMethodRegistry'
import type { Env } from '../index'

const round2 = (value: number) => Math.round(value * 100) / 100
const roundKhr = (value: number) => Math.round(value)
const finite = (value: unknown): number => {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

export type ShiftMoney = { usd: number; khr: number }
export type ShiftCount = { usd: number | null; khr: number | null }

export type ShiftReconciliation = {
  opening: ShiftMoney
  cash_sales: ShiftMoney
  refunds: ShiftMoney
  expenses: ShiftMoney
  courier: ShiftMoney
  expected: ShiftMoney
  counted: ShiftCount
  difference: ShiftCount
  /**
   * True when a component could not be established. Expected/difference are
   * still returned -- a stated reason beside a partial number beats a blank.
   */
  needs_review: boolean
  review_codes: string[]
}

/**
 * Why a reconciliation cannot be trusted. Codes, not sentences: the app and
 * the bot translate them through their own language packs, so the reason
 * survives the trip to a Khmer phone.
 */
export const SHIFT_REVIEW = {
  /** A sale recorded no tender, or its payment_details do not add up to it. */
  tender: 'tender_incomplete',
  /** Change was handed back in an unknown currency (pre-0100 dual columns). */
  change: 'change_ambiguous',
  /** More sales in the window than one report may read. */
  limit: 'sale_limit_reached',
  /** No configured payment method resolves to cash -- see paymentMethodRegistry. */
  cashMethod: 'cash_method_unresolved',
} as const

export type ShiftReconciliationInput = {
  opening: Partial<ShiftMoney> | null | undefined
  cashSales: Partial<ShiftMoney> | null | undefined
  refunds: Partial<ShiftMoney> | null | undefined
  expenses: Partial<ShiftMoney> | null | undefined
  courier: Partial<ShiftMoney> | null | undefined
  counted: Partial<ShiftCount> | null | undefined
  reviewCodes?: readonly string[]
}

function money(value: Partial<ShiftMoney> | null | undefined): ShiftMoney {
  return { usd: round2(finite(value?.usd)), khr: roundKhr(finite(value?.khr)) }
}
function countOf(value: Partial<ShiftCount> | null | undefined): ShiftCount {
  return {
    usd: value?.usd == null ? null : round2(finite(value.usd)),
    khr: value?.khr == null ? null : roundKhr(finite(value.khr)),
  }
}

/** The whole arithmetic, pure. Every caller goes through this. */
export function computeShiftReconciliation(input: ShiftReconciliationInput): ShiftReconciliation {
  const opening = money(input.opening)
  const cashSales = money(input.cashSales)
  const refunds = money(input.refunds)
  const expenses = money(input.expenses)
  const courier = money(input.courier)
  const counted = countOf(input.counted)
  const expected: ShiftMoney = {
    usd: round2(opening.usd + cashSales.usd - refunds.usd - expenses.usd - courier.usd),
    khr: roundKhr(opening.khr + cashSales.khr - refunds.khr - expenses.khr - courier.khr),
  }
  const codes = [...new Set((input.reviewCodes ?? []).filter(Boolean).map(String))].sort()
  return {
    opening,
    cash_sales: cashSales,
    refunds,
    expenses,
    courier,
    expected,
    counted,
    difference: {
      usd: counted.usd == null ? null : round2(counted.usd - expected.usd),
      khr: counted.khr == null ? null : roundKhr(counted.khr - expected.khr),
    },
    needs_review: codes.length > 0,
    review_codes: codes,
  }
}

// ---- cash tender -----------------------------------------------------------

type ShiftTenderRow = {
  payment_method?: unknown; payment_details?: unknown; amount_paid_usd?: unknown; amount_paid_khr?: unknown
  change_usd?: unknown; change_khr?: unknown; change_is_actual?: unknown; change_exchange_rate?: unknown
  sale_status?: unknown; total_usd?: unknown; exchange_rate?: unknown
}

export type ShiftCashOptions = {
  /** Explicit overrides from `pos_payment_method_kinds`. */
  kinds?: PaymentMethodKindMap
  /** The configured checkout list, used ONLY to detect that no method is cash. */
  configuredMethods?: string[]
}

export type ShiftCashResult = { usd: number; khr: number; needsReview: boolean; reviewCodes: string[] }

/**
 * Recorded tender only, split by kind. Old change columns hold equivalent
 * currencies rather than the note that was handed back, so only server-marked,
 * revalidated native change is subtracted; anything else keeps a review code.
 */
export function summarizeShiftCashDetail(rows: ShiftTenderRow[], options: ShiftCashOptions = {}): ShiftCashResult {
  const kinds = options.kinds ?? {}
  const codes = new Set<string>()
  let usd = 0; let khr = 0; let tendered = false
  const amount = (value: unknown) => {
    const n = Number(value ?? 0)
    if (!Number.isFinite(n) || n < 0) { codes.add(SHIFT_REVIEW.tender); return 0 }
    return n
  }
  for (const row of rows) {
    const paidUsd = amount(row.amount_paid_usd); const paidKhr = amount(row.amount_paid_khr)
    if (paidUsd || paidKhr) tendered = true
    if (!(paidUsd || paidKhr) && row.sale_status !== 'awaiting_payment' && Number(row.total_usd) > 0) codes.add(SHIFT_REVIEW.tender)
    let details: { method?: unknown; amount_usd?: unknown; amount_khr?: unknown }[]
    try {
      const parsed = typeof row.payment_details === 'string' ? JSON.parse(row.payment_details) : row.payment_details
      if (parsed != null && !Array.isArray(parsed)) throw new Error('Invalid payment details')
      details = parsed?.length ? parsed : [{ method: row.payment_method, amount_usd: paidUsd, amount_khr: paidKhr }]
      if (details.length > 12 || details.some((entry) => !entry || typeof entry !== 'object')) throw new Error('Invalid payment details')
    } catch { codes.add(SHIFT_REVIEW.tender); continue }
    let detailUsd = 0; let detailKhr = 0
    for (const detail of details) {
      const method = String(detail.method ?? '').trim().toLowerCase()
      const partUsd = amount(detail.amount_usd); const partKhr = amount(detail.amount_khr)
      detailUsd += partUsd; detailKhr += partKhr
      if ((partUsd || partKhr) && (!method || method.includes(' + '))) { codes.add(SHIFT_REVIEW.tender); continue }
      if (isCashPaymentMethod(method, kinds)) { usd += partUsd; khr += partKhr }
    }
    if (Math.abs(detailUsd - paidUsd) > 0.011 || Math.abs(detailKhr - paidKhr) > 1) codes.add(SHIFT_REVIEW.tender)
    const rate = Number(row.exchange_rate)
    if (paidKhr && !(Number.isFinite(rate) && rate > 0)) codes.add(SHIFT_REVIEW.tender)
    const change = resolveStoredNativeSaleChange({
      changeIsActual: row.change_is_actual,
      changeUsd: row.change_usd,
      changeKhr: row.change_khr,
      changeExchangeRate: row.change_exchange_rate,
    })
    if (change.kind === 'actual') { usd -= change.usd; khr -= change.khr }
    else if (change.kind === 'unknown') codes.add(SHIFT_REVIEW.change)
    if (row.total_usd != null && paidUsd + (paidKhr && rate > 0 ? paidKhr / rate : 0) > Number(row.total_usd) + 0.011
      && change.kind !== 'actual') codes.add(SHIFT_REVIEW.tender)
  }
  // The rename guard. Only meaningful once money has actually been tendered:
  // an empty shift with a misconfigured list is not evidence of a lost drawer.
  if (tendered && options.configuredMethods && options.configuredMethods.length
    && !hasConfiguredCashMethod(options.configuredMethods, kinds)) codes.add(SHIFT_REVIEW.cashMethod)
  return { usd: round2(usd), khr: roundKhr(khr), needsReview: codes.size > 0, reviewCodes: [...codes].sort() }
}

/**
 * The historical three-key shape lib/telegram.ts and its test have always
 * used. Kept as a thin wrapper so there is still exactly one implementation.
 */
export function summarizeShiftCash(rows: ShiftTenderRow[], options: ShiftCashOptions = {}) {
  const { usd, khr, needsReview } = summarizeShiftCashDetail(rows, options)
  return { usd, khr, needsReview }
}

// ---- the shift as a query --------------------------------------------------

export type ShiftReconciliationSession = {
  scope_mode?: 'per_account' | 'shop_wide'
  user_id: number
  branch_id: number | null
  opened_at: string
  closed_at: string | null
  cancelled_at?: string | null
  opening_float_usd: number
  opening_float_khr: number
  closing_counted_usd?: number | null
  closing_counted_khr?: number | null
}

/** The filter that turns "this shift" into a query the sales kernel accepts. */
export function shiftFilters(shift: ShiftReconciliationSession, nowMs: number): SalesFilters {
  return {
    createdFrom: shift.opened_at,
    // An open shift is reported up to now. shiftWindowBound normalises both.
    createdTo: shift.closed_at || shift.cancelled_at || new Date(nowMs).toISOString(),
    // A shop-wide shift belongs to the branch, not only to the employee who
    // opened it. Per-account retains the original cashier boundary.
    cashierId: shift.scope_mode === 'shop_wide' ? null : shift.user_id,
    branchId: shift.branch_id ?? null,
  }
}

async function readCashConfig(env: Env): Promise<ShiftCashOptions> {
  const rows = await getDb(env).prepare(
    `SELECT key, value FROM settings WHERE key IN ('pos_payment_methods', '${PAYMENT_METHOD_KINDS_SETTING}')`,
  ).all<{ key: string; value: string }>()
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]))
  return {
    kinds: parsePaymentMethodKinds(values[PAYMENT_METHOD_KINDS_SETTING]),
    configuredMethods: parseConfiguredMethods(values.pos_payment_methods),
  }
}

/**
 * Expenses paid out of THIS drawer: recorded inside the window, and by the
 * same employee only under per-account policy. `created_at` shares sales'
 * timestamp shape; `fee_date` is a bare day and could not tell two shifts on
 * one date apart. A fee with NO branch counts against the open drawer (owner
 * ruling) -- it was paid out of the one till that was running.
 */
export async function shiftExpenses(
  env: Env,
  shift: ShiftReconciliationSession,
  nowMs: number,
  options: { overflowLabel?: string } = {},
) {
  const { clauses, params } = shiftWindowWhere('fees', shiftFilters(shift, nowMs))
  // fees has no cashier_id -- the equivalent column is created_by. Drop the
  // clause the sales table owns and add the fees one.
  const feeClauses = clauses.filter((clause) => !clause.includes('cashier_id'))
  delete params.cashierId
  if (shift.scope_mode !== 'shop_wide') {
    feeClauses.push('fees.created_by = @createdBy')
    params.createdBy = shift.user_id
  }
  if (shift.branch_id) {
    feeClauses.push('(fees.branch_id = @branchId OR fees.branch_id IS NULL)')
    params.branchId = shift.branch_id
  }
  const rows = await getDb(env).prepare(`
    SELECT COALESCE(NULLIF(TRIM(label), ''), fee_type, 'Expense') AS label,
      COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_khr), 0) AS khr,
      SUM(SUM(amount_usd)) OVER () AS overall_usd, SUM(SUM(amount_khr)) OVER () AS overall_khr
    FROM fees
    WHERE ${feeClauses.join(' AND ')}
    GROUP BY 1 ORDER BY usd DESC, khr DESC, label LIMIT 9
  `).all<{ label: string; usd: number; khr: number; overall_usd: number; overall_khr: number }>(params)
  const total = { usd: round2(Number(rows[0]?.overall_usd || 0)), khr: roundKhr(Number(rows[0]?.overall_khr || 0)) }
  const details = rows.slice(0, 8).map(({ label, usd, khr }) => ({ label, usd: Number(usd), khr: Number(khr) }))
  if (rows.length > 8) details.push({ label: options.overflowLabel || 'Other expenses',
    usd: round2(total.usd - details.reduce((n, r) => n + r.usd, 0)), khr: roundKhr(total.khr - details.reduce((n, r) => n + r.khr, 0)) })
  return { ...total, details }
}

/** Cash tendered on sales rung in the window, minus the change handed back. */
export async function shiftCashSales(
  env: Env,
  shift: ShiftReconciliationSession,
  nowMs: number,
  options: ShiftCashOptions,
): Promise<ShiftCashResult> {
  const { clauses, params } = shiftWindowWhere('sales', shiftFilters(shift, nowMs))
  if (shift.branch_id) { clauses.push('sales.branch_id = @branchId'); params.branchId = shift.branch_id }
  clauses.push("COALESCE(NULLIF(sales.sale_status, ''), 'completed') <> 'cancelled'")
  const rows = await getDb(env).prepare(`SELECT payment_method, payment_details, amount_paid_usd, amount_paid_khr,
      change_usd, change_khr, change_is_actual, change_exchange_rate, sale_status, total_usd, exchange_rate
    FROM sales WHERE ${clauses.join(' AND ')} ORDER BY id LIMIT 5001`).all<ShiftTenderRow>(params)
  const cash = summarizeShiftCashDetail(rows.slice(0, 5000), options)
  // Bound memory and refuse a partial drawer total rather than reporting one.
  if (rows.length > 5000) {
    return { ...cash, needsReview: true, reviewCodes: [...new Set([...cash.reviewCodes, SHIFT_REVIEW.limit])].sort() }
  }
  return cash
}

/**
 * Customer refunds ISSUED during the window -- returns.created_at, not the
 * original sale's date. A return taken this shift against yesterday's receipt
 * is money that left THIS drawer, which is the opposite of how the same refund
 * is attributed for revenue (there it belongs to the sale's window). Both are
 * right for their own question; this one is about the cash box.
 */
export async function shiftRefunds(env: Env, shift: ShiftReconciliationSession, nowMs: number): Promise<ShiftMoney> {
  const { clauses, params } = shiftWindowWhere('returns', shiftFilters(shift, nowMs))
  if (shift.branch_id) { clauses.push('returns.branch_id = @branchId'); params.branchId = shift.branch_id }
  clauses.push("COALESCE(returns.status, 'completed') <> 'cancelled'")
  clauses.push("COALESCE(returns.return_scope, 'customer') = 'customer'")
  const row = await getDb(env).prepare(`SELECT COALESCE(SUM(total_refund_usd), 0) AS usd,
      COALESCE(SUM(total_refund_khr), 0) AS khr FROM returns WHERE ${clauses.join(' AND ')}`)
    .get<{ usd: number; khr: number }>(params)
  return { usd: round2(Number(row?.usd || 0)), khr: roundKhr(Number(row?.khr || 0)) }
}

/**
 * What couriers were actually paid inside the window. The USD half is the
 * sales kernel's own expression (lane boundary: salesAnalytics is owned
 * elsewhere and consumed, never edited); the riel column has no expression
 * there, so the SAME "already recorded as a delivery fee" guard is mirrored
 * onto it. test-shift-reconciliation-pure.cjs proves both currencies drop a
 * payout that also exists as a fee, so the mirror cannot drift silently.
 */
export async function shiftCourierPayouts(env: Env, shift: ShiftReconciliationSession, nowMs: number): Promise<ShiftMoney> {
  const { clauses, params } = shiftWindowWhere('sales', shiftFilters(shift, nowMs))
  if (shift.branch_id) { clauses.push('sales.branch_id = @branchId'); params.branchId = shift.branch_id }
  clauses.push("COALESCE(NULLIF(sales.sale_status, ''), 'completed') <> 'cancelled'")
  const khrExpr = `CASE WHEN EXISTS (
      SELECT 1 FROM fees
      WHERE fees.sale_id = sales.id AND COALESCE(fees.fee_type, '') = 'delivery'
    ) THEN 0 ELSE COALESCE(sales.delivery_actual_cost_khr, 0) END`
  const row = await getDb(env).prepare(`SELECT COALESCE(SUM(${deliveryActualCostExpr('sales.')}), 0) AS usd,
      COALESCE(SUM(${khrExpr}), 0) AS khr FROM sales WHERE ${clauses.join(' AND ')}`)
    .get<{ usd: number; khr: number }>(params)
  return { usd: round2(Number(row?.usd || 0)), khr: roundKhr(Number(row?.khr || 0)) }
}

/** The reconciliation for one shift, read from D1. */
export async function loadShiftReconciliation(
  env: Env,
  shift: ShiftReconciliationSession,
  nowMs: number = Date.now(),
  options: { overflowLabel?: string } = {},
): Promise<ShiftReconciliation> {
  const cashConfig = await readCashConfig(env)
  const [cash, expenses, refunds, courier] = await Promise.all([
    shiftCashSales(env, shift, nowMs, cashConfig),
    shiftExpenses(env, shift, nowMs, options),
    shiftRefunds(env, shift, nowMs),
    shiftCourierPayouts(env, shift, nowMs),
  ])
  return computeShiftReconciliation({
    opening: { usd: shift.opening_float_usd, khr: shift.opening_float_khr },
    cashSales: cash,
    refunds,
    expenses,
    courier,
    counted: { usd: shift.closing_counted_usd ?? null, khr: shift.closing_counted_khr ?? null },
    reviewCodes: cash.reviewCodes,
  })
}
