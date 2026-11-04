import { buildContactMatchClause, type ContactMatchClause } from './contactSearch'
import { CONTACT_OPTION_LIMIT } from './contactOptions'
import { phoneDigitsOf, toAsciiDigits } from './phoneMask'
import { FULL_NUMBER_MIN_DIGITS, type PhoneSearchAccess } from './phoneSearchGuard'

function phoneDigitsSql(value: string): string {
  let digits = value
  for (const separator of [' ', '-', '(', ')', '.', '+']) digits = `replace(${digits},'${separator}','')`
  return `replace(replace(replace(${digits},char(9),''),char(10),''),char(13),'')`
}

// Only the Sales/POS picker uses this compatibility path. Its phone input
// may be unformatted while historical phone FTS contains separated tokens.
// Keep the ordinary name/phone FTS clause, and union literal phone alternatives
// without changing the directory search contract or introducing LIKE patterns.
export function buildSalesCustomerMatchClause(rawSearch: unknown, access: PhoneSearchAccess): ContactMatchClause | undefined {
  const original = buildContactMatchClause('customers', rawSearch, 'picker', access)
  // The digits of any script and the 855 / 00855 country-code forms fold to the local number before they are compared.
  const raw = toAsciiDigits(String(rawSearch ?? '')).trim()
  if (!/^[+\d\s().-]+$/.test(raw)) return original
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 3 || digits.length > 15) return original
  // Without the full-phone permission a fragment of a number is not a search (lib/phoneSearchGuard.ts); a whole number is.
  if (!access.fullPhone && digits.length < FULL_NUMBER_MIN_DIGITS) return original
  const canonical = phoneDigitsOf(digits)
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
    // A holder keeps the containment match it always had; without the permission the number must EQUAL the phone, so a longer
    // number that merely contains these digits (or a shorter one the typed digits contain) names nobody.
    clauses.push(access.fullPhone ? `(phone_normalized=@${key} OR instr(${displayDigits},@${key})>0)` : `(phone_normalized=@${key} OR ${displayDigits}=@${key})`)
    optionMatches.push(access.fullPhone ? `instr(${phoneDigitsSql(optionPhone)},@${key})>0` : `${phoneDigitsSql(optionPhone)}=@${key}`)
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
