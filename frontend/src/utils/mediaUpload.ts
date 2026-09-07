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
 * Only relative /uploads paths are collapsed. Absolute URLs are ambiguous:
 * parsing one can change a legitimate percent-escaped stored identity, so a
 * signed/current-origin absolute URL keeps its original value.
 */
export function canonicalizePersistedMediaPath(value: unknown, fallback = ''): string {
  const raw = String(value || '').trim()
  if (!raw) return String(fallback || '').trim()
  if (isTemporaryPreviewUrl(raw)) return String(fallback || '').trim()
  // Upload responses and Library rows already carry the exact file_assets
  // identity. URL.pathname would percent-encode literal spaces/Khmer.
  if (/^\/?uploads\//i.test(raw)) {
    return `/${raw.replace(/^\/+/, '').split(/[?#]/, 1)[0]}`
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
