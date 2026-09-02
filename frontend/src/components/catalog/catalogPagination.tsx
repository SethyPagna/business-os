import PaginationControls from '../shared/PaginationControls'

const CATALOG_PAGE_SIZE_OPTIONS = [20, 50, 100]
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
  onPageSizeChange?: (pageSize: number) => void
  label?: string
  t?: Translate
  className?: string
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
  label = 'products',
  t,
  className = '',
}: CatalogPaginationControlsProps) {
  return (
    <PaginationControls
      page={page}
      pageSize={pageSize}
      totalItems={totalItems}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      pageSizeOptions={CATALOG_PAGE_SIZE_OPTIONS}
      label={label}
      t={t}
      editablePageSizeInput={false}
      className={`rounded-2xl bg-white/92 dark:bg-neutral-900/90 ${className}`}
    />
  )
}
