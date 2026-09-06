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
//   sales.created_at          the sale itself. Nothing audits a sale's own
//                             creation, so it is synthesized from the row --
//                             which is also why "Records" is never 0: a sale
//                             always has at least the fact that it happened.
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
//    via 'undo'. `undone` is reserved for the replays that write no ledger entry
//    of their own (the settlement applier's action_undo / action_redo rows).
//
// WHAT IS NOT IN THE LIST, and why -- named rather than left silent:
//
//   returns          A return is its own record with its own screen, and it
//                    does not change the sale row; the sale detail already
//                    shows "Refunded by returns". Folding them in here would
//                    make one refund show up in two ledgers.
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

export type SaleRecordSource = 'sale' | 'ledger' | 'audit' | 'bulk'

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
  /** 'amend' | 'undo' | 'redo' for ledger entries; null everywhere else. */
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
  total_usd?: unknown
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
      total_usd: numberOrNull(sale.total_usd),
    },
  }
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
 * Classify one audit row, or return null when it must not appear.
 *
 * The ONE suppression: `details.action === 'amend'`. Every amendment writes a
 * ledger entry AND this row; showing both would report one correction twice.
 */
export function auditRecord(row: SaleRecordAuditRow): SaleRecord | null {
  const details = parseDetails(row.details) || {}
  if (text(details.action) === 'amend') return null

  const action = String(row.action || '')
  const at = text(row.created_at)
  const base = {
    id: `audit:${row.id}`,
    source: 'audit' as const,
    at,
    at_ms: atMs(at),
    actor_username: text(row.user_name),
    via: null,
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
}): SaleRecord[] {
  const records: SaleRecord[] = [saleCreatedRecord(input.sale)]
  for (const row of input.ledger || []) records.push(ledgerRecord(row))
  for (const row of input.audit || []) {
    const record = auditRecord(row)
    if (record) records.push(record)
  }
  for (const row of input.bulk || []) records.push(bulkRecord(row, input.sale.id))
  return orderSaleRecords(records)
}

// ---------------------------------------------------------------------------
// The list-row count.
//
// The Sales list shows "Records n" on every row, so this must never be a query
// per sale. It is ONE statement over the whole page: three grouped counts
// UNIONed and re-summed, plus the +1 every sale gets for its own creation.
//
// The audit half applies the SAME suppression the detail read applies -- an
// `action: 'amend'` row is the ledger entry's twin -- or the count on the row
// would be larger than the list inside the float, which is precisely the kind
// of quiet disagreement that makes a number untrustworthy.
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
      SELECT CAST(entity_id AS INTEGER) AS sale_id, COUNT(*) AS n
        FROM audit_logs
        WHERE entity = 'sale' AND entity_id IN (${placeholders})
          AND COALESCE(json_extract(details, '$.action'), '') <> 'amend'
        GROUP BY entity_id
      UNION ALL
      SELECT sale_id AS sale_id, COUNT(*) AS n
        FROM sale_bulk_members WHERE sale_id IN (${placeholders}) GROUP BY sale_id
    )
    GROUP BY sale_id
  `
}

/** How many `IN (...)` lists buildSaleRecordsCountSql binds each id into. */
export const SALE_RECORDS_COUNT_BINDS_PER_ID = 3

/**
 * The bind list for buildSaleRecordsCountSql, in statement order: the ledger's
 * INTEGER ids, then the audit table's TEXT ids, then the bulk table's INTEGER
 * ids. See the note above for why the middle list is stringified.
 */
export function saleRecordsCountBinds(ids: Array<number | string>): Array<number | string> {
  return [...ids, ...ids.map((id) => String(id)), ...ids]
}
