import { matchesYearMonthFilters } from '../../../utils/groupedRecords.ts'
import { formatPriceNumber } from '../../../utils/pricing.ts'

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
  image_gallery?: unknown[]
  image_path?: unknown
  selling_price_usd?: unknown
  selling_price_khr?: unknown
  special_price_usd?: unknown
  special_price_khr?: unknown
  discount_enabled?: unknown
  discount_type?: unknown
  discount_percent?: unknown
  discount_amount_usd?: unknown
  discount_amount_khr?: unknown
  discount_label?: unknown
  discount_badge_color?: unknown
  discount_starts_at?: unknown
  discount_ends_at?: unknown
  purchase_price_usd?: unknown
  purchase_price_khr?: unknown
  cost_price_usd?: unknown
  cost_price_khr?: unknown
  parent_id?: unknown
  is_group?: unknown
  is_active?: unknown
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

type ProductExportRow = Record<string, string | number>

function toNumber(value: unknown, fallback = 0): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function getImageGallery(product: ProductRecord): unknown[] {
  return Array.isArray(product?.image_gallery) ? product.image_gallery : []
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

export function buildProductExportRows(products: ProductRecord[] = []): ProductExportRow[] {
  const toImageName = (value: unknown) => String(value || '').split(/[\\/]/).pop() || ''
  const toImageUrl = (value: unknown) => String(value || '').trim()
  const priceCsv = (value: unknown) => formatPriceNumber(value || 0)
  return products.map((product) => {
    const imageGallery = getImageGallery(product)
    return {
      Name: String(product.name || ''),
      SKU: String(product.sku || ''),
      Barcode: String(product.barcode || ''),
      Category: String(product.category || ''),
      Brand: String(product.brand || ''),
      Unit: String(product.unit || ''),
      Description: String(product.description || ''),
      Created_At: String(product.created_at || ''),
      Selling_Price_USD: priceCsv(product.selling_price_usd),
      Selling_Price_KHR: priceCsv(product.selling_price_khr),
      Special_Price_USD: priceCsv(product.special_price_usd || product.selling_price_usd || 0),
      Special_Price_KHR: priceCsv(product.special_price_khr || product.selling_price_khr || 0),
      Discount_Enabled: product.discount_enabled ? 'Yes' : 'No',
      Discount_Type: String(product.discount_type || 'percent'),
      Discount_Percent: priceCsv(product.discount_percent || 0),
      Discount_Amount_USD: priceCsv(product.discount_amount_usd || 0),
      Discount_Amount_KHR: priceCsv(product.discount_amount_khr || 0),
      Discount_Label: String(product.discount_label || ''),
      Discount_Badge_Color: String(product.discount_badge_color || ''),
      Discount_Starts_At: String(product.discount_starts_at || ''),
      Discount_Ends_At: String(product.discount_ends_at || ''),
      Purchase_Price_USD: priceCsv(product.purchase_price_usd || product.cost_price_usd || 0),
      Purchase_Price_KHR: priceCsv(product.purchase_price_khr || product.cost_price_khr || 0),
      Cost_Price_USD: priceCsv(product.cost_price_usd || product.purchase_price_usd || 0),
      Cost_Price_KHR: priceCsv(product.cost_price_khr || product.purchase_price_khr || 0),
      Stock_Quantity: toNumber(product.stock_quantity),
      Low_Stock_Threshold: toNumber(product.low_stock_threshold),
      Supplier: String(product.supplier || ''),
      Image_Filename_1: toImageName(imageGallery[0] || product.image_path || ''),
      Image_Filename_2: toImageName(imageGallery[1] || ''),
      Image_Filename_3: toImageName(imageGallery[2] || ''),
      Image_Filename_4: toImageName(imageGallery[3] || ''),
      Image_Filename_5: toImageName(imageGallery[4] || ''),
      Image_URL_1: toImageUrl(imageGallery[0] || product.image_path || ''),
      Image_URL_2: toImageUrl(imageGallery[1] || ''),
      Image_URL_3: toImageUrl(imageGallery[2] || ''),
      Image_URL_4: toImageUrl(imageGallery[3] || ''),
      Image_URL_5: toImageUrl(imageGallery[4] || ''),
      Image_Filenames: imageGallery.map((entry) => toImageName(entry)).filter(Boolean).join('|'),
      Image_URLs: imageGallery.map((entry) => toImageUrl(entry)).filter(Boolean).join('|'),
      Image_Conflict_Mode: '',
      Branch: (() => {
        const primary = (product.branch_stock || []).find((stock) => toNumber(stock.quantity) > 0)
        return String(primary?.branch_name || '')
      })(),
      Branch_Stock_JSON: JSON.stringify((product.branch_stock || []).map((stock) => ({
        branch_id: stock.branch_id,
        branch_name: stock.branch_name,
        quantity: toNumber(stock.quantity),
      }))),
      Parent_ID: String(product.parent_id || ''),
      Is_Group: product.is_group ? 'Yes' : 'No',
      Active: product.is_active ? 'Yes' : 'No',
    }
  })
}
