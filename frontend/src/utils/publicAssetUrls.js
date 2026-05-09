import { STORAGE_KEYS } from '../constants.js'

function trimBaseUrl(value) {
  return String(value || '').trim().replace(/\/$/, '')
}

function normalizeUploadPath(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (raw.startsWith('/uploads/')) return raw
  if (raw.startsWith('uploads/')) return `/${raw}`
  return raw
}

function isLocalLikeHostname(hostname = '') {
  return /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0)$/i.test(String(hostname || '').trim())
}

function getSafeCurrentOrigin() {
  if (typeof window === 'undefined') return ''
  try {
    const { origin, hostname, pathname } = window.location || {}
    if (!origin) return ''
    if (isLocalLikeHostname(hostname)) return trimBaseUrl(origin)
    if (String(pathname || '').startsWith('/public')) return trimBaseUrl(origin)
    if (!/^admin\./i.test(String(hostname || '').trim())) return trimBaseUrl(origin)
  } catch (_) {}
  return ''
}

export function getStoredPublicAssetBaseUrl() {
  if (typeof window === 'undefined') return ''
  try {
    const fromApi = trimBaseUrl(window.api?.getPublicAssetBaseUrl?.() || '')
    if (fromApi) return fromApi
  } catch (_) {}
  try {
    return trimBaseUrl(localStorage.getItem(STORAGE_KEYS.PUBLIC_ASSET_BASE_URL) || '')
  } catch (_) {
    return ''
  }
}

export function resolvePublicAssetUrl(value, options = {}) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (raw.startsWith('data:') || raw.startsWith('blob:') || /^https?:\/\//i.test(raw)) return raw
  const normalized = normalizeUploadPath(raw)
  if (!normalized.startsWith('/uploads/')) return normalized
  const configuredBase = trimBaseUrl(options.publicAssetBaseUrl || getStoredPublicAssetBaseUrl())
  const fallbackBase = trimBaseUrl(options.fallbackBaseUrl || getSafeCurrentOrigin())
  const base = configuredBase || fallbackBase
  return base ? `${base}${normalized}` : normalized
}
