import { addMoney4, divideMoney4, multiplyMoney4, percentageMoney4, percentageProductMoney4, roundMoney4, sellingPriceCeilCent, subtractMoney4, sumMoney4 } from './moneyPrecision.ts'
import { evaluateCapturedPricingPool, validateCapturedSaleBasket } from './saleItemPricing.ts'
import { serverPricingIdentityBindings } from './saleMoneyV1.ts'
import { planHistoricalSaleLine, recordedHistoricalLineTotal, HistoricalSalePricingError } from './historicalSalePricing.ts'
const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100

/** Parent version selects pricing authority. Request version1 means reviewed
 * protocol, not permission to fabricate a captured pool for an old sale. */
export function saleLineEditPreview(items: readonly Record<string, unknown>[], header: Record<string, unknown>, lineId: number,
  changes: { quantity: number; selling_price_input_usd?: number; manual_discount_type?: 'percent' | 'fixed' | null; manual_discount_value?: number }) {
  if (header.money_precision_version === 1) return { ...capturedSaleLineEdit(items, header, lineId, changes), pricingBasis: 'captured' as const, recordedTotalDerived: false }
  if (header.money_precision_version != null && header.money_precision_version !== 0) throw new HistoricalSalePricingError()
  const row = items.find(item => item.id === lineId)
  if (!row || typeof header.subtotal_usd !== 'number' || !Number.isFinite(header.subtotal_usd) || header.subtotal_usd < 0) throw new HistoricalSalePricingError()
  const plan = planHistoricalSaleLine(row, changes, changes.quantity, Number(header.exchange_rate))
  if (!plan.changed || !plan.quote) return null
  const baseline = recordedHistoricalLineTotal(row)
  const subtotalUsd = sumMoney4([header.subtotal_usd, -baseline.amount, plan.quote.total_usd])
  if (subtotalUsd < 0) throw new HistoricalSalePricingError()
  const base = plan.row.base_price_usd == null ? sumMoney4([Number(plan.row.applied_price_usd), Number(plan.row.manual_discount_usd ?? 0)]) : Number(plan.row.base_price_usd)
  const productDiscount = Number(plan.row.product_discount_usd ?? 0)
  if (!Number.isFinite(productDiscount) || productDiscount < 0) throw new HistoricalSalePricingError()
  return { ok: true as const, pricingBasis: 'recorded' as const, recordedTotalDerived: baseline.derived,
    quantity: changes.quantity, basePriceUsd: base, appliedPriceUsd: Number(plan.row.applied_price_usd),
    sellingPriceUsd: addMoney4(base, productDiscount), manualDiscountUsd: Number(plan.row.manual_discount_usd ?? 0),
    totalDiscountUsd: addMoney4(productDiscount, Number(plan.row.manual_discount_usd ?? 0)), lineTotalUsd: plan.quote.total_usd, subtotalUsd,
    request: { kind: 'line_updated' as const, money_precision_version: 1 as const, sale_item_id: lineId, ...changes,
      pricing_quote: plan.quote, ...(baseline.derived ? { expected_recorded_line_total_usd: baseline.amount } : {}) } }
}

export function saleRemovalSubtotal(items: readonly Record<string, unknown>[], header: Record<string, unknown>, lineId: number, replacementTotalUsd = 0): { subtotalUsd: number; recordedTotalDerived: boolean; expectedRecordedLineTotal?: number } {
  if (!Number.isFinite(replacementTotalUsd) || replacementTotalUsd < 0) throw new HistoricalSalePricingError()
  if (header.money_precision_version === 1) return { subtotalUsd: sumMoney4([capturedSaleRemovalSubtotal(items, header, lineId), replacementTotalUsd]), recordedTotalDerived: false }
  if (header.money_precision_version != null && header.money_precision_version !== 0) throw new HistoricalSalePricingError()
  const row = items.find(item => item.id === lineId)
  if (!row || typeof header.subtotal_usd !== 'number' || !Number.isFinite(header.subtotal_usd) || header.subtotal_usd < 0) throw new HistoricalSalePricingError()
  // Replacement must join this ORIGINAL expression, not add to an already
  // rounded removal subtotal and lose a historical residual.
  const baseline = recordedHistoricalLineTotal(row), subtotalUsd = sumMoney4([header.subtotal_usd, -baseline.amount, replacementTotalUsd])
  if (subtotalUsd < 0) throw new HistoricalSalePricingError()
  return { subtotalUsd, recordedTotalDerived: baseline.derived, ...(baseline.derived ? { expectedRecordedLineTotal: baseline.amount } : {}) }
}

/** Quantity edits replay original captured thresholds/time across the whole
 * pool. Current product/rule settings are deliberately not an input. */
export function capturedSaleLineEdit(items: readonly Record<string, unknown>[], header: Record<string, unknown>, lineId: number,
  changes: { quantity: number; selling_price_input_usd?: number; manual_discount_type?: 'percent' | 'fixed' | null; manual_discount_value?: number }) {
  const snapshots = validateCapturedSaleBasket(items, header, serverPricingIdentityBindings(header.pricing_identity_bindings))
  const index = items.findIndex(item => Number(item.id) === lineId)
  if (index < 0) throw new Error('sale_item_pricing_invalid')
  const snapshot = snapshots[index], pool = structuredClone(snapshot.pool)
  const capture = pool.lines.find(line => line.line_key === snapshot.line_key)!
  if (changes.selling_price_input_usd !== undefined) { capture.source = 'manual'; capture.selling_price_input_usd = changes.selling_price_input_usd }
  if (changes.manual_discount_type !== undefined) capture.manual.type = changes.manual_discount_type ?? 'none'
  if (changes.manual_discount_value !== undefined) capture.manual.value = changes.manual_discount_value
  const quotes = evaluateCapturedPricingPool(pool, { ...snapshot.quantities, [snapshot.line_key]: changes.quantity })
  const exact = quotes.get(snapshot.line_key)!
  const subtotalUsd = sumMoney4(snapshots.map(row => row.pool.pool_key === pool.pool_key ? quotes.get(row.line_key)!.total_usd : row.amounts.total_usd))
  return { ok: true as const, quantity: changes.quantity, basePriceUsd: exact.base_price_usd, appliedPriceUsd: exact.applied_price_usd,
    sellingPriceUsd: divideMoney4(exact.gross_usd, changes.quantity), totalDiscountUsd: divideMoney4(addMoney4(exact.product_discount_usd, exact.manual_discount_usd), changes.quantity),
    manualDiscountUsd: divideMoney4(exact.manual_discount_usd, changes.quantity), lineTotalUsd: exact.total_usd, subtotalUsd, quotes,
    request: { kind: 'line_updated' as const, money_precision_version: 1 as const, sale_item_id: lineId, ...changes,
      pricing_quote: { gross_usd: exact.gross_usd, product_discount_usd: exact.product_discount_usd, manual_discount_usd: exact.manual_discount_usd, total_usd: exact.total_usd, total_khr: exact.total_khr } } }
}

/** Removal/replacement changes the original pool before any new independent
 * replacement line is added. Never subtract a rounded unit projection. */
export function capturedSaleRemovalSubtotal(items: readonly Record<string, unknown>[], header: Record<string, unknown>, lineId: number): number {
  const snapshots = validateCapturedSaleBasket(items, header, serverPricingIdentityBindings(header.pricing_identity_bindings))
  const index = items.findIndex(item => Number(item.id) === lineId)
  if (index < 0) throw new Error('sale_item_pricing_invalid')
  const removed = snapshots[index], pool = structuredClone(removed.pool)
  pool.lines = pool.lines.filter(line => line.line_key !== removed.line_key)
  const quantities = { ...removed.quantities }
  delete quantities[removed.line_key]
  const quotes = pool.lines.length ? evaluateCapturedPricingPool(pool, quantities) : new Map()
  return sumMoney4(snapshots.filter((_, position) => position !== index).map(row => row.pool.pool_key === pool.pool_key ? quotes.get(row.line_key)!.total_usd : row.amounts.total_usd))
}

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
  if (version1) {
    const gross = multiplyMoney4(normalizedBase, quantity)
    const lineManual = manualDiscountType === 'percent' ? percentageProductMoney4(normalizedBase, quantity, normalizedValue)
      : manualDiscountType === 'fixed' ? multiplyMoney4(normalizedValue, quantity) : 0
    const lineTotalUsd = subtractMoney4(gross, lineManual), manualDiscountUsd = divideMoney4(lineManual, quantity)
    return { ok: true, quantity, basePriceUsd: normalizedBase, manualDiscountType, manualDiscountValue: manualDiscountType ? normalizedValue : 0,
      manualDiscountUsd, productDiscountUsd, appliedPriceUsd: divideMoney4(lineTotalUsd, quantity), sellingPriceUsd: addMoney4(normalizedBase, productDiscountUsd),
      totalDiscountUsd: addMoney4(productDiscountUsd, manualDiscountUsd), lineTotalUsd }
  }
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
