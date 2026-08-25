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
  return (await kv.get(`v:${namespace}`)) || '0'
}

export async function getVersionWithFallback(env: Env, namespace: string): Promise<string> {
  const fromKv = await env.CACHE.get(`v:${namespace}`)
  if (fromKv != null) return fromKv
  try {
    const row = await getDb(env)
      .prepare(`SELECT version FROM cache_versions WHERE namespace = @namespace`)
      .get<{ version: number }>({ namespace })
    return String(row?.version ?? 0)
  } catch {
    return '0'
  }
}

export async function versionedKey(kv: KVNamespace, namespace: string, suffix: string): Promise<string> {
  const version = await getVersion(kv, namespace)
  return `${namespace}:${version}:${suffix}`
}

/**
 * Advances a cache version so every existing cached key for that namespace
 * becomes unreachable.
 *
 * Takes `Env` rather than a bare KVNamespace because it now has to make a
 * budget decision, and that needs D1.
 *
 * KV's free ceiling is 1,000 writes/day -- two orders of magnitude below
 * D1's -- and this function is called from 31 mutation sites, all writing the
 * SAME key, which KV additionally caps at one write per second. So a busy day
 * exhausts the budget, and an exhausted budget makes this fail SILENTLY: the
 * version stops advancing, cachedJsonResponse keeps serving the old payload,
 * and the shop is shown stale stock and prices with nothing indicating it.
 * A quota ceiling becomes a correctness bug.
 *
 * The fallback is therefore not "skip the bump" -- that IS the bug. It is to
 * move the counter to D1, which has 100,000 writes/day, no per-key ceiling,
 * and strong consistency (which cache invalidation actually wants; KV is
 * eventually consistent). Crossing over deletes the KV key exactly once, and
 * from then on readers fall through to D1 on a plain miss, so no further KV
 * writes are needed at all for that namespace.
 */
export async function bumpVersion(env: Env, namespace: string): Promise<void> {
  const versionKey = `v:${namespace}`
  const budget = await consumeQuota(env, 'kv_write', 1)

  if (budget.zone === 'critical' || budget.zone === 'exhausted') {
    await bumpVersionInD1(env, namespace)
    // One delete, once, to hand reads over to D1 permanently for this
    // namespace. Deletes draw on their own daily allowance, not the write
    // one, and this happens once per namespace rather than per bump.
    await env.CACHE.delete(versionKey).catch(() => {})
    return
  }

  try {
    const current = Number((await env.CACHE.get(versionKey)) || '0')
    // No TTL on the version key itself -- it's tiny and needs to persist.
    await env.CACHE.put(versionKey, String(current + 1))
  } catch {
    // A KV write can fail for reasons the budget did not predict (the real
    // limit reached before our count did, a per-key write collision). Never
    // let that leave the version un-advanced, or the cache goes stale.
    await bumpVersionInD1(env, namespace)
    await env.CACHE.delete(versionKey).catch(() => {})
  }
}

async function bumpVersionInD1(env: Env, namespace: string): Promise<void> {
  try {
    await getDb(env).prepare(`
      INSERT INTO cache_versions (namespace, version, updated_at)
      VALUES (@namespace, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(namespace)
      DO UPDATE SET version = version + 1, updated_at = CURRENT_TIMESTAMP
    `).run({ namespace })
  } catch (error) {
    console.error('[cache] could not advance version in D1', namespace, error)
  }
}
