import { buildCategoryGroups, categoryGroupValues } from '../../utils/categoryGrouping'
import type { FilterOption } from './FilterMenu'

// Shared "Main - Sub" hierarchical rows for a FilterMenu Category section --
// used by Products, Inventory, POS, and the public portal so picking
// "Haircare" behaves identically everywhere: it selects every real
// "Haircare - X" category alongside it, not just the bare "Haircare" value.
//
// This stays state-shape-agnostic on purpose. Products/Inventory hold their
// category filter as a Set<string>, POS holds it as a comma-joined string
// (see utils/multiSelect.ts) -- rather than forcing one shape, each caller
// supplies `isSelected` (a value -> boolean check) and `onToggle` (apply a
// batch of values with a single checked/unchecked flag), both trivial to
// implement against whichever state shape that page already uses.
export interface BuildHierarchicalCategoryFilterOptionsParams {
  categoryNames: readonly string[]
  isSelected: (value: string) => boolean
  onToggle: (values: string[], checked: boolean) => void
}

export function buildHierarchicalCategoryFilterOptions({
  categoryNames,
  isSelected,
  onToggle,
}: BuildHierarchicalCategoryFilterOptionsParams): FilterOption[] {
  const groups = buildCategoryGroups(categoryNames)
  const rows: FilterOption[] = []

  for (const group of groups) {
    if (!group.children.length) {
      // No subcategories under this main label -- unchanged flat row,
      // same as before this feature existed.
      const value = group.ownValue ?? group.mainLabel
      const active = isSelected(value)
      rows.push({
        id: `cat-${value}`,
        label: group.mainLabel,
        title: group.mainLabel,
        active,
        onClick: () => onToggle([value], !active),
      })
      continue
    }

    const values = categoryGroupValues(group)
    // "Master checkbox" semantics: the parent row shows active as soon as
    // any member of the group is selected (so it's obvious at a glance
    // this group is in play even from a partial pick made via its own
    // child rows), and toggling it is an all-or-nothing action -- select
    // every member if none/some are currently selected, clear all of them
    // if the whole group is already selected.
    const groupActive = values.some((value) => isSelected(value))
    rows.push({
      id: `catgroup-${group.key}`,
      title: group.mainLabel,
      active: groupActive,
      onClick: () => onToggle(values, !groupActive),
      label: (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate font-bold">{group.mainLabel}</span>
          <span className="shrink-0 rounded-full bg-slate-200 px-1.5 py-px text-[9px] font-bold leading-4 text-slate-500 dark:bg-slate-700 dark:text-slate-300">
            {values.length}
          </span>
        </span>
      ),
    })

    for (const child of group.children) {
      const active = isSelected(child.value)
      rows.push({
        id: `cat-${child.value}`,
        title: child.value,
        active,
        onClick: () => onToggle([child.value], !active),
        label: (
          <span className="flex min-w-0 items-center gap-1 pl-3.5 text-slate-500 dark:text-slate-400">
            <span aria-hidden="true" className="shrink-0 text-slate-300 dark:text-slate-600">&#8627;</span>
            <span className="min-w-0 truncate">{child.label}</span>
          </span>
        ),
      })
    }
  }

  return rows
}
