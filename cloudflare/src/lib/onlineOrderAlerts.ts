// Online orders (KHQR lane, slice S4): the Telegram notices the shop gets about the storefront's paid-online orders.
//
//   created   a customer placed an order and is looking at the QR             (sub-switch `new`)
//   paid      ABA confirmed the money; a top-up payment says which change it was for  (`new`)
//   review    ABA's answer did not match what we asked for: a person must look        (`new`)
//   expired   ONE digest per sweep tick of the orders nobody paid in time             (`expired`)
//   request   the customer asked to change, cancel or return a paid order             (`requests`)
//   withdrawn / edited / cancelled   the customer took a request back, changed a waiting order, or cancelled it  (`requests`)
//   qr_failed the payment could not be started and the customer is stuck                (`new`)
//   unknown_payment  ABA reported a payment for a transaction this shop has no record of (after a restore: money with no order)  (`new`)
// A QR re-issue ('changed') and a staff action with nothing to tell ('staff': a note, a resolved review) are announced to the screens only: no message. A declined check ('failed') also tells the chat: the customer's attempt to pay was refused by the bank.
// Staff decisions, applied changes and refund notes (S5) are messages in the `requests` family.
//
// Every committed event also bumps the `online_orders` data version and broadcasts, whatever the Telegram switches say: staff screens must refresh
// even when nobody wants the messages.
//
// The whole family sits behind the `online_orders` category and its own sub-switches (all unset = on), and goes to the Orders topic, or the Sales
// topic until one is set. A notice is built from the committed rows AFTER the write (OrderDeps.notify, called once per guarded transition by
// lib/onlineOrderStore.ts), so a replayed check, a lost race or a refusal never sends one. The customer's FULL phone number is shown (owner ruling 10 Nov 2026, replacing the earlier masked decision; one constant below), the customer's own words are
// cut short, and no token, tran id or PayWay field ever appears: this chat is read by staff, not by the customer.
//
// Never throws: a missing chat id, a Telegram outage or a vanished row costs the notice and nothing else.

import type { D1Compat } from './db'
import { getDb } from './db'
import { maskPhone } from './phoneMask'
import { sendTelegramEventWhenOn, type TelegramEvent, type TelegramOnlineOrderSub } from './telegram'
import { firstCharacters } from './telegramLang'
import { deferRequestWork } from './requestDefer'
import { bumpVersions } from './cache'
import { broadcast } from '../durable-objects/broadcastHub'
import { runBackground } from './requestMetrics'
import { getPlanLimits } from './planTier'
import type { OrderAlertEvent, OrderRecord, PaymentRecord, RequestRecord } from './onlineOrderStore'
import type { Env } from '../index'

type Composed = Omit<TelegramEvent, 'type'>

/** Owner ruling 10 Nov 2026 ("Show full phone"): staff alerts carry the whole phone number so staff can call the customer. Nothing else about the customer (address, social handles, note) is ever in an alert. */
export const ALERT_SHOWS_FULL_PHONE = true

const MAX_DIGEST_ROWS = 8
const COMMENT_CHARACTERS = 120

/** What each REQUEST_KINDS word reads as in the notice. The wording lives in telegramLang's VALUE_PHRASES (English and Khmer together). */
export const REQUEST_KIND_WORDS: Record<string, string> = {
  items: 'Change items', fulfilment: 'Change pickup or delivery', address: 'Change address', contact: 'Change contact', note: 'Change note',
  cancel: 'Cancel order', return: 'Return items',
}

const money = (value: unknown): string => `$${(Math.round((Number(value) || 0) * 100) / 100).toFixed(2)}`

function itemCount(order: Pick<OrderRecord, 'items_json'>): number {
  try {
    const lines = JSON.parse(order.items_json) as Array<{ quantity?: unknown }>
    return Array.isArray(lines) ? lines.reduce((sum, line) => sum + (Number(line?.quantity) || 0), 0) : 0
  } catch { return 0 }
}

/** The rows every single-order notice opens with: which order, who, how it is collected. The phone follows ALERT_SHOWS_FULL_PHONE, decided here and not by the caller. */
function orderRows(order: OrderRecord): string[] {
  const rows = [`Order: ${order.order_no}`, `Customer: ${firstCharacters(order.customer_name, 60)}`]
  const phone = ALERT_SHOWS_FULL_PHONE ? order.customer_phone : maskPhone(order.customer_phone)
  if (phone) rows.push(`Tel: ${phone}`)
  rows.push(`Fulfilment: ${order.fulfilment === 'delivery' ? 'Home delivery' : 'Pickup'}`)
  return rows
}

export function composeCreatedAlert(order: OrderRecord): Composed {
  const count = itemCount(order)
  return {
    heading: '🛒 Online order',
    lines: [...orderRows(order), `Status: Waiting for payment`, ...(count ? [`Items: ${count}`] : []), `Total: ${money(order.goods_total_usd)}`],
  }
}

/**
 * Review F5: when orders arrive faster than the plan's per-window allowance (planTier onlineOrderCreatedAlertsPerWindow), the NEXT one sends this single line and the rest of
 * the window stays quiet, so a flood of orders (real or not) cannot fill the staff chat. Counts only: no name, phone or address.
 */
export function composeCreatedDigest(count: number, windowMinutes: number): Composed {
  return { heading: '🛒 Online orders arriving fast', lines: [`Orders in the last ${windowMinutes} minutes: ${count}`, `Further new-order notices wait until it quiets down`] }
}

export function composePaidAlert(order: OrderRecord, payment: PaymentRecord): Composed {
  return {
    heading: '✅ Online order paid',
    lines: [
      ...orderRows(order),
      // A top-up pays for an approved change to an order that was already paid.
      ...(payment.purpose === 'top_up' ? [`Change requested: ${REQUEST_KIND_WORDS.items}`] : []),
      `Paid: ${money(payment.paid_amount ?? payment.amount)}`,
    ],
  }
}

/** `reason` is the mismatch event's: a payment that arrived on a QR the customer had replaced or cancelled says so, because the order itself may look fine. */
export function composeReviewAlert(order: OrderRecord, payment: PaymentRecord, reason?: string | null): Composed {
  return {
    heading: '⚠️ Online payment needs review',
    lines: [
      ...orderRows(order), `Status: ${reason === 'paid_after_cancel' ? 'Paid on a replaced QR' : 'Needs review'}`,
      ...(payment.paid_amount != null ? [`Paid: ${money(payment.paid_amount)}`] : []), `Total: ${money(payment.amount)}`,
    ],
  }
}

export function composeQrFailedAlert(order: OrderRecord): Composed {
  return { heading: '⚠️ Online payment could not start', lines: [...orderRows(order), `Status: Payment not started`, `Total: ${money(order.goods_total_usd)}`] }
}
/** A check PayWay answered with a decline: nothing was taken, the customer may ask for a new QR. */
export function composeDeclinedAlert(order: OrderRecord): Composed {
  return { heading: '⛔ Online payment declined', lines: [...orderRows(order), `Status: Payment declined`, `Total: ${money(order.goods_total_usd)}`] }
}
export function composeEditedAlert(order: OrderRecord): Composed {
  return { heading: '📝 Online order edited', lines: [...orderRows(order), `Total: ${money(order.goods_total_usd)}`] }
}
export function composeCancelledAlert(order: OrderRecord): Composed {
  return { heading: '🚫 Online order cancelled', lines: [...orderRows(order), `Total: ${money(order.goods_total_usd)}`] }
}
export function composeWithdrawnAlert(order: OrderRecord, kind: string): Composed {
  return { heading: '🔙 Online order request withdrawn', lines: [...orderRows(order), `Change requested: ${REQUEST_KIND_WORDS[kind] ?? kind}`] }
}
export function composeRefundAlert(order: OrderRecord, amountUsd: number): Composed {
  return { heading: '↩️ Refund sent through ABA', lines: [...orderRows(order), `Refund: ${money(amountUsd)}`] }
}
export function composeDecidedAlert(order: OrderRecord, kind: string, accepted: boolean): Composed {
  return { heading: accepted ? '👍 Online order request accepted' : '👎 Online order request rejected', lines: [...orderRows(order), `Change requested: ${REQUEST_KIND_WORDS[kind] ?? kind}`] }
}
export function composeAppliedAlert(order: OrderRecord, kind: string, topUpUsd: number): Composed {
  return { heading: '✔️ Online order change applied', lines: [...orderRows(order), `Change requested: ${REQUEST_KIND_WORDS[kind] ?? kind}`, ...(topUpUsd > 0 ? [`Amount: ${money(topUpUsd)}`] : []), `Total: ${money(order.goods_total_usd)}`] }
}
/** Only the tail of the transaction id: enough to find it at ABA, nothing that would let anyone else use it. */
export function composeUnknownPaymentAlert(tranId: string): Composed {
  return { heading: '❓ Online payment not recognised', lines: [`Reference: ...${String(tranId).slice(-6)}`, `Status: Needs review`] }
}

export function composeRequestAlert(order: OrderRecord, request: Pick<RequestRecord, 'kind' | 'customer_comment'>): Composed {
  const comment = request.customer_comment ? firstCharacters(request.customer_comment.replace(/\s+/g, ' ').trim(), COMMENT_CHARACTERS) : ''
  return {
    heading: '✏️ Online order change requested',
    lines: [...orderRows(order), `Change requested: ${REQUEST_KIND_WORDS[request.kind] ?? request.kind}`, ...(comment ? [`Note: ${comment}`] : [])],
  }
}

/** One digest for every payment that ran out in a tick: a row per order (newest rows first is not needed, the sweep orders them), capped, then a count. */
export function composeExpiredDigest(rows: Array<{ order_no: string; goods_total_usd: number }>): Composed {
  const shown = rows.slice(0, MAX_DIGEST_ROWS)
  return {
    heading: '⌛ Online orders not paid in time',
    lines: [...shown.map((row) => `Order: ${row.order_no} · ${money(row.goods_total_usd)}`), ...(rows.length > shown.length ? [`+ ${rows.length - shown.length} more item(s)`] : [])],
  }
}

async function loadOrder(db: D1Compat, id: number): Promise<OrderRecord | null> {
  return (await db.prepare('SELECT * FROM online_orders WHERE id = @id').get<OrderRecord>({ id })) ?? null
}
async function loadPayment(db: D1Compat, id: number): Promise<PaymentRecord | null> {
  return (await db.prepare('SELECT * FROM online_order_payments WHERE id = @id').get<PaymentRecord>({ id })) ?? null
}

/** Compose and send one notice. Resolves false when nothing was sent; never throws. */
export async function sendOrderAlert(env: Env, event: OrderAlertEvent): Promise<boolean> {
  try {
    const db = getDb(env)
    const send = (sub: TelegramOnlineOrderSub, compose: () => Promise<Composed | null>) =>
      sendTelegramEventWhenOn(env, 'online_orders', compose, { retryOnce: true, onlineOrders: sub })
    const withOrder = (sub: TelegramOnlineOrderSub, orderId: number, build: (order: OrderRecord) => Composed) =>
      send(sub, async () => { const order = await loadOrder(db, orderId); return order ? build(order) : null })
    switch (event.kind) {
      case 'created':
        return await send('new', async () => {
          const order = await loadOrder(db, event.orderId)
          if (!order) return null
          // Where this order stands among the orders of its window (by id, from committed rows only, so racing creates each reach the same answer): within the allowance
          // it is announced as before, the first one past it is ONE digest, the rest are quiet.
          const limits = getPlanLimits(env)
          const placed = Date.parse(`${String(order.created_at).replace(' ', 'T')}Z`)
          const since = new Date((Number.isFinite(placed) ? placed : Date.now()) - limits.onlineOrderCreatedAlertWindowMinutes * 60_000).toISOString().slice(0, 19).replace('T', ' ')
          const rank = Number((await db.prepare('SELECT COUNT(*) AS n FROM online_orders WHERE created_at >= @since AND id <= @id').get<{ n: number }>({ since, id: order.id }))?.n ?? 0)
          if (rank <= limits.onlineOrderCreatedAlertsPerWindow) return composeCreatedAlert(order)
          return rank === limits.onlineOrderCreatedAlertsPerWindow + 1 ? composeCreatedDigest(rank, limits.onlineOrderCreatedAlertWindowMinutes) : null
        })
      case 'qr_failed': return await withOrder('new', event.orderId, composeQrFailedAlert)
      case 'failed': return await withOrder('new', event.orderId, composeDeclinedAlert)
      case 'edited': return await withOrder('requests', event.orderId, composeEditedAlert)
      case 'cancelled': return await withOrder('requests', event.orderId, composeCancelledAlert)
      case 'withdrawn': return await withOrder('requests', event.orderId, (order) => composeWithdrawnAlert(order, event.requestKind))
      case 'refund': return await withOrder('requests', event.orderId, (order) => composeRefundAlert(order, event.amountUsd))
      case 'decided': return await withOrder('requests', event.orderId, (order) => composeDecidedAlert(order, event.requestKind, event.accepted))
      case 'applied': return await withOrder('requests', event.orderId, (order) => composeAppliedAlert(order, event.requestKind, event.topUpUsd))
      case 'unknown_payment': return await send('new', async () => composeUnknownPaymentAlert(event.tranId))
      case 'paid':
      case 'review':
        return await send('new', async () => {
          const [order, payment] = await Promise.all([loadOrder(db, event.orderId), loadPayment(db, event.paymentId)])
          if (!order || !payment) return null
          if (event.kind === 'paid') return composePaidAlert(order, payment)
          const mismatch = await db.prepare(`SELECT detail_json FROM online_order_events WHERE payment_id = @pid AND event = 'mismatch' ORDER BY id DESC LIMIT 1`).get<{ detail_json: string | null }>({ pid: event.paymentId })
          let reason: string | null = null
          try { reason = (JSON.parse(mismatch?.detail_json || '{}') as { reason?: string }).reason ?? null } catch { reason = null }
          return composeReviewAlert(order, payment, reason)
        })
      case 'request':
        return await send('requests', async () => {
          const [order, request] = await Promise.all([
            loadOrder(db, event.orderId), db.prepare('SELECT * FROM online_order_requests WHERE id = @id').get<RequestRecord>({ id: event.requestId }),
          ])
          return order && request ? composeRequestAlert(order, request) : null
        })
      case 'expired':
        return await send('expired', async () => {
          const ids = [...new Set(event.expired.map((entry) => entry.orderId))]
          const found = await Promise.all(ids.map((id) => loadOrder(db, id)))
          const rows = found.filter((order): order is OrderRecord => !!order)
          return rows.length ? composeExpiredDigest(rows) : null
        })
      default: return false // 'changed' and 'staff' move the screens, not the chat
    }
  } catch (error) {
    console.warn(`[online-order-alert] ${event.kind} notice not sent:`, error instanceof Error ? error.name : 'error')
    return false
  }
}

/** Staff screens refresh whatever the Telegram switches say. Best effort: a failed bump costs a staler screen, never the order. */
export async function announceOrderChange(env: Env, event: OrderAlertEvent): Promise<void> {
  if (event.kind === 'unknown_payment') return
  try { await bumpVersions(env, ['online_orders']) } catch { /* the cache layer already logs */ }
  try { await broadcast(env, 'onlineOrders', { kind: event.kind }) } catch { /* nobody connected is not an error */ }
}

/**
 * The `notify` every entry point hands to OrderDeps: deferred past the response in a request, awaited in the cron and in tests (lib/requestDefer.ts),
 * under its own background metrics label so the notice's reads never count against the order route's budget.
 */
export function orderNotifier(env: Env): (event: OrderAlertEvent) => Promise<void> {
  return (event) => deferRequestWork(() => runBackground(env, 'online-order-alert', async () => { await announceOrderChange(env, event); await sendOrderAlert(env, event) }))
}

/**
 * A sale that fulfilled an online order was changed from the Sales side (cancelled, reopened, a bulk status Undo/Redo): the order's money view moved (refund due appears or
 * goes), so the staff Orders screens and the bell refresh. Only linked sales cost anything (one indexed read); a shop with no online orders pays that read, deferred past the
 * response. Best effort like announceOrderChange.
 */
export async function announceOrdersOfSales(env: Env, saleIds: readonly number[]): Promise<void> {
  const ids = [...new Set(saleIds.filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 100)
  if (!ids.length) return
  try {
    // sql-bound-params: at most 100 ids (slice above).
    const rows = await getDb(env).prepare(`SELECT id FROM online_orders WHERE sale_id IN (${ids.map(() => '?').join(',')}) LIMIT 25`).all<{ id: number }>(ids)
    if (rows?.length) await announceOrderChange(env, { kind: 'staff', orderId: Number(rows[0].id) })
  } catch { /* a missing table or a failed read costs a staler screen, never the sale change */ }
}

/** The same for a bulk status operation's members (the history Undo/Redo knows the operation, not the sales). */
export async function announceOrdersOfBulkOperation(env: Env, operationId: string): Promise<void> {
  try {
    const rows = await getDb(env).prepare('SELECT sale_id FROM sale_bulk_members WHERE operation_id = @operation LIMIT 100').all<{ sale_id: number }>({ operation: operationId })
    await announceOrdersOfSales(env, (rows || []).map((row) => Number(row.sale_id)))
  } catch { /* best effort */ }
}
