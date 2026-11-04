// An Undo that would have to put back a value the editor could not see is refused, never faked (P2.8-F, 4 Nov 2026).
//
// An account without "See full phone numbers" is shown a value that is only a number as `097 *** 822`: a phone, but also a contact saved
// under its number, a note, a label or a contact person that is one (cloudflare/src/lib/phoneAccess.ts). The edit's Undo replays the
// snapshot taken before the edit, so for such a field it would replay the MASK. The Worker reads a mask as "the value you already hold"
// (a value that is only a mask is taken out of the request, lib/phoneMaskMiddleware.ts), so the write would answer 200 and the field
// would keep its NEW value: a silent non-restore, which is wrong data. So when the edit changed a field that was shown masked, the
// Undo is refused up front, with a reason, and nothing is written. A field the edit left alone shows the same mask on both sides and
// is not a reason; a holder's snapshot has the real values and is never refused.
//
// The shapes are the ones the masker writes (cloudflare/src/lib/phoneMask.ts MASK_SHAPE): up to three digits, `***`, up to three
// digits, or the bare `***`; and the same inside quotes in a sentence (a reason that quotes a number). A note that merely contains
// "***" or digits ("call *** later", "ref 4471") is not a mask.

/** The reason shown to the person (pack key `contact_undo_phone_hidden`, en and km). */
export const UNDO_HIDDEN_VALUE_FALLBACK = 'Undo was refused: this edit changed a number you cannot see (it shows ***), and the old number cannot be put back from here. Nothing was changed. Edit it directly, or ask someone who can see full phone numbers.'

const MASK = '(?:\\*\\*\\*|\\d{1,3} \\*\\*\\* \\d{1,3})'
const WHOLE_MASK = new RegExp(`^${MASK}$`)
const QUOTED_MASK = new RegExp(`["'“‘]{1,2}${MASK}["'”’]{1,2}`)

/** True when `value` is exactly what the masker shows for a hidden number, or a sentence that quotes one. */
export function isShownMask(value: unknown): boolean {
  if (typeof value !== 'string' || !value.includes('***')) return false
  const text = value.replace(/\s+/g, ' ').trim()
  return WHOLE_MASK.test(text) || QUOTED_MASK.test(text)
}

function replaysAMask(before: unknown, after: unknown, depth: number): boolean {
  if (depth > 8) return false
  if (typeof before === 'string') return isShownMask(before) && after !== undefined && String(after ?? '') !== before
  if (before === null || typeof before !== 'object' || after === null || typeof after !== 'object') return false
  if (Array.isArray(before)) return Array.isArray(after) && before.some((item, index) => replaysAMask(item, after[index], depth + 1))
  const afterRecord = after as Record<string, unknown>
  return Object.keys(before).some((key) => replaysAMask((before as Record<string, unknown>)[key], afterRecord[key], depth + 1))
}

/**
 * True when UNDOING an edit would have to replay a mask over a field the edit changed. `before` is the snapshot taken ahead of the edit
 * (read masked), `after` what the edit saved: a field present on both sides whose masked `before` value differs from its `after` value
 * was changed. A field the edit did not send (absent from `after`) or left as shown (the same mask) is not a reason.
 */
export function undoNeedsHiddenValue(before: unknown, after: unknown): boolean {
  if (before === null || typeof before !== 'object') return false // a snapshot is a record; a bare string has no field
  return replaysAMask(before, after, 0)
}

/** The same question for several snapshots edited by one action (a bulk edit): any one is enough. */
export function undoNeedsHiddenValueIn(snapshots: ReadonlyArray<unknown>, after: unknown): boolean {
  return snapshots.some((snapshot) => undoNeedsHiddenValue(snapshot, after))
}
