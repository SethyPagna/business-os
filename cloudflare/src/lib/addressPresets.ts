export const POS_ADDRESS_PRESETS_KEY = 'pos_address_presets_v1'
export const ADDRESS_PRESET_CATEGORIES = ['province', 'district', 'subdistrict'] as const
export type AddressPresetCategory = typeof ADDRESS_PRESET_CATEGORIES[number]
export type AddressPresets = Record<AddressPresetCategory, string[]>

export const EMPTY_ADDRESS_PRESETS: AddressPresets = { province: [], district: [], subdistrict: [] }
export const MAX_ADDRESS_PRESETS_PER_CATEGORY = 100
export const MAX_ADDRESS_PRESET_LENGTH = 120

export function normalizeAddressSegment(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').replace(/^,+|,+$/g, '').trim()
}

export function normalizeAddressPresetList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of value) {
    const item = normalizeAddressSegment(raw)
    if (!item) continue
    const key = item.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

export function normalizeAddressPresets(value: unknown): AddressPresets {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return {
    province: normalizeAddressPresetList(source.province),
    district: normalizeAddressPresetList(source.district),
    subdistrict: normalizeAddressPresetList(source.subdistrict),
  }
}

export function validateAddressPresets(value: unknown): { presets: AddressPresets; error: string | null } {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  if (!source || ADDRESS_PRESET_CATEGORIES.some((category) => !Array.isArray(source[category]))) {
    return { presets: EMPTY_ADDRESS_PRESETS, error: 'invalid_address_presets' }
  }
  const presets = normalizeAddressPresets(source)
  for (const category of ADDRESS_PRESET_CATEGORIES) {
    if (presets[category].length > MAX_ADDRESS_PRESETS_PER_CATEGORY) return { presets, error: 'too_many_address_presets' }
    if (presets[category].some((item) => item.length > MAX_ADDRESS_PRESET_LENGTH)) return { presets, error: 'address_preset_too_long' }
  }
  return { presets, error: null }
}

export type StoredAddressPresetDocument = { revision: string; presets: AddressPresets }

export function parseStoredAddressPresetDocument(raw: unknown): StoredAddressPresetDocument {
  const document = JSON.parse(String(raw ?? '')) as Record<string, unknown>
  const revision = String(document?.revision || '').trim()
  const validated = validateAddressPresets(document?.presets)
  if (!revision || validated.error) throw new Error('Stored POS address presets are invalid')
  return { revision, presets: validated.presets }
}
