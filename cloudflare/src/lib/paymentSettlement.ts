import {
  actualKhrMinorUnits,
  actualKhrValue,
  actualUsdMinorUnits,
  actualUsdValue,
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
  | 'stored_payment_invalid'
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
  existingPaymentDetailsRaw?: unknown
  existingPaymentMethodRaw?: unknown
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
  let existingUsdUnits: bigint
  let existingKhrUnits: bigint
  try {
    existingUsdUnits = financialCalculationUnits((input.existingPaidUsd ?? 0) as FinancialDecimalInput)
    existingKhrUnits = actualKhrMinorUnits((input.existingPaidKhr ?? 0) as FinancialDecimalInput)
  } catch {
    fail('The sale has invalid stored payment totals and cannot be settled safely.', 'stored_payment_invalid')
  }
  type ExistingRow = { key: string; method: string; usdUnits: bigint; khrUnits: bigint; matched: boolean }
  const existingRows: ExistingRow[] = []
  let storedDetails: unknown = input.existingPaymentDetailsRaw
  const storedDetailsSupplied = Array.isArray(storedDetails) || (typeof storedDetails === 'string' && Boolean(storedDetails.trim()))
  if (typeof storedDetails === 'string' && storedDetails.trim()) {
    try { storedDetails = JSON.parse(storedDetails) } catch {
      fail('The sale has unreadable stored payment details and cannot be settled safely.', 'stored_payment_invalid')
    }
  }
  if (Array.isArray(storedDetails)) {
    for (const raw of storedDetails) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        fail('The sale has invalid stored payment details and cannot be settled safely.', 'stored_payment_invalid')
      }
      const detail = raw as Record<string, unknown>
      const method = String(detail.method ?? '').trim()
      if (!method || method.length > MAX_METHOD_LENGTH) fail('The sale has invalid stored payment details and cannot be settled safely.', 'stored_payment_invalid')
      try {
        const row = {
          key: paymentMethodKey(method),
          method,
          usdUnits: financialCalculationUnits((detail.amount_usd ?? 0) as FinancialDecimalInput),
          khrUnits: actualKhrMinorUnits((detail.amount_khr ?? 0) as FinancialDecimalInput),
          matched: false,
        }
        if (row.usdUnits < 0n || row.khrUnits < 0n) throw new Error('negative')
        existingRows.push(row)
      } catch { fail('The sale has invalid stored payment details and cannot be settled safely.', 'stored_payment_invalid') }
    }
  }
  if (storedDetailsSupplied && !Array.isArray(storedDetails)) {
    fail('The sale has invalid stored payment details and cannot be settled safely.', 'stored_payment_invalid')
  }
  if (existingRows.length) {
    const detailUsd = existingRows.reduce((sum, row) => sum + row.usdUnits, 0n)
    const detailKhr = existingRows.reduce((sum, row) => sum + row.khrUnits, 0n)
    if (detailUsd !== existingUsdUnits || detailKhr !== existingKhrUnits) {
      fail('Stored payment rows do not match the sale payment totals.', 'stored_payment_invalid')
    }
  }
  if (!existingRows.length) {
    const tokens = String(input.existingPaymentMethodRaw ?? '').split('+').map((part) => part.trim()).filter(Boolean)
    if ((existingUsdUnits !== 0n || existingKhrUnits !== 0n) && tokens.length !== 1) {
      fail('This partially paid sale does not identify how its split payment was allocated.', 'stored_payment_invalid')
    }
    if (tokens.length === 1 && (existingUsdUnits !== 0n || existingKhrUnits !== 0n)) {
      try {
        existingRows.push({
          key: paymentMethodKey(tokens[0]), method: tokens[0],
          usdUnits: existingUsdUnits,
          khrUnits: existingKhrUnits, matched: false,
        })
      } catch { fail('The sale has invalid stored payment totals and cannot be settled safely.', 'stored_payment_invalid') }
    }
  }
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
    if (!key || suppliedMethod.length > MAX_METHOD_LENGTH) {
      fail(`Payment row ${index + 1} needs an active configured method.`, 'invalid_payment_method')
    }
    let comparisonUsd: bigint
    let khrUnits: bigint
    try {
      comparisonUsd = financialCalculationUnits((detail.amount_usd ?? 0) as FinancialDecimalInput)
      khrUnits = actualKhrMinorUnits((detail.amount_khr ?? 0) as FinancialDecimalInput)
    } catch {
      fail(`Payment row ${index + 1} has an invalid amount.`, 'invalid_payment_amount')
    }
    const preserved = existingRows.find((row) => !row.matched && row.key === key && row.usdUnits === comparisonUsd && row.khrUnits === khrUnits)
    let method: string
    let usdUnits: bigint
    if (preserved) {
      preserved.matched = true
      method = canonical.get(key) || preserved.method
      usdUnits = comparisonUsd
    } else {
      const activeMethod = canonical.get(key)
      if (!activeMethod || RETIRED_PAYMENT_METHODS.has(key)) fail(`"${suppliedMethod}" is not an active configured payment method.`, 'inactive_payment_method')
      if (comparisonUsd % 100n !== 0n) {
        fail(`Payment row ${index + 1} must use whole USD cents.`, 'invalid_payment_amount')
      }
      method = activeMethod
      try { usdUnits = actualUsdMinorUnits((detail.amount_usd ?? 0) as FinancialDecimalInput) * 100n } catch {
        fail(`Payment row ${index + 1} has an invalid USD amount.`, 'invalid_payment_amount')
      }
    }
    if (khrUnits < 0n || usdUnits < 0n) fail(`Payment row ${index + 1} cannot contain a negative amount.`, 'invalid_payment_amount')
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

  if (existingRows.some((row) => !row.matched && (row.usdUnits !== 0n || row.khrUnits !== 0n))) {
    fail('Every previously recorded payment row must remain in the settlement unchanged.', 'partial_payment_reduced')
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
    changeUsd: actualUsdValue(overpayExactUsd),
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
  const structurallyValid = parsed.every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
    const detail = entry as Record<string, unknown>
    const method = String(detail.method ?? '').trim()
    if (!method || method.length > MAX_METHOD_LENGTH) return false
    return ['amount_usd', 'amount_khr'].every((field) => {
      const raw = detail[field]
      if (raw == null || raw === '') return true
      if (!['number', 'string'].includes(typeof raw)) return false
      const value = Number(raw)
      return Number.isFinite(value) && value >= 0
    })
  })
  if (!structurallyValid) {
    return { ok: false, relevant: summaryResult.matches > 0 || originalDetails.toLocaleLowerCase().includes(fromKey), error: 'malformed_payment_details' }
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
