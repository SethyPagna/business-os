// A phone value that is a mask (`012 *** 678`) must never be written over a real number; it fires only for a mask already saved or sent by an old tab.
import { parseStoredContactOptions, serializeContactOptions, type ContactOptionMode } from './contactOptions'
import { isMaskedPhone, isMaskOf, resolveIncomingPhone } from './phoneMask'

export const MASKED_PHONE_CODE = 'masked_phone_input'
export const MASKED_PHONE_MESSAGE = 'A phone number in this request is incomplete (it shows ***). Type the full number, or leave the phone unchanged.'

export class MaskedPhoneInputError extends Error {
  readonly code = MASKED_PHONE_CODE
  constructor() { super(MASKED_PHONE_MESSAGE) }
}

export function isMaskedPhoneInputError(error: unknown): error is MaskedPhoneInputError {
  return error instanceof MaskedPhoneInputError
}

type PhoneBearingRecord = { phone?: unknown; address?: unknown } | null | undefined

// The text fields of a Contact Option. One saved under a number (a contact person that is a phone) shows masked and comes back masked.
const OPTION_TEXT_FIELDS = ['name', 'label'] as const
const isMaskedText = (value: unknown): boolean => typeof value === 'string' && isMaskedPhone(value)

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
function storedCounterpart(option: Record<string, unknown>, index: number, storedOptions: ReadonlyArray<{ label: string | null; name: string | null; phone: string | null }>) {
  const byLabel = storedOptions.filter((candidate) => sameLabel(candidate.label, option.label))
  if (byLabel.length === 1) return { phone: byLabel[0].phone, byPosition: false, stored: byLabel[0] }
  const positional = storedOptions[index]
  return positional ? { phone: positional.phone, byPosition: true, stored: positional } : null
}

/**
 * Contact Options text from a client. Each option whose phone came back masked takes the number of the stored option it edits
 * (same label, else same position) when the mask is that number's; any other masked phone throws. The same for an option's name and
 * label (a contact person saved as a number shows masked too, review B1). Text with no mask is returned exactly as it arrived.
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
    const maskedPhone = typeof option.phone === 'string' && option.phone.includes('*')
    const maskedText = OPTION_TEXT_FIELDS.filter((field) => isMaskedText(option[field]))
    if (!maskedPhone && maskedText.length === 0) return entry
    changed = true
    const counterpart = storedCounterpart(option, index, storedOptions)
    const resolved: Record<string, unknown> = { ...option }
    if (maskedPhone) resolved.phone = resolvePhoneInput(option.phone, counterpart?.byPosition ? everyStored : [], counterpart?.phone, counterpart?.byPosition === true)
    for (const field of maskedText) {
      const kept = counterpart?.stored[field]
      if (kept == null || !isMaskOf(option[field], kept)) throw new MaskedPhoneInputError()
      resolved[field] = kept
    }
    return resolved
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
    return Array.isArray(parsed) && parsed.some((entry) => {
      if (!entry || typeof entry !== 'object') return false
      const option = entry as Record<string, unknown>
      return (typeof option.phone === 'string' && option.phone.includes('*')) || OPTION_TEXT_FIELDS.some((field) => isMaskedText(option[field]))
    })
  } catch { return false }
}

/** An import row (contacts or sales) whose phone cells carry a mask: any phone column, or Contact Options JSON in the address cell. */
export function rowHasMaskedPhone(row: Record<string, unknown>): boolean {
  return bodyHasMaskedPhone(row)
}
