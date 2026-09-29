// Suggested passwords: four groups of four, 19 ASCII characters, about 90 bits.
// The alphabet leaves out look-alikes (l, o, I, O, 0, 1) so a suggestion can be
// read aloud or typed from a screen at the till.
export const SUGGEST_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const GROUP_COUNT = 4
const GROUP_LENGTH = 4
const GROUP_SEPARATOR = '-'
const UNBIASED_BYTE_LIMIT = 256 - (256 % SUGGEST_ALPHABET.length)

type RandomFill = (buffer: Uint8Array) => Uint8Array

const cryptoFill: RandomFill = (buffer) => crypto.getRandomValues(buffer)

function drawAlphabetCharacters(count: number, fill: RandomFill): string {
  let drawn = ''
  const buffer = new Uint8Array(count * 2)
  while (drawn.length < count) {
    for (const byte of fill(buffer)) {
      if (byte >= UNBIASED_BYTE_LIMIT) continue
      drawn += SUGGEST_ALPHABET[byte % SUGGEST_ALPHABET.length]
      if (drawn.length === count) break
    }
  }
  return drawn
}

const hasEveryClass = (value: string) => /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value)

export function suggestPassword(fill: RandomFill = cryptoFill): string {
  let characters = ''
  do {
    characters = drawAlphabetCharacters(GROUP_COUNT * GROUP_LENGTH, fill)
  } while (!hasEveryClass(characters))
  const groups = Array.from({ length: GROUP_COUNT }, (_, index) => characters.slice(index * GROUP_LENGTH, (index + 1) * GROUP_LENGTH))
  return groups.join(GROUP_SEPARATOR)
}

export type PasswordStrength = 'weak' | 'fair' | 'strong'
export type PasswordIdentity = { username?: string; name?: string; phone?: string }

const FAIR_MIN_LENGTH = 10
const STRONG_MIN_LENGTH = 14
const MIN_NAME_FRAGMENT = 3
const MIN_PHONE_DIGITS = 6

function characterClassCount(value: string): number {
  return [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((pattern) => pattern.test(value)).length
}

function containsIdentity(password: string, identity: PasswordIdentity): boolean {
  const lowered = password.toLowerCase()
  const names = [identity.username, identity.name]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => value.length >= MIN_NAME_FRAGMENT)
  if (names.some((value) => lowered.includes(value))) return true
  const phoneDigits = String(identity.phone || '').replace(/\D/g, '')
  return phoneDigits.length >= MIN_PHONE_DIGITS && password.replace(/\D/g, '').includes(phoneDigits)
}

// Advice only: the meter never blocks a save (the rule is passwordRules.ts).
export function passwordStrength(password: string, identity: PasswordIdentity = {}): PasswordStrength {
  const classes = characterClassCount(password)
  const oneRepeatedCharacter = new Set(password).size <= 1
  if (password.length < FAIR_MIN_LENGTH || classes < 2 || oneRepeatedCharacter || containsIdentity(password, identity)) return 'weak'
  if (password.length >= STRONG_MIN_LENGTH && classes >= 3) return 'strong'
  return 'fair'
}
