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
 *                + additional cash added after opening
 *                + cash tenders of sales rung in the shift
 *                - cash refunds issued during the shift
 *                - expenses recorded in the shift window
 *                - courier payouts paid in the window
 *     difference = counted - expected
 *
 * Owner rulings encoded here (Sep 6 2026), each one a decision rather than a
 * fact the schema could supply:
 *
 *   * REFUNDS are subtracted, once, from the drawer of the currency they were
 *     paid in (returns.refund_currency, migration 0260); the part of a refund
 *     that lowered a Not Paid sale's debt left no drawer (see shiftRefunds).
 *   * COURIER payouts are subtracted, for the same reason: what a courier was
 *     actually paid (sales.delivery_actual_cost_usd/khr, migration 0068) is a
 *     payout with no tender column. The double-count guard is NOT re-invented
 *     here -- salesAnalytics.deliveryActualCostExpr already zeroes the sale's
 *     courier cost when a `fees` row of type 'delivery' exists for it, and
 *     that same guard is applied to the riel column, so a payout that was ALSO
 *     entered as an expense is subtracted exactly once. The payout reduces only
 *     the drawer currency it was paid in (dollars unless the sale records riel
 *     alone), see courierPayoutsWhere.
 *   * NULL-BRANCH EXPENSES count as this shift's cash. A fee recorded with no
 *     branch was still paid out of the one drawer that was open.
 *
 * Cash recognition comes from the payment method's KIND
 * (lib/paymentMethodRegistry.ts), never from a literal method name -- see the
 * long note there on why renaming "Cash" used to empty the drawer silently.
 *
 * Attribution, by the sale's payments_version (migration 0271, owner rule of
 * 21 Oct: a later payment counts in the shift that took it, old sales stay as
 * they are):
 *   * payments_version 0 (every sale today, every imported one): sale tender
 *     and courier payouts belong to sale.created_at, as they always did.
 *     Settling such a sale later updates its original shift's report; it does
 *     not move cash into the later shift.
 *   * payments_version 1: the tender is read from sale_payment_events by
 *     received_at, branch and drawer_effect = 1, 'in' added and 'out'
 *     subtracted, so a collect taken in a later shift lands in that shift. A
 *     late-recorded payment (drawer_effect = 0) is in no drawer. The 'opening'
 *     event of a sale that moved to version 1 is dated at its created_at, so
 *     no past shift changes.
 * Courier payouts stay on sale.created_at. Returns and fees use their own
 * created_at.
 *
 * Everything above `loadShiftReconciliation` is pure so
 * scripts/test-shift-reconciliation-pure.cjs can execute the arithmetic
 * instead of pattern-matching a route.
 */
import { getDb } from './db'
import { resolveStoredNativeSaleChange } from './nativeSaleChange'
import { deliveryActualCostExpr, getSalesTotals, shiftWindowBound, shiftWindowWhere, type SalesFilters } from './salesAnalytics'
import {
  hasConfiguredCashMethod, isCashPaymentMethod, parseConfiguredMethods, parsePaymentMethodKinds,
  PAYMENT_METHOD_KINDS_SETTING, type PaymentMethodKindMap,
} from './paymentMethodRegistry'
import type { Env } from '../index'

// The cash a customer refund took out of a drawer (owner rulings 29 Sep and
// 5-6 Oct 2026, migration 0260): its return value less the debt it lowered
// (owed_reduction_usd), from the dollar drawer, or -- refund_currency 'KHR' --
// that cash share of its riel figure from the riel drawer. A row from before
// 0260 (currency NULL, nothing lowered) reads as it always did: dollar cash.
// lib/returnRefundSplit.ts refundCashOut is the JS reading.
function refundCashUsdSql(alias: string): string {
  return `(COALESCE(${alias}.total_refund_usd, 0) - COALESCE(${alias}.owed_reduction_usd, 0))`
}
export function refundDrawerUsdSql(alias: string): string {
  return `(CASE WHEN ${alias}.refund_currency = 'KHR' THEN 0 ELSE ${refundCashUsdSql(alias)} END)`
}
export function refundDrawerKhrSql(alias: string): string {
  return `(CASE WHEN ${alias}.refund_currency = 'KHR' AND COALESCE(${alias}.total_refund_usd, 0) > 0
    THEN ROUND(COALESCE(${alias}.total_refund_khr, 0) * ${refundCashUsdSql(alias)} / ${alias}.total_refund_usd) ELSE 0 END)`
}

const round2 = (value: number) => Math.round(value * 100) / 100
const roundKhr = (value: number) => Math.round(value)
const finite = (value: unknown): number => {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

export type ShiftMoney = { usd: number; khr: number }
export type ShiftCount = { usd: number | null; khr: number | null }

export type ShiftReconciliation = {
  opening: ShiftCount
  /** Cash added to the drawer after opening, before the closing count. */
  additional_cash: ShiftMoney
  cash_sales: ShiftMoney
  refunds: ShiftMoney
  expenses: ShiftMoney
  courier: ShiftMoney
  expected: ShiftCount
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
  /** An administrator closed the shift at a time a cashier could not have chosen, or moved the close so a money record fell outside every shift. */
  earlierClose: 'closed_at_earlier_time',
  /** An administrator moved the opening later, so a money record fell outside every shift. */
  laterOpen: 'opened_at_later_time',
  /** The drawer was reopened from a close an administrator made at an earlier time, so the count it opens with may include later sales. */
  reopenedAfterEarlierClose: 'reopened_after_earlier_close',
} as const

const TIME_REVIEW_CODES: readonly string[] = [SHIFT_REVIEW.earlierClose, SHIFT_REVIEW.laterOpen, SHIFT_REVIEW.reopenedAfterEarlierClose]

export type ShiftReconciliationInput = {
  opening: Partial<ShiftCount> | null | undefined
  additionalCash?: Partial<ShiftMoney> | null | undefined
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
  const opening = countOf(input.opening)
  const additionalCash = money(input.additionalCash)
  const cashSales = money(input.cashSales)
  const refunds = money(input.refunds)
  const expenses = money(input.expenses)
  const courier = money(input.courier)
  const counted = countOf(input.counted)
  const expected: ShiftCount = {
    usd: opening.usd == null ? null : round2(opening.usd + additionalCash.usd + cashSales.usd - refunds.usd - expenses.usd - courier.usd),
    khr: opening.khr == null ? null : roundKhr(opening.khr + additionalCash.khr + cashSales.khr - refunds.khr - expenses.khr - courier.khr),
  }
  const codes = [...new Set((input.reviewCodes ?? []).filter(Boolean).map(String))].sort()
  return {
    opening,
    additional_cash: additionalCash,
    cash_sales: cashSales,
    refunds,
    expenses,
    courier,
    expected,
    counted,
    difference: {
      usd: counted.usd == null || expected.usd == null ? null : round2(counted.usd - expected.usd),
      khr: counted.khr == null || expected.khr == null ? null : roundKhr(counted.khr - expected.khr),
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

/** `usd`/`khr` are drawer cash net of change; `digital` is every other kind of tender. */
export type ShiftCashResult = { usd: number; khr: number; digital: ShiftMoney; needsReview: boolean; reviewCodes: string[] }

/**
 * Recorded tender only, split by kind. Old change columns hold equivalent
 * currencies rather than the note that was handed back, so only server-marked,
 * revalidated native change is subtracted; anything else keeps a review code.
 */
export function summarizeShiftCashDetail(rows: ShiftTenderRow[], options: ShiftCashOptions = {}): ShiftCashResult {
  const kinds = options.kinds ?? {}
  const codes = new Set<string>()
  let usd = 0; let khr = 0; let tendered = false
  let digitalUsd = 0; let digitalKhr = 0
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
      if (isCashPaymentMethod(method, kinds)) { usd += partUsd; khr += partKhr } else { digitalUsd += partUsd; digitalKhr += partKhr }
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
    // Over-tender with no change recorded is flagged, except a riel tender over by less than one 100-riel note: no
    // note exists to hand that back (owner ruling 27 Oct 2026, the same rule that accepts a riel tender short by under
    // 100 riel as fully paid -- lib/saleStatusResolution.ts shortfallCovered).
    const overUsd = row.total_usd == null ? 0 : paidUsd + (paidKhr && rate > 0 ? paidKhr / rate : 0) - Number(row.total_usd)
    const underOneRielNote = paidKhr > 0 && rate > 0 && overUsd * rate < 100
    if (row.total_usd != null && overUsd > 0.011 && change.kind !== 'actual' && !underOneRielNote) codes.add(SHIFT_REVIEW.tender)
  }
  // The rename guard. Only meaningful once money has actually been tendered:
  // an empty shift with a misconfigured list is not evidence of a lost drawer.
  if (tendered && options.configuredMethods && options.configuredMethods.length
    && !hasConfiguredCashMethod(options.configuredMethods, kinds)) codes.add(SHIFT_REVIEW.cashMethod)
  return {
    usd: round2(usd), khr: roundKhr(khr), digital: { usd: round2(digitalUsd), khr: roundKhr(digitalKhr) },
    needsReview: codes.size > 0, reviewCodes: [...codes].sort(),
  }
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
  id?: number
  scope_mode?: 'per_account' | 'shop_wide'
  user_id: number
  branch_id: number | null
  opened_at: string
  closed_at: string | null
  cancelled_at?: string | null
  opening_float_usd: number | null
  opening_float_khr: number | null
  additional_cash_usd?: number | null
  additional_cash_khr?: number | null
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
 * Which fees are the DELIVERY half of the expense split. One predicate for
 * both halves: shiftDeliveryFeeExpenses sums the rows it matches, and
 * shiftExpenses(..., { excludeDeliveryFees }) lists the rows it does not, so
 * a surface that prints the split with per-expense rows (the Telegram shift
 * report) lists exactly the fees composeShiftFigures counts as "other".
 */
const DELIVERY_FEE_PREDICATE = "COALESCE(fees.fee_type, '') = 'delivery'"

/**
 * SELECT columns for a `fees` scan that feeds composeShiftFigures: every fee
 * (`usd`/`khr`, its `expenses` input) and the delivery-typed subset
 * (`delivery_usd`/`delivery_khr`, its `deliveryFees` input), off ONE scan so
 * the two halves cannot come from two different sets of rows. For the
 * reports that select fees by business day rather than by drawer window (the
 * Telegram day summary and Reports overview), with the same predicate.
 */
export const FEE_SPLIT_COLUMNS = `COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_khr), 0) AS khr,
      COALESCE(SUM(CASE WHEN ${DELIVERY_FEE_PREDICATE} THEN amount_usd ELSE 0 END), 0) AS delivery_usd,
      COALESCE(SUM(CASE WHEN ${DELIVERY_FEE_PREDICATE} THEN amount_khr ELSE 0 END), 0) AS delivery_khr`

/**
 * Which `fees` rows were paid out of THIS drawer: recorded inside the window,
 * and by the same employee only under per-account policy. `created_at` shares
 * sales' timestamp shape; `fee_date` is a bare day and could not tell two
 * shifts on one date apart. A fee with NO branch counts against the open
 * drawer (owner ruling) -- it was paid out of the one till that was running.
 *
 * ONE expression, because the expense TOTAL and the delivery/other SPLIT must
 * select over exactly the same rows. A split whose halves came from a second,
 * slightly different clause would stop summing to the total the drawer was
 * reconciled against, and the shift report would foot against nothing.
 */
function shiftFeeWhere(shift: ShiftReconciliationSession, nowMs: number) {
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
  return { clauses: feeClauses, params }
}

/** Every expense paid out of this drawer, with its labelled detail rows. */
export async function shiftExpenses(
  env: Env,
  shift: ShiftReconciliationSession,
  nowMs: number,
  options: ExpenseRowOptions = {},
) {
  const { clauses, params } = shiftFeeWhere(shift, nowMs)
  return expenseRowsWhere(env, clauses, params, options)
}

export type ExpenseRowOptions = { overflowLabel?: string; excludeDeliveryFees?: boolean }

/** The `fees` rows `clauses` select, summed by label: at most eight rows and one folded "other" row. */
export async function expenseRowsWhere(env: Env, clauses: string[], params: Record<string, unknown>, options: ExpenseRowOptions = {}) {
  const feeClauses = [...clauses]
  // The "other expenses" rows only: every fee minus the delivery half, which
  // composeShiftFigures moves into the delivery cost. The total this returns
  // is then that same "other" figure, row for row.
  if (options.excludeDeliveryFees) feeClauses.push(`NOT (${DELIVERY_FEE_PREDICATE})`)
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

type ShiftPaymentEventRow = ShiftTenderRow & { id?: unknown; sale_id?: unknown; direction?: unknown }

/**
 * Net tender of payment events: what came in, less what went out. The incoming rows go through the same
 * summarizeShiftCashDetail as a sale (so change, cash kind and review codes are one implementation); the
 * outgoing rows through it as well, without the configured-method rename guard, which only means something
 * for money that came in. An undo or correction never carries change (buildPaymentEvent), so it is subtracted whole.
 */
export function summarizeShiftCashEvents(rows: ShiftPaymentEventRow[], options: ShiftCashOptions = {}): ShiftCashResult {
  const incoming = summarizeShiftCashDetail(rows.filter((row) => row.direction !== 'out'), options)
  const outgoing = summarizeShiftCashDetail(rows.filter((row) => row.direction === 'out'), { kinds: options.kinds })
  const codes = [...new Set([...incoming.reviewCodes, ...outgoing.reviewCodes])].sort()
  return {
    usd: round2(incoming.usd - outgoing.usd), khr: roundKhr(incoming.khr - outgoing.khr),
    digital: { usd: round2(incoming.digital.usd - outgoing.digital.usd), khr: roundKhr(incoming.digital.khr - outgoing.digital.khr) },
    needsReview: codes.length > 0, reviewCodes: codes,
  }
}

/**
 * The window of a shift over sale_payment_events, as SQL on alias `e`. received_at is stored in the canonical
 * 'YYYY-MM-DD HH:MM:SS' UTC shape (salePayments.canonicalEventTime), so it is compared as plain text and the planner can
 * use idx_sale_payment_events_received; the sales window has to wrap created_at in datetime() because that column has
 * several shapes. The cashier is the one who TOOK the money, not the one who rang the sale: a later collect belongs to
 * that cashier's shift.
 */
function paymentEventWindow(shift: ShiftReconciliationSession, nowMs: number): { clauses: string[]; params: Record<string, unknown> } {
  const filters = shiftFilters(shift, nowMs)
  const clauses: string[] = []
  const params: Record<string, unknown> = {}
  const from = shiftWindowBound(filters.createdFrom)
  if (from) { clauses.push('e.received_at >= @createdFrom'); params.createdFrom = from }
  const to = shiftWindowBound(filters.createdTo)
  if (to) { clauses.push('e.received_at < @createdTo'); params.createdTo = to }
  if (filters.cashierId != null && String(filters.cashierId).trim() !== '') { clauses.push('e.cashier_id = @cashierId'); params.cashierId = Number(filters.cashierId) }
  if (shift.branch_id) { clauses.push('e.branch_id = @branchId'); params.branchId = shift.branch_id }
  return { clauses, params }
}

/**
 * The payments_version 1 events received inside the shift's window, one row per event. The events are the driving
 * table (CROSS JOIN fixes the order) so the received_at index is the access path and sales is only a primary-key lookup.
 * An opening event written outside the drawer (the sale's payment_details was unreadable to the version 0 reader) comes
 * back with payment_details '' so it counts nothing and raises the same tender review code the version 0 reader raised.
 */
async function shiftPaymentEventRows(
  env: Env,
  shift: ShiftReconciliationSession,
  nowMs: number,
  limit: number,
  keepCancelled = false,
): Promise<ShiftPaymentEventRow[]> {
  const window = paymentEventWindow(shift, nowMs)
  const clauses = ['sales.payments_version = 1', "(e.drawer_effect = 1 OR e.origin = 'opening')", ...window.clauses]
  if (!keepCancelled) clauses.push("COALESCE(NULLIF(sales.sale_status, ''), 'completed') <> 'cancelled'")
  const rows = await getDb(env).prepare(`SELECT e.id, e.sale_id, e.direction, e.drawer_effect, e.payment_method, e.payment_details, e.amount_paid_usd, e.amount_paid_khr,
      e.change_usd, e.change_khr, e.change_is_actual, e.change_exchange_rate, e.exchange_rate, sales.sale_status, sales.total_usd
    FROM sale_payment_events e CROSS JOIN sales ON sales.id = e.sale_id
    WHERE ${clauses.join(' AND ')} LIMIT ${limit}`).all<ShiftPaymentEventRow & { drawer_effect?: unknown }>(window.params)
  // The sale total only means something against the money that came in (the over-tender review code); an out never carries it.
  return rows.map((row) => ({
    ...row,
    payment_details: Number(row.drawer_effect) === 0 ? '' : row.payment_details,
    total_usd: row.direction === 'out' ? undefined : row.total_usd,
  }))
}

/**
 * Cash tendered inside the window, minus the change handed back: the version 0 sales by when they were rung
 * (tenderWhere, unchanged) plus the version 1 payment events by when they were received.
 */
export async function shiftCashSales(
  env: Env,
  shift: ShiftReconciliationSession,
  nowMs: number,
  options: ShiftCashOptions,
): Promise<ShiftCashResult> {
  const { clauses, params } = shiftWindowWhere('sales', shiftFilters(shift, nowMs))
  if (shift.branch_id) { clauses.push('sales.branch_id = @branchId'); params.branchId = shift.branch_id }
  clauses.push('sales.payments_version = 0')
  const created = await tenderWhere(env, clauses, params, options)
  const eventRows = await shiftPaymentEventRows(env, shift, nowMs, 5001)
  // No version 1 money in the window: the version 0 answer, untouched.
  if (!eventRows.length) return created
  const received = summarizeShiftCashEvents(eventRows.slice(0, 5000), options)
  const codes = [...new Set([...created.reviewCodes, ...received.reviewCodes, ...(eventRows.length > 5000 ? [SHIFT_REVIEW.limit] : [])])].sort()
  return {
    usd: round2(created.usd + received.usd), khr: roundKhr(created.khr + received.khr),
    digital: { usd: round2(created.digital.usd + received.digital.usd), khr: roundKhr(created.digital.khr + received.digital.khr) },
    needsReview: codes.length > 0, reviewCodes: codes,
  }
}

/** Recorded tender on the sales `clauses` select (alias `sales`), cancelled sales always excluded. */
export async function tenderWhere(
  env: Env,
  clauses: string[],
  params: Record<string, unknown>,
  options?: ShiftCashOptions,
): Promise<ShiftCashResult> {
  const where = [...clauses, "COALESCE(NULLIF(sales.sale_status, ''), 'completed') <> 'cancelled'"]
  const rows = await getDb(env).prepare(`SELECT payment_method, payment_details, amount_paid_usd, amount_paid_khr,
      change_usd, change_khr, change_is_actual, change_exchange_rate, sale_status, total_usd, exchange_rate
    FROM sales WHERE ${where.join(' AND ')} ORDER BY id LIMIT 5001`).all<ShiftTenderRow>(params)
  const cash = summarizeShiftCashDetail(rows.slice(0, 5000), options ?? await readCashConfig(env))
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
 *
 * Each refund leaves ONE drawer (refundDrawerUsdSql / refundDrawerKhrSql):
 * total_refund_khr is the riel equivalent of the same refund
 * (customerReturnEntitlement: multiplyMoney4(usd, rate); the legacy path sums
 * the sale lines' riel twins), not a second payout, so subtracting it beside
 * the dollars took every refund out of the drawer twice (SCAN1 M2).
 */
export async function shiftRefunds(env: Env, shift: ShiftReconciliationSession, nowMs: number): Promise<ShiftMoney> {
  const { clauses, params } = shiftWindowWhere('returns', shiftFilters(shift, nowMs))
  if (shift.branch_id) { clauses.push('returns.branch_id = @branchId'); params.branchId = shift.branch_id }
  clauses.push("COALESCE(returns.status, 'completed') <> 'cancelled'")
  clauses.push("COALESCE(returns.return_scope, 'customer') = 'customer'")
  const row = await getDb(env).prepare(`SELECT COALESCE(SUM(${refundDrawerUsdSql('returns')}), 0) AS usd,
      COALESCE(SUM(${refundDrawerKhrSql('returns')}), 0) AS khr
      FROM returns WHERE ${clauses.join(' AND ')}`)
    .get<{ usd: number; khr: number }>(params)
  return { usd: round2(Number(row?.usd || 0)), khr: roundKhr(Number(row?.khr || 0)) }
}

/**
 * What couriers were actually paid on the sales `clauses` select (a `sales`
 * table scan, alias `sales`), cancelled sales always excluded. The USD half is
 * the sales kernel's own expression (lane boundary: salesAnalytics is owned
 * elsewhere and consumed, never edited); the riel column has no expression
 * there, so the SAME "already recorded as a delivery fee" guard is mirrored
 * onto it. test-shift-reconciliation-pure.cjs proves both currencies drop a
 * payout that also exists as a fee, so the mirror cannot drift silently.
 *
 * A payout leaves the drawer in ONE currency. The writers (POS, amendments)
 * store the riel twin of the dollar cost beside it, which is the same money
 * and not a second payout, exactly like a refund's riel column. So a sale with
 * a dollar cost counts in dollars only; only a sale that records riel alone
 * (an import row) counts in riel. Stored rows are read this way, never
 * rewritten.
 *
 * Every report that prints "Actual delivery cost" reads its courier half here
 * -- the shift's drawer window below, a business day (and branch) for the
 * Telegram day summary and Reports overview -- and adds the fees typed
 * 'delivery' through composeShiftFigures. NOT the kernel's
 * delivery_actual_cost_usd: that total is the raw column, unguarded, so a
 * payout also recorded as a linked delivery fee would be counted twice
 * (R-telegram E2, 27 Sep 2026).
 */
export async function courierPayoutsWhere(
  env: Env, clauses: string[], params: Record<string, unknown>, options: { formula?: number } = {},
): Promise<ShiftMoney> {
  const where = [...clauses, "COALESCE(NULLIF(sales.sale_status, ''), 'completed') <> 'cancelled'"]
  const rielTwin = (options.formula ?? SHIFT_FIGURES_FORMULA) >= 2
    ? 'WHEN COALESCE(sales.delivery_actual_cost_usd, 0) > 0 THEN 0'
    : ''
  const khrExpr = `CASE WHEN EXISTS (
      SELECT 1 FROM fees
      WHERE fees.sale_id = sales.id AND COALESCE(fees.fee_type, '') = 'delivery'
    ) THEN 0
    ${rielTwin}
    ELSE COALESCE(sales.delivery_actual_cost_khr, 0) END`
  const row = await getDb(env).prepare(`SELECT COALESCE(SUM(${deliveryActualCostExpr('sales.')}), 0) AS usd,
      COALESCE(SUM(${khrExpr}), 0) AS khr FROM sales WHERE ${where.join(' AND ')}`)
    .get<{ usd: number; khr: number }>(params)
  return { usd: round2(Number(row?.usd || 0)), khr: roundKhr(Number(row?.khr || 0)) }
}

/** What couriers were actually paid inside the shift's window. */
export async function shiftCourierPayouts(
  env: Env, shift: ShiftReconciliationSession, nowMs: number, options: { formula?: number } = {},
): Promise<ShiftMoney> {
  const { clauses, params } = shiftWindowWhere('sales', shiftFilters(shift, nowMs))
  if (shift.branch_id) { clauses.push('sales.branch_id = @branchId'); params.branchId = shift.branch_id }
  return courierPayoutsWhere(env, clauses, params, options)
}

/**
 * The latest money record in a shift's drawer window, the window held open to
 * now and a day beyond so a sale stamped ahead by a device clock still counts:
 * the newest sale rung, customer return issued or expense paid out of this
 * drawer -- the same records, filters and second resolution as the
 * reconciliation below -- as epoch ms, or null when the drawer holds none.
 *
 * A close at or before the second of that record leaves it outside the
 * drawer's half-open window, so it is counted in no shift's expected cash.
 *
 * `window` narrows the look to [from, until): the records a move of the
 * opening or the closing would leave outside every shift.
 */
export async function shiftLastActivityMs(
  env: Env, shift: ShiftReconciliationSession, nowMs: number = Date.now(), window: { from?: string; until?: string | null } = {},
): Promise<number | null> {
  const open = { ...shift, opened_at: window.from ?? shift.opened_at, closed_at: window.until ?? null, cancelled_at: null }
  const horizon = nowMs + 24 * 60 * 60 * 1000
  const sales = shiftWindowWhere('sales', shiftFilters(open, horizon))
  if (shift.branch_id) { sales.clauses.push('sales.branch_id = @branchId'); sales.params.branchId = shift.branch_id }
  sales.clauses.push("COALESCE(NULLIF(sales.sale_status, ''), 'completed') <> 'cancelled'")
  const returns = shiftWindowWhere('returns', shiftFilters(open, horizon))
  if (shift.branch_id) { returns.clauses.push('returns.branch_id = @branchId'); returns.params.branchId = shift.branch_id }
  returns.clauses.push("COALESCE(returns.status, 'completed') <> 'cancelled'", "COALESCE(returns.return_scope, 'customer') = 'customer'")
  const fees = shiftFeeWhere(open, horizon)
  const db = getDb(env)
  const latest = await Promise.all([
    db.prepare(`SELECT MAX(datetime(created_at)) AS at FROM sales WHERE ${sales.clauses.join(' AND ')}`).get<{ at: string | null }>(sales.params),
    db.prepare(`SELECT MAX(datetime(created_at)) AS at FROM returns WHERE ${returns.clauses.join(' AND ')}`).get<{ at: string | null }>(returns.params),
    db.prepare(`SELECT MAX(datetime(created_at)) AS at FROM fees WHERE ${fees.clauses.join(' AND ')}`).get<{ at: string | null }>(fees.params),
  ])
  const events = paymentEventWindow(open, horizon)
  const eventLatest = await db.prepare(`SELECT MAX(e.received_at) AS at FROM sale_payment_events e CROSS JOIN sales ON sales.id = e.sale_id
      WHERE ${['sales.payments_version = 1', 'e.drawer_effect = 1', "COALESCE(NULLIF(sales.sale_status, ''), 'completed') <> 'cancelled'", ...events.clauses].join(' AND ')}`)
    .get<{ at: string | null }>(events.params)
  latest.push(eventLatest)
  const times = latest.map((row) => (row?.at ? Date.parse(`${row.at.replace(' ', 'T')}Z`) : Number.NaN)).filter(Number.isFinite)
  return times.length ? Math.max(...times) : null
}

/**
 * A time edit by an administrator that left money records outside every shift,
 * as the amendment journal keeps it: the review code and the account that made
 * the edit. The journal is the durable home -- it is written in the same batch
 * as the edit, is never rewritten, and does not depend on the optional stored
 * figures. `after_json.time_review` is present on every journal row that
 * evaluated the times (a close, or an amend that changed one); the newest such
 * row is the shift's standing review, and an empty list is a cleared one.
 */
export type ShiftTimeReview = { code: string; by: string }

export function shiftTimeReviewCodes(review: readonly ShiftTimeReview[] | null | undefined): string[] {
  return (review ?? []).map((entry) => entry.code)
}

export async function readShiftTimeReview(env: Env, shiftId: number): Promise<ShiftTimeReview[] | null> {
  try {
    const row = await getDb(env).prepare(`SELECT json_extract(after_json, '$.time_review') AS review FROM shift_session_amendments
      WHERE shift_session_id = @id AND json_valid(after_json) AND json_type(after_json, '$.time_review') = 'array'
      ORDER BY id DESC LIMIT 1`).get<{ review: string | null }>({ id: shiftId })
    if (!row?.review) return null
    const parsed = JSON.parse(row.review) as unknown
    if (!Array.isArray(parsed)) return null
    return parsed
      .map((entry) => ({ code: String((entry as { code?: unknown })?.code ?? ''), by: String((entry as { by?: unknown })?.by ?? '') }))
      .filter((entry) => TIME_REVIEW_CODES.includes(entry.code))
  } catch { return null }
}

/**
 * The reconciliation with the shift's standing time review applied: the review
 * is authoritative for the two time codes, so a stored close that carried one is
 * cleared when a later edit cleared it. No review recorded (a shift older than
 * the journal key) leaves the reconciliation as it was.
 */
export function applyShiftTimeReview(reconciliation: ShiftReconciliation, review: readonly ShiftTimeReview[] | null | undefined): ShiftReconciliation {
  if (!review) return reconciliation
  const codes = [...new Set([...reconciliation.review_codes.filter((code) => !TIME_REVIEW_CODES.includes(code)), ...shiftTimeReviewCodes(review)])].sort()
  return { ...reconciliation, review_codes: codes, needs_review: codes.length > 0 }
}

/** The reconciliation for one shift, read from D1. */
export async function loadShiftReconciliation(
  env: Env,
  shift: ShiftReconciliationSession,
  nowMs: number = Date.now(),
  options: { overflowLabel?: string; extraReviewCodes?: readonly string[] } = {},
): Promise<ShiftReconciliation> {
  const cashConfig = await readCashConfig(env)
  const [cash, expenses, refunds, courier, timeReview] = await Promise.all([
    shiftCashSales(env, shift, nowMs, cashConfig),
    shiftExpenses(env, shift, nowMs, options),
    shiftRefunds(env, shift, nowMs),
    shiftCourierPayouts(env, shift, nowMs),
    shift.id == null ? null : readShiftTimeReview(env, shift.id),
  ])
  return computeShiftReconciliation({
    opening: { usd: shift.opening_float_usd, khr: shift.opening_float_khr },
    additionalCash: { usd: shift.additional_cash_usd ?? 0, khr: shift.additional_cash_khr ?? 0 },
    cashSales: cash,
    refunds,
    expenses,
    courier,
    counted: { usd: shift.closing_counted_usd ?? null, khr: shift.closing_counted_khr ?? null },
    reviewCodes: [...cash.reviewCodes, ...shiftTimeReviewCodes(timeReview), ...(options.extraReviewCodes ?? [])],
  })
}

// ---- the shift REPORT figures ---------------------------------------------
//
// Owner ruling (Sep 6 2026): "the registration is just a more detailed
// breakdown for shift to keep track how much is spent ... and the actual
// calculations is without this ... just the COGS, profit, sales, expenses,
// delivery etc."
//
// So the shift report has TWO halves and they never mix:
//
//   * the REGISTRATION -- opening float and closing count, per currency, at
//     open and at end. Recorded, printed, reconciled against, and read by
//     nothing else in the system. `opening`/`closing` below are that half;
//     they are carried here so the report renders one block instead of
//     digging two of the four numbers out of the shift row and two out of the
//     drawer reconciliation.
//   * the BUSINESS FIGURES -- sales, COGS, profit, delivery and expenses.
//     Every one of them comes from the sales kernel (getSalesTotals, the same
//     helper the Reports hub reads) or from the `fees` table. NONE of them is
//     derived from an opening float or a counted drawer, which is what makes
//     the registration report-only: change the count and not one figure below
//     moves.
//
// USD is the kernel's basis for sales/COGS/profit/credit/delivery fees, so
// those stay single-currency. Expenses are recorded natively in both and are
// carried as pairs, like every other fee surface.

export type ShiftFigures = {
  /** Registered cash at OPEN, per currency. Report-only. */
  opening: ShiftCount
  /** Cash added after opening; report-only, never a business result. */
  additional_cash: ShiftMoney
  /** Registered cash at END, per currency; null where nobody counted. */
  closing: ShiftCount
  sales_usd: number
  cogs_usd: number
  profit_usd: number
  /** Sales and profit without Not Paid sales (owner, 20 Oct 2026); profit absent when the kernel sent none. */
  sales_without_not_paid_usd: number
  profit_without_not_paid_usd?: number
  /**
   * Sold lines (and restocked returned lines) whose cost is UNKNOWN (NULL
   * snapshot). cogs_usd and profit_usd above are the known lines only, so a
   * non-zero count makes them partial. OPTIONAL: present only when the sales
   * kernel sent it -- absent means "not measured", never "all known".
   */
  cost_missing_snapshot_lines?: number
  /** What customers were charged for delivery. */
  delivery_fee_usd: number
  /**
   * What the window's Not Paid sales still owe, after deposits and the debt
   * their returns lowered (owner, 21 Oct 2026). A POSITIVE note, never a
   * deduction from sales/profit above.
   */
  credit_usd: number
  /** One refunds total. The report shows no per-return breakdown. */
  refunds_usd: number
  /**
   * Stock removed entirely during the shift, priced at cost (owner, Sep 14
   * 2026: "also add one row below unpaid in reports as well"). A POSITIVE
   * amount lost, printed below the unpaid row exactly like credit_usd, and --
   * like it -- never subtracted from sales/profit above: the pair of figures
   * is the point. OPTIONAL: absent when the kernel could not scope the
   * movement window, so the row is omitted rather than printed as $0.00.
   */
  removal_loss_usd?: number
  /** Revenue and profit WITH the removal losses taken off. Absent together
   *  with removal_loss_usd. profit may be negative -- that is the loss view. */
  revenue_after_losses_usd?: number
  profit_after_losses_usd?: number
  /** Of the removal-loss rows above, how many carried no cost anywhere --
   *  the figure is understated by whatever they were worth (p5/losses, Sep
   *  15 2026, owner: "i see the report says row removed has 1 no cost
   *  price. this is impossible find issue and fix"). Never dropped. */
  removal_loss_unvalued_rows?: number
  /**
   * The two halves of the window's expenses, per currency:
   * delivery_cost = courier payouts + fees typed 'delivery';
   * other_expenses = every remaining fee.
   * Their sum is exactly `reconciliation.expenses + reconciliation.courier`,
   * so the split can never quietly stop footing against the drawer.
   */
  delivery_cost: ShiftMoney
  other_expenses: ShiftMoney
}

export type ShiftFiguresInput = {
  opening: Partial<ShiftCount> | null | undefined
  additionalCash?: Partial<ShiftMoney> | null | undefined
  counted: Partial<ShiftCount> | null | undefined
  totals: {
    revenue_usd?: unknown; cost_usd?: unknown; profit_usd?: unknown; cost_missing_snapshot_lines?: unknown
    delivery_usd?: unknown; not_paid_owed_usd?: unknown; refund_usd?: unknown
    revenue_without_not_paid_usd?: unknown; profit_without_not_paid_usd?: unknown
    removal_loss_usd?: unknown
    revenue_after_losses_usd?: unknown; profit_after_losses_usd?: unknown
    removal_loss_unvalued_rows?: unknown
  } | null | undefined
  /** Every fee in the window. */
  expenses: Partial<ShiftMoney> | null | undefined
  /** The subset of those fees typed 'delivery'. */
  deliveryFees: Partial<ShiftMoney> | null | undefined
  /** Courier payouts read off the sales rows, already guarded against a fee. */
  courier: Partial<ShiftMoney> | null | undefined
}

/** The whole report arithmetic, pure. Every caller goes through this. */
export function composeShiftFigures(input: ShiftFiguresInput): ShiftFigures {
  const expenses = money(input.expenses)
  const deliveryFees = money(input.deliveryFees)
  const courier = money(input.courier)
  const totals = input.totals ?? {}
  return {
    opening: countOf(input.opening),
    additional_cash: money(input.additionalCash),
    closing: countOf(input.counted),
    sales_usd: round2(finite(totals.revenue_usd)),
    cogs_usd: round2(finite(totals.cost_usd)),
    profit_usd: round2(finite(totals.profit_usd)),
    sales_without_not_paid_usd: round2(finite(totals.revenue_without_not_paid_usd)),
    ...(totals.profit_without_not_paid_usd === undefined ? {} : { profit_without_not_paid_usd: round2(finite(totals.profit_without_not_paid_usd)) }),
    ...(totals.cost_missing_snapshot_lines === undefined ? {} : {
      cost_missing_snapshot_lines: Math.max(0, Math.round(finite(totals.cost_missing_snapshot_lines))),
    }),
    delivery_fee_usd: round2(finite(totals.delivery_usd)),
    // Never negative: an amount owed cannot be less than nothing, and a
    // negative here would be a data defect printed as a business fact.
    credit_usd: Math.max(0, round2(finite(totals.not_paid_owed_usd))),
    refunds_usd: round2(finite(totals.refund_usd)),
    // Present only when the kernel sent the block. Never floored at 0 on the
    // profit side: "including the losses" is allowed to be negative.
    ...(totals.removal_loss_usd === undefined ? {} : {
      removal_loss_usd: Math.max(0, round2(finite(totals.removal_loss_usd))),
      revenue_after_losses_usd: round2(finite(totals.revenue_after_losses_usd)),
      profit_after_losses_usd: round2(finite(totals.profit_after_losses_usd)),
      ...(totals.removal_loss_unvalued_rows === undefined ? {} : {
        removal_loss_unvalued_rows: Math.max(0, Math.round(finite(totals.removal_loss_unvalued_rows))),
      }),
    }),
    delivery_cost: {
      usd: round2(deliveryFees.usd + courier.usd),
      khr: roundKhr(deliveryFees.khr + courier.khr),
    },
    other_expenses: {
      usd: round2(expenses.usd - deliveryFees.usd),
      khr: roundKhr(expenses.khr - deliveryFees.khr),
    },
  }
}

/** The fees typed 'delivery' -- the delivery half of the same expense set. */
export async function shiftDeliveryFeeExpenses(
  env: Env,
  shift: ShiftReconciliationSession,
  nowMs: number,
): Promise<ShiftMoney> {
  const { clauses, params } = shiftFeeWhere(shift, nowMs)
  clauses.push(DELIVERY_FEE_PREDICATE)
  const row = await getDb(env).prepare(`SELECT COALESCE(SUM(amount_usd), 0) AS usd,
      COALESCE(SUM(amount_khr), 0) AS khr FROM fees WHERE ${clauses.join(' AND ')}`)
    .get<{ usd: number; khr: number }>(params)
  return { usd: round2(Number(row?.usd || 0)), khr: roundKhr(Number(row?.khr || 0)) }
}

/**
 * The report figures for one shift, read from D1.
 *
 * `getSalesTotals` is consumed, never re-implemented: the shift report and the
 * Reports hub have to be reconcilable, and a second profit formula here is
 * exactly how they would stop being.
 */
export async function loadShiftFigures(
  env: Env,
  shift: ShiftReconciliationSession,
  nowMs: number = Date.now(),
): Promise<ShiftFigures> {
  const [totals, expenses, deliveryFees, courier] = await Promise.all([
    getSalesTotals(env, shiftFilters(shift, nowMs)),
    shiftExpenses(env, shift, nowMs),
    shiftDeliveryFeeExpenses(env, shift, nowMs),
    shiftCourierPayouts(env, shift, nowMs),
  ])
  return composeShiftFigures({
    opening: { usd: shift.opening_float_usd, khr: shift.opening_float_khr },
    additionalCash: { usd: shift.additional_cash_usd ?? 0, khr: shift.additional_cash_khr ?? 0 },
    counted: { usd: shift.closing_counted_usd ?? null, khr: shift.closing_counted_khr ?? null },
    totals,
    expenses,
    deliveryFees,
    courier,
  })
}

// ---- the figures a shift CLOSED on (N4) -------------------------------------
//
// LOOPHOLE-REVIEW-20261006 N4: everything above is recomputed on every read
// from sale rows that stay mutable, and tender belongs to sales.created_at. A
// bulk payment-method relabel (lib/saleBulkUpdate.ts), a cancel, a settled
// Not Paid sale or a shift amendment therefore moved a CLOSED shift's expected
// drawer with no trace: close $50 short, relabel $50 of Cash sales as ABA,
// and the closed shift balanced.
//
// So the close now stores the reconciliation it was closed on (migration
// 0237, table shift_close_figures, written in the close batch), and the report
// shows THOSE figures. A later difference is not hidden and not absorbed: it
// is a separate "changed after close" block -- which components moved, and
// which sales, found by comparing a per-sale tender fingerprint taken at the
// close with the same fingerprint now.
//
// The stored reconciliation is the output of loadShiftReconciliation itself,
// so the stored and the computed figures can never come from two formulas.

/** [sale id, cash USD, cash KHR, other-tender USD, other-tender KHR]. A
 *  cancelled sale contributes zeros, exactly as tenderWhere excludes it. */
export type ShiftSaleTender = [number, number, number, number, number]
/** Past this many sales in one window the per-sale fingerprint is not stored
 *  (sales: null); the component comparison still runs. */
export const SHIFT_CLOSE_SALE_CAP = 2000
/**
 * The drawer formula a close was stored under. 1: a courier payout also took its riel twin off the riel drawer
 * (retired 14 Oct 2026, 6.0.390); 2: one currency per payout. A stored row without `formula` is 1 and is
 * never rewritten: the drift check and Telegram read it under the formula that produced it.
 */
export const SHIFT_FIGURES_FORMULA = 2
/** How many drifted sales one response names. The total is always given. */
export const SHIFT_CLOSE_DRIFT_SALE_LIMIT = 20

export type ShiftCloseFigures = {
  v: 1
  /** Which drawer formula produced `reconciliation`; a row without it was closed under formula 1. */
  formula: number
  taken_at: string
  window: { opened_at: string; closed_at: string | null }
  reconciliation: ShiftReconciliation
  /** Every non-cash tender in the window, per currency; null past the cap. */
  other_tenders: ShiftMoney | null
  sales: ShiftSaleTender[] | null
}

export type ShiftCloseDriftComponent = { key: string; stored: ShiftCount; current: ShiftCount }
export type ShiftSaleDrift = {
  sale_id: number
  change: 'added' | 'removed' | 'changed'
  /** [cash USD, cash KHR, other USD, other KHR] at the close / now; null when absent. */
  before: [number, number, number, number] | null
  after: [number, number, number, number] | null
  receipt_number?: string | null
  created_at?: string | null
  sale_status?: string | null
}
export type ShiftCloseDrift = {
  components: ShiftCloseDriftComponent[]
  sales: ShiftSaleDrift[]
  sales_total: number
  /** The close or the current read passed SHIFT_CLOSE_SALE_CAP: no per-sale list. */
  sales_unavailable: boolean
  /** Today's computed figures (under the formula the close was stored with) -- what the report would have shown without N4. */
  current: ShiftReconciliation
}

const isCancelledSale = (status: unknown) => (status == null || status === '' ? 'completed' : String(status)) === 'cancelled'

/** One sale's tender contribution, through the same summarizeShiftCashDetail as the drawer. */
export function shiftSaleTenderEntry(row: ShiftTenderRow & { id?: unknown }, options: ShiftCashOptions = {}): ShiftSaleTender {
  const id = Number(row.id)
  if (isCancelledSale(row.sale_status)) return [id, 0, 0, 0, 0]
  const cash = summarizeShiftCashDetail([row], options)
  return [id, cash.usd, cash.khr, cash.digital.usd, cash.digital.khr]
}

/** The per-sale fingerprint of the window, cancelled sales included (as zeros). */
export async function shiftSaleTenders(
  env: Env,
  shift: ShiftReconciliationSession,
  nowMs: number,
  options?: ShiftCashOptions,
): Promise<ShiftSaleTender[] | null> {
  const { clauses, params } = shiftWindowWhere('sales', shiftFilters(shift, nowMs))
  if (shift.branch_id) { clauses.push('sales.branch_id = @branchId'); params.branchId = shift.branch_id }
  // ONE scan of sales: every sale rung in the window, of either version. A version 1 sale keeps the entry it always had
  // in the window it was rung in (zeros when it took no money there), so converting a sale never turns it into a removed entry.
  const rows = await getDb(env).prepare(`SELECT id, payments_version, payment_method, payment_details, amount_paid_usd, amount_paid_khr,
      change_usd, change_khr, change_is_actual, change_exchange_rate, sale_status, total_usd, exchange_rate
    FROM sales WHERE ${clauses.join(' AND ')} ORDER BY id LIMIT ${SHIFT_CLOSE_SALE_CAP + 1}`)
    .all<ShiftTenderRow & { id: number; payments_version?: unknown }>(params)
  if (rows.length > SHIFT_CLOSE_SALE_CAP) return null
  const config = options ?? await readCashConfig(env)
  const entries = new Map<number, ShiftSaleTender>()
  for (const row of rows) {
    entries.set(Number(row.id), Number(row.payments_version) === 1 ? [Number(row.id), 0, 0, 0, 0] : shiftSaleTenderEntry(row, config))
  }
  const eventRows = await shiftPaymentEventRows(env, shift, nowMs, SHIFT_CLOSE_SALE_CAP + 1, true)
  if (eventRows.length > SHIFT_CLOSE_SALE_CAP) return null
  // Version 1: one entry per sale, the net of the events it received inside the window (a cancelled sale as zeros).
  const bySale = new Map<number, ShiftPaymentEventRow[]>()
  for (const row of eventRows) bySale.set(Number(row.sale_id), [...(bySale.get(Number(row.sale_id)) ?? []), row])
  for (const [id, saleRows] of bySale) {
    if (isCancelledSale((saleRows[0] as { sale_status?: unknown }).sale_status)) { entries.set(id, [id, 0, 0, 0, 0]); continue }
    const cash = summarizeShiftCashEvents(saleRows, config)
    entries.set(id, [id, cash.usd, cash.khr, cash.digital.usd, cash.digital.khr])
  }
  return [...entries.values()].sort((x, y) => x[0] - y[0])
}

function sumOtherTenders(sales: ShiftSaleTender[] | null): ShiftMoney | null {
  if (!sales) return null
  return {
    usd: round2(sales.reduce((n, entry) => n + entry[3], 0)),
    khr: roundKhr(sales.reduce((n, entry) => n + entry[4], 0)),
  }
}

/** The stored object, pure. */
export function buildShiftCloseFigures(input: {
  takenAt: string; openedAt: string; closedAt: string | null
  reconciliation: ShiftReconciliation; sales: ShiftSaleTender[] | null
}): ShiftCloseFigures {
  return {
    v: 1,
    formula: SHIFT_FIGURES_FORMULA,
    taken_at: input.takenAt,
    window: { opened_at: input.openedAt, closed_at: input.closedAt },
    reconciliation: input.reconciliation,
    other_tenders: sumOtherTenders(input.sales),
    sales: input.sales,
  }
}

/** The figures to store at the close, read from D1 for the shift as it is being closed. */
export async function loadShiftCloseFigures(
  env: Env,
  shift: ShiftReconciliationSession,
  nowMs: number = Date.now(),
  options: { extraReviewCodes?: readonly string[] } = {},
): Promise<ShiftCloseFigures> {
  const config = await readCashConfig(env)
  const [reconciliation, sales] = await Promise.all([
    loadShiftReconciliation(env, shift, nowMs, options),
    shiftSaleTenders(env, shift, nowMs, config),
  ])
  return buildShiftCloseFigures({ takenAt: new Date(nowMs).toISOString(), openedAt: shift.opened_at,
    closedAt: shift.closed_at, reconciliation, sales })
}

const countValue = (value: unknown): number | null => (value == null || !Number.isFinite(Number(value)) ? null : Number(value))
const countPair = (value: unknown): ShiftCount => {
  const pair = (value ?? {}) as { usd?: unknown; khr?: unknown }
  return { usd: countValue(pair.usd), khr: countValue(pair.khr) }
}
const moneyPair = (value: unknown): ShiftMoney => {
  const pair = countPair(value)
  return { usd: pair.usd ?? 0, khr: pair.khr ?? 0 }
}

/**
 * A stored row read back, tolerant of shape: a field this version does not
 * know is ignored, a field an older row lacks reads as zero (money) or unknown
 * (counts), and anything that is not a v1 object answers null -- the reader
 * then falls back to the computed figures, labelled as such, rather than
 * printing a half-parsed drawer.
 */
export function parseShiftCloseFigures(json: unknown): ShiftCloseFigures | null {
  let value: unknown
  try { value = typeof json === 'string' ? JSON.parse(json) : json } catch { return null }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (raw.v !== 1 || !raw.reconciliation || typeof raw.reconciliation !== 'object') return null
  const r = raw.reconciliation as Record<string, unknown>
  const codes = Array.isArray(r.review_codes) ? r.review_codes.map(String) : []
  const reconciliation: ShiftReconciliation = {
    opening: countPair(r.opening),
    additional_cash: moneyPair(r.additional_cash),
    cash_sales: moneyPair(r.cash_sales),
    refunds: moneyPair(r.refunds),
    expenses: moneyPair(r.expenses),
    courier: moneyPair(r.courier),
    expected: countPair(r.expected),
    counted: countPair(r.counted),
    difference: countPair(r.difference),
    needs_review: r.needs_review === true || codes.length > 0,
    review_codes: codes,
  }
  const sales = Array.isArray(raw.sales)
    ? raw.sales.filter((entry): entry is unknown[] => Array.isArray(entry) && entry.length >= 5 && Number.isInteger(Number(entry[0])))
      .map((entry) => [Number(entry[0]), ...[1, 2, 3, 4].map((i) => Number(entry[i]) || 0)] as ShiftSaleTender)
    : null
  const window = (raw.window ?? {}) as Record<string, unknown>
  const formula = Math.floor(Number(raw.formula))
  return {
    v: 1,
    formula: Number.isFinite(formula) && formula >= 1 ? formula : 1,
    taken_at: String(raw.taken_at ?? ''),
    window: { opened_at: String(window.opened_at ?? ''), closed_at: window.closed_at == null ? null : String(window.closed_at) },
    reconciliation,
    other_tenders: raw.other_tenders == null ? sumOtherTenders(sales) : moneyPair(raw.other_tenders),
    sales,
  }
}

const sameCount = (a: number | null, b: number | null, khr: boolean) =>
  a == null || b == null ? a === b : Math.abs(a - b) < (khr ? 0.5 : 0.005)

/** Which drawer lines differ between the close and now, pure. */
export function compareShiftCloseFigures(
  stored: ShiftCloseFigures,
  current: ShiftReconciliation,
  currentOtherTenders: ShiftMoney | null,
): ShiftCloseDriftComponent[] {
  const s = stored.reconciliation
  const pairs: Array<[string, ShiftCount, ShiftCount]> = [
    ['opening', s.opening, current.opening],
    ['additional_cash', s.additional_cash, current.additional_cash],
    ['cash_sales', s.cash_sales, current.cash_sales],
    ['refunds', s.refunds, current.refunds],
    ['expenses', s.expenses, current.expenses],
    ['courier', s.courier, current.courier],
    ['expected', s.expected, current.expected],
    ['counted', s.counted, current.counted],
  ]
  if (stored.other_tenders && currentOtherTenders) pairs.push(['other_tenders', stored.other_tenders, currentOtherTenders])
  return pairs
    .filter(([, a, b]) => !sameCount(a.usd, b.usd, false) || !sameCount(a.khr, b.khr, true))
    .map(([key, a, b]) => ({ key, stored: { usd: a.usd, khr: a.khr }, current: { usd: b.usd, khr: b.khr } }))
}

/** Which sales were added to, removed from, or changed inside the window since the close, pure. */
export function diffShiftSaleTenders(stored: ShiftSaleTender[], current: ShiftSaleTender[]): ShiftSaleDrift[] {
  const before = new Map(stored.map((entry) => [entry[0], entry]))
  const after = new Map(current.map((entry) => [entry[0], entry]))
  const tail = (entry: ShiftSaleTender | undefined) => (entry ? [entry[1], entry[2], entry[3], entry[4]] as [number, number, number, number] : null)
  const out: ShiftSaleDrift[] = []
  for (const id of [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a - b)) {
    const a = before.get(id); const b = after.get(id)
    if (a && b) {
      if (sameCount(a[1], b[1], false) && sameCount(a[2], b[2], true) && sameCount(a[3], b[3], false) && sameCount(a[4], b[4], true)) continue
      out.push({ sale_id: id, change: 'changed', before: tail(a), after: tail(b) })
    } else out.push({ sale_id: id, change: a ? 'removed' : 'added', before: tail(a), after: tail(b) })
  }
  return out
}

/**
 * The drawer a report prints for a shift: a closed shift stored under an older formula prints what it closed on
 * (history is immutable), every other shift the live figures. The in-app report shows the stored close the same way.
 */
export async function loadShiftReconciliationAsClosed(
  env: Env, shift: ShiftReconciliationSession, nowMs: number, options: { overflowLabel?: string; extraReviewCodes?: readonly string[] } = {},
): Promise<ShiftReconciliation> {
  const stored = shift.closed_at && shift.id != null ? await loadLegacyStoredReconciliation(env, shift.id) : null
  if (!stored) return loadShiftReconciliation(env, shift, nowMs, options)
  return applyShiftTimeReview(stored, shift.id == null ? null : await readShiftTimeReview(env, shift.id))
}

/**
 * Today's reconciliation re-read under the formula a close was stored with, so a close made before the
 * formula changed is compared with like for like and only a record can drift it. Pure for the current formula.
 * Only the courier riel line differs between formulas; expected and difference follow it exactly.
 */
export async function reconciliationUnderFormula(
  env: Env, shift: ShiftReconciliationSession, computed: ShiftReconciliation, formula: number, nowMs: number,
): Promise<ShiftReconciliation> {
  if (formula >= SHIFT_FIGURES_FORMULA) return computed
  const courier = await shiftCourierPayouts(env, shift, nowMs, { formula })
  const gap = courier.khr - computed.courier.khr
  if (!gap) return { ...computed, courier }
  const expectedKhr = computed.expected.khr == null ? null : roundKhr(computed.expected.khr - gap)
  const countedKhr = computed.counted.khr
  return {
    ...computed,
    courier,
    expected: { usd: computed.expected.usd, khr: expectedKhr },
    difference: { usd: computed.difference.usd, khr: countedKhr == null || expectedKhr == null ? null : roundKhr(countedKhr - expectedKhr) },
  }
}

/**
 * The reconciliation a CLOSED shift was stored with, when it was stored under an older formula; null when there
 * is no stored row or it is current (the live figures then are the stored ones, give or take a real record).
 * Telegram reads this so /shift prints what the owner closed on, as the report does.
 */
export async function loadLegacyStoredReconciliation(env: Env, shiftId: number): Promise<ShiftReconciliation | null> {
  try {
    const row = await getDb(env).prepare('SELECT figures_json FROM shift_close_figures WHERE shift_session_id = @id')
      .get<{ figures_json: string }>({ id: shiftId })
    const figures = row ? parseShiftCloseFigures(row.figures_json) : null
    return figures && figures.formula < SHIFT_FIGURES_FORMULA ? figures.reconciliation : null
  } catch { return null }
}

/**
 * The drift of one closed shift: today's computed figures against the stored
 * ones. Null when nothing moved. Sale ids are labelled with their receipt
 * number for the links; at most SHIFT_CLOSE_DRIFT_SALE_LIMIT are named and
 * `sales_total` says how many there are.
 */
export async function loadShiftCloseDrift(
  env: Env,
  shift: ShiftReconciliationSession,
  stored: ShiftCloseFigures,
  computed: ShiftReconciliation,
  nowMs: number = Date.now(),
): Promise<ShiftCloseDrift | null> {
  const current = await reconciliationUnderFormula(env, shift, computed, stored.formula, nowMs)
  const currentSales = await shiftSaleTenders(env, shift, nowMs)
  const components = compareShiftCloseFigures(stored, current, sumOtherTenders(currentSales))
  const salesUnavailable = !stored.sales || !currentSales
  const drifted = salesUnavailable ? [] : diffShiftSaleTenders(stored.sales!, currentSales!)
  if (!components.length && !drifted.length) return null
  const named = drifted.slice(0, SHIFT_CLOSE_DRIFT_SALE_LIMIT)
  if (named.length) {
    // sql-bound-params: bounded by construction -- `named` is
    // drifted.slice(0, SHIFT_CLOSE_DRIFT_SALE_LIMIT), at most 20 slots.
    const params = Object.fromEntries(named.map((entry, index) => [`s${index}`, entry.sale_id]))
    const labels = await getDb(env).prepare(`SELECT id, receipt_number, created_at, sale_status FROM sales
      WHERE id IN (${named.map((_entry, index) => `@s${index}`).join(',')})`)
      .all<{ id: number; receipt_number: string | null; created_at: string | null; sale_status: string | null }>(params)
    const byId = new Map(labels.map((row) => [Number(row.id), row]))
    for (const entry of named) {
      const label = byId.get(entry.sale_id)
      entry.receipt_number = label?.receipt_number ?? null
      entry.created_at = label?.created_at ?? null
      entry.sale_status = label?.sale_status ?? null
    }
  }
  return { components, sales: named, sales_total: drifted.length, sales_unavailable: salesUnavailable, current }
}

// ---- the close's inputs, re-checked at commit (N4 follow-up) ----------------
//
// The stored figures are computed in JS before the close batch, so a write
// landing between that read and the commit (a tender relabel, a cancel, an
// expense edit) would be stored as if the shift had closed on it -- and then
// reported as "changed after close", which it was not. The figures cannot be
// computed in SQL inside the batch, so the close instead reads a DIGEST of
// every input first, computes the figures, and the batch re-evaluates the same
// digest and aborts (bad-JSON-path sentinel) if it moved. The route retries.
//
// What the digest covers is what the drawer reads:
//   * sales in the window (incl. cancelled): count, ids, and the sum of their
//     sale_write_revisions -- trigger-maintained on EVERY insert/update/delete
//     of a sale or its lines (migration 0120), so any sale writer moves it;
//   * delivery-typed fees linked to those sales (they zero the courier payout);
//   * the window's fees row by row (id and both amounts, so two offsetting
//     edits still move it; the stored drawer keeps expense totals only, so a
//     label edit is deliberately not a change), and its refunds: count, ids
//     and the drawer cash they took, per currency;
//   * the payment-method settings that decide which tender is cash.
// The shift row's own opening/additional/counted values are guarded by the
// close's revision already.

export const SHIFT_CLOSE_INPUTS_CHANGED = 'shift_close_inputs_changed'

export type ShiftCloseInputsDigest = { expr: string; params: Record<string, unknown> }

export function shiftCloseInputsDigestSql(shift: ShiftReconciliationSession, nowMs: number): ShiftCloseInputsDigest {
  const sales = shiftWindowWhere('sales', shiftFilters(shift, nowMs))
  if (shift.branch_id) { sales.clauses.push('sales.branch_id = @branchId'); sales.params.branchId = shift.branch_id }
  const fees = shiftFeeWhere(shift, nowMs)
  const refunds = shiftWindowWhere('returns', shiftFilters(shift, nowMs))
  if (shift.branch_id) { refunds.clauses.push('returns.branch_id = @branchId'); refunds.params.branchId = shift.branch_id }
  refunds.clauses.push("COALESCE(returns.status, 'completed') <> 'cancelled'", "COALESCE(returns.return_scope, 'customer') = 'customer'")
  const salesWhere = sales.clauses.join(' AND ')
  const events = paymentEventWindow(shift, nowMs)
  const expr = `json_array(
    (SELECT json_array(COUNT(*), TOTAL(sales.id), TOTAL(COALESCE(close_rev.revision, 0))) FROM sales
      LEFT JOIN sale_write_revisions close_rev ON close_rev.sale_id = sales.id WHERE ${salesWhere}),
    (SELECT COUNT(*) FROM fees WHERE COALESCE(fees.fee_type, '') = 'delivery'
      AND fees.sale_id IN (SELECT sales.id FROM sales WHERE ${salesWhere})),
    (SELECT json_group_array(json_array(fees.id, fees.amount_usd, fees.amount_khr)) FROM (
      SELECT fees.id, fees.amount_usd, fees.amount_khr FROM fees
      WHERE ${fees.clauses.join(' AND ')} ORDER BY fees.id) fees),
    (SELECT json_array(COUNT(*), TOTAL(returns.id), TOTAL(${refundDrawerUsdSql('returns')}), TOTAL(${refundDrawerKhrSql('returns')})) FROM returns WHERE ${refunds.clauses.join(' AND ')}),
    (SELECT json_group_array(json_array(key, value)) FROM (SELECT key, value FROM settings
      WHERE key IN ('pos_payment_methods', '${PAYMENT_METHOD_KINDS_SETTING}') ORDER BY key)),
    (SELECT json_array(COUNT(*), TOTAL(e.id), TOTAL(COALESCE(event_rev.revision, 0))) FROM sale_payment_events e CROSS JOIN sales ON sales.id = e.sale_id
      LEFT JOIN sale_write_revisions event_rev ON event_rev.sale_id = sales.id
      WHERE ${['sales.payments_version = 1', ...events.clauses].join(' AND ')}))`
  return { expr, params: { ...sales.params, ...fees.params, ...refunds.params, ...events.params } }
}

/** The digest's value now -- read BEFORE the figures, so anything that moves after is caught at commit. */
export async function readShiftCloseInputsDigest(env: Env, digest: ShiftCloseInputsDigest): Promise<string> {
  const row = await getDb(env).prepare(`SELECT ${digest.expr} AS digest`).get<{ digest: string }>(digest.params)
  return String(row?.digest ?? '')
}
