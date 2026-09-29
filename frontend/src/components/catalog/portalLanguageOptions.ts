import { canonicalTranslateLanguage } from './portalTranslateController.ts'

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

/**
 * The live storefront's own language model (owner, 2026-09-25): "Default
 * language of the public site = Khmer. For other languages, full manual
 * translation of everything is unrealistic; use Google Translate."
 *
 * Only Khmer and English are rendered by the storefront itself, because only
 * those two have every string on the page written by hand -- chrome AND the
 * merchant-facing defaults. The 17 other hand-written packs above cover the
 * page chrome only, so choosing one of them used to leave the About story,
 * FAQ answers and every product description in the source language. On the
 * storefront they now go through Google Translate with the rest of the
 * machine-translated list, which translates the whole page. (The admin
 * editor preview in CatalogPage.tsx still offers the chrome-only packs; it
 * keeps ALL_PUBLIC_TRANSLATE_OPTIONS above.)
 */
export const PUBLIC_STOREFRONT_DEFAULT_LANGUAGE = 'km'
const PUBLIC_STOREFRONT_BUILT_IN_LANGUAGES = ['km', 'en']

/** True for the languages the storefront renders itself (Khmer, English). */
export function isPublicStorefrontBuiltInLanguage(value: unknown): boolean {
  return PUBLIC_STOREFRONT_BUILT_IN_LANGUAGES.includes(normalizeFirstPartyPortalLanguage(value))
}

/** The storefront's language picker: Khmer, English, then Google Translate. */
export const PUBLIC_STOREFRONT_TRANSLATE_OPTIONS: { value: string; label: string; kind: 'first_party' | 'external'; dir?: 'ltr' | 'rtl' }[] = [
  ...PUBLIC_STOREFRONT_BUILT_IN_LANGUAGES.map((value) => {
    const option = FIRST_PARTY_TRANSLATE_LANG_OPTIONS.find((candidate) => candidate.value === value)
    return { value, label: option?.label || value, kind: 'first_party' as const, dir: option?.dir }
  }),
  ...FIRST_PARTY_TRANSLATE_LANG_OPTIONS
    .filter((option) => option.value !== 'original' && !PUBLIC_STOREFRONT_BUILT_IN_LANGUAGES.includes(option.value))
    .map((option) => ({ ...option, kind: 'external' as const })),
  ...GOOGLE_TRANSLATE_FALLBACK_OPTIONS,
]

export type PublicStorefrontLanguageRoute = {
  /** The hand-written pack the storefront's own text renders in. */
  pageLanguage: string
  /** The Google Translate target, or null when the page is already in the chosen language. */
  googleTarget: string | null
}

/**
 * Routes one picker choice. Khmer and English render directly. Anything
 * else renders the page in the merchant's source language (the one Google is
 * told the page is written in, see setupPortalExternalTranslateWidget) and
 * hands it to Google Translate -- so Google never receives a page whose
 * chrome is already in some third language it was not told about.
 */
export function resolvePublicStorefrontLanguage(choice: unknown, sourceLanguage: unknown): PublicStorefrontLanguageRoute {
  const source = isPublicStorefrontBuiltInLanguage(sourceLanguage) ? normalizeFirstPartyPortalLanguage(sourceLanguage) : 'en'
  const raw = String(choice || '').trim()
  if (!raw || raw.toLowerCase() === 'original') return { pageLanguage: source, googleTarget: null }
  if (isPublicStorefrontBuiltInLanguage(raw)) return { pageLanguage: normalizeFirstPartyPortalLanguage(raw), googleTarget: null }
  const target = canonicalTranslateLanguage(raw, '')
  return { pageLanguage: source, googleTarget: target && target !== source ? target : null }
}
