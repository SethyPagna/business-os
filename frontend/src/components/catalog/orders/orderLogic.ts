import { ORDER_CONTACT_FIELDS, type OrderContactField, type OrderFulfilment, type OrderItem, type OrderStatus, type OrderView, type RequestKind } from './orderTypes.ts'

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
  | 'closed'       // the shop closed it (its details were removed): nothing can be paid or changed
  | 'after_sale'

export function orderScreen(order: Pick<OrderView, 'status' | 'payment' | 'closed'>, secondsLeft: number | null): OrderScreen {
  if (order.closed === true) return 'closed'
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

/** The request body of POST /api/portal/orders. Empty optional fields are left out. The address travels only for delivery: pickup never sends one, even if one was typed before switching (the shop keeps an address only to deliver). */
export function buildCheckoutBody(form: CheckoutForm, lines: readonly CheckoutLine[], clientRequestId: string): Record<string, unknown> {
  const contacts = Object.fromEntries(ORDER_CONTACT_FIELDS.map((field) => [field, form.contacts[field].trim()]).filter(([, value]) => value))
  const address = form.address.trim()
  return {
    lines: lines.map((line) => ({ product_id: Number(line.id), quantity: Math.round(Number(line.qty)) })),
    name: form.name.trim(),
    phone: form.phone.trim(),
    fulfilment: form.fulfilment,
    ...(address && form.fulfilment === 'delivery' ? { address } : {}),
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

/** A QR's amount in its own currency: dollars with cents, or whole riel. Orders are USD today; a riel QR is a later switch on the Worker. */
export function formatAmount(amount: unknown, currency: unknown): string {
  const value = Number.isFinite(Number(amount)) ? Number(amount) : 0
  return String(currency).toUpperCase() === 'KHR' ? `${Math.round(value).toLocaleString('en-US')} ៛` : formatUsd(value)
}

// ---- the bank-app link -----------------------------------------------------------------------------------------------------------

/** The schemes ABA's own deeplink can use: its app's, and https universal links. Anything else (javascript:, data:, a stray string) is never made a link. */
const DEEPLINK_SCHEMES: ReadonlySet<string> = new Set(['https:', 'abamobilebank:', 'abapay:'])
export function safeDeeplink(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) return null
  try {
    return DEEPLINK_SCHEMES.has(new URL(value.trim()).protocol) ? value.trim() : null
  } catch {
    return null
  }
}

// ---- requests --------------------------------------------------------------------------------------------------------------------

/** The Worker's limit on a typed comment or reason (normalizeComment in lib/onlineOrderStore.ts). */
export const COMMENT_MAX = 300
/** The Worker's cap on one line's quantity (MAX_LINE_QUANTITY in lib/onlineOrders.ts). */
export const MAX_ORDER_LINE_QTY = 99

/** What the customer-facing money lines say, in the order they matter: money back first, then money still to pay. */
export type OrderMoneyNote = { kind: 'refund_due' | 'refunded' | 'balance_due'; amountUsd: number }
export function orderMoneyNotes(order: Pick<OrderView, 'money'>): OrderMoneyNote[] {
  const notes: OrderMoneyNote[] = []
  if (order.money.refund_due_usd > 0) notes.push({ kind: 'refund_due', amountUsd: order.money.refund_due_usd })
  if (order.money.refunded_usd > 0) notes.push({ kind: 'refunded', amountUsd: order.money.refunded_usd })
  if (order.money.balance_due_usd > 0) notes.push({ kind: 'balance_due', amountUsd: order.money.balance_due_usd })
  return notes
}


// ---- changing a waiting order ----------------------------------------------------------------------------------------------------

export type EditDraft = {
  lines: Array<{ item: OrderItem; qty: number }>
  name: string
  newPhone: string
  fulfilment: 'pickup' | 'delivery'
  address: string
  note: string
  contacts: Record<OrderContactField, string>
}

export const draftFromOrder = (order: OrderView): EditDraft => ({
  lines: order.items.map((item) => ({ item, qty: item.quantity })),
  name: order.name,
  newPhone: '',
  fulfilment: order.fulfilment,
  address: order.address ?? '',
  note: order.note ?? '',
  contacts: Object.fromEntries(ORDER_CONTACT_FIELDS.map((field) => [field, order.contacts[field] ?? ''])) as Record<OrderContactField, string>,
})

/** The body of POST /edit: only what changed, so an untouched field is never rewritten and an unchanged list never costs a new QR. */
export function editBodyFor(order: OrderView, draft: EditDraft): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  const same = draft.lines.length === order.items.length && draft.lines.every(({ item, qty }) => order.items.some((own) => own.product_id === item.product_id && own.quantity === qty))
  if (!same) body.lines = draft.lines.map(({ item, qty }) => ({ product_id: item.product_id, quantity: qty }))
  if (draft.name.trim() !== order.name) body.name = draft.name.trim()
  if (draft.newPhone.trim()) body.phone = draft.newPhone.trim()
  if (draft.fulfilment !== order.fulfilment) body.fulfilment = draft.fulfilment
  if (draft.address.trim() !== (order.address ?? '')) body.address = draft.address.trim()
  if (draft.note.trim() !== (order.note ?? '')) body.note = draft.note.trim()
  // The Worker reads `contacts` as the whole set (a field left out becomes empty), so a change to one sends all six.
  if (ORDER_CONTACT_FIELDS.some((field) => draft.contacts[field].trim() !== (order.contacts[field] ?? ''))) {
    body.contacts = Object.fromEntries(ORDER_CONTACT_FIELDS.map((field) => [field, draft.contacts[field].trim()]))
  }
  return body
}

// ---- asking for a change or a return after paying -----------------------------------------------------------------------------------

export type RequestDraft = {
  kind: RequestKind
  /** The number given when ordering: the Worker matches it, so a leaked link alone changes nothing. */
  phone: string
  comment: string
  /** product_id -> quantity (for `items`: the quantity wanted; for `return`: the quantity given back). */
  quantities: Record<number, number>
  reason: string
  fulfilment: OrderFulfilment
  address: string
  name: string
  contacts: Record<OrderContactField, string>
  note: string
}

export function draftForRequest(order: OrderView, kind: RequestKind): RequestDraft {
  const base = draftFromOrder(order)
  return {
    kind,
    phone: '',
    comment: '',
    // A change starts from what was ordered; a return starts from nothing chosen.
    quantities: Object.fromEntries(order.items.map((item) => [item.product_id, kind === 'return' ? 0 : item.quantity])),
    reason: '',
    fulfilment: base.fulfilment,
    address: base.address,
    name: base.name,
    contacts: base.contacts,
    note: base.note,
  }
}

export type RequestProblem = 'phone_invalid' | 'need_items' | 'need_reason' | 'no_change' | 'address_required' | 'name_required'

const chosenLines = (order: Pick<OrderView, 'items'>, draft: Pick<RequestDraft, 'quantities'>) =>
  order.items.map((item) => ({ product_id: item.product_id, quantity: Math.max(0, Math.round(Number(draft.quantities[item.product_id] ?? 0))) })).filter((line) => line.quantity > 0)

/** The first thing wrong with a request, or null. The Worker checks all of it again; this saves the shopper a round trip for the obvious. */
export function requestProblem(order: OrderView, draft: RequestDraft): RequestProblem | null {
  if (!isPlausiblePhone(draft.phone)) return 'phone_invalid'
  const lines = chosenLines(order, draft)
  switch (draft.kind) {
    case 'items':
      if (!lines.length) return 'need_items'
      return lines.length === order.items.length && lines.every((line) => order.items.find((item) => item.product_id === line.product_id)?.quantity === line.quantity) ? 'no_change' : null
    case 'return':
      if (!lines.length) return 'need_items'
      return draft.reason.trim() ? null : 'need_reason'
    case 'fulfilment':
      if (draft.fulfilment === 'delivery' && !draft.address.trim()) return 'address_required'
      return draft.fulfilment === order.fulfilment && draft.address.trim() === (order.address ?? '') ? 'no_change' : null
    case 'address':
      if (!draft.address.trim()) return 'address_required'
      return draft.address.trim() === (order.address ?? '') ? 'no_change' : null
    case 'contact':
      if (!draft.name.trim()) return 'name_required'
      return draft.name.trim() === order.name && ORDER_CONTACT_FIELDS.every((field) => draft.contacts[field].trim() === (order.contacts[field] ?? '')) ? 'no_change' : null
    case 'note':
      return draft.note.trim() === (order.note ?? '') ? 'no_change' : null
    default:
      return null
  }
}

/** The body of POST /requests: the kind, the phone, the comment and what the shopper proposes (the Worker keeps the order as it stands beside it). */
export function buildRequestBody(order: OrderView, draft: RequestDraft): Record<string, unknown> {
  const comment = draft.comment.trim()
  let after: Record<string, unknown> = {}
  switch (draft.kind) {
    case 'items': after = { lines: chosenLines(order, draft) }; break
    case 'return': after = { lines: chosenLines(order, draft), reason: draft.reason.trim() }; break
    case 'fulfilment': after = { fulfilment: draft.fulfilment, address: draft.address.trim() }; break
    case 'address': after = { address: draft.address.trim() }; break
    // The whole set, as in an edit: the Worker reads `contacts` as complete.
    case 'contact': after = { name: draft.name.trim(), contacts: Object.fromEntries(ORDER_CONTACT_FIELDS.map((field) => [field, draft.contacts[field].trim()])) }; break
    case 'note': after = { note: draft.note.trim() }; break
    default: after = {}
  }
  return { kind: draft.kind, phone: draft.phone.trim(), ...(comment ? { comment } : {}), after }
}

/** The kinds the form offers, in the order the Worker lists them, limited to the ones this order allows right now. */
export const requestKindsOffered = (order: Pick<OrderView, 'requests_open' | 'request_kinds'>): RequestKind[] => (order.requests_open ? order.request_kinds : [])

/** A pending request blocks a new one (the Worker allows one at a time). */
export const hasPendingRequest = (order: Pick<OrderView, 'requests'>): boolean => order.requests.some((request) => request.status === 'pending')

/** Statuses after which a request page is worth showing at all: the order was paid, so changes and returns can exist. */
export const PAID_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>(['paid', 'review', 'completed', 'balance_due', 'delivery_pending', 'sale_cancelled'])

/**
 * The cart's total as the shopper already sees it (quantity times the price text on each line), shown on the checkout so nobody has to tap "Pay with KHQR" to learn
 * the price. null when any price is not a plain dollar amount: then nothing is shown rather than a wrong figure. The Worker prices the order itself.
 */
export function estimateCartTotal(items: ReadonlyArray<{ qty: number; priceText?: string | null }>): number | null {
  let cents = 0
  for (const item of items) {
    const match = /^\s*\$\s*([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)(?:\.([0-9]{1,4}))?\s*$/.exec(String(item.priceText ?? ''))
    const qty = Number(item.qty)
    if (!match || !Number.isFinite(qty) || qty < 1) return null
    cents += Math.round(Number(match[1].replace(/,/g, '') + '.' + (match[2] ?? '0')) * 100) * Math.round(qty)
  }
  return cents / 100
}
