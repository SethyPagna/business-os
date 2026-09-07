type FormatUsd = (value: number | string) => string

type StructuredRow = Record<string, unknown>

function structuredValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return value
  try {
    return JSON.parse(trimmed)
  } catch {
    return value
  }
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function fallbackLine(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return typeof value === 'object' ? JSON.stringify(value) : String(value)
  } catch {
    return String(value)
  }
}

function productLine(value: unknown, fmtUSD: FormatUsd): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallbackLine(value)
  const row = value as StructuredRow
  const name = String(row.product ?? row.product_name ?? row.name ?? '').trim()
  if (!name) return fallbackLine(value)

  const quantity = finiteNumber(row.quantity)
  const lineTotal = finiteNumber(row.line_total_usd)
  const unitPrice = finiteNumber(row.unit_price_usd)
  let line = quantity === null ? name : `${name} × ${quantity}`
  if (lineTotal !== null) line += ` · ${fmtUSD(lineTotal)}`
  else if (unitPrice !== null) line += ` · ${fmtUSD(unitPrice)}`
  return line
}

function paymentLine(value: unknown, fmtUSD: FormatUsd): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallbackLine(value)
  const row = value as StructuredRow
  const method = String(row.method ?? row.payment_method ?? '').trim()
  const usd = finiteNumber(row.amount_usd)
  const khr = finiteNumber(row.amount_khr)
  const parts: string[] = []
  if (method) parts.push(method)
  if (usd !== null) parts.push(fmtUSD(usd))
  if (khr !== null && (khr !== 0 || usd === null)) parts.push(`${khr.toLocaleString('en-US')}៛`)
  return parts.length ? parts.join(' · ') : fallbackLine(value)
}

/**
 * Formats the two structured fields emitted by sale Records without exposing
 * their JSON transport representation in the before/after table. A legacy
 * scalar or malformed JSON value remains visible verbatim.
 */
export function formatSaleRecordValueLines(field: string, value: unknown, fmtUSD: FormatUsd): string[] {
  const parsed = structuredValue(value)
  if (field === 'products') {
    const rows = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? [parsed] : null
    return rows ? rows.map((row) => productLine(row, fmtUSD)) : [fallbackLine(value)]
  }
  if (field === 'payment_details') {
    const rows = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? [parsed] : null
    return rows ? rows.map((row) => paymentLine(row, fmtUSD)) : [fallbackLine(value)]
  }
  return [fallbackLine(value)]
}
