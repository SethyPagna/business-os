import type { InventoryCheckFilters } from './InventoryCheckControls.tsx'

/** What a new count session will be taken from, in words: search and every chosen filter. */
export function describeCountScope(t: (key: string) => string, args: { query: string; filters: InventoryCheckFilters; stateApplies: boolean }): string {
  const { query, filters } = args
  const stateText: Record<string, string> = { not_checked: t('inventory_check_status_not_checked'), in_check: t('inventory_check_status_in_check'), ok: t('inventory_check_status_ok'), issue: t('inventory_check_status_differs') }
  const stockText: Record<string, string> = { in_stock: t('in_stock'), low_stock: t('low_stock'), out_of_stock: t('out_of_stock') }
  const parts = [
    query.trim() && `${t('search')}: ${query.trim()}`,
    args.stateApplies && filters.checkState && `${t('inventory_check_state')}: ${stateText[filters.checkState] ?? filters.checkState}`,
    filters.stockState && `${t('stock_status')}: ${stockText[filters.stockState] ?? filters.stockState}`,
    filters.brand && `${t('brand')}: ${filters.brand}`,
    filters.category && `${t('category')}: ${filters.category}`,
  ]
  return parts.filter(Boolean).join(' · ')
}
