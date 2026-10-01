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
  const normalized = normalizeCostKey(key)
  if (/(^|_)(delivery|courier)(_|$)/.test(normalized)) return false
  if (['actual_cost_usd', 'actual_cost_khr', 'actual_cost_count', 'actual_cost_before', 'actual_cost_after'].includes(normalized)) return false
  return /(^|_)(cost|costs|cogs|profit|margin|purchase_price|stock_value|removal_loss)(_|$)/.test(normalized)
    || normalized === 'revenue_after_losses_usd' || normalized === 'credit_open_usd' || ECONOMIC_COST_FIELDS.has(normalized)
    // Supplier loss + compensation reconstructs acquisition cost. These
    // aliases also occur in aggregate/audit envelopes without return_scope.
    || /^(supplier_)?(compensation|loss)_(usd|khr)$/.test(normalized)
}

function normalizeCostKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}
const ECONOMIC_COST_FIELDS = new Set(['gross4', 'paid4', 'debt4', 'credit4', 'asset4', 'cash_in4', 'cash_out4', 'shipping4',
  'opening_paid4', 'opening_debt4', 'coverage4', 'net4', 'recognized4', 'remaining_gross4', 'remaining_coverage4', 'remaining_net4',
  'extra_fee4', 'purchase_gross4', 'sellable_gross4', 'held_gross4', 'sellable_net4', 'held_net4', 'accepted_credit4',
  'recognized_loss4', 'historical_loss4', 'extra_cash_fee4', 'current_debt4', 'current_paid4', 'refund_asset4', 'loss4', 'recovery4', 'pending4',
  'gross_usd', 'opening_paid_usd', 'opening_debt_usd', 'coverage_usd'])
const LIFECYCLE_KINDS = new Set(['admit', 'hold', 'dispose', 'repair', 'pending', 'accept', 'cancel', 'refund', 'payment', 'shipping'])
const INDEPENDENT_MONEY_FIELDS = new Set(['sale', 'sales', 'customer', 'customers', 'fee', 'fees', 'tenders'])
function hasLifecycleContext(source: Record<string, unknown>, inherited: boolean): boolean {
  const fields = Object.fromEntries(Object.entries(source).map(([key, value]) => [normalizeCostKey(key), value]))
  if (['entity', 'table_name', 'applier'].some(key => typeof fields[key] === 'string' && /^stock_(funding|disposition|valuation)(?:$|[_.])/.test(fields[key] as string))) return true
  if (['funding_version', 'disposition_version', 'valuation_version'].some(key => key in fields)) return true
  if ('source_id' in fields && typeof fields.kind === 'string' && LIFECYCLE_KINDS.has(fields.kind)) return true
  if ('segment_id' in fields || 'allocation_id' in fields) return true
  if (fields.scope === 'customer' || 'fee_money_version' in fields || 'sale_money_version' in fields) return false
  return inherited
}
function isLifecycleAmount(key: string, lifecycle: boolean): boolean {
  const normalized = normalizeCostKey(key)
  return lifecycle && (['amount4', 'amount_usd', 'amount_khr'].includes(normalized) || SUPPLIER_MONEY_FIELDS.has(normalized))
}
function isSerializedCostEnvelope(key: string): boolean {
  const normalized = normalizeCostKey(key)
  return SERIALIZED_FIELDS.has(normalized) || normalized.endsWith('_json')
}

const CATALOG_COST_FIELDS = new Set(['cost_price_usd', 'cost_price_khr', 'purchase_price_usd', 'purchase_price_khr'])
export function hasCatalogCostWrite(body: Record<string, unknown>, user: PermissionUser): boolean {
  return !canEditAcquisitionCosts(user) && Object.keys(body).some(key => CATALOG_COST_FIELDS.has(key))
}

/** Incoming money fields must be omitted, never replaced with redacted zeroes. */
export function hasAcquisitionCostInput(value: unknown, user: PermissionUser): boolean {
  if (canEditAcquisitionCosts(user)) return false
  function contains(input: unknown, depth: number, lifecycle = false): boolean {
    if (depth > MAX_DEPTH) return true
    if (Array.isArray(input)) return input.some(item => contains(item, depth + 1, lifecycle))
    if (!input || typeof input !== 'object') return false
    const source = input as Record<string, unknown>
    lifecycle = hasLifecycleContext(source, lifecycle)
    if (typeof source.field === 'string' && (isAcquisitionCostKey(source.field) || isLifecycleAmount(source.field, lifecycle))) return true
    return Object.entries(source).some(([key, child]) => {
      if (isAcquisitionCostKey(key) || isLifecycleAmount(key, lifecycle)) return true
      const childLifecycle = lifecycle && !INDEPENDENT_MONEY_FIELDS.has(normalizeCostKey(key))
      if (typeof child === 'string' && isSerializedCostEnvelope(key)) {
        if (child.length > MAX_SERIALIZED_CHARS) return true
        if (!child.trim()) return false
        try { return contains(JSON.parse(child), depth + 1, childLifecycle) }
        catch { return true }
      }
      return contains(child, depth + 1, childLifecycle)
    })
  }
  return contains(value, 0)
}

const SERIALIZED_FIELDS = new Set(['details', 'old_value', 'new_value', 'undo_payload', 'redo_payload'])
const MAX_SERIALIZED_CHARS = 2_000_000
const MAX_DEPTH = 32
const SUPPLIER_MONEY_FIELDS = new Set(['line_total_usd', 'total_usd', 'paid_usd', 'outstanding_usd',
  'taxable_amount_usd', 'vat_amount_usd', 'total_amount_usd', 'amount_paid_usd', 'outstanding_balance_usd',
  'total_khr', 'total_refund_usd', 'total_refund_khr', 'applied_price_usd', 'applied_price_khr',
  'supplier_compensation_usd', 'supplier_compensation_khr', 'supplier_loss_usd', 'supplier_loss_khr',
  'refund_usd', 'refund_khr'])

type RetailPricingParser = (json: string) => { amounts: { gross_usd: number } } | null

function normalizeResponseKey(key: string): string {
  return normalizeCostKey(key.trim()).replaceAll('_', '')
}
const SUPPLIER_RESPONSE_MONEY_FIELDS = new Set([...SUPPLIER_MONEY_FIELDS].map(normalizeResponseKey))
function isSupplierResponseMoney(key: string): boolean {
  return SUPPLIER_RESPONSE_MONEY_FIELDS.has(normalizeResponseKey(key))
}
function isSupplierGroupKey(key: string): boolean {
  return normalizeResponseKey(key) === 'periodsupplierreturns'
}
function hasSupplierContext(source: Record<string, unknown>): boolean {
  return Object.entries(source).some(([key, value]) => ['scope', 'returnscope'].includes(normalizeResponseKey(key))
    && typeof value === 'string' && value.trim().toLowerCase() === 'supplier')
}

function restoreRetailPricingGross(json: string, parsed: unknown, projected: unknown, parser?: RetailPricingParser): unknown {
  if (!parser || !parsed || typeof parsed !== 'object' || !projected || typeof projected !== 'object') return projected
  const source = parsed as Record<string, unknown>
  const amounts = source.amounts
  if (!amounts || typeof amounts !== 'object') return projected
  for (const record of [source, amounts as Record<string, unknown>]) {
    if (hasLifecycleContext(record, false) || hasSupplierContext(record)) return projected
  }
  try {
    const validated = parser(json)
    const result = projected as Record<string, unknown>
    if (!validated || !result.amounts || typeof result.amounts !== 'object') return projected
    const projectedAmounts = result.amounts as Record<string, unknown>
    const retailAmounts = Object.fromEntries(Object.keys(amounts).filter(key => key === 'gross_usd' || Object.hasOwn(projectedAmounts, key))
      .map(key => [key, key === 'gross_usd' ? validated.amounts.gross_usd : projectedAmounts[key]]))
    return { ...result, amounts: retailAmounts }
  } catch { return projected }
}

/** Response-only projection: never mutate DB snapshots or actor-neutral caches. */
export function projectAcquisitionCosts(value: unknown, user: PermissionUser, supplierMoney = false, retailPricingParser?: RetailPricingParser): unknown {
  if (canViewAcquisitionCosts(user)) return value
  function project(input: unknown, depth: number, supplier = supplierMoney, lifecycle = false): unknown {
    if (depth > MAX_DEPTH) return null
    if (Array.isArray(input)) return input.map(item => project(item, depth + 1, supplier, lifecycle))
    if (!input || typeof input !== 'object') return input
    const source = input as Record<string, unknown>
    supplier = supplier || hasSupplierContext(source)
    lifecycle = hasLifecycleContext(source, lifecycle)
    // Audit/merge diffs may name the column rather than use it as a key.
    const selectedField = Object.entries(source).find(([key, field]) => normalizeResponseKey(key) === 'field'
      && typeof field === 'string' && (isAcquisitionCostKey(field.trim()) || isLifecycleAmount(field.trim(), lifecycle)
        || (supplier && isSupplierResponseMoney(field))))
    if (selectedField) return { field: selectedField[1], redacted: true }
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(source)) {
      if (isAcquisitionCostKey(key) || isLifecycleAmount(key, lifecycle) || (supplier && isSupplierResponseMoney(key))) continue
      const childSupplier = supplier || isSupplierGroupKey(key)
      const childLifecycle = lifecycle && !INDEPENDENT_MONEY_FIELDS.has(normalizeCostKey(key))
      if (typeof child === 'string' && isSerializedCostEnvelope(key)) {
        // Only serialized envelopes are parsed, never arbitrary names/notes.
        // Oversized or malformed envelopes fail closed.
        if (child.length > MAX_SERIALIZED_CHARS) { result[key] = null; continue }
        if (!child.trim()) { result[key] = child; continue }
        try {
          const parsed: unknown = JSON.parse(child)
          // A bare historical scalar has no column identity; do not expose
          // an old/new unit cost merely because its wrapper lost the key.
          if (!parsed || typeof parsed !== 'object') { result[key] = null; continue }
          const projected = project(parsed, depth + 1, childSupplier, childLifecycle)
          result[key] = JSON.stringify(key === 'pricing_snapshot_json' && !supplier && !childLifecycle
            ? restoreRetailPricingGross(child, parsed, projected, retailPricingParser) : projected)
        }
        catch { result[key] = null }
      } else {
        const supplier = childSupplier
        result[key] = project(child, depth + 1, supplier || key === 'periodSupplierReturns', childLifecycle)
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
export function createAcquisitionCostResponses(retailPricingParser?: RetailPricingParser): MiddlewareHandler {
  return async (c, next) => {
    const json: Function = c.json
    c.json = ((...args: Parameters<Context['json']>) => {
      args[0] = projectAcquisitionCosts(args[0], c.get('user'), /^\/api\/suppliers(?:\/|$)/.test(c.req.path), retailPricingParser) as typeof args[0]
      c.header('Cache-Control', 'private, no-store')
      return Reflect.apply(json, c, args)
    }) as Context['json']
    await next()
  }
}

export const acquisitionCostResponses: MiddlewareHandler = createAcquisitionCostResponses()
