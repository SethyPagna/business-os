import { calculateProductDiscount } from '../../../utils/pricing.ts'
import { promotionBadgeForProduct, evaluatePromotionPricing, type PromotionRule } from '../../../utils/promotionRules.ts'

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
  promotionRules?: readonly PromotionRule[]
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

// Stock status convention (explicit ask, this session): list/table views no
// longer show the status as its own word/badge by default -- that's now
// reserved for the click-to-view-details panel, which already has its own
// "Status" row (see ProductDetailModal.tsx) unaffected by this change. In
// place of the badge, the quantity+unit value itself is colored using
// these classes: red when out, yellow/amber when low, green/emerald when
// healthy. `PRODUCT_STOCK_STATUS_CLASS` above (badge background+text) is
// kept only for the detail panel and any other spot that still wants a
// badge -- this is the text-only variant for coloring a bare qty value
// sitting on a plain background.
export const PRODUCT_STOCK_STATUS_TEXT_CLASS: Record<StockStatus, string> = {
  out_of_stock: 'text-red-600 dark:text-red-400',
  low_stock: 'text-amber-600 dark:text-amber-400',
  in_stock: 'text-emerald-600 dark:text-emerald-400',
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
  // De-dup case/whitespace-insensitively, not with a plain Set -- imported
  // product data can have inconsistent brand casing (e.g. "Ariana" vs
  // "ARIANA"), which a plain Set treats as two different values and shows
  // as two options that look identical in the filter panel. The backend's
  // metadata query now normalizes this too (see routes/products.ts), but
  // this dedup stays as defense in depth for the settings-library merge,
  // which happens client-side. Settings-library casing wins on a
  // collision since that list is user-curated.
  const byKey = new Map<string, string>()
  for (const brand of fromProducts) byKey.set(brand.toLowerCase(), brand)
  for (const brand of fromSettings) byKey.set(brand.toLowerCase(), brand)
  return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b))
}

export function buildProductBranchSummaryLabel(product: ProductRecord, branchNameById: Map<string, unknown> = new Map(), visibleLimit = 2): string {
  // Zero-quantity branches used to be filtered out here, which meant a
  // product in stock at Branch A but sitting at 0 in Branch B only ever
  // showed "Branch A: 5" -- Branch B's entry, and thus that it was tracked
  // there at all, disappeared. Keep every branch row (including 0s) so
  // both branches are always named, sorted with the highest quantity
  // first, same as before.
  const rows = (product?.branch_stock || [])
    .sort((a, b) => toNumber(b.quantity) - toNumber(a.quantity))
  // A product with no branch_stock rows at all (missing data, not just
  // zero stock) has nothing to name here -- show an explicit "0" so it
  // reads the same as any other out-of-stock product rather than looking
  // like missing data.
  if (!rows.length) return '0'
  const nameFor = (entry: BranchStockRecord): unknown => (
    entry.branch_name || branchNameById.get(String(entry.branch_id)) || entry.branch_id
  )
  // Branch-aware zero-stock display (explicit ask, this session): a
  // product with no stock anywhere must still name every branch it's
  // tracked at -- "Warehouse: 0, Shop: 0" -- not collapse to a bare "0"
  // that hides which branches were even checked. This REVERSES the
  // previous behavior (see git history / this file's prior version),
  // which deliberately collapsed the all-zero case to a bare "0" on the
  // reasoning that per-branch 0s "looked like a formatting glitch" --
  // that reasoning is superseded by this explicit request. No truncation
  // here even past `visibleLimit`: unlike the mixed-stock case below,
  // there's no "N more branches carrying positive stock" to summarize
  // past a "+N" once every branch is already at zero, so every branch is
  // shown in full.
  if (rows.every((entry) => toNumber(entry.quantity) <= 0)) {
    return rows.map((entry) => `${nameFor(entry)}: ${entry.quantity}`).join(', ')
  }
  const visible = rows
    .slice(0, visibleLimit)
    .map((entry) => `${nameFor(entry)}: ${entry.quantity}`)
  // Only branches still holding positive stock count toward the overflow
  // total -- a trailing "+N" here is read as "N more branches carrying
  // this product", and a 0-qty branch (kept in `rows` above so it's still
  // named if it happens to fall within visibleLimit) isn't one of those.
  const overflowCount = rows.slice(visibleLimit).filter((entry) => toNumber(entry.quantity) > 0).length
  return overflowCount > 0 ? `${visible.join(', ')} +${overflowCount}` : visible.join(', ')
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

function buildRowPromotion(product: ProductRecord, exchangeRate: number, promotionRules: readonly PromotionRule[]) {
  if (!promotionRules.length) {
    return { ...calculateProductDiscount(product, exchangeRate), title: '', isQuantityHint: false, badgeColor: String((product as Record<string, unknown>)?.discount_badge_color || '') }
  }
  const badge = promotionBadgeForProduct(product, promotionRules)
  const evaluation = evaluatePromotionPricing(product, 1, promotionRules, exchangeRate || 4100)
  const sellingUsd = toNumber(product?.selling_price_usd)
  const sellingKhr = toNumber(product?.selling_price_khr)
  return {
    active: badge.active,
    applied_price_usd: evaluation.unit_price_usd,
    applied_price_khr: evaluation.unit_price_khr,
    discount_amount_usd: Math.max(0, sellingUsd - evaluation.unit_price_usd),
    discount_amount_khr: Math.max(0, sellingKhr - evaluation.unit_price_khr),
    percent_off: evaluation.percent_off,
    title: badge.active && badge.show_title ? badge.title : '',
    isQuantityHint: badge.kind === 'quantity_hint',
    badgeColor: badge.active ? badge.badge_color : String((product as Record<string, unknown>)?.discount_badge_color || ''),
    minQuantity: badge.min_quantity,
    saveUsd: badge.save_usd,
  }
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
  promotionRules = [],
}: BuildProductRowDisplayStateOptions = {}) {
  const costUsd = toNumber(product?.cost_price_usd)
  const costKhr = toNumber(product?.cost_price_khr)
  const sellingUsd = toNumber(product?.selling_price_usd)
  const marginUsd = sellingUsd - costUsd
  const marginPct = sellingUsd > 0 ? (marginUsd / sellingUsd * 100) : 0
  const qty = branchFilter !== 'all' ? getBranchQty(product, branchFilter) : product?.stock_quantity
  const stockStatus = getProductStockStatus(product, { branchFilter, getBranchQty })
  const selectedBranchName = branchFilter !== 'all' ? branchNameById.get(String(branchFilter)) : ''
  const branchSummaryLabel = branchFilter === 'all' ? getBranchSummaryLabel(product) : ''
  const compactMeta = [
    // Barcode FIRST, then brand and category. It is the field people scan
    // for when identifying a row -- brand and category are broad groupings
    // they have usually already filtered by, so leading with them buried
    // the one value that is unique to the product. (Requested Aug 25 2026:
    // "barcode show in default display same row with category and brand,
    // placed first".) Still one shared line, matching
    // InventoryProductsSurface.tsx's own name-cell tag line.
    product?.barcode ? { key: 'barcode', label: product.barcode, className: 'bg-sky-50 font-mono text-sky-700 dark:bg-sky-900/30 dark:text-sky-200' } : null,
    product?.brand ? { key: 'brand', label: product.brand, color: getBrandColor(product.brand) } : null,
    product?.category ? { key: 'category', label: product.category, color: catMap[String(product.category)]?.color } : null,
  ].filter(Boolean)
  // Short single-word badge text everywhere (matches Inventory/Branches'
  // stat-tile labels) -- these _short keys already exist in en/km.json,
  // this just points at them instead of the long full-sentence keys,
  // which used to win over the inline fallback here since a JSON value
  // always overrides a component's own fallback string.
  const mobileStatusLabel =
    stockStatus === 'out_of_stock'
      ? (t('out_of_stock_short') || 'Out')
      : stockStatus === 'low_stock'
        ? (t('low_stock_short') || 'Low')
        : (t('in_stock_short') || 'In')

  return {
    branchSummaryLabel,
    compactMeta,
    marginPct,
    marginUsd,
    mobileStatusClass: PRODUCT_STOCK_STATUS_CLASS[stockStatus],
    mobileStatusLabel,
    stockStatusTextClass: PRODUCT_STOCK_STATUS_TEXT_CLASS[stockStatus],
    // G1: kernel-driven -- the product's own discount OR the best active
    // promotion rule, whichever the shared kernel picks (same one POS
    // charges with). Shape stays calculateProductDiscount-compatible for
    // every existing consumer; title/hint/badge color ride along for the
    // chips. With no rules passed this is exactly the old computation.
    promotion: buildRowPromotion(product, exchangeRate, promotionRules),
    costKhr,
    costUsd,
    qty,
    selectedBranchName,
    stockStatus,
  }
}
