import { calculateProductDiscount, normalizePriceValue } from '../../utils/pricing.ts'
import { evaluatePromotionPricing, evaluateCartPromotionAdjustments, type PromotionRule } from '../../utils/promotionRules.ts'
import { buildProductGroups, compareProductsByNameBranchPriceBarcode } from '../../utils/productGrouping.ts'
import type { ProductRecord as ProductGroupRecord } from '../../utils/productGrouping.ts'
import { aggregateInitialOptions } from '../../utils/initials.ts'
import { todayStr } from '../../utils/dateHelpers.ts'

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
  // G1: the active promotion RULES ride along so 'promotion' mode charges
  // the best single benefit (the product's own discount OR a rule) via the
  // shared kernel. Callers that don't pass them keep the pre-G1 behavior
  // exactly (kernel with no rules = the per-product discount math).
  promotionRules: readonly PromotionRule[] = [],
): CartPriceValues {
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
export function repricePromotionCartLines(
  cart: readonly ProductRecord[] = [],
  promotionRules: readonly PromotionRule[] = [],
  exchangeRate = 0,
): { cart: ProductRecord[]; changed: boolean } {
  const list = Array.isArray(cart) ? cart : []
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
      const values = resolveCartPriceValues(item, 'selling', exchangeRate, converters)
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

    const values = resolveCartPriceValues(item, 'wholesale', exchangeRate, converters)
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
