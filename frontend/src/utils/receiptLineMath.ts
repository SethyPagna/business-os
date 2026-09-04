/**
 * Receipt line arithmetic, kept out of Receipt.tsx so it can be executed by a
 * test rather than only pattern-matched. The component has JSX, which the test
 * runner cannot import.
 *
 * THE RULE (owner, Sep 4 2026): "products show selling price and minus the
 * discounts in total show selling price (-discount), not discounted
 * price(-discount)".
 *
 * So a line prints its SELLING price with the saving beside it, and every cut
 * -- per line and order-wide -- is carried in the Discount row.
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

export interface ReceiptLineInput {
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
}

const num = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export interface ReceiptLineFigures {
  qty: number
  chargedUnitUsd: number
  sellingUnitUsd: number
  sellingUnitKhr: number
  hasDiscount: boolean
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
): ReceiptLineFigures {
  const qty = num(item.quantity) || 1
  const chargedUnitUsd = num(item.applied_price_usd ?? item.price_usd ?? item.price)
  const chargedUnitKhr = num(item.applied_price_khr ?? item.price_khr)
  const baseUnitUsd = num(item.base_price_usd)
  const originalUnitUsd = baseUnitUsd > 0
    ? baseUnitUsd + num(item.product_discount_usd)
    : num(item.price_usd ?? item.price)

  const hasDiscount = showItemDiscount
    && originalUnitUsd > 0
    && chargedUnitUsd > 0
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
    if (baseUnitKhr > 0) sellingUnitKhr = baseUnitKhr + num(item.product_discount_khr)
    else if (chargedUnitKhr > 0 && chargedUnitUsd > 0) sellingUnitKhr = chargedUnitKhr * (sellingUnitUsd / chargedUnitUsd)
    else sellingUnitKhr = sellingUnitUsd * exchangeRate
  }

  return {
    qty,
    chargedUnitUsd,
    sellingUnitUsd,
    sellingUnitKhr,
    hasDiscount,
    savingsUsd: hasDiscount ? (originalUnitUsd - chargedUnitUsd) * qty : 0,
  }
}

/** Total per-line savings across a sale; what both displayed figures shift by. */
export function receiptLineSavingsUsd(
  items: ReceiptLineInput[],
  showItemDiscount: boolean,
  exchangeRate: number,
): number {
  return items.reduce(
    (sum, item) => sum + receiptLineFigures(item, showItemDiscount, exchangeRate).savingsUsd,
    0,
  )
}
