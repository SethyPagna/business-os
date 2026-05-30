import assert from 'node:assert/strict'
import fs from 'node:fs'

const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const sidebar = fs.readFileSync(new URL('../src/components/navigation/Sidebar.tsx', import.meta.url), 'utf8')
const appShellUtils = fs.readFileSync(new URL('../src/app/appShellUtils.ts', import.meta.url), 'utf8')
const dashboard = fs.readFileSync(new URL('../src/components/dashboard/Dashboard.jsx', import.meta.url), 'utf8')
const inventory = fs.readFileSync(new URL('../src/components/inventory/Inventory.jsx', import.meta.url), 'utf8')
const backup = fs.readFileSync(new URL('../src/components/utils-settings/Backup.jsx', import.meta.url), 'utf8')
const auditLog = fs.readFileSync(new URL('../src/components/utils-settings/AuditLog.tsx', import.meta.url), 'utf8')
const settingsPage = fs.readFileSync(new URL('../src/components/utils-settings/Settings.jsx', import.meta.url), 'utf8')
const otpModal = fs.readFileSync(new URL('../src/components/utils-settings/OtpModal.tsx', import.meta.url), 'utf8')
const resetData = fs.readFileSync(new URL('../src/components/utils-settings/ResetData.tsx', import.meta.url), 'utf8')
const serverPage = fs.readFileSync(new URL('../src/components/server/ServerPage.tsx', import.meta.url), 'utf8')
const receiptSettingsPage = fs.readFileSync(new URL('../src/components/receipt-settings/ReceiptSettings.tsx', import.meta.url), 'utf8')
const receiptPreview = fs.readFileSync(new URL('../src/components/receipt-settings/ReceiptPreview.tsx', import.meta.url), 'utf8')
const contacts = fs.readFileSync(new URL('../src/components/contacts/Contacts.tsx', import.meta.url), 'utf8')
const contactsShared = fs.readFileSync(new URL('../src/components/contacts/shared.tsx', import.meta.url), 'utf8')
const contactImportModal = fs.readFileSync(new URL('../src/components/contacts/ContactImportModal.tsx', import.meta.url), 'utf8')
const customers = fs.readFileSync(new URL('../src/components/contacts/CustomersTab.tsx', import.meta.url), 'utf8')
const customerFormModal = fs.readFileSync(new URL('../src/components/contacts/CustomerFormModal.tsx', import.meta.url), 'utf8')
const customerMembershipNumber = fs.readFileSync(new URL('../src/components/contacts/customerMembershipNumber.ts', import.meta.url), 'utf8')
const suppliers = fs.readFileSync(new URL('../src/components/contacts/SuppliersTab.tsx', import.meta.url), 'utf8')
const delivery = fs.readFileSync(new URL('../src/components/contacts/DeliveryTab.tsx', import.meta.url), 'utf8')
const pos = fs.readFileSync(new URL('../src/components/pos/POS.jsx', import.meta.url), 'utf8')
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
const catalogPage = fs.readFileSync(new URL('../src/components/catalog/CatalogPage.jsx', import.meta.url), 'utf8')
const products = fs.readFileSync(new URL('../src/components/products/Products.jsx', import.meta.url), 'utf8')
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
const loaders = fs.readFileSync(new URL('../src/utils/loaders.ts', import.meta.url), 'utf8')
const apiMethods = fs.readFileSync(new URL('../src/api/methods.js', import.meta.url), 'utf8')

assert.match(app, /const WARMUP_PAGE_IDS = \[\s*'products',[\s\S]*'pos',[\s\S]*'inventory',[\s\S]*\]/, 'background chunk warmup should target the primary day-to-day pages only')
assert.match(app, /Page bundle is still loading/, 'page loader should explain stalled chunk loads')
assert.match(app, /console\.warn\('\[PageLoader\]/, 'page loader should expose diagnostic breadcrumbs')
assert.match(app, /const CHUNK_IMPORT_TIMEOUT_MS = 15000/, 'chunk timeout should allow slow mobile networks before showing stalled UI')
assert.match(app, /const INTENT_CHUNK_IMPORT_TIMEOUT_MS = 7000/, 'navigation intent warmup should have a short chunk timeout')
assert.match(app, /const INTENT_CHUNK_WARMUP_DELAY_MS = 80/, 'navigation intent warmup should debounce accidental pointer passes')
assert.match(app, /window\.addEventListener\(APP_PAGE_INTENT_EVENT, warmIntentPage\)/, 'app shell should warm the exact route chunk on navigation intent')
assert.match(app, /scheduleIntentChunkLoad/, 'navigation intent should use a bounded chunk warmup helper')
assert.match(app, /shouldSkipIntentWarmup/, 'navigation intent warmup should respect visibility and slow-network signals')
assert.match(appShellUtils, /export const APP_PAGE_INTENT_EVENT = 'bos:page-intent'/, 'navigation intent event should live in shared app shell utils')
assert.match(sidebar, /APP_PAGE_INTENT_EVENT/, 'sidebar should publish navigation intent before route clicks')
assert.match(sidebar, /onPointerEnter=\{\(\) => announcePageIntent\(item\.id, 'pointer'\)\}/, 'desktop navigation should warm route chunks on pointer intent')
assert.match(sidebar, /onTouchStart=\{\(\) => announcePageIntent\(item\.id, 'touch'\)\}/, 'mobile navigation should warm route chunks on touch intent')
assert.match(app, /buildChunkRecoveryUrl/, 'chunk recovery should use a cache-busting recovery URL')
assert.match(app, /const STALE_SHELL_CACHE_DELETE_CONCURRENCY = 2/, 'chunk recovery should bound stale shell cache deletion')
assert.match(app, /async function deleteStaleShellCaches/, 'chunk recovery should use a bounded stale cache deletion helper')
assert.match(app, /Math\.min\(STALE_SHELL_CACHE_DELETE_CONCURRENCY, keys\.length\)/, 'stale cache deletion should cap worker count')
assert.match(app, /await deleteStaleShellCaches\(/, 'chunk recovery should delete stale shell caches through the bounded helper')
assert.doesNotMatch(app, /Promise\.all\(\s*keys\s*\.filter\(\(key\) => key\.startsWith\('business-os-app-shell-'\)/, 'chunk recovery should not delete every stale shell cache at once')
assert.match(app, /window\.history\.replaceState/, 'successful boot should clean recovery params from the URL')
assert.match(app, /business_os_page_loader_warning:\$\{window\.location\.pathname\}:\$\{FRONTEND_BUILD_HASH \|\| 'dev'\}/, 'page loader warnings should be scoped per build hash')
assert.match(app, /window\.location\.replace\(target\)/, 'failed chunk recovery should use hard location replacement')

assert.match(inventory, /inventory-history-row/, 'inventory history controls should live on their own row')
assert.doesNotMatch(inventory, /<ActionHistoryBar history=\{actionHistory\} className="shrink-0"/, 'inventory filter/search row should not contain inline ActionHistoryBar')
assert.match(inventory, /inventory-history-row[\s\S]{0,160}<ActionHistoryBar/, 'inventory history controls should render inside the dedicated history row')

assert.match(backup, /useState\('all'\)/, 'Backup should default to the lightweight overview tab without showing duplicate All and Overview tabs')
assert.match(backup, /BackupOverview/, 'Backup overview should provide lightweight section entry points')
assert.doesNotMatch(backup, /function DataFolderLocation/, 'unused backup data-folder UI should not remain in the bundle')
assert.doesNotMatch(backup, /function ScaleMigrationSection/, 'unused backup migration UI should not remain in the bundle')
assert.doesNotMatch(backup, /backupSection === 'all' \|\|/, 'Backup sections should not mount every tool in overview mode')
assert.match(backup, /const INTEGRATION_DOCTOR_TIMEOUT_MS = 12000/, 'integration doctor should use an explicit quick timeout')
assert.match(backup, /const INTEGRATION_DOCTOR_DEEP_TIMEOUT_MS = 30000/, 'deep integration doctor should use an explicit longer timeout')
assert.match(backup, /const SYSTEM_JOB_STATUS_TIMEOUT_MS = 10000/, 'backup system job polling should use an explicit timeout')
assert.match(
  backup,
  /withLoaderTimeout\(\s*\(\) => window\.api\.getIntegrationDoctor\?\.\(\{ deep \}\),\s*deep \? 'Deep integration doctor' : 'Integration doctor',\s*deep \? INTEGRATION_DOCTOR_DEEP_TIMEOUT_MS : INTEGRATION_DOCTOR_TIMEOUT_MS,\s*\)/,
  'integration doctor reads should timeout slow diagnostics',
)
assert.match(
  backup,
  /withLoaderTimeout\(\s*\(\) => window\.api\.getSystemJob\?\.\(jobId\),\s*`\$\{reason\} status`,\s*SYSTEM_JOB_STATUS_TIMEOUT_MS,\s*\)/,
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
const appContext = fs.readFileSync(new URL('../src/AppContext.jsx', import.meta.url), 'utf8')
assert.match(appContext, /RUNTIME_RECOVERY_SESSION_KEY/, 'runtime mismatch recovery should guard against reload loops')
assert.match(appContext, /window\.location\.replace\(url\.toString\(\)\)/, 'runtime mismatch should heal through a hard reload once')
assert.match(appContext, /const APP_SETTINGS_LOAD_TIMEOUT_MS = 9000/, 'app settings should use an explicit timeout constant')
assert.match(appContext, /const APP_BOOTSTRAP_TIMEOUT_MS = 9000/, 'app bootstrap should use an explicit timeout constant')
assert.match(appContext, /const APP_LOGIN_TIMEOUT_MS = 15000/, 'app login should use an explicit timeout constant')
assert.match(appContext, /const APP_LOGOUT_TIMEOUT_MS = 10000/, 'app logout should use an explicit timeout constant')
assert.match(appContext, /const APP_GOOGLE_OAUTH_COMPLETE_TIMEOUT_MS = 20000/, 'Google OAuth completion should use an explicit timeout constant')
assert.match(appContext, /const APP_SETTINGS_SAVE_TIMEOUT_MS = 15000/, 'settings save should use an explicit timeout constant')
assert.match(appContext, /const APP_SESSION_DURATION_TIMEOUT_MS = 12000/, 'session duration refresh should use an explicit timeout constant')
assert.match(
  appContext,
  /withLoaderTimeout\(\s*\(\) => window\.api\.getSettings\(\{ force: options\?\.force === true \}\),\s*'App settings',\s*APP_SETTINGS_LOAD_TIMEOUT_MS,\s*\)/,
  'app settings refresh should timeout slow settings reads',
)
assert.match(
  appContext,
  /const readAppBootstrap = useCallback\(\(label = 'App bootstrap'\) => \{[\s\S]*withLoaderTimeout\(\s*\(\) => window\.api\.getAppBootstrap\(\),\s*label,\s*APP_BOOTSTRAP_TIMEOUT_MS,\s*\)/,
  'app bootstrap helper should timeout slow bootstrap reads',
)
assert.match(
  appContext,
  /const fallbackSettings = hasCurrentSettings \? currentSettings : mergeSettingsWithDeviceOverrides\(\{\}\)/,
  'app settings refresh failures should keep current settings when available',
)
assert.doesNotMatch(
  appContext,
  /await window\.api\?\.getAppBootstrap\?\.\(/,
  'app bootstrap reads should go through the shared timeout helper',
)
assert.match(
  appContext,
  /withLoaderTimeout\(\s*\(\) => window\.api\.login\(\{[\s\S]*username, password, organization,[\s\S]*sessionDuration,[\s\S]*\}\),\s*'Login',\s*APP_LOGIN_TIMEOUT_MS,\s*\)/,
  'login should timeout slow auth requests',
)
assert.match(
  appContext,
  /withLoaderTimeout\(\(\) => window\.api\.logout\?\.\(\), 'Logout', APP_LOGOUT_TIMEOUT_MS\)/,
  'logout should timeout slow auth cleanup requests',
)
assert.match(
  appContext,
  /withLoaderTimeout\(\s*\(\) => window\.api\.completeGoogleOauth\(\{[\s\S]*mode: 'link',[\s\S]*currentUserId: actorId,[\s\S]*\}\),\s*'Complete Google OAuth',\s*APP_GOOGLE_OAUTH_COMPLETE_TIMEOUT_MS,\s*\)/,
  'Google OAuth completion should timeout slow auth linking requests',
)
assert.match(
  appContext,
  /withLoaderTimeout\(\s*\(\) => window\.api\.saveSettings\(serverUpdates, normalizedOptions\),\s*'Save settings',\s*APP_SETTINGS_SAVE_TIMEOUT_MS,\s*\)/,
  'settings writes should timeout slow server saves',
)
assert.match(
  appContext,
  /withLoaderTimeout\(\s*\(\) => window\.api\.updateSessionDuration\(\{[\s\S]*sessionDuration: normalizedSessionDuration,[\s\S]*\}\),\s*'Refresh session duration',\s*APP_SESSION_DURATION_TIMEOUT_MS,\s*\)/,
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
  /withLoaderTimeout\(\s*\(\) => getActionHistory\(scope, Math\.max\(3, limit\), \{[\s\S]*'Action history',\s*ACTION_HISTORY_LOAD_TIMEOUT_MS,\s*\)/,
  'action history server reads should timeout slow history requests',
)
assert.match(
  actionHistory,
  /if \(!isTrackedRequestCurrent\(historyRequestRef, requestId\)\) return[\s\S]*setServerItems\(Array\.isArray\(result\?\.items\) \? result\.items : \[\]\)/,
  'action history should ignore stale history responses before updating rows',
)
assert.match(
  actionHistory,
  /withLoaderTimeout\(\s*\(\) => getUsers\(\),\s*'Action history users',\s*ACTION_HISTORY_USERS_TIMEOUT_MS,\s*\)/,
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
  /withLoaderTimeout\(\(\) => window\.api\.getDashboard\(\), label, DASHBOARD_SUMMARY_TIMEOUT_MS\)/,
  'dashboard summary should timeout slow summary reads',
)
assert.match(
  dashboard,
  /withLoaderTimeout\(\s*\(\) => window\.api\.getAnalytics\(\{ startDate: start, endDate: end, granularity: gran \}\),\s*'Dashboard analytics',\s*DASHBOARD_ANALYTICS_TIMEOUT_MS,\s*\)/,
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
  /withLoaderTimeout\(\(\) => window\.api\.getUsers\(\), 'Inventory user filters', INVENTORY_USER_OPTIONS_TIMEOUT_MS\)/,
  'inventory user filter options should timeout slow user reads',
)
assert.match(
  inventory,
  /withLoaderTimeout\(\s*\(\) => window\.api\.getInventoryReasons\?\.\(\) \?\? Promise\.resolve\(\{ items: \[\] \}\),\s*'Inventory reasons',\s*INVENTORY_REASONS_TIMEOUT_MS,\s*\)/,
  'inventory saved reasons should timeout slow reason reads',
)
assert.match(
  inventory,
  /withLoaderTimeout\(\s*\(\) => window\.api\.getBranches\(\),\s*'Inventory branches',\s*INVENTORY_BRANCHES_TIMEOUT_MS,\s*\)/,
  'inventory branches should timeout slow branch reads',
)
assert.match(
  inventory,
  /withLoaderTimeout\(\s*\(\) => window\.api\.getInventoryStats\(statsQuery\),\s*'Inventory stats',\s*INVENTORY_STATS_TIMEOUT_MS,\s*\)/,
  'inventory primary stats should timeout slow stats reads',
)
assert.match(
  inventory,
  /withLoaderTimeout\(\s*\(\) => window\.api\.searchInventoryProducts\(productQuery\),\s*'Inventory products',\s*INVENTORY_PRODUCTS_TIMEOUT_MS,\s*\)/,
  'inventory product summary should timeout slow product reads',
)
assert.match(
  inventory,
  /withLoaderTimeout\(\s*\(\) => window\.api\.getInventoryMovements\(\{[\s\S]*page: movementMeta\.page,[\s\S]*pageSize: movementMeta\.pageSize,[\s\S]*\}\),\s*'Inventory movements',\s*INVENTORY_MOVEMENTS_TIMEOUT_MS,\s*\)/,
  'inventory movements should timeout slow movement reads',
)
assert.match(
  inventory,
  /withLoaderTimeout\(\s*\(\) => \(window\.api\.getRfidStatus \? window\.api\.getRfidStatus\(branchOpts\)\.catch\(\(\) => null\) : Promise\.resolve\(null\)\),\s*'Inventory RFID status',\s*INVENTORY_RFID_TIMEOUT_MS,\s*\)/,
  'inventory RFID status should timeout slow RFID reads',
)
assert.doesNotMatch(
  inventory,
  /withLoaderTimeout\(\(\) => window\.api\.getUsers\(\), 'Inventory user filters'[\s\S]{0,340}catch\(\(\) => \{[\s\S]{0,180}setUserOptions\(\[\]\)/,
  'inventory user filter options should keep previously loaded options on refresh failure',
)
assert.doesNotMatch(
  inventory,
  /catch \{[\s\S]{0,180}setInventoryReasons\(\[\]\)[\s\S]{0,120}inventoryReasonsLoadedRef\.current = true/,
  'inventory saved reasons should keep previous reasons and retry later after a refresh failure',
)
assert.match(
  inventory,
  /withLoaderTimeout\(\s*\(\) => window\.api\.getProductsByIds\(\[productId\], \{ include: 'branch_stock,images,batches' \}\),\s*'Inventory product detail',\s*INVENTORY_PRODUCT_DETAIL_TIMEOUT_MS,\s*\)/,
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
  /stockStats\?\.net_sold_qty\s*\?\?\s*visibleInventoryStats\.netSoldQty/,
  'inventory net-sold fallback should reuse the visible stats accumulator',
)
assert.match(
  inventory,
  /const visibleInventoryProductIds = useMemo\([\s\S]*visibleInventoryProducts\.reduce/,
  'inventory product selection should precompute visible ids once per visible list',
)
assert.match(
  inventory,
  /setSelectedProductIds\(new Set\(visibleInventoryProductIds\)\)/,
  'inventory select-all should reuse the precomputed visible id list',
)
assert.match(
  inventory,
  /function normalizeFiniteIdsFrom\(items = \[\],[\s\S]*items\.reduce/,
  'inventory selection ids should be normalized through a single helper pass',
)
assert.match(
  inventory,
  /function normalizeFiniteIds\(ids = \[\]\) \{[\s\S]*return normalizeFiniteIdsFrom\(ids\)/,
  'inventory selection scope ids should use the shared normalization helper',
)
assert.match(
  inventory,
  /const normalized = normalizeFiniteIds\(ids\)[\s\S]*toggleIdSet\(current, normalized, checked\)/,
  'inventory selection scope toggles should reuse normalized ids',
)
assert.match(
  inventory,
  /function countSelectedIds\(ids = \[\], selectedIds = new Set\(\)\) \{[\s\S]*for \(const id of ids\)/,
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
  /function renderDestinationProductOptions\(products = \[\], excludedProductId\) \{[\s\S]*return products\.map\(\(product\) => \{[\s\S]*if \(Number\.isFinite\(excludedId\) && id === excludedId\) return null/,
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
  /function countActiveFlags\(flags = \[\]\) \{[\s\S]*for \(const flag of flags\)/,
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
  /withLoaderTimeout\(\s*\(\) => window\.api\.getReturns\(\{ scope: 'all' \}\),\s*'Inventory returns stats',\s*INVENTORY_RETURNS_STATS_TIMEOUT_MS,\s*\)/,
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
  /withLoaderTimeout\(\s*\(\) => window\.api\.getDashboard\(\),\s*'Inventory dashboard stats',\s*INVENTORY_DASHBOARD_STATS_TIMEOUT_MS,\s*\)/,
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
  /const CATALOG_PORTAL_CONFIG_TIMEOUT_MS = 10000/,
  'catalog portal config should use an explicit timeout constant',
)
assert.match(
  catalogPage,
  /const CATALOG_PORTAL_META_TIMEOUT_MS = 10000/,
  'catalog portal metadata should use an explicit timeout constant',
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
  /withLoaderTimeout\(\s*\(\) => window\.api\.getPortalAiStatus\(\),\s*'Portal AI status',\s*CATALOG_PORTAL_AI_STATUS_TIMEOUT_MS,\s*\)/,
  'catalog portal AI status should timeout slow status reads',
)
assert.match(
  catalogPage,
  /withLoaderTimeout\(\s*\(\) => window\.api\.getAiProviders\(\),\s*'Portal AI providers',\s*CATALOG_PORTAL_EDITOR_HELPERS_TIMEOUT_MS,\s*\)/,
  'catalog portal AI providers should timeout slow provider reads',
)
assert.match(
  catalogPage,
  /withLoaderTimeout\(\s*\(\) => window\.api\.getPortalSubmissionsForReview\(\),\s*'Portal review items',\s*CATALOG_PORTAL_EDITOR_HELPERS_TIMEOUT_MS,\s*\)/,
  'catalog portal review items should timeout slow review reads',
)
assert.match(
  catalogPage,
  /withLoaderTimeout\(\(\) => loadPortal\(\), 'Customer portal', CATALOG_PORTAL_BOOTSTRAP_TIMEOUT_MS\)/,
  'catalog portal bootstrap should timeout slow portal bootstraps',
)
assert.match(
  catalogPage,
  /withLoaderTimeout\(\s*\(\) => window\.api\.getPortalConfig\(\),\s*'Portal config',\s*CATALOG_PORTAL_CONFIG_TIMEOUT_MS,\s*\)/,
  'catalog portal config should timeout slow config reads',
)
assert.match(
  catalogPage,
  /withLoaderTimeout\(\s*\(\) => window\.api\.getPortalCatalogMeta\?\.\(\),\s*'Portal catalog metadata',\s*CATALOG_PORTAL_META_TIMEOUT_MS,\s*\)/,
  'catalog portal metadata should timeout slow metadata reads',
)
assert.match(
  catalogPage,
  /withLoaderTimeout\(\s*\(\) => window\.api\.getPortalBootstrap\(\),\s*'Portal bootstrap',\s*CATALOG_PORTAL_BOOTSTRAP_TIMEOUT_MS,\s*\)/,
  'catalog portal bootstrap API read should timeout slow bootstrap reads',
)
assert.match(
  catalogPage,
  /withLoaderTimeout\(\s*\(\) => window\.api\.searchPortalCatalogProducts\(params\),\s*'Portal product search',\s*CATALOG_PORTAL_PRODUCT_SEARCH_TIMEOUT_MS,\s*\)/,
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
  /withLoaderTimeout\(\s*\(\) => window\.api\.uploadFileAsset\(\{[\s\S]*signal: controller\.signal,[\s\S]*onProgress: \(\{ percent \}\) => updateMediaUploadState\(targetKey, \{ type: 'progress', progress: percent \}\),[\s\S]*\}\),\s*'Upload portal media',\s*CATALOG_PORTAL_MEDIA_UPLOAD_TIMEOUT_MS,\s*\)/,
  'catalog portal media uploads should timeout slow file uploads',
)
assert.match(
  catalogPage,
  /withLoaderTimeout\(\s*\(\) => window\.api\.createPortalSubmission\(\{[\s\S]*screenshots: submissionDraft\.screenshots,[\s\S]*\}\),\s*'Create portal submission',\s*CATALOG_PORTAL_SUBMISSION_TIMEOUT_MS,\s*\)/,
  'catalog portal submissions should timeout slow create actions',
)
assert.match(
  catalogPage,
  /withLoaderTimeout\(\s*\(\) => window\.api\.reviewPortalSubmission\(item\.id, \{[\s\S]*userName: user\?\.name,[\s\S]*\}\),\s*'Review portal submission',\s*CATALOG_PORTAL_REVIEW_TIMEOUT_MS,\s*\)/,
  'catalog portal reviews should timeout slow review actions',
)
assert.match(
  catalogPage,
  /withLoaderTimeout\(\s*\(\) => window\.api\.lookupPortalMembership\(value\),\s*label,\s*CATALOG_MEMBERSHIP_LOOKUP_TIMEOUT_MS,\s*\)/,
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
  /withLoaderTimeout\(\s*\(\) => (?:window\.api\?|getServerApi\(\))\.getPendingSyncState\?\.\(\),\s*'Pending sync queue',\s*SERVER_PENDING_SYNC_TIMEOUT_MS,\s*\)/,
  'server pending sync state should timeout slow queue reads',
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
  /withLoaderTimeout\(\s*\(\) => window\.api\.otpStatus\(user\.id\),\s*'OTP status',\s*SETTINGS_OTP_STATUS_TIMEOUT_MS,\s*\)/,
  'settings OTP status should timeout slow OTP status reads',
)
assert.match(
  settingsPage,
  /'Settings favicon preview',\s*SETTINGS_FAVICON_PREVIEW_TIMEOUT_MS,/,
  'settings favicon preview should timeout slow preview generation',
)
assert.match(
  settingsPage,
  /withLoaderTimeout\(\s*\(\) => window\.api\.uploadFileAsset\(\{[\s\S]*signal: controller\.signal,[\s\S]*onProgress: \(\{ percent \}\) => updateUploadState\(key, \{ type: 'progress', progress: percent \}\),[\s\S]*\}\),\s*'Upload settings image',\s*SETTINGS_IMAGE_UPLOAD_TIMEOUT_MS,\s*\)/,
  'settings image uploads should timeout slow file uploads',
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
  /const runProductStockMutation = useCallback\(\(loader, label\) => \([\s\S]*withLoaderTimeout\(loader, label, PRODUCT_STOCK_MUTATION_TIMEOUT_MS\)/,
  'products page stock mutations should route through the timeout helper',
)
assert.doesNotMatch(
  products,
  /await\s+window\.api\.(adjustStock|transferStock|createProduct|updateProduct|deleteProduct)\(/,
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
  /withLoaderTimeout\(\(\) => loadSuppliersFromApi\(\), 'Product suppliers', PRODUCT_SUPPLIERS_TIMEOUT_MS\)/,
  'product supplier options should timeout slow supplier reads',
)
assert.match(
  productForm,
  /const PRODUCT_FORM_IMAGE_UPLOAD_TIMEOUT_MS = 30000/,
  'product form image uploads should use an explicit timeout',
)
assert.match(
  productForm,
  /withLoaderTimeout\(\s*\(\) => api\.uploadProductImage\(\{[\s\S]*productId: currentProductId \|\| null,[\s\S]*file,[\s\S]*fileName: file\.name \|\| 'product\.jpg',[\s\S]*\}\),\s*'Upload product form image',\s*PRODUCT_FORM_IMAGE_UPLOAD_TIMEOUT_MS,\s*\)/,
  'product form image uploads should timeout slow uploads',
)
assert.match(
  products,
  /withLoaderTimeout\(\(\) => window\.api\.getCategories\(\), 'Product categories', PRODUCTS_AUX_OPTIONS_TIMEOUT_MS\)/,
  'products auxiliary category reads should timeout slow category requests',
)
assert.match(
  products,
  /withLoaderTimeout\(\(\) => window\.api\.getUnits\(\), 'Product units', PRODUCTS_AUX_OPTIONS_TIMEOUT_MS\)/,
  'products auxiliary unit reads should timeout slow unit requests',
)
assert.match(
  products,
  /withLoaderTimeout\(\(\) => window\.api\.getBranches\(\), 'Product branches', PRODUCTS_AUX_OPTIONS_TIMEOUT_MS\)/,
  'products auxiliary branch reads should timeout slow branch requests',
)
assert.match(
  products,
  /withLoaderTimeout\(\(\) => window\.api\.getProductFilters\(\{\}\), 'Product filters', PRODUCTS_FILTER_META_TIMEOUT_MS\)/,
  'products filter metadata should timeout slow filter requests',
)
assert.match(
  products,
  /withLoaderTimeout\(\s*\(\) => window\.api\.getProductsByIds\(uniqueIds, \{ include: 'branch_stock,images,batches' \}\),\s*'Products by id',\s*PRODUCTS_BY_ID_TIMEOUT_MS,\s*\)/,
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
  /withLoaderTimeout\(\(\) => window\.api\.getSuppliers\(\), 'Product suppliers'[\s\S]{0,260}catch \{[\s\S]{0,160}setSupplierList\(\[\]\)/,
  'product supplier options should keep previously loaded options on refresh failure',
)
assert.doesNotMatch(
  products,
  /withLoaderTimeout\(\(\) => window\.api\.getProductFilters\(\{\}\), 'Product filters'[\s\S]{0,260}catch[\s\S]{0,180}setProductFilterMeta\(\{[\s\S]{0,120}brands: \[\]/,
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
  /withLoaderTimeout\(\s*\(\) => Promise\.all\(\[[\s\S]*window\.api\.searchProducts\(productQuery\),[\s\S]*window\.api\.getCategories\(\),[\s\S]*window\.api\.getBranches\(\),[\s\S]*window\.api\.getProductFilters\(\{\}\),[\s\S]*\]\),\s*label,\s*POS_CATALOG_LOAD_TIMEOUT_MS,\s*\)/,
  'POS catalog reads should timeout the batched product, category, branch, and filter requests',
)
assert.match(
  pos,
  /const POS_CONTACT_OPTIONS_TIMEOUT_MS = 8000/,
  'POS customer and delivery option reads should use an explicit timeout',
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
  /withLoaderTimeout\(\s*\(\) => window\.api\.lookupPortalMembership\(membershipNumber\),\s*label,\s*POS_MEMBERSHIP_LOOKUP_TIMEOUT_MS,\s*\)/,
  'POS membership lookup should timeout slow membership reads',
)
assert.match(
  pos,
  /withLoaderTimeout\(\s*\(\) => window\.api\.createCustomer\(newCustomerForm\),\s*'Create POS customer',\s*POS_CUSTOMER_CREATE_TIMEOUT_MS,\s*\)/,
  'POS quick-add customer writes should timeout slow creates',
)
assert.match(
  pos,
  /withLoaderTimeout\(\s*\(\) => window\.api\.createDeliveryContact\(payload\),\s*'Create POS delivery contact',\s*POS_DELIVERY_CREATE_TIMEOUT_MS,\s*\)/,
  'POS quick-add delivery writes should timeout slow creates',
)
assert.match(
  pos,
  /withLoaderTimeout\(\s*\(\) => window\.api\.createSale\(saleData\),\s*'Create POS sale',\s*POS_CHECKOUT_TIMEOUT_MS,\s*\)/,
  'POS checkout should timeout slow sale creation',
)
assert.match(
  pos,
  /membershipInfoRef\.current\?\.customer\?\.membership_number[\s\S]{0,260}return membershipInfoRef\.current/,
  'POS membership lookup should keep the last confirmed membership panel visible through a transient same-member refresh failure',
)
assert.match(
  pos,
  /withLoaderTimeout\(\(\) => window\.api\.getCustomers\(\), label, POS_CONTACT_OPTIONS_TIMEOUT_MS\)/,
  'POS customer option reads should timeout slow customer requests',
)
assert.doesNotMatch(
  pos,
  /catch \(error\) \{[\s\S]{0,260}setCustomers\(\[\]\)/,
  'POS customer option reads should keep previous customers visible when a refresh fails',
)
assert.match(
  pos,
  /withLoaderTimeout\(\(\) => window\.api\.getDeliveryContacts\(\), label, POS_CONTACT_OPTIONS_TIMEOUT_MS\)/,
  'POS delivery option reads should timeout slow delivery contact requests',
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
  /window\.api\.getProducts\(\)/,
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
  /window\.api\.getProducts\(\)/,
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
  /window\.api\.getProducts\(\)/,
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
