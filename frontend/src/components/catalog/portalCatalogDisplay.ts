import { calculateProductDiscount } from '../../utils/pricing.ts'

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
}

type PortalCopy = (key: string, fallback: string) => string
type PortalPriceFormatter = (usd: unknown, khr: unknown, config: PortalDisplayConfig) => string

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
  const normalized = Math.min(3, Math.max(1, Math.round(Number(mobileColumns || 1))))
  if (normalized === 3) return 'grid-cols-3'
  if (normalized === 2) return 'grid-cols-2'
  return 'grid-cols-1'
}

export function productMatchesPortalBranches(product: PortalProduct = {}, branchFilter: unknown): boolean {
  if (!Array.isArray(branchFilter) || !branchFilter.length) return true
  const branchStock = Array.isArray(product?.branch_stock) ? product.branch_stock : []
  return branchFilter.some((branchId) => (
    branchStock.some((entry) => String((entry as PortalProduct | null | undefined)?.branch_id) === String(branchId))
  ))
}

export function getPortalPromotionDetails(product: PortalProduct = {}): PortalPromotionDetails {
  const promotion = calculateProductDiscount(product)
  const active = promotion.active
  return {
    active,
    percentOff: Math.max(0, promotion.percent_off || 0),
    label: String(product?.discount_label || ''),
    badgeColor: String(product?.discount_badge_color || '#e11d48'),
    discountAmountUsd: promotion.discount_amount_usd || 0,
    discountAmountKhr: promotion.discount_amount_khr || 0,
  }
}

export function buildPortalPricePresentation(
  product: PortalProduct = {},
  config: PortalDisplayConfig = {},
  formatPortalPrice: PortalPriceFormatter,
) {
  const promotion = getPortalPromotionDetails(product)
  const discounted = calculateProductDiscount(product)
  const activeUsd = promotion.active ? discounted.applied_price_usd : Number(product?.selling_price_usd || 0)
  const activeKhr = promotion.active ? discounted.applied_price_khr : Number(product?.selling_price_khr || 0)
  return {
    primaryText: formatPortalPrice(activeUsd, activeKhr, config),
    originalText: promotion.active
      ? formatPortalPrice(product?.selling_price_usd, product?.selling_price_khr, config)
      : '',
    promotion,
  }
}

export function buildPortalHighlightBadges(
  product: PortalProduct = {},
  config: PortalDisplayConfig = {},
  copy: PortalCopy,
) {
  const badges: Array<Record<string, unknown>> = []
  const rankLimit = Math.max(1, Math.min(10, Number(config?.highlightRankLimit || 3)))
  const promotion = getPortalPromotionDetails(product)
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
      label: promotion.percentOff >= 5
        ? replaceRankVars(copy('promotionBadgePercent', '-{value}%'), promotion.percentOff)
        : promotion.label || copy('promotionBadge', 'Promo'),
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
