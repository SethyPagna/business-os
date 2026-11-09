// Online orders (KHQR lane, slice S2): the pure core. Tables are migration 0293; routes come in later slices.
//
// What is stored and what is read. The order row stores its state only up to fulfilment. Once a sale exists, the sale (and its
// returns) is the one truth, and onlineOrderView() READS it: nothing here copies a sale status onto the order, so the dozen writers
// that change a sale need no extra write and no undo can leave the order behind.
//
// Everything in this file is a function of its arguments: no clock, no randomness, no I/O. Callers inject `now` and random bytes.

import { roundMoney4, subtractMoney4, sumMoney4 } from './moneyPrecision'
import { computeSaleTotals } from './saleTotals'
import {
  SALE_ITEM_PRICING_VERSION, capturePricingProduct, evaluateCapturedPricingPool, type CapturedPricingLine, type CapturedPricingPool,
} from './saleItemPricing'
import type { PromotionRule } from './promotionRules'
import { NOT_PAID_STATUS, recordedSaleOutstandingUsd, saleStoredState, sumRefundsUsd, type RecordedSaleMoney } from './saleStatusResolution'
import { getPlanLimits } from './planTier'
import type { Env } from '../index'

// ---- vocabulary: the same lists as migration 0293's CHECKs (a test pins them equal) ------------------------------------------

export const ORDER_STATES = ['awaiting_payment', 'qr_failed', 'paid', 'review', 'expired', 'cancelled', 'fulfilled'] as const
export type OrderState = (typeof ORDER_STATES)[number]
export const PAYMENT_STATES = ['awaiting', 'paid', 'expired', 'cancelled', 'review', 'failed'] as const
export type PaymentState = (typeof PAYMENT_STATES)[number]
export const REQUEST_KINDS = ['items', 'fulfilment', 'address', 'contact', 'note', 'cancel', 'return'] as const
export type RequestKind = (typeof REQUEST_KINDS)[number]
export const REQUEST_STAGES = ['paid', 'after_sale'] as const
export type RequestStage = (typeof REQUEST_STAGES)[number]
export const ORDER_EVENTS = [
  'created', 'edited', 'qr_issued', 'qr_failed', 'callback', 'verified_paid', 'late_paid', 'mismatch', 'expired', 'cancelled', 'resolved',
  'fulfilled', 'payment_recorded_on_sale', 'refund_noted', 'request_submitted', 'request_withdrawn', 'request_accepted', 'request_rejected',
  'request_applied', 'order_edited', 'note', 'scrubbed',
] as const
export type OrderEvent = (typeof ORDER_EVENTS)[number]
export const EVENT_SOURCES = ['customer', 'payway', 'sweep', 'staff'] as const
export type EventSource = (typeof EVENT_SOURCES)[number]
const DECISION_EVENTS: readonly string[] = ['request_accepted', 'request_rejected', 'request_withdrawn']

// ---- the order state table ----------------------------------------------------------------------------------------------------

/** Who may move an order from one stored state to another (design A1.2). A self-loop is an edit that keeps the state. */
export const ORDER_TRANSITIONS: Readonly<Record<OrderState, Readonly<Partial<Record<OrderState, readonly EventSource[]>>>>> = Object.freeze({
  awaiting_payment: {
    // qr_failed also by a declined check: an order whose only payment was declined is not waiting for anything, and must not stay "awaiting" forever.
    awaiting_payment: ['customer'], qr_failed: ['customer', 'payway', 'sweep'], paid: ['payway', 'sweep'], review: ['payway', 'sweep'],
    expired: ['sweep'], cancelled: ['customer', 'staff'],
  },
  qr_failed: { awaiting_payment: ['customer'], expired: ['sweep'], cancelled: ['customer', 'staff'] },
  paid: { paid: ['staff'], cancelled: ['staff'], fulfilled: ['staff'] },
  review: { paid: ['staff'], cancelled: ['staff'] },
  // A customer whose QR ran out asks for a new one ("Get a new QR"); a late payment of the old one is still accepted (late_paid).
  // A late payment that does not match the order (a short, a discount) still lands in review: the money is real and a person must look.
  expired: { awaiting_payment: ['customer'], paid: ['payway', 'sweep'], review: ['payway', 'sweep'] },
  cancelled: {},
  fulfilled: {},
})
/** The event an order transition writes. The same transition can name two (a late payment is `late_paid`). */
export function transitionEvent(from: OrderState, to: OrderState): OrderEvent {
  if (from === 'expired' && to === 'paid') return 'late_paid'
  if (to === 'paid' && from === 'review') return 'resolved'
  if (to === 'paid' && from === 'paid') return 'order_edited'
  if (to === 'paid') return 'verified_paid'
  if (to === 'review') return 'mismatch'
  if (to === 'awaiting_payment') return from === 'awaiting_payment' ? 'edited' : 'qr_issued'
  if (to === 'qr_failed') return 'qr_failed'
  if (to === 'expired') return 'expired'
  if (to === 'cancelled') return 'cancelled'
  return 'fulfilled'
}
export function canTransition(from: string, to: string, source: string): boolean {
  if (!(ORDER_STATES as readonly string[]).includes(from) || !(ORDER_STATES as readonly string[]).includes(to)) return false
  const allowed = ORDER_TRANSITIONS[from as OrderState][to as OrderState]
  return !!allowed && (allowed as readonly string[]).includes(source)
}

/** A payment row's own states. Money arrives only through `awaiting -> paid` (a verified check) or `-> review` (a mismatch). */
export const PAYMENT_TRANSITIONS: Readonly<Record<PaymentState, readonly PaymentState[]>> = Object.freeze({
  awaiting: ['paid', 'review', 'expired', 'cancelled', 'failed'],
  expired: ['paid'],
  review: ['paid', 'cancelled'],
  paid: [],
  cancelled: [],
  failed: [],
})
export function canPaymentTransition(from: string, to: string): boolean {
  return Object.prototype.hasOwnProperty.call(PAYMENT_TRANSITIONS, from) && (PAYMENT_TRANSITIONS[from as PaymentState] as readonly string[]).includes(to)
}

// ---- identifiers --------------------------------------------------------------------------------------------------------------

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const CAMBODIA_OFFSET_MS = 7 * 60 * 60 * 1000
/** `W` + business date (Cambodia, YYMMDD) + 4 random characters, e.g. W261109K7Q2. Short enough to read out over the phone. */
export function makeOrderNo(now: Date, random: Uint8Array): string {
  if (!(now instanceof Date) || Number.isNaN(now.getTime()) || random.length < 4) throw new Error('order_no_invalid_input')
  const date = new Date(now.getTime() + CAMBODIA_OFFSET_MS).toISOString().slice(2, 10).replace(/-/g, '')
  let tail = ''
  for (let i = 0; i < 4; i += 1) tail += CROCKFORD[random[i] & 31]
  return `W${date}${tail}`
}
export const isOrderNo = (value: unknown): value is string => typeof value === 'string' && /^W\d{6}[0-9A-HJKMNP-TV-Z]{4}$/.test(value)

const base64Url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
/** 128 random bits as the bookmarkable link token (22 characters). Only its SHA-256 is stored. */
export async function createOrderToken(random: Uint8Array): Promise<{ token: string; hash: string }> {
  if (random.length < 16) throw new Error('order_token_invalid_input')
  const token = base64Url(random.slice(0, 16))
  return { token, hash: await hashOrderToken(token) }
}
export const isOrderToken = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{22}$/.test(value)
export async function hashOrderToken(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// ---- limits (planTier.ts) and the request window (a setting) ------------------------------------------------------------------

export const MAX_LINE_QUANTITY = 99
export type OrderLineInput = { product_id: number; quantity: number }
/** The storefront cart's shape rule: 1..onlineOrderMaxLines distinct products, whole quantities 1..99. Null when valid, else a code. */
export function orderLinesError(lines: unknown, env: Pick<Env, 'PLAN_TIER'>): 'lines_required' | 'too_many_lines' | 'invalid_line' | 'duplicate_product' | null {
  if (!Array.isArray(lines) || lines.length === 0) return 'lines_required'
  if (lines.length > getPlanLimits(env as Env).onlineOrderMaxLines) return 'too_many_lines'
  const seen = new Set<number>()
  for (const line of lines) {
    const row = line as Partial<OrderLineInput> | null
    if (!row || !Number.isSafeInteger(row.product_id) || Number(row.product_id) <= 0
      || !Number.isSafeInteger(row.quantity) || Number(row.quantity) < 1 || Number(row.quantity) > MAX_LINE_QUANTITY) return 'invalid_line'
    if (seen.has(Number(row.product_id))) return 'duplicate_product'
    seen.add(Number(row.product_id))
  }
  return null
}
/** Shop-wide open unpaid orders: the create route refuses once this many are waiting ("We're busy, try again"). */
export const openUnpaidAllowed = (openUnpaidCount: number, env: Pick<Env, 'PLAN_TIER'>): boolean => openUnpaidCount < getPlanLimits(env as Env).onlineOrderOpenUnpaidMax
/** Orders one sweep tick may check with PayWay. */
export const sweepBatchSize = (env: Pick<Env, 'PLAN_TIER'>): number => getPlanLimits(env as Env).onlineOrderSweepMaxPerTick
/** A status poll or callback may spend a PayWay check at most once per this many seconds per payment. */
export function nudgeCheckDue(lastCheckedAt: string | null | undefined, now: Date, env: Pick<Env, 'PLAN_TIER'>): boolean {
  if (!lastCheckedAt) return true
  const last = parseUtc(lastCheckedAt)
  return last === null || now.getTime() - last >= getPlanLimits(env as Env).onlineOrderNudgeCheckSeconds * 1000
}
export const adminPageRows = (env: Pick<Env, 'PLAN_TIER'>): number => getPlanLimits(env as Env).onlineOrderAdminPageRows

export const REQUEST_WINDOW_DAYS_KEY = 'online_order_request_days'
export const REQUEST_WINDOW_DAYS_DEFAULT = 7
/** ABA refunds a KHQR payment for 30 days, so the window never exceeds that. */
export const REQUEST_WINDOW_DAYS_MAX = 30
/** The owner's setting, read raw: a whole number of days 1..30; anything else falls back to the default of 7. */
export function resolveRequestWindowDays(raw: unknown): number {
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : ''
  if (!/^\d{1,3}$/.test(text)) return REQUEST_WINDOW_DAYS_DEFAULT
  const days = Number(text)
  return days >= 1 && days <= REQUEST_WINDOW_DAYS_MAX ? days : REQUEST_WINDOW_DAYS_DEFAULT
}

/** SQLite 'YYYY-MM-DD HH:MM:SS' (UTC) or an ISO string to epoch ms; null when unreadable. */
function parseUtc(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const text = value.trim()
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(text) ? `${text.replace(' ', 'T')}Z` : text
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

// ---- pricing: the sale kernel, then the cent ----------------------------------------------------------------------------------

export type OrderProductRow = Record<string, unknown> & { id: number }
export type PricedOrderLine = { product_id: number; quantity: number; unit_price_usd: number; line_total_usd: number }
export type PricedOrder = {
  lines: PricedOrderLine[]; subtotalUsd: number; calculatedTotalUsd: number; roundingAdjustmentUsd: number
  /** The payable amount in whole cents: what the QR is for and what the till would ask. */
  goodsTotalUsd: number; goodsTotalKhr: number; pricingVersion: number
}

/**
 * Prices a storefront cart exactly as the till prices the same basket. Each line is a captured promotion-priced line (the kernel
 * ceilings every selling price to the cent, sellingPriceCeilCent, and evaluates the promotions), and the subtotal runs through
 * computeSaleTotals (money precision v1), whose settlement rounding makes the payable total a whole cent exactly as it does at the till. `taxUsd` is the amount the caller computed from the shop's tax settings (0 when tax is off): it goes
 * through the same kernel, so a taxed shop's QR amount equals what the till would charge. Delivery is never part of it (staff agree
 * the fee with the customer and it joins the sale at fulfilment).
 */
export function priceOrder(input: {
  lines: readonly OrderLineInput[]
  products: ReadonlyMap<number, OrderProductRow>
  rules: readonly PromotionRule[]
  exchangeRate: number
  now: Date
  taxUsd?: number
}, env: Pick<Env, 'PLAN_TIER'>): PricedOrder {
  const error = orderLinesError(input.lines, env)
  if (error) throw new Error(`order_${error}`)
  const poolLines: CapturedPricingLine[] = input.lines.map((line) => {
    const product = input.products.get(line.product_id)
    if (!product) throw new Error('order_product_missing')
    return { line_key: `p${line.product_id}`, source: 'promotion', product: capturePricingProduct(product), selling_price_input_usd: null, manual: { type: 'none', value: 0 } }
  })
  const pool: CapturedPricingPool = {
    version: 1, pool_key: 'online-order', evaluation_time: input.now.toISOString(), exchange_rate: input.exchangeRate,
    rules: input.rules.filter((rule) => rule.is_active) as PromotionRule[], lines: poolLines,
  }
  const quantities = Object.fromEntries(input.lines.map((line) => [`p${line.product_id}`, line.quantity]))
  const priced = evaluateCapturedPricingPool(pool, quantities)
  const lines = input.lines.map((line) => {
    const amounts = priced.get(`p${line.product_id}`)
    if (!amounts) throw new Error('order_pricing_failed')
    return { product_id: line.product_id, quantity: line.quantity, unit_price_usd: amounts.applied_price_usd, line_total_usd: amounts.total_usd }
  })
  const subtotalUsd = sumMoney4(lines.map((line) => line.line_total_usd))
  const totals = computeSaleTotals({
    moneyPrecisionVersion: 1, subtotalUsd, discountUsd: 0, membershipDiscountUsd: 0, taxUsd: input.taxUsd ?? 0,
    isDelivery: false, deliveryFeeUsd: 0, deliveryFeePaidBy: 'customer', exchangeRate: input.exchangeRate,
    rawAmountPaidUsd: undefined, rawAmountPaidKhr: undefined,
  })
  const goodsTotalUsd = totals.totalUsd
  if (Math.abs(goodsTotalUsd * 100 - Math.round(goodsTotalUsd * 100)) > 1e-6 || !(goodsTotalUsd > 0)) throw new Error('order_total_not_payable')
  return {
    lines, subtotalUsd, calculatedTotalUsd: totals.calculatedTotalUsd ?? goodsTotalUsd, roundingAdjustmentUsd: totals.roundingAdjustmentUsd ?? 0,
    goodsTotalUsd, goodsTotalKhr: totals.totalKhr, pricingVersion: SALE_ITEM_PRICING_VERSION,
  }
}

// ---- is this PayWay answer the money for this order? ---------------------------------------------------------------------------

type CheckLike = { state: string; originalAmount: number | null; totalAmount: number | null; discountAmount: number | null }
export type PaidMatch =
  | { ok: true }
  | { ok: false; reason: 'not_approved' | 'amount_unreadable' | 'amount_mismatch' | 'discount_applied' | 'currency_mismatch' }

/** Whole cents of a USD amount, or null when it is not an exact cent value (no float tolerance beyond representation noise). */
function exactCents(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null
  const cents = Math.round(value * 100)
  return Math.abs(value * 100 - cents) < 1e-6 ? cents : null
}
/**
 * The only test that lets an order become Paid: the server's own check says APPROVED, the amount equals the order's exactly in cents
 * (KHR in whole riel), no discount was applied, and the callback (when it names a currency) agrees with the currency we sent.
 * A partial, an over-payment and an unreadable amount are all NOT a match: they go to review, never to Paid.
 */
export function paidMatchesOrder(
  order: { amount: number; currency: 'USD' | 'KHR' },
  check: CheckLike,
  callbackCurrency?: string | null,
): PaidMatch {
  if (check.state !== 'approved') return { ok: false, reason: 'not_approved' }
  if (callbackCurrency && callbackCurrency.toUpperCase() !== order.currency) return { ok: false, reason: 'currency_mismatch' }
  const paid = check.originalAmount ?? (check.discountAmount ? null : check.totalAmount)
  if (paid === null) return { ok: false, reason: 'amount_unreadable' }
  if (check.discountAmount && check.discountAmount !== 0) return { ok: false, reason: 'discount_applied' }
  if (order.currency === 'KHR') {
    return Number.isInteger(paid) && paid === order.amount ? { ok: true } : { ok: false, reason: Number.isFinite(paid) ? 'amount_mismatch' : 'amount_unreadable' }
  }
  const cents = exactCents(paid)
  const expected = exactCents(order.amount)
  if (cents === null || expected === null) return { ok: false, reason: 'amount_unreadable' }
  return cents === expected ? { ok: true } : { ok: false, reason: 'amount_mismatch' }
}

/** What a verified check does to the payment row (and so to the order): the mapping the callback and the sweep both use. */
export function classifyCheck(order: { amount: number; currency: 'USD' | 'KHR' }, check: CheckLike, callbackCurrency?: string | null): 'paid' | 'review' | 'pending' | 'failed' {
  if (check.state === 'pending') return 'pending'
  if (check.state === 'declined' || check.state === 'cancelled') return 'failed'
  if (check.state === 'refunded') return 'review'
  return paidMatchesOrder(order, check, callbackCurrency).ok ? 'paid' : 'review'
}

// ---- money read for an order (A1.5) -------------------------------------------------------------------------------------------

export type OrderRow = {
  id?: number; state: string; goods_total_usd: number | string; currency?: string; sale_id?: number | null; paid_at?: string | null
  created_at?: string | null; fulfilment?: string
}
export type PaymentRow = { id: number; state: string; paid_amount?: number | string | null; amount?: number | string; purpose?: string }
export type EventRow = {
  id?: number; event: string; payment_id?: number | null; request_id?: number | null; amount_usd?: number | string | null
  sale_id?: number | null; public_comment?: string | null; action_history_id?: number | null
}
export type SaleRow = RecordedSaleMoney & {
  id?: number; sale_status?: unknown; status_before_return?: unknown; return_state?: unknown; delivery_pending?: unknown
  change_usd?: unknown; change_khr?: unknown; created_at?: string | null
}
export type ReturnRow = { id?: number; status?: string | null; total_refund_usd?: unknown; owed_reduction_usd?: unknown; refund_currency?: unknown; refund_channel?: unknown }

const num = (value: unknown): number => (Number.isFinite(Number(value)) ? Number(value) : 0)
const isActiveReturn = (row: ReturnRow): boolean => String(row.status || 'completed') !== 'cancelled'
const returnDebtLowered = (row: ReturnRow): number => num(row.owed_reduction_usd)
const abaCashOut = (row: ReturnRow): number => (row.refund_channel === 'aba' && isActiveReturn(row)
  ? Math.max(0, roundMoney4(num(row.total_refund_usd) - num(row.owed_reduction_usd))) : 0)

export type OrderMoney = {
  /** Money PayWay confirmed (sum of paid payment rows). */
  onlineInUsd: number
  /** Money PayWay took that did not match (a short, a discount, a payment on a QR we had cancelled), held until staff resolve it. Counts toward a refund. */
  heldInReviewUsd: number
  /** The part of it a staff action recorded as tender on the sale. */
  recordedOnSaleUsd: number
  /** Paid online but not yet recorded on the sale (a top-up waiting for the cashier). 0 without a sale. */
  toRecordUsd: number
  /** Refund notes already written. */
  notedUsd: number
  /** What may still be refunded through ABA. */
  refundDueUsd: number
  /** What a linked sale still owes (Not Paid sale). 0 when covered or without a sale. */
  balanceDueUsd: number
}

/** Dollars the customer paid beyond what the sale asks, after returns that lowered a debt and after change handed back. */
function saleOverpaidUsd(sale: SaleRow, returns: readonly ReturnRow[]): number {
  const rate = num(sale.exchange_rate)
  const paidUsd = num(sale.amount_paid_usd) + (rate > 0 ? num(sale.amount_paid_khr) / rate : 0)
  const changeUsd = num(sale.change_usd) + (rate > 0 ? num(sale.change_khr) / rate : 0)
  const payable = subtractMoney4(num(sale.total_usd), num(sumRefundsUsd(returns.filter(isActiveReturn).map(returnDebtLowered))))
  return Math.max(0, roundMoney4(paidUsd - changeUsd - payable))
}

export function orderMoney(order: OrderRow, payments: readonly PaymentRow[], events: readonly EventRow[], sale: SaleRow | null, returns: readonly ReturnRow[] = []): OrderMoney {
  const paid = payments.filter((p) => p.state === 'paid')
  const amountOf = (p: PaymentRow): number => num(p.paid_amount ?? p.amount)
  const onlineInUsd = sumMoney4(paid.map(amountOf))
  // Only what PayWay actually took: a review row without a stored amount (written before it was kept) holds nothing we can name.
  const heldInReviewUsd = sumMoney4(payments.filter((p) => p.state === 'review').map((p) => num(p.paid_amount)))
  const recordedIds = new Set(events.filter((e) => e.event === 'payment_recorded_on_sale' && e.payment_id != null).map((e) => Number(e.payment_id)))
  const recordedOnSaleUsd = sumMoney4(paid.filter((p) => recordedIds.has(Number(p.id))).map(amountOf))
  const refunds = events.filter((e) => e.event === 'refund_noted')
  const notedUsd = sumMoney4(refunds.map((e) => num(e.amount_usd)))
  const notedAfterSaleUsd = sumMoney4(refunds.filter((e) => e.sale_id != null).map((e) => num(e.amount_usd)))
  const goods = num(order.goods_total_usd)
  let refundDue: number
  let balanceDueUsd = 0
  let toRecordUsd = 0
  if (!sale) {
    const receivedUsd = sumMoney4([onlineInUsd, heldInReviewUsd])
    refundDue = order.state === 'cancelled' ? receivedUsd - notedUsd : Math.max(0, roundMoney4(receivedUsd - goods)) - notedUsd
  } else {
    toRecordUsd = Math.max(0, roundMoney4(onlineInUsd - recordedOnSaleUsd))
    const stored = saleStoredState(sale)
    if (stored.saleStatus === 'cancelled') {
      refundDue = recordedOnSaleUsd - sumMoney4(returns.map(abaCashOut)) - notedUsd
    } else {
      refundDue = saleOverpaidUsd(sale, returns) - notedAfterSaleUsd
      if (stored.saleStatus === NOT_PAID_STATUS) {
        try {
          balanceDueUsd = recordedSaleOutstandingUsd({ ...sale, refund_usd: sumRefundsUsd(returns.filter(isActiveReturn).map(returnDebtLowered)) })
        } catch { balanceDueUsd = 0 }
      }
    }
  }
  return { onlineInUsd, heldInReviewUsd, recordedOnSaleUsd, toRecordUsd, notedUsd, refundDueUsd: Math.max(0, roundMoney4(refundDue)), balanceDueUsd }
}
export const refundDueUsd = (order: OrderRow, payments: readonly PaymentRow[], events: readonly EventRow[], sale: SaleRow | null, returns: readonly ReturnRow[] = []): number =>
  orderMoney(order, payments, events, sale, returns).refundDueUsd
/** A refund note may not exceed what is still due, and must be a positive whole-cent amount. */
export function refundNoteAllowed(amountUsd: number, dueUsd: number): boolean {
  const cents = exactCents(amountUsd)
  return cents !== null && cents > 0 && cents <= Math.round(dueUsd * 100 + 1e-6)
}

// ---- requests: state read from events -----------------------------------------------------------------------------------------

export type RequestRow = { id: number; kind: string; stage: string; created_at?: string | null }
export type RequestStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'applied' | 'reversed'
export type RequestState = { id: number; kind: string; status: RequestStatus; publicComment: string | null }

/**
 * Each request's state, read from the order's events (no copied column): no decision event = pending; an accept with an apply event =
 * applied; an applied request whose recorded history entry was later undone = reversed. `undoneHistoryIds` carries the ids whose
 * action_history status is now 'redoable'.
 */
export function requestStates(requests: readonly RequestRow[], events: readonly EventRow[], undoneHistoryIds: ReadonlySet<number> = new Set()): RequestState[] {
  return requests.map((request) => {
    const own = events.filter((e) => e.request_id === request.id)
    const decision = own.find((e) => DECISION_EVENTS.includes(e.event))
    const applied = own.find((e) => e.event === 'request_applied')
    let status: RequestStatus = 'pending'
    if (decision?.event === 'request_rejected') status = 'rejected'
    else if (decision?.event === 'request_withdrawn') status = 'withdrawn'
    else if (applied) status = applied.action_history_id != null && undoneHistoryIds.has(Number(applied.action_history_id)) ? 'reversed' : 'applied'
    else if (decision?.event === 'request_accepted') status = 'accepted'
    return { id: request.id, kind: request.kind, status, publicComment: decision?.public_comment ?? null }
  })
}

export type RequestRefusal = 'not_ready' | 'window_closed' | 'closed_order' | 'one_pending' | 'too_many' | 'kind_not_allowed'
/** What a customer may ask for at each stage (A2.1): a return only once there is a sale. */
export function requestKindsForStage(stage: RequestStage): readonly RequestKind[] {
  return stage === 'paid' ? ['items', 'fulfilment', 'address', 'contact', 'note', 'cancel'] : ['items', 'fulfilment', 'address', 'contact', 'note', 'cancel', 'return']
}
export function requestStage(order: OrderRow): RequestStage | null {
  return order.state === 'paid' || order.state === 'review' ? 'paid' : order.state === 'fulfilled' ? 'after_sale' : null
}
/** The moment the window opens: payment, or the sale if that came later (a return clock starts at hand-over). */
export function requestWindowStart(order: OrderRow, sale: SaleRow | null): number | null {
  const times = [parseUtc(order.paid_at), sale ? parseUtc(sale.created_at) : null].filter((t): t is number => t !== null)
  return times.length ? Math.max(...times) : parseUtc(order.created_at)
}
export function requestWindowOpen(order: OrderRow, sale: SaleRow | null, now: Date, windowDays: number): boolean {
  const start = requestWindowStart(order, sale)
  return start !== null && now.getTime() <= start + windowDays * 24 * 60 * 60 * 1000
}

export function requestAllowed(input: {
  order: OrderRow; payments: readonly PaymentRow[]; sale: SaleRow | null; returns?: readonly ReturnRow[]; requests: readonly RequestRow[]; events: readonly EventRow[]
  kind: string; now: Date; windowDays: number; undoneHistoryIds?: ReadonlySet<number>
}, env: Pick<Env, 'PLAN_TIER'>): { ok: true; stage: RequestStage } | { ok: false; reason: RequestRefusal } {
  const stage = requestStage(input.order)
  if (!stage) return { ok: false, reason: 'not_ready' }
  if (!(requestKindsForStage(stage) as readonly string[]).includes(input.kind)) return { ok: false, reason: 'kind_not_allowed' }
  if (input.sale) {
    const stored = saleStoredState(input.sale)
    const returns = input.returns ?? []
    const fullyReturned = stored.returnState === 'full'
    if (stored.saleStatus === 'cancelled' || fullyReturned) {
      const money = orderMoney(input.order, input.payments, input.events, input.sale, returns)
      if (money.refundDueUsd === 0) return { ok: false, reason: 'closed_order' }
    }
  }
  if (!requestWindowOpen(input.order, input.sale, input.now, input.windowDays)) return { ok: false, reason: 'window_closed' }
  const states = requestStates(input.requests, input.events, input.undoneHistoryIds)
  if (states.some((s) => s.status === 'pending')) return { ok: false, reason: 'one_pending' }
  if (input.requests.length >= getPlanLimits(env as Env).onlineOrderRequestMax) return { ok: false, reason: 'too_many' }
  return { ok: true, stage }
}

// ---- the one view the order page, the admin list and Telegram all read --------------------------------------------------------

export type ViewStatus =
  | 'awaiting_payment' | 'qr_failed' | 'paid' | 'review' | 'expired' | 'cancelled'
  | 'completed' | 'balance_due' | 'delivery_pending' | 'sale_cancelled'
export type ViewChip =
  | 'refund_due' | 'balance_due' | 'to_record' | 'partly_returned' | 'returned' | 'check_refund' | 'late' | 'needs_review' | 'accepted_not_applied' | 'request_pending'
export type OnlineOrderView = {
  phase: 'before_sale' | 'after_sale'
  status: ViewStatus
  chips: ViewChip[]
  money: OrderMoney
  requestsOpen: boolean
}

/**
 * The order as everyone reads it. Before a sale it is the stored state; after, it is the sale's own state (Completed, Balance due,
 * Delivery pending, Cancelled) with chips for what is owed either way. Nothing is written to make this true, so an undo of any sale
 * action changes the view without touching the order row.
 */
export function onlineOrderView(
  order: OrderRow, payments: readonly PaymentRow[], events: readonly EventRow[], sale: SaleRow | null, returns: readonly ReturnRow[] = [],
  options: { now?: Date; requestWindowDays?: number; requests?: readonly RequestRow[]; undoneHistoryIds?: ReadonlySet<number> } = {},
): OnlineOrderView {
  const money = orderMoney(order, payments, events, sale, returns)
  const chips: ViewChip[] = []
  let status: ViewStatus
  let phase: OnlineOrderView['phase'] = 'before_sale'
  if (!sale) {
    status = order.state as ViewStatus
  } else {
    phase = 'after_sale'
    const stored = saleStoredState(sale)
    if (stored.saleStatus === 'cancelled') status = 'sale_cancelled'
    else if (stored.saleStatus === NOT_PAID_STATUS) status = 'balance_due'
    else if (stored.deliveryPending) status = 'delivery_pending'
    else status = 'completed'
    if (stored.returnState === 'partial') chips.push('partly_returned')
    if (stored.returnState === 'full') chips.push('returned')
    if (money.balanceDueUsd > 0) chips.push('balance_due')
    if (money.toRecordUsd > 0) chips.push('to_record')
    if (returns.some((r) => !isActiveReturn(r) && r.refund_channel === 'aba' && num(r.total_refund_usd) > 0)) chips.push('check_refund')
  }
  // Review is about money, not only the order's own state: a mismatched top-up, or a payment that arrived on a QR we had cancelled, leaves the order
  // `paid` or `cancelled` but still needs a person.
  if (order.state === 'review' || payments.some((p) => p.state === 'review')) chips.push('needs_review')
  if (money.refundDueUsd > 0) chips.push('refund_due')
  if (events.some((e) => e.event === 'late_paid')) chips.push('late')
  if (options.requests) {
    const states = requestStates(options.requests, events, options.undoneHistoryIds)
    if (states.some((s) => s.status === 'pending')) chips.push('request_pending')
    if (states.some((s) => s.status === 'accepted')) chips.push('accepted_not_applied')
  }
  const requestsOpen = options.now !== undefined && requestStage(order) !== null
    && requestWindowOpen(order, sale, options.now, options.requestWindowDays ?? REQUEST_WINDOW_DAYS_DEFAULT)
  return { phase, status, chips, money, requestsOpen }
}
