/**
 * web-api.js — Browser API bootstrap.
 *
 * FIX: window.api is now installed SYNCHRONOUSLY via static imports.
 * The original used a dynamic import() which is async — this caused
 * AppContext's polling loop to sometimes run before window.api existed,
 * leaving the app stuck on the loading screen.
 *
 * Architecture:
 *   api/http.js      — apiFetch, route(), read cache
 *   api/websocket.js — WebSocket connection manager
 *   api/localDb.js   — Dexie (IndexedDB) schema + helpers
 *   api/methods.js   — all domain API methods
 */

import { setSyncServerUrl, setSyncToken, getCallLog, clearCallLog, startHealthCheck, cacheClearAll } from './api/http.js'
import { connectWS, disconnectWS } from './api/websocket.js'
import { dexieDb }                 from './api/localDb.js'
import * as methods                from './api/methods.js'

// ── Silence Capacitor/vendor bridge noise that fires in plain web context ──────
// vendor.js emits "No Listener: tabs:outgoing.message.ready" as an unhandled
// rejection when Capacitor's tab-messaging bridge can't find a native listener.
// This is harmless in web-only mode.
//
// CRITICAL: useCapture=true (third arg) makes this handler run BEFORE React's
// scheduler picks up the rejection and tries to call an internal function that
// no longer exists in that error-path, which manifests as
// "TypeError: r is not a function" in minified builds.
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (e) => {
    const msg = e?.reason?.message || String(e?.reason || '')
    if (
      msg.includes('No Listener:') ||
      msg.includes('tabs:outgoing') ||
      msg.includes('capacitor') ||
      msg.includes('plugin_not_implemented')
    ) {
      e.preventDefault()
      e.stopImmediatePropagation()
    }
  }, true /* capture phase */)

  window.addEventListener('error', (event) => {
    const message = String(event?.message || '')
    const fileName = String(event?.filename || '')
    const stack = String(event?.error?.stack || '')
    const isExtensionError = (
      fileName.startsWith('chrome-extension://')
      || fileName.startsWith('moz-extension://')
      || stack.includes('content.js')
      || stack.includes('vendor.js')
    )
    if (!isExtensionError) return
    if (message.includes('No Listener:') || message.includes('cssRules')) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }, true)
}

// ── Synchronous window.api installation ──────────────────────────────────────
window.api = {

  setSyncServerUrl(url) {
    const clean = (url || '').trim().replace(/\/$/, '')
    setSyncServerUrl(clean)
    if (clean) {
      dexieDb.settings.put({ key: 'sync_server_url', value: clean }).catch(() => {})
      cacheClearAll()   // flush stale in-memory cache whenever the server URL changes
      connectWS()
      methods.flushPendingSyncQueue?.().catch(() => {})
      startHealthCheck()
    } else {
      dexieDb.settings.delete('sync_server_url').catch(() => {})
      disconnectWS()
    }
  },

  setSyncToken(token) {
    const clean = (token || '').trim()
    setSyncToken(clean)
    dexieDb.settings.put({ key: 'sync_token', value: clean }).catch(() => {})
    disconnectWS()
    if (clean) connectWS()
  },

  useSessionSyncToken(token) {
    const clean = (token || '').trim()
    setSyncToken(clean)
    disconnectWS()
    if (clean) connectWS()
  },

  ...methods,
  getCallLog,
  clearCallLog,
}

if (typeof window !== 'undefined') {
  window.addEventListener('sync:reconnected', () => {
    methods.flushPendingSyncQueue?.().catch(() => {})
  })
}

// ── Bootstrap: read stored token, auto-detect server URL from page origin ─────
// KEY FIX: When not in Vite dev mode the page is served BY the backend, so the
// current origin is always the correct API/WS server — regardless of any stale
// URL that may be saved in localStorage from a previous session or a different
// device (e.g. localhost saved when first run locally, but accessed via Tailscale
// on another device).  We always overwrite the stored URL with the current origin.
;(async () => {
  try {
    const isViteDev = location.hostname === 'localhost' &&
      (location.port === '5173' || location.port === '5174')

    // Retrieve auth token from storage
    let token = localStorage.getItem('businessos_sync_token') || ''
    try {
      const stored = await dexieDb.settings.bulkGet(['sync_token'])
      if (!token && stored[0]?.value) token = stored[0].value
    } catch (_) {}
    if (token) setSyncToken(token)

    // Determine the correct sync server URL
    let url
    if (!isViteDev) {
      // Served by the Node backend — current origin IS the server. Always use it.
      url = location.origin
      try { localStorage.setItem('businessos_sync_server', url) } catch (_) {}
      try { await dexieDb.settings.put({ key: 'sync_server_url', value: url }) } catch (_) {}
    } else {
      // Vite dev — use stored value (normally points to localhost:4000 backend)
      url = localStorage.getItem('businessos_sync_server') || ''
      try {
        const stored = await dexieDb.settings.bulkGet(['sync_server_url'])
        if (!url && stored[0]?.value) url = stored[0].value
      } catch (_) {}
    }

    if (url) {
      setSyncServerUrl(url)
      connectWS()
      methods.flushPendingSyncQueue?.().catch(() => {})
      startHealthCheck()  // ping every 12 s so offline→online recovery works
    }
  } catch (e) {
    console.warn('[web-api] Bootstrap error:', e.message)
  }
})()
