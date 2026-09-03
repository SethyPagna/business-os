import { apiFetch, cacheInvalidate, getSyncServerUrl, isServerOnline } from './http.ts'
import { getLocalDb } from './lazyLocalDb.ts'
import { localSaveSettings, localSaveSettingsMeta } from './localDb.ts'
import { hasStoredUserSession } from './syncRuntime.ts'
import { getCategories, getUnits } from './lookupTransport.ts'
import { getBranches } from './branchTransport.ts'
import { getProducts } from './productReadTransport.ts'
import { getDeliveryContacts, getSuppliers } from './contactsTransport.ts'
import { shouldPersistLocalMirror } from '../platform/storage/storagePolicy.ts'
import { getSales } from './salesTransport.ts'
import { getInventoryMovements } from './inventoryTransport.ts'

type SnapshotOptions = { force?: boolean }
type SnapshotResults = {
  refreshed: string[]
  // Steps that were deliberately left alone because the local copy is
  // still good -- distinct from `refreshed` (work done) and from `failed`
  // (work attempted and lost), so the meta never claims a table was
  // re-read when it wasn't.
  skippedSteps: string[]
  failed: Array<{ label: string; error: string }>
}
type SnapshotMeta = SnapshotResults & {
  success: number
  failedCount: number
}

const OFFLINE_DEVICE_SNAPSHOT_META_KEY = 'offline_device_snapshot_meta'
const OFFLINE_DEVICE_SNAPSHOT_MIN_INTERVAL_MS = 5 * 60_000

// The customers step is not like the others. Its source read USED to be
// the unpaged GET /api/customers -- the single most expensive request in
// the system: every column of every customer row plus a per-row loyalty
// aggregation (routes/contacts.ts's withPoints), measured at ~2.4 MB and
// ~4 s against a 5,000-row table, and effectively uncacheable during
// business hours because that list's cache version includes 'sales', so
// every till transaction turns it over. It is now the bounded
// `fields=picker` shape: picker columns only, no aggregation, at most
// OFFLINE_CUSTOMER_MIRROR_LIMIT rows, most recently active first.
//
// It also runs only when the copy would actually be KEPT. On a live
// server the customers table is a sensitive mirror
// (platform/storage/storagePolicy.ts) and mirrorTable() clears it instead
// of writing it -- so before this guard the device downloaded the whole
// table on every snapshot purely to throw it away. A read whose result
// is discarded is not made at all.
//
// Snapshot refreshes are NOT rare: the maintenance loop runs every five
// minutes and, on top of that, a forced refresh fires on every reconnect,
// tab focus after a background, and pageshow -- and `force` skips the
// five-minute floor. On the Branches and Products pages (which never
// touch customer data at all) that is the only reason an unfiltered
// /api/customers is ever requested, and several of them landing at once
// is what stalled production.
//
// The mirror exists purely as an OFFLINE fallback: every online read goes
// to the server, so the only question this cadence answers is "how stale
// may the offline copy be if the network drops right now". Hours, not
// minutes -- so the customers mirror gets its own long interval instead
// of riding the five-minute loop. A missing or empty mirror still
// refreshes immediately, whatever the timestamp says.
const OFFLINE_CUSTOMER_MIRROR_META_KEY = 'offline_customer_mirror_meta'
const OFFLINE_CUSTOMER_MIRROR_MIN_INTERVAL_MS = 6 * 60 * 60_000
// Row ceiling for the offline copy (the server clamps at its own maximum,
// see routes/contacts.ts's CONTACT_PICKER_MAX_LIMIT). Sized to hold every
// customer who has bought recently; a table larger than this keeps its
// most recently active rows and the mirror meta records `truncated`.
const OFFLINE_CUSTOMER_MIRROR_LIMIT = 2000
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

// True when this device already holds a customers mirror that is recent
// enough to serve an offline read. Fails "not fresh" on any doubt: a
// missing timestamp, an unparsable one, or a timestamp with no rows behind
// it all mean refresh, so the offline copy can never be silently absent.
async function isCustomerMirrorFresh(): Promise<boolean> {
  try {
    const db = await getLocalDb()
    const raw = String((await db.settings.get(OFFLINE_CUSTOMER_MIRROR_META_KEY))?.value || '')
    if (!raw) return false
    const refreshedAt = Date.parse(String((JSON.parse(raw) as { refreshedAt?: string })?.refreshedAt || ''))
    if (!Number.isFinite(refreshedAt)) return false
    if (Date.now() - refreshedAt >= OFFLINE_CUSTOMER_MIRROR_MIN_INTERVAL_MS) return false
    return (await db.table('customers').count()) > 0
  } catch (_) {
    return false
  }
}

// Skip reasons, recorded in the snapshot meta so "customers was not
// re-read" is never ambiguous: kept because the copy is recent, or never
// stored because policy forbids it on this device.
const CUSTOMER_MIRROR_SKIP_FRESH = 'fresh'
const CUSTOMER_MIRROR_SKIP_POLICY = 'not_persisted_on_live_server'

async function customerMirrorSkipReason(): Promise<string | false> {
  if (!shouldPersistLocalMirror('customers', getSyncServerUrl())) return CUSTOMER_MIRROR_SKIP_POLICY
  return (await isCustomerMirrorFresh()) ? CUSTOMER_MIRROR_SKIP_FRESH : false
}

type CustomerPickerPayload = { items?: unknown; total?: unknown; truncated?: unknown }

// The bounded read + the local write, in that order. The rows land through
// the same mirrorTable() every other list read uses, so the storage policy
// is applied at write time as well as in the guard above.
async function refreshCustomerMirror(): Promise<void> {
  const payload = await apiFetch('GET', `/api/customers?fields=picker&limit=${OFFLINE_CUSTOMER_MIRROR_LIMIT}`) as CustomerPickerPayload | null
  const items = Array.isArray(payload?.items) ? payload.items : []
  const { mirrorTable } = await import('./localMirrors.ts')
  await mirrorTable('customers')(items)
  await markCustomerMirrorRefreshed({
    rows: items.length,
    total: Number(payload?.total ?? items.length) || 0,
    truncated: Boolean(payload?.truncated),
  })
}

// Stamped only after the read AND the local write resolved, so a failed
// refresh leaves the old timestamp in place and the next snapshot tries
// again.
async function markCustomerMirrorRefreshed(stats: { rows: number; total: number; truncated: boolean }): Promise<void> {
  try {
    const db = await getLocalDb()
    await db.settings.put({
      key: OFFLINE_CUSTOMER_MIRROR_META_KEY,
      value: JSON.stringify({ refreshedAt: new Date().toISOString(), ...stats }),
    })
  } catch (_) {
    // A device that cannot store the stamp just refreshes every snapshot,
    // exactly as it did before this guard existed.
  }
}

async function runOfflineSnapshotStep(
  label: string,
  fn: () => Promise<unknown>,
  results: SnapshotResults,
  options: { skipWhen?: () => Promise<string | false> } = {},
): Promise<void> {
  try {
    const skipReason = options.skipWhen ? await options.skipWhen() : false
    if (skipReason) {
      results.skippedSteps.push(`${label}:${skipReason}`)
      return
    }
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

    const results: SnapshotResults = { refreshed: [], skippedSteps: [], failed: [] }
    await runOfflineSnapshotStep('settings', () => getSettingsSnapshot(), results)
    await runOfflineSnapshotStep('categories', () => getCategories(), results)
    await runOfflineSnapshotStep('units', () => getUnits(), results)
    await runOfflineSnapshotStep('branches', () => getBranches(), results)
    await runOfflineSnapshotStep('products', () => getProducts(), results)
    // Bounded shape, own cadence (not the five-minute loop's), and only
    // when the copy will be kept -- see OFFLINE_CUSTOMER_MIRROR_LIMIT and
    // the block above it for why.
    await runOfflineSnapshotStep('customers', refreshCustomerMirror, results, { skipWhen: customerMirrorSkipReason })
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
      skippedSteps: results.skippedSteps,
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
