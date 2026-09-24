import type { FilterOption } from '../components/shared/FilterMenu'

// Generic month abbreviations used when a caller doesn't supply its own
// (localized) month labels. Values are zero-padded '01'-'12' to match
// CREATED_MONTH_OPTIONS and matchesYearMonthFilters' normalization.
//
// English and Khmer tables rather than a lang.json key: every caller of
// buildPeriodFilterOptions (Sales.tsx, Inventory.tsx, Returns.tsx,
// AuditLog.tsx, the contacts tabs, Products.tsx) already renders inside the
// full app chrome where document.documentElement.lang is always set (see
// AppContext.tsx's theme/lang effect), so reading it here needs no new prop
// threaded through any of those callers -- the same reason DateTimeRangePicker
// and the dashboard charts keep their own local month tables instead of
// routing single short labels through the pack.
const ENGLISH_MONTH_ABBREVIATIONS: ReadonlyArray<readonly [string, string]> = [
  ['01', 'Jan'], ['02', 'Feb'], ['03', 'Mar'], ['04', 'Apr'],
  ['05', 'May'], ['06', 'Jun'], ['07', 'Jul'], ['08', 'Aug'],
  ['09', 'Sep'], ['10', 'Oct'], ['11', 'Nov'], ['12', 'Dec'],
]
// Khmer has no separate short form the way Latin scripts truncate to three
// letters (Jan/Feb/...) -- the standard Gregorian month name IS already
// compact, so these are the full names, not an abbreviation.
const KHMER_MONTH_ABBREVIATIONS: ReadonlyArray<readonly [string, string]> = [
  ['01', 'មករា'], ['02', 'កុម្ភៈ'], ['03', 'មីនា'], ['04', 'មេសា'],
  ['05', 'ឧសភា'], ['06', 'មិថុនា'], ['07', 'កក្កដា'], ['08', 'សីហា'],
  ['09', 'កញ្ញា'], ['10', 'តុលា'], ['11', 'វិច្ឆិកា'], ['12', 'ធ្នូ'],
]

function buildDefaultMonthOptions(): ReadonlyArray<readonly [string, string]> {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : ''
  return lang === 'km' ? KHMER_MONTH_ABBREVIATIONS : ENGLISH_MONTH_ABBREVIATIONS
}

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
  monthOptions = buildDefaultMonthOptions(),
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
