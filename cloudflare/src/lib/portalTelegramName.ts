// G38 A5: the one name cleaner for a name that came from Telegram or from a member row. The join (S3d, the stored name,
// 80 characters) and the reply texts (S3c, the shortened name, 60 characters) both call it, so the two cannot drift.

export const TELEGRAM_NAME_STORED_MAX = 80
export const TELEGRAM_NAME_REPLY_MAX = 60

// C0 and C1 controls, bidi marks and overrides, zero-width characters, the word joiner, the invisible operators and isolates
// (U+200B-U+200F, U+202A-U+202E, U+2060-U+2069) and the byte order mark (U+FEFF). Removed, not turned into spaces.
const HIDDEN = /[\u0000-\u001f\u007f-\u009f\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g

// Not a string -> ''. Hidden characters are removed, whitespace runs become one space, the ends are trimmed, and the cut is
// by code points (never inside an emoji or another surrogate pair), then trimmed again. A name of only hidden characters
// comes out empty.
export function cleanTelegramName(value: unknown, maxCodePoints: number): string {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(HIDDEN, '').replace(/\s+/g, ' ').trim()
  return Array.from(cleaned).slice(0, Math.max(0, maxCodePoints)).join('').trim()
}
