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

export const MAX_PORTAL_IMAGE_ALT_LENGTH = 200
const CONTROL_CHARACTERS = /\p{Cc}/gu

export function normalizePortalImageAlt(value: unknown): string {
  return capPortalText(plainText(value).replace(CONTROL_CHARACTERS, ''), MAX_PORTAL_IMAGE_ALT_LENGTH)
}
