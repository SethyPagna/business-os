import { parseStoredContactOptions, serializeContactOptions } from './contactOptionUtils.ts'

// A contact save carries a phone field only when the person changed it (P2.8-F, 3 Nov 2026).
//
// An account without "See full phone numbers" is shown `012 *** 678`, and an edit form fills its phone boxes from what it was shown.
// Sending that mask back on a notes-only save asks the Worker to work out which stored number it hides; when a Contact Option has
// no unique label and its mask also fits another of the contact's numbers, the Worker cannot, and refuses the whole save
// (400 masked_phone_input, which is right). The save never needed the numbers: it changed the notes. So the forms say which of the
// two phone fields (the primary `phone`, and `address`, the Contact Options that hold the other numbers) are untouched, and the
// PUT leaves them out. The Worker reads an absent field as "unchanged" (routes/contacts.ts pickColumns); an empty string is a
// change (it clears the field), so the two must not be confused: only an absent field is "unchanged".
export type UntouchedPhoneFields = { readonly phone: boolean; readonly address: boolean }

/** Nothing is untouched: a create, whose every field is new, sends everything. */
export const ALL_PHONE_FIELDS_SENT: UntouchedPhoneFields = { phone: false, address: false }

type PhoneFields = { phone?: unknown; address?: unknown }
type OptionField = 'address' | 'area'

const phoneText = (value: unknown): string => String(value ?? '').trim()
const optionsText = (value: unknown, legacyField: OptionField): string => serializeContactOptions(parseStoredContactOptions(value, { legacyField })) ?? ''

/**
 * Which phone fields `current` leaves as `baseline` had them. `baseline` is what the form held when it opened (the loaded
 * phone, and the Contact Options as the form first showed them); `current` is what the form is about to send. The options are
 * compared as the form would serialize them, so a blank option row or JSON spacing is not a change.
 */
export function untouchedPhoneFields(baseline: PhoneFields, current: PhoneFields, legacyField: OptionField = 'address'): UntouchedPhoneFields {
  return {
    phone: phoneText(baseline.phone) === phoneText(current.phone),
    address: optionsText(baseline.address, legacyField) === optionsText(current.address, legacyField),
  }
}

// What an account without "See full phone numbers" is shown for a number: `012 *** 678` (lib/phoneMask.ts). Its edit snapshot holds the mask, not the number.
const SHOWN_MASK = /\*\*\*/

/**
 * True when UNDOING this edit would have to put back a phone the editor could not see (P2.8-F N1, 3 Nov 2026). The undo replays the
 * snapshot taken before the edit, and an account without the grant took it from a masked list, so the field it would replay is the
 * mask. The Worker reads a mask as "the number you already hold": it would answer 200 and keep the NEW number (or refuse when the new
 * number has a different mask). Undo is refused up front instead, with a reason, and nothing is written. A field the edit did not
 * touch is not replayed (withoutUntouchedPhoneFields), and a holder's snapshot has real numbers, so neither case is refused.
 */
export const UNDO_PHONE_HIDDEN_FALLBACK = 'Undo was refused: this edit changed a phone number you cannot see, and the old number cannot be put back from here. Nothing was changed.'

export function undoNeedsHiddenPhone(before: object, untouched: UntouchedPhoneFields | null | undefined): boolean {
  if (!untouched) return false
  const { phone, address } = before as PhoneFields
  return (!untouched.phone && SHOWN_MASK.test(phoneText(phone))) || (!untouched.address && SHOWN_MASK.test(String(address ?? '')))
}

/** `payload` without the phone fields the edit did not touch. Use it on an UPDATE only: a create needs every field. */
export function withoutUntouchedPhoneFields<T extends object>(payload: T, untouched: UntouchedPhoneFields | null | undefined): T {
  if (!untouched || (!untouched.phone && !untouched.address)) return payload
  const next = { ...payload } as unknown as Record<string, unknown>
  if (untouched.phone) delete next.phone
  if (untouched.address) delete next.address
  return next as unknown as T
}
