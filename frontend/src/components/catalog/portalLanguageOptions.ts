export type FirstPartyPortalLanguageOption = {
  value: string
  label: string
  nativeLabel: string
  dir: 'ltr' | 'rtl'
  type: 'primary' | 'expanded'
}

export const FIRST_PARTY_PORTAL_LANGUAGE_OPTIONS: FirstPartyPortalLanguageOption[] = [
  { value: 'en', label: 'English', nativeLabel: 'English', dir: 'ltr', type: 'primary' },
  { value: 'km', label: 'Khmer', nativeLabel: 'ភាសាខ្មែរ', dir: 'ltr', type: 'primary' },
  { value: 'zh-CN', label: 'Chinese (Simplified)', nativeLabel: '简体中文', dir: 'ltr', type: 'expanded' },
  { value: 'zh-TW', label: 'Chinese (Traditional)', nativeLabel: '繁體中文', dir: 'ltr', type: 'expanded' },
  { value: 'vi', label: 'Vietnamese', nativeLabel: 'Tiếng Việt', dir: 'ltr', type: 'expanded' },
  { value: 'th', label: 'Thai', nativeLabel: 'ไทย', dir: 'ltr', type: 'expanded' },
  { value: 'ru', label: 'Russian', nativeLabel: 'Русский', dir: 'ltr', type: 'expanded' },
  { value: 'fr', label: 'French', nativeLabel: 'Français', dir: 'ltr', type: 'expanded' },
  { value: 'es', label: 'Spanish', nativeLabel: 'Español', dir: 'ltr', type: 'expanded' },
  { value: 'de', label: 'German', nativeLabel: 'Deutsch', dir: 'ltr', type: 'expanded' },
  { value: 'ja', label: 'Japanese', nativeLabel: '日本語', dir: 'ltr', type: 'expanded' },
  { value: 'ko', label: 'Korean', nativeLabel: '한국어', dir: 'ltr', type: 'expanded' },
  { value: 'pt', label: 'Portuguese', nativeLabel: 'Português', dir: 'ltr', type: 'expanded' },
  { value: 'it', label: 'Italian', nativeLabel: 'Italiano', dir: 'ltr', type: 'expanded' },
  { value: 'ar', label: 'Arabic', nativeLabel: 'العربية', dir: 'rtl', type: 'expanded' },
  { value: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी', dir: 'ltr', type: 'expanded' },
  { value: 'id', label: 'Indonesian', nativeLabel: 'Bahasa Indonesia', dir: 'ltr', type: 'expanded' },
  { value: 'ms', label: 'Malay', nativeLabel: 'Bahasa Melayu', dir: 'ltr', type: 'expanded' },
  { value: 'tr', label: 'Turkish', nativeLabel: 'Türkçe', dir: 'ltr', type: 'expanded' },
]

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
