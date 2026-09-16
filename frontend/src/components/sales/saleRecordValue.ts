type FormatUsd = (value: number | string) => string
type FormatKhr = (value: number | string) => string
type TranslateLabel = (key: string, fallback: string) => string

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

function fallbackLine(value: unknown, label?: TranslateLabel): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') return label?.('value_changed', 'Value changed') || 'Value changed'
  try {
    return typeof value === 'object' ? JSON.stringify(value) : String(value)
  } catch {
    return String(value)
  }
}

function objectRow(value: unknown): StructuredRow | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as StructuredRow : null
}

function productLine(value: unknown, fmtUSD: FormatUsd): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallbackLine(value)
  const row = value as StructuredRow
  const name = String(row.product ?? row.product_name ?? row.name ?? '').trim()
  if (!name) return fallbackLine(value)
  const sku = String(row.sku ?? '').trim()

  const quantity = finiteNumber(row.quantity)
  const lineTotal = finiteNumber(row.line_total_usd)
  const unitPrice = finiteNumber(row.unit_price_usd)
  let line = `${name}${sku ? ` (${sku})` : ''}`
  if (quantity !== null) line += ` × ${quantity}`
  if (lineTotal !== null) line += ` · ${fmtUSD(lineTotal)}`
  else if (unitPrice !== null) line += ` · ${fmtUSD(unitPrice)}`
  return line
}

function paymentLine(value: unknown, fmtUSD: FormatUsd, fmtKHR: FormatKhr): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallbackLine(value)
  const row = value as StructuredRow
  const method = String(row.method ?? row.payment_method ?? '').trim()
  const usd = finiteNumber(row.amount_usd)
  const khr = finiteNumber(row.amount_khr)
  const parts: string[] = []
  if (method) parts.push(method)
  if (usd !== null) parts.push(fmtUSD(usd))
  if (khr !== null && (khr !== 0 || usd === null)) parts.push(fmtKHR(khr))
  return parts.length ? parts.join(' · ') : fallbackLine(value)
}

/**
 * Formats the two structured fields emitted by sale Records without exposing
 * their JSON transport representation in the before/after table. A legacy
 * scalar or malformed JSON value remains visible verbatim.
 */
export function formatSaleRecordValueLines(field: string, value: unknown, fmtUSD: FormatUsd): string[] {
  return formatSaleRecordValueLinesLocalized(field, value, fmtUSD, (amount) => `${Number(amount).toLocaleString('en-US')}៛`)
}

export function formatSaleRecordValueLinesLocalized(
  field: string,
  value: unknown,
  fmtUSD: FormatUsd,
  fmtKHR: FormatKhr,
  label: TranslateLabel = (_key, fallback) => fallback,
): string[] {
  const parsed = structuredValue(value)
  if (['products', 'items', 'removed_items', 'added_items'].includes(field)) {
    const rows = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? [parsed] : null
    return rows ? rows.map((row) => productLine(row, fmtUSD)) : [fallbackLine(value, label)]
  }
  if (field === 'item') return [productLine(parsed, fmtUSD)]
  if (field === 'stock_effect') {
    if (parsed === 'deducted_now') return [label('stock_deducted_now', 'Stock deducted now')]
    if (parsed === 'released_allocation_only') return [label('stock_released_allocation_only', 'Released allocation; no stock deduction')]
    return [label('value_changed', 'Value changed')]
  }
  if (field === 'customer') {
    const row = objectRow(parsed)
    if (!row) return [fallbackLine(value, label)]
    const name = String(row.name ?? '').trim()
    const id = finiteNumber(row.id)
    return [name ? `${name}${id === null ? '' : ` · #${id}`}` : (id === null ? label('value_changed', 'Value changed') : `#${id}`)]
  }
  if (field === 'driver') {
    const row = objectRow(parsed)
    if (!row) return [fallbackLine(value, label)]
    const id = finiteNumber(row.id)
    const parts = [row.name, id === null ? null : `#${id}`, row.phone, row.address].map((part) => String(part ?? '').trim()).filter(Boolean)
    return [parts.join(' · ') || label('value_changed', 'Value changed')]
  }
  if (field === 'membership') {
    const row = objectRow(parsed)
    if (!row) return [fallbackLine(value, label)]
    const lines: string[] = []
    if (String(row.number ?? '').trim()) lines.push(String(row.number).trim())
    const usd = finiteNumber(row.discount_usd)
    const khr = finiteNumber(row.discount_khr)
    const points = finiteNumber(row.points_redeemed)
    if (usd !== null) lines.push(`${label('membership_discount', 'Membership discount')}: ${fmtUSD(usd)}`)
    if (khr !== null) lines.push(`${label('membership_discount', 'Membership discount')}: ${fmtKHR(khr)}`)
    if (points !== null) lines.push(`${label('points_redeemed', 'Points redeemed')}: ${points}`)
    return lines.length ? lines : [label('value_changed', 'Value changed')]
  }
  if (field === 'payment_details') {
    const rows = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? [parsed] : null
    return rows ? rows.map((row) => paymentLine(row, fmtUSD, fmtKHR)) : [fallbackLine(value, label)]
  }
  if (field === 'payment') {
    const row = objectRow(parsed)
    if (!row) return [fallbackLine(value, label)]
    const lines: string[] = []
    const method = String(row.method ?? '').trim()
    const details = Array.isArray(row.details) ? row.details : []
    if (method && details.length === 0) lines.push(method)
    lines.push(...details.map((detail) => paymentLine(detail, fmtUSD, fmtKHR)))
    const usd = finiteNumber(row.amount_paid_usd)
    const khr = finiteNumber(row.amount_paid_khr)
    const changeUsd = finiteNumber(row.change_usd)
    const changeKhr = finiteNumber(row.change_khr)
    if (usd !== null) lines.push(`${label('amount_paid', 'Amount paid')}: ${fmtUSD(usd)}`)
    if (khr !== null) lines.push(`${label('amount_paid_khr', 'Amount paid (KHR)')}: ${fmtKHR(khr)}`)
    if (changeUsd !== null) lines.push(`${label('change', 'Change')}: ${fmtUSD(changeUsd)}`)
    if (changeKhr !== null) lines.push(`${label('change_khr', 'Change (KHR)')}: ${fmtKHR(changeKhr)}`)
    return lines.length ? lines : [label('value_changed', 'Value changed')]
  }
  if (field === 'delivery') {
    const row = objectRow(parsed)
    if (!row) return [fallbackLine(value, label)]
    const lines: string[] = []
    if (row.driver) lines.push(...formatSaleRecordValueLinesLocalized('driver', row.driver, fmtUSD, fmtKHR, label))
    const fee = finiteNumber(row.delivery_fee_usd)
    const cost = finiteNumber(row.actual_delivery_cost_usd)
    if (fee !== null) lines.push(`${label('delivery_fee', 'Delivery fee')}: ${fmtUSD(fee)}`)
    if (cost !== null) lines.push(`${label('delivery_actual_cost', 'Actual delivery cost')}: ${fmtUSD(cost)}`)
    return lines.length ? lines : [label('yes', 'Yes')]
  }
  return [fallbackLine(value, label)]
}
