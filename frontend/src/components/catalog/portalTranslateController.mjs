export const PORTAL_TRANSLATE_WIDGET_HOST_ID = 'business-os-portal-translate-widget-host'
export const PORTAL_TRANSLATE_STORAGE_KEY = 'business-os:portal-translate-target'
export const PORTAL_TRANSLATE_RELOAD_KEY = 'business-os:portal-translate-last-reload'

function normalizeLanguage(value, fallback = 'en') {
  return String(value || fallback).trim().toLowerCase() || fallback
}

export function normalizeTranslateTarget(value, sourceLang = 'en') {
  const from = normalizeLanguage(sourceLang)
  const target = normalizeLanguage(value, 'original')
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
  const target = normalizeLanguage(parts[1], '')
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
  const domains = ['', host, host && host.includes('.') ? `.${host}` : ''].filter(Boolean)
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
  const from = normalizeLanguage(sourceLang)
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
      const stored = normalizeTranslateTarget(window.localStorage?.getItem(PORTAL_TRANSLATE_STORAGE_KEY), from)
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
