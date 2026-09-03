import { Component, Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType, ErrorInfo, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import ArrowDown from 'lucide-react/dist/esm/icons/arrow-down.js'
import ArrowUp from 'lucide-react/dist/esm/icons/arrow-up.js'
import Bell from 'lucide-react/dist/esm/icons/bell.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import { useApp as useAppHook } from './AppContext.tsx'
import { NotesProvider } from './components/notes/NotesContext.tsx'
import { APP_NAVIGATION_EVENT, APP_PAGE_INTENT_EVENT, getAdminPageFromPath, getMountedPageLimit, getNotificationColor, getNotificationPrefix, isPublicCatalogPath, MAX_MOUNTED_PAGES, resolveAdminLandingPage, updateMountedPages } from './app/appShellUtils.ts'
import { isPublicDomMutationError, shouldAttemptPublicDomRecovery } from './app/publicErrorRecovery.ts'
import { getScrollTarget, getScrollToPosition } from './components/shared/globalScroll.ts'
import { NAV_ITEMS } from './components/shared/navigationConfig.ts'
import PullToRefreshIndicator from './components/shared/PullToRefreshIndicator.tsx'
import { usePullToRefresh } from './components/shared/usePullToRefresh.ts'
import { STORAGE_KEYS } from './constants.ts'
import { refreshAppData } from './utils/appRefresh.ts'
import { restartIntoLatestApp } from './utils/appUpdate.ts'
import { claimChunkReload, clearChunkReloadMarker } from './utils/chunkReloadGuard.ts'
import { hasDirtyWork } from './utils/dirtyWork.ts'
import { withLoaderTimeout } from './utils/loaders.ts'
import { flushPendingWorkDrafts } from './utils/workDrafts.ts'

declare const __FRONTEND_BUILD_HASH__: string | undefined

type PageId =
  | 'dashboard'
  | 'notes'
  | 'products'
  | 'pos'
  | 'sales'
  | 'branches'
  | 'contacts'
  | 'catalog'
  | 'promotions'
  | 'review'
  | 'receipt_settings'
  | 'settings'
  | 'files'
  | 'server'

type AdminPageId = PageId
type ChunkImporter = () => Promise<{ default: ComponentType<Record<string, unknown>> }>
type CancelWarmup = () => void
type ScrollDirection = 'top' | 'bottom'
type TranslateFn = (key: string) => string

interface NetworkConnectionLike {
  saveData?: boolean
  effectiveType?: string
}

interface NavigatorWithConnection extends Navigator {
  connection?: NetworkConnectionLike
  mozConnection?: NetworkConnectionLike
  webkitConnection?: NetworkConnectionLike
}

interface AppUser {
  id?: number | string
  name?: string
  username?: string
}

interface AppSettings {
  business_name?: string
  customer_portal_logo_image?: string
  customer_portal_favicon_image?: string
  ui_app_favicon_image?: string
  ui_app_favicon_fit?: string
  ui_app_favicon_zoom?: string | number
  ui_app_favicon_position_x?: string | number
  ui_app_favicon_position_y?: string | number
  default_landing_page?: string
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

interface AppNotification {
  type?: string
  message: string
}

interface SyncProblemDetail {
  reason?: string
  error?: string
  channel?: string
  transient?: boolean
  connected?: boolean
  active?: boolean
  status?: number | string
  message?: string
  ts?: number | string
  version?: string
  waiting?: boolean
}

interface PendingSyncState {
  total?: number
  syncing?: number
  failed?: number
  oldest_created_at?: string | number
}

interface OfflineSaleNoticeDetail {
  client_request_id?: string
  receiptNumber?: string
  ts?: number | string
}

interface WriteConflictDetail {
  message?: string
  ts?: number | string
}

interface SyncUpdateDetail {
  channel?: string
  reason?: string
  source?: string
  importJobId?: string | number
  importJobStatus?: string
  importJobType?: string
  notificationCount?: number | string
  notificationSummary?: unknown
  notificationType?: string
  unreadCount?: number | string
  ts?: number | string
}

interface AppShellApi {
  getPendingSyncState?: () => Promise<PendingSyncState | null | undefined>
  getPendingAppUpdate?: () => SyncProblemDetail | null | undefined
  clearPendingAppUpdate?: () => void
  retryPendingSyncNow?: () => Promise<unknown>
}

interface AppContextValue {
  user: AppUser | null
  authReady: boolean
  page: AdminPageId
  notification: AppNotification | null
  dismissNotification: () => void
  canAccessPage: (pageId: string) => boolean
  AccessDenied: ComponentType
  setPage: (pageId: AdminPageId) => void
  navigateTo: (pageId: AdminPageId, anchor?: string) => void
  navGuard: { pageId: string; entries: Array<{ key: string; label: string; save?: unknown }> } | null
  resolveNavGuard: (action: 'save' | 'discard' | 'stay') => Promise<void>
  settings: AppSettings
  writeConflict: unknown
  dismissWriteConflict: () => void
  reloadWriteConflict: () => void
  syncUrl: string
  canWriteToServer: boolean
  language: string
  theme: string
  notify: (message: string, type?: string, durationMs?: number) => void
  t: TranslateFn
  clearSyncError?: () => void
}


// Sends a browser crash to our own Worker, which forwards it to Sentry.
//
// Deliberately uses bare fetch rather than the app's api layer: that layer
// retries, dispatches auth events and can itself throw -- all reasonable for
// real requests, all wrong for the last thing that runs after a page has
// already crashed. Every failure mode here ends in silence on purpose.
async function reportClientCrash(error: Error, pageId: string): Promise<void> {
  try {
    await fetch('/api/system/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        message: String(error?.message || error).slice(0, 1000),
        stack: String(error?.stack || '').slice(0, 4000),
        // The page id, never location.href -- a URL carries the query
        // string, which is where search terms and membership lookups live.
        page: pageId,
      }),
    })
  } catch {
    // Intentionally silent. See the docstring above.
  }
}

interface PageErrorBoundaryProps {
  pageId: string
  children: ReactNode
}

interface PageErrorBoundaryState {
  error: Error | null
}

interface NotificationProps {
  notification: AppNotification | null
  onDismiss?: () => void
}

interface SyncErrorBannerProps {
  error: SyncProblemDetail | null
  onDismiss: () => void
  onGoToServer: () => void
}

interface AppUpdateBannerProps {
  update: SyncProblemDetail | null
}

interface OfflineModeBannerProps {
  pendingSync: PendingSyncState | null
  canWriteToServer: boolean
  syncUrl: string
  transientOutage: SyncProblemDetail | null
  vaultLocked: SyncProblemDetail | null
  conflictsNeedReview: WriteConflictDetail | null
}

interface PageSlotProps {
  accessDenied: ReactNode
  activePageId: AdminPageId
  canAccessPage: (pageId: string) => boolean
  pageId: AdminPageId
}

interface NotificationCenterFallbackProps {
  compact?: boolean
  onClick?: () => void
}

const useApp = useAppHook as () => AppContextValue

function asPageModule(importer: () => Promise<unknown>): ChunkImporter {
  return () => importer() as Promise<{ default: ComponentType<Record<string, unknown>> }>
}

function getAppShellApi(): AppShellApi {
  return (window as unknown as { api?: AppShellApi }).api || {}
}

function readStorageValue(storage: Storage | null | undefined, key: string): string {
  try {
    return storage?.getItem(key) || ''
  } catch {
    return ''
  }
}

function hasUsableStoredAuthSession(): boolean {
  if (typeof window === 'undefined') return false
  const userJson = readStorageValue(window.sessionStorage, STORAGE_KEYS.USER)
    || readStorageValue(window.localStorage, STORAGE_KEYS.USER)
  if (!userJson) return false
  try {
    const parsed = JSON.parse(userJson) as Record<string, unknown> | null
    if (!parsed || typeof parsed !== 'object') return false
  } catch {
    return false
  }
  const expiry = readStorageValue(window.sessionStorage, STORAGE_KEYS.USER_EXPIRY)
    || readStorageValue(window.localStorage, STORAGE_KEYS.USER_EXPIRY)
  if (!expiry) return true
  const expiresAt = Number.parseInt(expiry, 10)
  return Number.isFinite(expiresAt) && Date.now() <= expiresAt
}

function getConnection(): NetworkConnectionLike | null {
  if (typeof navigator === 'undefined') return null
  const nav = navigator as NavigatorWithConnection
  return nav.connection || nav.mozConnection || nav.webkitConnection || null
}

function isPageId(value: unknown): value is PageId {
  return typeof value === 'string' && value in PAGE_IMPORTERS
}

function normalizePageId(value: unknown, fallback: AdminPageId = 'dashboard'): AdminPageId {
  return isPageId(value) ? value : fallback
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '')
}

/**
 * Frontend application shell.
 *
 * Runtime flow:
 * 1. Resolve the active page from AppContext/public route state.
 * 2. Lazy-load page bundles with one retry for transient chunk failures.
 * 3. Keep a small mounted-page cache so tab changes feel instant.
 * 4. Render shared chrome (sidebar, notifications, sync banners, page help).
 */

const PAGE_IMPORTERS = {
  dashboard: asPageModule(() => import('./components/dashboard/Dashboard')),
  notes: asPageModule(() => import('./components/notes/NotesPage.tsx')),
  products: asPageModule(() => import('./components/products/Products.tsx')),
  pos: asPageModule(() => import('./components/pos/POS.tsx')),
  // E2: the sales page id now hosts the Sales hub (receipts + returns + fees).
  sales: asPageModule(() => import('./components/sales/SalesHubPage.tsx')),
  // E1: the branches page id now hosts the Branches hub (stats & branches /
  // products / movements / rfid) -- Inventory.tsx renders inside it.
  branches: asPageModule(() => import('./components/branches/BranchesHubPage.tsx')),
  contacts: asPageModule(() => import('./components/contacts/Contacts')),
  catalog: asPageModule(() => import('./components/catalog/CatalogPage.tsx')),
  promotions: asPageModule(() => import('./components/promotions/PromotionsPage.tsx')),
  // E3: the review page id now hosts Review & Logs (queue + audit trail).
  review: asPageModule(() => import('./components/review/ReviewLogsPage.tsx')),
  receipt_settings: asPageModule(() => import('./components/receipt-settings/ReceiptSettings')),
  // E4: the settings page id now hosts Settings + Users + Backup.
  settings: asPageModule(() => import('./components/utils-settings/SettingsHubPage.tsx')),
  files: asPageModule(() => import('./components/files/FilesPage')),
  server: asPageModule(() => import('./components/server/ServerPage')),
} satisfies Record<PageId, ChunkImporter>


const CHUNK_IMPORT_TIMEOUT_MS = 15000
const INTENT_CHUNK_IMPORT_TIMEOUT_MS = 7000
const INTENT_CHUNK_WARMUP_DELAY_MS = 80
const PENDING_SYNC_INITIAL_REFRESH_DELAY_MS = 30000
const PENDING_SYNC_IDLE_TIMEOUT_MS = 45000
const PENDING_SYNC_POLL_INTERVAL_MS = 20_000
const NOTIFICATION_CENTER_INITIAL_MOUNT_DELAY_MS = 30000
const NOTIFICATION_CENTER_IDLE_TIMEOUT_MS = 45000
const QUICK_PREFERENCES_INITIAL_MOUNT_DELAY_MS = 7000
const QUICK_PREFERENCES_IDLE_TIMEOUT_MS = 20000
const IMPORT_TRACKER_INITIAL_MOUNT_DELAY_MS = 180000
const IMPORT_TRACKER_IDLE_TIMEOUT_MS = 60000
const STALE_SHELL_CACHE_DELETE_CONCURRENCY = 2
const CHUNK_IMPORT_MAX_ATTEMPTS = 3
const PAGE_LOADER_STALL_WARNING_MS = 15000
const STARTUP_STORAGE_CLEANUP_DELAY_MS = 2000
const STARTUP_STORAGE_CLEANUP_IDLE_TIMEOUT_MS = 9000
// Mobile top bar auto-hide: shown within this many px of the top of the
// active page, otherwise toggled by scroll direction once the user has
// moved at least this many px since the last toggle (a dead zone so small
// jitters -- a shaky hand, an overscroll bounce -- don't flicker it).
const MOBILE_HEADER_TOP_ZONE_PX = 24
const MOBILE_HEADER_SCROLL_DELTA_PX = 12
const CHUNK_RECOVERY_QUERY_KEYS = ['__bos_reload', '__bos_build', '__bos_reason', '__bos_server_build']
const FRONTEND_BUILD_HASH = typeof __FRONTEND_BUILD_HASH__ !== 'undefined' ? String(__FRONTEND_BUILD_HASH__ || '') : 'dev'

function getChunkErrorMessage(error: unknown): string {
  // Normalize unknown thrown values before chunk retry logic inspects them.
  return getErrorMessage(error)
}

function isChunkLoadError(message: string): boolean {
  // Covers the error strings emitted by Vite/Chrome when a lazy bundle is
  // temporarily unavailable or a previous build asset was evicted.
  return /Loading chunk/i.test(message)
    || /ChunkLoadError/i.test(message)
    || /Failed to fetch dynamically imported module/i.test(message)
    || /Importing a module script failed/i.test(message)
    || /(?:not a valid|expected a).*JavaScript.*MIME type/i.test(message)
    || /MIME type[^\n]*text\/html/i.test(message)
}

function createChunkTimeoutError(key: string, timeoutMs: number): Error {
  const error = new Error(`Page bundle timed out after ${Math.round(timeoutMs / 1000)}s (${key})`)
  error.name = 'ChunkTimeoutError'
  return error
}

function isRetryableImportError(error: unknown): boolean {
  const message = getChunkErrorMessage(error)
  return isChunkLoadError(message)
    || /timed out/i.test(message)
    || /network/i.test(message)
    || /aborted/i.test(message)
}

async function importWithTimeout(importer: ChunkImporter, key: string, timeoutMs = CHUNK_IMPORT_TIMEOUT_MS): Promise<{ default: ComponentType<Record<string, unknown>> }> {
  let timer: number | null = null
  try {
    return await Promise.race([
      importer(),
      new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(createChunkTimeoutError(key, timeoutMs)), timeoutMs)
      }),
    ]) as { default: ComponentType<Record<string, unknown>> }
  } finally {
    if (timer != null) {
      window.clearTimeout(timer)
    }
  }
}

function buildChunkRecoveryUrl(reason = 'chunk-reload', serverBuild: string | null = null): string {
  if (typeof window === 'undefined') return ''
  const url = new URL(window.location.href)
  url.searchParams.set('__bos_reload', String(Date.now()))
  url.searchParams.set('__bos_reason', reason)
  if (FRONTEND_BUILD_HASH && FRONTEND_BUILD_HASH !== 'dev') {
    url.searchParams.set('__bos_build', FRONTEND_BUILD_HASH)
  }
  if (serverBuild) url.searchParams.set('__bos_server_build', serverBuild)
  return url.toString()
}

async function deleteStaleShellCaches(cacheKeys: string[]): Promise<void> {
  const keys = Array.isArray(cacheKeys) ? cacheKeys : []
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(STALE_SHELL_CACHE_DELETE_CONCURRENCY, keys.length) }, async () => {
    while (nextIndex < keys.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      await window.caches.delete(keys[currentIndex])
    }
  })
  await Promise.all(workers)
}

async function clearStaleShellCaches() {
  if (typeof window === 'undefined' || !('caches' in window)) return
  try {
    const keys = await window.caches.keys()
    await deleteStaleShellCaches(
      keys.filter((key) => key.startsWith('business-os-app-shell-') || key.startsWith('business-os-static-')),
    )
  } catch (_) {}
}

async function triggerChunkRecoveryReload(marker: string): Promise<boolean> {
  // Offline guard (Part-77, offline audit): a chunk import fails OFFLINE for
  // any page the SW never cached -- and this recovery then deleted the
  // business-os-app-shell-*/static-* caches, i.e. the device's ONLY copy of
  // the app, before a reload that cannot refetch anything. That bricked the
  // whole offline PWA over one missing page. Recovery is pointless without a
  // network (its entire mechanism is "refetch the newest HTML/chunks"), so
  // offline: keep the caches, leave the retry marker UNSPENT (the full
  // recovery stays available for when connectivity returns), and return
  // false so the caller surfaces the failure instead.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  // A deployment mismatch must never turn into silent form/cart loss. Mobile
  // Safari does not consistently present beforeunload confirmation dialogs.
  if (hasDirtyWork()) {
    flushPendingWorkDrafts()
    return false
  }
  if (typeof window === 'undefined') return false

  // One reload per (page key, build) -- see utils/chunkReloadGuard.ts. The
  // old tab-lifetime '1' sentinel meant a single reload that did not land on
  // a good build left the tab unable to self-heal after every later deploy.
  const decision = await claimChunkReload(marker)
  if (!decision.allow) return false

  flushPendingWorkDrafts()
  const target = buildChunkRecoveryUrl(`chunk:${marker}:${decision.reason}`, decision.marker.live)
  const reload = () => {
    if (target) window.location.replace(target)
    else window.location.reload()
  }
  clearStaleShellCaches()
    .catch(() => {})
    .finally(reload)
  return true
}

function createChunkReloadStallError(key: string): Error {
  const error = new Error(`Loading chunk recovery reload did not complete (${key}). Please tap Reload page.`)
  error.name = 'ChunkReloadStallError'
  return error
}

function lazyWithRetry(importer: ChunkImporter, key: string) {
  // Wrap React.lazy so stale chunks can trigger a hard reload and pick up the
  // newest HTML/chunk graph after deployments or proxy cache races.
  return lazy(async () => {
    const marker = `bos-lazy-reload:${key}`
    for (let attempt = 1; attempt <= CHUNK_IMPORT_MAX_ATTEMPTS; attempt += 1) {
      try {
        const loaded = await importWithTimeout(importer, key)
        // Only a successful import re-arms the guard. Clearing on a final
        // failure as well (the previous behaviour) re-armed the SAME build and
        // turned every navigation into one more reload.
        clearChunkReloadMarker(marker)
        return loaded
      } catch (error) {
        if (!isRetryableImportError(error) || typeof window === 'undefined') {
          throw error
        }

        const isFinalAttempt = attempt >= CHUNK_IMPORT_MAX_ATTEMPTS
        if (!isFinalAttempt) {
          await new Promise((resolve) => window.setTimeout(resolve, 350))
          continue
        }

        // Recovery can decline (offline / dirty-work guards above, or this
        // build already reloaded for this key) -- then fall through to the
        // thrown error so the page-level error UI shows. The declines leave
        // the marker unspent for a real recovery once the block clears.
        if (await triggerChunkRecoveryReload(marker)) {
          return await new Promise(() => {})
        }

        throw error
      }
    }

    throw createChunkTimeoutError(key, CHUNK_IMPORT_TIMEOUT_MS)
  })
}

const Dashboard = lazyWithRetry(PAGE_IMPORTERS.dashboard, 'dashboard')
const NotesPage = lazyWithRetry(PAGE_IMPORTERS.notes, 'notes')
const Products = lazyWithRetry(PAGE_IMPORTERS.products, 'products')
const POS = lazyWithRetry(PAGE_IMPORTERS.pos, 'pos')
const Sales = lazyWithRetry(PAGE_IMPORTERS.sales, 'sales')
const Branches = lazyWithRetry(PAGE_IMPORTERS.branches, 'branches')
const Contacts = lazyWithRetry(PAGE_IMPORTERS.contacts, 'contacts')
const CatalogPage = lazyWithRetry(PAGE_IMPORTERS.catalog, 'catalog')
const PromotionsPage = lazyWithRetry(PAGE_IMPORTERS.promotions, 'promotions')
const ReviewLogsPage = lazyWithRetry(PAGE_IMPORTERS.review, 'review')
const ReceiptSettings = lazyWithRetry(PAGE_IMPORTERS.receipt_settings, 'receipt_settings')
const SettingsHubPage = lazyWithRetry(PAGE_IMPORTERS.settings, 'settings')
const FilesPage = lazyWithRetry(PAGE_IMPORTERS.files, 'files')
const ServerPage = lazyWithRetry(PAGE_IMPORTERS.server, 'server')
const Login = lazyWithRetry(asPageModule(() => import('./components/auth/Login')), 'auth-login')
const NotificationCenter = lazyWithRetry(asPageModule(() => import('./components/shared/NotificationCenter')), 'notification-center')
const BackgroundImportTracker = lazyWithRetry(asPageModule(() => import('./components/shared/BackgroundImportTracker')), 'background-import-tracker')
const NotesWidget = lazyWithRetry(asPageModule(() => import('./components/shared/NotesWidget')), 'notes-widget')
const WriteConflictModal = lazyWithRetry(asPageModule(() => import('./components/shared/WriteConflictModal')), 'write-conflict-modal')
const Sidebar = lazyWithRetry(asPageModule(() => import('./components/navigation/Sidebar')), 'sidebar')
const PAGE_COMPONENTS: Record<AdminPageId, ReturnType<typeof lazyWithRetry>> = {
  dashboard: Dashboard,
  notes: NotesPage,
  products: Products,
  pos: POS,
  sales: Sales,
  branches: Branches,
  contacts: Contacts,
  review: ReviewLogsPage,
  receipt_settings: ReceiptSettings,
  settings: SettingsHubPage,
  files: FilesPage,
  server: ServerPage,
  catalog: CatalogPage,
  promotions: PromotionsPage,
}

function shouldSkipIntentWarmup(): boolean {
  if (typeof window === 'undefined') return true
  if (document.visibilityState === 'hidden') return true
  const connection = getConnection()
  if (!connection) return false
  if (connection.saveData) return true
  return ['slow-2g', '2g'].includes(String(connection.effectiveType || '').toLowerCase())
}

function getIntentPageId(event: Event): PageId | '' {
  const detail = event instanceof CustomEvent ? event.detail as { pageId?: unknown } : null
  const pageId = String(detail?.pageId || '').trim()
  return isPageId(pageId) ? pageId : ''
}

function scheduleIntentChunkLoad(pageId: PageId, onDone: (pageId: PageId) => void): CancelWarmup | null {
  const importer = PAGE_IMPORTERS[pageId]
  if (!importer) return null

  let cancelled = false
  let idleId: number | null = null
  let timerId: number | null = null
  const run = () => {
    if (cancelled || shouldSkipIntentWarmup()) return
    importWithTimeout(importer, pageId, INTENT_CHUNK_IMPORT_TIMEOUT_MS)
      .catch(() => null)
      .finally(() => {
        if (!cancelled) onDone?.(pageId)
      })
  }

  timerId = window.setTimeout(() => {
    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(run, { timeout: 600 })
    } else {
      run()
    }
  }, INTENT_CHUNK_WARMUP_DELAY_MS)

  return () => {
    cancelled = true
    if (timerId != null) window.clearTimeout(timerId)
    if (idleId != null && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleId)
  }
}

function scheduleInitialPendingSyncRefresh(refresh: () => void): CancelWarmup {
  if (typeof window === 'undefined') return () => {}

  let cancelled = false
  let idleId: number | null = null
  let timerId: number | null = null
  const run = () => {
    if (cancelled || document.visibilityState === 'hidden') return
    refresh()
  }

  timerId = window.setTimeout(() => {
    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(run, { timeout: PENDING_SYNC_IDLE_TIMEOUT_MS })
    } else {
      run()
    }
  }, PENDING_SYNC_INITIAL_REFRESH_DELAY_MS)

  return () => {
    cancelled = true
    if (timerId != null) window.clearTimeout(timerId)
    if (idleId != null && typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(idleId)
    }
  }
}

function scheduleDeferredPendingSyncPolling(refresh: () => void): CancelWarmup {
  if (typeof window === 'undefined') return () => {}

  let intervalId: number | null = null
  const timerId = window.setTimeout(() => {
    intervalId = window.setInterval(refresh, PENDING_SYNC_POLL_INTERVAL_MS)
  }, PENDING_SYNC_INITIAL_REFRESH_DELAY_MS)

  return () => {
    window.clearTimeout(timerId)
    if (intervalId != null) window.clearInterval(intervalId)
  }
}

function isImportTrackerWakeEvent(event: Event): boolean {
  if (event.type === 'import-job:activity') return true
  if (!(event instanceof CustomEvent)) return false
  const detail = event.detail as SyncUpdateDetail | null
  const channel = String(detail?.channel || '').trim().toLowerCase()
  if (!(channel === 'importjobs' || channel === 'import_jobs' || channel === 'imports')) return false
  const reason = String(detail?.reason || '').trim().toLowerCase()
  const source = String(detail?.source || '').trim().toLowerCase()
  return !!detail?.importJobId
    || !!detail?.importJobStatus
    || !!detail?.importJobType
    || reason.includes('import')
    || source.includes('import')
}

function isNotificationCenterWakeEvent(event: Event): boolean {
  if (event.type === 'notification:activity') return true
  if (!(event instanceof CustomEvent)) return false
  const detail = event.detail as SyncUpdateDetail | null
  const channel = String(detail?.channel || '').trim().toLowerCase()
  const reason = String(detail?.reason || '').trim().toLowerCase()
  const source = String(detail?.source || '').trim().toLowerCase()
  const notificationType = String(detail?.notificationType || '').trim().toLowerCase()
  return channel === 'notifications'
    || channel === 'notification'
    || !!detail?.notificationSummary
    || detail?.notificationCount != null
    || detail?.unreadCount != null
    || !!notificationType
    || reason.includes('notification')
    || source.includes('notification')
}

function useMountedPages(activePage: AdminPageId): AdminPageId[] {
  // Keep only a bounded set of mounted screens alive to preserve local state
  // without letting the app accumulate every page forever.
  const [shellProfile, setShellProfile] = useState(() => ({
    viewportWidth: typeof window === 'undefined' ? 1280 : Number(window.innerWidth || 1280),
    coarsePointer: typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? !!window.matchMedia('(pointer: coarse)').matches
      : false,
  }))
  const [mountedPages, setMountedPages] = useState<AdminPageId[]>(() => [activePage])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const coarseMedia = typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)') : null
    const syncProfile = () => {
      setShellProfile({
        viewportWidth: Number(window.innerWidth || 1280),
        coarsePointer: !!coarseMedia?.matches,
      })
    }
    syncProfile()
    window.addEventListener('resize', syncProfile)
    coarseMedia?.addEventListener?.('change', syncProfile)
    return () => {
      window.removeEventListener('resize', syncProfile)
      coarseMedia?.removeEventListener?.('change', syncProfile)
    }
  }, [])

  useEffect(() => {
    const pageLimit = getMountedPageLimit({
      viewportWidth: shellProfile.viewportWidth,
      coarsePointer: shellProfile.coarsePointer,
      maxPages: MAX_MOUNTED_PAGES,
    })
    setMountedPages((previousPages) => {
      return updateMountedPages(previousPages, activePage, pageLimit) as AdminPageId[]
    })
  }, [activePage, shellProfile.coarsePointer, shellProfile.viewportWidth])

  return mountedPages
}

function useSyncErrorBanner(user: AppUser | null) {
  // Central listener for sync write/read failures that should surface globally.
  const [syncError, setSyncError] = useState<SyncProblemDetail | null>(null)
  const [transientOutage, setTransientOutage] = useState<SyncProblemDetail | null>(null)
  const [pendingSync, setPendingSync] = useState<PendingSyncState | null>(null)
  const [vaultLocked, setVaultLocked] = useState<SyncProblemDetail | null>(null)
  const [appUpdate, setAppUpdate] = useState<SyncProblemDetail | null>(null)
  const [conflictsNeedReview, setConflictsNeedReview] = useState<WriteConflictDetail | null>(null)

  // App updates are independent of authentication. A waiting worker may
  // announce itself on the login screen, during session restoration, or in
  // the signed-in shell, so keep one listener mounted for App's lifetime.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const acceptAppUpdate = (detail: SyncProblemDetail) => {
      const announcedHash = String(detail.version || '').replace(/^business-os-app-shell-/, '')
      // A device's first service-worker activation announces the same build
      // the page is already running. That is not an update and must not nag
      // the user; a genuinely newer waiting/active worker has a different hash.
      if (announcedHash && FRONTEND_BUILD_HASH !== 'dev' && announcedHash === FRONTEND_BUILD_HASH) return
      setAppUpdate(detail)
    }
    const onAppUpdate = (event: Event) => acceptAppUpdate(
      event instanceof CustomEvent
        ? event.detail as SyncProblemDetail
        : { message: 'New version ready', ts: Date.now() },
    )
    const bufferedAppUpdate = getAppShellApi().getPendingAppUpdate?.()
    if (bufferedAppUpdate) {
      acceptAppUpdate(bufferedAppUpdate)
      getAppShellApi().clearPendingAppUpdate?.()
    }
    window.addEventListener('sync:app-update-available', onAppUpdate)
    return () => window.removeEventListener('sync:app-update-available', onAppUpdate)
  }, [])

  useEffect(() => {
    if (!user || typeof window === 'undefined') {
      setSyncError(null)
      setTransientOutage(null)
      setPendingSync(null)
      setVaultLocked(null)
      setConflictsNeedReview(null)
      return undefined
    }

    const refreshPendingSync = () => {
      getAppShellApi().getPendingSyncState?.()
        .then((state) => setPendingSync(state || null))
        .catch(() => {})
    }
    const onSyncError = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail as SyncProblemDetail : null
      if (detail?.transient) return
      setSyncError(detail)
      refreshPendingSync()
    }
    const onTransientOutage = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail as SyncProblemDetail : {}
      if (detail.active === false) {
        setTransientOutage(null)
        return
      }
      setTransientOutage(detail)
    }
    const onSyncRecovered = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail as SyncProblemDetail : null
      if (event.type === 'sync:reconnected' || detail?.connected) {
        setSyncError(null)
        setTransientOutage(null)
        refreshPendingSync()
      }
    }
    const onQueueChanged = () => refreshPendingSync()
    const onVaultLocked = (event: Event) => setVaultLocked(event instanceof CustomEvent ? event.detail as SyncProblemDetail : { reason: 'locked', ts: Date.now() })
    const onConflictReview = (event: Event) => {
      setConflictsNeedReview(event instanceof CustomEvent ? event.detail as WriteConflictDetail : { message: 'Conflicts need review', ts: Date.now() })
      refreshPendingSync()
    }
    window.addEventListener('sync:error', onSyncError)
    window.addEventListener('sync:write-blocked', onSyncError)
    window.addEventListener('sync:transient-outage', onTransientOutage)
    window.addEventListener('sync:status', onSyncRecovered)
    window.addEventListener('sync:reconnected', onSyncRecovered)
    window.addEventListener('sync:queue-changed', onQueueChanged)
    window.addEventListener('sync:offline-sale-queued', onQueueChanged)
    window.addEventListener('sync:offline-sale-synced', onQueueChanged)
    window.addEventListener('offline:vault-locked', onVaultLocked)
    window.addEventListener('sync:write-conflict', onConflictReview)
    const cancelInitialPendingSyncRefresh = scheduleInitialPendingSyncRefresh(refreshPendingSync)
    const cancelPendingSyncPolling = scheduleDeferredPendingSyncPolling(refreshPendingSync)
    return () => {
      cancelInitialPendingSyncRefresh()
      cancelPendingSyncPolling()
      window.removeEventListener('sync:error', onSyncError)
      window.removeEventListener('sync:write-blocked', onSyncError)
      window.removeEventListener('sync:transient-outage', onTransientOutage)
      window.removeEventListener('sync:status', onSyncRecovered)
      window.removeEventListener('sync:reconnected', onSyncRecovered)
      window.removeEventListener('sync:queue-changed', onQueueChanged)
      window.removeEventListener('sync:offline-sale-queued', onQueueChanged)
      window.removeEventListener('sync:offline-sale-synced', onQueueChanged)
      window.removeEventListener('offline:vault-locked', onVaultLocked)
      window.removeEventListener('sync:write-conflict', onConflictReview)
    }
  }, [user])

  return {
    syncError,
    transientOutage,
    pendingSync,
    vaultLocked,
    appUpdate,
    conflictsNeedReview,
    clearVaultLocked: () => setVaultLocked(null),
    clearAppUpdate: () => setAppUpdate(null),
    clearConflictsNeedReview: () => setConflictsNeedReview(null),
    clearSyncError: () => setSyncError(null),
  }
}

function useDeferredImportTrackerMount(user: AppUser | null): boolean {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    if (!user || typeof window === 'undefined') {
      setEnabled(false)
      return undefined
    }
    if (enabled) return undefined

    let cancelled = false
    let idleId: number | null = null
    let timerId: number | null = null
    const enable = () => {
      if (cancelled) return
      setEnabled(true)
    }
    const enableWhenVisible = () => {
      if (cancelled) return
      if (document.visibilityState === 'hidden') return
      enable()
    }
    const onImportJobActivity = (event: Event) => {
      if (isImportTrackerWakeEvent(event)) enable()
    }
    window.addEventListener('import-job:activity', onImportJobActivity)
    timerId = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === 'function') {
        idleId = window.requestIdleCallback(enableWhenVisible, { timeout: IMPORT_TRACKER_IDLE_TIMEOUT_MS })
      } else {
        enableWhenVisible()
      }
    }, IMPORT_TRACKER_INITIAL_MOUNT_DELAY_MS)

    return () => {
      cancelled = true
      window.removeEventListener('import-job:activity', onImportJobActivity)
      if (timerId != null) window.clearTimeout(timerId)
      if (idleId != null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId)
      }
    }
  }, [enabled, user])

  return !!user && enabled
}

function useDeferredQuickPreferencesMount(user: AppUser | null): boolean {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    if (!user || typeof window === 'undefined') {
      setEnabled(false)
      return undefined
    }
    if (enabled) return undefined

    let cancelled = false
    let idleId: number | null = null
    let timerId: number | null = null
    const enable = () => {
      if (cancelled || document.visibilityState === 'hidden') return
      setEnabled(true)
    }
    timerId = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === 'function') {
        idleId = window.requestIdleCallback(enable, { timeout: QUICK_PREFERENCES_IDLE_TIMEOUT_MS })
      } else {
        enable()
      }
    }, QUICK_PREFERENCES_INITIAL_MOUNT_DELAY_MS)

    return () => {
      cancelled = true
      if (timerId != null) window.clearTimeout(timerId)
      if (idleId != null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId)
      }
    }
  }, [enabled, user])

  return !!user && enabled
}

function useDeferredNotificationCenterMount(user: AppUser | null): {
  notificationCenterOpenRequestId: number
  shouldMountNotificationCenter: boolean
  requestNotificationCenterMount: () => void
} {
  const [enabled, setEnabled] = useState(false)
  const [openRequestId, setOpenRequestId] = useState(0)

  useEffect(() => {
    if (!user || typeof window === 'undefined') {
      setEnabled(false)
      setOpenRequestId(0)
      return undefined
    }
    if (enabled) return undefined

    let cancelled = false
    let idleId: number | null = null
    let timerId: number | null = null
    const enable = () => {
      if (cancelled) return
      setEnabled(true)
    }
    const enableWhenVisible = () => {
      if (cancelled || document.visibilityState === 'hidden') return
      enable()
    }
    const onSyncUpdate = (event: Event) => {
      if (isNotificationCenterWakeEvent(event)) enable()
    }
    const onNotificationActivity = (event: Event) => {
      if (isNotificationCenterWakeEvent(event)) enable()
    }

    window.addEventListener('sync:update', onSyncUpdate)
    window.addEventListener('notification:activity', onNotificationActivity)
    timerId = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === 'function') {
        idleId = window.requestIdleCallback(enableWhenVisible, { timeout: NOTIFICATION_CENTER_IDLE_TIMEOUT_MS })
      } else {
        enableWhenVisible()
      }
    }, NOTIFICATION_CENTER_INITIAL_MOUNT_DELAY_MS)

    return () => {
      cancelled = true
      window.removeEventListener('sync:update', onSyncUpdate)
      window.removeEventListener('notification:activity', onNotificationActivity)
      if (timerId != null) window.clearTimeout(timerId)
      if (idleId != null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId)
      }
    }
  }, [enabled, user])

  return {
    notificationCenterOpenRequestId: openRequestId,
    shouldMountNotificationCenter: !!user && enabled,
    requestNotificationCenterMount: () => {
      setOpenRequestId((current) => current + 1)
      setEnabled(true)
    },
  }
}

function useVisibilityRecovery(enabled: boolean) {
  // Some kiosk/tablet browsers lose focus after backgrounding; these small
  // nudges help input/hover state recover without a manual refresh.
  useEffect(() => {
    if (!enabled) return undefined
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      setTimeout(() => {
        const focusedElement = document.activeElement
        if (!focusedElement || focusedElement === document.body) {
          document.dispatchEvent(new MouseEvent('mousemove'))
        }
      }, 150)
    }

    const onFocus = () => {
      setTimeout(() => {
        if (document.activeElement === document.body) {
          document.body.click()
        }
      }, 50)
    }

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
    }
  }, [enabled])
}

function useIntentChunkWarmup(user: AppUser | null, activePageId: AdminPageId, canAccessPage: (pageId: string) => boolean): void {
  useEffect(() => {
    if (!user || typeof window === 'undefined') return undefined

    const warmedPageIds = new Set<PageId>()
    let cancelCurrentWarmup: CancelWarmup | null = null

    const warmIntentPage = (event: Event) => {
      const pageId = getIntentPageId(event)
      if (!pageId || pageId === activePageId || warmedPageIds.has(pageId)) return
      if (!canAccessPage(pageId) || shouldSkipIntentWarmup()) return

      cancelCurrentWarmup?.()
      cancelCurrentWarmup = scheduleIntentChunkLoad(pageId, (loadedPageId) => {
        warmedPageIds.add(loadedPageId)
        cancelCurrentWarmup = null
      })
    }

    window.addEventListener(APP_PAGE_INTENT_EVENT, warmIntentPage)
    return () => {
      window.removeEventListener(APP_PAGE_INTENT_EVENT, warmIntentPage)
      cancelCurrentWarmup?.()
    }
  }, [activePageId, canAccessPage, user])
}

class PageErrorBoundary extends Component<PageErrorBoundaryProps, PageErrorBoundaryState> {
  constructor(props: PageErrorBoundaryProps) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): PageErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Page-level crashes should be isolated to the current route, not the
    // entire shell, while still leaving a useful console breadcrumb.
    console.error(`[PageErrorBoundary] Page "${this.props.pageId}" crashed:`, error.message, info.componentStack)
    // Also report it. Posted to our own Worker, not to Sentry directly:
    // the DSN stays out of the browser bundle and PII scrubbing lives in
    // one place server-side. Fire-and-forget with its own catch, because a
    // failure to REPORT a crash must never become a second crash inside
    // the handler that is already dealing with one.
    void reportClientCrash(error, this.props.pageId)
    if (shouldAttemptPublicDomRecovery(this.props.pageId, error) && typeof window !== 'undefined') {
      window.location.reload()
    }
  }

  render() {
    if (!this.state.error) {
      return this.props.children
    }

    const message = this.state.error?.message || String(this.state.error)
    const retryable = isRetryableImportError(this.state.error)
    const publicDomMutation = this.props.pageId === 'catalog-public' && isPublicDomMutationError(this.state.error)
    const buttonLabel = publicDomMutation ? 'Reload public page' : (retryable ? 'Reload page' : 'Retry')

    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="text-5xl mb-4">!</div>
        <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-2">Page failed to load</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 max-w-sm font-mono bg-gray-100 dark:bg-gray-800 rounded-lg p-3 text-left break-words">
          {message}
        </p>
        <button
          className="btn-primary"
          onClick={() => {
            if ((retryable || publicDomMutation) && typeof window !== 'undefined') {
              window.location.reload()
              return
            }
            this.setState({ error: null })
          }}
        >
          {buttonLabel}
        </button>
      </div>
    )
  }
}

function Notification({ notification, onDismiss }: NotificationProps) {
  // Toast notifications are rendered once here so feature pages only need to
  // enqueue messages through AppContext.
  if (!notification) return null

  const colorClass = getNotificationColor(notification.type)
  const prefix = getNotificationPrefix(notification.type)
  const classes = `fixed right-3 top-[4.75rem] md:right-5 md:top-5 z-[1100] ${colorClass} text-white pl-4 pr-2.5 py-3 rounded-xl shadow-2xl text-sm font-medium fade-in max-w-[min(20rem,calc(100vw-1.5rem))] flex items-start gap-2`

  const node = (
    <div className={classes}>
      <span className="flex-1 min-w-0 break-words">{prefix}{notification.message}</span>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={onDismiss}
        className="shrink-0 -mt-0.5 -mr-0.5 rounded-full p-1 leading-none text-white/80 hover:text-white hover:bg-white/15 transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
  return typeof document !== 'undefined' ? createPortal(node, document.body) : node
}

function AppUpdateBanner({ update }: AppUpdateBannerProps) {
  const { t } = useApp()
  const [restarting, setRestarting] = useState(false)

  if (!update) return null

  const restart = async () => {
    if (restarting) return
    setRestarting(true)
    const result = await restartIntoLatestApp({
      unsavedWorkMessage: t('save_or_discard_before_update') || 'Save or discard your unfinished work before updating the app.',
    })
    if (result === 'blocked') setRestarting(false)
  }

  const node = (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed inset-x-0 top-0 z-[1500] flex min-h-[calc(3rem+env(safe-area-inset-top))] w-full items-center bg-blue-700 px-[calc(0.75rem+env(safe-area-inset-left))] pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] text-white shadow-lg dark:bg-blue-600"
    >
      <div className="mx-auto flex w-full max-w-[1680px] items-center justify-between gap-3">
        <span className="min-w-0 text-sm font-semibold">
          {t('app_update_ready') || 'A new version is ready.'}
        </span>
        <button
          type="button"
          onClick={() => { void restart() }}
          disabled={restarting}
          className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-sm font-bold text-blue-700 shadow-sm transition hover:bg-blue-50 disabled:cursor-wait disabled:opacity-70 dark:text-blue-700"
        >
          {restarting
            ? (t('restarting_app') || 'Restarting...')
            : (t('restart_now') || 'Restart now')}
        </button>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(node, document.body) : node
}

function SyncErrorBanner({ error, onDismiss, onGoToServer }: SyncErrorBannerProps) {
  const { t, canAccessPage } = useApp()
  if (!error) return null
  const blocked = String(error?.reason || '').startsWith('server_')
  const title = blocked ? 'Write blocked - server unavailable: ' : 'Write failed - data not saved: '
  // navigateTo('server') (App.tsx's onGoToServer -> AppContext.tsx's
  // navigateTo) already silently no-ops for a user without the 'settings'
  // permission the Server Sync page requires (same gate PageSlot's render
  // and the sidebar nav entry both already use) -- so a cashier-role user
  // hitting a write error previously saw a "View details" link that did
  // nothing when clicked, with no feedback explaining why. Hiding the
  // action for that role closes the gap using the exact same permission
  // check already decided elsewhere for this page, not a new gate.
  const canViewDetails = canAccessPage('server')

  return (
    <div className="fixed left-0 right-0 top-16 z-[200] bg-red-600 text-white px-4 py-2.5 flex items-start gap-3 shadow-lg md:top-14">
      <span className="text-lg flex-shrink-0">!</span>
      <div className="flex-1 min-w-0">
        <span className="font-semibold text-sm">{title}</span>
        <span className="text-sm opacity-90">{error.error}</span>
        {error.channel && <span className="text-xs opacity-70 ml-2">(operation: {error.channel})</span>}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {canViewDetails ? (
          <button onClick={onGoToServer} className="text-xs underline opacity-90 hover:opacity-100 whitespace-nowrap">{t('view_details')}</button>
        ) : null}
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('close') || 'Close'}
          className="shrink-0 rounded-full p-1 leading-none text-white/80 hover:text-white hover:bg-white/15 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

// The mobile top bar (Sidebar.tsx's fixed `<header>`) used to be pinned in
// place permanently, unlike every other pinned element in the app -- search
// bars and filter rows -- which use `position: sticky` and so scroll out of
// view once the user moves past them. This hook gives the top bar the same
// "not actually pinned" behavior: visible on entering a page, hidden once
// the user scrolls down past a small dead zone near the top, shown again
// the moment they scroll back up. Mirrors the show-near-top /
// hide-on-scroll-down / show-on-scroll-up model CatalogPage.tsx already
// uses for the public portal's chrome, just reading scroll position off
// the currently active `.page-scroll` node via getScrollTarget() instead
// of window, since the admin shell scrolls per-page (each page has its own
// internal scroll container), not at the window level.
function useMobileHeaderAutoHide(page: string): boolean {
  const [visible, setVisible] = useState(true)
  const scrollAnchorRef = useRef(0)
  const frameRequestedRef = useRef(false)

  // Entering a page -- including switching between two already-mounted
  // pages -- always starts with the bar shown, and resets the anchor so
  // the next scroll delta is measured from a fresh baseline instead of
  // whatever position the previously active page happened to leave behind.
  useEffect(() => {
    setVisible(true)
    scrollAnchorRef.current = 0
  }, [page])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const update = () => {
      frameRequestedRef.current = false
      const target = getScrollTarget(window) as { scrollTop?: number; scrollY?: number }
      const scrollTop = Math.max(0, Number(target?.scrollTop ?? target?.scrollY ?? 0))
      const delta = scrollTop - scrollAnchorRef.current
      if (scrollTop <= MOBILE_HEADER_TOP_ZONE_PX) {
        setVisible(true)
      } else if (Math.abs(delta) >= MOBILE_HEADER_SCROLL_DELTA_PX) {
        setVisible(delta < 0)
      }
      scrollAnchorRef.current = scrollTop
    }
    const handleScroll = () => {
      if (frameRequestedRef.current) return
      frameRequestedRef.current = true
      window.requestAnimationFrame(update)
    }
    // capture: true -- the actual scrolling happens on the active
    // `.page-scroll` node nested deep inside <main>, and scroll events
    // don't bubble, so this has to observe them on the way down instead.
    // Same technique AppSelect.tsx/PortalMenu.tsx already use to reposition
    // on scroll from anywhere in the tree.
    window.addEventListener('scroll', handleScroll, true)
    return () => window.removeEventListener('scroll', handleScroll, true)
  }, [])

  return visible
}

function GlobalScrollControls() {
  const scrollTo = (direction: ScrollDirection) => {
    const target = getScrollTarget(window)
    const top = getScrollToPosition(target, direction)
    const scrollableTarget = target as { scrollTo?: (options: ScrollToOptions) => void }
    if (typeof scrollableTarget?.scrollTo === 'function') {
      scrollableTarget.scrollTo({ top, behavior: 'smooth' })
      return
    }
    if (typeof window !== 'undefined') {
      window.scrollTo({ top, behavior: 'smooth' })
    }
  }

  return (
    <div className="pointer-events-none fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-[calc(0.625rem+env(safe-area-inset-right))] z-[1000] flex flex-col gap-1.5 md:bottom-[calc(1rem+env(safe-area-inset-bottom))] md:right-[calc(1rem+env(safe-area-inset-right))]">
      <button
        type="button"
        className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-transparent bg-transparent text-gray-500 shadow-none backdrop-blur-none transition hover:bg-white/70 hover:text-blue-700 dark:text-gray-300 dark:hover:bg-gray-900/55 dark:hover:text-blue-300"
        onClick={() => scrollTo('top')}
        aria-label="Scroll to top"
        title="Scroll to top"
      >
        <ArrowUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-transparent bg-transparent text-gray-500 shadow-none backdrop-blur-none transition hover:bg-white/70 hover:text-blue-700 dark:text-gray-300 dark:hover:bg-gray-900/55 dark:hover:text-blue-300"
        onClick={() => scrollTo('bottom')}
        aria-label="Scroll to bottom"
        title="Scroll to bottom"
      >
        <ArrowDown className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function formatSyncTimestamp(value: unknown): string {
  if (!value) return ''
  if (!(typeof value === 'string' || typeof value === 'number' || value instanceof Date)) {
    return String(value)
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function OfflineModeBanner({ pendingSync, canWriteToServer, syncUrl, transientOutage, vaultLocked, conflictsNeedReview }: OfflineModeBannerProps) {
  const { t } = useApp()
  const total = Number(pendingSync?.total || 0)
  const [showRecovered, setShowRecovered] = useState(false)
  const [showVerboseMessage, setShowVerboseMessage] = useState(false)
  const wasOfflineRef = useRef(false)

  useEffect(() => {
    if (!syncUrl) {
      wasOfflineRef.current = false
      setShowRecovered(false)
      return undefined
    }
    if (!canWriteToServer) {
      wasOfflineRef.current = true
      setShowRecovered(false)
      return undefined
    }
    if (!wasOfflineRef.current) return undefined
    setShowRecovered(true)
    const timer = window.setTimeout(() => setShowRecovered(false), 12000)
    wasOfflineRef.current = false
    return () => window.clearTimeout(timer)
  }, [canWriteToServer, syncUrl])

  const offline = !!syncUrl && !canWriteToServer
  const syncing = Number(pendingSync?.syncing || 0)
  const failed = Number(pendingSync?.failed || 0)
  const ready = !!syncUrl && canWriteToServer
  const oldest = formatSyncTimestamp(pendingSync?.oldest_created_at)
  const reconnecting = offline && !!transientOutage
  const label = ready
    ? (total
      ? (t('offline_mode_ready_sync') || 'Server is back online. Offline actions can sync now.')
      : (t('server_back_online') || 'Server is back online. You can keep working.'))
    : reconnecting
      ? (t('server_tunnel_reconnecting') || 'Server/tunnel reconnecting. Cached data stays visible and read-only checks will refresh automatically.')
      : (t('offline_mode_active') || 'Offline mode: sales are saved on this device and will sync when the server reconnects.')
  const statusSuffix = reconnecting && transientOutage?.status ? ` Status ${transientOutage.status}` : ''
  // appUpdate no longer feeds this banner's own "Update ready" priority
  // state -- that used to pop this floating banner on effectively every
  // login/reload (not just when a genuinely new build was waiting),
  // which read as a redundant nag stacked on top of the top bar. A
  // manual refresh/update-check action now lives as its own button in
  // the sidebar (see Sidebar.tsx) instead; this banner still exists for
  // conflicts-need-review/vault-locked/offline-sync states, just not
  // app-update anymore.
  const priority = conflictsNeedReview
    ? { title: 'Conflicts need review', message: 'Review offline changes before syncing.', tone: 'danger' }
    : vaultLocked
      ? { title: 'Vault locked', message: 'Unlock offline mode to sync encrypted changes.', tone: 'warning' }
      : null
  const toneClass = priority?.tone === 'danger'
    ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200'
    : ready
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200'
      : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300'
  const title = priority?.title || (reconnecting ? (t('server_reconnecting') || 'Server reconnecting') : t('offline_mode') || 'Offline mode')
  const message = priority?.message || `${label}${statusSuffix}`
  const shouldShowVerboseImmediately = !!priority || total > 0 || offline

  useEffect(() => {
    if (!offline && !ready && !priority && !showRecovered) {
      setShowVerboseMessage(false)
      return undefined
    }
    if (shouldShowVerboseImmediately) {
      setShowVerboseMessage(true)
      return undefined
    }
    setShowVerboseMessage(false)
    const timer = window.setTimeout(() => setShowVerboseMessage(true), 1400)
    return () => window.clearTimeout(timer)
  }, [offline, ready, priority, showRecovered, shouldShowVerboseImmediately])

  if (!offline && !total && !showRecovered && !vaultLocked && !conflictsNeedReview) return null

  return (
    <div className={`pointer-events-none fixed left-1/2 top-16 z-[1100] ${showVerboseMessage ? 'w-[min(calc(100vw-1rem),56rem)]' : 'w-[min(calc(100vw-1rem),24rem)]'} -translate-x-1/2 px-2 md:top-[4.25rem]`}>
      <div className={`pointer-events-auto rounded-2xl border px-3 py-2 text-xs shadow-lg backdrop-blur-sm ${toneClass}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <strong className="shrink-0">{title}</strong>
              {!showVerboseMessage ? (
                <span className="rounded-full border border-current/20 px-2 py-0.5 text-[11px] font-medium opacity-80">
                  {ready ? (t('status_ready') || 'Ready') : (t('status_active') || 'Active')}
                </span>
              ) : null}
            </div>
            {showVerboseMessage ? (
              <div className="mt-1 text-[11px] leading-4 opacity-90">
                {message}
              </div>
            ) : null}
            {total ? (
              <div className="mt-1 flex flex-wrap items-center gap-1.5 opacity-80">
                <span className="rounded-full border border-current/20 px-2 py-0.5">
                  {total} {t('pending') || 'pending'}
                </span>
                {syncing ? (
                  <span className="rounded-full border border-current/20 px-2 py-0.5">
                    {syncing} {t('syncing') || 'syncing'}
                  </span>
                ) : null}
                {failed ? (
                  <span className="rounded-full border border-current/20 px-2 py-0.5">
                    {failed} {t('failed') || 'failed'}
                  </span>
                ) : null}
                {oldest ? <span className="truncate">since {oldest}</span> : null}
              </div>
            ) : null}
          </div>
            <div className="flex shrink-0 items-center gap-2">
            {total ? (
              <button
                type="button"
                className="rounded-full border border-current px-3 py-1 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!ready}
                onClick={() => getAppShellApi().retryPendingSyncNow?.().catch(() => {})}
              >
                {ready ? (t('sync_now') || 'Sync now') : (t('waiting_for_server') || 'Waiting for server')}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function PageLoader() {
  const [stalled, setStalled] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setStalled(true)
      try {
        const key = `business_os_page_loader_warning:${window.location.pathname}:${FRONTEND_BUILD_HASH || 'dev'}`
        if (!window.sessionStorage.getItem(key)) {
          window.sessionStorage.setItem(key, String(Date.now()))
          console.warn('[PageLoader] Page bundle is still loading. The app shell is waiting instead of forcing a reload.')
        }
      } catch {
        console.warn('[PageLoader] Page bundle is still loading. The app shell is waiting instead of forcing a reload.')
      }
    }, PAGE_LOADER_STALL_WARNING_MS)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <div
      className="flex-1"
      role="status"
      aria-live="polite"
    >
      {/* Same centered spinner design used everywhere else in the boot
          sequence (see index.html's static shell, InitialShellFallback in
          index.tsx, and the authReady gate below) -- previously this had
          its own distinct, bigger "card with a progress bar" design that
          showed right after the boot sequence's loader on every fresh
          page-chunk load. Now there is exactly one loading design app-wide. */}
      <div className="business-os-initial-shell">
        <div className="business-os-initial-panel">
          <div className="business-os-initial-spinner" aria-hidden="true" />
          <div className="business-os-initial-brand">
            <h1 className="business-os-initial-title">Business OS</h1>
            <p className="business-os-initial-copy">
              {stalled ? 'Page bundle is still loading' : 'Loading this workspace view...'}
            </p>
          </div>
          {stalled ? (
            <div
              className="max-w-[19rem] rounded-xl border border-slate-200 bg-white/95 p-2.5 text-xs text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-400"
              style={{ pointerEvents: 'auto' }}
            >
              The app is still fetching this page chunk. Reload only if the connection has recovered and the page does not continue.
              <button
                type="button"
                className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-blue-400 hover:text-blue-600 dark:border-slate-700 dark:text-slate-300 dark:hover:border-blue-500 dark:hover:text-blue-300"
                onClick={() => window.location.reload()}
              >
                Reload page
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function NotificationCenterFallback({ onClick }: NotificationCenterFallbackProps) {
  // Sized/styled to exactly match the real trigger button this stands in
  // for (NotificationCenter.tsx's own <button>: h-10 w-10, rounded-full,
  // icon-only, no border) and QuickPreferenceToggles' identical
  // ToggleButton -- so the theme/language/bell icon row reads as one
  // consistent set the whole time, not just once the real bell finishes
  // its deferred mount. Previously this had its own smaller
  // (`compact` shrank it to h-8/h-9) bordered-pill look, which is what
  // was actually on screen during NOTIFICATION_CENTER_INITIAL_MOUNT_DELAY_MS
  // (and longer, since mount is otherwise wake-event-gated) -- i.e. what
  // most people saw first, not an edge case.
  return (
    <button
      type="button"
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 hover:text-blue-700 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-blue-300"
      aria-label="Notifications"
      title="Notifications"
      onClick={onClick}
      disabled={!onClick}
    >
      <Bell className="h-5 w-5" />
    </button>
  )
}

function PageSlot({ accessDenied, activePageId, canAccessPage, pageId }: PageSlotProps) {
  const PageComponent = PAGE_COMPONENTS[pageId] || Dashboard
  const isActive = pageId === activePageId

  return (
    <div
      key={pageId}
      data-bos-page-slot={pageId}
      data-bos-active-page={isActive ? 'true' : 'false'}
      style={{
        display: isActive ? 'flex' : 'none',
        flex: '1 1 0%',
        overflow: 'hidden',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <PageErrorBoundary key={`${pageId}-boundary`} pageId={pageId}>
        <Suspense fallback={<PageLoader />}>
          {canAccessPage(pageId) ? <PageComponent /> : accessDenied}
        </Suspense>
      </PageErrorBoundary>
    </div>
  )
}

// A customer visiting the storefront must never see the admin's
// "Business OS / Loading this workspace view..." splash (that's what
// PageLoader renders -- admin chrome). While the catalog chunk streams in,
// keep the surface quiet and unbranded: just the storefront's own neutral
// background, so the page effectively loads in the background and the visitor
// only ever sees the store. Same public-surface rule that keeps admin/internal
// framing off every customer-facing page.
function PublicCatalogFallback() {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-white dark:bg-slate-950"
      role="status"
      aria-live="polite"
      aria-label="Loading catalog"
    >
      {/* Just the shared unbranded spinner (the .business-os-initial-spinner
          ring lives in index.html's <head> style block for the page's whole
          lifetime) -- deliberately WITHOUT the "Business OS / Loading this
          workspace view..." title+copy that PageLoader renders, so a customer
          sees a quiet loading ring on the storefront background, never admin
          branding. */}
      <div className="business-os-initial-spinner" aria-hidden="true" />
    </div>
  )
}

function PublicCatalogView() {
  return (
    <PageErrorBoundary pageId="catalog-public">
      <Suspense fallback={<PublicCatalogFallback />}>
        <CatalogPage publicView />
      </Suspense>
    </PageErrorBoundary>
  )
}

export default function App() {
  const {
    user,
    authReady,
    page,
    notification,
    dismissNotification,
    canAccessPage,
    AccessDenied,
    setPage,
    navigateTo,
    navGuard,
    resolveNavGuard,
    settings,
    writeConflict,
    dismissWriteConflict,
    reloadWriteConflict,
    syncUrl,
    canWriteToServer,
    language,
    theme,
    notify,
    t,
  } = useApp()
  const offlineNoticeRef = useRef({ queued: '', synced: '' })
  const {
    syncError,
    transientOutage,
    pendingSync,
    vaultLocked,
    appUpdate,
    conflictsNeedReview,
    clearSyncError,
  } = useSyncErrorBanner(authReady ? user : null)
  const mountedPages = useMountedPages(page)
  const mobileHeaderVisible = useMobileHeaderAutoHide(page)
  const mainRef = useRef<HTMLElement | null>(null)
  // Swipe-down-to-refresh: listens on the shell's <main> (an ancestor of
  // whichever page's own `.page-scroll` div is actually scrolling --
  // touch events bubble, so this doesn't need to live on that inner
  // node), and re-checks the CURRENT scroll position via the same
  // getScrollTarget() the header-hide effect above already uses, since
  // which node is "the" scrollable one can change as pages mount/unmount.
  // Firing refreshAppData() re-broadcasts every real sync channel (see
  // utils/appRefresh.ts) -- the same "refresh everything currently on
  // screen" mechanism ResetData.tsx and settingsTransport.ts's own
  // conflict-recovery path already trigger elsewhere in this app, so a
  // pull here re-fetches exactly what those already-proven paths do,
  // rather than a new, untested refresh mechanism.
  const { pullDistance, refreshing: pullRefreshing } = usePullToRefresh(
    mainRef,
    () => {
      const target = getScrollTarget(window) as { scrollTop?: number; scrollY?: number }
      return Math.max(0, Number(target?.scrollTop ?? target?.scrollY ?? 0))
    },
    () => refreshAppData(),
    Boolean(user),
  )
  const shouldMountImportTracker = useDeferredImportTrackerMount(authReady ? user : null)
  const shouldMountQuickPreferences = useDeferredQuickPreferencesMount(authReady ? user : null)
  const {
    notificationCenterOpenRequestId,
    shouldMountNotificationCenter,
    requestNotificationCenterMount,
  } = useDeferredNotificationCenterMount(authReady ? user : null)
  const desktopNotificationSlot = shouldMountNotificationCenter ? (
    <Suspense fallback={<NotificationCenterFallback compact />}>
      <NotificationCenter compact openRequestId={notificationCenterOpenRequestId} visibility="desktop" />
    </Suspense>
  ) : (
    <NotificationCenterFallback compact onClick={requestNotificationCenterMount} />
  )
  const mobileNotificationSlot = shouldMountNotificationCenter ? (
    <Suspense fallback={<NotificationCenterFallback compact />}>
      <NotificationCenter compact openRequestId={notificationCenterOpenRequestId} visibility="mobile" />
    </Suspense>
  ) : (
    <NotificationCenterFallback compact onClick={requestNotificationCenterMount} />
  )

  useVisibilityRecovery(authReady && !!user)
  useIntentChunkWarmup(authReady ? user : null, page, canAccessPage)

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const url = new URL(window.location.href)
    let changed = false
    CHUNK_RECOVERY_QUERY_KEYS.forEach((key) => {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key)
        changed = true
      }
    })
    if (changed) {
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
    }

    let idleId: number | null = null
    let timerId: number | null = null
    const cleanupRecoveryStorageMarkers = () => {
      try {
        for (const key of Object.keys(window.sessionStorage)) {
          if (key.startsWith('business_os_page_loader_retry:') || key.startsWith('bos-lazy-reload:')) {
            window.sessionStorage.removeItem(key)
          }
        }
      } catch {
        // Ignore storage cleanup failures.
      }
    }
    timerId = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === 'function') {
        idleId = window.requestIdleCallback(cleanupRecoveryStorageMarkers, { timeout: STARTUP_STORAGE_CLEANUP_IDLE_TIMEOUT_MS })
      } else {
        cleanupRecoveryStorageMarkers()
      }
    }, STARTUP_STORAGE_CLEANUP_DELAY_MS)

    return () => {
      if (timerId != null) window.clearTimeout(timerId)
      if (idleId != null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId)
      }
    }
  }, [])

  useEffect(() => {
    if (!user || typeof window === 'undefined') return undefined
    const onQueued = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail as OfflineSaleNoticeDetail : {}
      const key = `${detail.client_request_id || ''}:${detail.ts || ''}`
      if (offlineNoticeRef.current.queued === key) return
      offlineNoticeRef.current.queued = key
      const receipt = detail.receiptNumber ? ` ${detail.receiptNumber}` : ''
      const messageTemplate = t('offline_sale_saved_notice') || 'Offline sale {receipt} saved at {time}. It will sync when the server is online.'
      notify(messageTemplate
        .replace('{receipt}', receipt.trim() || '')
        .replace('{time}', formatSyncTimestamp(detail.ts || Date.now()))
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+\./g, '.'), 'warning', 7000)
    }
    const onSynced = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail as OfflineSaleNoticeDetail : {}
      const key = `${detail.client_request_id || ''}:${detail.ts || ''}`
      if (offlineNoticeRef.current.synced === key) return
      offlineNoticeRef.current.synced = key
      const receipt = detail.receiptNumber ? ` ${detail.receiptNumber}` : ''
      const messageTemplate = t('offline_sale_synced_notice') || 'Offline sale {receipt} synced at {time}.'
      notify(messageTemplate
        .replace('{receipt}', receipt.trim() || '')
        .replace('{time}', formatSyncTimestamp(detail.ts || Date.now()))
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+\./g, '.'), 'success', 6000)
    }
    window.addEventListener('sync:offline-sale-queued', onQueued)
    window.addEventListener('sync:offline-sale-synced', onSynced)
    return () => {
      window.removeEventListener('sync:offline-sale-queued', onQueued)
      window.removeEventListener('sync:offline-sale-synced', onSynced)
    }
  }, [notify, t, user])

  const [, setLocationVersion] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const handleLocationChange = () => setLocationVersion((value) => value + 1)
    window.addEventListener('popstate', handleLocationChange)
    window.addEventListener(APP_NAVIGATION_EVENT, handleLocationChange)
    return () => {
      window.removeEventListener('popstate', handleLocationChange)
      window.removeEventListener(APP_NAVIGATION_EVENT, handleLocationChange)
    }
  }, [])

  const pathname = typeof window !== 'undefined' ? (window.location.pathname || '/') : '/'
  const isPublicCatalogRoute = isPublicCatalogPath(pathname)
  // '/' resolves through the org's configurable default landing page
  // (Settings > Navigation Layout, settings.default_landing_page) instead of
  // a hardcoded 'dashboard' -- resolveAdminLandingPage falls back to
  // 'dashboard' itself for an unset/unrecognized value, and the access-guard
  // effect below still won't navigate a user to a page they can't open.
  const requestedAdminPage = pathname === '/'
    ? normalizePageId(resolveAdminLandingPage(settings.default_landing_page), 'dashboard')
    : normalizePageId(getAdminPageFromPath(pathname), 'dashboard')

  useEffect(() => {
    if (!user || !requestedAdminPage || requestedAdminPage === page) return
    if (canAccessPage(requestedAdminPage)) setPage(requestedAdminPage)
  }, [canAccessPage, page, requestedAdminPage, setPage, user])

  // User-reported bug ("logging into other users it shows me access denied
  // then redirect me afterwards"): `page`'s initial value (AppContext's
  // getInitialAdminPage) is resolved from the URL/default landing page at
  // mount, before this component knows whether the just-logged-in user can
  // actually open it -- a real case for any role whose org-wide default
  // landing page (Settings > Navigation Layout) isn't one of their granted
  // pages (e.g. an employee role with no 'dashboard' permission logging
  // into a deployment whose default landing page is Dashboard). The effect
  // above only ever corrects `page` toward `requestedAdminPage` (the URL);
  // it never had a path OFF of an inaccessible page, so PageSlot rendered
  // AccessDenied and stayed there -- confirmed by reading canAccessPage's
  // own `!user` early return plus PageSlot's `canAccessPage(pageId) ?
  // <Page/> : accessDenied` branch, no other effect in this file ever
  // moves `page` away from a denied value. Fix: once the user is known and
  // the CURRENT page turns out to be inaccessible, jump to the first page
  // (in the sidebar's own NAV_ITEMS order, so the user lands somewhere
  // they'd naturally expect from the nav rather than an arbitrary one)
  // they're actually granted -- so AccessDenied never renders as a
  // dead end, only ever (if at all) for the one paint before this effect's
  // first run resolves it.
  useEffect(() => {
    if (!user || !page || canAccessPage(page)) return
    const fallback = NAV_ITEMS.find((item) => canAccessPage(item.id))
    if (fallback && fallback.id !== page) setPage(fallback.id as AdminPageId)
  }, [canAccessPage, page, setPage, user])

  const accessDeniedNode = useMemo(() => <AccessDenied />, [AccessDenied])

  useEffect(() => {
    if (isPublicCatalogRoute || typeof document === 'undefined') return undefined
    const businessName = String(settings.business_name || '').trim()
    if (!businessName) return undefined
    const previousTitle = document.title
    document.title = businessName
    return () => {
      document.title = previousTitle
    }
  }, [isPublicCatalogRoute, settings.business_name])

  // The admin app no longer re-brands its favicon or swaps its manifest
  // (both removed). The browser-tab / "Add to Home Screen" icon is the
  // DEFAULT app branding, not settings-customizable -- Settings changes
  // only the in-app TOPBAR organization logo. The manifest swap also built
  // a blob: URL, which Chrome refuses to treat as installable, so keeping
  // the static /manifest.json is what makes the app PWA-installable. The
  // tab TITLE re-brand (above) stays.




  if (isPublicCatalogRoute) {
    return (
      <>
        <AppUpdateBanner update={appUpdate} />
        <PublicCatalogView />
      </>
    )
  }

  const storedAuthSessionPending = !user && hasUsableStoredAuthSession()

  if ((!authReady && !user) || storedAuthSessionPending) {
    // Deliberately reuses the exact classNames (and CSS, defined once in
    // index.html's <style data-business-os-initial-shell> block, which
    // stays in <head> for the page's whole lifetime) as the static
    // pre-hydration shell in index.html and index.tsx's InitialShellFallback,
    // and as PageLoader below -- one single centered-spinner loading design
    // used everywhere in the app, instead of several different-looking
    // loading screens appearing back to back during boot/navigation.
    return (
      <>
        <AppUpdateBanner update={appUpdate} />
        <div className="business-os-initial-shell" role="status" aria-live="polite">
          <div className="business-os-initial-panel">
            <div className="business-os-initial-spinner" aria-hidden="true" />
            <div className="business-os-initial-brand">
              <h1 className="business-os-initial-title">Business OS</h1>
              <p className="business-os-initial-copy">Preparing secure sign-in...</p>
            </div>
          </div>
        </div>
      </>
    )
  }

  if (!user) {
    return (
      <>
        <AppUpdateBanner update={appUpdate} />
        <Suspense fallback={<PageLoader />}>
          <Login />
        </Suspense>
      </>
    )
  }

  return (
    <div id="app-root" className={`flex h-screen flex-col overflow-hidden bg-gray-50 dark:bg-gray-900 ${appUpdate ? 'pt-[calc(3rem+env(safe-area-inset-top))]' : ''}`}>
      <AppUpdateBanner update={appUpdate} />
      {/* Desktop's standalone top bar (logo, business name, notification
          bell, theme/language toggles in their own h-14 row above the
          sidebar+content) is gone -- per request, large screens fold all
          of that (minus the business name, which is dropped everywhere)
          into the sidebar's own header row instead. See Sidebar.tsx's
          <aside> header. The mobile top bar is untouched here; it's
          rendered by Sidebar.tsx itself as a fixed-position header. */}
      <NotesProvider>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Suspense fallback={null}>
            <Sidebar
              notificationSlot={mobileNotificationSlot}
              desktopNotificationSlot={desktopNotificationSlot}
              showQuickPreferences={shouldMountQuickPreferences}
              mobileHeaderVisible={mobileHeaderVisible}
              appUpdateVisible={!!appUpdate}
            />
          </Suspense>

          <main
            ref={mainRef}
            className={`relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pb-[calc(3.55rem+env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] transition-[padding-top] duration-300 ease-in-out md:pb-0 md:pl-0 md:pr-0 md:pt-0 ${mobileHeaderVisible ? (appUpdate ? 'pt-16' : 'pt-[calc(4rem+env(safe-area-inset-top))]') : (appUpdate ? 'pt-0' : 'pt-[env(safe-area-inset-top)]')}`}
          >
            <PullToRefreshIndicator pullDistance={pullDistance} refreshing={pullRefreshing} />
            <div className="flex min-w-0 items-center gap-3">
            </div>
            <OfflineModeBanner
              pendingSync={pendingSync}
              canWriteToServer={canWriteToServer}
              syncUrl={syncUrl}
              transientOutage={transientOutage}
              vaultLocked={vaultLocked}
              conflictsNeedReview={conflictsNeedReview}
            />
            {shouldMountImportTracker ? (
              <Suspense fallback={null}>
                <BackgroundImportTracker />
              </Suspense>
            ) : null}
            <Suspense fallback={null}>
              <NotesWidget />
            </Suspense>
            {mountedPages.map((mountedPage) => (
              <PageSlot
                key={mountedPage}
                accessDenied={accessDeniedNode}
                activePageId={page}
                canAccessPage={canAccessPage}
                pageId={mountedPage}
              />
            ))}
          </main>
        </div>
      </NotesProvider>

      <Notification notification={notification} onDismiss={dismissNotification} />
      <GlobalScrollControls />
      {writeConflict ? (
        <Suspense fallback={null}>
          <WriteConflictModal
            conflict={writeConflict}
            onClose={dismissWriteConflict}
            onReload={reloadWriteConflict}
          />
        </Suspense>
      ) : null}
      {/* N2: unsaved-work navigation guard -- switching pages with dirty
          work forces an explicit choice instead of silently stranding it.
          Save & Leave is only offered when EVERY dirty item can save
          itself; browser close/reload is covered by AppContext's
          beforeunload handler. */}
      {navGuard ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-2xl dark:bg-gray-800">
            <h2 className="font-bold text-gray-900 dark:text-white">{t('unsaved_work_title') || 'Unsaved work on this page'}</h2>
            <ul className="mt-2 space-y-1 text-sm text-gray-600 dark:text-gray-300">
              {navGuard.entries.map((entry) => (
                <li key={entry.key} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
                  <span className="min-w-0 truncate">{entry.label}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-gray-400">{t('unsaved_work_hint') || 'Leaving now would lose it. What should happen?'}</p>
            <div className="mt-3 flex flex-col gap-2">
              {navGuard.entries.every((entry) => typeof entry.save === 'function') ? (
                <button type="button" className="btn-primary w-full text-sm" onClick={() => { void resolveNavGuard('save') }}>
                  {t('save_and_leave') || 'Save & Leave'}
                </button>
              ) : null}
              <button
                type="button"
                className="w-full rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-900/20"
                onClick={() => { void resolveNavGuard('discard') }}
              >
                {t('discard_and_leave') || 'Discard & Leave'}
              </button>
              <button type="button" className="btn-secondary w-full text-sm" onClick={() => { void resolveNavGuard('stay') }}>
                {t('stay_here') || 'Stay'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <SyncErrorBanner
        error={syncError}
        onDismiss={clearSyncError}
        onGoToServer={() => {
          clearSyncError()
          navigateTo('server')
        }}
      />
    </div>
  )
}
