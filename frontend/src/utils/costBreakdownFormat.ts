// P10-6: pure formatting helpers for the cost-calculation float --
// testable without React or a fetch. The float's own arithmetic is never
// re-derived here: the numbers it renders (distinct_usd, mean_usd,
// result_usd, outlier_guard) all come straight from GET
// /api/products/:id/cost-breakdown, which is itself built from the same
// resolveMergedCostDetail the catalog cost recompute uses -- this module
// only turns those numbers into the "(3.00 + 5.00) / 2 = 4.00" reading.

export type CostBreakdownExclusionReason = 'zero' | 'duplicate' | 'inactive' | null

export type CostBreakdownInput = {
  source: 'lot' | 'catalog'
  label: string
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
  return null
}

export function normalizeCostBreakdown(value: unknown): CostBreakdown | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const inputs = Array.isArray(raw.inputs) ? raw.inputs as CostBreakdownInput[] : []
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
