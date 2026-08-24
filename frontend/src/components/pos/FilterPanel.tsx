import { useMemo } from 'react'
import FilterMenu from '../shared/FilterMenu'
import { isMultiActive } from '../../utils/multiSelect'
import { buildHierarchicalCategoryFilterOptions } from '../shared/CategoryFilterOptions.tsx'
import { buildAvailabilityFilterSection } from '../shared/AvailabilityFilterOptions.tsx'
import { buildSearchModeFilterSection } from '../shared/SearchModeFilterOptions.tsx'
import type { SearchMode } from '../shared/SearchModeToggle'

type Translate = (key: string) => string | undefined
type FilterSetter = (value: string) => void

interface NamedOption {
  id?: string | number
  name: string
  color?: string
  is_default?: boolean
}

interface POSFilterPanelProps {
  t?: Translate
  disabled?: boolean
  onOpenChange?: (open: boolean) => void
  categories?: NamedOption[]
  brands?: string[]
  branches?: NamedOption[]
  suppliers?: string[]
  categoryFilter: string
  setCategoryFilter: FilterSetter
  // Optional: batch-select a whole "Main - Sub" hierarchical category group
  // in one tap (see utils/multiSelect.ts's toggleMultiValues). Falls back
  // to a flat per-category list (each row toggled individually via
  // setCategoryFilter) if not supplied, same fallback shape as
  // productMenuHelpers.ts's categoryOptions.
  setCategoryFilterBatch?: (values: string[], checked: boolean) => void
  brandFilter: string
  setBrandFilter: FilterSetter
  branchFilter: string
  setBranchFilter: FilterSetter
  stockFilter: string
  setStockFilter: FilterSetter
  groupFilter?: string
  setGroupFilter?: FilterSetter
  supplierFilter: string
  setSupplierFilter: FilterSetter
  // Optional: only rendered when both are supplied (older/other callers of
  // this component that haven't been updated yet just don't get the
  // section, same "no crash on a missing optional prop" pattern as
  // groupFilter/setGroupFilter above).
  searchMode?: SearchMode
  setSearchMode?: (mode: SearchMode) => void
}

function countActiveFlags(flags: boolean[] = []): number {
  let count = 0
  for (const flag of flags) {
    if (flag) count += 1
  }
  return count
}

// Rebuilt on top of the shared FilterMenu (pill trigger + popover, with a
// built-in search box for any section over its option-count threshold) so
// POS no longer maintains its own bespoke portal/positioning/outside-click
// logic -- that lived in POS.tsx and duplicated what FilterMenu already does.
export default function POSFilterPanel({
  t,
  disabled = false,
  onOpenChange,
  categories = [],
  brands = [],
  branches = [],
  suppliers = [],
  categoryFilter,
  setCategoryFilter,
  setCategoryFilterBatch,
  brandFilter,
  setBrandFilter,
  branchFilter,
  setBranchFilter,
  stockFilter,
  setStockFilter,
  groupFilter = 'all',
  setGroupFilter,
  supplierFilter,
  setSupplierFilter,
  searchMode,
  setSearchMode,
}: POSFilterPanelProps) {
  const T = (key: string, fallback: string): string => t?.(key) || fallback
  const normalizedGroupFilter = ['grouped', 'parent', 'variant'].includes(groupFilter) ? 'group' : groupFilter

  const activeCount = countActiveFlags([
    categoryFilter !== 'all',
    brandFilter !== 'all',
    branchFilter !== 'all',
    stockFilter !== 'all',
    normalizedGroupFilter !== 'all',
    supplierFilter !== 'all',
    searchMode === 'OR',
  ])

  const clearAll = () => {
    setCategoryFilter('all')
    setBrandFilter('all')
    setBranchFilter('all')
    setStockFilter('all')
    setGroupFilter?.('all')
    setSupplierFilter('all')
    setSearchMode?.('AND')
  }

  const sections = useMemo(() => {
    // Stock Status, Groups, and Branch merged into one flyout (per the
    // user's ask) instead of three separate top-level sections -- these
    // three are commonly set together ("healthy stock, standalone items,
    // at Branch X") and each was already collapsing to its own single
    // summary row, so combining them saves taps without losing any of the
    // underlying per-dimension state (still three separate filter
    // values/setters, just one shared UI surface). Shared with
    // Products/Inventory via components/shared/AvailabilityFilterOptions.tsx
    // so all three pages render the exact same merged section.
    const availabilitySection = buildAvailabilityFilterSection({
      t,
      branches,
      stockFilter,
      setStockFilter,
      groupFilter,
      setGroupFilter,
      branchFilter,
      setBranchFilter,
    })

    return [
      availabilitySection,
      searchMode && setSearchMode
        ? buildSearchModeFilterSection({ t, searchMode, setSearchMode })
        : null,
      categories.length > 0 && {
        id: 'category',
        label: T('category', 'Category'),
        searchable: true,
        options: [
          { id: 'all', label: T('all', 'All'), active: categoryFilter === 'all', onClick: () => setCategoryFilter('all') },
          // Hierarchical "Main - Sub" rows when a batch setter was supplied
          // (see setCategoryFilterBatch above), same behavior as
          // Products/Inventory; otherwise the old flat per-category list.
          ...(setCategoryFilterBatch
            ? buildHierarchicalCategoryFilterOptions({
                categoryNames: categories.map((category) => category.name),
                isSelected: (value) => isMultiActive(categoryFilter, value),
                onToggle: (values, checked) => setCategoryFilterBatch(values, checked),
              })
            : categories.map((category) => ({
                id: category.id || category.name,
                label: category.name,
                active: isMultiActive(categoryFilter, category.name),
                onClick: () => setCategoryFilter(category.name),
              }))),
        ],
      },
      brands.length > 0 && {
        id: 'brand',
        label: T('brand', 'Brand'),
        searchable: true,
        options: [
          { id: 'all', label: T('all', 'All'), active: brandFilter === 'all', onClick: () => setBrandFilter('all') },
          ...brands.map((brand) => ({
            id: brand,
            label: brand,
            active: isMultiActive(brandFilter, brand, true),
            onClick: () => setBrandFilter(brand),
          })),
        ],
      },
      // Supplier intentionally NOT shown in the POS filter menu -- POS only
      // ever exposes Availability (Branch+Group+Stock, merged), Category,
      // and Brand, per the "keep POS to just these three" decision. The
      // `suppliers`/`supplierFilter`/`setSupplierFilter` props stay on this
      // component (still used by `activeCount`/`clearAll` so a value set
      // some other way -- e.g. restored from sessionStorage -- still shows
      // in the count and still clears via "Clear all") but no section
      // renders it, so a person can no longer set it from this menu.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    ]
  }, [
    categories, brands, branches,
    categoryFilter, brandFilter, branchFilter, stockFilter, groupFilter, normalizedGroupFilter,
    searchMode, setSearchMode,
  ])

  return (
    <div className={disabled ? 'pointer-events-none opacity-60' : undefined}>
      <FilterMenu
        label={T('filters', 'Filters')}
        activeCount={activeCount}
        sections={sections}
        onClear={activeCount > 0 ? clearAll : null}
        // Icon-only + large: width now matches the AND/OR toggle next to it
        // (was a wide "Filters (n)" label button, much wider than AND/OR)
        // while staying a bigger/taller tap target than the default icon
        // trigger -- this was the one control on the row meant to stay the
        // easiest to hit, just narrower than before.
        iconOnly
        large
        onOpenChange={onOpenChange}
      />
    </div>
  )
}
