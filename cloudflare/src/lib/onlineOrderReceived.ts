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
function paidWindow(f: SalesFilters): { clauses: string[]; params: Record<string, unknown> } {
  const clauses: string[] = []
  const params: Record<string, unknown> = {}
  const from = shiftWindowBound(f.createdFrom)
  const to = shiftWindowBound(f.createdTo)
  if (from) { clauses.push('datetime(op.paid_at) >= @createdFrom'); params.createdFrom = from }
  if (to) { clauses.push('datetime(op.paid_at) < @createdTo'); params.createdTo = to }
  if (f.startDate && f.endDate) { params.startDate = f.startDate; params.endDate = f.endDate; clauses.push(localDateRangeClause('op.paid_at')) }
  else if (f.startDate) { params.startDate = f.startDate; clauses.push(localDateAtOrAfter('op.paid_at')) }
  else if (f.endDate) { params.endDate = f.endDate; clauses.push(localDateAtOrBefore('op.paid_at')) }
  if (f.branchId) { clauses.push('o.branch_id = @branchId'); params.branchId = f.branchId }
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
