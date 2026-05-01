export const PORTAL_TRANSLATE_WIDGET_HOST_ID = 'business-os-portal-translate-widget-host'
export const PORTAL_TRANSLATE_STORAGE_KEY = 'business-os:portal-translate-target'
export const PORTAL_TRANSLATE_RELOAD_KEY = 'business-os:portal-translate-last-reload'
export const PORTAL_TRANSLATE_SCRIPT_ID = 'business-os-portal-translate-script'

const GOOGLE_TRANSLATE_PRECONNECTS = [
  'https://translate.google.com',
  'https://translate.googleapis.com',
  'https://www.gstatic.com',
]

const GOOGLE_TRANSLATE_DNS_PREFETCHES = [
  'https://translate-pa.googleapis.com',
]

function normalizeLanguage(value, fallback = 'en') {
  return String(value || fallback).trim().toLowerCase() || fallback
}

export function canonicalTranslateLanguage(value, fallback = 'en') {
  const raw = String(value || fallback).trim()
  if (!raw) return fallback
  const lower = raw.toLowerCase()
  if (lower === 'zh-cn') return 'zh-CN'
  if (lower === 'zh-tw') return 'zh-TW'
  return lower
}

export function normalizeTranslateTarget(value, sourceLang = 'en') {
  const from = normalizeLanguage(sourceLang)
  const target = canonicalTranslateLanguage(value, 'original')
  return !target || target === from ? 'original' : target
}

export function getPortalTranslateCookieTarget(sourceLang) {
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

export function hasPortalTranslatedMarker() {
  if (typeof document === 'undefined') return false
  const markerText = `${document.documentElement?.className || ''} ${document.body?.className || ''}`
  return /\btranslated-(ltr|rtl)\b/i.test(markerText)
}

export function clearGoogleTranslateCookies() {
  if (typeof document === 'undefined') return
  const host = typeof window !== 'undefined' ? String(window.location?.hostname || '') : ''
  const pathName = typeof window !== 'undefined' ? String(window.location?.pathname || '/') : '/'
  const paths = Array.from(new Set(['/', pathName || '/']))
  const parentDomains = host.includes('.')
    ? host.split('.').slice(1, -1).map((_, index, parts) => `.${host.split('.').slice(index + 1).join('.')}`)
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

export function writePortalTranslateTarget(sourceLang, targetLang) {
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

export function storePortalTranslatePreference(targetLang) {
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

function ensureLinkHint(rel, href) {
  if (typeof document === 'undefined') return
  const selector = `link[rel="${rel}"][href="${href}"]`
  if (document.querySelector?.(selector)) return
  const link = document.createElement('link')
  link.rel = rel
  link.href = href
  if (rel === 'preconnect') link.crossOrigin = 'anonymous'
  document.head?.appendChild(link)
}

export function warmPortalTranslateNetwork() {
  GOOGLE_TRANSLATE_PRECONNECTS.forEach((href) => ensureLinkHint('preconnect', href))
  GOOGLE_TRANSLATE_DNS_PREFETCHES.forEach((href) => ensureLinkHint('dns-prefetch', href))
}

export function ensurePortalTranslateScript(callbackName, onError) {
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

export function ensurePortalTranslateWidgetHost() {
  if (typeof document === 'undefined') return null
  const existingHosts = Array.from(document.querySelectorAll(`#${PORTAL_TRANSLATE_WIDGET_HOST_ID}`))
  const host = existingHosts[0] || document.createElement('div')
  existingHosts.slice(1).forEach((node) => node.remove())
  if (!host.id) host.id = PORTAL_TRANSLATE_WIDGET_HOST_ID
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
  if (!host.parentNode) document.body.appendChild(host)
  return host
}

export function removePortalTranslateWidgetHost() {
  if (typeof document === 'undefined') return
  Array.from(document.querySelectorAll(`#${PORTAL_TRANSLATE_WIDGET_HOST_ID}`)).forEach((node) => node.remove())
}

export function applyGoogleTranslateSelection(sourceLang, targetLang) {
  if (typeof document === 'undefined') return false
  const target = writePortalTranslateTarget(sourceLang, targetLang)
  const selects = Array.from(document.querySelectorAll('.goog-te-combo'))
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

export function isPortalTranslateApplied(sourceLang, targetLang) {
  const from = normalizeLanguage(sourceLang)
  const target = normalizeTranslateTarget(targetLang, from)
  if (target === 'original') {
    return !getPortalTranslateCookieTarget(from) && !hasPortalTranslatedMarker()
  }
  return getPortalTranslateCookieTarget(from) === target && hasPortalTranslatedMarker()
}

export function readStoredTranslateTarget(sourceLang) {
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

export function requestPortalTranslateReload(reason = 'translate-change', minIntervalMs = 5000) {
  if (typeof window === 'undefined') return false
  const now = Date.now()
  const markerKey = `${PORTAL_TRANSLATE_RELOAD_KEY}:${reason}`
  const lastReload = Number(window.sessionStorage?.getItem(markerKey) || 0)
  if (now - lastReload <= minIntervalMs) return false
  window.sessionStorage?.setItem(markerKey, String(now))
  window.location.reload()
  return true
}
