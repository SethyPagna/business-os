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
  constructor(readonly code: 'invalid_decimal' | 'money_overflow' | 'division_by_zero' | 'too_many_terms' | 'negative_selling_price') {
    super(code)
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
function units(value: Fraction, places: 2 | 4, mode: 'nearest' | 'ceil'): bigint {
  const scaled = value.n * (places === 4 ? 10_000n : 100n)
  let rounded = scaled / value.d
  const remainder = scaled % value.d
  if (mode === 'ceil') {
    if (remainder > 0n) rounded += 1n
  } else if (abs(remainder) * 2n >= value.d) {
    rounded += scaled < 0n ? -1n : 1n
  }
  return rounded
}
function output(value: Fraction, places: 2 | 4 = 4, mode: 'nearest' | 'ceil' = 'nearest'): number {
  bounded(value)
  const result = units(value, places, mode)
  const units4 = places === 4 ? result : result * 100n
  if (abs(units4) > MAX_UNITS4) throw new MoneyPrecisionError('money_overflow')
  // The bound leaves Number spacing smaller than a four-decimal tick, but do
  // not rely on that fact alone: prove the actual JSON-number decimal roundtrip.
  const numeric = Number(result) / (places === 4 ? 10_000 : 100) || 0
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
