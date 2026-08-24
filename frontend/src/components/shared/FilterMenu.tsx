import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import Filter from 'lucide-react/dist/esm/icons/filter.js'
import Search from 'lucide-react/dist/esm/icons/search.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import { useMemo, useState, type ReactNode } from 'react'
import LazyPortalMenu from './LazyPortalMenu'

type CloseMenu = () => void

export type FilterOption = {
  id: string | number
  label: ReactNode
  title?: string
  active?: boolean
  disabled?: boolean
  onClick?: () => void
}

export type FilterSection = {
  id: string | number
  label: ReactNode
  description?: ReactNode
  options?: Array<FilterOption | null | undefined | false>
  render?: (helpers: { closeMenu: CloseMenu }) => ReactNode
  // Shows a small search box above this section's pills once it has more
  // options than SEARCH_THRESHOLD -- long lists (brands, suppliers, users,
  // etc.) become hard to scan/tap through as flat pill walls, so letting
  // the person type a few letters to narrow them down keeps the section
  // usable without changing its behavior for short lists.
  searchable?: boolean
  // For custom `render` sections only: the auto-computed "All"/"N selected"
  // summary only works for the plain options list, so a render section that
  // wants its collapsed row to reflect its actual state (e.g. a merged
  // Sort+Year+Month section showing "Newest first \u00b7 2026") supplies its
  // own summary text and active flag here instead.
  summary?: ReactNode
  active?: boolean
  // For custom `render` sections only: same reason as `summary` above --
  // a render section's active picks aren't a plain FilterOption[], so they
  // can't be auto-derived for the top-of-panel chip row (see
  // SelectedFilterChips below). Supply the currently-active picks here as
  // removable chips if the section should participate in that row; a
  // render section that omits this just won't contribute any chips.
  activeChips?: Array<{ id: string | number; label: ReactNode; onRemove: () => void }>
}

// Below this option count a search box adds friction rather than removing
// it (nothing to narrow down), so it only appears once a section actually
// needs it.
const SEARCH_THRESHOLD = 8

type FilterMenuProps = {
  label?: string
  activeCount?: number
  sections?: Array<FilterSection | null | undefined | false>
  onClear?: (() => void) | null
  compact?: boolean
  mobileIconOnly?: boolean
  // Always-icon-only trigger (no text label at any breakpoint) -- used by
  // toolbar rows consolidated down to icon buttons. Active-count shows as a
  // small badge instead of "(n)" text.
  iconOnly?: boolean
  // Bigger tap target with the label always visible (never collapses to
  // icon-only) -- for rows like POS's where the Filter trigger is a primary
  // touch control competing for space next to a language-dependent toggle
  // (e.g. Khmer AND/OR labels run much longer than "AND"/"OR"), so it needs
  // to stay both label-first and easy to tap at any breakpoint.
  large?: boolean
  onOpenChange?: ((open: boolean) => void) | null
}

const SECTION_LABEL_FALLBACKS: Record<string, string> = {
  action: 'Action',
  brand: 'Brand',
  brands: 'Brand',
  branch: 'Branch',
  branches: 'Branch',
  category: 'Category',
  createdmonth: 'Month',
  createdyear: 'Year',
  groupby: 'Group by',
  group: 'Groups',
  groups: 'Groups',
  month: 'Month',
  sort: 'Sort',
  stock: 'Stock',
  stockstatus: 'Stock',
  supplier: 'Supplier',
  user: 'User',
  year: 'Year',
}

function getSectionFallbackLabel(sectionId: string | number): string {
  const rawId = String(sectionId || '').trim()
  const normalizedId = rawId.toLowerCase()
  const compactId = normalizedId.replace(/[^a-z0-9]+/g, '')
  if (SECTION_LABEL_FALLBACKS[normalizedId]) return SECTION_LABEL_FALLBACKS[normalizedId]
  if (SECTION_LABEL_FALLBACKS[compactId]) return SECTION_LABEL_FALLBACKS[compactId]
  return rawId
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function resolveSectionLabel(section: FilterSection): ReactNode {
  if (typeof section.label !== 'string') return section.label
  const label = section.label.trim()
  const fallback = getSectionFallbackLabel(section.id)
  if (!label) return fallback || section.label
  if (label.toLowerCase() === 'back') return fallback || section.label
  return section.label
}

function optionMatchesQuery(option: FilterOption, query: string): boolean {
  if (!query) return true
  const haystack = [option.label, option.title].filter((value) => typeof value === 'string').join(' ').toLowerCase()
  return haystack.includes(query)
}

function optionLabelText(option: FilterOption | undefined): string {
  if (!option) return 'All'
  if (typeof option.label === 'string') return option.label
  if (typeof option.title === 'string') return option.title
  return 'All'
}

// Each section collapses to a single "Label: summary ▾" row by default
// (matching a standard multiselect combobox) and expands in place to reveal
// the search box + pill list -- rather than showing every section's full
// pill wall open at all times, which made the panel tall and hard to scan
// once a page had more than two or three filter dimensions.
function summarizeOptions(options: FilterOption[]): string {
  const [allOption, ...restOptions] = options
  if (!restOptions.length) return 'All'
  if (allOption?.active || restOptions.every((option) => !option.active)) return 'All'
  const activeOptions = restOptions.filter((option) => option.active)
  if (!activeOptions.length) return 'All'
  if (activeOptions.length === 1) return optionLabelText(activeOptions[0])
  return `${activeOptions.length} selected`
}

// Every section renders as a single column, one option per row -- a
// checkbox list under the search box, a solid dark "All" row pinned at
// the top -- matching the storefront catalog's filter panel style.
// (Previously, any section that wasn't both `searchable` and over
// SEARCH_THRESHOLD options fell back to a flex-wrap pill wall that
// visually broke into several pills per row -- i.e. laid out in columns
// -- instead of a single scannable column; every section now shares this
// one row-per-option list regardless of length or the `searchable` flag,
// so a short list like Stock Status looks and behaves the same way as a
// long one like Brand.)
//
// Selected options used to also render a second time, pinned in their own
// block directly under "All" -- so ticking "Haircare - Others" showed it
// once pinned at the top AND again in its normal spot further down the
// same list, and a hierarchical group (parent + several children) could
// show as four or five duplicated rows. That never matched the storefront
// catalog's own filter panel (PortalFilterCombobox), which only ever shows
// a selected option once, checked, in its natural place in the list. This
// now matches that: no pinned duplicate block, a selected row's checkbox
// simply shows checked right where it already lives in the list.
// Exported (not just used internally) so a page can compose several
// option lists inside one custom `render` section -- see POSFilterPanel's
// merged Stock/Branch/Groups "Availability" section, built from three of
// these stacked under their own sub-labels instead of three separate
// top-level FilterMenu sections.
export function SectionOptionList({
  options,
  searchable = false,
}: {
  options: FilterOption[]
  searchable?: boolean
}) {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const [allOption, ...restOptions] = options
  const matchingOptions = useMemo(
    () => restOptions.filter((option) => optionMatchesQuery(option, normalizedQuery)),
    [restOptions, normalizedQuery],
  )

  const renderOptionRow = (option: FilterOption, keyPrefix: string) => (
    <button
      key={`${keyPrefix}${option.id}`}
      type="button"
      disabled={option.disabled}
      onClick={() => option.onClick?.()}
      role="option"
      aria-selected={!!option.active}
      className={`mt-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors disabled:opacity-50 ${
        option.active
          ? 'bg-primary-50 text-primary-800 dark:bg-primary-900/30 dark:text-primary-300'
          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'
      }`}
      title={option.title || (typeof option.label === 'string' ? option.label : undefined)}
    >
      <span
        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
          option.active ? 'border-primary-600 bg-primary-600 dark:border-primary-400 dark:bg-primary-400' : 'border-slate-300 dark:border-slate-600'
        }`}
        aria-hidden="true"
      >
        {option.active ? <span className="h-1.5 w-1.5 rounded-sm bg-white dark:bg-slate-900" /> : null}
      </span>
      <span className="min-w-0 truncate">{option.label}</span>
    </button>
  )

  return (
    <div className="min-w-0">
      {options.length > SEARCH_THRESHOLD ? (
        <label className="relative mb-1.5 block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search..."
            className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2.5 text-xs text-slate-700 outline-none transition focus:border-primary-300 focus:ring-2 focus:ring-primary-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-primary-500/50 dark:focus:ring-primary-500/15"
          />
        </label>
      ) : null}
      <div className="max-h-56 overflow-y-auto rounded-lg" role="listbox">
        {allOption ? (
          <button
            type="button"
            disabled={allOption.disabled}
            onClick={() => allOption.onClick?.()}
            className={`sticky top-0 z-[1] flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold transition-colors disabled:opacity-50 ${
              allOption.active
                ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950'
                : 'bg-slate-50 text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
            }`}
            title={allOption.title || (typeof allOption.label === 'string' ? allOption.label : optionLabelText(allOption))}
          >
            {allOption.label}
          </button>
        ) : null}
        {matchingOptions.map((option) => renderOptionRow(option, ''))}
        {!matchingOptions.length ? (
          <div className="px-2.5 py-3 text-center text-[11px] text-slate-400">No matches</div>
        ) : null}
      </div>
    </div>
  )
}

// Selected picks shown as removable chips at the top of the panel, outside
// (above) every individual section's own flyout -- same pattern as the
// public catalog's PortalFilterCombobox, which always shows its picks as
// x-able chips under the trigger without needing to open the dropdown.
// The admin FilterMenu used to only ever show what's selected once you
// opened a given section's flyout; this surfaces everything active, across
// every section, in one glance right under the "Filters" header.
function collectSectionChips(section: FilterSection): Array<{ key: string; label: ReactNode; onRemove: () => void }> {
  if (section.render) {
    return (section.activeChips || []).map((chip) => ({
      key: `${section.id}-${chip.id}`,
      label: chip.label,
      onRemove: chip.onRemove,
    }))
  }
  const options = (section.options || []).filter(Boolean) as FilterOption[]
  // First entry in a plain options list is always the "All" pseudo-option
  // (see summarizeOptions/SectionOptionList) -- never a real pick, so it's
  // excluded the same way SectionOptionList excludes it from its own list.
  const [, ...restOptions] = options
  return restOptions
    .filter((option) => option.active && option.onClick)
    // A hierarchical category group's parent row (id `catgroup-*`, see
    // CategoryFilterOptions.tsx) shows itself as active as soon as ANY of
    // its children is picked -- that's deliberate for the checkbox itself
    // (so the parent visibly reflects a partial selection), but it isn't a
    // distinct selected value and shouldn't also get its own chip here:
    // picking 3 "Haircare - X" children should show 3 chips, not those 3
    // plus a 4th "Haircare" chip for the parent.
    .filter((option) => !String(option.id).startsWith('catgroup-'))
    .map((option) => ({
      key: `${section.id}-${option.id}`,
      label: option.title && typeof option.label !== 'string' ? option.title : option.label,
      onRemove: () => option.onClick?.(),
    }))
}

function SelectedFilterChips({ sections }: { sections: FilterSection[] }) {
  const chips = useMemo(
    () => sections.flatMap((section) => collectSectionChips(section)),
    [sections],
  )
  if (!chips.length) return null
  return (
    <div className="mb-3 flex min-w-0 flex-wrap gap-1.5 border-b border-slate-100 pb-3 dark:border-slate-800">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex max-w-full items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <span className="min-w-0 truncate">{chip.label}</span>
          <button
            type="button"
            onClick={chip.onRemove}
            className="shrink-0 text-slate-400 transition hover:text-slate-700 dark:hover:text-slate-100"
            aria-label="Remove filter"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  )
}

function FilterMenuSectionRow({
  section,
  closeMenu,
}: {
  section: FilterSection
  closeMenu: CloseMenu
}) {
  const options = (section.options || []).filter(Boolean) as FilterOption[]
  const isCustomRender = typeof section.render === 'function'
  const summary = isCustomRender ? (section.summary ?? null) : summarizeOptions(options)
  const isActive = isCustomRender ? !!section.active : summary !== 'All'

  return (
    <div
      className="overflow-visible rounded-[1.1rem] bg-slate-50 ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700"
      data-filter-menu-section={String(section.id)}
    >
      <div className="grid grid-cols-[5rem_minmax(0,1fr)] w-full min-w-0 items-center gap-2 px-2.5 py-2">
        <span
          className="min-w-0 truncate text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400"
          data-filter-menu-section-label={String(section.id)}
        >
          {resolveSectionLabel(section)}
        </span>
        {/* Only this pill is the click target -- not the label or the row
            around it -- and it opens as its own floating flyout (anchored
            to the pill, positioned via getBoundingClientRect like any other
            PortalMenu) rather than expanding inline. That way opening a
            section never pushes the sections below it down the page; it
            just floats a panel over them, and closes the same way any
            other popover does (outside click, Escape, or picking it again). */}
        <LazyPortalMenu
          align="auto"
          triggerWrapperClassName="min-w-0 w-full"
          menuClassName="w-[min(18rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-auto rounded-[1.1rem] border border-slate-200 bg-white p-2.5 shadow-xl shadow-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:shadow-black/30"
          trigger={(
            <button
              type="button"
              aria-label={typeof section.label === 'string' ? section.label : String(section.id)}
              className={`flex min-w-0 w-full items-center justify-between gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                isActive
                  ? 'border-primary-200 bg-primary-50 text-primary-800 dark:border-primary-700/60 dark:bg-primary-900/30 dark:text-primary-300'
                  : 'border-slate-200 bg-white text-slate-600 dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-300'
              }`}
            >
              <span className="min-w-0 truncate">{isCustomRender ? (summary ?? (typeof section.label === 'string' ? section.label : 'Options')) : summary}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform" />
            </button>
          )}
          content={() => (
            <div>
              {section.description ? (
                <p className="mb-1.5 text-[11px] leading-snug text-gray-500 dark:text-gray-400">{section.description}</p>
              ) : null}
              {isCustomRender ? section.render!({ closeMenu }) : <SectionOptionList options={options} searchable={!!section.searchable} />}
            </div>
          )}
        />
      </div>
    </div>
  )
}

export default function FilterMenu({
  label = 'Filters',
  activeCount = 0,
  sections = [],
  onClear = null,
  compact = false,
  mobileIconOnly = false,
  iconOnly = false,
  large = false,
  onOpenChange = null,
}: FilterMenuProps) {
  const hasActions = typeof onClear === 'function'
  const triggerLabel = activeCount > 0 ? `${label} (${activeCount})` : label

  return (
    <LazyPortalMenu
      align="auto"
      menuClassName="w-[min(22rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] overflow-hidden rounded-[1.35rem] border border-slate-200 bg-white p-0 shadow-xl shadow-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:shadow-black/30"
      onOpenChange={onOpenChange}
      trigger={(
        <button
          type="button"
          className={
            // Default sizing bumped up one notch app-wide (Aug 19 2026 UI
            // request: "filter buttons can be made larger") -- no call
            // site was passing `large` before this change, so the old
            // default was effectively the only size anyone saw. `large`
            // is bumped to match, so it stays visibly a step above the
            // (now bigger) default rather than collapsing to the same size.
            iconOnly
              ? `relative inline-flex shrink-0 items-center justify-center rounded-xl border transition-colors ${large ? 'h-10 w-10' : 'h-9 w-9'} ${
                  activeCount > 0
                    ? 'border-primary-700 bg-primary-600 text-white shadow-sm'
                    : 'border-slate-300 bg-white text-slate-700 shadow-sm hover:border-primary-400 hover:text-primary-800 hover:bg-primary-50/60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-300 dark:hover:bg-slate-700/80'
                }`
              : `inline-flex shrink-0 items-center gap-1.5 rounded-xl border font-semibold transition-colors ${
                  large ? 'px-4 py-2.5 text-sm sm:text-base' : 'px-3.5 py-2 text-sm'
                } ${
                  activeCount > 0
                    ? 'border-primary-700 bg-primary-600 text-white shadow-sm'
                    : 'border-slate-300 bg-white text-slate-700 shadow-sm hover:border-primary-400 hover:text-primary-800 hover:bg-primary-50/60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-300 dark:hover:bg-slate-700/80'
                } ${compact ? 'max-w-[9.5rem] px-2 py-1.5 sm:max-w-none sm:px-2.5' : ''}`
          }
          aria-label={label}
          title={triggerLabel}
        >
          <Filter className={large ? 'h-5 w-5 shrink-0' : 'h-[1.125rem] w-[1.125rem] shrink-0'} />
          {iconOnly ? (
            activeCount > 0 ? (
              <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-600 px-1 text-[10px] font-bold text-white ring-2 ring-white dark:ring-slate-900">
                {activeCount}
              </span>
            ) : null
          ) : (
            <>
              <span className={`truncate whitespace-nowrap ${mobileIconOnly ? 'hidden sm:inline' : ''}`}>{triggerLabel}</span>
              {mobileIconOnly && activeCount > 0 ? (
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-white/20 px-1 text-[10px] font-bold sm:hidden">
                  {activeCount}
                </span>
              ) : null}
            </>
          )}
        </button>
      )}
      content={({ closeMenu }) => (
        <div className="max-h-[min(32rem,70vh)] overflow-auto rounded-[1.35rem] p-2.5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-gray-900 dark:text-white">{label}</div>
            <div className="flex items-center gap-2">
              {hasActions ? (
                <button
                  type="button"
                  className="text-xs font-medium text-primary-700 hover:text-primary-800 dark:text-primary-300 dark:hover:text-primary-200"
                  onClick={() => {
                    onClear?.()
                    closeMenu()
                  }}
                >
                  Clear
                </button>
              ) : null}
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-white"
                onClick={closeMenu}
                aria-label={`Close ${label}`}
                title={`Close ${label}`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <SelectedFilterChips sections={sections.filter(Boolean) as FilterSection[]} />

          <div className="space-y-1.5">
            {(sections.filter(Boolean) as FilterSection[]).map((section) => (
              <FilterMenuSectionRow key={section.id} section={section} closeMenu={closeMenu} />
            ))}
          </div>
        </div>
      )}
    />
  )
}
