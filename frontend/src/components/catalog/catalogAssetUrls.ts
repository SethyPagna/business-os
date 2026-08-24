type CatalogAssetOptions = {
  publicAssetBaseUrl?: unknown
  fallbackBaseUrl?: unknown
  assetVersion?: unknown
}

const PUBLIC_ASSET_BASE_URL_STORAGE_KEY = 'businessos_public_asset_base_url'

function trimBaseUrl(value: unknown): string {
  return String(value || '').trim().replace(/\/$/, '')
}

function normalizeUploadPath(value: unknown): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (raw.startsWith('/uploads/')) return raw
  if (raw.startsWith('uploads/')) return `/${raw}`
  return raw
}

function isLocalLikeHostname(hostname = ''): boolean {
  return /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0)$/i.test(String(hostname || '').trim())
}

function getSafeCurrentOrigin(): string {
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

function getStoredCatalogAssetBaseUrl(): string {
  if (typeof window === 'undefined') return ''
  try {
    const api = (window as Window & { api?: { getPublicAssetBaseUrl?: () => unknown } }).api
    const fromApi = trimBaseUrl(api?.getPublicAssetBaseUrl?.() || '')
    if (fromApi) return fromApi
  } catch (_) {}
  try {
    return trimBaseUrl(localStorage.getItem(PUBLIC_ASSET_BASE_URL_STORAGE_KEY) || '')
  } catch (_) {
    return ''
  }
}

function appendAssetVersion(url: string, version: unknown = ''): string {
  const normalizedVersion = String(version || '').trim()
  if (!normalizedVersion || /^data:|^blob:/i.test(String(url || ''))) return url
  try {
    const parsed = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
    if (!parsed.pathname.startsWith('/uploads/')) return url
    if (!parsed.searchParams.get('v')) parsed.searchParams.set('v', normalizedVersion)
    if (/^https?:\/\//i.test(String(url || ''))) return parsed.toString()
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch (_) {
    const joiner = String(url || '').includes('?') ? '&' : '?'
    return `${url}${joiner}v=${encodeURIComponent(normalizedVersion)}`
  }
}

export function resolveCatalogAssetUrl(value: unknown, options: CatalogAssetOptions = {}): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (raw.startsWith('data:') || raw.startsWith('blob:') || /^https?:\/\//i.test(raw)) return raw
  const normalized = normalizeUploadPath(raw)
  if (!normalized.startsWith('/uploads/')) return normalized
  const configuredBase = trimBaseUrl(options.publicAssetBaseUrl || getStoredCatalogAssetBaseUrl())
  const fallbackBase = trimBaseUrl(options.fallbackBaseUrl || getSafeCurrentOrigin())
  const base = configuredBase || fallbackBase
  const assetUrl = base ? `${base}${normalized}` : normalized
  return appendAssetVersion(assetUrl, options.assetVersion || '')
}
