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
//   ordinary audit rows older than the retention window (lib/audit.ts, 21
//                    days by default) are gone. Return-bulk replay rows are
//                    exempt because they are the only actor/time evidence;
//                    generation still exposes already-pruned replay acts as
//                    explicitly unknown rather than silently erasing them.

import { parseSqliteTimestampMs } from './saleAmendments'
import { parseSaleCreationSnapshot, type SaleCreationSnapshotV1 } from './saleCreationSnapshot'

// ---------------------------------------------------------------------------
// The closed set of kinds. Closed on purpose: the float renders a localized
// label per kind, so an invented kind would print a raw string in Khmer.
// A genuine historical sale event that cannot be classified narrowly lands on
// legacy_sale_change; its raw variables never cross the API boundary.
// ---------------------------------------------------------------------------
export const SALE_RECORD_KINDS = [
  'sale_created',
  'status_changed',
  'item_added',
  'item_removed',
  'item_quantity_changed',
  'items_replaced',
  'driver_changed',
  'delivery_fee_changed',
  'delivery_cost_changed',
  'delivery_added',
  'customer_changed',
  'membership_changed',
  'payment_changed',
  'payment_settled',
  'cancelled',
  'sale_items_recovered',
  'legacy_sale_change',
] as const
export type SaleRecordKind = (typeof SALE_RECORD_KINDS)[number]

export const SALE_RECORD_FIELDS = [
  'receipt_number',
  'sale_status',
  'items',
  'total_usd',
  'payment',
  'delivery',
  'customer',
  'membership',
  'item',
  'quantity',
  'removed_items',
  'added_items',
  'delivery_fee_usd',
  'actual_delivery_cost_usd',
  'is_delivery',
  'driver',
  'payment_method',
  'payment_details',
  'amount_paid_usd',
  'amount_paid_khr',
  'change_usd',
  'change_khr',
  'cancel_reason',
  'cancel_note',
  'item_count',
  'stock_effect',
] as const
export type SaleRecordField = (typeof SALE_RECORD_FIELDS)[number]

export type SaleRecordSource = 'sale' | 'ledger' | 'audit' | 'bulk' | 'return' | 'mutation'

export type SaleRecordValueState =
  | { state: 'known_value'; value: unknown }
  | { state: 'known_none' }
  | { state: 'unknown' }

export interface SaleRecordChange {
  field: SaleRecordField
  before: SaleRecordValueState
  after: SaleRecordValueState
}

export interface SaleRecordEventRow {
  id: string
  sale_id: number | string
  source_kind: string
  source_id: string
  generation: number
  kind: string
  via: string
  subject?: string | null
  actor_username?: string | null
  occurred_at: string
  changes_json: unknown
}

type SaleRecordProvenance = {
  source_kind: string
  source_id: string
  generation: number
  sale_id: number
}

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
  /** True only when durable generation proves an event but actor/time were already pruned. */
  provenance_unknown?: boolean
  /**
   * Closed, changed-only field list. Null never carries two meanings: a
   * deliberate absence is known_none and missing historical evidence is
   * unknown.
   */
  changes?: SaleRecordChange[]
  /** Internal source snapshots. buildSaleRecords strips these from the API. */
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  unknown_before_fields?: string[]
  unknown_after_fields?: string[]
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
  creation_snapshot_json?: unknown
  items?: Array<{
    product_name?: unknown
    quantity?: unknown
    applied_price_usd?: unknown
    total_usd?: unknown
  }>
  /** Reader-only marker produced by reconstructSaleCreation. */
  creation_unknown_fields?: string[]
}

function provenanceKey(value: SaleRecordProvenance): string {
  return JSON.stringify([value.source_kind, value.source_id, value.generation, value.sale_id])
}

function detailsProvenance(raw: unknown): SaleRecordProvenance | null {
  const details = parseDetails(raw)
  const value = details?.record_event
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (typeof row.source_kind !== 'string' || !row.source_kind.trim()
    || typeof row.source_id !== 'string' || !row.source_id.trim()
    || typeof row.generation !== 'number' || typeof row.sale_id !== 'number') return null
  const generation = row.generation
  const saleId = row.sale_id
  if (!Number.isSafeInteger(generation) || generation < 0 || !Number.isSafeInteger(saleId) || saleId <= 0) return null
  return {
    source_kind: String(row.source_kind), source_id: String(row.source_id), generation, sale_id: saleId,
  }
}

function validEventState(value: unknown): value is SaleRecordValueState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const stateValue = value as Record<string, unknown>
  if (stateValue.state === 'known_value') return Object.keys(stateValue).length === 2 && 'value' in stateValue
  return (stateValue.state === 'known_none' || stateValue.state === 'unknown') && Object.keys(stateValue).length === 1
}

function eventChanges(raw: unknown): SaleRecordChange[] | null {
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw) } catch (_) { return null }
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 12) return null
  const fields = new Set<string>(SALE_RECORD_FIELDS)
  const seen = new Set<string>()
  const changes: SaleRecordChange[] = []
  for (const candidate of parsed) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
    const change = candidate as Record<string, unknown>
    const field = String(change.field || '')
    if (!fields.has(field) || seen.has(field) || !validEventState(change.before) || !validEventState(change.after)
      || JSON.stringify(change.before) === JSON.stringify(change.after)) return null
    seen.add(field)
    changes.push({ field: field as SaleRecordField, before: change.before, after: change.after })
  }
  return changes
}

function eventSource(sourceKind: string): SaleRecordSource {
  if (sourceKind === 'sale_settlement') return 'mutation'
  if (sourceKind === 'sale_bulk_status' || sourceKind === 'sale_bulk_update') return 'bulk'
  if (sourceKind.startsWith('return_')) return 'return'
  return 'audit'
}

export function saleRecordEventRecord(row: SaleRecordEventRow): SaleRecord | null {
  if (!SALE_RECORD_KINDS.includes(row.kind as SaleRecordKind) || row.kind === 'legacy_sale_change') return null
  const changes = eventChanges(row.changes_json)
  if (!changes) return null
  const at = text(row.occurred_at)
  return {
    id: `event:${row.id}`,
    source: eventSource(String(row.source_kind)),
    at,
    at_ms: atMs(at),
    actor_username: text(row.actor_username),
    kind: row.kind as SaleRecordKind,
    via: text(row.via),
    subject: text(row.subject),
    summary: 'Sale record changed',
    changes,
  }
}

/**
 * Decode the append-only creation envelope written by migration 0134 writers.
 *
 * This deliberately does not merge with the current sale row. Once a valid
 * snapshot exists, every creation field comes from that one envelope so a
 * later product rename, tender correction or driver edit cannot leak into the
 * creation record. Unknown/new snapshot versions fall back to the legacy
 * evidence reconstruction below rather than being partially guessed.
 */
export function saleCreatedRecordFromSnapshot(
  sale: SaleRecordSaleRow,
  snapshot: SaleCreationSnapshotV1,
): SaleRecord {
  const at = text(snapshot.recorded_at)
  const driver = snapshot.delivery || {
    is_delivery: false,
    driver_name: null,
    driver_phone: null,
    delivery_fee_usd: null,
    delivery_actual_cost_usd: null,
  }
  const customerCaptured = Object.prototype.hasOwnProperty.call(snapshot, 'customer')
  const membershipCaptured = Object.prototype.hasOwnProperty.call(snapshot, 'membership')
  const customer = snapshot.customer || null
  const membership = snapshot.membership || null
  return {
    id: `sale:${sale.id}`,
    source: 'sale',
    at,
    at_ms: atMs(at),
    actor_username: text(snapshot.actor?.username),
    kind: 'sale_created',
    via: snapshot.origin,
    subject: text(snapshot.receipt_number) || text(sale.receipt_number),
    summary: `Sale ${text(snapshot.receipt_number) || `#${sale.id}`} recorded`,
    before: null,
    after: {
      receipt_number: text(snapshot.receipt_number),
      sale_status: text(snapshot.sale_status),
      products: snapshot.products.map((item) => ({
        product: text(item.product),
        sku: text(item.sku),
        quantity: numberOrNull(item.quantity),
        unit_price_usd: numberOrNull(item.unit_price_usd),
        line_total_usd: numberOrNull(item.line_total_usd),
      })),
      total_usd: numberOrNull(snapshot.total_usd),
      payment_method: text(snapshot.payment_method),
      payment_details: snapshot.payment_details,
      amount_paid_usd: numberOrNull(snapshot.amount_paid_usd),
      amount_paid_khr: numberOrNull(snapshot.amount_paid_khr),
      change_usd: numberOrNull(snapshot.change_usd),
      change_khr: numberOrNull(snapshot.change_khr),
      is_delivery: Boolean(driver.is_delivery),
      delivery_contact_name: text(driver.driver_name),
      delivery_contact_phone: text(driver.driver_phone),
      delivery_fee_usd: numberOrNull(driver.delivery_fee_usd),
      delivery_actual_cost_usd: numberOrNull(driver.delivery_actual_cost_usd),
      customer_id: numberOrNull(customer?.id),
      customer_name: text(customer?.name),
      membership_number: text(membership?.number),
      membership_discount_usd: numberOrNull(membership?.discount_usd),
      membership_discount_khr: numberOrNull(membership?.discount_khr),
      membership_points_redeemed: numberOrNull(membership?.points_redeemed),
    },
    unknown_after_fields: [
      ...(customerCaptured ? [] : ['customer_id']),
      ...(membershipCaptured ? [] : ['membership_number']),
    ],
  }
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
    unknown_after_fields: sale.creation_unknown_fields,
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
  id?: string | null
  mutation_kind?: string | null
  request_json?: unknown
  before_json?: unknown
  after_json?: unknown
  generation?: number | null
  created_at?: string | null
  history_created_at?: string | null
  history_created_by_name?: string | null
}

export interface SaleRecordMutationReplayRow {
  operation_id: string
  audit_id: number | string
  action?: string | null
  user_name?: string | null
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
 * safe when there is no permanent amendment ledger entry. Product lines read
 * from sale_items are never creation evidence: product rename/merge syncing
 * rewrites their names without a sale amendment. Until an immutable creation
 * snapshot exists, `products: null` is the only honest answer.
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
  reconstructed.items = undefined
  reconstructed.creation_unknown_fields = [
    'products',
    'is_delivery',
    'customer_id',
    'membership_number',
    ...LEGACY_AMBIGUOUS_CREATION_FIELDS.filter((field) => !known[field]),
  ]
  return reconstructed
}

// ---------------------------------------------------------------------------
// Source 2: the amendment ledger.
// ---------------------------------------------------------------------------
export interface SaleRecordLedgerRow {
  id: number
  kind: string | null
  group_id?: string | null
  sale_item_id?: number | null
  product_id?: number | null
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
  before_json?: unknown
  after_json?: unknown
  user_name?: string | null
  created_at?: string | null
}

const LEDGER_KIND_TO_RECORD_KIND: Record<string, SaleRecordKind> = {
  line_added: 'item_added',
  line_removed: 'item_removed',
  line_quantity_increased: 'item_quantity_changed',
  line_quantity_decreased: 'item_quantity_changed',
  delivery_fee_changed: 'delivery_fee_changed',
  // Codex's 0129 named the LEDGER kind 'delivery_actual_cost_changed'. The
  // RECORD kind is the shorter 'delivery_cost_changed': the float's labels are
  // this vocabulary, and normalizing here is exactly what the mapping is for.
  delivery_actual_cost_changed: 'delivery_cost_changed',
  delivery_added: 'delivery_added',
}

/** "Delivery", as the subject of the two money kinds. */
const DELIVERY_SUBJECT = 'delivery'

export function ledgerRecord(row: SaleRecordLedgerRow): SaleRecord {
  const ledgerKind = String(row.kind || '')
  const kind = LEDGER_KIND_TO_RECORD_KIND[ledgerKind] || 'legacy_sale_change'
  if (ledgerKind === 'delivery_added') {
    const before = parseDetails(row.before_json)
    const after = parseDetails(row.after_json)
    return {
      id: `amendment:${row.id}`,
      source: 'ledger',
      at: text(row.created_at),
      at_ms: atMs(row.created_at),
      actor_username: text(row.user_name),
      kind,
      via: text(row.via) || 'amend',
      subject: text(after?.delivery_contact_name) || DELIVERY_SUBJECT,
      summary: 'Delivery added to sale',
      before,
      after,
    }
  }
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
  old_value?: unknown
  new_value?: unknown
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

  if (action === 'recover_missing_sale_items') {
    const beforeState = parseDetails(row.old_value)
    const afterState = parseDetails(row.new_value)
    const beforeCount = beforeState?.item_count
    const afterCount = afterState?.item_count
    if (beforeCount !== 0 || typeof afterCount !== 'number'
      || !Number.isSafeInteger(afterCount) || afterCount < 1) {
      return {
        ...base,
        kind: 'legacy_sale_change',
        subject: null,
        summary: 'Earlier sale change',
        before: null,
        after: null,
      }
    }
    const stockEffect = details.stock_effect === 'deducted_now' || details.stock_effect === 'released_allocation_only'
      ? details.stock_effect : null
    return {
      ...base,
      kind: 'sale_items_recovered',
      subject: null,
      summary: 'Sale items recovered',
      before: { item_count: beforeCount, stock_effect: null },
      after: { item_count: afterCount, ...(stockEffect ? { stock_effect: stockEffect } : {}) },
    }
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
      kind: 'legacy_sale_change',
      subject: text(details.applier),
      summary: 'Earlier sale change',
      before: null,
      after: null,
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
    kind: 'legacy_sale_change',
    subject: null,
    summary: 'Earlier sale change',
    before: null,
    after: null,
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

export function mutationRecords(
  row: SaleRecordMutationRow,
  replayRows: SaleRecordMutationReplayRow[] = [],
): SaleRecord[] {
  if (text(row.mutation_kind) !== 'settlement' || !text(row.id)) return []
  const before = parseDetails(row.before_json)
  const after = parseDetails(row.after_json)
  if (!before || !after) return []
  const request = parseDetails(row.request_json) || {}
  const paymentCorrection = request.replace_existing_payment === true
  const operationId = String(row.id)
  const originalAt = text(row.history_created_at) || text(row.created_at)
  const records: SaleRecord[] = [{
    id: `mutation:${operationId}:0`,
    source: 'mutation',
    at: originalAt,
    at_ms: atMs(originalAt),
    actor_username: text(row.history_created_by_name),
    kind: paymentCorrection ? 'payment_changed' : 'payment_settled',
    via: null,
    subject: null,
    summary: paymentCorrection ? 'Payment changed' : 'Payment settled',
    before,
    after,
  }]
  const generation = Math.max(0, Math.floor(numberOrNull(row.generation) || 0))
  const surviving = replayRows
    .filter((event) => event.operation_id === operationId && ['action_undo', 'action_redo'].includes(String(event.action || '')))
    .sort((left, right) => {
      const l = atMs(left.created_at) ?? Number.POSITIVE_INFINITY
      const r = atMs(right.created_at) ?? Number.POSITIVE_INFINITY
      return l - r || String(left.audit_id).localeCompare(String(right.audit_id))
    })
    .slice(-generation)
  const missing = Math.max(0, generation - surviving.length)
  for (let sequence = 1; sequence <= generation; sequence += 1) {
    const direction = sequence % 2 === 1 ? 'undo' : 'redo'
    const replay = sequence > missing ? surviving[sequence - missing - 1] : undefined
    const replayAt = text(replay?.created_at)
    records.push({
      id: `mutation:${operationId}:${sequence}`,
      source: 'mutation',
      at: replayAt,
      at_ms: atMs(replayAt),
      actor_username: text(replay?.user_name),
      kind: paymentCorrection ? 'payment_changed' : 'payment_settled',
      via: direction,
      subject: null,
      summary: direction === 'undo' ? 'Payment change undone' : 'Payment change redone',
      provenance_unknown: !replay,
      before: direction === 'undo' ? after : before,
      after: direction === 'undo' ? before : after,
    })
  }
  return records
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
  generation?: number | null
}

export interface SaleRecordBulkReplayRow {
  operation_id: string
  audit_id: number | string
  action?: string | null
  user_name?: string | null
  created_at?: string | null
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
    : action === 'delivery_contact' ? 'driver_changed'
    : action === 'payment_method' ? 'payment_changed'
    : 'legacy_sale_change'

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
  details?: unknown
  user_name?: string | null
  created_at?: string | null
  return_number?: string | null
  /** Total replay count retained on return_bulk_operations. */
  generation?: number | null
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
    kind: 'legacy_sale_change',
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
    kind: 'legacy_sale_change',
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
  if (action === 'action_undo' || action === 'action_redo') {
    const details = parseDetails(row.details)
    if (text(details?.kind) !== 'return.fields.bulk') return null
  }
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

function state(value: unknown, unknown = false): SaleRecordValueState {
  if (unknown) return { state: 'unknown' }
  return value === null || value === undefined
    ? { state: 'known_none' }
    : { state: 'known_value', value }
}

export function bulkRecords(
  row: SaleRecordBulkRow,
  saleId: number | string,
  replayRows: SaleRecordBulkReplayRow[] = [],
): SaleRecord[] {
  const original = bulkRecord(row, saleId)
  const generation = Math.max(0, Math.floor(numberOrNull(row.generation) || 0))
  const surviving = replayRows
    .filter((event) => event.operation_id === row.operation_id && ['action_undo', 'action_redo'].includes(String(event.action || '')))
    .sort((left, right) => (atMs(left.created_at) ?? Number.POSITIVE_INFINITY) - (atMs(right.created_at) ?? Number.POSITIVE_INFINITY))
    .slice(-generation)
  const missing = Math.max(0, generation - surviving.length)
  const records = [original]
  for (let sequence = 1; sequence <= generation; sequence += 1) {
    const direction = sequence % 2 === 1 ? 'undo' : 'redo'
    const replay = sequence > missing ? surviving[sequence - missing - 1] : undefined
    const replayAt = text(replay?.created_at)
    records.push({
      ...original,
      id: `bulk:${row.operation_id}:${sequence}`,
      at: replayAt,
      at_ms: atMs(replayAt),
      actor_username: text(replay?.user_name),
      via: direction,
      summary: direction === 'undo' ? `${original.summary} undone` : `${original.summary} redone`,
      provenance_unknown: !replay,
      before: direction === 'undo' ? original.after : original.before,
      after: direction === 'undo' ? original.before : original.after,
    })
  }
  return records
}

function statesEqual(left: SaleRecordValueState, right: SaleRecordValueState): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function fieldState(record: SaleRecord, side: 'before' | 'after', field: string): SaleRecordValueState {
  const unknown = (side === 'before' ? record.unknown_before_fields : record.unknown_after_fields) || []
  const snapshot = record[side]
  return state(snapshot ? snapshot[field] : null, unknown.includes(field))
}

function compositeState(
  record: SaleRecord,
  side: 'before' | 'after',
  fields: string[],
  build: (snapshot: Record<string, unknown>) => unknown,
): SaleRecordValueState {
  const unknown = (side === 'before' ? record.unknown_before_fields : record.unknown_after_fields) || []
  if (fields.some((field) => unknown.includes(field))) return { state: 'unknown' }
  const snapshot = record[side]
  if (!snapshot) return { state: 'known_none' }
  return state(build(snapshot))
}

function addChange(
  changes: SaleRecordChange[],
  field: SaleRecordField,
  before: SaleRecordValueState,
  after: SaleRecordValueState,
  force = false,
): void {
  if (force || !statesEqual(before, after)) changes.push({ field, before, after })
}

function paymentValue(snapshot: Record<string, unknown>): Record<string, unknown> | null {
  const value = {
    method: text(snapshot.payment_method),
    details: parsePaymentDetails(snapshot.payment_details),
    amount_paid_usd: numberOrNull(snapshot.amount_paid_usd),
    amount_paid_khr: numberOrNull(snapshot.amount_paid_khr),
    change_usd: numberOrNull(snapshot.change_usd),
    change_khr: numberOrNull(snapshot.change_khr),
  }
  return Object.values(value).some((entry) => entry !== null) ? value : null
}

function driverValue(snapshot: Record<string, unknown>): Record<string, unknown> | null {
  const id = numberOrNull(snapshot.delivery_contact_id)
  const name = text(snapshot.delivery_contact_name)
  const phone = text(snapshot.delivery_contact_phone)
  const address = text(snapshot.delivery_contact_address)
  return id === null && name === null && phone === null && address === null
    ? null : { id, name, phone, address }
}

function customerValue(snapshot: Record<string, unknown>): Record<string, unknown> | null {
  const id = numberOrNull(snapshot.customer_id)
  const name = text(snapshot.customer_name)
  return id === null ? null : { id, name }
}

function membershipValue(snapshot: Record<string, unknown>): Record<string, unknown> | null {
  const number = text(snapshot.membership_number ?? snapshot.customer_membership_number)
  const discountUsd = numberOrNull(snapshot.membership_discount_usd)
  const discountKhr = numberOrNull(snapshot.membership_discount_khr)
  const points = numberOrNull(snapshot.membership_points_redeemed)
  return number === null && discountUsd === null && discountKhr === null && points === null
    ? null : { number, discount_usd: discountUsd, discount_khr: discountKhr, points_redeemed: points }
}

function itemValue(record: SaleRecord, snapshot: Record<string, unknown>): Record<string, unknown> | null {
  const name = text(snapshot.product_name) || text(record.subject)
  const productId = numberOrNull(snapshot.product_id)
  const saleItemId = numberOrNull(snapshot.sale_item_id)
  const sku = text(snapshot.sku)
  const unitPrice = numberOrNull(snapshot.unit_price_usd)
  const lineTotal = numberOrNull(snapshot.line_total_usd)
  return name === null && productId === null && saleItemId === null
    ? null : { sale_item_id: saleItemId, product_id: productId, name, sku, unit_price_usd: unitPrice, line_total_usd: lineTotal }
}

function publicRecord(record: SaleRecord): SaleRecord {
  if (record.changes !== undefined) {
    const { before: _before, after: _after, unknown_before_fields: _ub, unknown_after_fields: _ua, ...publicFields } = record
    return publicFields
  }
  const changes: SaleRecordChange[] = []
  const beforeNone = state(null)
  const after = record.after || {}
  if (record.kind === 'sale_created') {
    for (const field of ['receipt_number', 'sale_status', 'products', 'total_usd'] as const) {
      const publicField = field === 'products' ? 'items' : field
      addChange(changes, publicField, beforeNone, fieldState(record, 'after', field), true)
    }
    addChange(changes, 'payment', beforeNone, compositeState(record, 'after', [
      'payment_method', 'payment_details', 'amount_paid_usd', 'amount_paid_khr', 'change_usd', 'change_khr',
    ], paymentValue), true)
    const deliveryUnknown = record.unknown_after_fields?.includes('is_delivery')
    const delivery = deliveryUnknown ? state(null, true)
      : Number(after.is_delivery) === 0 || after.is_delivery === false ? state(null)
        : state({
          is_delivery: true,
          driver: driverValue(after),
          delivery_fee_usd: numberOrNull(after.delivery_fee_usd),
          actual_delivery_cost_usd: numberOrNull(after.delivery_actual_cost_usd),
        })
    addChange(changes, 'delivery', beforeNone, delivery, true)
    addChange(changes, 'customer', beforeNone,
      compositeState(record, 'after', ['customer_id'], customerValue), true)
    addChange(changes, 'membership', beforeNone,
      compositeState(record, 'after', ['membership_number'], membershipValue), true)
  } else if (record.kind === 'item_added' || record.kind === 'item_removed' || record.kind === 'item_quantity_changed') {
    addChange(changes, 'item',
      compositeState(record, 'before', ['product_name'], (snapshot) => itemValue(record, snapshot)),
      compositeState(record, 'after', ['product_name'], (snapshot) => itemValue(record, snapshot)), true)
    addChange(changes, 'quantity', fieldState(record, 'before', 'quantity'), fieldState(record, 'after', 'quantity'))
    addChange(changes, 'total_usd', fieldState(record, 'before', 'total_usd'), fieldState(record, 'after', 'total_usd'))
  } else if (record.kind === 'items_replaced') {
    for (const field of ['removed_items', 'added_items', 'total_usd'] as const) {
      addChange(changes, field, fieldState(record, 'before', field), fieldState(record, 'after', field))
    }
  } else if (record.kind === 'delivery_fee_changed') {
    addChange(changes, 'delivery_fee_usd', fieldState(record, 'before', 'amount_usd'), fieldState(record, 'after', 'amount_usd'))
    addChange(changes, 'total_usd', fieldState(record, 'before', 'total_usd'), fieldState(record, 'after', 'total_usd'))
  } else if (record.kind === 'delivery_cost_changed') {
    addChange(changes, 'actual_delivery_cost_usd', fieldState(record, 'before', 'amount_usd'), fieldState(record, 'after', 'amount_usd'))
  } else if (record.kind === 'delivery_added') {
    addChange(changes, 'is_delivery', fieldState(record, 'before', 'is_delivery'), fieldState(record, 'after', 'is_delivery'))
    addChange(changes, 'driver', compositeState(record, 'before', ['delivery_contact_id'], driverValue), compositeState(record, 'after', ['delivery_contact_id'], driverValue))
    addChange(changes, 'delivery_fee_usd', fieldState(record, 'before', 'delivery_fee_usd'), fieldState(record, 'after', 'delivery_fee_usd'))
    addChange(changes, 'actual_delivery_cost_usd', fieldState(record, 'before', 'delivery_actual_cost_usd'), fieldState(record, 'after', 'delivery_actual_cost_usd'))
    addChange(changes, 'total_usd', fieldState(record, 'before', 'total_usd'), fieldState(record, 'after', 'total_usd'))
  } else if (record.kind === 'driver_changed') {
    addChange(changes, 'driver', compositeState(record, 'before', ['delivery_contact_id'], driverValue), compositeState(record, 'after', ['delivery_contact_id'], driverValue))
  } else if (record.kind === 'customer_changed') {
    addChange(changes, 'customer', compositeState(record, 'before', ['customer_id'], customerValue), compositeState(record, 'after', ['customer_id'], customerValue), true)
    addChange(changes, 'membership', compositeState(record, 'before', ['membership_number'], membershipValue), compositeState(record, 'after', ['membership_number'], membershipValue), true)
  } else if (record.kind === 'membership_changed') {
    addChange(changes, 'membership', compositeState(record, 'before', ['membership_number'], membershipValue), compositeState(record, 'after', ['membership_number'], membershipValue), true)
  } else if (record.kind === 'payment_changed' || record.kind === 'payment_settled') {
    for (const field of ['payment_method', 'payment_details', 'amount_paid_usd', 'amount_paid_khr', 'change_usd', 'change_khr', 'sale_status'] as const) {
      addChange(changes, field, fieldState(record, 'before', field), fieldState(record, 'after', field))
    }
  } else if (record.kind === 'cancelled') {
    for (const field of ['sale_status', 'cancel_reason', 'cancel_note'] as const) {
      addChange(changes, field, fieldState(record, 'before', field), fieldState(record, 'after', field))
    }
  } else if (record.kind === 'status_changed') {
    addChange(changes, 'sale_status', fieldState(record, 'before', 'sale_status'), fieldState(record, 'after', 'sale_status'))
  } else if (record.kind === 'sale_items_recovered') {
    addChange(changes, 'item_count', fieldState(record, 'before', 'item_count'), fieldState(record, 'after', 'item_count'), true)
    if (record.after && (record.after.stock_effect === 'deducted_now' || record.after.stock_effect === 'released_allocation_only')) {
      addChange(changes, 'stock_effect', fieldState(record, 'before', 'stock_effect'), fieldState(record, 'after', 'stock_effect'), true)
    }
  }
  const { before: _before, after: _after, unknown_before_fields: _ub, unknown_after_fields: _ua, ...publicFields } = record
  return { ...publicFields, changes }
}

function replacementRecord(rows: SaleRecordLedgerRow[]): SaleRecord {
  const first = rows[0]
  const removed = rows.filter((row) => numberOrNull(row.quantity_before)! > numberOrNull(row.quantity_after)!)
  const added = rows.filter((row) => numberOrNull(row.quantity_after)! > numberOrNull(row.quantity_before)!)
  const item = (row: SaleRecordLedgerRow) => ({
    sale_item_id: row.sale_item_id ?? null,
    product_id: row.product_id ?? null,
    name: text(row.product_name),
    sku: null,
    quantity: Math.max(numberOrNull(row.quantity_before) || 0, numberOrNull(row.quantity_after) || 0),
    unit_price_usd: null,
    line_total_usd: null,
  })
  return {
    id: `amendment-group:${first.group_id}:${text(first.via) || 'amend'}`,
    source: 'ledger',
    at: text(first.created_at),
    at_ms: atMs(first.created_at),
    actor_username: text(first.user_name),
    kind: 'items_replaced',
    via: text(first.via) || 'amend',
    subject: null,
    summary: 'Items replaced',
    before: { removed_items: removed.map(item), added_items: null, total_usd: numberOrNull(first.total_before_usd) },
    after: { removed_items: null, added_items: added.map(item), total_usd: numberOrNull(rows[rows.length - 1].total_after_usd) },
  }
}

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
  events?: SaleRecordEventRow[]
  ledger?: SaleRecordLedgerRow[]
  audit?: SaleRecordAuditRow[]
  bulk?: SaleRecordBulkRow[]
  bulkReplays?: SaleRecordBulkReplayRow[]
  returns?: SaleRecordReturnRow[]
  returnAudit?: SaleRecordReturnAuditRow[]
  returnBulk?: SaleRecordReturnBulkEventRow[]
  mutations?: SaleRecordMutationRow[]
  mutationReplays?: SaleRecordMutationReplayRow[]
}): SaleRecord[] {
  const creationSnapshot = parseSaleCreationSnapshot(input.sale.creation_snapshot_json)
  const records: SaleRecord[] = [creationSnapshot
    ? saleCreatedRecordFromSnapshot(input.sale, creationSnapshot)
    : saleCreatedRecord(reconstructSaleCreation(input))]
  const eventRows = (input.events || []).filter((row) => String(row.sale_id) === String(input.sale.id))
  const eventEntries = eventRows
    .map((row) => ({ row, record: saleRecordEventRecord(row) }))
    .filter((entry): entry is { row: SaleRecordEventRow; record: SaleRecord } => entry.record !== null)
  const eventKeys = new Set(eventEntries.map(({ row }) => provenanceKey({
    source_kind: String(row.source_kind), source_id: String(row.source_id),
    generation: Number(row.generation), sale_id: Number(row.sale_id),
  })))
  for (const entry of eventEntries) records.push(entry.record)
  const missingReturnBulkReplays: Array<{
    original: SaleRecord | null
    firstSurviving: SaleRecord | null
    records: SaleRecord[]
  }> = []
  const groupedLedgerIds = new Set<number>()
  const ledgerGroups = new Map<string, SaleRecordLedgerRow[]>()
  for (const row of input.ledger || []) {
    if (!text(row.group_id)) continue
    const key = `${row.group_id}:${text(row.via) || 'amend'}`
    const group = ledgerGroups.get(key) || []
    group.push(row)
    ledgerGroups.set(key, group)
  }
  for (const rows of ledgerGroups.values()) {
    const hasDecrease = rows.some((row) => (numberOrNull(row.quantity_before) || 0) > (numberOrNull(row.quantity_after) || 0))
    const hasIncrease = rows.some((row) => (numberOrNull(row.quantity_after) || 0) > (numberOrNull(row.quantity_before) || 0))
    if (rows.length > 1 && hasDecrease && hasIncrease) {
      rows.forEach((row) => groupedLedgerIds.add(row.id))
      records.push(replacementRecord(rows))
    }
  }
  for (const row of input.ledger || []) {
    if (!groupedLedgerIds.has(row.id)) records.push(ledgerRecord(row))
  }
  const explicitTransitionOperationIds = new Set((input.audit || []).flatMap((row) => {
    const action = String(row.action || '')
    const details = parseDetails(row.details) || {}
    const operationId = text(details.operationId)
    return operationId && ['sale_payment_correction_opened', 'sale_settlement'].includes(action)
      ? [operationId]
      : []
  }))
  const durableSettlementIds = new Set((input.mutations || [])
    .filter((row) => text(row.mutation_kind) === 'settlement' && text(row.id))
    .map((row) => String(row.id)))
  for (const row of input.audit || []) {
    const provenance = detailsProvenance(row.details)
    if (provenance && eventKeys.has(provenanceKey(provenance))) continue
    if (String(row.action || '') === 'sale_settlement') {
      const details = parseDetails(row.details) || {}
      if (durableSettlementIds.has(String(details.operationId || ''))) continue
    }
    if (String(row.action || '') === 'update') {
      const details = parseDetails(row.details) || {}
      const operationId = text(details.operationId)
      if (operationId && explicitTransitionOperationIds.has(operationId)) continue
    }
    const record = auditRecord(row)
    if (record) records.push(record)
  }
  for (const row of input.mutations || []) {
    mutationRecords(row, input.mutationReplays || []).forEach((record, generation) => {
      const key = provenanceKey({ source_kind: 'sale_settlement', source_id: String(row.id), generation, sale_id: Number(input.sale.id) })
      if (!eventKeys.has(key)) records.push(record)
    })
  }
  for (const row of input.bulk || []) {
    const request = parseDetails(row.request_json) || {}
    const sourceKind = text(request.target_status) ? 'sale_bulk_status' : 'sale_bulk_update'
    bulkRecords(row, input.sale.id, input.bulkReplays || []).forEach((record, generation) => {
      const key = provenanceKey({ source_kind: sourceKind, source_id: row.operation_id, generation, sale_id: Number(input.sale.id) })
      if (!eventKeys.has(key)) records.push(record)
    })
  }
  const creationAuditedReturnIds = new Set<string>()
  for (const row of input.returnAudit || []) {
    if (String(row.action || '') === 'create') creationAuditedReturnIds.add(String(row.return_id))
    const provenance = detailsProvenance(row.details)
    if (provenance && eventKeys.has(provenanceKey(provenance))) continue
    const record = returnAuditRecord(row)
    if (record) {
      records.push(record)
    }
  }
  for (const { row } of eventEntries) {
    if (row.source_kind === 'return_create' && String(row.source_id).startsWith('return:')) {
      creationAuditedReturnIds.add(String(row.source_id).slice('return:'.length))
    }
  }
  const returnBulkGroups = new Map<string, SaleRecordReturnBulkEventRow[]>()
  for (const row of input.returnBulk || []) {
    const key = `${row.operation_id}:${row.return_id}`
    const group = returnBulkGroups.get(key) || []
    group.push(row)
    returnBulkGroups.set(key, group)
  }
  for (const rows of returnBulkGroups.values()) {
    const emitted = rows
      .map((row) => ({ row, record: returnBulkEventRecord(row) }))
      .filter((entry): entry is { row: SaleRecordReturnBulkEventRow; record: SaleRecord } => entry.record !== null)
    for (const entry of emitted) {
      const provenance = detailsProvenance(entry.row.details)
      const generation = String(entry.row.action || '') === 'return_fields_bulk' ? 0 : provenance?.generation
      const key = generation === undefined ? null : provenanceKey({
        source_kind: 'return_bulk', source_id: entry.row.operation_id,
        generation, sale_id: Number(input.sale.id),
      })
      if (!key || !eventKeys.has(key)) records.push(entry.record)
    }

    const generation = Math.max(0, ...rows.map((row) => Math.floor(numberOrNull(row.generation) || 0)))
    const surviving = emitted.filter((entry) => ['action_undo', 'action_redo'].includes(String(entry.row.action || '')))
      .filter((entry) => {
        const provenance = detailsProvenance(entry.row.details)
        return !provenance || !eventKeys.has(provenanceKey(provenance))
      })
    const durableReplayGenerations = new Set(eventEntries
      .map((entry) => entry.row)
      .filter((row) => row.source_kind === 'return_bulk' && row.source_id === rows[0]?.operation_id
        && Number(row.generation) > 0 && Number(row.generation) <= generation)
      .map((row) => Number(row.generation)))
    const missingCount = Math.max(0, generation - durableReplayGenerations.size - surviving.length)
    const base = rows.find((row) => String(row.action || '') === 'return_fields_bulk') || rows[0]
    if (!base || missingCount === 0) continue
    const unknown: SaleRecord[] = []
    for (let replay = 1; replay <= missingCount; replay += 1) {
      const record = returnBulkEventRecord({
        ...base,
        audit_id: `missing:${replay}`,
        action: replay % 2 === 1 ? 'action_undo' : 'action_redo',
        details: { kind: 'return.fields.bulk' },
        user_name: null,
        created_at: null,
      })
      if (record) {
        record.summary = `${record.summary}; replay actor and time unavailable`
        record.provenance_unknown = true
        unknown.push(record)
      }
    }
    missingReturnBulkReplays.push({
      original: emitted.find((entry) => String(entry.row.action || '') === 'return_fields_bulk')?.record || null,
      firstSurviving: surviving[0]?.record || null,
      records: unknown,
    })
  }
  for (const row of input.returns || []) {
    if (returnTouchesSale(row) && !creationAuditedReturnIds.has(String(row.id))) records.push(legacyReturnRecord(row))
  }
  const ordered = orderSaleRecords(records)
  for (const missing of missingReturnBulkReplays) {
    const firstSurvivingIndex = missing.firstSurviving ? ordered.indexOf(missing.firstSurviving) : -1
    const originalIndex = missing.original ? ordered.indexOf(missing.original) : -1
    // Retention removes oldest rows first, so missing events form the known
    // prefix between the original act and the surviving replay suffix. Their
    // actor/time stay null; adjacency records only this proven sequence.
    const insertAt = firstSurvivingIndex >= 0 ? firstSurvivingIndex
      : originalIndex >= 0 ? originalIndex + 1
      : ordered.length
    ordered.splice(insertAt, 0, ...missing.records)
  }
  return ordered.map(publicRecord)
}

// ---------------------------------------------------------------------------
// The list-row count.
//
// The Sales list shows "Records n" on every row, so this must never be a query
// per sale. It is ONE statement over the whole page. Each source is a
// correlated scalar count so the query stays below D1's compound-SELECT term
// limit; the earlier six-arm UNION failed every Sales list request on D1.
// The caller adds the +1 every sale gets for its own creation.
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
    SELECT s.id AS sale_id,
      (SELECT COUNT(*) FROM sale_amendments sa
        WHERE sa.sale_id = s.id
          AND NOT (
            sa.group_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM sale_amendments dec
              WHERE dec.sale_id=sa.sale_id AND dec.group_id=sa.group_id
                AND COALESCE(dec.via,'amend')=COALESCE(sa.via,'amend')
                AND COALESCE(dec.quantity_before,0)>COALESCE(dec.quantity_after,0))
            AND EXISTS (SELECT 1 FROM sale_amendments inc
              WHERE inc.sale_id=sa.sale_id AND inc.group_id=sa.group_id
                AND COALESCE(inc.via,'amend')=COALESCE(sa.via,'amend')
                AND COALESCE(inc.quantity_after,0)>COALESCE(inc.quantity_before,0))
            AND sa.id<>(SELECT MIN(first.id) FROM sale_amendments first
              WHERE first.sale_id=sa.sale_id AND first.group_id=sa.group_id
                AND COALESCE(first.via,'amend')=COALESCE(sa.via,'amend'))
          ))
      + (SELECT COUNT(*) FROM audit_logs a
        WHERE a.entity = 'sale' AND a.entity_id = CAST(s.id AS TEXT)
          AND NOT EXISTS (
            SELECT 1 FROM sale_record_events sre
            WHERE json_valid(a.details)
              AND json_type(a.details,'$.record_event.source_kind')='text'
              AND json_type(a.details,'$.record_event.source_id')='text'
              AND json_type(a.details,'$.record_event.generation')='integer'
              AND json_type(a.details,'$.record_event.sale_id')='integer'
              AND sre.sale_id=s.id
              AND sre.source_kind=json_extract(a.details,'$.record_event.source_kind')
              AND sre.source_id=json_extract(a.details,'$.record_event.source_id')
              AND sre.generation=json_extract(a.details,'$.record_event.generation')
              AND sre.sale_id=json_extract(a.details,'$.record_event.sale_id')
          )
          AND COALESCE(CASE WHEN json_valid(a.details) THEN json_extract(a.details, '$.action') END, '') <> 'amend'
          AND NOT (a.action IN ('action_undo','action_redo')
                   AND CASE WHEN json_valid(a.details) THEN json_extract(a.details, '$.applier') END = 'sale.add_items')
          AND NOT (a.action='sale_settlement' AND json_valid(a.details) AND EXISTS (
            SELECT 1 FROM sale_mutation_receipts smr
            WHERE smr.sale_id=s.id AND smr.mutation_kind='settlement'
              AND smr.id=json_extract(a.details,'$.operationId')
          ))
          AND NOT (a.action = 'update' AND json_valid(a.details)
            AND COALESCE(json_extract(a.details, '$.operationId'), '') <> '' AND EXISTS (
            SELECT 1 FROM audit_logs explicit
            WHERE explicit.entity = a.entity
              AND explicit.entity_id = a.entity_id
              AND explicit.action IN ('sale_payment_correction_opened','sale_settlement')
              AND json_valid(explicit.details)
              AND json_extract(explicit.details, '$.operationId') = json_extract(a.details, '$.operationId')
          ))
      )
      + (SELECT COUNT(*) FROM sale_record_events sre WHERE sre.sale_id=s.id)
      + COALESCE((SELECT SUM(MAX(0, 1 + MAX(0, COALESCE(smr.generation,0)) - (
          SELECT COUNT(*) FROM sale_record_events sre
          WHERE sre.sale_id=s.id AND sre.source_kind='sale_settlement'
            AND sre.source_id=smr.id AND sre.generation BETWEEN 0 AND MAX(0,COALESCE(smr.generation,0))
        )))
        FROM sale_mutation_receipts smr
        WHERE smr.sale_id=s.id AND smr.mutation_kind='settlement'),0)
      + COALESCE((SELECT SUM(MAX(0, 1 + MAX(0, COALESCE(sbo.generation,0)) - (
          SELECT COUNT(*) FROM sale_record_events sre
          WHERE sre.sale_id=s.id
            AND sre.source_kind=CASE
              WHEN json_valid(sbo.request_json) AND json_extract(sbo.request_json,'$.target_status') IS NOT NULL
                THEN 'sale_bulk_status' ELSE 'sale_bulk_update' END
            AND sre.source_id=sbo.id AND sre.generation BETWEEN 0 AND MAX(0,COALESCE(sbo.generation,0))
        )))
        FROM sale_bulk_members sbm
        JOIN sale_bulk_operations sbo ON sbo.id=sbm.operation_id
        WHERE sbm.sale_id = s.id),0)
      + (SELECT COUNT(*) FROM returns
        WHERE sale_id = s.id
          AND COALESCE(return_scope, 'customer') = 'customer'
          AND NOT EXISTS (
            SELECT 1 FROM audit_logs ra
            WHERE ra.entity = 'return' AND ra.entity_id = CAST(returns.id AS TEXT)
              AND ra.action = 'create'
          )
          AND NOT EXISTS (
            SELECT 1 FROM sale_record_events sre
            WHERE sre.sale_id=s.id AND sre.source_kind='return_create'
              AND sre.source_id='return:' || CAST(returns.id AS TEXT) AND sre.generation=0
          )
      )
      + (SELECT COUNT(*) FROM audit_logs ra
        JOIN returns r ON ra.entity = 'return' AND ra.entity_id = CAST(r.id AS TEXT)
        WHERE r.sale_id = s.id
          AND COALESCE(r.return_scope, 'customer') = 'customer'
          AND ra.action IN ('create','update')
          AND NOT EXISTS (
            SELECT 1 FROM sale_record_events sre
            WHERE json_valid(ra.details)
              AND json_type(ra.details,'$.record_event.source_kind')='text'
              AND json_type(ra.details,'$.record_event.source_id')='text'
              AND json_type(ra.details,'$.record_event.generation')='integer'
              AND json_type(ra.details,'$.record_event.sale_id')='integer'
              AND sre.sale_id=s.id
              AND sre.source_kind=json_extract(ra.details,'$.record_event.source_kind')
              AND sre.source_id=json_extract(ra.details,'$.record_event.source_id')
              AND sre.generation=json_extract(ra.details,'$.record_event.generation')
              AND sre.sale_id=json_extract(ra.details,'$.record_event.sale_id')
          )
      )
      + COALESCE((SELECT SUM(MAX(0, 1 + MAX(0, COALESCE(ro.generation, 0)) - (
          SELECT COUNT(*) FROM sale_record_events sre
          WHERE sre.sale_id=s.id AND sre.source_kind='return_bulk'
            AND sre.source_id=ro.id AND sre.generation BETWEEN 0 AND MAX(0,COALESCE(ro.generation,0))
        )))
        FROM return_bulk_members m
        JOIN return_bulk_operations ro ON ro.id = m.operation_id
        JOIN action_history rh ON rh.id = ro.history_id
        WHERE m.sale_id = s.id
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
      ), 0) AS n
    FROM sales s
    WHERE s.id IN (${placeholders})
  `
}

/** How many `IN (...)` lists buildSaleRecordsCountSql binds each id into. */
export const SALE_RECORDS_COUNT_BINDS_PER_ID = 1

/**
 * The bind list for buildSaleRecordsCountSql. The sales driver is bound once;
 * correlated subqueries compare audit entity ids with CAST(s.id AS TEXT).
 */
export function saleRecordsCountBinds(ids: Array<number | string>): Array<number | string> {
  return [...ids]
}
