import { normalizeText, productTwinKey, toProductId, type ProductGroup, type ProductGroupRow, type ProductGroupSection } from './productGrouping.ts'

// What Products does with a name group that holds unmerged twins, kept out of productGrouping.ts on purpose: that module rides in the
// storefront's catalog-products closure (performanceBudgets), and these are staff-only rules (the Products page's open state and its opt-in
// "Hide out-of-stock rows"), so they load with the Products chunk instead. Lane no-folded-duplicates, round 3.

// Products opens a name group folded unless it holds unmerged twins: those start OPEN so the pair is seen side by side
// (owner, 16 Nov 2026). A person's own fold or unfold afterwards is kept by the caller.
export function startsCollapsedGroup(group: { hasMultipleItems?: boolean; rows?: ReadonlyArray<Record<string, unknown>> } | null | undefined): boolean {
  return Boolean(group?.hasMultipleItems) && !groupHasUnmergedTwins(group)
}

export function groupHasUnmergedTwins(group: { rows?: ReadonlyArray<Record<string, unknown>> } | null | undefined): boolean {
  return Boolean(group?.rows?.some((row) => row.__unmergedTwin))
}

// The branch balances a row stands for: its own, plus those of its unmerged twins. Twins used to be folded into one row spanning their
// branches, and "hide out-of-stock rows" judged that one row; judging the cluster keeps the same answer now that each record is its own row.
function branchBalancesOf(row: ProductGroupRow, twinsByKey: Map<string, ProductGroupRow[]>): Array<Record<string, unknown>> {
  const members = twinsByKey.get(productTwinKey(row)) || [row]
  const byBranch = new Map<string, Record<string, unknown>>()
  for (const member of members) {
    const branchStock = Array.isArray(member?.branch_stock) ? member.branch_stock as Array<Record<string, unknown>> : []
    for (const entry of branchStock) {
      const key = String(entry?.branch_id ?? entry?.branch_name ?? '')
      const existing = byBranch.get(key)
      byBranch.set(key, existing ? { ...existing, quantity: Number(existing.quantity || 0) + Number(entry?.quantity || 0) } : { ...entry })
    }
  }
  return [...byBranch.values()]
}

function isAllBranchZeroRow(row: ProductGroupRow, twinsByKey: Map<string, ProductGroupRow[]>): boolean {
  const branchStock = branchBalancesOf(row, twinsByKey)
  // This rule is intentionally limited to a real multi-branch row. A
  // standalone zero-stock product (or a product tracked at only one branch)
  // remains visible; only redundant children whose recorded branch balances
  // are all zero are removed from a same-name multi-row group. A product with
  // unmerged twins is judged across the twins' branches, as it was when they
  // were one folded row.
  return branchStock.length >= 2 && branchStock.every((entry) => Number(entry?.quantity || 0) <= 0)
}

// OPT-IN only. Products.tsx runs this exclusively when the operator turns on
// the "Hide out-of-stock rows" option in the shared FilterMenu -- it is off by
// default, because a row this drops is a row that cannot be found, opened,
// edited or restocked from the Products page at all. Each surviving group
// reports how many of its rows went away via hiddenZeroStockRowCount so the
// header can show a "N hidden" affordance rather than a silently shorter list.
export function hideZeroStockGroupedChildRows(sections: ProductGroupSection[] = []): ProductGroupSection[] {
  return sections.map((section) => {
    const groups = section.groups.flatMap((group): ProductGroup[] => {
      if (group.rows.length <= 1) return [group]
      const twinsByKey = new Map<string, ProductGroupRow[]>()
      for (const row of group.rows) {
        const key = productTwinKey(row)
        if (key) twinsByKey.set(key, [...(twinsByKey.get(key) || []), row])
      }
      // A group whose rows are all one twin cluster WAS one folded row, and a lone row is always kept (above). Count
      // products the way the fold did -- a twin cluster is one -- so a zero twin pair shows exactly as one zero record would.
      const productCount = group.rows.reduce((count, row) => count + (productTwinKey(row) && twinsByKey.get(productTwinKey(row))![0] !== row ? 0 : 1), 0)
      if (productCount <= 1) return [group]
      const rows = group.rows.filter((row) => !isAllBranchZeroRow(row, twinsByKey))
      if (!rows.length) return []
      const visibleIds = new Set(rows.flatMap((row) => row.__mergedProductIds || []).map(toProductId))
      const items = group.items.filter((item) => visibleIds.has(toProductId(item?.id)))
      const branchNames = [...new Set(rows.flatMap((row) => (
        Array.isArray(row.branch_stock)
          ? (row.branch_stock as Array<Record<string, unknown>>).map((entry) => normalizeText(entry?.branch_name)).filter(Boolean)
          : []
      )))].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
      return [{
        ...group,
        rows,
        items,
        ids: items.map((item) => toProductId(item?.id)).filter((id) => id > 0),
        matchedIds: group.matchedIds.filter((id) => visibleIds.has(id)),
        sellableItems: group.sellableItems.filter((item) => visibleIds.has(toProductId(item?.id))),
        leadProduct: rows[0],
        anchorId: toProductId(rows[0]?.id),
        stockTotal: rows.reduce((sum, row) => sum + Number(row?.stock_quantity || 0), 0),
        branchNames,
        hasMultipleItems: items.length > 1,
        hiddenZeroStockRowCount: group.rows.length - rows.length,
      }]
    })
    return {
      ...section,
      groups,
      ids: groups.flatMap((group) => group.ids),
      items: groups.flatMap((group) => group.items),
    }
  }).filter((section) => section.groups.length > 0)
}
