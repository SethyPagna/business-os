// Google Translate for the four storefront languages that are not hand-written
// (zh-CN, zh-TW, fr, es). Restored from 1e674ad80~1 and cut down.
//
// Rules this module keeps:
// - It is loaded with a dynamic import() from PublicCatalogPage only, and only after a
//   visitor picks one of the four (or opens the page with that choice stored). Google's
//   script is never fetched for Khmer or English visitors.
// - It never runs on an admin hostname: applyPortalGoogleTranslate answers false there.
// - The source language is English: the storefront's own copy is English underneath.
import { isAdminHostname } from '../../app/pathRouting.ts'

export const PORTAL_TRANSLATE_SOURCE_LANGUAGE = 'en'
export const PORTAL_TRANSLATE_TARGETS = ['zh-CN', 'zh-TW', 'fr', 'es'] as const
export type PortalTranslateTarget = (typeof PORTAL_TRANSLATE_TARGETS)[number]

export const PORTAL_TRANSLATE_WIDGET_HOST_ID = 'business-os-portal-translate-widget-host'
export const PORTAL_TRANSLATE_SCRIPT_ID = 'business-os-portal-translate-script'
export const PORTAL_TRANSLATE_CALLBACK = 'businessOsPortalTranslateInit'
export const PORTAL_TRANSLATE_TIMEOUT_MS = 10000

type TranslateElementConstructor = {
  new (options: unknown, elementId: string): unknown
  InlineLayout?: { SIMPLE?: unknown }
}

type TranslateWindow = Window & {
  businessOsPortalTranslateInit?: () => void
  google?: { translate?: { TranslateElement?: TranslateElementConstructor } }
}

const GOOGLE_TRANSLATE_PRECONNECTS = [
  'https://translate.google.com',
  'https://translate.googleapis.com',
  'https://www.gstatic.com',
]
const GOOGLE_TRANSLATE_DNS_PREFETCHES = ['https://translate-pa.googleapis.com']

export function isPortalTranslateTarget(value: unknown): value is PortalTranslateTarget {
  return (PORTAL_TRANSLATE_TARGETS as readonly string[]).includes(String(value))
}

/** False on an admin hostname (the staff app) and outside a browser. */
export function canRunPortalTranslate(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  return !isAdminHostname()
}

export function hasPortalTranslatedMarker(): boolean {
  if (typeof document === 'undefined') return false
  const markerText = `${document.documentElement?.className || ''} ${document.body?.className || ''}`
  return /\btranslated-(ltr|rtl)\b/i.test(markerText)
}

/** Clears googtrans on the host, every parent domain and the current path, whatever wrote it. */
export function clearGoogleTranslateCookies(): void {
  if (typeof document === 'undefined') return
  const host = typeof window !== 'undefined' ? String(window.location?.hostname || '') : ''
  const pathName = typeof window !== 'undefined' ? String(window.location?.pathname || '/') : '/'
  const paths = Array.from(new Set(['/', pathName || '/']))
  const parentDomains = host.includes('.')
    ? host.split('.').slice(1, -1).map((_, index) => `.${host.split('.').slice(index + 1).join('.')}`)
    : []
  const domains = Array.from(new Set(['', host, host && host.includes('.') ? `.${host}` : '', ...parentDomains].filter(Boolean)))
  const targets = paths.flatMap((pathValue) => [
    `path=${pathValue}; SameSite=Lax`,
    ...domains.map((domain) => `domain=${domain}; path=${pathValue}; SameSite=Lax`),
  ])
  targets.forEach((suffix) => {
    document.cookie = `googtrans=; ${suffix}; expires=Thu, 01 Jan 1970 00:00:00 GMT`
  })
}

// Host-only, deliberately: a domain-wide write would broadcast the visitor's choice to the
// staff app on a sibling hostname and make the cookie policy's "for this site" false.
export function writeGoogleTranslateCookie(target: PortalTranslateTarget): void {
  if (typeof document === 'undefined') return
  document.cookie = `googtrans=/${PORTAL_TRANSLATE_SOURCE_LANGUAGE}/${target}; path=/; SameSite=Lax`
}

function ensureLinkHint(rel: 'preconnect' | 'dns-prefetch', href: string): void {
  if (document.querySelector?.(`link[rel="${rel}"][href="${href}"]`)) return
  const link = document.createElement('link')
  link.rel = rel
  link.href = href
  if (rel === 'preconnect') link.crossOrigin = 'anonymous'
  document.head?.appendChild(link)
}

function ensureWidgetHost(): HTMLElement {
  const existing = document.getElementById(PORTAL_TRANSLATE_WIDGET_HOST_ID)
  if (existing) return existing
  const host = document.createElement('div')
  host.id = PORTAL_TRANSLATE_WIDGET_HOST_ID
  host.className = 'notranslate'
  host.setAttribute('translate', 'no')
  Object.assign(host.style, {
    position: 'fixed',
    left: '12px',
    bottom: '12px',
    width: '180px',
    height: '44px',
    overflow: 'hidden',
    opacity: '0.01',
    pointerEvents: 'none',
    zIndex: '-1',
  })
  document.body.appendChild(host)
  return host
}

function ensureScript(onError: () => void): void {
  if (document.getElementById(PORTAL_TRANSLATE_SCRIPT_ID)) return
  GOOGLE_TRANSLATE_PRECONNECTS.forEach((href) => ensureLinkHint('preconnect', href))
  GOOGLE_TRANSLATE_DNS_PREFETCHES.forEach((href) => ensureLinkHint('dns-prefetch', href))
  const script = document.createElement('script')
  script.id = PORTAL_TRANSLATE_SCRIPT_ID
  script.src = `https://translate.google.com/translate_a/element.js?cb=${encodeURIComponent(PORTAL_TRANSLATE_CALLBACK)}`
  script.async = true
  script.onerror = onError
  document.body.appendChild(script)
}

function findCombo(): HTMLSelectElement | null {
  return document.querySelector('.goog-te-combo') as HTMLSelectElement | null
}

function setCombo(select: HTMLSelectElement, value: string): void {
  select.value = value
  select.dispatchEvent(new Event('input', { bubbles: true }))
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

// The widget builds its language list once; a later call reuses the same combo.
function whenWidgetReady(): Promise<HTMLSelectElement | null> {
  return new Promise((resolve) => {
    const existing = findCombo()
    if (existing) {
      resolve(existing)
      return
    }
    const win = window as TranslateWindow
    let settled = false
    const finish = (combo: HTMLSelectElement | null) => {
      if (settled) return
      settled = true
      resolve(combo)
    }
    const init = () => {
      const TranslateElement = win.google?.translate?.TranslateElement
      if (!TranslateElement) {
        finish(null)
        return
      }
      const host = ensureWidgetHost()
      try {
        host.innerHTML = ''
        new TranslateElement(
          {
            pageLanguage: PORTAL_TRANSLATE_SOURCE_LANGUAGE,
            includedLanguages: PORTAL_TRANSLATE_TARGETS.join(','),
            autoDisplay: false,
            layout: TranslateElement.InlineLayout?.SIMPLE,
          },
          host.id,
        )
      } catch {
        finish(null)
        return
      }
      let checks = 0
      const poll = () => {
        if (settled) return
        const combo = findCombo()
        if (combo) {
          finish(combo)
          return
        }
        checks += 1
        if (checks >= 80) finish(null)
        else window.setTimeout(poll, 120)
      }
      poll()
    }
    // One limit over the whole wait: a script that loads but never calls back must not leave the page waiting for ever.
    const timer = window.setTimeout(() => finish(null), PORTAL_TRANSLATE_TIMEOUT_MS)
    const stop = () => window.clearTimeout?.(timer)
    win.businessOsPortalTranslateInit = init
    if (win.google?.translate?.TranslateElement) init()
    else ensureScript(() => { stop(); finish(null) })
  })
}

/** Takes away what a failed attempt left behind (cookie, script, widget host) without reloading: nothing was rewritten. */
export function abandonPortalGoogleTranslate(): void {
  if (typeof document === 'undefined') return
  clearGoogleTranslateCookies()
  document.getElementById(PORTAL_TRANSLATE_SCRIPT_ID)?.remove?.()
  document.getElementById(PORTAL_TRANSLATE_WIDGET_HOST_ID)?.remove?.()
}

export type PortalTranslateFallback = {
  /** The language the visitor had before the pick: the menu goes back to it. */
  previous: 'en' | 'km'
  restoreChoice: (previous: 'en' | 'km') => void
  showNotice: (previous: 'en' | 'km') => void
  /** False once the page has moved on to a newer pick: a late failure of the old attempt must not touch the page or reload it. */
  isCurrent?: () => boolean
}

/**
 * Translate, and when Google does not do it (script blocked or failed, or no answer within the limit) put the visitor back where they
 * were: googtrans cleared, the menu on the previous language, and one notice. It never retries and never reloads.
 */
export async function applyPortalGoogleTranslateOrFallBack(target: unknown, fallback: PortalTranslateFallback): Promise<boolean> {
  let applied = false
  try {
    applied = await applyPortalGoogleTranslate(target)
  } catch {
    applied = false
  }
  if (!applied) {
    if (fallback.isCurrent && !fallback.isCurrent()) return false
    fallback.restoreChoice(fallback.previous)
    // Google can start translating from the cookie on its own just before the wait ends. A page it has already begun to rewrite cannot be
    // put back in place, so it is loaded again clean: the stored choice is Khmer or English by now, so this happens once.
    if (findCombo() || hasPortalTranslatedMarker()) {
      removePortalGoogleTranslate()
      return false
    }
    abandonPortalGoogleTranslate()
    fallback.showNotice(fallback.previous)
  }
  return applied
}

/** Translate the page from English into `target`. Resolves false when refused or when Google never answered. */
export async function applyPortalGoogleTranslate(target: unknown): Promise<boolean> {
  if (!canRunPortalTranslate() || !isPortalTranslateTarget(target)) return false
  writeGoogleTranslateCookie(target)
  ensureWidgetHost()
  const combo = await whenWidgetReady()
  if (!combo) return false
  setCombo(combo, target)
  return true
}

/**
 * Take the translation off: clear googtrans everywhere and, when Google already rewrote this
 * page, reload so the hand-written text comes back (React cannot patch text nodes Google moved).
 * A pure clean-up: it never loads anything, so it is safe on any hostname.
 */
export function removePortalGoogleTranslate(): 'clean' | 'reloading' {
  if (typeof document === 'undefined') return 'clean'
  clearGoogleTranslateCookies()
  const rewritten = Boolean(document.getElementById(PORTAL_TRANSLATE_SCRIPT_ID) || findCombo() || hasPortalTranslatedMarker())
  if (!rewritten) return 'clean'
  window.location.reload()
  return 'reloading'
}
