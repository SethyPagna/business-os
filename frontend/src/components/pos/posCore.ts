import { calculateProductDiscount, normalizePriceValue } from '../../utils/pricing.js'
import { buildProductGroups } from '../../utils/productGrouping.mjs'
import type { ProductGroupRecord } from '../../utils/productGrouping.mjs'
import { aggregateInitialOptions } from '../../utils/initials.mjs'

type ProductRecord = ProductGroupRecord & {
  id?: unknown
  parent_id?: unknown
  special_price_usd?: unknown
  special_price_khr?: unknown
  selling_price_usd?: unknown
  selling_price_khr?: unknown
  discount_type?: unknown
  discount_label?: unknown
  branch_id?: unknown
  cart_line_id?: unknown
  price_mode?: unknown
}

type PriceConverters = {
  usdToKhr?: (value: unknown, rate: unknown) => number
}

type CartPriceMode = 'selling' | 'special' | 'promotion' | string

type CartPriceValues = {
  applied_price_usd: number
  applied_price_khr: number
  price_mode: 'selling' | 'special' | 'promotion'
  product_discount_type?: unknown
  product_discount_label?: unknown
  product_discount_usd?: number
  product_discount_khr?: number
}

type PosFilterMeta = {
  brands: unknown[]
  suppliers: unknown[]
  initials: unknown[]
}

type FindCartLineOptions = {
  productId?: unknown
  priceMode?: unknown
  branchId?: unknown
}

function normalizeNumber(value: unknown): number {
  return Number(value || 0)
}

export function buildProductsById(products: readonly ProductRecord[] = []): Map<number, ProductRecord> {
  const productsById = new Map<number, ProductRecord>()
  for (const product of Array.isArray(products) ? products : []) {
    const id = Number(product?.id)
    if (Number.isFinite(id) && id > 0) productsById.set(id, product)
  }
  return productsById
}

export function buildVariantChildrenByParentId(products: readonly ProductRecord[] = []): Map<number, ProductRecord[]> {
  const map = new Map<number, ProductRecord[]>()
  ;(Array.isArray(products) ? products : []).forEach((product) => {
    const parentId = Number(product?.parent_id || 0)
    if (!parentId) return
    if (!map.has(parentId)) map.set(parentId, [])
    map.get(parentId)?.push(product)
  })
  map.forEach((items) => items.sort((left, right) => String(left?.name || '').localeCompare(String(right?.name || ''), undefined, { sensitivity: 'base' })))
  return map
}

export function getVariantRootProduct(product: ProductRecord | null | undefined, productsById: Map<number, ProductRecord> = new Map()): ProductRecord | null {
  if (!product) return null
  const parentId = Number(product?.parent_id || 0)
  if (!parentId) return product
  return productsById.get(parentId) || product
}

export function buildVisibleProductCards(filteredProducts: readonly ProductRecord[] = [], productsById: Map<number, ProductRecord> = new Map()): ProductRecord[] {
  const cards: ProductRecord[] = []
  for (const group of buildProductGroups([...filteredProducts], productsById)) {
    const leadProduct = group.leadProduct || group.items?.[0] || null
    if (!leadProduct) continue
    cards.push({
      ...leadProduct,
      __displayName: group.name || leadProduct?.name || '',
      __groupKey: group.key,
      __groupMeta: group,
      __groupChoices: group.hasMultipleItems ? group.items : [],
    })
  }
  return cards
}

export function getVariantChoices(product: ProductRecord | null | undefined, variantChildrenByParentId: Map<number, ProductRecord[]> = new Map()): ProductRecord[] {
  if (Array.isArray(product?.__groupChoices) && product.__groupChoices.length) {
    return product.__groupChoices as ProductRecord[]
  }
  const rootId = Number(product?.id || 0)
  return variantChildrenByParentId.get(rootId) || []
}

export function buildPosFilterMeta(filters: Record<string, unknown> = {}, fallbackInitials: unknown[] = []): PosFilterMeta {
  return {
    brands: Array.isArray(filters?.brands) ? filters.brands : [],
    suppliers: Array.isArray(filters?.suppliers) ? filters.suppliers : [],
    initials: aggregateInitialOptions(filters?.initials || fallbackInitials || []),
  }
}

export function resolveCartPriceValues(
  product: ProductRecord | null | undefined,
  priceMode: CartPriceMode = 'selling',
  exchangeRate = 0,
  converters: PriceConverters = {},
): CartPriceValues {
  const usdToKhr = typeof converters.usdToKhr === 'function'
    ? converters.usdToKhr
    : ((value: unknown, rate: unknown) => normalizePriceValue((Number(value || 0) * Number(rate || 0)), 0))
  const usePromotion = priceMode === 'promotion'
  if (usePromotion) {
    const promotion = calculateProductDiscount(product || undefined, exchangeRate)
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
  const useSpecial = priceMode === 'special' && (normalizeNumber(product?.special_price_usd) > 0 || normalizeNumber(product?.special_price_khr) > 0)
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

export function getCartLineId(item: ProductRecord | null | undefined): string {
  return (
    String(item?.cart_line_id || '')
    || `${Number(item?.id || 0)}:${item?.price_mode || 'selling'}:${Number(item?.branch_id || 0)}`
  )
}

export function findMatchingCartLineIndex(cart: readonly ProductRecord[] = [], { productId, priceMode = 'selling', branchId = null }: FindCartLineOptions = {}): number {
  return (Array.isArray(cart) ? cart : []).findIndex((item) => (
    Number(item?.id) === Number(productId)
    && String(item?.price_mode || 'selling') === String(priceMode || 'selling')
    && Number(item?.branch_id || 0) === Number(branchId || 0)
  ))
}
