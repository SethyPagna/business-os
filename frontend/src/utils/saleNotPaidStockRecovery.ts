import { apiFetch, cacheInvalidate, cacheInvalidateWithDerived } from '../api/http.ts'

export const SALE_NOT_PAID_STOCK_RECOVERY_APPLY_TIMEOUT_MS = 10 * 60 * 1000
export const SALE_NOT_PAID_STOCK_RECOVERY_TARGET = 'sale-not-paid-stock-recovery-20260909-v1' as const
export const SALE_NOT_PAID_STOCK_RECOVERY_CONFIRMATION = 'CORRECT NOT PAID STOCK 16952 16953 16954' as const

const PREVIEW_PATH = '/api/system/sale-not-paid-stock-recovery-20260909/preview'
const APPLY_PATH = '/api/system/sale-not-paid-stock-recovery-20260909/apply'
const SALE_IDS = [16952, 16953, 16954] as const
const AFFECTED = { sales: 3, items: 4, allocations: 4, units: 4, movements: 4, histories: 3, audits: 3 } as const
const SUMMARY = { sales: 3, items: 4, allocations: 4, units: 4, movements: 4 } as const

export type SaleNotPaidStockRecoveryRequest = Readonly<{
  target: typeof SALE_NOT_PAID_STOCK_RECOVERY_TARGET
  confirmation: typeof SALE_NOT_PAID_STOCK_RECOVERY_CONFIRMATION
  manifest_sha256: string
}>

export type SaleNotPaidStockRecoverySale = Readonly<{
  id: (typeof SALE_IDS)[number]
  receipt_number: string
  status: 'awaiting_payment'
  line_count: number
  unit_count: number
  stock_effect: 'deduct_now'
}>

export type SaleNotPaidStockRecoveryPreview = Readonly<{
  success: true
  target: typeof SALE_NOT_PAID_STOCK_RECOVERY_TARGET
  outcome: 'apply' | 'already_applied'
  request: SaleNotPaidStockRecoveryRequest
  sales: readonly SaleNotPaidStockRecoverySale[]
  summary: typeof SUMMARY
}>

type ResponseBase = Readonly<{
  operation_id: string
  manifest_sha256: string
  verification_pending: boolean
  cache_invalidated: boolean
  refresh_pending: boolean
  broadcast_requested: boolean
  message: string
}>

export type SaleNotPaidStockRecoveryApplied = ResponseBase & Readonly<{
  success: true
  outcome: 'applied' | 'already_applied'
  affected: typeof AFFECTED
  broadcast_requested: true
}>

export type SaleNotPaidStockRecoveryUncertain = ResponseBase & Readonly<{
  success: false
  outcome: 'uncertain'
  verification_pending: true
  cache_invalidated: false
  refresh_pending: true
  broadcast_requested: false
}>

export type SaleNotPaidStockRecoveryResult = SaleNotPaidStockRecoveryApplied | SaleNotPaidStockRecoveryUncertain

function invalid(message: string): never {
  const error = new Error(`Invalid Not Paid stock recovery response: ${message}`) as Error & { code?: string }
  error.code = 'invalid_sale_not_paid_stock_recovery_response'
  throw error
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object`)
  return value as Record<string, unknown>
}

function positiveCount(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) invalid(`${label} must be a positive safe integer`)
  return Number(value)
}

function exactCounts(value: unknown, expected: Record<string, number>, label: string): void {
  const counts = record(value, label)
  if (Object.keys(counts).sort().join(',') !== Object.keys(expected).sort().join(',')
    || Object.entries(expected).some(([key, count]) => counts[key] !== count)) invalid(`${label} does not match the fixed recovery`)
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid(`${label} must be a lowercase SHA-256 digest`)
  return value
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const item of Object.values(value as Record<string, unknown>)) freeze(item)
  }
  return value
}

function exactRequest(value: unknown): SaleNotPaidStockRecoveryRequest {
  const request = record(value, 'request')
  if (Object.keys(request).sort().join(',') !== 'confirmation,manifest_sha256,target'
    || request.target !== SALE_NOT_PAID_STOCK_RECOVERY_TARGET
    || request.confirmation !== SALE_NOT_PAID_STOCK_RECOVERY_CONFIRMATION) invalid('request must be the server-issued target and confirmation')
  return freeze({ target: SALE_NOT_PAID_STOCK_RECOVERY_TARGET, confirmation: SALE_NOT_PAID_STOCK_RECOVERY_CONFIRMATION, manifest_sha256: digest(request.manifest_sha256, 'request.manifest_sha256') })
}

function sale(value: unknown, index: number): SaleNotPaidStockRecoverySale {
  const item = record(value, `sales[${index}]`)
  const id = item.id
  if (!SALE_IDS.includes(id as (typeof SALE_IDS)[number]) || item.status !== 'awaiting_payment' || item.stock_effect !== 'deduct_now'
    || typeof item.receipt_number !== 'string' || !item.receipt_number.trim()) invalid(`sales[${index}] is not a fixed awaiting-payment stock deduction`)
  return freeze({
    id: id as (typeof SALE_IDS)[number],
    receipt_number: item.receipt_number,
    status: 'awaiting_payment',
    line_count: positiveCount(item.line_count, `sales[${index}].line_count`),
    unit_count: positiveCount(item.unit_count, `sales[${index}].unit_count`),
    stock_effect: 'deduct_now',
  })
}

export function validateSaleNotPaidStockRecoveryPreview(value: unknown): SaleNotPaidStockRecoveryPreview {
  const preview = record(value, 'preview')
  if (preview.success !== true || preview.target !== SALE_NOT_PAID_STOCK_RECOVERY_TARGET
    || (preview.outcome !== 'apply' && preview.outcome !== 'already_applied') || !Array.isArray(preview.sales)) invalid('preview is incomplete')
  const sales = preview.sales.map(sale)
  if (sales.map((item) => item.id).join(',') !== SALE_IDS.join(',')) invalid('preview sales do not match the fixed recovery')
  exactCounts(preview.summary, SUMMARY, 'preview.summary')
  return freeze({ success: true, target: SALE_NOT_PAID_STOCK_RECOVERY_TARGET, outcome: preview.outcome, request: exactRequest(preview.request), sales, summary: SUMMARY })
}

export function validateSaleNotPaidStockRecoveryResponse(value: unknown): SaleNotPaidStockRecoveryResult {
  const response = record(value, 'apply response')
  if ((response.success !== true && response.success !== false) || !['applied', 'already_applied', 'uncertain'].includes(String(response.outcome))
    || typeof response.verification_pending !== 'boolean' || typeof response.cache_invalidated !== 'boolean'
    || typeof response.refresh_pending !== 'boolean' || typeof response.broadcast_requested !== 'boolean'
    || typeof response.operation_id !== 'string' || !response.operation_id.trim()
    || typeof response.message !== 'string' || !response.message.trim()) invalid('apply response is incomplete')
  digest(response.manifest_sha256, 'apply response.manifest_sha256')
  if (!response.cache_invalidated && !response.refresh_pending) invalid('a non-invalidated cache must require refresh')
  if (response.success === false) {
    if (response.outcome !== 'uncertain' || response.verification_pending !== true || response.cache_invalidated !== false
      || response.refresh_pending !== true || response.broadcast_requested !== false || Object.prototype.hasOwnProperty.call(response, 'affected')) invalid('uncertain response is not replay-safe')
    return response as SaleNotPaidStockRecoveryUncertain
  }
  if ((response.outcome !== 'applied' && response.outcome !== 'already_applied') || response.broadcast_requested !== true) invalid('apply response outcome is invalid')
  exactCounts(response.affected, AFFECTED, 'apply response.affected')
  return response as SaleNotPaidStockRecoveryApplied
}

export function saleNotPaidStockRecoveryIsComplete(result: SaleNotPaidStockRecoveryResult | null): boolean {
  return result?.success === true && result.cache_invalidated === true && result.refresh_pending === false && result.verification_pending === false
}

export async function previewSaleNotPaidStockRecovery(): Promise<SaleNotPaidStockRecoveryPreview> {
  return validateSaleNotPaidStockRecoveryPreview(await apiFetch('GET', PREVIEW_PATH))
}

export async function applySaleNotPaidStockRecovery(request: SaleNotPaidStockRecoveryRequest): Promise<SaleNotPaidStockRecoveryResult> {
  const result = validateSaleNotPaidStockRecoveryResponse(await apiFetch('POST', APPLY_PATH, request, SALE_NOT_PAID_STOCK_RECOVERY_APPLY_TIMEOUT_MS))
  if (saleNotPaidStockRecoveryIsComplete(result)) {
    cacheInvalidateWithDerived('sales')
    cacheInvalidateWithDerived('products')
    cacheInvalidate('inventory')
    cacheInvalidate('actionHistory')
  }
  return result
}
