import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import Search from 'lucide-react/dist/esm/icons/search.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import { buildCategoryGroups, categoryGroupValues, type CategoryGroup } from '../../utils/categoryGrouping'
import LazyPortalMenu from '../shared/LazyPortalMenu'

export type PortalComboboxOption = { value: string; label: string }

interface PortalFilterComboboxProps {
  label: string
  // The storefront translator, so the names a screen reader reads out
  // (the trigger's selection count, the search field, each chip's remove
  // button) come from the language packs like every other string here --
  // they used to be hardcoded English inside this file.
  copy: (key: string, fallback?: string, fallbackKm?: string) => string
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

// One navigable row of the popup listbox. Every row is an option -- the
// "All" row and a category group's parent row included -- so the listbox
// contains nothing a reader has to skip over, and so arrow keys have a
// single flat sequence to walk.
type ComboRow = {
  key: string
  label: ReactNode
  active: boolean
  indent: boolean
  activate: () => void
}

type ComboSection =
  | { kind: 'row'; row: ComboRow }
  | { kind: 'group'; group: CategoryGroup; rows: ComboRow[] }

// Searchable multi-select combobox for the public portal's product filters
// (category/brand/branch). Previously these rendered every option as an
// always-visible toggle pill -- fine for a handful of values, but with a
// few dozen brands/categories that's a wall of buttons with no way to type
// to find one. This closed-by-default control shows "All" or a selection
// count, opens to a text-searchable checkbox list on click, and mirrors the
// selection back out as removable chips (press the x to deselect) -- same
// toggle-based multi-select state (`selected`/`onToggle`) the callers
// already had, just a different input surface on top of it.
//
// Accessibility (N45): the search field is the combobox, the row list is
// its listbox, and Up/Down/Home/End/Enter/Escape drive the selection
// without the pointer -- on the base tree the popup could only be operated
// by Tabbing through every row one at a time, and the rows themselves sat
// inside a role="listbox" that also contained non-option buttons and bare
// group <div>s, which makes the whole listbox invalid to a reader.
export default function PortalFilterCombobox({
  label,
  copy,
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
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  // useId() emits colons, which are legal in an id attribute but need
  // escaping in a selector; strip them so the ids stay simple to write and
  // to read back.
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, '')
  const listboxId = `${uid}-listbox`
  const searchId = `${uid}-search`
  const optionId = (index: number) => `${uid}-option-${index}`

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

  const selectionText = selected.length
    ? copy('portal_a11y_selected_count', '{count} selected', '{count} បានជ្រើស').replace('{count}', String(selected.length))
    : allLabel
  const searchLabel = `${label}: ${copy('portal_a11y_search_options', 'Search options', 'ស្វែងរកជម្រើស')}`

  // Every option row below the "All" row, in the order it is rendered, so
  // the arrow keys and aria-activedescendant share one index.
  const sections = useMemo<ComboSection[]>(() => {
    if (!visibleGroups) {
      return filteredOptions.map((option) => ({
        kind: 'row' as const,
        row: {
          key: option.value,
          label: option.label,
          active: selected.includes(option.value),
          indent: false,
          activate: () => onToggle(option.value),
        },
      }))
    }
    return visibleGroups.map((group) => {
      if (!group.children.length) {
        const value = group.ownValue ?? group.mainLabel
        return {
          kind: 'row' as const,
          row: {
            key: value,
            label: group.mainLabel,
            active: selected.includes(value),
            indent: false,
            activate: () => onToggle(value),
          },
        }
      }
      const values = categoryGroupValues(group)
      const groupActive = values.some((value) => selected.includes(value))
      const parent: ComboRow = {
        key: `catgroup-${group.key}`,
        label: (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate font-bold">{group.mainLabel}</span>
            <span className="shrink-0 rounded-full bg-slate-200 px-1.5 py-px text-[9px] font-bold leading-4 text-slate-500 dark:bg-neutral-700 dark:text-neutral-300">
              {values.length}
            </span>
          </span>
        ),
        active: groupActive,
        indent: false,
        activate: () => onToggleGroup?.(values, !groupActive),
      }
      const children = group.children.map((child) => ({
        key: child.value,
        label: child.label,
        active: selected.includes(child.value),
        indent: true,
        activate: () => onToggle(child.value),
      }))
      return { kind: 'group' as const, group, rows: [parent, ...children] }
    })
  }, [visibleGroups, filteredOptions, selected, onToggle, onToggleGroup])

  const optionRows = useMemo<ComboRow[]>(() => {
    const rows: ComboRow[] = []
    for (const section of sections) {
      if (section.kind === 'row') rows.push(section.row)
      else rows.push(...section.rows)
    }
    return rows
  }, [sections])

  // The "All" row is index 0 of the navigable sequence.
  const navigableCount = optionRows.length + 1

  useEffect(() => { setActiveIndex(0) }, [normalizedQuery, open])

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-combo-index="${activeIndex}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>, closeMenu: () => void, clearAll: () => void) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActiveIndex((previous) => (previous + 1) % navigableCount)
        return
      case 'ArrowUp':
        event.preventDefault()
        setActiveIndex((previous) => (previous - 1 + navigableCount) % navigableCount)
        return
      case 'Home':
        event.preventDefault()
        setActiveIndex(0)
        return
      case 'End':
        event.preventDefault()
        setActiveIndex(navigableCount - 1)
        return
      case 'Enter': {
        event.preventDefault()
        if (activeIndex === 0) { clearAll(); return }
        optionRows[activeIndex - 1]?.activate()
        return
      }
      case 'Escape':
        event.preventDefault()
        closeMenu()
        return
      default:
    }
  }

  // Shared row renderer for the flat list, group-parent rows, and indented
  // child rows -- one checkbox-row look everywhere, same as FilterMenu's
  // SectionOptionList uses on Products/Inventory/POS.
  const renderOptionRow = (row: ComboRow, index: number) => (
    <button
      key={row.key}
      type="button"
      id={optionId(index + 1)}
      data-combo-index={index + 1}
      onClick={row.activate}
      onMouseEnter={() => setActiveIndex(index + 1)}
      className={`mt-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium ${row.indent ? 'pl-6' : ''} ${
        row.active
          ? 'bg-blue-50 text-blue-700 dark:bg-amber-500/10 dark:text-amber-300'
          : 'text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
      } ${activeIndex === index + 1 ? 'ring-1 ring-blue-300 dark:ring-amber-400/60' : ''}`}
      role="option"
      aria-selected={row.active}
    >
      <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${row.active ? 'border-blue-600 bg-blue-600 dark:border-amber-400 dark:bg-amber-400' : 'border-slate-300 dark:border-neutral-600'}`} aria-hidden="true">
        {row.active ? <span className="h-1.5 w-1.5 rounded-sm bg-white" /> : null}
      </span>
      <span className="min-w-0 truncate">{row.label}</span>
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
          // PortalMenu clones this button and supplies aria-expanded /
          // aria-haspopup itself, so the trigger's open state is already
          // announced; only its NAME needed fixing.
          <button
            type="button"
            className={`flex min-h-8 w-full min-w-[7rem] items-center justify-between gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition sm:w-auto ${
              selected.length
                ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300'
                : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:border-amber-500/40 dark:hover:text-amber-300'
            }`}
            aria-label={`${label}: ${selectionText}`}
          >
            <span className="truncate">
              {label}: {selectionText}
            </span>
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
        )}
        content={({ closeMenu }) => {
          const clearAll = () => { onClear(); closeMenu() }
          return (
          <div role="dialog" aria-label={label} className="overflow-hidden">
          <div className="relative block border-b border-slate-100 p-2 dark:border-neutral-800">
            <label htmlFor={searchId} className="sr-only">{searchLabel}</label>
            <Search className="pointer-events-none absolute left-4.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" aria-hidden="true" />
            <input
              ref={inputRef}
              id={searchId}
              type="text"
              role="combobox"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-activedescendant={optionId(activeIndex)}
              aria-autocomplete="list"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => handleSearchKeyDown(event, closeMenu, clearAll)}
              placeholder={searchPlaceholder}
              // This popup is createPortal()ed to document.body by
              // shared/PortalMenu, so it is NOT a descendant of any portal
              // root and public-portal.css's :focus-visible ring can never
              // reach it. focus:ring-blue-100 is #dbeafe on white = 1.16:1,
              // i.e. no visible indicator at all on the one field a keyboard
              // shopper lands in first. The outline utilities below are the
              // same 3px sky-700 / amber-300 ring the stylesheet paints.
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-7 pr-2 text-xs text-slate-700 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-100 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#0369a1] dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:focus:border-amber-500/50 dark:focus:ring-amber-500/15 dark:focus-visible:outline-[#fcd34d]"
            />
          </div>
          <div ref={listRef} className="max-h-56 overflow-y-auto p-1.5" id={listboxId} role="listbox" aria-multiselectable="true" aria-label={label}>
            <button
              type="button"
              id={optionId(0)}
              data-combo-index={0}
              onClick={clearAll}
              onMouseEnter={() => setActiveIndex(0)}
              role="option"
              aria-selected={!selected.length}
              className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold ${
                !selected.length
                  ? 'bg-slate-950 text-white dark:bg-white dark:text-neutral-950'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
              } ${activeIndex === 0 ? 'ring-1 ring-blue-300 dark:ring-amber-400/60' : ''}`}
            >
              {allLabel}
            </button>
            {optionRows.length ? (() => {
              let cursor = 0
              return sections.map((section) => {
                if (section.kind === 'row') {
                  const rendered = renderOptionRow(section.row, cursor)
                  cursor += 1
                  return rendered
                }
                const start = cursor
                const { group, rows } = section
                cursor += rows.length
                return (
                  <div key={group.key} role="group" aria-label={group.mainLabel}>
                    {rows.map((row, offset) => renderOptionRow(row, start + offset))}
                  </div>
                )
              })
            })() : (
              <div className="px-2.5 py-3 text-center text-[11px] text-slate-500 dark:text-neutral-400">{noMatchesLabel}</div>
            )}
          </div>
          </div>
          )
        }}
      />

      {selected.length ? (
        <div className="mt-1.5 flex min-w-0 flex-wrap gap-1">
          {selected.map((value) => (
            <span key={value} className="inline-flex max-w-full items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-neutral-800 dark:text-neutral-300">
              <span className="truncate">{selectedLabelByValue.get(value) || value}</span>
              <button
                type="button"
                onClick={() => onToggle(value)}
                className="shrink-0 text-slate-600 transition hover:text-slate-900 dark:text-neutral-300 dark:hover:text-neutral-100"
                aria-label={copy('portal_a11y_remove_filter', 'Remove {name}', 'ដក {name} ចេញ').replace('{name}', selectedLabelByValue.get(value) || value)}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
