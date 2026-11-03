// The one phone masking format, shared by every channel (owner ruling 2 Nov 2026, round 1 Q3).
//
//   012 345 678        -> 012 *** 678
//   +855 12 345 678    -> 012 *** 678   (the +855 / 855 / 00855 forms fold to the national 0 form first)
//   ០១២ ៣៤៥ ៦៧៨       -> 012 *** 678   (the decimal digits of every script become ASCII first)
//
// The first and last three digits stay and the rest become `***`. A number too short to show six digits keeps fewer
// (always at least three digits stay hidden), and a value with no digit has nothing to hide. A masked value is
// idempotent: masking it again returns it unchanged, so a payload that passes two layers is never mangled.
//
// Pure: no imports from the Worker, so the same file is loaded by the tests and the Telegram composers.

export const PHONE_MASK_MARK = '***'

const DECIMAL_DIGIT = /^\p{Nd}$/u
const decimalValues = new Map<number, number>()

/** The value 0-9 of a decimal digit in any script: Unicode lays every digit set out as ten consecutive code points from its zero. */
function decimalValue(code: number): number {
  const known = decimalValues.get(code)
  if (known !== undefined) return known
  let start = code
  while (code - start < 50 && DECIMAL_DIGIT.test(String.fromCodePoint(start - 1))) start -= 1
  const value = (code - start) % 10
  decimalValues.set(code, value)
  return value
}

/** Every decimal digit of every script (Khmer, Arabic-Indic, Thai, Devanagari, full-width, mathematical ...) becomes 0-9. */
export function toAsciiDigits(value: string): string {
  if (!/[^\x00-\x7f]/.test(value)) return value
  let out = ''
  for (const char of value.normalize('NFKC')) {
    const code = char.codePointAt(0) as number
    out += code > 0x7f && DECIMAL_DIGIT.test(char) ? String(decimalValue(code)) : char
  }
  return out
}

/** The digits of a phone as typed, any script, with the Cambodian country code folded to the national 0 form. */
export function phoneDigitsOf(value: unknown): string {
  const digits = toAsciiDigits(String(value ?? '')).replace(/\D/g, '')
  if (/^(?:00)?855\d{8,9}$/.test(digits)) return `0${digits.replace(/^(?:00)?855/, '')}`
  return digits
}

// The one shape maskPhone writes: up to three digits, the mark, up to three digits (or the bare mark). An asterisk anywhere else
// (a note "012345678 *", a leading star) is not a mask and does not stop the value being masked.
const MASK_SHAPE = /^(?:\*\*\*|\d{1,3} \*\*\* \d{1,3})$/

export function isMaskedPhone(value: unknown): boolean {
  return typeof value === 'string' && value.includes('*') && MASK_SHAPE.test(toAsciiDigits(value).replace(/\s+/g, ' ').trim())
}

function visiblePerSide(length: number): number {
  return Math.max(0, Math.min(3, Math.floor((length - 3) / 2)))
}

/** The masked form of a phone, or the value itself when it holds no digit (null and '' stay as they are). */
export function maskPhone<T>(value: T): T | string {
  if (typeof value !== 'string') return value
  if (isMaskedPhone(value)) return value
  const digits = phoneDigitsOf(value)
  if (!digits) return value
  const keep = visiblePerSide(digits.length)
  if (keep === 0) return PHONE_MASK_MARK
  return `${digits.slice(0, keep)} ${PHONE_MASK_MARK} ${digits.slice(-keep)}`
}

/** The masked form a stored phone shows, for matching an incoming masked value back to it. */
export function maskedFormOf(value: unknown): string {
  const masked = maskPhone(typeof value === 'string' ? value : String(value ?? ''))
  return typeof masked === 'string' ? masked.replace(/\s+/g, ' ').trim() : ''
}

function normalizedMask(value: string): string {
  return toAsciiDigits(value).replace(/\s+/g, ' ').trim()
}

/** True when `incoming` is exactly what `maskPhone` shows for `stored` (spacing and digit script ignored). */
export function isMaskOf(incoming: unknown, stored: unknown): boolean {
  if (!isMaskedPhone(incoming) || stored == null || String(stored).trim() === '') return false
  return normalizedMask(String(incoming)) === maskedFormOf(stored)
}

/**
 * Phone numbers inside running text (an error message, a log line, a notification body): every run of at least
 * eight digits, separators allowed, becomes its masked form. Only for text the system composed from a phone field;
 * a note a person typed is not scanned.
 */
const PHONE_IN_TEXT = /(?:\+|00)?\p{Nd}(?:[\s().-]?\p{Nd}){6,}/gu
export function maskPhonesInText(text: string): string {
  return text.replace(PHONE_IN_TEXT, (match) => {
    const masked = maskPhone(match)
    return typeof masked === 'string' ? masked : match
  })
}

/**
 * A number the message itself quotes (`Phone "087 654 321" is already registered to "Dara"`): the duplicate and import checks name
 * the number they matched. Only a QUOTED number is touched, so a receipt number or an amount in running text is left alone.
 */
const QUOTED_PHONE = /(["'“‘]{1,2})((?:\+|00)?\p{Nd}(?:[\s().-]?\p{Nd}){6,})(["'”’]{1,2})/gu
export function maskQuotedPhones(text: string): string {
  return text.replace(QUOTED_PHONE, (match, open: string, number: string, close: string) => {
    const masked = maskPhone(number)
    return typeof masked === 'string' ? `${open}${masked}${close}` : match
  })
}

/** A name field that is really a number (a contact saved by its phone): the whole value is a phone. */
const PHONE_SHAPED = /^[+\s().\-\p{Nd}]{8,24}$/u
export function isPhoneShaped(value: string): boolean {
  return PHONE_SHAPED.test(value.trim()) && phoneDigitsOf(value).length >= 8
}

export type MaskedPhoneResolution = { ok: true; phone: string | null } | { ok: false; reason: 'masked_no_match' | 'masked_ambiguous' }

/**
 * A phone value that came back from a client. A real number passes through. A masked value is accepted only when it
 * is the mask of a number the stored record already holds, and then the stored number is used; anything else is
 * refused so a mask can never be written over a real number. `preferred` is the stored number at the same place (the
 * primary phone, or the Contact Option with the same label or position): a mask that fits it is that number, even when
 * another stored number has the same first and last three digits. Without a preferred match the mask must fit exactly
 * ONE distinct stored number; two different numbers behind one mask are refused, never guessed.
 */
export function resolveIncomingPhone(incoming: unknown, stored: ReadonlyArray<unknown>, preferred?: unknown): MaskedPhoneResolution {
  if (incoming == null) return { ok: true, phone: null }
  const text = String(incoming)
  if (!text.includes('*')) return { ok: true, phone: text }
  if (!isMaskedPhone(text)) {
    // An asterisk is never part of a number a person types ("087 ** 321" is a hand-edited mask). The one value allowed to keep one is
    // a stored value sent back unchanged.
    const unchanged = [preferred, ...stored].some((candidate) => candidate != null && String(candidate) === text)
    return unchanged ? { ok: true, phone: text } : { ok: false, reason: 'masked_no_match' }
  }
  if (preferred != null && isMaskOf(text, preferred)) return { ok: true, phone: String(preferred) }
  const hits = new Map<string, string>()
  for (const candidate of stored) if (isMaskOf(text, candidate) && !hits.has(phoneDigitsOf(candidate))) hits.set(phoneDigitsOf(candidate), String(candidate))
  if (hits.size === 0) return { ok: false, reason: 'masked_no_match' }
  if (hits.size > 1) return { ok: false, reason: 'masked_ambiguous' }
  return { ok: true, phone: [...hits.values()][0] }
}
