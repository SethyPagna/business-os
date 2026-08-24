import { getLocalDb } from './lazyLocalDb.ts'

const QUERY_CACHE_PREFIX = 'read_cache:'
const QUERY_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000

export function buildQueryCacheStorageKey(key: string): string {
  return `${QUERY_CACHE_PREFIX}${String(key || '').trim()}`
}

export async function readCachedQueryResult<TData = unknown>(key: string): Promise<TData | null> {
  const storageKey = buildQueryCacheStorageKey(key)
  try {
    const db = await getLocalDb()
    const row = await db.settings.get(storageKey)
    if (!row?.value) return null
    const parsed = JSON.parse(String(row.value)) as { savedAt?: string; data?: TData }
    const savedAtMs = Date.parse(parsed?.savedAt || '')
    if (Number.isFinite(savedAtMs) && Date.now() - savedAtMs > QUERY_CACHE_MAX_AGE_MS) return null
    return parsed?.data ?? null
  } catch (_) {
    return null
  }
}

export async function writeCachedQueryResult<TData>(key: string, data: TData): Promise<TData> {
  const storageKey = buildQueryCacheStorageKey(key)
  try {
    const db = await getLocalDb()
    await db.settings.put({
      key: storageKey,
      value: JSON.stringify({
        savedAt: new Date().toISOString(),
        data,
      }),
    })
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
