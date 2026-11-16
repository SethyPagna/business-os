// The tooltip on the "Duplicate" tag of an unmerged twin. The way out is the Products > Conflicts tab, which needs
// the merge_duplicates action (shared/hubNavigation.ts); a role without it is told to ask a manager instead of being
// sent to a tab it cannot open. One function so Products, Inventory and the Transfer picker cannot drift apart.
export function unmergedTwinHint(translate: (key: string) => string | undefined, canMerge: boolean): string {
  return canMerge
    ? (translate('product_twin_row_hint') || 'Same name and barcode as another product. Merge it in the Conflicts tab.')
    : (translate('product_twin_row_hint_ask') || 'Same name and barcode as another product. Ask a manager to merge them.')
}
