import type { Context, MiddlewareHandler } from 'hono'
import { getMergedPermissions, isAdminControlUser, type PermissionUser } from './permissions'

// Separate explicit grants: legacy product/inventory/sales access grants neither.
// Administrator-control actors retain both, even if a stored override is false.
export function canViewAcquisitionCosts(user: PermissionUser): boolean {
  return isAdminControlUser(user) || getMergedPermissions(user).product_cost_view === true
}
export function canEditAcquisitionCosts(user: PermissionUser): boolean {
  return isAdminControlUser(user) || getMergedPermissions(user).product_cost_edit === true
}

// These import formats materialize acquisition costs, including normalized
// defaults and saved staging snapshots. Contact-only imports do not.
export function isAcquisitionCostImport(type: unknown): boolean {
  return ['products', 'inventory', 'sales', 'stock_actions'].includes(String(type || '').trim().toLowerCase())
}

// Courier/delivery expenses retain their separate amendment policy.
export function isAcquisitionCostKey(key: string): boolean {
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
  if (/(^|_)(delivery|courier)(_|$)/.test(normalized)) return false
  if (['actual_cost_usd', 'actual_cost_khr', 'actual_cost_count', 'actual_cost_before', 'actual_cost_after'].includes(normalized)) return false
  return /(^|_)(cost|costs|cogs|profit|margin|purchase_price|stock_value|removal_loss)(_|$)/.test(normalized)
    || normalized === 'revenue_after_losses_usd' || normalized === 'credit_open_usd'
    // Supplier loss + compensation reconstructs acquisition cost. These
    // aliases also occur in aggregate/audit envelopes without return_scope.
    || /^(supplier_)?(compensation|loss)_(usd|khr)$/.test(normalized)
}

const CATALOG_COST_FIELDS = new Set(['cost_price_usd', 'cost_price_khr', 'purchase_price_usd', 'purchase_price_khr'])
export function hasCatalogCostWrite(body: Record<string, unknown>, user: PermissionUser): boolean {
  return !canEditAcquisitionCosts(user) && Object.keys(body).some(key => CATALOG_COST_FIELDS.has(key))
}

const SERIALIZED_FIELDS = new Set(['details', 'old_value', 'new_value', 'undo_payload', 'redo_payload', 'request_json',
  'response_json', 'receipt_json', 'targets_json', 'pricing_snapshot_json', 'payload_json', 'source_json', 'allocations_json',
  'physical_json', 'snapshot_json', 'steps_json', 'baseline_json', 'repair_json', 'original_json'])

const MAX_SERIALIZED_CHARS = 2_000_000

const MAX_DEPTH = 32

const MAX_DECODED_BYTES = 16 * 1024 * 1024

const FINANCIAL_ROW_FIELDS = new Set(['records', 'rows', 'items', 'events', 'segments', 'invoices', 'changes', 'targets', 'allocations', 'shares', 'lines', 'native_sources'])

const LITERAL_ARRAY_FIELDS = new Set(['names', 'product_names', 'merged_names', 'labels', 'tags', 'categories', 'brands', 'source_ids', 'source_ids_json'].map(keyFingerprint))

function isLiteralArrayField(key: string): boolean {
  return LITERAL_ARRAY_FIELDS.has(keyFingerprint(key))
}

function isFinancialRowContainer(key: string): boolean {
  const normalized = keyFingerprint(key)
  return [...FINANCIAL_ROW_FIELDS].some(field => normalized === keyFingerprint(field) || normalized === keyFingerprint(field) + 'json')
}

type DecodeBudget = { bytes: number }

function decodeFinancialContainer(input: string, depth: number, budget: DecodeBudget): { value: object; depth: number; layers: number } | null {
  let value: unknown = input
  let layers = 0
  while (typeof value === 'string') {
    if (depth > MAX_DEPTH || value.length > MAX_SERIALIZED_CHARS) return null
    const bytes = new TextEncoder().encode(value).byteLength
    if (bytes > budget.bytes) { budget.bytes = 0; return null }
    budget.bytes -= bytes
    try { value = JSON.parse(value) } catch { return null }
    depth++
    layers++
  }
  return value && typeof value === 'object' && depth <= MAX_DEPTH ? { value, depth, layers } : null
}

function encodeFinancialContainer(value: unknown, layers: number): string {
  let encoded = value
  while (layers-- > 0) encoded = JSON.stringify(encoded)
  return encoded as string
}

function keyFingerprint(key: string): string {
  return key.toLowerCase().replace(/[\s_-]/g, '')
}

const SUPPLIER_MONEY_FIELDS = new Set(['line_total_usd', 'total_usd', 'paid_usd', 'outstanding_usd',
  'taxable_amount_usd', 'vat_amount_usd', 'total_amount_usd', 'amount_paid_usd', 'outstanding_balance_usd',
  'total_khr', 'total_refund_usd', 'total_refund_khr', 'applied_price_usd', 'applied_price_khr',
  'supplier_compensation_usd', 'supplier_compensation_khr', 'supplier_loss_usd', 'supplier_loss_khr',
  'refund_usd', 'refund_khr'])

function isSupplierGroupKey(key: string): boolean {
  return keyFingerprint(key) === 'periodsupplierreturns'
}

const SERIALIZED_KEYS = new Set([...SERIALIZED_FIELDS].map(keyFingerprint))
const SUPPLIER_MONEY_KEYS = new Set([...SUPPLIER_MONEY_FIELDS].map(keyFingerprint))

function isSerializedCostEnvelope(key: string): boolean {
  const normalized = key.trim().replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
  return SERIALIZED_KEYS.has(keyFingerprint(key)) || normalized.endsWith('_json') || isSupplierGroupKey(key)
}

function hasSupplierContext(source: Record<string, unknown>): boolean {
  return Object.entries(source).some(([key, value]) => ['scope', 'returnscope'].includes(keyFingerprint(key))
    && typeof value === 'string' && value.trim().toLowerCase() === 'supplier')
}

function isPrivateMoneyField(key: string, supplier: boolean): boolean {
  return isAcquisitionCostKey(key) || (supplier && SUPPLIER_MONEY_KEYS.has(keyFingerprint(key)))
}

function selectedPrivateField(source: Record<string, unknown>, supplier: boolean): [string, unknown] | undefined {
  return Object.entries(source).find(([key, value]) => keyFingerprint(key) === 'field'
    && typeof value === 'string' && isPrivateMoneyField(value, supplier))
}

export function hasAcquisitionCostInput(value: unknown, user: PermissionUser): boolean {
  if (canEditAcquisitionCosts(user)) return false
  const budget = { bytes: MAX_DECODED_BYTES }
  function contains(input: unknown, depth: number, supplier = false, governed = false): boolean {
    if (depth > MAX_DEPTH) return true
    if (Array.isArray(input)) return input.some(item => contains(item, depth + 1, supplier, governed))
    if (typeof input === 'string' && governed) {
      const decoded = decodeFinancialContainer(input, depth, budget)
      return !decoded || contains(decoded.value, decoded.depth, supplier, true)
    }
    if (!input || typeof input !== 'object') return false
    const source = input as Record<string, unknown>
    supplier = supplier || hasSupplierContext(source)
    if (selectedPrivateField(source, supplier)) return true
    return Object.entries(source).some(([key, child]) => {
      if (isPrivateMoneyField(key, supplier)) return true
      const childSupplier = supplier || isSupplierGroupKey(key)
      const childGoverned = !isLiteralArrayField(key) && (isSerializedCostEnvelope(key)
        || isFinancialRowContainer(key) || (governed && typeof child !== 'string'))
      if (typeof child === 'string' && (isSerializedCostEnvelope(key) || childGoverned)) {
        if (!child.trim()) return false
        const decoded = decodeFinancialContainer(child, depth, budget)
        return !decoded || contains(decoded.value, decoded.depth, childSupplier, childGoverned)
      }
      return contains(child, depth + 1, childSupplier, childGoverned)
    })
  }
  return contains(value, 0)
}

export function projectAcquisitionCosts(value: unknown, user: PermissionUser, supplierMoney = false): unknown {
  if (canViewAcquisitionCosts(user)) return value
  const budget = { bytes: MAX_DECODED_BYTES }
  function project(input: unknown, depth: number, supplier = supplierMoney, governed = false): unknown {
    if (depth > MAX_DEPTH) return null
    if (Array.isArray(input)) return input.map(item => project(item, depth + 1, supplier, governed))
    if (typeof input === 'string' && governed) {
      const decoded = decodeFinancialContainer(input, depth, budget)
      return decoded ? encodeFinancialContainer(project(decoded.value, decoded.depth, supplier, true), decoded.layers) : null
    }
    if (!input || typeof input !== 'object') return input
    const source = input as Record<string, unknown>
    supplier = supplier || hasSupplierContext(source)
    const field = selectedPrivateField(source, supplier)
    if (field) return { field: field[1], redacted: true }
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(source)) {
      if (isPrivateMoneyField(key, supplier)) continue
      const childSupplier = supplier || isSupplierGroupKey(key)
      const childGoverned = !isLiteralArrayField(key) && (isSerializedCostEnvelope(key)
        || isFinancialRowContainer(key) || (governed && typeof child !== 'string'))
      if (typeof child === 'string' && (isSerializedCostEnvelope(key) || childGoverned)) {
        if (!child.trim()) { result[key] = child; continue }
        const decoded = decodeFinancialContainer(child, depth, budget)
        result[key] = decoded ? encodeFinancialContainer(project(decoded.value, decoded.depth, childSupplier, childGoverned), decoded.layers) : null
      } else {
        result[key] = project(child, depth + 1, childSupplier, childGoverned)
      }
    }
    return result
  }
  return project(value, 0)
}

/**
 * Installed only on catalog/inventory/history routes. Project the object passed
 * to c.json after cache reads, before serialization. Never buffer/reparse an
 * HTTP Response or change objects used by calculations and server-side undo.
 */
export const acquisitionCostResponses: MiddlewareHandler = async (c, next) => {
  const json: Function = c.json
  c.json = ((...args: Parameters<Context['json']>) => {
    args[0] = projectAcquisitionCosts(args[0], c.get('user'), /^\/api\/suppliers(?:\/|$)/.test(c.req.path)) as typeof args[0]
    c.header('Cache-Control', 'private, no-store')
    // Preserve Hono's status/header overloads without re-instantiating its
    // recursive JSON type at this already typed serialization boundary.
    return Reflect.apply(json, c, args)
  }) as Context['json']
  await next()
}
