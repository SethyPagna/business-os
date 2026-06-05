// @ts-nocheck

// Legacy domain API registry. This file is now a TypeScript module so callers,
// tests, and bundling use the same extension path; the next slices should move
// typed domain groups out of this boundary and remove ts-nocheck.
function getDeviceInfo() {
  return getClientDeviceInfo()
}

let portalTransportPromise = null
let localDbModulePromise = null
let saleWriteTransportPromise = null
let csvTemplatePromise = null
let browserDialogsPromise = null

function loadPortalTransport() {
  if (!portalTransportPromise) portalTransportPromise = import('./portalTransport.ts')
  return portalTransportPromise
}

function loadSaleWriteTransport() {
  if (!saleWriteTransportPromise) saleWriteTransportPromise = import('./saleWriteTransport.ts')
  return saleWriteTransportPromise
}

function loadLocalDbModule() {
  if (!localDbModulePromise) localDbModulePromise = import('./localDb.ts')
  return localDbModulePromise
}

function loadCsvTemplateModule() {
  if (!csvTemplatePromise) csvTemplatePromise = import('../utils/csvTemplate.ts')
  return csvTemplatePromise
}

function loadBrowserDialogsModule() {
  if (!browserDialogsPromise) browserDialogsPromise = import('./browserDialogs.ts')
  return browserDialogsPromise
}

async function buildImportCsvTemplate(headers, filename) {
  const { buildCSVTemplate } = await loadCsvTemplateModule()
  return buildCSVTemplate(headers, filename)
}

async function getLocalDb() {
  const { dexieDb } = await loadLocalDbModule()
  return dexieDb
}

async function localGetSettings() {
  const { localGetSettings: readSettings } = await loadLocalDbModule()
  return readSettings()
}

async function localSaveSettings(updates) {
  const { localSaveSettings: writeSettings } = await loadLocalDbModule()
  return writeSettings(updates)
}

async function localSaveSettingsMeta(updatedAt) {
  const { localSaveSettingsMeta: writeSettingsMeta } = await loadLocalDbModule()
  return writeSettingsMeta(updatedAt)
}

/**
 * api/methods.ts — All window.api domain methods.
 *
 * Each method calls route() with a server function (apiFetch) and,
 * where available, a local Dexie fallback for offline-first reads.
 */

import {
  apiFetch,
  route,
  getSyncServerUrl,
  cacheInvalidate,
  cacheClearAll,
  isWriteConflictError,
  isInvalidSessionError,
  isServerOnline,
} from './http.ts'
import { appendQuery, buildQueryString } from './query.ts'
import { resetClientRuntimeState } from '../platform/runtime/clientRuntime.ts'
import { getClientDeviceInfo } from '../utils/deviceInfo.ts'
import { refreshAppData } from '../utils/appRefresh.ts'
import {
  CATEGORY_REFRESH_CHANNELS,
  getSettingsRefreshChannels,
  UNIT_REFRESH_CHANNELS,
} from '../utils/settingsRefresh.ts'
import { buildAttemptedReturnItems, buildAttemptedSettings } from './conflicts.ts'
import { ensureClientRequestId } from './requestIds.ts'
import { serializePendingSyncPreview } from './syncPreview.ts'
import {
  createCategory as createCategoryRequest,
  createUnit as createUnitRequest,
  deleteCategory as deleteCategoryRequest,
  deleteUnit as deleteUnitRequest,
  getCategories as getCategoriesRequest,
  getUnits as getUnitsRequest,
  updateCategory as updateCategoryRequest,
  updateUnit as updateUnitRequest,
} from './lookupTransport.ts'
import {
  createBranch as createBranchRequest,
  deleteBranch as deleteBranchRequest,
  getBranches as getBranchesRequest,
  getBranchStock as getBranchStockRequest,
  getBranchStockIntegrity as getBranchStockIntegrityRequest,
  getBranchSummary as getBranchSummaryRequest,
  getTransfers as getTransfersRequest,
  repairBranchStockIntegrity as repairBranchStockIntegrityRequest,
  transferStock as transferStockRequest,
  updateBranch as updateBranchRequest,
} from './branchTransport.ts'
import {
  getProductFilters as getProductFiltersRequest,
  getProductBootstrap as getProductBootstrapRequest,
  getProductLookupUsage as getProductLookupUsageRequest,
  getProducts as getProductsRequest,
  getProductsByIds as getProductsByIdsRequest,
  replaceProductLookupValues as replaceProductLookupValuesRequest,
  searchProducts as searchProductsRequest,
} from './productReadTransport.ts'
import {
  bulkImportProducts as bulkImportProductsRequest,
  createProduct as createProductRequest,
  createProductVariant as createProductVariantRequest,
  deleteProduct as deleteProductRequest,
  updateProduct as updateProductRequest,
} from './productWriteTransport.ts'
import {
  createAiProvider as createAiProviderRequest,
  deleteAiProvider as deleteAiProviderRequest,
  getAiProviders as getAiProvidersRequest,
  getAiResponses as getAiResponsesRequest,
  testAiProvider as testAiProviderRequest,
  updateAiProvider as updateAiProviderRequest,
} from './aiTransport.ts'
import {
  createActionHistory as createActionHistoryRequest,
  getActionHistory as getActionHistoryRequest,
  redoActionHistory as redoActionHistoryRequest,
  undoActionHistory as undoActionHistoryRequest,
  updateActionHistory as updateActionHistoryRequest,
} from './actionHistoryTransport.ts'
import {
  getInventoryBootstrap as getInventoryBootstrapRequest,
  getInventoryMovements as getInventoryMovementsRequest,
  getInventoryReasons as getInventoryReasonsRequest,
  getInventoryStats as getInventoryStatsRequest,
  getInventorySummary as getInventorySummaryRequest,
  searchInventoryProducts as searchInventoryProductsRequest,
} from './inventoryTransport.ts'
import {
  adjustStock as adjustStockRequest,
  moveStockRow as moveStockRowRequest,
  saveInventoryReasons as saveInventoryReasonsRequest,
  transferInventoryStock as transferInventoryStockRequest,
} from './inventoryWriteTransport.ts'
import {
  applyRfidSession as applyRfidSessionRequest,
  createRfidSession as createRfidSessionRequest,
  createRfidTag as createRfidTagRequest,
  getRfidSessionReview as getRfidSessionReviewRequest,
  getRfidStatus as getRfidStatusRequest,
  recordRfidSessionEvents as recordRfidSessionEventsRequest,
  searchRfidTags as searchRfidTagsRequest,
} from './rfidTransport.ts'
import {
  approveImportJob as approveImportJobRequest,
  cancelImportJob as cancelImportJobRequest,
  createImportJob as createImportJobRequest,
  deleteImportJob as deleteImportJobRequest,
  downloadImportJobErrors as downloadImportJobErrorsRequest,
  getImportJob as getImportJobRequest,
  getImportJobReview as getImportJobReviewRequest,
  getImportQueueStatus as getImportQueueStatusRequest,
  listImportJobs as listImportJobsRequest,
  preflightImportJob as preflightImportJobRequest,
  retryImportJob as retryImportJobRequest,
  startImportJob as startImportJobRequest,
  updateImportJobDecisions as updateImportJobDecisionsRequest,
  uploadImportJobCsv as uploadImportJobCsvRequest,
  uploadImportJobImages as uploadImportJobImagesRequest,
  uploadImportJobZip as uploadImportJobZipRequest,
} from './importJobsTransport.ts'
import {
  deleteFileAsset as deleteFileAssetRequest,
  getFiles as getFilesRequest,
  uploadFileAsset as uploadFileAssetRequest,
  uploadProductImage as uploadProductImageRequest,
  uploadUserAvatar as uploadUserAvatarRequest,
} from './fileTransport.ts'
import {
  bulkImportCustomers as bulkImportCustomersRequest,
  bulkImportDeliveryContacts as bulkImportDeliveryContactsRequest,
  bulkImportSuppliers as bulkImportSuppliersRequest,
  createCustomer as createCustomerRequest,
  createDeliveryContact as createDeliveryContactRequest,
  createSupplier as createSupplierRequest,
  deleteCustomer as deleteCustomerRequest,
  deleteDeliveryContact as deleteDeliveryContactRequest,
  deleteSupplier as deleteSupplierRequest,
  downloadCustomerTemplate as downloadCustomerTemplateRequest,
  downloadSupplierTemplate as downloadSupplierTemplateRequest,
  getCustomerPointSummaries as getCustomerPointSummariesRequest,
  getCustomers as getCustomersRequest,
  getDeliveryContacts as getDeliveryContactsRequest,
  getSuppliers as getSuppliersRequest,
  updateCustomer as updateCustomerRequest,
  updateDeliveryContact as updateDeliveryContactRequest,
  updateSupplier as updateSupplierRequest,
} from './contactsTransport.ts'
import {
  changeUserPassword as changeUserPasswordRequest,
  createRole as createRoleRequest,
  createUser as createUserRequest,
  deleteRole as deleteRoleRequest,
  disconnectUserAuthProvider as disconnectUserAuthProviderRequest,
  getRoles as getRolesRequest,
  getUserAuthMethods as getUserAuthMethodsRequest,
  getUserProfile as getUserProfileRequest,
  getUsers as getUsersRequest,
  resetPassword as resetPasswordRequest,
  updateRole as updateRoleRequest,
  updateUser as updateUserRequest,
  updateUserProfile as updateUserProfileRequest,
} from './accessControlTransport.ts'
import {
  createCustomTable as createCustomTableRequest,
  deleteCustomRow as deleteCustomRowRequest,
  getCustomTableData as getCustomTableDataRequest,
  getCustomTables as getCustomTablesRequest,
  insertCustomRow as insertCustomRowRequest,
  updateCustomRow as updateCustomRowRequest,
} from './customTablesTransport.ts'
import {
  deleteAuditLogsRetention as deleteAuditLogsRetentionRequest,
  getAuditLogs as getAuditLogsRequest,
} from './auditLogTransport.ts'
import {
  getAnalytics as getAnalyticsRequest,
  getDashboard as getDashboardRequest,
} from './dashboardTransport.ts'
import {
  getSales as getSalesRequest,
} from './salesTransport.ts'
import {
  completeGoogleOauth as completeGoogleOauthRequest,
  completePasswordReset as completePasswordResetRequest,
  getCurrentOrganization as getCurrentOrganizationRequest,
  getOrganizationBootstrap as getOrganizationBootstrapRequest,
  getVerificationCapabilities as getVerificationCapabilitiesRequest,
  login as loginRequest,
  logout as logoutRequest,
  otpConfirm as otpConfirmRequest,
  otpDisable as otpDisableRequest,
  otpSetup as otpSetupRequest,
  otpStatus as otpStatusRequest,
  otpVerify as otpVerifyRequest,
  requestPasswordResetEmail as requestPasswordResetEmailRequest,
  resetPasswordWithOtp as resetPasswordWithOtpRequest,
  searchOrganizations as searchOrganizationsRequest,
  startGoogleOauth as startGoogleOauthRequest,
  unlinkGoogleOauth as unlinkGoogleOauthRequest,
  updateSessionDuration as updateSessionDurationRequest,
} from './authTransport.ts'
import { getNotificationSummary as getNotificationSummaryRequest } from './notificationSummary.ts'
import {
  disconnectGoogleDriveSync as disconnectGoogleDriveSyncRequest,
  forgetGoogleDriveSyncCredentials as forgetGoogleDriveSyncCredentialsRequest,
  getGoogleDriveSyncStatus as getGoogleDriveSyncStatusRequest,
  queueGoogleDriveSyncNow as queueGoogleDriveSyncNowRequest,
  saveGoogleDriveSyncPreferences as saveGoogleDriveSyncPreferencesRequest,
  startGoogleDriveSyncOauth as startGoogleDriveSyncOauthRequest,
  syncGoogleDriveNow as syncGoogleDriveNowRequest,
} from './driveSync.ts'
import {
  clearCachedQueryResults,
} from './queryCache.ts'
import { withExpectedUpdatedAt, withSettingsExpectedUpdatedAt } from './expectedUpdatedAt.ts'
import { mirrorTable, purgeSensitiveLiveServerMirrors, routeMirrored } from './localMirrors.ts'
import {
  DISCARD_SYNC_UPDATE_CHANNELS,
  dispatchSyncUpdates,
  emitSyncQueueChanged,
  hasStoredUserSession,
} from './syncRuntime.ts'
import {
  cancelSystemJob as cancelSystemJobRequest,
  getSystemJob as getSystemJobRequest,
  pollSystemJob as pollSystemJobRequest,
  queueBackupFolderExport as queueBackupFolderExportRequest,
  queueBackupFolderRestore as queueBackupFolderRestoreRequest,
} from './systemJobs.ts'

export async function openCSVDialog() {
  const { openCSVDialog: openBrowserCSVDialog } = await loadBrowserDialogsModule()
  return openBrowserCSVDialog()
}

export async function openImageDialog() {
  const { openImageDialog: openBrowserImageDialog } = await loadBrowserDialogsModule()
  return openBrowserImageDialog()
}

export async function getImageDataUrl(path) {
  const { getImageDataUrl: getBrowserImageDataUrl } = await loadBrowserDialogsModule()
  return getBrowserImageDataUrl(path)
}

const OFFLINE_DEVICE_SNAPSHOT_META_KEY = 'offline_device_snapshot_meta'
const OFFLINE_DEVICE_SNAPSHOT_MIN_INTERVAL_MS = 5 * 60_000
const SENSITIVE_MIRROR_PURGE_DELAY_MS = 15_000
const SENSITIVE_MIRROR_PURGE_IDLE_TIMEOUT_MS = 30_000
let offlineDeviceSnapshotPromise = null
let systemRuntimeModulePromise = null

function loadSystemRuntimeModule() {
  if (!systemRuntimeModulePromise) systemRuntimeModulePromise = import('./systemRuntime.ts')
  return systemRuntimeModulePromise
}

async function callSystemRuntimeMethod(name, ...args) {
  const module = await loadSystemRuntimeModule()
  const fn = module?.[name]
  if (typeof fn !== 'function') throw new Error(`System runtime method ${name} is not available.`)
  return fn(...args)
}

function scheduleSensitiveMirrorPurge() {
  const run = () => {
    purgeSensitiveLiveServerMirrors().catch(() => {})
  }
  if (typeof window === 'undefined') {
    run()
    return
  }
  window.setTimeout(() => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(run, { timeout: SENSITIVE_MIRROR_PURGE_IDLE_TIMEOUT_MS })
      return
    }
    run()
  }, SENSITIVE_MIRROR_PURGE_DELAY_MS)
}

export async function discardPendingSyncQueue(reason = 'Offline changes were cleared.') {
  const db = await getLocalDb()
  const existing = await db.sync_queue.toArray().catch(() => [])
  await db.sync_queue.clear().catch(() => {})
  emitSyncQueueChanged({ reason, discarded: existing.length })
  dispatchSyncUpdates(DISCARD_SYNC_UPDATE_CHANNELS, 'discard-pending-sync-queue')
  return {
    success: true,
    discarded: existing.length,
    reason,
  }
}

export async function getPendingSyncState() {
  const db = await getLocalDb()
  const items = await db.sync_queue
    .orderBy('_seq')
    .toArray()
    .catch(() => [])
  const sorted = [...items].sort((a, b) => {
    const byCreated = String(a?.created_at || '').localeCompare(String(b?.created_at || ''))
    if (byCreated !== 0) return byCreated
    return Number(a?._seq || 0) - Number(b?._seq || 0)
  })
  const counts = sorted.reduce((acc, item) => {
    const status = String(item?.status || 'pending')
    acc.total += 1
    if (status === 'syncing') acc.syncing += 1
    else if (status === 'conflict') acc.conflict += 1
    else if (status === 'failed') acc.failed += 1
    else acc.pending += 1
    return acc
  }, { total: 0, pending: 0, syncing: 0, failed: 0, conflict: 0 })
  const oldest = sorted[0]?.created_at || null
  return {
    ...counts,
    oldest_created_at: oldest,
    writes_require_server: true,
    items: serializePendingSyncPreview(sorted),
  }
}

export async function retryPendingSyncNow() {
  const { syncPendingSalesQueue } = await loadSaleWriteTransport()
  return syncPendingSalesQueue({ force: true })
}

function canRefreshOfflineDeviceSnapshot(options = {}) {
  if (!getSyncServerUrl() || !hasStoredUserSession()) return false
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  if (!options.force && !isServerOnline()) return false
  return true
}

async function readOfflineDeviceSnapshotMeta() {
  try {
    const db = await getLocalDb()
    return (await db.settings.get(OFFLINE_DEVICE_SNAPSHOT_META_KEY))?.value || ''
  } catch (_) {
    return ''
  }
}

async function writeOfflineDeviceSnapshotMeta(meta = {}) {
  const db = await getLocalDb()
  const value = JSON.stringify({
    refreshedAt: new Date().toISOString(),
    ...meta,
  })
  await db.settings.put({
    key: OFFLINE_DEVICE_SNAPSHOT_META_KEY,
    value,
  }).catch(() => {})
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sync:offline-snapshot-refreshed', {
      detail: { ...meta, ts: Date.now() },
    }))
  }
  return value
}

async function runOfflineSnapshotStep(label, fn, results) {
  try {
    await fn()
    results.refreshed.push(label)
  } catch (error) {
    results.failed.push({
      label,
      error: error?.message || String(error || 'Failed'),
    })
  }
}

export async function refreshOfflineDeviceSnapshot(options = {}) {
  if (!canRefreshOfflineDeviceSnapshot(options)) {
    return { skipped: true, reason: 'server_or_device_offline' }
  }
  if (offlineDeviceSnapshotPromise) return offlineDeviceSnapshotPromise

  offlineDeviceSnapshotPromise = (async () => {
    const previousMetaRaw = await readOfflineDeviceSnapshotMeta()
    const previousMeta = (() => {
      try { return JSON.parse(previousMetaRaw || '{}') || {} } catch (_) { return {} }
    })()
    const previousMs = previousMeta?.refreshedAt ? Date.parse(previousMeta.refreshedAt) : 0
    if (!options.force && previousMs && Date.now() - previousMs < OFFLINE_DEVICE_SNAPSHOT_MIN_INTERVAL_MS) {
      return {
        skipped: true,
        reason: 'recently_refreshed',
        refreshedAt: previousMeta.refreshedAt,
      }
    }

    const results = { refreshed: [], failed: [] }
    await runOfflineSnapshotStep('settings', () => getSettings({ force: true }), results)
    await runOfflineSnapshotStep('categories', () => getCategories(), results)
    await runOfflineSnapshotStep('units', () => getUnits(), results)
    await runOfflineSnapshotStep('branches', () => getBranches(), results)
    await runOfflineSnapshotStep('products', () => getProducts(), results)
    await runOfflineSnapshotStep('customers', () => getCustomers(), results)
    await runOfflineSnapshotStep('suppliers', () => getSuppliers(), results)
    await runOfflineSnapshotStep('delivery_contacts', () => getDeliveryContacts(), results)
    await runOfflineSnapshotStep('sales', () => getSales({}), results)
    await runOfflineSnapshotStep('returns', () => getReturns({}), results)
    await runOfflineSnapshotStep('inventory_movements', () => getInventoryMovements({}, 5000), results)

    const meta = {
      refreshed: results.refreshed,
      failed: results.failed,
      success: results.refreshed.length,
      failedCount: results.failed.length,
    }
    await writeOfflineDeviceSnapshotMeta(meta)
    return {
      skipped: false,
      ...meta,
    }
  })()

  try {
    return await offlineDeviceSnapshotPromise
  } finally {
    offlineDeviceSnapshotPromise = null
  }
}

async function invalidateClientRuntimeState(reason = 'server-mutation') {
  await resetClientRuntimeState({
    clearAuth: false,
    preserveDeviceSettings: true,
    preserveSyncServer: true,
    preserveSessionDuration: true,
    preserveRuntimeMeta: false,
  }).catch(() => {})
  cacheClearAll()
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sync:update', {
      detail: { channel: 'runtime', reason, ts: Date.now() },
    }))
  }
}

if (typeof window !== 'undefined') {
  scheduleSensitiveMirrorPurge()
  window.addEventListener('sync:update', (event) => {
    const channel = String(event?.detail?.channel || '').trim().toLowerCase()
    if (!channel) return
    if (['products', 'categories', 'units', 'settings'].includes(channel)) {
      void clearCachedQueryResults(['products:search:', 'products:filters:', 'products:lookups:usage'])
    }
    if (['inventory', 'products', 'branches', 'sales', 'returns'].includes(channel)) {
      void clearCachedQueryResults(['inventory:products:search:'])
    }
  })
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
export const login = (payload) =>
  loginRequest(payload)
export const logout = () =>
  logoutRequest()
export const resetPasswordWithOtp = (payload) =>
  resetPasswordWithOtpRequest(payload)
export const requestPasswordResetEmail = (payload) =>
  requestPasswordResetEmailRequest(payload)
export const completePasswordReset = (payload) =>
  completePasswordResetRequest(payload)
export const updateSessionDuration = (payload) =>
  updateSessionDurationRequest(payload)
export const getVerificationCapabilities = () =>
  getVerificationCapabilitiesRequest()
export const getSystemConfig = () =>
  callSystemRuntimeMethod('getSystemConfig')
export const getSystemBootstrap = () =>
  callSystemRuntimeMethod('getSystemBootstrap')
export async function getNotificationSummary() {
  return getNotificationSummaryRequest()
}
export const getSystemDebugLog = () =>
  callSystemRuntimeMethod('getSystemDebugLog')
export const startGoogleOauth = (payload) =>
  startGoogleOauthRequest(payload)
export const completeGoogleOauth = (payload) =>
  completeGoogleOauthRequest(payload)
export const unlinkGoogleOauth = (payload) =>
  unlinkGoogleOauthRequest(payload)
export const getAppBootstrap = async () => {
  const { getAppBootstrap: getAppBootstrapRequest } = await import('./appBootstrapTransport.ts')
  return getAppBootstrapRequest()
}
export const getOrganizationBootstrap = () =>
  getOrganizationBootstrapRequest()
export const searchOrganizations = (query) =>
  searchOrganizationsRequest(query)
export const getCurrentOrganization = () =>
  getCurrentOrganizationRequest()

// ─── Settings ─────────────────────────────────────────────────────────────────
export async function getSettings(options = {}) {
  if (options?.force) {
    cacheInvalidate('settings')
  }
  return routeMirrored('settings:get', async () => {
    const settingsResponse = await apiFetch('GET', '/api/settings')
    const {
      updatedAt: inlineUpdatedAt,
      ...settings
    } = settingsResponse || {}
    if (inlineUpdatedAt) {
      await localSaveSettingsMeta(inlineUpdatedAt).catch(() => {})
    }
    return settings
  }, localGetSettings, async (settings) => {
    await localSaveSettings(settings)
    return settings
  })
}
let settingsSaveQueue = Promise.resolve()

export async function saveSettings(updates, options = {}) {
  const runSave = async () => {
    const attempted = buildAttemptedSettings(updates)
    const refreshChannels = getSettingsRefreshChannels(attempted, options?.refreshChannels)
    const refreshDetail = {
      reason: String(options?.reason || 'settings-saved').trim() || 'settings-saved',
      source: String(options?.source || 'settings:save').trim() || 'settings:save',
    }
    let payload = options?.skipExpectedUpdatedAt ? { ...updates } : await withSettingsExpectedUpdatedAt(updates)
    try {
      const result = await route('settings:save', () => apiFetch('POST', '/api/settings', payload), null, true)
      if (result?.updatedAt) {
        await localSaveSettingsMeta(result.updatedAt).catch(() => {})
      }
      await localSaveSettings(updates).catch(() => {})
      refreshAppData(refreshChannels, refreshDetail)
      return result
    } catch (error) {
      const attemptedSettings = error?.attempted || attempted
      const attemptedKeys = Object.keys(attemptedSettings || {})
      if (
        isWriteConflictError(error)
        && error?.actualUpdatedAt
        && attemptedKeys.length > 0
        && attemptedKeys.length <= 2
      ) {
        let nextExpectedUpdatedAt = error.actualUpdatedAt
        for (let retryAttempt = 0; retryAttempt < 3 && nextExpectedUpdatedAt; retryAttempt += 1) {
          const retryPayload = {
            ...attemptedSettings,
            expectedUpdatedAt: nextExpectedUpdatedAt,
          }
          try {
            const retryResult = await route('settings:save', () => apiFetch('POST', '/api/settings', retryPayload), null, true)
            if (retryResult?.updatedAt) {
              await localSaveSettingsMeta(retryResult.updatedAt).catch(() => {})
            }
            await localSaveSettings(attemptedSettings).catch(() => {})
            refreshAppData(refreshChannels, refreshDetail)
            return retryResult
          } catch (retryError) {
            error = retryError
            if (!isWriteConflictError(retryError) || !retryError?.actualUpdatedAt) break
            nextExpectedUpdatedAt = retryError.actualUpdatedAt
          }
        }
      }
      error.attempted = error?.attempted || attemptedSettings
      if (error?.actualUpdatedAt) {
        await localSaveSettingsMeta(error.actualUpdatedAt).catch(() => {})
      }
      if (error?.currentSettings && typeof error.currentSettings === 'object') {
        await localSaveSettings(error.currentSettings).catch(() => {})
      }
      throw error
    }
  }

  const queuedSave = settingsSaveQueue.catch(() => {}).then(runSave)
  settingsSaveQueue = queuedSave.catch(() => {})
  return queuedSave
}

// ─── Categories ───────────────────────────────────────────────────────────────
export const getCategories = () =>
  getCategoriesRequest()
export const createCategory = async payload => {
  const result = await createCategoryRequest(payload)
  refreshAppData(CATEGORY_REFRESH_CHANNELS, { reason: 'category-saved', source: 'categories:create' })
  return result
}
export const updateCategory = async (id, payload) => {
  const result = await updateCategoryRequest(id, payload)
  refreshAppData(CATEGORY_REFRESH_CHANNELS, { reason: 'category-saved', source: 'categories:update' })
  return result
}
export const deleteCategory = async (id, payload) => {
  const result = await deleteCategoryRequest(id, payload)
  refreshAppData(CATEGORY_REFRESH_CHANNELS, { reason: 'category-deleted', source: 'categories:delete' })
  return result
}

// ─── Units ────────────────────────────────────────────────────────────────────
export const getUnits = () =>
  getUnitsRequest()
export const createUnit = async payload => {
  const result = await createUnitRequest(payload)
  refreshAppData(UNIT_REFRESH_CHANNELS, { reason: 'unit-saved', source: 'units:create' })
  return result
}
export const updateUnit = async (id, payload) => {
  const result = await updateUnitRequest(id, payload)
  refreshAppData(UNIT_REFRESH_CHANNELS, { reason: 'unit-saved', source: 'units:update' })
  return result
}
export const deleteUnit = async (id, payload) => {
  const result = await deleteUnitRequest(id, payload)
  refreshAppData(UNIT_REFRESH_CHANNELS, { reason: 'unit-deleted', source: 'units:delete' })
  return result
}

// ─── Branches ─────────────────────────────────────────────────────────────────
export const getBranches = () =>
  getBranchesRequest()
export const getBranchSummary = () =>
  getBranchSummaryRequest()
export const createBranch = payload =>
  createBranchRequest(payload)
export const updateBranch = (id, payload) =>
  updateBranchRequest(id, payload)
export const deleteBranch = (id, userId, userName) =>
  deleteBranchRequest(id, userId, userName)
export const getBranchStock = (id, params = {}) =>
  getBranchStockRequest(id, params)
export const getTransfers = () =>
  getTransfersRequest()
export const transferStock = payload =>
  transferStockRequest(payload)
export const getBranchStockIntegrity = () =>
  getBranchStockIntegrityRequest()
export const repairBranchStockIntegrity = payload =>
  repairBranchStockIntegrityRequest(payload)

// ─── Products ─────────────────────────────────────────────────────────────────
export const getProducts = () =>
  getProductsRequest()
export const searchProducts = (params = {}) =>
  searchProductsRequest(params)
export const getProductBootstrap = (params = {}) =>
  getProductBootstrapRequest(params)
export const getProductsByIds = (ids = [], params = {}) =>
  getProductsByIdsRequest(ids, params)
export const getProductFilters = (params = {}) =>
  getProductFiltersRequest(params)
export const getProductLookupUsage = () =>
  getProductLookupUsageRequest()
export const replaceProductLookupValues = (payload = {}) =>
  replaceProductLookupValuesRequest(payload)
export async function getCatalogMeta() {
  const module = await loadPortalTransport()
  return module.getCatalogMeta()
}
export async function getCatalogProducts() {
  const module = await loadPortalTransport()
  return module.getCatalogProducts()
}
export async function getPortalConfig() {
  const module = await loadPortalTransport()
  return module.getPortalConfig()
}
export async function getPortalBootstrap() {
  const module = await loadPortalTransport()
  return module.getPortalBootstrap()
}
export async function getPortalCatalogMeta() {
  const module = await loadPortalTransport()
  return module.getPortalCatalogMeta()
}
export async function getPortalCatalogProducts() {
  const module = await loadPortalTransport()
  return module.getPortalCatalogProducts()
}
export async function searchPortalCatalogProducts(params = {}) {
  const module = await loadPortalTransport()
  return module.searchPortalCatalogProducts(params)
}
export async function lookupPortalMembership(membershipNumber) {
  const module = await loadPortalTransport()
  return module.lookupPortalMembership(membershipNumber)
}
export async function createPortalSubmission(payload) {
  const module = await loadPortalTransport()
  return module.createPortalSubmission(payload)
}
export async function getPortalAiStatus() {
  const module = await loadPortalTransport()
  return module.getPortalAiStatus()
}
export async function askPortalAi(payload) {
  const module = await loadPortalTransport()
  return module.askPortalAi(payload)
}
export const getPortalSubmissionsForReview = async () => {
  const module = await loadPortalTransport()
  return module.getPortalSubmissionsForReview()
}
export const reviewPortalSubmission = async (id, payload) => {
  const module = await loadPortalTransport()
  return module.reviewPortalSubmission(id, payload)
}

export const getAiProviders = () =>
  getAiProvidersRequest()
export const createAiProvider = (payload) =>
  createAiProviderRequest(payload)
export const updateAiProvider = (id, payload) =>
  updateAiProviderRequest(id, payload)
export const deleteAiProvider = (id, payload) =>
  deleteAiProviderRequest(id, payload)
export const testAiProvider = (id, payload) =>
  testAiProviderRequest(id, payload)
export const getAiResponses = (limit = 80) =>
  getAiResponsesRequest(limit)
export const createProduct = (payload) =>
  createProductRequest(payload)
export const updateProduct = (id, payload) =>
  updateProductRequest(id, payload)
export const deleteProduct = (id) =>
  deleteProductRequest(id)

// ─── OTP / 2FA ────────────────────────────────────────────────────────────────
export const otpSetup = (payload) =>
  otpSetupRequest(payload)
export const otpConfirm = (payload) =>
  otpConfirmRequest(payload)
export const otpDisable = (payload) =>
  otpDisableRequest(payload)
export const otpVerify = (payload) =>
  otpVerifyRequest(payload)
export const otpStatus = (id) =>
  otpStatusRequest(id)

// ─── Product Variants ─────────────────────────────────────────────────────────
export const createProductVariant = payload =>
  createProductVariantRequest(payload)

export const bulkImportProducts = payload =>
  bulkImportProductsRequest(payload)

export const createImportJob = payload =>
  createImportJobRequest(payload)
export const listImportJobs = (params = {}) =>
  listImportJobsRequest(params)
export const getImportJob = id =>
  getImportJobRequest(id)
export const getImportJobReview = (id, params = {}) =>
  getImportJobReviewRequest(id, params)
export const updateImportJobDecisions = (id, decisions = {}) =>
  updateImportJobDecisionsRequest(id, decisions)
export const preflightImportJob = id =>
  preflightImportJobRequest(id)
export const startImportJob = (id, options = {}) =>
  startImportJobRequest(id, options)
export const approveImportJob = (id, options = {}) =>
  approveImportJobRequest(id, options)
export const cancelImportJob = (id, options = {}) =>
  cancelImportJobRequest(id, options)
export const retryImportJob = (id, options = {}) =>
  retryImportJobRequest(id, options)
export const deleteImportJob = (id, options = {}) =>
  deleteImportJobRequest(id, options)
export const getImportQueueStatus = () =>
  getImportQueueStatusRequest()
export const downloadImportJobErrors = jobId =>
  downloadImportJobErrorsRequest(jobId)
export const uploadImportJobCsv = payload =>
  uploadImportJobCsvRequest(payload)
export const uploadImportJobZip = payload =>
  uploadImportJobZipRequest(payload)
export const uploadImportJobImages = payload =>
  uploadImportJobImagesRequest(payload)

export const getFiles = (params = {}) =>
  getFilesRequest(params)

export const uploadFileAsset = payload =>
  uploadFileAssetRequest(payload)

export const deleteFileAsset = (id, payload = {}) =>
  deleteFileAssetRequest(id, payload)

export const uploadProductImage = payload =>
  uploadProductImageRequest(payload)

export const uploadUserAvatar = payload =>
  uploadUserAvatarRequest(payload)
// ─── CSV / file dialog (browser implementations) ──────────────────────────────
/**
 * openCSVDialog — opens a file picker, reads the selected CSV, and returns
 * { content: string } — same shape as the Electron preload's openCSVDialog.
 */


/**
 * openImageDialog — in browser mode always returns null so Products.tsx
 * falls through to its own file-input fallback.
 */


/**
 * getImageDataUrl — not needed in browser (images served via /uploads/).
 * Returns null so callers fall back gracefully.
 */


/** getSyncServerUrl — exposed on window.api for components that build URLs directly. */
export { getSyncServerUrl }

// ─── Inventory ────────────────────────────────────────────────────────────────
export const adjustStock = d =>
  adjustStockRequest(d)
export const transferInventoryStock = d =>
  transferInventoryStockRequest(d)
export const moveStockRow = d =>
  moveStockRowRequest(d)

export const getActionHistory = (scope = 'global', limit = 10, params = {}) => {
  return getActionHistoryRequest(scope, limit, params)
}
export const createActionHistory = payload =>
  createActionHistoryRequest(payload)
export const updateActionHistory = (id, payload) =>
  updateActionHistoryRequest(id, payload)
export const undoActionHistory = id =>
  undoActionHistoryRequest(id)
export const redoActionHistory = id =>
  redoActionHistoryRequest(id)
export const getInventorySummary = (params = {}) =>
  getInventorySummaryRequest(params)
export const getInventoryStats = (params = {}) =>
  getInventoryStatsRequest(params)
export const getInventoryBootstrap = (params = {}) =>
  getInventoryBootstrapRequest(params)
export const searchInventoryProducts = (params = {}) =>
  searchInventoryProductsRequest(params)
export const getInventoryMovements = (params = {}) =>
  getInventoryMovementsRequest(params)
export const getInventoryReasons = () =>
  getInventoryReasonsRequest()
export const saveInventoryReasons = (items = []) =>
  saveInventoryReasonsRequest(items)

export const getRfidStatus = (params = {}) => {
  return getRfidStatusRequest(params)
}
export const createRfidTag = payload =>
  createRfidTagRequest(payload)
export const searchRfidTags = (params = {}) => {
  return searchRfidTagsRequest(params)
}
export const createRfidSession = payload =>
  createRfidSessionRequest(payload)
export const recordRfidSessionEvents = (id, payload) =>
  recordRfidSessionEventsRequest(id, payload)
export const getRfidSessionReview = id =>
  getRfidSessionReviewRequest(id)
export const applyRfidSession = (id, payload = {}) =>
  applyRfidSessionRequest(id, payload)

// ─── Sales ────────────────────────────────────────────────────────────────────
export async function createSale(d) {
  const { createSale: createSaleRequest } = await loadSaleWriteTransport()
  return createSaleRequest(d)
}

export const getSales   = (params) => {
  return getSalesRequest(params)
}

// ─── Dashboard & analytics ────────────────────────────────────────────────────
export const getDashboard = ()       => getDashboardRequest()
export const getAnalytics = (params) => getAnalyticsRequest(params)

// ─── Customers ────────────────────────────────────────────────────────────────
export const getCustomers = (params = {}) => {
  return getCustomersRequest(params)
}
export const getCustomerPointSummaries = (params = {}) => {
  return getCustomerPointSummariesRequest(params)
}
export async function createCustomer(d) {
  return createCustomerRequest(d)
}
export const updateCustomer = async (id, d) => {
  return updateCustomerRequest(id, d)
}
export const deleteCustomer = async (id) => {
  return deleteCustomerRequest(id)
}
export const bulkImportCustomers = d =>
  bulkImportCustomersRequest(d)
export const downloadCustomerTemplate = () =>
  downloadCustomerTemplateRequest()

// ─── Suppliers ────────────────────────────────────────────────────────────────
export const getSuppliers = (params = {}) => {
  return getSuppliersRequest(params)
}
export async function createSupplier(d) {
  return createSupplierRequest(d)
}
export const updateSupplier = async (id, d) => {
  return updateSupplierRequest(id, d)
}
export const deleteSupplier = async (id) => {
  return deleteSupplierRequest(id)
}
export const bulkImportSuppliers = d =>
  bulkImportSuppliersRequest(d)
export const downloadSupplierTemplate = () =>
  downloadSupplierTemplateRequest()

// ─── Delivery contacts ────────────────────────────────────────────────────────
export const getDeliveryContacts = (params = {}) => {
  return getDeliveryContactsRequest(params)
}
export async function createDeliveryContact(d) {
  return createDeliveryContactRequest(d)
}
export const updateDeliveryContact = async (id, d) => {
  return updateDeliveryContactRequest(id, d)
}
export const deleteDeliveryContact = async (id) => {
  return deleteDeliveryContactRequest(id)
}
export const bulkImportDeliveryContacts = d =>
  bulkImportDeliveryContactsRequest(d)

// ─── Users ────────────────────────────────────────────────────────────────────
export const getUsers      = ()       => getUsersRequest()
export const createUser    = d        => createUserRequest(d)
export const updateUser    = (id, d)  => updateUserRequest(id, d)
export const getUserProfile = (id)    => getUserProfileRequest(id)
export const getUserAuthMethods = (id) =>
  getUserAuthMethodsRequest(id)
export const updateUserProfile = (id, d) =>
  updateUserProfileRequest(id, d)
export const disconnectUserAuthProvider = (id, d) =>
  disconnectUserAuthProviderRequest(id, d)
export const changeUserPassword = (id, d) =>
  changeUserPasswordRequest(id, d)
export const resetPassword = (id, d)  => resetPasswordRequest(id, d)

// ─── Roles ────────────────────────────────────────────────────────────────────
export const getRoles   = ()       => getRolesRequest()
export const createRole = d        => createRoleRequest(d)
export const updateRole = (id, d)  => updateRoleRequest(id, d)
export const deleteRole = (id, payload) => deleteRoleRequest(id, payload)

// ─── Custom tables ────────────────────────────────────────────────────────────
export const getCustomTables    = ()                      => getCustomTablesRequest()
export const createCustomTable  = d                       => createCustomTableRequest(d)
export const getCustomTableData = ({ tableName })         => getCustomTableDataRequest({ tableName })
export const insertCustomRow    = ({ tableName, data })   => insertCustomRowRequest({ tableName, data })
export const updateCustomRow    = ({ tableName, id, data, expectedUpdatedAt }) => updateCustomRowRequest({ tableName, id, data, expectedUpdatedAt })
export const deleteCustomRow    = ({ tableName, id, payload })     => deleteCustomRowRequest({ tableName, id, payload })

// ─── Audit log ────────────────────────────────────────────────────────────────
export const getAuditLogs = (params = {}) =>
  getAuditLogsRequest(params)

export const deleteAuditLogsRetention = (olderThanDays = 30) =>
  deleteAuditLogsRetentionRequest(olderThanDays)

// ─── Backup ───────────────────────────────────────────────────────────────────
export async function getSystemJob(id) {
  return getSystemJobRequest(id)
}

export async function cancelSystemJob(id, reason = 'Cancelled by user') {
  return cancelSystemJobRequest(id, reason)
}

export async function pollSystemJob(jobId, options = {}) {
  return pollSystemJobRequest(jobId, options)
}

export const getIntegrationDoctor = (options = {}) =>
  callSystemRuntimeMethod('getIntegrationDoctor', options)

export async function queueBackupFolderExport(destinationDir = '') {
  return queueBackupFolderExportRequest(destinationDir)
}

export async function exportBackupFolder(destinationDir) {
  return queueBackupFolderExport(destinationDir)
}

export async function queueBackupFolderRestore(sourceDir) {
  return queueBackupFolderRestoreRequest(sourceDir)
}

export async function importBackupFolder(sourceDir) {
  return queueBackupFolderRestore(sourceDir)
}

// ─── Data reset ───────────────────────────────────────────────────────────────
// After any reset or factory-reset, wipe the entire in-memory cache so that
// Dashboard, Inventory, Sales, Returns, Contacts, Branches, etc. all reload
// fresh data immediately instead of showing stale results for up to 45 s.
export const getGoogleDriveSyncStatus = () =>
  getGoogleDriveSyncStatusRequest()

export const saveGoogleDriveSyncPreferences = (payload) =>
  saveGoogleDriveSyncPreferencesRequest(payload)

export const startGoogleDriveSyncOauth = (payload) =>
  startGoogleDriveSyncOauthRequest(payload)

export const disconnectGoogleDriveSync = () =>
  disconnectGoogleDriveSyncRequest()

export const forgetGoogleDriveSyncCredentials = (payload = {}) =>
  forgetGoogleDriveSyncCredentialsRequest(payload)

export const queueGoogleDriveSyncNow = () =>
  queueGoogleDriveSyncNowRequest()

export const syncGoogleDriveNow = () =>
  syncGoogleDriveNowRequest()

export async function resetData(mode = 'sales') {
  const result = await callSystemRuntimeMethod('resetData', mode)
  await invalidateClientRuntimeState(mode === 'all' ? 'reset-data-all' : 'reset-data-sales')
  cacheClearAll()
  return result
}

export async function factoryReset() {
  const result = await callSystemRuntimeMethod('factoryReset')
  await invalidateClientRuntimeState('factory-reset')
  cacheClearAll()
  return result
}

// ─── Import template downloads ────────────────────────────────────────────────
export function downloadImportTemplate(type) {
  // 1) Branch by import entity and emit a CSV header-only template.
  // 2) Product template focuses on filename-based image columns.
  // 3) `image_conflict_mode` controls keep/replace/append behavior during bulk import.
  if (type === 'customer') return downloadCustomerTemplate()
  if (type === 'deliveryContact') return buildImportCsvTemplate([
    '_conflict_mode', '_field_rules',
    'name', 'phone', 'area', 'address', 'notes',
    'contact_label_1','contact_name_1','contact_phone_1','contact_area_1',
    'contact_label_2','contact_name_2','contact_phone_2','contact_area_2',
    'contact_label_3','contact_name_3','contact_phone_3','contact_area_3',
  ], 'delivery-contacts-template.csv')
  if (type === 'supplier') return downloadSupplierTemplate()
  if (type === 'sales') {
    return buildImportCsvTemplate([
      '_conflict_mode',
      'receipt_number', 'sale_date', 'sale_status', 'payment_method', 'payment_currency',
      'branch', 'customer_name', 'customer_phone', 'customer_address',
      'cashier_name', 'name', 'sku', 'barcode', 'quantity',
      'unit_price_usd', 'unit_price_khr', 'notes',
    ], 'sales-template.csv')
  }
  if (type === 'inventory') {
    return buildImportCsvTemplate([
      '_conflict_mode',
      'date', 'action', 'branch', 'name', 'sku', 'barcode', 'quantity',
      'unit_cost_usd', 'unit_cost_khr', 'reason',
    ], 'inventory-template.csv')
  }
  return buildImportCsvTemplate([
    '_action','_target_product_id','_parent_id','_field_rules',
    'name','sku','barcode','category','brand','unit','description',
    'selling_price_usd','selling_price_khr',
    'special_price_usd','special_price_khr',
    'discount_enabled','discount_type','discount_percent','discount_amount_usd','discount_amount_khr',
    'discount_label','discount_badge_color','discount_starts_at','discount_ends_at',
    'purchase_price_usd','purchase_price_khr',
    'stock_quantity','low_stock_threshold','expiry_date','expiry_alert_days',
    'branch','supplier',
    'parent_id','is_group',
    'image_filename_1','image_filename_2','image_filename_3','image_filename_4','image_filename_5',
    'image_filenames','image_conflict_mode',
    'is_active'
  ], 'products-template.csv')
}

// ─── No-ops for API compatibility ────────────────────────────────────────────
export const openPath = (targetPath) =>
  callSystemRuntimeMethod('openPath', targetPath)

// ─── Returns ──────────────────────────────────────────────────────────────────
export const getReturns  = (params) => {
  const q = buildQueryString(params, { skipEmpty: false })
  const cacheKey = q ? `returns:get:${q}` : 'returns:get'
  const mirror = q ? null : mirrorTable('returns')
  return routeMirrored(cacheKey, () => apiFetch('GET', appendQuery('/api/returns', q)), async () => {
    const db = await getLocalDb()
    return db.returns.orderBy('created_at').reverse().toArray()
  }, mirror)
}
export async function createReturn(d) {
  const payload = ensureClientRequestId({ ...getDeviceInfo(), ...d }, 'return')
  const returnNumber = String(payload.return_number || '').trim() || `RET-${Date.now()}`
  const finalPayload = { ...payload, return_number: returnNumber }
  return route('returns:create', () => apiFetch('POST', '/api/returns', finalPayload), null, true)
}
export async function createSupplierReturn(d) {
  const payload = ensureClientRequestId({ ...getDeviceInfo(), ...d }, 'supplier_return')
  const returnNumber = String(payload.return_number || '').trim() || `SRET-${Date.now()}`
  const finalPayload = { ...payload, return_number: returnNumber }
  return route('returns:createSupplier', () => apiFetch('POST', '/api/returns/supplier', finalPayload), null, true)
}
export const getReturn    = id => route('returns:getOne', () => apiFetch('GET', `/api/returns/${id}`), () => null)

// ─── Sale status update ───────────────────────────────────────────────────────
export const updateSaleStatus = async (id, sale_status, notes) => {
  const payload = await withExpectedUpdatedAt('sales', id, { ...getDeviceInfo(), sale_status, notes })
  try {
    const result = await route('sales:updateStatus', () => apiFetch('PATCH', `/api/sales/${id}/status`, payload), null, true)
    const db = await getLocalDb()
    await db.sales.update(id, {
      sale_status,
      updated_at: result?.updated_at || result?.updatedAt || new Date().toISOString(),
    }).catch(() => {})
    return result
  } catch (error) {
    error.attempted = { sale_status, notes }
    throw error
  }
}

// ─── Sales export ─────────────────────────────────────────────────────────────
export const attachSaleCustomer = async (id, payload) => {
  const body = await withExpectedUpdatedAt('sales', id, { ...getDeviceInfo(), ...(payload || {}) })
  try {
    const result = await route('sales:attachCustomer', () => apiFetch('PATCH', `/api/sales/${id}/customer`, body), null, true)
    const db = await getLocalDb()
    await db.sales.update(id, {
      customer_id: result?.customer?.id || null,
      customer_name: result?.customer?.name || null,
      customer_membership_number: result?.customer?.membership_number || null,
      customer_phone: result?.customer?.phone || null,
      customer_address: result?.customer?.address || null,
      updated_at: result?.updated_at || result?.updatedAt || new Date().toISOString(),
    }).catch(() => {})
    return result
  } catch (error) {
    error.attempted = {
      customer_id: payload?.customer_id || null,
      customer_name: payload?.customer_name || '',
      customer_phone: payload?.customer_phone || '',
      customer_address: payload?.customer_address || '',
    }
    throw error
  }
}

export const getSalesExport = (params) => {
  const q = buildQueryString(params, { skipEmpty: false })
  return route('sales:export', () => apiFetch('GET', appendQuery('/api/sales/export', q)), () => ({}))
}
export const updateReturn = async (id, d) => {
  const payload = await withExpectedUpdatedAt('returns', id, { ...getDeviceInfo(), ...(d || {}) })
  try {
    const result = await route('returns:update', () => apiFetch('PATCH', `/api/returns/${id}`, payload), null, true)
    const db = await getLocalDb()
    await db.returns.update(id, {
      ...d,
      updated_at: result?.updated_at || result?.updatedAt || new Date().toISOString(),
    }).catch(() => {})
    return result
  } catch (error) {
    error.attempted = {
      reason: d?.reason || '',
      return_type: d?.return_type || '',
      notes: d?.notes || '',
      total_refund_usd: d?.total_refund_usd || 0,
      total_refund_khr: d?.total_refund_khr || 0,
      items: buildAttemptedReturnItems(d?.items),
    }
    throw error
  }
}

// ─── Sync server health test ──────────────────────────────────────────────────
// Used by ServerPage to validate a URL before saving it.
export const testSyncServer = (url) =>
  callSystemRuntimeMethod('testSyncServer', url)

// ─── Folder dialog (optional — only available in Electron/Tauri contexts) ─────
// In web mode this is a no-op; callers use optional chaining (?.) defensively.
export const openFolderDialog = (initialPath = '') =>
  callSystemRuntimeMethod('openFolderDialog', initialPath)

// ─── Data folder location ─────────────────────────────────────────────────────
export const getDataPath = () =>
  callSystemRuntimeMethod('getDataPath')
export const getScaleMigrationStatus = () =>
  callSystemRuntimeMethod('getScaleMigrationStatus')
export const prepareScaleMigration = () =>
  callSystemRuntimeMethod('prepareScaleMigration')
export const runScaleMigration = (payload = {}) =>
  callSystemRuntimeMethod('runScaleMigration', payload)
export async function setDataPath(dir) {
  const result = await callSystemRuntimeMethod('setDataPath', dir)
  await invalidateClientRuntimeState('data-path-update')
  return result
}
export async function resetDataPath() {
  const result = await callSystemRuntimeMethod('resetDataPath')
  await invalidateClientRuntimeState('data-path-reset')
  return result
}
export const browseDir = (dir) =>
  callSystemRuntimeMethod('browseDir', dir)
