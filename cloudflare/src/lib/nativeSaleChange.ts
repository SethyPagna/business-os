import {
  actualKhrValue,
  actualUsdValue,
  financialCalculationUnits,
  financialCalculationValue,
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
const USD_CENT_IN_CALCULATION_UNITS = 100n
const KHR_RIEL_IN_CALCULATION_UNITS = 10_000n

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

function finiteNumber(value: unknown, message: string): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fail(message, 'invalid_actual_change_amount')
  return number
}

function actualUsd(value: unknown): number {
  const units = calculationUnits(value, 'Actual USD change must be a valid non-negative amount.')
  if (units < 0n) return fail('Actual USD change cannot be negative.', 'invalid_actual_change_amount')
  if (units % USD_CENT_IN_CALCULATION_UNITS !== 0n) {
    return fail('Actual USD change must use whole cents.', 'invalid_actual_change_precision')
  }
  try { return actualUsdValue(decimalInput(value, 'Actual USD change is invalid.')) } catch {
    return fail('Actual USD change is invalid.', 'invalid_actual_change_amount')
  }
}

function actualKhr(value: unknown): number {
  const units = calculationUnits(value, 'Actual KHR change must be a valid non-negative amount.')
  if (units < 0n) return fail('Actual KHR change cannot be negative.', 'invalid_actual_change_amount')
  if (units % KHR_RIEL_IN_CALCULATION_UNITS !== 0n) {
    return fail('Actual KHR change must use whole riel.', 'invalid_actual_change_precision')
  }
  try { return actualKhrValue(decimalInput(value, 'Actual KHR change is invalid.')) } catch {
    return fail('Actual KHR change is invalid.', 'invalid_actual_change_amount')
  }
}

function canonicalNonNegative(value: unknown, label: string): number {
  const units = calculationUnits(value, `${label} is invalid.`)
  if (units < 0n) return fail(`${label} cannot be negative.`, 'invalid_actual_change_amount')
  return Number(units) / Number(CALCULATION_SCALE)
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
  const paidUsd = financialCalculationValue(input.amountPaidUsd + input.amountPaidKhr / input.exchangeRate)
  const overpayUsd = Math.max(0, financialCalculationValue(paidUsd - input.totalUsd))
  const returnedUsd = financialCalculationValue(input.usd + input.khr / input.changeExchangeRate)
  const differenceUsd = financialCalculationValue(overpayUsd - returnedUsd)

  // USD is stored in cents and KHR in whole riel. The UI also exposes the
  // shop's physical round-down-to-100-riel amount. Permit only those explicit
  // denomination effects: never a second cent or a full 100 riel of shortage.
  const quantizationToleranceUsd = (input.usd > 0 ? 0.005 : 0)
    + (input.khr > 0 ? 0.5 / input.changeExchangeRate : 0)
    + 0.0001
  const roundDownToleranceUsd = input.khr > 0 ? (NATIVE_CHANGE_KHR_STEP - 1) / input.changeExchangeRate : 0
  return differenceUsd >= -quantizationToleranceUsd
    && differenceUsd <= quantizationToleranceUsd + roundDownToleranceUsd
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
