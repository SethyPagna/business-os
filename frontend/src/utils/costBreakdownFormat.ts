// P10-6/P10-11: pure formatting helpers for the cost-calculation float --
// testable without React or a fetch. The float's own arithmetic is never
// re-derived here: the numbers it renders (distinct_usd, mean_usd,
// result_usd, outlier_guard) all come straight from GET
// /api/products/:id/cost-breakdown, which is itself built from the same
// resolveMergedCostDetail the catalog cost recompute uses -- this module
// only turns those numbers into the "(3.00 + 5.00) / 2 = 4.00" reading.
//
// P10-11 (owner ruling, 2026-09-17): manual cost-price edits are now their
// own row source ('manual'), and every row carries the lot/user context the
// old "<sequence> · <branch>" label collapsed away. The Worker lane sends
// these fields alongside the legacy `label` (still present for older
// payloads/tests); normalize defensively so a payload missing the new
// fields still renders using `label`.

export type CostBreakdownExclusionReason = 'zero' | 'duplicate' | 'inactive' | 'superseded' | null

export type CostBreakdownInput = {
  source: 'lot' | 'manual' | 'catalog'
  label: string
  lot_code?: string | null
  batch_number?: number | null
  received_at?: string | null
  branch_name?: string | null
  user_name?: string | null
  recorded_at?: string | null
  cost_usd: number | null
  cost_khr: number | null
  excluded: CostBreakdownExclusionReason
}

export type CostBreakdown = {
  product_id: number
  inputs: CostBreakdownInput[]
  distinct_usd: number[]
  distinct_khr: number[]
  mean_usd: number
  mean_khr: number
  outlier_guard: { fired: boolean; kept: number | null }
  result_usd: number
  result_khr: number
}

/** Fixed 2dp, matching the owner's own example ("3.00 + 5.00) / 2 = 4.00") -- the stored figure keeps 4dp precision, only the reading is trimmed. */
function fixed2(value: number): string {
  return (Number.isFinite(value) ? value : 0).toFixed(2)
}

/**
 * "(3.00 + 5.00) / 2 = 4.00" -- the owner's own ask, verbatim (n_i + ... +
 * n_{i+k}) / i. Empty when there is nothing to divide (no distinct cost yet).
 */
export function formatCostFormula(distinctUsd: number[], meanUsd: number): string {
  if (!distinctUsd.length) return ''
  const sum = distinctUsd.map(fixed2).join(' + ')
  return `(${sum}) / ${distinctUsd.length} = ${fixed2(meanUsd)}`
}

/** i18n key for a lot's exclusion reason -- callers translate with their own `t`. */
export function costExclusionLabelKey(excluded: CostBreakdownExclusionReason): string | null {
  if (excluded === 'zero') return 'cost_breakdown_excluded_zero'
  if (excluded === 'duplicate') return 'cost_breakdown_excluded_duplicate'
  if (excluded === 'inactive') return 'cost_breakdown_excluded_inactive'
  if (excluded === 'superseded') return 'cost_breakdown_excluded_superseded'
  return null
}

/**
 * A LOT row's primary (left) text -- one compact line: the lot code, falling
 * back to its (already dd/mm/yyyy formatted, by the caller's `fmtDate`)
 * received date, then its batch number, so an older/thinner payload still
 * reads as something concrete rather than the bare "1 · Shop" sequence
 * label. Never called for a 'manual' row -- that row's primary text is
 * always the translated "Manual" tag, rendered directly by the caller.
 */
export function costRowPrimaryText(input: CostBreakdownInput, formattedReceivedDate: string | null): string {
  if (input.lot_code) return input.lot_code
  if (formattedReceivedDate) return formattedReceivedDate
  if (input.batch_number != null) return `#${input.batch_number}`
  return input.label
}

/**
 * The row's muted meta strip (right of/under the primary text): received
 * date + branch for a lot row, recorded date + username for a manual row.
 * `formattedDate` is already dd/mm/yyyy (the caller's `fmtDate`); dropped
 * from the meta strip when it was already used as the lot row's primary
 * text (i.e. there was no lot_code), so the same date never repeats twice
 * on one row.
 */
export function costRowMeta(input: CostBreakdownInput, formattedDate: string | null): string {
  const parts: string[] = []
  if (input.source === 'manual') {
    if (formattedDate) parts.push(formattedDate)
    if (input.user_name) parts.push(input.user_name)
  } else {
    if (formattedDate && input.lot_code) parts.push(formattedDate)
    if (input.branch_name) parts.push(input.branch_name)
  }
  return parts.join(' · ')
}

export function normalizeCostBreakdown(value: unknown): CostBreakdown | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const rawInputs = Array.isArray(raw.inputs) ? raw.inputs as Array<Record<string, unknown>> : []
  const inputs: CostBreakdownInput[] = rawInputs.map((entry) => ({
    source: entry.source === 'manual' ? 'manual' : entry.source === 'lot' ? 'lot' : 'catalog',
    label: entry.label == null ? '' : String(entry.label),
    lot_code: entry.lot_code == null ? null : String(entry.lot_code),
    batch_number: entry.batch_number == null ? null : Number(entry.batch_number),
    received_at: entry.received_at == null ? null : String(entry.received_at),
    branch_name: entry.branch_name == null ? null : String(entry.branch_name),
    user_name: entry.user_name == null ? null : String(entry.user_name),
    recorded_at: entry.recorded_at == null ? null : String(entry.recorded_at),
    cost_usd: entry.cost_usd == null ? null : Number(entry.cost_usd),
    cost_khr: entry.cost_khr == null ? null : Number(entry.cost_khr),
    excluded: (entry.excluded === 'zero' || entry.excluded === 'duplicate' || entry.excluded === 'inactive' || entry.excluded === 'superseded') ? entry.excluded : null,
  }))
  return {
    product_id: Number(raw.product_id) || 0,
    inputs,
    distinct_usd: Array.isArray(raw.distinct_usd) ? raw.distinct_usd.map(Number) : [],
    distinct_khr: Array.isArray(raw.distinct_khr) ? raw.distinct_khr.map(Number) : [],
    mean_usd: Number(raw.mean_usd) || 0,
    mean_khr: Number(raw.mean_khr) || 0,
    outlier_guard: {
      fired: !!(raw.outlier_guard as { fired?: unknown } | undefined)?.fired,
      kept: (raw.outlier_guard as { kept?: unknown } | undefined)?.kept != null ? Number((raw.outlier_guard as { kept?: unknown }).kept) : null,
    },
    result_usd: Number(raw.result_usd) || 0,
    result_khr: Number(raw.result_khr) || 0,
  }
}
