import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import Search from 'lucide-react/dist/esm/icons/search.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import { buildCategoryGroups, categoryGroupValues, type CategoryGroup } from '../../utils/categoryGrouping'
import LazyPortalMenu from '../shared/LazyPortalMenu'

export type PortalComboboxOption = { value: string; label: string }

interface PortalFilterComboboxProps {
  label: string
  options: PortalComboboxOption[]
  selected: string[]
  onToggle: (value: string) => void
  onClear: () => void
  allLabel?: string
  searchPlaceholder?: string
  noMatchesLabel?: string
  // Optional: when supplied, `options` are clustered into "Main - Sub"
  // hierarchical groups (see utils/categoryGrouping.ts) and a group's
  // parent row selects/deselects every member at once via this callback,
  // same "group-select" behavior Products/Inventory/POS already have on
  // their own FilterMenu-based Category section. Omit for filters that
  // shouldn't be grouped (Brand, Branch) -- falls back to the flat list.
  onToggleGroup?: (values: string[], checked: boolean) => void
}

// Searchable multi-select combobox for the public portal's product filters
// (category/brand/branch). Previously these rendered every option as an
// always-visible toggle pill -- fine for a handful of values, but with a
// few dozen brands/categories that's a wall of buttons with no way to type
// to find one. This closed-by-default control shows "All" or a selection
// count, opens to a text-searchable checkbox list on click, and mirrors the
// selection back out as removable chips (press the x to deselect) -- same
// toggle-based multi-select state (`selected`/`onToggle`) the callers
// already had, just a different input surface on top of it.
export default function PortalFilterCombobox({
  label,
  options,
  selected,
  onToggle,
  onClear,
  allLabel = 'All',
  searchPlaceholder = 'Search...',
  noMatchesLabel = 'No matches',
  onToggleGroup,
}: PortalFilterComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (open) {
      const raf = requestAnimationFrame(() => inputRef.current?.focus())
      return () => cancelAnimationFrame(raf)
    }
    setQuery('')
    return undefined
  }, [open])

  const normalizedQuery = query.trim().toLowerCase()
  const filteredOptions = useMemo(() => (
    normalizedQuery
      ? options.filter((option) => option.label.toLowerCase().includes(normalizedQuery))
      : options
  ), [normalizedQuery, options])

  // Hierarchical "Main - Sub" grouping, only computed when onToggleGroup is
  // supplied (Category) -- Brand/Branch stay a flat list. When searching,
  // a group whose own main label matches the query is shown in full
  // (unfiltered children, so typing the parent name browses into it);
  // otherwise only its matching children are kept, and the group is
  // dropped entirely if nothing in it matches.
  const visibleGroups = useMemo(() => {
    if (!onToggleGroup) return null
    const groups = buildCategoryGroups(options.map((option) => option.value))
    if (!normalizedQuery) return groups
    return groups
      .map((group) => {
        if (group.mainLabel.toLowerCase().includes(normalizedQuery)) return group
        const matchingChildren = group.children.filter((child) => child.label.toLowerCase().includes(normalizedQuery))
        if (matchingChildren.length) return { ...group, children: matchingChildren }
        return null
      })
      .filter((group): group is CategoryGroup => group !== null)
  }, [onToggleGroup, options, normalizedQuery])

  const selectedLabelByValue = useMemo(() => {
    const map = new Map<string, string>()
    for (const option of options) map.set(option.value, option.label)
    return map
  }, [options])

  // Shared row renderer for the flat list, group-parent rows, and indented
  // child rows -- one checkbox-row look everywhere, same as FilterMenu's
  // SectionOptionList uses on Products/Inventory/POS.
  const renderOptionRow = (key: string, rowLabel: ReactNode, active: boolean, onClick: () => void, indent = false) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className={`mt-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium ${indent ? 'pl-6' : ''} ${
        active
          ? 'bg-blue-50 text-blue-700 dark:bg-amber-500/10 dark:text-amber-300'
          : 'text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
      }`}
      role="option"
      aria-selected={active}
    >
      <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${active ? 'border-blue-600 bg-blue-600 dark:border-amber-400 dark:bg-amber-400' : 'border-slate-300 dark:border-neutral-600'}`} aria-hidden="true">
        {active ? <span className="h-1.5 w-1.5 rounded-sm bg-white" /> : null}
      </span>
      <span className="min-w-0 truncate">{rowLabel}</span>
    </button>
  )

  return (
    <div className="min-w-0">
      <LazyPortalMenu
        align="auto"
        triggerWrapperClassName="w-full min-w-0"
        menuClassName="w-60 max-w-[calc(100vw-1rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
        onOpenChange={setOpen}
        trigger={(
          <button
            type="button"
            className={`flex min-h-8 w-full min-w-[7rem] items-center justify-between gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition sm:w-auto ${
              selected.length
                ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300'
                : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:border-amber-500/40 dark:hover:text-amber-300'
            }`}
            aria-label={`${label}: ${selected.length ? `${selected.length} selected` : allLabel}`}
          >
            <span className="truncate">
              {label}: {selected.length ? `${selected.length} selected` : allLabel}
            </span>
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
        content={({ closeMenu }) => (
          <div role="dialog" aria-label={label} className="overflow-hidden">
          <label className="relative block border-b border-slate-100 p-2 dark:border-neutral-800">
            <Search className="pointer-events-none absolute left-4.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-7 pr-2 text-xs text-slate-700 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:focus:border-amber-500/50 dark:focus:ring-amber-500/15"
            />
          </label>
          <div className="max-h-56 overflow-y-auto p-1.5" role="listbox">
            <button
              type="button"
              onClick={() => { onClear(); closeMenu() }}
              className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold ${
                !selected.length
                  ? 'bg-slate-950 text-white dark:bg-white dark:text-neutral-950'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
              }`}
            >
              {allLabel}
            </button>
            {visibleGroups ? (
              visibleGroups.length ? visibleGroups.map((group) => {
                if (!group.children.length) {
                  const value = group.ownValue ?? group.mainLabel
                  const active = selected.includes(value)
                  return renderOptionRow(value, group.mainLabel, active, () => onToggle(value))
                }
                const values = categoryGroupValues(group)
                const groupActive = values.some((value) => selected.includes(value))
                return (
                  <div key={group.key}>
                    {renderOptionRow(
                      `catgroup-${group.key}`,
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="min-w-0 truncate font-bold">{group.mainLabel}</span>
                        <span className="shrink-0 rounded-full bg-slate-200 px-1.5 py-px text-[9px] font-bold leading-4 text-slate-500 dark:bg-neutral-700 dark:text-neutral-300">
                          {values.length}
                        </span>
                      </span>,
                      groupActive,
                      () => onToggleGroup?.(values, !groupActive),
                    )}
                    {group.children.map((child) => {
                      const active = selected.includes(child.value)
                      return renderOptionRow(child.value, child.label, active, () => onToggle(child.value), true)
                    })}
                  </div>
                )
              }) : (
                <div className="px-2.5 py-3 text-center text-[11px] text-slate-400">{noMatchesLabel}</div>
              )
            ) : (
              filteredOptions.length ? filteredOptions.map((option) => (
                renderOptionRow(option.value, option.label, selected.includes(option.value), () => onToggle(option.value))
              )) : (
                <div className="px-2.5 py-3 text-center text-[11px] text-slate-400">{noMatchesLabel}</div>
              )
            )}
          </div>
          </div>
        )}
      />

      {selected.length ? (
        <div className="mt-1.5 flex min-w-0 flex-wrap gap-1">
          {selected.map((value) => (
            <span key={value} className="inline-flex max-w-full items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-neutral-800 dark:text-neutral-300">
              <span className="truncate">{selectedLabelByValue.get(value) || value}</span>
              <button
                type="button"
                onClick={() => onToggle(value)}
                className="shrink-0 text-slate-400 transition hover:text-slate-700 dark:hover:text-neutral-100"
                aria-label={`Remove ${selectedLabelByValue.get(value) || value}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
