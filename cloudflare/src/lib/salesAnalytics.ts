// Single source of truth for how "revenue", "COGS", and "profit" are
// defined and computed from sales/sale_items, shared by the Dashboard
// analytics endpoint (routes/compat.ts) and the Sales export/stats
// endpoints (routes/sales.ts). Both previously computed these numbers
// independently and disagreed with each other -- see progress.md for the
// specific bugs this replaces.
//
// Ground truth, read from routes/sales.ts's create-sale handler:
//   sales.subtotal_usd        = SUM of line totals (already net of each
//                                item's own product/manual discount)
//   sales.discount_usd        = cashier-entered whole-sale ("store") discount
//   sales.membership_discount_usd = points-redemption discount
//   sales.tax_usd              = tax charged on the sale
//   sales.total_usd            = subtotal - discount - membership_discount + tax
//                                 + customer-paid delivery_fee_usd
//   sales.delivery_fee_usd     = delivery fee, only meaningful when
//                                 is_delivery=1; delivery_fee_paid_by is
//                                 'customer' (the customer is charged) or
//                                 'store' (the store waives that charge). The
//                                 courier payout is recorded separately in
//                                 delivery_actual_cost_usd.
//   sale_items.cost_price_usd * quantity = COGS for that line
//
// Definitions used everywhere below (canonical revenue = NET SALES, user
// directive Sep 1 2026 -- see the "Canonical revenue" block further down):
//   gross_sales_usd   = SUM(subtotal_usd) over recognized sales. Despite the
//                       historical field name, subtotal is already net of
//                       item-level product/manual discounts; invoice-level
//                       store and membership discounts remain separate.
//   discount_usd      = store_discount_usd + membership_discount_usd
//   revenue_usd        = SUM over RECOGNIZED sales (every sale that is not
//                         cancelled -- see recognizedExpr) of (subtotal -
//                         store discount - membership discount), minus
//                         customer refunds -- "Net sales", excluding tax and
//                         delivery
//   pending_revenue_usd = the same net basis restricted to the awaiting_payment
//                         (unpaid credit) cohort. It is a SUBSET of
//                         revenue_usd, reported so the unpaid part is visible
//                         -- never a complement, and never added to revenue.
//   collected_total_usd = collected sale value + collected tax and delivery,
//                         minus refunds paid out. This cash-oriented secondary
//                         figure excludes awaiting-payment credit even though
//                         that credit is recognized in revenue and profit.
//   returned_cost_usd  = SUM(return_items.cost_price_usd * quantity) for lines
//                         that went back on the SELLABLE shelf (stock_action
//                         'restock'), on non-cancelled customer returns
//   cost_usd           = SUM(sale_items.cost_price_usd * quantity) over recognized
//                         sales, MINUS returned_cost_usd -- goods that came back
//                         are not cost of goods SOLD
//   delivery_net_usd   = recognized customer-paid fees - recognized courier cost
//                         actually recorded on the sale
//   profit_usd         = revenue_usd - cost_usd + delivery_net_usd
//
// ---- Two corrections made Sep 4 2026, both of them double-counted minuses ---
//
// (a) profit used to read `- store_delivery_usd`: the fee the shop WAIVED,
//     subtracted as though it were cash paid out. It is not. The shop never
//     collected it, so it is already absent from every income figure here;
//     subtracting it again charges the giveaway twice. Meanwhile the fee the
//     shop DID collect never entered profit at all, and neither did the courier
//     money actually paid out -- migration 0068 left that out on purpose and
//     said folding it in "is its own explicit decision later". This is that
//     decision. Delivery now contributes exactly what it is worth: collected
//     minus paid out, once.
//
//     What is NOT folded in, deliberately: the standalone courier payments in
//     `fees` (fee_type='delivery'). There are 2,540 of them and they are
//     denominated in RIEL (51,127,200 KHR against $3.50), they carry no
//     sale_id, and their calendar filter is fee_date rather than the sale's
//     created_at. Folding them into a USD profit would require inventing an
//     exchange rate that no other fee surface applies -- every one of them
//     reports USD and KHR side by side and converts nothing -- and a rate that
//     moves would silently restate historical profit. They are reported
//     separately by getDeliveryContactTotals, which keeps them apart for the
//     same reason. That is the honest scope: what can be attributed per sale
//     and in one currency is in profit; what cannot is visible beside it.
//
// (b) a refund used to come off revenue at its full charged line price, but
//     revenue is NET of the sale's store and membership discounts and a line
//     price is not. Returning one line of a discounted sale therefore subtracted
//     that line's share of the discount a second time. netRefundExpr scales the
//     refund onto the same net basis revenue is measured on.
//
//     And the cost of goods that came BACK is no longer cost of goods SOLD.
//     Only a 'restock' line qualifies: 'damaged' units are held in
//     damaged_stock_lots with no sale value, and 'none' means the customer kept
//     them -- in both cases the cost was really incurred and stays in cost_usd.
//
// ---- THE ONE SCOPING RULE (Sep 6 2026, owner ask N6) -----------------------
//
// Every money figure produced by this file obeys the same four clauses, and
// any surface that shows a period revenue/profit number must be measured
// against them rather than inventing a fifth:
//
//   1. A figure inside a window is scoped by the SALE's business day (UTC+7).
//      A refund and the cost it puts back on the shelf reverse the sale they
//      belong to, in THAT sale's bucket -- never in the return's own bucket.
//      (CUSTOMER_REFUND_JOIN carries no date filter of its own; returnedCostSql
//      joins through `sales`.) A count of returns PROCESSED in a window is a
//      legitimate but different question -- an ACTIVITY figure, scoped by the
//      return's date -- and it may never be subtracted from a figure measured
//      by this rule. Doing so subtracts the same refunds twice, on two
//      different populations, which is how a period revenue goes negative.
//   2. A cancelled sale contributes 0 on BOTH sides: no revenue, no COGS, and
//      no refund reversal. `cancelled_tx_count` reports how many there were.
//   3. Supplier-scope returns never touch customer revenue or customer COGS.
//   4. The awaiting_payment cohort is INSIDE revenue, COGS, profit and delivery
//      (recognizedExpr is `<> 'cancelled'`, lineage commit fd7c49ba) and is
//      ADDITIONALLY reported as pending_*. The pending block is a subset, not a
//      complement; nothing may add the two together.
//
// NON-NEGATIVITY (owner rule N6: a period revenue or profit figure that is
// negative is a scoping defect, never something to clamp at display). Two
// per-sale invariants make a negative period revenue unreachable by
// construction rather than mopped up afterwards:
//
//   * netSaleExpr floors ONE sale's net value at 0. A sale whose recorded
//     discounts exceed its own subtotal is a broken row, not negative income.
//   * netRefundExpr caps ONE sale's refund at that same net value. A refund
//     apportioned onto a sale can never exceed what the sale recognised, so
//     `net - netRefund >= 0` for every row and therefore for every SUM of rows.
//
// Neither is a display clamp and neither hides money: refund_paid_out_usd
// still reports the cash that actually left the till on the charged basis, and
// refund_excess_usd reports exactly how much of it the sale could not absorb
// (the zero-subtotal imported receipts are the live example). A window whose
// refund_excess_usd is non-zero has a DATA defect to repair, and says so.
//
// Profit is NOT floored: a period that genuinely sold below cost made a loss,
// and hiding it would be the same lie in the other direction. What is removed
// is the scoping paths that manufactured one -- returned_cost_shortfall_usd
// reports the reversal the COGS floor could not absorb, which is the missing
// cost snapshot the floor used to swallow silently.
import { getDb } from './db'
import type { Env } from '../index'
import {
  localDateExpr,
  localMonthExpr,
  localWeekExpr,
  localDateRangeClause,
  localDateAtOrAfter,
  localDateAtOrBefore,
  localTimeRangeClause,
  localHourExpr,
} from './businessDateWindow'
import {
  REPORT_MONEY_MAX_ROWS,
  REPORT_MONEY_PAGE_SIZE,
  ReportExactDecimal,
  ReportMoneyPrecisionError,
  type ReportMoneyPrecisionMode,
} from './reportMoneyPrecision'
import {
  parseCustomerReturnRefundSnapshot,
  prorateCustomerReturnMoney4,
  type CustomerReturnRefundSnapshotV1,
} from './customerReturnEntitlement'
import { validateRefundMoneySnapshot } from './refundMoneyPrecision'

export interface SalesFilters {
  startDate?: string | null
  endDate?: string | null
  branchId?: string | number | null
  // Optional time-of-day window ('HH:MM'), evaluated in the FIXED business
  // timezone UTC+7 (Cambodia) -- created_at is stored UTC, so the clause shifts
  // by +7h before comparing (see businessDateWindow.ts). A window that crosses
  // midnight (start > end, e.g. 22:00–02:00) wraps. Callers that don't pass
  // these (Dashboard, /stats) are byte-for-byte unchanged.
  startTime?: string | null
  endTime?: string | null
  // Accepted for backward compatibility but IGNORED: the business is a single
  // fixed timezone, so a viewer-supplied offset must never re-anchor the data
  // (user, Sep 1 2026: "based on UTC+7 ... all Cambodia ... not other timezone").
  tzOffsetMinutes?: number | null
  // Optional report filters (Reports view). Absent on every existing caller
  // (Dashboard, /stats, per-contact drills), so those stay byte-for-byte
  // unchanged. `status` is matched against COALESCE(sale_status,'completed');
  // when set it REPLACES the default hide-cancelled guard, so picking
  // 'cancelled' actually surfaces cancelled sales. `paymentMethod` matches
  // the same normalized label the payment-method breakdown groups by.
  status?: string | null
  paymentMethod?: string | null
  // Optional immutable upper bound used by paged exports. Sales IDs are
  // monotonic, so page 1 can freeze a snapshot and every aggregate/detail
  // query in later pages stays on the same receipt set even while new sales
  // are being created. Absent for normal reports/dashboard paths.
  maxSaleId?: number | null
  // ---- Shift window (S4-7) ------------------------------------------------
  // An exact timestamp window, half-open [createdFrom, createdTo), for a
  // report whose boundary is a MOMENT rather than a day: a cash-drawer shift
  // runs from the minute the float was registered to the minute it was
  // counted, and both of those sit mid-day. startDate/endDate cannot express
  // that (whole local days) and startTime/endTime cannot either (a
  // time-of-day mask that repeats on every day in the range).
  //
  // The value must be in SQLite's CURRENT_TIMESTAMP shape,
  // 'YYYY-MM-DD HH:MM:SS' UTC -- NOT ISO-with-T. sales.created_at is stored
  // in that shape (lib/clientTimestamp.ts normalises the offline path to it
  // for exactly this reason), and at position 10 'T' sorts AFTER ' ', so an
  // ISO bound would silently drop or admit rows. shiftWindowBound() below is
  // the one converter; callers must not build these by hand.
  //
  // Deliberately NOT run through localDateRangeClause: these bounds are
  // already absolute UTC instants, so shifting them by the business offset
  // would move the window by seven hours.
  createdFrom?: string | null
  createdTo?: string | null
  // The cashier who rang the sale up. A shift belongs to one employee, so
  // every figure on their report is scoped to their own receipts; without
  // this a two-till shop would report each till the other's takings.
  // Matched on cashier_id (the account), never cashier_name (a snapshot two
  // people can end up sharing after a rename).
  cashierId?: number | string | null
}

/**
 * Normalise any timestamp to the shape `sales.created_at` is stored in --
 * 'YYYY-MM-DD HH:MM:SS' UTC. `shift_sessions.opened_at`/`closed_at` are full
 * ISO strings with a 'T' and a 'Z' (routes/shifts.ts writes
 * `new Date().toISOString()`), and comparing those against created_at
 * lexicographically without this converter is wrong in a way that still
 * produces plausible-looking numbers. Returns null for anything unparseable,
 * and a null bound is simply not applied.
 */
export function shiftWindowBound(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return null
  const parsed = new Date(/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`)
  if (!Number.isFinite(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 19).replace('T', ' ')
}

/**
 * The shift window as SQL, so there is exactly ONE definition of it.
 *
 * whereActiveSales() below calls this, and so does any query that needs the
 * same window without the kernel's other machinery (the shift report's
 * invoice counts, which must SEE cancelled sales and therefore cannot go
 * through the hide-cancelled guard). Writing `created_at >= ... AND < ...` a
 * second time by hand is exactly how the two would drift -- the boundary
 * being half-open is a decision, not an accident, and it has to be made in
 * one place.
 */
export function shiftWindowWhere(
  alias: string,
  f: Pick<SalesFilters, 'createdFrom' | 'createdTo' | 'cashierId'>,
): { clauses: string[]; params: Record<string, unknown> } {
  const clauses: string[] = []
  const params: Record<string, unknown> = {}
  const createdFrom = shiftWindowBound(f.createdFrom)
  if (createdFrom) {
    clauses.push(`datetime(${alias}.created_at) >= @createdFrom`)
    params.createdFrom = createdFrom
  }
  // EXCLUSIVE upper bound: with `<=`, a sale rung at the exact second the
  // drawer was counted would be reported on the closing shift AND on the
  // next one.
  const createdTo = shiftWindowBound(f.createdTo)
  if (createdTo) {
    clauses.push(`datetime(${alias}.created_at) < @createdTo`)
    params.createdTo = createdTo
  }
  if (f.cashierId != null && String(f.cashierId).trim() !== '') {
    clauses.push(`${alias}.cashier_id = @cashierId`)
    params.cashierId = Number(f.cashierId)
  }
  return { clauses, params }
}

export interface SalesTotals {
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
  // P6: courier money actually paid out (staff-only surface; NULL rows don't
  // count -- delivery_actual_cost_count says how many sales carried one, vs
  // delivery_sale_count deliveries total, so a partial record is visible
  // instead of read as free delivery). This descriptive total can include a
  // caller's explicit status scope; profit uses the matched recognized subset
  // in recognized_delivery_cost_usd.
  delivery_actual_cost_usd: number
  delivery_actual_cost_count: number
  delivery_sale_count: number
  delivery_margin_usd: number
  // The delivery contribution profit_usd actually uses: customer-paid fees
  // minus recorded courier cost, both over RECOGNIZED sales only, so it is a
  // matched pair with revenue_usd and cost_usd. Distinct from
  // delivery_margin_usd, which describes EVERY delivery including cancelled
  // ones and stays a descriptive figure.
  delivery_net_usd: number
  // The two HALVES of delivery_net_usd, reported separately (S4R3-6).
  //
  // The Reports income statement used to DERIVE its delivery line by
  // subtraction -- `revenue - cost - profit` -- and label the result
  // "Store-paid delivery". The bottom line always footed (a residual always
  // does; that is why nobody caught it), but the ROW's identity was wrong: it
  // carries -delivery_net, i.e. courier cost minus the fees customers paid,
  // under a label meaning store_delivery_usd, which is a different quantity
  // entirely (the fee the shop WAIVED). When customers paid more in fees than
  // the courier cost, the row went negative and read as a negative expense.
  //
  // These two are the actual terms of `profit = revenue - cost + income -
  // cost_paid`, on the SAME recognized basis as revenue_usd and cost_usd, so a
  // statement built from them shows which figure moved and by how much instead
  // of hiding it in a plug -- and it foots without inheriting the ~1c of error
  // that subtracting two independently round2'd figures introduces.
  //
  // Deliberately NOT the same as delivery_usd / delivery_actual_cost_usd:
  // those two describe EVERY delivery in the window (awaiting-payment ones
  // included) and stay descriptive figures for the courier breakdown. Using
  // them in the realised waterfall would pull unpaid deliveries into a
  // realised total, which the Sep-4 ruling forbids.
  recognized_delivery_usd: number
  recognized_delivery_cost_usd: number
  // ---- the awaiting-payment cohort, measured the same way (S4R3-6) --------
  // These fields isolate the unpaid-credit contribution already recognized
  // inside revenue, COGS, profit, and delivery. They are positive diagnostic
  // subsets for display beside the statement; callers must never add or
  // subtract them from the headline figures.
  //
  // pending_cost_usd / pending_profit_usd are admin-only money and are gated
  // with cost_usd / profit_usd by routes/reports.ts's gateTotals.
  pending_tx_count: number
  pending_gross_sales_usd: number
  pending_store_discount_usd: number
  pending_membership_discount_usd: number
  pending_delivery_usd: number
  pending_delivery_cost_usd: number
  // Gross cost of goods on the awaiting cohort. A customer return against a
  // sale that has not been paid for is NOT netted off here (recognized cost_usd
  // does net its restocked returns): before payment such a sale is cancelled
  // rather than returned, and if one ever exists it overstates pending COGS,
  // i.e. UNDER-states the credit subset's profit contribution.
  pending_cost_usd: number
  pending_profit_usd: number
  // The awaiting cohort's own line-level discount, the pending twin of
  // item_discount_usd. It was computed, typed and threaded through five call
  // sites and then dropped on the floor by deriveTotals; emitted here so the
  // PENDING block can be reconciled the way the realised one is.
  pending_item_discount_usd: number
  // Receipts VOIDED in this window. Scope clause 2: a cancelled sale
  // contributes 0 to every money figure above, so this count is the only
  // place it appears ("Voided invoices" beside the official count).
  cancelled_tx_count: number
  // Cost of goods that came back on the SELLABLE shelf and is therefore no
  // longer cost of goods SOLD. Already subtracted inside cost_usd; reported so
  // the reversal is visible rather than an unexplained dip.
  returned_cost_usd: number
  // The part of the restocked-return cost the window's own COGS could not
  // absorb (see the netCostUsd floor in deriveTotals). Non-zero means sold
  // lines in this window carry no cost snapshot while their returns do --
  // reported so the floor stops hiding it.
  returned_cost_shortfall_usd: number
  // Recognized receipts whose header value was never recorded, and the COGS
  // held out with them (valuedSaleExpr). Both are 0 on healthy data.
  unvalued_tx_count: number
  unvalued_cost_usd: number
  // Canonical revenue = NET SALES (user directive Sep 1 2026): subtotal net of
  // both discounts, over RECOGNIZED sales (every sale that is not cancelled),
  // BEFORE refunds. Tax and delivery fees are NOT revenue.
  // revenue_usd = net_sales_usd - refund_usd, exactly -- the equation every
  // "formula with real numbers" on the Dashboard and the Sales strip prints.
  net_sales_usd: number
  refund_usd: number
  // The same refunds on the CHARGED basis (what actually left the till) and
  // the part of them no sale could absorb. refund_usd is the recognition
  // reversal; these two keep the cash figure and the data defect visible
  // beside it (owner rule N6 -- never clamp silently).
  refund_charged_usd: number
  refund_excess_usd: number
  revenue_usd: number
  // Unpaid credit (awaiting_payment) measured on the same net basis. It is
  // INSIDE revenue_usd (clause 4 of the scoping rule) and isolated here so the
  // unpaid part is visible; never add the two together.
  pending_revenue_usd: number
  // Secondary cash figure: collected sale value, tax, and customer-paid
  // delivery, less refunds paid out. Awaiting-payment credit stays out even
  // though it is inside revenue/profit. Never the headline.
  collected_total_usd: number
  cost_usd: number
  profit_usd: number
  avg_order_usd: number
}

export interface SalesPeriodRow {
  period: string
  date: string
  count: number
  tx_count: number
  revenue_usd: number
  // gross_sales_usd and refund_usd are on this row because the Dashboard's
  // "Revenue Flow" chart plots exactly those three series. They were plotted
  // against keys the row never carried, so two of its three lines were
  // permanently flat zero; the row shape is the fix, not the chart.
  gross_sales_usd: number
  refund_usd: number
  discount_usd: number
  item_discount_usd: number
  total_discount_usd: number
  tax_usd: number
  delivery_usd: number
  cost_usd: number
  profit_usd: number
  cancelled_tx_count: number
}

export function emptySalesTotals(): SalesTotals {
  return {
    tx_count: 0, gross_sales_usd: 0, store_discount_usd: 0, membership_discount_usd: 0,
    discount_usd: 0, item_discount_usd: 0, total_discount_usd: 0, tax_usd: 0, delivery_usd: 0, store_delivery_usd: 0,
    delivery_actual_cost_usd: 0, delivery_actual_cost_count: 0, delivery_sale_count: 0, delivery_margin_usd: 0,
    delivery_net_usd: 0, recognized_delivery_usd: 0, recognized_delivery_cost_usd: 0,
    pending_tx_count: 0, pending_gross_sales_usd: 0, pending_store_discount_usd: 0, pending_membership_discount_usd: 0,
    pending_delivery_usd: 0, pending_delivery_cost_usd: 0, pending_cost_usd: 0, pending_profit_usd: 0,
    pending_item_discount_usd: 0, cancelled_tx_count: 0,
    returned_cost_usd: 0, returned_cost_shortfall_usd: 0,
    unvalued_tx_count: 0, unvalued_cost_usd: 0, net_sales_usd: 0,
    refund_usd: 0, refund_charged_usd: 0, refund_excess_usd: 0,
    revenue_usd: 0, pending_revenue_usd: 0, collected_total_usd: 0, cost_usd: 0, profit_usd: 0, avg_order_usd: 0,
  }
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ---- Canonical revenue = NET SALES (user directive, Sep 1 2026) ------------
// One definition, used identically by every surface below so the Sales-page
// header and the Reports kernel can never disagree:
//   revenue = SUM over RECOGNIZED sales of (subtotal - store discount -
//             membership discount) - customer refunds
// A RECOGNIZED sale is one that is NOT CANCELLED -- clause 4 of the scoping
// rule above, restated so this block cannot drift from it: the
// awaiting_payment cohort is INSIDE revenue, COGS, profit and delivery
// (recognizedExpr is `<> 'cancelled'`, lineage commit fd7c49ba) and is
// ADDITIONALLY reported as pending_*. That block is a subset, not a
// complement; nothing may add the two together, and nothing may describe the
// cohort as becoming revenue later -- it is already in. Tax and delivery fees
// are excluded from revenue on both sides of the split. These are
// SQL-fragment builders (never user input) so string-building them is safe.
// `p` is the table-alias prefix for the `sales` row, e.g. '', 's.' or 'sales.'.
//
// The status is normalised exactly as GET /api/sales/stats does --
// COALESCE(NULLIF(...,''),'completed') -- so a blank status counts as completed
// on BOTH surfaces and the two revenue numbers converge to the byte.
export function saleStatusExpr(p: string): string { return `COALESCE(NULLIF(${p}sale_status, ''), 'completed')` }
// Business results count every sale that has left stock, including receivables.
// Cash collection is a separate concern (see collectedSaleExpr).
export function recognizedExpr(p: string): string { return `${saleStatusExpr(p)} <> 'cancelled'` }
export function awaitingExpr(p: string): string { return `${saleStatusExpr(p)} = 'awaiting_payment'` }
export function collectedSaleExpr(p: string): string { return `${saleStatusExpr(p)} NOT IN ('cancelled', 'awaiting_payment')` }
// Net sale value (subtotal minus both discounts) -- tax and delivery excluded.
//
// Floored at zero PER SALE (owner rule N6). Nothing in the schema stops
// discount_usd + membership_discount_usd exceeding subtotal_usd, and an
// imported receipt whose subtotal was never written has a basis of 0 while its
// discounts survive. Such a row is a broken record, not negative income: left
// unfloored it would drag the whole window's revenue down and present a data
// defect as a business result. The raw components stay visible beside it --
// gross_sales_usd is still SUM(subtotal_usd) and both discount lines are
// reported in full -- so the row that cannot foot is findable, and this is a
// row-level invariant rather than a clamp on the displayed total.
export function rawNetSaleExpr(p: string): string {
  return `(COALESCE(${p}subtotal_usd, 0) - COALESCE(${p}discount_usd, 0) - COALESCE(${p}membership_discount_usd, 0))`
}
export function netSaleExpr(p: string): string {
  return `MAX(0, ${rawNetSaleExpr(p)})`
}
// A receipt whose HEADER value was recorded at all.
//
// `subtotal_usd = 0` on a sale that has line items means the header total was
// never written -- the Sep 2-3 import wrote 22 such receipts (ids 16842-16863,
// see lib/legacySubtotalRepair.ts). A genuinely comped sale does not look like
// this: it records the goods at their price and takes the whole amount off as a
// discount, so its subtotal is positive and its net is 0. The second half
// catches the mirror defect -- discounts recorded larger than the subtotal they
// come off, a header that does not foot.
//
// WHY IT GATES COGS. An unvalued receipt already contributes 0 revenue
// (netSaleExpr floors it), so leaving its COGS in charges the goods against
// income that no row records -- one day's profit goes negative by the whole
// cost of the import defect, with nothing on screen to explain it. Revenue and
// COGS have to be a matched pair over ONE population or profit is not a
// difference of anything. Nothing is hidden: unvalued_tx_count and
// unvalued_cost_usd report the receipts and the money held out, so the repair
// is measurable instead of being averaged into the result.
//
// Also the fix for a live asymmetry: routes/compat.ts's by-product
// apportionment already drops zero-subtotal sales (it cannot divide by 0), so
// before this the by-product view and the by-sale view were measuring
// different populations of the same window.
export function valuedSaleExpr(p: string): string {
  return `(COALESCE(${p}subtotal_usd, 0) > 0 AND ${rawNetSaleExpr(p)} >= 0)`
}
/** Recognized AND valued -- the population COGS is measured over. */
export function recognizedValuedExpr(p: string): string {
  return `(${recognizedExpr(p)} AND ${valuedSaleExpr(p)})`
}
// Money the till actually took for one sale row.
//
// For an ordinary sale that is total_usd, and a replacement sale written
// under the CURRENT model is an ordinary sale: the customer pays for it in
// full, so returns.ts records amount_paid_usd == total_usd and this CASE is a
// no-op for those rows.
//
// It still has to exist for HISTORY. Replacement rows written under the old
// exchange model (returns.ts wrote them with sales.source_return_id set,
// migration 0106, and an amount_paid of only the price difference the
// customer topped up) really did collect less than total_usd -- an even
// exchange collected $0 even though total_usd carried the full value of what
// left the shelf. Reading amount_paid_usd for source_return_id rows keeps
// those old days reporting the money the till actually took, while the sale
// is still COUNTED (goods really moved) rather than dropped from the
// breakdown.
//
// Revenue is untouched by this: the sale's value and the return's refund are
// each recognized on their own through CUSTOMER_REFUND_JOIN.
export function collectedExpr(p: string): string {
  return `CASE WHEN COALESCE(${p}source_return_id, 0) <> 0 THEN COALESCE(${p}amount_paid_usd, 0) ELSE COALESCE(${p}total_usd, 0) END`
}
// The delivery fee the CUSTOMER paid (a store-absorbed fee was never collected).
export function customerDeliveryFeeExpr(p: string): string {
  return `CASE WHEN COALESCE(${p}delivery_fee_paid_by, 'customer') = 'store' THEN 0 ELSE COALESCE(${p}delivery_fee_usd, 0) END`
}
// The delivery fee the SHOP absorbed (customer not charged). Revenue FORGONE,
// not cash paid out -- see correction (a) in the header. Reported because the
// shop wants to see what it gives away; never subtracted from profit, because
// the income figure already excludes it.
function storeDeliveryExpr(p: string): string {
  return `CASE WHEN COALESCE(${p}delivery_fee_paid_by, 'customer') = 'store' THEN COALESCE(${p}delivery_fee_usd, 0) ELSE 0 END`
}
// The courier money actually paid out, as recorded ON THE SALE. Cash out.
//
// The NOT EXISTS is the anti-double-count: a sale whose courier payment was
// also written as a standalone `fees` delivery row would otherwise be charged
// twice, once here and once in that stream. No production row is linked that
// way today (all 2,540 delivery fee rows have sale_id NULL), which is exactly
// why the guard has to be written now rather than after the first one is.
//
// NULL means "not recorded", never zero. Measured Sep 4 2026: exactly 12 of
// 15,044 sales carry a courier cost, they are ids 16836-16872, and every one of
// them is awaiting_payment.
//
// CORRECTED Sep 6 2026: the note here used to conclude "so this expression
// contributes nothing to a recognized figure yet". That was already false when
// it was written -- recognizedExpr is `<> 'cancelled'`, which ADMITS
// awaiting_payment, so those 12 courier costs reduce delivery_net_usd and
// therefore profit_usd today, and are reported a second time as
// pending_delivery_cost_usd. Both readings are deliberate (the pending block is
// a subset of the realised one, see clause 4 of the scoping rule above); what
// was wrong was the claim that the cohort was invisible.
// delivery_actual_cost_count reports how many sales recorded a
// cost, so a near-empty column reads as missing data rather than free delivery.
export function deliveryActualCostExpr(p: string): string {
  return `CASE WHEN EXISTS (
      SELECT 1 FROM fees
      WHERE fees.sale_id = ${p}id AND COALESCE(fees.fee_type, '') = 'delivery'
    ) THEN 0 ELSE COALESCE(${p}delivery_actual_cost_usd, 0) END`
}
// The share of a refund that comes back OUT of net-sales revenue.
//
// revenue is (subtotal - store discount - membership discount); a refund is the
// line's CHARGED price, which has neither discount taken off it. Subtracting it
// whole removes the line's share of those discounts a second time -- they were
// already removed when the sale was recognized. Scaling by net/subtotal puts the
// refund on the same basis as the thing it is reducing.
//
// subtotal = 0 has no basis to scale against (a fully comped sale, or a manual
// return with no sale behind it), so the refund passes through unscaled: the
// money did leave the till.
//
// CAPPED at the sale's own net value (owner rule N6). The unscaled branch is
// exactly where a period revenue went negative: with subtotal_usd = 0 the
// sale's net is 0, and subtracting the full charged refund made that receipt
// contribute MINUS the refund -- the Sep 2-3 import's zero-subtotal receipts
// are the live population. The quantity guard in routes/returns.ts bounds
// UNITS per sale line, never money, so nothing else asserts this.
//
// A refund reverses recognition; it cannot reverse more than was recognised.
// The cash is not lost from the books: refund_paid_out_usd carries the full
// charged figure and refundExcessExpr carries the difference, so a window
// with unabsorbable refunds reports the defect instead of absorbing it.
export function refundBasisExpr(p: string, rf: string): string {
  return `CASE WHEN COALESCE(${p}subtotal_usd, 0) > 0
    THEN COALESCE(${rf}refund_usd, 0) * (${netSaleExpr(p)} / COALESCE(${p}subtotal_usd, 0))
    ELSE COALESCE(${rf}refund_usd, 0) END`
}
export function netRefundExpr(p: string, rf: string): string {
  return `MIN(${netSaleExpr(p)}, ${refundBasisExpr(p, rf)})`
}
// The part of a refund the sale it belongs to could not absorb -- always 0 on
// healthy data, and the size of the data defect when it is not.
export function refundExcessExpr(p: string, rf: string): string {
  return `MAX(0, ${refundBasisExpr(p, rf)} - ${netSaleExpr(p)})`
}
// Goods that went back on the SELLABLE shelf, in SQL. This is
// lib/returnsStock.ts's normalizeStockAction spelled for SQLite, and it has to
// stay that way: routes/returns.ts decides what to restock with that function,
// so if the two ever disagree the books say one thing and the shelf another.
// An explicit stock_action wins; absent, the historical return_to_stock boolean
// keeps its meaning (default TRUE).
// The sale-level revenue block, written ONCE.
//
// Every query that feeds deriveTotals must measure revenue on the same basis or
// the trend chart stops summing back to the headline above it. They were four
// separate copies and they had already diverged; interpolating one constant is
// what makes "the Dashboard and the Sales page agree" a property of the code
// rather than a thing someone re-checks.
//
// Every query using it selects FROM sales unaliased, which is why the prefix is
// '' and the correlated cost lookup says sales.id.
export const RECOGNIZED_LEVEL_COLUMNS = `
             COALESCE(SUM(CASE WHEN ${recognizedExpr('')} THEN ${netSaleExpr('')} ELSE 0 END), 0) AS recognized_net_usd,
             COALESCE(SUM(CASE WHEN ${awaitingExpr('')} THEN ${netSaleExpr('')} ELSE 0 END), 0) AS pending_revenue_usd,
             COALESCE(SUM(CASE WHEN ${recognizedExpr('')} THEN tax_usd ELSE 0 END), 0) AS recognized_tax_usd,
             COALESCE(SUM(CASE WHEN ${recognizedExpr('')} THEN ${customerDeliveryFeeExpr('')} ELSE 0 END), 0) AS recognized_delivery_usd,
             COALESCE(SUM(CASE WHEN ${recognizedExpr('')} THEN ${storeDeliveryExpr('')} ELSE 0 END), 0) AS recognized_store_delivery_usd,
             COALESCE(SUM(CASE WHEN ${recognizedExpr('')} THEN ${deliveryActualCostExpr('sales.')} ELSE 0 END), 0) AS recognized_delivery_cost_usd,
             COALESCE(SUM(CASE WHEN ${collectedSaleExpr('')} THEN ${netSaleExpr('')} ELSE 0 END), 0) AS collected_net_usd,
             COALESCE(SUM(CASE WHEN ${collectedSaleExpr('')} THEN tax_usd ELSE 0 END), 0) AS collected_tax_usd,
             COALESCE(SUM(CASE WHEN ${collectedSaleExpr('')} THEN ${customerDeliveryFeeExpr('')} ELSE 0 END), 0) AS collected_delivery_usd,
             -- The refund on the NET basis revenue is measured on (see the
             -- header); refund_paid_out_usd keeps the cash figure beside it.
             COALESCE(SUM(CASE WHEN ${recognizedExpr('')} THEN ${netRefundExpr('', 'rf.')} ELSE 0 END), 0) AS refund_usd,
             COALESCE(SUM(CASE WHEN ${collectedSaleExpr('')} THEN COALESCE(rf.refund_usd, 0) ELSE 0 END), 0) AS refund_paid_out_usd,
             COALESCE(SUM(CASE WHEN ${recognizedExpr('')} THEN COALESCE(rf.refund_usd, 0) ELSE 0 END), 0) AS refund_charged_usd,
             -- Money a refund could not take back out of the sale it belongs to
             -- (netRefundExpr's cap, owner rule N6). Non-zero means a data
             -- defect in the window -- a receipt refunded for more than it ever
             -- recognised -- reported rather than absorbed.
             COALESCE(SUM(CASE WHEN ${recognizedExpr('')} THEN ${refundExcessExpr('', 'rf.')} ELSE 0 END), 0) AS refund_excess_usd,
             -- Recognized receipts whose header value was never recorded (see
             -- valuedSaleExpr). They contribute 0 revenue and are held out of
             -- COGS so profit stays a difference over one population; counted
             -- here so the repair backlog is a number, not an absence.
             COALESCE(SUM(CASE WHEN ${recognizedExpr('')} AND NOT ${valuedSaleExpr('')} THEN 1 ELSE 0 END), 0) AS unvalued_tx_count,
             -- The awaiting-payment cohort, split the same way (S4R3-6). Each
             -- of these is the pending twin of a recognized column above.
             -- Clause 4 of the scoping rule: this cohort is INSIDE
             -- revenue_usd / cost_usd / profit_usd as well, so the pending
             -- block is a subset that isolates the unpaid part -- never a
             -- complement, and never added to the realised figures.
             COALESCE(SUM(CASE WHEN ${awaitingExpr('')} THEN 1 ELSE 0 END), 0) AS pending_tx_count,
             COALESCE(SUM(CASE WHEN ${awaitingExpr('')} THEN COALESCE(subtotal_usd, 0) ELSE 0 END), 0) AS pending_gross_sales_usd,
             COALESCE(SUM(CASE WHEN ${awaitingExpr('')} THEN COALESCE(discount_usd, 0) ELSE 0 END), 0) AS pending_store_discount_usd,
             COALESCE(SUM(CASE WHEN ${awaitingExpr('')} THEN COALESCE(membership_discount_usd, 0) ELSE 0 END), 0) AS pending_membership_discount_usd,
             COALESCE(SUM(CASE WHEN ${awaitingExpr('')} THEN ${customerDeliveryFeeExpr('')} ELSE 0 END), 0) AS pending_delivery_usd,
             COALESCE(SUM(CASE WHEN ${awaitingExpr('')} THEN ${deliveryActualCostExpr('sales.')} ELSE 0 END), 0) AS pending_delivery_cost_usd`

export const RESTOCKED_RETURN_LINE = `CASE
    WHEN LOWER(TRIM(COALESCE(ri.stock_action, ''))) IN ('restock', 'damaged', 'none')
      THEN LOWER(TRIM(ri.stock_action)) = 'restock'
    ELSE COALESCE(ri.return_to_stock, 1) <> 0
  END`
// Pre-aggregated customer refunds per sale (non-cancelled customer returns), so
// a sale carrying two returns still subtracts once. Refunds attribute to the
// SALE's date bucket via sale_id -- identical to GET /api/sales/stats. Join it
// as `rf` and read COALESCE(rf.refund_usd, 0).
export const CUSTOMER_REFUND_JOIN = `LEFT JOIN (
      SELECT sale_id, SUM(total_refund_usd) AS refund_usd
      FROM returns
      WHERE COALESCE(status, 'completed') <> 'cancelled' AND COALESCE(return_scope, 'customer') = 'customer'
      GROUP BY sale_id
    ) rf ON rf.sale_id = `

// Builds the shared WHERE clause + bound params for "active sales in this
// date range (and optional branch)". `alias` lets callers use this against
// either a bare `sales` table or an aliased `s` in a join.
export function whereActiveSales(alias: string, f: SalesFilters) {
  const params: Record<string, unknown> = {}
  const clauses: string[] = []
  // Local-day range, bucketed in the fixed business timezone UTC+7 (Cambodia).
  // Both endpoints are optional so the Reports hub can represent true all-time
  // (or a one-sided range) without inventing a fake historical boundary.
  if (f.startDate && f.endDate) {
    params.startDate = f.startDate
    params.endDate = f.endDate
    clauses.push(localDateRangeClause(`${alias}.created_at`))
  } else if (f.startDate) {
    params.startDate = f.startDate
    clauses.push(localDateAtOrAfter(`${alias}.created_at`))
  } else if (f.endDate) {
    params.endDate = f.endDate
    clauses.push(localDateAtOrBefore(`${alias}.created_at`))
  }
  // Status: an explicit filter wins over the default hide-cancelled guard, so
  // a caller asking for 'cancelled' actually gets cancelled sales. Bound as a
  // param -- never interpolated -- so an arbitrary value is injection-safe and
  // simply matches nothing.
  const status = typeof f.status === 'string' ? f.status.trim() : ''
  if (status) {
    clauses.push(`COALESCE(${alias}.sale_status, 'completed') = @status`)
    params.status = status
  } else {
    clauses.push(`COALESCE(${alias}.sale_status, 'completed') <> 'cancelled'`)
  }
  // Payment method: matched against the same normalized label the breakdown
  // groups by (trimmed, empty -> 'Unknown'), so the dropdown values line up.
  const paymentMethod = typeof f.paymentMethod === 'string' ? f.paymentMethod.trim() : ''
  if (paymentMethod) {
    clauses.push(`COALESCE(NULLIF(TRIM(${alias}.payment_method), ''), 'Unknown') = @paymentMethod`)
    params.paymentMethod = paymentMethod
  }
  if (f.branchId) {
    clauses.push(`${alias}.branch_id = @branchId`)
    params.branchId = f.branchId
  }
  if (Number.isSafeInteger(Number(f.maxSaleId)) && Number(f.maxSaleId) > 0) {
    clauses.push(`${alias}.id <= @maxSaleId`)
    params.maxSaleId = Number(f.maxSaleId)
  }
  // Shift window (S4-7). Absent on every pre-existing caller, so those
  // queries are unchanged.
  const shift = shiftWindowWhere(alias, f)
  clauses.push(...shift.clauses)
  Object.assign(params, shift.params)
  const validTime = (v: unknown): v is string => typeof v === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v)
  if (validTime(f.startTime) && validTime(f.endTime)) {
    // The time-of-day window is interpreted in the FIXED business timezone
    // (UTC+7), NOT the viewer's offset -- created_at is stored UTC, so shift by
    // +7h before taking time(). f.tzOffsetMinutes is deliberately ignored.
    params.startTime = f.startTime
    params.endTime = f.endTime
    clauses.push(localTimeRangeClause(`${alias}.created_at`))
  }
  return { sql: clauses.join(' AND '), params }
}

type ReportScalarRow = Record<string, unknown> & { id: number }

export interface SalesReportSnapshot {
  sales: ReportScalarRow[]
  voidSales: ReportScalarRow[]
  items: ReportScalarRow[]
  returns: ReportScalarRow[]
  returnItems: ReportScalarRow[]
  deliveryFees: ReportScalarRow[]
  precision_mode: ReportMoneyPrecisionMode
  row_count: number
}

export type SalesReportScalarScopeValue = string | number | null
export type SalesReportScalarScope = (saleAlias: string) => {
  sql: string
  params: Record<string, SalesReportScalarScopeValue>
}

type CapturedSalesReportScalarScope = { sql: string; params: Record<string, SalesReportScalarScopeValue> }

function captureSalesReportScalarScope(scope?: SalesReportScalarScope): CapturedSalesReportScalarScope | null {
  if (!scope) return null
  const captured = scope('s')
  if (!captured || typeof captured.sql !== 'string' || !captured.sql.trim()
    || captured.sql.includes(';') || captured.sql.includes('--') || captured.sql.includes('/*') || captured.sql.includes('?')) {
    throw new ReportMoneyPrecisionError('unsupported_row')
  }
  const params = captured.params
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new ReportMoneyPrecisionError('unsupported_row')
  const keys = Object.keys(params).sort()
  if (keys.some((key) => !/^reportScope_[A-Za-z][A-Za-z0-9_]*$/.test(key))) {
    throw new ReportMoneyPrecisionError('unsupported_row')
  }
  for (const key of keys) {
    const value = params[key]
    if (value !== null && typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new ReportMoneyPrecisionError('unsupported_row')
    }
  }
  const placeholders = [...new Set([...captured.sql.matchAll(/@([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[1]))].sort()
  if (placeholders.length !== keys.length || placeholders.some((key, index) => key !== keys[index])
    || /(?:^|[^A-Za-z0-9_])[:$][A-Za-z_]/.test(captured.sql)) {
    throw new ReportMoneyPrecisionError('unsupported_row')
  }
  return Object.freeze({ sql: captured.sql.trim(), params: Object.freeze({ ...params }) })
}

function applySalesReportScalarScope<T extends { sql: string; params: Record<string, unknown> }>(
  base: T,
  scope: CapturedSalesReportScalarScope | null,
): T {
  if (!scope) return base
  if (Object.keys(scope.params).some((key) => Object.hasOwn(base.params, key))) {
    throw new ReportMoneyPrecisionError('unsupported_row')
  }
  return { ...base, sql: `(${base.sql}) AND (${scope.sql})`, params: { ...base.params, ...scope.params } }
}

async function reportTableColumns(db: ReturnType<typeof getDb>, table: string): Promise<Set<string>> {
  const rows = await db.prepare(`PRAGMA table_info(${table})`).all<Record<string, unknown>>()
  return new Set((rows || []).map((row) => String(row.name || '')))
}

async function reportRestoreActive(db: ReturnType<typeof getDb>): Promise<boolean> {
  const columns = await reportTableColumns(db, 'system_flags')
  if (!columns.has('key') || !columns.has('value')) return false
  const rows = await db.prepare("SELECT value FROM system_flags WHERE key IN ('maintenance','maintenance_mode') ORDER BY key")
    .all<{ value: unknown }>()
  return (rows || []).some((row) => {
    const raw = String(row.value ?? '').trim()
    if (raw.toLowerCase() === 'restore') return true
    try { return String((JSON.parse(raw) as { mode?: unknown }).mode || '').toLowerCase() === 'restore' } catch { return false }
  })
}

async function assertReportReadable(db: ReturnType<typeof getDb>): Promise<void> {
  if (await reportRestoreActive(db)) throw new ReportMoneyPrecisionError('maintenance_restore')
}

async function reportKeysetRows(
  db: ReturnType<typeof getDb>,
  selectSql: string,
  idExpr: string,
  params: Record<string, unknown>,
  rowBudget: { count: number },
): Promise<ReportScalarRow[]> {
  const output: ReportScalarRow[] = []
  let afterId = 0
  for (;;) {
    const page = await db.prepare(`${selectSql} AND ${idExpr} > @reportAfterId ORDER BY ${idExpr} LIMIT @reportPageSize`)
      .all<ReportScalarRow>({ ...params, reportAfterId: afterId, reportPageSize: REPORT_MONEY_PAGE_SIZE })
    if (!page?.length) break
    rowBudget.count += page.length
    if (page.length > REPORT_MONEY_PAGE_SIZE || rowBudget.count > REPORT_MONEY_MAX_ROWS) {
      throw new ReportMoneyPrecisionError('too_many_rows')
    }
    for (const row of page) {
      const id = Number(row.id)
      if (!Number.isSafeInteger(id) || id <= afterId) throw new ReportMoneyPrecisionError('unsupported_row')
      afterId = id
      output.push(row)
    }
    if (page.length < REPORT_MONEY_PAGE_SIZE) break
  }
  return output
}

function reportRowsEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false
  return true
}

function reportSnapshotScalars(snapshot: SalesReportSnapshot): string[] {
  const rows = [`precision:${snapshot.precision_mode}`]
  for (const [kind, values] of [
    ['sales', snapshot.sales], ['void-sales', snapshot.voidSales], ['items', snapshot.items],
    ['returns', snapshot.returns], ['return-items', snapshot.returnItems], ['delivery-fees', snapshot.deliveryFees],
  ] as const) for (const value of values) rows.push(`${kind}:${JSON.stringify(value)}`)
  return rows
}

async function readSalesReportPass(
  env: Env,
  f: SalesFilters & { contactId?: number | string | null },
  includeDeliveryFees: boolean,
  scalarScope: CapturedSalesReportScalarScope | null,
): Promise<SalesReportSnapshot> {
  const db = getDb(env)
  const salesColumns = await reportTableColumns(db, 'sales')
  const itemColumns = await reportTableColumns(db, 'sale_items')
  const returnColumns = await reportTableColumns(db, 'returns')
  const returnItemColumns = await reportTableColumns(db, 'return_items')
  const feeColumns = await reportTableColumns(db, 'fees')
  const customerColumns = await reportTableColumns(db, 'customers')
  const contactColumns = await reportTableColumns(db, 'delivery_contacts')
  const preciseSales = salesColumns.has('money_precision_version')
    && salesColumns.has('calculated_total_usd') && salesColumns.has('rounding_adjustment_usd')
  const preciseReturns = returnColumns.has('money_precision_version')
    && returnColumns.has('calculated_refund_usd') && returnColumns.has('rounding_adjustment_usd')
  // Never name 0158 columns in SQL prepared against a pre-0158 database.
  // Missing properties naturally select the version-0 exact-recorded path.
  const salePrecision = preciseSales
    ? ',s.money_precision_version,s.calculated_total_usd,s.rounding_adjustment_usd'
    : ''
  const returnPrecision = preciseReturns
    ? ',r.money_precision_version,r.calculated_refund_usd,r.rounding_adjustment_usd'
    : ''
  const customerAnonymous = customerColumns.has('is_anonymous')
    ? 'COALESCE((SELECT is_anonymous FROM customers WHERE customers.id=s.customer_id),0)'
    : '0'
  const itemColumn = (name: string, fallback: string) => itemColumns.has(name) ? `si.${name}` : `${fallback} AS ${name}`
  const saleColumn = (name: string, fallback: string) => salesColumns.has(name) ? `s.${name}` : `${fallback} AS ${name}`
  const linkedDeliveryFee = feeColumns.has('sale_id') && feeColumns.has('fee_type')
    ? "EXISTS(SELECT 1 FROM fees WHERE fees.sale_id=s.id AND COALESCE(fees.fee_type,'')='delivery')" : '0'
  const primary = applySalesReportScalarScope(whereActiveSales('s', f), scalarScope)
  const voids = applySalesReportScalarScope(whereActiveSales('s', { ...f, status: 'cancelled' }), scalarScope)
  const rowBudget = { count: 0 }
  const sales = await reportKeysetRows(db, `SELECT s.id,s.created_at,s.sale_status,s.branch_id,s.branch_name,
      s.cashier_id,s.cashier_name,s.customer_id,s.customer_name,s.customer_phone,s.receipt_number,s.payment_method,
      ${customerAnonymous} AS customer_is_anonymous,
      s.subtotal_usd,s.discount_usd,s.membership_discount_usd,s.tax_usd,s.total_usd,
      s.delivery_fee_usd,s.delivery_fee_paid_by,s.delivery_actual_cost_usd,s.is_delivery,
      s.source_return_id,s.amount_paid_usd${salePrecision},
      ${saleColumn('delivery_contact_id','NULL')},${saleColumn('delivery_contact_name',"''")},
      ${linkedDeliveryFee} AS delivery_has_linked_fee
    FROM sales s WHERE ${primary.sql}`, 's.id', primary.params, rowBudget)
  const voidSales = await reportKeysetRows(db, `SELECT s.id,s.created_at,s.sale_status,s.branch_id,s.branch_name,
      s.cashier_id,s.cashier_name,s.customer_id,s.customer_name,s.customer_phone,s.payment_method,
      ${customerAnonymous} AS customer_is_anonymous
    FROM sales s WHERE ${voids.sql}`, 's.id', voids.params, rowBudget)
  const items = await reportKeysetRows(db, `SELECT si.id,si.sale_id,${itemColumn('product_id','NULL')},${itemColumn('product_name',"''")},si.quantity,
      ${itemColumn('total_usd','0')},si.cost_price_usd,${itemColumn('product_discount_usd','0')},${itemColumn('manual_discount_usd','0')}
    FROM sale_items si WHERE EXISTS(SELECT 1 FROM sales s WHERE s.id=si.sale_id AND ${primary.sql})`, 'si.id', primary.params, rowBudget)
  const returns = await reportKeysetRows(db, `SELECT r.id,r.sale_id,r.total_refund_usd,r.status,r.return_scope${returnPrecision}
    FROM returns r WHERE r.sale_id IS NOT NULL
      AND COALESCE(r.status,'completed')<>'cancelled' AND COALESCE(r.return_scope,'customer')='customer'
      AND EXISTS(SELECT 1 FROM sales s WHERE s.id=r.sale_id AND ${primary.sql})`, 'r.id', primary.params, rowBudget)
  const returnItemPrecision = returnItemColumns.has('refund_snapshot_json')
    ? ',ri.sale_item_id,ri.total_usd,ri.refund_snapshot_json'
    : ''
  const returnItems = await reportKeysetRows(db, `SELECT ri.id,ri.return_id,ri.cost_price_usd,ri.quantity,ri.stock_action,ri.return_to_stock${returnItemPrecision}
    FROM return_items ri WHERE EXISTS(SELECT 1 FROM returns r JOIN sales s ON s.id=r.sale_id
      WHERE r.id=ri.return_id AND COALESCE(r.status,'completed')<>'cancelled'
        AND COALESCE(r.return_scope,'customer')='customer' AND ${primary.sql})`, 'ri.id', primary.params, rowBudget)
  let deliveryFees: ReportScalarRow[] = []
  const deliveryFeeColumns = ['id', 'delivery_contact_id', 'amount_usd', 'amount_khr', 'created_at']
  if (includeDeliveryFees && deliveryFeeColumns.every((name) => feeColumns.has(name))) {
    const feeClauses = ['f.delivery_contact_id IS NOT NULL']
    const feeParams: Record<string, unknown> = {}
    const feeCreatedFrom = shiftWindowBound(f.createdFrom)
    const feeCreatedTo = shiftWindowBound(f.createdTo)
    if (feeCreatedFrom && feeCreatedTo) {
      feeClauses.push('datetime(f.created_at) >= @feeCreatedFrom', 'datetime(f.created_at) < @feeCreatedTo')
      feeParams.feeCreatedFrom = feeCreatedFrom
      feeParams.feeCreatedTo = feeCreatedTo
    } else {
      if (f.startDate && feeColumns.has('fee_date')) { feeClauses.push('f.fee_date >= @feeStartDate'); feeParams.feeStartDate = f.startDate }
      if (f.endDate && feeColumns.has('fee_date')) { feeClauses.push('f.fee_date <= @feeEndDate'); feeParams.feeEndDate = f.endDate }
    }
    if (f.branchId && feeColumns.has('branch_id')) { feeClauses.push('f.branch_id = @feeBranchId'); feeParams.feeBranchId = f.branchId }
    const validTime = (value: unknown): value is string => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
    if (!feeCreatedFrom && !feeCreatedTo && validTime(f.startTime) && validTime(f.endTime)) {
      feeClauses.push(localTimeRangeClause('f.created_at').replaceAll('@startTime', '@feeStartTime').replaceAll('@endTime', '@feeEndTime'))
      feeParams.feeStartTime = f.startTime
      feeParams.feeEndTime = f.endTime
    }
    if (f.contactId != null && f.contactId !== '') {
      feeClauses.push('f.delivery_contact_id = @feeContactId')
      feeParams.feeContactId = f.contactId
    }
    const contactName = feeColumns.has('delivery_contact_name')
      ? "COALESCE(NULLIF(TRIM(f.delivery_contact_name),''),'')"
      : contactColumns.has('id') && contactColumns.has('name') ? "COALESCE(NULLIF(TRIM(dc.name),''),'')" : "''"
    const joinContacts = contactName.includes('dc.') ? 'LEFT JOIN delivery_contacts dc ON dc.id=f.delivery_contact_id' : ''
    deliveryFees = await reportKeysetRows(db, `SELECT f.id,f.delivery_contact_id,${contactName} AS delivery_contact_name,
        f.amount_usd,f.amount_khr,f.created_at
      FROM fees f ${joinContacts} WHERE ${feeClauses.join(' AND ')}`, 'f.id', feeParams, rowBudget)
  }
  const legacy = !preciseSales || !preciseReturns
    || sales.some((row) => Number(row.money_precision_version) === 0)
    || returns.some((row) => Number(row.money_precision_version) === 0)
  return {
    sales, voidSales, items, returns, returnItems, deliveryFees,
    precision_mode: legacy ? 'exact_recorded' : 'canonical_v1',
    row_count: rowBudget.count,
  }
}

/** Two complete ordered scalar passes are compared directly. A changed pass
 * is discarded in full, retried once, and never leaks a partial aggregate. */
export async function readSalesReportSnapshot(
  env: Env,
  f: SalesFilters & { contactId?: number | string | null },
  includeDeliveryFees = false,
  scalarScope?: SalesReportScalarScope,
): Promise<SalesReportSnapshot> {
  const db = getDb(env)
  // Capture a code-generated scope exactly once. Both passes and every child
  // EXISTS consume the same immutable SQL/params, so a stateful callback
  // cannot silently change the cohort between reads.
  const capturedScope = captureSalesReportScalarScope(scalarScope)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assertReportReadable(db)
    const first = await readSalesReportPass(env, f, includeDeliveryFees, capturedScope)
    await assertReportReadable(db)
    const second = await readSalesReportPass(env, f, includeDeliveryFees, capturedScope)
    await assertReportReadable(db)
    if (reportRowsEqual(reportSnapshotScalars(first), reportSnapshotScalars(second))) return first
  }
  throw new ReportMoneyPrecisionError('snapshot_changed')
}

const REPORT_EXACT_KEYS = [
  'gross','storeDiscount','membershipDiscount','tax','delivery','storeDelivery','deliveryActual',
  'recognizedNet','pendingRevenue','recognizedTax','recognizedDelivery','recognizedStoreDelivery','recognizedDeliveryCost',
  'collected','refund','refundPaid','refundCharged','refundExcess','pendingGross','pendingStoreDiscount',
  'pendingMembershipDiscount','pendingDelivery','pendingDeliveryCost','cost','pendingCost','returnedCost',
  'itemDiscount','pendingItemDiscount','unvaluedCost',
] as const
type ReportExactKey = typeof REPORT_EXACT_KEYS[number]
type ReportExactBucket = {
  money: Record<ReportExactKey, ReportExactDecimal>
  tx: number; pendingTx: number; deliveryActualCount: number; deliverySaleCount: number
  cancelledTx: number; unvaluedTx: number; missingCostLines: number
}

function reportBucket(): ReportExactBucket {
  return {
    money: Object.fromEntries(REPORT_EXACT_KEYS.map((key) => [key, ReportExactDecimal.zero()])) as Record<ReportExactKey, ReportExactDecimal>,
    tx: 0, pendingTx: 0, deliveryActualCount: 0, deliverySaleCount: 0, cancelledTx: 0, unvaluedTx: 0, missingCostLines: 0,
  }
}
function reportAdd(bucket: ReportExactBucket, key: ReportExactKey, value: ReportExactDecimal): void {
  bucket.money[key] = bucket.money[key].add(value)
}
function reportVersion(row: ReportScalarRow): 0 | 1 {
  const version = Number(row.money_precision_version ?? 0)
  if (version !== 0 && version !== 1) throw new ReportMoneyPrecisionError('unsupported_precision_version')
  return version
}
function reportMoney(row: ReportScalarRow, key: string, version: 0 | 1, nullableZero = true): ReportExactDecimal {
  const value = row[key]
  if (value == null && nullableZero) return ReportExactDecimal.money(0, version)
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new ReportMoneyPrecisionError(version === 1 ? 'invalid_saved_money4' : 'invalid_recorded_decimal')
  }
  return ReportExactDecimal.money(value, version)
}
function reportStatus(row: ReportScalarRow): string { return String(row.sale_status || 'completed') }
function reportRestocked(row: ReportScalarRow): boolean {
  const action = String(row.stock_action || '').trim().toLowerCase()
  return ['restock', 'damaged', 'none'].includes(action) ? action === 'restock' : Number(row.return_to_stock ?? 1) !== 0
}

type ReportSaleFacts = {
  sale: ReportScalarRow; version: 0 | 1; recognized: boolean; awaiting: boolean; valued: boolean
  net: ReportExactDecimal; adjustment: ReportExactDecimal; refund: ReportExactDecimal; refundPaid: ReportExactDecimal
  refundExcess: ReportExactDecimal
  delivery: ReportExactDecimal; deliveryActual: ReportExactDecimal; cost: ReportExactDecimal; returnedCost: ReportExactDecimal
  itemDiscount: ReportExactDecimal; pendingCost: ReportExactDecimal; unvaluedCost: ReportExactDecimal; missingCostLines: number
}

type V1RefundLine = { row: ReportScalarRow; snapshot: CustomerReturnRefundSnapshotV1 }

function reportV1RefundReversal(
  saleId: number,
  returnedRows: ReportScalarRow[],
  linesByReturn: Map<number, ReportScalarRow[]>,
): { merchandise: ReportExactDecimal; tax: ReportExactDecimal } {
  const bySaleItem = new Map<number, V1RefundLine[]>()
  for (const returned of returnedRows) {
    if (reportVersion(returned) !== 1) continue
    const lines = linesByReturn.get(Number(returned.id)) || []
    if (lines.length === 0) throw new ReportMoneyPrecisionError('unsupported_row')
    let calculated = ReportExactDecimal.zero()
    for (const row of lines) {
      let parsed: CustomerReturnRefundSnapshotV1 | null = null
      try { parsed = parseCustomerReturnRefundSnapshot(row.refund_snapshot_json as string | null | undefined) }
      catch { throw new ReportMoneyPrecisionError('unsupported_row') }
      if (!parsed || parsed.sale_id !== saleId || parsed.sale_item_id !== Number(row.sale_item_id)
        || ReportExactDecimal.quantity(row.quantity as string | number).compare(ReportExactDecimal.quantity(parsed.return_quantity)) !== 0
        || reportMoney(row, 'total_usd', 1, false).compare(ReportExactDecimal.money(parsed.calculated_refund_usd, 1)) !== 0) {
        throw new ReportMoneyPrecisionError('unsupported_row')
      }
      calculated = calculated.add(ReportExactDecimal.money(parsed.calculated_refund_usd, 1))
      bySaleItem.set(parsed.sale_item_id, [...(bySaleItem.get(parsed.sale_item_id) || []), { row, snapshot: parsed }])
    }
    if (calculated.compare(reportMoney(returned, 'calculated_refund_usd', 1, false)) !== 0) {
      throw new ReportMoneyPrecisionError('unsupported_row')
    }
  }
  let merchandise = ReportExactDecimal.zero(), tax = ReportExactDecimal.zero()
  for (const cohort of bySaleItem.values()) {
    const source = cohort[0].snapshot
    let returnedQuantity = ReportExactDecimal.zero()
    for (const { row, snapshot } of cohort) {
      if (snapshot.sold_quantity !== source.sold_quantity
        || snapshot.net_entitlement_usd !== source.net_entitlement_usd
        || snapshot.receipt_allocation.tax_usd !== source.receipt_allocation.tax_usd
        || snapshot.source_pricing_snapshot_digest !== source.source_pricing_snapshot_digest) {
        throw new ReportMoneyPrecisionError('unsupported_row')
      }
      returnedQuantity = returnedQuantity.add(ReportExactDecimal.quantity(row.quantity as string | number))
    }
    if (returnedQuantity.compare(ReportExactDecimal.quantity(source.sold_quantity)) > 0) {
      throw new ReportMoneyPrecisionError('unsupported_row')
    }
    const quantity = returnedQuantity.toExactNumber()
    let entitlementValue: number, taxValue: number
    try {
      entitlementValue = prorateCustomerReturnMoney4(source.net_entitlement_usd, quantity, source.sold_quantity)
      taxValue = prorateCustomerReturnMoney4(source.receipt_allocation.tax_usd, quantity, source.sold_quantity)
    } catch { throw new ReportMoneyPrecisionError('unsupported_row') }
    const entitlement = ReportExactDecimal.money(entitlementValue, 1)
    const taxPart = ReportExactDecimal.money(taxValue, 1)
    if (taxPart.isNegative() || taxPart.compare(entitlement) > 0) throw new ReportMoneyPrecisionError('unsupported_row')
    tax = tax.add(taxPart)
    merchandise = merchandise.add(entitlement.subtract(taxPart))
  }
  return { merchandise, tax }
}

function reportSaleFacts(snapshot: SalesReportSnapshot): ReportSaleFacts[] {
  const items = new Map<number, ReportScalarRow[]>()
  for (const row of snapshot.items) { const id = Number(row.sale_id); items.set(id, [...(items.get(id) || []), row]) }
  const returns = new Map<number, ReportScalarRow[]>()
  for (const row of snapshot.returns) { const id = Number(row.sale_id); returns.set(id, [...(returns.get(id) || []), row]) }
  const returnItems = new Map<number, ReportScalarRow[]>()
  for (const row of snapshot.returnItems) { const id = Number(row.return_id); returnItems.set(id, [...(returnItems.get(id) || []), row]) }
  return snapshot.sales.map((sale) => {
    const version = reportVersion(sale)
    const subtotal = reportMoney(sale, 'subtotal_usd', version)
    const storeDiscount = reportMoney(sale, 'discount_usd', version)
    const membershipDiscount = reportMoney(sale, 'membership_discount_usd', version)
    const rawNet = subtotal.subtract(storeDiscount).subtract(membershipDiscount)
    const net = rawNet.max(ReportExactDecimal.zero())
    const valued = subtotal.isPositive() && !rawNet.isNegative()
    const recognized = reportStatus(sale) !== 'cancelled'
    const awaiting = reportStatus(sale) === 'awaiting_payment'
    let adjustment = ReportExactDecimal.zero()
    if (version === 1) {
      reportMoney(sale, 'calculated_total_usd', version, false)
      reportMoney(sale, 'total_usd', version, false)
      adjustment = reportMoney(sale, 'rounding_adjustment_usd', version, false)
    }
    let refundPaid = ReportExactDecimal.zero()
    let legacyRefundPaid = ReportExactDecimal.zero()
    let returnedCost = ReportExactDecimal.zero()
    let missingCostLines = 0
    for (const returned of returns.get(Number(sale.id)) || []) {
      const returnVersion = reportVersion(returned)
      if (returnVersion === 1) {
        try { validateRefundMoneySnapshot({ money_precision_version: returned.money_precision_version,
          calculated_refund_usd: returned.calculated_refund_usd,
          rounding_adjustment_usd: returned.rounding_adjustment_usd,
          total_refund_usd: returned.total_refund_usd }) }
        catch { throw new ReportMoneyPrecisionError('unsupported_row') }
      }
      const payout = reportMoney(returned, 'total_refund_usd', returnVersion, false)
      if (returnVersion === 1) {
        reportMoney(returned, 'calculated_refund_usd', returnVersion, false)
        reportMoney(returned, 'rounding_adjustment_usd', returnVersion, false)
      }
      refundPaid = refundPaid.add(payout)
      if (returnVersion === 0) legacyRefundPaid = legacyRefundPaid.add(payout)
      for (const line of returnItems.get(Number(returned.id)) || []) {
        const quantity = ReportExactDecimal.quantity(line.quantity as string | number)
        if (line.cost_price_usd == null) { if (reportRestocked(line)) missingCostLines += 1; continue }
        const unit = reportMoney(line, 'cost_price_usd', returnVersion, false)
        if (unit.isNegative()) throw new ReportMoneyPrecisionError(returnVersion === 1 ? 'invalid_saved_money4' : 'invalid_recorded_decimal')
        if (reportRestocked(line)) returnedCost = returnedCost.add(unit.multiply(quantity))
      }
    }
    const v1Refund = reportV1RefundReversal(Number(sale.id), returns.get(Number(sale.id)) || [], returnItems)
    const legacyBasis = subtotal.isPositive() ? legacyRefundPaid.multiply(net).divide(subtotal) : legacyRefundPaid
    const basis = legacyBasis.add(v1Refund.merchandise)
    const refund = net.min(basis)
    const refundExcess = basis.subtract(net).max(ReportExactDecimal.zero())
    let cost = ReportExactDecimal.zero(), pendingCost = ReportExactDecimal.zero(), unvaluedCost = ReportExactDecimal.zero()
    let itemDiscount = ReportExactDecimal.zero()
    for (const item of items.get(Number(sale.id)) || []) {
      const quantity = ReportExactDecimal.quantity(item.quantity as string | number)
      reportMoney(item, 'total_usd', version)
      const discount = reportMoney(item, 'product_discount_usd', version).add(reportMoney(item, 'manual_discount_usd', version))
      if (recognized) itemDiscount = itemDiscount.add(discount)
      if (item.cost_price_usd == null) { if (recognized && valued) missingCostLines += 1; continue }
      const unit = reportMoney(item, 'cost_price_usd', version, false)
      if (unit.isNegative()) throw new ReportMoneyPrecisionError(version === 1 ? 'invalid_saved_money4' : 'invalid_recorded_decimal')
      const lineCost = unit.multiply(quantity)
      if (recognized && valued) cost = cost.add(lineCost)
      if (recognized && !valued) unvaluedCost = unvaluedCost.add(lineCost)
      if (awaiting) pendingCost = pendingCost.add(lineCost)
    }
    const delivery = String(sale.delivery_fee_paid_by || 'customer') === 'store'
      ? ReportExactDecimal.zero() : reportMoney(sale, 'delivery_fee_usd', version)
    const deliveryActual = Number(sale.delivery_has_linked_fee) !== 0
      ? ReportExactDecimal.zero() : reportMoney(sale, 'delivery_actual_cost_usd', version)
    return { sale, version, recognized, awaiting, valued, net, adjustment, refund, refundPaid, refundExcess, delivery, deliveryActual,
      cost, returnedCost, itemDiscount, pendingCost, unvaluedCost, missingCostLines }
  })
}

export type ReportMoneyReadDiagnostic = {
  precision_mode: ReportMoneyPrecisionMode
  complete: boolean
  unknown_cost_lines: number
  contributing_rows: number
}
const REPORT_MONEY_DIAGNOSTIC = Symbol('report-money-diagnostic')
type WithReportDiagnostic = { [REPORT_MONEY_DIAGNOSTIC]?: ReportMoneyReadDiagnostic }
export function reportMoneyDiagnostic(value: object): ReportMoneyReadDiagnostic | null {
  return (value as WithReportDiagnostic)[REPORT_MONEY_DIAGNOSTIC] || null
}
function attachReportDiagnostic<T extends object>(value: T, diagnostic: ReportMoneyReadDiagnostic): T {
  Object.defineProperty(value, REPORT_MONEY_DIAGNOSTIC, { value: diagnostic, enumerable: false })
  return value
}

function aggregateReportSnapshot(
  snapshot: SalesReportSnapshot,
  bucketForSale: (sale: ReportScalarRow) => string,
): Map<string, ReportExactBucket> {
  const buckets = new Map<string, ReportExactBucket>()
  const getBucket = (key: string) => { const found = buckets.get(key) || reportBucket(); buckets.set(key, found); return found }
  for (const fact of reportSaleFacts(snapshot)) {
    const { sale, version } = fact
    const bucket = getBucket(bucketForSale(sale))
    bucket.tx += 1
    const subtotal = reportMoney(sale, 'subtotal_usd', version)
    const storeDiscount = reportMoney(sale, 'discount_usd', version)
    const membershipDiscount = reportMoney(sale, 'membership_discount_usd', version)
    const tax = reportMoney(sale, 'tax_usd', version)
    const deliveryFee = reportMoney(sale, 'delivery_fee_usd', version)
    const storeDelivery = String(sale.delivery_fee_paid_by || 'customer') === 'store' ? deliveryFee : ReportExactDecimal.zero()
    const rawActual = reportMoney(sale, 'delivery_actual_cost_usd', version)
    reportAdd(bucket, 'gross', subtotal); reportAdd(bucket, 'storeDiscount', storeDiscount)
    reportAdd(bucket, 'membershipDiscount', membershipDiscount); reportAdd(bucket, 'tax', tax)
    reportAdd(bucket, 'delivery', fact.delivery); reportAdd(bucket, 'storeDelivery', storeDelivery)
    reportAdd(bucket, 'deliveryActual', rawActual)
    if (sale.delivery_actual_cost_usd != null) bucket.deliveryActualCount += 1
    if (Number(sale.is_delivery) === 1) bucket.deliverySaleCount += 1
    bucket.missingCostLines += fact.missingCostLines
    if (!fact.recognized) continue
    const recognizedNet = fact.net.add(fact.adjustment)
    reportAdd(bucket, 'recognizedNet', recognizedNet); reportAdd(bucket, 'recognizedTax', tax)
    reportAdd(bucket, 'recognizedDelivery', fact.delivery); reportAdd(bucket, 'recognizedStoreDelivery', storeDelivery)
    reportAdd(bucket, 'recognizedDeliveryCost', fact.deliveryActual)
    reportAdd(bucket, 'refund', fact.refund); reportAdd(bucket, 'refundCharged', fact.refundPaid)
    reportAdd(bucket, 'refundExcess', fact.refundExcess); reportAdd(bucket, 'cost', fact.cost)
    reportAdd(bucket, 'returnedCost', fact.valued ? fact.returnedCost : ReportExactDecimal.zero())
    reportAdd(bucket, 'itemDiscount', fact.itemDiscount); reportAdd(bucket, 'unvaluedCost', fact.unvaluedCost)
    if (!fact.valued) bucket.unvaluedTx += 1
    const collected = reportStatus(sale) !== 'awaiting_payment'
    if (collected) {
      const payable = Number(sale.source_return_id || 0) !== 0
        ? reportMoney(sale, 'amount_paid_usd', version) : reportMoney(sale, 'total_usd', version)
      reportAdd(bucket, 'collected', payable.subtract(fact.refundPaid))
      reportAdd(bucket, 'refundPaid', fact.refundPaid)
    }
    if (fact.awaiting) {
      bucket.pendingTx += 1
      reportAdd(bucket, 'pendingRevenue', recognizedNet); reportAdd(bucket, 'pendingGross', subtotal)
      reportAdd(bucket, 'pendingStoreDiscount', storeDiscount); reportAdd(bucket, 'pendingMembershipDiscount', membershipDiscount)
      reportAdd(bucket, 'pendingDelivery', fact.delivery); reportAdd(bucket, 'pendingDeliveryCost', fact.deliveryActual)
      reportAdd(bucket, 'pendingCost', fact.pendingCost); reportAdd(bucket, 'pendingItemDiscount', fact.itemDiscount)
    }
  }
  for (const sale of snapshot.voidSales) getBucket(bucketForSale(sale)).cancelledTx += 1
  return buckets
}

function exactReportTotals(bucket: ReportExactBucket, snapshot: SalesReportSnapshot): SalesTotals {
  const m = bucket.money
  const zero = ReportExactDecimal.zero()
  const discount = m.storeDiscount.add(m.membershipDiscount)
  const totalDiscount = discount.add(m.itemDiscount)
  const revenue = m.recognizedNet.subtract(m.refund)
  const netCost = m.cost.subtract(m.returnedCost).max(zero)
  const returnedCostShortfall = m.returnedCost.subtract(m.cost).max(zero)
  const deliveryNet = m.recognizedDelivery.subtract(m.recognizedDeliveryCost)
  const profit = revenue.subtract(netCost).add(deliveryNet)
  const pendingProfit = m.pendingRevenue.subtract(m.pendingCost).add(m.pendingDelivery.subtract(m.pendingDeliveryCost))
  const diagnostic: ReportMoneyReadDiagnostic = {
    precision_mode: snapshot.precision_mode,
    complete: bucket.missingCostLines === 0,
    unknown_cost_lines: bucket.missingCostLines,
    contributing_rows: snapshot.row_count,
  }
  return attachReportDiagnostic({
    tx_count: bucket.tx,
    gross_sales_usd: m.gross.toNumber(),
    store_discount_usd: m.storeDiscount.toNumber(),
    membership_discount_usd: m.membershipDiscount.toNumber(),
    discount_usd: discount.toNumber(),
    item_discount_usd: m.itemDiscount.toNumber(),
    total_discount_usd: totalDiscount.toNumber(),
    tax_usd: m.tax.toNumber(),
    delivery_usd: m.delivery.toNumber(),
    store_delivery_usd: m.storeDelivery.toNumber(),
    delivery_actual_cost_usd: m.deliveryActual.toNumber(),
    delivery_actual_cost_count: bucket.deliveryActualCount,
    delivery_sale_count: bucket.deliverySaleCount,
    delivery_margin_usd: m.delivery.subtract(m.deliveryActual).toNumber(),
    delivery_net_usd: deliveryNet.toNumber(),
    recognized_delivery_usd: m.recognizedDelivery.toNumber(),
    recognized_delivery_cost_usd: m.recognizedDeliveryCost.toNumber(),
    pending_tx_count: bucket.pendingTx,
    pending_gross_sales_usd: m.pendingGross.toNumber(),
    pending_store_discount_usd: m.pendingStoreDiscount.toNumber(),
    pending_membership_discount_usd: m.pendingMembershipDiscount.toNumber(),
    pending_delivery_usd: m.pendingDelivery.toNumber(),
    pending_delivery_cost_usd: m.pendingDeliveryCost.toNumber(),
    pending_cost_usd: m.pendingCost.toNumber(),
    pending_profit_usd: pendingProfit.toNumber(),
    pending_item_discount_usd: m.pendingItemDiscount.toNumber(),
    cancelled_tx_count: bucket.cancelledTx,
    returned_cost_usd: m.cost.min(m.returnedCost).toNumber(),
    returned_cost_shortfall_usd: returnedCostShortfall.toNumber(),
    unvalued_tx_count: bucket.unvaluedTx,
    unvalued_cost_usd: m.unvaluedCost.toNumber(),
    net_sales_usd: m.recognizedNet.toNumber(),
    refund_usd: m.refund.toNumber(),
    refund_charged_usd: m.refundCharged.toNumber(),
    refund_excess_usd: m.refundExcess.toNumber(),
    revenue_usd: revenue.toNumber(),
    pending_revenue_usd: m.pendingRevenue.toNumber(),
    collected_total_usd: m.collected.toNumber(),
    cost_usd: netCost.toNumber(),
    profit_usd: profit.toNumber(),
    avg_order_usd: bucket.tx > 0 ? revenue.divide(ReportExactDecimal.recorded(String(bucket.tx))).toNumber() : 0,
  }, diagnostic)
}

/** Reuse the canonical reducer when one caller needs several views of the
 * same verified snapshot. No second read and no parallel report formula. */
export function salesTotalsFromSnapshot(snapshot: SalesReportSnapshot): SalesTotals {
  return exactReportTotals(aggregateReportSnapshot(snapshot, () => '').get('') || reportBucket(), snapshot)
}

export async function getBusinessSummarySalesRows(env: Env, f: SalesFilters): Promise<Array<Record<string, unknown>>> {
  const snapshot = await readSalesReportSnapshot(env, f)
  return reportSaleFacts(snapshot).map((fact) => {
    const sale = fact.sale; const version = fact.version
    const revenue = fact.recognized ? fact.net.add(fact.adjustment).subtract(fact.refund) : ReportExactDecimal.zero()
    const rawCost = fact.recognized && fact.valued ? fact.cost.subtract(fact.returnedCost) : ReportExactDecimal.zero()
    const cost = rawCost.max(ReportExactDecimal.zero())
    const delivery = fact.recognized ? fact.delivery : ReportExactDecimal.zero()
    const deliveryActual = fact.recognized ? fact.deliveryActual : ReportExactDecimal.zero()
    const payable = Number(sale.source_return_id || 0) !== 0
      ? reportMoney(sale, 'amount_paid_usd', version) : reportMoney(sale, 'total_usd', version)
    const collected = reportStatus(sale) === 'awaiting_payment' || !fact.recognized
      ? ReportExactDecimal.zero() : payable.subtract(fact.refundPaid)
    const raw = String(sale.created_at || '')
    const parsed = new Date(/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`)
    const row: Record<string, unknown> = {
      id: Number(sale.id), cursor_at: raw, date: raw,
      business_date: new Date(parsed.getTime() + 7 * 3_600_000).toISOString().slice(0, 10),
      receipt_number: String(sale.receipt_number || ''), branch: String(sale.branch_name || ''), cashier: String(sale.cashier_name || ''),
      customer: Number(sale.customer_is_anonymous) !== 0 ? '' : String(sale.customer_name || ''),
      customer_phone: String(sale.customer_phone || ''), payment_method: String(sale.payment_method || ''), status: reportStatus(sale),
      gross_sales_usd: reportMoney(sale, 'subtotal_usd', version).toNumber(),
      store_discount_usd: reportMoney(sale, 'discount_usd', version).toNumber(),
      membership_discount_usd: reportMoney(sale, 'membership_discount_usd', version).toNumber(),
      tax_usd: reportMoney(sale, 'tax_usd', version).toNumber(), delivery_usd: fact.delivery.toNumber(),
      refund_usd: fact.refund.toNumber(), net_revenue_usd: revenue.toNumber(),
      pending_revenue_usd: fact.awaiting ? revenue.toNumber() : 0, collected_total_usd: collected.toNumber(),
      cost_usd: cost.toNumber(), cost_before_floor_usd: rawCost.toNumber(), cost_missing_snapshot_lines: fact.missingCostLines,
      gross_profit_usd: revenue.add(delivery).subtract(deliveryActual).subtract(cost).toNumber(),
    }
    return attachReportDiagnostic(row, {
      precision_mode: snapshot.precision_mode, complete: fact.missingCostLines === 0,
      unknown_cost_lines: fact.missingCostLines, contributing_rows: snapshot.row_count,
    })
  })
}

// Sale-header-level aggregate. Deliberately has NO join to sale_items --
// joining would fan out one row per line item and inflate every SUM here by
// however many items each sale has (the bug this file replaces).
async function salesLevelTotals(env: Env, f: SalesFilters) {
  const db = getDb(env)
  const { sql: whereSql, params } = whereActiveSales('sales', f)
  const row = await db.prepare(`
    SELECT COUNT(*) AS tx_count,
           COALESCE(SUM(subtotal_usd), 0) AS gross_sales_usd,
           COALESCE(SUM(discount_usd), 0) AS store_discount_usd,
           COALESCE(SUM(membership_discount_usd), 0) AS membership_discount_usd,
           COALESCE(SUM(tax_usd), 0) AS tax_usd,
           COALESCE(SUM(CASE WHEN COALESCE(delivery_fee_paid_by, 'customer') = 'store' THEN 0 ELSE delivery_fee_usd END), 0) AS delivery_usd,
           COALESCE(SUM(CASE WHEN delivery_fee_paid_by = 'store' THEN delivery_fee_usd ELSE 0 END), 0) AS store_delivery_usd,
           COALESCE(SUM(delivery_actual_cost_usd), 0) AS delivery_actual_cost_usd,
           COALESCE(SUM(CASE WHEN delivery_actual_cost_usd IS NOT NULL THEN 1 ELSE 0 END), 0) AS delivery_actual_cost_count,
           COALESCE(SUM(CASE WHEN COALESCE(is_delivery, 0) = 1 THEN 1 ELSE 0 END), 0) AS delivery_sale_count,
           -- Canonical net-sales revenue components (recognized = not cancelled;
           -- awaiting_payment credit is included and also isolated below):
           ${RECOGNIZED_LEVEL_COLUMNS}
    FROM sales
    ${CUSTOMER_REFUND_JOIN}sales.id
    WHERE ${whereSql}
  `).get<Record<string, number>>(params)
  return row || {}
}

// The item-level cost columns, written ONCE for the same reason
// RECOGNIZED_LEVEL_COLUMNS is: four queries measure COGS and they have to
// measure it identically. Each caller supplies its own bucket column and
// GROUP BY; these are the money columns. Aliased `si` (sale_items) joined to
// `s` (sales).
//
// The status split moved from the WHERE into the CASEs so the awaiting cohort
// can be summed in the SAME round trip. cost_usd is byte-identical to the old
// `WHERE ... AND recognized` form, and pending_cost_usd comes for free instead
// of costing a second query on every report. Pair it with
// ITEM_COST_STATUS_CLAUSE.
//
// NOTE (corrected Sep 6 2026): recognizedExpr admits awaiting_payment, so an
// awaiting line lands in BOTH cost_usd and pending_cost_usd -- the pending
// column isolates the unpaid part of the realised figure rather than naming a
// cohort held outside it (clause 4 of the scoping rule). This is what keeps
// revenue and COGS a matched pair: the same sales are on both sides.
export const ITEM_COST_COLUMNS = `
             COALESCE(SUM(CASE WHEN ${recognizedValuedExpr('s.')} THEN si.cost_price_usd * si.quantity ELSE 0 END), 0) AS cost_usd,
             COALESCE(SUM(CASE WHEN ${recognizedExpr('s.')} AND NOT ${valuedSaleExpr('s.')} THEN si.cost_price_usd * si.quantity ELSE 0 END), 0) AS unvalued_cost_usd,
             COALESCE(SUM(CASE WHEN ${recognizedValuedExpr('s.')} AND si.cost_price_usd IS NULL THEN 1 ELSE 0 END), 0) AS missing_snapshot_lines,
             COALESCE(SUM(CASE WHEN ${awaitingExpr('s.')} THEN si.cost_price_usd * si.quantity ELSE 0 END), 0) AS pending_cost_usd,
             COALESCE(SUM(CASE WHEN ${recognizedExpr('s.')} THEN COALESCE(si.product_discount_usd, 0) + COALESCE(si.manual_discount_usd, 0) ELSE 0 END), 0) AS item_discount_usd,
             COALESCE(SUM(CASE WHEN ${awaitingExpr('s.')} THEN COALESCE(si.product_discount_usd, 0) + COALESCE(si.manual_discount_usd, 0) ELSE 0 END), 0) AS pending_item_discount_usd`
export const ITEM_COST_STATUS_CLAUSE = `(${recognizedExpr('s.')} OR ${awaitingExpr('s.')})`

interface ItemCostRow { cost_usd: number; unvalued_cost_usd: number; missing_snapshot_lines: number; pending_cost_usd: number; item_discount_usd: number; pending_item_discount_usd: number }

// Item-level cost aggregate. Joins to sales only to apply the date/branch/
// status filter -- the summed field itself (cost_price_usd * quantity)
// is per-item, so there's no fan-out to worry about here. COGS is counted over
// RECOGNIZED sales, i.e. every sale that is not cancelled, so
// profit = recognized revenue - recognized cost stays a matched pair over one
// population. The awaiting cohort's own cost is reported beside it as
// pending_cost_usd -- the unpaid SLICE of cost_usd, not an addition to it.
async function salesCost(env: Env, f: SalesFilters): Promise<ItemCostRow> {
  const db = getDb(env)
  const { sql: whereSql, params } = whereActiveSales('s', f)
  const row = await db.prepare(`
    SELECT ${ITEM_COST_COLUMNS}
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    WHERE ${whereSql} AND ${ITEM_COST_STATUS_CLAUSE}
  `).get<ItemCostRow>(params)
  return {
    cost_usd: num(row?.cost_usd),
    unvalued_cost_usd: num(row?.unvalued_cost_usd),
    missing_snapshot_lines: num(row?.missing_snapshot_lines),
    pending_cost_usd: num(row?.pending_cost_usd),
    item_discount_usd: num(row?.item_discount_usd),
    pending_item_discount_usd: num(row?.pending_item_discount_usd),
  }
}

// Cost of the goods a return put BACK on the sellable shelf, over the same
// window and the same recognized sales as salesCost. Scoped to non-cancelled
// CUSTOMER returns, matching CUSTOMER_REFUND_JOIN exactly -- an internal
// (supplier) return never touched a customer sale's revenue and must not touch
// its cost either.
//
// Joined through the sale, not the return's own date: a return that lands in a
// later month reverses the cost in the month the sale was booked, which is what
// keeps revenue and cost a matched pair inside every bucket. The refund is
// attributed to the sale's bucket for the same reason.
//
// Gated on recognizedValuedExpr, exactly like the cost it reverses: a return
// against an unvalued receipt cannot take back a cost that was never counted.
// `bucketExpr` is any expression over the sale (aliased s) -- a local day, a
// customer key -- or null for the whole window in one row. It has to be the
// SAME expression the cost query buckets by, or a return lands in a different
// row from the sale whose cost it reverses.
function returnedCostSql(bucketExpr: string | null, whereSql: string): string {
  return `
    SELECT ${bucketExpr ? `${bucketExpr} AS bucket,` : `'' AS bucket,`}
           COALESCE(SUM(CASE WHEN ${RESTOCKED_RETURN_LINE} THEN ri.cost_price_usd * ri.quantity ELSE 0 END), 0) AS returned_cost_usd
    FROM return_items ri
    JOIN returns r ON r.id = ri.return_id
    JOIN sales s ON s.id = r.sale_id
    WHERE ${whereSql}
      AND ${recognizedValuedExpr('s.')}
      AND COALESCE(r.status, 'completed') <> 'cancelled'
      AND COALESCE(r.return_scope, 'customer') = 'customer'
    ${bucketExpr ? 'GROUP BY bucket' : ''}
  `
}

async function salesReturnedCost(env: Env, f: SalesFilters): Promise<number> {
  const db = getDb(env)
  const { sql: whereSql, params } = whereActiveSales('s', f)
  const row = await db.prepare(returnedCostSql(null, whereSql)).get<{ returned_cost_usd: number }>(params)
  return num(row?.returned_cost_usd)
}

// Same aggregate, bucketed. Returns a Map keyed the way the caller's cost query
// is keyed, so a missing bucket is simply zero reversal.
async function returnedCostByBucket(env: Env, f: SalesFilters, bucketExpr: string): Promise<Map<string, number>> {
  const db = getDb(env)
  const { sql: whereSql, params } = whereActiveSales('s', f)
  const rows = await db.prepare(returnedCostSql(bucketExpr, whereSql))
    .all<{ bucket: string | number | null; returned_cost_usd: number }>(params)
  return new Map((rows || []).map((r) => [r.bucket == null ? '' : String(r.bucket), num(r.returned_cost_usd)]))
}

/**
 * Receipts VOIDED in the window, bucketed the same way everything else is.
 *
 * It needs its own query for one structural reason: whereActiveSales pushes
 * `sale_status <> 'cancelled'` into every other aggregate here (clause 2 of the
 * scoping rule -- a cancelled sale contributes 0 on both sides), so a cancelled
 * row is not reachable from the level query at all. Forcing `status:
 * 'cancelled'` reuses the SAME window, branch, time-of-day, shift and
 * maxSaleId construction rather than re-spelling it, and the count is the
 * window's own regardless of any status filter the caller applied -- "how many
 * were voided here" is asked beside the official count, not inside it.
 */
// The SQL alias is voided_tx_count, not cancelled_tx_count: the shift
// report next door has its own per-shift count query with a column literally
// aliased `cancelled`, and its test picks that statement out of the issued
// set by column name. Two different questions should not answer to one name.
// The RESPONSE field stays cancelled_tx_count -- that is the contract.
async function cancelledCountByBucket(env: Env, f: SalesFilters, bucketExpr: string | null): Promise<Map<string, number>> {
  const db = getDb(env)
  const { sql: whereSql, params } = whereActiveSales('sales', { ...f, status: 'cancelled' })
  const rows = await db.prepare(`
    SELECT ${bucketExpr ? `${bucketExpr} AS bucket,` : `'' AS bucket,`} COUNT(*) AS voided_tx_count
    FROM sales
    WHERE ${whereSql}
    ${bucketExpr ? 'GROUP BY bucket' : ''}
  `).all<{ bucket: string | number | null; voided_tx_count: number }>(params)
  return new Map((rows || []).map((r) => [r.bucket == null ? '' : String(r.bucket), num(r.voided_tx_count)]))
}

/** Same query, grouped, carrying the display label and entity id so a group
 *  with nothing BUT voids can still be rendered as a row. */
async function cancelledGroupCounts(env: Env, f: SalesFilters, exprs: { key: string; label: string; id: string }): Promise<Map<string, { count: number; label: string; entity_id: number | null }>> {
  const db = getDb(env)
  const { sql: whereSql, params } = whereActiveSales('sales', { ...f, status: 'cancelled' })
  const rows = await db.prepare(`
    SELECT ${exprs.key} AS grp_key, ${exprs.label} AS grp_label, ${exprs.id} AS grp_id,
           COUNT(*) AS voided_tx_count
    FROM sales
    WHERE ${whereSql}
    GROUP BY grp_key
  `).all<{ grp_key: string | number | null; grp_label: string | null; grp_id: number | null; voided_tx_count: number }>(params)
  return new Map((rows || []).map((r) => [
    r.grp_key == null ? '' : String(r.grp_key),
    { count: num(r.voided_tx_count), label: r.grp_label == null ? '' : String(r.grp_label), entity_id: r.grp_id == null ? null : Number(r.grp_id) },
  ]))
}

/**
 * Discount given away on the LINES, as opposed to on the invoice (S4-7).
 *
 * SalesTotals already carries the two invoice-level discounts --
 * store_discount_usd (the cashier's whole-sale discount) and
 * membership_discount_usd -- because both are columns on the sales row. The
 * item-level one has no header column at all: `sales.subtotal_usd` is the sum
 * of the LINE totals, which are already net of each line's own discount, so
 * the money never appears anywhere on the header. Recovering it means summing
 * the two per-line columns, and that is what this does.
 *
 * Same recognized-only basis as cost, and joined the same way, so
 * `revenue + item discount + invoice discount` reconciles against the
 * pre-discount value of what left the shelf.
 */
export async function getItemDiscountUsd(env: Env, f: SalesFilters): Promise<number> {
  const db = getDb(env)
  const { sql: whereSql, params } = whereActiveSales('s', f)
  const row = await db.prepare(`
    SELECT COALESCE(SUM(COALESCE(si.product_discount_usd, 0) + COALESCE(si.manual_discount_usd, 0)), 0) AS item_discount_usd
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    WHERE ${whereSql} AND ${recognizedExpr('s.')}
  `).get<{ item_discount_usd: number }>(params)
  return round2(num(row?.item_discount_usd))
}

/**
 * The awaiting-payment cohort's own item-level cost, kept OUT of `costUsd`.
 * A separate parameter rather than a fifth positional number so the call
 * sites read as what they are (S4R3-6).
 */
export interface DeriveTotalsOptions {
  /** The AWAITING cohort's COGS, despite the name -- pending_cost_usd. */
  costUsd?: number
  /** REQUIRED, not optional (Sep 6 2026, owner ask N6.6). Every entry point
   *  already computed it in the same ITEM_COST_COLUMNS round trip; leaving it
   *  optional meant a new caller could omit it and silently report
   *  item_discount_usd = 0 and a total_discount_usd short by the whole
   *  line-discount column, with nothing to catch it. The type catches it. */
  itemDiscountUsd: number
  pendingItemDiscountUsd?: number
  /** Receipts VOIDED in this bucket -- never reachable from `level`, whose
   *  own WHERE hides cancelled sales. Supplied by cancelledCountByBucket. */
  cancelledTxCount?: number
  /** COGS on recognized-but-unvalued receipts, held out of cost_usd. */
  unvaluedCostUsd?: number
}

export function deriveTotals(level: Record<string, number>, costUsd: number, returnedCostUsd: number, options: DeriveTotalsOptions): SalesTotals {
  const txCount = num(level.tx_count)
  const grossSalesUsd = num(level.gross_sales_usd)
  const storeDiscountUsd = num(level.store_discount_usd)
  const membershipDiscountUsd = num(level.membership_discount_usd)
  const discountUsd = storeDiscountUsd + membershipDiscountUsd
  const taxUsd = num(level.tax_usd)
  const deliveryUsd = num(level.delivery_usd)
  const storeDeliveryUsd = num(level.store_delivery_usd)
  const deliveryActualCostUsd = num(level.delivery_actual_cost_usd)
  // Canonical revenue = NET SALES over recognized sales, minus customer refunds
  // (user directive Sep 1 2026). CORRECTED Sep 6 2026: the `recognized_*` fields
  // exclude ONLY cancelled -- awaiting_payment (unpaid credit) is INSIDE them,
  // per recognizedExpr and lineage commit fd7c49ba, and is additionally reported
  // through the pending_* subset. When a caller does not supply them we fall back
  // to the old gross-minus-discount basis so no other consumer of deriveTotals
  // silently zeroes out. gross_sales_usd / tax_usd / delivery_usd stay the full
  // display line items and are intentionally NOT changed.
  const hasRecognized = level.recognized_net_usd !== undefined && level.recognized_net_usd !== null
  const recognizedNetUsd = hasRecognized ? num(level.recognized_net_usd) : grossSalesUsd - discountUsd
  const refundUsd = num(level.refund_usd)
  const pendingRevenueUsd = num(level.pending_revenue_usd)
  const recognizedTaxUsd = hasRecognized ? num(level.recognized_tax_usd) : taxUsd
  const recognizedDeliveryUsd = hasRecognized ? num(level.recognized_delivery_usd) : deliveryUsd
  const recognizedStoreDeliveryUsd = hasRecognized ? num(level.recognized_store_delivery_usd) : storeDeliveryUsd
  const recognizedDeliveryCostUsd = hasRecognized ? num(level.recognized_delivery_cost_usd) : deliveryActualCostUsd
  const revenueUsd = recognizedNetUsd - refundUsd
  // "Total collected" (secondary): recognized revenue + tax + customer delivery
  // fee. This one uses the refund the till actually PAID OUT, not the
  // net-basis share, because it answers "what changed hands" rather than
  // "what did we earn". refund_paid_out_usd is carried for exactly that.
  const collectedNetUsd = hasRecognized ? num(level.collected_net_usd) : recognizedNetUsd
  const collectedTaxUsd = hasRecognized ? num(level.collected_tax_usd) : recognizedTaxUsd
  const collectedDeliveryUsd = hasRecognized ? num(level.collected_delivery_usd) : recognizedDeliveryUsd
  const collectedTotalUsd = collectedNetUsd + collectedTaxUsd + collectedDeliveryUsd - num(level.refund_paid_out_usd)
  // Goods back on the shelf are not cost of goods SOLD, floored at zero so a
  // reversal can never manufacture profit.
  //
  // CORRECTED Sep 6 2026. The floor's stated reason was "a return against a
  // sale outside the range" -- which cannot happen: returnedCostSql joins
  // `JOIN sales s ON s.id = r.sale_id` under the same whereActiveSales window,
  // so a return only ever reverses cost in its own sale's bucket. The reachable
  // cause is the opposite one: a SOLD line with a NULL cost_price_usd snapshot
  // contributes $0 to costUsd while the return_items row for the same goods
  // carries a real cost. The floor then silently absorbed the difference and
  // over-stated profit. It still floors -- a negative COGS is not a thing --
  // but the shortfall is now reported instead of vanishing, next to the
  // missing_snapshot_lines count that explains it.
  const netCostUsd = Math.max(0, costUsd - returnedCostUsd)
  const returnedCostShortfallUsd = Math.max(0, returnedCostUsd - costUsd)
  // Delivery contributes what it is worth, once: collected minus paid out. The
  // absorbed fee is NOT subtracted here -- see correction (a) in the header.
  const deliveryNetUsd = recognizedDeliveryUsd - recognizedDeliveryCostUsd
  const profitUsd = revenueUsd - netCostUsd + deliveryNetUsd
  // ---- the awaiting-payment subset, S4R3-6 --------------------------------
  // Same shape as the recognized figures above and computed with the same
  // formula. It is already inside revenueUsd, netCostUsd and profitUsd and is
  // returned only to show how much of those results is unpaid. It remains out
  // of collectedTotalUsd, and callers must not add or subtract it again.
  const pendingCostUsd = num(options.costUsd)
  const pendingDeliveryUsd = num(level.pending_delivery_usd)
  const pendingDeliveryCostUsd = num(level.pending_delivery_cost_usd)
  const pendingProfitUsd = pendingRevenueUsd - pendingCostUsd + (pendingDeliveryUsd - pendingDeliveryCostUsd)
  return {
    tx_count: txCount,
    gross_sales_usd: round2(grossSalesUsd),
    store_discount_usd: round2(storeDiscountUsd),
    membership_discount_usd: round2(membershipDiscountUsd),
    discount_usd: round2(discountUsd),
    item_discount_usd: round2(num(options.itemDiscountUsd)),
    total_discount_usd: round2(discountUsd + num(options.itemDiscountUsd)),
    tax_usd: round2(taxUsd),
    delivery_usd: round2(deliveryUsd),
    store_delivery_usd: round2(storeDeliveryUsd),
    delivery_actual_cost_usd: round2(deliveryActualCostUsd),
    delivery_actual_cost_count: num(level.delivery_actual_cost_count),
    delivery_sale_count: num(level.delivery_sale_count),
    // Margin over the CHARGED fees: what customers paid for delivery minus
    // what the couriers were actually paid.
    delivery_margin_usd: round2(deliveryUsd - deliveryActualCostUsd),
    delivery_net_usd: round2(deliveryNetUsd),
    recognized_delivery_usd: round2(recognizedDeliveryUsd),
    recognized_delivery_cost_usd: round2(recognizedDeliveryCostUsd),
    pending_tx_count: num(level.pending_tx_count),
    pending_gross_sales_usd: round2(num(level.pending_gross_sales_usd)),
    pending_store_discount_usd: round2(num(level.pending_store_discount_usd)),
    pending_membership_discount_usd: round2(num(level.pending_membership_discount_usd)),
    pending_delivery_usd: round2(pendingDeliveryUsd),
    pending_delivery_cost_usd: round2(pendingDeliveryCostUsd),
    pending_cost_usd: round2(pendingCostUsd),
    pending_profit_usd: round2(pendingProfitUsd),
    pending_item_discount_usd: round2(num(options.pendingItemDiscountUsd)),
    cancelled_tx_count: num(options.cancelledTxCount),
    returned_cost_usd: round2(Math.min(costUsd, returnedCostUsd)),
    returned_cost_shortfall_usd: round2(returnedCostShortfallUsd),
    unvalued_tx_count: num(level.unvalued_tx_count),
    unvalued_cost_usd: round2(num(options.unvaluedCostUsd)),
    net_sales_usd: round2(recognizedNetUsd),
    refund_usd: round2(refundUsd),
    refund_charged_usd: round2(num(level.refund_charged_usd)),
    refund_excess_usd: round2(num(level.refund_excess_usd)),
    revenue_usd: round2(revenueUsd),
    pending_revenue_usd: round2(pendingRevenueUsd),
    collected_total_usd: round2(collectedTotalUsd),
    cost_usd: round2(netCostUsd),
    profit_usd: round2(profitUsd),
    avg_order_usd: txCount > 0 ? round2(revenueUsd / txCount) : 0,
  }
}

// A bucket whose ONLY activity was a VOID has no level row at all --
// whereActiveSales hides cancelled sales -- so it used to disappear from the
// series entirely and a chart drew one straight line across a day that did
// have activity. Union the cancelled buckets back in as zero-money rows.
function unionBuckets(levelKeys: Iterable<string>, cancelled: Map<string, number>): string[] {
  const seen = new Set<string>(levelKeys)
  for (const k of cancelled.keys()) if (k !== '') seen.add(k)
  return [...seen]
}

/** hasRecognized must stay true for a synthesised bucket, or deriveTotals
 *  falls back to the gross-minus-discount basis and reports a phantom. */
const VOID_ONLY_LEVEL: Record<string, number> = { tx_count: 0, recognized_net_usd: 0 }

export async function getSalesTotals(env: Env, f: SalesFilters): Promise<SalesTotals> {
  const snapshot = await readSalesReportSnapshot(env, f)
  return exactReportTotals(aggregateReportSnapshot(snapshot, () => '').get('') || reportBucket(), snapshot)
}

// Period-bucketed trend series (for the Dashboard revenue/cost/profit line
// chart and count bar chart). Sale-level sums and item-level cost are
// queried and grouped separately, then merged by period key in JS -- same
// fan-out-avoidance reasoning as getSalesTotals above, just bucketed.
export async function getSalesPeriodSeries(env: Env, f: SalesFilters, granularity: 'day' | 'week' | 'month'): Promise<SalesPeriodRow[]> {
  {
    const snapshot = await readSalesReportSnapshot(env, f)
    const bucketFor = (sale: ReportScalarRow): string => {
      const raw = String(sale.created_at || '')
      const parsed = new Date(/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`)
      const local = new Date(parsed.getTime() + 7 * 60 * 60 * 1000)
      const day = local.toISOString().slice(0, 10)
      if (granularity === 'month') return day.slice(0, 7)
      if (granularity === 'week') {
        const dow = local.getUTCDay(); const back = dow === 0 ? 6 : dow - 1
        return new Date(local.getTime() - back * 86_400_000).toISOString().slice(0, 10)
      }
      return day
    }
    return [...aggregateReportSnapshot(snapshot, bucketFor).entries()].map(([period, bucket]) => {
      const totals = exactReportTotals(bucket, snapshot)
      return { period, date: period, count: totals.tx_count, tx_count: totals.tx_count,
        revenue_usd: totals.revenue_usd, gross_sales_usd: totals.gross_sales_usd, refund_usd: totals.refund_usd,
        discount_usd: totals.discount_usd, item_discount_usd: totals.item_discount_usd,
        total_discount_usd: totals.total_discount_usd, tax_usd: totals.tax_usd, delivery_usd: totals.delivery_usd,
        cost_usd: totals.cost_usd, profit_usd: totals.profit_usd, cancelled_tx_count: totals.cancelled_tx_count }
    }).sort((a, b) => a.period.localeCompare(b.period))
  }
  const db = getDb(env)
  // Buckets are the LOCAL (UTC+7) day/week/month, matching the date window.
  const periodExprS = granularity === 'month' ? localMonthExpr('sales.created_at')
    : granularity === 'week' ? localWeekExpr('sales.created_at')
      : localDateExpr('sales.created_at')
  const periodExprJoined = granularity === 'month' ? localMonthExpr('s.created_at')
    : granularity === 'week' ? localWeekExpr('s.created_at')
      : localDateExpr('s.created_at')

  const { sql: whereLevel, params: paramsLevel } = whereActiveSales('sales', f)
  const { sql: whereCost, params: paramsCost } = whereActiveSales('s', f)

  const [levelRows, costRows, returnedByPeriod, cancelledByPeriod] = await Promise.all([
    db.prepare(`
      SELECT ${periodExprS} AS period, COUNT(*) AS tx_count,
             COALESCE(SUM(subtotal_usd), 0) AS gross_sales_usd,
             COALESCE(SUM(discount_usd), 0) AS store_discount_usd,
             COALESCE(SUM(membership_discount_usd), 0) AS membership_discount_usd,
             COALESCE(SUM(tax_usd), 0) AS tax_usd,
             COALESCE(SUM(CASE WHEN COALESCE(delivery_fee_paid_by, 'customer') = 'store' THEN 0 ELSE delivery_fee_usd END), 0) AS delivery_usd,
             COALESCE(SUM(CASE WHEN delivery_fee_paid_by = 'store' THEN delivery_fee_usd ELSE 0 END), 0) AS store_delivery_usd,
             -- Same canonical net-sales revenue basis as the headline, so the
             -- per-period trend sums back to getSalesTotals' revenue_usd. Not a
             -- copy of it: the same constant.
             ${RECOGNIZED_LEVEL_COLUMNS}
      FROM sales
      ${CUSTOMER_REFUND_JOIN}sales.id
      WHERE ${whereLevel}
      GROUP BY ${periodExprS}
    `).all<Record<string, number> & { period: string }>(paramsLevel),
    db.prepare(`
      SELECT ${periodExprJoined} AS period,
             ${ITEM_COST_COLUMNS}
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE ${whereCost} AND ${ITEM_COST_STATUS_CLAUSE}
      GROUP BY ${periodExprJoined}
    `).all<ItemCostRow & { period: string }>(paramsCost),
    returnedCostByBucket(env, f, periodExprJoined),
    cancelledCountByBucket(env, f, periodExprS),
  ])

  const costByPeriod = new Map((costRows || []).map((r) => [r.period, num(r.cost_usd)]))
  const pendingCostByPeriod = new Map((costRows || []).map((r) => [r.period, num(r.pending_cost_usd)]))
  const itemDiscountByPeriod = new Map((costRows || []).map((r) => [r.period, num(r.item_discount_usd)]))
  const pendingItemDiscountByPeriod = new Map((costRows || []).map((r) => [r.period, num(r.pending_item_discount_usd)]))
  const unvaluedCostByPeriod = new Map((costRows || []).map((r) => [r.period, num(r.unvalued_cost_usd)]))
  const levelByPeriod = new Map((levelRows || []).map((r) => [r.period, r as Record<string, number>]))
  const rows = unionBuckets(levelByPeriod.keys(), cancelledByPeriod).map((period) => {
    const totals = deriveTotals(levelByPeriod.get(period) || VOID_ONLY_LEVEL, costByPeriod.get(period) || 0, returnedByPeriod.get(period) || 0, { costUsd: pendingCostByPeriod.get(period) || 0, itemDiscountUsd: itemDiscountByPeriod.get(period) || 0, pendingItemDiscountUsd: pendingItemDiscountByPeriod.get(period) || 0, cancelledTxCount: cancelledByPeriod.get(period) || 0, unvaluedCostUsd: unvaluedCostByPeriod.get(period) || 0 })
    return {
      period,
      date: period,
      count: totals.tx_count,
      tx_count: totals.tx_count,
      revenue_usd: totals.revenue_usd,
      // The two series the Revenue Flow chart plots beside revenue. Straight
      // off the same deriveTotals call, so the chart cannot describe a
      // different period than the card above it.
      gross_sales_usd: totals.gross_sales_usd,
      refund_usd: totals.refund_usd,
      discount_usd: totals.discount_usd,
      item_discount_usd: totals.item_discount_usd,
      total_discount_usd: totals.total_discount_usd,
      tax_usd: totals.tax_usd,
      delivery_usd: totals.delivery_usd,
      cost_usd: totals.cost_usd,
      profit_usd: totals.profit_usd,
      cancelled_tx_count: totals.cancelled_tx_count,
    }
  })
  return rows.sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0))
}

// ---- Phase X (Part 395): daily report + per-contact delivery totals -------
// Same single-source rule as everything above: these are KERNEL functions so
// the Sales daily report, the delivery-contact drill and any export all
// agree. USD-centric like the rest of the file (KHR derives at display).

export interface PaymentMethodBreakdownRow {
  payment_method: string
  tx_count: number
  // What actually changed hands for these sales: total_usd plus the
  // customer-PAID delivery fee (a store-absorbed fee was never collected).
  collected_usd: number
  total_usd: number
}

export interface DeliveryContactTotalsRow {
  delivery_contact_id: number | null
  delivery_contact_name: string
  deliveries: number
  charged_fee_usd: number
  absorbed_fee_usd: number
  // NULL actual costs don't count (same honesty rule as SalesTotals):
  // actual_cost_count says how many deliveries carried a recorded cost.
  actual_cost_usd: number
  actual_cost_count: number
  linked_expense_count: number
  linked_expense_usd: number
  linked_expense_khr: number
  margin_usd: number
  last_delivery_at: string | null
  last_expense_at: string | null
  // ---- additive (peer reports-redesign lane, Sep 6 2026) ----------------
  // charged_fee_usd split by whether the sale it rode on has been settled.
  // The two always sum back to charged_fee_usd: the window is recognized
  // sales, and every recognized sale is either collected or awaiting
  // payment. Nothing here re-derives a fee -- it is the same
  // customerDeliveryFeeExpr, cut by sale status.
  paid_fee_usd: number
  receivable_fee_usd: number
  // How the settled fees were taken, so a courier line reconciles against a
  // till. Only methods with a fee appear.
  paid_by_method: { payment_method: string; count: number; fee_usd: number }[]
}

// One receipt inside a day's drill. revenue_usd is computed the SAME way the
// kernel defines revenue -- net sale (subtotal minus both discounts) minus this
// sale's own customer refunds, and 0 only for a cancelled sale. Awaiting-payment
// credit remains recognized, so these rows sum to the day's revenue_usd. The
// single-source rule applied per row: the per-sale breakdown can never disagree
// with the day total above it.
export interface SalesDayRow {
  id: number
  receipt_number: string
  created_at: string
  customer_name: string
  payment_method: string
  sale_status: string
  revenue_usd: number
  discount_usd: number
  collected_usd: number
}

export interface SalesDayReport {
  date: string
  totals: SalesTotals
  payment_methods: PaymentMethodBreakdownRow[]
  delivery_contacts: DeliveryContactTotalsRow[]
  discounts: {
    store_usd: number
    membership_usd: number
    store_tx_count: number
    membership_tx_count: number
  }
  // The individual receipts making up the day (newest first, capped).
  sales: SalesDayRow[]
}

export function paymentMethodBreakdownFromSnapshot(snapshot: SalesReportSnapshot): PaymentMethodBreakdownRow[] {
  const methods = new Map<string, { tx_count: number; collected: ReportExactDecimal; total: ReportExactDecimal }>()
  for (const fact of reportSaleFacts(snapshot)) {
    const sale = fact.sale
    const method = String(sale.payment_method || '').trim() || 'Unknown'
    const found = methods.get(method) || { tx_count: 0, collected: ReportExactDecimal.zero(), total: ReportExactDecimal.zero() }
    const payable = Number(sale.source_return_id || 0) !== 0
      ? reportMoney(sale, 'amount_paid_usd', fact.version)
      : reportMoney(sale, 'total_usd', fact.version)
    found.tx_count += 1
    found.total = found.total.add(reportMoney(sale, 'total_usd', fact.version))
    if (fact.recognized && !fact.awaiting) found.collected = found.collected.add(payable.subtract(fact.refundPaid))
    methods.set(method, found)
  }
  return [...methods.entries()].map(([payment_method, value]) => ({
    payment_method, tx_count: value.tx_count, collected_usd: value.collected.toNumber(), total_usd: value.total.toNumber(),
  })).sort((a, b) => b.collected_usd - a.collected_usd)
}

export async function getPaymentMethodBreakdown(env: Env, f: SalesFilters): Promise<PaymentMethodBreakdownRow[]> {
  const snapshot = await readSalesReportSnapshot(env, f)
  if (snapshot) return paymentMethodBreakdownFromSnapshot(snapshot)
  const db = getDb(env)
  const { sql: whereSql, params } = whereActiveSales('sales', f)
  const rows = await db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(payment_method), ''), 'Unknown') AS payment_method,
           COUNT(*) AS tx_count,
           COALESCE(SUM(total_usd), 0) AS total_usd,
           COALESCE(SUM(${collectedExpr('')}), 0) AS collected_usd
    FROM sales
    WHERE ${whereSql}
    GROUP BY COALESCE(NULLIF(TRIM(payment_method), ''), 'Unknown')
    ORDER BY collected_usd DESC
  `).all<Record<string, unknown>>(params)
  return (rows || []).map((r) => ({
    payment_method: String(r.payment_method || 'Unknown'),
    tx_count: num(r.tx_count),
    collected_usd: round2(num(r.collected_usd)),
    total_usd: round2(num(r.total_usd)),
  }))
}

// Per-courier totals over a range -- X3's "check expenses of delivery by
// contact". Grouped by the LINK (delivery_contact_id) with the name snapshot
// merged per id in JS, so a renamed contact still shows as one line under
// its latest name; unlinked deliveries group by their name snapshot alone
// (imported history links by id where the contact exists -- T3).
function deliveryContactTotalsFromSnapshot(
  snapshot: SalesReportSnapshot,
  f: SalesFilters & { contactId?: number | string | null },
): DeliveryContactTotalsRow[] {
  type ExactDelivery = Omit<DeliveryContactTotalsRow,
    'charged_fee_usd' | 'absorbed_fee_usd' | 'paid_fee_usd' | 'receivable_fee_usd' | 'actual_cost_usd'
    | 'linked_expense_usd' | 'linked_expense_khr' | 'margin_usd' | 'paid_by_method'> & {
      charged: ReportExactDecimal; absorbed: ReportExactDecimal; paid: ReportExactDecimal; receivable: ReportExactDecimal
      actual: ReportExactDecimal; expenseUsd: ReportExactDecimal; expenseKhr: ReportExactDecimal
      methods: Map<string, { count: number; fee: ReportExactDecimal }>; _lastAt: string
    }
  const groups = new Map<string, ExactDelivery>()
  const groupFor = (id: number | null, name: string) => {
    const key = id == null ? `name:${name.toLowerCase()}` : `id:${id}`
    let group = groups.get(key)
    if (!group) {
      group = { delivery_contact_id: id, delivery_contact_name: name, deliveries: 0, actual_cost_count: 0,
        linked_expense_count: 0, last_delivery_at: null, last_expense_at: null,
        charged: ReportExactDecimal.zero(), absorbed: ReportExactDecimal.zero(), paid: ReportExactDecimal.zero(),
        receivable: ReportExactDecimal.zero(), actual: ReportExactDecimal.zero(), expenseUsd: ReportExactDecimal.zero(),
        expenseKhr: ReportExactDecimal.zero(), methods: new Map(), _lastAt: '' }
      groups.set(key, group)
    }
    return group
  }
  const requestedContact = f.contactId == null || f.contactId === '' ? null : Number(f.contactId)
  for (const sale of snapshot.sales) {
    if (Number(sale.is_delivery) !== 1) continue
    const id = sale.delivery_contact_id == null ? null : Number(sale.delivery_contact_id)
    if (requestedContact != null && id !== requestedContact) continue
    const name = String(sale.delivery_contact_name || '').trim()
    const group = groupFor(id, name)
    const version = reportVersion(sale)
    const fee = reportMoney(sale, 'delivery_fee_usd', version)
    const customerFee = String(sale.delivery_fee_paid_by || 'customer') === 'store' ? ReportExactDecimal.zero() : fee
    group.deliveries += 1
    group.charged = group.charged.add(customerFee)
    if (String(sale.delivery_fee_paid_by || 'customer') === 'store') group.absorbed = group.absorbed.add(fee)
    if (reportStatus(sale) === 'awaiting_payment') group.receivable = group.receivable.add(customerFee)
    else if (reportStatus(sale) !== 'cancelled') {
      group.paid = group.paid.add(customerFee)
      const method = String(sale.payment_method || '').trim() || 'Unknown'
      const found = group.methods.get(method) || { count: 0, fee: ReportExactDecimal.zero() }
      found.count += 1; found.fee = found.fee.add(customerFee); group.methods.set(method, found)
    }
    if (sale.delivery_actual_cost_usd != null) {
      group.actual = group.actual.add(reportMoney(sale, 'delivery_actual_cost_usd', version, false))
      group.actual_cost_count += 1
    }
    const createdAt = String(sale.created_at || '')
    if (createdAt > group._lastAt) { group._lastAt = createdAt; group.last_delivery_at = createdAt || null; if (name) group.delivery_contact_name = name }
  }
  for (const fee of snapshot.deliveryFees) {
    const id = Number(fee.delivery_contact_id)
    const name = String(fee.delivery_contact_name || '').trim()
    const group = groupFor(id, name)
    group.linked_expense_count += 1
    group.expenseUsd = group.expenseUsd.add(ReportExactDecimal.recorded(fee.amount_usd as string | number))
    group.expenseKhr = group.expenseKhr.add(ReportExactDecimal.recorded(fee.amount_khr as string | number))
    const createdAt = String(fee.created_at || '')
    if (!group.last_expense_at || createdAt > group.last_expense_at) group.last_expense_at = createdAt || null
    if (!group.delivery_contact_name && name) group.delivery_contact_name = name
  }
  return [...groups.values()].map((group) => ({
    delivery_contact_id: group.delivery_contact_id, delivery_contact_name: group.delivery_contact_name,
    deliveries: group.deliveries, charged_fee_usd: group.charged.toNumber(), absorbed_fee_usd: group.absorbed.toNumber(),
    paid_fee_usd: group.paid.toNumber(), receivable_fee_usd: group.receivable.toNumber(), actual_cost_usd: group.actual.toNumber(),
    actual_cost_count: group.actual_cost_count, linked_expense_count: group.linked_expense_count,
    linked_expense_usd: group.expenseUsd.toNumber(), linked_expense_khr: group.expenseKhr.toNumber(),
    margin_usd: group.charged.subtract(group.actual).toNumber(), last_delivery_at: group.last_delivery_at,
    last_expense_at: group.last_expense_at, paid_by_method: [...group.methods.entries()].map(([payment_method, value]) => ({
      payment_method, count: value.count, fee_usd: value.fee.toNumber(),
    })).sort((a, b) => b.fee_usd - a.fee_usd || a.payment_method.localeCompare(b.payment_method)),
  })).sort((a, b) => (b.deliveries + b.linked_expense_count) - (a.deliveries + a.linked_expense_count))
}

export async function getDeliveryContactTotals(
  env: Env,
  f: SalesFilters & { contactId?: number | string | null },
): Promise<DeliveryContactTotalsRow[]> {
  const snapshot = await readSalesReportSnapshot(env, f, true)
  if (snapshot) return deliveryContactTotalsFromSnapshot(snapshot, f)
  const db = getDb(env)
  const { sql: whereSql, params } = whereActiveSales('sales', f)
  const clauses = [whereSql, 'COALESCE(sales.is_delivery, 0) = 1']
  if (f.contactId != null && f.contactId !== '') {
    clauses.push('sales.delivery_contact_id = @contactId')
    params.contactId = f.contactId
  }
  const rows = await db.prepare(`
    SELECT delivery_contact_id,
           COALESCE(NULLIF(TRIM(delivery_contact_name), ''), '') AS delivery_contact_name,
           COUNT(*) AS deliveries,
           COALESCE(SUM(CASE WHEN COALESCE(delivery_fee_paid_by, 'customer') = 'store' THEN 0 ELSE COALESCE(delivery_fee_usd, 0) END), 0) AS charged_fee_usd,
           COALESCE(SUM(CASE WHEN delivery_fee_paid_by = 'store' THEN COALESCE(delivery_fee_usd, 0) ELSE 0 END), 0) AS absorbed_fee_usd,
           COALESCE(SUM(CASE WHEN ${collectedSaleExpr('')} THEN ${customerDeliveryFeeExpr('')} ELSE 0 END), 0) AS paid_fee_usd,
           COALESCE(SUM(CASE WHEN ${awaitingExpr('')} THEN ${customerDeliveryFeeExpr('')} ELSE 0 END), 0) AS receivable_fee_usd,
           COALESCE(SUM(delivery_actual_cost_usd), 0) AS actual_cost_usd,
           COALESCE(SUM(CASE WHEN delivery_actual_cost_usd IS NOT NULL THEN 1 ELSE 0 END), 0) AS actual_cost_count,
           MAX(created_at) AS last_delivery_at
    FROM sales
    WHERE ${clauses.join(' AND ')}
    GROUP BY delivery_contact_id, LOWER(TRIM(COALESCE(delivery_contact_name, '')))
  `).all<Record<string, unknown>>(params)

  // Settled delivery fees by the method the sale was paid with. Grouped on
  // the same contact identity as the totals above so the rows merge by the
  // same key, and on the same normalized method label getPaymentMethodBreakdown
  // uses, so a courier fold and the payments fold name a method identically.
  const methodRows = await db.prepare(`
    SELECT delivery_contact_id,
           COALESCE(NULLIF(TRIM(delivery_contact_name), ''), '') AS delivery_contact_name,
           COALESCE(NULLIF(TRIM(payment_method), ''), 'Unknown') AS payment_method,
           COUNT(*) AS count,
           COALESCE(SUM(${customerDeliveryFeeExpr('')}), 0) AS fee_usd
    FROM sales
    WHERE ${clauses.join(' AND ')} AND ${collectedSaleExpr('')}
    GROUP BY delivery_contact_id, LOWER(TRIM(COALESCE(delivery_contact_name, ''))), COALESCE(NULLIF(TRIM(payment_method), ''), 'Unknown')
  `).all<Record<string, unknown>>(params)

  // Standalone courier payments are expense rows, not sale rows. Keep the
  // accounting amounts separate from charged/absorbed sale fees so reports
  // never double-count or silently reinterpret an Expense-classified label.
  // Exact report moments use system-entry created_at. Date-only callers retain
  // the historical fee_date basis; the legacy recurring time mask remains for
  // direct callers that have not migrated to createdFrom/createdTo.
  const feeClauses: string[] = ['fees.delivery_contact_id IS NOT NULL']
  const feeParams: Record<string, unknown> = {}
  const feeCreatedFrom = shiftWindowBound(f.createdFrom)
  const feeCreatedTo = shiftWindowBound(f.createdTo)
  if (feeCreatedFrom && feeCreatedTo) {
    feeClauses.push('datetime(fees.created_at) >= @feeCreatedFrom', 'datetime(fees.created_at) < @feeCreatedTo')
    feeParams.feeCreatedFrom = feeCreatedFrom
    feeParams.feeCreatedTo = feeCreatedTo
  } else {
    if (f.startDate) { feeClauses.push('fees.fee_date >= @feeStartDate'); feeParams.feeStartDate = f.startDate }
    if (f.endDate) { feeClauses.push('fees.fee_date <= @feeEndDate'); feeParams.feeEndDate = f.endDate }
  }
  if (f.branchId) { feeClauses.push('fees.branch_id = @feeBranchId'); feeParams.feeBranchId = f.branchId }
  const validTime = (value: unknown): value is string => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
  if (!feeCreatedFrom && !feeCreatedTo && validTime(f.startTime) && validTime(f.endTime)) {
    feeClauses.push(localTimeRangeClause('fees.created_at').replaceAll('@startTime', '@feeStartTime').replaceAll('@endTime', '@feeEndTime'))
    feeParams.feeStartTime = f.startTime
    feeParams.feeEndTime = f.endTime
  }
  if (f.contactId != null && f.contactId !== '') {
    feeClauses.push('fees.delivery_contact_id = @feeContactId')
    feeParams.feeContactId = f.contactId
  }
  const expenseRows = await db.prepare(`
    SELECT fees.delivery_contact_id,
           COALESCE(NULLIF(TRIM(dc.name), ''), '') AS delivery_contact_name,
           COUNT(*) AS linked_expense_count,
           COALESCE(SUM(fees.amount_usd), 0) AS linked_expense_usd,
           COALESCE(SUM(fees.amount_khr), 0) AS linked_expense_khr,
           MAX(fees.created_at) AS last_expense_at
    FROM fees
    JOIN delivery_contacts dc ON dc.id = fees.delivery_contact_id
    WHERE ${feeClauses.join(' AND ')}
    GROUP BY fees.delivery_contact_id, LOWER(TRIM(COALESCE(dc.name, '')))
  `).all<Record<string, unknown>>(feeParams)

  // Merge rows that share a real contact id (name-snapshot renames), keep
  // NULL-id rows separate per name.
  const merged = new Map<string, DeliveryContactTotalsRow & { _lastAt: string }>()
  for (const r of rows || []) {
    const id = r.delivery_contact_id == null ? null : Number(r.delivery_contact_id)
    const name = String(r.delivery_contact_name || '')
    const key = id != null ? `id:${id}` : `name:${name.toLowerCase()}`
    const lastAt = String(r.last_delivery_at || '')
    const existing = merged.get(key)
    const add = {
      deliveries: num(r.deliveries),
      charged: num(r.charged_fee_usd),
      paid: num(r.paid_fee_usd),
      receivable: num(r.receivable_fee_usd),
      absorbed: num(r.absorbed_fee_usd),
      actual: num(r.actual_cost_usd),
      actualCount: num(r.actual_cost_count),
    }
    if (!existing) {
      merged.set(key, {
        delivery_contact_id: id,
        delivery_contact_name: name,
        deliveries: add.deliveries,
        charged_fee_usd: add.charged,
        paid_fee_usd: add.paid,
        receivable_fee_usd: add.receivable,
        paid_by_method: [],
        absorbed_fee_usd: add.absorbed,
        actual_cost_usd: add.actual,
        actual_cost_count: add.actualCount,
        linked_expense_count: 0,
        linked_expense_usd: 0,
        linked_expense_khr: 0,
        margin_usd: 0,
        last_delivery_at: lastAt || null,
        last_expense_at: null,
        _lastAt: lastAt,
      })
      continue
    }
    existing.deliveries += add.deliveries
    existing.charged_fee_usd += add.charged
    existing.paid_fee_usd += add.paid
    existing.receivable_fee_usd += add.receivable
    existing.absorbed_fee_usd += add.absorbed
    existing.actual_cost_usd += add.actual
    existing.actual_cost_count += add.actualCount
    if (lastAt > existing._lastAt) {
      existing._lastAt = lastAt
      existing.last_delivery_at = lastAt
      // Latest snapshot wins the display name for a renamed contact.
      if (name) existing.delivery_contact_name = name
    }
  }
  for (const r of expenseRows || []) {
    const id = Number(r.delivery_contact_id)
    const name = String(r.delivery_contact_name || '')
    const key = `id:${id}`
    const existing = merged.get(key)
    const expenseAt = String(r.last_expense_at || '')
    if (!existing) {
      merged.set(key, {
        delivery_contact_id: id,
        delivery_contact_name: name,
        deliveries: 0,
        charged_fee_usd: 0,
        paid_fee_usd: 0,
        receivable_fee_usd: 0,
        paid_by_method: [],
        absorbed_fee_usd: 0,
        actual_cost_usd: 0,
        actual_cost_count: 0,
        linked_expense_count: num(r.linked_expense_count),
        linked_expense_usd: num(r.linked_expense_usd),
        linked_expense_khr: num(r.linked_expense_khr),
        margin_usd: 0,
        last_delivery_at: null,
        last_expense_at: expenseAt || null,
        _lastAt: '',
      })
      continue
    }
    existing.linked_expense_count += num(r.linked_expense_count)
    existing.linked_expense_usd += num(r.linked_expense_usd)
    existing.linked_expense_khr += num(r.linked_expense_khr)
    existing.last_expense_at = expenseAt || existing.last_expense_at
    if (name) existing.delivery_contact_name = name
  }
  for (const r of methodRows || []) {
    const id = r.delivery_contact_id == null ? null : Number(r.delivery_contact_id)
    const name = String(r.delivery_contact_name || '')
    const target = merged.get(id != null ? `id:${id}` : `name:${name.toLowerCase()}`)
    if (!target) continue
    const method = String(r.payment_method || 'Unknown')
    const existing = target.paid_by_method.find((m) => m.payment_method === method)
    if (existing) {
      existing.count += num(r.count)
      existing.fee_usd += num(r.fee_usd)
    } else {
      target.paid_by_method.push({ payment_method: method, count: num(r.count), fee_usd: num(r.fee_usd) })
    }
  }
  return [...merged.values()]
    .map(({ _lastAt, ...row }) => ({
      ...row,
      charged_fee_usd: round2(row.charged_fee_usd),
      paid_fee_usd: round2(row.paid_fee_usd),
      receivable_fee_usd: round2(row.receivable_fee_usd),
      paid_by_method: row.paid_by_method
        .map((m) => ({ ...m, fee_usd: round2(m.fee_usd) }))
        .sort((a, b) => b.fee_usd - a.fee_usd || a.payment_method.localeCompare(b.payment_method)),
      absorbed_fee_usd: round2(row.absorbed_fee_usd),
      actual_cost_usd: round2(row.actual_cost_usd),
      linked_expense_usd: round2(row.linked_expense_usd),
      linked_expense_khr: round2(row.linked_expense_khr),
      margin_usd: round2(row.charged_fee_usd - row.actual_cost_usd),
    }))
    .sort((a, b) => (b.deliveries + b.linked_expense_count) - (a.deliveries + a.linked_expense_count))
}

// X4: per-customer purchase totals -- the "same for customer" leg of the
// per-contact drills (suppliers have D5's purchases; couriers have X3).
export interface CustomerSalesTotalsRow {
  tx_count: number
  collected_usd: number
  discount_usd: number
  membership_discount_usd: number
  points_redeemed: number
  first_sale_at: string | null
  last_sale_at: string | null
}

export async function getCustomerSalesTotals(
  env: Env,
  f: SalesFilters & { customerId: number | string },
): Promise<CustomerSalesTotalsRow> {
  const db = getDb(env)
  const { sql: whereSql, params } = whereActiveSales('sales', f)
  params.customerId = f.customerId
  const row = await db.prepare(`
    SELECT COUNT(*) AS tx_count,
           COALESCE(SUM(${collectedExpr('')}), 0) AS collected_usd,
           COALESCE(SUM(discount_usd), 0) AS discount_usd,
           COALESCE(SUM(membership_discount_usd), 0) AS membership_discount_usd,
           COALESCE(SUM(membership_points_redeemed), 0) AS points_redeemed,
           MIN(created_at) AS first_sale_at,
           MAX(created_at) AS last_sale_at
    FROM sales
    WHERE ${whereSql} AND sales.customer_id = @customerId
  `).get<Record<string, unknown>>(params)
  return {
    tx_count: num(row?.tx_count),
    collected_usd: round2(num(row?.collected_usd)),
    discount_usd: round2(num(row?.discount_usd)),
    membership_discount_usd: round2(num(row?.membership_discount_usd)),
    points_redeemed: round2(num(row?.points_redeemed)),
    first_sale_at: row?.first_sale_at ? String(row.first_sale_at) : null,
    last_sale_at: row?.last_sale_at ? String(row.last_sale_at) : null,
  }
}

export async function getSalesDayReport(
  env: Env,
  day: string,
  opts: Pick<SalesFilters, 'branchId' | 'startTime' | 'endTime' | 'tzOffsetMinutes' | 'status' | 'paymentMethod'> = {},
): Promise<SalesDayReport> {
  const f: SalesFilters = { startDate: day, endDate: day, ...opts }
  {
    const snapshot = await readSalesReportSnapshot(env, f, true)
    const facts = reportSaleFacts(snapshot)
    const totals = exactReportTotals(aggregateReportSnapshot(snapshot, () => '').get('') || reportBucket(), snapshot)
    const paymentMethods = paymentMethodBreakdownFromSnapshot(snapshot)
    let storeTx = 0, membershipTx = 0
    for (const fact of facts) {
      const sale = fact.sale; const version = fact.version
      if (reportMoney(sale, 'discount_usd', version).isPositive()) storeTx += 1
      if (reportMoney(sale, 'membership_discount_usd', version).isPositive()) membershipTx += 1
    }
    const sales = facts.slice().sort((a, b) => String(b.sale.created_at).localeCompare(String(a.sale.created_at)) || Number(b.sale.id) - Number(a.sale.id))
      .slice(0, 1000).map((fact) => {
        const sale = fact.sale
        const discount = reportMoney(sale, 'discount_usd', fact.version).add(reportMoney(sale, 'membership_discount_usd', fact.version))
        const payable = Number(sale.source_return_id || 0) !== 0
          ? reportMoney(sale, 'amount_paid_usd', fact.version) : reportMoney(sale, 'total_usd', fact.version)
        const collected = fact.recognized && !fact.awaiting ? payable.subtract(fact.refundPaid) : ReportExactDecimal.zero()
        return { id: Number(sale.id), receipt_number: String(sale.receipt_number || ''), created_at: String(sale.created_at || ''),
          customer_name: Number(sale.customer_is_anonymous) !== 0 ? '' : String(sale.customer_name || ''),
          payment_method: String(sale.payment_method || '').trim() || 'Unknown', sale_status: reportStatus(sale),
          revenue_usd: fact.recognized ? fact.net.add(fact.adjustment).subtract(fact.refund).toNumber() : 0,
          discount_usd: discount.toNumber(), collected_usd: collected.toNumber() }
      })
    return { date: day, totals,
      payment_methods: paymentMethods,
      delivery_contacts: deliveryContactTotalsFromSnapshot(snapshot, f),
      discounts: { store_usd: totals.store_discount_usd, membership_usd: totals.membership_discount_usd,
        store_tx_count: storeTx, membership_tx_count: membershipTx }, sales }
  }
  const db = getDb(env)
  const { sql: whereSql, params } = whereActiveSales('sales', f)
  const [totals, paymentMethods, deliveryContacts, discountCounts, saleRows] = await Promise.all([
    getSalesTotals(env, f),
    getPaymentMethodBreakdown(env, f),
    getDeliveryContactTotals(env, f),
    db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN COALESCE(discount_usd, 0) > 0 THEN 1 ELSE 0 END), 0) AS store_tx_count,
             COALESCE(SUM(CASE WHEN COALESCE(membership_discount_usd, 0) > 0 THEN 1 ELSE 0 END), 0) AS membership_tx_count
      FROM sales
      WHERE ${whereSql}
    `).get<Record<string, number>>(params),
    // Per-sale rows for the drill. Same date/branch/status/payment scope as
    // every figure above (whereActiveSales), and revenue computed identically
    // to deriveTotals so SUM(revenue_usd) == totals.revenue_usd. Capped: a
    // single day of one shop never approaches 1000 receipts.
    db.prepare(`
      SELECT sales.id AS id, receipt_number, created_at,
             ${reportCustomerNameExpr('sales.')} AS customer_name,
             COALESCE(NULLIF(TRIM(payment_method), ''), 'Unknown') AS payment_method,
             COALESCE(sale_status, 'completed') AS sale_status,
             -- Canonical net-sales revenue, per sale: recognized sales only
             -- (cancelled contributes 0; awaiting_payment remains positive), net of THIS sale's
             -- own customer refunds -- identical basis to deriveTotals, so
             -- SUM(revenue_usd) over the day == totals.revenue_usd.
             ROUND(CASE WHEN ${recognizedExpr('')} THEN ${netSaleExpr('')} - ${netRefundExpr('', 'rf.')} ELSE 0 END, 2) AS revenue_usd,
             ROUND(COALESCE(discount_usd, 0) + COALESCE(membership_discount_usd, 0), 2) AS discount_usd,
             ROUND(${collectedExpr('')}, 2) AS collected_usd
      FROM sales
      ${CUSTOMER_REFUND_JOIN}sales.id
      WHERE ${whereSql}
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT 1000
    `).all<Record<string, unknown>>(params),
  ])
  return {
    date: day,
    totals,
    payment_methods: paymentMethods,
    delivery_contacts: deliveryContacts,
    discounts: {
      store_usd: totals.store_discount_usd,
      membership_usd: totals.membership_discount_usd,
      store_tx_count: num(discountCounts?.store_tx_count),
      membership_tx_count: num(discountCounts?.membership_tx_count),
    },
    sales: (saleRows || []).map((r) => ({
      id: Number(r.id),
      receipt_number: String(r.receipt_number || ''),
      created_at: String(r.created_at || ''),
      customer_name: String(r.customer_name || ''),
      payment_method: String(r.payment_method || ''),
      sale_status: String(r.sale_status || 'completed'),
      revenue_usd: num(r.revenue_usd),
      discount_usd: num(r.discount_usd),
      collected_usd: num(r.collected_usd),
    })),
  }
}

// Shifts [startDate, endDate] back by its own length, for a same-length
// "previous period" comparison (used for the Dashboard's trend arrows).
export function previousPeriodFilters(f: SalesFilters): SalesFilters {
  const start = new Date(`${f.startDate}T00:00:00Z`)
  const end = new Date(`${f.endDate}T00:00:00Z`)
  const dayMs = 24 * 60 * 60 * 1000
  const spanMs = Math.max(0, end.getTime() - start.getTime()) + dayMs
  const prevEnd = new Date(start.getTime() - dayMs)
  const prevStart = new Date(prevEnd.getTime() - spanMs + dayMs)
  const previous: SalesFilters = {
    startDate: prevStart.toISOString().slice(0, 10),
    endDate: prevEnd.toISOString().slice(0, 10),
    branchId: f.branchId,
  }
  const createdFrom = shiftWindowBound(f.createdFrom)
  const createdTo = shiftWindowBound(f.createdTo)
  if (createdFrom && createdTo) {
    const shift = (value: string) => new Date(`${value.replace(' ', 'T')}Z`).getTime() - spanMs
    previous.createdFrom = new Date(shift(createdFrom)).toISOString().slice(0, 19).replace('T', ' ')
    previous.createdTo = new Date(shift(createdTo)).toISOString().slice(0, 19).replace('T', ' ')
  }
  return previous
}

// D3 (Part 422): the product detail page's sales breakdown -- how much of
// ONE product sold per day and per month, through the SAME active-sales
// predicate every other number on the Sales surfaces uses (single-source
// rule; a cancelled sale never counts anywhere). Day rows cover the filter
// range; month rows aggregate the same range by month.
export type ProductSalesBreakdownRow = {
  period: string
  qty: number
  revenue_usd: number
  sale_count: number
}

export async function getProductSalesBreakdown(
  env: Env,
  productId: number,
  f: SalesFilters,
): Promise<{ by_day: ProductSalesBreakdownRow[]; by_month: ProductSalesBreakdownRow[] }> {
  const db = getDb(env)
  const { sql: activeSql, params } = whereActiveSales('s', f)
  const run = async (periodExpr: string): Promise<ProductSalesBreakdownRow[]> => {
    const rows = await db.prepare(`
      SELECT ${periodExpr} AS period,
             COALESCE(SUM(si.quantity), 0) AS qty,
             COALESCE(SUM(si.total_usd), 0) AS revenue_usd,
             COUNT(DISTINCT s.id) AS sale_count
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE ${activeSql} AND si.product_id = @productId
      GROUP BY period
      ORDER BY period DESC
    `).all<Record<string, unknown>>({ ...params, productId })
    return (rows || []).map((row) => ({
      period: String(row.period || ''),
      qty: num(row.qty),
      revenue_usd: round2(num(row.revenue_usd)),
      sale_count: num(row.sale_count),
    }))
  }
  return {
    by_day: await run(localDateExpr('s.created_at')),
    by_month: await run(localMonthExpr('s.created_at')),
  }
}

// ---------------------------------------------------------------------------
// Reports views (Sep 3 2026, lane sec-10 / session 8c). New EXPORTS only --
// nothing above this line changed. Grouped totals + product ranking for the
// Reports section's "by customer / cashier / payment / hour / weekday /
// branch" and "Products" views. Every grouped row is a full canonical
// SalesTotals built from the SAME per-sale expressions salesLevelTotals uses
// (recognized net sales - customer refunds = revenue; profit = revenue - COGS
// + delivery fees charged - courier cost paid), so the rows of one view sum
// to getSalesTotals for the same filters -- one revenue definition, sliced,
// never re-derived.
// ---------------------------------------------------------------------------

export type SalesGroupKey = 'customer' | 'cashier' | 'payment_method' | 'hour' | 'weekday' | 'branch'
export const SALES_GROUP_KEYS: readonly SalesGroupKey[] = ['customer', 'cashier', 'payment_method', 'hour', 'weekday', 'branch']

export interface SalesGroupedRow extends SalesTotals {
  /** Stable group key ('id:12', 'name:walk in', '13' for an hour, '0'..'6' for a weekday, ...). */
  key: string
  /** Display label as stored on the sale (customer/cashier/branch/payment name; hour 'HH'; weekday '0'..'6'). */
  label: string
  entity_id: number | null
  cost_missing_snapshot_lines: number
  // ---- additive per-group columns (peer reports-redesign lane, Sep 6 2026).
  // Present only on the groupings they mean something for; none of them
  // changes a money field above. by=customer gets the identity three,
  // by=cashier the cohort counts, by=branch the two activity counts.
  is_new?: boolean
  gender?: string
  phone?: string
  new_customer_count?: number
  return_customer_count?: number
  unregistered_count?: number
  paid_tx_count?: number
  customer_count?: number
  items_sold_qty?: number
}

/**
 * A customer is NEW when their first-ever recognized sale is the one inside
 * this window, and RETURNING when they bought before it. "First-ever" is not
 * window-relative: a roll-up over the whole table decides it, so one customer
 * is not counted new in every range they happen to appear in.
 *
 * Walk-ins (customer_id NULL) are neither -- there is no identity to be new,
 * and counting a nameless receipt as a new customer inflates acquisition.
 * They are reported separately, as unregistered_count.
 */
// Read-time identity normalization only. Persisted snapshots and foreign keys
// remain intact; an explicit customer marker is the sole anonymity authority.
export function identifiedCustomerExpr(prefix: string): string {
  return `CASE WHEN EXISTS (SELECT 1 FROM customers identity_customer WHERE identity_customer.id = ${prefix}customer_id AND identity_customer.is_anonymous = 1) THEN NULL ELSE ${prefix}customer_id END`
}

export function reportCustomerNameExpr(prefix: string): string {
  return `CASE WHEN EXISTS (SELECT 1 FROM customers identity_customer WHERE identity_customer.id = ${prefix}customer_id AND identity_customer.is_anonymous = 1) THEN '' ELSE COALESCE(${prefix}customer_name, '') END`
}

const FIRST_SALE_CTE = `WITH first_sale AS (
  SELECT customer_id, MIN(datetime(created_at)) AS first_at
  FROM sales
  WHERE ${identifiedCustomerExpr('sales.')} IS NOT NULL AND ${recognizedExpr('')}
  GROUP BY customer_id
)`

interface CohortCounts { new_customer_count: number; return_customer_count: number; unregistered_count: number; paid_tx_count: number }

async function cohortCountsByGroup(env: Env, f: SalesFilters, keyExpr: string): Promise<Map<string, CohortCounts>> {
  const db = getDb(env)
  const { sql: whereSql, params } = whereActiveSales('sales', f)
  const rows = await db.prepare(`
    ${FIRST_SALE_CTE}
    SELECT ${keyExpr} AS grp_key,
           COUNT(DISTINCT CASE WHEN sales.customer_id IS NOT NULL AND datetime(sales.created_at) = fs.first_at THEN sales.customer_id END) AS new_customer_count,
           COUNT(DISTINCT CASE WHEN sales.customer_id IS NOT NULL AND datetime(sales.created_at) > fs.first_at THEN sales.customer_id END) AS return_customer_count,
           COALESCE(SUM(CASE WHEN ${identifiedCustomerExpr('sales.')} IS NULL THEN 1 ELSE 0 END), 0) AS unregistered_count,
           COALESCE(SUM(CASE WHEN ${collectedSaleExpr('sales.')} THEN 1 ELSE 0 END), 0) AS paid_tx_count
    FROM sales
    LEFT JOIN first_sale fs ON fs.customer_id = sales.customer_id
    WHERE ${whereSql}
    GROUP BY grp_key
  `).all<Record<string, unknown>>(params)
  return new Map((rows || []).map((r) => [
    r.grp_key == null ? '' : String(r.grp_key),
    {
      new_customer_count: num(r.new_customer_count),
      return_customer_count: num(r.return_customer_count),
      unregistered_count: num(r.unregistered_count),
      paid_tx_count: num(r.paid_tx_count),
    },
  ]))
}

interface CustomerIdentity { is_new: boolean; gender: string; phone: string }

/** The identity three for by=customer. The phone falls back to the snapshot
 *  on the sale, because a walk-in row has no customers record to read. */
async function customerIdentityByGroup(env: Env, f: SalesFilters, keyExpr: string): Promise<Map<string, CustomerIdentity>> {
  const db = getDb(env)
  const { sql: whereSql, params } = whereActiveSales('sales', f)
  const rows = await db.prepare(`
    ${FIRST_SALE_CTE}
    SELECT ${keyExpr} AS grp_key,
           MAX(CASE WHEN sales.customer_id IS NOT NULL AND datetime(sales.created_at) = fs.first_at THEN 1 ELSE 0 END) AS is_new,
           MAX(CASE WHEN ${identifiedCustomerExpr('sales.')} IS NULL THEN '' ELSE COALESCE(NULLIF(TRIM(c.gender), ''), '') END) AS gender,
           MAX(CASE WHEN ${identifiedCustomerExpr('sales.')} IS NULL THEN '' ELSE COALESCE(NULLIF(TRIM(c.phone), ''), NULLIF(TRIM(sales.customer_phone), ''), '') END) AS phone
    FROM sales
    LEFT JOIN first_sale fs ON fs.customer_id = sales.customer_id
    LEFT JOIN customers c ON c.id = sales.customer_id
    WHERE ${whereSql}
    GROUP BY grp_key
  `).all<Record<string, unknown>>(params)
  return new Map((rows || []).map((r) => [
    r.grp_key == null ? '' : String(r.grp_key),
    { is_new: num(r.is_new) === 1, gender: String(r.gender || ''), phone: String(r.phone || '') },
  ]))
}

interface BranchActivity { customer_count: number; items_sold_qty: number }

/** by=branch activity. customer_count is DISTINCT identified customers: a
 *  branch's walk-in receipts have no identity to count and would otherwise
 *  collapse into one phantom customer. */
async function branchActivityByGroup(env: Env, f: SalesFilters, levelKey: string, joinedKey: string): Promise<Map<string, BranchActivity>> {
  const db = getDb(env)
  const { sql: whereLevel, params: paramsLevel } = whereActiveSales('sales', f)
  const { sql: whereJoined, params: paramsJoined } = whereActiveSales('s', f)
  const [customerRows, itemRows] = await Promise.all([
    db.prepare(`
      SELECT ${levelKey} AS grp_key, COUNT(DISTINCT ${identifiedCustomerExpr('sales.')}) AS customer_count
      FROM sales WHERE ${whereLevel} GROUP BY grp_key
    `).all<Record<string, unknown>>(paramsLevel),
    db.prepare(`
      SELECT ${joinedKey} AS grp_key, COALESCE(SUM(si.quantity), 0) AS items_sold_qty
      FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE ${whereJoined} GROUP BY grp_key
    `).all<Record<string, unknown>>(paramsJoined),
  ])
  const keyOf = (v: unknown) => (v == null ? '' : String(v))
  const out = new Map<string, BranchActivity>()
  for (const r of customerRows || []) out.set(keyOf(r.grp_key), { customer_count: num(r.customer_count), items_sold_qty: 0 })
  for (const r of itemRows || []) {
    const key = keyOf(r.grp_key)
    const existing = out.get(key) || { customer_count: 0, items_sold_qty: 0 }
    existing.items_sold_qty = num(r.items_sold_qty)
    out.set(key, existing)
  }
  return out
}

function salesGroupExprs(alias: string, groupBy: SalesGroupKey): { key: string; label: string; id: string } {
  const a = alias ? `${alias}.` : ''
  const created = `${a}created_at`
  switch (groupBy) {
    case 'customer':
      // The customer id is the identity (a rename cascades to customer_name
      // snapshots); legacy sales without an id fall back to the name.
      return {
        key: `CASE WHEN ${identifiedCustomerExpr(a)} IS NOT NULL THEN 'id:' || ${a}customer_id ELSE 'general' END`,
        label: `MAX(CASE WHEN ${identifiedCustomerExpr(a)} IS NULL THEN '' ELSE COALESCE(NULLIF(trim(${a}customer_name), ''), '') END)`,
        id: `MAX(${identifiedCustomerExpr(a)})`,
      }
    case 'cashier':
      return {
        key: `CASE WHEN ${a}cashier_id IS NOT NULL THEN 'id:' || ${a}cashier_id ELSE 'name:' || lower(trim(COALESCE(${a}cashier_name, ''))) END`,
        label: `MAX(COALESCE(NULLIF(trim(${a}cashier_name), ''), ''))`,
        id: `MAX(${a}cashier_id)`,
      }
    case 'payment_method':
      return {
        key: `lower(trim(COALESCE(NULLIF(trim(${a}payment_method), ''), 'unknown')))`,
        label: `MAX(COALESCE(NULLIF(trim(${a}payment_method), ''), ''))`,
        id: 'NULL',
      }
    case 'hour':
      return { key: localHourExpr(created), label: `MAX(${localHourExpr(created)})`, id: 'NULL' }
    case 'weekday':
      // '0' (Sunday) .. '6' (Saturday) of the UTC+7 business date.
      return { key: `strftime('%w', ${localDateExpr(created)})`, label: `MAX(strftime('%w', ${localDateExpr(created)}))`, id: 'NULL' }
    case 'branch':
      return { key: `COALESCE(${a}branch_id, 0)`, label: `MAX(COALESCE(${a}branch_name, ''))`, id: `MAX(${a}branch_id)` }
  }
}

function reportGroupIdentity(row: ReportScalarRow, groupBy: SalesGroupKey): { key: string; label: string; entity_id: number | null } {
  const customerId = row.customer_id == null || Number(row.customer_is_anonymous) !== 0 ? null : Number(row.customer_id)
  const rawDate = String(row.created_at || '')
  const local = new Date(new Date(/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(rawDate) ? rawDate : `${rawDate.replace(' ', 'T')}Z`).getTime() + 7 * 3_600_000)
  if (groupBy === 'customer') return { key: customerId == null ? 'general' : `id:${customerId}`, label: customerId == null ? '' : String(row.customer_name || '').trim(), entity_id: customerId }
  if (groupBy === 'cashier') {
    const id = row.cashier_id == null ? null : Number(row.cashier_id)
    const name = String(row.cashier_name || '').trim()
    return { key: id == null ? `name:${name.toLowerCase()}` : `id:${id}`, label: name, entity_id: id }
  }
  if (groupBy === 'payment_method') {
    const label = String(row.payment_method || '').trim() || 'Unknown'
    return { key: label.toLowerCase(), label: String(row.payment_method || '').trim(), entity_id: null }
  }
  if (groupBy === 'hour') { const key = String(local.getUTCHours()).padStart(2, '0'); return { key, label: key, entity_id: null } }
  if (groupBy === 'weekday') { const key = String(local.getUTCDay()); return { key, label: key, entity_id: null } }
  const id = row.branch_id == null ? null : Number(row.branch_id)
  return { key: String(id || 0), label: String(row.branch_name || ''), entity_id: id }
}

/**
 * Canonical SalesTotals per group. Same two-query shape as
 * getBusinessSummaryDayRows (sale level + item-level COGS, merged through
 * deriveTotals), only the bucket expression differs. Sorted by revenue
 * (desc) except hour/weekday which come back in clock order.
 */
export async function getSalesGroupedTotals(env: Env, f: SalesFilters, groupBy: SalesGroupKey, limit = 500): Promise<SalesGroupedRow[]> {
  {
    const snapshot = await readSalesReportSnapshot(env, f)
    const identity = (row: ReportScalarRow) => reportGroupIdentity(row, groupBy)
    const metadata = new Map([...snapshot.sales, ...snapshot.voidSales].map((row) => [identity(row).key, identity(row)]))
    const rows = [...aggregateReportSnapshot(snapshot, (sale) => identity(sale).key).entries()].map(([key, bucket]) => {
      const totals = exactReportTotals(bucket, snapshot)
      const meta = metadata.get(key) || { key, label: '', entity_id: null }
      const row = { key, label: meta.label, entity_id: meta.entity_id,
        cost_missing_snapshot_lines: bucket.missingCostLines, ...totals } as SalesGroupedRow
      return attachReportDiagnostic(row, reportMoneyDiagnostic(totals)!)
    })
    const level = salesGroupExprs('sales', groupBy)
    const joined = salesGroupExprs('s', groupBy)
    if (groupBy === 'customer') {
      const extra = await customerIdentityByGroup(env, f, level.key)
      for (const row of rows) { const hit = extra.get(row.key) || { is_new: false, gender: '', phone: '' }; Object.assign(row, hit) }
    } else if (groupBy === 'cashier') {
      const extra = await cohortCountsByGroup(env, f, level.key)
      for (const row of rows) Object.assign(row, extra.get(row.key) || { new_customer_count: 0, return_customer_count: 0, unregistered_count: 0, paid_tx_count: 0 })
    } else if (groupBy === 'branch') {
      const extra = await branchActivityByGroup(env, f, level.key, joined.key)
      for (const row of rows) Object.assign(row, extra.get(row.key) || { customer_count: 0, items_sold_qty: 0 })
    }
    if (groupBy === 'hour' || groupBy === 'weekday') rows.sort((a, b) => a.key.localeCompare(b.key))
    else rows.sort((a, b) => b.revenue_usd - a.revenue_usd || b.tx_count - a.tx_count || a.label.localeCompare(b.label))
    const cap = Math.max(1, Math.min(2000, Math.trunc(limit) || 500))
    return rows.slice(0, cap)
  }
  const db = getDb(env)
  const level = salesGroupExprs('sales', groupBy)
  const joined = salesGroupExprs('s', groupBy)
  const { sql: whereLevel, params: paramsLevel } = whereActiveSales('sales', f)
  const { sql: whereCost, params: paramsCost } = whereActiveSales('s', f)

  const [levelRows, costRows, returnedByKey, cancelledByKey] = await Promise.all([
    db.prepare(`
      SELECT ${level.key} AS grp_key, ${level.label} AS grp_label, ${level.id} AS grp_id,
             COUNT(*) AS tx_count,
             COALESCE(SUM(subtotal_usd), 0) AS gross_sales_usd,
             COALESCE(SUM(discount_usd), 0) AS store_discount_usd,
             COALESCE(SUM(membership_discount_usd), 0) AS membership_discount_usd,
             COALESCE(SUM(tax_usd), 0) AS tax_usd,
             COALESCE(SUM(CASE WHEN COALESCE(delivery_fee_paid_by, 'customer') = 'store' THEN 0 ELSE delivery_fee_usd END), 0) AS delivery_usd,
             COALESCE(SUM(CASE WHEN delivery_fee_paid_by = 'store' THEN delivery_fee_usd ELSE 0 END), 0) AS store_delivery_usd,
             ${RECOGNIZED_LEVEL_COLUMNS}
      FROM sales
      ${CUSTOMER_REFUND_JOIN}sales.id
      WHERE ${whereLevel}
      GROUP BY grp_key
    `).all<Record<string, number> & { grp_key: string | number | null; grp_label: string | null; grp_id: number | null }>(paramsLevel),
    db.prepare(`
      SELECT ${joined.key} AS grp_key,
             ${ITEM_COST_COLUMNS}
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE ${whereCost} AND ${ITEM_COST_STATUS_CLAUSE}
      GROUP BY grp_key
    `).all<ItemCostRow & { grp_key: string | number | null }>(paramsCost),
    returnedCostByBucket(env, f, joined.key),
    cancelledGroupCounts(env, f, level),
  ])

  const keyOf = (v: string | number | null | undefined): string => (v == null ? '' : String(v))
  const costByKey = new Map((costRows || []).map((r) => [keyOf(r.grp_key), num(r.cost_usd)]))
  const missingByKey = new Map((costRows || []).map((r) => [keyOf(r.grp_key), num(r.missing_snapshot_lines)]))
  const pendingCostByKey = new Map((costRows || []).map((r) => [keyOf(r.grp_key), num(r.pending_cost_usd)]))
  const itemDiscountByKey = new Map((costRows || []).map((r) => [keyOf(r.grp_key), num(r.item_discount_usd)]))
  const pendingItemDiscountByKey = new Map((costRows || []).map((r) => [keyOf(r.grp_key), num(r.pending_item_discount_usd)]))
  const unvaluedCostByKey = new Map((costRows || []).map((r) => [keyOf(r.grp_key), num(r.unvalued_cost_usd)]))
  const levelByKey = new Map((levelRows || []).map((r) => [keyOf(r.grp_key), r]))
  const keys = new Set<string>(levelByKey.keys())
  // A group whose every sale in this window was VOIDED has no level row --
  // it used to vanish, taking its void count with it. It belongs in the list
  // at zero money, which is exactly what the voids are worth.
  for (const k of cancelledByKey.keys()) if (k !== '') keys.add(k)
  const rows: SalesGroupedRow[] = [...keys].map((key) => {
    const r = levelByKey.get(key)
    const voided = cancelledByKey.get(key)
    return {
      key,
      label: r && r.grp_label != null ? String(r.grp_label) : (voided ? voided.label : ''),
      entity_id: r ? (r.grp_id == null ? null : Number(r.grp_id)) : (voided ? voided.entity_id : null),
      cost_missing_snapshot_lines: missingByKey.get(key) || 0,
      ...deriveTotals(r || VOID_ONLY_LEVEL, costByKey.get(key) || 0, returnedByKey.get(key) || 0, { costUsd: pendingCostByKey.get(key) || 0, itemDiscountUsd: itemDiscountByKey.get(key) || 0, pendingItemDiscountUsd: pendingItemDiscountByKey.get(key) || 0, cancelledTxCount: voided ? voided.count : 0, unvaluedCostUsd: unvaluedCostByKey.get(key) || 0 }),
    }
  })
  // ---- the additive per-group columns ------------------------------------
  // One extra query for the groupings that carry them, none for the rest.
  // They are attached AFTER deriveTotals so they cannot reach a money field,
  // which is the whole contract with the reports lane: additive only.
  if (groupBy === 'customer') {
    const identity = await customerIdentityByGroup(env, f, level.key)
    for (const row of rows) {
      const hit = identity.get(row.key) || { is_new: false, gender: '', phone: '' }
      row.is_new = hit.is_new
      row.gender = hit.gender
      row.phone = hit.phone
    }
  } else if (groupBy === 'cashier') {
    const cohorts = await cohortCountsByGroup(env, f, level.key)
    for (const row of rows) {
      const hit = cohorts.get(row.key)
      row.new_customer_count = hit?.new_customer_count || 0
      row.return_customer_count = hit?.return_customer_count || 0
      row.unregistered_count = hit?.unregistered_count || 0
      row.paid_tx_count = hit?.paid_tx_count || 0
    }
  } else if (groupBy === 'branch') {
    const activity = await branchActivityByGroup(env, f, level.key, joined.key)
    for (const row of rows) {
      const hit = activity.get(row.key)
      row.customer_count = hit?.customer_count || 0
      row.items_sold_qty = hit?.items_sold_qty || 0
    }
  }
  if (groupBy === 'hour' || groupBy === 'weekday') {
    rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  } else {
    rows.sort((a, b) => b.revenue_usd - a.revenue_usd || b.tx_count - a.tx_count || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
  }
  const cap = Math.max(1, Math.min(2000, Math.trunc(limit) || 500))
  return rows.length > cap ? rows.slice(0, cap) : rows
}

export interface ProductSalesRankingRow {
  product_id: number | null
  product_name: string
  sale_count: number
  qty: number
  /** SUM(sale_items.total_usd): line totals after line discounts, before order-level store/membership discounts. */
  line_sales_usd: number
  cost_usd: number
  /** line_sales_usd - cost_usd (item-level gross profit; NULL cost snapshots count as 0 and are flagged). */
  profit_usd: number
  cost_missing_snapshot_lines: number
  // ---- additive identity/stock columns (peer reports-redesign lane, Sep 6
  // 2026). None of them touches the money above. `category_id` is NULL when
  // the product's free-text category does not match a row in `categories` --
  // products.category is TEXT, there is no FK, so the id is a best-effort
  // resolution by name rather than a claim of one.
  category_id: number | null
  category_name: string
  barcode: string
  // On-hand NOW, not as of the range: a stock level has no history here.
  // Branch-scoped to f.branchId when one is set (branch_stock), otherwise the
  // catalog-wide products.stock_quantity -- the same two ledgers the rest of
  // the app reads, never mixed.
  on_hand_qty: number
}

/**
 * Products ranked by line sales over RECOGNIZED sales only (the same
 * population revenue and COGS are computed from), respecting every
 * SalesFilters field through whereActiveSales.
 */
export async function getProductSalesRanking(env: Env, f: SalesFilters, limit = 200): Promise<ProductSalesRankingRow[]> {
  {
    const snapshot = await readSalesReportSnapshot(env, f)
    const saleById = new Map(snapshot.sales.map((sale) => [Number(sale.id), sale]))
    const groups = new Map<string, { product_id: number | null; product_name: string; saleIds: Set<number>; qty: number;
      lineSales: ReportExactDecimal; cost: ReportExactDecimal; missing: number }>()
    for (const item of snapshot.items) {
      const sale = saleById.get(Number(item.sale_id)); if (!sale || reportStatus(sale) === 'cancelled') continue
      const productId = item.product_id == null ? null : Number(item.product_id)
      const name = String(item.product_name || '')
      const key = productId == null ? `name:${name.trim().toLowerCase()}` : `id:${productId}`
      const group = groups.get(key) || { product_id: productId, product_name: name, saleIds: new Set<number>(), qty: 0,
        lineSales: ReportExactDecimal.zero(), cost: ReportExactDecimal.zero(), missing: 0 }
      const version = reportVersion(sale)
      const quantity = ReportExactDecimal.quantity(item.quantity as string | number)
      group.qty += Number(item.quantity)
      group.saleIds.add(Number(sale.id))
      group.lineSales = group.lineSales.add(reportMoney(item, 'total_usd', version))
      if (item.cost_price_usd == null) group.missing += 1
      else {
        const unit = reportMoney(item, 'cost_price_usd', version, false)
        if (unit.isNegative()) throw new ReportMoneyPrecisionError(version === 1 ? 'invalid_saved_money4' : 'invalid_recorded_decimal')
        group.cost = group.cost.add(unit.multiply(quantity))
      }
      groups.set(key, group)
    }
    const db = getDb(env)
    const productColumns = await reportTableColumns(db, 'products')
    const categoryColumns = await reportTableColumns(db, 'categories')
    const metadata = new Map<number, Record<string, unknown>>()
    if (productColumns.has('id')) {
      const categoryJoin = categoryColumns.has('id') && categoryColumns.has('name')
        ? "LEFT JOIN categories cat ON lower(trim(cat.name))=lower(trim(COALESCE(p.category,''))) AND COALESCE(p.category,'')<>''" : ''
      const categoryId = categoryJoin ? 'cat.id' : 'NULL'
      const onHand = f.branchId
        ? 'COALESCE((SELECT SUM(bs.quantity) FROM branch_stock bs WHERE bs.product_id=p.id AND bs.branch_id=@branchId),0)'
        : 'COALESCE(p.stock_quantity,0)'
      const rows = await db.prepare(`SELECT p.id,p.name,p.barcode,p.category,${categoryId} AS category_id,${onHand} AS on_hand_qty FROM products p ${categoryJoin}`)
        .all<Record<string, unknown>>(f.branchId ? { branchId: f.branchId } : {})
      for (const row of rows || []) metadata.set(Number(row.id), row)
    }
    const diagnostic = { precision_mode: snapshot.precision_mode, complete: true, unknown_cost_lines: 0, contributing_rows: snapshot.row_count }
    const rows = [...groups.values()].map((group) => {
      const meta = group.product_id == null ? null : metadata.get(group.product_id)
      const row: ProductSalesRankingRow = {
        product_id: group.product_id, product_name: String(meta?.name || group.product_name), sale_count: group.saleIds.size, qty: group.qty,
        line_sales_usd: group.lineSales.toNumber(), cost_usd: group.cost.toNumber(),
        profit_usd: group.lineSales.subtract(group.cost).toNumber(), cost_missing_snapshot_lines: group.missing,
        category_id: meta?.category_id == null ? null : Number(meta.category_id), category_name: String(meta?.category || ''),
        barcode: String(meta?.barcode || ''), on_hand_qty: num(meta?.on_hand_qty),
      }
      return attachReportDiagnostic(row, { ...diagnostic, complete: group.missing === 0, unknown_cost_lines: group.missing })
    })
    rows.sort((a, b) => b.line_sales_usd - a.line_sales_usd || b.qty - a.qty)
    return rows.slice(0, Math.max(1, Math.min(1000, Math.trunc(limit) || 200)))
  }
  const db = getDb(env)
  const { sql: whereSql, params } = whereActiveSales('s', f)
  const cap = Math.max(1, Math.min(1000, Math.trunc(limit) || 200))
  // Two stock ledgers, never mixed: branch_stock when the report is scoped to
  // a branch, products.stock_quantity when it is not.
  const onHandExpr = f.branchId
    ? `COALESCE((SELECT SUM(bs.quantity) FROM branch_stock bs WHERE bs.product_id = si.product_id AND bs.branch_id = @branchId), 0)`
    : `COALESCE(p.stock_quantity, 0)`
  const rows = await db.prepare(`
    SELECT si.product_id AS product_id,
           MAX(COALESCE(si.product_name, '')) AS product_name,
           COUNT(DISTINCT s.id) AS sale_count,
           COALESCE(SUM(si.quantity), 0) AS qty,
           COALESCE(SUM(si.total_usd), 0) AS line_sales_usd,
           COALESCE(SUM(si.cost_price_usd * si.quantity), 0) AS cost_usd,
           COALESCE(SUM(CASE WHEN si.cost_price_usd IS NULL THEN 1 ELSE 0 END), 0) AS cost_missing_snapshot_lines,
           MAX(COALESCE(p.barcode, '')) AS barcode,
           MAX(COALESCE(p.category, '')) AS category_name,
           MAX(cat.id) AS category_id,
           MAX(${onHandExpr}) AS on_hand_qty
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    LEFT JOIN products p ON p.id = si.product_id
    LEFT JOIN categories cat ON lower(trim(cat.name)) = lower(trim(COALESCE(p.category, ''))) AND COALESCE(p.category, '') <> ''
    WHERE ${whereSql} AND ${recognizedExpr('s.')}
    GROUP BY COALESCE(si.product_id, 0), CASE WHEN si.product_id IS NULL THEN lower(trim(COALESCE(si.product_name, ''))) ELSE '' END
    ORDER BY line_sales_usd DESC, qty DESC
    LIMIT @limit
  `).all<{ product_id: number | null; product_name: string; sale_count: number; qty: number; line_sales_usd: number; cost_usd: number; cost_missing_snapshot_lines: number; barcode: string | null; category_name: string | null; category_id: number | null; on_hand_qty: number }>({ ...params, limit: cap })
  const r2 = (v: number) => Math.round(v * 100) / 100
  return (rows || []).map((r) => {
    const lineSales = r2(num(r.line_sales_usd))
    const cost = r2(num(r.cost_usd))
    return {
      product_id: r.product_id == null ? null : Number(r.product_id),
      product_name: String(r.product_name || ''),
      sale_count: num(r.sale_count),
      qty: num(r.qty),
      line_sales_usd: lineSales,
      cost_usd: cost,
      profit_usd: r2(lineSales - cost),
      cost_missing_snapshot_lines: num(r.cost_missing_snapshot_lines),
      category_id: r.category_id == null ? null : Number(r.category_id),
      category_name: String(r.category_name || ''),
      barcode: String(r.barcode || ''),
      on_hand_qty: num(r.on_hand_qty),
    }
  })
}

// Ported with the reports lane (S4-26): /periods builds its day rows from
// this one call, so a period roll-up can never disagree with the Sales header
// for the same range. Authored by the business-workbook lane; unchanged here.

// Section 5 (Business summary workbook, Sep 2): one row per BUSINESS DAY
// (UTC+7) carrying the FULL canonical SalesTotals shape, not the narrowed
// SalesPeriodRow getSalesPeriodSeries returns for the Dashboard chart. This
// is the Summary sheet's data source -- gross sales, both discount lines,
// tax, delivery, refunds, net revenue, pending (awaiting_payment) credit,
// collected total, cost and profit all come out of ONE call to deriveTotals
// per day, so the workbook can never disagree with the Sales-page header or
// the Dashboard for the same range (single-source rule). Only days that
// actually have at least one sale are returned -- same convention
// getSalesPeriodSeries already uses -- callers that need every calendar day
// in a range (e.g. to merge in expense-only days for Reconciliation) union
// this with their own day set.
// cost_missing_snapshot_lines: how many RECOGNIZED sold lines that day have
// no cost_price_usd snapshot (legacy/imported rows -- the live create-sale
// path always writes a numeric snapshot, see routes/sales.ts's `costPriceUsd:
// Number(product?.cost_price_usd || 0)`). Those lines contribute $0 to
// cost_usd via plain SQL SUM/COALESCE -- the EXACT same basis salesCost()
// (this file, used by getSalesTotals/getSalesPeriodSeries) already uses, so
// the workbook's COGS figure never drifts from the Dashboard/Sales-page
// figure for the same range. This count is purely a transparency signal for
// the Definitions/COGS sheet ("N sold lines have no cost snapshot and are
// counted as $0 COGS here, same as everywhere else in the app") -- it never
// changes cost_usd itself.
export type BusinessSummaryDayRow = { date: string; cost_missing_snapshot_lines: number } & SalesTotals

export async function getBusinessSummaryPeriodRows(env: Env, f: SalesFilters, granularity: 'day' | 'week' | 'month') {
  const snapshot = await readSalesReportSnapshot(env, f)
  const dayFor = (sale: ReportScalarRow) => {
    const raw = String(sale.created_at || '')
    const parsed = new Date(/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`)
    return new Date(parsed.getTime() + 7 * 3_600_000).toISOString().slice(0, 10)
  }
  const periodFor = (sale: ReportScalarRow) => {
    const day = dayFor(sale)
    if (granularity === 'month') return day.slice(0, 7)
    if (granularity === 'week') {
      const date = new Date(`${day}T00:00:00Z`); const dow = date.getUTCDay(); const back = dow === 0 ? 6 : dow - 1
      return new Date(date.getTime() - back * 86_400_000).toISOString().slice(0, 10)
    }
    return day
  }
  const daySets = new Map<string, Set<string>>()
  for (const sale of [...snapshot.sales, ...snapshot.voidSales]) {
    const key = periodFor(sale); const days = daySets.get(key) || new Set<string>(); days.add(dayFor(sale)); daySets.set(key, days)
  }
  return [...aggregateReportSnapshot(snapshot, periodFor).entries()].map(([period, bucket]) => {
    const totals = exactReportTotals(bucket, snapshot); const diagnostic = reportMoneyDiagnostic(totals)!
    const day = granularity === 'day' ? period : granularity === 'month' ? `${period}-01` : period
    const from = new Date(`${day}T00:00:00Z`)
    const to = granularity === 'month' ? new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0))
      : granularity === 'week' ? new Date(from.getTime() + 6 * 86_400_000) : from
    return attachReportDiagnostic({ period, date_from: day, date_to: to.toISOString().slice(0, 10), days: daySets.get(period)?.size || 0,
      cost_missing_snapshot_lines: diagnostic.unknown_cost_lines, ...totals }, diagnostic)
  }).sort((a, b) => a.period.localeCompare(b.period))
}

export async function getBusinessSummaryDayRows(env: Env, f: SalesFilters): Promise<BusinessSummaryDayRow[]> {
  {
    const snapshot = await readSalesReportSnapshot(env, f)
    const dateFor = (sale: ReportScalarRow) => {
      const raw = String(sale.created_at || '')
      const parsed = new Date(/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`)
      return new Date(parsed.getTime() + 7 * 3_600_000).toISOString().slice(0, 10)
    }
    return [...aggregateReportSnapshot(snapshot, dateFor).entries()].map(([date, bucket]) => {
      const totals = exactReportTotals(bucket, snapshot)
      const diagnostic = reportMoneyDiagnostic(totals)!
      return attachReportDiagnostic({ date, cost_missing_snapshot_lines: diagnostic.unknown_cost_lines, ...totals }, diagnostic)
    }).sort((a, b) => a.date.localeCompare(b.date))
  }
  const db = getDb(env)
  const periodExprS = localDateExpr('sales.created_at')
  const periodExprJoined = localDateExpr('s.created_at')
  const { sql: whereLevel, params: paramsLevel } = whereActiveSales('sales', f)
  const { sql: whereCost, params: paramsCost } = whereActiveSales('s', f)

  const [levelRows, costRows, returnedByPeriod, cancelledByPeriod] = await Promise.all([
    db.prepare(`
      SELECT ${periodExprS} AS period, COUNT(*) AS tx_count,
             COALESCE(SUM(subtotal_usd), 0) AS gross_sales_usd,
             COALESCE(SUM(discount_usd), 0) AS store_discount_usd,
             COALESCE(SUM(membership_discount_usd), 0) AS membership_discount_usd,
             COALESCE(SUM(tax_usd), 0) AS tax_usd,
             COALESCE(SUM(CASE WHEN COALESCE(delivery_fee_paid_by, 'customer') = 'store' THEN 0 ELSE delivery_fee_usd END), 0) AS delivery_usd,
             COALESCE(SUM(CASE WHEN delivery_fee_paid_by = 'store' THEN delivery_fee_usd ELSE 0 END), 0) AS store_delivery_usd,
             ${RECOGNIZED_LEVEL_COLUMNS}
      FROM sales
      ${CUSTOMER_REFUND_JOIN}sales.id
      WHERE ${whereLevel}
      GROUP BY ${periodExprS}
    `).all<Record<string, number> & { period: string }>(paramsLevel),
    db.prepare(`
      SELECT ${periodExprJoined} AS period,
             ${ITEM_COST_COLUMNS}
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE ${whereCost} AND ${ITEM_COST_STATUS_CLAUSE}
      GROUP BY ${periodExprJoined}
    `).all<ItemCostRow & { period: string }>(paramsCost),
    returnedCostByBucket(env, f, periodExprJoined),
    cancelledCountByBucket(env, f, periodExprS),
  ])

  const costByPeriod = new Map((costRows || []).map((r) => [r.period, num(r.cost_usd)]))
  const missingByPeriod = new Map((costRows || []).map((r) => [r.period, num(r.missing_snapshot_lines)]))
  const pendingCostByPeriod = new Map((costRows || []).map((r) => [r.period, num(r.pending_cost_usd)]))
  const itemDiscountByPeriod = new Map((costRows || []).map((r) => [r.period, num(r.item_discount_usd)]))
  const pendingItemDiscountByPeriod = new Map((costRows || []).map((r) => [r.period, num(r.pending_item_discount_usd)]))
  const unvaluedCostByPeriod = new Map((costRows || []).map((r) => [r.period, num(r.unvalued_cost_usd)]))
  const levelByPeriod = new Map((levelRows || []).map((r) => [r.period, r as Record<string, number>]))
  const rows = unionBuckets(levelByPeriod.keys(), cancelledByPeriod).map((period) => ({
    date: period,
    cost_missing_snapshot_lines: missingByPeriod.get(period) || 0,
    ...deriveTotals(levelByPeriod.get(period) || VOID_ONLY_LEVEL, costByPeriod.get(period) || 0, returnedByPeriod.get(period) || 0, { costUsd: pendingCostByPeriod.get(period) || 0, itemDiscountUsd: itemDiscountByPeriod.get(period) || 0, pendingItemDiscountUsd: pendingItemDiscountByPeriod.get(period) || 0, cancelledTxCount: cancelledByPeriod.get(period) || 0, unvaluedCostUsd: unvaluedCostByPeriod.get(period) || 0 }),
  }))
  return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

