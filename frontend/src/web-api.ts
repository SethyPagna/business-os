import { currentUploadAuthority, getCurrentAssetBase, setCurrentAssetBase } from './utils/uploadUrlKernel.ts'
/**
 * web-api.ts - Browser API bootstrap.
 *
 * FIX: window.api is now installed SYNCHRONOUSLY via static imports.
 * The original used a dynamic import() which is async ??this caused
 * AppContext's polling loop to sometimes run before window.api existed,
 * leaving the app stuck on the loading screen.
 *
 * Architecture:
 *   api/http.ts      - apiFetch, route(), read cache
 *   api/websocket.ts - WebSocket connection manager
 *   api/localDb.ts   - Dexie (IndexedDB) schema + helpers
 *   api/methods.ts   - all domain API methods
 */

import { setSyncServerUrl, setSyncToken, getSyncServerUrl, getCallLog, clearCallLog, startHealthCheck, cacheClearAll, pingServerHealth } from './api/http.ts'
import { disconnectWS, isWSConnected, resumeWS, scheduleConnectWS } from './api/websocket.ts'
import {
  dispatchSyncUpdates,
  emitSyncQueueChanged,
  FOREGROUND_RESUME_SYNC_UPDATE_CHANNELS,
  hasStoredUserSession,
} from './api/syncRuntime.ts'
import { STORAGE_KEYS }            from './constants.ts'
import { FOREGROUND_RESUME_GAP_REASON, FOREGROUND_RESUME_REASON } from './utils/permissionRefreshAccumulator.ts'
import { sanitizeSyncServerUrl }   from './platform/runtime/clientRuntime.ts'
import {
  shouldSuppressRuntimeError,
  shouldSuppressSecurityPolicyViolation,
} from './runtime/runtimeErrorClassifier'

type AnyRecord = Record<string, any>
type LazyApiMethod = (...args: any[]) => Promise<any>
type MethodsModule = Record<string, (...args: any[]) => any>
type AppBootstrapModule = typeof import('./api/appBootstrapTransport.ts')
type AuthTransportModule = typeof import('./api/authTransport.ts')
type PortalTransportModule = typeof import('./api/portalTransport.ts')
type SystemRuntimeModule = typeof import('./api/systemRuntime.ts')
type NotificationSummaryModule = typeof import('./api/notificationSummary.ts')
type SettingsTransportModule = typeof import('./api/settingsTransport.ts')
type ProductReadTransportModule = typeof import('./api/productReadTransport.ts')
type ProductWriteTransportModule = typeof import('./api/productWriteTransport.ts')
type LookupTransportModule = typeof import('./api/lookupTransport.ts')
type BranchTransportModule = typeof import('./api/branchTransport.ts')
type UserReadTransportModule = typeof import('./api/userReadTransport.ts')
type ActionHistoryTransportModule = typeof import('./api/actionHistoryTransport.ts')
type NotesTransportModule = typeof import('./api/notesTransport.ts')
type ProductQueryParams = Parameters<ProductReadTransportModule['searchProducts']>[0]
type OfflineVaultKey = CryptoKey | null
const BOOTSTRAP_STORAGE_MAINTENANCE_DELAY_MS = 2200
const BOOTSTRAP_STORAGE_MAINTENANCE_IDLE_TIMEOUT_MS = 9000
const BOOTSTRAP_OFFLINE_DB_WRITE_DELAY_MS = 45_000
const BOOTSTRAP_OFFLINE_DB_WRITE_IDLE_TIMEOUT_MS = 60_000
const OFFLINE_VAULT_IDLE_LOCK_MS = 15 * 60_000
const FOREGROUND_REFRESH_AFTER_MS = 45_000
const FOREGROUND_RECOVERY_THROTTLE_MS = 1500
let offlineVaultKey: OfflineVaultKey = null
let offlineVaultUnlockedAt = 0
let offlineVaultIdleTimer: number | null = null
let sessionRecoveryListenersRegistered = false
let backgroundedAt = 0
// Last time the sync socket was seen closing. A resume compares it with
// backgroundedAt: a socket that stayed open delivered every push.
let syncSocketDroppedAt = 0
let lastForegroundRecoveryAt = 0
let deferredForegroundRecoveryTimer = 0
let methodsModulePromise: Promise<MethodsModule> | null = null
let appBootstrapModulePromise: Promise<AppBootstrapModule> | null = null
let authTransportModulePromise: Promise<AuthTransportModule> | null = null
let portalTransportModulePromise: Promise<PortalTransportModule> | null = null
let systemRuntimeModulePromise: Promise<SystemRuntimeModule> | null = null
let notificationSummaryModulePromise: Promise<NotificationSummaryModule> | null = null
let settingsTransportModulePromise: Promise<SettingsTransportModule> | null = null
let productReadTransportModulePromise: Promise<ProductReadTransportModule> | null = null
let productWriteTransportModulePromise: Promise<ProductWriteTransportModule> | null = null
let lookupTransportModulePromise: Promise<LookupTransportModule> | null = null
let branchTransportModulePromise: Promise<BranchTransportModule> | null = null
let notesTransportModulePromise: Promise<NotesTransportModule> | null = null
let userReadTransportModulePromise: Promise<UserReadTransportModule> | null = null
let actionHistoryTransportModulePromise: Promise<ActionHistoryTransportModule> | null = null
let localDbPromise: Promise<any> | null = null
const lazyApiMethodCache = new Map<string, LazyApiMethod>()

function isPublicRuntimePath(): boolean {
  if (typeof location === 'undefined') return false
  const pathname = String(location.pathname || '').toLowerCase()
  const hostname = String(location.hostname || '').toLowerCase()
  const publicRoot = hostname
    && hostname !== 'localhost'
    && hostname !== '127.0.0.1'
    && hostname !== '::1'
    && !hostname.startsWith('admin.')
  return (publicRoot && pathname === '/') || pathname === '/public' || pathname.startsWith('/public/')
}

function getOfflineDb(): Promise<any> {
  if (!localDbPromise) localDbPromise = import('./api/localDb.ts').then((module) => module.dexieDb as any)
  return localDbPromise
}

function loadMethodsModule(): Promise<MethodsModule> {
  if (!methodsModulePromise) methodsModulePromise = import('./api/methods.ts')
  return methodsModulePromise
}

function loadAppBootstrapModule(): Promise<AppBootstrapModule> {
  if (!appBootstrapModulePromise) appBootstrapModulePromise = import('./api/appBootstrapTransport.ts')
  return appBootstrapModulePromise
}

function loadAuthTransportModule(): Promise<AuthTransportModule> {
  if (!authTransportModulePromise) authTransportModulePromise = import('./api/authTransport.ts')
  return authTransportModulePromise
}

function loadPortalTransportModule(): Promise<PortalTransportModule> {
  if (!portalTransportModulePromise) portalTransportModulePromise = import('./api/portalTransport.ts')
  return portalTransportModulePromise
}

function loadSystemRuntimeModule(): Promise<SystemRuntimeModule> {
  if (!systemRuntimeModulePromise) systemRuntimeModulePromise = import('./api/systemRuntime.ts')
  return systemRuntimeModulePromise
}

function loadNotificationSummaryModule(): Promise<NotificationSummaryModule> {
  if (!notificationSummaryModulePromise) notificationSummaryModulePromise = import('./api/notificationSummary.ts')
  return notificationSummaryModulePromise
}

function loadSettingsTransportModule(): Promise<SettingsTransportModule> {
  if (!settingsTransportModulePromise) settingsTransportModulePromise = import('./api/settingsTransport.ts')
  return settingsTransportModulePromise
}

function loadProductReadTransportModule(): Promise<ProductReadTransportModule> {
  if (!productReadTransportModulePromise) productReadTransportModulePromise = import('./api/productReadTransport.ts')
  return productReadTransportModulePromise
}

function loadProductWriteTransportModule(): Promise<ProductWriteTransportModule> {
  if (!productWriteTransportModulePromise) productWriteTransportModulePromise = import('./api/productWriteTransport.ts')
  return productWriteTransportModulePromise
}

function loadLookupTransportModule(): Promise<LookupTransportModule> {
  if (!lookupTransportModulePromise) lookupTransportModulePromise = import('./api/lookupTransport.ts')
  return lookupTransportModulePromise
}

function loadBranchTransportModule(): Promise<BranchTransportModule> {
  if (!branchTransportModulePromise) branchTransportModulePromise = import('./api/branchTransport.ts')
  return branchTransportModulePromise
}

function loadNotesTransportModule(): Promise<NotesTransportModule> {
  if (!notesTransportModulePromise) notesTransportModulePromise = import('./api/notesTransport.ts')
  return notesTransportModulePromise
}

function loadUserReadTransportModule(): Promise<UserReadTransportModule> {
  if (!userReadTransportModulePromise) userReadTransportModulePromise = import('./api/userReadTransport.ts')
  return userReadTransportModulePromise
}

function loadActionHistoryTransportModule(): Promise<ActionHistoryTransportModule> {
  if (!actionHistoryTransportModulePromise) actionHistoryTransportModulePromise = import('./api/actionHistoryTransport.ts')
  return actionHistoryTransportModulePromise
}

function getAuthTransportMethod<T extends keyof AuthTransportModule>(name: T): (...args: any[]) => Promise<any> {
  return (...args) =>
    loadAuthTransportModule().then((module) => {
      const fn = module?.[name]
      if (typeof fn !== 'function') {
        throw new Error(`window.api.${String(name)} is not available.`)
      }
      return (fn as (...methodArgs: any[]) => Promise<any>)(...args)
    })
}

function getPortalTransportMethod<T extends keyof PortalTransportModule>(name: T): (...args: any[]) => Promise<any> {
  return (...args) =>
    loadPortalTransportModule().then((module) => {
      const fn = module?.[name]
      if (typeof fn !== 'function') {
        throw new Error(`window.api.${String(name)} is not available.`)
      }
      return (fn as (...methodArgs: any[]) => Promise<any>)(...args)
    })
}

function getSystemRuntimeMethod<T extends keyof SystemRuntimeModule>(name: T): (...args: any[]) => Promise<any> {
  return (...args) =>
    loadSystemRuntimeModule().then((module) => {
      const fn = module?.[name]
      if (typeof fn !== 'function') {
        throw new Error(`window.api.${String(name)} is not available.`)
      }
      return (fn as (...methodArgs: any[]) => Promise<any>)(...args)
    })
}

function getLazyApiMethod(name: string): LazyApiMethod {
  if (!lazyApiMethodCache.has(name)) {
    lazyApiMethodCache.set(name, (...args) =>
      loadMethodsModule().then((module) => {
        const fn = module?.[name]
        if (typeof fn !== 'function') {
          throw new Error(`window.api.${name} is not available.`)
        }
        return fn(...args)
      }))
  }
  return lazyApiMethodCache.get(name) as LazyApiMethod
}

async function requestOfflinePersistentStorage(): Promise<{ supported: boolean; persistent: boolean; estimate?: StorageEstimate | null }> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return { supported: false, persistent: false }
  const persistent = await navigator.storage.persist().catch(() => false)
  const estimate = await navigator.storage.estimate?.().catch(() => null)
  return { supported: true, persistent: !!persistent, estimate }
}

function dispatchVaultLocked(reason = 'idle'): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('offline:vault-locked', { detail: { reason, ts: Date.now() } }))
}

function lockOfflineVault(reason = 'manual'): void {
  offlineVaultKey = null
  offlineVaultUnlockedAt = 0
  if (typeof window !== 'undefined' && offlineVaultIdleTimer != null) window.clearTimeout(offlineVaultIdleTimer)
  offlineVaultIdleTimer = null
  dispatchVaultLocked(reason)
}

// F1 (27 Sep 2026): there is no background "offline maintenance" loop any more.
// Offline selling is cancelled (owner, 26 Sep): the loop's snapshot refresh
// made eleven serial GETs every five minutes and again on every online/focus/
// visibility/pageshow/reconnect, and localMirrors.ts discards every one of
// them on an http(s) origin, so it was pure Worker and D1 load. Its second job,
// the service-worker update check, is index.tsx's watchForNewAppShell alone
// (interval, visibility, focus, back/forward-cache pageshow, online and
// sync:reconnected) -- one checker, so a long-lived till tab still sees the
// "Restart now" bar. The loop never drained queued sales either. The one-time
// drain is the MANUAL review path:
// retryPendingSyncNow -> syncPendingSalesQueue({ manualRecovery: true }) in
// pendingSyncTransport.ts / saleWriteTransport.ts, started from the App banner
// and the Server page. Keep it until every device has upgraded. The service
// worker does not drain: its sync / BUSINESS_OS_SYNC_NOW handlers run
// syncOutboxOnce, which answers manual_recovery_required and replays nothing.
function ensureSessionRecoveryListeners(): void {
  if (typeof window === 'undefined' || sessionRecoveryListenersRegistered) return
  sessionRecoveryListenersRegistered = true

  window.addEventListener('sync:status', (event: Event) => {
    if ((event as CustomEvent<{ connected?: boolean }>).detail?.connected !== true) syncSocketDroppedAt = Date.now()
  })

  const recoverForegroundSession = (reason: string, force = false, refreshData = false, hiddenSince = 0): boolean => {
    if (!hasStoredUserSession()) return false
    const now = Date.now()
    const elapsedSinceRecovery = now - lastForegroundRecoveryAt
    if (elapsedSinceRecovery < FOREGROUND_RECOVERY_THROTTLE_MS) {
      // iOS commonly emits online/focus/visibility/pageshow as one burst. Do
      // not let an early lightweight event suppress the stronger BFCache or
      // long-background refresh that follows milliseconds later.
      if (refreshData) {
        if (deferredForegroundRecoveryTimer) window.clearTimeout(deferredForegroundRecoveryTimer)
        deferredForegroundRecoveryTimer = window.setTimeout(() => {
          deferredForegroundRecoveryTimer = 0
          recoverForegroundSession(reason, true, true, hiddenSince)
          backgroundedAt = 0
        }, Math.max(0, FOREGROUND_RECOVERY_THROTTLE_MS - elapsedSinceRecovery + 20))
      }
      return false
    }
    lastForegroundRecoveryAt = now
    resumeWS()
    startHealthCheck()
    pingServerHealth(force).catch(() => {})
    if (refreshData) {
      // After resumeWS(): a stale socket it just replaced counts as a drop.
      const socketStayedOpen = hiddenSince > 0 && isWSConnected() && syncSocketDroppedAt < hiddenSince
      dispatchSyncUpdates(
        FOREGROUND_RESUME_SYNC_UPDATE_CHANNELS,
        socketStayedOpen ? FOREGROUND_RESUME_REASON : FOREGROUND_RESUME_GAP_REASON,
        { trigger: reason },
      )
    }
    return true
  }

  const recoverAfterBackground = (reason: string, persisted = false) => {
    const elapsed = backgroundedAt > 0 ? Date.now() - backgroundedAt : 0
    const needsFullRefresh = persisted || elapsed >= FOREGROUND_REFRESH_AFTER_MS
    // A back/forward-cache restore froze the socket with the page.
    const hiddenSince = persisted ? 0 : backgroundedAt
    const recovered = recoverForegroundSession(reason, needsFullRefresh, needsFullRefresh, hiddenSince)
    if (recovered || !needsFullRefresh) backgroundedAt = 0
  }

  window.addEventListener('online', () => {
    recoverForegroundSession('network-online', true, false)
  })
  window.addEventListener('focus', () => {
    recoverAfterBackground('window-focus')
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      backgroundedAt = Date.now()
      return
    }
    recoverAfterBackground('visibility-resume')
  })
  window.addEventListener('pagehide', () => {
    backgroundedAt = Date.now()
  })
  window.addEventListener('pageshow', (event) => {
    recoverAfterBackground('pageshow-resume', Boolean((event as PageTransitionEvent).persisted))
  })
}

function scheduleBootstrapStorageMaintenance(task: () => void): void {
  if (typeof window === 'undefined') {
    task()
    return
  }

  const run = () => {
    window.setTimeout(() => {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(task, { timeout: BOOTSTRAP_STORAGE_MAINTENANCE_IDLE_TIMEOUT_MS })
        return
      }
      task()
    }, BOOTSTRAP_STORAGE_MAINTENANCE_DELAY_MS)
  }

  if (document.readyState === 'complete') {
    run()
    return
  }
  window.addEventListener('load', run, { once: true })
}

function scheduleBootstrapOfflineDbWrite(task: (db: any) => void | Promise<void>): void {
  if (typeof window === 'undefined') {
    getOfflineDb().then(task).catch(() => {})
    return
  }

  const run = () => {
    window.setTimeout(() => {
      const write = () => {
        if (document.visibilityState === 'hidden') return
        getOfflineDb().then(task).catch(() => {})
      }
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(write, { timeout: BOOTSTRAP_OFFLINE_DB_WRITE_IDLE_TIMEOUT_MS })
        return
      }
      write()
    }, BOOTSTRAP_OFFLINE_DB_WRITE_DELAY_MS)
  }

  if (document.readyState === 'complete') {
    run()
    return
  }
  window.addEventListener('load', run, { once: true })
}

function forwardServiceWorkerOutboxEvent(event: MessageEvent): void {
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
    dispatchSyncUpdates(['sales', 'products', 'inventory', 'dashboard'], 'offline-background-sale-synced')
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

  emitSyncQueueChanged({
    reason: detail.reason || 'background-sync-waiting',
    error: detail.error || '',
    ts: detail.ts || Date.now(),
  })
}

// ?€?€ Silence Capacitor/vendor bridge noise that fires in plain web context ?€?€?€?€?€?€
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

// ---- Synchronous window.api installation ----
// The service worker's 'message' listener below is attached at module load,
// unconditionally -- so the underlying BUSINESS_OS_APP_UPDATE_AVAILABLE
// postMessage is never missed at the browser API level. But the re-dispatched
// 'sync:app-update-available' window CustomEvent IS a fire-and-forget signal,
// and the only consumer (App.tsx's useSyncStatus effect) only attaches its
// listener while a user is logged in. If the SW activates a new version while
// the tab is sitting on the login screen (or between logout and the next
// login), the event fires into a void with no listener, and the "Update Now"
// banner would silently never appear -- the user keeps running the stale
// in-memory JS bundle indefinitely even though the SW has already claimed the
// page under the new version. Buffer the most recent detail here so any
// consumer that mounts later (e.g. right after login) can pick up a
// already-fired update instead of losing it.
let pendingAppUpdateDetail: Record<string, unknown> | null = null

function forwardServiceWorkerAppEvent(event: MessageEvent): void {
  if (typeof window === 'undefined') return
  if (event?.data?.type !== 'BUSINESS_OS_APP_UPDATE_AVAILABLE') return
  const detail = event?.data?.detail || {}
  pendingAppUpdateDetail = detail
  window.dispatchEvent(new CustomEvent('sync:app-update-available', { detail }))
}

const staticApi = {
  login: getAuthTransportMethod('login'),
  logout: getAuthTransportMethod('logout'),
  resetPasswordWithOtp: getAuthTransportMethod('resetPasswordWithOtp'),
  requestPasswordResetEmail: getAuthTransportMethod('requestPasswordResetEmail'),
  completePasswordReset: getAuthTransportMethod('completePasswordReset'),
  updateSessionDuration: getAuthTransportMethod('updateSessionDuration'),
  getVerificationCapabilities: getAuthTransportMethod('getVerificationCapabilities'),
  otpSetup: getAuthTransportMethod('otpSetup'),
  otpConfirm: getAuthTransportMethod('otpConfirm'),
  otpDisable: getAuthTransportMethod('otpDisable'),
  otpRecoveryReset: getAuthTransportMethod('otpRecoveryReset'),
  otpVerify: getAuthTransportMethod('otpVerify'),
  otpStatus: getAuthTransportMethod('otpStatus'),
  startGoogleOauth: getAuthTransportMethod('startGoogleOauth'),
  completeGoogleOauth: getAuthTransportMethod('completeGoogleOauth'),
  unlinkGoogleOauth: getAuthTransportMethod('unlinkGoogleOauth'),
  getOrganizationBootstrap: getAuthTransportMethod('getOrganizationBootstrap'),
  searchOrganizations: getAuthTransportMethod('searchOrganizations'),
  getCurrentOrganization: getAuthTransportMethod('getCurrentOrganization'),
  getPortalConfig: getPortalTransportMethod('getPortalConfig'),
  getPortalBootstrap: getPortalTransportMethod('getPortalBootstrap'),
  getPortalCatalogMeta: getPortalTransportMethod('getPortalCatalogMeta'),
  getPortalCatalogProducts: getPortalTransportMethod('getPortalCatalogProducts'),
  searchPortalCatalogProducts: getPortalTransportMethod('searchPortalCatalogProducts'),
  lookupPortalMembership: getPortalTransportMethod('lookupPortalMembership'),
  createPortalSubmission: getPortalTransportMethod('createPortalSubmission'),
  getPortalAiStatus: getPortalTransportMethod('getPortalAiStatus'),
  askPortalAi: getPortalTransportMethod('askPortalAi'),
  getPortalSubmissionsForReview: getPortalTransportMethod('getPortalSubmissionsForReview'),
  reviewPortalSubmission: getPortalTransportMethod('reviewPortalSubmission'),
  getSystemConfig: getSystemRuntimeMethod('getSystemConfig'),
  getSystemBootstrap: getSystemRuntimeMethod('getSystemBootstrap'),
  getSystemDebugLog: getSystemRuntimeMethod('getSystemDebugLog'),
  testSyncServer: getSystemRuntimeMethod('testSyncServer'),

  setSyncServerUrl(url: unknown) {
    const clean = sanitizeSyncServerUrl(url)
    const previousSyncServerUrl = getSyncServerUrl()
    const syncServerChanged = previousSyncServerUrl !== clean
    setSyncServerUrl(clean)
    if (clean) {
      if (syncServerChanged) {
        scheduleBootstrapOfflineDbWrite((db) => db.settings.put({ key: 'sync_server_url', value: clean }))
        cacheClearAll()   // flush stale in-memory cache whenever the server URL changes
      }
      if (hasStoredUserSession()) {
        ensureSessionRecoveryListeners()
        scheduleConnectWS()
        startHealthCheck()
      }
    } else {
      if (syncServerChanged) {
        scheduleBootstrapOfflineDbWrite((db) => db.settings.delete('sync_server_url'))
        disconnectWS()
      }
    }
  },

  getSyncServerUrl() {
    return getSyncServerUrl()
  },

  setPublicAssetBaseUrl(url: unknown) {
    return setCurrentAssetBase(url, getSyncServerUrl() || currentUploadAuthority())
  },

  getPublicAssetBaseUrl() {
    return getCurrentAssetBase(getSyncServerUrl() || currentUploadAuthority())
  },
  async getAppBootstrap() {
    const module = await loadAppBootstrapModule()
    return module.getAppBootstrap()
  },

  async getNotificationSummary() {
    const module = await loadNotificationSummaryModule()
    return module.getNotificationSummary()
  },

  // Synchronous, not async: this reads an in-memory buffer, not IndexedDB, so
  // there is no reason to make callers await a microtask for it. See the
  // pendingAppUpdateDetail comment above forwardServiceWorkerAppEvent for why
  // this buffer exists.
  getPendingAppUpdate() {
    return pendingAppUpdateDetail
  },

  clearPendingAppUpdate() {
    pendingAppUpdateDetail = null
  },

  async getPendingSyncState() {
    const module = await import('./api/pendingSyncTransport.ts')
    return module.getPendingSyncState()
  },

  async retryPendingSyncNow(reviewToken?: string) {
    const module = await import('./api/pendingSyncTransport.ts')
    return module.retryPendingSyncNow(reviewToken)
  },

  async discardPendingSyncQueue(reason?: string, reviewToken?: string) {
    const module = await import('./api/pendingSyncTransport.ts')
    return module.discardPendingSyncQueue(reason, reviewToken)
  },

  async getSettings(options: unknown = {}) {
    const module = await loadSettingsTransportModule()
    return module.getSettings(options as Record<string, unknown>)
  },

  async saveSettings(updates: unknown = {}, options: unknown = {}) {
    const module = await loadSettingsTransportModule()
    return module.saveSettings(updates as Record<string, unknown>, options as Record<string, unknown>)
  },

  async getProducts() {
    const module = await loadProductReadTransportModule()
    return module.getProducts()
  },

  async searchProducts(params: unknown = {}) {
    const module = await loadProductReadTransportModule()
    return module.searchProducts(params as ProductQueryParams)
  },

  async getProductBootstrap(params: unknown = {}) {
    const module = await loadProductReadTransportModule()
    return module.getProductBootstrap(params as ProductQueryParams)
  },

  async getProductsByIds(ids: unknown[] = [], params: unknown = {}) {
    const module = await loadProductReadTransportModule()
    return module.getProductsByIds(ids, params as ProductQueryParams)
  },

  async getProductFilters(params: unknown = {}) {
    const module = await loadProductReadTransportModule()
    return module.getProductFilters(params as ProductQueryParams)
  },

  async getProductLookupUsage() {
    const module = await loadProductReadTransportModule()
    return module.getProductLookupUsage()
  },

  async createProduct(payload: unknown = {}) {
    const module = await loadProductWriteTransportModule()
    return module.createProduct(payload as Record<string, unknown>)
  },

  async updateProduct(id: unknown, payload: unknown = {}) {
    const module = await loadProductWriteTransportModule()
    return module.updateProduct(id as string | number, payload as Record<string, unknown>)
  },

  async deleteProduct(id: unknown) {
    const module = await loadProductWriteTransportModule()
    return module.deleteProduct(id as string | number)
  },

  async createProductVariant(payload: unknown = {}) {
    const module = await loadProductWriteTransportModule()
    return module.createProductVariant(payload as Record<string, unknown>)
  },

  async bulkImportProducts(payload: unknown = {}) {
    const module = await loadProductWriteTransportModule()
    return module.bulkImportProducts(payload as Record<string, unknown>)
  },

  async getCategories() {
    const module = await loadLookupTransportModule()
    return module.getCategories()
  },

  async getUnits() {
    const module = await loadLookupTransportModule()
    return module.getUnits()
  },

  async getBranches() {
    const module = await loadBranchTransportModule()
    return module.getBranches()
  },

  async getNotes() {
    const module = await loadNotesTransportModule()
    return module.getNotes()
  },

  async createNote(payload: unknown = {}) {
    const module = await loadNotesTransportModule()
    return module.createNote(payload as Parameters<NotesTransportModule['createNote']>[0])
  },

  async updateNote(id: unknown, payload: unknown = {}) {
    const module = await loadNotesTransportModule()
    return module.updateNote(id as number, payload as Parameters<NotesTransportModule['updateNote']>[1])
  },

  async deleteNote(id: unknown) {
    const module = await loadNotesTransportModule()
    return module.deleteNote(id as number)
  },

  async getUsers() {
    const module = await loadUserReadTransportModule()
    return module.getUsers()
  },

  async getActionHistory(scope: unknown = 'global', limit: unknown = 10, params: unknown = {}) {
    const module = await loadActionHistoryTransportModule()
    return module.getActionHistory(
      scope as string | number,
      limit as string | number,
      params as Parameters<ActionHistoryTransportModule['getActionHistory']>[2],
    )
  },

  async getActionHistoryUsers() {
    const module = await loadActionHistoryTransportModule()
    return module.getActionHistoryUsers()
  },

  async createActionHistory(payload: unknown = {}) {
    const module = await loadActionHistoryTransportModule()
    return module.createActionHistory(payload as Record<string, unknown>)
  },

  async updateActionHistory(id: unknown, payload: unknown = {}) {
    const module = await loadActionHistoryTransportModule()
    return module.updateActionHistory(id as string | number, payload as Record<string, unknown>)
  },

  async undoActionHistory(id: unknown) {
    const module = await loadActionHistoryTransportModule()
    return module.undoActionHistory(id as string | number)
  },

  async redoActionHistory(id: unknown) {
    const module = await loadActionHistoryTransportModule()
    return module.redoActionHistory(id as string | number)
  },

  setSyncToken(token: unknown) {
    const clean = String(token || '').trim()
    setSyncToken('')
    try {
      localStorage.removeItem(STORAGE_KEYS.SYNC_TOKEN)
      sessionStorage.removeItem('businessos_sync_token_session')
    } catch (_) {}
    getOfflineDb().then((db) => db.settings.delete('sync_token')).catch(() => {})
    if (clean) {
      console.warn('[web-api] Sync token support has been retired in favor of user sign-in sessions.')
    }
  },

  useSessionSyncToken(token: unknown) {
    staticApi.setSyncToken(token)
  },

  ensureSessionRecoveryListeners,

  lockOfflineVault,
  getOfflineVaultState() {
    return {
      unlocked: !!offlineVaultKey,
      unlockedAt: offlineVaultUnlockedAt,
      idleLockMs: OFFLINE_VAULT_IDLE_LOCK_MS,
    }
  },
  requestOfflinePersistentStorage,
  getCallLog,
  clearCallLog,
}

window.api = new Proxy(staticApi, {
  get(target, prop, receiver) {
    if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver)
    if (typeof prop !== 'string') return undefined
    return getLazyApiMethod(prop)
  },
})

if (typeof window !== 'undefined') {
  navigator.serviceWorker?.addEventListener?.('message', forwardServiceWorkerOutboxEvent)
  navigator.serviceWorker?.addEventListener?.('message', forwardServiceWorkerAppEvent)
  window.addEventListener('beforeunload', () => lockOfflineVault('tab_close'))
}

// ---- Bootstrap: read stored token, auto-detect server URL from page origin ----
// KEY FIX: When not in Vite dev mode the page is served BY the Cloudflare
// Worker (cloudflare/ -- there is no separate backend process anymore), so
// the current origin is always the correct API/WS server, regardless of any
// stale URL that may be saved in localStorage from a previous session or a
// different device (e.g. localhost saved when first run locally, but accessed
// via Cloudflare on another device). We use the current origin immediately,
// then persist it after first paint so storage writes do not compete with
// startup.
;(async () => {
  try {
    const isViteDev = location.hostname === 'localhost' &&
      (location.port === '5173' || location.port === '5174')
    const skipOfflineBootstrapDb = isPublicRuntimePath()

    scheduleBootstrapStorageMaintenance(() => {
      try {
        localStorage.removeItem('businessos_auth_token')
        sessionStorage.removeItem('businessos_auth_token')
        localStorage.removeItem(STORAGE_KEYS.SYNC_TOKEN)
        sessionStorage.removeItem('businessos_sync_token_session')
      } catch (_) {}
    })
    if (!skipOfflineBootstrapDb) {
      scheduleBootstrapOfflineDbWrite((db) => db.settings.delete('sync_token'))
    }

    // Determine the correct sync server URL
    let url = ''
    if (!isViteDev) {
      // Served by the Cloudflare Worker -- current origin IS the server. Always use it.
      url = sanitizeSyncServerUrl(location.origin)
      scheduleBootstrapStorageMaintenance(() => {
        try { localStorage.setItem(STORAGE_KEYS.SYNC_SERVER, url) } catch (_) {}
      })
      if (!skipOfflineBootstrapDb) {
        scheduleBootstrapOfflineDbWrite((db) => db.settings.put({ key: 'sync_server_url', value: url }))
      }
    } else {
      // Vite dev -- use stored value (localhost:8787 for wrangler local
      // dev), falling back to the PRODUCTION admin origin (user, Part 388:
      // "default leangbeauty.com and admin.leangbeauty.com") so a fresh
      // checkout talks to the real server until someone points it
      // elsewhere on the Server page.
      url = sanitizeSyncServerUrl(localStorage.getItem(STORAGE_KEYS.SYNC_SERVER) || '')
      if (!skipOfflineBootstrapDb) {
        try {
          const db = await getOfflineDb()
          const stored = await db.settings.bulkGet(['sync_server_url'])
          if (!url && stored[0]?.value) url = sanitizeSyncServerUrl(stored[0].value)
        } catch (_) {}
      }
      if (!url) url = sanitizeSyncServerUrl('https://admin.leangbeauty.com')
    }

    if (url) {
      setSyncServerUrl(url)
      if (hasStoredUserSession()) {
        ensureSessionRecoveryListeners()
        scheduleConnectWS()
        startHealthCheck()
      }
    }
  } catch (e: any) {
    console.warn('[web-api] Bootstrap error:', e.message)
  }
})()
