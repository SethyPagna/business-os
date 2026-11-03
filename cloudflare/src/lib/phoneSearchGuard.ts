// Search must not become a way to read a hidden phone number (P2.8, 6.0.1046).
//
// An account without `contacts_full_phone` sees `012 *** 678`. If its search box still matched any digit fragment against the
// stored number, typing 0123, 0124, ... and watching which rows come back would spell the hidden digits out one at a time.
// So for that account a digit-only search word never matches a column that holds a phone number. The one exception is a
// complete number typed on its own (8 to 15 digits, any common format): it finds the customer, as the owner asked, and is
// compared as ONE digit string (equality, never containment), so repeating a short word ("345 345 345") cannot turn it back
// into a 3-digit probe. Everything else (names, receipts, barcodes, membership numbers, e-mail) searches as before.
//
// What counts as a digit word is decided on the words the MATCHER searches (tokenizeSearchWords: accents folded, a letter o
// beside a digit read as zero, punctuation dropped), never on the raw text: "654" followed by a combining accent and "o8765"
// reach the matcher as the digit words 654 and 08765. A holder searches as before.
import { isPhoneShaped, phoneDigitsOf, toAsciiDigits } from './phoneMask'
import { tokenizeSearchWords } from './searchMatch'

export type PhoneSearchAccess = { readonly fullPhone: boolean }

export const FULL_NUMBER_MIN_DIGITS = 8
export const FULL_NUMBER_MAX_DIGITS = 15

export type PhoneProbe =
  | { kind: 'none' }
  | { kind: 'partial' }
  | { kind: 'full'; digits: string; forms: string[]; plain: boolean }

const NO_PROBE: PhoneProbe = { kind: 'none' }
const PARTIAL_PROBE: PhoneProbe = { kind: 'partial' }

/** A search word made only of digits (the decimal digits of any script). */
export function isDigitWord(word: string): boolean {
  return /^\d+$/.test(toAsciiDigits(String(word)))
}

/**
 * What the typed search does to a hidden number: nothing, probes a fragment of it, or names a whole number. Decided on the
 * words the matcher searches. `plain` is a local-format number typed in ASCII digits: the contact FTS already finds it, so
 * the exact comparison only needs to run on the rows the FTS narrows to (a +855, 00855 or non-ASCII form has no such FTS hit).
 */
export function phoneProbeOf(rawSearch: unknown): PhoneProbe {
  const words = tokenizeSearchWords(rawSearch)
  if (!words.some(isDigitWord)) return NO_PROBE
  if (!words.every(isDigitWord)) return PARTIAL_PROBE
  const digits = toAsciiDigits(words.join(''))
  if (digits.length < FULL_NUMBER_MIN_DIGITS || digits.length > FULL_NUMBER_MAX_DIGITS) return PARTIAL_PROBE
  const canonical = phoneDigitsOf(digits)
  const forms = new Set<string>([digits, canonical])
  if (/^0\d{8,9}$/.test(canonical)) forms.add(`855${canonical.slice(1)}`)
  const plain = /^[0-9\s().-]+$/.test(String(rawSearch ?? '').trim()) && canonical === digits
  return { kind: 'full', digits, forms: [...forms], plain }
}

/**
 * A money figure typed as such: ASCII digits, one decimal point, one to four decimals ("8.27", "3.1415"). A phone written with
 * dots has two or more of them; the audit search lets this shape through only as a whole figure (see auditLogQuery.ts).
 */
export function isMoneyShapedWord(word: string): boolean {
  return /^[0-9]{1,9}[.][0-9]{1,4}$/.test(word)
}

/**
 * True when a free-text search word (the audit log's, which stored text is searched raw) is a probe for digits: it holds a digit
 * and either no letter at all (digits with any punctuation around them: 654", "0876, :654321) or JSON punctuation, which only
 * serves to anchor digits in the stored JSON (e":"087654). A receipt label such as RCP-1234 has letters and no JSON punctuation.
 */
export function isBareNumberWord(word: string): boolean {
  const ascii = toAsciiDigits(String(word))
  if (!/\d/.test(ascii)) return false
  return !/\p{L}/u.test(ascii) || /["{}[\]:,\\]/.test(ascii)
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

/** `column` IS this whole number (its digits equal one form of it; a number that merely contains the digits does not match). */
export function fullPhoneColumnClause(columnSql: string, probe: Extract<PhoneProbe, { kind: 'full' }>, paramPrefix: string): PhoneClause {
  const params: Record<string, string> = {}
  const digitsSql = phoneDigitsSql(columnSql)
  const sql = probe.forms.map((form, index) => {
    const key = `${paramPrefix}_${index}`
    params[key] = form
    return `${digitsSql}=@${key}`
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
    return `${optionDigits}=@${key}`
  })
  const options = `EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(address)
    THEN CASE WHEN json_type(address)='array' THEN address ELSE '[]' END ELSE '[]' END) phone_option
    WHERE CAST(phone_option.key AS INTEGER) BETWEEN 0 AND ${optionLimit - 1}
      AND (${optionMatches.join(' OR ')}))`
  return { sql: `(${primary.sql} OR ${options})`, params: { ...primary.params, ...optionParams } }
}

const SALES_REPORT_TEXT_KEYS = ['receipt_number', 'customer', 'cashier', 'branch', 'payment_method'] as const

function digitsEqualProbe(value: unknown, probe: Extract<PhoneProbe, { kind: 'full' }>): boolean {
  const text = String(value ?? '')
  if (!text.trim()) return false
  const typed = toAsciiDigits(text).replace(/\D/g, '')
  return probe.forms.includes(typed) || probe.forms.includes(phoneDigitsOf(text))
}

/**
 * Reports > Sales search (routes/reports.ts), a filter over the report's rows in JS (the matcher is built once per request). `search` is trimmed and lower-cased. A holder
 * matches any text field or the phone by substring, as before (and a whole number in any format). Without the permission the phone
 * is never matched by substring and a customer name that is itself a number counts as empty: only a whole number, equal to the
 * phone (or to that numeric name), matches.
 */
export function salesReportSearchMatcher(search: string, access: PhoneSearchAccess): (row: Record<string, unknown>) => boolean {
  if (!search) return () => true
  const probe = phoneProbeOf(search)
  const text = (row: Record<string, unknown>, key: string): string => String(row[key] || '').toLowerCase()
  const whole = (row: Record<string, unknown>): boolean => probe.kind === 'full' && (digitsEqualProbe(row.customer_phone, probe) || digitsEqualProbe(row.customer, probe))
  if (access.fullPhone) return (row) => whole(row) || [...SALES_REPORT_TEXT_KEYS, 'customer_phone'].some((key) => text(row, key).includes(search))
  return (row) => {
    if (whole(row)) return true
    const customerIsNumber = isPhoneShaped(String(row.customer || ''))
    return SALES_REPORT_TEXT_KEYS.some((key) => !(key === 'customer' && customerIsNumber) && text(row, key).includes(search))
  }
}
