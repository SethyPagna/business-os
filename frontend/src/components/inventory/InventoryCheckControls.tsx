import type { ReactNode } from 'react'
import ArrowDown from 'lucide-react/dist/esm/icons/arrow-down.js'
import ArrowUp from 'lucide-react/dist/esm/icons/arrow-up.js'
import ArrowDownWideNarrow from 'lucide-react/dist/esm/icons/arrow-down-wide-narrow.js'
import AppSelect, { type AppSelectOption } from '../shared/AppSelect.tsx'
import FilterMenu, { type FilterOption, type FilterSection } from '../shared/FilterMenu.tsx'
import InfoHint from '../shared/InfoHint.tsx'
import ScanSearchButton from '../shared/ScanSearchButton.tsx'
import SearchInput from '../shared/SearchInput.tsx'
import SoleBranchLabel from '../shared/SoleBranchLabel.tsx'

export type InventoryCheckFilters = {
  branchId: string
  stockState: string
  state: string
  reason: string
  brand: string
  category: string
  sortBy: string
  sortDirection: 'asc' | 'desc'
}
/** The six values that live inside the Filters menu; sorting is a display order, not a filter. */
const FILTER_KEYS = ['branchId', 'state', 'reason', 'stockState', 'brand', 'category'] as const

/** How many Filters-menu choices are off their "All" default. A fixed sole branch and the Issues tab's built-in state are not choices. */
export function countActiveFilters(filters: InventoryCheckFilters, shown: { branch: boolean; state: boolean }): number {
  return FILTER_KEYS.filter(key => filters[key] !== '' && (key !== 'branchId' || shown.branch) && (key !== 'state' || shown.state)).length
}

type Fields = Record<'stock' | 'brand' | 'category' | 'sales' | 'customers' | 'received' | 'price' | 'cost', boolean>
type Props = {
  query: string
  onQueryChange: (value: string) => void
  filters: InventoryCheckFilters
  onFiltersChange: (patch: Partial<InventoryCheckFilters>) => void
  onClear: () => void
  fields: Fields
  branches: Array<{ id: number; name: string }>
  brands?: string[]
  categories?: string[]
  reasons?: string[]
  /** Done / Not started only make sense inside one session. */
  showSessionStates?: boolean
  /** The Issues tab is already "state = issue", so it has no Check status choice. */
  showStateFilter?: boolean
  /** The server capped a facet list: the person is told once, in a hint beside Filters. */
  optionsLimited?: boolean
  /** Extra icon toggles at the end of the sort row (Top customers). */
  trailing?: ReactNode
  t: (key: string) => string
}

export default function InventoryCheckControls({ query, onQueryChange, filters, onFiltersChange, onClear, fields, branches, brands = [], categories = [], reasons = [], showSessionStates = true, showStateFilter = true, optionsLimited = false, trailing, t }: Props) {
  const soleBranch = branches.length === 1 ? branches[0] : null
  const choice = (key: typeof FILTER_KEYS[number], value: string, text: string): FilterOption => ({
    id: value === '' ? 'all' : value, label: text, active: filters[key] === value, onClick: () => onFiltersChange({ [key]: value }),
  })
  const section = (key: typeof FILTER_KEYS[number], text: string, options: Array<[string, string]>, searchable = false): FilterSection => ({
    id: key, label: text, searchable, options: [choice(key, '', t('all')), ...options.map(([value, optionText]) => choice(key, value, optionText))],
  })
  const sections: FilterSection[] = []
  if (!soleBranch) sections.push({
    id: 'branchId', label: t('branch'), searchable: true,
    options: [choice('branchId', '', t('all_branches')), ...branches.map(branch => choice('branchId', String(branch.id), branch.name))],
  })
  if (showStateFilter) sections.push(section('state', t('inventory_check_state'), [...(showSessionStates ? [['unstarted', t('inventory_check_unstarted')], ['done', t('done')]] as Array<[string, string]> : []), ['issue', t('issues')]]))
  if (reasons.length) sections.push(section('reason', t('reason'), reasons.map(reason => [reason, reason]), true))
  if (fields.stock) sections.push(section('stockState', t('stock_status'), [['in_stock', t('in_stock')], ['low_stock', t('low_stock')], ['out_of_stock', t('out_of_stock')]]))
  if (fields.brand && brands.length) sections.push(section('brand', t('brand'), brands.map(brand => [brand, brand]), true))
  if (fields.category && categories.length) sections.push(section('category', t('category'), categories.map(category => [category, category]), true))
  const activeCount = countActiveFilters(filters, { branch: !soleBranch, state: showStateFilter })

  const sortOptions: AppSelectOption[] = [{ value: 'name', label: t('name') }]
  const sortFields = [
    ['stock', 'stock', 'stock'], ['qty_sold', 'sales', 'qty_sold'], ['customer_count', 'customers', 'customers'],
    ['received_date', 'received', 'received_date'], ['price', 'price', 'selling_price'], ['cost', 'cost', 'cost_price'],
  ] as const
  for (const [value, field, label] of sortFields) if (fields[field]) sortOptions.push({ value, label: t(label) })
  const directionLabel = t(filters.sortDirection === 'asc' ? 'inventory_check_ascending' : 'inventory_check_descending')
  const DirectionIcon = filters.sortDirection === 'asc' ? ArrowUp : ArrowDown
  return (
    <div className="min-w-0 space-y-1" data-inventory-check-controls>
      <div className="flex min-w-0 items-center gap-1" data-inventory-check-search-row>
        <SearchInput id="inventory-check-search" value={query} onChange={onQueryChange}
          ariaLabel={t('search')} placeholder={t('search')} className="block min-w-0 flex-1" inputClassName="h-10" />
        {/* A scan only fills Search; the person still chooses from the results. */}
        <ScanSearchButton onDetected={onQueryChange} t={t} />
        <FilterMenu label={t('filters')} activeCount={activeCount} sections={sections} onClear={onClear} iconOnly large />
        {optionsLimited ? <InfoHint text={t('inventory_check_filter_options_limited')} label={t('inventory_check_filter_options_limited')} /> : null}
      </div>
      <div className="stats-date-presets flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto overscroll-x-contain pb-1" data-inventory-check-filters>
        {soleBranch ? <SoleBranchLabel name={soleBranch.name} label={t('branch')} className="shrink-0 text-xs" /> : null}
        <AppSelect value={filters.sortBy} options={sortOptions} onChange={value => onFiltersChange({ sortBy: value })}
          prefix={<span title={t('sort_by')} className="flex"><ArrowDownWideNarrow className="h-4 w-4" aria-hidden="true" /></span>}
          ariaLabel={t('sort_by')} className="shrink-0" buttonClassName="h-10 !py-0 !px-2 text-xs whitespace-nowrap" />
        <button type="button" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700"
          aria-label={directionLabel} title={directionLabel}
          onClick={() => onFiltersChange({ sortDirection: filters.sortDirection === 'asc' ? 'desc' : 'asc' })}>
          <DirectionIcon className="h-4 w-4" aria-hidden="true" />
        </button>
        {trailing}
      </div>
    </div>
  )
}
