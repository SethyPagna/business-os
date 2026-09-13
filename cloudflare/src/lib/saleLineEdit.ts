import { round2 } from './saleTotals'
import { roundMoney4, percentageMoney4, subtractMoney4, sellingPriceCeilCent } from './moneyPrecision'

export type SaleLineDiscountType = 'percent' | 'fixed' | null

export type SaleLinePriceEditResult =
  | { ok: true; basePriceUsd: number; discountType: SaleLineDiscountType; discountValue: number; manualDiscountUsd: number; appliedPriceUsd: number }
  | { ok: false; error: string }

/** Server authority for the POS price stack used by a recorded-line edit. */
export function planSaleLinePriceEdit(input: {
  moneyPrecisionVersion?: 0 | 1
  sellingPriceInputUsd?: unknown
  basePriceUsd: unknown
  discountType: unknown
  discountValue: unknown
  claimedManualDiscountUsd?: unknown
  claimedAppliedPriceUsd: unknown
}): SaleLinePriceEditResult {
  const baseRaw = Number(input.basePriceUsd)
  if (!Number.isFinite(baseRaw) || baseRaw < 0) return { ok: false, error: 'Selling price must be a non-negative number.' }
  const precision = input.moneyPrecisionVersion === 1
  const money = precision ? roundMoney4 : round2
  const basePriceUsd = money(baseRaw)
  if (precision && input.sellingPriceInputUsd !== undefined && sellingPriceCeilCent(input.sellingPriceInputUsd as number) !== basePriceUsd)
    return { ok: false, error: 'Selling base does not match the rounded entered selling price.' }
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
  const discountValue = discountType ? (precision && discountType === 'percent' ? valueRaw : money(valueRaw)) : 0
  if (discountType === 'percent' && discountValue > 100) return { ok: false, error: 'Percent discount cannot exceed 100.' }
  if (discountType === 'fixed' && discountValue > basePriceUsd) return { ok: false, error: 'Discount cannot exceed the selling price.' }
  const manualDiscountUsd = discountType === 'percent'
    ? (precision ? percentageMoney4(basePriceUsd, discountValue) : round2(basePriceUsd * discountValue / 100))
    : discountType === 'fixed' ? discountValue : 0
  const appliedPriceUsd = precision ? subtractMoney4(basePriceUsd, manualDiscountUsd) : round2(basePriceUsd - manualDiscountUsd)
  const claimedApplied = Number(input.claimedAppliedPriceUsd)
  if (!Number.isFinite(claimedApplied) || claimedApplied < 0 || (precision ? appliedPriceUsd !== roundMoney4(claimedApplied) : Math.abs(appliedPriceUsd - round2(claimedApplied)) > 0.005)) {
    return { ok: false, error: 'Applied price does not match the reviewed price and discount.' }
  }
  if (input.claimedManualDiscountUsd !== undefined) {
    const claimedDiscount = Number(input.claimedManualDiscountUsd)
    if (!Number.isFinite(claimedDiscount) || claimedDiscount < 0 || (precision ? manualDiscountUsd !== roundMoney4(claimedDiscount) : Math.abs(manualDiscountUsd - round2(claimedDiscount)) > 0.005)) {
      return { ok: false, error: 'Discount amount does not match the reviewed discount.' }
    }
  }
  return { ok: true, basePriceUsd, discountType, discountValue, manualDiscountUsd, appliedPriceUsd }
}
