// @ts-nocheck

// Legacy domain API registry. This file is now a TypeScript module so callers,
// tests, and bundling use the same extension path; the next slices should move
// typed domain groups out of this boundary and remove ts-nocheck.
let portalTransportPromise = null
let saleWriteTransportPromise = null
let csvTemplatePromise = null
let browserDialogsPromise = null
let aiTransportPromise = null
let actionHistoryTransportPromise = null
let auditLogTransportPromise = null
let contactsTransportPromise = null
let dashboardTransportPromise = null
let fileTransportPromise = null
let inventoryWriteTransportPromise = null
let importJobsTransportPromise = null
let productWriteTransportPromise = null
let rfidTransportPromise = null
let salesTransportPromise = null
let settingsTransportPromise = null
let offlineSnapshotTransportPromise = null
let returnsTransportPromise = null
let pendingSyncTransportPromise = null
let driveSyncTransportPromise = null

function loadPortalTransport() {
  if (!portalTransportPromise) portalTransportPromise = import('./portalTransport.ts')
  return portalTransportPromise
}

function loadSaleWriteTransport() {
  if (!saleWriteTransportPromise) saleWriteTransportPromise = import('./saleWriteTransport.ts')
  return saleWriteTransportPromise
}

function loadCsvTemplateModule() {
  if (!csvTemplatePromise) csvTemplatePromise = import('../utils/csvTemplate.ts')
  return csvTemplatePromise
}

function loadBrowserDialogsModule() {
  if (!browserDialogsPromise) browserDialogsPromise = import('./browserDialogs.ts')
  return browserDialogsPromise
}

function loadAiTransport() {
  if (!aiTransportPromise) aiTransportPromise = import('./aiTransport.ts')
  return aiTransportPromise
}

function loadActionHistoryTransport() {
  if (!actionHistoryTransportPromise) actionHistoryTransportPromise = import('./actionHistoryTransport.ts')
  return actionHistoryTransportPromise
}

function loadAuditLogTransport() {
  if (!auditLogTransportPromise) auditLogTransportPromise = import('./auditLogTransport.ts')
  return auditLogTransportPromise
}

function loadContactsTransport() {
  if (!contactsTransportPromise) contactsTransportPromise = import('./contactsTransport.ts')
  return contactsTransportPromise
}

function loadDashboardTransport() {
  if (!dashboardTransportPromise) dashboardTransportPromise = import('./dashboardTransport.ts')
  return dashboardTransportPromise
}

function loadFileTransport() {
  if (!fileTransportPromise) fileTransportPromise = import('./fileTransport.ts')
  return fileTransportPromise
}

function loadInventoryWriteTransport() {
  if (!inventoryWriteTransportPromise) inventoryWriteTransportPromise = import('./inventoryWriteTransport.ts')
  return inventoryWriteTransportPromise
}

function loadImportJobsTransport() {
  if (!importJobsTransportPromise) importJobsTransportPromise = import('./importJobsTransport.ts')
  return importJobsTransportPromise
}

function loadProductWriteTransport() {
  if (!productWriteTransportPromise) productWriteTransportPromise = import('./productWriteTransport.ts')
  return productWriteTransportPromise
}

function loadRfidTransport() {
  if (!rfidTransportPromise) rfidTransportPromise = import('./rfidTransport.ts')
  return rfidTransportPromise
}

function loadSalesTransport() {
  if (!salesTransportPromise) salesTransportPromise = import('./salesTransport.ts')
  return salesTransportPromise
}

function loadSettingsTransport() {
  if (!settingsTransportPromise) settingsTransportPromise = import('./settingsTransport.ts')
  return settingsTransportPromise
}

function loadOfflineSnapshotTransport() {
  if (!offlineSnapshotTransportPromise) offlineSnapshotTransportPromise = import('./offlineSnapshotTransport.ts')
  return offlineSnapshotTransportPromise
}

function loadReturnsTransport() {
  if (!returnsTransportPromise) returnsTransportPromise = import('./returnsTransport.ts')
  return returnsTransportPromise
}

function loadPendingSyncTransport() {
  if (!pendingSyncTransportPromise) pendingSyncTransportPromise = import('./pendingSyncTransport.ts')
  return pendingSyncTransportPromise
}

function loadDriveSyncTransport() {
  if (!driveSyncTransportPromise) driveSyncTransportPromise = import('./driveSync.ts')
  return driveSyncTransportPromise
}

async function buildImportCsvTemplate(headers, filename) {
  const { buildCSVTemplate } = await loadCsvTemplateModule()
  return buildCSVTemplate(headers, filename)
}

/**
 * api/methods.ts — All window.api domain methods.
 *
 * Each method either delegates to a focused typed transport or exposes a small
 * runtime compatibility wrapper for legacy window.api callers.
 */

import {
  getSyncServerUrl,
  cacheClearAll,
} from './http.ts'
import { resetClientRuntimeState } from '../platform/runtime/clientRuntime.ts'
import { refreshAppData } from '../utils/appRefresh.ts'
import {
  CATEGORY_REFRESH_CHANNELS,
  UNIT_REFRESH_CHANNELS,
} from '../utils/settingsRefresh.ts'
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
  getInventoryBootstrap as getInventoryBootstrapRequest,
  getInventoryMovements as getInventoryMovementsRequest,
  getInventoryReasons as getInventoryReasonsRequest,
  getInventoryStats as getInventoryStatsRequest,
  getInventorySummary as getInventorySummaryRequest,
  searchInventoryProducts as searchInventoryProductsRequest,
} from './inventoryTransport.ts'
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
  clearCachedQueryResults,
} from './queryCache.ts'
import { purgeSensitiveLiveServerMirrors } from './localMirrors.ts'
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

const SENSITIVE_MIRROR_PURGE_DELAY_MS = 15_000
const SENSITIVE_MIRROR_PURGE_IDLE_TIMEOUT_MS = 30_000
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
  const { discardPendingSyncQueue: discardPendingSyncQueueRequest } = await loadPendingSyncTransport()
  return discardPendingSyncQueueRequest(reason)
}

export async function getPendingSyncState() {
  const { getPendingSyncState: getPendingSyncStateRequest } = await loadPendingSyncTransport()
  return getPendingSyncStateRequest()
}

export async function retryPendingSyncNow() {
  const { retryPendingSyncNow: retryPendingSyncNowRequest } = await loadPendingSyncTransport()
  return retryPendingSyncNowRequest()
}

export async function refreshOfflineDeviceSnapshot(options = {}) {
  const { refreshOfflineDeviceSnapshot: refreshOfflineDeviceSnapshotRequest } = await loadOfflineSnapshotTransport()
  return refreshOfflineDeviceSnapshotRequest(options)
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
  const { getSettings: getSettingsRequest } = await loadSettingsTransport()
  return getSettingsRequest(options)
}

export async function saveSettings(updates, options = {}) {
  const { saveSettings: saveSettingsRequest } = await loadSettingsTransport()
  return saveSettingsRequest(updates, options)
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

export const getAiProviders = async () => {
  const module = await loadAiTransport()
  return module.getAiProviders()
}
export const createAiProvider = async (payload) => {
  const module = await loadAiTransport()
  return module.createAiProvider(payload)
}
export const updateAiProvider = async (id, payload) => {
  const module = await loadAiTransport()
  return module.updateAiProvider(id, payload)
}
export const deleteAiProvider = async (id, payload) => {
  const module = await loadAiTransport()
  return module.deleteAiProvider(id, payload)
}
export const testAiProvider = async (id, payload) => {
  const module = await loadAiTransport()
  return module.testAiProvider(id, payload)
}
export const getAiResponses = async (limit = 80) => {
  const module = await loadAiTransport()
  return module.getAiResponses(limit)
}
export const createProduct = async (payload) => {
  const module = await loadProductWriteTransport()
  return module.createProduct(payload)
}
export const updateProduct = async (id, payload) => {
  const module = await loadProductWriteTransport()
  return module.updateProduct(id, payload)
}
export const deleteProduct = async (id) => {
  const module = await loadProductWriteTransport()
  return module.deleteProduct(id)
}

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
export const createProductVariant = async payload => {
  const module = await loadProductWriteTransport()
  return module.createProductVariant(payload)
}

export const bulkImportProducts = async payload => {
  const module = await loadProductWriteTransport()
  return module.bulkImportProducts(payload)
}

export const createImportJob = async payload => {
  const module = await loadImportJobsTransport()
  return module.createImportJob(payload)
}
export const listImportJobs = async (params = {}) => {
  const module = await loadImportJobsTransport()
  return module.listImportJobs(params)
}
export const getImportJob = async id => {
  const module = await loadImportJobsTransport()
  return module.getImportJob(id)
}
export const getImportJobReview = async (id, params = {}) => {
  const module = await loadImportJobsTransport()
  return module.getImportJobReview(id, params)
}
export const updateImportJobDecisions = async (id, decisions = {}) => {
  const module = await loadImportJobsTransport()
  return module.updateImportJobDecisions(id, decisions)
}
export const preflightImportJob = async id => {
  const module = await loadImportJobsTransport()
  return module.preflightImportJob(id)
}
export const startImportJob = async (id, options = {}) => {
  const module = await loadImportJobsTransport()
  return module.startImportJob(id, options)
}
export const approveImportJob = async (id, options = {}) => {
  const module = await loadImportJobsTransport()
  return module.approveImportJob(id, options)
}
export const cancelImportJob = async (id, options = {}) => {
  const module = await loadImportJobsTransport()
  return module.cancelImportJob(id, options)
}
export const retryImportJob = async (id, options = {}) => {
  const module = await loadImportJobsTransport()
  return module.retryImportJob(id, options)
}
export const deleteImportJob = async (id, options = {}) => {
  const module = await loadImportJobsTransport()
  return module.deleteImportJob(id, options)
}
export const getImportQueueStatus = async () => {
  const module = await loadImportJobsTransport()
  return module.getImportQueueStatus()
}
export const downloadImportJobErrors = async jobId => {
  const module = await loadImportJobsTransport()
  return module.downloadImportJobErrors(jobId)
}
export const uploadImportJobCsv = async payload => {
  const module = await loadImportJobsTransport()
  return module.uploadImportJobCsv(payload)
}
export const uploadImportJobZip = async payload => {
  const module = await loadImportJobsTransport()
  return module.uploadImportJobZip(payload)
}
export const uploadImportJobImages = async payload => {
  const module = await loadImportJobsTransport()
  return module.uploadImportJobImages(payload)
}

export const getFiles = async (params = {}) => {
  const module = await loadFileTransport()
  return module.getFiles(params)
}

export const uploadFileAsset = async payload => {
  const module = await loadFileTransport()
  return module.uploadFileAsset(payload)
}

export const deleteFileAsset = async (id, payload = {}) => {
  const module = await loadFileTransport()
  return module.deleteFileAsset(id, payload)
}

export const uploadProductImage = async payload => {
  const module = await loadFileTransport()
  return module.uploadProductImage(payload)
}

export const uploadUserAvatar = async payload => {
  const module = await loadFileTransport()
  return module.uploadUserAvatar(payload)
}
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
export const adjustStock = async d => {
  const module = await loadInventoryWriteTransport()
  return module.adjustStock(d)
}
export const transferInventoryStock = async d => {
  const module = await loadInventoryWriteTransport()
  return module.transferInventoryStock(d)
}
export const moveStockRow = async d => {
  const module = await loadInventoryWriteTransport()
  return module.moveStockRow(d)
}

export const getActionHistory = async (scope = 'global', limit = 10, params = {}) => {
  const module = await loadActionHistoryTransport()
  return module.getActionHistory(scope, limit, params)
}
export const createActionHistory = async payload => {
  const module = await loadActionHistoryTransport()
  return module.createActionHistory(payload)
}
export const updateActionHistory = async (id, payload) => {
  const module = await loadActionHistoryTransport()
  return module.updateActionHistory(id, payload)
}
export const undoActionHistory = async id => {
  const module = await loadActionHistoryTransport()
  return module.undoActionHistory(id)
}
export const redoActionHistory = async id => {
  const module = await loadActionHistoryTransport()
  return module.redoActionHistory(id)
}
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
export const saveInventoryReasons = async (items = []) => {
  const module = await loadInventoryWriteTransport()
  return module.saveInventoryReasons(items)
}

export const getRfidStatus = async (params = {}) => {
  const module = await loadRfidTransport()
  return module.getRfidStatus(params)
}
export const createRfidTag = async payload => {
  const module = await loadRfidTransport()
  return module.createRfidTag(payload)
}
export const searchRfidTags = async (params = {}) => {
  const module = await loadRfidTransport()
  return module.searchRfidTags(params)
}
export const createRfidSession = async payload => {
  const module = await loadRfidTransport()
  return module.createRfidSession(payload)
}
export const recordRfidSessionEvents = async (id, payload) => {
  const module = await loadRfidTransport()
  return module.recordRfidSessionEvents(id, payload)
}
export const getRfidSessionReview = async id => {
  const module = await loadRfidTransport()
  return module.getRfidSessionReview(id)
}
export const applyRfidSession = async (id, payload = {}) => {
  const module = await loadRfidTransport()
  return module.applyRfidSession(id, payload)
}

// ─── Sales ────────────────────────────────────────────────────────────────────
export async function createSale(d) {
  const { createSale: createSaleRequest } = await loadSaleWriteTransport()
  return createSaleRequest(d)
}

export const getSales = async (params) => {
  const module = await loadSalesTransport()
  return module.getSales(params)
}

// ─── Dashboard & analytics ────────────────────────────────────────────────────
export const getDashboard = async () => {
  const module = await loadDashboardTransport()
  return module.getDashboard()
}
export const getAnalytics = async (params) => {
  const module = await loadDashboardTransport()
  return module.getAnalytics(params)
}

// ─── Customers ────────────────────────────────────────────────────────────────
export const getCustomers = async (params = {}) => {
  const module = await loadContactsTransport()
  return module.getCustomers(params)
}
export const getCustomerPointSummaries = async (params = {}) => {
  const module = await loadContactsTransport()
  return module.getCustomerPointSummaries(params)
}
export async function createCustomer(d) {
  const module = await loadContactsTransport()
  return module.createCustomer(d)
}
export const updateCustomer = async (id, d) => {
  const module = await loadContactsTransport()
  return module.updateCustomer(id, d)
}
export const deleteCustomer = async (id) => {
  const module = await loadContactsTransport()
  return module.deleteCustomer(id)
}
export const bulkImportCustomers = async d => {
  const module = await loadContactsTransport()
  return module.bulkImportCustomers(d)
}
export const downloadCustomerTemplate = async () => {
  const module = await loadContactsTransport()
  return module.downloadCustomerTemplate()
}

// ─── Suppliers ────────────────────────────────────────────────────────────────
export const getSuppliers = async (params = {}) => {
  const module = await loadContactsTransport()
  return module.getSuppliers(params)
}
export async function createSupplier(d) {
  const module = await loadContactsTransport()
  return module.createSupplier(d)
}
export const updateSupplier = async (id, d) => {
  const module = await loadContactsTransport()
  return module.updateSupplier(id, d)
}
export const deleteSupplier = async (id) => {
  const module = await loadContactsTransport()
  return module.deleteSupplier(id)
}
export const bulkImportSuppliers = async d => {
  const module = await loadContactsTransport()
  return module.bulkImportSuppliers(d)
}
export const downloadSupplierTemplate = async () => {
  const module = await loadContactsTransport()
  return module.downloadSupplierTemplate()
}

// ─── Delivery contacts ────────────────────────────────────────────────────────
export const getDeliveryContacts = async (params = {}) => {
  const module = await loadContactsTransport()
  return module.getDeliveryContacts(params)
}
export async function createDeliveryContact(d) {
  const module = await loadContactsTransport()
  return module.createDeliveryContact(d)
}
export const updateDeliveryContact = async (id, d) => {
  const module = await loadContactsTransport()
  return module.updateDeliveryContact(id, d)
}
export const deleteDeliveryContact = async (id) => {
  const module = await loadContactsTransport()
  return module.deleteDeliveryContact(id)
}
export const bulkImportDeliveryContacts = async d => {
  const module = await loadContactsTransport()
  return module.bulkImportDeliveryContacts(d)
}

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
export const getAuditLogs = async (params = {}) => {
  const module = await loadAuditLogTransport()
  return module.getAuditLogs(params)
}

export const deleteAuditLogsRetention = async (olderThanDays = 30) => {
  const module = await loadAuditLogTransport()
  return module.deleteAuditLogsRetention(olderThanDays)
}

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
export const getGoogleDriveSyncStatus = async () => {
  const { getGoogleDriveSyncStatus: getGoogleDriveSyncStatusRequest } = await loadDriveSyncTransport()
  return getGoogleDriveSyncStatusRequest()
}

export const saveGoogleDriveSyncPreferences = async (payload) => {
  const { saveGoogleDriveSyncPreferences: saveGoogleDriveSyncPreferencesRequest } = await loadDriveSyncTransport()
  return saveGoogleDriveSyncPreferencesRequest(payload)
}

export const startGoogleDriveSyncOauth = async (payload) => {
  const { startGoogleDriveSyncOauth: startGoogleDriveSyncOauthRequest } = await loadDriveSyncTransport()
  return startGoogleDriveSyncOauthRequest(payload)
}

export const disconnectGoogleDriveSync = async () => {
  const { disconnectGoogleDriveSync: disconnectGoogleDriveSyncRequest } = await loadDriveSyncTransport()
  return disconnectGoogleDriveSyncRequest()
}

export const forgetGoogleDriveSyncCredentials = async (payload = {}) => {
  const { forgetGoogleDriveSyncCredentials: forgetGoogleDriveSyncCredentialsRequest } = await loadDriveSyncTransport()
  return forgetGoogleDriveSyncCredentialsRequest(payload)
}

export const queueGoogleDriveSyncNow = async () => {
  const { queueGoogleDriveSyncNow: queueGoogleDriveSyncNowRequest } = await loadDriveSyncTransport()
  return queueGoogleDriveSyncNowRequest()
}

export const syncGoogleDriveNow = async () => {
  const { syncGoogleDriveNow: syncGoogleDriveNowRequest } = await loadDriveSyncTransport()
  return syncGoogleDriveNowRequest()
}

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
export const getReturns = async (params) => {
  const { getReturns: getReturnsRequest } = await loadReturnsTransport()
  return getReturnsRequest(params)
}
export async function createReturn(d) {
  const { createReturn: createReturnRequest } = await loadReturnsTransport()
  return createReturnRequest(d)
}
export async function createSupplierReturn(d) {
  const { createSupplierReturn: createSupplierReturnRequest } = await loadReturnsTransport()
  return createSupplierReturnRequest(d)
}
export const getReturn = async (id) => {
  const { getReturn: getReturnRequest } = await loadReturnsTransport()
  return getReturnRequest(id)
}

// ─── Sale status update ───────────────────────────────────────────────────────
export const updateSaleStatus = async (id, sale_status, notes) => {
  const { updateSaleStatus: updateSaleStatusRequest } = await loadSalesTransport()
  return updateSaleStatusRequest(id, sale_status, notes)
}

// ─── Sales export ─────────────────────────────────────────────────────────────
export const attachSaleCustomer = async (id, payload) => {
  const { attachSaleCustomer: attachSaleCustomerRequest } = await loadSalesTransport()
  return attachSaleCustomerRequest(id, payload)
}

export const getSalesExport = async (params) => {
  const { getSalesExport: getSalesExportRequest } = await loadSalesTransport()
  return getSalesExportRequest(params)
}
export const updateReturn = async (id, d) => {
  const { updateReturn: updateReturnRequest } = await loadReturnsTransport()
  return updateReturnRequest(id, d)
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
