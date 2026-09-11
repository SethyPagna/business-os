import { buildContactMatchClause, type ContactMatchClause } from './contactSearch'
import { canonicalizePhone } from './phone'

// Only the Sales/POS picker uses this compatibility path. Its phone input
// may be unformatted while historical phone FTS contains separated tokens.
// Keep the ordinary name/phone FTS clause, and union literal phone alternatives
// without changing the directory search contract or introducing LIKE patterns.
export function buildSalesCustomerMatchClause(rawSearch: unknown): ContactMatchClause | undefined {
  const raw = String(rawSearch ?? '').trim()
  const original = buildContactMatchClause('customers', raw, 'picker')
  if (!/^[+\d\s().-]+$/.test(raw)) return original
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 3 || digits.length > 15) return original
  const canonical = canonicalizePhone(raw) || digits
  const alternatives = new Set([digits, canonical])
  if (/^0\d{8,9}$/.test(canonical)) alternatives.add(`855${canonical.slice(1)}`)
  const params: Record<string, string> = { ...original?.params }
  const clauses = original ? [original.sql] : []
  let displayDigits = "COALESCE(phone,'')"
  for (const separator of [' ', '-', '(', ')', '.', '+']) displayDigits = `replace(${displayDigits},'${separator}','')`
  displayDigits = `replace(replace(replace(${displayDigits},char(9),''),char(10),''),char(13),'')`
  Array.from(alternatives).forEach((value, index) => {
    const key = `picker_phone_digits_${index}`
    params[key] = value
    clauses.push(`(phone_normalized=@${key} OR instr(${displayDigits},@${key})>0)`)
  })
  return { sql: `(${clauses.join(' OR ')})`, params }
}
