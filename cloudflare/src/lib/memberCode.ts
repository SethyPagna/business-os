// Website member ids, `W-XXXX-XXXX`: seven random Crockford base32 characters plus a Luhn mod 32 check
// character. The alphabet drops I, L, O and U so a code read over the phone has no look-alike pairs.
// A code is not a credential and never derives from a row id: it comes from crypto.getRandomValues only.

export const MEMBER_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const BASE = MEMBER_CODE_ALPHABET.length
const DATA_LENGTH = 7

export const MEMBER_CODE_PATTERN = /^W-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/

function valueOf(char: string): number {
  return MEMBER_CODE_ALPHABET.indexOf(char)
}

function luhnSum(chars: string, firstFactor: 1 | 2): number {
  let factor = firstFactor
  let sum = 0
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    const value = valueOf(chars[i])
    if (value < 0) throw new Error('member_code_invalid_character')
    let addend = factor * value
    factor = factor === 2 ? 1 : 2
    addend = Math.floor(addend / BASE) + (addend % BASE)
    sum += addend
  }
  return sum
}

export function memberCodeCheckChar(data: string): string {
  return MEMBER_CODE_ALPHABET[(BASE - (luhnSum(data, 2) % BASE)) % BASE]
}

function luhnValid(chars: string): boolean {
  try {
    return luhnSum(chars, 1) % BASE === 0
  } catch {
    return false
  }
}

function format(chars: string): string {
  return `W-${chars.slice(0, 4)}-${chars.slice(4, 8)}`
}

// `random` is injectable for tests only. 256 is a multiple of 32, so `byte % 32` is uniform.
export function mintMemberCode(random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes)): string {
  const bytes = random(new Uint8Array(DATA_LENGTH))
  let data = ''
  for (let i = 0; i < DATA_LENGTH; i += 1) data += MEMBER_CODE_ALPHABET[bytes[i] % BASE]
  return format(data + memberCodeCheckChar(data))
}

// What a person typed -> the canonical `W-XXXX-XXXX`, or null. Case, spaces and dashes are forgiven,
// the W prefix is optional, O reads as 0 and I/L as 1. A wrong check character returns null.
export function normalizeMemberCode(value: unknown): string | null {
  let text = String(value ?? '').toUpperCase().replace(/[\s-]/g, '')
  if (text.startsWith('W') && text.length === 9) text = text.slice(1)
  if (text.length !== 8) return null
  text = text.replace(/O/g, '0').replace(/[IL]/g, '1')
  if (!/^[0-9A-HJKMNP-TV-Z]{8}$/.test(text)) return null
  if (!luhnValid(text)) return null
  return format(text)
}

export function isValidMemberCode(value: unknown): boolean {
  return typeof value === 'string' && MEMBER_CODE_PATTERN.test(value) && normalizeMemberCode(value) === value
}

export function isMemberCodeCollision(error: unknown): boolean {
  const message = String((error as { message?: unknown } | null)?.message ?? error ?? '')
  return /UNIQUE constraint failed/i.test(message) && /member_code/i.test(message)
}
