// Website member IDs (G38 Phase 1, design §4.2): `W-XXXX-XXXX`.
//
// Seven random Crockford base32 characters plus one check character, shown
// upper case in two groups of four. The alphabet drops I, L, O and U, so a
// code read over the phone or typed at the till has no look-alike pairs.
//
// The code is NOT a credential and is never derived from a row id: it comes
// from crypto.getRandomValues only, so it cannot be enumerated in order the
// way the store's sequential LC-##### numbers can. No public endpoint accepts
// it as proof of anything.
//
// The check character is Luhn mod 32 over the seven data characters. It
// catches every single wrong character and nearly every swap of two
// neighbours before any lookup happens.
//
// Pure, dependency-free: the pure test runs it as is.

export const MEMBER_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const BASE = MEMBER_CODE_ALPHABET.length // 32
const DATA_LENGTH = 7

export const MEMBER_CODE_PATTERN = /^W-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/

function valueOf(char: string): number {
  return MEMBER_CODE_ALPHABET.indexOf(char)
}

// Luhn mod N, generating side: double every second value counting from the
// right of the data, fold each product back into one base-32 digit.
export function memberCodeCheckChar(data: string): string {
  let factor = 2
  let sum = 0
  for (let i = data.length - 1; i >= 0; i -= 1) {
    const value = valueOf(data[i])
    if (value < 0) throw new Error('member_code_invalid_character')
    let addend = factor * value
    factor = factor === 2 ? 1 : 2
    addend = Math.floor(addend / BASE) + (addend % BASE)
    sum += addend
  }
  return MEMBER_CODE_ALPHABET[(BASE - (sum % BASE)) % BASE]
}

function luhnValid(chars: string): boolean {
  let factor = 1
  let sum = 0
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    const value = valueOf(chars[i])
    if (value < 0) return false
    let addend = factor * value
    factor = factor === 2 ? 1 : 2
    addend = Math.floor(addend / BASE) + (addend % BASE)
    sum += addend
  }
  return sum % BASE === 0
}

function format(chars: string): string {
  return `W-${chars.slice(0, 4)}-${chars.slice(4, 8)}`
}

// A fresh random code. `random` is injectable for tests only; production
// always uses crypto.getRandomValues. 256 is a multiple of 32, so `byte % 32`
// is uniform.
export function mintMemberCode(random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes)): string {
  const bytes = random(new Uint8Array(DATA_LENGTH))
  let data = ''
  for (let i = 0; i < DATA_LENGTH; i += 1) data += MEMBER_CODE_ALPHABET[bytes[i] % BASE]
  return format(data + memberCodeCheckChar(data))
}

// What a person typed -> the canonical `W-XXXX-XXXX`, or null. Case, spaces
// and dashes are forgiven, the W prefix is optional, and Crockford's decoding
// maps O -> 0 and I/L -> 1. A wrong check character returns null.
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
