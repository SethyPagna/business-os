import { calculateProductDiscount, normalizePriceValue } from '../../utils/pricing.ts'
import { buildProductGroups, compareProductsByNameBranchPriceBarcode } from '../../utils/productGrouping.ts'
import type { ProductRecord as ProductGroupRecord } from '../../utils/productGrouping.ts'
import { aggregateInitialOptions } from '../../utils/initials.ts'
import { todayStr } from '../../utils/dateHelpers.ts'

export type ProductRecord = ProductGroupRecord & {
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
  // The price before any manual, cashier-entered discount is applied --
  // i.e. the product/special/promotion price. Manual per-item discounts
  // (see applyManualDiscount below) are always computed against this, not
  // against applied_price_usd, so stacking edits (change branch, then
  // apply a discount, then change branch again) doesn't compound.
  base_price_usd: number
  base_price_khr: number
  price_mode: 'selling' | 'special' | 'promotion'
  product_discount_type?: string
  product_discount_label?: string
  product_discount_usd?: number
  product_discount_khr?: number
}

export type ManualDiscountType = 'percent' | 'fixed'

export type ManualDiscountResult = {
  manual_discount_type: ManualDiscountType | null
  manual_discount_value: number
  manual_discount_usd: number
  manual_discount_khr: number
  applied_price_usd: number
  applied_price_khr: number
}

/**
 * Computes a manual, per-item cart discount against a line's base price
 * (the special/promotion/selling price already resolved for it -- see
 * resolveCartPriceValues). Kept as a pure function so both the cart-edit
 * handler and checkout payload construction can share one source of truth,
 * and so it's directly unit-testable without mounting POS.tsx.
 *
 * - 'percent': value is 0-100, clamped; discount = base * (value/100).
 * - 'fixed': value is a per-unit USD amount, clamped to [0, base_price_usd].
 *   The KHR-side discount is derived from the *resulting* applied price via
 *   the exchange rate, not by re-converting the discount amount itself, so
 *   applied_price_khr always stays internally consistent with
 *   applied_price_usd (base_khr - discount_khr === applied_khr exactly).
 */
export function applyManualDiscount(
  basePriceUsd: number,
  basePriceKhr: number,
  exchangeRate: number,
  type: ManualDiscountType | null | undefined,
  rawValue: number,
): ManualDiscountResult {
  const base = normalizePriceValue(basePriceUsd || 0, 0)
  const baseKhr = normalizePriceValue(basePriceKhr || 0, 0)
  if (!type || !Number.isFinite(rawValue) || rawValue <= 0) {
    return {
      manual_discount_type: null,
      manual_discount_value: 0,
      manual_discount_usd: 0,
      manual_discount_khr: 0,
      applied_price_usd: base,
      applied_price_khr: baseKhr,
    }
  }
  const value = type === 'percent' ? Math.min(100, Math.max(0, rawValue)) : Math.max(0, rawValue)
  const discountUsd = type === 'percent'
    ? normalizePriceValue(base * (value / 100), 0)
    : Math.min(value, base)
  const appliedUsd = normalizePriceValue(Math.max(0, base - discountUsd), 0)
  const appliedKhr = exchangeRate > 0
    ? normalizePriceValue(appliedUsd * exchangeRate, 0)
    : normalizePriceValue(Math.max(0, baseKhr - discountUsd * (baseKhr / (base || 1))), 0)
  return {
    manual_discount_type: type,
    manual_discount_value: value,
    manual_discount_usd: normalizePriceValue(base - appliedUsd, 0),
    manual_discount_khr: normalizePriceValue(baseKhr - appliedKhr, 0),
    applied_price_usd: appliedUsd,
    applied_price_khr: appliedKhr,
  }
}

// Shape needed to compute a cart line's product-level savings (special
// price or promotion vs. the plain selling price) -- deliberately a local,
// minimal type rather than CartLineRecord (defined in POS.tsx) so this stays
// importable/testable without pulling in POS.tsx's much larger type surface.
type CartLineSavingsInput = {
  price_mode?: unknown
  selling_price_usd?: unknown
  selling_price_khr?: unknown
  base_price_usd?: unknown
  base_price_khr?: unknown
  applied_price_usd?: unknown
  applied_price_khr?: unknown
}

export type CartLineSavings = {
  active: boolean
  compare_at_usd: number
  compare_at_khr: number
  savings_usd: number
  savings_khr: number
  savings_percent: number
}

const INACTIVE_CART_LINE_SAVINGS: CartLineSavings = {
  active: false,
  compare_at_usd: 0,
  compare_at_khr: 0,
  savings_usd: 0,
  savings_khr: 0,
  savings_percent: 0,
}

/**
 * Computes the "was $X, save $Y (Z%)" figures for one cart line, so the cart
 * can show a product-level discount (special price or an active promotion)
 * all the way through checkout, not just a plain-text label. Compares the
 * line's ordinary selling price against its resolved base price (the
 * special/promotion price *before* any further manual, cashier-entered
 * discount -- see resolveCartPriceValues/applyManualDiscount above), so
 * editing the price manually afterward doesn't change what this reports:
 * the manual edit is a separate, already-visible adjustment.
 * Inactive (all zeros) for plain 'selling'-priced lines, or when there's no
 * real saving (e.g. a "special" price that isn't actually lower).
 */
export function computeCartLineSavings(item: CartLineSavingsInput | null | undefined): CartLineSavings {
  const priceMode = String(item?.price_mode || 'selling')
  if (priceMode !== 'special' && priceMode !== 'promotion') return INACTIVE_CART_LINE_SAVINGS
  const compareAtUsd = normalizePriceValue(item?.selling_price_usd || 0, 0)
  const compareAtKhr = normalizePriceValue(item?.selling_price_khr || 0, 0)
  const baseUsd = normalizePriceValue((item?.base_price_usd ?? item?.applied_price_usd) || 0, 0)
  const baseKhr = normalizePriceValue((item?.base_price_khr ?? item?.applied_price_khr) || 0, 0)
  if (compareAtUsd <= 0 || compareAtUsd <= baseUsd) return INACTIVE_CART_LINE_SAVINGS
  const savingsUsd = normalizePriceValue(compareAtUsd - baseUsd, 0)
  const savingsKhr = Math.max(0, normalizePriceValue(compareAtKhr - baseKhr, 0))
  return {
    active: true,
    compare_at_usd: compareAtUsd,
    compare_at_khr: compareAtKhr,
    savings_usd: savingsUsd,
    savings_khr: savingsKhr,
    savings_percent: compareAtUsd > 0 ? Math.round((savingsUsd / compareAtUsd) * 100) : 0,
  }
}

export type ExpiryStatus = 'expired' | 'expiring' | 'ok'

export type ExpiryInfo = {
  daysRemaining: number
  status: ExpiryStatus
}

/**
 * Days remaining until a product's (flat, non-batch) expiry_date, and
 * whether that's already expired or inside its own expiry_alert_days
 * window -- same "expired" (red) / "expiring soon" (yellow) / ok (neutral)
 * convention used elsewhere in the app (Dashboard's expiry-alerts widget).
 * Returns null when there's no expiry_date to evaluate. `todayDateStr`
 * defaults to the real business-timezone today (see dateHelpers.ts) but is
 * an explicit param so this stays a pure, unit-testable function rather
 * than depending on the current wall-clock time inside the calculation.
 */
export function computeExpiryStatus(
  expiryDate: string | null | undefined,
  alertDays: unknown = 30,
  todayDateStr: string = todayStr(),
): ExpiryInfo | null {
  if (!expiryDate) return null
  const expiryMs = Date.parse(`${expiryDate}T00:00:00`)
  const todayMs = Date.parse(`${todayDateStr}T00:00:00`)
  if (!Number.isFinite(expiryMs) || !Number.isFinite(todayMs)) return null
  const daysRemaining = Math.round((expiryMs - todayMs) / 86400000)
  const alertWindow = Number.isFinite(Number(alertDays)) && Number(alertDays) > 0 ? Number(alertDays) : 30
  const status: ExpiryStatus = daysRemaining < 0 ? 'expired' : daysRemaining <= alertWindow ? 'expiring' : 'ok'
  return { daysRemaining, status }
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
  // Present only for batch-tracked products (see batchesTransport.ts's
  // BatchSelection). Two lines for the same product/price/branch but
  // different lots must stay separate cart lines -- each is capped at a
  // different lot's remaining stock -- so batchId participates in the
  // match just like productId/priceMode/branchId do. Non-batch lines
  // always pass/compare undefined here, unaffected.
  batchId?: unknown
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
  // name -> branch -> price -> barcode, same order as the family/group sort
  // in productGrouping.ts's compareProducts -- see getPrimaryBranchLabel
  // there for what "branch" means for a product with a branch_stock array.
  map.forEach((items) => items.sort((left, right) => compareProductsByNameBranchPriceBarcode(left, right)))
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
  const initials = Array.isArray(filters?.initials) ? filters.initials : fallbackInitials
  return {
    brands: Array.isArray(filters?.brands) ? filters.brands : [],
    suppliers: Array.isArray(filters?.suppliers) ? filters.suppliers : [],
    initials: aggregateInitialOptions(initials),
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
        base_price_usd: promotion.applied_price_usd,
        base_price_khr: promotion.applied_price_khr,
        price_mode: 'promotion',
        product_discount_type: String(product?.discount_type || 'percent'),
        product_discount_label: String(product?.discount_label || ''),
        product_discount_usd: promotion.discount_amount_usd,
        product_discount_khr: promotion.discount_amount_khr,
      }
    }
  }
  const useSpecial = priceMode === 'special' && (normalizeNumber(product?.special_price_usd) > 0 || normalizeNumber(product?.special_price_khr) > 0)
  if (useSpecial) {
    const appliedUsd = normalizePriceValue(product?.special_price_usd ?? product?.selling_price_usd ?? 0, 0)
    const appliedKhr = normalizePriceValue(product?.special_price_khr ?? product?.selling_price_khr ?? usdToKhr(appliedUsd, exchangeRate), 0)
    return {
      applied_price_usd: appliedUsd,
      applied_price_khr: appliedKhr,
      base_price_usd: appliedUsd,
      base_price_khr: appliedKhr,
      price_mode: 'special',
    }
  }
  const sellingUsd = normalizePriceValue(product?.selling_price_usd || 0, 0)
  const sellingKhr = normalizePriceValue(product?.selling_price_khr || 0, 0)
  return {
    applied_price_usd: sellingUsd,
    applied_price_khr: sellingKhr,
    base_price_usd: sellingUsd,
    base_price_khr: sellingKhr,
    price_mode: 'selling',
  }
}

export function getCartLineId(item: ProductRecord | null | undefined): string {
  return (
    String(item?.cart_line_id || '')
    || `${Number(item?.id || 0)}:${item?.price_mode || 'selling'}:${Number(item?.branch_id || 0)}`
  )
}

export function findMatchingCartLineIndex(cart: readonly ProductRecord[] = [], { productId, priceMode = 'selling', branchId = null, batchId = null }: FindCartLineOptions = {}): number {
  return (Array.isArray(cart) ? cart : []).findIndex((item) => (
    Number(item?.id) === Number(productId)
    && String(item?.price_mode || 'selling') === String(priceMode || 'selling')
    && Number(item?.branch_id || 0) === Number(branchId || 0)
    && Number((item as { batch_id?: unknown })?.batch_id || 0) === Number(batchId || 0)
  ))
}

// ---------------------------------------------------------------------------
// Group option labels
// ---------------------------------------------------------------------------

export type VariantOptionLabel = {
  /** Primary text on the pill -- what actually tells this row apart. */
  label: string
  /** Secondary text, shown smaller, when a second detail also differs. */
  hint: string | null
}

export type VariantOptionLabelSet = {
  /** Heading for the option step, naming what the choice is actually between. */
  stepTitle: 'Barcode' | 'Price' | 'Option'
  byId: Map<string, VariantOptionLabel>
}

function optionCents(value: unknown): number {
  return Math.round((Number(value) || 0) * 100)
}

function optionBarcode(value: unknown): string {
  return String(value ?? '').trim()
}

/**
 * Works out how to label each row inside one name group so a cashier can
 * actually tell the options apart.
 *
 * This exists because the option step used to hardcode "Barcode" and print
 * `variant.barcode` on every pill. Under the identity rule (details =
 * barcode + cost) two rows in a group can share a barcode -- which rendered
 * as TWO IDENTICAL PILLS with nothing to choose between them. That is the
 * "display shows different data than the options actually are" problem.
 *
 * COST IS NEVER SHOWN (11.9): cost is not a cashier-facing field, so the
 * pills disambiguate by what a cashier legitimately sees -- barcode, then the
 * SELLING price. Barcode varies -> show barcodes. Barcodes shared but selling
 * prices differ -> show the selling prices (the customer-facing number, and
 * what actually changes the sale). Both vary -> barcode with the price as a
 * hint. Neither varies -> fall back to the row's own sku/id so the pills stay
 * distinguishable rather than silently identical (which lot's COGS a sale
 * draws from is settled by the batch picker, not by making the cashier read a
 * cost). rows that differ ONLY by cost therefore collapse to a neutral label
 * here on purpose -- the cashier should never be choosing on cost.
 */
export function buildVariantOptionLabels(
  candidates: readonly ProductRecord[] = [],
  formatPrice: (value: number) => string = (value) => `$${value.toFixed(2)}`,
): VariantOptionLabelSet {
  const rows = Array.isArray(candidates) ? candidates : []
  const barcodes = new Set(rows.map((row) => optionBarcode(row?.barcode)))
  const prices = new Set(rows.map((row) => optionCents((row as { selling_price_usd?: unknown })?.selling_price_usd)))
  const barcodeVaries = barcodes.size > 1
  const priceVaries = prices.size > 1

  const byId = new Map<string, VariantOptionLabel>()
  for (const row of rows) {
    const barcode = optionBarcode(row?.barcode)
    const price = Number((row as { selling_price_usd?: unknown })?.selling_price_usd) || 0
    let label: string
    let hint: string | null = null
    if (barcodeVaries) {
      label = barcode || String(row?.sku || '') || 'No barcode'
      if (priceVaries) hint = formatPrice(price)
    } else if (priceVaries) {
      label = formatPrice(price)
    } else {
      // Neither barcode nor selling price distinguishes these rows (and cost is
      // never shown). The shared barcode would render as identical pills, so
      // fall back to the row's own id, which is guaranteed unique.
      label = `#${row?.id ?? '?'}`
    }
    byId.set(String(row?.id), { label, hint })
  }

  const stepTitle: VariantOptionLabelSet['stepTitle'] = barcodeVaries
    ? 'Barcode'
    : (priceVaries ? 'Price' : 'Option')
  return { stepTitle, byId }
}
