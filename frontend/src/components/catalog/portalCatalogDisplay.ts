import { calculateProductDiscount, isProductDiscountActive } from '../../utils/pricing.ts'
import { promotionBadgeForProduct, evaluatePromotionPricing, isProductPromoted, type PromotionRule } from '../../utils/promotionRules.ts'

type PortalProduct = Record<string, unknown>

interface PortalDisplayConfig {
  priceDisplay?: string
  highlightRankLimit?: unknown
  showRecommendedBadge?: boolean
  showPromotionBadge?: boolean
  showTopSellerBadge?: boolean
  showTopProductBadge?: boolean
  showNewArrivalBadge?: boolean
}

interface PortalPromotionDetails {
  active: boolean
  percentOff: number
  label: string
  badgeColor: string
  discountAmountUsd: number
  discountAmountKhr: number
  // G1: a "buy >= X save Y" rule advertises without cutting the qty-1
  // price -- the card shows the deal text instead of a slashed price.
  isQuantityHint: boolean
  minQuantity: number
}

type PortalCopy = (key: string, fallback: string) => string
type PortalPriceFormatter = (usd: unknown, khr: unknown, config: PortalDisplayConfig) => string

// This used to be a second, independent copy of the same discount math
// as utils/pricing.ts (the one POS.tsx and ProductForm.tsx use) -- same
// discount_enabled/type/percent/amount/starts_at/ends_at rules, but with
// its own normalizePriceValue() that rounded with plain Math.round instead
// of utils/pricing.ts's roundUpToDecimals(). The two could disagree by a
// cent on the same product/discount at the exact same moment: POS (and
// the admin product editor preview) would show one discounted price,
// the public customer portal a different one, purely from which file's
// copy of "round the price" ran. Delegating to the shared implementation
// here instead of maintaining a second one that can silently drift.
function isPortalDiscountActive(product: PortalProduct = {}): boolean {
  return isProductDiscountActive(product)
}

function calculatePortalDiscount(product: PortalProduct = {}, exchangeRate = 4100) {
  return calculateProductDiscount(product, exchangeRate)
}

export function normalizeRecommendedProductIds(value: unknown): number[] {
  const source = Array.isArray(value)
    ? value
    : (() => {
        try {
          return JSON.parse(String(value || '[]'))
        } catch {
          return []
        }
      })()

  if (!Array.isArray(source)) return []
  const seen = new Set<number>()
  const ids: number[] = []
  source.forEach((entry) => {
    const id = Number(entry)
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) return
    seen.add(id)
    ids.push(id)
  })
  return ids
}

// showStockStatus is opt-out (undefined/anything but literal `false` means
// "show"), matching the two JSX call sites in CatalogProductsSection.tsx
// (filter-pill row + card StatusPill badge). Extracted so that toggle has a
// pure, directly-testable single source of truth instead of two inline
// `!== false` checks that could silently drift apart.
export function shouldShowStockStatus(config: { showStockStatus?: boolean } = {}): boolean {
  return config.showStockStatus !== false
}

export type PortalStockStatus = 'in_stock' | 'low_stock' | 'out_of_stock'

interface PortalStockConfig {
  stockThresholdMode?: string
  lowStockThreshold?: unknown
  outOfStockThreshold?: unknown
}

// Higher = more available. Used when several server rows merge into one
// storefront card: the combined badge takes the MOST available status, so
// a product that any branch/row still carries never shows as out of stock.
const PORTAL_STOCK_STATUS_RANK: Record<PortalStockStatus, number> = {
  out_of_stock: 0,
  low_stock: 1,
  in_stock: 2,
}

function normalizePortalStockStatus(value: unknown): PortalStockStatus | null {
  return value === 'in_stock' || value === 'low_stock' || value === 'out_of_stock' ? value : null
}

export function combinePortalStockStatus(a: unknown, b: unknown): PortalStockStatus {
  const left = normalizePortalStockStatus(a) || 'out_of_stock'
  const right = normalizePortalStockStatus(b) || 'out_of_stock'
  return PORTAL_STOCK_STATUS_RANK[right] > PORTAL_STOCK_STATUS_RANK[left] ? right : left
}

// SECURITY BOUNDARY (public storefront): the portal API no longer ships raw
// stock_quantity / per-branch quantities / low- and out-of-stock thresholds
// to shoppers -- it ships a server-computed `stock_status` plus per-branch
// `branch_availability` statuses (routes/portal.ts attachPortalStockStatus).
// This resolver reads those first. The quantity/threshold math below it is
// a LEGACY FALLBACK only, for payloads that still carry raw fields: the
// admin editor's own preview drafts and pre-deploy localStorage snapshots.
export function resolvePortalStockStatus(
  product: PortalProduct = {},
  branchId: unknown = 'all',
  config: PortalStockConfig = {},
): PortalStockStatus {
  const wholeStore = !branchId || branchId === 'all'
  if (wholeStore) {
    const served = normalizePortalStockStatus(product?.stock_status)
    if (served) return served
  } else {
    const availability = Array.isArray(product?.branch_availability) ? product.branch_availability : []
    const entry = availability.find((row) => String((row as PortalProduct | null | undefined)?.branch_id) === String(branchId))
    if (entry) {
      const served = normalizePortalStockStatus((entry as PortalProduct).status)
      if (served) return served
    } else if (normalizePortalStockStatus(product?.stock_status)) {
      // Server-shaped payload but no entry for this branch: no stock row
      // there at all.
      return 'out_of_stock'
    }
  }
  // Legacy quantity math -- byte-for-byte the rule the storefront always
  // used (and the rule the server now applies before redacting).
  const quantity = wholeStore
    ? Number(product?.stock_quantity || 0)
    : Number((Array.isArray(product?.branch_stock) ? product.branch_stock : [])
        .find((entry) => String((entry as PortalProduct | null | undefined)?.branch_id) === String(branchId))
        ?.quantity as number | string | null | undefined || 0)
  const useGlobal = config.stockThresholdMode === 'global'
  const outThreshold = Number(useGlobal ? config.outOfStockThreshold : (product?.out_of_stock_threshold as number | string | null | undefined) || 0)
  const lowThreshold = Number(useGlobal ? config.lowStockThreshold : (product?.low_stock_threshold as number | string | null | undefined) || 10)
  if (quantity <= outThreshold) return 'out_of_stock'
  if (quantity <= lowThreshold) return 'low_stock'
  return 'in_stock'
}

export function getPortalGridClass(desktopColumns: unknown): string {
  const normalized = Math.min(10, Math.max(2, Math.round(Number(desktopColumns || 4))))
  if (normalized === 2) return 'lg:grid-cols-2'
  if (normalized === 3) return 'lg:grid-cols-2 xl:grid-cols-3'
  if (normalized === 4) return 'lg:grid-cols-2 xl:grid-cols-4'
  if (normalized === 5) return 'lg:grid-cols-3 xl:grid-cols-5'
  if (normalized === 6) return 'lg:grid-cols-3 xl:grid-cols-6'
  if (normalized === 7) return 'lg:grid-cols-4 xl:grid-cols-7'
  if (normalized === 8) return 'lg:grid-cols-4 xl:grid-cols-8'
  if (normalized === 9) return 'lg:grid-cols-5 xl:grid-cols-9'
  return 'lg:grid-cols-5 xl:grid-cols-10'
}

export function getPortalMobileGridClass(mobileColumns: unknown): string {
  const normalized = Math.min(3, Math.max(2, Math.round(Number(mobileColumns || 2))))
  // Always at least 2 columns on phones (matches the reference storefront layout),
  // and step up at the `sm:` (tablet) breakpoint.
  if (normalized === 3) return 'grid-cols-2 sm:grid-cols-3'
  return 'grid-cols-2 sm:grid-cols-2'
}

export function productMatchesPortalBranches(product: PortalProduct = {}, branchFilter: unknown): boolean {
  if (!Array.isArray(branchFilter) || !branchFilter.length) return true
  // Server-shaped rows carry redacted per-branch statuses; a branch matches
  // when the product isn't out of stock there. Legacy rows (editor preview
  // drafts, pre-deploy caches) keep the old entry-existence check.
  const availability = Array.isArray(product?.branch_availability) ? product.branch_availability : []
  if (availability.length) {
    return branchFilter.some((branchId) => availability.some((entry) => (
      String((entry as PortalProduct | null | undefined)?.branch_id) === String(branchId)
      && (entry as PortalProduct | null | undefined)?.status !== 'out_of_stock'
    )))
  }
  const branchStock = Array.isArray(product?.branch_stock) ? product.branch_stock : []
  return branchFilter.some((branchId) => (
    branchStock.some((entry) => String((entry as PortalProduct | null | undefined)?.branch_id) === String(branchId))
  ))
}

// G1: with rules present this delegates to the shared promotion kernel
// (utils/promotionRules.ts -- the same one POS charges with), so the
// storefront can never advertise a price POS wouldn't charge. With no
// rules (older callers, admin preview) it stays the plain per-product
// discount read it always was.
export function getPortalPromotionDetails(product: PortalProduct = {}, promotionRules: readonly PromotionRule[] = []): PortalPromotionDetails {
  if (promotionRules.length) {
    const badge = promotionBadgeForProduct(product, promotionRules)
    const evaluation = evaluatePromotionPricing(product, 1, promotionRules)
    return {
      active: badge.active,
      percentOff: Math.max(0, badge.percent_off || 0),
      label: (badge.show_title && badge.title) || String(product?.discount_label || ''),
      badgeColor: badge.active ? badge.badge_color : String(product?.discount_badge_color || '#e11d48'),
      discountAmountUsd: evaluation.line_discount_usd || 0,
      discountAmountKhr: evaluation.line_discount_khr || 0,
      isQuantityHint: badge.kind === 'quantity_hint',
      minQuantity: badge.min_quantity || 0,
    }
  }
  const promotion = calculatePortalDiscount(product)
  const active = promotion.active
  return {
    active,
    percentOff: Math.max(0, promotion.percent_off || 0),
    label: String(product?.discount_label || ''),
    badgeColor: String(product?.discount_badge_color || '#e11d48'),
    discountAmountUsd: promotion.discount_amount_usd || 0,
    discountAmountKhr: promotion.discount_amount_khr || 0,
    isQuantityHint: false,
    minQuantity: 0,
  }
}

export function buildPortalPricePresentation(
  product: PortalProduct = {},
  config: PortalDisplayConfig = {},
  formatPortalPrice: PortalPriceFormatter,
  promotionRules: readonly PromotionRule[] = [],
) {
  const promotion = getPortalPromotionDetails(product, promotionRules)
  const evaluation = promotionRules.length ? evaluatePromotionPricing(product, 1, promotionRules) : null
  const discounted = evaluation
    ? { applied_price_usd: evaluation.unit_price_usd, applied_price_khr: evaluation.unit_price_khr }
    : calculatePortalDiscount(product)
  // A quantity hint doesn't cut the qty-1 price -- show the normal price
  // (no strikethrough) and let the badge carry the deal.
  const priceCut = promotion.active && !promotion.isQuantityHint
  const activeUsd = priceCut ? discounted.applied_price_usd : Number(product?.selling_price_usd || 0)
  const activeKhr = priceCut ? discounted.applied_price_khr : Number(product?.selling_price_khr || 0)
  return {
    primaryText: formatPortalPrice(activeUsd, activeKhr, config),
    originalText: priceCut
      ? formatPortalPrice(product?.selling_price_usd, product?.selling_price_khr, config)
      : '',
    promotion,
  }
}

export function buildPortalHighlightBadges(
  product: PortalProduct = {},
  config: PortalDisplayConfig = {},
  copy: PortalCopy,
  promotionRules: readonly PromotionRule[] = [],
) {
  const badges: Array<Record<string, unknown>> = []
  const rankLimit = Math.max(1, Math.min(10, Number(config?.highlightRankLimit || 3)))
  const promotion = getPortalPromotionDetails(product, promotionRules)
  const topSellerRank = Number(product?.top_seller_rank || 0)
  const topProductRank = Number(product?.top_product_rank || 0)

  if (config?.showRecommendedBadge && product?.portal_recommended) {
    badges.push({
      key: 'recommended',
      tone: 'emerald',
      label: copy('recommendedBadge', 'Recommended'),
    })
  }

  if (config?.showPromotionBadge && promotion.active) {
    badges.push({
      key: 'promotion',
      tone: 'rose',
      color: promotion.badgeColor,
      label: promotion.isQuantityHint
        ? (promotion.label || copy('promotionBadgeBuy', 'Buy') + ' ' + promotion.minQuantity + '+')
        : promotion.label
          ? promotion.label
          : promotion.percentOff >= 5
            ? replaceRankVars(copy('promotionBadgePercent', '-{value}%'), promotion.percentOff)
            : copy('promotionBadge', 'Promo'),
    })
  }

  if (config?.showTopSellerBadge && topSellerRank > 0 && topSellerRank <= rankLimit) {
    badges.push({
      key: 'top-seller',
      tone: 'amber',
      rank: topSellerRank,
      label: normalizeRankBadgeLabel(copy('topSellerBadge', 'Top Seller')),
    })
  }

  if (
    config?.showTopProductBadge
    && topProductRank > 0
    && topProductRank <= rankLimit
    && !(config?.showTopSellerBadge && topSellerRank > 0 && topSellerRank <= rankLimit)
  ) {
    badges.push({
      key: 'top-product',
      tone: 'blue',
      rank: topProductRank,
      label: normalizeRankBadgeLabel(copy('topProductBadge', 'Top Product')),
    })
  }

  if (config?.showNewArrivalBadge && Number(product?.new_arrival_rank || 0) > 0 && Number(product.new_arrival_rank) <= rankLimit) {
    badges.push({
      key: 'new-arrival',
      tone: 'violet',
      label: copy('newArrivalBadge', 'New'),
    })
  }

  return badges.slice(0, 2)
}

function replaceRankVars(template: unknown, value: unknown): string {
  return String(template || '').replace(/\{value\}/g, String(value))
}

function normalizeRankBadgeLabel(template: unknown): string {
  return String(template || '')
    .replace(/\{value\}/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// G1 ordering rule for the portal grid: promoted products occupy the block
// above the alphabetical run (the A-Z rail indexes what comes after).
// Stable within both blocks; delegates the "is promoted" question to the
// shared kernel.
export function partitionPortalPromotedFirst<T extends PortalProduct>(
  products: readonly T[] = [],
  promotionRules: readonly PromotionRule[] = [],
): { promoted: T[]; rest: T[] } {
  const promoted: T[] = []
  const rest: T[] = []
  for (const product of products) {
    const hit = promotionRules.length ? isProductPromoted(product, promotionRules) : isProductDiscountActive(product)
    ;(hit ? promoted : rest).push(product)
  }
  return { promoted, rest }
}
