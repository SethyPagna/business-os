/**
 * api/websocket.ts - WebSocket connection lifecycle.
 *
 * Maintains a single persistent WS connection to the sync server.
 * Dispatches CustomEvents that AppContext and components listen to:
 *   sync:update  { channel }
 *   sync:status  { connected: boolean }
 */

import { SYNC } from '../constants.ts'
import { getSyncServerUrl } from './http.ts'

let ws: WebSocket | null = null
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null
let wsPingTimer: ReturnType<typeof setInterval> | null = null
let reconnectAttempts = 0
let wsFailureStreak = 0
let wsSuppressReconnectUntil = 0
let wsIntentionalClose = false
let wsLifecycleListenersRegistered = false
let wsDeferredConnectTimer: ReturnType<typeof setTimeout> | null = null
let wsLastPongAt = 0

const WS_BOOT_CONNECT_DELAY_MS = 1200
const WS_PING_INTERVAL_MS = 25_000
const WS_PONG_TIMEOUT_MS = 55_000

function clearReconnectTimer(): void {
  if (!wsReconnectTimer) return
  clearTimeout(wsReconnectTimer)
  wsReconnectTimer = null
}

function clearPingTimer(): void {
  if (!wsPingTimer) return
  clearInterval(wsPingTimer)
  wsPingTimer = null
}

function clearDeferredConnectTimer(): void {
  if (!wsDeferredConnectTimer) return
  clearTimeout(wsDeferredConnectTimer)
  wsDeferredConnectTimer = null
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

function shouldDebugWs(): boolean {
  try {
    if (typeof window === 'undefined') return false
    if (window.location.hostname === 'localhost') return true
    return window.localStorage.getItem('businessos_debug_ws') === '1'
  } catch (_) {
    return false
  }
}

function logWs(level: 'debug' | 'warn', ...args: unknown[]): void {
  if (!shouldDebugWs()) return
  const logger = console[level] || console.debug
  logger('[ws]', ...args)
}

export function connectWS(): void {
  ensureWebSocketLifecycleListeners()
  clearDeferredConnectTimer()
  const syncServerUrl = getSyncServerUrl()
  if (!syncServerUrl) return
  if (isProtectedAdminHost() && !hasStoredAuthSession()) return
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  if (Date.now() < wsSuppressReconnectUntil) return
  clearReconnectTimer()

  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return

  const wsUrl = syncServerUrl.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws'

  try {
    logWs('debug', 'attempting connect to', wsUrl)
    wsIntentionalClose = false
    ws = new WebSocket(wsUrl)
  } catch (e) {
    logWs('warn', 'connect error (constructor):', e)
    scheduleReconnect()
    return
  }

  ws.onopen = () => {
    logWs('debug', 'connected')
    const reconnected = reconnectAttempts > 0
    reconnectAttempts = 0
    wsFailureStreak = 0
    wsSuppressReconnectUntil = 0
    wsLastPongAt = Date.now()
    window.dispatchEvent(new CustomEvent('sync:status', { detail: { connected: true } }))
    if (reconnected) {
      window.dispatchEvent(new CustomEvent('sync:reconnected', { detail: { ts: Date.now() } }))
    }
    // Send a ping every 25 s to prevent idle-timeout drops on reverse proxies
    // (Cloudflare Tunnel, Nginx, AWS ALB, etc. typically close idle WS after ~60 s).
    // The backend already handles { type:'ping' } and replies { type:'pong' }.
    clearPingTimer()
    wsPingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        if (Date.now() - wsLastPongAt > WS_PONG_TIMEOUT_MS) {
          // Mobile Safari can resume with a socket that still reports OPEN
          // even though the underlying network path died while suspended.
          // Closing it here drives the normal reconnect/reconciliation path.
          try { ws.close(4000, 'pong-timeout') } catch (_) {}
          return
        }
        ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, WS_PING_INTERVAL_MS)
  }

  ws.onmessage = (event: MessageEvent<string>) => {
    try {
      const data = JSON.parse(event.data) as { type?: string; channel?: string; payload?: { action?: string; id?: string | number } | null }
      if (data.type === 'pong' || data.type === 'connected') wsLastPongAt = Date.now()
      if (data.type === 'sync:update' && data.channel) {
        // `payload` (action/id -- see broadcastHub.ts's own broadcast() calls,
        // e.g. `broadcast(c.env, 'users', { action: 'update', id })`) was
        // parsed off the wire here but never forwarded into the dispatched
        // CustomEvent's detail -- only `channel` was. That silently starved
        // every listener of the one piece of information needed to tell
        // "something on this channel changed" apart from "the specific
        // user/role *I* care about changed" -- see AppContext.tsx's onUpdate,
        // which needs `payload.id` to know whether a live permission edit
        // belongs to the current session's own user/role.
        window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: data.channel, payload: data.payload ?? null } }))
      }
      // pong and connected frames are intentionally ignored
    } catch (_) {}
  }

  ws.onclose = (ev: CloseEvent) => {
    clearPingTimer()
    const code = ev?.code || 0
    const reason = ev?.reason || ''
    logWs('debug', 'disconnected', { code, reason })
    logWs('debug', 'onclose event', ev)
    window.dispatchEvent(new CustomEvent('sync:status', { detail: { connected: false } }))
    ws = null
    wsLastPongAt = 0
    if (wsIntentionalClose) {
      wsIntentionalClose = false
      return
    }
    if (code === 4001) {
      window.dispatchEvent(new CustomEvent('auth:unauthorized', {
        detail: {
          code: 'invalid_session',
          error: reason || 'Please sign in again to continue.',
        },
      }))
      return
    }
    if (code !== 1000) {
      wsFailureStreak = Math.min(10, wsFailureStreak + 1)
      if (wsFailureStreak >= 3) {
        wsSuppressReconnectUntil = Date.now() + 60_000
      }
    }
    if (getSyncServerUrl()) scheduleReconnect()
  }

  ws.onerror = (err: Event) => {
    logWs('warn', 'error', err)
    try { ws?.close() } catch (_) {}
  }
}

export function scheduleConnectWS(delayMs = WS_BOOT_CONNECT_DELAY_MS): void {
  ensureWebSocketLifecycleListeners()
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
  clearDeferredConnectTimer()
  wsDeferredConnectTimer = setTimeout(() => {
    wsDeferredConnectTimer = null
    connectWS()
  }, Math.max(0, delayMs))
}

export function disconnectWS(): void {
  clearDeferredConnectTimer()
  clearReconnectTimer()
  clearPingTimer()
  wsLastPongAt = 0
  if (ws) {
    if (ws.readyState === WebSocket.OPEN) {
      wsIntentionalClose = true
      ws.close(1000, 'manual-reconnect')
    } else if (ws.readyState === WebSocket.CONNECTING) {
      wsIntentionalClose = false
      ws.onerror = null
      ws.onclose = null
      try { ws.close() } catch (_) {}
    } else {
      try { ws.close() } catch (_) {}
    }
    ws = null
  }
  window.dispatchEvent(new CustomEvent('sync:status', { detail: { connected: false } }))
}

export function reconnectWS(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
  connectWS()
}

export function resumeWS(): void {
  wsSuppressReconnectUntil = 0
  reconnectAttempts = 0
  if (ws && ws.readyState === WebSocket.OPEN && wsLastPongAt > 0 && Date.now() - wsLastPongAt > WS_PONG_TIMEOUT_MS) {
    try { ws.close(4000, 'resume-stale-socket') } catch (_) {}
    ws = null
    wsLastPongAt = 0
  }
  reconnectWS()
}

function scheduleReconnect(): void {
  clearReconnectTimer()
  if (Date.now() < wsSuppressReconnectUntil) return
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  // Exponential backoff with jitter to avoid thundering herds and rapid loops
  reconnectAttempts = Math.min(10, reconnectAttempts + 1)
  const base = SYNC.WS_RECONNECT_DELAY_MS || 2000
  const maxDelay = 60_000
  const delay = Math.min(maxDelay, base * Math.pow(1.8, reconnectAttempts))
  // jitter ±20%
  const jitter = Math.floor(delay * (Math.random() * 0.4 - 0.2))
  const finalDelay = Math.max(1000, Math.floor(delay + jitter))
  logWs('debug', 'scheduling reconnect in', finalDelay, 'ms (attempt', reconnectAttempts, ')')
  wsReconnectTimer = setTimeout(connectWS, finalDelay)
}

/** Returns true if the WS is currently OPEN — used by AppContext to initialise
 *  syncConnected correctly without relying on an event that may have already fired. */
export function isWSConnected(): boolean {
  return !!(ws && ws.readyState === WebSocket.OPEN)
}

export function ensureWebSocketLifecycleListeners(): void {
  if (typeof window === 'undefined' || wsLifecycleListenersRegistered || !hasStoredAuthSession()) return
  wsLifecycleListenersRegistered = true
  window.addEventListener('auth:unauthorized', () => {
    wsSuppressReconnectUntil = Date.now() + 60_000
    reconnectAttempts = 0
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      wsIntentionalClose = true
      try { ws.close(1000, 'auth-required') } catch (_) {}
    }
  })
}
