type ProductRow = Record<string, unknown>
type Translate = (key: string, fallback?: string) => string
type Setter = (value: string) => void

interface ProductExportItem {
  label: string
  onClick: () => void
  color?: string
}

type ProductExportMenuItem = ProductExportItem | 'divider'

interface BuildProductExportItemsOptions {
  brandFilter?: unknown
  branchFilter?: unknown
  catFilter?: unknown
  createdMonthFilter?: unknown
  createdYearFilter?: unknown
  exportProductsCsv?: (rows: ProductRow[], prefix: string) => void
  filtered?: ProductRow[]
  products?: ProductRow[]
  selectedProducts?: ProductRow[]
  stockFilter?: unknown
  supplierFilter?: unknown
  tr?: Translate
}

interface ProductFilterState {
  brandFilter?: unknown
  branchFilter?: unknown
  catFilter?: unknown
  createdMonthFilter?: unknown
  createdYearFilter?: unknown
  groupFilter?: unknown
  initialFilter?: unknown
  productSortDirection?: unknown
  stockFilter?: unknown
  supplierFilter?: unknown
}

interface FilterOption {
  id: string
  label: string
  active: boolean
  onClick: () => void
}

interface FilterSection {
  id: string
  label: string
  options: FilterOption[]
}

interface BranchOption {
  id?: unknown
  name?: unknown
}

interface CategoryOption {
  id?: unknown
  name?: unknown
}

interface BuildProductFilterSectionsOptions {
  availableCreatedYears?: unknown[]
  branches?: BranchOption[]
  brandOptions?: unknown[]
  categories?: CategoryOption[]
  filters?: ProductFilterState
  isOpen?: boolean
  monthOptions?: Array<[unknown, unknown]>
  setBrandFilter?: Setter
  setBranchFilter?: Setter
  setCatFilter?: Setter
  setCreatedMonthFilter?: Setter
  setCreatedYearFilter?: Setter
  setGroupFilter?: Setter
  setProductSortDirection?: Setter
  setStockFilter?: Setter
  setSupplierFilter?: Setter
  suppliers?: unknown[]
  t?: (key: string) => string
}

function asString(value: unknown): string {
  return String(value)
}

function normalizeOptionValue(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function safeFilterLabel(t: (key: string) => string, key: string, fallback: string): string {
  const value = t(key)
  const normalized = String(value || '').trim().toLowerCase()
  if (!value || value === key) return fallback
  if (key === 'brand' && normalized === 'back') return fallback
  return value
}

export function buildProductExportItems({
  brandFilter = 'all',
  branchFilter = 'all',
  catFilter = 'all',
  createdMonthFilter = 'all',
  createdYearFilter = 'all',
  exportProductsCsv = () => {},
  filtered = [],
  products = [],
  selectedProducts = [],
  stockFilter = 'all',
  supplierFilter = 'all',
  tr = (key, fallback) => fallback || key,
}: BuildProductExportItemsOptions = {}): ProductExportMenuItem[] {
  return [
    { label: tr('export_visible_products', 'Export visible products'), onClick: () => exportProductsCsv(filtered, 'products-visible') },
    selectedProducts.length ? { label: tr('export_selected_products', 'Export selected products'), onClick: () => exportProductsCsv(selectedProducts, 'products-selected'), color: 'blue' } : null,
    stockFilter !== 'all' ? { label: tr('export_filtered_stock_state', 'Export filtered stock state'), onClick: () => exportProductsCsv(filtered, `products-${stockFilter}`) } : null,
    catFilter !== 'all' ? { label: tr('export_filtered_category', 'Export filtered category'), onClick: () => exportProductsCsv(filtered, 'products-category') } : null,
    brandFilter !== 'all' ? { label: tr('export_filtered_brand', 'Export filtered brand'), onClick: () => exportProductsCsv(filtered, 'products-brand') } : null,
    supplierFilter !== 'all' ? { label: tr('export_filtered_supplier', 'Export filtered supplier'), onClick: () => exportProductsCsv(filtered, 'products-supplier') } : null,
    branchFilter !== 'all' ? { label: tr('export_filtered_branch', 'Export filtered branch'), onClick: () => exportProductsCsv(filtered, 'products-branch') } : null,
    createdYearFilter !== 'all' || createdMonthFilter !== 'all' ? { label: tr('export_filtered_created_time', 'Export filtered created-time range'), onClick: () => exportProductsCsv(filtered, 'products-created-filter') } : null,
    'divider',
    { label: tr('export_full_product_list', 'Export full product list'), onClick: () => exportProductsCsv(products, 'products-all'), color: 'green' },
  ].filter(Boolean) as ProductExportMenuItem[]
}

export function buildProductSupplierOptions(metaSuppliers: unknown[] = []): string[] {
  return [...new Set((metaSuppliers || []).filter(Boolean).map((supplier) => String(supplier)))].sort((a, b) => a.localeCompare(b))
}

export function countActiveProductFilters({
  brandFilter = 'all',
  branchFilter = 'all',
  catFilter = 'all',
  createdMonthFilter = 'all',
  createdYearFilter = 'all',
  groupFilter = 'all',
  initialFilter = 'all',
  productSortDirection = 'desc',
  stockFilter = 'all',
  supplierFilter = 'all',
}: ProductFilterState = {}): number {
  return [
    catFilter !== 'all' ? 1 : 0,
    brandFilter !== 'all' ? 1 : 0,
    branchFilter !== 'all' ? 1 : 0,
    supplierFilter !== 'all' ? 1 : 0,
    stockFilter !== 'all' ? 1 : 0,
    groupFilter !== 'all' ? 1 : 0,
    initialFilter !== 'all' ? 1 : 0,
    createdYearFilter !== 'all' ? 1 : 0,
    createdMonthFilter !== 'all' ? 1 : 0,
    productSortDirection !== 'desc' ? 1 : 0,
  ].reduce((sum, value) => sum + value, 0)
}

export function buildProductFilterSections({
  availableCreatedYears = [],
  branches = [],
  brandOptions = [],
  categories = [],
  filters = {},
  isOpen = true,
  monthOptions = [],
  setBrandFilter = () => {},
  setBranchFilter = () => {},
  setCatFilter = () => {},
  setCreatedMonthFilter = () => {},
  setCreatedYearFilter = () => {},
  setGroupFilter = () => {},
  setProductSortDirection = () => {},
  setStockFilter = () => {},
  setSupplierFilter = () => {},
  suppliers = [],
  t = (key) => key,
}: BuildProductFilterSectionsOptions = {}): FilterSection[] {
  if (!isOpen) return []
  const {
    brandFilter = 'all',
    branchFilter = 'all',
    catFilter = 'all',
    createdMonthFilter = 'all',
    createdYearFilter = 'all',
    groupFilter = 'all',
    productSortDirection = 'desc',
    stockFilter = 'all',
    supplierFilter = 'all',
  } = filters

  return [
    {
      id: 'sort',
      label: t('sort') || 'Sort',
      options: [
        { id: 'created-desc', label: t('newest_first') || 'Newest first', active: productSortDirection === 'desc', onClick: () => setProductSortDirection('desc') },
        { id: 'created-asc', label: t('oldest_first') || 'Oldest first', active: productSortDirection === 'asc', onClick: () => setProductSortDirection('asc') },
      ],
    },
    availableCreatedYears.length ? {
      id: 'created-year',
      label: t('year') || 'Year',
      options: [
        { id: 'created-year-all', label: t('all') || 'All', active: createdYearFilter === 'all', onClick: () => { setCreatedYearFilter('all'); setCreatedMonthFilter('all') } },
        ...availableCreatedYears.map((year) => ({
          id: `created-year-${year}`,
          label: String(year),
          active: createdYearFilter === String(year),
          onClick: () => {
            const nextYear = createdYearFilter === String(year) ? 'all' : String(year)
            setCreatedYearFilter(nextYear)
            if (nextYear === 'all') setCreatedMonthFilter('all')
          },
        })),
      ],
    } : null,
    {
      id: 'created-month',
      label: t('month') || 'Month',
      options: [
        { id: 'created-month-all', label: t('all') || 'All', active: createdMonthFilter === 'all', onClick: () => setCreatedMonthFilter('all') },
        ...monthOptions.map(([value, label]) => ({
          id: `created-month-${value}`,
          label: String(label),
          active: createdMonthFilter === value,
          onClick: () => setCreatedMonthFilter(createdMonthFilter === value ? 'all' : String(value)),
        })),
      ],
    },
    branches.length > 1 ? {
      id: 'branch',
      label: t('branch') || 'Branch',
      options: [
        { id: 'branch-all', label: t('all') || 'All', active: branchFilter === 'all', onClick: () => setBranchFilter('all') },
        ...branches.map((branch) => ({
          id: `branch-${branch.id}`,
          label: String(branch.name),
          active: branchFilter === String(branch.id),
          onClick: () => setBranchFilter(branchFilter === String(branch.id) ? 'all' : String(branch.id)),
        })),
      ],
    } : null,
    {
      id: 'group',
      label: t('groups') || 'Groups',
      options: [
        { id: 'group-all', label: t('all') || 'All', active: groupFilter === 'all', onClick: () => setGroupFilter('all') },
        { id: 'group-grouped', label: t('groups') || 'Groups', active: groupFilter === 'group', onClick: () => setGroupFilter(groupFilter === 'group' ? 'all' : 'group') },
        { id: 'group-standalone', label: t('standalone') || 'Standalone', active: groupFilter === 'standalone', onClick: () => setGroupFilter(groupFilter === 'standalone' ? 'all' : 'standalone') },
      ],
    },
    {
      id: 'stock',
      label: t('stock_status') || 'Stock status',
      options: [
        { id: 'stock-all', label: t('all') || 'All', active: stockFilter === 'all', onClick: () => setStockFilter('all') },
        { id: 'stock-in', label: t('in_stock') || 'In Stock', active: stockFilter === 'in_stock', onClick: () => setStockFilter('in_stock') },
        { id: 'stock-low', label: t('low_stock') || 'Low', active: stockFilter === 'low', onClick: () => setStockFilter('low') },
        { id: 'stock-out', label: t('out_of_stock') || 'Out', active: stockFilter === 'out', onClick: () => setStockFilter('out') },
      ],
    },
    categories.length ? {
      id: 'category',
      label: t('category') || 'Category',
      options: [
        { id: 'cat-all', label: t('all') || 'All', active: catFilter === 'all', onClick: () => setCatFilter('all') },
        ...categories.map((category) => ({
          id: `cat-${category.id}`,
          label: String(category.name),
          active: catFilter === category.name,
          onClick: () => setCatFilter(catFilter === category.name ? 'all' : String(category.name)),
        })),
      ],
    } : null,
    brandOptions.length ? {
      id: 'brand',
      label: safeFilterLabel(t, 'brand', 'Brand'),
      options: [
        { id: 'brand-all', label: safeFilterLabel(t, 'all_brands', 'All Brands'), active: brandFilter === 'all', onClick: () => setBrandFilter('all') },
        ...brandOptions.map((brand) => ({
          id: `brand-${brand}`,
          label: String(brand),
          active: normalizeOptionValue(brandFilter) === normalizeOptionValue(brand),
          onClick: () => setBrandFilter(normalizeOptionValue(brandFilter) === normalizeOptionValue(brand) ? 'all' : asString(brand)),
        })),
      ],
    } : null,
    suppliers.length ? {
      id: 'supplier',
      label: t('supplier') || 'Supplier',
      options: [
        { id: 'supplier-all', label: t('suppliers') || 'All Suppliers', active: supplierFilter === 'all', onClick: () => setSupplierFilter('all') },
        ...suppliers.map((supplier) => ({
          id: `supplier-${supplier}`,
          label: String(supplier),
          active: supplierFilter === supplier,
          onClick: () => setSupplierFilter(supplierFilter === supplier ? 'all' : asString(supplier)),
        })),
      ],
    } : null,
  ].filter(Boolean) as FilterSection[]
}
