// "Show all" on the Sales page (S4R6-2#422): every sale the current filters match, read in bounded pages.
//
// The Worker caps one GET /api/sales at 200 rows and a Free-plan request has a small query budget, so "all" is never one
// request. This walks the same list endpoint page by page (the page size is one the endpoint already serves), stops at the
// first short or empty page, and refuses to walk without end: MAX_PAGES bounds the work, and a list that hits the bound
// is reported as truncated so the page can say so instead of pretending it is complete. Rows are de-duplicated by id
// because offset paging can repeat a row when a sale is recorded between two pages.
export const SHOW_ALL_PAGE_SIZE = 100
export const SHOW_ALL_MAX_PAGES = 100

export interface ShowAllResult<T> {
  rows: T[]
  pages: number
  truncated: boolean
}

export async function loadAllSalesPages<T extends { id?: unknown }>(
  fetchPage: (page: number, limit: number) => Promise<T[]>,
  options: { pageSize?: number; maxPages?: number; isCancelled?: () => boolean } = {},
): Promise<ShowAllResult<T>> {
  const pageSize = Math.max(1, Math.floor(options.pageSize ?? SHOW_ALL_PAGE_SIZE))
  const maxPages = Math.max(1, Math.floor(options.maxPages ?? SHOW_ALL_MAX_PAGES))
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
