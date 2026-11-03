// A masked phone must never be written over a real one (P2.8, 6.0.1046).
//
// An account without `contacts_full_phone` reads `012 *** 678`. The screens that let it edit a contact, pick a customer for
// a sale or resolve a duplicate send what they were shown back to the Worker; a Worker that saved it would replace a real
// number with a mask. So a phone that comes back masked is resolved against the record it belongs to: it is accepted only
// when it is the mask of the number that record holds at the same place (the primary phone; a Contact Option with the same
// label, else the same position), and then the stored number is kept. Two stored numbers can share their first and last three
// digits, so a mask is never matched against "any stored number": one that fits two different numbers is refused. Anything
// else is refused too. A real number typed by the person passes through untouched.
import { parseStoredContactOptions, serializeContactOptions, type ContactOptionMode } from './contactOptions'
import { resolveIncomingPhone } from './phoneMask'

export const MASKED_PHONE_CODE = 'masked_phone_input'
export const MASKED_PHONE_MESSAGE = 'A phone number in this request is hidden (it shows ***). Type the full number, or leave the phone unchanged.'

export class MaskedPhoneInputError extends Error {
  readonly code = MASKED_PHONE_CODE
  constructor() { super(MASKED_PHONE_MESSAGE) }
}

export function isMaskedPhoneInputError(error: unknown): error is MaskedPhoneInputError {
  return error instanceof MaskedPhoneInputError
}

type PhoneBearingRecord = { phone?: unknown; address?: unknown } | null | undefined

/** Every number a stored contact holds: the primary phone and each Contact Option's phone. */
export function storedPhonesOf(record: PhoneBearingRecord, mode: ContactOptionMode = 'address'): string[] {
  if (!record) return []
  const phones: string[] = []
  const primary = String(record.phone ?? '').trim()
  if (primary) phones.push(primary)
  for (const option of parseStoredContactOptions(record.address, mode)) {
    if (option.phone) phones.push(option.phone)
  }
  return phones
}

/** A phone field from a client: real values pass, a mask resolves to the stored number it hides, anything else throws. */
export function resolvePhoneInput(incoming: unknown, stored: ReadonlyArray<unknown>, preferred?: unknown, requireUnique = false): string | null {
  if (incoming == null) return null
  const resolved = resolveIncomingPhone(incoming, stored, preferred, requireUnique)
  if (!resolved.ok) throw new MaskedPhoneInputError()
  return resolved.phone
}

const sameLabel = (left: unknown, right: unknown): boolean => {
  const a = String(left ?? '').trim().toLowerCase()
  return a !== '' && a === String(right ?? '').trim().toLowerCase()
}

/**
 * The stored option an incoming option edits: the one with its label when exactly one has it, else the one at its position. A label
 * identifies the option; a position does not (delete the first option and rename the survivor, and it now sits at position 0), so a
 * position match is only trusted when the mask fits exactly one distinct stored number.
 */
function storedCounterpart(option: Record<string, unknown>, index: number, storedOptions: ReadonlyArray<{ label: string | null; phone: string | null }>) {
  const byLabel = storedOptions.filter((candidate) => sameLabel(candidate.label, option.label))
  if (byLabel.length === 1) return { phone: byLabel[0].phone, byPosition: false }
  const positional = storedOptions[index]
  return positional ? { phone: positional.phone, byPosition: true } : null
}

/**
 * Contact Options text from a client. Each option whose phone came back masked takes the number of the stored option it edits
 * (same label, else same position) when the mask is that number's; any other masked phone throws. Text with no mask is
 * returned exactly as it arrived.
 */
export function resolveAddressInput(incoming: unknown, stored: PhoneBearingRecord, mode: ContactOptionMode = 'address'): unknown {
  if (typeof incoming !== 'string' || !incoming.includes('*')) return incoming
  const text = incoming.trim()
  if (!text.startsWith('[')) return incoming
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return incoming }
  if (!Array.isArray(parsed)) return incoming
  let changed = false
  const storedOptions = parseStoredContactOptions(stored?.address, mode)
  const everyStored = storedPhonesOf(stored, mode)
  const options = parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object') return entry
    const option = entry as Record<string, unknown>
    if (typeof option.phone !== 'string' || !option.phone.includes('*')) return entry
    changed = true
    const counterpart = storedCounterpart(option, index, storedOptions)
    return { ...option, phone: resolvePhoneInput(option.phone, counterpart?.byPosition ? everyStored : [], counterpart?.phone, counterpart?.byPosition === true) }
  })
  if (!changed) return incoming
  return serializeContactOptions(options as Array<Record<string, unknown>>, mode) ?? incoming
}

/** True when a request body carries a mask, or a number with an asterisk in it, in any phone field (used to refuse a create that has no record to resolve against). */
export function bodyHasMaskedPhone(body: Record<string, unknown>): boolean {
  for (const key of Object.keys(body)) {
    const value = body[key]
    if (/phone/i.test(key) && typeof value === 'string' && value.includes('*')) return true
    if (/^address$|^contact_options$/i.test(key) && typeof value === 'string' && value.includes('*') && optionsHaveMaskedPhone(value)) return true
  }
  return false
}

function optionsHaveMaskedPhone(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text)
    return Array.isArray(parsed) && parsed.some((entry) => { const phone = !!entry && typeof entry === 'object' ? (entry as Record<string, unknown>).phone : null; return typeof phone === 'string' && phone.includes('*') })
  } catch { return false }
}

/** An import row (contacts or sales) whose phone cells carry a mask: any phone column, or Contact Options JSON in the address cell. */
export function rowHasMaskedPhone(row: Record<string, unknown>): boolean {
  return bodyHasMaskedPhone(row)
}
