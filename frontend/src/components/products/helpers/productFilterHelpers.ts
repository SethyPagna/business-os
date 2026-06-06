import { matchesYearMonthFilters } from '../../../utils/groupedRecords.ts'

interface BranchStockRecord {
  branch_id?: unknown
  branch_name?: unknown
  quantity?: unknown
}

interface ProductRecord {
  id?: unknown
  name?: unknown
  sku?: unknown
  barcode?: unknown
  category?: unknown
  brand?: unknown
  unit?: unknown
  supplier?: unknown
  description?: unknown
  created_at?: unknown
  stock_quantity?: unknown
  low_stock_threshold?: unknown
  out_of_stock_threshold?: unknown
  branch_stock?: BranchStockRecord[]
  parent_id?: unknown
  is_group?: unknown
  [key: string]: unknown
}

interface ProductFilterState {
  brandFilter?: unknown
  branchFilter?: unknown
  catFilter?: unknown
  createdMonthFilter?: unknown
  createdYearFilter?: unknown
  groupFilter?: unknown
  parentProductIds?: Set<unknown>
  searchMode?: unknown
  searchTerms?: unknown[]
  stockFilter?: unknown
  supplierFilter?: unknown
}

function toNumber(value: unknown, fallback = 0): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function normalizeFilterValue(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function buildProductSearchTerms(search: unknown): string[] {
  const raw = String(search || '').trim()
  if (!raw) return []
  return raw.split(',').map((term) => term.trim().toLowerCase()).filter(Boolean)
}

export function getProductBranchQuantity(product: ProductRecord, branchId: unknown): unknown {
  return (product?.branch_stock || [])
    .find((stock) => String(stock.branch_id) === String(branchId))?.quantity ?? 0
}

export function filterProductsForPage(products: ProductRecord[] = [], filters: ProductFilterState = {}): ProductRecord[] {
  const {
    brandFilter = 'all',
    branchFilter = 'all',
    catFilter = 'all',
    createdMonthFilter = 'all',
    createdYearFilter = 'all',
    groupFilter = 'all',
    parentProductIds = new Set(),
    searchMode = 'AND',
    searchTerms = [],
    stockFilter = 'all',
    supplierFilter = 'all',
  } = filters

  return products.filter((product) => {
    const haystack = [
      product?.name,
      product?.sku,
      product?.barcode,
      product?.category,
      product?.brand,
      product?.unit,
      product?.supplier,
      product?.description,
    ].join(' ').toLowerCase()
    const normalizedSearchTerms = searchTerms.map((term) => String(term || '').toLowerCase()).filter(Boolean)
    const matchSearch = !normalizedSearchTerms.length || (
      searchMode === 'AND'
        ? normalizedSearchTerms.every((term) => haystack.includes(term))
        : normalizedSearchTerms.some((term) => haystack.includes(term))
    )
    const createdYear = String(createdYearFilter || 'all')
    const createdMonth = String(createdMonthFilter || 'all')
    const normalizedBrandFilter = normalizeFilterValue(brandFilter)
    const matchCat = catFilter === 'all' || product.category === catFilter
    const matchBrand = normalizedBrandFilter === 'all' || normalizeFilterValue(product.brand) === normalizedBrandFilter
    const matchBranch = branchFilter === 'all' || (product.branch_stock || []).some((stock) => String(stock.branch_id) === String(branchFilter))
    const matchSupplier = supplierFilter === 'all' || String(product.supplier || '').toLowerCase() === String(supplierFilter).toLowerCase()
    const matchCreated = matchesYearMonthFilters(product.created_at, { year: createdYear, month: createdMonth })
    const isParent = Boolean(product.is_group || parentProductIds.has(Number(product.id)))
    const isVariant = Boolean(product.parent_id)
    const normalizedGroupFilter = normalizeFilterValue(groupFilter)
    const isGroupedFamilyMember = isParent || isVariant
    const matchGroup =
      normalizedGroupFilter === 'all'
        ? true
        : ['group', 'groups', 'grouped', 'parent', 'variant'].includes(normalizedGroupFilter)
          ? isGroupedFamilyMember
          : !isGroupedFamilyMember
    const qty = branchFilter !== 'all' ? getProductBranchQuantity(product, branchFilter) : product.stock_quantity
    const outOfStockThreshold = toNumber(product.out_of_stock_threshold)
    const lowStockThreshold = toNumber(product.low_stock_threshold, 10)

    if (branchFilter !== 'all' && stockFilter !== 'out' && toNumber(qty) <= outOfStockThreshold) return false

    const matchStock =
      stockFilter === 'all' ? true
        : stockFilter === 'out' ? toNumber(qty) <= outOfStockThreshold
          : stockFilter === 'low' ? toNumber(qty) > outOfStockThreshold && toNumber(qty) <= lowStockThreshold
            : stockFilter === 'in_stock' ? toNumber(qty) > lowStockThreshold
              : true
    return matchSearch && matchCat && matchBrand && matchBranch && matchSupplier && matchCreated && matchGroup && matchStock
  })
}
