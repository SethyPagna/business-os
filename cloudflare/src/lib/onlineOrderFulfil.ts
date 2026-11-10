// Online orders (KHQR lane, slice S6a): Fulfil. One cashier action on a PAID order: the POS rings the sale (the lines may differ from the order: an item can be gone,
// there is no stock hold) and POST /api/sales carries `online_order_id`. This file holds the pieces routes/sales.ts adds to its ONE create batch; nothing here writes by
// itself, so the sale, its stock, the link and the order Records commit or roll back together.
//
//   * The sale is an ORDINARY sale (payments_version 0, lead ruling 10 Nov 2026): revenue on the sale date at Fulfil. The online money is part of its tender as the
//     KHQR method the owner configured (`online_order_payment_method`), equal to min(what the order took minus refund notes written before the sale, what the sale is worth). Whatever the order took beyond
//     that stays unrecorded and is refundable through ABA (lib/onlineOrders.ts orderMoney); lines added beyond it are the sale's normal Not Paid balance.
//   * The shift reader removes that online part by the order link (lib/shiftReconciliation.ts linkedOnlineMoney): no cashier took it.
//   * The KHQR method may appear on a sale ONLY through this path, so the method cannot be used to fake online money.
//   * Atomic: a guard statement ahead of the header aborts the whole batch when the order is no longer the paid, unlinked, same-revision order the cashier saw; the order
//     UPDATE after it is guarded again, so a lost race leaves NO sale and the loser reads order_changed.

import type { D1Compat } from './db'
import { roundMoney4, sumMoney4 } from './moneyPrecision'
import { readSwitch } from './readSwitches'
import type { Env } from '../index'

export const ONLINE_PAYMENT_METHOD_KEY = 'online_order_payment_method'
export const ONLINE_PAYMENT_METHOD_DEFAULT = 'ABA KHQR'

export type FulfilRefusal = { status: 403 | 404 | 409 | 400; code: string; error: string }
export type FulfilPaid = { id: number; amount: number }
export type FulfilPlan = {
  orderId: number
  revision: number
  orderNo: string
  method: string
  paid: FulfilPaid[]
  /** What the order took in dollars (the paid payments). */
  onlineUsd: number
  /** What is still the shop's to put on a sale: onlineUsd minus the refund notes written before it. */
  availableUsd: number
  /** The refund notes the plan was priced against; the batch refuses when another note landed since. */
  notedUsd: number
  /** What goes onto the sale as the KHQR tender: min(availableUsd, the sale's payable). */
  coverUsd: number
  /** One entry per paid payment: how much of it the sale covers (allocated in payment id order). */
  recorded: Array<{ paymentId: number; amountUsd: number }>
}

export const sameMethod = (a: unknown, b: unknown): boolean => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()

export function configuredOnlineMethod(settingValue: unknown): string {
  const text = String(settingValue ?? '').trim()
  return text || ONLINE_PAYMENT_METHOD_DEFAULT
}

/**
 * Review F1 (10 Nov 2026): the "KHQR method only through Fulfil" refusal on plain sales, settlements and relabels applies only once online ordering is set up: the
 * owner has stored `online_order_payment_method`, or the `online_orders` switch is ON. Before that, a till that already spells a method "ABA KHQR" keeps working.
 * The linked-sale locks (`linked_sale_money_locked`) are NOT behind this: a linked sale exists only after a Fulfil. The switch is read only when the setting is absent.
 */
export async function onlineMethodRefusalActive(env: Env, storedSetting: unknown): Promise<boolean> {
  if (String(storedSetting ?? '').trim() !== '') return true
  return readSwitch(env, 'online_orders')
}

/**
 * onlineMethodRefusalActive as a predicate over the stored rows, for a batch that must refuse without a read of its own: true when `@reservedMethodKey` (lower-cased, trimmed) is the
 * method a Fulfil rings and the refusal is in force (a method is stored, or the online_orders switch is ON).
 */
export const ONLINE_METHOD_RESERVED_PREDICATE = `(lower(trim(COALESCE(NULLIF(trim((SELECT value FROM settings WHERE key = '${ONLINE_PAYMENT_METHOD_KEY}')), ''), '${ONLINE_PAYMENT_METHOD_DEFAULT}'))) = @reservedMethodKey
    AND (trim(COALESCE((SELECT value FROM settings WHERE key = '${ONLINE_PAYMENT_METHOD_KEY}'), '')) <> ''
      OR (SELECT CASE WHEN json_valid(value) THEN json_extract(value, '$.switches.online_orders') END FROM system_flags WHERE key = 'read_switches') = 'on'))`

/** Settings key the Worker publishes (never stores): the method name the till must not offer on an ordinary sale, '' while the refusal is not in force. */
export const ONLINE_METHOD_IN_FORCE_KEY = 'online_order_method_in_force'

/** The ONE rule for which method is reserved: the refusal's own test (onlineMethodRefusalActive) decides, the name is the one a Fulfil rings (configuredOnlineMethod). */
export async function withOnlineMethodInForce<T extends Record<string, string | null>>(env: Env, settings: T): Promise<T & Record<typeof ONLINE_METHOD_IN_FORCE_KEY, string>> {
  const stored = settings[ONLINE_PAYMENT_METHOD_KEY]
  return { ...settings, [ONLINE_METHOD_IN_FORCE_KEY]: (await onlineMethodRefusalActive(env, stored)) ? configuredOnlineMethod(stored) : '' }
}

/** The dollars of a tender that name `method`, and whether any row does. */
export function onlineTender(details: ReadonlyArray<{ method: string; amount_usd: number; amount_khr: number }>, method: string): { usd: number; khr: number; present: boolean } {
  const rows = details.filter((detail) => sameMethod(detail.method, method))
  return { usd: sumMoney4(rows.map((row) => row.amount_usd)), khr: rows.reduce((sum, row) => sum + row.amount_khr, 0), present: rows.length > 0 }
}

type OrderForFulfil = { id: number; order_no: string; state: string; sale_id: number | null; revision: number; branch_id: number | null; paid_json: string | null; has_review?: number | null; refund_noted_usd?: number | null; branch_successor_id?: number | null }

/** One statement: the order and its paid payments. The only read Fulfil adds to a sale create. */
export async function loadFulfilOrder(db: D1Compat, orderId: number): Promise<OrderForFulfil | null> {
  const row = await db.prepare(`
    SELECT o.id, o.order_no, o.state, o.sale_id, o.revision, o.branch_id,
      (SELECT json_group_array(json_object('id', p.id, 'amount', COALESCE(p.paid_amount, p.amount), 'currency', COALESCE(p.paid_currency, p.currency)))
         FROM (SELECT * FROM online_order_payments WHERE order_id = o.id AND state = 'paid' ORDER BY id) p) AS paid_json,
      EXISTS (SELECT 1 FROM online_order_payments WHERE order_id = o.id AND state = 'review') AS has_review,
      (SELECT COALESCE(SUM(amount_usd), 0) FROM online_order_events WHERE order_id = o.id AND event = 'refund_noted' AND sale_id IS NULL) AS refund_noted_usd,
      (SELECT successor_branch_id FROM branches WHERE id = o.branch_id) AS branch_successor_id
    FROM online_orders o WHERE o.id = @id
  `).get<OrderForFulfil>({ id: orderId })
  return row ?? null
}

const refuse = (status: FulfilRefusal['status'], code: string, error: string): FulfilRefusal => ({ status, code, error })

/**
 * Judge a Fulfil against the sale about to be written. `payableUsd` is the sale's total, `details` its tender rows, `branchId` the sale's branch.
 * Order of refusals: unknown, wrong state (each state its own word), wrong branch, currency, then the tender must be exactly the cover.
 */
export function planFulfil(
  order: OrderForFulfil | null, input: { method: string; details: ReadonlyArray<{ method: string; amount_usd: number; amount_khr: number }>; payableUsd: number; branchId: number | null },
): { ok: true; plan: FulfilPlan } | { ok: false; refusal: FulfilRefusal } {
  if (!order) return { ok: false, refusal: refuse(404, 'order_not_found', 'That online order was not found.') }
  if (order.state === 'fulfilled' || order.sale_id != null) return { ok: false, refusal: refuse(409, 'order_already_fulfilled', 'This online order already has a sale.') }
  // Review F4: a payment held in review (a sibling QR paid after the order was paid, or after a cancel) keeps the order out of Fulfil, so its money cannot vanish into a sale.
  if (order.state === 'review' || Number(order.has_review) === 1) return { ok: false, refusal: refuse(409, 'order_in_review', 'This order has a payment that needs a look first. Resolve it, then fulfil the order.') }
  if (order.state !== 'paid') return { ok: false, refusal: refuse(409, 'order_not_paid', 'Only a paid online order can be fulfilled.') }
  // Review F10: a branch cutover leaves the order on the retired branch; its recorded successor is the same shop, so the till there may fulfil it.
  const sameShop = Number(order.branch_id) === Number(input.branchId) || (order.branch_successor_id != null && Number(order.branch_successor_id) === Number(input.branchId))
  if (order.branch_id != null && input.branchId != null && !sameShop) {
    return { ok: false, refusal: refuse(409, 'order_other_branch', 'This order belongs to another branch.') }
  }
  let paid: Array<{ id: number; amount: number; currency?: string }> = []
  try { paid = JSON.parse(order.paid_json || '[]') } catch { paid = [] }
  if (!paid.length) return { ok: false, refusal: refuse(409, 'order_not_paid', 'Only a paid online order can be fulfilled.') }
  if (paid.some((p) => String(p.currency || 'USD') !== 'USD')) return { ok: false, refusal: refuse(409, 'online_currency_unsupported', 'This order was paid in a currency that cannot be fulfilled here yet.') }
  const onlineUsd = sumMoney4(paid.map((p) => Number(p.amount) || 0))
  const notedUsd = roundMoney4(Number(order.refund_noted_usd) || 0)
  const availableUsd = Math.max(0, roundMoney4(onlineUsd - notedUsd))
  const coverUsd = Math.min(availableUsd, roundMoney4(input.payableUsd))
  const tender = onlineTender(input.details, input.method)
  if (Math.abs(tender.usd - coverUsd) > 0.005 || tender.khr !== 0) {
    return { ok: false, refusal: refuse(409, 'online_tender_mismatch', `The ${input.method} part of the payment must be exactly $${coverUsd.toFixed(2)}, the part of the online payment this sale covers.`) }
  }
  let left = coverUsd
  const recorded = paid.map((p) => {
    const amount = Math.min(Number(p.amount) || 0, left)
    left = roundMoney4(left - amount)
    return { paymentId: Number(p.id), amountUsd: roundMoney4(amount) }
  })
  return { ok: true, plan: { orderId: Number(order.id), revision: Number(order.revision), orderNo: order.order_no, method: input.method, paid: paid.map((p) => ({ id: Number(p.id), amount: Number(p.amount) || 0 })), onlineUsd, availableUsd, notedUsd, coverUsd, recorded } }
}

type Statement = { sql: string; params: Record<string, unknown> }

/** There is deliberately NO separate guard before the header: D1 rolls the whole batch back on the first failing statement, and the verification SELECT after the UPDATE below fails it when the order moved. */
/**
 * After the header and the lines: link the order and write its Records. Everything keys on the sale's write key, like the batch's other follow-ups, and every row is
 * guarded by the order being linked to THIS sale, so a replayed batch adds nothing twice (the unique index on payment_recorded_on_sale backs that up).
 */
export function fulfilStatements(plan: FulfilPlan, input: { saleWriteKey: string; userId: number | null; userName: string | null; at: string }): Statement[] {
  const sale = `(SELECT id FROM sales WHERE client_request_id = @key AND client_request_id <> '')`
  const linked = `EXISTS (SELECT 1 FROM online_orders WHERE id = @oid AND sale_id = ${sale} AND state = 'fulfilled')`
  const base = { oid: plan.orderId, key: input.saleWriteKey, uid: input.userId, uname: input.userName, at: input.at }
  return [
    {
      sql: `UPDATE online_orders SET state = 'fulfilled', sale_id = ${sale}, revision = revision + 1, updated_at = @at
            WHERE id = @oid AND state = 'paid' AND sale_id IS NULL AND revision = @rev
              AND (SELECT COALESCE(SUM(CAST(ROUND(amount_usd * 100) AS INTEGER)), 0) FROM online_order_events WHERE order_id = @oid AND event = 'refund_noted') = @notedCents`,
      params: { ...base, rev: plan.revision, notedCents: Math.round(plan.notedUsd * 100) },
    },
    // The unchanged-rows check: a header that was not written, or an order that moved, must not look like a Fulfil.
    {
      sql: `SELECT CASE WHEN ${linked} THEN 1 ELSE json_extract('online_order_conflict', '$') END`,
      params: { oid: plan.orderId, key: input.saleWriteKey },
    },
    ...plan.recorded.map((entry) => ({
      sql: `INSERT INTO online_order_events (order_id, payment_id, event, from_state, to_state, source, actor_id, actor_name, amount_usd, sale_id, created_at)
            SELECT @oid, @pid, 'payment_recorded_on_sale', 'paid', 'fulfilled', 'staff', @uid, @uname, @amount, ${sale}, @at
            WHERE ${linked} AND NOT EXISTS (SELECT 1 FROM online_order_events WHERE payment_id = @pid AND event = 'payment_recorded_on_sale')`,
      params: { ...base, pid: entry.paymentId, amount: entry.amountUsd },
    })),
    {
      sql: `INSERT INTO online_order_events (order_id, event, from_state, to_state, source, actor_id, actor_name, amount_usd, sale_id, detail_json, created_at)
            SELECT @oid, 'fulfilled', 'paid', 'fulfilled', 'staff', @uid, @uname, @cover, ${sale}, @detail, @at
            WHERE ${linked} AND NOT EXISTS (SELECT 1 FROM online_order_events WHERE order_id = @oid AND event = 'fulfilled')`,
      params: { ...base, cover: plan.coverUsd, detail: JSON.stringify({ online_usd: plan.onlineUsd, covered_usd: plan.coverUsd }) },
    },
  ]
}

/** Which of these sales fulfilled an online order (their KHQR money is locked: it changes only through the order's own flows). Fails open where the tables do not exist. */
export async function linkedOnlineSaleIds(db: D1Compat, saleIds: readonly number[]): Promise<Set<number>> {
  const ids = [...new Set(saleIds.filter((id) => Number.isSafeInteger(id) && id > 0))]
  if (!ids.length || ids.length > 100) return new Set()
  try {
    // sql-bound-params: bounded by the guard above (at most 100 ids).
    const rows = await db.prepare(`SELECT sale_id FROM online_orders WHERE sale_id IN (${ids.map(() => '?').join(',')})`).all<{ sale_id: number }>(ids)
    return new Set((rows || []).map((row) => Number(row.sale_id)))
  } catch { return new Set() }
}

export const ONLINE_METHOD_REQUIRES_ORDER_CODE = 'online_method_requires_order'
export const LINKED_SALE_MONEY_LOCKED_CODE = 'linked_sale_money_locked'
