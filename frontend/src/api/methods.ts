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
let authTransportPromise = null
let contactsTransportPromise = null
let fileTransportPromise = null
let branchTransportPromise = null
let inventoryTransportPromise = null
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
let notificationSummaryTransportPromise = null
let systemJobsTransportPromise = null
let lookupTransportPromise = null
let productReadTransportPromise = null
let queryCacheModulePromise = null
let localMirrorsModulePromise = null
let userAdminTransportPromise = null
let userReadTransportPromise = null
let clientRuntimeModulePromise = null
let appRefreshModulePromise = null
let httpCoreModulePromise = null

const CATEGORY_REFRESH_CHANNELS = ['categories', 'products', 'inventory']
const UNIT_REFRESH_CHANNELS = ['units', 'products', 'inventory']

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

function loadAuthTransport() {
  if (!authTransportPromise) authTransportPromise = import('./authTransport.ts')
  return authTransportPromise
}

function loadContactsTransport() {
  if (!contactsTransportPromise) contactsTransportPromise = import('./contactsTransport.ts')
  return contactsTransportPromise
}

function loadFileTransport() {
  if (!fileTransportPromise) fileTransportPromise = import('./fileTransport.ts')
  return fileTransportPromise
}

function loadBranchTransport() {
  if (!branchTransportPromise) branchTransportPromise = import('./branchTransport.ts')
  return branchTransportPromise
}

function loadInventoryTransport() {
  if (!inventoryTransportPromise) inventoryTransportPromise = import('./inventoryTransport.ts')
  return inventoryTransportPromise
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

function loadNotificationSummaryTransport() {
  if (!notificationSummaryTransportPromise) notificationSummaryTransportPromise = import('./notificationSummary.ts')
  return notificationSummaryTransportPromise
}

function loadSystemJobsTransport() {
  if (!systemJobsTransportPromise) systemJobsTransportPromise = import('./systemJobs.ts')
  return systemJobsTransportPromise
}

function loadLookupTransport() {
  if (!lookupTransportPromise) lookupTransportPromise = import('./lookupTransport.ts')
  return lookupTransportPromise
}

function loadProductReadTransport() {
  if (!productReadTransportPromise) productReadTransportPromise = import('./productReadTransport.ts')
  return productReadTransportPromise
}

function loadQueryCacheModule() {
  if (!queryCacheModulePromise) queryCacheModulePromise = import('./queryCache.ts')
  return queryCacheModulePromise
}

function loadLocalMirrorsModule() {
  if (!localMirrorsModulePromise) localMirrorsModulePromise = import('./localMirrors.ts')
  return localMirrorsModulePromise
}

function loadUserAdminTransport() {
  if (!userAdminTransportPromise) userAdminTransportPromise = import('./userAdminTransport.ts')
  return userAdminTransportPromise
}

function loadUserReadTransport() {
  if (!userReadTransportPromise) userReadTransportPromise = import('./userReadTransport.ts')
  return userReadTransportPromise
}

function loadClientRuntimeModule() {
  if (!clientRuntimeModulePromise) clientRuntimeModulePromise = import('../platform/runtime/clientRuntime.ts')
  return clientRuntimeModulePromise
}

function loadAppRefreshModule() {
  if (!appRefreshModulePromise) appRefreshModulePromise = import('../utils/appRefresh.ts')
  return appRefreshModulePromise
}

function loadHttpCoreModule() {
  if (!httpCoreModulePromise) httpCoreModulePromise = import('./http.ts')
  return httpCoreModulePromise
}

async function buildImportCsvTemplate(headers, filename, exampleRow) {
  const { buildCSVTemplate } = await loadCsvTemplateModule()
  return buildCSVTemplate(headers, filename, exampleRow)
}

/**
 * api/methods.ts — All window.api domain methods.
 *
 * Each method either delegates to a focused typed transport or exposes a small
 * runtime compatibility wrapper for legacy window.api callers.
 */

import { getSyncServerUrl } from './httpState.ts'
import { pokeImportTracker } from '../utils/importJobRefresh.ts'
import { SALES_IMPORT_COLUMNS, SALES_IMPORT_EXAMPLE_ROWS } from '../utils/salesImportContract.ts'
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
    loadLocalMirrorsModule()
      .then(({ purgeSensitiveLiveServerMirrors }) => purgeSensitiveLiveServerMirrors())
      .catch(() => {})
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

// mirrorTables: when omitted, every local IndexedDB mirror table is wiped
// (the right call for factory-reset / data-path switch, which really do
// invalidate everything). When passed, only those tables are cleared --
// see clientRuntime.ts's resetClientRuntimeState for why this matters:
// without it, a scoped server-side reset (e.g. reset-data mode='products')
// still wiped the *entire* local mirror, leaving unrelated pages (Inventory
// Movements, Sales, etc.) looking empty even though the server never
// touched their data.
async function invalidateClientRuntimeState(reason = 'server-mutation', mirrorTables?: string[]) {
  const { resetClientRuntimeState } = await loadClientRuntimeModule()
  const { cacheClearAll } = await loadHttpCoreModule()
  await resetClientRuntimeState({
    clearAuth: false,
    preserveDeviceSettings: true,
    preserveSyncServer: true,
    preserveSessionDuration: true,
    preserveRuntimeMeta: false,
    ...(mirrorTables ? { mirrorTables } : {}),
  }).catch(() => {})
  cacheClearAll()
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sync:update', {
      detail: { channel: 'runtime', reason, ts: Date.now() },
    }))
  }
}

async function dispatchRefreshAppData(channels, detail = {}) {
  const { refreshAppData } = await loadAppRefreshModule()
  refreshAppData(channels, detail)
}

if (typeof window !== 'undefined') {
  scheduleSensitiveMirrorPurge()
  window.addEventListener('sync:update', (event) => {
    const channel = String(event?.detail?.channel || '').trim().toLowerCase()
    if (!channel) return
    if (['products', 'categories', 'units', 'settings'].includes(channel)) {
      void loadQueryCacheModule().then(({ clearCachedQueryResults }) =>
        clearCachedQueryResults(['products:search:', 'products:filters:', 'products:lookups:usage']),
      )
    }
    if (['inventory', 'products', 'branches', 'sales', 'returns'].includes(channel)) {
      void loadQueryCacheModule().then(({ clearCachedQueryResults }) =>
        clearCachedQueryResults(['inventory:products:search:']),
      )
    }
    // Customers is the one contacts entity that goes through the paged
    // queryCache path (readContactList in contactsTransport.ts, gated on
    // routeKey === 'customers'); suppliers/deliveryContacts always read
    // through the Dexie live-mirror table instead, so they have nothing to
    // clear here. Without this, a customer edited on another device could
    // sit in this device's IndexedDB fallback cache until the next
    // successful live read overwrites it, instead of being cleared the
    // moment the mutation is known about — closes the gap flagged in
    // Session 2 for the same class of "cache doesn't refresh with the
    // code" issue already handled for products/inventory above.
    if (channel === 'customers') {
      void loadQueryCacheModule().then(({ clearCachedQueryResults }) =>
        clearCachedQueryResults(['customers:get:']),
      )
    }
  })
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
export const login = async (payload) => {
  const { login: loginRequest } = await loadAuthTransport()
  return loginRequest(payload)
}
export const logout = async () => {
  const { logout: logoutRequest } = await loadAuthTransport()
  return logoutRequest()
}
export const resetPasswordWithOtp = async (payload) => {
  const { resetPasswordWithOtp: resetPasswordWithOtpRequest } = await loadAuthTransport()
  return resetPasswordWithOtpRequest(payload)
}
export const requestPasswordResetEmail = async (payload) => {
  const { requestPasswordResetEmail: requestPasswordResetEmailRequest } = await loadAuthTransport()
  return requestPasswordResetEmailRequest(payload)
}
export const completePasswordReset = async (payload) => {
  const { completePasswordReset: completePasswordResetRequest } = await loadAuthTransport()
  return completePasswordResetRequest(payload)
}
export const updateSessionDuration = async (payload) => {
  const { updateSessionDuration: updateSessionDurationRequest } = await loadAuthTransport()
  return updateSessionDurationRequest(payload)
}
export const getVerificationCapabilities = async () => {
  const { getVerificationCapabilities: getVerificationCapabilitiesRequest } = await loadAuthTransport()
  return getVerificationCapabilitiesRequest()
}
export const getSystemConfig = () =>
  callSystemRuntimeMethod('getSystemConfig')
export const getSystemBootstrap = () =>
  callSystemRuntimeMethod('getSystemBootstrap')
export async function getNotificationSummary() {
  const { getNotificationSummary: getNotificationSummaryRequest } = await loadNotificationSummaryTransport()
  return getNotificationSummaryRequest()
}
export const getSystemDebugLog = () =>
  callSystemRuntimeMethod('getSystemDebugLog')
export const startGoogleOauth = async (payload) => {
  const { startGoogleOauth: startGoogleOauthRequest } = await loadAuthTransport()
  return startGoogleOauthRequest(payload)
}
export const completeGoogleOauth = async (payload) => {
  const { completeGoogleOauth: completeGoogleOauthRequest } = await loadAuthTransport()
  return completeGoogleOauthRequest(payload)
}
export const unlinkGoogleOauth = async (payload) => {
  const { unlinkGoogleOauth: unlinkGoogleOauthRequest } = await loadAuthTransport()
  return unlinkGoogleOauthRequest(payload)
}
export const getAppBootstrap = async () => {
  const { getAppBootstrap: getAppBootstrapRequest } = await import('./appBootstrapTransport.ts')
  return getAppBootstrapRequest()
}
export const getOrganizationBootstrap = async () => {
  const { getOrganizationBootstrap: getOrganizationBootstrapRequest } = await loadAuthTransport()
  return getOrganizationBootstrapRequest()
}
export const searchOrganizations = async (query) => {
  const { searchOrganizations: searchOrganizationsRequest } = await loadAuthTransport()
  return searchOrganizationsRequest(query)
}
export const getCurrentOrganization = async () => {
  const { getCurrentOrganization: getCurrentOrganizationRequest } = await loadAuthTransport()
  return getCurrentOrganizationRequest()
}

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
export const getCategories = async () => {
  const { getCategories: getCategoriesRequest } = await loadLookupTransport()
  return getCategoriesRequest()
}
export const createCategory = async payload => {
  const { createCategory: createCategoryRequest } = await loadLookupTransport()
  const result = await createCategoryRequest(payload)
  await dispatchRefreshAppData(CATEGORY_REFRESH_CHANNELS, { reason: 'category-saved', source: 'categories:create' })
  return result
}
export const updateCategory = async (id, payload) => {
  const { updateCategory: updateCategoryRequest } = await loadLookupTransport()
  const result = await updateCategoryRequest(id, payload)
  await dispatchRefreshAppData(CATEGORY_REFRESH_CHANNELS, { reason: 'category-saved', source: 'categories:update' })
  return result
}
export const deleteCategory = async (id, payload) => {
  const { deleteCategory: deleteCategoryRequest } = await loadLookupTransport()
  const result = await deleteCategoryRequest(id, payload)
  await dispatchRefreshAppData(CATEGORY_REFRESH_CHANNELS, { reason: 'category-deleted', source: 'categories:delete' })
  return result
}

// ─── Units ────────────────────────────────────────────────────────────────────
export const getUnits = async () => {
  const { getUnits: getUnitsRequest } = await loadLookupTransport()
  return getUnitsRequest()
}
export const createUnit = async payload => {
  const { createUnit: createUnitRequest } = await loadLookupTransport()
  const result = await createUnitRequest(payload)
  await dispatchRefreshAppData(UNIT_REFRESH_CHANNELS, { reason: 'unit-saved', source: 'units:create' })
  return result
}
export const updateUnit = async (id, payload) => {
  const { updateUnit: updateUnitRequest } = await loadLookupTransport()
  const result = await updateUnitRequest(id, payload)
  await dispatchRefreshAppData(UNIT_REFRESH_CHANNELS, { reason: 'unit-saved', source: 'units:update' })
  return result
}
export const deleteUnit = async (id, payload) => {
  const { deleteUnit: deleteUnitRequest } = await loadLookupTransport()
  const result = await deleteUnitRequest(id, payload)
  await dispatchRefreshAppData(UNIT_REFRESH_CHANNELS, { reason: 'unit-deleted', source: 'units:delete' })
  return result
}

// ─── Branches ─────────────────────────────────────────────────────────────────
export const getBranches = async () => {
  const { getBranches: getBranchesRequest } = await loadBranchTransport()
  return getBranchesRequest()
}
export const getBranchSummary = async () => {
  const { getBranchSummary: getBranchSummaryRequest } = await loadBranchTransport()
  return getBranchSummaryRequest()
}
export const createBranch = async payload => {
  const { createBranch: createBranchRequest } = await loadBranchTransport()
  return createBranchRequest(payload)
}
export const updateBranch = async (id, payload) => {
  const { updateBranch: updateBranchRequest } = await loadBranchTransport()
  return updateBranchRequest(id, payload)
}
export const deleteBranch = async (id, userId, userName) => {
  const { deleteBranch: deleteBranchRequest } = await loadBranchTransport()
  return deleteBranchRequest(id, userId, userName)
}
export const getBranchStock = async (id, params = {}) => {
  const { getBranchStock: getBranchStockRequest } = await loadBranchTransport()
  return getBranchStockRequest(id, params)
}
export const getTransfers = async () => {
  const { getTransfers: getTransfersRequest } = await loadBranchTransport()
  return getTransfersRequest()
}
export const transferStock = async payload => {
  const { transferStock: transferStockRequest } = await loadBranchTransport()
  return transferStockRequest(payload)
}
export const getBranchStockIntegrity = async () => {
  const { getBranchStockIntegrity: getBranchStockIntegrityRequest } = await loadBranchTransport()
  return getBranchStockIntegrityRequest()
}
export const repairBranchStockIntegrity = async payload => {
  const { repairBranchStockIntegrity: repairBranchStockIntegrityRequest } = await loadBranchTransport()
  return repairBranchStockIntegrityRequest(payload)
}

// ─── Products ─────────────────────────────────────────────────────────────────
export const getProducts = async () => {
  const { getProducts: getProductsRequest } = await loadProductReadTransport()
  return getProductsRequest()
}
export const searchProducts = async (params = {}) => {
  const { searchProducts: searchProductsRequest } = await loadProductReadTransport()
  return searchProductsRequest(params)
}
export const getProductBootstrap = async (params = {}) => {
  const { getProductBootstrap: getProductBootstrapRequest } = await loadProductReadTransport()
  return getProductBootstrapRequest(params)
}
export const getProductsByIds = async (ids = [], params = {}) => {
  const { getProductsByIds: getProductsByIdsRequest } = await loadProductReadTransport()
  return getProductsByIdsRequest(ids, params)
}
export const getProductFilters = async (params = {}) => {
  const { getProductFilters: getProductFiltersRequest } = await loadProductReadTransport()
  return getProductFiltersRequest(params)
}
export const getProductLookupUsage = async () => {
  const { getProductLookupUsage: getProductLookupUsageRequest } = await loadProductReadTransport()
  return getProductLookupUsageRequest()
}
export const replaceProductLookupValues = async (payload = {}) => {
  const { replaceProductLookupValues: replaceProductLookupValuesRequest } = await loadProductReadTransport()
  return replaceProductLookupValuesRequest(payload)
}
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
export const deleteProduct = async (id, reason) => {
  const module = await loadProductWriteTransport()
  return module.deleteProduct(id, reason)
}

// ─── OTP / 2FA ────────────────────────────────────────────────────────────────
export const otpSetup = async (payload) => {
  const { otpSetup: otpSetupRequest } = await loadAuthTransport()
  return otpSetupRequest(payload)
}
export const otpConfirm = async (payload) => {
  const { otpConfirm: otpConfirmRequest } = await loadAuthTransport()
  return otpConfirmRequest(payload)
}
export const otpDisable = async (payload) => {
  const { otpDisable: otpDisableRequest } = await loadAuthTransport()
  return otpDisableRequest(payload)
}
export const otpVerify = async (payload) => {
  const { otpVerify: otpVerifyRequest } = await loadAuthTransport()
  return otpVerifyRequest(payload)
}
export const otpStatus = async (id) => {
  const { otpStatus: otpStatusRequest } = await loadAuthTransport()
  return otpStatusRequest(id)
}

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
  const result = await module.createImportJob(payload)
  // Let BackgroundImportTracker.tsx refetch immediately instead of waiting
  // for its own poll timer -- see pokeImportTracker's comment.
  pokeImportTracker()
  return result
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
export const assignImportJobImage = async (id, fileId, rowNumber = null) => {
  const module = await loadImportJobsTransport()
  return module.assignImportJobImage(id, fileId, rowNumber)
}
export const resolveImportJobImageLimit = async (id, rowNumber, keepFileIds = []) => {
  const module = await loadImportJobsTransport()
  return module.resolveImportJobImageLimit(id, rowNumber, keepFileIds)
}
export const wireImportJobImages = async id => {
  const module = await loadImportJobsTransport()
  return module.wireImportJobImages(id)
}
export const assignImportJobImageToExistingProduct = async (id, fileId, productId) => {
  const module = await loadImportJobsTransport()
  return module.assignImportJobImageToExistingProduct(id, fileId, productId)
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
export const dismissImportJob = async (id, options = {}) => {
  const module = await loadImportJobsTransport()
  return module.dismissImportJob(id, options)
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
export const recompressImportJobZipImages = async (jobId, images, onProgress) => {
  const module = await loadImportJobsTransport()
  return module.recompressImportJobZipImages(jobId, images, onProgress)
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
export const getInventorySummary = async (params = {}) => {
  const { getInventorySummary: getInventorySummaryRequest } = await loadInventoryTransport()
  return getInventorySummaryRequest(params)
}
export const getInventoryStats = async (params = {}) => {
  const { getInventoryStats: getInventoryStatsRequest } = await loadInventoryTransport()
  return getInventoryStatsRequest(params)
}
export const getInventoryBootstrap = async (params = {}) => {
  const { getInventoryBootstrap: getInventoryBootstrapRequest } = await loadInventoryTransport()
  return getInventoryBootstrapRequest(params)
}
export const searchInventoryProducts = async (params = {}) => {
  const { searchInventoryProducts: searchInventoryProductsRequest } = await loadInventoryTransport()
  return searchInventoryProductsRequest(params)
}
export const getInventoryMovements = async (params = {}) => {
  const { getInventoryMovements: getInventoryMovementsRequest } = await loadInventoryTransport()
  return getInventoryMovementsRequest(params)
}
export const getInventoryReasons = async () => {
  const { getInventoryReasons: getInventoryReasonsRequest } = await loadInventoryTransport()
  return getInventoryReasonsRequest()
}
export const saveInventoryReasons = async (items: unknown[] = []) => {
  const module = await loadInventoryWriteTransport()
  return module.saveInventoryReasons(items)
}

// Dated stock-reconciliation import review flow (see
// inventoryWriteTransport.ts's own header comment for the full 4-call
// shape: resolve -> apply-decisions -> preview -> apply).
export const resolveDatedStockCountRows = async (rows: unknown[] = []) => {
  const module = await loadInventoryWriteTransport()
  return module.resolveDatedStockCountRows(rows)
}
export const applyDatedStockCountDecisions = async (payload: Record<string, unknown> = {}) => {
  const module = await loadInventoryWriteTransport()
  return module.applyDatedStockCountDecisions(payload)
}
export const previewDatedStockCount = async (entries: unknown[] = []) => {
  const module = await loadInventoryWriteTransport()
  return module.previewDatedStockCount(entries)
}
export const applyDatedStockCount = async (entries: unknown[] = []) => {
  const module = await loadInventoryWriteTransport()
  return module.applyDatedStockCount(entries)
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
export const getUsers = async () => {
  const { getUsers: getUsersRequest } = await loadUserReadTransport()
  return getUsersRequest()
}
export const createUser = async d => {
  const { createUser: createUserRequest } = await loadUserAdminTransport()
  return createUserRequest(d)
}
export const updateUser = async (id, d) => {
  const { updateUser: updateUserRequest } = await loadUserAdminTransport()
  return updateUserRequest(id, d)
}
export const getUserProfile = async (id) => {
  const { getUserProfile: getUserProfileRequest } = await loadUserAdminTransport()
  return getUserProfileRequest(id)
}
export const getUserAuthMethods = async (id) => {
  const { getUserAuthMethods: getUserAuthMethodsRequest } = await loadUserAdminTransport()
  return getUserAuthMethodsRequest(id)
}
export const updateUserProfile = async (id, d) => {
  const { updateUserProfile: updateUserProfileRequest } = await loadUserAdminTransport()
  return updateUserProfileRequest(id, d)
}
export const disconnectUserAuthProvider = async (id, d) => {
  const { disconnectUserAuthProvider: disconnectUserAuthProviderRequest } = await loadUserAdminTransport()
  return disconnectUserAuthProviderRequest(id, d)
}
export const changeUserPassword = async (id, d) => {
  const { changeUserPassword: changeUserPasswordRequest } = await loadUserAdminTransport()
  return changeUserPasswordRequest(id, d)
}
export const resetPassword = async (id, d) => {
  const { resetPassword: resetPasswordRequest } = await loadUserAdminTransport()
  return resetPasswordRequest(id, d)
}

// ─── Roles ────────────────────────────────────────────────────────────────────
export const getRoles = async () => {
  const { getRoles: getRolesRequest } = await loadUserAdminTransport()
  return getRolesRequest()
}
export const createRole = async d => {
  const { createRole: createRoleRequest } = await loadUserAdminTransport()
  return createRoleRequest(d)
}
export const updateRole = async (id, d) => {
  const { updateRole: updateRoleRequest } = await loadUserAdminTransport()
  return updateRoleRequest(id, d)
}
export const deleteRole = async (id, payload) => {
  const { deleteRole: deleteRoleRequest } = await loadUserAdminTransport()
  return deleteRoleRequest(id, payload)
}

// ─── Backup ───────────────────────────────────────────────────────────────────
export async function getSystemJob(id) {
  const { getSystemJob: getSystemJobRequest } = await loadSystemJobsTransport()
  return getSystemJobRequest(id)
}

export async function cancelSystemJob(id, reason = 'Cancelled by user') {
  const { cancelSystemJob: cancelSystemJobRequest } = await loadSystemJobsTransport()
  return cancelSystemJobRequest(id, reason)
}

export async function pollSystemJob(jobId, options = {}) {
  const { pollSystemJob: pollSystemJobRequest } = await loadSystemJobsTransport()
  return pollSystemJobRequest(jobId, options)
}

export const getIntegrationDoctor = (options = {}) =>
  callSystemRuntimeMethod('getIntegrationDoctor', options)

export async function queueBackupFolderExport(destinationDir = '') {
  const { queueBackupFolderExport: queueBackupFolderExportRequest } = await loadSystemJobsTransport()
  return queueBackupFolderExportRequest(destinationDir)
}

export async function exportBackupFolder(destinationDir) {
  return queueBackupFolderExport(destinationDir)
}

export async function queueBackupFolderRestore(sourceDir) {
  const { queueBackupFolderRestore: queueBackupFolderRestoreRequest } = await loadSystemJobsTransport()
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

// Local Dexie mirror tables to clear per reset-data mode, matching what the
// *server* actually deletes/zeroes for that mode (see cloudflare/src/routes/
// system.ts's reset-data handler and coreDataInvariants.ts's
// PRODUCTS_RESET_TABLES) -- not every locally-mirrored table. mode='all' is
// deliberately left out of this map: it deletes almost the entire dataset
// (see reset-data's mode==='all' branch), so it keeps the original
// unscoped full-mirror wipe rather than needing its own near-total list.
function resetDataMirrorTables(mode, options = {}) {
  if (mode === 'products') {
    const tables = ['products', 'branch_stock']
    if (options.includeMovements) tables.push('inventory_movements', 'stock_transfers')
    if (options.includeSales) tables.push('sales', 'sale_items', 'returns')
    return tables
  }
  if (mode === 'sales') {
    // Server deletes sales/returns/movements/transfers and zeroes stock
    // quantities (branch_stock, products.stock_quantity) -- products rows
    // themselves, customers, suppliers, and contacts are untouched.
    return ['sales', 'sale_items', 'returns', 'inventory_movements', 'stock_transfers', 'branch_stock', 'products']
  }
  return undefined
}

export async function resetData(mode = 'sales', options = {}) {
  const result = await callSystemRuntimeMethod('resetData', mode, options)
  await invalidateClientRuntimeState(
    mode === 'all' ? 'reset-data-all' : mode === 'products' ? 'reset-data-products' : 'reset-data-sales',
    resetDataMirrorTables(mode, options),
  )
  return result
}

// Local mirror table(s) per reset-section section -- same one-table-in,
// one-table-out shape as resetDataMirrorTables above, just simpler since
// each of these four sections is already a single plain DELETE server-side
// (see routes/system.ts's SECTION_CONFIG). customer_share_submissions
// (the one section with a second server-side table) has no local Dexie
// mirror table of its own to clear -- it was never mirrored locally in the
// first place (not in localDb.ts's schema), so there's nothing to add here
// for it.
const RESET_SECTION_MIRROR_TABLES = {
  customers: ['customers'],
  suppliers: ['suppliers'],
  delivery_contacts: ['delivery_contacts'],
  audit_log: ['audit_logs'],
}

export async function resetSection(section) {
  const result = await callSystemRuntimeMethod('resetSection', section)
  await invalidateClientRuntimeState(`reset-section-${section}`, RESET_SECTION_MIRROR_TABLES[section] || [])
  return result
}

export async function factoryReset() {
  const result = await callSystemRuntimeMethod('factoryReset')
  await invalidateClientRuntimeState('factory-reset')
  return result
}

// ─── Import template downloads ────────────────────────────────────────────────
export function downloadImportTemplate(type) {
  // 1) Branch by import entity and emit a CSV header-only template.
  // 2) Product template focuses on filename-based image columns.
  // 3) `image_conflict_mode` controls keep/replace/append behavior during bulk import.
  // Note: internal bookkeeping columns (_action, _conflict_mode, _field_rules,
  // _target_product_id, _parent_id, etc.) are deliberately excluded here - the
  // import planner computes them automatically, so a blank template a person
  // fills in by hand should start at the first real data column.
  if (type === 'customer') return downloadCustomerTemplate()
  // gender and created_date (delivery contact template below) added for
  // parity with the customer/supplier templates -- classifyContacts
  // (importEngine.ts) parses both identically for delivery_contacts as it
  // does for the other two contact tables.
  if (type === 'deliveryContact') return buildImportCsvTemplate([
    'name', 'phone', 'area', 'address', 'gender', 'created_date', 'notes',
    'contact_label_1','contact_name_1','contact_phone_1','contact_area_1',
    'contact_label_2','contact_name_2','contact_phone_2','contact_area_2',
    'contact_label_3','contact_name_3','contact_phone_3','contact_area_3',
  ], 'delivery-contacts-template.csv')
  if (type === 'supplier') return downloadSupplierTemplate()
  if (type === 'sales') {
    // Sales import records HISTORY -- it links each line to a product but
    // never deducts or adds stock on its own (the sale already happened,
    // long before this file existed; deducting again would double-count
    // against today's real stock). The one exception is sale_status
    // 'returned'/'partial_return': that's stock physically coming back, so
    // it's the one status that restocks -- see lib/salesStatus.ts and
    // classifySales' own header comment on the reasoning.
    // batch_label/returned_quantity only matter for a return: batch_label
    // (optional) restocks a specific existing lot instead of just the
    // branch total; returned_quantity (optional) says how much of THIS
    // line actually came back -- leave both blank for a normal sale.
    // discount_usd/tax_usd/exchange_rate/amount_paid_*/membership_*/
    // delivery_* mirror the same order-level fields a manual POS checkout
    // records (routes/sales.ts POST /) -- all optional, all default the
    // same way an in-store sale with none of them filled in would (0
    // discount/tax, full amount paid, no membership redemption, not a
    // delivery). membership_points_redeemed is trusted as given, not
    // re-validated against the customer's live points balance the way a
    // real-time checkout redemption is -- that check exists to stop a
    // replayed/stale live request from overspending a balance that could
    // have changed since the cashier's screen last loaded it, which has
    // no equivalent for a historical file being loaded once.
    return buildImportCsvTemplate([...SALES_IMPORT_COLUMNS], 'sales-template.csv', SALES_IMPORT_EXAMPLE_ROWS)
  }
  // Inventory used to ship as one template with a free-text 'action' column
  // (add/remove/set typed by hand into the CSV) -- easy to mistype, and
  // easy to end up with a file that mixes actions row-to-row without
  // meaning to. Split into one template per action instead: the action is
  // now which template you downloaded, not a column value, so the import
  // only ever needs the columns that action actually uses.
  if (type === 'inventoryAdd') {
    // Receiving stock: a positive quantity, plus the cost it came in at
    // (optional -- updates the product's cost price when given, same
    // as a manual product edit would). `date` is optional too -- when
    // given, backdates the recorded movement to that date (e.g. "this
    // stock actually arrived last Tuesday"); left blank, it lands at
    // today/now, same as a manual Receive Stock action with no date
    // typed in.
    return buildImportCsvTemplate([
      'date', 'branch', 'name', 'sku', 'barcode', 'quantity',
      'unit_cost_usd', 'unit_cost_khr', 'reason',
    ], 'inventory-add-template.csv', {
      date: '', branch: 'Main Branch', name: 'Iced Coffee', sku: 'BEV-001', barcode: '',
      quantity: '20', unit_cost_usd: '1.20', unit_cost_khr: '', reason: 'Restock from supplier',
    })
  }
  if (type === 'inventoryRemove') {
    // Removing stock (shrinkage, breakage, manual correction downward):
    // quantity is how much to take out, always entered as a positive
    // number -- no unit cost, since a removal doesn't change what the
    // product is worth. `date` optional, same fallback-to-now rule as
    // the 'add' template above.
    return buildImportCsvTemplate([
      'date', 'branch', 'name', 'sku', 'barcode', 'quantity', 'reason',
    ], 'inventory-remove-template.csv', {
      date: '', branch: 'Main Branch', name: 'Iced Coffee', sku: 'BEV-001', barcode: '',
      quantity: '2', reason: 'Damaged in storage',
    })
  }
  if (type === 'inventorySet') {
    // Setting an exact count (stock take / physical count reconciliation):
    // quantity is the true on-hand count, not a delta -- the import
    // computes the add/remove movement needed to reach it. `date`
    // optional, same fallback-to-now rule as above.
    return buildImportCsvTemplate([
      'date', 'branch', 'name', 'sku', 'barcode', 'quantity', 'reason',
    ], 'inventory-set-template.csv', {
      date: '', branch: 'Main Branch', name: 'Iced Coffee', sku: 'BEV-001', barcode: '',
      quantity: '38', reason: 'Physical count',
    })
  }
  if (type === 'inventory') {
    // Legacy combined template, kept for anyone with an existing
    // spreadsheet/integration built against the old single-file shape --
    // still reads 'action' per row rather than being tied to one action.
    return buildImportCsvTemplate([
      'date', 'action', 'branch', 'name', 'sku', 'barcode', 'quantity',
      'unit_cost_usd', 'unit_cost_khr', 'reason',
    ], 'inventory-template.csv', {
      date: '', action: 'in', branch: 'Main Branch', name: 'Iced Coffee', sku: 'BEV-001', barcode: '',
      quantity: '20', unit_cost_usd: '1.20', unit_cost_khr: '', reason: 'Restock from supplier',
    })
  }
  // Discount columns and image_conflict_mode dropped from this template
  // (Aug 23 2026, user request). Discounts/promotions are their own
  // dedicated flow (Promotions) -- not something a person setting up a
  // product catalog actually filled in by hand here, and they made the
  // template wider plus needed their own explanation paragraph below for
  // a feature most imports never touch. image_conflict_mode is similar:
  // BulkImportModal's review step already asks per-row (or in bulk) what
  // to do with a product's existing images via an interactive picker,
  // with a sensible automatic default already computed from whether the
  // row has incoming images (see buildCsvForImportJob's own
  // `image_conflict_mode:` line in BulkImportModal.tsx) -- the CSV column
  // was a redundant, easy-to-get-wrong second way to set the same thing
  // by hand. Removing both here only removes the blank-template columns;
  // the underlying import behavior and the review screen's picker are
  // unchanged.
  return buildImportCsvTemplate([
    'name','sku','barcode','category','brand','unit','description',
    'selling_price_usd','selling_price_khr',
    'vip_price_usd','vip_price_khr',
    'cost_price_usd','cost_price_khr',
    'stock_quantity','low_stock_threshold','batch(mm/dd/yyyy)','expiry_date','expiry_alert_days',
    'branch','supplier',
    'parent_id','is_group',
    'image_filename_1','image_filename_2','image_filename_3','image_filename_4','image_filename_5',
    'image_filenames',
    'is_active'
  ], 'products-template.csv', {
    name: 'Iced Coffee', sku: 'BEV-001', barcode: '', category: 'Beverages', brand: '', unit: 'cup',
    description: '', selling_price_usd: '2.50', selling_price_khr: '',
    vip_price_usd: '', vip_price_khr: '',
    cost_price_usd: '1.20', cost_price_khr: '',
    stock_quantity: '40', low_stock_threshold: '10',
    // Column consolidation (Aug 24 2026): the old separate `batch` label
    // column and `date` column are now one column, `batch(mm/dd/yyyy)`.
    // Leave it blank to let the system stamp today's date and
    // auto-derive the batch code from it, or fill in a specific received
    // date (e.g. "08/24/2026") -- the system reads that date and
    // auto-formats it into the stored batch code (e.g. "AUG242026") for
    // you; there's no separate free-typed label to fill in anymore.
    'batch(mm/dd/yyyy)': '', expiry_date: '', expiry_alert_days: '30',
    branch: 'Main Branch', supplier: '',
    parent_id: '', is_group: '',
    // Naming convention: spaces in the product name stay as real spaces,
    // only characters a filename can't contain (/, \, :, etc.) become a
    // dash -- see importImageMatch.ts's sanitizeBaseName/normalizeImageMatchKey
    // for the authoritative rule. The trailing _1/_2/.../_n is the per-image
    // index, always an underscore regardless of what's in the name itself.
    // "iced-coffee.jpg" was a misleading example: "Iced Coffee" has a
    // space, not a disallowed character, so it should never come out
    // dash-joined -- that shape is what "10/20ml.jpg" would produce, not this.
    image_filename_1: 'Iced Coffee_1.jpg', image_filename_2: '', image_filename_3: '',
    image_filename_4: '', image_filename_5: '',
    image_filenames: '',
    is_active: '1',
  })
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
