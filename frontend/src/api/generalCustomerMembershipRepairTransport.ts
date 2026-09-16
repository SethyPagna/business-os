import { apiFetch, cacheInvalidate, cacheInvalidateWithDerived } from './http.ts'

export const GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_STEP = 'clear_shared_general_membership_24969' as const
export const GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_CONFIRMATION = 'CLEAR MEMBERSHIP 24969 SHARED GENERAL' as const
export const GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_APPLY_TIMEOUT_MS = 10 * 60 * 1000

export type GeneralCustomerMembershipRepairRequest = {
  step: typeof GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_STEP
  confirmation: typeof GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_CONFIRMATION
  manifest_sha256: string
  expected_updated_at: string | null
}

export type GeneralCustomerMembershipRepairPreview = {
  success: true
  outcome: 'ready' | 'already_applied'
  request: GeneralCustomerMembershipRepairRequest
  target: { id: 24969; name: 'general'; membership_state: 'legacy_value_present' | 'known_empty'; is_anonymous: 1; sale_count: number; return_count: number }
  protected_customer: { id: 22305; is_anonymous: 0 }
}

export type GeneralCustomerMembershipRepairApplyResponse = {
  success: true
  outcome: 'applied' | 'already_applied'
  affected: { customers: 0 | 1 }
  verification_pending: boolean
  cache_invalidated: boolean
  refresh_pending: boolean
  broadcast_requested: true
  message: string
}

const PREVIEW_PATH = '/api/system/shared-general-customer-membership-repair/preview'
const APPLY_PATH = '/api/system/shared-general-customer-membership-repair/apply'

function invalid(message: string): never { throw new Error(`Invalid shared General membership repair response: ${message}`) }
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object`)
  return value as Record<string, unknown>
}
function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  if (Object.keys(value).sort().join(',') !== [...expected].sort().join(',')) invalid(`${label} fields do not match the fixed repair contract`)
}
function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child) }
  return value
}

export function validateGeneralCustomerMembershipRepairPreview(value: unknown): GeneralCustomerMembershipRepairPreview {
  const preview = record(value, 'preview')
  exactKeys(preview, ['success', 'outcome', 'request', 'target', 'protected_customer'], 'preview')
  if (preview.success !== true || (preview.outcome !== 'ready' && preview.outcome !== 'already_applied')) invalid('preview outcome is invalid')
  const request = record(preview.request, 'request')
  exactKeys(request, ['step', 'confirmation', 'manifest_sha256', 'expected_updated_at'], 'request')
  if (request.step !== GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_STEP || request.confirmation !== GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_CONFIRMATION || typeof request.manifest_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(request.manifest_sha256) || !(request.expected_updated_at === null || typeof request.expected_updated_at === 'string')) invalid('request is invalid')
  const target = record(preview.target, 'target')
  exactKeys(target, ['id', 'name', 'membership_state', 'is_anonymous', 'sale_count', 'return_count'], 'target')
  if (target.id !== 24969 || target.name !== 'general' || !['legacy_value_present', 'known_empty'].includes(String(target.membership_state)) || target.is_anonymous !== 1 || !['sale_count', 'return_count'].every((key) => Number.isSafeInteger(Number(target[key])) && Number(target[key]) >= 0)) invalid('target is invalid')
  const protectedCustomer = record(preview.protected_customer, 'protected_customer')
  exactKeys(protectedCustomer, ['id', 'is_anonymous'], 'protected_customer')
  if (protectedCustomer.id !== 22305 || protectedCustomer.is_anonymous !== 0) invalid('protected customer is not unchanged')
  freezeDeep(request)
  return preview as unknown as GeneralCustomerMembershipRepairPreview
}

export function validateGeneralCustomerMembershipRepairApplyResponse(value: unknown): GeneralCustomerMembershipRepairApplyResponse {
  const response = record(value, 'apply response')
  exactKeys(response, ['success', 'outcome', 'affected', 'verification_pending', 'cache_invalidated', 'refresh_pending', 'broadcast_requested', 'message'], 'apply response')
  if (response.success !== true || (response.outcome !== 'applied' && response.outcome !== 'already_applied') || typeof response.verification_pending !== 'boolean' || typeof response.cache_invalidated !== 'boolean' || typeof response.refresh_pending !== 'boolean' || response.broadcast_requested !== true || typeof response.message !== 'string' || !response.message.trim()) invalid('apply response is invalid')
  const affected = record(response.affected, 'apply response.affected')
  exactKeys(affected, ['customers'], 'apply response.affected')
  if (affected.customers !== 0 && affected.customers !== 1 || (response.outcome === 'applied') !== (affected.customers === 1) || response.refresh_pending !== !response.cache_invalidated) invalid('apply response counts/refresh flags are invalid')
  return response as unknown as GeneralCustomerMembershipRepairApplyResponse
}

export async function previewGeneralCustomerMembershipRepair(): Promise<GeneralCustomerMembershipRepairPreview> { return validateGeneralCustomerMembershipRepairPreview(await apiFetch('GET', PREVIEW_PATH)) }

export async function applyGeneralCustomerMembershipRepair(request: GeneralCustomerMembershipRepairRequest): Promise<GeneralCustomerMembershipRepairApplyResponse> {
  const result = validateGeneralCustomerMembershipRepairApplyResponse(await apiFetch('POST', APPLY_PATH, request, GENERAL_CUSTOMER_MEMBERSHIP_REPAIR_APPLY_TIMEOUT_MS))
  cacheInvalidateWithDerived('customers'); cacheInvalidate('actionHistory')
  return result
}
