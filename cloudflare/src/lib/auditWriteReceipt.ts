import type { D1Compat } from './db'
import { auditChangeColumns, type AuditFieldChange } from './audit'

// Idempotency for a configuration write with NO new table. Used today by the promotions
// routes, whose audit entities are 'promotion' (announcement cards) and 'promotion_rule': the
// write's own audit row is the receipt, committed in the SAME db.batch as the
// write, keyed on (actor, action, entity, client_request_id) and carrying the
// canonical request. This is the pattern routes/shifts.ts (shift transitions)
// and routes/contacts.ts (loyalty award) already use; this file is the one
// shared, tested copy of its three moving parts:
//
//   1. a replay lookup  (findWriteReceipt)         -> answer from the first commit
//   2. a write guard    (receiptAbsentSql)         -> a racing twin writes nothing
//   3. the receipt row  (receiptAuditStatement)    -> written only if the write changed a row
//
// The audit log is purged after its retention window (21 days by default), so a
// receipt protects a retry, not an arbitrarily old replay -- the same bound the
// loyalty and shift receipts have.

export const WRITE_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,120}$/

export const WRITE_REQUEST_ID_REQUIRED = {
  error: 'client_request_id is required for this change. Refresh the app and try again.',
  code: 'client_request_id_required',
} as const

export const WRITE_REQUEST_ID_INVALID = {
  error: 'client_request_id must be 8-120 characters of letters, digits, "-" or "_".',
  code: 'invalid_client_request_id',
} as const

export const WRITE_IDEMPOTENCY_CONFLICT = {
  error: 'This request identity was already used with different values.',
  code: 'idempotency_conflict',
} as const

export type WriteRequestIdResult = { ok: true; id: string } | { ok: false; body: typeof WRITE_REQUEST_ID_REQUIRED | typeof WRITE_REQUEST_ID_INVALID }

/** Read the id a client sent (either spelling); absent -> required, malformed -> invalid. */
export function readWriteRequestId(body: Record<string, unknown> | null | undefined): WriteRequestIdResult {
  const supplied = body?.client_request_id ?? body?.clientRequestId
  if (supplied == null || (typeof supplied === 'string' && supplied.trim() === '')) return { ok: false, body: WRITE_REQUEST_ID_REQUIRED }
  const id = typeof supplied === 'string' ? supplied.trim() : ''
  if (!WRITE_REQUEST_ID_PATTERN.test(id)) return { ok: false, body: WRITE_REQUEST_ID_INVALID }
  return { ok: true, id }
}

/** Key-sorted JSON, so the same intent always fingerprints the same. */
export function canonicalWriteRequest(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize)
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.keys(item).sort().map((key) => [key, normalize((item as Record<string, unknown>)[key])]))
    }
    return item === undefined ? null : item
  }
  return JSON.stringify(normalize(value))
}

const RECEIPT_WHERE = `action = @receiptAction AND entity = @receiptEntity AND user_id = @receiptActor
  AND json_valid(details) AND json_extract(details, '$.request.id') = @receiptId`

export type WriteReceiptKey = { actorId: number; action: string; entity: string; requestId: string }

export function receiptParams(key: WriteReceiptKey): Record<string, unknown> {
  return { receiptAction: key.action, receiptEntity: key.entity, receiptActor: key.actorId, receiptId: key.requestId }
}

/** SQL predicate for a write's own WHERE: true only while no receipt for this request exists. */
export function receiptAbsentSql(): string {
  return `NOT EXISTS (SELECT 1 FROM audit_logs WHERE ${RECEIPT_WHERE})`
}

export type WriteReceipt = { entityId: string | null; canonical: string | null }

export async function findWriteReceipt(db: D1Compat, key: WriteReceiptKey): Promise<WriteReceipt | null> {
  const row = await db.prepare(
    `SELECT entity_id, details FROM audit_logs WHERE ${RECEIPT_WHERE} ORDER BY id DESC LIMIT 1`,
  ).get<{ entity_id: string | number | null; details: string | null }>(receiptParams(key))
  if (!row) return null
  let canonical: string | null = null
  try {
    const parsed = JSON.parse(String(row.details || '{}')) as { request?: { canonical?: unknown } }
    canonical = typeof parsed.request?.canonical === 'string' ? parsed.request.canonical : null
  } catch { canonical = null }
  return { entityId: row.entity_id == null ? null : String(row.entity_id), canonical }
}

/**
 * The receipt/audit row, as the batch statement that FOLLOWS the write. Inserts
 * only when that write changed exactly one row (changes() = 1), so a write the
 * guard or the version check turned into a no-op leaves no receipt.
 * `entityIdFromLastInsert` is for creates (the new row's id).
 */
export function receiptAuditStatement(args: {
  key: WriteReceiptKey
  actorName: string | null
  entityId?: string | number | null
  entityIdFromLastInsert?: boolean
  details: Record<string, unknown>
  canonical: string
  change?: AuditFieldChange | null
}): { sql: string; params: Record<string, unknown> } {
  const idSql = args.entityIdFromLastInsert ? 'last_insert_rowid()' : '@entityId'
  const details = JSON.stringify({ ...args.details, request: { id: args.key.requestId, canonical: args.canonical } })
  const columns = auditChangeColumns(args.change)
  return {
    sql: `INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details, table_name, record_id, old_value, new_value, device_name, device_tz)
      SELECT @receiptActor, COALESCE(NULLIF(TRIM(u.username), ''), NULLIF(TRIM(@actorName), '')),
        @receiptAction, @receiptEntity, ${idSql}, @details, @receiptEntity, ${idSql}, @oldValue, @newValue,
        s.device_name, s.device_tz
      FROM (SELECT 1 AS one) AS _receipt
      LEFT JOIN users u ON u.id = @receiptActor
      LEFT JOIN (
        SELECT device_name, device_tz FROM user_sessions
        WHERE user_id = @receiptActor AND revoked_at IS NULL
        ORDER BY last_seen_at DESC, id DESC LIMIT 1
      ) AS s ON 1 = 1
      WHERE changes() = 1`,
    params: {
      ...receiptParams(args.key),
      actorName: args.actorName,
      ...(args.entityIdFromLastInsert ? {} : { entityId: args.entityId ?? null }),
      details,
      oldValue: columns.old_value,
      newValue: args.change === undefined ? details : columns.new_value,
    },
  }
}
