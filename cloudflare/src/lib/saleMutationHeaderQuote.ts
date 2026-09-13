import { roundMoney4, roundMoney2, multiplyMoney4, percentageMoney4, sumMoney4, subtractMoney4, settlementRounding4 } from './moneyPrecision'

export type SaleMutationHeaderQuote = {
  version:1; exchange_rate:number; subtotal_usd:number; discount_usd:number;
  membership_discount_usd:number; tax_usd:number; delivery_fee_usd:number;
  is_delivery:boolean; delivery_fee_paid_by:'customer'|'store';
  calculated_total_usd:number; rounding_adjustment_usd:number; total_usd:number; total_khr:number;
  tax_recomputed:boolean; tax_reason:'recomputed'|'no_tax_on_sale'|'tax_disabled'|'no_rate'|'rate_mismatch';
}
export class SaleHeaderQuoteError extends Error {
  readonly code='sale_header_quote_invalid'
  constructor(){super('The exact header quote is invalid.');this.name='SaleHeaderQuoteError'}
}
function money(value:unknown, nullable=false):number {
  if(nullable && value==null)return 0
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||roundMoney4(value)!==value)throw new SaleHeaderQuoteError()
  return value
}
/** The existing amended-tax policy, shared verbatim with review UI. No current
 * catalogue or FX lookup is permitted here; the saved basket rate is authority. */
export function quoteSaleMutationHeader(
  sale:Record<string,unknown>, subtotalUsd:number,
  settings:{tax_enabled:unknown;tax_rate:unknown},
  overrides:{is_delivery?:boolean;delivery_fee_usd?:number;delivery_fee_paid_by?:'customer'|'store'}={},
):SaleMutationHeaderQuote {
  const subtotal=money(subtotalUsd),oldSubtotal=money(sale.subtotal_usd,true)
  const discount=money(sale.discount_usd,true),member=money(sale.membership_discount_usd,true),storedTax=money(sale.tax_usd,true)
  const discounts=sumMoney4([discount,member])
  if(discounts>subtotal||discounts>oldSubtotal)throw new SaleHeaderQuoteError()
  const before=subtractMoney4(oldSubtotal,discounts),after=subtractMoney4(subtotal,discounts)
  const rawPercent=Number(String(settings.tax_rate??'').trim()),percent=Number.isFinite(rawPercent)&&rawPercent>0?rawPercent:0
  const enabledText=String(settings.tax_enabled??'').trim().toLowerCase()
  const enabled=enabledText===''?percent>0:!['0','false','off','no'].includes(enabledText)
  let tax=storedTax,reason:SaleMutationHeaderQuote['tax_reason']='recomputed'
  if(storedTax<=0)reason='no_tax_on_sale'
  else if(!enabled)reason='tax_disabled'
  else if(percent<=0)reason='no_rate'
  else if(percentageMoney4(before,percent)!==storedTax)reason='rate_mismatch'
  else tax=percentageMoney4(after,percent)
  if(tax>0&&after===0)throw new SaleHeaderQuoteError()
  const rate=sale.exchange_rate
  if(typeof rate!=='number'||!Number.isFinite(rate)||rate<=0)throw new SaleHeaderQuoteError()
  const isDelivery=overrides.is_delivery??Boolean(Number(sale.is_delivery)||0)
  const payer=overrides.delivery_fee_paid_by??String(sale.delivery_fee_paid_by||'customer')
  if(typeof isDelivery!=='boolean'||!['customer','store'].includes(payer))throw new SaleHeaderQuoteError()
  const delivery=money(overrides.delivery_fee_usd??sale.delivery_fee_usd,true)
  const raw=sumMoney4([after,tax,isDelivery&&payer==='customer'?delivery:0])
  const rounded=settlementRounding4(raw)
  return {version:1,exchange_rate:rate,subtotal_usd:subtotal,discount_usd:discount,membership_discount_usd:member,tax_usd:tax,
    delivery_fee_usd:delivery,is_delivery:isDelivery,delivery_fee_paid_by:payer as 'customer'|'store',
    calculated_total_usd:rounded.internalTotal4,rounding_adjustment_usd:rounded.roundingAdjustment4,total_usd:rounded.payableTotal2,
    total_khr:multiplyMoney4(rounded.payableTotal2,rate),tax_recomputed:reason==='recomputed',tax_reason:reason}
}
/** Missing is a compatibility/review conflict; malformed is a client error.
 * Comparing the complete shape prevents a matching payable from hiding a
 * changed tax/component or offsetting rounding adjustment. */
export function compareSaleHeaderQuote(expected:unknown,actual:SaleMutationHeaderQuote):'missing'|'mismatch'|'match' {
  if(expected===undefined)return 'missing'
  if(!expected||typeof expected!=='object'||Array.isArray(expected))throw new SaleHeaderQuoteError()
  const row=expected as Record<string,unknown>,keys=Object.keys(actual)
  if(Object.keys(row).length!==keys.length||keys.some(key=>!Object.prototype.hasOwnProperty.call(row,key)))throw new SaleHeaderQuoteError()
  for(const key of keys){
    const target=actual[key as keyof SaleMutationHeaderQuote],value=row[key]
    if(typeof value!==typeof target)throw new SaleHeaderQuoteError()
    if(typeof value==='number'&&(!Number.isFinite(value)||(key!=='rounding_adjustment_usd'&&value<0)))throw new SaleHeaderQuoteError()
    if(typeof value==='number'&&key!=='version'&&key!=='exchange_rate') {
      try {if(roundMoney4(value)!==value||(key==='total_usd'&&roundMoney2(value)!==value))throw new SaleHeaderQuoteError()}
      catch {throw new SaleHeaderQuoteError()}
    }
  }
  if(row.version!==1||!['customer','store'].includes(String(row.delivery_fee_paid_by))
    ||!['recomputed','no_tax_on_sale','tax_disabled','no_rate','rate_mismatch'].includes(String(row.tax_reason)))throw new SaleHeaderQuoteError()
  if(Number(row.exchange_rate)<=0||row.tax_recomputed!==(row.tax_reason==='recomputed'))throw new SaleHeaderQuoteError()
  try {
    const net=subtractMoney4(Number(row.subtotal_usd),sumMoney4([Number(row.discount_usd),Number(row.membership_discount_usd)]))
    if(net<0)throw new SaleHeaderQuoteError()
    const raw=sumMoney4([net,Number(row.tax_usd),row.is_delivery&&row.delivery_fee_paid_by==='customer'?Number(row.delivery_fee_usd):0])
    const rounded=settlementRounding4(raw)
    if(raw!==row.calculated_total_usd||rounded.payableTotal2!==row.total_usd||rounded.roundingAdjustment4!==row.rounding_adjustment_usd
      ||multiplyMoney4(rounded.payableTotal2,Number(row.exchange_rate))!==row.total_khr)throw new SaleHeaderQuoteError()
  } catch {throw new SaleHeaderQuoteError()}
  return keys.every(key=>row[key]===actual[key as keyof SaleMutationHeaderQuote])?'match':'mismatch'
}
