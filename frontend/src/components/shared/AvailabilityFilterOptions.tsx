import { SectionOptionList, type FilterSection } from './FilterMenu'
import { isMultiActive } from '../../utils/multiSelect'

// Shared "Availability" section: Stock Status + Groups + Branch merged into
// one flyout instead of three separate top-level filter sections. Started
// life inside components/pos/FilterPanel.tsx (see that file's own comment
// for the original reasoning -- these three are commonly set together,
// "healthy stock, standalone items, at Branch X", and each collapsed to its
// own single summary row anyway) and is pulled out here so Products and
// Inventory can render the exact same merged section instead of drifting
// their own copies. POS's FilterPanel now calls this too, so there is a
// single implementation of the merged section, not three.

interface NamedOption {
  id?: string | number
  name?: unknown
  is_default?: unknown
}

export interface BuildAvailabilityFilterSectionParams {
  t?: (key: string) => string | undefined
  branches?: NamedOption[]
  stockFilter: string
  setStockFilter: (value: string) => void
  groupFilter?: string
  setGroupFilter?: (value: string) => void
  branchFilter: string
  setBranchFilter: (value: string) => void
}

export function buildAvailabilityFilterSection({
  t,
  branches = [],
  stockFilter,
  setStockFilter,
  groupFilter = 'all',
  setGroupFilter,
  branchFilter,
  setBranchFilter,
}: BuildAvailabilityFilterSectionParams): FilterSection {
  // t() returns the raw key itself (never undefined/empty) on a miss, so
  // `t(key) || fallback` never actually falls back -- same fix as
  // ProductDetailModal.tsx/ProductHistoryPreviewModal.tsx's T().
  const T = (key: string, fallback: string): string => {
    const value = t?.(key)
    return value && value !== key ? value : fallback
  }
  // Some callers (older POS state) used 'grouped'/'parent'/'variant' as
  // synonyms for the "group" bucket -- normalize so the section's active
  // check lines up with whichever spelling a given page's state uses.
  const normalizedGroupFilter = ['grouped', 'parent', 'variant'].includes(groupFilter) ? 'group' : groupFilter

  const stockOptions = [
    { id: 'all', label: T('all', 'All'), active: stockFilter === 'all', onClick: () => setStockFilter('all') },
    { id: 'in_stock', label: T('in_stock', 'In Stock'), active: isMultiActive(stockFilter, 'in_stock'), onClick: () => setStockFilter('in_stock') },
    { id: 'healthy', label: T('healthy_stock', 'Healthy'), active: isMultiActive(stockFilter, 'healthy'), onClick: () => setStockFilter('healthy') },
    { id: 'low', label: T('low_stock', 'Low'), active: isMultiActive(stockFilter, 'low'), onClick: () => setStockFilter('low') },
    { id: 'out', label: T('out_of_stock', 'Out'), active: isMultiActive(stockFilter, 'out'), onClick: () => setStockFilter('out') },
  ]
  const groupOptions = [
    { id: 'all', label: T('all', 'All'), active: normalizedGroupFilter === 'all', onClick: () => setGroupFilter?.('all') },
    { id: 'group', label: T('groups', 'Groups'), active: isMultiActive(groupFilter, 'group'), onClick: () => setGroupFilter?.('group') },
    { id: 'standalone', label: T('standalone', 'Standalone'), active: isMultiActive(groupFilter, 'standalone'), onClick: () => setGroupFilter?.('standalone') },
  ]
  const branchOptions = [
    { id: 'all', label: T('all', 'All'), active: branchFilter === 'all', onClick: () => setBranchFilter('all') },
    ...branches.map((branch) => ({
      id: branch.id ?? String(branch.name),
      label: `${String(branch.name)}${branch.is_default ? ' (Default)' : ''}`,
      active: isMultiActive(branchFilter, String(branch.id)),
      onClick: () => setBranchFilter(String(branch.id)),
    })),
  ]

  // Combined summary for the merged section's collapsed trigger row -- the
  // first active (non-"all") label found across the three, joined, so e.g.
  // "Healthy \u00b7 Groups" instead of a bare "3 selected" that wouldn't say
  // *which* three dimensions.
  const activeLabels = [
    stockFilter !== 'all' ? stockOptions.find((o) => o.active && o.id !== 'all')?.label : null,
    normalizedGroupFilter !== 'all' ? groupOptions.find((o) => o.active && o.id !== 'all')?.label : null,
    branchFilter !== 'all' ? branchOptions.find((o) => o.active && o.id !== 'all')?.label : null,
  ].filter((label): label is string => typeof label === 'string')
  const availabilitySummary = activeLabels.length ? activeLabels.join(' \u00b7 ') : T('all', 'All')
  const availabilityActive = stockFilter !== 'all' || normalizedGroupFilter !== 'all' || branchFilter !== 'all'

  return {
    id: 'availability',
    label: T('availability', 'Availability'),
    summary: availabilitySummary,
    active: availabilityActive,
    render: () => (
      // Capped and independently scrolled (rather than trusting the
      // popover's own cap alone) so on a short/tablet screen the combined
      // content can't push the flyout's own close button out of reach --
      // see the original POS FilterPanel comment this was lifted from.
      <div className="max-h-[45vh] space-y-3 overflow-y-auto pr-0.5">
        <div>
          <div className="mb-1 px-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {T('stock_status', 'Stock Status')}
          </div>
          <SectionOptionList options={stockOptions} />
        </div>
        {branches.length > 1 ? (
          <div>
            <div className="mb-1 px-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {T('branch', 'Branch')}
            </div>
            <SectionOptionList options={branchOptions} />
          </div>
        ) : null}
        <div>
          <div className="mb-1 px-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {T('groups', 'Groups')}
          </div>
          <SectionOptionList options={groupOptions} />
        </div>
      </div>
    ),
  }
}
