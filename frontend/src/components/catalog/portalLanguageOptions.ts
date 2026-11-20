// The storefront's own copy exists in two languages, written by hand: Khmer and English.
export type PortalLanguage = 'km' | 'en'

// What the visitor picks in the menu. The four that are not hand-written are produced by
// Google Translate in the visitor's browser (the translate controller); the storefront's
// own copy is English underneath them.
export type PortalGoogleLanguage = 'zh-CN' | 'zh-TW' | 'fr' | 'es'
export type PortalLanguageChoice = PortalLanguage | PortalGoogleLanguage

export type PortalLanguageOption = { value: PortalLanguageChoice; label: string; google?: true }

// Owner, 20 Nov 2026: Khmer and English hand-written, the rest by Google Translate. Each label is in its own script.
export const PUBLIC_STOREFRONT_LANGUAGE_OPTIONS: readonly PortalLanguageOption[] = [
  { value: 'km', label: 'ភាសាខ្មែរ' },
  { value: 'en', label: 'English' },
  { value: 'zh-CN', label: '简体中文', google: true },
  { value: 'zh-TW', label: '繁體中文', google: true },
  { value: 'fr', label: 'Français', google: true },
  { value: 'es', label: 'Español', google: true },
]

// The Website Editor preview never translates: it offers only the hand-written two.
export const PORTAL_COPY_LANGUAGE_OPTIONS: readonly PortalLanguageOption[] = PUBLIC_STOREFRONT_LANGUAGE_OPTIONS.filter((option) => !option.google)

// Owner, 25 Sep 2026: "Default language of the public site = Khmer".
export const PUBLIC_STOREFRONT_DEFAULT_LANGUAGE: PortalLanguage = 'km'

// Keeps the key visitors' earlier choices were saved under.
export const PORTAL_LANGUAGE_STORAGE_KEY = 'business-os:portal-translate-target'

function matchOption(value: unknown, options: readonly PortalLanguageOption[]): PortalLanguageChoice | '' {
  const key = String(value ?? '').trim().toLowerCase()
  return options.find((option) => option.value.toLowerCase() === key)?.value ?? ''
}

/** A hand-written language ('km' or 'en') or ''. The Worker and the editor only ever see these two. */
export function normalizePortalLanguage(value: unknown): PortalLanguage | '' {
  return matchOption(value, PORTAL_COPY_LANGUAGE_OPTIONS) as PortalLanguage | ''
}

/** Any of the six menu values, or ''. */
export function normalizePortalChoice(value: unknown): PortalLanguageChoice | '' {
  return matchOption(value, PUBLIC_STOREFRONT_LANGUAGE_OPTIONS)
}

export function isGoogleLanguageChoice(value: unknown): value is PortalGoogleLanguage {
  const choice = normalizePortalChoice(value)
  return Boolean(choice && choice !== 'km' && choice !== 'en')
}

/** The language the storefront's own copy is shown in: a Google language sits on top of English. */
export function portalCopyLanguage(choice: unknown): PortalLanguage {
  const normalized = normalizePortalChoice(choice)
  if (normalized === 'km') return 'km'
  return normalized ? 'en' : PUBLIC_STOREFRONT_DEFAULT_LANGUAGE
}

function readStoredValue(): string {
  if (typeof window === 'undefined') return ''
  try {
    return String(window.localStorage?.getItem(PORTAL_LANGUAGE_STORAGE_KEY) ?? '')
  } catch {
    return ''
  }
}

export function readStoredPortalChoice(): PortalLanguageChoice | '' {
  return normalizePortalChoice(readStoredValue())
}

/** The stored choice reduced to a hand-written language (a Google choice reads as English), or ''. */
export function readStoredPortalLanguage(): PortalLanguage | '' {
  const choice = readStoredPortalChoice()
  return choice ? portalCopyLanguage(choice) : ''
}

export function readPublicStorefrontChoice(): PortalLanguageChoice {
  return readStoredPortalChoice() || PUBLIC_STOREFRONT_DEFAULT_LANGUAGE
}

export function readPublicStorefrontLanguage(): PortalLanguage {
  return portalCopyLanguage(readPublicStorefrontChoice())
}

export function storePortalLanguage(language: PortalLanguageChoice): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage?.setItem(PORTAL_LANGUAGE_STORAGE_KEY, language)
  } catch {}
}
