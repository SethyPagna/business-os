// Multi-option contact (name/phone/email/address-or-area) parsing and
// serialization, ported from the Docker backend's src/contactOptions.ts
// (see ops/old-archive/backend/src/contactOptions.ts + its test file) and
// kept behaviorally aligned with the frontend's read-side twin,
// frontend/src/components/contacts/contactOptionUtils.ts, which is what
// actually renders/edits this JSON in the Customers/Suppliers/Delivery
// admin pages.
//
// A contact (customer/supplier/delivery contact) can have up to
// CONTACT_OPTION_LIMIT "options" -- e.g. a customer with a home address and
// a work address, each with its own optional name/phone/email. These are
// stored as a JSON array in the `address` column (or, for delivery
// contacts, describe an `area` instead of a street address -- hence the
// `mode` parameter throughout). Older rows may have a single plain string
// in that column instead of JSON, or (for CSV import) a set of
// contact_label_1/contact_name_1/... indexed columns -- every parsing path
// here normalizes all of those into the same option shape.
//
// Call-site note: importEngine.ts's classifyContacts() calls
// `buildImportedContactState(row, contactMode)` with `contactMode` as a
// plain 'address' | 'area' string (not an options object) -- that shape is
// preserved here rather than the legacy `{ mode }` options-object form, so
// this file matches the existing (already-tested) call site exactly.

export const CONTACT_OPTION_LIMIT = 3

export type ContactOptionMode = 'address' | 'area'

export type NormalizedContactOption = {
  label: string | null
  name: string | null
  phone: string | null
  email: string | null
  address: string | null
  area: string | null
}

export type ContactOptionSource = {
  label?: unknown
  name?: unknown
  phone?: unknown
  email?: unknown
  address?: unknown
  area?: unknown
  contact_person?: unknown
  [key: string]: unknown
}

export type ImportedContactState = {
  options: NormalizedContactOption[]
  serialized: string | null
  primary: NormalizedContactOption
}

export function cleanText(value: unknown): string | null {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

export function normalizeContactOption(option: ContactOptionSource = {}, mode: ContactOptionMode = 'address'): NormalizedContactOption {
  return {
    label: cleanText(option.label),
    name: cleanText(option.name),
    phone: cleanText(option.phone),
    email: mode === 'area' ? null : cleanText(option.email),
    address: mode === 'area' ? null : cleanText(option.address),
    area: mode === 'area' ? cleanText(option.area) : null,
  }
}

export function hasContactOptionData(option: ContactOptionSource | NormalizedContactOption = {}, mode: ContactOptionMode = 'address'): boolean {
  const keys = mode === 'area'
    ? (['label', 'name', 'phone', 'area'] as const)
    : (['label', 'name', 'phone', 'email', 'address'] as const)
  for (const key of keys) {
    if (cleanText((option as Record<string, unknown>)[key])) return true
  }
  return false
}

export function collectNormalizedContactOptions(entries: ContactOptionSource[] = [], mode: ContactOptionMode = 'address'): NormalizedContactOption[] {
  const options: NormalizedContactOption[] = []
  for (const entry of Array.isArray(entries) ? entries : []) {
    const option = normalizeContactOption(entry, mode)
    if (hasContactOptionData(option, mode)) {
      options.push(option)
      if (options.length >= CONTACT_OPTION_LIMIT) break
    }
  }
  return options
}

function collectLegacyContactOptions(entries: unknown[] = [], mode: ContactOptionMode = 'address'): NormalizedContactOption[] {
  const options: NormalizedContactOption[] = []
  const legacyKey = mode === 'area' ? 'area' : 'address'
  const values = Array.isArray(entries) ? entries : []
  for (let index = 0; index < values.length; index += 1) {
    const option = normalizeContactOption({
      label: index === 0 ? 'Default' : `Option ${index + 1}`,
      [legacyKey]: values[index],
    }, mode)
    if (hasContactOptionData(option, mode)) {
      options.push(option)
      if (options.length >= CONTACT_OPTION_LIMIT) break
    }
  }
  return options
}

export function parseStoredContactOptions(raw: unknown, mode: ContactOptionMode = 'address'): NormalizedContactOption[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(String(raw))
    if (Array.isArray(parsed)) {
      if (parsed.length && typeof parsed[0] === 'object' && parsed[0] !== null) {
        return collectNormalizedContactOptions(parsed as ContactOptionSource[], mode)
      }
      return collectLegacyContactOptions(parsed, mode)
    }
  } catch (_) {
    // not JSON -- fall through to the plain-string legacy case below
  }
  const legacyKey = mode === 'area' ? 'area' : 'address'
  const fallback = normalizeContactOption({ label: 'Default', [legacyKey]: raw }, mode)
  return hasContactOptionData(fallback, mode) ? [fallback] : []
}

export function parseImportContactOptions(row: Record<string, unknown> = {}, mode: ContactOptionMode = 'address'): NormalizedContactOption[] {
  const valueField = mode === 'area' ? 'area' : 'address'
  const options: NormalizedContactOption[] = []
  for (let index = 1; index <= CONTACT_OPTION_LIMIT; index += 1) {
    const option = normalizeContactOption({
      label: row[`contact_label_${index}`],
      name: row[`contact_name_${index}`],
      phone: row[`contact_phone_${index}`],
      email: mode === 'area' ? null : row[`contact_email_${index}`],
      [valueField]: row[`contact_${valueField}_${index}`],
    }, mode)
    if (hasContactOptionData(option, mode)) options.push(option)
  }
  return options.slice(0, CONTACT_OPTION_LIMIT)
}

export function serializeContactOptions(options: ContactOptionSource[] = [], mode: ContactOptionMode = 'address'): string | null {
  const clean = collectNormalizedContactOptions(options, mode)
  return clean.length ? JSON.stringify(clean) : null
}

export function getPrimaryContactOption(options: ContactOptionSource[] = [], mode: ContactOptionMode = 'address'): NormalizedContactOption {
  for (const entry of Array.isArray(options) ? options : []) {
    if (hasContactOptionData(entry, mode)) return normalizeContactOption(entry, mode)
  }
  return normalizeContactOption({}, mode)
}

// The CSV row may supply contact options three ways, and they are layered
// rather than mutually exclusive:
//   1. A single contact_options JSON cell in the same shape
//      serializeContactOptions() produces (e.g. a previously-exported file
//      re-imported as-is) -- if this parses to real option data, it already
//      represents the complete set including whatever was the default, so
//      it wins outright and nothing else below is consulted.
//   2. The row's own plain name/phone/email/address(/area)/contact_person
//      columns -- these describe ONE thing: this contact's own default
//      info, same as every CSV before contact_label_N columns existed.
//      This is always the unlabeled, position-0 entry when present -- it
//      is never optional/skippable just because indexed columns are also
//      filled in.
//   3. Indexed contact_label_1/contact_name_1/contact_address_1../..._3
//      columns -- ADDITIONAL entries beyond that default (a second
//      address, a backup contact, etc.), each carrying its own label.
// Previously, any data in the indexed columns caused the plain columns to
// be dropped entirely (`importedOptions.length ? importedOptions : ...`),
// silently losing the row's own default address/phone/email and, worse,
// promoting whatever was in contact_label_1 into the primary slot -- which
// then flowed into this contact's own top-level phone/email field in
// classifyContacts (importEngine.ts), making an unrelated backup contact's
// phone number appear as if it were this contact's own. Fixed: the plain
// columns and the indexed columns are now combined, default first.
export function buildImportedContactState(source: Record<string, unknown> = {}, mode: ContactOptionMode = 'address'): ImportedContactState {
  const valueField = mode === 'area' ? 'area' : 'address'
  const rawPrimaryValue = source.contact_options ?? source[valueField]
  const jsonOptions = typeof rawPrimaryValue === 'string' && rawPrimaryValue.trim().startsWith('[')
    ? parseStoredContactOptions(rawPrimaryValue, mode)
    : []

  let storedOptions: NormalizedContactOption[]
  if (jsonOptions.length) {
    storedOptions = jsonOptions
  } else {
    // Deliberately NOT `source.contact_person ?? source.name`: falling back
    // to the row's own top-level `name` here would echo this contact's own
    // name into what's meant to be a distinct "who to contact" field (see
    // suppliers' contact_person consumer below) on every single row, since
    // `name` is required and therefore always present -- turning a row that
    // has only indexed contact_label_N data (no plain phone/email/address
    // of its own) into a spurious, data-free "default" entry that outranks
    // the real indexed ones.
    const defaultOptionData = normalizeContactOption({
      name: source.contact_person,
      phone: source.phone,
      email: source.email,
      [valueField]: source[valueField],
    }, mode)
    // Labeled 'Default' (only once we know it actually carries data --
    // labeling an otherwise-empty option would make hasContactOptionData
    // wrongly treat it as real) to match every other place this same
    // position-0/no-explicit-label option gets displayed -- e.g.
    // parseStoredContactOptions()/collectLegacyContactOptions() above
    // already label a bare/legacy first entry 'Default'. Without this, a
    // row with only plain name/phone/email/address columns (no
    // contact_label_1 of its own -- that column is reserved for
    // *additional* entries, see parseImportContactOptions) imported as an
    // unlabeled option, which then rendered with a blank label in the
    // Customers/Suppliers UI while every other entry showed one.
    const defaultOption = hasContactOptionData(defaultOptionData, mode)
      ? { ...defaultOptionData, label: 'Default' }
      : defaultOptionData
    const additionalOptions = parseImportContactOptions(source, mode)
    storedOptions = hasContactOptionData(defaultOption, mode)
      ? [defaultOption, ...additionalOptions]
      : additionalOptions
  }
  storedOptions = storedOptions.slice(0, CONTACT_OPTION_LIMIT)
  const primary = getPrimaryContactOption(storedOptions, mode)
  return {
    options: storedOptions,
    serialized: serializeContactOptions(storedOptions, mode),
    primary,
  }
}
