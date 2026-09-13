// Portable policy kernel. Keep this file byte-identical to its frontend/backend
// twin; test-money-precision-kernel.cjs enforces source and execution parity.
// No callers are migrated merely by introducing this module.
export type DecimalInput = number | string
export const MONEY_PRECISION_POLICY_VERSION = 1
export const MAX_MONEY_ABS = 100_000_000_000
export const MAX_MONEY_SUM_ITEMS = 10_000
const MAX_UNITS4 = 1_000_000_000_000_000n
type Fraction = { n: bigint; d: bigint }

export class MoneyPrecisionError extends RangeError {
  readonly code: 'invalid_decimal' | 'money_overflow' | 'division_by_zero' | 'too_many_terms' | 'negative_selling_price'
  constructor(code: MoneyPrecisionError['code']) {
    super(code)
    this.code = code
    this.name = 'MoneyPrecisionError'
  }
}

function abs(n: bigint): bigint { return n < 0n ? -n : n }
function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) { const remainder = a % b; a = b; b = remainder }
  return a
}
function fraction(n: bigint, d: bigint): Fraction {
  if (d === 0n) throw new MoneyPrecisionError('division_by_zero')
  if (d < 0n) { n = -n; d = -d }
  const divisor = gcd(abs(n), d)
  return { n: n / divisor, d: d / divisor }
}

// Decimal text is the source of truth. Number inputs mean their shortest
// decimal representation, NOT recovery of digits lost in earlier JS arithmetic.
// Currency symbols/group separators/blank/null/booleans are rejected.
function decimal(value: DecimalInput): Fraction {
  if ((typeof value !== 'string' && typeof value !== 'number')
    || (typeof value === 'number' && !Number.isFinite(value))) throw new MoneyPrecisionError('invalid_decimal')
  const text = String(value).trim()
  if (!text || text.length > 96) throw new MoneyPrecisionError('invalid_decimal')
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d{1,2}))?$/.exec(text)
  if (!match) throw new MoneyPrecisionError('invalid_decimal')
  const whole = match[2] || ''
  const tail = match[3] ?? match[4] ?? ''
  const digits = whole + tail
  const exponent = Number(match[5] || 0)
  if (digits.length > 40 || tail.length > 24 || Math.abs(exponent) > 24) throw new MoneyPrecisionError('invalid_decimal')
  const scale = tail.length - exponent
  const sign = match[1] === '-' ? -1n : 1n
  const integer = BigInt(digits) * sign
  return scale >= 0
    ? fraction(integer, 10n ** BigInt(scale))
    : fraction(integer * 10n ** BigInt(-scale), 1n)
}

function bounded(value: Fraction): Fraction {
  if (abs(value.n) > BigInt(MAX_MONEY_ABS) * value.d) throw new MoneyPrecisionError('money_overflow')
  return value
}
function money(value: DecimalInput): Fraction { return bounded(decimal(value)) }
function plus(a: Fraction, b: Fraction): Fraction { return fraction(a.n * b.d + b.n * a.d, a.d * b.d) }
/** Quantity coverage only: exact decimal subtraction, without money rounding or
 * a monetary amount bound. Unsupported decimal resources fail explicitly. */
export function subtractDecimalSum(total: DecimalInput, values: readonly DecimalInput[]): string {
  if (values.length > MAX_MONEY_SUM_ITEMS) throw new MoneyPrecisionError('too_many_terms')
  let result = decimal(total)
  for (const value of values) {
    const part = decimal(value)
    result = plus(result, { n: -part.n, d: part.d })
  }
  if (result.n === 0n) return '0'
  let scale = 0, power = 1n
  while (power % result.d !== 0n && scale < 48) { scale++; power *= 10n }
  if (power % result.d !== 0n) throw new MoneyPrecisionError('invalid_decimal')
  const integer = abs(result.n) * (power / result.d)
  const exponent = scale > 24 ? -24 : 0
  const places = scale + exponent
  const digits = String(integer).padStart(places + 1, '0')
  const text = (result.n < 0n ? '-' : '') + (places
    ? digits.slice(0, -places) + '.' + digits.slice(-places) : digits) + (exponent ? 'e-24' : '')
  const restored = decimal(text)
  if (restored.n * result.d !== result.n * restored.d) throw new MoneyPrecisionError('invalid_decimal')
  return text
}
function units(value: Fraction, places: 0 | 2 | 4, mode: 'nearest' | 'ceil'): bigint {
  const scaled = value.n * (places === 4 ? 10_000n : places === 2 ? 100n : 1n)
  let rounded = scaled / value.d
  const remainder = scaled % value.d
  if (mode === 'ceil') {
    if (remainder > 0n) rounded += 1n
  } else if (abs(remainder) * 2n >= value.d) {
    rounded += scaled < 0n ? -1n : 1n
  }
  return rounded
}
function output(value: Fraction, places: 0 | 2 | 4 = 4, mode: 'nearest' | 'ceil' = 'nearest'): number {
  bounded(value)
  const result = units(value, places, mode)
  const units4 = places === 4 ? result : result * (places === 2 ? 100n : 10_000n)
  if (abs(units4) > MAX_UNITS4) throw new MoneyPrecisionError('money_overflow')
  // The bound leaves Number spacing smaller than a four-decimal tick, but do
  // not rely on that fact alone: prove the actual JSON-number decimal roundtrip.
  const numeric = Number(result) / (places === 4 ? 10_000 : places === 2 ? 100 : 1) || 0
  const restored = decimal(numeric)
  if (restored.n * 10_000n !== units4 * restored.d) throw new MoneyPrecisionError('money_overflow')
  return numeric
}

export function roundMoney4(value: DecimalInput): number { return output(money(value)) }
/** Null/undefined/blank mean unknown only at this explicitly nullable boundary. */
export function nullableMoney4(value: DecimalInput | null | undefined): number | null {
  return value == null || (typeof value === 'string' && value.trim() === '') ? null : roundMoney4(value)
}
/** Settlement/display only. Never use this to prepare internal arithmetic. */
export function roundMoney2(value: DecimalInput): number { return output(money(value), 2) }
export function addMoney4(left: DecimalInput, right: DecimalInput): number {
  return output(plus(money(left), money(right)))
}
export function subtractMoney4(left: DecimalInput, right: DecimalInput): number {
  const rhs = money(right)
  return output(plus(money(left), { n: -rhs.n, d: rhs.d }))
}
/** Quantity/rate is parsed exactly, never rounded as money before multiplication. */
export function multiplyMoney4(amount: DecimalInput, quantityOrRate: DecimalInput): number {
  const a = money(amount), factor = decimal(quantityOrRate)
  return output(fraction(a.n * factor.n, a.d * factor.d))
}
/** Percent retains its precision; divide by 100 before the sole rounding. */
export function percentageMoney4(amount: DecimalInput, percent: DecimalInput): number {
  const a = money(amount), factor = decimal(percent)
  return output(fraction(a.n * factor.n, a.d * factor.d * 100n))
}
/** Product percentage: preserve the original amount, quantity and percent until
 * the sole nearest-4dp rounding. Signed generic arithmetic matches multiplyMoney4
 * and percentageMoney4; callers enforce their business-specific nonnegative limits.
 */
export function percentageProductMoney4(amount: DecimalInput, quantity: DecimalInput, percent: DecimalInput): number {
  const a = money(amount), q = decimal(quantity), p = decimal(percent)
  return output(fraction(a.n * q.n * p.n, a.d * q.d * p.d * 100n))
}
/** Divisors/rates retain their own decimal precision; zero always rejects. */
export function divideMoney4(amount: DecimalInput, divisor: DecimalInput): number {
  const a = money(amount), b = decimal(divisor)
  return output(fraction(a.n * b.d, a.d * b.n))
}
function sum(values: readonly DecimalInput[]): Fraction {
  if (values.length > MAX_MONEY_SUM_ITEMS) throw new MoneyPrecisionError('too_many_terms')
  return values.reduce<Fraction>((total, value) => plus(total, money(value)), { n: 0n, d: 1n })
}
/** Sum exact inputs, round once. Do not pass already display-rounded values. */
export function sumMoney4(values: readonly DecimalInput[]): number { return output(sum(values)) }
/** Allocation totals: sum raw products exactly, then quantize once. This differs
 * from summing separately priced/quantized sale lines intentionally. */
function sumProducts(values: readonly { amount: DecimalInput; factor: DecimalInput }[]): Fraction {
  if (values.length > MAX_MONEY_SUM_ITEMS) throw new MoneyPrecisionError('too_many_terms')
  let total: Fraction = { n: 0n, d: 1n }
  for (const value of values) {
    const amount = money(value.amount), factor = decimal(value.factor)
    total = plus(total, fraction(amount.n * factor.n, amount.d * factor.d))
  }
  return total
}
export function sumProductsMoney4(values: readonly { amount: DecimalInput; factor: DecimalInput }[]): number {
  return output(sumProducts(values))
}
/** Weighted unit cost uses the unrounded numerator, never the rounded total. */
export function weightedMeanMoney4(values: readonly { amount: DecimalInput; factor: DecimalInput }[], totalWeight: DecimalInput): number {
  const total = sumProducts(values), weight = decimal(totalWeight)
  return output(fraction(total.n * weight.d, total.d * weight.n))
}
export function meanMoney4(values: readonly DecimalInput[]): number {
  if (!values.length) throw new MoneyPrecisionError('division_by_zero')
  const total = sum(values)
  return output(fraction(total.n, total.d * BigInt(values.length)))
}
/** Default SELLING price policy only, never cost/profit/discount rounding. */
export function sellingPriceCeilCent(value: DecimalInput): number {
  const parsed = money(value)
  if (parsed.n < 0n) throw new MoneyPrecisionError('negative_selling_price')
  return output(parsed, 2, 'ceil')
}
export type SettlementRounding4 = {
  internalTotal4: number
  payableTotal2: number
  roundingAdjustment4: number
}
/** Pay the displayed nearest-cent total; persist the signed exact adjustment. */
export function settlementRounding4(value: DecimalInput): SettlementRounding4 {
  const internalTotal4 = roundMoney4(value)
  const payableTotal2 = roundMoney2(internalTotal4)
  return { internalTotal4, payableTotal2, roundingAdjustment4: subtractMoney4(payableTotal2, internalTotal4) }
}


export type NativeChangeAmountsInput = {
  paidUsd: DecimalInput
  paidKhr: DecimalInput
  payableUsd: DecimalInput
  exchangeRate: DecimalInput
  changeExchangeRate: DecimalInput
}
export type NativeChangeAmountsResult = {
  changeUsd: number
  changeKhr: number
  hasOverpayment: boolean
}
/** Physical change alternatives, NOT internal four-decimal accounting values.
 * Both denominations derive independently from the same exact surplus:
 * paidUsd + paidKhr / exchangeRate - payableUsd. Never round that surplus first.
 * The boolean reports exact overpayment even if both displayed amounts are zero.
 * Tender and payable amounts must be nonnegative before any rounding. Rates
 * must be positive exact decimals; all inputs retain the kernel's resource bounds.
 */
export function nativeChangeAmounts({
  paidUsd, paidKhr, payableUsd, exchangeRate, changeExchangeRate,
}: NativeChangeAmountsInput): NativeChangeAmountsResult {
  const usd = money(paidUsd), khr = money(paidKhr), payable = money(payableUsd)
  if (usd.n < 0n || khr.n < 0n || payable.n < 0n) throw new MoneyPrecisionError('invalid_decimal')
  const rate = decimal(exchangeRate), changeRate = decimal(changeExchangeRate)
  for (const value of [rate, changeRate]) {
    if (value.n === 0n) throw new MoneyPrecisionError('division_by_zero')
    if (value.n < 0n) throw new MoneyPrecisionError('invalid_decimal')
  }
  const converted = fraction(khr.n * rate.d, khr.d * rate.n)
  const surplus = plus(plus(usd, converted), { n: -payable.n, d: payable.d })
  if (surplus.n <= 0n) return { changeUsd: 0, changeKhr: 0, hasOverpayment: false }
  return {
    changeUsd: output(surplus, 2),
    changeKhr: output(fraction(surplus.n * changeRate.n, surplus.d * changeRate.d), 0),
    hasOverpayment: true,
  }
}
