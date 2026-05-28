/**
 * api/http.js ??HTTP client for the sync server.
 *
 * Provides:
 *   apiFetch(method, path, body)  ??typed JSON fetch with cookie credentials and timeout
 *   isNetErr(err)                 ??classify network errors (vs server errors)
 *   readCache / writeCache        ??short-lived in-memory read cache (20 s TTL)
 *   route(channel, serverFn, localFn, isWrite) ??smart dispatcher used by every api/* module
 *
 * Consumers import from this file; they never access syncServerUrl directly.
 * Call setSyncServerUrl() and setSyncToken() from AppContext or web-api bootstrap.
 */

import { SYNC } from '../constants.js'
import { getClientMetaHeaders as sharedGetClientMetaHeaders } from '../utils/deviceInfo.ts'

declare const __FRONTEND_BUILD_HASH__: string | undefined
declare const __FRONTEND_BUILD_REVISION__: string | undefined

type LooseRecord = Record<string, any>
type ApiRuntimeError = Error & LooseRecord
type CacheEntry = { data: any; ts: number }
type CacheState = { data: any; stale: boolean }
type InflightWrite = { promise: Promise<any>; startedAt: number }
type RouteFn<T = any> = () => T | Promise<T>
type ApiFetchOptions = { skipWriteDedupe?: boolean }
type RequestInitWithBody = RequestInit & { body?: string }
type RefreshEventDetail = { reason?: string; channel?: string }
type CallLogEntry = { ts: string; channel: string; source: string; ms: number; ok: boolean }
type RaceReadResult = { source: 'server' | 'local'; data: any }
type RuntimeBuildInfo = { hash?: string; revision?: string; builtAt?: string }

// ?€?€?€ Mutable connection state (module-level, intentionally not React state) ?€?€?€
let syncServerUrl = ''
let syncToken     = ''
const RECONNECT_REFRESH_CHANNELS = [
  'settings',
  'products',
  'inventory',
  'sales',
  'returns',
  'customers',
  'suppliers',
  'delivery_contacts',
  'deliveryContacts',
  'branches',
  'dashboard',
  'catalog',
  'files',
  'audit_log',
  'users',
]

export function getSyncServerUrl(): string { return syncServerUrl }
export function getSyncToken(): string     { return syncToken }

export function setSyncServerUrl(url: unknown): void { syncServerUrl = String(url || '').trim().replace(/\/$/, '') }
export function setSyncToken(token: unknown): void   { syncToken = String(token || '').trim() }

// ?€?€?€ In-memory read cache with request deduplication ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
const _cache: Record<string, CacheEntry> = {}
const _inflight: Record<string, Promise<any>> = {}  // Track in-flight requests to dedupe
const _inflightStartedAt: Record<string, number> = {}
const _writeInflight = new Map<string, InflightWrite>()
const _apiMismatchCooldown = new Map<string, { error: ApiRuntimeError; until: number }>()
const CACHE_TTL   = 20_000   // 20 seconds
const INFLIGHT_REUSE_WINDOW_MS = Math.max(SYNC.REQUEST_TIMEOUT_MS || 15_000, 15_000)
const WRITE_INFLIGHT_REUSE_WINDOW_MS = Math.max(SYNC.REQUEST_TIMEOUT_MS || 15_000, 15_000)
const API_MISMATCH_COOLDOWN_MS = 30_000
const TRANSIENT_GATEWAY_STATUSES = new Set([502, 503, 504])
const CLOUDFLARE_ACCESS_LOGIN_RE = /(?:^|\/\/)[^/]*cloudflareaccess\.com\/cdn-cgi\/access\/login|\/cdn-cgi\/access\/login/i
export const FRONTEND_BUILD_INFO = {
  hash: typeof __FRONTEND_BUILD_HASH__ !== 'undefined' ? String(__FRONTEND_BUILD_HASH__ || '') : 'dev',
  revision: typeof __FRONTEND_BUILD_REVISION__ !== 'undefined' ? String(__FRONTEND_BUILD_REVISION__ || '') : 'dev',
}

function hasStoredAuthSession(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return !!(window.sessionStorage.getItem('businessos_user') || window.localStorage.getItem('businessos_user'))
  } catch (_) {
    return false
  }
}

function isProtectedAdminHost(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const hostname = String(window.location?.hostname || '').trim()
    return /^admin\./i.test(hostname) && !/^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0)$/i.test(hostname)
  } catch (_) {
    return false
  }
}

const REQUIRED_RUNTIME_API_PATTERNS = [
  /^\/api\/products\/search(?:\?|$)/,
  /^\/api\/products\/filters(?:\?|$)/,
  /^\/api\/inventory\/products\/search(?:\?|$)/,
  /^\/api\/portal\/catalog\/products\/search(?:\?|$)/,
]

function normalizeApiPath(path: unknown): string {
  const value = String(path || '')
  if (!value) return ''
  try {
    if (/^https?:\/\//i.test(value)) {
      const url = new URL(value)
      return `${url.pathname}${url.search || ''}`
    }
  } catch (_) {}
  return value
}

export function isRequiredRuntimeApiPath(path: unknown): boolean {
  const normalized = normalizeApiPath(path)
  return REQUIRED_RUNTIME_API_PATTERNS.some((pattern) => pattern.test(normalized))
}

function getApiMismatchKey(path: unknown): string {
  return normalizeApiPath(path).split('?')[0]
}

export function getApiVersionMismatchCooldown(path: unknown): ApiRuntimeError | null {
  const key = getApiMismatchKey(path)
  const record = _apiMismatchCooldown.get(key)
  if (!record) return null
  if (Date.now() > record.until) {
    _apiMismatchCooldown.delete(key)
    return null
  }
  return record.error
}

function dispatchApiVersionMismatch(error: ApiRuntimeError): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('runtime:api-mismatch', {
    detail: {
      path: error.path,
      status: error.status,
      code: error.code,
      frontend: FRONTEND_BUILD_INFO,
      message: error.message,
      ts: new Date().toISOString(),
    },
  }))
}

export function createApiVersionMismatchError(path: unknown, status = 404): ApiRuntimeError {
  const normalizedPath = getApiMismatchKey(path)
  const error = new Error('Business OS server update is required. The app is using newer catalog APIs than the running server provides.') as ApiRuntimeError
  error.status = status
  error.code = 'api_version_mismatch'
  error.path = normalizedPath
  error.reason = 'missing_required_api'
  error.frontend = FRONTEND_BUILD_INFO
  return error
}

export function isApiVersionMismatchError(error: any): boolean {
  return !!(error && (error.code === 'api_version_mismatch' || error.reason === 'missing_required_api'))
}

export function markApiVersionMismatch(path: unknown, status = 404): ApiRuntimeError {
  const error = createApiVersionMismatchError(path, status)
  _apiMismatchCooldown.set(getApiMismatchKey(path), {
    error,
    until: Date.now() + API_MISMATCH_COOLDOWN_MS,
  })
  dispatchApiVersionMismatch(error)
  return error
}

export function cacheGet(key: string): any {
  const e = _cache[key]
  return (e && Date.now() - e.ts < CACHE_TTL) ? e.data : null
}
export function cacheSet(key: string, data: any): void  { _cache[key] = { data, ts: Date.now() } }
export function cacheInvalidate(prefix: string): void {
  Object.keys(_cache).forEach(k => { if (k.startsWith(prefix)) delete _cache[k] })
}
export function cacheClearAll(): void {
  Object.keys(_cache).forEach(k => delete _cache[k])
  Object.keys(_inflight).forEach(k => delete _inflight[k])
  Object.keys(_inflightStartedAt).forEach(k => delete _inflightStartedAt[k])
  _writeInflight.clear()
  _apiMismatchCooldown.clear()
}

// Invalidate only the affected cache group on real sync updates. Cache-refresh
// events are emitted after a background read has already stored fresh data; if
// we clear that cache immediately, pages can fall into refresh churn.
if (typeof window !== 'undefined') {
  window.addEventListener('sync:update', (event) => {
    const detail = ((event as CustomEvent<RefreshEventDetail>)?.detail || {}) as RefreshEventDetail
    if (detail.reason === 'cache-refresh') return
    const channel = getChannelRefreshKey(detail.channel || '')
    if (!channel || channel === 'all' || channel === 'runtime') {
      cacheClearAll()
      return
    }
    cacheInvalidate(channel)
  })
}

// ?€?€?€ Logging ring buffer ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
let callLog: CallLogEntry[] = []
const MAX_LOG    = 300

function logCall(channel: string, source: string, ms: number, ok = true): void {
  callLog.unshift({ ts: new Date().toISOString(), channel, source, ms, ok })
  if (callLog.length > MAX_LOG) callLog.pop()
}

export function getCallLog(): CallLogEntry[]  { return [...callLog] }
export function clearCallLog(): void { callLog = [] }

function getClientMetaHeaders(): Record<string, string> {
  return sharedGetClientMetaHeaders()
}

function createApiError(status: number, parsed: LooseRecord | null, text: string): ApiRuntimeError {
  const error = new Error(parsed?.error || text || `HTTP ${status}`) as ApiRuntimeError
  error.status = status
  error.code = parsed?.code || null
  error.transientGateway = isTransientGatewayError(status)
  error.conflict = !!parsed?.conflict || parsed?.code === 'write_conflict'
  error.entity = parsed?.entity || null
  error.reason = parsed?.reason || null
  error.current = parsed?.current || null
  error.currentSettings = parsed?.currentSettings || null
  error.attempted = parsed?.attempted || null
  error.expectedUpdatedAt = parsed?.expectedUpdatedAt || null
  error.actualUpdatedAt = parsed?.actualUpdatedAt || null
  return error
}

export function isCloudflareAccessRedirectResponse(response: Response | LooseRecord | null | undefined): boolean {
  if (!response) return false
  if (response.type === 'opaqueredirect') return true
  const status = Number(response.status || 0)
  const url = String(response.url || '')
  if (CLOUDFLARE_ACCESS_LOGIN_RE.test(url)) return true
  if (status >= 300 && status < 400) {
    const location = response.headers?.get?.('Location') || response.headers?.get?.('location') || ''
    return CLOUDFLARE_ACCESS_LOGIN_RE.test(location)
  }
  return false
}

function createCloudflareAccessError(path: unknown): ApiRuntimeError {
  const error = new Error('Cloudflare Access sign-in is required before Business OS can reach the server.') as ApiRuntimeError
  error.status = 401
  error.code = 'cloudflare_access_required'
  error.path = normalizeApiPath(path)
  error.reason = 'cloudflare_access_redirect'
  error.transientGateway = false
  return error
}

function dispatchUnauthorized(detail: LooseRecord = {}): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('auth:unauthorized', {
    detail: {
      code: detail.code || 'invalid_session',
      error: detail.error || 'Please sign in again to continue.',
      reason: detail.reason || null,
      path: detail.path || null,
    },
  }))
}

export function shouldCompareRuntimeVersions(serverRuntime: LooseRecord = {}, frontendBuildInfo: RuntimeBuildInfo = FRONTEND_BUILD_INFO): boolean {
  const servedFrontend = serverRuntime?.frontend || {}
  const servedFrontendRevision = String(servedFrontend.revision || '').trim()
  const servedFrontendHash = String(servedFrontend.hash || '').trim()
  const frontendRevision = String(FRONTEND_BUILD_INFO.revision || '').trim()
  const frontendHash = String(frontendBuildInfo.hash || FRONTEND_BUILD_INFO.hash || '').trim()
  const effectiveFrontendRevision = String(frontendBuildInfo.revision || frontendRevision || '').trim()
  if (!servedFrontendRevision && !servedFrontendHash) return false
  if (servedFrontendHash && frontendHash) {
    return servedFrontendHash !== frontendHash
  }
  if (!effectiveFrontendRevision || !servedFrontendRevision) return false
  if (effectiveFrontendRevision === 'dev' || servedFrontendRevision === 'dev') return false
  return effectiveFrontendRevision !== servedFrontendRevision
}

function dispatchRuntimeVersionMismatch(serverRuntime: LooseRecord = {}): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('runtime:version-mismatch', {
    detail: {
      frontend: FRONTEND_BUILD_INFO,
      backend: serverRuntime,
      message: 'Business OS server and browser app versions do not match. Restart or update the server before continuing.',
      ts: new Date().toISOString(),
    },
  }))
}

function checkRuntimeVersionFromHealth(payload: LooseRecord = {}): void {
  const serverRuntime = payload?.runtime || {}
  if (shouldCompareRuntimeVersions(serverRuntime)) {
    dispatchRuntimeVersionMismatch(serverRuntime)
  }
}

function createWriteBlockedError(channel: string, message: string, detail: LooseRecord = {}): ApiRuntimeError {
  const error = new Error(message) as ApiRuntimeError
  error.code = 'write_requires_live_server'
  error.channel = channel
  error.reason = detail.reason || 'server_unavailable'
  error.serverOnline = detail.serverOnline !== false
  error.serverConfigured = detail.serverConfigured !== false
  error.status = Number(detail.status || 0) || null
  return error
}

function dispatchWriteBlocked(channel: string, message: string, detail: LooseRecord = {}): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('sync:write-blocked', {
    detail: {
      channel,
      error: message,
      reason: detail.reason || 'server_unavailable',
      serverOnline: detail.serverOnline !== false,
      serverConfigured: detail.serverConfigured !== false,
      status: Number(detail.status || 0) || null,
      ts: new Date().toISOString(),
    },
  }))
}

function dispatchTransientGatewayOutage(channel: string, error: ApiRuntimeError | null = null, active = true): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('sync:transient-outage', {
    detail: {
      active,
      channel,
      status: Number(error?.status || 0) || null,
      error: active
        ? (error?.message || 'Server/tunnel is reconnecting. Read-only data will refresh automatically.')
        : '',
      transient: true,
      ts: new Date().toISOString(),
    },
  }))
}

export function isWriteConflictError(error: any): boolean {
  return !!(error && (error.conflict || error.code === 'write_conflict'))
}

export function isWriteBlockedError(error: any): boolean {
  return !!(error && error.code === 'write_requires_live_server')
}

export function isInvalidSessionError(error: any): boolean {
  return !!(error && (
    error.code === 'invalid_session'
    || error.code === 'cloudflare_access_required'
    || error.reason === 'cloudflare_access_redirect'
    || (Number(error.status) === 401 && /sign in again|invalid session|cloudflare access/i.test(String(error.message || '')))
  ))
}

export function requireLiveServerWrite(channel: string, options: { notConfiguredMessage?: string; offlineMessage?: string } = {}): true {
  if (!syncServerUrl) {
    const message = options.notConfiguredMessage || 'Server is not connected. Changes are invalid until a live server is configured.'
    dispatchWriteBlocked(channel, message, {
      reason: 'server_not_configured',
      serverOnline: false,
      serverConfigured: false,
    })
    throw createWriteBlockedError(channel, message, {
      reason: 'server_not_configured',
      serverOnline: false,
      serverConfigured: false,
    })
  }

  if (!_serverOnline && typeof navigator !== 'undefined' && navigator.onLine === false) {
    const message = options.offlineMessage || 'Server is offline. Changes are invalid until the server reconnects.'
    dispatchWriteBlocked(channel, message, {
      reason: 'server_offline',
      serverOnline: false,
      serverConfigured: true,
    })
    throw createWriteBlockedError(channel, message, {
      reason: 'server_offline',
      serverOnline: false,
      serverConfigured: true,
    })
  }

  return true
}

function getConflictRefreshChannels(error: any, fallbackChannel: string): string[] {
  const entity = String(error?.entity || '').trim().toLowerCase()
  if (entity === 'settings') return ['settings']
  if (entity === 'sale') return ['sales', 'returns', 'inventory', 'dashboard']
  if (entity === 'return') return ['returns', 'sales', 'inventory', 'dashboard']
  if (entity === 'ai_provider_config') return ['settings']
  return [getChannelRefreshKey(fallbackChannel)]
}

function dispatchGlobalDataRefresh(channels: string[] = RECONNECT_REFRESH_CHANNELS): void {
  if (typeof window === 'undefined') return
  ;(Array.isArray(channels) ? channels : RECONNECT_REFRESH_CHANNELS).forEach((channel) => {
    window.dispatchEvent(new CustomEvent('sync:update', {
      detail: { channel, ts: Date.now() },
    }))
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function hasUsableLocalData(value: any): boolean {
  if (value == null) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') {
    if (Array.isArray(value.items)) {
      return value.items.length > 0 || Number(value.total || 0) > 0
    }
    if (Array.isArray(value.rows)) {
      return value.rows.length > 0 || Number(value.total || 0) > 0
    }
    return Object.keys(value).length > 0
  }
  return true
}

async function tryServerReadWithRetry<T>(serverFn: RouteFn<T>): Promise<T> {
  try {
    return await serverFn()
  } catch (error: any) {
    if (isTransientGatewayError(error?.status)) throw error
    if (!isConnectivityError(error)) throw error
    await sleep(SYNC.READ_SERVER_RETRY_DELAY_MS)
    return serverFn()
  }
}

function noteReadFailure(channel: string, error: any, source: string, startedAt: number): boolean {
  if (isTransientGatewayError(error?.status)) {
    setServerHealth(false)
    dispatchTransientGatewayOutage(channel, error, true)
    logCall(channel, source || 'transient-gateway', Date.now() - startedAt, false)
    return true
  }
  if (isConnectivityError(error)) {
    setServerHealth(false)
  }
  logCall(channel, source || 'local-fallback', Date.now() - startedAt, false)
  return false
}

async function resolveLocalRead<T>(channel: string, localFn: RouteFn<T>, source = 'local'): Promise<T> {
  const localResult = await localFn()
  cacheSet(channel, localResult)
  logCall(channel, source, 0)
  return localResult
}

function stableStringifyForDedupe(value: any): string {
  if (value === undefined) return ''
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringifyForDedupe).join(',')}]`
  const keys = Object.keys(value)
    .filter(key => !['client_request_id', 'clientRequestId', 'request_id', 'idempotency_key'].includes(key))
    .sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringifyForDedupe(value[key])}`).join(',')}}`
}

function clampDedupeBody(value: any): string {
  const bodyKey = stableStringifyForDedupe(value)
  if (bodyKey.length <= 20_000) return bodyKey
  return `${bodyKey.slice(0, 20_000)}:${bodyKey.length}`
}

export function buildApiRequestDedupeKey(method: unknown, path: unknown, body: unknown): string {
  const verb = String(method || 'GET').toUpperCase()
  if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS') return ''
  return `${verb} ${String(path || '')} ${clampDedupeBody(body)}`
}

function methodAllowsRequestBody(method: unknown): boolean {
  const verb = String(method || 'GET').toUpperCase()
  return verb !== 'GET' && verb !== 'HEAD' && verb !== 'OPTIONS'
}

export function __resetApiWriteDedupeForTests(): void {
  _writeInflight.clear()
}

// HTTP helpers ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
export async function apiFetch(method: unknown, path: string, body?: unknown, timeoutMs: number = SYNC.REQUEST_TIMEOUT_MS, options: ApiFetchOptions = {}): Promise<any> {
  const normalizedMethod = String(method || 'GET').toUpperCase()
  if (normalizedMethod === 'GET' && isRequiredRuntimeApiPath(path)) {
    const mismatchError = getApiVersionMismatchCooldown(path)
    if (mismatchError) {
      dispatchApiVersionMismatch(mismatchError)
      throw mismatchError
    }
  }
  const dedupeKey = options.skipWriteDedupe ? '' : buildApiRequestDedupeKey(normalizedMethod, path, body)
  if (dedupeKey) {
    const existing = _writeInflight.get(dedupeKey)
    if (existing && Date.now() - existing.startedAt <= Math.max(timeoutMs, WRITE_INFLIGHT_REUSE_WINDOW_MS)) {
      return existing.promise
    }
    if (existing) {
      _writeInflight.delete(dedupeKey)
    }
  }

  const requestPromise: Promise<any> = (async () => {
  const base    = syncServerUrl.replace(/\/$/, '')
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'bypass-tunnel-reminder': 'true', ...getClientMetaHeaders() }
  if (syncToken) headers['x-sync-token'] = syncToken

  const ctrl  = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, timeoutMs)

  try {
    const requestInit: RequestInitWithBody = {
      method: normalizedMethod,
      headers,
      credentials: 'include',
      redirect: 'manual',
      signal: ctrl.signal,
    }
    if (methodAllowsRequestBody(normalizedMethod) && body !== undefined) {
      requestInit.body = JSON.stringify(body)
    }
    const res = await fetch(`${base}${path}`, requestInit)
    clearTimeout(timer)
    if (isCloudflareAccessRedirectResponse(res)) {
      const accessError = createCloudflareAccessError(path)
      dispatchUnauthorized({
        code: accessError.code,
        error: accessError.message,
        reason: accessError.reason,
        path: accessError.path,
      })
      throw accessError
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const parsed = (() => { try { return JSON.parse(text) } catch { return null } })()
      if (res.status === 404 && normalizedMethod === 'GET' && isRequiredRuntimeApiPath(path)) {
        throw markApiVersionMismatch(path, res.status)
      }
      const msg  = parsed?.error || text
      const apiError = createApiError(res.status, parsed, text)
      if (typeof window !== 'undefined' && shouldDispatchUnauthorized(path, res.status, parsed)) {
        dispatchUnauthorized({
          code: parsed?.code || 'invalid_session',
          error: parsed?.error || 'Please sign in again to continue.',
          reason: parsed?.reason || null,
          path,
        })
      }
      throw apiError || new Error(msg || `HTTP ${res.status}`)
    }
    return res.json()
  } catch (e: any) {
    clearTimeout(timer)
    if (timedOut || e?.name === 'AbortError') {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`)
    }
    throw e
  }
  })()

  if (dedupeKey) {
    _writeInflight.set(dedupeKey, { promise: requestPromise, startedAt: Date.now() })
    requestPromise.finally(() => {
      const current = _writeInflight.get(dedupeKey)
      if (current?.promise === requestPromise) {
        _writeInflight.delete(dedupeKey)
      }
    }).catch(() => {})
  }

  return requestPromise
}

export function isNetErr(e: any): boolean {
  const m = e?.message || ''
  return ['Failed to fetch', 'Load failed', 'NetworkError', 'ECONNREFUSED', 'abort', 'network', 'timed out']
    .some(s => m.toLowerCase().includes(s.toLowerCase()))
}

export function isTransientGatewayError(statusOrError: any): boolean {
  const status = Number(typeof statusOrError === 'object' ? statusOrError?.status : statusOrError)
  return TRANSIENT_GATEWAY_STATUSES.has(status) || (status >= 520 && status <= 530)
}

export function isReachableServerResponseStatus(statusOrResponse: any): boolean {
  const status = Number(
    typeof statusOrResponse === 'object'
      ? statusOrResponse?.status
      : statusOrResponse,
  )
  if (!Number.isFinite(status) || status <= 0) return false
  if (isTransientGatewayError(status)) return false
  return true
}

function shouldDispatchUnauthorized(path: unknown, status: unknown, parsed: LooseRecord | null): boolean {
  if (Number(status) !== 401) return false
  if (String(parsed?.code || '').trim().toLowerCase() === 'invalid_session') return true
  const normalizedPath = normalizeApiPath(path).split('?')[0]
  if (!normalizedPath.startsWith('/api/')) return false
  if (
    /^\/api\/auth\/(?:login|verify-otp|forgot-password|request-password-reset|reset-password|providers|oauth\/start|oauth\/complete|owned-google-config)$/.test(normalizedPath)
  ) {
    return false
  }
  return true
}

function isConnectivityError(error: any): boolean {
  if (!error) return false
  if (isInvalidSessionError(error)) return false
  if (isTransientGatewayError(error?.status)) return true
  if (isNetErr(error)) return true
  const name = String(error?.name || '').toLowerCase()
  if (name.includes('abort')) return true
  const message = String(error?.message || '').toLowerCase()
  return (
    message.includes('timed out')
    || message.includes('failed to fetch')
    || message.includes('network')
    || message.includes('load failed')
    || message.includes('econnrefused')
  )
}

// ?€?€?€ Server health state ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
let _serverOnline = true          // optimistic until proven otherwise
let _healthTimer: ReturnType<typeof setInterval> | null = null

export function isServerOnline(): boolean { return _serverOnline }

function setServerHealth(online: boolean): void {
  if (online === _serverOnline) return
  _serverOnline = online
  window.dispatchEvent(new CustomEvent('server:health', { detail: { online } }))
  if (online) {
    dispatchTransientGatewayOutage('server:health', null, false)
    // Server just came back ??clear all caches so fresh data is fetched
    cacheClearAll()
    dispatchGlobalDataRefresh()
    window.dispatchEvent(new CustomEvent('sync:reconnected'))
  }
}

async function pingServerHealth(): Promise<void> {
  if (!syncServerUrl) return
  if (isProtectedAdminHost() && !hasStoredAuthSession()) return
  try {
    const res = await fetch(`${syncServerUrl}/health`, {
      signal: AbortSignal.timeout(4000),
      headers: { 'bypass-tunnel-reminder': 'true' },
      credentials: 'include',
      redirect: 'manual',
    })
    if (isCloudflareAccessRedirectResponse(res)) {
      dispatchUnauthorized({
        code: 'cloudflare_access_required',
        error: 'Please sign in again to continue.',
        reason: 'cloudflare_access_redirect',
        path: '/health',
      })
      return
    }
    if (res.ok) {
      const payload = await res.clone().json().catch(() => null)
      if (payload) checkRuntimeVersionFromHealth(payload)
    }
    setServerHealth(isReachableServerResponseStatus(res))
  } catch {
    setServerHealth(false)
  }
}

// Active health check ??runs every 12 s when a server is configured.
// Also re-attempts the server for reads when it was previously marked offline,
// ensuring recovery after a server restart without requiring a user login.
export function startHealthCheck(): void {
  if (_healthTimer) return
  _healthTimer = setInterval(async () => {
    await pingServerHealth()
  }, 12_000)
  pingServerHealth().catch(() => {})
}

if (typeof window !== 'undefined') {
  window.addEventListener('online',  () => {
    if (syncServerUrl) {
      setServerHealth(true)
      pingServerHealth().catch(() => {})
    }
  })
  window.addEventListener('offline', () => setServerHealth(false))
  window.addEventListener('focus', () => {
    if (syncServerUrl) pingServerHealth().catch(() => {})
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && syncServerUrl) {
      pingServerHealth().catch(() => {})
    }
  })
}

// ?€?€?€ Stale-while-revalidate cache (extended TTL for offline resilience) ?€?€?€?€
const STALE_TTL   = 45_000    // 45 s ??serve stale while revalidating (was 5 min; reduced so a
                               // server restart clears stale data quickly without blanking the UI)
const FRESH_TTL   = CACHE_TTL // 20 s ??treat as fresh, skip server

export function cacheGetStale(key: string): CacheState {
  const e = _cache[key]
  if (!e) return { data: null, stale: false }
  const age = Date.now() - e.ts
  if (age < FRESH_TTL) return { data: e.data, stale: false }
  if (age < STALE_TTL) return { data: e.data, stale: true  }
  return { data: null, stale: false }
}

function getChannelRefreshKey(channel: unknown): string {
  const channelKey = String(channel || '')
  return channelKey.split(':')[0] || channelKey
}

function emitCacheRefresh(channel: string): void {
  if (typeof window === 'undefined') return
  const refreshKey = getChannelRefreshKey(channel)
  window.dispatchEvent(new CustomEvent('cache:updated', { detail: { channel } }))
  window.dispatchEvent(new CustomEvent('sync:update', {
    detail: {
      channel: refreshKey,
      ts: Date.now(),
      reason: 'cache-refresh',
      source: channel,
    },
  }))
}

function clearInflight(channel: string): void {
  delete _inflight[channel]
  delete _inflightStartedAt[channel]
}

function hasReusableInflight(channel: string): boolean {
  if (!_inflight[channel]) return false
  const startedAt = _inflightStartedAt[channel] || 0
  if (startedAt && Date.now() - startedAt > INFLIGHT_REUSE_WINDOW_MS) {
    clearInflight(channel)
    return false
  }
  return true
}

async function raceServerReadWithLocalFallback<T>(
  channel: string,
  inflightPromise: Promise<T>,
  localFn: RouteFn<T>,
  t0: number,
  sourceLabel = 'cache-dedup',
): Promise<T> {
  const localPromise = Promise.resolve()
    .then(() => localFn())
    .then((result) => {
      if (hasUsableLocalData(result)) {
        cacheSet(channel, result)
      }
      return result
    })
    .catch(() => null)

  let fallbackTimer: number | null = null
  const localFallbackPromise = new Promise<RaceReadResult>((resolve) => {
    fallbackTimer = window.setTimeout(async () => {
      const localResult = await localPromise
      if (hasUsableLocalData(localResult)) {
        resolve({ source: 'local', data: localResult })
        return
      }
      resolve({ source: 'local', data: null })
    }, SYNC.READ_LOCAL_FALLBACK_MS)
  })

  try {
    const winner = await Promise.race([
      inflightPromise.then((result) => ({ source: 'server' as const, data: result })),
      localFallbackPromise,
    ])
    if (fallbackTimer != null) {
      window.clearTimeout(fallbackTimer)
    }

    if (winner?.source === 'local' && winner.data !== null) {
      logCall(channel, `${sourceLabel}-local`, Date.now() - t0)
      inflightPromise
        .then((result) => {
          cacheSet(channel, result)
          emitCacheRefresh(channel)
        })
        .catch(() => {})
      return winner.data
    }

    logCall(channel, sourceLabel, Date.now() - t0)
    return winner?.data ?? await inflightPromise
  } catch (error: any) {
    if (fallbackTimer != null) {
      window.clearTimeout(fallbackTimer)
    }
    const localResult = await localPromise
    if (hasUsableLocalData(localResult)) {
      if (isTransientGatewayError(error?.status)) {
        noteReadFailure(channel, error, `${sourceLabel}-transient-gateway-local-recovery`, t0)
      }
      logCall(channel, `${sourceLabel}-local-recovery`, Date.now() - t0)
      inflightPromise
        .then((result) => {
          cacheSet(channel, result)
          emitCacheRefresh(channel)
        })
        .catch(() => {})
      return localResult as T
    }
    throw error
  }
}

// ?€?€?€ Smart dispatcher ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
/**
 * route() ??unified read/write dispatcher with:
 *   - Stale-while-revalidate: serve cached data immediately, refresh in background
 *   - Writes fail closed when the live server is unavailable
 *   - Cache tag invalidation: invalidate whole entity groups instantly
 *   - Active health awareness: skips server call if known offline
 */
export async function route<T = any>(channel: string, serverFn: RouteFn<T>, localFn?: RouteFn<T> | null, isWrite = false): Promise<T | null> {
  const t0 = Date.now()

  // ?€?€ Reads ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
  if (!isWrite) {
    if (syncServerUrl) {
      const { data: cached, stale } = cacheGetStale(channel)

      if (cached !== null && !stale) {
        // Fresh cache hit ??return immediately
        logCall(channel, 'cache', 0)
        return cached
      }

      if (cached !== null && stale) {
        // Stale-while-revalidate: return stale now, refresh in background
        logCall(channel, 'cache-stale', 0)
        tryServerReadWithRetry(serverFn).then(result => {
          cacheSet(channel, result)
          emitCacheRefresh(channel)
        }).catch((error) => {
          if (isTransientGatewayError(error?.status)) {
            noteReadFailure(channel, error, 'transient-gateway-stale-refresh', t0)
          }
        })
        return cached
      }

      // No cache ??try server (skip if known offline)
      if (_serverOnline || !localFn) {
        // Request deduplication: if same request already in flight, wait for it instead of re-requesting
        if (hasReusableInflight(channel)) {
          if (localFn) {
            return raceServerReadWithLocalFallback(channel, _inflight[channel], localFn, t0)
          }
          logCall(channel, 'cache-dedup', Date.now() - t0)
          return _inflight[channel]
        }

        const promise = tryServerReadWithRetry(serverFn).then(result => {
          cacheSet(channel, result)
          setServerHealth(true)
          logCall(channel, 'server', Date.now() - t0)
          clearInflight(channel)
          return result
        }).catch(e => {
          clearInflight(channel)
          throw e
        })
        
        _inflight[channel] = promise
        _inflightStartedAt[channel] = Date.now()
        
        if (localFn) {
          const localPromise = Promise.resolve()
            .then(() => localFn())
            .then((result) => {
              if (hasUsableLocalData(result)) {
                cacheSet(channel, result)
              }
              return result
            })
            .catch(() => null)
          let fallbackTimer: number | null = null
          const localFallbackPromise = new Promise<RaceReadResult>((resolve) => {
            fallbackTimer = window.setTimeout(async () => {
              const localResult = await localPromise
              if (hasUsableLocalData(localResult)) {
                resolve({ source: 'local', data: localResult })
                return
              }
              resolve({ source: 'local', data: null })
            }, SYNC.READ_LOCAL_FALLBACK_MS)
          })

          try {
            const winner = await Promise.race<RaceReadResult>([
              promise.then((result) => ({ source: 'server', data: result })),
              localFallbackPromise,
            ])
            if (fallbackTimer != null) {
              window.clearTimeout(fallbackTimer)
            }

            if (winner?.source === 'local' && winner.data !== null) {
              logCall(channel, 'local-fast', Date.now() - t0)
              promise
                .then(() => emitCacheRefresh(channel))
                .catch(() => {})
              return winner.data
            }

            return winner?.data ?? await promise
          } catch (e: any) {
            if (fallbackTimer != null) {
              window.clearTimeout(fallbackTimer)
            }
            if (isApiVersionMismatchError(e)) {
              logCall(channel, 'api-version-mismatch', Date.now() - t0, false)
              throw e
            }
            if (isInvalidSessionError(e)) {
              logCall(channel, 'auth-required', Date.now() - t0, false)
              throw e
            }
            const localResult = await localPromise
            if (hasUsableLocalData(localResult)) {
              if (isTransientGatewayError(e?.status)) {
                noteReadFailure(channel, e, 'transient-gateway-local-recovery', t0)
              }
              logCall(channel, 'local-recovery', Date.now() - t0)
              promise
                .then(() => emitCacheRefresh(channel))
                .catch(() => {})
              return localResult
            }
            noteReadFailure(channel, e, 'local-fallback', t0)
          }
        } else {
          try {
            return await promise
          } catch (e) {
            if (isApiVersionMismatchError(e)) {
              logCall(channel, 'api-version-mismatch', Date.now() - t0, false)
              throw e
            }
            if (isInvalidSessionError(e)) {
              logCall(channel, 'auth-required', Date.now() - t0, false)
              throw e
            }
            noteReadFailure(channel, e, 'local-fallback', t0)
          }
        }
      }
    }

    // Local fallback
    if (localFn) {
      return resolveLocalRead(channel, localFn)
    }

    return null
  }

  // ?€?€ Writes ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
  if (!syncServerUrl) {
    const message = 'Server is not connected. Changes are invalid until a live server is configured.'
    logCall(channel, 'local-write-skipped', 0, false)
    dispatchWriteBlocked(channel, message, {
      reason: 'server_not_configured',
      serverOnline: false,
      serverConfigured: false,
    })
    throw createWriteBlockedError(channel, message, {
      reason: 'server_not_configured',
      serverOnline: false,
      serverConfigured: false,
    })
  }

  if (!_serverOnline && typeof navigator !== 'undefined' && navigator.onLine === false) {
    const message = 'Server is offline. Changes are invalid until the server reconnects.'
    logCall(channel, 'server-offline-write-blocked', 0, false)
    dispatchWriteBlocked(channel, message, {
      reason: 'server_offline',
      serverOnline: false,
      serverConfigured: true,
    })
    throw createWriteBlockedError(channel, message, {
      reason: 'server_offline',
      serverOnline: false,
      serverConfigured: true,
    })
  }

  try {
    // Do not let a stale failed health probe block real user actions. Tunnel
    // edge hiccups can mark the browser offline for a few seconds even though
    // the next write would succeed; try the write and let the request result
    // decide whether the operation is valid.
    const result = await serverFn()
    cacheInvalidate(channel.split(':')[0])
    setServerHealth(true)
    logCall(channel, 'server', Date.now() - t0)
    return result
  } catch (e: any) {
    const ms = Date.now() - t0
    if (isConnectivityError(e)) {
      setServerHealth(false)
      if (isTransientGatewayError(e?.status)) {
        dispatchTransientGatewayOutage(channel, e, true)
      }
      const message = 'Server is offline. Changes are invalid until the server reconnects.'
      logCall(channel, 'server', ms, false)
      dispatchWriteBlocked(channel, message, {
        reason: 'server_unreachable',
        serverOnline: false,
        serverConfigured: true,
        status: Number(e?.status || 0) || null,
      })
      throw createWriteBlockedError(channel, message, {
        reason: 'server_unreachable',
        serverOnline: false,
        serverConfigured: true,
        status: Number(e?.status || 0) || null,
      })
    }
    logCall(channel, 'server', ms, false)
    if (isWriteConflictError(e)) {
      const refreshChannels = getConflictRefreshChannels(e, channel)
      refreshChannels.forEach((refreshChannel) => cacheInvalidate(refreshChannel))
      dispatchGlobalDataRefresh(refreshChannels)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('sync:conflict', {
          detail: {
            channel,
            entity: e.entity || null,
            reason: e.reason || null,
            message: e.message || 'This item changed on another device. Refresh and try again.',
            expectedUpdatedAt: e.expectedUpdatedAt || null,
            actualUpdatedAt: e.actualUpdatedAt || null,
            current: e.current || null,
            attempted: e.attempted || null,
            refreshChannels,
            ts: new Date().toISOString(),
          },
        }))
      }
      throw e
    }
    if (isInvalidSessionError(e)) {
      throw e
    }
    window.dispatchEvent(new CustomEvent('sync:error', {
      detail: { channel, error: e.message, ts: new Date().toISOString() },
    }))
    throw e
  }
}
