export const RETURN_BULK_LIMIT = 25

export type ReturnBulkField = 'status' | 'return_type' | 'supplier_settlement'

export interface ReturnBulkRow {
  id: number | string
  return_scope?: string | null
  status?: string | null
  return_type?: string | null
  supplier_settlement?: string | null
  updated_at?: string | null
}

export interface ReturnBulkItem {
  id: number
  expected_status: string
  expected_method: string
  expected_updated_at: string | null
}

export interface ReturnBulkPayload {
  client_request_id: string
  field: ReturnBulkField
  source: string
  target: string
  items: ReturnBulkItem[]
}

export interface ReturnBulkResult {
  operationId: string
  actionHistoryId?: number | null
  changedIds: number[]
  unchangedIds: number[]
  changedCount: number
  unchangedCount: number
}

export function normalizeReturnBulkValue(value: unknown, fallback: string): string {
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized || fallback
}

export function methodFieldForScope(scope: unknown): Exclude<ReturnBulkField, 'status'> {
  return String(scope || '').trim().toLowerCase() === 'supplier' ? 'supplier_settlement' : 'return_type'
}

export function methodValueForRow(row: ReturnBulkRow): string {
  return methodFieldForScope(row.return_scope) === 'supplier_settlement'
    ? normalizeReturnBulkValue(row.supplier_settlement, 'refund')
    : normalizeReturnBulkValue(row.return_type, 'manual')
}

export function buildReturnBulkItems(rows: ReturnBulkRow[]): ReturnBulkItem[] {
  return rows.map((row) => ({
    id: Number(row.id),
    expected_status: normalizeReturnBulkValue(row.status, 'completed'),
    expected_method: methodValueForRow(row),
    expected_updated_at: row.updated_at == null ? null : String(row.updated_at),
  }))
}

export function makeReturnBulkRequestId(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  return `return-bulk-${uuid || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
}

export function buildReturnBulkPayload(input: {
  rows: ReturnBulkRow[]
  field: ReturnBulkField
  source: string
  target: string
  clientRequestId?: string
}): ReturnBulkPayload {
  if (!input.rows.length || input.rows.length > RETURN_BULK_LIMIT) {
    throw new Error(`Select between 1 and ${RETURN_BULK_LIMIT} returns.`)
  }
  const rows = input.rows
  return {
    client_request_id: input.clientRequestId || makeReturnBulkRequestId(),
    field: input.field,
    source: normalizeReturnBulkValue(input.source, ''),
    target: normalizeReturnBulkValue(input.target, ''),
    items: buildReturnBulkItems(rows),
  }
}

export function countConditionalMatches(rows: ReturnBulkRow[], field: ReturnBulkField, source: string): number {
  const expected = normalizeReturnBulkValue(source, '')
  return rows.filter((row) => {
    if (field === 'status') return normalizeReturnBulkValue(row.status, 'completed') === expected
    if (field !== methodFieldForScope(row.return_scope)) return false
    return normalizeReturnBulkValue(row[field], field === 'supplier_settlement' ? 'refund' : 'manual') === expected
  }).length
}
