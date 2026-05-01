/**
 * api/websocket.js — WebSocket connection lifecycle.
 *
 * Maintains a single persistent WS connection to the sync server.
 * Dispatches CustomEvents that AppContext and components listen to:
 *   sync:update  { channel }
 *   sync:status  { connected: boolean }
 */

import { SYNC } from '../constants.js'
import { getSyncServerUrl, getAuthSessionToken } from './http.js'

let ws               = null
let wsReconnectTimer = null
let wsPingTimer      = null
let reconnectAttempts = 0
let wsAuthToken = ''

function shouldDebugWs() {
  try {
    if (typeof window === 'undefined') return false
    if (window.location.hostname === 'localhost') return true
    return window.localStorage.getItem('businessos_debug_ws') === '1'
  } catch (_) {
    return false
  }
}

function logWs(level, ...args) {
  if (!shouldDebugWs()) return
  const logger = console[level] || console.debug
  logger('[ws]', ...args)
}

export function connectWS() {
  const syncServerUrl = getSyncServerUrl()
  if (!syncServerUrl) return
  clearTimeout(wsReconnectTimer)

  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return

  const authToken = getAuthSessionToken()
  if (!authToken) return
  wsAuthToken = authToken
  const wsUrl = syncServerUrl.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws'
    + `?token=${encodeURIComponent(authToken)}`

  try {
    logWs('debug', 'attempting connect to', wsUrl)
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
    window.dispatchEvent(new CustomEvent('sync:status', { detail: { connected: true } }))
    if (reconnected) {
      window.dispatchEvent(new CustomEvent('sync:reconnected', { detail: { ts: Date.now() } }))
    }
    // Send a ping every 25 s to prevent idle-timeout drops on reverse proxies
    // (Cloudflare Tunnel, Nginx, AWS ALB, etc. typically close idle WS after ~60 s).
    // The backend already handles { type:'ping' } and replies { type:'pong' }.
    clearInterval(wsPingTimer)
    wsPingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, 25_000)
  }

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      if (data.type === 'sync:update' && data.channel) {
        window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: data.channel } }))
      }
      // pong and connected frames are intentionally ignored
    } catch (_) {}
  }

  ws.onclose = (ev) => {
    clearInterval(wsPingTimer)
    wsPingTimer = null
    const code = ev?.code || 0
    const reason = ev?.reason || ''
    logWs('debug', 'disconnected', { code, reason })
    logWs('debug', 'onclose event', ev)
    window.dispatchEvent(new CustomEvent('sync:status', { detail: { connected: false } }))
    ws = null
    if (code === 4001) {
      // Session-rotation paths (for example changing session duration) revoke the
      // old token before the frontend finishes reconnecting with the newly
      // issued one. Give that handoff a moment before treating 4001 as a real
      // sign-out condition.
      window.setTimeout(() => {
        const latestToken = getAuthSessionToken()
        if (!latestToken) return
        if (latestToken !== wsAuthToken && getSyncServerUrl()) {
          logWs('debug', 'session token rotated; reconnecting websocket with fresh token')
          connectWS()
          return
        }
        window.dispatchEvent(new CustomEvent('auth:unauthorized', {
          detail: {
            code: 'invalid_session',
            error: reason || 'Please sign in again to continue.',
            token: wsAuthToken,
          },
        }))
      }, 1200)
      return
    }
    if (getSyncServerUrl()) scheduleReconnect()
  }

  ws.onerror = (err) => {
    logWs('warn', 'error', err)
    try { ws?.close() } catch (_) {}
  }
}

export function disconnectWS() {
  clearTimeout(wsReconnectTimer)
  clearInterval(wsPingTimer)
  wsPingTimer = null
  wsAuthToken = ''
  if (ws) { ws.onclose = null; ws.close(); ws = null }
  window.dispatchEvent(new CustomEvent('sync:status', { detail: { connected: false } }))
}

export function reconnectWS() {
  disconnectWS()
  connectWS()
}

function scheduleReconnect() {
  clearTimeout(wsReconnectTimer)
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
export function isWSConnected() {
  return !!(ws && ws.readyState === WebSocket.OPEN)
}
