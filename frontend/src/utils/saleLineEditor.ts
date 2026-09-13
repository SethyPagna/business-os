import { addMoney4, multiplyMoney4, percentageMoney4, roundMoney4, sellingPriceCeilCent, subtractMoney4 } from './moneyPrecision.ts'
const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100

export interface SaleLineEditorInput {
  quantity: unknown
  basePriceUsd: unknown
  manualDiscountType: unknown
  manualDiscountValue: unknown
  productDiscountUsd?: unknown
  moneyPrecisionVersion?: 0 | 1
  /** Present only for an explicit new selling-base input, never a derived base. */
  sellingPriceInputUsd?: string | number
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
  const version1 = input.moneyPrecisionVersion === 1
  const quantity = version1 ? quantityRaw : round2(quantityRaw)
  if (quantity <= 0) return { ok: false, code: 'quantity' }

  const basePriceUsd = Number(input.basePriceUsd)
  if (!Number.isFinite(basePriceUsd) || basePriceUsd < 0) return { ok: false, code: 'price' }
  const money = version1 ? roundMoney4 : round2
  let normalizedBase: number
  try {
    if (version1 && input.sellingPriceInputUsd !== undefined && (!String(input.sellingPriceInputUsd).trim() || Number(input.sellingPriceInputUsd) < 0)) return { ok: false, code: 'price' }
    normalizedBase = version1 && input.sellingPriceInputUsd !== undefined
      ? sellingPriceCeilCent(input.sellingPriceInputUsd) : money(basePriceUsd)
  } catch { return { ok: false, code: 'price' } }

  const manualDiscountType = input.manualDiscountType === 'percent' || input.manualDiscountType === 'fixed'
    ? input.manualDiscountType
    : null
  const manualDiscountValueRaw = Number(input.manualDiscountValue)
  if (!Number.isFinite(manualDiscountValueRaw) || manualDiscountValueRaw < 0) return { ok: false, code: 'discount' }
  if (manualDiscountType === 'percent' && manualDiscountValueRaw > 100) return { ok: false, code: 'discount_exceeds_price' }
  if (manualDiscountType === 'fixed' && manualDiscountValueRaw > (version1 ? normalizedBase : basePriceUsd) + (version1 ? 0 : 0.000001)) return { ok: false, code: 'discount_exceeds_price' }

  const productDiscountRaw = Number(input.productDiscountUsd)
  const productDiscountUsd = Number.isFinite(productDiscountRaw) ? Math.max(0, money(productDiscountRaw)) : 0
  const normalizedValue = version1 && manualDiscountType === 'percent' ? manualDiscountValueRaw : money(manualDiscountValueRaw)
  const normalizedManual = manualDiscountType === 'percent'
    ? version1 ? percentageMoney4(normalizedBase, normalizedValue) : round2(normalizedBase * normalizedValue / 100)
    : manualDiscountType === 'fixed'
      ? normalizedValue
      : 0
  const appliedPriceUsd = Math.max(0, version1 ? subtractMoney4(normalizedBase, normalizedManual) : round2(normalizedBase - normalizedManual))

  return {
    ok: true,
    quantity,
    basePriceUsd: normalizedBase,
    manualDiscountType,
    manualDiscountValue: manualDiscountType ? normalizedValue : 0,
    manualDiscountUsd: normalizedManual,
    productDiscountUsd,
    appliedPriceUsd,
    sellingPriceUsd: version1 ? addMoney4(normalizedBase, productDiscountUsd) : round2(normalizedBase + productDiscountUsd),
    totalDiscountUsd: version1 ? addMoney4(productDiscountUsd, normalizedManual) : round2(productDiscountUsd + normalizedManual),
    lineTotalUsd: version1 ? multiplyMoney4(appliedPriceUsd, quantity) : round2(appliedPriceUsd * quantity),
  }
}
