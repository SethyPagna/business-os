
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

import { apiFetch, route, getSyncServerUrl, getAuthSessionToken, cacheInvalidate, cacheClearAll, requireLiveServerWrite, isNetErr } from './http.js'
import { dexieDb, localGetSettings, localSaveSettings, localGetSettingsMeta, localSaveSettingsMeta, buildCSVTemplate, replaceTableContents, clearLocalMirrorTables } from './localDb.js'
import { resetClientRuntimeState } from '../platform/runtime/clientRuntime.js'
import { STORAGE_KEYS } from '../constants'
import { getClientDeviceInfo } from '../utils/deviceInfo.js'
import {
  LIVE_SERVER_SENSITIVE_MIRROR_TABLES,
  NOTIFICATION_SUMMARY_MISSING_UNTIL_KEY,
  NOTIFICATION_SUMMARY_MISSING_TTL_MS,
  DRIVE_SYNC_STATUS_COOLDOWN_KEY,
  DRIVE_SYNC_STATUS_COOLDOWN_MS,
  shouldPersistLocalMirror as shouldPersistLocalMirrorByPolicy,
  maxStoredNumber,
  isCooldownActive,
} from '../platform/storage/storagePolicy.mjs'

function getPortalBaseUrl() {
  const browserOrigin = typeof window !== 'undefined' ? (window.location?.origin || '') : ''
  return (browserOrigin || getSyncServerUrl() || '').replace(/\/$/, '')
}

function getCurrentUserContext() {
  if (typeof window === 'undefined') return { userId: null, userName: '' }
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEYS.USER) || window.localStorage.getItem(STORAGE_KEYS.USER)
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

function emitSyncQueueChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('sync:queue-changed', {
    detail: { ts: Date.now() },
  }))
}

export async function discardPendingSyncQueue(reason = 'Offline changes were invalidated because Business OS now requires a live server for writes.') {
  const existing = await dexieDb.sync_queue.toArray().catch(() => [])
  await dexieDb.sync_queue.clear().catch(() => {})
  emitSyncQueueChanged()
  if (typeof window !== 'undefined') {
    ;['products', 'sales', 'customers', 'suppliers', 'deliveryContacts', 'returns', 'inventory', 'dashboard'].forEach((channel) => {
      window.dispatchEvent(new CustomEvent('sync:update', {
        detail: { channel, reason: 'discard-pending-sync-queue', ts: Date.now() },
      }))
    })
  }
  return {
    success: true,
    discarded: existing.length,
    reason,
  }
}

function createClientRequestId(prefix = 'req') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function ensureClientRequestId(payload, prefix) {
  const current = String(payload?.client_request_id || '').trim()
  if (current) return { ...(payload || {}), client_request_id: current.slice(0, 120) }
  return { ...(payload || {}), client_request_id: createClientRequestId(prefix) }
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
    else if (status === 'failed') acc.failed += 1
    else acc.pending += 1
    return acc
  }, { total: 0, pending: 0, syncing: 0, failed: 0 })
  const oldest = sorted[0]?.created_at || null
  return {
    ...counts,
    oldest_created_at: oldest,
    writes_require_server: true,
    items: sorted.slice(0, 25).map((item) => ({
      _seq: item._seq,
      channel: item.channel,
      operation: item.operation || null,
      entity_table: item.entity_table || null,
      entity_id: item.entity_id ?? null,
      entity_name: item.entity_name || null,
      status: item.status || 'pending',
      created_at: item.created_at || null,
      updated_at: item.updated_at || null,
      retry_count: Number(item.retry_count || 0),
      retry_at: item.retry_at || null,
      error: item.error || null,
    })),
  }
}

export async function retryPendingSyncNow() {
  return discardPendingSyncQueue()
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

async function withExpectedUpdatedAt(tableName, id, payload = {}) {
  const body = { ...(payload || {}) }
  if (body.expectedUpdatedAt || body.expected_updated_at) return body
  if (body.updated_at) {
    body.expectedUpdatedAt = body.updated_at
    return body
  }
  try {
    const row = await dexieDb[tableName]?.get?.(id)
    if (row?.updated_at) body.expectedUpdatedAt = row.updated_at
  } catch (_) {}
  return body
}

async function withSettingsExpectedUpdatedAt(payload = {}) {
  const body = { ...(payload || {}) }
  if (body.expectedUpdatedAt || body.expected_updated_at) return body
  try {
    const meta = await localGetSettingsMeta()
    if (meta?.updatedAt) body.expectedUpdatedAt = meta.updatedAt
  } catch (_) {}
  return body
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

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function mirrorReadResult(mirrorFn, result) {
  if (typeof mirrorFn === 'function') {
    Promise.resolve()
      .then(() => mirrorFn(result))
      .catch(() => {})
  }
  return result
}

function routeMirrored(channel, serverFn, localFn, mirrorFn) {
  return route(channel, async () => mirrorReadResult(mirrorFn, await serverFn()), localFn)
}

let sensitiveMirrorPurgePromise = null

function shouldPersistLocalMirror(tableName) {
  return shouldPersistLocalMirrorByPolicy(tableName, getSyncServerUrl())
}

async function purgeSensitiveLiveServerMirrors() {
  if (!getSyncServerUrl()) {
    sensitiveMirrorPurgePromise = null
    return
  }
  if (!sensitiveMirrorPurgePromise) {
    sensitiveMirrorPurgePromise = clearLocalMirrorTables([...LIVE_SERVER_SENSITIVE_MIRROR_TABLES]).catch(() => {})
  }
  await sensitiveMirrorPurgePromise
}

function mirrorTable(tableName) {
  return async (rows) => {
    if (!shouldPersistLocalMirror(tableName)) {
      await clearLocalMirrorTables([tableName]).catch(() => {})
      return []
    }
    const incomingRows = Array.isArray(rows) ? rows.map((row) => ({ ...row })) : []
    return replaceTableContents(tableName, incomingRows)
  }
}

if (typeof window !== 'undefined') {
  Promise.resolve().then(() => purgeSensitiveLiveServerMirrors()).catch(() => {})
}

let notificationSummaryMissingUntilMemory = 0
let notificationSummaryRequestPromise = null
let driveSyncStatusCooldownMemory = 0
let driveSyncStatusRequestPromise = null

function getNotificationSummaryFallback(extra = {}) {
  return {
    unreadCount: 0,
    sections: [],
    preferences: {},
    ...extra,
  }
}

function getDriveSyncStatusFallback(extra = {}) {
  return {
    item: null,
    unavailable: true,
    ...extra,
  }
}

function readNotificationSummaryMissingUntil() {
  const memoryValue = Number(notificationSummaryMissingUntilMemory || 0)
  if (typeof window === 'undefined') return 0
  try {
    const sessionValue = Number(window.sessionStorage.getItem(NOTIFICATION_SUMMARY_MISSING_UNTIL_KEY) || 0)
    const localValue = Number(window.localStorage.getItem(NOTIFICATION_SUMMARY_MISSING_UNTIL_KEY) || 0)
    return maxStoredNumber([sessionValue, localValue, memoryValue])
  } catch (_) {
    return Number.isFinite(memoryValue) ? memoryValue : 0
  }
}

function markNotificationSummaryMissing() {
  notificationSummaryMissingUntilMemory = Date.now() + NOTIFICATION_SUMMARY_MISSING_TTL_MS
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(
      NOTIFICATION_SUMMARY_MISSING_UNTIL_KEY,
      String(notificationSummaryMissingUntilMemory),
    )
    window.localStorage.setItem(
      NOTIFICATION_SUMMARY_MISSING_UNTIL_KEY,
      String(notificationSummaryMissingUntilMemory),
    )
  } catch (_) {}
}

function clearNotificationSummaryMissing() {
  notificationSummaryMissingUntilMemory = 0
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(NOTIFICATION_SUMMARY_MISSING_UNTIL_KEY)
    window.localStorage.removeItem(NOTIFICATION_SUMMARY_MISSING_UNTIL_KEY)
  } catch (_) {}
}

function readStorageNumber(key) {
  const memoryValue = key === DRIVE_SYNC_STATUS_COOLDOWN_KEY
    ? Number(driveSyncStatusCooldownMemory || 0)
    : 0
  if (typeof window === 'undefined') {
    return Number.isFinite(memoryValue) ? memoryValue : 0
  }
  try {
    const sessionValue = Number(window.sessionStorage.getItem(key) || 0)
    const localValue = Number(window.localStorage.getItem(key) || 0)
    return maxStoredNumber([memoryValue, sessionValue, localValue])
  } catch (_) {
    return Number.isFinite(memoryValue) ? memoryValue : 0
  }
}

function writeStorageNumber(key, value) {
  if (key === DRIVE_SYNC_STATUS_COOLDOWN_KEY) {
    driveSyncStatusCooldownMemory = Number(value || 0) || 0
  }
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(key, String(value))
    window.localStorage.setItem(key, String(value))
  } catch (_) {}
}

function clearStorageNumber(key) {
  if (key === DRIVE_SYNC_STATUS_COOLDOWN_KEY) {
    driveSyncStatusCooldownMemory = 0
  }
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(key)
    window.localStorage.removeItem(key)
  } catch (_) {}
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
export async function login({ username, password, organization, sessionDuration, clientTime, deviceTz, deviceName }) {
  return apiFetch('POST', '/api/auth/login', { username, password, organization, sessionDuration, clientTime, deviceTz, deviceName })
}
export async function logout() {
  return apiFetch('POST', '/api/auth/logout', {})
}
export async function resetPasswordWithOtp(payload) {
  return apiFetch('POST', '/api/auth/password-reset/otp', payload || {})
}
export async function requestPasswordResetEmail(payload) {
  return apiFetch('POST', '/api/auth/password-reset/email', payload || {})
}
export async function completePasswordReset(payload) {
  return apiFetch('POST', '/api/auth/password-reset/complete', payload || {})
}
export async function updateSessionDuration(payload) {
  return apiFetch('POST', '/api/auth/session-duration', payload || {})
}
export async function getVerificationCapabilities() {
  return apiFetch('GET', '/api/auth/verification-capabilities')
}
export async function getSystemConfig() {
  return route('system:config', () => apiFetch('GET', '/api/system/config'), () => null)
}
export async function getNotificationSummary() {
  return route('notifications:summary', async () => {
    const missingUntil = readNotificationSummaryMissingUntil()
    if (isCooldownActive(missingUntil)) {
      return getNotificationSummaryFallback({
        unavailable: true,
        cooldownUntil: missingUntil,
      })
    }
    if (notificationSummaryRequestPromise) return await notificationSummaryRequestPromise
    notificationSummaryRequestPromise = (async () => {
      try {
        const result = await apiFetch('GET', '/api/notifications/summary')
        clearNotificationSummaryMissing()
        return result
      } catch (error) {
        if (Number(error?.status) === 404) {
          markNotificationSummaryMissing()
          return getNotificationSummaryFallback({
            unavailable: true,
            cooldownUntil: readNotificationSummaryMissingUntil(),
          })
        }
        throw error
      } finally {
        notificationSummaryRequestPromise = null
      }
    })()
    return await notificationSummaryRequestPromise
  }, () => getNotificationSummaryFallback())
}
export async function getSystemDebugLog() {
  return route('system:debugLog', () => apiFetch('GET', '/api/system/debug/log'), () => ({ entries: [] }))
}
export async function startSupabaseOauth(payload) {
  return apiFetch('POST', '/api/auth/oauth/start', payload || {})
}
export async function completeSupabaseOauth(payload) {
  return apiFetch('POST', '/api/auth/oauth/complete', payload || {})
}
export async function getAppBootstrap() {
  const buildLocalBootstrap = async () => {
    let user = null
    if (typeof window !== 'undefined') {
      try {
        const raw = window.sessionStorage.getItem(STORAGE_KEYS.USER) || window.localStorage.getItem(STORAGE_KEYS.USER)
        user = raw ? JSON.parse(raw) : null
      } catch (_) {
        user = null
      }
    }
    return {
      user,
      settings: await localGetSettings(),
      organizationCreationEnabled: false,
      organization: null,
      group: null,
      storage: null,
      system: null,
    }
  }

  const hasServer = !!getSyncServerUrl()
  const hasSession = !!getAuthSessionToken()

  if (!hasServer) {
    sensitiveMirrorPurgePromise = null
    return buildLocalBootstrap()
  }

  await purgeSensitiveLiveServerMirrors().catch(() => {})

  if (!hasSession) {
    const localBootstrap = await buildLocalBootstrap()
    return {
      ...localBootstrap,
      user: null,
    }
  }

  try {
    return await apiFetch('GET', '/api/auth/bootstrap')
  } catch (error) {
    if (isNetErr(error)) {
      const localBootstrap = await buildLocalBootstrap()
      return {
        ...localBootstrap,
        offline: true,
      }
    }
    throw error
  }
}
export async function getOrganizationBootstrap() {
  return apiFetch('GET', '/api/organizations/bootstrap')
}
export async function searchOrganizations(query) {
  const q = encodeURIComponent(String(query || '').trim())
  return apiFetch('GET', `/api/organizations/search${q ? `?q=${q}` : ''}`)
}
export async function getCurrentOrganization() {
  return apiFetch('GET', '/api/organizations/current')
}

// ─── Settings ─────────────────────────────────────────────────────────────────
export async function getSettings() {
  return routeMirrored('settings:get', async () => {
    const [settings, meta] = await Promise.all([
      apiFetch('GET', '/api/settings'),
      apiFetch('GET', '/api/settings/meta').catch(() => null),
    ])
    if (meta?.updatedAt) {
      await localSaveSettingsMeta(meta.updatedAt).catch(() => {})
    }
    return settings
  }, localGetSettings, async (settings) => {
    await localSaveSettings(settings)
    return settings
  })
}
export async function saveSettings(updates) {
  const payload = await withSettingsExpectedUpdatedAt(updates)
  try {
    const result = await route('settings:save', () => apiFetch('POST', '/api/settings', payload), null, true)
    if (result?.updatedAt) {
      await localSaveSettingsMeta(result.updatedAt).catch(() => {})
    }
    await localSaveSettings(updates).catch(() => {})
    return result
  } catch (error) {
    error.attempted = Object.fromEntries(
      Object.entries(updates || {}).filter(([key]) => !['expectedUpdatedAt', 'expected_updated_at', 'updated_at', 'updatedAt'].includes(key)),
    )
    throw error
  }
}

// ─── Categories ───────────────────────────────────────────────────────────────
export const getCategories  = ()       => routeMirrored('categories:get',    () => apiFetch('GET', '/api/categories'),              () => dexieDb.categories.orderBy('name').toArray(), mirrorTable('categories'))
export const createCategory = d        => route('categories:create', () => apiFetch('POST', '/api/categories', d),           null, true)
export const updateCategory = (id, d)  => route('categories:update', async () => apiFetch('PUT', `/api/categories/${id}`, await withExpectedUpdatedAt('categories', id, d)),      null, true)
export const deleteCategory = (id, payload) => route('categories:delete', async () => apiFetch('DELETE', `/api/categories/${id}`, await withExpectedUpdatedAt('categories', id, payload)),      null, true)

// ─── Units ────────────────────────────────────────────────────────────────────
export const getUnits   = ()  => routeMirrored('units:get',    () => apiFetch('GET', '/api/units'),          () => dexieDb.units.orderBy('name').toArray(), mirrorTable('units'))
export const createUnit = d   => route('units:create', () => apiFetch('POST', '/api/units', d),       null, true)
export const updateUnit = (id, d) => route('units:update', async () => apiFetch('PATCH', `/api/units/${id}`, await withExpectedUpdatedAt('units', id, d)), null, true)
export const deleteUnit = (id, payload)  => route('units:delete', async () => apiFetch('DELETE', `/api/units/${id}`, await withExpectedUpdatedAt('units', id, payload)),  null, true)

// ─── Branches ─────────────────────────────────────────────────────────────────
export const getBranches    = ()       => routeMirrored('branches:get',    () => apiFetch('GET', '/api/branches'),              () => dexieDb.branches.toArray(), mirrorTable('branches'))
export const createBranch   = d        => route('branches:create', () => apiFetch('POST', '/api/branches', { ...getDeviceInfo(), ...d }),           null, true)
export const updateBranch = async (id, d) => {
  const payload = await withExpectedUpdatedAt('branches', id, { ...getDeviceInfo(), ...d })
  return route('branches:update', () => apiFetch('PUT', `/api/branches/${id}`, payload), null, true)
}
export const deleteBranch = async (id, userId, userName) => {
  const payload = await withExpectedUpdatedAt('branches', id, { userId, userName })
  return route('branches:delete', () => apiFetch('DELETE', `/api/branches/${id}`, payload), null, true)
}
export const getBranchStock = id       => route('branches:stock',  () => apiFetch('GET', `/api/branches/${id}/stock`),   () => [])
export const getTransfers   = ()       => route('transfers:get',   () => apiFetch('GET', '/api/transfers'),              () => dexieDb.stock_transfers.orderBy('created_at').reverse().toArray())
export const transferStock  = d        => route('branches:transfer', () => apiFetch('POST', '/api/branches/transfer', d), null, true)

// ─── Products ─────────────────────────────────────────────────────────────────
export const getProducts        = ()       => routeMirrored('products:get',        () => apiFetch('GET', '/api/products'),                    () => dexieDb.products.orderBy('name').toArray(), mirrorTable('products'))
export async function getCatalogMeta() {
  const base = getPortalBaseUrl()
  const res = await fetchJsonWithTimeout(`${base}/api/catalog/meta`, {
    headers: { 'bypass-tunnel-reminder': 'true' },
  })
  if (!res.ok) throw new Error(`Catalog meta failed: ${res.status}`)
  return res.json()
}
export async function getCatalogProducts() {
  const base = getPortalBaseUrl()
  const res = await fetchJsonWithTimeout(`${base}/api/catalog/products`, {
    headers: { 'bypass-tunnel-reminder': 'true' },
  })
  if (!res.ok) throw new Error(`Catalog products failed: ${res.status}`)
  return res.json()
}
export async function getPortalConfig() {
  const base = getPortalBaseUrl()
  const res = await fetchJsonWithTimeout(`${base}/api/portal/config`, {
    headers: { 'bypass-tunnel-reminder': 'true' },
  })
  if (!res.ok) throw new Error(`Portal config failed: ${res.status}`)
  return res.json()
}
export async function getPortalBootstrap() {
  const base = getPortalBaseUrl()
  const res = await fetchJsonWithTimeout(`${base}/api/portal/bootstrap`, {
    headers: { 'bypass-tunnel-reminder': 'true' },
  })
  if (!res.ok) throw new Error(`Portal bootstrap failed: ${res.status}`)
  return res.json()
}
export async function getPortalCatalogMeta() {
  const base = getPortalBaseUrl()
  const res = await fetchJsonWithTimeout(`${base}/api/portal/catalog/meta`, {
    headers: { 'bypass-tunnel-reminder': 'true' },
  })
  if (!res.ok) throw new Error(`Portal catalog meta failed: ${res.status}`)
  return res.json()
}
export async function getPortalCatalogProducts() {
  const base = getPortalBaseUrl()
  const res = await fetchJsonWithTimeout(`${base}/api/portal/catalog/products`, {
    headers: { 'bypass-tunnel-reminder': 'true' },
  })
  if (!res.ok) throw new Error(`Portal catalog products failed: ${res.status}`)
  return res.json()
}
export async function lookupPortalMembership(membershipNumber) {
  const base = getPortalBaseUrl()
  const value = encodeURIComponent(String(membershipNumber || '').trim())
  const res = await fetchJsonWithTimeout(`${base}/api/portal/membership/${value}`, {
    headers: { 'bypass-tunnel-reminder': 'true' },
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Membership lookup failed: ${res.status}`)
  return res.json()
}
export async function createPortalSubmission(payload) {
  const base = getPortalBaseUrl()
  const res = await fetchJsonWithTimeout(`${base}/api/portal/submissions`, {
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
  const res = await fetchJsonWithTimeout(`${base}/api/portal/ai/status`, {
    headers: { 'bypass-tunnel-reminder': 'true' },
  })
  if (!res.ok) throw new Error(`Portal AI status failed: ${res.status}`)
  return res.json()
}
export async function askPortalAi(payload) {
  const base = getPortalBaseUrl()
  const res = await fetchJsonWithTimeout(`${base}/api/portal/ai/chat`, {
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
  const payload = ensureClientRequestId({ ...getDeviceInfo(), ...d }, 'product')
  // Auto-create supplier if new
  if (payload.supplier?.trim()) {
    try {
      const existing = await dexieDb.suppliers.where('name').equalsIgnoreCase(payload.supplier.trim()).first()
      if (!existing) {
        await apiFetch('POST', '/api/suppliers', { name: payload.supplier.trim(), ...getDeviceInfo() })
        cacheInvalidate('suppliers')
      }
    } catch (_) {}
  }
  return route('products:create', () => apiFetch('POST', '/api/products', payload), null, true)
}
export async function updateProduct(id, d) {
  if (d.supplier?.trim()) {
    try {
      const existing = await dexieDb.suppliers.where('name').equalsIgnoreCase(d.supplier.trim()).first()
      if (!existing) {
        await apiFetch('POST', '/api/suppliers', { name: d.supplier.trim(), ...getDeviceInfo() })
        cacheInvalidate('suppliers')
      }
    } catch (_) {}
  }
  const payload = await withExpectedUpdatedAt('products', id, { ...getDeviceInfo(), ...d })
  return route('products:update', () => apiFetch('PUT', `/api/products/${id}`, payload), null, true)
}
export const deleteProduct = async (id) => {
  const payload = await withExpectedUpdatedAt('products', id, {})
  return route('products:delete', () => apiFetch('DELETE', `/api/products/${id}`, payload), null, true)
}

// ─── OTP / 2FA ────────────────────────────────────────────────────────────────
export const otpSetup   = d  => apiFetch('POST', '/api/auth/otp/setup', d)
export const otpConfirm = d  => apiFetch('POST', '/api/auth/otp/confirm', d)
export const otpDisable = d  => apiFetch('POST', '/api/auth/otp/disable', d)
export const otpVerify  = d  => apiFetch('POST', '/api/auth/otp/verify', d)
export const otpStatus  = id => apiFetch('GET', `/api/auth/otp/status/${id}`)

// ─── Product Variants ─────────────────────────────────────────────────────────
export const createProductVariant = d => route('products:create', () => apiFetch('POST', '/api/products/variant', d), null, true)

export const bulkImportProducts = d        => route('products:bulkImport', () => apiFetch('POST', '/api/products/bulk-import', d),     null, true)

function buildMultipartHeaders() {
  const device = getDeviceInfo()
  const headers = {
    'bypass-tunnel-reminder': 'true',
    'x-client-time': device.clientTime || '',
    'x-device-tz': device.deviceTz || '',
    'x-device-name': device.deviceName || '',
  }
  const authToken = getAuthSessionToken()
  if (authToken) headers['x-auth-session'] = authToken
  return headers
}

async function apiFormPost(path, form, channel = 'importJobs:upload') {
  requireLiveServerWrite(channel, {
    offlineMessage: 'Server is offline. Imports need the live server so large files can be processed safely.',
    notConfiguredMessage: 'Server is not connected. Imports need a live server.',
  })
  const base = getSyncServerUrl().replace(/\/$/, '')
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: buildMultipartHeaders(),
    body: form,
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch (_) {}
  if (!res.ok) throw new Error(json?.error || text || `HTTP ${res.status}`)
  return json?.data || json
}

export const createImportJob = d => route('importJobs:create', () => apiFetch('POST', '/api/import-jobs', d), null, true)
export const listImportJobs = (params = {}) => {
  const q = new URLSearchParams(Object.entries(params || {}).filter(([, value]) => value != null && value !== '')).toString()
  return route(`importJobs:list:${q}`, () => apiFetch('GET', `/api/import-jobs${q ? `?${q}` : ''}`), null)
}
export const getImportJob = id => route(`importJobs:get:${id}`, () => apiFetch('GET', `/api/import-jobs/${id}`), null)
export const startImportJob = id => route(`importJobs:start:${id}`, () => apiFetch('POST', `/api/import-jobs/${id}/start`, {}), null, true)
export const approveImportJob = id => route(`importJobs:approve:${id}`, () => apiFetch('POST', `/api/import-jobs/${id}/approve`, {}), null, true)
export const cancelImportJob = id => route(`importJobs:cancel:${id}`, () => apiFetch('POST', `/api/import-jobs/${id}/cancel`, {}), null, true)
export const retryImportJob = id => route(`importJobs:retry:${id}`, () => apiFetch('POST', `/api/import-jobs/${id}/retry`, {}), null, true)
export const deleteImportJob = (id, options = {}) => route(`importJobs:delete:${id}`, async () => {
  const encodedId = encodeURIComponent(id)
  const force = options.force ? '?force=1' : ''
  try {
    return await apiFetch('DELETE', `/api/import-jobs/${encodedId}${force}`, {})
  } catch (error) {
    const message = String(error?.message || '')
    if (Number(error?.status) === 404 && /Cannot DELETE|Cannot POST|<!DOCTYPE html/i.test(message)) {
      return apiFetch('POST', `/api/import-jobs/${encodedId}/delete`, { force: !!options.force })
    }
    throw error
  }
}, null, true)
export const getImportQueueStatus = () => route('importJobs:queueStatus', () => apiFetch('GET', '/api/import-jobs/queue/status'), null)

export async function downloadImportJobErrors(jobId) {
  const base = getSyncServerUrl().replace(/\/$/, '')
  const res = await fetch(`${base}/api/import-jobs/${encodeURIComponent(jobId)}/errors.csv`, {
    method: 'GET',
    headers: buildMultipartHeaders(),
  })
  if (!res.ok) throw new Error(await res.text().catch(() => 'Failed to download import errors'))
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${jobId}-errors.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return { success: true }
}

export async function uploadImportJobCsv({ jobId, text, fileName = 'products.csv' }) {
  const form = new FormData()
  const source = String(text || '')
  form.append('file', new Blob([source.startsWith('\uFEFF') ? '' : '\uFEFF', source], { type: 'text/csv;charset=utf-8' }), fileName)
  return apiFormPost(`/api/import-jobs/${jobId}/csv`, form, 'importJobs:csv')
}

export async function uploadImportJobZip({ jobId, file }) {
  if (!(file instanceof File)) throw new Error('Choose a ZIP file first')
  const form = new FormData()
  form.append('file', file, file.name || 'images.zip')
  return apiFormPost(`/api/import-jobs/${jobId}/zip`, form, 'importJobs:zip')
}

export async function uploadImportJobImages({ jobId, files = [], onProgress, batchSize = 100 }) {
  const browserFiles = (Array.isArray(files) ? files : [])
    .filter((entry) => entry?.file instanceof File)
  const uploaded = []
  for (let offset = 0; offset < browserFiles.length; offset += batchSize) {
    const batch = browserFiles.slice(offset, offset + batchSize)
    const form = new FormData()
    const relativePaths = []
    batch.forEach((entry) => {
      form.append('files', entry.file, entry.file.name)
      relativePaths.push(entry.relativePath || entry.file.webkitRelativePath || entry.file.name)
    })
    form.append('relative_paths', JSON.stringify(relativePaths))
    const result = await apiFormPost(`/api/import-jobs/${jobId}/images`, form, 'importJobs:images')
    uploaded.push(...(result?.files || []))
    onProgress?.({
      progress: browserFiles.length ? Math.round(((offset + batch.length) / browserFiles.length) * 100) : 100,
      label: `Uploading images ${Math.min(offset + batch.length, browserFiles.length)} / ${browserFiles.length}`,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return uploaded
}

export async function getFiles(params = {}) {
  const q = new URLSearchParams(Object.entries(params || {}).filter(([, value]) => value != null && value !== '')).toString()
  const result = await route(`files:get:${q}`, () => apiFetch('GET', `/api/files${q ? `?${q}` : ''}`), () => [])
  return Array.isArray(result?.items) ? result.items : (Array.isArray(result) ? result : [])
}

export async function uploadFileAsset({ file, userId, userName }) {
  if (!(file instanceof File)) throw new Error('Choose a file first')
  requireLiveServerWrite('files:upload', {
    offlineMessage: 'Server is offline. File uploads are invalid until the server reconnects.',
    notConfiguredMessage: 'Server is not connected. File uploads are invalid until a live server is configured.',
  })
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

export async function deleteFileAsset(id, payload = {}) {
  return route('files:delete', () => apiFetch('DELETE', `/api/files/${id}`, {
    ...getCurrentUserContext(),
    ...(payload || {}),
  }), null, true)
}

/**
 * uploadProductImage — accepts { productId, filePath, fileName } where filePath
 * is a base64 data-URL (set by Products.jsx browser file-picker), OR a native
 * file system path (Electron). Converts to FormData and POSTs as multipart.
 */
export async function uploadProductImage({ productId, file, filePath, fileName }) {
  void productId
  requireLiveServerWrite('products:uploadImage', {
    offlineMessage: 'Server is offline. Product image uploads are invalid until the server reconnects.',
    notConfiguredMessage: 'Server is not connected. Product image uploads are invalid until a live server is configured.',
  })
  const base    = getSyncServerUrl().replace(/\/$/, '')
  const headers = { 'bypass-tunnel-reminder': 'true' }
  const authToken   = getAuthSessionToken()
  if (authToken) headers['x-auth-session'] = authToken

  const fd = new FormData()

  if (file instanceof File) {
    fd.append('image', file, file.name || fileName || 'product.jpg')
  } else if (filePath && filePath.startsWith('data:')) {
    // Browser: convert base64 data-URL → Blob
    const [meta, b64] = filePath.split(',')
    const mime        = meta.match(/:(.*?);/)?.[1] || 'image/jpeg'
    const bytes       = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    fd.append('image', new Blob([bytes], { type: mime }), fileName || 'product.jpg')
  } else if (filePath) {
    // Electron path — should never reach browser, but handle gracefully
    throw new Error('Native file path upload not supported in browser mode')
  } else {
    throw new Error('No image file provided')
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
  requireLiveServerWrite('users:uploadAvatar', {
    offlineMessage: 'Server is offline. Avatar uploads are invalid until the server reconnects.',
    notConfiguredMessage: 'Server is not connected. Avatar uploads are invalid until a live server is configured.',
  })
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
    input.accept = '.csv,.tsv,text/csv,text/tab-separated-values'
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
export const moveStockRow          = d         => route('inventory:moveRow', () => apiFetch('POST', '/api/inventory/move-row', { ...getDeviceInfo(), ...d }), null, true)

export const getActionHistory = (scope = 'global', limit = 3) =>
  route(`actionHistory:get:${scope}:${limit}`, () => apiFetch('GET', `/api/action-history?scope=${encodeURIComponent(scope)}&limit=${encodeURIComponent(limit)}`), () => ({ items: [] }))
export const createActionHistory = payload =>
  route('actionHistory:create', () => apiFetch('POST', '/api/action-history', { ...getDeviceInfo(), ...(payload || {}) }), null, true)
export const updateActionHistory = (id, payload) =>
  route('actionHistory:update', () => apiFetch('PATCH', `/api/action-history/${id}`, { ...getDeviceInfo(), ...(payload || {}) }), null, true)
export const getInventorySummary   = ({ branchId } = {}) => route(branchId ? `inventory:summary:${branchId}` : 'inventory:summary', () => apiFetch('GET', `/api/inventory/summary${branchId ? `?branchId=${branchId}` : ''}`), () => [])
export const getInventoryMovements = ({ branchId } = {}, limit) => route(branchId ? `inventory:movements:${branchId}` : 'inventory:movements', () => apiFetch('GET', `/api/inventory/movements?limit=${limit || 500}${branchId ? `&branchId=${branchId}` : ''}`), () => dexieDb.inventory_movements.orderBy('created_at').reverse().limit(limit || 500).toArray())

// ─── Sales ────────────────────────────────────────────────────────────────────
export async function createSale(d) {
  const payload = ensureClientRequestId({ ...getDeviceInfo(), ...d }, 'sale')
  return route('sales:create', () => apiFetch('POST', '/api/sales', payload), null, true)
}

export const getSales   = (params) => {
  const q = new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v != null)).toString()
  const mirror = q ? null : mirrorTable('sales')
  return routeMirrored(`sales:get:${q}`, () => apiFetch('GET', `/api/sales${q ? '?' + q : ''}`), () => dexieDb.sales.orderBy('created_at').reverse().limit(1000).toArray(), mirror)
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
export const getCustomers        = ()       => routeMirrored('customers:get',        () => apiFetch('GET', '/api/customers'),                     () => dexieDb.customers.orderBy('name').toArray(), mirrorTable('customers'))
export async function createCustomer(d) {
  const payload = ensureClientRequestId({ ...getDeviceInfo(), ...d }, 'customer')
  return route('customers:create', () => apiFetch('POST', '/api/customers', payload), null, true)
}
export const updateCustomer = async (id, d) => {
  const payload = await withExpectedUpdatedAt('customers', id, d)
  return route('customers:update', () => apiFetch('PUT', `/api/customers/${id}`, payload), null, true)
}
export const deleteCustomer = async (id) => {
  const payload = await withExpectedUpdatedAt('customers', id, {})
  return route('customers:delete', () => apiFetch('DELETE', `/api/customers/${id}`, payload), null, true)
}
export const bulkImportCustomers = d        => route('customers:bulkImport', () => apiFetch('POST', '/api/customers/bulk-import', d),      null, true)
export const downloadCustomerTemplate = ()  => buildCSVTemplate([
  '_conflict_mode','_field_rules',
  'name','membership_number','phone','email','address','company','notes',
  'contact_label_1','contact_name_1','contact_phone_1','contact_email_1','contact_address_1',
  'contact_label_2','contact_name_2','contact_phone_2','contact_email_2','contact_address_2',
  'contact_label_3','contact_name_3','contact_phone_3','contact_email_3','contact_address_3',
], 'customers-template.csv')

// ─── Suppliers ────────────────────────────────────────────────────────────────
export const getSuppliers        = ()       => routeMirrored('suppliers:get',        () => apiFetch('GET', '/api/suppliers'),                      () => dexieDb.suppliers.orderBy('name').toArray(), mirrorTable('suppliers'))
export async function createSupplier(d) {
  const payload = ensureClientRequestId({ ...getDeviceInfo(), ...d }, 'supplier')
  return route('suppliers:create', () => apiFetch('POST', '/api/suppliers', payload), null, true)
}
export const updateSupplier = async (id, d) => {
  const payload = await withExpectedUpdatedAt('suppliers', id, d)
  return route('suppliers:update', () => apiFetch('PUT', `/api/suppliers/${id}`, payload), null, true)
}
export const deleteSupplier = async (id) => {
  const payload = await withExpectedUpdatedAt('suppliers', id, {})
  return route('suppliers:delete', () => apiFetch('DELETE', `/api/suppliers/${id}`, payload), null, true)
}
export const bulkImportSuppliers = d        => route('suppliers:bulkImport', () => apiFetch('POST', '/api/suppliers/bulk-import', d),      null, true)
export const downloadSupplierTemplate = ()  => buildCSVTemplate([
  '_conflict_mode','_field_rules',
  'name','phone','email','address','company','contact_person','notes',
  'contact_label_1','contact_name_1','contact_phone_1','contact_email_1','contact_address_1',
  'contact_label_2','contact_name_2','contact_phone_2','contact_email_2','contact_address_2',
  'contact_label_3','contact_name_3','contact_phone_3','contact_email_3','contact_address_3',
], 'suppliers-template.csv')

// ─── Delivery contacts ────────────────────────────────────────────────────────
export const getDeliveryContacts   = ()       => routeMirrored('deliveryContacts:get',    () => apiFetch('GET', '/api/delivery-contacts'),               () => dexieDb.delivery_contacts.orderBy('name').toArray(), mirrorTable('delivery_contacts'))
export async function createDeliveryContact(d) {
  const payload = ensureClientRequestId({ ...getDeviceInfo(), ...d }, 'delivery_contact')
  return route('deliveryContacts:create', () => apiFetch('POST', '/api/delivery-contacts', payload), null, true)
}
export const updateDeliveryContact = async (id, d) => {
  const payload = await withExpectedUpdatedAt('delivery_contacts', id, d)
  return route('deliveryContacts:update', () => apiFetch('PUT', `/api/delivery-contacts/${id}`, payload), null, true)
}
export const deleteDeliveryContact = async (id) => {
  const payload = await withExpectedUpdatedAt('delivery_contacts', id, {})
  return route('deliveryContacts:delete', () => apiFetch('DELETE', `/api/delivery-contacts/${id}`, payload), null, true)
}
export const bulkImportDeliveryContacts = d   => route('deliveryContacts:bulkImport', () => apiFetch('POST', '/api/delivery-contacts/bulk-import', d), null, true)

// ─── Users ────────────────────────────────────────────────────────────────────
export const getUsers      = ()       => routeMirrored('users:get',           () => apiFetch('GET', appendActorQuery('/api/users')),        () => dexieDb.users.toArray(), mirrorTable('users'))
export const createUser    = d        => route('users:create',        () => apiFetch('POST', '/api/users', d),                      null, true)
export const updateUser    = (id, d)  => route('users:update',        async () => apiFetch('PUT', `/api/users/${id}`, await withExpectedUpdatedAt('users', id, d)), null, true)
export const getUserProfile = (id)    => route(`users:profile:${id}`, () => apiFetch('GET', appendActorQuery(`/api/users/${id}/profile`)), () => null)
export const getUserAuthMethods = (id) =>
  route(`users:authMethods:${id}`, () => apiFetch('GET', appendActorQuery(`/api/users/${id}/auth-methods`)), () => null)
export const updateUserProfile = (id, d) =>
  route('users:updateProfile', async () => apiFetch('PUT', `/api/users/${id}/profile`, await withExpectedUpdatedAt('users', id, d)), null, true)
export const disconnectUserAuthProvider = (id, d) =>
  route('users:disconnectProvider', () => apiFetch('POST', `/api/users/${id}/provider-disconnect`, d), null, true)
export const changeUserPassword = (id, d) =>
  route('users:changePassword', () => apiFetch('POST', `/api/users/${id}/change-password`, d), null, true)
export const resetPassword = (id, d)  => route('users:resetPassword', () => apiFetch('POST', `/api/users/${id}/reset-password`, d), null, true)

// ─── Roles ────────────────────────────────────────────────────────────────────
export const getRoles   = ()       => routeMirrored('roles:get',    () => apiFetch('GET', appendActorQuery('/api/roles')), () => dexieDb.roles.toArray(), mirrorTable('roles'))
export const createRole = d        => route('roles:create', () => apiFetch('POST', '/api/roles', d),           null, true)
export const updateRole = (id, d)  => route('roles:update', async () => apiFetch('PUT', `/api/roles/${id}`, await withExpectedUpdatedAt('roles', id, d)), null, true)
export const deleteRole = (id, payload) => route('roles:delete', async () => apiFetch('DELETE', `/api/roles/${id}`, await withExpectedUpdatedAt('roles', id, payload)), null, true)

// ─── Custom tables ────────────────────────────────────────────────────────────
export const getCustomTables    = ()                      => route('customTables:get',       () => apiFetch('GET', '/api/custom-tables'),                                             () => dexieDb.custom_tables.toArray())
export const createCustomTable  = d                       => route('customTables:create',    () => apiFetch('POST', '/api/custom-tables', d),                                         null, true)
export const getCustomTableData = ({ tableName })         => route('customTables:data',      () => apiFetch('GET', `/api/custom-tables/${tableName}/data`),                           () => [])
export const insertCustomRow    = ({ tableName, data })   => route('customTables:insertRow', () => apiFetch('POST', `/api/custom-tables/${tableName}/rows`, { data }),                null, true)
export const updateCustomRow    = ({ tableName, id, data, expectedUpdatedAt }) => route('customTables:updateRow', () => apiFetch('PUT', `/api/custom-tables/${tableName}/rows/${id}`, { data, expectedUpdatedAt }),         null, true)
export const deleteCustomRow    = ({ tableName, id, payload })     => route('customTables:deleteRow', () => apiFetch('DELETE', `/api/custom-tables/${tableName}/rows/${id}`, payload),                  null, true)

// ─── Audit log ────────────────────────────────────────────────────────────────
export const getAuditLogs = () => routeMirrored('audit_log:get', () => apiFetch('GET', '/api/system/audit-logs'), () => dexieDb.audit_logs.orderBy('created_at').reverse().limit(200).toArray(), mirrorTable('audit_logs'))

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
  await invalidateClientRuntimeState('backup-import')
  cacheClearAll()
  return result
}

export async function importBackupFolder(sourceDir) {
  const result = await apiFetch('POST', '/api/system/backup/import-folder', { sourceDir }, LONG_SYSTEM_ACTION_TIMEOUT_MS)
  await invalidateClientRuntimeState('backup-import-folder')
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
export const getGoogleDriveSyncStatus = () =>
  route('system:driveSyncStatus', async () => {
    const cooldownUntil = readStorageNumber(DRIVE_SYNC_STATUS_COOLDOWN_KEY)
    if (isCooldownActive(cooldownUntil)) {
      return getDriveSyncStatusFallback({ cooldownUntil })
    }
    if (driveSyncStatusRequestPromise) return await driveSyncStatusRequestPromise
    driveSyncStatusRequestPromise = (async () => {
      try {
        const result = await apiFetch('GET', '/api/system/drive-sync/status')
        clearStorageNumber(DRIVE_SYNC_STATUS_COOLDOWN_KEY)
        return result
      } catch (error) {
        const status = Number(error?.status || 0)
        const message = String(error?.message || '').toLowerCase()
        const retryable = isNetErr(error)
          || message.includes('insufficient_resources')
          || [404, 429, 500, 502, 503, 504].includes(status)
        if (retryable) {
          const nextUntil = Date.now() + DRIVE_SYNC_STATUS_COOLDOWN_MS
          writeStorageNumber(DRIVE_SYNC_STATUS_COOLDOWN_KEY, nextUntil)
          return getDriveSyncStatusFallback({
            cooldownUntil: nextUntil,
            lastError: error?.message || 'Drive sync status temporarily unavailable',
          })
        }
        throw error
      } finally {
        driveSyncStatusRequestPromise = null
      }
    })()
    return await driveSyncStatusRequestPromise
  }, () => getDriveSyncStatusFallback())

export const saveGoogleDriveSyncPreferences = (payload) =>
  route('system:driveSyncPreferences', () => apiFetch('POST', '/api/system/drive-sync/preferences', payload), null, true)

export const startGoogleDriveSyncOauth = (payload) =>
  route('system:driveSyncOauthStart', () => apiFetch('POST', '/api/system/drive-sync/oauth/start', payload), null, true)

export const disconnectGoogleDriveSync = () =>
  route('system:driveSyncDisconnect', () => apiFetch('POST', '/api/system/drive-sync/disconnect', {}), null, true)

export const forgetGoogleDriveSyncCredentials = (payload = {}) =>
  route('system:driveSyncForgetCredentials', () => apiFetch('POST', '/api/system/drive-sync/forget-credentials', payload), null, true)

export const syncGoogleDriveNow = () =>
  route('system:driveSyncNow', () => apiFetch('POST', '/api/system/drive-sync/sync-now', {}), null, true)

export async function resetData(mode = 'sales') {
  const result = await route('data:reset', () => apiFetch('POST', '/api/system/reset-data', { mode }), null, true)
  await invalidateClientRuntimeState(mode === 'all' ? 'reset-data-all' : 'reset-data-sales')
  cacheClearAll()
  return result
}

export async function factoryReset() {
  const result = await route('data:factoryReset', () => apiFetch('POST', '/api/system/factory-reset'), null, true)
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
    'stock_quantity','low_stock_threshold',
    'branch','supplier',
    'parent_id','is_group',
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
  const mirror = q ? null : mirrorTable('returns')
  return routeMirrored(cacheKey, () => apiFetch('GET', `/api/returns${q ? '?' + q : ''}`), () => dexieDb.returns.orderBy('created_at').reverse().toArray(), mirror)
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
  const payload = await withExpectedUpdatedAt('sales', id, { sale_status, notes })
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
  const body = await withExpectedUpdatedAt('sales', id, payload)
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
  const q = new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v != null)).toString()
  return route('sales:export', () => apiFetch('GET', `/api/sales/export${q ? '?' + q : ''}`), () => ({}))
}
export const updateReturn = async (id, d) => {
  const payload = await withExpectedUpdatedAt('returns', id, d)
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
      items: Array.isArray(d?.items)
        ? d.items.map((item) => ({
            product_name: item?.product_name || '',
            quantity: item?.quantity || 0,
            return_to_stock: item?.return_to_stock !== false,
          }))
        : [],
    }
    throw error
  }
}

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
export const getScaleMigrationStatus = () => route('system:scaleMigrationStatus', () => apiFetch('GET', '/api/system/scale-migration/status'), () => ({ item: null }))
export const prepareScaleMigration = () => route('system:scaleMigrationPrepare', () => apiFetch('POST', '/api/system/scale-migration/prepare', {}, LONG_SYSTEM_ACTION_TIMEOUT_MS), null, true)
export const runScaleMigration = (payload = {}) => route('system:scaleMigrationRun', () => apiFetch('POST', '/api/system/scale-migration/run', payload, LONG_SYSTEM_ACTION_TIMEOUT_MS), null, true)
export async function setDataPath(dir) {
  const result = await route('system:setDataPath', () => apiFetch('POST', '/api/system/data-path', { dataDir: dir }, LONG_SYSTEM_ACTION_TIMEOUT_MS), null, true)
  await invalidateClientRuntimeState('data-path-update')
  return result
}
export async function resetDataPath() {
  const result = await route('system:resetDataPath', () => apiFetch('DELETE', '/api/system/data-path', undefined, LONG_SYSTEM_ACTION_TIMEOUT_MS), null, true)
  await invalidateClientRuntimeState('data-path-reset')
  return result
}
export const browseDir     = (dir) => route('system:browseDir',  () => apiFetch('POST',   '/api/system/browse-dir', { dir }), () => ({ dirs: [] }))
