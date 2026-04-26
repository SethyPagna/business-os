
// ─── Device info helper ───────────────────────────────────────────────────────
function getDeviceInfo() {
  return getClientDeviceInfo()
}

/**
 * api/methods.js — All window.api domain methods.
 *
 * Each method calls route() with a server function (apiFetch) and,
 * where available, a local Dexie fallback for offline-first reads.
 */

import { apiFetch, route, getSyncServerUrl, getAuthSessionToken, cacheInvalidate, cacheClearAll, isNetErr } from './http.js'
import { dexieDb, localGetSettings, localSaveSettings, buildCSVTemplate } from './localDb.js'
import { STORAGE_KEYS } from '../constants'
import { getClientDeviceInfo } from '../utils/deviceInfo.js'

function getPortalBaseUrl() {
  const browserOrigin = typeof window !== 'undefined' ? (window.location?.origin || '') : ''
  return (browserOrigin || getSyncServerUrl() || '').replace(/\/$/, '')
}

function getCurrentUserContext() {
  if (typeof window === 'undefined') return { userId: null, userName: '' }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.USER)
    if (!raw) return { userId: null, userName: '' }
    const parsed = JSON.parse(raw)
    return {
      userId: Number(parsed?.id || 0) || null,
      userName: String(parsed?.name || parsed?.username || '').trim(),
    }
  } catch (_) {
    return { userId: null, userName: '' }
  }
}

function queueOfflineWrite(channel, payload) {
  return dexieDb.sync_queue.add({
    channel,
    payload: JSON.stringify(payload || {}),
    status: 'pending',
    created_at: new Date().toISOString(),
  }).catch(() => {})
}

function appendActorQuery(path, extra = {}) {
  const query = new URLSearchParams()
  const { userId, userName } = getCurrentUserContext()
  if (userId) query.set('userId', String(userId))
  if (userName) query.set('userName', userName)
  Object.entries(extra || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    query.set(key, String(value))
  })
  if (!query.toString()) return path
  return `${path}${path.includes('?') ? '&' : '?'}${query.toString()}`
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
export async function login({ username, password, sessionDuration, clientTime, deviceTz, deviceName }) {
  return apiFetch('POST', '/api/auth/login', { username, password, sessionDuration, clientTime, deviceTz, deviceName })
}
export async function logout() {
  return apiFetch('POST', '/api/auth/logout', {})
}
export async function requestLoginCode(payload) {
  return apiFetch('POST', '/api/auth/login/request-code', payload || {})
}
export async function verifyLoginCode(payload) {
  return apiFetch('POST', '/api/auth/login/verify-code', payload || {})
}
export async function requestPasswordResetCode(payload) {
  return apiFetch('POST', '/api/auth/password-reset/request', payload || {})
}
export async function completePasswordReset(payload) {
  return apiFetch('POST', '/api/auth/password-reset/complete', payload || {})
}
export async function getVerificationCapabilities() {
  return apiFetch('GET', '/api/auth/verification-capabilities')
}
export async function getSystemConfig() {
  return apiFetch('GET', '/api/system/config')
}
export async function startSupabaseOauth(payload) {
  return apiFetch('POST', '/api/auth/oauth/start', payload || {})
}
export async function completeSupabaseOauth(payload) {
  return apiFetch('POST', '/api/auth/oauth/complete', payload || {})
}

// ─── Settings ─────────────────────────────────────────────────────────────────
export async function getSettings() {
  return route('settings:get', () => apiFetch('GET', '/api/settings'), localGetSettings)
}
export async function saveSettings(updates) {
  await apiFetch('POST', '/api/settings', updates)
  await localSaveSettings(updates).catch(() => {})
}

// ─── Categories ───────────────────────────────────────────────────────────────
export const getCategories  = ()       => route('categories:get',    () => apiFetch('GET', '/api/categories'),              () => dexieDb.categories.orderBy('name').toArray())
export const createCategory = d        => route('categories:create', () => apiFetch('POST', '/api/categories', d),           null, true)
export const updateCategory = (id, d)  => route('categories:update', () => apiFetch('PUT', `/api/categories/${id}`, d),      null, true)
export const deleteCategory = id       => route('categories:delete', () => apiFetch('DELETE', `/api/categories/${id}`),      null, true)

// ─── Units ────────────────────────────────────────────────────────────────────
export const getUnits   = ()  => route('units:get',    () => apiFetch('GET', '/api/units'),          () => dexieDb.units.orderBy('name').toArray())
export const createUnit = d   => route('units:create', () => apiFetch('POST', '/api/units', d),       null, true)
export const deleteUnit = id  => route('units:delete', () => apiFetch('DELETE', `/api/units/${id}`),  null, true)

// ─── Custom fields ────────────────────────────────────────────────────────────
export const getCustomFields   = ()       => route('customFields:get',    () => apiFetch('GET', '/api/custom-fields'),              () => dexieDb.custom_fields.toArray())
export const createCustomField = d        => route('customFields:create', () => apiFetch('POST', '/api/custom-fields', d),           null, true)
export const updateCustomField = (id, d)  => route('customFields:update', () => apiFetch('PUT', `/api/custom-fields/${id}`, d),      null, true)
export const deleteCustomField = id       => route('customFields:delete', () => apiFetch('DELETE', `/api/custom-fields/${id}`),      null, true)

// ─── Branches ─────────────────────────────────────────────────────────────────
export const getBranches    = ()       => route('branches:get',    () => apiFetch('GET', '/api/branches'),              () => dexieDb.branches.toArray())
export const createBranch   = d        => route('branches:create', () => apiFetch('POST', '/api/branches', { ...getDeviceInfo(), ...d }),           null, true)
export const updateBranch   = (id, d)  => route('branches:update', () => apiFetch('PUT', `/api/branches/${id}`, { ...getDeviceInfo(), ...d }),      null, true)
export const deleteBranch   = (id, userId, userName) => route('branches:delete', () => apiFetch('DELETE', `/api/branches/${id}`, { userId, userName }),      null, true)
export const getBranchStock = id       => route('branches:stock',  () => apiFetch('GET', `/api/branches/${id}/stock`),   () => [])
export const getTransfers   = ()       => route('transfers:get',   () => apiFetch('GET', '/api/transfers'),              () => dexieDb.stock_transfers.orderBy('created_at').reverse().toArray())
export const transferStock  = d        => route('branches:transfer', () => apiFetch('POST', '/api/branches/transfer', d), null, true)

// ─── Products ─────────────────────────────────────────────────────────────────
export const getProducts        = ()       => route('products:get',        () => apiFetch('GET', '/api/products'),                    () => dexieDb.products.orderBy('name').toArray())
export async function getCatalogMeta() {
  const base = getPortalBaseUrl()
  const res = await fetch(`${base}/api/catalog/meta`, {
    headers: { 'bypass-tunnel-reminder': 'true' },
  })
  if (!res.ok) throw new Error(`Catalog meta failed: ${res.status}`)
  return res.json()
}
export async function getCatalogProducts() {
  const base = getPortalBaseUrl()
  const res = await fetch(`${base}/api/catalog/products`, {
    headers: { 'bypass-tunnel-reminder': 'true' },
  })
  if (!res.ok) throw new Error(`Catalog products failed: ${res.status}`)
  return res.json()
}
export async function getPortalConfig() {
  const base = getPortalBaseUrl()
  const res = await fetch(`${base}/api/portal/config`, {
    headers: { 'bypass-tunnel-reminder': 'true' },
  })
  if (!res.ok) throw new Error(`Portal config failed: ${res.status}`)
  return res.json()
}
export async function getPortalCatalogMeta() {
  const base = getPortalBaseUrl()
  const res = await fetch(`${base}/api/portal/catalog/meta`, {
    headers: { 'bypass-tunnel-reminder': 'true' },
  })
  if (!res.ok) throw new Error(`Portal catalog meta failed: ${res.status}`)
  return res.json()
}
export async function getPortalCatalogProducts() {
  const base = getPortalBaseUrl()
  const res = await fetch(`${base}/api/portal/catalog/products`, {
    headers: { 'bypass-tunnel-reminder': 'true' },
  })
  if (!res.ok) throw new Error(`Portal catalog products failed: ${res.status}`)
  return res.json()
}
export async function lookupPortalMembership(membershipNumber) {
  const base = getPortalBaseUrl()
  const value = encodeURIComponent(String(membershipNumber || '').trim())
  const res = await fetch(`${base}/api/portal/membership/${value}`, {
    headers: { 'bypass-tunnel-reminder': 'true' },
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Membership lookup failed: ${res.status}`)
  return res.json()
}
export async function createPortalSubmission(payload) {
  const base = getPortalBaseUrl()
  const res = await fetch(`${base}/api/portal/submissions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'bypass-tunnel-reminder': 'true',
    },
    body: JSON.stringify(payload || {}),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `Submission failed: ${res.status}`)
  return json
}
export async function getPortalAiStatus() {
  const base = getPortalBaseUrl()
  const res = await fetch(`${base}/api/portal/ai/status`, {
    headers: { 'bypass-tunnel-reminder': 'true' },
  })
  if (!res.ok) throw new Error(`Portal AI status failed: ${res.status}`)
  return res.json()
}
export async function askPortalAi(payload) {
  const base = getPortalBaseUrl()
  const res = await fetch(`${base}/api/portal/ai/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'bypass-tunnel-reminder': 'true',
    },
    body: JSON.stringify(payload || {}),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `Portal AI failed: ${res.status}`)
  return json
}
export const getPortalSubmissionsForReview = () =>
  route('portalSubmissions:get', () => apiFetch('GET', '/api/portal/submissions/review'), () => [])
export const reviewPortalSubmission = (id, payload) =>
  route('portalSubmissions:review', () => apiFetch('PATCH', `/api/portal/submissions/${id}/review`, payload), null, true)

export const getAiProviders = () =>
  route('ai:providers:get', () => apiFetch('GET', appendActorQuery('/api/ai/providers')), () => ({ items: [], providerMeta: {} }))
export const createAiProvider = (payload) =>
  route('ai:providers:create', () => apiFetch('POST', '/api/ai/providers', payload), null, true)
export const updateAiProvider = (id, payload) =>
  route('ai:providers:update', () => apiFetch('PUT', `/api/ai/providers/${id}`, payload), null, true)
export const deleteAiProvider = (id, payload) =>
  route('ai:providers:delete', () => apiFetch('DELETE', `/api/ai/providers/${id}`, payload), null, true)
export const testAiProvider = (id, payload) =>
  route('ai:providers:test', () => apiFetch('POST', `/api/ai/providers/${id}/test`, payload), null, true)
export const getAiResponses = (limit = 80) =>
  route(`ai:responses:${limit}`, () => apiFetch('GET', appendActorQuery(`/api/ai/responses?limit=${limit}`)), () => ({ items: [] }))
export async function createProduct(d) {
  // Auto-create supplier if new
  if (d.supplier?.trim()) {
    try {
      const existing = await dexieDb.suppliers.where('name').equalsIgnoreCase(d.supplier.trim()).first()
      if (!existing) {
        try { await apiFetch('POST', '/api/suppliers', { name: d.supplier.trim(), ...getDeviceInfo() }) }
        catch (_) { await dexieDb.suppliers.add({ name: d.supplier.trim(), created_at: new Date().toISOString() }) }
        cacheInvalidate('suppliers')
      }
    } catch (_) {}
  }
  // Try server; if offline, save to local Dexie + queue for later sync
  try {
    return await route('products:create', () => apiFetch('POST', '/api/products', { ...getDeviceInfo(), ...d }), null, true)
  } catch (e) {
    if (!isNetErr(e)) throw e  // real server error, not connectivity — rethrow
    // Offline: save locally
    const localId = await dexieDb.products.add({
      ...d,
      id: undefined,  // Dexie auto-assigns
      stock_quantity: d.stock_quantity || 0,
      created_at: new Date().toISOString(),
      _local_pending: 1,
    })
    cacheInvalidate('products')
    // Queue for sync when back online
    await queueOfflineWrite('products:create', { ...getDeviceInfo(), ...d })
    return { success: true, id: localId, _offline: true }
  }
}
export async function updateProduct(id, d) {
  if (d.supplier?.trim()) {
    try {
      const existing = await dexieDb.suppliers.where('name').equalsIgnoreCase(d.supplier.trim()).first()
      if (!existing) {
        try { await apiFetch('POST', '/api/suppliers', { name: d.supplier.trim(), ...getDeviceInfo() }) } catch (_) {
          await dexieDb.suppliers.add({ name: d.supplier.trim(), created_at: new Date().toISOString() })
        }
        cacheInvalidate('suppliers')
      }
    } catch (_) {}
  }
  return route('products:update', () => apiFetch('PUT', `/api/products/${id}`, { ...getDeviceInfo(), ...d }), null, true)
}
export const deleteProduct      = id       => route('products:delete',     () => apiFetch('DELETE', `/api/products/${id}`),            null, true)

// ─── OTP / 2FA ────────────────────────────────────────────────────────────────
export const otpSetup   = d  => apiFetch('POST', '/api/auth/otp/setup', d)
export const otpConfirm = d  => apiFetch('POST', '/api/auth/otp/confirm', d)
export const otpDisable = d  => apiFetch('POST', '/api/auth/otp/disable', d)
export const otpVerify  = d  => apiFetch('POST', '/api/auth/otp/verify', d)
export const otpStatus  = id => apiFetch('GET', `/api/auth/otp/status/${id}`)

// ─── Product Variants ─────────────────────────────────────────────────────────
export const createProductVariant = d => route('products:create', () => apiFetch('POST', '/api/products/variant', d), null, true)

export const bulkImportProducts = d        => route('products:bulkImport', () => apiFetch('POST', '/api/products/bulk-import', d),     null, true)

export async function getFiles(params = {}) {
  const q = new URLSearchParams(Object.entries(params || {}).filter(([, value]) => value != null && value !== '')).toString()
  const result = await route(`files:get:${q}`, () => apiFetch('GET', `/api/files${q ? `?${q}` : ''}`), () => [])
  return Array.isArray(result?.items) ? result.items : (Array.isArray(result) ? result : [])
}

export async function uploadFileAsset({ file, userId, userName }) {
  if (!(file instanceof File)) throw new Error('Choose a file first')
  const base = getSyncServerUrl().replace(/\/$/, '')
  const device = getDeviceInfo()
  const headers = {
    'bypass-tunnel-reminder': 'true',
    'x-client-time': device.clientTime || '',
    'x-device-tz': device.deviceTz || '',
    'x-device-name': device.deviceName || '',
  }
  const authToken = getAuthSessionToken()
  if (authToken) headers['x-auth-session'] = authToken

  const form = new FormData()
  form.append('file', file, file.name)
  if (userId) form.append('userId', String(userId))
  if (userName) form.append('userName', String(userName))
  if (device.deviceName) form.append('deviceName', String(device.deviceName))
  if (device.deviceTz) form.append('deviceTz', String(device.deviceTz))
  if (device.clientTime) form.append('clientTime', String(device.clientTime))

  const res = await fetch(`${base}/api/files/upload`, { method: 'POST', headers, body: form })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`File upload failed: ${text || res.status}`)
  }
  const json = await res.json()
  return json?.data || json
}

export async function deleteFileAsset(id) {
  return route('files:delete', () => apiFetch('DELETE', `/api/files/${id}`, getCurrentUserContext()), null, true)
}

/**
 * uploadProductImage — accepts { productId, filePath, fileName } where filePath
 * is a base64 data-URL (set by Products.jsx browser file-picker), OR a native
 * file system path (Electron). Converts to FormData and POSTs as multipart.
 */
export async function uploadProductImage({ productId, filePath, fileName }) {
  const base    = getSyncServerUrl().replace(/\/$/, '')
  const headers = { 'bypass-tunnel-reminder': 'true' }
  const authToken   = getAuthSessionToken()
  if (authToken) headers['x-auth-session'] = authToken

  const fd = new FormData()

  if (filePath && filePath.startsWith('data:')) {
    // Browser: convert base64 data-URL → Blob
    const [meta, b64] = filePath.split(',')
    const mime        = meta.match(/:(.*?);/)?.[1] || 'image/jpeg'
    const bytes       = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    fd.append('image', new Blob([bytes], { type: mime }), fileName || 'product.jpg')
  } else if (filePath) {
    // Electron path — should never reach browser, but handle gracefully
    throw new Error('Native file path upload not supported in browser mode')
  } else {
    throw new Error('No image data provided')
  }

  const res = await fetch(`${base}/api/products/upload-image`, { method: 'POST', headers, body: fd })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Image upload failed: ${text || res.status}`)
  }
  return res.json()
}

export async function uploadUserAvatar({ filePath, fileName, file }) {
  if (file instanceof File) {
    const { userId, userName } = getCurrentUserContext()
    const asset = await uploadFileAsset({ file, userId, userName })
    return {
      path: asset?.public_path || '',
      asset,
    }
  }
  const base = getSyncServerUrl().replace(/\/$/, '')
  const headers = { 'bypass-tunnel-reminder': 'true' }
  const authToken = getAuthSessionToken()
  if (authToken) headers['x-auth-session'] = authToken

  if (!filePath || !filePath.startsWith('data:')) {
    throw new Error('No avatar image data provided')
  }

  const [meta, b64] = filePath.split(',')
  const mime = meta.match(/:(.*?);/)?.[1] || 'image/jpeg'
  const bytes = Uint8Array.from(atob(b64), (char) => char.charCodeAt(0))
  const fd = new FormData()
  fd.append('image', new Blob([bytes], { type: mime }), fileName || 'avatar.jpg')

  const res = await fetch(`${base}/api/users/avatar-upload`, { method: 'POST', headers, body: fd })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Avatar upload failed: ${text || res.status}`)
  }
  return res.json()
}

// ─── CSV / file dialog (browser implementations) ──────────────────────────────
/**
 * openCSVDialog — opens a file picker, reads the selected CSV, and returns
 * { content: string } — same shape as the Electron preload's openCSVDialog.
 */
export function openCSVDialog() {
  return new Promise((resolve) => {
    const input  = document.createElement('input')
    input.type   = 'file'
    input.accept = '.csv,text/csv'
    input.onchange = async (e) => {
      const file = e.target.files?.[0]
      if (!file) { resolve(null); return }
      const content = await file.text()
      resolve({ content, name: file.name })
    }
    input.oncancel = () => resolve(null)
    input.click()
  })
}

/**
 * openImageDialog — in browser mode always returns null so Products.jsx
 * falls through to its own file-input fallback.
 */
export function openImageDialog() {
  return Promise.resolve(null)
}

/**
 * getImageDataUrl — not needed in browser (images served via /uploads/).
 * Returns null so callers fall back gracefully.
 */
export function getImageDataUrl(_path) {
  return Promise.resolve(null)
}

/** getSyncServerUrl — exposed on window.api for components that build URLs directly. */
export { getSyncServerUrl, getAuthSessionToken }

// ─── Inventory ────────────────────────────────────────────────────────────────
export const adjustStock           = d         => route('products:adjustStock', () => apiFetch('POST', '/api/inventory/adjust', { ...getDeviceInfo(), ...d }), null, true)
export const getInventorySummary   = ({ branchId } = {}) => route(branchId ? `inventory:summary:${branchId}` : 'inventory:summary', () => apiFetch('GET', `/api/inventory/summary${branchId ? `?branchId=${branchId}` : ''}`), () => [])
export const getInventoryMovements = ({ branchId } = {}, limit) => route(branchId ? `inventory:movements:${branchId}` : 'inventory:movements', () => apiFetch('GET', `/api/inventory/movements?limit=${limit || 500}${branchId ? `&branchId=${branchId}` : ''}`), () => dexieDb.inventory_movements.orderBy('created_at').reverse().limit(limit || 500).toArray())

// ─── Sales ────────────────────────────────────────────────────────────────────
export async function createSale(d) {
  try {
    return await route('sales:create', () => apiFetch('POST', '/api/sales', d), null, true)
  } catch (e) {
    if (!isNetErr(e)) throw e
    // Offline: store sale locally so it isn't lost
    const receiptNum = d.receipt_number || `OFFLINE-${Date.now()}`
    const localId = await dexieDb.sales.add({
      ...d,
      id: undefined,
      receipt_number: receiptNum,
      created_at: d.client_time || new Date().toISOString(),
      _local_pending: 1,
    })
    await queueOfflineWrite('sales:create', { ...d, receipt_number: receiptNum })
    cacheInvalidate('sales')
    return { success: true, id: localId, receipt_number: receiptNum, receiptNumber: receiptNum, _offline: true }
  }
}

export async function flushPendingSyncQueue() {
  const syncServerUrl = getSyncServerUrl()
  if (!syncServerUrl || !getAuthSessionToken()) return { processed: 0, failed: 0 }

  const pending = await dexieDb.sync_queue
    .where('status')
    .equals('pending')
    .sortBy('created_at')

  let processed = 0
  let failed = 0

  for (const item of pending) {
    let payload = {}
    try {
      payload = item?.payload ? JSON.parse(item.payload) : {}
    } catch (_) {
      payload = {}
    }

    try {
      if (item.channel === 'products:create') {
        await apiFetch('POST', '/api/products', payload)
      } else if (item.channel === 'sales:create') {
        await apiFetch('POST', '/api/sales', payload)
      } else {
        await dexieDb.sync_queue.delete(item._seq)
        continue
      }

      await dexieDb.sync_queue.delete(item._seq)
      processed += 1
    } catch (error) {
      if (isNetErr(error)) {
        failed += 1
        break
      }
      failed += 1
      await dexieDb.sync_queue.update(item._seq, {
        status: 'failed',
        error: error?.message || 'Sync failed',
        updated_at: new Date().toISOString(),
      }).catch(() => {})
    }
  }

  if (processed > 0) {
    cacheInvalidate('products')
    cacheInvalidate('sales')
    window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'products', ts: Date.now() } }))
    window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'sales', ts: Date.now() } }))
    window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'inventory', ts: Date.now() } }))
    window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'dashboard', ts: Date.now() } }))
  }

  return { processed, failed }
}

export const getSales   = (params) => {
  const q = new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v != null)).toString()
  return route('sales:get', () => apiFetch('GET', `/api/sales${q ? '?' + q : ''}`), () => dexieDb.sales.orderBy('created_at').reverse().limit(1000).toArray())
}

// ─── Dashboard & analytics ────────────────────────────────────────────────────
export const getDashboard = ()       => route('dashboard:get',  () => apiFetch('GET', '/api/dashboard'),       () => ({}))
export const getAnalytics = (params) => {
  const q = new URLSearchParams(params).toString()
  // Include the full query string in the cache key so each unique date range
  // gets its own cache entry. Without this, changing the filter (e.g. 7d → 30d)
  // returns the stale cached result instead of re-fetching from the server.
  return route(`analytics:get:${q}`, () => apiFetch('GET', `/api/analytics?${q}`), () => ({}))
}

// ─── Customers ────────────────────────────────────────────────────────────────
export const getCustomers        = ()       => route('customers:get',        () => apiFetch('GET', '/api/customers'),                     () => dexieDb.customers.orderBy('name').toArray())
export const createCustomer      = d        => route('customers:create',     () => apiFetch('POST', '/api/customers', d),                  null, true)
export const updateCustomer      = (id, d)  => route('customers:update',     () => apiFetch('PUT', `/api/customers/${id}`, d),             null, true)
export const deleteCustomer      = id       => route('customers:delete',     () => apiFetch('DELETE', `/api/customers/${id}`),             null, true)
export const bulkImportCustomers = d        => route('customers:bulkImport', () => apiFetch('POST', '/api/customers/bulk-import', d),      null, true)
export const downloadCustomerTemplate = ()  => buildCSVTemplate(['name','membership_number','phone','email','address','company','notes'], 'customers-template.csv')

// ─── Suppliers ────────────────────────────────────────────────────────────────
export const getSuppliers        = ()       => route('suppliers:get',        () => apiFetch('GET', '/api/suppliers'),                      () => dexieDb.suppliers.orderBy('name').toArray())
export const createSupplier      = d        => route('suppliers:create',     () => apiFetch('POST', '/api/suppliers', d),                  null, true)
export const updateSupplier      = (id, d)  => route('suppliers:update',     () => apiFetch('PUT', `/api/suppliers/${id}`, d),             null, true)
export const deleteSupplier      = id       => route('suppliers:delete',     () => apiFetch('DELETE', `/api/suppliers/${id}`),             null, true)
export const bulkImportSuppliers = d        => route('suppliers:bulkImport', () => apiFetch('POST', '/api/suppliers/bulk-import', d),      null, true)
export const downloadSupplierTemplate = ()  => buildCSVTemplate(['name','phone','email','address','company','contact_person','notes'], 'suppliers-template.csv')

// ─── Delivery contacts ────────────────────────────────────────────────────────
export const getDeliveryContacts   = ()       => route('deliveryContacts:get',    () => apiFetch('GET', '/api/delivery-contacts'),               () => dexieDb.delivery_contacts.orderBy('name').toArray())
export const createDeliveryContact = d        => route('deliveryContacts:create', () => apiFetch('POST', '/api/delivery-contacts', d),           null, true)
export const updateDeliveryContact = (id, d)  => route('deliveryContacts:update', () => apiFetch('PUT', `/api/delivery-contacts/${id}`, d),      null, true)
export const deleteDeliveryContact = id       => route('deliveryContacts:delete', () => apiFetch('DELETE', `/api/delivery-contacts/${id}`),      null, true)
export const bulkImportDeliveryContacts = d   => route('deliveryContacts:bulkImport', () => apiFetch('POST', '/api/delivery-contacts/bulk-import', d), null, true)

// ─── Users ────────────────────────────────────────────────────────────────────
export const getUsers      = ()       => route('users:get',           () => apiFetch('GET', appendActorQuery('/api/users')),        () => dexieDb.users.toArray())
export const createUser    = d        => route('users:create',        () => apiFetch('POST', '/api/users', d),                      null, true)
export const updateUser    = (id, d)  => route('users:update',        () => apiFetch('PUT', `/api/users/${id}`, d),                 null, true)
export const getUserProfile = (id)    => route(`users:profile:${id}`, () => apiFetch('GET', appendActorQuery(`/api/users/${id}/profile`)), () => null)
export const getUserAuthMethods = (id) =>
  route(`users:authMethods:${id}`, () => apiFetch('GET', appendActorQuery(`/api/users/${id}/auth-methods`)), () => null)
export const updateUserProfile = (id, d) =>
  route('users:updateProfile', () => apiFetch('PUT', `/api/users/${id}/profile`, d), null, true)
export const changeUserPassword = (id, d) =>
  route('users:changePassword', () => apiFetch('POST', `/api/users/${id}/change-password`, d), null, true)
export const requestUserContactVerification = (id, d) =>
  route('users:contactVerification:request', () => apiFetch('POST', `/api/users/${id}/contact-verification/request`, d), null, true)
export const confirmUserContactVerification = (id, d) =>
  route('users:contactVerification:confirm', () => apiFetch('POST', `/api/users/${id}/contact-verification/confirm`, d), null, true)
export const resetPassword = (id, d)  => route('users:resetPassword', () => apiFetch('POST', `/api/users/${id}/reset-password`, d), null, true)

// ─── Roles ────────────────────────────────────────────────────────────────────
export const getRoles   = ()       => route('roles:get',    () => apiFetch('GET', appendActorQuery('/api/roles')), () => dexieDb.roles.toArray())
export const createRole = d        => route('roles:create', () => apiFetch('POST', '/api/roles', d),           null, true)
export const updateRole = (id, d)  => route('roles:update', () => apiFetch('PUT', `/api/roles/${id}`, d),      null, true)
export const deleteRole = (id, payload) => route('roles:delete', () => apiFetch('DELETE', `/api/roles/${id}`, payload), null, true)

// ─── Custom tables ────────────────────────────────────────────────────────────
export const getCustomTables    = ()                      => route('customTables:get',       () => apiFetch('GET', '/api/custom-tables'),                                             () => dexieDb.custom_tables.toArray())
export const createCustomTable  = d                       => route('customTables:create',    () => apiFetch('POST', '/api/custom-tables', d),                                         null, true)
export const getCustomTableData = ({ tableName })         => route('customTables:data',      () => apiFetch('GET', `/api/custom-tables/${tableName}/data`),                           () => [])
export const insertCustomRow    = ({ tableName, data })   => route('customTables:insertRow', () => apiFetch('POST', `/api/custom-tables/${tableName}/rows`, { data }),                null, true)
export const updateCustomRow    = ({ tableName, id, data }) => route('customTables:updateRow', () => apiFetch('PUT', `/api/custom-tables/${tableName}/rows/${id}`, { data }),         null, true)
export const deleteCustomRow    = ({ tableName, id })     => route('customTables:deleteRow', () => apiFetch('DELETE', `/api/custom-tables/${tableName}/rows/${id}`),                  null, true)

// ─── Audit log ────────────────────────────────────────────────────────────────
export const getAuditLogs = () => route('audit_log:get', () => apiFetch('GET', '/api/system/audit-logs'), () => dexieDb.audit_logs.orderBy('created_at').reverse().limit(200).toArray())

// ─── Backup ───────────────────────────────────────────────────────────────────
export async function exportBackup() {
  const url = getSyncServerUrl()
  if (!url) throw new Error('Server required for backup export')
  const headers = { 'bypass-tunnel-reminder': 'true' }
  const authToken = getAuthSessionToken()
  if (authToken) headers['x-auth-session'] = authToken
  const res  = await fetch(`${url}/api/system/backup/export`, { headers })
  if (!res.ok) throw new Error('Backup export failed')
  const blob = await res.blob()
  const a    = document.createElement('a')
  a.href     = URL.createObjectURL(blob)
  a.download = `business-os-backup-${new Date().toISOString().split('T')[0]}.json`
  a.click()
  URL.revokeObjectURL(a.href)
  return { success: true }
}

export async function exportBackupFolder(destinationDir) {
  return apiFetch('POST', '/api/system/backup/export-folder', { destinationDir }, LONG_SYSTEM_ACTION_TIMEOUT_MS)
}

export function pickBackupFile() {
  return new Promise((resolve, reject) => {
    const input  = document.createElement('input')
    input.type   = 'file'
    input.accept = '.json,application/json'
    input.onchange = async (e) => {
      const file = e.target.files?.[0]
      if (!file) { resolve(null); return }
      resolve(file)
    }
    input.oncancel = () => resolve(null)
    input.click()
  })
}

export async function importBackupData(data) {
  const result = await apiFetch('POST', '/api/system/backup/import', data)
  cacheClearAll()
  return result
}

export async function importBackupFolder(sourceDir) {
  const result = await apiFetch('POST', '/api/system/backup/import-folder', { sourceDir }, LONG_SYSTEM_ACTION_TIMEOUT_MS)
  cacheClearAll()
  return result
}

export async function importBackup() {
  const file = await pickBackupFile()
  if (!file) return { success: false }
  try {
    const data = JSON.parse(await file.text())
    return await importBackupData(data)
  } catch (err) {
    return Promise.reject(err)
  }
}

// ─── Data reset ───────────────────────────────────────────────────────────────
// After any reset or factory-reset, wipe the entire in-memory cache so that
// Dashboard, Inventory, Sales, Returns, Contacts, Branches, etc. all reload
// fresh data immediately instead of showing stale results for up to 45 s.
export async function resetData(mode = 'sales') {
  const result = await route('data:reset', () => apiFetch('POST', '/api/system/reset-data', { mode }), null, true)
  cacheClearAll()
  return result
}

export async function factoryReset() {
  const result = await route('data:factoryReset', () => apiFetch('POST', '/api/system/factory-reset'), null, true)
  cacheClearAll()
  return result
}

// ─── Import template downloads ────────────────────────────────────────────────
export function downloadImportTemplate(type) {
  // 1) Branch by import entity and emit a CSV header-only template.
  // 2) Product template focuses on filename-based image columns.
  // 3) `image_conflict_mode` controls keep/replace/append behavior during bulk import.
  if (type === 'customer') return downloadCustomerTemplate()
  if (type === 'deliveryContact') return buildCSVTemplate(['name', 'phone', 'area', 'address', 'notes'], 'delivery-contacts-template.csv')
  if (type === 'supplier') return downloadSupplierTemplate()
  buildCSVTemplate([
    'name','sku','barcode','category','brand','unit','description',
    'selling_price_usd','selling_price_khr',
    'purchase_price_usd','purchase_price_khr',
    'stock_quantity','low_stock_threshold',
    'branch','supplier',
    'image_filename_1','image_filename_2','image_filename_3','image_filename_4','image_filename_5',
    'image_filenames','image_conflict_mode',
    'is_active'
  ], 'products-template.csv')
}

// ─── No-ops for API compatibility ────────────────────────────────────────────
export async function openPath(targetPath) {
  try {
    return await apiFetch('POST', '/api/system/open-path', { path: targetPath })
  } catch (error) {
    return { success: false, error: error?.message || 'Failed to open path' }
  }
}

// ─── Returns ──────────────────────────────────────────────────────────────────
export const getReturns  = (params) => {
  const q = new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v != null)).toString()
  const cacheKey = q ? `returns:get:${q}` : 'returns:get'
  return route(cacheKey, () => apiFetch('GET', `/api/returns${q ? '?' + q : ''}`), () => [])
}
export const createReturn = d => route('returns:create', () => apiFetch('POST', '/api/returns', d), null, true)
export const createSupplierReturn = d => route('returns:createSupplier', () => apiFetch('POST', '/api/returns/supplier', d), null, true)
export const getReturn    = id => route('returns:getOne', () => apiFetch('GET', `/api/returns/${id}`), () => null)

// ─── Sale status update ───────────────────────────────────────────────────────
export const updateSaleStatus = (id, sale_status, notes) =>
  route('sales:updateStatus', () => apiFetch('PATCH', `/api/sales/${id}/status`, { sale_status, notes }), null, true)

// ─── Sales export ─────────────────────────────────────────────────────────────
export const attachSaleCustomer = (id, payload) =>
  route('sales:attachCustomer', () => apiFetch('PATCH', `/api/sales/${id}/customer`, payload), null, true)

export const getSalesExport = (params) => {
  const q = new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v != null)).toString()
  return route('sales:export', () => apiFetch('GET', `/api/sales/export${q ? '?' + q : ''}`), () => ({}))
}
export const updateReturn = (id, d) => route('returns:update', () => apiFetch('PATCH', `/api/returns/${id}`, d), null, true)

// ─── Sync server health test ──────────────────────────────────────────────────
// Used by ServerPage to validate a URL before saving it.
export async function testSyncServer(url) {
  try {
    const clean = (url || '').trim().replace(/\/$/, '')
    const res = await fetch(`${clean}/health`, {
      signal: AbortSignal.timeout?.(6000),
      headers: { 'bypass-tunnel-reminder': 'true' },
    })
    if (!res.ok) return { ok: false, message: `Server returned ${res.status}` }
    const json = await res.json().catch(() => ({}))
    return { ok: true, clients: json?.clients ?? null }
  } catch (e) {
    return { ok: false, message: e?.message || 'Connection failed' }
  }
}

// ─── Folder dialog (optional — only available in Electron/Tauri contexts) ─────
// In web mode this is a no-op; callers use optional chaining (?.) defensively.
const LONG_SYSTEM_ACTION_TIMEOUT_MS = 10 * 60 * 1000

export async function openFolderDialog(initialPath = '') {
  const result = await route(
    'system:pickFolder',
    () => apiFetch('POST', '/api/system/pick-folder', { initialPath }, LONG_SYSTEM_ACTION_TIMEOUT_MS),
    () => ({ selectedPath: null, cancelled: true })
  )
  if (result?.success === false) throw new Error(result.error || 'Failed to open folder picker')
  return result?.selectedPath || null
}

// ─── Data folder location ─────────────────────────────────────────────────────
export const getDataPath   = ()    => route('system:dataPath',   () => apiFetch('GET',    '/api/system/data-path'),       () => ({}))
export const setDataPath   = (dir) => route('system:setDataPath',() => apiFetch('POST',   '/api/system/data-path', { dataDir: dir }, LONG_SYSTEM_ACTION_TIMEOUT_MS), null, true)
export const resetDataPath = ()    => route('system:resetDataPath',()=> apiFetch('DELETE', '/api/system/data-path', undefined, LONG_SYSTEM_ACTION_TIMEOUT_MS), null, true)
export const browseDir     = (dir) => route('system:browseDir',  () => apiFetch('POST',   '/api/system/browse-dir', { dir }), () => ({ dirs: [] }))
