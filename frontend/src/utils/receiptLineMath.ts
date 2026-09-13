/**
 * Receipt line arithmetic, kept out of Receipt.tsx so it can be executed by a
 * test rather than only pattern-matched. The component has JSX, which the test
 * runner cannot import.
 *
 * THE RULE (owner, Sep 4 2026): "products show selling price and minus the
 * discounts in total show selling price (-discount), not discounted
 * price(-discount)".
 *
 * So a line prints its SELLING price with the saving beside it. Since the
 * owner’s Sep-4 photo the line ALSO prints its net total in a fourth column,
 * and the per-line cut is reported in its own named row (Item Discount)
 * rather than folded into Subtotal and Discount -- see the note on the
 * four-column change in Receipt.tsx. The money is identical either way.
 *
 * What it was before: a line printed applied_price_usd (what was actually
 * charged) with the saving beside it, while Subtotal came from
 * sales.subtotal_usd, which is the sum of CHARGED line totals. So the per-line
 * cut appeared next to its line and then disappeared -- Subtotal already had it
 * removed, and the Discount row never mentioned it. Measured against
 * production: 24,085 lines across 11,974 sales, $99,534.40 of discount the
 * totals never showed.
 *
 * The total does not move. Both displayed figures shift by the same amount:
 *
 *     (subtotal + savings) - (discount + savings) = subtotal - discount
 *
 * which is what lets every historical receipt reprint to the same money, and is
 * why nothing here touches total_usd or the tax base.
 */

import { capturedDisplayPriceMode, capturedPricingMetadata, parseSaleItemPricing, SaleItemPricingError } from './saleItemPricing.ts'
import { divideMoney4, multiplyMoney4, sumMoney4 } from './moneyPrecision.ts'
import { serverPricingIdentityBindings } from './saleMoneyV1.ts'

export interface ReceiptLineInput {
  id?: number | string | null
  sale_id?: number | string | null
  product_id?: number | string | null
  pricing_snapshot_json?: string | null
  total_usd?: number | string | null
  total_khr?: number | string | null
  price_mode?: string | null
  product_discount_type?: string | null
  product_discount_label?: string | null
  quantity?: number | string | null
  applied_price_usd?: number | string | null
  applied_price_khr?: number | string | null
  price_usd?: number | string | null
  price_khr?: number | string | null
  price?: number | string | null
  base_price_usd?: number | string | null
  base_price_khr?: number | string | null
  product_discount_usd?: number | string | null
  product_discount_khr?: number | string | null
  manual_discount_usd?: number | string | null
  manual_discount_khr?: number | string | null
}

const num = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export interface ReceiptLineFigures {
  displayPriceMode?: string
  lineUsd: number
  lineKhr: number
  qty: number
  chargedUnitUsd: number
  /** What the customer was actually charged in riel, per unit. */
  chargedUnitKhr: number
  sellingUnitUsd: number
  sellingUnitKhr: number
  hasDiscount: boolean
  /** The cut on ONE unit -- what the Price column prints in parentheses. */
  unitSavingsUsd: number
  /** The cut on the whole line: unitSavingsUsd * qty. */
  savingsUsd: number
}

/**
 * One definition of what a line is worth, used both to print the line and to
 * total the savings. They must never drift apart, because the Subtotal and
 * Discount rows are built from this same number.
 *
 * `sellingUnitUsd` falls back to the charged price whenever no discount is
 * detectable -- an older sale with no base_price, or a line simply sold at list
 * -- so those receipts print exactly what they always did.
 */
export function receiptLineFigures(
  item: ReceiptLineInput,
  showItemDiscount: boolean,
  exchangeRate: number,
  moneyPrecisionVersion: 0 | 1 = 0,
  identityHeader: { id?: unknown; pricing_identity_bindings?: unknown } = {},
): ReceiptLineFigures {
  if (moneyPrecisionVersion === 1) {
    const snapshot = parseSaleItemPricing(item.pricing_snapshot_json)
    if (!snapshot) throw new SaleItemPricingError()
    const captured = snapshot.pool.lines.find(line => line.line_key === snapshot.line_key)
    const qty = snapshot.quantities[snapshot.line_key]
    const bound = (value: unknown, expected: number) => value != null && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) === expected
    const bindings = serverPricingIdentityBindings(identityHeader.pricing_identity_bindings).filter(binding => binding.sale_id === identityHeader.id
      && binding.sale_id === item.sale_id && binding.sale_item_id === item.id && binding.captured_product_id === captured?.product.id && binding.current_product_id === item.product_id)
    if (!captured || (!bound(item.product_id, Number(captured.product.id)) && bindings.length !== 1) || !bound(item.quantity, qty)
      || snapshot.pool.exchange_rate !== exchangeRate
      || !bound(item.total_usd, snapshot.amounts.total_usd) || !bound(item.total_khr, snapshot.amounts.total_khr)
      || !bound(item.applied_price_usd, snapshot.amounts.applied_price_usd) || !bound(item.applied_price_khr, snapshot.amounts.applied_price_khr)) throw new SaleItemPricingError()
    const metadata = capturedPricingMetadata(snapshot.pool, snapshot.line_key, snapshot.amounts)
    if (item.price_mode !== metadata.price_mode || (item.product_discount_type ?? null) !== metadata.product_discount_type || (item.product_discount_label ?? null) !== metadata.product_discount_label) throw new SaleItemPricingError()
    const savings = sumMoney4([snapshot.amounts.product_discount_usd, snapshot.amounts.manual_discount_usd])
    const hasDiscount = showItemDiscount && savings > 0
    const sellingUnitUsd = hasDiscount ? divideMoney4(snapshot.amounts.gross_usd, qty) : snapshot.amounts.applied_price_usd
    return { qty, displayPriceMode: capturedDisplayPriceMode(snapshot), lineUsd: snapshot.amounts.total_usd, lineKhr: snapshot.amounts.total_khr,
      chargedUnitUsd: snapshot.amounts.applied_price_usd, chargedUnitKhr: snapshot.amounts.applied_price_khr,
      sellingUnitUsd, sellingUnitKhr: hasDiscount ? multiplyMoney4(sellingUnitUsd, exchangeRate) : snapshot.amounts.applied_price_khr,
      hasDiscount, unitSavingsUsd: hasDiscount ? divideMoney4(savings, qty) : 0, savingsUsd: hasDiscount ? savings : 0 }
  }
  const qty = num(item.quantity) || 1
  const chargedUnitUsd = num(item.applied_price_usd ?? item.price_usd ?? item.price)
  const chargedUnitKhr = num(item.applied_price_khr ?? item.price_khr)
  const baseUnitUsd = num(item.base_price_usd)
  const productSavingsUsd = num(item.product_discount_usd)
  const manualSavingsUsd = num(item.manual_discount_usd)
  // Keep the product-level list price derivation explicit; manual discounts
  // are an additional sale-level reduction layered on top of that amount.
  // This distinction matters for legacy lines where either component may be
  // absent, and keeps the receipt's before/after audit math deterministic.
  const productListUnitUsd = baseUnitUsd > 0
    ? baseUnitUsd + num(item.product_discount_usd)
    : num(item.price_usd ?? item.price)
  // base_price is already the price BEFORE the manual cut. Adding the manual
  // saving here counted it once in the base and a second time in the displayed
  // saving: base 30, applied 27, manual 3 became an invented list price of 33
  // and a $6 cut. The actual selling/list price is base + the product-level
  // cut; applied is base - the manual cut, so their difference naturally
  // contains product + manual exactly once.
  const originalUnitUsd = productListUnitUsd

  const hasDiscount = showItemDiscount
    && originalUnitUsd > 0
    && chargedUnitUsd >= 0
    && originalUnitUsd > chargedUnitUsd + 0.005
    && item.applied_price_usd != null

  const sellingUnitUsd = hasDiscount ? originalUnitUsd : chargedUnitUsd

  // base_price_khr rides on the POS payload but is NOT a stored sale_items
  // column, so a reprint has to derive it. Prefer a real riel figure when the
  // payload carries one; otherwise scale the charged riel by the same ratio as
  // the dollars, so the two columns tell the same story; fall back to the
  // exchange rate only when there is no riel figure at all.
  let sellingUnitKhr = chargedUnitKhr
  if (hasDiscount) {
    const baseUnitKhr = num(item.base_price_khr)
    // As in USD, base_price_khr is already before the manual cut. Adding the
    // manual amount here would invent a second copy of the same discount.
    if (baseUnitKhr > 0) sellingUnitKhr = baseUnitKhr + num(item.product_discount_khr)
    else if (chargedUnitKhr > 0 && chargedUnitUsd > 0) sellingUnitKhr = chargedUnitKhr * (sellingUnitUsd / chargedUnitUsd)
    else sellingUnitKhr = sellingUnitUsd * exchangeRate
  }

  // The Total column prints riel from the CHARGED side. Fall back to the
  // exchange rate exactly as the selling side does, or a line with no stored
  // riel would lose its riel subline entirely.
  const chargedUnitKhrOut = chargedUnitKhr > 0 ? chargedUnitKhr : chargedUnitUsd * exchangeRate

  return {
    lineUsd: chargedUnitUsd * qty,
    lineKhr: chargedUnitKhrOut * qty,
    qty,
    chargedUnitUsd,
    chargedUnitKhr: chargedUnitKhrOut,
    sellingUnitUsd,
    sellingUnitKhr,
    hasDiscount,
    unitSavingsUsd: hasDiscount ? originalUnitUsd - chargedUnitUsd : 0,
    savingsUsd: hasDiscount ? (originalUnitUsd - chargedUnitUsd) * qty : 0,
  }
}

/** Total per-line savings across a sale; what both displayed figures shift by. */
export function receiptLineSavingsUsd(
  items: ReceiptLineInput[],
  showItemDiscount: boolean,
  exchangeRate: number,
  moneyPrecisionVersion: 0 | 1 = 0,
  identityHeader: { id?: unknown; pricing_identity_bindings?: unknown } = {},
): number {
  if (moneyPrecisionVersion === 1) return sumMoney4(items.map(item => receiptLineFigures(item, showItemDiscount, exchangeRate, 1, identityHeader).savingsUsd))
  return items.reduce(
    (sum, item) => sum + receiptLineFigures(item, showItemDiscount, exchangeRate).savingsUsd,
    0,
  )
}

/**
 * The delivery fee, split by who actually paid it.
 *
 * THE RULE (owner, Sep 4 2026): "if free/paid by shop in receipt note 'Free'
 * and a delivery fee crossed out fee. so Free crossed out $N."
 *
 * The defect underneath that rule is an arithmetic one, not a wording one.
 * `sales.total_usd` only ever includes a CUSTOMER-paid delivery fee (see the
 * ground-truth header in the Worker's lib/salesAnalytics.ts), but the receipt
 * printed the stored fee whoever paid it. So on a delivery the shop absorbed,
 * the printed column did not add up:
 *
 *     subtotal - discount + tax + delivery  !=  TOTAL
 *
 * by exactly the absorbed fee. Printing "Free" reads as zero in that column,
 * which is what the total already assumed, while the struck-through figure
 * still tells the customer what the delivery was worth.
 *
 * The invariant this guarantees, and which the test asserts directly:
 *
 *     chargedUsd + absorbedUsd === faceUsd
 *
 * and `chargedUsd` is exactly the amount `total_usd` already carries. Nothing
 * here changes any stored money.
 */
export interface ReceiptDeliveryInput {
  delivery_fee_usd?: number | string | null
  delivery_fee_khr?: number | string | null
  delivery_fee_paid_by?: string | null
}

export interface ReceiptDeliveryFigures {
  /** The fee as stored, whoever paid it -- the figure struck through when free. */
  faceUsd: number
  faceKhr: number
  /** What the customer was charged; the only part total_usd carries. */
  chargedUsd: number
  chargedKhr: number
  /** What the shop absorbed. Never added to the printed column. */
  absorbedUsd: number
  absorbedKhr: number
  /** True when the row must read "Free" with the fee struck through. */
  printsAsFree: boolean
}

/**
 * Matches the Worker's `customerDeliveryFeeExpr` / `storeDeliveryExpr` exactly:
 * only the literal 'store' means absorbed, and a missing value is a
 * customer-paid fee (the column's own default). Any other spelling is treated
 * as customer-paid rather than guessed at -- the receipt must never invent a
 * discount the till did not give.
 */
export function receiptDeliveryFigures(
  sale: ReceiptDeliveryInput,
  exchangeRate: number,
): ReceiptDeliveryFigures {
  const faceUsd = num(sale.delivery_fee_usd)
  const faceKhr = num(sale.delivery_fee_khr) || faceUsd * exchangeRate
  const absorbed = String(sale.delivery_fee_paid_by || 'customer') === 'store'
  return {
    faceUsd,
    faceKhr,
    chargedUsd: absorbed ? 0 : faceUsd,
    chargedKhr: absorbed ? 0 : faceKhr,
    absorbedUsd: absorbed ? faceUsd : 0,
    absorbedKhr: absorbed ? faceKhr : 0,
    // Only a fee that actually exists can be given away. A zero fee has
    // nothing to strike through, and the row is hidden anyway.
    printsAsFree: absorbed && faceUsd > 0,
  }
}
