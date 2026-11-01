// The one phone masking format, shared by every channel (owner ruling 2 Nov 2026, round 1 Q3).
//
//   012 345 678        -> 012 *** 678
//   +855 12 345 678    -> 012 *** 678   (the +855 / 855 / 00855 forms fold to the national 0 form first)
//   ០១២ ៣៤៥ ៦៧៨       -> 012 *** 678   (Khmer, Arabic-Indic and full-width digits become ASCII first)
//
// The first and last three digits stay and the rest become `***`. A number too short to show six digits keeps fewer
// (always at least three digits stay hidden), and a value with no digit has nothing to hide. A masked value is
// idempotent: masking it again returns it unchanged, so a payload that passes two layers is never mangled.
//
// Pure: no imports from the Worker, so the same file is loaded by the tests and the Telegram composers.

export const PHONE_MASK_MARK = '***'

const KHMER_ZERO = 0x17e0
const ARABIC_INDIC_ZERO = 0x0660
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0
const FULLWIDTH_ZERO = 0xff10

export function toAsciiDigits(value: string): string {
  let out = ''
  for (const char of value) {
    const code = char.codePointAt(0) as number
    if (code >= 0x30 && code <= 0x39) out += char
    else if (code >= KHMER_ZERO && code <= KHMER_ZERO + 9) out += String(code - KHMER_ZERO)
    else if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) out += String(code - ARABIC_INDIC_ZERO)
    else if (code >= EXTENDED_ARABIC_INDIC_ZERO && code <= EXTENDED_ARABIC_INDIC_ZERO + 9) out += String(code - EXTENDED_ARABIC_INDIC_ZERO)
    else if (code >= FULLWIDTH_ZERO && code <= FULLWIDTH_ZERO + 9) out += String(code - FULLWIDTH_ZERO)
    else out += char
  }
  return out
}

/** The digits of a phone as typed, any script, with the Cambodian country code folded to the national 0 form. */
export function phoneDigitsOf(value: unknown): string {
  const digits = toAsciiDigits(String(value ?? '')).replace(/\D/g, '')
  if (/^(?:00)?855\d{8,9}$/.test(digits)) return `0${digits.replace(/^(?:00)?855/, '')}`
  return digits
}

export function isMaskedPhone(value: unknown): boolean {
  return typeof value === 'string' && value.includes('*')
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
const PHONE_IN_TEXT = /(?:\+|00)?[\d០-៩٠-٩۰-۹０-９](?:[\s().-]?[\d០-៩٠-٩۰-۹０-９]){6,}/g
export function maskPhonesInText(text: string): string {
  return text.replace(PHONE_IN_TEXT, (match) => {
    const masked = maskPhone(match)
    return typeof masked === 'string' ? masked : match
  })
}

/** A name field that is really a number (a contact saved by its phone): the whole value is a phone. */
const PHONE_SHAPED = /^[+\d\s().\-០-៩٠-٩۰-۹０-９]{8,24}$/
export function isPhoneShaped(value: string): boolean {
  return PHONE_SHAPED.test(value.trim()) && phoneDigitsOf(value).length >= 8
}

export type MaskedPhoneResolution = { ok: true; phone: string | null } | { ok: false; reason: 'masked_no_match' }

/**
 * A phone value that came back from a client. A real number passes through. A masked value is accepted only when it
 * is the mask of one of the numbers the stored record already holds, and then the stored number is used; anything
 * else is refused so a mask can never be written over a real number.
 */
export function resolveIncomingPhone(incoming: unknown, stored: ReadonlyArray<unknown>): MaskedPhoneResolution {
  if (incoming == null) return { ok: true, phone: null }
  const text = String(incoming)
  if (!isMaskedPhone(text)) return { ok: true, phone: text }
  const hit = stored.find((candidate) => isMaskOf(text, candidate))
  return hit == null ? { ok: false, reason: 'masked_no_match' } : { ok: true, phone: String(hit) }
}
