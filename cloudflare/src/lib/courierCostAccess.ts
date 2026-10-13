import { isAdminControlUser, type PermissionUser } from './permissions'
import type { SaleRecord } from './saleRecords'

// The courier's actual cost -- what the SHOP paid the driver -- is an
// administrator-only figure, the same gate every report applies. A cost-view
// grant does not open it (the generic cost-key matcher in acquisitionCostAccess
// skips delivery and courier keys on purpose, so the customer's delivery FEE,
// which is revenue, is never hidden). This module is that gate for the sale's
// own history: the Records trail and the amendment ledger, which carry the
// figure as before/after values, as snapshots and written into summary text.
export function canViewCourierCost(user: PermissionUser): boolean {
  return isAdminControlUser(user)
}

/** The ledger kind whose whole content is the courier cost. */
export const COST_LEDGER_KIND = 'delivery_actual_cost_changed'

const COURIER_COST_KEYS = new Set([
  'delivery_actual_cost_usd', 'delivery_actual_cost_khr', 'actual_delivery_cost_usd', 'actual_delivery_cost_khr',
  // The audit row of a cost amendment names its two sides this way.
  'actual_cost_before', 'actual_cost_after',
])

/** The one summary saleRecords.ts writes for a cost change: "Actual delivery cost $0.83 to $1.37" (an unset side is "-"). */
const COURIER_COST_SUMMARY = /^(Actual delivery cost) (?:\$-?\d+(?:\.\d+)?|-) to (?:\$-?\d+(?:\.\d+)?|-)/

type Stripped<T> = { value: T; touched: boolean }

function stripCourierCost(input: unknown, depth = 0): Stripped<unknown> {
  if (depth > 12 || input === null || typeof input !== 'object') return { value: input, touched: false }
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
    if (COURIER_COST_KEYS.has(key)) { touched = true; continue }
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
 * The amendment ledger as a caller may read it. A cost-change entry keeps its
 * id, actor, time and note but loses the three amount columns (the delta would
 * give the cost back by subtraction), and every snapshot loses the courier-cost
 * keys. An entry that was redacted says so with `courier_cost_hidden`, so a
 * screen can print a dash instead of a zero or "Not recorded".
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

/**
 * Audit-log rows as a caller may read them. A sale amendment's audit row holds
 * the courier cost in `details` and `new_value` (a cost change names it
 * actual_cost_before / actual_cost_after; adding delivery nests the full
 * before/after snapshot), so the same keys leave those columns. A row without
 * the figure is returned as it was.
 */
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

/**
 * One sale's Records trail as a caller may read it. No record disappears and
 * no count changes: the courier-cost change is still listed with its actor and
 * time, only the amounts leave -- the field rows, the amounts inside the
 * creation and delivery snapshots, and the figures written into summary text.
 */
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
        // A row whose only difference was the courier cost is not a change a
        // reader may see.
        if (JSON.stringify(before.value) === JSON.stringify(after.value)) return []
        return [{ ...change, before: before.value as typeof change.before, after: after.value as typeof change.after }]
      })
    return { ...record, summary, changes }
  })
}
