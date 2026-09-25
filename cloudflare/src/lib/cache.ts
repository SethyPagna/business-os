import type { Env } from '../index'
import { getDb } from './db'
import { consumeQuota } from './quotaGuard'
import { getBuildStamp } from './buildStamp'
import { getMergedPermissions, isAdminControlUser, type PermissionUser } from './permissions'
import { serverTimingOf } from './serverTiming'
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
//
// K1: this signature is frozen for its existing callers (contacts, portal,
// products, sales). It now runs through cachedJson() below, so it gains the
// build hash in the key, the per-isolate stampede guard and the stored-at
// stamp, but it never answers 304 and never honours a client bypass: it has
// no actor identity to make either safe. Routes that want those call
// cachedJson() + sendCachedJson() instead.
export async function cachedJsonResponse<T>(
  request: Request,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  version: string,
  ttlSeconds: number,
  producer: () => Promise<T> | T,
): Promise<T> {
  const result = await cachedJson<T>(request, ctx, {
    version,
    ttlSeconds,
    producer,
    conditional: false,
    allowClientBypass: false,
  })
  return result.payload as T
}

// ---------------------------------------------------------------------------
// K1 edge cache core: cachedJson()
// ---------------------------------------------------------------------------
//
// ORDER OF OPERATIONS (each step exists for a stated reason):
//
// 1. The ETag is DERIVED, not hashed from the body: sha1 over the route id,
//    the canonical query, the version token, the projection class, the actor,
//    the actor's permission fingerprint, the build hash and (stock-bearing
//    routes only) a 20 s bucket. It is therefore known BEFORE any cache or
//    database access, and a matching If-None-Match costs zero Cache API reads
//    and zero producer (D1) reads. The actor and the permission fingerprint
//    are inputs so a 304 can never confirm one user's copy for another user,
//    or confirm a copy made under permissions the user no longer has.
//    Correctness contract for callers: read the version token(s) BEFORE the
//    producer runs, and the producer's output must be a function of exactly
//    (URL, version, projectionClass) -- anything else that changes the body
//    must either bump a version or be declared stockBearing.
// 2. A staff client may send `Cache-Control: no-cache` after its own write
//    (read-your-writes across KV's propagation window). Only when the route
//    opted in with allowClientBypass: the storefront cannot be cache-busted by
//    a visitor. A bypass skips the 304, skips the match, never joins an
//    in-flight producer that may predate the write, and writes the fresh
//    result back so the next reader benefits.
// 3. cache.match on a key that carries `_v` (version) and `_b` (build hash):
//    a deploy that changes a payload's shape can never serve the previous
//    build's bytes.
// 4. A miss runs the producer ONCE per isolate per key, however many requests
//    miss concurrently (the stampede guard). Joiners get their own parsed copy
//    so no caller can mutate another's payload.
// 5. Optional SWR: an entry older than swrAfterMs is served (STALE) and
//    refreshed in waitUntil; an entry older than hardMaxAgeMs is never served.

export type CachedJsonStatus = 'HIT' | 'MISS' | 'BYPASS' | 'STALE' | 'NOT_MODIFIED'

export type CachedJsonOptions<T> = {
  /** Namespaced version token(s), e.g. from readVersionTokens(). */
  version: string
  /** Cache API lifetime; also the hard max age unless hardMaxAgeMs is set. */
  ttlSeconds: number
  producer: () => Promise<T> | T
  /** Stable route identity for the ETag; defaults to the URL path. */
  routeId?: string
  /** Defaults to the request URL's query, sorted. */
  canonicalQuery?: string
  /** null/undefined means an actor-neutral (public) response. */
  actorId?: string | number | null
  /** permissionFingerprint(user) for staff routes. */
  permissionFingerprint?: string | null
  /**
   * A label for a producer whose output differs by audience (e.g. 'cost' vs
   * 'nocost'). It is part of the cache key as well as the ETag.
   */
  projectionClass?: string
  /** Adds floor(now / 20 s) to the ETag: a stock figure is never confirmed for longer. */
  stockBearing?: boolean
  /** Staff routes only. Default false so public routes cannot be busted. */
  allowClientBypass?: boolean
  /** Default true. false = never answer 304 (the legacy wrapper). */
  conditional?: boolean
  /** Serve-stale-and-refresh threshold. Absent = no SWR. */
  swrAfterMs?: number
  /** Never serve an entry older than this. Defaults to ttlSeconds * 1000. */
  hardMaxAgeMs?: number
  // Test seams. Production callers leave these unset.
  now?: () => number
  cache?: Cache
  buildHash?: string
}

export type CachedJsonResult<T> = {
  status: CachedJsonStatus
  /** null only when status is NOT_MODIFIED. */
  payload: T | null
  etag: string
  /** The version token the ETag and key were built from; send as X-BOS-V. */
  versionToken: string
  buildHash: string
  /** Serialized JSON string length (approximate bytes; 0 for NOT_MODIFIED). */
  bytes: number
}

export const STOCK_BUCKET_MS = 20_000
const STORED_AT_HEADER = 'x-bos-stored-at'

type Produced = { body: string; value: unknown }
const inflight = new Map<string, Promise<Produced>>()

/** Test/diagnostic seam: how many keys currently have a producer running. */
export function inflightCacheProducers(): number {
  return inflight.size
}

export function stockBucket(nowMs: number): number {
  return Math.floor(nowMs / STOCK_BUCKET_MS)
}

export function canonicalQueryOf(url: URL): string {
  const entries = Array.from(url.searchParams.entries())
    .filter(([key]) => key !== '_v' && key !== '_b' && key !== '_p')
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
  return new URLSearchParams(entries).toString()
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/**
 * Everything about a staff user that can change what a response may contain.
 * Hashed into the ETag, so it may be long; it never leaves the Worker.
 */
export function permissionFingerprint(user: PermissionUser | null | undefined): string {
  if (!user) return 'anonymous'
  return `${String(user.role_code || '').trim().toLowerCase()}|admin=${isAdminControlUser(user) ? 1 : 0}|${stableJson(getMergedPermissions(user))}`
}

export type EtagParts = {
  routeId: string
  canonicalQuery: string
  versionToken: string
  projectionClass: string
  actorId: string
  permissionFingerprint: string
  buildHash: string
  bucket: string
}

async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Weak because it names a version of the data, not a byte-exact body. */
export async function computeCacheEtag(parts: EtagParts): Promise<string> {
  // A JSON array rather than a '|' join: no field value can forge a boundary.
  const material = JSON.stringify([
    parts.routeId, parts.canonicalQuery, parts.versionToken, parts.projectionClass,
    parts.actorId, parts.permissionFingerprint, parts.buildHash, parts.bucket,
  ])
  return `W/"${await sha1Hex(material)}"`
}

/** Weak comparison per RFC 9110 13.1.2; `*` is deliberately not honoured. */
export function ifNoneMatchSatisfied(header: string | null | undefined, etag: string): boolean {
  if (!header) return false
  const target = etag.replace(/^W\//, '')
  return header.split(',').some((candidate) => {
    const value = candidate.trim().replace(/^W\//, '')
    return value !== '' && value !== '*' && value === target
  })
}

export function requestsClientBypass(request: Request): boolean {
  const directives = String(request.headers.get('cache-control') || '').toLowerCase()
  return directives.split(',').some((directive) => directive.trim() === 'no-cache')
}

function cacheKeyFor(request: Request, version: string, buildHash: string, projectionClass: string): Request {
  const url = new URL(request.url)
  url.searchParams.set('_v', version)
  url.searchParams.set('_b', buildHash)
  if (projectionClass) url.searchParams.set('_p', projectionClass)
  // A header-free GET: HEAD cannot be put, and nothing of the caller's
  // (cookies, Cache-Control) belongs in a shared key.
  return new Request(url.toString(), { method: 'GET' })
}

function runCoalesced(key: string, fresh: boolean, run: () => Promise<Produced>): { promise: Promise<Produced>; leader: boolean } {
  if (!fresh) {
    const existing = inflight.get(key)
    if (existing) return { promise: existing, leader: false }
  }
  const promise = run()
  if (fresh) return { promise, leader: true }
  inflight.set(key, promise)
  const clear = () => { if (inflight.get(key) === promise) inflight.delete(key) }
  promise.then(clear, clear)
  return { promise, leader: true }
}

export async function cachedJson<T>(
  request: Request,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  options: CachedJsonOptions<T>,
): Promise<CachedJsonResult<T>> {
  const now = options.now ?? (() => Date.now())
  const startedAt = now()
  const buildHash = options.buildHash ?? getBuildStamp().sourceHash
  const url = new URL(request.url)
  const projectionClass = String(options.projectionClass || '')
  const versionToken = String(options.version)
  const timing = serverTimingOf(request)
  const etag = await computeCacheEtag({
    routeId: options.routeId || url.pathname,
    canonicalQuery: options.canonicalQuery ?? canonicalQueryOf(url),
    versionToken,
    projectionClass,
    actorId: options.actorId == null || options.actorId === '' ? 'public' : `actor:${String(options.actorId)}`,
    permissionFingerprint: String(options.permissionFingerprint ?? ''),
    buildHash,
    bucket: options.stockBearing ? String(stockBucket(startedAt)) : '',
  })
  const finish = (status: CachedJsonStatus, payload: T | null, bytes: number): CachedJsonResult<T> => {
    timing?.setCache(status, bytes)
    return { status, payload, etag, versionToken, buildHash, bytes }
  }

  const method = request.method.toUpperCase()
  const bypass = options.allowClientBypass === true && requestsClientBypass(request)
  if (!bypass && options.conditional !== false && (method === 'GET' || method === 'HEAD')
    && ifNoneMatchSatisfied(request.headers.get('if-none-match'), etag)) {
    return finish('NOT_MODIFIED', null, 0)
  }

  const cache = options.cache ?? caches.default
  const cacheKey = cacheKeyFor(request, versionToken, buildHash, projectionClass)
  const keyString = cacheKey.url
  const hardMaxAgeMs = Math.max(1000, options.hardMaxAgeMs ?? options.ttlSeconds * 1000)
  const storeSeconds = Math.max(1, Math.ceil(hardMaxAgeMs / 1000))

  const produceAndStore = async (): Promise<Produced> => {
    const value = await options.producer()
    const body = JSON.stringify(value) ?? 'null'
    const response = new Response(body, {
      headers: {
        'content-type': 'application/json',
        'cache-control': `public, max-age=${storeSeconds}`,
        [STORED_AT_HEADER]: String(now()),
      },
    })
    // Not awaited by the caller -- Workers needs waitUntil() for the write to
    // outlive the response. A failed put only costs the next reader a miss.
    ctx.waitUntil(cache.put(cacheKey, response).catch(() => {}))
    return { body, value }
  }
  const take = async (coalesced: { promise: Promise<Produced>; leader: boolean }) => {
    const produced = await coalesced.promise
    // The leader keeps the producer's own object (no extra parse on the hot
    // miss path); every joiner gets a private copy.
    const payload = (coalesced.leader ? produced.value : JSON.parse(produced.body)) as T
    return { payload, bytes: produced.body.length }
  }

  if (bypass) {
    const { payload, bytes } = await take(runCoalesced(keyString, true, produceAndStore))
    return finish('BYPASS', payload, bytes)
  }

  const cached = await cache.match(cacheKey)
  if (cached) {
    const stamp = cached.headers.get(STORED_AT_HEADER)
    const storedAt = stamp == null ? NaN : Number(stamp)
    // An entry this module wrote always carries the stamp. One without it can
    // only be bounded by the Cache API's own max-age, so it is served as a
    // plain HIT and never considered for SWR. A stamp slightly in the future
    // (clock skew between machines) counts as age 0.
    const age = Number.isFinite(storedAt) ? Math.max(0, startedAt - storedAt) : null
    if (age == null || age <= hardMaxAgeMs) {
      const body = await cached.text()
      const payload = JSON.parse(body) as T
      if (age != null && options.swrAfterMs != null && options.swrAfterMs >= 0 && age > options.swrAfterMs) {
        const refresh = runCoalesced(keyString, false, produceAndStore).promise.catch(() => undefined)
        ctx.waitUntil(refresh)
        return finish('STALE', payload, body.length)
      }
      return finish('HIT', payload, body.length)
    }
  }

  const { payload, bytes } = await take(runCoalesced(keyString, false, produceAndStore))
  return finish('MISS', payload, bytes)
}

type CachedJsonContext = {
  json: (object: any, status?: any, headers?: any) => Response
  body: (data: null, status?: any, headers?: any) => Response
}

/**
 * Builds the response for a cachedJson() result. A 200 goes through c.json so
 * response projections installed as c.json wrappers (acquisitionCostResponses)
 * still apply; a 304 carries no body, so there is nothing to project.
 *
 * Cache-Control is left to lib/httpCache.ts's policy table unless the caller
 * passes one, so a route never has to know its own class.
 */
export function sendCachedJson<T>(c: CachedJsonContext, result: CachedJsonResult<T>, extra: { cacheControl?: string } = {}): Response {
  const headers: Record<string, string> = {
    ETag: result.etag,
    'X-BOS-V': result.versionToken,
  }
  if (extra.cacheControl) headers['Cache-Control'] = extra.cacheControl
  if (result.status === 'NOT_MODIFIED') return c.body(null, 304, headers)
  return c.json(result.payload, 200, headers)
}

/**
 * Reads several namespace versions at once and composes them into one token
 * (`products=k2:4;stock=d2:9`), timing the reads into Server-Timing's kv entry
 * when a collector is attached. The per-namespace map is returned too, so a
 * route can expose exactly what it was keyed on.
 */
export async function readVersionTokens(
  env: Env,
  namespaces: string[],
  request?: Request | null,
): Promise<{ token: string; tokens: Record<string, string> }> {
  const unique = Array.from(new Set(namespaces.filter(Boolean))).sort()
  const timing = serverTimingOf(request)
  const read = () => Promise.all(unique.map((namespace) => getVersionWithFallback(env, namespace)))
  const values = timing ? await timing.timeKv(read) : await read()
  const tokens: Record<string, string> = {}
  unique.forEach((namespace, index) => { tokens[namespace] = values[index] })
  return { token: unique.map((namespace) => `${namespace}=${tokens[namespace]}`).join(';'), tokens }
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
  return bumpVersions(env, [namespace])
}

// Multi-namespace bump. A write that touches several caches at once (a
// return that invalidates both 'sales' and 'products', a merge that touches
// 'products' and 'contacts', ...) used to call bumpVersion() once per
// namespace -- each call independently re-derives its own KV/D1 plan, and
// any namespace that had already crossed over to the D1 fallback fired its
// own separate INSERT..ON CONFLICT. The KV path stays one write per key
// (KV has no multi-key write primitive), but every namespace that needs the
// D1 fallback in this one call goes out as ONE db.batch() round trip instead
// of N sequential prepares.
export async function bumpVersions(env: Env, namespaces: string[]): Promise<void> {
  const unique = Array.from(new Set(namespaces.filter(Boolean)))
  if (!unique.length) return

  const d1Upserts: Array<{ namespace: string; minimumVersion: number }> = []

  for (const namespace of unique) {
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
        d1Upserts.push({ namespace, minimumVersion: currentD1 + 1 })
        continue
      }
    }

    const budget = await consumeQuota(env, 'kv_write', 1)
    const currentKv = Number(currentKvRaw || '0') || 0
    const nextKv = currentKv + 1

    if (budget.zone === 'critical' || budget.zone === 'exhausted') {
      d1Upserts.push({ namespace, minimumVersion: nextKv })
      // One delete at the handoff. From this point, the D1 row above makes
      // the switch permanent even after the quota counter rolls into a new
      // day.
      await env.CACHE.delete(versionKey).catch(() => {})
      continue
    }

    try {
      await env.CACHE.put(versionKey, String(nextKv))
    } catch {
      // A per-key write collision or other KV error must still invalidate
      // the cache. Seed D1 at least one step beyond the KV value we were
      // replacing, then remove KV so readers cannot observe two competing
      // counters.
      d1Upserts.push({ namespace, minimumVersion: nextKv })
      await env.CACHE.delete(versionKey).catch(() => {})
    }
  }

  if (d1Upserts.length) await bumpVersionsInD1(env, d1Upserts)
}

async function bumpVersionsInD1(env: Env, entries: Array<{ namespace: string; minimumVersion: number }>): Promise<void> {
  try {
    await getDb(env).batch(entries.map(({ namespace, minimumVersion }) => ({
      sql: `
        INSERT INTO cache_versions (namespace, version, updated_at)
        VALUES (@namespace, @minimumVersion, CURRENT_TIMESTAMP)
        ON CONFLICT(namespace)
        DO UPDATE SET version = MAX(version + 1, @minimumVersion), updated_at = CURRENT_TIMESTAMP
      `,
      params: { namespace, minimumVersion },
    })))
  } catch (error) {
    console.error('[cache] could not advance versions in D1', entries.map((entry) => entry.namespace), error)
  }
}
