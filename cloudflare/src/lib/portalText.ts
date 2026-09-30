// Stored Website Editor JSON is untrusted: a field that is not a string publishes as empty.
export function plainText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

const KHMER_COENG = '\u17D2'
const ZERO_WIDTH_JOINER = '\u200D'
const JOINS_PREVIOUS_CHARACTER = /^[\p{M}\p{Grapheme_Extend}\p{Emoji_Modifier}\u200D]$/u
const REGIONAL_INDICATOR = /^\p{Regional_Indicator}$/u

function regionalIndicatorsBefore(characters: readonly string[], index: number): number {
  let count = 0
  while (count < index && REGIONAL_INDICATOR.test(characters[index - count - 1])) count += 1
  return count
}

function isCharacterBoundary(characters: readonly string[], index: number): boolean {
  const before = characters[index - 1]
  const after = characters[index]
  if (before === KHMER_COENG || before === ZERO_WIDTH_JOINER || JOINS_PREVIOUS_CHARACTER.test(after)) return false
  return !REGIONAL_INDICATOR.test(after) || regionalIndicatorsBefore(characters, index) % 2 === 0
}

// A cap is a code-point budget, so one huge cluster cannot slip past it. Not Intl.Segmenter: workerd's
// splits a Khmer coeng cluster ('ស្' + 'រ'), so the cut would end on a bare coeng in the Worker only.
export function capPortalText(value: unknown, maxCodePoints: number): string {
  const text = plainText(value)
  if (text.length <= maxCodePoints) return text
  const characters = Array.from(text)
  if (characters.length <= maxCodePoints) return text
  let cut = maxCodePoints
  while (cut > 0 && !isCharacterBoundary(characters, cut)) cut -= 1
  return characters.slice(0, cut).join('')
}

// Owner decision, 27 Sep 2026: the storefront is English and Khmer only (frontend PUBLIC_STOREFRONT_LANGUAGE_OPTIONS).
export const PORTAL_LANGUAGE_CODES: ReadonlySet<string> = new Set(['en', 'km'])
export const AUTOMATIC_PORTAL_LANGUAGE = 'auto'

export function portalLanguageCode(value: unknown): string {
  const code = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return PORTAL_LANGUAGE_CODES.has(code) ? code : ''
}

export function portalLanguageSetting(value: unknown): string | null {
  if (value == null) return AUTOMATIC_PORTAL_LANGUAGE
  if (typeof value !== 'string') return null
  const setting = value.trim().toLowerCase()
  if (!setting || setting === AUTOMATIC_PORTAL_LANGUAGE) return AUTOMATIC_PORTAL_LANGUAGE
  return portalLanguageCode(setting) || null
}

function parsedTranslations(stored: string): Record<string, unknown> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stored)
  } catch {
    return null
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
}

// Leaves every storefront-language block as sent, so the storefront publishes exactly what it did before.
export function withoutOtherLanguageTranslations(stored: string): string {
  const translations = parsedTranslations(stored)
  if (!translations) return stored
  const blocks = Object.entries(translations)
  const storefrontBlocks = blocks.filter(([code]) => portalLanguageCode(code))
  return storefrontBlocks.length === blocks.length ? stored : JSON.stringify(Object.fromEntries(storefrontBlocks))
}

export const MAX_PORTAL_IMAGE_ALT_LENGTH = 200
const CONTROL_CHARACTERS = /\p{Cc}/gu

export function normalizePortalImageAlt(value: unknown): string {
  return capPortalText(plainText(value).replace(CONTROL_CHARACTERS, ''), MAX_PORTAL_IMAGE_ALT_LENGTH)
}
