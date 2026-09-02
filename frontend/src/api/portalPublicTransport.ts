type PortalPayload = Record<string, unknown>
type QueryPrimitive = string | number | boolean | null | undefined
type QueryValue = QueryPrimitive | QueryPrimitive[]
type QueryParams = Record<string, QueryValue>

const PORTAL_HEADERS = { 'bypass-tunnel-reminder': 'true' }
const PORTAL_JSON_HEADERS = {
  'Content-Type': 'application/json',
  ...PORTAL_HEADERS,
}

// Deliberately NOT imported from ./portalHttp.ts (which the admin catalog
// editor's portalTransport.ts also uses): performanceLoadingUx.test.ts locks
// this file into vite.config.ts's self-contained public 'app-portal' chunk
// and portalHttp.ts into the separate admin-only 'portal-admin-api' chunk
// (portalHttp.ts itself imports getSyncServerUrl from api/http.ts, the
// shared admin HTTP core that must never reach the public storefront's
// startup bundle). Importing the shared helpers here previously (commit
// 9bfd2d90) fixed a real bug -- the storefront ignored a
// localStorage['businessos_sync_server'] override -- but silently reversed
// that chunk boundary, so this file now carries its own copy instead. The
// STORAGE_KEYS.SYNC_SERVER string is inlined rather than imported from
// ../constants.ts for the same reason: a dependency-free file only, per the
// "stay self-contained" contract those tests enforce.
const PORTAL_SYNC_SERVER_STORAGE_KEY = 'businessos_sync_server'

// Same override-wins-over-same-origin precedence as the admin transport
// (api/http.ts's getReadServerBaseUrl()) and as portalHttp.ts's copy used by
// the admin catalog editor's own live preview -- an explicit dev/test
// override must always win. Unlike portalHttp.ts's copy, this one does not
// also fall back to the admin app's in-memory getSyncServerUrl() state:
// PublicCatalogRoot never mounts the admin bootstrap that hydrates it, so
// that fallback would always resolve empty here anyway, and checking it
// would require importing the forbidden shared admin HTTP core.
function getPortalBaseUrl(): string {
  let stored = ''
  try {
    stored = typeof window !== 'undefined' ? (window.localStorage?.getItem(PORTAL_SYNC_SERVER_STORAGE_KEY) || '') : ''
  } catch (_) {
    // Storage can throw (private mode, disabled cookies) -- fall through.
  }
  const browserOrigin = typeof window !== 'undefined' ? (window.location?.origin || '') : ''
  return (stored || browserOrigin || '').replace(/\/$/, '')
}

async function fetchJsonWithTimeout(
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

function readJsonObject(response: Response): Promise<PortalPayload> {
  return response.json().catch(() => ({})) as Promise<PortalPayload>
}

function buildQueryString(params: QueryParams | null | undefined = {}): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params || {})) {
    if (Array.isArray(value)) {
      for (const item of value) appendQueryValue(query, key, item)
      continue
    }
    appendQueryValue(query, key, value)
  }
  return query.toString()
}

function appendQuery(path: string, query: string): string {
  return query ? `${path}?${query}` : path
}

function appendQueryValue(query: URLSearchParams, key: string, value: QueryPrimitive): void {
  if (value == null || value === '') return
  query.append(key, String(value))
}

async function fetchPortalJson(path: string, errorLabel: string): Promise<unknown> {
  const base = getPortalBaseUrl()
  const res = await fetchJsonWithTimeout(`${base}${path}`, {
    headers: PORTAL_HEADERS,
  })
  if (!res.ok) throw new Error(`${errorLabel} failed: ${res.status}`)
  return res.json()
}

export function getPortalConfig(): Promise<unknown> {
  return fetchPortalJson('/api/portal/config', 'Portal config')
}

export function getPortalBootstrap(): Promise<unknown> {
  return fetchPortalJson('/api/portal/bootstrap', 'Portal bootstrap')
}

export function getPortalCatalogMeta(): Promise<unknown> {
  return fetchPortalJson('/api/portal/catalog/meta', 'Portal catalog meta')
}

export function getPortalCatalogProducts(): Promise<unknown> {
  return fetchPortalJson('/api/portal/catalog/products', 'Portal catalog products')
}

export function getPortalPromotions(): Promise<unknown> {
  return fetchPortalJson('/api/portal/promotions', 'Portal promotions')
}

export async function searchPortalCatalogProducts(params: QueryParams = {}): Promise<unknown> {
  const base = getPortalBaseUrl()
  const query = buildQueryString(params)
  const res = await fetchJsonWithTimeout(`${base}${appendQuery('/api/portal/catalog/products/search', query)}`, {
    headers: PORTAL_HEADERS,
  })
  if (!res.ok) throw new Error(`Portal catalog search failed: ${res.status}`)
  return res.json()
}

export async function lookupPortalMembership(membershipNumber: string | number): Promise<unknown | null> {
  // The anonymous membership lookup is DISABLED (§2). The endpoint now returns
  // 403 feature_disabled; treat that (and 404) as "no data" so any legacy
  // caller degrades gracefully instead of throwing. The storefront no longer
  // calls this — the Account section (CatalogAccountSection) replaces it.
  const base = getPortalBaseUrl()
  const value = encodeURIComponent(String(membershipNumber || '').trim())
  const res = await fetchJsonWithTimeout(`${base}/api/portal/membership/${value}`, {
    headers: PORTAL_HEADERS,
  })
  if (res.status === 404 || res.status === 403) return null
  if (!res.ok) throw new Error(`Membership lookup failed: ${res.status}`)
  return res.json()
}

// ---- Customer accounts (§2) ------------------------------------------------
// All account calls are same-origin and must carry the bos_portal session
// cookie, so they send credentials and read/return the JSON body (which
// carries a friendly `error` string on failure).
async function portalAuthRequest(path: string, method: 'GET' | 'POST' | 'PUT', body?: PortalPayload): Promise<PortalPayload> {
  const base = getPortalBaseUrl()
  const res = await fetchJsonWithTimeout(`${base}${path}`, {
    method,
    headers: body ? PORTAL_JSON_HEADERS : PORTAL_HEADERS,
    credentials: 'include',
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const json = await readJsonObject(res)
  if (!res.ok) {
    const error = new Error(String(json.error || `Request failed: ${res.status}`)) as Error & { status?: number; code?: unknown }
    error.status = res.status
    error.code = json.code
    throw error
  }
  return json
}

export function signupPortalAccount(payload: PortalPayload): Promise<unknown> {
  return portalAuthRequest('/api/portal/auth/signup', 'POST', payload)
}

export function signinPortalAccount(payload: PortalPayload): Promise<unknown> {
  return portalAuthRequest('/api/portal/auth/signin', 'POST', payload)
}

export function signoutPortalAccount(): Promise<unknown> {
  return portalAuthRequest('/api/portal/auth/signout', 'POST', {})
}

export function getPortalAccountMe(): Promise<unknown> {
  return portalAuthRequest('/api/portal/auth/me', 'GET')
}

export function getPortalCart(): Promise<unknown> {
  return portalAuthRequest('/api/portal/account/cart', 'GET')
}

export function savePortalCart(items: unknown[]): Promise<unknown> {
  return portalAuthRequest('/api/portal/account/cart', 'PUT', { items })
}

export function getPortalWishlist(): Promise<unknown> {
  return portalAuthRequest('/api/portal/account/wishlist', 'GET')
}

export function savePortalWishlist(items: unknown[]): Promise<unknown> {
  return portalAuthRequest('/api/portal/account/wishlist', 'PUT', { items })
}

export async function createPortalSubmission(payload: PortalPayload = {}): Promise<unknown> {
  const base = getPortalBaseUrl()
  const res = await fetchJsonWithTimeout(`${base}/api/portal/submissions`, {
    method: 'POST',
    headers: PORTAL_JSON_HEADERS,
    body: JSON.stringify(payload || {}),
  })
  const json = await readJsonObject(res)
  if (!res.ok) throw new Error(String(json.error || `Submission failed: ${res.status}`))
  return json
}

export function getPortalAiStatus(): Promise<unknown> {
  return fetchPortalJson('/api/portal/ai/status', 'Portal AI status')
}

export async function askPortalAi(payload: PortalPayload = {}): Promise<unknown> {
  const base = getPortalBaseUrl()
  const res = await fetchJsonWithTimeout(`${base}/api/portal/ai/chat`, {
    method: 'POST',
    headers: PORTAL_JSON_HEADERS,
    body: JSON.stringify(payload || {}),
  })
  const json = await readJsonObject(res)
  if (!res.ok) throw new Error(String(json.error || `Portal AI failed: ${res.status}`))
  return json
}
