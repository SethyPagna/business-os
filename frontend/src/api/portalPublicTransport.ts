type PortalPayload = Record<string, unknown>
type QueryPrimitive = string | number | boolean | null | undefined
type QueryValue = QueryPrimitive | QueryPrimitive[]
type QueryParams = Record<string, QueryValue>

const PORTAL_HEADERS = { 'bypass-tunnel-reminder': 'true' }
const PORTAL_JSON_HEADERS = {
  'Content-Type': 'application/json',
  ...PORTAL_HEADERS,
}

function readJsonObject(response: Response): Promise<PortalPayload> {
  return response.json().catch(() => ({})) as Promise<PortalPayload>
}

function getPortalBaseUrl(): string {
  return (typeof window !== 'undefined' ? (window.location?.origin || '') : '').replace(/\/$/, '')
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

async function fetchPortalJson(path: string, errorLabel: string): Promise<unknown> {
  const base = getPortalBaseUrl()
  const res = await fetchJsonWithTimeout(`${base}${path}`, {
    headers: PORTAL_HEADERS,
  })
  if (!res.ok) throw new Error(`${errorLabel} failed: ${res.status}`)
  return res.json()
}

export function getCatalogMeta(): Promise<unknown> {
  return fetchPortalJson('/api/catalog/meta', 'Catalog meta')
}

export function getCatalogProducts(): Promise<unknown> {
  return fetchPortalJson('/api/catalog/products', 'Catalog products')
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
  const base = getPortalBaseUrl()
  const value = encodeURIComponent(String(membershipNumber || '').trim())
  const res = await fetchJsonWithTimeout(`${base}/api/portal/membership/${value}`, {
    headers: PORTAL_HEADERS,
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Membership lookup failed: ${res.status}`)
  return res.json()
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
