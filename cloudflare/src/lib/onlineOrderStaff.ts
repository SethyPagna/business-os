// Online orders (KHQR lane, slice S5): what staff do to an order BEFORE it is a sale. Every write is one guarded D1 batch (the order's revision, or the
// event's own uniqueness, gates every later statement), writes its Records row with the actor, and announces itself through OrderDeps.notify so staff
// screens refresh. Who may call what is the route's job (routes/onlineOrders.ts, lib/onlineOrdersAccess.ts):
//   view     list, one order, recheck, note
//   decide   decide a request, apply it to the order, cancel a paid or review order, resolve a review
//   refund   write down a refund that was sent back through ABA
// Money never moves here: a refund is a NOTE that it happened in ABA (the shop sends it from the ABA app); nothing is sent to PayWay but a check.
// After the sale the till's own writers take over (S6): these refuse an order that already has a sale.

import type { D1Compat } from './db'
import { isPhoneShaped, maskPhone, maskPhonesInText } from './phoneMask'
import { FULL_NUMBER_MIN_DIGITS, type PhoneSearchAccess } from './phoneSearchGuard'
import { canonicalizePhone } from './phone'
import { normalizeContactName } from './contactDuplicates'
import { customerIsProfileSql } from './anonymousCustomer'
import { checkTransaction, makeTranId, PaywayError, type ParsedCheck, type PaywayCredentials } from './payway'
import { adminPageRows, onlineOrderView, orderMoney, orderMoneyWire, refundNoteAllowed, requestStates, type RequestKind } from './onlineOrders'
import {
  OrderError, applyCheckResult, announceOrderEvent, closeQuietly, itemsJson, loadBundle, loadOrderSettings, normalizeAddress, normalizeContacts, normalizeFulfilment,
  normalizeName, normalizeNote, parseJson, parseLines, priceAndCheckStock, refuse, resolveAttachments, sqlTime, CONTACT_FIELDS,
  type OrderBundle, type OrderDeps, type OrderRecord, type RequestRecord,
} from './onlineOrderStore'

export type Actor = { id: number | null; name: string | null }
const text = (value: unknown, max: number, code: string, label: string): string | null => {
  if (value == null || value === '') return null
  if (typeof value !== 'string') return refuse(400, code, `${label} must be text.`)
  const trimmed = value.trim()
  if (trimmed.length > max) return refuse(400, code, `${label} is too long (${max} characters at most).`)
  return trimmed || null
}
const orderGone = (): never => refuse(404, 'order_not_found', 'That order does not exist.')
const changed = (): never => refuse(409, 'order_changed', 'This order changed while you were looking at it. Reload and try again.')

export async function loadBundleById(db: D1Compat, id: unknown): Promise<OrderBundle> {
  const n = Number(id)
  if (!Number.isSafeInteger(n) || n <= 0) return orderGone()
  const row = await db.prepare('SELECT token_hash FROM online_orders WHERE id = @id').get<{ token_hash: string }>({ id: n })
  const bundle = row ? await loadBundle(db, row.token_hash) : null
  return bundle ?? orderGone()
}

// ---- the list ---------------------------------------------------------------------------------------------------------------------

export const LIST_FILTERS = ['attention', 'all', 'paid', 'review', 'awaiting_payment', 'qr_failed', 'expired', 'cancelled', 'fulfilled', 'requests', 'refund_due'] as const
export type ListFilter = (typeof LIST_FILTERS)[number]
export type ListRow = {
  id: number; order_no: string; state: string; fulfilment: string; customer_name: string; customer_phone: string; goods_total_usd: number; created_at: string
  paid_at: string | null; sale_id: number | null; pending_requests: number; held_review: number
  /** What is still due back to the customer through ABA (0 when nothing is); orders that never took money are always 0. */
  refund_due_usd: number; refund_due: boolean
}

/** ABA can refund a KHQR payment for 30 days; the refund_due filter looks at orders created inside that window plus a little slack, so its cost never grows with history. */
const REFUND_WINDOW_DAYS = 32
const MONEY_STATES = new Set(['paid', 'review', 'cancelled', 'fulfilled'])
const DECIDED = "('request_accepted','request_rejected','request_withdrawn')"
const END_OF_PREFIX = '￿'

/** Owner ruling 10 Nov 2026: staff without the full-phone grant may search by part of a number; the list still shows the number masked. The one place to change if that rule moves. */
const fragmentSearchAllowed = (_access: PhoneSearchAccess): boolean => true

/** The `q` box: an order number prefix (letters, e.g. W2611) or a phone prefix (digits, the canonical form the order stores). Refused when too short to be useful. */
function searchClause(raw: unknown, access: PhoneSearchAccess): { sql: string; params: Record<string, unknown> } | null {
  const q = typeof raw === 'string' ? raw.trim() : ''
  if (!q) return null
  if (q.length > 40) return refuse(400, 'search_invalid', 'That search is too long.')
  if (/^[+\d][\d\s().-]*$/.test(q)) {
    const digits = q.replace(/\D/g, '')
    if (digits.length < 3) return refuse(400, 'search_too_short', 'Type at least 3 digits of the phone number.')
    if (digits.length < FULL_NUMBER_MIN_DIGITS && !access.fullPhone && !fragmentSearchAllowed(access)) return refuse(400, 'search_phone_whole_number', 'Type the whole phone number.')
    // The stored form folds 855xxxxxxxx to 0xxxxxxxx (lib/phone.ts), so a typed +855 prefix is looked up in both spellings.
    const prefixes = digits.startsWith('855') && digits.length > 3 ? [digits, `0${digits.slice(3)}`] : [digits]
    return {
      sql: `(${prefixes.map((_, i) => `(o.customer_phone >= @p${i} AND o.customer_phone < @p${i}e)`).join(' OR ')})`,
      params: Object.fromEntries(prefixes.flatMap((p, i) => [[`p${i}`, p], [`p${i}e`, p + END_OF_PREFIX]])),
    }
  }
  const number = q.toUpperCase().replace(/[\s-]/g, '')
  if (number.length < 3) return refuse(400, 'search_too_short', 'Type at least 3 characters of the order number.')
  return { sql: '(o.order_no >= @no AND o.order_no < @noe)', params: { no: number, noe: number + END_OF_PREFIX } }
}

/**
 * Sets refund_due_usd on the rows that could owe money, from the SAME money read the order screen uses (orderMoney), for the whole page in ONE batch (payments, the two
 * event kinds that matter, the sales and their returns). Rows in other states (never paid, expired) cost nothing.
 */
async function attachRefundDue(db: D1Compat, rows: ListRow[]): Promise<void> {
  const money = rows.filter((row) => MONEY_STATES.has(row.state))
  for (const row of rows) { row.refund_due_usd = 0; row.refund_due = false }
  if (!money.length) return
  const ids = money.map((row) => row.id)
  const saleIds = money.map((row) => row.sale_id).filter((id): id is number => id != null)
  const marks = (list: readonly number[]) => list.map(() => '?').join(',')
  // sql-bound-params: a page is at most the plan's page size (50 at most), well under the 100-bind limit.
  const results = await db.batch([
    { sql: `SELECT id, order_id, state, paid_amount, amount, purpose FROM online_order_payments WHERE order_id IN (${marks(ids)})`, params: ids },
    { sql: `SELECT id, order_id, event, payment_id, amount_usd, sale_id FROM online_order_events WHERE order_id IN (${marks(ids)}) AND event IN ('payment_recorded_on_sale','refund_noted')`, params: ids },
    ...(saleIds.length ? [
      { sql: `SELECT * FROM sales WHERE id IN (${marks(saleIds)})`, params: saleIds },
      { sql: `SELECT id, sale_id, status, total_refund_usd, owed_reduction_usd, refund_currency, refund_channel FROM returns WHERE sale_id IN (${marks(saleIds)})`, params: saleIds },
    ] : []),
  ])
  const part = (index: number): Array<Record<string, unknown>> => ((results[index] as { results?: Array<Record<string, unknown>> } | undefined)?.results) ?? []
  const group = (list: Array<Record<string, unknown>>, key: string) => {
    const map = new Map<number, Array<Record<string, unknown>>>()
    for (const item of list) { const k = Number(item[key]); map.set(k, [...(map.get(k) ?? []), item]) }
    return map
  }
  const payments = group(part(0), 'order_id'), events = group(part(1), 'order_id')
  const sales = new Map(part(2).map((sale) => [Number(sale.id), sale])), returns = group(part(3), 'sale_id')
  for (const row of money) {
    const due = orderMoney(
      row as never, (payments.get(row.id) ?? []) as never, (events.get(row.id) ?? []) as never,
      row.sale_id == null ? null : ((sales.get(row.sale_id) ?? null) as never), (row.sale_id == null ? [] : returns.get(row.sale_id) ?? []) as never,
    ).refundDueUsd
    row.refund_due_usd = due; row.refund_due = due > 0
  }
}

/**
 * One page, newest first, by keyset (created_at, id): the cost of a page is the page, never the table. `attention` (paid or review, i.e. to
 * fulfil or to look at) walks the partial index; every other filter walks the state's rows through the created index. The total is NOT counted.
 * `q` searches an order number prefix or a phone prefix (indexed: the order_no unique index, idx_online_orders_phone) across every state unless a filter is also given.
 * `requests` lists orders with an undecided change request; `refund_due` lists orders inside ABA's refund window that still owe the customer money (read exactly, a few rounds
 * of candidates at most, the cursor continues where they stopped).
 */
export async function listOrders(db: D1Compat, env: OrderDeps['env'], input: { filter?: unknown; cursor?: unknown; limit?: unknown; q?: unknown; now?: Date; access: PhoneSearchAccess }): Promise<{ rows: ListRow[]; next_cursor: string | null; page_size: number }> {
  const search = searchClause(input.q, input.access)
  const given = (LIST_FILTERS as readonly string[]).includes(String(input.filter))
  const filter = given ? String(input.filter) as ListFilter : search ? 'all' : 'attention'
  const size = adminPageRows(env)
  const limit = Math.min(size, Math.max(1, Number.isSafeInteger(Number(input.limit)) ? Number(input.limit) : size))
  let afterAt: string | null = null
  let afterId = 0
  if (input.cursor != null && input.cursor !== '') {
    const m = String(input.cursor).match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?)\|(\d{1,15})$/)
    if (!m) return refuse(400, 'cursor_invalid', 'That page marker is not valid. Reload the list.')
    afterAt = m[1]; afterId = Number(m[2])
  }
  const since = sqlTime(new Date((input.now ?? new Date()).getTime() - REFUND_WINDOW_DAYS * 86_400_000))
  const where = [
    filter === 'attention' ? "o.state IN ('paid','review')"
      : filter === 'all' ? '1 = 1'
        : filter === 'requests' ? `o.id IN (SELECT r.order_id FROM online_order_requests r WHERE NOT EXISTS (SELECT 1 FROM online_order_events e WHERE e.request_id = r.id AND e.event IN ${DECIDED}))`
          : filter === 'refund_due' ? "o.state IN ('paid','review','cancelled','fulfilled') AND o.created_at >= @since AND EXISTS (SELECT 1 FROM online_order_payments p WHERE p.order_id = o.id AND p.state IN ('paid','review'))"
            : 'o.state = @state',
    ...(search ? [search.sql] : []),
  ].join(' AND ')
  // The planner picks the search's own index (order_no unique, phone); the plain lists keep their fixed index.
  const index = search || filter === 'requests' ? '' : `INDEXED BY ${filter === 'attention' ? 'idx_online_orders_attention' : 'idx_online_orders_created'}`
  const exact = filter === 'refund_due'
  const perRound = exact ? limit * 2 : limit
  const fetchRows = async (at: string | null, id: number, n: number): Promise<ListRow[]> => (await db.prepare(`
    SELECT o.id, o.order_no, o.state, o.fulfilment, o.customer_name, o.customer_phone, o.goods_total_usd, o.created_at, o.paid_at, o.sale_id,
      (SELECT COUNT(*) FROM online_order_requests r WHERE r.order_id = o.id AND NOT EXISTS (SELECT 1 FROM online_order_events e WHERE e.request_id = r.id AND e.event IN ${DECIDED})) AS pending_requests,
      (SELECT COUNT(*) FROM online_order_payments p WHERE p.order_id = o.id AND p.state = 'review') AS held_review
    FROM online_orders o ${index}
    WHERE ${where} AND (@afterAt IS NULL OR o.created_at < @afterAt OR (o.created_at = @afterAt AND o.id < @afterId))
    ORDER BY o.created_at DESC, o.id DESC LIMIT @limit
  `).all<ListRow>({ state: filter, since, afterAt: at, afterId: id, limit: n, ...(search?.params ?? {}) })) || []
  const cursorOf = (row: ListRow) => `${row.created_at}|${row.id}`
  const page: ListRow[] = []
  let next: string | null = null
  let at = afterAt
  let id = afterId
  for (let round = 0; round < (exact ? 3 : 1); round += 1) {
    const batch = await fetchRows(at, id, perRound + 1)
    const scanned = batch.slice(0, perRound)
    await attachRefundDue(db, scanned)
    let full = false
    for (const row of scanned) {
      if (exact && !row.refund_due) continue
      if (page.length >= limit) { full = true; break }
      page.push(row)
    }
    if (full) { next = cursorOf(page[page.length - 1]); break }
    if (batch.length <= perRound) { next = null; break }
    const tail = scanned[scanned.length - 1]
    at = tail.created_at; id = tail.id; next = cursorOf(tail)
  }
  return { rows: page, next_cursor: next, page_size: limit }
}

/**
 * Review F6 and the owner's 10 Nov 2026 ruling: a change request stores what the customer proposed (and the order held) as JSON. Only its STRUCTURED phone fields are masked for staff
 * without the full-phone permission: the contact handles (a social handle can be a phone number under any key) and a phone field. Text the buyer typed (a note, an address, a name, a
 * reason) shows as typed. Text that cannot be parsed is not shown at all.
 */
const STRUCTURED_PHONE_KEY = /^(contacts|contact_w+|customer_phone|phone)$/
function maskPhonesInJson(raw: string | null | undefined): string | null {
  if (raw == null) return null
  let value: unknown
  try { value = JSON.parse(raw) } catch { return '{}' }
  const walk = (node: unknown, structured: boolean): unknown => {
    if (typeof node === 'string') return !structured ? node : isPhoneShaped(node) ? maskPhone(node) : maskPhonesInText(node)
    if (Array.isArray(node)) return node.map((child) => walk(child, structured))
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([key, child]) => [key, walk(child, structured || STRUCTURED_PHONE_KEY.test(key))]))
    return node
  }
  return JSON.stringify(walk(value, false))
}

/**
 * Review N5 and the owner's 10 Nov 2026 ruling "suggest, the cashier confirms". The till sale that fulfils an order is made for the order's customer. `auto: true` only when the
 * buyer was signed in: the order's portal account points at the customer (portal_accounts.contact_id), so the till may link it. Otherwise the typed phone AND name (the existing
 * customer rule; a number shared by a different name is a conflict a person must look at) can only SUGGEST a customer (`auto: false`) that the cashier taps to confirm. Exactly
 * one qualifying customer is named; none, or several (six rows are read, ordered by id), name nobody. Only an order the till can still fulfil is looked up (paid, no sale).
 */
export async function matchOrderCustomer(db: D1Compat, order: { state?: unknown; sale_id?: unknown; customer_phone?: unknown; customer_name?: unknown; portal_account_id?: unknown }): Promise<{ id: number; name: string; auto: boolean } | null> {
  if (order.sale_id != null || order.state !== 'paid') return null
  if (order.portal_account_id != null) {
    const signedIn = await db.prepare(`SELECT c.id, c.name FROM portal_accounts a JOIN customers c ON c.id = a.contact_id WHERE a.id = @account AND ${customerIsProfileSql('c')}`)
      .get<{ id: number; name: string | null }>({ account: order.portal_account_id })
    if (signedIn) return { id: Number(signedIn.id), name: String(signedIn.name ?? ''), auto: true }
  }
  const phone = canonicalizePhone(order.customer_phone)
  const name = normalizeContactName(order.customer_name)
  if (!phone || !name) return null
  const rows = await db.prepare('SELECT id, name FROM customers WHERE phone_normalized = @phone AND COALESCE(is_anonymous, 0) = 0 ORDER BY id LIMIT 6')
    .all<{ id: number; name: string | null }>({ phone }) || []
  const same = rows.filter((row) => normalizeContactName(row.name) === name)
  return rows.length < 6 && same.length === 1 ? { id: Number(same[0].id), name: String(same[0].name), auto: false } : null
}

// ---- the detail -------------------------------------------------------------------------------------------------------------------

/** The staff view of one order: the row (the response mask hides the phone without the permission), payments, Records, requests and the money read. */
export async function staffDetail(db: D1Compat, id: unknown, now: Date, requestWindowDays: number, options: { fullPhones?: boolean } = {}) {
  const bundle = await loadBundleById(db, id)
  const { order, payments, requests, sale, returns } = bundle
  const events = await db.prepare(`SELECT id, event, payment_id, request_id, from_state, to_state, source, actor_name, public_comment, internal_note, amount_usd, reference, attachments_json, sale_id, created_at
    FROM online_order_events WHERE order_id = @id ORDER BY id ASC`).all<Record<string, unknown>>({ id: order.id })
  const view = onlineOrderView(order, payments, bundle.events, sale, returns, { now, requestWindowDays, requests })
  const { token_hash: _hash, network_key: _network, ...safeOrder } = order as OrderRecord & { network_key?: string }
  void _hash; void _network
  // The response mask hides `customer_phone` by its key; a social handle can be a phone number under any key (contact_whatsapp, contact_telegram...), so those are masked here
  // unless the caller may see full phone numbers.
  const shown: Record<string, unknown> = { ...safeOrder }
  if (!options.fullPhones) for (const field of CONTACT_FIELDS) { const key = `contact_${field}`; const value = shown[key]; if (typeof value === 'string') shown[key] = isPhoneShaped(value) ? maskPhone(value) : maskPhonesInText(value) }
  return {
    order: shown,
    payments: payments.map(({ qr_string: _qr, deeplink: _link, ...rest }) => { void _qr; void _link; return rest }),
    requests: requests.map((request) => ({ ...request, ...(options.fullPhones ? {} : { before_json: maskPhonesInJson(request.before_json), after_json: maskPhonesInJson(request.after_json) }), state: requestStates([request], bundle.events).find((s) => s.id === request.id)?.status ?? 'pending' })),
    events: events || [],
    customer_match: await matchOrderCustomer(db, order),
    status: view.status, chips: view.chips, money: { ...view.money, ...orderMoneyWire(view.money, bundle.events) },
  }
}

// ---- recheck ----------------------------------------------------------------------------------------------------------------------

/** Ask PayWay about every payment of this order that could still turn into money, once each. A staff press is not throttled (it is one order, a handful of calls). */
export async function recheckOrder(deps: OrderDeps, creds: PaywayCredentials | null, id: unknown): Promise<{ checked: number; outcomes: string[] }> {
  if (!creds) return refuse(503, 'payway_not_configured', 'Online payment is not set up on this server.')
  const bundle = await loadBundleById(deps.db, id)
  const outcomes: string[] = []
  for (const payment of bundle.payments.filter((p) => ['awaiting', 'expired', 'cancelled', 'failed'].includes(p.state) && p.qr_string)) {
    let check: ParsedCheck
    try { check = await checkTransaction(deps.transport, creds, deps.now(), payment.tran_id) } catch (error) { check = { ok: false, reason: error instanceof PaywayError ? error.reason : 'transport_failed' } }
    outcomes.push(await applyCheckResult(deps, bundle.order, payment, check, 'payway', creds))
  }
  return { checked: outcomes.length, outcomes }
}

// ---- note -------------------------------------------------------------------------------------------------------------------------

export async function noteOrder(deps: OrderDeps, actor: Actor, id: unknown, body: Record<string, unknown>): Promise<void> {
  const note = text(body.note, 500, 'note_invalid', 'The note')
  if (!note) return refuse(400, 'note_required', 'Write the note first.')
  const { order } = await loadBundleById(deps.db, id)
  await deps.db.batch([{
    sql: `INSERT INTO online_order_events (order_id, event, source, actor_id, actor_name, internal_note, created_at) VALUES (@oid, 'note', 'staff', @aid, @aname, @note, @at)`,
    params: { oid: order.id, aid: actor.id, aname: actor.name, note, at: sqlTime(deps.now()) },
  }])
  await announceOrderEvent(deps, { kind: 'staff', orderId: order.id })
}

// ---- cancel a paid or review order ------------------------------------------------------------------------------------------------

/** Staff cancel an order that was paid (or is held in review) and has no sale yet. The money stays where it is: the refund due reads from it, and the refund is noted when it is sent. */
export async function cancelPaidOrder(deps: OrderDeps, creds: PaywayCredentials | null, actor: Actor, id: unknown, body: Record<string, unknown>): Promise<void> {
  const reason = text(body.reason, 500, 'reason_invalid', 'The reason')
  const bundle = await loadBundleById(deps.db, id)
  const { order } = bundle
  if (order.sale_id != null || order.state === 'fulfilled') return refuse(409, 'order_has_sale', 'This order was already handed over. Use the sale to cancel it.')
  if (!['paid', 'review'].includes(order.state)) return refuse(409, 'order_not_cancellable_here', 'Only a paid order, or one held for review, is cancelled here.')
  const expectedRevision = body.revision === undefined ? order.revision : Number(body.revision)
  if (expectedRevision !== order.revision) return changed()
  const at = sqlTime(deps.now())
  const moved = `EXISTS (SELECT 1 FROM online_orders WHERE id = @oid AND revision = @newRev AND state = 'cancelled')`
  const [result] = await deps.db.batch([
    { sql: `UPDATE online_orders SET state = 'cancelled', revision = @newRev, updated_at = @at WHERE id = @oid AND revision = @rev AND state IN ('paid','review') AND sale_id IS NULL`, params: { oid: order.id, rev: order.revision, newRev: order.revision + 1, at } },
    { sql: `UPDATE online_order_payments SET state = 'cancelled', revision = revision + 1, updated_at = @at WHERE order_id = @oid AND state = 'awaiting' AND ${moved}`, params: { oid: order.id, newRev: order.revision + 1, at } },
    {
      sql: `INSERT INTO online_order_events (order_id, event, from_state, to_state, source, actor_id, actor_name, internal_note, created_at)
            SELECT @oid, 'cancelled', @from, 'cancelled', 'staff', @aid, @aname, @reason, @at WHERE ${moved}`,
      params: { oid: order.id, newRev: order.revision + 1, from: order.state, aid: actor.id, aname: actor.name, reason, at },
    },
  ])
  if (Number(result.meta?.changes ?? 0) !== 1) return changed()
  await closeQuietly(deps, creds, bundle.payments.filter((p) => p.state === 'awaiting' && p.qr_string).map((p) => p.tran_id))
  await announceOrderEvent(deps, { kind: 'cancelled', orderId: order.id })
}

// ---- resolve a review -------------------------------------------------------------------------------------------------------------

/**
 * Staff accept the money PayWay took on a payment held in review: the payment becomes paid with its REAL amount (never the order's price), and an
 * order in review becomes paid. A review payment that never kept an amount cannot be accepted (nothing says what was taken).
 */
export async function resolveReview(deps: OrderDeps, actor: Actor, id: unknown, body: Record<string, unknown>): Promise<void> {
  const note = text(body.note, 500, 'note_invalid', 'The note')
  const bundle = await loadBundleById(deps.db, id)
  const { order } = bundle
  // Review F4: a late review (after the Fulfil) is resolved here too: the payment turns paid, the order keeps its state and the money view reads the rest as refundable.
  const held = bundle.payments.filter((p) => p.state === 'review')
  if (!held.length) return refuse(409, 'nothing_to_resolve', 'No payment of this order is waiting for review.')
  if (held.some((p) => !(Number(p.paid_amount) > 0))) return refuse(409, 'no_amount_held', 'PayWay did not report an amount for this payment. Check it in ABA and cancel the order instead.')
  const expectedRevision = body.revision === undefined ? order.revision : Number(body.revision)
  if (expectedRevision !== order.revision) return changed()
  const at = sqlTime(deps.now())
  const ids = held.map((p) => p.id)
  const named = ids.map((_, i) => `@p${i}`).join(',')
  const idParams = Object.fromEntries(ids.map((pid, i) => [`p${i}`, pid]))
  const orderMoves = order.state === 'review'
  const [first] = await deps.db.batch([
    {
      sql: `UPDATE online_order_payments SET state = 'paid', paid_at = @at, revision = revision + 1, updated_at = @at
            WHERE order_id = @oid AND state = 'review' AND paid_amount > 0 AND id IN (${named}) AND EXISTS (SELECT 1 FROM online_orders WHERE id = @oid AND revision = @rev)`,
      params: { ...idParams, oid: order.id, at, rev: order.revision },
    },
    {
      sql: `UPDATE online_orders SET state = CASE WHEN state = 'review' THEN 'paid' ELSE state END, paid_at = COALESCE(paid_at, @at), revision = revision + 1, updated_at = @at
            WHERE id = @oid AND revision = @rev AND changes() > 0 AND @all = 1`,
      params: { oid: order.id, rev: order.revision, at, all: 1 },
    },
    {
      sql: `INSERT INTO online_order_events (order_id, payment_id, event, from_state, to_state, source, actor_id, actor_name, internal_note, amount_usd, created_at)
            SELECT @oid, p.id, 'resolved', @from, @to, 'staff', @aid, @aname, @note, p.paid_amount, @at FROM online_order_payments p
            WHERE p.order_id = @oid AND p.id IN (${named}) AND p.state = 'paid' AND p.paid_at = @at
              AND EXISTS (SELECT 1 FROM online_orders WHERE id = @oid AND revision = @newRev)`,
      params: { ...idParams, oid: order.id, at, from: order.state, to: orderMoves ? 'paid' : order.state, aid: actor.id, aname: actor.name, note, newRev: order.revision + 1 },
    },
  ])
  if (Number(first.meta?.changes ?? 0) < 1) return changed()
  await announceOrderEvent(deps, { kind: 'staff', orderId: order.id })
}

// ---- refund note ------------------------------------------------------------------------------------------------------------------

/**
 * Write down that a refund was sent through ABA. It may not exceed what is still due (money read from the payments, the sale and the notes already
 * written), so a second note for the same money is refused. The insert re-checks, inside the same statement, that no other note landed since this
 * one was priced (two staff pressing at once cannot both pass).
 */
/**
 * The refund note INSERT. Beyond the notes already written (@noted cents) it asserts that no ABA return of the sale landed since the note was priced (@abaCount, the number
 * of the sale's ABA returns the pricing read): a return and a note racing for the same money cannot both pass (review F7; the return side holds the same cap in its own batch).
 */
export const REFUND_NOTE_INSERT_SQL = `INSERT INTO online_order_events (order_id, event, source, actor_id, actor_name, internal_note, amount_usd, reference, sale_id, created_at)
          SELECT @oid, 'refund_noted', 'staff', @aid, @aname, @note, @amount, @ref, @sale, @at
          WHERE (SELECT COALESCE(SUM(CAST(ROUND(amount_usd * 100) AS INTEGER)), 0) FROM online_order_events WHERE order_id = @oid AND event = 'refund_noted') = @noted
            AND (SELECT COUNT(*) FROM returns WHERE sale_id = @sale AND refund_channel = 'aba') = @abaCount
            AND (SELECT sale_id FROM online_orders WHERE id = @oid) IS @sale`

export async function noteRefund(deps: OrderDeps, actor: Actor, id: unknown, body: Record<string, unknown>): Promise<{ due_after_usd: number }> {
  const amount = Number(body.amount_usd)
  const reference = text(body.reference, 60, 'reference_invalid', 'The ABA reference')
  const note = text(body.note, 500, 'note_invalid', 'The note')
  if (!Number.isFinite(amount)) return refuse(400, 'amount_invalid', 'Enter the refund amount in dollars.')
  const bundle = await loadBundleById(deps.db, id)
  const { order, payments, sale, returns } = bundle
  const money = orderMoney(order, payments, bundle.events, sale, returns)
  if (!refundNoteAllowed(amount, money.refundDueUsd)) return refuse(409, 'refund_over_due', `The refund cannot be more than what is still due (${money.refundDueUsd.toFixed(2)} USD).`, { refund_due_usd: money.refundDueUsd })
  const cents = Math.round(amount * 100)
  const noted = bundle.events.filter((e) => e.event === 'refund_noted').reduce((sum, e) => sum + Math.round(Number(e.amount_usd ?? 0) * 100), 0)
  const [result] = await deps.db.batch([{
    sql: REFUND_NOTE_INSERT_SQL,
    params: { oid: order.id, aid: actor.id, aname: actor.name, note, amount: cents / 100, ref: reference, sale: order.sale_id, at: sqlTime(deps.now()), noted, abaCount: returns.filter((r) => r.refund_channel === 'aba').length },
  }])
  if (Number(result.meta?.changes ?? 0) !== 1) return changed()
  await announceOrderEvent(deps, { kind: 'refund', orderId: order.id, amountUsd: cents / 100 })
  return { due_after_usd: Math.max(0, Math.round((money.refundDueUsd - cents / 100) * 100) / 100) }
}

// ---- deciding and applying a request ----------------------------------------------------------------------------------------------

function requestOf(bundle: OrderBundle, requestId: unknown): RequestRecord {
  const rid = Number(requestId)
  return (Number.isSafeInteger(rid) ? bundle.requests.find((r) => r.id === rid) : undefined) ?? refuse(404, 'request_not_found', 'That request does not exist.')
}
const statusOf = (bundle: OrderBundle, request: RequestRecord) => requestStates([request], bundle.events)[0]?.status ?? 'pending'

export async function decideRequest(deps: OrderDeps, actor: Actor, id: unknown, requestId: unknown, body: Record<string, unknown>): Promise<void> {
  const decision = body.decision === 'accept' ? 'request_accepted' : body.decision === 'reject' ? 'request_rejected' : null
  if (!decision) return refuse(400, 'decision_invalid', 'Choose accept or reject.')
  const publicComment = text(body.public_comment, 300, 'comment_invalid', 'The message to the customer')
  const internal = text(body.internal_note, 500, 'note_invalid', 'The note')
  const attachments = await resolveAttachments(deps.db, body.attachments)
  const bundle = await loadBundleById(deps.db, id)
  const request = requestOf(bundle, requestId)
  if (statusOf(bundle, request) !== 'pending') return refuse(409, 'request_not_pending', 'This request was already answered or withdrawn.')
  try {
    const [result] = await deps.db.batch([{
      sql: `INSERT INTO online_order_events (order_id, request_id, event, source, actor_id, actor_name, public_comment, internal_note, attachments_json, detail_json, created_at)
            SELECT @oid, @rid, @event, 'staff', @aid, @aname, @pc, @internal, @att, @detail, @at
            WHERE NOT EXISTS (SELECT 1 FROM online_order_events WHERE request_id = @rid AND event IN ('request_accepted','request_rejected','request_withdrawn'))`,
      params: { oid: bundle.order.id, rid: request.id, event: decision, aid: actor.id, aname: actor.name, pc: publicComment, internal, att: attachments.length ? JSON.stringify(attachments) : null, detail: JSON.stringify({ kind: request.kind }), at: sqlTime(deps.now()) },
    }])
    if (Number(result.meta?.changes ?? 0) !== 1) return refuse(409, 'request_not_pending', 'This request was already answered or withdrawn.')
  } catch (error) {
    if (error instanceof OrderError) throw error
    return refuse(409, 'request_not_pending', 'This request was already answered or withdrawn.')
  }
  await announceOrderEvent(deps, { kind: 'decided', orderId: bundle.order.id, requestKind: request.kind, accepted: decision === 'request_accepted' })
}

/**
 * Apply an ACCEPTED request to the order before it is a sale. Details, address, contact and note are copied from what the customer proposed. A new item
 * list is re-priced with the till's kernel and the stock checked: a higher total adds a top-up payment (awaiting; the customer's page issues its QR), a
 * lower one needs nothing (the refund due now reads it). A cancel request cancels the order. A return belongs to the sale (S6).
 */
export async function applyRequest(deps: OrderDeps, creds: PaywayCredentials | null, actor: Actor, id: unknown, requestId: unknown, body: Record<string, unknown>): Promise<{ top_up_usd: number }> {
  const bundle = await loadBundleById(deps.db, id)
  const { order } = bundle
  const request = requestOf(bundle, requestId)
  if (statusOf(bundle, request) !== 'accepted') return refuse(409, 'request_not_accepted', 'Accept the request first (and only once).')
  if (order.sale_id != null || order.state === 'fulfilled' || request.stage !== 'paid') return refuse(409, 'apply_on_sale', 'This order is already a sale. Apply the change from the sale.')
  if (order.state !== 'paid') return refuse(409, 'order_not_paid', 'Resolve the payment review first.')
  const expectedRevision = body.revision === undefined ? order.revision : Number(body.revision)
  if (expectedRevision !== order.revision) return changed()
  const after = parseJson<Record<string, unknown>>(request.after_json, {})
  const at = sqlTime(deps.now())
  const newRev = order.revision + 1
  const moved = 'EXISTS (SELECT 1 FROM online_orders WHERE id = @oid AND revision = @newRev)'
  const applied = {
    sql: `INSERT INTO online_order_events (order_id, request_id, event, from_state, to_state, source, actor_id, actor_name, amount_usd, detail_json, created_at)
          SELECT @oid, @rid, 'request_applied', 'paid', @to, 'staff', @aid, @aname, @delta, @detail, @at WHERE ${moved}`,
  }
  const common = { oid: order.id, rid: request.id, rev: order.revision, newRev, at, aid: actor.id, aname: actor.name }
  let statements: Array<{ sql: string; params: Record<string, unknown> }>
  let topUp = 0
  let closeTrans: string[] = []
  switch (request.kind as RequestKind) {
    case 'cancel': {
      statements = [
        { sql: `UPDATE online_orders SET state = 'cancelled', revision = @newRev, updated_at = @at WHERE id = @oid AND revision = @rev AND state = 'paid' AND sale_id IS NULL`, params: common },
        { sql: `UPDATE online_order_payments SET state = 'cancelled', revision = revision + 1, updated_at = @at WHERE order_id = @oid AND state = 'awaiting' AND ${moved}`, params: common },
        { ...applied, params: { ...common, to: 'cancelled', delta: null, detail: JSON.stringify({ kind: 'cancel' }) } },
      ]
      closeTrans = bundle.payments.filter((p) => p.state === 'awaiting' && p.qr_string).map((p) => p.tran_id)
      break
    }
    case 'note':
      statements = [
        { sql: `UPDATE online_orders SET note = @note, revision = @newRev, updated_at = @at WHERE id = @oid AND revision = @rev AND state = 'paid' AND sale_id IS NULL`, params: { ...common, note: normalizeNote(after.note) } },
        { ...applied, params: { ...common, to: 'paid', delta: null, detail: JSON.stringify({ kind: 'note' }) } },
      ]
      break
    case 'address': {
      const address = normalizeAddress(after.address)
      if (!address) return refuse(400, 'address_required', 'The request has no address to apply.')
      statements = [
        { sql: `UPDATE online_orders SET customer_address = CASE WHEN fulfilment = 'delivery' THEN @address ELSE NULL END, revision = @newRev, updated_at = @at WHERE id = @oid AND revision = @rev AND state = 'paid' AND sale_id IS NULL`, params: { ...common, address } },
        { ...applied, params: { ...common, to: 'paid', delta: null, detail: JSON.stringify({ kind: 'address' }) } },
      ]
      break
    }
    case 'fulfilment': {
      const address = after.address === undefined ? order.customer_address : normalizeAddress(after.address)
      const fulfilment = normalizeFulfilment(after.fulfilment, address)
      const kept = fulfilment === 'delivery' ? address : null
      statements = [
        { sql: `UPDATE online_orders SET fulfilment = @fulfilment, customer_address = @address, revision = @newRev, updated_at = @at WHERE id = @oid AND revision = @rev AND state = 'paid' AND sale_id IS NULL`, params: { ...common, fulfilment, address: kept } },
        { ...applied, params: { ...common, to: 'paid', delta: null, detail: JSON.stringify({ kind: 'fulfilment' }) } },
      ]
      break
    }
    case 'contact': {
      const contacts = normalizeContacts(after.contacts)
      const name = after.name === undefined ? order.customer_name : normalizeName(after.name)
      statements = [
        {
          sql: `UPDATE online_orders SET customer_name = @name, contact_telegram = @telegram, contact_instagram = @instagram, contact_facebook = @facebook, contact_tiktok = @tiktok,
                  contact_whatsapp = @whatsapp, contact_other = @other, revision = @newRev, updated_at = @at WHERE id = @oid AND revision = @rev AND state = 'paid' AND sale_id IS NULL`,
          params: { ...common, name, ...Object.fromEntries(CONTACT_FIELDS.map((f) => [f, contacts[f]])) },
        },
        { ...applied, params: { ...common, to: 'paid', delta: null, detail: JSON.stringify({ kind: 'contact' }) } },
      ]
      break
    }
    case 'items': {
      const lines = parseLines((after as { items?: unknown }).items, deps.env)
      const settings = await loadOrderSettings(deps.db)
      const facts = await priceAndCheckStock(deps, lines, settings)
      const newTotal = facts.priced.goodsTotalUsd
      const delta = Math.round((newTotal - Number(order.goods_total_usd)) * 100) / 100
      topUp = Math.max(0, delta)
      const tran = makeTranId('W', deps.random(20))
      statements = [
        {
          sql: `UPDATE online_orders SET goods_total_usd = @total, goods_total_khr = @khr, exchange_rate = @rate, items_json = @items, pricing_version = @pricing, branch_id = @branch,
                  revision = @newRev, updated_at = @at WHERE id = @oid AND revision = @rev AND state = 'paid' AND sale_id IS NULL`,
          params: { ...common, total: newTotal, khr: facts.priced.goodsTotalKhr, rate: settings.exchangeRate, items: itemsJson(facts), pricing: facts.priced.pricingVersion, branch: facts.branchId },
        },
        ...(topUp > 0 ? [{
          sql: `INSERT INTO online_order_payments (order_id, tran_id, purpose, request_id, amount, currency, state, revision, created_at, updated_at)
                SELECT @oid, @tran, 'top_up', @rid, @amount, 'USD', 'awaiting', 0, @at, @at WHERE ${moved}`,
          params: { ...common, tran, amount: topUp },
        }] : []),
        { ...applied, params: { ...common, to: 'paid', delta, detail: JSON.stringify({ kind: 'items', from_total_usd: Number(order.goods_total_usd), to_total_usd: newTotal, top_up_usd: topUp }) } },
      ]
      break
    }
    default:
      return refuse(409, 'apply_on_sale', 'This kind of request belongs to the sale. Apply it from the sale.')
  }
  let results
  try { results = await deps.db.batch(statements) } catch { return refuse(409, 'request_not_accepted', 'This request was already applied.') }
  if (Number(results[0].meta?.changes ?? 0) !== 1) return changed()
  await closeQuietly(deps, creds, closeTrans)
  await announceOrderEvent(deps, { kind: 'applied', orderId: order.id, requestKind: request.kind, topUpUsd: topUp })
  return { top_up_usd: topUp }
}
