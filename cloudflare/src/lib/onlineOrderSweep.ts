// Online orders (KHQR lane, slice S4): the two ways an order learns about its money without the customer's page being open.
//
//   settleByTranId  PayWay's callback names a transaction. The callback is only a NUDGE: its token proves it came from a URL we gave ABA, and then the
//                   server asks PayWay itself (check-transaction-2) and lets applyCheckResult decide. Whatever the callback body says is never read.
//   sweepOrders     the */5 cron: every payment still waiting past its QR lifetime (plus a short grace) is checked once more, and only then expired.
//
// Both ignore the `online_orders` switch: money already taken is always handled. Both go through applyCheckResult, the one place a check becomes
// Paid, Review or Failed, so a payment settled here and one settled by a customer's poll leave identical rows and Records.

import type { D1Compat } from './db'
import { checkTransaction, PaywayError, type ParsedCheck, type PaywayCredentials } from './payway'
import { sweepBatchSize } from './onlineOrders'
import {
  PAYMENT_MINUTES_DEFAULT, PAYMENT_MINUTES_KEY, applyCheckResult, type OrderDeps, type OrderRecord, type PaymentRecord,
} from './onlineOrderStore'

/** After its QR lifetime ends ABA may still be finishing a payment: wait this long before a payment is allowed to expire. */
export const EXPIRY_GRACE_SECONDS = 120

const sqlTime = (date: Date): string => date.toISOString().replace('T', ' ').replace('Z', '')

export type SettleOutcome = 'paid' | 'review' | 'failed' | 'pending' | 'noop' | 'unknown_payment' | 'closed'
export type SettleResult = { outcome: SettleOutcome; orderId?: number; paymentId?: number; purpose?: string }

type PaymentWithOrder = PaymentRecord & { order_state: string }

async function checkQuietly(deps: OrderDeps, creds: PaywayCredentials, tranId: string): Promise<ParsedCheck> {
  try {
    return await checkTransaction(deps.transport, creds, deps.now(), tranId)
  } catch (error) {
    return { ok: false, reason: error instanceof PaywayError ? error.reason : 'transport_failed' }
  }
}

/** The callback's whole job: find the payment, ask PayWay about it, apply the answer. An already-final payment costs one read and no PayWay call. */
export async function settleByTranId(deps: OrderDeps, creds: PaywayCredentials, tranId: string): Promise<SettleResult> {
  const payment = await deps.db.prepare(`
    SELECT p.*, o.state AS order_state FROM online_order_payments p JOIN online_orders o ON o.id = p.order_id WHERE p.tran_id = @tran
  `).get<PaymentWithOrder>({ tran: tranId })
  if (!payment) return { outcome: 'unknown_payment' }
  const base = { orderId: payment.order_id, paymentId: payment.id, purpose: payment.purpose }
  // Paid, cancelled and failed payments are final. An expired or review one can still turn paid (late money is real money).
  if (!['awaiting', 'expired', 'review'].includes(payment.state)) return { outcome: 'closed', ...base }
  const check = await checkQuietly(deps, creds, tranId)
  const outcome = await applyCheckResult(deps, { id: payment.order_id, state: payment.order_state }, payment, check, 'payway')
  return { outcome, ...base }
}

export type SweepSummary = { checked: number; paid: number; review: number; failed: number; expired: Array<{ orderId: number; paymentId: number; purpose: string }>; skipped: number }

/**
 * The payments that have outlived their QR: expires_at plus the grace, or - for a payment whose QR was never issued (a Worker that died between
 * the insert and the QR) - its creation plus the configured lifetime plus the grace. The lifetime is the owner's setting, read in the same
 * statement. The partial index on awaiting payments makes an idle tick one statement that reads nothing.
 */
export async function findStalePayments(db: D1Compat, now: Date, limit: number): Promise<PaymentWithOrder[]> {
  const rows = await db.prepare(`
    SELECT p.*, o.state AS order_state
    FROM online_order_payments p INDEXED BY idx_online_order_payments_open JOIN online_orders o ON o.id = p.order_id
    WHERE p.state = 'awaiting' AND (
      p.expires_at <= @expiredBefore
      OR (p.expires_at IS NULL AND p.created_at <= strftime('%Y-%m-%d %H:%M:%f', @now, '-' || (
        CASE WHEN CAST((SELECT value FROM settings WHERE key = @minutesKey) AS INTEGER) BETWEEN 3 AND 60
             THEN CAST((SELECT value FROM settings WHERE key = @minutesKey) AS INTEGER) ELSE @minutesDefault END * 60 + @grace) || ' seconds'))
    )
    ORDER BY p.expires_at ASC, p.id ASC LIMIT @limit
  `).all<PaymentWithOrder>({
    expiredBefore: sqlTime(new Date(now.getTime() - EXPIRY_GRACE_SECONDS * 1000)), now: sqlTime(now).slice(0, 19), minutesKey: PAYMENT_MINUTES_KEY,
    minutesDefault: PAYMENT_MINUTES_DEFAULT, grace: EXPIRY_GRACE_SECONDS, limit,
  })
  return rows || []
}

/** Expire one payment that PayWay says was not paid. The order follows only when no other payment of it is still waiting (an edit may have issued a newer QR). */
async function expirePayment(deps: OrderDeps, payment: PaymentWithOrder): Promise<boolean> {
  const at = sqlTime(deps.now())
  const moved = `EXISTS (SELECT 1 FROM online_order_payments WHERE id = @pid AND state = 'expired' AND revision = @newRev)`
  const [result] = await deps.db.batch([
    { sql: `UPDATE online_order_payments SET state = 'expired', revision = revision + 1, updated_at = @at WHERE id = @pid AND state = 'awaiting' AND revision = @rev`, params: { pid: payment.id, rev: payment.revision, newRev: payment.revision + 1, at } },
    {
      sql: `UPDATE online_orders SET state = 'expired', revision = revision + 1, updated_at = @at
            WHERE id = @oid AND @own = 1 AND state IN ('awaiting_payment') AND ${moved}
              AND NOT EXISTS (SELECT 1 FROM online_order_payments WHERE order_id = @oid AND state = 'awaiting')`,
      params: { oid: payment.order_id, pid: payment.id, newRev: payment.revision + 1, at, own: payment.purpose === 'order' ? 1 : 0 },
    },
    {
      sql: `INSERT INTO online_order_events (order_id, payment_id, event, from_state, to_state, source, detail_json, created_at)
            SELECT @oid, @pid, 'expired', @from, CASE WHEN (SELECT state FROM online_orders WHERE id = @oid) = 'expired' THEN 'expired' ELSE @from END, 'sweep', @detail, @at WHERE ${moved}`,
      params: { oid: payment.order_id, pid: payment.id, newRev: payment.revision + 1, at, from: payment.order_state, detail: JSON.stringify({ purpose: payment.purpose, qr_issued: payment.qr_string ? 1 : 0 }) },
    },
  ])
  return Number(result.meta?.changes ?? 0) === 1
}

/** One cron tick. Without PayWay credentials nothing can be confirmed, so nothing is expired (a payment is never expired on a guess). */
export async function sweepOrders(deps: OrderDeps, creds: PaywayCredentials | null): Promise<SweepSummary> {
  const summary: SweepSummary = { checked: 0, paid: 0, review: 0, failed: 0, expired: [], skipped: 0 }
  if (!creds) return summary
  const stale = await findStalePayments(deps.db, deps.now(), sweepBatchSize(deps.env))
  for (const payment of stale) {
    const check = await checkQuietly(deps, creds, payment.tran_id)
    summary.checked += 1
    // "Not found" is an answer: PayWay never saw this transaction (the QR was never issued). Any other failure is not, so the payment waits for the next tick.
    if (!check.ok && check.reason !== 'not_found') { summary.skipped += 1; continue }
    const outcome = check.ok ? await applyCheckResult(deps, { id: payment.order_id, state: payment.order_state }, payment, check, 'sweep') : 'pending'
    if (outcome === 'paid') summary.paid += 1
    else if (outcome === 'review') summary.review += 1
    else if (outcome === 'failed') summary.failed += 1
    else if (outcome === 'pending' && await expirePayment(deps, payment)) summary.expired.push({ orderId: payment.order_id, paymentId: payment.id, purpose: payment.purpose })
  }
  return summary
}

export type { OrderRecord }
