import PaginationControls from '../shared/PaginationControls'

// The page size a shopper gets before they choose one, and the sizes they may
// choose instead.
//
// 2026-09-14, owner: the storefront pager carries a page-size selector again,
// placed BEFORE Back so the row reads [20/50/100] [Back] [page / total]
// [Next]. That deliberately reverses the 2026-09-07 removal of the
// shopper-facing control. The default below is unchanged and still matches the
// page the Worker cuts for a request that omits pageSize (routes/portal.ts),
// so a first visit renders the same page it always did; 100 is also the
// server's hard cap, so no option here can ask for a page it will not serve.
export const CATALOG_DEFAULT_PAGE_SIZE = 50
export const CATALOG_PAGE_SIZE_OPTIONS: number[] = [20, 50, 100]

// The shopper's choice is remembered per VIEWER (this browser), not per store:
// the store's configured size still drives a first visit and every viewer who
// never touched the selector.
const CATALOG_PAGE_SIZE_STORAGE_KEY = 'business-os-portal-page-size-v1'

type NumericInput = number | string | null | undefined
type Translate = (key: string) => string | undefined

type CatalogPaginationControlsProps = {
  page?: NumericInput
  pageSize?: NumericInput
  totalItems?: NumericInput
  onPageChange?: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void
  pageSizeOptions?: number[]
  label?: string
  t?: Translate
  className?: string
  /** Printed on the same row as Back/Next, e.g. "3,585 result(s)". */
  resultsCount?: string
}

/** Any off-menu value (a stale stored choice, a hand-edited URL) becomes the default. */
export function normalizeCatalogPageSize(value: NumericInput): number {
  const parsed = Number(value)
  return CATALOG_PAGE_SIZE_OPTIONS.includes(parsed) ? parsed : CATALOG_DEFAULT_PAGE_SIZE
}

// localStorage throws rather than returning null in Safari private mode and
// wherever site data is blocked, so both helpers swallow that into "no stored
// choice" instead of taking the storefront down with them.
export function readStoredCatalogPageSize(): number | null {
  try {
    const raw = window.localStorage?.getItem(CATALOG_PAGE_SIZE_STORAGE_KEY)
    const parsed = Number(raw)
    return raw && CATALOG_PAGE_SIZE_OPTIONS.includes(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function writeStoredCatalogPageSize(value: NumericInput): void {
  try {
    window.localStorage?.setItem(CATALOG_PAGE_SIZE_STORAGE_KEY, String(normalizeCatalogPageSize(value)))
  } catch {
    // Storage is unavailable; the choice still applies for this visit.
  }
}

/**
 * Whether a bootstrap payload can stand in for this viewer's first product
 * page. It cannot when the viewer picked a size the payload was not cut at:
 * the embedded/bootstrapped page always carries the store's own size, so a
 * shopper on 20 would otherwise see 50 cards under a pager that reads 20.
 */
export function bootstrapPageSizeMatchesViewer(bootstrapPageSize: NumericInput, viewerPageSize: number | null): boolean {
  if (!viewerPageSize) return true
  return viewerPageSize === (Number(bootstrapPageSize) || CATALOG_DEFAULT_PAGE_SIZE)
}

function clampCatalogPage(page: NumericInput, totalItems: NumericInput, pageSize: NumericInput): number {
  const safePageSize = Math.max(1, Number(pageSize || CATALOG_DEFAULT_PAGE_SIZE))
  const totalPages = Math.max(1, Math.ceil(Math.max(0, Number(totalItems || 0)) / safePageSize))
  return Math.max(1, Math.min(totalPages, Number(page || 1)))
}

export function paginateCatalogItems<T>(items: readonly T[] = [], page: NumericInput = 1, pageSize: NumericInput = CATALOG_DEFAULT_PAGE_SIZE): T[] {
  const list = Array.isArray(items) ? items : []
  const safePageSize = Math.max(1, Number(pageSize || CATALOG_DEFAULT_PAGE_SIZE))
  const safePage = clampCatalogPage(page, list.length, safePageSize)
  const start = (safePage - 1) * safePageSize
  return list.slice(start, start + safePageSize)
}

export default function CatalogPaginationControls({
  page = 1,
  pageSize = CATALOG_DEFAULT_PAGE_SIZE,
  totalItems = 0,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = CATALOG_PAGE_SIZE_OPTIONS,
  label = 'products',
  t,
  className = '',
  resultsCount,
}: CatalogPaginationControlsProps) {
  return (
    <PaginationControls
      page={page}
      pageSize={pageSize}
      totalItems={totalItems}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      pageSizeOptions={pageSizeOptions}
      label={label}
      t={t}
      resultsCount={resultsCount}
      // The storefront's own layout: one centred pill -- page size / Back /
      // page / count / Next and nothing else -- and no "Showing X-Y of N" row.
      // The old wrapper classes here (a rounded card with its own background)
      // existed to dress that summary row's box; with the summary gone there is
      // no box left to dress, and a full-width card behind a centred pill would
      // just reintroduce the bar the owner asked us to remove.
      //
      // The size selector is the fixed 20/50/100 menu, never a free-text box:
      // editablePageSizeInput stays off for the public surface so a shopper
      // cannot ask the storefront for 5,000 products in one request.
      layout="centered"
      className={className}
    />
  )
}
