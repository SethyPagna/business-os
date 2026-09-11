import { round2 } from './saleTotals'

export type SaleLineDiscountType = 'percent' | 'fixed' | null

export type SaleLinePriceEditResult =
  | { ok: true; basePriceUsd: number; discountType: SaleLineDiscountType; discountValue: number; manualDiscountUsd: number; appliedPriceUsd: number }
  | { ok: false; error: string }

/** Server authority for the POS price stack used by a recorded-line edit. */
export function planSaleLinePriceEdit(input: {
  basePriceUsd: unknown
  discountType: unknown
  discountValue: unknown
  claimedManualDiscountUsd?: unknown
  claimedAppliedPriceUsd: unknown
}): SaleLinePriceEditResult {
  const baseRaw = Number(input.basePriceUsd)
  if (!Number.isFinite(baseRaw) || baseRaw < 0) return { ok: false, error: 'Selling price must be a non-negative number.' }
  const basePriceUsd = round2(baseRaw)
  const discountType: SaleLineDiscountType = input.discountType === null
    ? null
    : input.discountType === 'percent' || input.discountType === 'fixed'
      ? input.discountType
      : null
  if (input.discountType !== null && input.discountType !== 'percent' && input.discountType !== 'fixed') {
    return { ok: false, error: 'Discount type must be percent, fixed, or blank.' }
  }
  const valueRaw = Number(input.discountValue)
  if (!Number.isFinite(valueRaw) || valueRaw < 0) return { ok: false, error: 'Discount must be a non-negative number.' }
  const discountValue = discountType ? round2(valueRaw) : 0
  if (discountType === 'percent' && discountValue > 100) return { ok: false, error: 'Percent discount cannot exceed 100.' }
  if (discountType === 'fixed' && discountValue > basePriceUsd) return { ok: false, error: 'Discount cannot exceed the selling price.' }
  const manualDiscountUsd = discountType === 'percent'
    ? round2(basePriceUsd * discountValue / 100)
    : discountType === 'fixed' ? discountValue : 0
  const appliedPriceUsd = round2(basePriceUsd - manualDiscountUsd)
  const claimedApplied = Number(input.claimedAppliedPriceUsd)
  if (!Number.isFinite(claimedApplied) || claimedApplied < 0 || Math.abs(appliedPriceUsd - round2(claimedApplied)) > 0.005) {
    return { ok: false, error: 'Applied price does not match the reviewed price and discount.' }
  }
  if (input.claimedManualDiscountUsd !== undefined) {
    const claimedDiscount = Number(input.claimedManualDiscountUsd)
    if (!Number.isFinite(claimedDiscount) || claimedDiscount < 0 || Math.abs(manualDiscountUsd - round2(claimedDiscount)) > 0.005) {
      return { ok: false, error: 'Discount amount does not match the reviewed discount.' }
    }
  }
  return { ok: true, basePriceUsd, discountType, discountValue, manualDiscountUsd, appliedPriceUsd }
}
