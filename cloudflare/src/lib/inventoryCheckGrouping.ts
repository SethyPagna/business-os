// Grouped Inventory Check list: one definition of "last checked", the family aggregate rule, the group keys and the response block.
//
// "Last checked" of a product row in a branch scope is MAX(updated_at) over its done/issue items inside the viewer's organization, where the item's branch is its session's branch (and
// the chosen branch, when one is chosen). That is the updated_at of the item the list's other readers pick as the latest one (ORDER BY updated_at DESC, session_id DESC LIMIT 1), so the order
// here can never disagree with the check_at a row shows.
//
// The unit is the family, because the pager's unit is the family: a family's date is the MAX over the rows the page shows, "never" when none was checked. A family is never split across
// groups. Group totals are computed in the same statement that ranks the families (FamilyPaginationOptions.familyGroupSql), so they never depend on the page.
import type { FamilyGroupTotals } from './familyPagination'
import { localDateOf } from './businessDateWindow'

export const INVENTORY_CHECK_GROUPINGS = ['checked', 'category'] as const
export type InventoryCheckGrouping = typeof INVENTORY_CHECK_GROUPINGS[number]

export const isInventoryCheckGrouping = (value: unknown): value is InventoryCheckGrouping => typeof value === 'string' && (INVENTORY_CHECK_GROUPINGS as readonly string[]).includes(value)

/** The groupings a viewer may ask for: category needs the category field. */
export const availableGroupings = (fields: { category: boolean }): InventoryCheckGrouping[] => (fields.category ? ['checked', 'category'] : ['checked'])

/**
 * The newest done/issue check date of one product row, as a scalar subquery over `productId` (a SQL expression such as `c.id`). Reads @checkOrg, and @branchId when branchScoped.
 * Two texts instead of `@branchId IS NULL OR ...`: the CROSS JOIN fixes the join order (items, then the session by primary key) and INDEXED BY fixes the index
 * (product_id, branch_id, updated_at), because production keeps no statistics and a free planner could start from the sessions and probe items once per session.
 */
export function lastCheckedSql(productId: string, branchScoped: boolean): string {
  return `(SELECT MAX(i.updated_at) FROM inventory_check_items i INDEXED BY inventory_check_items_product_latest
    CROSS JOIN inventory_check_sessions s ON s.id=i.session_id
    WHERE i.product_id=${productId}${branchScoped ? ' AND i.branch_id=@branchId' : ''} AND i.state IN ('done','issue')
      AND s.organization_id IS @checkOrg AND s.branch_id=i.branch_id)`
}

/** The business-day shift of every group key (UTC+7, the same day businessDateWindow's localDateOf names). */
export const BUSINESS_DAY_SHIFT = '+7 hours'

const CATEGORY_KEY_SQL = "NULLIF(lower(trim(COALESCE(c.category,''))),'')"

/** What the paginator needs for a grouping: the per-row sort expression, the group key over the `families` columns, and the order, spelled for the ranking and for the page wrapper. */
export function groupingPlan(by: InventoryCheckGrouping, branchScoped: boolean) {
  if (by === 'checked') {
    return {
      familyNumericSortSql: 'c.__last_check', familySortValueSql: undefined as string | undefined,
      productMetricsSql: `SELECT c.*,${lastCheckedSql('c.id', branchScoped)} AS __last_check FROM cohort c`,
      familyGroupSql: { keySql: `CASE WHEN family_num_sort IS NULL THEN 'never' ELSE 'd:'||date(family_num_sort,'${BUSINESS_DAY_SHIFT}') END` },
      familyOrder: (name: string, numeric: string) => `(${numeric} IS NULL) ASC,${numeric} DESC,${name} ASC`,
      rankingOrder: '(family_num_sort IS NULL) ASC,family_num_sort DESC,family_name ASC',
      pageOrder: (name: string, numeric: string) => `(${numeric} IS NULL) ASC,${numeric} DESC,${name} ASC`,
    }
  }
  return {
    familyNumericSortSql: undefined as string | undefined, familySortValueSql: CATEGORY_KEY_SQL,
    productMetricsSql: 'SELECT * FROM cohort',
    familyGroupSql: { keySql: "CASE WHEN family_sort_value IS NULL THEN 'none' ELSE 'c:'||family_sort_value END" },
    familyOrder: (name: string, sort: string) => `(${sort} IS NULL) ASC,${sort} ASC,${name} ASC`,
    rankingOrder: '(family_sort_value IS NULL) ASC,family_sort_value ASC,family_name ASC',
    pageOrder: (name: string, sort: string) => `(${sort} IS NULL) ASC,${sort} ASC,${name} ASC`,
  }
}

export type GroupingBlock = {
  by: InventoryCheckGrouping
  unit: 'family'
  groups: Array<{ key: string; label: string | null; families: number; products: number; continued_before: boolean; continues_after: boolean }>
}

/** SQLite's lower() folds ASCII only and trim() strips spaces only; the category key is built with exactly those two. */
export const categoryKeyOf = (raw: unknown): string | null => {
  const text = String(raw ?? '').replace(/^ +| +$/g, '').replace(/[A-Z]/g, (letter) => letter.toLowerCase())
  return text === '' ? null : text
}

/** The group key of a family whose newest check date is `at` (null: never checked). */
export const checkedGroupKeyOf = (at: string | null): string => {
  if (at === null) return 'never'
  return `d:${localDateOf(at)}`
}

/**
 * The response block of a page. `groups` are the paginator's whole-scope totals for the groups present on the page, in page order; `offset` and `pageSize` give the continuation flags.
 * A category group's label is the trimmed category of the first row on the page that has the group's key; a date group and the two tail groups carry no label (the client formats them).
 */
export function buildGroupingBlock(by: InventoryCheckGrouping, groups: readonly FamilyGroupTotals[], rows: ReadonlyArray<Record<string, unknown>>, offset: number, pageSize: number): GroupingBlock {
  return {
    by, unit: 'family',
    groups: groups.map((group) => {
      let label: string | null = null
      if (by === 'category' && group.key !== 'none') {
        const row = rows.find((candidate) => candidate.group_key === group.key && candidate.checkable !== false)
        label = row && typeof row.category === 'string' ? row.category.replace(/^ +| +$/g, '') : null
      }
      return { key: group.key, label, families: group.families, products: group.products, continued_before: group.first < offset + 1, continues_after: group.last > offset + pageSize }
    }),
  }
}
