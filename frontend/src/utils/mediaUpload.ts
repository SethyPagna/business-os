import { resolvePublicAssetUrl } from './publicAssetUrls.ts'
import { isTemporaryPreviewUrl } from './mediaUploadState.ts'
export {
  createInitialUploadState,
  isTemporaryPreviewUrl,
  reduceUploadState,
  sanitizePersistedMediaPath,
} from './mediaUploadState.ts'
export type { UploadAction, UploadState, UploadStateMap } from './mediaUploadState.ts'

/**
 * Returns the stable identity persisted in D1 for a stored upload.
 *
 * Cache query strings belong to the rendered URL, not the file_assets key.
 * Only relative /uploads paths (and an absolute URL on the current origin)
 * are collapsed so signed/external URLs keep their meaningful query string.
 */
export function canonicalizePersistedMediaPath(value: unknown, fallback = ''): string {
  const raw = String(value || '').trim()
  if (!raw) return String(fallback || '').trim()
  if (isTemporaryPreviewUrl(raw)) return String(fallback || '').trim()
  try {
    const absolute = /^https?:\/\//i.test(raw)
    const parsed = new URL(raw, 'http://localhost')
    const relativeUpload = !absolute && parsed.pathname.startsWith('/uploads/')
    const sameOriginUpload = absolute
      && typeof window !== 'undefined'
      && parsed.origin === window.location.origin
      && parsed.pathname.startsWith('/uploads/')
    if (relativeUpload || sameOriginUpload) return parsed.pathname
  } catch (_) {
    if (/^\/?uploads\//i.test(raw)) return `/${raw.replace(/^\/+/, '').split(/[?#]/, 1)[0]}`
  }
  return raw
}

export function buildCacheBustedMediaPath(path: unknown, version: unknown): string {
  const rawPath = resolvePublicAssetUrl(path) || String(path || '').trim()
  const rawVersion = String(version || '').trim()
  if (!rawPath || !rawVersion) return rawPath
  if (isTemporaryPreviewUrl(rawPath)) return rawPath
  try {
    const parsed = new URL(rawPath, 'http://localhost')
    parsed.searchParams.set('v', rawVersion)
    if (/^https?:\/\//i.test(rawPath)) return parsed.toString()
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch (_) {
    const withoutVersion = String(rawPath).replace(/([?&])v=[^&#]*(&?)/, (match, prefix, suffix) => (
      suffix ? prefix : ''
    )).replace(/[?&]$/, '')
    return `${withoutVersion}${withoutVersion.includes('?') ? '&' : '?'}v=${encodeURIComponent(rawVersion)}`
  }
}
