/**
 * Money received in one business day, by the day it was RECEIVED -- the figure behind the Telegram day
 * summary's `=====Received=====` section (owner, 27 Oct 2026: the summary reports the day's real figures,
 * consistent with the in-app reports; payments are dated when received, not when the sale was made).
 *
 * The in-app drawer already reads money this way for a SHIFT window (shiftReconciliation.shiftCashSales):
 *   * payments_version 0 sales: their tender belongs to sales.created_at (old sales stay as they are);
 *   * payments_version 1 sales: sale_payment_events by received_at -- a later collect, a correction (out of
 *     the old tender, in of the new, dated when made) and an undo land in the day that took them.
 * This is the same rule over a business day (UTC+7) instead of a shift window, through the same readers
 * (tenderWhere, summarizeShiftCashEvents), so the day is the sum of its shifts. Refunds are the cash handed
 * back, dated by returns.created_at (shiftRefunds' rule), and shown beside the money in, never subtracted from it.
 *
 * Why not call shiftCashSales with a day-long "shift": its version 0 half wraps created_at in datetime(),
 * which no index serves, so it would read the whole sales table. Here every read is a range on an index:
 *   sales          localDateRangeClause -> idx_sales_created_pg
 *   events         received_at range    -> idx_sale_payment_events_received
 *   returns        localDateRangeClause -> idx_returns_created_pg
 * (the Free plan counts rows read; test-telegram-received-day-pure.cjs pins the plans with EXPLAIN QUERY PLAN).
 *
 * Duplicated on purpose, because shiftReconciliation.ts is not this lane's file: the event row mapping of
 * shiftPaymentEventRows and the settings read of readCashConfig. Fold into shiftReconciliation when it is free.
 */
import { getDb } from './db'
import { BUSINESS_UTC_OFFSET_MINUTES, localDateRangeClause } from './businessDateWindow'
import { shiftWindowBound, whereActiveSales } from './salesAnalytics'
import { parseConfiguredMethods, parsePaymentMethodKinds, PAYMENT_METHOD_KINDS_SETTING } from './paymentMethodRegistry'
import {
  refundDrawerKhrSql, refundDrawerUsdSql, SHIFT_REVIEW, summarizeShiftCashEvents, tenderWhere,
  type ShiftCashOptions, type ShiftCashResult, type ShiftMoney,
} from './shiftReconciliation'
import type { Env } from '../index'

export type DayPaymentsReceived = {
  /** Cash net of change (usd/khr) and every other kind of tender (digital), received inside the day. */
  received: ShiftCashResult
  /** Cash refunds handed back inside the day (the drawer share of the day's customer returns). */
  refunded: ShiftMoney
}

const EVENT_LIMIT = 5000
const DAY_MS = 86_400_000

type EventRow = {
  id: number; sale_id: number; direction: string; drawer_effect: number; payment_method: string; payment_details: string
  amount_paid_usd: number; amount_paid_khr: number; change_usd: number; change_khr: number; change_is_actual: number
  change_exchange_rate: number | null; exchange_rate: number; sale_status: string | null; total_usd: number | null
}

const round2 = (value: number): number => Math.round(value * 100) / 100

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

/** The business day `date` (YYYY-MM-DD, UTC+7) as the half-open UTC window [from, to) in the shape received_at is stored. */
function businessDayWindow(date: string): { from: string; to: string } {
  const start = Date.parse(`${date}T00:00:00.000Z`) - BUSINESS_UTC_OFFSET_MINUTES * 60_000
  return { from: shiftWindowBound(new Date(start).toISOString()) as string, to: shiftWindowBound(new Date(start + DAY_MS).toISOString()) as string }
}

/**
 * What the shop took (and handed back) on one business day, on one branch or on all of them (`branch_id` null).
 * Every figure is read for the day alone: a sale rung yesterday and paid today is in today, a sale rung today
 * and paid tomorrow is in tomorrow, and a cancelled sale is in neither.
 */
export async function dayPaymentsReceived(
  env: Env,
  day: { business_date: string; branch_id: number | null },
): Promise<DayPaymentsReceived> {
  const db = getDb(env)
  const branchId = day.branch_id ?? null
  const window = businessDayWindow(day.business_date)
  const sold = whereActiveSales('sales', { startDate: day.business_date, endDate: day.business_date, branchId })
  const eventParams: Record<string, unknown> = { from: window.from, to: window.to }
  if (branchId != null) eventParams.branchId = branchId
  const refundParams: Record<string, unknown> = { startDate: day.business_date, endDate: day.business_date }
  if (branchId != null) refundParams.branchId = branchId

  const options = readCashConfig(env)
  const [created, eventRows, refunds] = await Promise.all([
    options.then((config) => tenderWhere(env, [sold.sql, 'sales.payments_version = 0'], sold.params, config)),
    // The events drive the read (CROSS JOIN fixes the order): the received_at index is the access path, sales a primary-key lookup.
    db.prepare(`SELECT e.id, e.sale_id, e.direction, e.drawer_effect, e.payment_method, e.payment_details, e.amount_paid_usd, e.amount_paid_khr,
        e.change_usd, e.change_khr, e.change_is_actual, e.change_exchange_rate, e.exchange_rate, sales.sale_status, sales.total_usd
      FROM sale_payment_events e CROSS JOIN sales ON sales.id = e.sale_id
      WHERE sales.payments_version = 1 AND (e.drawer_effect = 1 OR e.origin = 'opening')
        AND e.received_at >= @from AND e.received_at < @to${branchId != null ? ' AND e.branch_id = @branchId' : ''}
        AND COALESCE(NULLIF(sales.sale_status, ''), 'completed') <> 'cancelled'
      LIMIT ${EVENT_LIMIT + 1}`).all<EventRow>(eventParams),
    db.prepare(`SELECT COALESCE(SUM(${refundDrawerUsdSql('returns')}), 0) AS usd, COALESCE(SUM(${refundDrawerKhrSql('returns')}), 0) AS khr
      FROM returns
      WHERE ${localDateRangeClause('returns.created_at')}${branchId != null ? ' AND returns.branch_id = @branchId' : ''}
        AND COALESCE(returns.status, 'completed') <> 'cancelled' AND COALESCE(returns.return_scope, 'customer') = 'customer'`)
      .get<{ usd: number; khr: number }>(refundParams),
  ])
  const refunded = { usd: round2(Number(refunds?.usd) || 0), khr: Math.round(Number(refunds?.khr) || 0) }
  // No version 1 money in the day: the version 0 answer, untouched.
  if (!eventRows.length) return { received: created, refunded }

  // An opening event written outside the drawer reads as no payment_details (it counts nothing and raises the tender review code);
  // the sale total only means something against money that came in.
  const config = await options
  const events = summarizeShiftCashEvents(eventRows.slice(0, EVENT_LIMIT).map((row) => ({
    ...row,
    payment_details: Number(row.drawer_effect) === 0 ? '' : row.payment_details,
    total_usd: row.direction === 'out' ? undefined : row.total_usd,
  })), config)
  const codes = [...new Set([...created.reviewCodes, ...events.reviewCodes, ...(eventRows.length > EVENT_LIMIT ? [SHIFT_REVIEW.limit] : [])])].sort()
  return {
    received: {
      usd: round2(created.usd + events.usd), khr: Math.round(created.khr + events.khr),
      digital: { usd: round2(created.digital.usd + events.digital.usd), khr: Math.round(created.digital.khr + events.digital.khr) },
      needsReview: codes.length > 0, reviewCodes: codes,
    },
    refunded,
  }
}
