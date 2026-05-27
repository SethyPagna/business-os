export type FirstPartyPortalLanguageOption = {
  value: string
  label: string
  nativeLabel: string
  dir: 'ltr' | 'rtl'
  type: 'primary' | 'expanded'
}

export const FIRST_PARTY_PORTAL_LANGUAGE_OPTIONS: FirstPartyPortalLanguageOption[]
export function normalizeFirstPartyPortalLanguage(value: unknown): string
export function isFirstPartyPortalLanguage(value: unknown): boolean
export function getPortalLanguageText(language: unknown, key: unknown): string
