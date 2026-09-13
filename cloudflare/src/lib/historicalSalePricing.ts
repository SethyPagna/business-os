import { multiplyMoney4, percentageProductMoney4, roundMoney4, sellingPriceCeilCent, subtractMoney4, sumMoney4, sumProductsMoney4 } from './moneyPrecision'

export class HistoricalSalePricingError extends Error {
  readonly code = 'historical_sale_pricing_invalid'
  constructor() { super('Review the recorded sale price.'); this.name = 'HistoricalSalePricingError' }
}
function nonnegative(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new HistoricalSalePricingError()
  return value
}
export function recordedHistoricalLineTotal(row:Record<string,unknown>):{amount:number;derived:boolean} {
  if(row.total_usd!=null)return {amount:nonnegative(row.total_usd),derived:false}
  const quantity=nonnegative(row.quantity)
  if(quantity<=0)throw new HistoricalSalePricingError()
  return {amount:multiplyMoney4(nonnegative(row.applied_price_usd),quantity),derived:true}
}
/** Recorded operands, never an invented promotion capture. Untouched fields
 * remain verbatim, including unknown NULL provenance and historical precision. */
export function planHistoricalSaleLine(row: Record<string, unknown>, body: Record<string, unknown>, nextQuantity: number, rate: number) {
  if (!(nextQuantity > 0) || !Number.isFinite(nextQuantity) || !(rate > 0) || !Number.isFinite(rate)) throw new HistoricalSalePricingError()
  const oldQuantity = nonnegative(row.quantity), oldApplied = nonnegative(row.applied_price_usd)
  const recordedManual = nonnegative(row.manual_discount_usd ?? 0)
  const oldBase = row.base_price_usd == null ? sumMoney4([oldApplied, recordedManual]) : nonnegative(row.base_price_usd)
  const oldType = row.manual_discount_type === 'fixed' || row.manual_discount_type === 'percent'
    ? row.manual_discount_type : recordedManual > 0 ? 'fixed' : null
  const oldValue = oldType === 'percent' ? nonnegative(row.manual_discount_value ?? 0)
    : nonnegative(row.manual_discount_value == null || row.manual_discount_value === 0 ? recordedManual : row.manual_discount_value)
  const baseInput = body.selling_price_input_usd === undefined ? body.base_price_usd : sellingPriceCeilCent(body.selling_price_input_usd as number)
  const base = baseInput === undefined ? oldBase : nonnegative(baseInput)
  if(base!==oldBase&&body.selling_price_input_usd===undefined)throw new HistoricalSalePricingError()
  const type = body.manual_discount_type === undefined ? oldType : body.manual_discount_type
  if (type !== null && type !== 'fixed' && type !== 'percent') throw new HistoricalSalePricingError()
  const value = type === null ? 0 : body.manual_discount_value === undefined ? oldValue : nonnegative(body.manual_discount_value)
  if (type === 'percent' && value > 100) throw new HistoricalSalePricingError()
  const priceChanged = base !== oldBase || type !== oldType || value !== oldValue
  const quantityChanged = nextQuantity !== oldQuantity
  if (!priceChanged && !quantityChanged) return { row: { ...row }, changed: false, quote: null }
  const next: Record<string, unknown> = { ...row, quantity: nextQuantity }
  let total: number, gross: number, manual: number
  if (!priceChanged) {
    total = multiplyMoney4(oldApplied, nextQuantity)
    gross = row.base_price_usd == null ? sumProductsMoney4([{amount:oldApplied,factor:nextQuantity},{amount:recordedManual,factor:nextQuantity}]) : multiplyMoney4(oldBase, nextQuantity)
    manual = subtractMoney4(gross, total)
    if (manual < 0) throw new HistoricalSalePricingError()
  } else {
    const canonicalBase = roundMoney4(base)
    gross = multiplyMoney4(canonicalBase, nextQuantity)
    manual = type === 'percent' ? percentageProductMoney4(canonicalBase, nextQuantity, value)
      : type === 'fixed' ? Math.min(gross, multiplyMoney4(roundMoney4(value), nextQuantity)) : 0
    total = subtractMoney4(gross, manual)
    const unitManual = type === 'percent' ? percentageProductMoney4(canonicalBase, 1, value)
      : type === 'fixed' ? Math.min(canonicalBase, roundMoney4(value)) : 0
    Object.assign(next, { base_price_usd: canonicalBase, base_price_khr: multiplyMoney4(canonicalBase, rate),
      manual_discount_type: type, manual_discount_value: type === 'percent' ? value : roundMoney4(value),
      manual_discount_usd: unitManual, manual_discount_khr: multiplyMoney4(unitManual, rate),
      applied_price_usd: subtractMoney4(canonicalBase, unitManual),
      applied_price_khr: multiplyMoney4(subtractMoney4(canonicalBase, unitManual), rate) })
  }
  Object.assign(next, { total_usd: total, total_khr: multiplyMoney4(total, rate) })
  return { row: next, changed: true, quote: { gross_usd: gross, product_discount_usd: 0, manual_discount_usd: manual, total_usd: total, total_khr: multiplyMoney4(total, rate) } }
}
