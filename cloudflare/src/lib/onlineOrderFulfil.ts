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
import { peekReadSwitch, readSwitch } from './readSwitches'
import type { Env } from '../index'
import { effectiveOnlineMethod, methodFold, namesOnlineMethod, ONLINE_METHOD_DEFAULT, ONLINE_METHOD_REQUIRES_ORDER_CODE, ONLINE_METHOD_SALE_GUARD_SQL, ONLINE_METHOD_SETTING_KEY, ONLINE_ORDERS_SWITCH_ON_SQL, onlineMethodRestateGuard, onlineMethodSaleGuard, onlineMethodSaleGuardOutcome } from './onlineMethodInvariant'

export const ONLINE_PAYMENT_METHOD_KEY = ONLINE_METHOD_SETTING_KEY
export const ONLINE_PAYMENT_METHOD_DEFAULT = ONLINE_METHOD_DEFAULT

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

// The fold itself lives in lib/onlineMethodInvariant.ts, the one module of the online-method invariant; re-exported here for the callers that always imported it from this file.
export { methodFold, namesOnlineMethod, ONLINE_METHOD_REQUIRES_ORDER_CODE, ONLINE_METHOD_SALE_GUARD_SQL, ONLINE_ORDERS_SWITCH_ON_SQL, onlineMethodRestateGuard, onlineMethodSaleGuard, onlineMethodSaleGuardOutcome }

export const sameMethod = (a: unknown, b: unknown): boolean => methodFold(a) === methodFold(b)

/**
 * KHQR round 9 (F1): the method that is RESERVED right now (effectiveOnlineMethod): the stored one, or the default while online_orders is ON and nothing is stored; '' when no
 * refusal is in force. The switch is read only when nothing is stored (the same read onlineMethodRefusalActive makes), so a sale with a stored method costs no extra call.
 */
export async function reservedOnlineMethod(env: Env, storedSetting: unknown): Promise<string> {
  const stored = String(storedSetting ?? '').trim()
  return stored ? effectiveOnlineMethod(stored, false) : effectiveOnlineMethod('', await readSwitch(env, 'online_orders'))
}

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

/** True when a non-empty online method is stored: the precondition of turning online_orders ON, written inside the flip's own statement. */
export const ONLINE_METHOD_STORED_SQL = `EXISTS (SELECT 1 FROM settings WHERE key = '${ONLINE_PAYMENT_METHOD_KEY}' AND trim(COALESCE(value, '')) <> '')`


/** A batch statement that aborts the whole batch while a method is stored and online_orders is ON, so the method cannot be cleared under a switch flipped elsewhere. */
export const CLEAR_ONLINE_METHOD_GUARD_SQL = `SELECT CASE WHEN trim(COALESCE((SELECT value FROM settings WHERE key = '${ONLINE_PAYMENT_METHOD_KEY}'), '')) <> '' AND ${ONLINE_ORDERS_SWITCH_ON_SQL} THEN json_extract('[1]', '$[online_method_required]') ELSE 1 END`

/**
 * Guard statement for storing a NEW online method (KHQR round 7, N1): aborts the batch when one of the most recent `@windowRows` sales (idx_sales_created_pg, no scan) is an ORDINARY
 * sale (not linked from online_orders.sale_id, idx_online_orders_sale) that used `@methodKey` (lower(trim)) as its payment_method or in a payment_details row. Such a method would
 * be hidden and refused at the till the moment it is stored. Older sales are deliberately not read: the bound is plan-tier `onlineMethodSalesWindow`.
 */
export const ONLINE_METHOD_IN_USE_CODE = 'online_method_in_use_by_sales'
export const ONLINE_METHOD_IN_USE_GUARD_SQL = `SELECT CASE WHEN EXISTS (
  SELECT 1 FROM (SELECT id, payment_method, payment_details FROM sales ORDER BY created_at DESC, id DESC LIMIT @windowRows) recent
  WHERE (lower(trim(COALESCE(recent.payment_method, ''))) = @methodKey
      OR (json_valid(recent.payment_details) AND EXISTS (SELECT 1 FROM json_each(recent.payment_details) d WHERE lower(trim(COALESCE(json_extract(d.value, '$.method'), ''))) = @methodKey)))
    AND NOT EXISTS (SELECT 1 FROM online_orders o WHERE o.sale_id = recent.id)
) THEN json_extract('[1]', '$[${ONLINE_METHOD_IN_USE_CODE}]') ELSE 1 END`

/**
 * KHQR round 10 (G4): the in-use check for the spellings the SQL guard above cannot decide (it folds ASCII only and compares a whole name): the rows of the same latest-`windowRows`
 * window whose method text has a non-ASCII character, a backslash (an escaped tab or newline in the JSON), or a '+' (a combined label), judged with the shared identity
 * (namesOnlineMethod: `ÉPay` finds `épay`, `Bakong` finds `Cash + Bakong`). One bounded read, made only when an administrator STORES or renames onto a new method; a plain ASCII
 * name is decided by ONLINE_METHOD_IN_USE_GUARD_SQL inside the write's own batch (so this read is a read-time check for the other spellings: a sale written in the milliseconds between
 * this read and the batch is the accepted gap, and the sale-side guards refuse such a sale anyway). Fulfilled online sales (linked from online_orders) are exempt, as in the SQL guard.
 */
export async function onlineMethodUsedByOrdinarySales(db: D1Compat, method: string, windowRows: number): Promise<boolean> {
  const rows = await db.prepare(`
    SELECT recent.payment_method, recent.payment_details
    FROM (SELECT id, payment_method, payment_details FROM sales ORDER BY created_at DESC, id DESC LIMIT @windowRows) recent
    WHERE (COALESCE(recent.payment_method, '') GLOB '*[^ -~]*' OR instr(COALESCE(recent.payment_method, ''), '+') > 0
        OR COALESCE(recent.payment_details, '') GLOB '*[^ -~]*' OR instr(COALESCE(recent.payment_details, ''), '+') > 0 OR instr(COALESCE(recent.payment_details, ''), char(92)) > 0)
      AND NOT EXISTS (SELECT 1 FROM online_orders o WHERE o.sale_id = recent.id)`).all<{ payment_method: string | null; payment_details: string | null }>({ windowRows })
  return rows.some((row) => {
    if (namesOnlineMethod(method, row.payment_method)) return true
    let details: unknown = []
    try { details = row.payment_details ? JSON.parse(row.payment_details) : [] } catch { details = [] }
    return Array.isArray(details) && details.some((detail) => namesOnlineMethod(method, (detail as { method?: unknown } | null)?.method))
  })
}

/** onlineMethodRefusalActive with the switch read from D1 now, not from the memo: for an error path that must name the real reason (a refusal that lost to a write inside the memo window would otherwise read as a conflict). */
export async function onlineMethodRefusalActiveFresh(db: D1Compat, storedSetting: unknown): Promise<boolean> {
  if (String(storedSetting ?? '').trim() !== '') return true
  const row = await db.prepare(`SELECT ${ONLINE_ORDERS_SWITCH_ON_SQL} AS on_now`).get<{ on_now: number | null }>()
  return Number(row?.on_now) === 1
}

/**
 * onlineMethodRefusalActive as a predicate over the stored rows, for a batch that must refuse without a read of its own: true when `@reservedMethodKey` (lower-cased, trimmed) is the
 * method a Fulfil rings and the refusal is in force (a method is stored, or the online_orders switch is ON).
 */
export const ONLINE_METHOD_RESERVED_PREDICATE = `(lower(trim(COALESCE(NULLIF(trim((SELECT value FROM settings WHERE key = '${ONLINE_PAYMENT_METHOD_KEY}')), ''), '${ONLINE_PAYMENT_METHOD_DEFAULT}'))) = @reservedMethodKey
    AND (trim(COALESCE((SELECT value FROM settings WHERE key = '${ONLINE_PAYMENT_METHOD_KEY}'), '')) <> ''
      OR ${ONLINE_ORDERS_SWITCH_ON_SQL}))`

/** Settings key the Worker publishes (never stores): the method name the till must not offer on an ordinary sale, '' while the refusal is not in force. */
export const ONLINE_METHOD_IN_FORCE_KEY = 'online_order_method_in_force'

/**
 * The ONE rule for which method is reserved: a stored method, or the online_orders switch ON, and the name is the one a Fulfil rings (configuredOnlineMethod). It only labels a screen,
 * so it reads no database: the switch is the isolate's last-seen value (a stored method is what puts a method in force in practice, and ON cannot be reached without one).
 * Every refusal that enforces the rule uses onlineMethodRefusalActive or the batch predicate, not this.
 */
export function withOnlineMethodInForce<T extends Record<string, string | null>>(settings: T): T & Record<typeof ONLINE_METHOD_IN_FORCE_KEY, string> {
  const stored = settings[ONLINE_PAYMENT_METHOD_KEY]
  const active = String(stored ?? '').trim() !== '' || peekReadSwitch('online_orders')
  return { ...settings, [ONLINE_METHOD_IN_FORCE_KEY]: active ? configuredOnlineMethod(stored) : '' }
}

/** The dollars of a tender that name `method`, and whether any row does. */
export function onlineTender(details: ReadonlyArray<{ method: string; amount_usd: number; amount_khr: number }>, method: string): { usd: number; khr: number; present: boolean } {
  // The ONE identity (namesOnlineMethod): the fold the settlement planner stores a row under, so no spelling that settles as the online method passes as another.
  const rows = details.filter((detail) => namesOnlineMethod(method, detail.method))
  return { usd: sumMoney4(rows.map((row) => row.amount_usd)), khr: rows.reduce((sum, row) => sum + row.amount_khr, 0), present: rows.length > 0 }
}

/** The two payment fields a replay judges (a settlement state or a bulk-relabel member state both carry them). */
export type PaymentStateLike = { payment_method?: unknown; payment_details?: unknown }

export function stateOnlineTender(state: PaymentStateLike, method: string): { usd: number; khr: number } {
  let rows: unknown = []
  try { rows = state.payment_details ? JSON.parse(String(state.payment_details)) : [] } catch { rows = [] }
  const details = (Array.isArray(rows) ? rows : []).map((row) => ({ method: String((row as { method?: unknown } | null)?.method ?? ''), amount_usd: Number((row as { amount_usd?: unknown } | null)?.amount_usd) || 0, amount_khr: Number((row as { amount_khr?: unknown } | null)?.amount_khr) || 0 }))
  // KHQR round 11 (H3): a state with NO readable payment rows (an imported sale: payment_details NULL) records its method only in the payment_method summary. The summary then stands as one
  // row (judged by its components, a presence weight of 1 each side), so an undo can never put the online method back on such a sale.
  if (!details.length && String(state.payment_method ?? '').trim()) return onlineTender([{ method: String(state.payment_method), amount_usd: 1, amount_khr: 0 }], method)
  return onlineTender(details, method)
}

/** KHQR round 13 (K1): the ONE "never add" amount rule shared by the settlement and bulk-relabel replays: writing the first over the second may not leave more online-method money (USD or KHR) than the sale holds now. */
export function replayAddsOnlineTender(written: PaymentStateLike, carried: PaymentStateLike, method: string): boolean {
  const adds = stateOnlineTender(written, method)
  const holds = stateOnlineTender(carried, method)
  return adds.usd > holds.usd + 0.00005 || adds.khr > holds.khr
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

export const LINKED_SALE_MONEY_LOCKED_CODE = 'linked_sale_money_locked'
