/**
 * web-api.js ??Browser API bootstrap.
 *
 * FIX: window.api is now installed SYNCHRONOUSLY via static imports.
 * The original used a dynamic import() which is async ??this caused
 * AppContext's polling loop to sometimes run before window.api existed,
 * leaving the app stuck on the loading screen.
 *
 * Architecture:
 *   api/http.js      ??apiFetch, route(), read cache
 *   api/websocket.js ??WebSocket connection manager
 *   api/localDb.js   ??Dexie (IndexedDB) schema + helpers
 *   api/methods.js   ??all domain API methods
 */

import { setSyncServerUrl, setSyncToken, setAuthSessionToken, getAuthSessionToken, getCallLog, clearCallLog, startHealthCheck, cacheClearAll } from './api/http.js'
import { connectWS, disconnectWS, reconnectWS } from './api/websocket.js'
import { dexieDb }                 from './api/localDb.js'
import * as methods                from './api/methods.js'
import { STORAGE_KEYS }            from './constants.js'
import { sanitizeSyncServerUrl }   from './platform/runtime/clientRuntime.js'
import {
  shouldSuppressRuntimeError,
  shouldSuppressSecurityPolicyViolation,
} from './runtime/runtimeErrorClassifier.mjs'

const OUTBOX_SYNC_TAG = 'business-os-sync-outbox'
const OFFLINE_AUTH_SESSION_TOKEN_KEY = 'offline_auth_session_token'
const OFFLINE_REFRESH_INTERVAL_MS = 5 * 60_000
const SERVICE_WORKER_UPDATE_INTERVAL_MS = 15 * 60_000
let offlineMaintenanceStarted = false
let lastServiceWorkerUpdateAt = 0

function registerOutboxBackgroundSync() {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return
  navigator.serviceWorker.ready
    .then((registration) => {
      if (registration?.sync?.register) {
        registration.sync.register(OUTBOX_SYNC_TAG).catch(() => {})
      }
      registration?.active?.postMessage({ type: 'BUSINESS_OS_SYNC_NOW' })
    })
    .catch(() => {})
}

function syncBackgroundAuthSessionToken(token) {
  if (typeof window === 'undefined') return
  const clean = String(token || '').trim()
  let persistent = false
  try {
    persistent = !!clean && localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) === clean
  } catch (_) {
    persistent = false
  }
  if (persistent) {
    dexieDb.settings.put({
      key: OFFLINE_AUTH_SESSION_TOKEN_KEY,
      value: clean,
      updated_at: new Date().toISOString(),
    }).then(() => registerOutboxBackgroundSync()).catch(() => {})
  } else {
    dexieDb.settings.delete(OFFLINE_AUTH_SESSION_TOKEN_KEY).catch(() => {})
  }
}

function refreshOfflineSnapshotSoon(force = false) {
  if (typeof window === 'undefined') return
  const run = () => {
    methods.refreshOfflineDeviceSnapshot?.({ force }).catch(() => {})
  }
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(run, { timeout: 5000 })
    return
  }
  window.setTimeout(run, 1500)
}

function refreshServiceWorkerSoon(force = false) {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return
  const now = Date.now()
  if (!force && now - lastServiceWorkerUpdateAt < SERVICE_WORKER_UPDATE_INTERVAL_MS) return
  lastServiceWorkerUpdateAt = now
  navigator.serviceWorker.ready
    .then((registration) => registration.update?.())
    .catch(() => {})
}

function runOfflineMaintenance(force = false) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  methods.retryPendingSyncNow?.().catch(() => {})
  refreshOfflineSnapshotSoon(force)
  registerOutboxBackgroundSync()
  refreshServiceWorkerSoon(force)
}

function startOfflineMaintenanceLoop() {
  if (typeof window === 'undefined' || offlineMaintenanceStarted) return
  offlineMaintenanceStarted = true
  window.setInterval(() => {
    runOfflineMaintenance(false)
  }, OFFLINE_REFRESH_INTERVAL_MS)
}

function forwardServiceWorkerOutboxEvent(event) {
  if (typeof window === 'undefined') return
  const type = event?.data?.type
  const detail = event?.data?.detail || {}
  if (!type || !String(type).startsWith('BUSINESS_OS_OUTBOX_')) return

  if (type === 'BUSINESS_OS_OUTBOX_SYNCED') {
    window.dispatchEvent(new CustomEvent('sync:offline-sale-synced', {
      detail: {
        channel: detail.channel || 'sales:create',
        receiptNumber: detail.entity_name || null,
        ts: detail.ts || Date.now(),
      },
    }))
    ;['sales', 'products', 'inventory', 'dashboard'].forEach((channel) => {
      window.dispatchEvent(new CustomEvent('sync:update', {
        detail: { channel, reason: 'offline-background-sale-synced', ts: Date.now() },
      }))
    })
    return
  }

  if (type === 'BUSINESS_OS_OUTBOX_CONFLICT') {
    window.dispatchEvent(new CustomEvent('sync:write-conflict', {
      detail: {
        channel: detail.channel || 'sales:create',
        entity_name: detail.entity_name || null,
        refreshChannels: ['sales', 'products', 'inventory', 'dashboard'],
        ts: detail.ts || Date.now(),
      },
    }))
    return
  }

  window.dispatchEvent(new CustomEvent('sync:queue-changed', {
    detail: {
      reason: detail.reason || 'background-sync-waiting',
      error: detail.error || '',
      ts: detail.ts || Date.now(),
    },
  }))
}

function getStoredAuthToken() {
  try {
    return sessionStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)
      || localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)
      || ''
  } catch (_) {
    return ''
  }
}

// ?? Silence Capacitor/vendor bridge noise that fires in plain web context ??????
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
    if (shouldSuppressRuntimeError({
      reason: e?.reason,
      message: e?.reason?.message || String(e?.reason || ''),
      stack: e?.reason?.stack,
      baseOrigin: window.location?.origin || '',
    })) {
      e.preventDefault()
      e.stopImmediatePropagation()
    }
  }, true /* capture phase */)

  window.addEventListener('error', (event) => {
    const message = String(event?.message || '')
    const fileName = String(event?.filename || '')
    const stack = String(event?.error?.stack || '')
    if (shouldSuppressRuntimeError({
      message,
      error: event?.error,
      filename: fileName,
      stack,
      baseOrigin: window.location?.origin || '',
    })) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }, true)

  window.addEventListener('securitypolicyviolation', (event) => {
    if (!shouldSuppressSecurityPolicyViolation({
      violatedDirective: event?.violatedDirective,
      blockedURI: event?.blockedURI,
      sourceFile: event?.sourceFile,
      sample: event?.sample,
      baseOrigin: window.location?.origin || '',
    })) return
    event.stopImmediatePropagation()
  }, true)
}

// ?? Synchronous window.api installation ??????????????????????????????????????
window.api = {

  setSyncServerUrl(url) {
    const clean = sanitizeSyncServerUrl(url)
    setSyncServerUrl(clean)
    if (clean) {
      dexieDb.settings.put({ key: 'sync_server_url', value: clean }).catch(() => {})
      cacheClearAll()   // flush stale in-memory cache whenever the server URL changes
      connectWS()
      startHealthCheck()
      runOfflineMaintenance(true)
    } else {
      dexieDb.settings.delete('sync_server_url').catch(() => {})
      disconnectWS()
    }
  },

  setSyncToken(token) {
    const clean = (token || '').trim()
    setSyncToken('')
    try {
      localStorage.removeItem(STORAGE_KEYS.SYNC_TOKEN)
      sessionStorage.removeItem('businessos_sync_token_session')
    } catch (_) {}
    dexieDb.settings.delete('sync_token').catch(() => {})
    if (clean) {
      console.warn('[web-api] Sync token support has been retired in favor of user sign-in sessions.')
    }
  },

  setAuthSessionToken(token) {
    const clean = (token || '').trim()
    setAuthSessionToken(clean)
    syncBackgroundAuthSessionToken(clean)
    disconnectWS()
    if (clean) {
      connectWS()
    }
  },

  useSessionSyncToken(token) {
    window.api.setSyncToken(token)
  },

  ...methods,
  getAuthSessionToken,
  getCallLog,
  clearCallLog,
}

if (typeof window !== 'undefined') {
  navigator.serviceWorker?.addEventListener?.('message', forwardServiceWorkerOutboxEvent)
  window.addEventListener('online', () => {
    if (getAuthSessionToken()) {
      reconnectWS()
    } else {
      connectWS()
    }
    startHealthCheck()
    runOfflineMaintenance(true)
  })
  window.addEventListener('focus', () => {
    if (getAuthSessionToken()) {
      connectWS()
    }
    runOfflineMaintenance()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    if (getAuthSessionToken()) {
      connectWS()
    }
    runOfflineMaintenance()
  })
  window.addEventListener('sync:reconnected', () => {
    runOfflineMaintenance(true)
  })
  startOfflineMaintenanceLoop()
}

// ?? Bootstrap: read stored token, auto-detect server URL from page origin ?????
// KEY FIX: When not in Vite dev mode the page is served BY the backend, so the
// current origin is always the correct API/WS server ??regardless of any stale
// URL that may be saved in localStorage from a previous session or a different
// device (e.g. localhost saved when first run locally, but accessed via Cloudflare
// on another device).  We always overwrite the stored URL with the current origin.
;(async () => {
  try {
    const isViteDev = location.hostname === 'localhost' &&
      (location.port === '5173' || location.port === '5174')

    // Retrieve auth token from storage
    let authToken = getStoredAuthToken()
    if (authToken) setAuthSessionToken(authToken)
    syncBackgroundAuthSessionToken(authToken)
    try {
      localStorage.removeItem(STORAGE_KEYS.SYNC_TOKEN)
      sessionStorage.removeItem('businessos_sync_token_session')
      await dexieDb.settings.delete('sync_token')
    } catch (_) {}

    // Determine the correct sync server URL
    let url
    if (!isViteDev) {
      // Served by the Node backend ??current origin IS the server. Always use it.
      url = sanitizeSyncServerUrl(location.origin)
      try { localStorage.setItem('businessos_sync_server', url) } catch (_) {}
      try { await dexieDb.settings.put({ key: 'sync_server_url', value: url }) } catch (_) {}
    } else {
      // Vite dev ??use stored value (normally points to localhost:4000 backend)
      url = sanitizeSyncServerUrl(localStorage.getItem('businessos_sync_server') || '')
      try {
        const stored = await dexieDb.settings.bulkGet(['sync_server_url'])
        if (!url && stored[0]?.value) url = sanitizeSyncServerUrl(stored[0].value)
      } catch (_) {}
    }

    if (url) {
      setSyncServerUrl(url)
      if (authToken) connectWS()
      startHealthCheck()  // ping every 12 s so offline?nline recovery works
      runOfflineMaintenance()
    }
  } catch (e) {
    console.warn('[web-api] Bootstrap error:', e.message)
  }
})()
