import assert from 'node:assert/strict'
import fs from 'node:fs'

const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const appContext = fs.readFileSync(new URL('../src/AppContext.tsx', import.meta.url), 'utf8')
const appContextCore = fs.readFileSync(new URL('../src/app/AppContextCore.tsx', import.meta.url), 'utf8')
const publicCatalogAppProvider = fs.readFileSync(new URL('../src/app/PublicCatalogAppProvider.tsx', import.meta.url), 'utf8')
const publicCatalogRoot = fs.readFileSync(new URL('../src/PublicCatalogRoot.tsx', import.meta.url), 'utf8')
const indexHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const index = fs.readFileSync(new URL('../src/index.tsx', import.meta.url), 'utf8')
const webApi = fs.readFileSync(new URL('../src/web-api.ts', import.meta.url), 'utf8')
const publicWebApi = fs.readFileSync(new URL('../src/public-web-api.ts', import.meta.url), 'utf8')
const serviceWorker = fs.readFileSync(new URL('../src/public-runtime/service-worker.ts', import.meta.url), 'utf8')
const httpApi = fs.readFileSync(new URL('../src/api/http.ts', import.meta.url), 'utf8')
const portalPublicTransport = fs.readFileSync(new URL('../src/api/portalPublicTransport.ts', import.meta.url), 'utf8')
const websocketApi = fs.readFileSync(new URL('../src/api/websocket.ts', import.meta.url), 'utf8')
const appBootstrapTransport = fs.readFileSync(new URL('../src/api/appBootstrapTransport.ts', import.meta.url), 'utf8')
const contactReadTransport = fs.readFileSync(new URL('../src/api/contactReadTransport.ts', import.meta.url), 'utf8')
const contactWriteTransport = fs.readFileSync(new URL('../src/api/contactWriteTransport.ts', import.meta.url), 'utf8')
const contactsTransport = fs.readFileSync(new URL('../src/api/contactsTransport.ts', import.meta.url), 'utf8')
const auditLogTransport = fs.readFileSync(new URL('../src/api/auditLogTransport.ts', import.meta.url), 'utf8')
const fileTransport = fs.readFileSync(new URL('../src/api/fileTransport.ts', import.meta.url), 'utf8')
const aiTransport = fs.readFileSync(new URL('../src/api/aiTransport.ts', import.meta.url), 'utf8')
const multipartHeaders = fs.readFileSync(new URL('../src/api/multipartHeaders.ts', import.meta.url), 'utf8')
const saleWriteTransport = fs.readFileSync(new URL('../src/api/saleWriteTransport.ts', import.meta.url), 'utf8')
const salesTransport = fs.readFileSync(new URL('../src/api/salesTransport.ts', import.meta.url), 'utf8')
const productWriteTransport = fs.readFileSync(new URL('../src/api/productWriteTransport.ts', import.meta.url), 'utf8')
const productImageUploadTransport = fs.readFileSync(new URL('../src/api/productImageUploadTransport.ts', import.meta.url), 'utf8')
const offlineSnapshotTransport = fs.readFileSync(new URL('../src/api/offlineSnapshotTransport.ts', import.meta.url), 'utf8')
const settingsTransport = fs.readFileSync(new URL('../src/api/settingsTransport.ts', import.meta.url), 'utf8')
const apiMethods = fs.readFileSync(new URL('../src/api/methods.ts', import.meta.url), 'utf8')
const localMirrors = fs.readFileSync(new URL('../src/api/localMirrors.ts', import.meta.url), 'utf8')
const clientRuntime = fs.readFileSync(new URL('../src/platform/runtime/clientRuntime.ts', import.meta.url), 'utf8')
const viteConfig = fs.readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')
// Not ported to Cloudflare: the old Node backend's server.ts sent
// route-aware `Link: rel=preload` response headers to warm specific JS
// chunks before the SPA router requested them. No equivalent exists
// anywhere in cloudflare/src -- Workers serves static assets through R2
// (lib/r2.ts's serveObject), which has no per-route awareness at that
// layer. This is a real, currently-unclaimed performance gap (first paint
// on a deep link does one extra round trip to discover its chunk instead
// of getting a preload hint with the initial HTML response), not a
// stale-test issue -- the three assertions that used to check this
// against the deleted backend/server.ts are removed below rather than
// pointed at a file that no longer exists.
const sidebar = fs.readFileSync(new URL('../src/components/navigation/Sidebar.tsx', import.meta.url), 'utf8')
const appShellUtils = fs.readFileSync(new URL('../src/app/appShellUtils.ts', import.meta.url), 'utf8')
const dashboard = fs.readFileSync(new URL('../src/components/dashboard/Dashboard.tsx', import.meta.url), 'utf8')
const dashboardExport = fs.readFileSync(new URL('../src/components/dashboard/dashboardExport.ts', import.meta.url), 'utf8')
const dashboardChartNoData = fs.readFileSync(new URL('../src/components/dashboard/charts/NoData.tsx', import.meta.url), 'utf8')
const exportMenu = fs.readFileSync(new URL('../src/components/shared/ExportMenu.tsx', import.meta.url), 'utf8')
const filterMenu = fs.readFileSync(new URL('../src/components/shared/FilterMenu.tsx', import.meta.url), 'utf8')
const appSelect = fs.readFileSync(new URL('../src/components/shared/AppSelect.tsx', import.meta.url), 'utf8')
const lazyPortalMenu = fs.readFileSync(new URL('../src/components/shared/LazyPortalMenu.tsx', import.meta.url), 'utf8')
const portalMenu = fs.readFileSync(new URL('../src/components/shared/PortalMenu.tsx', import.meta.url), 'utf8')
const pageActivity = fs.readFileSync(new URL('../src/components/shared/pageActivity.ts', import.meta.url), 'utf8')
const quickPreferenceToggles = fs.readFileSync(new URL('../src/components/shared/QuickPreferenceToggles.tsx', import.meta.url), 'utf8')
const catalogPreviewSurface = fs.readFileSync(new URL('../src/components/catalog/CatalogPreviewSurface.tsx', import.meta.url), 'utf8')
const mainCss = fs.readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')
const publicPortalCss = fs.readFileSync(new URL('../src/styles/public-portal.css', import.meta.url), 'utf8')
const inventory = fs.readFileSync(new URL('../src/components/inventory/Inventory.tsx', import.meta.url), 'utf8')
const inventoryStockModals = fs.readFileSync(new URL('../src/components/inventory/InventoryStockModals.tsx', import.meta.url), 'utf8')
const inventoryReasonManagerModal = fs.readFileSync(new URL('../src/components/inventory/InventoryReasonManagerModal.tsx', import.meta.url), 'utf8')
const inventoryExport = fs.readFileSync(new URL('../src/components/inventory/inventoryExport.ts', import.meta.url), 'utf8')
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
const searchInputComponent = fs.readFileSync(new URL('../src/components/shared/SearchInput.tsx', import.meta.url), 'utf8')
const pos = fs.readFileSync(new URL('../src/components/pos/POS.tsx', import.meta.url), 'utf8')
const posFilterPanel = fs.readFileSync(new URL('../src/components/pos/FilterPanel.tsx', import.meta.url), 'utf8')
const posQuickAddModals = fs.readFileSync(new URL('../src/components/pos/POSQuickAddModals.tsx', import.meta.url), 'utf8')
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
const publicCatalogPage = fs.readFileSync(new URL('../src/components/catalog/PublicCatalogPage.tsx', import.meta.url), 'utf8')
const catalogEditorSurface = fs.readFileSync(new URL('../src/components/catalog/CatalogEditorSurface.tsx', import.meta.url), 'utf8')
const catalogImages = fs.readFileSync(new URL('../src/components/catalog/catalogImages.tsx', import.meta.url), 'utf8')
const catalogAssetUrls = fs.readFileSync(new URL('../src/components/catalog/catalogAssetUrls.ts', import.meta.url), 'utf8')
const catalogPagination = fs.readFileSync(new URL('../src/components/catalog/catalogPagination.tsx', import.meta.url), 'utf8')
const paginationControls = fs.readFileSync(new URL('../src/components/shared/PaginationControls.tsx', import.meta.url), 'utf8')
const products = fs.readFileSync(new URL('../src/components/products/Products.tsx', import.meta.url), 'utf8')
const productExport = fs.readFileSync(new URL('../src/components/products/helpers/productExport.ts', import.meta.url), 'utf8')
const productFilterHelpers = fs.readFileSync(new URL('../src/components/products/helpers/productFilterHelpers.ts', import.meta.url), 'utf8')
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
const userPermissionEditor = fs.readFileSync(new URL('../src/components/users/PermissionEditor.tsx', import.meta.url), 'utf8')
const userDetailSheet = fs.readFileSync(new URL('../src/components/users/UserDetailSheet.tsx', import.meta.url), 'utf8')
const userReadTransport = fs.readFileSync(new URL('../src/api/userReadTransport.ts', import.meta.url), 'utf8')
const userAdminTransport = fs.readFileSync(new URL('../src/api/userAdminTransport.ts', import.meta.url), 'utf8')
const backgroundImportTracker = fs.readFileSync(new URL('../src/components/shared/BackgroundImportTracker.tsx', import.meta.url), 'utf8')
const notificationCenter = fs.readFileSync(new URL('../src/components/shared/NotificationCenter.tsx', import.meta.url), 'utf8')
const actionHistory = fs.readFileSync(new URL('../src/utils/actionHistory.ts', import.meta.url), 'utf8')
const actionHistoryBar = fs.readFileSync(new URL('../src/components/shared/ActionHistoryBar.tsx', import.meta.url), 'utf8')
const actionHistoryTransport = fs.readFileSync(new URL('../src/api/actionHistoryTransport.ts', import.meta.url), 'utf8')
const loaders = fs.readFileSync(new URL('../src/utils/loaders.ts', import.meta.url), 'utf8')

function assertLoadWatchdogKeepsLoading(source: string, name: string): void {
  const watchdogBlocks = source.match(/loadWatchdogRef\.current\s*=\s*window\.setTimeout\(\(\) => \{[\s\S]*?\n\s*\},\s*[\d_]+/g) || []
  assert.ok(watchdogBlocks.length > 0, `${name} should keep an explicit slow-load watchdog`)
  for (const block of watchdogBlocks) {
    assert.doesNotMatch(block, /setLoading\(false\)/, `${name} slow-load watchdog should not clear loading before the request settles`)
  }
}

for (const [name, source] of [
  ['Products', products],
  ['Inventory', inventory],
  ['Sales', sales],
  ['Returns', returns],
  ['Branches', branches],
  ['Customers', customers],
  ['Suppliers', suppliers],
  ['Delivery contacts', delivery],
  ['Audit Log', auditLog],
  ['Users', usersPage],
] as const) {
  assertLoadWatchdogKeepsLoading(source, name)
}

assert.match(
  inventory,
  /<LoadingWatchdog\s+loading=\{loading && !isMovementsFirstLoad\}[\s\S]*timeoutMs=\{8000\}/,
  'Inventory should not show a delayed watchdog card on top of the first movement loading shell',
)
assert.doesNotMatch(
  inventory,
  /<LoadingWatchdog[\s\S]{0,240}showAfterMs=\{1200\}/,
  'Inventory should not add a fixed 1200ms watchdog reveal delay on top of real data loading',
)

assert.doesNotMatch(app, /WARMUP_PAGE_IDS|useChunkWarmup|getWarmupImporters|DELAYED_CHUNK_WARMUP_PAGE_IDS/, 'dashboard startup should not keep broad background route chunk warmup scaffolding')
assert.match(appContext, /import \{ APP_NAVIGATION_EVENT, getAdminPageFromPath, getAdminPathForPage, resolveAdminLandingPage \} from '\.\/app\/pathRouting\.ts'/, 'app context should derive the initial route page without importing the heavier admin shell utility chunk')
assert.doesNotMatch(appContext, /import en from '\.\/lang\/en\.json'/, 'app context should not statically load the full English language pack during startup')
assert.match(appContext, /const CORE_ENGLISH_PACK: TranslationPack = \{[\s\S]*sync_server_title: 'Sync Server'[\s\S]*\}/, 'app context should keep a tiny synchronous English fallback for first paint labels')
assert.match(appContext, /const \{ default: en \} = await import\('\.\/lang\/en\.json'\)/, 'app context should load the full English language pack dynamically after first paint')
assert.match(appContext, /CORE_LANGUAGE_CODES\.has\(nextLang\)[\s\S]*scheduleDeferredLanguagePack\(\)/, 'core language packs should be deferred instead of requested in the first script window')
assert.match(appContext, /const CORE_LANGUAGE_PACK_IDLE_TIMEOUT_MS = 20000/, 'full language pack load should stay off the main paint via a bounded idle timeout')
assert.doesNotMatch(appContext, /CORE_LANGUAGE_PACK_DEFER_MS/, 'the old fixed pre-idle defer was deliberately removed (see AppContext.tsx comment) -- it left non-core translation keys showing as raw key names in the UI for up to 29s after login')
assert.match(appContext, /window\.requestIdleCallback\(loadLanguagePack, \{ timeout: CORE_LANGUAGE_PACK_IDLE_TIMEOUT_MS \}\)/, 'full language pack should be requested via requestIdleCallback right after load, not stacked behind an extra fixed delay')
assert.match(appContext, /useEffect\(\(\) => \{\s*if \(publicMode\) return undefined[\s\S]*CORE_LANGUAGE_CODES\.has\(nextLang\)[\s\S]*\}, \[language, publicMode\]\)/, 'public portal startup should not schedule the full admin language pack after first paint')
assert.match(publicCatalogRoot, /import \{ PublicCatalogAppProvider \} from '\.\/app\/PublicCatalogAppProvider\.tsx'/, 'public catalog root should use the public-only provider instead of the full admin AppProvider')
assert.doesNotMatch(publicCatalogRoot, /import \{ AppProvider \}|AppContext\.tsx/, 'public catalog root should not import the admin AppContext provider')
assert.match(publicCatalogAppProvider, /AppContext\.Provider[\s\S]*SyncContext\.Provider/, 'public catalog provider should supply the shared hook contexts without admin startup side effects')
assert.doesNotMatch(publicCatalogAppProvider, /AppContext\.tsx|api\/http|websocket|auth|bootstrap/i, 'public catalog provider should stay free of admin auth, websocket, and bootstrap transports')
assert.match(catalogPage, /from '\.\.\/\.\.\/app\/AppContextCore\.tsx'/, 'public catalog page should import context hooks from the tiny core, not the full admin AppContext')
assert.match(pageActivity, /from '\.\.\/\.\.\/app\/AppContextCore\.tsx'/, 'page activity hook should read from the tiny context core')
assert.doesNotMatch(appContextCore, /api\/http|websocket|lang\/en\.json|lang\/km\.json|AppProvider|startHealthCheck/, 'context core should remain provider-only and avoid admin startup imports')
assert.match(quickPreferenceToggles, /from '\.\.\/\.\.\/app\/AppContextCore\.tsx'/, 'quick preference controls should read the tiny context core instead of importing the full admin AppContext graph')
assert.doesNotMatch(quickPreferenceToggles, /from '\.\.\/\.\.\/AppContext\.tsx'/, 'quick preference controls should not drag full AppContext into the route startup graph')
assert.match(appContext, /export \{ isBrokenLocalizedString, useApp, useSync, useT \}/, 'admin AppContext should re-export context hooks for existing route imports while the public route uses the core directly')
assert.match(appContext, /function getInitialAdminPage\(publicMode: boolean\): string \{[\s\S]*getAdminPageFromPath\(window\.location\.pathname\) \|\| 'dashboard'[\s\S]*\}/, 'direct admin URLs should initialize the active page without briefly mounting Dashboard first')
assert.match(appContext, /const \[page,\s+setPage\]\s+= useState\(\(\) => getInitialAdminPage\(publicMode\)\)/, 'initial active page state should come from the current URL')
assert.match(appContext, /const \[authReady, setAuthReady\] = useState\(\(\) => \{[\s\S]*if \(hasStoredSession && canProbeServerSession\) return false[\s\S]*if \(canProbeServerSession\) return false[\s\S]*\}\)/, 'cookie-only authenticated startup should wait for bootstrap instead of briefly mounting the login route')
assert.doesNotMatch(appContext, /if \(canProbeServerSession\) return true/, 'server-session probing should not mark auth ready before bootstrap has confirmed or rejected the cookie session')
assert.doesNotMatch(appContext, /APP_STORED_SESSION_BOOTSTRAP_DELAY_MS|setTimeout\(resolve,\s*APP_STORED_SESSION_BOOTSTRAP_DELAY_MS\)/, 'stored-session bootstrap should start immediately instead of adding a fixed startup delay before /api/auth/bootstrap')
assert.doesNotMatch(app, /usePageEntryWarmup|shouldWarmPageEntries|ADMIN_PAGE_SEQUENCE|NARROW_PAGE_ENTRY_WARMUP_IDS/, 'admin route chunks should warm only from explicit navigation intent, not broad page-entry background prefetch')
assert.match(app, /Page bundle is still loading/, 'page loader should explain stalled chunk loads')
assert.match(app, /console\.warn\('\[PageLoader\]/, 'page loader should expose diagnostic breadcrumbs')
assert.match(app, /Loading this workspace view\.\.\./, 'page loader should use the polished startup-shell wording during route handoff')
assert.match(app, /Preparing secure sign-in\.\.\./, 'auth bootstrap handoff should use polished startup-shell wording instead of raw loading text')
assert.match(app, /function hasUsableStoredAuthSession\(\): boolean \{[\s\S]*STORAGE_KEYS\.USER[\s\S]*STORAGE_KEYS\.USER_EXPIRY[\s\S]*Date\.now\(\) <= expiresAt[\s\S]*\}/, 'authenticated startup should inspect persisted auth before rendering the login route')
assert.match(app, /const storedAuthSessionPending = !user && hasUsableStoredAuthSession\(\)[\s\S]*if \(\(!authReady && !user\) \|\| storedAuthSessionPending\)/, 'stored authenticated sessions should keep the secure loading shell active instead of fetching the login chunk during bootstrap')
assert.doesNotMatch(app, /<div className="text-3xl mb-2 animate-pulse">\.\.\.<\/div>/, 'page loader should not fall back to the old bare ellipsis loading UI')
assert.match(app, /const CHUNK_IMPORT_TIMEOUT_MS = 15000/, 'chunk timeout should allow slow mobile networks before showing stalled UI')
assert.match(app, /const INTENT_CHUNK_IMPORT_TIMEOUT_MS = 7000/, 'navigation intent warmup should have a short chunk timeout')
assert.match(app, /const INTENT_CHUNK_WARMUP_DELAY_MS = 80/, 'navigation intent warmup should debounce accidental pointer passes')
// The custom-favicon canvas feature was REMOVED (§16 / 11.14-16): the
// browser-tab and PWA icon are now app-default branding, never swapped from
// business config, so there is no canvas processing to defer at all. These
// assertions now guard that it is not reintroduced (a swap would be both a
// first-paint cost AND the admin/portal image bleed 11.14 fixed).
assert.doesNotMatch(app, /APP_FAVICON_PROCESSING_DELAY_MS|APP_FAVICON_IDLE_TIMEOUT_MS|processFavicon/, 'the removed custom-favicon deferral scaffolding must not return; the favicon is app default')
assert.doesNotMatch(app, /createCircularFaviconDataUrl/, 'app shell must not process a circular favicon at all -- the tab/PWA icon is default app branding')
assert.doesNotMatch(app, /iconEl\.setAttribute\('href', iconSource\)/, 'app shell must not swap the favicon href from business config')
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
assert.match(httpApi, /const HEALTHY_SERVER_LOCAL_FALLBACK_MS = 350/, 'healthy live server reads should quickly show confirmed local data while the server refresh continues')
assert.match(httpApi, /fallbackTimer = window\.setTimeout\(async \(\) => \{[\s\S]*const localResult = await startLocalRead\(\)[\s\S]*\}, fallbackDelayMs\)/, 'local fallback should not import Dexie until the selected fallback timer actually fires')
assert.match(httpApi, /raceServerReadWithLocalFallback\(channel, promise, localFn, t0, '', HEALTHY_SERVER_LOCAL_FALLBACK_MS\)/, 'fresh healthy server reads should use the tuned local fallback delay')
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
assert.match(serviceWorker, /function isHashedBuildAsset\(pathname\)[\s\S]*pathname\.startsWith\('\/assets\/'\)/, 'hashed build chunks should be recognized as safe cache-first static assets')
assert.match(serviceWorker, /async function cacheFirstStatic\(request, event\)[\s\S]*const cached = await cache\.match\(request\)[\s\S]*if \(cached\)[\s\S]*return cached/, 'hashed build chunks should use cache-first service-worker reads so repeat visits do not pay tunnel latency')
assert.match(serviceWorker, /event\.respondWith\(isHashedBuildAsset\(url\.pathname\)[\s\S]*\? cacheFirstStatic\(request, event\)[\s\S]*: networkFirstStatic\(request\)\)/, 'only hashed build chunks should switch to cache-first while mutable runtime assets stay network-first')
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
assert.doesNotMatch(app, /scheduleWarmupAfterLoad|useDataWarmup|getDataWarmupLoaders|runWarmupBatches|createWarmupLoader|shouldSkipBackgroundWarmup/, 'empty shell-level data and chunk warmup plans should be deleted instead of allocating no-op hooks')
assert.match(app, /window\.addEventListener\(APP_PAGE_INTENT_EVENT, warmIntentPage\)/, 'route chunk preloading should stay tied to explicit navigation intent')
assert.match(appShellUtils, /APP_PAGE_INTENT_EVENT,[\s\S]*from '\.\/pathRouting\.ts'/, 'navigation intent event should be re-exported from shell utils while living in the lightweight path routing module')
assert.match(sidebar, /APP_PAGE_INTENT_EVENT/, 'sidebar should publish navigation intent before route clicks')
assert.doesNotMatch(sidebar, /import NotificationCenter from '\.\.\/shared\/NotificationCenter'/, 'mobile sidebar should not statically import the notification center chunk')
assert.match(sidebar, /notificationSlot\?: ReactNode/, 'mobile sidebar should receive notification UI from the app-level lazy gate')
assert.match(sidebar, /showQuickPreferences\?: boolean/, 'mobile sidebar should receive quick preference UI from the app-level lazy gate')
assert.match(app, /const mobileNotificationSlot = shouldMountNotificationCenter \? \(/, 'mobile notification center should share the deferred app-level mount gate')
assert.match(app, /const shouldMountQuickPreferences = useDeferredQuickPreferencesMount\(authReady \? user : null\)/, 'quick preference controls should wait for the app-level deferred mount gate')
assert.match(app, /QUICK_PREFERENCES_INITIAL_MOUNT_DELAY_MS = 7000/, 'quick preference controls should not compete with first route startup scripts')
assert.match(app, /<Sidebar[\s\S]*?notificationSlot=\{mobileNotificationSlot\}[\s\S]*?showQuickPreferences=\{shouldMountQuickPreferences\}[\s\S]*?mobileHeaderVisible=\{mobileHeaderVisible\}[\s\S]*?\/>/, 'app shell should pass deferred mobile chrome slots into Sidebar')
assert.doesNotMatch(sidebar, /import QuickPreferenceToggles from '\.\.\/shared\/QuickPreferenceToggles'/, 'mobile sidebar should not statically import quick preferences during startup')
assert.match(sidebar, /const QuickPreferenceToggles = lazyRetry\(\(\) => import\('\.\.\/shared\/QuickPreferenceToggles'\), 'quick-preference-toggles'\)/, 'mobile quick preferences should load only after the app-level deferred gate opens, and retry a failed/slow chunk fetch instead of silently rendering nothing')
assert.doesNotMatch(sidebar, /\{showQuickPreferences \? <QuickPreferenceToggles \/> : null\}/, 'quick preference toggles must be wrapped in Suspense, not rendered bare, since the component is lazy-loaded')
assert.doesNotMatch(sidebar, /import UserProfileModalComponent from '\.\.\/users\/UserProfileModal'/, 'sidebar should not statically import the profile modal and file picker stack during startup')
assert.match(sidebar, /const UserProfileModal = lazyRetry\(async \(\) => \(\{\s*default: \(await import\('\.\.\/users\/UserProfileModal'\)\)\.default as ComponentType<UserProfileModalProps>,\s*\}\), 'sidebar-user-profile-modal'\)/m, 'profile modal should load only when the user opens it, and retry a failed/slow chunk fetch like the other deferred sidebar chunks')
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
assert.match(indexHtml, /<style data-business-os-initial-shell>[\s\S]*\.business-os-initial-shell[\s\S]*position: fixed[\s\S]*\.business-os-initial-copy[\s\S]*font-size: 11px/, 'index html should paint a compact immediate startup shell before JavaScript loads')
assert.match(indexHtml, /function setInitialBusinessOsRoute\(\)[\s\S]*document\.documentElement\.setAttribute\('data-business-os-initial-route'[^]*publicRoute \? 'public' : 'admin'\)/, 'static startup shell should select the public portal labels before React loads')
assert.match(indexHtml, /function setInitialBusinessOsRoute\(\)[\s\S]*data-business-os-initial-route[\s\S]*public[\s\S]*admin/, 'index html should choose the startup shell route before the body paints')
assert.match(indexHtml, /\[data-business-os-initial-route="admin"\] \[data-business-os-public\][\s\S]*\[data-business-os-initial-route="public"\] \[data-business-os-admin\]/, 'startup shell CSS should hide the opposite route labels before first paint')
assert.match(indexHtml, /<span data-business-os-admin>Business OS<\/span>[\s\S]*<span data-business-os-public>Leang Beauty<\/span>[\s\S]*<span data-business-os-admin>Opening workspace<\/span>[\s\S]*<span data-business-os-public>Opening catalog<\/span>/, 'startup shell should carry both admin and public labels in the static markup')
assert.match(index, /function InitialShellFallback\(\{ publicMode \}: \{ publicMode: boolean \}\)[\s\S]*publicMode \? 'Leang Beauty' : 'Business OS'/, 'lazy root loading should keep the startup shell visible while route chunks load')
assert.match(index, /<Suspense fallback=\{<InitialShellFallback publicMode=\{publicCatalogMode\} \/>\}>/, 'root suspense fallback should not clear the static startup shell to a blank page')
assert.match(index, /ReactDOM\.createRoot\(rootElement\)\.render\([\s\S]*\)\s*\n\s*registerOfflineAppShell\(\)\s*\n\s*scheduleFormFieldAccessibility\(\)/, 'React should render before startup maintenance jobs are scheduled')
assert.doesNotMatch(index, /registerOfflineAppShell\(\)\s*\n\s*scheduleFormFieldAccessibility\(\)\s*\n\s*const publicCatalogMode/, 'startup maintenance jobs should not be scheduled before root render setup')
assert.match(viteConfig, /routePreloadChunkNames[\s\S]*function injectRouteAwareModulePreloads\(\): Plugin \{[\s\S]*data-business-os-route-preloads/, 'built HTML should inject route-aware preload links for admin and public route chunks')
assert.match(viteConfig, /function toRoutePreloadFiles\(bundle: OutputBundle, names: readonly string\[\]\): string\[\][\s\S]*const wanted = new Set\(names\)[\s\S]*if \(wanted\.has\(chunk\.name\)\) files\.add\(chunk\.fileName\)/, 'route-aware preload manifest should stay explicit so action-only modal chunks do not inflate first paint')
assert.doesNotMatch(viteConfig, /function toRoutePreloadFiles\(bundle: OutputBundle, names: readonly string\[\]\): string\[\][\s\S]*chunk\.imports[\s\S]*return Array\.from\(files\)\.sort\(\)/, 'route-aware preload manifest should not recursively pull every static dependency into direct-route startup')
assert.match(viteConfig, /link\.fetchPriority = 'high'[\s\S]*link\.setAttribute\('fetchpriority', 'high'\)/, 'route-aware modulepreload links should use high fetch priority so direct route chunks do not wait behind secondary work')
assert.match(viteConfig, /public:\s*\[[\s\S]*'PublicCatalogRoot'[\s\S]*'catalog-public'[\s\S]*'catalog-icons'[\s\S]*'catalog-products'[\s\S]*'app-portal'/, 'public routes should start fetching portal root, public catalog shell, catalog icons, product grid, and portal transport chunks before React finishes loading')
assert.match(viteConfig, /public:\s*\[[\s\S]*'route-sync-utils'[\s\S]*'app-portal'/, 'public routes should preload one small synchronous helper chunk instead of waiting on multiple late catalog waterfalls')
assert.match(viteConfig, /admin:\s*\[[\s\S]*'AdminRoot'[\s\S]*'vendor-react'[\s\S]*'vendor'[\s\S]*'app-routing'[\s\S]*'app-shell'[\s\S]*'Sidebar'[\s\S]*'shared-ui'[\s\S]*'app-auth'[\s\S]*'app-bootstrap'[\s\S]*\][\s\S]*login:\s*\[[\s\S]*'AdminRoot'[\s\S]*'auth-login'[\s\S]*'app-auth'[\s\S]*'app-bootstrap'/, 'authenticated admin routes should preload required shell chunks while direct login routes still preload the sign-in chunk')
assert.match(viteConfig, /isLoginPath\(pathname\)[\s\S]*preloads\.login[\s\S]*preloads\.admin/, 'route-aware preload script should reserve auth-login preloads for direct login paths')
assert.match(viteConfig, /function hasEmbeddedAuthBootstrap\(\)[\s\S]*business-os-auth-bootstrap[\s\S]*!hasEmbeddedAuthBootstrap\(\)[\s\S]*window\.fetch\('\/api\/auth\/bootstrap'[\s\S]*credentials: 'include'/, 'admin direct-route HTML should skip the early auth fetch when the server already embedded the bootstrap payload')
assert.match(appBootstrapTransport, /EMBEDDED_AUTH_BOOTSTRAP_SCRIPT_ID = 'business-os-auth-bootstrap'[\s\S]*function takeEmbeddedAuthBootstrapPayload\(\): unknown \| null[\s\S]*JSON\.parse\(raw\)/, 'app bootstrap transport should consume the server-embedded admin auth bootstrap payload before making a network request')
assert.match(appBootstrapTransport, /const embeddedBootstrapPayload = takeEmbeddedAuthBootstrapPayload\(\)[\s\S]*if \(embeddedBootstrapPayload\) return embeddedBootstrapPayload[\s\S]*const earlyBootstrapPromise = takeEarlyAuthBootstrapPromise\(\)/, 'embedded auth bootstrap should win over the early fetch promise to remove direct-route double loading')
assert.match(appBootstrapTransport, /function takeEarlyAuthBootstrapPromise\(\): Promise<unknown> \| null[\s\S]*__businessOsAuthBootstrapPromise[\s\S]*return promise/, 'app bootstrap transport should reuse the early admin auth bootstrap request when present')
assert.match(catalogPreviewSurface, /import '..\/..\/styles\/public-portal\.css'/, 'public portal preview styles should load with catalog routes instead of the global admin startup stylesheet')
assert.match(publicPortalCss, /business-os-portal-translate-widget[\s\S]*portal-contact-value[\s\S]*portal-nav-tab-active/, 'public portal stylesheet should own portal contact, navigation, and translate-widget rules')
assert.doesNotMatch(mainCss, /portal-contact-value|portal-nav-tab-active|business-os-portal-translate-widget/, 'global startup CSS should not include public portal route-only rules')
assert.match(viteConfig, /modulePreload:\s*false/, 'Vite generic modulepreload injection should stay disabled so public startup does not import the helper from the app-auth chunk')
assert.match(viteConfig, /includes\('vite\/preload-helper'\)[\s\S]*return 'vendor'/, 'Vite preload helper should stay in the neutral vendor chunk instead of the admin auth chunk')
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
// Regression guard for "Products Only Reset also emptied Inventory
// Movements and other pages": resetClientRuntimeState must only run the
// full-mirror resetLocalMirrorDb() wipe when the caller didn't ask for a
// scoped clear -- when options.mirrorTables is an array, it must clear
// only those tables via clearLocalMirrorTables instead.
assert.match(clientRuntime, /if \(Array\.isArray\(options\.mirrorTables\)\) \{[\s\S]*const \{ clearLocalMirrorTables \} = await import\('\.\.\/\.\.\/api\/localDb\.ts'\)[\s\S]*await clearLocalMirrorTables\(options\.mirrorTables\)[\s\S]*\} else \{[\s\S]*await resetLocalMirrorDb\(\)/, 'resetClientRuntimeState should clear only the caller-scoped mirror tables when mirrorTables is provided, instead of always wiping the whole local mirror')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/localDb\.ts'\)\) return 'app-local-db'/, 'Vite should keep localDb out of the startup app-api chunk')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/utils\/csv\.ts'\)[\s\S]*normalized\.endsWith\('\/src\/utils\/csvTemplate\.ts'\)[\s\S]*normalized\.endsWith\('\/src\/utils\/csvImport\.ts'\)[\s\S]*return 'csv-utils'/, 'CSV import/export helpers should not be owned by the app-local-db chunk')
assert.doesNotMatch(apiMethods, /import \{ buildCSVTemplate \} from '\.\.\/utils\/csvTemplate\.ts'/, 'legacy API registry should not load CSV template/export helpers during page startup')
assert.match(apiMethods, /function loadCsvTemplateModule\(\)[\s\S]*import\('\.\.\/utils\/csvTemplate\.ts'\)[\s\S]*async function buildImportCsvTemplate/, 'legacy API registry should lazy-load CSV template helpers only from template download intent')
assert.doesNotMatch(apiMethods, /export \{ getImageDataUrl, openCSVDialog, openImageDialog \} from '\.\/browserDialogs\.ts'/, 'legacy API registry should not load CSV parsing browser dialogs during page startup')
assert.match(apiMethods, /function loadBrowserDialogsModule\(\)[\s\S]*import\('\.\/browserDialogs\.ts'\)[\s\S]*export async function openCSVDialog\(\)/, 'legacy API registry should lazy-load browser file dialogs only when an import dialog asks for them')
assert.doesNotMatch(contactsTransport, /import \{ buildCSVTemplate \} from '\.\.\/utils\/csvTemplate\.ts'/, 'contacts transport should not load CSV template helpers for normal contact reads')
assert.match(contactsTransport, /function getCsvTemplateModule\(\): Promise<CsvTemplateModule>[\s\S]*import\('\.\.\/utils\/csvTemplate\.ts'\)[\s\S]*async function buildContactCsvTemplate/, 'contact templates should lazy-load CSV helpers only from template download intent')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/appBootstrapTransport\.ts'\)\) return 'app-bootstrap'/, 'Vite should keep unauthenticated bootstrap out of the full app-api-methods registry chunk')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/authTransport\.ts'\)[\s\S]*normalized\.endsWith\('\/src\/AppContext\.tsx'\)[\s\S]*return 'app-auth'/, 'Vite should keep sign-in auth helpers out of the full app-api-methods registry chunk')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/systemRuntime\.ts'\)\) return 'app-system'/, 'Vite should keep Server page diagnostics transport out of app-api-methods and local DB chunks')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/portalPublicTransport\.ts'\)\) return 'app-portal'/, 'Vite should keep public-only portal transport out of app-api-methods and local DB chunks')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/portalTransport\.ts'\)[\s\S]*normalized\.endsWith\('\/src\/api\/portalHttp\.ts'\)[\s\S]*return 'portal-admin-api'/, 'Vite should keep admin portal review transport and shared portal HTTP helpers out of the public startup app-portal chunk')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/dashboardTransport\.ts'\)\) return 'dashboard-api'/, 'Vite should keep Dashboard summary transport in a focused read chunk instead of app-api-methods')
assert.doesNotMatch(apiMethods, /dashboardTransport\.ts|loadDashboardTransport|export const getDashboard|export const getAnalytics/, 'legacy API registry should not retain dashboard wrappers after Dashboard and Inventory own the focused transport')
assert.match(
  viteConfig,
  /normalized\.endsWith\('\/src\/api\/http\.ts'\)[\s\S]*normalized\.endsWith\('\/src\/api\/query\.ts'\)[\s\S]*normalized\.endsWith\('\/src\/api\/actorQuery\.ts'\)[\s\S]*return 'api-http-core'/,
  'focused read transports should share a tiny HTTP/query core instead of inheriting app-api-methods',
)
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/httpState\.ts'\)\) return 'api-http-state'/, 'sync-server URL/token state should stay in a tiny shared chunk instead of inheriting app-api-methods or api-http-core')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/websocket\.ts'\)[\s\S]*return 'app-api'[\s\S]*if \(normalized\.includes\('\/src\/api\/'\)\) return 'app-api-methods'/, 'Vite should keep only runtime connection files in app-api and move method transports behind the lazy methods chunk')
assert.match(viteConfig, /'assets\/app-bootstrap-',[\s\S]*'assets\/app-auth-',/, 'bootstrap and auth chunks should not be eagerly modulepreloaded into the initial shell')
assert.match(viteConfig, /'assets\/app-auth-',[\s\S]*'assets\/app-portal-',/, 'public portal transport should also be excluded from initial modulepreload')
assert.match(viteConfig, /'assets\/app-api-methods-',[\s\S]*'assets\/api-http-state-',[\s\S]*'assets\/app-portal-',/, 'tiny sync-server HTTP state should not be eagerly modulepreloaded into the initial shell')
assert.match(viteConfig, /'assets\/app-portal-',[\s\S]*'assets\/app-system-',/, 'server diagnostics transport should not be eagerly modulepreloaded into the initial shell')
assert.match(publicWebApi, /import\('\.\/api\/portalPublicTransport\.ts'\)/, 'public catalog API bootstrap should lazy-load the public-only portal transport')
assert.doesNotMatch(publicWebApi, /portalTransport\.ts/, 'public catalog API bootstrap should not import the admin portal transport that carries shared HTTP core')
assert.doesNotMatch(portalPublicTransport, /apiFetch|route\(/, 'public-only portal transport should not pull the shared admin HTTP core into public startup')
assert.doesNotMatch(portalPublicTransport, /from '\.\/(?:query|portalHttp)\.ts'/, 'public-only portal transport should stay self-contained and avoid shared API helper chunks')
assert.match(viteConfig, /'assets\/auth-login-',/, 'signed-out Login UI should not be eagerly modulepreloaded into the authenticated shell')
assert.match(viteConfig, /Login\.tsx'\)\) return 'auth-login'/, 'Vite should keep Login UI in an auth-only chunk')
assert.match(viteConfig, /'assets\/app-local-db-',[\s\S]*'assets\/vendor-dexie-',/, 'local DB and Dexie chunks should be excluded from eager modulepreload')
assert.match(viteConfig, /'assets\/media-upload-utils-',[\s\S]*'assets\/notification-center-',/, 'media upload helpers should be excluded from eager modulepreload')
assert.doesNotMatch(viteConfig, /'assets\/public-asset-urls-'/, 'public asset URL helpers should fold into their caller so public catalog images do not wait on a late tiny helper chunk')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/utils\/mediaUploadState\.ts'\)\) \{[\s\S]*return 'media-upload-state'/, 'tiny media upload state helpers should not be owned by the heavier URL helper chunk')
assert.doesNotMatch(viteConfig, /normalized\.endsWith\('\/src\/utils\/publicAssetUrls\.ts'\)\) \{[\s\S]*return 'public-asset-urls'/, 'public asset URL helper should not be forced into a separate chunk for public catalog startup')
// (The favicon-utils chunk rule was removed with the custom-favicon feature
// -- src/utils/favicon.ts is deleted; the tab/PWA icon is app default now.)
assert.doesNotMatch(viteConfig, /favicon-utils/, 'the deleted favicon helper must not leave a dangling chunk rule')
assert.doesNotMatch(viteConfig, /PortalMenu\.tsx'\)\) return 'portal-tools'/, 'shared PortalMenu should not be grouped with catalog portal tools')
assert.match(viteConfig, /'assets\/shared-portal-menu-',/, 'PortalMenu should not be eagerly modulepreloaded into the initial shell')
assert.doesNotMatch(viteConfig, /'assets\/shared-lazy-portal-menu-'|LazyPortalMenu\.tsx'\)\) return 'shared-lazy-portal-menu'/, 'tiny LazyPortalMenu wrapper should not cost a standalone startup request')
assert.match(viteConfig, /LazyPortalMenu\.tsx'\)\) return 'shared-ui'/, 'tiny LazyPortalMenu wrapper should ride the existing shared UI chunk instead of creating an app-shared cycle')
assert.match(viteConfig, /'assets\/product-detail-',/, 'Product detail modals should not be eagerly modulepreloaded before row detail intent')
assert.match(viteConfig, /AppSelect\.tsx'\)\) return 'shared-ui'[\s\S]*LazyPortalMenu\.tsx'\)\) return 'shared-ui'[\s\S]*pageActivity\.ts'\)\) return 'route-sync-utils'[\s\S]*PortalMenu\.tsx'\)\) return 'shared-portal-menu'[\s\S]*if \(normalized\.includes\('\/src\/components\/files\/FilePickerModal'\)/, 'public catalog shared controls should have focused chunk ownership before generic shared handling')
assert.doesNotMatch(viteConfig, /lucide-react[\\\/]\)\.test\(id\)\) return 'vendor-lucide'/, 'Lucide icons should not be forced into one app-wide startup vendor chunk')
assert.match(viteConfig, /const appShellIconNames = new Set\([\s\S]*'layout-dashboard'[\s\S]*'shopping-cart'[\s\S]*'users'/, 'startup shell Lucide icons should be listed explicitly instead of falling into route chunks')
assert.match(viteConfig, /const authLoginIconNames = new Set\([\s\S]*'chrome'[\s\S]*'key-round'[\s\S]*'lock-keyhole'/, 'auth-only Login icons should be listed explicitly for the signed-out auth chunk')
assert.match(viteConfig, /const publicCatalogIconNames = new Set\(\[[\s\S]*'arrow-down'[\s\S]*'badge-check'[\s\S]*'badge-percent'[\s\S]*'chevron-down'[\s\S]*'globe'[\s\S]*'search'[\s\S]*'shopping-bag'[\s\S]*'ticket'[\s\S]*'trophy'[\s\S]*\]\)/, 'public catalog first-viewport icons should be split from the broader shared icon bundle')
assert.doesNotMatch(viteConfig.match(/const publicCatalogIconNames = new Set\(\[[\s\S]*?\]\)/)?.[0] || '', /'facebook'|'instagram'|'mail'|'map-pin'|'phone'|'send'/, 'secondary contact and social icons should not ride the public catalog first-viewport icon chunk')
assert.match(viteConfig, /const routeSharedIconNames = new Set\(\[[\s\S]*'check-circle-2'[\s\S]*'info'[\s\S]*'mail'[\s\S]*'phone'[\s\S]*'settings-2'[\s\S]*'shield-alert'[\s\S]*'trash-2'[\s\S]*'upload'[\s\S]*\]\)/, 'cross-route notification, reset, and catalog-adjacent icons should stay in a shared icon chunk')
assert.doesNotMatch(viteConfig, /const authLoginIconNames = new Set\(\[[^\]]*'(chevron-down|chevron-up|mail)'/, 'shared catalog icons should not be pinned to the auth-login chunk')
assert.match(viteConfig, /if \(routeSharedIconNames\.has\(iconName\) \|\| appShellIconNames\.has\(iconName\)\) return 'shared-ui'[\s\S]*if \(authLoginIconNames\.has\(iconName\)\) return 'auth-login'[\s\S]*if \(publicCatalogIconNames\.has\(iconName\)\) return 'catalog-icons'/, 'direct Lucide icon modules should keep auth, public catalog, shared route, and shell icons out of feature chunks')
assert.match(viteConfig, /'assets\/dashboard-charts-',[\s\S]*'assets\/dashboard-export-',/, 'Dashboard chart/report chunks should be excluded from eager modulepreload on non-dashboard routes')
assert.match(viteConfig, /'assets\/catalog-',[\s\S]*'assets\/portal-language-packs-',[\s\S]*'assets\/portal-content-i18n-'/, 'catalog and public portal intent chunks should be excluded from eager modulepreload')
assert.match(viteConfig, /'assets\/action-history-api-',[\s\S]*'assets\/system-jobs-api-'/, 'secondary admin API chunks should not be modulepreloaded during the public product first viewport')
assert.match(viteConfig, /'assets\/backup-reset-tools-',/, 'Backup reset tools should not be eagerly modulepreloaded into the normal Backup route')
assert.match(viteConfig, /'assets\/settings-otp-modal-',/, 'Settings OTP modal should not be eagerly modulepreloaded into the normal Settings route')
assert.doesNotMatch(viteConfig, /'assets\/access-control-api-'|accessControlTransport/, 'Retired access-control transport should not produce or preload a stale chunk')
assert.match(viteConfig, /'assets\/csv-utils-',/, 'CSV import and export helpers should stay out of eager modulepreload on read-only route startup')
assert.match(viteConfig, /'assets\/user-profile-modal-',/, 'Users profile modal should not be eagerly modulepreloaded into the normal Users route')
assert.match(viteConfig, /'assets\/user-detail-sheet-',/, 'Users detail sheet should not be eagerly modulepreloaded into the normal Users route')
assert.match(viteConfig, /'assets\/user-permission-editor-',/, 'Users role permission editor should not be eagerly modulepreloaded into the normal Users route')
assert.match(viteConfig, /'assets\/branch-transfer-modal-',/, 'Branch transfer modal should not be eagerly modulepreloaded into the normal Branches route')
assert.match(viteConfig, /'assets\/browser-dialogs-',/, 'CSV and image file dialogs should not be eagerly modulepreloaded into normal route startup')
assert.match(viteConfig, /components\/products\/shared\/'[\s\S]*productGalleryHelpers\.ts'[\s\S]*productBatches\.ts[\s\S]*productGrouping\.ts[\s\S]*color\.ts[\s\S]*return 'product-shared'/, 'product image, grouping, color, and visible batch primitives should not be owned by heavy route or detail chunks')
assert.doesNotMatch(viteConfig, /return 'product-detail'[\s\S]{0,240}productBatches\.ts/, 'visible row batch preview helpers should not force product detail modals into route startup')
assert.doesNotMatch(viteConfig, /return 'product-detail'[\s\S]{0,240}color\.ts/, 'visible color contrast helpers should not force product detail modals into route startup')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/utils\/actionGuards\.ts'\)\) return 'route-sync-utils'/, 'shared synchronous action guards should not be owned by the heavy catalog route chunk')
assert.match(viteConfig, /normalized\.includes\('\/src\/utils\/initials\.ts'\)\) return 'route-sync-utils'[\s\S]*normalized\.endsWith\('\/src\/utils\/scriptTypography\.ts'\)\) return 'route-sync-utils'/, 'initial and Khmer typography helpers should share the small synchronous route helper chunk')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/contactReadTransport\.ts'\)\) return 'contact-read-api'/, 'POS delayed contact option reads should have their own lazy contact-read API chunk')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/contactWriteTransport\.ts'\)\) return 'contact-write-api'/, 'POS quick contact create writes should have their own lazy contact-write API chunk')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/contactsTransport\.ts'\)\) return 'contacts-api'[\s\S]*normalized\.endsWith\('\/src\/api\/salesTransport\.ts'\)\) return 'sales-read-api'/, 'idle offline snapshot contact and sales reads should not be owned by app-api-methods')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/saleWriteTransport\.ts'\)\) return 'sale-write-api'/, 'POS checkout sale writes should have their own lazy sale-write API chunk')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/productWriteTransport\.ts'\)\) return 'product-write-api'/, 'Products page create\/update\/delete writes should have their own lazy product-write API chunk')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/productImageUploadTransport\.ts'\)\) return 'product-image-upload-api'/, 'Products page image upload intent should use a narrow product-image upload chunk instead of the full file transport')
assert.match(viteConfig, /'assets\/product-image-upload-api-',/, 'Product image upload intent chunk should be excluded from eager modulepreload')
assert.doesNotMatch(viteConfig, /'assets\/quick-preference-toggles-',/, 'Tiny context-backed preference toggles should not cost a separate startup request')
assert.doesNotMatch(viteConfig, /shared-export-menu|ExportMenu\.tsx'\)\) return/, 'Tiny export menu trigger should not cost a separate startup request on read-only route load')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/branchTransport\.ts'\)\) return 'branch-api'[\s\S]*normalized\.endsWith\('\/src\/api\/inventoryTransport\.ts'\)\) return 'inventory-api'/, 'Products page branch and stock intents should not collapse into app-api-methods')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/userAdminTransport\.ts'\)\) return 'user-admin-api'[\s\S]*normalized\.endsWith\('\/src\/api\/userReadTransport\.ts'\)\) return 'user-read-api'/, 'Users admin reads and mutations should use a focused route chunk instead of app-api-methods')
assert.doesNotMatch(viteConfig, /normalized\.endsWith\('\/src\/api\/accessControlTransport\.ts'\)\) return 'access-control-api'/, 'retired access-control wrapper should not keep a manual chunk rule')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/userReadTransport\.ts'\)\) return 'user-read-api'[\s\S]*normalized\.endsWith\('\/src\/api\/dashboardTransport\.ts'\)\) return 'dashboard-api'[\s\S]*normalized\.endsWith\('\/src\/api\/returnsReadTransport\.ts'\)\) return 'returns-read-api'[\s\S]*normalized\.endsWith\('\/src\/api\/returnsTransport\.ts'\)\) return 'returns-write-api'[\s\S]*normalized\.endsWith\('\/src\/api\/rfidTransport\.ts'\)\) return 'rfid-api'/, 'Inventory user, dashboard, returns reads, returns writes, and RFID should use focused chunks instead of app-api-methods')
assert.match(viteConfig, /'assets\/product-read-api-',[\s\S]*'assets\/returns-write-api-',/, 'dynamic product reads and return writes should stay out of eager modulepreload on read-only route startup')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/actionHistoryTransport\.ts'\)\) return 'action-history-api'/, 'action history reads/writes and admin user filter reads should stay in a lazy API chunk instead of adding a route startup request')
assert.doesNotMatch(actionHistory, /AppContext|useAppHook|useApp\(/, 'shared action history should receive the current user from pages instead of importing the full app context graph')
assert.doesNotMatch(actionHistoryBar, /AppContext|useAppHook|useAppFromContext|useApp\(/, 'shared action history chrome should not import the full app context graph just for translations')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/offlineSnapshotTransport\.ts'\)\) return 'offline-snapshot-api'/, 'idle offline snapshot refresh should not collapse into app-api-methods')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/requestIds\.ts'\)\) return 'request-ids'/, 'small request-id helpers used by focused write transports should not drag app-api-methods into product writes')
  assert.match(viteConfig, /normalized\.endsWith\('\/src\/utils\/searchTerms\.ts'\)\) return 'route-sync-utils'/, 'tiny search-term normalization should share the small synchronous route helper chunk instead of costing its own startup request')
  assert.match(viteConfig, /normalized\.endsWith\('\/src\/utils\/recordFilters\.ts'\)\) return 'route-sync-utils'/, 'tiny record date and selection helpers should share the small synchronous route helper chunk instead of costing their own startup request')
  assert.match(viteConfig, /normalized\.endsWith\('\/src\/utils\/loaders\.ts'\)\) return 'route-sync-utils'/, 'shared page loader guards should not be owned by the public catalog chunk and pulled into admin routes')
  assert.match(viteConfig, /normalized\.endsWith\('\/src\/utils\/pricing\.ts'\)\) \{[\s\S]*return 'pricing-utils'/, 'shared product pricing math should use a tiny focused chunk instead of the public catalog or broad product shared chunk')
  assert.match(viteConfig, /components\/products\/shared\/'[\s\S]*productGalleryHelpers\.ts'[\s\S]*productBatches\.ts[\s\S]*productGrouping\.ts[\s\S]*color\.ts[\s\S]*return 'product-shared'/, 'shared product helpers should not be owned by the public catalog chunk and pulled into admin routes')
  assert.doesNotMatch(products, /from '\.\.\/\.\.\/utils\/groupedRecords\.ts'/, 'Products startup should not load grouped history section builders just for date filters or selection toggles')
  assert.doesNotMatch(productFilterHelpers, /utils\/groupedRecords\.ts/, 'Products live filtering should use the light record filter helpers instead of the grouped section builder chunk')
  assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/browserDialogs\.ts'\)\) return 'browser-dialogs'/, 'browser file-picker dialogs should stay in an intent-only chunk instead of app-api-methods')
assert.match(viteConfig, /localMirrors\.ts'[\s\S]*lazyLocalDb\.ts'[\s\S]*queryCache\.ts'[\s\S]*expectedUpdatedAt\.ts'[\s\S]*return 'api-local-cache'/, 'product cache helpers should stay in the focused local cache chunk instead of landing in app-api-methods')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/lookupTransport\.ts'\)\) \{[\s\S]*return 'lookup-api'/, 'POS lookup reads should have a narrow lookup API chunk instead of landing in app-api-methods')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/productReadTransport\.ts'\)[\s\S]*return 'product-read-api'/, 'POS product reads should have a narrow product-read API chunk instead of landing in app-api-methods')
assert.doesNotMatch(viteConfig, /CatalogPreviewSurface\.tsx'\)\) \{[\s\S]*return 'catalog-preview'/, 'public catalog preview shell should stay in the route chunk to avoid a first-viewport lazy waterfall')
assert.match(viteConfig, /CatalogProductsSection\.tsx'\)[\s\S]*return 'catalog-products'/, 'public catalog products should have a named preloaded chunk so the lighter shell can parse before the product grid')
assert.match(viteConfig, /PublicCatalogPage\.tsx'[\s\S]*CatalogPreviewSurface\.tsx'[\s\S]*return 'catalog-public'/, 'customer portal should own a dedicated public catalog shell chunk instead of importing the admin catalog controller')
assert.doesNotMatch(viteConfig, /'assets\/catalog-preview-'/, 'catalog preview should not be excluded from preload as a late chunk')
assert.doesNotMatch(viteConfig, /'assets\/catalog-products-'/, 'catalog products should be route-aware preloaded, not excluded as a late lazy chunk')
assert.match(viteConfig, /CatalogSecondaryTabs\.tsx'\)\) \{[\s\S]*return 'catalog-secondary-tabs'/, 'public catalog secondary tabs should remain lazy because they are not needed for the default product first viewport')
assert.match(viteConfig, /'assets\/catalog-secondary-tabs-'/, 'public catalog secondary tabs should stay out of eager modulepreload on the first viewport')
assert.doesNotMatch(viteConfig, /catalog\/catalogUi\.tsx'[\s\S]*return 'catalog-ui'/, 'tiny catalog UI helpers should fold into the public catalog route chunk')
assert.doesNotMatch(viteConfig, /catalog\/portalCatalogDisplay\.ts'[\s\S]*return 'catalog-display'/, 'tiny catalog display helpers should fold into the public catalog route chunk')
assert.match(viteConfig, /CatalogEditorSurface\.tsx'[\s\S]*CatalogImageField\.tsx'[\s\S]*CatalogPageContext\.tsx'[\s\S]*return 'catalog-editor'/, 'editor-only catalog context should stay with the lazy editor chunk instead of the public catalog route chunk')
assert.doesNotMatch(viteConfig, /portalTranslationData\.ts'[\s\S]*return 'portal-translation-data'/, 'tiny portal translation data should fold into the public catalog route chunk')
assert.doesNotMatch(viteConfig, /portalEditorUtils\.ts'[\s\S]*return 'portal-editor-utils'/, 'tiny portal editor utilities used by public normalization should fold into the public catalog route chunk')
assert.doesNotMatch(viteConfig, /portalLanguageOptions\.ts'[\s\S]*return 'portal-language-options'/, 'tiny required portal language options should fold into the catalog route chunk instead of costing a first-load request')
assert.match(viteConfig, /portalTranslateController\.ts'[\s\S]*return 'portal-translate-controller'[\s\S]*portalLanguagePacks\.ts'[\s\S]*return 'portal-language-packs'[\s\S]*portalContentI18n\.ts'[\s\S]*return 'portal-content-i18n'[\s\S]*components\/catalog\/'\)\) return 'catalog'/, 'large or intent-only portal helpers should stay split before the generic catalog route chunk')
assert.match(catalogPage, /import CatalogPreviewSurface from '\.\/CatalogPreviewSurface'/, 'public catalog should directly import its first-viewport preview shell')
assert.doesNotMatch(catalogPage, /import CatalogProductsSection from '\.\/CatalogProductsSection'/, 'public catalog should not fold the product grid into the catalog shell chunk')
assert.match(publicCatalogPage, /const loadCatalogProductsSection = \(\) => import\('\.\/CatalogProductsSection'\)/, 'public-only catalog controller should lazy-load the preloaded product grid after the shell can paint')
assert.match(publicCatalogPage, /const CatalogProductsSection = lazyRetry\(loadCatalogProductsSection, 'public-catalog-products-section'\)/, 'public-only catalog controller should render the product grid through a retrying lazy loader')
assert.doesNotMatch(products, /waitForNextFrame|requestAnimationFrame/, 'Products should reveal fetched rows immediately instead of adding animation-frame loading delay')
assert.doesNotMatch(inventory, /setInitialInventoryDesktopRevealReady[\s\S]{0,260}requestAnimationFrame/, 'Inventory products should not wait animation frames after data is loaded')
assert.doesNotMatch(auditLog, /setInitial(?:Desktop|Mobile)RevealReady[\s\S]{0,320}requestAnimationFrame/, 'Audit Log should not wait animation frames after rows are loaded')
assert.doesNotMatch(catalogPage, /CatalogPageProvider|CatalogPageContext/, 'public catalog route shell should not import the editor-only context provider')
assert.match(catalogEditorSurface, /import \{ CatalogPageProvider, useCatalogPageContext \} from '\.\/CatalogPageContext'/, 'lazy editor surface should own the editor-only context provider')
assert.match(catalogEditorSurface, /function CatalogEditorSurface\(\{ contextValue \}: CatalogEditorSurfaceProps\)[\s\S]*<CatalogPageProvider value=\{contextValue\}>[\s\S]*<CatalogEditorSurfaceContent \/>/, 'editor provider should wrap only the lazy editor surface')
assert.match(catalogPage, /const editorPanel = canEdit \? \(\(\) => \{[\s\S]*const editorSections: EditorSection\[\][\s\S]*const editorContextValue = \{[\s\S]*<CatalogEditorSurface contextValue=\{editorContextValue\} \/>[\s\S]*\}\)\(\) : null/, 'public catalog renders should skip editor-only section and context allocation')
assert.match(catalogPage, /import \{ resolveCatalogAssetUrl \} from '\.\/catalogAssetUrls'/, 'public catalog should use its local asset resolver instead of the broader file/media helper graph')
assert.match(
  catalogPage,
  /import \{ buildProductSearchTerms \} from '\.\.\/products\/helpers\/productFilterHelpers\.ts'/,
  'public catalog should share Products search-term normalization',
)
assert.match(
  catalogPage,
  /const portalSearchTerms = useMemo\(\(\) => buildProductSearchTerms\(deferredSearch\), \[deferredSearch\]\)/,
  'public catalog should memoize shared search terms from deferred input',
)
assert.match(
  catalogPage,
  /const portalSearchQuery = useMemo\(\(\) => portalSearchTerms\.join\(','\), \[portalSearchTerms\]\)/,
  'public catalog should send a stable comma-normalized search query to the API',
)
assert.doesNotMatch(
  catalogPage,
  /deferredSearch\.toLowerCase\(\)\.split\(/,
  'public catalog should not keep an ad hoc whitespace/comma search parser',
)
assert.match(catalogImages, /import \{ resolveCatalogAssetUrl \} from '\.\/catalogAssetUrls'/, 'public catalog images should use the local asset resolver')
assert.doesNotMatch(catalogPage, /utils\/publicAssetUrls/, 'public catalog startup should not import the shared publicAssetUrls helper')
assert.doesNotMatch(catalogImages, /utils\/publicAssetUrls/, 'public catalog image startup should not import the shared publicAssetUrls helper')
assert.doesNotMatch(catalogAssetUrls, /api\/http|FRONTEND_BUILD_INFO|FilePickerModal/, 'catalog asset resolver should stay self-contained and avoid API/file-picker chunk ownership')
assert.doesNotMatch(catalogPage, /const loadCatalogPreviewSurface = \(\) => import\('\.\/CatalogPreviewSurface'\)/, 'public catalog should not lazy-load its first-viewport preview shell')
assert.match(catalogPage, /const loadCatalogProductsSection = \(\) => import\('\.\/CatalogProductsSection'\)/, 'public catalog should lazy-load the preloaded product grid chunk after the shell can paint')
assert.match(catalogPage, /const CatalogProductsSection = lazyRetry\(loadCatalogProductsSection, 'catalog-products-section'\)/, 'public catalog should render the product grid through a retrying lazy loader while Vite preloads the chunk for the default tab')
assert.doesNotMatch(catalogPage, /from '\.\/portalLanguagePacks\.ts'/, 'public catalog should not statically import full first-party language packs during route startup')
assert.doesNotMatch(catalogPage, /from '\.\/portalContentI18n\.ts'/, 'public catalog should not statically import full content localization tables during route startup')
assert.match(catalogPage, /import\('\.\/portalLanguagePacks\.ts'\)/, 'public catalog should lazy-load first-party language packs only for non-English language intent')
assert.match(catalogPage, /import\('\.\/portalContentI18n\.ts'\)/, 'public catalog should lazy-load content localization only for non-English language intent')
assert.match(catalogPagination, /<PaginationControls/, 'public catalog pagination should use the shared responsive control')
assert.match(catalogPagination, /editablePageSizeInput=\{false\}/, 'public catalog pagination should keep the mobile selector compact')
assert.match(paginationControls, /flex flex-col gap-2[^"]*sm:flex-row/, 'shared pagination should stack on narrow mobile cards and return to one row on larger screens')
assert.match(viteConfig, /ResetData\.tsx'\)\) return 'backup-reset-tools'/, 'destructive Backup reset panels should have an action-only chunk')
assert.match(viteConfig, /OtpModal\.tsx'\)\) return 'settings-otp-modal'/, 'Settings OTP setup/disable modal should have an action-only chunk')
assert.match(viteConfig, /formatters\.ts'\)\) \{[\s\S]*return 'shared-formatters'/, 'shared date/number formatters should not be owned by a lazy user detail chunk')
assert.match(viteConfig, /permissionDefinitions\.ts'\)\) return 'user-permission-definitions'/, 'lightweight user permission metadata should not be owned by the lazy permission editor chunk')
assert.doesNotMatch(viteConfig, /historyHelpers\.ts'\)\) return 'shared-action-history'/, 'history snapshot helpers should not force a shared action-history startup chunk')
assert.doesNotMatch(viteConfig, /bulkOps\.ts'\)\) return 'shared-action-history'/, 'bulk action concurrency helpers should not force a shared action-history startup chunk')
assert.doesNotMatch(viteConfig, /actionHistory\.ts'\)\) \{[\s\S]*return 'shared-action-history'/, 'action-history hook should stay with route consumers while the API transport remains lazy')
assert.match(viteConfig, /UserProfileModal\.tsx'\)\) return 'user-profile-modal'/, 'Users profile modal should have an action-only chunk')
assert.match(viteConfig, /UserDetailSheet\.tsx'\)\) return 'user-detail-sheet'/, 'Users detail sheet should have an action-only chunk')
assert.match(viteConfig, /PermissionEditor\.tsx'\)\) return 'user-permission-editor'/, 'Users role permission editor should have an action-only chunk')
assert.match(viteConfig, /TransferModal\.tsx'\)\) return 'branch-transfer-modal'/, 'Branches transfer modal should have an action-only chunk')
assert.doesNotMatch(catalogPage, /from '\.\/portalTranslateController\.ts'/, 'public catalog should not statically import the Google Translate controller during route startup')
assert.match(catalogPage, /import\('\.\/portalTranslateController\.ts'\)/, 'public catalog should load the Google Translate controller only from external translation intent')
assert.match(catalogPage, /setupPortalExternalTranslateWidget/, 'public catalog should delegate external Google Translate widget setup to the lazy controller module')
assert.doesNotMatch(catalogPage, /window\.google|TranslateElement|ensurePortalTranslateScript|ensurePortalTranslateWidgetHost/, 'public catalog route should not carry Google Translate DOM setup in the first route chunk')
assert.match(catalogPage, /useState<PortalDraft>\(\(\) => \(\s*publicView\s*\?\s*\{\}\s*:\s*buildDraft/s, 'public catalog should skip editor draft construction on first render')
const publicPortalLoadStart = catalogPage.indexOf('if (publicView) {', catalogPage.indexOf('async function loadPortal'))
assert.notEqual(publicPortalLoadStart, -1, 'public catalog bootstrap branch should be present')
const adminPortalLoadMatch = /\r?\n\r?\n    const bootstrapResult = await withLoaderTimeout/.exec(catalogPage.slice(publicPortalLoadStart))
assert.notEqual(adminPortalLoadMatch, null, 'admin catalog bootstrap branch should follow the public branch')
const publicPortalLoadEnd = publicPortalLoadStart + (adminPortalLoadMatch?.index || 0)
const publicPortalLoadBranch = catalogPage.slice(publicPortalLoadStart, publicPortalLoadEnd)
assert.doesNotMatch(publicPortalLoadBranch, /setEditorDraft\(buildDraft/, 'public catalog bootstrap should not build or write editor draft state')
assert.match(catalogPage, /canEdit \? editorDraft\.customer_portal_about_blocks : null/, 'public catalog collection memos should read config directly instead of editor draft fields')
// Public storefront favicon is app default now too (§16 / 11.14): the
// portal must not generate or swap a rounded favicon from business config.
assert.doesNotMatch(catalogPage, /createCircularFaviconDataUrl|renderRoundedFavicon|CATALOG_PORTAL_FAVICON_TIMEOUT_MS/, 'public catalog must not process or swap a custom favicon -- the tab/PWA icon is default app branding')
assert.match(viteConfig, /CatalogEditorSurface\.tsx'\)[\s\S]*CatalogImageField\.tsx'\)[\s\S]*return 'catalog-editor'/, 'editor-only catalog image fields should not be grouped into the public catalog chunk')
assert.doesNotMatch(viteConfig, /ActionHistoryBar\.tsx'\)\) return 'shared-action-history'/, 'ActionHistoryBar should not create a dedicated first-route action-history asset')
assert.match(viteConfig, /QuickPreferenceToggles\.tsx'\)\) return 'shared-ui'[\s\S]*PaginationControls\.tsx'\)\) return 'shared-ui'[\s\S]*FilterMenu\.tsx'\)\) return 'shared-ui'[\s\S]*SectionSwitcher\.tsx'\)\) return 'shared-ui'[\s\S]*PageHeader\.tsx'\)\) return 'shared-page-header'[\s\S]*Modal\.tsx'\)\) return 'shared-modal'[\s\S]*if \(normalized\.includes\('\/src\/components\/shared\/'\)\) return 'app-shared'/, 'tiny preference controls should ride the existing shared UI request while later-route shared controls split before the generic app-shared startup chunk')
assert.doesNotMatch(exportMenu, /import PortalMenu from '\.\/PortalMenu'/, 'ExportMenu should not statically import the portal menu positioning code during startup')
assert.match(exportMenu, /import\('\.\/PortalMenu'\)\.then\(\(module\) => module\.default\)/, 'ExportMenu should load PortalMenu only on pointer/focus/click intent')
assert.match(exportMenu, /defaultOpen=\{openOnLoad\}/, 'ExportMenu first click should open the menu after the PortalMenu chunk loads')
assert.doesNotMatch(filterMenu, /import PortalMenu from '\.\/PortalMenu'/, 'FilterMenu should not statically import the portal menu positioning code during route startup')
assert.match(filterMenu, /import LazyPortalMenu from '\.\/LazyPortalMenu'/, 'FilterMenu should route menu positioning through the intent-loaded wrapper')
// Redesign (Aug 30 2026): sections are accordion rows inside the ONE panel --
// no second popover floats over it (the old per-section flyout stacked two
// popovers and capped labels at a 5rem grid column). Exactly one
// LazyPortalMenu usage = the top-level menu itself.
assert.strictEqual((filterMenu.match(/<LazyPortalMenu/g) || []).length, 1, 'FilterMenu must have exactly one popover layer — sections expand inline (accordion), never as a second floating menu')
assert.match(filterMenu, /openSectionId/, 'FilterMenu sections should expand inline via accordion state')
// Chosen filters show only INSIDE the menu now (each section's collapsed
// summary + the trigger's active count). The removable "active pick" chips
// that used to render OUTSIDE the trigger, in the toolbar row beside the
// search box, were removed (user, Aug 31 2026) so nothing spills out next to
// the Filters button.
assert.doesNotMatch(filterMenu, /ActiveFilterChips/, 'FilterMenu must not surface active picks as chips outside the menu — chosen filters live inside the menu only')
assert.match(filterMenu, /if \(label\.toLowerCase\(\) === 'back'\) return fallback/, 'FilterMenu should replace accidental Back labels with section-specific labels')
assert.match(appSelect, /data-app-select-button="true"/, 'AppSelect should expose a stable rounded trigger hook for live visual checks')
assert.match(appSelect, /data-app-select-selected="true"/, 'AppSelect should expose the selected value for live visual checks')
assert.match(appSelect, /max-h-\[min\(18rem,calc\(100vh-1rem\)\)\]/, 'AppSelect menus should be viewport-bounded instead of tall square native popups')
assert.doesNotMatch(productsHeaderActions, /import PortalMenu from '\.\.\/\.\.\/shared\/PortalMenu'/, 'Products header actions should not load PortalMenu before a manage/export click')
assert.match(productsHeaderActions, /import LazyPortalMenu from '\.\.\/\.\.\/shared\/LazyPortalMenu'/, 'Products header actions should load PortalMenu through LazyPortalMenu')
assert.doesNotMatch(productRowParts, /import \{ ThreeDotPortal \} from '\.\.\/\.\.\/shared\/PortalMenu'/, 'Product row actions should not statically load PortalMenu for every first route paint')
// ProductRowParts.tsx used to export ProductRowActions, a "..." row menu
// (Edit/Add Variant/Discounts/Adjust stock/Delete via LazyPortalMenu) that
// duplicated the exact same five actions already offered by clicking the
// row to open ProductDetailModal. Removed entirely as a redundant-control
// cleanup: both render sites (desktop table cell, mobile card), the
// ProductRowActions component itself, its now-unused imports/types, and the
// matching empty spacer column in ProductsListSurface.tsx. Row click is now
// the sole way to reach these actions, so this file no longer imports
// PortalMenu/LazyPortalMenu at all.
assert.doesNotMatch(productRowParts, /ProductRowActions|LazyPortalMenu|PortalMenu/, 'Product row actions menu was intentionally removed as a duplicate of row-click -> ProductDetailModal; should not be reintroduced')
assert.doesNotMatch(contactsShared, /import PortalMenu from '\.\.\/shared\/PortalMenu'/, 'Contacts row actions should not statically load PortalMenu for first route paint')
assert.match(contactsShared, /import LazyPortalMenu from '\.\.\/shared\/LazyPortalMenu'/, 'Contacts row actions should load PortalMenu only after row action intent')
// Contacts.tsx used to own a page-level "Export All" that pulled customers/
// suppliers/delivery contacts through a dedicated read transport and zipped
// them into one CSV bundle (the assertions this replaced checked for that
// machinery directly in this file). That control was intentionally removed
// during the UI/UX toolbar-consolidation pass: it duplicated each tab's own
// scoped Import/Export/Add row, so the page now keeps a single Import/
// Export set per tab instead of two (see the code comment at the top of
// Contacts.tsx). Each tab still lazy-loads its own CSV export helper for
// its own scoped export -- covered by the per-tab assertions below instead.
assert.doesNotMatch(
  contacts,
  /loadContactReadTransportModule|CONTACTS_EXPORT_LOAD_TIMEOUT_MS|normalizeContactExportRows|downloadZipFilesAsync/,
  'Contacts route shell should not reintroduce the removed page-level export-all machinery',
)
assert.doesNotMatch(
  contacts,
  /window\.api|\(window as Window & \{ api\?:|contactsTransport\.ts/,
  'Contacts route shell should not wake broad or mixed contact transports for contact export',
)
assert.doesNotMatch(
  contacts,
  /from '\.\/CustomersTab'/,
  'Contacts route shell should not eagerly import the default Customers tab chunk',
)
assert.match(
  contacts,
  /const loadCustomersTab = async \(\): Promise<\{ CustomersTab: ComponentType<ContactTabProps> \}>[\s\S]*import\('\.\/CustomersTab'\)[\s\S]*const CustomersTab = lazyRetry\(\(\) => loadCustomersTab\(\)\.then\(\(module\) => \(\{ default: module\.CustomersTab \}\)\), 'contacts-customers-tab'\)/,
  'Contacts route should lazy-load the default Customers tab behind the route shell, retrying a failed/slow chunk fetch like its sibling tabs',
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
assert.doesNotMatch(pos, /import \{ parseStoredContactOptions \} from '\.\.\/contacts\/contactOptionUtils'/, 'POS should not load contact option parsers before customer selection intent')
assert.match(pos, /function loadContactOptionUtilsModule\(\): Promise<ContactOptionUtilsModule>[\s\S]*import\('\.\.\/contacts\/contactOptionUtils'\)[\s\S]*async function parseContactOptions\(raw: unknown\): Promise<ContactOption\[\]>/, 'POS should lazy-load contact option parsing only after customer selection intent')
assert.doesNotMatch(pos, /import FilterPanel from '\.\/FilterPanel'/, 'POS should not load the filter panel before the Filters button is opened')
assert.match(pos, /const FilterPanel = lazyRetry\(\(\) => import\('\.\/FilterPanel'\), 'pos-filter-panel'\)/, 'POS filter panel should load only on filter-button intent')
assert.match(pos, /function getProductReadTransport\(\): Promise<typeof import\('\.\.\/\.\.\/api\/productReadTransport\.ts'\)> \{[\s\S]*import\('\.\.\/\.\.\/api\/productReadTransport\.ts'\)[\s\S]*const \{ getProductBootstrap \} = await getProductReadTransport\(\)[\s\S]*const \{ searchProducts \} = await getProductReadTransport\(\)[\s\S]*const \{ getProductFilters \} = await getProductReadTransport\(\)/, 'POS product reads should use the narrow product transport instead of the full window.api registry')
assert.match(pos, /function getLookupTransport\(\): Promise<typeof import\('\.\.\/\.\.\/api\/lookupTransport\.ts'\)> \{[\s\S]*import\('\.\.\/\.\.\/api\/lookupTransport\.ts'\)[\s\S]*const \{ getCategories \} = await getLookupTransport\(\)/, 'POS category options should use the narrow lookup transport instead of the full window.api registry')
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
assert.match(saleWriteTransport, /export function syncPendingSalesQueue/, 'sale write transport should preserve pending offline sale sync through its same-context single-flight wrapper')
assert.doesNotMatch(saleWriteTransport, /from '\.\/methods\.ts'|from "\.\/methods\.ts"|from '\.\/salesTransport\.ts'|from "\.\/salesTransport\.ts"|from '\.\/requestIds\.ts'|from "\.\/requestIds\.ts"/, 'sale write transport should not import the broad API registry, sales read/mirror transport, or shared request-id owner')
assert.match(saleWriteTransport, /function ensureSaleClientRequestId/, 'sale write transport should keep a tiny local request-id helper so checkout does not wake app-api-methods')
assert.doesNotMatch(productWriteTransport, /from '\.\/methods\.ts'|from "\.\/methods\.ts"/, 'product write transport should not import the broad API registry')
assert.doesNotMatch(productImageUploadTransport, /from '\.\/(?:methods|fileTransport|importTransport)\.ts'|from "\.\/(?:methods|fileTransport|importTransport)\.ts"/, 'product image upload transport should not import the broad API registry, file transport, or import-job multipart stack')
assert.doesNotMatch(fileTransport, /export async function uploadProductImage|products:uploadImage|\/api\/products\/upload-image/, 'file transport should not duplicate product-image upload logic')
assert.doesNotMatch(apiMethods, /productImageUploadTransport\.ts|loadProductImageUploadTransport|export const uploadProductImage/, 'legacy API registry should not retain product-image upload wrappers after Products owns the focused transport')
assert.match(products, /let productReadModulePromise: Promise<ProductReadModule> \| null = null[\s\S]*function loadProductReadModule\(\): Promise<ProductReadModule>[\s\S]*import\('\.\.\/\.\.\/api\/productReadTransport\.ts'\)/, 'Products route should lazy-load the narrow product read transport locally')
assert.match(products, /let productWriteModulePromise: Promise<ProductWriteModule> \| null = null[\s\S]*function loadProductWriteModule\(\): Promise<ProductWriteModule>[\s\S]*import\('\.\.\/\.\.\/api\/productWriteTransport\.ts'\)/, 'Products route should lazy-load product create/update/delete transport locally')
assert.match(products, /function loadBranchModule\(\): Promise<BranchModule>[\s\S]*import\('\.\.\/\.\.\/api\/branchTransport\.ts'\)[\s\S]*function loadInventoryWriteModule\(\): Promise<InventoryWriteModule>[\s\S]*import\('\.\.\/\.\.\/api\/inventoryWriteTransport\.ts'\)[\s\S]*function loadProductImageUploadModule\(\): Promise<ProductImageUploadModule>[\s\S]*import\('\.\.\/\.\.\/api\/productImageUploadTransport\.ts'\)/, 'Products route should lazy-load branch, inventory writes, and product-image-upload transports only on their intent paths')
assert.doesNotMatch(products, /function loadInventoryModule\(\): Promise<InventoryModule>[\s\S]*inventoryTransport\.ts/, 'Products stock writes should not load the read-heavy inventory transport')
assert.doesNotMatch(products, /import \{ downloadCSV \} from '\.\.\/\.\.\/utils\/csv'/, 'Products route should not load CSV export helpers before export intent')
assert.doesNotMatch(products, /buildProductExportRows[\s\S]*from '\.\/helpers\/productFilterHelpers\.ts'/, 'Products route should not import export row builders through the live filter helper')
// Part 405 made the two intent-time imports sequential (row builder
// first, format helper at the branch that needs it) -- the pin follows
// the INTENT: both stay dynamic imports INSIDE the export callback, never
// top-level, whatever their composition.
assert.match(products, /const exportProductsCsv = useCallback\(async[\s\S]*?await import\('\.\/helpers\/productExport\.ts'\)[\s\S]*?await import\('\.\.\/\.\.\/utils\/xlsxExport\.ts'\)/, 'Products export should load XLSX helpers and export row builders only after the export action')
assert.doesNotMatch(products, /^import[^\n]*utils\/xlsxExport/m, 'the XLSX helper must never be a top-level import on the Products route')
assert.match(productExport, /export function buildProductExportRows/, 'Products export chunk should own CSV row formatting')
assert.match(productExport, /formatPriceNumber/, 'Products export chunk should own export-only price formatting')
assert.doesNotMatch(productFilterHelpers, /buildProductExportRows|formatPriceNumber/, 'Products live filtering helper should not carry export row or price formatting code')
assert.match(viteConfig, /'assets\/product-export-',/, 'Products export chunk should be excluded from eager modulepreload')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/components\/products\/helpers\/productExport\.ts'\)\) \{\s*return 'product-export'/, 'Products export row assembly should have a named intent chunk')
assert.match(viteConfig, /'assets\/dashboard-export-',/, 'Dashboard export chunk should be excluded from eager modulepreload')
assert.match(viteConfig, /normalized\.includes\('\/src\/components\/dashboard\/charts\/'\)\) return 'dashboard-charts'[\s\S]*normalized\.endsWith\('\/src\/components\/dashboard\/dashboardExport\.ts'\)\) return 'dashboard-export'/, 'Dashboard charts should not be owned by the export/report chunk')
for (const [name, source] of [['Customers', customers], ['Suppliers', suppliers], ['Delivery', delivery]] as const) {
  assert.doesNotMatch(source, /import \{ downloadCSV \} from '\.\.\/\.\.\/utils\/csv'/, `${name} contacts tab should not load CSV helpers before export intent`)
  // Part 405: the tabs route through the lazy ExportOptionsDialog -- csv/xlsx
  // helpers load inside the dialog on Export click (pinned in the Sales
  // block), so the tabs themselves must not import them at all.
  assert.doesNotMatch(source, /from '\.\.\/\.\.\/utils\/xlsxExport/, `${name} contacts tab should not load XLSX helpers before export intent`)
  assert.match(source, /const ExportOptionsDialog = lazyRetry\(\(\) => import\('\.\.\/shared\/ExportOptionsDialog'\)/, `${name} contacts export goes through the lazy shared options dialog`)
}
assert.doesNotMatch(sales, /import \{ downloadCSV \} from '\.\.\/\.\.\/utils\/csv'/, 'Sales route should not load CSV export helpers before export intent')
// H1+X5 (Part 401): Sales no longer downloads directly -- every export scope
// opens the LAZY ExportOptionsDialog, and csv/xlsx helpers dynamic-import
// inside the dialog's runExport, i.e. even later than before (format chosen,
// Export clicked). The pin's intent (no export helpers before intent) holds
// stricter than ever: Sales.tsx must not import the helpers at all.
assert.doesNotMatch(sales, /from '\.\.\/\.\.\/utils\/xlsxExport/, 'Sales route should not load XLSX helpers before export intent')
assert.match(sales, /const ExportOptionsDialog = lazyRetry\(\(\) => import\('\.\.\/shared\/ExportOptionsDialog'\)/, 'Sales export goes through the lazy shared options dialog')
{
  const exportDialogSource = fs.readFileSync(new URL('../src/components/shared/ExportOptionsDialog.tsx', import.meta.url), 'utf8')
  assert.match(exportDialogSource, /await import\('\.\.\/\.\.\/utils\/csv\.ts'\)/, 'dialog loads CSV helpers only on Export click')
  assert.match(exportDialogSource, /await import\('\.\.\/\.\.\/utils\/xlsxExport\.ts'\)/, 'dialog loads XLSX helpers only on Export click')
}
assert.doesNotMatch(returns, /import \{ downloadCSV \} from '\.\.\/\.\.\/utils\/csv'/, 'Returns route should not load CSV export helpers before export intent')
// Part 405: Returns routes through the lazy ExportOptionsDialog like Sales --
// helpers load inside the dialog on Export click (pinned in the Sales block).
assert.doesNotMatch(returns, /from '\.\.\/\.\.\/utils\/xlsxExport/, 'Returns route should not load XLSX helpers before export intent')
assert.match(returns, /const ExportOptionsDialog = lazyRetry\(\(\) => import\('\.\.\/shared\/ExportOptionsDialog'\)/, 'Returns export goes through the lazy shared options dialog')
assert.match(returns, /import ReturnsListSurface from '\.\/ReturnsListSurface'/, 'Returns list surface should render from the route chunk instead of adding a first-paint subchunk waterfall')
assert.doesNotMatch(returns, /const ReturnsListSurface = lazy\(\(\) => import\('\.\/ReturnsListSurface'\)\)/, 'Returns list surface should not suspend behind a second component chunk after the route loads')
assert.doesNotMatch(returns, /loading_returns_surface/, 'Returns route should not show a route-subchunk loading placeholder after data is available')
assert.match(viteConfig, /returns:\s*\[\s*'Returns',\s*'returns-read-api',\s*\]/, 'Returns should have focused route-aware preloads for the route and read transport')
// Link-preload-hint feature not ported to Cloudflare -- see the viteConfig-loading comment near line 34 above (confirmed: no Link/preload header equivalent exists anywhere in cloudflare/src).
assert.match(viteConfig, /users:\s*\[\s*'Users',\s*'user-admin-api',\s*'user-permission-definitions',\s*\]/, 'Users should have focused route-aware preloads for the route, user API, and permission definitions')

assert.doesNotMatch(auditLog, /import \{ downloadCSV \} from '\.\.\/\.\.\/utils\/csv'/, 'Audit Log route should not load CSV export helpers before export intent')
// H1+X5 (Part 401): Audit Log routes through the same lazy ExportOptionsDialog
// as Sales -- helpers dynamic-import inside the dialog on Export click (the
// dialog-side pins live in the Sales block above).
assert.match(auditLog, /const ExportOptionsDialog = lazyRetry\(\(\) => import\('\.\.\/shared\/ExportOptionsDialog'\)/, 'Audit Log export goes through the lazy shared options dialog')
// The manual "Clear 30d" retention action was removed from this route (see
// the code comment near line 823 of AuditLog.tsx) in favor of the automatic
// server-side retention sweep (cloudflare/src/lib/audit.ts,
// maybeRunScheduledAuditLogRetention()), so the route no longer imports
// deleteAuditLogsRetention at all -- only the read import remains.
assert.match(auditLog, /getAuditLogs as getAuditLogsRequest[\s\S]*from '\.\.\/\.\.\/api\/auditLogTransport\.ts'/, 'Audit Log should use the focused audit transport instead of the broad window.api registry')
assert.doesNotMatch(auditLog, /deleteAuditLogsRetention/, 'Audit Log route should not reintroduce the removed manual retention-clear action')
assert.doesNotMatch(auditLog, /window\.api|getAuditApi\(\)|\.getAuditLogs\(/, 'Audit Log route should not wake app-api-methods for reads')
assert.doesNotMatch(apiMethods, /auditLogTransport\.ts|loadAuditLogTransport|export const getAuditLogs/, 'legacy API registry should not retain audit-log wrappers after the route owns the focused transport')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/auditLogTransport\.ts'\)\) return 'audit-log-api'/, 'Audit Log transport should own a tiny chunk instead of falling through to app-api-methods')
assert.doesNotMatch(auditLogTransport, /import \{ getLocalDb \} from '\.\/lazyLocalDb\.ts'|import \{ mirrorTable \} from '\.\/localMirrors\.ts'/, 'Audit Log transport should not statically load local DB or mirror helpers during online startup')
assert.match(auditLogTransport, /const AUDIT_LOG_MIRROR_IDLE_DELAY_MS = 10_000[\s\S]*getLocalMirrorsModule\(\)[\s\S]*window\.setTimeout\(run, AUDIT_LOG_MIRROR_IDLE_DELAY_MS\)/, 'Audit Log mirroring should run after startup instead of blocking the first read')
assert.match(auditLogTransport, /const \{ getLocalDb \} = await getLocalDbModule\(\)[\s\S]*db\.table\('audit_logs'\)/, 'Audit Log local DB should load only for offline fallback reads')
assert.doesNotMatch(products, /\(window as Window & \{ api\?: ProductApi \}\)\.api|window\.api\.(?:createProduct|updateProduct|deleteProduct|adjustStock|transferStock|uploadProductImage)/, 'Products route should not depend on window.api for product write or stock/image intent paths')
assert.match(inventory, /function loadInventoryTransport\(\): Promise<InventoryTransportModule>[\s\S]*import\('\.\.\/\.\.\/api\/inventoryTransport\.ts'\)[\s\S]*function loadProductReadTransport\(\): Promise<ProductReadTransportModule>[\s\S]*import\('\.\.\/\.\.\/api\/productReadTransport\.ts'\)[\s\S]*function loadReturnsReadTransport\(\): Promise<ReturnsReadTransportModule>[\s\S]*import\('\.\.\/\.\.\/api\/returnsReadTransport\.ts'\)/, 'Inventory route should lazy-load focused inventory, product-read, and return-read transports instead of the broad API registry')
assert.match(inventory, /function loadUserReadTransport\(\): Promise<UserReadTransportModule>[\s\S]*import\('\.\.\/\.\.\/api\/userReadTransport\.ts'\)/, 'Inventory route should lazy-load the tiny user read transport for admin movement filters')
assert.match(inventory, /function loadBranchTransport\(\): Promise<BranchTransportModule>[\s\S]*function loadDashboardTransport\(\): Promise<DashboardTransportModule>[\s\S]*function loadRfidTransport\(\): Promise<RfidTransportModule>/, 'Inventory route should own narrow lazy loaders for branch, dashboard, and RFID transport paths')
assert.match(inventory, /function loadInventoryExportModule\(\): Promise<InventoryExportModule>[\s\S]*import\('\.\/inventoryExport\.ts'\)/, 'Inventory route should lazy-load export assembly only when an export action is requested')
assert.doesNotMatch(inventory, /from '\.\/inventoryExport\.ts'/, 'Inventory route should not statically import the export assembly chunk')
assert.match(inventoryExport, /export async function exportInventoryPackage/, 'Inventory export chunk should own package report assembly')
assert.match(inventoryExport, /buildStandaloneReportHtml/, 'Inventory export chunk should own standalone HTML report generation')
assert.match(viteConfig, /'assets\/inventory-export-',/, 'Inventory export chunk should be excluded from eager modulepreload')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/components\/inventory\/inventoryExport\.ts'\)\) return 'inventory-export'/, 'Inventory export assembly should have a named intent chunk')
assert.doesNotMatch(inventory, /window\.api|\(window as Window & \{ api\?:/, 'Inventory route should not wake the broad window.api registry for reads, stats, or stock mutations')
assert.match(actionHistory, /function loadActionHistoryTransport\(\): Promise<ActionHistoryTransportModule>[\s\S]*import\('\.\.\/api\/actionHistoryTransport\.ts'\)/, 'action history hook should lazy-load its focused transport instead of window.api')
assert.match(actionHistoryTransport, /export function getActionHistoryUsers\(\): Promise<unknown>[\s\S]*apiFetch\('GET', '\/api\/users'\)/, 'action history admin user filter should stay in the focused action-history transport')
assert.doesNotMatch(actionHistory, /window\.api\?\.(?:getActionHistory|getUsers|createActionHistory|undoActionHistory|redoActionHistory|updateActionHistory)/, 'action history hook should not wake the broad API registry for history or user-filter work')
assert.match(offlineSnapshotTransport, /export async function refreshOfflineDeviceSnapshot/, 'idle offline snapshot refresh should live in a focused transport')
assert.doesNotMatch(offlineSnapshotTransport, /from '\.\/methods\.ts'|from "\.\/methods\.ts"/, 'idle offline snapshot transport should not import the broad API registry')
assert.match(apiMethods, /function loadSaleWriteTransport\(\) \{[\s\S]*import\('\.\/saleWriteTransport\.ts'\)/, 'legacy API registry should lazy-load the focused sale write transport without creating a manual chunk cycle')
assert.match(apiMethods, /export async function createSale\(d\) \{[\s\S]*await loadSaleWriteTransport\(\)[\s\S]*return createSaleRequest\(d\)/, 'legacy API registry should delegate createSale to the focused sale write transport')
assert.match(apiMethods, /function loadPendingSyncTransport\(\) \{[\s\S]*import\('\.\/pendingSyncTransport\.ts'\)/, 'legacy API registry should lazy-load the focused pending sync transport')
assert.match(apiMethods, /export async function retryPendingSyncNow\(\) \{[\s\S]*await loadPendingSyncTransport\(\)[\s\S]*return retryPendingSyncNowRequest\(\)/, 'legacy pending-sync retry should delegate to the focused pending sync transport')
assert.doesNotMatch(apiMethods, /sync_queue|serializePendingSyncPreview|syncPendingSalesQueue\(\{ force: true \}\)/, 'legacy API registry should not keep pending-sync queue Dexie or retry implementation details')
assert.match(viteConfig, /'assets\/pending-sync-api-',/, 'pending sync queue transport should be excluded from eager modulepreload')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/pendingSyncTransport\.ts'\)\) return 'pending-sync-api'/, 'pending sync queue transport should have a named intent chunk')
assert.match(apiMethods, /function loadDriveSyncTransport\(\) \{[\s\S]*import\('\.\/driveSync\.ts'\)/, 'legacy API registry should lazy-load the focused Drive sync transport')
assert.doesNotMatch(apiMethods, /from '\.\/driveSync\.ts'/, 'legacy API registry should not statically import Drive sync APIs')
assert.match(viteConfig, /'assets\/drive-sync-api-',/, 'Drive sync transport should be excluded from eager modulepreload')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/driveSync\.ts'\)\) return 'drive-sync-api'/, 'Drive sync transport should have a named intent chunk')
assert.match(apiMethods, /function loadNotificationSummaryTransport\(\) \{[\s\S]*import\('\.\/notificationSummary\.ts'\)/, 'legacy API registry should lazy-load the focused notification summary transport')
assert.doesNotMatch(apiMethods, /from '\.\/notificationSummary\.ts'/, 'legacy API registry should not statically import notification summary APIs')
assert.match(viteConfig, /'assets\/notification-api-',/, 'notification summary transport should be excluded from eager modulepreload')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/notificationSummary\.ts'\)[\s\S]*return 'notification-api'/, 'notification summary transport should keep its named intent chunk')
assert.match(apiMethods, /function loadSystemJobsTransport\(\) \{[\s\S]*import\('\.\/systemJobs\.ts'\)/, 'legacy API registry should lazy-load the focused system jobs transport')
assert.doesNotMatch(apiMethods, /from '\.\/systemJobs\.ts'/, 'legacy API registry should not statically import system jobs APIs')
assert.match(viteConfig, /'assets\/system-jobs-api-',/, 'system jobs transport should be excluded from eager modulepreload')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/systemJobs\.ts'\)\) return 'system-jobs-api'/, 'system jobs transport should have a named intent chunk')
assert.match(apiMethods, /function loadAuthTransport\(\) \{[\s\S]*import\('\.\/authTransport\.ts'\)/, 'legacy API registry should lazy-load auth and organization helper APIs')
assert.doesNotMatch(apiMethods, /from '\.\/authTransport\.ts'/, 'legacy API registry should not statically import auth APIs')
assert.match(apiMethods, /export const login = async \(payload\) => \{[\s\S]*loadAuthTransport\(\)[\s\S]*loginRequest\(payload\)/, 'legacy login should delegate through lazy auth transport')
assert.match(apiMethods, /export const getOrganizationBootstrap = async \(\) => \{[\s\S]*loadAuthTransport\(\)[\s\S]*getOrganizationBootstrapRequest\(\)/, 'legacy organization bootstrap should delegate through lazy auth transport')
assert.match(viteConfig, /'assets\/app-auth-',/, 'auth transport should be excluded from eager modulepreload')
assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/authTransport\.ts'\)[\s\S]*normalized\.endsWith\('\/src\/AppContext\.tsx'\)[\s\S]*return 'app-auth'/, 'auth transport should keep its named intent chunk')
assert.match(apiMethods, /function loadLookupTransport\(\) \{[\s\S]*import\('\.\/lookupTransport\.ts'\)/, 'legacy API registry should lazy-load category and unit lookup APIs')
assert.doesNotMatch(apiMethods, /from '\.\/lookupTransport\.ts'/, 'legacy API registry should not statically import category and unit lookup APIs')
assert.doesNotMatch(apiMethods, /from '\.\.\/platform\/runtime\/clientRuntime\.ts'/, 'legacy API registry should not statically import runtime reset helpers')
assert.doesNotMatch(apiMethods, /from '\.\.\/utils\/appRefresh\.ts'/, 'legacy API registry should not statically import app refresh helpers')
assert.doesNotMatch(apiMethods, /from '\.\.\/utils\/settingsRefresh\.ts'/, 'legacy API registry should not statically import settings refresh helpers')
assert.doesNotMatch(apiMethods, /from '\.\/http\.ts'/, 'legacy API registry should not statically import the heavy HTTP core')
assert.match(apiMethods, /import \{ getSyncServerUrl \} from '\.\/httpState\.ts'/, 'legacy API registry should keep synchronous server URL reads on the tiny HTTP state module')
assert.match(apiMethods, /function loadHttpCoreModule\(\) \{[\s\S]*import\('\.\/http\.ts'\)/, 'legacy cache clears should lazy-load the HTTP core only for reset-like flows')
assert.doesNotMatch(apiMethods, /export async function resetData[\s\S]*?invalidateClientRuntimeState[\s\S]*?cacheClearAll\(\)[\s\S]*?return result/, 'legacy resetData should not re-clear the HTTP cache after runtime invalidation already did it')
assert.doesNotMatch(apiMethods, /export async function factoryReset[\s\S]*?invalidateClientRuntimeState[\s\S]*?cacheClearAll\(\)[\s\S]*?return result/, 'legacy factoryReset should not re-clear the HTTP cache after runtime invalidation already did it')
assert.match(apiMethods, /function loadClientRuntimeModule\(\) \{[\s\S]*import\('\.\.\/platform\/runtime\/clientRuntime\.ts'\)/, 'legacy runtime invalidation should lazy-load client runtime helpers')
assert.match(apiMethods, /function loadAppRefreshModule\(\) \{[\s\S]*import\('\.\.\/utils\/appRefresh\.ts'\)/, 'legacy lookup mutations should lazy-load app refresh helpers')
assert.match(apiMethods, /export const createCategory = async payload => \{[\s\S]*loadLookupTransport\(\)[\s\S]*createCategoryRequest\(payload\)[\s\S]*dispatchRefreshAppData\(CATEGORY_REFRESH_CHANNELS/, 'legacy category writes should preserve refresh behavior after lazy lookup loading')
assert.match(apiMethods, /function loadBranchTransport\(\) \{[\s\S]*import\('\.\/branchTransport\.ts'\)/, 'legacy API registry should lazy-load branch read and transfer APIs')
assert.doesNotMatch(apiMethods, /from '\.\/branchTransport\.ts'/, 'legacy API registry should not statically import branch APIs')
assert.match(apiMethods, /export const getBranches = async \(\) => \{[\s\S]*loadBranchTransport\(\)[\s\S]*getBranchesRequest\(\)/, 'legacy branch reads should delegate through lazy branch transport')
assert.match(apiMethods, /export const transferStock = async payload => \{[\s\S]*loadBranchTransport\(\)[\s\S]*transferStockRequest\(payload\)/, 'legacy branch transfers should delegate through lazy branch transport')
assert.match(apiMethods, /function loadInventoryTransport\(\) \{[\s\S]*import\('\.\/inventoryTransport\.ts'\)/, 'legacy API registry should lazy-load inventory read APIs')
assert.doesNotMatch(apiMethods, /from '\.\/inventoryTransport\.ts'/, 'legacy API registry should not statically import inventory read APIs')
assert.match(apiMethods, /export const getInventoryBootstrap = async \(params = \{\}\) => \{[\s\S]*loadInventoryTransport\(\)[\s\S]*getInventoryBootstrapRequest\(params\)/, 'legacy inventory bootstrap should delegate through lazy inventory read transport')
assert.match(apiMethods, /function loadProductReadTransport\(\) \{[\s\S]*import\('\.\/productReadTransport\.ts'\)/, 'legacy API registry should lazy-load product read APIs')
assert.doesNotMatch(apiMethods, /from '\.\/productReadTransport\.ts'/, 'legacy API registry should not statically import product read APIs')
assert.doesNotMatch(apiMethods, /from '\.\/accessControlTransport\.ts'/, 'legacy API registry should not statically import access-control APIs')
assert.doesNotMatch(apiMethods, /accessControlTransport\.ts|loadAccessControlTransport/, 'legacy API registry should not retain the retired access-control loader')
assert.match(apiMethods, /function loadUserReadTransport\(\) \{[\s\S]*import\('\.\/userReadTransport\.ts'\)/, 'legacy API registry should lazy-load user list reads through the user-read transport')
assert.match(apiMethods, /function loadUserAdminTransport\(\) \{[\s\S]*import\('\.\/userAdminTransport\.ts'\)/, 'legacy API registry should lazy-load profile, password, and role operations through the user-admin transport')
assert.match(apiMethods, /export const getUsers = async \(\) => \{[\s\S]*loadUserReadTransport\(\)[\s\S]*getUsersRequest\(\)/, 'legacy user list reads should delegate through lazy user-read transport')
assert.match(apiMethods, /export const getRoles = async \(\) => \{[\s\S]*loadUserAdminTransport\(\)[\s\S]*getRolesRequest\(\)/, 'legacy role reads should delegate through lazy user-admin transport')
assert.match(apiMethods, /export const getUserProfile = async \(id\) => \{[\s\S]*loadUserAdminTransport\(\)[\s\S]*getUserProfileRequest\(id\)/, 'legacy profile reads should delegate through lazy user-admin transport')
assert.doesNotMatch(apiMethods, /from '\.\/customTablesTransport\.ts'/, 'legacy API registry should not statically import custom-table APIs')
assert.doesNotMatch(apiMethods, /customTablesTransport\.ts|loadCustomTablesTransport|export const getCustomTables|export const createCustomTable|export const getCustomTableData|export const insertCustomRow|export const updateCustomRow|export const deleteCustomRow/, 'legacy API registry should not retain custom-table wrappers after the route owns the focused transport')
assert.match(apiMethods, /function loadQueryCacheModule\(\) \{[\s\S]*import\('\.\/queryCache\.ts'\)/, 'legacy API registry should lazy-load query-cache cleanup only after sync updates')
assert.doesNotMatch(apiMethods, /from '\.\/queryCache\.ts'/, 'legacy API registry should not statically import product query-cache helpers')
assert.match(apiMethods, /function loadLocalMirrorsModule\(\) \{[\s\S]*import\('\.\/localMirrors\.ts'\)/, 'legacy API registry should lazy-load local mirror purge helpers after idle delay')
assert.doesNotMatch(apiMethods, /from '\.\/localMirrors\.ts'/, 'legacy API registry should not statically import local mirror helpers')
assert.match(apiMethods, /export const searchProducts = async \(params = \{\}\) => \{[\s\S]*loadProductReadTransport\(\)[\s\S]*searchProductsRequest\(params\)/, 'legacy product search should delegate through lazy product read transport')
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
assert.match(webApi, /function ensureSessionRecoveryListeners\(\): void \{[\s\S]*sessionRecoveryListenersRegistered[\s\S]*const recoverForegroundSession = \(reason: string, force = false, refreshData = false\): boolean => \{[\s\S]*resumeWS\(\)[\s\S]*pingServerHealth\(force\)\.catch[\s\S]*runOfflineMaintenance\(force\)[\s\S]*window\.addEventListener\('online'[\s\S]*recoverForegroundSession\('network-online', true, false\)[\s\S]*window\.addEventListener\('focus'[\s\S]*recoverAfterBackground\('window-focus'\)[\s\S]*document\.addEventListener\('visibilitychange'[\s\S]*recoverAfterBackground\('visibility-resume'\)[\s\S]*window\.addEventListener\('sync:reconnected'/, 'online/focus/visibility recovery listeners should delegate to the centralized throttled foreground-recovery path')
assert.doesNotMatch(webApi, /if \(typeof window !== 'undefined'\) \{[\s\S]{0,500}window\.addEventListener\('online'/, 'signed-out startup should not register session recovery listeners at module load')
assert.match(webApi, /const previousSyncServerUrl = getSyncServerUrl\(\)[\s\S]*const syncServerChanged = previousSyncServerUrl !== clean[\s\S]*scheduleBootstrapOfflineDbWrite\(\(db\) => db\.settings\.put\(\{ key: 'sync_server_url', value: clean \}\)\)[\s\S]*cacheClearAll\(\)[\s\S]*if \(hasStoredUserSession\(\)\) \{[\s\S]*ensureSessionRecoveryListeners\(\)[\s\S]*scheduleConnectWS\(\)[\s\S]*startHealthCheck\(\)[\s\S]*if \(syncServerChanged && hasStoredUserSession\(\)\) \{[\s\S]*scheduleInitialOfflineMaintenance\(\)/, 'setSyncServerUrl should avoid duplicate cache clears and start recovery loops only for stored sessions while deferring the first websocket connect')
assert.doesNotMatch(webApi, /setSyncServerUrl\(url: unknown\)[\s\S]{0,900}getOfflineDb\(\)\.then/, 'setSyncServerUrl should not load IndexedDB during startup')
assert.doesNotMatch(webApi, /try \{\s*await dexieDb\.settings\.(?:delete|put)/, 'web API bootstrap should not await Dexie maintenance before connecting')
assert.doesNotMatch(webApi, /dexieDb\.settings/, 'web API should not call Dexie settings through a startup static import')
assert.match(webApi, /async function unlockOfflineVault[\s\S]*const offlineDb = await getOfflineDb\(\)[\s\S]*offlineDb\.offline_vault/, 'offline vault should load local DB on demand')
assert.match(webApi, /async function syncUnlockedOfflineOutbox[\s\S]*const offlineDb = await getOfflineDb\(\)[\s\S]*offlineDb\.sync_outbox/, 'offline outbox sync should load local DB on demand')
assert.match(webApi, /if \(url\) \{[\s\S]*setSyncServerUrl\(url\)[\s\S]*if \(hasStoredUserSession\(\)\) \{[\s\S]*ensureSessionRecoveryListeners\(\)[\s\S]*scheduleConnectWS\(\)[\s\S]*startHealthCheck\(\)[\s\S]*scheduleInitialOfflineMaintenance\(\)/, 'web API bootstrap should start recovery loops only when a stored session exists and delay the first websocket connect')
assert.doesNotMatch(webApi, /startHealthCheck\(\)[^\n]*\n\s*runOfflineMaintenance\(\)/, 'web API bootstrap should not run offline maintenance synchronously')
assert.match(appContext, /getAppApi\(\)\.ensureSessionRecoveryListeners\?\.\(\)[\s\S]*reconnectWS\(\)[\s\S]*startHealthCheck\(\)/, 'successful login should install recovery listeners before reconnecting websocket and health checks')
assert.match(appContext, /if \(hasStoredSession && canProbeServerSession\) return false[\s\S]*if \(hasStoredSession\) return true/, 'stored sessions should wait for bootstrap validation before authenticated startup warmups run')
assert.match(appContext, /if \(hasStoredSession && canProbeServerSession\) return false[\s\S]*if \(hasStoredSession\) return true[\s\S]*if \(canProbeServerSession\) return false/, 'cookie-only startup should keep the secure shell visible while bootstrap confirms or rejects the server session')
assert.doesNotMatch(appContext, /if \(canProbeServerSession\) \{[\s\S]*if \(!hasStoredSession\) \{\s*setAuthReady\(true\)\s*loadSettings\(\)\.catch\(\(\) => \{\}\)\s*\}/, 'cookie-only startup should not mount the sign-in route before bootstrap has checked the server session')
assert.doesNotMatch(appContext, /if \(canProbeServerSession\) return true/, 'server-session probing should not mark auth ready before bootstrap has confirmed or rejected the cookie session')
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
assert.doesNotMatch(dashboard, /import LineChart from '\.\/charts\/LineChart'|import DonutChart from '\.\/charts\/DonutChart'/, 'Dashboard first paint should not wait for line or donut chart modules')
assert.match(dashboard, /const BarChart = lazyRetry\(\(\) => import\('\.\/charts\/BarChart'\), 'dashboard-bar-chart'\)/, 'inactive Dashboard volume chart should lazy-load instead of joining first-paint chart code')
assert.match(dashboard, /const LineChart = lazyRetry\(\(\) => import\('\.\/charts\/LineChart'\), 'dashboard-line-chart'\)/, 'Dashboard line charts should lazy-load inside the chart panel instead of blocking the route module')
assert.match(dashboard, /const DonutChart = lazyRetry\(\(\) => import\('\.\/charts\/DonutChart'\), 'dashboard-donut-chart'\)/, 'Dashboard payment donut should lazy-load inside the payment panel instead of blocking the route module')
assert.match(dashboard, /function ChartFallback/, 'Dashboard chart Suspense fallback should be local and lightweight')
assert.doesNotMatch(dashboardChartNoData, /AppContext|useApp/, 'dashboard chart empty states should not import AppContext and pull auth/bootstrap code into the chart chunk')
assert.match(dashboard, /lucide-react\/dist\/esm\/icons\/layout-dashboard\.js/, 'Dashboard should use direct Lucide icon modules instead of the app-wide barrel')
assert.doesNotMatch(dashboard, /Upload \} from 'lucide-react'/, 'Dashboard should not keep unused startup icon imports')
// Preset chips were removed from Dashboard. The remaining Today label still
// uses the guarded translation fallback, and the retired labels must not leave
// hidden controls behind.
assert.match(dashboard, /translateOr\('range_today', 'Today'/, 'Dashboard Today label should use a guarded translation fallback')
assert.doesNotMatch(dashboard, /RANGE_PRESETS|range_7d|range_this_month|range_this_year|range_custom/, 'Dashboard should not retain the removed preset-chip implementation')
// These labels now live in separate reusable dashboard cards after the
// requested card-order changes. Check each guarded translation directly;
// requiring a source-order relationship between cards would make this test
// fail on a harmless extraction/reorder while the user-visible contract is
// still fully satisfied.
// (The 'Range:' range-box label was intentionally dropped — Dashboard.tsx commit
// 7565fed7 "rectangular range box, drop the 'Range:' label" — so there is no
// period_label to guard any more; the assertion for it was removed. Line below's
// doesNotMatch still keeps period_label from being rendered as a raw t() key.)
assert.match(dashboard, /translateOr\('payment_method', 'Payment Method'/, 'Dashboard payment-method label should use a guarded translation')
assert.match(dashboard, /translateOr\('no_data', 'No data found'/, 'Dashboard empty states should use guarded translations')
assert.doesNotMatch(dashboard, /t\('(range_today|period_label|payment_method|no_data)'\)/, 'Dashboard should not render raw translation keys for visible range, payment, or empty-state labels')

assert.match(inventory, /inventory-history-row/, 'inventory history controls should live on their own row')
assert.doesNotMatch(inventory, /<ActionHistoryBar history=\{actionHistory\} className="shrink-0"/, 'inventory filter/search row should not contain inline ActionHistoryBar')
// Bound widened from 160: Inventory's history row now also inline-renders
// the Import button and (Products/RFID tabs only) the conditional Export
// menu ahead of ActionHistoryBar -- part of this session's sec-6 toolbar
// consolidation (Import/Export/History merged into one row). Actual gap is
// ~850 chars; 1200 leaves headroom without being unbounded.
assert.match(inventory, /inventory-history-row[\s\S]{0,1200}<ActionHistoryBar/, 'inventory history controls should render inside the dedicated history row')
assert.doesNotMatch(inventory, /INVENTORY_HISTORY_READY_DELAY_MS|window\.setTimeout\(\(\) => \{\s*setHistoryReady\(true\)/, 'Inventory background history should not add a fixed post-load delay')
assert.match(inventory, /const \[historyReady, setHistoryReady\] = useState\(false\)/, 'Inventory should have an explicit post-ready action-history gate')
assert.match(inventory, /useActionHistory\(\{ limit: 10, notify, scope: 'inventory', enabled: historyReady, user \}\)/, 'Inventory should not fetch server action history during first route load and should pass user without importing AppContext inside the hook')
assert.match(inventory, /if \(!loadedOnceRef\.current \|\| loading\) return undefined[\s\S]*setHistoryReady\(true\)[\s\S]*return undefined/, 'Inventory should enable history immediately after the first inventory data load settles')
assert.doesNotMatch(inventory, /loading_inventory_products/, 'Inventory products surface should not show a route-subchunk loading placeholder after data is available')
assert.doesNotMatch(inventory, /setTimeout\(\(\) => setInitialInventoryMobileFullListReady\(true\), 140\)/, 'Inventory mobile product data should not be held behind a fixed visual reveal delay')
assert.doesNotMatch(viteConfig, /inventory:\s*\[[\s\S]*'InventoryProductsSurface'/, 'Inventory products surface should not be a separate eager preload request')
assert.match(viteConfig, /inventory:\s*\[\s*'Inventory',\s*'inventory-api',\s*'product-shared',\s*'shared-ui',\s*\]/, 'Inventory route preloads should stay focused on first-paint route/read/display chunks')
// Link-preload-hint feature not ported to Cloudflare -- see the viteConfig-loading comment near line 34 above (confirmed: no Link/preload header equivalent exists anywhere in cloudflare/src).
assert.match(inventory, /const InventoryStockModals = lazyRetry\(\(\) => import\('\.\/InventoryStockModals'\), 'inventory-stock-modals'\) as any/, 'Inventory stock modals should stay in a click-only lazy chunk')
assert.doesNotMatch(inventory, /<h2 className="font-bold text-gray-900 dark:text-white">\{t\('adjust_stock'\)\}<\/h2>/, 'Inventory should not keep stock adjust modal markup in the first route chunk')
assert.match(inventoryStockModals, /export default function InventoryStockModals/, 'Inventory stock modal markup should live in the lazy stock modal component')
assert.doesNotMatch(inventory, /<h2 className="font-bold text-gray-900 dark:text-white">\{tr\('inventory_batch_session', 'Batch session'\)\}<\/h2>/, 'Inventory should not keep batch session modal markup in the first route chunk')
assert.match(inventory, /const InventoryReasonManagerModal = lazyRetry\(\(\) => import\('\.\/InventoryReasonManagerModal'\), 'inventory-reason-manager-modal'\) as any/, 'Inventory saved-reasons manager should stay in a click-only lazy chunk')
assert.doesNotMatch(inventory, /<h2 className="font-bold text-gray-900 dark:text-white">\{tr\('saved_reasons', 'Saved reasons'\)\}<\/h2>/, 'Inventory should not keep saved-reasons manager markup in the first route chunk')
assert.match(inventoryReasonManagerModal, /export default function InventoryReasonManagerModal/, 'Inventory saved-reasons manager markup should live in the lazy reason manager component')
// The stat-tile -> detail-modal pattern is gone: the StatsStrip rollout
// (455ea3c9) replaced it with fold-open cards, and statsStrip.test.ts pins
// that Inventory never references InventoryStatDetailModal again. The
// absence guards below stay so the old markup can't creep back into the
// first route chunk.
assert.doesNotMatch(inventory, /statDetail\.detailSections|statDetail\.details/, 'Inventory should not keep stat detail modal markup in the first route chunk')
assert.doesNotMatch(inventory, /lucide-react\/dist\/esm\/icons\/x\.js/, 'Inventory should not import the close icon just for lazy modal chrome')
assert.doesNotMatch(sales, /SALES_HISTORY_READY_DELAY_MS|window\.setTimeout\(\(\) => \{\s*setHistoryReady\(true\)/, 'Sales background history should not add a fixed post-load delay')
assert.match(sales, /const \[historyReady, setHistoryReady\] = useState\(false\)/, 'Sales should have an explicit post-ready action-history gate')
assert.match(sales, /useActionHistory\(\{ limit: 3, notify, enabled: historyReady, user \}\)/, 'Sales should not fetch server action history during first route load')
assert.match(sales, /if \(!loadedOnceRef\.current \|\| loading\) return undefined[\s\S]*setHistoryReady\(true\)[\s\S]*return undefined/, 'Sales should enable history immediately after the first sales data load settles')
assert.match(sales, /const pendingLoadRef = useRef<\{ silent: boolean \} \| null>\(null\)/, 'Sales should retain one trailing load when filters change during an in-flight request')
assert.match(sales, /if \(loadPromiseRef\.current\) \{[\s\S]{0,350}pendingLoadRef\.current = pending[\s\S]{0,100}return loadPromiseRef\.current/, 'Sales should queue the latest filter/search request instead of dropping it behind the current request')
assert.match(sales, /const pending = pendingLoadRef\.current[\s\S]{0,350}queueMicrotask\([\s\S]{0,250}latestLoadRef\.current \|\| loadSales/, 'Sales should dispatch the queued request with the latest callback after the current request settles')
assert.match(salesTransport, /`sales:stats:\$\{query\}`/, 'Sales aggregate cache keys must include the active search/date/status query')
assert.match(sales, /const salesStatsRequestRef = useRef\(0\)[\s\S]*beginTrackedRequest\(salesStatsRequestRef\)[\s\S]*isTrackedRequestCurrent\(salesStatsRequestRef, requestId\)/, 'Sales aggregate responses must not let a slower previous filter overwrite the latest result')
assert.doesNotMatch(returns, /RETURNS_HISTORY_READY_DELAY_MS|window\.setTimeout\(\(\) => \{\s*setHistoryReady\(true\)/, 'Returns background history should not add a fixed post-load delay')
assert.match(returns, /const \[historyReady, setHistoryReady\] = useState\(false\)/, 'Returns should have an explicit post-ready action-history gate')
assert.match(returns, /useActionHistory\(\{ limit: 8, notify, scope: 'returns', enabled: historyReady, user \}\)/, 'Returns should not fetch server action history during first route load')
assert.match(returns, /if \(!loadedOnceRef\.current \|\| loading\) return undefined[\s\S]*setHistoryReady\(true\)[\s\S]*return undefined/, 'Returns should enable history immediately after the first returns data load settles')
assert.doesNotMatch(products, /PRODUCTS_HISTORY_READY_DELAY_MS|window\.setTimeout\(\(\) => \{\s*setHistoryReady\(true\)/, 'Products background history should not add a fixed post-load delay')
assert.match(products, /const \[historyReady, setHistoryReady\] = useState\(false\)/, 'Products should have an explicit post-ready action-history gate')
assert.match(products, /useActionHistory\(\{ limit: 10, notify, scope: 'products', enabled: historyReady, user \}\)/, 'Products should not fetch server action history during first route load')
assert.match(products, /if \(!loadedOnceRef\.current \|\| loading\) return undefined[\s\S]*setHistoryReady\(true\)[\s\S]*return undefined/, 'Products should enable history immediately after the first product data load settles')
assert.match(products, /const ActionHistoryBar = lazyRetry\(\(\) => import\('\.\.\/shared\/ActionHistoryBar'\), 'products-action-history-bar'\)/, 'Products should lazy-load action history chrome after first route-ready work')
assert.doesNotMatch(products, /import ActionHistoryBar from '\.\.\/shared\/ActionHistoryBar'/, 'Products should not statically import action history chrome during first route render')
assert.match(products, /function loadProductWriteHelpers\(\): Promise<[^>]+> \{[\s\S]*import\('\.\/helpers\/productWriteHelpers\.ts'\)/, 'Products should load write-only helper logic on demand')
assert.doesNotMatch(products, /from '\.\/helpers\/productWriteHelpers\.ts'/, 'Products should not statically import write-only helper logic during first route render')

assert.match(backup, /useState<BackupSectionId>\('all'\)/, 'Backup should default to the lightweight overview tab without showing duplicate All and Overview tabs')
assert.match(backup, /BackupOverview/, 'Backup overview should provide lightweight section entry points')
assert.doesNotMatch(backup, /BACKUP_HISTORY_READY_DELAY_MS|window\.setTimeout\(\(\) => \{\s*setHistoryReady\(true\)/, 'Backup background history should not add a fixed post-load delay')
assert.match(backup, /const \[historyReady, setHistoryReady\] = useState\(false\)/, 'Backup should have an explicit post-ready action-history gate')
assert.match(backup, /useActionHistory\(\{ limit: 3, notify, scope: 'backup', enabled: historyReady, user \}\)/, 'Backup should not fetch server action history during first route load')
assert.match(backup, /if \(!isActive\) \{[\s\S]*setHistoryReady\(false\)[\s\S]*setHistoryReady\(true\)[\s\S]*return undefined/, 'Backup should enable history immediately after the overview has rendered')
assert.doesNotMatch(backup, /import \{ ResetData, FactoryReset \} from '\.\/ResetData'/, 'Backup should not statically import destructive reset tools during normal backup route load')
assert.match(backup, /const LazyResetData = lazyRetry\(async \(\) => \{[\s\S]*await import\('\.\/ResetData'\)[\s\S]*module\.ResetData/, 'Backup should load reset tools only when advanced maintenance is opened')
assert.match(backup, /const LazyFactoryReset = lazyRetry\(async \(\) => \{[\s\S]*await import\('\.\/ResetData'\)[\s\S]*module\.FactoryReset/, 'Backup should load factory reset only when advanced maintenance is opened')
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
// Membership numbers are minted by the SERVER (cloudflare/src/lib/
// membershipNumber.ts): the house format is LC-#####, and the sequence
// gap-fills, so the next number is only knowable from the database. The form
// used to pre-fill a browser-invented random LCMN- number, which -- because
// the create route only mints when the submitted field is blank -- always won
// over the real sequence. It must never compose one again.
assert.doesNotMatch(customerFormModal, /generateCustomerMembershipNumber/, 'the customer form must not compose a membership number in the browser')
assert.doesNotMatch(customerMembershipNumber, /export function generateCustomerMembershipNumber/, 'the membership helper must not mint numbers -- display and validation only')
assert.match(customerMembershipNumber, /const CUSTOMER_MEMBERSHIP_PREFIX = 'LC'/, 'customer membership helper should carry the LC- house prefix')
assert.match(customerFormModal, /CUSTOMER_MEMBERSHIP_PLACEHOLDER/, 'customer form should show the house format as a placeholder')
assert.match(customerFormModal, /membership_number_auto_hint/, 'the add-customer form should say the number is assigned on save')
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
  assert.match(source, /<SearchInput\b/, `${name} contacts should use the shared SearchInput component`)
  assert.match(source + searchInputComponent, /autoComplete=/, `${name} contacts should define autocomplete hints`)
  assert.match(source, /buildSelectedSnapshots\([^,]+, ids\)/, `${name} contacts should snapshot bulk selections through the shared Set helper`)
  // Customers moved sort/grouping onto the SortChip (unified listSort), so
  // its badge counts only true filters; Suppliers/Delivery still carry the
  // in-menu sort+group flags until their own rollout.
  // Order/extra flags differ per tab (Customers moved sort onto SortChip;
  // Suppliers/Delivery still carry in-menu sort+group), so match year+month+
  // gender in the countActiveFlags call without pinning the exact tail.
  assert.match(source, /countActiveFlags\(\[yearFilter !== 'all', monthFilter !== 'all'[^\]]*genderFilter !== 'all'[^\]]*\]\)/, `${name} contacts should count active filters without temporary filtered arrays`)
  assert.match(source, /const failedIdSet = new Set\(failedIds\)/, `${name} contacts should reuse a failed-id Set when filtering deleted snapshots`)
  assert.doesNotMatch(source, /_HISTORY_READY_DELAY_MS|window\.setTimeout\(\(\) => \{\s*setHistoryReady\(true\)/, `${name} contacts should not add a fixed post-load history delay`)
  assert.match(source, /const \[historyReady, setHistoryReady\] = useState\(false\)/, `${name} contacts should have an explicit post-ready action-history gate`)
  assert.match(source, /useActionHistory\(\{ limit: 3, notify, enabled: historyReady, user \}\)/, `${name} contacts should not fetch server action history during first contact data load`)
  assert.match(source, /if \(!loadedOnceRef\.current \|\| loading\) return undefined[\s\S]*setHistoryReady\(true\)[\s\S]*return undefined/, `${name} contacts should enable history immediately after the first contact data load settles`)
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
assert.match(settingsTransport, /const settingsResponse = asSettingsPayload\(await apiFetch\('GET', '\/api\/settings'\)\)/, 'settings transport reads should use the inline updatedAt returned by /api/settings')
assert.match(apiMethods, /function loadSettingsTransport\(\) \{[\s\S]*import\('\.\/settingsTransport\.ts'\)/, 'legacy API registry should lazy-load the typed settings transport')
assert.doesNotMatch(apiMethods, /const settingsResponse = await apiFetch\('GET', '\/api\/settings'\)/, 'legacy API registry should not duplicate typed settings read logic')
assert.doesNotMatch(`${apiMethods}\n${settingsTransport}`, /apiFetch\('GET', '\/api\/settings\/meta'\)/, 'settings reads should not request /api/settings/meta as a startup waterfall')
assert.match(products, /const branchesById = useMemo\(\(\) => new Map\(/, 'products should index branch rows used by bulk branch moves')
assert.match(products, /branchesById\.get\(String\(branchId\)\)/, 'products bulk branch moves should resolve target branch from the indexed branch map')
assert.match(products, /const latestProductsById = buildProductIdMap\(latestProducts \|\| \[\]\)/, 'products save and variant history should index fresh product snapshots')
assert.match(products, /latestProductsById\.get\(targetProductId\)/, 'products save history should read fresh snapshots from the indexed map')
assert.match(products, /latestProductsById\.get\(createdProductId\)/, 'products variant history should read fresh snapshots from the indexed map')
assert.match(
  backgroundImportTracker,
  /const IMPORT_TRACKER_PREFLIGHT_TIMEOUT_MS = 50000/,
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
  /const IMPORT_TRACKER_APPROVE_TIMEOUT_MS = 50000/,
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
// Loosened for the confirmStockActions options argument (stock-action jobs
// carry an explicit confirm flag on approve) and the comment lines the call
// now carries -- the pinned intent is unchanged: the approve call runs under
// withLoaderTimeout with the approve-specific timeout.
assert.match(
  backgroundImportTracker,
  /\(\) => api\.approveImportJob\(action\.jobId[^\n]*\),\s*'Approve import job',\s*IMPORT_TRACKER_APPROVE_TIMEOUT_MS,\s*\)/,
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
  /const ACTION_HISTORY_INITIAL_READ_DELAY_MS = 2500/,
  'passive action-history reads should wait until after primary route paint',
)
assert.match(
  actionHistory,
  /requestIdleCallback\(task,\s*\{\s*timeout:\s*ACTION_HISTORY_IDLE_TIMEOUT_MS\s*\}/,
  'passive action-history reads should use idle scheduling instead of competing with first paint',
)
assert.match(
  actionHistory,
  /scheduleActionHistoryRead\(\(\) => \{[\s\S]*refreshServerItems\(\)/,
  'initial server history refresh should use the post-paint scheduler',
)
assert.match(
  actionHistory,
  /scheduleActionHistoryRead\(\(\) => \{[\s\S]*getActionHistoryUsers/,
  'initial action-history user lookup should use the post-paint scheduler',
)
assert.match(
  actionHistory,
  /withLoaderTimeout\(\s*async \(\) => \(await loadActionHistoryTransport\(\)\)\.getActionHistory\(scope, Math\.max\(3, limit\), \{[\s\S]*'Action history',\s*ACTION_HISTORY_LOAD_TIMEOUT_MS,\s*\)/,
  'action history server reads should timeout slow history requests',
)
assert.match(
  actionHistory,
  /if \(!isTrackedRequestCurrent\(historyRequestRef, requestId\)\) return[\s\S]*const record = result as \{ items\?: ServerHistoryItem\[\] \} \| null[\s\S]*const items = Array\.isArray\(record\?\.items\) \? record\.items : \[\][\s\S]*setServerItems\(items\)/,
  'action history should ignore stale history responses before updating rows',
)
assert.match(
  actionHistory,
  /if \(!isAdmin \|\| userFilter === 'all'\) writeCachedServerItems\(scope, items\)/,
  'action history should cache only the unfiltered default view so a per-user admin filter never leaks into the next mount\'s instant-paint cache',
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
  /import \{ getNotificationSummary as getNotificationSummaryRequest \} from '\.\.\/\.\.\/api\/notificationSummary\.ts'[\s\S]*withLoaderTimeout\(\s*\(\) => getNotificationSummaryRequest\(\) as Promise<Partial<NotificationSummary>>,\s*'Notifications',\s*NOTIFICATION_SUMMARY_TIMEOUT_MS,\s*\)/,
  'notification center should use the focused notification summary transport with a slow-read timeout',
)
assert.match(
  notificationCenter,
  /const visibleLoadRequestRef = useRef\(0\)[\s\S]*const visibleRequestId = !silent && aliveRef\.current \? beginTrackedRequest\(visibleLoadRequestRef\) : 0[\s\S]*isTrackedRequestCurrent\(visibleLoadRequestRef, visibleRequestId\)[\s\S]*invalidateTrackedRequest\(visibleLoadRequestRef\)/,
  'notification center should keep visible loading state separate from silent background refresh request tracking',
)
assert.doesNotMatch(
  notificationCenter,
  /getNotificationApi|window\.api|api\.getNotificationSummary/,
  'notification center should not wake the broad window.api registry for summary reads',
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
assert.match(
  dashboard,
  /type DashboardExportModule = typeof import\('\.\/dashboardExport\.ts'\)[\s\S]*dashboardExportModulePromiseRef[\s\S]*import\('\.\/dashboardExport\.ts'\)/,
  'dashboard should load export row and report assembly only after export intent',
)
assert.doesNotMatch(
  dashboard,
  /buildDashboardKpiRows|buildDashboardFormulaRows|buildDashboardSalesRows|buildDashboardTopCustomerRows|buildStandaloneReportHtml|buildReportPackageFiles/,
  'dashboard route should not carry export-only row/report assembly in the live route chunk',
)
assert.match(
  dashboardExport,
  /export function exportDashboardFull[\s\S]*export function exportDashboardStats[\s\S]*export async function exportDashboardPackage/,
  'dashboard export chunk should own full CSV, stats CSV, and ZIP report assembly',
)
assert.match(
  dashboardExport,
  /formatPriceNumber/,
  'dashboard export chunk should own export-only price formatting',
)
assert.match(
  viteConfig,
  /'assets\/dashboard-export-',/,
  'dashboard export chunk should be excluded from eager modulepreload',
)
assert.match(
  viteConfig,
  /normalized\.endsWith\('\/src\/components\/dashboard\/dashboardExport\.ts'\)\) return 'dashboard-export'/,
  'dashboard export assembly should have a named intent chunk',
)
assert.doesNotMatch(
  dashboard,
  /\(window as unknown as \{ api: DashboardApi \}\)\.api/,
  'dashboard startup should not load the full legacy API registry just to read summary data',
)
assert.match(
  dashboard,
  /withLoaderTimeout\([\s\S]{0,180}getDashboardApi\(\)\.getDashboard\(\{ startDate: start, endDate: end, granularity \}\)[\s\S]{0,80}DASHBOARD_SUMMARY_TIMEOUT_MS/,
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
// The aggregate branchSummary read (and its BRANCHES_SUMMARY_TIMEOUT_MS) was
// removed with the Branches / Items / Value stat cards it fed (user, Aug 29:
// "remove the stats above the branches/transfers section"), so it no longer
// has a loader or timeout constant to assert.
assert.match(
  branches,
  /const BRANCH_TRANSFERS_TIMEOUT_MS = 12000/,
  'branch transfers should use an explicit timeout constant',
)
assert.match(
  branches,
  /const \[historyReady, setHistoryReady\] = useState\(false\)/,
  'Branches should have an explicit post-ready action-history gate',
)
assert.match(
  branches,
  /import \{[\s\S]*getBranches as getBranchesRequest,[\s\S]*getTransfers as getTransfersRequest,[\s\S]*\} from '\.\.\/\.\.\/api\/branchTransport\.ts'/,
  'Branches route should use the focused branch transport instead of the full API registry',
)
assert.doesNotMatch(
  branches,
  /window(?: as [^)]+)?\.api|getAppApi\(|import\('\.\.\/\.\.\/api\/methods\.ts'\)/,
  'Branches route should not bind to window.api or lazy-load the full API registry during startup',
)
assert.match(
  branches,
  /const LazyTransferModal = lazyRetry\(async \(\) => \(\{ default: \(await import\('\.\/TransferModal'\)\)\.default \}\), 'branches-transfer-modal'\)/,
  'Branches route should lazy-load the transfer modal only after transfer intent',
)
assert.doesNotMatch(branches, /BRANCHES_HISTORY_READY_DELAY_MS|window\.setTimeout\(\(\) => \{\s*setHistoryReady\(true\)/, 'Branches background history should not add a fixed post-load delay')
assert.match(
  branches,
  /useActionHistory\(\{ limit: 3, notify, enabled: historyReady, user \}\)/,
  'Branches should not fetch server action history during first route load',
)
assert.match(
  branches,
  /if \(!loadedOnceRef\.current \|\| loading\) return undefined[\s\S]*setHistoryReady\(true\)[\s\S]*return undefined/,
  'Branches should enable history immediately after the first branch data load settles',
)
assert.match(
  branches,
  /withLoaderTimeout\(\s*\(\) => branchApi\.getBranches\(\),\s*'Branches list',\s*BRANCHES_LIST_TIMEOUT_MS,\s*\)/,
  'branches list should timeout slow reads',
)
// branchSummary loader removed with the stat cards (see the note above).
assert.match(
  branches,
  /withLoaderTimeout\(\s*\(\) => branchApi\.getTransfers\(\{[\s\S]*?startDate:[\s\S]*?endDate:[\s\S]*?\}\),\s*'Branch transfers',\s*BRANCH_TRANSFERS_TIMEOUT_MS,\s*\)/,
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
  /import \{[\s\S]*getBranchStock as getBranchStockRequest,[\s\S]*transferStock as transferStockRequest,[\s\S]*\} from '\.\.\/\.\.\/api\/branchTransport\.ts'/,
  'transfer stock modal should use focused branch transport calls',
)
assert.doesNotMatch(
  transferModal,
  /window(?: as [^)]+)?\.api|getAppApi\(|import\('\.\.\/\.\.\/api\/methods\.ts'\)/,
  'transfer stock modal should not load the full API registry after transfer intent',
)
assert.match(
  transferModal,
  /getTransferApi\(\)\.getBranchStock\(Number\.parseInt\(fromBranch, 10\), \{[\s\S]{0,160}page: 1,[\s\S]{0,120}pageSize: TRANSFER_STOCK_PAGE_SIZE,[\s\S]{0,120}stockState: 'positive'/,
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
  /import \{ getSales as fetchSales, getSalesStats as fetchSalesStats, getSalesStatsStrip \} from '\.\.\/\.\.\/api\/salesTransport\.ts'[\s\S]*import \{ getUsers as fetchUsers \} from '\.\.\/\.\.\/api\/userReadTransport\.ts'/,
  'sales route-start reads should use focused sales and user transports instead of app-api-methods',
)
assert.match(
  sales,
  /withLoaderTimeout\(\(\) => fetchSales\(params\), 'Sales', 20000\)/,
  'sales list should timeout slow reads through the focused sales transport',
)
assert.match(
  sales,
  /withLoaderTimeout\(\(\) => fetchUsers\(\), 'Sales user filters', SALES_USER_OPTIONS_TIMEOUT_MS\)/,
  'sales user filter options should timeout slow user reads through the focused user transport',
)
assert.doesNotMatch(
  sales,
  /getSalesApi\(\)\.(?:getSales|getUsers)\(/,
  'sales route-start reads should not wake the broad app-api-methods registry',
)
assert.doesNotMatch(
  sales,
  /withLoaderTimeout\(\(\) => fetchUsers\(\), 'Sales user filters'[\s\S]{0,260}catch\(\(\) => \{[\s\S]{0,180}setUserOptions\(\[\]\)/,
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
// Sort left the Filters badge when it moved onto the visible SortChip
// (unified listSort method) -- the count now covers only true filters.
// Re-anchored (Part 562): group-by-status left Sales in Part 549, so the
// count's last member is now the non-default sort, not salesGroupMode.
assert.match(
  sales,
  /countActiveFlags\(\[statusFilter !== 'all'[\s\S]*salesSortSpec\.direction === 'desc'\)\]\)/,
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
  /withLoaderTimeout\(\s*\(\) => api\.getSalesExport\(\{ startDate: dates\.start, endDate: dates\.end, detailsOnly: 'true', pageSize: '500' \}\),\s*'Sales export CSV',\s*SALES_EXPORT_CSV_TIMEOUT_MS,\s*\)/,
  'sales CSV export should timeout slow CSV reads (first page)',
)
assert.match(
  salesExportModal,
  /while \(page\.has_more\) \{[\s\S]*?withLoaderTimeout\(\s*\(\) => api\.getSalesExport\(\{[\s\S]*?\}\),\s*'Sales export CSV page',\s*SALES_EXPORT_CSV_TIMEOUT_MS,\s*\)/,
  'sales CSV export should timeout slow CSV reads (subsequent cursor-paged pages)',
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
// INVENTORY_PRODUCTS_TIMEOUT_MS left with the products slice (Part 562) --
// the Products PAGE owns the catalog read and its timeout now.
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
// The returns-stats and dashboard-stats secondary fetches left Inventory with
// the StatsStrip rollout (455ea3c9) -- the strip's own range endpoint feeds
// those figures now, so their timeout constants are gone with them. The
// doesNotMatch guards further down keep the old fetch shapes from returning.
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
// The combined product bootstrap + idle metadata read left with the
// products slice (Part 562) -- the Products PAGE owns catalog startup now.
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
  /const defaultTransferDestinationBySourceId = useMemo\(\(\) => \{/,
  'inventory should precompute default transfer destinations instead of scanning branches for every transfer draft',
)
assert.match(
  inventoryExport,
  /scope\.getBranchLabel\(scope\.branchFilter, scope\.branchFilter\)/,
  'inventory export chunk should resolve branch labels through the indexed branch map supplied by Inventory',
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
  /const searchTerms: string\[\] = useMemo\(\(\) => \([\s\S]*\), \[deferredSearch\]\)/,
  'inventory search terms should be memoized so unrelated UI state does not rebuild search arrays',
)
assert.match(
  inventory,
  /const filteredMovements = useMemo\(\(\) => movements\.filter[\s\S]*\), \[hasServerBackedMovementSearch, matchesSearch, movFilter, movementUserFilter, movHay, movements\]\)/,
  'inventory movement filtering should stay memoized before grouped movement rebuilds, including the movement user filter it reads',
)
assert.match(
  inventory,
  /const groupedMovements = useMemo\(\(\) => \{[\s\S]*buildMovementGroups\(filteredMovements\)[\s\S]*\}, \[filteredMovements, hasServerBackedMovementSearch, matchesSearch\]\)/,
  'inventory grouped movements should depend on stable filtered movements and search matcher only',
)
assert.match(
  inventory,
  /const visibleMovementGroupIds = useMemo\(\s*\(\) => new Set\(visibleMovementGroups\.map\(\(group\) => group\.id\)\),\s*\[visibleMovementGroups\],\s*\)/,
  'inventory movement cleanup should reuse a single visible group id index',
)
assert.match(
  inventory,
  /Object\.entries\(current\)\.filter\(\(\[groupId\]\) => visibleMovementGroupIds\.has\(groupId\)\)/,
  'inventory movement page cleanup should use the visible group id index instead of scanning groups per entry',
)
assert.match(
  inventory,
  /const selectedMovementGroups = useMemo\(\s*\(\) => visibleMovementGroups\.filter\(\(group\) => selectedMovementIds\.has\(group\.id\)\),\s*\[selectedMovementIds, visibleMovementGroups\],\s*\)/,
  'inventory selected movement groups should stay memoized for export and movement rendering',
)
assert.doesNotMatch(
  inventory,
  /ids\.map\(\(id\) => Number\(id\)\)\.filter\(\(id\) => Number\.isFinite\(id\)\)/,
  'inventory selection scope should not repeat map/filter id normalization',
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
  /const active = rets\.filter[\s\S]*const customerReturns = active\.filter[\s\S]*const supplierReturns = active\.filter/,
  'inventory return stats should not repeatedly filter the returns list',
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
  /function loadSalesTransport\(\): Promise<SalesTransportModule>[\s\S]*import\('\.\.\/\.\.\/api\/salesTransport\.ts'\)[\s\S]*async function loadSaleById\(saleId: number \| string\): Promise<SaleRow \| null>[\s\S]*getSales\(\{ id: saleId \}\)/,
  'customer return sale read should use the focused sales transport, by exact id, instead of the broad API registry',
)
assert.match(
  newReturnModal,
  /async function lookupReceiptSuggestions\(query: string, limit: number\): Promise<ReceiptSuggestion\[]>[\s\S]*lookupReturnReceipts\(\{ query, limit \}\)/,
  'the receipt typeahead should go through the focused returns-read transport too',
)
assert.match(
  newReturnModal,
  /const RECEIPT_SUGGEST_TIMEOUT_MS = 8000/,
  'the receipt typeahead should use an explicit timeout',
)
assert.match(
  newReturnModal,
  /const RECEIPT_SUGGEST_DEBOUNCE_MS = 250/,
  'the receipt typeahead should be debounced rather than firing a request per keystroke',
)
assert.match(
  newReturnModal,
  /function loadReturnsReadTransport\(\): Promise<ReturnsReadTransportModule>[\s\S]*import\('\.\.\/\.\.\/api\/returnsReadTransport\.ts'\)[\s\S]*async function loadExistingSaleReturns\(saleId: number \| string \| null \| undefined\): Promise<ExistingReturnRow\[]>[\s\S]*getReturns\(\{ saleId \}\)/,
  'customer return history lookup should use the focused return-read transport instead of the broad API registry',
)
assert.match(
  newReturnModal,
  /withLoaderTimeout\(\s*\(\) => loadSaleById\(saleId\),\s*'Return sale search',\s*RETURN_SALE_SEARCH_TIMEOUT_MS,\s*\)/,
  'customer return sale read should timeout slow sales reads',
)
assert.match(
  newReturnModal,
  /withLoaderTimeout\(\s*\(\) => lookupReceiptSuggestions\(query, RECEIPT_SUGGEST_LIMIT\),\s*'Receipt lookup',\s*RECEIPT_SUGGEST_TIMEOUT_MS,\s*\)/,
  'the receipt typeahead should timeout slow lookups',
)
assert.match(
  newReturnModal,
  /withLoaderTimeout\(\s*\(\) => loadExistingSaleReturns\(found\.id\),\s*'Return history lookup',\s*RETURN_HISTORY_LOOKUP_TIMEOUT_MS,\s*\)/,
  'customer return history lookup should timeout slow return history reads',
)
assert.match(
  newReturnModal,
  /async function createReturnRequest\(payload: ReturnCreatePayload\): Promise<unknown>[\s\S]*createReturn\(payload\)[\s\S]*withLoaderTimeout\(\s*\(\) => createReturnRequest\(\{[\s\S]*\}\),\s*'Create return',\s*RETURN_CREATE_TIMEOUT_MS,\s*\)/,
  'customer return create should timeout slow return writes through the focused returns transport',
)
assert.doesNotMatch(
  newReturnModal,
  /getReturnApi|window\.api|api\.(?:getSales|getReturns|createReturn)/,
  'customer return modal should not wake the broad window.api registry for sale search, history, or create paths',
)
assert.match(
  editReturnModal,
  /const RETURN_UPDATE_TIMEOUT_MS = 15000/,
  'customer return update should use an explicit timeout',
)
assert.match(
  editReturnModal,
  /function loadReturnsTransport\(\): Promise<ReturnsTransportModule>[\s\S]*import\('\.\.\/\.\.\/api\/returnsTransport\.ts'\)[\s\S]*async function updateReturnRequest\(id: number \| string, payload: ReturnUpdatePayload\): Promise<unknown>[\s\S]*updateReturn\(id, payload\)/,
  'customer return update should use the focused returns transport instead of the broad API registry',
)
assert.match(
  editReturnModal,
  /const payload: ReturnUpdatePayload = \{[\s\S]*withLoaderTimeout\(\s*\(\) => updateReturnRequest\(ret\.id, payload\),\s*'Update return',\s*RETURN_UPDATE_TIMEOUT_MS,\s*\)/,
  'customer return update should timeout slow return writes through the focused returns transport',
)
assert.doesNotMatch(
  editReturnModal,
  /getReturnApi|window\.api|api\.updateReturn/,
  'edit return modal should not wake the broad window.api registry for update paths',
)
assert.doesNotMatch(
  newReturnModal,
  /getReturns\(\{ saleId: found\.id \}\)\.catch\(\(\) => \[\]\)/,
  'customer return history lookup should not treat failed history reads as no previous returns',
)
// See the removal note near the top of this file (search
// "page-level \"Export All\"") -- these five assertions used to check the
// same removed Contacts.tsx export-all machinery from the timeout/paging
// angle. No longer applicable; superseded by the doesNotMatch check above.
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
  /import \{ getCustomers as getLoyaltyCustomers \} from '\.\.\/\.\.\/api\/contactReadTransport\.ts'/,
  'loyalty customer points should use the focused contact read transport instead of the broad window.api registry',
)
assert.match(
  loyaltyPointsPage,
  /let portalTransportPromise: Promise<PortalTransportModule> \| null = null[\s\S]*function getPortalTransport\(\): Promise<PortalTransportModule> \{[\s\S]*import\('\.\.\/\.\.\/api\/portalTransport\.ts'\)/,
  'loyalty membership lookup should lazy-load the focused portal transport only after lookup intent',
)
assert.doesNotMatch(
  loyaltyPointsPage,
  /window\.api|getLoyaltyApi\(|import\('\.\.\/\.\.\/api\/methods\.ts'\)/,
  'loyalty points should not wake the broad API registry for customer points or membership lookup',
)
assert.match(
  loyaltyPointsPage,
  /withLoaderTimeout\(\(\) => getLoyaltyCustomers\(\), label, LOYALTY_CUSTOMER_POINTS_TIMEOUT_MS\)/,
  'loyalty customer points should timeout slow customer reads',
)
assert.match(
  loyaltyPointsPage,
  /withLoaderTimeout\(\s*\(\) => lookupLoyaltyPortalMembership\(value\),\s*'Loyalty membership lookup',\s*LOYALTY_MEMBERSHIP_LOOKUP_TIMEOUT_MS,\s*\)/,
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
  /getReturn as fetchReturnDetail[\s\S]*getReturns as fetchReturns[\s\S]*from '\.\.\/\.\.\/api\/returnsReadTransport\.ts'[\s\S]*function loadReturnsWriteTransport\(\): Promise<ReturnsWriteTransportModule>[\s\S]*import\('\.\.\/\.\.\/api\/returnsTransport\.ts'\)/,
  'returns list/detail reads should use the read transport while restore writes stay lazy',
)
assert.match(
  returns,
  /withLoaderTimeout\(\(\) => fetchReturns\(params\), 'Returns', RETURNS_LOAD_TIMEOUT_MS\)/,
  'returns list should timeout slow return reads with the focused transport and explicit constant',
)
assert.doesNotMatch(
  returns,
  /getReturnApi\(\)\.getReturns\(/,
  'returns route-start reads should not wake the broad app-api-methods registry',
)
assert.match(
  returns,
  /withLoaderTimeout\(\s*\(\) => fetchReturnDetail\(ret\.id\),\s*'Return details',\s*RETURNS_DETAIL_TIMEOUT_MS,\s*\)/,
  'return details should timeout slow detail reads',
)
assert.match(
  returns,
  /withLoaderTimeout\(\s*\(\) => fetchReturnDetail\(numericId\),\s*'Return snapshot',\s*RETURNS_SNAPSHOT_TIMEOUT_MS,\s*\)/,
  'return snapshot should timeout slow history snapshot reads',
)
assert.match(
  returns,
  /withLoaderTimeout\(\s*\(\) => updateReturnRequest\(snapshot\.id as number \| string, \{[\s\S]*\}\),\s*'Restore return snapshot',\s*RETURNS_HISTORY_RESTORE_TIMEOUT_MS,\s*\)/,
  'return history undo/redo restore should timeout slow return writes',
)
assert.doesNotMatch(
  returns,
  /getReturnApi|window\.api|api\.(?:getReturn|updateReturn)/,
  'returns details and history restore should not wake the broad window.api registry',
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
  /const returnScopeSummary = useMemo\(\(\) => \{[\s\S]{0,200}for \(const ret of searchFiltered\)[\s\S]{0,200}summary\.supplierRows\.push\(ret\)[\s\S]{0,100}summary\.customerRows\.push\(ret\)/,
  'returns stats should split customer/supplier rows and totals in one pass, from the search-only (not type-filtered) view so switching the type filter does not zero out the other stat tiles',
)
// Sort moved onto the SortChip (unified listSort), so the badge counts only
// true filters now -- direction is no longer one of them, and neither is
// scope (customer vs supplier is a mandatory one-of-two VIEW with no
// neutral, so being on the supplier view must not light up "Filters (1)").
// year/month moved into the always-visible StatsRangeRow (no longer in-menu
// filters), so the badge now counts only the true menu filters: type + group.
assert.match(
  returns,
  /countActiveFlags\(\[typeFilter !== 'all', returnGroupMode !== 'time'\]\)/,
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
assert.doesNotMatch(
  catalogPage,
  /getPortalSubmissionsForReview/,
  'catalog page should not reintroduce portal review-item reads that moved to LoyaltyPointsPage',
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
// Portal-submission review (approve/reject queue) is read on
// LoyaltyPointsPage.tsx now, not CatalogPage.tsx -- see the actionStability
// test's "loyalty portal submission review" block for the write side of
// this same move. It reuses LOYALTY_MEMBERSHIP_LOOKUP_TIMEOUT_MS rather than
// a dedicated timeout constant.
assert.match(
  loyaltyPointsPage,
  /async function fetchPortalReviewItems\(\): Promise<unknown> \{[\s\S]*getPortalSubmissionsForReview\(\)/,
  'loyalty page portal review items should read via the portal transport module',
)
assert.match(
  loyaltyPointsPage,
  /withLoaderTimeout\(\(\) => fetchPortalReviewItems\(\), label, LOYALTY_MEMBERSHIP_LOOKUP_TIMEOUT_MS\)/,
  'loyalty page portal review items should timeout slow review reads',
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
// (Portal favicon generation removed with the custom-favicon feature -- see
// the doesNotMatch guard near the public-bootstrap assertions above.)
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
// CATALOG_PORTAL_REVIEW_TIMEOUT_MS / reviewPortalSubmission: this page no
// longer owns portal-submission review (approve/reject) -- it moved to
// LoyaltyPointsPage.tsx, which reuses LOYALTY_MEMBERSHIP_LOOKUP_TIMEOUT_MS
// instead of a dedicated constant. See the read-side assertion above
// (catalog portal editor helper reads) and actionStability.test.ts's
// "loyalty portal submission review" block for the current location.
assert.doesNotMatch(
  catalogPage,
  /CATALOG_PORTAL_REVIEW_TIMEOUT_MS|reviewPortalSubmission/,
  'catalog page should not reintroduce portal-submission review actions that moved to LoyaltyPointsPage',
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
  loyaltyPointsPage,
  /withLoaderTimeout\(\s*\(\) => submitPortalReview\(item\.id, \{[\s\S]*reward_points: Number\(item\.reward_points \|\| 0\),[\s\S]*\}\),\s*'Review portal submission',\s*LOYALTY_MEMBERSHIP_LOOKUP_TIMEOUT_MS,\s*\)/,
  'loyalty portal reviews should timeout slow review actions',
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
  /const exportReceiptVariant = async \(printTools: ReceiptPrintModule[\s\S]*printTools\.downloadReceiptImage[\s\S]*printTools\.printReceipt[\s\S]*printTools\.openReceiptPdf[\s\S]*const printTools = await loadReceiptPrintModule\(\)[\s\S]*exportReceiptVariant\(printTools/,
  'receipt export actions should use the lazy-loaded print tools for image, print, and PDF flows',
)
assert.match(
  usersPage,
  /const USERS_LIST_TIMEOUT_MS = 8000/,
  'users list should use an explicit timeout constant',
)
assert.match(
  usersPage,
  /from '\.\.\/\.\.\/api\/userAdminTransport\.ts'/,
  'Users route should use the focused user admin transport instead of window.api or the broad access-control transport',
)
assert.doesNotMatch(
  usersPage,
  /window\.api|\(window as [^)]*\)\.api/,
  'Users route should not bind to window.api during route startup',
)
assert.match(
  userAdminTransport,
  /import \{ getUsers as getUsersRequest \} from '\.\/userReadTransport\.ts'/,
  'Users admin transport should reuse the narrow user read transport for the list',
)
assert.match(
  userReadTransport,
  /appendActorQuery\('\/api\/users'\)[\s\S]*const \{ getLocalDb \} = await import\('\.\/lazyLocalDb\.ts'\)/,
  'Users read transport should keep the list read and local fallback narrow',
)
assert.match(
  userAdminTransport,
  /const \{ getLocalDb \} = await import\('\.\/lazyLocalDb\.ts'\)/,
  'Users admin roles fallback should lazy-load local DB only when the server read fallback is needed',
)
assert.match(
  usersPage,
  /const ROLES_LIST_TIMEOUT_MS = 8000/,
  'roles list should use an explicit timeout constant',
)
assert.match(
  usersPage,
  /const USERS_SECONDARY_READ_DELAY_MS = 2500/,
  'Users secondary reads should have a named post-paint delay',
)
assert.match(
  usersPage,
  /window\.requestIdleCallback\(task, \{ timeout: USERS_SECONDARY_READ_IDLE_TIMEOUT_MS \}\)/,
  'Users secondary reads should wait for idle time instead of competing with first paint',
)
assert.match(
  usersPage,
  /if \(tab === 'roles'\) \{[\s\S]*loadRoles\(\{ silent: rolesLoadedOnceRef\.current \}\)[\s\S]*return[\s\S]*rolesSecondaryReadCancelRef\.current = scheduleUsersSecondaryRead\(\(\) => \{[\s\S]*loadRoles\(\{ silent: true \}\)/,
  'Users should defer role reads on the default users tab but load roles immediately on the Roles tab',
)
assert.match(
  usersPage,
  /const \[historyReady, setHistoryReady\] = useState\(false\)/,
  'Users should have an explicit post-ready action-history gate',
)
assert.doesNotMatch(usersPage, /USERS_HISTORY_READY_DELAY_MS|window\.setTimeout\(\(\) => \{\s*setHistoryReady\(true\)/, 'Users background history should not add a fixed post-load delay')
assert.match(
  usersPage,
  /useActionHistory\(\{ limit: 3, notify, enabled: historyReady, user: currentUser \}\)/,
  'Users should not fetch server action history during first route load',
)
assert.match(
  usersPage,
  /if \(!loadedOnceRef\.current \|\| loading\) return undefined[\s\S]*setHistoryReady\(true\)[\s\S]*return undefined/,
  'Users should enable history immediately after the first user data load settles',
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
assert.doesNotMatch(
  usersPage,
  /import (PermissionEditor|UserDetailSheet|UserProfileModal)/,
  'Users route should not statically import action-only profile, detail, or permission editor surfaces',
)
assert.match(
  usersPage,
  /import \{ PERMISSION_DEFS \} from '\.\/permissionDefinitions'/,
  'Users route should keep lightweight permission labels without pulling in the permission editor UI',
)
assert.match(
  usersPage,
  /const LazyPermissionEditor = lazyRetry\(async \(\) => \(\{ default: \(await import\('\.\/PermissionEditor'\)\)\.default \}\), 'users-permission-editor'\)[\s\S]*const LazyUserDetailSheet = lazyRetry\(async \(\) => \(\{ default: \(await import\('\.\/UserDetailSheet'\)\)\.default \}\), 'users-user-detail-sheet'\)[\s\S]*const LazyUserProfileModal = lazyRetry\(async \(\) => \(\{ default: \(await import\('\.\/UserProfileModal'\)\)\.default \}\), 'users-user-profile-modal'\)/,
  'Users action-only surfaces should lazy-load profile, detail, and permission editor UI',
)
assert.match(
  usersPage,
  /<Suspense fallback=\{null\}>\s*<LazyUserDetailSheet[\s\S]*<\/Suspense>/,
  'Users detail sheet should still render behind a Suspense boundary when opened',
)
assert.match(
  usersPage,
  /<Suspense fallback=\{<div className="rounded-xl border border-gray-200 p-3 text-sm text-gray-500 dark:border-zinc-700 dark:text-gray-400">\{tr\('loading', 'Loading\.\.\.'\)\}<\/div>\}>\s*<LazyPermissionEditor/,
  'Users role permission editor should show a bounded fallback while its action-only chunk loads',
)
assert.match(
  usersPage,
  /<Suspense fallback=\{null\}>\s*<LazyUserProfileModal onClose=\{\(\) => setProfileOpen\(false\)\} \/>/,
  'Users profile modal should still render when opened',
)
assert.match(
  userPermissionEditor,
  /from '\.\/permissionDefinitions'/,
  'PermissionEditor should read shared permission metadata from the lightweight definition module',
)
assert.match(
  userDetailSheet,
  /from '\.\/permissionDefinitions'/,
  'UserDetailSheet should read shared permission metadata without importing the permission editor',
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
// AUDIT_LOG_RETENTION_DELETE_TIMEOUT_MS / deleteAuditLogsRetentionRequest:
// the manual "Clear 30d" action this timed no longer exists on this route
// (see the doesNotMatch assertion near line 700 above and the code comment
// in AuditLog.tsx) -- retention is now an automatic server-side sweep.
assert.doesNotMatch(
  auditLog,
  /AUDIT_LOG_RETENTION_DELETE_TIMEOUT_MS|deleteAuditLogsRetentionRequest/,
  'audit log route should not reintroduce timeout machinery for the removed manual retention-clear action',
)
assert.match(
  auditLog,
  /withLoaderTimeout\(\s*\(\) => getAuditLogsRequest\(params\) as Promise<AuditLogResponse \| AuditLogRow\[\]>,\s*'Audit log',\s*AUDIT_LOG_LOAD_TIMEOUT_MS,\s*\)/,
  'audit log should timeout slow audit reads with the explicit constant',
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
  // entityFilter joined the flag list with I2's entity ("page") filter
  // (Part 393); the D2-era one-row date-range control then added
  // Boolean(rangeStart || rangeEnd) -- the pin tracks the current vocabulary.
  /countActiveFlags\(\[yearFilter !== 'all', monthFilter !== 'all', Boolean\(rangeStart \|\| rangeEnd\), actionFilter !== 'all', entityFilter !== 'all', userFilter !== 'all', sortDirection !== 'desc', groupMode !== 'time'\]\)/,
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
assert.match(serverPage, /const SERVER_ONLINE_CHECK_READY_DELAY_MS = 250/, 'server online count should wait briefly after first route-ready work without adding a fake 1.8s delay')
assert.match(serverPage, /window\.setTimeout\(check, SERVER_ONLINE_CHECK_READY_DELAY_MS\)[\s\S]*setInterval\(check, 10000\)/, 'server online count should not issue a duplicate health probe during first route load')
// SETTINGS_OTP_STATUS_TIMEOUT_MS / getSettingsApi().otpStatus: removed along
// with the rest of the dead OTP-modal machinery in Settings.tsx (see the
// doesNotMatch assertion above) -- this page no longer checks OTP status at
// all since 2FA management lives in the profile modal.
assert.doesNotMatch(
  settingsPage,
  /SETTINGS_OTP_STATUS_TIMEOUT_MS|getSettingsApi\(\)\.otpStatus/,
  'Settings should not reintroduce the removed OTP status check',
)
// Settings favicon PREVIEW was removed with the favicon section (§16 /
// 11.15-16): Settings customizes only the admin topbar logo now, and the
// tab/PWA icon is app default -- so there is no favicon preview to time out
// or defer. The consolidated guard below asserts the whole preview path is
// gone.
assert.match(
  settingsPage,
  /const SETTINGS_IMAGE_UPLOAD_TIMEOUT_MS = 30000/,
  'settings image uploads should use an explicit timeout constant',
)
assert.match(
  settingsPage,
  /withLoaderTimeout\(\s*\(\) => getSettingsApi\(\)\.uploadFileAsset\?\.\(\{[\s\S]*signal: controller\.signal,[\s\S]*onProgress: \(\{ percent \}\) => updateUploadState\(key, \{ type: 'progress', progress: percent \}\),[\s\S]*\}\),\s*'Upload settings image',\s*SETTINGS_IMAGE_UPLOAD_TIMEOUT_MS,\s*\)/,
  'settings image uploads should timeout slow file uploads',
)
assert.doesNotMatch(
  settingsPage,
  /createCircularFaviconDataUrl|SETTINGS_FAVICON_PREVIEW_TIMEOUT_MS|SETTINGS_FAVICON_PREVIEW_DELAY_MS|SETTINGS_FAVICON_PREVIEW_IDLE_TIMEOUT_MS/,
  'Settings must not reintroduce any favicon-preview machinery -- the tab/PWA icon is app default and Settings customizes only the topbar logo',
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
// Settings.tsx's own OTP status check + LazyOtpModal were dead leftovers
// from before 2FA management moved to the account/profile modal (the
// security section here now just points users there -- see the
// 'security_moved_to_profile_hint' copy). UserProfileModal.tsx owns the
// live LazyOtpModal render; Settings.tsx should not carry the unused
// state, effect, or lazy import for a modal it never shows.
assert.doesNotMatch(
  settingsPage,
  /otpModal|otpStatus|LazyOtpModal|OtpModalMode|import type \{ OtpModalProps \} from '\.\/OtpModal'/,
  'Settings should not retain dead OTP-modal state/import now that 2FA management lives in the profile modal',
)
assert.match(
  userProfileModal,
  /const LazyOtpModal = lazyRetry\(async \(\) => \(\{/,
  'the profile modal should own the live lazy-loaded OTP modal',
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
// Raised from 60s/90s to a shared 10-minute ceiling to match
// systemRuntime.ts's LONG_SYSTEM_ACTION_TIMEOUT_MS -- see ResetData.tsx's
// own comment for why (a fresh backup + D1 batch delete + per-object R2
// delete loop can legitimately take minutes, not seconds).
assert.match(
  resetData,
  /const RESET_DATA_TIMEOUT_MS = 10 \* 60 \* 1000/,
  'reset data should use an explicit timeout constant',
)
assert.match(
  resetData,
  /const FACTORY_RESET_TIMEOUT_MS = 10 \* 60 \* 1000/,
  'factory reset should use an explicit timeout constant',
)
// Widened from the old exact `resetData\?\.\(mode\)` to
// `resetData\?\.\(mode[\s\S]*?\)` -- the call now also passes the
// mode='products'-only includeMovements/includeSales toggles as a second
// argument (see ResetData.tsx's ProductsResetToggles), same "regex
// updated to accept the extended condition" precedent as
// actionStability.test.ts's matching update.
assert.match(
  resetData,
  /withLoaderTimeout\(\s*\(\) => [\s\S]*resetData\?\.\(mode[\s\S]*?\)[\s\S]*'Reset business data',\s*RESET_DATA_TIMEOUT_MS,\s*\)/,
  'reset data should timeout slow destructive reset actions',
)
assert.doesNotMatch(
  resetData,
  /setTimeout\(\(\) => refreshAppData\(\),\s*200\)/,
  'reset data and factory reset should refresh app state immediately after the server confirms success',
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
assert.doesNotMatch(
  bulkImportModal,
  /preflightImportJob|IMPORT_JOB_PREFLIGHT_TIMEOUT_MS/,
  'product import should not repeat a synchronous full-file preflight before queued server analysis',
)
assert.match(
  bulkImportModal,
  /api\.startImportJob\(activeJobId,[\s\S]*setCurrentJob\(startedJob\)[\s\S]*setStep\(2\)/,
  'queued analysis should hand the active job to the persisted Screen 2 review',
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
  /function loadContactsTransportModule\(\): Promise<ContactsTransportModule>[\s\S]*import\('\.\.\/\.\.\/\.\.\/api\/contactsTransport\.ts'\)[\s\S]*withLoaderTimeout\(\s*(?:\/\/[^\n]*\n\s*)*async \(\) => \(await loadContactsTransportModule\(\)\)\.getSuppliers\(\{ fields: 'names' \}\),\s*'Product suppliers',\s*PRODUCT_SUPPLIERS_TIMEOUT_MS,\s*\)/,
  'product supplier options should timeout slow supplier reads and use the name-only list every role may call (Part 383 supplier privacy)',
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
  /if \(!loadedOnceRef\.current \|\| loading \|\| auxOptionsLoadedRef\.current\) return undefined[\s\S]*setAuxOptionsReady\(true\)[\s\S]*return undefined/,
  'products auxiliary category, unit, and branch reads should become ready immediately after first product route-ready work',
)
assert.doesNotMatch(products, /PRODUCTS_AUX_OPTIONS_READY_DELAY_MS|window\.setTimeout\(\(\) => \{\s*setAuxOptionsReady\(true\)/, 'products auxiliary options should not add a fixed post-load delay')
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
  // Query object widened from {} -- filter meta is now scoped to the
  // current branch/brand/category/supplier/stock/group filters
  // (filterMetaQuery) so the returned brand/category/supplier options
  // reflect what's actually selectable given the other active filters.
  /withLoaderTimeout\(\(\) => productApi\.getProductFilters\(filterMetaQuery\), 'Product filters', PRODUCTS_FILTER_META_TIMEOUT_MS\)/,
  'products filter metadata should timeout slow filter requests',
)
assert.match(
  products,
  /if \(!loadedOnceRef\.current \|\| loading \|\| filterMetaLoadedRef\.current\) return undefined[\s\S]*setFilterMetaReady\(true\)[\s\S]*return undefined/,
  'products full filter metadata should become ready immediately after first product route-ready work',
)
assert.doesNotMatch(products, /PRODUCTS_FILTER_META_READY_DELAY_MS|window\.setTimeout\(\(\) => \{\s*setFilterMetaReady\(true\)/, 'products filter metadata should not add a fixed post-load delay')
assert.match(
  products,
  /if \(!isActive \|\| !filterMetaReady \|\| filterMetaLoadedRef\.current\) return[\s\S]*const requestId = beginTrackedRequest\(filterMetaRequestRef\)[\s\S]*withLoaderTimeout\(\(\) => productApi\.getProductFilters\(filterMetaQuery\), 'Product filters', PRODUCTS_FILTER_META_TIMEOUT_MS\)[\s\S]*if \(!isTrackedRequestCurrent\(filterMetaRequestRef, requestId\)\) return/,
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
assert.doesNotMatch(
  bulkImportModal,
  /api\.preflightImportJob/,
  'product imports should rely on one queued persisted analysis instead of a duplicate synchronous review check',
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
  /const SUPPLIER_RETURN_SETUP_WATCHDOG_MS = SUPPLIER_RETURN_SETUP_TIMEOUT_MS \+ 1500/,
  'supplier return setup should have a bounded component watchdog after the transport timeout',
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
  /window\.setTimeout\(\(\) => \{[\s\S]*supplier_return_setup_slow[\s\S]*setLoading\(false\)[\s\S]*SUPPLIER_RETURN_SETUP_WATCHDOG_MS/,
  'supplier return setup watchdog should exit the skeleton and notify when setup stalls',
)
assert.match(
  newSupplierReturnModal,
  /useEffect\(\(\) => \{[\s\S]*aliveRef\.current = true[\s\S]*return \(\) => \{[\s\S]*aliveRef\.current = false[\s\S]*invalidateTrackedRequest\(bootstrapRequestRef\)[\s\S]*invalidateTrackedRequest\(inventoryRequestRef\)/,
  'supplier return modal should reset its mounted flag on setup so React StrictMode cleanup does not pin loaders',
)
assert.match(
  newSupplierReturnModal,
  /const clearSetupWatchdog = \(\) => \{[\s\S]*window\.clearTimeout\(setupWatchdog\)[\s\S]*\}[\s\S]*finally \{[\s\S]*clearSetupWatchdog\(\)[\s\S]*setLoading\(false\)/,
  'supplier return setup should clear the watchdog and finish loading on success or failure',
)
assert.match(
  newSupplierReturnModal,
  /'Supplier return inventory',\s*SUPPLIER_RETURN_INVENTORY_TIMEOUT_MS,/,
  'supplier return inventory should timeout slow inventory reads',
)
assert.match(
  newSupplierReturnModal,
  /withLoaderTimeout\(\s*\(\) => createSupplierReturnRequest\(\{[\s\S]*\}\),\s*'Create supplier return',\s*SUPPLIER_RETURN_CREATE_TIMEOUT_MS,\s*\)/,
  'supplier return create should timeout slow supplier-return writes',
)
assert.match(
  newSupplierReturnModal,
  /function loadBranchTransport\(\): Promise<BranchTransportModule>[\s\S]*import\('\.\.\/\.\.\/api\/branchTransport\.ts'\)[\s\S]*function loadContactReadTransport\(\): Promise<ContactReadTransportModule>[\s\S]*import\('\.\.\/\.\.\/api\/contactReadTransport\.ts'\)[\s\S]*function loadInventoryTransport\(\): Promise<InventoryTransportModule>[\s\S]*import\('\.\.\/\.\.\/api\/inventoryTransport\.ts'\)[\s\S]*function loadReturnsTransport\(\): Promise<ReturnsTransportModule>[\s\S]*import\('\.\.\/\.\.\/api\/returnsTransport\.ts'\)/,
  'supplier return modal should use focused lazy transports for branch, supplier, inventory, and create-return work',
)
assert.doesNotMatch(
  newSupplierReturnModal,
  /getSupplierReturnApi|window\.api|api\.(?:getBranches|getSuppliers|getInventorySummary|createSupplierReturn)/,
  'supplier return modal should not wake the broad window.api registry for setup, inventory, or create paths',
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
  /const EMPTY_INITIAL_SELECTED: string\[] = \[\][\s\S]*initialSelected = EMPTY_INITIAL_SELECTED/,
  'file picker should use a stable empty initial selection instead of allocating a new default array every render',
)
assert.match(
  filePickerModal,
  /normalizedInitialSelectedKey = Array\.isArray\(initialSelected\) \? initialSelected\.filter\(Boolean\)\.join\('\\u0000'\) : ''[\s\S]*normalizedInitialSelectedKey \? normalizedInitialSelectedKey\.split\('\\u0000'\) : EMPTY_INITIAL_SELECTED[\s\S]*current\.length === next\.length && current\.every\(\(entry, index\) => entry === next\[index\]\)[\s\S]*\}, \[normalizedInitialSelectedKey, loadFiles, open\]\)/,
  'file picker should not reset selected state or reload only because the normalized initial selection array identity changed',
)
assert.match(
  filePickerModal,
  /const notifyRef = useRef\(notify\)[\s\S]*notifyRef\.current = notify[\s\S]*notifyRef\.current\(getErrorMessage\(error, 'Failed to load files'\), 'error'\)[\s\S]*\}, \[mediaType, page, pageSize, search\]\)/,
  'file picker load effect should avoid unstable notify dependencies while retaining every request-scope dependency (page and pageSize each select a separate fetch)',
)
assert.match(
  filePickerModal,
  /setPage\(1\)[\s\S]{0,80}\}, \[search, mediaType\]\)/,
  'changing the picker search or media-type filter must jump back to page 1, or a filter applied on page 3 shows an empty page',
)
assert.match(
  filePickerModal,
  /deleteFileAsset as deletePickerFileAsset[\s\S]*getFiles as fetchPickerFiles[\s\S]*uploadFileAsset as uploadPickerFileAsset[\s\S]*from '\.\.\/\.\.\/api\/fileTransport\.ts'/,
  'file picker library should use focused file transport instead of the broad app-api registry',
)
assert.match(
  filePickerModal,
  /withLoaderTimeout\(\s*\(\) => fetchPickerFiles\(\{ search, mediaType, page, pageSize, includeMeta: true \}\),\s*'Files library picker',\s*FILE_PICKER_LOAD_TIMEOUT_MS,?\s*\)/,
  'file picker library should timeout slow file reads',
)
assert.doesNotMatch(
  filePickerModal,
  /window\.setTimeout\(\(\) => \{\s*loadFiles\(\)\s*\},\s*180\)/,
  'file picker should not add a delayed duplicate reload after the immediate open/search load',
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
  /withLoaderTimeout<FileAsset>\(\s*\(\) => uploadFileAssetRequest\(\{ file, userId: user\?\.id, userName: user\?\.name \}\),\s*'Upload picker file asset',\s*FILE_PICKER_UPLOAD_TIMEOUT_MS,\s*\)/,
  'file picker uploads should timeout slow upload requests',
)
assert.match(
  filePickerModal,
  /withLoaderTimeout\(\s*\(\) => deleteFileAssetRequest\(assetId, \{ expectedUpdatedAt: asset\.updated_at \|\| undefined \}\),\s*'Delete picker file asset',\s*FILE_PICKER_DELETE_TIMEOUT_MS,\s*\)/,
  'file picker deletes should timeout slow delete requests',
)
assert.doesNotMatch(
  filePickerModal,
  /getFilePickerApi|window\.api|api\.(?:getFiles|uploadFileAsset|deleteFileAsset)/,
  'file picker should not wake the broad window.api registry for list, upload, or delete paths',
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
  /import \{[\s\S]*getFiles as getFilesRequest,[\s\S]*uploadFileAsset as uploadFileAssetRequest,[\s\S]*\} from '\.\.\/\.\.\/api\/fileTransport\.ts'/,
  'Files page should use the focused file transport instead of the broad API registry',
)
assert.match(
  filesPage,
  /import \{[\s\S]*getAiProviders as getAiProvidersRequest,[\s\S]*getAiResponses as getAiResponsesRequest,[\s\S]*\} from '\.\.\/\.\.\/api\/aiTransport\.ts'/,
  'Files page should use the focused AI transport for provider and response reads',
)
assert.doesNotMatch(
  filesPage,
  /window\.api/,
  'Files page should not bind to window.api and load app-api-methods during route startup',
)
assert.match(
  viteConfig,
  /fileTransport\.ts'\)[\s\S]*return 'file-api'[\s\S]*multipartHeaders\.ts'\)\) return 'multipart-headers-api'[\s\S]*aiTransport\.ts'\)\) return 'ai-api'/,
  'Vite should split Files focused transports away from app-api-methods',
)
assert.match(
  viteConfig,
  /importJobsTransport\.ts'\)[\s\S]*importTransport\.ts'\)[\s\S]*return 'import-jobs-api'/,
  'Vite should keep import job uploads inside the deferred import-jobs API chunk',
)
assert.match(
  fileTransport,
  /export async function getFiles/,
  'Focused file transport should own file list reads',
)
assert.doesNotMatch(
  fileTransport,
  /from '\.\/importTransport\.ts'/,
  'Focused file transport should not import the broad import transport chunk',
)
assert.match(
  fileTransport,
  /from '\.\/multipartHeaders\.ts'/,
  'Focused file transport should use the tiny multipart header helper',
)
assert.match(
  multipartHeaders,
  /export function buildMultipartHeaders\(\): MultipartHeaders/,
  'Multipart upload headers should live in a small reusable helper',
)
assert.match(
  aiTransport,
  /export function getAiProviders\(\)[\s\S]*export function getAiResponses\(limit = 80\)/,
  'Focused AI transport should own library provider and response reads',
)
assert.match(
  filesPage,
  /withLoaderTimeout\(\(\) => filesApi\.getFiles\(\{[\s\S]{0,180}includeMeta: true,[\s\S]{0,80}\}\), 'Files library', FILES_LIBRARY_LOAD_TIMEOUT_MS\)/,
  'files page library should timeout slow file reads',
)
assert.doesNotMatch(
  filesPage,
  /window\.setTimeout\(\(\) => \{\s*void loadFiles\(\)\s*\},\s*120\)/,
  'files page library should not add a fixed delay before the real file read',
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
  /const \[historyReady, setHistoryReady\] = useState\(false\)/,
  'Files should have an explicit post-ready action-history gate',
)
assert.doesNotMatch(filesPage, /FILES_HISTORY_READY_DELAY_MS|window\.setTimeout\(\(\) => \{\s*setHistoryReady\(true\)/, 'Files background history should not add a fixed post-load delay')
assert.match(
  filesPage,
  /useActionHistory\(\{ limit: 3, notify, enabled: historyReady, user \}\)/,
  'Files should not fetch server action history during first route load',
)
assert.match(
  filesPage,
  /if \(!filesLoadedOnceRef\.current \|\| loadingFiles\) return undefined[\s\S]*setHistoryReady\(true\)[\s\S]*return undefined/,
  'Files should enable history immediately after the first file library load settles',
)
assert.match(
  filesPage,
  /withLoaderTimeout\(\s*(?:\/\/[^\n]*\n\s*)*\(\) => filesApi\.uploadFileAsset\(\{ file, userId: user\?\.id, userName: user\?\.name, compressOptions: LIBRARY_IMAGE_COMPRESS_OPTIONS \}\),\s*'Upload file asset',\s*FILES_ASSET_UPLOAD_TIMEOUT_MS,\s*\)/,
  'files page uploads should timeout slow upload requests',
)
assert.match(
  filesPage,
  /withLoaderTimeout\(\s*\(\) => filesApi\.deleteFileAsset\(asset\.id, \{\s*expectedUpdatedAt: asset\.updated_at \|\| undefined,\s*force: locked && deleteUnlockChecked,\s*confirmText: deleteConfirmText\.trim\(\),\s*\}\),\s*'Delete file asset',\s*FILES_ASSET_DELETE_TIMEOUT_MS,\s*\)/,
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
  /const ProductDetailSheet = lazyRetry\(\(\) => import\('\.\/ProductDetailSheet'\), 'pos-product-detail-sheet'\)/,
  'POS product detail sheet should stay in a click-only lazy chunk',
)
assert.match(
  pos,
  /const POSQuickAddModals = lazyRetry\(\(\) => import\('\.\/POSQuickAddModals'\), 'pos-quick-add-modals'\)/,
  'POS quick-add customer and delivery forms should stay in a click-only lazy chunk',
)
assert.doesNotMatch(
  pos,
  /import QuickAddModal from '\.\/QuickAddModal'/,
  'POS should not statically load the quick-add modal frame during first route render',
)
assert.doesNotMatch(
  pos,
  /pos-quick-customer-name|pos-quick-delivery-name/,
  'POS should not keep quick-add form fields in the first route chunk',
)
assert.match(
  posQuickAddModals,
  /export default function POSQuickAddModals/,
  'POS quick-add modal markup should live in the lazy quick-add component',
)
assert.doesNotMatch(
  pos,
  /import X from 'lucide-react\/dist\/esm\/icons\/x\.js'/,
  'POS should not keep the product detail close icon in the first route chunk',
)
assert.match(
  pos,
  /withLoaderTimeout\(\s*\(\) => shouldLoadMetadata[\s\S]*loadPosProductBootstrap\(productQuery\)[\s\S]*searchPosCatalogProducts\(productQuery\)[\s\S]*label,\s*POS_CATALOG_LOAD_TIMEOUT_MS,\s*\)/,
  'POS catalog reads should timeout the combined first-window product and branch request',
)
assert.match(
  pos,
  /include: 'branch_stock,images,family',\s*\n\s*metadata: '0',/,
  'POS first product bootstrap should skip full filter metadata and let the delayed filters request fill it',
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
assert.doesNotMatch(
  pos,
  /POS_CONTACT_OPTIONS_READY_DELAY_MS|POS_FILTER_META_READY_DELAY_MS|POS_CATEGORY_OPTIONS_READY_DELAY_MS/,
  'POS secondary reads should not add fixed post-route-ready delays on top of real network work',
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
  /const POS_CHECKOUT_TIMEOUT_MS = 45000/,
  'POS checkout should use an explicit timeout',
)
assert.match(
  pos,
  /withLoaderTimeout\(\s*\(\) => lookupPosPortalMembership\(membershipNumber\),\s*label,\s*POS_MEMBERSHIP_LOOKUP_TIMEOUT_MS,\s*\)/,
  'POS membership lookup should timeout slow membership reads',
)
assert.match(
  pos,
  // P7-a: the create's argument is customerPayload (newCustomerForm
  // serialized into a primary contact-option row); the timeout wrapper,
  // label and constant are what this pin protects.
  /withLoaderTimeout\(\s*\(\) => createPosCustomer\(customerPayload\),\s*'Create POS customer',\s*POS_CUSTOMER_CREATE_TIMEOUT_MS,\s*\)/,
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
  /const needsCustomerOptions = showCustomer \|\| showAddCustomer[\s\S]*const needsDeliveryOptions = \(showDelivery && Boolean\(active\?\.isDelivery\)\) \|\| showAddDelivery[\s\S]*setContactOptionsReady\(true\)/,
  'POS should wake contact option reads only when the matching checkout section opens',
)
assert.match(
  pos,
  /if \(!isActive \|\| !contactOptionsReady\) return[\s\S]*!customerOptionsLoadedRef\.current[\s\S]*loadCustomers\('POS customer options on demand'\)[\s\S]*!deliveryOptionsLoadedRef\.current[\s\S]*loadDeliveryContacts\('POS delivery options on demand'\)/,
  'POS should keep customer and delivery reads off the catalog path and avoid refetching loaded option lists',
)
assert.match(
  pos,
  /if \(!catalogLoadedOnceRef\.current \|\| catalogRefreshing \|\| filterMetaLoadedRef\.current\) return undefined[\s\S]*setFilterMetaReady\(true\)/,
  'POS should enable full filter metadata immediately after the first catalog load settles',
)
assert.match(
  pos,
  // Query object widened from {} -- POS scopes the filter-meta request to
  // the currently selected branch/brand/category/supplier/stock/group
  // filters (scopedQuery), same change as the Products page above.
  /if \(!isActive \|\| !filterMetaReady \|\| filterMetaLoadedRef\.current\) return[\s\S]*const requestId = beginTrackedRequest\(filterMetaRequestRef\)[\s\S]*withLoaderTimeout\(\(\) => loadPosProductFilters\(scopedQuery\), 'POS product filters', POS_FILTER_META_TIMEOUT_MS\)[\s\S]*if \(!isTrackedRequestCurrent\(filterMetaRequestRef, requestId\)\) return/,
  'POS should fetch full product filters as a delayed tracked request',
)
assert.match(
  pos,
  /const branchesById = useMemo\(\(\) => new Map\(/,
  'POS should index branch lookups used by cart branch validation',
)
assert.match(
  pos,
  /let qty = Number\(p\.stock_quantity \|\| 0\)[\s\S]*if \(branchFilterIds\.length\) \{[\s\S]*const matches = \(p\.branch_stock \|\| \[\]\)\.filter[\s\S]*qty = matches\.reduce/,
  'POS branch filtering should reuse one branch-stock scan for summed quantity across selected branches, without hiding a product that has no branch_stock row at all for that branch',
)
assert.doesNotMatch(
  pos,
  /if \(branchFilterIds\.length\) \{[\s\S]{0,200}if \(!matches\.length\) return false/,
  'POS branch filtering should not hide a product just because it has no branch_stock row for the selected branch (a missing row means qty 0, not "doesn\'t stock this branch")',
)
assert.doesNotMatch(
  pos,
  /const qty = \(\(\) => \{[\s\S]*branchFilterId != null[\s\S]*branch_stock/,
  'POS branch filtering should not rescan branch_stock inside a quantity IIFE',
)
assert.match(
  pos,
  /const pickBestBranchId = useCallback\(\(product: ProductRecord\) => \{[\s\S]*let bestBranchId: number \| null = null[\s\S]*for \(const entry of product\?\.branch_stock \|\| \[\]\)[\s\S]*if \(preferredBranchId != null && branchId === preferredBranchId\) return branchId[\s\S]*if \(qty > bestQuantity\)/,
  'POS branch selection should choose a branch in one pass without mapping and sorting stock rows',
)
assert.doesNotMatch(
  pos,
  /const pickBestBranchId = useCallback\(\(product: ProductRecord\) => \{[\s\S]*stockRows\.sort/,
  'POS branch selection should not sort branch_stock rows just to find the largest quantity',
)
assert.match(
  pos,
  /import \{[\s\S]*buildProductLightboxState,[\s\S]*getProductGalleryImages,[\s\S]*\} from '\.\.\/products\/helpers\/productGalleryHelpers\.ts'/,
  'POS should reuse shared product gallery helpers instead of carrying a route-local gallery parser',
)
assert.match(
  pos,
  /import \{ buildProductBrandOptions \} from '\.\.\/products\/helpers\/productDisplayHelpers\.ts'/,
  'POS should reuse shared product brand option normalization',
)
assert.match(
  pos,
  /import \{ buildProductSearchTerms \} from '\.\.\/\.\.\/utils\/searchTerms\.ts'/,
  'POS should reuse lightweight search-term normalization without pulling product/catalog filter chunks',
)
assert.doesNotMatch(
  pos,
  /deferredSearch\.split\(/,
  'POS should not keep a route-local comma search parser',
)
assert.match(
  pos,
  /import \{ buildProductSupplierOptions \} from '\.\.\/products\/helpers\/productSupplierOptions\.ts'/,
  'POS should reuse the lightweight supplier option helper without pulling Products menu helpers',
)
assert.doesNotMatch(
  pos,
  /productMenuHelpers\.ts/,
  'POS should not load the heavier Products menu helper chunk for supplier options',
)
assert.match(
  viteConfig,
  /productSupplierOptions\.ts'[\s\S]*return 'product-shared'/,
  'supplier option normalization should ride with the shared product primitives chunk',
)
assert.doesNotMatch(
  pos,
  /const getProductGallery = useCallback\([\s\S]*JSON\.parse\(raw\)[\s\S]*raw\.split\('\|'\)/,
  'POS should not duplicate JSON and pipe-delimited product gallery parsing',
)
assert.doesNotMatch(
  pos,
  /const posBrands = useMemo\(\(\) => \{[\s\S]*JSON\.parse\(settings\?\.product_brand_options/,
  'POS should not duplicate product brand settings parsing',
)
assert.doesNotMatch(
  pos,
  /const posSuppliers = useMemo\(\s*\(\) => \[\.\.\.new Set\(\(productFilterMeta\.suppliers/,
  'POS should not duplicate product supplier option Set sorting',
)
assert.match(
  pos,
  /const cartTotals = useMemo\(\(\) => \{[\s\S]*for \(const item of active\.cart\)[\s\S]*branchIds: Array\.from\(branchIds\)/,
  'POS should derive cart subtotals and branch ids in one memoized cart pass',
)
assert.doesNotMatch(
  pos,
  /const subtotalUsd\s*=\s*active\.cart\.reduce/,
  'POS should not scan the cart separately for USD subtotal',
)
assert.doesNotMatch(
  pos,
  /const subtotalKhr\s*=\s*active\.cart\.reduce/,
  'POS should not scan the cart separately for KHR subtotal',
)
assert.doesNotMatch(
  pos,
  /active\.cart\.map\(i => Number\(i\.branch_id\)\)\.filter\(Boolean\)/,
  'POS checkout should reuse memoized cart branch ids instead of rebuilding them',
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
assert.match(
  manageBrandsModal,
  /const unusedLibraryBrands = useMemo/,
  'brand lookup manager should separate unused saved brands from active product usage',
)
assert.doesNotMatch(
  manageBrandsModal,
  /const merged = new Set\(\[[\s\S]*\.\.\.libraryBrands/,
  'brand lookup manager should not merge zero-usage saved brands into review suggestions',
)

console.log('PASS performance loading UX guards')
