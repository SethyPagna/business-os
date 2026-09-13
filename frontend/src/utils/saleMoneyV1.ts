import { roundMoney2, roundMoney4, subtractMoney4 } from './moneyPrecision.ts'

export const SALE_MONEY_VERSION = 1 as const
export class SaleMoneyUnavailableError extends Error {
  readonly code = 'sale_money_snapshot_unavailable'
  constructor() { super('money_receipt_unavailable'); this.name = 'SaleMoneyUnavailableError' }
}

export class SaleCheckoutRecoveryRequiredError extends Error {
  readonly code = 'sale_checkout_recovery_required'
  constructor() { super('money_checkout_recovery_required'); this.name = 'SaleCheckoutRecoveryRequiredError' }
}

/** A retry returns the saved wire body, including legacy bodies, byte-for-byte
 * in JSON representation. In particular it never stamps a new policy version. */
export function frozenSaleCheckoutBody(
  requestId: string,
  existing: unknown,
  createNew?: () => Record<string, unknown>,
): Record<string, unknown> {
  if (!requestId.trim()) throw new SaleCheckoutRecoveryRequiredError()
  const isRetry = existing !== undefined && existing !== null
  if (!isRetry && !createNew) throw new SaleCheckoutRecoveryRequiredError()
  const candidate = isRetry ? existing : createNew!()
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new SaleCheckoutRecoveryRequiredError()
  const source = candidate as Record<string, unknown>
  if (source.client_request_id !== requestId || (!isRetry && source.money_precision_version !== 1)) throw new SaleCheckoutRecoveryRequiredError()
  // Match the serialized HTTP representation and detach it from mutable cart,
  // discount and tender objects before the durable draft is saved.
  const serialized = JSON.stringify(source, (_key, value) => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new SaleCheckoutRecoveryRequiredError()
    return value
  })
  return JSON.parse(serialized) as Record<string, unknown>
}
const aliases = {
  money_precision_version: 'moneyPrecisionVersion', calculated_total_usd: 'calculatedTotalUsd', rounding_adjustment_usd: 'roundingAdjustmentUsd',
  subtotal_usd: 'subtotalUsd', subtotal_khr: 'subtotalKhr', total_usd: 'totalUsd', total_khr: 'totalKhr',
  discount_usd: 'discountUsd', discount_khr: 'discountKhr', membership_discount_usd: 'membershipDiscountUsd', membership_discount_khr: 'membershipDiscountKhr',
  tax_usd: 'taxUsd', tax_khr: 'taxKhr', delivery_fee_usd: 'deliveryFeeUsd', delivery_fee_khr: 'deliveryFeeKhr',
  amount_paid_usd: 'amountPaidUsd', amount_paid_khr: 'amountPaidKhr', change_usd: 'changeUsd', change_khr: 'changeKhr', exchange_rate: 'exchangeRate', items: 'items',
} as const

/** Presence matters: an old response must not erase fields with undefined. */
export function saleMoneyResponseFields(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {}
  const source = value as Record<string, unknown>, fields: Record<string, unknown> = {}
  for (const [snake, camel] of Object.entries(aliases)) {
    if (Object.prototype.hasOwnProperty.call(source, snake) && source[snake] !== undefined) fields[snake] = source[snake]
    else if (Object.prototype.hasOwnProperty.call(source, camel) && source[camel] !== undefined) fields[snake] = source[camel]
  }
  return fields
}

/** No locally calculated fallback is a substitute for the saved receipt. */
export function canonicalSaleReceipt(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new SaleMoneyUnavailableError()
  const envelope = value as Record<string, unknown>
  const source = envelope.sale && typeof envelope.sale === 'object' && !Array.isArray(envelope.sale)
    ? envelope.sale as Record<string, unknown> : envelope
  const fields = saleMoneyResponseFields(source)
  const required = ['total_usd', 'subtotal_usd', 'discount_usd', 'membership_discount_usd', 'tax_usd', 'exchange_rate', 'amount_paid_usd', 'amount_paid_khr']
  if (required.some(key => fields[key] == null || !Number.isFinite(Number(fields[key]))) || !source.id) throw new SaleMoneyUnavailableError()
  const items = typeof fields.items === 'string' ? (() => { try { return JSON.parse(fields.items as string) } catch { return null } })() : fields.items
  if (!Array.isArray(items)) throw new SaleMoneyUnavailableError()
  const version = fields.money_precision_version ?? 0
  if (version !== 0 && version !== 1) throw new SaleMoneyUnavailableError()
  if (version === 1) {
    const raw = fields.calculated_total_usd, adjustment = fields.rounding_adjustment_usd, total = Number(fields.total_usd)
    if (raw == null || adjustment == null || !Number.isFinite(Number(raw)) || !Number.isFinite(Number(adjustment))
      || roundMoney4(Number(raw)) !== Number(raw) || roundMoney4(Number(adjustment)) !== Number(adjustment)
      || roundMoney2(Number(raw)) !== total || subtractMoney4(total, Number(raw)) !== Number(adjustment)) throw new SaleMoneyUnavailableError()
  }
  // Do not synthesize a raw total for legacy receipts, including old retries.
  return { ...source, ...fields, items, money_precision_version: version,
    ...(version === 0 ? { calculated_total_usd: null, rounding_adjustment_usd: 0 } : {}) }
}
