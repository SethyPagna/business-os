import { getSyncServerUrl } from './http.ts'
import { STORAGE_KEYS } from '../constants.ts'

// Same precedence as the admin transport (api/http.ts's
// getReadServerBaseUrl(), line ~129-130: `getSyncServerUrl() ||
// getSameOriginApiBaseUrl()`): an explicit sync-server override must win
// over same-origin, never the other way around. Same-origin is still
// correct and by far the most common case in production, where the Worker
// serves both the storefront and its API from one origin -- this only
// changes behavior when an override is explicitly set.
//
// Reads localStorage directly rather than only the shared getSyncServerUrl()
// module state: that state is hydrated by the ADMIN app's bootstrap
// (AppContext.tsx / web-api.ts's setSyncServerUrl), which the lightweight
// PublicCatalogRoot never mounts. Without this, the documented escape valve
// for pointing the storefront at a different backend during local/dev
// testing (localStorage['businessos_sync_server']) silently had no effect
// on the public catalog -- it only ever worked for the admin app. Checking
// getSyncServerUrl() too keeps this in sync with an admin session that HAS
// already hydrated it (e.g. the Catalog editor's own portalTransport.ts,
// which shares this helper) without a second localStorage read there.
export function getPortalBaseUrl(): string {
  let stored = ''
  try {
    stored = typeof window !== 'undefined' ? (window.localStorage?.getItem(STORAGE_KEYS.SYNC_SERVER) || '') : ''
  } catch (_) {
    // Storage can throw (private mode, disabled cookies) -- fall through.
  }
  const browserOrigin = typeof window !== 'undefined' ? (window.location?.origin || '') : ''
  return (stored || getSyncServerUrl() || browserOrigin || '').replace(/\/$/, '')
}

export async function fetchJsonWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    })
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
