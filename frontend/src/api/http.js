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
const CACHE_TTL   = 20_000   // 20 seconds
const INFLIGHT_REUSE_WINDOW_MS = 900

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
}

// Invalidate cache on any sync update so stale reads never survive a broadcast
if (typeof window !== 'undefined') {
  window.addEventListener('sync:update', cacheClearAll)
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

// HTTP helpers ?????????????????????????????????????????????????????????????
export async function apiFetch(method, path, body, timeoutMs = SYNC.REQUEST_TIMEOUT_MS) {
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
      method,
      headers,
      body:   body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const parsed = (() => { try { return JSON.parse(text) } catch { return null } })()
      const msg  = parsed?.error || text
      const apiError = createApiError(res.status, parsed, text)
      if (res.status === 401 && parsed?.code === 'invalid_session' && requestAuthSessionToken && typeof window !== 'undefined') {
        const latestInMemoryToken = authSessionToken
        const storedToken = readAuthTokenFromStorage()
        const canRetryWithCurrentToken = latestInMemoryToken && latestInMemoryToken !== requestAuthSessionToken
        if (canRetryWithCurrentToken) {
          return apiFetch(method, path, body, timeoutMs)
        }
        const canRetryWithStoredToken = storedToken && storedToken !== requestAuthSessionToken
        if (canRetryWithStoredToken) {
          authSessionToken = storedToken
          return apiFetch(method, path, body, timeoutMs)
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
    detail: { channel: refreshKey, ts: Date.now() },
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
    window.dispatchEvent(new CustomEvent('sync:error', {
      detail: { channel, error: e.message, ts: new Date().toISOString() },
    }))
    throw e
  }
}
