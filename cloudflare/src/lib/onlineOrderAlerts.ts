// Online orders (KHQR lane, slice S4): the Telegram notices the shop gets about the storefront's paid-online orders.
//
//   created   a customer placed an order and is looking at the QR             (sub-switch `new`)
//   paid      ABA confirmed the money; a top-up payment says which change it was for  (`new`)
//   review    ABA's answer did not match what we asked for: a person must look        (`new`)
//   expired   ONE digest per sweep tick of the orders nobody paid in time             (`expired`)
//   request   the customer asked to change, cancel or return a paid order             (`requests`)
//
// The whole family sits behind the `online_orders` category and its own sub-switches (all unset = on), and goes to the Orders topic, or the Sales
// topic until one is set. A notice is built from the committed rows AFTER the write (OrderDeps.notify, called once per guarded transition by
// lib/onlineOrderStore.ts), so a replayed check, a lost race or a refusal never sends one. The phone is always masked, the customer's own words are
// cut short, and no token, tran id or PayWay field ever appears: this chat is read by staff, not by the customer.
//
// Never throws: a missing chat id, a Telegram outage or a vanished row costs the notice and nothing else.

import type { D1Compat } from './db'
import { getDb } from './db'
import { maskPhone } from './phoneMask'
import { sendTelegramEventWhenOn, type TelegramEvent, type TelegramOnlineOrderSub } from './telegram'
import { firstCharacters } from './telegramLang'
import { deferRequestWork } from './requestDefer'
import { runBackground } from './requestMetrics'
import type { OrderAlertEvent, OrderRecord, PaymentRecord, RequestRecord } from './onlineOrderStore'
import type { Env } from '../index'

type Composed = Omit<TelegramEvent, 'type'>

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

/** The rows every single-order notice opens with: which order, who, how it is collected. The phone is masked here, not by the caller. */
function orderRows(order: OrderRecord): string[] {
  const rows = [`Order: ${order.order_no}`, `Customer: ${firstCharacters(order.customer_name, 60)}`]
  const phone = maskPhone(order.customer_phone)
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

export function composeReviewAlert(order: OrderRecord, payment: PaymentRecord): Composed {
  return {
    heading: '⚠️ Online payment needs review',
    lines: [...orderRows(order), `Status: Needs review`, `Total: ${money(payment.amount)}`],
  }
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
    switch (event.kind) {
      case 'created':
        return await send('new', async () => { const order = await loadOrder(db, event.orderId); return order ? composeCreatedAlert(order) : null })
      case 'paid':
      case 'review':
        return await send('new', async () => {
          const [order, payment] = await Promise.all([loadOrder(db, event.orderId), loadPayment(db, event.paymentId)])
          if (!order || !payment) return null
          return event.kind === 'paid' ? composePaidAlert(order, payment) : composeReviewAlert(order, payment)
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
    }
  } catch (error) {
    console.warn(`[online-order-alert] ${event.kind} notice not sent:`, error instanceof Error ? error.name : 'error')
    return false
  }
}

/**
 * The `notify` every entry point hands to OrderDeps: deferred past the response in a request, awaited in the cron and in tests (lib/requestDefer.ts),
 * under its own background metrics label so the notice's reads never count against the order route's budget.
 */
export function orderNotifier(env: Env): (event: OrderAlertEvent) => Promise<void> {
  return (event) => deferRequestWork(() => runBackground(env, 'online-order-alert', () => sendOrderAlert(env, event)))
}
