// Online orders (KHQR lane, slice S5): what staff do to an order BEFORE it is a sale. Every write is one guarded D1 batch (the order's revision, or the
// event's own uniqueness, gates every later statement), writes its Records row with the actor, and announces itself through OrderDeps.notify so staff
// screens refresh. Who may call what is the route's job (routes/onlineOrders.ts, lib/onlineOrdersAccess.ts):
//   view     list, one order, recheck, note
//   decide   decide a request, apply it to the order, cancel a paid or review order, resolve a review
//   refund   write down a refund that was sent back through ABA
// Money never moves here: a refund is a NOTE that it happened in ABA (the shop sends it from the ABA app); nothing is sent to PayWay but a check.
// After the sale the till's own writers take over (S6): these refuse an order that already has a sale.

import type { D1Compat } from './db'
import { isPhoneShaped, maskPhone } from './phoneMask'
import { checkTransaction, makeTranId, PaywayError, type ParsedCheck, type PaywayCredentials } from './payway'
import { adminPageRows, onlineOrderView, orderMoney, refundNoteAllowed, requestStates, type RequestKind } from './onlineOrders'
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

export const LIST_FILTERS = ['attention', 'all', 'paid', 'review', 'awaiting_payment', 'qr_failed', 'expired', 'cancelled', 'fulfilled'] as const
export type ListFilter = (typeof LIST_FILTERS)[number]
export type ListRow = {
  id: number; order_no: string; state: string; fulfilment: string; customer_name: string; customer_phone: string; goods_total_usd: number; created_at: string
  paid_at: string | null; sale_id: number | null; pending_requests: number; held_review: number
}

/**
 * One page, newest first, by keyset (created_at, id): the cost of a page is the page, never the table. `attention` (paid or review, i.e. to
 * fulfil or to look at) walks the partial index; every other filter walks the state's rows through the created index. The total is NOT counted.
 */
export async function listOrders(db: D1Compat, env: OrderDeps['env'], input: { filter?: unknown; cursor?: unknown; limit?: unknown }): Promise<{ rows: ListRow[]; next_cursor: string | null; page_size: number }> {
  const filter = (LIST_FILTERS as readonly string[]).includes(String(input.filter)) ? String(input.filter) as ListFilter : 'attention'
  const size = adminPageRows(env)
  const limit = Math.min(size, Math.max(1, Number.isSafeInteger(Number(input.limit)) ? Number(input.limit) : size))
  let afterAt: string | null = null
  let afterId = 0
  if (input.cursor != null && input.cursor !== '') {
    const m = String(input.cursor).match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?)\|(\d{1,15})$/)
    if (!m) return refuse(400, 'cursor_invalid', 'That page marker is not valid. Reload the list.')
    afterAt = m[1]; afterId = Number(m[2])
  }
  const where = filter === 'attention' ? "o.state IN ('paid','review')" : filter === 'all' ? '1 = 1' : 'o.state = @state'
  const index = filter === 'attention' ? 'idx_online_orders_attention' : 'idx_online_orders_created'
  const rows = await db.prepare(`
    SELECT o.id, o.order_no, o.state, o.fulfilment, o.customer_name, o.customer_phone, o.goods_total_usd, o.created_at, o.paid_at, o.sale_id,
      (SELECT COUNT(*) FROM online_order_requests r WHERE r.order_id = o.id AND NOT EXISTS (SELECT 1 FROM online_order_events e WHERE e.request_id = r.id AND e.event IN ('request_accepted','request_rejected','request_withdrawn'))) AS pending_requests,
      (SELECT COUNT(*) FROM online_order_payments p WHERE p.order_id = o.id AND p.state = 'review') AS held_review
    FROM online_orders o INDEXED BY ${index}
    WHERE ${where} AND (@afterAt IS NULL OR o.created_at < @afterAt OR (o.created_at = @afterAt AND o.id < @afterId))
    ORDER BY o.created_at DESC, o.id DESC LIMIT @limit
  `).all<ListRow>({ state: filter, afterAt, afterId, limit: limit + 1 })
  const page = (rows || []).slice(0, limit)
  const more = (rows || []).length > limit
  const last = page[page.length - 1]
  return { rows: page, next_cursor: more && last ? `${last.created_at}|${last.id}` : null, page_size: limit }
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
  if (!options.fullPhones) for (const field of CONTACT_FIELDS) { const key = `contact_${field}`; const value = shown[key]; if (typeof value === 'string' && isPhoneShaped(value)) shown[key] = maskPhone(value) }
  return {
    order: shown,
    payments: payments.map(({ qr_string: _qr, deeplink: _link, ...rest }) => { void _qr; void _link; return rest }),
    requests: requests.map((request) => ({ ...request, state: requestStates([request], bundle.events).find((s) => s.id === request.id)?.status ?? 'pending' })),
    events: events || [],
    status: view.status, chips: view.chips, money: view.money,
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
  if (order.sale_id != null) return refuse(409, 'order_has_sale', 'This order was already handed over.')
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
    sql: `INSERT INTO online_order_events (order_id, event, source, actor_id, actor_name, internal_note, amount_usd, reference, sale_id, created_at)
          SELECT @oid, 'refund_noted', 'staff', @aid, @aname, @note, @amount, @ref, @sale, @at
          WHERE (SELECT COALESCE(SUM(CAST(ROUND(amount_usd * 100) AS INTEGER)), 0) FROM online_order_events WHERE order_id = @oid AND event = 'refund_noted') = @noted`,
    params: { oid: order.id, aid: actor.id, aname: actor.name, note, amount: cents / 100, ref: reference, sale: order.sale_id, at: sqlTime(deps.now()), noted },
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
        { sql: `UPDATE online_orders SET customer_address = @address, revision = @newRev, updated_at = @at WHERE id = @oid AND revision = @rev AND state = 'paid' AND sale_id IS NULL`, params: { ...common, address } },
        { ...applied, params: { ...common, to: 'paid', delta: null, detail: JSON.stringify({ kind: 'address' }) } },
      ]
      break
    }
    case 'fulfilment': {
      const address = after.address === undefined ? order.customer_address : normalizeAddress(after.address)
      const fulfilment = normalizeFulfilment(after.fulfilment, address)
      statements = [
        { sql: `UPDATE online_orders SET fulfilment = @fulfilment, customer_address = @address, revision = @newRev, updated_at = @at WHERE id = @oid AND revision = @rev AND state = 'paid' AND sale_id IS NULL`, params: { ...common, fulfilment, address } },
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
