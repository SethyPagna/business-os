import { ORDER_CONTACT_FIELDS, type OrderContactField, type OrderFulfilment, type OrderView } from './orderTypes.ts'

// The storefront order screens' rules, kept out of the components so each one can be run and tested without a browser.

// ---- time ----------------------------------------------------------------------------------------------------------------------

/** The Worker writes UTC as 'YYYY-MM-DD HH:MM:SS(.sss)' (SQLite) or as an ISO string; null when unreadable. */
export function parseServerTime(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const text = value.trim()
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(text) ? `${text.replace(' ', 'T')}Z` : text
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

/**
 * Whole seconds until the QR stops working, or null when there is no expiry to count to. `skewMs` is (server clock - this device's clock),
 * measured from a response's Date header, so a phone with a wrong clock still shows the shop's countdown, not its own.
 */
export function secondsUntilExpiry(expiresAt: string | null | undefined, nowMs: number, skewMs = 0): number | null {
  const expires = parseServerTime(expiresAt)
  if (expires === null) return null
  return Math.max(0, Math.ceil((expires - (nowMs + skewMs)) / 1000))
}

/** 14:05, or 1:02:03 when over an hour. */
export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const two = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`
}

/** Server clock minus device clock, from a response's `Date` header (second resolution). Null when absent or unreadable. */
export function clockSkewMs(dateHeader: string | null | undefined, receivedAtMs: number): number | null {
  if (!dateHeader) return null
  const server = Date.parse(dateHeader)
  return Number.isFinite(server) ? server - receivedAtMs : null
}

// ---- polling cadence -------------------------------------------------------------------------------------------------------------

export const POLL_FAST_MS = 4_000
export const POLL_SLOW_MS = 10_000
/** The first two minutes are when a buyer is looking at the QR and paying: poll quicker, then settle. */
export const POLL_FAST_WINDOW_MS = 120_000
export const POLL_BACKOFF_MAX_MS = 30_000
/** One status read is a single order row on the Worker; this floor keeps a stuck loop from ever being tight. */
export const POLL_MIN_MS = 3_000

/** The wait before the next status read: quicker while the QR is fresh, slower after, and doubling (to a cap) after each failed read. */
export function nextPollDelayMs(elapsedMs: number, consecutiveFailures: number): number {
  const base = elapsedMs < POLL_FAST_WINDOW_MS ? POLL_FAST_MS : POLL_SLOW_MS
  const failures = Math.max(0, Math.min(4, Math.floor(consecutiveFailures)))
  return Math.max(POLL_MIN_MS, Math.min(POLL_BACKOFF_MAX_MS, base * 2 ** failures))
}

/** After the QR ran out, a little more watching catches a payment made in its last seconds; then the page waits for the buyer. */
export const POLL_GRACE_AFTER_EXPIRY_MS = 150_000

/** Server order states that need no more watching. `expired` stops too: the page offers "Get a new QR" and a reload shows a late payment. */
const FINISHED_STATES: ReadonlySet<string> = new Set(['paid', 'review', 'expired', 'cancelled', 'fulfilled', 'qr_failed'])
export const isFinishedState = (state: string): boolean => FINISHED_STATES.has(state)

// ---- which screen an order shows -----------------------------------------------------------------------------------------------

export type OrderScreen =
  | 'pay'          // a live QR to scan
  | 'pay_expired'  // the QR's time ran out (by the clock) while the server still says waiting
  | 'new_qr'       // no usable QR: the first one failed, or the time ran out
  | 'paid'
  | 'review'
  | 'cancelled'
  | 'after_sale'

export function orderScreen(order: Pick<OrderView, 'status' | 'payment'>, secondsLeft: number | null): OrderScreen {
  switch (order.status) {
    case 'awaiting_payment':
      if (!order.payment) return 'new_qr'
      return secondsLeft !== null && secondsLeft <= 0 ? 'pay_expired' : 'pay'
    case 'qr_failed':
    case 'expired':
      return 'new_qr'
    case 'paid': return 'paid'
    case 'review': return 'review'
    case 'cancelled': return 'cancelled'
    default: return 'after_sale'
  }
}


// ---- the checkout form -----------------------------------------------------------------------------------------------------------

export type CheckoutForm = {
  name: string
  phone: string
  fulfilment: OrderFulfilment
  address: string
  note: string
  contacts: Record<OrderContactField, string>
}

export const emptyCheckoutForm = (): CheckoutForm => ({
  name: '', phone: '', fulfilment: 'pickup', address: '', note: '',
  contacts: Object.fromEntries(ORDER_CONTACT_FIELDS.map((field) => [field, ''])) as Record<OrderContactField, string>,
})

/** The Worker's own phone rule (normalizePhone in lib/onlineOrderStore.ts + canonicalizePhone in lib/phone.ts): digits only, 8 to 15 of them. */
export function phoneDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '')
}
export const isPlausiblePhone = (value: unknown): boolean => {
  const digits = phoneDigits(value)
  return digits.length >= 8 && digits.length <= 15
}

export type CheckoutProblem = 'name_required' | 'phone_invalid' | 'address_required'
/** The required fields only. The Worker enforces the same rules and more; this just saves a round trip for the obvious. */
export function checkoutProblems(form: CheckoutForm): CheckoutProblem[] {
  const problems: CheckoutProblem[] = []
  if (!form.name.trim()) problems.push('name_required')
  if (!isPlausiblePhone(form.phone)) problems.push('phone_invalid')
  if (form.fulfilment === 'delivery' && !form.address.trim()) problems.push('address_required')
  return problems
}

export type CheckoutLine = { id: string | number; qty: number }

/** The request body of POST /api/portal/orders. Empty optional fields are left out, the address only travels when it is needed or given. */
export function buildCheckoutBody(form: CheckoutForm, lines: readonly CheckoutLine[], clientRequestId: string): Record<string, unknown> {
  const contacts = Object.fromEntries(ORDER_CONTACT_FIELDS.map((field) => [field, form.contacts[field].trim()]).filter(([, value]) => value))
  const address = form.address.trim()
  return {
    lines: lines.map((line) => ({ product_id: Number(line.id), quantity: Math.round(Number(line.qty)) })),
    name: form.name.trim(),
    phone: form.phone.trim(),
    fulfilment: form.fulfilment,
    ...(address ? { address } : {}),
    ...(form.note.trim() ? { note: form.note.trim() } : {}),
    ...(Object.keys(contacts).length ? { contacts } : {}),
    client_request_id: clientRequestId,
  }
}

/** A cart line whose id is not a whole positive number cannot be ordered (the Worker refuses it as invalid_line). */
export const orderableLines = (lines: readonly CheckoutLine[]): CheckoutLine[] =>
  lines.filter((line) => Number.isSafeInteger(Number(line.id)) && Number(line.id) > 0 && Number.isFinite(Number(line.qty)) && Number(line.qty) >= 1)

/** 16 characters of [A-Za-z0-9_-], within the Worker's 8..64 shape for client_request_id. */
export function newClientRequestId(random: (length: number) => Uint8Array = (length) => globalThis.crypto.getRandomValues(new Uint8Array(length))): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  return Array.from(random(16), (byte) => alphabet[byte % alphabet.length]).join('')
}

// ---- money ---------------------------------------------------------------------------------------------------------------------

/** The Worker's amounts are whole cents: shown with two decimals and a $, the way the shop's own receipts read. */
export const formatUsd = (value: unknown): string => `$${(Number.isFinite(Number(value)) ? Number(value) : 0).toFixed(2)}`

// ---- requests --------------------------------------------------------------------------------------------------------------------

export const REQUEST_REASON_MAX = 300

/** What the customer-facing money lines say, in the order they matter: money back first, then money still to pay. */
export type OrderMoneyNote = { kind: 'refund_due' | 'refunded' | 'balance_due'; amountUsd: number }
export function orderMoneyNotes(order: Pick<OrderView, 'money'>): OrderMoneyNote[] {
  const notes: OrderMoneyNote[] = []
  if (order.money.refund_due_usd > 0) notes.push({ kind: 'refund_due', amountUsd: order.money.refund_due_usd })
  if (order.money.refunded_usd > 0) notes.push({ kind: 'refunded', amountUsd: order.money.refunded_usd })
  if (order.money.balance_due_usd > 0) notes.push({ kind: 'balance_due', amountUsd: order.money.balance_due_usd })
  return notes
}

