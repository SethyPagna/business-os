import ArrowDown from 'lucide-react/dist/esm/icons/arrow-down.js'
import ArrowUp from 'lucide-react/dist/esm/icons/arrow-up.js'
import MapPin from 'lucide-react/dist/esm/icons/map-pin.js'
import Boxes from 'lucide-react/dist/esm/icons/boxes.js'
import ListChecks from 'lucide-react/dist/esm/icons/list-checks.js'
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle.js'
import Tag from 'lucide-react/dist/esm/icons/tag.js'
import Layers from 'lucide-react/dist/esm/icons/layers.js'
import ArrowDownWideNarrow from 'lucide-react/dist/esm/icons/arrow-down-wide-narrow.js'
import AppSelect, { type AppSelectOption } from '../shared/AppSelect.tsx'
import StatsRangeRow from '../shared/StatsRangeRow.tsx'
import SearchInput from '../shared/SearchInput.tsx'
import type { DateTimeRange, DateTimeRangeSource } from '../shared/DateTimeRangePicker.tsx'

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

type Fields = Record<'stock' | 'brand' | 'category' | 'sales' | 'customers' | 'received' | 'price' | 'cost', boolean>
const FILTER_ICONS = { branchId: MapPin, stockState: Boxes, state: ListChecks, reason: AlertCircle, brand: Tag, category: Layers, sortBy: ArrowDownWideNarrow }
type Props = {
  range: DateTimeRange
  onRangeChange: (range: DateTimeRange, source?: DateTimeRangeSource) => void
  query: string
  onQueryChange: (value: string) => void
  filters: InventoryCheckFilters
  onFiltersChange: (patch: Partial<InventoryCheckFilters>) => void
  fields: Fields
  branches: Array<{ id: number; name: string }>
  brands?: string[]
  categories?: string[]
  reasons?: string[]
  t: (key: string) => string
}

export default function InventoryCheckControls({ range, onRangeChange, query, onQueryChange, filters, onFiltersChange, fields, branches, brands = [], categories = [], reasons = [], t }: Props) {
  const all = { value: '', label: t('all') }
  const select = (key: keyof Omit<InventoryCheckFilters, 'sortDirection'>, label: string, options: AppSelectOption[]) => {
    const Icon = FILTER_ICONS[key]
    return <AppSelect key={key} value={filters[key]} options={options}
      onChange={value => onFiltersChange({ [key]: value })}
      prefix={<span title={label} className="flex"><Icon className="h-4 w-4" aria-hidden="true" /></span>}
      ariaLabel={label} className="shrink-0" buttonClassName="h-10 !py-0 !px-2 text-xs whitespace-nowrap" />
  }
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
      <StatsRangeRow layout="scroll" compactRange range={range} onRangeChange={onRangeChange} t={t} />
      <SearchInput id="inventory-check-search" value={query} onChange={onQueryChange}
        ariaLabel={t('search')} placeholder={t('search')} className="block min-w-0" inputClassName="h-10" />
      <div className="stats-date-presets flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto overscroll-x-contain pb-1" data-inventory-check-filters>
        {select('branchId', t('branch'), [{ value: '', label: t('all_branches') }, ...branches.map(branch => ({ value: String(branch.id), label: branch.name }))])}
        {select('state', t('inventory_check_state'), [all, { value: 'unstarted', label: t('inventory_check_unstarted') }, { value: 'done', label: t('done') }, { value: 'issue', label: t('issues') }])}
        {reasons.length ? select('reason', t('reason'), [all, ...reasons.map(reason => ({ value: reason, label: reason }))]) : null}
        {fields.stock ? select('stockState', t('stock_status'), [all, { value: 'in_stock', label: t('in_stock') }, { value: 'low_stock', label: t('low_stock') }, { value: 'out_of_stock', label: t('out_of_stock') }]) : null}
        {fields.brand && brands.length ? select('brand', t('brand'), [all, ...brands.map(brand => ({ value: brand, label: brand }))]) : null}
        {fields.category && categories.length ? select('category', t('category'), [all, ...categories.map(category => ({ value: category, label: category }))]) : null}
        {select('sortBy', t('sort_by'), sortOptions)}
        <button type="button" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700"
          aria-label={directionLabel} title={directionLabel}
          onClick={() => onFiltersChange({ sortDirection: filters.sortDirection === 'asc' ? 'desc' : 'asc' })}>
          <DirectionIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
