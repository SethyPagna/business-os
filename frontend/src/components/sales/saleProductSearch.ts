export const SALE_DETAIL_PRODUCT_PAGE_SIZE = 8

export type SaleProductSearchPage<T> = {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * Keep the sale editor compatible with both the live paginated response and
 * the offline mirror's legacy array response. The live response counts
 * product families, while `items` may include sibling variants expanded by
 * the search route.
 */
export function normalizeSaleProductSearchPage<T>(
  payload: unknown,
  requestedPage: number,
  fallbackPageSize = SALE_DETAIL_PRODUCT_PAGE_SIZE,
): SaleProductSearchPage<T> {
  if (Array.isArray(payload)) {
    return {
      items: payload as T[],
      page: 1,
      pageSize: Math.max(1, payload.length || fallbackPageSize),
      total: payload.length,
      totalPages: 1,
    }
  }

  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const items = Array.isArray(record.items) ? record.items as T[] : []
  const pageSize = positiveInteger(record.pageSize, fallbackPageSize)
  const total = Math.max(0, Math.floor(Number(record.total)) || 0)
  const totalPages = positiveInteger(record.totalPages, Math.max(1, Math.ceil(total / pageSize)))
  return {
    items,
    page: Math.min(totalPages, positiveInteger(record.page, requestedPage)),
    pageSize,
    total,
    totalPages,
  }
}

/** Append later pages without duplicating expanded siblings at page edges. */
export function mergeSaleProductSearchCandidates<T extends { id?: unknown }>(current: T[], incoming: T[]): T[] {
  const merged = [...current]
  const seen = new Set(current.map((row) => String(row?.id ?? '')).filter(Boolean))
  for (const row of incoming) {
    const key = String(row?.id ?? '')
    if (key && seen.has(key)) continue
    if (key) seen.add(key)
    merged.push(row)
  }
  return merged
}

export function saleProductSearchHasMore(page: Pick<SaleProductSearchPage<unknown>, 'page' | 'totalPages'>): boolean {
  return page.page < page.totalPages
}
