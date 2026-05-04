import { calculateProductDiscount, normalizePriceValue } from '../../utils/pricing.js'
import { buildProductGroups } from '../../utils/productGrouping.mjs'

export function buildProductsById(products = []) {
  return new Map((Array.isArray(products) ? products : []).map((product) => [Number(product?.id), product]))
}

export function buildVariantChildrenByParentId(products = []) {
  const map = new Map()
  ;(Array.isArray(products) ? products : []).forEach((product) => {
    const parentId = Number(product?.parent_id || 0)
    if (!parentId) return
    if (!map.has(parentId)) map.set(parentId, [])
    map.get(parentId).push(product)
  })
  map.forEach((items) => items.sort((left, right) => String(left?.name || '').localeCompare(String(right?.name || ''), undefined, { sensitivity: 'base' })))
  return map
}

export function getVariantRootProduct(product, productsById = new Map()) {
  if (!product) return null
  const parentId = Number(product?.parent_id || 0)
  if (!parentId) return product
  return productsById.get(parentId) || product
}

export function buildVisibleProductCards(filteredProducts = [], productsById = new Map()) {
  return buildProductGroups(filteredProducts, productsById).map((group) => {
    const leadProduct = group.leadProduct || group.items?.[0] || null
    return {
      ...leadProduct,
      __displayName: group.name || leadProduct?.name || '',
      __groupKey: group.key,
      __groupMeta: group,
      __groupChoices: group.hasMultipleItems ? group.items : [],
    }
  }).filter(Boolean)
}

export function getVariantChoices(product, variantChildrenByParentId = new Map()) {
  if (Array.isArray(product?.__groupChoices) && product.__groupChoices.length) {
    return product.__groupChoices
  }
  const rootId = Number(product?.id || 0)
  return variantChildrenByParentId.get(rootId) || []
}

export function resolveCartPriceValues(product, priceMode = 'selling', exchangeRate = 0, converters = {}) {
  const usdToKhr = typeof converters.usdToKhr === 'function'
    ? converters.usdToKhr
    : ((value, rate) => normalizePriceValue((Number(value || 0) * Number(rate || 0)), 0))
  const usePromotion = priceMode === 'promotion'
  if (usePromotion) {
    const promotion = calculateProductDiscount(product, exchangeRate)
    if (promotion.active) {
      return {
        applied_price_usd: promotion.applied_price_usd,
        applied_price_khr: promotion.applied_price_khr,
        price_mode: 'promotion',
        product_discount_type: product?.discount_type || 'percent',
        product_discount_label: product?.discount_label || '',
        product_discount_usd: promotion.discount_amount_usd,
        product_discount_khr: promotion.discount_amount_khr,
      }
    }
  }
  const useSpecial = priceMode === 'special' && ((product?.special_price_usd || 0) > 0 || (product?.special_price_khr || 0) > 0)
  if (useSpecial) {
    const appliedUsd = normalizePriceValue(product?.special_price_usd ?? product?.selling_price_usd ?? 0, 0)
    return {
      applied_price_usd: appliedUsd,
      applied_price_khr: normalizePriceValue(product?.special_price_khr ?? product?.selling_price_khr ?? usdToKhr(appliedUsd, exchangeRate), 0),
      price_mode: 'special',
    }
  }
  return {
    applied_price_usd: normalizePriceValue(product?.selling_price_usd || 0, 0),
    applied_price_khr: normalizePriceValue(product?.selling_price_khr || 0, 0),
    price_mode: 'selling',
  }
}

export function getCartLineId(item) {
  return (
    item?.cart_line_id
    || `${Number(item?.id || 0)}:${item?.price_mode || 'selling'}:${Number(item?.branch_id || 0)}`
  )
}

export function findMatchingCartLineIndex(cart = [], { productId, priceMode = 'selling', branchId = null } = {}) {
  return (Array.isArray(cart) ? cart : []).findIndex((item) => (
    Number(item?.id) === Number(productId)
    && String(item?.price_mode || 'selling') === String(priceMode || 'selling')
    && Number(item?.branch_id || 0) === Number(branchId || 0)
  ))
}
