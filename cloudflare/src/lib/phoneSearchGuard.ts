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
import { keyMaskOf } from './phoneAccess'
import { isPhoneShaped, maskQuotedPhones, phoneDigitsOf, toAsciiDigits } from './phoneMask'
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
 * A search word that holds a decimal digit anywhere: "654", "654" + a combining mark the FTS tokenizer drops, "tel0876". An account
 * without the grant never lets such a word reach a phone column; testing "all digits" instead left every word glued to a mark or a letter open.
 */
export function hasDigit(word: string): boolean {
  return /\d/.test(toAsciiDigits(String(word)))
}

/**
 * The haystacks one restricted search word (it holds a digit, and the account lacks the grant) is matched against. `rawHaystack` is
 * the caller's raw, NON-phone text (no phone column, no search_normalized). The matcher reads a letter o beside a digit as a zero
 * ("No1" is searched as "n01") and a sale's or return's folded copy held that spelling, but the copy also holds the customer's
 * digits, so this account does not read it and the word "n01" matched nothing in the raw "No1". A word that has a letter AND a
 * zero (so it may have been typed with an o) therefore also reads `rawHaystack` with every o turned into 0: the same as trying the
 * word with each of its zeros turned back into o. Built from `rawHaystack` alone, it cannot reach a phone column or the folded
 * copy; a word with no letter (a digit fragment, however disguised: "o8765" is 08765) never gets it.
 */
export function restrictedWordHaystacks(word: string, rawHaystack: string): string[] {
  return /\p{L}/u.test(word) && word.includes('0') ? [rawHaystack, `replace(lower(${rawHaystack}),'o','0')`] : [rawHaystack]
}

/**
 * What the typed search does to a hidden number: nothing, probes a fragment of it, or names a whole number. Decided on the
 * words the matcher searches. `plain` is a local-format number typed in ASCII digits: the contact FTS already finds it, so
 * the exact comparison only needs to run on the rows the FTS narrows to (a +855, 00855 or non-ASCII form has no such FTS hit).
 */
export function phoneProbeOf(rawSearch: unknown): PhoneProbe {
  const words = tokenizeSearchWords(rawSearch)
  if (!words.some(hasDigit)) return NO_PROBE
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

// D1 refuses a LIKE or GLOB pattern over 50 bytes, so the decimal digits of the scripts a phone may be written in are tested in four
// patterns of at most five families each (with ASCII): Arabic-Indic, Persian, N'Ko, Devanagari, Bengali; Gurmukhi, Gujarati, Oriya, Tamil,
// Telugu; Kannada, Malayalam, Thai, Lao, Tibetan; Myanmar, Khmer, Mongolian, full-width, mathematical. A number written in a script not listed
// (Javanese, Balinese ...) is not recognised here although phoneMask.ts masks any Unicode digit; test-phone-search-masked-columns-pure.cjs
// pins the families that are.
const NON_DIGIT_GLOBS = [
  '*[^0-9\u0660-\u0669\u06f0-\u06f9\u07c0-\u07c9\u0966-\u096f\u09e6-\u09ef]*',
  '*[^0-9\u0a66-\u0a6f\u0ae6-\u0aef\u0b66-\u0b6f\u0be6-\u0bef\u0c66-\u0c6f]*',
  '*[^0-9\u0ce6-\u0cef\u0d66-\u0d6f\u0e50-\u0e59\u0ed0-\u0ed9\u0f20-\u0f29]*',
  '*[^0-9\u1040-\u1049\u17e0-\u17e9\u1810-\u1819\uff10-\uff19\u{1d7ce}-\u{1d7ff}]*',
]

// What isPhoneShaped lets stand between the digits: + ( ) . - and every character a JavaScript \s matches (the separators of a number
// pasted from a chat: no-break, narrow, thin and ideographic spaces, a line break ...). Stripped one by one, because SQLite has no regex.
const SHAPE_SEPARATORS = ['+', '(', ')', '.', '-', ' ']
const SHAPE_SPACE_CODES = [9, 10, 11, 12, 13, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff]

function shapeStrippedSql(columnSql: string): string {
  let text = `COALESCE(${columnSql},'')`
  for (const separator of SHAPE_SEPARATORS) text = `replace(${text},'${separator}','')`
  for (const code of SHAPE_SPACE_CODES) text = `replace(${text},char(${code}),'')`
  return text
}

/**
 * SQL that is true when the column holds a value that is wholly a phone number (a contact saved by its number): isPhoneShaped.
 * The separators are stripped once, in a one-row subquery, so a statement that tests many columns does not repeat the chain.
 */
export function phoneShapedSql(columnSql: string): string {
  return `(SELECT length(ds)>=8 AND (${NON_DIGIT_GLOBS.map((glob) => `ds NOT GLOB '${glob}'`).join(' OR ')}) FROM (SELECT ${shapeStrippedSql(columnSql)} AS ds))`
}

/** A name column as a digit-word search may read it: empty when the name is itself a number. */
export function nameWithoutPhoneSql(columnSql: string): string {
  return `CASE WHEN ${phoneShapedSql(columnSql)} THEN '' ELSE COALESCE(${columnSql},'') END`
}

/** A search column as an account without the grant may read it. `quoted`: a sentence that quotes a number reads as empty. */
function quotedNumberFreeSql(columnSql: string): string {
  const text = `COALESCE(${columnSql},'')`
  // An ASCII number: a quote followed by a digit or +, and seven digits somewhere. A Khmer number (the only other script this shop
  // writes) is a quote followed by a Khmer digit: a seven-digit Khmer pattern is 91 bytes and D1 refuses a pattern over 50, so the
  // Khmer test is the quote-then-digit pattern alone (28 bytes). It reads a sentence that quotes any Khmer figure as empty, which
  // only hides it from the search (review residue, 6.0.1162).
  return `CASE WHEN ${text} GLOB '*["''\u201c\u2018\u201d\u2019][+0-9]*' AND ${text} GLOB '*[0-9]*[0-9]*[0-9]*[0-9]*[0-9]*[0-9]*[0-9]*' THEN '' WHEN ${text} GLOB '*["''\u201c\u2018\u201d\u2019][\u17e0-\u17e9]*' THEN '' ELSE ${text} END`
}

export type SearchColumn = string | { sql: string; key: string }

/**
 * SQL for a column a restricted search reads raw. The projection that masks a response (phoneAccess.ts keyMaskOf) decides by the key
 * a value leaves under, and a list's column carries that key as its name (`s.notes` leaves as `notes`; pass `key` for an expression), so
 * the search asks the SAME rule: a column the projection always hides reads as empty, a name or a note that is itself a number reads as
 * empty, a sentence quoting a number reads as empty, anything else is read as stored. A column added tomorrow inherits the rule.
 */
export function restrictedColumnSql(column: SearchColumn): string {
  const { sql, key } = typeof column === 'string' ? { sql: column, key: column.slice(column.lastIndexOf('.') + 1) } : column
  switch (keyMaskOf(key)) {
    case 'always': return "''"
    case 'name': return nameWithoutPhoneSql(sql)
    case 'quoted': return quotedNumberFreeSql(sql)
    default: return `COALESCE(${sql},'')`
  }
}

/** `column` as this account may search it with LIKE: as stored for a holder of the grant, through the projection's rule for everybody else. */
export function searchableColumnSql(column: SearchColumn, access: PhoneSearchAccess): string {
  if (access.fullPhone) return typeof column === 'string' ? column : column.sql
  return restrictedColumnSql(column)
}

/** The parts of a restricted haystack (join them with a space): every column through restrictedColumnSql. */
export function restrictedHaystackParts(columns: readonly SearchColumn[]): string[] {
  return columns.map(restrictedColumnSql)
}

/** The name the restricted haystack carries inside restrictedSearchScope. */
export const RESTRICTED_HAYSTACK = 'rh'

/**
 * `searchedSql`, whose digit words read RESTRICTED_HAYSTACK, evaluated over the restricted haystack `haystackSql`: the haystack is
 * written once in the statement and computed once per row, whatever the number of words (written per word it overran D1's 100 KB
 * statement limit at twelve words, and the wrapped columns repeat their separator chain).
 */
export function restrictedSearchScope(searchedSql: string, haystackSql: string): string {
  return `(SELECT ${searchedSql} FROM (SELECT ${haystackSql} AS ${RESTRICTED_HAYSTACK}))`
}

/** The text of a value as an account without the grant may search it in JS (the same rule as restrictedColumnSql, for row filters). */
export function restrictedTextOf(key: string, value: unknown): string {
  const text = String(value ?? '')
  switch (keyMaskOf(key)) {
    case 'always': return ''
    case 'name': return isPhoneShaped(text) ? '' : text
    case 'quoted': return maskQuotedPhones(text) === text ? text : ''
    default: return text
  }
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
  // Each key is read through the projection's rule for that key (restrictedTextOf): a customer that is a number reads as empty.
  return (row) => whole(row) || SALES_REPORT_TEXT_KEYS.some((key) => restrictedTextOf(key, row[key] || '').toLowerCase().includes(search))
}
