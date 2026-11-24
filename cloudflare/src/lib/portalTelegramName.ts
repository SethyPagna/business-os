// G38 A5: the one name cleaner for a name that came from Telegram or from a member row. The join (S3d, the stored name,
// 80 characters) and the reply texts (S3c, the shortened name, 60 characters) both call it, so the two cannot drift.

export const TELEGRAM_NAME_STORED_MAX = 80
export const TELEGRAM_NAME_REPLY_MAX = 60

// C0 and C1 controls, bidi marks and overrides, zero-width characters, the word joiner, the invisible operators and isolates
// (U+200B-U+200C, U+200E-U+200F, U+202A-U+202E, U+2060-U+206F), the byte order mark (U+FEFF), the Arabic letter mark (U+061C),
// the soft hyphen (U+00AD), the Mongolian vowel separator (U+180E), the Hangul fillers (U+115F, U+1160, U+3164, U+FFA0), the braille blank (U+2800), the combining grapheme joiner (U+034F), the
// tag characters and variation selector tags (U+E0000-U+E007F, U+E0100-U+E01EF). Removed, not turned into spaces. U+200D
// (zero width joiner) and U+FE0F / U+FE0E (variation selectors) stay: they belong inside one emoji.
const HIDDEN = /[\u0000-\u001f\u007f-\u009f\u00AD\u061C\u180E\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u206F\u3164\uFEFF\u115F\u1160\uFFA0\u2800\u034F\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu

// Not a string -> ''. Hidden characters are removed, whitespace runs become one space, the ends are trimmed, and the cut is
// by code points (never inside an emoji or another surrogate pair), then trimmed again. A name of only hidden characters
// comes out empty.
const NOTHING_VISIBLE = /^[\u200D\uFE0F\uFE0E\s]*$/

export function cleanTelegramName(value: unknown, maxCodePoints: number): string {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(HIDDEN, '').replace(/\s+/g, ' ').trim()
  const cut = Array.from(cleaned).slice(0, Math.max(0, maxCodePoints)).join('').trim()
  // joiners and variation selectors with nothing to join are as invisible as the removed characters: no name. Decided on
  // the cut text, so a late letter past the cut cannot leave an invisible name behind.
  return NOTHING_VISIBLE.test(cut) ? '' : cut
}
