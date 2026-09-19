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

// Courier/delivery expenses retain their separate amendment policy.
export function isAcquisitionCostKey(key: string): boolean {
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
  if (/(^|_)(delivery|courier)(_|$)/.test(normalized)) return false
  return /(^|_)(cost|costs|cogs|profit|margin|purchase_price|stock_value|removal_loss)(_|$)/.test(normalized)
    || normalized === 'revenue_after_losses_usd' || normalized === 'credit_open_usd'
}

const CATALOG_COST_FIELDS = new Set(['cost_price_usd', 'cost_price_khr', 'purchase_price_usd', 'purchase_price_khr'])
export function hasCatalogCostWrite(body: Record<string, unknown>, user: PermissionUser): boolean {
  return !canEditAcquisitionCosts(user) && Object.keys(body).some(key => CATALOG_COST_FIELDS.has(key))
}

/** Incoming money fields must be omitted, never replaced with redacted zeroes. */
export function hasAcquisitionCostInput(value: unknown, user: PermissionUser): boolean {
  if (canEditAcquisitionCosts(user)) return false
  function contains(input: unknown, depth: number): boolean {
    if (depth > 32) return true
    if (Array.isArray(input)) return input.some(item => contains(item, depth + 1))
    if (!input || typeof input !== 'object') return false
    return Object.entries(input).some(([key, child]) => isAcquisitionCostKey(key) || contains(child, depth + 1))
  }
  return contains(value, 0)
}

const SERIALIZED_FIELDS = new Set(['details', 'old_value', 'new_value', 'undo_payload', 'redo_payload'])
const MAX_SERIALIZED_CHARS = 2_000_000
const MAX_DEPTH = 32
const SUPPLIER_MONEY_FIELDS = new Set(['line_total_usd', 'total_usd', 'paid_usd', 'outstanding_usd',
  'taxable_amount_usd', 'vat_amount_usd', 'total_amount_usd', 'amount_paid_usd', 'outstanding_balance_usd'])

/** Response-only projection: never mutate DB snapshots or actor-neutral caches. */
export function projectAcquisitionCosts(value: unknown, user: PermissionUser, supplierMoney = false): unknown {
  if (canViewAcquisitionCosts(user)) return value
  function project(input: unknown, depth: number): unknown {
    if (depth > MAX_DEPTH) return null
    if (Array.isArray(input)) return input.map(item => project(item, depth + 1))
    if (!input || typeof input !== 'object') return input
    const source = input as Record<string, unknown>
    // Audit/merge diffs may name the column rather than use it as a key.
    if (typeof source.field === 'string' && isAcquisitionCostKey(source.field)) return { field: source.field, redacted: true }
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(source)) {
      if (isAcquisitionCostKey(key) || (supplierMoney && SUPPLIER_MONEY_FIELDS.has(key))) continue
      if (typeof child === 'string' && (SERIALIZED_FIELDS.has(key) || key.endsWith('_json'))) {
        // Only serialized envelopes are parsed, never arbitrary names/notes.
        // Oversized or malformed envelopes fail closed.
        if (child.length > MAX_SERIALIZED_CHARS) { result[key] = null; continue }
        if (!child.trim()) { result[key] = child; continue }
        try {
          const parsed: unknown = JSON.parse(child)
          // A bare historical scalar has no column identity; do not expose
          // an old/new unit cost merely because its wrapper lost the key.
          result[key] = parsed && typeof parsed === 'object' ? JSON.stringify(project(parsed, depth + 1)) : null
        }
        catch { result[key] = null }
      } else {
        result[key] = project(child, depth + 1)
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
