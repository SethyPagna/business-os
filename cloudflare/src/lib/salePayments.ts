// The pure money core of sale payment events (lane 6.0.972, slice S2; the table is migration 0271).
//
// This file is the mirror of frontend/src/utils/salePayments.ts. The ONLY permitted difference is the
// import specifiers (the frontend copy needs the explicit .ts extension so Node can load it in tests;
// the Worker build resolves extensionless). frontend/tests/salePaymentsParity.test.ts enforces exactly
// that and drives BOTH copies through the same fixtures; cloudflare/scripts/test-sale-payments-pure.cjs
// pins the answers themselves.
//
// INERT. Nothing imports this yet: no route writes an event (slices S3-S5 wire the readers and writers).
//
// Owner rulings (24 Oct 2026) this encodes:
//   1. A part-paid sale stays Not Paid with a "Part paid" tag. There is no third status.
//   2. Instalments are allowed: any number of payments until the sale is covered.
//   3. An old short sale gets a late-recorded payment at its real date that counts in no current drawer.
//   4. A return lowers the debt first.
// And the standing rule of 20 Oct: a return never changes the status, so a return that lowers the debt to
// $0 leaves a Not Paid sale Not Paid.
//
// NOTHING HERE RE-DERIVES THE COVERAGE ARITHMETIC. "Covered" is saleOutstandingUsd's answer (short by at
// most half a cent, exact integers) reached through recordedSaleOutstandingUsd; this file only decides what
// money and what debt are handed to it.
//
// MONEY IN AND OUT. The paid figure is SUM(in) - SUM(out) per currency over the sale's events, gross of
// change, exactly as sales.amount_paid_* is (the invariant S3's health check pins). Coverage then runs at
// the sale's own rate, so a riel-only instalment counts the same way a riel-only tender does today.
//
// A caller derives a status only for a sale whose money is known: a historical import with no recorded
// tender must not be run through deriveSalePaymentState, or it would read as unpaid.

import { exactDecimalRatio, financialCalculationUnits, formatScaledUnits, type FinancialDecimalInput } from './financialPrecision'
import {
  NOT_PAID_STATUS,
  PAID_STATUS_SHORTFALL_TOLERANCE_UNITS,
  rateRatio,
  recordedMoneyPrecisionVersion,
  recordedSaleOutstandingUsd,
  saleStoredState,
  type RecordedSaleMoney,
} from './saleStatusResolution'

export type PaymentEventDirection = 'in' | 'out'
export const PAYMENT_EVENT_ORIGINS = ['checkout', 'opening', 'added', 'collect', 'late_record', 'undo', 'redo', 'correction'] as const
export type PaymentEventOrigin = (typeof PAYMENT_EVENT_ORIGINS)[number]

export type PaymentTenderRow = { method: string; amount_usd: number; amount_khr: number }

/** One sale_payment_events row as the Worker inserts it (id and created_at are the database's). */
export type PaymentEventInsert = {
  event_id: string
  sale_id: number
  direction: PaymentEventDirection
  origin: PaymentEventOrigin
  covers_operation_id: string | null
  operation_id: string | null
  reverses_event_id: string | null
  payment_method: string
  payment_details: string
  amount_paid_usd: number
  amount_paid_khr: number
  change_usd: number
  change_khr: number
  change_is_actual: 0 | 1
  change_exchange_rate: number | null
  exchange_rate: number
  drawer_effect: 0 | 1
  received_at: string
  branch_id: number | null
  cashier_id: number | null
  cashier_name: string | null
  note: string | null
}

export type PaymentEventErrorCode =
  | 'payment_event_id_required'
  | 'payment_event_tender_required'
  | 'payment_event_amount_invalid'
  | 'payment_event_no_money'
  | 'payment_event_rate_invalid'
  | 'payment_event_origin_invalid'
  | 'payment_event_direction_invalid'
  | 'payment_event_reversal_target_required'
  | 'payment_event_late_drawer'
  | 'payment_event_time_required'
  | 'payment_event_note_too_long'
  | 'payment_event_link_mismatch'

export class PaymentEventError extends Error {
  readonly code: PaymentEventErrorCode
  constructor(message: string, code: PaymentEventErrorCode) {
    super(message)
    this.name = 'PaymentEventError'
    this.code = code
  }
}

const fail = (code: PaymentEventErrorCode, message: string): never => { throw new PaymentEventError(message, code) }

const MAX_NOTE_LENGTH = 500

function unitsToNumber(units: bigint): number {
  return Number(formatScaledUnits(units, 4))
}

function positiveUnits(value: unknown): bigint {
  let units: bigint
  try {
    units = financialCalculationUnits(value as FinancialDecimalInput)
  } catch {
    return fail('payment_event_amount_invalid', 'A payment amount is not a readable number.')
  }
  if (units < 0n) fail('payment_event_amount_invalid', 'A payment amount cannot be negative.')
  return units
}

export type BuildPaymentEventInput = {
  eventId: string
  saleId: number
  direction: PaymentEventDirection
  origin: Exclude<PaymentEventOrigin, 'opening'>
  tender: readonly PaymentTenderRow[]
  exchangeRate: FinancialDecimalInput
  /** The real moment the money changed hands. A late record passes the true past date. */
  receivedAt: string
  coversOperationId?: string | null
  operationId?: string | null
  reversesEventId?: string | null
  /** The event this one reverses: its id and group link are inherited, and a conflicting explicit value is refused. */
  reversedEvent?: { event_id: string; covers_operation_id: string | null }
  change?: { usd: number; khr: number; isActual: boolean; exchangeRate: number | null }
  /** Defaults to 1 (the money is in the drawer); a late record is always 0 and refuses an explicit 1. */
  drawerEffect?: 0 | 1
  branchId?: number | null
  cashierId?: number | null
  cashierName?: string | null
  note?: string | null
}

/**
 * One payment event. The amount columns are the exact sum of the tender rows (never a second figure that
 * could disagree), the method label is the distinct methods joined the way the sale joins them, and the
 * direction and origin must agree: an undo is an `out` that names the event it reverses, a redo is an `in`,
 * a correction pair has one of each, and everything else is money coming in.
 */
export function buildPaymentEvent(input: BuildPaymentEventInput): PaymentEventInsert {
  if (!String(input.eventId || '').trim()) fail('payment_event_id_required', 'An event needs its own id.')
  if (!PAYMENT_EVENT_ORIGINS.includes(input.origin) || (input.origin as string) === 'opening') fail('payment_event_origin_invalid', 'Unknown payment event origin.')
  if (input.direction !== 'in' && input.direction !== 'out') fail('payment_event_direction_invalid', 'A payment event is money in or money out.')
  if (input.direction === 'out' && input.origin !== 'undo' && input.origin !== 'correction') fail('payment_event_direction_invalid', 'Only an undo or a correction takes money out.')
  if ((input.origin === 'undo' && input.direction !== 'out') || (input.origin === 'redo' && input.direction !== 'in')) fail('payment_event_direction_invalid', 'An undo takes money out and a redo puts it back.')
  const reversed = input.reversedEvent
  const explicitReverses = String(input.reversesEventId || '').trim() || null
  const explicitCovers = String(input.coversOperationId || '').trim() || null
  const reversedId = reversed ? String(reversed.event_id || '').trim() || null : null
  const reversedCovers = reversed ? String(reversed.covers_operation_id || '').trim() || null : null
  const reverses = explicitReverses ?? reversedId
  const covers = explicitCovers ?? reversedCovers
  if (reversed && ((explicitReverses && explicitReverses !== reversedId) || (explicitCovers && explicitCovers !== reversedCovers))) {
    fail('payment_event_link_mismatch', 'A reversal covers the same group as the event it reverses.')
  }
  if (input.origin === 'undo' && !reverses) fail('payment_event_reversal_target_required', 'An undo names the event it reverses.')
  if (!input.tender.length) fail('payment_event_tender_required', 'A payment needs at least one tender row.')
  if (!String(input.receivedAt || '').trim()) fail('payment_event_time_required', 'A payment records when it was received.')
  let rate: bigint
  try {
    rate = exactDecimalRatio(input.exchangeRate).numerator
  } catch {
    rate = 0n
  }
  if (rate <= 0n) fail('payment_event_rate_invalid', 'The exchange rate must be positive.')
  if (input.origin === 'late_record' && input.drawerEffect === 1) fail('payment_event_late_drawer', 'A late-recorded payment counts in no current drawer.')
  const note = input.note == null ? null : String(input.note)
  if (note !== null && note.length > MAX_NOTE_LENGTH) fail('payment_event_note_too_long', `A note is at most ${MAX_NOTE_LENGTH} characters.`)

  let usd = 0n
  let khr = 0n
  const methods: string[] = []
  const rows = input.tender.map((row) => {
    const method = String(row.method || '').trim()
    if (!method) fail('payment_event_tender_required', 'Every tender row names its payment method.')
    const rowUsd = positiveUnits(row.amount_usd)
    const rowKhr = positiveUnits(row.amount_khr)
    usd += rowUsd
    khr += rowKhr
    if (!methods.includes(method)) methods.push(method)
    return { method, amount_usd: unitsToNumber(rowUsd), amount_khr: unitsToNumber(rowKhr) }
  })
  if (usd === 0n && khr === 0n) fail('payment_event_no_money', 'A payment event carries money; an event of $0 and 0 riel is not a payment.')

  const out = input.direction === 'out'
  const change = out || !input.change ? null : input.change
  return {
    event_id: String(input.eventId).trim(),
    sale_id: input.saleId,
    direction: input.direction,
    origin: input.origin,
    covers_operation_id: covers,
    operation_id: String(input.operationId || '').trim() || null,
    reverses_event_id: reverses,
    payment_method: methods.join(' + '),
    payment_details: JSON.stringify(rows),
    amount_paid_usd: unitsToNumber(usd),
    amount_paid_khr: unitsToNumber(khr),
    change_usd: change ? unitsToNumber(positiveUnits(change.usd)) : 0,
    change_khr: change ? unitsToNumber(positiveUnits(change.khr)) : 0,
    change_is_actual: change && change.isActual ? 1 : 0,
    change_exchange_rate: change && change.exchangeRate != null ? change.exchangeRate : null,
    exchange_rate: Number(input.exchangeRate),
    drawer_effect: input.origin === 'late_record' ? 0 : input.drawerEffect === 0 ? 0 : 1,
    received_at: String(input.receivedAt),
    branch_id: input.branchId ?? null,
    cashier_id: input.cashierId ?? null,
    cashier_name: input.cashierName ?? null,
    note,
  }
}

/** The columns of a stored sale the opening event copies. */
export type OpeningEventSale = {
  id: number
  payment_method?: unknown
  payment_details?: unknown
  amount_paid_usd?: unknown
  amount_paid_khr?: unknown
  change_usd?: unknown
  change_khr?: unknown
  change_is_actual?: unknown
  change_exchange_rate?: unknown
  exchange_rate?: unknown
  created_at?: unknown
  branch_id?: unknown
  cashier_id?: unknown
  cashier_name?: unknown
}

function numberOrZero(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function nullableNumber(value: unknown): number | null {
  return value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value)
}

/** A stored payment_details string kept verbatim when it is a non-empty JSON array, else null. */
function storedDetails(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) && parsed.length > 0 ? value : null
  } catch {
    return null
  }
}

/**
 * The opening event of a payments_version 0 sale: the tender as it stands, dated at the sale's own
 * creation, so every past shift total stays what it was and SUM(events) equals sales.amount_paid_*
 * from then on. The amounts are the sale columns themselves (not re-summed from the details), because
 * the invariant is against those columns. Throws on an unreadable rate (the table refuses it). Returns null for a sale with nothing paid: an event of no
 * money would record nothing, and the sale's version moving to 1 with no events already reads $0.
 */
export function buildOpeningPaymentEvent(sale: OpeningEventSale): PaymentEventInsert | null {
  const usd = numberOrZero(sale.amount_paid_usd)
  const khr = numberOrZero(sale.amount_paid_khr)
  if (usd === 0 && khr === 0) return null
  const rate = numberOrZero(sale.exchange_rate)
  if (rate <= 0) fail('payment_event_rate_invalid', 'The sale has no readable exchange rate to open its payments at.')
  const method = String(sale.payment_method || '').trim() || 'Cash'
  const details = storedDetails(sale.payment_details) ?? JSON.stringify([{ method, amount_usd: usd, amount_khr: khr }])
  return {
    event_id: `opening:${sale.id}`,
    sale_id: sale.id,
    direction: 'in',
    origin: 'opening',
    covers_operation_id: null,
    operation_id: null,
    reverses_event_id: null,
    payment_method: method,
    payment_details: details,
    amount_paid_usd: usd,
    amount_paid_khr: khr,
    change_usd: numberOrZero(sale.change_usd),
    change_khr: numberOrZero(sale.change_khr),
    change_is_actual: Number(sale.change_is_actual) === 1 ? 1 : 0,
    change_exchange_rate: nullableNumber(sale.change_exchange_rate),
    exchange_rate: rate,
    drawer_effect: 1,
    received_at: String(sale.created_at ?? ''),
    branch_id: nullableNumber(sale.branch_id),
    cashier_id: nullableNumber(sale.cashier_id),
    cashier_name: sale.cashier_name == null ? null : String(sale.cashier_name),
    note: 'opening: tender at creation',
  }
}

export type PaymentEventMoney = { direction: PaymentEventDirection; amount_paid_usd: unknown; amount_paid_khr: unknown }

/** SUM(in) - SUM(out) per currency, exact. Negative when more went out than came in; never clamped. */
export function netPaymentTotals(events: readonly PaymentEventMoney[]): { paidUsd: number; paidKhr: number } {
  let usd = 0n
  let khr = 0n
  for (const event of events) {
    const sign = event.direction === 'out' ? -1n : 1n
    usd += sign * financialCalculationUnits(Number(event.amount_paid_usd) || 0)
    khr += sign * financialCalculationUnits(Number(event.amount_paid_khr) || 0)
  }
  return { paidUsd: unitsToNumber(usd), paidKhr: unitsToNumber(khr) }
}

/** Part paid is a reading, never stored: the sale is Not Paid and some money has been taken in either currency. */
export function salePartPaid(saleStatus: string, paidUsd: unknown, paidKhr: unknown): boolean {
  if (saleStatus !== NOT_PAID_STATUS) return false
  return financialCalculationUnits(Number(paidUsd) || 0) > 0n || financialCalculationUnits(Number(paidKhr) || 0) > 0n
}

export type PaymentStatusCause = 'creation' | 'payment' | 'amendment' | 'return'

export type DeriveSalePaymentStateInput = {
  /** The stored sale: its total, rate and precision basis, and the status columns (retired labels read as the two-status model). */
  sale: RecordedSaleMoney & { sale_status?: unknown; status_before_return?: unknown; return_state?: unknown; delivery_pending?: unknown }
  /** Net money taken in, from netPaymentTotals. */
  paidUsd: FinancialDecimalInput
  paidKhr: FinancialDecimalInput
  /** The debt the sale's active returns lowered (their owed_reduction_usd), not the cash they refunded. */
  debtLoweredUsd?: FinancialDecimalInput
  /** What is writing: a return never changes the status. */
  cause: PaymentStatusCause
}

export type SalePaymentState = {
  saleStatus: string
  /** What the sale still owes, in dollars (0 when covered within half a cent). */
  owedUsd: number
  covered: boolean
  partPaid: boolean
}

/**
 * The status the money says. owed = total - debt lowered by returns - (in - out); covered within half a
 * cent means Completed, otherwise Not Paid. Cancelled is a separate lifecycle state and stays. A return
 * is the one writer that never moves the status (owner, 20 Oct): a return that lowers the debt to $0
 * leaves the sale Not Paid and flagged, and the next payment or amendment is what completes it.
 * Throws like saleOutstandingUsd when the sale money cannot be read; the caller decides what to do.
 */
export function deriveSalePaymentState(input: DeriveSalePaymentStateInput): SalePaymentState {
  const current = saleStoredState(input.sale).saleStatus
  const owedUsd = recordedSaleOutstandingUsd({
    ...input.sale,
    amount_paid_usd: input.paidUsd,
    amount_paid_khr: input.paidKhr,
    refund_usd: input.debtLoweredUsd ?? 0,
  })
  const covered = owedUsd === 0
  if (current === 'cancelled') return { saleStatus: 'cancelled', owedUsd, covered, partPaid: false }
  const saleStatus = input.cause === 'return' ? current : covered ? 'completed' : NOT_PAID_STATUS
  return { saleStatus, owedUsd, covered, partPaid: salePartPaid(saleStatus, input.paidUsd, input.paidKhr) }
}

export type PaymentGroupTag = 'paid' | 'part_paid' | 'unpaid'

export type PaymentAllocationGroup = {
  /** The sale_amendments.group_id of an addition; null is the POS checkout group (at most one). */
  id: string | null
  /**
   * What the group added to the sale: the sum of total_after - total_before over its amendments; the checkout group's own total.
   * A lowering group is negative: it is credit, not a free group (see allocatePaymentsToGroups).
   */
  amountUsd: FinancialDecimalInput
}

export type PaymentAllocationEvent = PaymentEventMoney & {
  event_id?: string | null
  covers_operation_id?: string | null
  /** An out event that names the event it reverses inherits that event's group when it carries no link of its own. */
  reverses_event_id?: string | null
}

export type PaymentAllocationResult = {
  groups: Array<{ id: string | null; amountUsd: number; paidUsd: number; owedUsd: number; tag: PaymentGroupTag }>
  /** Money left after every group is covered (an overpayment, or a debt lowered past the total). */
  unallocatedUsd: number
}

/** Round a non-negative scaled figure (calculation units times the rate numerator) to dollar units, half-up. */
const scaledToUnits = (scaled: bigint, numerator: bigint): bigint => (2n * scaled + numerator) / (2n * numerator)

/**
 * Which group of a sale each payment paid, so every line can read Paid, Part paid or Unpaid without a
 * stored flag that could drift from the money (a flag per line would be a second ledger).
 *   1. Money an event is linked to (covers_operation_id) goes to that group first; anything above what
 *      the group needs, and linked money of a group the caller did not list, joins the shared pool.
 *      An out event that names the event it reverses (reverses_event_id) takes that event's link when it
 *      has none; a reversal naming an event that is not in the list is refused, not guessed.
 *   2. The shared pool is the unlinked money (checkout, later payments) net of unlinked money paid out,
 *      plus the debt returns lowered ("a return lowers the debt first") and the credit of lowering groups
 *      (a negative amount: the sale owes less, so the money that would have paid it pays the others).
 *   3. The pool pays the POS group first, then the other groups oldest first (the order given).
 * ONE BASIS WITH THE STATUS: riel converts at the SALE's rate and precision version (the same rateRatio
 * deriveSalePaymentState's coverage runs on), and everything is compared as exact integers scaled by the
 * rate, so a sale the status calls Completed never shows a Part paid line. A group is Paid when nothing
 * is owed on it, or when the whole sale is covered within half a cent (the tolerance is the sale's, taken
 * once: three groups each short $0.004 are $0.012 short and none of them is Paid); Part paid when some
 * money reached it; else Unpaid.
 * Throws on an unreadable sale rate, like the status.
 */
export function allocatePaymentsToGroups(input: {
  sale: RecordedSaleMoney
  groups: readonly PaymentAllocationGroup[]
  events: readonly PaymentAllocationEvent[]
  debtLoweredUsd?: FinancialDecimalInput
}): PaymentAllocationResult {
  const { numerator, denominator } = rateRatio(input.sale.exchange_rate as FinancialDecimalInput, recordedMoneyPrecisionVersion(input.sale))
  const groups = input.groups
  const listed = groups.filter((group) => group.id !== null)
  if (groups.length - listed.length > 1) throw new RangeError('A sale has one POS checkout group.')
  if (new Set(listed.map((group) => group.id)).size !== listed.length) throw new RangeError('Group ids must be unique.')

  let credit = 0n
  const need = groups.map((group) => {
    const units = financialCalculationUnits(group.amountUsd)
    if (units < 0n) credit += -units * numerator
    return units > 0n ? units * numerator : 0n
  })
  const known = new Map<string, number>()
  groups.forEach((group, index) => { if (group.id !== null) known.set(group.id, index) })
  const byId = new Map<string, PaymentAllocationEvent>()
  for (const event of input.events) if (event.event_id) byId.set(String(event.event_id), event)

  const linkOf = (event: PaymentAllocationEvent): string | null => {
    if (event.covers_operation_id != null && event.covers_operation_id !== '') return String(event.covers_operation_id)
    if (event.reverses_event_id) {
      const target = byId.get(String(event.reverses_event_id))
      if (!target) throw new RangeError('A payment event reverses an event that is not in the list.')
      return target.covers_operation_id != null && target.covers_operation_id !== '' ? String(target.covers_operation_id) : null
    }
    return null
  }

  const paid = groups.map(() => 0n)
  const linked = groups.map(() => 0n)
  let pool = financialCalculationUnits(input.debtLoweredUsd ?? 0) * numerator + credit
  for (const event of input.events) {
    const money = financialCalculationUnits(Number(event.amount_paid_usd) || 0) * numerator + financialCalculationUnits(Number(event.amount_paid_khr) || 0) * denominator
    const signed = event.direction === 'out' ? -money : money
    const link = linkOf(event)
    const index = link !== null ? known.get(link) : undefined
    if (index === undefined) pool += signed
    else linked[index] += signed
  }
  groups.forEach((_, index) => {
    if (linked[index] <= 0n) {
      pool += linked[index]
      return
    }
    paid[index] = linked[index] < need[index] ? linked[index] : need[index]
    pool += linked[index] - paid[index]
  })
  if (pool < 0n) pool = 0n

  const fillOrder = [...groups.keys()].sort((a, b) => (groups[a].id === null ? 0 : 1) - (groups[b].id === null ? 0 : 1) || a - b)
  for (const index of fillOrder) {
    const take = pool < need[index] - paid[index] ? pool : need[index] - paid[index]
    paid[index] += take
    pool -= take
  }

  const owed = groups.map((_, index) => need[index] - paid[index])
  const saleCovered = owed.reduce((sum, value) => sum + value, 0n) <= PAID_STATUS_SHORTFALL_TOLERANCE_UNITS * numerator
  return {
    groups: groups.map((group, index) => {
      const tag: PaymentGroupTag = saleCovered || owed[index] === 0n ? 'paid' : paid[index] > 0n ? 'part_paid' : 'unpaid'
      return {
        id: group.id,
        amountUsd: unitsToNumber(scaledToUnits(need[index], numerator)),
        paidUsd: unitsToNumber(scaledToUnits(paid[index], numerator)),
        owedUsd: unitsToNumber(scaledToUnits(owed[index], numerator)),
        tag,
      }
    }),
    unallocatedUsd: unitsToNumber(scaledToUnits(pool, numerator)),
  }
}
