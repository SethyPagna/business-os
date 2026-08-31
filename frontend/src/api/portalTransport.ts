import {
  apiFetch,
  getApiVersionMismatchCooldown,
  markApiVersionMismatch,
  route,
} from './http.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'
import { fetchJsonWithTimeout, getPortalBaseUrl } from './portalHttp.ts'

type PortalPayload = Record<string, unknown>

const PORTAL_HEADERS = { 'bypass-tunnel-reminder': 'true' }
const PORTAL_JSON_HEADERS = {
  'Content-Type': 'application/json',
  ...PORTAL_HEADERS,
}

function readJsonObject(response: Response): Promise<PortalPayload> {
  return response.json().catch(() => ({})) as Promise<PortalPayload>
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

export async function searchPortalCatalogProducts(params: QueryParams = {}): Promise<unknown> {
  const path = '/api/portal/catalog/products/search'
  const mismatchError = getApiVersionMismatchCooldown(path)
  if (mismatchError) throw mismatchError

  const base = getPortalBaseUrl()
  const query = buildQueryString(params)
  const res = await fetchJsonWithTimeout(`${base}${appendQuery(path, query)}`, {
    headers: PORTAL_HEADERS,
  })
  if (res.status === 404) throw markApiVersionMismatch(path, res.status)
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

export function getPortalSubmissionsForReview(): Promise<unknown> {
  return route('portalSubmissions:get', () => apiFetch('GET', '/api/portal/submissions/review'), () => [])
}

export function reviewPortalSubmission(id: string | number, payload: PortalPayload = {}): Promise<unknown> {
  return route(
    'portalSubmissions:review',
    () => apiFetch('PATCH', `/api/portal/submissions/${id}/review`, payload),
    null,
    true,
  )
}
