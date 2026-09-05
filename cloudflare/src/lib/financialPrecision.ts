// Canonical financial quantization policy (owner-confirmed Sep 5 2026).
//
// Calculation values round to the nearest 4 decimal places. A discarded 5
// rounds the magnitude up; 4 or below rounds it down. Negative ties therefore
// move away from zero, preserving reversal symmetry: q(-x) === -q(x).
//
// This module parses decimal text and rounds scaled bigint units. It does not
// make rounding decisions with binary floating-point arithmetic. Number inputs
// use JavaScript's canonical decimal string; callers that retain original user
// or import text should pass that string for exact intent.
//
// Actual settlement is a different boundary from calculation precision: USD
// uses cents and KHR uses whole riel. Physical 100-riel counter rounding is a
// separate workflow rule and does not belong in this module.

export type FinancialDecimalInput = string | number | bigint

export type FinancialPrecisionErrorCode = 'INVALID_DECIMAL' | 'OUT_OF_RANGE'

export const FINANCIAL_CALCULATION_DECIMALS = 4 as const
export const ACTUAL_USD_DECIMALS = 2 as const
export const ACTUAL_KHR_DECIMALS = 0 as const

const MAX_SAFE_UNITS = BigInt(Number.MAX_SAFE_INTEGER)
const MAX_SOURCE_LENGTH = 256
const MAX_ABS_EXPONENT = 100_000
const DECIMAL_PATTERN = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/

export class FinancialPrecisionError extends RangeError {
  readonly code: FinancialPrecisionErrorCode

  constructor(code: FinancialPrecisionErrorCode, value: unknown) {
    super(`${code}: ${String(value)}`)
    this.name = 'FinancialPrecisionError'
    this.code = code
  }
}

type ParsedDecimal = {
  negative: boolean
  coefficient: bigint
  coefficientDigits: number
  decimalScale: number
}

function fail(code: FinancialPrecisionErrorCode, value: unknown): never {
  throw new FinancialPrecisionError(code, value)
}

function decimalSource(value: FinancialDecimalInput): string {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return fail('INVALID_DECIMAL', value)
    return Object.is(value, -0) ? '0' : value.toString()
  }
  if (typeof value !== 'string') return fail('INVALID_DECIMAL', value)

  const source = value.trim()
  if (!source) return fail('INVALID_DECIMAL', value)
  if (source.length > MAX_SOURCE_LENGTH) return fail('OUT_OF_RANGE', value)
  return source
}

function parseExponent(source: string | undefined, original: FinancialDecimalInput): number {
  if (!source) return 0
  const unsigned = source.replace(/^[+-]/, '').replace(/^0+/, '') || '0'
  if (unsigned.length > 6) return fail('OUT_OF_RANGE', original)

  const exponent = Number(source)
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_ABS_EXPONENT) {
    return fail('OUT_OF_RANGE', original)
  }
  return exponent
}

function parseDecimal(value: FinancialDecimalInput): ParsedDecimal {
  const source = decimalSource(value)
  const match = DECIMAL_PATTERN.exec(source)
  if (!match) return fail('INVALID_DECIMAL', value)

  const negative = match[1] === '-'
  const integerPart = match[2] || ''
  const fractionalPart = match[3] ?? match[4] ?? ''
  const exponent = parseExponent(match[5], value)
  const unsignedDigits = `${integerPart}${fractionalPart}`.replace(/^0+/, '') || '0'

  return {
    negative: negative && unsignedDigits !== '0',
    coefficient: BigInt(unsignedDigits),
    coefficientDigits: unsignedDigits.length,
    decimalScale: fractionalPart.length - exponent,
  }
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    fail('OUT_OF_RANGE', decimals)
  }
}

function powerOfTen(exponent: number): bigint {
  return 10n ** BigInt(exponent)
}

/**
 * Quantize decimal input to signed integer units using nearest, half-up by
 * magnitude. Units are constrained to Number.MAX_SAFE_INTEGER so a later
 * JSON-number adapter cannot silently lose integer identity.
 */
export function quantizeHalfUpMagnitudeToUnits(
  value: FinancialDecimalInput,
  decimals: number,
): bigint {
  assertDecimals(decimals)
  const parsed = parseDecimal(value)
  if (parsed.coefficient === 0n) return 0n

  const shift = decimals - parsed.decimalScale
  let magnitude: bigint

  if (shift >= 0) {
    // MAX_SAFE_UNITS has 16 digits. Reject before constructing enormous powers.
    if (parsed.coefficientDigits + shift > 16) return fail('OUT_OF_RANGE', value)
    magnitude = parsed.coefficient * powerOfTen(shift)
  } else {
    const discardedDigits = -shift
    if (discardedDigits > parsed.coefficientDigits) {
      magnitude = 0n
    } else {
      const divisor = powerOfTen(discardedDigits)
      const quotient = parsed.coefficient / divisor
      const remainder = parsed.coefficient % divisor
      magnitude = quotient + (remainder * 2n >= divisor ? 1n : 0n)
    }
  }

  if (magnitude > MAX_SAFE_UNITS) return fail('OUT_OF_RANGE', value)
  if (magnitude === 0n) return 0n
  return parsed.negative ? -magnitude : magnitude
}

export function formatScaledUnits(units: bigint, decimals: number): string {
  assertDecimals(decimals)
  const magnitude = units < 0n ? -units : units
  if (magnitude > MAX_SAFE_UNITS) return fail('OUT_OF_RANGE', units)

  const digits = magnitude.toString().padStart(decimals + 1, '0')
  const sign = units < 0n ? '-' : ''
  if (decimals === 0) return `${sign}${digits}`
  const splitAt = digits.length - decimals
  return `${sign}${digits.slice(0, splitAt)}.${digits.slice(splitAt)}`
}

function scaledUnitsToNumber(units: bigint, decimals: number): number {
  return Number(formatScaledUnits(units, decimals))
}

export function financialCalculationUnits(value: FinancialDecimalInput): bigint {
  return quantizeHalfUpMagnitudeToUnits(value, FINANCIAL_CALCULATION_DECIMALS)
}

export function financialCalculationValue(value: FinancialDecimalInput): number {
  return scaledUnitsToNumber(financialCalculationUnits(value), FINANCIAL_CALCULATION_DECIMALS)
}

export function actualUsdMinorUnits(value: FinancialDecimalInput): bigint {
  return quantizeHalfUpMagnitudeToUnits(value, ACTUAL_USD_DECIMALS)
}

export function actualUsdValue(value: FinancialDecimalInput): number {
  return scaledUnitsToNumber(actualUsdMinorUnits(value), ACTUAL_USD_DECIMALS)
}

export function actualKhrMinorUnits(value: FinancialDecimalInput): bigint {
  return quantizeHalfUpMagnitudeToUnits(value, ACTUAL_KHR_DECIMALS)
}

export function actualKhrValue(value: FinancialDecimalInput): number {
  return scaledUnitsToNumber(actualKhrMinorUnits(value), ACTUAL_KHR_DECIMALS)
}
