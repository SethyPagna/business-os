export const PORTAL_TRANSLATE_WIDGET_HOST_ID = 'business-os-portal-translate-widget-host'
export const PORTAL_TRANSLATE_STORAGE_KEY = 'business-os:portal-translate-target'
export const PORTAL_TRANSLATE_RELOAD_KEY = 'business-os:portal-translate-last-reload'
export const PORTAL_TRANSLATE_SCRIPT_ID = 'business-os-portal-translate-script'

declare global {
  interface Window {
    businessOsPortalTranslateInit?: () => void
    google?: {
      translate?: {
        TranslateElement?: {
          (options: unknown, elementId: string): unknown
          InlineLayout?: { SIMPLE?: unknown }
        }
      }
    }
  }
}

type PortalExternalTranslateWidgetOptions = {
  sourceLanguage: unknown
  includedLanguages: unknown[]
  callbackName?: string
  onPending?: () => void
  onReady?: () => void
  onFailure?: () => void
}

const GOOGLE_TRANSLATE_PRECONNECTS = [
  'https://translate.google.com',
  'https://translate.googleapis.com',
  'https://www.gstatic.com',
]

const GOOGLE_TRANSLATE_DNS_PREFETCHES = [
  'https://translate-pa.googleapis.com',
]

function normalizeLanguage(value: unknown, fallback = 'en'): string {
  return String(value || fallback).trim().toLowerCase() || fallback
}

export function canonicalTranslateLanguage(value: unknown, fallback = 'en'): string {
  const raw = String(value || fallback).trim()
  if (!raw) return fallback
  const lower = raw.toLowerCase()
  if (lower === 'zh-cn') return 'zh-CN'
  if (lower === 'zh-tw') return 'zh-TW'
  return lower
}

export function normalizeTranslateTarget(value: unknown, sourceLang = 'en'): string {
  const from = normalizeLanguage(sourceLang)
  const target = canonicalTranslateLanguage(value, 'original')
  return !target || target === from ? 'original' : target
}

export function getPortalTranslateCookieTarget(sourceLang: unknown): string {
  if (typeof document === 'undefined') return ''
  const from = normalizeLanguage(sourceLang)
  const cookie = document.cookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('googtrans='))
  if (!cookie) return ''
  const cookieValue = decodeURIComponent(cookie.slice('googtrans='.length))
  const parts = cookieValue.split('/').filter(Boolean)
  const target = canonicalTranslateLanguage(parts[1], '')
  return target && target !== from ? target : ''
}

export function hasPortalTranslatedMarker(): boolean {
  if (typeof document === 'undefined') return false
  const markerText = `${document.documentElement?.className || ''} ${document.body?.className || ''}`
  return /\btranslated-(ltr|rtl)\b/i.test(markerText)
}

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

export function writePortalTranslateTarget(sourceLang: unknown, targetLang: unknown): string {
  if (typeof document === 'undefined') return 'original'
  const from = canonicalTranslateLanguage(sourceLang)
  const target = normalizeTranslateTarget(targetLang, from)
  const cookieValue = target === 'original' ? '' : `/${from}/${target}`
  if (!cookieValue) clearGoogleTranslateCookies()
  else {
    const host = typeof window !== 'undefined' ? String(window.location?.hostname || '') : ''
    const suffixes = [
      'path=/; SameSite=Lax',
      host && host.includes('.') ? `domain=.${host}; path=/; SameSite=Lax` : '',
    ].filter(Boolean)
    suffixes.forEach((suffix) => {
      document.cookie = `googtrans=${cookieValue}; ${suffix}`
    })
  }
  try {
    window.localStorage?.setItem(PORTAL_TRANSLATE_STORAGE_KEY, target)
  } catch (_) {}
  return target
}

export function storePortalTranslatePreference(targetLang: unknown): string {
  const rawTarget = canonicalTranslateLanguage(targetLang, 'original')
  const target = ['original', 'en', 'km'].includes(rawTarget)
    ? rawTarget
    : normalizeTranslateTarget(rawTarget, 'en')
  if (typeof window !== 'undefined') {
    try {
      window.localStorage?.setItem(PORTAL_TRANSLATE_STORAGE_KEY, target)
    } catch (_) {}
  }
  return target
}

function ensureLinkHint(rel: 'preconnect' | 'dns-prefetch', href: string): void {
  if (typeof document === 'undefined') return
  const selector = `link[rel="${rel}"][href="${href}"]`
  if (document.querySelector?.(selector)) return
  const link = document.createElement('link')
  link.rel = rel
  link.href = href
  if (rel === 'preconnect') link.crossOrigin = 'anonymous'
  document.head?.appendChild(link)
}

export function warmPortalTranslateNetwork(): void {
  GOOGLE_TRANSLATE_PRECONNECTS.forEach((href) => ensureLinkHint('preconnect', href))
  GOOGLE_TRANSLATE_DNS_PREFETCHES.forEach((href) => ensureLinkHint('dns-prefetch', href))
}

export function ensurePortalTranslateScript(callbackName: string, onError?: OnErrorEventHandler): HTMLScriptElement | Element | null {
  if (typeof document === 'undefined') return null
  warmPortalTranslateNetwork()
  const scriptSrc = `https://translate.google.com/translate_a/element.js?cb=${encodeURIComponent(callbackName)}`
  const existingScript = document.getElementById?.(PORTAL_TRANSLATE_SCRIPT_ID)
    || document.querySelector?.('script[data-business-os-translate="true"]')
  if (existingScript) {
    if (existingScript.getAttribute?.('src') !== scriptSrc) existingScript.setAttribute('src', scriptSrc)
    return existingScript
  }
  const script = document.createElement('script')
  script.id = PORTAL_TRANSLATE_SCRIPT_ID
  script.src = scriptSrc
  script.async = true
  script.defer = true
  script.dataset.businessOsTranslate = 'true'
  if (typeof onError === 'function') script.onerror = onError
  document.body.appendChild(script)
  return script
}

export function ensurePortalTranslateWidgetHost(): HTMLDivElement | Element | null {
  if (typeof document === 'undefined') return null
  const existingHosts = Array.from(document.querySelectorAll(`#${PORTAL_TRANSLATE_WIDGET_HOST_ID}`))
  const host = existingHosts[0] || document.createElement('div')
  existingHosts.slice(1).forEach((node) => node.remove())
  if (!host.id) host.id = PORTAL_TRANSLATE_WIDGET_HOST_ID
  host.className = 'notranslate'
  host.setAttribute('translate', 'no')
  Object.assign((host as HTMLElement).style, {
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
  if (!host.parentNode) document.body.appendChild(host)
  return host
}

export function removePortalTranslateWidgetHost(): void {
  if (typeof document === 'undefined') return
  Array.from(document.querySelectorAll(`#${PORTAL_TRANSLATE_WIDGET_HOST_ID}`)).forEach((node) => node.remove())
}

export function setupPortalExternalTranslateWidget({
  sourceLanguage,
  includedLanguages,
  callbackName = 'businessOsPortalTranslateInit',
  onPending,
  onReady,
  onFailure,
}: PortalExternalTranslateWidgetOptions): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    onFailure?.()
    return () => {}
  }

  let cancelled = false
  let container: Element | HTMLDivElement | null = ensurePortalTranslateWidgetHost()
  const languageList = (Array.isArray(includedLanguages) ? includedLanguages : [])
    .map((value) => canonicalTranslateLanguage(value, ''))
    .filter((value) => value && value !== 'original')
    .join(',')

  const initWidget = () => {
    if (cancelled || !window.google?.translate?.TranslateElement) return
    try {
      onPending?.()
      const widgetContainer = container
      if (!widgetContainer) return
      widgetContainer.innerHTML = ''
      window.google.translate.TranslateElement(
        {
          pageLanguage: canonicalTranslateLanguage(sourceLanguage, 'en') === 'km' ? 'km' : 'en',
          includedLanguages: languageList,
          autoDisplay: false,
          layout: window.google.translate.TranslateElement.InlineLayout?.SIMPLE,
        },
        widgetContainer.id,
      )
      let widgetChecks = 0
      const waitForWidget = () => {
        if (cancelled) return
        const combo = widgetContainer.querySelector('.goog-te-combo')
        if (combo) {
          onReady?.()
          return
        }
        widgetChecks += 1
        if (widgetChecks >= 80) {
          onFailure?.()
          return
        }
        window.setTimeout(waitForWidget, 120)
      }
      waitForWidget()
    } catch (_) {
      onFailure?.()
    }
  }

  window.businessOsPortalTranslateInit = initWidget

  if (window.google?.translate?.TranslateElement) {
    initWidget()
  } else if (container) {
    ensurePortalTranslateScript(callbackName, () => {
      if (!cancelled) onFailure?.()
    })
  } else {
    onFailure?.()
  }

  return () => {
    cancelled = true
    container = null
  }
}

export function applyGoogleTranslateSelection(sourceLang: unknown, targetLang: unknown): boolean {
  if (typeof document === 'undefined') return false
  const target = writePortalTranslateTarget(sourceLang, targetLang)
  const selects = Array.from(document.querySelectorAll('.goog-te-combo')) as HTMLSelectElement[]
  if (!selects.length) return false
  const nextValue = target === 'original' ? '' : target
  selects.forEach((select) => {
    select.value = nextValue
    const EventCtor = (typeof window !== 'undefined' && window.Event) ? window.Event : Event
    select.dispatchEvent(new EventCtor('input', { bubbles: true }))
    select.dispatchEvent(new EventCtor('change', { bubbles: true }))
  })
  return true
}

export function isPortalTranslateApplied(sourceLang: unknown, targetLang: unknown): boolean {
  const from = normalizeLanguage(sourceLang)
  const target = normalizeTranslateTarget(targetLang, from)
  if (target === 'original') {
    return !getPortalTranslateCookieTarget(from) && !hasPortalTranslatedMarker()
  }
  return getPortalTranslateCookieTarget(from) === target && hasPortalTranslatedMarker()
}

export function readStoredTranslateTarget(sourceLang: unknown): string {
  const from = normalizeLanguage(sourceLang)
  if (typeof document !== 'undefined') {
    const cookieTarget = getPortalTranslateCookieTarget(from)
    if (cookieTarget) return cookieTarget
  }
  if (typeof window !== 'undefined') {
    try {
      const rawStored = canonicalTranslateLanguage(window.localStorage?.getItem(PORTAL_TRANSLATE_STORAGE_KEY), 'original')
      if (['original', 'en', 'km'].includes(rawStored)) return rawStored
      const stored = normalizeTranslateTarget(rawStored, from)
      if (stored) return stored
    } catch (_) {}
  }
  return 'original'
}

export function requestPortalTranslateReload(reason = 'translate-change', minIntervalMs = 5000): boolean {
  if (typeof window === 'undefined') return false
  const now = Date.now()
  const markerKey = `${PORTAL_TRANSLATE_RELOAD_KEY}:${reason}`
  const lastReload = Number(window.sessionStorage?.getItem(markerKey) || 0)
  if (now - lastReload <= minIntervalMs) return false
  window.sessionStorage?.setItem(markerKey, String(now))
  window.location.reload()
  return true
}
