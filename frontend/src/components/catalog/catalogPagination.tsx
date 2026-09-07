import PaginationControls from '../shared/PaginationControls'

// Preserve the existing catalogue default while removing the shopper-facing
// size selector. The public pager changes page only.
export const CATALOG_DEFAULT_PAGE_SIZE = 50

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
      // No onPageSizeChange, pageSizeOptions, or editable input: the public
      // storefront has one fixed server-aligned page size and one pager.
      layout="centered"
      className={className}
    />
  )
}
