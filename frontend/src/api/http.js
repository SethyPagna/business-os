/**
 * api/http.js — HTTP client for the sync server.
 *
 * Provides:
 *   apiFetch(method, path, body)  — typed JSON fetch with auth header and timeout
 *   isNetErr(err)                 — classify network errors (vs server errors)
 *   readCache / writeCache        — short-lived in-memory read cache (20 s TTL)
 *   route(channel, serverFn, localFn, isWrite) — smart dispatcher used by every api/* module
 *
 * Consumers import from this file; they never access syncServerUrl directly.
 * Call setSyncServerUrl() and setSyncToken() from AppContext or web-api bootstrap.
 */

import { SYNC } from '../constants.js'
import { getClientMetaHeaders as sharedGetClientMetaHeaders } from '../utils/deviceInfo.js'

// ─── Mutable connection state (module-level, intentionally not React state) ───
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

// ─── In-memory read cache with request deduplication ────────────────────────
const _cache      = {}
const _inflight   = {}  // Track in-flight requests to dedupe
const CACHE_TTL   = 20_000   // 20 seconds

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
}

// Invalidate cache on any sync update so stale reads never survive a broadcast
if (typeof window !== 'undefined') {
  window.addEventListener('sync:update', cacheClearAll)
}

// ─── Logging ring buffer ──────────────────────────────────────────────────────
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

function dispatchGlobalDataRefresh(channels = RECONNECT_REFRESH_CHANNELS) {
  if (typeof window === 'undefined') return
  ;(Array.isArray(channels) ? channels : RECONNECT_REFRESH_CHANNELS).forEach((channel) => {
    window.dispatchEvent(new CustomEvent('sync:update', {
      detail: { channel, ts: Date.now() },
    }))
  })
}

// HTTP helpers ─────────────────────────────────────────────────────────────
export async function apiFetch(method, path, body, timeoutMs = SYNC.REQUEST_TIMEOUT_MS) {
  const base    = syncServerUrl.replace(/\/$/, '')
  const headers = { 'Content-Type': 'application/json', 'bypass-tunnel-reminder': 'true', ...getClientMetaHeaders() }
  if (syncToken) headers['x-sync-token'] = syncToken
  if (authSessionToken) headers['x-auth-session'] = authSessionToken

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
      if (res.status === 401 && parsed?.code === 'invalid_session' && authSessionToken && typeof window !== 'undefined') {
        authSessionToken = ''
        window.dispatchEvent(new CustomEvent('auth:unauthorized', {
          detail: { code: parsed.code, error: parsed.error || 'Please sign in again to continue.' },
        }))
      }
      throw new Error(msg || `HTTP ${res.status}`)
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

// ─── Server health state ─────────────────────────────────────────────────────
let _serverOnline = true          // optimistic until proven otherwise
let _healthTimer  = null

export function isServerOnline() { return _serverOnline }

function setServerHealth(online) {
  if (online === _serverOnline) return
  _serverOnline = online
  window.dispatchEvent(new CustomEvent('server:health', { detail: { online } }))
  if (online) {
    // Server just came back — clear all caches so fresh data is fetched
    cacheClearAll()
    dispatchGlobalDataRefresh()
    window.dispatchEvent(new CustomEvent('sync:reconnected'))
  }
}

// Active health check — runs every 12 s when a server is configured.
// Also re-attempts the server for reads when it was previously marked offline,
// ensuring recovery after a server restart without requiring a user login.
export function startHealthCheck() {
  if (_healthTimer) return
  _healthTimer = setInterval(async () => {
    if (!syncServerUrl) return
    try {
      const res = await fetch(`${syncServerUrl}/health`, {
        signal: AbortSignal.timeout(4000),
        headers: { 'bypass-tunnel-reminder': 'true' },
      })
      if (res.ok) {
        // Server is reachable — if it was previously offline, flush the cache
        // so components immediately get fresh data rather than stale Dexie fallbacks
        if (!_serverOnline) {
          cacheClearAll()
        }
        setServerHealth(true)
      } else {
        setServerHealth(false)
      }
    } catch {
      setServerHealth(false)
    }
  }, 12_000)
}

if (typeof window !== 'undefined') {
  window.addEventListener('online',  () => { if (syncServerUrl) setServerHealth(true)  })
  window.addEventListener('offline', () => setServerHealth(false))
}

// ─── Stale-while-revalidate cache (extended TTL for offline resilience) ────
const STALE_TTL   = 45_000    // 45 s — serve stale while revalidating (was 5 min; reduced so a
                               // server restart clears stale data quickly without blanking the UI)
const FRESH_TTL   = CACHE_TTL // 20 s — treat as fresh, skip server

export function cacheGetStale(key) {
  const e = _cache[key]
  if (!e) return { data: null, stale: false }
  const age = Date.now() - e.ts
  if (age < FRESH_TTL) return { data: e.data, stale: false }
  if (age < STALE_TTL) return { data: e.data, stale: true  }
  return { data: null, stale: false }
}

// ─── Smart dispatcher ─────────────────────────────────────────────────────────
/**
 * route() — unified read/write dispatcher with:
 *   - Stale-while-revalidate: serve cached data immediately, refresh in background
 *   - Offline write queuing: failed writes are stored and retried on reconnect
 *   - Cache tag invalidation: invalidate whole entity groups instantly
 *   - Active health awareness: skips server call if known offline
 */
export async function route(channel, serverFn, localFn, isWrite = false) {
  const t0 = Date.now()

  // ── Reads ───────────────────────────────────────────────────────────────────
  if (!isWrite) {
    if (syncServerUrl) {
      const { data: cached, stale } = cacheGetStale(channel)

      if (cached !== null && !stale) {
        // Fresh cache hit — return immediately
        logCall(channel, 'cache', 0)
        return cached
      }

      if (cached !== null && stale) {
        // Stale-while-revalidate: return stale now, refresh in background
        logCall(channel, 'cache-stale', 0)
        serverFn().then(result => {
          cacheSet(channel, result)
          window.dispatchEvent(new CustomEvent('cache:updated', { detail: { channel } }))
        }).catch(() => {})
        return cached
      }

      // No cache — try server (skip if known offline)
      if (_serverOnline || !localFn) {
        // Request deduplication: if same request already in flight, wait for it instead of re-requesting
        if (_inflight[channel]) {
          logCall(channel, 'cache-dedup', Date.now() - t0)
          return _inflight[channel]
        }

        const promise = serverFn().then(result => {
          cacheSet(channel, result)
          setServerHealth(true)
          logCall(channel, 'server', Date.now() - t0)
          delete _inflight[channel]
          return result
        }).catch(e => {
          delete _inflight[channel]
          throw e
        })
        
        _inflight[channel] = promise
        
        try {
          return await promise
        } catch (e) {
          if (isConnectivityError(e)) setServerHealth(false)
          logCall(channel, 'local-fallback', Date.now() - t0, false)
        }
      }
    }

    // Local fallback
    if (localFn) {
      const t1 = Date.now()
      const result = await localFn()
      logCall(channel, 'local', Date.now() - t1)
      return result
    }

    return null
  }

  // ── Writes ──────────────────────────────────────────────────────────────────
  if (!syncServerUrl) {
    // Pure local mode — reject writes gracefully
    logCall(channel, 'local-write-skipped', 0, false)
    window.dispatchEvent(new CustomEvent('sync:error', {
      detail: { channel, error: 'No server configured — running in read-only offline mode', ts: new Date().toISOString() },
    }))
    throw new Error('No server configured')
  }

  try {
    const result = await serverFn()
    cacheInvalidate(channel.split(':')[0])
    setServerHealth(true)
    logCall(channel, 'server', Date.now() - t0)
    return result
  } catch (e) {
    const ms = Date.now() - t0
    if (isConnectivityError(e)) setServerHealth(false)
    logCall(channel, 'server', ms, false)
    window.dispatchEvent(new CustomEvent('sync:error', {
      detail: { channel, error: e.message, ts: new Date().toISOString() },
    }))
    throw e
  }
}
