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

const PACK_BY_LOWER = new Map(
  FIRST_PARTY_PORTAL_LANGUAGE_OPTIONS.map((option) => [option.value.toLowerCase(), option.value])
)

export function normalizeFirstPartyPortalLanguage(value: unknown): string {
  const key = String(value || '').trim().toLowerCase()
  return PACK_BY_LOWER.get(key) || ''
}

export function isFirstPartyPortalLanguage(value: unknown): boolean {
  return !!normalizeFirstPartyPortalLanguage(value)
}
