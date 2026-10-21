// The control block of the image-only Products view: received-date range with its presets, search + scanner,
// then one horizontal scroll row of compact selects. Every control after search exists only where the role holds
// the matching products_image_only_show_* grant, and the server refuses the same filter without it
// (cloudflare/src/lib/productImageOnlyQuery.ts), so a control is never offered that would answer 403.
// Option lists come from the search response's own `facets` -- never the shared filter vocabulary, which would
// hand the whole taxonomy to a role that was not granted it.
import { useRef } from 'react'
import Boxes from 'lucide-react/dist/esm/icons/boxes.js'
import Layers from 'lucide-react/dist/esm/icons/layers.js'
import Tag from 'lucide-react/dist/esm/icons/tag.js'
import ArrowDownWideNarrow from 'lucide-react/dist/esm/icons/arrow-down-wide-narrow.js'
import AppSelect, { type AppSelectOption } from '../shared/AppSelect.tsx'
import StatsRangeRow from '../shared/StatsRangeRow.tsx'
import SearchInput from '../shared/SearchInput.tsx'
import ScanSearchButton from '../shared/ScanSearchButton.tsx'
import { useScannerWedge, type ScanOrigin } from '../shared/useScannerWedge.ts'
import { useApp } from '../../AppContext'
import type { DateTimeRange, DateTimeRangeSource } from '../shared/DateTimeRangePicker.tsx'

export type ImageOnlyScope = {
  stockState: '' | 'in_stock' | 'low' | 'out' | 'healthy'
  category: string
  brand: string
  sort: 'name_asc' | 'name_desc'
}

type Props = {
  showBatches: boolean
  showStock: boolean
  showCategory: boolean
  showBrand: boolean
  range: DateTimeRange
  onRangeChange: (range: DateTimeRange, source?: DateTimeRangeSource) => void
  search: string
  onSearchChange: (value: string) => void
  scope: ImageOnlyScope
  onScopeChange: (patch: Partial<ImageOnlyScope>) => void
  categories: string[]
  brands: string[]
  t: (key: string) => string
}

// A chosen value stays selectable even when the latest facets no longer list it, so the select never shows a
// value it cannot name and a failed reload keeps what the person picked.
function withChosen(values: string[], chosen: string): string[] {
  return chosen && !values.includes(chosen) ? [chosen, ...values] : values
}

export default function ProductsImageOnlyControls({
  showBatches, showStock, showCategory, showBrand, range, onRangeChange, search, onSearchChange,
  scope, onScopeChange, categories, brands, t,
}: Props) {
  const { notify } = useApp() as unknown as { notify: (message: string, tone?: string) => void }
  // The scanner gun fills the search the camera and the keyboard fill (onSearchChange).
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  useScannerWedge({
    enabled: true,
    searchRef: searchInputRef,
    onScan: (code: string, origin: ScanOrigin) => {
      onSearchChange(code)
      if (origin === 'field') notify(t('scan_moved_to_search') || 'Barcode moved to search', 'info')
    },
  })
  const all: AppSelectOption = { value: '', label: t('all') }
  const select = (key: string, label: string, Icon: typeof Boxes, value: string, options: AppSelectOption[], onChange: (next: string) => void) => (
    <AppSelect key={key} value={value} options={options} onChange={onChange}
      prefix={<span title={label} className="flex"><Icon className="h-4 w-4" aria-hidden="true" /></span>}
      ariaLabel={label} className="shrink-0" buttonClassName="h-11 !py-0 !px-2 text-xs whitespace-nowrap" />
  )
  return (
    <div className="mb-3 min-w-0 space-y-1" data-products-image-only-controls>
      {showBatches ? (
        <StatsRangeRow layout="scroll" compactRange range={range} onRangeChange={onRangeChange} t={t} />
      ) : null}
      <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
        <SearchInput id="products-image-only-search" inputRef={searchInputRef} value={search} onChange={onSearchChange}
          ariaLabel={t('search')} placeholder={t('search')} className="block min-w-0 flex-1" inputClassName="h-11" />
        <ScanSearchButton onDetected={onSearchChange} t={t} />
      </div>
      <div className="stats-date-presets flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto overscroll-x-contain pb-1" data-products-image-only-filters>
        {showStock ? select('stockState', t('stock_status'), Boxes, scope.stockState, [
          all,
          { value: 'in_stock', label: t('in_stock') },
          { value: 'low', label: t('low_stock') },
          { value: 'out', label: t('out_of_stock') },
          { value: 'healthy', label: t('healthy_stock') },
        ], (value) => onScopeChange({ stockState: value as ImageOnlyScope['stockState'] })) : null}
        {showCategory ? select('category', t('category'), Layers, scope.category,
          [all, ...withChosen(categories, scope.category).map((value) => ({ value, label: value }))],
          (value) => onScopeChange({ category: value })) : null}
        {showBrand ? select('brand', t('brand'), Tag, scope.brand,
          [all, ...withChosen(brands, scope.brand).map((value) => ({ value, label: value }))],
          (value) => onScopeChange({ brand: value })) : null}
        {select('sort', t('sort_by'), ArrowDownWideNarrow, scope.sort, [
          { value: 'name_asc', label: t('name_a_z') },
          { value: 'name_desc', label: t('name_z_a') },
        ], (value) => onScopeChange({ sort: value === 'name_desc' ? 'name_desc' : 'name_asc' }))}
      </div>
    </div>
  )
}
