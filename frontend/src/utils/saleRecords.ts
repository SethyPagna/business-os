// Reading one sale's RECORDS list (N41) -- the browser half.
//
// The owner, Sep 6 2026: "one line called Records with total records when press
// it pops up a float with who made changes in this sales record ... and click
// on specific information/record row can see more details before and after."
//
// The Worker (GET /api/sales/:id/records, cloudflare/src/lib/saleRecords.ts)
// answers with a normalized, time-ordered union of every writer that changes a
// sale. This module is the reading half and holds exactly three decisions, all
// of them the kind that goes wrong quietly if it lives inside a component:
//
//   1. WHICH LABEL a kind gets. The kind vocabulary is closed on the server so
//      that every one of them has a translated label here; a kind with no
//      entry would print its raw snake_case identifier in Khmer, which is how
//      untranslated strings actually reach production.
//   2. HOW a before/after field is rendered. `amount_usd` is money,
//      `quantity` is a count, `sale_status` is a status whose name is
//      localized elsewhere, `customer_id` is an id. Rendering money as a bare
//      number ("2" for $2.00) in a list whose whole job is explaining a
//      corrected total is worse than showing nothing.
//   3. WHICH FIELDS a record actually changed. before/after arrive with the
//      same keys on both sides, and a row where the two are equal (the sale
//      total carried alongside a courier-cost correction that never touches
//      it) is context, not a change -- the detail marks it so, rather than
//      showing an arrow from a value to itself.
//
// Nothing here fetches, and nothing here formats a date: the float uses the
// app's fmtDateTime24, so a record reads dd/mm/yyyy HH:mm like every other
// timestamp in the app.

/** The closed set the Worker emits. Mirrors lib/saleRecords.ts's own list. */
export const SALE_RECORD_KINDS = [
  'sale_created',
  'driver_changed',
  'delivery_cost_changed',
  'delivery_fee_changed',
  'delivery_added',
  'item_added',
  'item_removed',
  'item_quantity_changed',
  'items_replaced',
  'customer_changed',
  'membership_changed',
  'status_changed',
  'payment_changed',
  'payment_settled',
  'cancelled',
  'sale_items_recovered',
  'sale_stock_corrected',
  'legacy_sale_change',
] as const

export type SaleRecordKind = (typeof SALE_RECORD_KINDS)[number]

export interface SaleRecord {
  id: string
  source?: string
  at?: string | null
  at_ms?: number | null
  actor_username?: string | null
  kind?: string | null
  via?: string | null
  subject?: string | null
  summary?: string | null
  provenance_unknown?: boolean
  changes?: SaleRecordChange[] | null
}

export type SaleRecordValue =
  | { state: 'known_value'; value: unknown }
  | { state: 'known_none' }
  | { state: 'unknown' }

export interface SaleRecordChange { field: string; before: SaleRecordValue; after: SaleRecordValue }

/**
 * Every kind's translation key. Exhaustive by construction: the Record type
 * makes a missing kind a compile error rather than a raw string in the UI.
 */
export const SALE_RECORD_KIND_KEYS: Record<SaleRecordKind, string> = {
  sale_created: 'record_kind_sale_created',
  driver_changed: 'record_kind_driver_changed',
  delivery_cost_changed: 'record_kind_delivery_cost_changed',
  delivery_fee_changed: 'record_kind_delivery_fee_changed',
  delivery_added: 'record_kind_delivery_added',
  item_added: 'record_kind_item_added',
  item_removed: 'record_kind_item_removed',
  item_quantity_changed: 'record_kind_item_quantity_changed',
  items_replaced: 'record_kind_items_replaced',
  customer_changed: 'record_kind_customer_changed',
  membership_changed: 'record_kind_membership_changed',
  status_changed: 'record_kind_status_changed',
  payment_changed: 'record_kind_payment_changed',
  payment_settled: 'record_kind_payment_settled',
  cancelled: 'record_kind_cancelled',
  sale_items_recovered: 'record_kind_sale_items_recovered',
  sale_stock_corrected: 'record_kind_sale_stock_corrected',
  legacy_sale_change: 'record_kind_legacy_sale_change',
}

/** A kind this build knows, or 'other' -- never a raw string in the UI. */
export function saleRecordKind(raw: unknown): SaleRecordKind {
  const value = String(raw ?? '')
  return (SALE_RECORD_KINDS as readonly string[]).includes(value) ? value as SaleRecordKind : 'legacy_sale_change'
}

/** How one before/after field should be rendered. */
export type SaleRecordFieldFormat = 'money' | 'money_khr' | 'quantity' | 'status' | 'boolean' | 'text'

/**
 * Field name -> how to render it, and what to call it.
 *
 * Keyed by the closed field names lib/saleRecords.ts emits. A malformed or
 * future field uses the translated generic change label; raw variable names
 * never become user-facing copy.
 */
export const SALE_RECORD_FIELD_RULES: Record<string, { key: string; format: SaleRecordFieldFormat }> = {
  amount_paid_usd: { key: 'amount_paid', format: 'money' },
  amount_paid_khr: { key: 'amount_paid_khr', format: 'money_khr' },
  change_usd: { key: 'change', format: 'money' },
  change_khr: { key: 'change_khr', format: 'money_khr' },
  total_usd: { key: 'total', format: 'money' },
  quantity: { key: 'quantity', format: 'quantity' },
  sale_status: { key: 'status', format: 'status' },
  receipt_number: { key: 'receipt_number', format: 'text' },
  cancel_reason: { key: 'reason', format: 'text' },
  cancel_note: { key: 'note', format: 'text' },
  payment_method: { key: 'payment_method', format: 'text' },
  payment_details: { key: 'payment_details', format: 'text' },
  is_delivery: { key: 'delivery', format: 'boolean' },
  delivery_fee_usd: { key: 'delivery_fee', format: 'money' },
  actual_delivery_cost_usd: { key: 'delivery_actual_cost', format: 'money' },
  customer: { key: 'customer', format: 'text' },
  membership: { key: 'membership', format: 'text' },
  driver: { key: 'driver', format: 'text' },
  item: { key: 'item', format: 'text' },
  items: { key: 'items', format: 'text' },
  removed_items: { key: 'removed_items', format: 'text' },
  added_items: { key: 'added_items', format: 'text' },
  item_count: { key: 'product_lines', format: 'quantity' },
  held_units: { key: 'held_units', format: 'quantity' },
  stock_effect: { key: 'recovery_stock_action', format: 'text' },
}

/** Recovery records are intentionally narrow: operational metadata is not a sale detail. */
const RECOVERED_SALE_ITEM_FIELDS = new Set(['item_count', 'stock_effect'])
const CORRECTED_SALE_STOCK_FIELDS = new Set(['held_units', 'stock_effect'])

export interface SaleRecordFieldRow {
  field: string
  /** Translation key for the field's label, or null to print `field` itself. */
  labelKey: string | null
  format: SaleRecordFieldFormat
  before: SaleRecordValue
  after: SaleRecordValue
  /** False when the two sides are the same value -- context, not a change. */
  changed: boolean
}

function normalizeValueState(value: unknown): SaleRecordValue | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (row.state === 'known_none') return { state: 'known_none' }
  if (row.state === 'unknown') return { state: 'unknown' }
  if (row.state === 'known_value' && Object.prototype.hasOwnProperty.call(row, 'value')) {
    return { state: 'known_value', value: row.value }
  }
  return null
}

function statesEqual(left: SaleRecordValue, right: SaleRecordValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * The before -> after rows for one record, in a stable order.
 *
 * Order is the server's `changes` order. Equal pairs are rejected as context,
 * except the fixed sale-creation field set where known absence is itself a
 * captured fact required by the contract.
 */
export function saleRecordFieldRows(record: SaleRecord): SaleRecordFieldRow[] {
  if (!Array.isArray(record.changes)) return []
  return record.changes.flatMap((change) => {
    if (!change || typeof change.field !== 'string') return []
    if (record.kind === 'sale_items_recovered' && !RECOVERED_SALE_ITEM_FIELDS.has(change.field)) return []
    if (record.kind === 'sale_stock_corrected' && !CORRECTED_SALE_STOCK_FIELDS.has(change.field)) return []
    const before = normalizeValueState(change.before)
    const after = normalizeValueState(change.after)
    if (!before || !after || (statesEqual(before, after) && record.kind !== 'sale_created')) return []
    const rule = SALE_RECORD_FIELD_RULES[change.field] || { key: 'value_changed', format: 'text' as const }
    return [{ field: change.field, labelKey: rule.key, format: rule.format, before, after, changed: true }]
  })
}

/** True when this record has anything to expand. */
export function saleRecordHasDetail(record: SaleRecord): boolean {
  return saleRecordFieldRows(record).length > 0
}

/**
 * The kinds actually present, with counts, in the closed set's order.
 *
 * The float's filter offers only kinds this sale HAS. A menu listing all
 * fourteen against a sale with two records is a wall of choices that each
 * empty the list, and the owner asked for the filter to narrow what is there
 * ("or + for matching conditions"), not to enumerate the vocabulary.
 */
export function saleRecordKindCounts(records: SaleRecord[]): Array<{ kind: SaleRecordKind; count: number }> {
  const counts = new Map<SaleRecordKind, number>()
  for (const record of records) {
    const kind = saleRecordKind(record.kind)
    counts.set(kind, (counts.get(kind) || 0) + 1)
  }
  return SALE_RECORD_KINDS
    .filter((kind) => counts.has(kind))
    .map((kind) => ({ kind, count: counts.get(kind) || 0 }))
}

/**
 * Narrow by kind. An EMPTY selection means "all", not "none" -- clearing the
 * filter is how someone gets back to the default list, and answering it with
 * an empty float would read as "this sale has no records".
 */
export function filterSaleRecords(records: SaleRecord[], kinds: ReadonlySet<string>): SaleRecord[] {
  if (!kinds || kinds.size === 0) return records
  return records.filter((record) => kinds.has(saleRecordKind(record.kind)))
}

/** The list rows' badge count, from whatever the list query returned. */
export function saleRecordsCount(sale: { records_count?: unknown } | null | undefined): number | null {
  const raw = sale?.records_count
  if (raw === null || raw === undefined || raw === '') return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null
}

/** The records array out of whatever GET /api/sales/:id/records returned. */
export function normalizeSaleRecordsResponse(payload: unknown): SaleRecord[] {
  const body = (payload || {}) as { records?: unknown }
  const rows = Array.isArray(body.records) ? body.records : Array.isArray(payload) ? payload : []
  return rows
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row, index) => ({
      ...(row as unknown as SaleRecord),
      // A record with no id cannot be selected or keyed. Falling back to the
      // index keeps a malformed row visible instead of collapsing the list.
      id: String(row.id ?? `record-${index}`),
    }))
}
