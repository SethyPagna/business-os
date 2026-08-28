import { apiFetch, cacheInvalidate, getSyncServerUrl, isServerOnline } from './http.ts'
import { getLocalDb } from './lazyLocalDb.ts'
import { localSaveSettings, localSaveSettingsMeta } from './localDb.ts'
import { hasStoredUserSession } from './syncRuntime.ts'
import { getCategories, getUnits } from './lookupTransport.ts'
import { getBranches } from './branchTransport.ts'
import { getProducts } from './productReadTransport.ts'
import { getCustomers, getDeliveryContacts, getSuppliers } from './contactsTransport.ts'
import { getSales } from './salesTransport.ts'
import { getInventoryMovements } from './inventoryTransport.ts'

type SnapshotOptions = { force?: boolean }
type SnapshotResults = {
  refreshed: string[]
  failed: Array<{ label: string; error: string }>
}
type SnapshotMeta = SnapshotResults & {
  success: number
  failedCount: number
}

const OFFLINE_DEVICE_SNAPSHOT_META_KEY = 'offline_device_snapshot_meta'
const OFFLINE_DEVICE_SNAPSHOT_MIN_INTERVAL_MS = 5 * 60_000
let offlineDeviceSnapshotPromise: Promise<unknown> | null = null

function canRefreshOfflineDeviceSnapshot(options: SnapshotOptions = {}): boolean {
  if (!getSyncServerUrl() || !hasStoredUserSession()) return false
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  if (!options.force && !isServerOnline()) return false
  return true
}

async function readOfflineDeviceSnapshotMeta(): Promise<string> {
  try {
    const db = await getLocalDb()
    return String((await db.settings.get(OFFLINE_DEVICE_SNAPSHOT_META_KEY))?.value || '')
  } catch (_) {
    return ''
  }
}

async function writeOfflineDeviceSnapshotMeta(meta: SnapshotMeta): Promise<string> {
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

async function getSettingsSnapshot(): Promise<unknown> {
  cacheInvalidate('settings')
  const settingsResponse = await apiFetch('GET', '/api/settings')
  const { updatedAt: inlineUpdatedAt, ...settings } = (settingsResponse || {}) as Record<string, unknown>
  if (inlineUpdatedAt) await localSaveSettingsMeta(inlineUpdatedAt).catch(() => {})
  await localSaveSettings(settings).catch(() => {})
  return settings
}

function getReturnsSnapshot(): Promise<unknown> {
  return apiFetch('GET', '/api/returns')
}

async function runOfflineSnapshotStep(label: string, fn: () => Promise<unknown>, results: SnapshotResults): Promise<void> {
  try {
    await fn()
    results.refreshed.push(label)
  } catch (error) {
    results.failed.push({
      label,
      error: error instanceof Error ? error.message : String(error || 'Failed'),
    })
  }
}

export async function refreshOfflineDeviceSnapshot(options: SnapshotOptions = {}): Promise<unknown> {
  if (!canRefreshOfflineDeviceSnapshot(options)) {
    return { skipped: true, reason: 'server_or_device_offline' }
  }
  if (offlineDeviceSnapshotPromise) return offlineDeviceSnapshotPromise

  offlineDeviceSnapshotPromise = (async () => {
    const previousMetaRaw = await readOfflineDeviceSnapshotMeta()
    const previousMeta = (() => {
      try { return JSON.parse(previousMetaRaw || '{}') as { refreshedAt?: string } } catch (_) { return {} }
    })()
    const previousMs = previousMeta?.refreshedAt ? Date.parse(previousMeta.refreshedAt) : 0
    if (!options.force && previousMs && Date.now() - previousMs < OFFLINE_DEVICE_SNAPSHOT_MIN_INTERVAL_MS) {
      return {
        skipped: true,
        reason: 'recently_refreshed',
        refreshedAt: previousMeta.refreshedAt,
      }
    }

    const results: SnapshotResults = { refreshed: [], failed: [] }
    await runOfflineSnapshotStep('settings', () => getSettingsSnapshot(), results)
    await runOfflineSnapshotStep('categories', () => getCategories(), results)
    await runOfflineSnapshotStep('units', () => getUnits(), results)
    await runOfflineSnapshotStep('branches', () => getBranches(), results)
    await runOfflineSnapshotStep('products', () => getProducts(), results)
    await runOfflineSnapshotStep('customers', () => getCustomers(), results)
    // Full list for roles that can see the suppliers section; without the
    // contacts_suppliers grant that call 403s, and the name-only list --
    // enough for the pickers that work offline -- is snapshotted instead.
    await runOfflineSnapshotStep('suppliers', () => getSuppliers().catch(() => getSuppliers({ fields: 'names' })), results)
    await runOfflineSnapshotStep('delivery_contacts', () => getDeliveryContacts(), results)
    await runOfflineSnapshotStep('sales', () => getSales({}), results)
    await runOfflineSnapshotStep('returns', () => getReturnsSnapshot(), results)
    await runOfflineSnapshotStep('inventory_movements', () => getInventoryMovements({ pageSize: 5000 }), results)

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
