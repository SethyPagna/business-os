import { calculateProductDiscount } from '../../utils/pricing.js'

export function normalizeRecommendedProductIds(value) {
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
  const seen = new Set()
  const ids = []
  source.forEach((entry) => {
    const id = Number(entry)
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) return
    seen.add(id)
    ids.push(id)
  })
  return ids
}

export function getPortalGridClass(desktopColumns) {
  const normalized = Math.min(8, Math.max(2, Math.round(Number(desktopColumns || 4))))
  if (normalized === 2) return 'lg:grid-cols-2'
  if (normalized === 3) return 'lg:grid-cols-2 xl:grid-cols-3'
  if (normalized === 4) return 'lg:grid-cols-2 xl:grid-cols-4'
  if (normalized === 5) return 'lg:grid-cols-3 xl:grid-cols-5'
  if (normalized === 6) return 'lg:grid-cols-3 xl:grid-cols-6'
  if (normalized === 7) return 'lg:grid-cols-4 xl:grid-cols-7'
  return 'lg:grid-cols-4 xl:grid-cols-8'
}

export function getPortalMobileGridClass(mobileColumns) {
  const normalized = Math.min(3, Math.max(1, Math.round(Number(mobileColumns || 1))))
  if (normalized === 3) return 'grid-cols-3'
  if (normalized === 2) return 'grid-cols-2'
  return 'grid-cols-1'
}

export function productMatchesPortalBranches(product, branchFilter) {
  if (!Array.isArray(branchFilter) || !branchFilter.length) return true
  const branchStock = Array.isArray(product?.branch_stock) ? product.branch_stock : []
  return branchFilter.some((branchId) => (
    branchStock.some((entry) => String(entry?.branch_id) === String(branchId))
  ))
}

export function getPortalPromotionDetails(product) {
  const promotion = calculateProductDiscount(product)
  const active = promotion.active
  return {
    active,
    percentOff: Math.max(0, promotion.percent_off || 0),
    label: product?.discount_label || '',
    badgeColor: product?.discount_badge_color || '#e11d48',
    discountAmountUsd: promotion.discount_amount_usd || 0,
    discountAmountKhr: promotion.discount_amount_khr || 0,
  }
}

export function buildPortalPricePresentation(product, config, formatPortalPrice) {
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

export function buildPortalHighlightBadges(product, config, copy) {
  const badges = []
  const rankLimit = Math.max(1, Math.min(10, Number(config?.highlightRankLimit || 3)))
  const promotion = getPortalPromotionDetails(product)

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

  if (config?.showTopSellerBadge && Number(product?.top_seller_rank || 0) > 0 && Number(product.top_seller_rank) <= rankLimit) {
    badges.push({
      key: 'top-seller',
      tone: 'amber',
      rank: Number(product.top_seller_rank),
      label: replaceRankVars(copy('topSellerBadge', 'Top {value} Seller'), Number(product.top_seller_rank)),
    })
  }

  if (config?.showTopProductBadge && Number(product?.top_product_rank || 0) > 0 && Number(product.top_product_rank) <= rankLimit) {
    badges.push({
      key: 'top-product',
      tone: 'blue',
      rank: Number(product.top_product_rank),
      label: replaceRankVars(copy('topProductBadge', 'Top {value} Product'), Number(product.top_product_rank)),
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

function replaceRankVars(template, value) {
  return String(template || '').replace(/\{value\}/g, String(value))
}
