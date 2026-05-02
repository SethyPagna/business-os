/**
 * api/http.js ??HTTP client for the sync server.
 *
 * Provides:
 *   apiFetch(method, path, body)  ??typed JSON fetch with auth header and timeout
 *   isNetErr(err)                 ??classify network errors (vs server errors)
 *   readCache / writeCache        ??short-lived in-memory read cache (20 s TTL)
 *   route(channel, serverFn, localFn, isWrite) ??smart dispatcher used by every api/* module
 *
 * Consumers import from this file; they never access syncServerUrl directly.
 * Call setSyncServerUrl() and setSyncToken() from AppContext or web-api bootstrap.
 */

import { SYNC } from '../constants.js'
import { getClientMetaHeaders as sharedGetClientMetaHeaders } from '../utils/deviceInfo.js'

// ??? Mutable connection state (module-level, intentionally not React state) ???
let syncServerUrl = ''
let syncToken     = ''
let authSessionToken = ''
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

export function getSyncServerUrl() { return syncServerUrl }
export function getSyncToken()     { return syncToken }
export function getAuthSessionToken() { return authSessionToken }

export function setSyncServerUrl(url) { syncServerUrl = (url || '').trim().replace(/\/$/, '') }
export function setSyncToken(token)   { syncToken = (token || '').trim() }
export function setAuthSessionToken(token) { authSessionToken = (token || '').trim() }

function hydrateAuthTokenFromStorage() {
  if (authSessionToken || typeof window === 'undefined') return authSessionToken
  try {
    authSessionToken = sessionStorage.getItem('businessos_auth_token')
      || localStorage.getItem('businessos_auth_token')
      || ''
  } catch (_) {
    authSessionToken = ''
  }
  return authSessionToken
}

function readAuthTokenFromStorage() {
  if (typeof window === 'undefined') return ''
  try {
    return sessionStorage.getItem('businessos_auth_token')
      || localStorage.getItem('businessos_auth_token')
      || ''
  } catch (_) {
    return ''
  }
}

// ??? In-memory read cache with request deduplication ????????????????????????
const _cache      = {}
const _inflight   = {}  // Track in-flight requests to dedupe
const _inflightStartedAt = {}
const _writeInflight = new Map()
const _apiMismatchCooldown = new Map()
const CACHE_TTL   = 20_000   // 20 seconds
const INFLIGHT_REUSE_WINDOW_MS = Math.max(SYNC.REQUEST_TIMEOUT_MS || 15_000, 15_000)
const WRITE_INFLIGHT_REUSE_WINDOW_MS = Math.max(SYNC.REQUEST_TIMEOUT_MS || 15_000, 15_000)
const API_MISMATCH_COOLDOWN_MS = 30_000
export const FRONTEND_BUILD_INFO = {
  hash: typeof __FRONTEND_BUILD_HASH__ !== 'undefined' ? String(__FRONTEND_BUILD_HASH__ || '') : 'dev',
  revision: typeof __FRONTEND_BUILD_REVISION__ !== 'undefined' ? String(__FRONTEND_BUILD_REVISION__ || '') : 'dev',
}

const REQUIRED_RUNTIME_API_PATTERNS = [
  /^\/api\/products\/search(?:\?|$)/,
  /^\/api\/products\/filters(?:\?|$)/,
  /^\/api\/inventory\/products\/search(?:\?|$)/,
  /^\/api\/portal\/catalog\/products\/search(?:\?|$)/,
]

function normalizeApiPath(path) {
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

export function isRequiredRuntimeApiPath(path) {
  const normalized = normalizeApiPath(path)
  return REQUIRED_RUNTIME_API_PATTERNS.some((pattern) => pattern.test(normalized))
}

function getApiMismatchKey(path) {
  return normalizeApiPath(path).split('?')[0]
}

export function getApiVersionMismatchCooldown(path) {
  const key = getApiMismatchKey(path)
  const record = _apiMismatchCooldown.get(key)
  if (!record) return null
  if (Date.now() > record.until) {
    _apiMismatchCooldown.delete(key)
    return null
  }
  return record.error
}

function dispatchApiVersionMismatch(error) {
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

export function createApiVersionMismatchError(path, status = 404) {
  const normalizedPath = getApiMismatchKey(path)
  const error = new Error('Business OS server update is required. The app is using newer catalog APIs than the running server provides.')
  error.status = status
  error.code = 'api_version_mismatch'
  error.path = normalizedPath
  error.reason = 'missing_required_api'
  error.frontend = FRONTEND_BUILD_INFO
  return error
}

export function isApiVersionMismatchError(error) {
  return !!(error && (error.code === 'api_version_mismatch' || error.reason === 'missing_required_api'))
}

export function markApiVersionMismatch(path, status = 404) {
  const error = createApiVersionMismatchError(path, status)
  _apiMismatchCooldown.set(getApiMismatchKey(path), {
    error,
    until: Date.now() + API_MISMATCH_COOLDOWN_MS,
  })
  dispatchApiVersionMismatch(error)
  return error
}

export function cacheGet(key) {
  const e = _cache[key]
  return (e && Date.now() - e.ts < CACHE_TTL) ? e.data : null
}
export function cacheSet(key, data)  { _cache[key] = { data, ts: Date.now() } }
export function cacheInvalidate(prefix) {
  Object.keys(_cache).forEach(k => { if (k.startsWith(prefix)) delete _cache[k] })
}
export function cacheClearAll() {
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
    const detail = event?.detail || {}
    if (detail.reason === 'cache-refresh') return
    const channel = getChannelRefreshKey(detail.channel || '')
    if (!channel || channel === 'all' || channel === 'runtime') {
      cacheClearAll()
      return
    }
    cacheInvalidate(channel)
  })
}

// ??? Logging ring buffer ??????????????????????????????????????????????????????
let callLog      = []
const MAX_LOG    = 300

function logCall(channel, source, ms, ok = true) {
  callLog.unshift({ ts: new Date().toISOString(), channel, source, ms, ok })
  if (callLog.length > MAX_LOG) callLog.pop()
}

export function getCallLog()  { return [...callLog] }
export function clearCallLog() { callLog = [] }

function getClientMetaHeaders() {
  return sharedGetClientMetaHeaders()
}

function createApiError(status, parsed, text) {
  const error = new Error(parsed?.error || text || `HTTP ${status}`)
  error.status = status
  error.code = parsed?.code || null
  error.conflict = !!parsed?.conflict || parsed?.code === 'write_conflict'
  error.entity = parsed?.entity || null
  error.reason = parsed?.reason || null
  error.current = parsed?.current || null
  error.expectedUpdatedAt = parsed?.expectedUpdatedAt || null
  error.actualUpdatedAt = parsed?.actualUpdatedAt || null
  return error
}

export function shouldCompareRuntimeVersions(serverRuntime = {}, frontendBuildInfo = FRONTEND_BUILD_INFO) {
  const servedFrontend = serverRuntime?.frontend || {}
  const servedFrontendRevision = String(servedFrontend.revision || '').trim()
  const servedFrontendHash = String(servedFrontend.hash || '').trim()
  const frontendRevision = String(FRONTEND_BUILD_INFO.revision || '').trim()
  const frontendHash = String(frontendBuildInfo.hash || FRONTEND_BUILD_INFO.hash || '').trim()
  const effectiveFrontendRevision = String(frontendBuildInfo.revision || frontendRevision || '').trim()
  if (!servedFrontendRevision && !servedFrontendHash) return false
  if (!effectiveFrontendRevision || !servedFrontendRevision) return false
  if (effectiveFrontendRevision === 'dev' || servedFrontendRevision === 'dev') return false
  if (servedFrontendHash && frontendHash && servedFrontendHash !== frontendHash) return true
  return effectiveFrontendRevision !== servedFrontendRevision
}

function dispatchRuntimeVersionMismatch(serverRuntime = {}) {
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

function checkRuntimeVersionFromHealth(payload = {}) {
  const serverRuntime = payload?.runtime || {}
  if (shouldCompareRuntimeVersions(serverRuntime)) {
    dispatchRuntimeVersionMismatch(serverRuntime)
  }
}

function createWriteBlockedError(channel, message, detail = {}) {
  const error = new Error(message)
  error.code = 'write_requires_live_server'
  error.channel = channel
  error.reason = detail.reason || 'server_unavailable'
  error.serverOnline = detail.serverOnline !== false
  error.serverConfigured = detail.serverConfigured !== false
  return error
}

function dispatchWriteBlocked(channel, message, detail = {}) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('sync:write-blocked', {
    detail: {
      channel,
      error: message,
      reason: detail.reason || 'server_unavailable',
      serverOnline: detail.serverOnline !== false,
      serverConfigured: detail.serverConfigured !== false,
      ts: new Date().toISOString(),
    },
  }))
}

export function isWriteConflictError(error) {
  return !!(error && (error.conflict || error.code === 'write_conflict'))
}

export function isWriteBlockedError(error) {
  return !!(error && error.code === 'write_requires_live_server')
}

export function isInvalidSessionError(error) {
  return !!(error && (error.code === 'invalid_session' || (Number(error.status) === 401 && /sign in again|invalid session/i.test(String(error.message || '')))))
}

export function requireLiveServerWrite(channel, options = {}) {
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

  if (!_serverOnline) {
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

function getConflictRefreshChannels(error, fallbackChannel) {
  const entity = String(error?.entity || '').trim().toLowerCase()
  if (entity === 'settings') return ['settings']
  if (entity === 'sale') return ['sales', 'returns', 'inventory', 'dashboard']
  if (entity === 'return') return ['returns', 'sales', 'inventory', 'dashboard']
  if (entity === 'ai_provider_config') return ['settings']
  return [getChannelRefreshKey(fallbackChannel)]
}

function dispatchGlobalDataRefresh(channels = RECONNECT_REFRESH_CHANNELS) {
  if (typeof window === 'undefined') return
  ;(Array.isArray(channels) ? channels : RECONNECT_REFRESH_CHANNELS).forEach((channel) => {
    window.dispatchEvent(new CustomEvent('sync:update', {
      detail: { channel, ts: Date.now() },
    }))
  })
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function hasUsableLocalData(value) {
  if (value == null) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
}

async function tryServerReadWithRetry(serverFn) {
  try {
    return await serverFn()
  } catch (error) {
    if (!isConnectivityError(error)) throw error
    await sleep(SYNC.READ_SERVER_RETRY_DELAY_MS)
    return serverFn()
  }
}

async function resolveLocalRead(channel, localFn, source = 'local') {
  const localResult = await localFn()
  cacheSet(channel, localResult)
  logCall(channel, source, 0)
  return localResult
}

function stableStringifyForDedupe(value) {
  if (value === undefined) return ''
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringifyForDedupe).join(',')}]`
  const keys = Object.keys(value)
    .filter(key => !['client_request_id', 'clientRequestId', 'request_id', 'idempotency_key'].includes(key))
    .sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringifyForDedupe(value[key])}`).join(',')}}`
}

function clampDedupeBody(value) {
  const bodyKey = stableStringifyForDedupe(value)
  if (bodyKey.length <= 20_000) return bodyKey
  return `${bodyKey.slice(0, 20_000)}:${bodyKey.length}`
}

export function buildApiRequestDedupeKey(method, path, body) {
  const verb = String(method || 'GET').toUpperCase()
  if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS') return ''
  return `${verb} ${String(path || '')} ${clampDedupeBody(body)}`
}

export function __resetApiWriteDedupeForTests() {
  _writeInflight.clear()
}

// HTTP helpers ?????????????????????????????????????????????????????????????
export async function apiFetch(method, path, body, timeoutMs = SYNC.REQUEST_TIMEOUT_MS, options = {}) {
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

  const requestPromise = (async () => {
  const base    = syncServerUrl.replace(/\/$/, '')
  const headers = { 'Content-Type': 'application/json', 'bypass-tunnel-reminder': 'true', ...getClientMetaHeaders() }
  if (syncToken) headers['x-sync-token'] = syncToken
  hydrateAuthTokenFromStorage()
  const requestAuthSessionToken = authSessionToken
  if (requestAuthSessionToken) headers['x-auth-session'] = requestAuthSessionToken

  const ctrl  = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, timeoutMs)

  try {
    const res = await fetch(`${base}${path}`, {
      method: normalizedMethod,
      headers,
      body:   body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const parsed = (() => { try { return JSON.parse(text) } catch { return null } })()
      if (res.status === 404 && normalizedMethod === 'GET' && isRequiredRuntimeApiPath(path)) {
        throw markApiVersionMismatch(path, res.status)
      }
      const msg  = parsed?.error || text
      const apiError = createApiError(res.status, parsed, text)
      if (res.status === 401 && parsed?.code === 'invalid_session' && requestAuthSessionToken && typeof window !== 'undefined') {
        const latestInMemoryToken = authSessionToken
        const storedToken = readAuthTokenFromStorage()
        const canRetryWithCurrentToken = latestInMemoryToken && latestInMemoryToken !== requestAuthSessionToken
        if (canRetryWithCurrentToken) {
          return apiFetch(normalizedMethod, path, body, timeoutMs, { skipWriteDedupe: true })
        }
        const canRetryWithStoredToken = storedToken && storedToken !== requestAuthSessionToken
        if (canRetryWithStoredToken) {
          authSessionToken = storedToken
          return apiFetch(normalizedMethod, path, body, timeoutMs, { skipWriteDedupe: true })
        }
        if (authSessionToken === requestAuthSessionToken) {
          authSessionToken = ''
        }
        window.dispatchEvent(new CustomEvent('auth:unauthorized', {
          detail: {
            code: parsed.code,
            error: parsed.error || 'Please sign in again to continue.',
            token: requestAuthSessionToken,
          },
        }))
      }
      throw apiError || new Error(msg || `HTTP ${res.status}`)
    }
    return res.json()
  } catch (e) {
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

export function isNetErr(e) {
  const m = e?.message || ''
  return ['Failed to fetch', 'Load failed', 'NetworkError', 'ECONNREFUSED', 'abort', 'network', 'timed out']
    .some(s => m.toLowerCase().includes(s.toLowerCase()))
}

function isConnectivityError(error) {
  if (!error) return false
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

// ??? Server health state ?????????????????????????????????????????????????????
let _serverOnline = true          // optimistic until proven otherwise
let _healthTimer  = null

export function isServerOnline() { return _serverOnline }

function setServerHealth(online) {
  if (online === _serverOnline) return
  _serverOnline = online
  window.dispatchEvent(new CustomEvent('server:health', { detail: { online } }))
  if (online) {
    // Server just came back ??clear all caches so fresh data is fetched
    cacheClearAll()
    dispatchGlobalDataRefresh()
    window.dispatchEvent(new CustomEvent('sync:reconnected'))
  }
}

async function pingServerHealth() {
  if (!syncServerUrl) return
  try {
    const res = await fetch(`${syncServerUrl}/health`, {
      signal: AbortSignal.timeout(4000),
      headers: { 'bypass-tunnel-reminder': 'true' },
    })
    if (res.ok) {
      const payload = await res.clone().json().catch(() => null)
      if (payload) checkRuntimeVersionFromHealth(payload)
      if (!_serverOnline) {
        cacheClearAll()
      }
      setServerHealth(true)
      return
    }
    setServerHealth(false)
  } catch {
    setServerHealth(false)
  }
}

// Active health check ??runs every 12 s when a server is configured.
// Also re-attempts the server for reads when it was previously marked offline,
// ensuring recovery after a server restart without requiring a user login.
export function startHealthCheck() {
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

// ??? Stale-while-revalidate cache (extended TTL for offline resilience) ????
const STALE_TTL   = 45_000    // 45 s ??serve stale while revalidating (was 5 min; reduced so a
                               // server restart clears stale data quickly without blanking the UI)
const FRESH_TTL   = CACHE_TTL // 20 s ??treat as fresh, skip server

export function cacheGetStale(key) {
  const e = _cache[key]
  if (!e) return { data: null, stale: false }
  const age = Date.now() - e.ts
  if (age < FRESH_TTL) return { data: e.data, stale: false }
  if (age < STALE_TTL) return { data: e.data, stale: true  }
  return { data: null, stale: false }
}

function getChannelRefreshKey(channel) {
  return String(channel || '').split(':')[0] || channel
}

function emitCacheRefresh(channel) {
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

function clearInflight(channel) {
  delete _inflight[channel]
  delete _inflightStartedAt[channel]
}

function hasReusableInflight(channel) {
  if (!_inflight[channel]) return false
  const startedAt = _inflightStartedAt[channel] || 0
  if (startedAt && Date.now() - startedAt > INFLIGHT_REUSE_WINDOW_MS) {
    clearInflight(channel)
    return false
  }
  return true
}

async function raceServerReadWithLocalFallback(channel, inflightPromise, localFn, t0, sourceLabel = 'cache-dedup') {
  const localPromise = Promise.resolve()
    .then(() => localFn())
    .then((result) => {
      if (hasUsableLocalData(result)) {
        cacheSet(channel, result)
      }
      return result
    })
    .catch(() => null)

  let fallbackTimer = null
  const localFallbackPromise = new Promise((resolve) => {
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
      inflightPromise.then((result) => ({ source: 'server', data: result })),
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
  } catch (error) {
    if (fallbackTimer != null) {
      window.clearTimeout(fallbackTimer)
    }
    const localResult = await localPromise
    if (hasUsableLocalData(localResult)) {
      logCall(channel, `${sourceLabel}-local-recovery`, Date.now() - t0)
      inflightPromise
        .then((result) => {
          cacheSet(channel, result)
          emitCacheRefresh(channel)
        })
        .catch(() => {})
      return localResult
    }
    throw error
  }
}

// ??? Smart dispatcher ?????????????????????????????????????????????????????????
/**
 * route() ??unified read/write dispatcher with:
 *   - Stale-while-revalidate: serve cached data immediately, refresh in background
 *   - Writes fail closed when the live server is unavailable
 *   - Cache tag invalidation: invalidate whole entity groups instantly
 *   - Active health awareness: skips server call if known offline
 */
export async function route(channel, serverFn, localFn, isWrite = false) {
  const t0 = Date.now()

  // ?? Reads ???????????????????????????????????????????????????????????????????
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
        }).catch(() => {})
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
          let fallbackTimer = null
          const localFallbackPromise = new Promise((resolve) => {
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
          } catch (e) {
            if (fallbackTimer != null) {
              window.clearTimeout(fallbackTimer)
            }
            if (isApiVersionMismatchError(e)) {
              logCall(channel, 'api-version-mismatch', Date.now() - t0, false)
              throw e
            }
            const localResult = await localPromise
            if (hasUsableLocalData(localResult)) {
              logCall(channel, 'local-recovery', Date.now() - t0)
              promise
                .then(() => emitCacheRefresh(channel))
                .catch(() => {})
              return localResult
            }
            if (isConnectivityError(e)) setServerHealth(false)
            logCall(channel, 'local-fallback', Date.now() - t0, false)
          }
        } else {
          try {
            return await promise
          } catch (e) {
            if (isApiVersionMismatchError(e)) {
              logCall(channel, 'api-version-mismatch', Date.now() - t0, false)
              throw e
            }
            if (isConnectivityError(e)) setServerHealth(false)
            logCall(channel, 'local-fallback', Date.now() - t0, false)
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

  // ?? Writes ??????????????????????????????????????????????????????????????????
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

  if (!_serverOnline) {
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
    const result = await serverFn()
    cacheInvalidate(channel.split(':')[0])
    setServerHealth(true)
    logCall(channel, 'server', Date.now() - t0)
    return result
  } catch (e) {
    const ms = Date.now() - t0
    if (isConnectivityError(e)) {
      setServerHealth(false)
      const message = 'Server is offline. Changes are invalid until the server reconnects.'
      logCall(channel, 'server', ms, false)
      dispatchWriteBlocked(channel, message, {
        reason: 'server_unreachable',
        serverOnline: false,
        serverConfigured: true,
      })
      throw createWriteBlockedError(channel, message, {
        reason: 'server_unreachable',
        serverOnline: false,
        serverConfigured: true,
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
