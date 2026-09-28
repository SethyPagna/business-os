// P-public-10 (owner, 2026-09-25): the compact storefront filter shows what is
// active as removable chips under the search row, so a shopper can see and
// undo one filter without reopening the Filters panel. Pure so a node test can
// pin the order and the removal semantics (no JSX here).
//
// Chip order follows the field order in the panel -- most useful first:
// category, brand, promotions, stock, then the admin-only branch facet and the
// letter picked on the brand index rail.

export type PortalActiveFilterKind = 'category' | 'brand' | 'promo' | 'stock' | 'branch' | 'initial'

export interface PortalActiveFilterChip {
  key: string
  kind: PortalActiveFilterKind
  value: string
  label: string
}

export interface PortalActiveFilterInput {
  categoryFilter: readonly string[]
  brandFilter: readonly string[]
  promoFacet: string
  stockFilter: readonly string[]
  showStockStatus: boolean
  branchFilter: readonly string[]
  initialFilter: string
  promoLabel: string
  stockLabel: (value: string) => string
  branchLabel: (value: string) => string
  allInitialKey: string
}

export function buildPortalActiveFilterChips(input: PortalActiveFilterInput): PortalActiveFilterChip[] {
  const chips: PortalActiveFilterChip[] = []
  const push = (kind: PortalActiveFilterKind, value: string, label: string) => {
    const text = String(label || value).trim()
    if (!String(value || '').trim() || !text) return
    chips.push({ key: `${kind}:${value}`, kind, value, label: text })
  }
  input.categoryFilter.forEach((value) => push('category', value, value))
  input.brandFilter.forEach((value) => push('brand', value, value))
  if (input.promoFacet) push('promo', input.promoFacet, input.promoLabel)
  // Mirrors portalActiveFilterCount: a hidden stock facet is not counted, so
  // it gets no chip either (the shopper has no control to see it by).
  if (input.showStockStatus) input.stockFilter.forEach((value) => push('stock', value, input.stockLabel(value)))
  input.branchFilter.forEach((value) => push('branch', value, input.branchLabel(value)))
  if (input.initialFilter && input.initialFilter !== input.allInitialKey) push('initial', input.initialFilter, input.initialFilter)
  return chips
}

/** The list without `value` -- only that one entry, never the whole facet. */
export function withoutFilterValue(list: readonly string[], value: string): string[] {
  return list.filter((entry) => entry !== value)
}
