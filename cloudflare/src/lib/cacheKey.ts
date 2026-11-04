import { readDataEpoch } from './readSwitches'
import type { Env } from '../index'

// The one builder for a server cache key (CACHE-LIFECYCLE R1). The key is a hash of everything a cached body can depend on:
//   layer     CACHE_LAYER; changing the constant empties every entry at once (the emergency purge)
//   build     the Worker deployment id (CF_VERSION_METADATA.id), so a deploy or a rollback never reads another build's body shape
//   org       the signed-in organisation
//   epoch     the database's data epoch (lib/dataEpoch.ts); two databases never share one, a restore rotates it
//   scope     'neutral' for an actor-neutral body, or the grant fingerprint the producer reads
//   params    the request path and its canonical query (sorted, the cache-version parameter excluded)
//   versions  the namespace versions the caller read before the producer runs
//   salt      the read-switch salt, when the producer consults a switch
//   time      a business-date or 5-minute bucket, when the body depends on time
// Anything that cannot be read (no epoch, an unreadable version, a switch whose state is unknown) means there is no safe key: the
// caller computes uncached and stores nothing. There is no shared fallback token.
export const CACHE_LAYER = 'c1'
export const CACHE_PATH_PREFIX = '/__bos/c/v1/'
const FALLBACK_CACHE_ORIGIN = 'https://cache.bos.invalid'
export const UNSAFE_VERSION_PREFIX = 'unsafe:'

export type CacheIdentity = { env: Env; org: string; scope: string; time: string; salt: string | null }

type IdentityContext = { env: Env; get?: (key: any) => any }

/** Synchronous, no I/O: who is asking and what the body depends on besides the request and the versions. */
export function cacheIdentity(c: IdentityContext, extra: { scope?: string; time?: string; salt?: string | null } = {}): CacheIdentity {
  let organization = 0
  try { organization = Number(c.get?.('user')?.organization_id ?? 0) || 0 } catch { /* an unauthenticated route */ }
  return { env: c.env, org: String(organization), scope: extra.scope ?? 'neutral', time: extra.time ?? '', salt: extra.salt ?? null }
}

/** The Worker deployment id the key carries ('dev' where the binding is absent: tests, local). */
export const deploymentId = (env: Env): string => env.CF_VERSION_METADATA?.id || 'dev'

export const unsafeVersionToken = (): string => `${UNSAFE_VERSION_PREFIX}${crypto.randomUUID()}`
export const isUnsafeVersion = (version: string): boolean => typeof version !== 'string' || version.includes(UNSAFE_VERSION_PREFIX)

/** Path plus the query with its parameters sorted; the cache-version parameter never counts. */
export function canonicalParams(url: URL): string {
  const pairs = [...url.searchParams.entries()].filter(([name]) => name !== '_v').sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1))
  return `${url.pathname}?${pairs.map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join('&')}`
}

/** The deployment's own configured origin, never the request Host: the same host for every request and every caller. */
function cacheOrigin(env: Env): string {
  for (const configured of [env.BUSINESS_OS_ADMIN_URL, env.BUSINESS_OS_PUBLIC_URL]) {
    try {
      const url = new URL(String(configured || ''))
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.origin
    } catch { /* not configured, or not a URL: try the next */ }
  }
  return FALLBACK_CACHE_ORIGIN
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export type CacheKeyParts = { build: string; org: string; epoch: string; scope: string; params: string; versions: string; salt: string; time: string }

export async function hashCacheKey(parts: CacheKeyParts): Promise<string> {
  return sha256Hex(JSON.stringify([CACHE_LAYER, parts.build, parts.org, parts.epoch, parts.scope, parts.params, parts.versions, parts.salt, parts.time]))
}

/**
 * The Cache API request for one entry, or null when there is no safe key. The path is the hash under CACHE_PATH_PREFIX on an
 * origin the deployment is configured with (BUSINESS_OS_ADMIN_URL, then BUSINESS_OS_PUBLIC_URL), so no request header can steer it.
 */
export async function cacheKeyRequest(requestUrl: string, version: string, identity: CacheIdentity | undefined): Promise<Request | null> {
  if (!identity || isUnsafeVersion(version)) return null
  const epoch = await readDataEpoch(identity.env)
  if (!epoch) return null
  const url = new URL(requestUrl)
  const hash = await hashCacheKey({
    build: deploymentId(identity.env), org: identity.org, epoch, scope: identity.scope,
    params: canonicalParams(url), versions: version, salt: identity.salt ?? '', time: identity.time,
  })
  return new Request(`${cacheOrigin(identity.env)}${CACHE_PATH_PREFIX}${hash}`, { method: 'GET' })
}
