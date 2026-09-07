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
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
}

/**
 * Every kind's translation key. Exhaustive by construction: the Record type
 * makes a missing kind a compile error rather than a raw string in the UI.
 */
export const SALE_RECORD_KIND_KEYS: Record<SaleRecordKind, string> = {
  sale_created: 'record_kind_sale_created',
  status_changed: 'record_kind_status_changed',
  item_added: 'record_kind_item_added',
  item_removed: 'record_kind_item_removed',
  item_qty_changed: 'record_kind_item_qty_changed',
  item_price_changed: 'record_kind_item_price_changed',
  delivery_fee_changed: 'record_kind_delivery_fee_changed',
  delivery_cost_changed: 'record_kind_delivery_cost_changed',
  discount_changed: 'record_kind_discount_changed',
  customer_changed: 'record_kind_customer_changed',
  payment_settled: 'record_kind_payment_settled',
  cancelled: 'record_kind_cancelled',
  undone: 'record_kind_undone',
  other: 'record_kind_other',
}

/** A kind this build knows, or 'other' -- never a raw string in the UI. */
export function saleRecordKind(raw: unknown): SaleRecordKind {
  const value = String(raw ?? '')
  return (SALE_RECORD_KINDS as readonly string[]).includes(value) ? value as SaleRecordKind : 'other'
}

/** How one before/after field should be rendered. */
export type SaleRecordFieldFormat = 'money' | 'quantity' | 'status' | 'text'

/**
 * Field name -> how to render it, and what to call it.
 *
 * Keyed by the field names lib/saleRecords.ts actually emits. Anything else
 * falls through to plain text under its own raw name, which is the honest
 * answer for a payload written by a future writer this build predates.
 */
const FIELD_RULES: Record<string, { key: string; format: SaleRecordFieldFormat }> = {
  amount_usd: { key: 'amount', format: 'money' },
  total_usd: { key: 'total', format: 'money' },
  quantity: { key: 'quantity', format: 'quantity' },
  sale_status: { key: 'status', format: 'status' },
  // The returns source's own field: what the customer got back. Money, and
  // named -- 'refund_usd' printed as its own raw key is exactly the
  // snake_case-in-Khmer failure this table exists to prevent.
  refund_usd: { key: 'refund', format: 'money' },
  receipt_number: { key: 'receipt_number', format: 'text' },
  customer_id: { key: 'customer', format: 'text' },
  membership_number: { key: 'membership_number', format: 'text' },
  cancel_reason: { key: 'reason', format: 'text' },
  cancel_note: { key: 'note', format: 'text' },
  payment_method: { key: 'payment_method', format: 'text' },
  direction: { key: 'action', format: 'text' },
  stock_skipped: { key: 'stock', format: 'text' },
}

export interface SaleRecordFieldRow {
  field: string
  /** Translation key for the field's label, or null to print `field` itself. */
  labelKey: string | null
  format: SaleRecordFieldFormat
  before: unknown
  after: unknown
  /** False when the two sides are the same value -- context, not a change. */
  changed: boolean
}

function normalizeForCompare(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value).trim()
}

/**
 * The before -> after rows for one record, in a stable order.
 *
 * Order is the order the fields appear in the payload (after's keys first,
 * since a record is about what it became), because that order is chosen
 * server-side per kind and putting the amount before the running total is a
 * deliberate part of it. Fields present on only one side still get a row: a
 * value appearing from nothing, or vanishing, is exactly the change somebody
 * opened this to see.
 */
export function saleRecordFieldRows(record: SaleRecord): SaleRecordFieldRow[] {
  const before = record.before && typeof record.before === 'object' ? record.before : {}
  const after = record.after && typeof record.after === 'object' ? record.after : {}
  const fields: string[] = []
  for (const key of Object.keys(after)) fields.push(key)
  for (const key of Object.keys(before)) if (!fields.includes(key)) fields.push(key)
  return fields.map((field) => {
    const rule = FIELD_RULES[field]
    return {
      field,
      labelKey: rule ? rule.key : null,
      format: rule ? rule.format : 'text',
      before: (before as Record<string, unknown>)[field],
      after: (after as Record<string, unknown>)[field],
      changed: normalizeForCompare((before as Record<string, unknown>)[field]) !== normalizeForCompare((after as Record<string, unknown>)[field]),
    }
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
