import type { MergeIdentityDiff, MergePricingChange } from './MergeStockChoiceDialog'

// WHEN A MERGE MAY LAND WITHOUT ASKING -- one rule, one place.
//
// This lived inline in useMergeStockChoice's fast path while
// MergeStockChoiceDialog computed, separately, which cost rows it would show.
// The two disagreed: the gate never looked at the averaged cost, so the
// canonical N15 pair (two recorded costs, similar enough to average, no stock,
// equal selling prices) skipped the dialog entirely and the cost-average
// section the dialog renders was unreachable. A gate and the panel it opens
// must be the same decision, so both call in here.
//
// The question this answers is not "is anything different" but "would this
// merge change something the operator has not been shown". Four things do:
//   * stock on the discarded row -- the disposition is theirs to choose;
//   * a price the fold would move onto the keeper;
//   * a name/barcode/cost difference, i.e. these may not be one product;
//   * a cost the merge would REWRITE -- filled in from the discarded row when
//     the keeper has none, or replaced by the mean when both rows carry one.
// Anything else really is bookkeeping and merges straight through.

/** Rounding scale for money comparisons: 4 decimal places, as roundCostUp4. */
const COST_SCALE = 10000

export type CostAverageRow = { field: string; from: number; to: number }

/**
 * The cost fields a fold actually MOVES, as before -> after rows. Shared by
 * the pair dialog and the whole-catalog dry run, which describe the same fold
 * from two ends and so must agree on what counts as a change: a mean landing
 * back on the kept row's own cost is not one, and neither is a rounding hair.
 */
export function costMoveRows(
  before?: Record<string, number> | null,
  after?: Record<string, number> | null,
): CostAverageRow[] {
  return Object.keys(after ?? {})
    .map((field) => ({
      field,
      from: Number(before?.[field]) || 0,
      to: Number(after?.[field]) || 0,
    }))
    .filter((row) => row.to && Math.round(row.from * COST_SCALE) !== Math.round(row.to * COST_SCALE))
}

/**
 * The cost fields this merge would REPLACE with the mean of the distinct costs
 * (owner ruling, 2026-09-04). Empty unless BOTH rows carry a real cost -- a
 * keeper with none is a costFill, a different thing said differently.
 */
export function costAverageRows(identity?: MergeIdentityDiff | null): CostAverageRow[] {
  if (identity?.costVerdict !== 'differs') return []
  return costMoveRows(identity.costBefore, identity.costAfter)
}

/**
 * True when the merge must stop and show MergeStockChoiceDialog first. False
 * only for a merge that changes nothing but the row count.
 */
export function mergeNeedsConfirmation(input: {
  needsChoice: boolean
  pricing?: MergePricingChange | null
  identity?: MergeIdentityDiff | null
}): boolean {
  const { needsChoice, pricing, identity } = input
  if (needsChoice) return true
  // A price the fold would raise on the keeper.
  if (pricing?.changes?.length) return true
  // Name + barcode + cost decide whether these are one product at all. A
  // cross-identity merge is never automatic, even with no stock and no price
  // to move -- the operator has to be told which field differs.
  if (identity && !identity.same && identity.differs.length) return true
  // The kept row has no cost of its own and would take the discarded row's
  // (the cost ruling: 0/NULL is missing, not different). That is the right
  // answer, and it still changes what the kept product cost -- so it is shown
  // and confirmed rather than applied on the quiet.
  if (identity?.costFill?.length) return true
  // Both rows carry a cost, they differ, and the keeper ends up costing a
  // figure NEITHER row recorded. That is the loudest thing this flow does.
  if (costAverageRows(identity).length) return true
  return false
}
