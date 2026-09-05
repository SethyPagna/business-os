import {
  actualKhrMinorUnits,
  actualKhrValue,
  financialCalculationUnits,
  financialCalculationValue,
  type FinancialDecimalInput,
} from './financialPrecision'
import {
  MAX_METHOD_LENGTH,
  RETIRED_PAYMENT_METHODS,
  parseConfiguredMethodsStrict,
  paymentMethodKey,
} from './paymentMethodRegistry'
import { resolveChangeExchangeRate } from './saleTotals'

export const MAX_SETTLEMENT_TENDER_ROWS = 12

export type NativeTenderRow = {
  method: string
  amount_usd: number
  amount_khr: number
}

export type SettlementErrorCode =
  | 'invalid_payment_methods_setting'
  | 'payment_details_required'
  | 'payment_details_limit'
  | 'invalid_payment_method'
  | 'inactive_payment_method'
  | 'invalid_payment_amount'
  | 'partial_payment_reduced'
  | 'insufficient_payment'

export class SettlementValidationError extends Error {
  readonly statusCode = 400
  constructor(message: string, readonly code: SettlementErrorCode) {
    super(message)
    this.name = 'SettlementValidationError'
  }
}

function fail(message: string, code: SettlementErrorCode): never {
  throw new SettlementValidationError(message, code)
}

function safeUnits(
  value: unknown,
  currency: 'USD' | 'KHR',
  rowNumber: number,
): bigint {
  if (value === undefined || value === null || value === '') return 0n
  if (!['string', 'number', 'bigint'].includes(typeof value)) {
    return fail(`Payment row ${rowNumber} has an invalid ${currency} amount.`, 'invalid_payment_amount')
  }
  try {
    const units = currency === 'USD'
      ? financialCalculationUnits(value as FinancialDecimalInput)
      : actualKhrMinorUnits(value as FinancialDecimalInput)
    if (units < 0n) fail(`Payment row ${rowNumber} cannot contain a negative ${currency} amount.`, 'invalid_payment_amount')
    return units
  } catch {
    return fail(`Payment row ${rowNumber} has an invalid ${currency} amount.`, 'invalid_payment_amount')
  }
}

function calculationUnitsValue(units: bigint): number {
  return Number(units) / 10_000
}

export type SettlementPlan = {
  paymentDetails: NativeTenderRow[]
  paymentDetailsJson: string
  paymentMethod: string
  paymentCurrency: 'USD' | 'KHR' | 'MIXED'
  amountPaidUsd: number
  amountPaidKhr: number
  changeUsd: number
  changeKhr: number
  exchangeRate: number
  changeExchangeRate: number
}

export function planSaleSettlement(input: {
  configuredMethodsRaw: unknown
  paymentDetailsRaw: unknown
  existingPaidUsd: unknown
  existingPaidKhr: unknown
  totalUsd: unknown
  exchangeRate: unknown
  changeExchangeRateRaw?: unknown
}): SettlementPlan {
  const configured = parseConfiguredMethodsStrict(input.configuredMethodsRaw)
  if (!configured.ok) fail('Configured payment methods are unreadable. Repair them in Settings before settling a sale.', 'invalid_payment_methods_setting')
  if (!configured.methods.length) fail('Configure at least one active payment method before settling a sale.', 'invalid_payment_methods_setting')

  if (!Array.isArray(input.paymentDetailsRaw) || input.paymentDetailsRaw.length === 0) {
    fail('Add at least one payment row.', 'payment_details_required')
  }
  if (input.paymentDetailsRaw.length > MAX_SETTLEMENT_TENDER_ROWS) {
    fail(`A settlement can contain at most ${MAX_SETTLEMENT_TENDER_ROWS} payment rows.`, 'payment_details_limit')
  }

  const canonical = new Map(configured.methods.map((method) => [paymentMethodKey(method), method]))
  const paymentDetails: NativeTenderRow[] = []
  let paidUsdUnits = 0n
  let paidKhrUnits = 0n
  for (const [index, raw] of input.paymentDetailsRaw.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      fail(`Payment row ${index + 1} is invalid.`, 'invalid_payment_amount')
    }
    const detail = raw as Record<string, unknown>
    const suppliedMethod = String(detail.method ?? '').trim()
    const key = paymentMethodKey(suppliedMethod)
    if (!key || suppliedMethod.length > MAX_METHOD_LENGTH || RETIRED_PAYMENT_METHODS.has(key)) {
      fail(`Payment row ${index + 1} needs an active configured method.`, 'invalid_payment_method')
    }
    const method = canonical.get(key)
    if (!method) fail(`"${suppliedMethod}" is not an active configured payment method.`, 'inactive_payment_method')
    const usdUnits = safeUnits(detail.amount_usd, 'USD', index + 1)
    const khrUnits = safeUnits(detail.amount_khr, 'KHR', index + 1)
    if (usdUnits === 0n && khrUnits === 0n) {
      fail(`Payment row ${index + 1} must contain a positive USD or KHR amount.`, 'invalid_payment_amount')
    }
    paidUsdUnits += usdUnits
    paidKhrUnits += khrUnits
    paymentDetails.push({
      method,
      amount_usd: calculationUnitsValue(usdUnits),
      amount_khr: actualKhrValue(khrUnits),
    })
  }

  let existingUsdUnits: bigint
  let existingKhrUnits: bigint
  try {
    existingUsdUnits = financialCalculationUnits((input.existingPaidUsd ?? 0) as FinancialDecimalInput)
    existingKhrUnits = actualKhrMinorUnits((input.existingPaidKhr ?? 0) as FinancialDecimalInput)
  } catch {
    fail('The sale has invalid stored payment totals and cannot be settled safely.', 'invalid_payment_amount')
  }
  if (paidUsdUnits < existingUsdUnits || paidKhrUnits < existingKhrUnits) {
    fail('The settlement cannot reduce payment already recorded on this sale.', 'partial_payment_reduced')
  }

  const rate = Number(input.exchangeRate)
  if (!Number.isFinite(rate) || rate <= 0) fail('The current exchange rate is invalid.', 'invalid_payment_amount')
  const amountPaidUsd = calculationUnitsValue(paidUsdUnits)
  const amountPaidKhr = actualKhrValue(paidKhrUnits)
  const totalUsd = Number(input.totalUsd)
  if (!Number.isFinite(totalUsd) || totalUsd < 0) fail('The sale total is invalid.', 'invalid_payment_amount')
  const paidCombinedUsd = amountPaidUsd + amountPaidKhr / rate
  if (paidCombinedUsd + 0.0000001 < totalUsd) {
    fail('The payment does not cover the sale balance.', 'insufficient_payment')
  }
  const overpayExactUsd = Math.max(0, paidCombinedUsd - totalUsd)
  const changeRate = resolveChangeExchangeRate(input.changeExchangeRateRaw, rate)
  const distinctMethods: string[] = []
  const seen = new Set<string>()
  for (const detail of paymentDetails) {
    const key = paymentMethodKey(detail.method)
    if (!seen.has(key)) {
      seen.add(key)
      distinctMethods.push(detail.method)
    }
  }
  return {
    paymentDetails,
    paymentDetailsJson: JSON.stringify(paymentDetails),
    paymentMethod: distinctMethods.join(' + '),
    paymentCurrency: paidUsdUnits > 0n && paidKhrUnits > 0n ? 'MIXED' : paidKhrUnits > 0n ? 'KHR' : 'USD',
    amountPaidUsd,
    amountPaidKhr,
    changeUsd: financialCalculationValue(overpayExactUsd),
    changeKhr: actualKhrValue(overpayExactUsd * changeRate),
    exchangeRate: rate,
    changeExchangeRate: changeRate,
  }
}

export type PaymentRenameResult =
  | { ok: true; changed: boolean; paymentMethod: string | null; paymentDetails: string | null; detailMatches: number }
  | { ok: false; relevant: boolean; error: 'malformed_payment_details' }

function summaryTokens(raw: unknown): string[] {
  return String(raw ?? '').split('+').map((part) => part.trim()).filter(Boolean)
}

function renamedSummary(tokens: string[], fromKey: string, target: string): { value: string | null; changed: boolean; matches: number } {
  const next: string[] = []
  const seen = new Set<string>()
  let changed = false
  let matches = 0
  for (const token of tokens) {
    const matchesSource = paymentMethodKey(token) === fromKey
    const value = matchesSource ? target : token
    if (matchesSource) {
      changed = changed || token !== target
      matches += 1
    }
    const key = paymentMethodKey(value)
    if (!key || seen.has(key)) continue
    seen.add(key)
    next.push(value)
  }
  return { value: next.length ? next.join(' + ') : null, changed, matches }
}

/** Rename the live summary and itemized labels together, preserving tender rows and amounts. */
export function renameSalePaymentMethod(
  paymentMethodRaw: unknown,
  paymentDetailsRaw: unknown,
  from: string,
  target: string,
): PaymentRenameResult {
  const fromKey = paymentMethodKey(from)
  const originalDetails = paymentDetailsRaw == null ? '' : String(paymentDetailsRaw)
  const summary = summaryTokens(paymentMethodRaw)
  const summaryResult = renamedSummary(summary, fromKey, target)
  if (!originalDetails.trim()) {
    return {
      ok: true,
      changed: summaryResult.changed,
      paymentMethod: summaryResult.value,
      paymentDetails: paymentDetailsRaw == null ? null : originalDetails,
      detailMatches: 0,
    }
  }

  let parsed: unknown
  try { parsed = JSON.parse(originalDetails) } catch {
    return { ok: false, relevant: summaryResult.matches > 0 || originalDetails.toLocaleLowerCase().includes(fromKey), error: 'malformed_payment_details' }
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, relevant: summaryResult.matches > 0, error: 'malformed_payment_details' }
  }
  let detailMatches = 0
  let detailsChanged = false
  const next = parsed.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry
    const detail = { ...(entry as Record<string, unknown>) }
    if (paymentMethodKey(detail.method) === fromKey) {
      detailMatches += 1
      if (String(detail.method ?? '') !== target) detailsChanged = true
      detail.method = target
    }
    return detail
  })
  if (!detailsChanged && !summaryResult.changed) {
    return { ok: true, changed: false, paymentMethod: String(paymentMethodRaw ?? '') || null, paymentDetails: originalDetails, detailMatches }
  }
  const methods = next
    .map((entry) => entry && typeof entry === 'object' && !Array.isArray(entry) ? String((entry as Record<string, unknown>).method ?? '').trim() : '')
    .filter(Boolean)
  const rebuilt = renamedSummary(methods, '__never__', target).value
  return {
    ok: true,
    changed: true,
    paymentMethod: rebuilt ?? summaryResult.value,
    paymentDetails: JSON.stringify(next),
    detailMatches,
  }
}
