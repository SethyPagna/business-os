// One sale's RECORDS: every change anybody ever made to it, as one list (N41).
//
// The owner's ask, Sep 6 2026, verbatim: "i want a row at the bottom of sales
// each sale rows. one line called Records with total records when press it pops
// up a float with who made changes in this sales record (by default should show
// change status / add sale / edit product quantity / change delivery fee / or +
// for matching conditions, and click on specific information/record row can see
// more details before and after."
//
// THE PROBLEM THIS MODULE SOLVES
//
// A sale is changed by more writers than any one table knows about, and each
// writer already records itself somewhere different:
//
//   sale_amendments   (0115)  line added / removed / quantity moved / delivery
//                             fee, and (0129) the actual courier cost.
//                             Permanent, append-only, enforced by triggers.
//   audit_logs        (0001)  status transitions (including cancel and the
//                             settlement of a credit sale), the customer swap,
//                             and undo/redo replays. Retention-pruned.
//   sale_bulk_members (0120)  the ONLY per-sale trace of a bulk status change
//                             or a bulk customer/payment-method update: those
//                             write ONE audit row keyed by the operation id,
//                             not by sale, so without this join a sale that was
//                             cancelled in a bulk action shows no record of it.
//   returns + return audit/bulk history: creation, edit, grouped cancel,
//                             undo and redo each have their own actor and time.
//                             The mutable returns row alone cannot attribute a
//                             later act to the person who performed it.
//   sales.created_at + durable mutation before-snapshots: the sale itself.
//                             Creation is reconstructed from first known
//                             before-values so current mutable tender/status
//                             never masquerade as original state.
//
// So the records list is a UNION, not a table, and this module is the pure half
// of it: the SQL is in routes/sales.ts, the meaning is here, and
// scripts/test-sale-records-pure.cjs drives every shape directly.
//
// TWO RULES THAT KEEP THE LIST HONEST
//
// 1. ONE ACT, ONE RECORD. Every amendment writes BOTH a ledger entry and an
//    audit row (routes/sales.ts's auditAmendment says why: one is the sale's
//    history, the other the system's). Both are wanted, but a reader looking at
//    one sale must not see the same correction twice, so an audit row whose
//    details say `action: 'amend'` is dropped here -- the ledger entry it
//    mirrors is richer and permanent.
// 2. KIND IS WHAT CHANGED; VIA IS HOW IT WAS DONE. An undo does not get its own
//    kind that hides which line moved: it keeps `item_qty_changed` and carries
//    via 'undo'. `undone` is for the replays whose audit row is their ONLY
//    trace -- today that is the settlement applier, which writes no ledger
//    entry (lib/saleSettlementAction.ts:193).
//    The undo appliers are NOT uniform in this, which is the trap: the
//    sale.add_items applier writes a ledger entry (undoAppliers.ts:486-496 and
//    :1197-1213, kind 'line_removed' via 'undo') AND an action_undo/action_redo
//    audit row (:361-380, batched at :561; the non-atomic path audits at
//    :1284-1290), both describing the same reversal. So rule 1 applies to it as
//    well and its audit row is suppressed here -- otherwise one undo reads as
//    two records, the richer of which ("Item removed", with the quantities) is
//    shadowed by a contentless "Undone".
//
// WHAT IS NOT IN THE LIST, and why -- named rather than left silent:
//
//   supplier returns A return whose `return_scope` is 'supplier' is filtered
//                    out of every sale-status computation
//                    (returns.ts:1653, :2550, returnBulkAction.ts:254), so it
//                    never touched the sale row. Listing it would be a
//                    fabricated record, not a missing one.
//   the return's own line items, refund tender and restock decisions: those
//                    belong to the return's own screen. What appears here is
//                    only the return's effect ON THE SALE -- its status.
//   reprints         Printing changes nothing.
//   cache/version    Not a change to the sale.
//   audit rows older than the retention window (lib/audit.ts, 21 days by
//                    default) are GONE from the database; nothing here can
//                    invent them. That is exactly why this lane put the
//                    delivery actual cost in the permanent ledger instead.

import { parseSqliteTimestampMs } from './saleAmendments'

// ---------------------------------------------------------------------------
// The closed set of kinds. Closed on purpose: the float renders a localized
// label per kind, so an invented kind would print a raw string in Khmer.
// Anything a classifier cannot place lands on 'other', which has its own label
// and shows the raw summary.
// ---------------------------------------------------------------------------
export const SALE_RECORD_KINDS = [
  'sale_created',
  'status_changed',
  'item_added',
  'item_removed',
  'item_qty_changed',
  'item_price_changed',
  'delivery_fee_changed',
  'delivery_cost_changed',
  'discount_changed',
  'customer_changed',
  'payment_settled',
  'cancelled',
  'undone',
  'other',
] as const
export type SaleRecordKind = (typeof SALE_RECORD_KINDS)[number]

export type SaleRecordSource = 'sale' | 'ledger' | 'audit' | 'bulk' | 'return'

export interface SaleRecord {
  /**
   * Stable across reloads and unique across sources. Source-prefixed because
   * `sale_amendments.id` 7 and `audit_logs.id` 7 are different records and a
   * bare number would collide in a React key and in the float's selection.
   */
  id: string
  source: SaleRecordSource
  /** The timestamp exactly as stored, for display (dd/mm/yyyy HH:mm client-side). */
  at: string | null
  /** Milliseconds, for ORDERING only. Null when the stored value is unparseable. */
  at_ms: number | null
  /** The acting account's USERNAME (N13's rule), never a full name. */
  actor_username: string | null
  kind: SaleRecordKind
  /** 'amend' | 'undo' | 'redo' when the durable source records that direction. */
  via: string | null
  /** What the change was about: a product name, "delivery", a customer. */
  subject: string | null
  /** A one-line English fallback. The client renders its own localized line. */
  summary: string
  /** Field-keyed state before and after. Same keys on both sides, always. */
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}

/**
 * Milliseconds for ordering, or null when the stored value will not parse.
 * parseSqliteTimestampMs answers NaN for that case; NaN in a comparator makes
 * the sort order undefined, so it is converted once, here.
 */
function atMs(raw: unknown): number | null {
  const ms = parseSqliteTimestampMs(raw)
  return Number.isFinite(ms) ? ms : null
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  return trimmed === '' ? null : trimmed
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** JSON that came out of a TEXT column, or null. Never throws. */
export function parseDetails(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'object') return raw as Record<string, unknown>
  try {
    const parsed = JSON.parse(String(raw))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch (_) {
    return null
  }
}

// ---------------------------------------------------------------------------
// Source 1: the sale itself.
// ---------------------------------------------------------------------------
export interface SaleRecordSaleRow {
  id: number | string
  created_at?: unknown
  cashier_name?: unknown
  receipt_number?: unknown
  sale_status?: unknown
  /** The status the sale held before a return moved it. Source of the "before". */
  status_before_return?: unknown
  /** The status the sale held before cancellation, retained on the sale row. */
  status_before_cancel?: unknown
  updated_at?: unknown
  total_usd?: unknown
  payment_method?: unknown
  payment_details?: unknown
  amount_paid_usd?: unknown
  amount_paid_khr?: unknown
  change_usd?: unknown
  change_khr?: unknown
  items?: Array<{
    product_name?: unknown
    quantity?: unknown
    applied_price_usd?: unknown
    total_usd?: unknown
  }>
}

/**
 * The sale's own creation, synthesized from the row.
 *
 * Nothing writes an audit row when a sale is rung up (verified: routes/sales.ts
 * calls audit() three times and none of them is on POST /). Leaving it out
 * would make a never-amended sale read "Records 0", which is false -- something
 * did happen, and it is the thing every later record is relative to.
 */
export function saleCreatedRecord(sale: SaleRecordSaleRow): SaleRecord {
  const at = text(sale.created_at)
  return {
    id: `sale:${sale.id}`,
    source: 'sale',
    at,
    at_ms: atMs(at),
    actor_username: text(sale.cashier_name),
    kind: 'sale_created',
    via: null,
    subject: text(sale.receipt_number),
    summary: `Sale ${text(sale.receipt_number) || `#${sale.id}`} recorded`,
    before: null,
    after: {
      receipt_number: text(sale.receipt_number),
      sale_status: text(sale.sale_status),
      products: sale.items === undefined ? null : sale.items.map((item) => ({
        product: text(item.product_name),
        quantity: numberOrNull(item.quantity),
        unit_price_usd: numberOrNull(item.applied_price_usd),
        line_total_usd: numberOrNull(item.total_usd),
      })),
      total_usd: numberOrNull(sale.total_usd),
      payment_method: text(sale.payment_method),
      payment_details: (() => {
        if (Array.isArray(sale.payment_details)) return sale.payment_details
        try { return sale.payment_details ? JSON.parse(String(sale.payment_details)) : null } catch (_) { return null }
      })(),
      amount_paid_usd: numberOrNull(sale.amount_paid_usd),
      amount_paid_khr: numberOrNull(sale.amount_paid_khr),
      change_usd: numberOrNull(sale.change_usd),
      change_khr: numberOrNull(sale.change_khr),
    },
  }
}

const CREATION_SNAPSHOT_FIELDS = [
  'sale_status',
  'total_usd',
  'payment_method',
  'payment_details',
  'amount_paid_usd',
  'amount_paid_khr',
  'change_usd',
  'change_khr',
] as const

const LEGACY_AMBIGUOUS_CREATION_FIELDS = [
  'sale_status',
  'payment_method',
  'payment_details',
  'amount_paid_usd',
  'amount_paid_khr',
  'change_usd',
  'change_khr',
] as const

type CreationSnapshotField = (typeof CREATION_SNAPSHOT_FIELDS)[number]

type KnownBefore = { at: number; value: unknown }

export interface SaleRecordMutationRow {
  before_json?: unknown
  created_at?: string | null
}

function rememberEarlierBefore(
  known: Partial<Record<CreationSnapshotField, KnownBefore>>,
  field: CreationSnapshotField,
  value: unknown,
  at: unknown,
): void {
  if (value === undefined) return
  const stamp = atMs(at)
  if (stamp === null) return
  if (!known[field] || stamp < known[field]!.at) known[field] = { at: stamp, value }
}

/**
 * Reconstruct only values that are provably the sale's creation state.
 *
 * The sales row is mutable. Rendering it verbatim in the creation record made
 * a later settlement look as if the sale had originally been completed and
 * paid by that tender. The first durable before-value for each field is the
 * original value. Legacy rows may have outlived the audit entry that recorded
 * a status or payment change, so mutable fields without surviving evidence are
 * explicitly unknown rather than inferred from today's row. The total remains
 * safe when there is no permanent amendment ledger entry.
 * Product lines are safe only while no line amendment exists. Once a line was
 * added/removed/changed, the ledger does not retain enough price detail to
 * recreate the original array, so `products: null` says unknown instead of
 * presenting today's lines as the original basket.
 */
export function reconstructSaleCreation(input: {
  sale: SaleRecordSaleRow
  ledger?: SaleRecordLedgerRow[]
  audit?: SaleRecordAuditRow[]
  bulk?: SaleRecordBulkRow[]
  returns?: SaleRecordReturnRow[]
  mutations?: SaleRecordMutationRow[]
}): SaleRecordSaleRow {
  const known: Partial<Record<CreationSnapshotField, KnownBefore>> = {}
  for (const row of input.ledger || []) {
    rememberEarlierBefore(known, 'total_usd', row.total_before_usd, row.created_at)
  }
  for (const row of input.audit || []) {
    const details = parseDetails(row.details) || {}
    const before = details.before && typeof details.before === 'object'
      ? details.before as Record<string, unknown> : {}
    rememberEarlierBefore(known, 'sale_status', before.sale_status ?? details.oldStatus, row.created_at)
    for (const field of CREATION_SNAPSHOT_FIELDS) {
      if (field === 'sale_status' || field === 'total_usd') continue
      if (field in before) rememberEarlierBefore(known, field, before[field], row.created_at)
    }
    // The old reopen-for-correction audit predates durable payment snapshots.
    // It proves today's tender is not the creation tender, but cannot recover
    // the old values. Keep those fields explicitly unknown rather than calling
    // the mutable row original.
    if (String(row.action || '') === 'sale_payment_correction_opened') {
      for (const field of ['payment_method', 'payment_details', 'amount_paid_usd', 'amount_paid_khr', 'change_usd', 'change_khr'] as const) {
        if (!(field in before)) rememberEarlierBefore(known, field, null, row.created_at)
      }
    }
  }
  for (const row of input.bulk || []) {
    const entry = bulkMemberEntry(row.receipt_json, input.sale.id)
    if (!entry || entry.before === undefined) continue
    const before = entry.before
    if (before && typeof before === 'object') {
      for (const field of CREATION_SNAPSHOT_FIELDS) {
        if (field in (before as Record<string, unknown>)) {
          rememberEarlierBefore(known, field, (before as Record<string, unknown>)[field], row.created_at)
        }
      }
    } else {
      rememberEarlierBefore(known, 'sale_status', before, row.created_at)
    }
  }
  for (const row of input.mutations || []) {
    const envelope = parseDetails(row.before_json) || {}
    const before = envelope.money && typeof envelope.money === 'object'
      ? envelope.money as Record<string, unknown>
      : envelope
    for (const field of CREATION_SNAPSHOT_FIELDS) {
      if (field in before) rememberEarlierBefore(known, field, before[field], row.created_at)
    }
  }
  const firstReturnAt = (input.returns || [])
    .filter(returnTouchesSale)
    .map((row) => ({ row, stamp: atMs(row.created_at) }))
    .filter((entry): entry is { row: SaleRecordReturnRow; stamp: number } => entry.stamp !== null)
    .sort((left, right) => left.stamp - right.stamp)[0]
  if (firstReturnAt) {
    rememberEarlierBefore(known, 'sale_status', input.sale.status_before_return, firstReturnAt.row.created_at)
  }
  if (text(input.sale.sale_status) === 'cancelled') {
    rememberEarlierBefore(known, 'sale_status', input.sale.status_before_cancel, input.sale.updated_at)
  }

  const reconstructed: SaleRecordSaleRow = { ...input.sale }
  for (const field of LEGACY_AMBIGUOUS_CREATION_FIELDS) {
    reconstructed[field] = null
  }
  for (const field of CREATION_SNAPSHOT_FIELDS) {
    if (known[field]) reconstructed[field] = known[field]!.value
  }
  if ((input.ledger || []).some((row) => String(row.kind || '').startsWith('line_'))) {
    reconstructed.items = undefined
  }
  return reconstructed
}

// ---------------------------------------------------------------------------
// Source 2: the amendment ledger.
// ---------------------------------------------------------------------------
export interface SaleRecordLedgerRow {
  id: number
  kind: string | null
  group_id?: string | null
  product_name?: string | null
  quantity_before?: number | null
  quantity_after?: number | null
  amount_before_usd?: number | null
  amount_after_usd?: number | null
  total_before_usd?: number | null
  total_after_usd?: number | null
  units_moved?: number | null
  stock_skipped?: number | null
  via?: string | null
  note?: string | null
  user_name?: string | null
  created_at?: string | null
}

const LEDGER_KIND_TO_RECORD_KIND: Record<string, SaleRecordKind> = {
  line_added: 'item_added',
  line_removed: 'item_removed',
  line_quantity_increased: 'item_qty_changed',
  line_quantity_decreased: 'item_qty_changed',
  delivery_fee_changed: 'delivery_fee_changed',
  // Codex's 0129 named the LEDGER kind 'delivery_actual_cost_changed'. The
  // RECORD kind is the shorter 'delivery_cost_changed': the float's labels are
  // this vocabulary, and normalizing here is exactly what the mapping is for.
  delivery_actual_cost_changed: 'delivery_cost_changed',
}

/** "Delivery", as the subject of the two money kinds. */
const DELIVERY_SUBJECT = 'delivery'

export function ledgerRecord(row: SaleRecordLedgerRow): SaleRecord {
  const ledgerKind = String(row.kind || '')
  const kind = LEDGER_KIND_TO_RECORD_KIND[ledgerKind] || 'other'
  const money = kind === 'delivery_fee_changed' || kind === 'delivery_cost_changed'
  const at = text(row.created_at)
  const subject = money ? DELIVERY_SUBJECT : text(row.product_name)
  const before: Record<string, unknown> = money
    ? { amount_usd: numberOrNull(row.amount_before_usd) }
    : { quantity: numberOrNull(row.quantity_before) }
  const after: Record<string, unknown> = money
    ? { amount_usd: numberOrNull(row.amount_after_usd) }
    : { quantity: numberOrNull(row.quantity_after) }
  // The sale's own total either side is stored on every ledger row (0115 stores
  // it rather than deriving it, precisely so a later entry cannot restate it),
  // so the detail view can always answer "and what did the customer owe?".
  before.total_usd = numberOrNull(row.total_before_usd)
  after.total_usd = numberOrNull(row.total_after_usd)
  return {
    id: `amendment:${row.id}`,
    source: 'ledger',
    at,
    at_ms: atMs(at),
    actor_username: text(row.user_name),
    kind,
    via: text(row.via) || 'amend',
    subject,
    summary: money
      ? `${ledgerKind === 'delivery_actual_cost_changed' ? 'Delivery cost' : 'Delivery fee'} ${fmt(row.amount_before_usd)} to ${fmt(row.amount_after_usd)}`
      : `${text(row.product_name) || 'Line'} ${numberOrNull(row.quantity_before) ?? 0} to ${numberOrNull(row.quantity_after) ?? 0}`,
    before,
    after,
  }
}

function fmt(value: unknown): string {
  const parsed = numberOrNull(value)
  return parsed === null ? '-' : `$${parsed.toFixed(2)}`
}

// ---------------------------------------------------------------------------
// Source 3: audit_logs rows for this sale.
// ---------------------------------------------------------------------------
export interface SaleRecordAuditRow {
  id: number
  action?: string | null
  details?: unknown
  user_name?: string | null
  created_at?: string | null
}

/**
 * The appliers whose undo/redo ALSO writes an amendment ledger entry, so that
 * their audit row is the twin of a richer record rather than a record of its
 * own. Kept as a set rather than a boolean check so the next applier that grows
 * a ledger write is one line here, next to the reason.
 *
 * 'sale.add_items' is undoAppliers.ts's SALE_ADD_ITEMS_ACTION_KIND; it is
 * spelled out rather than imported because this module is the pure half and
 * undoAppliers.ts pulls in the D1 binding, the broadcaster and eight more
 * modules. scripts/test-sale-records-pure.cjs asserts the two spellings agree.
 */
const LEDGER_WRITING_APPLIERS = new Set(['sale.add_items'])

/**
 * Classify one audit row, or return null when it must not appear.
 *
 * TWO suppressions, both of them rule 1 -- one act, one record:
 *   `details.action === 'amend'`  the twin every amendment writes.
 *   an action_undo / action_redo replay by an applier that also writes a
 *   ledger entry (LEDGER_WRITING_APPLIERS). A settlement replay writes none,
 *   so it stays and becomes kind 'undone'.
 */
export function auditRecord(row: SaleRecordAuditRow): SaleRecord | null {
  const details = parseDetails(row.details) || {}
  if (text(details.action) === 'amend') return null

  const action = String(row.action || '')
  if ((action === 'action_undo' || action === 'action_redo')
    && LEDGER_WRITING_APPLIERS.has(String(text(details.applier) || ''))) return null

  const at = text(row.created_at)
  const base = {
    id: `audit:${row.id}`,
    source: 'audit' as const,
    at,
    at_ms: atMs(at),
    actor_username: text(row.user_name),
    via: null,
  }

  if (action === 'sale_settlement') {
    const beforeState = details.before && typeof details.before === 'object'
      ? details.before as Record<string, unknown> : {}
    const afterState = details.after && typeof details.after === 'object'
      ? details.after as Record<string, unknown> : {}
    return {
      ...base,
      kind: 'payment_settled',
      subject: null,
      summary: details.paymentCorrection ? 'Payment corrected' : 'Payment settled',
      before: {
        sale_status: text(beforeState.sale_status),
        payment_method: text(beforeState.payment_method),
        payment_details: parsePaymentDetails(beforeState.payment_details),
        amount_paid_usd: numberOrNull(beforeState.amount_paid_usd),
        amount_paid_khr: numberOrNull(beforeState.amount_paid_khr),
      },
      after: {
        sale_status: text(afterState.sale_status),
        payment_method: text(afterState.payment_method),
        payment_details: parsePaymentDetails(afterState.payment_details),
        amount_paid_usd: numberOrNull(afterState.amount_paid_usd),
        amount_paid_khr: numberOrNull(afterState.amount_paid_khr),
      },
    }
  }

  // An undo/redo replay of an action that keeps its own state elsewhere
  // (lib/saleSettlementAction.ts). It writes no ledger entry, so this row is
  // the only trace and 'undone' is its kind rather than a qualifier.
  if (action === 'action_undo' || action === 'action_redo') {
    return {
      ...base,
      kind: 'undone',
      subject: text(details.applier),
      summary: `${action === 'action_undo' ? 'Undid' : 'Redid'} ${text(details.applier) || 'an action'}`,
      before: null,
      after: { direction: text(details.direction) || (action === 'action_undo' ? 'undo' : 'redo') },
    }
  }

  const oldStatus = text(details.oldStatus)
  const newStatus = text(details.newStatus)
  if (oldStatus !== null || newStatus !== null) {
    // Cancelling is a status change, but it is the one the shop reads
    // differently from every other -- it is the sale being taken back -- so it
    // gets its own kind and carries the reason it was given.
    const cancelled = newStatus === 'cancelled'
    // Settling a credit sale IS a status change in this schema (awaiting_payment
    // to completed / awaiting_delivery, with the tender recorded in the same
    // write). Naming it 'payment_settled' is what makes "who took the money"
    // answerable without the reader decoding statuses.
    const settled = !cancelled && oldStatus === 'awaiting_payment'
    return {
      ...base,
      kind: cancelled ? 'cancelled' : settled ? 'payment_settled' : 'status_changed',
      subject: null,
      summary: `Status ${oldStatus || '-'} to ${newStatus || '-'}`,
      before: { sale_status: oldStatus },
      after: {
        sale_status: newStatus,
        ...(cancelled ? { cancel_reason: text(details.cancelReason), cancel_note: text(details.cancelNote) } : {}),
        ...(details.stockSkipped ? { stock_skipped: true } : {}),
      },
    }
  }

  if ('previous_customer_id' in details || 'next_customer_id' in details) {
    return {
      ...base,
      kind: 'customer_changed',
      subject: null,
      summary: 'Customer changed',
      before: { customer_id: numberOrNull(details.previous_customer_id) },
      after: {
        customer_id: numberOrNull(details.next_customer_id),
        membership_number: text(details.membership_number),
      },
    }
  }

  return {
    ...base,
    kind: 'other',
    subject: null,
    summary: action || 'Changed',
    before: null,
    after: Object.keys(details).length ? details : null,
  }
}

function parsePaymentDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value
  if (value === null || value === undefined || value === '') return null
  try {
    const parsed = JSON.parse(String(value))
    return Array.isArray(parsed) ? parsed : null
  } catch (_) {
    return null
  }
}

// ---------------------------------------------------------------------------
// Source 4: bulk operations this sale was actually changed by.
//
// Only CHANGED sales become sale_bulk_members rows (both bulk writers filter on
// `member.changed`), so membership already means "this sale moved". The
// operation's receipt_json carries the per-sale before/after the float needs;
// it is parsed HERE rather than in SQL so the shape is testable and so a
// receipt that predates a field degrades to "no detail" instead of an error.
// ---------------------------------------------------------------------------
export interface SaleRecordBulkRow {
  operation_id: string
  request_json?: unknown
  receipt_json?: unknown
  history_id?: number | null
  created_at?: string | null
  created_by_name?: string | null
  label?: string | null
}

function bulkMemberEntry(receiptJson: unknown, saleId: number | string): Record<string, unknown> | null {
  const receipt = parseDetails(receiptJson)
  const items = receipt && Array.isArray(receipt.items) ? receipt.items as unknown[] : []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    if (String(entry.id) === String(saleId)) return entry
  }
  return null
}

export function bulkRecord(row: SaleRecordBulkRow, saleId: number | string): SaleRecord {
  const request = parseDetails(row.request_json) || {}
  const entry = bulkMemberEntry(row.receipt_json, saleId) || {}
  const at = text(row.created_at)
  const action = request.action && typeof request.action === 'object'
    ? text((request.action as Record<string, unknown>).kind)
    : null
  const targetStatus = text(request.target_status)

  // A bulk STATUS operation stores before/after as the status strings; a bulk
  // FIELD update stores them as objects (the customer/payment snapshot).
  const before = entry.before === undefined ? null
    : typeof entry.before === 'object' && entry.before !== null ? entry.before as Record<string, unknown>
    : { sale_status: text(entry.before) }
  const after = entry.after === undefined ? null
    : typeof entry.after === 'object' && entry.after !== null ? entry.after as Record<string, unknown>
    : { sale_status: text(entry.after) }

  const kind: SaleRecordKind = targetStatus
    ? (targetStatus === 'cancelled' ? 'cancelled' : 'status_changed')
    : action === 'customer' ? 'customer_changed'
    : 'other'

  return {
    id: `bulk:${row.operation_id}`,
    source: 'bulk',
    at,
    at_ms: atMs(at),
    actor_username: text(row.created_by_name),
    kind,
    via: null,
    subject: null,
    summary: targetStatus
      ? `Bulk status to ${targetStatus}`
      : `Bulk update: ${action || 'sale fields'}`,
    before,
    after,
  }
}

// ---------------------------------------------------------------------------
// Source 5: the returns that rewrote this sale's status.
//
// Three writers move sales.sale_status without auditing the SALE:
//   routes/returns.ts:1658          creating a return
//   routes/returns.ts:2558          editing one (which can restore the status)
//   lib/returnBulkAction.ts:253     the bulk cancel/restore
// Each audits entity 'return' instead (returns.ts:2563,
// returnBulkAction.ts:272), so audit_logs WHERE entity='sale' cannot see them
// and a sale that was fully refunded this morning would read "Records 1".
//
// WHAT THIS SOURCE HONESTLY KNOWS, and what it refuses to guess:
//
// The three writers derive 'returned' vs 'partial_return' from the sum of every
// live return against the sale's lines, and they OVERWRITE the one column that
// holds the answer. So only the newest live return can be matched to the status
// the sale actually carries now (`is_current`, computed by the caller's SQL);
// for an earlier one the answer was overwritten and is gone. That record still
// appears -- it changed the sale -- but its status pair is left null rather
// than back-filled with a number that would look authoritative and be wrong.
// ---------------------------------------------------------------------------
export interface SaleRecordReturnRow {
  id: number | string
  return_number?: string | null
  status?: string | null
  return_scope?: string | null
  total_refund_usd?: number | null
  cashier_name?: string | null
  created_at?: string | null
  updated_at?: string | null
  /** 1 when this is the newest non-cancelled customer-scope return on the sale. */
  is_current?: number | null
}

export interface SaleRecordReturnAuditRow {
  audit_id: number | string
  return_id: number | string
  action?: string | null
  details?: unknown
  user_name?: string | null
  created_at?: string | null
  return_number?: string | null
}

export interface SaleRecordReturnBulkEventRow {
  audit_id: number | string
  operation_id: string
  return_id: number | string
  action?: string | null
  request_json?: unknown
  receipt_json?: unknown
  user_name?: string | null
  created_at?: string | null
  return_number?: string | null
}

/** True when this return is one of the ones that move sales.sale_status. */
export function returnTouchesSale(row: SaleRecordReturnRow): boolean {
  return (text(row.return_scope) || 'customer') === 'customer'
}

export function legacyReturnRecord(row: SaleRecordReturnRow): SaleRecord {
  const at = text(row.created_at)
  const label = row.return_number ? text(row.return_number) : null
  return {
    id: `return-legacy:${row.id}`,
    source: 'return',
    at,
    at_ms: atMs(at),
    actor_username: text(row.cashier_name),
    kind: 'other',
    via: null,
    subject: label || `#${row.id}`,
    summary: 'Legacy return recorded; original change details unavailable',
    before: null,
    after: null,
  }
}

/** One durable individual return audit event. Sparse legacy audit payloads stay sparse. */
export function returnAuditRecord(row: SaleRecordReturnAuditRow): SaleRecord | null {
  const action = String(row.action || '')
  if (action !== 'create' && action !== 'update') return null
  const at = text(row.created_at)
  const details = parseDetails(row.details) || {}
  const label = text(row.return_number) || `#${row.return_id}`
  const after: Record<string, unknown> = {}
  if (action === 'create') after.return_status = 'completed'
  if (text(details.reason)) after.reason = text(details.reason)
  return {
    id: `return-audit:${row.audit_id}`,
    source: 'return',
    at,
    at_ms: atMs(at),
    actor_username: text(row.user_name),
    kind: action === 'create' ? 'status_changed' : 'other',
    via: null,
    subject: label,
    summary: action === 'create' ? 'Return recorded' : 'Return updated',
    before: null,
    after: Object.keys(after).length ? after : null,
  }
}

function returnBulkMemberEntry(receiptJson: unknown, returnId: number | string): Record<string, unknown> | null {
  return bulkMemberEntry(receiptJson, returnId)
}

/** One original/undo/redo event from the durable return bulk operation audit. */
export function returnBulkEventRecord(row: SaleRecordReturnBulkEventRow): SaleRecord | null {
  const request = parseDetails(row.request_json) || {}
  if (text(request.field) !== 'status') return null
  const entry = returnBulkMemberEntry(row.receipt_json, row.return_id)
  if (!entry || entry.changed === false || entry.before === undefined || entry.after === undefined) return null
  const action = String(row.action || '')
  if (!['return_fields_bulk', 'action_undo', 'action_redo'].includes(action)) return null
  const reversed = action === 'action_undo'
  const beforeStatus = text(reversed ? entry.after : entry.before)
  const afterStatus = text(reversed ? entry.before : entry.after)
  const at = text(row.created_at)
  const label = text(row.return_number) || `#${row.return_id}`
  return {
    id: `return-bulk:${row.operation_id}:${row.audit_id}`,
    source: 'return',
    at,
    at_ms: atMs(at),
    actor_username: text(row.user_name),
    kind: 'status_changed',
    via: action === 'action_undo' ? 'undo' : action === 'action_redo' ? 'redo' : null,
    subject: label,
    summary: afterStatus === 'cancelled' ? 'Return cancelled'
      : beforeStatus === 'cancelled' && afterStatus === 'completed' ? 'Return restored'
      : 'Return status changed',
    before: { return_status: beforeStatus },
    after: { return_status: afterStatus },
  }
}

// ---------------------------------------------------------------------------
// The union.
// ---------------------------------------------------------------------------

/**
 * Oldest first, which is how the ledger already reads and how the shop tells
 * the story of an afternoon.
 *
 * Ordering is by parsed millisecond, NOT by the raw string: `sale_amendments`
 * and `audit_logs` store `CURRENT_TIMESTAMP` ('YYYY-MM-DD HH:MM:SS') while a
 * sale's own `created_at` can carry a client ISO stamp ('YYYY-MM-DDTHH:MM:SSZ'),
 * and 'T' sorts after ' ' -- so a plain string sort puts every sale's creation
 * AFTER changes made to it minutes later. A row whose timestamp will not parse
 * keeps its position by falling to the end rather than jumping to 1970, and the
 * id is the tie-break so the order is total and stable.
 */
export function orderSaleRecords(records: SaleRecord[]): SaleRecord[] {
  return [...records].sort((a, b) => {
    const left = a.at_ms === null ? Number.POSITIVE_INFINITY : a.at_ms
    const right = b.at_ms === null ? Number.POSITIVE_INFINITY : b.at_ms
    if (left !== right) return left - right
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

export function buildSaleRecords(input: {
  sale: SaleRecordSaleRow
  ledger?: SaleRecordLedgerRow[]
  audit?: SaleRecordAuditRow[]
  bulk?: SaleRecordBulkRow[]
  returns?: SaleRecordReturnRow[]
  returnAudit?: SaleRecordReturnAuditRow[]
  returnBulk?: SaleRecordReturnBulkEventRow[]
  mutations?: SaleRecordMutationRow[]
}): SaleRecord[] {
  const records: SaleRecord[] = [saleCreatedRecord(reconstructSaleCreation(input))]
  for (const row of input.ledger || []) records.push(ledgerRecord(row))
  const explicitTransitions = (input.audit || []).flatMap((row) => {
    const action = String(row.action || '')
    const details = parseDetails(row.details) || {}
    let before: unknown
    let after: unknown
    if (action === 'sale_payment_correction_opened') {
      before = details.oldStatus
      after = details.newStatus
    } else if (action === 'sale_settlement') {
      before = details.before && typeof details.before === 'object' ? (details.before as Record<string, unknown>).sale_status : null
      after = details.after && typeof details.after === 'object' ? (details.after as Record<string, unknown>).sale_status : null
    } else return []
    return [{
      actor: text(row.user_name) || '',
      at: atMs(row.created_at),
      before: text(before) || '',
      after: text(after) || '',
    }]
  })
  for (const row of input.audit || []) {
    if (String(row.action || '') === 'update') {
      const details = parseDetails(row.details) || {}
      const transitionAt = atMs(row.created_at)
      if (explicitTransitions.some((candidate) => (
        candidate.actor === (text(row.user_name) || '')
        && candidate.before === (text(details.oldStatus) || '')
        && candidate.after === (text(details.newStatus) || '')
        && candidate.at !== null && transitionAt !== null
        && Math.abs(candidate.at - transitionAt) <= 2000
      ))) continue
    }
    const record = auditRecord(row)
    if (record) records.push(record)
  }
  for (const row of input.bulk || []) records.push(bulkRecord(row, input.sale.id))
  const creationAuditedReturnIds = new Set<string>()
  for (const row of input.returnAudit || []) {
    const record = returnAuditRecord(row)
    if (record) {
      records.push(record)
      if (String(row.action || '') === 'create') creationAuditedReturnIds.add(String(row.return_id))
    }
  }
  for (const row of input.returnBulk || []) {
    const record = returnBulkEventRecord(row)
    if (record) records.push(record)
  }
  for (const row of input.returns || []) {
    if (returnTouchesSale(row) && !creationAuditedReturnIds.has(String(row.id))) records.push(legacyReturnRecord(row))
  }
  return orderSaleRecords(records)
}

// ---------------------------------------------------------------------------
// The list-row count.
//
// The Sales list shows "Records n" on every row, so this must never be a query
// per sale. It is ONE statement over the whole page: four grouped counts
// UNIONed and re-summed, plus the +1 every sale gets for its own creation.
//
// The audit half applies BOTH suppressions the detail read applies -- an
// `action: 'amend'` row is the ledger entry's twin, and so is the
// action_undo/action_redo row a ledger-writing applier leaves behind
// (LEDGER_WRITING_APPLIERS above) -- or the count on the row would be larger
// than the list inside the float, which is precisely the kind of quiet
// disagreement that makes a number untrustworthy. The returns half carries the
// same customer-scope filter for the same reason.
//
// `audit_logs.entity_id` is a TEXT column and `sale_amendments.sale_id` is an
// INTEGER one, so the SAME id has to be bound with two different types in the
// same statement: `entity_id IN (77)` matches NOTHING, because the IN operator
// applies the left operand's TEXT affinity only to a comparison, not to the
// integer literal on the right (measured, not assumed --
// scripts/test-sale-records-pure.cjs asserts the count against a real database).
// Wrapping the column in CAST would paper over it and also throw away
// idx_audit_logs_entity, so the binds are built once, here, by
// saleRecordsCountBinds -- a caller cannot get the order or the types wrong
// without deleting the call.
// ---------------------------------------------------------------------------
export const SALE_RECORDS_SELF_COUNT = 1

export function buildSaleRecordsCountSql(placeholders: string): string {
  return `
    SELECT sale_id, SUM(n) AS n FROM (
      SELECT sale_id AS sale_id, COUNT(*) AS n
        FROM sale_amendments WHERE sale_id IN (${placeholders}) GROUP BY sale_id
      UNION ALL
      SELECT CAST(a.entity_id AS INTEGER) AS sale_id, COUNT(*) AS n
        FROM audit_logs a
        WHERE a.entity = 'sale' AND a.entity_id IN (${placeholders})
          AND COALESCE(CASE WHEN json_valid(a.details) THEN json_extract(a.details, '$.action') END, '') <> 'amend'
          AND NOT (a.action IN ('action_undo','action_redo')
                   AND CASE WHEN json_valid(a.details) THEN json_extract(a.details, '$.applier') END = 'sale.add_items')
          AND NOT (a.action = 'update' AND EXISTS (
            SELECT 1 FROM audit_logs explicit
            WHERE explicit.entity = a.entity
              AND explicit.entity_id = a.entity_id
              AND COALESCE(explicit.user_name, '') = COALESCE(a.user_name, '')
              AND ABS((julianday(explicit.created_at) - julianday(a.created_at)) * 86400) <= 2
              AND (
                (explicit.action = 'sale_payment_correction_opened'
                  AND COALESCE(CASE WHEN json_valid(explicit.details) THEN json_extract(explicit.details, '$.oldStatus') END, '') = COALESCE(CASE WHEN json_valid(a.details) THEN json_extract(a.details, '$.oldStatus') END, '')
                  AND COALESCE(CASE WHEN json_valid(explicit.details) THEN json_extract(explicit.details, '$.newStatus') END, '') = COALESCE(CASE WHEN json_valid(a.details) THEN json_extract(a.details, '$.newStatus') END, ''))
                OR
                (explicit.action = 'sale_settlement'
                  AND COALESCE(CASE WHEN json_valid(explicit.details) THEN json_extract(explicit.details, '$.before.sale_status') END, '') = COALESCE(CASE WHEN json_valid(a.details) THEN json_extract(a.details, '$.oldStatus') END, '')
                  AND COALESCE(CASE WHEN json_valid(explicit.details) THEN json_extract(explicit.details, '$.after.sale_status') END, '') = COALESCE(CASE WHEN json_valid(a.details) THEN json_extract(a.details, '$.newStatus') END, ''))
              )
          ))
        GROUP BY a.entity_id
      UNION ALL
      SELECT sale_id AS sale_id, COUNT(*) AS n
        FROM sale_bulk_members WHERE sale_id IN (${placeholders}) GROUP BY sale_id
      UNION ALL
      SELECT sale_id AS sale_id, COUNT(*) AS n
        FROM returns
        WHERE sale_id IN (${placeholders})
          AND COALESCE(return_scope, 'customer') = 'customer'
          AND NOT EXISTS (
            SELECT 1 FROM audit_logs ra
            WHERE ra.entity = 'return' AND ra.entity_id = CAST(returns.id AS TEXT)
              AND ra.action = 'create'
          )
        GROUP BY sale_id
      UNION ALL
      SELECT r.sale_id AS sale_id, COUNT(*) AS n
        FROM audit_logs ra
        JOIN returns r ON ra.entity = 'return' AND ra.entity_id = CAST(r.id AS TEXT)
        WHERE r.sale_id IN (${placeholders})
          AND COALESCE(r.return_scope, 'customer') = 'customer'
          AND ra.action IN ('create','update')
        GROUP BY r.sale_id
      UNION ALL
      SELECT m.sale_id AS sale_id,
        SUM(1 + (
          SELECT COUNT(*) FROM audit_logs replay
          WHERE replay.entity = 'return' AND replay.entity_id = ro.id
            AND replay.action IN ('action_undo','action_redo')
        )) AS n
        FROM return_bulk_members m
        JOIN return_bulk_operations ro ON ro.id = m.operation_id
        JOIN action_history rh ON rh.id = ro.history_id
        WHERE m.sale_id IN (${placeholders})
          AND json_valid(ro.request_json)
          AND json_extract(ro.request_json, '$.field') = 'status'
          AND json_valid(ro.receipt_json)
          AND EXISTS (
            SELECT 1 FROM json_each(ro.receipt_json, '$.items') item
            WHERE CAST(json_extract(item.value, '$.id') AS TEXT) = CAST(m.return_id AS TEXT)
              AND COALESCE(json_extract(item.value, '$.changed'), 1) <> 0
              AND json_type(item.value, '$.before') IS NOT NULL
              AND json_type(item.value, '$.after') IS NOT NULL
          )
        GROUP BY m.sale_id
    )
    GROUP BY sale_id
  `
}

/** How many `IN (...)` lists buildSaleRecordsCountSql binds each id into. */
export const SALE_RECORDS_COUNT_BINDS_PER_ID = 6

/**
 * The bind list for buildSaleRecordsCountSql, in statement order: the ledger's
 * INTEGER ids, then the audit table's TEXT ids, then the bulk table's INTEGER
 * ids, then the returns table's INTEGER ids. See the note above for why the
 * second list is stringified.
 */
export function saleRecordsCountBinds(ids: Array<number | string>): Array<number | string> {
  return [...ids, ...ids.map((id) => String(id)), ...ids, ...ids, ...ids, ...ids]
}
