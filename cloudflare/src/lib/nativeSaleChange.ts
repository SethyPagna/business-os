import {
  actualKhrValue,
  actualUsdValue,
  financialCalculationUnits,
  type FinancialDecimalInput,
} from './financialPrecision'
import { resolveChangeExchangeRate } from './saleTotals'

export type NativeSaleChangeErrorCode =
  | 'invalid_actual_change_intent'
  | 'actual_change_required'
  | 'invalid_actual_change_amount'
  | 'invalid_actual_change_precision'
  | 'invalid_actual_change_total'
  | 'invalid_actual_change_rate'

export class NativeSaleChangeValidationError extends Error {
  readonly statusCode = 400

  constructor(message: string, readonly code: NativeSaleChangeErrorCode) {
    super(message)
    this.name = 'NativeSaleChangeValidationError'
  }
}

export type NativeSaleChangePlan = {
  changeUsd: number
  changeKhr: number
  changeIsActual: 0 | 1
  changeExchangeRate: number | null
}

export type NativeSaleChangeInput = {
  /** Missing/false keeps the legacy computed dual representation. */
  actualIntent?: unknown
  /** Required when actualIntent is true; USD change uses whole cents. */
  rawChangeUsd?: unknown
  /** Required when actualIntent is true; KHR change uses whole riel. */
  rawChangeKhr?: unknown
  /** Canonical server-computed tender and total, never request totals. */
  amountPaidUsd: unknown
  amountPaidKhr: unknown
  totalUsd: unknown
  /** The sale's server-approved payment rate. */
  exchangeRate: unknown
  /** Raw server setting; invalid/blank follows the canonical main-rate fallback. */
  changeExchangeRate?: unknown
  /** Canonical computeSaleTotals output used when no actual intent was sent. */
  fallbackChangeUsd: unknown
  fallbackChangeKhr: unknown
}

export type StoredNativeSaleChangeInput = Omit<NativeSaleChangeInput,
  | 'actualIntent'
  | 'rawChangeUsd'
  | 'rawChangeKhr'
  | 'fallbackChangeUsd'
  | 'fallbackChangeKhr'
  | 'amountPaidUsd'
  | 'amountPaidKhr'
  | 'totalUsd'
  | 'exchangeRate'
> & {
  changeIsActual: unknown
  changeUsd: unknown
  changeKhr: unknown
}

export type StoredNativeSaleChange =
  | { kind: 'none'; usd: 0; khr: 0 }
  | { kind: 'actual'; usd: number; khr: number; changeExchangeRate: number }
  | { kind: 'unknown' }

const CALCULATION_SCALE = 10_000n
const MAX_DECIMAL_SOURCE_LENGTH = 256
const MAX_ABS_DECIMAL_EXPONENT = 100_000
const DECIMAL_PATTERN = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/

/** Must remain aligned with frontend/src/utils/rielRounding.ts RIEL_STEP. */
export const NATIVE_CHANGE_KHR_STEP = 100 as const

function fail(message: string, code: NativeSaleChangeErrorCode): never {
  throw new NativeSaleChangeValidationError(message, code)
}

function decimalInput(value: unknown, message: string): FinancialDecimalInput {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') return value
  return fail(message, 'invalid_actual_change_amount')
}

function calculationUnits(value: unknown, message: string): bigint {
  try {
    return financialCalculationUnits(decimalInput(value, message))
  } catch {
    return fail(message, 'invalid_actual_change_amount')
  }
}

type DecimalShape = { negative: boolean; coefficient: string; decimalScale: number }

function decimalShape(value: unknown, message: string): DecimalShape {
  const input = decimalInput(value, message)
  const source = typeof input === 'string' ? input.trim() : input.toString()
  if (!source || source.length > MAX_DECIMAL_SOURCE_LENGTH) return fail(message, 'invalid_actual_change_amount')
  const match = DECIMAL_PATTERN.exec(source)
  if (!match) return fail(message, 'invalid_actual_change_amount')
  const exponentSource = match[5] || '0'
  const exponent = Number(exponentSource)
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_ABS_DECIMAL_EXPONENT) {
    return fail(message, 'invalid_actual_change_amount')
  }
  const fraction = match[3] ?? match[4] ?? ''
  const coefficient = `${match[2] || ''}${fraction}`.replace(/^0+/, '') || '0'
  return {
    negative: match[1] === '-' && coefficient !== '0',
    coefficient,
    decimalScale: fraction.length - exponent,
  }
}

function hasExactIncrement(shape: DecimalShape, decimals: number): boolean {
  const discardedDigits = shape.decimalScale - decimals
  if (discardedDigits <= 0 || shape.coefficient === '0') return true
  if (discardedDigits > shape.coefficient.length) return false
  return !/[1-9]/.test(shape.coefficient.slice(-discardedDigits))
}

function finiteNumber(value: unknown, message: string): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fail(message, 'invalid_actual_change_amount')
  return number
}

function actualUsd(value: unknown): number {
  const shape = decimalShape(value, 'Actual USD change must be a valid non-negative amount.')
  if (shape.negative) return fail('Actual USD change cannot be negative.', 'invalid_actual_change_amount')
  if (!hasExactIncrement(shape, 2)) {
    return fail('Actual USD change must use whole cents.', 'invalid_actual_change_precision')
  }
  calculationUnits(value, 'Actual USD change must be a valid non-negative amount.')
  try { return actualUsdValue(decimalInput(value, 'Actual USD change is invalid.')) } catch {
    return fail('Actual USD change is invalid.', 'invalid_actual_change_amount')
  }
}

function actualKhr(value: unknown): number {
  const shape = decimalShape(value, 'Actual KHR change must be a valid non-negative amount.')
  if (shape.negative) return fail('Actual KHR change cannot be negative.', 'invalid_actual_change_amount')
  if (!hasExactIncrement(shape, 0)) {
    return fail('Actual KHR change must use whole riel.', 'invalid_actual_change_precision')
  }
  calculationUnits(value, 'Actual KHR change must be a valid non-negative amount.')
  try { return actualKhrValue(decimalInput(value, 'Actual KHR change is invalid.')) } catch {
    return fail('Actual KHR change is invalid.', 'invalid_actual_change_amount')
  }
}

function canonicalNonNegative(value: unknown, label: string): number {
  const units = calculationUnits(value, `${label} is invalid.`)
  if (units < 0n) return fail(`${label} cannot be negative.`, 'invalid_actual_change_amount')
  return Number(units) / Number(CALCULATION_SCALE)
}

type Fraction = { numerator: bigint; denominator: bigint }

function fraction(value: number): Fraction {
  const shape = decimalShape(value, 'Internal reconciliation value is invalid.')
  const coefficient = BigInt(shape.coefficient) * (shape.negative ? -1n : 1n)
  if (shape.decimalScale <= 0) {
    return { numerator: coefficient * (10n ** BigInt(-shape.decimalScale)), denominator: 1n }
  }
  return { numerator: coefficient, denominator: 10n ** BigInt(shape.decimalScale) }
}

function add(left: Fraction, right: Fraction): Fraction {
  return {
    numerator: left.numerator * right.denominator + right.numerator * left.denominator,
    denominator: left.denominator * right.denominator,
  }
}

function subtract(left: Fraction, right: Fraction): Fraction {
  return {
    numerator: left.numerator * right.denominator - right.numerator * left.denominator,
    denominator: left.denominator * right.denominator,
  }
}

function divide(left: Fraction, right: Fraction): Fraction {
  return { numerator: left.numerator * right.denominator, denominator: left.denominator * right.numerator }
}

function multiply(left: Fraction, right: Fraction): Fraction {
  return { numerator: left.numerator * right.numerator, denominator: left.denominator * right.denominator }
}

function compare(left: Fraction, right: Fraction): number {
  const delta = left.numerator * right.denominator - right.numerator * left.denominator
  return delta < 0n ? -1 : delta > 0n ? 1 : 0
}

function nativeChangeMatchesOverpay(input: {
  usd: number
  khr: number
  amountPaidUsd: number
  amountPaidKhr: number
  totalUsd: number
  exchangeRate: number
  changeExchangeRate: number
}): boolean {
  const zero = fraction(0)
  const paid = add(fraction(input.amountPaidUsd), divide(fraction(input.amountPaidKhr), fraction(input.exchangeRate)))
  const overpayCandidate = subtract(paid, fraction(input.totalUsd))
  const overpay = compare(overpayCandidate, zero) > 0 ? overpayCandidate : zero
  const returned = add(fraction(input.usd), divide(fraction(input.khr), fraction(input.changeExchangeRate)))
  const difference = subtract(overpay, returned)
  if (difference.numerator === 0n) return true

  if (difference.numerator > 0n) {
    // When KHR is the returned denomination (including a zero return), the
    // physical counter rule is a strict round down: 99 riel may remain, a
    // full 100 may not. USD-only change instead rounds to its nearest cent.
    if (input.khr > 0 || (input.usd === 0 && input.khr === 0)) {
      return compare(multiply(difference, fraction(input.changeExchangeRate)), fraction(NATIVE_CHANGE_KHR_STEP)) < 0
    }
    return compare(difference, { numerator: 1n, denominator: 200n }) <= 0
  }

  // A cent can over-return by exactly half a cent when the exact overpayment
  // lies on the lower side of nearest-cent rounding. KHR is always rounded
  // down, so it never receives an over-return allowance of its own.
  const excess = { numerator: -difference.numerator, denominator: difference.denominator }
  return input.usd > 0 && compare(excess, { numerator: 1n, denominator: 200n }) <= 0
}

/**
 * Turn an explicit cashier statement into durable native change. All values
 * used for reconciliation come from server-approved sale math and settings;
 * the request supplies only the physical USD/KHR amounts and explicit intent.
 */
export function planNativeSaleChange(input: NativeSaleChangeInput): NativeSaleChangePlan {
  if (input.actualIntent === undefined || input.actualIntent === null || input.actualIntent === false) {
    return {
      changeUsd: finiteNumber(input.fallbackChangeUsd, 'Computed USD change is invalid.'),
      changeKhr: finiteNumber(input.fallbackChangeKhr, 'Computed KHR change is invalid.'),
      changeIsActual: 0,
      changeExchangeRate: null,
    }
  }
  if (input.actualIntent !== true) {
    return fail('Actual change intent must be a boolean.', 'invalid_actual_change_intent')
  }
  if (input.rawChangeUsd === undefined || input.rawChangeUsd === null || input.rawChangeUsd === ''
    || input.rawChangeKhr === undefined || input.rawChangeKhr === null || input.rawChangeKhr === '') {
    return fail('Actual change requires both USD and KHR amounts; use zero for an unused currency.', 'actual_change_required')
  }

  const exchangeRate = finiteNumber(input.exchangeRate, 'The sale exchange rate is invalid.')
  if (exchangeRate <= 0) return fail('The sale exchange rate is invalid.', 'invalid_actual_change_rate')
  const changeExchangeRate = resolveChangeExchangeRate(input.changeExchangeRate, exchangeRate)
  if (!Number.isFinite(changeExchangeRate) || changeExchangeRate <= 0) {
    return fail('The change exchange rate is invalid.', 'invalid_actual_change_rate')
  }
  const usd = actualUsd(input.rawChangeUsd)
  const khr = actualKhr(input.rawChangeKhr)
  const canonical = {
    usd,
    khr,
    amountPaidUsd: canonicalNonNegative(input.amountPaidUsd, 'USD tender'),
    amountPaidKhr: canonicalNonNegative(input.amountPaidKhr, 'KHR tender'),
    totalUsd: canonicalNonNegative(input.totalUsd, 'Sale total'),
    exchangeRate,
    changeExchangeRate,
  }
  if (!nativeChangeMatchesOverpay(canonical)) {
    return fail('Actual USD and KHR change does not reconcile with the server-computed overpayment.', 'invalid_actual_change_total')
  }
  return { changeUsd: usd, changeKhr: khr, changeIsActual: 1, changeExchangeRate }
}

/**
 * Trust the durable first-write marker, while still refusing malformed stored
 * money. Do not compare to the current sale total: amendments and settlement
 * can legitimately change that total after physical change left the drawer.
 */
export function resolveStoredNativeSaleChange(input: StoredNativeSaleChangeInput): StoredNativeSaleChange {
  const rawUsd = Number(input.changeUsd ?? 0)
  const rawKhr = Number(input.changeKhr ?? 0)
  const marker = input.changeIsActual == null ? 0 : Number(input.changeIsActual)
  if (marker === 0) return rawUsd === 0 && rawKhr === 0 ? { kind: 'none', usd: 0, khr: 0 } : { kind: 'unknown' }
  if (marker !== 1) return { kind: 'unknown' }
  try {
    const usd = actualUsd(input.changeUsd)
    const khr = actualKhr(input.changeKhr)
    const changeExchangeRate = finiteNumber(input.changeExchangeRate, 'The captured change exchange rate is invalid.')
    if (changeExchangeRate <= 0) return { kind: 'unknown' }
    return { kind: 'actual', usd, khr, changeExchangeRate }
  } catch {
    return { kind: 'unknown' }
  }
}
