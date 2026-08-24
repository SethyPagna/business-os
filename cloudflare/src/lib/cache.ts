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
export async function getVersion(kv: KVNamespace, namespace: string): Promise<string> {
  return (await kv.get(`v:${namespace}`)) || '0'
}

export async function versionedKey(kv: KVNamespace, namespace: string, suffix: string): Promise<string> {
  const version = await getVersion(kv, namespace)
  return `${namespace}:${version}:${suffix}`
}

export async function bumpVersion(kv: KVNamespace, namespace: string): Promise<void> {
  const versionKey = `v:${namespace}`
  const current = Number((await kv.get(versionKey)) || '0')
  // No TTL on the version key itself -- it's tiny and needs to persist.
  await kv.put(versionKey, String(current + 1))
}
