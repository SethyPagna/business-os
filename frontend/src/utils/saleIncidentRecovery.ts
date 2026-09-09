import { apiFetch, cacheInvalidate, cacheInvalidateWithDerived } from '../api/http.ts'

export const SALE_INCIDENT_RECOVERY_APPLY_TIMEOUT_MS = 10 * 60 * 1000
export const SALE_INCIDENT_RECOVERY_TARGET = 'sale-zero-items-20260909-v1' as const
export const SALE_INCIDENT_RECOVERY_CONFIRMATION = 'RECOVER SALES 16951 16952 16953' as const
const PREVIEW_PATH = '/api/system/sale-incident-recovery-20260909/preview'
const APPLY_PATH = '/api/system/sale-incident-recovery-20260909/apply'

export type SaleIncidentRecoveryRequest = Readonly<{
  target: typeof SALE_INCIDENT_RECOVERY_TARGET
  confirmation: typeof SALE_INCIDENT_RECOVERY_CONFIRMATION
  manifest_sha256: string
}>

export type SaleIncidentRecoverySale = {
  id: number
  receipt_number: string
  status: 'completed' | 'awaiting_payment'
  expected_revision: number
  line_count: number
  stock_effect: 'deduct_now' | 'released_allocation_only'
  subtotal_before_usd: number
  subtotal_after_usd: number
  total_before_usd: number
  total_after_usd: number
}

export type SaleIncidentRecoveryBlockedSale = {
  id: 16954
  receipt_number: '20260909-130228'
  reason: 'sale_time_cost_not_proven'
}

export type SaleIncidentRecoveryPreview = {
  success: true
  target: typeof SALE_INCIDENT_RECOVERY_TARGET
  outcome: 'apply' | 'already_applied'
  request: SaleIncidentRecoveryRequest
  sales: SaleIncidentRecoverySale[]
  blocked_sales: SaleIncidentRecoveryBlockedSale[]
  unknown_line_fields: ['price_mode', 'base_price_usd', 'base_price_khr']
  allocation_basis: 'recovery_time_unique_positive_lot_not_historical_proof'
}

type SaleIncidentRecoveryResponseBase = {
  operation_id: string
  manifest_sha256: string
  verification_pending: boolean
  cache_invalidated: boolean
  refresh_pending: boolean
  message: string
}

export type SaleIncidentRecoveryApplyResponse = SaleIncidentRecoveryResponseBase & {
  success: true
  outcome: 'applied' | 'already_applied'
  affected: { sales: 3; items: 4; allocations: 4; movements: 1; histories: 3; audits: 3 }
  broadcast_requested: true
}

export type SaleIncidentRecoveryUncertainResponse = SaleIncidentRecoveryResponseBase & {
  success: false
  outcome: 'uncertain'
  verification_pending: true
  cache_invalidated: false
  refresh_pending: true
  broadcast_requested: false
}

export type SaleIncidentRecoveryApplyResult = SaleIncidentRecoveryApplyResponse | SaleIncidentRecoveryUncertainResponse

function invalid(message: string): never {
  const error = new Error(`Invalid sale incident recovery response: ${message}`) as Error & { code?: string }
  error.code = 'invalid_sale_incident_recovery_response'
  throw error
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object`)
  return value as Record<string, unknown>
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child)
  }
  return value
}

function exactRequest(value: unknown): SaleIncidentRecoveryRequest {
  const request = asRecord(value, 'request')
  const keys = Object.keys(request).sort().join(',')
  if (keys !== 'confirmation,manifest_sha256,target'
    || request.target !== SALE_INCIDENT_RECOVERY_TARGET
    || request.confirmation !== SALE_INCIDENT_RECOVERY_CONFIRMATION
    || typeof request.manifest_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(request.manifest_sha256)) {
    invalid('request is not the server-issued fixed target, confirmation, and SHA-256 digest')
  }
  return freezeDeep({
    target: request.target,
    confirmation: request.confirmation,
    manifest_sha256: request.manifest_sha256,
  })
}

function asCount(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(`${label} must be a non-negative integer`)
  return Number(value)
}

function asAmount(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(`${label} must be a finite number`)
  return value
}

function validateSale(value: unknown, index: number): SaleIncidentRecoverySale {
  const sale = asRecord(value, `sales[${index}]`)
  return {
    id: asCount(sale.id, `sales[${index}].id`),
    receipt_number: typeof sale.receipt_number === 'string' && sale.receipt_number.trim() ? sale.receipt_number : invalid(`sales[${index}].receipt_number is required`),
    status: sale.status === 'completed' || sale.status === 'awaiting_payment' ? sale.status : invalid(`sales[${index}].status is invalid`),
    expected_revision: asCount(sale.expected_revision, `sales[${index}].expected_revision`),
    line_count: asCount(sale.line_count, `sales[${index}].line_count`),
    stock_effect: sale.stock_effect === 'deduct_now' || sale.stock_effect === 'released_allocation_only' ? sale.stock_effect : invalid(`sales[${index}].stock_effect is invalid`),
    subtotal_before_usd: asAmount(sale.subtotal_before_usd, `sales[${index}].subtotal_before_usd`),
    subtotal_after_usd: asAmount(sale.subtotal_after_usd, `sales[${index}].subtotal_after_usd`),
    total_before_usd: asAmount(sale.total_before_usd, `sales[${index}].total_before_usd`),
    total_after_usd: asAmount(sale.total_after_usd, `sales[${index}].total_after_usd`),
  }
}

export function validateSaleIncidentRecoveryPreview(value: unknown): SaleIncidentRecoveryPreview {
  const preview = asRecord(value, 'preview')
  if (preview.success !== true || preview.target !== SALE_INCIDENT_RECOVERY_TARGET
    || (preview.outcome !== 'apply' && preview.outcome !== 'already_applied')
    || !Array.isArray(preview.sales) || !Array.isArray(preview.blocked_sales)
    || !Array.isArray(preview.unknown_line_fields)
    || preview.allocation_basis !== 'recovery_time_unique_positive_lot_not_historical_proof') {
    invalid('preview is incomplete')
  }
  const sales = preview.sales.map(validateSale)
  if (!sales.length || new Set(sales.map((sale) => sale.id)).size !== sales.length) invalid('preview sales must be a non-empty unique set')
  if (preview.unknown_line_fields.length !== 3 || preview.unknown_line_fields.join(',') !== 'price_mode,base_price_usd,base_price_khr') invalid('unknown line fields do not match the reviewed recovery basis')
  const blockedSales = preview.blocked_sales.map((value, index) => {
    const sale = asRecord(value, `blocked_sales[${index}]`)
    if (sale.id !== 16954 || sale.receipt_number !== '20260909-130228' || sale.reason !== 'sale_time_cost_not_proven') invalid(`blocked_sales[${index}] is not the fixed excluded receipt`)
    return { id: 16954, receipt_number: '20260909-130228', reason: 'sale_time_cost_not_proven' } as SaleIncidentRecoveryBlockedSale
  })
  if (sales.some((sale) => blockedSales.some((blocked) => blocked.id === sale.id))) invalid('a fixed excluded receipt appears in the apply sales')
  return {
    success: true,
    target: SALE_INCIDENT_RECOVERY_TARGET,
    outcome: preview.outcome,
    request: exactRequest(preview.request),
    sales,
    blocked_sales: blockedSales,
    unknown_line_fields: ['price_mode', 'base_price_usd', 'base_price_khr'],
    allocation_basis: 'recovery_time_unique_positive_lot_not_historical_proof',
  }
}

export function validateSaleIncidentRecoveryApplyResponse(value: unknown): SaleIncidentRecoveryApplyResult {
  const response = asRecord(value, 'apply response')
  if ((response.success !== true && response.success !== false) || !['applied', 'already_applied', 'uncertain'].includes(String(response.outcome))
    || typeof response.verification_pending !== 'boolean' || typeof response.cache_invalidated !== 'boolean'
    || typeof response.refresh_pending !== 'boolean' || typeof response.broadcast_requested !== 'boolean'
    || typeof response.operation_id !== 'string' || !response.operation_id.trim()
    || typeof response.manifest_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(response.manifest_sha256)
    || typeof response.message !== 'string' || !response.message.trim()) invalid('apply response is incomplete')
  if (!response.cache_invalidated && !response.refresh_pending) invalid('a non-invalidated cache must require refresh')
  if (response.success === false) {
    if (response.outcome !== 'uncertain' || response.verification_pending !== true || response.cache_invalidated !== false
      || response.refresh_pending !== true || response.broadcast_requested !== false || Object.prototype.hasOwnProperty.call(response, 'affected')) invalid('uncertain response is not replay-safe')
    return response as unknown as SaleIncidentRecoveryUncertainResponse
  }
  if ((response.outcome !== 'applied' && response.outcome !== 'already_applied') || response.broadcast_requested !== true) invalid('apply response outcome is invalid')
  const affected = asRecord(response.affected, 'apply response.affected')
  if (affected.sales !== 3 || affected.items !== 4 || affected.allocations !== 4 || affected.movements !== 1 || affected.histories !== 3 || affected.audits !== 3) invalid('apply response affected counts do not match the fixed recovery')
  return response as unknown as SaleIncidentRecoveryApplyResponse
}

export function saleIncidentRecoveryIsComplete(result: SaleIncidentRecoveryApplyResult | null): boolean {
  return result?.success === true && result.verification_pending === false && result.refresh_pending === false && result.cache_invalidated === true
}

export async function previewSaleIncidentRecovery(): Promise<SaleIncidentRecoveryPreview> {
  return validateSaleIncidentRecoveryPreview(await apiFetch('GET', PREVIEW_PATH))
}

export async function applySaleIncidentRecovery(request: SaleIncidentRecoveryRequest): Promise<SaleIncidentRecoveryApplyResult> {
  const result = validateSaleIncidentRecoveryApplyResponse(await apiFetch('POST', APPLY_PATH, request, SALE_INCIDENT_RECOVERY_APPLY_TIMEOUT_MS))
  if (saleIncidentRecoveryIsComplete(result)) {
    cacheInvalidateWithDerived('sales')
    cacheInvalidateWithDerived('products')
    cacheInvalidate('inventory')
    cacheInvalidate('actionHistory')
  }
  return result
}
