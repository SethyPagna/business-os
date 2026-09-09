import type { D1Compat } from './db'

export const TRANSFER_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,120}$/

export type TransferReceiptRow = {
  actor_id: number
  request_id: string
  request_digest: string
  request_json: string
  response_json: string | null
  status: string
}

export function normalizeTransferRequestId(value: unknown): string | null {
  const clean = String(value ?? '').trim()
  return TRANSFER_REQUEST_ID_PATTERN.test(clean) ? clean : null
}

export async function transferRequestDigest(requestJson: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(requestJson))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function findTransferReceipt(db: D1Compat, actorId: number, requestId: string): Promise<TransferReceiptRow | undefined> {
  return db.prepare(`
    SELECT actor_id,request_id,request_digest,request_json,response_json,status
    FROM transfer_operation_receipts
    WHERE actor_id=@actor AND request_id=@request
    LIMIT 1
  `).get<TransferReceiptRow>({ actor: actorId, request: requestId })
}

export function transferReceiptStatement(args: {
  actorId: number
  requestId: string
  digest: string
  requestJson: string
  responseJson: string
}): { sql: string; params: Record<string, unknown> } {
  return {
    sql: `INSERT INTO transfer_operation_receipts
      (actor_id,request_id,request_digest,request_json,response_json,status,created_at,updated_at)
      VALUES(@actor,@request,@digest,@requestJson,@response,'committed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    params: {
      actor: args.actorId,
      request: args.requestId,
      digest: args.digest,
      requestJson: args.requestJson,
      response: args.responseJson,
    },
  }
}

export function transferIntentAuditStatement(args: {
  actorId: number
  actorName: string | null
  requestId: string
  requestJson: string
  digest: string
  bulk: boolean
}): { sql: string; params: Record<string, unknown> } {
  const details = JSON.stringify({
    kind: 'transfer_intent',
    requestId: args.requestId,
    requestDigest: args.digest,
    request: JSON.parse(args.requestJson),
    bulk: args.bulk,
  })
  return {
    sql: `INSERT INTO audit_logs
      (user_id,user_name,action,entity,entity_id,details,table_name,record_id,new_value)
      VALUES(@actor,@actorName,'transfer_intent','stock',@request,@details,'stock_transfers',@request,@details)`,
    params: {
      actor: args.actorId,
      actorName: args.actorName,
      request: args.requestId,
      details,
    },
  }
}

export function transferReceiptResponse(row: TransferReceiptRow): unknown {
  if (!row.response_json) throw new Error('Transfer receipt is incomplete; retry after refreshing.')
  return JSON.parse(row.response_json)
}
