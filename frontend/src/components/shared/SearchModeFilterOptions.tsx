import { SectionOptionList, type FilterSection } from './FilterMenu'
import type { SearchMode } from './SearchModeToggle'

// Restores the AND/OR search-mode choice (removed as a standalone button
// next to the search box on Aug 19 2026 -- see Products.tsx/Inventory.tsx/
// POS.tsx's own "AND/OR toggle removed" comments) as a row INSIDE the
// Filter menu instead, per the follow-up request: keep AND as the default
// (unchanged), but make OR reachable again from inside Filters rather than
// as a separate always-visible button competing for space in the search
// row. Shared across Products/Inventory/POS the same way
// AvailabilityFilterOptions.tsx already is, so the three pages don't drift
// three separate copies of this.
//
// Deliberately a plain two-row SectionOptionList (AND / OR, one always
// active) rather than an "All + choices" list -- FilterMenu's own
// summarizeOptions() assumes the first option represents "no filter
// active" (see FilterMenu.tsx), which doesn't apply here: there's no
// "off" state, exactly one of AND/OR is always the current mode. `summary`/
// `active` are supplied explicitly instead, same as the merged
// Availability section does for the same reason.
export interface BuildSearchModeFilterSectionParams {
  t?: (key: string) => string | undefined
  searchMode: SearchMode
  setSearchMode: (mode: SearchMode) => void
}

export function buildSearchModeFilterSection({
  t,
  searchMode,
  setSearchMode,
}: BuildSearchModeFilterSectionParams): FilterSection {
  const T = (key: string, fallback: string): string => {
    const value = t?.(key)
    return value && value !== key ? value : fallback
  }

  const options = [
    {
      id: 'AND',
      label: T('and_filter', 'AND'),
      title: T('search_mode_and_hint', 'Matching ALL terms - click to match ANY term instead'),
      active: searchMode === 'AND',
      onClick: () => setSearchMode('AND'),
    },
    {
      id: 'OR',
      label: T('or_filter', 'OR'),
      title: T('search_mode_or_hint', 'Matching ANY term - click to match ALL terms instead'),
      active: searchMode === 'OR',
      onClick: () => setSearchMode('OR'),
    },
  ]

  return {
    id: 'search_mode',
    label: T('search_mode', 'Search mode'),
    description: T('search_comma_tip', 'Comma separates search groups \u00b7 space = AND within a group'),
    // AND is the default -- only flagged "active" (highlighted trigger,
    // counted toward the filter menu's activeCount) once OR is chosen,
    // same convention every other section here uses for its own default.
    summary: searchMode,
    active: searchMode === 'OR',
    activeChips: searchMode === 'OR'
      ? [{ id: 'search_mode', label: T('or_filter', 'OR'), onRemove: () => setSearchMode('AND') }]
      : [],
    render: () => <SectionOptionList options={options} />,
  }
}
