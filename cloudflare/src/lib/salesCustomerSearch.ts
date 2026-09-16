import { buildContactMatchClause, type ContactMatchClause } from './contactSearch'
import { canonicalizePhone } from './phone'
import { CONTACT_OPTION_LIMIT } from './contactOptions'

function phoneDigitsSql(value: string): string {
  let digits = value
  for (const separator of [' ', '-', '(', ')', '.', '+']) digits = `replace(${digits},'${separator}','')`
  return `replace(replace(replace(${digits},char(9),''),char(10),''),char(13),'')`
}

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
  const displayDigits = phoneDigitsSql("COALESCE(phone,'')")
  const optionObject = "CASE WHEN picker_option.type='object' THEN picker_option.value ELSE '{}' END"
  const optionPhone = `CASE WHEN json_type(${optionObject},'$.phone')='text' THEN json_extract(${optionObject},'$.phone') ELSE '' END`
  const optionMatches: string[] = []
  Array.from(alternatives).forEach((value, index) => {
    const key = `picker_phone_digits_${index}`
    params[key] = value
    clauses.push(`(phone_normalized=@${key} OR instr(${displayDigits},@${key})>0)`)
    optionMatches.push(`instr(${phoneDigitsSql(optionPhone)},@${key})>0`)
  })
  // The address field can also be ordinary legacy text. Only parse valid
  // option arrays and only normalize the explicit phone member, never street,
  // label, email or arbitrary JSON digits. Match the display's option cap.
  clauses.push(`EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(address)
    THEN CASE WHEN json_type(address)='array' THEN address ELSE '[]' END ELSE '[]' END) picker_option
    WHERE CAST(picker_option.key AS INTEGER) BETWEEN 0 AND ${CONTACT_OPTION_LIMIT - 1}
      AND (${optionMatches.join(' OR ')}))`)
  return { sql: `(${clauses.join(' OR ')})`, params }
}
