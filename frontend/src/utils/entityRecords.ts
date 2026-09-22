// The record model every RECORDS float shares, and the adapter for the ones
// whose history is plain audit rows (a product, a customer, a supplier, a
// delivery contact).
//
// The owner, Sep 22 2026: "having records in sales, returns, stock changes,
// products, invoices, etc... make sure these records are having them there as
// well as in the actual audit log, all + filters + sections etc... like sales
// do before and after, by who etc... Compact rows, press to open etc..."
//
// One shape, one float, one change table. The sale's list is built by a closed
// Worker vocabulary (utils/saleRecords.ts) because a sale is changed by six
// different writers; a return's comes from its own endpoint; a product's and a
// contact's are audit rows read straight from GET /system/audit-logs. What
// differs between them is only HOW a row is labelled and formatted, so that is
// the whole of the adapter interface below -- everything else (loading,
// filtering by kind, press-to-open, the Field | Before | After table) is the
// one component in components/shared/RecordsFloat.tsx.
//
// The before/after values here are the ones the Audit Log page already shows:
// buildAuditFieldDiff is REUSED rather than reimplemented, so a product's
// Field history and its row in the Audit Log can never describe the same edit
// two different ways.

import type { ReactNode } from 'react'
import { buildAuditFieldDiff, formatAuditFieldLabel } from './auditLogFieldDiff.ts'
import { auditActionLabel, type LabelFn } from './auditVocabulary.ts'

export type RecordValue =
  | { state: 'known_value'; value: unknown }
  | { state: 'known_none' }
  | { state: 'unknown' }

export interface RecordChange {
  field: string
  before: RecordValue
  after: RecordValue
}

/** One row of a records list. The Worker emits exactly this shape. */
export interface RecordItem {
  id: string
  at?: string | null
  actor_username?: string | null
  /** Present only where the row genuinely carries a branch; never inferred. */
  branch_name?: string | null
  kind?: string | null
  via?: string | null
  subject?: string | null
  provenance_unknown?: boolean
  changes?: RecordChange[] | null
}

/** One rendered line of the expanded Field | Before | After table. */
export interface RecordTableRow {
  key: string
  label: string
  before: ReactNode
  after: ReactNode
}

export interface RecordRenderContext {
  /** `(packKey, englishFallback) => translated`. */
  label: LabelFn
  t: (key: string) => string
  fmtUSD: (value: number | string) => string
  fmtKHR: (value: number | string) => string
}

/**
 * What one family of records calls its kinds and how it renders a value.
 *
 * Deliberately three functions and no data: the sale's rules are a closed
 * field->format table, a product's are "whatever column the route wrote", and
 * an interface that tried to express both as data would express neither well.
 */
export interface RecordsAdapter {
  /** Raw kind -> the kind this build knows. Never returns a raw identifier. */
  normalizeKind: (raw: unknown) => string
  /** The kind's label, in the reader's language. */
  kindLabel: (kind: string, ctx: RecordRenderContext) => string
  /** The before -> after rows of one record, already formatted. */
  fieldRows: (record: RecordItem, ctx: RecordRenderContext) => RecordTableRow[]
}

/**
 * The records array out of whatever a records endpoint returned.
 *
 * A record with no id cannot be selected or keyed, so the index is the
 * fallback: a malformed row stays visible instead of collapsing the list.
 */
export function normalizeRecordsResponse(payload: unknown): RecordItem[] {
  const body = (payload || {}) as { records?: unknown }
  const rows = Array.isArray(body.records) ? body.records : Array.isArray(payload) ? payload : []
  return rows
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row, index) => ({
      ...(row as unknown as RecordItem),
      id: String(row.id ?? `record-${index}`),
    }))
}

/** The kinds actually present, with counts, in first-seen order. */
export function recordKindCounts(records: RecordItem[], adapter: RecordsAdapter): Array<{ kind: string; count: number }> {
  const counts = new Map<string, number>()
  for (const record of records) {
    const kind = adapter.normalizeKind(record.kind)
    counts.set(kind, (counts.get(kind) || 0) + 1)
  }
  return [...counts.entries()].map(([kind, count]) => ({ kind, count }))
}

/**
 * Narrow by kind. An EMPTY selection means "all", not "none" -- clearing the
 * filter is how someone gets back to the default list, and answering it with
 * an empty float would read as "this record has no history".
 */
export function filterRecords(records: RecordItem[], kinds: ReadonlySet<string>, adapter: RecordsAdapter): RecordItem[] {
  if (!kinds || kinds.size === 0) return records
  return records.filter((record) => kinds.has(adapter.normalizeKind(record.kind)))
}

// ---------------------------------------------------------------------------
// Audit rows -> records (products, contacts, and anything else whose history
// is the audit trail itself).
// ---------------------------------------------------------------------------

export interface AuditRecordRow {
  id?: string | number | null
  action?: string | null
  entity?: string | null
  table_name?: string | null
  user_name?: string | null
  created_at?: string | null
  client_time?: string | null
  details?: string | null
  old_value?: string | null
  new_value?: string | null
}

function parseDetails(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function epoch(raw: unknown): number {
  const value = String(raw || '').trim()
  if (!value) return 0
  const parsed = Date.parse(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Audit rows as records, oldest first.
 *
 * `created_at` is the server's own clock and is what orders the list; the
 * device-supplied client_time is not used for ordering, for the same reason
 * lib/auditLogQuery.ts filters on server truth.
 *
 * A row with no before/after pair is still a record: "who deleted this, and
 * when" is a question this float exists to answer, and dropping the row for
 * having no diff would answer it with silence.
 */
export function auditRowsToRecords(rows: AuditRecordRow[] | null | undefined): RecordItem[] {
  const list = Array.isArray(rows) ? rows : []
  return list
    .map((row) => {
      const changes: RecordChange[] = buildAuditFieldDiff(row.old_value, row.new_value).map((diff) => ({
        field: diff.key,
        before: diff.before === null ? { state: 'known_none' as const } : { state: 'known_value' as const, value: diff.before },
        after: diff.after === null ? { state: 'known_none' as const } : { state: 'known_value' as const, value: diff.after },
      }))
      // The reason the operator typed lives in `details`, never in the field
      // pair (the pair diffs COLUMNS). It is the single most-asked-for line on
      // an edit, so it gets its own row rather than staying inside a payload
      // nobody opens. Same rule the returns endpoint applies server-side.
      const reason = parseDetails(row.details)?.reason
      if (typeof reason === 'string' && reason.trim() && !changes.some((change) => change.field === 'reason')) {
        changes.push({ field: 'reason', before: { state: 'unknown' }, after: { state: 'known_value', value: reason.trim() } })
      }
      const action = String(row.action || '').toLowerCase()
      return {
        id: `audit:${row.id ?? ''}`,
        at: row.created_at || null,
        actor_username: row.user_name || null,
        // audit_logs has no branch column, so an audit-sourced record never
        // claims one. Inventing the reader's own branch would be a different,
        // unverifiable answer to "where did this happen".
        branch_name: null,
        kind: action,
        via: action === 'action_undo' ? 'undo' : action === 'action_redo' ? 'redo' : null,
        subject: null,
        changes,
      }
    })
    .sort((left, right) => epoch(left.at) - epoch(right.at))
}

/**
 * The adapter for audit-sourced records.
 *
 * Labels come from the SHARED audit vocabulary, so a product's Field history
 * and the Audit Log page name the same action the same way in both packs. A
 * field name is a database column, which no pack can enumerate, so it falls
 * back to the readable Title Case the Audit Log's own diff view already uses.
 */
export const ENTITY_RECORDS_ADAPTER: RecordsAdapter = {
  normalizeKind: (raw) => String(raw ?? '').toLowerCase().trim() || 'update',
  kindLabel: (kind, ctx) => auditActionLabel(kind, ctx.label) || ctx.label('record_kind_other', 'Other change'),
  fieldRows: (record, ctx) => (Array.isArray(record.changes) ? record.changes : []).map((change) => ({
    key: change.field,
    label: entityFieldLabel(change.field, ctx.label),
    before: renderEntityValue(change.before, ctx),
    after: renderEntityValue(change.after, ctx),
  })),
}

/**
 * A column's label. The pack owns the words a person actually reads on a form
 * (price, barcode, phone, ...); anything else is a column name, and a readable
 * Title Case beats a key nobody translated.
 */
const ENTITY_FIELD_LABEL_KEYS: Record<string, [string, string]> = {
  name: ['name', 'Name'],
  barcode: ['barcode', 'Barcode'],
  category: ['category', 'Category'],
  brand: ['brand', 'Brand'],
  unit: ['unit', 'Unit'],
  description: ['description', 'Description'],
  image_path: ['image', 'Image'],
  is_active: ['active', 'Active'],
  phone: ['phone', 'Phone'],
  email: ['email', 'Email'],
  address: ['address', 'Address'],
  notes: ['notes', 'Notes'],
  reason: ['reason', 'Reason'],
  status: ['status', 'Status'],
  selling_price_usd: ['label_selling_price', 'Selling price'],
  wholesale_price_usd: ['wholesale_price', 'Wholesale price'],
  cost_price_usd: ['label_cost_purchase', 'Cost Price'],
  branch_id: ['branch', 'Branch'],
  supplier_name: ['supplier', 'Supplier'],
  customer_name: ['customer', 'Customer'],
}

/**
 * A return's kinds. CLOSED on the server (cloudflare/src/lib/returnRecords.ts's
 * RETURN_RECORD_KINDS), which is what makes a translated label possible for
 * every one of them; anything a newer Worker adds reads as "Other change"
 * rather than printing a raw snake_case identifier into the Khmer pack.
 */
export const RETURN_RECORD_KIND_KEYS: Record<string, [string, string]> = {
  return_created: ['record_kind_return_created', 'Return recorded'],
  return_updated: ['record_kind_return_updated', 'Return edited'],
  return_deleted: ['record_kind_return_deleted', 'Return deleted'],
  return_bulk_change: ['record_kind_return_bulk_change', 'Grouped return change'],
  return_replayed: ['record_kind_return_replayed', 'Return change replayed'],
  sale_status_changed: ['record_kind_sale_status_changed', 'Sale status changed'],
  return_changed: ['record_kind_other', 'Other change'],
}

/**
 * The return adapter. Its own kind vocabulary, and the SAME generic field rows
 * as a product or a contact -- a return's before/after pairs are audit columns,
 * so a second renderer for them would be a second way to describe one edit.
 */
export const RETURN_RECORDS_ADAPTER: RecordsAdapter = {
  normalizeKind: (raw) => {
    const kind = String(raw ?? '').toLowerCase().trim()
    return RETURN_RECORD_KIND_KEYS[kind] ? kind : 'return_changed'
  },
  kindLabel: (kind, ctx) => {
    const entry = RETURN_RECORD_KIND_KEYS[kind] || RETURN_RECORD_KIND_KEYS.return_changed
    return ctx.label(entry[0], entry[1])
  },
  fieldRows: (record, ctx) => ENTITY_RECORDS_ADAPTER.fieldRows(record, ctx),
}

export function entityFieldLabel(field: string, label: LabelFn): string {
  const entry = ENTITY_FIELD_LABEL_KEYS[field]
  return entry ? label(entry[0], entry[1]) : formatAuditFieldLabel(field)
}

function renderEntityValue(value: RecordValue, ctx: RecordRenderContext): string {
  if (value.state === 'unknown') return ctx.label('historical_details_unavailable', 'Historical details unavailable')
  if (value.state === 'known_none') return ctx.label('none', 'None')
  const raw = value.value
  if (typeof raw === 'boolean') return raw ? ctx.label('yes', 'Yes') : ctx.label('no', 'No')
  if (raw === null || raw === undefined || raw === '') return ctx.label('none', 'None')
  return String(raw)
}
