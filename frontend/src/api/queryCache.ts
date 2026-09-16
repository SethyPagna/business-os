import { getLocalDb } from './lazyLocalDb.ts'
import { actorReadResultScope, actorReadStorageKey, captureActorReadScope, invalidateActorReadChannel, isActorReadScopeCurrent, type ActorReadScope } from './actorReadScope.ts'

const QUERY_CACHE_PREFIX = 'read_cache:'
const QUERY_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000

export function buildQueryCacheStorageKey(key: string): string {
  return actorReadStorageKey(key, captureActorReadScope(key))
}

export async function readCachedQueryResult<TData = unknown>(key: string): Promise<TData | null> {
  const scope = captureActorReadScope(key)
  const storageKey = actorReadStorageKey(key, scope)
  try {
    const db = await getLocalDb()
    if (!isActorReadScopeCurrent(scope)) return null
    const row = await db.settings.get(storageKey)
    if (!isActorReadScopeCurrent(scope)) return null
    if (!row?.value) return null
    const parsed = JSON.parse(String(row.value)) as { savedAt?: string; data?: TData }
    const savedAtMs = Date.parse(parsed?.savedAt || '')
    if (!Number.isFinite(savedAtMs) || Date.now() - savedAtMs > QUERY_CACHE_MAX_AGE_MS) return null
    return parsed?.data ?? null
  } catch (_) {
    return null
  }
}

export async function writeCachedQueryResult<TData>(key: string, data: TData, scope: ActorReadScope = actorReadResultScope(data, captureActorReadScope(key))): Promise<TData> {
  const storageKey = actorReadStorageKey(key, scope)
  try {
    const db = await getLocalDb()
    if (!isActorReadScopeCurrent(scope)) return data
    await db.settings.put({
      key: storageKey,
      value: JSON.stringify({
        savedAt: new Date().toISOString(),
        data,
      }),
    })
    // A write already issued to IndexedDB may complete after a session change.
    // It has an old-runtime key, never readable by the new actor; retire it too.
    if (!isActorReadScopeCurrent(scope)) await db.settings.delete(storageKey)
  } catch (_) {}
  return data
}

export async function clearCachedQueryResults(prefixes: string[] = []): Promise<void> {
  const keys: string[] = []
  for (const value of Array.isArray(prefixes) ? prefixes : []) {
    const key = String(value || '').trim()
    if (key) keys.push(key)
  }
  if (!keys.length) return
  keys.forEach(invalidateActorReadChannel)
  try {
    const db = await getLocalDb()
    const rows = await db.settings.toArray()
    const matchingKeys: string[] = []
    for (const row of rows) {
      const rowKey = String(row?.key || '')
      if (!rowKey.startsWith(QUERY_CACHE_PREFIX)) continue
      for (const prefix of keys) {
        if (!rowKey.includes(prefix)) continue
        matchingKeys.push(rowKey)
        break
      }
    }
    if (matchingKeys.length) await db.settings.bulkDelete(matchingKeys)
  } catch (_) {}
}
