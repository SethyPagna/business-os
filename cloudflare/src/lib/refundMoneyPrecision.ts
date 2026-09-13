import { type DecimalInput, roundMoney2, roundMoney4, subtractMoney4, sumMoney4 } from './moneyPrecision'
import { canonicalMoney4, SaleMoneyContractError } from './saleMoneyPrecision'

export type RefundMoneyPrecisionV1 = {
  money_precision_version: 1
  calculated_refund_usd: number
  rounding_adjustment_usd: number
  total_refund_usd: number
}

export function validateRefundMoneySnapshot<T extends {
  money_precision_version?: unknown; calculated_refund_usd?: unknown;
  rounding_adjustment_usd?: unknown; total_refund_usd?: unknown
}>(row: T): T {
  if (row.money_precision_version === undefined || row.money_precision_version === 0) {
    if (row.calculated_refund_usd != null || (row.rounding_adjustment_usd !== undefined && row.rounding_adjustment_usd !== 0))
      throw new SaleMoneyContractError('money_precision_invalid_legacy_shape')
    return row
  }
  if (row.money_precision_version !== 1) throw new SaleMoneyContractError('money_precision_unsupported_version')
  const raw = canonicalMoney4(row.calculated_refund_usd, true)
  const adjustment = canonicalMoney4(row.rounding_adjustment_usd)
  const payout = canonicalMoney4(row.total_refund_usd, true)
  // A cumulative cent allocation can differ from independently rounded raw.
  if (roundMoney2(payout) !== payout || Math.abs(adjustment) >= 0.01
    || subtractMoney4(payout, raw) !== adjustment)
    throw new SaleMoneyContractError('money_precision_invalid_equation')
  return row
}

/** Caller supplies canonical entitlement and an authoritative, CAS-protected
 * active cohort. No line/receipt discount, tax, delivery or status policy here.
 * Caller must resolve an existing receipt before calling; this is not a ledger. */
export function buildRefundMoneyPrecision(input: {
  eligibleRaw: DecimalInput
  originalPayable: number
  previous: readonly RefundMoneyPrecisionV1[]
}): RefundMoneyPrecisionV1 {
  const cap = canonicalMoney4(input.originalPayable, true)
  if (roundMoney2(cap) !== cap || Number(input.eligibleRaw) < 0)
    throw new SaleMoneyContractError('money_precision_invalid_refund_cap')
  const raw = roundMoney4(input.eligibleRaw)
  for (const row of input.previous) {
    if (row.money_precision_version !== 1) throw new SaleMoneyContractError('money_precision_legacy_refund_review_needed')
    validateRefundMoneySnapshot(row)
  }
  const paid = sumMoney4(input.previous.map(row => row.total_refund_usd))
  if (paid !== roundMoney2(sumMoney4(input.previous.map(row => row.calculated_refund_usd))))
    throw new SaleMoneyContractError('money_precision_invalid_refund_cohort')
  const cumulativeRaw = sumMoney4([...input.previous.map(row => row.calculated_refund_usd), raw])
  const cumulativePayable = roundMoney2(cumulativeRaw)
  // Refuse excess entitlement rather than disguising a cap as rounding.
  if (paid > cap || cumulativePayable > cap || cumulativePayable < paid)
    throw new SaleMoneyContractError('money_precision_refund_cap_exceeded')
  const payout = subtractMoney4(cumulativePayable, paid)
  const result: RefundMoneyPrecisionV1 = { money_precision_version: 1,
    calculated_refund_usd: raw, total_refund_usd: payout,
    rounding_adjustment_usd: subtractMoney4(payout, raw) }
  return validateRefundMoneySnapshot(result)
}
