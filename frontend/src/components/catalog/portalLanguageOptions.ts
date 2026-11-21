// Type only: the sign-in marker helpers live in portalSignedInMarker.ts so this module (language packs chunk) is not a runtime dependency of the account hook.
import type { PortalSignedInMarker } from './portalSignedInMarker.ts'

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

/**
 * Google's translate script runs with full access to the page, so it may run only when the shopper-session check got a real answer, nobody
 * is signed in, the Account sheet is closed and no sign-in marker is kept. Any other state is "blocked": the script is not loaded and, if
 * present, is removed. An unreadable marker blocks too: a browser that cannot keep it cannot be protected across tabs.
 */
export function portalTranslateAllowed(state: { sessionReady: boolean; signedIn: boolean; accountOpen: boolean; marker: PortalSignedInMarker }): boolean {
  return Boolean(state.sessionReady) && !state.signedIn && !state.accountOpen && state.marker === 'absent'
}

// Set the first time the page asks for the translate controller to APPLY Google's script, so a later block (sign-in, open sheet, marker) can also
// take off a script that arrived late, after a timeout fallback put the pick back to English. Visitors who never pick a Google language never
// set it, and so never download the controller chunk just to find out there is nothing to remove.
let googleAsked = false
export function markPortalGoogleAsked(): void { googleAsked = true }
export function portalGoogleWasAsked(): boolean { return googleAsked }

// Opening the Account sheet over a translated page reloads the page to take Google off; this one-shot flag brings the sheet back after it.
export const PORTAL_REOPEN_ACCOUNT_KEY = 'business-os:portal-reopen-account'

function sessionStore(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage ?? null : null
  } catch {
    return null
  }
}

export function markPortalReopenAccount(): void {
  try { sessionStore()?.setItem(PORTAL_REOPEN_ACCOUNT_KEY, '1') } catch {}
}

export function clearPortalReopenAccount(): void {
  try { sessionStore()?.removeItem(PORTAL_REOPEN_ACCOUNT_KEY) } catch {}
}

// One answer per document. React can run a state initializer again before the first commit (a first render it throws away), so a plain
// read-and-delete answered true to the render that was thrown away and false to the one that reached the screen: the sheet never came back.
const reopenAccountAnswers = new WeakMap<object, boolean>()

function thisDocument(): object | null {
  return typeof document !== 'undefined' && document ? document : null
}

/**
 * True on the page loaded right after markPortalReopenAccount. The flag is deleted at the first read, so no later reload reopens the sheet;
 * this page keeps the answer until settlePortalReopenAccount.
 */
export function consumePortalReopenAccount(): boolean {
  const page = thisDocument()
  const known = page ? reopenAccountAnswers.get(page) : undefined
  if (known !== undefined) return known
  let flagged = false
  try {
    const store = sessionStore()
    if (store) {
      flagged = store.getItem(PORTAL_REOPEN_ACCOUNT_KEY) === '1'
      store.removeItem(PORTAL_REOPEN_ACCOUNT_KEY)
    }
  } catch {
    flagged = false
  }
  if (page) reopenAccountAnswers.set(page, flagged)
  return flagged
}

/** Called once the page is on screen: a later mount on the same page starts with the sheet closed. */
export function settlePortalReopenAccount(): void {
  const page = thisDocument()
  if (page) reopenAccountAnswers.set(page, false)
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
