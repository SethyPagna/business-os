import PaginationControls from '../shared/PaginationControls'

// Exported because the per-page chooser no longer lives on the pager row --
// it is a field in the Filters panel, and that field and this wrapper have to
// name the same three presets or the storefront grows two page-size
// vocabularies.
export const CATALOG_PAGE_SIZE_OPTIONS = [20, 50, 100]
// The preset list's display order is ascending (20/50/100) and unrelated to
// which one is the actual default. Keeping those two concerns separate still
// matters -- reading OPTIONS[0] as "the default" is how this drifted before,
// and it would drift again the moment someone reorders the presets.
//
// The VALUE reverses Part 151's org-wide "default page size is 50" at
// explicit request (Aug 25 2026): "for the public website also do 20 per
// page". 50 product cards is a long scroll on a phone, and this is the
// storefront -- the surface most likely to be opened on one. Recorded rather
// than quietly overwritten, since Part 151 was a deliberate decision.
//
// Matches DEFAULT_PAGE_SIZE in shared/PaginationControls.tsx (the admin
// side) and the server-side fallback in routes/portal.ts, so a page load
// that omits pageSize gets the same 20 from either end.
export const CATALOG_DEFAULT_PAGE_SIZE = 20

type NumericInput = number | string | null | undefined
type Translate = (key: string) => string | undefined

type CatalogPaginationControlsProps = {
  page?: NumericInput
  pageSize?: NumericInput
  totalItems?: NumericInput
  onPageChange?: (page: number) => void
  label?: string
  t?: Translate
  className?: string
  // Which of the storefront's two pager mounts this is. The grid carries the
  // same control above and below itself, so each needs a name of its own --
  // otherwise the landmark list holds two identical entries -- and only one
  // of them may carry the live region, or one Next is announced twice.
  pagerName?: string
  announcePage?: boolean
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
  label = 'products',
  t,
  className = '',
  pagerName = '',
  announcePage = false,
}: CatalogPaginationControlsProps) {
  return (
    <PaginationControls
      page={page}
      pageSize={pageSize}
      totalItems={totalItems}
      onPageChange={onPageChange}
      label={label}
      t={t}
      // The storefront's own layout: one centred pill -- Back / page / count /
      // Next and nothing else -- and no "Showing X-Y of N" row. The old
      // wrapper classes here (a rounded card with its own background) existed
      // to dress that summary row's box; with the summary gone there is no box
      // left to dress, and a full-width card behind a centred pill would just
      // reintroduce the bar the owner asked us to remove.
      //
      // No onPageSizeChange, and no pageSizeOptions/editablePageSizeInput to
      // configure one: the owner struck the page-size control off this row, so
      // the prop would be a seam whose only use is re-growing the defect. The
      // chooser is a Filters field -- see CatalogProductsSection.
      layout="centered"
      pagerName={pagerName}
      announcePage={announcePage}
      className={className}
    />
  )
}
