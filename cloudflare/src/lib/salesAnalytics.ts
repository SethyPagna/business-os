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
//                                 'customer' (customer pays it, on top of
//                                 total_usd) or 'store' (store absorbs it --
//                                 a real cost, not collected from anyone)
//   sale_items.cost_price_usd * quantity = COGS for that line
//
// Definitions used everywhere below (canonical revenue = NET SALES, user
// directive Sep 1 2026 -- see the "Canonical revenue" block further down):
//   gross_sales_usd   = SUM(subtotal_usd)                     -- pre-discount, all sales
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
//   collected_total_usd = revenue_usd + tax_usd + delivery_usd  -- secondary
//                         "total collected": what actually changed hands with
//                         the customer (delivery_usd = customer-paid only)
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
  // P6: the courier money actually paid out (staff-only surface; NULL rows
  // don't count -- delivery_actual_cost_count says how many sales carried
  // one, vs delivery_sale_count deliveries total, so a partial record is
  // visible instead of read as profit). Display-only: deliberately NOT
  // folded into profit_usd (standing rule: existing calculations don't
  // change without an explicit ask).
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
  // "What this period would be worth once the outstanding sales are paid."
  //
  // pending_revenue_usd has existed since the Sep-1 canonical-revenue ruling;
  // these give it the rest of the picture the owner asked for -- unpaid
  // discounts, unpaid COGS, unpaid delivery, unpaid profit -- on exactly the
  // bases their realised twins use, so the two blocks are comparable.
  //
  // BINDING (user ruling, Sep 4 2026): no realised figure absorbs any of
  // these. They are reported beside the statement and rendered BELOW its final
  // total, the same discipline the shift report applies to unpaid credit.
  // pending_cost_usd / pending_profit_usd are admin-only money and are gated
  // with cost_usd / profit_usd by routes/reports.ts's gateTotals.
  pending_tx_count: number
  pending_gross_sales_usd: number
  pending_store_discount_usd: number
  pending_membership_discount_usd: number
  pending_delivery_usd: number
  pending_delivery_cost_usd: number
  // Gross cost of goods on the awaiting cohort. A customer return against a
  // sale that has not been paid for is NOT netted off here (realised cost_usd
  // does net its restocked returns): before payment such a sale is cancelled
  // rather than returned, and if one ever exists it overstates pending COGS,
  // i.e. UNDER-states pending profit -- the conservative direction for a
  // figure that is explicitly theoretical.
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
  // Secondary "total collected" figure (Option 3): recognized revenue plus the
  // tax and customer-paid delivery fee actually taken in. Never the headline.
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
// A RECOGNIZED sale is neither cancelled nor awaiting_payment. Tax and delivery
// fees are excluded from revenue; unpaid credit (awaiting_payment) is surfaced
// separately as pending_revenue and only becomes revenue once paid. These are
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
           -- Canonical net-sales revenue components (recognized = not cancelled/awaiting):
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
  costUsd?: number
  itemDiscountUsd?: number
  pendingItemDiscountUsd?: number
  /** Receipts VOIDED in this bucket -- never reachable from `level`, whose
   *  own WHERE hides cancelled sales. Supplied by cancelledCountByBucket. */
  cancelledTxCount?: number
  /** COGS on recognized-but-unvalued receipts, held out of cost_usd. */
  unvaluedCostUsd?: number
}

export function deriveTotals(level: Record<string, number>, costUsd: number, returnedCostUsd = 0, options: DeriveTotalsOptions = {}): SalesTotals {
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
  // ---- the theoretical (awaiting-payment) cohort, S4R3-6 -------------------
  // Same shape as the realised figures above and computed with the same
  // formula, so "what this period would be worth once the outstanding sales
  // are paid" is directly comparable with what it is worth today. Nothing
  // here is added into revenueUsd, collectedTotalUsd, netCostUsd or profitUsd.
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
  const [level, cost, returnedCostUsd, cancelled] = await Promise.all([
    salesLevelTotals(env, f),
    salesCost(env, f),
    salesReturnedCost(env, f),
    cancelledCountByBucket(env, f, null),
  ])
  return deriveTotals(level, cost.cost_usd, returnedCostUsd, {
    costUsd: cost.pending_cost_usd,
    itemDiscountUsd: cost.item_discount_usd,
    pendingItemDiscountUsd: cost.pending_item_discount_usd,
    cancelledTxCount: cancelled.get('') || 0,
    unvaluedCostUsd: cost.unvalued_cost_usd,
  })
}

// Period-bucketed trend series (for the Dashboard revenue/cost/profit line
// chart and count bar chart). Sale-level sums and item-level cost are
// queried and grouped separately, then merged by period key in JS -- same
// fan-out-avoidance reasoning as getSalesTotals above, just bucketed.
export async function getSalesPeriodSeries(env: Env, f: SalesFilters, granularity: 'day' | 'week' | 'month'): Promise<SalesPeriodRow[]> {
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
}

// One receipt inside a day's drill. revenue_usd is computed the SAME way the
// kernel defines revenue -- net sale (subtotal minus both discounts) minus this
// sale's own customer refunds, and 0 for a non-recognized (awaiting_payment /
// cancelled) sale -- so these rows sum to the day's revenue_usd. The
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

export async function getPaymentMethodBreakdown(env: Env, f: SalesFilters): Promise<PaymentMethodBreakdownRow[]> {
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
export async function getDeliveryContactTotals(
  env: Env,
  f: SalesFilters & { contactId?: number | string | null },
): Promise<DeliveryContactTotalsRow[]> {
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
           COALESCE(SUM(delivery_actual_cost_usd), 0) AS actual_cost_usd,
           COALESCE(SUM(CASE WHEN delivery_actual_cost_usd IS NOT NULL THEN 1 ELSE 0 END), 0) AS actual_cost_count,
           MAX(created_at) AS last_delivery_at
    FROM sales
    WHERE ${clauses.join(' AND ')}
    GROUP BY delivery_contact_id, LOWER(TRIM(COALESCE(delivery_contact_name, '')))
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
  return [...merged.values()]
    .map(({ _lastAt, ...row }) => ({
      ...row,
      charged_fee_usd: round2(row.charged_fee_usd),
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
             COALESCE(NULLIF(TRIM(customer_name), ''), '') AS customer_name,
             COALESCE(NULLIF(TRIM(payment_method), ''), 'Unknown') AS payment_method,
             COALESCE(sale_status, 'completed') AS sale_status,
             -- Canonical net-sales revenue, per sale: recognized sales only
             -- (awaiting_payment / cancelled contribute 0), net of THIS sale's
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
// - store-paid delivery), so the rows of one view sum to getSalesTotals for
// the same filters -- one revenue definition, sliced, never re-derived.
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
}

function salesGroupExprs(alias: string, groupBy: SalesGroupKey): { key: string; label: string; id: string } {
  const a = alias ? `${alias}.` : ''
  const created = `${a}created_at`
  switch (groupBy) {
    case 'customer':
      // The customer id is the identity (a rename cascades to customer_name
      // snapshots); legacy sales without an id fall back to the name.
      return {
        key: `CASE WHEN ${a}customer_id IS NOT NULL THEN 'id:' || ${a}customer_id ELSE 'name:' || lower(trim(COALESCE(${a}customer_name, ''))) END`,
        label: `MAX(COALESCE(NULLIF(trim(${a}customer_name), ''), ''))`,
        id: `MAX(${a}customer_id)`,
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

/**
 * Canonical SalesTotals per group. Same two-query shape as
 * getBusinessSummaryDayRows (sale level + item-level COGS, merged through
 * deriveTotals), only the bucket expression differs. Sorted by revenue
 * (desc) except hour/weekday which come back in clock order.
 */
export async function getSalesGroupedTotals(env: Env, f: SalesFilters, groupBy: SalesGroupKey, limit = 500): Promise<SalesGroupedRow[]> {
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
}

/**
 * Products ranked by line sales over RECOGNIZED sales only (the same
 * population revenue and COGS are computed from), respecting every
 * SalesFilters field through whereActiveSales.
 */
export async function getProductSalesRanking(env: Env, f: SalesFilters, limit = 200): Promise<ProductSalesRankingRow[]> {
  const db = getDb(env)
  const { sql: whereSql, params } = whereActiveSales('s', f)
  const cap = Math.max(1, Math.min(1000, Math.trunc(limit) || 200))
  const rows = await db.prepare(`
    SELECT si.product_id AS product_id,
           MAX(COALESCE(si.product_name, '')) AS product_name,
           COUNT(DISTINCT s.id) AS sale_count,
           COALESCE(SUM(si.quantity), 0) AS qty,
           COALESCE(SUM(si.total_usd), 0) AS line_sales_usd,
           COALESCE(SUM(si.cost_price_usd * si.quantity), 0) AS cost_usd,
           COALESCE(SUM(CASE WHEN si.cost_price_usd IS NULL THEN 1 ELSE 0 END), 0) AS cost_missing_snapshot_lines
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    WHERE ${whereSql} AND ${recognizedExpr('s.')}
    GROUP BY COALESCE(si.product_id, 0), CASE WHEN si.product_id IS NULL THEN lower(trim(COALESCE(si.product_name, ''))) ELSE '' END
    ORDER BY line_sales_usd DESC, qty DESC
    LIMIT @limit
  `).all<{ product_id: number | null; product_name: string; sale_count: number; qty: number; line_sales_usd: number; cost_usd: number; cost_missing_snapshot_lines: number }>({ ...params, limit: cap })
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

export async function getBusinessSummaryDayRows(env: Env, f: SalesFilters): Promise<BusinessSummaryDayRow[]> {
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

