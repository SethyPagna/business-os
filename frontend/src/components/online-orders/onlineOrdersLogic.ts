// The staff Orders screen's rules (KHQR G6), kept out of the component so they can be tested one at a time: which chips an order wears, how the list is searched and
// paged, what each staff action sends, and what "before and after" reads like for a customer's request. The Worker (routes/onlineOrders.ts, lib/onlineOrderStaff.ts)
// enforces every one of these again; nothing here is the only check.

// ---- the list -----------------------------------------------------------------------------------------------------------------

/** The filters the Worker's list answers (lib/onlineOrderStaff.ts LIST_FILTERS), in the order staff meet them: what needs a person first. */
export const ORDER_FILTERS = ['attention', 'paid', 'review', 'requests', 'refund_due', 'awaiting_payment', 'fulfilled', 'expired', 'qr_failed', 'cancelled', 'all'] as const
export type OrderFilter = (typeof ORDER_FILTERS)[number]
export const DEFAULT_ORDER_FILTER: OrderFilter = 'attention'
export const isOrderFilter = (value: unknown): value is OrderFilter => (ORDER_FILTERS as readonly string[]).includes(String(value))

export type StaffOrderRow = {
  id: number
  order_no: string
  state: string
  fulfilment: string
  customer_name: string
  customer_phone: string
  goods_total_usd: number
  created_at: string
  paid_at: string | null
  sale_id: number | null
  pending_requests: number
  held_review: number
  /** The Worker's own money read: the customer was refunded less than they are owed (orders from the last 32 days only). */
  refund_due?: boolean
  refund_due_usd?: number
}
export type StaffOrderPage = { rows: StaffOrderRow[]; next_cursor: string | null; page_size: number }

export type ChipTone = 'todo' | 'wait' | 'warn' | 'done' | 'muted'
export type OrderChip = { id: string; tone: ChipTone; count?: number }

/** The state of an order as one chip: the words staff use ("To fulfil", "Not paid yet"), not the Worker's state names. */
export function stateChip(state: string): OrderChip {
  switch (state) {
    case 'paid': return { id: 'to_fulfil', tone: 'todo' }
    case 'review': return { id: 'needs_review', tone: 'warn' }
    case 'awaiting_payment': return { id: 'not_paid', tone: 'wait' }
    case 'qr_failed': return { id: 'qr_failed', tone: 'wait' }
    case 'expired': return { id: 'expired', tone: 'muted' }
    case 'cancelled': return { id: 'cancelled', tone: 'muted' }
    case 'fulfilled': return { id: 'fulfilled', tone: 'done' }
    default: return { id: 'other', tone: 'muted' }
  }
}

/**
 * Every chip one list row wears: its state, plus "Requests" while a customer's request is unanswered and "Needs review" while a payment is held, even when the state says
 * paid (a mismatched top-up), and "Refund due" while the customer is still owed money back.
 */
export function rowChips(row: Pick<StaffOrderRow, 'state' | 'pending_requests' | 'held_review'> & { refund_due?: boolean }): OrderChip[] {
  const chips = [stateChip(row.state)]
  if (Number(row.pending_requests) > 0) chips.push({ id: 'requests', tone: 'todo', count: Number(row.pending_requests) })
  if (Number(row.held_review) > 0 && row.state !== 'review') chips.push({ id: 'needs_review', tone: 'warn' })
  if (row.refund_due === true) chips.push({ id: 'refund_due', tone: 'warn' })
  return chips
}

const digits = (value: unknown): string => String(value ?? '').replace(/\D/g, '')

/**
 * What the search box asks the Worker (GET /api/online-orders?q=): an order-number prefix, or a phone prefix when the text is only digits and phone punctuation. The Worker
 * refuses fewer than 3 digits (phone) or 3 characters (order number) with search_too_short and more than 40 with search_invalid, so the screen asks nothing until the
 * text is long enough and tells the person why, instead of showing an error for every first keystroke. A search spans every state; it is not narrowed by a chip.
 */
export const SEARCH_MIN = 3
export const SEARCH_MAX = 40
export type SearchState = { kind: 'none' } | { kind: 'short' } | { kind: 'ok'; q: string }
export function searchState(raw: unknown): SearchState {
  const q = String(raw ?? '').trim().slice(0, SEARCH_MAX)
  if (!q) return { kind: 'none' }
  const phoneLike = /^[\d+\s\-.()]+$/.test(q)
  const size = phoneLike ? digits(q).length : q.replace(/[\s-]/g, '').length
  return size >= SEARCH_MIN ? { kind: 'ok', q } : { kind: 'short' }
}

/** Keyset pages walked with Previous / Next: the cursor that opens each page (the first is null). Going on pushes the Worker's `next_cursor`, going back pops. */
export type PageTrail = readonly (string | null)[]
export const FIRST_PAGE: PageTrail = [null]
export const pageNumber = (trail: PageTrail): number => trail.length
export const nextTrail = (trail: PageTrail, nextCursor: string | null): PageTrail => (nextCursor ? [...trail, nextCursor] : trail)
export const previousTrail = (trail: PageTrail): PageTrail => (trail.length > 1 ? trail.slice(0, -1) : trail)
export const currentCursor = (trail: PageTrail): string | null => trail[trail.length - 1] ?? null

// ---- one order -----------------------------------------------------------------------------------------------------------------

export type StaffItem = { product_id?: number; name?: string; quantity?: number; unit_price_usd?: number; line_total_usd?: number }
export type StaffRequest = {
  id: number
  kind: string
  stage: string
  state: 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'applied' | 'reversed' | string
  before_json: string
  after_json: string
  customer_comment: string | null
  created_at: string
}
export type StaffPayment = { id: number; purpose: string; amount: number; currency: string; state: string; paid_amount: number | null; paid_at: string | null; created_at: string; expires_at: string | null }
export type StaffEvent = { id: number; event: string; source: string; actor_name: string | null; public_comment: string | null; internal_note: string | null; amount_usd: number | null; reference: string | null; created_at: string }
/** The money object of the Worker's staff detail: the customer view's snake_case names (the Worker also sends camelCase for its own tests; nothing here reads those). Pinned by onlineOrdersWorkerContract.test.ts. */
export type StaffMoney = { paid_usd?: number; refunded_usd?: number; refund_due_usd?: number; balance_due_usd?: number; held_in_review_usd?: number }
export type StaffOrderDetail = {
  order: Record<string, unknown> & { id: number; order_no: string; state: string; revision: number; sale_id: number | null; goods_total_usd: number; currency: string }
  payments: StaffPayment[]
  requests: StaffRequest[]
  events: StaffEvent[]
  status: string
  chips: string[]
  money: StaffMoney
}

export function parseJson<T>(text: unknown, fallback: T): T {
  if (typeof text !== 'string' || !text) return fallback
  try { const value = JSON.parse(text); return value === null || value === undefined ? fallback : value as T } catch { return fallback }
}

export const parseItems = (itemsJson: unknown): StaffItem[] => {
  const value = parseJson<unknown>(itemsJson, [])
  return Array.isArray(value) ? value.filter((entry): entry is StaffItem => !!entry && typeof entry === 'object') : []
}

/** "2 x Name" for one line; a line the Worker stored without a name reads "Product 1000". */
export const itemLine = (item: StaffItem): string => `${Number(item.quantity ?? 0)} × ${String(item.name || `#${item.product_id ?? '?'}`)}`

export type RequestChange = { field: 'items' | 'fulfilment' | 'address' | 'name' | 'contacts' | 'note' | 'reason' | 'cancel'; before: string; after: string }

const text = (value: unknown): string => (value === null || value === undefined ? '' : String(value))
const contactsLine = (value: unknown): string => {
  const contacts = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return Object.entries(contacts).filter(([, v]) => text(v).trim()).map(([k, v]) => `${k}: ${text(v)}`).join(', ')
}

/** What a request would change, as plain before / after pairs (the Worker kept `before` beside `after` when the customer asked). Nothing the request leaves alone is listed. */
export function requestChanges(request: Pick<StaffRequest, 'kind' | 'before_json' | 'after_json'>): RequestChange[] {
  const before = parseJson<Record<string, unknown>>(request.before_json, {})
  const after = parseJson<Record<string, unknown>>(request.after_json, {})
  const out: RequestChange[] = []
  const add = (field: RequestChange['field'], b: string, a: string) => { if (b !== a) out.push({ field, before: b, after: a }) }
  const lines = (value: unknown) => (Array.isArray(value) ? value.map((entry) => itemLine(entry as StaffItem)).join('\n') : '')
  switch (request.kind) {
    case 'items':
    case 'return':
      out.push({ field: 'items', before: lines(before.items), after: lines(after.items) })
      if (request.kind === 'return' && text(after.reason)) out.push({ field: 'reason', before: '', after: text(after.reason) })
      return out
    case 'fulfilment':
      add('fulfilment', text(before.fulfilment), text(after.fulfilment))
      add('address', text(before.address), text(after.address))
      return out
    case 'address': add('address', text(before.address), text(after.address)); return out
    case 'contact':
      add('name', text(before.name), text(after.name))
      add('contacts', contactsLine(before.contacts), contactsLine(after.contacts))
      return out
    case 'note': add('note', text(before.note), text(after.note)); return out
    case 'cancel': return [{ field: 'cancel', before: text(before.state), after: '' }]
    default: return out
  }
}

/** A request the shop can still answer, one it accepted and can apply to the order, or one finished. */
export const requestIsPending = (request: Pick<StaffRequest, 'state'>): boolean => request.state === 'pending'
/**
 * Applying works on the order itself, before the sale, for the kinds that edit it; a return, or any request made after the sale, belongs to the sale (the Worker refuses it
 * as apply_on_sale), and an accepted cancel request is answered with Cancel order instead.
 */
export const APPLIABLE_KINDS = ['items', 'fulfilment', 'address', 'contact', 'note'] as const
export const requestCanBeApplied = (request: Pick<StaffRequest, 'state' | 'kind' | 'stage'>, order: Pick<StaffOrderDetail['order'], 'state' | 'sale_id'>): boolean =>
  request.state === 'accepted' && request.stage === 'paid' && (APPLIABLE_KINDS as readonly string[]).includes(request.kind) && order.state === 'paid' && order.sale_id == null

// ---- what each staff action may do, and sends -------------------------------------------------------------------------------------

export type OrderActionId = 'recheck' | 'note' | 'cancel' | 'resolve' | 'refund' | 'fulfil'
export type OrderAccess = { canView: boolean; canDecide: boolean; canRefund: boolean }

/** The access a screen reads from the permission tiers: view opens the list, "decide" and "refund" are separate (the Worker checks each route itself). */
export function orderAccess(can: (key: string, action: string) => boolean): OrderAccess {
  const canView = can('online_orders', 'view')
  return { canView, canDecide: canView && can('online_orders', 'decide'), canRefund: canView && can('online_orders', 'refund') }
}

const round2 = (n: number): number => Math.round((Number(n) + Number.EPSILON) * 100) / 100

/** Which actions the open order offers right now. The Worker refuses the rest with its own code. */
export function availableActions(detail: Pick<StaffOrderDetail, 'order' | 'money' | 'payments'>, access: OrderAccess): OrderActionId[] {
  const { order, money } = detail
  const out: OrderActionId[] = []
  if (!access.canView) return out
  const open = order.sale_id == null && order.state !== 'fulfilled'
  // Money held in review is settled first, whatever the order's own state says: a paid order with a second payment held (paid twice, or after the order closed) is not fulfilled until staff accept or return that money.
  const held = (detail.payments ?? []).some((payment) => String(payment.state) === 'review')
  if (access.canView && (['paid', 'review', 'awaiting_payment', 'expired', 'cancelled', 'qr_failed'].includes(order.state))) out.push('recheck')
  if (access.canView) out.push('note')
  // Review money is resolved even after the sale exists (a late review after Fulfil): it counts as refund due and the Worker accepts Resolve then. Cancel stays for an order without a sale.
  if (access.canDecide && (held || (open && order.state === 'review'))) out.push('resolve')
  if (access.canDecide && open && (order.state === 'paid' || order.state === 'review')) out.push('cancel')
  if (access.canRefund && round2(Number(money.refund_due_usd ?? 0)) > 0) out.push('refund')
  if (order.state === 'paid' && open && !held) out.push('fulfil')
  return out
}

export type RefundProblem = 'amount_invalid' | 'refund_over_due' | null
/** The refund note's amount: more than 0 and no more than what is still due (the Worker checks it again inside the write). */
export function refundProblem(amountText: string, dueUsd: number): RefundProblem {
  const typed = String(amountText ?? '').trim()
  if (!/^\d+(\.\d{1,2})?$/.test(typed) || !(Number(typed) > 0)) return 'amount_invalid'
  return round2(Number(typed)) > round2(dueUsd) ? 'refund_over_due' : null
}

const clean = (value: string, max: number): string | undefined => { const trimmed = String(value ?? '').trim().slice(0, max); return trimmed ? trimmed : undefined }
const compact = <T extends Record<string, unknown>>(value: T): Partial<T> => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>

/** Staff text limits, the Worker's own: a message to the customer 300 characters, internal notes and reasons 500, an ABA reference 60. */
export const LIMITS = { publicComment: 300, internalNote: 500, reference: 60 } as const

export const decideBody = (decision: 'accept' | 'reject', publicComment: string, internalNote: string) =>
  compact({ decision, public_comment: clean(publicComment, LIMITS.publicComment), internal_note: clean(internalNote, LIMITS.internalNote) })
export const applyBody = (revision: number) => ({ revision })
export const resolveBody = (note: string, revision: number) => compact({ note: clean(note, LIMITS.internalNote), revision })
export const cancelBody = (reason: string, revision: number) => compact({ reason: clean(reason, LIMITS.internalNote), revision })
export const noteBody = (note: string) => ({ note: clean(note, LIMITS.internalNote) ?? '' })
export const refundBody = (amountText: string, reference: string, note: string) =>
  compact({ amount_usd: round2(Number(String(amountText).trim())), reference: clean(reference, LIMITS.reference), note: clean(note, LIMITS.internalNote) })

// ---- the Fulfil hand-off to the till (S6a) -------------------------------------------------------------------------------------------

/** Fulfil hands the order to the till through session storage (fulfilOrder.ts reads it); the till posts the sale with `online_order_id`. */
import { ONLINE_REFUSAL_KEYS } from './onlineRefusalKeys.ts'

export const FULFIL_HANDOFF_KEY = 'bos:online-order-fulfil'
export type FulfilHandoff = {
  online_order_id: number
  order_no: string
  revision: number
  branch_id: number | null
  customer_name: string
  customer_phone: string
  fulfilment: string
  address: string | null
  lines: Array<{ product_id: number; quantity: number }>
  paid_usd: number
}
export function fulfilHandoff(detail: Pick<StaffOrderDetail, 'order' | 'money'>): FulfilHandoff {
  const { order } = detail
  const lines = parseItems(order.items_json).filter((item) => Number.isSafeInteger(Number(item.product_id)) && Number(item.quantity) > 0)
    .map((item) => ({ product_id: Number(item.product_id), quantity: Number(item.quantity) }))
  return {
    online_order_id: Number(order.id), order_no: String(order.order_no), revision: Number(order.revision),
    branch_id: Number.isSafeInteger(Number(order.branch_id)) ? Number(order.branch_id) : null,
    customer_name: text(order.customer_name), customer_phone: text(order.customer_phone), fulfilment: text(order.fulfilment),
    address: order.customer_address == null ? null : text(order.customer_address), lines, paid_usd: round2(Number(detail.money.paid_usd ?? 0)),
  }
}

// ---- errors ------------------------------------------------------------------------------------------------------------------------

/** Staff-route refusal codes (routes/onlineOrders.ts, lib/onlineOrderStaff.ts) -> the pack key that explains each. Anything else reads the generic sentence. */
export const STAFF_ERROR_KEYS: Readonly<Record<string, string>> = {
  forbidden: 'oo_err_forbidden',
  order_not_found: 'oo_err_not_found',
  order_changed: 'oo_err_changed',
  order_has_sale: 'oo_err_has_sale',
  order_not_cancellable_here: 'oo_err_not_cancellable',
  nothing_to_resolve: 'oo_err_nothing_to_resolve',
  no_amount_held: 'oo_err_no_amount_held',
  refund_over_due: 'oo_err_refund_over_due',
  amount_invalid: 'oo_err_amount_invalid',
  request_not_found: 'oo_err_request_not_found',
  request_not_pending: 'oo_err_request_not_pending',
  request_not_accepted: 'oo_err_request_not_accepted',
  apply_on_sale: 'oo_err_apply_on_sale',
  order_not_paid: 'oo_err_not_paid',
  decision_invalid: 'oo_err_generic',
  address_required: 'oo_err_address_required',
  note_required: 'oo_err_note_required',
  note_invalid: 'oo_err_text_too_long',
  comment_invalid: 'oo_err_text_too_long',
  reason_invalid: 'oo_err_text_too_long',
  reference_invalid: 'oo_err_text_too_long',
  cursor_invalid: 'oo_err_cursor',
  search_too_short: 'oo_err_search_short',
  search_invalid: 'oo_err_search_invalid',
  // Sales-side refusals that concern an online order's money (cloudflare/src/lib/onlineOrderFulfil.ts, productStockGuard.ts); their pack keys are the codes themselves.
  online_refund_noted: 'online_refund_noted',
  linked_sale_money_locked: 'linked_sale_money_locked',
  online_method_requires_order: 'online_method_requires_order',
  payway_not_configured: 'oo_err_payway',
}
export const staffErrorKey = (code: unknown): string => STAFF_ERROR_KEYS[String(code ?? '')] ?? 'oo_err_generic'

/** The English each key above carries when the language pack has not loaded (the pack texts are tests/onlineOrdersCopy.test.ts's to keep in step). */
export const STAFF_ERROR_FALLBACK: Readonly<Record<string, string>> = {
  oo_err_generic: 'That did not work. Reload the order and try again.',
  oo_err_forbidden: 'You do not have access to online orders.',
  oo_err_not_found: 'That order does not exist.',
  oo_err_changed: 'This order changed while you were looking at it. Reload and try again.',
  oo_err_has_sale: 'This order was already handed over. Use the sale to cancel it.',
  oo_err_not_cancellable: 'Only a paid order, or one held for review, is cancelled here.',
  oo_err_nothing_to_resolve: 'No payment of this order is waiting for review.',
  oo_err_no_amount_held: 'PayWay did not report an amount for this payment. Check it in ABA and cancel the order instead.',
  oo_err_refund_over_due: 'The refund cannot be more than what is still due.',
  oo_err_amount_invalid: 'Enter the refund amount in dollars.',
  oo_err_request_not_found: 'That request does not exist.',
  oo_err_request_not_pending: 'This request was already answered or taken back.',
  oo_err_request_not_accepted: 'Accept the request first (and only once).',
  oo_err_apply_on_sale: 'This order is already a sale. Apply the change from the sale.',
  oo_err_not_paid: 'Resolve the payment review first.',
  oo_err_address_required: 'The request has no address to apply.',
  oo_err_note_required: 'Write the note first.',
  oo_err_text_too_long: 'That text is too long. Shorten it and try again.',
  oo_err_cursor: 'That page marker is not valid. Reload the list.',
  oo_err_search_short: 'Type at least 3 digits of the phone number or 3 characters of the order number.',
  oo_err_search_invalid: 'That search is too long.',
  online_refund_noted: 'This sale was cancelled and its online payment was refunded through ABA, so it cannot be reopened. Ring a new sale instead.',
  linked_sale_money_locked: 'This sale fulfilled an online order, so its online payment cannot be changed or relabelled. Only settle what is still owed.',
  online_method_requires_order: 'The online payment method is only for fulfilling an online order. Use another payment method for a normal sale.',
  oo_err_payway: 'Online payment is not set up on this server.',
}
/** The sentence for a staff refusal code, in the staff language (`tt` is the pack lookup with its English fallback). */
export const staffMessage = (tt: (key: string, fallback: string) => string, code: unknown): string => {
  const key = staffErrorKey(code)
  return tt(key, STAFF_ERROR_FALLBACK[key] ?? STAFF_ERROR_FALLBACK.oo_err_generic)
}

/**
 * Refusals of the sale and return writers about an online order (POST /api/sales with online_order_id, POST /api/returns with refund_channel 'aba'). They are shown on the till and
 * on Returns, which are admin screens, so their text lives here in the lazy staff chunk and never in the storefront's refusal tables. The Worker's own sentence is English only
 * and some carry a figure (the exact online part, what is left to refund); the pack sentences point at the screen that shows the figure.
 */
export { ONLINE_REFUSAL_KEYS }
export const ONLINE_REFUSAL_FALLBACK: Readonly<Record<string, string>> = {
  oo_err_in_review: 'This order has a payment that needs a look first. Open Orders, resolve it, then fulfil the order.',
  oo_err_other_branch: 'This order belongs to another branch. Fulfil it at that branch\'s till.',
  oo_err_tender_mismatch: 'The online payment on this sale does not match what the customer paid for it. Open the order again from Orders.',
  oo_err_order_changed_till: 'This online order changed while the sale was being saved. Nothing was recorded. Open the order again.',
  aba_refund_over_online: 'That is more than the customer paid online and has not been refunded yet. Lower the amount, or refund the rest in cash.',
  refund_channel_requires_online_order: 'Only a sale that fulfilled an online order can be refunded through ABA.',
  return_exchange_refund_channel: 'An exchange has no refund to send through ABA. Return the goods first, then refund the difference.',
  oo_err_already_fulfilled: 'This order already has a sale.',
  oo_err_till_not_paid: 'Only a paid online order can be fulfilled. If a payment is on hold, resolve it in Orders first.',
  oo_err_currency: 'This order was paid in a currency that cannot be fulfilled here yet.',
  oo_err_not_found: 'That order does not exist.',
  oo_err_order_invalid: 'That is not a valid online order. Open it again from Orders.',
}
/** The sentence for a coded online-order refusal in the staff language, or null for any other error (the caller then shows what it showed before). */
export function onlineRefusalText(error: unknown, tt: (key: string, fallback: string) => string): string | null {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : null
  const key = typeof code === 'string' ? ONLINE_REFUSAL_KEYS[code] : undefined
  return key ? tt(key, ONLINE_REFUSAL_FALLBACK[key] ?? '') : null
}
