import type { FilterSection } from '../shared/FilterMenu'

// K5 / 9.2 (Part 421): the "Auto-merged" filter section for the Products
// page -- server-side (merged=auto -> COALESCE(p.auto_merged_count,0) > 0,
// see routes/products.ts), so it holds across pagination like the promo
// facet. Shows the products that ABSORBED in-file import merges (a later
// CSV row folding into an earlier row's product under the identity rule);
// each such product's row carries auto_merged_count, and its full merge
// log (the losing rows' original values) is readable at
// GET /api/products/auto-merges/:productId.
//
// Its own JSX file for the same reason as CreatedDateFilterOptions.tsx:
// productMenuHelpers.ts stays JSX-free so its tests run under plain node.

export interface BuildAutoMergedFilterSectionParams {
  t?: (key: string) => string | undefined
  mergedFilter: string
  setMergedFilter: (value: string) => void
}

export function buildAutoMergedFilterSection({
  t,
  mergedFilter,
  setMergedFilter,
}: BuildAutoMergedFilterSectionParams): FilterSection {
  const T = (key: string, fallback: string): string => {
    const value = t?.(key)
    return value && value !== key ? value : fallback
  }
  const active = mergedFilter === 'auto'
  const activeLabel = T('auto_merged_only', 'Auto-merged rows only')
  return {
    id: 'auto_merged',
    label: T('auto_merged', 'Auto-merged'),
    summary: active ? activeLabel : T('all', 'All'),
    active,
    activeChips: active ? [{
      id: 'auto_merged',
      label: activeLabel,
      onRemove: () => setMergedFilter('all'),
    }] : [],
    render: () => (
      <div className="space-y-1 p-2">
        <p className="px-1 text-[11px] text-gray-400 dark:text-gray-500">
          {T('auto_merged_hint', 'Products that absorbed duplicate rows during an import (same identity, merged automatically).')}
        </p>
        {([
          ['all', T('all', 'All')],
          ['auto', activeLabel],
        ] as Array<[string, string]>).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMergedFilter(value)}
            className={`block w-full rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${mergedFilter === value
              ? 'bg-blue-100/70 font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'}`}
          >
            {label}
          </button>
        ))}
      </div>
    ),
  }
}
