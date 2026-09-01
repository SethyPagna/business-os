import type { Env } from '../index'
import { getDb } from './db'
import { consumeQuota } from './quotaGuard'
// Runtime cache, replacing backend/src/runtimeCache.ts's Redis-backed
// short-TTL read-through cache (getOrSetJson / deleteByPrefix) with Workers
// KV.
//
// One real behavioral difference from Redis, worth knowing:
// KV has no atomic "delete every key starting with X" the way Redis SCAN+DEL
// does. Listing-then-deleting by prefix works but costs one list operation
// plus N deletes, and KV writes are eventually consistent (seconds, not
// atomic) across the edge. For a cache whose whole purpose is tolerating
// ~20-30s of staleness, this is a non-issue -- but "invalidate on every
// write" (the Redis code's actual usage pattern) is the wrong shape for KV.
//
// Use a *version* per cache namespace instead: bump the version on write,
// fold it into every read's cache key. Old entries simply age out via TTL
// without ever needing to be found and deleted. This is cheaper, faster,
// and avoids KV's list-then-delete eventual-consistency window entirely.

const DEFAULT_TTL_SECONDS = 30
const CACHE_VERSION_KEY_PREFIX = 'v2:'

function cacheVersionKey(namespace: string): string {
  return `${CACHE_VERSION_KEY_PREFIX}${namespace}`
}

function cacheVersionToken(source: 'kv' | 'd1', value: string | number): string {
  // Prefix the source/generation so cache keys created by the old `v:`
  // scheme can never become reachable again after this migration, even if
  // their numeric counter happens to match a new value.
  return `${source === 'kv' ? 'k2' : 'd2'}:${value}`
}

export async function getJson<T>(kv: KVNamespace, key: string): Promise<T | null> {
  const value = await kv.get(key, 'json')
  return (value as T) ?? null
}

export async function setJson(kv: KVNamespace, key: string, value: unknown, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<void> {
  // KV requires a minimum TTL of 60s; below that, just don't cache -- the
  // caller's producer() still runs and returns a correct, if uncached, result.
  if (ttlSeconds < 60) return
  await kv.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds })
}

// getOrSetJson (KV-backed) is for LOW-CARDINALITY, LOW-WRITE-FREQUENCY data
// only: settings, a handful of dashboard summaries, feature flags -- things
// with a small, fixed number of distinct keys. Cloudflare designed KV's free
// tier (1,000 writes/day) explicitly around "infrequently written data that
// may be frequently read" (their words). Do NOT use this for anything keyed
// by user input (search queries, filters, pagination) -- see
// cachedJsonResponse below for that shape instead, which has no comparable
// daily write cap.
export async function getOrSetJson<T>(kv: KVNamespace, key: string, ttlSeconds: number, producer: () => Promise<T> | T): Promise<T> {
  const cached = await getJson<T>(kv, key)
  if (cached != null) return cached
  const value = await producer()
  await setJson(kv, key, value, ttlSeconds)
  return value
}

// cachedJsonResponse: for HIGH-CARDINALITY data keyed by request parameters
// (product search with arbitrary query/filter/page combinations, catalog
// listings, anything where a real customer's query string becomes the cache
// key). Uses the Workers Cache API (`caches.default`), not KV -- it has no
// meaningful daily write-count cap on the free tier the way KV does, because
// it's not a separately metered storage product; it's the same HTTP cache
// mechanism every Worker already has for free, keyed by request URL.
//
// The tradeoff for that: it's a *cache*, not guaranteed durable storage --
// Cloudflare can evict an entry before its TTL under memory pressure, and it
// isn't visible/listable the way KV is. Both fine for what this is used
// for (a 20s read-through cache), and TTL is honored as a maximum, not a
// guarantee, exactly like the Redis cache this replaces already behaved.
//
// `version` should come from versionedKey's bumpVersion mechanism (KV) --
// bumping it changes every cache key at once without needing to enumerate
// and delete old entries, the same trick versionedKey uses for KV itself.
export async function cachedJsonResponse<T>(
  request: Request,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  version: string,
  ttlSeconds: number,
  producer: () => Promise<T> | T,
): Promise<T> {
  const cache = caches.default
  const cacheUrl = new URL(request.url)
  cacheUrl.searchParams.set('_v', version)
  const cacheKey = new Request(cacheUrl.toString(), request)

  const cached = await cache.match(cacheKey)
  if (cached) {
    return cached.json<T>()
  }

  const value = await producer()
  const response = new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttlSeconds}` },
  })
  // Don't make the caller wait for the cache write -- same non-blocking
  // shape as the KV path's fire-and-forget put, but explicit here since
  // Workers requires ctx.waitUntil() to guarantee a background write
  // actually completes after the response is already sent.
  ctx.waitUntil(cache.put(cacheKey, response))
  return value
}

// Namespace-versioned key builder. Call bumpVersion(kv, 'products') after any
// write that should invalidate product-search caches; every read key
// automatically becomes a new, uncached key once that happens, and the old
// entries just expire on their own TTL.
// KV first, because it is sub-millisecond at the edge and 100,000 reads/day
// is generous. A MISS falls through to D1, which is what makes the fallback
// below work: once the KV key is removed, every reader lands on D1 without
// any of them needing to know why.
export async function getVersion(kv: KVNamespace, namespace: string): Promise<string> {
  const value = (await kv.get(cacheVersionKey(namespace))) || '0'
  return cacheVersionToken('kv', value)
}

export async function getVersionWithFallback(env: Env, namespace: string): Promise<string> {
  const fromKv = await env.CACHE.get(cacheVersionKey(namespace))
  if (fromKv != null) return cacheVersionToken('kv', fromKv)
  try {
    const row = await getDb(env)
      .prepare(`SELECT version FROM cache_versions WHERE namespace = @namespace`)
      .get<{ version: number }>({ namespace })
    if (row?.version != null) return cacheVersionToken('d1', row.version)
  } catch {
    // A cache-version read must never take the request down. With neither
    // source available, use the generation-qualified zero token; the cache
    // remains correct, merely less likely to hit until the next mutation.
  }
  return cacheVersionToken('kv', '0')
}

export async function versionedKey(kv: KVNamespace, namespace: string, suffix: string): Promise<string> {
  const version = await getVersion(kv, namespace)
  return `${namespace}:${version}:${suffix}`
}

async function readD1Version(env: Env, namespace: string): Promise<number | null> {
  try {
    const row = await getDb(env)
      .prepare(`SELECT version FROM cache_versions WHERE namespace = @namespace`)
      .get<{ version: number }>({ namespace })
    return row?.version == null ? null : Number(row.version)
  } catch {
    return null
  }
}

/**
 * Advances a cache version so every existing cached key for that namespace
 * becomes unreachable.
 *
 * A namespace begins in KV mode because reads are cheap. If KV quota pressure
 * or a write failure forces a handoff to D1, that handoff is permanent: the
 * KV key is deleted and future bumps detect the D1 row before spending another
 * KV write. This avoids two correctness failures in the old implementation:
 * (1) recreating the KV counter at `1` after the daily quota window reset, and
 * (2) moving a version backward when D1 started below the current KV counter.
 *
 * `v2:` plus the `k2:`/`d2:` token prefix deliberately starts a new cache-key
 * generation, so any stale Cache API entry produced by the older numeric-only
 * `v:` scheme is unreachable immediately after deployment.
 */
export async function bumpVersion(env: Env, namespace: string): Promise<void> {
  const versionKey = cacheVersionKey(namespace)

  let currentKvRaw: string | null = null
  try {
    currentKvRaw = await env.CACHE.get(versionKey)
  } catch {
    currentKvRaw = null
  }

  // Missing KV + an existing D1 row means this namespace already crossed
  // over. Stay in strongly-consistent D1 mode permanently instead of
  // recreating the KV key when tomorrow's quota window becomes "ok" again.
  if (currentKvRaw == null) {
    const currentD1 = await readD1Version(env, namespace)
    if (currentD1 != null) {
      await bumpVersionInD1(env, namespace, currentD1 + 1)
      return
    }
  }

  const budget = await consumeQuota(env, 'kv_write', 1)
  const currentKv = Number(currentKvRaw || '0') || 0
  const nextKv = currentKv + 1

  if (budget.zone === 'critical' || budget.zone === 'exhausted') {
    await bumpVersionInD1(env, namespace, nextKv)
    // One delete at the handoff. From this point, the D1 row above makes the
    // switch permanent even after the quota counter rolls into a new day.
    await env.CACHE.delete(versionKey).catch(() => {})
    return
  }

  try {
    await env.CACHE.put(versionKey, String(nextKv))
  } catch {
    // A per-key write collision or other KV error must still invalidate the
    // cache. Seed D1 at least one step beyond the KV value we were replacing,
    // then remove KV so readers cannot observe two competing counters.
    await bumpVersionInD1(env, namespace, nextKv)
    await env.CACHE.delete(versionKey).catch(() => {})
  }
}

async function bumpVersionInD1(env: Env, namespace: string, minimumVersion = 1): Promise<void> {
  try {
    await getDb(env).prepare(`
      INSERT INTO cache_versions (namespace, version, updated_at)
      VALUES (@namespace, @minimumVersion, CURRENT_TIMESTAMP)
      ON CONFLICT(namespace)
      DO UPDATE SET version = MAX(version + 1, @minimumVersion), updated_at = CURRENT_TIMESTAMP
    `).run({ namespace, minimumVersion })
  } catch (error) {
    console.error('[cache] could not advance version in D1', namespace, error)
  }
}
