import { compareInitialKeys, getInitialKey } from './initials.ts'
import { getTimeParts } from './recordFilters.ts'

export {
  getAvailableYears,
  getTimeGroupingMode,
  getTimeParts,
  matchesYearMonthFilters,
  toggleIdSet,
} from './recordFilters.ts'

type AnyRow = Record<string, any>
type SortDirection = 'asc' | 'desc' | string

interface TimeActionSection<T extends AnyRow> {
  id: string
  label: string
  sortTime: number
  ids: any[]
  items: T[]
  groups: Map<string, TimeActionGroup<T>>
}
interface TimeActionGroup<T extends AnyRow> {
  id: string
  actionKey: string
  label: string
  ids: any[]
  items: T[]
  sortTime: number
  synthetic?: boolean
}

function normalizeName(value: unknown): string {
  return String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ')
}

export function getAlphabetInitialSection(value: unknown): string {
  return getInitialKey(normalizeName(value))
}

function compareAlphabetLabels(left: unknown, right: unknown): number {
  return compareInitialKeys(left, right)
}

export function buildTimeActionSections<T extends AnyRow = AnyRow>(items: T[] = [], {
  getDate = (item: T) => item?.created_at,
  getItemId = (item: T) => item?.id,
  getActionKey = () => 'all',
  getActionLabel = () => 'All',
  year = 'all',
  month = 'all',
  timeMode = 'month',
  groupMode = 'time+action',
  sortDirection = 'desc',
}: {
  getDate?: (item: T) => unknown
  getItemId?: (item: T) => any
  getActionKey?: (item: T) => unknown
  getActionLabel?: (item: T) => unknown
  year?: string | number
  month?: string | number
  timeMode?: 'year' | 'month' | 'day' | string
  groupMode?: 'time' | 'time+action' | string
  sortDirection?: SortDirection
} = {}) {
  const sections = new Map<string, TimeActionSection<T>>()
  const itemMeta = new Map<T, { itemId: any, sortTime: number }>()
  const normalizedSortDirection = sortDirection === 'asc' ? 'asc' : 'desc'
  const compareItemsByTime = (left: T, right: T): number => {
    const leftMeta = itemMeta.get(left) || { itemId: undefined, sortTime: 0 }
    const rightMeta = itemMeta.get(right) || { itemId: undefined, sortTime: 0 }
    const leftTime = Number(leftMeta.sortTime || 0)
    const rightTime = Number(rightMeta.sortTime || 0)
    const timeDelta = normalizedSortDirection === 'asc'
      ? leftTime - rightTime
      : rightTime - leftTime
    if (timeDelta !== 0) return timeDelta
    const leftId = Number((leftMeta.itemId ?? getItemId(left)) || 0)
    const rightId = Number((rightMeta.itemId ?? getItemId(right)) || 0)
    return normalizedSortDirection === 'asc'
      ? leftId - rightId
      : rightId - leftId
  }
  const normalizedGroupMode = groupMode === 'time' ? 'time' : 'time+action'

  for (const item of Array.isArray(items) ? items : []) {
    const dateValue = getDate(item)
    const parts = getTimeParts(dateValue)
    if (year !== 'all' && parts.yearLabel !== String(year)) continue
    if (month !== 'all' && String(parts.month || '') !== String(month)) continue
    const itemId = getItemId(item)
    const itemSortTime = parts.date?.getTime?.() || 0
    if (item && typeof item === 'object') itemMeta.set(item, { itemId, sortTime: itemSortTime })
    const normalizedTimeMode = timeMode === 'day' ? 'day' : (timeMode === 'year' ? 'year' : 'month')
    const sectionId = normalizedTimeMode === 'year'
      ? parts.yearLabel
      : normalizedTimeMode === 'day'
        ? parts.dayKey
        : parts.monthKey
    const sectionLabel = normalizedTimeMode === 'year'
      ? parts.yearLabel
      : normalizedTimeMode === 'day'
        ? parts.dayLabel
        : parts.monthLabel
    const actionKey = String(getActionKey(item) || 'other')
    const actionLabel = String(getActionLabel(item) || actionKey)

    const currentSection = sections.get(sectionId) || {
      id: sectionId,
      label: sectionLabel,
      sortTime: itemSortTime,
      ids: [],
      items: [],
      groups: new Map<string, TimeActionGroup<T>>(),
    }

    currentSection.ids.push(itemId)
    currentSection.items.push(item)
    currentSection.sortTime = Math.max(currentSection.sortTime, itemSortTime)

    if (normalizedGroupMode === 'time+action') {
      const currentGroup = currentSection.groups.get(actionKey) || {
        id: `${sectionId}:${actionKey}`,
        actionKey,
        label: actionLabel,
        ids: [],
        items: [],
        sortTime: 0,
      }

      currentGroup.ids.push(itemId)
      currentGroup.items.push(item)
      currentGroup.sortTime = Math.max(currentGroup.sortTime, itemSortTime)
      currentSection.groups.set(actionKey, currentGroup)
    }
    sections.set(sectionId, currentSection)
  }

  return [...sections.values()]
    .sort((left, right) => normalizedSortDirection === 'asc'
      ? left.sortTime - right.sortTime
      : right.sortTime - left.sortTime)
    .map((section) => {
      const items = [...(section.items || [])].sort(compareItemsByTime)
      const groups = normalizedGroupMode === 'time+action'
        ? [...section.groups.values()]
          .map((group) => {
            const groupItems = [...group.items].sort(compareItemsByTime)
            return {
              ...group,
              items: groupItems,
              ids: groupItems.map((item) => getItemId(item)).filter((id) => id !== null && id !== undefined),
            }
          })
          .sort((left, right) => {
            if (left.sortTime !== right.sortTime) {
              return normalizedSortDirection === 'asc'
                ? left.sortTime - right.sortTime
                : right.sortTime - left.sortTime
            }
            return left.label.localeCompare(right.label)
          })
        : [{
          id: `${section.id}:all`,
          actionKey: 'all',
          label: section.label,
          ids: items.map((item) => getItemId(item)).filter((id) => id !== null && id !== undefined),
          items,
          sortTime: section.sortTime,
          synthetic: true,
        }]
      return {
        id: section.id,
        label: section.label,
        ids: items.map((item) => getItemId(item)).filter((id) => id !== null && id !== undefined),
        items,
        groups,
      }
    })
}
export function buildAlphabetActionSections<T extends AnyRow = AnyRow>(items: T[] = [], {
  getName = (item: T) => item?.name,
  getItemId = (item: T) => item?.id,
  sortDirection = 'asc',
}: {
  getName?: (item: T) => unknown
  getItemId?: (item: T) => any
  sortDirection?: SortDirection
} = {}) {
  const normalizedSortDirection = sortDirection === 'desc' ? 'desc' : 'asc'
  const sections = new Map<string, {
    id: string
    label: string
    ids: any[]
    items: T[]
    groups: Map<string, never>
  }>()
  for (const item of Array.isArray(items) ? items : []) {
    const label = getAlphabetInitialSection(getName(item))
    const current = sections.get(label) || {
      id: `alpha:${label}`,
      label,
      ids: [],
      items: [],
      groups: new Map<string, never>(),
    }
    current.ids.push(getItemId(item))
    current.items.push(item)
    sections.set(label, current)
  }

  const compareItems = (left: T, right: T): number => {
    const nameDelta = normalizeName(getName(left)).localeCompare(normalizeName(getName(right)), undefined, { sensitivity: 'base' })
    if (nameDelta !== 0) return normalizedSortDirection === 'asc' ? nameDelta : -nameDelta
    const leftId = Number(getItemId(left) || 0)
    const rightId = Number(getItemId(right) || 0)
    return leftId - rightId
  }

  return [...sections.values()]
    .sort((left, right) => compareAlphabetLabels(left.label, right.label))
    .map((section) => {
      const sortedItems = [...section.items].sort(compareItems)
      return {
        ...section,
        ids: sortedItems.map((item) => getItemId(item)).filter((id) => id !== null && id !== undefined),
        items: sortedItems,
        groups: [{
          id: `${section.id}:all`,
          actionKey: 'all',
          label: section.label,
          ids: sortedItems.map((item) => getItemId(item)).filter((id) => id !== null && id !== undefined),
          items: sortedItems,
          synthetic: true,
        }],
      }
    })
}
