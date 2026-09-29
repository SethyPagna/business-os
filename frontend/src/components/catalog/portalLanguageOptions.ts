export type PortalLanguage = 'km' | 'en'

export type PortalLanguageOption = { value: PortalLanguage; label: string }

// Owner decision, 27 Sep 2026: the public site offers English and Khmer only.
export const PUBLIC_STOREFRONT_LANGUAGE_OPTIONS: readonly PortalLanguageOption[] = [
  { value: 'km', label: 'Khmer - ភាសាខ្មែរ' },
  { value: 'en', label: 'English' },
]

// Owner, 25 Sep 2026: "Default language of the public site = Khmer".
export const PUBLIC_STOREFRONT_DEFAULT_LANGUAGE: PortalLanguage = 'km'

// Keeps the key visitors' earlier choices were saved under.
export const PORTAL_LANGUAGE_STORAGE_KEY = 'business-os:portal-translate-target'

export function normalizePortalLanguage(value: unknown): PortalLanguage | '' {
  const key = String(value ?? '').trim().toLowerCase()
  return PUBLIC_STOREFRONT_LANGUAGE_OPTIONS.find((option) => option.value === key)?.value ?? ''
}

export function readStoredPortalLanguage(): PortalLanguage | '' {
  if (typeof window === 'undefined') return ''
  try {
    return normalizePortalLanguage(window.localStorage?.getItem(PORTAL_LANGUAGE_STORAGE_KEY))
  } catch {
    return ''
  }
}

export function readPublicStorefrontLanguage(): PortalLanguage {
  return readStoredPortalLanguage() || PUBLIC_STOREFRONT_DEFAULT_LANGUAGE
}

export function storePortalLanguage(language: PortalLanguage): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage?.setItem(PORTAL_LANGUAGE_STORAGE_KEY, language)
  } catch {}
}
