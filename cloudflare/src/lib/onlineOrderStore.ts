// Online orders (KHQR lane, slice S3): the database half of the storefront order API. routes/portalOrders.ts is the HTTP half.
//
// Every write here is one guarded D1 batch: a statement that must not run unless the one before it changed its row says so in its own
// WHERE (a revision that moved, or `changes()`), so the order, its payment and its Records row commit together or not at all. Reads that
// decide something (stock, caps, whether a request is allowed) run first; the guards only close the race between that read and the write.
//
// Personal data: the order row holds the customer's contact details (scrubbed after 90 days when never paid, a later slice). The events
// never do: detail_json carries counts, field NAMES and amounts, never a name, phone, address or comment. network_key is a keyed hash
// of the network, never an address.
//
// PayWay is reached only through the injected transport, and only with credentials the caller read from the environment. A reason
// word is all a failure keeps; no URL, header or key is ever stored or returned.

import type { D1Compat } from './db'
import type { Env } from '../index'
import { canonicalizePhone } from './phone'
import { normalizePromotionRule, isRuleActive, type PromotionRule } from './promotionRules'
import { percentageMoney4 } from './moneyPrecision'
import { getPlanLimits, ONLINE_ORDER_FALLBACK_EXCHANGE_RATE } from './planTier'
import { getMaintenance } from './maintenance'
import { resolveTaxSettings } from './saleAmendments'
import {
  PaywayError, callbackUrlFor, checkTransaction, closeTransaction, generateQr, makeTranId,
  type ParsedCheck, type PaywayCredentials, type PaywayFailureReason, type PaywayTransport,
} from './payway'
import {
  PAYMENT_MINUTES_DEFAULT, PAYMENT_MINUTES_KEY, PAYMENT_MINUTES_MAX, PAYMENT_MINUTES_MIN, REQUEST_WINDOW_DAYS_KEY, canTransition, classifyCheck, createOrderToken, hashOrderToken, makeOrderNo, nudgeCheckDue, onlineOrderView, orderMoneyWire,
  openUnpaidAllowed, orderLinesError, priceOrder, requestAllowed, requestKindsForStage, requestStates, requestStage, resolveRequestWindowDays,
  type EventRow, type OrderLineInput, type OrderRow, type PaymentRow, type PricedOrder, type RequestKind, type RequestRow, type ReturnRow, type SaleRow,
} from './onlineOrders'

// ---- errors: plain words a customer can act on --------------------------------------------------------------------------------

export class OrderError extends Error {
  readonly status: number
  readonly code: string
  readonly extra: Record<string, unknown>
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message)
    this.name = 'OrderError'
    this.status = status
    this.code = code
    this.extra = extra
  }
}
export const refuse = (status: number, code: string, message: string, extra?: Record<string, unknown>): never => { throw new OrderError(status, code, message, extra) }

/** What a customer reads for each PayWay reason. A configuration fault is the shop's to fix, so it says "contact the shop", not "try again". */
export function paymentFailureMessage(reason: PaywayFailureReason): { code: string; message: string; retryable: boolean } {
  switch (reason) {
    case 'limit_exceeded': return { code: 'payment_limit', message: 'This amount is above what ABA allows for one payment. Please contact the shop to pay another way.', retryable: false }
    case 'amount_too_small': return { code: 'payment_amount_too_small', message: 'This amount is below the smallest payment ABA accepts. Please add an item or contact the shop.', retryable: false }
    case 'rate_limited':
    case 'transport_failed':
    case 'bad_response':
    case 'duplicate_tran_id':
    case 'unknown': return { code: 'payment_busy', message: 'The payment service is busy. Nothing was charged. Please try again in a minute.', retryable: true }
    default: return { code: 'payment_unavailable', message: 'Online payment is not available right now. Nothing was charged. Please contact the shop.', retryable: false }
  }
}

// ---- clock, ids -----------------------------------------------------------------------------------------------------------------

export type OrderDeps = {
  db: D1Compat
  env: Env
  now: () => Date
  random: (length: number) => Uint8Array
  transport: PaywayTransport
  /** https origin ABA posts its callback to (the storefront host). Null leaves the callback URL out; the sweep and polls still find the payment. */
  origin: string | null
  /**
   * Tells the shop (Telegram, lib/onlineOrderAlerts.ts) about a committed change. Optional: absent in every pure test and costs nothing. It is called
   * once per GUARDED transition (a replayed check or a lost race changes nothing, so announces nothing) and must never throw into the order flow.
   */
  notify?: (event: OrderAlertEvent) => Promise<void>
}
/**
 * Every committed change an order goes through, once per guarded transition. The same stream feeds the shop's Telegram (lib/onlineOrderAlerts.ts,
 * which composes nothing for the kinds the shop does not need to read) and the live refresh (version bump + broadcast), so a staff tab never shows
 * an order the customer's payment already moved.
 */
export type OrderAlertEvent =
  | { kind: 'qr_failed' | 'edited' | 'cancelled' | 'changed'; orderId: number }
  | { kind: 'created'; orderId: number; rateFallback?: boolean }
  | { kind: 'paid' | 'review' | 'failed'; orderId: number; paymentId: number }
  | { kind: 'request'; orderId: number; requestId: number; requestKind: string }
  | { kind: 'withdrawn'; orderId: number; requestId: number; requestKind: string }
  | { kind: 'expired'; expired: Array<{ orderId: number; paymentId: number; purpose: string }> }
  | { kind: 'unknown_payment'; tranId: string }
  // Staff actions (lib/onlineOrderStaff.ts): the screens refresh for every one; the chat hears of a refund, a decision and an applied change.
  | { kind: 'staff'; orderId: number }
  | { kind: 'refund'; orderId: number; amountUsd: number }
  | { kind: 'decided'; orderId: number; requestKind: string; accepted: boolean }
  | { kind: 'applied'; orderId: number; requestKind: string; topUpUsd: number }
const announce = async (deps: OrderDeps, event: OrderAlertEvent): Promise<void> => {
  if (!deps.notify) return
  try { await deps.notify(event) } catch { /* an alert must never fail the order */ }
}
export { announce as announceOrderEvent }
export const sqlTime = (date: Date): string => date.toISOString().replace('T', ' ').replace('Z', '')

// ---- shapes of the rows ---------------------------------------------------------------------------------------------------------

export type OrderRecord = OrderRow & {
  id: number; order_no: string; token_hash: string; state: string; fulfilment: string; branch_id: number
  customer_name: string; customer_phone: string; customer_address: string | null
  contact_telegram: string | null; contact_instagram: string | null; contact_facebook: string | null
  contact_tiktok: string | null; contact_whatsapp: string | null; contact_other: string | null
  note: string | null; portal_account_id: number | null; currency: 'USD' | 'KHR'
  goods_total_usd: number; goods_total_khr: number | null; exchange_rate: number | null; items_json: string
  pricing_version: number; sale_id: number | null; paid_at: string | null; revision: number; created_at: string; updated_at: string | null
  /** Set by the 90 day privacy scrub (lib/onlineOrderScrub.ts): the contact details are gone and the order is closed for good. */
  scrubbed_at?: string | null
}
export type PaymentRecord = PaymentRow & {
  id: number; order_id: number; tran_id: string; purpose: 'order' | 'top_up'; request_id: number | null; amount: number; currency: 'USD' | 'KHR'
  state: string; qr_string: string | null; deeplink: string | null; expires_at: string | null; last_checked_at: string | null
  paid_at: string | null; paid_amount: number | null; revision: number; created_at: string
}
export type RequestRecord = RequestRow & {
  id: number; order_id: number; kind: string; stage: string; before_json: string; after_json: string
  customer_comment: string | null; attachments_json: string | null; created_at: string
}
export type OrderBundle = {
  order: OrderRecord
  payments: PaymentRecord[]
  events: EventRow[]
  requests: RequestRecord[]
  sale: SaleRow | null
  returns: ReturnRow[]
}

// ---- settings --------------------------------------------------------------------------------------------------------------------

export { PAYMENT_MINUTES_KEY, PAYMENT_MINUTES_DEFAULT }
export type OrderSettings = { exchangeRate: number; rateIsFallback: boolean; taxPercent: number; showPrices: boolean; paymentMinutes: number; requestWindowDays: number }
const SETTING_KEYS = ['exchange_rate', 'tax_enabled', 'tax_rate', 'customer_portal_show_prices', PAYMENT_MINUTES_KEY, REQUEST_WINDOW_DAYS_KEY] as const

/** Payment minutes: a whole number 3..60 (ABA's own floor is 3); anything else is the default of 15. */
export function resolvePaymentMinutes(raw: unknown): number {
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : ''
  if (!/^\d{1,3}$/.test(text)) return PAYMENT_MINUTES_DEFAULT
  const minutes = Number(text)
  return minutes >= PAYMENT_MINUTES_MIN && minutes <= PAYMENT_MINUTES_MAX ? minutes : PAYMENT_MINUTES_DEFAULT
}

let rateFallbackLogged = false
/**
 * The configured exchange rate is read on every order. When it is missing or unusable the order is priced at the plan's fallback rate (planTier ONLINE_ORDER_FALLBACK_EXCHANGE_RATE):
 * that is never silent. The Worker logs it (once per isolate, so a busy shop does not flood the log) and the new-order notice and the order's created Record say so.
 */
function noteRateFallback(settings: OrderSettings): void {
  if (!settings.rateIsFallback || rateFallbackLogged) return
  rateFallbackLogged = true
  console.error('[online-orders] the exchange_rate setting is missing or invalid: orders are priced at the fallback rate until it is set')
}
export function resetRateFallbackLogForTests(): void { rateFallbackLogged = false }

/** One keyed read: never loadSettingsMap, which reads every settings row. */
export async function loadOrderSettings(db: D1Compat): Promise<OrderSettings> {
  const rows = await db.prepare(`SELECT key, value FROM settings WHERE key IN (${SETTING_KEYS.map((_, i) => `@k${i}`).join(',')})`)
    .all<{ key: string; value: string }>(Object.fromEntries(SETTING_KEYS.map((key, i) => [`k${i}`, key])))
  const map = Object.fromEntries((rows || []).map((row) => [row.key, row.value]))
  const rate = Number(map.exchange_rate)
  const tax = resolveTaxSettings(map.tax_enabled, map.tax_rate, 1)
  const shows = String(map.customer_portal_show_prices ?? '').trim().toLowerCase()
  const loaded: OrderSettings = {
    exchangeRate: Number.isFinite(rate) && rate > 0 ? rate : ONLINE_ORDER_FALLBACK_EXCHANGE_RATE,
    rateIsFallback: !(Number.isFinite(rate) && rate > 0),
    taxPercent: tax.enabled ? (tax.percent ?? 0) : 0,
    showPrices: shows === '' ? true : ['1', 'true', 'yes', 'on'].includes(shows),
    paymentMinutes: resolvePaymentMinutes(map[PAYMENT_MINUTES_KEY]),
    requestWindowDays: resolveRequestWindowDays(map[REQUEST_WINDOW_DAYS_KEY]),
  }
  noteRateFallback(loaded)
  return loaded
}

// ---- what the customer typed -----------------------------------------------------------------------------------------------------

export const CONTACT_FIELDS = ['telegram', 'instagram', 'facebook', 'tiktok', 'whatsapp', 'other'] as const
export type Contacts = Record<(typeof CONTACT_FIELDS)[number], string | null>
const CONTROL = /[\u0000-\u001f\u007f]/g

function cleanText(value: unknown, max: number, field: string, label: string): string | null {
  if (value == null) return null
  if (typeof value !== 'string') return refuse(400, `${field}_invalid`, `${label} must be text.`)
  const text = value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim()
  if (!text) return null
  if (text.length > max) return refuse(400, `${field}_too_long`, `${label} is too long. Please keep it under ${max} characters.`)
  return text
}
export function normalizeContacts(value: unknown): Contacts {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return Object.fromEntries(CONTACT_FIELDS.map((field) => [field, cleanText(source[field], 100, `contact_${field}`, `The ${field} contact`)])) as Contacts
}
export function normalizeName(value: unknown): string {
  const name = cleanText(value, 60, 'name', 'Your name')
  return name ?? refuse(400, 'name_required', 'Please enter your name.')
}
export function normalizePhone(value: unknown): string {
  const phone = canonicalizePhone(value)
  if (!phone || phone.length < 8 || phone.length > 15) return refuse(400, 'phone_invalid', 'Please enter a phone number we can call, for example 012 345 678.')
  return phone
}
export function normalizeFulfilment(value: unknown, address: string | null): 'pickup' | 'delivery' {
  const fulfilment = value == null || value === '' ? 'pickup' : value
  if (fulfilment !== 'pickup' && fulfilment !== 'delivery') return refuse(400, 'fulfilment_invalid', 'Choose pickup or delivery.')
  if (fulfilment === 'delivery' && !address) {
    return refuse(400, 'address_required', 'Please enter your delivery address. Our staff will contact you about the delivery price and time.')
  }
  return fulfilment
}
export const addressFor = (fulfilment: 'pickup' | 'delivery', address: string | null): string | null => (fulfilment === 'delivery' ? address : null)
export const normalizeAddress = (value: unknown): string | null => cleanText(value, 300, 'address', 'The address')
export const normalizeNote = (value: unknown): string | null => cleanText(value, 300, 'note', 'The note')
export const normalizeComment = (value: unknown): string | null => cleanText(value, 300, 'comment', 'The comment')

export type OrderInput = {
  lines: OrderLineInput[]; name: string; phone: string; fulfilment: 'pickup' | 'delivery'; address: string | null; note: string | null; contacts: Contacts
}
export function parseLines(value: unknown, env: Pick<Env, 'PLAN_TIER'>): OrderLineInput[] {
  const error = orderLinesError(value, env)
  if (error === 'lines_required') return refuse(400, 'lines_required', 'Your list is empty. Add at least one item.')
  if (error === 'too_many_lines') return refuse(400, 'too_many_lines', 'There are too many different items in one order. Please split it into two orders.')
  if (error === 'invalid_line') return refuse(400, 'invalid_line', 'Each item needs a quantity between 1 and 99.')
  if (error === 'duplicate_product') return refuse(400, 'duplicate_product', 'An item appears twice. Please combine it into one line.')
  return (value as OrderLineInput[]).map((line) => ({ product_id: Number(line.product_id), quantity: Number(line.quantity) }))
}
export function parseOrderInput(body: Record<string, unknown>, env: Pick<Env, 'PLAN_TIER'>): OrderInput {
  const typed = normalizeAddress(body.address)
  const fulfilment = normalizeFulfilment(body.fulfilment, typed)
  return {
    lines: parseLines(body.lines, env), name: normalizeName(body.name), phone: normalizePhone(body.phone),
    // Review F9: the address is kept only for delivery; a pickup order never stores one, whatever the client sent.
    fulfilment, address: addressFor(fulfilment, typed),
    note: normalizeNote(body.note), contacts: normalizeContacts(body.contacts),
  }
}

/** Attachments are references to files already uploaded through the shop's upload path (file_assets.public_path): never inline data. */
export async function resolveAttachments(db: D1Compat, value: unknown, max = 4): Promise<string[]> {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > max) return refuse(400, 'attachments_invalid', `You can attach up to ${max} pictures.`)
  const paths = [...new Set(value.map((item) => (typeof item === 'string' ? item.trim() : '')))]
  if (paths.some((path) => !/^\/uploads\/[A-Za-z0-9._-]{1,200}$/.test(path))) return refuse(400, 'attachments_invalid', 'A picture could not be attached. Upload it again and retry.')
  if (!paths.length) return []
  const rows = await db.prepare(`SELECT public_path FROM file_assets WHERE media_type = 'image' AND public_path IN (${paths.map((_, i) => `@p${i}`).join(',')})`)
    .all<{ public_path: string }>(Object.fromEntries(paths.map((path, i) => [`p${i}`, path])))
  const found = new Set((rows || []).map((row) => row.public_path))
  if (paths.some((path) => !found.has(path))) return refuse(400, 'attachments_invalid', 'A picture could not be found. Upload it again and retry.')
  return paths
}

// ---- reading the catalogue the way the till does ----------------------------------------------------------------------------------

export async function findSellingBranch(db: D1Compat): Promise<{ id: number; name: string } | null> {
  const row = await db.prepare(`
    SELECT b.id, b.name FROM branches b
    WHERE COALESCE(b.is_active,1)=1 AND lower(trim(COALESCE(b.role,b.name)))='shop'
    ORDER BY COALESCE(b.is_default,0) DESC, b.id ASC LIMIT 1
  `).get<{ id: number; name: string }>()
  return row ?? null
}

export type PricingFacts = { priced: PricedOrder; products: Map<number, Record<string, unknown> & { id: number; name?: string }>; branchId: number }

/** Prices a cart from live rows with the till's kernel and checks the selling branch holds every unit. Throws OrderError with the item names. */
export async function priceAndCheckStock(deps: OrderDeps, lines: OrderLineInput[], settings: OrderSettings): Promise<PricingFacts> {
  const { db, env } = deps
  const now = deps.now()
  const branch = await findSellingBranch(db)
  if (!branch) return refuse(503, 'shop_not_ready', 'The shop is not taking online orders right now. Please try again later.')
  const ids = lines.map((line) => line.product_id)
  const named = (list: number[]) => list.map((_, i) => `@id${i}`).join(',')
  const idParams = Object.fromEntries(ids.map((id, i) => [`id${i}`, id]))
  const [productRows, stockRows, ruleRows] = await Promise.all([
    db.prepare(`SELECT * FROM products WHERE id IN (${named(ids)})`).all<Record<string, unknown> & { id: number }>(idParams),
    db.prepare(`SELECT product_id, COALESCE(quantity,0) AS quantity FROM branch_stock WHERE branch_id=@branch AND product_id IN (${named(ids)})`)
      .all<{ product_id: number; quantity: number }>({ ...idParams, branch: branch.id }),
    db.prepare('SELECT * FROM promotion_rules WHERE is_active = 1 ORDER BY id ASC').all<Record<string, unknown>>(),
  ])
  const products = new Map((productRows || []).map((row) => [Number(row.id), row]))
  const sellable = (row: (Record<string, unknown> & { id: number }) | undefined) => Boolean(row) && Number(row!.is_active) === 1 && Number(row!.selling_price_usd) > 0
  const unavailable = ids.filter((id) => !sellable(products.get(id)))
  if (unavailable.length || !settings.showPrices) {
    return refuse(409, 'product_unavailable', 'An item in your list is no longer available. Please remove it and try again.', { product_ids: unavailable })
  }
  const stock = new Map((stockRows || []).map((row) => [Number(row.product_id), Number(row.quantity)]))
  const short = lines.filter((line) => (stock.get(line.product_id) ?? 0) < line.quantity)
    .map((line) => ({ product_id: line.product_id, name: String(products.get(line.product_id)?.name ?? ''), available: Math.max(0, Math.floor(stock.get(line.product_id) ?? 0)) }))
  if (short.length) return refuse(409, 'out_of_stock', 'Some items are not in stock in the quantity you asked for. Please lower the quantity or remove them.', { items: short })
  const rules = (ruleRows || []).map((row) => normalizePromotionRule(row, 1)).filter((rule): rule is PromotionRule => Boolean(rule) && isRuleActive(rule, now))
  if (rules.length > 100) return refuse(503, 'shop_not_ready', 'The shop is not taking online orders right now. Please try again later.')
  const price = (taxUsd: number) => {
    try {
      return priceOrder({ lines, products, rules, exchangeRate: settings.exchangeRate, now, taxUsd }, env)
    } catch {
      return refuse(409, 'pricing_failed', 'We could not work out the price of this order. Please contact the shop.')
    }
  }
  let priced = price(0)
  if (settings.taxPercent > 0) priced = price(percentageMoney4(priced.subtotalUsd, settings.taxPercent))
  return { priced, products, branchId: branch.id }
}

export function itemsJson(facts: PricingFacts): string {
  return JSON.stringify(facts.priced.lines.map((line) => ({
    product_id: line.product_id, name: String(facts.products.get(line.product_id)?.name ?? '').slice(0, 120), quantity: line.quantity,
    unit_price_usd: line.unit_price_usd, line_total_usd: line.line_total_usd,
  })))
}

// ---- caps through indexed reads -----------------------------------------------------------------------------------------------------

/**
 * What "live" means for a payment waiting for money (review F5): its QR has not run out, or (no QR yet) it was created within the issue grace. A payment past either is a
 * stale row the cron sweep has not reached yet: it holds nobody's money and must not make the shop look busy or block a real customer's next order.
 */
export type LiveCutoffs = { now: string; fresh: string }
export function liveCutoffs(env: Pick<Env, 'PLAN_TIER'>, now: Date): LiveCutoffs {
  return { now: sqlTime(now), fresh: sqlTime(new Date(now.getTime() - getPlanLimits(env as Env).onlineOrderQrIssueGraceSeconds * 1000)) }
}
const LIVE_PAYMENT = `p.state = 'awaiting' AND (p.expires_at > @now OR (p.expires_at IS NULL AND p.created_at > @fresh))`

/** Orders waiting for money, shop-wide: the count of LIVE payments (the partial index on expires_at, once for the unexpired and once for the not-yet-issued), never a scan of orders. */
export async function countOpenPayments(db: D1Compat, cut: LiveCutoffs): Promise<number> {
  const row = await db.prepare(`SELECT
      (SELECT COUNT(*) FROM online_order_payments p INDEXED BY idx_online_order_payments_open WHERE p.state = 'awaiting' AND p.expires_at > @now)
      + (SELECT COUNT(*) FROM online_order_payments p INDEXED BY idx_online_order_payments_open WHERE p.state = 'awaiting' AND p.expires_at IS NULL AND p.created_at > @fresh) AS n`).get<{ n: number }>(cut)
  return Number(row?.n ?? 0)
}
/** The same set, narrowed to one phone. It walks the live open payments (bounded by the shop-wide cap) and probes each order by primary key. */
export async function countOpenPaymentsForPhone(db: D1Compat, phone: string, cut: LiveCutoffs): Promise<number> {
  const row = await db.prepare(`
    SELECT COUNT(DISTINCT o.id) AS n
    FROM online_order_payments p INDEXED BY idx_online_order_payments_open CROSS JOIN online_orders o ON o.id = p.order_id
    WHERE ${LIVE_PAYMENT} AND o.customer_phone = @phone
  `).get<{ n: number }>({ phone, ...cut })
  return Number(row?.n ?? 0)
}
/** The same set, narrowed to one NETWORK (online_orders.network_key, the keyed hash): migration 0301's partial index, then each order's payments by their own index. */
export async function countOpenOrdersForNetwork(db: D1Compat, networkKey: string, cut: LiveCutoffs): Promise<number> {
  const row = await db.prepare(`
    SELECT COUNT(*) AS n FROM online_orders o INDEXED BY idx_online_orders_open_network
    WHERE o.state = 'awaiting_payment' AND o.network_key = @network
      AND EXISTS (SELECT 1 FROM online_order_payments p WHERE p.order_id = o.id AND ${LIVE_PAYMENT})
  `).get<{ n: number }>({ network: networkKey, ...cut })
  return Number(row?.n ?? 0)
}

// ---- loading an order ---------------------------------------------------------------------------------------------------------------

const SALE_COLUMNS = '*'
export async function loadBundle(db: D1Compat, tokenHash: string): Promise<OrderBundle | null> {
  const owner = '(SELECT id FROM online_orders WHERE token_hash = @h)'
  const results = await db.batch([
    { sql: 'SELECT * FROM online_orders WHERE token_hash = @h', params: { h: tokenHash } },
    { sql: `SELECT * FROM online_order_payments WHERE order_id = ${owner} ORDER BY id ASC`, params: { h: tokenHash } },
    { sql: `SELECT id, event, payment_id, request_id, amount_usd, sale_id, public_comment, action_history_id, created_at FROM online_order_events WHERE order_id = ${owner} ORDER BY id ASC`, params: { h: tokenHash } },
    { sql: `SELECT * FROM online_order_requests WHERE order_id = ${owner} ORDER BY id ASC`, params: { h: tokenHash } },
  ])
  const rows = (index: number): unknown[] => (results[index] as { results?: unknown[] } | undefined)?.results ?? []
  const order = rows(0)[0] as OrderRecord | undefined
  if (!order) return null
  let sale: SaleRow | null = null
  let returns: ReturnRow[] = []
  if (order.sale_id != null) {
    const [saleRows, returnRows] = await db.batch([
      { sql: `SELECT ${SALE_COLUMNS} FROM sales WHERE id = @id`, params: { id: order.sale_id } },
      { sql: 'SELECT id, status, total_refund_usd, owed_reduction_usd, refund_currency, refund_channel FROM returns WHERE sale_id = @id', params: { id: order.sale_id } },
    ])
    sale = ((saleRows as { results?: SaleRow[] }).results ?? [])[0] ?? null
    returns = (returnRows as { results?: ReturnRow[] }).results ?? []
  }
  return { order, payments: rows(1) as PaymentRecord[], events: rows(2) as EventRow[], requests: rows(3) as RequestRecord[], sale, returns }
}

export async function bundleFromToken(db: D1Compat, token: unknown): Promise<OrderBundle> {
  const missing = () => refuse(404, 'order_not_found', 'We could not find this order. Check the link you were given.')
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(token)) return missing()
  return (await loadBundle(db, await hashOrderToken(token))) ?? missing()
}

// ---- the customer-safe view -----------------------------------------------------------------------------------------------------------

export const parseJson = <T>(text: string | null | undefined, fallback: T): T => { try { return text ? JSON.parse(text) as T : fallback } catch { return fallback } }

/** `*** 678`: enough for the customer to recognise their number, never enough to pass the phone check from a leaked link. */
export const phoneHint = (phone: string): string => `*** ${phone.slice(-3)}`

export function publicOrderView(bundle: OrderBundle, now: Date, settings: Pick<OrderSettings, 'requestWindowDays'>) {
  const { order, payments, events, requests, sale, returns } = bundle
  const view = onlineOrderView(order, payments, events, sale, returns, { now, requestWindowDays: settings.requestWindowDays, requests })
  const live = [...payments].reverse().find((p) => p.purpose === 'order' && p.state === 'awaiting' && p.qr_string) ?? null
  // Every top-up the customer still owes: the newest unpaid row of each request, whether or not it has a QR yet (staff applying a price increase writes the row
  // without one, and the page offers "Pay more" from it) and whether its QR is live or ran out. A request that already has a paid top-up lists nothing.
  const paidTopUpRequests = new Set(payments.filter((p) => p.purpose === 'top_up' && p.state === 'paid').map((p) => p.request_id))
  const newestUnpaid = new Map<number | null, PaymentRecord>()
  for (const p of payments) {
    if (p.purpose === 'top_up' && (p.state === 'awaiting' || p.state === 'expired') && !paidTopUpRequests.has(p.request_id)) newestUnpaid.set(p.request_id, p)
  }
  const topUps = [...newestUnpaid.values()]
  const states = requestStates(requests, events)
  const stateOf = new Map(states.map((s) => [s.id, s]))
  const { held_in_review_usd: _held, available_usd: _available, ...customerMoney } = orderMoneyWire(view.money, events); void _held; void _available
  const editable = order.state === 'awaiting_payment' || order.state === 'qr_failed'
  return {
    order_no: order.order_no,
    // A scrubbed order reads 'closed': nothing about it can change and the page offers a new order, not a new QR.
    status: order.scrubbed_at ? 'closed' : view.status,
    // The same fact as a boolean, so a page does not have to compare a status word (S7 contract, LANE-KHQR.md).
    closed: Boolean(order.scrubbed_at),
    phase: view.phase,
    chips: view.chips,
    fulfilment: order.fulfilment,
    name: order.customer_name,
    phone_hint: phoneHint(order.customer_phone),
    address: order.customer_address,
    contacts: Object.fromEntries(CONTACT_FIELDS.map((field) => [field, (order as unknown as Record<string, string | null>)[`contact_${field}`] ?? null])),
    note: order.note,
    items: parseJson<unknown[]>(order.items_json, []),
    total_usd: order.goods_total_usd,
    total_khr: order.goods_total_khr,
    currency: order.currency,
    created_at: order.created_at,
    paid_at: order.paid_at,
    payment: live ? { amount: live.amount, currency: live.currency, qr_string: live.qr_string, deeplink: live.deeplink, expires_at: live.expires_at } : null,
    top_ups: topUps.map((p) => ({ request_id: p.request_id, amount: p.amount, currency: p.currency, state: p.state, qr_string: p.qr_string ?? null, deeplink: p.deeplink ?? null, expires_at: p.expires_at ?? null })),
    requests: requests.map((r) => ({
      id: r.id, kind: r.kind, stage: r.stage, status: stateOf.get(r.id)?.status ?? 'pending', staff_reply: stateOf.get(r.id)?.publicComment ?? null,
      comment: r.customer_comment, attachments: parseJson<string[]>(r.attachments_json, []), created_at: r.created_at,
    })),
    money: customerMoney,
    can_edit: editable,
    can_cancel: editable,
    requests_open: view.requestsOpen,
    request_kinds: view.requestsOpen ? requestKindsForStage(requestStage(order) ?? 'paid') : [],
    request_window_days: settings.requestWindowDays,
  }
}

// ---- PayWay results -> rows ----------------------------------------------------------------------------------------------------------

const paywayReason = (error: unknown): PaywayFailureReason => (error instanceof PaywayError ? error.reason : 'transport_failed')

/**
 * What a verified check does. One guarded batch per outcome; a replay changes nothing (the first statement only matches a payment that is
 * not yet in its final state, and every later statement and the event hang on that). Money is real once PayWay says APPROVED for the exact
 * amount, whatever the order's own state is by then: the payment goes `paid`, and the order follows only where the table allows it.
 */
export async function applyCheckResult(
  deps: OrderDeps, order: Pick<OrderRecord, 'id' | 'state'>, payment: Pick<PaymentRecord, 'id' | 'amount' | 'currency' | 'revision' | 'state'>,
  check: ParsedCheck, source: 'payway' | 'sweep', creds: PaywayCredentials | null = null,
): Promise<'paid' | 'review' | 'failed' | 'pending' | 'noop'> {
  let outcome = await applyCheckResultRows(deps, order, payment, check, source, creds)
  // Every payment write is guarded by the revision the caller READ. When another writer got there first (a sweep that expired the payment, an edit that
  // cancelled it) the guard refuses and nothing changed: read the payment and the order again ONCE and apply the same check to what is there now (no
  // second PayWay call). Without this a payment could turn paid while its order never moved, and the money would sit on an order nobody was shown.
  if (outcome === 'noop') {
    const [fresh, freshOrder] = await Promise.all([
      deps.db.prepare('SELECT * FROM online_order_payments WHERE id = @id').get<PaymentRecord>({ id: payment.id }),
      deps.db.prepare('SELECT state FROM online_orders WHERE id = @id').get<{ state: string }>({ id: order.id }),
    ])
    if (fresh && freshOrder && (Number(fresh.revision) !== Number(payment.revision) || fresh.state !== payment.state || freshOrder.state !== order.state)) {
      outcome = await applyCheckResultRows(deps, { id: order.id, state: freshOrder.state }, fresh, check, source, creds)
    }
  }
  // The one place a check becomes Paid, Review or Failed, so the one place the shop hears of it: whichever of the poll, the callback or the sweep got there first.
  if (outcome === 'paid' || outcome === 'review' || outcome === 'failed') await announce(deps, { kind: outcome, orderId: order.id, paymentId: payment.id })
  return outcome
}

async function applyCheckResultRows(
  deps: OrderDeps, order: Pick<OrderRecord, 'id' | 'state'>, payment: Pick<PaymentRecord, 'id' | 'amount' | 'currency' | 'revision' | 'state'>,
  check: ParsedCheck, source: 'payway' | 'sweep', creds: PaywayCredentials | null,
): Promise<'paid' | 'review' | 'failed' | 'pending' | 'noop'> {
  if (!check.ok) return 'pending'
  let verdict = classifyCheck({ amount: Number(payment.amount), currency: payment.currency }, check)
  if (verdict === 'pending') return 'pending'
  // Money that arrives on a payment we had already given up on (its QR was replaced by an edit, the order was cancelled, the check had said declined) is
  // never dropped and never silently accepted either: it is held in review with what PayWay says it took, and the shop is told. A decline on such a
  // payment changes nothing.
  const dead = payment.state === 'cancelled' || payment.state === 'failed'
  if (dead) {
    if (verdict === 'failed') return 'pending'
    verdict = 'review'
  }
  const { db } = deps
  const at = sqlTime(deps.now())
  const rev = Number(payment.revision)
  const paidGuard = `EXISTS (SELECT 1 FROM online_order_payments WHERE id = @pid AND state = @pstate AND revision = @newRev)`
  if (verdict === 'failed') {
    const orderMoves = canTransition(order.state, 'qr_failed', source)
    const failedGuard = `EXISTS (SELECT 1 FROM online_order_payments WHERE id = @pid AND state = 'failed' AND revision = @newRev)`
    const [result] = await db.batch([
      { sql: `UPDATE online_order_payments SET state = 'failed', last_checked_at = @at, revision = revision + 1, updated_at = @at WHERE id = @pid AND state = 'awaiting' AND revision = @rev`, params: { pid: payment.id, at, rev } },
      {
        sql: `INSERT INTO online_order_events (order_id, payment_id, event, source, detail_json, created_at)
              SELECT @oid, @pid, 'note', @source, @detail, @at WHERE changes() = 1`,
        params: { oid: order.id, pid: payment.id, source, detail: JSON.stringify({ payment: check.state }), at },
      },
      // An order whose own (only) payment was declined is not waiting for anything: it becomes qr_failed (the customer can ask for a new QR, the
      // sweep expires it later) instead of staying "awaiting payment" for ever, outside every cap and every sweep.
      {
        sql: `UPDATE online_orders SET state = 'qr_failed', revision = revision + 1, updated_at = @at
              WHERE id = @oid AND state = 'awaiting_payment' AND @moves = 1 AND ${failedGuard}
                AND (SELECT purpose FROM online_order_payments WHERE id = @pid) = 'order'
                AND NOT EXISTS (SELECT 1 FROM online_order_payments WHERE order_id = @oid AND state = 'awaiting')`,
        params: { oid: order.id, pid: payment.id, at, moves: orderMoves ? 1 : 0, newRev: rev + 1 },
      },
      {
        sql: `INSERT INTO online_order_events (order_id, payment_id, event, from_state, to_state, source, detail_json, created_at)
              SELECT @oid, @pid, 'qr_failed', 'awaiting_payment', 'qr_failed', @source, @detail, @at
              WHERE ${failedGuard} AND (SELECT state FROM online_orders WHERE id = @oid) = 'qr_failed'
                AND NOT EXISTS (SELECT 1 FROM online_order_events WHERE payment_id = @pid AND event = 'qr_failed')`,
        params: { oid: order.id, pid: payment.id, source, at, newRev: rev + 1, detail: JSON.stringify({ reason: 'declined' }) },
      },
    ])
    return Number(result.meta?.changes ?? 0) === 1 ? 'failed' : 'noop'
  }
  const amount = check.originalAmount ?? check.totalAmount ?? 0
  if (verdict === 'review') {
    const orderMoves = canTransition(order.state, 'review', source)
    // What PayWay actually took, kept on the row (paid_at stays empty: the order is not paid): the money read counts it, so a refund can be noted for it.
    const held = check.state === 'refunded' ? 0 : (check.totalAmount ?? check.originalAmount ?? 0)
    const [result] = await db.batch([
      {
        sql: `UPDATE online_order_payments SET state = 'review', paid_at = NULL, paid_amount = @held, paid_currency = @currency, payway_apv = @apv,
                     payway_bank_ref = @bankRef, payway_payment_type = @paymentType, payway_bank_name = @bankName,
                     last_checked_at = @at, revision = revision + 1, updated_at = @at
              WHERE id = @pid AND state IN ('awaiting','expired','cancelled','failed') AND revision = @rev`,
        params: { pid: payment.id, at, rev, held, currency: payment.currency, apv: check.apv, bankRef: check.bankRef, paymentType: check.paymentType, bankName: check.bankName },
      },
      {
        sql: `UPDATE online_orders SET state = 'review', revision = revision + 1, updated_at = @at
              WHERE id = @oid AND state IN ('awaiting_payment','expired') AND @moves = 1 AND ${paidGuard}`,
        params: { oid: order.id, pid: payment.id, at, moves: orderMoves ? 1 : 0, pstate: 'review', newRev: rev + 1 },
      },
      {
        sql: `INSERT INTO online_order_events (order_id, payment_id, event, from_state, to_state, source, amount_usd, detail_json, created_at)
              SELECT @oid, @pid, 'mismatch', @from, @to, @source, @amount, @detail, @at WHERE ${paidGuard}
                AND NOT EXISTS (SELECT 1 FROM online_order_events WHERE payment_id = @pid AND event = 'mismatch')`,
        params: {
          oid: order.id, pid: payment.id, from: order.state, to: orderMoves ? 'review' : order.state, source, amount: check.state === 'refunded' ? 0 : amount, at,
          detail: JSON.stringify({ check: check.state, expected: Number(payment.amount), currency: payment.currency, ...(dead ? { reason: 'paid_after_cancel', payment_state: payment.state } : {}) }), pstate: 'review', newRev: rev + 1,
        },
      },
    ])
    return Number(result.meta?.changes ?? 0) === 1 ? 'review' : 'noop'
  }
  const orderMoves = canTransition(order.state, 'paid', source)
  const event = order.state === 'expired' ? 'late_paid' : 'verified_paid'
  // The other QRs of this order that ABA may still take money on. They are cancelled in the same batch below, and closed at ABA after it commits: a
  // customer who scans the older QR anyway would otherwise pay twice, onto a payment we no longer watch.
  const siblings = creds
    ? (await db.prepare(`SELECT tran_id FROM online_order_payments WHERE order_id = @oid AND id <> @pid AND state = 'awaiting' AND qr_string IS NOT NULL`).all<{ tran_id: string }>({ oid: order.id, pid: payment.id })).map((row) => row.tran_id)
    : []
  const [result] = await db.batch([
    {
      // 'review' is not here on purpose: a payment held in review is resolved by staff (which keeps the real amount), never flipped to paid by a later
      // check that happens to match, or a payment on a cancelled QR would pay an order whose price had since changed.
      sql: `UPDATE online_order_payments SET state = 'paid', paid_at = @at, paid_amount = @amount, paid_currency = @currency, payway_apv = @apv,
                   payway_bank_ref = @bankRef, payway_payment_type = @paymentType, payway_bank_name = @bankName,
                   last_checked_at = @at, revision = revision + 1, updated_at = @at
            WHERE id = @pid AND state IN ('awaiting','expired') AND revision = @rev`,
      params: { pid: payment.id, at, rev, amount, currency: payment.currency, apv: check.apv, bankRef: check.bankRef, paymentType: check.paymentType, bankName: check.bankName },
    },
    {
      sql: `UPDATE online_orders SET state = 'paid', paid_at = COALESCE(paid_at, @at), revision = revision + 1, updated_at = @at
            WHERE id = @oid AND state IN ('awaiting_payment','expired') AND @moves = 1 AND ${paidGuard}`,
      params: { oid: order.id, pid: payment.id, at, moves: orderMoves ? 1 : 0, pstate: 'paid', newRev: rev + 1 },
    },
    {
      sql: `UPDATE online_order_payments SET state = 'cancelled', revision = revision + 1, updated_at = @at
            WHERE order_id = @oid AND id <> @pid AND state = 'awaiting' AND ${paidGuard}`,
      params: { oid: order.id, pid: payment.id, at, pstate: 'paid', newRev: rev + 1 },
    },
    {
      // A payment turns paid once: a twin that raced the first writer finds the Records row already there (NOT EXISTS, through idx_online_order_events_payment) and adds none.
      sql: `INSERT INTO online_order_events (order_id, payment_id, event, from_state, to_state, source, amount_usd, detail_json, created_at)
            SELECT @oid, @pid, @event, @from, @to, @source, @usd, @detail, @at WHERE ${paidGuard}
              AND NOT EXISTS (SELECT 1 FROM online_order_events WHERE payment_id = @pid AND event IN ('verified_paid','late_paid'))`,
      params: {
        oid: order.id, pid: payment.id, event, from: order.state, to: orderMoves ? 'paid' : order.state, source, at,
        usd: payment.currency === 'USD' ? amount : null, detail: JSON.stringify(orderMoves ? { currency: payment.currency } : { currency: payment.currency, extra_payment: true, order_state: order.state }),
        pstate: 'paid', newRev: rev + 1,
      },
    },
  ])
  if (Number(result.meta?.changes ?? 0) !== 1) return 'noop'
  await closeQuietly(deps, creds, siblings)
  return 'paid'
}

export async function closeQuietly(deps: OrderDeps, creds: PaywayCredentials | null, tranIds: string[]): Promise<void> {
  if (!creds) return
  for (const tranId of tranIds) {
    try { await closeTransaction(deps.transport, creds, deps.now(), tranId) } catch { /* best effort: the QR expires on its own */ }
  }
}

/**
 * Before a QR is replaced or an order cancelled, ask PayWay whether the live one was already paid. A customer who pays while editing must
 * not lose the payment to a new QR. Returns true when the order turned out to be paid (the caller then refuses its own change).
 */
async function paidMeanwhile(deps: OrderDeps, creds: PaywayCredentials | null, bundle: OrderBundle): Promise<boolean> {
  if (!creds) return false
  for (const payment of bundle.payments.filter((p) => p.state === 'awaiting' && p.qr_string)) {
    let check: ParsedCheck
    try { check = await checkTransaction(deps.transport, creds, deps.now(), payment.tran_id) } catch { continue }
    const outcome = await applyCheckResult(deps, bundle.order, payment, check, 'payway', creds)
    if (outcome === 'paid' || outcome === 'review') return true
  }
  return false
}

// ---- the throttled nudge ----------------------------------------------------------------------------------------------------------------

const isolateNudges = new Map<number, number>()
export function resetNudgeThrottleForTests(): void { isolateNudges.clear() }

/** True while any maintenance hold is set, and when that cannot be read: an unreadable hold is treated as a hold. */
async function maintenanceHolds(env: Env): Promise<boolean> {
  try { return (await getMaintenance(env)) !== null } catch { return true }
}

/**
 * A poll or page load may ask PayWay whether an order has been paid, once the QR has been out for a minute and at most once per
 * `onlineOrderNudgeCheckSeconds` for that payment. The isolate remembers its last nudge so most polls read nothing but the order row;
 * the claim (a guarded UPDATE of last_checked_at) lets only one request across isolates spend the PayWay call.
 */
export async function nudgeOrder(deps: OrderDeps, creds: PaywayCredentials | null, order: Pick<OrderRecord, 'id' | 'state' | 'created_at'>): Promise<'paid' | 'review' | 'failed' | 'none'> {
  if (!creds || order.state !== 'awaiting_payment') return 'none'
  const now = deps.now()
  const createdMs = Date.parse(`${String(order.created_at).replace(' ', 'T')}Z`)
  if (!Number.isFinite(createdMs) || now.getTime() - createdMs < getPlanLimits(deps.env).onlineOrderNudgeAfterSeconds * 1000) return 'none'
  const seconds = getPlanLimits(deps.env).onlineOrderNudgeCheckSeconds
  const last = isolateNudges.get(order.id)
  if (last !== undefined && now.getTime() - last < seconds * 1000) return 'none'
  if (isolateNudges.size > 500) isolateNudges.clear()
  isolateNudges.set(order.id, now.getTime())
  const payment = await deps.db.prepare(`SELECT * FROM online_order_payments WHERE order_id = @id AND state = 'awaiting' ORDER BY id DESC LIMIT 1`).get<PaymentRecord>({ id: order.id })
  if (!payment || !payment.qr_string || !nudgeCheckDue(payment.last_checked_at, now, deps.env)) return 'none'
  // A GET must never write while a restore or a branch cutover holds the database (the write gate only covers write methods, and this nudge is a write
  // behind a GET). Checked only when a check is actually due, so the common poll pays nothing for it.
  if (await maintenanceHolds(deps.env)) return 'none'
  const claim = await deps.db.prepare(`UPDATE online_order_payments SET last_checked_at = @at WHERE id = @pid AND state = 'awaiting' AND last_checked_at IS @last`)
    .run({ at: sqlTime(now), pid: payment.id, last: payment.last_checked_at })
  if (Number(claim.changes ?? 0) !== 1) return 'none'
  let check: ParsedCheck
  try { check = await checkTransaction(deps.transport, creds, now, payment.tran_id) } catch { return 'none' }
  const outcome = await applyCheckResult(deps, order, payment, check, 'payway', creds)
  return outcome === 'paid' || outcome === 'review' || outcome === 'failed' ? outcome : 'none'
}

// ---- issuing a QR ------------------------------------------------------------------------------------------------------------------------

function newTranId(deps: OrderDeps): string { return makeTranId('W', deps.random(20)) }

/**
 * Asks PayWay for the QR of a payment row that already exists and records the outcome in one batch: the QR (with its expiry) and a
 * `qr_issued` Records row, or the payment `failed` (and, for the order's own payment, the order `qr_failed`) with a `qr_failed` row that keeps
 * only the reason word.
 */
async function issueQr(
  deps: OrderDeps, creds: PaywayCredentials, order: Pick<OrderRecord, 'id' | 'order_no'>,
  payment: Pick<PaymentRecord, 'tran_id' | 'amount' | 'currency' | 'purpose'>, settings: OrderSettings, fromState: string,
): Promise<{ ok: true; expiresAt: string } | { ok: false; reason: PaywayFailureReason }> {
  const now = deps.now()
  const callbackUrl = deps.origin ? await callbackUrlFor(deps.env, deps.origin, payment.tran_id) : null
  let parsed: Awaited<ReturnType<typeof generateQr>>
  try {
    parsed = await generateQr(deps.transport, creds, {
      now, tranId: payment.tran_id, amount: Number(payment.amount), currency: payment.currency, lifetimeMinutes: settings.paymentMinutes,
      ...(callbackUrl ? { callbackUrl } : {}), items: [{ name: `Order ${order.order_no}`, quantity: 1, price: Number(payment.amount) }],
    })
  } catch (error) {
    parsed = { ok: false, reason: paywayReason(error) }
  }
  const at = sqlTime(now)
  if (parsed.ok) {
    const expiresAt = sqlTime(new Date(now.getTime() + settings.paymentMinutes * 60_000))
    await deps.db.batch([
      {
        sql: `UPDATE online_order_payments SET qr_string = @qr, deeplink = @deeplink, expires_at = @expires, revision = revision + 1, updated_at = @at
              WHERE tran_id = @tran AND state = 'awaiting' AND qr_string IS NULL`,
        params: { qr: parsed.qrString, deeplink: parsed.deeplink, expires: expiresAt, at, tran: payment.tran_id },
      },
      {
        sql: `INSERT INTO online_order_events (order_id, payment_id, event, from_state, to_state, source, amount_usd, detail_json, created_at)
              SELECT @oid, (SELECT id FROM online_order_payments WHERE tran_id = @tran), 'qr_issued', @from, @to, 'customer', @usd, @detail, @at WHERE changes() = 1`,
        params: {
          oid: order.id, tran: payment.tran_id, from: fromState, to: payment.purpose === 'order' ? 'awaiting_payment' : fromState, at,
          usd: payment.currency === 'USD' ? payment.amount : null, detail: JSON.stringify({ purpose: payment.purpose, minutes: settings.paymentMinutes }),
        },
      },
    ])
    return { ok: true, expiresAt }
  }
  console.error('[online-orders] QR request failed:', parsed.reason)
  await deps.db.batch([
    { sql: `UPDATE online_order_payments SET state = 'failed', revision = revision + 1, updated_at = @at WHERE tran_id = @tran AND state = 'awaiting' AND qr_string IS NULL`, params: { at, tran: payment.tran_id } },
    {
      sql: `UPDATE online_orders SET state = 'qr_failed', revision = revision + 1, updated_at = @at
            WHERE id = @oid AND @own = 1 AND state = 'awaiting_payment' AND changes() = 1`,
      params: { at, oid: order.id, own: payment.purpose === 'order' ? 1 : 0 },
    },
    {
      sql: `INSERT INTO online_order_events (order_id, payment_id, event, from_state, to_state, source, detail_json, created_at)
            SELECT @oid, (SELECT id FROM online_order_payments WHERE tran_id = @tran), 'qr_failed', @from, @to, 'customer', @detail, @at
            WHERE EXISTS (SELECT 1 FROM online_order_payments WHERE tran_id = @tran AND state = 'failed')`,
      params: { oid: order.id, tran: payment.tran_id, from: fromState, to: payment.purpose === 'order' ? 'qr_failed' : fromState, at, detail: JSON.stringify({ reason: parsed.reason }) },
    },
  ])
  return { ok: false, reason: parsed.reason }
}

/** A failed QR is an answer the customer can act on, so the order's token travels with the refusal: the page offers "Try again". */
function qrFailure(reason: PaywayFailureReason, token: string, orderNo: string): never {
  const failure = paymentFailureMessage(reason)
  return refuse(502, failure.code, failure.message, { retryable: failure.retryable, token, order_no: orderNo })
}

function creditsOrRefuse(creds: PaywayCredentials | null): PaywayCredentials {
  return creds ?? refuse(503, 'payway_not_configured', 'Online payment is not available right now. Please contact the shop.')
}

// ---- create ---------------------------------------------------------------------------------------------------------------------------------

export type CreateResult = { token: string; bundle: OrderBundle }

export async function createOrder(
  deps: OrderDeps, creds: PaywayCredentials | null, input: OrderInput, extras: { networkKey: string; portalAccountId: number | null; clientRequestId: string | null },
): Promise<CreateResult> {
  const credentials = creditsOrRefuse(creds)
  const { db, env } = deps
  if (extras.clientRequestId && await db.prepare('SELECT 1 AS found FROM online_orders WHERE client_request_id = @id').get({ id: extras.clientRequestId })) {
    return refuse(409, 'duplicate_request', 'This order was already placed. Open it from the link you were given, or start a new list.')
  }
  const cut = liveCutoffs(env, deps.now())
  const [settings, open, openForPhone, openForNetwork] = await Promise.all([loadOrderSettings(db), countOpenPayments(db, cut), countOpenPaymentsForPhone(db, input.phone, cut), countOpenOrdersForNetwork(db, extras.networkKey, cut)])
  if (!openUnpaidAllowed(open, env)) return refuse(503, 'busy', 'We are busy right now. Please try again in a few minutes.')
  // One person, or one address typed with many phone numbers, cannot hold the shop's open slots (review F5): the same answer as the per-phone cap.
  if (openForPhone >= getPlanLimits(env).onlineOrderOpenPerPhoneMax || openForNetwork >= getPlanLimits(env).onlineOrderOpenPerNetworkMax) {
    return refuse(429, 'too_many_open_orders', 'You already have orders waiting for payment. Please pay or cancel them first.')
  }
  const facts = await priceAndCheckStock(deps, input.lines, settings)
  const now = deps.now()
  const at = sqlTime(now)
  const { token, hash } = await createOrderToken(deps.random(16))
  let orderNo = ''
  let tranId = ''
  for (let attempt = 0; attempt < 4; attempt += 1) {
    orderNo = makeOrderNo(now, deps.random(4))
    tranId = newTranId(deps)
    try {
      await db.batch([
        {
          sql: `INSERT INTO online_orders (order_no, token_hash, client_request_id, state, fulfilment, branch_id, customer_name, customer_phone, customer_address,
                  contact_telegram, contact_instagram, contact_facebook, contact_tiktok, contact_whatsapp, contact_other, note, portal_account_id,
                  currency, goods_total_usd, goods_total_khr, exchange_rate, items_json, pricing_version, network_key, revision, created_at, updated_at)
                VALUES (@order_no, @hash, @cid, 'awaiting_payment', @fulfilment, @branch, @name, @phone, @address,
                  @telegram, @instagram, @facebook, @tiktok, @whatsapp, @other, @note, @account,
                  'USD', @total, @khr, @rate, @items, @pricing, @network, 0, @at, @at)`,
          params: {
            order_no: orderNo, hash, cid: extras.clientRequestId, fulfilment: input.fulfilment, branch: facts.branchId, name: input.name, phone: input.phone,
            address: input.address, telegram: input.contacts.telegram, instagram: input.contacts.instagram, facebook: input.contacts.facebook,
            tiktok: input.contacts.tiktok, whatsapp: input.contacts.whatsapp, other: input.contacts.other, note: input.note, account: extras.portalAccountId,
            total: facts.priced.goodsTotalUsd, khr: facts.priced.goodsTotalKhr, rate: settings.exchangeRate, items: itemsJson(facts), pricing: facts.priced.pricingVersion,
            network: extras.networkKey, at,
          },
        },
        {
          sql: `INSERT INTO online_order_payments (order_id, tran_id, purpose, amount, currency, state, revision, created_at, updated_at)
                VALUES ((SELECT id FROM online_orders WHERE order_no = @order_no), @tran, 'order', @total, 'USD', 'awaiting', 0, @at, @at)`,
          params: { order_no: orderNo, tran: tranId, total: facts.priced.goodsTotalUsd, at },
        },
        {
          sql: `INSERT INTO online_order_events (order_id, payment_id, event, to_state, source, amount_usd, detail_json, created_at)
                VALUES ((SELECT id FROM online_orders WHERE order_no = @order_no), (SELECT id FROM online_order_payments WHERE tran_id = @tran), 'created', 'awaiting_payment', 'customer', @total, @detail, @at)`,
          params: { order_no: orderNo, tran: tranId, total: facts.priced.goodsTotalUsd, at, detail: JSON.stringify({ lines: input.lines.length, fulfilment: input.fulfilment, ...(settings.rateIsFallback ? { rate_fallback: true } : {}) }) },
        },
      ])
      break
    } catch (error) {
      const message = String((error as Error)?.message ?? error)
      if (attempt < 3 && /UNIQUE|constraint/i.test(message) && /order_no|tran_id|token_hash/i.test(message)) continue
      throw error
    }
  }
  const order = { id: 0, order_no: orderNo }
  order.id = Number((await db.prepare('SELECT id FROM online_orders WHERE order_no = @no').get<{ id: number }>({ no: orderNo }))?.id)
  const issued = await issueQr(deps, credentials, order, { tran_id: tranId, amount: facts.priced.goodsTotalUsd, currency: 'USD', purpose: 'order' }, settings, 'awaiting_payment')
  if (!issued.ok) { await announce(deps, { kind: 'qr_failed', orderId: order.id }); return qrFailure(issued.reason, token, orderNo) }
  const bundle = (await loadBundle(db, hash))!
  await announce(deps, { kind: 'created', orderId: bundle.order.id, ...(settings.rateIsFallback ? { rateFallback: true } : {}) })
  return { token, bundle }
}

// ---- edit / cancel / retry / top-up (before the money, or for a QR that ran out) ----------------------------------------------------------

function sameLines(order: OrderRecord, lines: OrderLineInput[]): boolean {
  const current = parseJson<Array<{ product_id: number; quantity: number }>>(order.items_json, [])
  if (current.length !== lines.length) return false
  const byProduct = new Map(current.map((line) => [Number(line.product_id), Number(line.quantity)]))
  return lines.every((line) => byProduct.get(line.product_id) === line.quantity)
}
const editableState = (order: OrderRecord) => !order.scrubbed_at && (order.state === 'awaiting_payment' || order.state === 'qr_failed')
/** A scrubbed order has no customer left in it: an old link may read it, never change it or ask for a new QR (a payment on it would have no one to be told). */
const refuseIfScrubbed = (order: OrderRecord): void => { if (order.scrubbed_at) refuse(409, 'order_closed', 'This order is closed. Please start a new order.') }
const refusePaid = (): never => refuse(409, 'already_paid', 'This order has just been paid, so it can no longer be changed here. Ask the shop if you need a change.')

/** Change a waiting order directly (nothing was paid, so no approval is needed). A new list means a new price, so a new QR for the new amount. */
export async function editOrder(deps: OrderDeps, creds: PaywayCredentials | null, token: string, body: Record<string, unknown>): Promise<OrderBundle> {
  const bundle = await bundleFromToken(deps.db, token)
  const { order } = bundle
  refuseIfScrubbed(order)
  if (!editableState(order)) return refuse(409, 'order_not_editable', 'This order can no longer be changed here. Please contact the shop.')
  const changedFields: string[] = []
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key)
  const name = has('name') ? normalizeName(body.name) : order.customer_name
  const typedAddress = has('address') ? normalizeAddress(body.address) : order.customer_address
  const fulfilment = has('fulfilment') || has('address') ? normalizeFulfilment(has('fulfilment') ? body.fulfilment : order.fulfilment, typedAddress) : (order.fulfilment as 'pickup' | 'delivery')
  const address = addressFor(fulfilment, typedAddress)
  const note = has('note') ? normalizeNote(body.note) : order.note
  const current: Contacts = Object.fromEntries(CONTACT_FIELDS.map((f) => [f, (order as unknown as Record<string, string | null>)[`contact_${f}`] ?? null])) as Contacts
  const contacts = has('contacts') ? { ...current, ...normalizeContacts(body.contacts) } : current
  const newPhone = has('phone') ? normalizePhone(body.phone) : order.customer_phone
  if (name !== order.customer_name) changedFields.push('name')
  if (newPhone !== order.customer_phone) changedFields.push('phone')
  if (address !== order.customer_address) changedFields.push('address')
  if (fulfilment !== order.fulfilment) changedFields.push('fulfilment')
  if (note !== order.note) changedFields.push('note')
  if (CONTACT_FIELDS.some((f) => contacts[f] !== current[f])) changedFields.push('contacts')
  const lines = has('lines') ? parseLines(body.lines, deps.env) : null
  const linesChanged = lines !== null && !sameLines(order, lines)
  if (linesChanged) changedFields.push('items')
  if (!changedFields.length) return bundle
  const now = deps.now()
  const at = sqlTime(now)
  const common = {
    oid: order.id, rev: order.revision, newRev: order.revision + 1, at, name, phone: newPhone, address, fulfilment, note,
    telegram: contacts.telegram, instagram: contacts.instagram, facebook: contacts.facebook, tiktok: contacts.tiktok, whatsapp: contacts.whatsapp, other: contacts.other,
  }
  const detailsSet = `customer_name = @name, customer_phone = @phone, customer_address = @address, fulfilment = @fulfilment, note = @note,
        contact_telegram = @telegram, contact_instagram = @instagram, contact_facebook = @facebook, contact_tiktok = @tiktok, contact_whatsapp = @whatsapp, contact_other = @other`
  const revisionMoved = 'EXISTS (SELECT 1 FROM online_orders WHERE id = @oid AND revision = @newRev)'
  if (!linesChanged) {
    const [result] = await deps.db.batch([
      { sql: `UPDATE online_orders SET ${detailsSet}, revision = @newRev, updated_at = @at WHERE id = @oid AND revision = @rev AND state IN ('awaiting_payment','qr_failed')`, params: common },
      {
        sql: `INSERT INTO online_order_events (order_id, event, from_state, to_state, source, detail_json, created_at) SELECT @oid, 'edited', @state, @state, 'customer', @detail, @at WHERE ${revisionMoved}`,
        params: { oid: order.id, newRev: common.newRev, at, state: order.state, detail: JSON.stringify({ fields: changedFields }) },
      },
    ])
    if (Number(result.meta?.changes ?? 0) !== 1) return refuse(409, 'order_changed', 'This order changed while you were editing it. Please reload and try again.')
    await announce(deps, { kind: 'edited', orderId: order.id })
    return (await loadBundle(deps.db, order.token_hash))!
  }
  const credentials = creditsOrRefuse(creds)
  if (await paidMeanwhile(deps, credentials, bundle)) return refusePaid()
  const settings = await loadOrderSettings(deps.db)
  const facts = await priceAndCheckStock(deps, lines!, settings)
  const tranId = newTranId(deps)
  const [result] = await deps.db.batch([
    {
      sql: `UPDATE online_orders SET ${detailsSet}, state = 'awaiting_payment', goods_total_usd = @total, goods_total_khr = @khr, exchange_rate = @rate, items_json = @items,
              pricing_version = @pricing, branch_id = @branch, revision = @newRev, updated_at = @at
            WHERE id = @oid AND revision = @rev AND state IN ('awaiting_payment','qr_failed')`,
      params: { ...common, total: facts.priced.goodsTotalUsd, khr: facts.priced.goodsTotalKhr, rate: settings.exchangeRate, items: itemsJson(facts), pricing: facts.priced.pricingVersion, branch: facts.branchId },
    },
    {
      sql: `UPDATE online_order_payments SET state = 'cancelled', revision = revision + 1, updated_at = @at WHERE order_id = @oid AND state = 'awaiting' AND ${revisionMoved}`,
      params: { oid: order.id, newRev: common.newRev, at },
    },
    {
      sql: `INSERT INTO online_order_payments (order_id, tran_id, purpose, amount, currency, state, revision, created_at, updated_at)
            SELECT @oid, @tran, 'order', @total, 'USD', 'awaiting', 0, @at, @at WHERE ${revisionMoved}`,
      params: { oid: order.id, newRev: common.newRev, tran: tranId, total: facts.priced.goodsTotalUsd, at },
    },
    {
      sql: `INSERT INTO online_order_events (order_id, event, from_state, to_state, source, amount_usd, detail_json, created_at)
            SELECT @oid, 'edited', @state, 'awaiting_payment', 'customer', @total, @detail, @at WHERE ${revisionMoved}`,
      params: { oid: order.id, newRev: common.newRev, state: order.state, total: facts.priced.goodsTotalUsd, at, detail: JSON.stringify({ fields: changedFields, lines: lines!.length, from_total_usd: order.goods_total_usd }) },
    },
  ])
  if (Number(result.meta?.changes ?? 0) !== 1) return refuse(409, 'order_changed', 'This order changed while you were editing it. Please reload and try again.')
  await closeQuietly(deps, credentials, bundle.payments.filter((p) => p.state === 'awaiting').map((p) => p.tran_id))
  await announce(deps, { kind: 'edited', orderId: order.id })
  const issued = await issueQr(deps, credentials, order, { tran_id: tranId, amount: facts.priced.goodsTotalUsd, currency: 'USD', purpose: 'order' }, settings, order.state)
  if (!issued.ok) { await announce(deps, { kind: 'qr_failed', orderId: order.id }); return qrFailure(issued.reason, token, order.order_no) }
  return (await loadBundle(deps.db, order.token_hash))!
}

/** Cancel an order nothing was paid for. A last check first: a customer who paid in the same minute must not lose the order to a cancel. */
export async function cancelOrder(deps: OrderDeps, creds: PaywayCredentials | null, token: string): Promise<OrderBundle> {
  const bundle = await bundleFromToken(deps.db, token)
  const { order } = bundle
  if (order.state === 'cancelled') return bundle
  refuseIfScrubbed(order)
  if (!editableState(order)) return refuse(409, 'order_not_cancellable', 'This order can no longer be cancelled here. Please contact the shop.')
  if (await paidMeanwhile(deps, creds, bundle)) return refusePaid()
  const at = sqlTime(deps.now())
  const moved = 'EXISTS (SELECT 1 FROM online_orders WHERE id = @oid AND revision = @newRev AND state = \'cancelled\')'
  const [result] = await deps.db.batch([
    { sql: `UPDATE online_orders SET state = 'cancelled', revision = @newRev, updated_at = @at WHERE id = @oid AND revision = @rev AND state IN ('awaiting_payment','qr_failed')`, params: { oid: order.id, rev: order.revision, newRev: order.revision + 1, at } },
    { sql: `UPDATE online_order_payments SET state = 'cancelled', revision = revision + 1, updated_at = @at WHERE order_id = @oid AND state = 'awaiting' AND ${moved}`, params: { oid: order.id, newRev: order.revision + 1, at } },
    {
      sql: `INSERT INTO online_order_events (order_id, event, from_state, to_state, source, detail_json, created_at) SELECT @oid, 'cancelled', @state, 'cancelled', 'customer', '{}', @at WHERE ${moved}`,
      params: { oid: order.id, newRev: order.revision + 1, state: order.state, at },
    },
  ])
  if (Number(result.meta?.changes ?? 0) !== 1) return refuse(409, 'order_changed', 'This order changed just now. Please reload and try again.')
  await closeQuietly(deps, creds, bundle.payments.filter((p) => p.state === 'awaiting').map((p) => p.tran_id))
  await announce(deps, { kind: 'cancelled', orderId: order.id })
  return (await loadBundle(deps.db, order.token_hash))!
}

/** A new QR for the same amount: after a failed attempt, or after the time ran out. A QR still inside its time is refused (the customer pays that one). */
export async function retryOrderQr(deps: OrderDeps, creds: PaywayCredentials | null, token: string): Promise<OrderBundle> {
  const credentials = creditsOrRefuse(creds)
  const bundle = await bundleFromToken(deps.db, token)
  const { order } = bundle
  refuseIfScrubbed(order)
  if (!['awaiting_payment', 'qr_failed', 'expired'].includes(order.state)) return refuse(409, 'order_not_retryable', 'This order does not need a new QR.')
  const now = deps.now()
  const live = bundle.payments.filter((p) => p.state === 'awaiting' && p.qr_string && (!p.expires_at || Date.parse(`${p.expires_at.replace(' ', 'T')}Z`) > now.getTime()))
  if (live.length) return refuse(409, 'qr_still_valid', 'Your QR is still valid. Please scan it to pay.')
  if (await paidMeanwhile(deps, credentials, bundle)) return refusePaid()
  const settings = await loadOrderSettings(deps.db)
  const at = sqlTime(now)
  const tranId = newTranId(deps)
  const moved = 'EXISTS (SELECT 1 FROM online_orders WHERE id = @oid AND revision = @newRev)'
  const [result] = await deps.db.batch([
    { sql: `UPDATE online_orders SET state = 'awaiting_payment', revision = @newRev, updated_at = @at WHERE id = @oid AND revision = @rev AND state IN ('awaiting_payment','qr_failed','expired')`, params: { oid: order.id, rev: order.revision, newRev: order.revision + 1, at } },
    { sql: `UPDATE online_order_payments SET state = 'cancelled', revision = revision + 1, updated_at = @at WHERE order_id = @oid AND state = 'awaiting' AND ${moved}`, params: { oid: order.id, newRev: order.revision + 1, at } },
    {
      sql: `INSERT INTO online_order_payments (order_id, tran_id, purpose, amount, currency, state, revision, created_at, updated_at)
            SELECT @oid, @tran, 'order', @total, @currency, 'awaiting', 0, @at, @at WHERE ${moved}`,
      params: { oid: order.id, newRev: order.revision + 1, tran: tranId, total: order.goods_total_usd, currency: order.currency, at },
    },
  ])
  if (Number(result.meta?.changes ?? 0) !== 1) return refuse(409, 'order_changed', 'This order changed just now. Please reload and try again.')
  await closeQuietly(deps, credentials, bundle.payments.filter((p) => p.state === 'awaiting').map((p) => p.tran_id))
  const issued = await issueQr(deps, credentials, order, { tran_id: tranId, amount: order.goods_total_usd, currency: order.currency, purpose: 'order' }, settings, order.state)
  if (!issued.ok) { await announce(deps, { kind: 'qr_failed', orderId: order.id }); return qrFailure(issued.reason, token, order.order_no) }
  await announce(deps, { kind: 'changed', orderId: order.id })
  return (await loadBundle(deps.db, order.token_hash))!
}

/**
 * A fresh QR for an extra amount staff asked for when they accepted a change (the top-up payment row is theirs to create, later slice). It
 * repeats the amount of the request's last unpaid top-up: the customer never chooses it.
 */
export async function retryTopUpQr(deps: OrderDeps, creds: PaywayCredentials | null, token: string, requestId: unknown): Promise<OrderBundle> {
  const credentials = creditsOrRefuse(creds)
  const bundle = await bundleFromToken(deps.db, token)
  const { order } = bundle
  const id = Number(requestId)
  if (!Number.isSafeInteger(id) || id <= 0) return refuse(400, 'request_invalid', 'Choose which request this payment is for.')
  const ofRequest = bundle.payments.filter((p) => p.purpose === 'top_up' && p.request_id === id)
  if (!ofRequest.length) return refuse(404, 'no_topup_due', 'There is no extra payment waiting for this request.')
  if (ofRequest.some((p) => p.state === 'paid')) return refuse(409, 'topup_paid', 'This extra payment was already received. Thank you.')
  if (['cancelled'].includes(order.state)) return refuse(409, 'order_not_open', 'This order is cancelled.')
  const now = deps.now()
  if (ofRequest.some((p) => p.state === 'awaiting' && p.qr_string && (!p.expires_at || Date.parse(`${p.expires_at.replace(' ', 'T')}Z`) > now.getTime()))) {
    return refuse(409, 'qr_still_valid', 'Your QR is still valid. Please scan it to pay.')
  }
  const last = ofRequest[ofRequest.length - 1]
  if (await paidMeanwhile(deps, credentials, { ...bundle, payments: ofRequest })) return refuse(409, 'already_paid', 'This extra payment was just received. Thank you.')
  const settings = await loadOrderSettings(deps.db)
  const at = sqlTime(now)
  const tranId = newTranId(deps)
  await deps.db.batch([
    { sql: `UPDATE online_order_payments SET state = 'cancelled', revision = revision + 1, updated_at = @at WHERE order_id = @oid AND request_id = @rid AND purpose = 'top_up' AND state = 'awaiting'`, params: { oid: order.id, rid: id, at } },
    {
      sql: `INSERT INTO online_order_payments (order_id, tran_id, purpose, request_id, amount, currency, state, revision, created_at, updated_at)
            SELECT @oid, @tran, 'top_up', @rid, @amount, @currency, 'awaiting', 0, @at, @at
            WHERE NOT EXISTS (SELECT 1 FROM online_order_payments WHERE order_id = @oid AND request_id = @rid AND purpose = 'top_up' AND state = 'paid')`,
      params: { oid: order.id, rid: id, tran: tranId, amount: last.amount, currency: last.currency, at },
    },
  ])
  const issued = await issueQr(deps, credentials, order, { tran_id: tranId, amount: last.amount, currency: last.currency, purpose: 'top_up' }, settings, order.state)
  if (!issued.ok) {
    // The failed top-up row is a committed change the staff screens show: bump the version even though the customer gets a refusal.
    await announce(deps, { kind: 'changed', orderId: order.id })
    const failure = paymentFailureMessage(issued.reason)
    return refuse(502, failure.code, failure.message, { retryable: failure.retryable, token, order_no: order.order_no })
  }
  await announce(deps, { kind: 'changed', orderId: order.id })
  return (await loadBundle(deps.db, order.token_hash))!
}

// ---- requests (after the money) --------------------------------------------------------------------------------------------------------------------

export const PHONE_MISMATCH_MESSAGE = 'That phone number does not match this order. Enter the number you gave when you ordered.'
export function assertPhoneMatches(order: Pick<OrderRecord, 'customer_phone'>, phone: unknown): void {
  const given = canonicalizePhone(phone)
  if (!given || given !== order.customer_phone) refuse(403, 'phone_mismatch', PHONE_MISMATCH_MESSAGE)
}

const REQUEST_REFUSALS: Record<string, { status: number; code: string; message: string }> = {
  not_ready: { status: 409, code: 'request_not_ready', message: 'You can send a request once your payment is confirmed.' },
  window_closed: { status: 409, code: 'request_window_closed', message: 'The time for changes has ended. Please contact the shop.' },
  closed_order: { status: 409, code: 'request_closed', message: 'This order is closed. Please contact the shop if you need help.' },
  one_pending: { status: 409, code: 'request_pending', message: 'You already have a request waiting for the shop. Please wait for an answer, or withdraw it first.' },
  too_many: { status: 409, code: 'request_limit', message: 'This order has reached the number of requests allowed. Please contact the shop.' },
  kind_not_allowed: { status: 409, code: 'request_kind_not_allowed', message: 'That kind of request is not available for this order yet.' },
}

/** What the customer proposes, validated per kind. `before` is the order as it stands, kept beside it so staff see a plain before and after. */
export function buildRequestChange(order: OrderRecord, kind: RequestKind, body: Record<string, unknown>, env: Pick<Env, 'PLAN_TIER'>): { before: unknown; after: unknown } {
  const after = (body.after && typeof body.after === 'object' && !Array.isArray(body.after) ? body.after : {}) as Record<string, unknown>
  const currentItems = parseJson<unknown[]>(order.items_json, [])
  switch (kind) {
    case 'items':
    case 'return':
      return { before: { items: currentItems }, after: { items: parseLines(after.lines ?? after.items, env), ...(kind === 'return' ? { reason: normalizeComment(after.reason) } : {}) } }
    case 'fulfilment': {
      const address = after.address === undefined ? order.customer_address : normalizeAddress(after.address)
      return { before: { fulfilment: order.fulfilment, address: order.customer_address }, after: { fulfilment: normalizeFulfilment(after.fulfilment, address), address: addressFor(normalizeFulfilment(after.fulfilment, address), address) } }
    }
    case 'address': {
      const address = normalizeAddress(after.address)
      if (!address) return refuse(400, 'address_required', 'Please enter the new address.')
      return { before: { address: order.customer_address }, after: { address } }
    }
    case 'contact': {
      const contacts = normalizeContacts(after.contacts)
      const name = after.name === undefined ? order.customer_name : normalizeName(after.name)
      return { before: { name: order.customer_name, contacts: Object.fromEntries(CONTACT_FIELDS.map((f) => [f, (order as unknown as Record<string, string | null>)[`contact_${f}`] ?? null])) }, after: { name, contacts } }
    }
    case 'note': return { before: { note: order.note }, after: { note: normalizeNote(after.note) } }
    case 'cancel': return { before: { state: order.state }, after: {} }
    default: return refuse(400, 'request_kind_invalid', 'Choose what you would like to change.')
  }
}

export async function submitRequest(deps: OrderDeps, token: string, body: Record<string, unknown>, networkKey: string | null): Promise<OrderBundle> {
  const bundle = await bundleFromToken(deps.db, token)
  const { order } = bundle
  assertPhoneMatches(order, body.phone)
  const kind = String(body.kind ?? '') as RequestKind
  const settings = await loadOrderSettings(deps.db)
  const now = deps.now()
  const verdict = requestAllowed({ order, payments: bundle.payments, sale: bundle.sale, returns: bundle.returns, requests: bundle.requests, events: bundle.events, kind, now, windowDays: settings.requestWindowDays }, deps.env)
  if (!verdict.ok) {
    const refusal = REQUEST_REFUSALS[verdict.reason]
    return refuse(refusal.status, refusal.code, refusal.message)
  }
  const change = buildRequestChange(order, kind, body, deps.env)
  const comment = normalizeComment(body.comment)
  const attachments = await resolveAttachments(deps.db, body.attachments)
  const at = sqlTime(now)
  const max = getPlanLimits(deps.env).onlineOrderRequestMax
  const [result] = await deps.db.batch([
    {
      sql: `INSERT INTO online_order_requests (order_id, kind, stage, before_json, after_json, customer_comment, attachments_json, network_key, created_at)
            SELECT @oid, @kind, @stage, @before, @after, @comment, @attachments, @network, @at
            WHERE (SELECT state FROM online_orders WHERE id = @oid) IN ('paid','review','fulfilled')
              AND NOT EXISTS (
                SELECT 1 FROM online_order_requests r WHERE r.order_id = @oid
                  AND NOT EXISTS (SELECT 1 FROM online_order_events e WHERE e.request_id = r.id AND e.event IN ('request_accepted','request_rejected','request_withdrawn')))
              AND (SELECT COUNT(*) FROM online_order_requests WHERE order_id = @oid) < @max`,
      params: {
        oid: order.id, kind, stage: verdict.stage, before: JSON.stringify(change.before), after: JSON.stringify(change.after), comment,
        attachments: attachments.length ? JSON.stringify(attachments) : null, network: networkKey, at, max,
      },
    },
    {
      sql: `INSERT INTO online_order_events (order_id, request_id, event, source, detail_json, created_at)
            SELECT @oid, (SELECT MAX(id) FROM online_order_requests WHERE order_id = @oid), 'request_submitted', 'customer', @detail, @at WHERE changes() = 1`,
      params: { oid: order.id, at, detail: JSON.stringify({ kind, stage: verdict.stage, attachments: attachments.length }) },
    },
  ])
  if (Number(result.meta?.changes ?? 0) !== 1) {
    const refusal = REQUEST_REFUSALS.one_pending
    return refuse(refusal.status, refusal.code, refusal.message)
  }
  const submitted = (await loadBundle(deps.db, order.token_hash))!
  const latest = submitted.requests[submitted.requests.length - 1]
  if (latest) await announce(deps, { kind: 'request', orderId: order.id, requestId: latest.id, requestKind: kind })
  return submitted
}

/** Withdrawing is free. The customer re-enters the phone for this too: a leaked link alone changes nothing. */
export async function withdrawRequest(deps: OrderDeps, token: string, requestId: unknown, phone: unknown): Promise<OrderBundle> {
  const bundle = await bundleFromToken(deps.db, token)
  const { order } = bundle
  assertPhoneMatches(order, phone)
  const id = Number(requestId)
  const request = Number.isSafeInteger(id) ? bundle.requests.find((r) => r.id === id) : undefined
  if (!request) return refuse(404, 'request_not_found', 'We could not find that request.')
  const status = requestStates(bundle.requests, bundle.events).find((s) => s.id === id)?.status
  if (status !== 'pending') return refuse(409, 'request_not_pending', 'The shop has already answered this request, so it cannot be withdrawn.')
  const at = sqlTime(deps.now())
  const [result] = await deps.db.batch([
    {
      sql: `INSERT INTO online_order_events (order_id, request_id, event, source, detail_json, created_at)
            SELECT @oid, @rid, 'request_withdrawn', 'customer', @detail, @at
            WHERE NOT EXISTS (SELECT 1 FROM online_order_events WHERE request_id = @rid AND event IN ('request_accepted','request_rejected','request_withdrawn'))`,
      params: { oid: order.id, rid: id, at, detail: JSON.stringify({ kind: request.kind }) },
    },
  ])
  if (Number(result.meta?.changes ?? 0) !== 1) return refuse(409, 'request_not_pending', 'The shop has already answered this request, so it cannot be withdrawn.')
  await announce(deps, { kind: 'withdrawn', orderId: order.id, requestId: id, requestKind: request.kind })
  return (await loadBundle(deps.db, order.token_hash))!
}
