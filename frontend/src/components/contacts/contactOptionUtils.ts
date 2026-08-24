export const CONTACT_OPTION_LIMIT = 3

type PlainRecord = Record<string, unknown>
type LegacyContactField = 'address' | 'area'
type ContactOptionMode = 'address' | 'area'

type LegacyFieldOptions = {
  legacyField?: LegacyContactField
}

type ContactOptionModeOptions = {
  mode?: ContactOptionMode
}

export type ContactOption = {
  label: string
  name: string
  phone: string
  email: string
  address: string
  area: string
}

function isPlainRecord(value: unknown): value is PlainRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readStringField(source: unknown, key: string): string {
  if (!isPlainRecord(source)) return ''
  return String(source[key] || '').trim()
}

export function createContactOption(overrides: Partial<ContactOption> = {}): ContactOption {
  return {
    label: '',
    name: '',
    phone: '',
    email: '',
    address: '',
    area: '',
    ...overrides,
  }
}

function normalizeOption(option: unknown = {}, { legacyField = 'address' }: LegacyFieldOptions = {}): ContactOption {
  const legacyValue = readStringField(option, legacyField)
  return {
    label: readStringField(option, 'label'),
    name: readStringField(option, 'name'),
    phone: readStringField(option, 'phone'),
    email: readStringField(option, 'email'),
    address: readStringField(option, 'address') || (legacyField === 'address' ? legacyValue : ''),
    area: readStringField(option, 'area') || (legacyField === 'area' ? legacyValue : ''),
  }
}

export function limitContactOptions<T>(options: readonly T[] | null | undefined = []): T[] {
  return (Array.isArray(options) ? options : []).slice(0, CONTACT_OPTION_LIMIT)
}

export function parseStoredContactOptions(raw: unknown, { legacyField = 'address' }: LegacyFieldOptions = {}): ContactOption[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(String(raw))
    if (Array.isArray(parsed)) {
      if (!parsed.length) return []
      if (isPlainRecord(parsed[0])) {
        return limitContactOptions(parsed.map((option) => normalizeOption(option, { legacyField }))).filter(hasContactOptionData)
      }
      return limitContactOptions(parsed.map((value, index) => normalizeOption({
        label: index === 0 ? 'Default' : `Option ${index + 1}`,
        [legacyField]: String(value || ''),
      }, { legacyField }))).filter(hasContactOptionData)
    }
  } catch (_) {}
  return limitContactOptions([normalizeOption({
    label: 'Default',
    [legacyField]: String(raw),
  }, { legacyField })]).filter(hasContactOptionData)
}

export function hasContactOptionData(option: unknown = {}): boolean {
  return [
    readStringField(option, 'label'),
    readStringField(option, 'name'),
    readStringField(option, 'phone'),
    readStringField(option, 'email'),
    readStringField(option, 'address'),
    readStringField(option, 'area'),
  ].some((value) => String(value || '').trim())
}

export function serializeContactOptions(options: readonly unknown[] = []): string | null {
  const clean = limitContactOptions(options)
    .map((option) => normalizeOption(option))
    .filter(hasContactOptionData)
  return clean.length ? JSON.stringify(clean) : null
}

export function buildContactOptionSummary(options: readonly unknown[] = [], { mode = 'address' }: ContactOptionModeOptions = {}): string {
  const key = mode === 'area' ? 'area' : 'address'
  const cleanOptions = limitContactOptions(options).map((option) => normalizeOption(option))
  if (!cleanOptions.length) return '-'
  return cleanOptions.map((option, index) => {
    const parts = [option.name, option.phone, option.email, option[key]].filter(Boolean)
    return `#${index + 1} ${option.label ? `(${option.label}) ` : ''}${parts.join(' | ') || '-'}`
  }).join('\n')
}

export function parseContactOptionsFromImportRow(row: PlainRecord = {}, { mode = 'address' }: ContactOptionModeOptions = {}): ContactOption[] {
  const options: ContactOption[] = []
  const valueField = mode === 'area' ? 'area' : 'address'
  for (let index = 1; index <= CONTACT_OPTION_LIMIT; index += 1) {
    const option = createContactOption({
      label: readStringField(row, `contact_label_${index}`),
      name: readStringField(row, `contact_name_${index}`),
      phone: readStringField(row, `contact_phone_${index}`),
      email: mode === 'area' ? '' : readStringField(row, `contact_email_${index}`),
      [valueField]: readStringField(row, `contact_${valueField}_${index}`),
    })
    if (hasContactOptionData(option)) options.push(option)
  }
  return limitContactOptions(options)
}

export function getPrimaryContactOption(options: readonly unknown[] = [], { fallback = {} }: { fallback?: Partial<ContactOption> } = {}): ContactOption {
  const first = limitContactOptions(options).find(hasContactOptionData)
  if (first) return normalizeOption(first)
  return createContactOption(fallback)
}
