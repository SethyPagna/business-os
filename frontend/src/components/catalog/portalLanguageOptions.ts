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

/**
 * Ready-to-render dropdown options for the "translate this page" picker:
 * 'Original' plus every first-party language, labeled "English name -
 * Native name" when the two differ. Single source of truth for both the
 * admin editor's live preview (CatalogPage.tsx) and the real public portal
 * (PublicCatalogPage.tsx) so the two can't silently drift apart again —
 * that drift (the public portal hardcoding only 3 of these) was the root
 * cause of most languages appearing "not to work" on the live site.
 */
export const FIRST_PARTY_TRANSLATE_LANG_OPTIONS: { value: string; label: string; kind: 'first_party'; dir?: 'ltr' | 'rtl' }[] = [
  { value: 'original', label: 'Original', kind: 'first_party' },
  ...FIRST_PARTY_PORTAL_LANGUAGE_OPTIONS.map((option) => ({
    value: option.value,
    label: option.nativeLabel && option.nativeLabel !== option.label
      ? `${option.label} - ${option.nativeLabel}`
      : option.label,
    kind: 'first_party' as const,
    dir: option.dir,
  })),
]

/**
 * Languages with no first-party translation, served only via the legacy
 * Google "Website Translator" widget (external script + cookie switch —
 * slower and less reliable than the first-party packs above, but the only
 * option for these 9 until someone writes first-party packs for them).
 */
export const GOOGLE_TRANSLATE_FALLBACK_OPTIONS: { value: string; label: string; kind: 'external' }[] = [
  { value: 'nl', label: 'Dutch' },
  { value: 'sv', label: 'Swedish' },
  { value: 'pl', label: 'Polish' },
  { value: 'cs', label: 'Czech' },
  { value: 'ro', label: 'Romanian' },
  { value: 'uk', label: 'Ukrainian' },
  { value: 'el', label: 'Greek' },
  { value: 'bn', label: 'Bengali' },
  { value: 'ta', label: 'Tamil' },
].map((option) => ({ ...option, kind: 'external' as const }))

/** Every language the "translate this page" picker can offer, first-party then external. */
export const ALL_PUBLIC_TRANSLATE_OPTIONS = [
  ...FIRST_PARTY_TRANSLATE_LANG_OPTIONS,
  ...GOOGLE_TRANSLATE_FALLBACK_OPTIONS,
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
