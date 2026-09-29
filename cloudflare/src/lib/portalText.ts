// Stored Website Editor JSON is untrusted: a field that is not a string publishes as empty.
export function plainText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

// A cap is a code-point budget, so one huge grapheme cluster cannot slip past it.
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function codePointCount(text: string): number {
  let count = 0
  for (const _ of text) count += 1
  return count
}

// Cuts between grapheme clusters, so a Khmer cluster or a ZWJ emoji is kept whole or dropped whole.
export function capPortalText(value: unknown, maxCodePoints: number): string {
  const text = plainText(value)
  if (text.length <= maxCodePoints) return text
  let kept = ''
  let used = 0
  for (const { segment } of graphemes.segment(text)) {
    used += codePointCount(segment)
    if (used > maxCodePoints) break
    kept += segment
  }
  return kept
}

export const MAX_PORTAL_IMAGE_ALT_LENGTH = 200
const CONTROL_CHARACTERS = /\p{Cc}/gu

export function normalizePortalImageAlt(value: unknown): string {
  return capPortalText(plainText(value).replace(CONTROL_CHARACTERS, ''), MAX_PORTAL_IMAGE_ALT_LENGTH)
}
