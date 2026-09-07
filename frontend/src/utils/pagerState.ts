// The pure arithmetic behind every pager in the app (shared/PaginationControls
// in all four of its layouts, and the storefront wrapper in
// catalog/catalogPagination.tsx).
//
// Whether there is anything to page and whether the arrows are dead are two
// different questions, and only the second one is about page COUNT. This
// module answers both, once. Whether a given pager should RENDER is a third
// question, and it belongs to the layout, not here.

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
  /** Whether there is anything to page at all.
   *
   * Deliberately "there is something to page", NOT "there is more than one
   * page", because the ADMIN pill (`compact rangeAsPageSize`) carries the
   * per-page chooser inside itself: hiding it on a single page takes away the
   * one control that changes how many rows a page holds. There, one page just
   * means two dead arrows, which is what the end of any list looks like.
   *
   * That is NOT the same question as "should this pager render", and the two
   * were the same fact here until Sep 6 2026. Rendering is now decided
   * per-layout, by each layout, in PaginationControls:
   *
   *   - the admin layouts render on a single page, for the reason above;
   *   - the storefront `centered` layout returns null on a single page because
   *     its navigation row contains no action when both arrows are disabled. */
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
