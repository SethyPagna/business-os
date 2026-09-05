import { apiFetch, cacheInvalidate, cacheInvalidateWithDerived } from './http.ts'

export const LEGACY_SUBTOTAL_REPAIR_STEP = 'repair_sep23_subtotals' as const
export const LEGACY_SUBTOTAL_REPAIR_CONFIRMATION = 'APPLY_SEP23_SUBTOTAL_REPAIR' as const
export const LEGACY_SUBTOTAL_REPAIR_APPLY_TIMEOUT_MS = 10 * 60 * 1000

export type LegacySubtotalRepairSale = {
  id: number
  business_date: string
  expected_subtotal_usd: string
  target_subtotal_usd: string
  item_discount_usd: string
  [key: string]: unknown
}

export type LegacySubtotalRepairManifest = {
  plan_id: string
  sales: LegacySubtotalRepairSale[]
  [key: string]: unknown
}

export type LegacySubtotalRepairRequest = {
  step: typeof LEGACY_SUBTOTAL_REPAIR_STEP
  apply: true
  confirmation: typeof LEGACY_SUBTOTAL_REPAIR_CONFIRMATION
  manifest_sha256: string
  manifest: LegacySubtotalRepairManifest
}

export type LegacySubtotalRepairSummary = {
  sale_count: 22
  subtotal_usd: '3462.0000'
  item_discount_usd: '66.0000'
}

export type LegacySubtotalRepairPreview = {
  success: true
  state: 'ready'
  request: LegacySubtotalRepairRequest
  summary: LegacySubtotalRepairSummary
}

export type LegacySubtotalRepairNotReady = {
  success: false
  error: string
  state?: string
  request?: never
}

export type LegacySubtotalRepairPreviewResponse = LegacySubtotalRepairPreview | LegacySubtotalRepairNotReady

export type LegacySubtotalRepairApplyResponse = {
  success: boolean
  outcome?: string
  affected?: Record<string, number>
  message?: string
  error?: string
}

const PREVIEW_PATH = '/api/system/legacy-subtotal-repair/preview'
const APPLY_PATH = '/api/system/finalize-migration'
const EXPECTED_IDS = Object.freeze(Array.from({ length: 22 }, (_, index) => 16842 + index))
const EXPECTED_BY_DATE = Object.freeze({
  '2026-09-02': { firstId: 16859, lastId: 16863, subtotal: 19920000n, itemDiscount: 50000n },
  '2026-09-03': { firstId: 16842, lastId: 16858, subtotal: 14700000n, itemDiscount: 610000n },
})

function invalidPreview(message: string): never {
  const error = new Error(`Invalid legacy subtotal repair preview: ${message}`) as Error & { code?: string }
  error.code = 'invalid_legacy_subtotal_preview'
  throw error
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidPreview(`${label} must be an object`)
  return value as Record<string, unknown>
}

function scaled4(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || !/^\d+\.\d{4}$/.test(value)) invalidPreview(`${label} must be a four-decimal string`)
  const [whole, fraction] = value.split('.')
  return BigInt(whole) * 10000n + BigInt(fraction)
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child)
  }
  return value
}

export function validateLegacySubtotalRepairPreview(value: unknown): LegacySubtotalRepairPreviewResponse {
  const response = asRecord(value, 'response')
  if (response.success === false) {
    if (Object.prototype.hasOwnProperty.call(response, 'request')) invalidPreview('a non-ready response must not include a request')
    if (typeof response.error !== 'string' || !response.error.trim()) invalidPreview('a non-ready response must include an error')
    return response as LegacySubtotalRepairNotReady
  }

  if (response.success !== true || response.state !== 'ready') invalidPreview("ready response must use success:true and state:'ready'")
  const request = asRecord(response.request, 'request')
  const requestKeys = Object.keys(request).sort().join(',')
  if (requestKeys !== 'apply,confirmation,manifest,manifest_sha256,step') invalidPreview('request fields do not match the immutable apply contract')
  if (request.step !== LEGACY_SUBTOTAL_REPAIR_STEP || request.apply !== true || request.confirmation !== LEGACY_SUBTOTAL_REPAIR_CONFIRMATION) {
    invalidPreview('request action or confirmation does not match the allowlisted repair')
  }
  if (typeof request.manifest_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(request.manifest_sha256)) {
    invalidPreview('manifest_sha256 must be a lowercase SHA-256 digest')
  }

  const manifest = asRecord(request.manifest, 'request.manifest')
  if (typeof manifest.plan_id !== 'string' || !manifest.plan_id.trim()) invalidPreview('manifest.plan_id must not be blank')
  if (!Array.isArray(manifest.sales) || manifest.sales.length !== EXPECTED_IDS.length) invalidPreview('manifest.sales must contain exactly 22 rows')

  const sales = manifest.sales.map((value, index) => {
    const sale = asRecord(value, `manifest.sales[${index}]`)
    if (!Number.isSafeInteger(sale.id)) invalidPreview(`manifest.sales[${index}].id must be an integer`)
    const id = Number(sale.id)
    const expectedDate = id <= 16858 ? '2026-09-03' : '2026-09-02'
    if (sale.business_date !== expectedDate) invalidPreview(`sale ${id} has the wrong business date`)
    if (scaled4(sale.expected_subtotal_usd, `sale ${id} expected subtotal`) !== 0n) invalidPreview(`sale ${id} is not in the zero-subtotal before-state`)
    scaled4(sale.target_subtotal_usd, `sale ${id} target subtotal`)
    scaled4(sale.item_discount_usd, `sale ${id} item discount`)
    return sale as LegacySubtotalRepairSale
  }).sort((left, right) => left.id - right.id)

  if (sales.some((sale, index) => sale.id !== EXPECTED_IDS[index])) invalidPreview('manifest must contain each sale ID from 16842 through 16863 exactly once')
  for (const [businessDate, expected] of Object.entries(EXPECTED_BY_DATE)) {
    const rows = sales.filter((sale) => sale.business_date === businessDate)
    if (rows[0]?.id !== expected.firstId || rows.at(-1)?.id !== expected.lastId) invalidPreview(`${businessDate} has the wrong ID range`)
    const subtotal = rows.reduce((sum, sale) => sum + scaled4(sale.target_subtotal_usd, `sale ${sale.id} target subtotal`), 0n)
    const itemDiscount = rows.reduce((sum, sale) => sum + scaled4(sale.item_discount_usd, `sale ${sale.id} item discount`), 0n)
    if (subtotal !== expected.subtotal || itemDiscount !== expected.itemDiscount) invalidPreview(`${businessDate} totals do not match the fixed cohort`)
  }

  const summary = asRecord(response.summary, 'summary')
  if (summary.sale_count !== 22 || summary.subtotal_usd !== '3462.0000' || summary.item_discount_usd !== '66.0000') {
    invalidPreview('summary does not match 22 sales, USD 3462.0000, and USD 66.0000 item discount')
  }

  freezeDeep(request)
  return response as unknown as LegacySubtotalRepairPreview
}

export async function previewLegacySubtotalRepair(): Promise<LegacySubtotalRepairPreviewResponse> {
  const response = await apiFetch('GET', PREVIEW_PATH)
  return validateLegacySubtotalRepairPreview(response)
}

export async function applyLegacySubtotalRepair(request: LegacySubtotalRepairRequest): Promise<LegacySubtotalRepairApplyResponse> {
  const result = await apiFetch('POST', APPLY_PATH, request, LEGACY_SUBTOTAL_REPAIR_APPLY_TIMEOUT_MS) as LegacySubtotalRepairApplyResponse
  if (result?.success) {
    // This repair changes only sales.subtotal_usd. Mirror the normal sales
    // mutation invalidation without claiming that products/inventory/payments
    // changed, and expose the server-owned history record on its next read.
    cacheInvalidateWithDerived('sales')
    cacheInvalidate('actionHistory')
  }
  return result
}
