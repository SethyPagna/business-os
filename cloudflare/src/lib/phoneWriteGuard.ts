// A masked phone must never be written over a real one (P2.8, 6.0.1046).
//
// An account without `contacts_full_phone` reads `012 *** 678`. The screens that let it edit a contact, pick a customer for
// a sale or resolve a duplicate send what they were shown back to the Worker; a Worker that saved it would replace a real
// number with a mask. So a phone that comes back masked is resolved against the record it belongs to: it is accepted only
// when it is the mask of a number that record already holds (primary phone or one of its Contact Options), and then the
// stored number is kept. Anything else is refused. A real number typed by the person passes through untouched.
import { parseStoredContactOptions, serializeContactOptions, type ContactOptionMode } from './contactOptions'
import { isMaskedPhone, resolveIncomingPhone } from './phoneMask'

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
export function resolvePhoneInput(incoming: unknown, stored: ReadonlyArray<unknown>): string | null {
  if (incoming == null) return null
  const resolved = resolveIncomingPhone(incoming, stored)
  if (!resolved.ok) throw new MaskedPhoneInputError()
  return resolved.phone
}

/**
 * Contact Options text from a client. Each option whose phone came back masked takes the stored number it hides; a masked
 * phone that hides none throws. Text with no mask is returned exactly as it arrived.
 */
export function resolveAddressInput(incoming: unknown, stored: ReadonlyArray<unknown>, mode: ContactOptionMode = 'address'): unknown {
  if (typeof incoming !== 'string' || !incoming.includes('*')) return incoming
  const text = incoming.trim()
  if (!text.startsWith('[')) return incoming
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return incoming }
  if (!Array.isArray(parsed)) return incoming
  let changed = false
  const options = parsed.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry
    const option = entry as Record<string, unknown>
    if (typeof option.phone !== 'string' || !isMaskedPhone(option.phone)) return entry
    changed = true
    return { ...option, phone: resolvePhoneInput(option.phone, stored) }
  })
  if (!changed) return incoming
  return serializeContactOptions(options as Array<Record<string, unknown>>, mode) ?? incoming
}

/** True when a request body carries a mask in any phone field (used to refuse a create that has no record to resolve against). */
export function bodyHasMaskedPhone(body: Record<string, unknown>): boolean {
  for (const key of Object.keys(body)) {
    const value = body[key]
    if (/phone/i.test(key) && typeof value === 'string' && isMaskedPhone(value)) return true
    if (/^address$|^contact_options$/i.test(key) && typeof value === 'string' && value.includes('*') && /"phone"\s*:\s*"[^"]*\*/.test(value)) return true
  }
  return false
}

/** An import row (contacts or sales) whose phone cells carry a mask: any phone column, or Contact Options JSON in the address cell. */
export function rowHasMaskedPhone(row: Record<string, unknown>): boolean {
  return bodyHasMaskedPhone(row)
}
