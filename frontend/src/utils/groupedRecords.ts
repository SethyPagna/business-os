import { compareInitialKeys, getInitialKey } from './initials.mjs'

type AnyRow = Record<string, any>
type SortDirection = 'asc' | 'desc' | string

interface TimeParts {
  date: Date | null
  year: number | ''
  month: number | ''
  day?: number
  yearLabel: string
  monthLabel: string
  monthKey: string
  dayKey: string
  dayLabel: string
}

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

function toDate(value: unknown): Date | null {
  if (!value) return null
  const raw = String(value).trim()
  if (!raw) return null
  const direct = new Date(raw)
  if (!Number.isNaN(direct.getTime())) return direct
  const isoLike = raw.replace(' ', 'T')
  const normalizedIso = /[+-]\d{2}$/i.test(isoLike)
    ? `${isoLike}:00`
    : /[+-]\d{4}$/i.test(isoLike)
      ? isoLike.replace(/([+-]\d{2})(\d{2})$/i, '$1:$2')
      : isoLike
  const parsedIso = new Date(normalizedIso)
  if (!Number.isNaN(parsedIso.getTime())) return parsedIso
  const needsUtcSuffix = !/[zZ]$|[+-]\d{2}:\d{2}$|[+-]\d{4}$|[+-]\d{2}$/.test(normalizedIso)
  const parsedUtc = new Date(needsUtcSuffix ? `${normalizedIso}Z` : normalizedIso)
  return Number.isNaN(parsedUtc.getTime()) ? null : parsedUtc
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

export function getTimeParts(value: unknown): TimeParts {
  const parsed = toDate(value)
  if (!parsed) {
    return {
      date: null,
      year: '',
      month: '',
      yearLabel: 'Unknown year',
      monthLabel: 'Unknown month',
      monthKey: 'unknown-month',
      dayKey: 'unknown-day',
      dayLabel: 'Unknown day',
    }
  }

  const year = parsed.getFullYear()
  const month = parsed.getMonth() + 1
  const day = parsed.getDate()

  return {
    date: parsed,
    year,
    month,
    day,
    yearLabel: String(year),
    monthLabel: parsed.toLocaleString(undefined, { month: 'long', year: 'numeric' }),
    monthKey: `${year}-${String(month).padStart(2, '0')}`,
    dayKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    dayLabel: parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
  }
}

export function matchesYearMonthFilters(value: unknown, { year = 'all', month = 'all' } = {}): boolean {
  const parts = getTimeParts(value)
  if (year !== 'all' && parts.yearLabel !== String(year)) return false
  if (month !== 'all' && String(parts.month || '') !== String(month)) return false
  return true
}

export function getAvailableYears<T extends AnyRow = AnyRow>(
  items: T[] = [],
  getDate: (item: T) => unknown = (item) => item?.created_at,
): string[] {
  const years = new Set<string>()
  for (const item of Array.isArray(items) ? items : []) {
    const parts = getTimeParts(getDate(item))
    if (parts.yearLabel && parts.yearLabel !== 'Unknown year') years.add(parts.yearLabel)
  }
  return [...years].sort((left, right) => Number(right) - Number(left))
}

export function getTimeGroupingMode(year: string | number = 'all', month: string | number = 'all'): 'year' | 'month' | 'day' {
  if (month !== 'all') return 'day'
  if (year !== 'all') return 'month'
  return 'year'
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

export function toggleIdSet(currentSet: Iterable<any> | null | undefined, ids: any[] = [], checked: boolean): Set<any> {
  const next = new Set(currentSet || [])
  for (const id of ids) {
    if (id === null || id === undefined) continue
    if (checked) next.add(id)
    else next.delete(id)
  }
  return next
}
