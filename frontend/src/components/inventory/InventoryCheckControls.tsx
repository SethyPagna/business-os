import type { Ref } from 'react'
import FilterMenu, { type FilterOption, type FilterSection } from '../shared/FilterMenu.tsx'
import ScanSearchButton from '../shared/ScanSearchButton.tsx'
import SearchInput from '../shared/SearchInput.tsx'
import { isImeComposingKey } from '../../utils/imeComposition.ts'

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
/** The six values that live inside the Filters menu next to Sort. */
const FILTER_KEYS = ['branchId', 'state', 'reason', 'stockState', 'brand', 'category'] as const
const DEFAULT_SORT = { sortBy: 'name', sortDirection: 'asc' } as const

const isDefaultSort = (filters: Pick<InventoryCheckFilters, 'sortBy' | 'sortDirection'>) => filters.sortBy === DEFAULT_SORT.sortBy && filters.sortDirection === DEFAULT_SORT.sortDirection

/** How many Filters-menu choices are off their default: the six filters plus a non-default Sort. A fixed sole branch and the Issues tab's built-in state are not choices. */
export function countActiveFilters(filters: InventoryCheckFilters, shown: { branch: boolean; state: boolean }): number {
  return FILTER_KEYS.filter(key => filters[key] !== '' && (key !== 'branchId' || shown.branch) && (key !== 'state' || shown.state)).length + (isDefaultSort(filters) ? 0 : 1)
}

type Fields = Record<'stock' | 'brand' | 'category' | 'sales' | 'customers' | 'received' | 'price' | 'cost', boolean>
type Props = {
  /** What the box shows. Typing is read by the page after a pause. */
  query: string
  onQueryChange: (value: string) => void
  /** Enter or a camera scan: the page reads at once and treats it as a scan. */
  onQuerySubmit: (value: string) => void
  /** The <input> itself, so the page can focus it and anchor the scanner-gun hook on it. */
  searchRef?: Ref<HTMLInputElement>
  /** Show the word beside the camera icon: Scan is the main action of an open count session. */
  scanLabelled?: boolean
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
  /** The server capped a facet list: that section says so once, where the person is choosing. */
  limited?: Partial<Record<'brands' | 'categories' | 'reasons', boolean>>
  t: (key: string) => string
}

export default function InventoryCheckControls({ query, onQueryChange, onQuerySubmit, searchRef, scanLabelled = false, filters, onFiltersChange, onClear, fields, branches, brands = [], categories = [], reasons = [], showSessionStates = true, showStateFilter = true, limited = {}, t }: Props) {
  const soleBranch = branches.length === 1
  const choice = (key: typeof FILTER_KEYS[number], value: string, text: string): FilterOption => ({
    id: value === '' ? 'all' : value, label: text, active: filters[key] === value, onClick: () => onFiltersChange({ [key]: value }),
  })
  const section = (key: typeof FILTER_KEYS[number], text: string, options: Array<[string, string]>, searchable = false, capped = false): FilterSection => ({
    id: key, label: text, searchable, description: capped ? t('inventory_check_filter_options_limited') : undefined,
    options: [choice(key, '', t('all')), ...options.map(([value, optionText]) => choice(key, value, optionText))],
  })

  // Sort is a display order, folded into Filters (owner rule 31 Aug): one choice of field + direction, limited to what the viewer may see.
  const sortChoice = (sortBy: string, sortDirection: 'asc' | 'desc', text: string): FilterOption => ({
    id: `${sortBy}-${sortDirection}`, label: text, active: filters.sortBy === sortBy && filters.sortDirection === sortDirection, onClick: () => onFiltersChange({ sortBy, sortDirection }),
  })
  const named = (key: string, field: string) => t(key).replace('{field}', field)
  const highLow = (sortBy: string, field: string, both = true): FilterOption[] => [
    sortChoice(sortBy, 'desc', named('sort_field_high_low', field)), ...(both ? [sortChoice(sortBy, 'asc', named('sort_field_low_high', field))] : []),
  ]
  const sortOptions: FilterOption[] = [sortChoice('name', 'asc', t('sort_name_az')), sortChoice('name', 'desc', t('sort_name_za'))]
  if (fields.stock) sortOptions.push(...highLow('stock', t('stock')))
  if (fields.sales) sortOptions.push(...highLow('qty_sold', t('qty_sold')))
  if (fields.customers) sortOptions.push(...highLow('customer_count', t('customers'), false))
  if (fields.received) sortOptions.push(sortChoice('received_date', 'desc', named('sort_field_newest', t('received_date'))), sortChoice('received_date', 'asc', named('sort_field_oldest', t('received_date'))))
  if (fields.price) sortOptions.push(...highLow('price', t('selling_price')))
  if (fields.cost) sortOptions.push(...highLow('cost', t('cost_price')))

  const sections: FilterSection[] = [{ id: 'sort', label: t('sort'), options: sortOptions }]
  if (!soleBranch) sections.push({
    id: 'branchId', label: t('branch'), searchable: true,
    options: [choice('branchId', '', t('all_branches')), ...branches.map(branch => choice('branchId', String(branch.id), branch.name))],
  })
  if (showStateFilter) sections.push(section('state', t('inventory_check_state'), [...(showSessionStates ? [['unstarted', t('inventory_check_unstarted')], ['done', t('done')]] as Array<[string, string]> : []), ['issue', t('issues')]]))
  if (reasons.length) sections.push(section('reason', t('reason'), reasons.map(reason => [reason, reason]), true, limited.reasons))
  if (fields.stock) sections.push(section('stockState', t('stock_status'), [['in_stock', t('in_stock')], ['low_stock', t('low_stock')], ['out_of_stock', t('out_of_stock')]]))
  if (fields.brand && brands.length) sections.push(section('brand', t('brand'), brands.map(brand => [brand, brand]), true, limited.brands))
  if (fields.category && categories.length) sections.push(section('category', t('category'), categories.map(category => [category, category]), true, limited.categories))
  const activeCount = countActiveFilters(filters, { branch: !soleBranch, state: showStateFilter })

  return (
    <div className="flex min-w-0 items-center gap-1" data-inventory-check-controls data-inventory-check-search-row>
      <SearchInput id="inventory-check-search" value={query} onChange={onQueryChange} inputRef={searchRef}
        ariaLabel={t('search')} placeholder={t('search')} className="block min-w-0 flex-1" inputClassName="h-10"
        onKeyDown={event => { if (event.key === 'Enter' && !isImeComposingKey(event)) { event.preventDefault(); onQuerySubmit(event.currentTarget.value) } }} />
      {/* A scan only fills Search and narrows the list; nothing is saved or picked for the person. */}
      <ScanSearchButton onDetected={onQuerySubmit} showLabel={scanLabelled} t={t} />
      <FilterMenu label={t('filters')} activeCount={activeCount} sections={sections} onClear={onClear} iconOnly large />
    </div>
  )
}
