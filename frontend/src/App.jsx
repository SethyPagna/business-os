import { Component, Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { useApp } from './AppContext'
import { getNotificationColor, getNotificationPrefix, isPublicCatalogPath, MAX_MOUNTED_PAGES, updateMountedPages } from './app/appShellUtils.mjs'
import Login from './components/auth/Login'
import Sidebar from './components/navigation/Sidebar'
import WriteConflictModal from './components/shared/WriteConflictModal'
import PageHelpButton from './components/shared/PageHelpButton'
import { createCircularFaviconDataUrl } from './utils/favicon'

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
  dashboard: () => import('./components/dashboard/Dashboard'),
  products: () => import('./components/products/Products'),
  pos: () => import('./components/pos/POS'),
  sales: () => import('./components/sales/Sales'),
  returns: () => import('./components/returns/Returns'),
  inventory: () => import('./components/inventory/Inventory'),
  branches: () => import('./components/branches/Branches'),
  contacts: () => import('./components/contacts/Contacts'),
  catalog: () => import('./components/catalog/CatalogPage'),
  loyalty_points: () => import('./components/loyalty-points/LoyaltyPointsPage'),
  users: () => import('./components/users/Users'),
  audit_log: () => import('./components/utils-settings/AuditLog'),
  receipt_settings: () => import('./components/receipt-settings/ReceiptSettings'),
  backup: () => import('./components/utils-settings/Backup'),
  settings: () => import('./components/utils-settings/Settings'),
  files: () => import('./components/files/FilesPage'),
  server: () => import('./components/server/ServerPage'),
}

const WARMUP_PAGE_IDS = [
  'dashboard',
  'products',
  'sales',
  'returns',
  'inventory',
  'catalog',
  'pos',
  'branches',
  'contacts',
  'users',
  'settings',
  'receipt_settings',
  'backup',
  'files',
  'server',
  'audit_log',
]

const ADMIN_PAGE_SEQUENCE = [
  'users',
  'audit_log',
  'receipt_settings',
  'settings',
  'files',
  'server',
  'backup',
]

const CHUNK_IMPORT_TIMEOUT_MS = 8000
const CHUNK_IMPORT_MAX_ATTEMPTS = 3

function getChunkErrorMessage(error) {
  // Normalize unknown thrown values before chunk retry logic inspects them.
  return String(error?.message || error || '')
}

function isChunkLoadError(message) {
  // Covers the error strings emitted by Vite/Chrome when a lazy bundle is
  // temporarily unavailable or a previous build asset was evicted.
  return /Loading chunk/i.test(message)
    || /ChunkLoadError/i.test(message)
    || /Failed to fetch dynamically imported module/i.test(message)
    || /Importing a module script failed/i.test(message)
}

function createChunkTimeoutError(key, timeoutMs) {
  const error = new Error(`Page bundle timed out after ${Math.round(timeoutMs / 1000)}s (${key})`)
  error.name = 'ChunkTimeoutError'
  return error
}

function isRetryableImportError(error) {
  const message = getChunkErrorMessage(error)
  return isChunkLoadError(message)
    || /timed out/i.test(message)
    || /network/i.test(message)
    || /aborted/i.test(message)
}

async function importWithTimeout(importer, key, timeoutMs = CHUNK_IMPORT_TIMEOUT_MS) {
  let timer = null
  try {
    return await Promise.race([
      importer(),
      new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(createChunkTimeoutError(key, timeoutMs)), timeoutMs)
      }),
    ])
  } finally {
    if (timer != null) {
      window.clearTimeout(timer)
    }
  }
}

function clearRetryMarker(marker) {
  // Reset the retry state after either a successful import or a final failure.
  try {
    sessionStorage.removeItem(marker)
  } catch (_) {}
}

function triggerChunkRecoveryReload(marker) {
  try {
    sessionStorage.setItem(marker, '1')
  } catch (_) {}

  if (typeof window === 'undefined') return false
  window.location.reload()
  return true
}

function createChunkReloadStallError(key) {
  const error = new Error(`Loading chunk recovery reload did not complete (${key}). Please tap Reload page.`)
  error.name = 'ChunkReloadStallError'
  return error
}

function shouldRetryChunk(marker) {
  // One reload per page key avoids infinite loops while still healing most
  // stale-index / evicted-chunk deployment states.
  try {
    return sessionStorage.getItem(marker) !== '1'
  } catch (_) {
    return false
  }
}

function lazyWithRetry(importer, key) {
  // Wrap React.lazy so stale chunks can trigger one hard reload and pick up the
  // newest HTML/chunk graph after deployments or proxy cache races.
  return lazy(async () => {
    const marker = `bos-lazy-reload:${key}`
    for (let attempt = 1; attempt <= CHUNK_IMPORT_MAX_ATTEMPTS; attempt += 1) {
      try {
        const loaded = await importWithTimeout(importer, key)
        clearRetryMarker(marker)
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

        if (shouldRetryChunk(marker)) {
          triggerChunkRecoveryReload(marker)
          await new Promise((resolve) => window.setTimeout(resolve, 1400))
          clearRetryMarker(marker)
          throw createChunkReloadStallError(key)
        }

        clearRetryMarker(marker)
        throw error
      }
    }

    throw createChunkTimeoutError(key, CHUNK_IMPORT_TIMEOUT_MS)
  })
}

const Dashboard = lazyWithRetry(PAGE_IMPORTERS.dashboard, 'dashboard')
const Products = lazyWithRetry(PAGE_IMPORTERS.products, 'products')
const POS = lazyWithRetry(PAGE_IMPORTERS.pos, 'pos')
const Sales = lazyWithRetry(PAGE_IMPORTERS.sales, 'sales')
const Returns = lazyWithRetry(PAGE_IMPORTERS.returns, 'returns')
const Inventory = lazyWithRetry(PAGE_IMPORTERS.inventory, 'inventory')
const Branches = lazyWithRetry(PAGE_IMPORTERS.branches, 'branches')
const Contacts = lazyWithRetry(PAGE_IMPORTERS.contacts, 'contacts')
const CatalogPage = lazyWithRetry(PAGE_IMPORTERS.catalog, 'catalog')
const LoyaltyPointsPage = lazyWithRetry(PAGE_IMPORTERS.loyalty_points, 'loyalty_points')
const Users = lazyWithRetry(PAGE_IMPORTERS.users, 'users')
const AuditLog = lazyWithRetry(PAGE_IMPORTERS.audit_log, 'audit_log')
const ReceiptSettings = lazyWithRetry(PAGE_IMPORTERS.receipt_settings, 'receipt_settings')
const Backup = lazyWithRetry(PAGE_IMPORTERS.backup, 'backup')
const Settings = lazyWithRetry(PAGE_IMPORTERS.settings, 'settings')
const FilesPage = lazyWithRetry(PAGE_IMPORTERS.files, 'files')
const ServerPage = lazyWithRetry(PAGE_IMPORTERS.server, 'server')
const PAGE_COMPONENTS = {
  dashboard: Dashboard,
  products: Products,
  pos: POS,
  sales: Sales,
  returns: Returns,
  inventory: Inventory,
  branches: Branches,
  contacts: Contacts,
  users: Users,
  audit_log: AuditLog,
  receipt_settings: ReceiptSettings,
  backup: Backup,
  settings: Settings,
  files: FilesPage,
  server: ServerPage,
  catalog: CatalogPage,
  loyalty_points: LoyaltyPointsPage,
}

function getWarmupImporters() {
  // Warm up the most failure-prone admin pages first, then the rest of the
  // shell, so cold starts are less likely to show up only when a user reaches
  // the later settings stack.
  const orderedIds = [...ADMIN_PAGE_SEQUENCE, ...WARMUP_PAGE_IDS.filter((pageId) => !ADMIN_PAGE_SEQUENCE.includes(pageId))]
  return orderedIds
    .map((pageId) => {
      const importer = PAGE_IMPORTERS[pageId]
      if (!importer) return null
      return () => importWithTimeout(importer, pageId).catch(() => null)
    })
    .filter(Boolean)
}

function getDataWarmupLoaders(canAccessPage) {
  const steps = [
    () => window.api?.getSettings?.(),
    () => window.api?.getDashboard?.(),
  ]

  // Prioritize the pages that have historically been slow on their first visit.
  // These warmups happen early so late-navigation admin screens have data and
  // auth-derived config ready before the user reaches them.
  if (canAccessPage('users')) {
    steps.push(() => window.api?.getUsers?.())
    steps.push(() => window.api?.getRoles?.())
  }
  if (canAccessPage('audit_log')) {
    steps.push(() => window.api?.getAuditLogs?.())
  }
  if (canAccessPage('server') || canAccessPage('settings') || canAccessPage('backup')) {
    steps.push(() => window.api?.getSystemConfig?.())
  }
  if (canAccessPage('files')) {
    steps.push(() => window.api?.getFiles?.())
    steps.push(() => window.api?.getAiProviders?.())
    steps.push(() => window.api?.getAiResponses?.(40))
  }
  if (canAccessPage('server')) {
    steps.push(() => window.api?.getSystemDebugLog?.())
  }
  if (canAccessPage('backup')) {
    steps.push(() => window.api?.getDataPath?.())
    steps.push(() => window.api?.getGoogleDriveSyncStatus?.())
  }

  steps.push(
    () => window.api?.getProducts?.(),
    () => window.api?.getCategories?.(),
    () => window.api?.getUnits?.(),
    () => window.api?.getCustomFields?.(),
    () => window.api?.getBranches?.(),
    () => window.api?.getSales?.(),
    () => window.api?.getReturns?.(),
    () => window.api?.getCustomers?.(),
    () => window.api?.getSuppliers?.(),
    () => window.api?.getDeliveryContacts?.(),
  )

  return steps.filter(Boolean)
}

function runWarmupBatches(loaders, batchSize = 3) {
  return (async () => {
    for (let index = 0; index < loaders.length; index += batchSize) {
      const batch = loaders.slice(index, index + batchSize)
      await Promise.allSettled(batch.map((load) => load()))
    }
  })()
}

function getPageEntryWarmupLoaders(pageId, canAccessPage) {
  const loaders = []
  const add = (fn) => {
    if (typeof fn === 'function') loaders.push(fn)
  }

  if (pageId === 'users' && canAccessPage('users')) {
    add(() => window.api?.getUsers?.())
    add(() => window.api?.getRoles?.())
  }
  if (pageId === 'audit_log' && canAccessPage('audit_log')) {
    add(() => window.api?.getAuditLogs?.())
  }
  if (pageId === 'receipt_settings') {
    add(() => window.api?.getSettings?.())
  }
  if (pageId === 'settings' && canAccessPage('settings')) {
    add(() => window.api?.getSettings?.())
    add(() => window.api?.getSystemConfig?.())
  }
  if (pageId === 'files' && canAccessPage('files')) {
    add(() => window.api?.getFiles?.())
    add(() => window.api?.getAiProviders?.())
    add(() => window.api?.getAiResponses?.(40))
  }
  if (pageId === 'server' && canAccessPage('server')) {
    add(() => window.api?.getSystemConfig?.())
    add(() => window.api?.getSystemDebugLog?.())
  }
  if (pageId === 'backup' && canAccessPage('backup')) {
    add(() => window.api?.getSystemConfig?.())
    add(() => window.api?.getDataPath?.())
    add(() => window.api?.getGoogleDriveSyncStatus?.())
  }

  return loaders
}

function useMountedPages(activePage) {
  // Keep only a bounded set of mounted screens alive to preserve local state
  // without letting the app accumulate every page forever.
  const [mountedPages, setMountedPages] = useState(() => [activePage])

  useEffect(() => {
    setMountedPages((previousPages) => {
      return updateMountedPages(previousPages, activePage, MAX_MOUNTED_PAGES)
    })
  }, [activePage])

  return mountedPages
}

function useSyncErrorBanner() {
  // Central listener for sync write/read failures that should surface globally.
  const [syncError, setSyncError] = useState(null)

  useEffect(() => {
    const onSyncError = (event) => setSyncError(event.detail)
    window.addEventListener('sync:error', onSyncError)
    return () => window.removeEventListener('sync:error', onSyncError)
  }, [])

  return {
    syncError,
    clearSyncError: () => setSyncError(null),
  }
}

function useVisibilityRecovery() {
  // Some kiosk/tablet browsers lose focus after backgrounding; these small
  // nudges help input/hover state recover without a manual refresh.
  useEffect(() => {
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
  }, [])
}

function useChunkWarmup(user) {
  // Only warm chunks after a user exists so public routes stay lightweight.
  useEffect(() => {
    if (!user || typeof window === 'undefined') return undefined

    let cancelled = false
    let idleId = null
    let timeoutId = null
    let followupId = null
    let started = false
    const importers = getWarmupImporters()

    const runWarmup = async () => {
      if (cancelled || started) return
      started = true
      await runWarmupBatches(importers, 2)
    }

    timeoutId = window.setTimeout(runWarmup, 120)

    if ('requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(runWarmup, { timeout: 1500 })
    } else {
      followupId = window.setTimeout(runWarmup, 900)
    }

    return () => {
      cancelled = true
      if (idleId != null && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleId)
      }
      if (timeoutId != null) {
        window.clearTimeout(timeoutId)
      }
      if (followupId != null) {
        window.clearTimeout(followupId)
      }
    }
  }, [user])
}

function useDataWarmup(user, canAccessPage) {
  useEffect(() => {
    if (!user || typeof window === 'undefined') return undefined

    let cancelled = false
    let idleId = null
    let timeoutId = null
    let followupId = null
    let started = false
    const loaders = getDataWarmupLoaders(canAccessPage)

    const runWarmup = async () => {
      if (cancelled || started) return
      started = true
      await runWarmupBatches(loaders, 3)
    }

    timeoutId = window.setTimeout(runWarmup, 220)

    if ('requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(runWarmup, { timeout: 1800 })
    } else {
      followupId = window.setTimeout(runWarmup, 1100)
    }

    return () => {
      cancelled = true
      if (idleId != null && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleId)
      }
      if (timeoutId != null) window.clearTimeout(timeoutId)
      if (followupId != null) window.clearTimeout(followupId)
    }
  }, [canAccessPage, user])
}

function usePageEntryWarmup(user, activePageId, canAccessPage) {
  // When the user enters the later admin stack, immediately warm the current
  // page and the remaining pages in that sequence. This closes the gap between
  // "first app login" warmup and "I navigated here much later" cold starts.
  useEffect(() => {
    if (!user || !ADMIN_PAGE_SEQUENCE.includes(activePageId) || typeof window === 'undefined') return undefined

    let cancelled = false
    const currentIndex = ADMIN_PAGE_SEQUENCE.indexOf(activePageId)
    const remainingPageIds = ADMIN_PAGE_SEQUENCE.slice(currentIndex)
    const importerLoaders = remainingPageIds
      .map((pageId) => {
        const importer = PAGE_IMPORTERS[pageId]
        if (!importer) return null
        return () => importWithTimeout(importer, pageId).catch(() => null)
      })
      .filter(Boolean)
    const dataLoaders = remainingPageIds.flatMap((pageId) => getPageEntryWarmupLoaders(pageId, canAccessPage))

    const run = async () => {
      if (cancelled) return
      await Promise.allSettled([
        runWarmupBatches(importerLoaders, 2),
        runWarmupBatches(dataLoaders, 3),
      ])
    }

    const timer = window.setTimeout(run, 80)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [activePageId, canAccessPage, user])
}

class PageErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Page-level crashes should be isolated to the current route, not the
    // entire shell, while still leaving a useful console breadcrumb.
    console.error(`[PageErrorBoundary] Page "${this.props.pageId}" crashed:`, error.message, info.componentStack)
  }

  render() {
    if (!this.state.error) {
      return this.props.children
    }

    const message = this.state.error?.message || String(this.state.error)
    const retryable = isRetryableImportError(this.state.error)

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
            if (retryable && typeof window !== 'undefined') {
              window.location.reload()
              return
            }
            this.setState({ error: null })
          }}
        >
          {retryable ? 'Reload page' : 'Retry'}
        </button>
      </div>
    )
  }
}

function Notification({ notification }) {
  // Toast notifications are rendered once here so feature pages only need to
  // enqueue messages through AppContext.
  if (!notification) return null

  const colorClass = getNotificationColor(notification.type)
  const prefix = getNotificationPrefix(notification.type)
  const classes = `fixed bottom-20 md:bottom-5 right-3 md:right-5 z-[100] ${colorClass} text-white px-4 py-3 rounded-xl shadow-2xl text-sm font-medium fade-in max-w-xs`

  return <div className={classes}>{prefix}{notification.message}</div>
}

function SyncErrorBanner({ error, onDismiss, onGoToServer }) {
  const { t } = useApp()
  if (!error) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-[200] bg-red-600 text-white px-4 py-2.5 flex items-start gap-3 shadow-lg">
      <span className="text-lg flex-shrink-0">!</span>
      <div className="flex-1 min-w-0">
        <span className="font-semibold text-sm">Write failed - data not saved: </span>
        <span className="text-sm opacity-90">{error.error}</span>
        {error.channel && <span className="text-xs opacity-70 ml-2">(operation: {error.channel})</span>}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button onClick={onGoToServer} className="text-xs underline opacity-90 hover:opacity-100 whitespace-nowrap">{t('view_details')}</button>
        <button onClick={onDismiss} className="text-white opacity-70 hover:opacity-100 text-lg leading-none px-1">x</button>
      </div>
    </div>
  )
}

function PageLoader() {
  return (
    <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-600">
      <div className="text-center">
        <div className="text-3xl mb-2 animate-pulse">...</div>
        <p className="text-sm">Loading...</p>
      </div>
    </div>
  )
}

function PageSlot({ accessDenied, activePageId, canAccessPage, pageId }) {
  const PageComponent = PAGE_COMPONENTS[pageId] || Dashboard
  const isActive = pageId === activePageId

  return (
    <div
      key={pageId}
      style={{
        display: isActive ? 'flex' : 'none',
        height: '100%',
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

function PublicCatalogView() {
  return (
    <PageErrorBoundary pageId="catalog-public">
      <Suspense fallback={<PageLoader />}>
        <>
          <CatalogPage publicView />
          <PageHelpButton pageId="catalog-public" />
        </>
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
    canAccessPage,
    AccessDenied,
    setPage,
    settings,
    writeConflict,
    dismissWriteConflict,
    reloadWriteConflict,
  } = useApp()
  const { syncError, clearSyncError } = useSyncErrorBanner()
  const mountedPages = useMountedPages(page)

  useVisibilityRecovery()
  useChunkWarmup(authReady ? user : null)
  useDataWarmup(authReady ? user : null, canAccessPage)
  usePageEntryWarmup(authReady ? user : null, page, canAccessPage)

  const pathname = typeof window !== 'undefined' ? (window.location.pathname || '/') : '/'
  const isPublicCatalogRoute = isPublicCatalogPath(pathname)

  const accessDeniedNode = useMemo(() => <AccessDenied />, [AccessDenied])

  useEffect(() => {
    if (isPublicCatalogRoute || typeof document === 'undefined') return undefined

    const iconSource = String(
      settings.ui_app_favicon_image
      || settings.customer_portal_favicon_image
      || settings.customer_portal_logo_image
      || '',
    ).trim()
    if (!iconSource) return undefined

    let iconEl = document.querySelector('link[rel="icon"]')
    let createdIcon = false
    let previousHref = ''
    let cancelled = false

    if (iconEl) previousHref = iconEl.getAttribute('href') || ''
    if (!iconEl) {
      iconEl = document.createElement('link')
      iconEl.setAttribute('rel', 'icon')
      document.head.appendChild(iconEl)
      createdIcon = true
    }

    createCircularFaviconDataUrl(iconSource, { fit: 'cover', zoom: 100, positionX: 50, positionY: 50 })
      .then((faviconHref) => {
        if (cancelled || !iconEl) return
        iconEl.setAttribute('href', faviconHref || iconSource)
      })
      .catch(() => {
        if (cancelled || !iconEl) return
        iconEl.setAttribute('href', iconSource)
      })

    return () => {
      cancelled = true
      if (createdIcon && iconEl) {
        iconEl.remove()
      } else if (iconEl) {
        if (previousHref) iconEl.setAttribute('href', previousHref)
        else iconEl.removeAttribute('href')
      }
    }
  }, [
    isPublicCatalogRoute,
    settings.customer_portal_favicon_image,
    settings.customer_portal_logo_image,
    settings.ui_app_favicon_image,
  ])

  if (isPublicCatalogRoute) {
    return <PublicCatalogView />
  }

  if (!user) {
    return <Login />
  }

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center text-gray-500 dark:text-gray-400">
          <div className="text-3xl mb-2 animate-pulse">...</div>
          <p className="text-sm">Signing you in...</p>
        </div>
      </div>
    )
  }

  return (
    <div id="app-root" className="flex h-screen bg-gray-50 dark:bg-gray-900 overflow-hidden">
      <Sidebar />

      <main className="flex-1 flex flex-col min-h-0 overflow-hidden pt-16 md:pt-0 pb-16 md:pb-0">
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

      <Notification notification={notification} />
      <WriteConflictModal
        conflict={writeConflict}
        onClose={dismissWriteConflict}
        onReload={reloadWriteConflict}
      />
      <PageHelpButton pageId={page} />
      <SyncErrorBanner
        error={syncError}
        onDismiss={clearSyncError}
        onGoToServer={() => {
          clearSyncError()
          setPage('server')
        }}
      />
    </div>
  )
}
