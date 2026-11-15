/** The list's groupings (design: grouped Inventory Check list). The client asks for one only when the answer advertised `capabilities.groupings`. */
export type GroupBy = 'checked' | 'category'
/** What the Group by choice holds: '' is the default (last checked date), 'none' the ungrouped name order. */
export type GroupChoice = '' | GroupBy | 'none'
export type GroupSummary = { key: string; label: string | null; families: number; products: number; continued_before: boolean; continues_after: boolean }
export type Grouping = { by: GroupBy; unit: 'family'; groups: GroupSummary[] }

/** One id per group, across page changes: the group keys repeat between a date grouping and a category grouping. */
export const collapseId = (by: GroupBy, key: string): string => `${by}:${key}`

/** The grouping to send with every list read outside a count session, from the first request: the choice, defaulting to the last checked date. Category only while the last answer offered it (or none has answered yet). Null: the person chose the name order. */
export function groupToAsk(choice: GroupChoice | undefined, offered: readonly string[] | null | undefined): GroupBy | null {
  if (choice === 'none') return null
  if (choice === 'category' && (!offered?.length || offered.includes('category'))) return 'category'
  return 'checked'
}

/** The rows of the groups that are open: what the page-wide "matches stock" acts on. */
export function inOpenGroups<T extends { group_key?: string }>(products: readonly T[], grouping: Grouping | undefined, collapsed: ReadonlySet<string>): T[] {
  if (!grouping || !collapsed.size) return [...products]
  return products.filter(product => !collapsed.has(collapseId(grouping.by, String(product.group_key ?? ''))))
}

/** The same read, asking for a grouping: the grouping defines the order, so the sort is not sent (the server refuses both). */
export function groupedParams<T extends Record<string, unknown>>(params: T, by: GroupBy): Omit<T, 'sortBy' | 'sortDirection'> & { groupBy: GroupBy } {
  const { sortBy: _sortBy, sortDirection: _sortDirection, ...rest } = params
  return { ...rest, groupBy: by }
}

export const sameGroupings = (a: readonly string[] | null | undefined, b: readonly string[] | null | undefined): boolean => (a?.join(',') ?? '') === (b?.join(',') ?? '')

/** A row with a count typed but not submitted: a soft see-through blue, softer than a selected row's ring and tint, in both themes. It clears when the count is saved (the draft is gone). */
export const UNSAVED_ROW_CLASS = 'bg-sky-500/10 dark:bg-sky-400/10'
