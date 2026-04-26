import { Component, Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { useApp } from './AppContext'
import { getNotificationColor, getNotificationPrefix, isPublicCatalogPath, MAX_MOUNTED_PAGES, updateMountedPages } from './app/appShellUtils.mjs'
import Login from './components/auth/Login'
import Sidebar from './components/navigation/Sidebar'
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
  'catalog',
  'pos',
  'users',
  'audit_log',
  'receipt_settings',
  'backup',
  'settings',
  'files',
  'server',
]

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
    try {
      const loaded = await importer()
      clearRetryMarker(marker)
      return loaded
    } catch (error) {
      const message = getChunkErrorMessage(error)
      if (!isChunkLoadError(message) || typeof window === 'undefined') {
        throw error
      }

      if (shouldRetryChunk(marker)) {
        triggerChunkRecoveryReload(marker)
        return new Promise(() => {})
      }

      clearRetryMarker(marker)
      throw error
    }
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
  // Warm up the heaviest next-likely pages after login to hide first-open cost.
  return WARMUP_PAGE_IDS.map((pageId) => PAGE_IMPORTERS[pageId]).filter(Boolean)
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
    const importers = getWarmupImporters()

    const runWarmup = () => {
      if (cancelled) return
      Promise.allSettled(importers.map((load) => load())).catch(() => {})
    }

    if ('requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(runWarmup, { timeout: 1800 })
    } else {
      timeoutId = window.setTimeout(runWarmup, 450)
    }

    return () => {
      cancelled = true
      if (idleId != null && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleId)
      }
      if (timeoutId != null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [user])
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

    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="text-5xl mb-4">!</div>
        <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-2">Page failed to load</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 max-w-sm font-mono bg-gray-100 dark:bg-gray-800 rounded-lg p-3 text-left break-words">
          {this.state.error.message || String(this.state.error)}
        </p>
        <button className="btn-primary" onClick={() => this.setState({ error: null })}>
          Retry
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
  const { user, page, notification, canAccessPage, AccessDenied, setPage, settings } = useApp()
  const { syncError, clearSyncError } = useSyncErrorBanner()
  const mountedPages = useMountedPages(page)

  useVisibilityRecovery()
  useChunkWarmup(user)

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
