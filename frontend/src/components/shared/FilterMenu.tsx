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

// Redesign (Aug 30 2026): each section is an ACCORDION row inside the one
// panel -- tap the header, its options expand inline right below it; tap
// another header, it swaps. The previous design floated a SECOND popover
// over the panel per section (button -> panel -> flyout), which stacked two
// popovers, hid the other sections' state while adjusting one, and capped
// every label at a 5rem grid column. One panel, one scroll, no nesting;
// the header keeps the label (natural width now) with the live summary and
// a rotating chevron on the right, and lights up when its section has picks.
function FilterMenuSectionRow({
  section,
  closeMenu,
  open,
  onToggle,
}: {
  section: FilterSection
  closeMenu: CloseMenu
  open: boolean
  onToggle: () => void
}) {
  const options = (section.options || []).filter(Boolean) as FilterOption[]
  const isCustomRender = typeof section.render === 'function'
  const summary = isCustomRender ? (section.summary ?? null) : summarizeOptions(options)
  const isActive = isCustomRender ? !!section.active : summary !== 'All'

  return (
    <div
      className={`overflow-hidden rounded-[1.1rem] ring-1 transition-colors ${
        open
          ? 'bg-white ring-primary-200 dark:bg-slate-900 dark:ring-primary-700/60'
          : 'bg-slate-50 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700'
      }`}
      data-filter-menu-section={String(section.id)}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={typeof section.label === 'string' ? section.label : String(section.id)}
        className="flex w-full min-w-0 items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span
          className="min-w-0 shrink-0 text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400"
          data-filter-menu-section-label={String(section.id)}
        >
          {resolveSectionLabel(section)}
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={`min-w-0 truncate text-xs font-semibold ${
              isActive ? 'text-primary-700 dark:text-primary-300' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            {isCustomRender ? (summary ?? (typeof section.label === 'string' ? section.label : 'Options')) : summary}
          </span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open ? (
        <div className="border-t border-slate-100 px-2.5 pb-2.5 pt-2 dark:border-slate-700/60">
          {section.description ? (
            <p className="mb-1.5 text-[11px] leading-snug text-gray-500 dark:text-gray-400">{section.description}</p>
          ) : null}
          {isCustomRender ? section.render!({ closeMenu }) : <SectionOptionList options={options} searchable={!!section.searchable} />}
        </div>
      ) : null}
    </div>
  )
}

// Panel body -- owns which section is expanded (one at a time; the section
// with active picks starts open so a returning user lands where their
// filters already are, the first section otherwise).
function FilterMenuPanel({
  label,
  sections,
  onClear,
  closeMenu,
}: {
  label: string
  sections: FilterSection[]
  onClear: (() => void) | null
  closeMenu: CloseMenu
}) {
  const [openSectionId, setOpenSectionId] = useState<string | number | null>(() => {
    const activeSection = sections.find((section) => (
      typeof section.render === 'function'
        ? !!section.active
        : summarizeOptions((section.options || []).filter(Boolean) as FilterOption[]) !== 'All'
    ))
    return (activeSection ?? sections[0])?.id ?? null
  })
  return (
    <div className="max-h-[min(32rem,70vh)] overflow-auto rounded-[1.35rem] p-2.5">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-gray-900 dark:text-white">{label}</div>
        <div className="flex items-center gap-2">
          {typeof onClear === 'function' ? (
            <button
              type="button"
              className="text-xs font-medium text-primary-700 hover:text-primary-800 dark:text-primary-300 dark:hover:text-primary-200"
              onClick={() => {
                onClear()
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

      <div className="space-y-1.5">
        {sections.map((section) => (
          <FilterMenuSectionRow
            key={section.id}
            section={section}
            closeMenu={closeMenu}
            open={openSectionId === section.id}
            onToggle={() => setOpenSectionId((current) => (current === section.id ? null : section.id))}
          />
        ))}
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

  // Active picks show only INSIDE the menu now -- each section's collapsed row
  // carries its own summary ("2 selected", a date range, "OR", etc.) and the
  // trigger shows the total count. The active picks used to ALSO render as
  // removable chips outside the trigger, in the toolbar row next to the search
  // box; that was removed (user, Aug 31 2026) so the row stays just Search +
  // the Filters button and nothing spills out beside it.
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
        <FilterMenuPanel
          label={label}
          sections={sections.filter(Boolean) as FilterSection[]}
          onClear={hasActions ? onClear : null}
          closeMenu={closeMenu}
        />
      )}
    />
  )
}
