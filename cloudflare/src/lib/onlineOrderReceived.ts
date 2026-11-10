// KHQR S6a, lead condition 2: "received / collected" figures that are meant to be by ACTUAL PAYMENT DAY count an online order's money on the day PayWay took it
// (online_order_payments.paid_at), and not a second time on the day the order is fulfilled.
//
// Why an overlay: a Fulfil is an ordinary sale whose KHQR tender is the online money, so every sale-dated "collected" figure (the reports kernel) includes that money on
// the fulfil day, and the shift/tender reader already excludes it (lib/shiftReconciliation.ts linkedOnlineMoney). The two corrections are:
//   - sale-dated collected (reports totals, payment-method row): minus the money recorded on sales in the window, plus the money paid in the window;
//   - tender-based received (the Telegram overview's Received line, which already excludes linked online money): plus the money paid in the window.
// Revenue is untouched: the sale carries it on its own date, as for any sale.
import type { Env } from '../index'
import { getDb } from './db'
import { localDateRangeClause, localDateAtOrAfter, localDateAtOrBefore } from './businessDateWindow'
import { shiftWindowBound, whereActiveSales, type SalesFilters } from './salesAnalytics'
import { configuredOnlineMethod, ONLINE_PAYMENT_METHOD_KEY } from './onlineOrderFulfil'

export type OnlineReceivedOverlay = {
  /** The method name the online money is reported under (the configured KHQR method). */
  method: string
  /** Online money PayWay took inside the window, by paid_at (USD; orders are USD only today). */
  paidInWindowUsd: number
  /** Online money recorded on live sales created inside the window: already inside a sale-dated collected figure. */
  recordedOnSalesUsd: number
}

const NONE = (method: string): OnlineReceivedOverlay => ({ method, paidInWindowUsd: 0, recordedOnSalesUsd: 0 })
const money = (value: unknown): number => Math.round((Number(value) || 0) * 10000) / 10000

/** True when the filters narrow by anything the overlay cannot honour (status, payment method, time-of-day mask): those views stay the kernel's own figures. */
export const overlayApplies = (f: SalesFilters): boolean =>
  !String(f.status ?? '').trim() && !String(f.paymentMethod ?? '').trim() && !String(f.startTime ?? '').trim() && !String(f.endTime ?? '').trim()

/** The paid_at window, mirroring whereActiveSales's window on sales.created_at: exact moments when given, else local business days. */
function paidWindow(f: SalesFilters, column = 'op.paid_at', branchColumn: string | null = 'o.branch_id'): { clauses: string[]; params: Record<string, unknown> } {
  const clauses: string[] = []
  const params: Record<string, unknown> = {}
  const from = shiftWindowBound(f.createdFrom)
  const to = shiftWindowBound(f.createdTo)
  if (from) { clauses.push(`datetime(${column}) >= @createdFrom`); params.createdFrom = from }
  if (to) { clauses.push(`datetime(${column}) < @createdTo`); params.createdTo = to }
  if (f.startDate && f.endDate) { params.startDate = f.startDate; params.endDate = f.endDate; clauses.push(localDateRangeClause(column)) }
  else if (f.startDate) { params.startDate = f.startDate; clauses.push(localDateAtOrAfter(column)) }
  else if (f.endDate) { params.endDate = f.endDate; clauses.push(localDateAtOrBefore(column)) }
  if (f.branchId && branchColumn) { clauses.push(`${branchColumn} = @branchId`); params.branchId = f.branchId }
  return { clauses, params }
}

/** One statement. Fails open (zeros) where the online order tables do not exist, so a report never breaks for a shop that does not use the feature. */
export async function onlineReceivedOverlay(env: Env, f: SalesFilters): Promise<OnlineReceivedOverlay> {
  let method = configuredOnlineMethod(undefined)
  try {
    const db = getDb(env)
    const row = await db.prepare('SELECT value FROM settings WHERE key = @key').get<{ value: string }>({ key: ONLINE_PAYMENT_METHOD_KEY })
    method = configuredOnlineMethod(row?.value)
    if (!overlayApplies(f)) return NONE(method)
    const sold = whereActiveSales('s', { startDate: f.startDate, endDate: f.endDate, branchId: f.branchId, createdFrom: f.createdFrom, createdTo: f.createdTo })
    const paid = paidWindow(f)
    const result = await db.prepare(`SELECT
        (SELECT COALESCE(SUM(e.amount_usd), 0) FROM online_order_events e JOIN sales s ON s.id = e.sale_id
          WHERE e.event = 'payment_recorded_on_sale' AND ${sold.sql}) AS recorded,
        (SELECT COALESCE(SUM(COALESCE(op.paid_amount, op.amount)), 0) FROM online_order_payments op JOIN online_orders o ON o.id = op.order_id
          WHERE op.state = 'paid' AND op.paid_at IS NOT NULL${paid.clauses.length ? ` AND ${paid.clauses.join(' AND ')}` : ''}) AS paid`)
      .get<{ recorded: unknown; paid: unknown }>({ ...sold.params, ...paid.params })
    return { method, paidInWindowUsd: money(result?.paid), recordedOnSalesUsd: money(result?.recorded) }
  } catch {
    return NONE(method)
  }
}

// ---- the pure parts: what the composers do with the overlay (no database, tested in scripts/test-online-received-by-day-pure.cjs) ------------------------------

const round4 = (value: number): number => Math.round(value * 10000) / 10000
const round2 = (value: number): number => Math.round(value * 100) / 100

/**
 * A SALE-DATED collected figure (the reports kernel's collected total, or the KHQR method row) moved to the day the money arrived: the online money recorded on this window's
 * live sales is already inside it and comes out, the money PayWay took in this window goes in.
 */
export function collectedByPaymentDay(collectedUsd: number, overlay: Pick<OnlineReceivedOverlay, 'paidInWindowUsd' | 'recordedOnSalesUsd'>): number {
  return round2(collectedUsd + overlay.paidInWindowUsd - overlay.recordedOnSalesUsd)
}

/**
 * A TENDER-BASED received figure (the Telegram overview's Received line: it reads each sale's recorded tender, and the tender reader already leaves the online money of a
 * Fulfilled sale out of every day) gets the money PayWay took in the window, once, on its paid day.
 */
export function receivedWithOnlinePaid<T extends { digital: { usd: number } }>(received: T, overlay: Pick<OnlineReceivedOverlay, 'paidInWindowUsd'>): T {
  if (!(overlay.paidInWindowUsd > 0)) return received
  return { ...received, digital: { ...received.digital, usd: round4(received.digital.usd + overlay.paidInWindowUsd) } }
}

// ---- the two report blocks -------------------------------------------------------------------------------------------------------------------------------------

export type OnlineReportBlocks = {
  /** Money PayWay took in the window for orders still waiting to be handed over (paid, no sale yet): by paid_at. Not revenue; it becomes revenue on the sale date at Fulfil. */
  paidToFulfil: { orders: number; usd: number }
  /**
   * Refunds sent back through ABA in the window, from TWO disjoint sources: the refund_noted notes staff wrote for a refund sent outside a return (the Records row's date) and the
   * returns refunded through ABA (returns.refund_channel = 'aba', the return's date, the cash part). A return writes no note, so nothing counts twice.
   */
  abaRefunds: { count: number; usd: number }
}

/**
 * The Reports overview's two online blocks, ONE statement: "Paid online, to fulfil" walks the paid orders (the partial attention index: the size of the queue) and
 * "Refunds sent through ABA" the refund_noted Records (idx_online_order_events_refund, migration 0299). Neither touches revenue. Null where the overview is narrowed by
 * something these cannot honour (same rule as the received overlay); zeros where the tables do not exist.
 */
export async function onlineReportBlocks(env: Env, f: SalesFilters): Promise<OnlineReportBlocks | null> {
  const zero: OnlineReportBlocks = { paidToFulfil: { orders: 0, usd: 0 }, abaRefunds: { count: 0, usd: 0 } }
  if (!overlayApplies(f)) return null
  try {
    const orders = paidWindow(f, 'o.paid_at', 'o.branch_id')
    const refunds = paidWindow(f, 'e.created_at', null)
    const returnsWindow = paidWindow(f, 'r.created_at', 'r.branch_id')
    const refundBranch = f.branchId ? ' AND e.order_id IN (SELECT id FROM online_orders WHERE branch_id = @branchId)' : ''
    const where = (clauses: string[]) => (clauses.length ? ` AND ${clauses.join(' AND ')}` : '')
    const row = await getDb(env).prepare(`SELECT
        (SELECT COUNT(*) FROM online_orders o INDEXED BY idx_online_orders_attention WHERE o.state IN ('paid','review') AND o.state = 'paid' AND o.sale_id IS NULL${where(orders.clauses)}) AS orders,
        (SELECT COALESCE(SUM(COALESCE(op.paid_amount, op.amount)), 0) FROM online_orders o INDEXED BY idx_online_orders_attention JOIN online_order_payments op ON op.order_id = o.id AND op.state = 'paid'
          WHERE o.state IN ('paid','review') AND o.state = 'paid' AND o.sale_id IS NULL${where(orders.clauses)}) AS paid_usd,
        (SELECT COUNT(*) FROM online_order_events e WHERE e.event = 'refund_noted'${where(refunds.clauses)}${refundBranch}) AS refunds,
        (SELECT COALESCE(SUM(e.amount_usd), 0) FROM online_order_events e WHERE e.event = 'refund_noted'${where(refunds.clauses)}${refundBranch}) AS refund_usd,
        (SELECT COUNT(*) FROM returns r WHERE r.refund_channel = 'aba' AND COALESCE(r.status, 'completed') <> 'cancelled'${where(returnsWindow.clauses)}) AS aba_returns,
        (SELECT COALESCE(SUM(r.total_refund_usd - COALESCE(r.owed_reduction_usd, 0)), 0) FROM returns r WHERE r.refund_channel = 'aba' AND COALESCE(r.status, 'completed') <> 'cancelled'${where(returnsWindow.clauses)}) AS aba_return_usd`)
      .get<{ orders: unknown; paid_usd: unknown; refunds: unknown; refund_usd: unknown; aba_returns: unknown; aba_return_usd: unknown }>({ ...orders.params, ...refunds.params, ...returnsWindow.params })
    return { paidToFulfil: { orders: Number(row?.orders) || 0, usd: money(row?.paid_usd) }, abaRefunds: { count: (Number(row?.refunds) || 0) + (Number(row?.aba_returns) || 0), usd: money(money(row?.refund_usd) + money(row?.aba_return_usd)) } }
  } catch {
    return zero
  }
}
