import { calculateProductDiscount, normalizePriceValue } from '../../utils/pricing.ts'
import { divideMoney4, multiplyMoney4, percentageMoney4, roundMoney2, roundMoney4, sellingPriceCeilCent, settlementRounding4, subtractMoney4, sumMoney4 } from '../../utils/moneyPrecision.ts'
import { evaluatePromotionPricing, evaluateCartPromotionAdjustments, type PromotionRule } from '../../utils/promotionRules.ts'
import { capturePricingProduct, evaluateCapturedPricingPool, type CapturedPricingPool, type ExactLinePricing, type PricingSource } from '../../utils/saleItemPricing.ts'
import { buildProductGroups, compareProductsByNameBranchPriceBarcode } from '../../utils/productGrouping.ts'
import type { ProductRecord as ProductGroupRecord } from '../../utils/productGrouping.ts'
import { aggregateInitialOptions } from '../../utils/initials.ts'
import { todayStr } from '../../utils/dateHelpers.ts'
import { lotCodeToIsoDate } from '../../utils/batchLabel.ts'

/** Raw draft text is retained by the input; only valid nonnegative decimals
 * enter a v1 calculation. In particular a sub-tick negative cannot become 0. */
export function parsePosInternalAmount(value: unknown): number {
  const text = String(value ?? '').trim()
  if (!text) return 0
  if (text.startsWith('-')) throw new Error('invalid_money_input')
  return roundMoney4(text)
}

/** Physical tender is a different boundary from internal line accounting.
 * This helper is only for a new POS submission, never saved payment rows. */
export function posV1Tender(rows: readonly { method: string; usd: string; khr: string }[]) {
  const details = rows.map(row => {
    parsePosInternalAmount(row.usd); parsePosInternalAmount(row.khr)
    return { method: row.method.trim(), amount_usd: roundMoney2(row.usd.trim() || '0'), amount_khr: Math.round(Number(row.khr.trim() || '0')) }
  })
  return { details, paidUsd: sumMoney4(details.map(row => row.amount_usd)), paidKhr: sumMoney4(details.map(row => row.amount_khr)) }
}

/** New-cart preview only. A saved/frozen checkout never enters this helper. */
export function posV1BasketTotals(input: {
  lines: readonly { total_usd: number }[]; exchangeRate: number;
  discountType: string; discountPercent: unknown; discountUsd: unknown; discountKhr: unknown;
  membershipUsd: unknown; membershipKhr: unknown; taxPercent: unknown;
  feeUsd: unknown; customerPaysFee: boolean;
}) {
  if (!(input.exchangeRate > 0) || !Number.isFinite(input.exchangeRate)) throw new Error('invalid_money_input')
  const fromPair = (usd: unknown, khr: unknown) => {
    const usdValue = parsePosInternalAmount(usd), khrValue = parsePosInternalAmount(khr)
    return String(usd ?? '').trim() !== '' ? usdValue : divideMoney4(khrValue, input.exchangeRate)
  }
  const subtotalUsd = sumMoney4(input.lines.map(line => line.total_usd))
  const percent = String(input.discountPercent ?? '').trim() || '0'
  if (input.discountType === 'percent' && (percent.startsWith('-') || !Number.isFinite(Number(percent)) || Number(percent) > 100)) throw new Error('invalid_money_input')
  const discUsd = input.discountType === 'percent' ? percentageMoney4(subtotalUsd, percent) : fromPair(input.discountUsd, input.discountKhr)
  const membershipDiscUsd = fromPair(input.membershipUsd, input.membershipKhr)
  const afterDiscUsd = subtractMoney4(subtractMoney4(subtotalUsd, discUsd), membershipDiscUsd)
  if (afterDiscUsd < 0) throw new Error('invalid_money_input')
  const taxPercent = String(input.taxPercent ?? '').trim() || '0'
  if (taxPercent.startsWith('-') || !Number.isFinite(Number(taxPercent)) || (afterDiscUsd === 0 && Number(taxPercent) > 0)) throw new Error('invalid_money_input')
  const taxUsd = percentageMoney4(afterDiscUsd, taxPercent)
  const feeUsd = parsePosInternalAmount(input.feeUsd)
  const calculatedTotalUsd = sumMoney4([afterDiscUsd, taxUsd, input.customerPaysFee ? feeUsd : 0])
  const rounding = settlementRounding4(calculatedTotalUsd)
  return { subtotalUsd, discUsd, membershipDiscUsd, afterDiscUsd, taxUsd, feeUsd, calculatedTotalUsd, rounding,
    totalUsd: rounding.payableTotal2, totalKhr: multiplyMoney4(rounding.payableTotal2, input.exchangeRate),
    subtotalKhr: multiplyMoney4(subtotalUsd, input.exchangeRate), discKhr: multiplyMoney4(discUsd, input.exchangeRate),
    membershipDiscKhr: multiplyMoney4(membershipDiscUsd, input.exchangeRate), taxKhr: multiplyMoney4(taxUsd, input.exchangeRate), feeKhr: multiplyMoney4(feeUsd, input.exchangeRate) }
}

/** Display an unresolved attempt's own quote; never treat it as a saved receipt
 * and never evaluate it against current catalogue/settings. */
export function frozenPosPreview(body: Record<string, unknown>) {
  if (body.money_precision_version !== 1 || !Array.isArray(body.items) || !body.items.length) throw new Error('money_checkout_recovery_required')
  const money = (value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || roundMoney4(value) !== value) throw new Error('money_checkout_recovery_required')
    return value
  }
  const rate = Number(body.exchange_rate)
  if (!(rate > 0) || !Number.isFinite(rate)) throw new Error('money_checkout_recovery_required')
  const lines = new Map<string, { total_usd: number; total_khr: number; manual_discount_usd: number }>()
  for (const item of body.items as Record<string, unknown>[]) {
    const key = String(item.client_line_key || ''), quote = item.pricing_quote as Record<string, unknown> | undefined
    if (!key || lines.has(key) || !quote) throw new Error('money_checkout_recovery_required')
    const total = money(quote.total_usd), khr = money(quote.total_khr), manual = money(quote.manual_discount_usd)
    if (subtractMoney4(subtractMoney4(money(quote.gross_usd), money(quote.product_discount_usd)), manual) !== total || multiplyMoney4(total, rate) !== khr) throw new Error('money_checkout_recovery_required')
    lines.set(key, { total_usd: total, total_khr: khr, manual_discount_usd: manual })
  }
  const subtotalUsd = money(body.subtotal_usd), discUsd = money(body.discount_usd), membershipDiscUsd = money(body.membership_discount_usd), taxUsd = money(body.tax_usd), feeUsd = money(body.delivery_fee_usd)
  if (sumMoney4([...lines.values()].map(line => line.total_usd)) !== subtotalUsd) throw new Error('money_checkout_recovery_required')
  const afterDiscUsd = subtractMoney4(subtractMoney4(subtotalUsd, discUsd), membershipDiscUsd)
  if (afterDiscUsd < 0) throw new Error('money_checkout_recovery_required')
  const calculatedTotalUsd = sumMoney4([afterDiscUsd, taxUsd, Number(body.is_delivery) && body.delivery_fee_paid_by === 'customer' ? feeUsd : 0])
  const rounding = settlementRounding4(calculatedTotalUsd), totalUsd = money(body.total_usd), totalKhr = money(body.total_khr)
  if (rounding.payableTotal2 !== totalUsd || multiplyMoney4(totalUsd, rate) !== totalKhr) throw new Error('money_checkout_recovery_required')
  return { lines, totals: { subtotalUsd, discUsd, membershipDiscUsd, taxUsd, feeUsd, afterDiscUsd, calculatedTotalUsd, rounding, totalUsd, totalKhr,
    subtotalKhr: money(body.subtotal_khr), discKhr: money(body.discount_khr), membershipDiscKhr: money(body.membership_discount_khr), taxKhr: money(body.tax_khr), feeKhr: money(body.delivery_fee_khr) } }
}

export type ProductRecord = ProductGroupRecord & {
  id?: unknown
  parent_id?: unknown
  // special_price_usd/khr are NOT declared: the 2026-09-04 ruling retired the
  // "VIP" tier and routes/products.ts no longer selects the columns, so the
  // field can never arrive. Declaring it would invite a read that silently
  // resolves to undefined on every product.
  wholesale_price_usd?: unknown
  wholesale_price_khr?: unknown
  selling_price_usd?: unknown
  selling_price_khr?: unknown
  discount_type?: unknown
  discount_label?: unknown
  branch_id?: unknown
  cart_line_id?: unknown
  price_mode?: unknown
  /**
   * Set by applyWholesaleAutoPricing on a line IT moved to the wholesale
   * tier, so the same pass can move it back when the quantity drops below
   * the threshold. Absent on a wholesale line the cashier picked by hand --
   * that distinction is the whole reason this flag exists.
   */
  wholesale_auto?: unknown
  /**
   * Set when the cashier tapped the cart's wholesale chip on this line. It
   * permanently excludes the line from applyWholesaleAutoPricing so a manual
   * decision is never overwritten by the threshold rule.
   */
  wholesale_auto_optout?: unknown
}

/**
 * Stock shown by POS for a product card or an existing cart line.
 *
 * A selected branch and an already-assigned cart line are branch-scoped. The
 * unfiltered catalogue is an all-branch view, so its card uses the product's
 * aggregate stock_quantity instead of choosing whichever single branch has
 * the most stock.
 */
export function resolvePosDisplayStock(
  product: ProductRecord | null | undefined,
  selectedBranchId?: string | number | null,
  cartBranchId?: string | number | null,
): number {
  if (!product) return 0
  const branchId = selectedBranchId != null && selectedBranchId !== ''
    ? selectedBranchId
    : cartBranchId != null && cartBranchId !== ''
      ? cartBranchId
      : null
  if (branchId == null) return Number(product.stock_quantity || 0)
  const numericBranchId = Number(branchId)
  if (!Number.isFinite(numericBranchId)) return 0
  const branchStock = Array.isArray(product.branch_stock)
    ? product.branch_stock as Array<Record<string, unknown>>
    : []
  const row = branchStock.find((entry) => Number(entry.branch_id) === numericBranchId)
  return row ? Number(row.quantity || 0) : 0
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
  // 'special' (the old VIP tier) is deliberately absent: after the
  // 2026-09-04 ruling this function can no longer produce it.
  price_mode: 'selling' | 'wholesale' | 'promotion'
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
  moneyPrecisionVersion: 0 | 1 = 0,
): ManualDiscountResult {
  if (moneyPrecisionVersion === 1) {
    const base = roundMoney4(basePriceUsd || 0)
    const rateValid = Number.isFinite(exchangeRate) && exchangeRate > 0
    if (base > 0 && !rateValid) throw new Error('A valid exchange rate is required for versioned line pricing.')
    const hasUsdBasis = base > 0 && rateValid
    const baseKhr = hasUsdBasis ? multiplyMoney4(base, exchangeRate) : roundMoney4(basePriceKhr || 0)
    const activeType = type && Number.isFinite(rawValue) && rawValue > 0 ? type : null
    const value = activeType === 'percent' ? Math.min(100, rawValue) : activeType === 'fixed' ? roundMoney4(Math.max(0, rawValue)) : 0
    const discount = Math.min(base, activeType === 'percent' ? percentageMoney4(base, value) : value)
    const applied = Math.max(0, subtractMoney4(base, discount))
    const appliedKhr = hasUsdBasis ? multiplyMoney4(applied, exchangeRate) : baseKhr
    return {
      manual_discount_type: activeType,
      manual_discount_value: value,
      manual_discount_usd: subtractMoney4(base, applied),
      manual_discount_khr: subtractMoney4(baseKhr, appliedKhr),
      applied_price_usd: applied,
      applied_price_khr: appliedKhr,
    }
  }
  const base = normalizePriceValue(basePriceUsd || 0, 0)
  // USD is the canonical price basis whenever it is present. A stale/zero
  // KHR value used to survive here, which made a perfectly valid USD-priced
  // line produce a negative manual_discount_khr after a discount was applied.
  // Keep the KHR-only path for legacy/catalog rows that genuinely have no USD
  // price, but otherwise derive both KHR values from the same exchange rate.
  const suppliedBaseKhr = normalizePriceValue(basePriceKhr || 0, 0)
  const hasUsdBasis = base > 0 && Number.isFinite(exchangeRate) && exchangeRate > 0
  const baseKhr = hasUsdBasis
    ? normalizePriceValue(base * exchangeRate, 0)
    : suppliedBaseKhr
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
  const appliedKhr = hasUsdBasis
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
  if (priceMode !== 'special' && priceMode !== 'wholesale' && priceMode !== 'promotion') return INACTIVE_CART_LINE_SAVINGS
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
  // Explicit unrecorded stock has no batch id, so it needs its own stable
  // intent discriminator. It must not merge with an ordinary unpicked line.
  unlottedStock?: boolean
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

// `preserveInputOrder` keeps the server's relevance ranking for the grid
// while a term is in the search box. `filteredProducts` is the ranked
// server page (POS sends `query` to /api/products/search, see
// loadCatalogData) put through a pure .filter(), so its order IS the
// ranking; buildProductGroups re-sorted it A-Z and scattered the closest
// match through the grid. With an empty box the grid is a browse list and
// keeps A-Z exactly as before. The AlphaIndexRail is unaffected either
// way -- it drives the server's `initial` filter, not this order.
export function buildVisibleProductCards(
  filteredProducts: readonly ProductRecord[] = [],
  productsById: Map<number, ProductRecord> = new Map(),
  { preserveInputOrder = false }: { preserveInputOrder?: boolean } = {},
): ProductRecord[] {
  const cards: ProductRecord[] = []
  for (const group of buildProductGroups([...filteredProducts], productsById, { preserveInputOrder })) {
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

// One shared, frozen instance instead of a fresh `[]` literal on every call
// with no match: ProductCard is React.memo'd (P4-4b) and receives this as
// its `variants` prop, so a "no variants" product must get the SAME empty
// array reference across renders or the memo's shallow prop comparison
// fails every time and the memo never actually skips a re-render.
const NO_VARIANT_CHOICES: ProductRecord[] = Object.freeze([] as ProductRecord[])

export function getVariantChoices(product: ProductRecord | null | undefined, variantChildrenByParentId: Map<number, ProductRecord[]> = new Map()): ProductRecord[] {
  if (Array.isArray(product?.__groupChoices) && product.__groupChoices.length) {
    return product.__groupChoices as ProductRecord[]
  }
  const rootId = Number(product?.id || 0)
  return variantChildrenByParentId.get(rootId) || NO_VARIANT_CHOICES
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
  // G1: the active promotion RULES ride along so 'promotion' mode charges
  // the best single benefit (the product's own discount OR a rule) via the
  // shared kernel. Callers that don't pass them keep the pre-G1 behavior
  // exactly (kernel with no rules = the per-product discount math).
  promotionRules: readonly PromotionRule[] = [],
  moneyPrecisionVersion: 0 | 1 = 0,
): CartPriceValues {
  if (moneyPrecisionVersion === 1) {
    const sellingUsd = sellingPriceCeilCent(Number(product?.selling_price_usd ?? 0))
    const sellingKhr = roundMoney4(Number(product?.selling_price_khr ?? multiplyMoney4(sellingUsd, exchangeRate)))
    if (priceMode === 'promotion') {
      const evaluated = evaluatePromotionPricing(product || undefined, 1, promotionRules, exchangeRate, new Date(), 1)
      return {
        applied_price_usd: evaluated.unit_price_usd, applied_price_khr: evaluated.unit_price_khr,
        base_price_usd: evaluated.unit_price_usd, base_price_khr: evaluated.unit_price_khr, price_mode: 'promotion',
        product_discount_type: evaluated.rule_type === 'product_discount' ? String(product?.discount_type || 'percent') : String(evaluated.rule_type || 'percent'),
        product_discount_label: evaluated.active && evaluated.show_title ? evaluated.title : '',
        product_discount_usd: Math.max(0, subtractMoney4(sellingUsd, evaluated.unit_price_usd)),
        product_discount_khr: Math.max(0, subtractMoney4(sellingKhr, evaluated.unit_price_khr)),
      }
    }
    const wholesale = priceMode === 'wholesale' && (Number(product?.wholesale_price_usd) > 0 || Number(product?.wholesale_price_khr) > 0)
    const usd = wholesale ? sellingPriceCeilCent(Number(product?.wholesale_price_usd ?? sellingUsd)) : sellingUsd
    const khr = wholesale ? roundMoney4(Number(product?.wholesale_price_khr ?? multiplyMoney4(usd, exchangeRate))) : sellingKhr
    return { applied_price_usd: usd, applied_price_khr: khr, base_price_usd: usd, base_price_khr: khr, price_mode: wholesale ? 'wholesale' : 'selling' }
  }
  const usdToKhr = typeof converters.usdToKhr === 'function'
    ? converters.usdToKhr
    : ((value: unknown, rate: unknown) => normalizePriceValue((Number(value || 0) * Number(rate || 0)), 0))
  const usePromotion = priceMode === 'promotion'
  if (usePromotion) {
    const evaluation = evaluatePromotionPricing(product || undefined, 1, promotionRules, exchangeRate || 4100)
    const sellingUsd = normalizePriceValue(product?.selling_price_usd || 0, 0)
    const sellingKhr = normalizePriceValue(product?.selling_price_khr || 0, 0)
    // 'promotion' mode is honored even when nothing cuts the QTY-1 price:
    // a "buy >= X save Y" line enters the cart at full price and the
    // repricePromotionCartLines pass drops it the moment quantity crosses
    // the threshold. (Pre-G1 this fell through to selling mode, which
    // would have made quantity rules permanently unreachable.) Callers
    // only offer the promotion button when SOME benefit exists, so an
    // arbitrary product can't be parked in promotion mode by accident.
    return {
      applied_price_usd: evaluation.active ? evaluation.unit_price_usd : sellingUsd,
      applied_price_khr: evaluation.active ? evaluation.unit_price_khr : sellingKhr,
      base_price_usd: evaluation.active ? evaluation.unit_price_usd : sellingUsd,
      base_price_khr: evaluation.active ? evaluation.unit_price_khr : sellingKhr,
      price_mode: 'promotion',
      product_discount_type: !evaluation.active
        ? String(product?.discount_type || 'percent')
        : evaluation.rule_type === 'product_discount'
          ? String(product?.discount_type || 'percent')
          : String(evaluation.rule_type || 'percent'),
      product_discount_label: evaluation.active && evaluation.show_title ? evaluation.title : '',
      product_discount_usd: evaluation.active ? Math.max(0, normalizePriceValue(sellingUsd - evaluation.unit_price_usd, 0)) : 0,
      product_discount_khr: evaluation.active ? Math.max(0, normalizePriceValue(sellingKhr - evaluation.unit_price_khr, 0)) : 0,
    }
  }
  // The VIP/'special' branch that used to sit here is GONE (2026-09-04
  // ruling): that tier was never a VIP price, it was the wholesale price
  // misnamed, and migration 0111 moved the numbers into wholesale_price_*
  // and zeroed special_price_*. There is now exactly ONE discounted tier.
  // A cart line that somehow still arrives carrying price_mode 'special'
  // (a till tab cached from before the deploy) falls through to selling
  // rather than pricing off a column that is now zero everywhere -- which
  // is the honest outcome: it charges full price instead of charging $0.
  const useWholesale = priceMode === 'wholesale' && (normalizeNumber(product?.wholesale_price_usd) > 0 || normalizeNumber(product?.wholesale_price_khr) > 0)
  if (useWholesale) {
    const appliedUsd = normalizePriceValue(product?.wholesale_price_usd ?? product?.selling_price_usd ?? 0, 0)
    const appliedKhr = normalizePriceValue(product?.wholesale_price_khr ?? product?.selling_price_khr ?? usdToKhr(appliedUsd, exchangeRate), 0)
    return {
      applied_price_usd: appliedUsd,
      applied_price_khr: appliedKhr,
      base_price_usd: appliedUsd,
      base_price_khr: appliedKhr,
      price_mode: 'wholesale',
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

// G1/G1b: promotion-mode lines re-evaluate on EVERY cart mutation --
// quantity thresholds engage/disengage, and next_item rules pair units
// ACROSS lines (buy N, the CHEAPEST item of each complete group takes
// the cut -- the user's "only lowest of the two" rule), so the whole
// promotion-mode subset evaluates as one cart through the kernel's
// evaluateCartPromotionAdjustments. Pure: returns the same array
// instance when nothing changed so callers can patch state without
// render loops. Lines in other price modes (selling/special, manual
// price edits) are never touched and never join the pairing pool.
export type SaleCartLineQuote = ExactLinePricing & {
  client_line_key: string
  pricing_source: PricingSource
  display_price_mode?: 'selling' | 'wholesale'
  selling_price_input_usd?: number
  pricing_quote: Pick<ExactLinePricing, 'gross_usd' | 'product_discount_usd' | 'manual_discount_usd' | 'total_usd' | 'total_khr'>
}

/** A client quote is expectation only. The server captures its own authorized
 * source/rule pool and refuses a mismatch; this object is never stored as proof. */
export function quoteSaleCartLines(cart: readonly ProductRecord[], rules: readonly PromotionRule[], exchangeRate: number, now: Date | string | number = new Date()): Map<string, SaleCartLineQuote> {
  if (!cart.length) return new Map()
  const lines = cart.map(item => {
    const record = item as Record<string, unknown>
    const product = record.pricing_product && typeof record.pricing_product === 'object' ? record.pricing_product as Record<string, unknown> : record
    const explicit = record.selling_price_input_usd
    const source: PricingSource = explicit != null ? 'manual' : record.price_mode === 'promotion' ? 'promotion' : record.price_mode === 'wholesale' ? 'wholesale' : 'selling'
    return { line_key: getCartLineId(item), source, product: { ...capturePricingProduct({ ...product, id: Number(record.id) }),
      selling_price_usd: sellingPriceCeilCent(Number(product.selling_price_usd)),
      wholesale_price_usd: product.wholesale_price_usd == null ? null : sellingPriceCeilCent(Number(product.wholesale_price_usd)) },
      selling_price_input_usd: explicit == null ? null : Number(explicit),
      ...(record.display_price_mode === 'selling' || record.display_price_mode === 'wholesale' ? { display_price_mode: record.display_price_mode as 'selling' | 'wholesale' } : {}),
      manual: { type: (record.manual_discount_type === 'percent' || record.manual_discount_type === 'fixed' ? record.manual_discount_type : 'none') as 'none' | 'percent' | 'fixed', value: Number(record.manual_discount_value ?? 0) } }
  })
  const pool: CapturedPricingPool = { version: 1, pool_key: 'client-quote', evaluation_time: new Date(now instanceof Date ? now.getTime() : now).toISOString(), exchange_rate: exchangeRate, rules: [...rules], lines }
  const amounts = evaluateCapturedPricingPool(pool, Object.fromEntries(cart.map(item => [getCartLineId(item), Number((item as Record<string, unknown>).quantity)])))
  return new Map(lines.map(line => {
    const amount = amounts.get(line.line_key)!
    return [line.line_key, { ...amount, client_line_key: line.line_key, pricing_source: line.source,
      ...(line.display_price_mode === 'selling' || line.display_price_mode === 'wholesale' ? { display_price_mode: line.display_price_mode } : {}),
      ...(line.selling_price_input_usd == null ? {} : { selling_price_input_usd: line.selling_price_input_usd }),
      pricing_quote: { gross_usd: amount.gross_usd, product_discount_usd: amount.product_discount_usd, manual_discount_usd: amount.manual_discount_usd, total_usd: amount.total_usd, total_khr: amount.total_khr } }]
  }))
}

export function repricePromotionCartLines(
  cart: readonly ProductRecord[] = [],
  promotionRules: readonly PromotionRule[] = [],
  exchangeRate = 0,
  moneyPrecisionVersion: 0 | 1 = 0,
): { cart: ProductRecord[]; changed: boolean } {
  const list = Array.isArray(cart) ? cart : []
  if (moneyPrecisionVersion === 1) {
    let quotes: Map<string, SaleCartLineQuote>
    try { quotes = quoteSaleCartLines(list, promotionRules, exchangeRate) }
    catch { return { cart: [...list], changed: false } }
    let changed = false
    const next = list.map(item => {
      const quote = quotes.get(getCartLineId(item))!
      const qty = Number((item as Record<string, unknown>).quantity)
      const fields = {
        base_price_usd: quote.base_price_usd, base_price_khr: quote.base_price_khr,
        applied_price_usd: quote.applied_price_usd, applied_price_khr: quote.applied_price_khr,
        product_discount_usd: divideMoney4(quote.product_discount_usd, qty),
        product_discount_khr: multiplyMoney4(divideMoney4(quote.product_discount_usd, qty), exchangeRate),
        manual_discount_usd: divideMoney4(quote.manual_discount_usd, qty),
        manual_discount_khr: multiplyMoney4(divideMoney4(quote.manual_discount_usd, qty), exchangeRate),
        total_usd: quote.total_usd, total_khr: quote.total_khr,
      }
      if (Object.entries(fields).every(([key, value]) => Object.is((item as Record<string, unknown>)[key], value))) return item
      changed = true
      return { ...item, ...fields } as ProductRecord
    })
    return { cart: changed ? next : [...cart], changed }
  }
  const promoLines = list
    .filter((item) => String(item?.price_mode || 'selling') === 'promotion')
    .map((item) => ({
      line_id: getCartLineId(item),
      product: item as Record<string, unknown>,
      quantity: Math.max(1, Number((item as Record<string, unknown>).quantity) || 1),
    }))
  const adjustments = evaluateCartPromotionAdjustments(promoLines, promotionRules, exchangeRate || 4100)
  let changed = false
  const next = list.map((item) => {
    if (String(item?.price_mode || 'selling') !== 'promotion') return item
    const adjustment = adjustments.get(getCartLineId(item))
    if (!adjustment) return item
    const sellingUsd = normalizePriceValue(item?.selling_price_usd || 0, 0)
    const sellingKhr = normalizePriceValue(item?.selling_price_khr || 0, 0)
    // Nothing active any more (rule expired/deleted, quantity fell under
    // the threshold, the pairing partner left the cart) -> the line
    // honestly returns to full selling price, never keeping a stale cut.
    const unitUsd = adjustment.active ? adjustment.unit_price_usd : sellingUsd
    const unitKhr = adjustment.active ? adjustment.unit_price_khr : sellingKhr
    const label = adjustment.active ? adjustment.label : ''
    const current = item as Record<string, unknown>
    if (
      normalizePriceValue(current.applied_price_usd, -1) === unitUsd
      && normalizePriceValue(current.applied_price_khr, -1) === unitKhr
      && String(current.product_discount_label || '') === label
    ) return item
    changed = true
    return {
      ...item,
      applied_price_usd: unitUsd,
      applied_price_khr: unitKhr,
      base_price_usd: unitUsd,
      base_price_khr: unitKhr,
      product_discount_type: !adjustment.active
        ? current.product_discount_type
        : adjustment.rule_type === 'product_discount'
          ? String(current.discount_type || 'percent')
          : String(adjustment.rule_type || 'percent'),
      product_discount_label: label,
      product_discount_usd: Math.max(0, normalizePriceValue(sellingUsd - unitUsd, 0)),
      product_discount_khr: Math.max(0, normalizePriceValue(sellingKhr - unitKhr, 0)),
    } as ProductRecord
  })
  return { cart: changed ? next : [...cart], changed }
}

// ---------------------------------------------------------------------------
// Wholesale auto-apply ("wholesale only > N")
// ---------------------------------------------------------------------------
//
// The sub-feature migration 0093 deferred ("The 'wholesale only > N' note and
// its default-off auto-apply toggle are a separate, still-being-specified
// sub-feature"). Now specified, by the owner's 2026-09-04 ruling: the shop
// sells wholesale above a quantity, so once a line's quantity crosses the
// threshold the line should price itself at the wholesale tier without the
// cashier having to remember to pick it.
//
// DEFAULT OFF. Both settings live in the ordinary `settings` key/value table
// under the sales-policy bucket, the same place `pos_show_item_discount` and
// `tax_rate` live, and are read with the same string conventions the rest of
// the app uses. Note the default here is 'false', NOT the 'true' default the
// notification toggles use -- an automation that silently changes what a
// customer is charged must be opted INTO, never inherited by a shop that
// upgraded without being asked.

export type WholesaleAutoRule = {
  enabled: boolean
  /** Wholesale applies STRICTLY ABOVE this quantity -- the "> N" in "wholesale only > N". */
  minQuantity: number
}

export const WHOLESALE_AUTO_ENABLED_KEY = 'pos_wholesale_auto_enabled'
export const WHOLESALE_AUTO_MIN_QTY_KEY = 'pos_wholesale_auto_min_qty'
export const WHOLESALE_AUTO_DEFAULT_MIN_QTY = 10

/**
 * Reads the two settings keys into a rule. Pure and total: any missing,
 * blank or malformed value yields the safe default (off, threshold 10), so a
 * shop that has never opened the setting behaves exactly as it did before
 * this feature existed.
 */
export function resolveWholesaleAutoRule(settings: Record<string, unknown> | null | undefined = {}): WholesaleAutoRule {
  const source = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {}
  // Strict === 'true': unlike the default-ON toggles elsewhere in the app,
  // anything unset/blank/garbled must read as OFF.
  const enabled = String(source[WHOLESALE_AUTO_ENABLED_KEY] ?? 'false').trim().toLowerCase() === 'true'
  const rawQty = String(source[WHOLESALE_AUTO_MIN_QTY_KEY] ?? '').trim()
  const parsed = Number.parseInt(rawQty, 10)
  // Floor of 1: a threshold of 0 would mean "every line is wholesale", which
  // is not a threshold at all and would quietly reprice the whole shop.
  const minQuantity = Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : WHOLESALE_AUTO_DEFAULT_MIN_QTY
  return { enabled, minQuantity }
}

/** True when this product actually has a wholesale price to fall back on. */
function hasWholesalePrice(item: ProductRecord | null | undefined): boolean {
  return normalizeNumber(item?.wholesale_price_usd) > 0 || normalizeNumber(item?.wholesale_price_khr) > 0
}

/**
 * Applies (and un-applies) the wholesale tier across a cart according to the
 * rule. Pure, and shaped exactly like repricePromotionCartLines: it returns
 * the same array instance when nothing changed so callers can patch state
 * without a render loop.
 *
 * Two invariants make this safe to run on EVERY cart mutation:
 *
 *  1. It only ever auto-upgrades a line that is in plain 'selling' mode with
 *     no manual price edit. A cashier who deliberately picked a tier, typed a
 *     price, or is running a promotion line is never overridden -- the
 *     automation assists the default path, it does not seize the cart.
 *  2. Every line it upgrades is stamped `wholesale_auto: true`. Only lines
 *     carrying that stamp are ever downgraded again, so lowering the quantity
 *     reverses the automation's own work and NOTHING ELSE. A wholesale line
 *     the cashier chose by hand has no stamp and survives untouched, which is
 *     the difference between an automation and a bug.
 */
export function applyWholesaleAutoPricing(
  cart: readonly ProductRecord[] = [],
  rule: WholesaleAutoRule = { enabled: false, minQuantity: WHOLESALE_AUTO_DEFAULT_MIN_QTY },
  exchangeRate = 0,
  converters: PriceConverters = {},
  moneyPrecisionVersion: 0 | 1 = 0,
): { cart: ProductRecord[]; changed: boolean } {
  const list = Array.isArray(cart) ? cart : []
  let changed = false

  const next = list.map((item) => {
    const record = item as Record<string, unknown>
    const mode = String(item?.price_mode || 'selling')
    const quantity = Math.max(1, Number(record.quantity) || 1)
    const autoApplied = record.wholesale_auto === true
    const overThreshold = quantity > rule.minQuantity
    // The cashier has taken manual control of this line's tier (they tapped
    // the cart's wholesale chip). Never touch it again in either direction --
    // without this the automation and the chip fight each other: the tap
    // drops the line to 'selling', the next pass sees it is still over the
    // threshold and puts it straight back, and the button looks broken.
    if (record.wholesale_auto_optout === true) return item

    // --- downgrade: our own stamp, and the reason for it is gone -----------
    // Covers the toggle being switched off, the threshold being raised, the
    // quantity falling back, and the product losing its wholesale price.
    if (autoApplied && (!rule.enabled || !overThreshold || !hasWholesalePrice(item))) {
      const values = resolveCartPriceValues(item, 'selling', exchangeRate, converters, [], moneyPrecisionVersion)
      changed = true
      return {
        ...item,
        applied_price_usd: values.applied_price_usd,
        applied_price_khr: values.applied_price_khr,
        base_price_usd: values.base_price_usd,
        base_price_khr: values.base_price_khr,
        price_mode: 'selling',
        wholesale_auto: false,
      } as ProductRecord
    }

    if (!rule.enabled || autoApplied) return item

    // --- upgrade -----------------------------------------------------------
    // 'selling' only. A manual price edit (a manual discount of any kind)
    // disqualifies the line: the cashier has already said what this costs.
    const hasManualEdit = record.manual_discount_type != null && String(record.manual_discount_type || '') !== ''
    if (mode !== 'selling' || hasManualEdit || !overThreshold || !hasWholesalePrice(item)) return item

    const values = resolveCartPriceValues(item, 'wholesale', exchangeRate, converters, [], moneyPrecisionVersion)
    // resolveCartPriceValues refuses 'wholesale' when there is no wholesale
    // price and hands back a selling-priced result; hasWholesalePrice already
    // guarantees otherwise, but check rather than stamp a line we did not
    // actually move.
    if (values.price_mode !== 'wholesale') return item
    changed = true
    return {
      ...item,
      applied_price_usd: values.applied_price_usd,
      applied_price_khr: values.applied_price_khr,
      base_price_usd: values.base_price_usd,
      base_price_khr: values.base_price_khr,
      price_mode: 'wholesale',
      wholesale_auto: true,
    } as ProductRecord
  })

  return { cart: changed ? next : [...cart], changed }
}

export function getCartLineId(item: ProductRecord | null | undefined): string {
  return (
    String(item?.cart_line_id || '')
    || `${Number(item?.id || 0)}:${item?.price_mode || 'selling'}:${Number(item?.branch_id || 0)}`
  )
}

export function findMatchingCartLineIndex(cart: readonly ProductRecord[] = [], { productId, priceMode = 'selling', branchId = null, batchId = null, unlottedStock = false }: FindCartLineOptions = {}): number {
  return (Array.isArray(cart) ? cart : []).findIndex((item) => (
    Number(item?.id) === Number(productId)
    && String(item?.price_mode || 'selling') === String(priceMode || 'selling')
    && Number(item?.branch_id || 0) === Number(branchId || 0)
    && Number((item as { batch_id?: unknown })?.batch_id || 0) === Number(batchId || 0)
    && Boolean((item as { unlotted_stock?: unknown })?.unlotted_stock) === unlottedStock
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

// ---------------------------------------------------------------------------
// Lot / received-date picker order
// ---------------------------------------------------------------------------

// Only the fields the POS picker orders on. Deliberately structural (not
// `ProductBatch` from batchesTransport.ts) so this stays a pure, directly
// unit-testable comparator with no transport import.
export type PickerBatchLike = {
  lot_code?: string | null
  received_at?: string | null
  batch_number?: number | null
  quantity?: unknown
}

// A `received_at` as stored by D1 ("YYYY-MM-DD HH:MM:SS", UTC, no offset)
// turned into a sortable instant. Same "add a T, assume Z" treatment
// batchLabel.ts's formatBatchReceivedDate uses for DISPLAY -- but a
// date-only value ("2026-08-24") is handled explicitly, because
// `"2026-08-24" + "Z"` is not a parseable date and would otherwise make a
// perfectly good received date sort as "no date at all".
function parseReceivedInstant(receivedAt: unknown): number | null {
  const raw = String(receivedAt ?? '').trim()
  if (!raw) return null
  const hasClockTime = /\d{1,2}:\d{2}/.test(raw)
  const isoish = raw.includes('T')
    ? raw
    : (hasClockTime ? `${raw.replace(' ', 'T')}Z` : `${raw}T00:00:00Z`)
  const ms = Date.parse(isoish)
  return Number.isFinite(ms) ? ms : null
}

/**
 * The instant one lot was received, for ordering purposes -- the same
 * information batchLabel.ts's batchDisplayLabel puts on the pill, in the
 * same precedence: the stored `received_at` wins, else a lot code that is
 * really an MMDDYYYY date wearing a code's clothes (dateToBatchCode's
 * output) decoded back to a date. Returns null when neither is usable --
 * a blank/malformed `received_at` and a genuine custom lot code (including
 * production's synthetic `RECON-<productId>` codes) both land here, and
 * the comparator below sorts those AFTER every dated lot rather than
 * pretending they were received at epoch 0.
 */
export function batchReceivedInstant(batch: PickerBatchLike | null | undefined): number | null {
  const stored = parseReceivedInstant(batch?.received_at)
  if (stored != null) return stored
  // ISO, not the display string: lot ORDERING must not depend on how dates
  // happen to be rendered today. See lotCodeToIsoDate for what went wrong
  // when it did.
  const iso = lotCodeToIsoDate(batch?.lot_code)
  if (!iso) return null
  const [yyyy, mm, dd] = iso.split('-').map((part) => Number(part))
  if (!Number.isFinite(mm) || !Number.isFinite(dd) || !Number.isFinite(yyyy)) return null
  return Date.UTC(yyyy, mm - 1, dd)
}

function compareBatchNumber(left: unknown, right: unknown): number {
  const leftNumber = Number(left)
  const rightNumber = Number(right)
  const leftOk = Number.isFinite(leftNumber) && leftNumber > 0
  const rightOk = Number.isFinite(rightNumber) && rightNumber > 0
  if (leftOk !== rightOk) return leftOk ? -1 : 1
  if (leftOk && rightOk && leftNumber !== rightNumber) return leftNumber - rightNumber
  return 0
}

/**
 * The order the POS lot picker lists lots in, per S4-18's ruling (the owner's
 * exact words): "earliest to latest, with available first, not split into
 * available/unavailable sections". A first pass at this (9c282599) read
 * "available first" as a hard partition -- every available lot, oldest to
 * newest, THEN every empty lot, oldest to newest, "never interleaved" -- which
 * is precisely the two-block grouping the ruling's own "not split into
 * sections" clause forbids: an old empty lot could push a fresher available
 * one down a whole screen. Date is now the single dominant key; availability
 * only breaks a tie the date can't. It is a tie-break, not a section, so it
 * only ever fires between lots that would otherwise print in the same slot.
 *
 * The server's own list order (lib/productBatches.ts's
 * listBatchesForProduct) is soonest-expiry-first FIFO, which interleaves
 * empty lots among sellable ones -- correct for the inventory/allocation
 * surfaces that consume it, wrong for a cashier who is choosing something
 * to sell right now. This re-orders for the picker only; nothing about the
 * server's FIFO allocation changes.
 *
 * Ordering, in full:
 *  1. lots WITH a usable received date before those without (an unknown
 *     date can't be placed on a timeline, so it can't outrank a real one),
 *  2. that date ascending -- earliest received first, ACROSS availability:
 *     an empty lot from last week still lists ahead of a fresh one today,
 *  3. on an exact date tie (including two undated lots) available breaks
 *     before unavailable -- this is the only place "available first" acts,
 *  4. batch_number ascending (a numbered lot before an unnumbered one),
 *  5. the incoming order, so the server's expiry-first FIFO survives as the
 *     tie-break and the sort stays stable.
 *
 * Undated/`RECON-…` lots (~9,921 rows, tracked separately by S4-19 for a
 * rename to a real `ADJ<date>` lot code) therefore cluster at the end, tied
 * against each other and broken by availability, rather than being scattered
 * by an epoch-0 date or hidden below every dated lot regardless of stock.
 */
export function sortBatchesForPicker<T extends PickerBatchLike>(batches: readonly T[] = []): T[] {
  const rows = Array.isArray(batches) ? batches : []
  return rows
    .map((batch, index) => ({
      batch,
      index,
      instant: batchReceivedInstant(batch),
      available: Number(batch?.quantity || 0) > 0,
    }))
    .sort((left, right) => {
      const leftDated = left.instant != null
      const rightDated = right.instant != null
      if (leftDated !== rightDated) return leftDated ? -1 : 1
      if (leftDated && rightDated && left.instant !== right.instant) {
        return (left.instant as number) - (right.instant as number)
      }
      if (left.available !== right.available) return left.available ? -1 : 1
      const byNumber = compareBatchNumber(left.batch?.batch_number, right.batch?.batch_number)
      if (byNumber !== 0) return byNumber
      return left.index - right.index
    })
    .map((entry) => entry.batch)
}

// ---- Checkout result + guardrails -------------------------------------------

export type SaleCreateResult =
  | { id?: string | number | null; error?: string | null; success?: boolean }
  | null
  | undefined

// Was the sale actually recorded by the server?
//
// The create endpoint returns the SALE itself -- { id, receiptNumber, ... } on
// a fresh sale, { id, receiptNumber, duplicate } on a client_request_id dedupe
// hit -- and NEITHER carries a top-level `success` flag. Only the offline-queue
// path adds { success: true }. A real server error is a REJECTED promise from
// apiFetch (non-2xx throws), so it never reaches this predicate at all.
//
// The old check was `if (result.success)`, which is undefined on every online
// sale -- so a committed sale was treated as a failure: a generic error toast,
// no receipt, the order left open. That is the "POS shows an error but the sale
// still went through" report. A sale is recorded when the response came back
// with an id (or an explicit success) and carries no error.
export function isSaleRecorded(result: SaleCreateResult): boolean {
  if (!result || typeof result !== 'object') return false
  if (result.error) return false
  if (result.success === true) return true
  return result.id != null && result.id !== ''
}

export type CheckoutCartLine = {
  name?: string | null
  quantity?: unknown
  applied_price_usd?: unknown
}

export type CheckoutBlocker = { code: 'empty_cart' | 'invalid_quantity' | 'invalid_price' | 'invalid_total'; itemName?: string }

// Hard, unambiguous blockers that must stop a checkout before it is sent,
// regardless of sale status. Deliberately narrow so it never blocks a
// legitimate sale: a $0 line (a giveaway or a fully-discounted promo) is
// allowed; only a genuinely broken line -- a non-positive/NaN quantity, a
// negative/NaN price -- or a negative/NaN grand total is rejected. Returns the
// FIRST blocking issue found, or null when the cart is safe to submit. Paired
// with the success predicate above, this closes both directions of the report:
// an errored checkout never records a sale, and a recorded sale never shows an
// error.
export function findCheckoutBlocker(
  cart: readonly CheckoutCartLine[] = [],
  { totalUsd = 0 }: { totalUsd?: unknown } = {},
): CheckoutBlocker | null {
  if (!Array.isArray(cart) || cart.length === 0) return { code: 'empty_cart' }
  for (const item of cart) {
    const qty = Number(item?.quantity)
    if (!Number.isFinite(qty) || qty <= 0) return { code: 'invalid_quantity', itemName: item?.name || undefined }
    const price = Number(item?.applied_price_usd)
    if (!Number.isFinite(price) || price < 0) return { code: 'invalid_price', itemName: item?.name || undefined }
  }
  const total = Number(totalUsd)
  if (!Number.isFinite(total) || total < 0) return { code: 'invalid_total' }
  return null
}

// The USD->KHR exchange rate used for CHANGE handed back to the customer.
// Change money converts at its own rate, separate from the main rate used for
// everything else -- the same way loyalty redemption has its own rate
// (business rule, Aug 31 2026). Uses the dedicated rate only when the setting
// parses to a positive number; otherwise falls back to the main rate, so an
// unset / blank / zero / malformed setting silently behaves as "same as the
// main exchange rate".
export function resolveChangeExchangeRate(rawSetting: unknown, mainRate: number): number {
  const parsed = parseFloat(String(rawSetting ?? '').trim())
  return Number.isFinite(parsed) && parsed > 0 ? parsed : mainRate
}
