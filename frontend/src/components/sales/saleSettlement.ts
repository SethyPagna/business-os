export type SettlementPaymentInput = {
  method?: string | null
  amount_usd?: number | string | null
  amount_khr?: number | string | null
}

export type SettlementRow = {
  id: string
  method: string
  usd: string
  khr: string
}

export type SettlementPayload = {
  payment_details: Array<{ method: string; amount_usd: number; amount_khr: number }>
}

const RETIRED_METHODS = new Set(['pi pay', 'transfer'])

function amount(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function roundUsd(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000
}

export function paymentMethodIdentity(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase()
}

export function configuredSettlementMethods(raw: unknown): string[] {
  let values: unknown = raw
  if (typeof raw === 'string') {
    try { values = JSON.parse(raw) } catch { return [] }
  }
  const source = Array.isArray(values) ? values : []
  const seen = new Set<string>()
  return source
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => {
      const key = paymentMethodIdentity(value)
      if (!key || RETIRED_METHODS.has(key) || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export function settlementRowsIssue(rows: readonly SettlementRow[], configured: readonly string[]): 'method' | 'amount' | null {
  for (const row of rows) {
    const recorded = row.id.startsWith('recorded-')
    if (!recorded && !configured.some((method) => paymentMethodIdentity(method) === paymentMethodIdentity(row.method))) return 'method'
    const usd = row.usd.trim() === '' ? 0 : Number(row.usd)
    const khr = row.khr.trim() === '' ? 0 : Number(row.khr)
    const usdUnits = Math.round(usd * 100)
    const hasCentPrecision = Math.abs(usd * 100 - usdUnits) < 0.000001
    if (!Number.isFinite(usd) || !Number.isFinite(khr) || usd < 0 || khr < 0 || !Number.isInteger(khr) || (!recorded && !hasCentPrecision) || (usd <= 0 && khr <= 0)) return 'amount'
  }
  return rows.length ? null : 'amount'
}

export function createSettlementRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `sale-settlement-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function canonicalSettlementMethod(method: unknown, configured: readonly string[]): string {
  const value = String(method ?? '').trim()
  const key = paymentMethodIdentity(value)
  return configured.find((candidate) => paymentMethodIdentity(candidate) === key) || value
}

export function parseSettlementDetails(raw: unknown): SettlementPaymentInput[] {
  let values: unknown = raw
  if (typeof raw === 'string' && raw.trim()) {
    try { values = JSON.parse(raw) } catch { values = [] }
  }
  if (!Array.isArray(values)) return []
  return values
    .map((entry) => entry && typeof entry === 'object' ? entry as SettlementPaymentInput : null)
    .filter((entry): entry is SettlementPaymentInput => !!entry)
    .filter((entry) => String(entry.method || '').trim() && (amount(entry.amount_usd) > 0 || amount(entry.amount_khr) > 0))
}

export function recordedSettlementIssue(input: {
  paymentDetails: unknown
  paymentMethod?: unknown
  amountPaidUsd?: unknown
  amountPaidKhr?: unknown
}): 'malformed' | 'mismatch' | 'allocation' | null {
  const raw = input.paymentDetails
  if (raw == null || raw === '') {
    const hasPaid = amount(input.amountPaidUsd) > 0 || amount(input.amountPaidKhr) > 0
    const summary = String(input.paymentMethod || '').trim()
    return hasPaid && /[+,/]/.test(summary) ? 'allocation' : null
  }
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw) } catch { return 'malformed' }
  }
  if (!Array.isArray(parsed) || parsed.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))) return 'malformed'
  const invalidLine = parsed.some((entry) => {
    const row = entry as SettlementPaymentInput
    const usd = row.amount_usd == null || row.amount_usd === '' ? 0 : Number(row.amount_usd)
    const khr = row.amount_khr == null || row.amount_khr === '' ? 0 : Number(row.amount_khr)
    return !String(row.method || '').trim()
      || !Number.isFinite(usd)
      || !Number.isFinite(khr)
      || usd < 0
      || khr < 0
      || !Number.isInteger(khr)
      || (usd <= 0 && khr <= 0)
  })
  if (invalidLine) return 'malformed'
  const details = parseSettlementDetails(parsed)
  const detailUsd = roundUsd(details.reduce((sum, row) => sum + amount(row.amount_usd), 0))
  const detailKhr = Math.round(details.reduce((sum, row) => sum + amount(row.amount_khr), 0))
  return detailUsd !== roundUsd(amount(input.amountPaidUsd))
    || detailKhr !== Math.round(amount(input.amountPaidKhr))
    ? 'mismatch'
    : null
}

export function settlementTotals(rows: readonly SettlementRow[], exchangeRate: number) {
  const amountPaidUsd = roundUsd(rows.reduce((sum, row) => sum + amount(row.usd), 0))
  const amountPaidKhr = Math.round(rows.reduce((sum, row) => sum + amount(row.khr), 0))
  const rate = Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : 4100
  return {
    amountPaidUsd,
    amountPaidKhr,
    paidEquivalentUsd: amountPaidUsd + amountPaidKhr / rate,
  }
}

export function initialSettlementRows(input: {
  paymentDetails: unknown
  paymentMethod?: unknown
  amountPaidUsd?: unknown
  amountPaidKhr?: unknown
  totalUsd: number
  exchangeRate: number
  configuredMethods: readonly string[]
}): SettlementRow[] {
  const details = parseSettlementDetails(input.paymentDetails)
  const existing = details.length
    ? details
    : (amount(input.amountPaidUsd) > 0 || amount(input.amountPaidKhr) > 0)
      ? [{ method: String(input.paymentMethod || input.configuredMethods[0] || 'Cash'), amount_usd: amount(input.amountPaidUsd), amount_khr: amount(input.amountPaidKhr) }]
      : []
  const rows = existing.map((detail, index) => ({
    id: `recorded-${index}`,
    method: canonicalSettlementMethod(detail.method, input.configuredMethods) || input.configuredMethods[0] || '',
    usd: amount(detail.amount_usd) > 0 ? String(amount(detail.amount_usd)) : '',
    khr: amount(detail.amount_khr) > 0 ? String(Math.round(amount(detail.amount_khr))) : '',
  }))
  const paid = settlementTotals(rows, input.exchangeRate).paidEquivalentUsd
  const outstandingUsd = Math.ceil(Math.max(0, input.totalUsd - paid) * 100 - Number.EPSILON) / 100
  if (outstandingUsd > 0 || rows.length === 0) {
    rows.push({
      id: 'settlement-new',
      method: input.configuredMethods[0] || '',
      usd: outstandingUsd > 0 ? outstandingUsd.toFixed(2) : '',
      khr: '',
    })
  }
  return rows
}

export function buildSettlementPayload(rows: readonly SettlementRow[], configured: readonly string[]): SettlementPayload | null {
  const details = rows
    .map((row) => ({
      method: canonicalSettlementMethod(row.method, configured),
      amount_usd: row.id.startsWith('recorded-') ? roundUsd(amount(row.usd)) : Math.round((amount(row.usd) + Number.EPSILON) * 100) / 100,
      amount_khr: Math.round(amount(row.khr)),
    }))
    .filter((row) => row.method && (row.amount_usd > 0 || row.amount_khr > 0))
  if (!details.length) return null
  return {
    payment_details: details,
  }
}

export function settlementRowsEqual(left: readonly SettlementRow[], right: readonly SettlementRow[]): boolean {
  const comparable = (rows: readonly SettlementRow[]) => rows.map(({ method, usd, khr }) => ({ method, usd, khr }))
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right))
}
