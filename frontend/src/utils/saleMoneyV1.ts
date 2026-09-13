import { multiplyMoney4, nativeChangeAmounts, roundMoney2, roundMoney4, subtractMoney4, sumMoney4 } from './moneyPrecision.ts'
import { parseSaleItemPricing, type SaleItemPricingSnapshot } from './saleItemPricing.ts'

export const SALE_MONEY_VERSION = 1 as const
export class SaleMoneyUnavailableError extends Error {
  readonly code = 'sale_money_snapshot_unavailable'
  constructor() { super('money_receipt_unavailable'); this.name = 'SaleMoneyUnavailableError' }
}

export class SaleCheckoutRecoveryRequiredError extends Error {
  readonly code = 'sale_checkout_recovery_required'
  constructor() { super('money_checkout_recovery_required'); this.name = 'SaleCheckoutRecoveryRequiredError' }
}

const MAX_MONEY = 100_000_000_000
const moneyNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_MONEY
const nonnegativeMoney = (value: unknown): value is number => moneyNumber(value) && value >= 0
const plainRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function validSaleLines(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 10_000 && value.every(line => plainRecord(line)
    && typeof line.quantity === 'number' && Number.isFinite(line.quantity) && line.quantity > 0 && line.quantity <= MAX_MONEY
    && nonnegativeMoney(line.applied_price_usd ?? line.price_usd)
    && (line.total_usd === undefined || nonnegativeMoney(line.total_usd)))
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
  if (!validSaleLines(source.items) || !['subtotal_usd', 'total_usd', 'amount_paid_usd', 'amount_paid_khr'].every(key => nonnegativeMoney(source[key]))
    || !moneyNumber(source.exchange_rate) || source.exchange_rate <= 0 || typeof source.sale_status !== 'string' || !source.sale_status.trim()) throw new SaleCheckoutRecoveryRequiredError()
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
  is_delivery: 'isDelivery', delivery_fee_paid_by: 'deliveryFeePaidBy',
  change_is_actual: 'changeIsActual', change_exchange_rate: 'changeExchangeRate',
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

function validateReceiptPricing(items: Record<string, unknown>[], fields: Record<string, unknown>): void {
  try {
    if (items.length > 200) throw new Error('pricing_bounds')
    const byKey = new Map<string, { item: Record<string, unknown>; snapshot: SaleItemPricingSnapshot }>()
    const pools = new Map<string, string>()
    for (const item of items) {
      if (typeof item.pricing_snapshot_json !== 'string') throw new Error('missing_pricing')
      const snapshot = parseSaleItemPricing(item.pricing_snapshot_json)
      if (!snapshot || byKey.has(snapshot.line_key) || snapshot.pool.exchange_rate !== fields.exchange_rate
        || snapshot.quantities[snapshot.line_key] !== item.quantity) throw new Error('pricing_identity')
      const captured = snapshot.pool.lines.find(line => line.line_key === snapshot.line_key)
      if (!captured || captured.product.id !== item.product_id) throw new Error('pricing_product')
      const poolJson = JSON.stringify({ pool: snapshot.pool, quantities: snapshot.quantities })
      if (pools.has(snapshot.pool.pool_key) && pools.get(snapshot.pool.pool_key) !== poolJson) throw new Error('pricing_pool_identity')
      pools.set(snapshot.pool.pool_key, poolJson)
      for (const key of ['base_price_usd', 'base_price_khr', 'applied_price_usd', 'applied_price_khr', 'total_usd', 'total_khr'] as const)
        if (item[key] !== snapshot.amounts[key]) throw new Error('pricing_amount')
      byKey.set(snapshot.line_key, { item, snapshot })
    }
    for (const { snapshot } of byKey.values()) {
      for (const member of snapshot.pool.lines) {
        const sibling = byKey.get(member.line_key)
        if (!sibling || JSON.stringify(sibling.snapshot.pool) !== JSON.stringify(snapshot.pool)
          || JSON.stringify(sibling.snapshot.quantities) !== JSON.stringify(snapshot.quantities)) throw new Error('pricing_pool')
      }
      const allocation = snapshot.allocation_context
      if (allocation.lines.length !== items.length || allocation.discount_usd !== fields.discount_usd
        || allocation.membership_discount_usd !== fields.membership_discount_usd || allocation.tax_usd !== fields.tax_usd) throw new Error('pricing_allocation')
      for (const line of allocation.lines) {
        const sibling = byKey.get(line.line_key)
        if (!sibling || line.amount !== sibling.item.total_usd
          || JSON.stringify(sibling.snapshot.allocation_context) !== JSON.stringify(allocation)) throw new Error('pricing_allocation_member')
      }
    }
  } catch { throw new SaleMoneyUnavailableError() }
}

/** No locally calculated fallback is a substitute for the saved receipt. */
export function canonicalSaleReceipt(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new SaleMoneyUnavailableError()
  const envelope = value as Record<string, unknown>
  const source = envelope.sale && typeof envelope.sale === 'object' && !Array.isArray(envelope.sale)
    ? envelope.sale as Record<string, unknown> : envelope
  const fields = saleMoneyResponseFields(source)
  const required = ['total_usd', 'subtotal_usd', 'discount_usd', 'membership_discount_usd', 'tax_usd', 'exchange_rate', 'amount_paid_usd', 'amount_paid_khr']
  if (required.some(key => !nonnegativeMoney(fields[key])) || !Number.isSafeInteger(source.id) || Number(source.id) <= 0 || Number(fields.exchange_rate) <= 0) throw new SaleMoneyUnavailableError()
  const items = typeof fields.items === 'string' ? (() => { try { return JSON.parse(fields.items as string) } catch { return null } })() : fields.items
  if (!validSaleLines(items)) throw new SaleMoneyUnavailableError()
  const version = fields.money_precision_version ?? 0
  if (version !== 0 && version !== 1) throw new SaleMoneyUnavailableError()
  if (version === 0 && ((fields.calculated_total_usd !== undefined && fields.calculated_total_usd !== null) || (fields.rounding_adjustment_usd !== undefined && fields.rounding_adjustment_usd !== null && fields.rounding_adjustment_usd !== 0))) throw new SaleMoneyUnavailableError()
  if (version === 1) {
    if (['subtotal_khr', 'discount_khr', 'membership_discount_khr', 'tax_khr', 'total_khr', 'delivery_fee_usd', 'delivery_fee_khr', 'change_usd', 'change_khr'].some(key => !nonnegativeMoney(fields[key]))) throw new SaleMoneyUnavailableError()
    const raw = fields.calculated_total_usd, adjustment = fields.rounding_adjustment_usd, total = Number(fields.total_usd)
    if (!nonnegativeMoney(raw) || !moneyNumber(adjustment)
      || roundMoney4(Number(raw)) !== Number(raw) || roundMoney4(Number(adjustment)) !== Number(adjustment)
      || roundMoney2(Number(raw)) !== total || subtractMoney4(total, Number(raw)) !== Number(adjustment)) throw new SaleMoneyUnavailableError()
    if (required.filter(key => key !== 'exchange_rate').some(key => roundMoney4(Number(fields[key])) !== fields[key])) throw new SaleMoneyUnavailableError()
    if (items.some(line => !nonnegativeMoney(line.total_usd) || roundMoney4(line.total_usd) !== line.total_usd || roundMoney4(Number(line.applied_price_usd ?? line.price_usd)) !== (line.applied_price_usd ?? line.price_usd))) throw new SaleMoneyUnavailableError()
    // Every v1 line requires the server's complete captured pricing proof.
    // A rounded unit projection is never a replacement for its exact line.
    validateReceiptPricing(items, fields)
    // Sum the saved authoritative LINE snapshots, not catalogue prices or
    // rounded display unit prices. Per-unit projection agreement is checked
    // separately by the backend's versioned line policy.
    if (sumMoney4(items.map(line => Number(line.total_usd))) !== fields.subtotal_usd) throw new SaleMoneyUnavailableError()
    const fee = fields.delivery_fee_usd
    if (!nonnegativeMoney(fee)) throw new SaleMoneyUnavailableError()
    const isDelivery = fields.is_delivery ?? 0
    if (![0, 1, false, true].includes(isDelivery as number | boolean)) throw new SaleMoneyUnavailableError()
    const payer = fields.delivery_fee_paid_by ?? 'customer'
    if (isDelivery && payer !== 'customer' && payer !== 'store') throw new SaleMoneyUnavailableError()
    const customerFee = isDelivery && payer === 'customer' ? fee : 0
    if (sumMoney4([Number(fields.subtotal_usd), -Number(fields.discount_usd), -Number(fields.membership_discount_usd), Number(fields.tax_usd), customerFee]) !== raw) throw new SaleMoneyUnavailableError()
    for (const [usd, khr] of [['subtotal_usd', 'subtotal_khr'], ['discount_usd', 'discount_khr'], ['membership_discount_usd', 'membership_discount_khr'], ['tax_usd', 'tax_khr'], ['total_usd', 'total_khr'], ['delivery_fee_usd', 'delivery_fee_khr']]) {
      if (fields[khr] !== undefined && (!nonnegativeMoney(fields[khr]) || multiplyMoney4(Number(fields[usd]), Number(fields.exchange_rate)) !== fields[khr])) throw new SaleMoneyUnavailableError()
    }
    const actualChange = fields.change_is_actual
    if (!Number.isSafeInteger(fields.change_khr)) throw new SaleMoneyUnavailableError()
    if (actualChange !== undefined && actualChange !== 0 && actualChange !== 1) throw new SaleMoneyUnavailableError()
    if (actualChange === undefined && (fields.change_usd !== 0 || fields.change_khr !== 0)) throw new SaleMoneyUnavailableError()
    if (actualChange === 1) {
      // Physical change can predate a later basket/payment amendment. The
      // durable intent/rate establishes its meaning; current tender cannot
      // re-prove that historical event. Check denominations, never reprice it.
      if (!nonnegativeMoney(fields.change_exchange_rate) || fields.change_exchange_rate <= 0
        || roundMoney2(Number(fields.change_usd)) !== fields.change_usd || !Number.isSafeInteger(fields.change_khr)) throw new SaleMoneyUnavailableError()
    } else {
      const changeRate = fields.change_exchange_rate
      const hasChangeRate = changeRate !== undefined && changeRate !== null
      if (hasChangeRate && (!nonnegativeMoney(changeRate) || changeRate <= 0)) throw new SaleMoneyUnavailableError()
      // Native denominations are rounded directly from the exact tender
      // surplus, never from an intermediate four-decimal USD conversion.
      const change = nativeChangeAmounts({ paidUsd: Number(fields.amount_paid_usd), paidKhr: Number(fields.amount_paid_khr),
        payableUsd: total, exchangeRate: Number(fields.exchange_rate), changeExchangeRate: hasChangeRate ? Number(changeRate) : 1 })
      if (change.changeUsd !== fields.change_usd || (!change.hasOverpayment && fields.change_khr !== 0)
        || (hasChangeRate && change.changeKhr !== fields.change_khr)) throw new SaleMoneyUnavailableError()
      // Computed KHR used the dedicated change-rate setting, which old rows
      // did not capture (change_exchange_rate is null). Do not substitute the
      // sale FX rate or pretend that these are two additive cash movements.
      // The placeholder rate above has no authority: its KHR result is ignored.
    }
  }
  // Do not synthesize a raw total for legacy receipts, including old retries.
  return JSON.parse(JSON.stringify({ ...source, ...fields, items, money_precision_version: version,
    ...(version === 0 ? { calculated_total_usd: null, rounding_adjustment_usd: 0 } : {}) })) as Record<string, unknown>
}
