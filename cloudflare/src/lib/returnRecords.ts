// One return's RECORDS: every change anybody ever made to it, as one list.
//
// The owner, Sep 22 2026: "having records in sales, returns, stock changes,
// products, invoices, etc... make sure these records are having them there as
// well as in the actual audit log, all + filters + sections etc... like sales
// do before and after, by who etc... Compact rows, press to open etc..."
//
// Sales already answer this (lib/saleRecords.ts + GET /api/sales/:id/records).
// A return did not: its edits were recorded only as a line in the PARENT
// SALE's records list, so opening the return itself said nothing about who
// changed it. This module is the returns half, and it is deliberately much
// smaller than saleRecords.ts because a return has three writers, not six:
//
//   audit_logs         the create row (entity 'return_create', whose
//                      record_id is the return id) and every edit
//                      (entity 'return', old_value/new_value written by
//                      lib/audit.ts's changedFields since the records lane's
//                      phase 1), plus the grouped action's undo/redo rows.
//   sale_record_events the LINKED SALE's status moving because of this
//                      return. Its source_id is a receipt id, not the return
//                      id, so the route joins through
//                      return_create_receipts / return_mutation_receipts /
//                      return_bulk_members to get back here.
//   return_bulk_*      the grouped status/type/settlement change, whose
//                      receipt keeps this return's own before -> after pair.
//
// Everything here is pure: the route holds the reads, this module holds the
// meaning, so test-return-records-pure.cjs can pin the shapes without a
// Worker. The record shape is the SAME one the sales float already consumes
// (id / at / actor_username / kind / via / subject / changes), because the
// browser renders both through one component.

import { type D1Compat } from './db'
import { parseSqliteTimestampMs } from './saleAmendments'

export type RecordValueState =
  | { state: 'known_value'; value: unknown }
  | { state: 'known_none' }
  | { state: 'unknown' }

export interface EntityRecordChange {
  field: string
  before: RecordValueState
  after: RecordValueState
}

/**
 * The closed kind vocabulary. Closed for the same reason the sale list is:
 * the float prints a translated label per kind, and an invented kind would
 * print a raw snake_case identifier into the Khmer pack.
 */
export const RETURN_RECORD_KINDS = [
  'return_created',
  'return_updated',
  'return_deleted',
  'return_bulk_change',
  'return_replayed',
  'sale_status_changed',
  'return_changed',
] as const
export type ReturnRecordKind = (typeof RETURN_RECORD_KINDS)[number]

export interface EntityRecord {
  /** Source-prefixed: audit_logs id 7 and a bulk operation are different records. */
  id: string
  source: 'audit' | 'sale_event' | 'bulk'
  /** The timestamp exactly as stored; the client formats it dd/mm/yyyy HH:mm. */
  at: string | null
  /** Milliseconds, for ORDERING only. Null when the stored value will not parse. */
  at_ms: number | null
  /** The acting account's USERNAME (N13's rule), never a full name. */
  actor_username: string | null
  /**
   * The branch, where the row carries one. audit_logs has no branch column
   * (migration 0001) and this lane deliberately does not add one, so most
   * return records answer null and the client omits the field cleanly rather
   * than inventing the signed-in user's own branch.
   */
  branch_name: string | null
  kind: ReturnRecordKind
  /** 'apply' | 'undo' | 'redo' when the durable source records that direction. */
  via: string | null
  /** What the change was about: the return number, the linked receipt. */
  subject: string | null
  changes: EntityRecordChange[]
}

function atMs(raw: unknown): number | null {
  const ms = parseSqliteTimestampMs(raw)
  return Number.isFinite(ms) ? ms : null
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  return trimmed === '' ? null : trimmed
}

function parseJson(raw: unknown): unknown {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(String(raw))
  } catch (_) {
    return null
  }
}

function asObject(raw: unknown): Record<string, unknown> | null {
  const parsed = parseJson(raw)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null
}

/** A value the row actually carries, or the "deliberately absent" state. */
function valueState(raw: unknown): RecordValueState {
  return raw === null || raw === undefined || raw === '' ? { state: 'known_none' } : { state: 'known_value', value: raw }
}

/**
 * The changed-field rows out of an audit row's old_value/new_value pair.
 *
 * lib/audit.ts's changedFields() already wrote ONLY the fields that moved, so
 * this is a zip, not a second diff: re-deriving "what changed" here would be a
 * second rule that could disagree with the one the writer applied. A pair whose
 * two sides are equal is still dropped, because a row like that is noise
 * whatever wrote it.
 */
export function changesFromAuditColumns(oldValue: unknown, newValue: unknown): EntityRecordChange[] {
  const before = asObject(oldValue)
  const after = asObject(newValue)
  if (!before && !after) return []
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])]
  const rows: EntityRecordChange[] = []
  for (const field of keys) {
    const beforeValue = before ? before[field] : undefined
    const afterValue = after ? after[field] : undefined
    if (JSON.stringify(beforeValue ?? null) === JSON.stringify(afterValue ?? null)) continue
    rows.push({ field, before: valueState(beforeValue), after: valueState(afterValue) })
  }
  return rows
}

export interface ReturnRecordAuditRow {
  id: number | string
  entity?: unknown
  action?: unknown
  details?: unknown
  old_value?: unknown
  new_value?: unknown
  user_name?: unknown
  created_at?: unknown
  return_number?: unknown
}

const AUDIT_ACTION_KINDS: Record<string, ReturnRecordKind> = {
  create: 'return_created',
  update: 'return_updated',
  delete: 'return_deleted',
  return_fields_bulk: 'return_bulk_change',
  action_undo: 'return_replayed',
  action_redo: 'return_replayed',
}

/**
 * One audit row as a record.
 *
 * A row with no field pair is still a record: "who cancelled this return, and
 * when" is the question the float exists to answer, and dropping the row
 * because its payload has no diff would answer it with silence. The create row
 * is the clearest case -- it has no before image by definition.
 */
export function returnAuditRecord(row: ReturnRecordAuditRow): EntityRecord | null {
  const action = String(row.action ?? '').toLowerCase()
  if (!action) return null
  const kind = AUDIT_ACTION_KINDS[action] || 'return_changed'
  const details = asObject(row.details)
  const via = action === 'action_undo' ? 'undo' : action === 'action_redo' ? 'redo' : 'apply'
  const changes = changesFromAuditColumns(row.old_value, row.new_value)
  // The reason the operator typed lives in `details`, never in the field pair
  // (changedFields diffs COLUMNS; the reason is a request field). It is the
  // single most-asked-for line on a return edit, so it is surfaced as its own
  // row rather than left inside a payload nobody opens.
  const reason = text(details?.reason)
  if (reason && !changes.some((change) => change.field === 'reason')) {
    changes.push({ field: 'reason', before: { state: 'unknown' }, after: { state: 'known_value', value: reason } })
  }
  return {
    id: `audit:${row.id}`,
    source: 'audit',
    at: text(row.created_at),
    at_ms: atMs(row.created_at),
    actor_username: text(row.user_name),
    branch_name: null,
    kind,
    via,
    subject: text(row.return_number),
    changes,
  }
}

export interface ReturnRecordSaleEventRow {
  id: string
  sale_id: number | string
  source_kind: string
  kind: string
  via: string
  subject?: unknown
  actor_username?: unknown
  occurred_at: unknown
  changes_json: unknown
  receipt_number?: unknown
  branch_name?: unknown
}

/**
 * The linked sale's status moving because of this return.
 *
 * Kept as its own kind ('sale_status_changed') rather than folded into the
 * return's own update: the fact a reader needs is that THIS return is what
 * moved the SALE, and a row labelled "Return updated" hides exactly that.
 */
export function returnSaleEventRecord(row: ReturnRecordSaleEventRow): EntityRecord | null {
  const parsed = parseJson(row.changes_json)
  const changes: EntityRecordChange[] = Array.isArray(parsed)
    ? parsed.flatMap((entry) => {
      const change = entry && typeof entry === 'object' ? entry as Record<string, unknown> : null
      const field = change ? text(change.field) : null
      if (!field) return []
      return [{
        field,
        before: (change!.before as RecordValueState) || { state: 'unknown' },
        after: (change!.after as RecordValueState) || { state: 'unknown' },
      }]
    })
    : []
  if (!changes.length) return null
  return {
    id: `sale_event:${row.id}`,
    source: 'sale_event',
    at: text(row.occurred_at),
    at_ms: atMs(row.occurred_at),
    actor_username: text(row.actor_username),
    branch_name: text(row.branch_name),
    kind: 'sale_status_changed',
    via: text(row.via),
    // The receipt, not the return number: this row is about the sale, and the
    // reader is being told WHICH sale this return moved.
    subject: text(row.receipt_number) || text(row.subject),
    changes,
  }
}

export interface ReturnRecordBulkRow {
  operation_id: string
  request_json?: unknown
  receipt_json?: unknown
  generation?: unknown
  created_at?: unknown
  created_by_name?: unknown
  label?: unknown
}

/**
 * The grouped status/type/settlement change, narrowed to THIS return.
 *
 * The operation's receipt lists every member with its own before -> after, so
 * a grouped action shows this return's actual pair instead of the batch's
 * summary line ("12 returns: status completed -> cancelled"), which is true of
 * the batch and says nothing about the record being read.
 */
export function returnBulkRecord(row: ReturnRecordBulkRow, returnId: number | string): EntityRecord | null {
  const receipt = asObject(row.receipt_json)
  const request = asObject(row.request_json)
  const items = Array.isArray(receipt?.items) ? receipt!.items as unknown[] : []
  const mine = items
    .map((entry) => (entry && typeof entry === 'object' ? entry as Record<string, unknown> : null))
    .find((entry) => entry && String(entry.id) === String(returnId))
  if (!mine || mine.changed === false) return null
  const field = text(request?.field) || 'status'
  return {
    id: `bulk:${row.operation_id}:${row.generation ?? 0}`,
    source: 'bulk',
    at: text(row.created_at),
    at_ms: atMs(row.created_at),
    actor_username: text(row.created_by_name),
    branch_name: null,
    kind: 'return_bulk_change',
    via: 'apply',
    subject: text(mine.return_number),
    changes: [{ field, before: valueState(mine.before), after: valueState(mine.after) }],
  }
}

/**
 * Oldest first, stable.
 *
 * A record whose timestamp will not parse keeps its position instead of
 * sorting to the top of the list as if it happened first -- an unreadable
 * stamp is missing evidence, not an early event.
 */
export function orderReturnRecords(records: EntityRecord[]): EntityRecord[] {
  return records
    .map((record, index) => ({ record, index }))
    .sort((left, right) => {
      const leftMs = left.record.at_ms
      const rightMs = right.record.at_ms
      if (leftMs !== null && rightMs !== null && leftMs !== rightMs) return leftMs - rightMs
      return left.index - right.index
    })
    .map((entry) => entry.record)
}

/**
 * The four reads, here rather than in the route.
 *
 * routes/returns.ts is ~3,000 lines and cannot be loaded into a pure test
 * (transpiling it overflows the compiler's stack), so SQL living there is SQL
 * nothing can exercise without a Worker. Everything a reader could get wrong
 * -- which table names this return, which rows belong to another one -- is in
 * these queries, so they live in the module the test can actually run.
 */
export async function loadReturnRecords(db: D1Compat, returnId: number): Promise<{
  returnId: number
  returnNumber: string | null
  records: EntityRecord[]
} | null> {
  const row = await db.prepare('SELECT id, return_number FROM returns WHERE id = @returnId')
    .get<{ id: number; return_number: string | null }>({ returnId })
  if (!row) return null
  const idText = String(returnId)

  // The create row is keyed by its RECEIPT id under entity 'return_create' and
  // names the return only in record_id; the edit rows are keyed by the return
  // itself. Querying entity='return' alone silently loses every creation.
  const auditRows = await db.prepare(`
    SELECT id, action, details, old_value, new_value, user_name, created_at
    FROM audit_logs
    WHERE (entity = 'return' AND entity_id = @idText)
       OR (entity = 'return_create' AND CAST(record_id AS TEXT) = @idText)
    ORDER BY id ASC
  `).all<ReturnRecordAuditRow>({ idText })

  // Grouped undo/redo rows are keyed by the OPERATION id, so the query above
  // cannot see them; membership is what says this return actually moved.
  const replayRows = await db.prepare(`
    SELECT a.id, a.action, a.details, a.old_value, a.new_value, a.user_name, a.created_at
    FROM return_bulk_members m
    JOIN return_bulk_operations o ON o.id = m.operation_id
    JOIN audit_logs a ON a.entity = 'return' AND a.entity_id = o.id
      AND a.action IN ('action_undo', 'action_redo')
    WHERE m.return_id = @returnId
    ORDER BY a.created_at ASC, a.id ASC
  `).all<ReturnRecordAuditRow>({ returnId })

  // sale_record_events.source_id is a receipt/operation id, never the return
  // id, so each source kind joins back through its own receipt table.
  const saleEventRows = await db.prepare(`
    SELECT e.id, e.sale_id, e.source_kind, e.kind, e.via, e.subject, e.actor_username,
      e.occurred_at, e.changes_json, s.receipt_number, s.branch_name
    FROM sale_record_events e
    JOIN sales s ON s.id = e.sale_id
    WHERE (e.source_kind = 'return_create'
        AND e.source_id IN (SELECT id FROM return_create_receipts WHERE return_id = @returnId))
      OR (e.source_kind = 'return_edit'
        AND e.source_id IN (SELECT id FROM return_mutation_receipts WHERE return_id = @returnId))
      OR (e.source_kind = 'return_bulk'
        AND e.source_id IN (SELECT operation_id FROM return_bulk_members WHERE return_id = @returnId))
    ORDER BY e.occurred_at ASC, e.id ASC
  `).all<ReturnRecordSaleEventRow>({ returnId })

  const bulkRows = await db.prepare(`
    SELECT o.id AS operation_id, o.request_json, o.receipt_json, o.generation,
      h.created_at AS created_at, h.created_by_name AS created_by_name, h.label AS label
    FROM return_bulk_members m
    JOIN return_bulk_operations o ON o.id = m.operation_id
    LEFT JOIN action_history h ON h.id = o.history_id
    WHERE m.return_id = @returnId
  `).all<ReturnRecordBulkRow>({ returnId })

  return {
    returnId,
    returnNumber: row.return_number ?? null,
    records: buildReturnRecords({
      returnId,
      // The return number is the same on every row of this return, so it is
      // attached once here instead of joined into four queries.
      auditRows: [...(auditRows || []), ...(replayRows || [])].map((entry) => ({ ...entry, return_number: row.return_number })),
      saleEventRows,
      bulkRows,
    }),
  }
}

export function buildReturnRecords(input: {
  returnId: number | string
  auditRows?: ReturnRecordAuditRow[] | null
  saleEventRows?: ReturnRecordSaleEventRow[] | null
  bulkRows?: ReturnRecordBulkRow[] | null
}): EntityRecord[] {
  const records: EntityRecord[] = []
  for (const row of input.auditRows || []) {
    const record = returnAuditRecord(row)
    if (record) records.push(record)
  }
  for (const row of input.saleEventRows || []) {
    const record = returnSaleEventRecord(row)
    if (record) records.push(record)
  }
  for (const row of input.bulkRows || []) {
    const record = returnBulkRecord(row, input.returnId)
    if (record) records.push(record)
  }
  return orderReturnRecords(records)
}
