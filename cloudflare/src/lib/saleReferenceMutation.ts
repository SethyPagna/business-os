import type { D1Compat } from './db'
import { sha256Hex } from './saleRecordEvents'

export const SALE_REFERENCE_MAX_CANDIDATES = 5_000
export const SALE_REFERENCE_MAX_EVENT_BYTES = 65_536
export const SALE_REFERENCE_MAX_AGGREGATE_EVENT_BYTES = 8_388_608
export const SALE_REFERENCE_RECEIPT_RESPONSE_BYTES = 4_096

export const SALE_REFERENCE_MUTATION_KINDS = [
  'customer_profile_carry',
  'delivery_contact_carry',
  'customer_merge',
  'delivery_contact_merge',
  'customer_link_repair',
  'customer_missing_resolve',
  'payment_method_replace',
] as const

export type SaleReferenceMutationKind = (typeof SALE_REFERENCE_MUTATION_KINDS)[number]
export type SaleReferenceStatement = { sql: string; params: Record<string, unknown> }

type ReceiptBase = {
  success: true
  receipt_id: string
  affected_sales: number
  updated_at: string
}

export type SaleReferenceMutationResponse =
  | (ReceiptBase & { target_id: number; affected_returns: number })
  | (ReceiptBase & { target_id: number })
  | (ReceiptBase & { keep_id: number; merge_id: number })
  | (ReceiptBase & { target_id: number; created: boolean })
  | (ReceiptBase & { affected_payment_lines: number })

export type SaleReferenceReceiptInput = {
  id: string
  actorId: number
  mutationKind: SaleReferenceMutationKind
  targetKey: string
  requestId: string
  requestDigest: string
  response: SaleReferenceMutationResponse
  occurredAt: string
}

export class SaleReferenceMutationError extends Error {
  constructor(
    public readonly code: 'refresh_required' | 'idempotency_conflict' | 'too_many_linked_sales' | 'sale_record_event_too_large' | 'invalid_sale_reference_mutation',
    message: string,
  ) {
    super(message)
    this.name = 'SaleReferenceMutationError'
  }
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SHA256 = /^[0-9a-f]{64}$/
const ISO_MILLISECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const MUTATION_KINDS = new Set<string>(SALE_REFERENCE_MUTATION_KINDS)
const encoder = new TextEncoder()

function fail(message: string): never {
  throw new SaleReferenceMutationError('invalid_sale_reference_mutation', message)
}

function bytes(value: string): number { return encoder.encode(value).byteLength }
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail('Sale reference mutation response has an unsupported shape.')
  }
}
function positiveId(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) fail(`${label} must be a positive integer.`)
  return Number(value)
}
function count(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail(`${label} must be a non-negative integer.`)
  return Number(value)
}

export function requireSaleReferenceRequestId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!id || bytes(id) > 120) {
    throw new SaleReferenceMutationError('refresh_required', 'Refresh this page before applying this linked Sales change.')
  }
  return id
}

export function requireSaleReferenceRevision(value: unknown): string {
  const revision = typeof value === 'string' ? value.trim() : ''
  if (!revision || bytes(revision) > 80) {
    throw new SaleReferenceMutationError('refresh_required', 'Refresh this page to load the latest record before applying this linked Sales change.')
  }
  return revision
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!object(value)) {
    if (typeof value === 'number' && !Number.isFinite(value)) fail('Mutation intent contains a non-finite number.')
    if (value === undefined) fail('Mutation intent contains undefined.')
    return value
  }
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
}

export function canonicalSaleReferenceIntent(value: Record<string, unknown>): string {
  return JSON.stringify(canonicalize(value))
}

export async function saleReferenceRequestDigest(value: Record<string, unknown>): Promise<string> {
  return sha256Hex(canonicalSaleReferenceIntent(value))
}

function hash(value: string, label: string): string {
  if (!SHA256.test(value)) fail(`${label} must be a lowercase SHA-256 digest.`)
  return value
}

export function saleReferenceTargetKey(kind: SaleReferenceMutationKind, input: Record<string, unknown>): string {
  if (!MUTATION_KINDS.has(kind)) fail('Sale reference mutation kind is invalid.')
  if (kind === 'customer_profile_carry') return `customer:${positiveId(input.target_id, 'target_id')}`
  if (kind === 'delivery_contact_carry') return `delivery_contact:${positiveId(input.target_id, 'target_id')}`
  if (kind === 'customer_merge') {
    const keep = positiveId(input.keep_id, 'keep_id')
    const merge = positiveId(input.merge_id, 'merge_id')
    if (keep === merge) fail('Merge contacts must be different.')
    return `customer_merge:${keep}:${merge}`
  }
  if (kind === 'delivery_contact_merge') {
    const keep = positiveId(input.keep_id, 'keep_id')
    const merge = positiveId(input.merge_id, 'merge_id')
    if (keep === merge) fail('Merge contacts must be different.')
    return `delivery_contact_merge:${keep}:${merge}`
  }
  if (kind === 'customer_link_repair') {
    return `customer_link:${positiveId(input.current_id, 'current_id')}:${hash(String(input.phone_group_digest || ''), 'phone_group_digest')}`
  }
  if (kind === 'customer_missing_resolve') {
    return `customer_missing:${hash(String(input.group_digest || ''), 'group_digest')}`
  }
  return `payment_method:${hash(String(input.source_digest || ''), 'source_digest')}`
}

function validateTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !ISO_MILLISECONDS.test(value) || !Number.isFinite(Date.parse(value))) {
    fail('Sale reference mutation timestamp must be canonical UTC with milliseconds.')
  }
  return value
}

function validateResponse(
  kind: SaleReferenceMutationKind,
  receiptId: string,
  occurredAt: string,
  value: SaleReferenceMutationResponse,
): string {
  if (!object(value) || value.success !== true || value.receipt_id !== receiptId || value.updated_at !== occurredAt) {
    fail('Sale reference mutation response identity is invalid.')
  }
  const response = value as Record<string, unknown>
  count(response.affected_sales, 'affected_sales')
  const common = ['success', 'receipt_id', 'affected_sales', 'updated_at']
  if (kind === 'customer_profile_carry') {
    exactKeys(value, [...common, 'target_id', 'affected_returns'])
    positiveId(response.target_id, 'target_id')
    count(response.affected_returns, 'affected_returns')
  } else if (kind === 'delivery_contact_carry' || kind === 'customer_link_repair') {
    exactKeys(value, [...common, 'target_id'])
    positiveId(response.target_id, 'target_id')
  } else if (kind === 'customer_merge' || kind === 'delivery_contact_merge') {
    exactKeys(value, [...common, 'keep_id', 'merge_id'])
    const keep = positiveId(response.keep_id, 'keep_id')
    const merge = positiveId(response.merge_id, 'merge_id')
    if (keep === merge) fail('Merge response contacts must be different.')
  } else if (kind === 'customer_missing_resolve') {
    exactKeys(value, [...common, 'target_id', 'created'])
    positiveId(response.target_id, 'target_id')
    if (typeof response.created !== 'boolean') fail('created must be boolean.')
  } else {
    exactKeys(value, [...common, 'affected_payment_lines'])
    count(response.affected_payment_lines, 'affected_payment_lines')
  }
  const serialized = JSON.stringify(value)
  if (bytes(serialized) > SALE_REFERENCE_RECEIPT_RESPONSE_BYTES) fail('Sale reference mutation response is too large.')
  return serialized
}

export function buildSaleReferenceReceiptInsert(input: SaleReferenceReceiptInput): SaleReferenceStatement {
  if (!UUID_V4.test(input.id)) fail('Sale reference receipt id must be a lowercase UUID v4.')
  positiveId(input.actorId, 'actor_id')
  if (!MUTATION_KINDS.has(input.mutationKind)) fail('Sale reference mutation kind is invalid.')
  const targetKey = saleReferenceTargetKey(input.mutationKind, targetInputFromKey(input.mutationKind, input.targetKey))
  if (targetKey !== input.targetKey || bytes(targetKey) > 160) fail('Sale reference mutation target key is invalid.')
  const requestId = requireSaleReferenceRequestId(input.requestId)
  if (requestId !== input.requestId) fail('Sale reference request id must already be trimmed.')
  if (!SHA256.test(input.requestDigest)) fail('Sale reference request digest is invalid.')
  const occurredAt = validateTimestamp(input.occurredAt)
  const responseJson = validateResponse(input.mutationKind, input.id, occurredAt, input.response)
  return {
    sql: `INSERT INTO sale_reference_mutation_receipts(
      id,actor_id,mutation_kind,target_key,request_id,request_digest,response_json,occurred_at
    ) VALUES(
      @id,@actorId,@mutationKind,@targetKey,@requestId,@requestDigest,@responseJson,@occurredAt
    )`,
    params: {
      id: input.id,
      actorId: input.actorId,
      mutationKind: input.mutationKind,
      targetKey,
      requestId,
      requestDigest: input.requestDigest,
      responseJson,
      occurredAt,
    },
  }
}

function targetInputFromKey(kind: SaleReferenceMutationKind, key: string): Record<string, unknown> {
  const value = String(key || '')
  let match: RegExpMatchArray | null
  if (kind === 'customer_profile_carry' && (match = value.match(/^customer:([1-9]\d*)$/))) return { target_id: Number(match[1]) }
  if (kind === 'delivery_contact_carry' && (match = value.match(/^delivery_contact:([1-9]\d*)$/))) return { target_id: Number(match[1]) }
  if (kind === 'customer_merge' && (match = value.match(/^customer_merge:([1-9]\d*):([1-9]\d*)$/))) return { keep_id: Number(match[1]), merge_id: Number(match[2]) }
  if (kind === 'delivery_contact_merge' && (match = value.match(/^delivery_contact_merge:([1-9]\d*):([1-9]\d*)$/))) return { keep_id: Number(match[1]), merge_id: Number(match[2]) }
  if (kind === 'customer_link_repair' && (match = value.match(/^customer_link:([1-9]\d*):([0-9a-f]{64})$/))) return { current_id: Number(match[1]), phone_group_digest: match[2] }
  if (kind === 'customer_missing_resolve' && (match = value.match(/^customer_missing:([0-9a-f]{64})$/))) return { group_digest: match[1] }
  if (kind === 'payment_method_replace' && (match = value.match(/^payment_method:([0-9a-f]{64})$/))) return { source_digest: match[1] }
  fail('Sale reference mutation target key is invalid.')
}

export async function findSaleReferenceReceipt(
  db: D1Compat,
  actorId: number,
  mutationKind: SaleReferenceMutationKind,
  requestId: string,
  requestDigest: string,
): Promise<SaleReferenceMutationResponse | null> {
  const row = await db.prepare(`SELECT request_digest,response_json
    FROM sale_reference_mutation_receipts
    WHERE actor_id=@actorId AND mutation_kind=@mutationKind AND request_id=@requestId`).get<{
      request_digest: string
      response_json: string
    }>({ actorId, mutationKind, requestId })
  if (!row) return null
  if (row.request_digest !== requestDigest) {
    throw new SaleReferenceMutationError('idempotency_conflict', 'client_request_id was already used with different linked Sales data.')
  }
  return JSON.parse(row.response_json) as SaleReferenceMutationResponse
}

export type SaleReferenceBounds = {
  candidates: number
  max_event_bytes: number
  aggregate_event_bytes: number
}

export function saleReferenceBoundsSql(sharedCtes: string): string {
  return `${sharedCtes}
    SELECT
      (SELECT COUNT(*) FROM mutationCandidates) AS candidates,
      COALESCE((SELECT MAX(length(CAST(projected_event_json AS BLOB))) FROM eventProjection),0) AS max_event_bytes,
      COALESCE((SELECT SUM(length(CAST(projected_event_json AS BLOB))) FROM eventProjection),0) AS aggregate_event_bytes`
}

export async function assertSaleReferencePreflight(
  db: D1Compat,
  sharedCtes: string,
  params: Record<string, unknown>,
): Promise<SaleReferenceBounds> {
  const row = await db.prepare(saleReferenceBoundsSql(sharedCtes)).get<SaleReferenceBounds>(params)
  const bounds = {
    candidates: Number(row?.candidates || 0),
    max_event_bytes: Number(row?.max_event_bytes || 0),
    aggregate_event_bytes: Number(row?.aggregate_event_bytes || 0),
  }
  if (bounds.candidates > SALE_REFERENCE_MAX_CANDIDATES) {
    throw new SaleReferenceMutationError('too_many_linked_sales', `This action affects more than ${SALE_REFERENCE_MAX_CANDIDATES} sales.`)
  }
  if (bounds.max_event_bytes > SALE_REFERENCE_MAX_EVENT_BYTES
    || bounds.aggregate_event_bytes > SALE_REFERENCE_MAX_AGGREGATE_EVENT_BYTES) {
    throw new SaleReferenceMutationError('sale_record_event_too_large', 'Linked Sales history is too large for one atomic action.')
  }
  return bounds
}

export function saleReferenceGuardInsert(
  operationId: string,
  sharedCtes: string,
  params: Record<string, unknown>,
): SaleReferenceStatement {
  if (!UUID_V4.test(operationId)) fail('Sale reference operation id must be a lowercase UUID v4.')
  return {
    sql: `${sharedCtes}
      INSERT INTO sale_reference_mutation_guards(operation_id,guard_value)
      SELECT @saleReferenceOperationId,CASE WHEN
        (SELECT COUNT(*) FROM mutationCandidates)<=${SALE_REFERENCE_MAX_CANDIDATES}
        AND COALESCE((SELECT MAX(length(CAST(projected_event_json AS BLOB))) FROM eventProjection),0)<=${SALE_REFERENCE_MAX_EVENT_BYTES}
        AND COALESCE((SELECT SUM(length(CAST(projected_event_json AS BLOB))) FROM eventProjection),0)<=${SALE_REFERENCE_MAX_AGGREGATE_EVENT_BYTES}
        THEN 1 ELSE 0 END`,
    params: { ...params, saleReferenceOperationId: operationId },
  }
}

export function saleReferenceGuardDelete(operationId: string): SaleReferenceStatement {
  if (!UUID_V4.test(operationId)) fail('Sale reference operation id must be a lowercase UUID v4.')
  return {
    sql: 'DELETE FROM sale_reference_mutation_guards WHERE operation_id=@saleReferenceOperationId',
    params: { saleReferenceOperationId: operationId },
  }
}

export function classifySaleReferenceConstraint(error: unknown): SaleReferenceMutationError | null {
  const message = error instanceof Error ? error.message : String(error)
  if (/sale_reference_mutation_guards|CHECK constraint failed/i.test(message)) {
    return new SaleReferenceMutationError('sale_record_event_too_large', 'Linked Sales history is too large for one atomic action.')
  }
  return null
}
