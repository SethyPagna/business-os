import assert from 'node:assert/strict'
import fs from 'node:fs'

const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const appContext = fs.readFileSync(new URL('../src/AppContext.tsx', import.meta.url), 'utf8')
const index = fs.readFileSync(new URL('../src/index.tsx', import.meta.url), 'utf8')
const webApi = fs.readFileSync(new URL('../src/web-api.ts', import.meta.url), 'utf8')
const httpApi = fs.readFileSync(new URL('../src/api/http.ts', import.meta.url), 'utf8')
const websocketApi = fs.readFileSync(new URL('../src/api/websocket.ts', import.meta.url), 'utf8')
const appBootstrapTransport = fs.readFileSync(new URL('../src/api/appBootstrapTransport.ts', import.meta.url), 'utf8')
const contactReadTransport = fs.readFileSync(new URL('../src/api/contactReadTransport.ts', import.meta.url), 'utf8')
const contactWriteTransport = fs.readFileSync(new URL('../src/api/contactWriteTransport.ts', import.meta.url), 'utf8')
const saleWriteTransport = fs.readFileSync(new URL('../src/api/saleWriteTransport.ts', import.meta.url), 'utf8')
const productWriteTransport = fs.readFileSync(new URL('../src/api/productWriteTransport.ts', import.meta.url), 'utf8')
const productImageUploadTransport = fs.readFileSync(new URL('../src/api/productImageUploadTransport.ts', import.meta.url), 'utf8')
const offlineSnapshotTransport = fs.readFileSync(new URL('../src/api/offlineSnapshotTransport.ts', import.meta.url), 'utf8')
const apiMethods = fs.readFileSync(new URL('../src/api/methods.ts', import.meta.url), 'utf8')
const localMirrors = fs.readFileSync(new URL('../src/api/localMirrors.ts', import.meta.url), 'utf8')
const clientRuntime = fs.readFileSync(new URL('../src/platform/runtime/clientRuntime.ts', import.meta.url), 'utf8')
const viteConfig = fs.readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')
const sidebar = fs.readFileSync(new URL('../src/components/navigation/Sidebar.tsx', import.meta.url), 'utf8')
const appShellUtils = fs.readFileSync(new URL('../src/app/appShellUtils.ts', import.meta.url), 'utf8')
const dashboard = fs.readFileSync(new URL('../src/components/dashboard/Dashboard.tsx', import.meta.url), 'utf8')
const exportMenu = fs.readFileSync(new URL('../src/components/shared/ExportMenu.tsx', import.meta.url), 'utf8')
const filterMenu = fs.readFileSync(new URL('../src/components/shared/FilterMenu.tsx', import.meta.url), 'utf8')
const lazyPortalMenu = fs.readFileSync(new URL('../src/components/shared/LazyPortalMenu.tsx', import.meta.url), 'utf8')
const portalMenu = fs.readFileSync(new URL('../src/components/shared/PortalMenu.tsx', import.meta.url), 'utf8')
const catalogPreviewSurface = fs.readFileSync(new URL('../src/components/catalog/CatalogPreviewSurface.tsx', import.meta.url), 'utf8')
const inventory = fs.readFileSync(new URL('../src/components/inventory/Inventory.tsx', import.meta.url), 'utf8')
const backup = fs.readFileSync(new URL('../src/components/utils-settings/Backup.tsx', import.meta.url), 'utf8')
const auditLog = fs.readFileSync(new URL('../src/components/utils-settings/AuditLog.tsx', import.meta.url), 'utf8')
const settingsPage = fs.readFileSync(new URL('../src/components/utils-settings/Settings.tsx', import.meta.url), 'utf8')
const otpModal = fs.readFileSync(new URL('../src/components/utils-settings/OtpModal.tsx', import.meta.url), 'utf8')
const resetData = fs.readFileSync(new URL('../src/components/utils-settings/ResetData.tsx', import.meta.url), 'utf8')
const mediaUpload = fs.readFileSync(new URL('../src/utils/mediaUpload.ts', import.meta.url), 'utf8')
const mediaUploadState = fs.readFileSync(new URL('../src/utils/mediaUploadState.ts', import.meta.url), 'utf8')
const serverPage = fs.readFileSync(new URL('../src/components/server/ServerPage.tsx', import.meta.url), 'utf8')
const receiptSettingsPage = fs.readFileSync(new URL('../src/components/receipt-settings/ReceiptSettings.tsx', import.meta.url), 'utf8')
const receiptPreview = fs.readFileSync(new URL('../src/components/receipt-settings/ReceiptPreview.tsx', import.meta.url), 'utf8')
const receipt = fs.readFileSync(new URL('../src/components/receipt/Receipt.tsx', import.meta.url), 'utf8')
const contacts = fs.readFileSync(new URL('../src/components/contacts/Contacts.tsx', import.meta.url), 'utf8')
const contactsShared = fs.readFileSync(new URL('../src/components/contacts/shared.tsx', import.meta.url), 'utf8')
const contactImportModal = fs.readFileSync(new URL('../src/components/contacts/ContactImportModal.tsx', import.meta.url), 'utf8')
const customers = fs.readFileSync(new URL('../src/components/contacts/CustomersTab.tsx', import.meta.url), 'utf8')
const customerFormModal = fs.readFileSync(new URL('../src/components/contacts/CustomerFormModal.tsx', import.meta.url), 'utf8')
const customerMembershipNumber = fs.readFileSync(new URL('../src/components/contacts/customerMembershipNumber.ts', import.meta.url), 'utf8')
const suppliers = fs.readFileSync(new URL('../src/components/contacts/SuppliersTab.tsx', import.meta.url), 'utf8')
const delivery = fs.readFileSync(new URL('../src/components/contacts/DeliveryTab.tsx', import.meta.url), 'utf8')
const pos = fs.readFileSync(new URL('../src/components/pos/POS.tsx', import.meta.url), 'utf8')
const posFilterPanel = fs.readFileSync(new URL('../src/components/pos/FilterPanel.tsx', import.meta.url), 'utf8')
const sales = fs.readFileSync(new URL('../src/components/sales/Sales.tsx', import.meta.url), 'utf8')
const salesExportModal = fs.readFileSync(new URL('../src/components/sales/ExportModal.tsx', import.meta.url), 'utf8')
const salesImportModal = fs.readFileSync(new URL('../src/components/sales/SalesImportModal.tsx', import.meta.url), 'utf8')
const returns = fs.readFileSync(new URL('../src/components/returns/Returns.tsx', import.meta.url), 'utf8')
const newReturnModal = fs.readFileSync(new URL('../src/components/returns/NewReturnModal.tsx', import.meta.url), 'utf8')
const editReturnModal = fs.readFileSync(new URL('../src/components/returns/EditReturnModal.tsx', import.meta.url), 'utf8')
const newSupplierReturnModal = fs.readFileSync(new URL('../src/components/returns/NewSupplierReturnModal.tsx', import.meta.url), 'utf8')
const branches = fs.readFileSync(new URL('../src/components/branches/Branches.tsx', import.meta.url), 'utf8')
const transferModal = fs.readFileSync(new URL('../src/components/branches/TransferModal.tsx', import.meta.url), 'utf8')
const catalogPage = fs.readFileSync(new URL('../src/components/catalog/CatalogPage.tsx', import.meta.url), 'utf8')
const products = fs.readFileSync(new URL('../src/components/products/Products.tsx', import.meta.url), 'utf8')
const productsHeaderActions = fs.readFileSync(new URL('../src/components/products/surfaces/HeaderActions.tsx', import.meta.url), 'utf8')
const productRowParts = fs.readFileSync(new URL('../src/components/products/surfaces/ProductRowParts.tsx', import.meta.url), 'utf8')
const productPageConfig = fs.readFileSync(new URL('../src/components/products/config/productPageConfig.ts', import.meta.url), 'utf8')
const inventoryImportModal = fs.readFileSync(new URL('../src/components/inventory/InventoryImportModal.tsx', import.meta.url), 'utf8')
const productForm = fs.readFileSync(new URL('../src/components/products/forms/ProductForm.tsx', import.meta.url), 'utf8')
const bulkImportModal = fs.readFileSync(new URL('../src/components/products/import/BulkImportModal.tsx', import.meta.url), 'utf8')
const manageCategoriesModal = fs.readFileSync(new URL('../src/components/products/lookups/ManageCategoriesModal.tsx', import.meta.url), 'utf8')
const manageUnitsModal = fs.readFileSync(new URL('../src/components/products/lookups/ManageUnitsModal.tsx', import.meta.url), 'utf8')
const manageBrandsModal = fs.readFileSync(new URL('../src/components/products/lookups/ManageBrandsModal.tsx', import.meta.url), 'utf8')
const productLookupSnapshots = fs.readFileSync(new URL('../src/components/products/lookups/productLookupSnapshots.ts', import.meta.url), 'utf8')
const filesPage = fs.readFileSync(new URL('../src/components/files/FilesPage.tsx', import.meta.url), 'utf8')
const filePickerModal = fs.readFileSync(new URL('../src/components/files/FilePickerModal.tsx', import.meta.url), 'utf8')
const loyaltyPointsPage = fs.readFileSync(new URL('../src/components/loyalty-points/LoyaltyPointsPage.tsx', import.meta.url), 'utf8')
const usersPage = fs.readFileSync(new URL('../src/components/users/Users.tsx', import.meta.url), 'utf8')
const userProfileModal = fs.readFileSync(new URL('../src/components/users/UserProfileModal.tsx', import.meta.url), 'utf8')
const backgroundImportTracker = fs.readFileSync(new URL('../src/components/shared/BackgroundImportTracker.tsx', import.meta.url), 'utf8')
const notificationCenter = fs.readFileSync(new URL('../src/components/shared/NotificationCenter.tsx', import.meta.url), 'utf8')
const actionHistory = fs.readFileSync(new URL('../src/utils/actionHistory.ts', import.meta.url), 'utf8')
const actionHistoryTransport = fs.readFileSync(new URL('../src/api/actionHistoryTransport.ts', import.meta.url), 'utf8')
const loaders = fs.readFileSync(new URL('../src/utils/loaders.ts', import.meta.url), 'utf8')

assert.match(app, /const WARMUP_PAGE_IDS[^=]*= \[\] satisfies PageId\[\]/, 'dashboard startup should not background-load route chunks before user intent')
assert.match(appContext, /import \{ APP_NAVIGATION_EVENT, getAdminPageFromPath, getAdminPathForPage \} from '\.\/app\/appShellUtils\.ts'/, 'app context should be able to derive the initial route page before the shell mounts')
assert.match(appContext, /function getInitialAdminPage\(publicMode: boolean\): string \{[\s\S]*getAdminPageFromPath\(window\.location\.pathname\) \|\| 'dashboard'[\s\S]*\}/, 'direct admin URLs should initialize the active page without briefly mounting Dashboard first')
assert.match(appContext, /const \[page,\s+setPage\]\s+= useState\(\(\) => getInitialAdminPage\(publicMode\)\)/, 'initial active page state should come from the current URL')
assert.match(app, /const NARROW_PAGE_ENTRY_WARMUP_IDS[\s\S]*'sales',[\s\S]*'returns',/, 'Sales and Returns should use narrow delayed page-entry warmup instead of pulling the later admin stack immediately')
assert.match(app, /Page bundle is still loading/, 'page loader should explain stalled chunk loads')
assert.match(app, /console\.warn\('\[PageLoader\]/, 'page loader should expose diagnostic breadcrumbs')
assert.match(app, /const CHUNK_IMPORT_TIMEOUT_MS = 15000/, 'chunk timeout should allow slow mobile networks before showing stalled UI')
assert.match(app, /const INTENT_CHUNK_IMPORT_TIMEOUT_MS = 7000/, 'navigation intent warmup should have a short chunk timeout')
assert.match(app, /const INTENT_CHUNK_WARMUP_DELAY_MS = 80/, 'navigation intent warmup should debounce accidental pointer passes')
assert.match(app, /const APP_FAVICON_PROCESSING_DELAY_MS = 1800/, 'custom favicon canvas processing should be deferred past first paint')
assert.match(app, /const APP_FAVICON_IDLE_TIMEOUT_MS = 7000/, 'deferred custom favicon processing should still run even if idle time is scarce')
assert.match(app, /iconEl\.setAttribute\('href', iconSource\)[\s\S]*window\.requestIdleCallback\(processFavicon, \{ timeout: APP_FAVICON_IDLE_TIMEOUT_MS \}\)/, 'app should show the plain favicon immediately and defer circular canvas processing')
assert.doesNotMatch(app, /import \{ createCircularFaviconDataUrl \} from '\.\/utils\/favicon\.ts'/, 'app shell should not statically import favicon canvas helpers during startup')
assert.match(app, /const \{ createCircularFaviconDataUrl \} = await import\('\.\/utils\/favicon\.ts'\)/, 'app shell should load favicon canvas helpers only inside the delayed idle task')
assert.doesNotMatch(app, /async function loadFavicon\(\)[\s\S]{0,700}\n\s*loadFavicon\(\)/, 'app should not process the custom favicon synchronously during shell startup')
assert.match(app, /const PENDING_SYNC_INITIAL_REFRESH_DELAY_MS = 30000/, 'initial pending-sync read should stay out of the first-load network window')
assert.match(app, /const PENDING_SYNC_IDLE_TIMEOUT_MS = 45000/, 'deferred pending-sync read should still run during a long-lived session')
assert.match(app, /const PENDING_SYNC_POLL_INTERVAL_MS = 20_000/, 'pending-sync polling cadence should stay explicit')
assert.match(app, /function useSyncErrorBanner\(user: AppUser \| null\)/, 'pending sync polling should know whether an authenticated user exists')
assert.match(app, /if \(!user \|\| typeof window === 'undefined'\) \{[\s\S]*setPendingSync\(null\)[\s\S]*return undefined[\s\S]*const refreshPendingSync = \(\) => \{[\s\S]*getAppShellApi\(\)\.getPendingSyncState/, 'logged-out startup should not register sync banner listeners or load the full API registry just to read pending sync')
assert.match(app, /function scheduleDeferredPendingSyncPolling\(refresh: \(\) => void\): CancelWarmup \{[\s\S]*window\.setTimeout\(\(\) => \{[\s\S]*window\.setInterval\(refresh, PENDING_SYNC_POLL_INTERVAL_MS\)[\s\S]*PENDING_SYNC_INITIAL_REFRESH_DELAY_MS/, 'pending sync polling should be created only after the initial startup window')
assert.match(app, /const cancelInitialPendingSyncRefresh = scheduleInitialPendingSyncRefresh\(refreshPendingSync\)[\s\S]*const cancelPendingSyncPolling = scheduleDeferredPendingSyncPolling\(refreshPendingSync\)/, 'pending sync refresh and polling should both stay behind the authenticated guard')
assert.doesNotMatch(app, /const timer = window\.setInterval\(refreshPendingSync, 20_000\)/, 'pending sync polling should not allocate an immediate first-paint interval')
assert.match(app, /\}, \[user\]\)/, 'pending sync listeners should re-evaluate when bootstrap validates or clears the stored user')
assert.match(appContext, /const hasRecoverableSession = !!\(user\?\.id \|\| getStoredUserPayload\(\)\)[\s\S]*if \(!hasRecoverableSession\) \{[\s\S]*return undefined[\s\S]*const quickCheck = window\.setTimeout\(poll, 100\)/, 'signed-out startup should skip sync listeners and websocket polling until a stored or active user exists')
assert.match(httpApi, /let healthLifecycleListenersRegistered = false/, 'health lifecycle listeners should be one-shot and not module-load work')
assert.match(httpApi, /export function startHealthCheck\(\): void \{\s*ensureHealthLifecycleListeners\(\)/, 'health lifecycle listeners should install only when authenticated health polling starts')
assert.match(httpApi, /export function ensureHealthLifecycleListeners\(\): void \{[\s\S]*healthLifecycleListenersRegistered[\s\S]*window\.addEventListener\('offline', \(\) => setServerHealth\(false\)\)/, 'health lifecycle listeners should keep only the immediate offline health flip')
assert.doesNotMatch(httpApi, /window\.addEventListener\('online'[\s\S]{0,160}pingServerHealth/, 'HTTP module should not duplicate web-api online recovery listeners')
assert.doesNotMatch(httpApi, /window\.addEventListener\('focus'[\s\S]{0,160}pingServerHealth/, 'HTTP module should not duplicate web-api focus recovery listeners')
assert.doesNotMatch(httpApi, /document\.addEventListener\('visibilitychange'[\s\S]{0,220}pingServerHealth/, 'HTTP module should not duplicate web-api visibility recovery listeners')
assert.doesNotMatch(httpApi, /if \(typeof window !== 'undefined'\) \{\s*window\.addEventListener\('online'/, 'signed-out startup should not register health online/focus lifecycle listeners at module load')
assert.match(httpApi, /let localPromise: Promise<T \| null> \| null = null[\s\S]*const startLocalRead = \(\): Promise<T \| null> => \{[\s\S]*Promise\.resolve\(\)[\s\S]*\.then\(\(\) => localFn\(\)\)/, 'server read fallback should lazy-start local storage only through the fallback helper')
assert.match(httpApi, /const HEALTHY_SERVER_LOCAL_FALLBACK_MS = 1_200/, 'healthy live server reads should wait longer before waking the offline DB fallback')
assert.match(httpApi, /fallbackTimer = window\.setTimeout\(async \(\) => \{[\s\S]*const localResult = await startLocalRead\(\)[\s\S]*\}, fallbackDelayMs\)/, 'local fallback should not import Dexie until the selected fallback timer actually fires')
assert.match(httpApi, /raceServerReadWithLocalFallback\(channel, promise, localFn, t0, '', HEALTHY_SERVER_LOCAL_FALLBACK_MS\)/, 'fresh healthy server reads should use the longer local fallback delay')
assert.doesNotMatch(httpApi, /const localPromise = Promise\.resolve\(\)\s*\.then\(\(\) => localFn\(\)\)/, 'healthy server reads should not eagerly start the local fallback promise')
assert.match(websocketApi, /let wsLifecycleListenersRegistered = false/, 'websocket lifecycle listeners should be one-shot and not module-load work')
assert.match(websocketApi, /export function connectWS\(\): void \{\s*ensureWebSocketLifecycleListeners\(\)/, 'websocket lifecycle listeners should install only when an authenticated websocket connection starts')
assert.match(websocketApi, /export function resumeWS\(\): void \{[\s\S]*wsSuppressReconnectUntil = 0[\s\S]*reconnectAttempts = 0[\s\S]*reconnectWS\(\)/, 'central session recovery should have a websocket resume helper that clears reconnect suppression')
assert.match(websocketApi, /export function ensureWebSocketLifecycleListeners\(\): void \{[\s\S]*!hasStoredAuthSession\(\)[\s\S]*window\.addEventListener\('auth:unauthorized'/, 'websocket auth lifecycle listener should live behind an authenticated explicit installer')
assert.doesNotMatch(websocketApi, /window\.addEventListener\('online'[\s\S]{0,160}connectWS/, 'websocket module should not duplicate web-api online recovery listeners')
assert.doesNotMatch(websocketApi, /window\.addEventListener\('focus'[\s\S]{0,160}connectWS/, 'websocket module should not duplicate web-api focus recovery listeners')
assert.doesNotMatch(websocketApi, /document\.addEventListener\('visibilitychange'[\s\S]{0,240}connectWS/, 'websocket module should not duplicate web-api visibility recovery listeners')
assert.doesNotMatch(websocketApi, /if \(typeof window !== 'undefined'[\s\S]{0,120}\) \{\s*window\.addEventListener\('auth:unauthorized'/, 'signed-out startup should not register websocket auth and reconnect lifecycle listeners at module load')
assert.match(app, /const NOTIFICATION_CENTER_INITIAL_MOUNT_DELAY_MS = 30000/, 'notification center chunk should stay out of the first-load network window unless clicked')
assert.match(app, /const NOTIFICATION_CENTER_IDLE_TIMEOUT_MS = 45000/, 'deferred notification center should still wake during a long-lived session')
assert.match(app, /const IMPORT_TRACKER_INITIAL_MOUNT_DELAY_MS = 180000/, 'global import tracker chunk should stay out of short-session first-load windows unless import activity wakes it')
assert.match(app, /const IMPORT_TRACKER_IDLE_TIMEOUT_MS = 60000/, 'deferred import tracker should still wake during a long-lived session')
assert.match(app, /function scheduleInitialPendingSyncRefresh\(refresh: \(\) => void\): CancelWarmup/, 'pending-sync startup refresh should use a cancellable idle scheduler')
assert.match(app, /window\.requestIdleCallback\(run, \{ timeout: PENDING_SYNC_IDLE_TIMEOUT_MS \}\)/, 'pending-sync startup refresh should prefer idle time')
assert.match(app, /if \(!user \|\| typeof window === 'undefined'\) \{[\s\S]*return undefined[\s\S]*const cancelInitialPendingSyncRefresh = scheduleInitialPendingSyncRefresh\(refreshPendingSync\)/, 'sync banner should not import API methods or register listeners during logged-out first shell render')
assert.doesNotMatch(app, /window\.addEventListener\('sync:queue-changed'[\s\S]{0,500}\n\s*refreshPendingSync\(\)\n\s*const timer/, 'sync banner should defer the first pending-sync read instead of running it synchronously')
assert.match(app, /function useDeferredImportTrackerMount\(user: AppUser \| null\): boolean/, 'background import tracker should mount through an explicit deferred hook')
assert.match(app, /if \(event\.type === 'import-job:activity'\) return true/, 'deferred import tracker should wake immediately on explicit import-job activity')
assert.match(app, /window\.addEventListener\('import-job:activity', onImportJobActivity\)/, 'import tracker should not depend on generic app sync events to detect local import activity')
assert.doesNotMatch(app, /function useDeferredImportTrackerMount[\s\S]*window\.addEventListener\('sync:update'[\s\S]*function useDeferredNotificationCenterMount/, 'background import tracker should not wake from generic sync:update events')
assert.match(app, /if \(!\(channel === 'importjobs' \|\| channel === 'import_jobs' \|\| channel === 'imports'\)\) return false[\s\S]*reason\.includes\('import'\)[\s\S]*source\.includes\('import'\)/, 'remote import sync wakeups should require import metadata instead of a bare imports channel')
assert.doesNotMatch(app, /function useDeferredImportTrackerMount[\s\S]*document\.addEventListener\('visibilitychange'[\s\S]*function useDeferredNotificationCenterMount/, 'visibility changes should not eagerly mount the import tracker chunk')
assert.doesNotMatch(app, /return \[[^\]]*products[^\]]*\]\.includes\(channel\)[\s\S]{0,120}function isImportTrackerWakeEvent/, 'generic products or inventory sync should not wake the background import tracker chunk')
assert.match(app, /window\.requestIdleCallback\(enableWhenVisible, \{ timeout: IMPORT_TRACKER_IDLE_TIMEOUT_MS \}\)/, 'deferred import tracker should prefer idle time before loading its chunk')
assert.match(app, /const shouldMountImportTracker = useDeferredImportTrackerMount\(authReady \? user : null\)/, 'app shell should gate import tracker mounting behind the deferred hook')
assert.match(app, /\{shouldMountImportTracker \? \(\s*<Suspense fallback=\{null\}>\s*<BackgroundImportTracker \/>/m, 'import tracker chunk should not render until the deferred gate opens')
assert.doesNotMatch(backgroundImportTracker, /trash-2\.js/, 'background import tracker should not own shared Settings trash icon code and force eager tracker chunk fetches')
assert.match(app, /function useDeferredNotificationCenterMount\(user: AppUser \| null\): \{[\s\S]*shouldMountNotificationCenter: boolean[\s\S]*requestNotificationCenterMount: \(\) => void[\s\S]*\}/, 'notification center should mount through an explicit deferred hook')
assert.match(app, /if \(event\.type === 'notification:activity'\) return true/, 'deferred notification center should wake immediately on explicit notification activity')
assert.match(app, /window\.addEventListener\('notification:activity', onNotificationActivity\)/, 'notification center should have an explicit wake event for notification-specific changes')
assert.match(app, /channel === 'notifications'[\s\S]*detail\?\.notificationSummary[\s\S]*reason\.includes\('notification'\)[\s\S]*source\.includes\('notification'\)/, 'notification sync wakeups should require notification metadata instead of broad data channels')
assert.doesNotMatch(app, /return \[[^\]]*inventory[^\]]*sales[^\]]*returns[^\]]*\]\.includes\(channel\)/, 'generic inventory, sales, and returns sync events should not wake the notification center chunk')
assert.match(app, /window\.requestIdleCallback\(enableWhenVisible, \{ timeout: NOTIFICATION_CENTER_IDLE_TIMEOUT_MS \}\)/, 'deferred notification center should prefer idle time before loading its chunk')
assert.match(app, /const \{\s*notificationCenterOpenRequestId,[\s\S]*shouldMountNotificationCenter,[\s\S]*requestNotificationCenterMount,[\s\S]*\} = useDeferredNotificationCenterMount\(authReady \? user : null\)/, 'app shell should gate notification center mounting behind the deferred hook')
assert.match(app, /<NotificationCenter compact openRequestId=\{notificationCenterOpenRequestId\} visibility="desktop" \/>/, 'first click on the deferred desktop notification bell should open the mounted notification panel')
assert.match(app, /<NotificationCenter compact openRequestId=\{notificationCenterOpenRequestId\} visibility="mobile" \/>/, 'first click on the deferred mobile notification bell should open the mounted notification panel')
assert.match(app, /const desktopNotificationSlot = shouldMountNotificationCenter \? \(\s*<Suspense fallback=\{<NotificationCenterFallback compact \/>\}>\s*<NotificationCenter compact openRequestId=\{notificationCenterOpenRequestId\} visibility="desktop" \/>/m, 'desktop notification center chunk should not render until the deferred gate opens')
assert.match(app, /const mobileNotificationSlot = shouldMountNotificationCenter \? \(\s*<Suspense fallback=\{<NotificationCenterFallback compact \/>\}>\s*<NotificationCenter compact openRequestId=\{notificationCenterOpenRequestId\} visibility="mobile" \/>/m, 'mobile notification center chunk should not render until the deferred gate opens')
assert.match(app, /<NotificationCenterFallback compact onClick=\{requestNotificationCenterMount\} \/>/, 'notification fallback should still let the user load notifications immediately')
assert.match(app, /\{writeConflict \? \(\s*<Suspense fallback=\{null\}>\s*<WriteConflictModal/m, 'write-conflict modal chunk should not load until a conflict exists')
assert.doesNotMatch(app, /<Suspense fallback=\{null\}>\s*<WriteConflictModal[\s\S]*<\/Suspense>\s*<SyncErrorBanner/, 'write-conflict modal should not be rendered unconditionally during startup')
assert.match(app, /window\.addEventListener\(APP_PAGE_INTENT_EVENT, warmIntentPage\)/, 'app shell should warm the exact route chunk on navigation intent')
assert.match(app, /scheduleIntentChunkLoad/, 'navigation intent should use a bounded chunk warmup helper')
assert.match(app, /shouldSkipIntentWarmup/, 'navigation intent warmup should respect visibility and slow-network signals')
assert.match(app, /function scheduleWarmupAfterLoad\(start: \(\) => CancelWarmup \| void\): CancelWarmup \{[\s\S]*document\.readyState === 'complete'[\s\S]*window\.addEventListener\('load', run, \{ once: true \}\)/, 'background route warmups should wait until the current page has finished loading')
assert.match(app, /const importers = getWarmupImporters\(\)\s*\n\s*if \(!importers\.length\) return undefined[\s\S]*const cancelAfterLoad = scheduleWarmupAfterLoad/, 'primary route chunk warmup should skip empty work and schedule only after load')
assert.match(app, /const loaders = getDataWarmupLoaders\(canAccessPage\)\s*\n\s*if \(!loaders\.length\) return undefined/, 'empty data warmup plans should not allocate timers')
assert.match(app, /const cancelAfterLoad = scheduleWarmupAfterLoad\(\(\) => \{[\s\S]*shouldNarrowWarmup[\s\S]*window\.requestIdleCallback\(run, \{ timeout: 2500 \}\)/, 'page-entry chunk warmup should also wait until after load before scheduling idle imports')
assert.match(appShellUtils, /export const APP_PAGE_INTENT_EVENT = 'bos:page-intent'/, 'navigation intent event should live in shared app shell utils')
assert.match(sidebar, /APP_PAGE_INTENT_EVENT/, 'sidebar should publish navigation intent before route clicks')
assert.doesNotMatch(sidebar, /import NotificationCenter from '\.\.\/shared\/NotificationCenter'/, 'mobile sidebar should not statically import the notification center chunk')
assert.match(sidebar, /notificationSlot\?: ReactNode/, 'mobile sidebar should receive notification UI from the app-level lazy gate')
assert.match(app, /const mobileNotificationSlot = shouldMountNotificationCenter \? \(/, 'mobile notification center should share the deferred app-level mount gate')
assert.match(app, /<Sidebar notificationSlot=\{mobileNotificationSlot\} \/>/, 'app shell should pass the deferred mobile notification slot into Sidebar')
assert.doesNotMatch(sidebar, /import UserProfileModalComponent from '\.\.\/users\/UserProfileModal'/, 'sidebar should not statically import the profile modal and file picker stack during startup')
assert.match(sidebar, /const UserProfileModal = lazy\(async \(\) => \(\{\s*default: \(await import\('\.\.\/users\/UserProfileModal'\)\)\.default as ComponentType<UserProfileModalProps>,\s*\}\)\)/m, 'profile modal should load only when the user opens it')
assert.match(sidebar, /<Suspense fallback=\{null\}>\s*<UserProfileModal onClose=\{\(\) => setProfileOpen\(false\)\} \/>/m, 'lazy profile modal should still render when opened')
assert.match(sidebar, /onPointerEnter=\{\(\) => announcePageIntent\(item\.id, 'pointer'\)\}/, 'desktop navigation should warm route chunks on pointer intent')
assert.match(sidebar, /onTouchStart=\{\(\) => announcePageIntent\(item\.id, 'touch'\)\}/, 'mobile navigation should warm route chunks on touch intent')
assert.match(app, /buildChunkRecoveryUrl/, 'chunk recovery should use a cache-busting recovery URL')
assert.match(app, /const STALE_SHELL_CACHE_DELETE_CONCURRENCY = 2/, 'chunk recovery should bound stale shell cache deletion')
assert.match(app, /const STARTUP_STORAGE_CLEANUP_DELAY_MS = 2000/, 'startup retry marker cleanup should be deferred past first paint')
assert.match(app, /const STARTUP_STORAGE_CLEANUP_IDLE_TIMEOUT_MS = 9000/, 'deferred startup retry marker cleanup should still run even if idle time is scarce')
assert.match(app, /const cleanupRecoveryStorageMarkers = \(\) => \{[\s\S]*Object\.keys\(window\.sessionStorage\)[\s\S]*window\.requestIdleCallback\(cleanupRecoveryStorageMarkers, \{ timeout: STARTUP_STORAGE_CLEANUP_IDLE_TIMEOUT_MS \}\)/, 'startup retry marker cleanup should enumerate sessionStorage only after delay/idle')
assert.doesNotMatch(app, /window\.history\.replaceState[\s\S]{0,180}\n\s*try\s*\{\s*Object\.keys\(window\.sessionStorage\)/, 'successful boot should not enumerate sessionStorage synchronously after URL cleanup')
assert.match(app, /async function deleteStaleShellCaches/, 'chunk recovery should use a bounded stale cache deletion helper')
assert.match(app, /Math\.min\(STALE_SHELL_CACHE_DELETE_CONCURRENCY, keys\.length\)/, 'stale cache deletion should cap worker count')
assert.match(app, /await deleteStaleShellCaches\(/, 'chunk recovery should delete stale shell caches through the bounded helper')
assert.doesNotMatch(app, /Promise\.all\(\s*keys\s*\.filter\(\(key\) => key\.startsWith\('business-os-app-shell-'\)/, 'chunk recovery should not delete every stale shell cache at once')
assert.match(app, /window\.history\.replaceState/, 'successful boot should clean recovery params from the URL')
assert.match(app, /business_os_page_loader_warning:\$\{window\.location\.pathname\}:\$\{FRONTEND_BUILD_HASH \|\| 'dev'\}/, 'page loader warnings should be scoped per build hash')
assert.match(app, /window\.location\.replace\(target\)/, 'failed chunk recovery should use hard location replacement')
assert.match(index, /const SERVICE_WORKER_REGISTER_IDLE_TIMEOUT_MS = 5000/, 'service worker registration should be delayed until after load and idle time')
assert.match(index, /const SERVICE_WORKER_REGISTER_FALLBACK_DELAY_MS = 1200/, 'service worker registration should still run without idle callback support')
assert.match(index, /const FORM_FIELD_ACCESSIBILITY_IDLE_TIMEOUT_MS = 3000/, 'form accessibility wiring should be delayed until after first render')
assert.match(index, /function scheduleAfterLoadIdle\(task: \(\) => void, idleTimeoutMs: number, fallbackDelayMs: number\)/, 'startup helpers should share an after-load idle scheduler')
assert.match(index, /scheduleAfterLoadIdle\(\s*\(\) => \{ register\(\)\.catch\(\(\) => \{\}\) \},\s*SERVICE_WORKER_REGISTER_IDLE_TIMEOUT_MS,\s*SERVICE_WORKER_REGISTER_FALLBACK_DELAY_MS,\s*\)/, 'service worker registration should use the after-load idle scheduler')
assert.match(index, /scheduleAfterLoadIdle\(\s*installFormFieldAccessibility,\s*FORM_FIELD_ACCESSIBILITY_IDLE_TIMEOUT_MS,\s*FORM_FIELD_ACCESSIBILITY_FALLBACK_DELAY_MS,\s*\)/, 'form field accessibility scan should use the after-load idle scheduler')
assert.match(index, /ReactDOM\.createRoot\(rootElement\)\.render\([\s\S]*\)\s*\n\s*registerOfflineAppShell\(\)\s*\n\s*scheduleFormFieldAccessibility\(\)/, 'React should render before startup maintenance jobs are scheduled')
assert.doesNotMatch(index, /registerOfflineAppShell\(\)\s*\n\s*scheduleFormFieldAccessibility\(\)\s*\n\s*const publicCatalogMode/, 'startup maintenance jobs should not be scheduled before root render setup')
assert.match(webApi, /const INITIAL_OFFLINE_MAINTENANCE_DELAY_MS = 45_000/, 'offline queue and snapshot maintenance should stay out of the first-load network window')
assert.match(webApi, /const INITIAL_OFFLINE_MAINTENANCE_IDLE_TIMEOUT_MS = 60_000/, 'initial offline maintenance should still run during a long-lived authenticated session')
assert.match(webApi, /const BOOTSTRAP_STORAGE_MAINTENANCE_DELAY_MS = 2200/, 'bootstrap storage cleanup and persistence should be delayed past first paint')
assert.match(webApi, /const BOOTSTRAP_STORAGE_MAINTENANCE_IDLE_TIMEOUT_MS = 9000/, 'bootstrap storage maintenance should still run when idle time is scarce')
assert.match(webApi, /const BOOTSTRAP_OFFLINE_DB_WRITE_DELAY_MS = 45_000/, 'bootstrap IndexedDB mirror writes should wait until the visible app has settled')
assert.match(webApi, /const BOOTSTRAP_OFFLINE_DB_WRITE_IDLE_TIMEOUT_MS = 60_000/, 'bootstrap IndexedDB mirror writes should still eventually run during long-lived sessions')
assert.match(localMirrors, /const MIRROR_WRITE_IDLE_DELAY_MS = 10_000/, 'route mirror writes should wait beyond the first route and first interaction windows before waking IndexedDB')
assert.doesNotMatch(webApi, /import \{ dexieDb \}\s+from '\.\/api\/localDb\.ts'/, 'web API startup should not statically import Dexie/local DB')
assert.match(webApi, /let localDbPromise: Promise<any> \| null = null[\s\S]*function getOfflineDb\(\): Promise<any> \{[\s\S]*import\('\.\/api\/localDb\.ts'\)\.then\(\(module\) => module\.dexieDb as any\)/, 'web API should lazy-load Dexie/local DB only for offline or persisted settings work')
assert.match(webApi, /function loadAppBootstrapModule\(\): Promise<AppBootstrapModule> \{[\s\S]*import\('\.\/api\/appBootstrapTransport\.ts'\)/, 'app bootstrap should have a direct lazy transport instead of loading the full API registry')
assert.match(webApi, /type AuthTransportModule = typeof import\('\.\/api\/authTransport\.ts'\)/, 'login and organization bootstrap should have a narrow auth transport boundary')
assert.match(webApi, /function loadAuthTransportModule\(\): Promise<AuthTransportModule> \{[\s\S]*import\('\.\/api\/authTransport\.ts'\)/, 'auth transport should lazy-load independently of the full API registry')
assert.match(webApi, /getVerificationCapabilities: getAuthTransportMethod\('getVerificationCapabilities'\)[\s\S]*getOrganizationBootstrap: getAuthTransportMethod\('getOrganizationBootstrap'\)[\s\S]*searchOrganizations: getAuthTransportMethod\('searchOrganizations'\)/, 'sign-in page auth lookups should not route through app-api-methods')
assert.match(webApi, /type PortalTransportModule = typeof import\('\.\/api\/portalTransport\.ts'\)/, 'public portal calls should have a narrow transport boundary')
assert.match(webApi, /function loadPortalTransportModule\(\): Promise<PortalTransportModule> \{[\s\S]*import\('\.\/api\/portalTransport\.ts'\)/, 'public portal transport should lazy-load independently of the full API registry')
assert.match(webApi, /getPortalConfig: getPortalTransportMethod\('getPortalConfig'\)[\s\S]*searchPortalCatalogProducts: getPortalTransportMethod\('searchPortalCatalogProducts'\)[\s\S]*askPortalAi: getPortalTransportMethod\('askPortalAi'\)/, 'public portal reads and actions should not route through app-api-methods or Dexie')
assert.match(webApi, /type SystemRuntimeModule = typeof import\('\.\/api\/systemRuntime\.ts'\)/, 'server diagnostics should have a narrow system runtime boundary')
assert.match(webApi, /function loadSystemRuntimeModule\(\): Promise<SystemRuntimeModule> \{[\s\S]*import\('\.\/api\/systemRuntime\.ts'\)/, 'system runtime should lazy-load independently of the full API registry')
assert.match(webApi, /getSystemConfig: getSystemRuntimeMethod\('getSystemConfig'\)[\s\S]*getSystemBootstrap: getSystemRuntimeMethod\('getSystemBootstrap'\)[\s\S]*getSystemDebugLog: getSystemRuntimeMethod\('getSystemDebugLog'\)[\s\S]*testSyncServer: getSystemRuntimeMethod\('testSyncServer'\)/, 'server bootstrap and diagnostics should not route through app-api-methods or Dexie')
assert.match(webApi, /async getAppBootstrap\(\) \{[\s\S]*const module = await loadAppBootstrapModule\(\)[\s\S]*return module\.getAppBootstrap\(\)/, 'window.api.getAppBootstrap should not go through app-api-methods during logged-out startup')
assert.doesNotMatch(appBootstrapTransport, /import \{[^}]*localGetSettings[^}]*\} from '\.\/localDb\.ts'/, 'app bootstrap transport should not statically import local DB on unauthenticated startup')
assert.doesNotMatch(appBootstrapTransport, /import \{[^}]*purgeSensitiveLiveServerMirrors[^}]*\} from '\.\/localMirrors\.ts'/, 'app bootstrap transport should not statically import mirror cleanup on unauthenticated startup')
assert.doesNotMatch(appBootstrapTransport, /localDb\.ts/, 'app bootstrap should not reference local DB so Vite cannot preload Dexie during live startup')
assert.doesNotMatch(appBootstrapTransport, /localMirrors\.ts|purgeSensitiveLiveServerMirrors/, 'app bootstrap should not reference mirror cleanup so Vite cannot preload app-api-methods during live startup')
assert.match(appBootstrapTransport, /function buildLocalBootstrap\(\): AppBootstrapPayload \{[\s\S]*settings: \{\}/, 'offline bootstrap fallback should be lightweight and avoid IndexedDB during startup')
assert.match(appBootstrapTransport, /function ensureBootstrapServerUrl\(\): string \{[\s\S]*setSyncServerUrl\(origin\)[\s\S]*return origin/, 'app bootstrap should self-heal backend-origin startup before taking the IndexedDB fallback path')
assert.match(appBootstrapTransport, /const hasServer = Boolean\(ensureBootstrapServerUrl\(\)\)/, 'app bootstrap should decide live/offline mode after sync URL self-healing')
assert.match(appBootstrapTransport, /if \(!hasServer\) \{[\s\S]*return \{ \.\.\.buildLocalBootstrap\(\), offline: true \}[\s\S]*\}/, 'offline bootstrap should return a lightweight fallback without loading IndexedDB')
assert.match(appBootstrapTransport, /const localBootstrap = emptyBootstrap\(\)/, 'invalid-session bootstrap should not load IndexedDB just to render the sign-in page')
assert.doesNotMatch(apiMethods, /import \{ getAppBootstrap as getAppBootstrapRequest \} from '\.\/appBootstrapTransport\.ts'/, 'legacy API registry should not pull app bootstrap into app-api-methods at module load')
assert.match(apiMethods, /export const getAppBootstrap = async \(\) => \{[\s\S]*await import\('\.\/appBootstrapTransport\.ts'\)/, 'legacy getAppBootstrap should use the same direct lazy bootstrap boundary')
assert.doesNotMatch(apiMethods, /from '\.\/systemRuntime\.ts'/, 'legacy API registry should not statically pull Server/system helpers into product-page loads')
assert.match(apiMethods, /function loadSystemRuntimeModule\(\) \{[\s\S]*import\('\.\/systemRuntime\.ts'\)/, 'legacy Server/system wrappers should lazy-load the system runtime chunk only when used')
assert.match(apiMethods, /const SENSITIVE_MIRROR_PURGE_DELAY_MS = 15_000/, 'sensitive mirror purge should stay out of the first route-load window')
assert.match(apiMethods, /function scheduleSensitiveMirrorPurge\(\)[\s\S]*window\.setTimeout\(\(\) => \{[\s\S]*window\.requestIdleCallback\(run, \{ timeout: SENSITIVE_MIRROR_PURGE_IDLE_TIMEOUT_MS \}\)[\s\S]*\}, SENSITIVE_MIRROR_PURGE_DELAY_MS\)/, 'sensitive mirror purge should use a delayed idle slot before loading local DB')
assert.doesNotMatch(apiMethods, /Promise\.resolve\(\)\.then\(\(\) => purgeSensitiveLiveServerMirrors\(\)\)/, 'API registry should not wake local DB via immediate sensitive mirror purge')
assert.doesNotMatch(clientRuntime, /import \{ resetLocalMirrorDb \} from '\.\.\/\.\.\/api\/localDb\.ts'/, 'runtime descriptor helpers should not statically import Dexie/local DB during startup')
assert.match(clientRuntime, /const \{ resetLocalMirrorDb \} = await import\('\.\.\/\.\.\/api\/localDb\.ts'\)[\s\S]*await resetLocalMirrorDb\(\)/, 'runtime reset should load local DB only when a reset is actually running')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/localDb\.ts'\)\) return 'app-local-db'/, 'Vite should keep localDb out of the startup app-api chunk')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/utils\/csv\.ts'\)[\s\S]*normalized\.endsWith\('\/src\/utils\/csvTemplate\.ts'\)[\s\S]*normalized\.endsWith\('\/src\/utils\/csvImport\.ts'\)[\s\S]*return 'csv-utils'/, 'CSV import/export helpers should not be owned by the app-local-db chunk')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/appBootstrapTransport\.ts'\)\) return 'app-bootstrap'/, 'Vite should keep unauthenticated bootstrap out of the full app-api-methods registry chunk')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/authTransport\.ts'\)\) return 'app-auth'/, 'Vite should keep sign-in auth helpers out of the full app-api-methods registry chunk')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/systemRuntime\.ts'\)\) return 'app-system'/, 'Vite should keep Server page diagnostics transport out of app-api-methods and local DB chunks')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/portalTransport\.ts'\)[\s\S]*normalized\.endsWith\('\/src\/api\/portalHttp\.ts'\)[\s\S]*return 'app-portal'/, 'Vite should keep public portal transport out of app-api-methods and local DB chunks')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/dashboardTransport\.ts'\)[\s\S]*return 'app-api'/, 'Vite should keep Dashboard summary transport in the startup API chunk instead of app-api-methods')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/http\.ts'\)[\s\S]*return 'app-api'[\s\S]*if \(normalized\.includes\('\/src\/api\/'\)\) return 'app-api-methods'/, 'Vite should keep only startup API files in app-api and move method transports behind the lazy methods chunk')
assert.match(viteConfig, /'assets\/app-bootstrap-',[\s\S]*'assets\/app-auth-',/, 'bootstrap and auth chunks should not be eagerly modulepreloaded into the initial shell')
assert.match(viteConfig, /'assets\/app-auth-',[\s\S]*'assets\/app-portal-',/, 'public portal transport should also be excluded from initial modulepreload')
assert.match(viteConfig, /'assets\/app-portal-',[\s\S]*'assets\/app-system-',/, 'server diagnostics transport should not be eagerly modulepreloaded into the initial shell')
assert.match(viteConfig, /'assets\/auth-login-',/, 'signed-out Login UI should not be eagerly modulepreloaded into the authenticated shell')
assert.match(viteConfig, /Login\.tsx'\)\) return 'auth-login'/, 'Vite should keep Login UI in an auth-only chunk')
assert.match(viteConfig, /'assets\/app-local-db-',[\s\S]*'assets\/vendor-dexie-',/, 'local DB and Dexie chunks should be excluded from eager modulepreload')
assert.match(viteConfig, /'assets\/media-upload-utils-',[\s\S]*'assets\/notification-center-',/, 'favicon/media upload helpers should be excluded from eager modulepreload')
assert.match(viteConfig, /'assets\/favicon-utils-',[\s\S]*'assets\/public-asset-urls-',/, 'favicon helpers should be split from media upload helpers')
assert.match(viteConfig, /'assets\/public-asset-urls-',[\s\S]*'assets\/notification-center-',/, 'public asset URL helpers should not be eagerly modulepreloaded')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/utils\/mediaUploadState\.ts'\)\) \{[\s\S]*return 'media-upload-state'/, 'tiny media upload state helpers should not be owned by the heavier URL helper chunk')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/utils\/publicAssetUrls\.ts'\)\) \{[\s\S]*return 'public-asset-urls'/, 'public asset URL helper should not be grouped with FilePickerModal')
assert.match(viteConfig, /normalized\.includes\('\/src\/utils\/favicon'\)\) \{[\s\S]*return 'favicon-utils'[\s\S]*normalized\.includes\('\/src\/utils\/mediaUpload\.ts'\)\) \{[\s\S]*return 'media-upload-utils'/, 'favicon helpers should be evaluated before the media upload chunk rule')
assert.doesNotMatch(viteConfig, /PortalMenu\.tsx'\)\) return 'portal-tools'/, 'shared PortalMenu should not be grouped with catalog portal tools')
assert.match(viteConfig, /'assets\/shared-portal-menu-',/, 'PortalMenu should not be eagerly modulepreloaded into the initial shell')
assert.match(viteConfig, /PortalMenu\.tsx'\)\) return 'shared-portal-menu'[\s\S]*if \(normalized\.includes\('\/src\/components\/files\/FilePickerModal'\)/, 'PortalMenu should have a focused intent-loaded chunk before generic shared handling')
assert.doesNotMatch(viteConfig, /lucide-react[\\\/]\)\.test\(id\)\) return 'vendor-lucide'/, 'Lucide icons should not be forced into one app-wide startup vendor chunk')
assert.match(viteConfig, /const appShellIconNames = new Set\([\s\S]*'layout-dashboard'[\s\S]*'shopping-cart'[\s\S]*'users'/, 'startup shell Lucide icons should be listed explicitly instead of falling into route chunks')
assert.match(viteConfig, /const authLoginIconNames = new Set\([\s\S]*'chrome'[\s\S]*'key-round'[\s\S]*'lock-keyhole'/, 'auth-only Login icons should be listed explicitly for the signed-out auth chunk')
assert.match(viteConfig, /const routeSharedIconNames = new Set\(\[[\s\S]*'check-circle-2'[\s\S]*'info'[\s\S]*'mail'[\s\S]*'phone'[\s\S]*'settings-2'[\s\S]*'shield-alert'[\s\S]*'trash-2'[\s\S]*'upload'[\s\S]*\]\)/, 'cross-route notification, reset, and catalog-adjacent icons should stay in a shared icon chunk')
assert.doesNotMatch(viteConfig, /const authLoginIconNames = new Set\(\[[^\]]*'(chevron-down|chevron-up|mail)'/, 'shared catalog icons should not be pinned to the auth-login chunk')
assert.match(viteConfig, /if \(authLoginIconNames\.has\(iconName\)\) return 'auth-login'[\s\S]*if \(routeSharedIconNames\.has\(iconName\)\) return 'shared-icons'[\s\S]*return appShellIconNames\.has\(iconName\) \? 'app-shell-icons' : undefined/, 'direct Lucide icon modules should keep auth, shared route, and shell icons out of feature chunks')
assert.match(viteConfig, /'assets\/catalog-',[\s\S]*'assets\/portal-tools-',/, 'catalog and public portal chunks should be excluded from eager modulepreload')
assert.match(viteConfig, /'assets\/backup-reset-tools-',/, 'Backup reset tools should not be eagerly modulepreloaded into the normal Backup route')
assert.match(viteConfig, /'assets\/settings-otp-modal-',/, 'Settings OTP modal should not be eagerly modulepreloaded into the normal Settings route')
assert.match(viteConfig, /components\/products\/shared\/'[\s\S]*productGalleryHelpers\.ts'[\s\S]*return 'product-shared'/, 'product image primitives shared by Products, POS, and catalog should not be owned by the heavy catalog route chunk')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/utils\/actionGuards\.ts'\)\) \{[\s\S]*return 'action-guards'/, 'shared synchronous action guards should not be owned by the heavy catalog route chunk')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/utils\/scriptTypography\.ts'\)\) \{[\s\S]*return 'script-typography'/, 'shared Khmer typography helpers should not be owned by the public catalog preview chunk')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/contactReadTransport\.ts'\)\) return 'contact-read-api'/, 'POS delayed contact option reads should have their own lazy contact-read API chunk')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/contactWriteTransport\.ts'\)\) return 'contact-write-api'/, 'POS quick contact create writes should have their own lazy contact-write API chunk')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/contactsTransport\.ts'\)\) return 'contacts-api'[\s\S]*normalized\.endsWith\('\/src\/api\/salesTransport\.ts'\)\) return 'sales-read-api'/, 'idle offline snapshot contact and sales reads should not be owned by app-api-methods')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/saleWriteTransport\.ts'\)\) return 'sale-write-api'/, 'POS checkout sale writes should have their own lazy sale-write API chunk')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/productWriteTransport\.ts'\)\) return 'product-write-api'/, 'Products page create\/update\/delete writes should have their own lazy product-write API chunk')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/productImageUploadTransport\.ts'\)\) return 'product-image-upload-api'/, 'Products page image upload intent should use a narrow product-image upload chunk instead of the full file transport')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/branchTransport\.ts'\)\) return 'branch-api'[\s\S]*normalized\.endsWith\('\/src\/api\/inventoryTransport\.ts'\)\) return 'inventory-api'/, 'Products page branch and stock intents should not collapse into app-api-methods')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/userReadTransport\.ts'\)\) return 'user-read-api'[\s\S]*normalized\.endsWith\('\/src\/api\/dashboardTransport\.ts'\)\) return 'dashboard-api'[\s\S]*normalized\.endsWith\('\/src\/api\/returnsTransport\.ts'\)\) return 'returns-api'[\s\S]*normalized\.endsWith\('\/src\/api\/rfidTransport\.ts'\)\) return 'rfid-api'/, 'Inventory user, dashboard, returns, and RFID reads should use focused chunks instead of app-api-methods')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/actionHistoryTransport\.ts'\)\) return 'action-history-api'/, 'action history reads/writes and admin user filter reads should not collapse into app-api-methods')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/offlineSnapshotTransport\.ts'\)\) return 'offline-snapshot-api'/, 'idle offline snapshot refresh should not collapse into app-api-methods')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/requestIds\.ts'\)\) return 'request-ids'/, 'small request-id helpers used by focused write transports should not drag app-api-methods into product writes')
assert.match(viteConfig, /productReadTransport\.ts'[\s\S]*lookupTransport\.ts'[\s\S]*expectedUpdatedAt\.ts'[\s\S]*localMirrors\.ts'[\s\S]*lazyLocalDb\.ts'[\s\S]*queryCache\.ts'[\s\S]*return 'product-read-api'/, 'POS product and lookup reads should have a narrow product-read API chunk instead of landing in app-api-methods')
assert.match(viteConfig, /CatalogPreviewSurface\.tsx'\)\) \{[\s\S]*return 'catalog-preview'[\s\S]*CatalogProductsSection\.tsx'\)\) \{[\s\S]*return 'catalog-products'[\s\S]*CatalogSecondaryTabs\.tsx'\)\) \{[\s\S]*return 'catalog-secondary-tabs'/, 'public catalog preview, products, and secondary tabs should stay in separate intent-sized chunks')
assert.match(viteConfig, /'assets\/catalog-preview-',[\s\S]*'assets\/catalog-products-',[\s\S]*'assets\/catalog-secondary-tabs-'/, 'public catalog split chunks should stay out of eager modulepreload on the first viewport')
assert.match(viteConfig, /catalog\/catalogUi\.tsx'[\s\S]*return 'catalog-ui'[\s\S]*catalog\/portalCatalogDisplay\.ts'[\s\S]*return 'catalog-display'[\s\S]*CatalogPageContext\.tsx'[\s\S]*return 'catalog-context'[\s\S]*portalTranslateController\.ts'[\s\S]*return 'portal-translate-controller'[\s\S]*portalLanguagePacks\.ts'[\s\S]*portalEditorUtils\.ts'[\s\S]*return 'portal-tools'[\s\S]*components\/catalog\/'\)\) return 'catalog'/, 'small catalog UI/display/context helpers, portal translate controller, and portal tools should be split before the generic catalog route chunk')
assert.match(viteConfig, /ResetData\.tsx'\)\) return 'backup-reset-tools'/, 'destructive Backup reset panels should have an action-only chunk')
assert.match(viteConfig, /OtpModal\.tsx'\)\) return 'settings-otp-modal'/, 'Settings OTP setup/disable modal should have an action-only chunk')
assert.doesNotMatch(catalogPage, /from '\.\/portalTranslateController\.ts'/, 'public catalog should not statically import the Google Translate controller during route startup')
assert.match(catalogPage, /import\('\.\/portalTranslateController\.ts'\)/, 'public catalog should load the Google Translate controller only from external translation intent')
assert.doesNotMatch(catalogPage, /import \{ createCircularFaviconDataUrl \} from '\.\.\/\.\.\/utils\/favicon'/, 'public catalog should not statically import the canvas favicon helper during route startup')
assert.match(catalogPage, /window\.requestIdleCallback\(renderRoundedFavicon, \{ timeout: 1800 \}\)/, 'public catalog should round the favicon from an idle callback after the first viewport can render')
assert.match(catalogPage, /import\('\.\.\/\.\.\/utils\/favicon\.ts'\)\.then\(\(\{ createCircularFaviconDataUrl \}\)/, 'public catalog should load favicon canvas helpers only from the delayed favicon task')
assert.match(viteConfig, /CatalogEditorSurface\.tsx'\)[\s\S]*CatalogImageField\.tsx'\)[\s\S]*return 'catalog-editor'/, 'editor-only catalog image fields should not be grouped into the public catalog chunk')
assert.match(viteConfig, /PaginationControls\.tsx'\)\) return 'shared-pagination'[\s\S]*ActionHistoryBar\.tsx'\)\) return 'shared-action-history'[\s\S]*FilterMenu\.tsx'\)\) return 'shared-filter-menu'[\s\S]*SectionSwitcher\.tsx'\)\) return 'shared-section-switcher'[\s\S]*PageHeader\.tsx'\)\) return 'shared-page-header'[\s\S]*Modal\.tsx'\)\) return 'shared-modal'[\s\S]*if \(normalized\.includes\('\/src\/components\/shared\/'\)\) return 'app-shared'/, 'later-route shared controls should be split before the generic app-shared startup chunk')
assert.doesNotMatch(exportMenu, /import PortalMenu from '\.\/PortalMenu'/, 'ExportMenu should not statically import the portal menu positioning code during startup')
assert.match(exportMenu, /import\('\.\/PortalMenu'\)\.then\(\(module\) => module\.default\)/, 'ExportMenu should load PortalMenu only on pointer/focus/click intent')
assert.match(exportMenu, /defaultOpen=\{openOnLoad\}/, 'ExportMenu first click should open the menu after the PortalMenu chunk loads')
assert.doesNotMatch(filterMenu, /import PortalMenu from '\.\/PortalMenu'/, 'FilterMenu should not statically import the portal menu positioning code during route startup')
assert.match(filterMenu, /import LazyPortalMenu from '\.\/LazyPortalMenu'/, 'FilterMenu should route menu positioning through the intent-loaded wrapper')
assert.doesNotMatch(productsHeaderActions, /import PortalMenu from '\.\.\/\.\.\/shared\/PortalMenu'/, 'Products header actions should not load PortalMenu before a manage/export click')
assert.match(productsHeaderActions, /import LazyPortalMenu from '\.\.\/\.\.\/shared\/LazyPortalMenu'/, 'Products header actions should load PortalMenu through LazyPortalMenu')
assert.doesNotMatch(productRowParts, /import \{ ThreeDotPortal \} from '\.\.\/\.\.\/shared\/PortalMenu'/, 'Product row actions should not statically load PortalMenu for every first route paint')
assert.match(productRowParts, /import LazyPortalMenu from '\.\.\/\.\.\/shared\/LazyPortalMenu'/, 'Product row actions should load PortalMenu only when a row action menu is requested')
assert.doesNotMatch(contactsShared, /import PortalMenu from '\.\.\/shared\/PortalMenu'/, 'Contacts row actions should not statically load PortalMenu for first route paint')
assert.match(contactsShared, /import LazyPortalMenu from '\.\.\/shared\/LazyPortalMenu'/, 'Contacts row actions should load PortalMenu only after row action intent')
assert.match(
  contacts,
  /function loadContactReadTransportModule\(\): Promise<ContactReadTransportModule>[\s\S]*import\('\.\.\/\.\.\/api\/contactReadTransport\.ts'\)[\s\S]*getCustomers: async \(query = \{\}\) => \(await loadContactReadTransportModule\(\)\)\.getCustomers\(query\)[\s\S]*getSuppliers: async \(query = \{\}\) => \(await loadContactReadTransportModule\(\)\)\.getSuppliers\(query\)[\s\S]*getDeliveryContacts: async \(query = \{\}\) => \(await loadContactReadTransportModule\(\)\)\.getDeliveryContacts\(query\)/,
  'Contacts export should use the focused contact read transport instead of window.api or the mixed contacts transport',
)
assert.match(
  contacts,
  /function loadCsvUtilsModule\(\): Promise<CsvUtilsModule>[\s\S]*import\('\.\.\/\.\.\/utils\/csv'\)[\s\S]*const \{ downloadZipFilesAsync \} = await loadCsvUtilsModule\(\)/,
  'Contacts export should load ZIP/CSV helpers only after the export action',
)
assert.doesNotMatch(
  contacts,
  /window\.api|\(window as Window & \{ api\?:|contactsTransport\.ts/,
  'Contacts route shell should not wake broad or mixed contact transports for contact export',
)
for (const [name, source] of [
  ['Customers', customers],
  ['Suppliers', suppliers],
  ['Delivery', delivery],
] as const) {
  assert.match(
    source,
    /function loadContactReadTransportModule\(\): Promise<ContactReadTransportModule>[\s\S]*import\('\.\.\/\.\.\/api\/contactReadTransport\.ts'\)/,
    `${name} tab should lazy-load the focused contact read transport`,
  )
  assert.match(
    source,
    /function loadContactWriteTransportModule\(\): Promise<ContactWriteTransportModule>[\s\S]*import\('\.\.\/\.\.\/api\/contactWriteTransport\.ts'\)/,
    `${name} tab should lazy-load the focused contact write transport only for mutations`,
  )
  assert.doesNotMatch(
    source,
    /window\.api|\(window as Window & \{ api\?:|contactsTransport\.ts/,
    `${name} tab should not wake broad or mixed transports for contact CRUD`,
  )
}
assert.doesNotMatch(catalogPreviewSurface, /const PortalMenu = lazy\(\(\) => import\('\.\.\/shared\/PortalMenu'\)\)/, 'public catalog preview should not render PortalMenu through React.lazy during first route load')
assert.match(catalogPreviewSurface, /import LazyPortalMenu from '\.\.\/shared\/LazyPortalMenu'/, 'public catalog translation menu should load PortalMenu only after language-menu intent')
assert.doesNotMatch(pos, /from '\.\.\/contacts\/CustomersTab'/, 'POS should not import the whole CustomersTab chunk just to parse customer contact options')
assert.match(pos, /parseStoredContactOptions\(raw, \{ legacyField: 'address' \}\)/, 'POS should parse customer contact options through the lean shared utility')
assert.doesNotMatch(pos, /import FilterPanel from '\.\/FilterPanel'/, 'POS should not load the filter panel before the Filters button is opened')
assert.match(pos, /const FilterPanel = lazy\(\(\) => import\('\.\/FilterPanel'\)\)/, 'POS filter panel should load only on filter-button intent')
assert.match(pos, /getProductBootstrap as getPosProductBootstrap[\s\S]*getProductFilters as getPosProductFilters[\s\S]*searchProducts as searchPosProducts[\s\S]*from '\.\.\/\.\.\/api\/productReadTransport\.ts'/, 'POS product reads should use the narrow product transport instead of the full window.api registry')
assert.match(pos, /getCategories as getPosCategories[\s\S]*from '\.\.\/\.\.\/api\/lookupTransport\.ts'/, 'POS category options should use the narrow lookup transport instead of the full window.api registry')
assert.match(pos, /let contactReadTransportPromise: Promise<typeof import\('\.\.\/\.\.\/api\/contactReadTransport\.ts'\)> \| null = null[\s\S]*function getContactReadTransport\(\): Promise<typeof import\('\.\.\/\.\.\/api\/contactReadTransport\.ts'\)>/, 'POS contact reads should lazy-load the narrow contact read transport after the delayed option gate')
assert.match(pos, /let contactWriteTransportPromise: Promise<typeof import\('\.\.\/\.\.\/api\/contactWriteTransport\.ts'\)> \| null = null[\s\S]*function getContactWriteTransport\(\): Promise<typeof import\('\.\.\/\.\.\/api\/contactWriteTransport\.ts'\)>/, 'POS quick contact creates should lazy-load the narrow contact write transport on add intent')
assert.match(pos, /let portalTransportPromise: Promise<typeof import\('\.\.\/\.\.\/api\/portalTransport\.ts'\)> \| null = null[\s\S]*function getPortalTransport\(\): Promise<typeof import\('\.\.\/\.\.\/api\/portalTransport\.ts'\)>/, 'POS membership lookup should lazy-load the narrow portal transport on membership intent')
assert.match(pos, /let saleWriteTransportPromise: Promise<typeof import\('\.\.\/\.\.\/api\/saleWriteTransport\.ts'\)> \| null = null[\s\S]*function getSaleWriteTransport\(\): Promise<typeof import\('\.\.\/\.\.\/api\/saleWriteTransport\.ts'\)>/, 'POS checkout should lazy-load the narrow sale write transport only on Done intent')
assert.doesNotMatch(pos, /api\.getProductBootstrap|api\.searchProducts|api\.getProductFilters|api\.getCategories|api\.getCustomers|api\.getDeliveryContacts|api\.lookupPortalMembership|api\.createCustomer|api\.createDeliveryContact|api\.createSale|getPosApi|missingPosApiMethod/, 'POS product, category, customer, delivery, membership reads, quick contact creates, and sale checkout should not wake app-api-methods during catalog, option, add, or checkout flows')
assert.doesNotMatch(contactReadTransport, /import .*['"]\.\/(?:localMirrors|lazyLocalDb)\.ts['"]/, 'POS contact reads should not statically import mirror or IndexedDB helpers')
assert.match(contactReadTransport, /await import\('\.\/lazyLocalDb\.ts'\)/, 'POS contact read offline fallback should load IndexedDB only after network failure')
assert.match(contactReadTransport, /await import\('\.\/localMirrors\.ts'\)/, 'POS contact read mirroring should load mirror helpers only after the delayed mirror timer')
assert.doesNotMatch(contactWriteTransport, /import .*['"]\.\/requestIds\.ts['"]/, 'POS contact quick-create writes should not import the shared app-api-methods request-id owner')
assert.match(contactWriteTransport, /function ensureContactClientRequestId/, 'POS contact quick-create writes should keep a tiny local request-id helper')
assert.match(saleWriteTransport, /export async function createSale[\s\S]*queueOfflineSale/, 'sale write transport should own checkout create and offline queue fallback outside the broad API registry')
assert.match(saleWriteTransport, /export async function syncPendingSalesQueue/, 'sale write transport should preserve pending offline sale sync for background retry')
assert.doesNotMatch(saleWriteTransport, /from '\.\/methods\.ts'|from "\.\/methods\.ts"|from '\.\/salesTransport\.ts'|from "\.\/salesTransport\.ts"|from '\.\/requestIds\.ts'|from "\.\/requestIds\.ts"/, 'sale write transport should not import the broad API registry, sales read/mirror transport, or shared request-id owner')
assert.match(saleWriteTransport, /function ensureSaleClientRequestId/, 'sale write transport should keep a tiny local request-id helper so checkout does not wake app-api-methods')
assert.doesNotMatch(productWriteTransport, /from '\.\/methods\.ts'|from "\.\/methods\.ts"/, 'product write transport should not import the broad API registry')
assert.doesNotMatch(productImageUploadTransport, /from '\.\/(?:methods|fileTransport|importTransport)\.ts'|from "\.\/(?:methods|fileTransport|importTransport)\.ts"/, 'product image upload transport should not import the broad API registry, file transport, or import-job multipart stack')
assert.match(products, /let productReadModulePromise: Promise<ProductReadModule> \| null = null[\s\S]*function loadProductReadModule\(\): Promise<ProductReadModule>[\s\S]*import\('\.\.\/\.\.\/api\/productReadTransport\.ts'\)/, 'Products route should lazy-load the narrow product read transport locally')
assert.match(products, /let productWriteModulePromise: Promise<ProductWriteModule> \| null = null[\s\S]*function loadProductWriteModule\(\): Promise<ProductWriteModule>[\s\S]*import\('\.\.\/\.\.\/api\/productWriteTransport\.ts'\)/, 'Products route should lazy-load product create/update/delete transport locally')
assert.match(products, /function loadBranchModule\(\): Promise<BranchModule>[\s\S]*import\('\.\.\/\.\.\/api\/branchTransport\.ts'\)[\s\S]*function loadInventoryModule\(\): Promise<InventoryModule>[\s\S]*import\('\.\.\/\.\.\/api\/inventoryTransport\.ts'\)[\s\S]*function loadProductImageUploadModule\(\): Promise<ProductImageUploadModule>[\s\S]*import\('\.\.\/\.\.\/api\/productImageUploadTransport\.ts'\)/, 'Products route should lazy-load branch, inventory, and product-image-upload transports only on their intent paths')
assert.doesNotMatch(products, /import \{ downloadCSV \} from '\.\.\/\.\.\/utils\/csv'/, 'Products route should not load CSV export helpers before export intent')
assert.match(products, /const exportProductsCsv = useCallback\(async[\s\S]*await import\('\.\.\/\.\.\/utils\/csv\.ts'\)/, 'Products export should load CSV helpers only after the export action')
assert.doesNotMatch(products, /\(window as Window & \{ api\?: ProductApi \}\)\.api|window\.api\.(?:createProduct|updateProduct|deleteProduct|adjustStock|transferStock|uploadProductImage)/, 'Products route should not depend on window.api for product write or stock/image intent paths')
assert.match(inventory, /function loadInventoryTransport\(\): Promise<InventoryTransportModule>[\s\S]*import\('\.\.\/\.\.\/api\/inventoryTransport\.ts'\)[\s\S]*function loadProductReadTransport\(\): Promise<ProductReadTransportModule>[\s\S]*import\('\.\.\/\.\.\/api\/productReadTransport\.ts'\)[\s\S]*function loadReturnsTransport\(\): Promise<ReturnsTransportModule>[\s\S]*import\('\.\.\/\.\.\/api\/returnsTransport\.ts'\)/, 'Inventory route should lazy-load focused inventory, product-read, and returns transports instead of the broad API registry')
assert.match(inventory, /function loadUserReadTransport\(\): Promise<UserReadTransportModule>[\s\S]*import\('\.\.\/\.\.\/api\/userReadTransport\.ts'\)/, 'Inventory route should lazy-load the tiny user read transport for admin movement filters')
assert.match(inventory, /function loadBranchTransport\(\): Promise<BranchTransportModule>[\s\S]*function loadDashboardTransport\(\): Promise<DashboardTransportModule>[\s\S]*function loadRfidTransport\(\): Promise<RfidTransportModule>/, 'Inventory route should own narrow lazy loaders for branch, dashboard, and RFID transport paths')
assert.doesNotMatch(inventory, /window\.api|\(window as Window & \{ api\?:/, 'Inventory route should not wake the broad window.api registry for reads, stats, or stock mutations')
assert.match(actionHistory, /function loadActionHistoryTransport\(\): Promise<ActionHistoryTransportModule>[\s\S]*import\('\.\.\/api\/actionHistoryTransport\.ts'\)/, 'action history hook should lazy-load its focused transport instead of window.api')
assert.match(actionHistoryTransport, /export function getActionHistoryUsers\(\): Promise<unknown>[\s\S]*apiFetch\('GET', '\/api\/users'\)/, 'action history admin user filter should stay in the focused action-history transport')
assert.doesNotMatch(actionHistory, /window\.api\?\.(?:getActionHistory|getUsers|createActionHistory|undoActionHistory|redoActionHistory|updateActionHistory)/, 'action history hook should not wake the broad API registry for history or user-filter work')
assert.match(offlineSnapshotTransport, /export async function refreshOfflineDeviceSnapshot/, 'idle offline snapshot refresh should live in a focused transport')
assert.doesNotMatch(offlineSnapshotTransport, /from '\.\/methods\.ts'|from "\.\/methods\.ts"/, 'idle offline snapshot transport should not import the broad API registry')
assert.match(apiMethods, /function loadSaleWriteTransport\(\) \{[\s\S]*import\('\.\/saleWriteTransport\.ts'\)/, 'legacy API registry should lazy-load the focused sale write transport without creating a manual chunk cycle')
assert.match(apiMethods, /export async function createSale\(d\) \{[\s\S]*await loadSaleWriteTransport\(\)[\s\S]*return createSaleRequest\(d\)/, 'legacy API registry should delegate createSale to the focused sale write transport')
assert.match(apiMethods, /export async function retryPendingSyncNow\(\) \{[\s\S]*await loadSaleWriteTransport\(\)[\s\S]*return syncPendingSalesQueue\(\{ force: true \}\)/, 'legacy pending-sync retry should delegate to the focused sale write transport')
assert.doesNotMatch(apiMethods, /function buildOfflineSaleReceiptNumber|async function queueOfflineSale|async function syncPendingSalesQueue/, 'legacy API registry should not keep a duplicate offline-sale queue implementation')
assert.match(lazyPortalMenu, /import\('\.\/PortalMenu'\)\.then\(\(module\) => module\.default\)/, 'LazyPortalMenu should dynamically import PortalMenu')
assert.match(lazyPortalMenu, /onClickCapture=\{\(event\) => \{[\s\S]*loadPortalMenu\(true\)/, 'LazyPortalMenu should open the menu from the first click after the chunk loads')
assert.match(portalMenu, /defaultOpen\?: boolean[\s\S]*const \[open, setOpen\] = useState\(defaultOpen\)/, 'PortalMenu should support first-click lazy mount opening')
assert.match(portalMenu, /useEffect\(\(\) => \{[\s\S]*if \(!defaultOpen\) return[\s\S]*setOpen\(true\)[\s\S]*setTimeout\(reposition, 0\)[\s\S]*\}, \[defaultOpen, reposition\]\)/, 'PortalMenu should honor delayed defaultOpen changes from LazyPortalMenu first-click loads')
assert.match(app, /catalog: asPageModule\(\(\) => import\('\.\/components\/catalog\/CatalogPage\.tsx'\)\)/, 'catalog should remain route-lazy so deferred preload still loads on navigation')
assert.doesNotMatch(app, /import Login from '\.\/components\/auth\/Login'/, 'authenticated startup should not statically import the signed-out Login UI')
assert.match(app, /const Login = lazyWithRetry\(asPageModule\(\(\) => import\('\.\/components\/auth\/Login'\)\), 'auth-login'\)/, 'signed-out Login UI should stay behind the lazy auth-login boundary')
assert.match(webApi, /function scheduleInitialOfflineMaintenance\(\): void \{[\s\S]*window\.requestIdleCallback\(run, \{ timeout: INITIAL_OFFLINE_MAINTENANCE_IDLE_TIMEOUT_MS \}\)[\s\S]*window\.addEventListener\('load', scheduleIdle, \{ once: true \}\)/, 'initial offline maintenance should wait for load and idle time')
assert.match(webApi, /function scheduleBootstrapStorageMaintenance\(task: \(\) => void\): void \{[\s\S]*window\.requestIdleCallback\(task, \{ timeout: BOOTSTRAP_STORAGE_MAINTENANCE_IDLE_TIMEOUT_MS \}\)[\s\S]*window\.addEventListener\('load', run, \{ once: true \}\)/, 'web API bootstrap storage work should wait for load and idle time')
assert.match(webApi, /function scheduleBootstrapOfflineDbWrite\(task: \(db: any\) => void \| Promise<void>\): void \{[\s\S]*window\.setTimeout\(\(\) => \{[\s\S]*document\.visibilityState === 'hidden'[\s\S]*getOfflineDb\(\)\.then\(task\)\.catch/, 'bootstrap IndexedDB mirror writes should be separately delayed and skipped while hidden')
assert.match(webApi, /function isPublicRuntimePath\(\): boolean \{[\s\S]*pathname === '\/public' \|\| pathname\.startsWith\('\/public\/'\)/, 'public portal startup should be detectable before scheduling offline DB work')
assert.match(webApi, /const skipOfflineBootstrapDb = isPublicRuntimePath\(\)[\s\S]*if \(!skipOfflineBootstrapDb\) \{\s*scheduleBootstrapOfflineDbWrite\(\(db\) => db\.settings\.delete\('sync_token'\)\)\s*\}/, 'retired token Dexie cleanup should be skipped for public portal startup')
assert.match(webApi, /scheduleBootstrapStorageMaintenance\(\(\) => \{[\s\S]*localStorage\.setItem\(STORAGE_KEYS\.SYNC_SERVER, url\)[\s\S]*\}\)[\s\S]*if \(!skipOfflineBootstrapDb\) \{\s*scheduleBootstrapOfflineDbWrite\(\(db\) => db\.settings\.put\(\{ key: 'sync_server_url', value: url \}\)\)\s*\}/, 'backend-origin sync URL should persist to localStorage while skipping the IndexedDB mirror on public portal')
assert.match(webApi, /if \(!skipOfflineBootstrapDb\) \{[\s\S]*const db = await getOfflineDb\(\)[\s\S]*const stored = await db\.settings\.bulkGet\(\['sync_server_url'\]\)/, 'Vite dev IndexedDB sync URL fallback should stay available outside public portal startup')
assert.match(webApi, /function runOfflineMaintenance\(force = false\): void \{[\s\S]*if \(!hasStoredUserSession\(\)\) return[\s\S]*loadSaleWriteTransportModule\(\)[\s\S]*syncPendingSalesQueue\(\{ force: true \}\)/, 'logged-in idle maintenance should retry pending sale sync through the focused sale write transport')
assert.match(webApi, /function refreshOfflineSnapshotSoon\(force = false\): void \{[\s\S]*loadOfflineSnapshotTransportModule\(\)[\s\S]*refreshOfflineDeviceSnapshot\(\{ force \}\)/, 'offline snapshot refresh should use the focused offline snapshot transport')
assert.doesNotMatch(webApi, /getLazyApiMethod\('(?:retryPendingSyncNow|refreshOfflineDeviceSnapshot)'\)/, 'idle offline maintenance should call focused transports instead of the broad API registry')
assert.match(webApi, /function ensureSessionRecoveryListeners\(\): void \{[\s\S]*sessionRecoveryListenersRegistered[\s\S]*window\.addEventListener\('online'[\s\S]*resumeWS\(\)[\s\S]*pingServerHealth\(true\)\.catch[\s\S]*window\.addEventListener\('focus'[\s\S]*resumeWS\(\)[\s\S]*pingServerHealth\(\)\.catch[\s\S]*document\.addEventListener\('visibilitychange'[\s\S]*resumeWS\(\)[\s\S]*pingServerHealth\(\)\.catch[\s\S]*window\.addEventListener\('sync:reconnected'/, 'online/focus/visibility recovery listeners should be centralized in web-api after session recovery')
assert.doesNotMatch(webApi, /if \(typeof window !== 'undefined'\) \{[\s\S]{0,500}window\.addEventListener\('online'/, 'signed-out startup should not register session recovery listeners at module load')
assert.match(webApi, /const previousSyncServerUrl = getSyncServerUrl\(\)[\s\S]*const syncServerChanged = previousSyncServerUrl !== clean[\s\S]*scheduleBootstrapOfflineDbWrite\(\(db\) => db\.settings\.put\(\{ key: 'sync_server_url', value: clean \}\)\)[\s\S]*cacheClearAll\(\)[\s\S]*if \(hasStoredUserSession\(\)\) \{[\s\S]*ensureSessionRecoveryListeners\(\)[\s\S]*connectWS\(\)[\s\S]*startHealthCheck\(\)[\s\S]*if \(syncServerChanged && hasStoredUserSession\(\)\) \{[\s\S]*scheduleInitialOfflineMaintenance\(\)/, 'setSyncServerUrl should avoid duplicate cache clears and start recovery loops only for stored sessions')
assert.doesNotMatch(webApi, /setSyncServerUrl\(url: unknown\)[\s\S]{0,900}getOfflineDb\(\)\.then/, 'setSyncServerUrl should not load IndexedDB during startup')
assert.doesNotMatch(webApi, /try \{\s*await dexieDb\.settings\.(?:delete|put)/, 'web API bootstrap should not await Dexie maintenance before connecting')
assert.doesNotMatch(webApi, /dexieDb\.settings/, 'web API should not call Dexie settings through a startup static import')
assert.match(webApi, /async function unlockOfflineVault[\s\S]*const offlineDb = await getOfflineDb\(\)[\s\S]*offlineDb\.offline_vault/, 'offline vault should load local DB on demand')
assert.match(webApi, /async function syncUnlockedOfflineOutbox[\s\S]*const offlineDb = await getOfflineDb\(\)[\s\S]*offlineDb\.sync_outbox/, 'offline outbox sync should load local DB on demand')
assert.match(webApi, /if \(url\) \{[\s\S]*setSyncServerUrl\(url\)[\s\S]*if \(hasStoredUserSession\(\)\) \{[\s\S]*ensureSessionRecoveryListeners\(\)[\s\S]*connectWS\(\)[\s\S]*startHealthCheck\(\)[\s\S]*scheduleInitialOfflineMaintenance\(\)/, 'web API bootstrap should start recovery loops only when a stored session exists')
assert.doesNotMatch(webApi, /startHealthCheck\(\)[^\n]*\n\s*runOfflineMaintenance\(\)/, 'web API bootstrap should not run offline maintenance synchronously')
assert.match(appContext, /getAppApi\(\)\.ensureSessionRecoveryListeners\?\.\(\)[\s\S]*reconnectWS\(\)[\s\S]*startHealthCheck\(\)/, 'successful login should install recovery listeners before reconnecting websocket and health checks')
assert.match(appContext, /if \(hasStoredSession && canProbeServerSession\) return false[\s\S]*if \(hasStoredSession\) return true/, 'stored sessions should wait for bootstrap validation before authenticated startup warmups run')
assert.match(httpApi, /const HEALTH_CHECK_INTERVAL_MS = 30_000[\s\S]*const HEALTH_CHECK_INITIAL_DELAY_MS = 2_500[\s\S]*const HEALTH_PROBE_REUSE_MS = 8_000/, 'server health checks should use a slower cadence, delayed first probe, and a short startup reuse window')
assert.match(httpApi, /export async function pingServerHealth\(force = false\): Promise<ServerHealthProbeResult>[\s\S]*if \(!force && _lastHealthProbeResult[\s\S]*if \(!force && _healthProbeInFlight\) return _healthProbeInFlight/, 'health probes should reuse fresh and in-flight startup checks')
assert.match(httpApi, /export function startHealthCheck\(\): void \{[\s\S]*setTimeout\(\(\) => \{[\s\S]*pingServerHealth\(\)\.catch/, 'initial health probe should be delayed so authenticated bootstrap can prime the shared result first')
assert.match(httpApi, /export function primeServerHealthFromRuntime\(serverRuntime: LooseRecord = \{\}\): ServerHealthProbeResult[\s\S]*checkRuntimeVersionFromHealth\(\{ runtime \}\)[\s\S]*_lastHealthProbeResult = result/, 'bootstrap runtime should be able to prime health and runtime-version state without fetching /health')
assert.match(httpApi, /export function ensureSyncUpdateCacheListener\(\): void \{[\s\S]*syncUpdateCacheListenerRegistered[\s\S]*window\.addEventListener\('sync:update'/, 'HTTP sync cache invalidation should be installed lazily after session recovery instead of at module load')
assert.doesNotMatch(httpApi, /if \(typeof window !== 'undefined'\) \{\s*window\.addEventListener\('sync:update'/, 'signed-out startup should not register HTTP sync cache listeners just by importing the HTTP module')
assert.match(appContext, /ensureSyncUpdateCacheListener\(\)[\s\S]*const onUpdate = \(e: Event\) =>/, 'AppContext should install HTTP cache invalidation only after the recoverable-session gate passes')
assert.match(appContext, /primeServerHealthFromRuntime\(runtime as AppRecord\)[\s\S]*setSyncServerUnreachable\(false\)/, 'AppContext startup should prime health from authenticated bootstrap runtime metadata')
assert.match(appContext, /const runStartupHealthProbe = \(\) => \{[\s\S]*pingServerHealth\(\)[\s\S]*setSyncServerUnreachable\(result\.cloudflareAccessRequired \? false : !result\.online\)/, 'AppContext startup should keep a shared health fallback for missing or failed bootstrap data')
assert.doesNotMatch(appContext, /fetch\(`\$\{effectiveUrl\}\/health`/, 'AppContext startup should not issue a separate raw health fetch')
assert.doesNotMatch(dashboard, /import \{ BarChart, LineChart, DonutChart \} from '\.\/charts'/, 'Dashboard should not eagerly import every chart through the barrel')
assert.match(dashboard, /const BarChart = lazy\(\(\) => import\('\.\/charts\/BarChart'\)\)/, 'inactive Dashboard volume chart should lazy-load instead of joining first-paint chart code')
assert.match(dashboard, /lucide-react\/dist\/esm\/icons\/layout-dashboard\.js/, 'Dashboard should use direct Lucide icon modules instead of the app-wide barrel')
assert.doesNotMatch(dashboard, /Upload \} from 'lucide-react'/, 'Dashboard should not keep unused startup icon imports')

assert.match(inventory, /inventory-history-row/, 'inventory history controls should live on their own row')
assert.doesNotMatch(inventory, /<ActionHistoryBar history=\{actionHistory\} className="shrink-0"/, 'inventory filter/search row should not contain inline ActionHistoryBar')
assert.match(inventory, /inventory-history-row[\s\S]{0,160}<ActionHistoryBar/, 'inventory history controls should render inside the dedicated history row')
assert.match(inventory, /const INVENTORY_HISTORY_READY_DELAY_MS = 1800/, 'Inventory background history should wait until after first route-ready work')
assert.match(inventory, /const \[historyReady, setHistoryReady\] = useState\(false\)/, 'Inventory should have an explicit post-ready action-history gate')
assert.match(inventory, /useActionHistory\(\{ limit: 10, notify, scope: 'inventory', enabled: historyReady \}\)/, 'Inventory should not fetch server action history during first route load')
assert.match(inventory, /if \(!loadedOnceRef\.current \|\| loading\) return undefined[\s\S]*window\.setTimeout\(\(\) => \{[\s\S]*setHistoryReady\(true\)[\s\S]*INVENTORY_HISTORY_READY_DELAY_MS/, 'Inventory should enable history only after the first inventory data load settles')
assert.match(sales, /const SALES_HISTORY_READY_DELAY_MS = 1800/, 'Sales background history should wait until after first route-ready work')
assert.match(sales, /const \[historyReady, setHistoryReady\] = useState\(false\)/, 'Sales should have an explicit post-ready action-history gate')
assert.match(sales, /useActionHistory\(\{ limit: 3, notify, enabled: historyReady \}\)/, 'Sales should not fetch server action history during first route load')
assert.match(sales, /if \(!loadedOnceRef\.current \|\| loading\) return undefined[\s\S]*window\.setTimeout\(\(\) => \{[\s\S]*setHistoryReady\(true\)[\s\S]*SALES_HISTORY_READY_DELAY_MS/, 'Sales should enable history only after the first sales data load settles')
assert.match(returns, /const RETURNS_HISTORY_READY_DELAY_MS = 1800/, 'Returns background history should wait until after first route-ready work')
assert.match(returns, /const \[historyReady, setHistoryReady\] = useState\(false\)/, 'Returns should have an explicit post-ready action-history gate')
assert.match(returns, /useActionHistory\(\{ limit: 8, notify, scope: 'returns', enabled: historyReady \}\)/, 'Returns should not fetch server action history during first route load')
assert.match(returns, /if \(!loadedOnceRef\.current \|\| loading\) return undefined[\s\S]*window\.setTimeout\(\(\) => \{[\s\S]*setHistoryReady\(true\)[\s\S]*RETURNS_HISTORY_READY_DELAY_MS/, 'Returns should enable history only after the first returns data load settles')
assert.match(products, /const PRODUCTS_HISTORY_READY_DELAY_MS = 1800/, 'Products background history should wait until after first route-ready work')
assert.match(products, /const \[historyReady, setHistoryReady\] = useState\(false\)/, 'Products should have an explicit post-ready action-history gate')
assert.match(products, /useActionHistory\(\{ limit: 10, notify, scope: 'products', enabled: historyReady \}\)/, 'Products should not fetch server action history during first route load')
assert.match(products, /if \(!loadedOnceRef\.current \|\| loading\) return undefined[\s\S]*window\.setTimeout\(\(\) => \{[\s\S]*setHistoryReady\(true\)[\s\S]*PRODUCTS_HISTORY_READY_DELAY_MS/, 'Products should enable history only after the first product data load settles')

assert.match(backup, /useState<BackupSectionId>\('all'\)/, 'Backup should default to the lightweight overview tab without showing duplicate All and Overview tabs')
assert.match(backup, /BackupOverview/, 'Backup overview should provide lightweight section entry points')
assert.match(backup, /const BACKUP_HISTORY_READY_DELAY_MS = 1800/, 'Backup background history should wait until after first route-ready work')
assert.match(backup, /const \[historyReady, setHistoryReady\] = useState\(false\)/, 'Backup should have an explicit post-ready action-history gate')
assert.match(backup, /useActionHistory\(\{ limit: 3, notify, scope: 'backup', enabled: historyReady \}\)/, 'Backup should not fetch server action history during first route load')
assert.match(backup, /window\.setTimeout\(\(\) => \{[\s\S]*setHistoryReady\(true\)[\s\S]*BACKUP_HISTORY_READY_DELAY_MS/, 'Backup should enable history only after the overview has rendered')
assert.doesNotMatch(backup, /import \{ ResetData, FactoryReset \} from '\.\/ResetData'/, 'Backup should not statically import destructive reset tools during normal backup route load')
assert.match(backup, /const LazyResetData = lazy\(async \(\) => \{[\s\S]*await import\('\.\/ResetData'\)[\s\S]*module\.ResetData/, 'Backup should load reset tools only when advanced maintenance is opened')
assert.match(backup, /const LazyFactoryReset = lazy\(async \(\) => \{[\s\S]*await import\('\.\/ResetData'\)[\s\S]*module\.FactoryReset/, 'Backup should load factory reset only when advanced maintenance is opened')
assert.match(backup, /advancedMaintenanceOpen \? \([\s\S]*<Suspense[\s\S]*<LazyResetData actionHistory=\{actionHistory\} \/>[\s\S]*<LazyFactoryReset actionHistory=\{actionHistory\} \/>/, 'Backup maintenance details should render reset tools behind a lazy Suspense boundary')
assert.doesNotMatch(backup, /function DataFolderLocation/, 'unused backup data-folder UI should not remain in the bundle')
assert.doesNotMatch(backup, /function ScaleMigrationSection/, 'unused backup migration UI should not remain in the bundle')
assert.doesNotMatch(backup, /backupSection === 'all' \|\|/, 'Backup sections should not mount every tool in overview mode')
assert.match(backup, /const INTEGRATION_DOCTOR_TIMEOUT_MS = 12000/, 'integration doctor should use an explicit quick timeout')
assert.match(backup, /const INTEGRATION_DOCTOR_DEEP_TIMEOUT_MS = 30000/, 'deep integration doctor should use an explicit longer timeout')
assert.match(backup, /const SYSTEM_JOB_STATUS_TIMEOUT_MS = 10000/, 'backup system job polling should use an explicit timeout')
assert.match(
  backup,
  /withLoaderTimeout\(\s*\(\) => getBackupApi\(\)\.getIntegrationDoctor\?\.\(\{ deep \}\),\s*deep \? 'Deep integration doctor' : 'Integration doctor',\s*deep \? INTEGRATION_DOCTOR_DEEP_TIMEOUT_MS : INTEGRATION_DOCTOR_TIMEOUT_MS,\s*\)/,
  'integration doctor reads should timeout slow diagnostics',
)
assert.match(
  backup,
  /withLoaderTimeout\(\s*\(\) => getBackupApi\(\)\.getSystemJob\?\.\(jobId\),\s*`\$\{reason\} status`,\s*SYSTEM_JOB_STATUS_TIMEOUT_MS,\s*\)/,
  'backup system job status polls should timeout slow reads',
)
assert.match(
  backup,
  /consecutiveFailures >= SYSTEM_JOB_STATUS_MAX_FAILURES/,
  'backup system job watcher should tolerate transient poll failures before failing the job card',
)

assert.match(contactsShared, /LoadingWatchdog/, 'shared contact table should use retryable loading watchdog UI')
assert.match(customers, /CustomerFormModal/, 'customer list should lazy-load the customer form modal')
assert.match(customerFormModal, /generateCustomerMembershipNumber/, 'customer form should consume shared membership number generation')
assert.match(customerMembershipNumber, /const CUSTOMER_MEMBERSHIP_PREFIX = 'LCMN'/, 'customer membership helper should keep the LCMN prefix')
assert.match(customerFormModal, /Regenerate/, 'customer form should let staff regenerate membership numbers')
assert.match(loaders, /const DEFAULT_LOADER_TIMEOUT_MS = 20_000/, 'loader timeout should give slow pages enough time before failing first render')
assert.match(appContext, /RUNTIME_RECOVERY_SESSION_KEY/, 'runtime mismatch recovery should guard against reload loops')
assert.match(appContext, /window\.location\.replace\(url\.toString\(\)\)/, 'runtime mismatch should heal through a hard reload once')
assert.match(appContext, /const APP_SETTINGS_LOAD_TIMEOUT_MS = 9000/, 'app settings should use an explicit timeout constant')
assert.match(appContext, /const APP_BOOTSTRAP_TIMEOUT_MS = 9000/, 'app bootstrap should use an explicit timeout constant')
assert.match(appContext, /const APP_LOGIN_TIMEOUT_MS = 15000/, 'app login should use an explicit timeout constant')
assert.match(appContext, /const APP_LOGOUT_TIMEOUT_MS = 10000/, 'app logout should use an explicit timeout constant')
assert.match(appContext, /const APP_GOOGLE_OAUTH_COMPLETE_TIMEOUT_MS = 20000/, 'Google OAuth completion should use an explicit timeout constant')
assert.match(appContext, /const APP_SETTINGS_SAVE_TIMEOUT_MS = 15000/, 'settings save should use an explicit timeout constant')
assert.match(appContext, /const APP_SESSION_DURATION_TIMEOUT_MS = 12000/, 'session duration refresh should use an explicit timeout constant')
assert.match(appContext, /const INITIAL_SYNC_URL_PERSIST_DELAY_MS = 1500/, 'auto sync URL persistence should be deferred past first paint')
assert.match(appContext, /const INITIAL_SYNC_URL_PERSIST_IDLE_TIMEOUT_MS = 8000/, 'deferred auto sync URL persistence should still run when idle time is scarce')
assert.match(
  appContext,
  /const \[syncUrl, _setSyncUrl\] = useState\(\(\) => \{[\s\S]*if \(!isViteDev\) \{[\s\S]*return window\.location\.origin[\s\S]*return localStorage\.getItem\(STORAGE_KEYS\.SYNC_SERVER\) \|\| ''/,
  'sync URL state should stay immediate without writing localStorage during initialization',
)
assert.match(
  appContext,
  /const persistAutoSyncUrl = \(\) => \{[\s\S]*safeStorageSet\(localStorage, STORAGE_KEYS\.SYNC_SERVER, syncUrl\)[\s\S]*window\.requestIdleCallback\(persistAutoSyncUrl, \{ timeout: INITIAL_SYNC_URL_PERSIST_IDLE_TIMEOUT_MS \}\)/,
  'auto sync URL persistence should run through a deferred idle effect',
)
assert.doesNotMatch(
  appContext,
  /if \(!isViteDev\) \{[\s\S]{0,260}localStorage\.setItem\(STORAGE_KEYS\.SYNC_SERVER/,
  'sync URL initializer should not write localStorage before first render',
)
assert.match(
  appContext,
  /withLoaderTimeout\(\s*\(\) => api\.getSettings\?\.\(\{ force: options\?\.force === true \}\),\s*'App settings',\s*APP_SETTINGS_LOAD_TIMEOUT_MS,\s*\)/,
  'app settings refresh should timeout slow settings reads',
)
assert.match(
  appContext,
  /const readAppBootstrap = useCallback\(\(label = 'App bootstrap'\): Promise<BootstrapPayload \| null> => \{[\s\S]*withLoaderTimeout\(\s*\(\) => api\.getAppBootstrap\?\.\(\),\s*label,\s*APP_BOOTSTRAP_TIMEOUT_MS,\s*\)/,
  'app bootstrap helper should timeout slow bootstrap reads',
)
assert.match(
  appContext,
  /const fallbackSettings = hasCurrentSettings \? currentSettings : mergeSettingsWithDeviceOverrides\(\{\}\)/,
  'app settings refresh failures should keep current settings when available',
)
assert.doesNotMatch(
  appContext,
  /await getInventoryApi\\(\\)\\?\.getAppBootstrap\?\.\(/,
  'app bootstrap reads should go through the shared timeout helper',
)
assert.match(
  appContext,
  /withLoaderTimeout\(\s*\(\) => api\.login\?\.\(\{[\s\S]*username, password, organization,[\s\S]*sessionDuration,[\s\S]*\}\),\s*'Login',\s*APP_LOGIN_TIMEOUT_MS,\s*\)/,
  'login should timeout slow auth requests',
)
assert.match(
  appContext,
  /withLoaderTimeout\(\(\) => api\.logout\?\.\(\), 'Logout', APP_LOGOUT_TIMEOUT_MS\)/,
  'logout should timeout slow auth cleanup requests',
)
assert.match(
  appContext,
  /withLoaderTimeout\(\s*\(\) => api\.completeGoogleOauth\?\.\(\{[\s\S]*mode: 'link',[\s\S]*currentUserId: actorId,[\s\S]*\}\),\s*'Complete Google OAuth',\s*APP_GOOGLE_OAUTH_COMPLETE_TIMEOUT_MS,\s*\)/,
  'Google OAuth completion should timeout slow auth linking requests',
)
assert.match(
  appContext,
  /withLoaderTimeout\(\s*\(\) => api\.saveSettings\?\.\(serverUpdates, normalizedOptions\),\s*'Save settings',\s*APP_SETTINGS_SAVE_TIMEOUT_MS,\s*\)/,
  'settings writes should timeout slow server saves',
)
assert.match(
  appContext,
  /withLoaderTimeout\(\s*\(\) => api\.updateSessionDuration\?\.\(\{[\s\S]*sessionDuration: normalizedSessionDuration,[\s\S]*\}\),\s*'Refresh session duration',\s*APP_SESSION_DURATION_TIMEOUT_MS,\s*\)/,
  'session duration refresh should timeout slow auth refreshes',
)
for (const [name, source] of [
  ['Customers', customers],
  ['Suppliers', suppliers],
  ['Delivery', delivery],
]) {
  assert.match(source, /onRetry=\{\(\) => load\(\{ silent: false/, `${name} contacts should pass retry to the table`)
  assert.match(source, /autoComplete=/, `${name} contacts should define autocomplete hints`)
  assert.match(source, /buildSelectedSnapshots\([^,]+, ids\)/, `${name} contacts should snapshot bulk selections through the shared Set helper`)
  assert.match(source, /countActiveFlags\(\[yearFilter !== 'all', monthFilter !== 'all', sortDirection !== 'desc', groupMode !== 'time'\]\)/, `${name} contacts should count active filters without temporary filtered arrays`)
  assert.match(source, /const failedIdSet = new Set\(failedIds\)/, `${name} contacts should reuse a failed-id Set when filtering deleted snapshots`)
  assert.match(source, /const \w+_HISTORY_READY_DELAY_MS = 1800/, `${name} contacts should delay background history until after first route-ready work`)
  assert.match(source, /const \[historyReady, setHistoryReady\] = useState\(false\)/, `${name} contacts should have an explicit post-ready action-history gate`)
  assert.match(source, /useActionHistory\(\{ limit: 3, notify, enabled: historyReady \}\)/, `${name} contacts should not fetch server action history during first contact data load`)
  assert.match(source, /if \(!loadedOnceRef\.current \|\| loading\) return undefined[\s\S]*window\.setTimeout\(\(\) => \{[\s\S]*setHistoryReady\(true\)[\s\S]*_HISTORY_READY_DELAY_MS/, `${name} contacts should enable history only after the first contact data load settles`)
  assert.doesNotMatch(source, /if \(!loadedOnceRef\.current\) \{[\s\S]{0,240}loadedOnceRef\.current = true/, `${name} contacts should not lock in a failed first load as a completed render`)
  assert.doesNotMatch(source, /\.filter\(\([^)]*\) => ids\.includes\(Number\([^)]*\.id \|\| 0\)\)\)\.map/, `${name} contacts should not scan selected ids with Array.includes while snapshotting`)
  assert.doesNotMatch(source, /\[yearFilter !== 'all', monthFilter !== 'all', sortDirection !== 'desc', groupMode !== 'time'\]\.filter\(Boolean\)\.length/, `${name} contacts should not allocate a boolean array just to count active filters`)
}
assert.match(
  contactsShared,
  /export function buildSelectedSnapshots(?:<[^>]+>)?\(rows(?:: [^=]+)? = \[\], ids(?:: [^=]+)? = \[\]\)(?:: [^{]+)? \{[\s\S]*const selectedIdSet = new Set(?:<[^>]+>)?\(\)[\s\S]*selectedIdSet\.has\(Number\(row\?\.id \|\| 0\)\)/,
  'shared contact helpers should build selected snapshots through an indexed id set',
)
assert.match(
  contactsShared,
  /export function countActiveFlags\(flags(?:: [^)]+)? = \[\]\)(?:: [^{]+)? \{[\s\S]*for \(const flag of flags\)/,
  'shared contact helpers should count active filter flags without allocation',
)
assert.match(
  posFilterPanel,
  /function countActiveFlags\(flags(?:: [^)]+)? = \[\]\)(?:: [^{]+)? \{[\s\S]*for \(const flag of flags\)/,
  'POS filter panel should count active filter flags without allocation',
)
assert.match(
  posFilterPanel,
  /const activeCount = countActiveFlags\(\[[\s\S]*supplierFilter !== 'all',[\s\S]*\]\)/,
  'POS filter panel active count should use the direct count helper',
)
assert.doesNotMatch(
  posFilterPanel,
  /\.filter\(Boolean\)\.length/,
  'POS filter panel should not allocate a boolean array just to count active filters',
)
for (const [name, source] of [
  ['Inventory', inventory],
  ['Sales', sales],
  ['Returns', returns],
  ['Branches', branches],
]) {
  assert.doesNotMatch(source, /set(?:Summary|Movements|Rows|Sales)\(\[\]\)[\s\S]{0,120}loadedOnceRef\.current = true/, `${name} should preserve the previous dataset when a refresh fails`)
}

assert.match(
  backgroundImportTracker,
  /const api = getImportTrackerApi\(\)[\s\S]*withLoaderTimeout\(\s*\(\) => api\.listImportJobs\?\.\(\{ limit: 8 \}\),\s*'Import tracker',\s*IMPORT_TRACKER_LOAD_TIMEOUT_MS,\s*\)/,
  'background import tracker should timeout slow poll reads',
)
assert.doesNotMatch(catalogPage, /from '..\/..\/lang\/(?:en|km)\.json'/, 'Catalog route should not import full app language JSON packs')
assert.match(catalogPage, /getPortalLanguageText/, 'Catalog route should use the scoped portal language pack for portal copy')
assert.match(catalogPage, /resolvePortalActiveTab\(\{[\s\S]*cachedPortal\?\.config[\s\S]*\}, null, 'products'\)/, 'public catalog should default to Products so contact/map content does not own the first customer viewport')
assert.match(catalogPage, /if \(activeTab !== 'ai'\) return undefined[\s\S]*getCatalogApi\(\)\.getPortalAiStatus\(\)/, 'public catalog should load AI status only after the Assistant tab is active')
assert.match(catalogPage, /const shouldLoadMapEmbed = displayConfig\.showGoogleMap && \(!publicView \|\| activeTab === 'about'\)/, 'public catalog should not load the Google map iframe unless About is visible')
assert.doesNotMatch(catalogPage, /warmPublicSecondaryTabs|requestIdleCallback\(\(\) => \{\s*loadCatalogSecondaryTabs|setTimeout\(\(\) => \{\s*loadCatalogSecondaryTabs/, 'public catalog should not warm About/FAQ/contact/social tabs during the first product viewport')
assert.match(catalogPage, /const handlePortalTabChange = \(key: string\) => \{[\s\S]*if \(key !== 'products'\) \{[\s\S]*void loadCatalogSecondaryTabs\(\)[\s\S]*setPublicSecondaryTabsPrimed\(true\)[\s\S]*setActiveTab\(key\)/, 'public catalog should load secondary tabs immediately on tab intent')
assert.match(apiMethods, /const settingsResponse = await apiFetch\('GET', '\/api\/settings'\)/, 'settings reads should use the inline updatedAt returned by /api/settings')
assert.doesNotMatch(apiMethods, /apiFetch\('GET', '\/api\/settings\/meta'\)/, 'settings reads should not request /api/settings/meta as a startup waterfall')
assert.match(products, /const branchesById = useMemo\(\(\) => new Map\(/, 'products should index branch rows used by bulk branch moves')
assert.match(products, /branchesById\.get\(String\(branchId\)\)/, 'products bulk branch moves should resolve target branch from the indexed branch map')
assert.match(products, /const latestProductsById = buildProductIdMap\(latestProducts \|\| \[\]\)/, 'products save and variant history should index fresh product snapshots')
assert.match(products, /latestProductsById\.get\(targetProductId\)/, 'products save history should read fresh snapshots from the indexed map')
assert.match(products, /latestProductsById\.get\(createdProductId\)/, 'products variant history should read fresh snapshots from the indexed map')
assert.match(
  backgroundImportTracker,
  /const IMPORT_TRACKER_PREFLIGHT_TIMEOUT_MS = 15000/,
  'background import tracker should use an explicit preflight timeout',
)
assert.match(
  backgroundImportTracker,
  /const IMPORT_TRACKER_CANCEL_TIMEOUT_MS = 12000/,
  'background import tracker should use an explicit cancel timeout',
)
assert.match(
  backgroundImportTracker,
  /const IMPORT_TRACKER_RETRY_TIMEOUT_MS = 12000/,
  'background import tracker should use an explicit retry timeout',
)
assert.match(
  backgroundImportTracker,
  /const IMPORT_TRACKER_APPROVE_TIMEOUT_MS = 12000/,
  'background import tracker should use an explicit approve timeout',
)
assert.match(
  backgroundImportTracker,
  /const IMPORT_TRACKER_ERRORS_DOWNLOAD_TIMEOUT_MS = 30000/,
  'background import tracker should use an explicit error-download timeout',
)
assert.match(
  backgroundImportTracker,
  /const IMPORT_TRACKER_REMOVE_TIMEOUT_MS = 12000/,
  'background import tracker should use an explicit remove timeout',
)
assert.match(
  backgroundImportTracker,
  /withLoaderTimeout\(\s*\(\) => api\.preflightImportJob\?\.\(action\.jobId\),\s*'Import preflight',\s*IMPORT_TRACKER_PREFLIGHT_TIMEOUT_MS,\s*\)/,
  'background import tracker should timeout slow preflight reads before approval',
)
assert.match(
  backgroundImportTracker,
  /withLoaderTimeout\(\s*\(\) => api\.cancelImportJob\(action\.jobId\),\s*'Cancel import job',\s*IMPORT_TRACKER_CANCEL_TIMEOUT_MS,\s*\)/,
  'background import tracker should timeout slow cancel actions',
)
assert.match(
  backgroundImportTracker,
  /withLoaderTimeout\(\s*\(\) => api\.retryImportJob\(action\.jobId\),\s*'Retry import job',\s*IMPORT_TRACKER_RETRY_TIMEOUT_MS,\s*\)/,
  'background import tracker should timeout slow retry actions',
)
assert.match(
  backgroundImportTracker,
  /withLoaderTimeout\(\s*\(\) => api\.approveImportJob\(action\.jobId\),\s*'Approve import job',\s*IMPORT_TRACKER_APPROVE_TIMEOUT_MS,\s*\)/,
  'background import tracker should timeout slow approve actions',
)
assert.match(
  backgroundImportTracker,
  /withLoaderTimeout\(\s*\(\) => api\.downloadImportJobErrors\(action\.jobId\),\s*'Download import errors',\s*IMPORT_TRACKER_ERRORS_DOWNLOAD_TIMEOUT_MS,\s*\)/,
  'background import tracker should timeout slow error downloads',
)
assert.match(
  backgroundImportTracker,
  /withLoaderTimeout\(\s*\(\) => api\.deleteImportJob\(removedId, \{ force \}\),\s*'Remove import job',\s*IMPORT_TRACKER_REMOVE_TIMEOUT_MS,\s*\)/,
  'background import tracker should timeout slow remove actions',
)
assert.doesNotMatch(
  backgroundImportTracker,
  /catch \(error\) \{[\s\S]{0,420}setJobs\(\[\]\)/,
  'background import tracker should keep previous jobs visible when a poll fails',
)
assert.match(
  actionHistory,
  /const ACTION_HISTORY_LOAD_TIMEOUT_MS = 10000/,
  'action history should use an explicit history timeout',
)
assert.match(
  actionHistory,
  /const ACTION_HISTORY_USERS_TIMEOUT_MS = 8000/,
  'action history should use an explicit admin user-options timeout',
)
assert.match(
  actionHistory,
  /withLoaderTimeout\(\s*async \(\) => \(await loadActionHistoryTransport\(\)\)\.getActionHistory\(scope, Math\.max\(3, limit\), \{[\s\S]*'Action history',\s*ACTION_HISTORY_LOAD_TIMEOUT_MS,\s*\)/,
  'action history server reads should timeout slow history requests',
)
assert.match(
  actionHistory,
  /if \(!isTrackedRequestCurrent\(historyRequestRef, requestId\)\) return[\s\S]*const record = result as \{ items\?: ServerHistoryItem\[\] \} \| null[\s\S]*setServerItems\(Array\.isArray\(record\?\.items\) \? record\.items : \[\]\)/,
  'action history should ignore stale history responses before updating rows',
)
assert.match(
  actionHistory,
  /withLoaderTimeout\(\s*async \(\) => \(await loadActionHistoryTransport\(\)\)\.getActionHistoryUsers\(\),\s*'Action history users',\s*ACTION_HISTORY_USERS_TIMEOUT_MS,\s*\)/,
  'action history admin user options should timeout slow user reads',
)
assert.match(
  actionHistory,
  /if \(!isTrackedRequestCurrent\(usersRequestRef, requestId\)\) return[\s\S]*setUserOptions\(Array\.isArray\(rows\) \? rows : \[\]\)/,
  'action history should ignore stale user option responses before updating options',
)
assert.doesNotMatch(
  actionHistory,
  /catch\(\(\) => setUserOptions\(\[\]\)\)/,
  'action history should preserve current user options after transient user-option read failures',
)
assert.match(
  notificationCenter,
  /const NOTIFICATION_SUMMARY_TIMEOUT_MS = 8000/,
  'notification center should use an explicit summary timeout',
)
assert.match(
  notificationCenter,
  /const api = getNotificationApi\(\)[\s\S]*withLoaderTimeout\(\s*\(\) => api\.getNotificationSummary\(\),\s*'Notifications',\s*NOTIFICATION_SUMMARY_TIMEOUT_MS,\s*\)/,
  'notification center should timeout slow summary reads',
)
assert.match(
  dashboard,
  /const DASHBOARD_SUMMARY_TIMEOUT_MS = 30000/,
  'dashboard summary should use an explicit timeout constant',
)
assert.match(
  dashboard,
  /const DASHBOARD_ANALYTICS_TIMEOUT_MS = 30000/,
  'dashboard analytics should use an explicit timeout constant',
)
assert.match(
  dashboard,
  /import \{ getAnalytics, getDashboard, getDashboardStartup \} from '\.\.\/\.\.\/api\/dashboardTransport\.ts'/,
  'dashboard should use its narrow transport instead of the full app-api-methods registry',
)
assert.doesNotMatch(
  dashboard,
  /import \{ buildCSV, downloadCSV, downloadZipFilesAsync \} from '\.\.\/\.\.\/utils\/csv'/,
  'dashboard should lazy-load export helpers only when an export is requested',
)
assert.doesNotMatch(
  dashboard,
  /\(window as unknown as \{ api: DashboardApi \}\)\.api/,
  'dashboard startup should not load the full legacy API registry just to read summary data',
)
assert.match(
  dashboard,
  /withLoaderTimeout\(\(\) => getDashboardApi\(\)\.getDashboard\(\), label, DASHBOARD_SUMMARY_TIMEOUT_MS\)/,
  'dashboard summary should timeout slow summary reads',
)
assert.match(
  dashboard,
  /const DASHBOARD_STARTUP_TIMEOUT_MS = 30000/,
  'dashboard combined startup read should use an explicit timeout',
)
assert.match(
  dashboard,
  /getDashboardApi\(\)\.getDashboardStartup\(\{ startDate: start, endDate: end, granularity: gran \}\)/,
  'dashboard initial startup should use the combined summary and analytics transport',
)
assert.match(
  dashboard,
  /summary == null && analytics == null && !startupAttemptedRef\.current[\s\S]*loadDashboardStartup\(\)/,
  'dashboard should route the first empty load through the combined startup loader',
)
assert.match(
  dashboard,
  /\}, \[isActive, loadSummary\]\) \/\/ eslint-disable-line/,
  'dashboard summary effect should not depend on range-bound startup or analytics loaders',
)
assert.match(
  dashboard,
  /withLoaderTimeout\(\s*\(\) => getDashboardApi\(\)\.getAnalytics\(\{ startDate: start, endDate: end, granularity: gran \}\),\s*'Dashboard analytics',\s*DASHBOARD_ANALYTICS_TIMEOUT_MS,\s*\)/,
  'dashboard analytics should timeout slow analytics reads',
)
assert.doesNotMatch(
  dashboard,
  /catch \(error\) \{[\s\S]{0,360}set(?:Summary|Analytics)\(EMPTY_/,
  'dashboard refresh failures should preserve the last valid summary and analytics payloads',
)
assert.match(
  branches,
  /const BRANCHES_LIST_TIMEOUT_MS = 10000/,
  'branches list should use an explicit timeout constant',
)
assert.match(
  branches,
  /const BRANCHES_SUMMARY_TIMEOUT_MS = 10000/,
  'branches summary should use an explicit timeout constant',
)
assert.match(
  branches,
  /const BRANCH_TRANSFERS_TIMEOUT_MS = 12000/,
  'branch transfers should use an explicit timeout constant',
)
assert.match(
  branches,
  /const BRANCHES_HISTORY_READY_DELAY_MS = 1800/,
  'Branches background history should wait until after first route-ready work',
)
assert.match(
  branches,
  /const \[historyReady, setHistoryReady\] = useState\(false\)/,
  'Branches should have an explicit post-ready action-history gate',
)
assert.match(
  branches,
  /useActionHistory\(\{ limit: 3, notify, enabled: historyReady \}\)/,
  'Branches should not fetch server action history during first route load',
)
assert.match(
  branches,
  /if \(!loadedOnceRef\.current \|\| loading\) return undefined[\s\S]*window\.setTimeout\(\(\) => \{[\s\S]*setHistoryReady\(true\)[\s\S]*BRANCHES_HISTORY_READY_DELAY_MS/,
  'Branches should enable history only after the first branch data load settles',
)
assert.match(
  branches,
  /withLoaderTimeout\(\s*\(\) => branchApi\.getBranches\(\),\s*'Branches list',\s*BRANCHES_LIST_TIMEOUT_MS,\s*\)/,
  'branches list should timeout slow reads',
)
assert.match(
  branches,
  /withLoaderTimeout\(\s*\(\) => branchApi\.getBranchSummary\?\.\(\),\s*'Branch summary',\s*BRANCHES_SUMMARY_TIMEOUT_MS,\s*\)/,
  'branches summary should timeout slow reads',
)
assert.match(
  branches,
  /withLoaderTimeout\(\s*\(\) => branchApi\.getTransfers\(\{\}\),\s*'Branch transfers',\s*BRANCH_TRANSFERS_TIMEOUT_MS,\s*\)/,
  'branch transfer history should timeout slow reads',
)
assert.match(
  branches,
  /const loadPromiseModeRef = useRef\(''\)/,
  'branches should track the current in-flight load mode',
)
assert.match(
  branches,
  /requestedMode !== 'transfers' \|\| loadPromiseModeRef\.current === 'transfers'/,
  'branches should only reuse a base load when it already satisfies the requested transfer view',
)
assert.match(
  branches,
  /withLoaderTimeout\(\s*\(\) => branchApi\.getBranchStock\(branchId, \{ page: 1, pageSize: 20, stockState: 'positive' \}\),\s*'Branch stock',\s*12000,\s*\)/,
  'branch stock expansion should timeout slow stock reads',
)
assert.match(
  branches,
  /withLoaderTimeout\(\s*\(\) => branchApi\.getBranchStock\(branchId, \{[\s\S]*page: nextPage,[\s\S]*'More branch stock',\s*12000,\s*\)/,
  'branch stock pagination should timeout slow stock reads',
)
assert.match(
  transferModal,
  /const TRANSFER_STOCK_LOAD_TIMEOUT_MS = 12000/,
  'transfer stock modal should use an explicit branch stock timeout',
)
assert.match(
  transferModal,
  /getTransferApi\(\)\.getBranchStock\(Number\.parseInt\(fromBranch, 10\), \{ page: 1, pageSize: 50, stockState: 'positive' \}\)/,
  'transfer stock modal should request a bounded positive-stock page',
)
assert.match(
  transferModal,
  /normalizeTransferStockRows\(stock\)/,
  'transfer stock modal should support paged branch stock payloads',
)
assert.doesNotMatch(
  transferModal,
  /catch \(error\) \{[\s\S]{0,360}setProducts\(\[\]\)/,
  'transfer stock modal should not clear already loaded products when a stock refresh fails',
)
assert.match(
  sales,
  /const SALES_USER_OPTIONS_TIMEOUT_MS = 8000/,
  'sales user filter options should use an explicit timeout',
)
assert.match(
  sales,
  /withLoaderTimeout\(\(\) => getSalesApi\(\)\.getUsers\(\), 'Sales user filters', SALES_USER_OPTIONS_TIMEOUT_MS\)/,
  'sales user filter options should timeout slow user reads',
)
assert.doesNotMatch(
  sales,
  /withLoaderTimeout\(\(\) => getSalesApi\(\)\.getUsers\(\), 'Sales user filters'[\s\S]{0,260}catch\(\(\) => \{[\s\S]{0,180}setUserOptions\(\[\]\)/,
  'sales user filter options should keep previously loaded options on refresh failure',
)
assert.match(
  sales,
  /function normalizeFiniteIdsFrom<T = unknown>\(items: T\[\] = \[\],[\s\S]*items\.reduce/,
  'sales selection ids should be normalized through a single helper pass',
)
assert.match(
  sales,
  /const filteredIds = useMemo\([\s\S]*normalizeFiniteIdsFrom\(visibleSales, \(sale\) => sale\.id\)/,
  'sales selection should precompute visible sale ids once per visible list',
)
assert.match(
  sales,
  /const validIds = new Set<number>\(filteredIds\)[\s\S]*setSelectedIds/,
  'sales selection cleanup should reuse the precomputed visible id list',
)
assert.match(
  sales,
  /const normalized = normalizeFiniteIds\(ids\)[\s\S]*toggleIdSet\(current, normalized, checked\)/,
  'sales grouped selection toggles should reuse normalized ids',
)
assert.match(
  sales,
  /function countSelectedIds\(ids: Array<number \| string> = \[\], selectedIds: Set<number> = new Set\(\)\): number \{[\s\S]*for \(const id of ids\)/,
  'sales partial selection counts should use one counter helper instead of filter allocations',
)
assert.match(
  sales,
  /const selectedCount = countSelectedIds\(normalized, selectedIds\)/,
  'sales partial selection should reuse countSelectedIds',
)
assert.match(
  sales,
  /function countActiveFlags\(flags: boolean\[] = \[\]\): number \{[\s\S]*for \(const flag of flags\)/,
  'sales filter badge counts should use one counter helper instead of filter allocations',
)
assert.match(
  sales,
  /countActiveFlags\(\[statusFilter !== 'all'[\s\S]*salesSortDirection !== 'desc'\]\)/,
  'sales active filter count should reuse countActiveFlags',
)
assert.doesNotMatch(
  sales,
  /visibleSales\.map\(\(sale\) => Number\(sale\.id\)\)\.filter\(\(id\) => Number\.isFinite\(id\)\)/,
  'sales selection cleanup should not repeat map/filter id normalization',
)
assert.doesNotMatch(
  sales,
  /\[statusFilter !== 'all'[\s\S]*salesSortDirection !== 'desc'\]\.filter\(Boolean\)\.length/,
  'sales active filter count should not allocate a filter-count array',
)
assert.match(
  salesExportModal,
  /const SALES_EXPORT_PREVIEW_TIMEOUT_MS = 20000/,
  'sales export preview should use an explicit timeout constant',
)
assert.match(
  salesExportModal,
  /const SALES_EXPORT_CSV_TIMEOUT_MS = 30000/,
  'sales CSV export should use an explicit timeout constant',
)
assert.match(
  salesExportModal,
  /withLoaderTimeout\(\s*\(\) => getSalesExportApi\(\)\.getSalesExport\(\{ startDate: dates\.start, endDate: dates\.end \}\),\s*'Sales export preview',\s*SALES_EXPORT_PREVIEW_TIMEOUT_MS,\s*\)/,
  'sales export preview should timeout slow report reads',
)
assert.match(
  salesExportModal,
  /withLoaderTimeout\(\s*\(\) => getSalesExportApi\(\)\.getSalesExport\(\{ startDate: dates\.start, endDate: dates\.end, format: 'csv' \}\),\s*'Sales export CSV',\s*SALES_EXPORT_CSV_TIMEOUT_MS,\s*\)/,
  'sales CSV export should timeout slow CSV reads',
)
assert.match(
  inventory,
  /const INVENTORY_USER_OPTIONS_TIMEOUT_MS = 8000/,
  'inventory user filter options should use an explicit timeout',
)
assert.match(
  inventory,
  /const INVENTORY_REASONS_TIMEOUT_MS = 8000/,
  'inventory saved reasons should use an explicit timeout',
)
assert.match(
  inventory,
  /const INVENTORY_BRANCHES_TIMEOUT_MS = 8000/,
  'inventory branches should use an explicit timeout',
)
assert.match(
  inventory,
  /const INVENTORY_STATS_TIMEOUT_MS = 12000/,
  'inventory primary stats should use an explicit timeout',
)
assert.match(
  inventory,
  /const INVENTORY_PRODUCTS_TIMEOUT_MS = 12000/,
  'inventory product summary should use an explicit timeout',
)
assert.match(
  inventory,
  /const INVENTORY_MOVEMENTS_TIMEOUT_MS = 15000/,
  'inventory movements should use an explicit timeout',
)
assert.match(
  inventory,
  /const INVENTORY_RFID_TIMEOUT_MS = 8000/,
  'inventory RFID status should use an explicit timeout',
)
assert.match(
  inventory,
  /const INVENTORY_PRODUCT_DETAIL_TIMEOUT_MS = 10000/,
  'inventory movement product detail fallback should use an explicit timeout',
)
assert.match(
  inventory,
  /const INVENTORY_RETURNS_STATS_TIMEOUT_MS = 12000/,
  'inventory return stats should use an explicit timeout',
)
assert.match(
  inventory,
  /const INVENTORY_DASHBOARD_STATS_TIMEOUT_MS = 12000/,
  'inventory dashboard fee stats should use an explicit timeout',
)
assert.match(
  inventory,
  /withLoaderTimeout\(\(\) => getInventoryApi\(\)\.getUsers\(\), 'Inventory user filters', INVENTORY_USER_OPTIONS_TIMEOUT_MS\)/,
  'inventory user filter options should timeout slow user reads',
)
assert.match(
  inventory,
  /withLoaderTimeout\(\s*\(\) => getInventoryApi\(\)\.getInventoryReasons\?\.\(\) \?\? Promise\.resolve\(\{ items: \[\] \}\),\s*'Inventory reasons',\s*INVENTORY_REASONS_TIMEOUT_MS,\s*\)/,
  'inventory saved reasons should timeout slow reason reads',
)
assert.match(
  inventory,
  /withLoaderTimeout\(\s*\(\) => getInventoryApi\(\)\.getBranches\(\),\s*'Inventory branches',\s*INVENTORY_BRANCHES_TIMEOUT_MS,\s*\)/,
  'inventory branches should timeout slow branch reads',
)
assert.match(
  inventory,
  /withLoaderTimeout\(\s*\(\) => getInventoryApi\(\)\.getInventoryStats\(statsQuery\),\s*'Inventory stats',\s*INVENTORY_STATS_TIMEOUT_MS,\s*\)/,
  'inventory primary stats should timeout slow stats reads',
)
assert.match(
  inventory,
  /const canBootstrapProducts = needsProductSummary && !needsStatsData && !needsMovementData && !needsRfidData/,
  'inventory product startup should use the combined bootstrap only for the product section first window',
)
assert.match(
  inventory,
  /withLoaderTimeout\(\s*\(\) => \{[\s\S]*getInventoryBootstrap\(productQuery\)[\s\S]*'Inventory bootstrap',\s*INVENTORY_PRODUCTS_TIMEOUT_MS,\s*\)/,
  'inventory product bootstrap should timeout slow product startup reads',
)
assert.match(
  inventory,
  /withLoaderTimeout\(\s*\(\) => getInventoryApi\(\)\.getInventoryMovements\(\{[\s\S]*page: movementMeta\.page,[\s\S]*pageSize: movementMeta\.pageSize,[\s\S]*\}\),\s*'Inventory movements',\s*INVENTORY_MOVEMENTS_TIMEOUT_MS,\s*\)/,
  'inventory movements should timeout slow movement reads',
)
assert.match(
  inventory,
  /withLoaderTimeout\(\s*\(\) => \(getInventoryApi\(\)\.getRfidStatus \? getInventoryApi\(\)\.getRfidStatus\(branchOpts\)\.catch\(\(\) => null\) : Promise\.resolve\(null\)\),\s*'Inventory RFID status',\s*INVENTORY_RFID_TIMEOUT_MS,\s*\)/,
  'inventory RFID status should timeout slow RFID reads',
)
assert.doesNotMatch(
  inventory,
  /withLoaderTimeout\(\(\) => getInventoryApi\(\)\.getUsers\(\), 'Inventory user filters'[\s\S]{0,340}catch\(\(\) => \{[\s\S]{0,180}setUserOptions\(\[\]\)/,
  'inventory user filter options should keep previously loaded options on refresh failure',
)
assert.doesNotMatch(
  inventory,
  /catch \{[\s\S]{0,180}setInventoryReasons\(\[\]\)[\s\S]{0,120}inventoryReasonsLoadedRef\.current = true/,
  'inventory saved reasons should keep previous reasons and retry later after a refresh failure',
)
assert.match(
  inventory,
  /withLoaderTimeout\(\s*\(\) => getInventoryApi\(\)\.getProductsByIds\(\[productId\], \{ include: 'branch_stock,images,batches' \}\),\s*'Inventory product detail',\s*INVENTORY_PRODUCT_DETAIL_TIMEOUT_MS,\s*\)/,
  'inventory movement product detail fallback should timeout slow product detail reads',
)
assert.match(
  inventory,
  /const branchesById = useMemo\(\(\) => new Map\(/,
  'inventory should index branch labels used by RFID, exports, and branch summaries',
)
assert.match(
  inventory,
  /const summaryById = useMemo\(\(\) => new Map\(/,
  'inventory should index product summary rows used by adjustment and movement detail flows',
)
assert.match(
  inventory,
  /const defaultTransferDestinationBySourceId = useMemo\(\(\) => \{/,
  'inventory should precompute default transfer destinations instead of scanning branches for every transfer draft',
)
assert.match(
  inventory,
  /getBranchLabel\(branchFilter, branchFilter\)/,
  'inventory exports should resolve branch labels through the indexed branch map',
)
assert.match(
  inventory,
  /branchesById\.get\(String\(transferForm\.from_branch_id\)\)/,
  'inventory transfer submit should resolve source branches from the indexed branch map',
)
assert.match(
  inventory,
  /defaultTransferDestinationBySourceId\.get\(defaultSourceId\)/,
  'inventory transfer defaults should use the precomputed alternate branch map',
)
assert.match(
  inventory,
  /summaryById\.get\(Number\(adjustForm\.product_id \|\| adjustModal\?\.id\)\)/,
  'inventory adjustment should resolve target products from the indexed summary map',
)
assert.match(
  inventory,
  /const selectedBranchStockById = new Map\(/,
  'inventory adjustment should index selected product branch stock once per submit',
)
assert.match(
  inventory,
  /const selectedBranchStock = numericBranchId \? selectedBranchStockById\.get\(numericBranchId\) : null/,
  'inventory adjustment should reuse one branch-stock lookup for undo quantity and validation',
)
assert.doesNotMatch(
  inventory,
  /adjustModal\.branch_stock \|\| \[\]\)\.find/,
  'inventory adjustment validation should not rescan modal branch stock after indexing selected branch stock',
)
assert.match(
  inventory,
  /const visibleInventoryStats = useMemo\(\(\) => \{[\s\S]*for \(const product of filteredSummary\)/,
  'inventory visible stats should aggregate filtered products in one memoized pass',
)
assert.match(
  inventory,
  /const searchTerms: string\[\] = useMemo\(\(\) => \([\s\S]*\), \[deferredSearch\]\)/,
  'inventory search terms should be memoized so unrelated UI state does not rebuild search arrays',
)
assert.match(
  inventory,
  /const filteredSummary = useMemo\(\(\) => summary\.filter[\s\S]*\), \[brandFilter, groupFilter, hasServerBackedProductSearch, matchesSearch, parentProductIds, productHay, stockFilter, summary\]\)/,
  'inventory product filtering should stay memoized before grouping visible sections',
)
assert.match(
  inventory,
  /const filteredMovements = useMemo\(\(\) => movements\.filter[\s\S]*\), \[hasServerBackedMovementSearch, matchesSearch, movFilter, movHay, movements\]\)/,
  'inventory movement filtering should stay memoized before grouped movement rebuilds',
)
assert.match(
  inventory,
  /const groupedMovements = useMemo\(\(\) => \{[\s\S]*buildMovementGroups\(filteredMovements\)[\s\S]*\}, \[filteredMovements, hasServerBackedMovementSearch, matchesSearch\]\)/,
  'inventory grouped movements should depend on stable filtered movements and search matcher only',
)
assert.match(
  inventory,
  /stockStats\?\.net_sold_qty\s*\?\?\s*visibleInventoryStats\.netSoldQty/,
  'inventory net-sold fallback should reuse the visible stats accumulator',
)
assert.match(
  inventory,
  /const visibleInventoryProductIds = useMemo(?:<[^>]+>)?\([\s\S]*visibleInventoryProducts\.reduce/,
  'inventory product selection should precompute visible ids once per visible list',
)
assert.match(
  inventory,
  /setSelectedProductIds\(new Set\(visibleInventoryProductIds\)\)/,
  'inventory select-all should reuse the precomputed visible id list',
)
assert.match(
  inventory,
  /function normalizeFiniteIdsFrom(?:<[^>]+>)?\(items(?:: [^=]+)? = \[\],[\s\S]*items\.reduce/,
  'inventory selection ids should be normalized through a single helper pass',
)
assert.match(
  inventory,
  /function normalizeFiniteIds\(ids(?:: [^=]+)? = \[\]\)(?:: [^{]+)? \{[\s\S]*return normalizeFiniteIdsFrom\(ids\)/,
  'inventory selection scope ids should use the shared normalization helper',
)
assert.match(
  inventory,
  /const normalized = normalizeFiniteIds\(ids\)[\s\S]*toggleIdSet\(current, normalized, checked\)/,
  'inventory selection scope toggles should reuse normalized ids',
)
assert.match(
  inventory,
  /function countSelectedIds\(ids(?:: [^=]+)? = \[\], selectedIds(?:: [^=]+)? = new Set\(\)\)(?:: [^{]+)? \{[\s\S]*for \(const id of ids\)/,
  'inventory partial selection counts should use one counter helper instead of filter allocations',
)
assert.match(
  inventory,
  /const selectedCount = countSelectedIds\(normalized, selectedProductIds\)/,
  'inventory partial selection should reuse countSelectedIds',
)
assert.match(
  inventory,
  /setSelectedProductIds\(new Set\(normalizeFiniteIdsFrom\(failedItems, \(item\) => item\.productId\)\)\)/,
  'inventory batch failure recovery should reuse shared id normalization',
)
assert.match(
  inventory,
  /function renderDestinationProductOptions\(products(?:: [^=]+)? = \[\], excludedProductId(?:\?: [^)]+)?\) \{[\s\S]*return products\.map\(\(product\) => \{[\s\S]*if \(Number\.isFinite\(excludedId\) && id === excludedId\) return null/,
  'inventory destination product options should skip excluded products without a filtered allocation',
)
assert.match(
  inventory,
  /renderDestinationProductOptions\(summary, moveModal\.id\)/,
  'inventory single move destination selector should reuse the destination option renderer',
)
assert.match(
  inventory,
  /renderDestinationProductOptions\(summary, item\.productId\)/,
  'inventory batch move destination selector should reuse the destination option renderer',
)
assert.doesNotMatch(
  inventory,
  /ids\.map\(\(id\) => Number\(id\)\)\.filter\(\(id\) => Number\.isFinite\(id\)\)/,
  'inventory selection scope should not repeat map/filter id normalization',
)
assert.doesNotMatch(
  inventory,
  /summary\.filter\(\(product\) => Number\(product\.id\) !== Number\((?:moveModal\.id|item\.productId)\)\)\.map/,
  'inventory destination selectors should not allocate filtered summary arrays during render',
)
assert.doesNotMatch(
  inventory,
  /normalized\.filter\(\(id\) => selectedProductIds\.has\(id\)\)\.length/,
  'inventory partial selection should not allocate a filtered selected id list',
)
assert.match(
  inventory,
  /function countActiveFlags\(flags(?:: [^=]+)? = \[\]\)(?:: [^{]+)? \{[\s\S]*for \(const flag of flags\)/,
  'inventory filter badge counts should use one counter helper instead of filter allocations',
)
assert.match(
  inventory,
  /return countActiveFlags\(\[[\s\S]*movementSortDirection !== 'desc'[\s\S]*\]\)/,
  'inventory movement filter counts should reuse countActiveFlags',
)
assert.doesNotMatch(
  inventory,
  /\]\.filter\(Boolean\)\.length/,
  'inventory should not allocate filter-count arrays for active filter badges',
)
assert.doesNotMatch(
  inventory,
  /filteredSummary\.reduce\(\(s, p\) => s \+ Math\.max\(0, p\.(?:qty_sold|revenue_usd|cogs_usd|store_discount_usd|membership_discount_usd)/,
  'inventory visible financial fallbacks should not repeatedly reduce filtered products',
)
assert.match(
  inventory,
  /summaryById\.get\(productId\)/,
  'inventory movement detail should resolve products from the indexed summary map before falling back to API reads',
)
assert.match(
  inventory,
  /withLoaderTimeout\(\s*\(\) => getInventoryApi\(\)\.getReturns\(\{ scope: 'all' \}\),\s*'Inventory returns stats',\s*INVENTORY_RETURNS_STATS_TIMEOUT_MS,\s*\)/,
  'inventory return stats should timeout slow returns reads',
)
assert.match(
  inventory,
  /const nextReturnStats = \{[\s\S]*supplier_loss_usd: 0,[\s\S]*\}[\s\S]*for \(const ret of rets\)/,
  'inventory return stats should aggregate loaded returns in one pass',
)
assert.doesNotMatch(
  inventory,
  /const active = rets\.filter[\s\S]*const customerReturns = active\.filter[\s\S]*const supplierReturns = active\.filter/,
  'inventory return stats should not repeatedly filter the returns list',
)
assert.match(
  inventory,
  /withLoaderTimeout\(\s*\(\) => getInventoryApi\(\)\.getDashboard\(\),\s*'Inventory dashboard stats',\s*INVENTORY_DASHBOARD_STATS_TIMEOUT_MS,\s*\)/,
  'inventory dashboard fee stats should timeout slow dashboard reads',
)
assert.doesNotMatch(
  inventory,
  /getReturns\(\{ scope: 'all' \}\)\.catch\(\(\) => \[\]\)/,
  'inventory return stats should not convert failed returns reads into empty successful stats',
)
assert.doesNotMatch(
  inventory,
  /getDashboard\(\)\.catch\(\(\) => \(\{\}\)\)/,
  'inventory dashboard fee stats should not convert failed dashboard reads into empty successful stats',
)
assert.match(
  newReturnModal,
  /const RETURN_SALE_SEARCH_TIMEOUT_MS = 12000/,
  'customer return sale search should use an explicit timeout',
)
assert.match(
  newReturnModal,
  /const RETURN_HISTORY_LOOKUP_TIMEOUT_MS = 10000/,
  'customer return history lookup should use an explicit timeout',
)
assert.match(
  newReturnModal,
  /const RETURN_CREATE_TIMEOUT_MS = 15000/,
  'customer return create should use an explicit timeout',
)
assert.match(
  newReturnModal,
  /withLoaderTimeout\(\s*\(\) => getReturnApi\(\)\.getSales\(\{ limit: 500 \}\),\s*'Return sale search',\s*RETURN_SALE_SEARCH_TIMEOUT_MS,\s*\)/,
  'customer return sale search should timeout slow sales reads',
)
assert.match(
  newReturnModal,
  /withLoaderTimeout\(\s*\(\) => getReturnApi\(\)\.getReturns\(\{ saleId: found\.id \}\),\s*'Return history lookup',\s*RETURN_HISTORY_LOOKUP_TIMEOUT_MS,\s*\)/,
  'customer return history lookup should timeout slow return history reads',
)
assert.match(
  newReturnModal,
  /const api = getReturnApi\(\)[\s\S]*withLoaderTimeout\(\s*\(\) => api\.createReturn\(\{[\s\S]*\}\),\s*'Create return',\s*RETURN_CREATE_TIMEOUT_MS,\s*\)/,
  'customer return create should timeout slow return writes',
)
assert.match(
  editReturnModal,
  /const RETURN_UPDATE_TIMEOUT_MS = 15000/,
  'customer return update should use an explicit timeout',
)
assert.match(
  editReturnModal,
  /const api = getReturnApi\(\)[\s\S]*const payload: ReturnUpdatePayload = \{[\s\S]*withLoaderTimeout\(\s*\(\) => api\.updateReturn\(ret\.id, payload\),\s*'Update return',\s*RETURN_UPDATE_TIMEOUT_MS,\s*\)/,
  'customer return update should timeout slow return writes',
)
assert.doesNotMatch(
  newReturnModal,
  /getReturns\(\{ saleId: found\.id \}\)\.catch\(\(\) => \[\]\)/,
  'customer return history lookup should not treat failed history reads as no previous returns',
)
assert.match(
  contacts,
  /const CONTACTS_EXPORT_LOAD_TIMEOUT_MS = 12000/,
  'contacts all-export should use an explicit timeout',
)
assert.match(
  contacts,
  /withLoaderTimeout\(\s*\(\) => api\.getCustomers\(\),\s*'Contacts export customers',\s*CONTACTS_EXPORT_LOAD_TIMEOUT_MS,\s*\)/,
  'contacts all-export should timeout customer export reads',
)
assert.match(
  contacts,
  /withLoaderTimeout\(\s*\(\) => api\.getSuppliers\(\),\s*'Contacts export suppliers',\s*CONTACTS_EXPORT_LOAD_TIMEOUT_MS,\s*\)/,
  'contacts all-export should timeout supplier export reads',
)
assert.match(
  contacts,
  /withLoaderTimeout\(\s*\(\) => api\.getDeliveryContacts\(\),\s*'Contacts export delivery',\s*CONTACTS_EXPORT_LOAD_TIMEOUT_MS,\s*\)/,
  'contacts all-export should timeout delivery export reads',
)
assert.match(
  contacts,
  /function normalizeContactExportRows\(value: unknown\): ContactExportRow\[\][\s\S]*Array\.isArray\(payload\?\.items\)/,
  'contacts all-export should accept paged API payloads before building the ZIP',
)
assert.match(
  loyaltyPointsPage,
  /const LOYALTY_CUSTOMER_POINTS_TIMEOUT_MS = 12000/,
  'loyalty customer points should use an explicit timeout',
)
assert.match(
  loyaltyPointsPage,
  /const LOYALTY_MEMBERSHIP_LOOKUP_TIMEOUT_MS = 12000/,
  'loyalty membership lookup should use an explicit timeout',
)
assert.match(
  loyaltyPointsPage,
  /withLoaderTimeout\(\(\) => (?:window\.api|getLoyaltyApi\(\))\.getCustomers\(\), label, LOYALTY_CUSTOMER_POINTS_TIMEOUT_MS\)/,
  'loyalty customer points should timeout slow customer reads',
)
assert.match(
  loyaltyPointsPage,
  /withLoaderTimeout\(\s*\(\) => (?:window\.api|getLoyaltyApi\(\))\.lookupPortalMembership\(value\),\s*'Loyalty membership lookup',\s*LOYALTY_MEMBERSHIP_LOOKUP_TIMEOUT_MS,\s*\)/,
  'loyalty membership lookup should timeout slow membership reads',
)
assert.doesNotMatch(
  loyaltyPointsPage,
  /catch \(_\) \{[\s\S]{0,180}setCustomerPoints\(\[\]\)/,
  'loyalty customer points should keep previous point rows after a transient read failure',
)
assert.match(
  returns,
  /const RETURNS_LOAD_TIMEOUT_MS = 20000/,
  'returns list should use an explicit timeout constant',
)
assert.match(
  returns,
  /const RETURNS_DETAIL_TIMEOUT_MS = 10000/,
  'returns detail read should use an explicit timeout constant',
)
assert.match(
  returns,
  /const RETURNS_SNAPSHOT_TIMEOUT_MS = 10000/,
  'returns snapshot read should use an explicit timeout constant',
)
assert.match(
  returns,
  /const RETURNS_HISTORY_RESTORE_TIMEOUT_MS = 15000/,
  'returns history restore should use an explicit timeout constant',
)
assert.match(
  returns,
  /withLoaderTimeout\(\(\) => getReturnApi\(\)\.getReturns\(params\), 'Returns', RETURNS_LOAD_TIMEOUT_MS\)/,
  'returns list should timeout slow return reads with the explicit constant',
)
assert.match(
  returns,
  /withLoaderTimeout\(\s*\(\) => getReturnApi\(\)\.getReturn\(ret\.id\),\s*'Return details',\s*RETURNS_DETAIL_TIMEOUT_MS,\s*\)/,
  'return details should timeout slow detail reads',
)
assert.match(
  returns,
  /withLoaderTimeout\(\s*\(\) => getReturnApi\(\)\.getReturn\(numericId\),\s*'Return snapshot',\s*RETURNS_SNAPSHOT_TIMEOUT_MS,\s*\)/,
  'return snapshot should timeout slow history snapshot reads',
)
assert.match(
  returns,
  /withLoaderTimeout\(\s*\(\) => getReturnApi\(\)\.updateReturn\(snapshot\.id as number \| string, \{[\s\S]*\}\),\s*'Restore return snapshot',\s*RETURNS_HISTORY_RESTORE_TIMEOUT_MS,\s*\)/,
  'return history undo/redo restore should timeout slow return writes',
)
assert.match(
  returns,
  /function normalizeFiniteIdsFrom<T>\(items: T\[] = \[\], getValue: \(value: T\) => unknown = \(value: T\) => value\): number\[]/,
  'returns selection should share a finite-id normalization helper',
)
assert.match(
  returns,
  /const visibleIds = useMemo\(\s*\(\) => normalizeFiniteIdsFrom\(visibleReturns, \(ret\) => ret\.id\),\s*\[visibleReturns\],\s*\)/,
  'returns should precompute visible return ids once for selection cleanup and select all',
)
assert.match(
  returns,
  /countSelectedIds\(normalized, selectedIds\) === normalized\.length/,
  'returns grouped selection should count selected ids without repeated every/map conversions',
)
assert.match(
  returns,
  /const returnScopeSummary = useMemo\(\(\) => \{[\s\S]*for \(const ret of filtered\)[\s\S]*summary\.supplierStats\.lossUsd \+= toNumericAmount\(ret\.supplier_loss_usd\)[\s\S]*summary\.customerStats\.refundedUsd \+= toNumericAmount\(ret\.total_refund_usd\)/,
  'returns stats should split customer/supplier rows and totals in one pass',
)
assert.match(
  returns,
  /countActiveFlags\(\[yearFilter !== 'all', monthFilter !== 'all', typeFilter !== 'all', scope !== CUSTOMER_SCOPE, returnGroupMode !== 'time', returnSortDirection !== 'desc'\]\)/,
  'returns active filter count should avoid temporary filtered boolean arrays',
)
assert.doesNotMatch(
  returns,
  /visibleReturns\.map\(\(ret\) => Number\(ret\.id\)\)\.filter/,
  'returns selection cleanup should not rebuild visible ids with map/filter',
)
assert.doesNotMatch(
  returns,
  /customerRows\.filter\(\(ret\) => ret\.return_type ===/,
  'returns customer stats should not filter customer rows once per stat tile',
)
assert.doesNotMatch(
  returns,
  /\[yearFilter !== 'all', monthFilter !== 'all', typeFilter !== 'all', scope !== CUSTOMER_SCOPE, returnGroupMode !== 'time', returnSortDirection !== 'desc'\]\.filter\(Boolean\)\.length/,
  'returns active filter count should not allocate a boolean array just to filter it',
)
assert.match(
  catalogPage,
  /const CATALOG_PORTAL_AI_STATUS_TIMEOUT_MS = 8000/,
  'catalog portal AI status should use an explicit timeout constant',
)
assert.match(
  catalogPage,
  /const CATALOG_PORTAL_EDITOR_HELPERS_TIMEOUT_MS = 10000/,
  'catalog portal editor helper reads should use an explicit timeout constant',
)
assert.match(
  catalogPage,
  /const CATALOG_PORTAL_BOOTSTRAP_TIMEOUT_MS = 15000/,
  'catalog portal bootstrap should use an explicit timeout constant',
)
assert.match(
  catalogPage,
  /const CATALOG_PORTAL_PRODUCT_SEARCH_TIMEOUT_MS = 12000/,
  'catalog portal product search should use an explicit timeout constant',
)
assert.match(
  catalogPage,
  /const CATALOG_MEMBERSHIP_LOOKUP_TIMEOUT_MS = 12000/,
  'catalog membership lookup should use an explicit timeout constant',
)
assert.match(
  catalogPage,
  /withLoaderTimeout\(\s*\(\) => getCatalogApi\(\)\.getPortalAiStatus\(\),\s*'Portal AI status',\s*CATALOG_PORTAL_AI_STATUS_TIMEOUT_MS,\s*\)/,
  'catalog portal AI status should timeout slow status reads',
)
assert.match(
  catalogPage,
  /withLoaderTimeout\(\s*\(\) => getCatalogApi\(\)\.getAiProviders\(\),\s*'Portal AI providers',\s*CATALOG_PORTAL_EDITOR_HELPERS_TIMEOUT_MS,\s*\)/,
  'catalog portal AI providers should timeout slow provider reads',
)
assert.match(
  catalogPage,
  /withLoaderTimeout\(\s*\(\) => getCatalogApi\(\)\.getPortalSubmissionsForReview\(\),\s*'Portal review items',\s*CATALOG_PORTAL_EDITOR_HELPERS_TIMEOUT_MS,\s*\)/,
  'catalog portal review items should timeout slow review reads',
)
assert.match(
  catalogPage,
  /withLoaderTimeout\(\(\) => loadPortal\(\), 'Customer portal', CATALOG_PORTAL_BOOTSTRAP_TIMEOUT_MS\)/,
  'catalog portal bootstrap should timeout slow portal bootstraps',
)
assert.match(
  catalogPage,
  /withLoaderTimeout\(\s*\(\) => getCatalogApi\(\)\.getPortalBootstrap\(\),\s*'Portal bootstrap',\s*CATALOG_PORTAL_BOOTSTRAP_TIMEOUT_MS,\s*\)/,
  'catalog portal bootstrap API read should timeout slow bootstrap reads',
)
assert.match(
  catalogPage,
  /if \(publicView\) \{[\s\S]*getCatalogApi\(\)\.getPortalBootstrap\(\)[\s\S]*const meta = bootstrapResult\?\.meta \|\| null[\s\S]*const catalogPage = bootstrapResult\?\.catalog \|\| null/,
  'public catalog first-load should use the single bootstrap payload for config, metadata, and first products',
)
assert.match(
  catalogPage,
  /skipNextBootstrappedProductSearchRef\.current = true[\s\S]*if \(publicView && skipNextBootstrappedProductSearchRef\.current\) \{[\s\S]*skipNextBootstrappedProductSearchRef\.current = false[\s\S]*return undefined/,
  'public catalog should not duplicate the bootstrapped first product page with an immediate search request',
)
assert.doesNotMatch(
  catalogPage,
  /if \(publicView\) \{[\s\S]{0,900}getCatalogApi\(\)\.getPortalConfig\(\)/,
  'public catalog should not start with a standalone config read',
)
assert.doesNotMatch(
  catalogPage,
  /if \(publicView\) \{[\s\S]{0,1800}getCatalogApi\(\)\.getPortalCatalogMeta/,
  'public catalog should not start with a standalone metadata read',
)
assert.match(
  catalogPage,
  /withLoaderTimeout\(\s*\(\) => getCatalogApi\(\)\.searchPortalCatalogProducts\(params\),\s*'Portal product search',\s*CATALOG_PORTAL_PRODUCT_SEARCH_TIMEOUT_MS,\s*\)/,
  'catalog portal product search should timeout slow product reads',
)
assert.match(
  catalogPage,
  /'Portal favicon',\s*CATALOG_PORTAL_FAVICON_TIMEOUT_MS,/,
  'catalog portal favicon generation should use the explicit timeout',
)
assert.match(
  catalogPage,
  /'Portal AI request',\s*CATALOG_PORTAL_AI_REQUEST_TIMEOUT_MS,/,
  'catalog portal AI requests should use the explicit timeout',
)
assert.match(
  catalogPage,
  /const CATALOG_PORTAL_MEDIA_UPLOAD_TIMEOUT_MS = 30000/,
  'catalog portal media uploads should use an explicit timeout constant',
)
assert.match(
  catalogPage,
  /const CATALOG_PORTAL_SUBMISSION_TIMEOUT_MS = 12000/,
  'catalog portal submissions should use an explicit timeout constant',
)
assert.match(
  catalogPage,
  /const CATALOG_PORTAL_REVIEW_TIMEOUT_MS = 12000/,
  'catalog portal submission reviews should use an explicit timeout constant',
)
assert.match(
  catalogPage,
  /const CATALOG_SUBMISSION_MAX_SCREENSHOTS = 8/,
  'catalog portal submissions should keep the screenshot cap explicit',
)
assert.match(
  catalogPage,
  /const CATALOG_IMAGE_READ_CONCURRENCY = 2/,
  'catalog portal image reads should use a bounded concurrency constant',
)
assert.match(
  catalogPage,
  /readImageFilesAsDataUrls\(files,[\s\S]*limit: remainingSlots,[\s\S]*Failed to read pasted image/,
  'catalog pasted screenshots should only read the remaining screenshot slots',
)
assert.doesNotMatch(
  catalogPage,
  /Promise\.all\(files\.map\(\(file\) => new Promise/,
  'catalog image readers should not eagerly read every selected file at once',
)
assert.match(
  catalogPage,
  /withLoaderTimeout\(\s*\(\) => getCatalogApi\(\)\.uploadFileAsset\(\{[\s\S]*signal: controller\.signal,[\s\S]*onProgress: \(\{ percent \}[\s\S]*\) => updateMediaUploadState\(targetKey, \{ type: 'progress', progress: percent \}\),[\s\S]*\}\),\s*'Upload portal media',\s*CATALOG_PORTAL_MEDIA_UPLOAD_TIMEOUT_MS,\s*\)/,
  'catalog portal media uploads should timeout slow file uploads',
)
assert.match(
  catalogPage,
  /withLoaderTimeout\(\s*\(\) => getCatalogApi\(\)\.createPortalSubmission\(\{[\s\S]*screenshots: submissionDraft\.screenshots,[\s\S]*\}\),\s*'Create portal submission',\s*CATALOG_PORTAL_SUBMISSION_TIMEOUT_MS,\s*\)/,
  'catalog portal submissions should timeout slow create actions',
)
assert.match(
  catalogPage,
  /withLoaderTimeout\(\s*\(\) => getCatalogApi\(\)\.reviewPortalSubmission\(item\.id, \{[\s\S]*userName: user\?\.name,[\s\S]*\}\),\s*'Review portal submission',\s*CATALOG_PORTAL_REVIEW_TIMEOUT_MS,\s*\)/,
  'catalog portal reviews should timeout slow review actions',
)
assert.match(
  catalogPage,
  /withLoaderTimeout\(\s*\(\) => getCatalogApi\(\)\.lookupPortalMembership\(value\),\s*label,\s*CATALOG_MEMBERSHIP_LOOKUP_TIMEOUT_MS,\s*\)/,
  'catalog membership lookup should timeout slow membership reads',
)
assert.doesNotMatch(
  catalogPage,
  /catch \(error\) \{[\s\S]{0,180}setMembershipData\(null\)/,
  'catalog membership transient lookup failures should not clear previous membership data',
)
assert.match(
  receiptSettingsPage,
  /const RECEIPT_SETTINGS_SAVE_TIMEOUT_MS = 12000/,
  'receipt settings save should use an explicit timeout constant',
)
assert.match(
  receiptSettingsPage,
  /const RECEIPT_SETTINGS_REFRESH_TIMEOUT_MS = 10000/,
  'receipt settings refresh should use an explicit timeout constant',
)
assert.match(
  receiptSettingsPage,
  /'Receipt settings save',\s*RECEIPT_SETTINGS_SAVE_TIMEOUT_MS,/,
  'receipt settings save should timeout slow settings writes with the explicit constant',
)
assert.match(
  receiptSettingsPage,
  /'Receipt settings refresh',\s*RECEIPT_SETTINGS_REFRESH_TIMEOUT_MS,/,
  'receipt settings manual refresh should timeout slow settings reads',
)
assert.match(
  receiptSettingsPage,
  /'Receipt settings silent refresh',\s*RECEIPT_SETTINGS_REFRESH_TIMEOUT_MS,/,
  'receipt settings silent refresh should timeout slow settings reads',
)
assert.match(
  receiptPreview,
  /const RECEIPT_PREVIEW_IMPORT_TIMEOUT_MS = 12000/,
  'receipt preview import should use an explicit timeout constant',
)
assert.match(
  receiptPreview,
  /'Receipt preview',\s*RECEIPT_PREVIEW_IMPORT_TIMEOUT_MS,/,
  'receipt preview dynamic import should timeout slow preview chunks',
)
assert.doesNotMatch(
  receipt,
  /from ['"]\.\.\/\.\.\/utils\/printReceipt['"]/,
  'receipt preview should not statically load PDF/image/print generators before export intent',
)
assert.match(
  receipt,
  /let receiptPrintModulePromise: Promise<ReceiptPrintModule> \| null = null[\s\S]*function loadReceiptPrintModule\(\): Promise<ReceiptPrintModule>[\s\S]*import\('\.\.\/\.\.\/utils\/printReceipt'\)/,
  'receipt export buttons should lazy-load the print/PDF/image generator through a memoized dynamic import',
)
assert.match(
  receipt,
  /const printTools = await loadReceiptPrintModule\(\)[\s\S]*printTools\.downloadReceiptImage[\s\S]*printTools\.printReceipt[\s\S]*printTools\.openReceiptPdf/,
  'receipt export actions should use the lazy-loaded print tools for image, print, and PDF flows',
)
assert.match(
  usersPage,
  /const USERS_LIST_TIMEOUT_MS = 8000/,
  'users list should use an explicit timeout constant',
)
assert.match(
  usersPage,
  /const ROLES_LIST_TIMEOUT_MS = 8000/,
  'roles list should use an explicit timeout constant',
)
assert.match(
  usersPage,
  /const USERS_HISTORY_READY_DELAY_MS = 1800/,
  'Users background history should wait until after first route-ready work',
)
assert.match(
  usersPage,
  /const \[historyReady, setHistoryReady\] = useState\(false\)/,
  'Users should have an explicit post-ready action-history gate',
)
assert.match(
  usersPage,
  /useActionHistory\(\{ limit: 3, notify, enabled: historyReady \}\)/,
  'Users should not fetch server action history during first route load',
)
assert.match(
  usersPage,
  /if \(!loadedOnceRef\.current \|\| loading\) return undefined[\s\S]*window\.setTimeout\(\(\) => \{[\s\S]*setHistoryReady\(true\)[\s\S]*USERS_HISTORY_READY_DELAY_MS/,
  'Users should enable history only after the first user data load settles',
)
assert.match(
  usersPage,
  /withLoaderTimeout\(\(\) => getUsersApi\(\)\.getUsers\(\), 'Users list', USERS_LIST_TIMEOUT_MS\)/,
  'users list should timeout slow user reads',
)
assert.match(
  usersPage,
  /withLoaderTimeout\(\(\) => getUsersApi\(\)\.getRoles\(\), 'Roles list', ROLES_LIST_TIMEOUT_MS\)/,
  'roles list should timeout slow role reads',
)
assert.doesNotMatch(
  usersPage,
  /catch \(error\) \{[\s\S]{0,220}if \(!rolesLoadedOnceRef\.current\) \{[\s\S]{0,120}setRoles\(\[\]\)[\s\S]{0,120}rolesLoadedOnceRef\.current = true/,
  'roles list should not cache a failed first load as an empty completed load',
)
assert.doesNotMatch(
  usersPage,
  /if \(!loadedOnceRef\.current\) \{[\s\S]{0,160}setUsers\(\[\]\)[\s\S]{0,120}loadedOnceRef\.current = true/,
  'users list should not cache a failed first load as an empty completed load',
)
assert.match(
  userProfileModal,
  /const PROFILE_LOAD_TIMEOUT_MS = 10000/,
  'profile details should use an explicit timeout constant',
)
assert.match(
  userProfileModal,
  /const PROFILE_OTP_STATUS_TIMEOUT_MS = 8000/,
  'profile OTP status should use an explicit timeout constant',
)
assert.match(
  userProfileModal,
  /const PROFILE_VERIFICATION_CAPS_TIMEOUT_MS = 8000/,
  'profile verification capabilities should use an explicit timeout constant',
)
assert.match(
  userProfileModal,
  /const PROFILE_AUTH_METHODS_TIMEOUT_MS = 12000/,
  'profile sign-in methods should use an explicit timeout constant',
)
assert.match(
  userProfileModal,
  /withLoaderTimeout\(\s*\(\) => getProfileApi\(\)\.getUserProfile\(user\.id as EntityId\),\s*'Profile details',\s*PROFILE_LOAD_TIMEOUT_MS,\s*\)/,
  'profile details should timeout slow reads',
)
assert.match(
  userProfileModal,
  /withLoaderTimeout\(\s*\(\) => getProfileApi\(\)\.otpStatus\(user\.id as EntityId\),\s*'Profile OTP status',\s*PROFILE_OTP_STATUS_TIMEOUT_MS,\s*\)/,
  'profile OTP status should timeout slow reads',
)
assert.match(
  userProfileModal,
  /withLoaderTimeout\(\s*\(\) => getProfileApi\(\)\.getVerificationCapabilities\?\.\(\),\s*'Profile verification capabilities',\s*PROFILE_VERIFICATION_CAPS_TIMEOUT_MS,\s*\)/,
  'profile verification capabilities should timeout slow reads',
)
assert.match(
  userProfileModal,
  /withLoaderTimeout\(\s*\(\) => getProfileApi\(\)\.getUserAuthMethods\?\.\(user\.id as EntityId\),\s*'Profile sign-in methods',\s*PROFILE_AUTH_METHODS_TIMEOUT_MS,\s*\)/,
  'profile sign-in methods should timeout slow reads',
)
assert.match(
  auditLog,
  /const AUDIT_LOG_LOAD_TIMEOUT_MS = 20000/,
  'audit log should use an explicit load timeout constant',
)
assert.match(
  auditLog,
  /const AUDIT_LOG_RETENTION_DELETE_TIMEOUT_MS = 12000/,
  'audit log retention cleanup should use an explicit timeout constant',
)
assert.match(
  auditLog,
  /withLoaderTimeout\(\s*\(\) => getAuditApi\(\)\.getAuditLogs\(params\),\s*'Audit log',\s*AUDIT_LOG_LOAD_TIMEOUT_MS,\s*\)/,
  'audit log should timeout slow audit reads with the explicit constant',
)
assert.match(
  auditLog,
  /withLoaderTimeout\(\s*\(\) => getAuditApi\(\)\.deleteAuditLogsRetention\(30\),\s*'Clear old audit logs',\s*AUDIT_LOG_RETENTION_DELETE_TIMEOUT_MS,\s*\)/,
  'audit log retention cleanup should timeout slow delete actions',
)
assert.match(
  auditLog,
  /function normalizeFiniteIdsFrom<T>\(items: T\[\] = \[\], getValue: \(value: T\) => unknown = \(value\) => value\): number\[\]/,
  'audit log selection should share a finite-id normalization helper',
)
assert.match(
  auditLog,
  /const visibleIds = useMemo\(\s*\(\) => normalizeFiniteIdsFrom\(visibleLogs, \(log\) => log\.id\),\s*\[visibleLogs\],\s*\)/,
  'audit log should precompute visible ids once for selection cleanup and select all',
)
assert.match(
  auditLog,
  /countSelectedIds\(normalized, selectedIds\) === normalized\.length/,
  'audit log grouped selection should count selected ids without repeated every/map conversions',
)
assert.match(
  auditLog,
  /countActiveFlags\(\[yearFilter !== 'all', monthFilter !== 'all', actionFilter !== 'all', userFilter !== 'all', sortDirection !== 'desc', groupMode !== 'time'\]\)/,
  'audit log active filter count should avoid temporary filtered boolean arrays',
)
assert.doesNotMatch(
  auditLog,
  /visibleLogs\.map\(\(log\) => Number\(log\.id\)\)\.filter/,
  'audit log selection cleanup should not rebuild visible ids with map/filter',
)
assert.doesNotMatch(
  auditLog,
  /\[yearFilter !== 'all', monthFilter !== 'all', actionFilter !== 'all', userFilter !== 'all', sortDirection !== 'desc', groupMode !== 'time'\]\.filter\(Boolean\)\.length/,
  'audit log active filter count should not allocate a boolean array just to filter it',
)
assert.match(
  serverPage,
  /const SERVER_PENDING_SYNC_TIMEOUT_MS = 8000/,
  'server pending sync state should use an explicit timeout constant',
)
assert.match(
  serverPage,
  /const SERVER_DIAGNOSTICS_TIMEOUT_MS = 10000/,
  'server diagnostics should use an explicit timeout constant',
)
assert.match(
  serverPage,
  /const SERVER_BOOTSTRAP_TIMEOUT_MS = 10000/,
  'server bootstrap should use an explicit timeout constant',
)
assert.match(
  serverPage,
  /const SERVER_SECURITY_CONFIG_TIMEOUT_MS = 8000/,
  'server security config should use an explicit timeout constant',
)
assert.match(
  serverPage,
  /const SERVER_SYNC_QUEUE_ACTION_TIMEOUT_MS = 12000/,
  'server queue actions should use an explicit timeout constant',
)
assert.match(
  serverPage,
  /const SERVER_SYNC_TEST_TIMEOUT_MS = 12000/,
  'server connection test should use an explicit timeout constant',
)
assert.match(
  serverPage,
  /withLoaderTimeout\(\s*\(\) => (?:getInventoryApi\\(\\)\\?|getServerApi\(\))\.getPendingSyncState\?\.\(\),\s*'Pending sync queue',\s*SERVER_PENDING_SYNC_TIMEOUT_MS,\s*\)/,
  'server pending sync state should timeout slow queue reads',
)
assert.doesNotMatch(
  serverPage,
  /setClientLog\(getServerApi\(\)\.getCallLog\?\.\(\) \|\| \[\]\)\s*\n\s*loadQueueState\(\)/,
  'server diagnostics should not wake IndexedDB queue reads on the default first paint',
)
assert.match(
  serverPage,
  /const onQueueChanged = \(\) => \{[\s\S]*if \(tab === 'queue'\) loadQueueState\(\)[\s\S]*\}/,
  'server queue events should only refresh the IndexedDB queue while the queue tab is active',
)
assert.match(
  serverPage,
  /useEffect\(\(\) => \{[\s\S]*if \(!active \|\| tab !== 'queue'\) return[\s\S]*loadQueueState\(\)[\s\S]*\}, \[active, loadQueueState, tab\]\)/,
  'server queue tab should load pending sync state on demand',
)
assert.match(
  serverPage,
  /withLoaderTimeout\(\s*\(\) => \{[\s\S]*api\.getSystemBootstrap[\s\S]*return api\.getSystemBootstrap\(\)[\s\S]*\},\s*'Server bootstrap',\s*SERVER_BOOTSTRAP_TIMEOUT_MS,\s*\)/,
  'server first-load should use one bootstrap read for config and diagnostics',
)
assert.match(
  serverPage,
  /withLoaderTimeout\(\s*\(\) => (?:window\.api|getServerApi\(\))\.getSystemDebugLog\(\),\s*'Server diagnostics',\s*SERVER_DIAGNOSTICS_TIMEOUT_MS,\s*\)/,
  'server diagnostics should timeout slow debug log reads',
)
assert.match(
  serverPage,
  /withLoaderTimeout\(\s*\(\) => (?:window\.api|getServerApi\(\))\.getSystemConfig\?\.\(\),\s*'Sync settings',\s*SERVER_SECURITY_CONFIG_TIMEOUT_MS,\s*\)/,
  'server sync settings should timeout slow config reads',
)
assert.match(
  serverPage,
  /withLoaderTimeout\(\s*\(\) => (?:window\.api|getServerApi\(\))\.retryPendingSyncNow\?\.\(\),\s*'Retry pending sync queue',\s*SERVER_SYNC_QUEUE_ACTION_TIMEOUT_MS,\s*\)/,
  'server queue retry should timeout slow queue actions',
)
assert.match(
  serverPage,
  /withLoaderTimeout\(\s*\(\) => (?:window\.api|getServerApi\(\))\.discardPendingSyncQueue\?\.\(\),\s*'Discard pending sync queue',\s*SERVER_SYNC_QUEUE_ACTION_TIMEOUT_MS,\s*\)/,
  'server queue discard should timeout slow queue actions',
)
assert.match(
  serverPage,
  /withLoaderTimeout\(\s*\(\) => (?:window\.api|getServerApi\(\))\.testSyncServer\(url\),\s*'Test sync server',\s*SERVER_SYNC_TEST_TIMEOUT_MS,\s*\)/,
  'server connection test should timeout slow sync test actions',
)
assert.match(serverPage, /const timer = setInterval\(fetchServerLog, 3000\)/, 'server diagnostics refresh should still poll after startup')
assert.doesNotMatch(serverPage, /fetchServerLog\(\)\s*const timer = setInterval\(fetchServerLog, 3000\)/, 'server diagnostics should not issue a duplicate immediate debug log read during first route load')
assert.match(serverPage, /const SERVER_ONLINE_CHECK_READY_DELAY_MS = 1800/, 'server online count should wait until after first route-ready work')
assert.match(serverPage, /window\.setTimeout\(check, SERVER_ONLINE_CHECK_READY_DELAY_MS\)[\s\S]*setInterval\(check, 10000\)/, 'server online count should not issue a duplicate health probe during first route load')
assert.match(
  settingsPage,
  /const SETTINGS_OTP_STATUS_TIMEOUT_MS = 8000/,
  'settings OTP status should use an explicit timeout constant',
)
assert.match(
  settingsPage,
  /const SETTINGS_FAVICON_PREVIEW_TIMEOUT_MS = 8000/,
  'settings favicon preview should use an explicit timeout constant',
)
assert.match(
  settingsPage,
  /const SETTINGS_IMAGE_UPLOAD_TIMEOUT_MS = 30000/,
  'settings image uploads should use an explicit timeout constant',
)
assert.match(
  settingsPage,
  /withLoaderTimeout\(\s*\(\) => getSettingsApi\(\)\.otpStatus\?\.\(userId\),\s*'OTP status',\s*SETTINGS_OTP_STATUS_TIMEOUT_MS,\s*\)/,
  'settings OTP status should timeout slow OTP status reads',
)
assert.match(
  settingsPage,
  /'Settings favicon preview',\s*SETTINGS_FAVICON_PREVIEW_TIMEOUT_MS,/,
  'settings favicon preview should timeout slow preview generation',
)
assert.match(
  settingsPage,
  /withLoaderTimeout\(\s*\(\) => getSettingsApi\(\)\.uploadFileAsset\?\.\(\{[\s\S]*signal: controller\.signal,[\s\S]*onProgress: \(\{ percent \}\) => updateUploadState\(key, \{ type: 'progress', progress: percent \}\),[\s\S]*\}\),\s*'Upload settings image',\s*SETTINGS_IMAGE_UPLOAD_TIMEOUT_MS,\s*\)/,
  'settings image uploads should timeout slow file uploads',
)
assert.doesNotMatch(
  settingsPage,
  /import \{ createCircularFaviconDataUrl \} from '\.\.\/\.\.\/utils\/favicon\.ts'/,
  'Settings should not statically import favicon canvas helpers during route load',
)
assert.match(
  settingsPage,
  /const SETTINGS_FAVICON_PREVIEW_DELAY_MS = 1800[\s\S]*const SETTINGS_FAVICON_PREVIEW_IDLE_TIMEOUT_MS = 7000/,
  'Settings favicon preview should be delayed past route-ready and bounded by an idle timeout',
)
assert.match(
  settingsPage,
  /const \{ createCircularFaviconDataUrl \} = await import\('\.\.\/\.\.\/utils\/favicon\.ts'\)/,
  'Settings should load favicon canvas helpers only inside the delayed preview task',
)
assert.doesNotMatch(
  settingsPage,
  /from '\.\.\/\.\.\/utils\/mediaUpload\.ts'/,
  'Settings should not statically import the heavier media upload URL helper chunk during route load',
)
assert.match(
  settingsPage,
  /from '\.\.\/\.\.\/utils\/mediaUploadState\.ts'/,
  'Settings should statically use only the tiny upload-state helpers during route load',
)
assert.match(
  settingsPage,
  /const \{ buildCacheBustedMediaPath \} = await import\('\.\.\/\.\.\/utils\/mediaUpload\.ts'\)/,
  'Settings should load the media URL cache-buster only after an image upload succeeds',
)
assert.match(
  mediaUpload,
  /from '\.\/mediaUploadState\.ts'/,
  'mediaUpload should re-export shared upload state helpers for existing callers',
)
assert.doesNotMatch(
  mediaUploadState,
  /publicAssetUrls|resolvePublicAssetUrl/,
  'mediaUploadState should stay independent of public asset URL helpers',
)
assert.doesNotMatch(
  settingsPage,
  /import OtpModal from '\.\/OtpModal'/,
  'Settings should not statically import the OTP modal during normal route load',
)
assert.match(
  settingsPage,
  /const LazyOtpModal = lazy\(async \(\) => \(\{ default: \(await import\('\.\/OtpModal'\)\)\.default \}\)\)/,
  'Settings should lazy-load the OTP modal only after a 2FA action opens it',
)
assert.match(
  settingsPage,
  /otpModal \? \([\s\S]*<Suspense fallback=\{null\}>[\s\S]*<LazyOtpModal/,
  'Settings should render the lazy OTP modal behind a Suspense intent boundary',
)
assert.match(
  otpModal,
  /const OTP_SETUP_TIMEOUT_MS = 12000/,
  'OTP setup should use an explicit timeout constant',
)
assert.match(
  otpModal,
  /const OTP_CONFIRM_TIMEOUT_MS = 12000/,
  'OTP confirmation should use an explicit timeout constant',
)
assert.match(
  otpModal,
  /const OTP_DISABLE_TIMEOUT_MS = 12000/,
  'OTP disable should use an explicit timeout constant',
)
assert.match(
  otpModal,
  /withLoaderTimeout\(\s*\(\) => [\s\S]*otpSetup\?\.\(\{ userId \}\)[\s\S]*'OTP setup',\s*OTP_SETUP_TIMEOUT_MS,\s*\)/,
  'OTP setup should timeout slow setup reads',
)
assert.match(
  otpModal,
  /'OTP confirmation',\s*OTP_CONFIRM_TIMEOUT_MS,/,
  'OTP confirmation should timeout slow confirm actions',
)
assert.match(
  otpModal,
  /'OTP disable',\s*OTP_DISABLE_TIMEOUT_MS,/,
  'OTP disable should timeout slow disable actions',
)
assert.match(
  resetData,
  /const RESET_DATA_TIMEOUT_MS = 60000/,
  'reset data should use an explicit timeout constant',
)
assert.match(
  resetData,
  /const FACTORY_RESET_TIMEOUT_MS = 90000/,
  'factory reset should use an explicit timeout constant',
)
assert.match(
  resetData,
  /withLoaderTimeout\(\s*\(\) => [\s\S]*resetData\?\.\(mode\)[\s\S]*'Reset business data',\s*RESET_DATA_TIMEOUT_MS,\s*\)/,
  'reset data should timeout slow destructive reset actions',
)
assert.match(
  resetData,
  /withLoaderTimeout\(\s*\(\) => [\s\S]*factoryReset\?\.\(\)[\s\S]*'Factory reset',\s*FACTORY_RESET_TIMEOUT_MS,\s*\)/,
  'factory reset should timeout slow destructive reset actions',
)
assert.match(
  productForm,
  /const PRODUCT_SUPPLIERS_TIMEOUT_MS = 8000/,
  'product supplier options should use an explicit timeout',
)
assert.match(
  productPageConfig,
  /export const PRODUCTS_AUX_OPTIONS_TIMEOUT_MS = 8000/,
  'products auxiliary options should use an explicit timeout',
)
assert.match(
  productPageConfig,
  /export const PRODUCTS_FILTER_META_TIMEOUT_MS = 8000/,
  'products filter metadata should use an explicit timeout',
)
assert.match(
  productPageConfig,
  /export const PRODUCTS_BY_ID_TIMEOUT_MS = 10000/,
  'products by-id refreshes should use an explicit timeout',
)
assert.match(
  productPageConfig,
  /export const PRODUCT_STOCK_MUTATION_TIMEOUT_MS = 12000/,
  'products page stock mutations should use an explicit timeout',
)
assert.match(
  products,
  /const runProductStockMutation = useCallback\([\s\S]*withLoaderTimeout\(loader, label, PRODUCT_STOCK_MUTATION_TIMEOUT_MS\)/,
  'products page stock mutations should route through the timeout helper',
)
assert.doesNotMatch(
  products,
  /await\s+(?:window\.api|productApi)\.(adjustStock|transferStock|createProduct|updateProduct|deleteProduct)\(/,
  'products page mutating product and stock API calls should not be awaited directly',
)
assert.match(
  bulkImportModal,
  /const IMPORT_JOB_STATUS_TIMEOUT_MS = 10000/,
  'bulk import cancelled-job recovery should use an explicit status timeout',
)
assert.match(
  bulkImportModal,
  /const IMPORT_JOB_PREFLIGHT_TIMEOUT_MS = 15000/,
  'bulk import final preflight should use an explicit timeout',
)
assert.match(
  bulkImportModal,
  /const PRODUCT_IMPORT_JOB_CREATE_TIMEOUT_MS = 12000/,
  'product import job creation should use an explicit timeout',
)
assert.match(
  bulkImportModal,
  /const PRODUCT_IMPORT_JOB_UPLOAD_TIMEOUT_MS = 45000/,
  'product import CSV upload should use an explicit timeout',
)
assert.match(
  bulkImportModal,
  /const PRODUCT_IMPORT_IMAGE_UPLOAD_TIMEOUT_MS = 120000/,
  'product import image uploads should use an explicit longer timeout',
)
assert.match(
  bulkImportModal,
  /const PRODUCT_IMPORT_JOB_START_TIMEOUT_MS = 12000/,
  'product import job start should use an explicit timeout',
)
assert.match(
  productForm,
  /function loadContactsTransportModule\(\): Promise<ContactsTransportModule>[\s\S]*import\('\.\.\/\.\.\/\.\.\/api\/contactsTransport\.ts'\)[\s\S]*withLoaderTimeout\(\s*async \(\) => \(await loadContactsTransportModule\(\)\)\.getSuppliers\(\),\s*'Product suppliers',\s*PRODUCT_SUPPLIERS_TIMEOUT_MS,\s*\)/,
  'product supplier options should timeout slow supplier reads',
)
assert.match(
  productForm,
  /const PRODUCT_FORM_IMAGE_UPLOAD_TIMEOUT_MS = 30000/,
  'product form image uploads should use an explicit timeout',
)
assert.match(
  productForm,
  /function loadProductImageUploadTransportModule\(\): Promise<ProductImageUploadTransportModule>[\s\S]*import\('\.\.\/\.\.\/\.\.\/api\/productImageUploadTransport\.ts'\)[\s\S]*withLoaderTimeout\(\s*async \(\) => \(await loadProductImageUploadTransportModule\(\)\)\.uploadProductImage\(\{[\s\S]*productId: currentProductId \|\| undefined,[\s\S]*file,[\s\S]*fileName: file\.name \|\| 'product\.jpg',[\s\S]*\}\) as Promise<ProductImageUploadResult \| undefined>,\s*'Upload product form image',\s*PRODUCT_FORM_IMAGE_UPLOAD_TIMEOUT_MS,\s*\)/,
  'product form image uploads should timeout slow uploads',
)
assert.doesNotMatch(
  productForm,
  /getProductFormApi|\(window as Window & \{ api\?:|window\.api|api\.uploadProductImage|api\?\.getSuppliers/,
  'ProductForm supplier and image-upload intents should not wake the broad window.api registry',
)
assert.match(
  products,
  /withLoaderTimeout\(\(\) => productApi\.getCategories\(\), 'Product categories', PRODUCTS_AUX_OPTIONS_TIMEOUT_MS\)/,
  'products auxiliary category reads should timeout slow category requests',
)
assert.match(
  products,
  /withLoaderTimeout\(\(\) => productApi\.getUnits\(\), 'Product units', PRODUCTS_AUX_OPTIONS_TIMEOUT_MS\)/,
  'products auxiliary unit reads should timeout slow unit requests',
)
assert.match(
  products,
  /withLoaderTimeout\(\(\) => productApi\.getBranches\(\), 'Product branches', PRODUCTS_AUX_OPTIONS_TIMEOUT_MS\)/,
  'products auxiliary branch reads should timeout slow branch requests',
)
assert.match(
  products,
  /const PRODUCTS_AUX_OPTIONS_READY_DELAY_MS = 1800/,
  'products auxiliary category, unit, and branch reads should wait until after first product route-ready work',
)
assert.match(
  products,
  /if \(!loadedOnceRef\.current \|\| loading \|\| auxOptionsLoadedRef\.current\) return undefined[\s\S]*window\.setTimeout\(\(\) => \{[\s\S]*setAuxOptionsReady\(true\)[\s\S]*PRODUCTS_AUX_OPTIONS_READY_DELAY_MS/,
  'products should enable auxiliary options only after the first product load settles',
)
assert.match(
  products,
  /const optionUiOpen = isProductFilterMenuOpen[\s\S]*modal === 'form'[\s\S]*modal === 'bulk'[\s\S]*modal === 'cats'[\s\S]*modal === 'units'[\s\S]*if \(optionUiOpen\) setAuxOptionsReady\(true\)/,
  'products should wake auxiliary options immediately when option-dependent UI opens',
)
assert.match(
  products,
  /if \(!isActive \|\| !auxOptionsReady \|\| auxOptionsLoadedRef\.current\) return[\s\S]*void loadAuxOptions\('Product auxiliary options'\)\.catch\(\(\) => \{\}\)/,
  'products should keep auxiliary options out of the first route load and fetch them through the delayed loader',
)
assert.match(
  products,
  /const requestId = beginTrackedRequest\(auxOptionsRequestRef\)[\s\S]*settleLoaderMap\(\{[\s\S]*productApi\.getCategories\(\)[\s\S]*productApi\.getUnits\(\)[\s\S]*productApi\.getBranches\(\)[\s\S]*if \(!isTrackedRequestCurrent\(auxOptionsRequestRef, requestId\)\) return/,
  'products delayed auxiliary options should ignore stale responses',
)
assert.match(
  products,
  /withLoaderTimeout\(\(\) => productApi\.getProductFilters\(\{\}\), 'Product filters', PRODUCTS_FILTER_META_TIMEOUT_MS\)/,
  'products filter metadata should timeout slow filter requests',
)
assert.match(
  products,
  /const PRODUCTS_FILTER_META_READY_DELAY_MS = 1800/,
  'products full filter metadata should wait until after first product route-ready work',
)
assert.match(
  products,
  /if \(!loadedOnceRef\.current \|\| loading \|\| filterMetaLoadedRef\.current\) return undefined[\s\S]*window\.setTimeout\(\(\) => \{[\s\S]*setFilterMetaReady\(true\)[\s\S]*PRODUCTS_FILTER_META_READY_DELAY_MS/,
  'products should enable full filter metadata only after the first product load settles',
)
assert.match(
  products,
  /if \(!isActive \|\| !filterMetaReady \|\| filterMetaLoadedRef\.current\) return[\s\S]*const requestId = beginTrackedRequest\(filterMetaRequestRef\)[\s\S]*withLoaderTimeout\(\(\) => productApi\.getProductFilters\(\{\}\), 'Product filters', PRODUCTS_FILTER_META_TIMEOUT_MS\)[\s\S]*if \(!isTrackedRequestCurrent\(filterMetaRequestRef, requestId\)\) return/,
  'products should keep full filter metadata out of the first route load and ignore stale delayed responses',
)
assert.match(
  products,
  /withLoaderTimeout\(\s*\(\) => productApi\.getProductsByIds\(uniqueIds, \{ include: 'branch_stock,images,batches' \}\),\s*'Products by id',\s*PRODUCTS_BY_ID_TIMEOUT_MS,\s*\)/,
  'products by-id refreshes should timeout slow detail requests',
)
assert.match(
  bulkImportModal,
  /withLoaderTimeout\(\s*\(\) => api\.getImportJob\?\.\(jobId\),\s*'Product import job status',\s*IMPORT_JOB_STATUS_TIMEOUT_MS,\s*\)/,
  'bulk import cancelled-job recovery should timeout slow job status reads',
)
assert.match(
  bulkImportModal,
  /withLoaderTimeout\(\s*\(\) => api\.preflightImportJob\(jobId\),\s*'Product import preflight',\s*IMPORT_JOB_PREFLIGHT_TIMEOUT_MS,\s*\)/,
  'bulk import final preflight should timeout slow server review checks',
)
assert.match(
  bulkImportModal,
  /withLoaderTimeout\(\s*\(\) => api\.createImportJob\(\{[\s\S]*type: 'products'[\s\S]*\}\),\s*'Product import job',\s*PRODUCT_IMPORT_JOB_CREATE_TIMEOUT_MS,\s*\)/,
  'product CSV import should timeout slow job creation',
)
assert.match(
  bulkImportModal,
  /withLoaderTimeout\(\s*\(\) => api\.createImportJob\(\{[\s\S]*mode: 'images_only'[\s\S]*\}\),\s*'Product image import job',\s*PRODUCT_IMPORT_JOB_CREATE_TIMEOUT_MS,\s*\)/,
  'product image-only import should timeout slow job creation',
)
assert.match(
  bulkImportModal,
  /withLoaderTimeout\(\s*\(\) => api\.uploadImportJobCsv\(\{[\s\S]*fileName: csvData\?\.name \|\| 'products-import\.csv'[\s\S]*\}\),\s*'Product import CSV upload',\s*PRODUCT_IMPORT_JOB_UPLOAD_TIMEOUT_MS,\s*\)/,
  'product CSV import should timeout slow CSV uploads',
)
assert.match(
  bulkImportModal,
  /withLoaderTimeout\(\s*\(\) => api\.uploadImportJobCsv\(\{[\s\S]*fileName: 'image-only-import\.csv'[\s\S]*\}\),\s*'Product image import CSV upload',\s*PRODUCT_IMPORT_JOB_UPLOAD_TIMEOUT_MS,\s*\)/,
  'product image-only import should timeout slow CSV manifest uploads',
)
assert.match(
  bulkImportModal,
  /withLoaderTimeout\(\s*\(\) => api\.uploadImportJobZip\(\{ jobId: activeJobId, file: zipFile \}\),\s*'Product import ZIP upload',\s*PRODUCT_IMPORT_IMAGE_UPLOAD_TIMEOUT_MS,\s*\)/,
  'product CSV import should timeout ZIP uploads with an explicit budget',
)
assert.match(
  bulkImportModal,
  /withLoaderTimeout\(\s*\(\) => api\.uploadImportJobImages\(\{[\s\S]*files: browserImages,[\s\S]*\}\),\s*'Product import image upload',\s*PRODUCT_IMPORT_IMAGE_UPLOAD_TIMEOUT_MS,\s*\)/,
  'product CSV import should timeout browser image uploads with an explicit budget',
)
assert.match(
  bulkImportModal,
  /withLoaderTimeout\(\s*\(\) => api\.startImportJob\(activeJobId, \{ source: 'products_modal' \}\),\s*'Product import start',\s*PRODUCT_IMPORT_JOB_START_TIMEOUT_MS,\s*\)/,
  'product CSV import should timeout slow job start',
)
assert.match(
  bulkImportModal,
  /withLoaderTimeout\(\s*\(\) => api\.startImportJob\(activeJobId, \{ source: 'products_modal' \}\),\s*'Product image import start',\s*PRODUCT_IMPORT_JOB_START_TIMEOUT_MS,\s*\)/,
  'product image-only import should timeout slow job start',
)
assert.doesNotMatch(
  productForm,
  /withLoaderTimeout\(\(\) => getInventoryApi\(\)\.getSuppliers\(\), 'Product suppliers'[\s\S]{0,260}catch \{[\s\S]{0,160}setSupplierList\(\[\]\)/,
  'product supplier options should keep previously loaded options on refresh failure',
)
assert.doesNotMatch(
  products,
  /withLoaderTimeout\(\(\) => getInventoryApi\(\)\.getProductFilters\(\{\}\), 'Product filters'[\s\S]{0,260}catch[\s\S]{0,180}setProductFilterMeta\(\{[\s\S]{0,120}brands: \[\]/,
  'products filter metadata should keep previous filters when a refresh fails',
)
assert.match(
  newSupplierReturnModal,
  /const SUPPLIER_RETURN_SETUP_TIMEOUT_MS = 12000/,
  'supplier return setup should use an explicit timeout',
)
assert.match(
  newSupplierReturnModal,
  /const SUPPLIER_RETURN_INVENTORY_TIMEOUT_MS = 12000/,
  'supplier return inventory should use an explicit timeout',
)
assert.match(
  newSupplierReturnModal,
  /const SUPPLIER_RETURN_CREATE_TIMEOUT_MS = 15000/,
  'supplier return create should use an explicit timeout',
)
assert.match(
  newSupplierReturnModal,
  /'Supplier return setup',\s*SUPPLIER_RETURN_SETUP_TIMEOUT_MS,/,
  'supplier return setup should timeout slow branch and supplier reads',
)
assert.match(
  newSupplierReturnModal,
  /'Supplier return inventory',\s*SUPPLIER_RETURN_INVENTORY_TIMEOUT_MS,/,
  'supplier return inventory should timeout slow inventory reads',
)
assert.match(
  newSupplierReturnModal,
  /const api = getSupplierReturnApi\(\)[\s\S]*api\.createSupplierReturn\(\{[\s\S]*\}\)[\s\S]*'Create supplier return',\s*SUPPLIER_RETURN_CREATE_TIMEOUT_MS,\s*\)/,
  'supplier return create should timeout slow supplier-return writes',
)
assert.doesNotMatch(
  newSupplierReturnModal,
  /catch \(error\) \{[\s\S]{0,240}setBranches\(\[\]\)[\s\S]{0,120}setSuppliers\(\[\]\)/,
  'supplier return setup should keep previous branch and supplier options on refresh failure',
)
assert.doesNotMatch(
  newSupplierReturnModal,
  /catch \(error\) \{[\s\S]{0,260}setProducts\(\[\]\)/,
  'supplier return inventory should keep previous products when a same-branch refresh fails',
)
assert.match(
  filePickerModal,
  /const FILE_PICKER_LOAD_TIMEOUT_MS = 8000/,
  'file picker library should use a fast explicit timeout',
)
assert.match(
  filePickerModal,
  /withLoaderTimeout\(\(\) => getFilePickerApi\(\)\.getFiles\(\{ search, mediaType \}\), 'Files library picker', FILE_PICKER_LOAD_TIMEOUT_MS\)/,
  'file picker library should timeout slow file reads',
)
assert.match(
  filePickerModal,
  /const FILE_PICKER_UPLOAD_TIMEOUT_MS = 30000/,
  'file picker uploads should use an explicit timeout',
)
assert.match(
  filePickerModal,
  /const FILE_PICKER_DELETE_TIMEOUT_MS = 12000/,
  'file picker deletes should use an explicit timeout',
)
assert.match(
  filePickerModal,
  /withLoaderTimeout<FileAsset>\(\s*\(\) => getFilePickerApi\(\)\.uploadFileAsset\(\{ file, userId: user\?\.id, userName: user\?\.name \}\),\s*'Upload picker file asset',\s*FILE_PICKER_UPLOAD_TIMEOUT_MS,\s*\)/,
  'file picker uploads should timeout slow upload requests',
)
assert.match(
  filePickerModal,
  /withLoaderTimeout\(\s*\(\) => getFilePickerApi\(\)\.deleteFileAsset\(assetId, \{ expectedUpdatedAt: asset\.updated_at \|\| undefined \}\),\s*'Delete picker file asset',\s*FILE_PICKER_DELETE_TIMEOUT_MS,\s*\)/,
  'file picker deletes should timeout slow delete requests',
)
assert.doesNotMatch(
  filePickerModal,
  /catch \(error\) \{[\s\S]{0,260}setFiles\(\[\]\)/,
  'file picker library should keep previous files visible when a refresh fails',
)
assert.match(
  filesPage,
  /const FILES_LIBRARY_LOAD_TIMEOUT_MS = 10000/,
  'files page library should use an explicit timeout',
)
assert.match(
  filesPage,
  /withLoaderTimeout\(\(\) => filesApi\.getFiles\(\{[\s\S]{0,180}includeMeta: true,[\s\S]{0,80}\}\), 'Files library', FILES_LIBRARY_LOAD_TIMEOUT_MS\)/,
  'files page library should timeout slow file reads',
)
assert.match(
  filesPage,
  /const FILES_ASSET_UPLOAD_TIMEOUT_MS = 30000/,
  'files page uploads should use an explicit timeout',
)
assert.match(
  filesPage,
  /const FILES_ASSET_DELETE_TIMEOUT_MS = 12000/,
  'files page deletes should use an explicit timeout',
)
assert.match(
  filesPage,
  /const FILES_HISTORY_READY_DELAY_MS = 1800/,
  'Files background history should wait until after first route-ready work',
)
assert.match(
  filesPage,
  /const \[historyReady, setHistoryReady\] = useState\(false\)/,
  'Files should have an explicit post-ready action-history gate',
)
assert.match(
  filesPage,
  /useActionHistory\(\{ limit: 3, notify, enabled: historyReady \}\)/,
  'Files should not fetch server action history during first route load',
)
assert.match(
  filesPage,
  /if \(!filesLoadedOnceRef\.current \|\| loadingFiles\) return undefined[\s\S]*window\.setTimeout\(\(\) => \{[\s\S]*setHistoryReady\(true\)[\s\S]*FILES_HISTORY_READY_DELAY_MS/,
  'Files should enable history only after the first file library load settles',
)
assert.match(
  filesPage,
  /withLoaderTimeout\(\s*\(\) => filesApi\.uploadFileAsset\(\{ file, userId: user\?\.id, userName: user\?\.name \}\),\s*'Upload file asset',\s*FILES_ASSET_UPLOAD_TIMEOUT_MS,\s*\)/,
  'files page uploads should timeout slow upload requests',
)
assert.match(
  filesPage,
  /withLoaderTimeout\(\s*\(\) => filesApi\.deleteFileAsset\(asset\.id, \{ expectedUpdatedAt: asset\.updated_at \|\| undefined \}\),\s*'Delete file asset',\s*FILES_ASSET_DELETE_TIMEOUT_MS,\s*\)/,
  'files page deletes should timeout slow delete requests',
)
assert.doesNotMatch(
  filesPage,
  /catch \(error\) \{[\s\S]{0,260}setFiles\(\[\]\)/,
  'files page library should keep previous files visible when a refresh fails',
)
assert.match(
  filesPage,
  /const AI_PROVIDERS_LOAD_TIMEOUT_MS = 8000/,
  'AI provider reads should use an explicit timeout',
)
assert.match(
  filesPage,
  /withLoaderTimeout\(\(\) => filesApi\.getAiProviders\(\), label, AI_PROVIDERS_LOAD_TIMEOUT_MS\)/,
  'AI provider reads should timeout slow provider requests',
)
assert.doesNotMatch(
  filesPage,
  /catch \(error\) \{[\s\S]{0,260}setProviders\(\[\]\)[\s\S]{0,160}setProviderMeta\(\{\}\)/,
  'AI provider reads should keep previous providers and metadata on refresh failure',
)
assert.match(
  filesPage,
  /const AI_RESPONSES_LOAD_TIMEOUT_MS = 8000/,
  'AI response reads should use an explicit timeout',
)
assert.match(
  filesPage,
  /withLoaderTimeout\(\(\) => filesApi\.getAiResponses\(80\), label, AI_RESPONSES_LOAD_TIMEOUT_MS\)/,
  'AI response reads should timeout slow response requests',
)
assert.doesNotMatch(
  filesPage,
  /catch \(error\) \{[\s\S]{0,260}setResponses\(\[\]\)/,
  'AI response reads should keep previous responses visible when a refresh fails',
)

const importModalCases: Array<[source: string, label: string, prefix: string, jobTypePattern: RegExp]> = [
  [contactImportModal, 'contact', 'CONTACT', /type: config\.jobType/],
  [salesImportModal, 'sales', 'SALES', /type: 'sales'/],
  [inventoryImportModal, 'inventory', 'INVENTORY', /type: 'inventory'/],
]

for (const [source, label, prefix, jobTypePattern] of importModalCases) {
  assert.match(
    source,
    new RegExp(`const ${prefix}_IMPORT_JOB_CREATE_TIMEOUT_MS = 12000`),
    `${label} import job creation should use an explicit timeout`,
  )
  assert.match(
    source,
    new RegExp(`const ${prefix}_IMPORT_JOB_UPLOAD_TIMEOUT_MS = 30000`),
    `${label} import CSV upload should use an explicit timeout`,
  )
  assert.match(
    source,
    new RegExp(`const ${prefix}_IMPORT_JOB_START_TIMEOUT_MS = 12000`),
    `${label} import job start should use an explicit timeout`,
  )
  assert.match(source, jobTypePattern, `${label} import should keep the expected job type source`)
  assert.match(
    source,
    /withLoaderTimeout\(\s*\(\) => (?:window\.api|getImportApi\(\)|api)\.createImportJob\(/,
    `${label} import should bound import job creation`,
  )
  assert.match(
    source,
    /withLoaderTimeout\(\s*\(\) => (?:window\.api|getImportApi\(\)|api)\.uploadImportJobCsv\(/,
    `${label} import should bound CSV upload`,
  )
  assert.match(
    source,
    /withLoaderTimeout\(\s*\(\) => (?:window\.api|getImportApi\(\)|api)\.startImportJob\((?:job\.id|jobId)/,
    `${label} import should bound job start`,
  )
}

assert.match(
  pos,
  /const POS_CATALOG_LOAD_TIMEOUT_MS = 15000/,
  'POS catalog reads should use an explicit timeout',
)
assert.match(
  pos,
  /withLoaderTimeout\(\s*\(\) => shouldLoadMetadata[\s\S]*loadPosProductBootstrap\(productQuery\)[\s\S]*searchPosCatalogProducts\(productQuery\)[\s\S]*label,\s*POS_CATALOG_LOAD_TIMEOUT_MS,\s*\)/,
  'POS catalog reads should timeout the combined first-window product and branch request',
)
assert.doesNotMatch(
  pos,
  /getCategories(?:\?\.)?\(\)[\s\S]{0,260}POS_CATALOG_LOAD_TIMEOUT_MS/,
  'POS catalog first route-load batch should not fetch category options',
)
assert.doesNotMatch(
  pos,
  /getProductFilters(?:\?\.)?\(\{\}\)[\s\S]{0,260}POS_CATALOG_LOAD_TIMEOUT_MS/,
  'POS catalog first route-load batch should not fetch full product filters',
)
assert.match(
  pos,
  /const POS_CONTACT_OPTIONS_TIMEOUT_MS = 8000/,
  'POS customer and delivery option reads should use an explicit timeout',
)
assert.match(
  pos,
  /const POS_FILTER_META_TIMEOUT_MS = 8000/,
  'POS full product filter metadata should use an explicit timeout',
)
assert.match(
  pos,
  /const POS_CATEGORY_OPTIONS_TIMEOUT_MS = 8000/,
  'POS category option reads should use an explicit timeout',
)
assert.match(
  pos,
  /const POS_CONTACT_OPTIONS_READY_DELAY_MS = 1800/,
  'POS customer and delivery option reads should wait until after first catalog route-ready work',
)
assert.match(
  pos,
  /const POS_FILTER_META_READY_DELAY_MS = 1800/,
  'POS full product filter metadata should wait until after first catalog route-ready work',
)
assert.match(
  pos,
  /const POS_CATEGORY_OPTIONS_READY_DELAY_MS = 1800/,
  'POS category option reads should wait until after first catalog route-ready work',
)
assert.match(
  pos,
  /const POS_MEMBERSHIP_LOOKUP_TIMEOUT_MS = 12000/,
  'POS membership lookup should use an explicit timeout',
)
assert.match(
  pos,
  /const POS_CUSTOMER_CREATE_TIMEOUT_MS = 12000/,
  'POS quick-add customer writes should use an explicit timeout',
)
assert.match(
  pos,
  /const POS_DELIVERY_CREATE_TIMEOUT_MS = 12000/,
  'POS quick-add delivery writes should use an explicit timeout',
)
assert.match(
  pos,
  /const POS_CHECKOUT_TIMEOUT_MS = 20000/,
  'POS checkout should use an explicit timeout',
)
assert.match(
  pos,
  /withLoaderTimeout\(\s*\(\) => lookupPosPortalMembership\(membershipNumber\),\s*label,\s*POS_MEMBERSHIP_LOOKUP_TIMEOUT_MS,\s*\)/,
  'POS membership lookup should timeout slow membership reads',
)
assert.match(
  pos,
  /withLoaderTimeout\(\s*\(\) => createPosCustomer\(newCustomerForm\),\s*'Create POS customer',\s*POS_CUSTOMER_CREATE_TIMEOUT_MS,\s*\)/,
  'POS quick-add customer writes should timeout slow creates',
)
assert.match(
  pos,
  /withLoaderTimeout\(\s*\(\) => createPosDeliveryContact\(payload\),\s*'Create POS delivery contact',\s*POS_DELIVERY_CREATE_TIMEOUT_MS,\s*\)/,
  'POS quick-add delivery writes should timeout slow creates',
)
assert.match(
  pos,
  /withLoaderTimeout\(\s*\(\) => createPosSale\(saleData\),\s*'Create POS sale',\s*POS_CHECKOUT_TIMEOUT_MS,\s*\)/,
  'POS checkout should timeout slow sale creation',
)
assert.match(
  pos,
  /membershipInfoRef\.current\?\.customer\?\.membership_number[\s\S]{0,260}return membershipInfoRef\.current/,
  'POS membership lookup should keep the last confirmed membership panel visible through a transient same-member refresh failure',
)
assert.match(
  pos,
  /withLoaderTimeout\(\s*\(\) => loadPosCustomers\(\),\s*label,\s*POS_CONTACT_OPTIONS_TIMEOUT_MS\)/,
  'POS customer option reads should timeout slow customer requests',
)
assert.match(
  pos,
  /withLoaderTimeout\(\s*\(\) => loadPosCategories\(\),\s*label,\s*POS_CATEGORY_OPTIONS_TIMEOUT_MS\)/,
  'POS delayed category option reads should timeout slow category requests',
)
assert.match(
  pos,
  /filterOpen[\s\S]{0,160}categoryOptionsLoadedRef\.current[\s\S]{0,120}setCategoryOptionsReady\(true\)/,
  'POS should wake category options immediately when the filter panel opens',
)
assert.doesNotMatch(
  pos,
  /catch \(error\) \{[\s\S]{0,260}setCustomers\(\[\]\)/,
  'POS customer option reads should keep previous customers visible when a refresh fails',
)
assert.match(
  pos,
  /withLoaderTimeout\(\s*\(\) => loadPosDeliveryContacts\(\),\s*label,\s*POS_CONTACT_OPTIONS_TIMEOUT_MS\)/,
  'POS delivery option reads should timeout slow delivery contact requests',
)
assert.match(
  pos,
  /if \(!catalogLoadedOnceRef\.current \|\| catalogRefreshing\) return undefined[\s\S]*window\.setTimeout\(\(\) => \{[\s\S]*setContactOptionsReady\(true\)[\s\S]*POS_CONTACT_OPTIONS_READY_DELAY_MS/,
  'POS should enable contact option reads only after the first catalog load settles',
)
assert.match(
  pos,
  /if \(!isActive \|\| !contactOptionsReady\) return[\s\S]*loadCustomers\('POS initial customers'\)[\s\S]*loadDeliveryContacts\('POS initial delivery contacts'\)/,
  'POS should keep customer and delivery option reads out of the first route load',
)
assert.match(
  pos,
  /if \(!catalogLoadedOnceRef\.current \|\| catalogRefreshing \|\| filterMetaLoadedRef\.current\) return undefined[\s\S]*window\.setTimeout\(\(\) => \{[\s\S]*setFilterMetaReady\(true\)[\s\S]*POS_FILTER_META_READY_DELAY_MS/,
  'POS should enable full filter metadata only after the first catalog load settles',
)
assert.match(
  pos,
  /if \(!isActive \|\| !filterMetaReady \|\| filterMetaLoadedRef\.current\) return[\s\S]*const requestId = beginTrackedRequest\(filterMetaRequestRef\)[\s\S]*withLoaderTimeout\(\(\) => loadPosProductFilters\(\{\}\), 'POS product filters', POS_FILTER_META_TIMEOUT_MS\)[\s\S]*if \(!isTrackedRequestCurrent\(filterMetaRequestRef, requestId\)\) return/,
  'POS should fetch full product filters as a delayed tracked request',
)
assert.match(
  pos,
  /const branchesById = useMemo\(\(\) => new Map\(/,
  'POS should index branch lookups used by cart branch validation',
)
assert.match(
  pos,
  /productsById\.get\(Number\(cartItem\?\.id\)\)/,
  'POS quantity updates should resolve products from the indexed product map',
)
assert.match(
  pos,
  /productsById\.get\(Number\(item\?\.id\)\)/,
  'POS branch updates should resolve products from the indexed product map',
)
assert.match(
  pos,
  /branchesById\.get\(Number\(nextBranchId\)\)\?\.name/,
  'POS branch update errors should resolve branch names from the indexed branch map',
)
assert.match(
  pos,
  /productsById\.get\(Number\(item\.id\)\)/,
  'POS cart detail actions should resolve products from the indexed product map',
)
assert.doesNotMatch(
  pos,
  /getDeliveryContacts\(\)\.catch\(\(\) => \[\]\)/,
  'POS delivery option reads should not convert failed reads into empty successful lists',
)
assert.doesNotMatch(
  pos,
  /catch \(error\) \{[\s\S]{0,260}setDeliveryContacts\(\[\]\)/,
  'POS delivery option reads should keep previous delivery contacts visible when a refresh fails',
)
assert.match(
  manageCategoriesModal,
  /const PRODUCT_CATEGORY_LOOKUP_TIMEOUT_MS = 10000/,
  'category lookup manager should use an explicit timeout',
)
assert.match(
  manageCategoriesModal,
  /const PRODUCT_CATEGORY_PRODUCTS_TIMEOUT_MS = 12000/,
  'category lookup manager product snapshot reads should use an explicit timeout',
)
assert.match(
  manageCategoriesModal,
  /withLoaderTimeout\(\s*\(\) => getCategoryApi\(\)\.getCategories\(\),\s*'Category lookup options',\s*PRODUCT_CATEGORY_LOOKUP_TIMEOUT_MS,\s*\)/,
  'category lookup manager undo lookups should timeout slow category reads',
)
assert.match(
  manageCategoriesModal,
  /fetchLookupProductSnapshots\(\{[\s\S]*field: 'category'[\s\S]*label: 'Category product snapshots'[\s\S]*timeoutMs: PRODUCT_CATEGORY_PRODUCTS_TIMEOUT_MS/,
  'category lookup manager should use paged product snapshot reads',
)
assert.match(
  manageCategoriesModal,
  /restoreLookupProductSnapshots\(\{[\s\S]*field: 'category'[\s\S]*label: 'Category product restore'[\s\S]*timeoutMs: PRODUCT_CATEGORY_PRODUCTS_TIMEOUT_MS/,
  'category lookup manager should use batched product restore reads',
)
assert.doesNotMatch(
  manageCategoriesModal,
  /getInventoryApi\(\)\.getProducts\(\)/,
  'category lookup manager should not fetch the full product catalog for lookup snapshots',
)
assert.match(
  manageCategoriesModal,
  /withLoaderTimeout\(\(\) => Promise\.all\(\[[\s\S]{0,140}getCategoryApi\(\)\.getCategories\(\),[\s\S]{0,140}getCategoryApi\(\)\.getProductLookupUsage\(\),[\s\S]{0,80}\]\), 'Categories', PRODUCT_CATEGORY_LOOKUP_TIMEOUT_MS\)/,
  'category lookup manager should timeout category and usage reads',
)
assert.doesNotMatch(
  manageCategoriesModal,
  /catch \(error\) \{[\s\S]{0,260}setCats\(\[\]\)/,
  'category lookup manager should keep previous categories visible when a refresh fails',
)
assert.match(
  manageCategoriesModal,
  /const categoriesById = useMemo\(\(\) => \{/,
  'category lookup manager should index categories once per render',
)
assert.match(
  manageCategoriesModal,
  /categoriesById\.get\(Number\(id\)\)/,
  'category lookup manager should use the indexed category map for delete snapshots',
)
assert.doesNotMatch(
  manageCategoriesModal,
  /\.map\(\(id\) => cats\.find/,
  'category lookup manager bulk delete should not repeatedly scan categories by id',
)
assert.match(
  manageUnitsModal,
  /const PRODUCT_UNIT_LOOKUP_TIMEOUT_MS = 10000/,
  'unit lookup manager should use an explicit timeout',
)
assert.match(
  manageUnitsModal,
  /const PRODUCT_UNIT_PRODUCTS_TIMEOUT_MS = 12000/,
  'unit lookup manager product snapshot reads should use an explicit timeout',
)
assert.match(
  manageUnitsModal,
  /beginTrackedRequest\(loadRequestRef\)/,
  'unit lookup manager should track the latest load request',
)
assert.match(
  manageUnitsModal,
  /withLoaderTimeout\(\s*\(\) => getUnitApi\(\)\.getUnits\(\),\s*'Unit lookup options',\s*PRODUCT_UNIT_LOOKUP_TIMEOUT_MS,\s*\)/,
  'unit lookup manager undo lookups should timeout slow unit reads',
)
assert.match(
  manageUnitsModal,
  /fetchLookupProductSnapshots\(\{[\s\S]*field: 'unit'[\s\S]*label: 'Unit product snapshots'[\s\S]*timeoutMs: PRODUCT_UNIT_PRODUCTS_TIMEOUT_MS/,
  'unit lookup manager should use paged product snapshot reads',
)
assert.match(
  manageUnitsModal,
  /restoreLookupProductSnapshots\(\{[\s\S]*field: 'unit'[\s\S]*label: 'Unit product restore'[\s\S]*timeoutMs: PRODUCT_UNIT_PRODUCTS_TIMEOUT_MS/,
  'unit lookup manager should use batched product restore reads',
)
assert.doesNotMatch(
  manageUnitsModal,
  /getInventoryApi\(\)\.getProducts\(\)/,
  'unit lookup manager should not fetch the full product catalog for lookup snapshots',
)
assert.match(
  manageUnitsModal,
  /withLoaderTimeout\(\(\) => Promise\.all\(\[[\s\S]{0,140}getUnitApi\(\)\.getUnits\(\),[\s\S]{0,140}getUnitApi\(\)\.getProductLookupUsage\(\),[\s\S]{0,80}\]\), 'Units', PRODUCT_UNIT_LOOKUP_TIMEOUT_MS\)/,
  'unit lookup manager should timeout unit and usage reads',
)
assert.doesNotMatch(
  manageUnitsModal,
  /catch \(error\) \{[\s\S]{0,260}setUnits\(\[\]\)/,
  'unit lookup manager should keep previous units visible when a refresh fails',
)
assert.match(
  manageUnitsModal,
  /const unitsById = useMemo\(\(\) => \{/,
  'unit lookup manager should index units once per render',
)
assert.match(
  manageUnitsModal,
  /unitsById\.get\(Number\(id\)\)/,
  'unit lookup manager should use the indexed unit map for delete snapshots',
)
assert.doesNotMatch(
  manageUnitsModal,
  /\.map\(\(id\) => units\.find/,
  'unit lookup manager bulk delete should not repeatedly scan units by id',
)
assert.match(
  manageBrandsModal,
  /const PRODUCT_BRAND_LOOKUP_TIMEOUT_MS = 10000/,
  'brand lookup manager should use an explicit timeout',
)
assert.match(
  manageBrandsModal,
  /const PRODUCT_BRAND_PRODUCTS_TIMEOUT_MS = 12000/,
  'brand lookup manager product snapshot reads should use an explicit timeout',
)
assert.match(
  manageBrandsModal,
  /beginTrackedRequest\(loadRequestRef\)/,
  'brand lookup manager should track the latest load request',
)
assert.match(
  manageBrandsModal,
  /fetchLookupProductSnapshots\(\{[\s\S]*field: 'brand'[\s\S]*label: 'Brand product snapshots'[\s\S]*timeoutMs: PRODUCT_BRAND_PRODUCTS_TIMEOUT_MS/,
  'brand lookup manager should use paged product snapshot reads',
)
assert.match(
  manageBrandsModal,
  /restoreLookupProductSnapshots\(\{[\s\S]*label: 'Brand product restore'[\s\S]*timeoutMs: PRODUCT_BRAND_PRODUCTS_TIMEOUT_MS/,
  'brand lookup manager should use batched product restore reads',
)
assert.doesNotMatch(
  manageBrandsModal,
  /getInventoryApi\(\)\.getProducts\(\)/,
  'brand lookup manager should not fetch the full product catalog for lookup snapshots',
)
assert.match(
  manageBrandsModal,
  /const brandsByLookup = useMemo\(\(\) => \{/,
  'brand lookup manager should index brands once per render',
)
assert.match(
  manageBrandsModal,
  /brandsByLookup\.get\(normalizeLookup\(name\)\)/,
  'brand lookup manager should use the indexed brand map for delete impact counts',
)
assert.doesNotMatch(
  manageBrandsModal,
  /brandsWithUsage\s*\n\s*\.filter\(\(entry\) => lookups\.has\(normalizeLookup\(entry\.name\)\)\)/,
  'brand lookup manager bulk delete should not repeatedly filter the full brand list for selected names',
)
assert.match(
  productLookupSnapshots,
  /client\.searchProducts\(\{[\s\S]*page,[\s\S]*pageSize: LOOKUP_PRODUCT_PAGE_SIZE,[\s\S]*\[field\]: name/,
  'lookup product snapshots should page through only matching products',
)
assert.match(
  productLookupSnapshots,
  /const LOOKUP_PRODUCT_NAME_CONCURRENCY = 2/,
  'lookup product snapshots should bound concurrent lookup-name scans',
)
assert.match(
  productLookupSnapshots,
  /async function mapLookupNames/,
  'lookup product snapshots should use a bounded name worker helper',
)
assert.match(
  productLookupSnapshots,
  /Math\.min\(LOOKUP_PRODUCT_NAME_CONCURRENCY, list\.length\)/,
  'lookup product snapshots should cap worker count by the configured concurrency',
)
assert.match(
  productLookupSnapshots,
  /await mapLookupNames\(cleanNames, \(name\) =>/,
  'lookup product snapshots should run name scans through the bounded helper',
)
assert.match(
  productLookupSnapshots,
  /client\.getProductsByIds\(batchIds, \{ include: '' \}\)/,
  'lookup product restore should fetch only affected product ids',
)
assert.doesNotMatch(
  productLookupSnapshots,
  /getProducts\(\)/,
  'lookup product snapshot helper should not call the full product catalog endpoint',
)
assert.match(
  manageBrandsModal,
  /withLoaderTimeout\(\(\) => getBrandApi\(\)\.getProductLookupUsage\(\), label, PRODUCT_BRAND_LOOKUP_TIMEOUT_MS\)/,
  'brand lookup manager should timeout usage reads',
)
assert.doesNotMatch(
  manageBrandsModal,
  /catch \(loadError\) \{[\s\S]{0,260}setUsageSummary\(\[\]\)/,
  'brand lookup manager should keep previous usage visible when a refresh fails',
)

console.log('PASS performance loading UX guards')
