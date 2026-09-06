/**
 * The equations the stat cards print, in one place.
 *
 * WHY THIS EXISTS. Every card that explains itself used to hand-write its own
 * sentence, and the sentences drifted from the server. On Sep 6 2026 three of
 * them were wrong at once: Dashboard's Revenue card said
 * `Revenue = Gross - Discounts` (no refund term, though its own prose promised
 * one), its Returns card said `Net after refunds = Revenue - Refunded` --
 * subtracting refunds a SECOND time, off a figure that already had them out,
 * and off the return-date total rather than the sale-date one -- and both
 * Profit cards said `- Store-paid delivery`, a term the kernel has not
 * subtracted since the delivery correction.
 *
 * So the equations are DERIVED from the payload here, not written out, and
 * `equationResidual` lets a test assert that a term list actually closes on
 * the figure it claims to explain. A sentence that does not foot is a bug the
 * test can see, instead of prose nobody re-reads.
 *
 * THE TWO IDENTITIES (cloudflare/src/lib/salesAnalytics.ts, deriveTotals):
 *
 *   revenue_usd = net_sales_usd - refund_usd
 *   profit_usd  = revenue_usd - cost_usd
 *                 + recognized_delivery_usd - recognized_delivery_cost_usd
 *
 * Both are exact, per period, with no rounding slack beyond the cent each
 * figure is already rounded to. Gross sales, tax and the discount lines are
 * display line items, NOT terms of either identity -- an equation built from
 * them cannot be made to foot, which is exactly how the old Revenue sentence
 * went wrong.
 *
 * Nothing here formats money: the caller passes its own formatter, because
 * the Dashboard and the Sales strip format differently and neither should
 * have to import the other's.
 */

/** One signed term of a printed equation. */
export interface FormulaTerm {
  /** Language-pack key for the term's label. */
  key: string
  /** English fallback, for `translateOr`. */
  fallback: string
  /** How the term enters the sum: +1 adds, -1 subtracts. */
  sign: 1 | -1
  usd: number
}

/**
 * The subset of the sales kernel's totals the equations read. Every field is
 * optional because a payload can arrive gated (a non-admin never receives
 * cost_usd / profit_usd) or from an older Worker; a missing field reads 0 and
 * the residual then shows the equation does not close, which is the honest
 * outcome rather than a confidently wrong sentence.
 */
export interface StatsFormulaTotals {
  net_sales_usd?: number
  refund_usd?: number
  revenue_usd?: number
  cost_usd?: number
  recognized_delivery_usd?: number
  recognized_delivery_cost_usd?: number
  profit_usd?: number
  [key: string]: unknown
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

/**
 * `Revenue = Net sales - Refunds`.
 *
 * The refund term is the kernel's own `refund_usd`: the customer refunds
 * ATTRIBUTED BACK to the period their sale was rung in. It is not the same
 * number as the count-of-returns card's refund total, which is scoped by the
 * date the return was processed. Printing the return-date total in this
 * equation is what made a period's revenue go negative.
 */
export function revenueTerms(t: StatsFormulaTotals): FormulaTerm[] {
  return [
    { key: 'rpt_net_sales', fallback: 'Net sales', sign: 1, usd: num(t.net_sales_usd) },
    { key: 'total_refunded', fallback: 'Refunds', sign: -1, usd: num(t.refund_usd) },
  ]
}

/**
 * `Profit = Revenue - COGS + Delivery fees charged - Courier cost`.
 *
 * cost_usd is already NET of the cost of goods a return put back on the
 * shelf, so no returned-cost term appears here. Store-paid (waived) delivery
 * is deliberately absent: the shop never charged that fee, so there is no
 * cash to take off profit -- it is revenue foregone, reported as its own memo
 * figure and never a term of this sum.
 */
export function profitTerms(t: StatsFormulaTotals): FormulaTerm[] {
  return [
    { key: 'revenue_short', fallback: 'Revenue', sign: 1, usd: num(t.revenue_usd) },
    { key: 'cogs', fallback: 'COGS', sign: -1, usd: num(t.cost_usd) },
    { key: 'rpt_delivery_collected', fallback: 'Delivery fees charged', sign: 1, usd: num(t.recognized_delivery_usd) },
    { key: 'rpt_delivery_paid', fallback: 'Delivery paid to couriers', sign: -1, usd: num(t.recognized_delivery_cost_usd) },
  ]
}

/**
 * What the equation fails to explain: `result - sum(sign * term)`, to the
 * cent. Zero means the printed sentence is arithmetic the reader can check.
 * A test asserting this is 0 is the only thing that keeps a hand-edited
 * formula string honest.
 */
export function equationResidual(result: number, terms: FormulaTerm[]): number {
  return round2(num(result) - terms.reduce((sum, term) => sum + term.sign * num(term.usd), 0))
}

/** True when the terms account for the figure exactly. */
export function equationCloses(result: number, terms: FormulaTerm[]): boolean {
  return equationResidual(result, terms) === 0
}

export interface EquationText {
  /** Language-pack key for the figure being explained. */
  key: string
  fallback: string
  usd: number
}

/**
 * Renders `Revenue $290.00 = Net sales $310.00 - Refunds $20.00`.
 *
 * A term worth exactly 0 is dropped: a compact card should not spend a line
 * on `+ Delivery fees $0.00`. The leading term keeps its place even at zero
 * so the sentence never starts with an operator.
 */
export function buildEquation(
  result: EquationText,
  terms: FormulaTerm[],
  fmtUSD: (n: number) => string,
  tr: (key: string, fallback: string) => string,
): string {
  const shown = terms.filter((term, i) => i === 0 || term.usd !== 0)
  const body = shown
    .map((term, i) => {
      // The operator follows the term's EFFECT, not its declared sign: a
      // negative courier cost (a refunded delivery) reads "+ $2", never
      // "- $-2". The magnitude is what gets printed.
      const effect = term.sign * num(term.usd)
      const label = `${tr(term.key, term.fallback)} ${fmtUSD(Math.abs(effect))}`
      if (i === 0 && effect >= 0) return label
      return `${effect < 0 ? '−' : '+'} ${label}`
    })
    .join(' ')
  return `${tr(result.key, result.fallback)} ${fmtUSD(result.usd)} = ${body}`
}

// ---- The Sales page footer's fallback revenue ------------------------------
//
// GET /api/sales/stats returns the kernel's revenue over EVERY matching row;
// the Sales page list is capped at a page, so the footer reads that aggregate.
// When the request fails it still has to say something, and what it said was a
// third revenue definition -- `net_total_usd ?? total_usd` summed over sales
// that were neither cancelled nor awaiting_payment. That folded tax and the
// customer-paid delivery fee INTO revenue, took the refund off on the CHARGED
// basis instead of the apportioned one, and dropped the awaiting-payment
// cohort that clause 4 of the scoping rule puts inside revenue.
//
// These three functions are the client mirror of the kernel's SQL fragments
// (cloudflare/src/lib/salesAnalytics.ts: recognizedExpr, netSaleExpr,
// netRefundExpr), reading the columns GET /api/sales already returns on every
// row -- subtotal_usd, discount_usd, membership_discount_usd, and the
// refund_usd it attaches from non-cancelled CUSTOMER returns. The fallback is
// still a fallback (it can only see the rows that were fetched), but it is now
// the same DEFINITION, so it cannot disagree with the header it replaces about
// what revenue means.
//
// cloudflare/scripts/test-sales-revenue-convergence-pure.cjs evaluates this
// module against its own SQLite fixture and asserts saleListRevenueUsd equals
// getSalesTotals().revenue_usd to the cent.

/**
 * One row as the sales list endpoint returns it. Only the five money/status
 * columns below are read; everything else on the row is ignored, so this
 * accepts the page's own record type without a cast.
 */
export type SaleRevenueRow = Record<string, unknown>

/** `COALESCE(NULLIF(sale_status, ''), 'completed')` -- blank and NULL are completed. */
function saleStatus(sale: SaleRevenueRow): string {
  const raw = sale?.sale_status
  return raw == null || raw === '' ? 'completed' : String(raw)
}

/**
 * `recognizedExpr`: every sale that is not cancelled. The awaiting_payment
 * cohort is INSIDE revenue (lineage commit fd7c49ba) and is reported
 * additionally as pending -- it is a subset, never a complement.
 */
export function isRevenueCountedSale(sale: SaleRevenueRow): boolean {
  return saleStatus(sale) !== 'cancelled'
}

/** `netSaleExpr`: MAX(0, subtotal - store discount - membership discount). */
export function saleNetSalesUsd(sale: SaleRevenueRow): number {
  return Math.max(0, num(sale?.subtotal_usd) - num(sale?.discount_usd) - num(sale?.membership_discount_usd))
}

/**
 * `netRefundExpr`: the refund scaled onto the net basis revenue is measured
 * on, capped at what that sale ever recognised. A zero-subtotal receipt has no
 * basis to scale against and no value to give back, so its refund contributes
 * 0 rather than turning the row -- and the footer -- negative.
 */
export function saleNetRefundUsd(sale: SaleRevenueRow): number {
  const net = saleNetSalesUsd(sale)
  const subtotal = num(sale?.subtotal_usd)
  const charged = num(sale?.refund_usd)
  return Math.min(net, subtotal > 0 ? charged * (net / subtotal) : charged)
}

/**
 * The footer figure: `SUM over recognized rows of (net - net refund)`, rounded
 * once at the end exactly as GET /api/sales/stats rounds its aggregate.
 */
export function saleListRevenueUsd(rows: readonly SaleRevenueRow[]): number {
  let total = 0
  for (const sale of rows || []) {
    if (!isRevenueCountedSale(sale)) continue
    total += saleNetSalesUsd(sale) - saleNetRefundUsd(sale)
  }
  return round2(total)
}
