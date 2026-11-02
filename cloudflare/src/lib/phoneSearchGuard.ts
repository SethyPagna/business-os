// Search must not become a way to read a hidden phone number (P2.8, 6.0.1046).
//
// An account without `contacts_full_phone` sees `012 *** 678`. If its search box still matched any digit fragment against the
// stored number, typing 0123, 0124, ... and watching which rows come back would spell the hidden digits out one at a time.
// So for that account a digit-only search word never matches a column that holds a phone number. The one exception is a
// complete number typed on its own (8 to 15 digits, any common format): it finds the customer, as the owner asked, and is
// compared as ONE digit string, so repeating a short word ("345 345 345") cannot turn it back into a 3-digit probe.
// Everything else (names, receipts, barcodes, membership numbers, e-mail) searches as before. A holder searches as before.
import { toAsciiDigits } from './phoneMask'
import { canonicalizePhone } from './phone'

export type PhoneSearchAccess = { readonly fullPhone: boolean }

export const FULL_NUMBER_MIN_DIGITS = 8
export const FULL_NUMBER_MAX_DIGITS = 15

export type PhoneProbe =
  | { kind: 'none' }
  | { kind: 'partial' }
  | { kind: 'full'; digits: string; forms: string[] }

const NO_PROBE: PhoneProbe = { kind: 'none' }
const PARTIAL_PROBE: PhoneProbe = { kind: 'partial' }

/** A search word made only of digits (any script the number can be typed in). */
export function isDigitWord(word: string): boolean {
  return /^\d+$/.test(toAsciiDigits(String(word).normalize('NFKC')))
}

/** What the typed search does to a hidden number: nothing, probes a fragment of it, or names a whole number. */
export function phoneProbeOf(rawSearch: unknown): PhoneProbe {
  const raw = toAsciiDigits(String(rawSearch ?? '').normalize('NFKC'))
  const hasDigitWord = raw.split(/[^\p{L}\p{M}\p{N}]+/u).some((token) => /^\d+$/.test(token))
  if (!hasDigitWord) return NO_PROBE
  const digits = raw.replace(/\D/g, '')
  const wholeQueryIsANumber = /^[+\d\s().-]+$/.test(raw.trim())
  if (!wholeQueryIsANumber || digits.length < FULL_NUMBER_MIN_DIGITS || digits.length > FULL_NUMBER_MAX_DIGITS) return PARTIAL_PROBE
  const forms = new Set<string>([digits])
  const canonical = canonicalizePhone(raw) || digits
  forms.add(canonical)
  if (/^0\d{8,9}$/.test(canonical)) forms.add(`855${canonical.slice(1)}`)
  return { kind: 'full', digits, forms: [...forms] }
}

/**
 * A money figure typed as such: ASCII digits, one decimal point, one to four decimals ("8.27", "3.1415"). A phone written with
 * dots has two or more of them; the audit search lets this shape through only as a whole figure (see auditLogQuery.ts).
 */
export function isMoneyShapedWord(word: string): boolean {
  return /^[0-9]{1,9}[.][0-9]{1,4}$/.test(word)
}

/** True when the audit, import-review or any other free-text search word is a bare digit/phone-separator run. */
export function isBareNumberWord(word: string): boolean {
  const ascii = toAsciiDigits(String(word).normalize('NFKC'))
  return /\d/.test(ascii) && /^[+\d().-]+$/.test(ascii)
}

const DIGIT_SEPARATORS = [' ', '-', '(', ')', '.', '+']

/** SQL that strips a phone column down to its digits (the same set of separators the Sales picker strips). */
export function phoneDigitsSql(value: string): string {
  let digits = value
  for (const separator of DIGIT_SEPARATORS) digits = `replace(${digits},'${separator}','')`
  return `replace(replace(replace(${digits},char(9),''),char(10),''),char(13),'')`
}

/** SQL that is true when the column holds a value that is wholly a phone number (a contact saved by its number): isPhoneShaped. */
export function phoneShapedSql(columnSql: string): string {
  const digits = phoneDigitsSql(`COALESCE(${columnSql},'')`)
  return `(${digits}<>'' AND ${digits} NOT GLOB '*[^0-9]*' AND length(${digits})>=8)`
}

/** A name column as a digit-word search may read it: empty when the name is itself a number. */
export function nameWithoutPhoneSql(columnSql: string): string {
  return `CASE WHEN ${phoneShapedSql(columnSql)} THEN '' ELSE COALESCE(${columnSql},'') END`
}

export interface PhoneClause {
  sql: string
  params: Record<string, string>
}

/** `column` holds this whole number (compared as one digit string against every form of it). */
export function fullPhoneColumnClause(columnSql: string, probe: Extract<PhoneProbe, { kind: 'full' }>, paramPrefix: string): PhoneClause {
  const params: Record<string, string> = {}
  const digitsSql = phoneDigitsSql(columnSql)
  const sql = probe.forms.map((form, index) => {
    const key = `${paramPrefix}_${index}`
    params[key] = form
    return `instr(${digitsSql},@${key})>0`
  })
  return { sql: `(${sql.join(' OR ')})`, params }
}

/** A contact whose primary phone or any Contact Option phone (JSON in `address`) holds this whole number. */
export function fullContactPhoneClause(probe: Extract<PhoneProbe, { kind: 'full' }>, paramPrefix: string, optionLimit: number): PhoneClause {
  const primary = fullPhoneColumnClause("COALESCE(phone,'')", probe, paramPrefix)
  const optionObject = "CASE WHEN phone_option.type='object' THEN phone_option.value ELSE '{}' END"
  const optionPhone = `CASE WHEN json_type(${optionObject},'$.phone')='text' THEN json_extract(${optionObject},'$.phone') ELSE '' END`
  const optionDigits = phoneDigitsSql(optionPhone)
  const optionParams: Record<string, string> = {}
  const optionMatches = probe.forms.map((form, index) => {
    const key = `${paramPrefix}_o${index}`
    optionParams[key] = form
    return `instr(${optionDigits},@${key})>0`
  })
  const options = `EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(address)
    THEN CASE WHEN json_type(address)='array' THEN address ELSE '[]' END ELSE '[]' END) phone_option
    WHERE CAST(phone_option.key AS INTEGER) BETWEEN 0 AND ${optionLimit - 1}
      AND (${optionMatches.join(' OR ')}))`
  return { sql: `(${primary.sql} OR ${options})`, params: { ...primary.params, ...optionParams } }
}
