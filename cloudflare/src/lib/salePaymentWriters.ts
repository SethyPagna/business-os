// The WRITERS of sale payment events (lane 6.0.982, slice S4 of DESIGN-SALE-ADDITIONS-PAYMENTS; table 0271).
//
// The pure money core (salePayments.ts, mirrored in the frontend) builds and reads events. This file is the
// Worker-only part that turns a checkout, a settle, an instalment and their undo/redo into rows: the SQL of
// the inserts, which branch and cashier a payment belongs to, which events a reversal answers, and the
// refusal when a later payment depends on the one being undone. Nothing here is mirrored.
//
// The invariant every writer keeps (health column payment_events_mismatch): for a payments_version 1 sale,
// SUM(in) - SUM(out) of amount_paid_usd / amount_paid_khr over its events equals sales.amount_paid_* exactly.
// So every reversal copies the money columns of the event it reverses (never re-sums its details), and it
// copies that event's change too, so the drawer nets to zero: a collect of $20 that handed back $7 is
// reversed by an out of $20 with the same $7 change, which the shift reader nets to -$13.
//
// Times are written canonical ('YYYY-MM-DD HH:MM:SS' UTC, salePayments.canonicalEventTime): the shift reader
// compares received_at as text against idx_sale_payment_events_received (review E5b).

import type { BranchEffectRow } from './branchEffect'
import {
  buildOpeningPaymentEvent,
  buildPaymentEvent,
  canonicalEventTime,
  PaymentEventError,
  type PaymentEventDirection,
  type PaymentEventInsert,
  type PaymentEventOrigin,
  type PaymentTenderRow,
} from './salePayments'
import { paymentMethodKey } from './paymentMethodRegistry'
import { tenderRowMarkers } from './paymentSettlement'

type Statement = { sql: string; params: Record<string, unknown> }

const EVENT_COLUMNS = [
  'event_id', 'sale_id', 'direction', 'origin', 'covers_operation_id', 'operation_id', 'reverses_event_id',
  'payment_method', 'payment_details', 'amount_paid_usd', 'amount_paid_khr', 'change_usd', 'change_khr',
  'change_is_actual', 'change_exchange_rate', 'exchange_rate', 'drawer_effect', 'received_at', 'branch_id',
  'cashier_id', 'cashier_name', 'note',
] as const

/** The columns a stored event is read back with (one row of sale_payment_events plus its id). */
export const PAYMENT_EVENT_SELECT_SQL = `id,${EVENT_COLUMNS.join(',')}`

export type StoredPaymentEvent = PaymentEventInsert & { id: number }

/**
 * One event row as an INSERT ... SELECT, so a condition can ride on it. `onlyWhileVersion0` makes the opening
 * event conditional on the sale still being version 0 in the same transaction (the revision guard of every
 * writer already refuses a sale that moved; this is the belt to that brace).
 */
export function paymentEventInsertStatement(event: PaymentEventInsert, options: { onlyWhileVersion0?: boolean } = {}): Statement {
  const params: Record<string, unknown> = {}
  for (const column of EVENT_COLUMNS) params[`e_${column}`] = event[column]
  const where = options.onlyWhileVersion0 ? ' WHERE EXISTS(SELECT 1 FROM sales WHERE id=@e_sale_id AND payments_version=0)' : ''
  return {
    sql: `INSERT INTO sale_payment_events(${EVENT_COLUMNS.join(',')}) SELECT ${EVENT_COLUMNS.map((column) => `@e_${column}`).join(',')}${where}`,
    params,
  }
}

/**
 * The checkout event of a new sale, copied in SQL from the row the same batch just inserted (the sale id is not
 * known to JS yet). It copies the sale's own tender columns verbatim, so the version 1 shift reading of the event
 * is exactly the version 0 reading of the sale at its created_at: same details, same gross amounts, same change
 * marker. received_at is the sale's created_at in canonical form. A sale with nothing paid writes no event (an
 * event of no money records nothing; version 1 with no event reads $0, the health check agrees).
 */
export function checkoutPaymentEventStatement(saleWriteKey: string): Statement {
  return {
    sql: `INSERT INTO sale_payment_events(${EVENT_COLUMNS.join(',')})
      SELECT 'checkout:'||s.id, s.id, 'in', 'checkout', NULL, NULL, NULL,
        COALESCE(NULLIF(trim(s.payment_method),''),'Cash'),
        CASE WHEN json_valid(s.payment_details) THEN CASE WHEN json_type(s.payment_details)='array' THEN s.payment_details ELSE '[]' END ELSE '[]' END,
        s.amount_paid_usd, s.amount_paid_khr,
        MAX(0,COALESCE(s.change_usd,0)), MAX(0,COALESCE(s.change_khr,0)), CASE WHEN s.change_is_actual=1 THEN 1 ELSE 0 END, s.change_exchange_rate,
        s.exchange_rate, 1, strftime('%Y-%m-%d %H:%M:%S', s.created_at), s.branch_id, s.cashier_id, s.cashier_name, NULL
      FROM sales s
      WHERE s.client_request_id=@checkout_event_key AND s.client_request_id<>''
        AND (COALESCE(s.amount_paid_usd,0)>0 OR COALESCE(s.amount_paid_khr,0)>0)`,
    params: { checkout_event_key: saleWriteKey },
  }
}

export type OpeningDecision =
  /** Already version 1: events are the record, nothing to open. */
  | { kind: 'version1' }
  /** Version 0 and convertible: write `event` (null when nothing was paid) and move the sale to version 1. */
  | { kind: 'open'; event: PaymentEventInsert | null }
  /** Version 0 and NOT convertible (unreadable created_at or rate): the write proceeds on version 0 with no events. */
  | { kind: 'stay_version0'; reason: string }

/**
 * Whether a money write on this sale can move it to version 1. buildOpeningPaymentEvent refuses a sale whose
 * created_at or rate cannot be read (review edge: "S4 must handle that refusal and not fail the payment"): such
 * a sale keeps today's rule, its tender belongs to its created_at, and no event is written, so the health
 * invariant (version 1 only) cannot break.
 */
export function openingDecision(sale: Record<string, unknown> & { id: number }): OpeningDecision {
  if (Number(sale.payments_version) === 1) return { kind: 'version1' }
  try {
    return { kind: 'open', event: buildOpeningPaymentEvent(sale) }
  } catch (error) {
    if (error instanceof PaymentEventError) return { kind: 'stay_version0', reason: error.code }
    throw error
  }
}

/**
 * The branch a payment taken now belongs to: the sale's branch while it is active, else its active successor
 * (Old Shop has no drawer after the cutover; the money lands in the drawer that took it over, the same landing
 * the cancellation lost-fee uses). A branch with no active successor keeps its own id: the money is recorded,
 * it just sits in no open drawer.
 */
export function collectingBranchId(directory: readonly BranchEffectRow[], saleBranchId: unknown): number | null {
  const id = Number(saleBranchId)
  if (!Number.isSafeInteger(id) || id <= 0) return null
  const row = directory.find((entry) => Number(entry.id) === id)
  if (!row || Number(row.is_active ?? 1) === 1) return id
  const successorId = Number(row.successor_branch_id)
  const successor = Number.isSafeInteger(successorId) && successorId > 0
    ? directory.find((entry) => Number(entry.id) === successorId && Number(entry.is_active ?? 1) === 1)
    : undefined
  return successor ? successorId : id
}

/** Events no later event reverses. A reversal that is itself reversed (undo then redo) drops out too. */
export function livePaymentEvents<T extends { event_id: string; reverses_event_id: string | null }>(events: readonly T[]): T[] {
  const reversed = new Set(events.map((event) => event.reverses_event_id).filter((value): value is string => !!value))
  return events.filter((event) => !reversed.has(event.event_id))
}

/**
 * The sale's current tender as an event row: its own amount, details and change columns, nothing re-summed (the
 * opening builder's copy, dated `receivedAt`). Null when nothing is recorded or the columns cannot be read.
 */
export function saleTenderEvent(sale: Record<string, unknown> & { id: number }, receivedAt: string): PaymentEventInsert | null {
  try {
    return buildOpeningPaymentEvent({ ...sale, created_at: receivedAt })
  } catch (error) {
    if (error instanceof PaymentEventError) return null
    throw error
  }
}

export type CorrectionAnchor = { event: PaymentEventInsert; tender: PaymentEventInsert | null } | null

/**
 * What a payment correction (replace_existing_payment on a reopened sale) is dated at. A correction fixes a
 * mis-keyed RECORD, it is not new money, so it is dated at the LATEST live payment and lands in that payment's
 * drawer: one correction out of the whole current tender and one correction in of the new tender. Earlier
 * payments and the shifts they landed in are left as they are; the shift of the latest payment takes the
 * difference, which is the one place the mistake can have been keyed when a deposit was right and the final
 * settle was not. `tender` is the sale's current tender as an event (its own columns, nothing re-summed; null
 * when nothing is recorded). Returns null when no payment is live: the correction is then a plain collect.
 */
export function correctionAnchor(events: readonly PaymentEventInsert[], tender: PaymentEventInsert | null): CorrectionAnchor {
  const ins = livePaymentEvents(events).filter((event) => event.direction === 'in')
  const latest = ins[ins.length - 1]
  // The change to take back with the tender is the change the recorded payments handed out, net of reversals, read from
  // the events: the sale's change columns hold only the last payment's change (an instalment overwrites them).
  return latest ? { event: latest, tender: tender ? { ...tender, ...netEventChange(events) } : null } : null
}

/**
 * The change the events handed back, net (an out subtracts the change it copied). Actual only when every event that
 * carries change marks it actual, as the shift reader requires; the rate is the latest actual one.
 */
export function netEventChange(events: readonly PaymentEventInsert[]): Pick<PaymentEventInsert, 'change_usd' | 'change_khr' | 'change_is_actual' | 'change_exchange_rate'> {
  let usd = 0
  let khr = 0
  let actual = true
  let rate: number | null = null
  for (const event of events) {
    const eventUsd = Number(event.change_usd) || 0
    const eventKhr = Number(event.change_khr) || 0
    if (!eventUsd && !eventKhr) continue
    const sign = event.direction === 'out' ? -1 : 1
    usd += sign * eventUsd
    khr += sign * eventKhr
    if (Number(event.change_is_actual) !== 1) actual = false
    else if (event.change_exchange_rate != null) rate = Number(event.change_exchange_rate)
  }
  usd = Math.max(0, Number(usd.toFixed(4)))
  khr = Math.max(0, Number(khr.toFixed(4)))
  if (!usd && !khr) return { change_usd: 0, change_khr: 0, change_is_actual: 0, change_exchange_rate: null }
  return actual && rate != null
    ? { change_usd: usd, change_khr: khr, change_is_actual: 1, change_exchange_rate: rate }
    : { change_usd: usd, change_khr: khr, change_is_actual: 0, change_exchange_rate: null }
}

/** A copy of `target`'s money (amounts, details, change) as a new event; nothing is re-summed. */
function mirrorEvent(target: PaymentEventInsert, fields: {
  eventId: string
  direction: PaymentEventDirection
  origin: Exclude<PaymentEventOrigin, 'opening'>
  operationId: string
  reversesEventId: string | null
  receivedAt: string
  branchId: number | null
  cashierId: number | null
  cashierName: string | null
  drawerEffect: 0 | 1
}): PaymentEventInsert {
  if (fields.direction === 'out' && fields.origin !== 'undo' && fields.origin !== 'correction') throw new PaymentEventError('Only an undo or a correction takes money out.', 'payment_event_direction_invalid')
  if (fields.origin === 'undo' && fields.direction !== 'out') throw new PaymentEventError('An undo takes money out.', 'payment_event_direction_invalid')
  if (fields.origin === 'redo' && fields.direction !== 'in') throw new PaymentEventError('A redo puts money back.', 'payment_event_direction_invalid')
  return {
    event_id: fields.eventId,
    sale_id: target.sale_id,
    direction: fields.direction,
    origin: fields.origin,
    covers_operation_id: target.covers_operation_id ?? null,
    operation_id: fields.operationId,
    reverses_event_id: fields.reversesEventId,
    payment_method: target.payment_method,
    payment_details: target.payment_details,
    amount_paid_usd: Number(target.amount_paid_usd) || 0,
    amount_paid_khr: Number(target.amount_paid_khr) || 0,
    change_usd: Number(target.change_usd) || 0,
    change_khr: Number(target.change_khr) || 0,
    change_is_actual: Number(target.change_is_actual) === 1 ? 1 : 0,
    change_exchange_rate: target.change_exchange_rate == null ? null : Number(target.change_exchange_rate),
    exchange_rate: Number(target.exchange_rate),
    drawer_effect: fields.drawerEffect,
    received_at: canonicalEventTime(fields.receivedAt),
    branch_id: fields.branchId,
    cashier_id: fields.cashierId,
    cashier_name: fields.cashierName,
    note: null,
  }
}

/** The event ids a settlement operation writes: `<operation>:<generation>:<in|out>` (generation 0 is the apply). */
export function settlementEventId(operationId: string, generation: number, direction: PaymentEventDirection): string {
  return `${operationId}:${generation}:${direction}`
}

export type PaymentActor = { receivedAt: string; branchId: number | null; cashierId: number | null; cashierName: string | null }

/**
 * The events the APPLY of a settle or an instalment writes (generation 0), after any opening event.
 *   - money taken now: one `collect` in, received now, in the collecting branch, by the acting cashier, for
 *     exactly the rows the request added (planSaleSettlement.addedDetails). No added row, no event.
 *   - a payment correction (correctionAnchor): `correction` out of the whole current tender (a copy of the sale's
 *     own columns) and `correction` in of the new tender, both dated at the latest live payment, in its branch,
 *     cashier and drawer. With no live payment it is a plain collect.
 */
export function settlementApplyEvents(input: {
  operationId: string
  saleId: number
  exchangeRate: number
  added: readonly PaymentTenderRow[]
  change: { usd: number; khr: number; isActual: boolean; exchangeRate: number | null }
  actor: PaymentActor
  correction?: CorrectionAnchor
}): PaymentEventInsert[] {
  const anchor = input.correction ? input.correction.event : null
  const events: PaymentEventInsert[] = []
  if (anchor && input.correction?.tender) {
    events.push(mirrorEvent(input.correction.tender, {
      eventId: settlementEventId(input.operationId, 0, 'out'), direction: 'out', origin: 'correction', operationId: input.operationId,
      reversesEventId: null, receivedAt: anchor.received_at, branchId: anchor.branch_id, cashierId: anchor.cashier_id,
      cashierName: anchor.cashier_name, drawerEffect: anchor.drawer_effect,
    }))
  }
  if (!input.added.length) return events
  events.push(buildPaymentEvent({
    eventId: settlementEventId(input.operationId, 0, 'in'),
    saleId: input.saleId,
    direction: 'in',
    origin: anchor ? 'correction' : 'collect',
    tender: input.added,
    exchangeRate: input.exchangeRate,
    receivedAt: anchor ? anchor.received_at : input.actor.receivedAt,
    operationId: input.operationId,
    change: input.change,
    drawerEffect: anchor ? anchor.drawer_effect : 1,
    branchId: anchor ? anchor.branch_id : input.actor.branchId,
    cashierId: anchor ? anchor.cashier_id : input.actor.cashierId,
    cashierName: anchor ? anchor.cashier_name : input.actor.cashierName,
  }))
  return events
}

export class LaterPaymentDependsError extends Error {
  readonly code = 'later_payment_depends'
  constructor() {
    super('A later payment was recorded on this sale after this one. Undo that payment first.')
    this.name = 'LaterPaymentDependsError'
  }
}

/**
 * The events an undo or redo of a settlement operation writes. It never edits an event: it answers the events
 * the operation's CURRENT generation wrote, each with its opposite, copying the money so the ledger nets out.
 *   collect:    undo (generation g -> g+1) answers the `in` with an `undo` out; redo answers that out with a `redo` in.
 *   correction: every answer is a `correction` event of the opposite direction (the pair is in and out both ways).
 * A collect is reversed now, by the acting cashier, in the collecting branch (the money leaves the drawer that is
 * open now). A correction stays a correction of the record: it is dated at, and lands in the drawer of, the event
 * it answers. Refused (LaterPaymentDependsError) when any event of the sale was written after this operation's
 * last one by another operation: undoing an older payment under a newer one would leave the newer one paying for
 * money that is gone.
 */
export function settlementReplayEvents(input: {
  operationId: string
  direction: 'undo' | 'redo'
  generation: number
  saleEvents: readonly StoredPaymentEvent[]
  actor: PaymentActor
}): PaymentEventInsert[] {
  const own = input.saleEvents.filter((event) => event.operation_id === input.operationId)
  const lastOwnId = own.reduce((max, event) => Math.max(max, Number(event.id)), 0)
  if (own.length && input.saleEvents.some((event) => Number(event.id) > lastOwnId && event.operation_id !== input.operationId)) {
    throw new LaterPaymentDependsError()
  }
  const prefix = `${input.operationId}:${input.generation}:`
  const sources = own.filter((event) => event.event_id.startsWith(prefix))
  const correctionOperation = own.some((event) => event.event_id.startsWith(`${input.operationId}:0:`) && event.origin === 'correction')
  return sources.map((source) => {
    const direction: PaymentEventDirection = source.direction === 'in' ? 'out' : 'in'
    // A collect operation only ever has an `in` at generation 0, so its undo is an out and its redo an in.
    const origin: Exclude<PaymentEventOrigin, 'opening'> = correctionOperation ? 'correction' : input.direction === 'undo' ? 'undo' : 'redo'
    const dated = correctionOperation
      ? { receivedAt: source.received_at, branchId: source.branch_id, cashierId: source.cashier_id, cashierName: source.cashier_name, drawerEffect: source.drawer_effect }
      : { ...input.actor, drawerEffect: source.drawer_effect }
    return mirrorEvent(source, {
      eventId: settlementEventId(input.operationId, input.generation + 1, direction), direction, origin, operationId: input.operationId,
      reversesEventId: source.event_id, ...dated,
    })
  })
}

/** A tender row as stored: method and amounts, plus any marker the writer put on it (refund_credit). */
export type StoredTenderRow = PaymentTenderRow & Record<string, unknown>

const hasMarkers = (row: Record<string, unknown>): boolean => Object.keys(tenderRowMarkers(row)).length > 0

/**
 * Stored tender rows summed per method (first label and first-seen order kept), so instalments never grow the list past
 * the method count. A row that carries a marker (an exchange's refund_credit) is never merged and keeps its marker: it is
 * a different kind of money, and an exchange cancel finds it only by the flag (release review 6.0.982 P2-1).
 */
export function mergeTenderRows(rows: readonly StoredTenderRow[]): StoredTenderRow[] {
  const merged: StoredTenderRow[] = []
  const byKey = new Map<string, StoredTenderRow>()
  for (const row of rows) {
    if (hasMarkers(row)) {
      merged.push({ ...row, method: String(row.method), amount_usd: Number(row.amount_usd) || 0, amount_khr: Number(row.amount_khr) || 0 })
      continue
    }
    const key = paymentMethodKey(row.method)
    const found = byKey.get(key)
    if (found) {
      found.amount_usd = Number((found.amount_usd + (Number(row.amount_usd) || 0)).toFixed(4))
      found.amount_khr = Number((found.amount_khr + (Number(row.amount_khr) || 0)).toFixed(4))
      continue
    }
    const copy = { method: String(row.method), amount_usd: Number(row.amount_usd) || 0, amount_khr: Number(row.amount_khr) || 0 }
    byKey.set(key, copy)
    merged.push(copy)
  }
  return merged
}

/** A stored payment_details text as tender rows (markers kept) when it is a readable array of rows, else null (left to the planner to refuse). */
export function storedTenderRows(raw: unknown): StoredTenderRow[] | null {
  if (raw == null || (typeof raw === 'string' && !raw.trim())) return []
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(parsed)) return null
    const rows: StoredTenderRow[] = []
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
      const value = entry as Record<string, unknown>
      rows.push({ ...value, method: String(value.method ?? ''), amount_usd: Number(value.amount_usd ?? 0), amount_khr: Number(value.amount_khr ?? 0) })
    }
    return rows
  } catch {
    return null
  }
}

/** The stored event rows of one sale, oldest first, typed. */
export function storedPaymentEvents(rows: readonly Record<string, unknown>[]): StoredPaymentEvent[] {
  return rows.filter((row) => row.event_id != null).map((row) => ({
    id: Number(row.id),
    event_id: String(row.event_id),
    sale_id: Number(row.sale_id),
    direction: row.direction === 'out' ? 'out' : 'in',
    origin: String(row.origin) as PaymentEventOrigin,
    covers_operation_id: row.covers_operation_id == null ? null : String(row.covers_operation_id),
    operation_id: row.operation_id == null ? null : String(row.operation_id),
    reverses_event_id: row.reverses_event_id == null ? null : String(row.reverses_event_id),
    payment_method: String(row.payment_method ?? ''),
    payment_details: String(row.payment_details ?? '[]'),
    amount_paid_usd: Number(row.amount_paid_usd) || 0,
    amount_paid_khr: Number(row.amount_paid_khr) || 0,
    change_usd: Number(row.change_usd) || 0,
    change_khr: Number(row.change_khr) || 0,
    change_is_actual: Number(row.change_is_actual) === 1 ? 1 : 0,
    change_exchange_rate: row.change_exchange_rate == null ? null : Number(row.change_exchange_rate),
    exchange_rate: Number(row.exchange_rate),
    drawer_effect: Number(row.drawer_effect) === 0 ? 0 : 1,
    received_at: String(row.received_at),
    branch_id: row.branch_id == null ? null : Number(row.branch_id),
    cashier_id: row.cashier_id == null ? null : Number(row.cashier_id),
    cashier_name: row.cashier_name == null ? null : String(row.cashier_name),
    note: row.note == null ? null : String(row.note),
  }))
}
