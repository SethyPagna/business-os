const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100

export interface SaleLineEditorInput {
  quantity: unknown
  basePriceUsd: unknown
  manualDiscountType: unknown
  manualDiscountValue: unknown
  productDiscountUsd?: unknown
}

export type SaleLineEditorResult =
  | {
    ok: true
    quantity: number
    basePriceUsd: number
    manualDiscountType: 'percent' | 'fixed' | null
    manualDiscountValue: number
    manualDiscountUsd: number
    productDiscountUsd: number
    appliedPriceUsd: number
    sellingPriceUsd: number
    totalDiscountUsd: number
    lineTotalUsd: number
  }
  | { ok: false; code: 'quantity' | 'price' | 'discount' | 'discount_exceeds_price' }

/**
 * Preview and validate a recorded-line edit with the same price layers the POS
 * stores: product pricing resolves the base, then the cashier's manual discount
 * reduces that base to the applied price. Product discount is a frozen snapshot
 * from checkout and is never charged a second time.
 */
export function saleLineEditorResult(input: SaleLineEditorInput): SaleLineEditorResult {
  const quantityRaw = Number(input.quantity)
  if (!Number.isFinite(quantityRaw)) return { ok: false, code: 'quantity' }
  const quantity = round2(quantityRaw)
  if (quantity <= 0) return { ok: false, code: 'quantity' }

  const basePriceUsd = Number(input.basePriceUsd)
  if (!Number.isFinite(basePriceUsd) || basePriceUsd < 0) return { ok: false, code: 'price' }

  const manualDiscountType = input.manualDiscountType === 'percent' || input.manualDiscountType === 'fixed'
    ? input.manualDiscountType
    : null
  const manualDiscountValueRaw = Number(input.manualDiscountValue)
  if (!Number.isFinite(manualDiscountValueRaw) || manualDiscountValueRaw < 0) return { ok: false, code: 'discount' }
  if (manualDiscountType === 'percent' && manualDiscountValueRaw > 100) return { ok: false, code: 'discount_exceeds_price' }
  if (manualDiscountType === 'fixed' && manualDiscountValueRaw > basePriceUsd + 0.000001) return { ok: false, code: 'discount_exceeds_price' }

  const productDiscountRaw = Number(input.productDiscountUsd)
  const productDiscountUsd = Number.isFinite(productDiscountRaw) ? Math.max(0, round2(productDiscountRaw)) : 0
  const normalizedBase = round2(basePriceUsd)
  const normalizedValue = round2(manualDiscountValueRaw)
  const normalizedManual = manualDiscountType === 'percent'
    ? round2(normalizedBase * normalizedValue / 100)
    : manualDiscountType === 'fixed'
      ? normalizedValue
      : 0
  const appliedPriceUsd = round2(Math.max(0, normalizedBase - normalizedManual))

  return {
    ok: true,
    quantity,
    basePriceUsd: normalizedBase,
    manualDiscountType,
    manualDiscountValue: manualDiscountType ? normalizedValue : 0,
    manualDiscountUsd: normalizedManual,
    productDiscountUsd,
    appliedPriceUsd,
    sellingPriceUsd: round2(normalizedBase + productDiscountUsd),
    totalDiscountUsd: round2(productDiscountUsd + normalizedManual),
    lineTotalUsd: round2(appliedPriceUsd * quantity),
  }
}
