import { type DecimalInput, roundMoney4, roundMoney2, settlementRounding4, subtractDecimalSum } from './moneyPrecision'

export type SaleMoneyPrecisionV1 = {
  money_precision_version: 1
  calculated_total_usd: number
  rounding_adjustment_usd: number
  total_usd: number
}

export class SaleMoneyContractError extends Error {
  readonly code: string
  constructor(code: string) { super(code); this.code = code; this.name = 'SaleMoneyContractError' }
}

/** Validate a captured canonical value, never silently normalize a snapshot. */
export function canonicalMoney4(value: unknown, nonnegative = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value)
    || (nonnegative && value < 0) || roundMoney4(value) !== value) {
    throw new SaleMoneyContractError('money_precision_invalid_snapshot')
  }
  return value
}

/** Explicit new-basket boundary only. No client age/flag grants legacy status. */
export function buildSaleMoneyPrecision(rawTotal: DecimalInput): SaleMoneyPrecisionV1 {
  if (Number(rawTotal) < 0) throw new SaleMoneyContractError('money_precision_negative_total')
  const value = settlementRounding4(rawTotal)
  return { money_precision_version: 1, calculated_total_usd: value.internalTotal4,
    rounding_adjustment_usd: value.roundingAdjustment4, total_usd: value.payableTotal2 }
}

/** v0 is a storage shape, not authorization to accept a new legacy request.
 * Returns the original object: historical money is neither rounded nor inferred. */
export function validateSaleMoneySnapshot<T extends {
  money_precision_version?: unknown; calculated_total_usd?: unknown;
  rounding_adjustment_usd?: unknown; total_usd?: unknown
}>(row: T): T {
  const version = row.money_precision_version
  if (version === undefined || version === 0) {
    if (row.calculated_total_usd != null || (row.rounding_adjustment_usd !== undefined && row.rounding_adjustment_usd !== 0))
      throw new SaleMoneyContractError('money_precision_invalid_legacy_shape')
    return row
  }
  if (version !== 1) throw new SaleMoneyContractError('money_precision_unsupported_version')
  const raw = canonicalMoney4(row.calculated_total_usd, true)
  const adjustment = canonicalMoney4(row.rounding_adjustment_usd)
  const payable = canonicalMoney4(row.total_usd, true)
  if (roundMoney2(payable) !== payable || Math.abs(adjustment) > 0.005
    || subtractDecimalSum(payable, [raw, adjustment]) !== '0'
    || roundMoney2(raw) !== payable) throw new SaleMoneyContractError('money_precision_invalid_equation')
  return row
}

/** Monetary basis is independent from the availability of original item rules. */
export function hasRecordedSaleMoneyPrecision(row:Parameters<typeof validateSaleMoneySnapshot>[0]):boolean {
  validateSaleMoneySnapshot(row)
  return row.money_precision_version===1 || row.calculated_total_usd!=null
}
