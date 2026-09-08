import { identityBarcodeKey, normalizeLeadingZeroBarcodeForCleanup, normalizeProductClusterKey } from './productIdentity'
import { normalizeProductGroupName, resolveMergedCostDetail } from './productDetailRule'
import { resolveProductMergeEconomics } from './productMerge'

export const PRODUCT_CONFLICT_MERGE_MANIFEST_VERSION = 1 as const
export const PRODUCT_CONFLICT_MERGE_MAX_CASES = 12
export const PRODUCT_CONFLICT_MERGE_MAX_PRODUCTS = 24

export type ProductConflictClusterType = 'leadingzero' | 'barcode' | 'name' | 'similar'
export type ProductConflictStockChoice = 'merge' | 'write_off' | null

export type ProductConflictPreviewCase = {
  case_key: string
  cluster_type: ProductConflictClusterType
  cluster_value: string
  product_ids: [number, number]
}

export type ProductConflictPreviewRequest = { cases: ProductConflictPreviewCase[] }

export type ProductConflictApplyCase = {
  ordinal: number
  case_key: string
  keep_id: number
  merge_id: number
  state_digest: string
  stock: ProductConflictStockChoice
}

export type ProductConflictApplyRequest = {
  client_request_id: string
  manifest_version: 1
  manifest_digest: string
  cases: ProductConflictApplyCase[]
}

export type ProductConflictEligibilityRow = Record<string, unknown> & {
  id: number
  name: string | null
  barcode: string | null
  is_active: number
  is_group: number
  stock_quantity: number
  cost_price_usd?: unknown
  cost_price_khr?: unknown
}

export type ProductConflictEligibility =
  | { eligible: true; keeper: ProductConflictEligibilityRow; discarded: ProductConflictEligibilityRow }
  | { eligible: false; code: 'not_exact_pair' | 'incompatible_product_identity' | 'invalid_merge_numeric' | 'cost_outlier_review'; message: string }

export function productConflictCaseKey(type: ProductConflictClusterType, value: unknown): string {
  const normalized = normalizeProductClusterKey(type, value)
  return normalized ? `${type}:${normalized}` : ''
}

export function parseProductConflictCaseKey(value: string): { cluster_type: ProductConflictClusterType; cluster_value: string } | null {
  const separator = value.indexOf(':')
  if (separator <= 0) return null
  const clusterType = value.slice(0, separator)
  if (clusterType !== 'leadingzero' && clusterType !== 'barcode' && clusterType !== 'name' && clusterType !== 'similar') return null
  const clusterValue = value.slice(separator + 1)
  if (!clusterValue || productConflictCaseKey(clusterType, clusterValue) !== value) return null
  return { cluster_type: clusterType, cluster_value: clusterValue }
}

export class ProductConflictMergeValidationError extends Error {
  constructor(
    message: string,
    readonly code = 'invalid_request',
    readonly status = 400,
  ) {
    super(message)
    this.name = 'ProductConflictMergeValidationError'
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProductConflictMergeValidationError(`${path} must be an object.`)
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const keys = Object.keys(value)
  const unknown = keys.filter((key) => !allowed.includes(key))
  const missing = allowed.filter((key) => !Object.prototype.hasOwnProperty.call(value, key))
  if (unknown.length || missing.length) {
    throw new ProductConflictMergeValidationError(
      `${path} has ${unknown.length ? `unsupported fields: ${unknown.join(', ')}` : `missing fields: ${missing.join(', ')}`}.`,
    )
  }
}

function safeId(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new ProductConflictMergeValidationError(`${path} must be a positive safe integer.`)
  }
  return value
}

function boundedString(value: unknown, path: string, maxLength: number): string {
  if (typeof value !== 'string') throw new ProductConflictMergeValidationError(`${path} must be a string.`)
  const text = value.trim()
  if (!text || text.length > maxLength || /[\u0000-\u001f]/.test(text)) {
    throw new ProductConflictMergeValidationError(`${path} must be a non-empty bounded string.`)
  }
  return text
}

function digest(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^sha256-[a-f0-9]{64}$/.test(value)) {
    throw new ProductConflictMergeValidationError(`${path} must be a SHA-256 digest.`)
  }
  return value
}

function assertCaseBounds(cases: readonly { case_key: string }[], productIds: readonly number[]): void {
  if (!cases.length || cases.length > PRODUCT_CONFLICT_MERGE_MAX_CASES) {
    throw new ProductConflictMergeValidationError(`cases must contain 1-${PRODUCT_CONFLICT_MERGE_MAX_CASES} entries.`)
  }
  if (new Set(cases.map((entry) => entry.case_key)).size !== cases.length) {
    throw new ProductConflictMergeValidationError('case_key values must be unique.')
  }
  if (new Set(productIds).size !== productIds.length) {
    throw new ProductConflictMergeValidationError('A product may appear in only one selected merge case.', 'overlapping_selection')
  }
  if (productIds.length > PRODUCT_CONFLICT_MERGE_MAX_PRODUCTS) {
    throw new ProductConflictMergeValidationError(`At most ${PRODUCT_CONFLICT_MERGE_MAX_PRODUCTS} distinct products are allowed.`)
  }
}

export function parseProductConflictPreviewRequest(value: unknown): ProductConflictPreviewRequest {
  const root = record(value, 'request')
  exactKeys(root, ['cases'], 'request')
  if (!Array.isArray(root.cases)) throw new ProductConflictMergeValidationError('request.cases must be an array.')
  const productIds: number[] = []
  const cases = root.cases.map((candidate, ordinal): ProductConflictPreviewCase => {
    const item = record(candidate, `cases[${ordinal}]`)
    exactKeys(item, ['case_key', 'cluster_type', 'cluster_value', 'product_ids'], `cases[${ordinal}]`)
    const caseKey = boundedString(item.case_key, `cases[${ordinal}].case_key`, 240)
    const clusterType = item.cluster_type
    if (clusterType !== 'leadingzero' && clusterType !== 'barcode' && clusterType !== 'name' && clusterType !== 'similar') {
      throw new ProductConflictMergeValidationError(`cases[${ordinal}].cluster_type is invalid.`)
    }
    const clusterValue = boundedString(item.cluster_value, `cases[${ordinal}].cluster_value`, 200)
    if (productConflictCaseKey(clusterType, clusterValue) !== caseKey) {
      throw new ProductConflictMergeValidationError(`cases[${ordinal}].case_key does not match its normalized cluster.`)
    }
    if (!Array.isArray(item.product_ids) || item.product_ids.length !== 2) {
      throw new ProductConflictMergeValidationError(`cases[${ordinal}].product_ids must contain exactly two ids.`)
    }
    const ids: [number, number] = [
      safeId(item.product_ids[0], `cases[${ordinal}].product_ids[0]`),
      safeId(item.product_ids[1], `cases[${ordinal}].product_ids[1]`),
    ]
    if (ids[0] === ids[1]) throw new ProductConflictMergeValidationError(`cases[${ordinal}].product_ids must be different.`)
    productIds.push(...ids)
    return { case_key: caseKey, cluster_type: clusterType, cluster_value: clusterValue, product_ids: ids }
  })
  assertCaseBounds(cases, productIds)
  return { cases }
}

export function parseProductConflictApplyRequest(value: unknown): ProductConflictApplyRequest {
  const root = record(value, 'request')
  exactKeys(root, ['client_request_id', 'manifest_version', 'manifest_digest', 'cases'], 'request')
  if (typeof root.client_request_id !== 'string' || !/^[A-Za-z0-9_-]{8,120}$/.test(root.client_request_id)) {
    throw new ProductConflictMergeValidationError('A stable client_request_id is required.')
  }
  if (root.manifest_version !== PRODUCT_CONFLICT_MERGE_MANIFEST_VERSION) {
    throw new ProductConflictMergeValidationError('manifest_version is unsupported.')
  }
  const manifestDigest = digest(root.manifest_digest, 'request.manifest_digest')
  if (!Array.isArray(root.cases)) throw new ProductConflictMergeValidationError('request.cases must be an array.')
  const productIds: number[] = []
  const cases = root.cases.map((candidate, index): ProductConflictApplyCase => {
    const item = record(candidate, `cases[${index}]`)
    exactKeys(item, ['ordinal', 'case_key', 'keep_id', 'merge_id', 'state_digest', 'stock'], `cases[${index}]`)
    if (typeof item.ordinal !== 'number' || !Number.isSafeInteger(item.ordinal) || item.ordinal !== index) {
      throw new ProductConflictMergeValidationError(`cases[${index}].ordinal must equal its ordered position.`)
    }
    const caseKey = boundedString(item.case_key, `cases[${index}].case_key`, 240)
    if (!parseProductConflictCaseKey(caseKey)) {
      throw new ProductConflictMergeValidationError(`cases[${index}].case_key is invalid.`)
    }
    const keepId = safeId(item.keep_id, `cases[${index}].keep_id`)
    const mergeId = safeId(item.merge_id, `cases[${index}].merge_id`)
    if (keepId === mergeId) throw new ProductConflictMergeValidationError(`cases[${index}] needs two different product ids.`)
    if (item.stock !== null && item.stock !== 'merge' && item.stock !== 'write_off') {
      throw new ProductConflictMergeValidationError(`cases[${index}].stock must be merge, write_off, or null.`)
    }
    productIds.push(keepId, mergeId)
    return {
      ordinal: index,
      case_key: caseKey,
      keep_id: keepId,
      merge_id: mergeId,
      state_digest: digest(item.state_digest, `cases[${index}].state_digest`),
      stock: item.stock,
    }
  })
  assertCaseBounds(cases, productIds)
  return {
    client_request_id: root.client_request_id,
    manifest_version: PRODUCT_CONFLICT_MERGE_MANIFEST_VERSION,
    manifest_digest: manifestDigest,
    cases,
  }
}

export function chooseProductConflictMergePair(rows: readonly ProductConflictEligibilityRow[]): ProductConflictEligibility {
  if (rows.length !== 2 || new Set(rows.map((row) => row.id)).size !== 2
    || rows.some((row) => !Number(row.is_active) || Number(row.is_group))) {
    return { eligible: false, code: 'not_exact_pair', message: 'The conflict must still contain exactly two active non-group products.' }
  }
  const [left, right] = rows
  const name = normalizeProductGroupName(left.name)
  if (!name || name !== normalizeProductGroupName(right.name)
    || identityBarcodeKey(left.barcode) !== identityBarcodeKey(right.barcode)) {
    return { eligible: false, code: 'incompatible_product_identity', message: 'The products no longer share the same normalized name and barcode.' }
  }
  const economics = resolveProductMergeEconomics(rows)
  if (economics.issues.length) {
    return { eligible: false, code: 'invalid_merge_numeric', message: 'One of the product money fields is not a valid non-negative decimal.' }
  }
  if (resolveMergedCostDetail([...rows]).outliers.length) {
    return { eligible: false, code: 'cost_outlier_review', message: 'The product costs are too far apart for an automatic merge.' }
  }
  const rawBarcodes = new Set(rows.map((row) => String(row.barcode ?? '').trim().toLowerCase()))
  const leadingZeroPair = rawBarcodes.size > 1
  const zerosShed = (row: ProductConflictEligibilityRow) => {
    const raw = String(row.barcode ?? '').trim().toLowerCase()
    return raw.length - normalizeLeadingZeroBarcodeForCleanup(raw).length
  }
  const ordered = [...rows].sort((a, b) => {
    if (leadingZeroPair) {
      const zeroDifference = zerosShed(a) - zerosShed(b)
      if (zeroDifference) return zeroDifference
    }
    const stockDifference = Number(b.stock_quantity || 0) - Number(a.stock_quantity || 0)
    if (stockDifference) return stockDifference
    return a.id - b.id
  })
  return { eligible: true, keeper: ordered[0], discarded: ordered[1] }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
      .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]))
  }
  return value
}

export function canonicalProductConflictJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export async function productConflictSha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalProductConflictJson(value))
  const hashed = await crypto.subtle.digest('SHA-256', bytes)
  return `sha256-${[...new Uint8Array(hashed)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export function productConflictOperationId(runId: string, ordinal: number): string {
  if (!runId || !Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= PRODUCT_CONFLICT_MERGE_MAX_CASES) {
    throw new Error('A selected conflict operation needs a run id and valid ordinal.')
  }
  return `product-conflict:${runId}:${ordinal}`
}
