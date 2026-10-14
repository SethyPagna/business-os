import type { Context, MiddlewareHandler } from 'hono'
import { getActionTier, isAdminControlUser, type PermissionUser } from './permissions'
import type { SaleRecord } from './saleRecords'

// The courier's actual cost (what the shop paid the driver) is not the customer's
// delivery fee. The generic cost-key matcher in acquisitionCostAccess skips delivery
// and courier keys on purpose, so fees (revenue) are never hidden; this module is the
// gate for the cost itself.

/**
 * The one gate for the courier's actual cost, on every read and write response that can carry it: a sale's
 * rows and history, the reports, the dashboard. An administrator always passes. Anyone else needs a Sales
 * grant and keeps it until the role editor ("View actual delivery cost") switches `sales:view_courier_cost` off, so a role saved before the
 * row existed is decided without a migration, and a storefront or customer principal, which holds no Sales grant,
 * never passes.
 */
export function canViewCourierCost(user: PermissionUser): boolean {
  return isAdminControlUser(user) || getActionTier(user, 'sales', 'view_courier_cost') !== 'none'
}

/** The ledger kind whose whole content is the courier cost. */
export const COST_LEDGER_KIND = 'delivery_actual_cost_changed'

const fingerprint = (key: string): string => key.toLowerCase().replace(/[\s_-]/g, '')

// Matched on the fingerprint so camelCase twins (deliveryActualCostUsd) leave with the snake_case keys.
const COURIER_COST_KEYS = new Set([
  'delivery_actual_cost_usd', 'delivery_actual_cost_khr', 'actual_delivery_cost_usd', 'actual_delivery_cost_khr',
  'actual_cost_before', 'actual_cost_after',
].map(fingerprint))

const isCourierCostKey = (key: string): boolean => COURIER_COST_KEYS.has(fingerprint(key))

/** The one summary saleRecords.ts writes for a cost change: "Actual delivery cost $0.83 to $1.37" (an unset side is "-"). */
const COURIER_COST_SUMMARY = /^(Actual delivery cost) (?:\$-?\d+(?:\.\d+)?|-) to (?:\$-?\d+(?:\.\d+)?|-)/

const MAX_STRIP_DEPTH = 12

type Stripped<T> = { value: T; touched: boolean }

/** Past the depth cap a subtree cannot be inspected, so it is dropped (null) rather than passed through. */
function stripCourierCost(input: unknown, depth = 0): Stripped<unknown> {
  if (input === null || typeof input !== 'object') return { value: input, touched: false }
  if (depth > MAX_STRIP_DEPTH) return { value: null, touched: true }
  if (Array.isArray(input)) {
    let touched = false
    const value = input.map((item) => {
      const inner = stripCourierCost(item, depth + 1)
      touched = touched || inner.touched
      return inner.value
    })
    return { value: touched ? value : input, touched }
  }
  let touched = false
  const value: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(input as Record<string, unknown>)) {
    if (isCourierCostKey(key)) { touched = true; continue }
    const inner = stripCourierCost(child, depth + 1)
    touched = touched || inner.touched
    value[key] = inner.value
  }
  return { value: touched ? value : input, touched }
}

/** A JSON snapshot column (a string, or already parsed) without the courier-cost keys. */
function stripSnapshot(raw: unknown): Stripped<unknown> {
  if (typeof raw !== 'string') return stripCourierCost(raw)
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return { value: raw, touched: false } }
  const inner = stripCourierCost(parsed)
  return inner.touched ? { value: JSON.stringify(inner.value), touched: true } : { value: raw, touched: false }
}

/**
 * The amendment ledger as a caller may read it. A cost-change entry keeps id, actor,
 * time and note but loses the three amount columns (the delta would give the cost back
 * by subtraction); every snapshot loses the cost keys. `courier_cost_hidden` lets a
 * screen print a dash instead of a zero or "Not recorded".
 */
export function redactAmendmentEntries<T extends { kind?: unknown }>(entries: T[], user: PermissionUser): T[] {
  if (canViewCourierCost(user)) return entries
  return entries.map((entry) => {
    const row = entry as T & Record<string, unknown>
    const before = stripSnapshot(row.before_json)
    const after = stripSnapshot(row.after_json)
    const costEntry = row.kind === COST_LEDGER_KIND
    if (!costEntry && !before.touched && !after.touched) return entry
    return {
      ...row,
      ...(costEntry ? { amount_before_usd: null, amount_after_usd: null, amount_delta_usd: null } : {}),
      ...('before_json' in row ? { before_json: before.value } : {}),
      ...('after_json' in row ? { after_json: after.value } : {}),
      courier_cost_hidden: true,
    }
  })
}

const AUDIT_COST_HINT = /actual_cost_|delivery_actual_cost|actual_delivery_cost/

/** Audit-log rows without the cost in `details`, `old_value` and `new_value`; a row without the figure is returned as it was. */
export function redactAuditRows<T extends object>(rows: T[], user: PermissionUser): T[] {
  if (canViewCourierCost(user)) return rows
  return rows.map((entry) => {
    const row = entry as T & Record<string, unknown>
    let changed: Record<string, unknown> | null = null
    for (const column of ['details', 'old_value', 'new_value'] as const) {
      const value = row[column]
      if (typeof value !== 'string' || !AUDIT_COST_HINT.test(value)) continue
      const stripped = stripSnapshot(value)
      if (stripped.touched) changed = { ...(changed ?? {}), [column]: stripped.value }
    }
    return changed ? { ...row, ...changed } : entry
  })
}

/** One sale's Records trail: no record disappears and no count changes; the field rows, snapshot amounts and summary figures leave. */
export function redactSaleRecords(records: SaleRecord[], user: PermissionUser): SaleRecord[] {
  if (canViewCourierCost(user)) return records
  return records.map((record) => {
    const summary = record.summary.replace(COURIER_COST_SUMMARY, '$1 changed')
    if (!record.changes) return summary === record.summary ? record : { ...record, summary }
    const changes = record.changes
      .filter((change) => change.field !== 'actual_delivery_cost_usd')
      .flatMap((change) => {
        const before = stripCourierCost(change.before)
        const after = stripCourierCost(change.after)
        if (!before.touched && !after.touched) return [change]
        // A row whose only difference was the courier cost is not a change a reader may see.
        if (JSON.stringify(before.value) === JSON.stringify(after.value)) return []
        return [{ ...change, before: before.value as typeof change.before, after: after.value as typeof change.after }]
      })
    return { ...record, summary, changes }
  })
}

const SERIALIZED_COLUMN = /(?:_json|^details|^old_value|^new_value)$/i

/** Any response body for a caller who may not read a sale's cost: cost keys leave at every depth, JSON held in strings included. */
export function projectCourierCostResponse(body: unknown, user: PermissionUser): unknown {
  if (canViewCourierCost(user)) return body
  const project = (input: unknown, depth: number): unknown => {
    if (input === null || typeof input !== 'object') return input
    if (depth > MAX_STRIP_DEPTH) return null
    if (Array.isArray(input)) return input.map((item) => project(item, depth + 1))
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(input as Record<string, unknown>)) {
      if (isCourierCostKey(key)) continue
      out[key] = typeof child === 'string' && SERIALIZED_COLUMN.test(key) ? stripSnapshot(child).value : project(child, depth + 1)
    }
    return out
  }
  return project(body, 0)
}

/**
 * Installed on the sales router. A mutation response (add items, amend, status, create
 * and its replay) carries the sale's canonical row, cost columns included, so it leaves
 * through the same rule as the list. Plain reads are projected by their own handlers.
 */
export const courierCostResponses: MiddlewareHandler = async (c, next) => {
  const json: Function = c.json
  const mutation = c.req.method !== 'GET' || c.req.path.endsWith('/create-receipt')
  c.json = ((...args: Parameters<Context['json']>) => {
    if (mutation) args[0] = projectCourierCostResponse(args[0], c.get('user')) as typeof args[0]
    return Reflect.apply(json, c, args)
  }) as Context['json']
  await next()
}
