// "Show all" on the Sales page (S4R6-2#422): every sale in the CURRENT date filter -- by default today's business day --
// read in bounded pages.
//
// Free-plan budget: one GET /api/sales reads its rows plus their items, refunds and records, so "all" must stay small.
//   - Eligible only for a single business day, or for a wider range whose matching count is at most SHOW_ALL_MAX_ROWS.
//     Anything bigger keeps ordinary pages and the page shows the narrow-the-filters note.
//   - The walk is bounded by SHOW_ALL_MAX_PAGES (SHOW_ALL_MAX_ROWS / page size) even for one very busy day.
//   - A background refresh reads the FIRST page only and merges it into the rows already held; the full walk happens
//     on load, filter change and the explicit Refresh.
// Rows are de-duplicated by id because offset paging can repeat a row when a sale is recorded between two pages.
export const SHOW_ALL_PAGE_SIZE = 100
export const SHOW_ALL_MAX_ROWS = 1000
export const SHOW_ALL_MAX_PAGES = SHOW_ALL_MAX_ROWS / SHOW_ALL_PAGE_SIZE

export interface ShowAllResult<T> {
  rows: T[]
  pages: number
  /** True when the walk hit the page bound with more rows still to read. Null for a first-page-only refresh (unknown). */
  truncated: boolean | null
}

/** Whether Show all may run for this filter: one business day, or a known count within the cap. */
export function showAllEligible(range: { startDate?: string; endDate?: string }, totalCount: number | null | undefined): boolean {
  const start = String(range.startDate || '').trim()
  const end = String(range.endDate || '').trim()
  if (start && end && start === end) return true
  return typeof totalCount === 'number' && Number.isFinite(totalCount) && totalCount <= SHOW_ALL_MAX_ROWS
}

/** Fold a refreshed first page into the rows already held: same id replaces, new ids are added, the rest stay. */
export function mergeFirstPage<T extends { id?: unknown }>(existing: readonly T[], firstPage: readonly T[]): T[] {
  const fresh = new Map<string, T>()
  const added: T[] = []
  for (const row of firstPage) {
    const key = row?.id === undefined || row?.id === null ? '' : String(row.id)
    if (key) fresh.set(key, row); else added.push(row)
  }
  const used = new Set<string>()
  const merged = existing.map((row) => {
    const key = row?.id === undefined || row?.id === null ? '' : String(row.id)
    if (key && fresh.has(key)) { used.add(key); return fresh.get(key) as T }
    return row
  })
  const created = [...fresh.entries()].filter(([key]) => !used.has(key)).map(([, row]) => row)
  return [...created, ...merged, ...added]
}

export async function loadAllSalesPages<T extends { id?: unknown }>(
  fetchPage: (page: number, limit: number) => Promise<T[]>,
  options: { pageSize?: number; maxPages?: number; isCancelled?: () => boolean; refreshOnly?: { existing: readonly T[] } } = {},
): Promise<ShowAllResult<T>> {
  const pageSize = Math.max(1, Math.floor(options.pageSize ?? SHOW_ALL_PAGE_SIZE))
  const maxPages = Math.max(1, Math.floor(options.maxPages ?? SHOW_ALL_MAX_PAGES))
  if (options.refreshOnly) {
    // Background refresh: at most one request, merged into what is already shown.
    const first = await fetchPage(1, pageSize)
    return { rows: mergeFirstPage(options.refreshOnly.existing, first), pages: 1, truncated: null }
  }
  const seen = new Set<string>()
  const rows: T[] = []
  let pages = 0
  while (pages < maxPages) {
    if (options.isCancelled?.()) return { rows, pages, truncated: false }
    const batch = await fetchPage(pages + 1, pageSize)
    pages += 1
    for (const row of batch) {
      const key = row?.id === undefined || row?.id === null ? '' : String(row.id)
      if (key) {
        if (seen.has(key)) continue
        seen.add(key)
      }
      rows.push(row)
    }
    if (batch.length < pageSize) return { rows, pages, truncated: false }
  }
  return { rows, pages, truncated: true }
}
