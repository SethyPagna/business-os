import type { D1Compat } from './db'
import { sha256Hex } from './saleRecordEvents'

// Supplier-return idempotency. A supplier return is recorded under the same
// immutable (actor_id, request_id) receipt a customer return writes
// (return_create_receipts, migration 0142), with a digest of what the request
// asks for. A resend of the same request replays the original result; the same
// id with a different request, or an id another return already owns, is refused
// and names nothing of the return that owns it. The old lookup matched the bare
// request id across every user, so another account's id returned that account's
// return id and number, and a resend with a changed body was reported as a
// duplicate and silently dropped.

/** return_create_receipts CHECKs: request_id and the stored return number are 1..120 UTF-8 bytes. */
export const SUPPLIER_RETURN_ID_MAX_BYTES = 120

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

type Scalar = null | number | string | boolean

function scalar(value: unknown): Scalar {
  return value === null || typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean'
    ? value
    : JSON.stringify(value) ?? null
}

// Only keys the caller sent are kept, so "absent" (the server fills the default
// compensation) and an explicit null (compensation unknown) stay different requests.
function sent(source: unknown, keys: readonly string[]): Record<string, Scalar> {
  const out: Record<string, Scalar> = {}
  if (!source || typeof source !== 'object') return out
  const record = source as Record<string, unknown>
  for (const key of keys) if (record[key] !== undefined) out[key] = scalar(record[key])
  return out
}

const HEADER_FIELDS = [
  'branch_id', 'reason', 'notes', 'supplier_id', 'supplier_name', 'settlement',
  'supplier_compensation_usd', 'supplier_compensation_khr', 'exchange_rate',
] as const
const ITEM_FIELDS = [
  'product_id', 'product_name', 'quantity', 'cost_price_usd', 'cost_price_khr', 'unit_cost_usd', 'unit_cost_khr', 'branch_id',
] as const

/**
 * What the request asks for, and nothing else: device and clock fields, the
 * cashier the client claims, and the return number (a label the server mints
 * when absent, so a retry may carry a fresh one) stay out of the digest.
 * `sale_id: null` is required by the receipt table's own CHECK on request_json.
 */
export function canonicalSupplierReturnIntent(body: Record<string, unknown>): Record<string, unknown> {
  const items = Array.isArray(body.items) ? body.items : []
  return { sale_id: null, ...sent(body, HEADER_FIELDS), items: items.map(item => sent(item, ITEM_FIELDS)) }
}

export async function supplierReturnRequest(body: Record<string, unknown>): Promise<{ json: string; digest: string }> {
  const json = JSON.stringify(canonicalSupplierReturnIntent(body))
  return { json, digest: await sha256Hex(json) }
}

export const SUPPLIER_RETURN_ID_CONFLICT = {
  differentRequest: { error: 'client_request_id was already used for different return data.', code: 'idempotency_conflict' },
  owned: { error: 'client_request_id is already owned by another return.', code: 'idempotency_conflict' },
} as const

export type SupplierReturnReceiptState =
  | { kind: 'none' }
  | { kind: 'replay'; id: number; returnNumber: string }
  | { kind: 'conflict'; body: typeof SUPPLIER_RETURN_ID_CONFLICT[keyof typeof SUPPLIER_RETURN_ID_CONFLICT] }

/** One indexed read: this actor's receipt for the id, and whichever return holds the id (any actor, or a return older than receipts). */
export async function readSupplierReturnReceipt(
  db: D1Compat,
  actorId: number,
  requestId: string,
  requestDigest: string,
): Promise<SupplierReturnReceiptState> {
  const row = await db.prepare(`SELECT r.return_id, r.request_digest, r.response_json, o.id AS occupied_id
    FROM (SELECT 1) seed
    LEFT JOIN return_create_receipts r ON r.actor_id=? AND r.request_id=?
    LEFT JOIN returns o ON o.client_request_id=? AND o.client_request_id<>'' LIMIT 1`)
    .get<{ return_id: number | null; request_digest: string | null; response_json: string | null; occupied_id: number | null }>([actorId, requestId, requestId])
  if (row?.return_id != null) {
    if (row.request_digest !== requestDigest) return { kind: 'conflict', body: SUPPLIER_RETURN_ID_CONFLICT.differentRequest }
    const stored = JSON.parse(String(row.response_json)) as { id: number; returnNumber: string }
    return { kind: 'replay', id: Number(stored.id), returnNumber: String(stored.returnNumber) }
  }
  return row?.occupied_id != null ? { kind: 'conflict', body: SUPPLIER_RETURN_ID_CONFLICT.owned } : { kind: 'none' }
}

/**
 * The receipt, written in the same atomic batch as the return so a return and
 * its receipt exist together or not at all. `returnId` resolves the new return
 * from the batch's own write key.
 */
export function supplierReturnReceiptStatement(input: {
  returnId: { sql: string; params: Record<string, unknown> }
  receiptId: string
  actorId: number
  requestId: string
  requestDigest: string
  requestJson: string
  returnNumber: string
  occurredAt: string
}): { sql: string; params: Record<string, unknown> } {
  return {
    sql: `INSERT INTO return_create_receipts(
      id,actor_id,return_id,sale_id,request_id,request_digest,request_json,response_json,occurred_at
    ) VALUES(
      @receiptId,@actorId,${input.returnId.sql},NULL,@requestId,@requestDigest,@requestJson,
      json_object('id',${input.returnId.sql},'returnNumber',@returnNumber,'replacementSaleId',NULL,'replacementReceiptNumber',NULL),@occurredAt
    )`,
    params: {
      ...input.returnId.params, receiptId: input.receiptId, actorId: input.actorId, requestId: input.requestId, requestDigest: input.requestDigest,
      requestJson: input.requestJson, returnNumber: input.returnNumber, occurredAt: input.occurredAt,
    },
  }
}
