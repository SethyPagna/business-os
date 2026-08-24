import { resolvePublicAssetUrl } from './publicAssetUrls.ts'
import { isTemporaryPreviewUrl } from './mediaUploadState.ts'
export {
  createInitialUploadState,
  isTemporaryPreviewUrl,
  reduceUploadState,
  sanitizePersistedMediaPath,
} from './mediaUploadState.ts'
export type { UploadAction, UploadState, UploadStateMap } from './mediaUploadState.ts'

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
