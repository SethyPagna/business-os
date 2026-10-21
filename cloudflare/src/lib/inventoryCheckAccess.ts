import { getActionTier, getMergedPermissions, getPermissionTier, isAdminControlUser, type PermissionUser } from './permissions'
import { canViewAcquisitionCosts } from './acquisitionCostAccess'

export const INVENTORY_CHECK_FIELDS = ['price', 'barcode', 'category', 'brand', 'stock', 'received', 'sales', 'customers', 'cost'] as const
export type InventoryCheckField = typeof INVENTORY_CHECK_FIELDS[number]
export type InventoryCheckAccess = {
  canView: boolean
  canCheck: boolean
  canViewCustomerDetails: boolean
  fields: Record<InventoryCheckField, boolean>
}

export function getInventoryCheckAccess(user: PermissionUser): InventoryCheckAccess {
  const permissions = getMergedPermissions(user)
  const admin = isAdminControlUser(user)
  const dedicated = Object.hasOwn(permissions, 'inventory_checks')
  const canView = admin || (dedicated ? getActionTier(user, 'inventory_checks', 'view') === 'full' : getActionTier(user, 'inventory', 'view') !== 'none')
  const tier = getPermissionTier(user, 'inventory')
  const fields = Object.fromEntries(INVENTORY_CHECK_FIELDS.map(field => {
    const explicit = permissions[`inventory_check_show_${field}`]
    return [field, canView && (admin || (typeof explicit === 'boolean' ? explicit : tier === 'full'))]
  })) as Record<InventoryCheckField, boolean>
  fields.cost = fields.cost && canViewAcquisitionCosts(user)
  const checkTier = getActionTier(user, 'inventory', 'check')
  return {
    canView,
    canCheck: admin || canView && (dedicated ? getActionTier(user, 'inventory_checks', 'check') === 'full' : checkTier === 'full' || checkTier === 'review'),
    canViewCustomerDetails: fields.customers && getActionTier(user, 'contacts', 'view') !== 'none',
    fields,
  }
}

const IDENTITY_FIELDS = ['id', 'name', 'image_path', 'image_url', 'unit', 'parent_id', 'is_group', 'is_grouped_cached', 'checkable', 'matches_filters'] as const
const PRODUCT_FIELDS: Record<InventoryCheckField, readonly string[]> = {
  price: ['selling_price_usd', 'selling_price_khr', 'wholesale_price_usd', 'wholesale_price_khr'],
  barcode: ['barcode', 'sku'],
  category: ['category', 'categories'],
  brand: ['brand', 'brands'],
  stock: ['quantity', 'damaged_quantity', 'stock_consistent', 'stock_diagnostics', 'recorded_ordinary_quantity', 'recorded_lot_quantity', 'recorded_damaged_quantity', 'recorded_cache_quantity', 'stock_quantity', 'display_quantity', 'low_stock_threshold', 'out_of_stock_threshold', 'stock_state', 'is_low_stock', 'is_out_of_stock'],
  received: ['received_date', 'received_at', 'latest_received_at', 'earliest_received_at', 'batch_count', 'next_expiry_date'],
  sales: ['qty_sold', 'net_sold_qty'],
  customers: ['customer_count', 'unique_customer_count'],
  cost: ['cost_price_usd', 'cost_price_khr', 'purchase_price_usd', 'purchase_price_khr', 'cost_needs_review'],
}
type ProductScalar = string | number | boolean | null

export function projectInventoryCheckProduct(product: Record<string, unknown> | null | undefined, access: InventoryCheckAccess): Record<string, ProductScalar> {
  const output: Record<string, ProductScalar> = {}
  if (!access.canView || !product) return output
  const keys: string[] = [...IDENTITY_FIELDS]
  for (const field of INVENTORY_CHECK_FIELDS) if (access.fields[field]) keys.push(...PRODUCT_FIELDS[field])
  if (access.fields.stock && access.fields.cost) keys.push('stock_value_usd', 'stock_value_khr', 'stock_value_unknown')
  for (const key of keys) {
    if (!Object.hasOwn(product, key)) continue
    const value = product[key]
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) output[key] = value
  }
  return output
}

export class InventoryCheckQueryError extends Error {
  readonly status: 400 | 403
  readonly code: string
  readonly parameter: string
  constructor(status: 400 | 403, code: string, parameter: string) {
    super(code === 'inventory_check_field_hidden' ? 'This Inventory field is hidden.' : 'This Inventory query is not allowed.')
    this.name = 'InventoryCheckQueryError'
    this.status = status
    this.code = code
    this.parameter = parameter
  }
}

const QUERY_ALIASES: Record<string, string> = {
  q: 'query', search: 'query', branch_id: 'branchId', stock_state: 'stockState', group_state: 'groupState',
  page_size: 'pageSize', sort_by: 'sortBy', sort_direction: 'sortDirection', search_fields: 'searchFields',
  start_date: 'startDate', end_date: 'endDate',
}
const QUERY_KEYS = new Set(['query', 'searchFields', 'branchId', 'category', 'brand', 'barcode', 'stockState', 'groupState', 'initial', 'page', 'pageSize', 'startDate', 'endDate', 'createdFrom', 'createdTo', 'sortBy', 'sortDirection'])
const SORT_FIELDS: Record<string, InventoryCheckField | null> = { name: null, stock: 'stock', qty_sold: 'sales', customer_count: 'customers', received_date: 'received', price: 'price', cost: 'cost' }

export function validateInventoryCheckQuery(query: Record<string, unknown>, access: InventoryCheckAccess): Record<string, string> {
  if (!access.canView) throw new InventoryCheckQueryError(403, 'inventory_check_view_required', '')
  const result: Record<string, string> = {}
  const invalid = (parameter: string): never => { throw new InventoryCheckQueryError(400, 'inventory_check_invalid_query', parameter) }
  const requireField = (field: InventoryCheckField, parameter: string): void => {
    if (!access.fields[field]) throw new InventoryCheckQueryError(403, 'inventory_check_field_hidden', parameter)
  }
  for (const [rawKey, rawValue] of Object.entries(query)) {
    const key = QUERY_ALIASES[rawKey] || rawKey
    if (!QUERY_KEYS.has(key)) invalid(rawKey)
    if (rawValue == null || rawValue === '') continue
    if (typeof rawValue !== 'string' && typeof rawValue !== 'number') invalid(rawKey)
    const value = String(rawValue).trim()
    if (!value) continue
    if (value.length > 4096 || Object.hasOwn(result, key) && result[key] !== value) invalid(rawKey)
    result[key] = value
  }
  for (const field of ['brand', 'category'] as const) {
    if (result[field] && result[field].toLowerCase() !== 'all') requireField(field, field)
  }
  if (result.barcode) requireField('barcode', 'barcode')
  if (result.stockState && result.stockState !== 'all') {
    requireField('stock', 'stockState')
    if (!['in_stock', 'low_stock', 'out_of_stock'].includes(result.stockState)) invalid('stockState')
  }
  if (result.sortBy) {
    if (!Object.hasOwn(SORT_FIELDS, result.sortBy)) invalid('sortBy')
    const field = SORT_FIELDS[result.sortBy]
    if (field) requireField(field, 'sortBy')
  }
  if (result.sortDirection) {
    result.sortDirection = result.sortDirection.toLowerCase()
    if (!['asc', 'desc'].includes(result.sortDirection)) invalid('sortDirection')
  }
  if (result.searchFields && !['name', 'title'].includes(result.searchFields)) {
    if (result.searchFields === 'barcode') requireField('barcode', 'searchFields')
    invalid('searchFields')
  }
  result.searchFields = 'name'
  return result
}
