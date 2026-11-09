// The pure planner that turns one sale settlement (collect, correction, undo, redo) into payment events.
// Plan: Records/Design/2026-11-10/LATER-PAYMENT-SHIFT-PLAN.md section 3.2. INERT: no route calls it yet.
//
// Money that moves later is dated NOW and belongs to the cashier and drawer that took it; the tender the sale was
// rung with stays at its creation time as an opening event. After any plan, SUM(in) - SUM(out) over the sale's events
// equals the sale's amount_paid_* (netPaymentTotals), which is the invariant the health check pins.

import { paymentMethodKey } from './paymentMethodRegistry'
import {
  buildOpeningPaymentEvent,
  buildPaymentEvent,
  type OpeningEventSale,
  type PaymentEventInsert,
  type PaymentTenderRow,
} from './salePayments'

export type SettlementEventErrorCode = 'settlement_change_unreadable' | 'settlement_tender_unreadable' | 'settlement_nothing_to_record'

export class SettlementEventError extends Error {
  readonly code: SettlementEventErrorCode
  constructor(message: string, code: SettlementEventErrorCode) {
    super(message)
    this.name = 'SettlementEventError'
    this.code = code
  }
}

const fail = (code: SettlementEventErrorCode, message: string): never => { throw new SettlementEventError(message, code) }

/** The payment columns of a sale as a settlement snapshot stores them (SaleSettlementState carries these). */
export type SettlementPaymentState = {
  payment_method?: unknown
  payment_details?: unknown
  amount_paid_usd?: unknown
  amount_paid_khr?: unknown
  change_usd?: unknown
  change_khr?: unknown
  change_is_actual?: unknown
  change_exchange_rate?: unknown
  exchange_rate?: unknown
}

export type SettlementEventMode = 'apply' | 'undo' | 'redo'

export type SettlementEventPlanInput = {
  /** The sale as it stands before this write: its tender columns are what an opening event copies. */
  sale: OpeningEventSale & { payments_version?: unknown }
  mode: SettlementEventMode
  correction: boolean
  /** The settlement receipt's snapshots. Apply: the state before and after the request. Replay: the receipt being replayed. */
  before: SettlementPaymentState
  after: SettlementPaymentState
  /** Apply of a collect only: the rows the request added (SettlementPlan.addedPaymentDetails). A replay derives them from the snapshots. */
  addedPaymentDetails?: readonly PaymentTenderRow[]
  operationId: string
  /** 0 for the original settlement, then 1, 2, 3 for each undo or redo of it. */
  generation: number
  /** The server clock; never client supplied. */
  now: string
  cashierId: number | null
  cashierName: string | null
  /** The drawer branch: the sale's branch while it is active, else its active selling successor. */
  drawerBranchId: number | null
  coversOperationId?: string | null
}

export type SettlementEventPlan = {
  /** Present only for a sale not yet on payments_version 1; the caller writes it first and sets the version. */
  opening: PaymentEventInsert | null
  events: PaymentEventInsert[]
  convertsToVersion1: boolean
}

export const settlementEventId = (operationId: string, generation: number, side?: 'out' | 'in'): string =>
  `settle:${operationId}:${generation}${side ? `:${side}` : ''}`

type Change = { usd: number; khr: number; isActual: boolean; exchangeRate: number | null }

const nonNegative = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

const tenderRows = (state: SettlementPaymentState): PaymentTenderRow[] => {
  const raw = state.payment_details
  let parsed: unknown = raw
  if (typeof raw === 'string' && raw.trim()) {
    try { parsed = JSON.parse(raw) } catch { return fail('settlement_tender_unreadable', 'The stored payment rows cannot be read.') }
  }
  if (Array.isArray(parsed) && parsed.length) {
    return parsed.map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return fail('settlement_tender_unreadable', 'The stored payment rows cannot be read.')
      const row = entry as Record<string, unknown>
      return { method: String(row.method ?? '').trim(), amount_usd: nonNegative(row.amount_usd), amount_khr: nonNegative(row.amount_khr) }
    })
  }
  const usd = nonNegative(state.amount_paid_usd)
  const khr = nonNegative(state.amount_paid_khr)
  if (usd === 0 && khr === 0) return []
  const tokens = String(state.payment_method ?? '').split('+').map((part) => part.trim()).filter(Boolean)
  if (tokens.length !== 1) return fail('settlement_tender_unreadable', 'The stored payment does not name one method.')
  return [{ method: tokens[0], amount_usd: usd, amount_khr: khr }]
}

/** The rows of `after` that `before` does not already hold, each before row matched at most once (duplicates stay distinct). */
function addedRows(before: SettlementPaymentState, after: SettlementPaymentState): PaymentTenderRow[] {
  const held = tenderRows(before).map((row) => ({ row, used: false }))
  const added: PaymentTenderRow[] = []
  for (const row of tenderRows(after)) {
    const key = paymentMethodKey(row.method)
    const match = held.find((entry) => !entry.used && paymentMethodKey(entry.row.method) === key
      && entry.row.amount_usd === row.amount_usd && entry.row.amount_khr === row.amount_khr)
    if (match) match.used = true
    else added.push(row)
  }
  if (held.some((entry) => !entry.used)) return fail('settlement_tender_unreadable', 'The settlement removed a recorded payment row; correct the payment instead.')
  return added
}

const stateChange = (state: SettlementPaymentState): Change => ({
  usd: nonNegative(state.change_usd),
  khr: nonNegative(state.change_khr),
  isActual: Number(state.change_is_actual) === 1,
  exchangeRate: state.change_exchange_rate == null || state.change_exchange_rate === '' || !Number.isFinite(Number(state.change_exchange_rate)) ? null : Number(state.change_exchange_rate),
})

/** What a collect added to the change handed back: after minus before, per currency. A negative delta is refused. */
function changeDelta(before: SettlementPaymentState, after: SettlementPaymentState): Change {
  const b = stateChange(before)
  const a = stateChange(after)
  const usd = Math.round((a.usd - b.usd) * 1e4) / 1e4
  const khr = Math.round((a.khr - b.khr) * 1e4) / 1e4
  if (usd < 0 || khr < 0) fail('settlement_change_unreadable', 'The settlement lowered the change already handed back; correct the payment instead.')
  return { usd, khr, isActual: a.isActual, exchangeRate: a.exchangeRate }
}

const rateOf = (state: SettlementPaymentState, sale: OpeningEventSale): number => nonNegative(state.exchange_rate) || nonNegative(sale.exchange_rate)

/**
 * The events one settlement writes. Opening first (only for a version 0 sale), at the sale's creation time with the
 * tender it holds right now; every other event at `now`.
 *   collect (apply / redo): one `in` of the rows the request added, with the change that grew. Redo is origin redo.
 *   undo of a collect: one `out` of the same rows and change, reversing the previous generation's event.
 *   correction: an `out` of the whole old tender with ITS change and an `in` of the whole new tender with its change.
 *     Undo swaps the pair; the out of a replay reverses the previous generation's `in`.
 * Stored rows are copied as they are: a legacy riel row that is not whole hundreds can still be reversed. New cash riel
 * is validated by planSaleSettlement before the plan ever sees it.
 */
export function planSettlementPaymentEvents(input: SettlementEventPlanInput): SettlementEventPlan {
  const { sale, mode, correction } = input
  const saleId = Number(sale.id)
  const converts = Number(sale.payments_version) !== 1
  const opening = converts ? buildOpeningPaymentEvent(sale) : null
  const common = {
    saleId,
    receivedAt: input.now,
    operationId: input.operationId,
    coversOperationId: input.coversOperationId ?? null,
    branchId: input.drawerBranchId,
    cashierId: input.cashierId,
    cashierName: input.cashierName,
  }
  const previous = input.generation - 1
  const reversesOpening = converts && opening ? opening.event_id : null
  const events: PaymentEventInsert[] = []

  if (!correction) {
    const rows = mode === 'apply' && input.addedPaymentDetails ? [...input.addedPaymentDetails] : addedRows(input.before, input.after)
    if (!rows.length) fail('settlement_nothing_to_record', 'The settlement added no payment row.')
    const change = changeDelta(input.before, input.after)
    const rate = rateOf(input.after, sale)
    if (mode === 'undo') {
      events.push(buildPaymentEvent({
        ...common, eventId: settlementEventId(input.operationId, input.generation), direction: 'out', origin: 'undo',
        tender: rows, change, exchangeRate: rate,
        reversesEventId: reversesOpening ?? (previous >= 0 ? settlementEventId(input.operationId, previous) : null),
      }))
    } else {
      events.push(buildPaymentEvent({
        ...common, eventId: settlementEventId(input.operationId, input.generation), direction: 'in',
        origin: mode === 'redo' ? 'redo' : 'collect', tender: rows, change, exchangeRate: rate,
      }))
    }
    return { opening, events, convertsToVersion1: converts }
  }

  const outState = mode === 'undo' ? input.after : input.before
  const inState = mode === 'undo' ? input.before : input.after
  const outRows = tenderRows(outState)
  const inRows = tenderRows(inState)
  const replay = mode !== 'apply'
  if (outRows.length) {
    events.push(buildPaymentEvent({
      ...common, eventId: settlementEventId(input.operationId, input.generation, 'out'), direction: 'out',
      origin: replay ? 'undo' : 'correction', tender: outRows, change: stateChange(outState), exchangeRate: rateOf(outState, sale),
      reversesEventId: replay ? reversesOpening ?? (previous >= 0 ? settlementEventId(input.operationId, previous, 'in') : null) : null,
    }))
  }
  if (inRows.length) {
    events.push(buildPaymentEvent({
      ...common, eventId: settlementEventId(input.operationId, input.generation, 'in'), direction: 'in',
      origin: 'correction', tender: inRows, change: stateChange(inState), exchangeRate: rateOf(inState, sale),
    }))
  }
  if (!events.length) fail('settlement_nothing_to_record', 'The correction moved no money.')
  return { opening, events, convertsToVersion1: converts }
}
