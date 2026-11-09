// Online orders (KHQR lane, slice S4): the two ways an order learns about its money without the customer's page being open.
//
//   settleByTranId  PayWay's callback names a transaction. The callback is only a NUDGE: its token proves it came from a URL we gave ABA, and then the
//                   server asks PayWay itself (check-transaction-2) and lets applyCheckResult decide. Whatever the callback body says is never read.
//   sweepOrders     the */5 cron: (1) every payment still waiting past its QR lifetime (plus a short grace) is checked once more, and only then expired;
//                   (2) an order stuck in qr_failed past the same time ends expired; (3) a few recently expired payments are re-checked, because a
//                   callback can be lost and money that arrives after the QR ran out is still money.
//
// Both ignore the `online_orders` switch: money already taken is always handled. Both go through applyCheckResult, the one place a check becomes
// Paid, Review or Failed, so a payment settled here and one settled by a customer's poll leave identical rows and Records.

import type { D1Compat } from './db'
import { checkTransaction, PaywayError, type ParsedCheck, type PaywayCredentials } from './payway'
import { nudgeCheckDue, sweepBatchSize } from './onlineOrders'
import { getPlanLimits } from './planTier'
import {
  PAYMENT_MINUTES_DEFAULT, PAYMENT_MINUTES_KEY, announceOrderEvent, applyCheckResult, type OrderDeps, type OrderRecord, type PaymentRecord,
} from './onlineOrderStore'

/** After its QR lifetime ends ABA may still be finishing a payment: wait this long before a payment is allowed to expire. */
export const EXPIRY_GRACE_SECONDS = 120

const sqlTime = (date: Date): string => date.toISOString().replace('T', ' ').replace('Z', '')

export type SettleOutcome = 'paid' | 'review' | 'failed' | 'pending' | 'noop' | 'unknown_payment' | 'closed' | 'throttled'
export type SettleResult = { outcome: SettleOutcome; orderId?: number; paymentId?: number; purpose?: string }

type PaymentWithOrder = PaymentRecord & { order_state: string }

async function checkQuietly(deps: OrderDeps, creds: PaywayCredentials, tranId: string): Promise<ParsedCheck> {
  try {
    return await checkTransaction(deps.transport, creds, deps.now(), tranId)
  } catch (error) {
    return { ok: false, reason: error instanceof PaywayError ? error.reason : 'transport_failed' }
  }
}

/**
 * One check per payment per plan interval, whoever asks (a poll, a callback, the sweep): the claim is a guarded write on last_checked_at, so a burst of
 * callbacks (ABA retries, or someone replaying a leaked URL) costs one PayWay call and the rest are answered without one.
 */
async function claimCheck(deps: OrderDeps, payment: Pick<PaymentRecord, 'id' | 'state' | 'last_checked_at'>): Promise<boolean> {
  const now = deps.now()
  if (!nudgeCheckDue(payment.last_checked_at, now, deps.env)) return false
  const claim = await deps.db.prepare(`UPDATE online_order_payments SET last_checked_at = @at WHERE id = @pid AND state = @state AND last_checked_at IS @last`)
    .run({ at: sqlTime(now), pid: payment.id, state: payment.state, last: payment.last_checked_at })
  return Number(claim.changes ?? 0) === 1
}

// An unknown transaction is announced once per isolate per day: the URL token proved the id is ours, so it is a payment with no order (a restore that lost
// the row, or another deployment sharing the key), and one message is enough for the shop to go and look.
const unknownSeen = new Set<string>()
export function resetUnknownAlertsForTests(): void { unknownSeen.clear() }

/** The callback's whole job: find the payment, ask PayWay about it, apply the answer. An already-final payment costs one read and no PayWay call. */
export async function settleByTranId(deps: OrderDeps, creds: PaywayCredentials, tranId: string): Promise<SettleResult> {
  const payment = await deps.db.prepare(`
    SELECT p.*, o.state AS order_state FROM online_order_payments p JOIN online_orders o ON o.id = p.order_id WHERE p.tran_id = @tran
  `).get<PaymentWithOrder>({ tran: tranId })
  if (!payment) {
    const key = `${deps.now().toISOString().slice(0, 10)}|${tranId}`
    if (!unknownSeen.has(key)) {
      if (unknownSeen.size > 200) unknownSeen.clear()
      unknownSeen.add(key)
      await announceOrderEvent(deps, { kind: 'unknown_payment', tranId })
    }
    return { outcome: 'unknown_payment' }
  }
  const base = { orderId: payment.order_id, paymentId: payment.id, purpose: payment.purpose }
  // Paid and review payments are final for every automatic path (staff resolve a review). Everything else is asked about, a cancelled or failed one
  // included: a customer can pay a QR we had replaced, and that money must not vanish.
  if (!['awaiting', 'expired', 'cancelled', 'failed'].includes(payment.state)) return { outcome: 'closed', ...base }
  if (!(await claimCheck(deps, payment))) return { outcome: 'throttled', ...base }
  const check = await checkQuietly(deps, creds, tranId)
  const outcome = await applyCheckResult(deps, { id: payment.order_id, state: payment.order_state }, payment, check, 'payway', creds)
  return { outcome, ...base }
}

export type SweepSummary = {
  checked: number; paid: number; review: number; failed: number; expired: Array<{ orderId: number; paymentId: number; purpose: string }>; skipped: number
  /** Expired payments re-checked for late money, and orders stuck in qr_failed that ended expired. */
  late: number; qrFailedExpired: number
  /** True when the tick's D1 budget ran out: what is left waits for the next tick. */
  deferred: boolean
  /** True when this tick ran the recovery pass after a maintenance hold; recoveryDone when that pass finished and removed its marker. */
  recovery?: boolean
  recoveryDone?: boolean
}

/** The owner's QR lifetime in minutes (settings, 3..60, else the default) plus the grace, in seconds, read inside the same statement that uses it. */
const LIFETIME_SECONDS_SQL = `(CASE WHEN CAST((SELECT value FROM settings WHERE key = @minutesKey) AS INTEGER) BETWEEN 3 AND 60
             THEN CAST((SELECT value FROM settings WHERE key = @minutesKey) AS INTEGER) ELSE @minutesDefault END * 60 + @grace)`

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
      OR (p.expires_at IS NULL AND p.created_at <= strftime('%Y-%m-%d %H:%M:%f', @now, '-' || ${LIFETIME_SECONDS_SQL} || ' seconds'))
    )
    ORDER BY p.expires_at ASC, p.id ASC LIMIT @limit
  `).all<PaymentWithOrder>({
    expiredBefore: sqlTime(new Date(now.getTime() - EXPIRY_GRACE_SECONDS * 1000)), now: sqlTime(now).slice(0, 19), minutesKey: PAYMENT_MINUTES_KEY,
    minutesDefault: PAYMENT_MINUTES_DEFAULT, grace: EXPIRY_GRACE_SECONDS, limit,
  })
  return rows || []
}

/** Orders stuck in qr_failed (the payment never started, or was declined) for longer than a QR lives plus the grace. Oldest first, through the partial index. */
export async function findStaleQrFailed(db: D1Compat, now: Date, limit: number): Promise<Array<Pick<OrderRecord, 'id' | 'state' | 'revision'>>> {
  const rows = await db.prepare(`
    SELECT id, state, revision FROM online_orders INDEXED BY idx_online_orders_qr_failed
    WHERE state = 'qr_failed' AND updated_at <= strftime('%Y-%m-%d %H:%M:%f', @now, '-' || ${LIFETIME_SECONDS_SQL} || ' seconds')
    ORDER BY updated_at ASC LIMIT @limit
  `).all<Pick<OrderRecord, 'id' | 'state' | 'revision'>>({ now: sqlTime(now).slice(0, 19), minutesKey: PAYMENT_MINUTES_KEY, minutesDefault: PAYMENT_MINUTES_DEFAULT, grace: EXPIRY_GRACE_SECONDS, limit })
  return rows || []
}

/**
 * Payments worth asking about again whose QR is gone: EXPIRED (it ran out) or CANCELLED (an edit replaced it) with a QR that was issued, inside the plan's late-check window and not asked about for the plan's interval. Both conditions
 * read only the partial index's own columns, so an idle tick reads no row.
 */
export async function findLateCandidates(db: D1Compat, now: Date, env: OrderDeps['env'], limit: number): Promise<PaymentWithOrder[]> {
  const limits = getPlanLimits(env)
  const rows = await db.prepare(`
    SELECT p.*, o.state AS order_state
    FROM online_order_payments p INDEXED BY idx_online_order_payments_expired JOIN online_orders o ON o.id = p.order_id
    WHERE p.state IN ('expired','cancelled') AND p.qr_string IS NOT NULL AND p.expires_at >= @windowStart AND (p.last_checked_at IS NULL OR p.last_checked_at <= @recheckBefore)
    ORDER BY p.expires_at ASC, p.id ASC LIMIT @limit
  `).all<PaymentWithOrder>({
    windowStart: sqlTime(new Date(now.getTime() - limits.onlineOrderLateCheckHours * 3_600_000)),
    recheckBefore: sqlTime(new Date(now.getTime() - limits.onlineOrderLateCheckEveryMinutes * 60_000)), limit,
  })
  return rows || []
}

// ---- recovery after a maintenance hold ----------------------------------------------------------------------------------------------------
//
// While a restore (or any maintenance hold) is on, the cron skips its whole tick and the callback cannot land, so money paid during the hold is not seen by anyone.
// scheduled() leaves a marker in system_flags (never in settings: settings is restored over). The first sweep after the hold clears finds the marker and runs the
// late re-check ONCE over every payment that could still be paid (awaiting, expired or cancelled, with a QR that was issued, inside the plan's late window),
// ignoring the per-payment interval: it was asked about before the hold, and the hold is what made that answer stale. It is bounded by the tick's D1 budget and the
// batch size; what does not fit continues on the next ticks, and the marker is removed only when nothing is left, and only if no newer hold wrote it again meanwhile.
export const RECHECK_DUE_FLAG = 'online_orders_late_recheck_due'

/** Called by the cron when it skips a tick for maintenance. Never throws: a missing table or a failed write must not break the hold's own skip. */
export async function markLateRecheckDue(db: D1Compat, now: Date): Promise<void> {
  try {
    const at = sqlTime(now)
    await db.prepare(`INSERT INTO system_flags (key, value, updated_at) VALUES (@key, @at, @at) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run({ key: RECHECK_DUE_FLAG, at })
  } catch { /* the sweep falls back to its ordinary late re-check */ }
}

async function readRecheckDue(db: D1Compat): Promise<string | null> {
  try { return (await db.prepare('SELECT value FROM system_flags WHERE key = @key').get<{ value: string }>({ key: RECHECK_DUE_FLAG }))?.value ?? null } catch { return null }
}

/** Every payment that could still be paid and was last asked about at or before the hold's last skipped tick (a payment this recovery already asked about leaves the list). */
export async function findRecoveryCandidates(db: D1Compat, now: Date, env: OrderDeps['env'], since: string, limit: number): Promise<PaymentWithOrder[]> {
  const windowStart = sqlTime(new Date(now.getTime() - getPlanLimits(env).onlineOrderLateCheckHours * 3_600_000))
  const rows = await db.prepare(`
    SELECT * FROM (
      SELECT p.*, o.state AS order_state FROM online_order_payments p INDEXED BY idx_online_order_payments_expired JOIN online_orders o ON o.id = p.order_id
      WHERE p.state IN ('expired','cancelled') AND p.qr_string IS NOT NULL AND p.expires_at >= @windowStart AND (p.last_checked_at IS NULL OR p.last_checked_at <= @since)
      UNION ALL
      SELECT p.*, o.state AS order_state FROM online_order_payments p INDEXED BY idx_online_order_payments_open JOIN online_orders o ON o.id = p.order_id
      WHERE p.state = 'awaiting' AND p.qr_string IS NOT NULL AND p.expires_at >= @windowStart AND (p.last_checked_at IS NULL OR p.last_checked_at <= @since)
    ) ORDER BY expires_at ASC, id ASC LIMIT @limit
  `).all<PaymentWithOrder>({ windowStart, since, limit })
  return rows || []
}

/** Like claimCheck without the interval: one request wins the payment for this recovery pass. The claim is undone when PayWay could not be asked. */
async function claimRecovery(deps: OrderDeps, payment: Pick<PaymentRecord, 'id' | 'state' | 'last_checked_at'>, since: string): Promise<string | null> {
  const at = sqlTime(deps.now())
  const claim = await deps.db.prepare(`UPDATE online_order_payments SET last_checked_at = @at WHERE id = @pid AND state = @state AND (last_checked_at IS NULL OR last_checked_at <= @since)`)
    .run({ at, pid: payment.id, state: payment.state, since })
  return Number(claim.changes ?? 0) === 1 ? at : null
}
async function releaseRecovery(deps: OrderDeps, payment: Pick<PaymentRecord, 'id' | 'last_checked_at'>, at: string): Promise<void> {
  await deps.db.prepare('UPDATE online_order_payments SET last_checked_at = @old WHERE id = @pid AND last_checked_at = @at').run({ old: payment.last_checked_at, pid: payment.id, at })
}

/** Expire one payment that PayWay says was not paid. The order follows only when no other payment of it is still waiting (an edit may have issued a newer QR). */
async function expirePayment(deps: OrderDeps, payment: PaymentWithOrder): Promise<boolean> {
  const at = sqlTime(deps.now())
  const moved = `EXISTS (SELECT 1 FROM online_order_payments WHERE id = @pid AND state = 'expired' AND revision = @newRev)`
  const [result] = await deps.db.batch([
    // last_checked_at is stamped now: the sweep has just asked PayWay, so the late re-check starts its interval from here, not from "never".
    { sql: `UPDATE online_order_payments SET state = 'expired', last_checked_at = @at, revision = revision + 1, updated_at = @at WHERE id = @pid AND state = 'awaiting' AND revision = @rev`, params: { pid: payment.id, rev: payment.revision, newRev: payment.revision + 1, at } },
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

/** A qr_failed order past its time ends expired: nothing can be paid on it, and it must leave every "still open" count. */
async function expireQrFailed(deps: OrderDeps, order: Pick<OrderRecord, 'id' | 'revision'>): Promise<boolean> {
  const at = sqlTime(deps.now())
  const [result] = await deps.db.batch([
    {
      sql: `UPDATE online_orders SET state = 'expired', revision = revision + 1, updated_at = @at
            WHERE id = @oid AND state = 'qr_failed' AND revision = @rev AND NOT EXISTS (SELECT 1 FROM online_order_payments WHERE order_id = @oid AND state = 'awaiting')`,
      params: { oid: order.id, rev: order.revision, at },
    },
    {
      sql: `INSERT INTO online_order_events (order_id, event, from_state, to_state, source, detail_json, created_at)
            SELECT @oid, 'expired', 'qr_failed', 'expired', 'sweep', @detail, @at WHERE changes() = 1`,
      params: { oid: order.id, at, detail: JSON.stringify({ purpose: 'order', qr_issued: 0 }) },
    },
  ])
  return Number(result.meta?.changes ?? 0) === 1
}

/** What one notice costs the tick in D1 calls (version bump, settings read, the rows it names): an estimate of fixed code, measured by the lifecycle test. */
export const NOTICE_D1_CALLS = 6

/**
 * The tick's own D1 budget (planTier onlineOrderSweepMaxD1Calls): every statement the tick runs, and an estimate per notice it sends, is counted. When the budget is spent the
 * loops stop and the rest waits for the next tick, so one busy tick can never run into the invocation's 50-call limit (the same invocation also drains Telegram).
 */
function budgeted(deps: OrderDeps, limit: number): { deps: OrderDeps; spent: () => boolean } {
  let used = 0
  const db: D1Compat = {
    prepare(sql: string) {
      const statement = deps.db.prepare(sql)
      return {
        get: (...args: unknown[]) => { used += 1; return (statement.get as (...a: unknown[]) => Promise<unknown>)(...args) },
        all: (...args: unknown[]) => { used += 1; return (statement.all as (...a: unknown[]) => Promise<unknown>)(...args) },
        run: (...args: unknown[]) => { used += 1; return (statement.run as (...a: unknown[]) => Promise<unknown>)(...args) },
      }
    },
    batch: (items: Parameters<D1Compat["batch"]>[0]) => { used += 1; return deps.db.batch(items) },
  } as unknown as D1Compat
  const notify = deps.notify ? async (event: Parameters<NonNullable<OrderDeps['notify']>>[0]) => { used += NOTICE_D1_CALLS; await deps.notify!(event) } : undefined
  return { deps: { ...deps, db, ...(notify ? { notify } : {}) }, spent: () => used >= limit }
}

/** One cron tick. Without PayWay credentials nothing can be confirmed, so nothing is expired (a payment is never expired on a guess). */
export async function sweepOrders(deps: OrderDeps, creds: PaywayCredentials | null): Promise<SweepSummary> {
  const summary: SweepSummary = { checked: 0, paid: 0, review: 0, failed: 0, expired: [], skipped: 0, late: 0, qrFailedExpired: 0, deferred: false }
  if (!creds) return summary
  const batch = sweepBatchSize(deps.env)
  const { deps: counted, spent } = budgeted(deps, getPlanLimits(deps.env).onlineOrderSweepMaxD1Calls)
  const real = deps
  deps = counted
  const settle = (outcome: string) => {
    if (outcome === 'paid') summary.paid += 1
    else if (outcome === 'review') summary.review += 1
    else if (outcome === 'failed') summary.failed += 1
  }
  for (const payment of await findStalePayments(deps.db, deps.now(), batch)) {
    if (spent()) { summary.deferred = true; break }
    const check = await checkQuietly(deps, creds, payment.tran_id)
    summary.checked += 1
    // "Not found" is an answer: PayWay never saw this transaction (the QR was never issued). Any other failure is not, so the payment waits for the next tick.
    if (!check.ok && check.reason !== 'not_found') { summary.skipped += 1; continue }
    const outcome = check.ok ? await applyCheckResult(deps, { id: payment.order_id, state: payment.order_state }, payment, check, 'sweep', creds) : 'pending'
    settle(outcome)
    if (outcome === 'pending' && await expirePayment(deps, payment)) summary.expired.push({ orderId: payment.order_id, paymentId: payment.id, purpose: payment.purpose })
  }
  for (const order of await findStaleQrFailed(deps.db, deps.now(), batch)) {
    if (spent()) { summary.deferred = true; break }
    if (await expireQrFailed(deps, order)) { summary.qrFailedExpired += 1; summary.expired.push({ orderId: order.id, paymentId: 0, purpose: 'order' }) }
  }
  // Recovery after a maintenance hold: ask about every payment that could still be paid, once, whatever its interval (see the comment above RECHECK_DUE_FLAG).
  const remaining = Math.max(0, batch - summary.checked)
  const since = remaining > 0 ? await readRecheckDue(deps.db) : null
  if (since) {
    summary.recovery = true
    const candidates = await findRecoveryCandidates(deps.db, deps.now(), deps.env, since, remaining)
    let stopped = false
    for (const payment of candidates) {
      if (spent()) { summary.deferred = true; stopped = true; break }
      const claimedAt = await claimRecovery(deps, payment, since)
      if (!claimedAt) continue
      const check = await checkQuietly(deps, creds, payment.tran_id)
      summary.late += 1
      if (!check.ok) { summary.skipped += 1; await releaseRecovery(deps, payment, claimedAt); stopped = true; continue }
      settle(await applyCheckResult(deps, { id: payment.order_id, state: payment.order_state }, payment, check, 'sweep', creds))
    }
    // Done only when this pass saw the end of the list and every ask got an answer; otherwise the marker stays and the next tick continues.
    if (!stopped && candidates.length < remaining) {
      await deps.db.prepare('DELETE FROM system_flags WHERE key = @key AND value = @since').run({ key: RECHECK_DUE_FLAG, since })
      summary.recoveryDone = true
    }
  }
  // Late money: the remaining PayWay budget of this tick goes to expired payments, each at most once per plan interval.
  if (remaining > 0 && !since) {
    for (const payment of await findLateCandidates(deps.db, deps.now(), deps.env, remaining)) {
      if (spent()) { summary.deferred = true; break }
      if (!(await claimCheck(deps, payment))) continue
      const check = await checkQuietly(deps, creds, payment.tran_id)
      summary.late += 1
      if (!check.ok) { summary.skipped += 1; continue }
      settle(await applyCheckResult(deps, { id: payment.order_id, state: payment.order_state }, payment, check, 'sweep', creds))
    }
  }
  // One message for the whole tick, however many payments ran out: the owner reads a digest, not a burst.
  if (summary.expired.length) await announceOrderEvent(real, { kind: 'expired', expired: summary.expired })
  return summary
}

export type { OrderRecord }
