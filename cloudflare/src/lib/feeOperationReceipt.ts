import type { D1Compat } from './db'

export const FEE_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,120}$/

export type FeeCreateIntent = {
  fee_type: string
  label: string | null
  amount_usd: number
  amount_khr: number
  fee_date: string
  sale_id: number | null
  branch_id: number | null
  delivery_contact_id: number | null
  notes: string | null
}

export type FeeOperationReceiptRow = {
  actor_id: number
  fee_id: number
  request_id: string
  request_digest: string
  request_json: string
  response_json: string
  occurred_at: string
}

export function normalizeFeeRequestId(value: unknown): string | null {
  const clean = String(value ?? '').trim()
  return FEE_REQUEST_ID_PATTERN.test(clean) ? clean : null
}

export function canonicalFeeCreateRequest(intent: FeeCreateIntent): string {
  return JSON.stringify({
    fee_type: intent.fee_type,
    label: intent.label,
    amount_usd: intent.amount_usd,
    amount_khr: intent.amount_khr,
    fee_date: intent.fee_date,
    sale_id: intent.sale_id,
    branch_id: intent.branch_id,
    delivery_contact_id: intent.delivery_contact_id,
    notes: intent.notes,
  })
}

export async function feeRequestDigest(requestJson: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(requestJson))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function findFeeOperationReceipt(
  db: D1Compat,
  actorId: number,
  requestId: string,
): Promise<FeeOperationReceiptRow | undefined> {
  return db.prepare(`
    SELECT actor_id,fee_id,request_id,request_digest,request_json,response_json,occurred_at
    FROM fee_operation_receipts
    WHERE actor_id=@actor AND request_id=@request
    LIMIT 1
  `).get<FeeOperationReceiptRow>({ actor: actorId, request: requestId })
}

export function feeOperationReceiptStatement(args: {
  receiptId: string
  actorId: number
  actorName: string | null
  requestId: string
  digest: string
  requestJson: string
  occurredAt: string
  intent: FeeCreateIntent
  resolvedBranchId: number
}): { sql: string; params: Record<string, unknown> } {
  return {
    sql: `INSERT INTO fee_operation_receipts(
      id,actor_id,fee_id,request_id,request_digest,request_json,response_json,occurred_at
    ) VALUES(
      @receiptId,@actor,last_insert_rowid(),@request,@digest,@requestJson,
      json_object('fee',json_object(
        'id',last_insert_rowid(),'fee_type',@feeType,'label',@label,
        'amount_usd',@amountUsd,'amount_khr',@amountKhr,'fee_date',@feeDate,
        'sale_id',@saleId,'branch_id',@resolvedBranchId,
        'delivery_contact_id',@deliveryContactId,'notes',@notes,
        'created_by',@actor,'created_by_name',@actorName,
        'created_at',@occurredAt,'updated_at',@occurredAt
      )),@occurredAt
    )`,
    params: {
      receiptId: args.receiptId,
      actor: args.actorId,
      request: args.requestId,
      digest: args.digest,
      requestJson: args.requestJson,
      occurredAt: args.occurredAt,
      feeType: args.intent.fee_type,
      label: args.intent.label,
      amountUsd: args.intent.amount_usd,
      amountKhr: args.intent.amount_khr,
      feeDate: args.intent.fee_date,
      saleId: args.intent.sale_id,
      resolvedBranchId: args.resolvedBranchId,
      deliveryContactId: args.intent.delivery_contact_id,
      notes: args.intent.notes,
      actorName: args.actorName,
    },
  }
}

export function feeCreateAuditStatement(args: {
  actorId: number
  actorName: string | null
  requestId: string
  digest: string
  resolvedBranchId: number
}): { sql: string; params: Record<string, unknown> } {
  return {
    sql: `INSERT INTO audit_logs(
      user_id,user_name,action,entity,entity_id,details,table_name,record_id,new_value
    ) SELECT
      @actor,@actorName,'create','fee',CAST(fee_id AS TEXT),
      json_object(
        'after',json(json_extract(response_json,'$.fee')),
        'sale_id',json_extract(response_json,'$.fee.sale_id'),
        'branch_id',@resolvedBranchId,
        'client_request_id',@request,
        'request_digest',@digest
      ),
      'fees',CAST(fee_id AS TEXT),json(json_extract(response_json,'$.fee'))
    FROM fee_operation_receipts
    WHERE actor_id=@actor AND request_id=@request`,
    params: {
      actor: args.actorId,
      actorName: args.actorName,
      request: args.requestId,
      digest: args.digest,
      resolvedBranchId: args.resolvedBranchId,
    },
  }
}

export function feeOperationReceiptResponse(row: FeeOperationReceiptRow): { fee: Record<string, unknown> } {
  const parsed = JSON.parse(row.response_json) as { fee?: Record<string, unknown> }
  if (!parsed.fee || Number(parsed.fee.id) !== Number(row.fee_id)) {
    throw new Error('Expense receipt is incomplete; retry after refreshing.')
  }
  return { fee: parsed.fee }
}
