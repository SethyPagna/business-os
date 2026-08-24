import type { FilterOption } from '../components/shared/FilterMenu'

// Generic English month abbreviations used when a caller doesn't supply its
// own (localized) month labels. Values are zero-padded '01'-'12' to match
// CREATED_MONTH_OPTIONS and matchesYearMonthFilters' normalization.
const DEFAULT_MONTH_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ['01', 'Jan'], ['02', 'Feb'], ['03', 'Mar'], ['04', 'Apr'],
  ['05', 'May'], ['06', 'Jun'], ['07', 'Jul'], ['08', 'Aug'],
  ['09', 'Sep'], ['10', 'Oct'], ['11', 'Nov'], ['12', 'Dec'],
]

export interface BuildPeriodFilterOptionsParams {
  yearFilter: string
  setYearFilter: (value: string) => void
  monthFilter: string
  setMonthFilter: (value: string) => void
  availableYears: Array<string | number>
  allTimeLabel: string
  monthOptions?: ReadonlyArray<readonly [string, string]>
}

// Merges the Year and Month filters into a single flat list of pills meant
// to be appended after a section's sort-direction pills (see Sales.tsx,
// Inventory.tsx, Returns.tsx, AuditLog.tsx, the contacts tabs, and
// Products.tsx), instead of three separate filter-menu rows (Sort / Year /
// Month) that mostly duplicated the same "narrow down by time" idea.
//
// With no year picked yet: an "All time" pill plus one pill per available
// year. Once a year is picked: an "All time" pill to reset, the picked year
// itself (click to collapse back to the whole year), and that year's month
// pills right below it -- so picking a year narrows straight down to months
// in the same list instead of jumping to a different row/section.
export function buildPeriodFilterOptions({
  yearFilter,
  setYearFilter,
  monthFilter,
  setMonthFilter,
  availableYears,
  allTimeLabel,
  monthOptions = DEFAULT_MONTH_OPTIONS,
}: BuildPeriodFilterOptionsParams): FilterOption[] {
  const years = (availableYears || []).map((year) => String(year)).filter(Boolean)
  if (!years.length) return []

  const activeYear = yearFilter !== 'all' && yearFilter ? String(yearFilter) : null

  const resetToAllTime = () => {
    setYearFilter('all')
    setMonthFilter('all')
  }

  if (!activeYear) {
    return [
      {
        id: 'period-all',
        label: allTimeLabel,
        active: true,
        onClick: resetToAllTime,
      },
      ...years.map((year) => ({
        id: `period-year-${year}`,
        label: year,
        active: false,
        onClick: () => setYearFilter(year),
      })),
    ]
  }

  return [
    {
      id: 'period-all',
      label: allTimeLabel,
      active: false,
      onClick: resetToAllTime,
    },
    {
      id: `period-year-${activeYear}`,
      label: activeYear,
      active: monthFilter === 'all',
      title: monthFilter === 'all' ? undefined : activeYear,
      onClick: () => setMonthFilter('all'),
    },
    ...monthOptions.map(([value, label]) => ({
      id: `period-month-${value}`,
      label,
      active: monthFilter === value,
      onClick: () => setMonthFilter(monthFilter === value ? 'all' : value),
    })),
  ]
}
