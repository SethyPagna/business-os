import { identityBarcodeKey } from './productIdentity'
import { normalizeProductGroupName } from './productDetailRule'
import { resolveProductMergeEconomics, type ProductMergeEconomics } from './productMerge'
import { ProductConflictMergeValidationError } from './productConflictMergeBatch'

export const PRODUCT_CONFLICT_ACTION_RESOLUTION_VERSION = 2 as const
export const PRODUCT_CONFLICT_ACTION_MAX_GROUPS = 1600
export const PRODUCT_CONFLICT_ACTION_MAX_MEMBERS = 4000
export const PRODUCT_CONFLICT_ACTION_MAX_MEMBERS_PER_GROUP = 100
export const PRODUCT_CONFLICT_ACTION_PAGE_MAX = 100
export const PRODUCT_CONFLICT_ACTION_READ_CHUNK = 80

export type ProductConflictActionGroupInput = { group_key: string; member_ids: number[] }
export type ProductConflictActionPreviewRequest = {
  manifest_version: 1
  resolution_version: 2
  client_request_id: string
  merge_groups: ProductConflictActionGroupInput[]
  remove_rows: []
}

export type ProductConflictActionProductRow = Record<string, unknown> & {
  id: number
  name: string | null
  barcode: string | null
  category: string | null
  brand: string | null
  unit: string | null
  image_path: string | null
  is_active: number
  is_group: number
  updated_at: string | null
}

export type ProductConflictActionStockRow = { product_id: number; branch_id: number; branch_name: string | null; quantity: number }
export type ProductConflictActionLotRow = Record<string, unknown> & { product_id: number; batch_id: number; branch_id: number | null; quantity: number | null }
export type ProductConflictActionBlocker = { code: string; message: string }
export type ProductConflictActionGroupPlan = {
  group_key: string
  source_group_keys: string[]
  member_ids: number[]
  eligibility_basis: 'name' | 'barcode' | null
  eligibility_value: string | null
  members: Array<Record<string, unknown>>
  options: { barcode_source_ids: number[]; category_source_ids: number[]; brand_source_ids: number[]; unit_source_ids: number[] }
  economics: ProductMergeEconomics
  stock: { rows: ProductConflictActionStockRow[]; projected_by_branch: Array<{ branch_id: number; branch_name: string | null; quantity: number }> }
  lots: { rows: ProductConflictActionLotRow[]; projected_quantity: number; count: number }
  blocked: ProductConflictActionBlocker | null
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProductConflictMergeValidationError(`${path} must be an object.`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key))
  const missing = allowed.filter((key) => !Object.prototype.hasOwnProperty.call(value, key))
  if (unknown.length || missing.length) {
    throw new ProductConflictMergeValidationError(`${path} has ${unknown.length ? `unsupported fields: ${unknown.join(', ')}` : `missing fields: ${missing.join(', ')}`}.`)
  }
}

function groupKey(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 240 || /[\u0000-\u001f]/.test(value)) {
    throw new ProductConflictMergeValidationError(`${path} must be a non-empty bounded string.`)
  }
  return value.trim()
}

function productId(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new ProductConflictMergeValidationError(`${path} must be a positive safe integer.`)
  }
  return value
}

export function isProductConflictActionPreviewRequest(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && (value as Record<string, unknown>).resolution_version === PRODUCT_CONFLICT_ACTION_RESOLUTION_VERSION)
}

export function parseProductConflictActionPreviewRequest(value: unknown): ProductConflictActionPreviewRequest {
  const root = asRecord(value, 'request')
  exactKeys(root, ['manifest_version', 'resolution_version', 'client_request_id', 'merge_groups', 'remove_rows'], 'request')
  if (root.manifest_version !== 1 || root.resolution_version !== 2) {
    throw new ProductConflictMergeValidationError('The selected conflict review version is unsupported.', 'unsupported_version')
  }
  if (typeof root.client_request_id !== 'string' || !/^[A-Za-z0-9_-]{8,120}$/.test(root.client_request_id)) {
    throw new ProductConflictMergeValidationError('A stable client_request_id is required.')
  }
  if (!Array.isArray(root.remove_rows)) throw new ProductConflictMergeValidationError('request.remove_rows must be an array.')
  if (root.remove_rows.length) {
    throw new ProductConflictMergeValidationError('Independent Remove is not available in this review phase.', 'phase_not_available', 409)
  }
  if (!Array.isArray(root.merge_groups) || !root.merge_groups.length || root.merge_groups.length > PRODUCT_CONFLICT_ACTION_MAX_GROUPS) {
    throw new ProductConflictMergeValidationError(`merge_groups must contain 1-${PRODUCT_CONFLICT_ACTION_MAX_GROUPS} entries.`)
  }
  const seenKeys = new Set<string>()
  const uniqueMembers = new Set<number>()
  const mergeGroups = root.merge_groups.map((candidate, index): ProductConflictActionGroupInput => {
    const item = asRecord(candidate, `merge_groups[${index}]`)
    exactKeys(item, ['group_key', 'member_ids'], `merge_groups[${index}]`)
    const key = groupKey(item.group_key, `merge_groups[${index}].group_key`)
    if (seenKeys.has(key)) throw new ProductConflictMergeValidationError('group_key values must be unique.')
    seenKeys.add(key)
    if (!Array.isArray(item.member_ids) || item.member_ids.length < 2 || item.member_ids.length > PRODUCT_CONFLICT_ACTION_MAX_MEMBERS_PER_GROUP) {
      throw new ProductConflictMergeValidationError(`merge_groups[${index}].member_ids must contain 2-${PRODUCT_CONFLICT_ACTION_MAX_MEMBERS_PER_GROUP} ids.`)
    }
    const ids = item.member_ids.map((id, memberIndex) => productId(id, `merge_groups[${index}].member_ids[${memberIndex}]`))
    if (new Set(ids).size !== ids.length) throw new ProductConflictMergeValidationError(`merge_groups[${index}].member_ids must be unique.`)
    ids.forEach((id) => uniqueMembers.add(id))
    return { group_key: key, member_ids: [...ids].sort((a, b) => a - b) }
  })
  if (uniqueMembers.size > PRODUCT_CONFLICT_ACTION_MAX_MEMBERS) {
    throw new ProductConflictMergeValidationError(`At most ${PRODUCT_CONFLICT_ACTION_MAX_MEMBERS} distinct products are allowed.`)
  }
  return { manifest_version: 1, resolution_version: 2, client_request_id: root.client_request_id, merge_groups: mergeGroups, remove_rows: [] }
}

type CanonicalSelection = { group_key: string; source_group_keys: string[]; member_ids: number[]; overlapping: boolean }

export function canonicalizeProductConflictActionGroups(groups: readonly ProductConflictActionGroupInput[]): CanonicalSelection[] {
  const exact = new Map<string, CanonicalSelection>()
  for (const group of groups) {
    const memberIds = [...new Set(group.member_ids)].sort((a, b) => a - b)
    const key = memberIds.join(',')
    const prior = exact.get(key)
    if (prior) prior.source_group_keys.push(group.group_key)
    else exact.set(key, { group_key: group.group_key, source_group_keys: [group.group_key], member_ids: memberIds, overlapping: false })
  }
  const seeds = [...exact.values()]
  const parent = seeds.map((_, index) => index)
  const find = (index: number): number => parent[index] === index ? index : (parent[index] = find(parent[index]))
  const union = (left: number, right: number) => { const a = find(left); const b = find(right); if (a !== b) parent[b] = a }
  const owner = new Map<number, number>()
  seeds.forEach((group, index) => group.member_ids.forEach((id) => { const prior = owner.get(id); if (prior == null) owner.set(id, index); else union(prior, index) }))
  const components = new Map<number, CanonicalSelection[]>()
  seeds.forEach((group, index) => { const root = find(index); components.set(root, [...(components.get(root) || []), group]) })
  return [...components.values()].map((component) => {
    const sourceKeys = component.flatMap((group) => group.source_group_keys).sort()
    return {
      group_key: sourceKeys[0],
      source_group_keys: sourceKeys,
      member_ids: [...new Set(component.flatMap((group) => group.member_ids))].sort((a, b) => a - b),
      overlapping: component.length > 1,
    }
  }).sort((a, b) => a.group_key < b.group_key ? -1 : a.group_key > b.group_key ? 1 : 0)
}

function uniqueSourceIds(rows: readonly ProductConflictActionProductRow[], field: 'barcode' | 'category' | 'brand' | 'unit'): number[] {
  const seen = new Set<string>()
  const ids: number[] = []
  for (const row of rows) {
    const value = String(row[field] ?? '').trim()
    if (seen.has(value)) continue
    seen.add(value)
    ids.push(row.id)
  }
  return ids
}

export function buildProductConflictActionGroupPlans(
  groups: readonly ProductConflictActionGroupInput[],
  products: readonly ProductConflictActionProductRow[],
  stock: readonly ProductConflictActionStockRow[],
  lots: readonly ProductConflictActionLotRow[],
): ProductConflictActionGroupPlan[] {
  const byId = new Map(products.map((row) => [Number(row.id), row]))
  return canonicalizeProductConflictActionGroups(groups).map((group) => {
    const rows = group.member_ids.map((id) => byId.get(id)).filter((row): row is ProductConflictActionProductRow => Boolean(row))
    let blocked: ProductConflictActionBlocker | null = null
    const names = new Set(rows.map((row) => normalizeProductGroupName(row.name)).filter(Boolean))
    const barcodes = new Set(rows.map((row) => identityBarcodeKey(row.barcode)).filter(Boolean))
    const nameEligible = rows.length === group.member_ids.length && names.size === 1
    const barcodeEligible = rows.length === group.member_ids.length && barcodes.size === 1
    let eligibilityBasis: 'name' | 'barcode' | null = nameEligible ? 'name' : barcodeEligible ? 'barcode' : null
    let eligibilityValue = eligibilityBasis === 'name' ? [...names][0] : eligibilityBasis === 'barcode' ? [...barcodes][0] : null
    if (rows.length !== group.member_ids.length || rows.some((row) => !Number(row.is_active) || Number(row.is_group))) {
      blocked = { code: 'stale_group_members', message: 'One or more selected products are missing, inactive, or product groups.' }
      eligibilityBasis = null; eligibilityValue = null
    } else if (!eligibilityBasis) {
      blocked = group.overlapping
        ? { code: 'overlap_requires_selection', message: 'Overlapping groups do not share one group-wide name or barcode. Select one group.' }
        : { code: 'incompatible_group_identity', message: 'Every member must share one normalized name or one non-empty normalized barcode.' }
    }
    const economics = resolveProductMergeEconomics(rows)
    if (!blocked && economics.issues.length) blocked = { code: 'invalid_merge_numeric', message: 'A selected product has an invalid non-negative money value.' }
    const memberSet = new Set(group.member_ids)
    const stockRows = stock.filter((row) => memberSet.has(Number(row.product_id)))
      .map((row) => ({ ...row, product_id: Number(row.product_id), branch_id: Number(row.branch_id), quantity: Number(row.quantity) || 0 }))
      .sort((a, b) => a.product_id - b.product_id || a.branch_id - b.branch_id)
    const projected = new Map<number, { branch_id: number; branch_name: string | null; quantity: number }>()
    for (const row of stockRows) {
      const item = projected.get(row.branch_id) || { branch_id: row.branch_id, branch_name: row.branch_name, quantity: 0 }
      item.quantity += row.quantity; projected.set(row.branch_id, item)
    }
    const lotRows = lots.filter((row) => memberSet.has(Number(row.product_id)))
      .map((row) => ({ ...row, product_id: Number(row.product_id), batch_id: Number(row.batch_id), branch_id: row.branch_id == null ? null : Number(row.branch_id), quantity: row.quantity == null ? null : Number(row.quantity) || 0 }))
      .sort((a, b) => a.product_id - b.product_id || a.batch_id - b.batch_id || Number(a.branch_id ?? -1) - Number(b.branch_id ?? -1))
    const members = rows.map((row) => ({
      id: row.id, name: row.name, barcode: row.barcode, category: row.category, brand: row.brand, unit: row.unit,
      image_path: row.image_path, updated_at: row.updated_at,
      cost_price_usd: row.cost_price_usd, cost_price_khr: row.cost_price_khr,
      selling_price_usd: row.selling_price_usd, selling_price_khr: row.selling_price_khr,
      wholesale_price_usd: row.wholesale_price_usd, wholesale_price_khr: row.wholesale_price_khr,
    }))
    return {
      group_key: group.group_key,
      source_group_keys: group.source_group_keys,
      member_ids: group.member_ids,
      eligibility_basis: eligibilityBasis,
      eligibility_value: eligibilityValue,
      members,
      options: {
        barcode_source_ids: uniqueSourceIds(rows, 'barcode'), category_source_ids: uniqueSourceIds(rows, 'category'),
        brand_source_ids: uniqueSourceIds(rows, 'brand'), unit_source_ids: uniqueSourceIds(rows, 'unit'),
      },
      economics,
      stock: { rows: stockRows, projected_by_branch: [...projected.values()].sort((a, b) => a.branch_id - b.branch_id) },
      lots: { rows: lotRows, projected_quantity: lotRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0), count: new Set(lotRows.map((row) => row.batch_id)).size },
      blocked,
    }
  })
}
