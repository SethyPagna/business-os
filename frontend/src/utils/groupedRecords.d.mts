export function getAlphabetInitialSection(value: unknown): string
export function getTimeParts(value: unknown): {
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
export function matchesYearMonthFilters(value: unknown, filters?: {
  year?: unknown
  month?: unknown
}): boolean
export function getAvailableYears<T extends Record<string, unknown> = Record<string, unknown>>(
  items?: T[],
  getDate?: (item: T) => unknown,
): string[]
export function getTimeGroupingMode(year?: unknown, month?: unknown): 'year' | 'month' | 'day'
export function buildTimeActionSections<T extends Record<string, unknown> = Record<string, unknown>>(items?: T[], options?: {
  getDate?: (item: T) => unknown
  getItemId?: (item: T) => unknown
  getActionKey?: (item: T) => unknown
  getActionLabel?: (item: T) => unknown
  year?: unknown
  month?: unknown
  timeMode?: unknown
  groupMode?: unknown
  sortDirection?: unknown
}): Array<{
  id: string
  label: string
  ids: unknown[]
  items: T[]
  groups: Array<{
    id: string
    actionKey: string
    label: string
    ids: unknown[]
    items: T[]
    sortTime?: number
    synthetic?: boolean
  }>
}>
export function buildAlphabetActionSections<T extends Record<string, unknown> = Record<string, unknown>>(items?: T[], options?: {
  getName?: (item: T) => unknown
  getItemId?: (item: T) => unknown
  sortDirection?: unknown
}): Array<{
  id: string
  label: string
  ids: unknown[]
  items: T[]
  groups: Array<{
    id: string
    actionKey: string
    label: string
    ids: unknown[]
    items: T[]
    synthetic?: boolean
  }>
}>
export function toggleIdSet(currentSet?: Iterable<unknown> | null, ids?: unknown[], checked?: boolean): Set<unknown>
