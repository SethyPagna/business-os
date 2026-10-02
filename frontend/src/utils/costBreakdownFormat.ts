// P10-6/P10-11: pure formatting helpers for the cost-calculation float --
// testable without React or a fetch. The float's own arithmetic is never
// re-derived here: the numbers it renders (distinct_usd, mean_usd,
// result_usd, outlier_guard) all come straight from GET
// /api/products/:id/cost-breakdown, which shares the catalog's distinct
// positive-cost mean (not the separate product-merge outlier policy). This module
// only turns those numbers into the "(3.00 + 5.00) / 2 = 4.00" reading.
//
// P10-11 (owner ruling, 2026-09-17): manual cost-price edits are now their
// own row source ('manual'), and every row carries the lot/user context the
// old "<sequence> · <branch>" label collapsed away. The Worker lane sends
// these fields alongside the legacy `label` (still present for older
// payloads/tests); normalize defensively so a payload missing the new
// fields still renders using `label`.
//
// P10-11 correction (owner, same day): a manual override REPLACES the cost
// going forward -- lots received before the latest override stop counting
// ('overridden'), while an earlier manual entry a later one replaced stays
// 'superseded'. Both are just another excluded reason to this module; the
// float dims and tags the row the same way for every reason.

// U-cost (owner, 2026-09-25): a lot with nothing left on hand ('depleted')
// no longer counts; the Worker lists those rows after the on-hand ones.
// Same day: the catalog cost is QUANTITY-WEIGHTED -- each counted row carries
// the quantity it weighs (weight_quantity) and its share of the total, and the
// payload carries the weighted terms, so this module renders
// "(2 × 12.00 + 8 × 12.50) / 10 = 12.40". Still no arithmetic of its own
// beyond the reading: every number comes from the Worker.
export type CostBreakdownExclusionReason = 'zero' | 'duplicate' | 'inactive' | 'superseded' | 'overridden' | 'depleted' | null

const EXCLUSION_REASONS: ReadonlySet<string> = new Set(['zero', 'duplicate', 'inactive', 'superseded', 'overridden', 'depleted'])

export type CostBreakdownInput = {
  source: 'lot' | 'manual' | 'catalog' | 'undo' | 'redo'
  label: string
  restored_basis?: 'none' | 'entry'
  target_entry_id?: number | null
  lot_code?: string | null
  batch_number?: number | null
  received_at?: string | null
  branch_name?: string | null
  user_name?: string | null
  recorded_at?: string | null
  previous_cost_usd?: number | null
  cost_usd: number | null
  cost_khr: number | null
  /** A lot's remaining on-hand quantity across branches; null on a manual row or an older payload. */
  remaining_quantity?: number | null
  /** The quantity this row weighs in the average (0 when it does not count). */
  weight_quantity: number
  /** weight_quantity / total weight, 0..1; null when the row does not weigh in or on an older payload. */
  share: number | null
  /** Nothing is on hand: this (newest received) lot's cost stands in. */
  fallback: boolean
  excluded: CostBreakdownExclusionReason
}

export type CostBreakdown = {
  product_id: number
  inputs: CostBreakdownInput[]
  /** SUM(quantity x cost_usd) / SUM(quantity); empty on an older payload. */
  weighted_terms: Array<{ cost_usd: number; quantity: number }>
  weighted_quantity: number
  distinct_usd: number[]
  distinct_khr: number[]
  mean_usd: number
  mean_khr: number
  /** Legacy wire metadata, retained for compatibility; not a catalog calculation rule. */
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

/** A quantity as the shelf counts it: whole units bare, fractions to at most 3dp. */
function quantityText(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)))
}

/**
 * The weighted reading: "(2 × 12.00 + 8 × 12.50) / 10 = 12.40". Empty when
 * nothing is on hand (the float then names the fallback lot instead).
 */
export function formatWeightedCostFormula(terms: Array<{ cost_usd: number; quantity: number }>, totalQuantity: number, resultUsd: number): string {
  if (!terms.length || !(totalQuantity > 0)) return ''
  const sum = terms.map((term) => `${quantityText(term.quantity)} × ${fixed2(term.cost_usd)}`).join(' + ')
  return `(${sum}) / ${quantityText(totalQuantity)} = ${fixed2(resultUsd)}`
}

/** The formula line for any payload: weighted when the Worker sent terms, the legacy distinct mean otherwise. */
export function formatBreakdownFormula(breakdown: CostBreakdown): string {
  return breakdown.weighted_terms.length
    ? formatWeightedCostFormula(breakdown.weighted_terms, breakdown.weighted_quantity, breakdown.result_usd)
    : formatCostFormula(breakdown.distinct_usd, breakdown.mean_usd)
}

/** A row's share of the on-hand total as a percentage ("80%", "33.3%"); '' when it does not weigh in. */
export function formatCostShare(share: number | null | undefined): string {
  if (share == null || !Number.isFinite(share) || share <= 0) return ''
  const rounded = Number((share * 100).toFixed(1))
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`
}

/** "8" -- the on-hand quantity a counted row weighs; '' when it does not weigh in. */
export function formatCostWeight(input: Pick<CostBreakdownInput, 'weight_quantity'>): string {
  return input.weight_quantity > 0 ? quantityText(input.weight_quantity) : ''
}

/** i18n key for a lot's exclusion reason -- callers translate with their own `t`. */
export function costExclusionLabelKey(excluded: CostBreakdownExclusionReason): string | null {
  if (excluded === 'zero') return 'cost_breakdown_excluded_zero'
  if (excluded === 'duplicate') return 'cost_breakdown_excluded_duplicate'
  if (excluded === 'inactive') return 'cost_breakdown_excluded_inactive'
  if (excluded === 'superseded') return 'cost_breakdown_excluded_superseded'
  if (excluded === 'overridden') return 'cost_breakdown_excluded_overridden'
  if (excluded === 'depleted') return 'cost_breakdown_excluded_depleted'
  return null
}

/**
 * A LOT row's primary (left) text -- one compact line: the lot code, falling
 * back to its (already dd/mm/yyyy formatted, by the caller's `fmtDate`)
 * received date, then its batch number, so an older/thinner payload still
 * reads as something concrete rather than the bare "1 · Shop" sequence
 * label. Never called for a 'manual' row -- that row's primary text is
 * always the translated "Override" tag, rendered directly by the caller.
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
  if (['manual', 'undo', 'redo'].includes(input.source)) {
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
    source: entry.source === 'undo' || entry.source === 'redo' || entry.source === 'manual' || entry.source === 'lot' ? entry.source : 'catalog',
    restored_basis: entry.restored_basis === 'none' || entry.restored_basis === 'entry' ? entry.restored_basis : undefined,
    target_entry_id: typeof entry.target_entry_id === 'number' && Number.isSafeInteger(entry.target_entry_id) ? entry.target_entry_id : null,
    label: entry.label == null ? '' : String(entry.label),
    lot_code: entry.lot_code == null ? null : String(entry.lot_code),
    batch_number: entry.batch_number == null ? null : Number(entry.batch_number),
    received_at: entry.received_at == null ? null : String(entry.received_at),
    branch_name: entry.branch_name == null ? null : String(entry.branch_name),
    user_name: entry.user_name == null ? null : String(entry.user_name),
    recorded_at: entry.recorded_at == null ? null : String(entry.recorded_at),
    previous_cost_usd: typeof entry.previous_cost_usd === 'number' && Number.isFinite(entry.previous_cost_usd) ? entry.previous_cost_usd : null,
    cost_usd: entry.cost_usd == null ? null : Number(entry.cost_usd),
    cost_khr: entry.cost_khr == null ? null : Number(entry.cost_khr),
    remaining_quantity: entry.remaining_quantity == null ? null : Number(entry.remaining_quantity),
    weight_quantity: typeof entry.weight_quantity === 'number' && Number.isFinite(entry.weight_quantity) && entry.weight_quantity > 0 ? entry.weight_quantity : 0,
    share: typeof entry.share === 'number' && Number.isFinite(entry.share) ? entry.share : null,
    fallback: entry.fallback === true,
    excluded: typeof entry.excluded === 'string' && EXCLUSION_REASONS.has(entry.excluded) ? entry.excluded as CostBreakdownExclusionReason : null,
  }))
  return {
    product_id: Number(raw.product_id) || 0,
    inputs,
    weighted_terms: Array.isArray(raw.weighted_terms)
      ? (raw.weighted_terms as Array<Record<string, unknown>>).flatMap((term) => {
        const cost = Number(term?.cost_usd), quantity = Number(term?.quantity)
        return Number.isFinite(cost) && Number.isFinite(quantity) && quantity > 0 ? [{ cost_usd: cost, quantity }] : []
      })
      : [],
    weighted_quantity: Number(raw.weighted_quantity) > 0 ? Number(raw.weighted_quantity) : 0,
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
