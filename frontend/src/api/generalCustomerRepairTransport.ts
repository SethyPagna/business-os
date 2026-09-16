import { apiFetch, cacheInvalidate, cacheInvalidateWithDerived } from './http.ts'

export const GENERAL_CUSTOMER_REPAIR_STEP = 'mark_shared_general_24969' as const
export const GENERAL_CUSTOMER_REPAIR_CONFIRMATION = 'MARK CUSTOMER 24969 AS SHARED GENERAL' as const
export const GENERAL_CUSTOMER_REPAIR_APPLY_TIMEOUT_MS = 10 * 60 * 1000

export type GeneralCustomerRepairRequest = {
  step: typeof GENERAL_CUSTOMER_REPAIR_STEP
  confirmation: typeof GENERAL_CUSTOMER_REPAIR_CONFIRMATION
  manifest_sha256: string
  expected_updated_at: string | null
}

export type GeneralCustomerRepairPreview = {
  success: true
  outcome: 'ready' | 'already_applied'
  request: GeneralCustomerRepairRequest
  target: { id: 24969; name: 'general'; phone_state: 'known_empty'; address_state: 'known_null' | 'known_empty' | 'known_present'; is_anonymous: 0 | 1; portal_account_count: number; sale_count: number; return_count: number }
  protected_customer: { id: 22305; is_anonymous: 0 }
}

export type GeneralCustomerRepairApplyResponse = {
  success: true
  outcome: 'applied' | 'already_applied'
  affected: { customers: 0 | 1 }
  verification_pending: boolean
  cache_invalidated: boolean
  refresh_pending: boolean
  broadcast_requested: true
  message: string
}

const PREVIEW_PATH = '/api/system/shared-general-customer-repair/preview'
const APPLY_PATH = '/api/system/finalize-migration'

function invalid(message: string): never {
  const error = new Error(`Invalid shared General customer repair response: ${message}`) as Error & { code?: string }
  error.code = 'invalid_general_customer_repair_response'
  throw error
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  if (Object.keys(value).sort().join(',') !== [...expected].sort().join(',')) invalid(`${label} fields do not match the fixed repair contract`)
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child)
  }
  return value
}

export function validateGeneralCustomerRepairPreview(value: unknown): GeneralCustomerRepairPreview {
  const preview = record(value, 'preview')
  exactKeys(preview, ['success', 'outcome', 'request', 'target', 'protected_customer'], 'preview')
  if (preview.success !== true || (preview.outcome !== 'ready' && preview.outcome !== 'already_applied')) invalid('preview outcome is not ready or already_applied')
  const request = record(preview.request, 'request')
  exactKeys(request, ['step', 'confirmation', 'manifest_sha256', 'expected_updated_at'], 'request')
  if (request.step !== GENERAL_CUSTOMER_REPAIR_STEP || request.confirmation !== GENERAL_CUSTOMER_REPAIR_CONFIRMATION
    || typeof request.manifest_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(request.manifest_sha256)
    || !(request.expected_updated_at === null || typeof request.expected_updated_at === 'string')) invalid('request is not the exact fixed repair request')
  const target = record(preview.target, 'target')
  exactKeys(target, ['id', 'name', 'phone_state', 'address_state', 'is_anonymous', 'portal_account_count', 'sale_count', 'return_count'], 'target')
  if (target.id !== 24969 || target.name !== 'general' || target.phone_state !== 'known_empty'
    || !['known_null', 'known_empty', 'known_present'].includes(String(target.address_state))
    || ![0, 1].includes(Number(target.is_anonymous))
    || !['portal_account_count', 'sale_count', 'return_count'].every((key) => Number.isSafeInteger(Number(target[key])) && Number(target[key]) >= 0)) invalid('target is outside the fixed redacted cohort')
  const protectedCustomer = record(preview.protected_customer, 'protected_customer')
  exactKeys(protectedCustomer, ['id', 'is_anonymous'], 'protected_customer')
  if (protectedCustomer.id !== 22305 || protectedCustomer.is_anonymous !== 0) invalid('protected customer is not unchanged')
  freezeDeep(request)
  return preview as unknown as GeneralCustomerRepairPreview
}

export function validateGeneralCustomerRepairApplyResponse(value: unknown): GeneralCustomerRepairApplyResponse {
  const response = record(value, 'apply response')
  exactKeys(response, ['success', 'outcome', 'affected', 'verification_pending', 'cache_invalidated', 'refresh_pending', 'broadcast_requested', 'message'], 'apply response')
  if (response.success !== true || (response.outcome !== 'applied' && response.outcome !== 'already_applied')
    || typeof response.verification_pending !== 'boolean' || typeof response.cache_invalidated !== 'boolean'
    || typeof response.refresh_pending !== 'boolean' || response.broadcast_requested !== true
    || typeof response.message !== 'string' || !response.message.trim()) invalid('apply response is not a complete success result')
  const affected = record(response.affected, 'apply response.affected')
  exactKeys(affected, ['customers'], 'apply response.affected')
  if (affected.customers !== 0 && affected.customers !== 1) invalid('apply response affected customer count is invalid')
  if ((response.outcome === 'applied') !== (affected.customers === 1)) invalid('apply response outcome and affected customer count disagree')
  if (response.refresh_pending !== !response.cache_invalidated) invalid('apply response refresh and cache invalidation flags disagree')
  return response as unknown as GeneralCustomerRepairApplyResponse
}

export async function previewGeneralCustomerRepair(): Promise<GeneralCustomerRepairPreview> {
  return validateGeneralCustomerRepairPreview(await apiFetch('GET', PREVIEW_PATH))
}

export async function applyGeneralCustomerRepair(request: GeneralCustomerRepairRequest): Promise<GeneralCustomerRepairApplyResponse> {
  const result = validateGeneralCustomerRepairApplyResponse(await apiFetch('POST', APPLY_PATH, request, GENERAL_CUSTOMER_REPAIR_APPLY_TIMEOUT_MS))
  cacheInvalidateWithDerived('customers')
  cacheInvalidate('actionHistory')
  return result
}
