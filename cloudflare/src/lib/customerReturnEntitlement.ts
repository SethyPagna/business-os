import { divideMoney4, multiplyMoney4, roundMoney2, roundMoney4, subtractDecimalSum, subtractMoney4, sumMoney4 } from './moneyPrecision'
import { validateRefundMoneySnapshot, type RefundMoneyPrecisionV1 } from './refundMoneyPrecision'
import { validateCapturedSaleBasket, type ReceiptLineAllocation, type SaleItemPricingSnapshot } from './saleItemPricing'
import { canonicalMoney4, SaleMoneyContractError } from './saleMoneyPrecision'

export const CUSTOMER_RETURN_REFUND_SNAPSHOT_VERSION = 1
export const CUSTOMER_RETURN_MAX_LINES = 50
export const CUSTOMER_RETURN_MAX_SALE_LINES = 200
export const CUSTOMER_RETURN_REFUND_SNAPSHOT_BYTES = 16_384

export type CustomerReturnSaleLine = {
  id: number
  product_id: number | null
  quantity: number
  total_usd: number
  total_khr: number
  base_price_usd: number
  base_price_khr: number
  applied_price_usd: number
  applied_price_khr: number
  product_discount_usd: number
  product_discount_khr: number
  manual_discount_usd: number
  manual_discount_khr: number
  manual_discount_type: string | null
  manual_discount_value: number
  price_mode: string | null
  pricing_snapshot_json: string | null
  pricing_snapshot_digest: string
}

export type CustomerReturnSource = {
  sale_id: number
  sale_revision: number
  money_precision_version: number
  calculated_total_usd: number | null
  total_usd: number
  subtotal_usd: number
  discount_usd: number
  membership_discount_usd: number
  tax_usd: number
  exchange_rate: number
  customer_delivery_fee_usd: number
  lines: CustomerReturnSaleLine[]
}

export type CustomerReturnRefundSnapshotV1 = {
  version: 1
  sale_id: number
  sale_item_id: number
  line_key: string
  pool_key: string
  source_sale_revision: number
  source_pricing_snapshot_digest: string
  sold_quantity: number
  return_quantity: number
  returned_quantity_before: number
  returned_quantity_after: number
  receipt_allocation: ReceiptLineAllocation
  net_entitlement_usd: number
  calculated_refund_before_usd: number
  calculated_refund_after_usd: number
  calculated_refund_usd: number
  calculated_refund_khr: number
  exchange_rate: number
  sale_product_entitlement_usd: number
  sale_product_payout_cap_usd: number
}

export type CustomerReturnPrior = RefundMoneyPrecisionV1 & {
  id: number
  items: Array<{ sale_item_id: number | null; quantity: number; total_usd: number; refund_snapshot_json: string | null }>
}

export type CustomerReturnQuoteLine = {
  sale_item_id: number
  quantity: number
  total_usd: number
  total_khr: number
  applied_price_usd: number
  applied_price_khr: number
  refund_snapshot_json: string
}

export type CustomerReturnQuoteV1 = RefundMoneyPrecisionV1 & {
  sale_id: number
  sale_revision: number
  total_refund_khr: number
  product_entitlement_usd: number
  product_payout_cap_usd: number
  items: CustomerReturnQuoteLine[]
}

function fail(code: string): never { throw new SaleMoneyContractError(code) }
function positiveId(value: unknown, code: string): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) fail(code)
  return number
}
function finitePositive(value: unknown, code: string): number {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) fail(code)
  return number
}
function sameJson(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right) }
function quantityDifference(left: number, right: number): string {
  try { return subtractDecimalSum(left, [right]) } catch { return fail('customer_return_quantity_invalid') }
}
function addQuantity(left: number, right: number): number {
  try {
    const exact = subtractDecimalSum(left, [-right])
    const stored = Number(exact)
    // Quantities are persisted as SQLite/JSON numbers. Refuse a mathematically
    // valid decimal sum if its exact value would disappear on that boundary.
    if (!Number.isFinite(stored) || subtractDecimalSum(stored, [exact]) !== '0') fail('customer_return_quantity_invalid')
    return stored
  } catch { return fail('customer_return_quantity_invalid') }
}
function quantityGreater(left: number, right: number): boolean {
  const difference = quantityDifference(left, right)
  return difference !== '0' && !difference.startsWith('-')
}

type Fraction = { n: bigint; d: bigint }
function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left
  let b = right < 0n ? -right : right
  while (b) { const remainder = a % b; a = b; b = remainder }
  return a
}
function decimalFraction(value: number): Fraction {
  if (!Number.isFinite(value) || value < 0) fail('customer_return_quantity_invalid')
  const match = /^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(String(value))
  if (!match) fail('customer_return_quantity_invalid')
  const tail = match[2] || ''
  const exponent = Number(match[3] || 0)
  if (tail.length > 24 || Math.abs(exponent) > 24) fail('customer_return_quantity_invalid')
  const digits = BigInt((match[1] || '0') + tail)
  const scale = tail.length - exponent
  let n = scale >= 0 ? digits : digits * 10n ** BigInt(-scale)
  let d = scale >= 0 ? 10n ** BigInt(scale) : 1n
  const divisor = gcd(n, d)
  n /= divisor; d /= divisor
  return { n, d }
}

/** One exact rational operation followed by one nearest-four-place rounding.
 * Never divide a unit projection and multiply it back. */
export function prorateCustomerReturnMoney4(amount: number, numerator: number, denominator: number): number {
  const money = canonicalMoney4(amount, true)
  const part = decimalFraction(numerator)
  const whole = decimalFraction(denominator)
  if (whole.n === 0n) fail('customer_return_quantity_invalid')
  if (quantityGreater(numerator, denominator)) fail('customer_return_quantity_invalid')
  const moneyUnits = BigInt(money.toFixed(4).replace('.', ''))
  const top = moneyUnits * part.n * whole.d
  const bottom = part.d * whole.n
  if (bottom <= 0n) fail('customer_return_quantity_invalid')
  let units = top / bottom
  if ((top % bottom) * 2n >= bottom) units += 1n
  return roundMoney4(`${units / 10_000n}.${(units % 10_000n).toString().padStart(4, '0')}`)
}

export function parseCustomerReturnRefundSnapshot(json: string | null | undefined): CustomerReturnRefundSnapshotV1 | null {
  if (json == null) return null
  if (typeof json !== 'string' || new TextEncoder().encode(json).byteLength > CUSTOMER_RETURN_REFUND_SNAPSHOT_BYTES) fail('customer_return_snapshot_invalid')
  let value: CustomerReturnRefundSnapshotV1
  try { value = JSON.parse(json) as CustomerReturnRefundSnapshotV1 } catch { return fail('customer_return_snapshot_invalid') }
  if (value?.version !== 1 || positiveId(value.sale_id, 'customer_return_snapshot_invalid') !== value.sale_id
    || positiveId(value.sale_item_id, 'customer_return_snapshot_invalid') !== value.sale_item_id
    || typeof value.line_key !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(value.line_key)
    || typeof value.pool_key !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(value.pool_key)
    || !/^[0-9a-f]{64}$/.test(value.source_pricing_snapshot_digest)
    || !Number.isSafeInteger(value.source_sale_revision) || value.source_sale_revision < 0) fail('customer_return_snapshot_invalid')
  const sold = finitePositive(value.sold_quantity, 'customer_return_snapshot_invalid')
  const quantity = finitePositive(value.return_quantity, 'customer_return_snapshot_invalid')
  const beforeQty = Number(value.returned_quantity_before)
  const afterQty = Number(value.returned_quantity_after)
  if (!Number.isFinite(beforeQty) || beforeQty < 0 || !Number.isFinite(afterQty)
    || quantityDifference(afterQty, addQuantity(beforeQty, quantity)) !== '0'
    || quantityGreater(afterQty, sold)) fail('customer_return_snapshot_invalid')
  for (const field of ['discount_usd', 'membership_discount_usd', 'tax_usd', 'net_entitlement_usd'] as const) {
    canonicalMoney4(value.receipt_allocation?.[field], true)
  }
  const entitlement = canonicalMoney4(value.net_entitlement_usd, true)
  if (entitlement !== value.receipt_allocation.net_entitlement_usd) fail('customer_return_snapshot_invalid')
  const before = canonicalMoney4(value.calculated_refund_before_usd, true)
  const after = canonicalMoney4(value.calculated_refund_after_usd, true)
  const current = canonicalMoney4(value.calculated_refund_usd, true)
  const rate = finitePositive(value.exchange_rate, 'customer_return_snapshot_invalid')
  if (after !== prorateCustomerReturnMoney4(entitlement, afterQty, sold)
    || before > prorateCustomerReturnMoney4(entitlement, beforeQty, sold)
    || current !== subtractMoney4(after, before)
    || canonicalMoney4(value.calculated_refund_khr, true) !== multiplyMoney4(current, rate)
    || canonicalMoney4(value.sale_product_entitlement_usd, true) < entitlement
    || roundMoney2(canonicalMoney4(value.sale_product_payout_cap_usd, true)) !== value.sale_product_payout_cap_usd) {
    fail('customer_return_snapshot_invalid')
  }
  return value
}

export function buildCustomerReturnQuoteV1(input: {
  sale: CustomerReturnSource
  requested: Array<{ sale_item_id: number; quantity: number }>
  previous: CustomerReturnPrior[]
}): CustomerReturnQuoteV1 {
  const saleId = positiveId(input.sale.sale_id, 'customer_return_sale_invalid')
  if (input.sale.money_precision_version !== 1 || !Number.isSafeInteger(input.sale.sale_revision) || input.sale.sale_revision < 0
    || input.sale.lines.length < 1 || input.sale.lines.length > CUSTOMER_RETURN_MAX_SALE_LINES
    || input.requested.length < 1 || input.requested.length > CUSTOMER_RETURN_MAX_LINES) fail('customer_return_sale_invalid')
  const rate = finitePositive(input.sale.exchange_rate, 'customer_return_sale_invalid')
  const saleTotal = canonicalMoney4(input.sale.total_usd, true)
  if (roundMoney2(saleTotal) !== saleTotal) fail('customer_return_sale_invalid')
  let capturedSnapshots: SaleItemPricingSnapshot[]
  try {
    capturedSnapshots = validateCapturedSaleBasket(
      input.sale.lines as unknown as readonly Record<string, unknown>[], input.sale as unknown as Record<string, unknown>,
    )
  } catch { return fail('customer_return_sale_invalid') }
  const sourceById = new Map<number, { row: CustomerReturnSaleLine; snapshot: SaleItemPricingSnapshot }>()
  for (const [index, row] of input.sale.lines.entries()) {
    const id = positiveId(row.id, 'customer_return_sale_invalid')
    if (sourceById.has(id) || !/^[0-9a-f]{64}$/.test(row.pricing_snapshot_digest)) fail('customer_return_sale_invalid')
    const snapshot = capturedSnapshots[index]
    sourceById.set(id, { row, snapshot })
  }
  const productEntitlement = sumMoney4([...sourceById.values()].map(({ snapshot }) => snapshot.receipt_allocation.net_entitlement_usd))
  const customerDelivery = canonicalMoney4(input.sale.customer_delivery_fee_usd, true)
  if (input.sale.calculated_total_usd == null
    || canonicalMoney4(input.sale.calculated_total_usd, true) !== sumMoney4([productEntitlement, customerDelivery])) fail('customer_return_sale_invalid')
  const payoutCap = Math.min(saleTotal, roundMoney2(productEntitlement))

  const previousByLine = new Map<number, { quantity: number; calculated: number }>()
  const priorHeaders: RefundMoneyPrecisionV1[] = []
  const previousReturnIds = new Set<number>()
  for (const prior of input.previous) {
    if (previousReturnIds.has(prior.id)) fail('customer_return_cohort_invalid')
    previousReturnIds.add(prior.id)
    if (!prior.items.length) fail('customer_return_legacy_refund_review_needed')
    validateRefundMoneySnapshot(prior)
    let headerCalculated = 0
    const priorSaleItemIds = new Set<number>()
    for (const item of prior.items) {
      const snapshot = parseCustomerReturnRefundSnapshot(item.refund_snapshot_json)
      if (!snapshot || snapshot.sale_id !== saleId || snapshot.sale_item_id !== item.sale_item_id
        || snapshot.return_quantity !== item.quantity || snapshot.calculated_refund_usd !== canonicalMoney4(item.total_usd, true)) fail('customer_return_legacy_refund_review_needed')
      if (priorSaleItemIds.has(snapshot.sale_item_id)) fail('customer_return_cohort_invalid')
      priorSaleItemIds.add(snapshot.sale_item_id)
      const source = sourceById.get(snapshot.sale_item_id)
      if (!source || snapshot.line_key !== source.snapshot.line_key || snapshot.pool_key !== source.snapshot.pool.pool_key
        || snapshot.source_pricing_snapshot_digest !== source.row.pricing_snapshot_digest
        || !sameJson(snapshot.receipt_allocation, source.snapshot.receipt_allocation)) fail('customer_return_cohort_invalid')
      const aggregate = previousByLine.get(snapshot.sale_item_id) || { quantity: 0, calculated: 0 }
      if (quantityDifference(snapshot.returned_quantity_before, aggregate.quantity) !== '0'
        || snapshot.calculated_refund_before_usd !== aggregate.calculated) fail('customer_return_cohort_invalid')
      aggregate.quantity = addQuantity(aggregate.quantity, item.quantity)
      aggregate.calculated = sumMoney4([aggregate.calculated, snapshot.calculated_refund_usd])
      if (quantityDifference(snapshot.returned_quantity_after, aggregate.quantity) !== '0'
        || snapshot.calculated_refund_after_usd !== aggregate.calculated) fail('customer_return_cohort_invalid')
      previousByLine.set(snapshot.sale_item_id, aggregate)
      headerCalculated = sumMoney4([headerCalculated, snapshot.calculated_refund_usd])
    }
    if (headerCalculated !== prior.calculated_refund_usd) fail('customer_return_cohort_invalid')
    priorHeaders.push(prior)
  }
  for (const [saleItemId, aggregate] of previousByLine) {
    const source = sourceById.get(saleItemId)
    if (!source || quantityGreater(aggregate.quantity, source.row.quantity)
      || aggregate.calculated !== prorateCustomerReturnMoney4(
        source.snapshot.receipt_allocation.net_entitlement_usd, aggregate.quantity, source.row.quantity,
      )) fail('customer_return_cohort_invalid')
  }

  const requestedIds = new Set<number>()
  const lines: CustomerReturnQuoteLine[] = []
  for (const request of input.requested) {
    const saleItemId = positiveId(request.sale_item_id, 'customer_return_line_invalid')
    const quantity = finitePositive(request.quantity, 'customer_return_line_invalid')
    if (requestedIds.has(saleItemId)) fail('customer_return_line_invalid')
    requestedIds.add(saleItemId)
    const source = sourceById.get(saleItemId)
    if (!source) fail('customer_return_line_invalid')
    const before = previousByLine.get(saleItemId) || { quantity: 0, calculated: 0 }
    const afterQuantity = addQuantity(before.quantity, quantity)
    if (quantityGreater(afterQuantity, source.row.quantity)) fail('customer_return_quantity_exceeded')
    const targetBefore = prorateCustomerReturnMoney4(source.snapshot.receipt_allocation.net_entitlement_usd, before.quantity, source.row.quantity)
    if (before.calculated > targetBefore) fail('customer_return_cohort_invalid')
    const targetAfter = prorateCustomerReturnMoney4(source.snapshot.receipt_allocation.net_entitlement_usd, afterQuantity, source.row.quantity)
    const calculated = subtractMoney4(targetAfter, before.calculated)
    const snapshot: CustomerReturnRefundSnapshotV1 = {
      version: 1, sale_id: saleId, sale_item_id: saleItemId, line_key: source.snapshot.line_key,
      pool_key: source.snapshot.pool.pool_key, source_sale_revision: input.sale.sale_revision,
      source_pricing_snapshot_digest: source.row.pricing_snapshot_digest,
      sold_quantity: source.row.quantity, return_quantity: quantity,
      returned_quantity_before: before.quantity, returned_quantity_after: afterQuantity,
      receipt_allocation: source.snapshot.receipt_allocation,
      net_entitlement_usd: source.snapshot.receipt_allocation.net_entitlement_usd,
      calculated_refund_before_usd: before.calculated, calculated_refund_after_usd: targetAfter,
      calculated_refund_usd: calculated, calculated_refund_khr: multiplyMoney4(calculated, rate), exchange_rate: rate,
      sale_product_entitlement_usd: productEntitlement, sale_product_payout_cap_usd: payoutCap,
    }
    const refundSnapshotJson = JSON.stringify(snapshot)
    parseCustomerReturnRefundSnapshot(refundSnapshotJson)
    lines.push({ sale_item_id: saleItemId, quantity, total_usd: calculated,
      total_khr: snapshot.calculated_refund_khr,
      applied_price_usd: calculated === 0 ? 0 : divideMoney4(calculated, quantity),
      applied_price_khr: snapshot.calculated_refund_khr === 0 ? 0 : divideMoney4(snapshot.calculated_refund_khr, quantity),
      refund_snapshot_json: refundSnapshotJson })
  }
  const calculated = sumMoney4(lines.map(line => line.total_usd))
  const priorCalculated = sumMoney4(priorHeaders.map(row => row.calculated_refund_usd))
  const priorPaid = sumMoney4(priorHeaders.map(row => row.total_refund_usd))
  const cumulativeTarget = Math.min(payoutCap, roundMoney2(sumMoney4([priorCalculated, calculated])))
  if (priorPaid > cumulativeTarget) fail('money_precision_refund_cap_exceeded')
  const total = subtractMoney4(cumulativeTarget, priorPaid)
  const header = validateRefundMoneySnapshot({ money_precision_version: 1 as const,
    calculated_refund_usd: calculated, total_refund_usd: total,
    rounding_adjustment_usd: subtractMoney4(total, calculated) })
  return { ...header, sale_id: saleId, sale_revision: input.sale.sale_revision,
    total_refund_khr: multiplyMoney4(total, rate), product_entitlement_usd: productEntitlement,
    product_payout_cap_usd: payoutCap, items: lines }
}
