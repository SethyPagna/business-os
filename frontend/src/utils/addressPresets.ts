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

export function selectedAddressSuffix(selection: Partial<Record<AddressPresetCategory, string>>): string {
  return [selection.subdistrict, selection.district, selection.province]
    .map(normalizeAddressSegment)
    .filter(Boolean)
    .filter((part, index, parts) => parts.findIndex((candidate) => candidate.toLocaleLowerCase() === part.toLocaleLowerCase()) === index)
    .join(', ')
}

function preserveAddressPrefix(value: unknown): string {
  return String(value ?? '').trim().replace(/^,+|,+$/g, '').trim()
}

export function addressPrefixBeforePreset(address: unknown, previousSuffix: unknown): string {
  const current = preserveAddressPrefix(address)
  const suffix = normalizeAddressSegment(previousSuffix)
  if (!suffix) return current
  if (current.toLocaleLowerCase() === suffix.toLocaleLowerCase()) return ''
  const marker = `, ${suffix}`
  return current.toLocaleLowerCase().endsWith(marker.toLocaleLowerCase())
    ? preserveAddressPrefix(current.slice(0, -marker.length))
    : current
}

export function composeAddress(prefix: unknown, selection: Partial<Record<AddressPresetCategory, string>>): { address: string; suffix: string } {
  const normalizedPrefix = preserveAddressPrefix(prefix)
  const suffix = selectedAddressSuffix(selection)
  return { address: [normalizedPrefix, suffix].filter(Boolean).join(', '), suffix }
}

export function cartTotalQuantity(items: Array<{ quantity?: unknown }>): number {
  return items.reduce((total, item) => {
    const quantity = Number(item?.quantity)
    return total + (Number.isFinite(quantity) && quantity > 0 ? quantity : 0)
  }, 0)
}
