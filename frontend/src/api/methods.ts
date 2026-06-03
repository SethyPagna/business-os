// @ts-nocheck

// Legacy domain API registry. This file is now a TypeScript module so callers,
// tests, and bundling use the same extension path; the next slices should move
// typed domain groups out of this boundary and remove ts-nocheck.
function getDeviceInfo() {
  return getClientDeviceInfo()
}

let portalTransportPromise = null

function loadPortalTransport() {
  if (!portalTransportPromise) portalTransportPromise = import('./portalTransport.ts')
  return portalTransportPromise
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
  isWriteBlockedError,
  isWriteConflictError,
  isInvalidSessionError,
  isNetErr,
  isServerOnline,
  isTransientGatewayError,
} from './http.ts'
import { appendQuery, buildQueryString } from './query.ts'
import { dexieDb, localGetSettings, localSaveSettings, localSaveSettingsMeta, buildCSVTemplate } from './localDb.ts'
import { resetClientRuntimeState } from '../platform/runtime/clientRuntime.ts'
import { getClientDeviceInfo } from '../utils/deviceInfo.ts'
import { refreshAppData } from '../utils/appRefresh.ts'
import {
  CATEGORY_REFRESH_CHANNELS,
  getSettingsRefreshChannels,
  UNIT_REFRESH_CHANNELS,
} from '../utils/settingsRefresh.ts'
import { buildAttemptedReturnItems, buildAttemptedSettings } from './conflicts.ts'
import { createClientRequestId, ensureClientRequestId } from './requestIds.ts'
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
  adjustStock as adjustStockRequest,
  getInventoryMovements as getInventoryMovementsRequest,
  getInventoryReasons as getInventoryReasonsRequest,
  getInventoryStats as getInventoryStatsRequest,
  getInventorySummary as getInventorySummaryRequest,
  moveStockRow as moveStockRowRequest,
  saveInventoryReasons as saveInventoryReasonsRequest,
  searchInventoryProducts as searchInventoryProductsRequest,
  transferInventoryStock as transferInventoryStockRequest,
} from './inventoryTransport.ts'
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
  createSale as createSaleRequest,
  createSaleWithoutWriteDedupe as createSaleWithoutWriteDedupeRequest,
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
  OFFLINE_SALE_SYNC_UPDATE_CHANNELS,
  dispatchSyncUpdates,
  emitSyncQueueChanged,
  hasStoredUserSession,
  registerOutboxBackgroundSync,
} from './syncRuntime.ts'
import {
  cancelSystemJob as cancelSystemJobRequest,
  getSystemJob as getSystemJobRequest,
  pollSystemJob as pollSystemJobRequest,
  queueBackupFolderExport as queueBackupFolderExportRequest,
  queueBackupFolderRestore as queueBackupFolderRestoreRequest,
} from './systemJobs.ts'
import {
  browseDir as browseDirRequest,
  factoryReset as factoryResetRequest,
  getDataPath as getDataPathRequest,
  getIntegrationDoctor as getIntegrationDoctorRequest,
  getScaleMigrationStatus as getScaleMigrationStatusRequest,
  getSystemBootstrap as getSystemBootstrapRequest,
  getSystemConfig as getSystemConfigRequest,
  getSystemDebugLog as getSystemDebugLogRequest,
  openFolderDialog as openFolderDialogRequest,
  openPath as openPathRequest,
  prepareScaleMigration as prepareScaleMigrationRequest,
  resetData as resetDataRequest,
  resetDataPath as resetDataPathRequest,
  runScaleMigration as runScaleMigrationRequest,
  setDataPath as setDataPathRequest,
  testSyncServer as testSyncServerRequest,
} from './systemRuntime.ts'
export { getImageDataUrl, openCSVDialog, openImageDialog } from './browserDialogs.ts'

const OFFLINE_SALE_QUEUE_CHANNEL = 'sales:create'
const OFFLINE_SALE_RETRY_DELAY_MS = 30_000
const OFFLINE_DEVICE_SNAPSHOT_META_KEY = 'offline_device_snapshot_meta'
const OFFLINE_DEVICE_SNAPSHOT_MIN_INTERVAL_MS = 5 * 60_000
let offlineDeviceSnapshotPromise = null

export async function discardPendingSyncQueue(reason = 'Offline changes were cleared.') {
  const existing = await dexieDb.sync_queue.toArray().catch(() => [])
  await dexieDb.sync_queue.clear().catch(() => {})
  emitSyncQueueChanged({ reason, discarded: existing.length })
  dispatchSyncUpdates(DISCARD_SYNC_UPDATE_CHANNELS, 'discard-pending-sync-queue')
  return {
    success: true,
    discarded: existing.length,
    reason,
  }
}

export async function getPendingSyncState() {
  const items = await dexieDb.sync_queue
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
    return (await dexieDb.settings.get(OFFLINE_DEVICE_SNAPSHOT_META_KEY))?.value || ''
  } catch (_) {
    return ''
  }
}

async function writeOfflineDeviceSnapshotMeta(meta = {}) {
  const value = JSON.stringify({
    refreshedAt: new Date().toISOString(),
    ...meta,
  })
  await dexieDb.settings.put({
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
  Promise.resolve().then(() => purgeSensitiveLiveServerMirrors()).catch(() => {})
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
  getSystemConfigRequest()
export const getSystemBootstrap = () =>
  getSystemBootstrapRequest()
export async function getNotificationSummary() {
  return getNotificationSummaryRequest()
}
export const getSystemDebugLog = () =>
  getSystemDebugLogRequest()
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
export const searchInventoryProducts = (params = {}) =>
  searchInventoryProductsRequest(params)
export const getInventoryMovements = (params = {}) =>
  getInventoryMovementsRequest(params)
export const getInventoryReasons = () =>
  getInventoryReasonsRequest()
export const saveInventoryReasons = (items = []) =>
  saveInventoryReasonsRequest(items)

function buildOfflineSaleReceiptNumber(payload = {}) {
  const clientRequestId = String(payload.client_request_id || createClientRequestId('sale')).trim()
  const suffix = clientRequestId.replace(/^sale_/, '').replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase()
  return `OFFLINE-${suffix || Date.now()}`
}

function isRetryableOfflineSaleError(error) {
  if (!error) return false
  if (isWriteBlockedError(error)) return true
  if (isNetErr(error)) return true
  if (isTransientGatewayError(error?.status)) return true
  const message = String(error?.message || '').toLowerCase()
  return message.includes('timed out') || message.includes('server is offline') || message.includes('server unavailable')
}

async function findQueuedSale(clientRequestId) {
  const clean = String(clientRequestId || '').trim()
  if (!clean) return null
  const rows = await dexieDb.sync_queue.where('channel').equals(OFFLINE_SALE_QUEUE_CHANNEL).toArray().catch(() => [])
  return rows.find((row) => String(row?.payload?.client_request_id || '') === clean) || null
}

async function putOfflineSaleMirror(payload, receiptNumber) {
  const now = new Date().toISOString()
  const offlineId = -Math.abs(Date.now())
  await dexieDb.sales.put({
    id: offlineId,
    receipt_number: receiptNumber,
    client_request_id: payload.client_request_id,
    cashier_id: payload.cashier_id || null,
    cashier_name: payload.cashier_name || '',
    customer_name: payload.customer_name || '',
    customer_phone: payload.customer_phone || '',
    total_usd: payload.total_usd || 0,
    total_khr: payload.total_khr || 0,
    subtotal_usd: payload.subtotal_usd || payload.subtotal || 0,
    subtotal_khr: payload.subtotal_khr || 0,
    items: JSON.stringify(payload.items || []),
    sale_status: payload.sale_status || 'completed',
    payment_method: payload.payment_method || 'Cash',
    created_at: payload.created_at || now,
    updated_at: now,
    offline_pending: true,
  }).catch(() => null)
  return offlineId
}

async function queueOfflineSale(payload, reason = 'server_offline') {
  const salePayload = ensureClientRequestId({ ...(payload || {}) }, 'sale')
  const existing = await findQueuedSale(salePayload.client_request_id)
  if (existing) {
    return {
      success: true,
      queued: true,
      duplicate: true,
      id: existing.entity_id || null,
      receiptNumber: existing.entity_name || buildOfflineSaleReceiptNumber(salePayload),
      client_request_id: salePayload.client_request_id,
    }
  }

  const now = new Date().toISOString()
  const receiptNumber = buildOfflineSaleReceiptNumber(salePayload)
  salePayload.receipt_number = salePayload.receipt_number || receiptNumber
  const localId = await putOfflineSaleMirror(salePayload, receiptNumber)
  const row = {
    id: salePayload.client_request_id,
    channel: OFFLINE_SALE_QUEUE_CHANNEL,
    operation: 'create',
    entity_table: 'sales',
    entity_id: localId,
    entity_name: receiptNumber,
    status: 'pending',
    payload: salePayload,
    created_at: now,
    updated_at: now,
    retry_count: 0,
    retry_at: now,
    error: null,
    reason,
    queue_version: 1,
    base_updated_at: salePayload.expectedUpdatedAt || salePayload.expected_updated_at || salePayload.updated_at || now,
  }
  await dexieDb.sync_queue.put(row)
  registerOutboxBackgroundSync()
  emitSyncQueueChanged({ channel: OFFLINE_SALE_QUEUE_CHANNEL, queued: 1 })
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sync:offline-sale-queued', {
      detail: {
        channel: OFFLINE_SALE_QUEUE_CHANNEL,
        receiptNumber,
        client_request_id: salePayload.client_request_id,
        ts: now,
      },
    }))
  }
  return {
    success: true,
    queued: true,
    id: localId,
    receiptNumber,
    client_request_id: salePayload.client_request_id,
  }
}

function queuedSaleBackoffMs(retryCount = 0) {
  const attempts = Math.max(0, Number(retryCount || 0))
  return Math.min(5 * 60_000, OFFLINE_SALE_RETRY_DELAY_MS * Math.max(1, attempts + 1))
}

async function updateQueuedRow(row, updates = {}) {
  if (!row?._seq) return
  await dexieDb.sync_queue.put({
    ...row,
    ...updates,
    updated_at: new Date().toISOString(),
  }).catch(() => {})
}

async function completeQueuedSale(row, result) {
  await dexieDb.transaction('rw', dexieDb.sync_queue, dexieDb.sales, async () => {
    await dexieDb.sync_queue.delete(row._seq)
    if (Number(row.entity_id || 0) < 0) await dexieDb.sales.delete(row.entity_id)
  }).catch(async () => {
    await dexieDb.sync_queue.delete(row._seq).catch(() => {})
    if (Number(row.entity_id || 0) < 0) await dexieDb.sales.delete(row.entity_id).catch(() => {})
  })
  emitSyncQueueChanged({ channel: OFFLINE_SALE_QUEUE_CHANNEL, synced: 1 })
  if (typeof window !== 'undefined') {
    dispatchSyncUpdates(OFFLINE_SALE_SYNC_UPDATE_CHANNELS, 'offline-sale-synced')
    window.dispatchEvent(new CustomEvent('sync:offline-sale-synced', {
      detail: {
        channel: OFFLINE_SALE_QUEUE_CHANNEL,
        receiptNumber: result?.receiptNumber || result?.receipt_number || row.entity_name || null,
        client_request_id: row?.payload?.client_request_id || row.id || null,
        duplicate: !!result?.duplicate,
        ts: Date.now(),
      },
    }))
  }
}

async function failQueuedSale(row, error, { retryable = false } = {}) {
  const retryCount = Number(row.retry_count || 0) + 1
  const now = Date.now()
  await updateQueuedRow(row, {
    status: 'failed',
    retry_count: retryCount,
    retry_at: retryable ? new Date(now + queuedSaleBackoffMs(retryCount)).toISOString() : null,
    error: error?.message || String(error || 'Sync failed'),
  })
  emitSyncQueueChanged({ channel: OFFLINE_SALE_QUEUE_CHANNEL, failed: 1 })
  if (retryable) registerOutboxBackgroundSync()
}

async function markQueuedSaleConflict(row, error) {
  await updateQueuedRow(row, {
    status: 'conflict',
    retry_at: null,
    error: error?.message || String(error || 'Server has a newer version. Review before syncing.'),
    conflict: true,
  })
  emitSyncQueueChanged({ channel: OFFLINE_SALE_QUEUE_CHANNEL, conflict: 1 })
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sync:write-conflict', {
      detail: {
        channel: OFFLINE_SALE_QUEUE_CHANNEL,
        entity_table: row.entity_table || 'sales',
        entity_id: row.entity_id ?? null,
        entity_name: row.entity_name || null,
        refreshChannels: ['sales', 'products', 'inventory', 'dashboard'],
        ts: Date.now(),
      },
    }))
  }
}

async function syncPendingSalesQueue({ force = false } = {}) {
  const now = Date.now()
  const rows = await dexieDb.sync_queue
    .where('channel')
    .equals(OFFLINE_SALE_QUEUE_CHANNEL)
    .toArray()
    .catch(() => [])
  const eligible = []
  for (const row of rows) {
    if (!row?.payload) continue
    if (!force) {
      const retryAt = row.retry_at ? Date.parse(row.retry_at) : 0
      if (Number.isFinite(retryAt) && retryAt > now) continue
    }
    eligible.push(row)
  }
  eligible.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))

  const result = { success: true, attempted: 0, synced: 0, failed: 0, pending: rows.length }
  for (const row of eligible) {
    result.attempted += 1
    await updateQueuedRow(row, { status: 'syncing', error: null })
    try {
      const payload = ensureClientRequestId({ ...(row.payload || {}) }, 'sale')
      const response = await createSaleWithoutWriteDedupeRequest(payload)
      await completeQueuedSale(row, response)
      result.synced += 1
    } catch (error) {
      if (isWriteConflictError(error)) {
        await markQueuedSaleConflict(row, error)
        result.failed += 1
        continue
      }
      const retryable = isRetryableOfflineSaleError(error)
      await failQueuedSale(row, error, { retryable })
      result.failed += 1
      if (!retryable && !force) break
    }
  }
  result.pending = Math.max(0, rows.length - result.synced)
  return result
}

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
  const payload = ensureClientRequestId({ ...getDeviceInfo(), ...d }, 'sale')
  try {
    return await createSaleRequest(payload)
  } catch (error) {
    if (isRetryableOfflineSaleError(error)) {
      return queueOfflineSale(payload, error?.reason || 'server_offline')
    }
    throw error
  }
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
  getIntegrationDoctorRequest(options)

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
  const result = await resetDataRequest(mode)
  await invalidateClientRuntimeState(mode === 'all' ? 'reset-data-all' : 'reset-data-sales')
  cacheClearAll()
  return result
}

export async function factoryReset() {
  const result = await factoryResetRequest()
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
  if (type === 'deliveryContact') return buildCSVTemplate([
    '_conflict_mode', '_field_rules',
    'name', 'phone', 'area', 'address', 'notes',
    'contact_label_1','contact_name_1','contact_phone_1','contact_area_1',
    'contact_label_2','contact_name_2','contact_phone_2','contact_area_2',
    'contact_label_3','contact_name_3','contact_phone_3','contact_area_3',
  ], 'delivery-contacts-template.csv')
  if (type === 'supplier') return downloadSupplierTemplate()
  if (type === 'sales') {
    return buildCSVTemplate([
      '_conflict_mode',
      'receipt_number', 'sale_date', 'sale_status', 'payment_method', 'payment_currency',
      'branch', 'customer_name', 'customer_phone', 'customer_address',
      'cashier_name', 'name', 'sku', 'barcode', 'quantity',
      'unit_price_usd', 'unit_price_khr', 'notes',
    ], 'sales-template.csv')
  }
  if (type === 'inventory') {
    return buildCSVTemplate([
      '_conflict_mode',
      'date', 'action', 'branch', 'name', 'sku', 'barcode', 'quantity',
      'unit_cost_usd', 'unit_cost_khr', 'reason',
    ], 'inventory-template.csv')
  }
  buildCSVTemplate([
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
  openPathRequest(targetPath)

// ─── Returns ──────────────────────────────────────────────────────────────────
export const getReturns  = (params) => {
  const q = buildQueryString(params, { skipEmpty: false })
  const cacheKey = q ? `returns:get:${q}` : 'returns:get'
  const mirror = q ? null : mirrorTable('returns')
  return routeMirrored(cacheKey, () => apiFetch('GET', appendQuery('/api/returns', q)), () => dexieDb.returns.orderBy('created_at').reverse().toArray(), mirror)
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
    await dexieDb.sales.update(id, {
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
    await dexieDb.sales.update(id, {
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
    await dexieDb.returns.update(id, {
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
  testSyncServerRequest(url)

// ─── Folder dialog (optional — only available in Electron/Tauri contexts) ─────
// In web mode this is a no-op; callers use optional chaining (?.) defensively.
export const openFolderDialog = (initialPath = '') =>
  openFolderDialogRequest(initialPath)

// ─── Data folder location ─────────────────────────────────────────────────────
export const getDataPath = () =>
  getDataPathRequest()
export const getScaleMigrationStatus = () =>
  getScaleMigrationStatusRequest()
export const prepareScaleMigration = () =>
  prepareScaleMigrationRequest()
export const runScaleMigration = (payload = {}) =>
  runScaleMigrationRequest(payload)
export async function setDataPath(dir) {
  const result = await setDataPathRequest(dir)
  await invalidateClientRuntimeState('data-path-update')
  return result
}
export async function resetDataPath() {
  const result = await resetDataPathRequest()
  await invalidateClientRuntimeState('data-path-reset')
  return result
}
export const browseDir = (dir) =>
  browseDirRequest(dir)
