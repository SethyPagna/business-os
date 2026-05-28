import { calculateProductDiscount } from '../../../utils/pricing.ts'

type StockStatus = 'out_of_stock' | 'low_stock' | 'in_stock'

interface NamedRecord {
  name?: unknown
  [key: string]: unknown
}

interface BranchRecord {
  id?: unknown
  name?: unknown
}

interface BranchStockRecord {
  branch_id?: unknown
  branch_name?: unknown
  quantity?: unknown
}

interface ProductRecord {
  brand?: unknown
  branch_stock?: BranchStockRecord[]
  category?: unknown
  cost_price_khr?: unknown
  cost_price_usd?: unknown
  low_stock_threshold?: unknown
  out_of_stock_threshold?: unknown
  purchase_price_khr?: unknown
  purchase_price_usd?: unknown
  selling_price_usd?: unknown
  stock_quantity?: unknown
  [key: string]: unknown
}

interface CategoryRecord {
  color?: unknown
  [key: string]: unknown
}

interface BuildProductRowDisplayStateOptions {
  branchFilter?: unknown
  branchNameById?: Map<string, unknown>
  catMap?: Record<string, CategoryRecord>
  exchangeRate?: number
  getBranchQty?: (entry: ProductRecord, branchFilter?: unknown) => unknown
  getBranchSummaryLabel?: (product: ProductRecord) => string
  getBrandColor?: (brand: unknown) => string
  t?: (key: string, fallback?: string) => string
}

interface ProductBranchSummaryOptions {
  branchFilter?: unknown
  getBranchQty?: (entry: ProductRecord, branchFilter?: unknown) => unknown
}

function toNumber(value: unknown, fallback = 0): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

export const PRODUCT_STOCK_STATUS_CLASS: Record<StockStatus, string> = {
  out_of_stock: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300',
  low_stock: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  in_stock: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
}

export function buildNameLookupMap<T extends NamedRecord>(items: T[] = [], key = 'name'): Record<string, T> {
  return Object.fromEntries((items || []).map((item) => [String(item?.[key] ?? ''), item]))
}

export function buildBranchNameByIdMap(branches: BranchRecord[] = []): Map<string, unknown> {
  return new Map((branches || []).map((branch) => [String(branch?.id), branch?.name]))
}

export function buildProductBrandOptions(metaBrands: unknown[] = [], settingsBrandOptions = '[]'): string[] {
  const fromProducts = (metaBrands || [])
    .map((brand) => String(brand || '').trim())
    .filter(Boolean)
  let fromSettings: string[] = []
  try {
    const parsed: unknown = JSON.parse(settingsBrandOptions || '[]')
    if (Array.isArray(parsed)) {
      fromSettings = parsed.map((entry) => String(entry || '').trim()).filter(Boolean)
    }
  } catch (_) {}
  return Array.from(new Set([...fromProducts, ...fromSettings])).sort((a, b) => a.localeCompare(b))
}

export function buildProductBranchSummaryLabel(product: ProductRecord, branchNameById: Map<string, unknown> = new Map(), visibleLimit = 2): string {
  const rows = (product?.branch_stock || [])
    .filter((entry) => toNumber(entry?.quantity) > 0)
    .sort((a, b) => toNumber(b.quantity) - toNumber(a.quantity))
  if (!rows.length) return ''
  const visible = rows
    .slice(0, visibleLimit)
    .map((entry) => `${entry.branch_name || branchNameById.get(String(entry.branch_id)) || entry.branch_id}: ${entry.quantity}`)
  return rows.length > visibleLimit ? `${visible.join(', ')} +${rows.length - visibleLimit}` : visible.join(', ')
}

export function getProductStockStatus(product: ProductRecord, {
  branchFilter = 'all',
  getBranchQty = (entry) => entry?.stock_quantity,
}: ProductBranchSummaryOptions = {}): StockStatus {
  const qty = branchFilter !== 'all' ? getBranchQty(product, branchFilter) : product?.stock_quantity
  if (toNumber(qty) <= toNumber(product?.out_of_stock_threshold)) return 'out_of_stock'
  if (toNumber(qty) <= toNumber(product?.low_stock_threshold, 10)) return 'low_stock'
  return 'in_stock'
}

export function buildProductRowDisplayState(product: ProductRecord, {
  branchFilter = 'all',
  branchNameById = new Map(),
  catMap = {},
  exchangeRate = 0,
  getBranchQty = (entry) => entry?.stock_quantity,
  getBranchSummaryLabel = () => '',
  getBrandColor = () => '',
  t = (key, fallback) => fallback || key,
}: BuildProductRowDisplayStateOptions = {}) {
  const purchaseUsd = toNumber(product?.purchase_price_usd || product?.cost_price_usd)
  const purchaseKhr = toNumber(product?.purchase_price_khr || product?.cost_price_khr)
  const sellingUsd = toNumber(product?.selling_price_usd)
  const marginUsd = sellingUsd - purchaseUsd
  const marginPct = sellingUsd > 0 ? (marginUsd / sellingUsd * 100) : 0
  const qty = branchFilter !== 'all' ? getBranchQty(product, branchFilter) : product?.stock_quantity
  const stockStatus = getProductStockStatus(product, { branchFilter, getBranchQty })
  const selectedBranchName = branchFilter !== 'all' ? branchNameById.get(String(branchFilter)) : ''
  const branchSummaryLabel = branchFilter === 'all' ? getBranchSummaryLabel(product) : ''
  const compactMeta = [
    product?.brand ? { key: 'brand', label: product.brand, color: getBrandColor(product.brand) } : null,
    product?.category ? { key: 'category', label: product.category, color: catMap[String(product.category)]?.color } : null,
  ].filter(Boolean)
  const mobileStatusLabel =
    stockStatus === 'out_of_stock'
      ? (t('out_of_stock') || 'Out')
      : stockStatus === 'low_stock'
        ? (t('low_stock') || 'Low')
        : (t('in_stock') || 'In Stock')

  return {
    branchSummaryLabel,
    compactMeta,
    marginPct,
    marginUsd,
    mobileStatusClass: PRODUCT_STOCK_STATUS_CLASS[stockStatus],
    mobileStatusLabel,
    promotion: calculateProductDiscount(product, exchangeRate),
    purchaseKhr,
    purchaseUsd,
    qty,
    selectedBranchName,
    stockStatus,
  }
}
