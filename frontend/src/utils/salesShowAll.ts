// "Show all" on the Sales page (S4R6-2#422, "today Show-all with bounded cursor"): every sale of ONE business day, read in
// bounded pages. Everything here is pure so tests/salesShowAll.test.ts runs the same decisions Sales.tsx makes.
//
// D1 budget (the account is moving to the Free plan: 5M rows read per day for everything):
//   - Off by default. It is an explicit, remembered per-viewer toggle; with it off the list is the ordinary 20-row page.
//   - Eligible for a single business day only. A wider range keeps ordinary pages and says so in visible text.
//   - A full walk (at most SHOW_ALL_MAX_PAGES requests of SHOW_ALL_PAGE_SIZE) runs once per query: a new filter, date, sort,
//     viewer, the toggle itself, or the explicit Retry/Refresh. Never once per sync event.
//   - Any other load of the same query (a sync event, a write conflict, coming back to the page) is a refresh. It is exact
//     or it does not happen: when the list held is complete and shorter than one page, it reads ONE page, and that page is
//     short exactly when it is the whole list, so it replaces the list (rows that left the filter go, order follows the
//     active sort). When the list held is a page or longer -- or incomplete -- a refresh cannot be exact without another
//     walk, so it reads nothing and the page says the list may be out of date, with a Refresh.
// Nothing is merged: a published list is always one query's own walk, so rows from an earlier query can never appear in it.
export const SHOW_ALL_PAGE_SIZE = 100
export const SHOW_ALL_MAX_PAGES = 10
export const SHOW_ALL_MAX_ROWS = SHOW_ALL_PAGE_SIZE * SHOW_ALL_MAX_PAGES

/** One business day: the only range Show all reads in full. */
export function showAllEligible(range: { startDate?: string; endDate?: string }): boolean {
  const start = String(range?.startDate || '').trim()
  const end = String(range?.endDate || '').trim()
  return Boolean(start) && start === end
}

/** What the last published Show-all list was: which query, how many rows, and whether it is the whole list. */
export interface ShowAllSnapshot {
  key: string
  rows: number
  complete: boolean
}

/**
 * page  -- the ordinary paged request (Show all off or not eligible).
 * walk  -- the full bounded walk: a new query, or an explicit Retry/Refresh.
 * probe -- one page of SHOW_ALL_PAGE_SIZE; replaces the list only if it turns out to be the whole list.
 * skip  -- no request; the list held cannot be refreshed exactly without a walk.
 */
export type SalesLoadPlan = 'page' | 'walk' | 'probe' | 'skip'

export function planSalesLoad(input: { showAll: boolean; explicit: boolean; key: string; last: ShowAllSnapshot | null }): SalesLoadPlan {
  if (!input.showAll) return 'page'
  if (input.explicit || !input.last || input.last.key !== input.key) return 'walk'
  return input.last.complete && input.last.rows < SHOW_ALL_PAGE_SIZE ? 'probe' : 'skip'
}

export interface WalkResult<T> {
  rows: T[]
  pages: number
  /** The rows are the whole list: the last page read was short. */
  complete: boolean
  /** The walk stopped at the page bound with more rows still to read. */
  truncated: boolean
  /** A page after the first failed; `rows` holds what loaded before it. */
  error: unknown
}

/**
 * Reads pages 1..maxPages until a short page. Returns null when cancelled (the caller publishes nothing). A failing first
 * page rejects -- there is nothing to keep -- while a later failure resolves with the rows already read and `error` set.
 * `onPage` sees the rows so far after every page, so the list can paint before the walk ends.
 */
export async function walkSalesPages<T extends { id?: unknown }>(
  fetchPage: (page: number, limit: number) => Promise<T[]>,
  options: { pageSize?: number; maxPages?: number; isCancelled?: () => boolean; onPage?: (rows: T[]) => void } = {},
): Promise<WalkResult<T> | null> {
  const pageSize = Math.max(1, Math.floor(options.pageSize ?? SHOW_ALL_PAGE_SIZE))
  const maxPages = Math.max(1, Math.floor(options.maxPages ?? SHOW_ALL_MAX_PAGES))
  const seen = new Set<string>()
  const rows: T[] = []
  let pages = 0
  while (pages < maxPages) {
    if (options.isCancelled?.()) return null
    let batch: T[]
    try {
      batch = await fetchPage(pages + 1, pageSize)
    } catch (error) {
      if (options.isCancelled?.()) return null
      if (pages === 0) throw error
      return { rows, pages, complete: false, truncated: false, error }
    }
    if (options.isCancelled?.()) return null
    pages += 1
    // Offset paging can repeat a row when a sale lands between two pages; keep the first.
    for (const row of batch) {
      const key = row?.id === undefined || row?.id === null ? '' : String(row.id)
      if (key) {
        if (seen.has(key)) continue
        seen.add(key)
      }
      rows.push(row)
    }
    if (batch.length < pageSize) return { rows, pages, complete: true, truncated: false, error: null }
    if (pages < maxPages) options.onPage?.(rows.slice())
  }
  return { rows, pages, complete: false, truncated: true, error: null }
}

/** The note under the pager. `single_day`: Show all is on but the range is wider than a day. */
export type ShowAllNote = 'single_day' | 'truncated' | 'partial' | 'stale'

const PREF_PREFIX = 'sales:show-all:'

/** localStorage, or null where reading the property itself throws (blocked storage). */
export function browserStorage(): Storage | null {
  try { return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage } catch { return null }
}

/** The viewer's remembered choice. Off unless this viewer turned it on. */
export function readShowAllPreference(storage: Pick<Storage, 'getItem'> | null | undefined, viewerId: unknown): boolean {
  if (viewerId === undefined || viewerId === null || viewerId === '') return false
  try { return storage?.getItem(`${PREF_PREFIX}${String(viewerId)}`) === '1' } catch { return false }
}

export function writeShowAllPreference(storage: Pick<Storage, 'setItem' | 'removeItem'> | null | undefined, viewerId: unknown, on: boolean): void {
  if (viewerId === undefined || viewerId === null || viewerId === '') return
  try {
    if (on) storage?.setItem(`${PREF_PREFIX}${String(viewerId)}`, '1')
    else storage?.removeItem(`${PREF_PREFIX}${String(viewerId)}`)
  } catch { /* a blocked store keeps the choice for this visit only */ }
}
