// The pure arithmetic behind every pager in the app (shared/PaginationControls
// in all four of its layouts, and the storefront wrapper in
// catalog/catalogPagination.tsx).
//
// It was inline in the component, which is why the storefront could grow a
// SECOND, divergent rule for the same question: CatalogProductsSection gated
// both of its pager mounts on `totalProducts > effectivePageSize`, so a
// single-page result rendered no pager -- and the per-page chooser lives
// INSIDE the pager pill, with the storefront's page size held in component
// state rather than in the URL. A shopper on 100/page who narrowed the list
// to 12 products therefore lost the only control that could put it back, with
// no way to reach it short of reloading the site.
//
// Whether a pager is worth rendering and whether its arrows are dead are two
// different questions, and only the second one is about page COUNT. This
// module answers both, once.

export type PagerNumericInput = number | string | null | undefined

export interface PagerState {
  /** Total items, floored at 0. */
  total: number
  /** The page size actually in force (the fallback when the input is junk). */
  pageSize: number
  /** At least 1, even with nothing to show. */
  totalPages: number
  /** The requested page clamped into 1..totalPages. */
  page: number
  /** 1-based index of the first item on `page`; 0 when there are none. */
  start: number
  /** 1-based index of the last item on `page`. */
  end: number
  backDisabled: boolean
  nextDisabled: boolean
  /** Whether the pager should render at all.
   *
   * Deliberately "there is something to page", NOT "there is more than one
   * page": the pill also carries the per-page chooser, so hiding it on a
   * single page takes away the control that changes how many items a page
   * holds. On one page both arrows are simply disabled, which is what a pager
   * at the end of a list already looks like. */
  visible: boolean
}

function toPositiveInt(value: PagerNumericInput, fallback: number): number {
  const parsed = Number(value || fallback)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function pagerState(
  page: PagerNumericInput,
  totalItems: PagerNumericInput,
  pageSize: PagerNumericInput,
  fallbackPageSize = 20,
): PagerState {
  const safeFallback = Number.isFinite(fallbackPageSize) && fallbackPageSize > 0 ? fallbackPageSize : 20
  const safePageSize = toPositiveInt(pageSize, safeFallback)
  const parsedTotal = Number(totalItems || 0)
  const total = Number.isFinite(parsedTotal) ? Math.max(0, parsedTotal) : 0
  const totalPages = Math.max(1, Math.ceil(total / safePageSize))
  const parsedPage = Number(page || 1)
  const requestedPage = Number.isFinite(parsedPage) ? parsedPage : 1
  const safePage = Math.max(1, Math.min(totalPages, requestedPage))
  return {
    total,
    pageSize: safePageSize,
    totalPages,
    page: safePage,
    start: total ? ((safePage - 1) * safePageSize) + 1 : 0,
    end: Math.min(total, safePage * safePageSize),
    backDisabled: safePage <= 1,
    nextDisabled: safePage >= totalPages,
    visible: total > 0,
  }
}

/** The clamped page number on its own -- the shape callers outside the pager
 * (list components deriving their own slice) already consume. */
export function clampPageNumber(
  page: PagerNumericInput,
  totalItems: PagerNumericInput,
  pageSize: PagerNumericInput,
  fallbackPageSize = 20,
): number {
  return pagerState(page, totalItems, pageSize, fallbackPageSize).page
}
